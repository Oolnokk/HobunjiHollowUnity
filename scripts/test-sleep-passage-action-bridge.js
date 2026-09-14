'use strict';

const assert = require('node:assert/strict'); // Deterministic assertions for the farmhouse-bed compatibility bridge.
const fs = require('node:fs'); // Reads the shipped bridge and bootstrap source.
const path = require('node:path'); // Resolves repository-relative paths.
const vm = require('node:vm'); // Executes the browser bridge against a small fake DOM/input surface.

const root = path.resolve(__dirname, '..');
const bridgeSource = fs.readFileSync(path.join(root, 'docs/js/sleep-passage-action-bridge.js'), 'utf8');
const loaderSource = fs.readFileSync(path.join(root, 'docs/js/combat/combat-config-loader.js'), 'utf8');

assert.doesNotThrow(() => new vm.Script(bridgeSource), 'sleep passage action bridge parses');
assert.match(loaderSource, /sleep-passage-action-bridge\.js\?v=20260914a/, 'runtime bootstrap loads the bed sleep bridge with a cache-busted URL');

function makeButton(id, label, key, action = 'obj_interact') {
  const button = {
    id,
    dataset: { action },
    textContent: `[${key}] ${label}`,
    classList: { contains: () => false },
    querySelector(selector) {
      if (selector === '.abt-label') return { textContent: label };
      if (selector === '.abt-key') return { textContent: `[${key}]` };
      return null;
    },
    closest(selector) { return selector === 'button' ? button : null; },
  };
  return button;
}

const listeners = { window: {}, document: {} };
const buttons = new Map();
let opened = [];
const documentStub = {
  getElementById(id) { return buttons.get(id) || null; },
  querySelector() { return null; },
  addEventListener(type, handler) { listeners.document[type] = handler; },
};
const windowStub = {
  CalendarSystem: { openTimePassage(kind) { opened.push(kind); } },
  addEventListener(type, handler) { listeners.window[type] = handler; },
};

vm.runInNewContext(bridgeSource, {
  window: windowStub,
  document: documentStub,
  Object,
  Number,
  String,
  RegExp,
  console,
}, { filename: 'sleep-passage-action-bridge.js' });

const bridge = windowStub.HobunjiSleepPassageActionBridge;
assert.equal(bridge?.version, 1, 'bridge installs');

const f3Sleep = makeButton('btnAction3', 'Sleep', 'F3');
buttons.set('btnAction3', f3Sleep);
assert.equal(bridge._test.buttonShowsSleep(f3Sleep), true, 'Sleep world action is recognized');
assert.equal(bridge._test.displayedKeyCode(f3Sleep), 'F3', 'Sleep uses its displayed physical key instead of assuming E');

function inputEvent(code, target = null) {
  return {
    code,
    target,
    repeat: false,
    prevented: false,
    stopped: false,
    preventDefault() { this.prevented = true; },
    stopImmediatePropagation() { this.stopped = true; },
  };
}

const f3Down = inputEvent('F3');
listeners.window.keydown(f3Down);
assert.equal(f3Down.prevented, true, 'non-E Sleep key is captured before legacy game input');
assert.equal(f3Down.stopped, true, 'legacy whole-day sleep handler cannot receive captured Sleep press');
assert.deepEqual(opened, [], 'shared passage waits for key release like the existing tap behavior');

const f3Up = inputEvent('F3');
listeners.window.keyup(f3Up);
assert.deepEqual(opened, ['sleep'], 'releasing the displayed Sleep key opens CalendarSystem shared Sleep passage');

opened = [];
buttons.clear();
const eSleep = makeButton('btnAction1', 'Sleep', 'E');
buttons.set('btnAction1', eSleep);
const eDown = inputEvent('KeyE');
listeners.window.keydown(eDown);
assert.equal(eDown.prevented, false, 'E remains delegated to CalendarSystem existing tap/hold interceptor');
assert.deepEqual(opened, [], 'bridge does not double-open E Sleep');

buttons.clear();
const qSleep = makeButton('btnAction2', 'Sleep', 'Q');
buttons.set('btnAction2', qSleep);
const nested = { closest: selector => selector === 'button' ? qSleep : null };
const click = inputEvent('', nested);
listeners.document.click(click);
assert.equal(click.prevented, true, 'pointer/click fallback blocks legacy Sleep action');
assert.deepEqual(opened, ['sleep'], 'pointer/click fallback opens the same shared Sleep passage');

buttons.clear();
const inspect = makeButton('btnAction1', 'Inspect', 'E', 'obj_interact');
buttons.set('btnAction1', inspect);
const unrelatedClick = inputEvent('', { closest: () => inspect });
listeners.document.click(unrelatedClick);
assert.equal(unrelatedClick.prevented, false, 'non-Sleep interactions remain untouched');
assert.deepEqual(opened, ['sleep'], 'non-Sleep interactions never open passage');

console.log('farmhouse bed shared Sleep passage regression passed');
