#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict'); // Used for focused crop-art regression assertions.
const fs = require('node:fs'); // Used to load the runtime module and current integration source directly from the repository checkout.
const path = require('node:path'); // Used to resolve repository-relative source paths from this test file.
const vm = require('node:vm'); // Used to exercise the future CookingSystem hook without requiring a browser or Three.js renderer.

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

const cropArtSource = source('docs/js/crop-sprite-art.js'); // Used to validate both static world-routing policy and executable item-art integration.
const loaderSource = source('docs/js/combat/combat-config-loader.js'); // Used to ensure crop art initializes before inventory metadata synchronization.
const gameSource = source('docs/game.js'); // Used to pin the existing foliage/placeholder crop ownership that must remain untouched.

assert.match(gameSource, /const FOLIAGE_CROPS = new Set\(\['needlegrain', 'heftroot'\]\);/,
  'needlegrain and heftroot remain owned by the foliage renderer lifecycle');
assert.match(gameSource, /Simple colored cube \(all other crops\)/,
  'non-foliage crops still expose the generic placeholder path that crop-sprite-art upgrades or tags');
assert.match(cropArtSource, /garlink:\s*Object\.freeze\(\{ spriteIcon: 'garlink_bunch\.png', worldMode: 'billboard' \}\)/,
  'garlink uses its PNG for held/icon art and world billboard clusters');
assert.match(cropArtSource, /ongyums:\s*Object\.freeze\(\{ spriteIcon: 'ongyum\.png', worldMode: 'billboard' \}\)/,
  'ongyums uses the authored PNG for held/icon art and world billboard clusters');
assert.match(cropArtSource, /CLUSTER_OFFSETS = Object\.freeze\([\s\S]*?-0\.20[\s\S]*?0\.22[\s\S]*?-0\.22/,
  'garlink/ongyums reuse the legacy three-heftroot triangle footprint');
assert.match(cropArtSource, /CLUSTER_PLANT_SCALE = 0\.25/,
  'each garlink/ongyums cluster member is half the size of the former 0.5-scale single billboard');
assert.match(cropArtSource, /hobunjiCropClusterCount = CLUSTER_OFFSETS\.length/,
  'converted crop anchors expose the three-member cluster count');
assert.match(cropArtSource, /for \(let index = 0; index < CLUSTER_OFFSETS\.length; index\+\+\)[\s\S]*?mesh\.add\(makeClusterPlant/,
  'each converted garlink/ongyums tile receives all three visible plant planes');
assert.match(cropArtSource, /new window\.THREE\.BufferGeometry\(\)/,
  'the former generic cube becomes a non-rendering transform anchor rather than a fourth visible plant');
assert.match(cropArtSource, /plant\.quaternion\.copy\(camera\.quaternion\)/,
  'every cluster member faces the active camera at the render boundary');
assert.match(cropArtSource, /hobunjiCropRootKey = cropKey/,
  'generic crop roots are tagged for the shared flood/soil presentation correction');
assert.match(cropArtSource, /buildNeedlegrainMesh = function taggedNeedlegrainMesh/,
  'procedural needlegrain receives only a root tag so flood anchoring can include it without replacing its geometry');

const cropModuleIndex = loaderSource.indexOf('crop-sprite-art.js?v=20260814a'); // Used to confirm crop item metadata is installed before generic inventory metadata synchronization.
const inventoryMetadataIndex = loaderSource.indexOf('inventory-action-metadata-bridge.js'); // Used as the ordering boundary for selectable item metadata synchronization.
assert.ok(cropModuleIndex >= 0 && inventoryMetadataIndex > cropModuleIndex,
  'crop sprite art loads before inventory action metadata synchronization');

const sandboxWindow = {}; // Used as a browser-global stand-in for testing late CookingSystem assignment and init wrapping.
vm.runInNewContext(cropArtSource, { window: sandboxWindow });
const artApi = sandboxWindow.HobunjiCropSpriteArt; // Used to inspect the public crop-art mapping and invoke item metadata synchronization.
assert.ok(artApi, 'crop sprite art exposes its runtime API');
assert.deepEqual({ ...artApi.getArt('needlegrain') }, { spriteIcon: 'pile_needlegrain.png', worldMode: 'procedural' });
assert.deepEqual({ ...artApi.getArt('heftroot') }, { spriteIcon: 'heftroot.png', worldMode: 'procedural' });
assert.deepEqual({ ...artApi.getArt('garlink') }, { spriteIcon: 'garlink_bunch.png', worldMode: 'billboard' });
assert.deepEqual({ ...artApi.getArt('ongyums') }, { spriteIcon: 'ongyum.png', worldMode: 'billboard' });

const fakeDefs = {
  needlegrain: { icon: '🌾' },
  heftroot: { icon: '🟡' },
  garlink: { icon: '🧄' },
  ongyums: { icon: '🧅' },
};
const fakeEntries = Object.keys(fakeDefs).map(key => ({ key, icon: fakeDefs[key].icon }));
const fakeCookingSystem = { init(deps) { return deps; } };
sandboxWindow.CookingSystem = fakeCookingSystem;
sandboxWindow.CookingSystem.init({ ITEM_DEFS: fakeDefs, inventoryItems: fakeEntries });

for (const cropKey of Object.keys(fakeDefs)) {
  const art = artApi.getArt(cropKey);
  assert.equal(fakeDefs[cropKey].spriteIcon, art.spriteIcon, `${cropKey} canonical definition receives authored spriteIcon`);
  assert.equal(fakeDefs[cropKey].spriteMode, 'direct', `${cropKey} canonical definition uses direct PNG color`);
  const entry = fakeEntries.find(item => item.key === cropKey);
  assert.equal(entry.spriteIcon, art.spriteIcon, `${cropKey} selectable entry receives authored spriteIcon`);
  assert.equal(entry.spriteMode, 'direct', `${cropKey} selectable entry uses direct PNG color`);
}

assert.equal(artApi.getDebug().patchedDefs, 4, 'all four canonical crop definitions were patched');
assert.equal(artApi.getDebug().patchedEntries, 4, 'all four selectable crop entries were patched');
assert.equal(artApi.getDebug().clusterCount, 3, 'world crop cluster diagnostics report three members');
assert.equal(artApi.getDebug().clusterPlantScale, 0.25, 'world crop cluster diagnostics report the requested reduced scale');
console.log('authored crop sprite art tests passed');
