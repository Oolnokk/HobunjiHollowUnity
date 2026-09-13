#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const inventory = { wheelA: 1, wheelB: 1, offArch: 1, offArchB: 1 }; // Used to keep two normal arch items beside two Hold-only items.
let manualHeldItem = null; // Used to mirror game.js's manualHeldItem slot.
let activeItemIndex = 0; // Used as the real game-side item index that getActiveInventoryItem ultimately reads.
let heldMode = 'tool'; // Used to prove Inventory Hold replaces a weapon/tool as well as another bag item.
let clickHandler = null; // Used to run the bridge's inventory Hold capture listener without a browser.
let actionDeps = null; // Used to inspect and drive the wrapped dependency bag ActionArcUI receives.
const timerQueue = []; // Used to preserve the real click ordering: capture -> button onclick -> zero-delay bridge sync.
let refreshCount = 0; // Used to prove Hold requests an immediate visible HUD/action refresh.

const itemFor = key => ({ key, icon: key === 'offArch' ? '🪨' : key === 'offArchB' ? '📕' : '🍎', label: key });
const windowStub = {
  ItemProcessing: {
    isWheelEligible(key) { return key === 'wheelA' || key === 'wheelB'; },
  },
  EquipmentPanel: { init() {} },
  ActionArcUI: { init(deps) { actionDeps = deps; } },
  HudUpdate: { init() {}, refreshItemScroll() { refreshCount++; } },
};

function getInventoryStackItems() {
  return Object.keys(inventory)
    .filter(windowStub.ItemProcessing.isWheelEligible)
    .map(itemFor);
}

function getActiveKey() {
  return getInventoryStackItems()[activeItemIndex]?.key || null;
}

function cycleActiveInventoryItem(dir) {
  const stacks = getInventoryStackItems();
  if (!stacks.length) { activeItemIndex = 0; return null; }
  activeItemIndex = (activeItemIndex + (dir < 0 ? -1 : 1) + stacks.length) % stacks.length;
  return stacks[activeItemIndex];
}

const documentStub = {
  addEventListener(type, fn) { if (type === 'click') clickHandler = fn; },
};
const context = vm.createContext({
  window: windowStub,
  document: documentStub,
  console,
  setTimeout(fn) { timerQueue.push(fn); return timerQueue.length; },
  queueMicrotask(fn) { fn(); },
});
vm.runInContext(fs.readFileSync('docs/js/inventory-held-override.js', 'utf8'), context, { filename: 'inventory-held-override.js' });

windowStub.EquipmentPanel.init({
  inventory,
  getManualHeldItem: () => manualHeldItem,
  setManualHeldItem: value => { manualHeldItem = value; },
});
windowStub.ActionArcUI.init({
  getInventoryStackItems,
  getActiveItemIndex: () => activeItemIndex,
  setActiveItemIndex: value => { activeItemIndex = value; },
  getHeldMode: () => heldMode,
  setHeldMode: value => { heldMode = value; },
  cycleActiveInventoryItem,
  putAwayHeldEquipment: () => { heldMode = 'none'; },
  refreshActionBar: () => { refreshCount++; },
});
windowStub.HudUpdate.init({ cycleActiveInventoryItem });

function runTimers() {
  while (timerQueue.length) timerQueue.shift()();
}

function clickHold(text, mutateManualHeldItem) {
  const button = {
    textContent: text,
    closest(selector) {
      if (selector === '#iiActions button') return this;
      if (selector === '#mpInventory') return {};
      return null;
    },
  };
  assert.equal(typeof clickHandler, 'function', 'inventory Hold click bridge is installed');
  clickHandler({ target: button });
  mutateManualHeldItem(); // Mirrors game.js's Hold button onclick, which runs after the capture listener.
  runTimers();
}

assert.equal(windowStub.ItemProcessing.isWheelEligible('offArch'), false, 'Hold-only item remains directly ineligible for the visible item arch');
clickHold('✋ Hold', () => { manualHeldItem = { kind: 'bagItem', key: 'offArch' }; });
assert.equal(heldMode, 'item', 'Inventory Hold switches away from an equipped weapon/tool into item mode');
assert.equal(getActiveKey(), 'offArch', 'Inventory Hold makes the off-arch item the real active bag item');
assert.equal(windowStub.InventoryHeldOverride.getDebug().activeResolvedKey, 'offArch', 'mobile debug reports the actual held override');
assert.deepEqual(actionDeps.getInventoryStackItems().map(item => item.key), ['wheelA', 'wheelB'], 'the manually held item still does not appear in the selection arch');
assert.equal(windowStub.ItemProcessing.isWheelEligible('offArch'), false, 'Inventory detail still sees the item as off-arch so Holding — Stop remains renderable');
assert(refreshCount > 0, 'Inventory Hold refreshes visible held-item UI immediately');

actionDeps.cycleActiveInventoryItem(1);
assert.equal(manualHeldItem, null, 'cycling the real item arch relinquishes the manual Hold override');
assert.equal(getActiveKey(), 'wheelB', 'normal item cycling resumes from the wheel item selected before Inventory Hold');
assert.equal(heldMode, 'item', 'returning to the item arch stays in item mode');

clickHold('✋ Hold', () => { manualHeldItem = { kind: 'bagItem', key: 'offArch' }; });
clickHold('✋ Hold', () => { manualHeldItem = { kind: 'bagItem', key: 'offArchB' }; });
assert.equal(getActiveKey(), 'offArchB', 'pressing Hold on a second off-arch item replaces the first held override');
clickHold('✋ Holding — Stop', () => { manualHeldItem = null; });
assert.equal(getActiveKey(), 'wheelB', 'Stopping Hold restores the wheel item that was active before the override');
assert.equal(heldMode, 'item', 'Stopping a Hold started from an item restores item mode');

heldMode = 'tool';
clickHold('✋ Hold', () => { manualHeldItem = { kind: 'bagItem', key: 'offArch' }; });
assert.equal(heldMode, 'item', 'Hold from weapon/tool mode visibly switches to the item');
actionDeps.setHeldMode('tool');
assert.equal(manualHeldItem, null, 'switching back to a tool clears the manual item override');
assert.equal(heldMode, 'tool', 'tool selection takes control back normally');
assert.equal(getActiveKey(), 'wheelB', 'tool selection does not corrupt the remembered item-arch selection');

console.log('inventory held override tests passed');
