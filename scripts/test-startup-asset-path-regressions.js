#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const house = fs.readFileSync('docs/js/HousePieceGen.js', 'utf8');
const portrait = fs.readFileSync('docs/js/portrait-utils.js', 'utf8');
const index = fs.readFileSync('docs/index.html', 'utf8');

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

const docsPage = 'https://raw.githack.com/Oolnokk/HobunjiHollowUnity/commit/docs/index.html';
const resolvedBase = new URL('./assets/', docsPage).href;
assert.equal(resolvedBase, 'https://raw.githack.com/Oolnokk/HobunjiHollowUnity/commit/docs/assets/');
const fallbackBase = resolvedBase.replace('/docs/assets/', '/assets/');
assert.equal(fallbackBase, 'https://raw.githack.com/Oolnokk/HobunjiHollowUnity/commit/assets/');
assert(!resolvedBase.includes('/docs/docs/assets/'));
assert(!fallbackBase.includes('/docs/docs/assets/'));

assert.match(index, /js\/HousePieceGen\.js\?v=20260924facetag1/);
assert.match(index, /js\/portrait-utils\.js\?v=20260924assetroot1/);

console.log('HousePieceGen face-tag and portrait asset-root startup regressions passed.');
