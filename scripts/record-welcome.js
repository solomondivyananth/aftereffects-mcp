#!/usr/bin/env node
/*
 * record-welcome.js — renders docs/stomp.html frame by frame in headless
 * Chrome and encodes docs/assets/welcome.mp4 and welcome.gif for the README.
 * The animation is deterministic (render(t)), so every frame is exact.
 *
 *   node scripts/record-welcome.js            # needs Chrome and ffmpeg
 *   CHROME=/path/to/chrome node scripts/record-welcome.js
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PAGE = path.join(ROOT, 'docs', 'stomp.html');
const OUT = path.join(ROOT, 'docs', 'assets');
const FPS = 24;
const DURATION = 13.5;
const W = 1280, H = 720;

function findChrome() {
  if (process.env.CHROME) { return process.env.CHROME; }
  const names = ['Google Chrome.app/Contents/MacOS/Google Chrome', 'Chromium.app/Contents/MacOS/Chromium'];
  const roots = ['/Applications', path.join(os.homedir(), 'Applications')];
  try { fs.readdirSync('/Volumes').forEach((v) => roots.push(path.join('/Volumes', v, 'Applications'))); } catch (e) {}
  for (const r of roots) { for (const n of names) { const p = path.join(r, n); if (fs.existsSync(p)) { return p; } } }
  for (const bin of ['google-chrome', 'chromium', 'chromium-browser']) {
    try { return execFileSync('which', [bin], { encoding: 'utf8' }).trim(); } catch (e) {}
  }
  throw new Error('Chrome not found. Set CHROME=/path/to/chrome.');
}

function shoot(chrome, t, file) {
  return new Promise((resolve, reject) => {
    execFile(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
      '--virtual-time-budget=4000', '--window-size=' + W + ',' + H, '--screenshot=' + file,
      'file://' + PAGE + '?t=' + t.toFixed(4)], { timeout: 60000 }, (err) => (err ? reject(err) : resolve()));
  });
}

(async () => {
  const chrome = findChrome();
  const frames = fs.mkdtempSync(path.join(os.tmpdir(), 'welcome-'));
  const total = Math.round(DURATION * FPS);
  let next = 0, done = 0;
  const workers = Array.from({ length: Math.max(2, Math.min(8, os.cpus().length)) }, async () => {
    while (next < total) {
      const i = next++;
      await shoot(chrome, i / FPS, path.join(frames, String(i).padStart(4, '0') + '.png'));
      if (++done % 24 === 0) { process.stdout.write('\r' + done + '/' + total + ' frames'); }
    }
  });
  await Promise.all(workers);
  console.log('\r' + total + '/' + total + ' frames');

  fs.mkdirSync(OUT, { recursive: true });
  const pattern = path.join(frames, '%04d.png');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', pattern,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', path.join(OUT, 'welcome.mp4')]);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', pattern,
    '-vf', 'fps=12,scale=720:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=64[p];[b][p]paletteuse=dither=bayer:bayer_scale=4',
    path.join(OUT, 'welcome.gif')]);
  fs.rmSync(frames, { recursive: true, force: true });
  for (const f of ['welcome.mp4', 'welcome.gif']) {
    console.log(f + '  ' + (fs.statSync(path.join(OUT, f)).size / 1048576).toFixed(1) + ' MB');
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
