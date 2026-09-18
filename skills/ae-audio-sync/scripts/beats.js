#!/usr/bin/env node
/*
 * beats.js — find the hits in a music track and turn them into comp markers.
 * Needs Node and ffmpeg. Runs on macOS, Windows and Linux.
 *
 *   node beats.js AUDIO [options]
 *
 *   --fps 30              snap every hit to this frame rate (use the comp's)
 *   --sensitivity 1.5     higher finds fewer, stronger hits
 *   --min-gap 0.12        seconds between hits, at least
 *   --start 0 --end 30    only this part of the track
 *   --every 1             keep every Nth beat of the grid (2 = half time, 4 = bars in 4/4)
 *   --json out.json       also write {"action":"add","markers":[…]} for ae_markers
 *
 * Prints the estimated tempo, the hits (strongest marked), and a beat grid
 * locked to that tempo. Hits come from rises in loudness, so they follow
 * drums and accents; a smooth pad with no attacks has few hits.
 */
'use strict';

const fs = require('fs');
const { spawnSync } = require('child_process');

const argv = process.argv.slice(2);
if (!argv.length || argv[0].startsWith('--')) {
  console.error('usage: node beats.js AUDIO [--fps 30] [--sensitivity 1.5] [--min-gap 0.12] [--start s] [--end s] [--every n] [--json out.json]');
  process.exit(2);
}
const FILE = argv[0];
const o = { fps: 30, sensitivity: 1.5, 'min-gap': 0.12, start: 0, end: 0, every: 1, json: '' };
for (let i = 1; i < argv.length; i++) {
  const k = argv[i].replace(/^--/, '');
  if (!(k in o) || i + 1 >= argv.length) { console.error('unknown or incomplete option ' + argv[i]); process.exit(2); }
  o[k] = argv[++i];
}
if (!fs.existsSync(FILE)) { console.error('no such file: ' + FILE); process.exit(2); }

const SR = 22050, HOP = 256, WIN = 1024;
const args = ['-v', 'error'];
if (Number(o.start)) { args.push('-ss', String(o.start)); }
if (Number(o.end)) { args.push('-to', String(o.end)); }
args.push('-i', FILE, '-vn', '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-');
const pcmRun = spawnSync('ffmpeg', args, { maxBuffer: 1024 * 1024 * 1024 });
if (pcmRun.status !== 0 || !pcmRun.stdout.length) {
  console.error('ffmpeg could not read audio from ' + FILE + ': ' + String(pcmRun.stderr).slice(-300));
  process.exit(1);
}
const buf = pcmRun.stdout;
const n = Math.floor(buf.length / 4);
const pcm = new Float32Array(n);
for (let i = 0; i < n; i++) { pcm[i] = buf.readFloatLE(i * 4); }

/* Onset strength: positive change in log energy, band-split so a kick and a
   hi-hat both count (low = a simple running average; high = what's left). */
const frames = Math.max(0, Math.floor((n - WIN) / HOP));
const flux = new Float32Array(frames);
let prevLo = 0, prevHi = 0;
for (let f = 0; f < frames; f++) {
  let lo = 0, hi = 0, avg = 0;
  const s0 = f * HOP;
  for (let i = 0; i < WIN; i++) {
    const x = pcm[s0 + i];
    avg += (x - avg) * 0.08;
    lo += avg * avg;
    hi += (x - avg) * (x - avg);
  }
  const L = Math.log(1e-9 + lo / WIN), Hh = Math.log(1e-9 + hi / WIN);
  flux[f] = Math.max(0, L - prevLo) + Math.max(0, Hh - prevHi);
  prevLo = L; prevHi = Hh;
}

/* Peaks above a moving mean + sensitivity × moving deviation. */
const secPerFrame = HOP / SR;
const half = Math.round(0.4 / secPerFrame);
const minGap = Math.round(Number(o['min-gap']) / secPerFrame);
const offset = Number(o.start) || 0;
const hits = [];
for (let f = 1; f < frames - 1; f++) {
  if (flux[f] < flux[f - 1] || flux[f] < flux[f + 1]) { continue; }
  let sum = 0, sq = 0, cnt = 0;
  for (let j = Math.max(0, f - half); j < Math.min(frames, f + half); j++) { sum += flux[j]; sq += flux[j] * flux[j]; cnt++; }
  const mean = sum / cnt, sd = Math.sqrt(Math.max(0, sq / cnt - mean * mean));
  if (flux[f] <= mean + Number(o.sensitivity) * sd) { continue; }
  if (hits.length && f - hits[hits.length - 1].f < minGap) {
    if (flux[f] > hits[hits.length - 1].s) { hits[hits.length - 1] = { f, s: flux[f] }; }
    continue;
  }
  hits.push({ f, s: flux[f] });
}

/* Tempo: autocorrelation of the onset curve between 70 and 180 BPM. */
let bestLag = 0, best = -1;
const lagMin = Math.round(60 / 180 / secPerFrame), lagMax = Math.round(60 / 70 / secPerFrame);
for (let lag = lagMin; lag <= lagMax; lag++) {
  let acc = 0;
  for (let f = 0; f + lag < frames; f++) { acc += flux[f] * flux[f + lag]; }
  if (acc > best) { best = acc; bestLag = lag; }
}
const bpm = bestLag ? 60 / (bestLag * secPerFrame) : 0;

const fps = Number(o.fps);
const snap = (t) => Math.round(t * fps) / fps;
const maxS = hits.reduce((m, h) => Math.max(m, h.s), 0) || 1;
const hitList = hits.map((h) => {
  /* A hit registers when it enters the leading edge of the window, WIN
     samples before it happens: shift by the window length. */
  const t = snap(offset + (h.f * HOP + WIN) / SR);
  return { time: Math.round(t * 1000) / 1000, frame: Math.round(t * fps), strength: Math.round(h.s / maxS * 100) / 100 };
});

/* A grid at the estimated tempo, phased to line up with the strongest hits. */
const grid = [];
if (bpm && hitList.length) {
  const period = 60 / bpm;
  let bestPhase = 0, bestScore = -1;
  for (let k = 0; k < 20; k++) {
    const phase = (k / 20) * period;
    let score = 0;
    for (const h of hitList) {
      const d = Math.abs(((h.time - offset - phase) % period + period) % period);
      if (Math.min(d, period - d) < 0.04) { score += h.strength; }
    }
    if (score > bestScore) { bestScore = score; bestPhase = phase; }
  }
  const last = offset + frames * secPerFrame;
  const every = Math.max(1, parseInt(o.every, 10));
  let i = 0;
  for (let t = offset + bestPhase; t <= last; t += period, i++) {
    if (i % every === 0) { grid.push(Math.round(snap(t) * 1000) / 1000); }
  }
}

console.log('tempo ≈ ' + (bpm ? bpm.toFixed(1) + ' BPM (' + (60 / bpm).toFixed(3) + ' s, ' + (60 / bpm * fps).toFixed(1) + ' frames at ' + fps + ' fps)' : 'unknown'));
console.log(hitList.length + ' hits (strength 0-1; ★ = strongest third):');
hitList.forEach((h) => console.log('  ' + h.time.toFixed(3) + ' s  frame ' + h.frame + '  ' + h.strength.toFixed(2) + (h.strength > 0.66 ? ' ★' : '')));
console.log('beat grid' + (Number(o.every) > 1 ? ' (every ' + o.every + ')' : '') + ': ' + grid.map((t) => t.toFixed(3)).join(', '));

if (o.json) {
  const markers = hitList.map((h) => ({ time: h.time, comment: h.strength > 0.66 ? 'hit' : 'beat' }));
  fs.writeFileSync(o.json, JSON.stringify({ action: 'add', markers, tempo: bpm ? Math.round(bpm * 10) / 10 : null, grid }, null, 2));
  console.log('wrote ' + o.json + ' (pass its "action" and "markers" to ae_markers)');
}
