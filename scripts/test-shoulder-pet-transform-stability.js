#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/shoulder-pet-transform-stability.js', 'utf8'); // Exercises the runtime bridge directly and pins its world-space pivot math.
const loader = fs.readFileSync('docs/js/combat/combat-config-loader.js', 'utf8'); // Guards bootstrap ordering before game.js constructs creature avatars.

assert.match(source, /owner\.scaleY[\s\S]{0,260}original\(group, sizeScale, stableHeightMultiplier\)/,
  'shoulder-pet scaling strips idle breathing while preserving the existing attack squash');
assert.match(source, /group\.localToWorld\(localGrip\.clone\(\)\)[\s\S]{0,220}plane\.worldToLocal\(gripWorld\.clone\(\)\)/,
  'billboard correction pivots around the authored live shoulderGrip instead of the plane center');
assert.match(source, /desiredWorldPosition[\s\S]{0,420}plane\.parent\.matrixWorld\.clone\(\)\.invert\(\)[\s\S]{0,220}desiredLocalMatrix/,
  'billboard correction solves an exact world matrix through the full parent transform rather than yaw-only Euler subtraction');
assert.match(source, /plane\.matrixAutoUpdate = false;[\s\S]{0,120}plane\.matrix\.copy\(desiredLocalMatrix\)/,
  'the final shoulder-pet card uses the exact compensated local matrix');
assert.match(source, /gripPivotError/,
  'runtime diagnostics expose post-compensation shoulderGrip drift');
assert.match(loader, /shoulder-pet-transform-stability\.js\?v=20260916a/,
  'the stability bridge is loaded before game.js constructs shoulder-pet avatars');

const scaleCalls = [];
const group = {
  scale: {
    x: 1, y: 1, z: 1,
    set(x, y, z) { this.x = x; this.y = y; this.z = z; scaleCalls.push([x, y, z]); },
  },
};
const otherGroup = {
  scale: {
    x: 1, y: 1, z: 1,
    set(x, y, z) { this.x = x; this.y = y; this.z = z; scaleCalls.push([x, y, z]); },
  },
};
const pet = {
  id: 'pet-1',
  health: 10,
  stableRole: 'shoulderPet',
  scaleY: 1,
  avatarRef: { group },
};
const context = {
  window: {
    THREE: {},
    Combat: { deps: { companionObjects: [pet] } },
    CreatureGenetics: {
      SPECIES_ALIAS: {},
      creatureSizeScale() { return { x: 0.9, y: 0.9, sizeClass: 'small' }; },
      applyCreatureBillboardScale(target, sizeScale, heightMultiplier = 1) {
        target.scale.set(1, sizeScale.y * heightMultiplier, sizeScale.x);
        return true;
      },
    },
    PNGPlaneAvatar: {
      buildAnimalPlaneAvatarModel() { return { group: null, frontPlane: null, backPlane: null }; },
    },
    HOBUNJI_ATTACHMENT_RIG_PROFILES: { creatures: {} },
  },
  Number,
  Math,
  WeakMap,
};
context.window.window = context.window;
vm.runInNewContext(source, context, { filename: 'shoulder-pet-transform-stability.js' });

context.window.CreatureGenetics.applyCreatureBillboardScale(group, { x: 0.9, y: 0.9 }, 0.982);
assert.equal(group.scale.y, 0.9, 'a perched small pet keeps exact genotype height instead of inheriting the breathing multiplier');
assert.equal(group.scale.z, 0.9, 'a perched small pet keeps exact genotype width');
assert.equal(scaleCalls.at(-1)[1], 0.9, 'the delegated scale call receives attack-only multiplier 1');

context.window.CreatureGenetics.applyCreatureBillboardScale(otherGroup, { x: 0.9, y: 0.9 }, 0.982);
assert.ok(Math.abs(otherGroup.scale.y - 0.8838) < 1e-12, 'ordinary animals retain the existing idle-breathing scale');

pet.scaleY = 0.72;
context.window.CreatureGenetics.applyCreatureBillboardScale(group, { x: 0.9, y: 0.9 }, 1.015);
assert.ok(Math.abs(group.scale.y - 0.648) < 1e-12, 'temporary attack squash still applies if a shoulder pet has a non-default scaleY');
const debug = context.window.HobunjiShoulderPetTransformStability.getDebug();
assert.equal(debug.lastScale.appliedHeightMultiplier, 0.72, 'mobile-readable diagnostics report the attack-only height multiplier');
assert.equal(debug.stableScaleInstalled, true, 'stable shoulder-pet scale hook reports installed');
assert.equal(debug.stableBillboardInstalled, true, 'stable shoulder-pet billboard builder hook reports installed');

console.log('Shoulder-pet transform stability regression checks passed.');
