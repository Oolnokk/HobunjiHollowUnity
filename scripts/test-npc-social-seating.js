#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

let hour = 15;
let day = 14;
let snapshots = {};
const stations = new Map();

function station(id, c, r, roles = ['sit']) {
  const value = { id, stationId: id, label: id, area: 'map_i_inn', c, r, pose: 'sit', roles };
  stations.set(id, value);
  return value;
}

const fixedLeaf = station('furniture_chair_map_i_inn_15_11', 15, 11);
station('furniture_chair_map_i_inn_5_10', 5, 10);
station('furniture_chair_map_i_inn_4_8', 4, 8);
station('furniture_chair_map_i_inn_3_11', 3, 11);
station('furniture_chair_map_i_inn_17_10', 17, 10);
station('furniture_chair_map_i_inn_2_9', 2, 9);

const activities = {
  STATUS: { READY: 'READY' },
  resolveDestination(beat, callerCtx) {
    return { status: 'READY', target: { ...(callerCtx.mockTarget || fixedLeaf), activity: beat.activity || '' }, reason: 'original' };
  },
};

const scheduling = {
  findStationsByRole(role, { area } = {}) {
    return [...stations.values()].filter(s => (!area || s.area === area) && s.roles.includes(role));
  },
};

const sandbox = {
  console,
  window: {
    SCRATCHBONES_CONFIG: { game: {} },
    CalendarSystem: {
      getHour: () => hour,
      timeDebugSnapshot: () => ({ rawDay: day }),
    },
    NpcAgenda: {
      dailySeed(npcId, dayValue, salt) {
        let h = 2166136261;
        const text = `${npcId}|${dayValue}|${salt}`;
        for (let i = 0; i < text.length; i++) {
          h ^= text.charCodeAt(i);
          h = Math.imul(h, 16777619);
        }
        return (h >>> 0) / 4294967296;
      },
    },
    NpcActivities: activities,
    NpcScheduling: scheduling,
    __farmDebugTools: {
      listNpcIds: () => Object.keys(snapshots),
      npcSnapshot: id => snapshots[id] || null,
    },
    __farmLog: () => {},
  },
};
vm.createContext(sandbox);
vm.runInContext(read('docs/config/npcs/social-relations.js'), sandbox, { filename: 'social-relations.js' });
vm.runInContext(read('docs/js/npc-social-seating-bridge.js'), sandbox, { filename: 'npc-social-seating-bridge.js' });

const Seating = sandbox.window.NpcSocialSeating;
assert(Seating, 'social seating bridge should initialize');

// Relationship tags stay semantically separate.
assert.deepEqual([...Seating.relationTags('namui_u_hakaru', 'sloomi')], ['friend']);
assert.deepEqual([...Seating.relationTags('namui_u_hakaru', 'takua_ao_hakaru')], ['family']);
assert.deepEqual([...Seating.relationTags('gorobi_ginju', 'gikali_ginju')], ['partner']);

// The ambient-dialogue friendship map agrees with the shared relationship
// data so Namu'i and Sloomi recognize each other socially outside seating too.
const ambientDialogue = JSON.parse(read('docs/config/dialogue/ambient-dialogue.json'));
assert(Array.isArray(ambientDialogue.npcGreetings?.namui_u_hakaru?.friends?.sloomi), 'Namu\'i should recognize Sloomi as a friend in ambient dialogue');
assert(Array.isArray(ambientDialogue.npcGreetings?.sloomi?.friends?.namui_u_hakaru), 'Sloomi should recognize Namu\'i as a friend in ambient dialogue');

// Leaf's formerly fixed inn seat becomes reactive and pulls toward Pahu,
// while still respecting occupancy (Leaf cannot choose Pahu's exact stool).
snapshots = {
  pahu: {
    area: 'map_i_inn', x: 4.5, z: 8.5,
    currentScheduleTarget: { stationId: 'furniture_chair_map_i_inn_4_8', c: 4, r: 8 },
  },
};
let result = sandbox.window.NpcActivities.resolveDestination(
  { id: 'legacy', activity: 'legacyScheduleActivity' },
  { rec: { id: 'leaf' }, now: { day, nowMin: 15 * 60 }, mockTarget: fixedLeaf });
assert.equal(result.target.stationId, 'furniture_chair_map_i_inn_5_10', 'Leaf should choose a free stool near Pahu instead of the authored fixed stool');
assert.equal(result.target.socialSeatSource, 'fixed-seat-redirect');

// The new Namu'i <-> Sloomi friendship affects ordinary role-based seating.
snapshots = {
  sloomi: {
    area: 'map_i_inn', x: 3.5, z: 11.5,
    currentScheduleTarget: { stationId: 'friend_anchor', c: 3, r: 11 },
  },
};
result = sandbox.window.NpcActivities.resolveDestination(
  { id: 'rest', activity: 'sit', destinationRole: 'sit', destinationArea: 'map_i_inn' },
  { rec: { id: 'namui_u_hakaru' }, now: { day, nowMin: 15 * 60 }, mockTarget: fixedLeaf });
assert.equal(result.target.stationId, 'furniture_chair_map_i_inn_3_11', 'Namu\'i should favor a seat by Sloomi when both are present');

// Taku'a first prefers Namu'i over generic family/friend scoring.
snapshots = {
  namui_u_hakaru: {
    area: 'map_i_inn', x: 3.5, z: 11.5,
    currentScheduleTarget: { stationId: 'namui_anchor', c: 3, r: 11 },
  },
  stranger: {
    area: 'map_i_inn', x: 16.5, z: 11.5,
    currentScheduleTarget: { stationId: 'stranger_anchor', c: 16, r: 11 },
  },
};
result = sandbox.window.NpcActivities.resolveDestination(
  { id: 'rest', activity: 'idle' },
  { rec: { id: 'takua_ao_hakaru' }, now: { day, nowMin: 15 * 60 }, mockTarget: fixedLeaf });
assert.equal(result.target.stationId, 'furniture_chair_map_i_inn_3_11', 'Taku\'a should sit by Namu\'i when she is present');

// If Namu'i is absent, Taku'a flips to solitude and picks the free seat with
// the greatest distance from the rest of the room.
snapshots = {
  stranger_a: {
    area: 'map_i_inn', x: 3.5, z: 10.5,
    currentScheduleTarget: { stationId: 'stranger_a_anchor', c: 3, r: 10 },
  },
  stranger_b: {
    area: 'map_i_inn', x: 5.5, z: 9.5,
    currentScheduleTarget: { stationId: 'stranger_b_anchor', c: 5, r: 9 },
  },
};
result = sandbox.window.NpcActivities.resolveDestination(
  { id: 'rest', activity: 'idle' },
  { rec: { id: 'takua_ao_hakaru' }, now: { day, nowMin: 15 * 60 }, mockTarget: fixedLeaf });
assert.equal(result.target.stationId, 'furniture_chair_map_i_inn_17_10', 'Taku\'a should choose the most isolated valid seat when Namu\'i is absent');

// Beat, time-of-day, and day all participate in relationship weighting.
const rec = { id: 'weight_probe' };
hour = 9;
const breakfast = Seating.effectiveRelationshipWeights(rec, { activity: 'eat' }, { now: { day: 14, nowMin: 9 * 60 } });
hour = 15;
const afternoonSocial = Seating.effectiveRelationshipWeights(rec, { activity: 'socialize' }, { now: { day: 14, nowMin: 15 * 60 } });
assert(breakfast.weights.family > afternoonSocial.weights.family, 'meal/morning context should lean more familyward');
assert(afternoonSocial.weights.friend > breakfast.weights.friend, 'social/afternoon context should lean more friendward');
const nextDay = Seating.effectiveRelationshipWeights(rec, { activity: 'socialize' }, { now: { day: 15, nowMin: 15 * 60 } });
assert.notEqual(nextDay.weights.friend, afternoonSocial.weights.friend, 'deterministic daily variation should shift relationship priorities between days');

const debug = Seating.debugSnapshot('takua_ao_hakaru');
assert(debug?.candidates?.length >= 2, 'mobile/debug snapshot should expose candidate seat scores');
assert.equal(debug.chosenStationId, 'furniture_chair_map_i_inn_17_10');

console.log('npc social seating tests passed');
