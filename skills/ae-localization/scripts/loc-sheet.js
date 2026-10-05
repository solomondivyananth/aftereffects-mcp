#!/usr/bin/env node
/*
 * loc-sheet.js - turn a text inventory into a translation sheet, and a
 * translated sheet back into edits for After Effects. Node 18+, no packages.
 * Runs on macOS, Windows and Linux.
 *
 *   node loc-sheet.js sheet   inventory.json --langs DE,FR,JA [--glossary g.csv] [--out sheet.csv]
 *   node loc-sheet.js apply   inventory.json translated.csv --lang DE [--map dup-DE.json]
 *                             [--glossary g.csv] [--strict] [--out batch-DE.json]
 *   node loc-sheet.js strings inventory.json translated.csv --langs EN,DE,FR [--source EN] [--out strings.json]
 *
 * inventory.json comes from loc-inventory.jsx (the "result" string of
 * ae_run_jsx, or the whole tool reply - both are accepted).
 *
 * sheet    one row per Source Text value, with the layer's width budget and
 *          an approximate character budget. Line breaks are shown as {br}.
 *          Footage that may hold baked-in words is listed at the end.
 * apply    checks every translation (length against the budget, {br} count,
 *          numbers, glossary and do-not-translate terms), prints the problems
 *          and writes an ae_batch payload of ae_text calls into the language
 *          comps ("<comp>_<LANG>", or the names in --map).
 * strings  writes {LANG: {"Comp/Layer": text}} for a master driven by a
 *          language control (see SKILL.md, "One master, many languages").
 *          --source names the language the project was built in: its column
 *          is filled from the project's own text.
 *
 * glossary.csv columns: term, dnt (yes = keep exactly as written), then one
 * column per language with the approved translation of the term.
 */
'use strict';

const fs = require('fs');

const [cmd, ...rest] = process.argv.slice(2);
const pos = [], opt = {};
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) {
    const k = rest[i].slice(2);
    if (k === 'strict') { opt.strict = true; continue; }
    if (i + 1 >= rest.length) { die('option ' + rest[i] + ' needs a value'); }
    opt[k] = rest[++i];
  } else { pos.push(rest[i]); }
}
function die(msg) { console.error('loc-sheet: ' + msg); process.exit(2); }
function usage() {
  die('usage:\n  node loc-sheet.js sheet INVENTORY --langs DE,FR [--glossary g.csv] [--out sheet.csv]\n' +
      '  node loc-sheet.js apply INVENTORY TRANSLATED.csv --lang DE [--map dup.json] [--glossary g.csv] [--strict] [--out batch.json]\n' +
      '  node loc-sheet.js strings INVENTORY TRANSLATED.csv --langs EN,DE [--source EN] [--out strings.json]');
}

/* ---------- CSV (RFC 4180: quotes, embedded commas and newlines, BOM) ---------- */
function parseCsv(text) {
  text = text.replace(/^\ufeff/, '');
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else { q = false; } }
      else { cell += ch; }
    } else if (ch === '"') { q = true; }
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') { i++; }
      row.push(cell); cell = ''; rows.push(row); row = [];
    } else { cell += ch; }
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  const head = (rows.shift() || []).map((h) => h.trim());
  if (head.length === 1 && head[0].includes(';')) { die('this CSV uses semicolons - save it again as "CSV UTF-8 (comma delimited)"'); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
    .map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] === undefined ? '' : r[i]])));
}
function csvCell(v) {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function writeCsv(head, rows) {
  /* The BOM makes Excel open UTF-8 (CJK, Arabic, accents) correctly. */
  return '\ufeff' + [head, ...rows.map((r) => head.map((h) => r[h]))].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/* ---------- inventory ---------- */
function loadInventory(file) {
  let j = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\ufeff/, ''));
  if (j && j.result !== undefined) { j = j.result; }          /* whole ae_run_jsx reply */
  if (typeof j === 'string') { j = JSON.parse(j); }           /* the JSON string it returned */
  if (!j || !Array.isArray(j.rows)) { die(file + ' is not a loc-inventory.jsx result'); }
  return j;
}
const BR = '{br}';
const toSheet = (s) => String(s).replace(/\r\n|\r|\n/g, BR);
const fromSheet = (s) => String(s).replace(/\{br\}/g, '\r');
const chars = (s) => Array.from(String(s).replace(/\{br\}/g, '')).length;

/* Rough advance width in ems: full-width scripts take about a full em,
   Latin, Cyrillic, Greek, Arabic and Hebrew about half. Only for budgets. */
function ems(s) {
  let w = 0;
  for (const line of String(s).split(/\{br\}|\r\n|\r|\n/)) {
    let lw = 0;
    for (const c of Array.from(line)) {
      const cp = c.codePointAt(0);
      if (/[\u0300-\u036f\u0e31\u0e34-\u0e3a\u0e47-\u0e4e\u064b-\u065f\u0900-\u0903\u093a-\u094f\u200b-\u200f]/.test(c)) { continue; } /* marks, zero width */
      if ((cp >= 0x1100 && cp <= 0x11ff) || (cp >= 0x2e80 && cp <= 0x9fff) || (cp >= 0xac00 && cp <= 0xd7af) ||
          (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xff00 && cp <= 0xff60) || cp >= 0x20000) { lw += 1; }
      else if (c === ' ') { lw += 0.28; }
      else { lw += 0.56; }
    }
    w = Math.max(w, lw);                                     /* the longest line is what overflows */
  }
  return w;
}
/* Box text wraps, so its limit is lines, not width: how many lines the
   text needs at this size, against how many the box holds. */
function boxFit(r, text) {
  const size = (r.font && r.font.size) || 0, box = r.font && r.font.box;
  if (!size || !box) { return null; }
  let need = 0;
  for (const line of String(text).split(/\{br\}|\r\n|\r|\n/)) { need += Math.max(1, Math.ceil(ems(line) * size * 1.1 / box[0])); }
  return { need, fits: Math.max(1, Math.floor(box[1] / (size * 1.2))) };
}
function budgetOf(r) {
  const box = r.font && r.font.box;
  if (box) { return { px: box[0], kind: 'box' }; }
  return { px: Math.round(r.compSize[0] * 0.9 / ((r.scale || 100) / 100)), kind: 'title-safe' };
}

function loadGlossary(file) {
  if (!file) { return []; }
  return parseCsv(fs.readFileSync(file, 'utf8')).filter((g) => g.term)
    .map((g) => ({ ...g, dnt: /^(y|yes|true|1|x)$/i.test(String(g.dnt || '').trim()) }));
}
const has = (s, term) => String(s).toLowerCase().includes(String(term).toLowerCase());

function notesFor(r) {
  const n = [];
  if (r.expression) { n.push('EXPRESSION drives this text - translate its data source, not this row'); }
  if (r.key) { n.push('keyed Source Text, key ' + r.key + ' at ' + r.time + 's'); }
  if (!r.enabled) { n.push('layer switched off'); }
  if (r.guide) { n.push('guide layer, does not render'); }
  if (/^[\d\s.,:%+\-\u2212$\u20ac\u00a3\u00a5]*$/.test(r.text)) { n.push('number or symbol - check separators and units'); }
  return n.join('; ');
}

function sheet() {
  if (pos.length < 1 || !opt.langs) { usage(); }
  const inv = loadInventory(pos[0]);
  const langs = opt.langs.split(',').map((s) => s.trim()).filter(Boolean);
  const gl = loadGlossary(opt.glossary);
  const head = ['id', 'comp', 'layer', 'layer_name', 'on_screen_s', 'source', 'max_chars', 'width_px', 'budget_px', 'font', 'terms', 'notes', ...langs];
  const rows = inv.rows.filter((r) => String(r.text).trim() !== '').sort((a, b) => a.comp.localeCompare(b.comp) || a.layer - b.layer || a.key - b.key)
    .map((r) => {
      const b = budgetOf(r), n = chars(toSheet(r.text));
      const size = (r.font && r.font.size) || 0;
      const maxChars = b.kind === 'box' && size
        ? Math.floor(b.px / (0.56 * size)) * Math.max(1, Math.floor(r.font.box[1] / (1.2 * size)))
        : (r.widthPx > 0 ? Math.max(n, Math.floor(n * b.px / r.widthPx)) : '');
      const o = {
        id: r.id, comp: r.comp, layer: r.layer, layer_name: r.layerName,
        on_screen_s: r.inPoint + '-' + r.outPoint, source: toSheet(r.text),
        max_chars: maxChars, width_px: r.widthPx, budget_px: b.px + ' (' + b.kind + ')',
        font: r.font ? [r.font.font, r.font.size ? r.font.size + 'px' : ''].filter(Boolean).join(' ') : '',
        terms: gl.filter((g) => has(r.text, g.term)).map((g) => g.dnt ? g.term + ' (keep)' : g.term).join('; '),
        notes: notesFor(r)
      };
      langs.forEach((l) => { o[l] = ''; });
      return o;
    });
  for (const m of inv.media || []) {
    const o = { id: 'media-' + (m.id || m.comp + '-L' + m.layer), comp: m.comp || (m.usedIn || []).join(' | '), layer: m.layer || '',
      layer_name: m.layerName || m.name, source: '', notes: m.kind === 'outlined text'
        ? 'text converted to shapes - retype it as a text layer, or redraw per language'
        : 'footage: look for words in it (render a frame). Baked-in text needs a new asset per language' + (m.missing ? ' (MISSING)' : '') };
    langs.forEach((l) => { o[l] = ''; });
    rows.push(o);
  }
  out(writeCsv(head, rows), 'sheet: ' + rows.length + ' rows (' + (inv.media || []).length + ' media to check by eye)');
}

function apply() {
  if (pos.length < 2 || !opt.lang) { usage(); }
  const inv = loadInventory(pos[0]);
  const tr = parseCsv(fs.readFileSync(pos[1], 'utf8'));
  const L = opt.lang, gl = loadGlossary(opt.glossary);
  const byId = new Map(inv.rows.map((r) => [r.id, r]));
  let map = null;
  if (opt.map) {
    let m = JSON.parse(fs.readFileSync(opt.map, 'utf8').replace(/^\ufeff/, ''));
    if (m.result !== undefined) { m = m.result; }
    if (typeof m === 'string') { m = JSON.parse(m); }
    map = new Map((m.copies || []).map((c) => [c.from, c.to]));
  }
  if (tr.length && !(L in tr[0])) { die('the sheet has no "' + L + '" column'); }
  const steps = [], problems = [], manual = [];
  for (const t of tr) {
    const where = t.id + ' (' + t.comp + ' / ' + t.layer_name + ')';
    if (String(t.id).startsWith('media-')) { manual.push(where + ': ' + (t.notes || 'check by eye')); continue; }
    const r = byId.get(t.id);
    if (!r) { problems.push(['error', where, 'id not in the inventory - was the sheet made from another project?']); continue; }
    const text = String(t[L] || '');
    if (!text.trim()) { problems.push(['warn', where, 'no ' + L + ' translation - source text left in place']); continue; }
    const src = toSheet(r.text);
    if (r.expression) { manual.push(where + ': driven by an expression - put "' + text + '" in its data source'); continue; }
    /* length: estimated width of the longest line against the budget */
    const b = budgetOf(r);
    const fit = b.kind === 'box' ? boxFit(r, text) : null;
    if (fit) {
      if (fit.need > fit.fits) { problems.push(['error', where, 'needs about ' + fit.need + ' lines, its text box holds ' + fit.fits + ' - lines past the box do not render. Shorten, or make the box taller']); }
    } else if (r.widthPx > 0 && ems(src) > 0) {
      const est = r.widthPx * ems(text) / ems(src);
      if (est > b.px * 1.02) { problems.push(['warn', where, 'likely ' + Math.round((est / b.px - 1) * 100) + '% over its ' + b.kind + ' width (' + Math.round(est) + ' of ' + b.px + ' px) - shorten, rewrap or fit this layer']); }
    }
    const brS = src.split(BR).length, brT = text.split(BR).length;
    if (brS !== brT) { problems.push(['note', where, 'source has ' + brS + ' line(s), translation ' + brT + ' - check the break is where the design wants it']); }
    const nums = (s) => (String(s).match(/\d+(?:[.,\u00a0\u202f ]\d+)*/g) || []).map((x) => x.replace(/\D/g, '')).sort().join('|');
    if (nums(src) !== nums(text)) { problems.push(['warn', where, 'numbers differ from the source (' + (nums(src) || 'none') + ' vs ' + (nums(text) || 'none') + ')']); }
    for (const g of gl) {
      if (!has(src, g.term)) { continue; }
      if (g.dnt && !String(text).includes(g.term)) { problems.push(['error', where, 'do-not-translate term "' + g.term + '" is missing or altered']); }
      else if (!g.dnt && g[L] && !has(text, g[L])) { problems.push(['warn', where, 'glossary: "' + g.term + '" should be "' + g[L] + '"']); }
    }
    const comp = map ? map.get(r.comp) : r.comp + (opt.sep !== undefined ? opt.sep : '_') + L;
    if (!comp) { problems.push(['error', where, 'comp "' + r.comp + '" has no ' + L + ' copy in the map']); continue; }
    const args = { comp, layer: r.layer, text: fromSheet(text) };
    if (r.key) { args.time = r.time; }
    steps.push({ tool: 'ae_text', args });
  }
  const order = { error: 0, warn: 1, note: 2 };
  problems.sort((a, b) => order[a[0]] - order[b[0]]).forEach((p) => console.error(p[0].toUpperCase() + '  ' + p[1] + ': ' + p[2]));
  manual.forEach((m) => console.error('BY HAND  ' + m));
  const errors = problems.filter((p) => p[0] === 'error').length, warns = problems.filter((p) => p[0] === 'warn').length;
  out(JSON.stringify({ name: 'Localise ' + L, steps }, null, 2) + '\n',
    'apply ' + L + ': ' + steps.length + ' ae_text steps, ' + errors + ' errors, ' + warns + ' warnings, ' + manual.length + ' by hand');
  if (errors || (opt.strict && warns)) { process.exitCode = 1; }
}

function strings() {
  if (pos.length < 2 || !opt.langs) { usage(); }
  const inv = loadInventory(pos[0]);
  const byId = new Map(inv.rows.map((r) => [r.id, r]));
  const tr = parseCsv(fs.readFileSync(pos[1], 'utf8'));
  const res = {};
  for (const l of opt.langs.split(',').map((s) => s.trim()).filter(Boolean)) {
    res[l] = {};
    for (const t of tr) {
      const r = byId.get(t.id);
      if (!r || r.key || r.expression) { continue; }              /* keyed or driven text can't use one string */
      const v = t[l] !== undefined && String(t[l]).trim() ? t[l] : (l === opt.source ? toSheet(r.text) : '');
      if (v) { res[l][r.comp + '/' + r.layerName] = fromSheet(v); }
    }
  }
  out(JSON.stringify(res, null, 2) + '\n', 'strings: ' + Object.keys(res).map((l) => l + ' ' + Object.keys(res[l]).length).join(', '));
}

function out(text, summary) {
  if (opt.out) { fs.writeFileSync(opt.out, text); console.error(summary + ' -> ' + opt.out); }
  else { process.stdout.write(text); console.error(summary); }
}

if (cmd === 'sheet') { sheet(); }
else if (cmd === 'apply') { apply(); }
else if (cmd === 'strings') { strings(); }
else { usage(); }
