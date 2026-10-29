#!/usr/bin/env node
'use strict';

// Regression: shovel Fill is a held, multi-stage tool action even when it is
// bound to Action 3 instead of Action 1, and a shallow trench must honor Fill.
const assert = require('node:assert/strict');
const fs = require('node:fs');

const game = fs.readFileSync('docs/game.js', 'utf8');

function braceBlockAt(source, start) {
  const open = source.indexOf('{', start);
  assert(open >= 0, 'expected a body opening brace');
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  assert.fail('unterminated JavaScript body');
}

function productionFunction(name) {
  const start = game.indexOf('function ' + name + '(');
  assert(start >= 0, 'missing ' + name);
  return braceBlockAt(game, start);
}

// Execute the production action-slot and Dig/Fill resolver functions, not
// test-specific copies. The release branch is taken directly from the
// production controller/keyboard input dispatcher.
const slotPress = productionFunction('runActionButtonAtSlot');
const digFill = productionFunction('resolveDigFillAction');
const releaseAnchor = "if (phase === 'release') {\n          if (flaskActionPresses.delete(actionId))";
const releaseStart = game.indexOf(releaseAnchor);
assert(releaseStart >= 0, 'physical-input release branch must exist');
const releaseBranch = braceBlockAt(game, releaseStart);

const makeFixture = Function('buttons', 'allowed', 'chargeable', [
  "let activeTool = 'shovel', activeAction = 'dig', actionHeldDown = false, heldChargeInputId = null;",
  "const selected = [];",
  "const heldMode = 'tool', flaskActionPresses = new Set(), visibleWeaponContextPresses = new Set(), heldItemActionPresses = new Set();",
  "const window = {};",
  "function weaponActionSlot() { return null; }",
  "function actionButtonForPhysicalSlot(index) { return buttons[index] || null; }",
  "function canUseAction(tool, action) { return tool === 'shovel' && allowed(action); }",
  digFill,
  "function wouldStartCharge(tool, action) { return chargeable(resolveDigFillAction(tool, action, {col: 2, row: 3})); }",
  "function useActiveAction() { activeAction = resolveDigFillAction(activeTool, activeAction, {col: 2, row: 3}); selected.push(activeAction); }",
  slotPress,
  "function releaseAction(actionId) { const phase = 'release'; " + releaseBranch + " }",
  "return { press: runActionButtonAtSlot, release: releaseAction, state: () => ({ activeAction, actionHeldDown, heldChargeInputId, selected: selected.slice() }) };",
].join('\n'));

const fullTrench = makeFixture({
  1: { action: 'dig', allowed: false },
  3: { action: 'fill', allowed: true },
}, action => action === 'fill', action => action === 'fill');
fullTrench.press(3);
assert.equal(fullTrench.state().activeAction, 'fill', 'Action 3 must request Fill');
assert.equal(fullTrench.state().actionHeldDown, true, 'Action 3 must keep the charge held across frames');
assert.equal(fullTrench.state().heldChargeInputId, 'action3', 'the physical Action 3 press owns the charge');
fullTrench.release('action1');
assert.equal(fullTrench.state().actionHeldDown, true, 'releasing an unrelated input must not cancel Action 3');
fullTrench.release('action3');
assert.equal(fullTrench.state().actionHeldDown, false, 'releasing Action 3 must cancel its charge');
assert.equal(fullTrench.state().heldChargeInputId, null, 'Action 3 ownership must clear on release');

const shallowTrench = makeFixture({
  1: { action: 'dig', allowed: true },
  3: { action: 'fill', allowed: true },
}, action => action === 'dig' || action === 'fill', action => action === 'fill');
shallowTrench.press(3);
assert.equal(shallowTrench.state().activeAction, 'fill', 'explicit Fill must win over valid Redig on shallow trenches');
assert.equal(shallowTrench.state().actionHeldDown, true, 'shallow-trench Fill is still held');
shallowTrench.release('action3');
assert.equal(shallowTrench.state().actionHeldDown, false);

const remapped = makeFixture({
  2: { action: 'fill', allowed: true },
}, action => action === 'fill', action => action === 'fill');
remapped.press(2, 'action3');
assert.equal(remapped.state().heldChargeInputId, 'action3', 'physical input identity must survive a contextual slot override');
remapped.release('action2');
assert.equal(remapped.state().actionHeldDown, true, 'different physical release must not interrupt overridden slot');
remapped.release('action3');
assert.equal(remapped.state().actionHeldDown, false);

const primary = makeFixture({
  1: { action: 'dig', allowed: true },
}, action => action === 'dig', action => action === 'dig');
primary.press(1);
assert.equal(primary.state().actionHeldDown, true, 'primary digging still holds');
primary.release('action1');
assert.equal(primary.state().actionHeldDown, false, 'primary digging still releases');

const ordinary = makeFixture({
  2: { action: 'raise', allowed: true },
  3: { action: 'smooth', allowed: true },
}, () => false, () => false);
ordinary.press(3);
assert.equal(ordinary.state().actionHeldDown, false, 'non-charged Action 3 remains an ordinary tap');
ordinary.press(2);
assert.equal(ordinary.state().actionHeldDown, false, 'non-charged Action 2 remains an ordinary tap');
assert.equal(ordinary.state().heldChargeInputId, null);

const disabled = makeFixture({
  3: { action: 'fill', allowed: false },
}, action => action === 'fill', action => action === 'fill');
disabled.press(3);
assert.deepEqual(disabled.state().selected, [], 'a disabled action must not execute or claim a hold');

assert.match(game, /startChargeAction\(_chargeReticle, activeAction === 'fill' \? FILL_TRENCH_STAGES : _digStages\)/, 'actual resolved Fill must choose the fill stages');
assert.match(game, /action: activeAction,\s*tool: activeTool,/, 'charge must commit the same resolved action it animates');
assert.match(game, /cancelChargeAction\('input released'\)/, 'held-action release should report a useful mobile debug reason');
assert.match(game, /cancelChargeAction\('reticle moved'\)/, 'reticle movement should report its cancellation reason');

console.log('shovel trench fill controller/keyboard hold: ok');
