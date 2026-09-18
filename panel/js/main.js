/*
 * main.js — panel side of the Claude bridge.
 *
 * Runs in CEP's Chromium with Node.js enabled. Owns three things:
 *   1. a localhost HTTP server the MCP process talks to
 *   2. evalScript dispatch into bridge.jsx
 *   3. the sandbox guard — write operations are refused unless the open
 *      project is the designated sandbox, or the human unlocks it here.
 */

(function () {
  'use strict';

  var DEFAULT_PORT = 7788;
  var cep = window.__adobe_cep__;
  var http = require('http');
  var fs = require('fs');
  var path = require('path');
  var os = require('os');

  var statePath = path.join(os.homedir(), '.ae-mcp-bridge.json');
  var frameDir = path.join(os.homedir(), '.ae-mcp-bridge', 'frames');
  var renderDir = path.join(os.homedir(), '.ae-mcp-bridge', 'renders');
  var jobsPath = path.join(renderDir, 'jobs.json');
  var state = { sandboxPath: null, guardEnabled: true, port: DEFAULT_PORT, token: null,
                reveal: true, allowRaw: true };
  var VERSION = readVersion();
  /* Tools that run arbitrary code or menu commands — the panel can switch them off. */
  var RAW_FNS = ['run_jsx', 'menu_command'];
  var writeFns = null;          // filled in from the JSX side on boot
  var projectFns = [];          // ops that swap the open project entirely
  var renderJobs = {};          // id -> aerender job state
  var jobSeq = 0;
  var childProcess = require('child_process');
  var crypto = require('crypto');
  var server = null;
  var callCount = 0;

  /* ------------------------------------------------------------ */
  /* Persistence                                                  */
  /* ------------------------------------------------------------ */

  function loadState() {
    try {
      var raw = fs.readFileSync(statePath, 'utf8');
      var saved = JSON.parse(raw);
      if (saved.sandboxPath) { state.sandboxPath = saved.sandboxPath; }
      if (typeof saved.guardEnabled === 'boolean') { state.guardEnabled = saved.guardEnabled; }
      if (saved.port) { state.port = saved.port; }
      if (saved.token) { state.token = saved.token; }
      if (typeof saved.reveal === 'boolean') { state.reveal = saved.reveal; }
      if (typeof saved.allowRaw === 'boolean') { state.allowRaw = saved.allowRaw; }
    } catch (e) { /* first run */ }

    /* The bridge can run arbitrary ExtendScript, so it must not be reachable by
       anything that merely knows the port. Any web page you visit can POST to
       127.0.0.1 without a preflight; only a shared secret keeps it out. */
    if (!state.token) {
      state.token = crypto.randomBytes(32).toString('hex');
      saveState();
    }
  }

  /* CEP hands back paths as plain paths or file:// URLs, and on Windows as
     file:///C:/… — turn any of them into a native filesystem path. */
  function cepPath(p) {
    var s = decodeURI(String(p || '')).replace(/^file:\/\//, '');
    if (/^\/[A-Za-z]:[\/\\]/.test(s)) { s = s.slice(1); }
    return path.normalize(s);
  }

  /* One version, from the extension manifest, instead of a copy per file. */
  function readVersion() {
    try {
      var root = window.__adobe_cep__.getSystemPath('extension');
      var xml = fs.readFileSync(path.join(cepPath(root), 'CSXS', 'manifest.xml'), 'utf8');
      var m = xml.match(/ExtensionBundleVersion="([^"]+)"/);
      if (m) { return m[1]; }
    } catch (e) {}
    return 'unknown';
  }

  function saveState() {
    try {
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 });
      try { fs.chmodSync(statePath, 0o600); } catch (e2) {}
    } catch (e) { log('Could not save settings: ' + e.message, 'warn'); }
  }

  /* ------------------------------------------------------------ */
  /* ExtendScript dispatch                                        */
  /* ------------------------------------------------------------ */

  function evalScript(script, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var timer = timeoutMs ? setTimeout(function () {
        reject(new Error('After Effects has not answered in ' + Math.round(timeoutMs / 1000) + 's. ' +
          'It is most likely showing a dialog (or busy rendering) — ask the user to look at the app ' +
          'and dismiss it. Calls queue up behind it and will run once it clears.'));
      }, timeoutMs) : null;
      cep.evalScript(script, function (result) {
        if (timer) { clearTimeout(timer); }
        resolve(result);
      });
    });
  }

  /* How long a call may take before we say AE looks stuck. Rendering through
     the Render Queue and arbitrary scripts are allowed much longer. */
  function timeoutFor(fn) {
    if (fn === 'render_queue') { return 3600000; }
    if (fn === 'run_jsx' || fn === 'batch' || fn === 'menu_command') { return 600000; }
    return 90000;
  }

  function callBridge(fn, args) {
    var script = '__aeBridge(' + JSON.stringify(fn) + ',' +
                 JSON.stringify(JSON.stringify(args || {})) + ')';
    return evalScript(script, timeoutFor(fn)).then(function (raw) {
      if (raw === 'EvalScript error.') {
        throw new Error('ExtendScript failed to evaluate. Is bridge.jsx loaded? ' +
                        'Close and reopen the panel.');
      }
      var parsed;
      try { parsed = JSON.parse(raw); }
      catch (e) { throw new Error('Bridge returned unparseable output: ' + String(raw).slice(0, 400)); }

      if (parsed.spillFile) {
        var spilled = JSON.parse(fs.readFileSync(parsed.spillFile, 'utf8'));
        try { fs.unlinkSync(parsed.spillFile); } catch (e2) {}
        parsed = spilled;
      }
      if (!parsed.ok) { throw new Error(parsed.error); }
      return parsed.result;
    });
  }

  /* ------------------------------------------------------------ */
  /* Sandbox guard                                                */
  /* ------------------------------------------------------------ */

  function isWriteFn(fn) {
    /* render_start saves the project to disk before handing it to aerender. */
    if (fn === 'render_start') { return true; }
    if (fn === 'render_status' || fn === 'render_cancel') { return false; }
    if (!writeFns) { return true; }   // fail closed until we know
    return writeFns.indexOf(fn) !== -1;
  }

  function checkGuard(fn) {
    if (!isWriteFn(fn)) { return Promise.resolve(); }
    if (!state.guardEnabled) { return Promise.resolve(); }

    /* new_project / open_project change which project is open, so comparing the
       current path against the sandbox proves nothing about what they'd destroy. */
    if (projectFns.indexOf(fn) !== -1) {
      return Promise.reject(new Error(
        '"' + fn + '" closes the open project, which the sandbox guard cannot make ' +
        'safe by checking a path. Uncheck "Guard writes to sandbox only" in the ' +
        'AE MCP Bridge panel to allow project-level operations.'));
    }

    return callBridge('project_info', {}).then(function (info) {
      if (!state.sandboxPath) {
        throw new Error(
          'Sandbox guard is on but no sandbox project is set. Open the project you ' +
          'want Claude to edit, then click "Use current project as sandbox" in the ' +
          'AE MCP Bridge panel — or turn the guard off there.');
      }
      if (!info.projectPath) {
        throw new Error(
          'Guard refused the edit: the open project has never been saved, so it cannot ' +
          'be matched against the sandbox (' + state.sandboxPath + ').');
      }
      if (path.resolve(info.projectPath) !== path.resolve(state.sandboxPath)) {
        throw new Error(
          'Guard refused the edit. Open project is "' + info.projectPath + '" but the ' +
          'sandbox is "' + state.sandboxPath + '". Reads and renders still work. To edit ' +
          'this project, set it as the sandbox or unlock the guard in the AE MCP Bridge panel.');
      }
    });
  }

  /* ------------------------------------------------------------ */
  /* HTTP server                                                  */
  /* ------------------------------------------------------------ */

  function readBody(req) {
    return new Promise(function (resolve, reject) {
      var chunks = '';
      req.setEncoding('utf8');
      req.on('data', function (d) {
        chunks += d;
        if (chunks.length > 8 * 1024 * 1024) { reject(new Error('Request body too large')); }
      });
      req.on('end', function () { resolve(chunks); });
      req.on('error', reject);
    });
  }

  /* saveFrameToPng returns before After Effects has finished writing the file
     — it appears at size 0 and fills in a few hundred ms later. Don't report
     success until each frame exists and has stopped growing. */
  function waitForFrame(filePath, deadline) {
    return new Promise(function (resolve, reject) {
      var lastSize = -1, stable = 0;
      (function poll() {
        var size = -1;
        try { size = fs.statSync(filePath).size; } catch (e) { size = -1; }
        if (size > 0 && size === lastSize) {
          stable++;
          if (stable >= 2) { return resolve(); }
        } else {
          stable = 0;
        }
        lastSize = size;
        if (Date.now() > deadline) {
          return reject(new Error('After Effects never finished writing ' + filePath +
                                  ' — the render may have failed.'));
        }
        setTimeout(poll, 40);
      })();
    });
  }

  function settleFrames(result) {
    if (!result || !(result.frames instanceof Array)) { return Promise.resolve(result); }
    var deadline = Date.now() + 60000;
    return Promise.all(result.frames.map(function (f) {
      return waitForFrame(f.path, deadline);
    })).then(function () { return result; });
  }

  /* Frames the MCP side never picked up would otherwise pile up forever. */
  function sweepFrames() {
    try {
      var cutoff = Date.now() - 15 * 60 * 1000;
      fs.readdirSync(frameDir).forEach(function (name) {
        if (name.indexOf('ae_frame_') !== 0) { return; }
        var full = path.join(frameDir, name);
        if (fs.statSync(full).mtimeMs < cutoff) { fs.unlinkSync(full); }
      });
    } catch (e) {}
  }

  function respond(res, code, obj) {
    var body = JSON.stringify(obj);
    res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
    res.end(body);
  }

  /* ------------------------------------------------------------ */
  /* aerender jobs                                                */
  /* ------------------------------------------------------------ */

  /* Don't pin a year — use the aerender that ships with the After Effects this
     panel is running in, wherever it is installed; fall back to a scan. */
  function findAerender() {
    if (process.env.AE_RENDER_PATH) { return process.env.AE_RENDER_PATH; }
    try {
      var dir = cepPath(cep.getSystemPath('hostApplication'));
      for (var up = 0; up < 6 && dir && dir !== path.dirname(dir); up++) {
        dir = path.dirname(dir);
        var hit = ['aerender', 'aerender.exe'].map(function (b) { return path.join(dir, b); })
          .filter(function (c) { try { return fs.statSync(c).isFile(); } catch (e) { return false; } });
        if (hit.length) { return hit[0]; }
      }
    } catch (eHost) {}
    var roots = process.platform === 'win32'
      ? [path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Adobe')]
      : ['/Applications', path.join(os.homedir(), 'Applications')];
    if (process.platform !== 'win32') {
      try {
        fs.readdirSync('/Volumes').forEach(function (v) { roots.push(path.join('/Volumes', v, 'Applications')); });
      } catch (eVol) {}
    }
    var found = [];
    roots.forEach(function (root) {
      var entries = [];
      try { entries = fs.readdirSync(root); } catch (e) { return; }
      entries.forEach(function (name) {
        if (!/Adobe After Effects/i.test(name)) { return; }
        /* macOS: <AE folder>/aerender. Windows: <AE folder>\Support Files\aerender.exe */
        [path.join(root, name, 'aerender'), path.join(root, name, 'Support Files', 'aerender.exe')].forEach(function (candidate) {
          try { if (fs.statSync(candidate).isFile()) { found.push(candidate); } } catch (e2) {}
        });
      });
    });
    /* Newest version last alphabetically ("... 2025" < "... 2026"). */
    found.sort();
    return found.length ? found[found.length - 1] : null;
  }

  var AERENDER = findAerender();

  /* Jobs live on disk, and aerender runs detached writing to its own log, so
     reloading the panel (or restarting AE) neither orphans nor forgets them. */
  function saveJobs() {
    try {
      fs.mkdirSync(renderDir, { recursive: true });
      var plain = {};
      Object.keys(renderJobs).forEach(function (id) {
        var j = renderJobs[id];
        plain[id] = { id: j.id, pid: j.pid, comp: j.comp, output: j.output, logPath: j.logPath,
                      status: j.status, startedAt: j.startedAt, finishedAt: j.finishedAt || null,
                      exitCode: j.exitCode, error: j.error || null };
      });
      fs.writeFileSync(jobsPath, JSON.stringify(plain, null, 2));
    } catch (e) { log('Could not save render jobs: ' + e.message, 'warn'); }
  }

  function loadJobs() {
    try {
      var saved = JSON.parse(fs.readFileSync(jobsPath, 'utf8'));
      Object.keys(saved).forEach(function (id) { renderJobs[id] = saved[id]; });
    } catch (e) { /* none yet */ }
  }

  function alive(pid) {
    if (!pid) { return false; }
    try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
  }

  function readLog(job) {
    try { return fs.readFileSync(job.logPath, 'utf8').split('\n'); } catch (e) { return []; }
  }

  /* For a job this panel did not see finish (it was reloaded meanwhile), the
     exit code is gone — the log and the output file say how it went. */
  function refreshJob(job) {
    if (job.status !== 'running' || alive(job.pid)) { return; }
    var text = readLog(job).join('\n');
    var outOk = (function () { try { return fs.statSync(job.output).size > 0; } catch (e) { return false; } })();
    job.status = (/aerender ERROR|error:/i.test(text) || !outOk) ? 'failed' : 'done';
    job.finishedAt = job.finishedAt || Date.now();
    saveJobs();
  }

  function renderStart(args) {
    return callBridge('project_info', {}).then(function (info) {
      if (!info.projectPath) {
        throw new Error('aerender renders the project file on disk, so the project must ' +
                        'be saved first. Call ae_save_project with a path.');
      }
      if (!AERENDER) {
        throw new Error('Could not find the aerender binary. Set AE_RENDER_PATH to it, e.g. ' +
          (process.platform === 'win32'
            ? 'C:\\Program Files\\Adobe\\Adobe After Effects 2026\\Support Files\\aerender.exe'
            : '/Applications/Adobe After Effects 2026/aerender'));
      }
      if (!args.comp) { throw new Error('"comp" is required.'); }
      if (!args.output) { throw new Error('"output" is required.'); }

      var save = args.save === false
        ? Promise.resolve()
        : callBridge('save_project', {});

      return save.then(function () {
        try { fs.mkdirSync(path.dirname(args.output), { recursive: true }); } catch (e) {}
        fs.mkdirSync(renderDir, { recursive: true });

        var argv = ['-project', info.projectPath, '-comp', args.comp, '-output', args.output];
        argv.push('-RStemplate', args.rsTemplate || 'Best Settings');
        argv.push('-OMtemplate', args.omTemplate || 'Lossless');
        if (typeof args.startFrame === 'number') { argv.push('-s', String(args.startFrame)); }
        if (typeof args.endFrame === 'number') { argv.push('-e', String(args.endFrame)); }

        var id = 'r' + Date.now().toString(36);
        var logPath = path.join(renderDir, id + '.log');
        var fd = fs.openSync(logPath, 'a');
        /* windowsHide: a detached process would otherwise open a console window. */
        var proc = childProcess.spawn(AERENDER, argv, { stdio: ['ignore', fd, fd], detached: true, windowsHide: true });
        fs.closeSync(fd);
        proc.unref();

        var job = {
          id: id, pid: proc.pid, comp: args.comp, output: args.output, logPath: logPath,
          status: 'running', startedAt: Date.now(), exitCode: null
        };
        renderJobs[id] = job;
        saveJobs();

        proc.on('error', function (e) {
          job.status = 'failed';
          job.error = e.message;
          saveJobs();
          log('render ' + id + ' failed to start: ' + e.message, 'err');
        });
        proc.on('exit', function (code) {
          job.exitCode = code;
          /* A cancel already set the final word; a SIGTERM exit is not a failure. */
          if (job.status !== 'cancelled') { job.status = code === 0 ? 'done' : 'failed'; }
          job.finishedAt = Date.now();
          saveJobs();
          log('render ' + id + ' ' + job.status + ' (' +
              Math.round((job.finishedAt - job.startedAt) / 1000) + 's)',
              job.status === 'failed' ? 'err' : 'ok');
        });

        log('render ' + id + ' started · ' + args.comp, 'write');
        return { jobId: id, comp: args.comp, output: args.output, projectPath: info.projectPath, aerender: AERENDER };
      });
    });
  }

  function jobView(job) {
    refreshJob(job);
    var lines = readLog(job).map(function (l) { return l.replace(/\r/g, '').trim(); }).filter(Boolean);
    var progress = null;
    lines.forEach(function (l) { var m = l.match(/PROGRESS:\s*(.+)/); if (m) { progress = m[1]; } });
    return {
      jobId: job.id, comp: job.comp, output: job.output, status: job.status,
      progress: progress, exitCode: job.exitCode, error: job.error || null,
      elapsedSeconds: Math.round(((job.finishedAt || Date.now()) - job.startedAt) / 1000),
      outputExists: (function () { try { return fs.statSync(job.output).size > 0; } catch (e) { return false; } })(),
      outputBytes: (function () { try { return fs.statSync(job.output).size; } catch (e) { return null; } })(),
      log: lines.slice(-25)
    };
  }

  function renderStatus(args) {
    if (args.jobId) {
      var j = renderJobs[args.jobId];
      if (!j) { throw new Error('No such render job: ' + args.jobId); }
      return jobView(j);
    }
    return { jobs: Object.keys(renderJobs).map(function (k) { return jobView(renderJobs[k]); }) };
  }

  function renderCancel(args) {
    var j = renderJobs[args.jobId];
    if (!j) { throw new Error('No such render job: ' + args.jobId); }
    if (j.status === 'running' && alive(j.pid)) {
      j.status = 'cancelled';
      j.finishedAt = Date.now();
      saveJobs();
      try { process.kill(j.pid, 'SIGTERM'); } catch (e) {}
    }
    return jobView(j);
  }

  /* Functions handled here in Node rather than passed through to ExtendScript. */
  var NODE_FNS = {
    render_start: renderStart,
    render_status: function (a) { return Promise.resolve(renderStatus(a)); },
    render_cancel: function (a) { return Promise.resolve(renderCancel(a)); }
  };

  function constantTimeEqual(a, b) {
    var ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
    if (ba.length !== bb.length) { return false; }
    try { return crypto.timingSafeEqual(ba, bb); } catch (e) { return false; }
  }

  /* Returns null when the request is acceptable, or a refusal reason. */
  function rejectReason(req) {
    /* A browser always attaches Origin/Referer on a cross-site request. A local
       tool client never does — so their presence means a web page is calling. */
    if (req.headers.origin || req.headers.referer) {
      return 'Requests carrying an Origin or Referer header are refused: this ' +
             'endpoint is not reachable from web pages.';
    }
    var ct = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (req.method === 'POST' && ct !== 'application/json') {
      return 'Content-Type must be application/json.';
    }
    var token = req.headers['x-ae-bridge-token'];
    if (!token || !constantTimeEqual(token, state.token)) {
      return 'Missing or invalid X-AE-Bridge-Token. The token is in ' + statePath + '.';
    }
    return null;
  }

  function handle(req, res) {
    if (req.method === 'GET' && req.url === '/alive') {
      /* Liveness only — reveals nothing about the project or the machine. */
      return respond(res, 200, { alive: true, version: VERSION });
    }

    var refusal = rejectReason(req);
    if (refusal) {
      log('refused: ' + refusal.slice(0, 60), 'err');
      return respond(res, 403, { ok: false, error: refusal });
    }

    if (req.method === 'GET' && req.url === '/health') {
      return respond(res, 200, {
        ok: true, version: VERSION, aerender: AERENDER,
        guardEnabled: state.guardEnabled, sandboxPath: state.sandboxPath,
        reveal: state.reveal, allowRaw: state.allowRaw
      });
    }
    if (req.method !== 'POST' || req.url !== '/call') {
      return respond(res, 404, { ok: false, error: 'POST /call or GET /health' });
    }

    readBody(req).then(function (body) {
      var payload;
      try { payload = JSON.parse(body); }
      catch (e) { return respond(res, 400, { ok: false, error: 'Invalid JSON body' }); }

      var fn = payload.fn;
      var args = payload.args || {};

      /* AE's Folder.temp is sandboxed per-app; frames have to land somewhere
         the MCP process can actually open. */
      if (fn === 'render_frame' && !args.outDir) {
        try { fs.mkdirSync(frameDir, { recursive: true }); } catch (e) {}
        sweepFrames();
        args.outDir = frameDir;
      }
      callCount++;
      log(fn + (args.comp ? ' · ' + args.comp : ''), isWriteFn(fn) ? 'write' : 'read');

      if (RAW_FNS.indexOf(fn) !== -1 && !state.allowRaw) {
        log(fn + ' → refused (raw scripting off)', 'err');
        return respond(res, 200, { ok: false, error:
          '"' + fn + '" is switched off in the AE MCP Bridge panel ("Allow raw ExtendScript and ' +
          'menu commands"). Use the dedicated tools, or ask the user to switch it on.' });
      }
      if (!NODE_FNS[fn]) { args.__reveal = state.reveal; }

      var projectBefore = null;
      checkGuard(fn)
        .then(function () {
          /* Raw code can open or close projects behind the guard's back —
             at least make sure nobody is left unaware that it happened. */
          if (RAW_FNS.indexOf(fn) === -1 || !state.guardEnabled) { return; }
          return callBridge('project_info', {}).then(function (i) { projectBefore = i.projectPath; });
        })
        .then(function () {
          if (NODE_FNS[fn]) { return NODE_FNS[fn](args); }
          return callBridge(fn, args);
        })
        .then(function (result) {
          if (projectBefore === null) { return result; }
          return callBridge('project_info', {}).then(function (i) {
            if (i.projectPath !== projectBefore) {
              log('WARNING: ' + fn + ' switched project to ' + i.projectPath, 'err');
              return { result: result, warning: 'This call changed the open project from "' +
                projectBefore + '" to "' + i.projectPath + '". The sandbox guard no longer protects it.' };
            }
            return result;
          });
        })
        .then(function (result) {
          return fn === 'render_frame' ? settleFrames(result) : result;
        })
        .then(function (result) { respond(res, 200, { ok: true, result: result }); })
        .catch(function (err) {
          log(fn + ' → ' + err.message, 'err');
          respond(res, 200, { ok: false, error: err.message });
        });
    }).catch(function (err) {
      respond(res, 400, { ok: false, error: err.message });
    });
  }

  function startServer() {
    if (server) { try { server.close(); } catch (e) {} }
    server = http.createServer(handle);
    server.on('error', function (err) {
      if (err.code === 'EADDRINUSE') {
        setStatus('Port ' + state.port + ' is busy', false);
        log('Port ' + state.port + ' already in use. Another panel instance? ' +
            'Change the port and click Restart.', 'err');
      } else {
        setStatus('Server error', false);
        log(err.message, 'err');
      }
    });
    server.listen(state.port, '127.0.0.1', function () {
      setStatus('Listening on 127.0.0.1:' + state.port, true);
      log('Bridge up. Authenticated requests only.', 'ok');
      log('Token stored in ' + statePath, 'warn');
    });
  }

  /* ------------------------------------------------------------ */
  /* UI                                                           */
  /* ------------------------------------------------------------ */

  function $(id) { return document.getElementById(id); }

  function setStatus(text, good) {
    $('status').textContent = text;
    $('dot').className = 'dot ' + (good ? 'on' : 'off');
  }

  function log(msg, kind) {
    var el = document.createElement('div');
    el.className = 'line ' + (kind || '');
    var t = new Date();
    var ts = document.createElement('span');
    ts.className = 't';
    ts.textContent = String(t.getHours()).padStart(2, '0') + ':' +
      String(t.getMinutes()).padStart(2, '0') + ':' + String(t.getSeconds()).padStart(2, '0');
    var m = document.createElement('span');
    m.className = 'm';
    m.textContent = msg;
    el.appendChild(ts);
    el.appendChild(m);
    var box = $('log');
    /* Only follow new lines if the user hasn't scrolled up to read. */
    var atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 24;
    box.appendChild(el);
    while (box.childNodes.length > 300) { box.removeChild(box.firstChild); }
    if (atBottom) { box.scrollTop = box.scrollHeight; }
    $('count').textContent = callCount + (callCount === 1 ? ' call' : ' calls');
  }

  function renderGuard() {
    $('guardToggle').checked = state.guardEnabled;
    $('sandboxPath').textContent = state.sandboxPath || '(none set)';
    $('sandboxPath').title = state.sandboxPath || '';
    $('guardState').className = 'guard ' + (state.guardEnabled ? 'locked' : 'unlocked');
    $('guardState').firstElementChild.textContent = state.guardEnabled
      ? 'Guard on · only the sandbox project can be edited'
      : 'Guard off · the agent can edit any open project';
    $('guardState').title = $('guardState').firstElementChild.textContent;
  }

  function refreshProject() {
    callBridge('project_info', {}).then(function (info) {
      $('project').textContent = info.projectName +
        (info.activeComp ? '  ·  ' + info.activeComp : '');
      $('project').title = (info.projectPath || '') + (info.activeComp ? '\n' + info.activeComp : '');
      window.__currentProjectPath = info.projectPath;
      $('setSandbox').disabled = !info.projectPath;
    }).catch(function (e) {
      $('project').textContent = '—';
      log('Could not read project: ' + e.message, 'err');
    });
  }

  /* Match After Effects' interface brightness (Preferences ▸ Appearance). */
  function applySkin() {
    try {
      var env = JSON.parse(cep.getHostEnvironment());
      var c = env.appSkinInfo.panelBackgroundColor.color;
      var r = Math.round(c.red), g = Math.round(c.green), b = Math.round(c.blue);
      var light = (r + g + b) / 3 > 128;
      var shift = function (d) {
        return 'rgb(' + [r, g, b].map(function (v) { return Math.max(0, Math.min(255, v + d)); }).join(',') + ')';
      };
      var root = document.documentElement.style;
      root.setProperty('--bg', 'rgb(' + r + ',' + g + ',' + b + ')');
      root.setProperty('--raised', shift(light ? -14 : 10));
      root.setProperty('--sunken', shift(light ? 12 : -8));
      root.setProperty('--line', shift(light ? -34 : 22));
      root.setProperty('--fg', light ? '#1e1e1e' : '#d4d4d4');
      root.setProperty('--dim', light ? '#555' : '#8c8c8c');
      root.setProperty('--faint', light ? '#777' : '#6a6a6a');
    } catch (e) { /* keep the dark defaults */ }
  }

  function boot() {
    applySkin();
    try { cep.addEventListener('com.adobe.csxs.events.ThemeColorChanged', applySkin); } catch (eSkin) {}
    try {
      $('server').open = localStorage.getItem('aemcp.serverOpen') === '1';
      $('server').addEventListener('toggle', function () {
        try { localStorage.setItem('aemcp.serverOpen', $('server').open ? '1' : '0'); } catch (e) {}
      });
    } catch (eLs) {}
    loadState();
    loadJobs();
    $('port').value = state.port;
    $('revealToggle').checked = state.reveal;
    $('rawToggle').checked = state.allowRaw;
    $('version').textContent = 'v' + VERSION;
    renderGuard();

    $('revealToggle').addEventListener('change', function () {
      state.reveal = $('revealToggle').checked;
      saveState();
      log(state.reveal ? 'Edits will show in the timeline.' : 'Edits will no longer move selection or playhead.', 'ok');
    });
    $('rawToggle').addEventListener('change', function () {
      state.allowRaw = $('rawToggle').checked;
      saveState();
      log(state.allowRaw ? 'Raw ExtendScript and menu commands allowed.' : 'Raw ExtendScript and menu commands OFF.',
          state.allowRaw ? 'warn' : 'ok');
    });

    callBridge('write_fns', {}).then(function (list) {
      writeFns = list;
    }).catch(function (e) {
      log('Could not load write-op list, failing closed: ' + e.message, 'warn');
    });
    callBridge('project_fns', {}).then(function (list) {
      projectFns = list;
    }).catch(function (e) { projectFns = ['new_project', 'open_project']; });

    startServer();
    refreshProject();
    setInterval(refreshProject, 3000);

    $('guardToggle').addEventListener('change', function () {
      state.guardEnabled = $('guardToggle').checked;
      saveState();
      renderGuard();
      log(state.guardEnabled ? 'Guard locked.' : 'Guard UNLOCKED by you.',
          state.guardEnabled ? 'ok' : 'warn');
    });

    $('setSandbox').addEventListener('click', function () {
      if (!window.__currentProjectPath) { return; }
      state.sandboxPath = window.__currentProjectPath;
      saveState();
      renderGuard();
      log('Sandbox set to ' + state.sandboxPath, 'ok');
    });

    $('restart').addEventListener('click', function () {
      var p = parseInt($('port').value, 10);
      if (p > 0 && p < 65536) { state.port = p; saveState(); }
      startServer();
    });

    $('clear').addEventListener('click', function () { $('log').textContent = ''; });

    /* Dev affordance: pull bridge.jsx and this file back off disk without
       toggling the panel in the Extensions menu. */
    $('reload').addEventListener('click', function () {
      var jsx = path.join(cepPath(cep.getSystemPath('extension')), 'jsx', 'bridge.jsx');
      log('Reloading ' + jsx, 'warn');
      evalScript('$.evalFile(' + JSON.stringify(jsx) + '); "ok"').then(function (r) {
        if (server) { try { server.close(); } catch (e) {} }
        window.location.reload();
      });
    });

    window.addEventListener('beforeunload', function () {
      if (server) { try { server.close(); } catch (e) {} }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else { boot(); }
})();
