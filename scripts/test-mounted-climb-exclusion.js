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
let startClimbLeapCalledWith = null;
let startClimbLeapResult = true; // Flipped false below to exercise the dismount-required fallback when a leap can't actually start.
let mountHeading = 0; // Used by the regression below to keep the mount facing east while the rider looks elsewhere.
context.window.Mounts = {
  get rideState() { return mountRideState; },
  get heading() { return mountHeading; },
  startClimbLeap: (climbArg) => { startClimbLeapCalledWith = climbArg; return startClimbLeapResult; },
};
context.window.ClimbSystem.init({
  _isZoneArea: () => true,
  getCurrentArea: () => 'map_northern_cliffs',
  player,
  facingCardinal: angle => Math.abs(Math.cos(angle)) >= Math.abs(Math.sin(angle))
    ? (Math.cos(angle) >= 0 ? { x: 1, y: 0, name: 'east' } : { x: -1, y: 0, name: 'west' })
    : (Math.sin(angle) >= 0 ? { x: 0, y: 1, name: 'south' } : { x: 0, y: -1, name: 'north' }),
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

player.angle = Math.PI / 2; // Rider looks south; the mounted body still faces the east-hand cliff.
const climb = context.window.ClimbSystem.getClimbTarget();
assert(climb, 'mounted cliff detection follows mount heading even when independent rider look points elsewhere');
assert.equal(context.window.ClimbSystem.debug.lastWallFacingSource, 'mount', 'debug reports that the mount heading owned the wall scan');
assert.equal(context.window.ClimbSystem.debug.lastWallFacingCardinal, 'east', 'the mounted wall scan resolves the carrier-facing cardinal');
assert.equal(climb.type, 'wall', 'this is the cliff/wall climb type, not a tree branch');

// A wall (cliff) climb while steadily mounted becomes a scripted mount leap
// instead of requiring a dismount — see mount-system.js's startClimbLeap.
assert.equal(context.window.ClimbSystem.startClimb(climb), true, 'mounted wall climbing delegates to a mount leap instead of being rejected');
assert.deepEqual(startClimbLeapCalledWith, climb, 'the exact same climb target a dismounted climb would use is handed to the mount leap');
assert.equal(toast, null, 'a successful mount leap never shows the dismount toast');
assert.equal(player.climbing, false, 'the mounted leap never touches the dismounted player-climbing state — the mount owns its own crossing');

// If a leap genuinely can't start (e.g. an edge case Mounts itself rejects),
// the original dismount-required rejection still protects against getting
// stuck instead of silently doing nothing.
startClimbLeapResult = false;
assert.equal(context.window.ClimbSystem.startClimb(climb), false, 'a mount leap that fails to start still falls back to requiring a dismount');
assert.equal(player.climbing, false, 'a rejected mounted climb cannot leave stale scripted climb state behind');
assert.equal(toast, 'Dismount before climbing.', 'mounted climbing explains the required action on mobile');
assert.equal(context.window.ClimbSystem.debug.lastBlockRideState, 'mounted', 'debug state records the mount phase that blocked climbing');
startClimbLeapResult = true;

// Branch (tree) climbing is unaffected — a mount has no business up a tree,
// so it always still requires dismounting first, leap or no leap.
toast = null;
const branchClimb = { type: 'branch', branch: { baseX: 0, baseY: 0, tipX: 0, tipY: 0 } };
assert.equal(context.window.ClimbSystem.startClimb(branchClimb), false, 'mounted branch climbing is still always rejected');
assert.equal(toast, 'Dismount before climbing.', 'mounted branch climbing still explains the required action on mobile');
assert.equal(startClimbLeapCalledWith, climb, 'branch climbs never reach Mounts.startClimbLeap at all');

mountRideState = 'none';
assert.equal(context.window.ClimbSystem.startClimb(climb), true, 'the same cliff remains climbable after dismounting');
assert.equal(player.climbing, true, 'ordinary on-foot climbing still installs its scripted crossing');

assert.match(mountSource,
  /function beginSummonMount\(\) \{[\s\S]{0,300}if \(deps\.player\.climbing\)[\s\S]{0,220}Finish climbing before calling your mount\./,
  'mount summoning is rejected during an active climb');
assert.match(gameSource,
  /const climbAllowed = \(window\.Mounts\?\.rideState \?\? 'none'\) === 'none';[\s\S]{0,260}label: climbAllowed \? climbLabel : 'Dismount to Climb'[\s\S]{0,160}allowed: climbAllowed/,
  'the mobile action arch disables climbing and labels the required dismount');
assert.match(gameSource,
  /getMountRideState: \(\) => window\.Mounts\?\.rideState \?\? 'none'/,
  'ClimbSystem receives the live mount state used by its runtime safety gate');
assert.match(mountSource, /get heading\(\) \{ return mountAngle; \}/,
  'Mounts exposes its authoritative body heading for climb and dodge direction checks');
assert.match(gameSource,
  /function dodgeInputIsForward\(\)[\s\S]{0,1400}window\.Mounts\?\.rideState === 'mounted'[\s\S]{0,300}window\.Mounts\?\.heading[\s\S]{0,300}Number\.isFinite\(mountHeading\) \? mountHeading : player\.angle/,
  'forward-dodge climb gating follows mount heading instead of independent rider look while mounted');
assert.match(pixelProbeSource, /wallFacing=/,
  'Pixel Probe exposes which facing authority and cardinal the wall scan used');
assert.match(pixelProbeSource, /Climb safety: active=/,
  'Pixel Probe exposes climb/mount exclusion state on mobile');

console.log('mounted climb exclusion checks passed');
