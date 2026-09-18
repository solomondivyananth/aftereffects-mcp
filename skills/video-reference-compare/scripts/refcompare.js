#!/usr/bin/env node
/*
 * Frame-by-frame comparison of a candidate video against a reference.
 * Needs only ffmpeg and ffprobe. Runs on macOS, Windows and Linux.
 *
 *   node refcompare.js REF CAND OUT.png [options]
 *
 *   --times 1.2,2.0,2.0333      compare at these seconds (both videos, same timestamp)
 *   --range 1.9:2.4             every frame in this window...
 *   --fps 30                    ...sampled at this rate (default: the reference's own rate)
 *   --tc 9:03,21:16             timecodes as editors say them: seconds:frame (9:03 = 9 s + 3 frames)
 *   --offset 0.0667             candidate time = reference time + offset (for a shifted cut)
 *   --crop 0.3:0.3:0.4:0.4      x:y:w:h as fractions of the frame, applied to both (zoom in on a detail)
 *   --width 480                 width of each cell (default 480)
 *   --cols 6                    cells per row before wrapping (default 6)
 *   --diff                      add a third row: absolute difference (bright = mismatch)
 *
 * Output: one PNG. Each column is one timestamp: reference on top, candidate
 * below, difference under that with --diff. The timestamps are printed in
 * order so the columns can be read without burned-in labels.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

function usage(msg) {
  if (msg) { console.error(msg); }
  console.error('usage: node refcompare.js REF CAND OUT.png [--times …|--range a:b|--tc s:f] [--fps n] [--offset s] [--crop x:y:w:h] [--width n] [--cols n] [--diff]');
  process.exit(2);
}

const argv = process.argv.slice(2);
if (argv.length < 3) { usage(); }
const [REF, CAND, OUT] = argv;
const o = { times: '', range: '', fps: '', tc: '', offset: 0, crop: '', width: 480, cols: 6, diff: false };
for (let i = 3; i < argv.length; i++) {
  const k = argv[i];
  if (k === '--diff') { o.diff = true; continue; }
  const key = k.replace(/^--/, '');
  if (!(key in o) || i + 1 >= argv.length) { usage('unknown or incomplete option ' + k); }
  o[key] = argv[++i];
}
for (const f of [REF, CAND]) { if (!fs.existsSync(f)) { usage('no such file: ' + f); } }

const run = (bin, args) => execFileSync(bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function rate(file) {
  const r = run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate', '-of', 'csv=p=0', file]).trim();
  const [n, d] = r.split('/').map(Number);
  return d ? n / d : n;
}

const refFps = rate(REF);
const fps = o.fps ? Number(o.fps) : refFps;

/* ffmpeg's -ss returns the first frame whose pts >= t, so frame n is asked
   for at (n - 0.25) / fps: early enough to be that frame, never the next. */
const list = [];
if (o.tc) {
  for (const tc of o.tc.split(',')) {
    const [s, f] = tc.split(':').map(Number);
    list.push((s * refFps + f - 0.25) / refFps);
  }
}
if (o.times) { o.times.split(',').forEach((t) => list.push(Number(t))); }
if (o.range) {
  const [a, b] = o.range.split(':').map(Number);
  const n = Math.round((b - a) * fps);
  for (let i = 0; i <= n; i++) { list.push(Math.max(0, a + (i - 0.25) / fps)); }
}
if (!list.length) { usage('give --times, --tc or --range'); }

const W = Number(o.width);
const H = Math.floor(W * 9 / 16 / 2) * 2;
let vf = 'scale=' + W + ':' + H + ':force_original_aspect_ratio=increase,crop=' + W + ':' + H + ',setsar=1';
if (o.crop) {
  const [cx, cy, cw, ch] = o.crop.split(':');
  vf = 'crop=iw*' + cw + ':ih*' + ch + ':iw*' + cx + ':ih*' + cy + ',' + vf;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'refcompare-'));
try {
  list.forEach((t, idx) => {
    const n = String(idx + 1).padStart(4, '0');
    const tc = (t + Number(o.offset)).toFixed(4);
    const r = path.join(tmp, 'r' + n + '.png'), c = path.join(tmp, 'c' + n + '.png'), s = path.join(tmp, 's' + n + '.png');
    run('ffmpeg', ['-v', 'error', '-y', '-ss', t.toFixed(4), '-i', REF, '-frames:v', '1', '-vf', vf, r]);
    run('ffmpeg', ['-v', 'error', '-y', '-ss', tc, '-i', CAND, '-frames:v', '1', '-vf', vf, c]);
    if (o.diff) {
      const d = path.join(tmp, 'd' + n + '.png');
      run('ffmpeg', ['-v', 'error', '-y', '-i', r, '-i', c, '-filter_complex', 'blend=all_mode=difference,eq=brightness=0.05:contrast=2', d]);
      run('ffmpeg', ['-v', 'error', '-y', '-i', r, '-i', c, '-i', d, '-filter_complex', 'vstack=inputs=3', s]);
    } else {
      run('ffmpeg', ['-v', 'error', '-y', '-i', r, '-i', c, '-filter_complex', 'vstack=inputs=2', s]);
    }
  });

  /* A numbered sequence, not a glob: Windows builds of ffmpeg have no glob. */
  const N = list.length, C = Math.min(N, Number(o.cols)), R = Math.ceil(N / C);
  run('ffmpeg', ['-v', 'error', '-y', '-framerate', '1', '-start_number', '1', '-i', path.join(tmp, 's%04d.png'),
    '-vf', 'tile=' + C + 'x' + R + ':padding=4:color=white', '-frames:v', '1', OUT]);
  console.log('wrote ' + OUT + '  (' + C + ' x ' + R + '; ref on top, candidate below' + (o.diff ? ', difference third' : '') + ')');
  list.forEach((t, i) => console.log('  col ' + (i + 1) + '  t=' + t.toFixed(4) + 's'));
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
