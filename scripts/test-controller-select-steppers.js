#!/usr/bin/env node
'use strict';

// Executes docs/js/controller-select-steppers.js against a tiny DOM mock:
// stepping wraps, skips disabled options, fires input+change, and the module
// is loaded by the game page after the controller navigator.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'docs/js/controller-select-steppers.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(root, 'docs/index.html'), 'utf8');

const navAt = indexSource.search(/js\/controller-ui-nav\.js\?v=[A-Za-z0-9_-]+/);
const stepperAt = indexSource.search(/js\/controller-select-steppers\.js\?v=[A-Za-z0-9_-]+/);
assert.ok(navAt > 0 && stepperAt > navAt, 'game page loads the select steppers after ControllerUI');

const windowMock = {};
const documentMock = {
  body: null, // boot() defers to DOMContentLoaded; this test only drives step().
  addEventListener() {},
};
class EventMock { constructor(type, init) { this.type = type; this.bubbles = !!init?.bubbles; } }
vm.runInNewContext(source, { window: windowMock, document: documentMock, Event: EventMock, MutationObserver: undefined, console });

const api = windowMock.SelectSteppers;
assert.ok(api?.installed && typeof api.step === 'function', 'exposes window.SelectSteppers.step');

function makeSelect(values, { selected = 0, disabled = [] } = {}) {
  const events = [];
  const options = values.map((value, i) => ({ value, textContent: value.toUpperCase(), disabled: disabled.includes(i), selected: i === selected }));
  const select = {
    tagName: 'SELECT',
    disabled: false,
    options,
    events,
    get selectedIndex() { return options.findIndex(o => o.selected); },
    get value() { return options[this.selectedIndex]?.value ?? ''; },
    set value(v) { options.forEach(o => { o.selected = false; }); const hit = options.find(o => o.value === v); if (hit) hit.selected = true; },
    dispatchEvent(event) { events.push(event.type); return true; },
  };
  return select;
}

const s = makeSelect(['a', 'b', 'c']);
assert.equal(api.step(s, 1), true);
assert.equal(s.value, 'b');
assert.deepEqual(s.events, ['input', 'change'], 'fires the same events a real pick does');
api.step(s, 1);
assert.equal(s.value, 'c');
api.step(s, 1);
assert.equal(s.value, 'a', 'next wraps from last to first');
api.step(s, -1);
assert.equal(s.value, 'c', 'previous wraps from first to last');

const skip = makeSelect(['x', 'placeholder', 'y'], { selected: 0, disabled: [1] });
api.step(skip, 1);
assert.equal(skip.value, 'y', 'disabled options are skipped');

const single = makeSelect(['only']);
assert.equal(api.step(single, 1), false, 'single-option dropdown is a no-op');
assert.deepEqual(single.events, [], 'no change event when nothing moved');

const off = makeSelect(['a', 'b']);
off.disabled = true;
assert.equal(api.step(off, 1), false, 'disabled dropdown is left alone');
assert.equal(off.value, 'a');

console.log('controller select steppers: ok');
