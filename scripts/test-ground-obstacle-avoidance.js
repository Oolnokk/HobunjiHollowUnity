#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = { window: {}, Math };
vm.createContext(context);
for (const name of ['tile-pathfinding.js', 'ground-obstacle-avoidance.js']) {
  vm.runInContext(fs.readFileSync('docs/js/' + name, 'utf8'), context, { filename: name });
}
const steering = context.window.GroundObstacleAvoidance;
assert(steering?.steer, 'the new module registers before game.js and exposes its steering function');
const tile = 64;
const blocked = new Set(['6,6']); // A single rock on a broad, otherwise open path.
const occupied = (x, y) => {
  if (x < tile || x >= 13 * tile || y < tile || y >= 13 * tile) return false;
  const col = Math.floor(x / tile), row = Math.floor(y / tile);
  const radius = 10;
  // Every corner of the moving footprint must fit (not just the center).
  return [[-radius, -radius], [radius, -radius], [-radius, radius], [radius, radius]]
    .every(([dx, dy]) => !blocked.has(Math.floor((x + dx) / tile) + ',' + Math.floor((y + dy) / tile)));
};

// An empty field never changes raw movement and does not run A*.
let clear = steering.steer('mounted', 'field', 2.5 * tile, 3.5 * tile, 1, 0, tile, occupied, 1 / 60);
assert.equal(clear, null, 'a clear route remains entirely player-directed');
assert.equal(steering.debugSnapshot().mounted.plans, 0, 'no planner cost is paid in open ground');
assert.equal(steering.steer('mounted', 'field', 2.5 * tile, 3.5 * tile, 0, 0, tile, occupied, 1 / 60), null,
  'letting go of the stick never starts autopilot');

// Nothing moves sideways until the actual forward footprint is about to collide.
const early = steering.steer('foot', 'field', 5.1 * tile, 6.5 * tile, 1, 0, tile, occupied, 1 / 60);
assert.equal(early, null, 'on-foot movement stays perfectly direct before contact');
assert.equal(steering.debugSnapshot().foot.plans, 0, 'walking never runs A* or tracks a waypoint');

const footX = 5.8 * tile, footY = 6.5 * tile; // Fixture is within the 0.055-tile contact threshold of the rock.
const foot = steering.steer('foot', 'field', footX, footY, 1, 0, tile, occupied, 1 / 60);
assert(foot?.y > 0, 'on-foot avoidance adds only a small sideways slide at physical contact');
assert(Math.abs(Math.atan2(foot.y, foot.x)) <= Math.PI / 9 + 1e-8, 'walking bends by at most 20 degrees');
assert.equal(steering.debugSnapshot().foot.status, 'sliding');
assert.equal(steering.debugSnapshot().foot.plans, 0, 'foot steering never calls the tile path planner');
assert.equal(steering.steer('foot', 'field', 3.5 * tile, 6.5 * tile, 1, 0, tile, occupied, 1 / 60), null,
  'leaving the blocked surface stops the slide immediately');

// Facing a usable object takes precedence over movement assistance.
const player = { x: footX, y: footY, angle: 0 }; // Same player pointer normally exposed by the game debug bridge.
context.window.__climbDebug = { getPlayer: () => player };
context.window.WorldPopupText = { debugSnapshot: () => ({ interactionRows: [{ action: 'open-door' }] }) };
steering.reset('foot');
assert.equal(steering.steer('foot', 'field', footX, footY, 1, 0, tile, occupied, 1 / 60), null,
  'facing a nearby interactable does not steer the player away from its action');
assert.equal(steering.debugSnapshot().foot.status, 'yielding');
context.window.WorldPopupText = { debugSnapshot: () => ({ interactionRows: [] }) };
context.window.ClimbSystem = { getClimbTarget: () => ({ type: 'wall' }), getWorldClimbTarget: () => null };
steering.reset('foot');
assert.equal(steering.steer('foot', 'field', footX, footY, 1, 0, tile, occupied, 1 / 60), null,
  'facing a climb target preserves the climb input');
context.window.ClimbSystem = { getClimbTarget: () => null, getWorldClimbTarget: () => null };
context.window.PlayerJump = { hasJumpableSupportAhead: () => true };
steering.reset('foot');
assert.equal(steering.steer('foot', 'field', footX, footY, 1, 0, tile, occupied, 1 / 60), null,
  'a jumpable surface is not treated as vegetation to auto-route around');
context.window.PlayerJump = { hasJumpableSupportAhead: () => false };
steering.reset('foot');
player.angle = Math.PI / 2;
assert(steering.steer('foot', 'field', footX, footY, 1, 0, tile, occupied, 1 / 60),
  'an object outside player facing does not claim a deliberate stop');
player.angle = 0;
context.window.InteriorDoorTiles = { blocksBox: () => true };
steering.reset('foot');
assert.equal(steering.steer('foot', 'field', footX, footY, 1, 0, tile, occupied, 1 / 60), null,
  'closed interactive doors must not side-step their action');
delete context.window.InteriorDoorTiles;
delete context.window.__climbDebug;
delete context.window.WorldPopupText;
delete context.window.ClimbSystem;
delete context.window.PlayerJump;

// A gradual analog-stick turn should clear contact once the new direction is free.
steering.reset('foot');
steering.steer('foot', 'field', footX, footY, 1, 0, tile, occupied, 1 / 60);
for (const degrees of [15, 30, 45]) {
  const angle = degrees * Math.PI / 180;
  steering.steer('foot', 'field', footX, footY,
    Math.cos(angle), Math.sin(angle), tile, occupied, 1 / 60);
}
assert.equal(steering.debugSnapshot().foot.status, 'clear',
  'turning into open terrain cancels the on-foot slide');

// Mounted steering sees the obstruction earlier and can turn far enough to
// pass it without ever moving the entity through a solid tile.
let x = 3.5 * tile, y = 6.5 * tile;
let sawTurn = false;
let reachedPastRock = false;
for (let frame = 0; frame < 300; frame++) {
  const candidate = steering.steer('mounted', 'field', x, y, 1, 0, tile, occupied, 1 / 60);
  const vx = candidate?.x ?? 1, vy = candidate?.y ?? 0;
  if (Math.abs(vy) > 0.1) sawTurn = true;
  const step = 150 / 60;
  if (occupied(x + vx * step, y)) x += vx * step;
  if (occupied(x, y + vy * step)) y += vy * step;
  assert(occupied(x, y), 'actual movement never crosses a rock footprint');
  if (x > 8.5 * tile) { reachedPastRock = true; break; }
}
assert(sawTurn, 'the mount makes an actual lateral detour');
assert(reachedPastRock, 'a held eastward input can carry the mount around the obstruction');
assert(steering.debugSnapshot().mounted.plans < 80, 'planning is throttled, not called per frame');

// Dense three-by-three brush is traversable around its edges but cannot be
// cut through diagonally. This covers the common wilderness thicket case.
steering.reset('mounted');
blocked.clear();
for (let row = 5; row <= 7; row++) {
  for (let col = 5; col <= 7; col++) blocked.add(col + ',' + row);
}
let brushX = 3.5 * tile, brushY = 6.5 * tile; // Ground-position trace across the thicket test.
let passedBrush = false; // Must progress through reachable open terrain rather than repeatedly nudging into the plants.
for (let frame = 0; frame < 450; frame++) {
  const suggested = steering.steer('mounted', 'thicket', brushX, brushY, 1, 0, tile, occupied, 1 / 60);
  const vx = suggested?.x ?? 1, vy = suggested?.y ?? 0;
  const step = 130 / 60;
  if (occupied(brushX + vx * step, brushY)) brushX += vx * step;
  if (occupied(brushX, brushY + vy * step)) brushY += vy * step;
  assert(occupied(brushX, brushY), 'mounted path stays out of dense thicket footprints');
  if (brushX > 10 * tile) { passedBrush = true; break; }
}
assert(passedBrush, 'mounted local pathing navigates around a broad vegetation cluster');
blocked.clear();

// No path through a continuous solid fence. The steering helper must fall
// back to unchanged collision instead of inventing an illegal position.
steering.reset('mounted');
for (let row = 1; row <= 12; row++) blocked.add('6,' + row);
const noRoute = steering.steer('mounted', 'fence', 5.4 * tile, 6.5 * tile, 1, 0, tile, occupied, 1 / 60);
assert.equal(noRoute, null, 'unreachable solid walls do not produce fake navigation paths');
assert.equal(steering.debugSnapshot().mounted.status, 'no-route');
const fencePlans = steering.debugSnapshot().mounted.plans; // Counts failed searches while input remains pressed into the fence.
for (let frame = 0; frame < 30; frame++) {
  const stillBlocked = steering.steer('mounted', 'fence', 5.4 * tile, 6.5 * tile, 1, 0, tile, occupied, 1 / 60);
  assert.equal(stillBlocked, null, 'a held input into the fence never forges a path');
}
assert.equal(steering.debugSnapshot().mounted.plans, fencePlans,
  'failed route is cached for at least 0.5 seconds; no per-frame A* retry loop');
for (let frame = 0; frame < 6; frame++) steering.steer('mounted', 'fence', 5.4 * tile, 6.5 * tile, 1, 0, tile, occupied, 1 / 60);
assert.equal(steering.debugSnapshot().mounted.plans, fencePlans + 1,
  'long-held input eventually retries after the bounded route cooldown');
blocked.clear();

// Input reversal and area changes must invalidate old routes, even if
// the last cached route came from a different world or direction.
steering.steer('foot', 'other-area', 5.1 * tile, 6.5 * tile, 1, 0, tile, occupied, 1 / 60);
assert.equal(steering.debugSnapshot().foot.area, 'other-area');
assert.equal(steering.steer('foot', 'other-area', 5.1 * tile, 6.5 * tile, -1, 0, tile, occupied, 1 / 60), null);

const game = fs.readFileSync('docs/game.js', 'utf8');
const mounts = fs.readFileSync('docs/js/mount-system.js', 'utf8');
const html = fs.readFileSync('docs/index.html', 'utf8');
assert(game.includes('GroundObstacleAvoidance?.steer('), 'walking integrates with the real runtime without a post-move teleport');
assert(mounts.includes("GroundObstacleAvoidance?.steer('mounted'"), 'mounted input uses the same planner before turning');
assert(html.includes('js/ground-obstacle-avoidance.js?v='), 'the browser loads steering before game startup');

console.log('ground obstacle avoidance checks passed');
