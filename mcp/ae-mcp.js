#!/usr/bin/env node
/*
 * ae-mcp.js — MCP server exposing After Effects to Claude Code.
 *
 * Zero dependencies. Speaks newline-delimited JSON-RPC on stdio and forwards
 * every tool call to the AE MCP Bridge panel running inside After Effects.
 */

'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const PORT = parseInt(process.env.AE_BRIDGE_PORT || '7788', 10);
const STATE_PATH = path.join(os.homedir(), '.ae-mcp-bridge.json');

/* The panel generates a shared secret on first run and stores it here. Without
   it the bridge refuses every call — which is what stops a web page you happen
   to be visiting from driving After Effects. */
function bridgeToken() {
  if (process.env.AE_BRIDGE_TOKEN) { return process.env.AE_BRIDGE_TOKEN; }
  try {
    const t = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')).token;
    if (t) { return t; }
  } catch (e) { /* fall through */ }
  throw new Error(
    'No bridge token found. Open the AE MCP Bridge panel in After Effects once — ' +
    'it writes a token to ' + STATE_PATH + ' on first run. ' +
    'You can also set AE_BRIDGE_TOKEN.');
}
const HOST = '127.0.0.1';
const MAX_IMAGE_PX = parseInt(process.env.AE_BRIDGE_MAX_PX || '1024', 10);
const SERVER_NAME = 'after-effects';
const SERVER_VERSION = '0.1.0';

/* ------------------------------------------------------------------ */
/* Bridge transport                                                    */
/* ------------------------------------------------------------------ */

function bridge(fn, args) {
  return new Promise((resolve, reject) => {
    let token;
    try { token = bridgeToken(); } catch (e) { return reject(e); }
    const body = JSON.stringify({ fn, args: args || {} });
    const req = http.request(
      { host: HOST, port: PORT, path: '/call', method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'X-AE-Bridge-Token': token
        },
        timeout: 120000 },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (d) => { data += d; });
        res.on('end', () => {
          let parsed;
          try { parsed = JSON.parse(data); }
          catch (e) { return reject(new Error('Bridge sent malformed JSON: ' + data.slice(0, 300))); }
          if (!parsed.ok) { return reject(new Error(parsed.error)); }
          resolve(parsed.result);
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('After Effects did not respond within 120s. It is probably busy ' +
                       'rendering or showing a modal dialog — check the app.'));
    });
    req.on('error', (e) => {
      if (e.code === 'ECONNREFUSED') {
        reject(new Error(
          'Cannot reach the AE MCP Bridge on ' + HOST + ':' + PORT + '. Open After Effects ' +
          'and show the panel: Window ▸ Extensions ▸ AE MCP Bridge.'));
      } else { reject(e); }
    });
    req.write(body);
    req.end();
  });
}

/* ------------------------------------------------------------------ */
/* Images                                                              */
/* ------------------------------------------------------------------ */

/* AE writes a full-size PNG; sips (built into macOS) fits it into a box that
   is sane to send through the model. */
/* After Effects returns from saveFrameToPng before the bytes are on disk: the
   file shows up at size 0 and fills in a few hundred ms later. The panel waits
   too, but this side must not depend on the panel being the matching build. */
function waitForStableFile(filePath, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 60000);
  let last = -1, stable = 0;
  for (;;) {
    let size = -1;
    try { size = fs.statSync(filePath).size; } catch (e) { size = -1; }
    if (size > 0 && size === last) {
      if (++stable >= 2) { return true; }
    } else {
      stable = 0;
    }
    last = size;
    if (Date.now() > deadline) { return false; }
    /* Synchronous sleep — this server handles one call at a time. */
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40);
  }
}

function pngToBase64(srcPath) {
  if (!waitForStableFile(srcPath)) {
    throw new Error('After Effects never finished writing ' + srcPath);
  }

  let usePath = srcPath;
  /* Scale in place beside the source: the OS temp dir isn't writable from
     every context this server gets spawned in. */
  const scaled = srcPath.replace(/\.png$/i, '') + '_scaled.png';
  try {
    execFileSync('sips', ['-Z', String(MAX_IMAGE_PX), srcPath, '--out', scaled],
                 { stdio: 'ignore' });
    if (fs.existsSync(scaled)) { usePath = scaled; }
  } catch (e) { /* sips missing or failed — send the original */ }

  const buf = fs.readFileSync(usePath);
  try { if (usePath !== srcPath) fs.unlinkSync(usePath); } catch (e) {}
  try { fs.unlinkSync(srcPath); } catch (e) {}
  return buf.toString('base64');
}

/* ------------------------------------------------------------------ */
/* ffmpeg                                                              */
/* ------------------------------------------------------------------ */

let ffmpegPath = null;
function findFfmpeg() {
  if (ffmpegPath !== null) { return ffmpegPath; }
  const candidates = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'];
  for (const c of candidates) {
    if (fs.existsSync(c)) { return (ffmpegPath = c); }
  }
  try {
    ffmpegPath = execFileSync('which', ['ffmpeg'], { encoding: 'utf8' }).trim() || false;
  } catch (e) { ffmpegPath = false; }
  return ffmpegPath;
}

/* ------------------------------------------------------------------ */
/* Tools                                                               */
/* ------------------------------------------------------------------ */

const S = {
  comp: { type: 'string', description: 'Composition name. Omit to use the comp open in the timeline.' },
  layer: { type: ['string', 'number'], description: 'Layer name, or its 1-based index. Omit to use the single selected layer.' },
  path: { type: 'array', items: { type: 'string' },
          description: 'Property path from the layer, e.g. ["Transform","Position"] or ["Effects","Gaussian Blur","Blurriness"]. Names or matchNames both work.' }
};

const TOOLS = [
  {
    name: 'ae_project_info',
    description: 'Overview of the open After Effects project: file path, every composition with its size, duration, frame rate and layer count, plus which comp is active and where the playhead sits. Cheap — call this first to orient.',
    inputSchema: { type: 'object', properties: {} },
    fn: 'project_info'
  },
  {
    name: 'ae_comp_tree',
    description: 'The layer stack of one composition: every layer with its kind, timing, parenting, transform values, applied effects, and — importantly — animatedProperties, which lists every keyframed or expression-driven property anywhere in the layer, including text animators and shape trim paths. Trust isAnimated over the transform summary. This is the main "read the comp" tool.',
    inputSchema: {
      type: 'object',
      properties: {
        comp: S.comp,
        transforms: { type: 'boolean', description: 'Include transform summaries. Default true.' },
        effects: { type: 'boolean', description: 'Include the effect list per layer. Default true.' },
        animation: { type: 'boolean', description: 'Scan the full property tree for animation. Default true. Turn off only for a fast structural read.' }
      }
    },
    fn: 'comp_tree'
  },
  {
    name: 'ae_layer_detail',
    description: 'Deep read of one layer: full property tree with values, every keyframe (time, value, interpolation, ease influence) and every expression. Pass "path" to drill into one group instead of the whole layer.',
    inputSchema: {
      type: 'object',
      properties: {
        comp: S.comp, layer: S.layer,
        path: { type: 'array', items: { type: 'string' }, description: 'Optional: only read this property or group.' },
        maxDepth: { type: 'number', description: 'Recursion depth into property groups. Default 4.' },
        includeDefaults: { type: 'boolean', description: 'Include untouched properties. Default false — keeps output small.' }
      }
    },
    fn: 'layer_detail'
  },
  {
    name: 'ae_selection',
    description: 'What the user has selected right now: active comp, playhead time, selected layers and selected properties. Use this when they say "this layer" or "that keyframe".',
    inputSchema: { type: 'object', properties: {} },
    fn: 'selection'
  },
  {
    name: 'ae_render_frame',
    description: 'Render composition frames to PNG and look at them. Pass nothing for the current playhead frame, "time" for one moment, "times" for specific moments, or "frames" for an evenly spaced contact sheet across the work area to judge motion and timing. Use this to check your own work after editing.',
    inputSchema: {
      type: 'object',
      properties: {
        comp: S.comp,
        time: { type: 'number', description: 'Seconds. One frame at this time.' },
        times: { type: 'array', items: { type: 'number' }, description: 'Seconds. One frame per entry.' },
        frames: { type: 'number', description: 'Render this many evenly spaced frames across the work area (2-12 is sensible).' },
        start: { type: 'number', description: 'With "frames": start of the sampled range in seconds. Defaults to work area start.' },
        duration: { type: 'number', description: 'With "frames": length of the sampled range in seconds. Defaults to work area duration.' },
        downscale: { type: 'number', description: 'Render at 1/N comp resolution. Default 2 (half). Use 1 for detail, 4 for speed.' }
      }
    },
    fn: 'render_frame',
    image: true
  },
  {
    name: 'ae_set_property',
    description: 'Set one property value. Without "time" it sets the static value (and refuses if the property is already animated). With "time" it writes a keyframe at that moment. WRITE.',
    inputSchema: {
      type: 'object',
      properties: {
        comp: S.comp, layer: S.layer, path: S.path,
        value: { description: 'Number, [x,y], [x,y,z], [r,g,b,a] with channels 0-1, or a string / {text,fontSize,font} for text.' },
        time: { type: 'number', description: 'Seconds. Omit for a static value.' }
      },
      required: ['path', 'value']
    },
    fn: 'set_property'
  },
  {
    name: 'ae_add_keyframes',
    description: 'Write a run of keyframes on one property in a single undo step, with optional easing. WRITE.',
    inputSchema: {
      type: 'object',
      properties: {
        comp: S.comp, layer: S.layer, path: S.path,
        keys: {
          type: 'array',
          description: 'Keyframes in time order.',
          items: {
            type: 'object',
            properties: {
              time: { type: 'number', description: 'Seconds.' },
              value: { description: 'Same shape the property takes.' },
              interp: { type: 'string', enum: ['linear', 'hold', 'bezier'], description: 'Interpolation at this key.' },
              ease: { description: 'Bezier ease influence 0.1-100 — a number for both sides, or {in, out}. 75 reads as a soft ease.' }
            },
            required: ['time', 'value']
          }
        },
        replace: { type: 'boolean', description: 'Delete existing keyframes on this property first. Default false.' }
      },
      required: ['path', 'keys']
    },
    fn: 'add_keyframes'
  },
  {
    name: 'ae_set_expression',
    description: 'Attach an expression to a property. After Effects validates it — a syntax error is reported back and the expression is not left in place. WRITE.',
    inputSchema: {
      type: 'object',
      properties: { comp: S.comp, layer: S.layer, path: S.path,
                    expression: { type: 'string', description: 'JavaScript expression, e.g. wiggle(2, 30).' } },
      required: ['path', 'expression']
    },
    fn: 'set_expression'
  },
  {
    name: 'ae_clear_expression',
    description: 'Remove the expression from a property, leaving its last value. WRITE.',
    inputSchema: {
      type: 'object',
      properties: { comp: S.comp, layer: S.layer, path: S.path },
      required: ['path']
    },
    fn: 'clear_expression'
  },
  {
    name: 'ae_apply_effect',
    description: 'Apply an effect to a layer and optionally set its parameters. Returns the effect\'s parameter names so you can set the rest. WRITE.',
    inputSchema: {
      type: 'object',
      properties: {
        comp: S.comp, layer: S.layer,
        effect: { type: 'string', description: 'Effect name as shown in the Effects panel ("Gaussian Blur") or its matchName ("ADBE Gaussian Blur 2").' },
        name: { type: 'string', description: 'Rename the applied effect instance.' },
        params: { type: 'object', description: 'Parameter name to value, e.g. {"Blurriness": 20}.' }
      },
      required: ['effect']
    },
    fn: 'apply_effect'
  },
  {
    name: 'ae_create_layer',
    description: 'Add a layer to a composition. WRITE.',
    inputSchema: {
      type: 'object',
      properties: {
        comp: S.comp,
        kind: { type: 'string', enum: ['solid', 'text', 'shape', 'null', 'adjustment', 'camera', 'light', 'precomp', 'footage'] },
        options: {
          type: 'object',
          description: 'name, text, color [r,g,b] 0-1, width, height, duration, startTime, inPoint, outPoint, index (stack position), position [x,y], threeD, source (comp or footage item name, for precomp and footage).'
        }
      },
      required: ['kind']
    },
    fn: 'create_layer'
  },
  {
    name: 'ae_delete_layer',
    description: 'Delete a layer. Undoable as one step. WRITE.',
    inputSchema: {
      type: 'object',
      properties: { comp: S.comp, layer: S.layer },
      required: ['layer']
    },
    fn: 'delete_layer'
  },
  {
    name: 'ae_set_layer_props',
    description: 'Set layer-level attributes: name, enabled, solo, shy, locked, threeDLayer, inPoint, outPoint, startTime, stretch, parent (layer name/index or null), index (stack position). WRITE.',
    inputSchema: {
      type: 'object',
      properties: { comp: S.comp, layer: S.layer,
                    props: { type: 'object', description: 'Attribute name to value.' } },
      required: ['props']
    },
    fn: 'set_layer_props'
  },
  {
    name: 'ae_run_jsx',
    description: 'Escape hatch: evaluate arbitrary ExtendScript in After Effects and return the result. ES3 only — no let/const/arrow functions. Wrapped in one undo group. Use when no other tool covers what is needed. WRITE.',
    inputSchema: {
      type: 'object',
      properties: { code: { type: 'string', description: 'ExtendScript. The last expression is returned.' } },
      required: ['code']
    },
    fn: 'run_jsx'
  }
];

TOOLS.push(
  {
    name: 'ae_find_animation',
    description: 'Find everything that actually animates on a layer or across a comp — keyframes and expressions anywhere in the property tree, not just Transform. Text animators, shape trim paths, mask paths and effect parameters all show up here. Use this before concluding a layer is not animated: a layer with an empty Transform can still be fully animated by a text animator.',
    inputSchema: {
      type: 'object',
      properties: { comp: S.comp, layer: S.layer }
    },
    fn: 'find_animation'
  },
  {
    name: 'ae_list_items',
    description: 'Everything in the project panel: comps, imported footage, solids, folders — with ids, dimensions, durations and source file paths. Use before referencing a source by name.',
    inputSchema: { type: 'object', properties: {
      kind: { type: 'string', enum: ['comp', 'footage', 'solid', 'folder', 'placeholder'], description: 'Filter to one kind.' } } },
    fn: 'list_items'
  },
  {
    name: 'ae_import_file',
    description: 'Import a video, image, audio, image sequence, PSD or AI file into the project. Returns the created item so you can add it to a comp with ae_create_layer (kind "footage"). WRITE.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the file.' },
        sequence: { type: 'boolean', description: 'Treat a numbered still as an image sequence.' },
        importAs: { type: 'string', enum: ['footage', 'comp', 'comp_cropped', 'project'],
                    description: 'For layered PSD/AI files: import flattened, as a comp, or as a comp with cropped layers.' },
        name: { type: 'string', description: 'Rename the imported item.' },
        folder: { type: 'string', description: 'Move it into this project folder.' }
      },
      required: ['path']
    },
    fn: 'import_file'
  },
  {
    name: 'ae_create_comp',
    description: 'Create a composition and open it in the timeline. WRITE.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        width: { type: 'number', description: 'Pixels. Default 1920.' },
        height: { type: 'number', description: 'Pixels. Default 1080.' },
        frameRate: { type: 'number', description: 'Default 30.' },
        duration: { type: 'number', description: 'Seconds. Default 10.' },
        pixelAspect: { type: 'number', description: 'Default 1.' },
        bgColor: { type: 'array', items: { type: 'number' }, description: '[r,g,b] channels 0-1.' },
        folder: { type: 'string', description: 'Project folder to place it in.' },
        open: { type: 'boolean', description: 'Open in the viewer. Default true.' }
      },
      required: ['name']
    },
    fn: 'create_comp'
  },
  {
    name: 'ae_set_comp_settings',
    description: 'Change composition settings: name, width, height, frameRate, duration, bgColor, workAreaStart, workAreaDuration, resolutionFactor. WRITE.',
    inputSchema: {
      type: 'object',
      properties: { comp: S.comp, settings: { type: 'object', description: 'Setting name to value.' } },
      required: ['settings']
    },
    fn: 'set_comp_settings'
  },
  {
    name: 'ae_duplicate_comp',
    description: 'Duplicate a composition — the fast way to make 9x16 / 1x1 / 16x9 variants of a finished master. WRITE.',
    inputSchema: {
      type: 'object',
      properties: { comp: S.comp, name: { type: 'string', description: 'Name for the duplicate.' } }
    },
    fn: 'duplicate_comp'
  },
  {
    name: 'ae_precompose',
    description: 'Precompose layers into a nested composition. WRITE.',
    inputSchema: {
      type: 'object',
      properties: {
        comp: S.comp,
        layers: { type: 'array', items: { type: ['string', 'number'] }, description: 'Layer names or indices. Omit to use the current selection.' },
        name: { type: 'string', description: 'Name for the new precomp.' },
        moveAllAttributes: { type: 'boolean', description: 'Move transforms and effects into the precomp. Default true.' }
      }
    },
    fn: 'precompose'
  },
  {
    name: 'ae_delete_item',
    description: 'Delete a comp, footage item or folder from the project panel. WRITE.',
    inputSchema: {
      type: 'object',
      properties: { item: { type: ['string', 'number'], description: 'Item name or id.' } },
      required: ['item']
    },
    fn: 'delete_item'
  },
  {
    name: 'ae_new_project',
    description: 'Close the open project and start an empty one. Requires the sandbox guard to be OFF. You must say what happens to unsaved work: pass saveFirst (true, or a path) or discardUnsavedChanges: true — otherwise it refuses rather than risk a modal dialog or silent data loss. WRITE.',
    inputSchema: {
      type: 'object',
      properties: {
        savePath: { type: 'string', description: 'Save the new empty project here immediately. Strongly recommended — renders need a project file on disk.' },
        saveFirst: { description: 'true to save the current project in place, or a path to save it as.' },
        discardUnsavedChanges: { type: 'boolean', description: 'Explicitly throw away unsaved changes in the current project.' }
      }
    },
    fn: 'new_project'
  },
  {
    name: 'ae_open_project',
    description: 'Open an existing .aep, closing the current one. Same unsaved-work rules as ae_new_project. Requires the sandbox guard to be OFF. WRITE.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the .aep file.' },
        saveFirst: { description: 'true to save the current project in place, or a path to save it as.' },
        discardUnsavedChanges: { type: 'boolean' }
      },
      required: ['path']
    },
    fn: 'open_project'
  },
  {
    name: 'ae_save_project',
    description: 'Save the project. Pass a path to save-as. WRITE — this writes the .aep to disk.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Absolute path. Omit to save in place.' } }
    },
    fn: 'save_project'
  },
  {
    name: 'ae_review_motion',
    description: 'Watch a stretch of animation actually move. Samples frames across a time range, stitches them into an MP4 you can open, and returns a single contact sheet image so the timing can be judged as a whole rather than frame by frame. Use this after animating anything — it is the only way to evaluate whether easing and timing feel right, as opposed to merely confirming keyframe values.',
    inputSchema: {
      type: 'object',
      properties: {
        comp: S.comp,
        start: { type: 'number', description: 'Seconds. Default: work area start.' },
        duration: { type: 'number', description: 'Seconds to cover. Default: work area duration.' },
        frames: { type: 'number', description: 'How many samples across the range. Default 16, max 48. More frames = finer timing detail, slower.' },
        fps: { type: 'number', description: 'Playback rate of the MP4. Default 12.' },
        downscale: { type: 'number', description: 'Render at 1/N comp resolution. Default 4.' },
        columns: { type: 'number', description: 'Contact sheet columns. Default 6.' }
      }
    },
    custom: 'review_motion'
  },
  {
    name: 'ae_render_video',
    description: 'Start a full-quality render with aerender, as a background job that does not block After Effects. Saves the project to disk first, because aerender reads the .aep from disk. Returns a jobId — poll it with ae_render_status. WRITE.',
    inputSchema: {
      type: 'object',
      properties: {
        comp: { type: 'string', description: 'Composition to render.' },
        output: { type: 'string', description: 'Absolute output path, e.g. /path/out.mov' },
        rsTemplate: { type: 'string', description: 'Render settings template. Default "Best Settings".' },
        omTemplate: { type: 'string', description: 'Output module template. Default "Lossless".' },
        startFrame: { type: 'number' },
        endFrame: { type: 'number' },
        save: { type: 'boolean', description: 'Save the project first. Default true — turn off only if it is already saved and unchanged.' }
      },
      required: ['comp', 'output']
    },
    fn: 'render_start'
  },
  {
    name: 'ae_render_status',
    description: 'Check background render jobs: status, progress, elapsed time, output size, and the tail of the aerender log. Omit jobId to list every job.',
    inputSchema: { type: 'object', properties: { jobId: { type: 'string' } } },
    fn: 'render_status'
  },
  {
    name: 'ae_render_cancel',
    description: 'Stop a running render job.',
    inputSchema: { type: 'object', properties: { jobId: { type: 'string' } }, required: ['jobId'] },
    fn: 'render_cancel'
  }
);

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/* ------------------------------------------------------------------ */
/* Tool execution                                                      */
/* ------------------------------------------------------------------ */

function run(bin, argv) {
  return execFileSync(bin, argv, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
}

/* Sample a stretch of animation, stitch it into something watchable, and hand
   back one contact sheet instead of N separate images. */
async function reviewMotion(args) {
  const ffmpeg = findFfmpeg();
  const count = Math.min(Math.max(parseInt(args.frames || 16, 10), 2), 48);
  const fps = args.fps || 12;
  const cols = Math.max(1, parseInt(args.columns || 6, 10));

  const req = { comp: args.comp, frames: count, downscale: args.downscale || 4 };
  if (typeof args.start === 'number') { req.start = args.start; }
  if (typeof args.duration === 'number') { req.duration = args.duration; }

  const result = await bridge('render_frame', req);

  const work = path.join(os.homedir(), '.ae-mcp-bridge', 'review_' + Date.now());
  fs.mkdirSync(work, { recursive: true });
  const kept = [];
  result.frames.forEach((f, i) => {
    if (!waitForStableFile(f.path)) { return; }
    const dst = path.join(work, String(i + 1).padStart(4, '0') + '.png');
    fs.copyFileSync(f.path, dst);
    try { fs.unlinkSync(f.path); } catch (e) {}
    kept.push({ ...f, file: dst });
  });
  if (!kept.length) { throw new Error('No frames were rendered.'); }

  const meta = {
    comp: result.comp,
    range: kept[0].time + 's → ' + kept[kept.length - 1].time + 's',
    sampled: kept.length + ' frames at ' + result.renderedWidth + '×' + result.renderedHeight,
    reading_order: 'left to right, top to bottom, ' + cols + ' per row',
    times: kept.map((k) => k.time)
  };

  const content = [];
  if (!ffmpeg) {
    meta.note = 'ffmpeg not found — returning frames individually instead of a contact sheet.';
    content.push({ type: 'text', text: JSON.stringify(meta, null, 2) });
    kept.forEach((k) => {
      try { content.push({ type: 'image', data: pngToBase64(k.file), mimeType: 'image/png' }); }
      catch (e) {}
    });
    return { content };
  }

  const pattern = path.join(work, '%04d.png');
  const rows = Math.ceil(kept.length / cols);
  const tileW = Math.max(120, Math.floor(1200 / cols));
  const sheet = path.join(work, 'contact_sheet.png');
  const video = path.join(work, 'motion.mp4');

  try {
    run(ffmpeg, ['-y', '-framerate', '1', '-i', pattern,
      '-vf', `scale=${tileW}:-2,tile=${cols}x${rows}`, '-frames:v', '1', sheet]);
  } catch (e) {
    throw new Error('Contact sheet failed: ' + (e.stderr || e.message).toString().slice(-400));
  }

  try {
    run(ffmpeg, ['-y', '-framerate', String(fps), '-i', pattern,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', video]);
    meta.video = video;
    meta.video_note = 'Open this to watch the sampled motion play back at ' + fps + 'fps.';
  } catch (e) {
    meta.video = null;
    meta.video_note = 'MP4 encode failed: ' + (e.stderr || e.message).toString().slice(-200);
  }

  content.push({ type: 'text', text: JSON.stringify(meta, null, 2) });
  content.push({ type: 'image', data: fs.readFileSync(sheet).toString('base64'), mimeType: 'image/png' });
  return { content };
}

async function runTool(name, args) {
  const tool = BY_NAME.get(name);
  if (!tool) { throw new Error('Unknown tool: ' + name); }

  if (tool.custom === 'review_motion') { return reviewMotion(args || {}); }

  const result = await bridge(tool.fn, args || {});

  if (tool.image && result && Array.isArray(result.frames)) {
    const content = [];
    const meta = {
      comp: result.comp,
      comp_size: result.compWidth + '×' + result.compHeight,
      rendered_at: result.renderedWidth + '×' + result.renderedHeight +
                   ' (1/' + result.downscale + ' resolution)',
      frames: result.frames.map((f) => ({ time: f.time, frame: f.frame }))
    };
    content.push({ type: 'text', text: JSON.stringify(meta, null, 2) });
    for (const f of result.frames) {
      try {
        content.push({ type: 'image', data: pngToBase64(f.path), mimeType: 'image/png' });
      } catch (e) {
        content.push({ type: 'text', text: 'Could not read frame at ' + f.time + 's: ' + e.message });
      }
    }
    return { content };
  }

  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}

/* ------------------------------------------------------------------ */
/* JSON-RPC over stdio                                                 */
/* ------------------------------------------------------------------ */

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function reply(id, result) { send({ jsonrpc: '2.0', id, result }); }
function fail(id, code, message) { send({ jsonrpc: '2.0', id, error: { code, message } }); }

async function handleMessage(msg) {
  const { id, method, params } = msg;

  if (method === 'initialize') {
    return reply(id, {
      protocolVersion: (params && params.protocolVersion) || '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION }
    });
  }
  if (method === 'notifications/initialized' || method === 'notifications/cancelled') { return; }
  if (method === 'ping') { return reply(id, {}); }

  if (method === 'tools/list') {
    return reply(id, {
      tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))
    });
  }

  if (method === 'tools/call') {
    try {
      const out = await runTool(params.name, params.arguments);
      return reply(id, out);
    } catch (e) {
      return reply(id, { content: [{ type: 'text', text: 'Error: ' + e.message }], isError: true });
    }
  }

  if (method === 'resources/list') { return reply(id, { resources: [] }); }
  if (method === 'prompts/list') { return reply(id, { prompts: [] }); }

  if (id !== undefined) { fail(id, -32601, 'Method not found: ' + method); }
}

let buffer = '';
let pending = 0;
let stdinClosed = false;

function maybeExit() {
  if (stdinClosed && pending === 0) { process.exit(0); }
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) { continue; }
    let msg;
    try { msg = JSON.parse(line); }
    catch (e) { continue; }
    pending++;
    Promise.resolve(handleMessage(msg))
      .catch((e) => {
        if (msg && msg.id !== undefined) { fail(msg.id, -32603, e.message); }
      })
      .then(() => { pending--; maybeExit(); });
  }
});
/* Don't tear down while a render or edit is still in flight. */
process.stdin.on('end', () => { stdinClosed = true; maybeExit(); });
