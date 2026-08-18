'use strict';
const assert = require('assert');
const Trees = require('../docs/js/tree-asset-library.js');

assert.equal(Trees.SCHEMA, 'hobunji_tree_assets.v1');
assert.equal(Trees.BASE_PATH, 'assets/models/trees/');
assert.equal(Trees.MODE_KEY, 'hobunji_tree_asset_mode_v1');
assert.deepStrictEqual(Trees.MODES, ['baked', 'procedural']);
assert.equal(Trees.ASSETS.length, 6, 'exactly six baked full-size tree variants are expected');

const expected = [
  'crowned_pine_01.glb',
  'crowned_pine_02.glb',
  'crowned_pine_03.glb',
  'shadewood_01.glb',
  'shadewood_02.glb',
  'shadewood_03.glb',
];
assert.deepStrictEqual(Trees.ASSETS.map(x => x.filename), expected);
assert.equal(new Set(expected).size, 6, 'filenames must remain unique');
assert.equal(Trees.entriesFor('crowned_pine').length, 3);
assert.equal(Trees.entriesFor('shadewood').length, 3);
assert.equal(Trees.entryFor('crowned_pine', 0).filename, 'crowned_pine_01.glb');
assert.equal(Trees.entryFor('crowned_pine', 3).filename, 'crowned_pine_01.glb', 'variant lookup must wrap exactly like the procedural getter');
assert.equal(Trees.entryFor('shadewood', -1).filename, 'shadewood_03.glb');
assert.equal(Trees.urlFor('shadewood', 1), 'assets/models/trees/shadewood_02.glb');

const index = Trees.makeIndex();
assert.equal(index.schema, Trees.SCHEMA);
assert.equal(index.basePath, Trees.BASE_PATH);
assert.deepStrictEqual(index.assets.map(x => x.filename), expected, 'ZIP index and runtime manifest must use identical names');
assert.deepStrictEqual(index.assets.map(x => x.seed), [1,2,3,1,2,3]);
assert.deepStrictEqual(index.assets.map(x => x.builder), [
  'buildCrownedPineMesh','buildCrownedPineMesh','buildCrownedPineMesh',
  'buildShadewoodMesh','buildShadewoodMesh','buildShadewoodMesh',
]);

Trees.setMode('procedural');
assert.equal(Trees.getMode(), 'procedural', 'tree source mode should switch to procedural without needing GLTFLoader');
const proceduralPine = [{id:'p0'},{id:'p1'},{id:'p2'}];
const proceduralShade = [{id:'s0'},{id:'s1'},{id:'s2'}];
const foliage = {
  getCrownedPineVariant: i => proceduralPine[((i % 3) + 3) % 3],
  getShadewoodVariant: i => proceduralShade[((i % 3) + 3) % 3],
};
assert.equal(Trees.install(foliage), true, 'adapter should install against the two existing variant getters');
assert.strictEqual(foliage.getCrownedPineVariant(1), proceduralPine[1], 'procedural mode must preserve original pine getter');
assert.strictEqual(foliage.getShadewoodVariant(2), proceduralShade[2], 'procedural mode must preserve original shadewood getter');
assert.equal(Trees.status().mode, 'procedural');

console.log(`PASS tree assets: ${Trees.ASSETS.length} stable GLB names, mode toggle contract, manifest parity, and procedural getter preservation.`);