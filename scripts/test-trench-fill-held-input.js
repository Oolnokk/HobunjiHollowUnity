#!/usr/bin/env node
'use strict';

// Regression: shovel Fill is a held, multi-stage tool action even when it is
// bound to Action 3 instead of Action 1, and a shallow trench must honor Fill.
const assert = require('node:assert/strict');
const fs = require('node:fs');

const game = fs.readFileSync('docs/game.js', 'utf8');

function braceBlockAt(source, start) {
  const headerEnd = source.indexOf(') {', start); // Skip braces inside default-argument template literals.
  const open = headerEnd < 0 ? -1 : headerEnd + 2;
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
  "const heldMode = 'tool', flaskActionPresses = new Set(), visibleWeaponContextPresses = new Set(), heldItemActionPresses = new Set(), torchThrowActionPresses = new Set();", // The isolated fixture supplies all production release ownership sets.
  "const window = {};",
  "function weaponActionSlot() { return null; }",
  "function actionButtonForPhysicalSlot(index) { return buttons[index] || null; }",
  "function canUseAction(tool, action) { return tool === 'shovel' && allowed(action); }",
  digFill,
  "function wouldStartCharge(tool, action) { return chargeable(resolveDigFillAction(tool, action, {col: 2, row: 3})); }",
  "function useActiveAction() { activeAction = resolveDigFillAction(activeTool, activeAction, {col: 2, row: 3}); selected.push(activeAction); }",
  slotPress,
  "function releaseAction(actionId, source = 'game-input') { const phase = 'release'; " + releaseBranch + " }",
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

// Run the real HUD default-selection block and charge updater together. A
// shallow trench offers Redig first, even while the player explicitly holds Fill.
const hudStart = game.indexOf('const first = nonClimbBtns.find(');
const hudEnd = game.indexOf('// The dodge button is climbing', hudStart);
assert(hudStart >= 0 && hudEnd > hudStart, 'HUD default selection must exist');
const selectDefault = game.slice(hudStart, hudEnd);
const chargeUpdate = productionFunction('updateChargeAction');
const makeHudCharge = Function('initialAction', 'buttons', 'depth', 'currentArea', 'permission', [
  "let activeTool = 'shovel', activeAction = initialAction, heldMode = 'tool', actionHeldDown = true, toolSwingT = 0, chargeAnimOverride = null;",
  "const TileType = { TRENCH: 'trench', GRASS: 'grass', ROCK: 'rock' }, CropType = { NONE: null };",
  "const tile = {type: 'trench', depth, water: 0.5, crop: null};",
  "const grid = []; grid[3] = []; grid[3][2] = tile;",
  "const effects = {farmWater:0, dirty:0, farmSave:0, zoneDelta:0, zoneRefresh:0, memberSave:0};",
  "const window = { GridTileAccessors: {getActiveGrid: () => grid, isHouseFootprint: () => false}, HudUpdate: {contextualActionLabel: a => a}, FormatUtils: {actionName: a => a}, WaterSystem: {recomputeWater: () => effects.farmWater++}, FarmEditor: {saveFarmLayout: () => effects.farmSave++}, ZoneRegrowth: {refreshZoneGroundVisuals: () => effects.zoneRefresh++} };",
  "const tileStyles = {grass: {label:'Grass'}};",
  "const _isZoneArea = area => area === 'wilderness';",
  "const markTileDirty = () => effects.dirty++, recordWildernessChunkTileDelta = () => effects.zoneDelta++, saveMemberWorldData = () => effects.memberSave++;",
  "let canceled = null, lastActionMessage = '', reticle = {col: 2, row: 3};",
  "const hasFarmPermission = () => permission;",
  "function debugLog() {} function showToast() {} function awardToolUseMasteryXp() {}",
  "function cancelChargeAction(reason) { canceled = reason; chargeAction = null; }",
  "function getReticleTile() { return reticle; }",
  "function spawnActionParticles() {} function beginChargeStage() {}",
  game.slice(game.indexOf('const REFILL_FLOURISH_REP ='), game.indexOf(';', game.indexOf('const FILL_TRENCH_STAGES =')) + 1),
  "let chargeAction = { tool: activeTool, action: initialAction, col: 2, row: 3, stage: 0, stages: FILL_TRENCH_STAGES };",
  productionFunction('canUseAction'),
  productionFunction('applyAction'),
  productionFunction('farmActionPermissionCategory'),
  productionFunction('completeChargeAction'),
  chargeUpdate,
  "function refresh(nonClimbBtns) {" + selectDefault + "}",
  "function refreshActionBar() { refresh(buttons); }",
  "return { refresh: refreshActionBar, tick: updateChargeAction, release: () => { actionHeldDown = false; }, move: () => { reticle = {col: 3, row: 3}; }, select: action => { activeAction = action; }, stow: () => { heldMode = 'item'; }, switchTool: () => { activeTool = 'hoe'; }, stageCount: FILL_TRENCH_STAGES.length, state: () => ({ activeAction, canceled, active: !!chargeAction, tile: {...tile}, effects: {...effects} }) };",
].join('\n'));
const offered = [{action:'dig', allowed:true, style:'primary'}, {action:'fill', allowed:true, style:'secondary'}];
for (const area of ['farm', 'wilderness']) {
  for (const depth of [0.5, 1]) {
    const buttons = depth === 1 ? [{...offered[0], allowed:false}, offered[1]] : offered;
    const hudFill = makeHudCharge('fill', buttons, depth, area, true);
    for (let stage = 0; stage < hudFill.stageCount; stage++) {
      hudFill.refresh();
      assert.equal(hudFill.state().activeAction, 'fill', 'HUD cannot replace an explicit in-progress Fill');
      assert.equal(hudFill.state().tile.type, 'trench', 'no terrain mutation before the last stage');
      hudFill.tick();
    }
    assert.equal(hudFill.state().active, false, 'Fill charge ends after its actual stage count');
    assert.equal(hudFill.state().tile.type, 'grass', 'Fill restores actual terrain after all stages');
    assert.equal(hudFill.state().tile.water, 0, 'Fill clears trench water');
    assert.equal(hudFill.state().effects.memberSave, 1, 'completed Fill saves once');
    assert.equal(hudFill.state().effects.farmSave, area === 'farm' ? 1 : 0);
    assert.equal(hudFill.state().effects.farmWater, area === 'farm' ? 1 : 0);
    assert.equal(hudFill.state().effects.dirty, area === 'farm' ? 1 : 0);
    assert.equal(hudFill.state().effects.zoneDelta, area === 'wilderness' ? 1 : 0);
    assert.equal(hudFill.state().effects.zoneRefresh, area === 'wilderness' ? 1 : 0);
  }
}
const denied = makeHudCharge('fill', offered, 0.5, 'farm', false);
for (let stage = 0; stage < denied.stageCount; stage++) { denied.refresh(); denied.tick(); }
assert.equal(denied.state().tile.type, 'trench', 'permission is rechecked before filling');
assert.equal(denied.state().effects.memberSave, 0);
for (const [interrupt, reason] of [['release', 'input released'], ['move', 'reticle moved'], ['select', 'tool/action changed'], ['stow', 'tool/action changed'], ['switchTool', 'tool/action changed']]) {
  const held = makeHudCharge('fill', offered, 0.5, 'farm', true);
  held[interrupt]('dig');
  held.refresh();
  held.tick();
  assert.equal(held.state().canceled, reason, 'actual input, equipment or target changes must still cancel');
  assert.equal(held.state().tile.type, 'trench', 'canceled Fill cannot mutate terrain');
  assert.equal(held.state().effects.memberSave, 0, 'canceled Fill cannot save a mutation');
}
const idle = makeHudCharge('fill', offered, 0.5, 'farm', true);
idle.release(); idle.tick(); idle.refresh();
assert.equal(idle.state().activeAction, 'dig', 'normal HUD default selection resumes after cancellation');

assert.match(game, /startChargeAction\(_chargeReticle, activeAction === 'fill' \? FILL_TRENCH_STAGES : _digStages\)/, 'actual resolved Fill must choose the fill stages');
assert.match(game, /action: activeAction,\s*tool: activeTool,/, 'charge must commit the same resolved action it animates');
assert.match(game, /cancelChargeAction\('input released'\)/, 'held-action release should report a useful mobile debug reason');
assert.match(game, /cancelChargeAction\('reticle moved'\)/, 'reticle movement should report its cancellation reason');
assert.match(game, /\? 'Hold to Fill'/, 'an available trench Fill action must be visibly labeled as held');
assert.match(game, /\? 'Hold to Dig'/, 'new trench excavation must also be visibly labeled as held');
assert.match(game, /action === 'dig' && tile\.type !== TileType\.TRENCH/, 'already dug shallow trenches keep single-tap Redig wording');

console.log('shovel trench fill controller/keyboard hold: ok');
