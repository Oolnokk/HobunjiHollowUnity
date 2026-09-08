#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const portraitSource = fs.readFileSync('docs/js/portrait-utils.js', 'utf8'); // Guards the torso-only untinted grayscale path in the canonical renderer.

assert.equal(
  (portraitSource.match(/if \(options\.preserveZeroSaturation && isEffectivelyZeroSaturation\(r, g, b\)\) continue;/g) || []).length,
  2,
  'both portrait tint algorithms must preserve source pixels with effectively zero saturation',
);
assert.match(
  portraitSource,
  /return Math\.max\(r, g, b\) - Math\.min\(r, g, b\) <= 1;/,
  'zero-saturation detection must include the one-byte channel variance in authored #4D4E4D pixels',
);
assert.match(
  portraitSource,
  /if \(target === baseTorsoLayers && layerTint\?\.mode !== 'none'\) \{[\s\S]{0,220}preserveZeroSaturation: true/,
  'zero-saturation preservation must be enabled while the base torso layer list is assembled',
);
assert.doesNotMatch(
  portraitSource,
  /target === base(?:Left|Right)ArmLayers[\s\S]{0,160}preserveZeroSaturation: true/,
  'arm layers must retain the ordinary body tint behavior',
);
assert.equal(
  (portraitSource.match(/options\.preserveNearBlackOutlines, options\.outlineThreshold, options\.preserveZeroSaturation/g) || []).length,
  2,
  'both tint caches must distinguish torso-preserving canvases from normally tinted canvases',
);

console.log('Portrait torso grayscale preservation tests passed.');
