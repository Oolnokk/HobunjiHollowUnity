#!/usr/bin/env node
'use strict';
// NPC path-search caches must avoid repeated town footprint scans without becoming stale.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const windowStub = { AreaFootprintBlockers: { blocksBox: () => false } };
vm.runInNewContext(fs.readFileSync('docs/js/npc-pathfinding.js', 'utf8'), {
  window: windowStub, console, Math, Number, Map, Set, WeakMap, WeakSet, Date,
}, { filename: 'npc-pathfinding.js' });
const grid = Array.from({ length: 12 }, () => Array.from({ length: 12 }, () => ({ type: 0, crop: false })));
let wallEnabled = true; // Dynamically toggled building collision used to verify cache lifetime.
let footprintQueries = 0; // Records real structural callbacks, not cache hits.
const deps = {
  isBuildingArea: () => false, isZoneArea: () => false,
  npcGridForArea: () => grid, getGrid: () => grid, getTownGrid: () => grid,
  getInteriorGrid: () => grid, isSolid: type => type === 1,
  TileType: { TRENCH: 2, RIVER: 3, STREAM: 4, RAMP: 5 },
  worldObjects: new Map(), isHouseFootprint: () => false,
  isTownBuildingCollisionTile(c) { footprintQueries++; return wallEnabled && c === 5; },
  furnitureBlocksMovementAt: () => false,
  npcMovementConfig: () => ({ collisionRadiusTiles: 0.22, beelineSampleStepTiles: 0.25 }),
};
windowStub.NpcPathfinding.init(deps);
const pathing = windowStub.NpcPathfinding;
assert.strictEqual(pathing.findNpcPath('town', 1.5, 5.5, 10, 5, { maxNodes: 2000, padding: 3 }), null,
  'full building wall blocks a route');
const checksWithWall = footprintQueries; // Measures a dense A* exploration of the blocking wall.
assert.ok(checksWithWall > 0 && pathing.debugSnapshot().pathStructuralTileCacheHits > 0,
  'the path search actually uses cached structural tile checks');
wallEnabled = false; // A second search must not read stale collision from the previous search.
const route = pathing.findNpcPath('town', 1.5, 5.5, 10, 5, { maxNodes: 2000, padding: 3 });
assert.ok(route && route.length, 'a removed building wall immediately restores a route');
assert.deepEqual([route[route.length - 1].col, route[route.length - 1].row], [10, 5]);
assert.ok(pathing.canNpcTraverse('town', 4.5, 5.5, 5.5, 5.5),
  'ordinary live movement is not subject to the path-search cache');
wallEnabled = true;
assert.equal(pathing.canNpcTraverse('town', 4.5, 5.5, 5.5, 5.5), false,
  'live movement detects a building wall reintroduced after the search');
const cliff = Array.from({ length: 24 }, () => Array.from({ length: 24 }, () => ({ type: 0 }))); // A separated ledge forces A* to exhaust its reachable side.
for (const row of cliff) row[12].incline = true;
let exactProbes = 0; // Counts calls to the shared footprint provider.
let furnitureProbes = 0; // Counts ordinary point furniture samples inside a clear footprint.
let legacyPointProbes = 0; // Counts calls to the fallback that would also repeat the structural check.
windowStub.AreaFootprintBlockers.blocksBox = (_area, x, z, half) => {
  exactProbes++;
  return Math.abs(x - 5.5) < half + 0.1 && Math.abs(z - 6.5) < half + 0.1;
};
pathing.init({
  ...deps,
  isZoneArea: () => true,
  npcGridForArea: () => cliff,
  isTownBuildingCollisionTile: () => false,
  furnitureBlocksMovementAt: () => { legacyPointProbes++; return false; },
  furnitureOnlyBlocksMovementAt: () => { furnitureProbes++; return false; },
});
assert.equal(pathing.isNpcPositionWalkable('slope', 5.31, 6.5), false, 'exact geometry still blocks a body whose center clears it');
assert.equal(furnitureProbes, 0, 'blocked bodies never reach the furniture samples');
assert.equal(pathing.isNpcPositionWalkable('slope', 6.5, 6.5), true, 'empty bodies are still walkable');
assert.equal(furnitureProbes, 9, 'ordinary furniture keeps all nine samples');
assert.equal(exactProbes, 2, 'each position checks the exact structural providers once');
assert.equal(legacyPointProbes, 0, 'already-cleared structural providers are skipped at contained points');
const beforeCliff = pathing.debugSnapshot(); // Isolates the edge count for the unreachable cliff crossing.
assert.equal(pathing.findNpcPath('slope', 4.4, 6.5, 17, 6, { padding: 20 }), null, 'the planner still respects impassable cliff faces');
const afterCliff = pathing.debugSnapshot(); // Verifies the planner did less work on the same unreachable area.
assert(afterCliff.pathNonImprovingEdgesSkipped > 500, 'the search avoids hundreds of unnecessary sweeps on a disconnected ledge');
assert(afterCliff.pathEdgeSweeps - beforeCliff.pathEdgeSweeps < 700, 'the unreachable search bounds swept collision work');
console.log('profiled NPC path cache: footprint reuse, edge pruning, and live invalidation ok');
