#!/usr/bin/env node
'use strict';

// Exercise the production trinket definitions and actual weapon-hit integration,
// not just the buried-chest reward selection or text of the effects.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = path => fs.readFileSync(path, 'utf8'); // Reads the shipped implementations in the gameplay load order.
const player = { x: 0, y: 0, health: 100, maxHealth: 100 }; // Combat and trinket modifier providers share this exact wearer.
const gear = { trinkets: [], equippedTrinkets: [] }; // Mirrors the character-scoped save schema for trinket ownership.
const providers = []; // Registered stat providers used by the real trinket and hit-modifier APIs.
const hits = []; // Captures final Health/Footing values after the live weapon damage wrapper.
const saved = []; // Ensures every trinket acquisition/equipment change remains persisted by the established gear authority.
const windowObject = {
  Combat: {
    deps: { player, getGearInventory: () => gear, saveGearInventory: () => saved.push(true) },
    init(deps) { this.deps = deps; }, // Double-edged module decorates this actual initialization seam.
  },
  ResourceSystem: {
    registerStatModifierProvider(fn) { providers.push(fn); },
    statModifier(entity, key) { return providers.reduce((mul, fn) => mul * fn(entity, key), 1); },
    getEffectiveMax() { return 100; },
  },
}; // Minimal browser globals for the real player-only stat modifier stack.
const context = vm.createContext({ window: windowObject, console, Date, Math }); // The production browser IIFEs run without rewritten semantics.
vm.runInContext(source('docs/js/trinket-system.js'), context, { filename: 'trinket-system.js' });
vm.runInContext(source('docs/js/combat/double-edged-combat-trinkets.js'), context, { filename: 'double-edged-combat-trinkets.js' });

const trinkets = windowObject.TrinketSystem; // Real award/equip/save/unequip logic, including the Attunement budget.
const resource = windowObject.ResourceSystem; // Effective player stats as seen by live combat and resource systems.
const effects = [
  ['wanderersAnklet', 'staminaRegen', 1.25, 1],
  ['herbalistsPendant', 'healthRegen', 1.40, 1],
  ['rangersBeads', 'rangedDamage', 1.30, 2],
  ['brawlersRing', 'outgoingFootingDamage', 1.30, 2],
  ['guardiansBrooch', 'maxHealth', 1.20, 2],
  ['duelistsSignet', 'outgoingHealthDamage', 1.30, 3],
  ['wardensAmulet', 'maxFooting', 1.60, 3],
  ['fightersBelt', 'attackStaminaCost', 0.85, 2],
  ['swiftbladeRing', 'attackSpeed', 1.12, 2],
  ['defendersBrooch', 'incomingHealthDamage', 0.88, 2],
  ['steadfastBeads', 'incomingAffliction', 0.80, 2],
  ['runnersCord', 'maxStamina', 1.20, 2],
  ['masonsRing', 'footingRegen', 1.35, 2],
]; // Exact expected benefits/prices from the thirteen ordinary buried-treasure curios.
for (const [id, stat, expected, cost] of effects) {
  const before = saved.length; // Confirms character gear is saved on acquisition/equip/unequip.
  const claim = { ['trinket_' + id]: 1 }; // Uses the same key format and claim path as an opened chest.
  const labels = trinkets.claimLoot(claim, 'buried-treasure');
  assert.equal(Object.keys(claim).length, 0, 'claimLoot consumes the gear-trinket key before ordinary inventory handling');
  assert.equal(labels.length, 1, id + ' displays its actual owned trinket name');
  const owned = trinkets.ownedEntries().find(entry => entry.id === id); // Real character-scope trinket record.
  assert(owned, id + ' was added to character gear');
  assert.equal(trinkets.costOf(id), cost, id + ' costs the intended Attunement');
  assert.equal(trinkets.equip(owned.uid).ok, true, id + ' can be equipped');
  assert(Math.abs(resource.statModifier(player, stat) - expected) < 1e-8, id + ' applies its defined bonus to the wearer');
  assert.equal(resource.statModifier({}, stat), 1, id + ' cannot buff NPCs');
  assert.equal(trinkets.usedAttunement(), cost);
  assert.equal(trinkets.unequip(owned.uid), true);
  assert.equal(resource.statModifier(player, stat), 1, id + ' ends cleanly on unequip');
  assert.equal(trinkets.usedAttunement(), 0);
  assert.equal(saved.length - before, 3, id + ' uses the existing 3 gear saves (claim/equip/unequip)');
}

// The production combat hook must preserve separate Health, Footing and ranged channels.
const damageDeps = {
  player,
  getGearInventory: () => gear,
  saveGearInventory: () => saved.push(true),
  damageCreature(target, amount, x, y, knockback, options) {
    const record = { target, amount, x, y, knockback, options }; // Records the live wrapper's final output for assertions.
    hits.push(record);
    return record;
  },
}; // Live combat initialization inserts the double-edged hit wrapper over the real damage callback.
windowObject.Combat.init(damageDeps);
const fire = options => damageDeps.damageCreature({ health: 100 }, 10, 0, 0, 0, { attacker: player, ...options }); // Simulates one wearer-authored hit.
const wear = id => { const uid = trinkets.grant(id, 'test'); assert(trinkets.equip(uid).ok); return uid; }; // Equips through the real Attunement and stat channels.
let uid = wear('brawlersRing');
let hit = fire({});
assert.equal(hit.amount, 10, 'Brawler Ring must not raise Health damage');
assert(Math.abs(hit.options.footingDamageMultiplier - 1.30) < 1e-8, 'Brawler Ring raises Footing alone');
trinkets.unequip(uid);

uid = wear('duelistsSignet');
hit = fire({});
assert.equal(hit.amount, 13, 'Duelist Signet raises weapon Health damage');
assert(Math.abs(hit.options.footingDamageMultiplier - 1 / 1.30) < 1e-8, 'Duelist Signet must not unintentionally raise Footing');
trinkets.unequip(uid);

uid = wear('rangersBeads');
hit = fire({ ranged: true, rangedItemKey: 'bow' });
assert.equal(hit.amount, 13, 'Ranger Beads raises actual ranged Health damage');
hit = fire({});
assert.equal(hit.amount, 10, 'Ranger Beads does not buff melee');
trinkets.unequip(uid);
assert(hits.length >= 4, 'all pathways reached the live damage wrapper');

// A second harness loads the real ResourceSystem instead of the lightweight
// gear-only stub. This catches modifiers that exist in definitions but are
// never consumed by the corresponding combat/resource gameplay path.
const live = {
  console, Date, Math, performance: { now: () => 10000 },
  CustomEvent: class CustomEvent { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
  SCRATCHBONES_CONFIG: { game: { combat: { resourceSystem: { pukeChancePerSec: 0 } } } },
  addEventListener() {}, dispatchEvent() {},
}; // Actual resource and combat runtime, with only browser event/audio seams stubbed.
live.window = live;
vm.createContext(live);
vm.runInContext(source('docs/js/combat/resource-system.js'), live, { filename: 'resource-system.js' });
const liveR = live.ResourceSystem; // Production Health/Stamina/Footing/affliction calculations.
const livePlayer = { health: 100, maxHealth: 100, stamina: 100, maxStamina: 100, footing: 100, maxFooting: 100, x: 0, y: 0 }; // New fixture isolates live effects from stub assertions.
liveR.initEntity(livePlayer);
const liveGear = { trinkets: [], equippedTrinkets: [] }; // Live Attunement and character ownership backing this resource test.
live.Combat = {
  deps: { player: livePlayer, getGearInventory: () => liveGear, saveGearInventory() {} },
  init(deps) { this.deps = deps; },
};
vm.runInContext(source('docs/js/trinket-system.js'), live, { filename: 'trinket-system.js live' });
vm.runInContext(source('docs/js/combat/double-edged-combat-trinkets.js'), live, { filename: 'double-edged-combat-trinkets.js live' });
const liveTrinkets = live.TrinketSystem; // Real bonus registration, ownership and equipped-effect lifecycles.
const liveWear = id => {
  const uid = liveTrinkets.grant(id, 'buried-treasure'); // Exercises real grant instead of injecting an unowned effect.
  assert(uid && liveTrinkets.equip(uid).ok, id + ' must equip through Attunement');
  return uid;
};
const liveUnwear = uid => assert.equal(liveTrinkets.unequip(uid), true);
const approx = (actual, expected, message) => assert(Math.abs(actual - expected) < 1e-7, message + ': ' + actual + ' vs ' + expected); // Avoid rounding noise on percentage modifiers.

let liveUid = liveWear('fightersBelt');
livePlayer.stamina = 100;
liveR.spendStamina(livePlayer, 20, 'Forehand Swing', { actionKind: 'combatCombo' });
approx(livePlayer.stamina, 83, 'Fighter Belt discounts real weapon action Stamina');
livePlayer.stamina = 100;
liveR.spendStamina(livePlayer, 20, 'Farmwork', { actionKind: 'farmWork' });
approx(livePlayer.stamina, 80, 'Fighter Belt leaves unrelated crafting/farm Stamina costs alone');
liveUnwear(liveUid);

liveUid = liveWear('swiftbladeRing');
approx(live.DoubleEdgedCombatTrinkets.attackSpeed(), 1.12, 'Swiftblade Ring changes live melee/ranged attack timing');
liveUnwear(liveUid);
approx(live.DoubleEdgedCombatTrinkets.attackSpeed(), 1, 'Swiftblade Ring unequip restores normal attack timing');

liveUid = liveWear('defendersBrooch');
livePlayer.health = 100;
liveR.applyDamage(livePlayer, 20);
approx(livePlayer.health, 82.4, 'Defender Brooch reduces incoming Health damage by twelve percent');
liveUnwear(liveUid);

liveUid = liveWear('steadfastBeads');
const afflictionBefore = liveR.getAffliction(livePlayer, 'bruisedHealth'); // Baseline used to isolate only newly added affliction buildup.
liveR.addAffliction(livePlayer, 'bruisedHealth', 10);
approx(liveR.getAffliction(livePlayer, 'bruisedHealth') - afflictionBefore, 8, 'Steadfast Beads reduce incoming affliction buildup');
liveUnwear(liveUid);

liveUid = liveWear('runnersCord');
approx(liveR.getEffectiveMax(livePlayer, 'stamina'), 120, 'Runner Cord raises real maximum Stamina');
liveUnwear(liveUid);
approx(liveR.getEffectiveMax(livePlayer, 'stamina'), 100, 'Runner Cord unequip restores the original maximum');

liveUid = liveWear('masonsRing');
livePlayer.footing = 20;
liveR.tick(livePlayer, 1, { footingRegenPerSec: 10, staminaRegenPerSec: 0, healthRegenPerSec: 0 });
const improvedFooting = livePlayer.footing; // Real one-second Footing regeneration with Mason Ring equipped.
liveUnwear(liveUid);
livePlayer.footing = 20;
liveR.tick(livePlayer, 1, { footingRegenPerSec: 10, staminaRegenPerSec: 0, healthRegenPerSec: 0 });
const normalFooting = livePlayer.footing; // Repeats the identical regeneration with the trinket removed.
assert(improvedFooting > normalFooting, 'Mason Ring improves real Footing recovery rather than a display-only stat');
approx((improvedFooting - 20) / (normalFooting - 20), 1.35, 'Mason Ring applies exactly +35% footing recovery');

console.log('PASS buried trinkets: thirteen real stat effects and six live resource/combat paths, Attunement, gear saves, wearer-only scope, ranged/Health/Footing combat hooks.');
