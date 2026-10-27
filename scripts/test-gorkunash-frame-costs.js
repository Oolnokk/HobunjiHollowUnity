'use strict';

const assert = require('node:assert/strict'); // Behavioral assertions for the two profiled frame hotspots.
const fs = require('node:fs'); // Loads the shipped implementations rather than copies of their logic.
const vm = require('node:vm'); // Runs the owners with controlled inventory, audio, and DOM dependencies.
const game = fs.readFileSync('docs/game.js', 'utf8'); // Inventory owner under test.
const wheelSource = game.slice(game.indexOf('      function matchesPackCategory('), game.indexOf('      function getActiveInventoryItem(')); // Includes the frame cache and both list builders.
const defs = { food: { label: 'Food' }, material: { label: 'Material' }, seed: { label: 'Seed' } }; // Mutable catalog exercises runtime registration.
const stock = { food: 2, material: 4, gold: 99 }; // Count-only changes must not rebuild the wheel.
const catalog = [{ key: 'food' }, { key: 'material' }, { key: 'seed' }]; // Authoritative display order, including non-wheel items.
let eligibilityCalls = 0; // Counts expensive recipe classification across repeated consumers.
const context = vm.createContext({
  inventory: stock, ITEM_DEFS: defs, inventoryItems: catalog, gameFrameSerial: 1, manualHeldItem: null,
  window: { ItemProcessing: { isWheelEligible: key => { eligibilityCalls++; return key !== 'material'; } } },
}); // Shared VM exposes real frame and manual-hold mutations below.
vm.runInContext(wheelSource, context);
const wheel = () => vm.runInContext('getInventoryStackItems()', context); // Calls the real builder without exporting production internals.
const keys = () => Array.from(wheel(), item => item.key); // Normalizes cross-realm arrays for assertions.
assert.deepEqual(keys(), ['food']);
const first = wheel(); // Stable array reused by the same frame's read-only consumers.
for (let i = 0; i < 100; i++) assert.equal(wheel(), first);
assert.equal(eligibilityCalls, 2, 'eligibility is evaluated once per owned item per unchanged frame');
stock.food--;
assert.equal(wheel(), first, 'changing a positive count leaves list membership intact');
stock.seed = 1;
assert.deepEqual(keys(), ['food', 'seed'], 'a newly acquired stack is available in the same frame');
stock.food = 0;
assert.deepEqual(keys(), ['seed'], 'last-item consumption cannot leave a stale held item');
stock.food = 1;
assert.deepEqual(keys(), ['food', 'seed']);
catalog.reverse();
assert.deepEqual(keys(), ['seed', 'food'], 'same-frame catalog reorder invalidates the cache');
const beforeDefinition = wheel(); // Distinguishes definition invalidation from earlier ownership/order rebuilds.
defs.food = { label: 'Changed food' };
assert.notEqual(wheel(), beforeDefinition, 'definition replacement invalidates the cache');
defs.newFood = { label: 'New food', icon: 'F' };
stock.newFood = 1;
stock.invalid = NaN;
assert.deepEqual(keys(), ['seed', 'food', 'newFood'], 'newly registered food gets a fallback wheel entry; invalid stock stays absent');
assert.equal(wheel().find(item => item.key === 'newFood').label, 'NEW FOOD');
context.window.ItemProcessing.isWheelEligible = (key, index, list) => {
  assert(Array.isArray(list), 'eligibility retains the Array.filter callback contract used by Inventory Hold');
  return key === 'material';
};
assert.deepEqual(keys(), ['material'], 'provider replacement is visible immediately');
context.manualHeldItem = { kind: 'bagItem', key: 'food' };
const beforeHold = wheel(); // Manual hold identity changes must invalidate wrapped eligibility.
context.manualHeldItem = null;
assert.notEqual(wheel(), beforeHold);
const beforeFrame = wheel(); // A new frame must reclassify recipes even when ownership and catalog identities are unchanged.
context.gameFrameSerial++;
assert.deepEqual(keys(), ['material']);
assert.notEqual(wheel(), beforeFrame, 'eligibility is refreshed on the next game frame');
context.window.ItemProcessing.isWheelEligible = key => !!defs[key].isCookedFood;
assert.deepEqual(keys(), []);
defs.newFood.isCookedFood = true;
context.gameFrameSerial++;
assert.deepEqual(keys(), ['newFood'], 'in-place recipe registration becomes eligible on the next frame');

const lyre = fs.readFileSync('docs/assets/minigames/lyre-performance.html', 'utf8'); // Shared visible and ambient performance owner.
function functionSource(name) {
  const start = lyre.indexOf(`  function ${name}(`); // Selects one shipped function at its declaration boundary.
  assert(start >= 0, `missing ${name}`);
  const rest = lyre.slice(start + 1); // Finds the following top-level declaration without parsing nested functions.
  const next = rest.search(/^  (?:async )?function /m); // Every selected owner is followed by another top-level function.
  assert(next >= 0, `missing boundary after ${name}`);
  return lyre.slice(start, start + 1 + next);
}
let clock = 100; // Controlled transport time for on-time and late-note behavior.
let audioCalls = 0; // Ensures suppressing visuals does not silence the NPC.
let continuations = 0; // Automatic picked-note scheduling must remain active.
let frames = 0; // Confirms the existing loop keeps its one continuation.
const ambient = vm.createContext({
  state: { ambientOnly: true, paused: false, visualPreset: 'lyre-view', lastHarmonyStep: 0, lastMetronomeBeat: 0,
    hitWindow: 170, demoGeneration: 1, previewCounter: 0,
    game: { active: true, demoActive: true, events: [
      { time: 100, state: 'pending', inputType: 'button', noteIndex: 0, modeOffset: 0, element: null },
      { time: -1000, state: 'pending', inputType: 'strum', noteIndex: 0, element: null },
    ], endAt: 1000, attempts: 0, hits: 0, combo: 0, score: 0 } },
  refs: new Proxy({}, { get() { throw new Error('ambient frame touched the DOM'); } }),
  requestAnimationFrame() { frames++; },
  scheduleTransportAudioAhead() {}, currentHarmonyStep: () => 0,
  rootPadAudioKey: () => 'pluck:0:0', // Stubs the new per-measure audio identity without introducing Web Audio in a frame-layout test.
  randomNpcAutoPickPattern: () => 'arp-forward-8', // Keeps the NPC loop deterministic; pattern selection has its own regression coverage.
  currentHarmonyBeatData: () => ({ absoluteBeat: 0 }), gameTime: () => clock,
  noteMidi: () => 60, arpeggioMidi: () => 48,
  playAuditoryOnlyMidi() { audioCalls++; },
  scheduleSuccessfulPreviewContinuation() { continuations++; }, reportGameplayJudgment() {},
  setTimeout() { throw new Error('ambient scoring scheduled an invisible element removal'); },
}); // Any unexpected layout, DOM access, or visual timer fails this test.
for (const name of ['restartCssAnimation', 'updateHarmonyVisual', 'updateArpeggioUI', 'flashTarget', 'scoreGameEvent', 'feedback', 'updateHUD', 'updateDebugState', 'updateGameFrame', 'pollGamepad']) {
  vm.runInContext(functionSource(name), ambient);
}
vm.runInContext('pollGamepad()', ambient);
assert.equal(frames, 1, 'ambient input polling keeps its continuation without touching the hidden status labels');
frames = 0;
// Use the real preview event owner with a guarded visual target access, just as the production frame does.
vm.runInContext(functionSource('performSuccessfulPreviewEvent'), ambient);
vm.runInContext('updateGameFrame()', ambient);
assert.equal(audioCalls, 1, 'on-time ambient melody still sounds');
assert.equal(continuations, 1, 'automatic melody continuation still schedules');
assert.equal(ambient.state.game.events[0].state, 'hit');
assert.equal(ambient.state.game.events[1].state, 'miss', 'late notes remain skipped instead of bursting');
assert.equal(frames, 1);
ambient.state.game.events = [{ time: 100, state: 'pending', inputType: 'strum', noteIndex: 0, element: null }];
vm.runInContext('updateGameFrame()', ambient);
assert.equal(audioCalls, 2, 'ambient strums still sound without CSS animation');
clock = 2000;
ambient.state.game.loopDemo = true;
ambient.state.selectedSong = 'test-song';
let restarts = 0; // Loop boundary must restart the selected NPC song.
ambient.startSong = (song, options) => { assert.equal(song, 'test-song'); assert.equal(options.loopDemo, true); restarts++; };
vm.runInContext('updateGameFrame()', ambient);
assert.equal(restarts, 1);
assert.equal(frames, 3);

let layoutReads = 0; // Visible player performances retain their stage layout and cue updates.
let cueUpdates = 0; // Confirms the ambient optimization is scoped to NPC-only playback.
ambient.state.ambientOnly = false;
ambient.state.game.events = [];
ambient.state.game.endAt = 5000;
ambient.refs = { stage: { get clientHeight() { layoutReads++; return 400; } } };
ambient.updateFreePlayCapoCue = () => { cueUpdates++; };
ambient.updateDebugState = () => {};
vm.runInContext('updateGameFrame()', ambient);
assert.equal(layoutReads, 1);
assert.equal(cueUpdates, 1);
assert.equal(frames, 4);
console.log('Gorkunash frame costs: wheel reuse, same-frame invalidation, and ambient audio without layout passed.');
