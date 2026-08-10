#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const gameSource = fs.readFileSync('docs/game.js', 'utf8'); // Guards PNG-pet depth replay before furniture outlines.

assert.match(gameSource,
  /const PNG_PLANE_OUTLINE_OCCLUDER_LAYER = 4;/,
  'PNG avatars have a dedicated outline-occlusion layer');
assert.match(gameSource,
  /function _markPngPlane\(obj\)[\s\S]{0,260}child\.layers\.enable\(PNG_PLANE_OUTLINE_OCCLUDER_LAYER\);/,
  'all player and creature plane meshes join the occluder layer');
assert.match(gameSource,
  /function _renderPngPlaneOutlineOccluderDepth\(activeScene\)[\s\S]{0,900}material\.colorWrite = false;[\s\S]{0,100}material\.depthWrite = true;/,
  'visible PNG silhouettes replay depth without repainting color');
assert.match(gameSource,
  /_renderPngPlaneOutlineOccluderDepth\(activeScene\);[\s\S]{0,220}activeScene\.overrideMaterial = shellOutlineMat;/,
  'avatar occlusion depth is written before furniture shell outlines');
assert.match(gameSource,
  /tSceneDepth\.value\s*=\s*_mainRT\.depthTexture;/,
  'furniture seam compositing reads the avatar-augmented scene depth');

console.log('avatar outline occlusion tests passed');
