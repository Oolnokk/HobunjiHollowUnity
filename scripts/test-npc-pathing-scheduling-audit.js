#!/usr/bin/env node
'use strict';

// Cross-midnight NPC schedules and footprint-aware A* performance regressions.
// Run from any directory: node scripts/test-npc-pathing-scheduling-audit.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..'); // Resolves the existing source modules when this test is run outside the repo root.

let hour = 1, weekday = 'Tothu';
const logs = []; // Captures repeated missing-station diagnostics in the scheduling assertions.
const grid = Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => ({ type: 'floor' }))); // Open test map; an exact sub-tile wall below is the only blocker.
const window = {
  __farmLog: text => logs.push(text),
  CalendarSystem: { getHour: () => hour, currentWeekdayName: () => weekday },
  AreaFootprintBlockers: {
    blocksBox: (area, x, z, radius) =>
      (area === 'interior' || area === 'map_i_test') && x + radius > 3 && x - radius < 3.3 && z + radius > 0 && z - radius < 4,
  },
};
const sandbox = vm.createContext({ window, console });
const load = file => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox, { filename: file }); // Runs the actual browser-global modules, not a reimplementation of their behavior.
load('docs/js/npc-agenda.js');
load('docs/js/npc-scheduling.js');
load('docs/js/tile-pathfinding.js');
load('docs/js/npc-pathfinding.js');
load('docs/js/npc-activity-planner.js');

const agenda = window.NpcAgenda;
const nightBeat = { id: 'night', activity: 'work', day: 'Naru', window: ['22:00', '02:00'] }; // Friday-only test beat spanning into Saturday.
for (const [name, day, nowMin, expected] of [
  ['Naru', 45, 23 * 60, true],
  ['Tothu', 46, 60, true],
  ['Tothu', 46, 23 * 60, false],
  ['Uung', 47, 60, false],
  ['Naru', 45, 60, false],
]) {
  assert.equal(agenda.isBeatActiveNow(nightBeat, { npcId: 'night_worker', weekdayName: name, day, nowMin }), expected,
    `agenda overnight ${name} ${nowMin}`);
}

// The public calendar changes civil dates at midnight; raw gameplay day waits until 06:00.
const rawCalendar = { day: 45 }; // Used by the planner to model 06:00 raw-day rollover without changing the civil schedule date.
window.CalendarSystem.civilDayForRawDay = () => rawCalendar.day + (hour < 6 ? 1 : 0);
const midnightWalker = { rec: { id: 'night_worker', name: 'Night worker', agenda: [nightBeat] }, area: 'town', root: { position: { x: 1.5, z: 1.5 } } }; // Supplies a live NPC for the planner's read-only debug snapshot.
window.NpcActivityPlanner.init({
  calendar: rawCalendar,
  findNpcWalker: id => id === midnightWalker.rec.id ? midnightWalker : null,
  getCurrentArea: () => 'town',
});
weekday = 'Tothu';
hour = 1;
const beforeRawRollover = window.NpcActivityPlanner.debugSnapshot(midnightWalker.rec.id); // Should use civil day 46 despite raw calendar day 45.
assert.equal(beforeRawRollover.intendedBeatId, 'night', 'the agenda still considers an overnight shift active just after midnight');
assert.equal(beforeRawRollover.dailySeed, agenda.dailySeed('night_worker', 46, 'debug'),
  'planner seeds use the current civil day before the 06:00 raw rollover');
rawCalendar.day = 46;
hour = 7;
const afterRawRollover = window.NpcActivityPlanner.debugSnapshot(midnightWalker.rec.id); // The civil day stays 46 after raw maintenance.
assert.equal(afterRawRollo.dailySeed, beforeRawRollover.dailySeed,
  'planner seeds do not change again at the 06:00 raw-day rollover');

const schedulingDeps = {
  normalizeNpcArea: area => area || 'town',
  getCurrentArea: () => 'town',
  getSharedSchedules: () => [],
  getWorldNpcPaths: () => [],
  npcWalkers: [],
}; // Supplies only the adapter methods actually used by the legacy scheduling resolver.
window.NpcScheduling.init(schedulingDeps);
const rec = {
  id: 'night_worker',
  scheduleHooks: {
    rules: [{ day: 'Naru', from: '22:00', to: '02:00', area: 'town', c: 10, r: 11 }],
    defaultPosition: { area: 'farm', c: 1, r: 1 },
  },
}; // Validates that the legacy schedule uses the weekday when the shift started.
for (const [name, atHour, expectedCol] of [
  ['Tothu', 1, 10], ['Tothu', 23, 1], ['Naru', 23, 10], ['Naru', 1, 1],
]) {
  weekday = name;
  hour = atHour;
  assert.equal(window.NpcScheduling.resolveLegacyNpcScheduleTarget(rec)?.c, expectedCol,
    `legacy overnight ${name} ${atHour}`);
}

window.NpcScheduling.registerNpcStations([{ id: 'late_station', c: 4, r: 5, area: 'town' }], 'town');
schedulingDeps.getSharedSchedules = () => [{
  id: 'late_event', day: 'Naru', from: '22:00', to: '02:00', stationIds: ['late_station'],
}];
rec.scheduleHooks = {};
weekday = 'Tothu';
hour = 1;
assert.equal(window.NpcScheduling.resolveLegacyNpcScheduleTarget(rec)?.stationId, 'late_station',
  'shared overnight event remains active after midnight');

schedulingDeps.getSharedSchedules = () => [];
rec.scheduleHooks = { defaultStationId: 'missing_station' };
const beforeWarnings = logs.length; // Count used to detect the old every-frame missing-station warning spam.
for (let i = 0; i < 15; i++) window.NpcScheduling.resolveLegacyNpcScheduleTarget(rec);
assert.equal(logs.length - beforeWarnings, 1, 'missing default station warns once, not every frame');

const movementDeps = {
  isBuildingArea: area => area === 'map_i_test',
  isZoneArea: () => false,
  npcGridForArea: () => grid,
  getInteriorGrid: () => grid,
  getTownGrid: () => grid,
  getGrid: () => grid,
  isSolid: () => false,
  worldObjects: new Set(),
  isHouseFootprint: () => false,
  isTownBuildingCollisionTile: () => false,
  TileType: { TRENCH: 'trench', RIVER: 'river', STREAM: 'stream' },
  furnitureBlocksMovementAt: () => false,
  npcMovementConfig: () => ({}),
}; // Same supplied collision helpers in both heap-backed and standalone fallback searches.
window.NpcPathfinding.init(movementDeps);
const detour = window.NpcPathfinding.findNpcPath('interior', 1.5, 1.5, 5, 1, { padding: 5, maxNodes: 600 }); // Forces a search around an exact-width wall missed by tile-only logic.
assert.ok(detour?.some(hop => hop.row >= 4), 'heap A* detours around sub-tile blockers');
let x = 1.5, z = 1.5;
for (const hop of detour) {
  assert.ok(window.NpcPathfinding.canNpcTraverse('interior', x, z, hop.col + 0.5, hop.row + 0.5),
    'every planned edge has a collision-free swept path');
  x = hop.col + 0.5;
  z = hop.row + 0.5;
}
assert.ok(window.NpcPathfinding.debugSnapshot().pathNodesExpanded > 0, 'path expansion diagnostics are populated');
assert.equal(typeof window.TilePathfinding.MinHeap, 'function', 'NPC A* can use the shared heap');

const safeArrival = window.NpcPathfinding.nearestWalkableTile('map_i_test', 3, 1); // Spawn selection must honor exact walls inside structurally open tiles.
assert.notDeepEqual(JSON.parse(JSON.stringify(safeArrival)), { c: 3, r: 1 },
  'building arrival is moved out of exact-footprint wall collisions');

const walker = {
  area: 'interior',
  root: { position: { x: 1.5, z: 1.5 } },
  moveToward(x, z) { this.root.position.x = x; this.root.position.z = z; return true; },
}; // A stationary walker must not spend time on collision probes.
let probes = 0;
movementDeps.furnitureBlocksMovementAt = () => { probes++; return false; };
window.NpcPathfinding.decorateWalkerCollision(walker);
walker.moveToward(1.5, 1.5, 1 / 60);
assert.equal(probes, 0, 'completed no-op walker movement skips all furniture collision probes');
const unresolvedWalker = {
  area: 'interior',
  root: { position: { x: 1.5, z: 1.5 } },
  moveToward() { return false; },
}; // A failed movement call must still run collision/recovery logic even without displacement.
window.NpcPathfinding.decorateWalkerCollision(unresolvedWalker);
unresolvedWalker.moveToward(3.5, 1.5, 1 / 60);
assert.ok(probes > 0, 'incomplete zero-displacement movement does not bypass collision/recovery checks');

// Standalone tools and tests that load only npc-pathfinding.js keep the old
// small-array search fallback instead of failing on a missing shared utility.
const isolatedWindow = { AreaFootprintBlockers: window.AreaFootprintBlockers };
const isolatedContext = vm.createContext({ window: isolatedWindow, console });
vm.runInContext(fs.readFileSync(path.join(root, 'docs/js/npc-pathfinding.js'), 'utf8'), isolatedContext);
isolatedWindow.NpcPathfinding.init(movementDeps);
const isolatedPath = isolatedWindow.NpcPathfinding.findNpcPath('interior', 1.5, 1.5, 5, 1, { padding: 5, maxNodes: 600 });
assert.ok(isolatedPath?.some(hop => hop.row >= 4), 'standalone A* remains functional without TilePathfinding');

console.log('NPC pathing/scheduling audit regressions passed.');
