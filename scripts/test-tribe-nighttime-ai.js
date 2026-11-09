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

let retired = 0, abstract = 0, neutralized = 0, greeted = 0, provoked = 0;
let observed = true, fighting = false, hostile = false;
const tickContext = vm.createContext({
  Math, Promise, window: { __farmLog() {} }, KEY: 'porakaneki',
  combatDeps: { TILE: 64 }, currentArea: () => 'map_western_slope',
  sharesPlayerChunk: () => observed, sleepPointFor: () => ({ col: 3, row: 4 }),
  gameDay: () => 1, peacefulRapport: () => true, favor: () => 2,
  campProvoked: () => hostile, makeHostile: actor => { provoked++; actor.state = 'chase'; },
  makeNeutral: actor => { neutralized++; actor.state = 'return'; },
  validChunkCombatTarget: () => fighting,
  chooseHunterActivity() {}, rand: () => 0.5, cfg: { behavior: {}, reputation: {} },
  num: (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback,
  maybeHunterGreeting: () => { greeted++; },
  retireDormantEntity: () => { retired++; },
  advanceAbstractHunter: () => { abstract++; },
  materializeHunter: () => Promise.resolve(null),
  placeEntity() {}, // The extracted production placement helper calls this when its synthetic rig is first observed.
});
vm.runInContext(
  sourceBetween(runtime, '  function updateDetailedHunter(', '  // Off-screen losses are replaced')
    + '\nthis.updateHunterTick = updateCampHunterTick;', tickContext,
);
const actor = { health: 20, x: 3 * 64, y: 4 * 64, state: 'idle', _chunkCombatTarget: null };
const hunter = { entity: actor, camp: { zoneId: 'map_western_slope' }, x: 3, y: 4, activity: 'wander', target: null, decisionT: 0 };
tickContext.updateHunterTick(hunter, .21, 0, true, 1);
assert.equal(retired, 0, 'nearby hunter must not despawn at night');
assert.equal(actor.state, 'return', 'sleeping visible hunter delegates travel to native movement');
assert.equal(hunter.activity, 'sleep', 'nighttime plan heads for an authored sleep point');
assert.equal(greeted, 1, 'nearby friend can still greet while settling for the night');

fighting = true;
actor._chunkCombatTarget = { health: 20 };
tickContext.updateHunterTick(hunter, .21, 0, true, 1);
assert.equal(actor.state, 'chase', 'nearby rival combat still runs at night');
assert.equal(neutralized, 1, 'sleep planner does not cancel a committed attack');
fighting = false;
hostile = true;
tickContext.updateHunterTick(hunter, .21, 0, true, 1);
assert.equal(provoked, 1, 'provoked night hunter attacks the player');
hostile = false;
observed = false;
tickContext.updateHunterTick(hunter, .21, 0, true, 1);
assert.equal(retired, 1, 'out-of-range sleeping hunters still become cheap abstract data');
assert.equal(abstract, 1, 'out-of-range sleeping hunters advance without a native rig');

const calls = [];
const zoneContext = vm.createContext({
  state: { zones: new Map([['current', { zoneId: 'current', hunters: [] }], ['cached', { zoneId: 'cached', hunters: [] }]]) },
  currentArea: () => 'current',
  activeCamps: zone => [zone],
  updateCampHunters: (camp, dt, coarseDt) => {
    calls.push([camp.zoneId, coarseDt]);
    camp.hunters.push({ role: 'resident' }); // Mimics the first tick seeding data-only residents.
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
zoneContext.updateAllHunters(.2, 4);
assert.deepEqual(calls.slice(3).map(c => c[0]), ['current', 'cached'], 'cached zones retain coarse simulation');

const lodContext = vm.createContext({ performance: { now: () => 10000 } });
vm.runInContext(sourceBetween(lod, '  function canSleepBandit(', '  function setBanditVisuals(')
  + '\nthis.canSleepBandit = canSleepBandit;', lodContext);
const idle = { isBandit: true, health: 20, state: 'idle' };
assert.equal(lodContext.canSleepBandit(idle), true, 'ordinary bandits still benefit from distant sleep');
assert.equal(lodContext.canSleepBandit({ ...idle, isTribeHunter: true }), false, 'tribal residents have one LOD owner');
assert.equal(lodContext.canSleepBandit({ ...idle, isPorakanekiHunter: true }), false, 'legacy tribal flags are also exempt');

assert(runtime.includes('const rivalsByTribe = new Map()'), 'share target candidate rosters per tribe');
assert(runtime.includes('const sharedEnemy = close && hasSharedEnemyNearby(entity)'), 'only scan crossfire threats when damaged');
console.log('tribe night, combat, greeting and AI LOD regressions passed');
