#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const overlayPath = path.join(__dirname, '../docs/js/grass-surface-canvas-overlay.js'); // Used to validate the runtime grass overlay implementation without requiring WebGL in Node.
const loaderPath = path.join(__dirname, '../docs/js/house-pieces.js'); // Used to verify the parser-time dependency chain actually installs the overlay before gameplay terrain builds.
const source = fs.readFileSync(overlayPath, 'utf8');
const loader = fs.readFileSync(loaderPath, 'utf8');

assert.match(source, /OVERLAY_TEXTURE_URL\s*=\s*'assets\/textures\/canvas\.png'/,
  'grass overlay must use canvas.png');
assert.match(source, /OVERLAY_OPACITY\s*=\s*0\.20/,
  'non-black canvas pixels must use 0.20 opacity');
assert.match(source, /PURE_BLACK_MAX_CHANNEL\s*=\s*0/,
  'pure black detection must remain literal rather than treating near-black texture shading as black');
assert.match(source, /if \(!pureBlack\) data\[i \+ 3\] = Math\.round\(data\[i \+ 3\] \* OVERLAY_OPACITY\)/,
  'pure-black pixels must keep source alpha while other pixels receive the 0.20 alpha multiplier');
assert.match(source, /mapper\.mapGeometry\(combined,[\s\S]*?angleToleranceDeg/,
  'combined grass triangles must use the shared HobunjiSurfaceStretchUV irregular-surface solver');
assert.match(source, /scene\.traverse\?\.\(mesh => \{[\s\S]*?eligibleGrassMesh\(mesh\)[\s\S]*?applyMatrix4\(mesh\.matrixWorld\)/,
  'the overlay must be built from the actual rendered grass mesh faces in world space');
assert.match(source, /normal\.y < GRASS_FACE_MIN_UP_DOT/,
  'vertical slab/skirt faces must be excluded from the grass top-surface overlay');
assert.match(source, /Array\.isArray\(mesh\.material\)[\s\S]*?materialIndexForElement/,
  'mixed-material terrain must isolate grass material slots instead of overlaying rock/cliff triangles');
assert.match(source, /new THREE\.Mesh\(built\.geometry, overlayMaterial\)/,
  'all connected grass islands in one scene must share one combined overlay mesh/draw call');
assert.match(source, /overlay\.raycast = \(\) => \{\}/,
  'the visual overlay must not intercept gameplay raycasts');
assert.match(source, /currentSeason\?\.\(\)\?\.grassColor/,
  'the overlay tint must follow the same seasonal grass color as the existing grass surface');
assert.match(source, /REBUILD_DEBOUNCE_MS\s*=\s*32/,
  'terrain mutation rebuilds must be batched rather than rebuilding once per tile add');
assert.match(source, /objectProto\.add = function/[\s\S]*?containsEligibleGrass\(object\)/,
  'runtime terrain additions must invalidate the connected grass overlay');
assert.match(source, /objectProto\.remove = function/[\s\S]*?scheduleRebuild\(scene, 'grass terrain removed'\)/,
  'runtime terrain removals must invalidate the connected grass overlay');
assert.match(loader, /\['GrassSurfaceCanvasOverlay', 'grass-surface-canvas-overlay\.js\?v=20260904a'\]/,
  'house-pieces parser loader must install the grass overlay module before gameplay terrain construction');

console.log('grass surface canvas overlay tests passed');
