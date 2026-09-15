#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const ring = fs.readFileSync('docs/js/surface-stretch-tile-ring.js', 'utf8');
const parity = fs.readFileSync('docs/js/surface-tile-material-parity.js', 'utf8');
const water = fs.readFileSync('docs/js/water-canvas-stretch-overlay.js', 'utf8');
const naturalConfig = fs.readFileSync('docs/config/natural-surface-materials.js', 'utf8');
const house = fs.readFileSync('docs/js/house-pieces.js', 'utf8');
const terrainMaterials = fs.readFileSync('docs/config/maps/terrain-materials.json', 'utf8');

assert.match(naturalConfig, /sourceEdgeFraction:\s*0\.45/, 'water/snow protected source band must default to 0.45');
assert.match(naturalConfig, /scope:\s*'water-and-snow'/, 'config must state the narrow experimental scope');
assert.doesNotMatch(house, /surface-perimeter-frame-config\.js/, 'cliff perimeter retuner must not load');
assert.doesNotMatch(house, /grass-surface-canvas-overlay\.js/, 'grass canvas overlay must not load');

assert.match(terrainMaterials, /"grass": \{ "texture": "wavy_surface\.png", "tileSize": 8/,
  'wilderness grass must remain on its original tiled wavy_surface path');
assert.match(water, /BASE_WATER_TEXTURE_URL = 'assets\/textures\/wavy_surface\.png'/,
  'water base must stay continuous wavy_surface');
assert.match(water, /waterBankOutlineOnly: true/,
  'water protected-band texture must be a separate outline-only sampler');

assert.match(ring, /function fitTileClusterGeometry\(/, 'shared tile-ring fitter remains available to snow');
assert.match(parity, /if \(mode === 'slush'\) \{[\s\S]*ignoredSlushRoots\+\+[\s\S]*return false/,
  'slush must be explicitly ignored by the protected-band adapter');
assert.match(parity, /if \(mode !== 'snow'\) return false/, 'only snow may enter the environment remap');
assert.match(parity, /label: 'environment-snow:whole-zone'/, 'snow is mapped as one whole-zone surface');
assert.match(parity, /connectCells,\n\s*tileRingWorldWidth: configuredRingWidth\(\),\n\s*sourceEdgeFraction: configuredSourceEdge\(\)/,
  'snow must consume the configured one-tile 0.45 protected band');
assert.match(parity, /geometry\.setAttribute\('uv', new THREE\.Float32BufferAttribute\(uvArray, 2\)\)/,
  'snow may replace its own overlay UVs directly without a broad material shader patch');
assert.match(parity, /environment-snow-micro-plateau/, 'snow shade-fill path must restore authored pure black');
assert.doesNotMatch(parity, /resolveCliffMat|natural_\(\?:rocks|ensureSlushMaskTexture|MergedWaterRenderer|GrassSurface/,
  'snow adapter must not patch cliffs, rocks, slush, water, or grass');

const postAt = house.indexOf("['NaturalSurfaceStretchPostJigsaw', 'natural-surface-stretch-post-jigsaw.js");
const waterAt = house.indexOf("['WaterCanvasStretchOverlay', 'water-canvas-stretch-overlay.js");
const ringAt = house.indexOf("['HobunjiSurfaceTileRing', 'surface-stretch-tile-ring.js");
const snowAt = house.indexOf("['HobunjiSurfaceTileMaterialParity', 'surface-tile-material-parity.js");
assert.ok(postAt >= 0 && waterAt > postAt && ringAt > waterAt && snowAt > ringAt,
  'loader order must be established mapper -> water bank -> tile ring -> snow-only adapter');

console.log('water/snow protected-band scope tests passed');
