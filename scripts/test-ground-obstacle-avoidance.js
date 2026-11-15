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

// The foot correction is deliberately bounded even when the nearby
// obstacle would call for an orthogonal A* waypoint.
const foot = steering.steer('foot', 'field', 5.1 * tile, 6.5 * tile, 1, 0, tile, occupied, 1 / 60);
assert(foot, 'on-foot steering recognizes the nearby rock');
assert(Math.abs(Math.atan2(foot.y, foot.x)) <= Math.PI / 7 + 1e-8, 'walking only bends a small amount');
assert(steering.debugSnapshot().foot.plans > 0, 'on-foot avoidance uses a bounded route');

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

// No path through a continuous solid fence. The steering helper must fall
// back to unchanged collision instead of inventing an illegal position.
steering.reset('mounted');
for (let row = 1; row <= 12; row++) blocked.add('6,' + row);
const noRoute = steering.steer('mounted', 'fence', 5.4 * tile, 6.5 * tile, 1, 0, tile, occupied, 1 / 60);
assert.equal(noRoute, null, 'unreachable solid walls do not produce fake navigation paths');
assert.equal(steering.debugSnapshot().mounted.status, 'no-route');
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
