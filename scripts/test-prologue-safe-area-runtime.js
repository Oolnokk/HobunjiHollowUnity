'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/prologue-safe-area-runtime.js', 'utf8'); // Runtime under test: rescue-area hostile/bandit suppression.
let banditEnsureCalls = 0; // Proves ordinary camp seeding never runs in the scripted rescue area.
let encounterCalls = 0; // Proves road-ambush updates never run there either.
let wildlifeCalls = 0; // Proves den/nest spawning never runs there.
let banditMarked = 0; // Proves entering the rescue area is not queued for camp rerolls.
let forgotten = 0; // Proves stale bandit state is explicitly discarded.
let despawned = 0; // Counts hostiles physically removed from the rescue set.

const banditApi = {
  init(deps) { this.deps = deps; },
  ensureCurrentZoneCamps() { banditEnsureCalls++; },
  updateRandomEncounters() { encounterCalls++; },
  updateTentInteraction() {},
  updateCompanionPerception() {},
  markZoneEntered() { banditMarked++; },
  forgetZoneState() { forgotten++; },
};
const wildlifeApi = {
  init(deps) { this.deps = deps; },
  updateHostileSpawning() { wildlifeCalls++; },
  onZoneEntered() { wildlifeCalls++; },
};

const rescueBandit = { id: 'bandit', areaId: 'map_prologue_rescue', banditCampInstanceId: 'camp1' };
const rescueWolf = { id: 'wolf', areaId: 'map_prologue_rescue' };
const authoredActor = { id: 'authored', areaId: 'map_prologue_rescue', prologueAuthored: true };
const elsewhere = { id: 'elsewhere', areaId: 'map_southern_cloud_forest' };
const hostileObjects = new Set([rescueBandit, rescueWolf, authoredActor, elsewhere]);
const sharedDeps = {
  hostileObjects,
  getCurrentArea: () => 'map_prologue_rescue',
  despawnCreature() { despawned++; },
};

const windowObject = {
  BanditCamps: banditApi,
  WildlifeSpawn: wildlifeApi,
  GridTileAccessors: { getCurrentArea: () => 'map_prologue_rescue' },
  PrologueRescueZoneCompat: { debugSnapshot: () => ({ suppressProceduralPopulation: true }) },
};
const context = { window: windowObject, console };
context.window.window = context.window;
vm.runInNewContext(source, context, { filename: 'prologue-safe-area-runtime.js' });

windowObject.BanditCamps.init(sharedDeps);
windowObject.WildlifeSpawn.init(sharedDeps);
assert.equal(windowObject.PrologueSafeAreaRuntime.isSuppressedArea(), true, 'rescue area must be classified as population-suppressed');

windowObject.BanditCamps.ensureCurrentZoneCamps();
windowObject.BanditCamps.updateRandomEncounters(1);
windowObject.BanditCamps.markZoneEntered('map_prologue_rescue');
windowObject.WildlifeSpawn.updateHostileSpawning(1);
windowObject.WildlifeSpawn.onZoneEntered('map_prologue_rescue');

assert.equal(banditEnsureCalls, 0, 'bandit camp seeding must never run in rescue');
assert.equal(encounterCalls, 0, 'bandit road encounters must never run in rescue');
assert.equal(banditMarked, 0, 'rescue entry must never queue bandit rerolls');
assert.equal(wildlifeCalls, 0, 'wildlife den/nest spawning must never run in rescue');
assert.ok(forgotten > 0, 'stale bandit state must be discarded while rescue is active');
assert.equal(hostileObjects.has(rescueBandit), false, 'already-created rescue bandit must be purged');
assert.equal(hostileObjects.has(rescueWolf), false, 'already-created rescue wildlife must be purged');
assert.equal(hostileObjects.has(authoredActor), true, 'future explicitly authored prologue hostiles/actors are exempt from procedural purge');
assert.equal(hostileObjects.has(elsewhere), true, 'hostiles in unrelated maps must remain untouched');
assert.ok(despawned >= 2, 'purged procedural rescue hostiles must be despawned from rendering too');

console.log('prologue scripted-area population suppression regression passed');
