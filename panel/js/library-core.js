/* Data-only local library loading. Kept separate for filesystem/schema tests. */
'use strict';
var fs = require('fs');
var path = require('path');
function inside(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) throw new Error('Library assets need relative paths.');
  var full = path.resolve(root, relative);
  var rel = path.relative(root, full);
  if (rel === '..' || rel.indexOf('..' + path.sep) === 0 || path.isAbsolute(rel)) throw new Error('Asset escapes its library folder.');
  return full;
}
function load(file) {
  var root = path.dirname(path.resolve(file));
  var data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (data.schema !== 'ae-reusable-library/v1' || !Array.isArray(data.items)) throw new Error('Choose an AE reusable library catalog.json.');
  if (data.items.length > 2000) throw new Error('Library is too large.');
  var ids = {};
  var items = data.items.map(function (item) {
    if (!item || typeof item.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(item.id) || ids[item.id]) throw new Error('Invalid or duplicate item ID.');
    ids[item.id] = true;
    if (['scene', 'transition'].indexOf(item.category) < 0) throw new Error('Unknown library category.');
    if (typeof item.comp !== 'string' || !item.comp || typeof item.title !== 'string') throw new Error('Each item needs a title and comp.');
    if (!(item.duration > 0) || !Number.isFinite(item.duration)) throw new Error('Invalid duration.');
    var result = Object.assign({}, item);
    result.projectPath = inside(root, data.project);
    if (item.poster) result.posterPath = inside(root, item.poster);
    if (item.video) result.videoPath = inside(root, item.video);
    return result;
  });
  return { root: root, name: String(data.name || 'Scene library'), items: items, file: path.resolve(file) };
}
function filter(items, category, query) {
  query = String(query || '').trim().toLowerCase();
  return items.filter(function (i) {
    return (!category || i.category === category) && (!query || [i.id, i.title, i.comp, i.source, i.description, (i.tags || []).join(' ')].join(' ').toLowerCase().indexOf(query) >= 0);
  });
}
module.exports = { load: load, filter: filter, inside: inside };
