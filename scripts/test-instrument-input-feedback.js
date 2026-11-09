'use strict';
const assert = require('node:assert/strict'); // Checks physical input feedback against the real host handlers.
const fs = require('node:fs'); // Reads the production module.
const vm = require('node:vm'); // Runs the host UI with small DOM/controller seams.

function element(dataset = {}) {
  const classes = new Set(); // Tracks visible state without requiring a browser.
  const listeners = new Map(); // Captures pointer and layout handlers.
  return {
    dataset, listeners, style: {},
    classList: {
      contains: name => classes.has(name),
      add: name => classes.add(name),
      remove: name => classes.delete(name),
      toggle(name, on) { if (on ?? !classes.has(name)) classes.add(name); else classes.delete(name); },
    },
    setAttribute() {}, addEventListener(name, handler) { listeners.set(name, handler); },
    querySelector: () => null, querySelectorAll: () => [],
  };
}
function setup(layout) {
  const buttons = ['open', 'lt', 'rt', 'lb', 'rb'].flatMap(bank =>
    Array.from({ length: 4 }, (_, note) => element({ directBank: bank, directNote: String(note) }))); // Twenty real board addresses.
  const actions = ['pause', 'scale-prev', 'scale-next'].map(action => element({ bridgeAction: action })); // Visible utility actions.
  const cycle = element(); // Layout switch runs the actual release path.
  const right = element(); // DOM seam returns buttons addressed by production selectors.
  right.querySelectorAll = selector => selector === '.fiveGroupNoteBtn' ? buttons : [];
  right.querySelector = selector => {
    const match = selector.match(/data-direct-bank="([^"]+)".*data-direct-note="(\d)"/); // Decodes board selectors for this test DOM.
    return match ? buttons.find(button => button.dataset.directBank === match[1] && button.dataset.directNote === match[2])
      : actions.find(button => selector === `[data-bridge-action="${button.dataset.bridgeAction}"]`) || null;
  };
  const nodes = new Map(['leftMusicControls', 'musicLayoutHud', 'musicModeShiftHud', 'musicPerformanceHud'].map(id => [id, element()])); // Existing HUD mounts skip unrelated creation.
  nodes.set('rightMusicControls', right);
  nodes.get('musicLayoutHud').querySelector = selector => selector === '.layoutCycleBtn' ? cycle : null;
  const calls = []; // Records sounded notes and modifier ordering.
  let poll = null; // Shared ControllerInput callback under test.
  let focused = true; // Controls the actual tab-blur cleanup branch.
  const bridge = { wakeAudio: async () => {}, getState: () => ({}),
    noteDown: (...args) => calls.push(['note', ...args]), noteUp() {},
    bankDown: (...args) => calls.push(['bank', ...args]), bankUp() {}, tap() {},
  }; // Audio seam leaves all host input routing intact.
  const window = { __hobunjiHostedControlLayout: layout, addEventListener() {}, removeEventListener() {},
    InputBindings: { getDefaultBindings: () => Object.fromEntries(['musicNote1','musicNote2','musicNote3','musicNote4','musicBank1','musicBank2','musicBank3','musicBank4','musicPause','musicScalePrev','musicScaleNext'].map(id => [id, id])) },
    ControllerInput: { PRIORITY: { music: 40 }, subscribe(_id, handler) { poll = handler; return () => {}; } },
  }; // Captures real keyboard handlers installed on the host window.
  const frame = { contentWindow: { HobunjiMusicControlBridge: bridge, addEventListener() {}, removeEventListener() {} } }; // Hosted document input target.
  const timers = new Map(); // Simulates pulse expiration separately from physical release.
  let nextTimer = 0; // Unique timeout ids used by note pulses.
  const context = vm.createContext({ window, document: { getElementById: id => nodes.get(id) || null, hasFocus: () => focused },
    localStorage: { getItem: () => null },
    setTimeout(fn) { timers.set(++nextTimer, fn); return nextTimer; }, clearTimeout(id) { timers.delete(id); },
    setInterval() {}, clearInterval() {},
  }); // Only browser seams are replaced; module behavior remains production code.
  const source = fs.readFileSync('docs/js/music-minigame.js', 'utf8'); // Test-only export exposes the private builder without shipping another runtime API.
  vm.runInContext(source.replace('window.MusicMinigame = {', 'window.__build = buildEdgeControls; window.MusicMinigame = {'), context);
  assert.equal(window.__build(frame), true);
  return {
    calls, buttons, actions, cycle,
    note: (bank, note) => buttons.find(button => button.dataset.directBank === bank && button.dataset.directNote === String(note)),
    key(code, down, repeat = false) { window.__hobunjiHostedKeyboardBridgeHandlers[down ? 'keydown' : 'keyup']({ code, repeat, preventDefault() {}, stopImmediatePropagation() {} }); },
    pad(...codes) { poll({ pad: { axes: [0, 0] }, isDown: code => codes.includes(code) }); },
    disconnect() { poll({ pad: null }); },
    blur() { focused = false; window.__hobunjiHostedKeyboardBridgeHandlers.blur(); },
    expire() { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); },
  };
}

const keyboard = setup('keyboard'); // Exercises note holds and bank snapshots through installed key handlers.
keyboard.key('KeyA', true);
keyboard.expire();
assert.ok(keyboard.note('open', 0).classList.contains('input-held'), 'hold stays lit after the tap pulse expires');
keyboard.key('KeyA', true, true);
assert.equal(keyboard.calls.filter(call => call[0] === 'note').length, 1, 'key repeat never retriggers a held note');
keyboard.key('ArrowLeft', true);
keyboard.key('KeyS', true);
assert.ok(keyboard.note('lt', 1).classList.contains('input-held'), 'shifted notes light their addressed bank');
keyboard.key('ArrowLeft', false);
keyboard.key('KeyS', false);
assert.ok(!keyboard.note('lt', 1).classList.contains('input-held'), 'release clears the original bank after its modifier changes');
keyboard.blur();
assert.ok(keyboard.buttons.every(button => !button.classList.contains('input-held')), 'tab blur clears held note feedback');

const controller = setup('controller'); // Exercises same-frame modifiers, chords, utility feedback, disconnect and layout cleanup.
controller.pad('musicBank1', 'musicNote1', 'musicNote2', 'musicScaleNext');
assert.deepEqual(controller.calls.slice(0, 2).map(call => call[0]), ['bank', 'note'], 'modifiers resolve before simultaneous notes');
controller.expire();
assert.ok(controller.note('lt', 0).classList.contains('input-held'));
assert.ok(controller.note('lt', 1).classList.contains('input-held'));
assert.ok(controller.actions[2].classList.contains('input-held'), 'scale button lights from controller input');
controller.pad('musicNote2');
assert.ok(!controller.note('lt', 0).classList.contains('input-held'));
assert.ok(controller.note('lt', 1).classList.contains('input-held'), 'releasing another note leaves the held chord note lit');
assert.ok(!controller.actions[2].classList.contains('input-held'));
controller.disconnect();
assert.ok(controller.buttons.every(button => !button.classList.contains('input-held')), 'disconnect clears every held note');
controller.pad('musicNote3', 'musicScalePrev');
controller.cycle.listeners.get('click')();
assert.ok([...controller.buttons, ...controller.actions].every(button => !button.classList.contains('input-held')), 'layout switch clears notes and utility buttons');
console.log('Instrument keyboard/controller held-button feedback passed.');
