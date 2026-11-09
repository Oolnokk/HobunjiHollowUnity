'use strict';

const assert = require('node:assert/strict'); // Checks which real observer deliveries invalidate Nursery controls.
const fs = require('node:fs'); // Loads the shipped observer, not a copy of its callback.
const vm = require('node:vm'); // Runs the observer against deterministic DOM mutation records.
const source = fs.readFileSync('docs/js/livestock-nursery.js', 'utf8'); // Nursery's authoritative panel decoration owner.
const start = source.indexOf('  function installPanelObserver('); // Bounds the production setup and callback.
const end = source.indexOf('\n  function ', start + 1); // Excludes unrelated game initialization.
let callback; // Receives the installed production MutationObserver callback.
let refreshes = 0; // Any queued decoration replaces the Nursery section and its selected destination.
const observed = []; // Confirms the replacement detector still watches the mounted menu.
function element(selectors, parent = null) {
  return {
    matches(selector) { return selector.split(',').some(part => selectors.includes(part.trim())); },
    closest(selector) { return this.matches(selector) ? this : parent?.closest(selector) || null; },
    querySelector() { return null; },
  };
}
const menu = element(['#menuPanel']); // All pause panes stay mounted under this common ancestor.
const livestock = element(['#farmLivestockList'], menu); // Core Farm rerenders must still be decorated.
const buildings = element(['#farmBuildingsList'], menu); // Building edits must still update capacity and Nursery protections.
const nursery = element(['#livestockNurserySection'], livestock); // Grid-owned controls are updated in place.
const context = vm.createContext({
  document: { body: menu, getElementById: () => menu },
  MutationObserver: class {
    constructor(handler) { callback = handler; }
    observe(target, options) { observed.push({ target, options }); }
  },
  queuePanelDecoration() { refreshes++; },
}); // Only DOM observation and the destructive refresh seam are substituted.
vm.runInContext(`let panelObserver = null; ${source.slice(start, end)}; installPanelObserver();`, context);
assert.equal(refreshes, 1, 'initial installation still decorates existing Farm content');
assert.equal(observed[0].target, menu);
function deliver(target, addedNodes = [element([])], removedNodes = []) {
  callback([{ target, addedNodes, removedNodes }]);
}
refreshes = 0;
deliver(element(['.select-stepper'], nursery));
deliver(element(['.nursery-grid-card'], nursery));
deliver(element(['.nursery-grid-disclosure'], nursery));
deliver(element(['[data-nursery-incubation]'], nursery));
deliver(nursery);
assert.equal(refreshes, 0, 'stepper wrapping, portrait completion and Nursery selection preserve controls, focus and destination');
deliver(element(['.farm-header'], menu));
deliver(element(['#livestockNurseryDetail'], element(['#mpInventory'], menu)));
deliver(menu, [element([])], [{ nodeType: 3 }]);
assert.equal(refreshes, 0, 'unrelated menu text/layout changes cannot reset Nursery navigation');
deliver(livestock, [nursery]);
assert.equal(refreshes, 0, 'inserting the enhanced Nursery itself cannot schedule a second rebuild');
deliver(livestock);
deliver(element(['.farm-row'], livestock));
deliver(buildings);
assert.equal(refreshes, 3, 'real livestock, adult row and building changes still refresh');
deliver(menu, [livestock]);
deliver(menu, [{ querySelector: () => buildings }]);
assert.equal(refreshes, 5, 'replacing a whole list or its ancestor still restores decoration');
callback([{ target: nursery, addedNodes: [element([])], removedNodes: [] },
  { target: buildings, addedNodes: [element([])], removedNodes: [] }]);
assert.equal(refreshes, 6, 'mixed deliveries do not suppress real Farm changes');
console.log('Nursery navigation mutation regression passed.');
