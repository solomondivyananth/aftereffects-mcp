#!/usr/bin/env node
// End-to-end: every tool through the real MCP server, against a live AE.
// Run with a throwaway project open (see common.js).  npm run test:live
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ROOT, WORK, aeWindows, assertScratch, record, finish } = require('./common');

const proc = spawn(process.execPath, [path.join(ROOT, 'mcp', 'ae-mcp.js')], { stdio: ['pipe', 'pipe', 'inherit'] });
let buf = '', seq = 0;
const waiting = new Map();
proc.stdout.on('data', (d) => {
  buf += d;
  let nl;
  while ((nl = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
    const m = JSON.parse(line);
    if (waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
  }
});
function rpc(method, params) {
  const id = ++seq;
  return new Promise((res) => { waiting.set(id, res); proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
}
async function call(name, args) {
  const m = await rpc('tools/call', { name, arguments: args || {} });
  const r = m.result;
  const txt = r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  const images = r.content.filter((c) => c.type === 'image').length;
  let data = null; try { data = JSON.parse(txt); } catch (e) {}
  return { error: r.isError ? txt : null, data, txt, images };
}

let baseline = null;
async function t(label, name, args, check) {
  let r;
  if (!baseline) { baseline = new Set(aeWindows()); }
  try { r = await call(name, args); } catch (e) { r = { error: 'THREW ' + e.message }; }
  let extra = aeWindows().filter((w) => !baseline.has(w) && !/Adobe After Effects 20/.test(w));
  if (extra.length) {
    /* Progress windows (Save Project, rendering) come and go; a dialog stays. */
    await new Promise((res) => setTimeout(res, 1500));
    const still = new Set(aeWindows());
    extra = extra.filter((w) => still.has(w));
    if (extra.length) { record('no dialog after ' + label, false, extra.join(' | ')); extra.forEach((w) => baseline.add(w)); }
  }
  let ok, note = '';
  try { ok = check ? check(r) : !r.error; } catch (e) { ok = false; note = 'check threw ' + e.message; }
  record(label, ok, note || (r.error || JSON.stringify(r.data)));
  return r;
}

(async () => {
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'live', version: '0' } });

  const info = await call('ae_project_info');
  const p = info.data && info.data.projectPath || '';
  assertScratch(p);
  console.log('Project: ' + p + '\n');
  const RUN = String(Date.now() % 100000);
  const C = 'MCP Test ' + RUN, TGT = 'MCP Target ' + RUN;
  const out = WORK;

  // --- build ---
  await t('create_comp', 'ae_create_comp', { name: C, width: 1920, height: 1080, frameRate: 30, duration: '0:00:05:00', bgColor: '#101820' },
    (r) => !r.error && r.data.duration === 5);
  await t('create_layer solid hex', 'ae_create_layer', { comp: C, kind: 'solid', options: { name: 'BG', color: '#3366ff' } });
  await t('create_layer text+style', 'ae_create_layer', { comp: C, kind: 'text', options: { name: 'Title', text: 'Hello Bridge', style: { fontSize: 120, fillColor: '#ffffff', justification: 'center' } } });
  await t('create_layer null', 'ae_create_layer', { comp: C, kind: 'null', options: { name: 'Ctrl' } });
  await t('shape rect+stroke+trim', 'ae_shape', { comp: C, name: 'Box', shape: 'rect', size: [400, 200], roundness: 20,
    fill: '#ff8800', stroke: { color: '#ffffff', width: 6 }, trim: { start: 0, end: 100 } },
    (r) => !r.error && r.data.groups.length === 1);
  await t('shape add ellipse into layer', 'ae_shape', { comp: C, layer: 'Box', shapes: [{ shape: 'ellipse', size: [100, 100], fill: '#00ff00', name: 'Dot' }] });
  await t('comp_tree', 'ae_comp_tree', { comp: C }, (r) => !r.error && r.data.layers.length === 4);

  // --- properties & keys ---
  await t('set_property before/after', 'ae_set_property', { comp: C, layer: 'Title', path: ['Transform', 'Position'], value: [960, 300] },
    (r) => !r.error && r.data.before && r.data.after[1] === 300);
  await t('add_keyframes frames/timecode/easy', 'ae_add_keyframes', { comp: C, layer: 'Box', path: ['Transform', 'Position'], keys: [
    { time: '0f', value: [300, 540] }, { time: '0:00:01:00', value: [960, 540], ease: 'easy' }, { time: 2, value: [1600, 540], ease: 'easy_in' }] },
    (r) => !r.error && r.data.numKeys === 3 && r.data.keys[1].frame === 30 && Math.abs(r.data.keys[1].inInfluence - 33.333) < 0.01);
  await t('edit_keyframes shift 10f', 'ae_edit_keyframes', { comp: C, layer: 'Box', path: ['Transform', 'Position'], keys: 'all', shift: '10f' },
    (r) => !r.error && r.data.keys[0].frame === 10 && r.data.keys[2].frame === 70);
  await t('edit_keyframes scaleTime 2', 'ae_edit_keyframes', { comp: C, layer: 'Box', path: ['Transform', 'Position'], scaleTime: 2 },
    (r) => !r.error && r.data.keys[1].frame === 70 && r.data.keys[2].frame === 130);
  await t('edit_keyframes ease easy_out on key 1', 'ae_edit_keyframes', { comp: C, layer: 'Box', path: ['Transform', 'Position'], keys: [1], ease: 'easy_out' },
    (r) => !r.error && Math.abs(r.data.keys[0].outInfluence - 33.333) < 0.01);
  await t('edit_keyframes spatial linear', 'ae_edit_keyframes', { comp: C, layer: 'Box', path: ['Transform', 'Position'], spatial: 'linear' });
  await t('edit_keyframes copyTo Ctrl', 'ae_edit_keyframes', { comp: C, layer: 'Box', path: ['Transform', 'Position'], copyTo: { layer: 'Ctrl', offset: '5f' } },
    (r) => !r.error && r.data.copiedTo.numKeys === 3);
  await t('edit_keyframes offset value', 'ae_edit_keyframes', { comp: C, layer: 'Ctrl', path: ['Transform', 'Position'], keys: [2], offset: [0, 100] },
    (r) => !r.error && r.data.keys[1].value[1] === 640);
  await t('edit_keyframes delete by time', 'ae_edit_keyframes', { comp: C, layer: 'Ctrl', path: ['Transform', 'Position'], keys: ['55f'], delete: true },
    (r) => !r.error && r.data.numKeys === 2);
  await t('set_property refuses keyed static', 'ae_set_property', { comp: C, layer: 'Box', path: ['Transform', 'Position'], value: [0, 0] },
    (r) => !!r.error && /animated/.test(r.error));
  await t('set_property layers all Opacity', 'ae_set_property', { comp: C, layers: 'all', path: ['Transform', 'Opacity'], value: 90 },
    (r) => !r.error && r.data.count === 4);
  await t('set_property layers regex', 'ae_set_property', { comp: C, layers: { match: '^(Box|Title)$' }, path: ['Transform', 'Rotation'], value: 5 },
    (r) => !r.error && r.data.count === 2);
  await t('set_expression', 'ae_set_expression', { comp: C, layer: 'Title', path: ['Transform', 'Rotation'], expression: 'wiggle(2, 5)' });
  await t('set_expression bad → rejected, restored', 'ae_set_expression', { comp: C, layer: 'Title', path: ['Transform', 'Rotation'], expression: 'this is not js(' },
    (r) => !!r.error && /rejected/i.test(r.error));
  await t('find_animation', 'ae_find_animation', { comp: C, layer: 'Title' },
    (r) => !r.error && r.data.layers[0].animated.some((a) => /wiggle/.test(a.expression || '')));
  await t('clear_expression', 'ae_clear_expression', { comp: C, layer: 'Title', path: ['Transform', 'Rotation'] });

  // --- effects, presets, catalog ---
  await t('catalog effects blur', 'ae_catalog', { kind: 'effects', query: 'gaussian' }, (r) => !r.error && r.data.items.length > 0);
  await t('catalog fonts', 'ae_catalog', { kind: 'fonts', query: 'helvetica', limit: 5 }, (r) => !r.error);
  await t('catalog presets', 'ae_catalog', { kind: 'presets', query: 'typewriter', limit: 5 }, (r) => !r.error && r.data.items.length > 0);
  await t('catalog render templates', 'ae_catalog', { kind: 'render_templates' }, (r) => !r.error && r.data.items.length > 0);
  await t('catalog output templates', 'ae_catalog', { kind: 'output_templates' }, (r) => !r.error && r.data.items.length > 0);
  await t('apply_effect params incl colour', 'ae_apply_effect', { comp: C, layer: 'BG', effect: 'Gaussian Blur', params: { Blurriness: 12 } },
    (r) => !r.error && r.data.params.length > 0);
  await t('apply_effect Fill colour hex', 'ae_apply_effect', { comp: C, layer: 'BG', effect: 'ADBE Fill', params: { Color: '#ff0000' } });
  await t('property_meta rename+disable', 'ae_property_meta', { comp: C, layer: 'BG', path: ['Effects', 'Gaussian Blur'], name: 'Soft', enabled: false },
    (r) => !r.error && r.data.after.name === 'Soft' && r.data.after.enabled === false);
  await t('property_meta duplicate', 'ae_property_meta', { comp: C, layer: 'BG', path: ['Effects', 'Soft'], duplicate: true });
  await t('remove_property', 'ae_remove_property', { comp: C, layer: 'BG', path: ['Effects', 'Fill'] });
  await t('apply_preset Typewriter', 'ae_apply_preset', { comp: C, layer: 'Title', preset: 'Typewriter' });

  // --- text ---
  await t('text read', 'ae_text', { comp: C, layer: 'Title' }, (r) => !r.error && r.data.style.text === 'Hello Bridge');
  await t('text set style', 'ae_text', { comp: C, layer: 'Title', text: 'Native AE', style: { tracking: 50, strokeColor: '#000000', strokeWidth: 4 } },
    (r) => !r.error && r.data.after.text === 'Native AE' && r.data.after.tracking === 50);
  await t('text ranges', 'ae_text', { comp: C, layer: 'Title', ranges: [{ start: 0, end: 6, style: { fillColor: '#ff0000' } }] },
    (r) => !r.error || /24\.3/.test(r.error));
  await t('add_property text animator', 'ae_add_property', { comp: C, layer: 'Title', path: ['Text', 'Animators'], add: 'ADBE Text Animator', name: 'Fade', animate: ['ADBE Text Opacity'] },
    (r) => !r.error && r.data.added[0].name === 'Fade');

  // --- markers & masks ---
  await t('markers add comp', 'ae_markers', { comp: C, action: 'add', markers: [{ time: '15f', comment: 'Beat 1' }, { time: 2, comment: 'Beat 2', duration: '10f', chapter: 'Intro' }] },
    (r) => !r.error && r.data.count === 2);
  await t('markers update move', 'ae_markers', { comp: C, action: 'update', marker: { comment: 'Beat 2', set: { comment: 'Drop', time: '0:00:03:00' } } },
    (r) => !r.error && r.data.markers[0].frame === 90 && r.data.markers[0].comment === 'Drop');
  await t('markers list', 'ae_markers', { comp: C, action: 'list' }, (r) => !r.error && r.data.markers.length === 2);
  await t('markers layer add', 'ae_markers', { comp: C, layer: 'Title', action: 'add', marker: { time: 1, comment: 'hit' } });
  await t('markers delete', 'ae_markers', { comp: C, action: 'delete', marker: { comment: 'Beat 1' } }, (r) => !r.error && r.data.count === 1);
  await t('masks add rect+ellipse', 'ae_masks', { comp: C, layer: 'BG', action: 'add', masks: [{ rect: [100, 100, 800, 400], name: 'Win' }, { ellipse: [900, 300, 400, 400], mode: 'subtract', feather: 30 }] },
    (r) => !r.error && r.data.masks.length === 2 && r.data.masks[1].mode === 'subtract');
  await t('masks update animate', 'ae_masks', { comp: C, layer: 'BG', action: 'update', mask: { mask: 'Win', rect: [0, 0, 1920, 1080], time: 1, expansion: 10 } },
    (r) => !r.error && r.data.masks[0].animated === true);
  await t('masks list', 'ae_masks', { comp: C, layer: 'BG', action: 'list' }, (r) => !r.error && r.data.masks.length === 2);
  await t('masks delete', 'ae_masks', { comp: C, layer: 'BG', action: 'delete', mask: { mask: 2 } });

  // --- layers ---
  await t('set_layer_props enums', 'ae_set_layer_props', { comp: C, layer: 'Box', props: { blendingMode: 'screen', label: 3, quality: 'draft', motionBlur: true, inPoint: '5f' } },
    (r) => !r.error && r.data.after.blendingMode === 'screen' && r.data.before.blendingMode === 'normal');
  await t('set_layer_props bad enum lists options', 'ae_set_layer_props', { comp: C, layer: 'Box', props: { blendingMode: 'sparkle' } },
    (r) => !!r.error && /multiply/.test(r.error));
  await t('set_layer_props trackMatte', 'ae_set_layer_props', { comp: C, layer: 'BG', props: { trackMatte: { layer: 'Title', type: 'alpha' } } },
    (r) => !r.error || /setTrackMatte/.test(r.error));
  await t('set_layer_props clear matte', 'ae_set_layer_props', { comp: C, layer: 'BG', props: { trackMatte: null } }, (r) => !r.error || /setTrackMatte/.test(r.error));
  await t('layer_action duplicate', 'ae_layer_action', { comp: C, layer: 'Ctrl', action: 'duplicate', name: 'Ctrl 2' });
  await t('layer_action split', 'ae_layer_action', { comp: C, layer: 'BG', action: 'split', time: '0:00:02:00' },
    (r) => !r.error && r.data.results[0].second.inPoint === 2);
  await t('layer_action sequence', 'ae_layer_action', { comp: C, layers: ['Ctrl', 'Ctrl 2'], action: 'sequence', overlap: '10f' });
  await t('layer_action align', 'ae_layer_action', { comp: C, layer: 'Title', action: 'align', to: 'center' });
  await t('layer_action center_anchor', 'ae_layer_action', { comp: C, layer: 'Title', action: 'center_anchor' });
  await t('layer_action fit_to_comp', 'ae_layer_action', { comp: C, layer: 'Box', action: 'fit_to_comp', mode: 'width' });
  await t('create_comp for copy target', 'ae_create_comp', { name: TGT, open: false });
  await t('layer_action copy_to_comp', 'ae_layer_action', { comp: C, layer: 'Title', action: 'copy_to_comp', target: TGT });
  await t('create_layer precomp', 'ae_create_layer', { comp: C, kind: 'precomp', options: { source: TGT, name: 'Nested' } });
  await t('layer_action freeze_frame', 'ae_layer_action', { comp: C, layer: 'Nested', action: 'freeze_frame', time: 1 }, (r) => !r.error && r.data.results[0].frozenAt === 1);

  // --- batch & undo ---
  const before = (await call('ae_comp_tree', { comp: C, animation: false, transforms: false, effects: false })).data.layers.length;
  await t('batch success', 'ae_batch', { name: 'Two nulls', steps: [
    { tool: 'ae_create_layer', args: { comp: C, kind: 'null', options: { name: 'B1' } } },
    { tool: 'ae_create_layer', args: { comp: C, kind: 'null', options: { name: 'B2' } } }] },
    (r) => !r.error && r.data.ok && r.data.completed === 2);
  await t('undo removes whole batch', 'ae_undo', {});

  const afterUndo = (await call('ae_comp_tree', { comp: C, animation: false, transforms: false, effects: false })).data.layers.length;
  record('undo count check (' + before + ' → ' + afterUndo + ')', before === afterUndo);
  await t('redo', 'ae_undo', { redo: true });
  const afterRedo = (await call('ae_comp_tree', { comp: C, animation: false, transforms: false, effects: false })).data.layers.length;
  record('redo count check (' + afterRedo + ')', afterRedo === before + 2);
  await t('batch atomic rollback', 'ae_batch', { steps: [
    { tool: 'ae_create_layer', args: { comp: C, kind: 'null', options: { name: 'R1' } } },
    { tool: 'ae_set_property', args: { comp: C, layer: 'Nope', path: ['Transform', 'Opacity'], value: 1 } }] },
    (r) => !r.error && r.data.ok === false && r.data.rolledBack === true);
  const afterRollback = (await call('ae_comp_tree', { comp: C, animation: false, transforms: false, effects: false })).data.layers.length;
  record('rollback count check', afterRollback === afterRedo);
  await t('delete_layer many', 'ae_delete_layer', { comp: C, layers: ['B1', 'B2'] });

  // --- comps, items, nav ---
  await t('duplicate_comp variant 9x16', 'ae_duplicate_comp', { comp: C, name: C + ' 9x16', width: 1080, height: 1920 },
    (r) => !r.error && r.data.width === 1080 && r.data.height === 1920);
  await t('set_comp_settings before/after', 'ae_set_comp_settings', { comp: C, settings: { workAreaStart: '10f', workAreaDuration: 3, motionBlur: true } },
    (r) => !r.error && r.data.after.workAreaStart === 0.3333);
  await t('item_action create_folder', 'ae_item_action', { action: 'create_folder', name: 'MCP Folder' });
  await t('item_action move', 'ae_item_action', { action: 'move', item: TGT, folder: 'MCP Folder' }, (r) => !r.error && r.data.folder === 'MCP Folder');
  await t('item_action missing', 'ae_item_action', { action: 'missing' });
  await t('goto', 'ae_goto', { comp: C, time: '0:00:01:15', layer: 'Title' }, (r) => !r.error && r.data.frame === 45 && r.data.layers[0].name === 'Title');
  await t('selection', 'ae_selection', {}, (r) => !r.error && r.data.comp === C);

  // --- see ---
  await t('render_frame single', 'ae_render_frame', { comp: C, time: '1s' }, (r) => !r.error && r.images === 1);
  await t('render_frame 6 → sheet', 'ae_render_frame', { comp: C, frames: 6 }, (r) => !r.error && r.images === 1 && /contact sheet/.test(r.txt));
  await t('render_frame 3 separate', 'ae_render_frame', { comp: C, times: ['0f', '30f', '60f'] }, (r) => !r.error && r.images === 3);
  await t('review_motion', 'ae_review_motion', { comp: C, frames: 8 }, (r) => !r.error && r.images === 1);

  // --- menu & raw ---
  await t('menu_command dialog refused', 'ae_menu_command', { command: 'Composition Settings...' }, (r) => !!r.error && /dialog/.test(r.error));
  await t('menu_command unknown', 'ae_menu_command', { command: 'Definitely Not A Command' }, (r) => !!r.error);
  await t('menu_command Deselect All', 'ae_menu_command', { command: 'Deselect All', comp: C, layer: 'Title' });
  const jsxFile = path.join(out, 'hello.jsx');
  fs.writeFileSync(jsxFile, 'app.project.numItems;');
  await t('run_jsx file', 'ae_run_jsx', { file: jsxFile }, (r) => !r.error && typeof r.data.result === 'number');

  // --- save & render ---
  await t('save_project', 'ae_save_project', {});
  await t('render_queue add', 'ae_render_queue', { action: 'add', comp: C, output: path.join(out, 'rq.mov'), start: 0, duration: '10f' });
  await t('render_queue list', 'ae_render_queue', { action: 'list' }, (r) => !r.error && r.data.items.length >= 1);
  await t('render_queue clear', 'ae_render_queue', { action: 'clear' }, (r) => !r.error && r.data.remaining === 0);
  const job = await t('render_video', 'ae_render_video', { comp: C, output: path.join(out, 'short.mov'), startFrame: 0, endFrame: 10 },
    (r) => !r.error && r.data.jobId);
  if (job.data && job.data.jobId) {
    let st;
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      st = await call('ae_render_status', { jobId: job.data.jobId });
      if (st.data && st.data.status !== 'running') { break; }
    }
    record('render_video finished: ' + (st.data && st.data.status), st.data && st.data.status === 'done' && st.data.outputExists);
  }
  const job2 = await t('render_video long (to cancel)', 'ae_render_video', { comp: C, output: path.join(out, 'long.mov'), save: false }, (r) => !r.error && r.data.jobId);
  if (job2.data && job2.data.jobId) {
    await new Promise((r) => setTimeout(r, 1500));
    await t('render_cancel → cancelled', 'ae_render_cancel', { jobId: job2.data.jobId }, (r) => !r.error && r.data.status === 'cancelled');
    await new Promise((r) => setTimeout(r, 2500));
    await t('status stays cancelled after exit', 'ae_render_status', { jobId: job2.data.jobId }, (r) => !r.error && r.data.status === 'cancelled');
  }

  // ================= phase 2: deeper coverage =================
  console.log('\n--- phase 2 ---');
  await t('solid reports kind solid', 'ae_comp_tree', { comp: C, animation: false, transforms: false, effects: false },
    (r) => !r.error && r.data.layers.some((l) => l.name === 'BG' && l.kind === 'solid'));
  await t('shape star+repeater+group transform', 'ae_shape', { comp: C, name: 'Stars', shape: 'star', points: 6, outerRadius: 80, innerRadius: 35,
    fill: '#ffee00', repeater: { copies: 4, position: [180, 0] }, transform: { position: [-300, 200], rotation: 15, opacity: 80 } },
    (r) => !r.error && r.data.groups.length === 1);
  await t('shape path + polygon in one layer', 'ae_shape', { comp: C, name: 'Paths', shapes: [
    { shape: 'path', path: { vertices: [[0, 0], [200, 0], [100, 150]], closed: true }, stroke: { color: '#00ffff', width: 4, lineCap: 'round' } },
    { shape: 'polygon', points: 5, outerRadius: 60, fill: [0.2, 0.9, 0.4], roundCorners: 10 }] },
    (r) => !r.error && r.data.groups.length === 2);
  await t('shape group transform readable', 'ae_layer_detail', { comp: C, layer: 'Stars', path: ['Contents', 'Stars', 'Transform', 'Rotation'] },
    (r) => !r.error && r.data.properties[0].value === 15);
  await t('set_property on shape path value', 'ae_set_property', { comp: C, layer: 'Paths', path: ['Contents', 'Group 1', 'Contents', 'Path 1', 'Path'],
    value: { vertices: [[0, 0], [300, 0], [150, 250]], closed: true } },
    (r) => !r.error && r.data.after.vertices[1][0] === 300);
  await t('keyframe a mask path', 'ae_add_keyframes', { comp: C, layer: 'BG', path: ['Masks', 'Win', 'Mask Path'], replace: true, keys: [
    { time: 0, value: { vertices: [[0, 0], [100, 0], [100, 100], [0, 100]] } }, { time: '1s', value: { vertices: [[0, 0], [900, 0], [900, 500], [0, 500]] }, ease: 'easy' }] },
    (r) => !r.error && r.data.numKeys === 2);
  await t('add_property at index (re-fetch after moveTo)', 'ae_add_property', { comp: C, layer: 'BG', path: ['Effects'], add: 'ADBE Tint', name: 'First', index: 1 },
    (r) => !r.error && r.data.added[0].name === 'First' && r.data.added[0].path[1] === 'First');
  await t('property_meta duplicate (fixed)', 'ae_property_meta', { comp: C, layer: 'BG', path: ['Effects', 'First'], duplicate: true },
    (r) => !r.error && r.data.copy && r.data.copy.name);
  await t('property_meta reorder', 'ae_property_meta', { comp: C, layer: 'BG', path: ['Effects', 'First'], index: 3 },
    (r) => !r.error && r.data.after.index === 3);
  await t('effect param colour hex via set_property', 'ae_set_property', { comp: C, layer: 'BG', path: ['Effects', 'First', 'Map Black To'], value: '#123456' },
    (r) => !r.error && Math.abs(r.data.after[0] - 0x12 / 255) < 0.01);
  await t('create_layer box_text', 'ae_create_layer', { comp: C, kind: 'box_text', options: { name: 'Para', text: 'A paragraph of box text', boxSize: [600, 300], style: { fontSize: 40 } } });
  await t('text on box text', 'ae_text', { comp: C, layer: 'Para' }, (r) => !r.error && r.data.style.boxText === true);
  await t('text keyframed at time', 'ae_text', { comp: C, layer: 'Para', text: 'Second line', time: '2s' }, (r) => !r.error);
  await t('text static refused once keyed', 'ae_text', { comp: C, layer: 'Para', text: 'nope' }, (r) => !!r.error && /keyframed/.test(r.error));
  await t('catalog fonts gives a font', 'ae_catalog', { kind: 'fonts', limit: 1 }, (r) => !r.error && r.data.items.length === 1);
  await t('menu_command Easy Ease on selected keys', 'ae_edit_keyframes', { comp: C, layer: 'Ctrl', path: ['Transform', 'Position'], select: true });
  await t('  … run "Easy Ease"', 'ae_menu_command', { command: 'Easy Ease', comp: C, layer: 'Ctrl' });
  await t('  … keys now eased 33.3', 'ae_layer_detail', { comp: C, layer: 'Ctrl', path: ['Transform', 'Position'] },
    (r) => !r.error && r.data.properties[0].keys.every((k) => k.inInterp === 'bezier'));
  await t('apply_preset to many layers', 'ae_apply_preset', { comp: C, layers: ['Title', 'Para'], preset: 'Typewriter' },
    (r) => !r.error && r.data.appliedTo.length === 2);
  await t('bad time rejected helpfully', 'ae_set_property', { comp: C, layer: 'Title', path: ['Transform', 'Opacity'], value: 50, time: 'soon' },
    (r) => !!r.error && /timecode/.test(r.error));
  await t('bad colour rejected helpfully', 'ae_create_layer', { comp: C, kind: 'solid', options: { color: '#zzz' } },
    (r) => !!r.error && /colour/i.test(r.error));
  await t('bad path lists children', 'ae_set_property', { comp: C, layer: 'Title', path: ['Transform', 'Posiiton'], value: [0, 0] },
    (r) => !!r.error && /Available: .*Position/.test(r.error));
  await t('render_frame timecode', 'ae_render_frame', { comp: C, time: '0:00:01:15' }, (r) => !r.error && /"frame":45/.test(r.txt));
  await t('markers layer update by time', 'ae_markers', { comp: C, layer: 'Title', action: 'update', marker: { time: 1, set: { comment: 'HIT', duration: '5f' } } },
    (r) => !r.error && r.data.markers[0].comment === 'HIT');

  // --- real footage: import the clip we rendered earlier ---
  const clip = path.join(out, 'short.mov');
  if (fs.existsSync(clip)) {
    await t('import_file footage', 'ae_import_file', { path: clip, name: 'Clip ' + RUN, folder: 'MCP Folder' }, (r) => !r.error && r.data.kind === 'footage');
    await t('create_layer footage', 'ae_create_layer', { comp: C, kind: 'footage', options: { source: 'Clip ' + RUN, name: 'ClipLayer' } });
    await t('freeze_frame footage (fixed)', 'ae_layer_action', { comp: C, layer: 'ClipLayer', action: 'freeze_frame', time: '5f' },
      (r) => !r.error && Math.abs(r.data.results[0].frozenAt - 5 / 30) < 0.01);
    await t('freeze_frame precomp (fixed)', 'ae_layer_action', { comp: C, layer: 'Nested', action: 'freeze_frame', time: 1 }, (r) => !r.error);
    await t('item_action interpret', 'ae_item_action', { action: 'interpret', item: 'Clip ' + RUN, settings: { frameRate: 24, loop: 2, alpha: 'straight' } });
    await t('item_action set_proxy', 'ae_item_action', { action: 'set_proxy', item: 'Clip ' + RUN, path: clip });
    await t('item_action clear_proxy', 'ae_item_action', { action: 'clear_proxy', item: 'Clip ' + RUN });
    await t('item_action replace_source', 'ae_item_action', { action: 'replace_source', item: 'Clip ' + RUN, path: clip });
    await t('item_action rename/label/comment', 'ae_item_action', { action: 'label', item: 'Clip ' + RUN, label: 5 });
  } else {
    console.log('SKIP footage tests: no ' + clip);
  }
  await t('item_action open comp', 'ae_item_action', { action: 'open', item: C });
  await t('rename then keep working (layer found by object, not old name)', 'ae_set_layer_props', { comp: C, layer: 'Para', props: { name: 'Paragraph' } },
    (r) => !r.error && r.data.after.name === 'Paragraph');
  await t('  … renamed layer is addressable', 'ae_text', { comp: C, layer: 'Paragraph' }, (r) => !r.error);
  await t('shape rect with position (ExtendScript ?: bug)', 'ae_shape', { comp: C, name: 'PosRect', shape: 'rect', size: [400, 200], position: [0, -100], fill: '#888888' });
  for (const [mode, want] of [['fit', 480], ['fill', 540], ['width', 480], ['height', 540]]) {
    await t('fit_to_comp ' + mode + ' = ' + want + '%', 'ae_layer_action', { comp: C, layer: 'PosRect', action: 'fit_to_comp', mode },
      (r) => !r.error && Math.abs(r.data.results[0].scale - want) < 0.5);
  }
  await t('LUT effect refused (opens a dialog)', 'ae_apply_effect', { comp: C, layer: 'BG', effect: 'ADBE Apply Color LUT2' }, (r) => !!r.error && /dialog/.test(r.error));
  await t('essential graphics add in order', 'ae_essential_graphics', { comp: C, action: 'add', properties: [
    { layer: 'Title', path: ['Text', 'Source Text'], name: 'Headline' }, { layer: 'Ctrl', path: ['Transform', 'Opacity'], name: 'Fade' }] },
    (r) => !r.error && r.data.controllers[0].name === 'Headline');
  await t('essential graphics refuses a group', 'ae_essential_graphics', { comp: C, action: 'add', layer: 'Title', path: ['Transform'], name: 'x' }, (r) => !!r.error);
  await t('layer_action trim_to_work_area', 'ae_layer_action', { comp: C, layer: 'Title', action: 'trim_to_work_area' },
    (r) => !r.error && r.data.results[0].inPoint >= 0.33);
  await t('delete_item folder contents ok', 'ae_list_items', { kind: 'folder' }, (r) => !r.error && r.data.items.length >= 1);

  // --- resources & prompts ---
  const pr = await rpc('prompts/get', { name: 'after-effects' });
  record('prompt served', !!(pr.result && /read → edit → look/.test(pr.result.messages[0].content.text)));
  const rs = await rpc('resources/read', { uri: 'ae://project' });
  record('resource ae://project', !!(rs.result && rs.result.contents[0].text.indexOf(p) !== -1));

  // --- read tools must leave Edit ▸ Undo untouched ---
  const count = async () => (await call('ae_comp_tree', { comp: C, animation: false, transforms: false, effects: false })).data.layers.length;
  for (const [label, tool, args] of [
    ['render_frame', 'ae_render_frame', { comp: C, time: 1, downscale: 4 }],
    ['review_motion', 'ae_review_motion', { comp: C, frames: 4 }],
    ['catalog templates', 'ae_catalog', { kind: 'render_templates' }],
    ['goto', 'ae_goto', { comp: C, time: 2 }],
    ['selection', 'ae_selection', {}]]) {
    const b = await count();
    await call('ae_create_layer', { comp: C, kind: 'null', options: { name: 'undo-probe' } });
    await call(tool, args);
    /* Give After Effects an idle moment to register the last undo step;
       without it a very fast undo occasionally lands before it exists. */
    await new Promise((res) => setTimeout(res, 300));
    await call('ae_undo', {});
    const a = await count();
    record(label + ' leaves no undo step', a === b, b + ' → ' + a);
    if (a !== b) { await call('ae_delete_layer', { comp: C, layer: 'undo-probe' }); }
  }

  /* Last: an export attaches an invisible undo step to the next edit. */
  await t('essential graphics export .mogrt', 'ae_essential_graphics', { comp: C, action: 'export', file: path.join(out, 'test-template.mogrt'), overwrite: true },
    (r) => !r.error && r.data.exists === true);
  proc.stdin.end();
  process.exit(finish());
})();
