'use strict';

const assert = require('assert'); // Used for source-level regression guards below.
const fs = require('fs'); // Used to read the authoritative lighting runtime/config from the repository checkout.
const path = require('path'); // Used to resolve repository-relative fixture paths portably.

const root = path.resolve(__dirname, '..'); // Used as the base for every repository file read in this regression.
const source = fs.readFileSync(path.join(root, 'docs/js/cloud-forest-fog.js'), 'utf8'); // Guards the outdoor light compositing implementation.
const config = JSON.parse(fs.readFileSync(path.join(root, 'docs/config/atmosphere-lighting.json'), 'utf8')); // Guards the authored tint-retention tuning.

assert.strictEqual(config.lantern.weatherTintRetentionAlpha, 0.2,
  'weather tint retention must stay explicitly tuneable in atmosphere-lighting.json');
assert.match(source, /function currentOutdoorWeatherTintState\(\)/,
  'outdoor lighting must keep weather coloration as a distinct signal from lantern activation');
assert.match(source, /state\?\.overcast/,
  'weather tint retention must scale from the skydome overcast state rather than the lantern darkness threshold');
assert.match(source, /function drawLanternMasksCompat\(activation = 1, preserveOutdoorWeatherTint = false\)/,
  'lantern masking must distinguish outdoor weather tint preservation from enclosed-area darkness clearing');
assert.match(source, /drawLanternMasksCompat\(1\);\s*drawFurnitureLightMasksCompat\(\);/s,
  'interiors, dens, and mines must keep the original full darkness-clearing behavior');
assert.match(source, /drawLanternMasksCompat\(currentOutdoorLanternActivation\(\), true\);\s*drawFurnitureLightMasksCompat\(true\);/s,
  'outdoor carried/watch and furniture lights must preserve the active weather tint');
assert.match(source, /globalCompositeOperation = 'destination-out'/,
  'local lights must still remove actual darkness rather than merely painting a bright halo over it');
assert.match(source, /globalCompositeOperation = 'multiply';[\s\S]*addWeatherTintStops/,
  'the removed outdoor weather coloration must be restored after the darkness punch-out');
assert.match(source, /outdoorWeatherTintRetention:/,
  'mobile-visible debug state must expose the active outdoor tint retention amount');

console.log('overcast local-light tint retention regression passed');
