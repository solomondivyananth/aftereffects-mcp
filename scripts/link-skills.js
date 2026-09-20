#!/usr/bin/env node
/*
 * link-skills.js — make every skill in skills/ discoverable by the agent
 * working in this repo.
 *
 *   npm run skills            link them into ./.claude/skills
 *   npm run skills -- --user  link them into ~/.claude/skills instead, so
 *                             they load in every project on this machine
 *
 * Claude Code reads .claude/skills, not skills/, so a new skill is invisible
 * until it is linked. Links (a copy on Windows, where symlinks need a
 * privilege) are rebuilt every run, and stale ones are removed.
 *
 * Other MCP clients don't need this: the server serves every skill as a
 * prompt of the same name.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'skills');
const toUser = process.argv.includes('--user');
const DST = toUser ? path.join(os.homedir(), '.claude', 'skills') : path.join(ROOT, '.claude', 'skills');

const skills = fs.readdirSync(SRC).filter((n) => fs.existsSync(path.join(SRC, n, 'SKILL.md')));
fs.mkdirSync(DST, { recursive: true });

/* Only ever touch entries that are ours: a link pointing into skills/, or a
   copy of one. Anything else in there belongs to the user. */
const mine = new Set(skills);
let linked = 0, removed = 0;

for (const name of fs.readdirSync(DST)) {
  const p = path.join(DST, name);
  let target = null;
  try { target = fs.readlinkSync(p); } catch (e) { /* not a link */ }
  const ours = (target && target.includes(path.join('skills', name))) ||
    (!target && fs.existsSync(path.join(p, '.from-ae-mcp')));
  if (ours && !mine.has(name)) {
    fs.rmSync(p, { recursive: true, force: true });
    removed++;
  }
}

for (const name of skills) {
  const src = path.join(SRC, name);
  const dst = path.join(DST, name);
  try { fs.rmSync(dst, { recursive: true, force: true }); } catch (e) {}
  try {
    fs.symlinkSync(path.relative(DST, src), dst, 'dir');
  } catch (e) {
    /* Windows without Developer Mode: copy instead, and mark the copy ours. */
    fs.cpSync(src, dst, { recursive: true });
    fs.writeFileSync(path.join(dst, '.from-ae-mcp'), name + '\n');
  }
  linked++;
}

console.log('✓ ' + linked + ' skills available in ' + DST.replace(os.homedir(), '~') +
  (removed ? ' (' + removed + ' stale removed)' : ''));
