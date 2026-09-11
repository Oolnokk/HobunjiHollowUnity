#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const abilityDefs = [
  ['opportunistJab', 'Opportunist Jab', 'quickAttack'],
  ['exhaustCutter', 'Exhaust Cutter', 'quickAttack'],
  ['backstabFlick', 'Backstab Flick', 'quickAttack'],
  ['mercySpike', 'Mercy Spike', 'quickAttack'],
  ['counterShield', 'Counter Shield', 'defensiveHold'],
  ['blinkDodge', 'Blink Dodge', 'defensiveHold'],
  ['chargedBreaker', 'Charged Breaker', 'offensiveHold'],
  ['acceleratingFlurry', 'Accelerating Flurry', 'offensiveHold'],
]; // Mirrors every currently registered slottable combat technique.

const abilities = new Map(abilityDefs.map(([id, label, category]) => [id, { id, label, category }]));
let activeItem = null; // Used to simulate selecting a specific manual in the held-item UI.
const inventory = { gold: 999 };
const itemDefs = {};
const inventoryItems = [];
const loadoutState = {};
const noop = () => {};
const documentStub = { addEventListener: noop, querySelector: () => null, getElementById: () => null };
const windowStub = {
  Combat: {
    abilities: {
      get: id => abilities.get(id),
      listForCategories: cats => [...abilities.values()].filter(def => cats.includes(def.category)),
    },
    loadout: {
      getSlot: () => null, get: () => ({}), setSlot: () => true,
      serialize: () => JSON.parse(JSON.stringify(loadoutState)),
      load: value => { Object.keys(loadoutState).forEach(key => delete loadoutState[key]); Object.assign(loadoutState, value || {}); },
    },
    deps: { awardMotesOfProwess: noop, currentWeaponKey: () => 'bronzesword' },
  },
  CookingSystem: { init: noop },
  HobunjiDrunkGameplayBridge: { getHeldItemAction: () => null, beginHeldItemAction: () => false },
  dispatchEvent: noop,
};
const techniqueContext = vm.createContext({
  window: windowStub, document: documentStub, console,
  localStorage: { getItem: () => null, setItem: noop },
  requestAnimationFrame: fn => fn(), CustomEvent: function CustomEvent() {},
  Event: function Event() {}, MutationObserver: function MutationObserver() { this.observe = noop; },
});
vm.runInContext(fs.readFileSync('docs/js/combat/technique-scrolls.js', 'utf8'), techniqueContext, { filename: 'technique-scrolls.js' });
windowStub.CookingSystem.init({
  inventory, ITEM_DEFS: itemDefs, inventoryItems,
  getHeldMode: () => 'item', getActiveInventoryItem: () => activeItem,
  clampInventoryStack: noop, refreshItemScroll: noop, buildInventoryGrid: noop,
  refreshActionBar: noop, saveMemberWorldData: noop, showToast: noop,
});

const manuals = windowStub.TechniqueScrolls.allManuals();
assert.equal(manuals.length, abilityDefs.length, 'every slottable combat ability has exactly one specific manual');
assert.equal(new Set(manuals.map(manual => manual.key)).size, manuals.length, 'manual inventory keys are unique');
for (const manual of manuals) {
  assert.equal(itemDefs[manual.key].combatManualAbilityId, manual.abilityId, `${manual.label} targets its exact ability`);
}
const targetManual = windowStub.TechniqueScrolls.manualForAbility('blinkDodge');
inventory[targetManual.key] = 1;
activeItem = itemDefs[targetManual.key];
activeItem.key = targetManual.key;
assert.equal(windowStub.TechniqueScrolls.consumeManual(), true, 'reading a manual succeeds');
assert.equal(inventory[targetManual.key], 0, 'reading consumes one manual');
assert.equal(windowStub.TechniqueScrolls.isUnlocked('blinkDodge'), true, 'reading unlocks the exact ability');
assert.equal(windowStub.TechniqueScrolls.consumeManual(), false, 'an empty manual stack cannot be read again');

const lootConfig = JSON.parse(fs.readFileSync('docs/config/loot/loot-pools.json', 'utf8'));
const manualLoot = lootConfig.pools.treasureChest.entries.find(entry => entry.id === 'combatManual');
assert(manualLoot && manualLoot.chance > 0 && manualLoot.chance <= 0.1, 'treasure/Gullet manual chance is rare');
const shopConfig = JSON.parse(fs.readFileSync('docs/config/shops/shop-stock.json', 'utf8'));
const shopManuals = shopConfig.shops.jubmirWares.goods.filter(entry => entry.abilityId);
assert.deepEqual(new Set(shopManuals.map(entry => entry.abilityId)), new Set(abilityDefs.map(([id]) => id)), 'Jubmir commonly stocks every specific manual');

const overrideSource = fs.readFileSync('docs/js/local-db-overrides.js', 'utf8');
const scheduleOverrides = JSON.parse(fs.readFileSync('docs/config/npcs/schedule-overrides.json', 'utf8'));
const overrideWindow = {};
vm.runInNewContext(overrideSource, {
  window: overrideWindow, console,
  localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
  fetch: async () => { throw new Error('not used'); },
}, { filename: 'local-db-overrides.js' });
const composed = overrideWindow.LocalDBOverrides.applyNpcScheduleOverrides({ npcs: [{
  id: 'jubmir', agenda: [{ id: 'old-always-present' }],
  scheduleHooks: { defaultStationId: 'station_inn_dorm_bed', rules: [{ from: '09:00', to: '17:00' }] },
}] }, scheduleOverrides);
const jubmir = composed.npcs[0];
assert.equal(jubmir.agenda.length, 0, 'free-time planner cannot keep Jubmir present outside visits');
assert.equal(jubmir.scheduleHooks.defaultStationId, undefined, 'an inn fallback cannot spawn Jubmir outside visits');
assert.deepEqual(JSON.parse(JSON.stringify(jubmir.visitorPresence.entrance)), { mapId: 'map_hobunji_town', c: 30, r: 48, label: 'Southern Cloud Forest entrance' });

let weekday = 'Hronu'; // Used to drive the real recurring visitor resolver across arrival and departure boundaries.
let hour = 10.5; // Used with weekday to simulate game calendar time.
const walkers = [];
const schedulingWindow = {
  CalendarSystem: { currentWeekdayName: () => weekday, getHour: () => hour },
  NpcActivityPlanner: null,
};
const schedulingContext = vm.createContext({ window: schedulingWindow, console });
vm.runInContext(fs.readFileSync('docs/js/npc-scheduling.js', 'utf8'), schedulingContext, { filename: 'npc-scheduling.js' });
schedulingWindow.NpcScheduling.init({
  npcWalkers: walkers, normalizeNpcArea: area => area === 'map_hobunji_town' ? 'town' : area,
  getCurrentArea: () => 'town', getWorldNpcPaths: () => [], getSharedSchedules: () => [],
  isBuildingArea: () => false, buildingScenes: new Map(), loadBuildingScene: noop,
  getDecorativeFurnitureKeyByItemKey: () => '', decorativeFurnitureDefs: {},
});
assert.equal(schedulingWindow.NpcScheduling.resolveNpcScheduleTarget(jubmir), null, 'Jubmir is absent before Monday afternoon');
hour = 11;
let target = schedulingWindow.NpcScheduling.resolveNpcScheduleTarget(jubmir);
assert.equal(target.visitorArrival, true, 'Jubmir spawns at the entrance at Monday-afternoon arrival');
assert.deepEqual([target.area, target.c, target.r], ['town', 30, 48]);
walkers.push({ rec: jubmir, area: 'town' });
weekday = 'Kruru'; hour = 10.5;
assert.equal(schedulingWindow.NpcScheduling.getVisitorPresence(jubmir).active, true, 'Jubmir remains through Tuesday morning');
hour = 11;
target = schedulingWindow.NpcScheduling.resolveNpcScheduleTarget(jubmir);
assert.equal(target.visitorDeparture, true, 'Jubmir starts departure when Tuesday morning ends');
weekday = 'Tothu'; hour = 11;
assert.equal(schedulingWindow.NpcScheduling.getVisitorPresence(jubmir).active, true, 'Friday-afternoon visit activates');
weekday = 'Uung'; hour = 11;
assert.equal(schedulingWindow.NpcScheduling.getVisitorPresence(jubmir).active, false, 'Saturday-morning visit ends at 11:00');

const wildTreasure = fs.readFileSync('docs/js/wild-treasure.js', 'utf8');
const fishingEvents = fs.readFileSync('docs/js/fishing-events.js', 'utf8');
assert.match(wildTreasure, /combatManualKey[\s\S]*?rollManualKey/, 'buried chests roll and carry combat manuals');
assert.match(fishingEvents, /combatManualKey[\s\S]*?rollManualKey/, 'Gullet Fish treasure rolls and carries combat manuals');

console.log('combat manual and Jubmir visit tests passed');
