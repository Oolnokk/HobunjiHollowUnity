#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict'); // Verifies the reported regressions against production functions.
const fs = require('node:fs'); // Reads the production scripts without changing their public API for tests.
const vm = require('node:vm'); // Isolates browser functions with deterministic DOM and asynchronous fixtures.
const read = path => fs.readFileSync(path, 'utf8'); // Loads each reviewed module.
function section(source, start, end) {
  const from = source.indexOf(start); // Starts at the named production function/block.
  const to = source.indexOf(end, from); // Ends at its next stable sibling boundary.
  assert(from >= 0 && to > from, `Missing source boundary: ${start}`);
  return source.slice(from, to);
}
async function flushPromises() { for (let step = 0; step < 12; step++) await Promise.resolve(); } // Drains nested preview/composite continuations.
function testInventoryWrites() {
  let writes = 0; // Counts text-node replacements that a real MutationObserver receives even for equal strings.
  function textNode() {
    let value = ''; // Retains current text so the regression distinguishes changed from unchanged content.
    return { classList: { add() {} }, get textContent() { return value; }, set textContent(next) { writes++; value = next; } };
  }
  const label = textNode(), mastery = textNode(), badge = textNode(); // Existing Gear DOM children after the first render.
  const slot = { querySelector: selector => selector === '.ies-label' ? label : mastery, classList: { contains: () => false } }; // Owned tool fixture.
  const worn = { querySelector: () => badge }; // Existing Worn badge fixture.
  const source = read('docs/js/inventory-ui.js'); // Executes both mutation-producing decorators.
  const context = vm.createContext({}); // Decorators do not need a document when children already exist.
  vm.runInContext(section(source, '  function decorateOwnedGearName(', '  function decorateInfoPanel('), context);
  context.decorateOwnedGearName(slot, 'Axe (Mastery 1/5) — click to assign');
  context.setSlotState(worn, 'Worn', 'worn');
  assert.equal(writes, 3);
  for (let frame = 0; frame < 120; frame++) {
    context.decorateOwnedGearName(slot, 'Axe (Mastery 1/5) — click to assign');
    context.setSlotState(worn, 'Worn', 'worn');
  }
  assert.equal(writes, 3, 'unchanged Gear must settle instead of scheduling perpetual observer refreshes');
  context.decorateOwnedGearName(slot, 'Axe (Mastery 2/5) — click to assign');
  assert.equal(writes, 4, 'changed mastery still updates');
}
async function testIconCompletionOrder() {
  const source = read('docs/js/equipment-panel.js'); // Real tint and composite completion guards.
  for (const tintFirst of [false, true]) { // Covers both possible network/decode completion orders.
    let finishTint, finishComposite; // Deferred jobs allow the race to be forced deterministically.
    const icon = { dataset: {}, tagName: 'IMG', isConnected: true, src: 'plain.png' }; // Shared DOM target of both renderers.
    const context = vm.createContext({ window: {
      SpriteRecolor: { getRecoloredCanvas: () => new Promise(resolve => { finishTint = resolve; }) },
      ClothingWeavingSystem: { hasWovenPattern: () => true, iconSpriteForCosmetic: () => new Promise(resolve => { finishComposite = resolve; }) },
    } }); // Only external rendering work is mocked; token checks are production code.
    vm.runInContext('const clothingIconTintUrlCache = new Map();\n' + section(source, '  function clothingIconTintValue(', '  function renderClothingIcon('), context);
    context.tintClothingIcon(icon, 'plain.png', { colorA: { hex: '#aa0000' } });
    context.upgradeClothingIconWithComposite(icon, {}, '', 'plain.png');
    if (tintFirst) { finishTint({ toDataURL: () => 'plain-tinted.png' }); await flushPromises(); }
    finishComposite('woven.png');
    await flushPromises();
    if (!tintFirst) { finishTint({ toDataURL: () => 'plain-tinted.png' }); await flushPromises(); }
    assert.equal(icon.src, 'woven.png', 'late initial tint must never erase the final woven icon');
  }
}
class Element {
  constructor() {
    this.children = []; // Holds generated layer controls for the delayed-initialization fixture.
    this.nodes = new Map(); // Stable querySelector targets model the parsed loom overlay.
    this.style = {}; this.dataset = {}; this.classList = { toggle() {} };
    this.isConnected = true;
  }
  appendChild(child) { this.children.push(child); }
  querySelector(selector) { if (!this.nodes.has(selector)) this.nodes.set(selector, new Element()); return this.nodes.get(selector); }
  querySelectorAll() { return []; }
  addEventListener() {}
  remove() { this.isConnected = false; }
}
async function testLoomInitialization() {
  const source = read('docs/js/clothing-weaving-system.js'); // Runs the real openLoom closure, including the submit handler.
  for (const failLoad of [false, true]) { // Missing layer data must also leave the saved weave untouched.
    let finishLayers, submissions = 0, submittedWeave; // Controls async config loading and records attempted item mutations.
    const savedWeave = { layers: { base: { pattern: { motifDataUrl: 'authored.png' }, patternLabel: 'Saved' } } }; // Existing garment pattern.
    const item = { uid: 'woven-1', slot: 'torso', cosmeticId: 'tunic', weaving: savedWeave }; // Gear instance selected for reweaving.
    const dye = { id: 'red', hex: '#aa0000', label: 'Red' }; // Unlocked pattern dye.
    const context = vm.createContext({
      document: { createElement: () => new Element(), body: new Element() }, window: {},
      loomOverlay: null, lastError: null, DEFAULT_LAYER_ROLE: 'base', WOOL_COST_BY_SLOT: { torso: 4 },
      MATERIALS: { light: { id: 'light', itemKey: 'wool', label: 'Light Wool', weightMul: 1 } },
      TUNING: { defensePerUnit: 0, footingResistancePerUnit: 0, dodgePenaltyPerUnit: 0, combatMovePenaltyPerUnit: 0 },
      equipmentDeps: { inventory: { wool: 10 } },
      injectStyles() {}, currentBlueprints: () => [{ baseCosmeticId: 'tunic', slot: 'torso' }],
      gearInventory: () => ({ clothingItems: [item] }), isCraftableCloth: () => true,
      ownedGlobalDyes: () => [dye], baseCosmeticId: () => 'tunic', articleLabel: () => 'Tunic',
      materialForReweaveItem: () => ({ id: 'light', itemKey: 'wool', label: 'Light Wool' }),
      dyeOptionHtml: () => '', patternLibraryEntries: () => [],
      weavingHasAnyPattern: weaving => !!weaving?.layers, summarizeWeavingLabel: () => 'Saved',
      weavingEntryForRole: (weaving, role) => weaving.layers[role], clone: value => JSON.parse(JSON.stringify(value)),
      resolveIconLayers: () => new Promise(resolve => { finishLayers = resolve; }),
      hasBehindView: async () => false, renderClothingLayers: async () => ({ canvas: null }),
      reweaveMaterialCost: () => 2, itemWeightUnits: () => 3, standardWeightFor: () => 3,
      clothingColorHex: () => '#ffffff', layerLabel: role => role,
      reweaveFromLoom(_item, _material, _dye, weaving) { submissions++; submittedWeave = weaving; },
    }); // Stubs rendering/material data while preserving the complete production initialization flow.
    vm.runInContext('function closeLoom() { loomOverlay?.remove(); loomOverlay = null; }\n' + section(source, '  function openLoom(', '  function craftFromLoom('), context);
    assert.equal(context.openLoom(item.uid), true);
    const overlay = context.loomOverlay; // Keeps the exact overlay and handler that started the pending load.
    const button = overlay.querySelector('[data-act="craft"]'); // Submit button must stay disabled throughout loading.
    assert.equal(button.disabled, true);
    button.onclick();
    await flushPromises();
    assert.equal(submissions, 0, 'early submission cannot consume wool or erase saved patterns');
    assert.equal(button.disabled, true, 'preview completion cannot unlock an uninitialized loom');
    finishLayers(failLoad ? [] : [{ role: 'base', url: 'tunic.png' }]);
    await flushPromises();
    assert.equal(button.disabled, failLoad);
    button.onclick();
    assert.equal(submissions, failLoad ? 0 : 1);
    if (!failLoad) assert.deepEqual(JSON.parse(JSON.stringify(submittedWeave)), savedWeave, 'saved pattern survives initialized submission');
    context.closeLoom();
    button.onclick();
    assert.equal(submissions, failLoad ? 0 : 1, 'a detached loom cannot submit');
  }
}
function testWaterCadence() {
  // The cadence block moved out of game.js's frame loop into
  // WaterSystem.tickSimulation; game.js must still delegate to it every frame.
  const game = read('docs/game.js');
  assert(game.includes('window.WaterSystem.tickSimulation(dt, currentArea, {'), 'game loop delegates water cadence to WaterSystem.tickSimulation');
  assert(game.includes('gameHoursPerSecond: (NIGHT_HOUR - MORNING_HOUR) / DAY_LENGTH_SECONDS'), 'game loop passes the authored game-hour rate');
  let ticks = 0; // Represents water snapshots that would dirty and rebuild geometry.
  const windowStub = {};
  vm.runInNewContext(read('docs/js/water-system.js'), { window: windowStub, console, Math, Float32Array }, { filename: 'water-system.js' });
  const water = windowStub.WaterSystem;
  water.init({ getTownZone: () => null, getTownGrid: () => [] });
  water.recomputeWater = () => { ticks++; }; // Public-API spy: tickSimulation must route through it (dev switchbox's noWaterSim relies on this).
  const hooks = { gameHoursPerSecond: (22 - 6) / 1200, onFarmTick() {}, onTick() {} };
  const dt = 1 / 60;
  for (let frame = 0; frame < 36000; frame++) water.tickSimulation(dt, 'wilderness', hooks);
  assert.equal(ticks, 0, 'ten minutes off-map must not accumulate a water backlog');
  for (let frame = 0; frame < 60; frame++) water.tickSimulation(dt, 'farm', hooks);
  assert.equal(ticks, 0, 'returning does not rebuild water on every frame');
  for (let frame = 0; frame < 540; frame++) water.tickSimulation(dt, 'farm', hooks);
  assert.equal(ticks, 1, 'normal farm simulation still ticks at its authored interval');
  for (let frame = 0; frame < 600; frame++) water.tickSimulation(dt, 'town', hooks);
  assert.equal(ticks, 2, 'town retains the same water cadence');
}
(async () => {
  testInventoryWrites();
  await testIconCompletionOrder();
  await testLoomInitialization();
  testWaterCadence();
  console.log('Inventory settling, woven icon races, loom initialization, and water cadence regressions passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
