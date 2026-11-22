#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const window = {}; // Production browser modules publish their APIs here.
vm.runInNewContext(fs.readFileSync('docs/js/tile-pathfinding.js', 'utf8'), { window });
const navigator = window.TilePathfinding; // Runs the same A* used by ground and cliff travel.

function search(cacheWalkability, gapRow) {
  let checks = 0; // Counts the real planner's calls to collision, including diagonal probes.
  const visited = new Set(); // Detects changes to the within-search memo's scope.
  const path = navigator.findPath(2, 16, 29, 16, (col, row) => {
    const key = col + ',' + row;
    if (cacheWalkability) assert(!visited.has(key), 'each tile is checked once per search');
    visited.add(key);
    checks++;
    return col !== 16 || row === gapRow;
  }, {
    cacheWalkability,
    bounds: { minCol: 0, maxCol: 31, minRow: 0, maxRow: 31 },
  });
  return { path, checks };
}

for (const gapRow of [undefined, 6, 0]) {
  const original = search(false, gapRow); // Compares to the same search with memoization disabled.
  const optimized = search(true, gapRow);
  assert.deepEqual(optimized.path, original.path, 'same waypoints and tie-breaking, including unreachable routes');
  assert(optimized.checks < original.checks / 2, 'blocked detours perform less than half the collision tests');
  if (gapRow === undefined) console.log(`Blocked detour collision checks: ${original.checks} → ${optimized.checks}`);
}
assert(search(true, 6).path?.length, 'a later search sees the newly opened route');

const game = fs.readFileSync('docs/game.js', 'utf8'); // Exercises the live travel function with deterministic time.
const start = game.indexOf('const CREATURE_STUCK_THRESHOLD_S');
const end = game.indexOf('function wanderTick', start);
assert(start >= 0 && end > start);
let now = 0; // Simulated monotonic time for failure and recovery checks.
let movementClear = false; // Lets a newly cleared direct step bypass old planning backoff.
let routeClear = false; // Lets a different goal nominate a new path immediately.
let searches = 0; // Counts actual A* calls from the travel function.
const timed = []; // Captures samples delivered to the in-game profiler.
window.TilePathfinding = {
  ...navigator,
  findPath(...args) {
    searches++;
    return navigator.findPath(...args);
  },
};
window.PerfProfiler = { begin: name => name, end: name => timed.push(name) };
const context = {
  window, performance: { now: () => now }, TILE: 1, currentArea: 'wilderness',
  _isZoneArea: area => area === 'wilderness' || area === 'other-wilderness',
  moveCreatureToward(c) { if (movementClear) c.x += 0.1; return movementClear; },
  creatureTileWalkable: (col, row) => routeClear || col < 6 || col > 6,
};
const travel = vm.runInNewContext(game.slice(start, end) + '\ntravelCreatureToward;', context);
const actor = { x: 2.5, y: 5.5, def: {} }; // A blocked actor between the goal and an impassable column.
function tick(t, goalX = 9.5) {
  now = t;
  return travel(actor, goalX, 5.5, 2, 0.6);
}

assert.equal(tick(0), false);
assert.equal(searches, 1);
tick(600);
assert.equal(searches, 1, 'same blocked route avoids the old 600 ms retry');
tick(1200);
assert.equal(searches, 2, 'unchanged failure retries after the first delay');
tick(2400);
assert.equal(searches, 2, 'the second failure increases the retry delay');
tick(3600);
assert.equal(searches, 3);
tick(6000);
assert.equal(searches, 3, 'the third failure waits up to the cap');
tick(8400);
assert.equal(searches, 4);
assert.equal(actor._travelPathFailure.delay, 4800, 'backoff is bounded');
actor.y += 1;
tick(9000);
assert.equal(searches, 5, 'a new start tile invalidates the old failure');
context.currentArea = 'other-wilderness';
tick(9600);
assert.equal(searches, 6, 'an area change invalidates the old failure');
routeClear = true;
tick(10200, 10.5);
assert.equal(searches, 7, 'a different goal tile searches immediately after the stall threshold');
assert(actor._travelPath?.length, 'successful search gives the actor waypoints');
assert.equal(actor._travelPathFailure, null);
tick(10800, 10.5);
assert.equal(searches, 7, 'existing waypoints still bypass replanning');
actor._travelPath = null;
routeClear = false;
tick(11400);
assert.equal(searches, 8);
movementClear = true;
assert.equal(tick(11500), true, 'an unblocked direct step can always move, even during backoff');
assert.equal(actor._travelPathFailure, null);

context.currentArea = 'ruin';
movementClear = false;
actor._travelPathFailure = { area: 'other-wilderness', retryAt: 16000 }; // A companion carries its bookkeeping across the entrance.
tick(12000);
assert.equal(searches, 9, 'an indoor blocked route still searches');
assert.equal(actor._travelPathFailure, null, 'indoor failures do not retain a wilderness retry deadline');
routeClear = true;
tick(12600);
assert.equal(searches, 10, 'the same indoor start and goal retry on the old cadence after a floor change');
assert(actor._travelPath?.length, 'the actor can plan through the newly available indoor route');

context.currentArea = 'wilderness';
routeClear = false;
const pack = Array.from({ length: 24 }, () => ({ x: 2.5, y: 5.5, def: {} })); // Reproduces a whole crowd reaching the stuck threshold together.
const beforePack = searches; // Isolates the synchronized searches from the single-actor tests above.
for (now = 13000; now <= 17800; now += 600) {
  for (const member of pack) travel(member, 9.5, 5.5, 2, 0.6);
}
assert.equal(searches - beforePack, 24 * 3, '24 blocked actors each search three times instead of nine');
assert.deepEqual(timed, Array(searches).fill('creature ground detour search'));
console.log('Creature travel retry timing, route parity and profiler wiring passed');
