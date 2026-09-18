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

/* 5. The skill ships and names only real tools. */
const skill = read('skills/ae-mcp-bridge/SKILL.md');
for (const m of skill.matchAll(/`(ae_[a-z_]+)`/g)) {
  if (!names.has(m[1])) { fail('SKILL.md mentions ' + m[1] + ', which is not a tool'); }
}
if (!pkg.files.includes('skills/')) { fail('package.json "files" does not ship skills/'); }

if (failures.length) {
  console.error(failures.map((f) => '✗ ' + f).join('\n'));
  console.error('\n' + failures.length + ' problem(s).');
  process.exit(1);
}
console.log('✓ ' + TOOLS.length + ' tools, ' + writeFns.size + ' write functions, version ' + pkg.version + ' — all consistent.');
