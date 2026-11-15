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
console.log('hidden ruin chest touch input: fixed/indexed/door dispatch and stale-action guards PASS');
