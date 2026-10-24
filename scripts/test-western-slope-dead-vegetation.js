'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('docs/game.js', 'utf8'); // Executes the shipped render dispatch and harvesting decisions.
const dispatch = source.slice(source.indexOf('              const isDeadTree ='), source.indexOf('              if (isDeadTree || isCrownedPine || isShadewood)'));
const names = ['buildDeadTreeMesh', 'buildDeadBushMesh', 'buildCrownedPineMesh', 'buildShadewoodMesh', 'buildWildernessBushMesh', 'buildStumpMesh', 'buildShrubMesh']; // Builder stubs identify which actual branch ran.
const FoliageGenerator = Object.fromEntries(names.map(name => [name, () => name]));
const render = new Function('window', 'mapId', 'tile', 'EXTERIOR_ZONES', 'c', 'r', dispatch + '; return vegGroup;'); // Runtime dispatch, not a copy of its logic.
for (const kind of ['copse', null, undefined]) assert.equal(render({ FoliageGenerator }, 'map_western_slope', { floraKind: kind }, {}, 2, 3), 'buildDeadTreeMesh');
for (const kind of ['bush', 'fruitBush', 'mushroomPatch', 'beehive']) assert.equal(render({ FoliageGenerator }, 'map_western_slope', { floraKind: kind }, {}, 2, 3), 'buildDeadBushMesh');
assert.equal(render({ FoliageGenerator }, 'map_northern_cliffs', { floraKind: 'copse' }, {}, 2, 3), 'buildCrownedPineMesh');
assert.equal(render({ FoliageGenerator }, 'map_southern_cloud_forest', { floraKind: 'copse' }, { map_southern_cloud_forest: { cloudForest: true } }, 2, 3), 'buildShadewoodMesh');
const harvest = source.slice(source.indexOf('      function isChoppableTreeTile('), source.indexOf('      // A generator-placed ore rock')); // Original hold gating and inventory reward key.
const grid = [[{ type: 'shrub', floraKind: 'copse' }]]; // A saved generated slope tree.
const canChop = new Function('window', 'currentArea', 'TileType', harvest + '; return [isChoppableTreeTile(0,0), treeLogItemKey()];');
assert.deepEqual(canChop({ GridTileAccessors: { getActiveGrid: () => grid } }, 'map_western_slope', { SHRUB: 'shrub' }), [true, 'pineLog']);
grid[0][0].floraKind = 'bush';
assert.equal(canChop({ GridTileAccessors: { getActiveGrid: () => grid } }, 'map_western_slope', { SHRUB: 'shrub' })[0], false);
new vm.Script(fs.readFileSync('docs/js/foliage-generator.js', 'utf8')); // Includes the actual leafless geometry branch in syntax validation.
console.log('Western Slope saved vegetation dispatch, tree hold gating and compatible pine log rewards passed.');

// Run the actual axe reward branch, then the actual daily regrowth owner.
const tile = { type: 'shrub', floraKind: 'copse' }; // Saved slope copse metadata must survive felling and regrowth.
const persisted = new Map(); // Exact per-zone felling history saved by gameplay.
const inventory = { pineLog: 0, mulch: 0 }; // These are the existing any-wood inventory keys.
let removedTrees = 0; // Visual side effects must remove one tree without an immediate whole-zone rebuild.
const choppingWindow = { GridTileAccessors: { getActiveGrid: () => [[tile]] }, InventoryStacks: { MAX_TOTAL: 999 }, HobunjiFoodProcessing: { rollTreeNutDrop: () => null } };
const runtime = vm.createContext({ window: choppingWindow, currentArea: 'map_western_slope', TileType: { SHRUB: 'shrub', GRASS: 'grass' }, CropType: { NONE: null },
  col: 0, row: 0, tool: 'axe', action: 'chop', tile, inventory, calendar: { day: 3 }, rnd: () => 0,
  ITEM_DEFS: { pineLog: { label: 'Pine Log' } }, _zoneFelledTreePersist: persisted,
  removeZoneVegetationVisual() { removedTrees++; return true; }, awardToolUseMasteryXp() {},
}); // Only existing game services are mocked; the harvest code is executed directly.
vm.runInContext(harvest, runtime);
const chopStart = source.indexOf("        if (tool === 'axe' && action === 'chop' && isChoppableTreeTile(col, row)) {");
const chopEnd = source.indexOf("        if (tool === 'pick' && action === 'mine' && isMineableRockTile(col, row)) {", chopStart);
const result = vm.runInContext('(function(){' + source.slice(chopStart, chopEnd) + '})()', runtime); // Actual applied inventory and persistence output, rather than only the reward-key selector.
assert.equal(result.ok, true);
assert.equal(inventory.pineLog, 2);
assert.equal(inventory.mulch, 1);
assert.equal(tile.type, 'grass');
assert.equal(tile.floraKind, 'copse');
assert.equal(persisted.get('map_western_slope')[0].feltDay, 3);
assert.equal(removedTrees, 1);
vm.runInContext(fs.readFileSync('docs/js/zone-regrowth.js', 'utf8'), runtime);
choppingWindow.ZoneRegrowth.init({ _zoneFelledTreePersist: persisted, _zoneScenes: new Map([['map_western_slope', { grid: [[tile]] }]]),
  calendar: { day: 10 }, TREE_REGROWTH_DAYS: 7, TileType: { SHRUB: 'shrub' }, getCurrentArea: () => 'town',
}); // Offscreen regrowth still updates the stored grid; later scene dispatch uses the untouched copse metadata.
choppingWindow.ZoneRegrowth.tickFelledTreeRegrowth();
assert.equal(tile.type, 'shrub');
assert.equal(tile.floraKind, 'copse');
assert.equal(persisted.has('map_western_slope'), false);
assert.equal(render({ FoliageGenerator }, 'map_western_slope', tile, {}, 0, 0), 'buildDeadTreeMesh');
console.log('Western Slope actual axe yields, felling persistence and offscreen regrowth passed.');
