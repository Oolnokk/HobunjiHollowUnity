#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const game = source('docs/game.js');
const index = source('docs/index.html');
const bridge = source('docs/js/alcohol-gameplay-bridge.js');
const editor = source('docs/tools/attack-animation-editor/index.html');
const pixelProbe = source('docs/js/pixel-probe.js');
const heldAnimations = source('docs/js/held-action-animations.js');
const heldItemActionInput = source('docs/js/held-item-action-input.js');
const loader = source('docs/js/combat/combat-config-loader.js');

const context = {
  window: { addEventListener: () => {} }, console, URL, Promise,
  location: { href: 'https://example.test/docs/index.html', pathname: '/docs/index.html' },
  document: { currentScript: { src: 'https://example.test/docs/js/held-action-animations.js' }, readyState: 'loading', write: () => {} },
};
vm.runInNewContext(heldAnimations, context);
const drink = context.window.HeldActionAnimations?.drink;
assert.equal(drink?.style, 'drink', 'shared held-action data defines the drink style');
assert(drink.durationS > 0 && drink.windupFrac < drink.strikeFrac && drink.strikeFrac <= drink.holdFrac,
  'drink animation timing is positive and ordered');
const numericDrinkPoses = Object.fromEntries(Object.entries(drink.poses).map(([phase, pose]) => [phase, Object.fromEntries(['x','y','z','pitch','yaw','roll','bodyYaw'].map(channel => [channel, pose[channel]]))]));
assert.deepEqual(JSON.parse(JSON.stringify(numericDrinkPoses)), {
  neutral: { x: 0, y: 0, z: -0.05, pitch: 10.31, yaw: 0, roll: 0, bodyYaw: 0 },
  windup: { x: 0.32, y: 0.21, z: 0.1, pitch: -114, yaw: 18, roll: -8, bodyYaw: 0 },
  strike: { x: 0.4, y: 0.4, z: 0.22, pitch: -180, yaw: 21, roll: 4, bodyYaw: 0 },
}, 'the shared definition preserves the exact neutral and action poses from Drink.json');
for (const phase of ['neutral', 'windup', 'strike']) {
  for (const channel of ['x', 'y', 'z', 'pitch', 'yaw', 'roll', 'bodyYaw']) {
    assert(Number.isFinite(drink.poses[phase][channel]), `${phase}.${channel} is authorable numeric pose data`);
  }
}

assert(index.indexOf('js/held-action-animations.js') < index.indexOf('game.js?v='),
  'the shared held-action data loads before game.js');
assert((game.match(/bScene\.add\(toolHolder\)/g) || []).length >= 2,
  'both authored and fallback building loaders attach held tools');
assert.match(game, /function enterBuilding[\s\S]*?bi\.scene\.add\(toolHolder\)/,
  'entering an already-loaded building attaches held tools');
assert.match(game, /function enterInterior[\s\S]*?interiorScene\.add\(toolHolder\)/,
  'the farmhouse interior attaches held tools');
assert.match(game, /function exitBuilding[\s\S]*?fromScene\.remove\(toolHolder\)/,
  'building exit removes the tool holder from its old scene');
assert.match(game, /updateToolMesh\(dt\);[\s\S]{0,120}\/\/ Combat and targeting remain limited[\s\S]*?if \(currentArea === 'farm'/,
  'held-object animation runs everywhere without enabling ordinary-interior combat');

// Begin/cancel/hold/release/strike semantics replace the old one-shot
// trigger-and-play-to-completion animation (see held-item-action-input.js's
// generic press/hold/cancel/arm/release controller for the input side).
assert.match(game, /function beginHeldDrinkAnimation[\s\S]*?HeldActionAnimations\?\.drink[\s\S]*?_heldDrinkPhase = 'toWindup'/,
  'the runtime begins the shared authored drink animation toward its windup pose on press');
assert.match(game, /function continueHeldDrinkAnimation\(\)[\s\S]*?_heldDrinkPhase = 'toStrike'/,
  'releasing an armed hold lets the animation continue from windup through to strike/recovery');
assert.match(game, /function cancelHeldDrinkAnimation\(\)[\s\S]*?_heldDrinkPhase = 'canceling'/,
  'releasing before the hold arms eases the animation back to neutral instead of committing');
assert.match(game, /function abortHeldDrinkAnimation\(\)[\s\S]*?_heldDrinkPhase = null/,
  'a forced loss of input ownership snaps the animation back to neutral without ever committing');
assert.match(game, /_heldDrinkPhase === 'toWindup' && _heldDrinkProgress >= ceiling[\s\S]*?_heldDrinkPhase = 'pausedAtWindup'/,
  'the animation pauses itself at the authored windup pose while still armed and held');
assert.match(game, /_heldDrinkPhase === 'toStrike' && !_heldDrinkApplied && _heldDrinkProgress >= \(animation\.strikeFrac/,
  'the held-item effect commits exactly once, at the strike frame, not on press or threshold-crossing');
assert.match(game, /heldMode === 'item' \|\| _heldDrinkPhase/,
  'the consumed item remains rendered through the full begin/hold/strike/recovery animation');
assert.match(game, /window\.FarmCrates\?\.init\(\{[\s\S]*?beginHeldDrinkAnimation,[\s\S]*?continueHeldDrinkAnimation,[\s\S]*?cancelHeldDrinkAnimation,[\s\S]*?abortHeldDrinkAnimation,/,
  'the consumption bridge receives the runtime begin/continue/cancel/abort animation controls');
assert.match(bridge, /itemDeps\.beginHeldDrinkAnimation\?\.\(key, commit\)[\s\S]*?degrade to immediate consumption/,
  'beginning a held food\\/drink action starts the shared windup, falling back to immediate consumption only if unavailable');
assert.match(bridge, /function commitHeldConsumable\(expectedKey\)[\s\S]*?const held = getHeldConsumable\(\);[\s\S]*?held\.key !== expectedKey/,
  'the commit-only mutation revalidates the held item/key fresh at the strike frame instead of trusting press-time state');
assert.match(bridge, /function lockAfterHeldConsumeCommit\(\)[\s\S]*?tailMs/,
  'a fresh hold is locked out until the strike-to-neutral recovery tail has had time to finish');

// The generic held-item hold controller owns press/hold/cancel/arm/release
// timing, sharing the same hold threshold as heavy weapon attacks.
assert.match(heldItemActionInput, /window\.Combat\?\.input\?\.HOLD_THRESHOLD_S/,
  'the held-item hold controller reuses the shared combat hold threshold instead of its own timer');
assert.match(heldItemActionInput, /function begin\(key, descriptor\)[\s\S]*?descriptor\.startVisual\(\)/,
  'begin() starts the caller-supplied visual immediately on press');
assert.match(heldItemActionInput, /function release\(\)[\s\S]*?if \(armed\) descriptor\.resumeVisual\?\.\(\);[\s\S]*?else descriptor\.cancelVisual\?\.\(\);/,
  'release() resumes an armed hold through to commit or cancels an unarmed tap back to neutral');
assert.match(heldItemActionInput, /function abort\(\)[\s\S]*?descriptor\.abortVisual\?\.\(\);/,
  'abort() forces a safe return to neutral on blur/menu/input-owner loss');
assert.match(heldItemActionInput, /window\.addEventListener\('blur', abort\)/,
  'a lost release (alt-tab, notification) aborts rather than leaving an item half-consumed');
assert.match(loader, /held-item-action-input\.js/,
  'the held-item hold controller is part of the compatibility bootstrap load order');

assert(editor.includes('../../js/held-action-animations.js'),
  'the animation editor loads the same drink pose data as the game');
assert.match(editor, /option value="drink"/,
  'the editor exposes drink as an animation style');
assert.match(editor, /bottle_wine\.png'[\s\S]*?animStyle: 'drink'[\s\S]*?scale: 0\.5, flip: true/,
  'the editor bottle matches the in-game held scale and end-for-end orientation');
assert.match(editor, /window\.HeldActionAnimations\?\.drink[\s\S]*?label: 'Bottle — Drink'/,
  'the editor exposes the shared drink animation as a preset');

assert.match(pixelProbe, /Held objects: mode=/,
  'Pixel Probe includes mobile-readable held-object diagnostics');

console.log('Interior held-object and drink-animation checks passed.');
