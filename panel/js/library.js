(function () {
  'use strict';
  var fs = require('fs'), path = require('path'), os = require('os'), http = require('http');
  var extension = decodeURI(window.__adobe_cep__.getSystemPath('extension')).replace(/^file:\/\//, '');
  if (/^\/[A-Za-z]:/.test(extension)) extension = extension.slice(1);
  var core = require(path.join(extension, 'js', 'library-core.js'));
  var $ = function (id) { return document.getElementById(id); };
  var library = null, selected = null, category = 'scene', busy = false;
  function notice(message, error) { $('libraryNotice').textContent = message; $('libraryNotice').className = error ? 'library-error' : ''; }
  function fileUrl(file) { return require('url').pathToFileURL(file).href; }
  function bridge(fn, args) {
    return new Promise(function (resolve, reject) {
      var cfg;
      try { cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.ae-mcp-bridge.json'), 'utf8')); }
      catch (e) { reject(new Error('Bridge connection settings are unavailable.')); return; }
      var body = JSON.stringify({ fn: fn, args: args });
      var req = http.request({ hostname: '127.0.0.1', port: cfg.port || 7788, path: '/call', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'X-AE-Bridge-Token': cfg.token } }, function (res) {
        var text = ''; res.setEncoding('utf8'); res.on('data', function (chunk) { text += chunk; });
        res.on('end', function () { try { var r = JSON.parse(text); if (!r.ok) throw new Error(r.error || 'AE call failed'); resolve(r.result); } catch (e) { reject(e); } });
      });
      req.setTimeout(120000, function () { req.destroy(new Error('AE has not answered. Inspect the project before retrying an insert.')); });
      req.on('error', reject); req.end(body);
    });
  }
  function openCatalog(file) {
    try {
      library = core.load(file); $('libraryPath').value = file; localStorage.setItem('aemcp.libraryPath', file);
      $('libraryName').textContent = library.name; selected = null; $('libraryDetail').hidden = true;
      renderCards(); notice(library.items.length + ' reusable items loaded.');
    } catch (e) { library = null; $('libraryCards').textContent = ''; notice(e.message, true); }
  }
  function choose(item) {
    selected = item; $('libraryDetail').hidden = false; $('libraryItemTitle').textContent = item.id + ' · ' + item.title;
    $('libraryDescription').textContent = item.description || '';
    $('libraryComp').textContent = item.comp + ' · ' + item.duration + 's';
    var video = $('libraryVideo'), poster = $('libraryPoster'); video.pause(); video.removeAttribute('src'); video.load();
    video.hidden = true; poster.hidden = true;
    if (item.posterPath && fs.existsSync(item.posterPath)) { poster.src = fileUrl(item.posterPath); poster.hidden = false; }
    if (item.videoPath && fs.existsSync(item.videoPath)) { video.src = fileUrl(item.videoPath); if (item.posterPath) video.poster = fileUrl(item.posterPath); video.hidden = false; poster.hidden = true; }
    $('libraryPlay').disabled = video.hidden;
    $('libraryOpen').disabled = busy; $('libraryInsert').disabled = busy;
    $('libraryPreviewState').textContent = video.hidden ? 'Rendered still. Open in AE to preview motion.' : 'Rendered AE motion preview · silent';
  }
  function renderCards() {
    var container = $('libraryCards'); container.textContent = ''; if (!library) return;
    var items = core.filter(library.items, category, $('librarySearch').value); $('libraryResults').textContent = items.length + ' ' + (category === 'scene' ? 'scenes' : 'transitions');
    items.forEach(function (item) {
      var button = document.createElement('button'); button.className = 'library-card'; button.type = 'button';
      if (item.posterPath && fs.existsSync(item.posterPath)) { var img = document.createElement('img'); img.src = fileUrl(item.posterPath); img.alt = ''; img.loading = 'lazy'; button.appendChild(img); }
      var title = document.createElement('span'); title.textContent = item.id + ' · ' + item.title; button.appendChild(title);
      button.addEventListener('click', function () { choose(item); }); container.appendChild(button);
    });
  }
  function action(kind) {
    if (!selected || busy) return;
    busy = true; $('libraryOpen').disabled = true; $('libraryInsert').disabled = true;
    notice(kind === 'insert' ? 'Inserting an independent template instance…' : 'Opening the editable template…');
    var args = { action: kind, project: selected.projectPath, comp: selected.comp, time: selected.previewTime || 0 };
    var code = '$.evalFile(new File(' + JSON.stringify(path.join(extension, 'jsx', 'library-ops.jsx')) + ')); JSON.stringify(aeLibraryOperation(' + JSON.stringify(args) + '));';
    // Uses the same authenticated HTTP dispatcher, sandbox guard and raw-script switch as agent calls.
    bridge('run_jsx', { code: code }).then(function (r) {
      var result = typeof r.result === 'string' ? JSON.parse(r.result) : r;
      notice((kind === 'insert' ? 'Inserted ' : 'Opened ') + (result.comp || selected.comp) + '.');
    }).catch(function (e) { notice(e.message, true); }).then(function () { busy = false; $('libraryOpen').disabled = false; $('libraryInsert').disabled = false; });
  }
  function tab(name) {
    var isLibrary = name === 'library'; $('log').hidden = isLibrary; $('library').hidden = !isLibrary;
    $('bridgeTab').setAttribute('aria-selected', String(!isLibrary)); $('libraryTab').setAttribute('aria-selected', String(isLibrary));
    document.body.classList.toggle('library-view', isLibrary);
    if (!isLibrary) $('libraryVideo').pause();
  }
  function boot() {
    $('bridgeTab').addEventListener('click', function () { tab('bridge'); }); $('libraryTab').addEventListener('click', function () { tab('library'); });
    $('libraryLoad').addEventListener('click', function () { openCatalog($('libraryPath').value.trim()); });
    $('libraryPath').addEventListener('keydown', function (e) { if (e.key === 'Enter') openCatalog(this.value.trim()); });
    $('librarySearch').addEventListener('input', renderCards);
    ['scene', 'transition'].forEach(function (value) { $(value + 'Filter').addEventListener('click', function () { category = value; $('sceneFilter').setAttribute('aria-pressed', String(value === 'scene')); $('transitionFilter').setAttribute('aria-pressed', String(value === 'transition')); renderCards(); }); });
    $('libraryOpen').addEventListener('click', function () { action('open'); }); $('libraryInsert').addEventListener('click', function () { action('insert'); });
    $('libraryPlay').addEventListener('click', function () { var v = $('libraryVideo'); v.currentTime = selected && selected.videoIn || 0; var promise = v.play(); if (promise) promise.catch(function (e) { notice('Preview playback unavailable: ' + e.message, true); }); });
    $('libraryVideo').addEventListener('loadedmetadata', function () { if (selected && selected.videoIn) this.currentTime = selected.videoIn; });
    $('libraryVideo').addEventListener('timeupdate', function () { if (selected && Number.isFinite(selected.videoOut) && this.currentTime >= selected.videoOut) { this.pause(); this.currentTime = selected.videoIn || 0; } });
    var saved = localStorage.getItem('aemcp.libraryPath');
    if (!saved) { try { var registry = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.ae-mcp-bridge', 'libraries.json'), 'utf8')); saved = registry.catalogs && registry.catalogs[0]; } catch (e) {} }
    if (saved) openCatalog(saved); else notice('Load a reusable library catalog.json to browse previews.');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
