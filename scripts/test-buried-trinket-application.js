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
  ['wardensAmulet', 'maxFooting', 1.45, 3],
]; // Exact expected benefits/prices from the seven new ordinary buried-treasure curios.
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

console.log('PASS buried trinkets: seven real stat effects, Attunement, gear saves, wearer-only scope, ranged/Health/Footing combat hooks.');
