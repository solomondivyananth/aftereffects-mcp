#!/usr/bin/env node
/*
 * check.js — static checks that keep the three layers of the bridge in step.
 * No After Effects needed; runs in CI. `npm test`.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const failures = [];
const fail = (msg) => failures.push(msg);

const jsx = read('panel/jsx/bridge.jsx');
const mainJs = read('panel/js/main.js');
const { TOOLS } = require(path.join(ROOT, 'mcp', 'ae-mcp.js'));

/* 1. Everything parses. */
for (const f of ['mcp/ae-mcp.js', 'panel/js/main.js', 'bin/install-panel.js', 'scripts/check.js',
                 'scripts/live/common.js', 'scripts/live/tools.test.js', 'scripts/live/guard.test.js']) {
  try { new vm.Script(read(f).replace(/^#!.*\n/, ''), { filename: f }); } catch (e) { fail(f + ': ' + e.message); }
}
try { new vm.Script(jsx, { filename: 'bridge.jsx' }); } catch (e) { fail('bridge.jsx: ' + e.message); }

/* 2. bridge.jsx is ES3 — ExtendScript has no let/const/arrows/template strings,
      and no Array.prototype.forEach/map/filter/indexOf. */
const code = jsx.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/'(?:\\.|[^'\\])*'/g, "''");
[[/\blet\s/, 'let'], [/\bconst\s/, 'const'], [/=>/, 'arrow function'], [/`/, 'template string'],
 [/\.(forEach|map|filter|reduce|some|every|find|includes)\(/, 'ES5+ array method'],
 [/\.trim\(\)/, 'String.trim'], [/Object\.keys/, 'Object.keys']].forEach(([re, what]) => {
  const m = code.match(re);
  if (m) { fail('bridge.jsx uses ' + what + ' (ES3 only): …' + code.substr(Math.max(0, m.index - 40), 80).replace(/\s+/g, ' ') + '…'); }
});

/* 2b. ExtendScript evaluates an unparenthesized conditional chain
       (a ? b : c ? d : e) wrongly — it returns the wrong branch. Nested
       conditionals must be parenthesized: a ? b : (c ? d : e). */
{
  const stripped = jsx.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length))
    .replace(/(["'])(?:\\.|(?!\1)[^\\\n])*\1/g, (m) => '"' + ' '.repeat(m.length - 2) + '"')
    .replace(/\/(?![*\/])(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^\/\\\n])+\/[gimsuy]*/g, (m) => ' '.repeat(m.length));
  let depth = 0, line = 1;
  const pending = {}, inElse = {};
  for (const ch of stripped) {
    if (ch === '\n') { line++; continue; }
    if (ch === '(' || ch === '[' || ch === '{') { depth++; pending[depth] = false; inElse[depth] = false; continue; }
    if (ch === ')' || ch === ']' || ch === '}') { pending[depth] = false; inElse[depth] = false; depth--; continue; }
    if (ch === ';' || ch === ',') { pending[depth] = false; inElse[depth] = false; continue; }
    if (ch === '?') {
      if (inElse[depth]) { fail('bridge.jsx line ' + line + ': unparenthesized ?: chain — ExtendScript picks the wrong branch; wrap the nested part in ( )'); inElse[depth] = false; }
      pending[depth] = true;
      continue;
    }
    if (ch === ':' && pending[depth]) { pending[depth] = false; inElse[depth] = true; }
  }
}

/* 3. Every tool routes to something that exists. */
const cases = new Set([...jsx.matchAll(/case '([a-z_]+)':/g)].map((m) => m[1]));
const nodeFns = new Set([...mainJs.matchAll(/^\s+([a-z_]+): (?:renderStart|function)/gm)].map((m) => m[1]));
const writeFns = new Set(jsx.match(/var __AE_WRITE_FNS = ([\s\S]*?);/)[1].replace(/['+\s]/g, '').split(','));
const names = new Set();
for (const t of TOOLS) {
  if (names.has(t.name)) { fail('duplicate tool ' + t.name); }
  names.add(t.name);
  if (!/^ae_[a-z_]+$/.test(t.name)) { fail('bad tool name ' + t.name); }
  if (!t.description || t.description.length > 900) { fail(t.name + ': description missing or too long'); }
  const s = t.inputSchema;
  if (!s || s.type !== 'object' || typeof s.properties !== 'object') { fail(t.name + ': inputSchema must be an object schema'); }
  (s.required || []).forEach((r) => { if (!(r in s.properties)) { fail(t.name + ': required "' + r + '" not in properties'); } });
  if (t.custom) { continue; }
  if (!cases.has(t.fn) && !nodeFns.has(t.fn)) { fail(t.name + ' → "' + t.fn + '" has no case in bridge.jsx or handler in main.js'); }
  const saysWrite = /WRITE\.?$/.test(t.description.trim());
  const isWrite = writeFns.has(t.fn) || t.fn === 'render_start';
  if (saysWrite !== isWrite) {
    fail(t.name + ': description ' + (saysWrite ? 'says' : 'does not say') + ' WRITE but the guard list ' +
         (isWrite ? 'treats it as a write' : 'does not'));
  }
}
for (const w of writeFns) { if (!cases.has(w)) { fail('__AE_WRITE_FNS lists "' + w + '" but bridge.jsx has no case for it'); } }

/* 3b. Every element the panel script looks up exists in the panel HTML. */
const html = read('panel/index.html');
for (const id of new Set([...mainJs.matchAll(/\$\('([A-Za-z]+)'\)/g)].map((m) => m[1]))) {
  if (!html.includes('id="' + id + '"')) { fail('main.js looks up #' + id + ' but panel/index.html has no such element'); }
}

/* 4. One version everywhere. */
const pkg = JSON.parse(read('package.json'));
const server = JSON.parse(read('server.json'));
const manifest = read('panel/CSXS/manifest.xml');
const versions = {
  'package.json': pkg.version,
  'server.json': server.version,
  'server.json packages[0]': server.packages && server.packages[0].version,
  'manifest ExtensionBundleVersion': (manifest.match(/ExtensionBundleVersion="([^"]+)"/) || [])[1],
  'manifest Extension Version': (manifest.match(/<Extension Id="[^"]+" Version="([^"]+)"/) || [])[1]
};
Object.keys(versions).forEach((k) => {
  if (versions[k] !== pkg.version) { fail('version mismatch: ' + k + ' is ' + versions[k] + ', package.json is ' + pkg.version); }
});
const debugId = (read('panel/.debug').match(/Extension Id="([^"]+)"/) || [])[1];
const manifestId = (manifest.match(/<Extension Id="([^"]+)"/) || [])[1];
if (debugId !== manifestId) { fail('.debug extension id ' + debugId + ' does not match manifest ' + manifestId); }

/* 5. Every skill is well-formed and names only real tools. */
for (const dir of fs.readdirSync(path.join(ROOT, 'skills'))) {
  const file = path.join('skills', dir, 'SKILL.md');
  if (!fs.existsSync(path.join(ROOT, file))) { fail(file + ' is missing'); continue; }
  const md = read(file).replace(/\r\n/g, '\n');
  const fm = md.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) { fail(file + ' has no frontmatter'); continue; }
  const name = (fm[1].match(/^name:\s*(.+)$/m) || [])[1];
  const desc = (fm[1].match(/^description:\s*(.+)$/m) || [])[1] || '';
  if (name !== dir) { fail(file + ': frontmatter name "' + name + '" must equal the folder name'); }
  if (desc.length < 40 || desc.length > 1024) { fail(file + ': description must be 40-1024 characters (is ' + desc.length + ')'); }
  for (const m of md.matchAll(/\b(ae_[a-z_]+)\b/g)) {
    if (!names.has(m[1])) { fail(file + ' mentions ' + m[1] + ', which is not a tool'); }
  }
  const scripts = path.join(ROOT, 'skills', dir, 'scripts');
  if (fs.existsSync(scripts)) {
    for (const f of fs.readdirSync(scripts)) {
      if (/\.(sh|bash|zsh)$/.test(f)) { fail('skills/' + dir + '/scripts/' + f + ': skill scripts must be Node so they run on Windows'); }
      if (/\.js$/.test(f)) {
        try { new vm.Script(read(path.join('skills', dir, 'scripts', f)).replace(/^#!.*\n/, '')); }
        catch (e) { fail('skills/' + dir + '/scripts/' + f + ': ' + e.message); }
      }
    }
  }
}
if (!pkg.files.includes('skills/')) { fail('package.json "files" does not ship skills/'); }

/* 5b. A skill an agent can't see may as well not exist. Claude Code reads
      .claude/skills, so when that folder is set up here it must hold every
      skill — `npm run skills` relinks them. */
{
  const linked = path.join(ROOT, '.claude', 'skills');
  if (fs.existsSync(linked)) {
    const have = new Set(fs.readdirSync(linked));
    for (const dir of fs.readdirSync(path.join(ROOT, 'skills'))) {
      if (!have.has(dir)) { fail('.claude/skills is missing "' + dir + '" — run `npm run skills` so agents load it'); }
    }
  }
}

/* 6. The server actually starts and answers an MCP handshake, on this OS. */
const { spawnSync } = require('child_process');
const handshake = [
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'check', version: '0' } } },
  { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  { jsonrpc: '2.0', id: 3, method: 'prompts/get', params: { name: 'after-effects' } }
].map((m) => JSON.stringify(m)).join('\n') + '\n';
const run = spawnSync(process.execPath, [path.join(ROOT, 'mcp', 'ae-mcp.js')], { input: handshake, encoding: 'utf8', timeout: 20000 });
const replies = {};
String(run.stdout || '').split(/\r?\n/).filter(Boolean).forEach((l) => { try { const m = JSON.parse(l); replies[m.id] = m; } catch (e) {} });
if (!replies[1] || !replies[1].result || replies[1].result.serverInfo.version !== pkg.version) { fail('MCP server did not answer initialize (' + (run.stderr || run.error || 'no output') + ')'); }
if (!replies[2] || !replies[2].result || replies[2].result.tools.length !== TOOLS.length) { fail('MCP server tools/list did not return ' + TOOLS.length + ' tools'); }
if (!replies[3] || !replies[3].result || !/read → edit → look/.test(replies[3].result.messages[0].content.text)) { fail('MCP server did not serve the after-effects prompt'); }

/* 7. Installer knows both platforms. */
const installer = read('bin/install-panel.js');
if (!/win32/.test(installer) || !/darwin/.test(installer)) { fail('bin/install-panel.js must support macOS and Windows'); }

/* 8. Every template expands cleanly with its defaults, in every format it
      claims, and only calls tools that exist. No After Effects needed. */
{
  const eng = require(path.join(ROOT, 'mcp', 'ae-mcp.js'));
  const tpls = eng.loadTemplates();
  const files = fs.readdirSync(path.join(ROOT, 'templates')).filter((f) => /\.json$/.test(f));
  if (!files.length) { fail('templates/ has no templates'); }
  for (const f of files) {
    const t = JSON.parse(read(path.join('templates', f)));
    if (t.name + '.json' !== f) { fail('templates/' + f + ': "name" must match the file name'); continue; }
    for (const k of ['title', 'description', 'slots', 'steps']) { if (!t[k]) { fail('templates/' + f + ' has no "' + k + '"'); } }
    for (const [sk, spec] of Object.entries(t.slots || {})) {
      if (!['text', 'color', 'number', 'enum', 'bool', 'list'].includes(spec.type)) { fail(f + ': slot ' + sk + ' has unknown type ' + spec.type); }
      if (spec.default === undefined) { fail(f + ': slot ' + sk + ' needs a default'); }
      if (!spec.describe) { fail(f + ': slot ' + sk + ' needs "describe" — it is what the agent reads'); }
    }
    const { values, problems } = eng.resolveSlots(t, {});
    problems.forEach((pr) => fail(f + ': default values fail their own rules: ' + pr));
    for (const format of (t.formats || ['16x9'])) {
      const [W, H] = eng.FORMATS[format] || [];
      if (!W) { fail(f + ': unknown format ' + format); continue; }
      const fps = t.fps || 30;
      let steps;
      try {
        const dur = typeof t.duration === 'string' ? Number(eng.evalExpr(t.duration, Object.assign({}, t.data || {}, values, { fps }))) : t.duration;
        const ctx = Object.assign({}, t.data || {}, values, { comp: 'Check', W, H, fps, dur, cx: W / 2, cy: H / 2,
          S: Math.min(W, H) / 1080, portrait: H > W, format, f: (n) => n / fps, toolCount: TOOLS.length, skillCount: 1 });
        steps = eng.expandSteps(t.steps, ctx, []);
      } catch (e) { fail(f + ' (' + format + '): ' + e.message); continue; }
      for (const st of steps) {
        if (!names.has(st.tool)) { fail(f + ': step calls ' + st.tool + ', which is not a tool'); break; }
        if (['ae_batch', 'ae_undo', 'ae_new_project', 'ae_open_project', 'ae_render_frame', 'ae_catalog', 'ae_template', 'ae_welcome'].includes(st.tool)) {
          fail(f + ': ' + st.tool + ' cannot run inside a template build'); break;
        }
        const bad = JSON.stringify(st.args).match(/NaN|undefined|\{\{/);
        if (bad) { fail(f + ' (' + format + '): a step for ' + st.tool + ' has "' + bad[0] + '" in its arguments'); break; }
      }
    }
  }
  if (!pkg.files.includes('templates/')) { fail('package.json "files" does not ship templates/'); }
}

/* 9. The proof-reader's checks and the skill that documents them stay in step,
      and nothing in there can write to the project. */
{
  const { CHECKS, analyse } = require(path.join(ROOT, 'mcp', 'proof.js'));
  const md = read('skills/ae-motion-proof/SKILL.md');
  const ids = new Set(CHECKS.map((c) => c.id));
  if (ids.size !== CHECKS.length) { fail('mcp/proof.js: two checks share an id'); }
  for (const c of CHECKS) {
    if (!c.what || !c.group) { fail('mcp/proof.js: check ' + c.id + ' needs a group and a description'); }
    if (!md.includes('`' + c.id + '`')) { fail('skills/ae-motion-proof/SKILL.md does not document the check `' + c.id + '`'); }
  }
  for (const m of md.matchAll(/`([a-z][a-z-]{3,})`/g)) {
    if (/^ae[-_]/.test(m[1]) || m[1].includes('--')) { continue; }
    if (!ids.has(m[1]) && /^(overlap|collide|clipped|overshoot|safe-area|edge-crowd|tangent|text-|jitter|flicker|wiggle|sub-pixel|off-grid|pop|speed-|linear|read-|stagger|crowded|dead-|unseen|mid-|marker-|strobe|blur-|long-|shear|upscaled|expression-|missing-|never-|switch-|duplicate-|comp-|empty-)/.test(m[1])) {
      fail('skills/ae-motion-proof/SKILL.md documents `' + m[1] + '`, which is not a check in mcp/proof.js');
    }
  }
  if (writeFns.has('proof')) { fail('__AE_WRITE_FNS lists "proof" — proof-reading must stay read-only'); }
  if (!/ae_proof/.test(md)) { fail('skills/ae-motion-proof/SKILL.md never mentions ae_proof'); }
  /* It survives a comp with nothing in it. */
  try {
    analyse({ comp: 'Empty', width: 1920, height: 1080, frameRate: 30, duration: 1,
      workArea: [0, 1], resolution: [1, 1], times: [0, 0.5], layers: [], markers: [], missingFootage: [] });
  } catch (e) { fail('mcp/proof.js: analyse() throws on an empty comp: ' + e.message); }
}

if (failures.length) {
  console.error(failures.map((f) => '✗ ' + f).join('\n'));
  console.error('\n' + failures.length + ' problem(s).');
  process.exit(1);
}
console.log('✓ ' + TOOLS.length + ' tools, ' + writeFns.size + ' write functions, version ' + pkg.version + ' — all consistent.');
