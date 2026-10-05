/* ES3. Called through guarded run_jsx, never directly from the panel. */
function aeLibraryOperation(a) {
    if (!a || (a.action !== 'open' && a.action !== 'insert')) { throw new Error('Choose open or insert.'); }
    var active = app.project.activeItem;
    if (a.action === 'insert' && !(active instanceof CompItem)) { throw new Error('Open the destination composition first.'); }
    var sourceFile = new File(a.project);
    if (!sourceFile.exists) { throw new Error('Library AEP is missing: ' + a.project); }
    var marker = 'AE_REUSABLE_LIBRARY:' + sourceFile.fsName;
    var sourceRoot = null, source = null, i, item;
    var isLibraryProject = app.project.file && app.project.file.fsName === sourceFile.fsName;
    if (!isLibraryProject) {
        for (i = 1; i <= app.project.numItems; i++) {
            item = app.project.item(i);
            if (item instanceof FolderItem && item.comment === marker) { sourceRoot = item; break; }
        }
        if (!sourceRoot) {
            sourceRoot = app.project.importFile(new ImportOptions(sourceFile));
            sourceRoot.name = 'Reusable library • source templates';
            sourceRoot.comment = marker;
        }
    }
    function within(item, root) {
        if (!root) { return true; }
        var p = item.parentFolder;
        while (p && p !== app.project.rootFolder) {
            if (p === root) { return true; }
            p = p.parentFolder;
        }
        return false;
    }
    for (i = 1; i <= app.project.numItems; i++) {
        item = app.project.item(i);
        if (item instanceof CompItem && item.name === a.comp && within(item, sourceRoot)) { source = item; break; }
    }
    if (!source) { throw new Error('Template comp is missing: ' + a.comp); }
    if (a.action === 'open') {
        source.openInViewer(); source.time = Math.min(Number(a.time) || 0, source.duration - source.frameDuration);
        return { action: 'open', comp: source.name, id: source.id };
    }
    if (active === source) { throw new Error('Choose a different destination comp.'); }
    var output = app.project.items.addFolder(a.comp + ' • instance');
    var copies = {}, made = [];
    function copyTree(original, depth) {
        if (depth > 40) { throw new Error('Precomp nesting is too deep.'); }
        var key = String(original.id);
        if (copies[key]) { return copies[key]; }
        var c = original.duplicate(); copies[key] = c; made.push(c); c.parentFolder = output;
        c.name = original.name + ' • ' + output.id;
        for (var j = 1; j <= c.numLayers; j++) {
            var l = c.layer(j);
            if (l.source instanceof CompItem) { l.replaceSource(copyTree(l.source, depth + 1), false); }
        }
        return c;
    }
    var copy = copyTree(source, 0), layer = active.layers.add(copy);
    layer.startTime = active.time; layer.outPoint = Math.min(active.duration, layer.startTime + copy.duration);
    for (i = 1; i <= active.numLayers; i++) { active.layer(i).selected = false; }
    layer.selected = true; active.openInViewer();
    return { action: 'insert', comp: copy.name, destination: active.name, layer: layer.name, clonedComps: made.length,
             note: 'Nested comps are independent. Replace A/B or media inside this instance folder. Fonts and footage remain shared dependencies.' };
}
