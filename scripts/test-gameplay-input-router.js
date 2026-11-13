#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict'); // Used to verify exclusive ownership and combat suppression.
const fs = require('node:fs'); // Used to load the browser modules under test unchanged.
const vm = require('node:vm'); // Runs actual IIFE modules against a small synthetic DOM.

let elapsedMs = 0; // Advances simulated physical press duration without timers.
let combatActive = false; // Injected player-in-combat flag for hold latch checks.
let visibleOverride = null; // Simulates a visible Action 1/2 contextual replacement.
let attackCount = 0; // Counts actual legacy tap attacks emitted by the combat input state machine.
const listenerMap = new Map(); // Stores registered window listeners for cancellation regression cases.
const document = {
  readyState: 'loading',
  hidden: false,
  addEventListener() {},
  getElementById() { return null; },
  querySelector() { return null; },
};
const window = {
  addEventListener(type, fn) { listenerMap.set(type, fn); },
  dispatchEvent() {},
  Combat: {
    loadout: { getSlot() { return null; } },
    abilities: { get() { return null; } },
    deps: { player: {}, fireLegacyWeaponAction() { attackCount++; } },
    isStaggered() { return false; },
    update() {},
  },
};
const context = vm.createContext({
  window, document,
  performance: { now: () => elapsedMs },
  console, setTimeout, clearTimeout,
  CustomEvent: class CustomEvent { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
});
vm.runInContext(fs.readFileSync('docs/js/world-action-input-claims.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('docs/js/combat/combat-input.js', 'utf8'), context);
const router = window.GameplayInputRouter; // Single authority exported alongside the legacy provider alias.
const combatInput = window.Combat.input; // Real tap/hold implementation wired to the common guard.
assert.equal(window.WorldActionInputClaims, router);
router.configure({ isInCombat: () => combatActive, isContextOverride: action => visibleOverride === action });

assert.equal(router.isAttackBlocked(), false);
assert.equal(router.resolve('action1').kind, 'default');
let claimsFired = 0; // Ensures a claimed input does not run both the interaction and fallback.
let releases = 0; // Ensures releases go to the owner that received the original press.
router.setClaims('other-action', [{ actionId: 'action3', priority: 5, onPress() { claimsFired++; } }]);
assert.equal(router.isAttackBlocked(), false, 'Action 3 never disables attacks');
assert.equal(router.route('action3', 'press', { source: 'test' }, () => { throw Error('fallback leaked'); }), true);
assert.equal(claimsFired, 1);
router.clearClaims('other-action');
assert.equal(router.route('action3', 'press'), true, 'repeat stays owned after claim disappears');
assert.equal(router.route('action3', 'release'), true);
assert.equal(router.route('action3', 'press', null, () => true), true, 'unclaimed fallback can handle other actions');

router.setClaims('context-one', [{ actionId: 'action1', priority: 25, onPress() { claimsFired++; }, onRelease() { releases++; } }]);
router.setClaims('context-two', [{ actionId: 'action1', priority: 100, onPress() { claimsFired += 10; }, onRelease() { releases += 10; } }]);
assert.equal(router.resolve('action1').ownerId, 'context-two', 'higher-priority world interaction owns the action');
assert.equal(router.isAttackBlocked(), true, 'an advertised Action 1 override disables attacks even before press');
assert.equal(router.route('action1', 'press'), true);
assert.equal(claimsFired, 11);
router.clearClaims('context-two');
router.clearClaims('context-one');
assert.equal(router.isAttackBlocked(), true, 'press stays owned even if the reticle or prompt changes');
router.route('action1', 'release');
assert.equal(releases, 10);
assert.equal(router.isAttackBlocked(), false);
visibleOverride = 'action2';
assert.equal(router.isAttackBlocked(), true, 'a visible Action 2 non-combat replacement also blocks all attacks');
visibleOverride = 'action3';
assert.equal(router.isAttackBlocked(), false, 'a contextual Action 3 replacement does not block attacks');
visibleOverride = null;

assert.equal(router.beginContextPress('touch:17', 'action3', 'Non-combat third action'), false, 'only Action 1/2 contextual presses suppress attacks');
assert.equal(router.beginContextPress('touch:17', 'action1', 'Search skeleton'), true);
assert.equal(router.isAttackBlocked(), true, 'a contextual Action 1 press keeps blocking after the prompt disappears');
assert.equal(router.resolve('action1').kind, 'context-press', 'contextual press owner survives UI disappearance');
assert.equal(router.beginContextPress('touch:17', 'action1', 'Different label'), true, 'repeat does not transfer ownership');
assert.equal(router.snapshot().contextPresses.length, 1, 'repeat does not create duplicate owners');
assert.equal(router.beginContextPress('mouse:2', 'action2', 'Talk'), true);
assert.equal(router.endContextPress('touch:17'), true);
assert.equal(router.isAttackBlocked(), true, 'other device contextual press remains owned');
assert.equal(router.endContextPress('mouse:2'), true);
assert.equal(router.isAttackBlocked(), false, 'last physical release restores attack permission');
assert.equal(router.endContextPress('touch:17'), false, 'duplicate release has no effect');

router.beginContextPress('keyboard:action1', 'action1', 'Inspect statue');
listenerMap.get('blur')?.();
assert.equal(router.isAttackBlocked(), false, 'blur clears stale contextual ownership');
assert.equal(router.snapshot().contextPresses.length, 0);

for (const kind of ['bandit_tent_interact', 'corpse_hold_loot', 'nest_take', 'other_hold_interaction']) {
  combatActive = true;
  assert.equal(router.canContinueHold(kind, true), false, kind + ' cannot start in combat');
  combatActive = false;
  assert.equal(router.canContinueHold(kind, true), false, kind + ' remains interrupted after combat ends mid-hold');
  assert.equal(router.canContinueHold(kind, false), false);
  assert.equal(router.canContinueHold(kind, true), true, kind + ' can restart on a new press');
  assert.equal(router.canContinueHold(kind, false), false);
}

combatInput.pressStart(1);
elapsedMs += 80;
combatInput.pressEnd(1);
assert.equal(attackCount, 1, 'an unclaimed quick tap still fires normally');

combatInput.pressStart(1);
router.setClaims('new-context', [{ actionId: 'action2', priority: 50 }]);
elapsedMs += 90;
combatInput.pressEnd(1);
assert.equal(attackCount, 1, 'a newly advertised Action 2 override cancels an already-pressed Action 1 tap');
assert.equal(combatInput.getState(1).down, false);
router.clearClaims('new-context');

combatInput.pressStart(1);
router.beginContextPress('touch:22', 'action2', 'Take egg');
elapsedMs += 350;
combatInput.update(0.35);
router.endContextPress('touch:22');
combatInput.pressEnd(1);
assert.equal(attackCount, 1, 'same held attack cannot restart when a temporarily claimed Action 2 releases');

combatInput.pressStart(1);
visibleOverride = 'action1';
elapsedMs += 350;
combatInput.update(0.35);
visibleOverride = null;
combatInput.pressEnd(1);
assert.equal(attackCount, 1, 'an interrupted hold does not change into a tap on release');
assert.equal(combatInput.getState(1).down, false);

visibleOverride = 'action2';
combatInput.fireTap(1);
combatInput.pressStart(1);
assert.equal(combatInput.getState(1).down, false, 'blocked context cannot start a weapon hold');
assert.equal(attackCount, 1, 'direct legacy attack dispatch checks the same shared router');
visibleOverride = null;
combatInput.pressStart(2);
elapsedMs += 30;
combatInput.pressEnd(2);
assert.equal(attackCount, 2, 'normal Action 2 attacks resume after contextual ownership clears');

assert.ok(fs.readFileSync('docs/index.html', 'utf8').includes('world-action-input-claims.js?v='), 'the canonical input router must load in the game');
console.log('gameplay input router: input priority, tap/hold, context changes, combat holds and Attack 1/2 suppression passed');
