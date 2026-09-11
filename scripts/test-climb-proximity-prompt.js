const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const source = fs.readFileSync('docs/js/climb-proximity-prompt.js', 'utf8');
const elements = new Map();

function makeElement(tag) {
  const classes = new Set();
  const listeners = new Map();
  return {
    tagName: String(tag).toUpperCase(),
    id: '',
    type: '',
    textContent: '',
    style: {},
    dataset: {},
    attributes: {},
    classList: {
      add(value) { classes.add(value); },
      remove(value) { classes.delete(value); },
      contains(value) { return classes.has(value); },
    },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    addEventListener(name, fn) { listeners.set(name, fn); },
    dispatch(name) { listeners.get(name)?.({ preventDefault() {}, stopPropagation() {} }); },
  };
}

const document = {
  head: { appendChild(el) { if (el.id) elements.set(el.id, el); } },
  body: { appendChild(el) { if (el.id) elements.set(el.id, el); } },
  createElement: makeElement,
  getElementById(id) { return elements.get(id) || null; },
};

let target = null;
let startedWith = null;
let rideState = 'none';
const player = { climbing: false, prone: false, dodging: false, lunging: false };
const window = {
  Combat: { deps: { player } },
  ActionPromptUI: {
    actionPromptGlyph(actionId, touchIcon) {
      assert.equal(actionId, 'dodge');
      assert.equal(touchIcon, '🧗');
      return 'Space';
    },
    getLastInputDevice() { return 'keyboard'; },
  },
  ClimbSystem: {
    get debug() { return { mountRideState: rideState }; },
    getClimbTarget() { return target; },
    startClimb(value) { startedWith = value; return true; },
  },
  PlayerChat: { isOpen: false },
  setInterval() { return 7; },
};
window.window = window;

const context = vm.createContext({ window, document, console, Object, Number, String });
vm.runInContext(source, context, { filename: 'climb-proximity-prompt.js' });

const Prompt = window.HobunjiClimbPrompt;
assert.ok(Prompt, 'climb prompt API is exported');
assert.equal(Prompt.getDebug().pollRunning, true, 'proximity polling is active');
assert.equal(Prompt.getDebug().pollMs, 100, 'climbability checks are throttled rather than run every render frame');
assert.equal(Prompt.getDebug().actionId, 'dodge', 'prompt mirrors the existing dodge/climb binding');

target = { type: 'wall', id: 'plateau' };
Prompt.refresh();
let el = document.getElementById('climbProximityPrompt');
assert.ok(el, 'prompt DOM is created on first climbable target');
assert.equal(el.classList.contains('open'), true, 'plateau target opens the prompt');
assert.equal(el.textContent, '[Space] Climb Plateau', 'plateau prompt names the real rebound input and action');
assert.equal(el.dataset.targetType, 'wall');

target = { type: 'roof', id: 'house' };
Prompt.refresh();
assert.equal(el.textContent, '[Space] Climb Building', 'structural roof target uses the building climb label');
assert.equal(el.dataset.targetType, 'roof');
assert.equal(Prompt.activateCurrentTarget(), true, 'click/touch activation delegates to ClimbSystem');
assert.equal(startedWith.id, 'house', 'the currently re-resolved building target is passed through unchanged');
assert.equal(el.classList.contains('open'), false, 'prompt hides as soon as the climb starts');

target = { type: 'branch', id: 'tree' };
rideState = 'mounted';
Prompt.refresh();
assert.equal(el.classList.contains('open'), false, 'mounted branch targets do not advertise an unavailable climb');
assert.equal(Prompt.getDebug().reason, 'target requires dismounting');

target = { type: 'wall', id: 'mounted-plateau' };
Prompt.refresh();
assert.equal(el.classList.contains('open'), true, 'mounted plateau target remains advertised because it delegates to the mount leap');

target = null;
rideState = 'none';
Prompt.refresh();
assert.equal(el.classList.contains('open'), false, 'prompt disappears when no climb target is available');

console.log('climb proximity prompt tests passed');
