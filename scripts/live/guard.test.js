#!/usr/bin/env node
// The guard, the panel switches, and render jobs across panel reloads, against
// a live AE. Temporarily rewrites the panel's settings file and restores it
// exactly at the end.  npm run test:live
'use strict';
const fs = require('fs');
const path = require('path');
const { STATE, WORK, panel, reloadPanel, record, finish, sleep } = require('./common');
const PROJ = path.join(WORK, 'bridge-test.aep');
const OTHER = path.join(WORK, 'other-test.aep');
const call = panel;
async function setState(patch) {
  const s = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  Object.assign(s, patch);
  fs.writeFileSync(STATE, JSON.stringify(s, null, 2), { mode: 0o600 });
  await reloadPanel();
}
const check = record;

(async () => {
  const original = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  let info = await call('project_info');
  if (info.result.projectPath === OTHER) {
    await call('open_project', { path: PROJ, saveFirst: true });
    info = await call('project_info');
  }
  if (info.result.projectPath !== PROJ) { console.log('REFUSING: not on ' + PROJ); process.exit(2); }
  const C = info.result.comps[0].name;
  try {
    // --- guard on, this project is the sandbox ---
    await setState({ guardEnabled: true, sandboxPath: PROJ });
    let r = await call('create_layer', { comp: C, kind: 'null', options: { name: 'G1' } });
    check('guard on + sandbox = this project → write allowed', r.ok, r.error);
    r = await call('new_project', { discardUnsavedChanges: true });
    check('guard on → new_project refused', !r.ok && /closes the open project/.test(r.error), r.error);
    r = await call('open_project', { path: PROJ, saveFirst: true });
    check('guard on → open_project refused', !r.ok && /closes the open project/.test(r.error), r.error);

    // --- raw call switches project behind the guard → flagged ---
    r = await call('run_jsx', { code: 'app.project.save(new File(' + JSON.stringify(OTHER) + ')); 1' });
    check('raw call that switches project is flagged', r.ok && r.result.warning && /changed the open project/.test(r.result.warning), JSON.stringify(r));
    r = await call('create_layer', { comp: C, kind: 'null', options: { name: 'G2' } });
    check('guard then refuses writes to the other project', !r.ok && /Guard refused/.test(r.error), r.error);
    r = await call('project_info');
    check('reads still work outside the sandbox', r.ok);
    r = await call('render_frame', { comp: C, time: 0 });
    check('renders still work outside the sandbox', r.ok, r.error);
    r = await call('catalog', { kind: 'effects', query: 'glow', limit: 2 });
    check('catalog still works outside the sandbox', r.ok, r.error);
    // only the human can unlock: do it the way they would (panel state), then go back
    await setState({ guardEnabled: false });
    r = await call('open_project', { path: PROJ, saveFirst: true });
    check('unlocked → back to the test project', r.ok && r.result.projectPath === PROJ, JSON.stringify(r));

    // --- guard on, no sandbox set ---
    await setState({ guardEnabled: true, sandboxPath: null });
    r = await call('create_layer', { comp: C, kind: 'null' });
    check('guard on + no sandbox → refused with instructions', !r.ok && /Use current project as sandbox/.test(r.error), r.error);

    // --- raw switch off ---
    await setState({ guardEnabled: false, allowRaw: false });
    r = await call('run_jsx', { code: '1' });
    check('raw off → run_jsx refused', !r.ok && /switched off/.test(r.error), r.error);
    r = await call('menu_command', { command: 'Deselect All' });
    check('raw off → menu_command refused', !r.ok && /switched off/.test(r.error), r.error);
    r = await call('create_layer', { comp: C, kind: 'null', options: { name: 'G3' } });
    check('raw off → dedicated tools still work', r.ok, r.error);

    // --- reveal off: edits leave selection alone ---
    await setState({ allowRaw: true, reveal: false });
    await call('goto', { comp: C, layer: 1 });
    const selBefore = (await call('selection')).result.layers.map((l) => l.name).join(',');
    r = await call('create_layer', { comp: C, kind: 'null', options: { name: 'G4' } });
    const selAfter = (await call('selection')).result.layers.map((l) => l.name).join(',');
    check('reveal off → selection untouched (' + selBefore + ' / ' + selAfter + ')', r.ok && !/G4/.test(selAfter));
    await setState({ reveal: true });
    r = await call('create_layer', { comp: C, kind: 'null', options: { name: 'G5' } });
    const selOn = (await call('selection')).result.layers.map((l) => l.name).join(',');
    check('reveal on → new layer selected (' + selOn + ')', r.ok && selOn === 'G5');

    // --- render job survives a panel reload, and can still be cancelled ---
    await call('save_project');
    r = await call('render_start', { comp: C, output: path.join(WORK, 'persist.mov'), save: false });
    check('long render started', r.ok, r.error);
    const id = r.ok && r.result.jobId;
    await reloadPanel();
    r = await call('render_status', { jobId: id });
    check('after reload the job is still known and running', r.ok && r.result.status === 'running', JSON.stringify(r).slice(0, 300));
    r = await call('render_cancel', { jobId: id });
    check('cancel after reload → cancelled', r.ok && r.result.status === 'cancelled', JSON.stringify(r).slice(0, 300));
    await sleep(2000);
    let alive = true;
    const jobs = JSON.parse(fs.readFileSync(path.join(path.dirname(STATE), '.ae-mcp-bridge', 'renders', 'jobs.json'), 'utf8'));
    try { process.kill(jobs[id].pid, 0); } catch (e) { alive = false; }
    check('aerender process actually stopped', !alive);
  } finally {
    // restore the user's panel settings exactly
    fs.writeFileSync(STATE, JSON.stringify(original, null, 2), { mode: 0o600 });
    await reloadPanel();
    try { fs.unlinkSync(OTHER); } catch (e) {}
  }
  process.exit(finish());
})();
