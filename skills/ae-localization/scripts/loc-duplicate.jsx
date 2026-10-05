/*
 * loc-duplicate.jsx - make one language version of a master comp.
 * ES3 ExtendScript. Duplicate Composition copies only the top comp, so a
 * precomp holding text would stay shared and a translation typed into it
 * would change every language. This copies the master and every precomp
 * under it that contains text (at any depth), renames each copy
 * "<name><sep><LANG>", repoints the copies at each other and files them in a
 * folder named after the language. Precomps with no text stay shared.
 *
 *   ae_run_jsx {"code": "$.global.locArgs = {master: 'Master_16x9', lang: 'DE'}; $.evalFile(new File('<absolute path>/loc-duplicate.jsx'))"}
 *
 * Optional: sep (default "_"), folder (default lang). One undo step.
 * Returns a JSON string {lang, master, copies: [{from, to}], expressionRefs}
 * Save it as dup-DE.json for loc-sheet.js apply --map.
 */
(function () {
    var A = $.global.locArgs || {}, P = app.project, i, master = null, memo = {}, textMemo = {};
    var sep = A.sep !== undefined ? A.sep : '_', lang = A.lang, copies = [], refs = [], folder;
    if (!A.master || !lang) { throw new Error('Set $.global.locArgs = {master: "...", lang: "DE"} first.'); }
    for (i = 1; i <= P.numItems; i++) {
        if (P.item(i) instanceof CompItem) {
            if (P.item(i).name === A.master) { master = P.item(i); }
            if (P.item(i).name === A.master + sep + lang) { throw new Error('"' + A.master + sep + lang + '" already exists.'); }
        }
    }
    if (!master) { throw new Error('No comp named "' + A.master + '".'); }

    function hasText(c) {
        var k, L, found = false;
        if (textMemo[c.id] !== undefined) { return textMemo[c.id]; }
        textMemo[c.id] = false; /* guards against a comp nested in itself */
        for (k = 1; k <= c.numLayers && !found; k++) {
            L = c.layer(k);
            if (L instanceof TextLayer) { found = true; }
            else if (L.source instanceof CompItem && hasText(L.source)) { found = true; }
        }
        textMemo[c.id] = found;
        return found;
    }

    function copy(c) {
        var d, k, L, st;
        if (memo[c.id]) { return memo[c.id]; }
        d = c.duplicate();
        d.name = c.name + sep + lang;
        d.parentFolder = folder;
        memo[c.id] = d;
        copies.push({ from: c.name, to: d.name });
        for (k = 1; k <= d.numLayers; k++) {
            L = d.layer(k);
            if (L.source instanceof CompItem && hasText(L.source)) { L.replaceSource(copy(L.source), false); }
            if (L instanceof TextLayer) {
                st = L.property('ADBE Text Properties').property('ADBE Text Document');
                if (st.expressionEnabled && /comp\(/.test(st.expression)) {
                    refs.push({ comp: d.name, layer: k, layerName: L.name, expression: st.expression });
                }
            }
        }
        return d;
    }

    folder = P.items.addFolder(A.folder || lang);
    copy(master);
    return JSON.stringify({ lang: lang, master: memo[master.id].name, copies: copies, expressionRefs: refs });
})();
