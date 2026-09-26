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
const registeredNodeEnterHandlers = new Map(); // Used to verify Banubu owns its dialogue-node presentation through the generic dialogue hook.
let sparkleCreates = 0; // Used to prove the “I’m up” beat starts exactly one persistent emitter.
let sparkleDisposes = 0; // Used to prove the key-gift beat removes the persistent emitter immediately.
let sparkleUpdates = 0; // Used to prove the active emitter advances through RuntimeFrameScheduler rather than a private RAF loop.
const schedulerCallbacks = new Map(); // Used to capture Banubu's shared-frame subscriber for direct regression driving.
const schedulerEnabled = new Map(); // Used to verify the transient subscriber sleeps whenever Banubu has no temporary VFX or movement.
let lastSparkleGroup = null; // Used to prove the key sparkle is detached from Banubu before his reveal-step movement begins.
let lastSparkleEmitter = null; // Used to verify complete Dialogue Editor-authored emitter records reach the shared renderer unchanged.
let lastSparkleMaxParticles = null; // Used to verify the editor-authored particle budget reaches the renderer.

class FakeGroup {
  constructor() {
    this.userData = {};
    this.parent = null;
    this.children = [];
    this.position = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } };
  }
  add(child) { if (!child) return; child.parent?.remove?.(child); this.children.push(child); child.parent = this; }
  remove(child) { this.children = this.children.filter(entry => entry !== child); if (child?.parent === this) child.parent = null; }
}

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
  THREE: { Group: FakeGroup },
  DialogueContent: {
    registerTreeProvider(id, fn) { registeredProviders.set(id, fn); },
    registerActionHandler(id, fn) { registeredActions.set(id, fn); },
    registerNodeEnterHandler(id, fn) { registeredNodeEnterHandlers.set(id, fn); },
  },
  RuntimeFrameScheduler: {
    register(id, fn, options = {}) {
      schedulerCallbacks.set(id, { fn, options });
      schedulerEnabled.set(id, options.enabled !== false);
      return () => schedulerCallbacks.delete(id);
    },
    setEnabled(id, enabled) {
      if (!schedulerCallbacks.has(id)) return false;
      schedulerEnabled.set(id, !!enabled);
      return true;
    },
  },
  AuthoredFurniture: {
    createEmitterVisual(group, emitter, maxParticles) {
      sparkleCreates++;
      lastSparkleGroup = group;
      lastSparkleEmitter = emitter;
      lastSparkleMaxParticles = maxParticles;
      return {
        group,
        emitter,
        maxParticles,
        update(dt, active) {
          assert(dt > 0 && dt <= 0.05);
          assert.strictEqual(active, true);
          sparkleUpdates++;
        },
        dispose() { sparkleDisposes++; },
      };
    },
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
assert(registeredProviders.has('banubu') && registeredActions.has('banubuQuest') && registeredNodeEnterHandlers.has('banubu'), 'Banubu dialogue provider/action/presentation handlers must be registered');

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

// Stale Dialogue Editor overrides from before transactional turn-ins must be upgraded in place rather than bypassing the final dialogue boundary.
const staleReadyTree = JSON.parse(JSON.stringify(content.dialogueTrees.find(tree => tree.id === 'banubu_q1_ready')));
const staleReadyNodes = Object.fromEntries(staleReadyTree.nodes.map(node => [node.id, node]));
staleReadyNodes.banubu_q1_ready_1.choices[0].actions[0].operation = 'turnIn';
staleReadyNodes.banubu_q1_ready_18.next = null;
staleReadyTree.nodes = staleReadyTree.nodes.filter(node => node.id !== 'banubu_q1_ready_commit');
const staleDb = { npcs: [{ id: 'banubu', dialogueTrees: [staleReadyTree], phrasePools: [], events: [] }] };
content.mergeDialogueTreesIntoDatabase(staleDb);
const migratedReadyTree = staleDb.npcs[0].dialogueTrees.find(tree => tree.id === 'banubu_q1_ready');
const migratedReadyNodes = Object.fromEntries(migratedReadyTree.nodes.map(node => [node.id, node]));
assert.strictEqual(migratedReadyNodes.banubu_q1_ready_1.choices[0].actions[0].operation, 'prepareTurnIn', 'stale local turnIn actions must be migrated to prepare-only');
assert.strictEqual(migratedReadyNodes.banubu_q1_ready_18.next, 'banubu_q1_ready_commit', 'stale edited final lines must regain the transactional commit edge');
assert.deepStrictEqual(JSON.parse(JSON.stringify(migratedReadyNodes.banubu_q1_ready_commit.banubuPresentation)), { commitTurnIn: 1 }, 'stale ready trees must regain the final commit node');

// Older edited intro/offer trees also regain their final commit boundary while keeping their authored dialogue.
const staleIntro = JSON.parse(JSON.stringify(content.dialogueTrees.find(tree => tree.id === 'banubu_intro')));
staleIntro.nodes.find(node => node.id === 'banubu_intro_11').next = null;
staleIntro.nodes = staleIntro.nodes.filter(node => node.id !== 'banubu_intro_commit');
const staleOffer = JSON.parse(JSON.stringify(content.dialogueTrees.find(tree => tree.id === 'banubu_q1_offer')));
staleOffer.nodes.find(node => node.id === 'banubu_q1_offer_2').next = null;
staleOffer.nodes = staleOffer.nodes.filter(node => node.id !== 'banubu_q1_offer_commit');
const staleProgressDb = { npcs: [{ id: 'banubu', dialogueTrees: [staleIntro, staleOffer], phrasePools: [], events: [] }] };
content.mergeDialogueTreesIntoDatabase(staleProgressDb);
const migratedIntroNodes = Object.fromEntries(staleProgressDb.npcs[0].dialogueTrees.find(tree => tree.id === 'banubu_intro').nodes.map(node => [node.id, node]));
const migratedOfferNodes = Object.fromEntries(staleProgressDb.npcs[0].dialogueTrees.find(tree => tree.id === 'banubu_q1_offer').nodes.map(node => [node.id, node]));
assert.strictEqual(migratedIntroNodes.banubu_intro_11.next, 'banubu_intro_commit');
assert.deepStrictEqual(JSON.parse(JSON.stringify(migratedIntroNodes.banubu_intro_commit.banubuPresentation)), { commitIntroAttempt: 3, commitQuestAction: { operation: 'unlockRecipe', stage: 0 } });
assert.strictEqual(migratedOfferNodes.banubu_q1_offer_2.next, 'banubu_q1_offer_commit');
assert.deepStrictEqual(JSON.parse(JSON.stringify(migratedOfferNodes.banubu_q1_offer_commit.banubuPresentation)), { commitQuestAction: { operation: 'accept', stage: 1 } });

const q1ReadyPresentationTree = content.dialogueTrees.find(tree => tree.id === 'banubu_q1_ready'); // Used to verify the exact authored line-to-presentation timing requested for the Color Pools Key scene.
const q1ReadyPresentationNodes = Object.fromEntries(q1ReadyPresentationTree.nodes.map(node => [node.id, node]));
const introTree = content.dialogueTrees.find(tree => tree.id === 'banubu_intro'); // Verifies the existing awake-camera metadata on Banubu's choice node is no longer discarded by the helper.
const introNodes = Object.fromEntries(introTree.nodes.map(node => [node.id, node])); // Used immediately below to assert the intro choice preserves its generic cameraId metadata.
assert.strictEqual(introNodes.banubu_intro_3.cameraId, 'banubu_dialogue_awake', 'Banubu intro choice must retain its authored awake-camera swap');
assert.deepStrictEqual(JSON.parse(JSON.stringify(introNodes.banubu_intro_commit.banubuPresentation)), { commitIntroAttempt: 3, commitQuestAction: { operation: 'unlockRecipe', stage: 0 } }, 'the long intro must commit its wake-up attempt and recipe transition only after the last line');
const q1OfferPresentationNodes = Object.fromEntries(content.dialogueTrees.find(tree => tree.id === 'banubu_q1_offer').nodes.map(node => [node.id, node]));
const q2OfferPresentationNodes = Object.fromEntries(content.dialogueTrees.find(tree => tree.id === 'banubu_q2_offer').nodes.map(node => [node.id, node]));
assert.deepStrictEqual(JSON.parse(JSON.stringify(q1OfferPresentationNodes.banubu_q1_offer_commit.banubuPresentation)), { commitQuestAction: { operation: 'accept', stage: 1 } });
assert.deepStrictEqual(JSON.parse(JSON.stringify(q2OfferPresentationNodes.banubu_q2_offer_commit.banubuPresentation)), { commitQuestAction: { operation: 'accept', stage: 2 } });
assert.strictEqual(q1ReadyPresentationNodes.banubu_q1_ready_3.next, 'banubu_q1_ready_prestand_visual', 'the spoken setup line must first reveal the awake camera while Banubu is still lying down');
assert.strictEqual(q1ReadyPresentationNodes.banubu_q1_ready_prestand_visual.type, 'visual');
assert.strictEqual(q1ReadyPresentationNodes.banubu_q1_ready_prestand_visual.durationSec, 0.8);
assert.deepStrictEqual(JSON.parse(JSON.stringify(q1ReadyPresentationNodes.banubu_q1_ready_prestand_visual.banubuPresentation)), {}, 'pre-stand visual must change only the camera, not Banubu’s body pose');
assert.strictEqual(q1ReadyPresentationNodes.banubu_q1_ready_prestand_visual.cameraId, 'banubu_dialogue_awake');
assert.strictEqual(q1ReadyPresentationNodes.banubu_q1_ready_prestand_visual.next, 'banubu_q1_ready_stand_visual');
assert.strictEqual(q1ReadyPresentationNodes.banubu_q1_ready_stand_visual.type, 'visual');
assert.strictEqual(q1ReadyPresentationNodes.banubu_q1_ready_stand_visual.durationSec, 1.6);
assert.deepStrictEqual(JSON.parse(JSON.stringify(q1ReadyPresentationNodes.banubu_q1_ready_stand_visual.banubuPresentation)), { body: 'awake' }, 'standing up is its own silent presentation beat');
assert.strictEqual(q1ReadyPresentationNodes.banubu_q1_ready_stand_visual.cameraId, 'banubu_dialogue_awake');
assert.strictEqual(q1ReadyPresentationNodes.banubu_q1_ready_move_visual.type, 'visual');
assert.strictEqual(q1ReadyPresentationNodes.banubu_q1_ready_move_visual.durationSec, 1.8);
assert.deepStrictEqual(JSON.parse(JSON.stringify(q1ReadyPresentationNodes.banubu_q1_ready_move_visual.banubuPresentation)), { sparkles: 'start', move: { x: 0, z: -0.85, duration: 1.6 } }, 'easing aside must be its own slower silent beat while the key sparkle stays fixed');
assert.strictEqual(q1ReadyPresentationNodes.banubu_q1_ready_move_visual.cameraId, 'banubu_dialogue_awake');
assert.deepStrictEqual(JSON.parse(JSON.stringify(q1ReadyPresentationNodes.banubu_q1_ready_4.banubuPresentation)), {}, '“I’m up” resumes normal dialogue only after both visual beats finish');
assert.strictEqual(q1ReadyPresentationNodes.banubu_q1_ready_4.cameraId, 'banubu_dialogue_awake', 'post-move dialogue remains on the cavern-centered awake shot before the key close-up');
assert.deepStrictEqual(JSON.parse(JSON.stringify(q1ReadyPresentationNodes.banubu_q1_ready_5.banubuPresentation)), { neck: 'max_down' }, 'noticing the Color Pools Key must use the canonical maximum downward neck pose');
assert.strictEqual(q1ReadyPresentationNodes.banubu_q1_ready_5.cameraId, 'banubu_key_ground', 'the first explicit key-reference line must cut to the ground-level sparkle shot');
assert.deepStrictEqual(JSON.parse(JSON.stringify(q1ReadyPresentationNodes.banubu_q1_ready_6.banubuPresentation)), { neck: 'release' }, 'the key-noticing neck pose must release on the following line instead of sticking');
assert.strictEqual(q1ReadyPresentationNodes.banubu_q1_ready_6.cameraId, 'banubu_key_ground', 'the explanation of what the key opens must remain on the sparkle shot');
assert.deepStrictEqual(JSON.parse(JSON.stringify(q1ReadyPresentationNodes.banubu_q1_ready_7.banubuPresentation)), {}, 'the key handoff line keeps no Banubu-specific pose/VFX mutation');
assert.strictEqual(q1ReadyPresentationNodes.banubu_q1_ready_7.cameraId, 'banubu_key_ground', 'the key handoff line must remain on the sparkle shot');
assert.deepStrictEqual(JSON.parse(JSON.stringify(q1ReadyPresentationNodes.banubu_q1_ready_8.banubuPresentation)), { sparkles: 'stop', move: { x: 0, z: 0, duration: 0.7 } }, 'post-key dialogue must stop sparkles and ease Banubu back to his authored station');
assert.strictEqual(q1ReadyPresentationNodes.banubu_q1_ready_8.cameraId, 'banubu_dialogue_awake', 'post-key dialogue must return to Banubu’s ordinary awake shot');
assert.strictEqual(q1ReadyPresentationNodes.banubu_q1_ready_18.next, 'banubu_q1_ready_commit', 'Quest 1 final spoken line must advance to a commit-only end node');
assert.strictEqual(q1ReadyPresentationNodes.banubu_q1_ready_commit.type, 'end');
assert.deepStrictEqual(JSON.parse(JSON.stringify(q1ReadyPresentationNodes.banubu_q1_ready_commit.banubuPresentation)), { commitTurnIn: 1 }, 'Quest 1 turn-in must commit only after the last spoken line is finished');
assert.deepStrictEqual(JSON.parse(JSON.stringify(q1ReadyPresentationNodes.banubu_q1_ready_15.banubuPresentation)), { body: 'sleep', neck: 'release' }, 'the line after the yawn must restore Banubu’s sleeping body pose');
const q2ReadyPresentationTree = content.dialogueTrees.find(tree => tree.id === 'banubu_q2_ready');
const q2ReadyPresentationNodes = Object.fromEntries(q2ReadyPresentationTree.nodes.map(node => [node.id, node]));
assert.strictEqual(q2ReadyPresentationNodes.banubu_q2_ready_3.next, 'banubu_q2_ready_commit', 'Quest 2 final spoken line must also defer progression to its end node');
assert.deepStrictEqual(JSON.parse(JSON.stringify(q2ReadyPresentationNodes.banubu_q2_ready_commit.banubuPresentation)), { commitTurnIn: 2 });

const presentationHandler = registeredNodeEnterHandlers.get('banubu'); // Used to exercise the presentation state machine without a WebGL scene.
const presentationScene = new FakeGroup(); // Parent scene lets the runtime detach the key sparkle from Banubu while preserving its reveal location.
const presentationRoot = new FakeGroup();
presentationRoot.position.set(6.5, 0, 5.5);
presentationScene.add(presentationRoot);
const presentationWalker = { root: presentationRoot }; // Minimal named-animal walker seam used by BanubuQuestline presentation.
presentationHandler(q1ReadyPresentationNodes.banubu_q1_ready_prestand_visual, { npc: banubu, walker: presentationWalker });
assert.strictEqual(presentationWalker._animalSleepPresentationOverride, undefined, 'pre-stand camera beat must show Banubu still lying down before the body cue fires');
presentationHandler(q1ReadyPresentationNodes.banubu_q1_ready_stand_visual, { npc: banubu, walker: presentationWalker });
assert.strictEqual(presentationWalker._animalSleepPresentationOverride, 'awake');
assert.strictEqual(sparkleCreates, 0, 'standing beat must not reveal the key before Banubu starts moving aside');
presentationHandler(q1ReadyPresentationNodes.banubu_q1_ready_move_visual, { npc: banubu, walker: presentationWalker });
assert.strictEqual(sparkleCreates, 1);
assert.strictEqual(questline.debugSnapshot().presentation.sparklesActive, true);
assert.strictEqual(schedulerEnabled.get('banubu-dialogue-presentation'), true, 'starting sparkles or movement must enable Banubu’s shared-frame subscriber');
assert.notStrictEqual(lastSparkleGroup, presentationRoot, 'the key sparkle must be detached from Banubu before he moves');
assert.strictEqual(lastSparkleGroup.position.z, 5.5, 'the detached key sparkle starts at Banubu’s original reveal spot');
schedulerCallbacks.get('banubu-dialogue-presentation').fn({ deltaMs: 16.67 });
assert.strictEqual(sparkleUpdates, 1, 'the scheduler must advance the live sparkle emitter');
assert(presentationRoot.position.z < 5.5, 'Banubu must ease north/backward while the key sparkle remains at the reveal spot');
assert.strictEqual(lastSparkleGroup.position.z, 5.5, 'Banubu movement must not drag the key sparkle with him');
presentationHandler(q1ReadyPresentationNodes.banubu_q1_ready_5, { npc: banubu, walker: presentationWalker });
assert.strictEqual(presentationWalker._animalHeadPoseOverride, 'max_down');
presentationHandler(q1ReadyPresentationNodes.banubu_q1_ready_6, { npc: banubu, walker: presentationWalker });
assert.strictEqual(presentationWalker._animalHeadPoseOverride, undefined);
presentationHandler(q1ReadyPresentationNodes.banubu_q1_ready_7, { npc: banubu, walker: presentationWalker });
assert.strictEqual(sparkleDisposes, 0, 'sparkles stay visible while Banubu offers the key so the ground shot still has a subject');
assert.strictEqual(questline.debugSnapshot().presentation.sparklesActive, true);
presentationHandler(q1ReadyPresentationNodes.banubu_q1_ready_8, { npc: banubu, walker: presentationWalker });
assert.strictEqual(sparkleDisposes, 1);
assert.strictEqual(questline.debugSnapshot().presentation.sparklesActive, false);
for (let i = 0; i < 60; i++) schedulerCallbacks.get('banubu-dialogue-presentation').fn({ deltaMs: 16.67 });
assert(Math.abs(presentationRoot.position.z - 5.5) < 1e-6, 'Banubu must finish easing back to his original station before sleeping');
assert.strictEqual(schedulerEnabled.get('banubu-dialogue-presentation'), false, 'the shared-frame subscriber must sleep once both sparkles and return movement finish');
presentationHandler(q1ReadyPresentationNodes.banubu_q1_ready_15, { npc: banubu, walker: presentationWalker });
assert.strictEqual(presentationWalker._animalSleepPresentationOverride, 'sleep');
presentationHandler(null, { npc: banubu, walker: presentationWalker, ended: true });
assert.strictEqual(presentationWalker._animalSleepPresentationOverride, undefined, 'dialogue cleanup must release the temporary body override back to Banubu’s authored schedule');
assert.strictEqual(presentationWalker._animalHeadPoseOverride, undefined, 'dialogue cleanup must release any temporary neck override');
assert.strictEqual(presentationRoot.position.z, 5.5, 'dialogue cleanup must restore Banubu’s exact pre-conversation position');

presentationHandler({ id: 'authored_vfx_probe', banubuPresentation: { sparkles: { action: 'start', anchor: 'root', maxParticles: 77, emitter: { radius: 1.25, size: 0.11, colorA: '#112233', colorB: '#445566' } } } }, { npc: banubu, walker: presentationWalker });
assert.strictEqual(lastSparkleGroup, presentationRoot, 'Dialogue Editor-authored root attachment must remain available even though the key reveal defaults to a fixed world anchor');
assert.strictEqual(lastSparkleMaxParticles, 77, 'Dialogue Editor-authored particle budget must reach the shared renderer');
assert.strictEqual(lastSparkleEmitter.radius, 1.25);
assert.strictEqual(lastSparkleEmitter.size, 0.11);
assert.strictEqual(lastSparkleEmitter.colorA, '#112233');
presentationHandler({ id: 'authored_vfx_stop', banubuPresentation: { sparkles: 'stop' } }, { npc: banubu, walker: presentationWalker });

// Every Banubu quest conversation is transactional: opening, choosing, or partially advancing it cannot mutate quest state.
let state = questline.ensureQuestState();
assert.strictEqual(state.status, 'intro');
assert.strictEqual(state.introTalkAttempts, 0);

const introSleep1 = questline.selectTree(banubu);
const introSleep1Nodes = Object.fromEntries(introSleep1.nodes.map(node => [node.id, node]));
assert.strictEqual(introSleep1.id, 'banubu_intro_sleep_1');
assert.strictEqual(introSleep1Nodes.banubu_intro_sleep_1_line.text, 'Zzzzz.');
assert.strictEqual(introSleep1Nodes.banubu_intro_sleep_1_line.next, 'banubu_intro_sleep_1_commit');
assert.strictEqual(state.introTalkAttempts, 0, 'opening the first wake-up dialogue must not count as completing it');
assert.strictEqual(banubu._animalDialogueEyesOpen, false);
presentationHandler(introSleep1Nodes.banubu_intro_sleep_1_commit, { npc: banubu, walker: presentationWalker });
presentationHandler(null, { npc: banubu, walker: presentationWalker, ended: true });
assert.strictEqual(state.introTalkAttempts, 1, 'the first wake-up attempt commits only after its final Continue');

const introSleep2Cancel = questline.selectTree(banubu);
const introSleep2CancelNodes = Object.fromEntries(introSleep2Cancel.nodes.map(node => [node.id, node]));
assert.strictEqual(introSleep2Cancel.id, 'banubu_intro_sleep_2');
assert.strictEqual(introSleep2CancelNodes.banubu_intro_sleep_2_line.text, 'Let me rest my eyes for just a few more minutes.');
assert.strictEqual(state.introTalkAttempts, 1, 'opening the second wake-up dialogue must not count it early');
presentationHandler(null, { npc: banubu, walker: presentationWalker, ended: true });
assert.strictEqual(state.introTalkAttempts, 1, 'cancelling the second wake-up dialogue must replay it next time');

const introSleep2 = questline.selectTree(banubu);
const introSleep2Nodes = Object.fromEntries(introSleep2.nodes.map(node => [node.id, node]));
presentationHandler(introSleep2Nodes.banubu_intro_sleep_2_commit, { npc: banubu, walker: presentationWalker });
presentationHandler(null, { npc: banubu, walker: presentationWalker, ended: true });
assert.strictEqual(state.introTalkAttempts, 2);
assert.strictEqual(banubu._animalDialogueEyesOpen, false);

const introCancel = questline.selectTree(banubu);
const introCancelNodes = Object.fromEntries(introCancel.nodes.map(node => [node.id, node]));
assert.strictEqual(introCancel.id, 'banubu_intro');
assert.strictEqual(introCancel.banubuQuest.phase, 'intro');
assert.strictEqual(introCancel.entryNode, 'banubu_intro_3');
assert.strictEqual(state.introTalkAttempts, 2, 'third wake-up attempt remains uncommitted while its dialogue is open');
assert.strictEqual(banubu._animalDialogueEyesOpen, true);
assert.strictEqual(questline.dialogueEyesOpen(), true, 'third-attempt presentation may open Banubu’s eyes without saving the attempt');
const introStartAction = introCancelNodes.banubu_intro_3.choices[0].actions[0];
assert.strictEqual(introStartAction.operation, 'unlockRecipe');
assert.strictEqual(registeredActions.get('banubuQuest')(introStartAction, { npc: banubu, tree: introCancel, node: introCancelNodes.banubu_intro_3 }).ok, true);
assert.strictEqual(state.status, 'intro', 'Ask for help must only prepare the recipe/quest transition');
assert.strictEqual(state.target, null, 'intro target preview must remain out of the save until dialogue finishes');
assert.strictEqual(unlockedRecipeIds.has(content.THREE_FISH_PIE_RECIPE_ID), false, 'Three-Fish Pie must not unlock before the final dialogue line');
presentationHandler(null, { npc: banubu, walker: presentationWalker, ended: true });
assert.strictEqual(state.introTalkAttempts, 2, 'cancelling the long intro must make it behave as if the conversation never started');
assert.strictEqual(state.status, 'intro');
assert.strictEqual(state.target, null);
assert.strictEqual(unlockedRecipeIds.has(content.THREE_FISH_PIE_RECIPE_ID), false);

const intro = questline.selectTree(banubu);
const introNodesCommitted = Object.fromEntries(intro.nodes.map(node => [node.id, node]));
const introRetryAction = introNodesCommitted.banubu_intro_3.choices[0].actions[0];
assert.strictEqual(registeredActions.get('banubuQuest')(introRetryAction, { npc: banubu, tree: intro, node: introNodesCommitted.banubu_intro_3 }).ok, true);
presentationHandler(introNodesCommitted.banubu_intro_commit, { npc: banubu, walker: presentationWalker });
presentationHandler(null, { npc: banubu, walker: presentationWalker, ended: true });
assert.strictEqual(state.introTalkAttempts, 3);
assert(unlockedRecipeIds.has(content.THREE_FISH_PIE_RECIPE_ID));
assert.strictEqual(state.status, 'offer');
assert.strictEqual(state.stage, 1);
assert.strictEqual(state.target.questType, 'threeFishPie');
assert.strictEqual(state.target.requiredEffects.length, 3);
assert.strictEqual(state.target.solutionFishKeys.length, 3);
assert.strictEqual(context.CookingSystem.effectStrengthLabel(3), 'Concentrated');

const q1OfferCancel = questline.selectTree(banubu);
const q1OfferCancelNodes = Object.fromEntries(q1OfferCancel.nodes.map(node => [node.id, node]));
const q1AcceptAction = q1OfferCancelNodes.banubu_q1_offer_1.choices[0].actions[0];
assert.strictEqual(q1AcceptAction.operation, 'accept');
assert.strictEqual(registeredActions.get('banubuQuest')(q1AcceptAction, { npc: banubu, tree: q1OfferCancel, node: q1OfferCancelNodes.banubu_q1_offer_1 }).ok, true);
assert.strictEqual(state.status, 'offer', 'accepting Quest 1 must remain provisional while its dialogue is open');
presentationHandler(null, { npc: banubu, walker: presentationWalker, ended: true });
assert.strictEqual(state.status, 'offer', 'cancelling Quest 1 acceptance must leave it unaccepted');

const q1Offer = questline.selectTree(banubu);
const q1OfferNodes = Object.fromEntries(q1Offer.nodes.map(node => [node.id, node]));
assert.strictEqual(registeredActions.get('banubuQuest')(q1OfferNodes.banubu_q1_offer_1.choices[0].actions[0], { npc: banubu, tree: q1Offer, node: q1OfferNodes.banubu_q1_offer_1 }).ok, true);
presentationHandler(q1OfferNodes.banubu_q1_offer_commit, { npc: banubu, walker: presentationWalker });
presentationHandler(null, { npc: banubu, walker: presentationWalker, ended: true });
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

const readyForCancel = questline.selectTree(banubu);
const readyForCancelNodes = Object.fromEntries(readyForCancel.nodes.map(node => [node.id, node]));
const q1PrepareAction = readyForCancelNodes.banubu_q1_ready_1.choices[0].actions[0];
assert.strictEqual(q1PrepareAction.operation, 'prepareTurnIn');
assert.strictEqual(registeredActions.get('banubuQuest')(q1PrepareAction, { npc: banubu, tree: readyForCancel, node: readyForCancelNodes.banubu_q1_ready_1 }).ok, true);
assert.strictEqual(state.status, 'active', 'selecting Give the pie must not advance the quest before dialogue finishes');
assert.strictEqual(cookedInventory[0].count, 1, 'prepared Quest 1 turn-in must not consume the pie');
assert.strictEqual(context.KeyItemSystem.has('color_pools_key'), false, 'prepared Quest 1 turn-in must not grant the key early');
presentationHandler(null, { npc: banubu, walker: presentationWalker, ended: true });
assert.strictEqual(state.status, 'active', 'cancelling Quest 1 dialogue must leave the quest exactly active');
assert.strictEqual(cookedInventory[0].count, 1, 'cancelling Quest 1 dialogue must leave the pie untouched');
assert.strictEqual(questline.debugSnapshot().presentation.pendingTurnInStage, null, 'cancelling must discard the transient turn-in transaction');

// Even if a stale tree somehow reaches runtime without composition migration, legacy turnIn actions are fail-safe prepare-only.
const legacyImmediateAction = { type: 'banubuQuest', operation: 'turnIn', stage: 1 };
assert.strictEqual(registeredActions.get('banubuQuest')(legacyImmediateAction, { npc: banubu, tree: readyForCancel, node: readyForCancelNodes.banubu_q1_ready_1 }).ok, true);
assert.strictEqual(state.status, 'active', 'legacy turnIn actions must not advance the quest immediately');
assert.strictEqual(cookedInventory[0].count, 1, 'legacy turnIn actions must not consume the pie before the final commit node');
presentationHandler(null, { npc: banubu, walker: presentationWalker, ended: true });

const readyForCommit = questline.selectTree(banubu);
const readyForCommitNodes = Object.fromEntries(readyForCommit.nodes.map(node => [node.id, node]));
const q1RetryAction = readyForCommitNodes.banubu_q1_ready_1.choices[0].actions[0];
assert.strictEqual(registeredActions.get('banubuQuest')(q1RetryAction, { npc: banubu, tree: readyForCommit, node: readyForCommitNodes.banubu_q1_ready_1 }).ok, true);
presentationHandler(readyForCommitNodes.banubu_q1_ready_commit, { npc: banubu, walker: presentationWalker });
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

// Quest 2 acceptance is transactional too; backing out of Banubu's response leaves the offer untouched.
const q2OfferCancel = questline.selectTree(banubu);
const q2OfferCancelNodes = Object.fromEntries(q2OfferCancel.nodes.map(node => [node.id, node]));
const q2AcceptAction = q2OfferCancelNodes.banubu_q2_offer_1.choices[0].actions[0];
assert.strictEqual(registeredActions.get('banubuQuest')(q2AcceptAction, { npc: banubu, tree: q2OfferCancel, node: q2OfferCancelNodes.banubu_q2_offer_1 }).ok, true);
assert.strictEqual(state.status, 'offer');
presentationHandler(null, { npc: banubu, walker: presentationWalker, ended: true });
assert.strictEqual(state.status, 'offer', 'cancelling Quest 2 acceptance must leave the offer untouched');

const q2Offer = questline.selectTree(banubu);
const q2OfferNodes = Object.fromEntries(q2Offer.nodes.map(node => [node.id, node]));
assert.strictEqual(registeredActions.get('banubuQuest')(q2OfferNodes.banubu_q2_offer_1.choices[0].actions[0], { npc: banubu, tree: q2Offer, node: q2OfferNodes.banubu_q2_offer_1 }).ok, true);
presentationHandler(q2OfferNodes.banubu_q2_offer_commit, { npc: banubu, walker: presentationWalker });
presentationHandler(null, { npc: banubu, walker: presentationWalker, ended: true });
assert.strictEqual(state.status, 'active');
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
const q2ReadyForCancel = questline.selectTree(banubu);
const q2ReadyForCancelNodes = Object.fromEntries(q2ReadyForCancel.nodes.map(node => [node.id, node]));
const q2PrepareAction = q2ReadyForCancelNodes.banubu_q2_ready_1.choices[0].actions[0];
assert.strictEqual(q2PrepareAction.operation, 'prepareTurnIn');
assert.strictEqual(registeredActions.get('banubuQuest')(q2PrepareAction, { npc: banubu, tree: q2ReadyForCancel, node: q2ReadyForCancelNodes.banubu_q2_ready_1 }).ok, true);
assert.strictEqual(state.status, 'active', 'Quest 2 must remain active until its final dialogue node completes');
presentationHandler(null, { npc: banubu, walker: presentationWalker, ended: true });
assert.strictEqual(state.status, 'active', 'cancelling Quest 2 dialogue must reset its prepared turn-in');

const q2ReadyForCommit = questline.selectTree(banubu);
const q2ReadyForCommitNodes = Object.fromEntries(q2ReadyForCommit.nodes.map(node => [node.id, node]));
const q2RetryAction = q2ReadyForCommitNodes.banubu_q2_ready_1.choices[0].actions[0];
assert.strictEqual(registeredActions.get('banubuQuest')(q2RetryAction, { npc: banubu, tree: q2ReadyForCommit, node: q2ReadyForCommitNodes.banubu_q2_ready_1 }).ok, true);
presentationHandler(q2ReadyForCommitNodes.banubu_q2_ready_commit, { npc: banubu, walker: presentationWalker });
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
assert.match(cookingSource, /recipe\.slots\.forEach\(slot => \{[\s\S]{0,260}selectedSlots\[slot\.id\][\s\S]{0,520}ingredientEffectTotals\(definition, selected\?\.stars\)/, 'CookingSystem effect totals must evaluate every contributing recipe slot, including Three-Fish Pie flour and fat');
assert.match(cookingSource, /function ingredientEffectTotals\([\s\S]{0,900}cookingPrimaryEffect/, 'the shared ingredient-effect helper must still resolve ordinary primary cooking buffs');
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
assert.match(sleepPresentation, /function externalSleepingState\(entity, config\)/, 'external named animals must expose a temporary presentation override over schedule sleep');
assert.match(sleepPresentation, /_animalHeadPoseOverride[\s\S]*?max_down[\s\S]*?forceHeadDown\(avatarRef, entity\)/, 'awake external animals must be able to reuse the canonical maximum downward neck pose');
assert.match(sleepPresentation, /frameCacheKey\(kind, frame, genotype, eyesClosed = true\)/, 'sleep frame cache must distinguish open-eye and closed-eye versions of the same species sleep frame');
assert.match(sleepPresentation, /if \(sleeping && run2\) return \{ frame: 'run2'/, 'sleep presentation must prefer each species run2 frame when available');
assert.match(sleepPresentation, /renderer\.composeFrame\(kind, descriptor\.frame, genotype \|\| null, eyesClosed\)/, 'sleep presentation must use the species blink-shut composite while asleep');
const creatureRendererSource = read('docs/js/creature-genetics-render.js');
assert.match(creatureRendererSource, /grehlr:[\s\S]{0,320}run2: 'assets\/creaturesprites\/grehlr_run2\.png'/, 'Grehlr must retain its species-specific run2 sleep body source');
assert.match(creatureRendererSource, /grehlr:[\s\S]{0,420}blink: 'assets\/creaturesprites\/grehlr_blink\.png'/, 'Grehlr must retain its species-specific blink\/closed-eye overlay');
assert.match(gameSource, /_animalSleepRequested = !!this\.animalDef && \/sleep\/i\.test/, 'named animal NPC sleeping must come from the authored schedule activity');
assert.match(gameSource, /AnimalSleepPresentation\.registerExternalSleeper\(this/, 'named animal walkers must register with the shared sleep animation system');
assert.match(gameSource, /eyesClosed: \(\) => !\(dialogueOpen && _dialogueWalker === this && this\.rec\?\._animalDialogueEyesOpen === true\)/, 'sleeping named animals may open their eyes only while their own eligible dialogue is open');
assert.match(read('docs/js/livestock-nursery-install-bridge.js'), /animal-sleep-presentation\.js\?v=20260924banubupose2/, 'runtime loader must deliver the current named-animal sleep presenter');
assert.match(gameSource, /expressionEyesClosed: \(\) => dialogueOpen && _dialogueWalker === this/, 'awake named animals use their current dialogue eye expression');
assert.match(sleepPresentation, /sleeping \|\| expressionEyesClosed/, 'awake closed-eye expressions use the existing animal blink composite');
const banubuContent = read('docs/js/banubu-quest-content.js'); // Verifies every authored Banubu sleep line receives its editor-visible eye expression.
assert.match(banubuContent, /expression: \/zzz\/i\.test\(text\) \? 'eyes_closed' : 'neutral'/);
const dialogueContentSource = read('docs/js/dialogue-content.js'); // Verifies the presentation hook is generic and cleaned up by ordinary dialogue teardown.
assert.match(dialogueContentSource, /function registerNodeEnterHandler\(npcId, handler\)/);
assert.match(dialogueContentSource, /_notifyDialogueNodeEnter\(node\)/);
assert.match(dialogueContentSource, /_notifyDialogueNodeEnter\(null, true\)/);
assert.match(dialogueContentSource, /node\.type === 'visual'/, 'dialogue runtime must support authored no-UI visual beats');
assert.match(dialogueContentSource, /_setDialogueShellVisible\(false\)/, 'visual beats must hide the dialogue shell without closing the conversation');
assert.match(dialogueContentSource, /_dlgNode\?\.type === 'visual'\) return/, 'hidden Continue input must not skip a timed visual beat');
assert.match(dialogueContentSource, /_clearDialogueVisualTimer\(\)/, 'closing dialogue must cancel any pending visual auto-advance timer');
const banubuQuestlineSource = read('docs/js/banubu-questline.js'); // Verifies the sparkle effect obeys the repository's single-frame-owner architecture.
assert.doesNotMatch(banubuQuestlineSource, /function ensureNextTarget\(/, 'no helper may persist Quest 2 preview state before the final dialogue commit');
assert.doesNotMatch(banubuQuestlineSource, /function ensureIntroTarget\(|function ensureTarget\(/, 'opening Banubu dialogue must not persist a newly rolled quest target');
assert.match(banubuQuestlineSource, /operation === 'unlockRecipe'\) result = prepareQuestAction/, 'recipe unlock actions must remain provisional until the final dialogue end node');
assert.match(banubuQuestlineSource, /operation === 'accept'\) result = prepareQuestAction/, 'quest accept actions must remain provisional until the final dialogue end node');
assert.match(banubuQuestlineSource, /operation === 'turnIn'\) result = prepareTurnIn/, 'legacy turnIn actions must be fail-safe prepare-only');
assert.doesNotMatch(banubuQuestlineSource, /requestAnimationFrame\(/);
assert.match(banubuQuestlineSource, /scheduler\.register\(PRESENTATION_SCHEDULER_ID, updatePresentationFrame/);
assert.match(banubuQuestlineSource, /RuntimeFrameScheduler\.setEnabled|RuntimeFrameScheduler\?\.setEnabled/);

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
