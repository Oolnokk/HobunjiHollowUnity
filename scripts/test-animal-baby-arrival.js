'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/animal-baby-arrival.js', 'utf8'); // Full production module under test.
const timers = []; // Simulated browser timers for asynchronous queue order and automatic reveal close.
const lockState = { acquired: 0, released: 0 }; // Checks that game input focus is always restored.
let controllerClaims = 0; // Checks explicit focus handoff instead of relying on a delayed DOM observer.
const document = {
  activeElement: null,
  head: null,
  body: null,
  getElementById(id) { return this.head.children.find(child => child.id === id) || this.body.children.find(child => child.id === id) || null; },
  createElement(tag) { return element(tag); },
}; // Browser DOM seam with only the methods used by the arrival module.

function element(tag) {
  const node = {
    tagName: tag.toUpperCase(), id: '', hidden: false, isConnected: false,
    style: {}, textContent: '', value: '', listeners: {}, children: [],
    attributes: {}, elements: null,
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, handler) { this.listeners[name] = handler; },
    appendChild(child) { child.isConnected = true; this.children.push(child); return child; },
    replaceChildren(...children) { this.children = children; },
    focus() { document.activeElement = this; },
    select() {},
    querySelector(selector) {
      if (!this.elements) {
        this.elements = new Map([
          ['input', element('input')], ['p', element('p')], ['.aba-error', element('div')],
          ['[data-ctrl-cancel]', element('button')], ['.aba-reroll', element('button')],
          ['button', element('button')], ['h2', element('h2')], ['.aba-grown', element('span')],
        ]);
      }
      return this.elements.get(selector) || null;
    },
    querySelectorAll() { return []; },
  };
  return node;
}
document.head = element('head');
document.body = element('body');
document.activeElement = element('button');
document.activeElement.isConnected = true;

const window = {
  ControllerUI: { focusPanel(root) { assert.equal(root.id, 'animalBabyArrivalOverlay'); controllerClaims++; return true; } }, // Simulates the universal controller navigator's explicit modal claim.
  CREATURE_DB: { puktuk: { label: 'Puktuk' } },
  CharacterActionLocks: {
    acquire() {
      lockState.acquired++;
      return { release() { lockState.released++; } };
    },
  },
  matchMedia: () => ({ matches: false }),
};
const run = (callback, ms) => { const task = { callback, ms, cancelled: false }; timers.push(task); return task; }; // Deterministic replacement for setTimeout.
const cancel = task => { if (task) task.cancelled = true; }; // Deterministic replacement for clearTimeout.
const flush = ms => {
  const index = timers.findIndex(task => !task.cancelled && task.ms === ms);
  assert(index >= 0, 'expected a timer at ' + ms + 'ms');
  const task = timers.splice(index, 1)[0];
  task.callback();
}; // Advances one queued UI operation without wall-clock delays.

const context = vm.createContext({ window, document, setTimeout: run, clearTimeout: cancel, console });
vm.runInContext(source, context, { filename: 'animal-baby-arrival.js' });
const feature = window.AnimalBabyArrival;
assert(feature, 'the arrival module exports its public UI API');
for (let i = 0; i < 300; i++) {
  const name = feature.generateName();
  assert.match(name, /^[A-Z][a-z]{2,29}$/, 'generated pet names have a cute two-syllable format');
}
assert.equal(feature.requestName({}, { commit() {} }), false, 'cannot queue an animal without identity');

let saved = ''; // Captures the player-approved name, not the random default before confirmation.
let refreshes = 0; // Confirms successful renames refresh their owning panel exactly once.
assert.equal(feature.requestName({ id: 'new_1', kind: 'puktuk' }, {
  scope: 'nursery',
  commit(name) { saved = name; return true; },
  refresh() { refreshes++; },
}), true);
assert.equal(feature.requestName({ id: 'new_2', kind: 'puktuk' }, {
  scope: 'stable',
  commit() { throw new Error('Later must not persist'); },
}), true);
assert.equal(saved, '', 'name is not saved until confirmation');
flush(0);
const root = document.getElementById('animalBabyArrivalOverlay');
assert(root && !root.hidden && root.attributes['data-ctrl-modal'] === '', 'naming dialog captures controller/modal focus');
const form = root.children[0];
const input = form.querySelector('input');
assert.match(input.value, /^[A-Z][a-z]+$/, 'input is prefilled with a suggested name');
assert.equal(document.activeElement, input, 'input receives keyboard focus');
assert.equal(controllerClaims, 1, 'naming dialog explicitly takes controller focus');
input.value = '  Pudding   ';
form.listeners.submit({ preventDefault() {} });
assert.equal(saved, 'Pudding', 'confirmed baby name is trimmed and saved');
assert.equal(refreshes, 1, 'successful naming refreshes the Nursery');
assert.equal(root.hidden, false, 'second queued prompt appears without losing focus');
root.children[0].querySelector('[data-ctrl-cancel]').listeners.click();
assert(root.hidden, 'Later dismisses without changing saved names');
assert.equal(lockState.acquired, 1, 'both naming prompts share one input lock');
assert.equal(lockState.released, 1, 'finishing the queue releases the player lock');

feature.celebrateMaturation({ id: 'adult_1', name: 'Pudding', kind: 'puktuk' });
feature.celebrateMaturation({ id: 'adult_2', name: 'Bobo', kind: 'grehlr' });
flush(0);
assert(root.children[0].querySelector('h2').textContent.includes('Pudding'), 'successful completion reveals the actual animal name');
assert.equal(root.children[0].querySelector('.aba-grown').textContent, '🐇', 'completed baby reveals species-specific icon');
root.children[0].querySelector('button').listeners.click(); // User skips the first animation.
assert.equal(root.children[0].querySelector('h2').textContent, 'Bobo is all grown up!', 'the next completion is not dropped');
flush(3100);
assert(root.hidden, 'last incubation animation closes automatically');
assert.equal(lockState.acquired, 2, 'incubation uses a fresh input lock');
assert.equal(lockState.released, 2, 'automatic dismissal also releases the input lock');
assert.equal(feature.debugSnapshot().queued.length, 0, 'no stale work remains in the modal queue');
assert.equal(controllerClaims, 4, 'each queued screen claims controller focus independently');
console.log('Animal baby arrival/naming/animation tests passed.');
