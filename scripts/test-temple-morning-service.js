#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const stations = new Map();
for (const [id, col, row, seatIndex] of [
  ['station_temple_pew_6', 7, 7, 1],
  ['station_temple_pew_7', 11, 7, 0],
  ['station_temple_pew_8', 7, 9, 1],
  ['station_temple_pew_9', 11, 9, 0],
  ['station_temple_pew_10', 7, 11, 1],
  ['station_temple_pew_11', 11, 11, 0],
]) {
  stations.set(id, { id, stationId: id, area: 'map_i_temple', c: col, r: row, pose: 'sit', furnitureKey: 'benchFurniture', seatIndex });
}

const clock = { weekday: 'Anan', hour: 9.5, rawDay: 7 };
let ordinaryCalls = 0;
const window = {
  CalendarSystem: {
    currentWeekdayName: () => clock.weekday,
    getHour: () => clock.hour,
    timeDebugSnapshot: () => ({ rawDay: clock.rawDay }),
  },
  NpcScheduling: {
    stationsById: stations,
    registerNpcStations(list, fallbackArea) {
      for (const input of list) {
        const station = { ...input, area: input.area || fallbackArea, stationId: input.id };
        stations.set(station.id, station);
      }
    },
    resolveNpcStationTarget(id) {
      const station = stations.get(id);
      return station ? { ...station, stationId: station.id } : null;
    },
  },
  NpcActivityPlanner: {
    resolveNpcTarget(rec) {
      ordinaryCalls++;
      if (rec.id === 'father_hunundi_hodu') return { area: 'map_i_temple', c: 9, r: 5, stationId: 'station_temple_altar', activity: 'leading Temple Service' };
      return { area: 'town', c: 2, r: 3, activity: 'ordinary routine' };
    },
  },
  __farmDebugTools: {},
};
window.window = window;

vm.runInNewContext(fs.readFileSync('docs/config/npcs/social-relations.js', 'utf8'), { window, console }, { filename: 'social-relations.js' });

const enghSho = { id: 'spearhead_unumanuk', speciesId: 'engh-sho', tags: ['villager'] };
const otherVillager = { id: 'test_other_villager', speciesId: 'mao-ao', tags: ['villager'] };
const excluded = { id: 'talisman_hatayap', tags: ['villager'] };
const nonVillager = { id: 'test_non_villager', tags: ['visitor'] };
const father = { id: 'father_hunundi_hodu', tags: ['villager'] };

const enghTarget = window.NpcActivityPlanner.resolveNpcTarget(enghSho, {});
assert.equal(enghTarget.area, 'map_i_temple', 'Engh-sho villagers attend the Anan morning service');
assert.equal(enghTarget.activity, 'Temple Service');
assert.match(enghTarget.stationId, /^station_temple_pew_(?:[1-9]|1[01])$/);
assert.equal(ordinaryCalls, 0, 'community service interrupts the ordinary personal agenda');

const otherTarget = window.NpcActivityPlanner.resolveNpcTarget(otherVillager, {});
assert.equal(otherTarget.area, 'map_i_temple', 'other villagers attend the same morning service');
assert.notEqual(otherTarget.stationId, enghTarget.stationId, 'free pews are allocated without immediately stacking villagers');

for (let i = 1; i <= 11; i++) assert(stations.has(`station_temple_pew_${i}`), `pew ${i} is registered`);
for (let i = 1; i <= 5; i++) {
  const station = stations.get(`station_temple_pew_${i}`);
  assert.equal(station.furnitureKey, 'benchFurniture', `restored pew ${i} remains bench-bound`);
  assert.equal(station.pose, 'sit', `restored pew ${i} remains seated`);
}

const fatherTarget = window.NpcActivityPlanner.resolveNpcTarget(father, {});
assert.equal(fatherTarget.stationId, 'station_temple_altar', 'Father Hunundi keeps leading the service instead of sitting in the congregation');
assert.equal(window.NpcActivityPlanner.resolveNpcTarget(excluded, {}).activity, 'ordinary routine', 'authored service exclusions remain outside the congregation');
assert.equal(window.NpcActivityPlanner.resolveNpcTarget(nonVillager, {}).activity, 'ordinary routine', 'non-villagers are not pulled into village service');

clock.hour = 11;
assert.equal(window.NpcActivityPlanner.resolveNpcTarget(enghSho, {}).activity, 'ordinary routine', 'service ends at 11:00');
clock.hour = 9.5;
clock.weekday = 'Hodu';
assert.equal(window.NpcActivityPlanner.resolveNpcTarget(enghSho, {}).activity, 'ordinary routine', 'service only runs on Anan');

clock.weekday = 'Anan';
const debug = window.__farmDebugTools.communityScheduleSnapshot('spearhead_unumanuk');
assert.equal(debug.activeScheduleId, 'shared_temple_service', 'mobile debug snapshot reports the active service');
const scheduleDebug = debug.schedules.find(schedule => schedule.id === 'shared_temple_service');
assert.equal(scheduleDebug.registeredStationIds.length, 11, 'debug snapshot exposes all registered service pews');
assert.match(debug.latestChange, /Morning Temple Service/);

console.log('temple morning service scheduling tests passed');
