#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const gameSource = fs.readFileSync('docs/game.js', 'utf8'); // Guards PNG-pet depth replay before furniture outlines.
// The occluder registry and depth replay were extracted from game.js into
// their own module; game.js keeps only the _markPngPlane alias and the
// render-order call sites.
const occluderSource = fs.readFileSync('docs/js/png-plane-outline-occluder.js', 'utf8');
const indexSource = fs.readFileSync('docs/index.html', 'utf8');

assert.match(occluderSource,
  /const LAYER = 4;/,
  'PNG avatars have a dedicated outline-occlusion layer');
assert.match(occluderSource,
  /function markPngPlane\(obj\)[\s\S]{0,760}child\.layers\.enable\(LAYER\);/,
  'all player and creature plane meshes join the occluder layer');
assert.match(gameSource,
  /function _markPngPlane\(obj\) \{ window\.PngPlaneOutlineOccluder\.markPngPlane\(obj\); \}/,
  'game.js avatar builders still reach the shared occluder registry');
assert.match(occluderSource,
  /function captureMaterial\(material\)[\s\S]{0,400}material\.colorWrite = false;[\s\S]{0,100}material\.depthWrite = true;/,
  'visible PNG silhouettes replay depth without repainting color');
assert.match(occluderSource,
  /material\.depthTest = true;[\s\S]{0,100}material\.depthFunc = THREE\.LessEqualDepth;/,
  'PNG avatar depth replay respects nearer furniture, walls, and other scene occluders');
assert.doesNotMatch(occluderSource,
  /THREE\.AlwaysDepth;/,
  'PNG avatar depth replay must never overwrite nearer scene depth unconditionally');
assert.match(occluderSource,
  /material\.depthTest = state\.depthTest;[\s\S]{0,100}material\.depthFunc = state\.depthFunc;/,
  'portrait depth-test state must be restored immediately after the outline-occluder replay');
assert.match(gameSource,
  /window\.PngPlaneOutlineOccluder\.renderDepth\(activeScene\);[\s\S]{0,220}activeScene\.overrideMaterial = shellOutlineMat;/,
  'avatar occlusion depth is written before furniture shell outlines');
assert.match(gameSource,
  /const camera = new THREE\.PerspectiveCamera\([^\n]*\n\s*window\.PngPlaneOutlineOccluder\.init\(\{ renderer, camera \}\);/,
  'the occluder module receives the live renderer and camera once both exist');
assert.ok(
  indexSource.indexOf('js/png-plane-outline-occluder.js') >= 0
    && indexSource.indexOf('js/png-plane-outline-occluder.js') < indexSource.indexOf('src="game.js'),
  'the occluder module loads before game.js');
assert.match(gameSource,
  /tSceneDepth\.value\s*=\s*_mainRT\.depthTexture;/,
  'furniture seam compositing reads the avatar-augmented scene depth');

console.log('avatar outline occlusion tests passed');
