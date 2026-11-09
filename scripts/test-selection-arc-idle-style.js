#!/usr/bin/env node
'use strict';

// The active wheel still checks geometry every frame for timer-driven legacy
// scrolling, but stable slots must not rewrite CSS, classes or data attributes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/quick-potion-arc-ui.js', 'utf8'); // Executes the shipped wheel module, not a reimplementation.
const installGate = "  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once:true });"; // Injects test-only access before boot.
assert(source.includes(installGate), 'wheel boot gate is still available');
const instrumented = source.replace(installGate,
  "  window.__selectorWriteTest = { layoutSharedSelector, enforceSlotPresentation, setSharedVisual, setOuterArchHidden, diagnostics: () => ({ ...domWriteStats }) };\n" + installGate);

let actualDomWrites = 0; // Counts only real DOM mutations, not the module's diagnostic counters.
function fakeClassList() {
  const values = new Set(); // Holds live class tokens for repeated-frame comparisons.
  return {
    contains(name) { return values.has(name); },
    add(...names) { actualDomWrites++; names.forEach(name => values.add(name)); },
    toggle(name, force) {
      actualDomWrites++;
      const next = force === undefined ? !values.has(name) : !!force; // Mirrors DOMTokenList.toggle(force).
      if (next) values.add(name);
      else values.delete(name);
      return next;
    },
  };
}
function fakeStyle() {
  const values = new Map(); // Tracks declarations and priority just like CSSStyleDeclaration.
  return {
    opacity: '1',
    getPropertyValue(name) { return values.get(name)?.value || ''; },
    getPropertyPriority(name) { return values.get(name)?.priority || ''; },
    setProperty(name, value, priority = '') {
      actualDomWrites++;
      values.set(name, { value:String(value), priority:String(priority) });
    },
  };
}
function fakeDataset() {
  const values = {}; // Counts repeated data-* assignments that would invalidate selector matching.
  return new Proxy(values, {
    set(target, key, value) {
      actualDomWrites++;
      target[key] = String(value);
      return true;
    },
  });
}
const slot = {
  dataset:fakeDataset(),
  style:fakeStyle(),
  classList:fakeClassList(),
  isConnected:true,
}; // Already-presented slot follows the ordinary stable frame path, not first-open animation.
slot.dataset.sharedSelectionPresented = '1';
const body = { classList:fakeClassList() }; // Permanent HUD visibility changes are expensive because body is a CSS ancestor.
const anchor = { getBoundingClientRect() { return { left:100, top:100, width:0, height:0 }; } }; // Permanent ring center.
const toolButton = { getBoundingClientRect() { return { left:150, top:50, width:20, height:20 }; } }; // Permanent ring radius sample.
const document = {
  readyState:'loading',
  body,
  addEventListener() {},
  getElementById(id) { return id === 'toolSelect' ? anchor : id === 'toolBtn' ? toolButton : null; },
  querySelectorAll() { return []; },
};
const window = {};
vm.runInNewContext(instrumented, { window, document, innerWidth:1000, innerHeight:700, console }, {
  filename:'quick-potion-arc-ui.js',
});
const wheel = window.__selectorWriteTest;
assert(wheel, 'test hook should expose actual wheel functions');

wheel.layoutSharedSelector([slot]);
const firstWrites = actualDomWrites; // Baseline includes intentional initial geometry, class, and style writes.
assert(firstWrites > 1, 'first presentation initializes missing metadata and geometry');
wheel.layoutSharedSelector([slot]);
assert.equal(actualDomWrites, firstWrites, 'unchanged wheel geometry never rewrites DOM in subsequent frames');

wheel.setSharedVisual(slot, 1, 1);
assert.equal(actualDomWrites, firstWrites, 'unchanged visual state is a no-op');
wheel.enforceSlotPresentation(slot, true);
const denseWrites = actualDomWrites; // New choice density must still update the class.
assert(denseWrites > firstWrites, 'choice density change is applied');
wheel.enforceSlotPresentation(slot, true);
assert.equal(actualDomWrites, denseWrites, 'stable choice density does not repeat the class mutation');

wheel.setOuterArchHidden(true);
const hiddenWrites = actualDomWrites; // Permanent ring hides only on transition into selector mode.
assert.equal(hiddenWrites, denseWrites + 1, 'opening a selector hides the permanent ring once');
wheel.setOuterArchHidden(true);
assert.equal(actualDomWrites, hiddenWrites, 'subsequent open frames never toggle body class');
wheel.setOuterArchHidden(false);
assert.equal(actualDomWrites, hiddenWrites + 1, 'closing selector restores the permanent ring');
wheel.setOuterArchHidden(false);
assert.equal(actualDomWrites, hiddenWrites + 1, 'closed-wheel idle frame does not toggle body class');

const diagnostics = wheel.diagnostics(); // Mobile debug snapshot distinguishes real transitions from suppressed no-ops.
assert(diagnostics.applied > 0 && diagnostics.skipped > 0, 'diagnostics count both actual and avoided writes');
console.log('selection arc idle DOM style tests passed');
