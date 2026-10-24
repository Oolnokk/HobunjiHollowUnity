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
