#!/usr/bin/env node
/*
 * breakdown.js — the mechanical half of reverse-engineering a reference film.
 * Needs Node, ffmpeg and ffprobe. Runs on macOS, Windows and Linux.
 *
 *   node breakdown.js VIDEO OUTDIR [options]
 *
 *   --threshold 0.3        scene-change sensitivity for cut detection (0-1, lower finds more)
 *   --overview-fps 1       frames per second in the overview sheets
 *   --cols 6               tiles per row in every sheet
 *   --windows 0.9:2.1,13.7:16   extra windows to study, in seconds
 *   --strip-fps 10         sampling rate inside strips (use the video's rate for every frame)
 *   --pad 0.5              seconds either side of each cut in its strip
 *   --width 480            tile width
 *
 * Writes into OUTDIR:
 *   overview_1.png …       the whole film at --overview-fps; tile n (0-based, reading order)
 *                          is at n / overview-fps seconds
 *   cut_<t>.png            a strip around every detected cut
 *   window_<a>-<b>.png     a strip for every --windows entry
 *   breakdown.json         probe data, cut times, and what each file covers
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

function usage(msg) {
  if (msg) { console.error(msg); }
  console.error('usage: node breakdown.js VIDEO OUTDIR [--threshold 0.3] [--overview-fps 1] [--windows a:b,…] [--strip-fps 10] [--pad 0.5] [--cols 6] [--width 480]');
  process.exit(2);
}

const argv = process.argv.slice(2);
if (argv.length < 2) { usage(); }
const [VIDEO, OUT] = argv;
const o = { threshold: 0.3, 'overview-fps': 1, cols: 6, windows: '', 'strip-fps': 10, pad: 0.5, width: 480 };
for (let i = 2; i < argv.length; i++) {
  const key = argv[i].replace(/^--/, '');
  if (!(key in o) || i + 1 >= argv.length) { usage('unknown or incomplete option ' + argv[i]); }
  o[key] = argv[++i];
}
if (!fs.existsSync(VIDEO)) { usage('no such file: ' + VIDEO); }
fs.mkdirSync(OUT, { recursive: true });

const run = (bin, args) => execFileSync(bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
const ffmpegLog = (args) => {
  try { execFileSync('ffmpeg', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }); return ''; }
  catch (e) { return String(e.stderr || ''); }
};

/* 1. Probe. */
const probe = JSON.parse(run('ffprobe', ['-v', 'error', '-show_entries',
  'stream=codec_type,width,height,r_frame_rate:format=duration', '-of', 'json', VIDEO]));
const v = probe.streams.find((s) => s.codec_type === 'video');
const [fn, fd] = v.r_frame_rate.split('/').map(Number);
const fps = fd ? fn / fd : fn;
const duration = Number(probe.format.duration);
const hasAudio = probe.streams.some((s) => s.codec_type === 'audio');

/* 2. Cuts: frames whose scene-change score passes the threshold. showinfo
      reports them on stderr, which spawnSync keeps whatever the exit code. */
const cutLog = String(spawnSync('ffmpeg', ['-hide_banner', '-i', VIDEO, '-vf',
  "select='gt(scene," + Number(o.threshold) + ")',showinfo", '-f', 'null', '-'],
{ encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).stderr || '');
const cuts = [];
for (const m of cutLog.matchAll(/pts_time:([0-9.]+)/g)) {
  const t = Number(m[1]);
  if (!cuts.length || t - cuts[cuts.length - 1] > 2 / fps) { cuts.push(Math.round(t * 1000) / 1000); }
}

const W = Number(o.width), C = Number(o.cols);
const files = [];

/* 3. Overview sheets: the whole film, a few frames a second. */
const ofps = Number(o['overview-fps']);
const perSheet = C * C;
const sheets = Math.ceil(duration * ofps / perSheet);
ffmpegLog(['-v', 'error', '-y', '-i', VIDEO, '-vf',
  'fps=' + ofps + ',scale=' + W + ':-2,tile=' + C + 'x' + C + ':padding=3:color=gray',
  path.join(OUT, 'overview_%d.png')]);
for (let i = 1; i <= sheets; i++) {
  const from = (i - 1) * perSheet / ofps;
  files.push({ file: 'overview_' + i + '.png', covers: [from, Math.min(duration, from + perSheet / ofps)],
    reading: 'tile n (0-based, left to right, top to bottom) is at ' + from + ' + n / ' + ofps + ' s' });
}

/* 4. Strips around each cut and each requested window. */
function strip(name, a, b) {
  const sfps = Number(o['strip-fps']);
  const n = Math.max(1, Math.round((b - a) * sfps));
  const rows = Math.ceil(n / C);
  ffmpegLog(['-v', 'error', '-y', '-ss', a.toFixed(3), '-t', (b - a).toFixed(3), '-i', VIDEO, '-vf',
    'fps=' + sfps + ',scale=' + W + ':-2,tile=' + C + 'x' + rows + ':padding=3:color=gray', '-frames:v', '1',
    path.join(OUT, name)]);
  files.push({ file: name, covers: [a, b],
    reading: 'tile n is at ' + a.toFixed(3) + ' + n / ' + sfps + ' s (' + (sfps >= fps ? 'every frame' : 'every ' + Math.round(fps / sfps) + ' frames') + ')' });
}
const pad = Number(o.pad);
for (const t of cuts) { strip('cut_' + t.toFixed(2) + '.png', Math.max(0, t - pad), Math.min(duration, t + pad)); }
if (o.windows) {
  for (const w of String(o.windows).split(',')) {
    const [a, b] = w.split(':').map(Number);
    strip('window_' + a + '-' + b + '.png', a, b);
  }
}

const report = { video: path.resolve(VIDEO), width: v.width, height: v.height, fps: Math.round(fps * 1000) / 1000,
  duration: Math.round(duration * 1000) / 1000, hasAudio, cuts, files };
fs.writeFileSync(path.join(OUT, 'breakdown.json'), JSON.stringify(report, null, 2));
console.log(v.width + 'x' + v.height + ' · ' + report.fps + ' fps · ' + report.duration + ' s · ' + cuts.length + ' cut(s)' + (hasAudio ? ' · audio' : ''));
console.log('cuts: ' + (cuts.length ? cuts.join(', ') : 'none (continuous: look for transitions in the overview)'));
files.forEach((f) => console.log('  ' + f.file + '  ' + f.covers.map((x) => x.toFixed(2)).join('–') + ' s'));
