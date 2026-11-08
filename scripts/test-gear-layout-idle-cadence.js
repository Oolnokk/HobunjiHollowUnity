#!/usr/bin/env node
'use strict';

// The shipped Gear observer must not turn ordinary gameplay/menu mutations
// into a repeated synchronous layout-measurement loop.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/inventory-gear-compact-effects.js', 'utf8'); // Execute the real shipped module against a minimal mobile-menu DOM.
const queued = []; // Deterministic rAF callbacks; tests drain them explicitly instead of relying on the browser clock.
const observers = []; // Captures the one inventory MutationObserver for synthetic update bursts.
let layoutReads = 0; // Counts expensive item-info width measurements made by refreshPresentation.
let styleWrites = 0; // Detects the binary font-fit pipeline running while Gear is hidden.
let disconnects = 0; // Verifies hidden Gear stops observing resize changes.

const pane = {
  nodeType: 1,
  gear: false,
  classList: { contains(name) { return name === 'inv-mode-gear' && pane.gear; } },
};
const info = {
  nodeType: 1,
  style: { setProperty() { styleWrites++; } },
  querySelector() { return null; },
  querySelectorAll() { return []; },
  getBoundingClientRect() { layoutReads++; return { width: 100 }; },
  closest(selector) { return selector.includes('#invInfo') ? this : null; },
};
const document = {
  readyState: 'complete',
  head: { appendChild() {} },
  getElementById(id) { return id === 'mpInventory' ? pane : id === 'invInfo' ? info : null; },
  createElement() { return { id: '', textContent: '' }; },
};
class MutationObserver {
  constructor(callback) { this.callback = callback; observers.push(this); }
  observe() {}
  disconnect() {}
  notify(records) { this.callback(records); }
}
class ResizeObserver {
  constructor(callback) { this.callback = callback; }
  observe() {}
  disconnect() { disconnects++; }
}
const window = { addEventListener() {}, innerWidth: 900, innerHeight: 500 };
function requestAnimationFrame(callback) { queued.push(callback); return queued.length; }
function flushFrames() {
  while (queued.length) queued.shift()();
}
const context = { window, document, MutationObserver, ResizeObserver, requestAnimationFrame, console };
vm.runInNewContext(source, context, { filename: 'inventory-gear-compact-effects.js' });
assert.equal(observers.length, 1, 'Gear listens for document rebuilds');
const observer = observers[0];
const mutation = (target, type = 'attributes', attributeName = 'class') => ({ target, type, attributeName });
const irrelevant = { nodeType: 1, closest() { return null; } };
flushFrames();
assert.equal(layoutReads, 0, 'startup with Pack active does not read Gear geometry');
assert.equal(styleWrites, 0, 'startup with Pack active does not run Gear font fitting');

observer.notify([mutation(irrelevant), mutation(pane)]);
assert.equal(queued.length, 0, 'unrelated closed-menu class churn schedules no fit');

pane.gear = true;
observer.notify([mutation(pane)]);
assert.equal(queued.length, 1, 'entering Gear schedules a fit');
flushFrames();
assert.equal(layoutReads, 1, 'first Gear open measures detail exactly once');
assert(styleWrites > 0, 'Gear open applies its own adaptive font metrics');

observer.notify([mutation(pane), mutation(irrelevant)]);
assert.equal(queued.length, 0, 'changing unrelated classes while Gear stays open does not refit');
observer.notify([mutation(info, 'characterData')]);
assert.equal(queued.length, 1, 'item-detail content changes still refit');
observer.notify([mutation(info, 'childList')]);
assert.equal(queued.length, 1, 'multiple relevant mutations coalesce into one frame');
flushFrames();
assert.equal(layoutReads, 2, 'coalesced mutations cause a single additional layout pass');

pane.gear = false;
observer.notify([mutation(pane)]);
flushFrames();
assert.equal(layoutReads, 2, 'leaving Gear does not read the hidden detail panel');
assert(disconnects >= 1, 'leaving Gear disconnects layout resize targets');
const hiddenWrites = styleWrites; // Compares real mutation bursts with hidden Gear to the no-work baseline.
observer.notify([mutation(info, 'characterData'), mutation(irrelevant)]);
flushFrames();
assert.equal(styleWrites, hiddenWrites, 'hidden Gear changes never run CSS font fitting');

pane.gear = true;
observer.notify([mutation(pane)]);
flushFrames();
assert.equal(layoutReads, 3, 'reopening Gear refits, including changes made while hidden');
const debug = window.InventoryGearCompactEffects.debugSnapshot();
assert.equal(debug.gearActive, true);
assert.equal(debug.fitStats.passes, 3);
assert(debug.fitStats.ignoredMutations >= 2);
assert(debug.fitStats.inactiveSkips >= 2);
console.log('Gear layout idle-cadence tests passed');
