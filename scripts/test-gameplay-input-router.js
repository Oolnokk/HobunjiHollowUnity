#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict'); // Shared input arbitration regression assertions.
const fs = require('node:fs'); // Loads the real browser modules under test.
const vm = require('node:vm'); // Executes game input without starting WebGL.

const script = fs.readFileSync('docs/js/gameplay-input-router.js', 'utf8'); // Central resolver loaded before combat-input.js.
const combatScript = fs.readFileSync('docs/js/combat/combat-input.js', 'utf8'); // Real attack state machine, not a second test implementation.
const game = fs.readFileSync('docs/game.js', 'utf8'); // Ensures every device path feeds the same resolver.
const index = fs.readFileSync('docs/index.html', 'utf8'); // Ensures browser load order is correct.
const calls = []; // Captures actual world-context, attack and release callbacks.
const claims = new Map(); // Simulates the existing WorldActionInputClaims registry's advertised winners.
const pressedWorldClaims = new Set(); // Simulates the production registry's sticky press-to-release records.
let inCombat = false; // Simulates enemy engagement for blocked long interactions.
let visible = null; // Simulates the contextual action currently displayed in weapon slot 1 or 2.
let ticks = 0; // Deterministic test clock for combat-input tap/hold timing.
const combatAbility = { onTap() { calls.push('attack-tap'); }, onHoldStart() { calls.push('attack-hold'); }, onHoldEnd() { calls.push('attack-release'); } }; // Observes whether any attack can leak from an overridden input.
const browser = {
  addEventListener() {}, dispatchEvent() {}, matchMedia: () => ({ matches: true }),
  WorldActionInputClaims: {
    claimFor: id => claims.get(id) || null,
    dispatch(id, phase) {
      if (phase === 'press') { if (!claims.has(id)) return false; pressedWorldClaims.add(id); }
      else if (!pressedWorldClaims.delete(id)) return false;
      calls.push('world-' + phase);
      return true;
    },
  },
  Combat: {
    loadout: { getSlot: () => 'test' }, abilities: { get: () => combatAbility },
    deps: { player: {} }, isStaggered: () => false, update() {},
  },
};
const context = { window: browser, document: { readyState: 'loading', addEventListener() {} },
  console, performance: { now: () => ticks }, localStorage: { setItem() {} }, requestAnimationFrame(fn) { fn(); },
  CustomEvent: function () {} }; // Minimal host for both production scripts.
vm.runInNewContext(script, context, { filename: 'gameplay-input-router.js' });
vm.runInNewContext(combatScript, context, { filename: 'combat-input.js' });
const router = browser.GameplayInputRouter; // Real shared module API.
const input = browser.Combat.input; // Real weapon press/hold implementation.
router.init({
  isInCombat: () => inCombat,
  getContextualOverride: id => visible?.id === id ? { slot: Number(id.slice(-1)), button: { action: visible.action } } : null,
  executeContextualOverride: (id, override) => calls.push('context-' + override.button.action),
  onContextRelease: () => calls.push('context-release'),
});

function reset() { calls.length = 0; visible = null; claims.clear(); inCombat = false; router.cancelAll(); pressedWorldClaims.clear(); input.abortAllPresses(); }
reset();
input.pressStart(1); input.pressEnd(1);
assert.deepEqual(calls, ['attack-tap'], 'ordinary weapon taps still attack');
reset();
visible = { id: 'action1', action: 'obj_open_chest' };
assert(router.blocksAttacks(), 'a displayed Action 1 world override suppresses attacks even before pressing');
assert(router.route('action1', 'press', 'game-input'), 'keyboard claims Action 1 context');
assert.deepEqual(calls, ['context-obj_open_chest'], 'a noncombat tap fires exactly once');
visible = null; // Losing the target cannot transfer an owned hold to combat.
ticks += 300;
input.pressStart(1); input.pressStart(2); input.update(0.3); input.fireTap(1);
assert(!calls.some(s => s.startsWith('attack-')), 'an owned contextual Action 1 hold blocks attacks in both weapon slots');
assert(router.route('action1', 'release', 'game-input'), 'original context consumes release even after target disappears');
assert.deepEqual(calls, ['context-obj_open_chest', 'context-release']);
input.pressStart(1); input.pressEnd(1);
assert(calls.includes('attack-tap'), 'combat input becomes usable on the next fresh press');
reset();
visible = { id: 'action2', action: 'obj_open_door' };
assert(router.blocksAttacks(), 'Action 2 contextual override independently disables both attacks');
assert(router.route('action2', 'press', 'touch-arch'));
input.fireTap(1);
assert(!calls.includes('attack-tap'), 'direct fireTap cannot bypass an Action 2 override');
assert(router.route('action2', 'cancel', 'touch-arch'));
reset();
for (const source of ['desktop-mouse', 'touch-arch', 'game-input']) {
  visible = { id: 'action1', action: 'obj_interact' };
  assert(router.route('action1', 'press', source), source + ' uses the shared resolver');
  visible = null;
  assert(router.route('action1', 'release', source), source + ' retains release ownership');
}
assert.equal(calls.filter(c => c === 'context-obj_interact').length, 3);
reset();
claims.set('action1', { ownerId: 'npc', actionId: 'action1' });
assert(router.blocksAttacks(), 'advertised Action 1 world claims also suppress attacks');
assert(router.route('action1', 'press', 'game-input'));
claims.clear();
assert(router.route('action1', 'release', 'game-input'), 'world-owned release survives proximity changes');
reset();
claims.set('action3', { ownerId: 'puzzle', actionId: 'action3' });
assert.equal(router.blocksAttacks(), false, 'Action 3 context must not disable attack inputs');
assert(router.route('action3', 'press', 'game-input'));
assert(router.route('action3', 'release', 'game-input'));
reset();
inCombat = true;
for (const action of ['nest_take', 'bandit_tent_interact', 'corpse_hold_loot']) {
  assert(router.holdBlocked(action), action + ' is forbidden during combat');
  visible = { id: 'action1', action };
  assert.equal(router.blocksAttacks(), false, action + ' cannot steal the combat slot');
  assert.equal(router.route('action1', 'press', 'game-input'), false);
  assert.equal(router.route('action1', 'release', 'game-input'), false);
  visible = null;
}
inCombat = false;
assert.equal(router.holdBlocked('corpse_hold_loot'), false, 'world holds work again outside combat');
reset();
let providerPress = 0, providerRelease = 0; // Registered generic owners are resolved by priority and paired through release.
const unregister = router.register('test-provider', { priority: 200, resolve: id => id === 'action1'
  ? { onPress: () => { providerPress++; }, onRelease: () => { providerRelease++; } } : null });
assert(router.route('action1', 'press', 'game-input'));
unregister();
assert(router.route('action1', 'release', 'game-input'));
assert.equal(providerPress, 1);
assert.equal(providerRelease, 1, 'unregistering a provider mid-hold does not lose its release');

reset();
visible = { id: 'action1', action: 'obj_inspect' };
assert(router.route('action1', 'press', 'controller'), 'controller can claim Action 1');
assert(router.route('action1', 'press', 'desktop-keyboard'), 'keyboard can independently claim Action 1');
assert(router.owns('action1', 'controller') && router.owns('action1', 'desktop-keyboard'), 'the same semantic button can have distinct physical owners');
assert(router.route('action1', 'release', 'controller'));
assert.equal(router.owns('action1', 'controller'), false);
assert(router.owns('action1', 'desktop-keyboard'), 'controller release must not release keyboard ownership');
assert(router.route('action1', 'release', 'desktop-keyboard'));
reset();
assert.equal(router.route('action1', 'press', 'touch-arch'), false, 'ordinary combat input is passed to its native attack handler');
assert.equal(router.owns('action1', 'touch-arch'), false, 'unclaimed touch presses never strand a router owner');
visible = { id: 'action1', action: 'obj_open_chest' };
assert(router.route('action1', 'press', 'touch-arch'), 'a later contextual tap on that same touch button still works');
assert(router.route('action1', 'release', 'touch-arch'));

assert.match(game, /function runInputAction\(actionId, phase = 'press', source = 'game-input'\)/, 'one shared gameplay dispatcher receives a physical source');
assert.match(game, /runInputAction\(actionId, 'press', 'controller'\)/, 'controller passes its own source');
assert.match(game, /runInputAction\(boundDesktopAction, 'press', 'desktop-keyboard'\)/, 'keyboard passes its own source');

// Exercise the actual game.js contextual resolver against both combat tools.
const contextStart = game.indexOf('      function visibleContextOverrideForCombatTool(actionId) {'); // Uses the real game dispatcher instead of a separate fake weapon/ranged policy.
const contextEnd = game.indexOf('      window.GameplayInputRouter?.init({', contextStart); // Stops before game.js initializes the browser singleton.
assert(contextStart > 0 && contextEnd > contextStart, 'game exports one contextual resolver for both combat tools');
let offeredAction = 'obj_talk'; // Simulated rendered Action 1; weapon/ranged default action ids are unchanged.
let blockedContext = false; // Simulates a forbidden world hold during combat.
const contextScope = {
  heldMode: 'tool', activeTool: 'ranged',
  toolActions: { weapon: ['cut', 'slash'], ranged: ['shoot', 'ammo_select'] },
  actionButtonForPhysicalSlot: slot => ({ action: slot === 1 ? offeredAction : 'ammo_select', allowed: true }),
  window: { GameplayInputRouter: { holdBlocked: () => blockedContext } },
};
vm.runInNewContext(game.slice(contextStart, contextEnd) + '\nwindow.resolveInput = visibleContextOverrideForCombatTool;', contextScope);
assert.equal(contextScope.window.resolveInput('action1')?.button.action, 'obj_talk', 'a ranged tool can give Action 1 to a world interaction');
assert.equal(contextScope.window.resolveInput('action2'), null, 'ordinary ranged Ammo Select is not a contextual overwrite');
offeredAction = 'shoot';
assert.equal(contextScope.window.resolveInput('action1'), null, 'ordinary ranged Shoot leaves attack enabled');
offeredAction = 'nest_take';
blockedContext = true;
assert.equal(contextScope.window.resolveInput('action1'), null, 'ranged shooting is restored when a held world interaction is forbidden by combat');
contextScope.activeTool = 'weapon'; // Function closure follows the mutable runtime tool selection, as in game.js.
blockedContext = false;
assert.equal(contextScope.window.resolveInput('action1')?.button.action, 'nest_take', 'melee tools share the same contextual resolver');

assert.match(index, /world-action-input-claims\.js[\s\S]*gameplay-input-router\.js[\s\S]*combat-input\.js[\s\S]*game\.js/, 'router loads before combat and the game');
assert.match(game, /GameplayInputRouter\?\.init\(/, 'game configures the shared router');
assert.match(game, /GameplayInputRouter\?\.route\?\.\(actionId, phase, source\)/, 'gameplay physical-device routes use the shared owner');
assert.match(game, /getActionHeldDown: \(\) => actionHeldDown && !window\.GameplayInputRouter\?\.holdBlocked/, 'nest/tent/corpse timers use the same combat interruption rule');
console.log('shared gameplay input router: ownership, combat suppression, devices, world holds and release regression tests passed');
