const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repoRoot = path.resolve(__dirname, '..'); // Used to load the exact branch files under test.
const read = relativePath => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'); // Used by VM execution and source integration assertions.

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial)); // Used as the browser-localStorage backing map for save-scope assertions.
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

const saveMeta = {
  characters: [
    { id: 'char_test', gearInventory: { keyItems: [] } },
    { id: 'char_other', gearInventory: { keyItems: [] } },
  ],
  worlds: [
    { id: 'world_test', keyItems: [], members: { char_test: { questProgress: {}, cookingState: {} }, char_other: { questProgress: {}, cookingState: {} } } },
    { id: 'world_other', keyItems: [], members: {} },
  ],
};
const storage = memoryStorage({ hobunjiSaveMeta: JSON.stringify(saveMeta) }); // Used by KeyItemSystem and BanubuQuestline's real persistence paths.
const inventory = { herbA: 5, herbB: 5, herbC: 5, herbD: 5 }; // Used by TeaGrinder station/item registration and reward assertions.
let cookedInventory = []; // Used to feed exact qualifying Pie/Tea stacks into the real quest controller.
const consumedKeys = []; // Used to prove each turn-in consumes one actual cooked stack.
const unlockedRecipeIds = new Set(); // Used to prove Banubu teaches each recipe at the intended transition.
const registeredActions = new Map(); // Used to verify DialogueContent receives the Banubu action handler.
const registeredProviders = new Map(); // Used to verify DialogueContent receives the Banubu tree provider.

const fishDefinitions = [
  { key: 'fish_strength', definition: { label: 'Strength Fish', cookingCategories: ['fish'], cookingPrimaryEffect: 'strength' } },
  { key: 'fish_speed', definition: { label: 'Speed Fish', cookingCategories: ['fish'], cookingPrimaryEffect: 'speed' } },
  { key: 'fish_vigor', definition: { label: 'Vigor Fish', cookingCategories: ['fish'], cookingPrimaryEffect: 'vigor' } },
]; // Used to guarantee a concrete Three-Fish Pie with exactly three distinct buffs.

const alchemyRecipes = {
  teaStrength: { id: 'teaStrength', label: 'Strength Potion', application: 'buff', useMode: 'drink', stat: 'outgoingDamage' },
  teaSpeed: { id: 'teaSpeed', label: 'Speed Potion', application: 'buff', useMode: 'drink', stat: 'movementSpeed' },
  healing: { id: 'healing', label: 'Healing Potion', application: 'restoreHealth', useMode: 'drink', stat: null },
  frenzy: { id: 'frenzy', label: 'Frenzy', application: 'narcotic', useMode: 'drink', stat: 'attackSpeed' },
  love: { id: 'love', label: 'Love Potion', application: 'buff', useMode: 'drink', stat: 'positiveFavor' },
}; // Used to prove Tea Grinder narrows Alchemy's legal reaction space rather than accepting every potion outcome.

const context = {
  console,
  JSON,
  Math,
  Date,
  setInterval,
  clearInterval,
  localStorage: storage,
  __hobunjiPlayerProfile: {
    characterId: 'char_test',
    worldId: 'world_test',
    gearInventory: { keyItems: [] },
    questProgress: {},
    cookingState: {},
  },
  HobunjiCookingData: { recipes: [], categoryLabels: {}, effectLabels: { strength: 'Strength', speed: 'Speed', vigor: 'Vigor', fortitude: 'Fortitude', perception: 'Perception' } },
  GameRandom: { random: () => 0 },
  SkillSystem: { level: () => 10 },
  DialogueContent: {
    registerTreeProvider(id, fn) { registeredProviders.set(id, fn); },
    registerActionHandler(id, fn) { registeredActions.set(id, fn); },
  },
};
context.window = context;

context.CookingSystem = {
  listIngredientDefinitions(category) { return category === 'fish' ? fishDefinitions : []; },
  effectLabel(key) { return context.HobunjiCookingData.effectLabels[key] || key; },
  effectStrengthLabel(stacks) {
    const amount = Number(stacks) || 0;
    return amount >= 5 ? 'Exceptional' : amount >= 4 ? 'Potent' : amount >= 3 ? 'Concentrated' : amount >= 2 ? 'Hearty' : amount >= 1 ? 'Mild' : 'Trace';
  },
  formatEffectStrength(key, stacks) { return `${this.effectStrengthLabel(stacks)} ${this.effectLabel(key)} (+${stacks})`; },
  listCookedInventory() { return cookedInventory.filter(entry => entry.count > 0); },
  consumeCookedInventoryItem(key, amount) {
    const entry = cookedInventory.find(item => item.key === key);
    if (!entry || entry.count < amount) return { ok: false, message: 'missing cooked item' };
    entry.count -= amount;
    consumedKeys.push(key);
    return { ok: true, key, amount };
  },
  unlockRecipe(recipeId) { unlockedRecipeIds.add(recipeId); return { ok: true, recipeId }; },
  recordItemQuality() {},
  serialize() { return { unlockedRecipeIds: [...unlockedRecipeIds] }; },
};

context.AlchemySystem = {
  REAGENT_DEFS: Object.fromEntries(['herbA','herbB','herbC','herbD'].map((key, index) => [key, { label: key, icon: '🌿', traits: { humour: ['Flesh','Bones','Breath','Senses'][index], drive: 'Greaten', magnetism: ['Earth','Wind','Fire','Water'][index] } }])),
  enumerateRecipes(keys) {
    if (!Array.isArray(keys) || keys.length !== 3 || new Set(keys).size !== 3) return [];
    return Object.values(alchemyRecipes).map(recipe => ({ recipeId: recipe.id, recipe, assignments: [] }));
  },
  chooseOutcome(outcomes, targetId) { return outcomes.find(outcome => outcome.recipeId === targetId) || outcomes[0] || null; },
  targetingProbability() { return 0.75; },
};

vm.createContext(context);
vm.runInContext(read('docs/js/key-item-system.js'), context, { filename: 'key-item-system.js' });
vm.runInContext(read('docs/js/tea-grinder.js'), context, { filename: 'tea-grinder.js' });
context.TeaGrinder.init({
  ITEM_DEFS: {},
  inventory,
  clampInventoryStack(key) { if ((inventory[key] || 0) <= 0) delete inventory[key]; },
  refreshItemScroll() {},
  buildInventoryGrid() {},
  refreshActionBar() {},
  saveMemberWorldData() {},
  showToast() {},
  random: () => 0,
  setInteractionBlocked() {},
});
vm.runInContext(read('docs/js/banubu-quest-content.js'), context, { filename: 'banubu-quest-content.js' });
vm.runInContext(read('docs/js/banubu-questline.js'), context, { filename: 'banubu-questline.js' });

const content = context.BanubuQuestContent;
const questline = context.BanubuQuestline;
assert(content && questline && context.TeaGrinder && context.KeyItemSystem, 'all Banubu runtime modules must initialize');
let canonicalSaveCalls = 0;
assert.strictEqual(questline.init({
  getQuestProgress: () => context.__hobunjiPlayerProfile.questProgress,
  saveMemberWorldData() {
    canonicalSaveCalls++;
    const meta = JSON.parse(storage.getItem('hobunjiSaveMeta') || 'null');
    const world = meta.worlds.find(entry => entry.id === context.__hobunjiPlayerProfile.worldId);
    const member = world?.members?.[context.__hobunjiPlayerProfile.characterId];
    if (member) {
      member.questProgress = JSON.parse(JSON.stringify(context.__hobunjiPlayerProfile.questProgress || {}));
      member.cookingState = context.CookingSystem.serialize();
      storage.setItem('hobunjiSaveMeta', JSON.stringify(meta));
    }
  },
}), true, 'Banubu quest controller must bind to the game quest store and register once dependencies exist');
assert.strictEqual(questline.install(), true, 'Banubu quest controller install remains idempotent after dependency injection');
assert(registeredProviders.has('banubu') && registeredActions.has('banubuQuest'), 'Banubu dialogue provider/action handler must be registered');

// Recipes: exactly three fish plus flour + fat for Quest 1; exactly three Tea Blends + White Milk for Quest 2.
assert.strictEqual(content.threeFishPieRecipe.slots.length, 5);
assert.strictEqual(content.threeFishPieRecipe.slots.filter(slot => slot.accepts[0] === 'fish').length, 3);
const pieFlourSlot = content.threeFishPieRecipe.slots.find(slot => slot.id === 'flour');
const pieFatSlot = content.threeFishPieRecipe.slots.find(slot => slot.id === 'fat');
assert(pieFlourSlot?.required && pieFlourSlot.accepts.includes('flour') && pieFlourSlot.contributesEffects !== false, 'Three-Fish Pie flour must be required and allowed to contribute buffs');
assert(pieFatSlot?.required && pieFatSlot.accepts.includes('oil') && pieFatSlot.accepts.includes('butter') && pieFatSlot.contributesEffects !== false, 'Three-Fish Pie fat must accept oil/butter and contribute buffs');
assert.strictEqual(content.nineLeafTeaRecipe.slots.length, 4);
assert.strictEqual(content.nineLeafTeaRecipe.slots.filter(slot => slot.accepts[0] === 'teaBlend').length, 3);
const milkSlot = content.nineLeafTeaRecipe.slots.find(slot => slot.accepts[0] === 'whiteMilk');
assert(milkSlot?.required && milkSlot.contributesEffects === false, 'White Milk must be required but must not add an unrelated cooking buff');
assert(context.HobunjiCookingData.recipes.some(recipe => recipe.id === content.THREE_FISH_PIE_RECIPE_ID));
assert(context.HobunjiCookingData.recipes.some(recipe => recipe.id === content.NINE_LEAF_TEA_RECIPE_ID));
for (const recipe of [content.threeFishPieRecipe, content.nineLeafTeaRecipe]) {
  assert.strictEqual(typeof recipe.name, 'string', 'Banubu recipes must use CookingSystem.name rather than a parallel label field');
  assert.strictEqual(typeof recipe.description, 'string', 'Banubu recipes must use CookingSystem.description rather than a parallel desc field');
  assert.strictEqual(recipe.baseOutputName, recipe.name, 'Banubu recipes need a real base output name for cooked-item naming');
  assert(Array.isArray(recipe.outputTags) && recipe.outputTags.length > 0, 'Banubu recipes must expose CookingSystem.outputTags so cooking cannot spread undefined');
  assert.strictEqual(typeof recipe.outputIcon, 'string', 'Banubu recipes must expose a finished-food icon through the shared cooking schema');
}

// Tea Grinder must reuse alchemy legality but remove every non-food-buff outcome.
const teaOutcomes = context.TeaGrinder.enumerateBlendOutcomes(['herbA','herbB','herbC']);
assert.deepStrictEqual(JSON.parse(JSON.stringify([...new Set(teaOutcomes.map(outcome => outcome.cookingEffect))].sort())), ['speed','strength']);
assert(!teaOutcomes.some(outcome => ['healing','frenzy','love'].includes(outcome.recipeId)), 'healing, narcotic, and unmappable favor reactions must never become Tea Blends');
const blendWitnesses = context.TeaGrinder.allBlendEffects();
assert.deepStrictEqual(JSON.parse(JSON.stringify(blendWitnesses.map(entry => entry.effect).sort())), ['speed','strength']);
assert.strictEqual(context.TeaGrinder.BLEND_STACKS, 3);
context.TeaGrinder.registerItemDefs();
assert.strictEqual(context.TeaGrinder.blendItemKey('strength'), 'teaBlend_strength');
assert.strictEqual(JSON.parse(JSON.stringify(context.TeaGrinder.STAT_TO_COOKING_EFFECT)).outgoingDamage, 'strength');

// Composed Banubu database must discard generic/daily chatter and expose only the authored quest routing trees.
const composedDb = { npcs: [{ id: 'banubu', dialogueTrees: [{ id: 'old_daily_chat', label: 'generic' }], phrasePools: [{ id: 'old_morning_pool' }], events: [{ id: 'old_weather_event' }] }] };
content.mergeDialogueTreesIntoDatabase(composedDb);
const banubu = composedDb.npcs[0];
assert(banubu.dialogueTrees.length === content.dialogueTrees.length && banubu.dialogueTrees.every(tree => tree.banubuQuest), 'Banubu must expose only quest-routed dialogue trees');
assert.strictEqual(banubu.phrasePools.length, 0);
assert.strictEqual(banubu.events.length, 0);
assert(!banubu.dialogueTrees.some(tree => Number(tree.banubuQuest?.stage) > 2 && tree.banubuQuest?.phase === 'offer'), 'quests 3–5 must have no offer trees');
assert(banubu.dialogueTrees.some(tree => tree.banubuQuest?.phase === 'blocked' && tree.banubuQuest?.stage === 3), 'stage 3 must be an explicit authoring block');

// Quest 1 target is generated before intro text resolves, so its three buff names are real and stable.
let state = questline.ensureQuestState();
assert.strictEqual(state.status, 'intro');
assert.strictEqual(state.introTalkAttempts, 0);
const introSleep1 = questline.selectTree(banubu);
assert.strictEqual(introSleep1.id, 'banubu_intro_sleep_1');
assert.strictEqual(introSleep1.nodes.length, 1);
assert.strictEqual(introSleep1.nodes[0].text, 'Zzzzz.');
assert.strictEqual(introSleep1.nodes[0].next, null);
assert.strictEqual(state.introTalkAttempts, 1);
assert.strictEqual(banubu._animalDialogueEyesOpen, false);
const introSleep2 = questline.selectTree(banubu);
assert.strictEqual(introSleep2.id, 'banubu_intro_sleep_2');
assert.strictEqual(introSleep2.nodes.length, 1);
assert.strictEqual(introSleep2.nodes[0].text, 'Let me rest my eyes for just a few more minutes.');
assert.strictEqual(introSleep2.nodes[0].next, null);
assert.strictEqual(state.introTalkAttempts, 2);
assert.strictEqual(banubu._animalDialogueEyesOpen, false);
const intro = questline.selectTree(banubu);
assert.strictEqual(intro.id, 'banubu_intro');
assert.strictEqual(intro.banubuQuest.phase, 'intro');
assert.strictEqual(intro.entryNode, 'banubu_intro_3');
assert.strictEqual(state.introTalkAttempts, 3);
assert.strictEqual(banubu._animalDialogueEyesOpen, true);
assert.strictEqual(questline.dialogueEyesOpen(), true);
assert.strictEqual(questline.selectTree(banubu).id, 'banubu_intro', 'later pre-quest talks must not replay the two sleep-only attempts');
assert.strictEqual(state.introTalkAttempts, 3);
assert.strictEqual(state.target.questType, 'threeFishPie');
assert.strictEqual(state.target.requiredEffects.length, 3);
assert.strictEqual(state.target.solutionFishKeys.length, 3);
assert.strictEqual(context.CookingSystem.effectStrengthLabel(3), 'Concentrated');
assert.strictEqual(questline.unlockRecipe(banubu).ok, true);
assert(unlockedRecipeIds.has(content.THREE_FISH_PIE_RECIPE_ID));
assert.strictEqual(state.status, 'offer');
assert.strictEqual(state.stage, 1);
assert.strictEqual(questline.acceptQuest(banubu, 1).ok, true);
assert.strictEqual(state.status, 'active');
assert.strictEqual(state.progress.kind, 'story');
assert.strictEqual(state.progress.provider, 'banubu');
assert.strictEqual(state.progress.npcName, 'Lord Banubu');
assert.match(state.progress.title, /^Lord Banubu — /);
assert.strictEqual(state.progress.stage, 1);
assert.match(state.progress.title, /Three-Fish Pie/);
assert.match(state.progress.objective, /Three-Fish Pie/);
assert.match(state.progress.detail, /flour and cooking fat/i, 'Quest 1 task detail must mention the crust requirements');
assert.strictEqual(questline.menuStatus().ready, false);

const [pieEffectA, pieEffectB, pieEffectC] = state.target.requiredEffects; // Used to model two fish-provided effects plus one lucky crust-provided requested effect.
cookedInventory = [{
  key: 'food_banubu_q1_missing',
  count: 1,
  definition: {
    recipeId: content.THREE_FISH_PIE_RECIPE_ID,
    foodEffects: { [pieEffectA]: 1, [pieEffectB]: 1, cooking: 2 },
  },
}];
assert.strictEqual(questline.matchingMeal(state), null, 'an unrelated crust buff cannot replace a missing requested effect');
cookedInventory = [{
  key: 'food_banubu_q1_crust_helped',
  count: 1,
  definition: {
    recipeId: content.THREE_FISH_PIE_RECIPE_ID,
    foodEffects: { [pieEffectA]: 1, [pieEffectB]: 1, [pieEffectC]: 1, cooking: 2 },
  },
}];
assert(questline.matchingMeal(state), 'a requested effect supplied by the crust may complete the Three-Fish Pie even when it also carries an extra crust buff');
assert.strictEqual(questline.menuStatus().ready, true, 'Tasks menu readiness must use the same cooked-inventory matcher as Banubu dialogue');

// The Color Pools Key is world-scoped. A missing persistent world must fail
// before consuming the requested pie or leaking a live-only unlock.
context.__hobunjiPlayerProfile.worldId = 'missing_world';
const failedTurnIn = questline.turnInQuest(banubu, 1); // Exercises the world-save/reward failure boundary before the successful turn-in below.
assert.strictEqual(failedTurnIn.ok, false);
assert.strictEqual(cookedInventory[0].count, 1, 'failed world reward persistence must leave the quest meal untouched');
assert.strictEqual(context.KeyItemSystem.has('color_pools_key'), false, 'failed persistence must not leak the Color Pools Key');
context.__hobunjiPlayerProfile.worldId = 'world_test';

assert.strictEqual(questline.turnInQuest(banubu, 1).ok, true);
assert.strictEqual(consumedKeys.length, 1);
assert.strictEqual(context.KeyItemSystem.has('color_pools_key'), true, 'Quest 1 must grant the world-scoped Color Pools Key');
assert.strictEqual(context.KeyItemSystem.has('war_paint_kit'), false, 'War-Paint Kit stays reserved for later content and is not this quest reward');
assert.strictEqual(context.KeyItemSystem.definitionFor('color_pools_key').scope, 'world');
assert.strictEqual(context.KeyItemSystem.definitionFor('war_paint_kit').scope, 'character');
assert.strictEqual(inventory.teaGrinderFurniture, 1, 'Quest 1 must give one placeable Tea Grinder');
assert(unlockedRecipeIds.has(content.NINE_LEAF_TEA_RECIPE_ID), 'Quest 1 turn-in must teach Nine Leaf Tea');
state = questline.ensureQuestState();
assert.strictEqual(state.status, 'offer');
assert.strictEqual(state.stage, 2);
assert.strictEqual(state.target.questType, 'nineLeafTea');
assert.strictEqual(state.target.requiredEffects.length, 2);
assert.strictEqual(state.target.minStacks, 3);
assert.strictEqual(state.target.solutionBlendEffects.length, 3);
assert.strictEqual(state.target.solutionReagentTrios.length, 3);
assert(state.target.solutionReagentTrios.every(trio => trio.length === 3), 'every Tea Blend proof must be an actual three-herb selection');

// Quest 2 rejects under-strength tea even when the effect names are correct.
assert.strictEqual(questline.acceptQuest(banubu, 2).ok, true);
assert.strictEqual(state.progress.kind, 'story');
assert.strictEqual(state.progress.stage, 2);
assert.match(state.progress.title, /Nine Leaf Tea/);
assert.match(state.progress.objective, /Concentrated \(\+3\)/);
cookedInventory = [{
  key: 'food_banubu_q2_weak',
  count: 1,
  definition: {
    recipeId: content.NINE_LEAF_TEA_RECIPE_ID,
    foodEffects: Object.fromEntries(state.target.requiredEffects.map(effect => [effect, 2])),
  },
}];
assert.strictEqual(questline.matchingMeal(state), null, 'Hearty (+2) is below the Concentrated (+3) Quest 2 requirement');
cookedInventory = [{
  key: 'food_banubu_q2_extra',
  count: 1,
  definition: {
    recipeId: content.NINE_LEAF_TEA_RECIPE_ID,
    foodEffects: { ...Object.fromEntries(state.target.requiredEffects.map(effect => [effect, 3])), cooking: 1 },
  },
}];
assert.strictEqual(questline.matchingMeal(state), null, 'Three-Fish Pie extra-buff tolerance must not loosen Nine Leaf Tea\'s exact-effect requirement');
cookedInventory = [{
  key: 'food_banubu_q2',
  count: 1,
  definition: {
    recipeId: content.NINE_LEAF_TEA_RECIPE_ID,
    foodEffects: Object.fromEntries(state.target.requiredEffects.map(effect => [effect, 3])),
  },
}];
assert(questline.matchingMeal(state), 'Concentrated (+3) on both requested buffs must satisfy Quest 2');
assert.strictEqual(questline.turnInQuest(banubu, 2).ok, true);
assert.strictEqual(state.status, 'blocked');
assert.strictEqual(state.stage, 3);
assert.strictEqual(questline.selectTree(banubu).banubuQuest.phase, 'blocked');
assert.strictEqual(questline.acceptQuest(banubu, 3).ok, false, 'Quest 3 must remain mechanically unavailable');

// Save-scope assertion for the first reward: the cave access key belongs to
// the world, so every character in that world sees it, while another world does not.
const persisted = JSON.parse(storage.getItem('hobunjiSaveMeta'));
assert(!persisted.characters[0].gearInventory.keyItems.includes('color_pools_key'));
assert(!persisted.characters[0].gearInventory.keyItems.includes('war_paint_kit'));
assert(persisted.worlds.find(world => world.id === 'world_test').keyItems.includes('color_pools_key'));
assert(!persisted.worlds.find(world => world.id === 'world_test').keyItems.includes('war_paint_kit'));
context.__hobunjiPlayerProfile.characterId = 'char_other';
context.__hobunjiPlayerProfile.gearInventory = { keyItems: [] };
assert.strictEqual(context.KeyItemSystem.has('color_pools_key'), true, 'another character in the same world must inherit cave access');
context.__hobunjiPlayerProfile.worldId = 'world_other';
assert.strictEqual(context.KeyItemSystem.has('color_pools_key'), false, 'a different world must not inherit cave access');
context.__hobunjiPlayerProfile.characterId = 'char_test';
context.__hobunjiPlayerProfile.worldId = 'world_test';

// Canonical source database must itself be clean so the Dialogue Editor does not resurrect generated daily chatter.
const npcDatabase = JSON.parse(read('docs/config/npcs/hobunji-starter-npc-database.json'));
const sourceBanubu = npcDatabase.npcs.find(npc => npc.id === 'banubu');
assert.strictEqual(sourceBanubu.name, 'Lord Banubu', 'canonical NPC database must expose Lord Banubu as the player-facing name');
assert(sourceBanubu);
assert.deepStrictEqual(sourceBanubu.dialogueTrees, []);
assert.deepStrictEqual(sourceBanubu.phrasePools, []);
assert.match(sourceBanubu.loreBackground, /Nine Leaf Tea/);
assert.match(sourceBanubu.loreBackground, /blocked/i);
assert(!/Fifteen Fish Pie|morning pool|too hungry to hunt/i.test(JSON.stringify(sourceBanubu)));

// Runtime integration: processor placement, module order, shared strength vocabulary, and editor controls.
const gameSource = read('docs/game.js');
assert.match(gameSource, /teaGrinder:[\s\S]{0,420}specialMode:\s*'teaGrinder'/);
assert.match(gameSource, /TeaGrinder\?\.init\(/);
assert.match(gameSource, /def\.specialMode === 'teaGrinder'[\s\S]{0,260}TeaGrinder\?\.open/);
assert.match(read('docs/js/procedural-furniture.js'), /CATALOG\.teaGrinder/);

const cookingSource = read('docs/js/cooking-system.js');
assert.match(cookingSource, /minStacks:\s*3,\s*label:\s*'Concentrated'/);
assert.match(cookingSource, /recipe\?\.outputIcon/, 'CookingSystem must honor bespoke recipe output icons');
assert.match(cookingSource, /slot\.contributesEffects === false/);
assert.match(cookingSource, /recipe\.slots\.forEach\(slot => \{[\s\S]{0,260}selectedSlots\[slot\.id\][\s\S]{0,520}cookingPrimaryEffect/, 'CookingSystem effect totals must evaluate every contributing recipe slot, including Three-Fish Pie flour and fat');
assert.match(cookingSource, /formatEffectStrength\(effect, amount\)/);
assert.match(cookingSource, /effectStrengthLabel\(effect\.stacks\)/);

const indexHtml = read('docs/index.html');
assert(indexHtml.indexOf('cooking-system.js') < indexHtml.indexOf('tea-grinder.js'));
assert(indexHtml.indexOf('alchemy-system.js') < indexHtml.indexOf('tea-grinder.js'));
assert(indexHtml.indexOf('tea-grinder.js') < indexHtml.indexOf('banubu-questline.js'));
assert(indexHtml.indexOf('banubu-quest-content.js') < indexHtml.indexOf('local-db-overrides.js'));

const editorState = read('docs/tools/dialogue-editor/dialogue-editor-state.js');
const editorInspector = read('docs/tools/dialogue-editor/dialogue-editor-inspector.js');
assert.match(editorState, /BanubuQuestContent\?\.mergeDialogueTreesIntoDatabase\?\.\(db\)/, 'manual Dialogue Editor imports must compose Banubu quest defaults just like normal editor boot');
for (const token of ['{{banubuRequestedBuffs}}','{{banubuNextRequestedBuffs}}','{{banubuRequiredStrength}}','{{banubuNextRequiredStrength}}']) {
  assert(editorState.includes(token), `Dialogue Editor must expose ${token}`);
}
for (const control of ['editBanubuPhase','editBanubuStage','editBanubuQuestType','editBanubuBuffCount','editBanubuMinStacks','editBanubuRewardId']) {
  assert(editorInspector.includes(control), `Dialogue Editor must expose ${control}`);
}
assert(editorInspector.includes("'blocked'"), 'Dialogue Editor must author the blocked phase');

// Sleeping Grehlr behavior remains permanent and talkability uses the existing animal-NPC bridge.
const schedule = require('../docs/config/npcs/schedule-overrides.json');
const banubuSchedule = (schedule.scheduleReplacements || []).find(entry => entry.npcId === 'banubu');
assert.strictEqual(banubuSchedule.scheduleHooks.defaultStationId, 'station_banubu_cave_sleep');
assert.strictEqual(banubuSchedule.scheduleHooks.rules.length, 1);
assert.strictEqual(banubuSchedule.scheduleHooks.rules[0].from, '00:00');
assert.strictEqual(banubuSchedule.scheduleHooks.rules[0].to, '24:00');
assert(!banubuSchedule.scheduleHooks.rules.some(rule => rule.stationId === 'station_banubu_cave_awake'));

const sleepPresentation = read('docs/js/animal-sleep-presentation.js');
assert.match(sleepPresentation, /function registerExternalSleeper\(/, 'named animal NPCs must be able to opt into the shared animal sleep presenter');
assert.match(sleepPresentation, /eyesClosed = typeof config\.eyesClosed === 'function'/, 'external sleepers must be able to open only their eyes while preserving the sleep body pose');
assert.match(sleepPresentation, /frameCacheKey\(kind, frame, genotype, eyesClosed = true\)/, 'sleep frame cache must distinguish open-eye and closed-eye versions of the same species sleep frame');
assert.match(sleepPresentation, /if \(sleeping && run2\) return \{ frame: 'run2'/, 'sleep presentation must prefer each species run2 frame when available');
assert.match(sleepPresentation, /renderer\.composeFrame\(kind, descriptor\.frame, genotype \|\| null, eyesClosed\)/, 'sleep presentation must use the species blink-shut composite while asleep');
const creatureRendererSource = read('docs/js/creature-genetics-render.js');
assert.match(creatureRendererSource, /grehlr:[\s\S]{0,320}run2: 'assets\/creaturesprites\/grehlr_run2\.png'/, 'Grehlr must retain its species-specific run2 sleep body source');
assert.match(creatureRendererSource, /grehlr:[\s\S]{0,420}blink: 'assets\/creaturesprites\/grehlr_blink\.png'/, 'Grehlr must retain its species-specific blink\/closed-eye overlay');
assert.match(gameSource, /_animalSleepRequested = !!this\.animalDef && \/sleep\/i\.test/, 'named animal NPC sleeping must come from the authored schedule activity');
assert.match(gameSource, /AnimalSleepPresentation\.registerExternalSleeper\(this/, 'named animal walkers must register with the shared sleep animation system');
assert.match(gameSource, /eyesClosed: \(\) => !\(dialogueOpen && _dialogueWalker === this && this\.rec\?\._animalDialogueEyesOpen === true\)/, 'sleeping named animals may open their eyes only while their own eligible dialogue is open');
assert.match(read('docs/js/livestock-nursery-install-bridge.js'), /animal-sleep-presentation\.js\?v=20260924animaleyes1/, 'runtime loader must deliver the current named-animal sleep presenter');
assert.match(gameSource, /expressionEyesClosed: \(\) => dialogueOpen && _dialogueWalker === this/, 'awake named animals use their current dialogue eye expression');
assert.match(sleepPresentation, /sleeping \|\| expressionEyesClosed/, 'awake closed-eye expressions use the existing animal blink composite');
const banubuContent = read('docs/js/banubu-quest-content.js'); // Verifies every authored Banubu sleep line receives its editor-visible eye expression.
assert.match(banubuContent, /expression: \/zzz\/i\.test\(text\) \? 'eyes_closed' : 'neutral'/);

const speciesOverrides = require('../docs/config/npcs/species-overrides.json');
assert.strictEqual(speciesOverrides.npcs.banubu.species, 'grehlr');
assert.strictEqual(speciesOverrides.npcs.banubu.avatarExport.appearance.avatarType, 'animal');

// The real current Alchemy definitions—not only the synthetic filter fixture above—must keep Quest 2 feasible.
const liveContext = { console, JSON, Math, Date }; // Used as a dependency-light VM for pure alchemy/Tea Grinder enumeration.
liveContext.window = liveContext;
vm.createContext(liveContext);
vm.runInContext(read('docs/js/alchemy-system.js'), liveContext, { filename: 'alchemy-system-live.js' });
vm.runInContext(read('docs/js/tea-grinder.js'), liveContext, { filename: 'tea-grinder-live.js' });
const liveBlendWitnesses = liveContext.TeaGrinder.allBlendEffects();
assert(liveBlendWitnesses.length >= 2, 'real Alchemy recipes must expose at least two distinct Tea Blend cooking buffs for Quest 2');
assert(liveBlendWitnesses.every(entry => entry.reagentKeys.length === 3), 'every real Tea Blend buff must retain a concrete three-reagent witness');
assert(new Set(liveBlendWitnesses.map(entry => entry.effect)).size === liveBlendWitnesses.length, 'Tea Grinder witness list must deduplicate cooking effects');

console.log('Banubu Pie → Color Pools world key → Tea → blocked progression, Tea Grinder filtering, dialogue cleanup, and save-scope checks passed');

assert(canonicalSaveCalls > 0, 'Banubu state changes must persist through the canonical game save dependency when injected');

assert.match(read('docs/game.js'), /BanubuQuestline\?\.init\?\.\(\{[\s\S]*getQuestProgress: \(\) => questProgress[\s\S]*saveMemberWorldData/, 'game runtime must inject the canonical quest store/save path into BanubuQuestline');
assert.match(read('docs/js/tasks-panel.js'), /kind === 'story'[\s\S]*state\?\.status === 'active'/, 'Tasks panel must include active authored story quests');
