#!/usr/bin/env node
/*
 * Installs the CEP panel into After Effects, on macOS and Windows.
 *
 *   npx aftereffects-mcp-install          copy the panel (what npm users want)
 *   node bin/install-panel.js --link      link it to this checkout, so edits
 *                                         are live (macOS symlink, Windows
 *                                         junction — neither needs admin)
 *   node bin/install-panel.js --uninstall
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const EXT_ID = 'com.aemcpbridge';
const SRC = path.join(__dirname, '..', 'panel');
const CSXS_VERSIONS = [9, 10, 11, 12];
const args = process.argv.slice(2);

function extensionsDir() {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Adobe', 'CEP', 'extensions');
  }
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Adobe', 'CEP', 'extensions');
  }
  console.error('After Effects runs on macOS and Windows only.');
  process.exit(1);
}

/* CEP only loads unsigned panels with PlayerDebugMode on. It is read when
   After Effects starts, per CSXS runtime version. */
function enableUnsignedPanels() {
  for (const v of CSXS_VERSIONS) {
    try {
      if (process.platform === 'darwin') {
        execFileSync('defaults', ['write', 'com.adobe.CSXS.' + v, 'PlayerDebugMode', '1'], { stdio: 'ignore' });
      } else {
        execFileSync('reg', ['add', 'HKCU\\Software\\Adobe\\CSXS.' + v, '/v', 'PlayerDebugMode',
          '/t', 'REG_SZ', '/d', '1', '/f'], { stdio: 'ignore' });
      }
    } catch (e) { /* that runtime version isn't present */ }
  }
  if (process.platform === 'darwin') {
    try { execFileSync('killall', ['cfprefsd'], { stdio: 'ignore' }); } catch (e) {}
  }
}

function removeExisting(target) {
  let st = null;
  try { st = fs.lstatSync(target); } catch (e) { return; }
  console.log('Removing previous install at ' + target);
  if (st.isSymbolicLink()) { fs.unlinkSync(target); }
  else { fs.rmSync(target, { recursive: true, force: true }); }
}

const EXT_DIR = extensionsDir();
const TARGET = path.join(EXT_DIR, EXT_ID);

if (args.includes('--uninstall')) {
  removeExisting(TARGET);
  console.log('Uninstalled. Relaunch After Effects to drop the panel from the menu.');
  process.exit(0);
}
if (!fs.existsSync(path.join(SRC, 'CSXS', 'manifest.xml'))) {
  console.error('Cannot find the panel source at ' + SRC);
  process.exit(1);
}

console.log('Enabling unsigned CEP extensions (PlayerDebugMode)');
enableUnsignedPanels();

fs.mkdirSync(EXT_DIR, { recursive: true });
removeExisting(TARGET);

if (args.includes('--link')) {
  console.log('Linking ' + TARGET + ' → ' + SRC);
  fs.symlinkSync(SRC, TARGET, process.platform === 'win32' ? 'junction' : 'dir');
} else {
  console.log('Copying panel to ' + TARGET);
  fs.cpSync(SRC, TARGET, { recursive: true, filter: (s) => !path.basename(s).startsWith('._') && path.basename(s) !== '.DS_Store' });
}

const serverCmd = args.includes('--link')
  ? 'claude mcp add after-effects -- node "' + path.join(__dirname, '..', 'mcp', 'ae-mcp.js') + '"'
  : 'claude mcp add after-effects -- npx -y aftereffects-mcp';

console.log(`
Installed.

Next:
  1. Quit and relaunch After Effects (PlayerDebugMode is read at launch).
  2. Window > Extensions > AE MCP Bridge. Expect "Listening on 127.0.0.1:7788".
  3. Open the project you want to work on and click "Use current" next to Sandbox.

Register the server with your MCP client, e.g. for Claude Code:
  ${serverCmd}
`);
