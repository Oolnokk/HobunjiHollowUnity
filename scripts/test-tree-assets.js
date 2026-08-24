'use strict';
const assert = require('assert');
const Trees = require('../docs/js/tree-asset-library.js');

assert.equal(Trees.SCHEMA, 'hobunji_tree_assets.v1');
assert.equal(Trees.BASE_PATH, 'assets/models/trees/');
assert.equal(Trees.MODE_KEY, 'hobunji_tree_asset_mode_v1');
assert.deepStrictEqual(Trees.MODES, ['baked', 'procedural']);
assert.equal(Trees.LOD_SWITCH_DISTANCE, 7.5);
assert.equal(Trees.ASSETS.length, 6, 'exactly six baked full-size tree variants are expected');

const expected = [
  'crowned_pine_01.glb',
  'crowned_pine_02.glb',
  'crowned_pine_03.glb',
  'shadewood_01.glb',
  'shadewood_02.glb',
  'shadewood_03.glb',
];
const expectedLods = expected.map(name => name.replace(/\.glb$/, '_lod-decimate-90.glb'));
assert.deepStrictEqual(Trees.ASSETS.map(x => x.filename), expected);
assert.deepStrictEqual(Trees.ASSETS.map(x => x.lodFilename), expectedLods);
assert.equal(new Set(expected).size, 6, 'filenames must remain unique');
assert.equal(new Set(expectedLods).size, 6, 'LOD filenames must remain unique');
assert.equal(Trees.entriesFor('crowned_pine').length, 3);
assert.equal(Trees.entriesFor('shadewood').length, 3);
assert.equal(Trees.entryFor('crowned_pine', 0).filename, 'crowned_pine_01.glb');
assert.equal(Trees.entryFor('crowned_pine', 3).filename, 'crowned_pine_01.glb', 'variant lookup must wrap');
assert.equal(Trees.entryFor('shadewood', -1).filename, 'shadewood_03.glb');
assert.equal(Trees.urlFor('shadewood', 1), 'assets/models/trees/shadewood_02.glb');
assert.equal(Trees.lodUrlFor('shadewood', 1), 'assets/models/trees/shadewood_02_lod-decimate-90.glb');
assert.strictEqual(Trees.entryForCoordinates('shadewood', 4, 7), Trees.entryForCoordinates('shadewood', 4, 7), 'coordinate variant selection must be deterministic');

const index = Trees.makeIndex();
assert.equal(index.schema, Trees.SCHEMA);
assert.equal(index.basePath, Trees.BASE_PATH);
assert.equal(index.lodSwitchDistance, Trees.LOD_SWITCH_DISTANCE);
assert.deepStrictEqual(index.assets.map(x => x.filename), expected, 'ZIP index and runtime manifest must use identical near names');
assert.deepStrictEqual(index.assets.map(x => x.lodFilename), expectedLods, 'ZIP index must advertise the uploaded far LODs');
assert.deepStrictEqual(index.assets.map(x => x.seed), [1,2,3,1,2,3]);
assert.deepStrictEqual(index.assets.map(x => x.builder), [
  'buildCrownedPineMesh','buildCrownedPineMesh','buildCrownedPineMesh',
  'buildShadewoodMesh','buildShadewoodMesh','buildShadewoodMesh',
]);

// Current runtime integrates through the public builders. In procedural mode
// installation must be behaviorally transparent and preserve opts, which is
// also how forceClimbBranch reaches the shadewood exporter.
Trees.setMode('procedural');
const foliage = {
  buildCrownedPineMesh: (col, row, opts) => ({ kind: 'pine', col, row, opts }),
  buildShadewoodMesh: (col, row, opts) => ({ kind: 'shade', col, row, opts }),
};
assert.equal(Trees.install(foliage), true, 'adapter should install against the current tree builder API');
assert.deepStrictEqual(foliage.buildCrownedPineMesh(2, 9), { kind: 'pine', col: 2, row: 9, opts: undefined });
assert.deepStrictEqual(
  foliage.buildShadewoodMesh(3, 8, { forceClimbBranch: true }),
  { kind: 'shade', col: 3, row: 8, opts: { forceClimbBranch: true } },
  'procedural mode must preserve forceClimbBranch and all builder args',
);
const status = Trees.status();
assert.equal(status.mode, 'procedural');
assert.equal(status.installMode, 'builders');
assert.equal(status.assets.length, 6);
assert.ok(status.assets.every(asset => asset.lodUrl?.endsWith('_lod-decimate-90.glb')));

console.log(`PASS tree assets: ${Trees.ASSETS.length} near+far GLB pairs, builder adapter, deterministic selection, and procedural fallback contract.`);
