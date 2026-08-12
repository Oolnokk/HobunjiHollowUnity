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
assert.equal(cookingData.recipes.length, 17, 'all cooking prototype recipes are ported');
assert.equal(Object.keys(cookingData.items).length, 91, 'all prototype ingredient definitions remain available as data');
const acceptedCategories = new Set(cookingData.recipes.flatMap(recipe => recipe.slots.flatMap(slot => slot.accepts)));
for (const recipe of cookingData.recipes) {
  assert(recipe.slots.length > 0 && recipe.slots.every(slot => slot.accepts.length > 0), `${recipe.name} has category-constrained ingredient slots`);
}
assert(acceptedCategories.has('fish') && acceptedCategories.has('meat') && acceptedCategories.has('grain'), 'recipe coverage includes core ingredient families');

const gameSource = fs.readFileSync('docs/game.js', 'utf8');
const indexSource = fs.readFileSync('docs/index.html', 'utf8');
const cookingSource = fs.readFileSync('docs/js/cooking-system.js', 'utf8');
const alchemySource = fs.readFileSync('docs/js/alchemy-system.js', 'utf8');
assert.match(gameSource, /hearthFurniture:\s*\(\) => makeCookingInteractable\(\)/, 'authored building hearths open cooking');
assert.match(gameSource, /o\.key === 'hearth'.*makeCookingInteractable/, 'placed farmhouse hearths open cooking');
assert.match(gameSource, /derivedHearth[\s\S]{0,600}makeCookingInteractable/, 'derived farmhouse hearths open cooking');
assert.doesNotMatch(indexSource, /<div class="skill-name">(?:Alchemy|Cooking)<\/div>/, 'the old stub skills are removed from the tab');
for (const name of ['Foraging', 'Mining', 'Farming', 'Fishing', 'Combat', 'Crafting']) assert(indexSource.includes(`>${name}<`), `${name} appears in the static Skills tab`);
assert.match(cookingSource, /function openAtHearth\(/, 'cooking owns a hearth-only open entry point');
assert.doesNotMatch(cookingSource, /(?:import|require).*game\.js/, 'the cooking module does not import game.js');
assert.match(alchemySource, /registerProvider\('alchemy'/, 'alchemy contributes to the shared effect HUD');
assert.match(cookingSource, /registerProvider\('food'/, 'food contributes to the shared effect HUD independently');
assert.match(cookingSource, /craftIngredientSaveChance/, 'Crafting ingredient saves are integrated');
assert.match(gameSource, /rareFishWeightMultiplier/, 'Fishing rarity weighting is integrated');

console.log('skill and hearth cooking tests passed');
