#!/usr/bin/env node
'use strict';

// Regression for the Stage 3 RAF-ownership migration: amphibious-fishing.js
// used to run one permanent featureLoop() RAF that bundled six unrelated
// responsibilities (install ResourceSystem rules, register Fish Leap,
// register the Gurumahi creature def, detect the active->caught fishing
// transition, prune dead/despawned amphibious creatures, and re-wrap
// BanditCamps). Each responsibility now hangs off the existing hook that
// actually owns its trigger instead (see
// docs/architecture/runtime-frame-scheduler.md's ownership audit and its
// Stage 3 notes): ResourceSystem/Combat module init, WildlifeSpawn init
// (already wired), Fishing.update(), CreatureDeath.updateCorpses(), and the
// existing BanditCamps hook. There is no frame function left at all.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/amphibious-fishing.js', 'utf8');
assert(!source.includes('requestAnimationFrame('), 'amphibious fishing must no longer own a direct requestAnimationFrame( call site');
assert(!source.includes('function featureLoop'), 'the combined per-frame featureLoop() must be fully removed');
assert(source.includes("hookWindowApi('ResourceSystem'"), 'ResourceSystem rules must install via its own module hook');
assert(source.includes("hookWindowApi('Combat'"), 'Fish Leap must register via the Combat module hook');
assert(source.includes('installResourceRules(RS)'), 'the ResourceSystem hook must actually call installResourceRules');
assert(source.includes('installFishLeap(combat)'), 'the Combat hook must actually call installFishLeap');

function buildContext() {
  const farmLogs = [];
  const context = {
    console,
    Math, Number, String, Object, Array, Set, Promise,
    window: null,
    performance: { now: () => 1000 },
  };
  context.window = context;
  context.__farmLog = (msg) => farmLogs.push(msg);
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'amphibious-fishing.js' });
  return { context, farmLogs };
}

const { context } = buildContext();
const AmphibiousFishing = context.AmphibiousFishing;
assert(AmphibiousFishing, 'module installs its public API even before any dependency exists');
assert.equal(AmphibiousFishing.getDebug().resourceRulesInstalled, false);
assert.equal(AmphibiousFishing.getDebug().fishLeapInstalled, false);

// --- ResourceSystem / Fish Leap: install exactly once when each module's own global appears ---
let resourceApplyDamageCalls = 0;
context.ResourceSystem = {
  AFFLICTIONS: {},
  applyDamage: (entity, amount) => { resourceApplyDamageCalls++; entity.health = (entity.health || 0) - amount; },
  tick: (entity, dt) => ({ entity, dt }),
  getEffectiveMax: (entity, key) => 100,
  enforceCaps: () => {},
};
assert.equal(AmphibiousFishing.getDebug().resourceRulesInstalled, true, 'assigning window.ResourceSystem installs the wounded/scent rules immediately, with no polling needed');
// Regression: hookWindowApi's accessor replaces window[name] with whatever
// its wrap callback returns. installResourceRules/installFishLeap report
// success as a boolean, so a naive `hookWindowApi('ResourceSystem',
// installResourceRules)` would silently replace the real ResourceSystem
// object with the boolean `true` for every other consumer in the game.
assert.equal(typeof context.ResourceSystem, 'object', 'window.ResourceSystem must remain the real object after hooking, not the boolean success flag');
assert(context.ResourceSystem.AFFLICTIONS.woundedHealth, 'wounded health affliction registered');
assert(context.ResourceSystem.AFFLICTIONS.scentMarkedHealth, 'scent-marked health affliction registered');

let registeredAttack = null;
context.Combat = { animalAttacks: { register: (id, def) => { registeredAttack = { id, def }; } } };
assert.equal(AmphibiousFishing.getDebug().fishLeapInstalled, true, 'assigning window.Combat installs Fish Leap immediately since Combat.animalAttacks already exists');
assert.equal(typeof context.Combat, 'object', 'window.Combat must remain the real object after hooking, not the boolean success flag');
assert.equal(registeredAttack?.id, 'fishLeap');

// --- WildlifeSpawn: Gurumahi creature def registers via its own init(), no RAF backup ---
const CREATURE_DB = {};
context.WildlifeSpawn = {
  init(deps) { /* real WildlifeSpawn body would run here */ },
};
context.WildlifeSpawn.init({ CREATURE_DB, TILE: 32 });
assert(CREATURE_DB.gurumahi?.amphibiousFish, 'WildlifeSpawn.init() alone registers the Gurumahi creature def, with no per-frame fallback needed');
assert.equal(AmphibiousFishing.getDebug().creatureDefInstalled, true);

// --- Fishing.update(): detects the active->caught amphibious transition ---
let closedFishing = false;
let fishingState = { phase: 'cast', fishDef: null, _amphibiousStartedInWater: false, _amphibiousPendingQuality: null };
const inventory = { gurumahiFish: 1 };
context.FishCatalog = { get: key => ({ label: 'Gurumahi Fish' }) };
context.CookingSystem = { recordItemQuality: () => {} };
context.Fishing = {
  init(deps) {},
  beginCast() {},
  close() { closedFishing = true; },
  update(dt) { /* real per-frame minigame logic would run here */ },
  get state() { return fishingState; },
};
context.Fishing.init({ inventory, playerMesh: { position: { x: 5, z: 5 } }, getActiveTileAt: () => ({ type: 'river' }), showToast: () => {}, refreshActionBar: () => {} });

const amphibiousFishDef = { key: 'gurumahiFish', label: 'Gurumahi Fish', amphibious: true };
fishingState = { phase: 'active', fishDef: amphibiousFishDef, anchorWorld: { x: 5.5, z: 5.5 }, _amphibiousStartedInWater: true, _amphibiousPendingQuality: { stars: 4, amount: 1 } };
context.Fishing.update(0.016); // phase 'active' -> previousFishingPhase becomes 'active'; no transition yet.
assert.equal(closedFishing, false, 'no fight starts while phase is merely active');

let madeCreature = null;
context.WildlifeSpawn.makeCreatureEntity = undefined; // not part of WildlifeSpawn's public API in real code
const hostileObjects = { add: c => { madeCreature = c; } };
// Re-init WildlifeSpawn's captured deps with the fields spawnAmphibiousCatch actually needs.
context.WildlifeSpawn.init({ CREATURE_DB, TILE: 32, makeCreatureEntity: (kind, x, y, opts) => ({ kind, x, y, ...opts, id: 'c1', health: 48 }), hostileObjects });

fishingState.phase = 'caught'; // Same object reference mutated in place, as the real fishing-minigame.js does.
context.Fishing.update(0.016);
assert.equal(closedFishing, true, 'the active->caught transition (detected inside the wrapped update()) starts the amphibious fight, closing the minigame');
assert(madeCreature, 'a combat creature was spawned for the amphibious catch');
assert.equal(inventory.gurumahiFish, 0, 'the provisional catch was removed from inventory pending retrieval');

closedFishing = false;
context.Fishing.update(0.016); // Still 'caught' on the next call -> must not re-trigger.
assert.equal(closedFishing, false, 'staying in the caught phase across multiple update() calls does not re-trigger the fight');

// --- CreatureDeath.updateCorpses(): prunes liveAmphibiousCreatures ---
const corpseObjects = new Set();
let updateCorpsesCalls = 0;
context.CreatureDeath = {
  init(deps) {},
  begin(c) { return c; },
  updateCorpses(dt) { updateCorpsesCalls++; },
};
context.CreatureDeath.init({ corpseObjects });
madeCreature.state = 'corpse'; // Despawned via decay, not the Retrieve action, so corpseObjects never held it.
assert.equal(AmphibiousFishing.getDebug().liveCreatures.length, 1, 'the amphibious creature is still tracked before any updateCorpses() call');
context.CreatureDeath.updateCorpses(0.016);
assert.equal(updateCorpsesCalls, 1, 'the original updateCorpses behavior still runs exactly once');
assert.equal(AmphibiousFishing.getDebug().liveCreatures.length, 0, 'updateCorpses() prunes the despawned amphibious creature, with no separate poll needed');

// A live (non-corpse) creature must never be pruned by updateCorpses().
// Trigger a second real catch transition so a second entry actually lands
// in the module's private liveAmphibiousCreatures set (not directly
// reachable from this test) rather than faking one from the outside.
fishingState = { phase: 'active', fishDef: amphibiousFishDef, anchorWorld: { x: 6.5, z: 6.5 }, _amphibiousStartedInWater: true, _amphibiousPendingQuality: { stars: 3, amount: 1 } };
inventory.gurumahiFish = 1;
context.Fishing.update(0.016);
fishingState.phase = 'caught';
context.Fishing.update(0.016);
assert.equal(AmphibiousFishing.getDebug().liveCreatures.length, 1, 'a fresh amphibious catch is tracked again as a live (chasing) creature');
context.CreatureDeath.updateCorpses(0.016);
assert.equal(AmphibiousFishing.getDebug().liveCreatures.length, 1, 'a live, non-corpse creature is untouched by the prune');

// --- BanditCamps: corpse wrapper still installs via its existing hook ---
let originalCorpseCalls = 0;
context.BanditCamps = { makeCorpseWorldObject: c => { originalCorpseCalls++; return { generic: true }; } };
const amphibiousCorpse = { isAmphibiousFishCorpse: true, id: 'c1', _amphibiousFishItemKey: 'gurumahiFish', _amphibiousFishLabel: 'Gurumahi Fish', _amphibiousFishStars: 4 };
const built = context.BanditCamps.makeCorpseWorldObject(amphibiousCorpse);
assert.equal(originalCorpseCalls, 0, 'an amphibious corpse is handled by the wrapper, not the original bandit corpse builder');
assert(built.getButtons()[0].label.includes('Gurumahi'), 'the wrapped corpse object exposes the Retrieve action');
const genericCorpse = { isAmphibiousFishCorpse: false };
context.BanditCamps.makeCorpseWorldObject(genericCorpse);
assert.equal(originalCorpseCalls, 1, 'a non-amphibious corpse still falls through to the original bandit corpse builder');

console.log('amphibious fishing event-driven migration passed');
