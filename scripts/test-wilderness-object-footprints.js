const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const policy = require('../docs/js/wilderness-object-footprints.js');

const grass = () => ({ terrain: 'grass', type: 'grass' }); // Unoccupied tile factory for footprint and site-selection fixtures.
const zone = { cols: 4, rows: 3, tiles: Array.from({ length: 3 }, () => Array.from({ length: 4 }, grass)) }; // Touching yet independently identified formations.
for (const [col, row, id] of [[0,0,'A'],[1,0,'A'],[1,1,'A'],[2,0,'B']]) {
  Object.assign(zone.tiles[row][col], { type: 'rock', rockKind: 'undiggableBoulder', boulderId: id });
}
assert.equal(policy.isBoulder(zone.tiles[0][0]), true);
assert.equal(policy.isBoulder(grass()), false);
assert.deepEqual(policy.boulderCells(zone, 0, 0).sort((a,b) => a[1]-b[1] || a[0]-b[0]),
  [[0,0],[1,0],[1,1]], 'a whole connected boulder belongs to one identity, even beside another boulder');
assert.deepEqual(policy.boulderCells(zone, 2, 0), [[2,0]], 'neighboring object IDs remain separate');
assert.deepEqual(policy.boulderCells(zone, 3, 2), [], 'ordinary ground has no boulder footprint');

const maps = [
  { tiles: { '0,0': { type:'rock', generatedObjectId:'A', generatedObjectType:'undiggableBoulder' },
    '1,0': { type:'rock', generatedObjectId:'A', generatedObjectType:'undiggableBoulder' },
    '2,0': { type:'rock', generatedObjectId:'B', generatedObjectType:'undiggableBoulder' } } },
  { tiles: { '1,0': { type:'rock', generatedObjectId:'A', generatedObjectType:'undiggableBoulder', plateau:'p1' } } }
]; // Root plus a plateau submap which overlays the same generated rock.
const workspace = { maps, objects:[{id:'A'},{id:'B'}], furniture:[{generatedObjectId:'A'},{generatedObjectId:'B'}] };
const cleared = policy.clearExportedObjects(workspace, new Set(['A']));
assert.deepEqual(cleared, {objects:1, tiles:3}, 'all copies of the targeted boulder are cleared in one pass');
assert.equal(maps[0].tiles['1,0'].type, 'grass');
assert.equal(maps[0].tiles['1,0'].generatedObjectId, undefined);
assert.equal(maps[1].tiles['1,0'].type, 'grass');
assert.equal(maps[1].tiles['1,0'].plateau, 'p1', 'the underlying terrain ownership must survive');
assert.equal(maps[0].tiles['2,0'].generatedObjectId, 'B', 'unrelated rocks must remain intact');
assert.deepEqual(workspace.objects, [{id:'B'}]);
assert.deepEqual(workspace.furniture, [{generatedObjectId:'B'}]);

// Execute the actual browser temporary-locale module against a source grid
// whose visual boulder was exported without an occupiedBy object proxy.
const browser = { WildernessObjectFootprints: policy }; // Injected window namespace matches the production loader.
browser.window = browser;
vm.runInNewContext(fs.readFileSync('docs/js/temporary-locales.js', 'utf8'), browser, { filename:'temporary-locales.js' });
const ghostZone = { cols:4, rows:4, tiles: Array.from({length:4}, () => Array.from({length:4}, () => ({
  terrain:'rock', rockKind:'undiggableBoulder', boulderId:'ghost', height:0
}))), objects:[] }; // A wholly unregistered formation cannot be snapshotted and therefore must block stamping.
const locale = { id:'one-cell-camp', tiles:{'0,0':{type:'grass'}}, placement:{clearanceTiles:0,requiresFlatGround:false} };
assert.equal(browser.TemporaryLocales.findSite(ghostZone, locale, {rng:()=>0}), null,
  'an unregistered solid formation must not allow a locale to occupy it');
ghostZone.tiles[3][3] = grass();
const recovered = browser.TemporaryLocales.findSite(ghostZone, locale, {rng:()=>0});
assert.equal(recovered?.x, 3);
assert.equal(recovered?.y, 3);
console.log('wilderness generated-object footprint and collision-preservation tests passed');
