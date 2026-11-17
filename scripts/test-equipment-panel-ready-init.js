#!/usr/bin/env node
'use strict';

// Regression: init() can be called again without accumulating player-load hooks.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('docs/js/equipment-panel.js', 'utf8');
const listeners = new Map(); // Counts the production event registrations without browser devtools.
const document = {
  addEventListener(name, listener) {
    if (!listeners.has(name)) listeners.set(name, []);
    listeners.get(name).push(listener);
  },
  getElementById() { return null; },
};
const gear = { tools: {}, clothing: {} }; // A character record exercised by the actual ready event.
let gearSaves = 0; // Ensures the starter flute grant stays idempotent when reinitialized.
let slotSaves = 0;
const window = { InventoryUI: { init() {} } };
vm.runInNewContext(source, { document, window, console }, { filename: 'equipment-panel.js' });
const panel = window.EquipmentPanel;
const deps = {
  TOOL_ITEM_DEFS: {},
  equipmentSlots: {},
  getGearInventory: () => gear,
  saveGearInventory: () => gearSaves++,
  saveEquipmentSlots: () => slotSaves++,
};
panel.init(deps);
panel.init(deps);
panel.init(deps);
assert.equal(listeners.get('hobunjiPlayerReady')?.length, 1, 'player-ready listener is installed exactly once');
assert.equal(listeners.get('click')?.length, 1, 'inventory click selection bridge remains idempotent');
listeners.get('hobunjiPlayerReady')[0]();
assert.equal(gearSaves, 1, 'one character-ready dispatch grants the starter flute once');
assert.equal(slotSaves, 1, 'one character-ready dispatch assigns the instrument slot once');
assert.equal(gear.tools.flute, true);
assert.equal(deps.equipmentSlots.instrument, 'flute');
console.log('equipment init player-ready listener lifecycle passed');
