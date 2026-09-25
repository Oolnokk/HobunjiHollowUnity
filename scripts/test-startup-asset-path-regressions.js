#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const house = fs.readFileSync('docs/js/HousePieceGen.js', 'utf8');
const portrait = fs.readFileSync('docs/js/portrait-utils.js', 'utf8');
const index = fs.readFileSync('docs/index.html', 'utf8');
const mashtzarr = JSON.parse(fs.readFileSync('docs/config/species/mashtzarr.json', 'utf8')); // Used to verify non-blinking tusk overlays never generate nonexistent *_blink probes.
const mouthAssetDir = 'docs/assets/portraitsprites/expressions/mouth'; // Used to verify the shared Mashtzarr mouth set exists at the exact paths portrait-utils selects.

assert.match(house, /mesh\.userData\.housePieceFaceTag = f\.tag;/,
  'HousePieceGen must read semantic face tags from the current face object');
assert.match(house, /if \(f\.tag === 'doorOpening'\)/,
  'door-opening render handling must read the current face tag');
assert.doesNotMatch(house, /mesh\.userData\.housePieceFaceTag = tag;/,
  'HousePieceGen must not reference an undefined tag variable in _buildFaceMeshes');

assert.match(portrait, /new URL\(configuredBase, baseHref\)\.href/,
  'portrait asset base must be resolved against the actual document URL before deriving fallbacks');
assert.doesNotMatch(portrait, /Promise\.any\(uniqueCandidates/,
  'portrait loading must not race the fallback URL alongside a valid primary URL');
assert.match(portrait, /chain\.catch\(\(\) => tryLoadUrl\(url\)\)/,
  'portrait fallback should only be attempted after the primary URL fails');

assert((portrait.match(/getContext\('2d', \{ willReadFrequently: true \}\)/g) || []).length >= 5,
  'portrait tint probes, tint canvases, and final avatar canvases must request readback-optimized 2D contexts before getImageData scanning');
assert.match(portrait, /const ctx = canvas\.getContext\('2d', \{ willReadFrequently: true \}\); \/\/ PNGPlaneAvatar repeatedly scans completed portrait canvases/,
  'renderProfile must create the shared avatar canvas in readback mode before PNGPlaneAvatar alpha scans it');

assert.match(portrait, /if \(headOverlay\.blink === false\) return null;/,
  'portrait blink lookup must allow anatomical overlays to opt out instead of probing a guessed *_blink asset');
assert((portrait.match(/blinkUrlFor\(layer\)/g) || []).length >= 2,
  'live rendering and portrait preloading must both honor per-layer blink metadata');
for (const genderKey of ['male', 'female']) {
  const tuskLayer = (mashtzarr[genderKey]?.headUrLayers || []).find(layer => /ur-head_tusks\.png$/.test(layer.url || '')); // Used to confirm the authored tusk overlay explicitly opts out of blink probing.
  assert(tuskLayer, `Mashtzarr ${genderKey} config must keep its tusk head overlay`);
  assert.equal(tuskLayer.blink, false, `Mashtzarr ${genderKey} tusks must not request a nonexistent blink variant`);
}
assert.match(portrait, /'mashtzarr': \{ sprite: 'mashtz',\s+gendered: true,\s+masked: true, sharedGenderSuffix: 'm' \}/,
  'male and female Mashtzarr portraits must intentionally share the authored _mashtz_m mouth set');
for (const expression of ['neutral', 'smile', 'frown', 'laugh']) {
  const mouthAsset = `${mouthAssetDir}/${expression}_mashtz_m.png`; // Exact shared mouth sprite expected for either Mashtzarr gender.
  assert(fs.existsSync(mouthAsset), `shared Mashtzarr mouth asset must exist: ${mouthAsset}`);
}

const docsPage = 'https://raw.githack.com/Oolnokk/HobunjiHollowUnity/commit/docs/index.html';
const resolvedBase = new URL('./assets/', docsPage).href;
assert.equal(resolvedBase, 'https://raw.githack.com/Oolnokk/HobunjiHollowUnity/commit/docs/assets/');
const fallbackBase = resolvedBase.replace('/docs/assets/', '/assets/');
assert.equal(fallbackBase, 'https://raw.githack.com/Oolnokk/HobunjiHollowUnity/commit/assets/');
assert(!resolvedBase.includes('/docs/docs/assets/'));
assert(!fallbackBase.includes('/docs/docs/assets/'));

assert.match(index, /js\/HousePieceGen\.js\?v=20260924facetag1/);
assert.match(index, /js\/portrait-utils\.js\?v=20260925readback1/);

console.log('HousePieceGen face-tag, portrait asset-root, optional sprite, and canvas readback startup regressions passed.');
