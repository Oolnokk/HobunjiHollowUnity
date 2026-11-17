#!/usr/bin/env node
'use strict';

// Exercises the actual smith progression module and the game.js save/damage bridge.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const read = name => fs.readFileSync(name, 'utf8'); // Reuses production files instead of copying their formulas into tests.
const source = read('docs/js/metal-reinforcement.js');
const game = read('docs/game.js');
const onboarding = read('docs/onboarding-core.js'); // Both startup paths must explicitly initialize Copper-I, not legacy ungraded strength.
const shop = read('docs/js/metal-craft-shop.js');
const foundry = read('docs/js/foundry-shop.js');
const html = read('docs/index.html');
const sandbox = { window: {} }; // The browser module exposes one public namespace.
vm.runInNewContext(source, sandbox);
const reinforcement = sandbox.window.MetalReinforcement;
assert(reinforcement, 'reinforcement module loads');

const keys = ['nativeCopper', 'lowTinBronze', 'tinBronze', 'highTinBronze', 'arsenicalBronze', 'leadedBronze']; // The actual ascending gameplay metal list.
const metalDefs = Object.fromEntries(keys.map((key, index) => [key, { tier: index + 1, label: key }])); // Same tier data as game.js; names are unimportant for numeric tests.
const near = (actual, expected, label) => assert(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} != ${expected}`);
let status = reinforcement.status('nativeCopper', { metalKey: 'nativeCopper', grade: 0 }, metalDefs, keys);
near(status.multiplier, 0.75, 'starter metal power');
let barTotal = 0; // Tracks exact material sink for a full copper-to-leaded upgrade.
let goldTotal = 0; // Ensures every individual reinforcement has a smithing fee.
let steps = 0; // Validates the number of mandatory intermediate purchases.
const purchasedGrades = []; // Checks that no metal subtiers can be skipped.
while (true) {
  const next = reinforcement.next(status, metalDefs, keys);
  if (!next) break;
  assert.equal(next.rank, status.rank + 1, 'reinforcement never skips a grade');
  assert(next.multiplier > status.multiplier, 'each purchased grade improves efficacy');
  assert(next.bars > 0 && next.gold > 0, 'each upgrade consumes bars and labor');
  purchasedGrades.push(`${next.metalKey}:${next.grade}`);
  barTotal += next.bars;
  goldTotal += next.gold;
  steps++;
  status = reinforcement.status('nativeCopper', { metalKey: next.metalKey, grade: next.grade }, metalDefs, keys);
}
assert.equal(steps, 23, 'six metals with four grades each require 23 upgrades from copper I');
assert.equal(barTotal, 50, 'full reinforcement chain spends 50 metal bars');
assert.equal(reinforcement.MIN_REINFORCEMENT_POWER, 0.75);
assert.equal(reinforcement.MAX_REINFORCEMENT_POWER, 1.50);
assert.equal(reinforcement.forgeBarCost(3, 'nativeCopper', metalDefs), 3, 'starter copper forging retains its existing cost');
assert.equal(reinforcement.forgeBarCost(3, 'leadedBronze', metalDefs), 18, 'advanced metal forging also consumes additional bars');
assert.equal(reinforcement.forgeBarCost(3, 'invalid', metalDefs), Infinity, 'invalid metals may not forge');
assert(goldTotal > 0, 'labor is charged for all purchases');
assert.equal(purchasedGrades.length, new Set(purchasedGrades).size, 'no grade repeated');
near(status.multiplier, 1.50, 'new peak combat/tool power');
assert.equal(reinforcement.next(status, metalDefs, keys), null, 'maximum reinforcement cannot be exceeded');

for (let i = 0; i < keys.length; i++) {
  const legacy = reinforcement.status('nativeCopper', { metalKey: keys[i] }, metalDefs, keys);
  near(legacy.multiplier, 0.90 + 0.05 * i, 'legacy saved reinforcement retains its prior strength');
  const upcoming = reinforcement.next(legacy, metalDefs, keys);
  if (upcoming) assert(upcoming.multiplier > legacy.multiplier, 'a legacy upgrade never weakens the weapon');
}
const oldForging = reinforcement.status('leadedBronze', null, metalDefs, keys);
near(oldForging.multiplier, 1.15, 'existing top-metal gear without grades is not nerfed');
const newForging = reinforcement.status('leadedBronze', { metalKey: 'leadedBronze', grade: 0 }, metalDefs, keys);
assert(newForging.multiplier < 1.50, 'newly forged high-tier tools must still consume high-tier reinforcement bars');
assert(reinforcement.next(newForging, metalDefs, keys), 'new top-metal gear has upgrades remaining');
assert.equal(reinforcement.status('nativeCopper', { metalKey: 'invalid', grade: 100 }, metalDefs, keys).rank, 0, 'corrupt saves cannot inflate power');
assert.equal(reinforcement.status('tinBronze', { metalKey: 'nativeCopper', grade: 2 }, metalDefs, keys).rank, 8, 'bad saves cannot downgrade forged metal');

function productionFunction(name) {
  const start = game.indexOf('function ' + name + '('); // Isolates the real runtime bridge without evaluating the entire game.
  assert(start >= 0, `missing ${name}`);
  const body = game.indexOf('{', game.indexOf(')', start));
  let depth = 0; // Balanced lexical braces are enough for these small fixed gameplay functions.
  for (let i = body; i < game.length; i++) {
    if (game[i] === '{') depth++;
    else if (game[i] === '}' && --depth === 0) return game.slice(start, i + 1);
  }
  assert.fail('unclosed function ' + name);
}

let saved = 0; // Confirms the real game bridge persists grade changes.
const gearInventory = { toolReinforcement: {}, tools: { hatchet_nativeCopper: true } };
const runtime = {
  gearInventory,
  TOOL_ITEM_DEFS: { hatchet_nativeCopper: { metalKey: 'nativeCopper' } },
  VERDIGRIS_METAL_KEYS: keys,
  METAL_DEFS: metalDefs,
  window: { MetalReinforcement: reinforcement },
  saveGearInventory() { saved++; },
};
const methods = ['toolReinforcementMetal', 'toolReinforcementProgress', 'setToolReinforcement', 'toolEffectiveMetalKey', 'toolMetalMultiplier', 'metalDmgMultiplier'];
vm.runInNewContext(methods.map(productionFunction).join('\n'), runtime);
near(vm.runInNewContext("toolMetalMultiplier('hatchet_nativeCopper')", runtime), 0.90, 'old ungraded copper gear still loads at its legacy strength');
assert.equal(vm.runInNewContext("setToolReinforcement('hatchet_nativeCopper', 'nativeCopper', 1)", runtime), true);
assert.equal(saved, 1);
near(vm.runInNewContext("toolMetalMultiplier('hatchet_nativeCopper')", runtime), reinforcement.multiplierAtRank(1, metalDefs, keys), 'game damage bridge uses new grade');
assert.equal(vm.runInNewContext("setToolReinforcement('hatchet_nativeCopper', 'nativeCopper', 99)", runtime), false, 'invalid grades rejected');
assert.equal(saved, 1, 'failed upgrade does not save');
assert.equal(vm.runInNewContext("setToolReinforcement('hatchet_nativeCopper', 'leadedBronze', 3)", runtime), true);
near(vm.runInNewContext("toolMetalMultiplier('hatchet_nativeCopper')", runtime), 1.50, 'final grade reaches new maximum');
assert.match(shop, /MetalReinforcement\?\.next\(current/, 'smith looks up one next stage');
assert.doesNotMatch(shop, /mc-reinforce-select/, 'arbitrary metal-tier selection is removed');
assert.match(shop, /setToolReinforcement\(itemKey, metalKey, 0\)/, 'ordinary new tools begin at grade I');
assert.match(shop, /if \(deps\.getGearInventory\(\)\?\.tools\?\.\[itemKey\]\)/, 'existing owned tool cannot be forged again');
const smithFunction = shop.slice(shop.indexOf('  function craftMetalTool('), shop.indexOf('  // choice:', shop.indexOf('  function craftMetalTool('))); // Exercise early duplicate protection without DOM or gold costs.
const ownedItem = 'hatchet_nativeCopper';
let smithWrites = 0;
const smithDeps = { // Browser-like adapters: owned item, enough materials, all registration data.
 UNLOCKED_TOOL_SHAPES: ['hatchet'], VERDIGRIS_METAL_KEYS: keys, METAL_DEFS: metalDefs,
 craftedToolItemKey: (shape, metal) => shape + '_' + metal, getGearInventory: () => ({ tools: { [ownedItem]: true } }),
 inventory: {bar_nativeCopper: 100, gold: 100}, showToast() {}, setToolReinforcement() {smithWrites++}
};
const smithScope = { deps: smithDeps, window: {MetalReinforcement: reinforcement, WeaponTrustVisits: {}}, CRAFT_BAR_COST: 3, CRAFT_LABOR_GOLD: 15 };
const craftExisting = new Function('scope', 'with(scope) { ' + smithFunction + '; return craftMetalTool; }')(smithScope); // Uses production purchase body.
craftExisting('hatchet', 'nativeCopper');
assert.equal(smithDeps.inventory.bar_nativeCopper, 100, 'smith cannot charge bars on a duplicate tool');
assert.equal(smithDeps.inventory.gold, 100, 'smith cannot charge gold on a duplicate tool');
assert.equal(smithWrites, 0, 'duplicate forge cannot erase or replace reinforcement grades');
assert.match(foundry, /setToolReinforcement\(key, metal, 0\)/, 'modular new tools begin at grade I');
assert.match(game, /toolReinforcement: Object\.fromEntries\(/, 'new game characters start at actual grade I (0.75×)');
assert.match(onboarding, /toolReinforcement: Object\.fromEntries\(/, 'new onboarding characters start at actual grade I (0.75×)');
assert.match(shop, /forgeBarCost\(CRAFT_BAR_COST, metalKey/, 'the ordinary smith uses scaled forging costs');
assert.match(foundry, /forgeBarCost\(cost.bars, metal, deps.METAL_DEFS\)/, 'the foundry uses the same scaled forging costs');
const inventoryUI = read('docs/js/inventory-ui.js'); // Equipment detail cards expose the reinforcement grade when CombatDeps provides it.
assert.match(inventoryUI, /toolReinforcementProgress\?\.\(itemKey\)/, 'Pack shows the actual graded reinforcement');
assert(html.indexOf('js/metal-reinforcement.js') < html.indexOf('js/metal-craft-shop.js'), 'progression module loads before shop');
assert.match(game, /toolReinforcementProgress,\s*setToolReinforcement/, 'game injects grade progress into smith');
console.log(`Metal reinforcement passed: ${steps} upgrades, ${barTotal} bars, new .75×–1.50× endpoints, legacy save compatibility.`);
