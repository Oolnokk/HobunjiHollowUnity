'use strict';
// Regression: touch action-arch ruin controls must dispatch the same onPress as keyboard/controller claims.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const game = fs.readFileSync('docs/game.js', 'utf8'); // Real action-bar handler under test.
const ruin = fs.readFileSync('docs/js/dev-random-ruin-interactions.js', 'utf8'); // Authoritative V50 interaction dispatcher.

function between(source, first, last) {
  const a = source.indexOf(first), b = source.indexOf(last, a + first.length);
  assert(a >= 0 && b > a, 'integration seam missing: ' + first);
  return source.slice(a, b);
}
const dispatchSource = between(game,
  "        if (activeAction.startsWith('dev_ruin_world_') && window.DevRandomRuinInteractions?.invokeDoorAction?.(activeAction)) {",
  "        if (activeTool === 'shovel') {"); // Runs the real mobile useActiveAction branch before any tool dispatch.
const calls = []; // Records which synthetic action reaches a real ruin handler.
let refreshes = 0; // Verifies a dispatched action refreshes the arch but stale actions do not.
const state = {
  activeAction: '',
  refreshActionBar() { refreshes++; },
  window: { DevRandomRuinInteractions: {
    invokeDoorAction(action) { if (action === 'dev_ruin_world_3') { calls.push('door'); return true; } return false; },
    invokeAction(action) { calls.push(action); return action !== 'dev_ruin_world_fixed_action1_stale'; },
  } },
};
const dispatch = vm.runInNewContext('(function(){' + dispatchSource + '})', state);
state.activeAction = 'dev_ruin_world_fixed_action1_0'; // Chest claimAction1 uses a fixed Action 1 identifier.
dispatch();
assert.deepEqual(calls, ['dev_ruin_world_fixed_action1_0']);
assert.equal(refreshes, 1);
state.activeAction = 'dev_ruin_world_0'; // Other generated controls use the indexed semantic slot form.
dispatch();
assert.deepEqual(calls, ['dev_ruin_world_fixed_action1_0', 'dev_ruin_world_0']);
assert.equal(refreshes, 2);
state.activeAction = 'dev_ruin_world_3'; // Keep the existing dedicated transit-door dispatch.
dispatch();
assert.deepEqual(calls.at(-1), 'door');
assert.equal(refreshes, 3);
state.activeAction = 'dev_ruin_world_fixed_action1_stale';
dispatch();
assert.equal(refreshes, 3, 'stale touch requests cannot cause a tool or loot action');

const methodSource = between(ruin, '    invokeAction(action) {', '    invoke(index = 0) {');
let opened = 0, other = 0, inRuin = true; // Tracks real versus stale chest presses and current area.
const chest = { action: 'dev_ruin_world_fixed_action1_0', key: 'simple|0|dungeonchest|cache-a', onPress() { opened++; } }; // Represents the exposed canonical chest control.
let fresh = [chest]; // Fresh 12.5 Hz resolver snapshot, mutated to simulate leaving reach/reassignment.
const context = { inRuin: () => inRuin, lastRows: [chest], refreshRows: () => fresh };
const native = vm.runInNewContext('({' + methodSource + '})', context);
assert.equal(native.invokeAction(chest.action), true);
assert.equal(opened, 1, 'touch action invokes the real chest lock-opening callback');
fresh = [{ ...chest, key: 'simple|0|dungeonchest|cache-b', onPress() { other++; } }];
assert.equal(native.invokeAction(chest.action), false, 'reused physical slot must not open another chest');
assert.equal(opened, 1);
assert.equal(other, 0);
fresh = [];
assert.equal(native.invokeAction(chest.action), false, 'vanished chest is no longer actionable');
fresh = [chest];
inRuin = false;
assert.equal(native.invokeAction(chest.action), false, 'leaving the ruin clears authority to activate old buttons');
inRuin = true;
assert.equal(native.invokeAction('dev_ruin_world_fixed_action1_missing'), false, 'unadvertised actions are ignored');
// Verify the primary mobile pathway too. A chest's Action 1 claim is dispatched on
// pointerdown, before the generic useActiveAction fallback this patch repairs.
const claimsSource = fs.readFileSync('docs/js/world-action-input-claims.js', 'utf8'); // Actual shared physical input router, not a mock.
const claimsWindow = { addEventListener() {} }; // Simulates a real tab without subscribing to global browser events.
vm.runInNewContext(claimsSource, {
  window: claimsWindow, document: { hidden: false, addEventListener() {} }, console,
});
let claimedChestOpens = 0; // Real routed Action 1 presses, counted across repeated and paired releases.
const claimRow = {
  action: 'dev_ruin_world_fixed_action1_0', kind: 'dungeonchest', label: 'Open Weathered Dungeon Chest',
  inputAction: 'action1', priority: 22, nativeInput: false, onPress() { claimedChestOpens++; },
}; // Same fields produced by the authoritative ruin mapper for a discovered chest.
const claimContext = {
  window: { WorldActionInputClaims: claimsWindow.WorldActionInputClaims,
    AdventuringTools: { isHoldingTorch: () => false } },
  PROXIMITY_DOOR_KINDS: new Set(['transitdoor', 'v50nativetransitdoor']),
  INPUT_CLAIM_OWNER: 'dev-random-ruin',
};
const syncSource = between(ruin, '  function syncInputClaims(rows) {', '\n\n  // Distance is deliberately left out:');
const syncClaims = vm.runInNewContext(syncSource + '\nsyncInputClaims', claimContext);
syncClaims([claimRow]);
const route = claimsWindow.GameplayInputRouter.route; // Real input router receives physical touch and keyboard events.
assert.equal(route('action1', 'press', { source: 'touch-arch:7' }), true);
assert.equal(claimedChestOpens, 1, 'normal touch pointerdown already reaches chest.onPress via claims');
assert.equal(route('action1', 'press', { source: 'touch-arch:7' }), true);
assert.equal(claimedChestOpens, 1, 'touch repeats cannot double-open a chest');
assert.equal(route('action1', 'release', { source: 'touch-arch:7' }), true);
assert.equal(route('action1', 'press', { source: 'controller:Button0' }), true);
assert.equal(claimedChestOpens, 2, 'controller uses same canonical claim');
assert.equal(route('action1', 'release', { source: 'controller:Button0' }), true);
claimsWindow.WorldActionInputClaims.clearClaims('dev-random-ruin');
assert.equal(route('action1', 'press', { source: 'touch-arch:8' }), false,
  'lost claim falls back to generic action handling rather than activating a stale chest');

console.log('hidden ruin chest touch input: primary claims, fallback, door dispatch and stale-action guards PASS');
