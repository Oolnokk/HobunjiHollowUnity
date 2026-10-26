#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const surfaceSource = fs.readFileSync('docs/js/portrait-utils.js', 'utf8'); // Exercises the production PNG-surface material builder without DOM dependencies.
const start = surfaceSource.indexOf('function spritePngAlphaTest()');
const end = surfaceSource.indexOf('// Carvings retain the authored stroke', start);
assert(start !== -1 && end > start, 'shared sprite alpha material functions remain available');
const config = { game: { assets: { pngPlaneAvatar: { alphaTest: 0.001, maskAlphaTest: 0.35 } } } }; // Test config supplies independent appearance and depth-mask coverage cutoffs.
const runtime = vm.runInNewContext(
  surfaceSource.slice(start, end) + '\n({ spritePngAlphaTest, spritePngMaskAlphaTest, spritePngMaterialOptions, makeSpritePngUnlitMaterial })',
  { window: { SCRATCHBONES_CONFIG: config } }
);
const THREE = { FrontSide: 0, MeshBasicMaterial: class { constructor(properties) { Object.assign(this, properties); } } }; // The material constructor captures the real factory options.
const tex = { isTexture: true }; // Represents a nonempty authored sprite PNG.

const portrait = runtime.makeSpritePngUnlitMaterial(THREE, tex, 'portrait');
assert.equal(portrait.alphaTest, 0.35, 'depth-writing PNG planes must not hide other sprites with near-invisible fringe');
assert.equal(portrait.depthWrite, true);
assert.equal(portrait.transparent, true);

const softOverlay = runtime.makeSpritePngUnlitMaterial(THREE, tex, 'effect', { depthWrite: false });
assert.equal(softOverlay.alphaTest, 0.001, 'depth-disabled translucent sprites should retain soft antialiasing');
assert.equal(runtime.makeSpritePngUnlitMaterial(THREE, tex, 'explicit', { alphaTest: 0.55 }).alphaTest, 0.55,
  'stronger authored alpha tests must never be reduced');
assert.equal(runtime.makeSpritePngUnlitMaterial(THREE, tex, 'too-low', { alphaTest: 0.01 }).alphaTest, 0.35,
  'explicit low cutoffs cannot stamp near-invisible depth');
assert.equal(runtime.makeSpritePngUnlitMaterial(THREE, null, 'untextured').alphaTest, 0.001,
  'untextured materials are not sprite silhouettes');

config.game.assets.pngPlaneAvatar.maskAlphaTest = -1;
assert.equal(runtime.makeSpritePngUnlitMaterial(THREE, tex, 'invalid-mask').alphaTest, 0.35,
  'invalid masking thresholds must use the safe fallback');

const avatarSource = fs.readFileSync('docs/js/png-plane-avatar.js', 'utf8'); // Confirms the animal producer consumes the same runtime factory as player and NPC portraits.
assert.match(avatarSource, /makeSpriteMaterial\(THREE, frontTex, 'animal_front_mat'\)/);
assert.match(avatarSource, /makeSpriteMaterial\(THREE, backTex, 'animal_back_mat'\)/);
assert.doesNotMatch(avatarSource, /alphaTest:\s*cfg\(\)\.alphaTest\s*\?\?\s*0\.001,\s*side:\s*THREE.FrontSide,\s*depthWrite:\s*true/,
  'animal cards must not use an independently permissive depth cutoff');

console.log('PNG plane mask-alpha coverage tests passed');
