#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..'); // Locates the runtime modules used by the regression test.
const gameSource = fs.readFileSync(path.join(root, 'docs/game.js'), 'utf8'); // Confirms the real game dispatcher remains integrated.
const routerSource = fs.readFileSync(path.join(root, 'docs/js/world-action-input-claims.js'), 'utf8'); // Runs the real device-neutral world-action owner.
let bandaging = true; // Simulates an in-progress bandage for each independently routed physical press.
const cancellations = []; // Captures which real input interrupted bandaging and why.
const actions = []; // Records whether the bandage was cleared before each world-object callback.
const window = {
  BandageSystem: {
    cancel(reason, detail) {
      if (!bandaging) return false;
      cancellations.push({ reason, detail });
      bandaging = false;
      return true;
    },
  },
  addEventListener() {},
};

vm.runInNewContext(routerSource, { window, console, Map, Set, JSON }, { filename: 'world-action-input-claims.js' });
const router = window.GameplayInputRouter; // The same router must serve keyboard, controller, mouse, and touch.
assert.equal(router, window.WorldActionInputClaims, 'legacy and canonical world-action aliases must share ownership');

router.setClaims('nearby-door', [{
  actionId: 'interact',
  label: 'Open door',
  priority: 100,
  onPress: () => actions.push({ action: 'door', bandaging }),
  onRelease: () => actions.push({ action: 'door-release', bandaging }),
}]);
assert.equal(router.resolve('interact').ownerId, 'nearby-door');
assert.equal(router.claimFor('interact').label, 'Open door');
assert.equal(bandaging, true, 'rendering/resolving a contextual prompt cannot cancel bandaging');
assert.equal(router.route('action3', 'press', { source: 'keyboard:X' }), false);
assert.equal(bandaging, true, 'an unclaimed input cannot cancel bandaging');
assert.equal(router.route('interact', 'press', { source: 'keyboard:E' }), true);
assert.deepEqual(actions[0], { action: 'door', bandaging: false }, 'door action executes after bandage cancellation');
assert.equal(cancellations[0].reason, 'world-interaction');
assert.equal(cancellations[0].detail.action, 'interact');
assert.equal(cancellations[0].detail.owner, 'nearby-door');
assert.equal(router.route('interact', 'release', { source: 'keyboard:E' }), true);
assert.equal(actions[1].action, 'door-release', 'original world interaction owns release even after bandage ends');

bandaging = true;
router.setClaims('shattercask', [{
  actionId: 'action1',
  label: 'Pick up',
  priority: 100,
  onPress: () => actions.push({ action: 'pickup', bandaging }),
  onRelease: () => actions.push({ action: 'pickup-release', bandaging }),
}]);
assert.equal(router.route('action1', 'press', { source: 'touch:4' }), true);
assert.equal(actions.at(-1).bandaging, false, 'a world-claimed touch action also cancels before pickup');
bandaging = true;
assert.equal(router.route('action1', 'press', { source: 'touch:4' }), true);
assert.equal(bandaging, true, 'repeated held presses must not cancel a newly started bandage');
assert.equal(router.route('action1', 'release', { source: 'touch:4' }), true);
assert.equal(bandaging, true, 'release must not cancel bandaging');
assert.equal(router.route('action1', 'press', { source: 'controller:RT' }), true);
assert.equal(bandaging, false, 'a new controller press is handled through the same code');

const begin = gameSource.indexOf('      function interruptBandagingForAction('); // Locates the gate in the actual gameplay dispatcher.
const end = gameSource.indexOf('      function useActiveAction()', begin);
assert(begin >= 0 && end > begin, 'gameplay dispatcher must contain a synchronous bandage interruption gate');
const helper = vm.runInNewContext('(() => { ' + gameSource.slice(begin, end) + '; return interruptBandagingForAction; })()', { window });
bandaging = true;
const before = cancellations.length;
for (const passiveAction of [null, '', 'none', 'potion_select', 'ammo_select'])
  assert.equal(helper(passiveAction), false, 'non-actions and passive selectors must not interrupt bandaging');
assert.equal(bandaging, true);
assert.equal(cancellations.length, before);
assert.equal(helper('obj_door_toggle', 'world-interaction'), true);
assert.equal(bandaging, false);
assert.equal(cancellations.at(-1).detail.action, 'obj_door_toggle');
assert.equal(helper('obj_door_toggle'), false, 'duplicate action ownership cannot interrupt twice');

// Guard the early-return integration points without reimplementing their action semantics.
assert.match(gameSource, /interruptBandagingForAction\(activeAction, attackAction \? 'attack' : 'action'\);[\s\S]{0,300}isLocked/);
assert.match(gameSource, /function beginHeldItemActionDescriptor\(action\) \{\s*if \(action === 'consume_held_item' \|\| action\.startsWith\('obj_process_'\)\) interruptBandagingForAction/);
assert.match(gameSource, /btn\.action === 'torch_throw' \|\| btn\.action === 'campfire_menu'\) interruptBandagingForAction/);
assert.match(gameSource, /if \(!btn\) \{ performJumpAction\(\); return; \}/, 'an empty Interact still falls back to Jump');

console.log('Bandage input interruption passed: world callbacks, repeated inputs, passive queries, and special action routing.');
