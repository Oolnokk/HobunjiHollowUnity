'use strict';
// Regression: Pack rendering batches DOM insertion and menu readability batches changed subtrees.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const gameSource = fs.readFileSync(path.join(__dirname, '../docs/game.js'), 'utf8'); // Exercises the shipped Pack renderer without duplicating its logic.
const uiSource = fs.readFileSync(path.join(__dirname, '../docs/js/inventory-ui.js'), 'utf8'); // Exercises the shipped readability scheduling function.
const gridStart = gameSource.indexOf('      function buildInventoryGrid() {');
const gridEnd = gameSource.indexOf('      // Only items that can actually carry tracked quality', gridStart);
assert(gridStart >= 0 && gridEnd > gridStart, 'Pack renderer extraction points exist');

function makeNode(tag) {
  const node = {
    tag, children: [], dataset: {}, attributes: {}, events: {}, className: '', disabled: false,
    appendChild(child) {
      if (child.tag === 'fragment') { this.children.push(...child.children); child.children.length = 0; }
      else this.children.push(child);
      if (this === grid) gridInserts++; // Counts connected grid writes, not detached fragment assembly.
      return child;
    },
    setAttribute(key, value) { this.attributes[key] = value; },
    addEventListener(type, callback) { this.events[type] = callback; },
    querySelector(selector) {
      if (selector === '.iib-icon') return this.icon || (this.icon = makeNode('span'));
      return null;
    },
  };
  Object.defineProperty(node, 'innerHTML', {
    get() { return this.html || ''; },
    set(value) { this.html = value; this.children.length = 0; },
  });
  return node;
}

let gridInserts = 0; // Used to assert that all 28+ tiles enter the connected grid in one mutation.
let detailClears = 0; // Used to confirm a normal unselected rebuild still resets the right panel.
const grid = makeNode('grid'); // Existing Pack grid fixture.
const wallet = makeNode('wallet'); // Existing gold display fixture.
const inventory = { apple: 2100, fish: 20, stick: 2, gold: 43 }; // Tests stack overflow, unrelated equipment, and wallet.
const equipmentSlots = { hoe: 'apple', axe: 'apple', ranged: 'fish', weapon: 'missing' }; // Two badges on every split Apple stack.
const itemDefs = Object.fromEntries(['apple', 'fish', 'stick'].map(key => [key, { label: key, cat: 'material' }])); // Known item metadata.
const appliedIcons = []; // Verifies that every nonempty tile gets sprite and head treatment.
const headIcons = []; // Verifies livestock icon calls are not lost when batching.
const selectedItems = []; // Captures click and controller-focus semantics.
let searchKey = ''; // Simulates user-driven Pack search filtering.
const document = {
  createElement: makeNode,
  createDocumentFragment: () => makeNode('fragment'),
  getElementById: id => ({ invGrid: grid, invWalletAmount: wallet })[id] || null,
  querySelectorAll: () => [],
};
const window = {
  InventorySearch: { filterKeys: keys => searchKey ? keys.filter(key => key === searchKey) : keys, matches: () => true, query: '' },
  InventoryStacks: {
    variants(key, total) {
      const result = []; // A minimal stack partition producing the same 999-unit boxes as the production InventoryStacks module.
      for (let left = total, index = 0; left > 0; index++, left -= 999) result.push({ key, count: Math.min(999, left), stackId: key + '|plain|' + index, variant: 'plain' });
      return result;
    },
    applyHeadIcon: (...args) => headIcons.push(args),
  },
  EquipmentPanel: { buildPackClothingSection() {} },
};

const build = new Function('bridge', `
  const document = bridge.document, window = bridge.window;
  const inventory = bridge.inventory, ITEM_DEFS = bridge.itemDefs, equipmentSlots = bridge.equipmentSlots;
  const LIVESTOCK_ITEM_KINDS = {}, INVENTORY_EMPTY_SLOT_FLOOR = 28;
  let menuOpen = true, invSelectedKey = null, invSelectedStack = null, invActiveCat = 'all';
  const getInventoryStackKeys = cat => Object.keys(inventory).filter(key => key !== 'gold' && (cat === 'all' || cat === 'fish' && key === 'fish'));
  const isQualityTrackedItem = () => false, itemIconForKey = key => key;
  const applyItemSpriteIcon = (...args) => bridge.appliedIcons.push(args);
  const selectInventoryItem = (...args) => bridge.selectedItems.push(args);
  const clearInventoryDetail = () => { bridge.clearDetail(); };
  ${gameSource.slice(gridStart, gridEnd)}
  return { render: buildInventoryGrid, close: () => { menuOpen = false; }, setCategory: value => { invActiveCat = value; } };
`)({ document, window, inventory, itemDefs, equipmentSlots, appliedIcons, selectedItems, clearDetail: () => detailClears++ });

build.render();
const boxes = grid.children.filter(node => node.className === 'inv-item-box'); // Nonempty stacks for all owned items.
const apples = boxes.filter(node => node.dataset.key === 'apple'); // 2100 Apples must occupy three independent boxes.
assert.equal(gridInserts, 1, 'one connected grid insertion, regardless of item count');
assert.equal(grid.children.length, 28, 'empty slot floor is preserved');
assert.deepEqual(apples.map(node => node.dataset.stackId), ['apple|plain|0', 'apple|plain|1', 'apple|plain|2']);
assert.deepEqual(apples.map(node => node.children.find(child => child.className === 'iib-equip-badge')?.textContent), ['H·Ax', 'H·Ax', 'H·Ax']);
assert.equal(boxes.find(node => node.dataset.key === 'fish').children.find(child => child.className === 'iib-equip-badge')?.textContent, 'R');
assert.equal(boxes.find(node => node.dataset.key === 'stick').children.some(child => child.className === 'iib-equip-badge'), false);
assert.equal(appliedIcons.length, boxes.length, 'sprite renderer receives every item');
assert.equal(headIcons.length, boxes.length, 'animal icon renderer receives every item');
assert.equal(wallet.textContent, 43, 'wallet refresh stays authoritative');
assert.equal(detailClears, 1, 'unselected Pack continues to clear stale details');
apples[0].events.click();
apples[1].events['hobunji-controller-focus']();
assert.equal(selectedItems[0][0], 'apple');
assert.equal(selectedItems[0][1], false, 'click selects a stack');
assert.equal(selectedItems[1][1], true, 'controller focus previews without selecting');
assert.equal(selectedItems[1][2].stackId, 'apple|plain|1', 'controller focus preserves exact stack variant');

searchKey = 'fish';
build.render();
assert.equal(gridInserts, 2, 'search rebuild still batches into one insertion');
assert.deepEqual(grid.children.filter(node => node.className === 'inv-item-box').map(node => node.dataset.key), ['fish']);
build.close();
build.render();
assert.equal(gridInserts, 2, 'closed menu never mutates Pack DOM');

const scheduleStart = uiSource.indexOf('  function scheduleMenuReadability(');
const scheduleEnd = uiSource.indexOf('  function enforceMenuReadability(', scheduleStart);
assert(scheduleStart >= 0 && scheduleEnd > scheduleStart, 'readability scheduler extraction points exist');
const frames = []; // Simulated animation frames confirm multiple mutations schedule just one refresh.
const requests = []; // Captured scopes ensure Pack mutations do not request an entire-menu walk.
const scheduling = new Function('bridge', `
  let menuReadabilityQueued = false, menuReadabilityFullScan = false;
  const menuReadabilityScopes = new Set();
  const MENU_READABILITY_ROOTS = '#menuPanel, #houseLayoutModal';
  const requestAnimationFrame = callback => bridge.frames.push(callback);
  const enforceMenuReadability = scopes => bridge.requests.push(scopes);
  ${uiSource.slice(scheduleStart, scheduleEnd)}
  return scheduleMenuReadability;
`)({ frames, requests });
const changedTile = { nodeType: 1, closest: () => ({ id: 'menuPanel' }) }; // A Pack tile inside the menu.
for (let i = 0; i < 100; i++) scheduling(changedTile);
assert.equal(frames.length, 1, '100 updates schedule one readability animation frame');
frames.shift()();
assert.deepEqual(requests[0], [changedTile], 'readability receives only the dirty inventory subtree');
scheduling();
frames.shift()();
assert.equal(requests[1], null, 'explicit full refresh retains the original whole-menu behavior');
console.log('PASS inventory: batched Pack DOM, badges, stack identity, icon hooks, filter, hidden gate, and scoped readability');
