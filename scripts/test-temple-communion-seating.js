#!/usr/bin/env node
'use strict';

// Spirit Communion benches must be registered as real, individually reservable
// social seats; the leader's dedicated stool stays an exact station.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const temple = JSON.parse(read('docs/config/maps/map_i_temple.json'));
const sandbox = { console, window: {} };
vm.createContext(sandbox);
const load = name => vm.runInContext(read(name), sandbox, { filename: name });

load('docs/js/map-layout-system.js');
const Layout = sandbox.window.MapLayoutSystem;
const time = minutes => ({ minutes, weekday: 'Anan', dateOrdinal: 3 });
const communion = Layout.getEffectiveMapData(temple, time(60));
assert.equal(communion.activeLayoutId, 'spirit_communion');
const benches = communion.npcStations.filter(station => station.roles?.includes('spirit_communion'));
assert.equal(benches.length, 14, 'seven communion benches expose two seats each');
assert.equal(new Set(benches.map(station => station.id)).size, 14, 'each seat has its own id');
for (const station of benches) {
  const bench = communion.furniture.find(piece => piece.id === station.furnitureId);
  assert(bench && bench.itemKey === 'benchFurniture', 'every seat has a present physical bench');
  assert.equal(station.sourceFurnitureId, bench.id, 'seat follows the furniture instance');
  assert.equal(station.col, bench.col + (bench.postX || 0));
  assert.equal(station.row, bench.row + (bench.postZ || 0));
  assert.equal(station.rotY, bench.rotY);
  assert.equal(station.seatIndex === 0 || station.seatIndex === 1, true);
  assert.equal(station.lookAt.col, 9);
  assert.equal(station.lookAt.row, 9);
}
assert(communion.npcStations.some(station => station.id === 'station_temple_altar'), 'base NPC stations remain during the event');
const stool = communion.furniture.find(piece => piece.id === 'fmtsv6eoligq5');
const leaderStation = communion.npcStations.find(station => station.id === 'station_temple_counsel_teacup');
assert.equal(leaderStation.furnitureId, stool.id, 'Teacup uses her exact stool, not a nearby seat by position');
assert.equal(leaderStation.seatIndex, 0);
assert.equal(Layout.getEffectiveMapData(temple, time(570)).npcStations.filter(station => station.roles?.includes('spirit_communion')).length, 0,
  'communion seats disappear when the ordinary temple layout returns');
Layout.setFlag('templeWedding', true);
const wedding = Layout.getEffectiveMapData(temple, time(570));
assert.equal(wedding.activeLayoutId, 'wedding');
assert(!wedding.npcStations.some(station => station.roles?.includes('spirit_communion')), 'communion seats do not leak into weddings');
Layout.setFlag('templeWedding', false);

load('docs/js/npc-scheduling.js');
sandbox.window.NpcScheduling.init({
  normalizeNpcArea: area => area,
  decorativeFurnitureDefs: { bench: { sit: true }, stool: { sit: true } },
  getDecorativeFurnitureKeyByItemKey: key => ({ benchFurniture: 'bench', stoolFurniture: 'stool' })[key] || '',
});
sandbox.window.NpcScheduling.registerNpcStations(communion.npcStations, 'map_i_temple');
const candidates = sandbox.window.NpcScheduling.findStationsByRole('spirit_communion', { area: 'map_i_temple' });
assert.equal(candidates.length, 14, 'NPC scheduling sees all event seat slots');
assert(candidates.every(station => station.pose === 'sit' && station.furnitureId && station.furnitureKey === 'bench'));

let snapshots = {};
sandbox.window.__farmDebugTools = {
  ...sandbox.window.__farmDebugTools,
  listNpcIds: () => Object.keys(snapshots),
  npcSnapshot: id => snapshots[id],
};
sandbox.window.CalendarSystem = { currentWeekdayName: () => 'Anan', getHour: () => 1, timeDebugSnapshot: () => ({ rawDay: 3 }) };
sandbox.window.NpcAgenda = { dailySeed: () => 0.5 };
sandbox.window.NpcActivities = {
  STATUS: { READY: 'READY' },
  resolveDestination(beat, ctx) { return { status: 'READY', target: { ...ctx.mockTarget, activity: beat.activity } }; },
  unavailable(reason) { return { status: 'ACTIVITY_UNAVAILABLE', reason, target: null }; },
};
load('docs/config/npcs/social-relations.js');
load('docs/js/npc-social-seating-bridge.js');
const resolve = (npcId, stationId) => sandbox.window.NpcActivities.resolveDestination(
  { id: 'legacy', activity: 'legacyScheduleActivity' },
  { rec: { id: npcId }, now: { day: 3, nowMin: 60 },
    mockTarget: sandbox.window.NpcScheduling.resolveNpcStationTarget(stationId) });

const attendees = ['binding_hatayap', 'spearhead_unumanuk', 'oddclaw_unumanuk', 'tooth_hatayap', 'bird_bone', 'additional_attendee'];
const taken = new Set();
for (const [index, npcId] of attendees.entries()) {
  const result = resolve(npcId, 'station_temple_counsel_ring_' + (index + 1));
  assert.equal(result.status, 'READY', npcId + ' gets a communion bench');
  assert.equal(result.target.socialSeatSource, 'temple-communion');
  assert(result.target.roles.includes('spirit_communion'), 'selected seat uses the event role');
  assert(!taken.has(result.target.stationId), 'no two NPCs share the same seat station');
  taken.add(result.target.stationId);
  snapshots[npcId] = { area: 'map_i_temple', currentScheduleTarget: result.target };
}
const leader = resolve('teacup_unumanuk', 'station_temple_counsel_teacup');
assert.equal(leader.target.stationId, 'station_temple_counsel_teacup', 'Teacup retains her authored role');
assert.equal(leader.target.furnitureId, stool.id);
assert.equal(leader.target.socialSeatSource, undefined, 'Teacup bypasses reactive seating');
snapshots = Object.fromEntries(candidates.map((seat, i) => ['occupant_' + i,
  { area: 'map_i_temple', currentScheduleTarget: seat }]));
assert.equal(resolve('late_guest', 'station_temple_counsel_ring_1').status, 'ACTIVITY_UNAVAILABLE',
  'no vacant seat means fall back to planner, not a floor seat under the bonfire');

console.log('Spirit Communion reactive seating tests passed');
