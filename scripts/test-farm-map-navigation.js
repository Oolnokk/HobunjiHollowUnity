'use strict';
const assert = require('node:assert/strict'); // Verifies production map and building-page behavior without a WebGL context.
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('docs/js/farm-panel-core.js', 'utf8'); // Execute the real owner functions with small rendering boundaries.
function owner(name) {
  const start = source.indexOf(`  function ${name}(`); // Function boundaries avoid copying production logic into the test.
  const end = source.indexOf('\n  function ', start + 1);
  return source.slice(start, end);
}
const nodes = new Map(); // DOM identity must survive consecutive renders.
function element() {
  return {
    children: [], dataset: {}, style: {}, classList: { add() {} },
    setAttribute() {}, addEventListener(type, callback) { this[type] = callback; },
    appendChild(child) { this.children.push(child); child.parentElement = this; if (child.id) nodes.set(child.id, child); },
    replaceChildren() { this.children = []; },
    set innerHTML(value) { this.html = value; this.children = []; }, get innerHTML() { return this.html; },
    cloneNode() { const copy = element(); copy.html = this.html; return copy; },
  };
}
const canvas = element(); // Base terrain still uses its original tile-coordinate canvas.
canvas.dataset.clickBound = '1'; canvas.getContext = () => ({ fillRect() {}, beginPath() {}, arc() {}, fill() {} });
const wrap = element(); wrap.appendChild(canvas); nodes.set('farmGlanceCanvas', canvas);
nodes.set('farmGridLegend', { dataset: { built: '1' } });
for (const id of ['farmBuildingsList', 'farmBuildingCustomizationList', 'farmBuildingsNote', 'farmCancelPlacementBtn']) nodes.set(id, element());
const itemCalls = [], headCalls = [], editorCalls = []; // Captures delegation to the existing shared authorities.
const crop = { icon: '🌾', label: 'Needlegrain' }; // Both ready and growing crops use the same harvest item identity.
const genotype = { colors: ['blue'] }; // Identity must reach the shared chathead renderer unchanged.
let canAlter = true, mapOpened = false, publicRenders = 0; // Exercises permission gating and the placement-page handoff.
const deps = {
  COLS: 2, ROWS: 2, getGrid: () => [[{ type: 'grass', crop: 'grain', cropReady: true }, { type: 'grass', crop: 'grain' }], []],
  ITEM_DEFS: { needlegrain: crop }, cropData: { grain: { cropKey: 'needlegrain' } },
  applyItemSpriteIcon: (...args) => itemCalls.push(args), isHouseFootprint: () => false,
  processingFurnitureObjects: new Set(), worldObjects: new Map(),
  animalObjects: new Set([{ col: 1, row: 1, animalKey: 'voorgAss', genotype }]),
  hasFarmPermission: () => canAlter, getBarnTiers: () => ({ little: { label: 'Little Barn', planItem: 'barnPlan' } }),
  getHousePieces: () => [{ stage: 'built' }], getFarmBuildings: () => [{ id: 'b1', kind: 'barn', tier: 'little', w: 3, h: 3 }],
  inventory: { barnPlan: 1 }, esc: String,
}; // Minimal dependencies are intentionally shared by both real owner functions.
const context = {
  deps, document: { getElementById: id => nodes.get(id), createElement: element },
  window: { InventoryStacks: { applyHeadIcon: (...args) => headCalls.push(args) }, FarmLayoutEditor: { renderLauncher() {}, open: id => editorCalls.push(id) },
    FarmProduction: { hasPlacement: () => false, cancelPlacement() {}, renderRows(list, customization) { assert.equal(list, nodes.get('farmBuildingsList')); assert.equal(customization, nodes.get('farmBuildingCustomizationList')); } } },
  FARM_GLANCE_PX: 10, _tileColors: () => ({ grass: '#123' }), _farmPlacementMode: null,
  showFarmMap: () => { mapOpened = true; }, openHouseLayoutModal() {},
};
context.window.FarmPanel = { render() { publicRenders++; context.renderFarmBuildings(); } }; // Public rendering includes the runtime's building decorators.
vm.createContext(context);
vm.runInContext(owner('renderFarmGridGlance') + '\n' + owner('renderFarmBuildings'), context);
context.renderFarmGridGlance();
assert.equal(canvas.dataset.iconMarkers, '1', 'palette layer must not repaint animal dots');
assert.equal(nodes.get('farmGlanceMarkers').children.length, 3);
assert.equal(itemCalls.length, 2); assert.equal(itemCalls[0][1], crop); assert.equal(itemCalls[0][2], 'needlegrain');
assert.equal(headCalls[0][1], 'voorgAss'); assert.equal(headCalls[0][2], genotype);
assert.equal(headCalls[0][0].style.left, '75%'); assert.equal(headCalls[0][0].style.top, '75%');
context.renderFarmGridGlance();
assert.equal(nodes.get('farmGlanceMarkers').children.length, 3, 'refresh replaces markers instead of accumulating copies');
context.renderFarmBuildings();
assert.equal(nodes.get('farmBuildingsList').children.length, 2, 'everyday page retains house and barn status');
assert.ok(nodes.get('farmBuildingsList').children.every(row => !row.children.length), 'editing controls are absent from status rows');
const edits = nodes.get('farmBuildingCustomizationList').children; // House editing, barn movement, and owned plans belong to customization.
assert.equal(edits.length, 3);
edits[1].children[0].click(); assert.equal(editorCalls[0], 'farm_barn_b1');
edits[2].children[0].click(); assert.equal(mapOpened, true, 'placing a plan opens the map page');
assert.equal(publicRenders, 1, 'arming a plan refreshes through the decorated public renderer');
assert.equal(nodes.get('farmCancelPlacementBtn').hidden, false, 'map retains a cancel action during placement');
nodes.get('farmCancelPlacementBtn').onclick();
assert.equal(publicRenders, 2, 'cancel refresh also retains decorated building actions');
delete canvas.dataset.clickBound;
canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 20, height: 20 }); // Test map completion through the actual click handler.
deps.showToast = () => {};
context.window.FarmBuildings = { placePlan: () => ({ ok: true, message: 'Placed' }) };
edits[2].children[0].click();
context.renderFarmGridGlance();
canvas.click({ clientX: 5, clientY: 5 });
assert.equal(publicRenders, 4, 'successful placement also refreshes through the decorated renderer');
assert.equal(context._farmPlacementMode, null, 'successful placement clears the armed plan');

canAlter = false; context._farmPlacementMode = null; context.renderFarmBuildings();
assert.equal(nodes.get('farmBuildingCustomizationList').children.length, 1, 'farmhands cannot move barns or place plans without permission');
console.log('Farm map shared icons, marker refresh, separated building actions and placement handoff passed');
