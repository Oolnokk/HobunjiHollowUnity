#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

const root = path.resolve(__dirname, '..'); // Used to load the actual game and alchemy sources.
const game = fs.readFileSync(path.join(root, 'docs/game.js'), 'utf8'); // Main furniture catalog and world interactions.
const alchemySource = fs.readFileSync(path.join(root, 'docs/js/alchemy-system.js'), 'utf8'); // Real brewing authority.

new vm.Script(game, { filename: 'docs/game.js' }); // Catch syntax regressions in the large gameplay file.
new vm.Script(alchemySource, { filename: 'docs/js/alchemy-system.js' });

// This is the same existing furniture item used by Kunji's shop, now craftable.
const cauldronDef = game.match(/^\s*alchemyTable:\s*\{[^\n]+/m)?.[0] || ''; // Used to validate the buyable catalog entry.
assert.match(cauldronDef, /itemKey: 'alchemyTableFurniture'/);
assert.match(cauldronDef, /name: 'Alchemy Cauldron'/);
assert.doesNotMatch(cauldronDef, /fixture:\s*true/, 'fixtures never become Dzibim blueprints');
assert.match(game, /alchemyTableFurniture:\s*\{ wood: 4, stone: 3, bar_nativeCopper: 2 \}/, 'crafting materials must be authored');
assert.match(game, /\.filter\(\(\[, def\]\) => !def\.fixture\)/, 'normal furniture enters the blueprint catalog');
assert.match(game, /category: item\.key === 'alchemyTableFurniture' \? 'processing' : 'decorative'/, 'the cauldron recipe belongs in Crafting > Processing');
assert.match(game, /if \(o\.key === 'alchemyTable'\) return makeAlchemyTableInteractable\(\)/, 'home placement must open alchemy');
assert.match(game, /alchemyTableFurniture: \(\) => makeAlchemyTableInteractable\(\)/, 'Kunji keeps the same interaction');
assert.match(game, /registerFarmDecorativeInteractable\(key, col, row/, 'outdoor saved cauldrons must regain interactions');
assert.match(game, /if \(obj\.area === 'farm' && isFarmDecorativeInteractable\(obj\.key\)\) worldObjects\.delete/, 'moving/removing cauldrons must clear their old interaction');

global.CustomEvent = class CustomEvent {
  constructor(type, init) { this.type = type; this.detail = init?.detail; }
};
global.document = {
  getElementById: () => null, // The public AlchemySystem API is testable without any DOM panel.
  dispatchEvent: () => {},
  addEventListener: () => {},
};
global.window = {
  InventoryStacks: require('./lib/inventory-stacks'),
  SkillSystem: { level: () => 10, XP_GAINS: { alchemyBrew: 8, alchemyDiscovery: 18, alchemyTarget: 5 }, award: () => {} },
  EffectBuffBar: { registerProvider: () => {}, refresh: () => {} },
};
require(path.join(root, 'docs/js/alchemy-system.js'));

const inventory = {}; // Used for the exact remaining-stock checks following successive brews.
const events = []; // Captures user-facing notifications without a browser.
const api = window.AlchemySystem; // The game's real reagent selector and brew implementation.
api.init({
  ITEM_DEFS: {}, inventory,
  getPlayer: () => ({ health: 100, maxHealth: 100, stamina: 100, maxStamina: 100, footing: 100, maxFooting: 100 }),
  random: () => 0.25,
  clampInventoryStack: key => { if ((inventory[key] || 0) <= 0) delete inventory[key]; },
  showToast: msg => events.push(msg),
  refreshItemScroll: () => {},
  saveMemberWorldData: () => {},
});

const keys = Object.keys(api.REAGENT_DEFS); // Search real traits for a brewable triple rather than hardcoding catalog content.
let triple = null; // Used by every repeated-brew assertion.
for (let i = 0; i < keys.length && !triple; i++) {
  for (let j = i + 1; j < keys.length && !triple; j++) {
    for (let k = j + 1; k < keys.length; k++) {
      const candidate = [keys[i], keys[j], keys[k]]; // Proposed trio for the actual trait enumerator.
      if (api.enumerateRecipes(candidate).length) { triple = candidate; break; }
    }
  }
}
assert(triple, 'at least one reagent triple must brew');
triple.forEach(key => { inventory[key] = 3; api.toggleReagent(key); });
const target = api.enumerateRecipes(triple)[0].recipeId; // A learned intentional target should also survive repeated batches.
api.discoverRecipe(target, 'test');
api.setTargetRecipe(target);
assert.strictEqual(api.targetedRecipeId, target);

for (let batch = 1; batch <= 2; batch++) {
  assert(api.brew().ok, 'batch ' + batch + ' should brew');
  assert.deepStrictEqual(api.selectedReagents, triple, 'ingredients remain selected while all three are stocked');
  assert.strictEqual(api.targetedRecipeId, target, 'intentional target remains selected between batches');
  assert.strictEqual(api.diagnosticsSnapshot().repeatBrewReady, true, 'mobile diagnostic must report repeat-ready');
}
assert(api.brew().ok, 'last stocked batch should still brew');
assert.deepStrictEqual(api.selectedReagents, [], 'exhausted stacks are no longer selected');
assert.strictEqual(api.targetedRecipeId, null, 'no incomplete recipe may retain targeting');
assert.strictEqual(api.diagnosticsSnapshot().repeatBrewReady, false);
assert.strictEqual(api.brew().ok, false, 'brewing without replacing ingredients must not consume anything');

triple.forEach((key, index) => { inventory[key] = index === 0 ? 1 : 2; api.toggleReagent(key); });
assert.deepStrictEqual(api.selectedReagents, triple);
assert(api.brew().ok, 'a batch with uneven ingredient stock should brew');
assert.deepStrictEqual(api.selectedReagents, triple.slice(1), 'only the exhausted ingredient is removed');
assert.strictEqual(api.diagnosticsSnapshot().repeatBrewReady, false);
console.log('Home alchemy cauldron and consecutive brewing regression tests passed');
