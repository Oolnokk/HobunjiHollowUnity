#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = {
  console,
  document: { querySelector: () => null },
  window: {},
}; // Used to exercise the standalone skill module without the full Three.js game.
vm.runInNewContext(fs.readFileSync('docs/js/skill-system.js', 'utf8'), context);

let saved = null; // Used to verify the character-save adapter receives modern XP and legacy levels.
context.window.SkillSystem.init({
  random: () => 0.99,
  getFoodEffectStacks: effect => effect === 'foraging' ? 2 : 0,
  saveSkillProgress: snapshot => { saved = snapshot; },
});
context.window.SkillSystem.restore({ skillLevels: { foraging: 5, alchemy: 4, cooking: 7 } });
assert.equal(context.window.SkillSystem.level('foraging'), 5, 'legacy level-shaped saves migrate to cumulative XP');
assert.equal(context.window.SkillSystem.level('crafting'), 7, 'the highest old Alchemy/Cooking level migrates to Crafting');
assert.equal(context.window.SkillSystem.level('mining'), 0, 'Mining starts clean instead of inheriting unrelated old progress');
assert.equal(context.window.SkillSystem.effectiveLevel('foraging'), 7, 'food stacks temporarily raise the effective skill');
assert(context.window.SkillSystem.bonusYieldChance('foraging') > 0, 'Foraging exposes a yield bonus');
assert(context.window.SkillSystem.actionSpeedMultiplier('mining') >= 1, 'Mining exposes a hold-speed multiplier');
context.window.SkillSystem.award('mining', 20, 'test');
assert.equal(context.window.SkillSystem.level('mining'), 1, 'actions award real level progress');
assert(saved?.experience?.mining >= 20, 'skill XP persists through the injected save adapter');

context.window = {};
vm.runInNewContext(fs.readFileSync('docs/js/cooking-data.js', 'utf8'), context);
const cookingData = context.window.HobunjiCookingData;
assert.equal(cookingData.recipes.length, 19, 'the 17 prototype meals plus mayonnaise and bread recipes are available');
assert.equal(Object.keys(cookingData.items).length, 95, 'all prototype ingredients plus both tree nuts and their oils remain available as data');
const acceptedCategories = new Set(cookingData.recipes.flatMap(recipe => recipe.slots.flatMap(slot => slot.accepts)));
for (const recipe of cookingData.recipes) {
  assert(recipe.slots.length > 0 && recipe.slots.every(slot => slot.accepts.length > 0), `${recipe.name} has category-constrained ingredient slots`);
}
assert(acceptedCategories.has('fish') && acceptedCategories.has('meat') && acceptedCategories.has('grain'), 'recipe coverage includes core ingredient families');
assert.deepEqual(Array.from(cookingData.recipes.find(recipe => recipe.id === 'basicNoodles').inventoryCategories), ['noodleBase', 'processedCrop'], 'basic noodles produce a reusable noodle ingredient');
assert.deepEqual(Array.from(cookingData.recipes.find(recipe => recipe.id === 'mayonnaise').inventoryCategories), ['mayonnaise', 'sauce'], 'mayonnaise produces the category required by sauce recipes');
assert(cookingData.recipes.find(recipe => recipe.id === 'bread').inventoryCategories.includes('bread'), 'bread produces a reusable bread ingredient');
for (const key of ['crownedPineNuts', 'shadewoodNuts', 'crownedPineNutOil', 'shadewoodNutOil']) {
  assert(cookingData.items[key], `${key} is registered as a cooking ingredient`);
}

context.window = {};
vm.runInNewContext(fs.readFileSync('docs/js/food-processing.js', 'utf8'), context);
const processing = context.window.HobunjiFoodProcessing;
assert.equal(processing.SQUEEZING_VAT.name, 'Squeezing Vat', 'the old hand/grape names resolve to one squeezing-vat station');
assert.equal(processing.getProcessingOutputs('squeezing', 'crownedPineNuts', cookingData.items.crownedPineNuts)[0].key, 'crownedPineNutOil', 'crowned pine nuts press into their own oil');
assert.equal(processing.getProcessingOutputs('squeezing', 'shadewoodNuts', cookingData.items.shadewoodNuts)[0].key, 'shadewoodNutOil', 'shadewood nuts press into their own oil');
const lard = processing.getProcessingOutputs('squeezing', 'garWolfMeat', { label: 'Gar-wolf Meat', tags: ['Meat'], cookingPrimaryEffect: 'strength' })[0];
assert.equal(lard.label, 'Gar-wolf Lard', 'any tagged meat renders into species-specific lard');
assert(lard.cookingCategories.includes('oil'), 'lard is reusable anywhere cooking accepts fat');
const fishOil = processing.getProcessingOutputs('squeezing', 'fish_riverMinnow', { label: 'River Minnow', tags: ['Fish'], cookingPrimaryEffect: 'fishing' })[0];
assert.equal(fishOil.label, 'River Minnow Oil', 'any tagged fish presses into species-specific fish oil');
const nutDrop = processing.rollTreeNutDrop('map_northern_cliffs', () => 0, {
  bonusYieldChance: () => 1,
  rollQuality: () => 5,
});
assert.deepEqual({ key: nutDrop.itemKey, amount: nutDrop.amount, stars: nutDrop.stars }, { key: 'crownedPineNuts', amount: 3, stars: 5 }, 'Foraging can improve both tree-nut quantity and quality');

const gameSource = fs.readFileSync('docs/game.js', 'utf8');
const indexSource = fs.readFileSync('docs/index.html', 'utf8');
const cookingSource = fs.readFileSync('docs/js/cooking-system.js', 'utf8');
const processingSource = fs.readFileSync('docs/js/food-processing.js', 'utf8');
const alchemySource = fs.readFileSync('docs/js/alchemy-system.js', 'utf8');
assert.match(gameSource, /hearthFurniture:\s*\(\) => makeCookingInteractable\(\)/, 'authored building hearths open cooking');
assert.match(gameSource, /o\.key === 'hearth'.*makeCookingInteractable/, 'placed farmhouse hearths open cooking');
assert.match(gameSource, /derivedHearth[\s\S]{0,600}makeCookingInteractable/, 'derived farmhouse hearths open cooking');
assert.doesNotMatch(indexSource, /<div class="skill-name">(?:Alchemy|Cooking)<\/div>/, 'the old stub skills are removed from the tab');
for (const name of ['Foraging', 'Mining', 'Farming', 'Fishing', 'Combat', 'Crafting']) assert(indexSource.includes(`>${name}<`), `${name} appears in the static Skills tab`);
assert.match(cookingSource, /function openAtHearth\(/, 'cooking owns a hearth-only open entry point');
assert.match(cookingSource, /recipe\?\.inventoryCategories/, 'saved cooked bases recover their reusable recipe categories');
assert.match(cookingSource, /definition\?\.foodEffects/, 'multi-stage recipes carry their prepared ingredient effects forward');
assert.doesNotMatch(cookingSource, /(?:import|require).*game\.js/, 'the cooking module does not import game.js');
assert.match(alchemySource, /registerProvider\('alchemy'/, 'alchemy contributes to the shared effect HUD');
assert.match(cookingSource, /registerProvider\('food'/, 'food contributes to the shared effect HUD independently');
assert.match(cookingSource, /craftIngredientSaveChance/, 'Crafting ingredient saves are integrated');
assert.match(gameSource, /rareFishWeightMultiplier/, 'Fishing rarity weighting is integrated');
assert.match(indexSource, /js\/food-processing\.js/, 'the decoupled food-processing module loads before game boot');
assert.match(gameSource, /HobunjiFoodProcessing\?\.getProcessingOutputs/, 'game.js delegates new vat recipes through a narrow adapter');
assert.match(gameSource, /HobunjiFoodProcessing\?\.rollTreeNutDrop/, 'game.js delegates tree-nut yield rules through a narrow adapter');
assert.doesNotMatch(processingSource, /(?:import|require).*game\.js/, 'food processing does not import game.js');
assert.match(cookingSource, /consumeBestQuality/, 'processors can consume tracked quality without desynchronizing cooking stacks');

console.log('skill and hearth cooking tests passed');
