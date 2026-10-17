'use strict';

// Processed goods (jerky, smoked/dried fish and meat, jam, juice, butter...) must
// be usable as cooking ingredients in the slots of the raw item they came from,
// and must contribute more buff than the raw ingredient (higher processing tier).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const window = {};
const context = vm.createContext({ window, document: { addEventListener() {}, getElementById() { return null; } }, console });
for (const file of ['cooking-data.js', 'cooking-system.js', 'item-processing.js', 'food-processing.js']) {
  vm.runInContext(fs.readFileSync(`docs/js/${file}`, 'utf8'), context, { filename: file });
}

const ITEM_DEFS = {
  garWolfMeat: { icon: '🥩', label: 'Gar-wolf Meat', cat: 'material', sellPrice: 9, tags: ['Material', 'Meat'] },
  riverFish: { icon: '🐟', label: 'River Fish', cat: 'material', sellPrice: 12, tags: ['Fish', 'Edible'], cookingCategories: ['fish'], cookingPrimaryEffect: 'fishing', cookingBaseBoost: 1, cookingProcessingTier: 'raw', cookingDefaultStars: 3 },
  cliffMollusk: { icon: '🐚', label: 'Cliff Mollusk', cat: 'material', sellPrice: 8, tags: ['Mollusk'], cookingCategories: ['mollusk'], cookingPrimaryEffect: 'fortitude', cookingBaseBoost: 1, cookingProcessingTier: 'raw', cookingDefaultStars: 3 },
  redberries: { icon: '🍓', label: 'Redberries', cat: 'crop', sellPrice: 5, tags: ['Crop'], cookingCategories: ['berry', 'fruit'], cookingPrimaryEffect: 'vigor', cookingBaseBoost: 1, cookingProcessingTier: 'raw', cookingDefaultStars: 3 },
  heftroot: { icon: '🟡', label: 'Heftroot', cat: 'crop', sellPrice: 6, tags: ['Crop'], cookingCategories: ['starchVegetable'], cookingPrimaryEffect: 'vigor', cookingBaseBoost: 1, cookingProcessingTier: 'raw', cookingDefaultStars: 3 },
  garWolfMilk: { icon: '🥛', label: 'Gar-wolf Milk', cat: 'material', sellPrice: 6, tags: ['Milk'], cookingCategories: ['whiteMilk'], cookingPrimaryEffect: 'strength', cookingBaseBoost: 1, cookingProcessingTier: 'raw', cookingDefaultStars: 3 },
};
window.ItemProcessing.init({ ITEM_DEFS, cropData: {} });

const data = window.HobunjiCookingData;
const accepted = new Set();
data.recipes.forEach(recipe => recipe.slots.forEach(slot => slot.accepts.forEach(category => accepted.add(category))));
const cooking = window.CookingSystem;
const tierMultiplier = def => data.processingTiers[def.cookingProcessingTier].multiplier;

function outputFor(method, key) {
  const output = window.ItemProcessing.getProcessingOutputs(method, key)?.[0];
  assert.ok(output, `${method} ${key} produces something`);
  return output;
}

function assertCooks(output, expectedCategory, raw) {
  assert.ok(output.cookingCategories?.includes(expectedCategory), `${output.key} is a ${expectedCategory} ingredient (got ${output.cookingCategories})`);
  assert.ok(output.cookingCategories.some(category => accepted.has(category)), `${output.key} fits an existing recipe slot`);
  assert.ok(output.cookingPrimaryEffect, `${output.key} carries a buff effect`);
  if (raw) {
    assert.ok(tierMultiplier(output) > tierMultiplier(raw), `${output.key} is processed beyond ${raw.label}`);
    assert.equal(output.cookingPrimaryEffect, raw.cookingPrimaryEffect || output.cookingPrimaryEffect, 'keeps the source effect');
    const rawBuff = Object.values(cooking.ingredientEffectTotals(raw, 3)).reduce((a, b) => a + b, 0);
    const processedBuff = Object.values(cooking.ingredientEffectTotals(output, 3)).reduce((a, b) => a + b, 0);
    assert.ok(processedBuff > rawBuff, `${output.key} contributes more buff than ${raw.label} (${processedBuff} > ${rawBuff})`);
  }
}

assertCooks(outputFor('drying', 'garWolfMeat'), 'meat');                              // jerky
assertCooks(outputFor('smoking', 'garWolfMeat'), 'meat');
assertCooks(outputFor('smoking', 'riverFish'), 'fish', ITEM_DEFS.riverFish);
assertCooks(outputFor('drying', 'riverFish'), 'fish', ITEM_DEFS.riverFish);
assertCooks(outputFor('smoking', 'cliffMollusk'), 'mollusk', ITEM_DEFS.cliffMollusk);
assertCooks(outputFor('mashing', 'redberries'), 'sweetPaste', ITEM_DEFS.redberries);  // jam
assertCooks(outputFor('mashing', 'redberries'), 'fruit', ITEM_DEFS.redberries);
assertCooks(outputFor('squeezing', 'redberries'), 'sweetLiquid', ITEM_DEFS.redberries);
assertCooks(outputFor('drying', 'redberries'), 'fruit', ITEM_DEFS.redberries);
assertCooks(outputFor('mashing', 'heftroot'), 'starchVegetable', ITEM_DEFS.heftroot);
assertCooks(outputFor('squeezing', 'garWolfMilk'), 'butter', ITEM_DEFS.garWolfMilk);

const jerky = outputFor('drying', 'garWolfMeat');
assert.equal(jerky.key, 'garWolfMeatJerky');
assert.equal(jerky.cookingCategories.join(), 'meat');
console.log('processed goods cooking ok');
