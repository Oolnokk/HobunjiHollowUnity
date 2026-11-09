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
console.log('profiled NPC path cache: per-search footprint reuse and live invalidation ok');
