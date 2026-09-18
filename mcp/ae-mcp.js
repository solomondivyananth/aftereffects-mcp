#!/usr/bin/env node
/*
 * ae-mcp.js — MCP server exposing After Effects to any MCP client.
 *
 * Zero dependencies. Speaks newline-delimited JSON-RPC on stdio and forwards
 * every tool call to the AE MCP Bridge panel running inside After Effects.
 */

'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, execFile } = require('child_process');

const PORT = parseInt(process.env.AE_BRIDGE_PORT || '7788', 10);
const STATE_PATH = path.join(os.homedir(), '.ae-mcp-bridge.json');
const ROOT = path.join(__dirname, '..');

/* The panel generates a shared secret on first run and stores it here. Without
   it the bridge refuses every call — which is what stops a web page you happen
   to be visiting from driving After Effects. */
function bridgeToken() {
  if (process.env.AE_BRIDGE_TOKEN) { return process.env.AE_BRIDGE_TOKEN; }
  try {
    const t = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')).token;
    if (t) { return t; }
  } catch (e) { /* fall through */ }
  throw new Error(
    'No bridge token found. Open the AE MCP Bridge panel in After Effects once — ' +
    'it writes a token to ' + STATE_PATH + ' on first run. ' +
    'You can also set AE_BRIDGE_TOKEN.');
}

const HOST = '127.0.0.1';
const MAX_IMAGE_PX = parseInt(process.env.AE_BRIDGE_MAX_PX || '1024', 10);
const SERVER_NAME = 'after-effects';
const SERVER_VERSION = require(path.join(ROOT, 'package.json')).version;
/* Newest first. An unknown request gets the newest we speak, per the spec. */
const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

/* ------------------------------------------------------------------ */
/* Bridge transport                                                    */
/* ------------------------------------------------------------------ */

function bridge(fn, args) {
  return new Promise((resolve, reject) => {
    let token;
    try { token = bridgeToken(); } catch (e) { return reject(e); }

    const body = JSON.stringify({ fn, args: args || {} });
    const req = http.request(
      { host: HOST, port: PORT, path: '/call', method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'X-AE-Bridge-Token': token
        },
        timeout: 300000 },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (d) => { data += d; });
        res.on('end', () => {
          let parsed;
          try { parsed = JSON.parse(data); }
          catch (e) { return reject(new Error('Bridge sent malformed JSON: ' + data.slice(0, 300))); }
          if (!parsed.ok) { return reject(new Error(parsed.error)); }
          resolve(parsed.result);
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('After Effects did not respond within 5 minutes. It is probably busy ' +
                       'rendering or showing a modal dialog — check the app.'));
    });
    req.on('error', (e) => {
      if (e.code === 'ECONNREFUSED') {
        reject(new Error(
          'Cannot reach the AE MCP Bridge on ' + HOST + ':' + PORT + '. Open After Effects ' +
          'and show the panel: Window ▸ Extensions ▸ AE MCP Bridge.'));
      } else { reject(e); }
    });
    req.write(body);
    req.end();
  });
}

/* ------------------------------------------------------------------ */
/* Images                                                              */
/* ------------------------------------------------------------------ */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* After Effects returns from saveFrameToPng before the bytes are on disk: the
   file shows up at size 0 and fills in a few hundred ms later. The panel waits
   too, but this side must not depend on the panel being the matching build.
   Polls asynchronously so other calls keep flowing meanwhile. */
async function waitForStableFile(filePath, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 60000);
  let last = -1, stable = 0;
  for (;;) {
    let size = -1;
    try { size = fs.statSync(filePath).size; } catch (e) { size = -1; }
    if (size > 0 && size === last) {
      if (++stable >= 2) { return true; }
    } else {
      stable = 0;
    }
    last = size;
    if (Date.now() > deadline) { return false; }
    await sleep(40);
  }
}

function runAsync(bin, argv) {
  return new Promise((resolve, reject) => {
    execFile(bin, argv, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) { err.stderr = stderr; return reject(err); }
      resolve(stdout);
    });
  });
}

/* sips (built into macOS) fits a full-size PNG into a box that is sane to
   send through the model. */
async function pngToBase64(srcPath, keep, downscale, width) {
  if (!(await waitForStableFile(srcPath))) {
    throw new Error('After Effects never finished writing ' + srcPath);
  }
  let usePath = srcPath;
  /* Scale in place beside the source: the OS temp dir isn't writable from
     every context this server gets spawned in. */
  const scaled = srcPath.replace(/\.png$/i, '') + '_scaled.png';
  try {
    const box = downscale > 1 && width ? Math.min(MAX_IMAGE_PX, Math.round(width / downscale)) : MAX_IMAGE_PX;
    await runAsync('sips', ['-Z', String(box), srcPath, '--out', scaled]);
    if (fs.existsSync(scaled)) { usePath = scaled; }
  } catch (e) { /* sips missing or failed — send the original */ }

  const buf = fs.readFileSync(usePath);
  try { if (usePath !== srcPath) fs.unlinkSync(usePath); } catch (e) {}
  if (!keep) { try { fs.unlinkSync(srcPath); } catch (e) {} }
  return buf.toString('base64');
}

/* ------------------------------------------------------------------ */
/* ffmpeg                                                              */
/* ------------------------------------------------------------------ */

let ffmpegPath = null;
function findFfmpeg() {
  if (ffmpegPath !== null) { return ffmpegPath; }
  const candidates = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'];
  for (const c of candidates) {
    if (fs.existsSync(c)) { return (ffmpegPath = c); }
  }
  try {
    ffmpegPath = execFileSync('which', ['ffmpeg'], { encoding: 'utf8' }).trim() || false;
  } catch (e) { ffmpegPath = false; }
  return ffmpegPath;
}

/* ------------------------------------------------------------------ */
/* Tools                                                               */
/* ------------------------------------------------------------------ */

const TIME = { type: ['number', 'string'],
  description: 'Seconds (2.5), frames ("75f") or timecode ("0:00:02:15").' };

const S = {
  comp: { type: ['string', 'number'], description: 'Composition name or id. Omit for the comp open in the timeline.' },
  layer: { type: ['string', 'number'], description: 'Layer name, or its 1-based index. Omit for the single selected layer.' },
  layers: { description: 'Many layers in one undo step, instead of "layer": an array of names/indices, "selected", "all", or {match:"regex"}.' },
  path: { type: 'array', items: { type: 'string' },
          description: 'Property path from the layer, e.g. ["Transform","Position"], ["Effects","Gaussian Blur","Blurriness"], ["Masks","Mask 1","Mask Path"], ["Contents","Group 1","Transform","Rotation"], ["Text","Source Text"]. Names or matchNames.' },
  time: TIME
};

const obj = (properties, required) => ({ type: 'object', properties, ...(required && required.length ? { required } : {}) });

const TOOLS = [
  /* ---------------- Read ---------------- */
  {
    name: 'ae_project_info',
    description: 'Overview of the open project: file path, every composition (size, duration, fps, layer count), the active comp and the playhead. Cheap — call this first.',
    inputSchema: obj({}),
    fn: 'project_info'
  },
  {
    name: 'ae_comp_tree',
    description: 'The layer stack of one comp: each layer\'s kind, timing, parenting, transform, effects, and animatedProperties — every keyframed or expression-driven property anywhere in the layer (text animators, trim paths, masks, effects included). Trust isAnimated over the transform summary.',
    inputSchema: obj({
      comp: S.comp,
      transforms: { type: 'boolean', description: 'Include transform summaries. Default true.' },
      effects: { type: 'boolean', description: 'Include effect lists. Default true.' },
      animation: { type: 'boolean', description: 'Scan for animation. Default true; false for a fast structural read.' }
    }),
    fn: 'comp_tree'
  },
  {
    name: 'ae_layer_detail',
    description: 'Deep read of one layer: property tree with values, every keyframe (index, time, frame, value, interpolation, ease, speed) and every expression (with any error). Pass "path" to read one group or property — for Source Text that returns the full character and paragraph style.',
    inputSchema: obj({
      comp: S.comp, layer: S.layer,
      path: { type: 'array', items: { type: 'string' }, description: 'Only read this property or group.' },
      maxDepth: { type: 'number', description: 'Recursion depth. Default 4.' },
      includeDefaults: { type: 'boolean', description: 'Include untouched properties. Default false.' }
    }),
    fn: 'layer_detail'
  },
  {
    name: 'ae_find_animation',
    description: 'Everything that animates on a layer or across a comp — keyframes and expressions anywhere in the property tree, with broken expressions flagged. Use before concluding a layer is static.',
    inputSchema: obj({ comp: S.comp, layer: S.layer }),
    fn: 'find_animation'
  },
  {
    name: 'ae_selection',
    description: 'What the user has selected: active comp, playhead (seconds and frame), work area, selected layers, selected properties with their paths and selected keyframes. Use when they say "this", "these keys", "here".',
    inputSchema: obj({}),
    fn: 'selection'
  },
  {
    name: 'ae_list_items',
    description: 'The Project panel: comps, footage, solids, folders — ids, sizes, durations, source files.',
    inputSchema: obj({ kind: { type: 'string', enum: ['comp', 'footage', 'solid', 'folder', 'placeholder'] } }),
    fn: 'list_items'
  },
  {
    name: 'ae_catalog',
    description: 'Look things up the way the app\'s panels do: installed effects (display name, matchName, category), animation presets (.ffx), fonts (PostScript names for text styling), render-settings and output-module templates.',
    inputSchema: obj({
      kind: { type: 'string', enum: ['effects', 'presets', 'fonts', 'render_templates', 'output_templates'] },
      query: { type: 'string', description: 'Case-insensitive search.' },
      category: { type: 'string', description: 'Effects only: an Effects & Presets category, e.g. "Blur & Sharpen".' },
      limit: { type: 'number', description: 'Default 60.' }
    }, ['kind']),
    fn: 'catalog'
  },

  /* ---------------- See ---------------- */
  {
    name: 'ae_render_frame',
    description: 'Render frames and look at them. Nothing = the playhead frame; "time" = one moment; "times" = specific moments; "frames" = N evenly spaced across the work area. More than 3 frames come back as one contact sheet. Use after every visual edit.',
    inputSchema: obj({
      comp: S.comp,
      time: TIME,
      times: { type: 'array', items: TIME, description: 'One frame per entry.' },
      frames: { type: 'number', description: 'Evenly spaced frames across the range (2-12 is sensible).' },
      start: { ...TIME, description: 'With "frames": range start. Default work area start.' },
      duration: { ...TIME, description: 'With "frames": range length. Default work area duration.' },
      downscale: { type: 'number', description: 'Return the image at 1/N size. Default 2; 1 for detail. Rendering uses the comp\'s own resolution setting and never changes it.' },
      sheet: { type: 'boolean', description: 'Force (true) or refuse (false) a contact sheet. Default: sheet when more than 3 frames.' }
    }),
    fn: 'render_frame',
    image: true
  },
  {
    name: 'ae_review_motion',
    description: 'Watch animation move: samples a range, stitches an MP4 you can open, returns one contact sheet. The only way to judge whether timing and easing feel right — use after animating anything.',
    inputSchema: obj({
      comp: S.comp,
      start: { ...TIME, description: 'Default work area start.' },
      duration: { ...TIME, description: 'Default work area duration.' },
      frames: { type: 'number', description: 'Samples. Default 16, max 48.' },
      fps: { type: 'number', description: 'MP4 playback rate. Default 12.' },
      downscale: { type: 'number', description: 'Image size 1/N. Default 4.' },
      columns: { type: 'number', description: 'Contact sheet columns. Default 6.' }
    }),
    custom: 'review_motion'
  },
  {
    name: 'ae_goto',
    description: 'Drive the user\'s view: open a comp in the viewer, park the playhead, select layers — to show them something. Brings After Effects to the front, so use it when the user asks to be shown. Does not change the project.',
    inputSchema: obj({ comp: S.comp, time: TIME, layer: S.layer, layers: S.layers }),
    fn: 'goto'
  },

  /* ---------------- Animate & edit ---------------- */
  {
    name: 'ae_set_property',
    description: 'Set a property. Without "time": the static value (refused if keyframed). With "time": a keyframe there. Returns before/after. Colours take "#rrggbb" or [r,g,b(,a)]; paths take {vertices,inTangents,outTangents,closed}; Source Text takes a string or style object. WRITE.',
    inputSchema: obj({
      comp: S.comp, layer: S.layer, layers: S.layers, path: S.path,
      value: { description: 'Number, [x,y], [x,y,z], colour, shape, or text.' },
      time: TIME
    }, ['path', 'value']),
    fn: 'set_property'
  },
  {
    name: 'ae_add_keyframes',
    description: 'Write a run of keyframes on one property (or the same property on many layers) in one undo step. WRITE.',
    inputSchema: obj({
      comp: S.comp, layer: S.layer, layers: S.layers, path: S.path,
      keys: {
        type: 'array',
        items: obj({
          time: TIME,
          value: { description: 'Same shape the property takes.' },
          interp: { type: 'string', enum: ['linear', 'hold', 'bezier'] },
          ease: { description: '"easy" (F9 Easy Ease), "easy_in", "easy_out", an influence 0.1-100 for both sides, or {in, out, inSpeed, outSpeed}.' },
          spatial: { type: 'string', enum: ['linear', 'auto', 'continuous'], description: 'Motion-path handles, for Position and other spatial properties.' },
          roving: { type: 'boolean' }
        }, ['time', 'value'])
      },
      replace: { type: 'boolean', description: 'Delete existing keyframes first. Default false.' }
    }, ['path', 'keys']),
    fn: 'add_keyframes'
  },
  {
    name: 'ae_edit_keyframes',
    description: 'Change keyframes that already exist: delete, move/retime, scale timing, change values, interpolation, easing, spatial handles, roving, labels, selection, or copy them to another layer/property. Pick keys by index, time, range, "selected" or "all". WRITE.',
    inputSchema: obj({
      comp: S.comp, layer: S.layer, layers: S.layers, path: S.path,
      keys: { description: '"all" (default), "selected", an array of indices (integers) and/or times ("2s","60f","0:00:02:00"), or {from, to} times.' },
      delete: { type: 'boolean' },
      shift: { ...TIME, description: 'Move the picked keys by this much (negative = earlier).' },
      moveTo: { ...TIME, description: 'Move the first picked key here; the rest keep their spacing.' },
      scaleTime: { type: 'number', description: 'Stretch spacing by this factor (2 = twice as slow) around "anchor".' },
      anchor: { ...TIME, description: 'Pivot for scaleTime. Default the first picked key.' },
      value: { description: 'Set every picked key to this value.' },
      offset: { description: 'Add this to each picked key\'s value (number or vector).' },
      interp: { type: 'string', enum: ['linear', 'hold', 'bezier'] },
      ease: { description: 'Same as ae_add_keyframes ease.' },
      spatial: { type: 'string', enum: ['linear', 'auto', 'continuous'] },
      roving: { type: 'boolean' },
      label: { type: 'number', description: 'Keyframe label colour 0-16.' },
      select: { type: 'boolean', description: 'Select (true) or deselect the keys in the timeline.' },
      copyTo: obj({ layer: S.layer, path: S.path, offset: TIME }, [])
    }, ['path']),
    fn: 'edit_keyframes'
  },
  {
    name: 'ae_set_expression',
    description: 'Attach an expression. After Effects validates it; on error nothing changes and the error comes back. WRITE.',
    inputSchema: obj({
      comp: S.comp, layer: S.layer, layers: S.layers, path: S.path,
      expression: { type: 'string', description: 'e.g. wiggle(2, 30) or loopOut("cycle").' },
      enabled: { type: 'boolean', description: 'false to attach it switched off.' }
    }, ['path', 'expression']),
    fn: 'set_expression'
  },
  {
    name: 'ae_clear_expression',
    description: 'Remove an expression, keeping the underlying value. WRITE.',
    inputSchema: obj({ comp: S.comp, layer: S.layer, layers: S.layers, path: S.path }, ['path']),
    fn: 'clear_expression'
  },
  {
    name: 'ae_apply_effect',
    description: 'Apply an effect and set parameters. Returns every parameter with its value. Find names with ae_catalog {kind:"effects"}. WRITE.',
    inputSchema: obj({
      comp: S.comp, layer: S.layer, layers: S.layers,
      effect: { type: 'string', description: 'Display name ("Gaussian Blur") or matchName ("ADBE Gaussian Blur 2").' },
      name: { type: 'string', description: 'Rename this instance.' },
      params: { type: 'object', description: 'Parameter name → value, e.g. {"Blurriness": 20, "Color": "#ff0000"}.' }
    }, ['effect']),
    fn: 'apply_effect'
  },
  {
    name: 'ae_apply_preset',
    description: 'Apply an animation preset (.ffx) the way Effects & Presets does — by name (searched in After Effects and User Presets) or full path. WRITE.',
    inputSchema: obj({
      comp: S.comp, layer: S.layer, layers: S.layers,
      preset: { type: 'string', description: 'Preset name, e.g. "Typewriter", or an absolute .ffx path.' }
    }, ['preset']),
    fn: 'apply_preset'
  },
  {
    name: 'ae_text',
    description: 'Read or style text. With nothing but the layer, returns the full character/paragraph style. Set "text", "style" (font by PostScript name, fontSize, fillColor, strokeColor, strokeWidth, tracking, leading, justification left/center/right/full, allCaps, fauxBold, baselineShift, boxTextSize…), or per-character "ranges". Returns before/after. WRITE.',
    inputSchema: obj({
      comp: S.comp, layer: S.layer, layers: S.layers,
      text: { type: 'string' },
      style: { type: 'object' },
      ranges: { type: 'array', items: obj({ start: { type: 'number' }, end: { type: 'number' }, style: { type: 'object' } }, ['start', 'end', 'style']),
                description: 'Style character ranges (AE 24.3+).' },
      time: { ...TIME, description: 'Keyframe Source Text at this time instead of setting it statically.' }
    }),
    fn: 'text'
  },
  {
    name: 'ae_markers',
    description: 'Comp markers (omit "layer") or layer markers: list, add, update, delete. Markers carry comment, duration, chapter, url, cue point, label, protected region. WRITE.',
    inputSchema: obj({
      comp: S.comp, layer: S.layer,
      action: { type: 'string', enum: ['list', 'add', 'update', 'delete'] },
      marker: { type: 'object', description: 'add: {time, comment, duration, chapter, url, cuePointName, label, protectedRegion, params}. update: {index|time|comment to find it, set:{…changes, time to move}}. delete: {index|time|comment} or {all:true}.' },
      markers: { type: 'array', items: { type: 'object' }, description: 'Several at once.' }
    }, ['action']),
    fn: 'markers'
  },
  {
    name: 'ae_masks',
    description: 'Layer masks: list, add, update, delete. Shapes as {rect:[left,top,w,h]}, {ellipse:[left,top,w,h]} or {vertices,inTangents,outTangents,closed} in layer space; plus mode, feather, opacity, expansion, inverted, color. Animate a mask by passing "time" or with ae_add_keyframes on ["Masks","Mask 1","Mask Path"]. WRITE.',
    inputSchema: obj({
      comp: S.comp, layer: S.layer,
      action: { type: 'string', enum: ['list', 'add', 'update', 'delete'] },
      mask: { type: 'object', description: 'The shape/settings; for update/delete, "mask" inside it names the target (name or index).' },
      masks: { type: 'array', items: { type: 'object' } }
    }, ['action']),
    fn: 'masks'
  },
  {
    name: 'ae_shape',
    description: 'Draw on a shape layer like the pen/shape tools: rect, ellipse, star, polygon or path, with fill, stroke, trim paths, round corners, repeater and group transform, in one call. Omit "layer" to create a new shape layer. Coordinates are layer space ([0,0] = comp centre on a new layer). WRITE.',
    inputSchema: obj({
      comp: S.comp, layer: S.layer,
      name: { type: 'string', description: 'Name of the new layer, or of the group.' },
      shape: { type: 'string', enum: ['rect', 'ellipse', 'star', 'polygon', 'path'] },
      size: { type: 'array', items: { type: 'number' } },
      position: { type: 'array', items: { type: 'number' } },
      roundness: { type: 'number' }, points: { type: 'number' },
      outerRadius: { type: 'number' }, innerRadius: { type: 'number' }, rotation: { type: 'number' },
      path: { type: 'object', description: 'For shape "path": {vertices, inTangents, outTangents, closed}.' },
      fill: { description: 'Colour, or {color, opacity}.' },
      stroke: { description: 'Colour, or {color, width, opacity, lineCap butt/round/projecting, lineJoin miter/round/bevel}.' },
      trim: { type: 'object', description: '{start, end, offset} (percent / degrees).' },
      roundCorners: { type: 'number' },
      repeater: { type: 'object', description: '{copies, offset, position, scale, rotation, startOpacity, endOpacity}.' },
      transform: { type: 'object', description: 'Group transform {anchor, position, scale, rotation, opacity}.' },
      shapes: { type: 'array', items: { type: 'object' }, description: 'Several groups at once, each with the fields above.' },
      into: { type: 'array', items: { type: 'string' }, description: 'Add inside an existing group, e.g. ["Contents","Group 1","Contents"].' }
    }),
    fn: 'shape'
  },
  {
    name: 'ae_add_property',
    description: 'Add anything addable under a property group: effects, masks, shape items, text animators ("ADBE Text Animator", with animate:["ADBE Text Opacity"…]), selectors, etc. "add" is a matchName or display name; "path" is the group ([] = the layer). WRITE.',
    inputSchema: obj({
      comp: S.comp, layer: S.layer,
      path: { type: 'array', items: { type: 'string' }, description: 'Group to add into, e.g. ["Text","Animators"] or ["Contents"].' },
      add: { description: 'matchName/name, or an array of them.' },
      name: { type: 'string' },
      index: { type: 'number', description: 'Position within the group.' },
      animate: { description: 'For a text animator: properties to add to it, e.g. ["ADBE Text Opacity","ADBE Text Position 3D"].' }
    }, ['add']),
    fn: 'add_property'
  },
  {
    name: 'ae_remove_property',
    description: 'Remove an effect, mask, shape item, text animator or other added property. WRITE.',
    inputSchema: obj({ comp: S.comp, layer: S.layer, layers: S.layers, path: S.path }, ['path']),
    fn: 'remove_property'
  },
  {
    name: 'ae_property_meta',
    description: 'Rename, enable/disable (the fx switch), reorder or duplicate an effect, mask, shape group or other property group; toggle an expression on/off. WRITE.',
    inputSchema: obj({
      comp: S.comp, layer: S.layer, path: S.path,
      name: { type: 'string' }, enabled: { type: 'boolean' }, index: { type: 'number' },
      duplicate: { type: 'boolean' }, expressionEnabled: { type: 'boolean' }
    }, ['path']),
    fn: 'property_meta'
  },

  /* ---------------- Layers ---------------- */
  {
    name: 'ae_create_layer',
    description: 'Add a layer. WRITE.',
    inputSchema: obj({
      comp: S.comp,
      kind: { type: 'string', enum: ['solid', 'text', 'box_text', 'shape', 'null', 'adjustment', 'camera', 'light', 'precomp', 'footage'] },
      options: {
        type: 'object',
        description: 'name, text, style (text style object), boxSize [w,h], color, width, height, duration, startTime, inPoint, outPoint (times), index, position [x,y], scale, opacity, parent, threeD, label 0-16, lightType parallel/spot/point/ambient, source (comp or footage item name/id, for precomp and footage).'
      }
    }, ['kind']),
    fn: 'create_layer'
  },
  {
    name: 'ae_delete_layer',
    description: 'Delete layers. WRITE.',
    inputSchema: obj({ comp: S.comp, layer: S.layer, layers: S.layers }),
    fn: 'delete_layer'
  },
  {
    name: 'ae_set_layer_props',
    description: 'Layer switches and settings, returning before/after: name, enabled, solo, shy, locked, audioEnabled, threeDLayer, motionBlur, adjustmentLayer, guideLayer, collapseTransformation, effectsActive, timeRemapEnabled, inPoint/outPoint/startTime (times), stretch, parent (name/index/null), index, label 0-16, comment, blendingMode ("multiply", "screen", "add"…), trackMatte {layer, type alpha/alpha_inverted/luma/luma_inverted/none}, quality best/draft/wireframe, samplingQuality bilinear/bicubic, autoOrient off/path/camera, frameBlendingType off/frame_mix/pixel_motion. WRITE.',
    inputSchema: obj({
      comp: S.comp, layer: S.layer, layers: S.layers,
      props: { type: 'object', description: 'Attribute → value.' }
    }, ['props']),
    fn: 'set_layer_props'
  },
  {
    name: 'ae_layer_action',
    description: 'Layer operations from the Layer / Edit / Animation menus: duplicate, split (at "time", Edit ▸ Split Layer), copy_to_comp ("target"), sequence (Keyframe Assistant ▸ Sequence Layers, with "overlap"), trim_to_work_area, freeze_frame (at "time"), center_anchor, fit_to_comp ("mode" fit/fill/width/height), align ("to" left/right/top/bottom/hcenter/vcenter/center, relative to the comp). Defaults to the selected layers. WRITE.',
    inputSchema: obj({
      comp: S.comp, layer: S.layer, layers: S.layers,
      action: { type: 'string', enum: ['duplicate', 'split', 'copy_to_comp', 'sequence', 'trim_to_work_area', 'freeze_frame', 'center_anchor', 'fit_to_comp', 'align'] },
      time: TIME, target: S.comp, overlap: TIME, start: TIME,
      mode: { type: 'string', enum: ['fit', 'fill', 'width', 'height'] },
      to: { type: 'string' }, name: { type: 'string' }
    }, ['action']),
    fn: 'layer_action'
  },

  /* ---------------- Compositions & project ---------------- */
  {
    name: 'ae_create_comp',
    description: 'Create a composition. Pass open: true to also open it in the viewer (that brings After Effects to the front). WRITE.',
    inputSchema: obj({
      name: { type: 'string' },
      width: { type: 'number', description: 'Default 1920.' },
      height: { type: 'number', description: 'Default 1080.' },
      frameRate: { type: 'number', description: 'Default 30.' },
      duration: { ...TIME, description: 'Default 10 seconds.' },
      pixelAspect: { type: 'number', description: 'Default 1.' },
      bgColor: { description: '"#rrggbb" or [r,g,b].' },
      folder: { type: 'string' },
      open: { type: 'boolean', description: 'Open it in the viewer. Default false.' }
    }, ['name']),
    fn: 'create_comp'
  },
  {
    name: 'ae_set_comp_settings',
    description: 'Composition settings, returning before/after: name, width, height, frameRate, duration, bgColor, workAreaStart, workAreaDuration, displayStartTime, resolutionFactor, motionBlur, shutterAngle, shutterPhase, frameBlending, draft3d, hideShyLayers, preserveNestedFrameRate, renderer. WRITE.',
    inputSchema: obj({ comp: S.comp, settings: { type: 'object' } }, ['settings']),
    fn: 'set_comp_settings'
  },
  {
    name: 'ae_duplicate_comp',
    description: 'Duplicate a comp. Pass width/height to make a format variant (9x16, 1x1, 16x9…) with top-level layers re-centred. WRITE.',
    inputSchema: obj({
      comp: S.comp, name: { type: 'string' },
      width: { type: 'number' }, height: { type: 'number' },
      recenter: { type: 'boolean', description: 'Default true.' },
      open: { type: 'boolean' }
    }),
    fn: 'duplicate_comp'
  },
  {
    name: 'ae_precompose',
    description: 'Precompose layers. WRITE.',
    inputSchema: obj({
      comp: S.comp,
      layers: { type: 'array', items: { type: ['string', 'number'] }, description: 'Omit for the selection.' },
      name: { type: 'string' },
      moveAllAttributes: { type: 'boolean', description: 'Default true.' }
    }),
    fn: 'precompose'
  },
  {
    name: 'ae_import_file',
    description: 'Import video, image, audio, an image sequence, PSD/AI (flattened or as a comp) or an .aep. Add it to a comp with ae_create_layer kind "footage". WRITE.',
    inputSchema: obj({
      path: { type: 'string', description: 'Absolute path.' },
      sequence: { type: 'boolean' },
      importAs: { type: 'string', enum: ['footage', 'comp', 'comp_cropped', 'project'] },
      name: { type: 'string' }, folder: { type: 'string' }
    }, ['path']),
    fn: 'import_file'
  },
  {
    name: 'ae_item_action',
    description: 'Project panel operations: create_folder, rename, move (into "folder"), label, comment, open (a comp), replace_source ("path"), reload, set_proxy / clear_proxy, interpret ({frameRate, loop, pixelAspect, alpha ignore/straight/premultiplied}), missing (list missing footage), remove_unused, consolidate, reduce ("items" to keep). WRITE.',
    inputSchema: obj({
      action: { type: 'string', enum: ['create_folder', 'rename', 'move', 'label', 'comment', 'open', 'replace_source', 'reload', 'set_proxy', 'clear_proxy', 'interpret', 'missing', 'remove_unused', 'consolidate', 'reduce'] },
      item: { type: ['string', 'number'], description: 'Item name or id.' },
      name: { type: 'string' }, folder: { type: 'string' }, path: { type: 'string' },
      label: { type: 'number' }, comment: { type: 'string' }, sequence: { type: 'boolean' },
      settings: { type: 'object' }, items: { type: 'array', items: { type: ['string', 'number'] } }
    }, ['action']),
    fn: 'item_action'
  },
  {
    name: 'ae_delete_item',
    description: 'Delete a comp, footage item or folder from the project. WRITE.',
    inputSchema: obj({ item: { type: ['string', 'number'], description: 'Item name or id.' } }, ['item']),
    fn: 'delete_item'
  },
  {
    name: 'ae_new_project',
    description: 'Close the open project and start an empty one. Needs the sandbox guard OFF. Say what happens to unsaved work: saveFirst (true or a path) or discardUnsavedChanges: true. WRITE.',
    inputSchema: obj({
      savePath: { type: 'string', description: 'Save the new project here. Recommended — renders need a file.' },
      saveFirst: { description: 'true to save the current project, or a path to save it as.' },
      discardUnsavedChanges: { type: 'boolean' }
    }),
    fn: 'new_project'
  },
  {
    name: 'ae_open_project',
    description: 'Open an .aep, closing the current one. Same unsaved-work rules as ae_new_project; needs the guard OFF. WRITE.',
    inputSchema: obj({
      path: { type: 'string' },
      saveFirst: { description: 'true, or a path.' },
      discardUnsavedChanges: { type: 'boolean' }
    }, ['path']),
    fn: 'open_project'
  },
  {
    name: 'ae_save_project',
    description: 'Save (or Save As with "path"). WRITE.',
    inputSchema: obj({ path: { type: 'string' } }),
    fn: 'save_project'
  },

  /* ---------------- Render ---------------- */
  {
    name: 'ae_render_video',
    description: 'Background render with aerender — After Effects stays usable. Saves the project first. Returns a jobId for ae_render_status. Template names from ae_catalog. WRITE.',
    inputSchema: obj({
      comp: { type: 'string' },
      output: { type: 'string', description: 'Absolute path, e.g. /path/out.mov' },
      rsTemplate: { type: 'string', description: 'Default "Best Settings".' },
      omTemplate: { type: 'string', description: 'Default "Lossless".' },
      startFrame: { type: 'number' }, endFrame: { type: 'number' },
      save: { type: 'boolean', description: 'Default true.' }
    }, ['comp', 'output']),
    fn: 'render_start'
  },
  {
    name: 'ae_render_status',
    description: 'Background render jobs: status, progress, elapsed, output size, log tail. Survives panel reloads. Omit jobId for all.',
    inputSchema: obj({ jobId: { type: 'string' } }),
    fn: 'render_status'
  },
  {
    name: 'ae_render_cancel',
    description: 'Stop a background render.',
    inputSchema: obj({ jobId: { type: 'string' } }, ['jobId']),
    fn: 'render_cancel'
  },
  {
    name: 'ae_render_queue',
    description: 'The Render Queue panel itself: list, add (comp, output, rsTemplate, omTemplate, start, duration), set, remove, clear, queue_in_ame (send to Media Encoder), render (blocks After Effects until done — prefer ae_render_video). WRITE.',
    inputSchema: obj({
      action: { type: 'string', enum: ['list', 'add', 'set', 'remove', 'clear', 'queue_in_ame', 'render'] },
      comp: S.comp, index: { type: 'number' }, output: { type: 'string' },
      rsTemplate: { type: 'string' }, omTemplate: { type: 'string' },
      start: TIME, duration: TIME, render: { type: 'boolean' },
      renderImmediately: { type: 'boolean', description: 'queue_in_ame: start encoding right away. Default true.' }
    }, ['action']),
    fn: 'render_queue'
  },

  /* ---------------- Control ---------------- */
  {
    name: 'ae_undo',
    description: 'Edit ▸ Undo (or Redo) — each MCP write is one step, labelled "MCP: …" in the Edit menu. Note it also steps through edits the user made by hand. WRITE.',
    inputSchema: obj({ steps: { type: 'number', description: 'Default 1.' }, redo: { type: 'boolean' } }),
    fn: 'undo'
  },
  {
    name: 'ae_batch',
    description: 'Run several tool calls as ONE undo step, e.g. a change across many layers or comps. With atomic (default) a failure rolls back the steps before it. Steps: [{tool:"ae_set_property", args:{…}}, …]. Not allowed inside: batch, undo, new/open project, render_frame, catalog. WRITE.',
    inputSchema: obj({
      steps: { type: 'array', items: obj({ tool: { type: 'string' }, args: { type: 'object' } }, ['tool']) },
      atomic: { type: 'boolean', description: 'Default true.' },
      name: { type: 'string', description: 'Undo label, e.g. "Brand colour pass".' }
    }, ['steps']),
    fn: 'batch'
  },
  {
    name: 'ae_menu_command',
    description: 'Run any After Effects menu command by its exact menu text, e.g. "Convert to Editable Text", "Create Shapes from Vector Layer", "Drop Shadow" (layer style), "Convert Audio to Keyframes", "Easy Ease". Pass layers to select them first. Commands ending in "…" open dialogs and are refused unless allowDialog. WRITE.',
    inputSchema: obj({
      command: { type: ['string', 'number'], description: 'Exact menu text or command id.' },
      comp: S.comp, layer: S.layer, layers: S.layers,
      allowDialog: { type: 'boolean', description: 'Only when a person is at the machine to click the dialog.' }
    }, ['command']),
    fn: 'menu_command'
  },
  {
    name: 'ae_run_jsx',
    description: 'Escape hatch: evaluate ExtendScript ("code") or a .jsx file ("file") and return the result. ES3 only — var, no let/const/arrows/template strings. One undo step. Prefer a dedicated tool. WRITE.',
    inputSchema: obj({
      code: { type: 'string', description: 'The last expression is returned.' },
      file: { type: 'string', description: 'Absolute path to a .jsx to run instead.' }
    }),
    fn: 'run_jsx'
  }
];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/* ------------------------------------------------------------------ */
/* Tool execution                                                      */
/* ------------------------------------------------------------------ */

/* Compact JSON: indentation is pure token cost for a model. */
const text = (o) => ({ type: 'text', text: JSON.stringify(o) });

/* Tile rendered frames into one image — N frames for the price of one. */
async function contactSheet(frames, cols, workDir) {
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) { return null; }
  const pattern = path.join(workDir, '%04d.png');
  const rows = Math.ceil(frames.length / cols);
  const tileW = Math.max(120, Math.floor(1200 / cols));
  const sheet = path.join(workDir, 'contact_sheet.png');
  try {
    await runAsync(ffmpeg, ['-y', '-framerate', '1', '-i', pattern,
      '-vf', `scale=${tileW}:-2,tile=${cols}x${rows}`, '-frames:v', '1', sheet]);
  } catch (e) {
    throw new Error('Contact sheet failed: ' + String(e.stderr || e.message).slice(-400));
  }
  return sheet;
}

const WORK_ROOT = path.join(os.homedir(), '.ae-mcp-bridge');

/* Work folders are temporary. Contact-sheet folders go as soon as the image is
   read; review folders keep only their MP4, and anything older than an hour is
   swept on the next call — nothing piles up. */
function sweepWork() {
  const cutoff = Date.now() - 60 * 60 * 1000;
  let names = [];
  try { names = fs.readdirSync(WORK_ROOT); } catch (e) { return; }
  for (const n of names) {
    if (!/^(review|frames)_\d+$/.test(n)) { continue; }
    const full = path.join(WORK_ROOT, n);
    try { if (fs.statSync(full).mtimeMs < cutoff) { fs.rmSync(full, { recursive: true, force: true }); } } catch (e) {}
  }
}

function removeAllBut(dir, keep) {
  try {
    for (const n of fs.readdirSync(dir)) {
      if (n !== keep) { fs.rmSync(path.join(dir, n), { recursive: true, force: true }); }
    }
  } catch (e) {}
}

/* Move rendered frames into a numbered work folder, as ffmpeg wants them. */
async function collectFrames(result, prefix) {
  sweepWork();
  const work = path.join(WORK_ROOT, prefix + '_' + Date.now());
  fs.mkdirSync(work, { recursive: true });
  const kept = [];
  for (let i = 0; i < result.frames.length; i++) {
    const f = result.frames[i];
    if (!(await waitForStableFile(f.path))) { continue; }
    const dst = path.join(work, String(kept.length + 1).padStart(4, '0') + '.png');
    fs.copyFileSync(f.path, dst);
    try { fs.unlinkSync(f.path); } catch (e) {}
    kept.push({ ...f, file: dst });
  }
  return { work, kept };
}

/* Sample a stretch of animation, stitch it into something watchable, and hand
   back one contact sheet instead of N separate images. */
async function reviewMotion(args) {
  const ffmpeg = findFfmpeg();
  const count = Math.min(Math.max(parseInt(args.frames || 16, 10), 2), 48);
  const fps = args.fps || 12;
  const cols = Math.max(1, parseInt(args.columns || 6, 10));

  const req = { comp: args.comp, frames: count, downscale: args.downscale || 4 };
  if (args.start !== undefined) { req.start = args.start; }
  if (args.duration !== undefined) { req.duration = args.duration; }

  const result = await bridge('render_frame', req);
  const { work, kept } = await collectFrames(result, 'review');
  if (!kept.length) { throw new Error('No frames were rendered.'); }

  const meta = {
    comp: result.comp,
    range: kept[0].time + 's → ' + kept[kept.length - 1].time + 's',
    sampled: kept.length + ' frames at ' + result.renderedWidth + '×' + result.renderedHeight,
    reading_order: 'left to right, top to bottom, ' + cols + ' per row',
    frames: kept.map((k) => k.frame)
  };

  const content = [];
  if (!ffmpeg) {
    meta.note = 'ffmpeg not found — returning frames individually instead of a contact sheet.';
    content.push(text(meta));
    for (const k of kept) {
      try { content.push({ type: 'image', data: await pngToBase64(k.file), mimeType: 'image/png' }); }
      catch (e) {}
    }
    fs.rmSync(work, { recursive: true, force: true });
    return { content };
  }

  const sheet = await contactSheet(kept, cols, work);
  const video = path.join(work, 'motion.mp4');
  try {
    await runAsync(ffmpeg, ['-y', '-framerate', String(fps), '-i', path.join(work, '%04d.png'),
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', video]);
    meta.video = video;
    meta.video_note = 'Open this to watch the sampled motion play back at ' + fps + 'fps.';
  } catch (e) {
    meta.video = null;
    meta.video_note = 'MP4 encode failed: ' + String(e.stderr || e.message).slice(-200);
  }

  content.push(text(meta));
  content.push({ type: 'image', data: fs.readFileSync(sheet).toString('base64'), mimeType: 'image/png' });
  removeAllBut(work, meta.video ? 'motion.mp4' : null);
  if (!meta.video) { try { fs.rmdirSync(work); } catch (e) {} }
  return { content };
}

async function renderFrames(args) {
  const result = await bridge('render_frame', args);
  const meta = {
    comp: result.comp,
    comp_size: result.compWidth + '×' + result.compHeight,
    rendered_at: result.renderedWidth + '×' + result.renderedHeight + ' (the comp\'s own resolution setting)',
    returned_at: '1/' + result.downscale + ' size',
    frames: result.frames.map((f) => ({ time: f.time, frame: f.frame }))
  };
  const n = result.frames.length;
  const wantSheet = args.sheet === true || (args.sheet !== false && n > 3);

  if (wantSheet && n > 1 && findFfmpeg()) {
    const { work, kept } = await collectFrames(result, 'frames');
    const cols = Math.min(kept.length, n <= 4 ? 2 : n <= 9 ? 3 : 4);
    const sheet = await contactSheet(kept, cols, work);
    meta.layout = 'contact sheet, left to right, top to bottom, ' + cols + ' per row';
    const image = fs.readFileSync(sheet).toString('base64');
    fs.rmSync(work, { recursive: true, force: true });
    return { content: [text(meta), { type: 'image', data: image, mimeType: 'image/png' }] };
  }

  const content = [text(meta)];
  for (const f of result.frames) {
    try {
      content.push({ type: 'image', data: await pngToBase64(f.path, false, result.downscale, result.renderedWidth), mimeType: 'image/png' });
    } catch (e) {
      content.push({ type: 'text', text: 'Could not read frame at ' + f.time + 's: ' + e.message });
    }
  }
  return { content };
}

async function runTool(name, args) {
  const tool = BY_NAME.get(name);
  if (!tool) { throw new Error('Unknown tool: ' + name); }
  args = args || {};

  if (tool.custom === 'review_motion') { return reviewMotion(args); }
  if (tool.image) { return renderFrames(args); }

  const result = await bridge(tool.fn, args);
  return { content: [text(result)] };
}

/* ------------------------------------------------------------------ */
/* Prompts & resources                                                 */
/* ------------------------------------------------------------------ */

const SKILL_PATH = path.join(ROOT, 'skills', 'ae-mcp-bridge', 'SKILL.md');

const PROMPTS = [{
  name: 'after-effects',
  description: 'How to work in After Effects through these tools: the read → edit → look loop, addressing, which tool for which edit, and what the guard refusals mean.'
}];

function skillText() {
  try {
    return fs.readFileSync(SKILL_PATH, 'utf8').replace(/^---[\s\S]*?---\s*/, '');
  } catch (e) { return 'Skill file not found at ' + SKILL_PATH + '.'; }
}

const RESOURCES = [
  { uri: 'ae://project', name: 'Open project', mimeType: 'application/json',
    description: 'The open After Effects project: comps, active comp, playhead.' },
  { uri: 'ae://selection', name: 'Selection', mimeType: 'application/json',
    description: 'What the user has selected right now.' }
];

/* ------------------------------------------------------------------ */
/* JSON-RPC over stdio                                                 */
/* ------------------------------------------------------------------ */

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function reply(id, result) { send({ jsonrpc: '2.0', id, result }); }
function fail(id, code, message) { send({ jsonrpc: '2.0', id, error: { code, message } }); }

async function handleMessage(msg) {
  const { id, method, params } = msg;

  if (method === 'initialize') {
    const asked = params && params.protocolVersion;
    return reply(id, {
      protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
      capabilities: { tools: {}, prompts: {}, resources: {} },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      instructions: 'Tools for a live After Effects session. Read before editing, render a frame after ' +
        'every visual change, and use ae_review_motion to judge timing. The "after-effects" prompt has the full guide.'
    });
  }
  if (method === 'notifications/initialized' || method === 'notifications/cancelled') { return; }
  if (method === 'ping') { return reply(id, {}); }

  if (method === 'tools/list') {
    return reply(id, {
      tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))
    });
  }

  if (method === 'tools/call') {
    try {
      const out = await runTool(params.name, params.arguments);
      return reply(id, out);
    } catch (e) {
      return reply(id, { content: [{ type: 'text', text: 'Error: ' + e.message }], isError: true });
    }
  }

  if (method === 'prompts/list') { return reply(id, { prompts: PROMPTS }); }
  if (method === 'prompts/get') {
    if (!params || params.name !== 'after-effects') { return fail(id, -32602, 'Unknown prompt: ' + (params && params.name)); }
    return reply(id, {
      description: PROMPTS[0].description,
      messages: [{ role: 'user', content: { type: 'text', text: skillText() } }]
    });
  }

  if (method === 'resources/list') { return reply(id, { resources: RESOURCES }); }
  if (method === 'resources/templates/list') { return reply(id, { resourceTemplates: [] }); }
  if (method === 'resources/read') {
    const uri = params && params.uri;
    const fn = uri === 'ae://project' ? 'project_info' : uri === 'ae://selection' ? 'selection' : null;
    if (!fn) { return fail(id, -32602, 'Unknown resource: ' + uri); }
    try {
      const result = await bridge(fn, {});
      return reply(id, { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(result) }] });
    } catch (e) {
      return fail(id, -32603, e.message);
    }
  }

  if (id !== undefined) { fail(id, -32601, 'Method not found: ' + method); }
}

let buffer = '';
let pending = 0;
let stdinClosed = false;

function maybeExit() {
  if (stdinClosed && pending === 0) { process.exit(0); }
}

function serve() {
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) { continue; }
    let msg;
    try { msg = JSON.parse(line); }
    catch (e) { continue; }
    pending++;
    Promise.resolve(handleMessage(msg))
      .catch((e) => {
        if (msg && msg.id !== undefined) { fail(msg.id, -32603, e.message); }
      })
      .then(() => { pending--; maybeExit(); });
  }
});
/* Don't tear down while a render or edit is still in flight. */
process.stdin.on('end', () => { stdinClosed = true; maybeExit(); });
}

if (require.main === module) { serve(); }

module.exports = { TOOLS };
