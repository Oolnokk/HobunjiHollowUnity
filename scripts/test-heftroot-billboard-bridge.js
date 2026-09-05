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
const cropRendering = source('docs/js/vegetation-crop-rendering.js'); // Crop draw code now lives here rather than inline in game.js -- still owns the heftroot cluster/growth lifecycle.
const loader = source('docs/js/combat/combat-config-loader.js'); // Used to pin parser-blocking bridge order before game.js constructs crops.

assert.match(foliage, /buildNeedlegrainMesh\(growth01, col, row\)/,
  'needlegrain keeps its independent procedural foliage builder');
assert.match(foliage, /buildHeftrootMesh\(growth01, col, row\)/,
  'heftroot still exposes the builder seam replaced by the billboard bridge');
assert.match(cropRendering, /crop === 'needlegrain'[\s\S]*?FG\.buildNeedlegrainMesh/,
  'needlegrain continues through its procedural builder');
assert.match(cropRendering, /crop === 'heftroot'[\s\S]*?FG\.buildHeftrootMesh/,
  'heftroot continues through the normal crop lifecycle while its visual builder is replaceable');
assert.match(cropRendering, /offsets = \[\[-0\.20, 0, 0\.14\], \[0\.22, 0, 0\.14\], \[0\.0, 0, -0\.22\]\]/,
  'the legacy three-plant heftroot wrapper still owns its existing triangle offsets');

assert.match(bridge, /BILLBOARD_PATH = 'assets\/objectsprites\/heftroot\.png'/,
  'planted heftroot uses the authored heftroot PNG');
assert.match(bridge, /BILLBOARD_SCALE = 0\.5625/,
  'each clustered heftroot is 25% smaller than the previous 0.75-scale billboard');
assert.match(bridge, /plane\.scale\.set\(authoredAspect \* BILLBOARD_SCALE, BILLBOARD_SCALE, BILLBOARD_SCALE\)/,
  'initial heftroot billboard scale preserves aspect while applying the new reduction');
assert.match(bridge, /plane\.scale\.x = authoredAspect \* BILLBOARD_SCALE[\s\S]*?plane\.scale\.y = BILLBOARD_SCALE/,
  'async texture aspect updates preserve the same reduced world scale');
assert.match(bridge, /foliage\.buildHeftrootMesh = function authoredHeftrootBillboardMesh[\s\S]*?return buildHeftrootBillboard\(\)/,
  'all three legacy builder calls now produce visible PNG members');
assert.doesNotMatch(bridge, /isSyntheticClusterSeed/,
  'the synthetic seed calls are no longer suppressed because they now supply cluster members two and three');
assert.match(bridge, /plane\.position\.set\(0, 0, 0\)/,
  'the PNG stays at each legacy wrapper member origin instead of cancelling the first offset back to tile center');
assert.match(bridge, /clusterCount: 3/,
  'heftroot diagnostics expose the three-plant cluster count');
assert.match(bridge, /hobunjiCropRootKey = 'heftroot'/,
  'heftroot billboard members are tagged for shared soil/flood anchoring');
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
