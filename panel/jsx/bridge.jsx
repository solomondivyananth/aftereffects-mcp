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
    'duplicate_comp,import_file,precompose,delete_item';

/* Project-level operations. The guard treats these specially: they change
   which project is open, so a sandbox path cannot meaningfully protect them. */
var __AE_PROJECT_FNS = 'new_project,open_project';

function __aeBridge(fn, argsJson) {
    var args, result;
    try {
        args = (argsJson && argsJson.length) ? JSON.parse(argsJson) : {};
    } catch (eParse) {
        return JSON.stringify({ ok: false, error: 'Bad arguments JSON: ' + eParse.toString() });
    }

    var isWrite = (',' + __AE_WRITE_FNS + ',').indexOf(',' + fn + ',') !== -1;
    if (isWrite) { app.beginUndoGroup('Claude: ' + fn); }
    try {
        result = __aeDispatch(fn, args);
        return __aeWrap({ ok: true, result: result });
    } catch (e) {
        return JSON.stringify({
            ok: false,
            error: e.toString() + (e.line ? ' (bridge.jsx line ' + e.line + ')' : '')
        });
    } finally {
        if (isWrite) { app.endUndoGroup(); }
    }
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
        case 'ping':            return { version: '0.1.0', aeVersion: app.version, buildName: app.buildName };
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
        if (all[i].name === name) { return all[i]; }
    }
    throw new Error('Composition not found: "' + name + '"');
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
    if (v && typeof v === 'object' && v.text !== undefined) {
        /* TextDocument */
        return {
            text: v.text,
            font: (function () { try { return v.font; } catch (e) { return null; } })(),
            fontSize: (function () { try { return v.fontSize; } catch (e) { return null; } })()
        };
    }
    return v;
}

function _round(n) {
    if (typeof n !== 'number' || !isFinite(n)) { return n; }
    return Math.round(n * 10000) / 10000;
}

function _safeValue(p) {
    var t;
    try { t = p.propertyValueType; } catch (e) { return null; }
    if (t === PropertyValueType.SHAPE || t === PropertyValueType.CUSTOM_VALUE ||
        t === PropertyValueType.MARKER || t === PropertyValueType.NO_VALUE) {
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
    var out = [], k, ease;
    for (k = 1; k <= p.numKeys; k++) {
        var entry = {
            time: _round(p.keyTime(k)),
            value: (function () { try { return _plainValue(p.keyValue(k)); } catch (e) { return null; } })(),
            inInterp: _interpName(p.keyInInterpolationType(k)),
            outInterp: _interpName(p.keyOutInterpolationType(k))
        };
        try {
            ease = p.keyOutTemporalEase(k);
            if (ease && ease.length) { entry.outInfluence = _round(ease[0].influence); }
            ease = p.keyInTemporalEase(k);
            if (ease && ease.length) { entry.inInfluence = _round(ease[0].influence); }
        } catch (eEase) { /* not a temporal property */ }
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
        if (L.source instanceof SolidSource) { return 'solid'; }
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
            if (entry) { out.push(entry); }
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
                value: _safeValue(root),
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
        out.properties.push({
            name: sel[i].name,
            matchName: sel[i].matchName,
            layer: (function () { try { return sel[i].propertyGroup(sel[i].propertyDepth).name; } catch (e) { return null; } })()
        });
    }
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
        for (i = 0; i < a.times.length; i++) { times.push(Number(a.times[i])); }
    } else if (typeof a.time === 'number') {
        times.push(a.time);
    } else if (typeof a.frames === 'number' && a.frames > 1) {
        var start = (typeof a.start === 'number') ? a.start : comp.workAreaStart;
        var dur = (typeof a.duration === 'number') ? a.duration : comp.workAreaDuration;
        for (i = 0; i < a.frames; i++) {
            times.push(start + (dur * i / (a.frames - 1)));
        }
    } else {
        times.push(comp.time);
    }

    try {
        comp.resolutionFactor = [down, down];
        for (i = 0; i < times.length; i++) {
            t = Math.max(0, Math.min(times[i], comp.duration - (1 / comp.frameRate)));
            f = new File(outDir + '/ae_frame_' + stamp + '_' + i + '.png');
            comp.saveFrameToPng(t, f);
            files.push({ path: f.fsName, time: _round(t), frame: Math.round(t * comp.frameRate) });
        }
    } finally {
        comp.resolutionFactor = saved;
    }

    return {
        comp: comp.name,
        compWidth: comp.width,
        compHeight: comp.height,
        renderedWidth: Math.floor(comp.width / down),
        renderedHeight: Math.floor(comp.height / down),
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
        else {
            if (value.text !== undefined) { td.text = value.text; }
            if (value.fontSize !== undefined) { td.fontSize = value.fontSize; }
            if (value.font !== undefined) { td.font = value.font; }
            if (value.fillColor !== undefined) { td.fillColor = value.fillColor; }
            if (value.justification !== undefined) { td.justification = value.justification; }
        }
        return td;
    }
    return value;
}

function aeSetProperty(a) {
    var comp = _findComp(a.comp),
        L = _findLayer(comp, a.layer),
        p = _findProp(L, a.path),
        v;
    if (p.propertyType !== PropertyType.PROPERTY) {
        throw new Error('"' + p.name + '" is a group, not a settable property.');
    }
    v = _coerceForProp(p, a.value);
    if (typeof a.time === 'number') {
        p.setValueAtTime(a.time, v);
    } else if (p.numKeys > 0) {
        throw new Error('"' + p.name + '" is animated (' + p.numKeys +
            ' keyframes). Pass "time" to set a keyframe, or use add_keyframes.');
    } else {
        p.setValue(v);
    }
    return { comp: comp.name, layer: L.name, property: p.name, value: _safeValue(p), numKeys: p.numKeys };
}

function aeAddKeyframes(a) {
    var comp = _findComp(a.comp),
        L = _findLayer(comp, a.layer),
        p = _findProp(L, a.path),
        keys = a.keys, i, k, idx, ease, inE, outE;

    if (!(keys instanceof Array) || !keys.length) {
        throw new Error('"keys" must be a non-empty array of {time, value}.');
    }
    if (a.replace === true) {
        while (p.numKeys > 0) { p.removeKey(1); }
    }
    for (i = 0; i < keys.length; i++) {
        p.setValueAtTime(Number(keys[i].time), _coerceForProp(p, keys[i].value));
    }
    /* Second pass: easing needs the keys to exist first. */
    for (i = 0; i < keys.length; i++) {
        k = keys[i];
        if (!k.ease && !k.interp) { continue; }
        idx = p.nearestKeyIndex(Number(k.time));
        if (k.interp === 'hold') {
            p.setInterpolationTypeAtKey(idx, KeyframeInterpolationType.HOLD, KeyframeInterpolationType.HOLD);
            continue;
        }
        if (k.interp === 'linear') {
            p.setInterpolationTypeAtKey(idx, KeyframeInterpolationType.LINEAR, KeyframeInterpolationType.LINEAR);
            continue;
        }
        if (k.ease) {
            var inf = (typeof k.ease === 'number') ? k.ease : 75;
            var inInf = (k.ease && k.ease.in !== undefined) ? k.ease.in : inf;
            var outInf = (k.ease && k.ease.out !== undefined) ? k.ease.out : inf;
            var dim = 1;
            try { var vv = p.value; if (vv instanceof Array) { dim = vv.length; } } catch (eD) {}
            inE = []; outE = [];
            for (var d = 0; d < dim; d++) {
                inE.push(new KeyframeEase(0, Math.max(0.1, Math.min(100, inInf))));
                outE.push(new KeyframeEase(0, Math.max(0.1, Math.min(100, outInf))));
            }
            p.setInterpolationTypeAtKey(idx, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
            p.setTemporalEaseAtKey(idx, inE, outE);
        }
    }
    return { comp: comp.name, layer: L.name, property: p.name, numKeys: p.numKeys, keys: _keys(p) };
}

function aeSetExpression(a) {
    var comp = _findComp(a.comp),
        L = _findLayer(comp, a.layer),
        p = _findProp(L, a.path);
    if (!p.canSetExpression) {
        throw new Error('"' + p.name + '" does not accept expressions.');
    }
    p.expression = String(a.expression);
    if (p.expressionError && p.expressionError.length) {
        var err = p.expressionError;
        p.expression = '';
        throw new Error('Expression rejected by After Effects: ' + err);
    }
    return { comp: comp.name, layer: L.name, property: p.name, expression: p.expression, value: _safeValue(p) };
}

function aeClearExpression(a) {
    var comp = _findComp(a.comp),
        L = _findLayer(comp, a.layer),
        p = _findProp(L, a.path);
    p.expression = '';
    return { comp: comp.name, layer: L.name, property: p.name, cleared: true };
}

function aeApplyEffect(a) {
    var comp = _findComp(a.comp),
        L = _findLayer(comp, a.layer),
        fx, e, k, sub;
    fx = L.property('ADBE Effect Parade');
    if (!fx) { throw new Error('Layer "' + L.name + '" cannot take effects.'); }
    try {
        e = fx.addProperty(a.effect);
    } catch (err) {
        throw new Error('Could not apply effect "' + a.effect + '": ' + err.toString() +
            ' — try the exact effect name as it appears in the Effects panel, or its matchName.');
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
            sub.setValue(a.params[k]);
        }
    }
    return {
        comp: comp.name, layer: L.name, effect: e.name, matchName: e.matchName,
        params: _childNames(e)
    };
}

function aeCreateLayer(a) {
    var comp = _findComp(a.comp),
        kind = String(a.kind || '').toLowerCase(),
        o = a.options || {},
        L, color;

    if (kind === 'solid') {
        color = o.color || [0, 0, 0];
        L = comp.layers.addSolid(color, o.name || 'Solid',
            o.width || comp.width, o.height || comp.height, 1,
            o.duration || comp.duration);
    } else if (kind === 'text') {
        L = comp.layers.addText(o.text !== undefined ? String(o.text) : 'Text');
    } else if (kind === 'null') {
        L = comp.layers.addNull(o.duration || comp.duration);
    } else if (kind === 'shape') {
        L = comp.layers.addShape();
    } else if (kind === 'adjustment') {
        L = comp.layers.addSolid([1, 1, 1], o.name || 'Adjustment',
            comp.width, comp.height, 1, o.duration || comp.duration);
        L.adjustmentLayer = true;
    } else if (kind === 'camera') {
        L = comp.layers.addCamera(o.name || 'Camera',
            o.centerPoint || [comp.width / 2, comp.height / 2]);
    } else if (kind === 'light') {
        L = comp.layers.addLight(o.name || 'Light',
            o.centerPoint || [comp.width / 2, comp.height / 2]);
    } else if (kind === 'precomp' || kind === 'footage' || kind === 'source') {
        /* Any AVItem works here — a comp, imported video, image or audio. */
        var src = _findItem(o.source);
        if (!(src instanceof CompItem) && !(src instanceof FootageItem)) {
            throw new Error('"' + o.source + '" is a ' + src.typeName +
                ', which cannot be added to a composition.');
        }
        L = comp.layers.add(src, o.duration || undefined);
    } else {
        throw new Error('Unknown layer kind "' + a.kind +
            '". Use: solid, text, shape, null, adjustment, camera, light, precomp, footage.');
    }

    if (o.name && kind !== 'solid' && kind !== 'adjustment') { L.name = o.name; }
    if (o.scale) { L.property('ADBE Transform Group').property('Scale').setValue(o.scale); }
    if (typeof o.opacity === 'number') {
        L.property('ADBE Transform Group').property('Opacity').setValue(o.opacity);
    }
    if (o.parent) {
        try { L.parent = _findLayer(comp, o.parent); } catch (eP) {}
    }
    if (typeof o.startTime === 'number') { L.startTime = o.startTime; }
    if (typeof o.inPoint === 'number') { L.inPoint = o.inPoint; }
    if (typeof o.outPoint === 'number') { L.outPoint = o.outPoint; }
    if (typeof o.index === 'number' && o.index >= 1 && o.index <= comp.numLayers) {
        L.moveTo(o.index);
    }
    if (o.position) { L.property('ADBE Transform Group').property('Position').setValue(o.position); }
    if (o.threeD === true) { L.threeDLayer = true; }

    return { comp: comp.name, layer: L.name, index: L.index, kind: _layerKind(L) };
}

function aeDeleteLayer(a) {
    var comp = _findComp(a.comp),
        L = _findLayer(comp, a.layer),
        name = L.name;
    L.remove();
    return { comp: comp.name, deleted: name, remainingLayers: comp.numLayers };
}

function aeSetLayerProps(a) {
    var comp = _findComp(a.comp),
        L = _findLayer(comp, a.layer),
        o = a.props || {}, changed = [], k, parent;

    for (k in o) {
        if (!o.hasOwnProperty(k)) { continue; }
        if (k === 'parent') {
            parent = (o.parent === null) ? null : _findLayer(comp, o.parent);
            L.parent = parent;
        } else if (k === 'index') {
            L.moveTo(o.index);
        } else {
            L[k] = o[k];
        }
        changed.push(k);
    }
    return { comp: comp.name, layer: L.name, index: L.index, changed: changed };
}

function aeRunJsx(a) {
    var r = eval(a.code);
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
        a.duration || 10,
        a.frameRate || 30);
    if (a.bgColor) { c.bgColor = a.bgColor; }
    if (a.folder) {
        try { c.parentFolder = _findItem(a.folder); } catch (e) {}
    }
    if (a.open !== false) { c.openInViewer(); }
    return _itemInfo(c);
}

function aeSetCompSettings(a) {
    var c = _findComp(a.comp), o = a.settings || {}, changed = [], k;
    for (k in o) {
        if (!o.hasOwnProperty(k)) { continue; }
        if (k === 'bgColor') { c.bgColor = o[k]; }
        else if (k === 'resolutionFactor') { c.resolutionFactor = o[k]; }
        else { c[k] = o[k]; }
        changed.push(k);
    }
    return { comp: c.name, changed: changed, info: _itemInfo(c) };
}

function aeDuplicateComp(a) {
    var c = _findComp(a.comp), d = c.duplicate();
    if (a.name) { d.name = a.name; }
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
