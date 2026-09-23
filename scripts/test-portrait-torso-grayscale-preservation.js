#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = path => fs.readFileSync(path, 'utf8');
const portraitSource = read('docs/js/portrait-utils.js'); // Guards torso preservation while proving portrait pixels use the shared ColorFill owner.
const colorFillSource = read('docs/js/color-fill.js'); // Canonical raster color-fill implementation.
const gameIndex = read('docs/index.html'); // Guards gameplay dependency order.
const standalonePages = [
  'docs/tools/portrait-arm-mask/index.html',
  'docs/tools/map-editor/index.html',
  'docs/tools/world-popup-editor/index.html',
  'docs/tools/character-studio/index.html',
  'docs/tools/cutscene-director/index.html',
  'docs/tools/wilderness-generation-lab/index.html',
  'docs/tools/attack-animation-editor/index.html',
]; // Editors that load portrait-utils directly must explicitly load ColorFill first.

assert.match(
  portraitSource,
  /shared\.hsvValueFillPixels\(data, shared\.hsvToRgb\(tint\.hue, tint\.sat, 1\)/,
  'legacy hue/saturation portrait fill delegates raster mutation to ColorFill',
);
assert.match(
  portraitSource,
  /colorFillApi\(\)\.shadeFillPixels\(data, \[tr, tg, tb\]/,
  'default body/clothing shade fill delegates raster mutation to ColorFill',
);
assert.match(
  portraitSource,
  /function bodyTintModeForSpecies\(_speciesId\) \{[\s\S]{0,80}return 'shadeFill';/,
  'body colors always use the shared flat-cel shadow-map fill',
);
assert.match(
  portraitSource,
  /function clothingTintMode\(\) \{[\s\S]{0,80}return 'shadeFill';/,
  'clothing dyes always use the shared flat-cel shadow-map fill',
);
assert.doesNotMatch(
  portraitSource,
  /const neutral = Math\.max\(0\.0001, options\.neutralLuminance\)/,
  'portrait-utils no longer owns a fixed-neutral duplicate of the animal/weaving shade-fill loop',
);
assert.match(
  colorFillSource,
  /function createShadeReference\(sourceData, predicate = null, options = \{\}\)/,
  'flat-cel source/shadow reference lives in the shared ColorFill module',
);
assert.match(
  portraitSource,
  /options\.preserveZeroSaturation && isEffectivelyZeroSaturation\(r, g, b\)\) return false;/,
  'hue/saturation fill keeps torso-authored near-gray pixels out of the shared apply mask',
);
assert.match(
  portraitSource,
  /return !\(options\.preserveZeroSaturation && isEffectivelyZeroSaturation\(data\[i\], data\[i \+ 1\], data\[i \+ 2\]\)\);/,
  'shade fill keeps torso-authored near-gray pixels out of both shared sample and apply masks',
);
assert.match(
  portraitSource,
  /return Math\.max\(r, g, b\) - Math\.min\(r, g, b\) <= 1;/,
  'zero-saturation detection includes the one-byte channel variance in authored #4D4E4D pixels',
);
assert.match(
  portraitSource,
  /if \(target === baseTorsoLayers && layerTint\?\.mode !== 'none'\) \{[\s\S]{0,220}preserveZeroSaturation: true/,
  'zero-saturation preservation remains enabled while the base torso layer list is assembled',
);
assert.doesNotMatch(
  portraitSource,
  /target === base(?:Left|Right)ArmLayers[\s\S]{0,160}preserveZeroSaturation: true/,
  'arm layers retain ordinary body tint behavior',
);
assert.equal(
  (portraitSource.match(/options\.preserveNearBlackOutlines, options\.outlineThreshold, options\.preserveZeroSaturation/g) || []).length,
  1,
  'legacy hue/saturation cache still distinguishes torso-preserving canvases',
);
assert.match(
  portraitSource,
  /colorFillApi\(\)\.version, options\.preserveZeroSaturation/,
  'shade-fill cache keys on the shared ColorFill version plus torso grayscale preservation',
);
assert.ok(
  gameIndex.indexOf('js/color-fill.js') >= 0
    && gameIndex.indexOf('js/color-fill.js') < gameIndex.indexOf('js/portrait-utils.js'),
  'gameplay loads ColorFill before portrait-utils',
);
for (const pagePath of standalonePages) {
  const page = read(pagePath);
  assert.ok(
    page.indexOf('color-fill.js') >= 0 && page.indexOf('color-fill.js') < page.indexOf('portrait-utils.js'),
    pagePath + ' loads ColorFill before portrait-utils',
  );
}
const localePreview = read('docs/tools/locale-editor/locale-preview3d.js');
assert.ok(
  localePreview.indexOf("loadScript('../../js/color-fill.js") < localePreview.indexOf("loadScript('../../js/portrait-utils.js"),
  'locale preview dynamically loads ColorFill before portrait-utils',
);

console.log('Portrait torso preservation + shared ColorFill integration tests passed.');
