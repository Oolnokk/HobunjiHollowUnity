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
    disabled: false,
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

const TILE = 64;
const grid = Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => ({ type: 'grass', elevTier: 0, incline: false })));
let sceneObjects = [];
let branches = [];
let target = null;
let startedWith = null;
let rideState = 'none';
const player = { x: 1.5 * TILE, y: 1.5 * TILE, climbing: false, prone: false, dodging: false, lunging: false };
const window = {
  Combat: { deps: { player, TILE, isSolid: type => type === 'wall' } },
  GridTileAccessors: {
    getActiveGrid: () => grid,
    getCurrentArea: () => 'town',
    getActiveScene: () => ({ traverse(fn) { for (const object of sceneObjects) fn(object); } }),
  },
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
    debugBranchesFor() { return branches.slice(); },
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

// Merely standing beside a plateau should advertise climbing even before the
// player's facing cardinal is aligned enough for ClimbSystem.getClimbTarget().
grid[1][2] = { type: 'grass', elevTier: 0, incline: true };
grid[1][3] = { type: 'grass', elevTier: 1, incline: false };
target = null;
Prompt.refresh();
let el = document.getElementById('climbProximityPrompt');
assert.ok(el, 'prompt DOM is created on first nearby climbable surface');
assert.equal(el.classList.contains('open'), true, 'adjacent plateau opens a proximity hint');
assert.equal(el.textContent, '[Space] Climb Plateau — face cliff', 'nearby plateau hint still teaches the rebound climb input');
assert.equal(el.disabled, true, 'proximity-only hint cannot falsely execute a dodge while misaligned');
assert.equal(el.dataset.actionable, 'false');
assert.equal(Prompt.getDebug().proximityOnly, true);

// Remove plateau adjacency and put an authored structural building wall within
// roof-climb's existing 1.75-world-unit range.
grid[1][2] = { type: 'grass', elevTier: 0, incline: false };
grid[1][3] = { type: 'grass', elevTier: 0, incline: false };
sceneObjects = [{
  userData: {
    hobunjiRoofClimbStructure: {
      buildingId: 'house',
      roofs: [{}],
      walls: [{ id: 'wall-a', vertices: [
        { x: 2.5, y: 0, z: 1 }, { x: 2.5, y: 1, z: 1 },
        { x: 2.5, y: 1, z: 2 }, { x: 2.5, y: 0, z: 2 },
      ] }],
    },
  },
}];
Prompt.refresh();
assert.equal(el.textContent, '[Space] Climb Building — face wall', 'being beside an authored climbable building shows the same input hint');
assert.equal(el.disabled, true);
assert.equal(el.dataset.targetType, 'roof');

// Once the real climb system agrees the surface is aligned/targeted, the hint
// becomes actionable and can safely delegate to the actual climb owner.
target = { type: 'wall', id: 'plateau' };
Prompt.refresh();
assert.equal(el.textContent, '[Space] Climb Plateau', 'aligned plateau shows the actionable climb prompt');
assert.equal(el.disabled, false);
assert.equal(el.dataset.actionable, 'true');
assert.equal(Prompt.getDebug().actionable, true);

target = { type: 'roof', id: 'house' };
Prompt.refresh();
assert.equal(el.textContent, '[Space] Climb Building', 'aligned structural roof target uses the building climb label');
assert.equal(el.disabled, false);
assert.equal(Prompt.activateCurrentTarget(), true, 'click/touch activation delegates to ClimbSystem');
assert.equal(startedWith.id, 'house', 'the currently re-resolved building target is passed through unchanged');
assert.equal(el.classList.contains('open'), false, 'prompt hides as soon as the climb starts');

// Branches share the same affordance: nearby hints do not require exact reticle
// alignment, but mounted branches stay hidden because they require dismounting.
target = null;
sceneObjects = [];
branches = [{ id: 'tree', baseX: player.x + 0.5 * TILE, baseY: player.y, felled: false }];
Prompt.refresh();
assert.equal(el.textContent, '[Space] Climb Branch — look at branch');
assert.equal(el.disabled, true);
rideState = 'mounted';
Prompt.refresh();
assert.equal(el.classList.contains('open'), false, 'mounted branch hints do not advertise an unavailable climb');
assert.equal(Prompt.getDebug().reason, 'nearby climbable surface requires dismounting');

// Mounted plateau climbing remains advertised because the existing wall climb
// target delegates to Mounts.startClimbLeap rather than rejecting the action.
branches = [];
target = { type: 'wall', id: 'mounted-plateau' };
Prompt.refresh();
assert.equal(el.classList.contains('open'), true, 'mounted plateau target remains advertised because it delegates to the mount leap');
assert.equal(el.disabled, false);

target = null;
rideState = 'none';
Prompt.refresh();
assert.equal(el.classList.contains('open'), false, 'prompt disappears when no climbable surface is nearby');

console.log('climb proximity prompt tests passed');
