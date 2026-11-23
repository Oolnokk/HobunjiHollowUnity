#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict'); // Validate food migration without a browser or running save.
const fs = require('node:fs'); // Load the exact gameplay scripts shipped by the game.
const vm = require('node:vm'); // Run production modules without leaking globals across tests.
const source = path => fs.readFileSync(path, 'utf8'); // Shared test loader for real code and authored food data.
const w = {
  CalendarSystem: { isInitialized: () => true, timeDebugSnapshot: () => ({ rawDay: 10, time01: .5 }), getHour: () => 12 },
  InventoryStacks: { MAX_TOTAL: 999 },
}; // Stubbed browser services used by food persistence and skill stat reads.
const providers = new Map(); // Captures the actual HUD entries registered by CookingSystem.
w.EffectBuffBar = { registerProvider: (id, fn) => providers.set(id, fn), refresh() {} };
const ctx = vm.createContext({
  window: w, console, queueMicrotask() {},
  document: { getElementById: () => ({}), querySelector: () => null }, // Existing UI layer avoids unrelated DOM/Skills rendering.
});
for (const p of ['docs/js/cooking-data.js', 'docs/js/cooking-system.js', 'docs/js/skill-system.js', 'docs/js/festival-potluck-contest.js'])
  vm.runInContext(source(p), ctx, { filename: p });
const defs = {}; // Real ingredient registration and legacy cooked-item definitions live here.
const inventory = { food_legacy_clarity: 1 }; // A pre-consolidation cooked stack must retain its exact key/count.
const deps = {
  ITEM_DEFS: defs, inventory, inventoryItems: [],
  clampInventoryStack() {}, refreshItemScroll() {}, buildInventoryGrid() {}, refreshActionBar() {}, saveMemberWorldData() {},
}; // Minimal host bridge for register, restore and eat paths.
const cooking = w.CookingSystem; // Canonicalization authority under test.
cooking.init(deps);
w.SkillSystem.init({ getFoodEffectStacks: key => cooking.getFoodEffectStacks(key), random: () => .5 });
assert.equal(w.HobunjiCookingData.effectLabels.clarity, undefined, 'Clarity no longer appears as a food stat');
assert(Object.values(w.HobunjiCookingData.items).every(item => item.primaryEffect !== 'clarity'), 'Authored ingredients all use Perception');
assert.equal(defs.garlink.cookingPrimaryEffect, 'perception', 'Authoring reaches inventory registration');
assert.equal(cooking.effectLabel('clarity'), 'Perception', 'Legacy labels resolve to the consolidated buff');
assert.equal(cooking.canonicalFoodEffectKey('clarity'), 'perception');
assert.deepEqual(JSON.parse(JSON.stringify(cooking.normalizeFoodEffects({ clarity: 2, perception: 3 }))), { perception: 5 });
assert.deepEqual(JSON.parse(JSON.stringify(cooking.ingredientEffectTotals({
  cookingProcessingTier: 'raw', foodEffects: { clarity: 2, perception: 3 },
}))), { perception: 5 }, 'Old processed meals sum both effects');
assert.equal(Object.keys(cooking.ingredientEffectTotals({ cookingPrimaryEffect: 'clarity', cookingBaseBoost: 1, cookingProcessingTier: 'raw' }, 3))[0], 'perception');
cooking.restore({
  cookedDefinitions: {
    food_legacy_clarity: { label: 'Focused Soup', icon: '🍲', desc: 'Mild Clarity (+2).', foodEffects: { clarity: 2, perception: 1 }, foodQuality: 3, cookingDefaultStars: 3, isCookedFood: true },
  },
  qualityBuckets: { food_legacy_clarity: { 3: 1 } },
  activeFoodEffects: [{ key: 'clarity', stacks: 2, remainingHours: 12 }, { key: 'perception', stacks: 3, remainingHours: 8 }],
});
assert.equal(cooking.getFoodEffectStacks('perception'), 5, 'Restored timers sum into Perception');
assert.equal(cooking.getFoodEffectStacks('clarity'), 5, 'Legacy callers read the same canonical stack total');
assert.equal(providers.get('food')().filter(entry => entry.key === 'perception').length, 1, 'Only one Perception HUD entry');
assert.equal(providers.get('food')().filter(entry => entry.key === 'clarity').length, 0, 'No second Clarity HUD entry');
assert.equal(providers.get('food')()[0].stacks, 5);
assert.equal(w.SkillSystem.craftIngredientSaveChance(), .015, 'Former Clarity recipe-saving effect now reads Perception');
assert(w.SkillSystem.rareFishWeightMultiplier('rare') > 1, 'Perception still helps fish encounters');
assert.equal(defs.food_legacy_clarity.foodEffects.perception, 3, 'Saved food stacks sum without changing the inventory key');
assert.equal(defs.food_legacy_clarity.foodEffects.clarity, undefined);
assert.match(defs.food_legacy_clarity.desc, /Perception/);
assert.equal(inventory.food_legacy_clarity, 1, 'Migration never rekeys saved inventory');
const eaten = cooking.eat('food_legacy_clarity', 3); // Actual eating verifies stacked buff application and inventory decrement.
assert.equal(eaten.ok, true, 'Legacy cooked food is still edible');
assert.equal(cooking.getFoodEffectStacks('perception'), 8);
assert.equal(inventory.food_legacy_clarity, 0);
assert.equal(providers.get('food')()[0].stacks, 8);
const roundtrip = cooking.serialize(); // Next save must persist canonical keys with no Clarity revival.
assert.equal(roundtrip.activeFoodEffects.length, 1);
assert.equal(roundtrip.activeFoodEffects[0].key, 'perception');
assert.equal(roundtrip.cookedDefinitions.food_legacy_clarity.foodEffects.clarity, undefined);
assert.equal(roundtrip.cookedDefinitions.food_legacy_clarity.foodEffects.perception, 3);
assert.equal(w.FestivalPotluckContest.mealEffects([{ key: 'garlink', stars: 3 }], defs).perception > 0, true, 'Festival meals use the same Perception ingredient effect');
cooking.registerExternalFoodProvider('festival-legacy', key => key === 'perception' ? 2 : 0);
assert.equal(cooking.getFoodEffectStacks('perception'), 10, 'Independent festival Perception stacks are included once');
assert.match(source('docs/js/alchemy-system.js'), /potionOfClarity: recipe\('potionOfClarity'.*cleanseFamily/, 'Potion of Clarity remains a defensive-affliction remedy');
console.log('Clarity -> Perception food migration and buff regression passed');
