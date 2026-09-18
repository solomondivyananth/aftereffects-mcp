/*
 * bridge.jsx — the After Effects side of the Claude bridge.
 *
 * Runs in ExtendScript (ES3: no let/const/arrows/JSON/Array.indexOf).
 * Everything the MCP server can do lands in __aeDispatch below.
 */

/* ------------------------------------------------------------------ */
/* JSON (ExtendScript has none)                                        */
/* ------------------------------------------------------------------ */

if (typeof JSON === 'undefined') { JSON = {}; }

if (typeof JSON.stringify !== 'function') {
    JSON.stringify = function (v) {
        var s = __jsonStr(v);
        return s === undefined ? 'null' : s;
    };
}
if (typeof JSON.parse !== 'function') {
    JSON.parse = function (text) { return eval('(' + text + ')'); };
}

function __jsonQ(s) {
    var out = '"', i, c, h;
    for (i = 0; i < s.length; i++) {
        c = s.charAt(i);
        if (c === '"' || c === '\\') { out += '\\' + c; }
        else if (c === '\n') { out += '\\n'; }
        else if (c === '\r') { out += '\\r'; }
        else if (c === '\t') { out += '\\t'; }
        else if (c < ' ') {
            h = s.charCodeAt(i).toString(16);
            while (h.length < 4) { h = '0' + h; }
            out += '\\u' + h;
        } else { out += c; }
    }
    return out + '"';
}

function __jsonStr(v) {
    var t = typeof v, i, parts, k, sub;
    if (v === null || v === undefined) { return 'null'; }
    if (t === 'boolean') { return v ? 'true' : 'false'; }
    if (t === 'number') { return isFinite(v) ? String(v) : 'null'; }
    if (t === 'string') { return __jsonQ(v); }
    if (v instanceof Array) {
        parts = [];
        for (i = 0; i < v.length; i++) {
            sub = __jsonStr(v[i]);
            parts.push(sub === undefined ? 'null' : sub);
        }
        return '[' + parts.join(',') + ']';
    }
    if (t === 'object') {
        parts = [];
        for (k in v) {
            if (v.hasOwnProperty(k)) {
                sub = __jsonStr(v[k]);
                if (sub !== undefined) { parts.push(__jsonQ(k) + ':' + sub); }
            }
        }
        return '{' + parts.join(',') + '}';
    }
    return undefined;
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

/* Functions that mutate the project. main.js checks this list against the
   sandbox guard before it will dispatch. Kept here too so the list has one
   source of truth that both sides can read. */
var __AE_WRITE_FNS = 'set_property,add_keyframes,set_expression,clear_expression,' +
    'apply_effect,create_layer,delete_layer,set_layer_props,run_jsx,' +
    'new_project,open_project,save_project,create_comp,set_comp_settings,' +
    'duplicate_comp,import_file,precompose,delete_item,' +
    'edit_keyframes,undo,batch,markers,masks,shape,add_property,remove_property,' +
    'property_meta,text,layer_action,apply_preset,render_queue,menu_command,' +
    'item_action,essential_graphics';

/* Project-level operations. The guard treats these specially: they change
   which project is open, so a sandbox path cannot meaningfully protect them. */
var __AE_PROJECT_FNS = 'new_project,open_project';

/* Writes that manage their own undo history instead of getting one group. */
var __AE_NOGROUP_FNS = 'undo,batch';

/* Set per call from the panel's "Show edits in timeline" switch. */
var __aeReveal = true;

function __aeIn(list, fn) {
    return (',' + list + ',').indexOf(',' + fn + ',') !== -1;
}

function __aeBridge(fn, argsJson) {
    var args, result;
    try {
        args = (argsJson && argsJson.length) ? JSON.parse(argsJson) : {};
    } catch (eParse) {
        return JSON.stringify({ ok: false, error: 'Bad arguments JSON: ' + eParse.toString() });
    }
    __aeReveal = args.__reveal !== false;
    delete args.__reveal;

    var grouped = __aeIn(__AE_WRITE_FNS, fn) && !__aeIn(__AE_NOGROUP_FNS, fn);
    /* A warning alert raised by a scripted operation is modal: it would freeze
       the bridge until someone clicks it. Keep them off screen; errors still
       come back as exceptions. */
    try { app.beginSuppressDialogs(); } catch (eS) {}
    /* With "Show edits in timeline" off, leave the user's view exactly as it
       was — After Effects itself selects layers a script creates. */
    var asksToOpen = args.open === true || (fn === 'item_action' && args.action === 'open');
    var view = (!__aeReveal && __aeIn(__AE_WRITE_FNS, fn) && !asksToOpen) ? _snapshotView() : null;
    if (grouped) { app.beginUndoGroup(_undoLabel(fn, args)); }
    try {
        result = __aeDispatch(fn, args);
        if (view) { _restoreView(view); }
        return __aeWrap({ ok: true, result: result });
    } catch (e) {
        return JSON.stringify({
            ok: false,
            error: e.toString() + (e.line ? ' (bridge.jsx line ' + e.line + ')' : '')
        });
    } finally {
        if (grouped) { app.endUndoGroup(); }
        try { app.endSuppressDialogs(false); } catch (eE) {}
    }
}

function _snapshotView() {
    var c = app.project.activeItem, v = { comp: null, time: 0, layers: [] }, i;
    if (!(c && c instanceof CompItem)) { return v; }
    v.comp = c; v.time = c.time;
    for (i = 0; i < c.selectedLayers.length; i++) { v.layers.push(c.selectedLayers[i]); }
    return v;
}

function _restoreView(v) {
    var i, c = v.comp;
    try {
        if (!c) { return; }
        if (app.project.activeItem !== c) { c.openInViewer(); }
        for (i = 1; i <= c.numLayers; i++) { c.layer(i).selected = false; }
        for (i = 0; i < v.layers.length; i++) { try { v.layers[i].selected = true; } catch (eL) { /* deleted */ } }
        c.time = v.time;
    } catch (e) {}
}

/* What the user sees in Edit ▸ Undo — "Undo MCP: Set Position", the way a
   hand edit reads, not an opaque function name. */
function _undoLabel(fn, a) {
    var words = fn.split('_'), i, label;
    for (i = 0; i < words.length; i++) {
        words[i] = words[i].charAt(0).toUpperCase() + words[i].substring(1);
    }
    label = words.join(' ');
    if (a && a.path instanceof Array && a.path.length) {
        label += ' · ' + a.path[a.path.length - 1];
    } else if (a && a.action) {
        label += ' · ' + a.action;
    }
    return 'MCP: ' + label;
}

/* Big payloads choke evalScript's return channel — spill them to a temp
   file and hand back the path instead. */
function __aeWrap(obj) {
    var s = JSON.stringify(obj);
    if (s.length > 100000) {
        var f = new File(Folder.temp.fsName + '/ae_bridge_' + (new Date()).getTime() + '.json');
        f.encoding = 'UTF-8';
        f.open('w');
        f.write(s);
        f.close();
        return JSON.stringify({ ok: true, spillFile: f.fsName });
    }
    return s;
}

function __aeDispatch(fn, a) {
    switch (fn) {
        case 'ping':            return { aeVersion: app.version, buildName: app.buildName };
        case 'write_fns':       return __AE_WRITE_FNS.split(',');
        case 'project_fns':     return __AE_PROJECT_FNS.split(',');
        case 'list_items':      return aeListItems(a);
        case 'new_project':     return aeNewProject(a);
        case 'open_project':    return aeOpenProject(a);
        case 'save_project':    return aeSaveProject(a);
        case 'create_comp':     return aeCreateComp(a);
        case 'set_comp_settings': return aeSetCompSettings(a);
        case 'duplicate_comp':  return aeDuplicateComp(a);
        case 'import_file':     return aeImportFile(a);
        case 'precompose':      return aePrecompose(a);
        case 'delete_item':     return aeDeleteItem(a);
        case 'project_info':    return aeProjectInfo(a);
        case 'comp_tree':       return aeCompTree(a);
        case 'layer_detail':    return aeLayerDetail(a);
        case 'selection':       return aeSelection(a);
        case 'find_animation':  return aeFindAnimation(a);
        case 'render_frame':    return aeRenderFrame(a);
        case 'set_property':    return aeSetProperty(a);
        case 'add_keyframes':   return aeAddKeyframes(a);
        case 'set_expression':  return aeSetExpression(a);
        case 'clear_expression':return aeClearExpression(a);
        case 'apply_effect':    return aeApplyEffect(a);
        case 'create_layer':    return aeCreateLayer(a);
        case 'delete_layer':    return aeDeleteLayer(a);
        case 'set_layer_props': return aeSetLayerProps(a);
        case 'run_jsx':         return aeRunJsx(a);
        case 'edit_keyframes':  return aeEditKeyframes(a);
        case 'undo':            return aeUndo(a);
        case 'batch':           return aeBatch(a);
        case 'markers':         return aeMarkers(a);
        case 'masks':           return aeMasks(a);
        case 'shape':           return aeShape(a);
        case 'add_property':    return aeAddProperty(a);
        case 'remove_property': return aeRemoveProperty(a);
        case 'property_meta':   return aePropertyMeta(a);
        case 'text':            return aeText(a);
        case 'layer_action':    return aeLayerAction(a);
        case 'apply_preset':    return aeApplyPreset(a);
        case 'catalog':         return aeCatalog(a);
        case 'render_queue':    return aeRenderQueue(a);
        case 'menu_command':    return aeMenuCommand(a);
        case 'goto':            return aeGoto(a);
        case 'item_action':     return aeItemAction(a);
        case 'essential_graphics': return aeEssentialGraphics(a);
        default: throw new Error('Unknown bridge function: ' + fn);
    }
}

/* ------------------------------------------------------------------ */
/* Lookup helpers                                                      */
/* ------------------------------------------------------------------ */

function _comps() {
    var out = [], i, it;
    for (i = 1; i <= app.project.numItems; i++) {
        it = app.project.item(i);
        if (it instanceof CompItem) { out.push(it); }
    }
    return out;
}

function _findComp(name) {
    var all, i, active;
    if (name === undefined || name === null || name === '') {
        active = app.project.activeItem;
        if (active && active instanceof CompItem) { return active; }
        all = _comps();
        if (all.length === 1) { return all[0]; }
        throw new Error('No composition given and no active composition. Open a comp in the timeline, or pass "comp".');
    }
    all = _comps();
    for (i = 0; i < all.length; i++) {
        if (typeof name === 'number' ? all[i].id === name : all[i].name === name) { return all[i]; }
    }
    throw new Error('Composition not found: "' + name + '"');
}

/* Many layers at once. ref is an array of names/indices, "selected", "all",
   or {match: "regex"} against layer names. */
function _findLayers(comp, ref) {
    var out = [], i, re;
    if (ref === 'selected' || ref === undefined || ref === null) {
        for (i = 0; i < comp.selectedLayers.length; i++) { out.push(comp.selectedLayers[i]); }
        if (!out.length) { throw new Error('No layers selected in "' + comp.name + '".'); }
        return out;
    }
    if (ref === 'all') {
        for (i = 1; i <= comp.numLayers; i++) { out.push(comp.layer(i)); }
        return out;
    }
    if (ref instanceof Array) {
        for (i = 0; i < ref.length; i++) { out.push(_findLayer(comp, ref[i])); }
        return out;
    }
    if (typeof ref === 'object' && ref.match !== undefined) {
        re = new RegExp(ref.match, ref.flags || '');
        for (i = 1; i <= comp.numLayers; i++) {
            if (re.test(comp.layer(i).name)) { out.push(comp.layer(i)); }
        }
        if (!out.length) { throw new Error('No layer name matches /' + ref.match + '/ in "' + comp.name + '".'); }
        return out;
    }
    return [_findLayer(comp, ref)];
}

/* The layers the last _eachLayer call worked on, as objects. Edits can
   rename or reorder them, so they are never looked up again by name/index. */
var __aeTouched = [];

/* Run fn(layer) over a.layers when given (many), otherwise over a.layer. */
function _eachLayer(comp, a, fn) {
    var targets, out = [], i;
    targets = a.layers === undefined ? [_findLayer(comp, a.layer)] : _findLayers(comp, a.layers);
    __aeTouched = targets;
    if (a.layers === undefined) { return fn(targets[0]); }
    for (i = 0; i < targets.length; i++) { out.push(fn(targets[i])); }
    return { comp: comp.name, count: out.length, results: out };
}

/* Time the way After Effects users say it: seconds (2.5), frames ("75f"),
   or timecode ("0:00:02:15", "2:15" = 2s 15f). Always returns seconds. */
function _time(comp, v, what) {
    var s, m, parts, fps, h, mi, se, fr;
    if (v === undefined || v === null) { return v; }
    if (typeof v === 'number') { return v; }
    fps = comp ? comp.frameRate : 30;
    s = String(v).replace(/\s+/g, '');
    if (/^-?\d+(\.\d+)?f$/i.test(s)) { return parseFloat(s) / fps; }
    if (/^-?\d+(\.\d+)?s$/i.test(s)) { return parseFloat(s); }
    if (/^\d+([:;]\d+){1,3}$/.test(s)) {
        parts = s.split(/[:;]/);
        while (parts.length < 4) { parts.unshift('0'); }
        h = +parts[0]; mi = +parts[1]; se = +parts[2]; fr = +parts[3];
        return h * 3600 + mi * 60 + se + fr / fps;
    }
    m = Number(s);
    if (isNaN(m)) {
        throw new Error('Could not read ' + (what || 'time') + ' "' + v +
            '". Use seconds (2.5), frames ("75f") or timecode ("0:00:02:15").');
    }
    return m;
}

function _frame(comp, t) { return Math.round(t * comp.frameRate); }

/* "#ff8800", "#f80", [255,136,0] or [1,0.53,0] → [r,g,b] in 0-1. */
function _color(v, withAlpha) {
    var s, r, g, b, a = 1, out, i, big = false;
    if (typeof v === 'string') {
        s = v.replace('#', '');
        if (s.length === 3) { s = s.charAt(0) + s.charAt(0) + s.charAt(1) + s.charAt(1) + s.charAt(2) + s.charAt(2); }
        if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(s)) { throw new Error('Bad colour "' + v + '". Use "#rrggbb" or [r,g,b] 0-1.'); }
        r = parseInt(s.substr(0, 2), 16) / 255;
        g = parseInt(s.substr(2, 2), 16) / 255;
        b = parseInt(s.substr(4, 2), 16) / 255;
        if (s.length === 8) { a = parseInt(s.substr(6, 2), 16) / 255; }
        out = [r, g, b];
    } else if (v instanceof Array) {
        for (i = 0; i < v.length; i++) { if (v[i] > 1) { big = true; } }
        out = [];
        for (i = 0; i < 3; i++) { out.push(big ? v[i] / 255 : v[i]); }
        if (v.length > 3) { a = big ? v[3] / 255 : v[3]; }
    } else {
        return v;
    }
    if (withAlpha) { out.push(a); }
    return out;
}

/* {vertices, inTangents, outTangents, closed} ↔ AE Shape. */
function _toShape(v) {
    var sh = new Shape();
    if (v instanceof Shape) { return v; }
    sh.vertices = v.vertices;
    sh.inTangents = v.inTangents || _zeros(v.vertices.length);
    sh.outTangents = v.outTangents || _zeros(v.vertices.length);
    sh.closed = v.closed !== false;
    if (v.featherSegLocs) { sh.featherSegLocs = v.featherSegLocs; }
    if (v.featherRelSegLocs) { sh.featherRelSegLocs = v.featherRelSegLocs; }
    if (v.featherRadii) { sh.featherRadii = v.featherRadii; }
    return sh;
}

function _zeros(n) {
    var out = [], i;
    for (i = 0; i < n; i++) { out.push([0, 0]); }
    return out;
}

function _fromShape(sh) {
    function pts(list) {
        var out = [], i;
        for (i = 0; i < list.length; i++) { out.push([_round(list[i][0]), _round(list[i][1])]); }
        return out;
    }
    return { vertices: pts(sh.vertices), inTangents: pts(sh.inTangents),
             outTangents: pts(sh.outTangents), closed: sh.closed };
}

/* Show the edit the way a person would have made it: the touched layers
   selected, the playhead on the moment that changed. Only inside the comp the
   user already has open — switching viewers brings After Effects to the front
   and pulls the user away from whatever app they are in. Opening a comp is
   something the agent asks for explicitly (ae_goto, open: true). The panel's
   "Show edits in timeline" switch turns this off. */
function _reveal(comp, layers, time) {
    var i, j;
    if (!__aeReveal || !comp) { return; }
    try {
        if (app.project.activeItem !== comp) { return; }
        if (layers) {
            if (!(layers instanceof Array)) { layers = [layers]; }
            for (i = 1; i <= comp.numLayers; i++) { comp.layer(i).selected = false; }
            for (j = 0; j < layers.length; j++) {
                try { if (layers[j] && layers[j].containingComp === comp) { layers[j].selected = true; } } catch (eS) {}
            }
        }
        if (typeof time === 'number' && time >= 0 && time <= comp.duration) { comp.time = time; }
    } catch (e) { /* never fail an edit because the UI could not follow it */ }
}

function _findLayer(comp, ref) {
    var i;
    if (ref === undefined || ref === null) {
        if (comp.selectedLayers.length === 1) { return comp.selectedLayers[0]; }
        throw new Error('No layer given and no single selected layer in "' + comp.name + '".');
    }
    if (typeof ref === 'number') {
        if (ref < 1 || ref > comp.numLayers) {
            throw new Error('Layer index ' + ref + ' out of range (comp has ' + comp.numLayers + ' layers).');
        }
        return comp.layer(ref);
    }
    for (i = 1; i <= comp.numLayers; i++) {
        if (comp.layer(i).name === ref) { return comp.layer(i); }
    }
    throw new Error('Layer not found in "' + comp.name + '": "' + ref + '"');
}

/* path is an array like ["Transform","Position"] or
   ["Effects","Gaussian Blur","Blurriness"]. Names OR matchNames both work. */
function _findProp(layer, path) {
    var node = layer, i, seg, next;
    if (!(path instanceof Array) || path.length === 0) {
        throw new Error('"path" must be a non-empty array, e.g. ["Transform","Position"].');
    }
    for (i = 0; i < path.length; i++) {
        seg = path[i];
        next = null;
        try { next = node.property(seg); } catch (e) { next = null; }
        if (!next) {
            throw new Error('Property "' + seg + '" not found under ' +
                (i === 0 ? 'layer "' + layer.name + '"' : '"' + path[i - 1] + '"') +
                '. Available: ' + _childNames(node).join(', '));
        }
        node = next;
    }
    return node;
}

function _childNames(group) {
    var out = [], i;
    try {
        for (i = 1; i <= group.numProperties; i++) { out.push(group.property(i).name); }
    } catch (e) { /* leaf property */ }
    return out;
}

/* ------------------------------------------------------------------ */
/* Value serialisation                                                 */
/* ------------------------------------------------------------------ */

function _plainValue(v) {
    var out, i;
    if (v instanceof Array) {
        out = [];
        for (i = 0; i < v.length; i++) { out.push(_round(v[i])); }
        return out;
    }
    if (typeof v === 'number') { return _round(v); }
    if (v instanceof Shape) { return _fromShape(v); }
    if (v instanceof TextDocument) { return _textStyle(v, false); }
    return v;
}

var __JUSTIFY = null;
function _justifyMap() {
    if (!__JUSTIFY) {
        __JUSTIFY = {
            left: ParagraphJustification.LEFT_JUSTIFY,
            center: ParagraphJustification.CENTER_JUSTIFY,
            right: ParagraphJustification.RIGHT_JUSTIFY,
            full_left: ParagraphJustification.FULL_JUSTIFY_LASTLINE_LEFT,
            full_center: ParagraphJustification.FULL_JUSTIFY_LASTLINE_CENTER,
            full_right: ParagraphJustification.FULL_JUSTIFY_LASTLINE_RIGHT,
            full: ParagraphJustification.FULL_JUSTIFY_LASTLINE_FULL
        };
    }
    return __JUSTIFY;
}

/* Every character-panel and paragraph-panel setting a script can reach. */
var __TEXT_KEYS = ['font', 'fontSize', 'fillColor', 'strokeColor', 'strokeWidth',
    'applyFill', 'applyStroke', 'strokeOverFill', 'tracking', 'leading', 'autoLeading',
    'baselineShift', 'horizontalScale', 'verticalScale', 'allCaps', 'smallCaps',
    'fauxBold', 'fauxItalic', 'superscript', 'subscript', 'tsume', 'boxText',
    'boxTextSize', 'boxTextPos', 'pointText', 'lineJoinType', 'firstLineIndent',
    'startIndent', 'endIndent', 'spaceBefore', 'spaceAfter', 'kerningType'];

function _textStyle(td, full) {
    var out = { text: td.text }, i, k, v, jm, j;
    for (i = 0; i < __TEXT_KEYS.length; i++) {
        k = __TEXT_KEYS[i];
        if (!full && k !== 'font' && k !== 'fontSize' && k !== 'fillColor' && k !== 'justification') { continue; }
        try {
            v = td[k];
            if (v === undefined) { continue; }
            if (k === 'fillColor' || k === 'strokeColor') { v = _plainValue(v); }
            else if (v instanceof Array) { v = _plainValue(v); }
            else if (typeof v === 'number') { v = _round(v); }
            else if (typeof v !== 'string' && typeof v !== 'boolean') { v = String(v); }
            out[k] = v;
        } catch (e) { /* not applicable to this text (e.g. stroke with applyStroke off) */ }
    }
    try {
        jm = _justifyMap();
        for (j in jm) { if (jm.hasOwnProperty(j) && jm[j] === td.justification) { out.justification = j; } }
    } catch (eJ) {}
    return out;
}

function _propComp(p) {
    try { return p.propertyGroup(p.propertyDepth).containingComp; } catch (e) { return null; }
}

function _round(n) {
    if (typeof n !== 'number' || !isFinite(n)) { return n; }
    return Math.round(n * 10000) / 10000;
}

function _safeValue(p) {
    var t;
    try { t = p.propertyValueType; } catch (e) { return null; }
    if (t === PropertyValueType.CUSTOM_VALUE || t === PropertyValueType.MARKER ||
        t === PropertyValueType.NO_VALUE) {
        return null;
    }
    try { return _plainValue(p.value); } catch (e2) { return null; }
}

function _interpName(t) {
    if (t === KeyframeInterpolationType.LINEAR) { return 'linear'; }
    if (t === KeyframeInterpolationType.BEZIER) { return 'bezier'; }
    if (t === KeyframeInterpolationType.HOLD) { return 'hold'; }
    return 'other';
}

function _keys(p) {
    var out = [], k, ease, comp = _propComp(p);
    for (k = 1; k <= p.numKeys; k++) {
        var entry = {
            index: k,
            time: _round(p.keyTime(k)),
            value: (function () { try { return _plainValue(p.keyValue(k)); } catch (e) { return null; } })(),
            inInterp: _interpName(p.keyInInterpolationType(k)),
            outInterp: _interpName(p.keyOutInterpolationType(k))
        };
        if (comp) { entry.frame = _frame(comp, p.keyTime(k)); }
        try {
            ease = p.keyOutTemporalEase(k);
            if (ease && ease.length) {
                entry.outInfluence = _round(ease[0].influence);
                if (ease[0].speed !== 0) { entry.outSpeed = _round(ease[0].speed); }
            }
            ease = p.keyInTemporalEase(k);
            if (ease && ease.length) {
                entry.inInfluence = _round(ease[0].influence);
                if (ease[0].speed !== 0) { entry.inSpeed = _round(ease[0].speed); }
            }
        } catch (eEase) { /* not a temporal property */ }
        try { if (p.keyRoving(k)) { entry.roving = true; } } catch (eR) {}
        try { if (p.keySelected(k)) { entry.selected = true; } } catch (eSel) {}
        out.push(entry);
    }
    return out;
}

/* ------------------------------------------------------------------ */
/* Read: project / comp / layer                                        */
/* ------------------------------------------------------------------ */

function aeProjectInfo() {
    var comps = _comps(), out = [], i, c, active;
    for (i = 0; i < comps.length; i++) {
        c = comps[i];
        out.push({
            name: c.name,
            id: c.id,
            width: c.width,
            height: c.height,
            duration: _round(c.duration),
            frameRate: _round(c.frameRate),
            numLayers: c.numLayers,
            workAreaStart: _round(c.workAreaStart),
            workAreaDuration: _round(c.workAreaDuration)
        });
    }
    active = app.project.activeItem;
    return {
        projectPath: app.project.file ? app.project.file.fsName : null,
        projectName: app.project.file ? app.project.file.name : '(unsaved)',
        numItems: app.project.numItems,
        aeVersion: app.version,
        activeComp: (active && active instanceof CompItem) ? active.name : null,
        currentTime: (active && active instanceof CompItem) ? _round(active.time) : null,
        comps: out
    };
}

function _layerKind(L) {
    if (L instanceof CameraLayer) { return 'camera'; }
    if (L instanceof LightLayer) { return 'light'; }
    if (L instanceof TextLayer) { return 'text'; }
    if (L instanceof ShapeLayer) { return 'shape'; }
    if (L instanceof AVLayer) {
        if (L.nullLayer) { return 'null'; }
        if (L.adjustmentLayer) { return 'adjustment'; }
        if (L.source instanceof CompItem) { return 'precomp'; }
        try { if (L.source.mainSource instanceof SolidSource) { return 'solid'; } } catch (eSrc) {}
        return 'footage';
    }
    return 'other';
}

var __BLEND_NAMES = null;
function _blendName(v) {
    var k;
    if (!__BLEND_NAMES) {
        __BLEND_NAMES = {};
        for (k in BlendingMode) {
            if (typeof BlendingMode[k] === 'number' || BlendingMode[k] !== undefined) {
                __BLEND_NAMES[String(BlendingMode[k].valueOf())] = k.toLowerCase().replace(/_/g, ' ');
            }
        }
    }
    var name = __BLEND_NAMES[String(v.valueOf())];
    return name ? name : String(v);
}

function _transformSummary(L) {
    var tr, out = {}, names, i, p;
    try { tr = L.property('ADBE Transform Group'); } catch (e) { return null; }
    if (!tr) { return null; }
    names = ['Anchor Point', 'Position', 'Scale', 'Rotation', 'Opacity',
             'X Rotation', 'Y Rotation', 'Orientation'];
    for (i = 0; i < names.length; i++) {
        p = null;
        try { p = tr.property(names[i]); } catch (e2) { p = null; }
        if (!p) { continue; }
        out[names[i]] = {
            value: _safeValue(p),
            numKeys: p.numKeys,
            expression: (p.expression && p.expression.length) ? p.expression : null
        };
    }
    return out;
}

function _effectNames(L) {
    var out = [], fx, i, e;
    try { fx = L.property('ADBE Effect Parade'); } catch (err) { return out; }
    if (!fx) { return out; }
    for (i = 1; i <= fx.numProperties; i++) {
        e = fx.property(i);
        out.push({ name: e.name, matchName: e.matchName, enabled: e.enabled });
    }
    return out;
}

/* Walk an entire layer looking for anything that actually animates. Transform
   is only one of many places animation can live — text animators, shape trim
   paths, mask paths and effect parameters all count. */
function _scanAnimated(root, trail, out, depth, budget) {
    var i, p, name, path;
    if (depth > 8 || out.length >= 60 || budget.n > 4000) { return; }
    for (i = 1; i <= root.numProperties; i++) {
        budget.n++;
        if (budget.n > 4000) { return; }
        p = root.property(i);
        name = p.name;
        path = (name && name.length) ? trail.concat([name]) : trail;
        if (p.propertyType === PropertyType.PROPERTY) {
            var entry = null;
            if (p.numKeys > 0) {
                entry = { path: path, keys: p.numKeys,
                          from: _round(p.keyTime(1)), to: _round(p.keyTime(p.numKeys)) };
            } else {
                try {
                    if (p.canSetExpression && p.expression && p.expression.length) {
                        entry = { path: path, expression: p.expression.replace(/[\r\n]+/g, ' ') };
                    }
                } catch (eE) {}
            }
            if (entry) {
                try {
                    if (p.expression && p.expression.length) {
                        if (entry.keys) { entry.expression = p.expression.replace(/[\r\n]+/g, ' '); }
                        if (!p.expressionEnabled) { entry.expressionEnabled = false; }
                        if (p.expressionError && p.expressionError.length) { entry.expressionError = p.expressionError; }
                    }
                } catch (eX) {}
                out.push(entry);
            }
        } else if (p.numProperties > 0) {
            _scanAnimated(p, path, out, depth + 1, budget);
        }
    }
}

function aeFindAnimation(a) {
    var comp = _findComp(a.comp), out = [], i, L, found;
    for (i = 1; i <= comp.numLayers; i++) {
        L = comp.layer(i);
        if (a.layer !== undefined && a.layer !== null) {
            if (typeof a.layer === 'number' ? (i !== a.layer) : (L.name !== a.layer)) { continue; }
        }
        found = [];
        _scanAnimated(L, [], found, 0, { n: 0 });
        out.push({ index: i, layer: L.name, kind: _layerKind(L), animated: found });
    }
    return { comp: comp.name, layers: out };
}

function aeCompTree(a) {
    var comp = _findComp(a.comp), layers = [], i, L, entry;
    for (i = 1; i <= comp.numLayers; i++) {
        L = comp.layer(i);
        entry = {
            index: i,
            name: L.name,
            kind: _layerKind(L),
            enabled: L.enabled,
            solo: L.solo,
            shy: L.shy,
            locked: L.locked,
            inPoint: _round(L.inPoint),
            outPoint: _round(L.outPoint),
            startTime: _round(L.startTime),
            parent: L.parent ? L.parent.index : null
        };
        try { entry.threeD = L.threeDLayer; } catch (e1) {}
        try { entry.blendingMode = _blendName(L.blendingMode); } catch (e2) {}
        try { if (L.source) { entry.source = L.source.name; } } catch (e3) {}
        try { entry.numMasks = L.property('ADBE Mask Parade') ? L.property('ADBE Mask Parade').numProperties : 0; } catch (e4) {}
        if (a.transforms !== false) { entry.transform = _transformSummary(L); }
        if (a.effects !== false) { entry.effects = _effectNames(L); }
        if (a.animation !== false) {
            var found = [];
            _scanAnimated(L, [], found, 0, { n: 0 });
            entry.animatedProperties = found;
            entry.isAnimated = found.length > 0;
        }
        layers.push(entry);
    }
    return {
        comp: comp.name,
        width: comp.width,
        height: comp.height,
        duration: _round(comp.duration),
        frameRate: _round(comp.frameRate),
        currentTime: _round(comp.time),
        bgColor: _plainValue(comp.bgColor),
        layers: layers
    };
}

function _walk(group, depth, maxDepth, includeEmpty) {
    var out = [], i, p, node, elided, inner, j;
    for (i = 1; i <= group.numProperties; i++) {
        p = group.property(i);
        /* "elided" means AE doesn't draw this group as its own row in the
           timeline (Animators, Selectors, Properties). Its children are still
           real and are often where the animation lives — flatten, never skip.
           Skipping these is how a text animator reads as "not animated". */
        elided = false;
        try { elided = !!p.elided; } catch (eEl) { elided = false; }
        if (elided && p.propertyType !== PropertyType.PROPERTY && p.numProperties > 0) {
            inner = _walk(p, depth, maxDepth, includeEmpty);
            for (j = 0; j < inner.length; j++) { out.push(inner[j]); }
            continue;
        }
        node = { name: p.name, matchName: p.matchName };
        try { if (p.enabled === false) { node.enabled = false; } } catch (eEn) {}

        if (p.propertyType === PropertyType.PROPERTY) {
            node.value = _safeValue(p);
            try {
                if (p.canSetExpression && p.expression && p.expression.length) {
                    node.expression = p.expression;
                    node.expressionEnabled = p.expressionEnabled;
                    if (p.expressionError && p.expressionError.length) { node.expressionError = p.expressionError; }
                }
            } catch (eEx) {}
            if (p.numKeys > 0) { node.keys = _keys(p); }
            /* A static, keyless, expression-free property at default is noise. */
            if (!includeEmpty && node.value === null && !node.expression && !node.keys) { continue; }
        } else {
            if (p.numProperties === 0) { continue; }
            if (depth < maxDepth) {
                node.properties = _walk(p, depth + 1, maxDepth, includeEmpty);
                if (node.properties.length === 0) { continue; }
            } else {
                node.truncated = p.numProperties + ' sub-properties (raise maxDepth to see them)';
            }
        }
        out.push(node);
    }
    return out;
}

function aeLayerDetail(a) {
    var comp = _findComp(a.comp),
        L = _findLayer(comp, a.layer),
        maxDepth = (typeof a.maxDepth === 'number') ? a.maxDepth : 4,
        root, props;

    if (a.path && a.path instanceof Array && a.path.length) {
        root = _findProp(L, a.path);
        if (root.propertyType === PropertyType.PROPERTY) {
            props = [{
                name: root.name,
                matchName: root.matchName,
                value: root.propertyValueType === PropertyValueType.TEXT_DOCUMENT
                    ? _textStyle(root.value, true) : _safeValue(root),
                expression: (root.expression && root.expression.length) ? root.expression : null,
                keys: root.numKeys > 0 ? _keys(root) : null
            }];
        } else {
            props = _walk(root, 0, maxDepth, a.includeDefaults === true);
        }
    } else {
        props = _walk(L, 0, maxDepth, a.includeDefaults === true);
    }

    return {
        comp: comp.name,
        layer: L.name,
        index: L.index,
        kind: _layerKind(L),
        inPoint: _round(L.inPoint),
        outPoint: _round(L.outPoint),
        properties: props
    };
}

function aeSelection() {
    var active = app.project.activeItem, comp, i, sel, out;
    if (!(active && active instanceof CompItem)) {
        return { comp: null, note: 'No composition is open in the timeline.' };
    }
    comp = active;
    out = { comp: comp.name, currentTime: _round(comp.time), layers: [], properties: [] };
    sel = comp.selectedLayers;
    for (i = 0; i < sel.length; i++) {
        out.layers.push({ index: sel[i].index, name: sel[i].name, kind: _layerKind(sel[i]) });
    }
    sel = comp.selectedProperties;
    for (i = 0; i < sel.length; i++) {
        var sp = sel[i], entry = {
            name: sp.name,
            matchName: sp.matchName,
            layer: (function () { try { return sp.propertyGroup(sp.propertyDepth).name; } catch (e) { return null; } })(),
            path: _propPath(sp)
        };
        try {
            if (sp.propertyType === PropertyType.PROPERTY && sp.selectedKeys && sp.selectedKeys.length) {
                entry.selectedKeys = [];
                for (var s2 = 0; s2 < sp.selectedKeys.length; s2++) {
                    entry.selectedKeys.push({ index: sp.selectedKeys[s2],
                        time: _round(sp.keyTime(sp.selectedKeys[s2])),
                        frame: _frame(comp, sp.keyTime(sp.selectedKeys[s2])) });
                }
            }
        } catch (eK) {}
        out.properties.push(entry);
    }
    out.frame = _frame(comp, comp.time);
    try { out.workArea = { start: _round(comp.workAreaStart), duration: _round(comp.workAreaDuration) }; } catch (eW) {}
    return out;
}

/* ------------------------------------------------------------------ */
/* View                                                                */
/* ------------------------------------------------------------------ */

function aeRenderFrame(a) {
    var comp = _findComp(a.comp),
        times = [],
        saved = comp.resolutionFactor,
        down = (typeof a.downscale === 'number' && a.downscale >= 1) ? Math.floor(a.downscale) : 2,
        stamp = (new Date()).getTime(),
        outDir = a.outDir || Folder.temp.fsName,
        files = [], i, t, f;

    if (a.times instanceof Array && a.times.length) {
        for (i = 0; i < a.times.length; i++) { times.push(_time(comp, a.times[i])); }
    } else if (a.time !== undefined && a.time !== null) {
        times.push(_time(comp, a.time));
    } else if (typeof a.frames === 'number' && a.frames > 1) {
        var start = (a.start !== undefined) ? _time(comp, a.start) : comp.workAreaStart;
        var dur = (a.duration !== undefined) ? _time(comp, a.duration) : comp.workAreaDuration;
        for (i = 0; i < a.frames; i++) {
            times.push(start + (dur * i / (a.frames - 1)));
        }
    } else {
        times.push(comp.time);
    }

    /* Never touch resolutionFactor: it is an undoable edit, and every way of
       putting it back leaves entries in Edit ▸ Undo (or risks undoing the
       user's own work). Render at the comp's own resolution, as the viewer
       does; "downscale" only shrinks the image that is sent back. */
    for (i = 0; i < times.length; i++) {
        t = Math.max(0, Math.min(times[i], comp.duration - (1 / comp.frameRate)));
        f = new File(outDir + '/ae_frame_' + stamp + '_' + i + '.png');
        comp.saveFrameToPng(t, f);
        files.push({ path: f.fsName, time: _round(t), frame: Math.round(t * comp.frameRate) });
    }

    return {
        comp: comp.name,
        compWidth: comp.width,
        compHeight: comp.height,
        renderedWidth: Math.floor(comp.width / saved[0]),
        renderedHeight: Math.floor(comp.height / saved[1]),
        downscale: down,
        frames: files
    };
}

/* ------------------------------------------------------------------ */
/* Edit                                                                */
/* ------------------------------------------------------------------ */

function _coerceForProp(p, value) {
    var t = p.propertyValueType, td;
    if (t === PropertyValueType.TEXT_DOCUMENT) {
        td = p.value;
        if (typeof value === 'string') { td.text = value; }
        else { _applyTextStyle(td, value); }
        return td;
    }
    if (t === PropertyValueType.SHAPE) { return _toShape(value); }
    if (t === PropertyValueType.COLOR) { return _color(value, true); }
    return value;
}

function _applyTextStyle(td, s) {
    var k;
    if (s.text !== undefined) { td.text = String(s.text); }
    if (s.applyFill === undefined && s.fillColor !== undefined) { td.applyFill = true; }
    if (s.applyStroke === undefined && s.strokeColor !== undefined) { td.applyStroke = true; }
    for (k in s) {
        if (!s.hasOwnProperty(k) || k === 'text') { continue; }
        if (k === 'justification') {
            if (_justifyMap()[s[k]] === undefined) {
                throw new Error('justification must be one of: left, center, right, full_left, full_center, full_right, full.');
            }
            td.justification = _justifyMap()[s[k]];
        } else if (k === 'fillColor' || k === 'strokeColor') {
            td[k] = _color(s[k], false);
        } else {
            try { td[k] = s[k]; }
            catch (e) { throw new Error('Text setting "' + k + '" could not be set: ' + e.toString()); }
        }
    }
    return td;
}

/* Ease presets named the way the Keyframe Assistant names them. */
function _easePair(ease) {
    if (ease === 'easy' || ease === 'easy_ease') { return { inI: 33.333, outI: 33.333 }; }
    if (ease === 'easy_in') { return { inI: 33.333, outI: null }; }
    if (ease === 'easy_out') { return { inI: null, outI: 33.333 }; }
    if (typeof ease === 'number') { return { inI: ease, outI: ease }; }
    if (ease && typeof ease === 'object') {
        return { inI: ease['in'] !== undefined ? ease['in'] : null,
                 outI: ease.out !== undefined ? ease.out : null,
                 inS: ease.inSpeed, outS: ease.outSpeed };
    }
    throw new Error('ease must be a number 0.1-100, "easy", "easy_in", "easy_out" or {in, out, inSpeed, outSpeed}.');
}

function _dims(p) {
    var t = p.propertyValueType;
    if (t === PropertyValueType.TwoD) { return 2; }
    if (t === PropertyValueType.ThreeD) { return 3; }
    /* Spatial properties and colours carry one ease for all dimensions. */
    return 1;
}

function _applyEase(p, idx, ease) {
    var e = _easePair(ease), n = _dims(p), inE = [], outE = [], d, curIn, curOut, inI, outI;
    curIn = p.keyInTemporalEase(idx);
    curOut = p.keyOutTemporalEase(idx);
    for (d = 0; d < n; d++) {
        inI = e.inI === null ? curIn[d].influence : Math.max(0.1, Math.min(100, e.inI));
        outI = e.outI === null ? curOut[d].influence : Math.max(0.1, Math.min(100, e.outI));
        inE.push(new KeyframeEase(e.inS !== undefined ? e.inS : (e.inI === null ? curIn[d].speed : 0), inI));
        outE.push(new KeyframeEase(e.outS !== undefined ? e.outS : (e.outI === null ? curOut[d].speed : 0), outI));
    }
    p.setInterpolationTypeAtKey(idx,
        e.inI === null ? p.keyInInterpolationType(idx) : KeyframeInterpolationType.BEZIER,
        e.outI === null ? p.keyOutInterpolationType(idx) : KeyframeInterpolationType.BEZIER);
    p.setTemporalEaseAtKey(idx, inE, outE);
}

var __INTERP = null;
function _interp(name) {
    if (!__INTERP) {
        __INTERP = { linear: KeyframeInterpolationType.LINEAR,
                     bezier: KeyframeInterpolationType.BEZIER,
                     hold: KeyframeInterpolationType.HOLD };
    }
    if (__INTERP[name] === undefined) { throw new Error('interp must be linear, bezier or hold.'); }
    return __INTERP[name];
}

function _settable(p) {
    if (p.propertyType !== PropertyType.PROPERTY) {
        throw new Error('"' + p.name + '" is a group, not a settable property. Its children: ' +
            _childNames(p).join(', '));
    }
    return p;
}

function aeSetProperty(a) {
    var comp = _findComp(a.comp), lastTime;
    var res = _eachLayer(comp, a, function (L) {
        var p = _settable(_findProp(L, a.path)), before = _safeValue(p), v, t;
        v = _coerceForProp(p, a.value);
        if (a.time !== undefined && a.time !== null) {
            t = _time(comp, a.time);
            before = (function () { try { return _plainValue(p.valueAtTime(t, true)); } catch (e) { return null; } })();
            p.setValueAtTime(t, v);
            lastTime = t;
        } else if (p.numKeys > 0) {
            throw new Error('"' + p.name + '" on "' + L.name + '" is animated (' + p.numKeys +
                ' keyframes). Pass "time" to set a keyframe, or use ae_edit_keyframes.');
        } else {
            p.setValue(v);
        }
        return { layer: L.name, property: p.name, before: before,
                 after: t !== undefined ? _plainValue(p.valueAtTime(t, true)) : _safeValue(p),
                 numKeys: p.numKeys };
    });
    _reveal(comp, __aeTouched, lastTime);
    if (res.results) { return res; }
    res.comp = comp.name;
    return res;
}

function aeAddKeyframes(a) {
    var comp = _findComp(a.comp), firstTime;
    var res = _eachLayer(comp, a, function (L) {
        var p = _settable(_findProp(L, a.path)), keys = a.keys, i, k, idx, t;
        if (!(keys instanceof Array) || !keys.length) {
            throw new Error('"keys" must be a non-empty array of {time, value}.');
        }
        if (a.replace === true) {
            while (p.numKeys > 0) { p.removeKey(1); }
        }
        for (i = 0; i < keys.length; i++) {
            t = _time(comp, keys[i].time);
            if (firstTime === undefined) { firstTime = t; }
            p.setValueAtTime(t, _coerceForProp(p, keys[i].value));
        }
        /* Second pass: interpolation and easing need every key to exist first. */
        for (i = 0; i < keys.length; i++) {
            k = keys[i];
            if (!k.ease && !k.interp && k.spatial === undefined && k.roving === undefined) { continue; }
            idx = p.nearestKeyIndex(_time(comp, k.time));
            if (k.interp) {
                p.setInterpolationTypeAtKey(idx, _interp(k.interp), _interp(k.interp));
            }
            if (k.ease && k.interp !== 'hold' && k.interp !== 'linear') { _applyEase(p, idx, k.ease); }
            if (k.spatial) { _setSpatial(p, idx, k.spatial); }
            if (k.roving !== undefined) { try { p.setRovingAtKey(idx, !!k.roving); } catch (eR) {} }
        }
        return { layer: L.name, property: p.name, numKeys: p.numKeys, keys: _keys(p) };
    });
    _reveal(comp, __aeTouched, firstTime);
    if (!res.results) { res.comp = comp.name; }
    return res;
}

function _setSpatial(p, idx, mode) {
    if (!p.isSpatial) { throw new Error('"' + p.name + '" is not a spatial property.'); }
    if (mode === 'linear') {
        p.setSpatialContinuousAtKey(idx, false);
        p.setSpatialAutoBezierAtKey(idx, false);
        p.setSpatialTangentsAtKey(idx, [0, 0, 0].slice(0, p.value.length), [0, 0, 0].slice(0, p.value.length));
    } else if (mode === 'auto' || mode === 'auto_bezier') {
        p.setSpatialAutoBezierAtKey(idx, true);
    } else if (mode === 'continuous' || mode === 'bezier') {
        p.setSpatialAutoBezierAtKey(idx, false);
        p.setSpatialContinuousAtKey(idx, true);
    } else {
        throw new Error('spatial must be linear, auto or continuous.');
    }
}

function aeSetExpression(a) {
    var comp = _findComp(a.comp);
    var res = _eachLayer(comp, a, function (L) {
        var p = _findProp(L, a.path), before;
        if (!p.canSetExpression) {
            throw new Error('"' + p.name + '" does not accept expressions.');
        }
        before = p.expression;
        p.expression = String(a.expression);
        if (a.enabled === false) { p.expressionEnabled = false; }
        if (p.expressionError && p.expressionError.length) {
            var err = p.expressionError;
            p.expression = before;
            throw new Error('Expression rejected by After Effects on "' + L.name + '": ' + err);
        }
        return { layer: L.name, property: p.name, before: before || null,
                 expression: p.expression, value: _safeValue(p) };
    });
    _reveal(comp, __aeTouched);
    if (!res.results) { res.comp = comp.name; }
    return res;
}

function aeClearExpression(a) {
    var comp = _findComp(a.comp);
    var res = _eachLayer(comp, a, function (L) {
        var p = _findProp(L, a.path), before = p.expression;
        p.expression = '';
        return { layer: L.name, property: p.name, before: before || null, cleared: true };
    });
    if (!res.results) { res.comp = comp.name; }
    return res;
}

/* Effects that open a modal file dialog the moment they are applied. A
   modal freezes After Effects (and the bridge) until a person clicks it. */
var __DIALOG_EFFECTS = { 'ADBE Apply Color LUT2': 'Apply Color LUT', 'Apply Color LUT': 'Apply Color LUT' };

function aeApplyEffect(a) {
    var comp = _findComp(a.comp);
    if (__DIALOG_EFFECTS[a.effect] && a.allowDialog !== true) {
        throw new Error('"' + __DIALOG_EFFECTS[a.effect] + '" opens a file dialog as soon as it is applied, which ' +
            'freezes After Effects until someone clicks it. Use Lumetri Color (ADBE Lumetri) with its Look / ' +
            'Input LUT, or an animation preset that already contains the LUT (ae_apply_preset). Pass ' +
            'allowDialog: true only if a person is at the machine to pick the file.');
    }
    var res = _eachLayer(comp, a, function (L) {
        var fx, e, k, sub;
        fx = L.property('ADBE Effect Parade');
        if (!fx) { throw new Error('Layer "' + L.name + '" cannot take effects.'); }
        try {
            e = fx.addProperty(a.effect);
        } catch (err) {
            throw new Error('Could not apply effect "' + a.effect + '": ' + err.toString() +
                ' — look it up with ae_catalog {kind:"effects", query:"…"} and pass its matchName.');
        }
        if (a.name) { e.name = a.name; }
        if (a.params) {
            for (k in a.params) {
                if (!a.params.hasOwnProperty(k)) { continue; }
                sub = e.property(k);
                if (!sub) {
                    throw new Error('Effect "' + e.name + '" has no parameter "' + k +
                        '". Available: ' + _childNames(e).join(', '));
                }
                sub.setValue(_coerceForProp(sub, a.params[k]));
            }
        }
        return { layer: L.name, effect: e.name, matchName: e.matchName, index: e.propertyIndex,
                 params: _walk(e, 0, 1, true) };
    });
    _reveal(comp, __aeTouched);
    if (!res.results) { res.comp = comp.name; }
    return res;
}

function aeCreateLayer(a) {
    var comp = _findComp(a.comp),
        kind = String(a.kind || '').toLowerCase(),
        o = a.options || {},
        L, color, dur = o.duration !== undefined ? _time(comp, o.duration, 'duration') : undefined;

    if (kind === 'solid') {
        color = o.color ? _color(o.color, false) : [0, 0, 0];
        L = comp.layers.addSolid(color, o.name || 'Solid',
            o.width || comp.width, o.height || comp.height, comp.pixelAspect,
            dur || comp.duration);
    } else if (kind === 'text' || kind === 'box_text') {
        if (kind === 'box_text' || o.boxSize) {
            L = comp.layers.addBoxText(o.boxSize || [comp.width * 0.8, comp.height * 0.3],
                o.text !== undefined ? String(o.text) : 'Text');
        } else {
            L = comp.layers.addText(o.text !== undefined ? String(o.text) : 'Text');
        }
        if (o.style) {
            var sp = L.property('ADBE Text Properties').property('ADBE Text Document');
            sp.setValue(_applyTextStyle(sp.value, o.style));
        }
    } else if (kind === 'null') {
        L = comp.layers.addNull(dur || comp.duration);
    } else if (kind === 'shape') {
        L = comp.layers.addShape();
    } else if (kind === 'adjustment') {
        L = comp.layers.addSolid([1, 1, 1], o.name || 'Adjustment Layer',
            comp.width, comp.height, comp.pixelAspect, dur || comp.duration);
        L.adjustmentLayer = true;
    } else if (kind === 'camera') {
        L = comp.layers.addCamera(o.name || 'Camera',
            o.centerPoint || [comp.width / 2, comp.height / 2]);
    } else if (kind === 'light') {
        L = comp.layers.addLight(o.name || 'Light',
            o.centerPoint || [comp.width / 2, comp.height / 2]);
        if (o.lightType) {
            var lt = { parallel: LightType.PARALLEL, spot: LightType.SPOT,
                       point: LightType.POINT, ambient: LightType.AMBIENT }[o.lightType];
            if (lt === undefined) { throw new Error('lightType must be parallel, spot, point or ambient.'); }
            L.lightType = lt;
        }
    } else if (kind === 'precomp' || kind === 'footage' || kind === 'source') {
        /* Any AVItem works here — a comp, imported video, image or audio. */
        var src = _findItem(o.source);
        if (!(src instanceof CompItem) && !(src instanceof FootageItem)) {
            throw new Error('"' + o.source + '" is a ' + src.typeName +
                ', which cannot be added to a composition.');
        }
        L = dur ? comp.layers.add(src, dur) : comp.layers.add(src);
    } else {
        throw new Error('Unknown layer kind "' + a.kind +
            '". Use: solid, text, box_text, shape, null, adjustment, camera, light, precomp, footage.');
    }

    if (o.name && kind !== 'solid' && kind !== 'adjustment') { L.name = o.name; }
    if (o.scale) { L.property('ADBE Transform Group').property('ADBE Scale').setValue(o.scale); }
    if (typeof o.opacity === 'number') {
        L.property('ADBE Transform Group').property('ADBE Opacity').setValue(o.opacity);
    }
    if (o.parent !== undefined && o.parent !== null) { L.parent = _findLayer(comp, o.parent); }
    if (o.startTime !== undefined) { L.startTime = _time(comp, o.startTime); }
    if (o.inPoint !== undefined) { L.inPoint = _time(comp, o.inPoint); }
    if (o.outPoint !== undefined) { L.outPoint = _time(comp, o.outPoint); }
    if (typeof o.index === 'number' && o.index >= 1 && o.index <= comp.numLayers) {
        L.moveTo(o.index);
    }
    if (o.threeD === true) { L.threeDLayer = true; }
    if (o.position) { L.property('ADBE Transform Group').property('ADBE Position').setValue(o.position); }
    if (o.label !== undefined) { L.label = o.label; }

    _reveal(comp, L);
    return { comp: comp.name, layer: L.name, index: L.index, kind: _layerKind(L) };
}

function aeDeleteLayer(a) {
    var comp = _findComp(a.comp), targets, names = [], i;
    targets = a.layers !== undefined ? _findLayers(comp, a.layers) : [_findLayer(comp, a.layer)];
    for (i = 0; i < targets.length; i++) { names.push(targets[i].name); }
    for (i = targets.length - 1; i >= 0; i--) { targets[i].remove(); }
    return { comp: comp.name, deleted: names, remainingLayers: comp.numLayers };
}

var __ENUMS = null;
/* Layer attributes whose values are AE enums, keyed by friendly names. */
function _layerEnums() {
    var bm = {}, k, tm;
    if (__ENUMS) { return __ENUMS; }
    for (k in BlendingMode) {
        try { bm[k.toLowerCase().replace(/_/g, ' ')] = BlendingMode[k]; } catch (e) {}
    }
    __ENUMS = {
        blendingMode: bm,
        quality: { best: LayerQuality.BEST, draft: LayerQuality.DRAFT, wireframe: LayerQuality.WIREFRAME },
        autoOrient: { off: AutoOrientType.NO_AUTO_ORIENT, path: AutoOrientType.ALONG_PATH,
                      camera: AutoOrientType.CAMERA_OR_POINT_OF_INTEREST },
        frameBlendingType: { off: FrameBlendingType.NO_FRAME_BLEND,
                             frame_mix: FrameBlendingType.FRAME_MIX,
                             pixel_motion: FrameBlendingType.PIXEL_MOTION }
    };
    try {
        __ENUMS.samplingQuality = { bilinear: LayerSamplingQuality.BILINEAR, bicubic: LayerSamplingQuality.BICUBIC };
    } catch (eS) {}
    try {
        tm = { alpha: TrackMatteType.ALPHA, alpha_inverted: TrackMatteType.ALPHA_INVERTED,
               luma: TrackMatteType.LUMA, luma_inverted: TrackMatteType.LUMA_INVERTED,
               none: TrackMatteType.NO_TRACK_MATTE };
        __ENUMS.trackMatteType = tm;
    } catch (eT) {}
    return __ENUMS;
}

function _enumName(map, v) {
    var k;
    for (k in map) { if (map.hasOwnProperty(k) && map[k] === v) { return k; } }
    return String(v);
}

function _layerAttr(L, k) {
    var E = _layerEnums();
    try {
        if (k === 'parent') { return L.parent ? L.parent.name : null; }
        if (k === 'trackMatte') {
            return { layer: L.trackMatteLayer ? L.trackMatteLayer.name : null,
                     type: _enumName(E.trackMatteType || {}, L.trackMatteType) };
        }
        if (E[k]) { return _enumName(E[k], L[k]); }
        if (typeof L[k] === 'number') { return _round(L[k]); }
        return L[k];
    } catch (e) { return null; }
}

function aeSetLayerProps(a) {
    var comp = _findComp(a.comp), E = _layerEnums();
    var res = _eachLayer(comp, a, function (L) {
        var o = a.props || {}, before = {}, after = {}, k, v, tm;
        for (k in o) {
            if (!o.hasOwnProperty(k)) { continue; }
            before[k] = _layerAttr(L, k);
            v = o[k];
            if (k === 'parent') {
                L.parent = (v === null) ? null : _findLayer(comp, v);
            } else if (k === 'index') {
                L.moveTo(v);
            } else if (k === 'trackMatte') {
                /* AE 2023+: any layer can be the matte, not just the one above. */
                if (v === null || v.type === 'none') { L.setTrackMatte(null, TrackMatteType.NO_TRACK_MATTE); }
                else {
                    tm = E.trackMatteType[v.type || 'alpha'];
                    if (tm === undefined) { throw new Error('trackMatte.type must be alpha, alpha_inverted, luma, luma_inverted or none.'); }
                    L.setTrackMatte(_findLayer(comp, v.layer), tm);
                }
            } else if (k === 'inPoint' || k === 'outPoint' || k === 'startTime') {
                L[k] = _time(comp, v);
            } else if (E[k] && typeof v === 'string') {
                if (E[k][v] === undefined) {
                    var opts = [], n;
                    for (n in E[k]) { if (E[k].hasOwnProperty(n)) { opts.push(n); } }
                    throw new Error(k + ' "' + v + '" is not valid. Use: ' + opts.join(', '));
                }
                L[k] = E[k][v];
            } else {
                try { L[k] = v; }
                catch (eSet) { throw new Error('Could not set ' + k + ' on "' + L.name + '": ' + eSet.toString()); }
            }
            after[k] = _layerAttr(L, k);
        }
        return { layer: L.name, index: L.index, before: before, after: after };
    });
    _reveal(comp, __aeTouched);
    if (!res.results) { res.comp = comp.name; }
    return res;
}

function aeRunJsx(a) {
    var r, f;
    if (a.file) {
        f = new File(a.file);
        if (!f.exists) { throw new Error('Script not found: ' + a.file); }
        r = $.evalFile(f);
    } else {
        r = eval(a.code);
    }
    if (r === undefined) { return { ran: true, result: null }; }
    try { return { ran: true, result: _plainValue(r) }; }
    catch (e) { return { ran: true, result: String(r) }; }
}


/* ------------------------------------------------------------------ */
/* Project items                                                       */
/* ------------------------------------------------------------------ */

function _itemInfo(it) {
    var o = {
        id: it.id,
        name: it.name,
        type: it.typeName,
        folder: (it.parentFolder && it.parentFolder.name !== 'Root') ? it.parentFolder.name : null
    };
    if (it instanceof CompItem) {
        o.kind = 'comp';
        o.width = it.width; o.height = it.height;
        o.duration = _round(it.duration); o.frameRate = _round(it.frameRate);
        o.numLayers = it.numLayers;
    } else if (it instanceof FootageItem) {
        o.kind = 'footage';
        o.width = it.width; o.height = it.height;
        o.duration = _round(it.duration);
        try { o.file = it.file ? it.file.fsName : null; } catch (e) { o.file = null; }
        try { o.hasAudio = it.hasAudio; o.hasVideo = it.hasVideo; } catch (e2) {}
        if (it.mainSource instanceof SolidSource) { o.kind = 'solid'; }
        else if (it.mainSource instanceof PlaceholderSource) { o.kind = 'placeholder'; }
    } else if (it instanceof FolderItem) {
        o.kind = 'folder';
        o.numItems = it.numItems;
    }
    return o;
}

function _findItem(ref) {
    var i, it;
    if (ref === undefined || ref === null) { throw new Error('No project item given.'); }
    for (i = 1; i <= app.project.numItems; i++) {
        it = app.project.item(i);
        if (typeof ref === 'number' ? (it.id === ref) : (it.name === String(ref))) { return it; }
    }
    throw new Error('Project item not found: "' + ref + '"');
}

function aeListItems(a) {
    var out = [], i, it;
    for (i = 1; i <= app.project.numItems; i++) {
        it = app.project.item(i);
        if (a.kind && _itemInfo(it).kind !== a.kind) { continue; }
        out.push(_itemInfo(it));
    }
    return { projectName: app.project.file ? app.project.file.name : '(unsaved)', items: out };
}

function aeDeleteItem(a) {
    var it = _findItem(a.item), name = it.name;
    it.remove();
    return { deleted: name, remainingItems: app.project.numItems };
}

/* ------------------------------------------------------------------ */
/* Project lifecycle                                                   */
/* ------------------------------------------------------------------ */

/* Never let After Effects raise its own "save changes?" dialog — a modal
   freezes the bridge and there is no way to dismiss it from here. The caller
   has to state up front what should happen to unsaved work. */
function _closeCurrentProject(a) {
    if (!app.project) { return; }
    if (a.saveFirst) {
        if (typeof a.saveFirst === 'string') {
            app.project.save(new File(a.saveFirst));
        } else if (app.project.file) {
            app.project.save();
        } else {
            throw new Error('saveFirst was true but the project has never been saved. ' +
                            'Pass saveFirst as a file path instead.');
        }
    } else if (a.discardUnsavedChanges !== true) {
        throw new Error(
            'Refusing to close the open project: unsaved work would be lost silently. ' +
            'Pass either saveFirst (true, or a path to save as) or ' +
            'discardUnsavedChanges: true to say explicitly what should happen.');
    }
    app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
}

function aeNewProject(a) {
    var previous = app.project.file ? app.project.file.fsName : '(unsaved)';
    _closeCurrentProject(a);
    app.newProject();
    if (a.savePath) { app.project.save(new File(a.savePath)); }
    return {
        closed: previous,
        projectPath: app.project.file ? app.project.file.fsName : null,
        saved: !!a.savePath
    };
}

function aeOpenProject(a) {
    var f = new File(a.path), previous;
    if (!f.exists) { throw new Error('Project file not found: ' + a.path); }
    previous = app.project.file ? app.project.file.fsName : '(unsaved)';
    _closeCurrentProject(a);
    app.open(f);
    return { closed: previous, projectPath: app.project.file ? app.project.file.fsName : null };
}

function aeSaveProject(a) {
    if (a.path) { app.project.save(new File(a.path)); }
    else if (app.project.file) { app.project.save(); }
    else { throw new Error('Project has never been saved — pass "path".'); }
    return { projectPath: app.project.file.fsName };
}

/* ------------------------------------------------------------------ */
/* Compositions                                                        */
/* ------------------------------------------------------------------ */

function aeCreateComp(a) {
    var c = app.project.items.addComp(
        a.name || 'Comp',
        Math.round(a.width || 1920),
        Math.round(a.height || 1080),
        a.pixelAspect || 1,
        a.duration !== undefined ? _time({ frameRate: a.frameRate || 30 }, a.duration, 'duration') : 10,
        a.frameRate || 30);
    if (a.bgColor) { c.bgColor = _color(a.bgColor, false); }
    if (a.folder) {
        try { c.parentFolder = _findItem(a.folder); } catch (e) {}
    }
    if (a.open === true) { c.openInViewer(); }
    return _itemInfo(c);
}

function aeSetCompSettings(a) {
    var c = _findComp(a.comp), o = a.settings || {}, before = {}, after = {}, k;
    function read(key) {
        try { var v = c[key]; return (v instanceof Array || typeof v === 'number') ? _plainValue(v) : v; }
        catch (e) { return null; }
    }
    for (k in o) {
        if (!o.hasOwnProperty(k)) { continue; }
        before[k] = read(k);
        if (k === 'bgColor') { c.bgColor = _color(o[k], false); }
        else if (k === 'duration' || k === 'workAreaStart' || k === 'workAreaDuration' ||
                 k === 'displayStartTime' || k === 'time') { c[k] = _time(c, o[k]); }
        else {
            try { c[k] = o[k]; }
            catch (eSet) { throw new Error('Could not set comp ' + k + ': ' + eSet.toString()); }
        }
        after[k] = read(k);
    }
    return { comp: c.name, before: before, after: after };
}

function aeDuplicateComp(a) {
    var c = _findComp(a.comp), d = c.duplicate();
    if (a.name) { d.name = a.name; }
    if (a.width || a.height) {
        /* A format variant: resize the frame and keep content centred. */
        var dx = ((a.width || d.width) - d.width) / 2, dy = ((a.height || d.height) - d.height) / 2, i, pos;
        d.width = Math.round(a.width || d.width);
        d.height = Math.round(a.height || d.height);
        if (a.recenter !== false) {
            for (i = 1; i <= d.numLayers; i++) {
                if (d.layer(i).parent) { continue; }
                pos = d.layer(i).property('ADBE Transform Group').property('ADBE Position');
                try { _offsetProp(pos, [dx, dy]); } catch (eP) {}
            }
        }
    }
    if (a.open) { d.openInViewer(); }
    return _itemInfo(d);
}

function aePrecompose(a) {
    var c = _findComp(a.comp), idx = [], i, L, pre;
    if (a.layers instanceof Array) {
        for (i = 0; i < a.layers.length; i++) {
            L = _findLayer(c, a.layers[i]);
            idx.push(L.index);
        }
    } else {
        for (i = 0; i < c.selectedLayers.length; i++) { idx.push(c.selectedLayers[i].index); }
    }
    if (!idx.length) { throw new Error('No layers given to precompose.'); }
    pre = c.layers.precompose(idx, a.name || 'Precomp',
        a.moveAllAttributes === undefined ? true : a.moveAllAttributes);
    return { comp: c.name, precomp: _itemInfo(pre) };
}

/* ------------------------------------------------------------------ */
/* Import                                                              */
/* ------------------------------------------------------------------ */

function aeImportFile(a) {
    var f = new File(a.path), io, item, t, map;
    if (!f.exists) { throw new Error('File not found: ' + a.path); }
    io = new ImportOptions(f);
    if (a.sequence === true) {
        if (!io.canImportAs(ImportAsType.FOOTAGE)) {
            throw new Error('Cannot import that file as a sequence.');
        }
        io.sequence = true;
    }
    if (a.importAs) {
        map = {
            'footage': ImportAsType.FOOTAGE,
            'comp': ImportAsType.COMP,
            'comp_cropped': ImportAsType.COMP_CROPPED_LAYERS,
            'project': ImportAsType.PROJECT
        };
        t = map[String(a.importAs).toLowerCase()];
        if (t === undefined) { throw new Error('importAs must be footage, comp, comp_cropped or project.'); }
        if (!io.canImportAs(t)) {
            throw new Error('This file cannot be imported as "' + a.importAs + '".');
        }
        io.importAs = t;
    }
    item = app.project.importFile(io);
    if (a.name) { item.name = a.name; }
    if (a.folder) {
        try { item.parentFolder = _findItem(a.folder); } catch (e) {}
    }
    return _itemInfo(item);
}

/* ------------------------------------------------------------------ */
/* Property helpers                                                    */
/* ------------------------------------------------------------------ */

/* Names from the layer down to p — the same path _findProp takes. */
function _propPath(p) {
    var out = [], i;
    try {
        for (i = p.propertyDepth - 1; i >= 1; i--) { out.push(p.propertyGroup(i).name); }
        out.push(p.name);
    } catch (e) {}
    return out;
}

function _addVec(v, d) {
    var out = [], i;
    for (i = 0; i < v.length; i++) { out.push(v[i] + (i < d.length ? d[i] : 0)); }
    return out;
}

/* Move a property by delta whether it is static or keyframed. */
function _offsetProp(p, delta) {
    var k;
    if (p.numKeys > 0) {
        for (k = 1; k <= p.numKeys; k++) { p.setValueAtKey(k, _addVec(p.keyValue(k), delta)); }
    } else {
        p.setValue(_addVec(p.value, delta));
    }
}

function _layerOrGroup(L, path) {
    if (!path || !(path instanceof Array) || !path.length) { return L; }
    return _findProp(L, path);
}

/* ------------------------------------------------------------------ */
/* Keyframe editing                                                    */
/* ------------------------------------------------------------------ */

function _pickKeys(p, comp, sel) {
    var out = [], k, from, to, i;
    if (sel === undefined || sel === null || sel === 'all') {
        for (k = 1; k <= p.numKeys; k++) { out.push(k); }
    } else if (sel === 'selected') {
        for (i = 0; i < p.selectedKeys.length; i++) { out.push(p.selectedKeys[i]); }
    } else if (sel instanceof Array) {
        for (i = 0; i < sel.length; i++) {
            if (typeof sel[i] === 'number' && sel[i] % 1 === 0 && sel[i] >= 1 && sel[i] <= p.numKeys) {
                out.push(sel[i]);
            } else {
                out.push(p.nearestKeyIndex(_time(comp, sel[i])));
            }
        }
    } else if (typeof sel === 'object') {
        from = sel.from !== undefined ? _time(comp, sel.from) : -1e9;
        to = sel.to !== undefined ? _time(comp, sel.to) : 1e9;
        for (k = 1; k <= p.numKeys; k++) {
            if (p.keyTime(k) >= from - 1e-6 && p.keyTime(k) <= to + 1e-6) { out.push(k); }
        }
    }
    out.sort(function (x, y) { return x - y; });
    return out;
}

function _captureKey(p, k) {
    var c = {
        time: p.keyTime(k), value: p.keyValue(k),
        inType: p.keyInInterpolationType(k), outType: p.keyOutInterpolationType(k)
    };
    try { c.inEase = p.keyInTemporalEase(k); c.outEase = p.keyOutTemporalEase(k); } catch (e1) {}
    try { c.tCont = p.keyTemporalContinuous(k); c.tAuto = p.keyTemporalAutoBezier(k); } catch (e2) {}
    if (p.isSpatial) {
        try {
            c.inTan = p.keyInSpatialTangent(k); c.outTan = p.keyOutSpatialTangent(k);
            c.sCont = p.keySpatialContinuous(k); c.sAuto = p.keySpatialAutoBezier(k);
            c.roving = p.keyRoving(k);
        } catch (e3) {}
    }
    try { c.label = p.keyLabel(k); } catch (e4) {}
    return c;
}

function _restoreKey(p, t, c) {
    var k = p.addKey(t);
    p.setValueAtKey(k, c.value);
    if (c.inEase) { try { p.setTemporalEaseAtKey(k, c.inEase, c.outEase); } catch (e1) {} }
    try { p.setInterpolationTypeAtKey(k, c.inType, c.outType); } catch (e2) {}
    if (c.tCont !== undefined) {
        try { p.setTemporalContinuousAtKey(k, c.tCont); p.setTemporalAutoBezierAtKey(k, c.tAuto); } catch (e3) {}
    }
    if (c.inTan) {
        try {
            p.setSpatialTangentsAtKey(k, c.inTan, c.outTan);
            p.setSpatialContinuousAtKey(k, c.sCont);
            p.setSpatialAutoBezierAtKey(k, c.sAuto);
        } catch (e4) {}
    }
    if (c.label !== undefined) { try { p.setLabelAtKey(k, c.label); } catch (e5) {} }
    return k;
}

function aeEditKeyframes(a) {
    var comp = _findComp(a.comp), firstTime;
    var res = _eachLayer(comp, a, function (L) {
        var p = _settable(_findProp(L, a.path)), idx = _pickKeys(p, comp, a.keys),
            caps = [], times = [], i, t, anchor, target, tp, removed;
        if (!p.numKeys) { throw new Error('"' + p.name + '" on "' + L.name + '" has no keyframes.'); }
        if (!idx.length) { throw new Error('No keyframes matched "keys" on "' + p.name + '".'); }

        if (a['delete'] === true) {
            removed = [];
            for (i = idx.length - 1; i >= 0; i--) { removed.unshift(_round(p.keyTime(idx[i]))); p.removeKey(idx[i]); }
            return { layer: L.name, property: p.name, deleted: removed, numKeys: p.numKeys };
        }

        for (i = 0; i < idx.length; i++) { caps.push(_captureKey(p, idx[i])); times.push(caps[i].time); }

        /* Retiming: there is no "move key" in the DOM, so capture every
           attribute, remove, and re-add at the new time. */
        if (a.shift !== undefined || a.moveTo !== undefined || a.scaleTime !== undefined) {
            anchor = a.anchor !== undefined ? _time(comp, a.anchor) : caps[0].time;
            for (i = 0; i < caps.length; i++) {
                if (a.moveTo !== undefined) { t = _time(comp, a.moveTo) + (caps[i].time - caps[0].time); }
                else if (a.scaleTime !== undefined) { t = anchor + (caps[i].time - anchor) * Number(a.scaleTime); }
                else { t = caps[i].time + _time(comp, a.shift); }
                times[i] = t;
            }
            for (i = idx.length - 1; i >= 0; i--) { p.removeKey(idx[i]); }
            for (i = 0; i < caps.length; i++) { _restoreKey(p, times[i], caps[i]); }
        }

        /* Everything below addresses the (possibly moved) keys by time. */
        for (i = 0; i < times.length; i++) {
            var k = p.nearestKeyIndex(times[i]);
            if (a.value !== undefined) { p.setValueAtKey(k, _coerceForProp(p, a.value)); }
            if (a.offset !== undefined) {
                var kv = p.keyValue(k);
                p.setValueAtKey(k, kv instanceof Array
                    ? _addVec(kv, a.offset instanceof Array ? a.offset : [a.offset])
                    : kv + (a.offset instanceof Array ? a.offset[0] : a.offset));
            }
            if (a.interp) { p.setInterpolationTypeAtKey(k, _interp(a.interp), _interp(a.interp)); }
            if (a.ease !== undefined) { _applyEase(p, k, a.ease); }
            if (a.spatial) { _setSpatial(p, k, a.spatial); }
            if (a.roving !== undefined) { p.setRovingAtKey(k, !!a.roving); }
            if (a.label !== undefined) { try { p.setLabelAtKey(k, a.label); } catch (eL) {} }
            if (a.select !== undefined) { p.setSelectedAtKey(k, !!a.select); }
        }

        if (a.copyTo) {
            target = a.copyTo.layer !== undefined ? _findLayer(comp, a.copyTo.layer) : L;
            tp = _settable(_findProp(target, a.copyTo.path || a.path));
            for (i = 0; i < caps.length; i++) {
                _restoreKey(tp, times[i] + (a.copyTo.offset !== undefined ? _time(comp, a.copyTo.offset) : 0), caps[i]);
            }
        }

        if (firstTime === undefined) { firstTime = times[0]; }
        return { layer: L.name, property: p.name, edited: times.length, keys: _keys(p),
                 copiedTo: a.copyTo ? { layer: target.name, property: tp.name, numKeys: tp.numKeys } : undefined };
    });
    _reveal(comp, __aeTouched, firstTime);
    if (!res.results) { res.comp = comp.name; }
    return res;
}

/* ------------------------------------------------------------------ */
/* Undo / batch                                                        */
/* ------------------------------------------------------------------ */

var __CMD_UNDO = 16, __CMD_REDO = 2035;

function aeUndo(a) {
    var n = Math.max(1, Math.min(50, parseInt(a.steps || 1, 10))), i;
    for (i = 0; i < n; i++) { app.executeCommand(a.redo === true ? __CMD_REDO : __CMD_UNDO); }
    return { action: a.redo === true ? 'redo' : 'undo', steps: n,
             note: 'Steps through Edit ▸ Undo history, including any edits the user made by hand.' };
}

/* Several tool calls as one undo step. With atomic (default), a failure
   undoes the steps that already ran, so the project is never half-edited. */
function aeBatch(a) {
    var steps = a.steps, results = [], i, s, fn, done = 0, failed = null;
    var banned = ',batch,undo,new_project,open_project,render_frame,catalog,write_fns,project_fns,';
    if (!(steps instanceof Array) || !steps.length) { throw new Error('"steps" must be a non-empty array of {tool, args}.'); }
    for (i = 0; i < steps.length; i++) {
        fn = String(steps[i].tool || '').replace(/^ae_/, '');
        if (banned.indexOf(',' + fn + ',') !== -1) { throw new Error('ae_' + fn + ' cannot run inside ae_batch.'); }
    }
    app.beginUndoGroup(a.name ? 'MCP: ' + a.name : 'MCP: Batch (' + steps.length + ' steps)');
    try {
        for (i = 0; i < steps.length; i++) {
            s = steps[i];
            fn = String(s.tool).replace(/^ae_/, '');
            try {
                results.push({ step: i, tool: 'ae_' + fn, result: __aeDispatch(fn, s.args || {}) });
                done++;
            } catch (e) {
                failed = { step: i, tool: 'ae_' + fn, error: e.toString() };
                break;
            }
        }
    } finally {
        app.endUndoGroup();
    }
    if (failed && a.atomic !== false && done > 0) {
        app.executeCommand(__CMD_UNDO);
        return { ok: false, rolledBack: true, completed: done, failed: failed,
                 note: 'Nothing was changed: the ' + done + ' step(s) before the failure were undone.' };
    }
    if (failed) { return { ok: false, rolledBack: false, completed: done, failed: failed, results: results }; }
    return { ok: true, completed: done, results: results };
}

/* ------------------------------------------------------------------ */
/* Markers                                                             */
/* ------------------------------------------------------------------ */

function _markerProp(comp, a) {
    if (a.layer === undefined || a.layer === null) {
        try { if (comp.markerProperty) { return comp.markerProperty; } } catch (e) {}
        throw new Error('Composition markers need After Effects 2023 or later. Pass "layer" for layer markers.');
    }
    return _findLayer(comp, a.layer).property('ADBE Marker');
}

function _markerInfo(p, k, comp) {
    var m = p.keyValue(k), o = { index: k, time: _round(p.keyTime(k)), frame: _frame(comp, p.keyTime(k)),
        comment: m.comment };
    if (m.duration) { o.duration = _round(m.duration); }
    if (m.chapter) { o.chapter = m.chapter; }
    if (m.url) { o.url = m.url; o.frameTarget = m.frameTarget; }
    if (m.cuePointName) { o.cuePointName = m.cuePointName; o.eventCuePoint = m.eventCuePoint; }
    try { if (m.label) { o.label = m.label; } } catch (e1) {}
    try { if (m.protectedRegion) { o.protectedRegion = true; } } catch (e2) {}
    try {
        var params = m.getParameters(), any = false, key;
        for (key in params) { if (params.hasOwnProperty(key)) { any = true; } }
        if (any) { o.params = params; }
    } catch (e3) {}
    return o;
}

function _applyMarker(m, o, comp) {
    if (o.comment !== undefined) { m.comment = String(o.comment); }
    if (o.duration !== undefined) { m.duration = _time(comp, o.duration, 'duration'); }
    if (o.chapter !== undefined) { m.chapter = String(o.chapter); }
    if (o.url !== undefined) { m.url = String(o.url); }
    if (o.frameTarget !== undefined) { m.frameTarget = String(o.frameTarget); }
    if (o.cuePointName !== undefined) { m.cuePointName = String(o.cuePointName); }
    if (o.eventCuePoint !== undefined) { m.eventCuePoint = !!o.eventCuePoint; }
    if (o.label !== undefined) { m.label = o.label; }
    if (o.protectedRegion !== undefined) { m.protectedRegion = !!o.protectedRegion; }
    if (o.params !== undefined) { m.setParameters(o.params); }
    return m;
}

function aeMarkers(a) {
    var comp = _findComp(a.comp), p = _markerProp(comp, a), out = [], k, m, t, idx, i, list;
    var action = a.action || 'list';
    function locate(o) {
        if (o.index !== undefined) {
            if (o.index < 1 || o.index > p.numKeys) { throw new Error('No marker #' + o.index + ' (there are ' + p.numKeys + ').'); }
            return o.index;
        }
        if (o.time !== undefined) {
            if (!p.numKeys) { throw new Error('There are no markers.'); }
            k = p.nearestKeyIndex(_time(comp, o.time));
            if (Math.abs(p.keyTime(k) - _time(comp, o.time)) > 0.5 / comp.frameRate) {
                throw new Error('No marker at ' + o.time + '.');
            }
            return k;
        }
        if (o.comment !== undefined) {
            for (k = 1; k <= p.numKeys; k++) { if (p.keyValue(k).comment === o.comment) { return k; } }
            throw new Error('No marker with comment "' + o.comment + '".');
        }
        throw new Error('Identify the marker with "index", "time" or "comment".');
    }
    if (action === 'list') {
        for (k = 1; k <= p.numKeys; k++) { out.push(_markerInfo(p, k, comp)); }
        return { comp: comp.name, layer: a.layer !== undefined ? _findLayer(comp, a.layer).name : null, markers: out };
    }
    list = a.markers instanceof Array ? a.markers : [a.marker || {}];
    for (i = 0; i < list.length; i++) {
        var o = list[i];
        if (action === 'add') {
            t = _time(comp, o.time !== undefined ? o.time : comp.time);
            m = _applyMarker(new MarkerValue(o.comment !== undefined ? String(o.comment) : ''), o, comp);
            p.setValueAtTime(t, m);
            out.push(_markerInfo(p, p.nearestKeyIndex(t), comp));
        } else if (action === 'update') {
            idx = locate(o.where || o);
            m = _applyMarker(p.keyValue(idx), o.set || o, comp);
            if ((o.set || {}).time !== undefined) {
                t = _time(comp, o.set.time);
                p.removeKey(idx);
                p.setValueAtTime(t, m);
                idx = p.nearestKeyIndex(t);
            } else {
                p.setValueAtKey(idx, m);
            }
            out.push(_markerInfo(p, idx, comp));
        } else if (action === 'delete') {
            if (o.all === true) { while (p.numKeys) { p.removeKey(1); } out.push('all'); continue; }
            idx = locate(o);
            out.push(_markerInfo(p, idx, comp));
            p.removeKey(idx);
        } else {
            throw new Error('action must be list, add, update or delete.');
        }
    }
    _reveal(comp, a.layer !== undefined ? _findLayer(comp, a.layer) : null,
            (action === 'add' && out.length && out[0].time !== undefined) ? out[0].time : undefined);
    return { comp: comp.name, action: action, markers: out, count: p.numKeys };
}

/* ------------------------------------------------------------------ */
/* Masks                                                               */
/* ------------------------------------------------------------------ */

var __KAPPA = 0.5522847498;

/* {rect:[l,t,w,h]}, {ellipse:[l,t,w,h]}, {vertices,…} → Shape */
function _shapeSpec(o) {
    var r, l, t, w, h, cx, cy, kx, ky;
    if (o.rect) {
        r = o.rect; l = r[0]; t = r[1]; w = r[2]; h = r[3];
        return _toShape({ vertices: [[l, t], [l + w, t], [l + w, t + h], [l, t + h]], closed: true });
    }
    if (o.ellipse) {
        r = o.ellipse; l = r[0]; t = r[1]; w = r[2]; h = r[3];
        cx = l + w / 2; cy = t + h / 2; kx = w / 2 * __KAPPA; ky = h / 2 * __KAPPA;
        return _toShape({
            vertices: [[cx, t], [l + w, cy], [cx, t + h], [l, cy]],
            inTangents: [[-kx, 0], [0, -ky], [kx, 0], [0, ky]],
            outTangents: [[kx, 0], [0, ky], [-kx, 0], [0, -ky]],
            closed: true
        });
    }
    if (o.vertices) { return _toShape(o); }
    throw new Error('Give the shape as {rect:[left,top,width,height]}, {ellipse:[…]} or {vertices, inTangents, outTangents, closed}.');
}

var __MASKMODES = null;
function _maskModes() {
    if (!__MASKMODES) {
        __MASKMODES = { none: MaskMode.NONE, add: MaskMode.ADD, subtract: MaskMode.SUBTRACT,
            intersect: MaskMode.INTERSECT, lighten: MaskMode.LIGHTEN, darken: MaskMode.DARKEN,
            difference: MaskMode.DIFFERENCE };
    }
    return __MASKMODES;
}

function _maskInfo(m) {
    var o = { index: m.propertyIndex, name: m.name, mode: _enumName(_maskModes(), m.maskMode),
              inverted: m.inverted, locked: m.locked };
    try { o.color = _plainValue(m.color); } catch (e0) {}
    try {
        o.path = _fromShape(m.property('ADBE Mask Shape').value);
        o.feather = _plainValue(m.property('ADBE Mask Feather').value);
        o.opacity = _round(m.property('ADBE Mask Opacity').value);
        o.expansion = _round(m.property('ADBE Mask Offset').value);
        o.animated = m.property('ADBE Mask Shape').numKeys > 0;
    } catch (e) {}
    return o;
}

function _applyMask(m, o, comp) {
    if (o.name !== undefined) { m.name = String(o.name); }
    if (o.mode !== undefined) {
        if (_maskModes()[o.mode] === undefined) { throw new Error('mode must be none, add, subtract, intersect, lighten, darken or difference.'); }
        m.maskMode = _maskModes()[o.mode];
    }
    if (o.inverted !== undefined) { m.inverted = !!o.inverted; }
    if (o.locked !== undefined) { m.locked = !!o.locked; }
    if (o.color !== undefined) { m.color = _color(o.color, false); }
    if (o.rect || o.ellipse || o.vertices) {
        var sp = m.property('ADBE Mask Shape'), sh = _shapeSpec(o);
        if (o.time !== undefined) { sp.setValueAtTime(_time(comp, o.time), sh); } else { sp.setValue(sh); }
    }
    if (o.feather !== undefined) { m.property('ADBE Mask Feather').setValue(o.feather instanceof Array ? o.feather : [o.feather, o.feather]); }
    if (o.opacity !== undefined) { m.property('ADBE Mask Opacity').setValue(o.opacity); }
    if (o.expansion !== undefined) { m.property('ADBE Mask Offset').setValue(o.expansion); }
}

function aeMasks(a) {
    var comp = _findComp(a.comp), L = _findLayer(comp, a.layer), parade = L.property('ADBE Mask Parade'),
        action = a.action || 'list', out = [], i, m, list;
    if (!parade) { throw new Error('Layer "' + L.name + '" cannot have masks.'); }
    function locate(ref) {
        var j;
        if (typeof ref === 'number') { return parade.property(ref); }
        for (j = 1; j <= parade.numProperties; j++) { if (parade.property(j).name === ref) { return parade.property(j); } }
        throw new Error('No mask "' + ref + '" on "' + L.name + '".');
    }
    if (action === 'list') {
        for (i = 1; i <= parade.numProperties; i++) { out.push(_maskInfo(parade.property(i))); }
        return { comp: comp.name, layer: L.name, masks: out };
    }
    list = a.masks instanceof Array ? a.masks : [a.mask || {}];
    for (i = 0; i < list.length; i++) {
        if (action === 'add') {
            m = parade.addProperty('ADBE Mask Atom');
            if (!list[i].mode) { m.maskMode = MaskMode.ADD; }
            _applyMask(m, list[i], comp);
            out.push(_maskInfo(m));
        } else if (action === 'update') {
            m = locate(list[i].mask !== undefined ? list[i].mask : 1);
            _applyMask(m, list[i], comp);
            out.push(_maskInfo(m));
        } else if (action === 'delete') {
            m = locate(list[i].mask !== undefined ? list[i].mask : 1);
            out.push(m.name);
            m.remove();
        } else {
            throw new Error('action must be list, add, update or delete.');
        }
    }
    _reveal(comp, L);
    return { comp: comp.name, layer: L.name, action: action, masks: out };
}

/* ------------------------------------------------------------------ */
/* Shape layers                                                        */
/* ------------------------------------------------------------------ */

function _setP(group, match, value, label) {
    var p = group.property(match);
    if (!p) { throw new Error('Shape property "' + (label || match) + '" not found. Available: ' + _childNames(group).join(', ')); }
    p.setValue(_coerceForProp(p, value));
    return p;
}

function _addShapeItem(contents, spec) {
    var g, c, prim, fill, stroke, trim, rep, rc, tr, type = spec.shape || spec.type || 'rect';
    g = contents.addProperty('ADBE Vector Group');
    if (spec.name) { g.name = spec.name; }
    c = g.property('ADBE Vectors Group');

    if (type === 'rect') {
        prim = c.addProperty('ADBE Vector Shape - Rect');
        _setP(prim, 'ADBE Vector Rect Size', spec.size || [200, 200], 'size');
        if (spec.roundness !== undefined) { _setP(prim, 'ADBE Vector Rect Roundness', spec.roundness, 'roundness'); }
    } else if (type === 'ellipse') {
        prim = c.addProperty('ADBE Vector Shape - Ellipse');
        _setP(prim, 'ADBE Vector Ellipse Size', spec.size || [200, 200], 'size');
    } else if (type === 'star' || type === 'polygon') {
        prim = c.addProperty('ADBE Vector Shape - Star');
        _setP(prim, 'ADBE Vector Star Type', type === 'star' ? 1 : 2, 'type');
        _setP(prim, 'ADBE Vector Star Points', spec.points || 5, 'points');
        _setP(prim, 'ADBE Vector Star Outer Radius', spec.outerRadius || 100, 'outerRadius');
        if (type === 'star') { _setP(prim, 'ADBE Vector Star Inner Radius', spec.innerRadius || 50, 'innerRadius'); }
        if (spec.rotation !== undefined) { _setP(prim, 'ADBE Vector Star Rotation', spec.rotation, 'rotation'); }
    } else if (type === 'path') {
        prim = c.addProperty('ADBE Vector Shape - Group');
        prim.property('ADBE Vector Shape').setValue(_shapeSpec(spec.path || spec));
    } else {
        throw new Error('shape must be rect, ellipse, star, polygon or path.');
    }
    if (spec.position && type !== 'path') {
        /* A lookup, not a nested ?: — ExtendScript mis-parses nested
           conditionals inside an argument list and passes the wrong name. */
        var posName = { rect: 'ADBE Vector Rect Position', ellipse: 'ADBE Vector Ellipse Position',
                        star: 'ADBE Vector Star Position', polygon: 'ADBE Vector Star Position' }[type];
        _setP(prim, posName, spec.position, 'position');
    }
    if (spec.roundCorners !== undefined) {
        rc = c.addProperty('ADBE Vector Filter - RC');
        _setP(rc, 'ADBE Vector RoundCorner Radius', spec.roundCorners, 'roundCorners');
    }
    if (spec.trim) {
        trim = c.addProperty('ADBE Vector Filter - Trim');
        if (spec.trim.start !== undefined) { _setP(trim, 'ADBE Vector Trim Start', spec.trim.start, 'trim.start'); }
        if (spec.trim.end !== undefined) { _setP(trim, 'ADBE Vector Trim End', spec.trim.end, 'trim.end'); }
        if (spec.trim.offset !== undefined) { _setP(trim, 'ADBE Vector Trim Offset', spec.trim.offset, 'trim.offset'); }
    }
    /* Stroke sits above fill, as when you draw a shape by hand. */
    if (spec.stroke) {
        stroke = c.addProperty('ADBE Vector Graphic - Stroke');
        var st = typeof spec.stroke === 'object' && !(spec.stroke instanceof Array) ? spec.stroke : { color: spec.stroke };
        if (st.color !== undefined) { _setP(stroke, 'ADBE Vector Stroke Color', st.color, 'stroke.color'); }
        if (st.width !== undefined) { _setP(stroke, 'ADBE Vector Stroke Width', st.width, 'stroke.width'); }
        if (st.opacity !== undefined) { _setP(stroke, 'ADBE Vector Stroke Opacity', st.opacity, 'stroke.opacity'); }
        if (st.lineCap) { _setP(stroke, 'ADBE Vector Stroke Line Cap', { butt: 1, round: 2, projecting: 3 }[st.lineCap] || 1, 'stroke.lineCap'); }
        if (st.lineJoin) { _setP(stroke, 'ADBE Vector Stroke Line Join', { miter: 1, round: 2, bevel: 3 }[st.lineJoin] || 1, 'stroke.lineJoin'); }
    }
    if (spec.fill) {
        fill = c.addProperty('ADBE Vector Graphic - Fill');
        var fl = typeof spec.fill === 'object' && !(spec.fill instanceof Array) ? spec.fill : { color: spec.fill };
        if (fl.color !== undefined) { _setP(fill, 'ADBE Vector Fill Color', fl.color, 'fill.color'); }
        if (fl.opacity !== undefined) { _setP(fill, 'ADBE Vector Fill Opacity', fl.opacity, 'fill.opacity'); }
    }
    if (spec.repeater) {
        rep = c.addProperty('ADBE Vector Filter - Repeater');
        var rp = spec.repeater, rt = rep.property('ADBE Vector Repeater Transform');
        if (rp.copies !== undefined) { _setP(rep, 'ADBE Vector Repeater Copies', rp.copies, 'repeater.copies'); }
        if (rp.offset !== undefined) { _setP(rep, 'ADBE Vector Repeater Offset', rp.offset, 'repeater.offset'); }
        if (rp.position !== undefined) { _setP(rt, 'ADBE Vector Repeater Position', rp.position, 'repeater.position'); }
        if (rp.scale !== undefined) { _setP(rt, 'ADBE Vector Repeater Scale', rp.scale, 'repeater.scale'); }
        if (rp.rotation !== undefined) { _setP(rt, 'ADBE Vector Repeater Rotation', rp.rotation, 'repeater.rotation'); }
        if (rp.startOpacity !== undefined) { _setP(rt, 'ADBE Vector Repeater Opacity 1', rp.startOpacity, 'repeater.startOpacity'); }
        if (rp.endOpacity !== undefined) { _setP(rt, 'ADBE Vector Repeater Opacity 2', rp.endOpacity, 'repeater.endOpacity'); }
    }
    if (spec.transform) {
        tr = g.property('ADBE Vector Transform Group');
        var tf = spec.transform;
        if (tf.anchor !== undefined) { _setP(tr, 'ADBE Vector Anchor', tf.anchor, 'transform.anchor'); }
        if (tf.position !== undefined) { _setP(tr, 'ADBE Vector Position', tf.position, 'transform.position'); }
        if (tf.scale !== undefined) { _setP(tr, 'ADBE Vector Scale', tf.scale, 'transform.scale'); }
        if (tf.rotation !== undefined) { _setP(tr, 'ADBE Vector Rotation', tf.rotation, 'transform.rotation'); }
        if (tf.opacity !== undefined) { _setP(tr, 'ADBE Vector Group Opacity', tf.opacity, 'transform.opacity'); }
    }
    return g;
}

function aeShape(a) {
    var comp = _findComp(a.comp), L, contents, groups = [], list, i, g;
    if (a.layer !== undefined && a.layer !== null) {
        L = _findLayer(comp, a.layer);
        if (!(L instanceof ShapeLayer)) { throw new Error('"' + L.name + '" is not a shape layer.'); }
    } else {
        L = comp.layers.addShape();
        if (a.name) { L.name = a.name; }
    }
    contents = L.property('ADBE Root Vectors Group');
    if (a.into) { contents = _findProp(L, a.into); }
    list = a.shapes instanceof Array ? a.shapes : [a];
    for (i = 0; i < list.length; i++) {
        g = _addShapeItem(contents, list[i]);
        groups.push({ name: g.name, path: _propPath(g) });
    }
    _reveal(comp, L);
    return { comp: comp.name, layer: L.name, index: L.index, groups: groups,
             note: 'Positions are in layer space; a new shape layer sits at the comp centre, so [0,0] is the centre.' };
}

/* ------------------------------------------------------------------ */
/* Any property group: add, remove, rename, reorder, duplicate         */
/* ------------------------------------------------------------------ */

function aeAddProperty(a) {
    var comp = _findComp(a.comp), L = _findLayer(comp, a.layer), g = _layerOrGroup(L, a.path), p, list, i, out = [];
    list = a.add instanceof Array ? a.add : [a.add];
    for (i = 0; i < list.length; i++) {
        if (!g.canAddProperty(list[i])) {
            throw new Error('Cannot add "' + list[i] + '" under ' + (a.path && a.path.length ? '"' + a.path.join(' > ') + '"' : 'layer "' + L.name + '"') +
                '. Add to the right group: effects under ["Effects"], masks under ["Masks"], shape items under ["Contents"] or [..,"Contents"], ' +
                'text animators under ["Text","Animators"], selectors/properties under an animator.');
        }
        p = g.addProperty(list[i]);
        if (a.name && list.length === 1) { p.name = a.name; }
        if (typeof a.index === 'number') {
            p.moveTo(a.index);
            /* moveTo invalidates the object; fetch it again at its new slot. */
            g = _layerOrGroup(L, a.path);
            p = g.property(a.index);
        }
        out.push({ name: p.name, matchName: p.matchName, path: _propPath(p), children: _childNames(p) });
        /* Text animators are only useful with something to animate. */
        if (p.matchName === 'ADBE Text Animator' && a.animate) {
            var ap = p.property('ADBE Text Animator Properties'), j;
            var props = a.animate instanceof Array ? a.animate : [a.animate];
            for (j = 0; j < props.length; j++) { ap.addProperty(props[j]); }
            out[out.length - 1].children = _childNames(ap);
        }
    }
    _reveal(comp, L);
    return { comp: comp.name, layer: L.name, added: out };
}

function aeRemoveProperty(a) {
    var comp = _findComp(a.comp);
    var res = _eachLayer(comp, a, function (L) {
        var p = _findProp(L, a.path), name = p.name;
        try { p.remove(); }
        catch (e) { throw new Error('"' + name + '" cannot be removed — only effects, masks, shape items, text animators and similar added properties can.'); }
        return { layer: L.name, removed: name };
    });
    if (!res.results) { res.comp = comp.name; }
    return res;
}

function aePropertyMeta(a) {
    var comp = _findComp(a.comp), L = _findLayer(comp, a.layer), p = _findProp(L, a.path), before = {}, after = {}, dup;
    before = { name: p.name, index: p.propertyIndex };
    try { before.enabled = p.enabled; } catch (e0) {}
    /* Duplicating or reordering invalidates every property object in the
       group, p included — re-find things by path and index afterwards. */
    var parentPath = a.path.slice(0, a.path.length - 1), origName = p.name, idx = p.propertyIndex;
    if (a.duplicate === true) {
        p.duplicate();
        dup = _layerOrGroup(L, parentPath).property(idx + 1);
        _reveal(comp, L);
        return { comp: comp.name, layer: L.name, duplicated: origName, copy: { name: dup.name, path: _propPath(dup) } };
    }
    if (a.name !== undefined) { p.name = String(a.name); }
    if (a.enabled !== undefined) { p.enabled = !!a.enabled; }
    if (a.expressionEnabled !== undefined) { p.expressionEnabled = !!a.expressionEnabled; }
    if (a.index !== undefined) {
        p.moveTo(a.index);
        p = _layerOrGroup(L, parentPath).property(a.index);
    }
    after = { name: p.name, index: p.propertyIndex };
    try { after.enabled = p.enabled; } catch (e1) {}
    _reveal(comp, L);
    return { comp: comp.name, layer: L.name, before: before, after: after, path: _propPath(p) };
}

/* ------------------------------------------------------------------ */
/* Text                                                                */
/* ------------------------------------------------------------------ */

function aeText(a) {
    var comp = _findComp(a.comp), t;
    var res = _eachLayer(comp, a, function (L) {
        var sp, td, before, i, r, cr, k;
        if (!(L instanceof TextLayer)) { throw new Error('"' + L.name + '" is not a text layer.'); }
        sp = L.property('ADBE Text Properties').property('ADBE Text Document');
        t = a.time !== undefined ? _time(comp, a.time) : undefined;
        td = t !== undefined ? sp.valueAtTime(t, true) : sp.value;
        before = _textStyle(td, true);
        if (a.text === undefined && !a.style && !a.ranges) {
            return { layer: L.name, style: before, animated: sp.numKeys > 0 };
        }
        if (a.text !== undefined) { td.text = String(a.text); }
        if (a.style) { _applyTextStyle(td, a.style); }
        if (a.ranges) {
            /* Per-character styling (After Effects 2024.3 or later). */
            if (typeof td.characterRange !== 'function') {
                throw new Error('Per-character styling needs After Effects 24.3 or later.');
            }
            for (i = 0; i < a.ranges.length; i++) {
                r = a.ranges[i];
                cr = td.characterRange(r.start, r.end);
                for (k in r.style) {
                    if (!r.style.hasOwnProperty(k)) { continue; }
                    cr[k] = (k === 'fillColor' || k === 'strokeColor') ? _color(r.style[k], false) : r.style[k];
                }
            }
        }
        if (t !== undefined) { sp.setValueAtTime(t, td); }
        else if (sp.numKeys > 0) { throw new Error('Source Text on "' + L.name + '" is keyframed — pass "time".'); }
        else { sp.setValue(td); }
        return { layer: L.name, before: before, after: _textStyle(t !== undefined ? sp.valueAtTime(t, true) : sp.value, true) };
    });
    _reveal(comp, __aeTouched, t);
    if (!res.results) { res.comp = comp.name; }
    return res;
}

/* ------------------------------------------------------------------ */
/* Layer actions                                                       */
/* ------------------------------------------------------------------ */

function _bounds(L, comp) {
    var r = L.sourceRectAtTime(comp.time, false),
        tr = L.property('ADBE Transform Group'),
        ap = tr.property('ADBE Anchor Point').value,
        pos = tr.property('ADBE Position').value,
        sc = tr.property('ADBE Scale').value,
        sx = sc[0] / 100, sy = sc[1] / 100;
    if (L.parent) { throw new Error('"' + L.name + '" is parented — unparent it or align its parent instead.'); }
    return { left: pos[0] + (r.left - ap[0]) * sx, top: pos[1] + (r.top - ap[1]) * sy,
             width: r.width * sx, height: r.height * sy, rect: r, sx: sx, sy: sy };
}

function aeLayerAction(a) {
    var comp = _findComp(a.comp), action = a.action, targets, out = [], i, L, t, d, b, tgt, ov, cur, s, tr, sc;
    targets = a.layers !== undefined ? _findLayers(comp, a.layers) :
              (a.layer !== undefined ? [_findLayer(comp, a.layer)] : _findLayers(comp, 'selected'));

    if (action === 'sequence') {
        targets.sort(function (x, y) { return x.index - y.index; });
        ov = a.overlap !== undefined ? _time(comp, a.overlap) : 0;
        cur = a.start !== undefined ? _time(comp, a.start) : targets[0].inPoint;
        for (i = 0; i < targets.length; i++) {
            L = targets[i];
            L.startTime += cur - L.inPoint;
            out.push({ layer: L.name, inPoint: _round(L.inPoint), outPoint: _round(L.outPoint) });
            cur = L.outPoint - ov;
        }
        _reveal(comp, targets);
        return { comp: comp.name, action: action, layers: out };
    }

    for (i = 0; i < targets.length; i++) {
        L = targets[i];
        if (action === 'duplicate') {
            d = L.duplicate();
            if (a.name) { d.name = a.name; }
            out.push({ layer: L.name, copy: d.name, index: d.index });
        } else if (action === 'split') {
            t = _time(comp, a.time !== undefined ? a.time : comp.time);
            if (t <= L.inPoint || t >= L.outPoint) { throw new Error('Split time is outside "' + L.name + '".'); }
            d = L.duplicate();
            L.outPoint = t;
            d.inPoint = t;
            out.push({ layer: L.name, first: { index: L.index, outPoint: _round(L.outPoint) },
                       second: { index: d.index, inPoint: _round(d.inPoint) } });
        } else if (action === 'copy_to_comp') {
            tgt = _findComp(a.target);
            L.copyToComp(tgt);
            out.push({ layer: L.name, copiedTo: tgt.name, index: 1 });
        } else if (action === 'trim_to_work_area') {
            L.inPoint = Math.max(L.inPoint, comp.workAreaStart);
            L.outPoint = Math.min(L.outPoint, comp.workAreaStart + comp.workAreaDuration);
            out.push({ layer: L.name, inPoint: _round(L.inPoint), outPoint: _round(L.outPoint) });
        } else if (action === 'freeze_frame') {
            t = _time(comp, a.time !== undefined ? a.time : comp.time);
            if (!L.canSetTimeRemapEnabled) { throw new Error('"' + L.name + '" cannot be time-remapped.'); }
            L.timeRemapEnabled = true;
            tr = L.property('ADBE Time Remapping');
            /* Removing the last key switches time remapping back off, so keep
               one, hold it, and point it at the frozen source time. */
            while (tr.numKeys > 1) { tr.removeKey(tr.numKeys); }
            tr.setValueAtKey(1, (t - L.startTime) * (100 / L.stretch));
            tr.setInterpolationTypeAtKey(1, KeyframeInterpolationType.HOLD, KeyframeInterpolationType.HOLD);
            out.push({ layer: L.name, frozenAt: _round(t) });
        } else if (action === 'center_anchor') {
            tr = L.property('ADBE Transform Group');
            if (tr.property('ADBE Anchor Point').numKeys) { throw new Error('Anchor Point on "' + L.name + '" is keyframed.'); }
            b = L.sourceRectAtTime(comp.time, false);
            var ap = tr.property('ADBE Anchor Point').value, c2 = [b.left + b.width / 2, b.top + b.height / 2];
            sc = tr.property('ADBE Scale').value;
            var delta = [(c2[0] - ap[0]) * sc[0] / 100, (c2[1] - ap[1]) * sc[1] / 100];
            tr.property('ADBE Anchor Point').setValue(ap.length === 3 ? [c2[0], c2[1], ap[2]] : c2);
            _offsetProp(tr.property('ADBE Position'), delta);
            out.push({ layer: L.name, anchor: _plainValue(tr.property('ADBE Anchor Point').value) });
        } else if (action === 'fit_to_comp') {
            tr = L.property('ADBE Transform Group');
            b = L.sourceRectAtTime(comp.time, false);
            var fx = comp.width / b.width, fy = comp.height / b.height, f;
            /* Plain ifs: ExtendScript picks the wrong branch of a ?: chain. */
            if (a.mode === 'fill') { f = Math.max(fx, fy); }
            else if (a.mode === 'width') { f = fx; }
            else if (a.mode === 'height') { f = fy; }
            else { f = Math.min(fx, fy); }
            sc = tr.property('ADBE Scale').value;
            tr.property('ADBE Anchor Point').setValue([b.left + b.width / 2, b.top + b.height / 2].concat(sc.length === 3 ? [0] : []));
            tr.property('ADBE Scale').setValue([f * 100, f * 100].concat(sc.length === 3 ? [sc[2]] : []));
            if (!tr.property('ADBE Position').numKeys) {
                var pv = tr.property('ADBE Position').value;
                tr.property('ADBE Position').setValue([comp.width / 2, comp.height / 2].concat(pv.length === 3 ? [pv[2]] : []));
            }
            out.push({ layer: L.name, scale: _round(f * 100) });
        } else if (action === 'align') {
            b = _bounds(L, comp);
            var to = a.to || 'center', dx = 0, dy = 0, W = comp.width, H = comp.height;
            if (/left/.test(to)) { dx = -b.left; }
            if (/right/.test(to)) { dx = W - (b.left + b.width); }
            if (to === 'center' || to === 'hcenter') { dx = W / 2 - (b.left + b.width / 2); }
            if (/top/.test(to)) { dy = -b.top; }
            if (/bottom/.test(to)) { dy = H - (b.top + b.height); }
            if (to === 'center' || to === 'vcenter') { dy = H / 2 - (b.top + b.height / 2); }
            _offsetProp(L.property('ADBE Transform Group').property('ADBE Position'), [dx, dy]);
            out.push({ layer: L.name, moved: [_round(dx), _round(dy)] });
        } else {
            throw new Error('action must be duplicate, split, copy_to_comp, sequence, trim_to_work_area, ' +
                            'freeze_frame, center_anchor, fit_to_comp or align.');
        }
    }
    _reveal(comp, targets);
    return { comp: comp.name, action: action, results: out };
}

/* ------------------------------------------------------------------ */
/* Presets, catalog                                                    */
/* ------------------------------------------------------------------ */

function _presetRoots() {
    var roots = [], year = 2000 + parseInt(app.version, 10), f;
    /* macOS: Presets sits beside the .app bundle. Windows: Folder.appPackage is
       "Support Files", and Presets is inside it. */
    try { f = new Folder(Folder.appPackage.fsName + '/Presets'); if (f.exists) { roots.push(f); } } catch (e0) {}
    try {
        if (!roots.length) { f = new Folder(Folder.appPackage.parent.fsName + '/Presets'); if (f.exists) { roots.push(f); } }
    } catch (e1) {}
    try {
        f = new Folder(Folder.myDocuments.fsName + '/Adobe/After Effects ' + year + '/User Presets');
        if (f.exists) { roots.push(f); }
    } catch (e2) {}
    return roots;
}

function _findFiles(folder, re, out, limit, depth) {
    var list, i;
    if (out.length >= limit || depth > 6) { return; }
    list = folder.getFiles();
    for (i = 0; i < list.length && out.length < limit; i++) {
        if (list[i] instanceof Folder) { _findFiles(list[i], re, out, limit, depth + 1); }
        else if (/\.ffx$/i.test(list[i].name) && re.test(decodeURI(list[i].name))) { out.push(list[i]); }
    }
}

function _searchPresets(query, limit) {
    var roots = _presetRoots(), out = [], i, re = new RegExp(query ? String(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '.', 'i');
    for (i = 0; i < roots.length; i++) { _findFiles(roots[i], re, out, limit || 50, 0); }
    return out;
}

function aeApplyPreset(a) {
    var comp = _findComp(a.comp), f = null, found, targets, i, out = [];
    if (a.preset && /\.ffx$/i.test(a.preset) && new File(a.preset).exists) { f = new File(a.preset); }
    else {
        found = _searchPresets(a.preset, 10);
        if (!found.length) { throw new Error('No preset matches "' + a.preset + '". Search with ae_catalog {kind:"presets"}.'); }
        for (i = 0; i < found.length; i++) {
            if (decodeURI(found[i].name).toLowerCase() === (String(a.preset) + '.ffx').toLowerCase()) { f = found[i]; }
        }
        if (!f) {
            if (found.length > 1) {
                var names = [];
                for (i = 0; i < found.length; i++) { names.push(decodeURI(found[i].name)); }
                throw new Error('"' + a.preset + '" matches several presets: ' + names.join(', ') + '. Pass the exact name or full path.');
            }
            f = found[0];
        }
    }
    targets = a.layers !== undefined ? _findLayers(comp, a.layers) : [_findLayer(comp, a.layer)];
    for (i = 0; i < targets.length; i++) {
        targets[i].applyPreset(f);
        out.push(targets[i].name);
    }
    _reveal(comp, targets);
    return { comp: comp.name, preset: decodeURI(f.name), file: f.fsName, appliedTo: out };
}

/* Template names live on render-queue items. With the queue empty we add a
   throwaway item inside one undo group and Undo it afterwards, so neither the
   queue nor the user's Edit ▸ Undo history shows any trace. */
function _rqTemplates() {
    var rq = app.project.renderQueue, item, out;
    if (rq.numItems > 0) {
        item = rq.item(1);
        return { renderSettings: item.templates, outputModules: item.outputModule(1).templates };
    }
    if (!_comps().length) {
        throw new Error('Template names are read from a Render Queue item, and the project has no composition yet. Create one first.');
    }
    app.beginUndoGroup('MCP: Read Templates');
    try {
        item = rq.items.add(_comps()[0]);
        out = { renderSettings: item.templates, outputModules: item.outputModule(1).templates };
    } finally {
        app.endUndoGroup();
    }
    app.executeCommand(__CMD_UNDO);
    if (rq.numItems > 0) {
        /* The Undo hit something else (AE had not registered our group yet):
           put that back, then remove our item by hand. */
        app.executeCommand(__CMD_REDO);
        for (var i = rq.numItems; i >= 1; i--) { try { rq.item(i).remove(); } catch (e) {} }
    }
    return out;
}

function aeCatalog(a) {
    var kind = a.kind, q = a.query ? String(a.query).toLowerCase() : null,
        limit = a.limit || 60, out = [], i, j, e, fams, f, files, total = 0;
    function hit(s) { return !q || String(s).toLowerCase().indexOf(q) !== -1; }
    if (kind === 'effects') {
        for (i = 0; i < app.effects.length; i++) {
            e = app.effects[i];
            if (a.category && e.category !== a.category) { continue; }
            if (!hit(e.displayName) && !hit(e.matchName) && !hit(e.category)) { continue; }
            total++;
            if (out.length < limit) { out.push({ name: e.displayName, matchName: e.matchName, category: e.category }); }
        }
    } else if (kind === 'presets') {
        files = _searchPresets(a.query, limit);
        for (i = 0; i < files.length; i++) {
            out.push({ name: decodeURI(files[i].name).replace(/\.ffx$/i, ''),
                       category: decodeURI(files[i].parent.name), path: files[i].fsName });
        }
        total = out.length;
    } else if (kind === 'fonts') {
        try { fams = app.fonts.allFonts; } catch (eF) { throw new Error('Listing fonts needs After Effects 2024 or later.'); }
        for (i = 0; i < fams.length; i++) {
            for (j = 0; j < fams[i].length; j++) {
                f = fams[i][j];
                if (!hit(f.familyName) && !hit(f.postScriptName) && !hit(f.fullName)) { continue; }
                total++;
                if (out.length < limit) { out.push({ postScriptName: f.postScriptName, family: f.familyName, style: f.styleName }); }
            }
        }
    } else if (kind === 'render_templates' || kind === 'output_templates') {
        var t = _rqTemplates(), list = kind === 'render_templates' ? t.renderSettings : t.outputModules;
        for (i = 0; i < list.length; i++) {
            if (/^_HIDDEN/.test(list[i]) || !hit(list[i])) { continue; }
            out.push(list[i]);
        }
        total = out.length;
    } else {
        throw new Error('kind must be effects, presets, fonts, render_templates or output_templates.');
    }
    return { kind: kind, total: total, shown: out.length, items: out,
             note: total > out.length ? 'Narrow with "query" or raise "limit".' : undefined };
}

/* ------------------------------------------------------------------ */
/* Render queue                                                        */
/* ------------------------------------------------------------------ */

function _rqStatus(s) {
    var k;
    for (k in RQItemStatus) { try { if (RQItemStatus[k] === s) { return k.toLowerCase(); } } catch (e) {} }
    return String(s);
}

function _rqInfo(item, i) {
    var o = { index: i, comp: item.comp.name, status: _rqStatus(item.status), render: item.render, outputs: [] }, j, om;
    for (j = 1; j <= item.numOutputModules; j++) {
        om = item.outputModule(j);
        o.outputs.push({ file: om.file ? om.file.fsName : null, template: om.name });
    }
    try { o.elapsedSeconds = item.elapsedSeconds; } catch (e) {}
    return o;
}

function aeRenderQueue(a) {
    var rq = app.project.renderQueue, action = a.action || 'list', out = [], i, item, om;
    if (action === 'list') {
        for (i = 1; i <= rq.numItems; i++) { out.push(_rqInfo(rq.item(i), i)); }
        return { rendering: rq.rendering, items: out };
    }
    if (action === 'add') {
        item = rq.items.add(_findComp(a.comp));
        if (a.rsTemplate) { item.applyTemplate(a.rsTemplate); }
        om = item.outputModule(1);
        if (a.omTemplate) { om.applyTemplate(a.omTemplate); }
        if (a.output) { om.file = new File(a.output); }
        if (a.start !== undefined || a.duration !== undefined) {
            var c = item.comp;
            if (a.start !== undefined) { item.timeSpanStart = _time(c, a.start); }
            if (a.duration !== undefined) { item.timeSpanDuration = _time(c, a.duration, 'duration'); }
        }
        return { added: _rqInfo(item, rq.numItems) };
    }
    if (action === 'remove') {
        item = rq.item(a.index);
        out = _rqInfo(item, a.index);
        item.remove();
        return { removed: out };
    }
    if (action === 'clear') {
        for (i = rq.numItems; i >= 1; i--) {
            if (rq.item(i).status !== RQItemStatus.RENDERING) { rq.item(i).remove(); }
        }
        return { remaining: rq.numItems };
    }
    if (action === 'set') {
        item = rq.item(a.index);
        if (a.render !== undefined) { item.render = !!a.render; }
        if (a.output) { item.outputModule(1).file = new File(a.output); }
        if (a.rsTemplate) { item.applyTemplate(a.rsTemplate); }
        if (a.omTemplate) { item.outputModule(1).applyTemplate(a.omTemplate); }
        return { item: _rqInfo(item, a.index) };
    }
    if (action === 'queue_in_ame') {
        if (!rq.canQueueInAME) { throw new Error('Nothing queued, or Adobe Media Encoder is not installed.'); }
        rq.queueInAME(a.renderImmediately !== false);
        return { queuedInAME: true };
    }
    if (action === 'render') {
        /* Blocks After Effects until done — ae_render_video does not. */
        rq.render();
        for (i = 1; i <= rq.numItems; i++) { out.push(_rqInfo(rq.item(i), i)); }
        return { rendered: true, items: out };
    }
    throw new Error('action must be list, add, remove, clear, set, render or queue_in_ame.');
}

/* ------------------------------------------------------------------ */
/* Menu commands, navigation                                           */
/* ------------------------------------------------------------------ */

function aeMenuCommand(a) {
    var comp, id, name = a.command, targets;
    if (typeof name === 'number') { id = name; }
    else {
        if (/(\.\.\.|…)$/.test(String(name)) && a.allowDialog !== true) {
            throw new Error('"' + name + '" opens a dialog, which would freeze the bridge until someone clicks it. ' +
                'Use a dedicated tool, or pass allowDialog: true if a person is at the machine.');
        }
        id = app.findMenuCommandId(String(name));
        if (!id) { throw new Error('No menu command named "' + name + '". Use the exact menu text, e.g. "Convert to Editable Text".'); }
    }
    if (a.layers !== undefined || a.layer !== undefined) {
        comp = _findComp(a.comp);
        targets = a.layers !== undefined ? _findLayers(comp, a.layers) : [_findLayer(comp, a.layer)];
        if (app.project.activeItem !== comp) { comp.openInViewer(); }
        for (var i = 1; i <= comp.numLayers; i++) { comp.layer(i).selected = false; }
        for (var j = 0; j < targets.length; j++) { targets[j].selected = true; }
    }
    app.executeCommand(id);
    return { executed: name, id: id };
}

function aeGoto(a) {
    var comp = _findComp(a.comp), targets, i, t;
    comp.openInViewer();
    if (a.time !== undefined) {
        t = _time(comp, a.time);
        comp.time = Math.max(0, Math.min(t, comp.duration));
    }
    if (a.layers !== undefined || a.layer !== undefined) {
        targets = a.layers !== undefined ? _findLayers(comp, a.layers) : [_findLayer(comp, a.layer)];
        for (i = 1; i <= comp.numLayers; i++) { comp.layer(i).selected = false; }
        for (i = 0; i < targets.length; i++) { targets[i].selected = true; }
    }
    return aeSelection();
}

/* ------------------------------------------------------------------ */
/* Project items                                                       */
/* ------------------------------------------------------------------ */

function aeItemAction(a) {
    var action = a.action, it, f, out = [], i, o, folder;
    if (action === 'create_folder') {
        folder = app.project.items.addFolder(a.name || 'Folder');
        if (a.folder) { folder.parentFolder = _findItem(a.folder); }
        return _itemInfo(folder);
    }
    if (action === 'missing') {
        for (i = 1; i <= app.project.numItems; i++) {
            it = app.project.item(i);
            try { if (it instanceof FootageItem && it.footageMissing) { out.push(_itemInfo(it)); } } catch (e) {}
        }
        return { missing: out };
    }
    if (action === 'remove_unused') { return { removed: app.project.removeUnusedFootage() }; }
    if (action === 'consolidate') { return { removed: app.project.consolidateFootage() }; }
    if (action === 'reduce') {
        var keep = [];
        for (i = 0; i < (a.items || []).length; i++) { keep.push(_findItem(a.items[i])); }
        if (!keep.length) { throw new Error('Pass "items": the comps to keep.'); }
        return { removed: app.project.reduceProject(keep) };
    }

    it = _findItem(a.item);
    if (action === 'rename') { it.name = String(a.name); }
    else if (action === 'move') { it.parentFolder = a.folder ? _findItem(a.folder) : app.project.rootFolder; }
    else if (action === 'label') { it.label = a.label; }
    else if (action === 'comment') { it.comment = String(a.comment); }
    else if (action === 'replace_source') {
        f = new File(a.path);
        if (!f.exists) { throw new Error('File not found: ' + a.path); }
        if (a.sequence) { it.replaceWithSequence(f, false); } else { it.replace(f); }
    } else if (action === 'reload') { it.mainSource.reload(); }
    else if (action === 'set_proxy') {
        f = new File(a.path);
        if (!f.exists) { throw new Error('File not found: ' + a.path); }
        it.setProxy(f);
    } else if (action === 'clear_proxy') { it.setProxyToNone(); }
    else if (action === 'interpret') {
        o = a.settings || {};
        var ms = it.mainSource;
        if (o.frameRate !== undefined) { ms.conformFrameRate = o.frameRate; }
        if (o.loop !== undefined) { ms.loop = o.loop; }
        if (o.pixelAspect !== undefined) { it.pixelAspect = o.pixelAspect; }
        if (o.alpha !== undefined) {
            ms.alphaMode = { ignore: AlphaMode.IGNORE, straight: AlphaMode.STRAIGHT,
                             premultiplied: AlphaMode.PREMULTIPLIED }[o.alpha];
        }
        if (o.premulColor !== undefined) { ms.premulColor = _color(o.premulColor, false); }
        if (o.invertAlpha !== undefined) { ms.invertAlpha = !!o.invertAlpha; }
    } else if (action === 'open') {
        if (!(it instanceof CompItem)) { throw new Error('"' + it.name + '" is not a composition.'); }
        it.openInViewer();
    } else {
        throw new Error('action must be create_folder, rename, move, label, comment, replace_source, reload, ' +
                        'set_proxy, clear_proxy, interpret, open, missing, remove_unused, consolidate or reduce.');
    }
    return _itemInfo(it);
}


/* ------------------------------------------------------------------ */
/* Essential Graphics / Motion Graphics templates                      */
/* ------------------------------------------------------------------ */

function _egControllers(comp) {
    var out = [], i, n = 0;
    try { n = comp.motionGraphicsTemplateControllerCount; } catch (e) { return out; }
    for (i = 1; i <= n; i++) {
        try { out.push({ index: i, name: comp.getMotionGraphicsTemplateControllerName(i) }); } catch (e2) {}
    }
    return out;
}

function aeEssentialGraphics(a) {
    var comp = _findComp(a.comp), action = a.action || 'list', list, i, p, L, f, added = [];
    if (typeof comp.exportAsMotionGraphicsTemplate !== 'function') {
        throw new Error('Essential Graphics scripting needs After Effects CC 2019 or later.');
    }
    if (action === 'list') {
        return { comp: comp.name, templateName: comp.motionGraphicsTemplateName || null, controllers: _egControllers(comp) };
    }
    if (action === 'add') {
        list = a.properties instanceof Array ? a.properties : [{ layer: a.layer, path: a.path, name: a.name }];
        /* After Effects puts each new control at the top of the panel, so
           add in reverse: the first one listed ends up first. */
        for (i = list.length - 1; i >= 0; i--) {
            L = _findLayer(comp, list[i].layer);
            p = _findProp(L, list[i].path);
            if (!p.canAddToMotionGraphicsTemplate(comp)) {
                throw new Error('"' + p.name + '" on "' + L.name + '" cannot go in the Essential Graphics panel. ' +
                    'Supported: Source Text, colours, checkboxes, sliders, angles, points, and other simple values.');
            }
            if (list[i].name) { p.addToMotionGraphicsTemplateAs(comp, String(list[i].name)); }
            else { p.addToMotionGraphicsTemplate(comp); }
            added.unshift({ layer: L.name, property: p.name, as: list[i].name || p.name });
        }
        return { comp: comp.name, added: added, controllers: _egControllers(comp) };
    }
    if (action === 'set_name') {
        comp.motionGraphicsTemplateName = String(a.name);
        return { comp: comp.name, templateName: comp.motionGraphicsTemplateName };
    }
    if (action === 'open') {
        comp.openInEssentialGraphics();
        return { comp: comp.name, opened: true };
    }
    if (action === 'export') {
        /* exportAsMotionGraphicsTemplate takes a FOLDER and names the file
           after the template. Accept a folder, or a path ending in .mogrt
           (its folder is used and its name becomes the template name). */
        if (!a.file) { throw new Error('Pass "file": a folder, or a path ending in .mogrt.'); }
        if (!_egControllers(comp).length) { throw new Error('"' + comp.name + '" has no Essential Graphics controls yet. Add some first.'); }
        var target = new File(String(a.file)), folder, tname, compId = comp.id;
        if (/\.mogrt$/i.test(target.name)) {
            folder = target.parent;
            comp.motionGraphicsTemplateName = decodeURI(target.name).replace(/\.mogrt$/i, '');
        } else {
            folder = new Folder(String(a.file));
        }
        if (!folder.exists) { folder.create(); }
        if (!comp.motionGraphicsTemplateName) { comp.motionGraphicsTemplateName = comp.name; }
        tname = comp.motionGraphicsTemplateName;
        if (!comp.exportAsMotionGraphicsTemplate(a.overwrite === true, folder.fsName)) {
            throw new Error('Export failed. Is the folder writable, or does "' + tname + '.mogrt" exist there (pass overwrite: true)?');
        }
        /* The export invalidates the comp object; don't touch it again. */
        f = new File(folder.fsName + '/' + tname + '.mogrt');
        return { comp: _findComp(compId).name, exported: f.fsName, exists: f.exists, templateName: tname,
                 note: 'After an export, After Effects attaches one invisible step to the next edit, so the ' +
                       'first Edit ▸ Undo after that edit may appear to do nothing. Check with ae_comp_tree ' +
                       'before undoing again.' };
    }
    throw new Error('action must be list, add, set_name, open or export.');
}
