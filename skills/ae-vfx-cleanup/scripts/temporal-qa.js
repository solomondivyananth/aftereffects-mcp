#!/usr/bin/env node
/*
 * temporal-qa.js — find the frames of a cleanup render that a person has to
 * look at: frozen stretches, repeated frames, and a frame count that does not
 * match the source. Needs Node, ffmpeg and ffprobe. Runs on macOS, Windows
 * and Linux.
 *
 *   node temporal-qa.js RENDER [options]
 *
 *   --source FILE        the original plate: counts are compared, and freezes
 *                        the source already had are marked "inSource" and
 *                        repeated frames the source already had are left out
 *   --crop x:y:w:h       only look at this region, as fractions of the frame
 *                        (the repair area: a frozen patch hides in a moving shot)
 *   --noise 0.001        freezedetect noise tolerance (0-1; raise for grainy plates)
 *   --min 0.1            shortest freeze to report, in seconds
 *   --decimate hi=768:lo=320:frac=0.33   mpdecimate options (lower = stricter)
 *   --out report.json    also write the JSON to this file
 *
 * ffmpeg and ffprobe are found through FFMPEG / FFPROBE, then PATH, then the
 * usual install folders (Homebrew, /usr/local, winget, Chocolatey, Scoop).
 *
 * Prints JSON: probe data, decoded vs expected frame counts, freezes
 * (freezedetect), runs of near-duplicate frames (mpdecimate), and "check": the
 * merged frame ranges to render and look at, each with its reason.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function usage(msg) {
  if (msg) { console.error(msg); }
  console.error('usage: node temporal-qa.js RENDER [--source FILE] [--crop x:y:w:h] [--noise 0.001] [--min 0.1] [--decimate hi=768:lo=320:frac=0.33] [--out report.json]');
  process.exit(2);
}

const argv = process.argv.slice(2);
if (!argv.length || argv[0].startsWith('--')) { usage(); }
const FILE = argv[0];
const o = { source: '', crop: '', noise: 0.001, min: 0.1, decimate: '', out: '' };
for (let i = 1; i < argv.length; i++) {
  const key = argv[i].replace(/^--/, '');
  if (!(key in o) || i + 1 >= argv.length) { usage('unknown or incomplete option ' + argv[i]); }
  o[key] = argv[++i];
}
for (const f of [FILE, o.source].filter(Boolean)) { if (!fs.existsSync(f)) { usage('no such file: ' + f); } }

/* Find a binary: env var, PATH, then the places installers put it. */
function findBin(name) {
  const exe = process.platform === 'win32' ? name + '.exe' : name;
  const env = process.env[name.toUpperCase()];
  const tries = [];
  if (env) { tries.push(env); }
  tries.push(exe);
  const home = os.homedir();
  if (process.platform === 'win32') {
    const pf = process.env.ProgramFiles || 'C:\\Program Files';
    const la = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    tries.push(path.join(pf, 'ffmpeg', 'bin', exe), 'C:\\ffmpeg\\bin\\' + exe,
      path.join(la, 'Microsoft', 'WinGet', 'Links', exe),
      'C:\\ProgramData\\chocolatey\\bin\\' + exe, path.join(home, 'scoop', 'shims', exe));
  } else {
    tries.push('/opt/homebrew/bin/' + exe, '/usr/local/bin/' + exe, '/usr/bin/' + exe,
      '/opt/local/bin/' + exe, '/snap/bin/' + exe);
  }
  for (const t of tries) {
    const r = spawnSync(t, ['-version'], { encoding: 'utf8' });
    if (!r.error && r.status === 0) { return t; }
  }
  console.error(name + ' not found. Install ffmpeg (brew install ffmpeg / winget install ffmpeg) or set ' + name.toUpperCase() + '.');
  process.exit(1);
}
const FFMPEG = findBin('ffmpeg');
const FFPROBE = findBin('ffprobe');

const BUF = 512 * 1024 * 1024;
function ffmpegLog(args) {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-nostats'].concat(args), { encoding: 'utf8', maxBuffer: BUF });
  if (r.error) { throw r.error; }
  if (r.status !== 0) { throw new Error('ffmpeg failed: ' + String(r.stderr).slice(-400)); }
  return String(r.stderr);
}

function probe(file) {
  const r = spawnSync(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-count_frames',
    '-show_entries', 'stream=width,height,r_frame_rate,avg_frame_rate,nb_read_frames:format=duration',
    '-of', 'json', file], { encoding: 'utf8', maxBuffer: BUF });
  if (r.status !== 0) { throw new Error('ffprobe failed on ' + file + ': ' + r.stderr); }
  const j = JSON.parse(r.stdout);
  const s = j.streams[0];
  const [n, d] = s.r_frame_rate.split('/').map(Number);
  const fps = d ? n / d : n;
  const duration = Number(j.format.duration);
  return { file, width: s.width, height: s.height, fps: Math.round(fps * 1000) / 1000,
    duration, decodedFrames: Number(s.nb_read_frames), expectedFrames: Math.round(duration * fps) };
}

function cropFilter(p) {
  if (!o.crop) { return ''; }
  const [x, y, w, h] = o.crop.split(':').map(Number);
  const ev = (v) => Math.max(2, Math.floor(v / 2) * 2);
  return 'crop=' + ev(w * p.width) + ':' + ev(h * p.height) + ':' + Math.floor(x * p.width) + ':' + Math.floor(y * p.height) + ',';
}

/* Frame index of every frame that leaves a filter chain, read from showinfo. */
function shownFrames(log, fps, t0) {
  const out = [];
  for (const m of log.matchAll(/Parsed_showinfo[^\]]*\]\s*n:\s*\d+\s+pts:\s*-?\d+\s+pts_time:\s*(-?[\d.e+-]+)/g)) {
    out.push(Math.round((Number(m[1]) - t0) * fps));
  }
  return out;
}

function ranges(frames) {
  const r = [];
  for (const f of frames) {
    const last = r[r.length - 1];
    if (last && f === last[1] + 1) { last[1] = f; } else { r.push([f, f]); }
  }
  return r;
}

function analyse(file) {
  const p = probe(file);
  const c = cropFilter(p);
  const fps = p.fps;

  /* Pass 1: freezedetect, and showinfo for every decoded frame. */
  const log1 = ffmpegLog(['-i', file, '-an', '-vf', c + 'freezedetect=n=' + o.noise + ':d=' + o.min + ',showinfo', '-f', 'null', '-']);
  const firstPts = (log1.match(/pts_time:\s*(-?[\d.e+-]+)/) || [])[1];
  const t0 = firstPts ? Number(firstPts) : 0;
  const all = shownFrames(log1, fps, t0);
  const starts = [...log1.matchAll(/freeze_start:\s*([\d.e+-]+)/g)].map((m) => Number(m[1]));
  const ends = [...log1.matchAll(/freeze_end:\s*([\d.e+-]+)/g)].map((m) => Number(m[1]));
  const freezes = starts.map((s, i) => {
    const e = i < ends.length ? ends[i] : p.duration;
    return { start: +(s - t0).toFixed(3), end: +(e - t0).toFixed(3), seconds: +(e - s).toFixed(3),
      startFrame: Math.round((s - t0) * fps), endFrame: Math.round((e - t0) * fps) - 1 };
  });

  /* Pass 2: mpdecimate drops near-duplicates of the frame before; what it
     drops is what did not change. One dropped frame is a one-frame hold. */
  const log2 = ffmpegLog(['-i', file, '-an', '-vf', c + 'mpdecimate' + (o.decimate ? '=' + o.decimate : '') + ',showinfo', '-f', 'null', '-']);
  const kept = new Set(shownFrames(log2, fps, t0));
  const dropped = all.filter((f) => !kept.has(f));
  return { probe: p, crop: o.crop || null, keptByMpdecimate: kept.size, freezes, dropped };
}

/* A dropped frame n repeats frame n - 1, so a run a..b is a hold from a - 1 to b. */
function holds(dropped, fps) {
  return ranges(dropped).map(([a, b]) => ({ startFrame: a - 1, endFrame: b, repeats: b - a + 1,
    start: +((a - 1) / fps).toFixed(3), end: +((b + 1) / fps).toFixed(3) }));
}

const render = analyse(FILE);
const report = { render: render.probe, crop: render.crop, freezes: render.freezes,
  duplicates: holds(render.dropped, render.probe.fps),
  counts: { decoded: render.probe.decodedFrames, expected: render.probe.expectedFrames,
    uniqueAfterMpdecimate: render.keptByMpdecimate,
    repeated: render.probe.decodedFrames - render.keptByMpdecimate } };
const problems = [];
if (render.probe.decodedFrames !== render.probe.expectedFrames) {
  problems.push('decoded ' + render.probe.decodedFrames + ' frames, duration × fps says ' + render.probe.expectedFrames);
}

if (o.source) {
  const src = analyse(o.source);
  report.source = { probe: src.probe, freezes: src.freezes, repeatedFrames: src.dropped.length };
  /* A freeze the source already had (same frames, mostly) is the footage, not the repair. */
  const shared = (a, b) => Math.max(0, Math.min(a.endFrame, b.endFrame) - Math.max(a.startFrame, b.startFrame) + 1);
  for (const f of report.freezes) {
    f.inSource = src.freezes.some((s) => shared(f, s) >= 0.5 * (f.endFrame - f.startFrame + 1));
  }
  /* Repeats are compared frame by frame: only frames that repeat in the
     render but not in the source are new. */
  const srcDropped = new Set(src.dropped);
  report.duplicates = holds(render.dropped.filter((f) => !srcDropped.has(f)), render.probe.fps);
  report.duplicatesAreNewOnly = true;
  if (src.probe.decodedFrames !== render.probe.decodedFrames) {
    problems.push('render has ' + render.probe.decodedFrames + ' frames, source has ' + src.probe.decodedFrames);
  }
  if (Math.abs(src.probe.fps - render.probe.fps) > 0.001) {
    problems.push('render is ' + render.probe.fps + ' fps, source is ' + src.probe.fps);
  }
}

/* The ranges to look at: every freeze and repeat not already in the source,
   padded by 2 frames and merged. */
const last = render.probe.decodedFrames - 1;
const want = [];
for (const f of report.freezes) { if (!f.inSource) { want.push([f.startFrame - 2, f.endFrame + 2, 'frozen ' + f.seconds + ' s']); } }
for (const d of report.duplicates) { want.push([d.startFrame - 2, d.endFrame + 2, d.repeats + ' repeated frame' + (d.repeats > 1 ? 's' : '')]); }
want.sort((a, b) => a[0] - b[0]);
const check = [];
for (const [a0, b0, why] of want) {
  const a = Math.max(0, a0), b = Math.min(last, b0);
  const prev = check[check.length - 1];
  if (prev && a <= prev.endFrame + 1) { prev.endFrame = Math.max(prev.endFrame, b); prev.why.push(why); }
  else { check.push({ startFrame: a, endFrame: b, why: [why] }); }
}
for (const r of check) {
  r.start = +(r.startFrame / render.probe.fps).toFixed(3);
  r.end = +((r.endFrame + 1) / render.probe.fps).toFixed(3);
  r.why = r.why.join('; ');
}
report.problems = problems;
report.check = check;
report.verdict = (problems.length || check.length)
  ? 'look at every range in "check" at full size before calling this clean'
  : 'no new freezes, repeats or count mismatch found - still watch it at full speed';

const text = JSON.stringify(report, null, 2);
if (o.out) { fs.writeFileSync(o.out, text); }
console.log(text);
