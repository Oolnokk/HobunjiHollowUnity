'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/livestock-nursery-install-bridge.js', 'utf8');

let farmInitDeps = null;
let panelInitDeps = null;
let progressionInstallCount = 0;
let xpInstallCount = 0;

const context = {
  window: null,
  console,
  document: {
    readyState: 'complete',
    createElement() { throw new Error('all farm feature globals should already be present in this regression'); },
    head: { appendChild() { throw new Error('unexpected dynamic feature load'); } },
  },
  setInterval() { return 1; },
  clearInterval() {},
};
context.window = context;

context.LivestockNurseryObserverScope = {}; // Loaded before the legacy Nursery so its body-wide observer is scoped to Farm lists.
context.LivestockNurseryOutdoorGrowth = { install() {} }; // Keeps full-barn outdoor maturation from becoming an unrelated dynamic-load dependency in this bridge regression.
context.ANIMAL_GROWTH_CONFIG = {};
context.AnimalGrowth = { install() {} };
context.StableAnimalProgression = { install() { progressionInstallCount++; } };
context.StableAnimalPerkAdjustments = {};
context.StableAnimalTrainingRefinements = { install() {} };
context.StableAnimalXpEvents = { install() { xpInstallCount++; } };
context.StableTrainingCompendiumPatch = {};
context.BARN_INCUBATOR_CONFIG = {};
context.BarnIncubator = { install() {} };
context.FarmMenuLayout = { install() {} }; // Keeps this bridge-only regression focused on dependency mirroring rather than dynamic feature loading.
context.LivestockNurseryGrid = { install() {} }; // Keeps the Nursery presentation/economy feature from becoming an unrelated dynamic-load dependency in this bridge regression.
context.LivestockNurseryInventoryPaging = { install() {} }; // Same for the inventory-style paging/layout layer loaded immediately after the grid feature.
context.LivestockNurseryGridUiFix = { install() {} }; // Same for the help-row/controller grow compatibility loaded after paging.
context.LivestockNursery = { install() {} };
context.FarmAnimals = {
  init(injectedDeps) { farmInitDeps = injectedDeps; },
};
context.FarmPanel = {
  __stableAnimalProgressionWrapped: true,
  __stableTrainingRefinementsWrapped: true,
  init(injectedDeps) { panelInitDeps = injectedDeps; },
};

vm.createContext(context);
vm.runInContext(source, context, { filename: 'livestock-nursery-install-bridge.js' });

const farmDeps = {
  getStable: () => [],
  saveStable() {},
};
let activeCompanionId = 'companion-a';
let activeMountId = 'mount-a';
let activeShoulderPetId = 'shoulder-a';
const panelDeps = {
  getActiveCompanionId: () => activeCompanionId,
  getActiveMountId: () => activeMountId,
  getActiveShoulderPetId: () => activeShoulderPetId,
};

context.FarmAnimals.init(farmDeps);
assert.strictEqual(farmInitDeps, farmDeps, 'FarmAnimals still receives its original dependency object');
assert.equal(typeof farmDeps.getActiveCompanionId, 'undefined', 'Farm deps remain unchanged until FarmPanel supplies active-role getters');

context.FarmPanel.init(panelDeps);
assert.strictEqual(panelInitDeps, panelDeps, 'FarmPanel still receives its original dependency object');
assert.equal(farmDeps.getActiveCompanionId(), 'companion-a', 'companion active ID is bridged into progression farm deps');
assert.equal(farmDeps.getActiveMountId(), 'mount-a', 'mount active ID is bridged into progression farm deps');
assert.equal(farmDeps.getActiveShoulderPetId(), 'shoulder-a', 'shoulder-pet active ID is bridged into progression farm deps');

activeCompanionId = 'companion-b';
activeMountId = 'mount-b';
activeShoulderPetId = 'shoulder-b';
assert.equal(farmDeps.getActiveCompanionId(), 'companion-b', 'bridged companion getter remains live after selection changes');
assert.equal(farmDeps.getActiveMountId(), 'mount-b', 'bridged mount getter remains live after selection changes');
assert.equal(farmDeps.getActiveShoulderPetId(), 'shoulder-b', 'bridged shoulder-pet getter remains live after selection changes');

const debug = context.__stableAnimalProgressionDepsDebug();
assert.equal(debug.farmDepsReady, true, 'mobile debug reports FarmAnimals deps captured');
assert.equal(debug.panelDepsReady, true, 'mobile debug reports FarmPanel deps captured');
for (const methodName of ['getActiveCompanionId', 'getActiveMountId', 'getActiveShoulderPetId']) {
  assert.equal(debug.getters[methodName].farm, true, `${methodName} is available to Stable progression`);
  assert.equal(debug.getters[methodName].panel, true, `${methodName} remains available from FarmPanel deps`);
}
assert(progressionInstallCount > 0, 'StableAnimalProgression remains installed through the farm feature bridge');
assert(xpInstallCount > 0, 'StableAnimalXpEvents remains installed through the farm feature bridge');

console.log('Stable animal progression dependency bridge regression tests passed.');
