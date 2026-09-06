#!/usr/bin/env node
/*
 * Installs the CEP panel into After Effects. Node port of install.sh so that
 * `npx aftereffects-mcp-install` works for people who installed from npm.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const EXT_ID = 'com.aemcpbridge';
const SRC = path.join(__dirname, '..', 'panel');
const EXT_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'Adobe', 'CEP', 'extensions');
const TARGET = path.join(EXT_DIR, EXT_ID);

if (process.platform !== 'darwin') {
  console.error('This installer is macOS-only. Windows support is not implemented yet —\n' +
                'see https://github.com/solomondivyananth/aftereffects-mcp/issues');
  process.exit(1);
}
if (!fs.existsSync(SRC)) {
  console.error('Cannot find the panel source at ' + SRC);
  process.exit(1);
}

console.log('Enabling unsigned CEP extensions (PlayerDebugMode)');
for (const v of [9, 10, 11, 12]) {
  try {
    execFileSync('defaults', ['write', 'com.adobe.CSXS.' + v, 'PlayerDebugMode', '1'], { stdio: 'ignore' });
  } catch (e) { /* that CSXS version isn't present */ }
}
try { execFileSync('killall', ['cfprefsd'], { stdio: 'ignore' }); } catch (e) {}

fs.mkdirSync(EXT_DIR, { recursive: true });
if (fs.existsSync(TARGET) || fs.lstatSync(TARGET, { throwIfNoEntry: false })) {
  console.log('Removing previous install at ' + TARGET);
  fs.rmSync(TARGET, { recursive: true, force: true });
}

console.log('Copying panel to ' + TARGET);
fs.cpSync(SRC, TARGET, { recursive: true, filter: (s) => !path.basename(s).startsWith('._') });

console.log(`
Installed.

Next:
  1. Quit and relaunch After Effects (PlayerDebugMode is read at launch).
  2. Window > Extensions > AE MCP Bridge — expect "Listening on 127.0.0.1:7788".
  3. Open the project you want to work on and click "Use current project as sandbox".

Register the server with your MCP client, e.g. for Claude Code:
  claude mcp add after-effects -- npx -y aftereffects-mcp
`);
