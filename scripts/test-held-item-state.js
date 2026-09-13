'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const moduleSource = fs.readFileSync('docs/js/held-item-state.js', 'utf8');
const loaderSource = fs.readFileSync('docs/js/combat/combat-config-loader.js', 'utf8');

const inventory = { gold: 73, combatManualCounterShield: 2, apple: 5 };
const saveMeta = { worlds: [{ id: 'world_1', members: { char_1: { nonGearInventory: inventory } } }] };
const inventoryBefore = JSON.stringify(inventory);
const saveBefore = JSON.stringify(saveMeta);
const itemDefs = {
  combatManualCounterShield: { key: 'combatManualCounterShield', label: 'Counter Shield Combat Manual', icon: '📕' },
  apple: { key: 'apple', label: 'Apple', icon: '🍎' },
};
const inventoryItems = [itemDefs.apple, itemDefs.combatManualCounterShield];
const gearInventory = { clothingItems: [{ uid: 'cloth_1', label: 'Red Poncho', slot: 'overwear' }] };

let manualHeldItem = null;
let heldMode = 'tool';
let activeItemIndex = 0;
let saveCalls = 0;
let putAwayCalls = 0;
let intervalCallback = null;
const listeners = {};
const toastLog = [];
const capturedInitDeps = {};

function moduleStub(name) {
  return {
    init(injectedDeps) {
      capturedInitDeps[name] = injectedDeps;
    },
  };
}

const windowStub = {
  // Canonical eligibility excludes combat manuals from the ordinary item arch.
  // getInventoryStackItems() below intentionally calls this from Array.filter
  // with the same (item, sourceArray) trailing arguments used by game.js.
  ItemProcessing: {
    isWheelEligible(key) { return key === 'apple'; },
  },
  ActionArcUI: moduleStub('ActionArcUI'),
  HudUpdate: { ...moduleStub('HudUpdate'), refreshItemScroll() {} },
  EquipmentPanel: moduleStub('EquipmentPanel'),
  NpcGifting: moduleStub('NpcGifting'),
  setInterval(callback) { intervalCallback = callback; return 1; },
};
const documentStub = {
  addEventListener(type, callback) { listeners[type] = callback; },
};
const context = vm.createContext({ window: windowStub, document: documentStub, console, Date, Math, setTimeout, clearTimeout, queueMicrotask });
vm.runInContext(moduleSource, context, { filename: 'held-item-state.js' });

function getInventoryStackItems() {
  return inventoryItems.filter((item, index, source) =>
    (inventory[item.key] || 0) > 0 && windowStub.ItemProcessing.isWheelEligible(item.key, item, source));
}
function getActiveInventoryItem() {
  const stacks = getInventoryStackItems();
  if (!stacks.length) { activeItemIndex = 0; return null; }
  if (activeItemIndex >= stacks.length) activeItemIndex = 0;
  if (activeItemIndex < 0) activeItemIndex = stacks.length - 1;
  return stacks[activeItemIndex];
}
function setActiveItemIndex(index) { activeItemIndex = Number(index) || 0; }
function setHeldMode(mode) { heldMode = mode; }
function cycleActiveInventoryItem(dir) {
  const stacks = getInventoryStackItems();
  if (!stacks.length) { activeItemIndex = 0; return null; }
  activeItemIndex = (activeItemIndex + (dir < 0 ? -1 : 1) + stacks.length) % stacks.length;
  heldMode = 'item';
  return getActiveInventoryItem();
}
function putAwayHeldEquipment() { putAwayCalls++; heldMode = 'none'; }

const sharedDeps = {
  inventory,
  ITEM_DEFS: itemDefs,
  getManualHeldItem: () => manualHeldItem,
  setManualHeldItem: value => { manualHeldItem = value; },
  clearManualHeldItem: () => { manualHeldItem = null; },
  getGearInventory: () => gearInventory,
  getPackClothing: () => [],
  getHeldMode: () => heldMode,
  setHeldMode,
  getActiveItemIndex: () => activeItemIndex,
  setActiveItemIndex,
  getInventoryStackItems,
  getActiveInventoryItem,
  cycleActiveInventoryItem,
  putAwayHeldEquipment,
  refreshActionBar() {},
  showToast: message => { toastLog.push(message); },
  saveMemberWorldData: () => { saveCalls++; },
};

windowStub.ActionArcUI.init(sharedDeps);
windowStub.HudUpdate.init(sharedDeps);
windowStub.EquipmentPanel.init(sharedDeps);
windowStub.NpcGifting.init({ ...sharedDeps, getHeldGiftItem: () => ({ kind: 'bagItem', key: 'apple', def: itemDefs.apple }) });

assert.equal(typeof intervalCallback, 'function', 'bridge should install one low-frequency synchronizer');
assert.equal(windowStub.HobunjiHeldItemState.version, 2, 'renderer projection should expose held-state API v2');
assert.deepEqual(getInventoryStackItems().map(item => item.key), ['apple'], 'manual-only item starts outside the canonical wheel');
assert.equal(windowStub.ItemProcessing.isWheelEligible('combatManualCounterShield'), false, 'ordinary eligibility query must still classify the manual as off-arch');

// Core regression: Hold must become the actual raw game-level held item so
// updateHeldItemHolder() can render it, without adding it to the visible arch.
manualHeldItem = { kind: 'bagItem', key: 'combatManualCounterShield' };
windowStub.HobunjiHeldItemState.syncNow();
assert.equal(heldMode, 'item', 'manual bag Hold should drive the real held mode used by the renderer');
assert.equal(getActiveInventoryItem()?.key, 'combatManualCounterShield', 'raw game resolver should resolve the manually held off-arch stack');
assert.equal(putAwayCalls, 1, 'manual Hold should canonically put away the old tool/weapon before projection');
assert.deepEqual(capturedInitDeps.ActionArcUI.getInventoryStackItems().map(item => item.key), ['apple'], 'visible item arch must keep the projected manual excluded');
assert.equal(capturedInitDeps.ActionArcUI.getActiveItemIndex(), 0, 'arch selection should still point at its pre-Hold ordinary item');
assert.deepEqual(capturedInitDeps.HudUpdate.getInventoryStackItems().map(item => item.key), ['apple'], 'HUD item scroll must also keep the projected manual excluded');
assert.equal(capturedInitDeps.HudUpdate.getActiveInventoryItem()?.key, 'combatManualCounterShield', 'held-item HUD resolver should describe the actual manual item');
assert.equal(windowStub.ItemProcessing.isWheelEligible('combatManualCounterShield'), false, 'Hold must not change ordinary one-argument wheel eligibility');
assert.equal(windowStub.HobunjiHeldItemState.getManualBagItem().key, 'combatManualCounterShield');
assert.equal(capturedInitDeps.NpcGifting.getHeldGiftItem().key, 'combatManualCounterShield', 'gifting should resolve manual Hold before ordinary wheel item');
assert.equal(JSON.stringify(inventory), inventoryBefore, 'manual Hold must not mutate inventory counts');
assert.equal(JSON.stringify(saveMeta), saveBefore, 'manual Hold must not mutate the world/member save graph');
assert.equal(saveCalls, 0, 'manual Hold selection must never invoke persistence');
assert.match(toastLog.at(-1) || '', /Holding Counter Shield Combat Manual/, 'manual Hold should provide visible mobile feedback');

// Selecting an ordinary arch item explicitly relinquishes manual Hold and maps
// the filtered arch index back to the canonical stack after projection ends.
capturedInitDeps.ActionArcUI.setActiveItemIndex(0);
assert.equal(manualHeldItem, null, 'ordinary arch selection should clear manual Hold');
assert.equal(getActiveInventoryItem()?.key, 'apple', 'ordinary selection should become the raw held item after manual projection ends');
assert.equal(activeItemIndex, 0, 'ordinary wheel index should map back correctly');
assert.equal(JSON.stringify(saveMeta), saveBefore, 'ordinary-selection handoff must leave save graph untouched');
assert.equal(saveCalls, 0);

// A direct ordinary tool-mode change outside the wrapped arch is also detected
// by the synchronizer and must not be overwritten by cleanup.
manualHeldItem = { kind: 'bagItem', key: 'combatManualCounterShield' };
windowStub.HobunjiHeldItemState.syncNow();
heldMode = 'tool';
windowStub.HobunjiHeldItemState.syncNow();
assert.equal(manualHeldItem, null, 'external tool selection should replace manual Hold');
assert.equal(heldMode, 'tool', 'cleanup must preserve the newer externally selected tool mode');
assert.equal(saveCalls, 0);

// A direct ordinary item-index change is likewise authoritative.
heldMode = 'none';
activeItemIndex = 0;
manualHeldItem = { kind: 'bagItem', key: 'combatManualCounterShield' };
windowStub.HobunjiHeldItemState.syncNow();
activeItemIndex = 0; // With projection active, index 0 is Apple instead of the manual at index 1.
windowStub.HobunjiHeldItemState.syncNow();
assert.equal(manualHeldItem, null, 'external ordinary item selection should clear manual Hold');
assert.equal(getActiveInventoryItem()?.key, 'apple');
assert.equal(saveCalls, 0);

// Pressing the same inventory Hold button again clears manualHeldItem first;
// sync must remove the projection, restore the prior wheel item, and leave hands free.
heldMode = 'tool';
activeItemIndex = 0;
manualHeldItem = { kind: 'bagItem', key: 'combatManualCounterShield' };
windowStub.HobunjiHeldItemState.syncNow();
manualHeldItem = null;
windowStub.HobunjiHeldItemState.syncNow();
assert.equal(heldMode, 'none', 'Holding — Stop should return to hands free');
assert.equal(getActiveInventoryItem()?.key, 'apple', 'Holding — Stop should restore the pre-Hold wheel selection');
assert.equal(saveCalls, 0);

// Clothing keeps its existing manual-held path; it still puts ordinary gear
// away but does not need the bag-stack projection.
heldMode = 'tool';
manualHeldItem = { kind: 'clothing', uid: 'cloth_1' };
windowStub.HobunjiHeldItemState.syncNow();
assert.equal(heldMode, 'none', 'holding clothing should put away ordinary equipment');
assert.equal(windowStub.HobunjiHeldItemState.getManualHeldThing().uid, 'cloth_1');
assert.equal(capturedInitDeps.NpcGifting.getHeldGiftItem().instance.uid, 'cloth_1');
assert.equal(JSON.stringify(saveMeta), saveBefore, 'clothing Hold must not mutate save data');

listeners.keydown({ key: 'z', target: { tagName: 'BODY', isContentEditable: false } });
assert.equal(manualHeldItem, null, 'Z should put away a manual held clothing item');
assert.equal(saveCalls, 0);

manualHeldItem = { kind: 'bagItem', key: 'missingOrEmpty' };
windowStub.HobunjiHeldItemState.syncNow();
assert.equal(manualHeldItem, null, 'stale/empty manual bag references should clear safely');
assert.equal(JSON.stringify(inventory), inventoryBefore, 'stale cleanup must not create/delete/reseed stacks');
assert.equal(JSON.stringify(saveMeta), saveBefore, 'stale cleanup must not alter save data');
assert.equal(saveCalls, 0);

const sourceBans = [
  /STARTING_INVENTORY/,
  /localStorage\.setItem/,
  /saveMemberWorldData\s*\(/,
  /Object\.defineProperty\s*\(\s*window/,
  /futureGlobal/,
];
for (const pattern of sourceBans) assert.doesNotMatch(moduleSource, pattern, `held-state bridge must not use ${pattern}`);
assert.match(moduleSource, /stackResolutionCall[\s\S]*projectionKey/, 'projection must be scoped specifically to stack resolution');
assert.match(moduleSource, /getInventoryStackItems:\s*archStacks/, 'ActionArcUI must receive the projection-filtered stack view');

const heldModuleIndex = loaderSource.indexOf('js/held-item-state.js?v=20260913safe1');
const giftingModuleIndex = loaderSource.indexOf('js/npc-gifting.js?v=20260831a');
assert(heldModuleIndex > giftingModuleIndex, 'held-item-state must load after NpcGifting is defined');
assert.doesNotMatch(loaderSource, /inventory-held-override\.js/, 'unsafe old bridge must stay absent from runtime loader');

console.log('held-item-state renderer projection regression: PASS');
