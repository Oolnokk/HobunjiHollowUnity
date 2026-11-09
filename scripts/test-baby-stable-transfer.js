'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Exercise the exact FarmPanelCore transfer helpers in a small stateful harness.
// No copy of the production conversion/naming logic is maintained by this test.
const source = fs.readFileSync('docs/js/farm-panel-core.js', 'utf8'); // Existing authoritative livestock-to-Stable conversion code.
const start = source.indexOf('  function _stableEntryFromLivestock(entry) {'); // Private Farm transfer seam.
const end = source.indexOf('  function moveLivestockToStable(id) {', start); // Next helper, excluded from this isolated test.
assert(start >= 0 && end > start, 'FarmPanelCore transfer helpers remain discoverable');
const helpers = source.slice(start, end); // Actual unchanged production helper bodies, not a reimplementation.
const stable = []; // Character-scoped Stable storage filled by the real transfer helper.
const arrivals = []; // Name prompts intercepted by the shared popup service.
let stableSaves = 0; // Confirms both the transfer and confirmed rename persist.
let roleAssignments = 0; // Babies must never be auto-equipped as companions/mounts.
const deps = {
  getStable: () => stable,
  companionAiTypeForKind: () => 'companion',
  _autoAssignStableRole() { roleAssignments++; },
  saveStable() { stableSaves++; },
}; // Minimal genuine FarmPanel dependencies reached by the transfer helpers.
const window = {
  AnimalBabyArrival: { requestName(entry, options) { arrivals.push({ entry, options }); return true; } },
  FarmPanel: { renderStablePanel() {} },
}; // The popup and Stable panel, otherwise left unmodified.
const context = vm.createContext({ window, deps });
vm.runInContext(helpers + '\nthis.convert = _stableEntryFromLivestock; this.stableAnimal = _addToOwnStable;', context);

const baby = { id: 'nursery_1', kind: 'puktuk', name: 'Baby Puktuk', lifeStage: 'baby', genotype: { coat: 'blue' } }; // World-owned Nursery source animal.
const converted = context.convert(baby);
assert.equal(converted.lifeStage, 'baby', 'Nursery age survives the world-to-character transfer');
assert.deepEqual(JSON.parse(JSON.stringify(converted.genotype)), baby.genotype, 'transfer preserves the entire inherited genotype');
context.stableAnimal(converted);
assert.equal(stable.length, 1);
assert.equal(roleAssignments, 0, 'a transferred baby must not auto-equip');
assert.equal(arrivals.length, 1, 'a transferred baby requests one prefilled naming prompt');
assert.equal(arrivals[0].options.scope, 'stable');
assert.equal(arrivals[0].options.commit('Pippo'), true, 'player-confirmed name saves to the personal Stable');
assert.equal(stable[0].name, 'Pippo');
assert.equal(stableSaves, 2, 'transfer and naming each persisted exactly once');

const grown = context.convert({ ...baby, lifeStage: 'adult', name: 'Adult Puktuk' }); // Ordinary mature animals should not be renamed unexpectedly.
context.stableAnimal(grown);
assert.equal(stable[1].lifeStage, 'adult', 'adult stays adult');
assert.equal(roleAssignments, 1, 'adult auto-assignment behavior remains unchanged');
assert.equal(arrivals.length, 1, 'adult transfers do not interrupt play with baby naming');
console.log('Farm-to-Stable baby stage and naming regression tests passed.');
