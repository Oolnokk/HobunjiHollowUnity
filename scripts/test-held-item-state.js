'use strict';
const assert = require('node:assert/strict'); // Used for focused state and immutability regression checks.
const fs = require('node:fs'); // Used to load the held-state module and loader source under test.
const vm = require('node:vm'); // Used to run the browser module against deterministic fake window/document objects.

const moduleSource = fs.readFileSync('docs/js/held-item-state.js', 'utf8'); // Exact module source executed below.
const loaderSource = fs.readFileSync('docs/js/combat/combat-config-loader.js', 'utf8'); // Parser bootstrap checked for safe load order and unsafe-bridge removal.
const inventory = { gold: 73, combatManualCounterShield: 2, apple: 5 }; // Representative world-member inventory that must remain byte-for-byte unchanged by Hold selection.
const saveMeta = { worlds: [{ id: 'world_1', members: { char_1: { nonGearInventory: inventory } } }] }; // Realistic save graph sharing the inventory object the game would persist.
const inventoryBefore = JSON.stringify(inventory); // Baseline proving Hold never edits stack counts.
const saveBefore = JSON.stringify(saveMeta); // Baseline proving Hold never edits the containing world/member save graph.
const itemDefs = { // Canonical metadata used only for held-item resolution/labels.
  combatManualCounterShield: { key: 'combatManualCounterShield', label: 'Counter Shield Combat Manual', icon: '📕' },
  apple: { key: 'apple', label: 'Apple', icon: '🍎' },
};
const gearInventory = { clothingItems: [{ uid: 'cloth_1', label: 'Red Poncho', slot: 'overwear' }] }; // Clothing collection used to verify non-bag manual Hold behavior.
let manualHeldItem = null; // Existing game.js selector changed only through its canonical setter/clear functions.
let heldMode = 'tool'; // Existing ordinary held mode used to prove Hold actually puts away a weapon/tool.
let activeItemIndex = 1; // Existing item-arch selection that must not be overwritten by off-arch Hold.
let saveCalls = 0; // Persistence spy that must remain zero for every selection-only operation.
let putAwayCalls = 0; // Canonical dequip spy proving manual Hold replaces ordinary held equipment.
let intervalCallback = null; // Captures the synchronizer callback without starting a real timer in the test process.
const listeners = {}; // Captures document listeners so the Z put-away path can be exercised directly.
const toastLog = []; // Visible feedback spy used to confirm activation is surfaced to mobile players.
const capturedInitDeps = {}; // Records forwarded module init bags, especially NpcGifting's held-item resolver.

function moduleStub(name) {
  return {
    init(injectedDeps) {
      capturedInitDeps[name] = injectedDeps;
    },
  };
}

const windowStub = { // Minimal browser global containing the parser-loaded modules the bridge binds to.
  ActionArcUI: moduleStub('ActionArcUI'),
  HudUpdate: { ...moduleStub('HudUpdate'), refreshItemScroll() {} },
  EquipmentPanel: moduleStub('EquipmentPanel'),
  NpcGifting: moduleStub('NpcGifting'),
  setInterval(callback) { intervalCallback = callback; return 1; },
};
const documentStub = { // Minimal document surface needed for the Z-key safety listener.
  addEventListener(type, callback) { listeners[type] = callback; },
};
const context = vm.createContext({ window: windowStub, document: documentStub, console, Date, Math, setTimeout, clearTimeout }); // Browser-like execution context for the IIFE.
vm.runInContext(moduleSource, context, { filename: 'held-item-state.js' });

const sharedDeps = { // Canonical state controls/registries shared by the game modules in this focused fixture.
  inventory,
  ITEM_DEFS: itemDefs,
  getManualHeldItem: () => manualHeldItem,
  setManualHeldItem: value => { manualHeldItem = value; },
  clearManualHeldItem: () => { manualHeldItem = null; },
  getGearInventory: () => gearInventory,
  getPackClothing: () => [],
  getHeldMode: () => heldMode,
  getActiveItemIndex: () => activeItemIndex,
  getActiveInventoryItem: () => itemDefs.apple,
  putAwayHeldEquipment: () => { putAwayCalls++; heldMode = 'none'; },
  refreshActionBar() {},
  showToast: message => { toastLog.push(message); },
  saveMemberWorldData: () => { saveCalls++; },
};
windowStub.ActionArcUI.init(sharedDeps);
windowStub.HudUpdate.init(sharedDeps);
windowStub.EquipmentPanel.init(sharedDeps);
windowStub.NpcGifting.init({ ...sharedDeps, getHeldGiftItem: () => ({ kind: 'bagItem', key: 'apple', def: itemDefs.apple }) });

assert.equal(typeof intervalCallback, 'function', 'bridge should install one low-frequency synchronizer');
assert.equal(windowStub.HobunjiHeldItemState.version, 1, 'bridge should expose a versioned debug/test API');

manualHeldItem = { kind: 'bagItem', key: 'combatManualCounterShield' };
windowStub.HobunjiHeldItemState.syncNow();
assert.equal(heldMode, 'none', 'manual Hold should put away the currently equipped tool/weapon');
assert.equal(putAwayCalls, 1, 'manual Hold should use the canonical put-away function exactly once on activation');
assert.equal(activeItemIndex, 1, 'manual Hold must not move the ordinary item-arch selection');
assert.equal(windowStub.HobunjiHeldItemState.getManualBagItem().key, 'combatManualCounterShield', 'manual bag resolver should expose the held off-arch key');
assert.equal(capturedInitDeps.NpcGifting.getHeldGiftItem().key, 'combatManualCounterShield', 'gifting should resolve manual Hold before the ordinary wheel item');
assert.equal(JSON.stringify(inventory), inventoryBefore, 'manual Hold must not mutate inventory counts');
assert.equal(JSON.stringify(saveMeta), saveBefore, 'manual Hold must not mutate the world/member save graph');
assert.equal(saveCalls, 0, 'manual Hold selection must never invoke persistence');
assert.match(toastLog.at(-1) || '', /Holding Counter Shield Combat Manual/, 'manual Hold should provide visible mobile feedback');

heldMode = 'item';
windowStub.HobunjiHeldItemState.syncNow();
assert.equal(manualHeldItem, null, 'drawing an ordinary wheel item should replace and clear manual Hold');
assert.equal(activeItemIndex, 1, 'clearing manual Hold after an ordinary selection must preserve the wheel index');
assert.equal(JSON.stringify(saveMeta), saveBefore, 'ordinary-selection handoff must still leave the save graph untouched');
assert.equal(saveCalls, 0, 'ordinary-selection handoff must not save');

heldMode = 'tool';
manualHeldItem = { kind: 'clothing', uid: 'cloth_1' };
windowStub.HobunjiHeldItemState.syncNow();
assert.equal(heldMode, 'none', 'holding clothing should also put away ordinary equipment');
assert.equal(windowStub.HobunjiHeldItemState.getManualHeldThing().uid, 'cloth_1', 'clothing Hold should resolve the exact owned instance');
assert.equal(capturedInitDeps.NpcGifting.getHeldGiftItem().instance.uid, 'cloth_1', 'gifting should receive the exact manually held clothing instance');
assert.equal(JSON.stringify(saveMeta), saveBefore, 'clothing Hold must not mutate save data');

listeners.keydown({ key: 'z', target: { tagName: 'BODY', isContentEditable: false } });
assert.equal(manualHeldItem, null, 'Z should put away a manual held item even though ordinary heldMode is already none');
assert.equal(saveCalls, 0, 'Z manual put-away must not save');

heldMode = 'none';
manualHeldItem = { kind: 'bagItem', key: 'combatManualCounterShield' };
windowStub.HobunjiHeldItemState.syncNow();
activeItemIndex = 0;
windowStub.HobunjiHeldItemState.syncNow();
assert.equal(manualHeldItem, null, 'explicit item-arch navigation should replace manual Hold even while hands-free');
assert.equal(saveCalls, 0, 'item-index handoff must not save');

manualHeldItem = { kind: 'bagItem', key: 'missingOrEmpty' };
windowStub.HobunjiHeldItemState.syncNow();
assert.equal(manualHeldItem, null, 'stale/empty manual bag references should clear themselves safely');
assert.equal(JSON.stringify(inventory), inventoryBefore, 'stale cleanup must not create, delete, or reseed inventory stacks');
assert.equal(JSON.stringify(saveMeta), saveBefore, 'stale cleanup must not alter save data');
assert.equal(saveCalls, 0, 'stale cleanup must not save');

const sourceBans = [ // Forbidden mechanisms from the unsafe implementation and the known starter-inventory failure path.
  /STARTING_INVENTORY/,
  /localStorage\.setItem/,
  /getInventoryStackItems\?\.\(/,
  /isWheelEligible/,
  /saveMemberWorldData\s*\(/,
];
for (const pattern of sourceBans) assert.doesNotMatch(moduleSource, pattern, `held-state bridge must not use ${pattern}`);

const heldModuleIndex = loaderSource.indexOf('js/held-item-state.js?v=20260913safe1'); // Position of the new canonical-state coordinator in parser load order.
const giftingModuleIndex = loaderSource.indexOf('js/npc-gifting.js?v=20260831a'); // Position of NpcGifting, which must exist before its init can be wrapped.
assert(heldModuleIndex > giftingModuleIndex, 'held-item-state must load after NpcGifting is defined');
assert.doesNotMatch(loaderSource, /inventory-held-override\.js/, 'unsafe inventory-held-override must stay absent from the runtime loader');

console.log('held-item-state regression: PASS');
