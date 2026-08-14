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
const gameSource = source('docs/game.js'); // Used to pin the existing procedural-foliage ownership that must remain untouched.

assert.match(gameSource, /const FOLIAGE_CROPS = new Set\(\['needlegrain', 'heftroot'\]\);/,
  'needlegrain and heftroot remain owned by the proper procedural foliage renderer');
assert.match(gameSource, /Simple colored cube \(all other crops\)/,
  'non-foliage crops still expose the generic placeholder path that crop-sprite-art upgrades');
assert.match(cropArtSource, /garlink:\s*Object\.freeze\(\{ spriteIcon: 'garlink_bunch\.png', worldMode: 'billboard' \}\)/,
  'garlink uses the new PNG for held/icon art and replaces its placeholder crop cube with a billboard');
assert.match(cropArtSource, /ongyums:\s*Object\.freeze\(\{ spriteIcon: 'ongyum\.png', worldMode: 'billboard' \}\)/,
  'ongyums uses the authored singular-filename PNG and replaces its placeholder crop cube with a billboard');
assert.match(cropArtSource, /needlegrain:\s*Object\.freeze\(\{ spriteIcon: 'pile_needlegrain\.png', worldMode: 'procedural' \}\)/,
  'needlegrain keeps procedural world foliage while adopting the new item/held PNG');
assert.match(cropArtSource, /heftroot:\s*Object\.freeze\(\{ spriteIcon: 'heftroot\.png', worldMode: 'procedural' \}\)/,
  'heftroot keeps procedural world foliage while adopting the new item/held PNG');
assert.match(cropArtSource, /\[0xd8d0b0, 'garlink'\][\s\S]*?\[0xc07a3d, 'ongyums'\]/,
  'world billboard discovery is restricted to exact garlink/ongyums placeholder palettes');
assert.match(cropArtSource, /mesh\.material\?\.isMeshLambertMaterial[\s\S]*?geometry\.type !== 'BoxGeometry'/,
  'world replacement is constrained to the generic Lambert BoxGeometry placeholder shape');
assert.match(cropArtSource, /new window\.THREE\.PlaneGeometry\(aspect, 1\)/,
  'placeholder crops become true aspect-preserving billboard planes');
assert.match(cropArtSource, /mesh\.quaternion\.copy\(camera\.quaternion\)/,
  'world crop planes face the active camera at the render boundary');

const cropModuleIndex = loaderSource.indexOf('crop-sprite-art.js?v=20260814a'); // Used to confirm the crop item metadata is installed before the generic inventory metadata bridge snapshots definitions.
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

const fakeDefs = { // Used to model the four canonical crop definitions consumed by inventory icons and held-item planes.
  needlegrain: { icon: '🌾' },
  heftroot: { icon: '🟡' },
  garlink: { icon: '🧄' },
  ongyums: { icon: '🧅' },
};
const fakeEntries = Object.keys(fakeDefs).map(key => ({ key, icon: fakeDefs[key].icon })); // Used to model selectable inventory-scroll entries that should receive the same PNG metadata.
const fakeCookingSystem = { init(deps) { return deps; } }; // Used to prove the parser-blocking future-global hook patches CookingSystem once it is assigned later.
sandboxWindow.CookingSystem = fakeCookingSystem;
sandboxWindow.CookingSystem.init({ ITEM_DEFS: fakeDefs, inventoryItems: fakeEntries });

for (const cropKey of Object.keys(fakeDefs)) {
  const art = artApi.getArt(cropKey); // Used to compare canonical and selectable metadata against the single authored art table.
  assert.equal(fakeDefs[cropKey].spriteIcon, art.spriteIcon, `${cropKey} canonical definition receives authored spriteIcon`);
  assert.equal(fakeDefs[cropKey].spriteMode, 'direct', `${cropKey} canonical definition uses direct PNG color`);
  const entry = fakeEntries.find(item => item.key === cropKey); // Used to verify current item-scroll selections receive the same art immediately.
  assert.equal(entry.spriteIcon, art.spriteIcon, `${cropKey} selectable entry receives authored spriteIcon`);
  assert.equal(entry.spriteMode, 'direct', `${cropKey} selectable entry uses direct PNG color`);
}

assert.equal(artApi.getDebug().patchedDefs, 4, 'all four canonical crop definitions were patched');
assert.equal(artApi.getDebug().patchedEntries, 4, 'all four selectable crop entries were patched');
console.log('authored crop sprite art tests passed');
