'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/animal-baby-arrival.js', 'utf8'); // Full production module under test.
const timers = []; // Simulated browser timers for asynchronous queue order and automatic reveal close.
const lockState = { acquired: 0, released: 0 }; // Checks that game input focus is always restored.
let controllerClaims = 0; // Checks explicit focus handoff instead of relying on a delayed DOM observer.
const portraitCalls = []; // Records the real chathead-rendering seam for new-baby UI regression checks.
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
          ['.aba-chathead', element('canvas')], ['.aba-chathead-fallback', element('span')],
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

let gameHour = 100; // Simulates the authoritative game clock independently of real time.
let area = 'farm'; // Current world area for danger and chunk tests.
let dangerScans = 0; // Counts live world reads to prove blocked retries are hourly, not per poll.
const hostiles = new Set(); // Live combat registry, with positions in world pixels.
const window = {
  CalendarSystem: { getAbsoluteGameHour: () => gameHour, getNaturalGameHoursPerSecond: () => 0.1 },
  Combat: { deps: { getCurrentArea: () => { dangerScans++; return area; }, TILE: 64, player: { x: 10, y: 10 }, hostileObjects: hostiles } },
  WildernessChunks: { constants: { CHUNK_TILES: 16 } },
  CavernGenerator: { isLocaleCavernMapId: id => id === 'map_i_custom_puzzle' },
  ControllerUI: { focusPanel(root) { assert.equal(root.id, 'animalBabyArrivalOverlay'); controllerClaims++; return true; } }, // Simulates the universal controller navigator's explicit modal claim.
  CREATURE_DB: { puktuk: { label: 'Puktuk' } },
  AnimalChatheadFrame: {
    async renderCreatureChathead(canvas, kind, options) {
      portraitCalls.push({ canvas, kind, genotype: options.genotype }); // Captures the actual crop renderer invocation without requiring image assets in Node.
      return true;
    },
  },
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
const twoSyllableName = /^(?:[BDFGKLMNPSTW][aeiou]|Ch[ui]|Sh[aiu])(?:[bdfgklmnpstw][aeiou]|ch[ui]|sh[aiu])[nmtkbgp]?$/; // Verifies actual two-syllable phonology instead of rejecting coincidental letter sequences such as shi+le+t = Shilet.
for (let i = 0; i < 1500; i++) {
  const name = feature.generateName();
  assert.match(name, twoSyllableName, 'names comprise two simple syllables and at most one permitted coda, never an added nickname suffix');
}
assert.match('Shilet', twoSyllableName, 'natural shi+le+t combinations are not mistaken for the removed let suffix');
for (const [ending, index] of [['b', 4], ['g', 5], ['p', 6]]) {
  const rolls = [0, 0.9, 0, 0, (index + 0.2) / 7]; // Selects two simple ba syllables, then the targeted single-letter coda.
  let roll = 0; // Advances through the deterministic random draw sequence for each required final consonant.
  assert.equal(feature.generateName(() => rolls[roll++]), 'Baba' + ending, 'supports a final ' + ending + ' without an ornamental suffix');
}
assert.equal(feature.requestName({}, { commit() {} }), false, 'cannot queue an animal without identity');

let saved = ''; // Captures the player-approved name, not the random default before confirmation.
let refreshes = 0; // Confirms successful renames refresh their owning panel exactly once.
const babyGenotype = { base: { color: '#ab78cd' } }; // Must reach the shared chathead renderer unchanged for inherited baby coloration.
assert.equal(feature.requestName({ id: 'new_1', kind: 'puktuk', genotype: babyGenotype }, {
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
const modalCss = document.head.children.find(child => child.id === 'animalBabyArrivalStyles')?.textContent || ''; // Verifies the injected modal CSS against the game's fullscreen-canvas positioning.
assert.match(modalCss, /#animalBabyArrivalOverlay \.aba-portrait\{[^}]*width:94px;height:94px;[^}]*overflow:hidden;/, 'portrait slot remains a clipped 94px square');
assert.match(modalCss, /#animalBabyArrivalOverlay \.aba-chathead\{[^}]*position:static;inset:auto;[^}]*max-width:100%;max-height:100%;/, 'chathead overrides the page-wide absolute canvas positioning without overflowing its slot');
const input = form.querySelector('input');
assert.equal(portraitCalls.length, 1, 'naming asks the canonical animal chathead renderer to paint the newborn');
assert.equal(portraitCalls[0].kind, 'puktuk', 'the portrait uses the newborn species');
assert.equal(portraitCalls[0].genotype, babyGenotype, 'the portrait uses the newborn inherited genotype');
assert.equal(portraitCalls[0].canvas.attributes['aria-label'], 'Baby Puktuk portrait', 'the canvas has a meaningful accessible label');
assert(!form.innerHTML.includes('🐣') && !form.innerHTML.includes('🎲'), 'the naming UI uses an animal portrait rather than emoji decorations');
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
assert.equal(portraitCalls.length, 2, 'each queued animal requests its own portrait, not the prior baby canvas');

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

window.AnimalChatheadFrame = null; // Simulates a missing/failed portrait dependency without changing the naming workflow.
assert.equal(feature.requestName({ id: 'missing_portrait', kind: 'puktuk' }, { commit() { return true; } }), true);
flush(0);
const portraitFallbackForm = root.children[0]; // The naming modal remains usable when the portrait renderer is absent.
assert.equal(portraitFallbackForm.querySelector('.aba-chathead').hidden, true, 'unavailable portrait canvas is hidden rather than showing a blank box');
assert.equal(portraitFallbackForm.querySelector('.aba-chathead-fallback').hidden, false, 'non-emoji fallback explains the unavailable portrait');
assert.equal(feature.debugSnapshot().lastPortrait.status, 'unavailable', 'mobile debug reports the portrait fallback state');
portraitFallbackForm.querySelector('[data-ctrl-cancel]').listeners.click();
assert(root.hidden, 'missing portraits never prevent dismissing the modal');
assert.equal(lockState.released, 3, 'portrait failure still releases the input lock');
// Async image loads must neither block input nor overwrite a later dialog's result.
async function testAsyncPortraitOwnership() {
  let resolveFirstPortrait; // Held image job simulates a delayed species asset while the player opens the next baby.
  window.AnimalChatheadFrame = { renderCreatureChathead() {
    return new Promise(resolve => { resolveFirstPortrait = resolve; });
  } };
  feature.requestName({ id: 'slow_baby', kind: 'puktuk' }, { commit: () => true });
  flush(0);
  assert.equal(feature.debugSnapshot().lastPortrait.status, 'loading', 'delayed image does not delay the naming modal');
  root.children[0].querySelector('[data-ctrl-cancel]').listeners.click();

  window.AnimalChatheadFrame = { async renderCreatureChathead() { return true; } };
  feature.requestName({ id: 'fresh_baby', kind: 'puktuk' }, { commit: () => true });
  flush(0);
  await new Promise(resolve => setImmediate(resolve)); // Let Node flush the VM realm's separate async continuations before inspecting its DOM.
  assert.equal(feature.debugSnapshot().lastPortrait.status, 'ready', 'resolved image marks the active baby portrait ready');
  resolveFirstPortrait(false);
  await new Promise(resolve => setImmediate(resolve)); // The previous modal's rejected image must not change the visible, newer dialog.
  assert.equal(feature.debugSnapshot().lastPortrait.id, 'fresh_baby', 'a stale portrait failure cannot overwrite another animal');
  assert.equal(feature.debugSnapshot().lastPortrait.status, 'ready', 'a stale portrait failure cannot hide the new chathead');
  root.children[0].querySelector('[data-ctrl-cancel]').listeners.click();
  assert.equal(lockState.released, 5, 'both delayed and new prompts release their input locks');
  const close = () => root.children[0].querySelector('[data-ctrl-cancel]').listeners.click(); // Dismisses the current name without committing.
  const pending = id => feature.requestName({ id, kind: 'puktuk' }, { commit: () => true }); // Queues a new name for the danger tests.
  area = 'map_i_custom_puzzle';
  pending('cave_baby');
  flush(0);
  assert(root.hidden && !feature.debugSnapshot().locked, 'caves postpone naming without blocking player actions');
  assert.equal(feature.debugSnapshot().deferredReason, 'dangerous-interior');
  const blockedScans = dangerScans;
  area = 'farm';
  gameHour = 100.9;
  flush(250);
  assert.equal(dangerScans, blockedScans, 'no danger recheck before the next in-game hour');
  assert(root.hidden, 'leaving danger does not interrupt the hourly cadence');
  gameHour = 101;
  flush(250);
  assert.equal(feature.debugSnapshot().active.id, 'cave_baby');
  close();

  area = 'map_i_dev_random_ruin';
  pending('ruin_baby');
  flush(0);
  assert(root.hidden, 'ruins always defer, even if there are no live enemies');
  area = 'map_northern_cliffs';
  const foe = { areaId: area, x: 800, y: 800, health: 10, def: { hostile: true } }; // Same 16x16 chunk, even though far from the player.
  hostiles.add(foe);
  gameHour = 102;
  flush(250);
  assert.equal(feature.debugSnapshot().deferredReason, 'hostile-in-chunk');
  pending('second_baby');
  assert.equal(timers.filter(task => !task.cancelled && task.ms === 250).length, 1, 'additional arrivals share the deferred timer');
  foe.x = 1024; // Exact edge of the neighboring chunk.
  hostiles.add({ areaId: area, x: 10, y: 10, health: 10, def: { hostile: false } });
  hostiles.add({ areaId: area, x: 10, y: 10, health: 0, def: { hostile: true } });
  hostiles.add({ areaId: area, x: 10, y: 10, health: 10, _porakanekiPlannerControlled: true, isBandit: true });
  gameHour = 103;
  flush(250);
  assert.equal(feature.debugSnapshot().active.id, 'ruin_baby', 'adjacent chunk, neutral animals, corpses and neutral hunters do not block');
  foe.x = 800;
  close(); // A new threat between queued screens must release the lock rather than open the next name.
  assert(root.hidden && !feature.debugSnapshot().locked, 'deferred successor releases the shared input lock');
  assert.equal(feature.debugSnapshot().queued[0].id, 'second_baby', 'deferred name stays queued');
  foe.health = 0;
  gameHour = 104;
  flush(250);
  assert.equal(feature.debugSnapshot().active.id, 'second_baby', 'pending name resumes in FIFO order');
  close();
  assert.equal(timers.filter(task => !task.cancelled).length, 0, 'empty queue leaves no polling timer');
  assert.equal(lockState.acquired, lockState.released, 'all danger cases release action locks');
  console.log('Animal baby arrival/naming/animation and hourly danger tests passed.');
}
testAsyncPortraitOwnership().catch(error => { console.error(error); process.exitCode = 1; });
