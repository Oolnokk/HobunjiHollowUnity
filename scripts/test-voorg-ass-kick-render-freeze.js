#!/usr/bin/env node
'use strict';

// Execute the real renderer's position, additive-head, scale and orientation
// seams. A logical stop must also stop render interpolation after a fast lunge.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const game = fs.readFileSync('docs/game.js', 'utf8');

function sliceBetween(startToken, endToken) {
  const start = game.indexOf(startToken, game.indexOf('function updateCreatureMesh('));
  const end = game.indexOf(endToken, start);
  assert(start >= 0 && end > start, 'find production animal renderer seam');
  return game.slice(start, end);
}
const positionSource = sliceBetween('        const scaleY = c.scaleY ?? 1;', '        // Tracks the body\'s own smoothed XZ');
const rotationSource = sliceBetween('        const rawTargetRotY = -((aimAngle', '        const planeDelta = c.pngRot - c.groupRot;');

const values = { breathCalls: 0, latestScale: null, latestNod: null };
const window = {
  VoorgAssRearKick: { isHoldingKickPose: c => c._animalAttack?.id === 'rearKick' && ['kickHold', 'recovery'].includes(c._animalAttack.state?.stage) },
  AnimalVocalizations: { headNodOffsetDeg: () => 12 },
  CreatureGenetics: {
    creatureBreathScaleY: () => { values.breathCalls++; return 1.08; },
    applyCreatureBillboardScale: (group, sizes, scale) => { values.latestScale = scale; },
  },
  PerpRotation: { CREATURE_PLANE_ROT_MODE: 'halt', setMovementHint() {} },
};
const c = {
  x: 128, y: 64, scaleY: 1, groundLift: 0.5, halfHeight: 0.5, visualScaleX: 1, visualScaleY: 1,
  _animalAttack: { id: 'rearKick', state: { stage: 'kickHold' } },
  groupRot: 0.25, pngRot: 0.7, def: { aimAngleOffset: 0, moveSpeed: 70 },
  perpState: { travelSampleX: 128, travelSampleY: 64 },
  avatarRef: { setHeadAdditiveRotation: nod => { values.latestNod = nod; } },
};
function group() {
  const position = { x: -3, y: -3, z: -3, set(x, y, z) { this.x = x; this.y = y; this.z = z; } };
  return { position, rotation: { y: 0 } };
}
const grp = group();
const ctx = {
  window, performance: { now: () => 500 }, Math, TILE: 32, surfY: 0,
  c, grp, dt: 1 / 60, kickPoseHeld: true, headtakerOwnsFacing: false, aimAngle: 2.4, // The kick fixture remains outside the scoped Headtaker renderer override.
  angleDiff: (target, current) => Math.atan2(Math.sin(target - current), Math.cos(target - current)),
  cameraRelativeCreaturePerps: () => [],
};
function run(source) { vm.runInNewContext('(function(){' + source + '})()', ctx); }
run(positionSource);
assert.equal(grp.position.x, 4, 'held avatar snaps to its real X rather than visually continuing to slide');
assert.equal(grp.position.z, 2, 'held avatar snaps to its real Z rather than visually continuing to slide');
assert.equal(grp.position.y, 0.5);
assert.equal(values.latestScale, 1, 'held pose excludes continuous breathing');
assert.equal(values.latestNod, 0, 'held head ignores vocalization nods');
assert.equal(values.breathCalls, 0, 'breathing animator is not evaluated during held impact');
run(rotationSource);
assert(Math.abs(c.groupRot - (-2.4 + Math.PI / 2)) < 1e-10, 'body yaw has finished the full turn at impact');
assert.equal(c.pngRot, 0.7, 'held billboard angle stops easing while the kick pose is frozen');
const first = { ...grp.position }, firstYaw = c.groupRot;
run(positionSource); run(rotationSource);
assert.equal(grp.position.x, first.x);
assert.equal(grp.position.z, first.z);
assert.equal(c.groupRot, firstYaw);
assert.equal(c.pngRot, 0.7);
assert.equal(values.breathCalls, 0);

// Recovery also belongs to the planted kick stance, but the original attack
// regains its ordinary animation controls after the dispatcher clears it.
c._animalAttack.state.stage = 'recovery';
run(positionSource);
assert.equal(grp.position.x, 4, 'stationary recovery retains the same planted feet');
c._animalAttack = null;
const walking = group();
ctx.grp = walking;
run(positionSource);
assert(walking.position.x > -3 && walking.position.x < 4, 'ordinary companions still use the existing position lerp');
assert.equal(values.breathCalls, 1, 'normal breathing resumes outside the kick hold');
console.log('Voorg-Ass rear-kick visual position/yaw, head nod, breath and idle recovery freeze passed.');
