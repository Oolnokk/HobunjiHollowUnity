#!/usr/bin/env node
'use strict';

// Exercises the real ClimbSystem from a raised wilderness shelf, including
// position-relative takeoff and the scripted landing lifecycle.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const ctx = vm.createContext({
  window: {}, Date, performance: { now: () => 1000 }, queueMicrotask,
});
vm.runInContext(fs.readFileSync('docs/js/climb-system.js', 'utf8'), ctx, {
  filename: 'climb-system.js',
});

const shelf = {
  id: 'test-balcony', x: 5.5, z: 5.5, y: 3,
  width: 2, depth: 1.4,
  tangent: { x: 1, z: 0 }, normal: { x: 0, z: 1 },
};
const net = { area: 'test-wilderness', balconies: [shelf], routes: [] };
const contains = (s, x, z, pad = 0) =>
  Math.abs(x - s.x) <= s.width / 2 + pad && Math.abs(z - s.z) <= s.depth / 2 + pad;

ctx.window.CliffRouteNetwork = {
  forGrid: () => net,
  shelfAt: (network, id) => network.balconies.find(s => s.id === id),
  shelfContains: contains,
  highestBelow: () => null,
};
ctx.window.CliffElevatedSurfaces = { canStandOn: (network, id, x, z, pad) => contains(shelf, x, z, pad) };
const tiles = Array.from({ length: 14 }, () =>
  Array.from({ length: 14 }, () => ({ type: 'grass', elevTier: 0 })));
const player = { x: shelf.x * 64, y: shelf.z * 64, onCliffBalcony: shelf.id,
  _cliffBalconyY: shelf.y, climbing: false, angle: 0, vx: 0, vy: 0 };
let input = { x: 0, y: 0 };
ctx.window.ClimbSystem.init({
  _isZoneArea: () => true, getCurrentArea: () => 'test-wilderness',
  getActiveGrid: () => tiles, getActiveCols: () => 14, getActiveRows: () => 14,
  player, TILE: 64, isSolid: tileType => tileType === 'rock',
  tileSurfaceYInArea: tile => (tile?.elevTier || 0) * 3,
  getMovementInput: () => input, getMountRideState: () => 'none',
  setFacingAngle: () => {}, setTargetAimAngle: () => {}, setLastMoveAngle: () => {},
  clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)),
});

// From the middle, the first candidate is *still on* the shelf. Refuse
// to tunnel down through it; leap to the first supported point beyond its edge.
assert(ctx.window.ClimbSystem.jumpFromBalcony({ x: 1, y: 0 }));
assert.equal(player.climbStartX, 5.5 * 64, 'keep actual takeoff location');
assert(player.climbEndX / 64 > shelf.x + shelf.width / 2, 'land strictly beyond the shelf');
const centerLanding = player.climbEndX / 64;
ctx.window.ClimbSystem.updateClimb(0.42);
assert.equal(player.climbing, false, 'landing finishes scripted motion');
assert.equal(player.onCliffBalcony, null, 'player is no longer on suspended support');
assert.equal(player.dodging, true, 'normal cliff landing roll is retained');

// Start near the far edge. Landing must advance from the live feet, NOT
// reuse the same landing point measured from the shelf's center.
player.dodging = false;
player.climbing = false;
player.x = 6.30 * 64;
player.y = shelf.z * 64;
player.onCliffBalcony = shelf.id;
assert(ctx.window.ClimbSystem.jumpFromBalcony({ x: 1, y: 0 }));
assert.equal(player.climbStartX / 64, 6.30);
assert(player.climbEndX / 64 > centerLanding, 'edge takeoff projects farther than center takeoff');
assert(player.climbEndX / 64 >= 7, 'landing is ahead of the body, not behind it');

// Walk off the shelf using normal movement: the same jump mechanism owns
// the fall, so a player never silently snaps to the underlying ground.
player.climbing = false;
player.onCliffBalcony = shelf.id;
player.x = 6.45 * 64;
player.y = shelf.z * 64;
input = { x: 1, y: 0 };
assert(ctx.window.ClimbSystem.updateBalcony(0.15));
assert(player.climbing, 'walking across the ledge edge begins a world-height descent');
assert(player.climbEndX > player.climbStartX, 'walk-off fall preserves the chosen outward direction');

// With PlayerJump loaded in normal gameplay, the same outward walk-off
// commits into real airborne physics so the player can steer and catch ropes.
let airborne = null; // Captures the shared flight passed by the new balcony drop path.
ctx.window.PlayerJump = {
  canOccupyAir: () => true,
  beginFlight(flight, options) {
    airborne = { flight, options };
    player._freeJump = { phase: 'air', feetY: flight.y };
    return player._freeJump;
  },
};
player.climbing = false;
player.onCliffBalcony = shelf.id;
player._freeJump = null;
player.x = 6.45 * 64;
player.y = shelf.z * 64;
input = { x: 1, y: 0 };
assert(ctx.window.ClimbSystem.updateBalcony(0.15));
assert(airborne, 'outward movement transfers the balcony fall into the shared airborne system');
assert.equal(player.climbing, false, 'a directional fall does not start a scripted climb');
assert.equal(player.onCliffBalcony, null, 'the old balcony no longer owns airborne movement');
assert.equal(airborne.flight.y, shelf.y, 'the flight retains the shelf\'s true world elevation');
assert(airborne.flight.x > 6.5, 'the flight begins just outside the physical shelf edge');
assert(airborne.flight.vx > 0, 'outward walk-off retains a small directional drift');
assert.equal(airborne.options.source, 'cliff balcony fall');

console.log('PASS real ClimbSystem jump: takeoff, overhang clearance, landing and walking off ledge');
