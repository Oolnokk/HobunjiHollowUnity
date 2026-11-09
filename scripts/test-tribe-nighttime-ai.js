#!/usr/bin/env node
'use strict';

// Regressions for visible sleeping tribe hunters, ecology combat and competing LOD.
// Extract the production functions so that no browser/WebGL environment is required.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const runtime = fs.readFileSync('docs/js/porakaneki-camps-runtime.js', 'utf8'); // Source of the tribe planner's real tick logic.
const lod = fs.readFileSync('docs/js/wilderness-simulation-lod.js', 'utf8'); // Source of the generic bandit sleep gate.

function sourceBetween(source, before, after) {
  const first = source.indexOf(before), last = source.indexOf(after, first);
  assert(first >= 0 && last > first, 'function boundaries must exist: ' + before);
  return source.slice(first, last);
}

let retired = 0, abstract = 0, greeted = 0, provoked = 0, activityDecisions = 0; // Records daytime planner transitions in the live entity handoff.
let observed = true, fighting = false, hostile = false;
const tickContext = vm.createContext({
  Math, Promise, window: { __farmLog() {} }, KEY: 'porakaneki',
  combatDeps: { TILE: 64 }, currentArea: () => 'map_western_slope',
  sharesPlayerChunk: () => observed, sleepPointFor: () => ({ col: 5, row: 6 }),
  gameDay: () => 1, peacefulRapport: () => true, favor: () => 2,
  campProvoked: () => hostile, makeHostile: actor => { provoked++; actor.state = 'chase'; },
  travelSpeedTiles: () => 1.05, // The real makeNeutral converts this authored tile speed into the shared hostile movement speed.
  validChunkCombatTarget: () => fighting,
  chooseHunterActivity(hunter) { activityDecisions++; hunter.activity = 'wander'; hunter.target = { col: 8, row: 9 }; },
  rand: () => 0.5, cfg: { behavior: {}, reputation: {} },
  num: (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback,
  maybeHunterGreeting: () => { greeted++; },
  retireDormantEntity: () => { retired++; },
  advanceAbstractHunter: () => { abstract++; },
  materializeHunter: () => Promise.resolve(null),
  placeEntity() {}, // The extracted production placement helper calls this when its synthetic rig is first observed.
});
vm.runInContext(
  sourceBetween(runtime, '  function makeNeutral(', '  function makeHostile(')
    + '\n' + sourceBetween(runtime, '  function updateDetailedHunter(', '  // Off-screen losses are replaced')
    + '\nthis.updateHunterTick = updateCampHunterTick;', tickContext,
);
const actor = { health: 20, x: 3 * 64, y: 4 * 64, state: 'idle', _chunkCombatTarget: null,
  def: { aggroRangePx: 5 * 64, moveSpeed: 120 } }; // The actual neutral handoff reads and writes ordinary humanoid combat stats.
const hunter = { entity: actor, camp: { zoneId: 'map_western_slope' }, x: 3, y: 4, activity: 'wander', target: null, decisionT: 0 };
tickContext.updateHunterTick(hunter, .21, 0, true, 1);
assert.equal(retired, 0, 'nearby hunter must not despawn at night');
assert.equal(actor.state, 'return', 'sleeping visible hunter delegates travel to native movement');
assert.equal(actor.homeX, 5 * 64, 'native return locomotion heads to the sleeping point');
assert.equal(actor.homeY, 6 * 64, 'native return locomotion tracks both axes');
assert.equal(hunter.activity, 'sleep', 'nighttime plan heads for an authored sleep point');
assert.equal(greeted, 1, 'nearby friend can still greet while settling for the night');

fighting = true;
actor._chunkCombatTarget = { health: 20 };
tickContext.updateHunterTick(hunter, .21, 0, true, 1);
assert.equal(actor.state, 'chase', 'nearby rival combat still runs at night');
assert.equal(actor.homeX, 5 * 64, 'sleep planner does not reset the committed chase destination');
fighting = false;
hostile = true;
tickContext.updateHunterTick(hunter, .21, 0, true, 1);
assert.equal(provoked, 1, 'provoked night hunter attacks the player');
hostile = false;
actor._chunkCombatTarget = null;
tickContext.updateHunterTick(hunter, .21, 0, false, 1);
assert.equal(activityDecisions, 1, 'daytime resumes the normal wander/social decision planner');
assert.equal(actor.homeX, 8 * 64, 'awake planner gives the shared native movement a fresh waypoint');
assert.equal(actor.homeY, 9 * 64, 'daytime waypoint also updates the second axis');
assert.equal(actor.state, 'return', 'daytime movement still delegates to the shared hostile return loop');
observed = false;
tickContext.updateHunterTick(hunter, .21, 0, true, 1);
assert.equal(retired, 1, 'out-of-range sleeping hunters still become cheap abstract data');
assert.equal(abstract, 1, 'out-of-range sleeping hunters advance without a native rig');

const calls = [];
let tacticalTicks = 0; // Tracks cheap off-screen Avenger decisions independently of whole-camp movement updates.
let remoteSleeping = false; // Simulated calendar night/day transition for cached wilderness camps.
let remoteDay = 1; // Synthetic world day to verify immediate distant slain-resident replacement and new daily patrols.
const zoneContext = vm.createContext({
  state: { zones: new Map([['current', { zoneId: 'current', hunters: [], huntingParties: [] }], ['cached', { zoneId: 'cached', hunters: [], huntingParties: [], avengerBand: {} }]]) },
  currentArea: () => 'current', isSleepingHour: () => remoteSleeping, gameDay: () => remoteDay,
  activeCamps: zone => [zone], updateAvengerBand: () => { tacticalTicks++; },
  updateCampHunters: (camp, dt, coarseDt) => {
    calls.push([camp.zoneId, coarseDt]);
    if (!camp.hunters.length) camp.hunters.push({ role: 'resident' }); // Mimics first-tick seeding without double-spawning.
    camp.huntingParties = remoteSleeping ? [] : [{ id: camp.zoneId + ':hunt' }]; // Mirrors the production night disband and day re-formation.
  },
  window: { __farmLog() {} }, KEY: 'porakaneki',
});
vm.runInContext(
  sourceBetween(runtime, '  function updateAllHunters(', '  async function loadConfig(')
    + '\nthis.updateAllHunters = updateAllHunters;', zoneContext,
);
zoneContext.updateAllHunters(.2, 0);
assert.deepEqual(calls.map(c => c[0]), ['current', 'cached'], 'cached zones initialize their population on the first tick');
zoneContext.updateAllHunters(.2, 0);
assert.deepEqual(calls.slice(2).map(c => c[0]), ['current'], 'initialized cached zones skip high-rate AI');
assert.equal(tacticalTicks, 1, 'Avengers retain fast tactical decisions while remote residents do not move');
zoneContext.updateAllHunters(.2, 4);
assert.deepEqual(calls.slice(3).map(c => c[0]), ['current', 'cached'], 'cached zones retain coarse simulation');
const remote = zoneContext.state.zones.get('cached');
remoteSleeping = true;
zoneContext.updateAllHunters(.2, 0);
assert.equal(remote.huntingParties.length, 0, 'offscreen parties stand down immediately at bedtime, without a coarse tick');
remoteSleeping = false;
zoneContext.updateAllHunters(.2, 0);
assert.equal(remote.huntingParties.length, 1, 'offscreen parties regroup on the first daylight tick');
const remoteUpdates = calls.filter(c => c[0] === 'cached').length;
zoneContext.updateAllHunters(.2, 0);
assert.equal(calls.filter(c => c[0] === 'cached').length, remoteUpdates, 'remote camp does not update unnecessarily between schedule transitions');
remoteDay += 2;
zoneContext.updateAllHunters(.2, 0);
assert.equal(calls.filter(c => c[0] === 'cached').length, remoteUpdates + 1, 'slain residents and daily patrols refresh immediately at a new game day');

const lodContext = vm.createContext({ performance: { now: () => 10000 } });
vm.runInContext(sourceBetween(lod, '  function canSleepBandit(', '  function setBanditVisuals(')
  + '\nthis.canSleepBandit = canSleepBandit;', lodContext);
const idle = { isBandit: true, health: 20, state: 'idle' };
assert.equal(lodContext.canSleepBandit(idle), true, 'ordinary bandits still benefit from distant sleep');
assert.equal(lodContext.canSleepBandit({ ...idle, isTribeHunter: true }), false, 'tribal residents have one LOD owner');
assert.equal(lodContext.canSleepBandit({ ...idle, isPorakanekiHunter: true }), false, 'legacy tribal flags are also exempt');
const snapshotContext = vm.createContext({
  deps: { hostileObjects: new Set([
    idle,
    { ...idle, isTribeHunter: true, _wildlifeVisualLodHidden: true },
    { ...idle, isPorakanekiHunter: true },
    { health: 20, creatureKey: 'grehlr', _wildlifeVisualLodHidden: true },
  ]) },
  isSleeping: () => false, window: {}, sleepTransitions: 0, wakeTransitions: 0,
  BANDIT_WAKE_RADIUS_TILES: 14, BANDIT_SLEEP_RADIUS_TILES: 18, BANDIT_LOD_CHECK_INTERVAL_S: .25,
});
vm.runInContext(sourceBetween(lod, '  function snapshot() {', '  window.WildernessSimulationLOD =')
  + '\nthis.snapshot = snapshot;', snapshotContext);
const lodSnapshot = snapshotContext.snapshot();
assert.equal(lodSnapshot.totalBandits, 1, 'ordinary bandits remain separately counted');
assert.equal(lodSnapshot.tribalHunters, 2, 'tribal humanoids have an explicit mobile diagnostic total');
assert.equal(lodSnapshot.totalWildlife, 1, 'tribal humanoids cannot inflate the wildlife total');

assert(runtime.includes('const rivalsByTribe = new Map()'), 'share target candidate rosters per tribe');
assert(runtime.includes('const sharedEnemy = close && hasSharedEnemyNearby(entity)'), 'only scan crossfire threats when damaged');
console.log('tribe night, combat, greeting and AI LOD regressions passed');
