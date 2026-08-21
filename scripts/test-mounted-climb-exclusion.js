#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const climbSource = fs.readFileSync('docs/js/climb-system.js', 'utf8'); // Exercised below with mounted and on-foot dependency states.
const mountSource = fs.readFileSync('docs/js/mount-system.js', 'utf8'); // Guards the reverse climb-to-mount exclusion.
const gameSource = fs.readFileSync('docs/game.js', 'utf8'); // Guards mobile action availability and runtime dependency wiring.
const pixelProbeSource = fs.readFileSync('docs/js/pixel-probe.js', 'utf8'); // Guards mobile-visible climb safety diagnostics.

const context = { window: {}, Date };
vm.runInNewContext(climbSource, context);

const player = { x: 32, y: 32, angle: 0, climbing: false, vx: 0, vy: 0 }; // Shared mutable player used to prove a blocked start cannot install stale climb state.
const grid = [[
  { type: 'grass', elevTier: 0 },
  { type: 'grass', elevTier: 0, incline: true },
  { type: 'grass', elevTier: 1 },
]]; // Minimal ground-wall-plateau strip used by getClimbTarget.
let mountRideState = 'mounted'; // Swapped to none below to prove normal on-foot climbing still starts.
let toast = null; // Captures mobile-visible rejection feedback.
context.window.ClimbSystem.init({
  _isZoneArea: () => true,
  getCurrentArea: () => 'map_northern_cliffs',
  player,
  facingCardinal: () => ({ x: 1, y: 0, name: 'east' }),
  getActiveGrid: () => grid,
  getActiveCols: () => 3,
  getActiveRows: () => 1,
  TILE: 64,
  isSolid: () => false,
  tileSurfaceYInArea: tile => tile.elevTier || 0,
  clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
  getMountRideState: () => mountRideState,
  showToast: message => { toast = message; },
  setFacingAngle() {},
  setTargetAimAngle() {},
  setLastMoveAngle() {},
});

const climb = context.window.ClimbSystem.getClimbTarget();
assert(climb, 'the cliff geometry remains detectable while mounted so UI can explain why climbing is unavailable');
assert.equal(context.window.ClimbSystem.startClimb(climb), false, 'mounted climbing is rejected');
assert.equal(player.climbing, false, 'a rejected mounted climb cannot leave stale scripted climb state behind');
assert.equal(toast, 'Dismount before climbing.', 'mounted climbing explains the required action on mobile');
assert.equal(context.window.ClimbSystem.debug.lastBlockRideState, 'mounted', 'debug state records the mount phase that blocked climbing');

mountRideState = 'none';
assert.equal(context.window.ClimbSystem.startClimb(climb), true, 'the same cliff remains climbable after dismounting');
assert.equal(player.climbing, true, 'ordinary on-foot climbing still installs its scripted crossing');

assert.match(mountSource,
  /function beginSummonMount\(\) \{[\s\S]{0,300}if \(deps\.player\.climbing\)[\s\S]{0,220}Finish climbing before calling your mount\./,
  'mount summoning is rejected during an active climb');
assert.match(gameSource,
  /label: climbAllowed \? 'Climb' : 'Dismount to Climb'[\s\S]{0,160}allowed: climbAllowed/,
  'the mobile action arch disables climbing and labels the required dismount');
assert.match(gameSource,
  /getMountRideState: \(\) => window\.Mounts\?\.rideState \?\? 'none'/,
  'ClimbSystem receives the live mount state used by its runtime safety gate');
assert.match(pixelProbeSource, /Climb safety: active=/,
  'Pixel Probe exposes climb/mount exclusion state on mobile');

console.log('mounted climb exclusion checks passed');
