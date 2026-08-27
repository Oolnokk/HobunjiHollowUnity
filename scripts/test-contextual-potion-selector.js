#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');

class FakeClassList {
  constructor(tokens = []) { this.tokens = new Set(tokens); }
  contains(token) { return this.tokens.has(token); }
  add(token) { this.tokens.add(token); }
  remove(token) { this.tokens.delete(token); }
  toggle(token, force) { if (force === false) this.tokens.delete(token); else if (force === true || !this.tokens.has(token)) this.tokens.add(token); else this.tokens.delete(token); }
}

class FakeSlot {
  constructor(entry, active = false) {
    this.entry = entry;
    this.dataset = {};
    this.title = entry.label || '';
    this.textContent = entry.label || '';
    this.classList = new FakeClassList([...(entry.className || '').split(/\s+/).filter(Boolean), ...(entry.disabled ? ['blocked'] : []), ...(active ? ['arc-active'] : [])]);
  }
  getAttribute(name) { return name === 'aria-label' ? (this.entry.label || '') : null; }
  querySelector(selector) { return selector === '.arc-label' ? { textContent:this.entry.label || '' } : null; }
}

let slots = []; // Current fake shared-arch DOM.
let mode = null; // Current fake game.js selector mode.
let activeIndex = -1; // Highlighted slot in the current selector.
let inventoryIndex = 0; // Authoritative ordinary-item index; starts on Control Remedy.
let heldMode = 'tool'; // Mirrors game.js heldMode.
let heldItemKey = null; // Exact ordinary item key committed by the fake game.js path.
let heldItemLabel = null; // Friendly label for assertions/debug.
let activeCombatSlot = 'ranged'; // Exact combat slot Potion Select must restore.
let weaponSwitchClicks = 0; // Confirms restoration uses the real quick-switch seam.
const listeners = new Map(); // Minimal CustomEvent bus.
const injectedNodes = new Map(); // Minimal style-node registry for the selector's spacer CSS.
const itemName = { textContent:'Potion of Strength' }; // Deliberately stale: reproduces the old wrong-item bug.

function syncActive() {
  slots.forEach((slot, index) => slot.classList.toggle('arc-active', index === activeIndex));
}

function renderEntries(nextMode, entries, rawMode = false) {
  mode = rawMode ? nextMode : `entries:${nextMode}`;
  activeIndex = entries.findIndex(entry => entry.active);
  if (activeIndex < 0 && entries.length) activeIndex = Math.floor((entries.length - 1) / 2);
  slots = entries.map((entry, index) => new FakeSlot(entry, index === activeIndex));
}

const defs = {
  control:{ id:'control', label:'Control Remedy', icon:'🪨' },
  heal:{ id:'heal', label:'Healing Potion', icon:'💚' },
  stamina:{ id:'stamina', label:'Stamina Potion', icon:'💨' },
  clarity:{ id:'clarity', label:'Potion of Clarity', icon:'👁️' },
  strength:{ id:'strength', label:'Potion of Strength', icon:'💪' },
  speed:{ id:'speed', label:'Potion of Speed', icon:'🏃' },
  venom:{ id:'venom', label:'Venom Flask', icon:'☠️' },
};
const control = { itemKey:'alchemy_control_p0', payload:{recipeId:'control',potencyTier:0}, recipe:defs.control, count:1 };
const healing = { itemKey:'alchemy_heal_p0', payload:{recipeId:'heal',potencyTier:0}, recipe:defs.heal, count:2, score:100 };
const stamina = { itemKey:'alchemy_stamina_p1', payload:{recipeId:'stamina',potencyTier:1}, recipe:defs.stamina, count:1, score:40 };
const clarity = { itemKey:'alchemy_clarity_p0', payload:{recipeId:'clarity',potencyTier:0}, recipe:defs.clarity, count:1, score:50 };
const strength = { itemKey:'alchemy_strength_p0', payload:{recipeId:'strength',potencyTier:0}, recipe:defs.strength, count:1 };
const speed = { itemKey:'alchemy_speed_p0', payload:{recipeId:'speed',potencyTier:0}, recipe:defs.speed, count:1 };
const venom = { itemKey:'alchemy_venom_p0', payload:{recipeId:'venom',potencyTier:0}, recipe:defs.venom, count:3 };
const allItems = [control, healing, strength, speed, clarity, stamina, venom];

function itemLabel(entry) {
  const tier = Math.max(0, Math.min(4, Number(entry.payload?.potencyTier) || 0));
  return `${entry.recipe.label}${tier ? ` · Potency ${tier + 1}` : ''}`;
}

function equipExact(entry) {
  heldMode = 'item';
  heldItemKey = entry.itemKey;
  heldItemLabel = itemLabel(entry);
}

let contextual = [healing, stamina]; // New root's useful restoratives.
let buffs = [strength, speed]; // New/legacy Buff list.
let flasks = [venom]; // New/legacy Flask list.
let cures = [clarity]; // Legacy exact-key Cure list used when Clarity is contextual.
let healingUseful = [healing]; // Legacy exact-key Healing list.

function categoryState() {
  return {
    healing:{ usefulItems:healingUseful },
    cures:{ usefulItems:cures },
    buffs:{ items:buffs, usefulItems:buffs },
    flasks:{ items:flasks },
  };
}

function openLegacyPotionItems(category) {
  const state = categoryState();
  const raw = category === 'healing' ? state.healing.usefulItems
    : category === 'cures' ? state.cures.usefulItems
      : category === 'buffs' ? state.buffs.items : state.flasks.items;
  const itemEntries = raw.map(entry => ({ id:entry.itemKey, label:itemLabel(entry), itemKey:entry.itemKey, disabled:false, onSelect:() => equipExact(entry) }));
  const cancel = { id:`cancel-${category}`, label:'Cancel', active:true, disabled:false, onSelect:() => arc.close() };
  const entries = category === 'healing' || category === 'buffs' ? [cancel, ...itemEntries] : [...itemEntries, cancel];
  renderEntries(`entries:potion-items-${category}`, entries, true);
}

function renderItemArc() {
  mode = 'item';
  slots = allItems.map((entry, index) => new FakeSlot({ label:itemLabel(entry), itemKey:entry.itemKey, type:'item' }, index === inventoryIndex));
  activeIndex = inventoryIndex;
}

const arc = {
  openEntries(nextMode, entries) { renderEntries(nextMode, entries); },
  openPotions() { renderEntries('entries:potion-root', [{id:'medicine',label:'Medicine'},{id:'utility',label:'Utility'}], true); },
  scrollEntries(dir) {
    if (mode === 'entries:potion-root') {
      renderEntries(dir < 0 ? 'entries:potion-medicine' : 'entries:potion-utility', [], true);
      return true;
    }
    if (mode === 'entries:potion-medicine' || mode === 'entries:potion-utility') {
      const category = mode.endsWith('medicine') ? (dir < 0 ? 'healing' : 'cures') : (dir < 0 ? 'buffs' : 'flasks');
      openLegacyPotionItems(category);
      return true;
    }
    if (!slots.length) return false;
    const delta = dir < 0 ? -1 : 1;
    if (mode?.startsWith('entries:potion-items-')) activeIndex = Math.max(0, Math.min(slots.length - 1, activeIndex + delta));
    else activeIndex = (activeIndex + delta + slots.length) % slots.length;
    syncActive();
    return true;
  },
  movePointer() { return true; },
  releaseSelection() { return this.commit(); },
  commit() {
    if (mode === 'item') {
      equipExact(allItems[inventoryIndex]);
      this.close();
      return true;
    }
    const slot = slots[activeIndex];
    if (!slot || slot.entry.disabled) { this.close(); return false; }
    const previousMode = mode;
    slot.entry.onSelect?.();
    if (mode === previousMode) this.close();
    return true;
  },
  close() { mode = null; slots = []; activeIndex = -1; },
  openItem() { renderItemArc(); },
  scrollItem(dir) {
    inventoryIndex = (inventoryIndex + (dir < 0 ? -1 : 1) + allItems.length) % allItems.length;
    renderItemArc(); // Deliberately does NOT update #itemName; active arc slot is authoritative.
    return true;
  },
  beginHeldSelection() {}, endHeldSelection() {}, heldSelectionKind() { return 'potions'; },
  entryMenuOpen() { return mode?.startsWith('entries:') || false; },
};

const weaponSwitchButton = {
  click() {
    weaponSwitchClicks++;
    if (heldMode === 'item') {
      heldMode = 'tool';
      activeCombatSlot = 'weapon';
      return;
    }
    activeCombatSlot = activeCombatSlot === 'weapon' ? 'ranged' : 'weapon';
  },
};

const fakeHead = { appendChild(node) { if (node?.id) injectedNodes.set(node.id, node); } };
const fakeBody = { appendChild(node) { if (node?.id) injectedNodes.set(node.id, node); } };
global.document = {
  head:fakeHead, body:fakeBody,
  querySelector(selector) { return selector.includes('.arc-active') ? slots.find(slot => slot.classList.contains('arc-active')) || null : null; },
  querySelectorAll(selector) {
    if (selector.startsWith('.arc-slot')) return slots;
    if (selector.startsWith('#btnAction')) return [];
    return [];
  },
  getElementById(id) { return id === 'itemName' ? itemName : id === 'btnWeaponSwitch' ? weaponSwitchButton : injectedNodes.get(id) || null; },
  createElement() { return { id:'', textContent:'', style:{}, classList:new FakeClassList() }; },
  addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(listener); },
  dispatchEvent(event) { for (const listener of listeners.get(event.type) || []) listener(event); },
};
global.CustomEvent = class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } };
global.window = {
  _desktopSelectionArc:arc,
  SharedSelectionArch:arc,
  WeaponToolStances:{ debugSnapshot:() => ({ activeSlot:activeCombatSlot }) },
};
window.AlchemySystem = {
  RECIPE_DEFS:defs,
  POTION_ITEMS:Object.fromEntries(allItems.map(entry => [entry.itemKey, entry.payload])),
  parseBrewedItemKey:key => window.AlchemySystem.POTION_ITEMS[key] || null,
  contextualRestoratives:() => contextual,
  potionCategoryState:() => categoryState(),
  drinkPotion:itemKey => ({ ok:true, itemKey }),
};

require(path.join(__dirname, '..', 'docs/js/mobile-potion-category-drag.js'));
const selector = window._desktopSelectionArc;
const debug = () => window.ContextualPotionSelector.diagnostics();

// Reproduce the reported bug: HUD text claims Strength while the underlying
// ordinary item index is Control Remedy. Exact-key routing must ignore it.
contextual = [];
buffs = [strength, speed];
flasks = [];
inventoryIndex = 0;
itemName.textContent = 'Potion of Strength';
selector.openPotions();
assert.deepStrictEqual(debug().rootOrder, ['Buffs', 'Cancel'], 'Buffs-only root must keep centered Cancel');
selector.scrollEntries(-1); // Enter Buffs.
selector.scrollEntries(-1); // Strength is nearest Cancel after display reversal.
assert.strictEqual(debug().active, 'Potion of Strength ×1', 'Strength must be the highlighted buff');
selector.releaseSelection();
assert.strictEqual(heldItemKey, strength.itemKey, 'Strength selection must equip Strength, never stale Control Remedy');
assert.strictEqual(debug().lastSelection.commitPath, 'legacy-exact', 'buffs must use game.js exact-key potion callback');
assert.strictEqual(debug().lastSelection.itemKey, strength.itemKey, 'diagnostics must report the exact selected Strength key');

// Speed is the next buff farther counterclockwise and must resolve independently.
selector.openPotions();
selector.scrollEntries(-1);
selector.scrollEntries(-1);
selector.scrollEntries(-1);
assert.strictEqual(debug().active, 'Potion of Speed ×1', 'Speed must be independently highlightable');
selector.releaseSelection();
assert.strictEqual(heldItemKey, speed.itemKey, 'Speed selection must equip the exact Speed key');
assert.strictEqual(debug().lastSelection.commitPath, 'legacy-exact', 'Speed must use exact-key routing');

// Clarity is a contextual Cure, not a buff. It uses the legacy Cures list's
// private _selectHeldInventoryKey callback and must not fall onto Control Remedy.
contextual = [clarity];
buffs = [];
flasks = [];
cures = [clarity];
inventoryIndex = 0;
itemName.textContent = 'Potion of Clarity';
selector.openPotions();
selector.scrollEntries(-1);
assert.strictEqual(debug().active, 'Potion of Clarity ×1', 'Clarity must be highlighted from contextual medicine');
selector.releaseSelection();
assert.strictEqual(heldItemKey, clarity.itemKey, 'Clarity selection must equip Clarity, never Control Remedy');
assert.strictEqual(debug().lastSelection.commitPath, 'legacy-exact', 'Cures must use exact-key routing');

// Stamina is contextual Restore but not represented in the old Healing/Cures
// hierarchy. Its fallback must inspect the actual active item-arc slot rather
// than stale #itemName; start underlying selection on Control Remedy again.
contextual = [stamina];
cures = [];
inventoryIndex = 0;
itemName.textContent = 'Stamina Potion · Potency 2';
selector.openPotions();
selector.scrollEntries(-1);
selector.releaseSelection();
assert.strictEqual(heldItemKey, stamina.itemKey, 'Stamina fallback must cycle to the real Stamina stack despite stale HUD text');
assert.strictEqual(debug().lastSelection.commitPath, 'item-arc', 'non-legacy resource restoratives must use the active item-arc fallback');

// Temporary item handoff still restores the exact prior combat slot after use.
window.AlchemySystem.drinkPotion(stamina.itemKey);
assert.strictEqual(heldMode, 'tool', 'successful drinking must leave temporary item mode');
assert.strictEqual(activeCombatSlot, 'ranged', 'successful drinking must restore the exact prior ranged slot');
assert.strictEqual(debug().lastRestore.ok, true, 'restoration must remain visible in diagnostics');

// Flask exact-key routing and post-release restoration remain intact.
contextual = [];
flasks = [venom];
selector.openPotions();
selector.scrollEntries(1);
selector.scrollEntries(1);
selector.releaseSelection();
assert.strictEqual(heldItemKey, venom.itemKey, 'Flask selection must equip the exact Flask key');
assert.strictEqual(debug().lastSelection.commitPath, 'legacy-exact', 'Flasks must use exact-key routing');
document.dispatchEvent(new CustomEvent('hobunji-alchemy-change', { detail:{ type:'flask-release', itemKey:venom.itemKey } }));
assert.strictEqual(activeCombatSlot, 'ranged', 'flask release must restore prior ranged slot');

// No-useful-medicine layouts retain centered/default Cancel and omit stale hierarchy labels.
contextual = [];
buffs = [];
flasks = [];
selector.openPotions();
assert.deepStrictEqual(debug().rootOrder, ['Cancel'], 'no useful medicine or utility must show only Cancel');
assert.strictEqual(debug().active, 'Cancel', 'empty selector must default to Cancel');
selector.scrollEntries(-1);
assert.strictEqual(debug().active, 'Cancel', 'empty counterclockwise side must bounce to Cancel');
selector.scrollEntries(1);
assert.strictEqual(debug().active, 'Cancel', 'empty clockwise side must bounce to Cancel');
assert.ok(!debug().rootOrder.some(label => /medicine|utility/i.test(label)), 'legacy Medicine/Utility labels must not leak into contextual root diagnostics');
selector.releaseSelection();

assert.ok(weaponSwitchClicks >= 2, 'restoration must use the existing weapon quick-switch path');
assert.strictEqual(debug().mode, 'hold-scroll-contextual', 'diagnostics must identify contextual selector mode');
console.log('Contextual potion selector exact-key tests passed.');
