const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repoRoot = path.resolve(__dirname, '..'); // Used to load the exact runtime/editor files under test.
const read = relativePath => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'); // Used by syntax/content integration assertions below.

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial)); // Used as the browser-localStorage backing map in the VM runtime.
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

const saveMeta = { // Used to prove character keys and world keys land in different persistent records.
  characters: [{ id: 'char_test', gearInventory: { keyItems: [] } }],
  worlds: [{
    id: 'world_test',
    keyItems: [],
    members: {
      char_test: { questProgress: {}, cookingState: {} },
    },
  }],
};
const storage = memoryStorage({ hobunjiSaveMeta: JSON.stringify(saveMeta) }); // Used as BanubuQuestline/KeyItemSystem's real persistence surface.
let cookedInventory = []; // Used to feed exact quest-valid pies into BanubuQuestline.matchingPie.
let consumedKeys = []; // Used to verify a turn-in consumes exactly the qualifying cooked stack.
let unlockedRecipeId = null; // Used to verify the intro action unlocks the authored Three-Fish Pie template.

const fishDefinitions = [ // Used by feasible-target enumeration; each entry mirrors CookingSystem's live fish ingredient shape.
  { key: 'fish_strength', definition: { label: 'Strength Fish', cookingCategories: ['fish'], cookingPrimaryEffect: 'strength' } },
  { key: 'fish_speed', definition: { label: 'Speed Fish', cookingCategories: ['fish'], cookingPrimaryEffect: 'speed' } },
  { key: 'fish_fortitude', definition: { label: 'Fortitude Fish', cookingCategories: ['fish'], cookingPrimaryEffect: 'fortitude' } },
];

const context = { // Used as the minimal browser-like VM context for the real Banubu runtime modules.
  console,
  JSON,
  Math,
  Date,
  localStorage: storage,
  __hobunjiPlayerProfile: {
    characterId: 'char_test',
    worldId: 'world_test',
    gearInventory: { keyItems: [] },
    questProgress: {},
    cookingState: {},
  },
  HobunjiCookingData: { recipes: [] },
};
context.window = context;
context.CookingSystem = { // Used to exercise quest generation, recipe unlock, persistence, and turn-in against deterministic test data.
  listIngredientDefinitions(category) { return category === 'fish' ? fishDefinitions : []; },
  effectLabel(key) { return key[0].toUpperCase() + key.slice(1); },
  listCookedInventory() { return cookedInventory; },
  consumeCookedInventoryItem(key, amount) {
    const entry = cookedInventory.find(item => item.key === key); // Used to reject a stale quest turn-in like the real cooking inventory adapter.
    if (!entry || entry.count < amount) return { ok: false, message: 'missing' };
    entry.count -= amount;
    consumedKeys.push(key);
    return { ok: true, key, amount };
  },
  unlockRecipe(recipeId) { unlockedRecipeId = recipeId; return { ok: true, recipeId }; },
  serialize() { return { unlockedRecipeIds: unlockedRecipeId ? [unlockedRecipeId] : [] }; },
};

vm.createContext(context);
vm.runInContext(read('docs/js/banubu-quest-content.js'), context, { filename: 'banubu-quest-content.js' });
vm.runInContext(read('docs/js/key-item-system.js'), context, { filename: 'key-item-system.js' });
vm.runInContext(read('docs/js/banubu-questline.js'), context, { filename: 'banubu-questline.js' });

const content = context.BanubuQuestContent; // Used to inspect the authored recipe and five-stage defaults.
const questline = context.BanubuQuestline; // Used to execute the real quest-state and feasibility logic.
assert(content && questline && context.KeyItemSystem, 'Banubu content, questline, and key-item modules must all initialize');

assert.strictEqual(content.recipe.lockedByDefault, true, 'Three-Fish Pie must remain hidden until Banubu teaches it');
assert.strictEqual(content.recipe.slots.length, 3, 'Three-Fish Pie must require exactly three ingredient slots');
assert(content.recipe.slots.every(slot => slot.required && slot.accepts.length === 1 && slot.accepts[0] === 'fish'), 'all three pie slots must require fish');
assert.strictEqual(content.stageDefaults.length, 5, 'Banubu must have exactly five sequential fish-pie quests');
assert.deepStrictEqual(JSON.parse(JSON.stringify(content.stageDefaults[0].reward)), {
  id: 'war_paint_kit',
  label: 'War-Paint Kit',
  scope: 'character',
  featureId: 'war_paint',
}, 'first reward must be the character-scoped War-Paint Kit');

for (const requestedCount of [1, 2, 3]) {
  const targets = questline.allFeasibleTargets(requestedCount); // Used to prove target generation never invents a buff set without a concrete three-fish witness.
  assert(targets.length > 0, `test fish catalog must provide at least one feasible ${requestedCount}-buff target`);
  for (const target of targets) {
    assert.strictEqual(target.solutionFishKeys.length, 3, 'every target must retain an actual three-fish proof recipe');
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(questline.effectSetForFishKeys(target.solutionFishKeys))),
      JSON.parse(JSON.stringify(target.requiredEffects)),
      'saved proof fish must actually produce the requested exact effect set',
    );
  }
}

const banubuRecord = { id: 'banubu', dialogueTrees: content.deepClone(content.dialogueTrees) }; // Used as the same authored NPC-tree shape supplied by LocalDBOverrides at runtime.
let state = questline.ensureQuestState(); // Used to verify the introduction is the first state for a fresh world member.
assert.strictEqual(state.status, 'intro');
assert.strictEqual(questline.selectTree(banubuRecord).banubuQuest.phase, 'intro');

assert.strictEqual(questline.unlockRecipe().ok, true, 'intro action must unlock the pie recipe');
assert.strictEqual(unlockedRecipeId, content.RECIPE_ID);
state = questline.ensureQuestState();
assert.strictEqual(state.status, 'offer');
assert.strictEqual(state.stage, 1);

const stageOneOffer = questline.selectTree(banubuRecord); // Used to force and persist a feasible randomized stage-one request.
assert.strictEqual(stageOneOffer.banubuQuest.phase, 'offer');
assert.strictEqual(state.target.requiredEffects.length, 1, 'stage one defaults to one requested distinct buff');
assert.strictEqual(questline.acceptQuest(banubuRecord, 1).ok, true);
assert.strictEqual(state.status, 'active');

cookedInventory = [{
  key: 'food_banubu_stage_1',
  count: 1,
  definition: {
    recipeId: content.RECIPE_ID,
    foodEffects: Object.fromEntries(state.target.requiredEffects.map(effect => [effect, 1])),
  },
}]; // Used as a real matching Three-Fish Pie stack for stage-one turn-in.
assert(questline.matchingPie(state), 'an exact-effect Three-Fish Pie must be recognized as a valid turn-in');
const stageOneTurnIn = questline.turnInQuest(banubuRecord, 1); // Used to verify consumption, reward scope, and sequential advancement together.
assert.strictEqual(stageOneTurnIn.ok, true);
assert.strictEqual(consumedKeys.length, 1, 'stage-one turn-in must consume exactly one qualifying pie');
assert(context.__hobunjiPlayerProfile.gearInventory.keyItems.includes('war_paint_kit'), 'War-Paint Kit must appear in live character gear ownership');
let persisted = JSON.parse(storage.getItem('hobunjiSaveMeta')); // Used to inspect the actual save-location chosen by KeyItemSystem.
assert(persisted.characters[0].gearInventory.keyItems.includes('war_paint_kit'), 'War-Paint Kit must persist on the character save');
assert(!persisted.worlds[0].keyItems.includes('war_paint_kit'), 'War-Paint Kit must not leak into world-scoped ownership');
assert.strictEqual(state.status, 'offer');
assert.strictEqual(state.stage, 2, 'stage one must advance directly to stage two');

const stageTwoOffer = questline.selectTree(banubuRecord); // Used to roll the second quest's default two-buff request.
assert.strictEqual(stageTwoOffer.banubuQuest.phase, 'offer');
assert.strictEqual(state.target.requiredEffects.length, 2, 'stage two defaults to two requested distinct buffs');
assert.strictEqual(questline.acceptQuest(banubuRecord, 2).ok, true);
cookedInventory = [{
  key: 'food_banubu_stage_2',
  count: 1,
  definition: {
    recipeId: content.RECIPE_ID,
    foodEffects: Object.fromEntries(state.target.requiredEffects.map(effect => [effect, 1])),
  },
}]; // Used as the exact two-buff pie needed to exercise the first world-scoped placeholder reward.
assert.strictEqual(questline.turnInQuest(banubuRecord, 2).ok, true);
persisted = JSON.parse(storage.getItem('hobunjiSaveMeta'));
assert(persisted.worlds[0].keyItems.includes('banubu_key_2'), 'stage-two placeholder key must persist to the world save');
assert(!context.__hobunjiPlayerProfile.gearInventory.keyItems.includes('banubu_key_2'), 'world-scoped keys must not travel with the character');

const indexHtml = read('docs/index.html'); // Used to verify runtime module ordering before game.js initializes systems and database state.
assert(indexHtml.indexOf('banubu-quest-content.js') < indexHtml.indexOf('local-db-overrides.js'), 'Banubu quest content must load before NPC database composition');
assert(indexHtml.indexOf('cooking-system.js') < indexHtml.indexOf('banubu-questline.js'), 'CookingSystem must exist before Banubu questline installs');
assert(indexHtml.indexOf('dialogue-content.js') < indexHtml.indexOf('banubu-questline.js'), 'DialogueContent must exist before Banubu questline installs');
assert(indexHtml.indexOf('key-item-system.js') < indexHtml.indexOf('banubu-questline.js'), 'KeyItemSystem must exist before Banubu questline installs');

const cavernSource = read('docs/js/cavern-generator.js'); // Used to verify the dedicated home cavern remains single-room, non-combat, and station-backed.
assert(cavernSource.includes("mapId === 'map_i_den_banubu'"), 'cavern generator must recognize Banubu home map id');
assert(cavernSource.includes('branchCount: 0'), 'Banubu home must use the zero-branch single-room cavern carve');
assert(cavernSource.includes("'station_banubu_cave_awake'") && cavernSource.includes("'station_banubu_cave_sleep'"), 'Banubu cavern must expose distinct awake and sleeping stations');
assert(cavernSource.includes('oreRocks: [], creatureSpawns: []'), 'Banubu home cavern must not inherit den combat/decor spawns');

const schedule = require('../docs/config/npcs/schedule-overrides.json'); // Used to verify the Sleeping Grehlr never receives an active waking schedule.
const banubuSchedule = (schedule.scheduleReplacements || []).find(entry => entry.npcId === 'banubu'); // Used as the authored permanent-sleep schedule under test.
assert(banubuSchedule, 'Banubu must have a schedule replacement');
assert.strictEqual(banubuSchedule.scheduleHooks.defaultMapId, 'map_i_den_banubu');
assert.strictEqual(banubuSchedule.scheduleHooks.defaultStationId, 'station_banubu_cave_sleep', 'Banubu must default to his sleeping spot');
assert.strictEqual(banubuSchedule.scheduleHooks.rules.length, 1, 'Banubu must have only one always-sleeping schedule rule');
assert.strictEqual(banubuSchedule.scheduleHooks.rules[0].from, '00:00');
assert.strictEqual(banubuSchedule.scheduleHooks.rules[0].to, '24:00', 'exclusive schedule endpoint must cover the final minute of the day');
assert.strictEqual(banubuSchedule.scheduleHooks.rules[0].stationId, 'station_banubu_cave_sleep');
assert(!banubuSchedule.scheduleHooks.rules.some(rule => rule.stationId === 'station_banubu_cave_awake'), 'Banubu awake schedule must remain disabled indefinitely');
assert(cavernSource.includes(`id: 'station_banubu_cave_sleep'`) && cavernSource.includes(`pose: 'lie'`), 'Banubu sleeping station must use the standard lying pose');

const loreDb = { npcs: [{ id: 'banubu', dialogueTrees: [], bio: 'old hungry placeholder', loreBackground: 'Fifteen Fish Pie', questHooks: ['obsolete'] }] }; // Used to verify the runtime/editor overlay replaces obsolete placeholder lore alongside dialogue composition.
content.mergeDialogueTreesIntoDatabase(loreDb);
assert.match(loreDb.npcs[0].bio, /Great Fey/);
assert.match(loreDb.npcs[0].bio, /not a biological need/);
assert.match(loreDb.npcs[0].loreBackground, /mindless wisps/);
assert.match(loreDb.npcs[0].loreBackground, /Three-Fish Pie/);
assert(!/Fifteen Fish Pie|too hungry/i.test(JSON.stringify(loreDb.npcs[0])), 'composed Banubu metadata must not retain obsolete biological-hunger or fifteen-fish placeholder lore');

const editorState = read('docs/tools/dialogue-editor/dialogue-editor-state.js'); // Used to verify dynamic quest tokens/actions are discoverable in the editor.
const editorInspector = read('docs/tools/dialogue-editor/dialogue-editor-inspector.js'); // Used to verify all stage/reward authoring fields are present.
assert(editorState.includes("type:'banubuQuest'"), 'Dialogue Editor must offer Banubu quest actions');
for (const token of ['{{banubuRequestedBuffs}}', '{{banubuRewardName}}', '{{banubuQuestNumber}}']) {
  assert(editorState.includes(token), `Dialogue Editor must expose ${token}`);
}
for (const control of ['editBanubuPhase','editBanubuStage','editBanubuBuffCount','editBanubuRewardId','editBanubuRewardLabel','editBanubuRewardScope','editBanubuFeatureId']) {
  assert(editorInspector.includes(control), `Dialogue Editor must expose ${control}`);
}

const namedAnimalSource = read('docs/js/animal-chathead-frame.js'); // Used to guard Banubu's existing animal portrait/chathead integration.
assert(namedAnimalSource.includes("banubu: 'grehlr'"), 'Banubu must still use the Grehlr animal chathead path');

console.log('Banubu cavern + animal dialogue + feasible fish-pie quest + scoped key-item regression checks passed');
