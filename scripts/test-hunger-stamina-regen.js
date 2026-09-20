'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const cookingSource = fs.readFileSync('docs/js/cooking-system.js', 'utf8');
const directUseSource = fs.readFileSync('docs/js/inventory-held-override.js', 'utf8');
const heldUseSource = fs.readFileSync('docs/js/alcohol-gameplay-bridge.js', 'utf8');
const playerVitalsSource = fs.readFileSync('docs/js/player-vitals.js', 'utf8');
const resourceSource = fs.readFileSync('docs/js/combat/resource-system.js', 'utf8');

const buffProviders = new Map(); // Used to capture CookingSystem's provider without requiring the browser HUD.
const fakeLayer = {}; // Used to make cooking-system init skip DOM construction in this headless regression.
const windowStub = {
  HobunjiCookingData: {
    items: {},
    recipes: [],
    categoryLabels: {},
    processingTiers: { raw: { multiplier: 1 } },
    itemNameTokenOverrides: {},
    identityNameRules: {},
    effectPrefixVariants: {},
    effectLabels: { vigor: 'Vigor' },
  },
  EffectBuffBar: {
    registerProvider(id, provider) { buffProviders.set(id, provider); },
    refresh() {},
  },
  SkillSystem: { render() {} },
};
const context = vm.createContext({
  window: windowStub,
  document: {
    getElementById(id) { return id === 'hobunjiCookingLayer' ? fakeLayer : null; },
  },
  performance: { now: () => 1000 },
  console,
  Math,
  JSON,
  Object,
  Array,
  Number,
  String,
  Set,
  Map,
});
vm.runInContext(cookingSource, context, { filename: 'cooking-system.js' });

const calendar = { day: 1, time01: 0 }; // Used to exercise Hunger against the same day/time01 calendar shape as the game.
const inventory = {}; // Used by CookingSystem's normal persistence/quality setup during init.
windowStub.CookingSystem.init({
  calendar,
  inventory,
  ITEM_DEFS: {},
  inventoryItems: [],
  clampInventoryStack() {},
});
windowStub.CookingSystem.restore({});

const closeTo = (actual, expected, message) => {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: expected ${expected}, got ${actual}`);
};

assert.equal(windowStub.CookingSystem.getHungerStacks(), 0, 'fresh/legacy saves begin fed');
closeTo(windowStub.CookingSystem.getHungerStaminaRegenMultiplier(), 2, 'fed Hunger multiplier doubles base recovery');
closeTo(windowStub.CookingSystem.getStaminaRegenMultiplier(), 2, 'fed total cooking recovery multiplier is doubled without Vigor');

calendar.time01 = 0.5;
assert.equal(windowStub.CookingSystem.getHungerStacks(), 1, 'eight in-world hours without food adds Hunger stack 1');
closeTo(windowStub.CookingSystem.getHungerStaminaRegenMultiplier(), 5 / 3, 'Hunger stack 1 uses the first linear recovery step');

calendar.day = 2;
calendar.time01 = 0;
assert.equal(windowStub.CookingSystem.getHungerStacks(), 2, 'sixteen in-world hours without food adds Hunger stack 2');
closeTo(windowStub.CookingSystem.getHungerStaminaRegenMultiplier(), 4 / 3, 'Hunger stack 2 uses the second linear recovery step');

calendar.time01 = 0.5;
assert.equal(windowStub.CookingSystem.getHungerStacks(), 3, 'twenty-four in-world hours without food caps Hunger at stack 3');
closeTo(windowStub.CookingSystem.getHungerStaminaRegenMultiplier(), 1, 'Hunger stack 3 returns recovery exactly to the pre-Hunger baseline');

const hungerEntries = buffProviders.get('food')();
const hungerEntry = hungerEntries.find(entry => entry.key === 'hunger');
assert.equal(hungerEntry?.kind, 'bane', 'Hunger appears as a debuff in the shared effect bar');
assert.equal(hungerEntry?.stacks, 3, 'Hunger debuff exposes its current stack count');

windowStub.CookingSystem.recordFoodEaten();
assert.equal(windowStub.CookingSystem.getHungerStacks(), 0, 'eating resets all Hunger stacks');
closeTo(windowStub.CookingSystem.getHungerStaminaRegenMultiplier(), 2, 'eating immediately restores the well-fed recovery multiplier');

calendar.day = 3;
calendar.time01 = 0.5;
assert.equal(windowStub.CookingSystem.getHungerStacks(), 2, 'Hunger progression remains calendar-derived after eating');
const saved = windowStub.CookingSystem.serialize();
assert.equal(saved.hungerLastFoodMinute, 1440, 'Hunger persists the exact in-world minute of the last food serving');

windowStub.CookingSystem.restore({
  ...saved,
  activeFoodEffects: [{ key: 'vigor', stacks: 25, durationS: 300, remainingS: 100 }],
});
assert.equal(windowStub.CookingSystem.getHungerStacks(), 2, 'restored Hunger keeps its persisted calendar age');
closeTo(windowStub.CookingSystem.getStaminaRegenMultiplier(), 8 / 3, 'Vigor still composes multiplicatively with Hunger recovery');

assert.match(
  cookingSource,
  /function eat\(key\)[\s\S]{0,1800}recordFoodEaten\(\)/,
  'cooked meals reset Hunger through the central path'
);
assert.match(
  directUseSource,
  /function consumeOrdinaryFood\(key, def\)[\s\S]{0,1800}CookingSystem\?\.recordFoodEaten\?\.\(\)/,
  'direct Inventory food resets Hunger through the central path'
);
assert.match(
  heldUseSource,
  /function commitHeldConsumable\(expectedKey\)[\s\S]{0,3600}CookingSystem\?\.recordFoodEaten\?\.\(\)/,
  'held ordinary food resets Hunger through the central path'
);
assert.match(
  playerVitalsSource,
  /staminaRegenPerSec:\s*deps\.PLAYER_STAMINA_REGEN\s*\*\s*window\.CookingSystem\.getStaminaRegenMultiplier\(\)/,
  'Hunger multiplier feeds ordinary player Stamina regeneration at PlayerVitals'
);
assert.match(
  resourceSource,
  /entity\.exhaustion\.blackStamina\s*=\s*round1\(clamp\(entity\.exhaustion\.blackStamina\s*\+\s*cfg\.exhaustionRegenPerSec\s*\*\s*mul\s*\*\s*dt/,
  'Black Stamina recovery remains on its independent exhaustionRegenPerSec path'
);

console.log('Hunger/Stamina recovery regression passed.');
