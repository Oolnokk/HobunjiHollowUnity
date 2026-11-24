#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = {
  console,
  document: { querySelector: () => null },
  window: {},
  queueMicrotask,
}; // Used to exercise the standalone skill module without the full Three.js game.
vm.runInNewContext(fs.readFileSync('docs/js/skill-system.js', 'utf8'), context);

let saved = null; // Used to verify the character-save adapter receives modern XP and legacy levels.
context.window.SkillSystem.init({
  random: () => 0.99,
  getFoodEffectStacks: effect => effect === 'foraging' ? 2 : 0,
  saveSkillProgress: snapshot => { saved = snapshot; },
});
context.window.SkillSystem.restore({ skillLevels: { foraging: 5, alchemy: 4, crafting: 7 } });
assert.equal(context.window.SkillSystem.level('foraging'), 5, 'legacy level-shaped saves migrate to cumulative XP');
assert.equal(context.window.SkillSystem.level('cooking'), 7, 'the pre-rename Crafting level migrates to the renamed Cooking skill');
assert.equal(context.window.SkillSystem.level('alchemy'), 4, 'Alchemy is a distinct skill unaffected by the Crafting->Cooking rename');
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
assert.equal(Object.keys(cookingData.items).length, 105, 'original ingredients plus Moot/Nazgraku milk and wild Pingdort/Tzatzul meat remain available');
for (const meat of ['mootMeat', 'skeeriMeat', 'pingdortMeat', 'tzatzulMeat'])
  assert(cookingData.items[meat]?.categories.includes('meat'), meat + ' participates in existing cooking and processing recipes');
for (const milk of ['mootMilk', 'nazgrakuMilk'])
  assert(cookingData.items[milk]?.categories.includes('whiteMilk'), milk + ' is available to white-milk recipes');
for (const spice of ['cloudSaffron','starpepper','nightCardamom'])
  assert(cookingData.items[spice]?.categories.includes('spice'), `${spice} is a real, usable imported seasoning`);
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

context.window = { HobunjiCookingData: cookingData };
vm.runInNewContext(fs.readFileSync('docs/js/cooking-system.js', 'utf8'), context);
const cookingSystem = context.window.CookingSystem; // Used to verify ingredient-facing buff labels reuse the same canonical cooking-effect math as meal totals.
assert.equal(cookingSystem.FOOD_DURATION_HOURS, 24, 'all ordinary cooked-food buffs use a 24 in-game-hour duration');
assert.equal(cookingSystem.ingredientBuffText({ cookingPrimaryEffect: 'fishing', cookingBaseBoost: 1, cookingProcessingTier: 'raw' }, 1), '🎣 Mild Fishing (+1)', 'one-star raw ingredients identify their exact cooking buff before selection');
assert.equal(cookingSystem.ingredientBuffText({ cookingPrimaryEffect: 'fishing', cookingBaseBoost: 1, cookingProcessingTier: 'raw' }, 5), '🎣 Concentrated Fishing (+3)', 'ingredient buff labels reflect star quality instead of showing a generic effect name');
assert.equal(cookingSystem.ingredientBuffText({ foodEffects: { fishing: 2, strength: 1 } }, 3), '🎣 Hearty Fishing (+2), 💪 Mild Strength (+1)', 'prepared ingredients list every fixed cooking buff they carry forward');

context.window = { HobunjiCookingData: cookingData };
vm.runInNewContext(fs.readFileSync('docs/js/food-processing.js', 'utf8'), context);
const processing = context.window.HobunjiFoodProcessing;
const expandedRecipeIds = [
  'hearthPancakes', 'sweetCustard', 'eggToast', 'cheeseToast', 'savorySandwich', 'gardenSalad', 'vegetableSoup', 'roastDinner',
  'breakfastHash', 'savorySkewers', 'fishStew', 'sweetBreadPudding', 'hearthFlatbread', 'stuffedDumplings', 'fishCakes', 'fruitFritters',
]; // Used to verify every real-life-inspired meal template is installed by the runtime overlay.
assert.equal(cookingData.recipes.length, 35, 'the runtime cooking overlay adds sixteen common meal archetypes');
assert.equal(new Set(cookingData.recipes.map(recipe => recipe.id)).size, cookingData.recipes.length, 'expanded cooking recipe ids remain unique');
for (const recipeId of expandedRecipeIds) {
  const recipe = cookingData.recipes.find(candidate => candidate.id === recipeId); // Used to validate each newly overlaid recipe by id.
  assert(recipe, `${recipeId} is installed by the food-processing overlay`);
  assert(recipe.slots.length > 0 && recipe.slots.every(slot => slot.accepts.length > 0), `${recipeId} remains category-constrained`);
  assert(cookingData.identityNameRules[recipeId], `${recipeId} has an ingredient-led naming rule`);
}
// Noodle dishes require the reusable hearth base; other cooked-food shortcuts stay unchanged.
for (const recipeId of ['spicyNoodles', 'cheesyNoodles', 'fishNoodles', 'meatNoodles']) {
  const recipe = cookingData.recipes.find(candidate => candidate.id === recipeId); // Guards against restoring the raw-flour shortcut.
  const slot = recipe.slots.find(candidate => candidate.id === 'noodles'); // Used to check the actual required base.
  assert.deepEqual(Array.from(slot.accepts), ['noodleBase'], recipeId + ' requires basic noodles, not flour');
  assert.equal(slot.required, true);
}
assert.deepEqual(Array.from(cookingData.recipes.find(recipe => recipe.id === 'basicNoodles').slots.map(slot => slot.id)), ['flour', 'egg'], 'basic noodles still start with flour and egg');
for (const recipeId of ['eggToast', 'cheeseToast', 'savorySandwich', 'sweetBreadPudding', 'hearthFlatbread']) {
  const recipe = cookingData.recipes.find(candidate => candidate.id === recipeId); // Keeps toast/bread recipes reachable with uncooked flour.
  assert(recipe.slots.find(slot => slot.id === 'bread')?.accepts.includes('flour'), recipeId + ' can be cooked without recooking hearth bread');
}
assert(cookingData.recipes.find(recipe => recipe.id === 'sweetGoopyMustardSauce')?.slots.find(slot => slot.id === 'mayo')?.accepts.includes('oil'),
  'mustard sauce can use uncooked cooking oil instead of requiring hearth mayonnaise');
const expandedCategories = new Set(cookingData.recipes.flatMap(recipe => recipe.slots.flatMap(slot => slot.accepts))); // Used to verify the new meals actually broaden ingredient-family usage.
for (const category of ['bread', 'sauce', 'herb', 'mollusk']) assert(expandedCategories.has(category), `${category} participates in the expanded meal roster`);
assert.match(processing.diagnosticsText(), /Expanded meals: 16/, 'food-processing diagnostics report the expanded meal count');
assert.equal(processing.SQUEEZING_VAT.name, 'Squeezing Vat', 'the old hand/grape names resolve to one squeezing-vat station');
assert.equal(processing.getProcessingOutputs('squeezing', 'crownedPineNuts', cookingData.items.crownedPineNuts)[0].key, 'crownedPineNutOil', 'crowned pine nuts press into their own oil');
assert.equal(processing.getProcessingOutputs('squeezing', 'shadewoodNuts', cookingData.items.shadewoodNuts)[0].key, 'shadewoodNutOil', 'shadewood nuts press into their own oil');
const lard = processing.getProcessingOutputs('squeezing', 'garWolfMeat', { label: 'Gar-wolf Meat', tags: ['Meat'], cookingPrimaryEffect: 'strength' })[0];
assert.equal(lard.label, 'Gar-wolf Lard', 'any tagged meat renders into species-specific lard');
assert(lard.cookingCategories.includes('oil'), 'lard is reusable anywhere cooking accepts fat');
const fishOil = processing.getProcessingOutputs('squeezing', 'rockscale_goldplate', { label: 'Rockscale Goldplate', tags: ['Fish'], cookingPrimaryEffect: 'fortitude' })[0];
assert.equal(fishOil.label, 'Rockscale Goldplate Oil', 'fish oil preserves the full named fish subspecies');
assert.equal(fishOil.cookingPrimaryEffect, 'fortitude', 'fish oil inherits the source fish buff instead of becoming generic Fishing oil');
const nutDrop = processing.rollTreeNutDrop('map_northern_cliffs', () => 0, {
  bonusYieldChance: () => 1,
  rollQuality: () => 5,
});
assert.deepEqual({ key: nutDrop.itemKey, amount: nutDrop.amount, stars: nutDrop.stars }, { key: 'crownedPineNuts', amount: 3, stars: 5 }, 'Foraging can improve both tree-nut quantity and quality');

const gameSource = fs.readFileSync('docs/game.js', 'utf8');
const indexSource = fs.readFileSync('docs/index.html', 'utf8');
const cookingSource = fs.readFileSync('docs/js/cooking-system.js', 'utf8');
const festivalSource = fs.readFileSync('docs/js/festival-system.js', 'utf8');
const processingSource = fs.readFileSync('docs/js/food-processing.js', 'utf8');
const authoredRuntimeSource = fs.readFileSync('docs/js/authored-furniture-runtime.js', 'utf8');
const farmAnimalsSource = fs.readFileSync('docs/js/farm-animals.js', 'utf8');
const farmPanelSource = fs.readFileSync('docs/js/farm-panel-core.js', 'utf8'); // The Farm tab renderer; farm-panel.js now only adds stable training.
const dewVatsSource = fs.readFileSync('docs/js/dew-vats.js', 'utf8');
const squeezerAuthored = JSON.parse(fs.readFileSync('docs/config/furniture-authored/squeezer.json', 'utf8'));
const alchemySource = fs.readFileSync('docs/js/alchemy-system.js', 'utf8');
const itemProcessingSource = fs.readFileSync('docs/js/item-processing.js', 'utf8');
assert.match(gameSource, /hearthFurniture:\s*\(\) => makeCookingInteractable\(\)/, 'authored building hearths open cooking');
assert.match(gameSource, /o\.key === 'hearth'.*makeCookingInteractable/, 'placed farmhouse hearths open cooking');
assert.match(gameSource, /derivedHearth[\s\S]{0,600}makeCookingInteractable/, 'derived farmhouse hearths open cooking');
assert.doesNotMatch(indexSource, /<div class="skill-name">Alchemy<\/div>/, 'Alchemy has no inert static stub row (it is JS-rendered only)');
for (const name of ['Foraging', 'Mining', 'Farming', 'Fishing', 'Combat', 'Cooking']) assert(indexSource.includes(`>${name}<`), `${name} appears in the static Skills tab placeholder, immediately replaced by SkillSystem.render()`);
assert.match(cookingSource, /function openAtHearth\(/, 'cooking owns a hearth-only open entry point');
assert.match(cookingSource, /function currentGameHour\([\s\S]{0,900}timeDebugSnapshot/, 'cooked-food timers use the monotonic in-game calendar clock');
assert.match(cookingSource, /expiresAtGameHour/, 'ordinary food effects expire against in-game hours');
assert.match(cookingSource, /remainingHours/, 'ordinary food timers persist as remaining in-game hours');
assert.match(festivalSource, /FOOD_PORTION_HOURS = 4/, 'each festival food portion adds four in-game hours');
assert.match(festivalSource, /remainingHours\+FOOD_PORTION_HOURS/, 'each serving adds four hours to the transferred remaining duration');
assert.match(festivalSource, /state\.feastBuffs=\[\{ id:meal\.id/, 'eating any festival meal replaces the previous meal buff with the newly eaten food');
assert.match(festivalSource, /activeBuffs\.reduce\(\(total,entry\)=>total\+Math\.max\(0,entry\.expiresHour-now\),0\)/, 'changing foods carries forward all active remaining duration');
assert.match(festivalSource, /combinedHours= Math\.min|combinedHours=Math\.min/, 'restoring legacy saves consolidates old meal timers under the newest food buff');
assert.match(festivalSource, /storedHours\*\(FOOD_PORTION_HOURS\/24\)/, 'existing 24-hour portions scale down proportionally during one-time migration');
assert.match(festivalSource, /FULLNESS_DURATION_HOURS = 24/, 'festival fullness remains an independent 24-hour effect');
assert.match(festivalSource, /expiresHour/, 'festival meal effects expire against the calendar clock');
assert.match(festivalSource, /durationS:FOOD_PORTION_HOURS\*MAX_FOOD_PORTIONS\*3600/, 'festival meal HUD countdown uses the ten-portion 40-hour cap');
assert.match(festivalSource, /durationS:FULLNESS_DURATION_HOURS\*3600/, 'festival fullness HUD countdown remains 24 hours');
assert.match(festivalSource, /feastBuffDurationHours=FOOD_PORTION_HOURS/, 'new saves identify the festival meal timer schema');
assert.match(festivalSource, /storedHours\*\(FOOD_PORTION_HOURS\/24\)/, 'existing 24-hour-per-portion meal timers migrate proportionally to four hours once');
assert.match(festivalSource, /legacyDuration/, 'existing active festival fullness saves retain their one-time 24-hour migration');
assert.match(festivalSource, /expiresHour:worldHour\(\)\+FULLNESS_DURATION_HOURS/, 'festival fullness expiry is independent from meal portion duration');
assert.match(festivalSource, /\+ FOOD_PORTION_HOURS \+ ' in-game hours of meal effects/, 'the serving confirmation reports four hours per portion');
assert.match(cookingSource, /recipe\?\.inventoryCategories/, 'saved cooked bases recover their reusable recipe categories');
assert.match(cookingSource, /ingredientEffectTotals\(definition, selected\?\.stars\)/, 'meal totals reuse the same per-ingredient buff calculation displayed by the picker');
assert.match(cookingSource, /Cooking buff:/, 'ingredient candidates and selected ingredients visibly identify their cooking buff');
assert.match(cookingSource, /No buff in this recipe/, 'structural recipe slots explicitly say when they suppress an ingredient buff');
assert.match(gameSource, /function cookingBuffDisplayForItem\(key, def\)[\s\S]{0,1800}ingredientBuffText[\s\S]{0,1800}availableQualityEntries/, 'Pack inventory details reuse CookingSystem ingredient buff text and inspect owned quality buckets');
assert.match(gameSource, /Cooking buffs by quality:[\s\S]{0,700}starGlyphs\(safeStars\)[\s\S]{0,700}row\.buffText/, 'mixed-quality ingredient stacks label each owned quality with its exact cooking contribution');
assert.match(gameSource, /set\('iiDesc',\s*itemDescriptionWithFlavor\(key, def\)\)/, 'normal inventory item details visibly include the cooking-buff-aware description');
assert.doesNotMatch(cookingSource, /(?:import|require).*game\.js/, 'the cooking module does not import game.js');
assert.match(alchemySource, /registerProvider\('alchemy'/, 'alchemy contributes to the shared effect HUD');
assert.match(cookingSource, /registerProvider\('food'/, 'food contributes to the shared effect HUD independently');
assert.match(cookingSource, /craftIngredientSaveChance/, 'Crafting ingredient saves are integrated');
assert.match(gameSource, /rareFishWeightMultiplier/, 'Fishing rarity weighting is integrated');
assert.match(indexSource, /js\/food-processing\.js/, 'the decoupled food-processing module loads before game boot');
assert.match(itemProcessingSource, /HobunjiFoodProcessing\?\.getProcessingOutputs/, 'item-processing.js delegates new vat recipes through a narrow adapter');
assert.match(gameSource, /HobunjiFoodProcessing\?\.rollTreeNutDrop/, 'game.js delegates tree-nut yield rules through a narrow adapter');
assert.doesNotMatch(processingSource, /(?:import|require).*game\.js/, 'food processing does not import game.js');
assert.match(cookingSource, /consumeBestQuality/, 'processors can consume tracked quality without desynchronizing cooking stacks');
const squeezingTimeline = squeezerAuthored.processTimelines.find(timeline => timeline.enabled !== false);
assert.equal(squeezingTimeline.duration, 12, 'the vat still plays its editor-authored 12-second visual timeline, independent of the in-game hour job');
assert.equal(squeezingTimeline.liquidTracks.length, 2, 'the authored process transfers both the upper and collected liquid surfaces');
assert(squeezerAuthored.stompAttachPoints.some(point => point.enabled !== false && point.anchorName === 'shoulderGrip'), 'the vat exports a live livestock stomp anchor');
assert.match(authoredRuntimeSource, /function applyProcessTimeline\(/, 'the game runtime samples authored furniture process timelines');
assert.match(authoredRuntimeSource, /_liquidSurfaceGeometry/, 'liquid levels rebuild from the linked cup profile instead of a static disc');
assert.match(authoredRuntimeSource, /function stompAttachWorldMatrix\(/, 'the runtime resolves the furniture-editor stomp anchor after warping');
assert.match(authoredRuntimeSource, /resetWarp\(group, warp\);\s*group\.updateMatrixWorld\(true\);\s*const center = _warpCentroid/, 'runtime warp playback resets to the authored rest frame before deriving its centroid, matching the editor');
assert.doesNotMatch(authoredRuntimeSource, /box\.setFromObject\(mesh\)/, 'warp centroid excludes descendant VFX instead of recursively measuring particle children');
assert.match(authoredRuntimeSource, /box\.copy\(geometry\.boundingBox\)\.applyMatrix4\(mesh\.matrixWorld\)/, 'warp centroid measures each furniture part geometry in world space');
assert.match(authoredRuntimeSource, /authored_furniture_emitter_/, 'runtime emitter meshes are named for Pixel Probe diagnostics');
assert.match(gameSource, /kind: 'timed'[\s\S]{0,500}readyAtGameHour: now \+ durationHours/, 'squeezing persists an in-game-hour production job instead of granting its output immediately');
assert.match(gameSource, /const started = startTimedJob\(outputs, inputStars, inputLabel\)/, 'manual nut, meat, and fish inputs start a timed squeezing job independently of visual authoring');
assert.match(farmAnimalsSource, /function setVatWorkerPose\(/, 'assigned livestock are rendered at the live vat anchor during a batch');
assert.match(farmAnimalsSource, /targetMatrix\.clone\(\)\.multiply\(staticPose\.gripMatrix\)\.multiply\(staticPose\.sizeMatrix\)/, 'live vat workers use the editor hierarchy: target × inverse scaled grip × size');
assert.doesNotMatch(farmAnimalsSource, /\(grip\.y \|\| 0\) - animal\.halfHeight/, 'vat attachment no longer invents a half-height offset absent from the furniture editor');
assert.match(dewVatsSource, /creatureSizeClass\?\.\(kind, genotype\) === 'small'/, 'only Small livestock satisfy the squeezing-vat size predicate');
assert.match(dewVatsSource, /return !!rec\?\.barnId && vatCanAccept\(rec\.kind, rec\.genotype\)/, 'a vat worker must be housed as well as Small, so stasis animals cannot satisfy the worker gate');
assert.doesNotMatch(dewVatsSource, /kind !== 'uumkaoii'/, 'vat worker eligibility is size-based rather than locked to Uumkao’ii');
assert.match(dewVatsSource, /function _pruneInvalidVatAssignments\(/, 'stale invalid vat assignments are migrated out of older saves');
assert.match(dewVatsSource, /stale non-Small\/unhoused livestock assignments/, 'old stasis-worker assignments are explicitly cleared');
assert.match(dewVatsSource, /function _guardSqueezingVatStart\(/, 'squeezing vats install a shared worker-required start guard');
assert.match(dewVatsSource, /!assignedWorkerForVat\(vat\.id\)/, 'manual and timed vat starts are blocked until a valid housed worker is already assigned');
assert.match(farmPanelSource, /entry\.barnId && window\.DewVats\.vatCanAccept\(entry\.kind, entry\.genotype\)/, 'the Farm tab hides squeezing-vat assignment from non-Small livestock');
assert.match(dewVatsSource, /return result\?\.ok \? 'started' : false/, 'automatic dew squeezing uses the same delayed vat job boundary');

// A separate live-module sandbox checks the actual processor and hearth boundaries,
// not just data definitions or string presence in game.js.
const terminalContext = {
  console,
  document: { readyState: 'complete', getElementById: () => ({}) },
  window: {},
}; // Hosts the standalone processors and CookingSystem without needing the Three.js world.
for (const path of [
  'docs/js/cooking-data.js', 'docs/js/item-processing.js',
  'docs/js/cooking-system.js', 'docs/js/food-processing.js',
]) vm.runInNewContext(fs.readFileSync(path, 'utf8'), terminalContext);
const itemProcessor = terminalContext.window.ItemProcessing; // Runs the exact station recipe adapter installed by food-processing.js.
const liveDefs = {
  rawRiverFish: { label: 'River Fish', cat: 'food', tags: ['Fish'], sellPrice: 12, cookingCategories: ['fish'], cookingPrimaryEffect: 'fishing' },
  oldFishOil: { label: 'Old Fish Oil', cat: 'processed', tags: ['Processed', 'Fish', 'Oil'], cookingCategories: ['fish', 'oil'] },
  oldRiverFishOil: { label: 'Old River Fish Oil', cat: 'processed', tags: ['Processed', 'Fish'], cookingCategories: ['fish'] },
}; // Includes legacy processed fats saved without cookingProcessSteps.
const terminalInventory = { rawRiverFish: 2, oldFishOil: 1, oldRiverFishOil: 1 }; // Supplies uncooked and legacy items to the cooking picker.
itemProcessor.init({ ITEM_DEFS: liveDefs, cropData: {}, PROCESSING_METHODS: ['squeezing', 'smoking', 'churning', 'composting'], getInventoryItems: () => [] });
const smokedRiverFish = itemProcessor.getProcessingOutputs('smoking', 'rawRiverFish')[0];
itemProcessor.ensureProcessedItemDef(smokedRiverFish);
assert.equal(smokedRiverFish.cookingProcessSteps[0].method, 'smoking');
assert.equal(itemProcessor.getProcessingOutputs('smoking', smokedRiverFish.key), null, 'smoked fish cannot be smoked again');
const pressedRiverFish = itemProcessor.getProcessingOutputs('squeezing', smokedRiverFish.key)[0];
itemProcessor.ensureProcessedItemDef(pressedRiverFish);
assert.equal(pressedRiverFish.cookingProcessSteps.length, 2, 'different preprocessing methods still legitimately chain');
assert.equal(itemProcessor.getProcessingOutputs('squeezing', pressedRiverFish.key), null, 'smoked fish oil cannot be squeezed twice');
assert.equal(itemProcessor.getProcessingOutput('squeezing', pressedRiverFish.key), null, 'single-output entry point shares the stop rule');
assert.equal(terminalContext.window.HobunjiFoodProcessing.getProcessingOutputs('squeezing', pressedRiverFish.key, liveDefs[pressedRiverFish.key]), null, 'direct vat calls cannot bypass the stop rule');
assert.equal(itemProcessor.getProcessingOutputs('squeezing', 'oldFishOil'), null, 'legacy fish oil with Oil tag cannot enter the vat');
assert.equal(itemProcessor.getProcessingOutputs('squeezing', 'oldRiverFishOil'), null, 'legacy fish oil recognized from key suffix cannot enter the vat');
const churnedRiverFish = itemProcessor.getProcessingOutputs('churning', pressedRiverFish.key)[0];
itemProcessor.ensureProcessedItemDef(churnedRiverFish);
assert.equal(churnedRiverFish.key, 'margarine', 'processed fish oil may go to a different station once');
assert.equal(itemProcessor.getProcessingOutputs('churning', churnedRiverFish.key), null, 'the same processing method cannot be repeated after churning');
const savedProcessed = JSON.parse(JSON.stringify(itemProcessor.serializeProcessedDefinitions()));
const obsoleteFishOil = {
  key: 'legacyFishOil', label: 'Legacy Fish Oil', icon: '🫗', cat: 'processed',
  tags: ['Processed', 'Fish', 'Oil'], cookingCategories: ['fish', 'oil'],
  cookingProcessMultiplier: 1.5, cookingProcessSteps: [{ method: 'squeezing', multiplier: 1.5 }],
}; // Simulates a historical persisted definition that reintroduced Fish after initial catalog registration.
itemProcessor.restoreProcessedDefinitions([...savedProcessed, obsoleteFishOil]);
assert.equal(itemProcessor.getProcessingOutputs('squeezing', pressedRiverFish.key), null, 'reloaded processed definitions retain stage history');
assert(!liveDefs.legacyFishOil.cookingCategories.includes('fish'), 'restoring saved fish oil must not resurrect its obsolete fish recipe category');
assert(liveDefs.legacyFishOil.cookingCategories.includes('oil'), 'legacy rendered fish oil remains a usable cooking fat');

const cookingTerminal = terminalContext.window.CookingSystem; // Exercises generated hearth food with normal ingredient categories.
cookingTerminal.init({
  ITEM_DEFS: liveDefs, inventory: terminalInventory, inventoryItems: [],
});
cookingTerminal.registerCookedDefinition('fishPie', {
  label: 'River Fish Pie', tags: ['Cooked Food', 'Fish'], recipeId: 'fishStew', cookingCategories: ['fish'],
  foodEffects: { fishing: 50 }, cookingDefaultStars: 5,
});
terminalInventory.fishPie = 2;
const legacyPieOil = 'food_threeFishPie_olderOil'; // Pre-fix squeezed output retains a cooked meal's key even after its isCookedFood flag is lost.
itemProcessor.ensureProcessedItemDef({
  key: legacyPieOil, icon: '🫗', label: 'Old Fish Pie Oil', cat: 'processed',
  tags: ['Processed', 'Fish', 'Oil'], cookingCategories: ['oil'],
  cookingProcessMultiplier: 1.5, cookingProcessSteps: [{ method: 'squeezing', multiplier: 1.5 }],
  ingredientKeys: ['fishPie'],
});
terminalInventory[legacyPieOil] = 1;
assert.equal(itemProcessor.getProcessingOutputs('churning', legacyPieOil), null, 'an old fish-pie oil cannot reenter another processor');
assert.equal(terminalContext.window.HobunjiFoodProcessing.getProcessingOutputs('churning', legacyPieOil, liveDefs[legacyPieOil]), null,
  'direct churn recipe calls also refuse cooked-food descendants');
assert(!cookingTerminal.listIngredientDefinitions('oil').some(entry => entry.key === legacyPieOil),
  'oil made from a cooked pie cannot carry its boosted foodEffects into another hearth meal');
assert(!liveDefs.oldFishOil.cookingCategories.includes('fish'), 'old fish oil loses its incorrectly inherited raw-fish recipe category');
assert(!liveDefs.oldRiverFishOil.cookingCategories.includes('fish'), 'old fish-oil keys also migrate without an Oil tag');
assert(!liveDefs[pressedRiverFish.key].cookingCategories.includes('fish'), 'new pressed oils cannot occupy a recipe fish slot');
for (const method of ['squeezing', 'smoking', 'churning', 'composting']) {
  assert.equal(itemProcessor.getProcessingOutputs(method, 'fishPie'), null, 'hearth food cannot be processed by ' + method);
}
assert.equal(terminalContext.window.HobunjiFoodProcessing.getProcessingOutputs('squeezing', 'fishPie', liveDefs.fishPie), null, 'the direct squeezing recipe refuses cooked fish pies');
assert(!cookingTerminal.listIngredientDefinitions('fish').some(entry => entry.key === 'fishPie'), 'completed meals never appear in ingredient lists');
const fishOnlyRecipe = { id: 'terminal-test', slots: [{ id: 'fish', required: true, accepts: ['fish'] }] }; // A recipe slot that would otherwise accept the pie's inherited fish category.
assert.equal(cookingTerminal.bestAvailableSelection(fishOnlyRecipe).fish.key, 'rawRiverFish', 'cooked fish cannot feed its own cooking buff into another meal');
terminalInventory.rawRiverFish = 0;
assert.equal(cookingTerminal.bestAvailableSelection(fishOnlyRecipe).fish, undefined, 'only finished dishes in stock leaves a recipe unfillable');

// Verify actual slot selection with generated and restored noodle definitions.
const noodleKey = 'food_basicNoodles_test'; // Used to exercise the legacy recipe-id recovery path.
cookingTerminal.registerCookedDefinition(noodleKey, {
  label: 'Needlegrain Noodles', tags: ['Cooked Food', 'Noodles'],
  foodEffects: { cooking: 4 }, cookingDefaultStars: 3,
});
terminalInventory.needlegrainFlour = 2;
terminalInventory[noodleKey] = 1;
cookingTerminal.registerCookedDefinition('food_spicyNoodles_test', {
  label: 'Finished Spicy Noodles', cookingCategories: ['noodleBase', 'processedCrop'],
  foodEffects: { cooking: 50 }, cookingDefaultStars: 5,
});
terminalInventory.food_spicyNoodles_test = 1;
assert(cookingTerminal.listIngredientDefinitions('noodleBase').some(entry => entry.key === noodleKey));
assert(!cookingTerminal.listIngredientDefinitions('processedCrop').some(entry => entry.key === noodleKey), 'noodle bases do not bypass other slot categories');
for (const recipeId of ['spicyNoodles', 'cheesyNoodles', 'fishNoodles', 'meatNoodles']) {
  const recipe = terminalContext.window.HobunjiCookingData.recipes.find(candidate => candidate.id === recipeId); // Uses live recipe data.
  assert.equal(cookingTerminal.bestAvailableSelection(recipe).noodles.key, noodleKey);
  assert.equal(cookingTerminal.bestAvailableSelection(recipe, { noodles: 'needlegrainFlour' }).noodles, undefined, 'old saved flour combinations cannot bypass the base requirement');
  terminalInventory[noodleKey] = 0;
  assert.equal(cookingTerminal.bestAvailableSelection(recipe).noodles, undefined, 'flour and finished noodle dishes cannot substitute for the base');
  terminalInventory[noodleKey] = 1;
}
assert.equal(cookingTerminal.bestAvailableSelection({ slots: [{ id: 'crop', accepts: ['processedCrop'] }] }).crop?.key === noodleKey, false, 'basic noodles are restricted to noodle slots');
assert.equal(itemProcessor.getProcessingOutputs('squeezing', noodleKey), null, 'noodle exception does not extend to other processors');

console.log('skill and hearth cooking tests passed');
