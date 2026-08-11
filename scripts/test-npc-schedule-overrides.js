#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(process.argv[2] || 'docs/js/local-db-overrides.js', 'utf8');
const overrides = JSON.parse(fs.readFileSync(process.argv[3] || 'docs/config/npcs/schedule-overrides.json', 'utf8'));
const carpenter = JSON.parse(fs.readFileSync(process.argv[4] || 'docs/config/maps/map_i_carpenters.json', 'utf8'));
const dynamicSources = JSON.parse(fs.readFileSync(process.argv[5] || 'docs/config/npcs/dynamic-station-sources.json', 'utf8'));
const inn = process.argv[6] ? JSON.parse(fs.readFileSync(process.argv[6], 'utf8')) : null;

const sandbox = {
  window: {},
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  console,
  fetch: async () => { throw new Error('fetch is not used by this unit test'); },
};
vm.runInNewContext(source, sandbox, { filename: 'local-db-overrides.js' });
const apply = sandbox.window.LocalDBOverrides.applyNpcScheduleOverrides;
assert.equal(typeof apply, 'function', 'schedule override composer is exported');

const db = {
  npcs: [
    { id: 'hammerhead_tuhupnuk', name: 'Hammerhead Tuhupnuk', scheduleHooks: { rules: [] } },
    { id: 'hammerhead_tuhupnuk', name: 'Hammerhead Tuhupnuk', scheduleHooks: { rules: [] } },
    { id: 'foroji_funji', scheduleHooks: { rules: [
      { day: 'Naru', from: '08:00', to: '19:00', mapId: 'map_hobunji_town', stationId: 'station_foroji_music', activity: 'playing music all day, day off' },
      { from: '14:00', to: '19:00', mapId: 'map_hobunji_town', stationId: 'station_foroji_music', activity: 'playing music' },
    ] } },
    { id: 'dzibim_khibu', scheduleHooks: { defaultStationId: 'station_dzibim_home', rules: [
      { from: '17:00', to: '07:00', mapId: 'map_hobunji_town', stationId: 'station_dzibim_home', activity: 'home' },
    ] } },
    { id: 'dzahiri_khibu', scheduleHooks: { defaultStationId: 'station_dzahiri_home', rules: [
      { day: 'Uung', from: '08:00', to: '17:00', mapId: 'map_hobunji_town', stationId: 'station_dzahiri_home', activity: 'day off, at home' },
      { from: '08:00', to: '17:00', mapId: 'map_i_carpenters', stationId: 'station_car_crates', activity: 'carpentry' },
      { from: '17:00', to: '08:00', mapId: 'map_hobunji_town', stationId: 'station_dzahiri_home', activity: 'home' },
    ] } },
    { id: 'nashka_khibu', scheduleHooks: { defaultStationId: 'station_nashka_home', rules: [
      { day: 'Uung', from: '08:00', to: '17:00', mapId: 'map_hobunji_town', stationId: 'station_nashka_home', activity: 'day off, at home' },
      { from: '08:00', to: '17:00', mapId: 'map_i_carpenters', stationId: 'station_car_inventory', activity: 'carpentry work' },
      { from: '17:00', to: '08:00', mapId: 'map_hobunji_town', stationId: 'station_nashka_home', activity: 'home' },
    ] } },
    { id: 'kaboku_kunji', scheduleHooks: { rules: [
      { day: 'Muunu', from: '06:00', to: '19:00', mapId: 'map_i_kunjis_potions_F1', stationId: 'station_kaboku_dayoff', activity: 'enjoying a rare day off' },
      { from: '12:00', to: '19:00', mapId: 'map_hobunji_town', stationId: 'station_kaboku_avoid', activity: "staying out of Kinami's way" },
      { from: '19:00', to: '22:00', mapId: 'map_i_kunjis_potions_F2', stationId: 'station_jayis', activity: 'dinner upstairs' },
    ] } },
  ],
};

const composed = apply(db, overrides);
const byId = id => composed.npcs.find(npc => npc.id === id);
assert.equal(composed.npcs.filter(npc => npc.id === 'hammerhead_tuhupnuk').length, 0, 'all duplicate Hammerhead records are removed before runtime spawning');
assert(overrides.removeNpcIds.includes('hammerhead_tuhupnuk'), 'Hammerhead is explicitly marked removed in the runtime NPC corrections');

for (const [npcId, stationId] of [
  ['dzibim_khibu', 'furniture_chair_map_i_carpenters_12_8'],
  ['dzahiri_khibu', 'furniture_chair_map_i_carpenters_13_8'],
  ['nashka_khibu', 'furniture_chair_map_i_carpenters_12_9'],
]) {
  const npc = byId(npcId);
  assert.equal(npc.scheduleHooks.defaultStationId, stationId, `${npcId} default is an indoor stool`);
  for (const rule of npc.scheduleHooks.rules.filter(r => r.sourceStationId)) {
    assert.equal(rule.mapId, 'map_i_carpenters', `${npcId} redirected home rule is indoors`);
    assert.equal(rule.stationId, stationId, `${npcId} redirected home rule uses its stool`);
  }
}

for (const rule of byId('foroji_funji').scheduleHooks.rules.filter(r => r.sourceStationId === 'station_foroji_music')) {
  assert.equal(rule.stationId, undefined, 'Foroji no longer resolves the stale square station');
  assert.equal(rule.mapId, 'map_hobunji_town');
  assert.equal(rule.c, 26);
  assert.equal(rule.r, 34);
}

const kabokuRules = byId('kaboku_kunji').scheduleHooks.rules;
assert(!kabokuRules.some(rule => rule.stationId === 'station_kaboku_avoid'), 'old outdoor Kaboku avoidance station is gone');
const generatedKaboku = kabokuRules.filter(rule => rule.generatedScheduleOverride === 'kaboku_afternoon_family_or_inn');
assert(generatedKaboku.length >= 7, 'Kaboku gets day-aware social destination rules');
assert(generatedKaboku.some(rule => rule.stationId === 'furniture_chair_map_i_carpenters_13_9' && rule.activity === 'visiting family'), 'Kaboku visits a family stool when Dzahiri or Nashka is there');
assert.equal(kabokuRules[0].stationId, 'station_kaboku_dayoff', 'Kaboku day-off rule keeps higher priority');

const absentDb = JSON.parse(JSON.stringify(db));
for (const watchedId of ['dzahiri_khibu', 'nashka_khibu']) {
  const watched = absentDb.npcs.find(npc => npc.id === watchedId);
  watched.scheduleHooks.rules.forEach(rule => { rule.mapId = 'map_hobunji_town'; });
}
const absentKaboku = apply(absentDb, overrides).npcs.find(npc => npc.id === 'kaboku_kunji');
assert(absentKaboku.scheduleHooks.rules.some(rule => rule.generatedScheduleOverride === 'kaboku_afternoon_family_or_inn'
  && rule.stationId === 'furniture_chair_map_i_inn_16_9' && rule.activity === 'avoiding Kinami'),
  'Kaboku falls back to an inn stool when neither family member is at the Khibu house');

const twice = apply(composed, overrides);
assert.deepEqual(JSON.parse(JSON.stringify(twice)), JSON.parse(JSON.stringify(composed)), 'schedule composition is idempotent');

const stools = new Set(carpenter.furniture.filter(item => item.itemKey === 'stoolFurniture').map(item => `${item.col},${item.row}`));
for (const coord of ['12,8', '13,8', '12,9', '13,9']) assert(stools.has(coord), `Khibu house has stool ${coord}`);
const dynamicIds = new Set(dynamicSources.sources.map(source => source.idPattern));
for (const id of [
  'furniture_chair_map_i_carpenters_12_8',
  'furniture_chair_map_i_carpenters_13_8',
  'furniture_chair_map_i_carpenters_12_9',
  'furniture_chair_map_i_carpenters_13_9',
  'furniture_chair_map_i_inn_16_9',
]) assert(dynamicIds.has(id), `${id} is documented for schedule tooling`);
if (inn) assert(inn.furniture.some(item => item.itemKey === 'stoolFurniture' && item.col === 16 && item.row === 9), 'Kaboku inn fallback stool exists');

console.log('npc schedule override tests passed');
