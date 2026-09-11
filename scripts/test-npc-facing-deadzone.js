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

// Perspective parallax: an NPC ten tiles to camera-right does not see the
// camera from the same horizontal bearing as the camera target/player does.
const perspectiveState = {};
const perspectiveNpc = { perpState: perspectiveState, root: { position: { x: 10, y: 0, z: 0 } } };
context._npcWalkers = [perspectiveNpc];
context.__climbDebug = {
  getCameraDebug: () => ({ camPos: { x: 0, y: 8, z: 10 } }),
};
const perspectivePerps = context.PerpRotation.cameraRelativePerpsAtWorldPosition(
  perspectiveNpc.root.position,
  context.__climbDebug.getCameraDebug().camPos,
);
assert.ok(perspectivePerps, 'world-position camera perps resolve for a valid NPC/camera pair');
assert.ok(Math.abs(angleDiff(perspectivePerps[0], Math.PI / 4)) < 1e-9,
  'NPC edge-on angle follows its actual 45-degree bearing to the perspective camera');

const perspectiveAuthoredFacing = Math.PI / 4;
const perspectiveRendered = context.PerpRotation.clampedRotation(
  perspectiveState,
  perspectiveAuthoredFacing,
  perspectiveAuthoredFacing,
  defaultCameraPerps,
  1,
);
assert.ok(Math.abs(angleDiff(perspectiveRendered, perspectiveAuthoredFacing)) >= context.PerpRotation.PERP_DEAD_RAD - 1e-9,
  'NPC clampedRotation uses the NPC-to-camera bearing instead of the player-centered fallback perps');
assert.equal(perspectiveState.pixelProbeDebug?.cameraPerpsMode, 'npc-world-camera-bearing',
  'NPC clamp diagnostics report that the perspective camera bearing path was used');

const gameSource = fs.readFileSync('docs/game.js', 'utf8');
assert.match(gameSource, /target\.rotY\)\) this\.applyFacingDeadzone/, 'stationary schedule facings use the shared clamp');
assert.match(gameSource, /walker\.applyFacingDeadzone\(npcTargetRot/, 'dialogue facings use the shared clamp');

console.log('stationary and perspective-relative NPC facing dead-zone tests passed');
