// Shared helpers for the live tests. They drive a REAL After Effects, so they
// refuse to run unless the open project's path contains "test", "scratch" or
// "sandbox". Use a throwaway project, e.g. ~/.ae-mcp-bridge/test/bridge-test.aep.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const STATE = path.join(os.homedir(), '.ae-mcp-bridge.json');
const WORK = path.join(os.homedir(), '.ae-mcp-bridge', 'test');
const AE_ID = 'com.adobe.AfterEffects.application';
fs.mkdirSync(WORK, { recursive: true });

const agent = new http.Agent({ keepAlive: true });
function token() { return JSON.parse(fs.readFileSync(STATE, 'utf8')).token; }

/* Straight to the panel over HTTP, bypassing the MCP server. Retries while
   the panel is (re)starting. */
async function panel(fn, args) {
  for (let i = 0; ; i++) {
    try { return await panelOnce(fn, args); }
    catch (e) { if (i >= 10) { throw e; } await sleep(1000); }
  }
}
function panelOnce(fn, args) {
  const body = JSON.stringify({ fn, args: args || {} });
  return new Promise((res, rej) => {
    const r = http.request({ agent, host: '127.0.0.1', port: 7788, path: '/call', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-AE-Bridge-Token': token(), 'Content-Length': Buffer.byteLength(body) } },
      (resp) => { let d = ''; resp.on('data', (c) => { d += c; }); resp.on('end', () => res(JSON.parse(d))); });
    r.on('error', rej); r.write(body); r.end();
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Close and reopen the panel through AE's own scheduler (AppleScript
   DoScript, so it works even when the guard refuses bridge writes). */
async function reloadPanel() {
  execFileSync('osascript', ['-e', 'tell application id "' + AE_ID + '" to DoScript ' +
    '"var id = app.findMenuCommandId(\\"AE MCP Bridge\\"); app.scheduleTask(\\"app.executeCommand(\\" + id + \\")\\", 300, false); ' +
    'app.scheduleTask(\\"app.executeCommand(\\" + id + \\")\\", 3500, false);"']);
  await sleep(2500);
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    try { const h = await panelOnce('project_info'); if (h.ok) { await sleep(500); return; } } catch (e) {}
  }
  throw new Error('panel did not come back after reload');
}

/* Dialogs show up as extra AE windows. Optional: needs swiftc (Xcode tools). */
let winBin = null;
function aeWindows() {
  if (winBin === null) {
    winBin = path.join(os.homedir(), '.ae-mcp-bridge', 'aewins');
    try {
      if (!fs.existsSync(winBin)) { execFileSync('swiftc', ['-O', path.join(__dirname, 'aewins.swift'), '-o', winBin], { stdio: 'ignore' }); }
    } catch (e) { winBin = false; }
  }
  if (!winBin) { return []; }
  try {
    return execFileSync(winBin, { encoding: 'utf8' }).split('\n').filter(Boolean)
      .map((l) => l.split(' ')).filter((w) => +w[2] > 100 && +w[3] > 100).map((w) => w[0] + ' ' + w.slice(4).join(' '));
  } catch (e) { return []; }
}

function assertScratch(projectPath) {
  if (!/test|scratch|sandbox/i.test(projectPath || '')) {
    console.log('REFUSING: the open project is "' + projectPath + '".\n' +
      'Open a throwaway project whose path contains "test", e.g. ' + path.join(WORK, 'bridge-test.aep'));
    process.exit(2);
  }
}

const results = [];
function record(label, ok, note) {
  results.push({ label, ok, note });
  console.log((ok ? 'PASS ' : 'FAIL ') + label + (ok ? '' : '\n     ' + String(note || '').slice(0, 400)));
}
function finish() {
  const failed = results.filter((r) => !r.ok);
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' passed');
  failed.forEach((f) => console.log('  ✗ ' + f.label));
  return failed.length ? 1 : 0;
}

module.exports = { ROOT, STATE, WORK, panel, reloadPanel, aeWindows, assertScratch, record, finish, sleep };
