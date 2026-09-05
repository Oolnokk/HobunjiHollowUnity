#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

const presentation = source('docs/js/crop-billboard-presentation.js'); // Used to pin shared farm-crop soil anchoring and clustered billboard grounding.
const loader = source('docs/js/combat/combat-config-loader.js'); // Used to ensure the presentation wrapper installs after crop sprite/heftroot bridges.
const game = source('docs/game.js'); // Used to pin the exact water lift this presentation cancels.
const cropRendering = source('docs/js/vegetation-crop-rendering.js'); // Crop draw positioning now lives here rather than inline in game.js.

assert.match(game, /const WATER_UNIT = SLAB_H \/ MAX_WATER/,
  'game.js still computes crop water lift from the shared water-depth conversion');
assert.match(cropRendering, /const surfY\s*= deps\.tileSurfaceY\(tile\.type\) \+ tile\.water \* deps\.WATER_UNIT/,
  'crop rendering still supplies water-raised crop positions that the presentation layer must counter at draw time');
assert.match(presentation, /const WATER_UNIT = 0\.5 \/ 3\.0/,
  'presentation mirrors the current 0.5/3 water-depth-to-world-Y conversion');
assert.match(presentation, /waterLift = waterDepth \* WATER_UNIT/,
  'live tile water depth is converted into the exact crop Y correction');
assert.match(presentation, /root\.position\.y -= waterLift \+ centerLift/,
  'crop roots are lowered back to soil rather than riding on the water surface');
assert.match(presentation, /hobunjiCropRootKey \|\| object\?\.userData\?\.hobunjiCropSpriteKey/,
  'the shared soil correction discovers procedural, clustered, and generic crop-root tags');
assert.match(presentation, /cropKey === 'garlink' \|\| cropKey === 'ongyums'/,
  'only converted garlink/ongyums clusters also remove the old generic cube center lift');
assert.match(presentation, /root\.userData\?\.hobunjiCropClusterCount === 3/,
  'cube-center correction waits until garlink/ongyums have actually converted into three-member billboard clusters');
assert.doesNotMatch(presentation, /root\.scale\.set|mesh\.scale\.set/,
  'the presentation layer no longer shrinks the whole crop root; individual cluster members own their requested size');
assert.match(presentation, /try \{[\s\S]*?previousRender\.call[\s\S]*?finally \{[\s\S]*?restoreTransforms/,
  'temporary soil anchoring is restored after rendering so crop simulation remains owned by game.js');

const artIndex = loader.indexOf('crop-sprite-art.js?v=20260814a');
const heftrootIndex = loader.indexOf('heftroot-billboard-bridge.js');
const presentationIndex = loader.indexOf('crop-billboard-presentation.js?v=20260814a');
assert.ok(artIndex >= 0 && heftrootIndex > artIndex && presentationIndex > heftrootIndex,
  'shared crop presentation loads after both authored crop conversion bridges');

console.log('crop soil-anchor presentation tests passed');
