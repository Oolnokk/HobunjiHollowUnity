#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');

global.THREE = { MathUtils: { degToRad: degrees => degrees * Math.PI / 180 } };
global.window = { SCRATCHBONES_CONFIG: { game: { movement: { perpRotDeadzoneDeg: 40 } } } };
require('../docs/js/perp-rotation.js');

function angleDiff(target, current) {
  let delta = target - current; // Normalized below for every clamp assertion.
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

const api = window.PerpRotation; // Shared clamp API exercised by player, NPC, and livestock facing.
api.init({ angleDiff });

const deg = value => value * Math.PI / 180;
const center = Math.PI / 2; // One camera-relative edge-on orientation used throughout this test.
const deadRadius = deg(40); // Matches the player dead-zone radius configured above.
const state = {};

let result = api.perpClamp(state, center - deg(10), [center, -center], deadRadius);
assert.equal(result.effectiveTarget, center - deadRadius, 'initial approach chooses the negative edge');

for (const jitterDeg of [-1, 0.8, -0.6, 1.2, -0.4, 2.9]) {
  result = api.perpClamp(state, center + deg(jitterDeg), [center, -center], deadRadius);
  assert.equal(result.effectiveTarget, center - deadRadius, `center jitter ${jitterDeg}deg keeps the established side`);
  assert.equal(result.snapTo, null, `center jitter ${jitterDeg}deg does not hard-snap the portrait`);
}

result = api.perpClamp(state, center + deg(3.1), [center, -center], deadRadius);
assert.equal(result.effectiveTarget, center + deadRadius, 'a deliberate crossing beyond hysteresis changes sides');
assert.equal(result.snapTo, center + deadRadius, 'the deliberate crossing performs exactly one edge swap');
assert.equal(state.pixelProbeDebug.rawTargetRotY, center + deg(3.1), 'probe debug retains the raw clamp target');
assert.equal(state.pixelProbeDebug.effectiveTargetRotY, result.effectiveTarget, 'probe debug retains the effective clamp target');
assert.equal(state.pixelProbeDebug.snapToRotY, result.snapTo, 'probe debug identifies the hard-snap frame');
assert.equal(state.pixelProbeDebug.previousSide, -1, 'probe debug retains the pre-crossing side');
assert.equal(state.pixelProbeDebug.selectedSide, 1, 'probe debug exposes the newly selected side');
assert.equal(state.pixelProbeDebug.nearestPerpIndex, 0, 'probe debug identifies the evaluated camera perp');
assert.deepEqual(state.pixelProbeDebug.perpSides, state.perpSides, 'probe debug snapshots every side latch');
assert.deepEqual(state.pixelProbeDebug.perpLocked, state.locked, 'probe debug snapshots every lock latch');

for (const jitterDeg of [1, -1, 0.5, -2.5]) {
  result = api.perpClamp(state, center + deg(jitterDeg), [center, -center], deadRadius);
  assert.equal(result.effectiveTarget, center + deadRadius, `reverse center jitter ${jitterDeg}deg keeps the new side`);
  assert.equal(result.snapTo, null, `reverse center jitter ${jitterDeg}deg cannot restart the snap loop`);
}

console.log('Perpendicular rotation center-hysteresis checks passed.');
