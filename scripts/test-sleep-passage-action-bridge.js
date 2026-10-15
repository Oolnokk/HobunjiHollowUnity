'use strict';

const assert = require('node:assert/strict'); // Deterministic assertions for the farmhouse-bed compatibility bridge.
const fs = require('node:fs'); // Reads the shipped bridge and bootstrap source.
const path = require('node:path'); // Resolves repository-relative paths.
const vm = require('node:vm'); // Executes the browser bridge against a small fake DOM/input surface.

const root = path.resolve(__dirname, '..');
const bridgeSource = fs.readFileSync(path.join(root, 'docs/js/sleep-passage-action-bridge.js'), 'utf8');
const controllerBridgeSource = fs.readFileSync(path.join(root, 'docs/js/controller-modern-flow-bridge.js'), 'utf8'); // Verifies controller Sleep is claimed before legacy gameplay dispatch.
const loaderSource = fs.readFileSync(path.join(root, 'docs/js/combat/combat-config-loader.js'), 'utf8');

assert.doesNotThrow(() => new vm.Script(bridgeSource), 'sleep passage action bridge parses');
assert.doesNotThrow(() => new vm.Script(controllerBridgeSource), 'controller modern-flow bridge parses');
assert.match(loaderSource, /sleep-passage-action-bridge\.js\?v=[A-Za-z0-9_.-]+/, 'runtime bootstrap loads the bed sleep bridge with a cache-busted URL');
assert.match(controllerBridgeSource, /function tryOpenBedSleep\(frame\)[\s\S]*?openSharedSleepPassage/, 'controller bridge routes rendered bed Sleep through the shared passage bridge');
assert.match(controllerBridgeSource, /if \(tryOpenBedSleep\(frame\)\) return;/, 'controller bed Sleep is claimed before generic gameplay action dispatch');

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
let passageOpen = false; // Mirrors whether the shared Sleep modal has replaced the bed action after pointer/key release.
const arcCalls = { openTool: 0, openItem: 0, close: 0, scrollTool: [], scrollItem: [] }; // Verifies E/Q hold selectors survive early Sleep interception.
const documentStub = {
  baseURI: 'https://example.test/docs/',
  head: { appendChild() {} },
  createElement() { return { dataset: {}, addEventListener() {} }; },
  getElementById(id) { return buttons.get(id) || null; },
  querySelector(selector) { return selector === '.time-passage-backdrop.open' && passageOpen ? {} : null; },
  addEventListener(type, handler) { listeners.document[type] = handler; },
};
const windowStub = {
  CalendarSystem: {
    openTimePassage(kind) {
      opened.push(kind);
      passageOpen = true;
    },
  },
  _desktopSelectionArc: {
    openTool() { arcCalls.openTool += 1; },
    openItem() { arcCalls.openItem += 1; },
    close() { arcCalls.close += 1; },
    scrollTool(direction) { arcCalls.scrollTool.push(direction); },
    scrollItem(direction) { arcCalls.scrollItem.push(direction); },
  },
  addEventListener(type, handler) { listeners.window[type] = handler; },
  removeEventListener(type, handler) { if (listeners.window[type] === handler) delete listeners.window[type]; },
};

vm.runInNewContext(bridgeSource, {
  window: windowStub,
  document: documentStub,
  URL,
  Object,
  Number,
  String,
  RegExp,
  Date,
  console,
  setTimeout,
  clearTimeout,
}, { filename: 'sleep-passage-action-bridge.js' });

const bridge = windowStub.HobunjiSleepPassageActionBridge;
assert.equal(bridge?.version, 3, 'bridge installs current farmhouse sleep interception');

const f3Sleep = makeButton('btnAction3', 'Sleep', 'F3');
buttons.set('btnAction3', f3Sleep);
assert.equal(bridge._test.buttonShowsSleep(f3Sleep), true, 'Sleep world action is recognized');
assert.equal(bridge._test.displayedKeyCode(f3Sleep), 'F3', 'Sleep uses its displayed physical key instead of assuming E');

function inputEvent(code, target = null, extra = {}) {
  return {
    code,
    target,
    repeat: false,
    prevented: false,
    stopped: false,
    preventDefault() { this.prevented = true; },
    stopImmediatePropagation() { this.stopped = true; },
    ...extra,
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
assert.equal(windowStub.__hobunjiOwnedBedSleepPending?.source, 'player-bed', 'non-E bed Sleep arms the one-shot Well Rested token');

opened = [];
passageOpen = false;
windowStub.__hobunjiOwnedBedSleepPending = null;
buttons.clear();
const eSleep = makeButton('btnAction1', 'Sleep', 'E');
buttons.set('btnAction1', eSleep);
const eDown = inputEvent('KeyE');
listeners.window.keydown(eDown);
assert.equal(eDown.prevented, true, 'default E Sleep is captured by the parser-time bridge before legacy sleepInBed');
assert.equal(eDown.stopped, true, 'default E Sleep cannot leak to the legacy whole-night handler');
assert.deepEqual(opened, [], 'E Sleep also waits for release');
const eUp = inputEvent('KeyE');
listeners.window.keyup(eUp);
assert.deepEqual(opened, ['sleep'], 'releasing E opens the shared Sleep duration passage');
assert.equal(windowStub.__hobunjiOwnedBedSleepPending?.source, 'player-bed', 'E bed Sleep arms the same Well Rested token');

assert.equal(listeners.window.wheel, undefined, 'page wheel scrolling never waits on Sleep input while nothing is armed');
opened = [];
passageOpen = false;
windowStub.__hobunjiOwnedBedSleepPending = null;
const eHoldDown = inputEvent('KeyE');
listeners.window.keydown(eHoldDown);
const wheel = inputEvent('', null, { deltaY: 1 });
listeners.window.wheel(wheel);
assert.equal(wheel.prevented, true, 'wheel during held E remains owned by the selector flow');
assert.equal(arcCalls.openTool, 1, 'held E still opens the tool selection arc');
assert.deepEqual(arcCalls.scrollTool, [-1], 'held E wheel still scrolls the tool selection arc');
const eHoldUp = inputEvent('KeyE');
listeners.window.keyup(eHoldUp);
assert.equal(arcCalls.close, 1, 'releasing held E closes the selection arc');
assert.equal(listeners.window.wheel, undefined, 'the non-passive wheel listener is removed once no Sleep key is armed');
assert.deepEqual(opened, [], 'holding E for tool selection never sleeps');
assert.equal(windowStub.__hobunjiOwnedBedSleepPending, null, 'tool selection does not arm Well Rested');

opened = [];
passageOpen = false;
buttons.clear();
const qSleep = makeButton('btnAction2', 'Sleep', 'Q');
buttons.set('btnAction2', qSleep);
const nested = { closest: selector => selector === 'button' ? qSleep : null };
const pointerDown = inputEvent('', nested, { type: 'pointerdown' });
listeners.document.pointerdown(pointerDown);
assert.equal(pointerDown.prevented, true, 'bed pointer press is captured before legacy pointer handlers');
assert.deepEqual(opened, [], 'pointer press alone does not open Sleep');
const pointerUp = inputEvent('', nested, { type: 'pointerup' });
listeners.document.pointerup(pointerUp);
assert.equal(pointerUp.prevented, true, 'bed pointer release is captured before legacy pointer handlers');
assert.deepEqual(opened, ['sleep'], 'bed pointer release opens the shared Sleep passage');
assert.equal(windowStub.__hobunjiOwnedBedSleepPending?.source, 'player-bed', 'pointer bed Sleep arms the Well Rested token');
const trailingClick = inputEvent('', nested, { type: 'click' });
listeners.document.click(trailingClick);
assert.equal(trailingClick.prevented, true, 'trailing click stays consumed after pointerup opened the modal');
assert.equal(trailingClick.stopped, true, 'trailing click cannot reach legacy sleepInBed after the modal opens');
assert.deepEqual(opened, ['sleep'], 'trailing click does not double-open Sleep');

passageOpen = false;
buttons.clear();
const inspect = makeButton('btnAction1', 'Inspect', 'E', 'obj_interact');
buttons.set('btnAction1', inspect);
const unrelatedClick = inputEvent('', { closest: () => inspect });
listeners.document.click(unrelatedClick);
assert.equal(unrelatedClick.prevented, false, 'non-Sleep interactions remain untouched');
assert.deepEqual(opened, ['sleep'], 'non-Sleep interactions never open passage');

console.log('farmhouse bed shared Sleep passage regression passed');