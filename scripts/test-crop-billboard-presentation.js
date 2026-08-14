#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

const presentation = source('docs/js/crop-billboard-presentation.js'); // Used to pin planted garlink/ongyums presentation-only transforms.
const loader = source('docs/js/combat/combat-config-loader.js'); // Used to ensure the presentation wrapper installs after crop-sprite-art.

assert.match(presentation, /const PRESENTATION_SCALE = 0\.5/,
  'new planted crop billboards render at half their previous size');
assert.match(presentation, /key === 'garlink' \|\| key === 'ongyums'/,
  'only garlink and ongyums world billboards receive the new planted transform');
assert.match(presentation, /mesh\.position\.y -= gameScale \* 0\.5 \+ SURFACE_EPSILON/,
  'billboard center is moved from the old cube center down to the soil surface');
assert.match(presentation, /mesh\.scale\.set\([\s\S]*?PRESENTATION_SCALE/,
  'billboard presentation halves the game-owned growth scale before draw');
assert.match(presentation, /try \{[\s\S]*?previousRender\.call[\s\S]*?finally \{[\s\S]*?restoreTransforms/,
  'presentation transforms are restored after rendering so crop simulation remains owned by game.js');

const artIndex = loader.indexOf('crop-sprite-art.js?v=20260814a');
const presentationIndex = loader.indexOf('crop-billboard-presentation.js?v=20260814a');
const metadataIndex = loader.indexOf('inventory-action-metadata-bridge.js');
assert.ok(artIndex >= 0 && presentationIndex > artIndex && metadataIndex > presentationIndex,
  'billboard presentation loads after crop conversion and before unrelated held-item metadata');

console.log('crop billboard presentation tests passed');
