#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const configSource = read('docs/config/npcs/food-gift-preferences.js');
const foodRuntimeSource = read('docs/js/npc-food-gift-preferences.js');
const giftingSource = read('docs/js/npc-gifting.js');
const cookingSource = read('docs/js/cooking-system.js');
const processingSource = read('docs/js/item-processing.js');

assert.doesNotThrow(() => new vm.Script(configSource, { filename: 'food-gift-preferences.js' }));
assert.doesNotThrow(() => new vm.Script(foodRuntimeSource, { filename: 'npc-food-gift-preferences.js' }));
assert.doesNotThrow(() => new vm.Script(giftingSource, { filename: 'npc-gifting.js' }));

const itemDefs = {
  puktukMeat: { label: 'Puktuk Meat', cat: 'ingredient', cookingCategories: ['meat'], tags: ['Meat'] },
  riverFish: { label: 'Northern River Fish', cat: 'ingredient', cookingCategories: ['fish'], tags: ['Fish'] },
  redberries: { label: 'Redberries', cat: 'ingredient', cookingCategories: ['berry', 'fruit'], tags: ['Fruit'] },
  redberryWine: { label: 'Redberry Wine', cat: 'processed', tags: ['Processed', 'Wine', 'Aged'], ingredientKeys: ['redberries'], giftIngredientKeys: ['redberries'] },
  puktukStew: { label: 'Puktuk Stew', cat: 'food', isCookedFood: true, tags: ['Cooked Food'], ingredientKeys: ['puktukMeat'], giftIngredientKeys: ['puktukMeat'] },
  puktukJerky: { label: 'Puktuk Jerky', cat: 'processed', tags: ['Processed', 'Smoked', 'Meat'], ingredientKeys: ['puktukMeat'], giftIngredientKeys: ['puktukMeat'] },
  garWolfMilk: { label: 'Gar-wolf Milk', cat: 'ingredient', cookingCategories: ['whiteMilk'], tags: ['Milk'] },
  uumkaoiiWhiteDewMilk: { label: 'White Uumkao’ii Milk', cat: 'ingredient', cookingCategories: ['whiteMilk'], tags: ['Milk'] },
  butter: { label: 'Butter', cat: 'processed', cookingCategories: ['butter'], tags: ['Processed', 'Butter', 'Dairy'], ingredientKeys: ['garWolfMilk'] },
};

const records = {
  engh: { id: 'engh', species: 'Engh-Sho', gifts: {} },
  maoao: { id: 'maoao', species: 'Mao’ao', gifts: {} },
  kenkari: { id: 'kenkari', species: 'Kenkari', gifts: {} },
  rakakoan: { id: 'rakakoan', species: 'Rakakoan', gifts: {} },
  ghoul: { id: 'ghoul', species: 'Ghoul', gifts: {} },
  pahu: { id: 'pahu', species: 'Tletingan', gifts: {} },
  hreesh: { id: 'hreesh', species: 'Engh-Sho', gifts: {} },
  tooth_hatayap: { id: 'tooth_hatayap', species: 'Tletingan', gifts: {} },
  favorite: {
    id: 'favorite',
    species: 'Tletingan',
    gifts: { foodLikes: { specificIngredients: ['puktukMeat'] } },
  },
};

const windowStub = {
  ItemTraits: {
    computeItemTraits() { return []; },
    getTraitLabel(id) { return id; },
    isTraitDiscovered() { return true; },
  },
  ItemProcessing: {
    isAlcoholItemDef(def) {
      return (def?.tags || []).some(tag => String(tag).toLowerCase() === 'wine');
    },
  },
};

const context = vm.createContext({ window: windowStub, console });
vm.runInContext(configSource, context, { filename: 'food-gift-preferences.js' });
vm.runInContext(foodRuntimeSource, context, { filename: 'npc-food-gift-preferences.js' });
vm.runInContext(giftingSource, context, { filename: 'npc-gifting.js' });

const gifting = windowStub.NpcGifting;
assert(gifting, 'NpcGifting installs');
gifting.init({
  getItemDefs: () => itemDefs,
  getNpcRecordById: id => records[id] || null,
});

function evaluate(rec, key) {
  return gifting.evaluateHeldGift(rec, { kind: 'item', key, def: itemDefs[key] });
}

assert.equal(evaluate(records.engh, 'puktukMeat').score, 4, 'all Engh-Sho like the Meat ingredient type');
assert.equal(evaluate(records.engh, 'puktukMeat').tier, 'liked');
assert.equal(evaluate(records.maoao, 'riverFish').score, 4, 'all Mao’ao like the Fish ingredient type');
assert.equal(evaluate(records.kenkari, 'riverFish').score, 4, 'all Kenkari like the Fish ingredient type');
assert.equal(evaluate(records.rakakoan, 'riverFish').score, 0, 'Rakakoan does not inherit Kenkari culture merely because some art/runtime systems alias them');
assert.equal(evaluate(records.ghoul, 'riverFish').score, 0, 'Ghoul does not inherit Mao’ao culture merely because some art/runtime systems alias them');

for (const id of ['pahu', 'hreesh', 'tooth_hatayap']) {
  const reaction = evaluate(records[id], 'redberryWine');
  assert.equal(reaction.foodContext.artisanTypes.includes('alcohol'), true, id + ' recognizes wine as Alcohol');
  assert.equal(reaction.score, 4, id + ' likes Alcohol');
  assert.equal(reaction.tier, 'liked', id + ' gives alcohol a liked response');
}

const rawFavorite = evaluate(records.favorite, 'puktukMeat');
const cookedFavorite = evaluate(records.favorite, 'puktukStew');
const artisanFavorite = evaluate(records.favorite, 'puktukJerky');
assert.equal(rawFavorite.score, 8, 'a specific favorite ingredient heavily affects a raw food gift');
assert.equal(cookedFavorite.score, 8, 'ordinary cooking preserves the specific favorite ingredient');
assert.equal(artisanFavorite.score, 12, 'artisan processing boosts a specific favorite ingredient further');
assert.equal(artisanFavorite.tier, 'loved', 'the artisan-boosted favorite reaches a loved reaction');
assert.equal(artisanFavorite.foodContext.artisanTypes.includes('jerky'), true, 'smoked meat is classified as Jerky');

const pooledFavorite = {
  id: 'pooled_favorite',
  species: 'Tletingan',
  gifts: { foodLikes: { specificIngredients: ['garWolfMilk'] } },
};
const pooledButter = evaluate(pooledFavorite, 'butter');
assert.equal(pooledButter.score, 0, 'pooled Butter does not pretend every stack came from whichever milk last rewrote generic ingredientKeys');
assert.deepEqual(Array.from(pooledButter.foodContext.ingredientKeys), ['butter'], 'ambiguous pooled processed goods expose only their own identity to specific gift preferences');

assert.equal(gifting.getPreferenceLabel('food:type:meat'), 'Meat');
assert.equal(gifting.getPreferenceLabel('food:artisan:alcohol'), 'Alcohol');
assert.equal(gifting.getPreferenceLabel('food:ingredient:puktukMeat'), 'Puktuk Meat');

assert.match(cookingSource, /giftIngredientKeys:\s*selections\.map\(\(\{ selected \}\) => selected\.key\)/,
  'cooked food persists source-stable gift ingredient lineage');
assert.doesNotMatch(processingSource, /withSourceIngredientLineage/,
  'processed goods no longer receive unsafe blanket provenance');
assert.match(processingSource, /giftIngredientKeys:\s*\[berryKey\]/,
  'source-specific wine preserves its berry identity for gifting');
assert.match(processingSource, /giftIngredientKeys:\s*\[inputKey\]/,
  'source-specific processor outputs can preserve exact gift provenance');

console.log('NPC food gift preference regression checks passed.');
