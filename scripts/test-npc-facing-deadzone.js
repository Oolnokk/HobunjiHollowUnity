#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

const context = {
  console,
  Math,
  THREE: { MathUtils: { degToRad: degrees => degrees * Math.PI / 180 } },
};
context.window = context;
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync('docs/config/scratchbones-config.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('docs/js/perp-rotation.js', 'utf8'), context);
context.PerpRotation.init({ angleDiff });

const state = {};
const authoredFacing = Math.PI / 2; // Bronzeworks evening station: edge-on at the default camera azimuth.
const defaultCameraPerps = [Math.PI / 2, -Math.PI / 2];
const rendered = context.PerpRotation.clampedRotation(state, authoredFacing, authoredFacing, defaultCameraPerps, 1);
assert.ok(Math.abs(angleDiff(rendered, authoredFacing)) >= context.PerpRotation.PERP_DEAD_RAD - 1e-9,
  'a stationary 90-degree station pose is pushed to the dead-zone boundary');

const rotatedCameraPerps = [Math.PI, 0];
const refreshed = context.PerpRotation.clampedRotation(state, rendered, authoredFacing, rotatedCameraPerps, 1);
assert.equal(refreshed, authoredFacing, 'the authored facing is restored when a new camera angle makes it safe');

const gameSource = fs.readFileSync('docs/game.js', 'utf8');
assert.match(gameSource, /target\.rotY\)\) this\.applyFacingDeadzone/, 'stationary schedule facings use the shared clamp');
assert.match(gameSource, /walker\.applyFacingDeadzone\(npcTargetRot/, 'dialogue facings use the shared clamp');

console.log('stationary NPC facing dead-zone tests passed');
