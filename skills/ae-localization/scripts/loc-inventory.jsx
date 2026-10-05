/*
 * loc-inventory.jsx - list every piece of text a localisation has to touch.
 * ES3 ExtendScript. Run it through the bridge (which supplies JSON):
 *
 *   ae_run_jsx {"file": "<absolute path>/loc-inventory.jsx"}
 *
 * Read-only: it changes nothing in the project. Returns a JSON string:
 *   rows   one per Source Text value (one per key when Source Text is keyed)
 *   media  footage and outlined text that may carry words only a person can
 *          replace (images, video, PSD/AI, "... Outlines" shape layers)
 *   comps  every comp, its size and where it is nested
 * Save the result as inventory.json and hand it to loc-sheet.js.
 */
(function () {
    var P = app.project, rows = [], media = [], comps = [], i, j, it, L;

    function r3(n) { return Math.round(n * 1000) / 1000; }

    function fontInfo(td) {
        var o = {};
        try { o.font = td.font; } catch (e1) {}
        try { o.family = td.fontFamily; } catch (e2) {}
        try { o.style = td.fontStyle; } catch (e3) {}
        try { o.size = r3(td.fontSize); } catch (e4) {}
        try { o.location = td.fontLocation; } catch (e5) {}
        try { o.box = td.boxText ? [r3(td.boxTextSize[0]), r3(td.boxTextSize[1])] : null; } catch (e6) { o.box = null; }
        try { if (td.direction !== undefined) { o.direction = String(td.direction); } } catch (e7) {}
        return o;
    }

    /* Widest and tallest the layer gets, and when: the frame to render. */
    function measure(layer, t0, t1) {
        var n = 12, k, t, r, best = { w: 0, h: 0, at: t0 };
        for (k = 0; k <= n; k++) {
            t = t0 + (t1 - t0) * k / n;
            try { r = layer.sourceRectAtTime(t, false); } catch (e) { continue; }
            if (r3(r.width) > best.w) { best.w = r3(r.width); best.at = r3(t); }
            if (r3(r.height) > best.h) { best.h = r3(r.height); }
        }
        return best;
    }

    function usedIn(c) {
        var out = [], a, b, pc, pl;
        try {
            for (a = 0; a < c.usedIn.length; a++) {
                pc = c.usedIn[a];
                for (b = 1; b <= pc.numLayers; b++) {
                    pl = pc.layer(b);
                    if (pl.source === c) { out.push({ comp: pc.name, layer: b, startTime: r3(pl.startTime) }); }
                }
            }
        } catch (e) {}
        return out;
    }

    function addText(c, layer) {
        var st = layer.property('ADBE Text Properties').property('ADBE Text Document');
        var expr = '', k, td, next, m, sc = [100, 100], base;
        try { if (st.expressionEnabled) { expr = st.expression; } } catch (eX) {}
        try { sc = layer.property('ADBE Transform Group').property('ADBE Scale').value; } catch (eS) {}
        base = {
            comp: c.name, compId: c.id, compSize: [c.width, c.height],
            layer: layer.index, layerName: layer.name,
            enabled: layer.enabled, guide: layer.guideLayer,
            inPoint: r3(layer.inPoint), outPoint: r3(layer.outPoint),
            scale: r3(sc[0])
        };
        function row(key, t, td, t1) {
            var o = {}, p, m2 = measure(layer, t, t1), f = fontInfo(td);
            for (p in base) { if (base.hasOwnProperty(p)) { o[p] = base[p]; } }
            o.id = 'c' + c.id + '-L' + layer.index + (key ? '-k' + key : '');
            o.key = key; o.time = r3(t);
            o.text = String(td.text);
            o.font = f; o.widthPx = m2.w; o.heightPx = m2.h; o.widestAt = m2.at;
            if (expr) {
                o.expression = expr;
                try { o.shown = String(st.valueAtTime(m2.at, false).text); } catch (eV) {}
            }
            rows.push(o);
        }
        if (st.numKeys > 0) {
            for (k = 1; k <= st.numKeys; k++) {
                td = st.keyValue(k);
                next = k < st.numKeys ? st.keyTime(k + 1) : layer.outPoint;
                m = st.keyTime(k);
                /* stop a frame short of the next key, so each key is measured alone */
                row(k, Math.max(m, layer.inPoint), td, Math.min(next, layer.outPoint) - c.frameDuration);
            }
        } else {
            row(0, layer.inPoint, st.value, layer.outPoint);
        }
    }

    for (i = 1; i <= P.numItems; i++) {
        it = P.item(i);
        if (it instanceof CompItem) {
            var egp = [];
            try {
                for (j = 0; j < it.motionGraphicsTemplateControllerCount; j++) {
                    egp.push(it.getMotionGraphicsTemplateControllerName(j));
                }
            } catch (eE) {}
            comps.push({ name: it.name, id: it.id, size: [it.width, it.height], fps: r3(it.frameRate),
                         duration: r3(it.duration), usedIn: usedIn(it), essentialGraphics: egp });
            for (j = 1; j <= it.numLayers; j++) {
                L = it.layer(j);
                if (L instanceof TextLayer) { addText(it, L); }
                else if (L instanceof ShapeLayer && / Outlines$/.test(L.name)) {
                    media.push({ kind: 'outlined text', comp: it.name, layer: j, layerName: L.name,
                                 inPoint: r3(L.inPoint), outPoint: r3(L.outPoint) });
                }
            }
        } else if (it instanceof FootageItem) {
            try { if (it.mainSource instanceof SolidSource || !it.hasVideo) { continue; } } catch (eF) { continue; }
            var used = [];
            try { for (j = 0; j < it.usedIn.length; j++) { used.push(it.usedIn[j].name); } } catch (eU) {}
            media.push({ kind: 'footage', name: it.name, id: it.id,
                         file: it.file ? it.file.fsName : null, missing: it.footageMissing, usedIn: used });
        }
    }
    return JSON.stringify({ project: P.file ? P.file.fsName : null, rows: rows, media: media, comps: comps });
})();
