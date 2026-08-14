#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict'); // Used for focused heftroot billboard regression assertions.
const fs = require('node:fs'); // Used to read the current runtime integration sources from a repository checkout.
const path = require('node:path'); // Used to resolve repository-relative paths from this script.

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

const bridge = source('docs/js/heftroot-billboard-bridge.js'); // Used to pin the 3D->PNG replacement behavior without coupling to unrelated crop art.
const foliage = source('docs/js/foliage-generator.js'); // Used to prove needlegrain/heftroot still enter through separate public builders.
const game = source('docs/game.js'); // Used to prove game.js still owns the existing heftroot cluster/growth lifecycle.
const loader = source('docs/js/combat/combat-config-loader.js'); // Used to pin parser-blocking bridge order before game.js constructs crops.

assert.match(foliage, /buildNeedlegrainMesh\(growth01, col, row\)/,
  'needlegrain keeps its independent procedural foliage builder');
assert.match(foliage, /buildHeftrootMesh\(growth01, col, row\)/,
  'heftroot still exposes the builder seam replaced by the billboard bridge');
assert.match(game, /crop === 'needlegrain'[\s\S]*?FG\.buildNeedlegrainMesh/,
  'needlegrain continues through its procedural builder in game.js');
assert.match(game, /crop === 'heftroot'[\s\S]*?FG\.buildHeftrootMesh/,
  'heftroot continues through the normal crop lifecycle while its visual builder is replaceable');
assert.match(game, /offsets = \[\[-0\.20, 0, 0\.14\], \[0\.22, 0, 0\.14\], \[0\.0, 0, -0\.22\]\]/,
  'the legacy three-plant heftroot wrapper still owns its existing offsets');

assert.match(bridge, /BILLBOARD_PATH = 'assets\/objectsprites\/heftroot\.png'/,
  'planted heftroot uses the authored heftroot PNG');
assert.match(bridge, /BILLBOARD_SCALE = 0\.75/,
  'planted heftroot renders at 75% of its previous billboard size');
assert.match(bridge, /plane\.scale\.set\(authoredAspect \* BILLBOARD_SCALE, BILLBOARD_SCALE, BILLBOARD_SCALE\)/,
  'initial heftroot billboard scale preserves aspect while applying the 75% reduction');
assert.match(bridge, /plane\.scale\.x = authoredAspect \* BILLBOARD_SCALE[\s\S]*?plane\.scale\.y = BILLBOARD_SCALE/,
  'async texture aspect updates preserve the same 75% world scale');
assert.match(bridge, /foliage\.buildHeftrootMesh = function authoredHeftrootBillboardMesh/,
  'the bridge replaces only the public heftroot mesh factory');
assert.doesNotMatch(bridge, /buildNeedlegrainMesh\s*=/,
  'the bridge never replaces needlegrain foliage');
assert.match(bridge, /new THREE\.PlaneGeometry\(1, 1\)/,
  'heftroot world geometry is a 2D plane instead of procedural tuber geometry');
assert.match(bridge, /isSyntheticClusterSeed\(col, row\)[\s\S]*?return new THREE\.Group\(\)/,
  'the two RNG-only legacy cluster calls return empty groups instead of duplicate heftroot PNGs');
assert.match(bridge, /plane\.position\.set\(-PRIMARY_OFFSET_X, 0, -PRIMARY_OFFSET_Z\)/,
  'the single visible billboard cancels the legacy first-cluster offset and lands at tile center');
assert.match(bridge, /hobunjiCropSpriteKey = 'heftroot'/,
  'heftroot billboard planes are explicitly tagged for diagnostics/presentation');
assert.match(bridge, /parentWorldQ\)\.invert\(\)\.multiply\(cameraWorldQ\)/,
  'heftroot planes remain true camera-facing billboards even under ripe-crop parent rotation');
assert.match(bridge, /root !== scene/,
  'harvested/rebuilt heftroot billboards are removed from the render-facing set');

const artIndex = loader.indexOf('crop-sprite-art.js'); // Used to keep shared authored crop item art initialized first.
const heftrootIndex = loader.indexOf('heftroot-billboard-bridge.js'); // Used to ensure the builder is swapped before game.js initializes crop meshes.
const presentationIndex = loader.indexOf('crop-billboard-presentation.js'); // Used as the next crop-specific render integration boundary.
assert.ok(artIndex >= 0 && heftrootIndex > artIndex && presentationIndex > heftrootIndex,
  'heftroot billboard bridge loads after shared crop art and before crop presentation');

console.log('heftroot billboard bridge tests passed');
