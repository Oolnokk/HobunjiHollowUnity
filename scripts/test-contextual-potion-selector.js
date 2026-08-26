#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');

class FakeClassList {
  constructor(tokens = []) { this.tokens = new Set(tokens); }
  contains(token) { return this.tokens.has(token); }
  add(token) { this.tokens.add(token); }
  remove(token) { this.tokens.delete(token); }
}

class FakeSlot {
  constructor(entry, active = false) {
    this.entry = entry;
    this.dataset = {};
    this.title = entry.label;
    this.classList = new FakeClassList([...(entry.className || '').split(/\s+/).filter(Boolean), ...(entry.disabled ? ['blocked'] : []), ...(active ? ['arc-active'] : [])]);
  }
  getAttribute(name) { return name === 'aria-label' ? this.entry.label : null; }
  querySelector() { return null; }
}

const itemName = { textContent: 'Pebble' }; // Mirrors the live selected-item label read by the selector bridge.
let slots = []; // Mirrors the currently rendered shared-arch slots for selector DOM queries.
let mode = null; // Tracks the fake shared arch mode so callback-driven transitions behave like game.js.
let activeIndex = -1; // Tracks the highlighted shared-arch entry used by scroll/commit.
let heldItemLabel = 'Pebble'; // Tracks the ordinary inventory selection committed by the potion adapter.
const inventoryLabels = ['Pebble', 'Healing Potion', 'Stamina Potion · Potency 2', 'Potion of Strength', 'Venom Flask']; // Ordinary item-wheel order used to validate exact-stack selection.
let inventoryIndex = 0; // Used by the fake ordinary item wheel's wraparound cycling.

function syncActive() {
  slots.forEach((slot, index) => {
    if (index === activeIndex) slot.classList.add('arc-active');
    else slot.classList.remove('arc-active');
  });
}

const arc = {
  openEntries(nextMode, entries) {
    mode = `entries:${nextMode}`;
    activeIndex = entries.findIndex(entry => entry.active);
    if (activeIndex < 0 && entries.length) activeIndex = Math.floor((entries.length - 1) / 2);
    slots = entries.map((entry, index) => new FakeSlot(entry, index === activeIndex));
  },
  openPotions() {},
  scrollEntries(dir) {
    if (!slots.length) return false;
    activeIndex = (activeIndex + (dir < 0 ? -1 : 1) + slots.length) % slots.length;
    syncActive();
    return true;
  },
  movePointer() {},
  releaseSelection() { this.commit(); },
  commit() {
    if (mode === 'item') {
      heldItemLabel = itemName.textContent;
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
  openItem() { mode = 'item'; itemName.textContent = inventoryLabels[inventoryIndex]; },
  scrollItem(dir) {
    inventoryIndex = (inventoryIndex + (dir < 0 ? -1 : 1) + inventoryLabels.length) % inventoryLabels.length;
    itemName.textContent = inventoryLabels[inventoryIndex];
    return true;
  },
  beginHeldSelection() {}, endHeldSelection() {}, heldSelectionKind() { return 'potions'; },
  entryMenuOpen() { return mode?.startsWith('entries:') || false; },
};

global.document = {
  querySelector: selector => selector.includes('.arc-active') ? slots.find(slot => slot.classList.contains('arc-active')) || null : null,
  querySelectorAll: selector => selector.startsWith('.arc-slot') ? slots : [],
  getElementById: id => id === 'itemName' ? itemName : null,
};
global.window = { _desktopSelectionArc:arc, SharedSelectionArch:arc };

const defs = {
  heal:{ id:'heal', label:'Healing Potion', icon:'💚' },
  stamina:{ id:'stamina', label:'Stamina Potion', icon:'💨' },
  strength:{ id:'strength', label:'Potion of Strength', icon:'💪' },
  venom:{ id:'venom', label:'Venom Flask', icon:'☠️' },
};
const healing = { itemKey:'alchemy_heal_p0', payload:{recipeId:'heal',potencyTier:0}, recipe:defs.heal, count:2, score:100 };
const stamina = { itemKey:'alchemy_stamina_p1', payload:{recipeId:'stamina',potencyTier:1}, recipe:defs.stamina, count:1, score:40 };
const strength = { itemKey:'alchemy_strength_p0', payload:{recipeId:'strength',potencyTier:0}, recipe:defs.strength, count:1 };
const venom = { itemKey:'alchemy_venom_p0', payload:{recipeId:'venom',potencyTier:0}, recipe:defs.venom, count:3 };
window.AlchemySystem = {
  RECIPE_DEFS:defs,
  POTION_ITEMS:Object.fromEntries([healing, stamina, strength, venom].map(entry => [entry.itemKey, entry.payload])),
  parseBrewedItemKey:key => window.AlchemySystem.POTION_ITEMS[key] || null,
  contextualRestoratives:() => [healing, stamina],
  potionCategoryState:() => ({ buffs:{items:[strength]}, flasks:{items:[venom]} }),
};

require(path.join(__dirname, '..', 'docs/js/mobile-potion-category-drag.js'));
const selector = window._desktopSelectionArc;
const debug = () => window.ContextualPotionSelector.diagnostics();

selector.openPotions();
assert.deepStrictEqual(debug().rootOrder, ['Buffs', 'Stamina Potion · Potency 2 ×1', 'Healing Potion ×2', 'Cancel', 'Flasks'], 'root order must place buffs far CCW, contextual restoratives left of Cancel, and Flasks immediately clockwise');
assert.strictEqual(debug().active, 'Cancel', 'holding Potion Select must begin on Cancel');
selector.releaseSelection();
assert.strictEqual(mode, null, 'releasing without scrolling must cancel');
assert.strictEqual(heldItemLabel, 'Pebble', 'Cancel must not change the held item');

selector.openPotions();
selector.scrollEntries(-1);
assert.strictEqual(debug().active, 'Healing Potion ×2', 'one counterclockwise step must reach the highest-scored contextual restorative');
selector.releaseSelection();
assert.strictEqual(heldItemLabel, 'Healing Potion', 'contextual restorative release must select the ordinary inventory stack');

selector.openPotions();
selector.scrollEntries(1);
assert.strictEqual(debug().stage, 'flasks', 'one clockwise step from Cancel must enter Flasks');
assert.strictEqual(debug().active, 'Cancel', 'Flasks must open on its boundary Cancel slot');
selector.scrollEntries(1);
assert.strictEqual(debug().active, 'Venom Flask ×3', 'continuing clockwise must enter the flask list');
selector.releaseSelection();
assert.strictEqual(heldItemLabel, 'Venom Flask', 'flask release must select the throwable bottle without consuming it');

selector.openPotions();
selector.scrollEntries(-1);
selector.scrollEntries(-1);
selector.scrollEntries(-1);
assert.strictEqual(debug().stage, 'buffs', 'the far counterclockwise endpoint must enter Buffs');
assert.strictEqual(debug().active, 'Cancel', 'Buffs must open on its boundary Cancel slot');
selector.scrollEntries(-1);
assert.strictEqual(debug().active, 'Potion of Strength ×1', 'continuing counterclockwise must enter the buff list');
selector.releaseSelection();
assert.strictEqual(heldItemLabel, 'Potion of Strength', 'buff release must select the ordinary held potion stack');

assert.strictEqual(debug().mode, 'hold-scroll-contextual', 'diagnostics must identify the new hold/scroll selector');
assert.ok(!debug().rootOrder.some(label => /medicine|utility/i.test(label)), 'Medicine and Utility must not exist in the visible root');
console.log('Contextual potion selector tests passed.');
