#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict'); // Confirms animal ownership stays intact while equipment roles remain opt-in.
const fs = require('node:fs'); // Runs checks against shipped source files.
const path = require('node:path'); // Allows invocation outside the repository root.
const vm = require('node:vm'); // Executes extracted production paths with controlled inputs.

const root = path.resolve(__dirname, '..'); // Repository root for all source fixture reads.
const game = fs.readFileSync(path.join(root, 'docs/game.js'), 'utf8'); // Real player load, reset, and companion spawn logic.
const farmAnimals = fs.readFileSync(path.join(root, 'docs/js/farm-animals.js'), 'utf8'); // Real item-to-Stable acquisition logic.
const farmPanel = fs.readFileSync(path.join(root, 'docs/js/farm-panel-core.js'), 'utf8'); // Real farm-to-Stable transfer logic.

function section(source, start, end) {
  const startIndex = source.indexOf(start);
  assert(startIndex >= 0, `Missing source section: ${start}`);
  const endIndex = source.indexOf(end, startIndex);
  assert(endIndex > startIndex, `Missing end marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

function loadStable(playerData) {
  const context = {
    playerData,
    window: { CreatureGenetics: { makeDefaultGenotype: () => ({ sizeClass: 'medium' }) } },
    companionAiTypeForKind: () => 'vigilantProtector',
  }; // Only a saved character and standard genetics defaults are needed for the actual restore.
  vm.runInNewContext(
    'let stable = [], activeCompanionId = null, activeMountId = null, activeShoulderPetId = null;\n'
      + section(game, '        stable = Array.isArray(playerData.stable)', '        // Backfill genotype-less')
      + '\nthis.out = { stable, activeCompanionId, activeMountId, activeShoulderPetId };',
    context,
  );
  return context.out;
}

const newcomer = loadStable({}); // A new character still receives their original starter animal.
assert.equal(newcomer.stable.length, 1, 'starter Bingo stays owned');
assert.equal(newcomer.stable[0].id, 'stable_bingo');
assert.equal(newcomer.activeCompanionId, null, 'Bingo is not automatically equipped');
assert.equal(newcomer.activeMountId, null, 'mount slot begins empty');
assert.equal(newcomer.activeShoulderPetId, null, 'shoulder-pet slot begins empty');

const owned = [{ id: 'actual-pet', kind: 'gar-wolf', name: 'My Wolf' }]; // An existing companion saved in the Stable.
assert.equal(loadStable({ stable: owned, activeCompanionId: null }).activeCompanionId, null, 'owned animals do not fill deliberately empty slots');
assert.equal(loadStable({ stable: owned, activeCompanionId: 'actual-pet' }).activeCompanionId, 'actual-pet', 'explicit saved companion choice survives');
assert.equal(loadStable({ stable: owned, activeMountId: 'mount-a', activeShoulderPetId: 'pet-b' }).activeMountId, 'mount-a', 'explicit mount choice survives');
assert.equal(loadStable({ stable: owned, activeMountId: 'mount-a', activeShoulderPetId: 'pet-b' }).activeShoulderPetId, 'pet-b', 'explicit shoulder choice survives');

assert.match(game, /whistles:\s*\[\s*\{ id: 'whistle_bingo'/, 'starter whistle remains owned');
assert.match(game, /gearInventory\.whistles = \[\{ id: 'whistle_bingo'/, 'legacy whistle backfill remains present');

function loadEquipment(playerData, gearInventory, priorWhistle) {
  const context = {
    playerData, gearInventory,
    window: { __hobunjiCutscenePreview: false },
    equipmentSlots: { hoe: null, shovel: null, weapon: null, ranged: null, whistle: priorWhistle },
  }; // Simulates returning from a different character with a whistle still in a runtime slot.
  vm.runInNewContext(
    section(game, '        equipmentSlots.whistle = null;', '        rebuildToolMeshes();'),
    context,
  );
  return context.equipmentSlots;
}
const ownedGear = { tools: {}, whistles: [{ id: 'whistle_bingo', creatureKey: 'dabinggi-hound', name: 'Bingo' }] }; // The original starter gear is not deleted.
assert.equal(loadEquipment({}, ownedGear, 'whistle_bingo').whistle, null, 'missing selection does not fill the whistle slot');
assert.equal(loadEquipment({ equipmentSlots: { whistle: null } }, ownedGear, 'whistle_bingo').whistle, null, 'explicitly cleared whistle slot stays empty');
assert.equal(loadEquipment({ equipmentSlots: { whistle: 'whistle_bingo' } }, ownedGear, null).whistle, 'whistle_bingo', 'deliberately equipped whistle is restored');

assert.doesNotMatch(game, /_autoAssignStableRole/, 'unused auto-equip helper removed from game');
assert.doesNotMatch(farmAnimals, /_autoAssignStableRole/, 'newly collected animals do not auto-equip');
assert.doesNotMatch(farmPanel, /_autoAssignStableRole/, 'transferred animals do not auto-equip');
assert.doesNotMatch(game, /activeCompanionId = stable\[0\]\.id/, 'first owned animal does not take over empty companion slot');
assert.doesNotMatch(game, /equipmentSlots\.whistle = (?:equipmentSlots\.whistle \|\| )?gearInventory\.whistles\[0\]\.id/, 'world resets never automatically select a whistle');

const acquisition = {
  stable: [], inventory: { 'wolf-item': 1 }, active: null, saves: 0,
}; // Tracks acquisition without providing an obsolete auto-equip callback.
const acquisitionContext = {
  deps: {
    LIVESTOCK_ITEM_KINDS: { 'wolf-item': 'gar-wolf' },
    inventory: acquisition.inventory,
    clampInventoryStack() {},
    getStable: () => acquisition.stable,
    companionAiTypeForKind: () => 'vigilantProtector',
    saveStable() { acquisition.saves++; },
  },
  window: { CreatureGenetics: { defaultLivestockName: () => 'Wolf', makeDefaultGenotype: () => ({ sizeClass: 'medium' }) } },
  _consumeLivestockItemGenotype: () => null,
}; // Real FarmAnimals.addToStable can run without auto-role assignment at all.
vm.runInNewContext(
  section(farmAnimals, '  function addToStable(itemKey, options = {}) {', '\n  // Recreates every animal')
    + '\nthis.addToStable = addToStable;', acquisitionContext,
);
assert.equal(acquisitionContext.addToStable('wolf-item').ok, true, 'item-to-Stable acquisition still succeeds');
assert.equal(acquisition.stable.length, 1, 'acquired animal remains available');
assert.equal(acquisition.active, null, 'acquisition does not select the animal');
assert.equal(acquisition.saves, 1, 'acquisition still persists');

const transfer = { stable: [], saves: 0 }; // Separate farm-to-Stable transfer lifecycle.
const transferContext = {
  deps: { getStable: () => transfer.stable, saveStable() { transfer.saves++; } },
  window: {},
}; // A transferred adult needs no baby naming UI.
vm.runInNewContext(
  section(farmPanel, '  function _addToOwnStable(stabledEntry) {', '\n  function moveLivestockToStable(')
    + '\nthis.add = _addToOwnStable;', transferContext,
);
transferContext.add({ id: 'transferred', kind: 'gar-wolf', lifeStage: 'adult' });
assert.equal(transfer.stable.length, 1, 'farm transfer keeps the animal');
assert.equal(transfer.saves, 1, 'farm transfer persists without equipping it');

console.log('Companion equipment opt-in checks passed: ownership, saves, whistle restoration, acquisitions and transfers.');
