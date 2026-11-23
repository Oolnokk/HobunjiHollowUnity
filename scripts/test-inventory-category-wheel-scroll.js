'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'docs', 'js', 'inventory-ui.js'), 'utf8');
const listeners = []; // Records registered wheel listeners so repeated InventoryUI init-style registration can be checked.
const strip = {
  scrollLeft: 0, clientWidth: 220, scrollWidth: 980, // Simulates a visible category row wider than the Pack filter viewport.
  addEventListener(type, listener, options) { listeners.push({ type, listener, options }); },
};
const scope = { window: {}, document: { querySelector(selector) {
  return selector === '#mpInventory .inv-cats' ? strip : null;
} } }; // Isolates just the real module's category wheel owner from unrelated inventory rendering.
vm.runInNewContext(source, scope, { filename: 'inventory-ui.js' });
const { installCategoryScroll } = scope.window.InventoryUI.__test;
installCategoryScroll();
installCategoryScroll();
assert.equal(listeners.length, 1, 'repeated inventory initialization must not double-register wheel handling');
assert.equal(listeners[0].type, 'wheel');
assert.equal(listeners[0].options.passive, false, 'the scroll owner must be able to prevent native vertical scrolling');

function wheel(options = {}) {
  const event = {
    currentTarget: strip,
    deltaX: 0, deltaY: 0, deltaMode: 0,
    defaultPrevented: false, propagationStopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.propagationStopped = true; },
    ...options,
  }; // Captures whether the wheel was consumed by the hovered category row.
  listeners[0].listener(event);
  return event;
}

let event = wheel({ deltaY: 120 });
assert.equal(strip.scrollLeft, 120, 'ordinary mouse wheel moves the Pack categories horizontally');
assert.equal(event.defaultPrevented, true, 'vertical page movement is prevented when the categories move');
assert.equal(event.propagationStopped, true, 'background inventory/game inputs do not receive a tab-hover wheel');

event = wheel({ deltaY: -30 });
assert.equal(strip.scrollLeft, 90, 'reverse wheel motion returns toward the first category');
assert.equal(event.defaultPrevented, true);

wheel({ deltaY: 2, deltaMode: 1 });
assert.equal(strip.scrollLeft, 122, 'line-based wheel input scales to a usable number of pixels');
wheel({ deltaY: 1, deltaMode: 2 });
assert.equal(strip.scrollLeft, 342, 'page-based wheel input uses the category viewport width');

wheel({ deltaY: 5000 });
assert.equal(strip.scrollLeft, 760, 'scrolling clamps at the final category');
event = wheel({ deltaY: 120 });
assert.equal(strip.scrollLeft, 760);
assert.equal(event.defaultPrevented, false, 'a wheel at the end is not falsely consumed');
assert.equal(event.propagationStopped, true, 'a wheel at the end does not cycle other game controls');

event = wheel({ deltaX: -50, deltaY: -10 });
assert.equal(strip.scrollLeft, 760, 'horizontal trackpad motion is left to the browser');
assert.equal(event.defaultPrevented, false);
assert.equal(event.propagationStopped, true, 'horizontal trackpad gestures stay inside the category row');

for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) {
  event = wheel({ deltaY: -50, [modifier]: true });
  assert.equal(strip.scrollLeft, 760, `modified ${modifier} gestures do not move the category strip`);
  assert.equal(event.defaultPrevented, false);
}

event = wheel({ deltaY: -1e6 });
assert.equal(strip.scrollLeft, 0, 'scrolling clamps at the first category');
assert.equal(event.defaultPrevented, true);

strip.scrollWidth = strip.clientWidth; // A short row must not steal ordinary wheel input.
event = wheel({ deltaY: 90 });
assert.equal(strip.scrollLeft, 0);
assert.equal(event.defaultPrevented, false, 'a category row without overflow never hijacks the wheel');
assert.equal(event.propagationStopped, false);

console.log('Pack category wheel navigation, clamping, and input isolation passed');
