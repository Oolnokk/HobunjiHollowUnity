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

const context = {
  window: {}, console, URL, Promise,
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
assert.match(game, /updateToolMesh\(dt\);\s*\/\/ Combat and targeting remain limited[\s\S]*?if \(currentArea === 'farm'/,
  'held-object animation runs everywhere without enabling ordinary-interior combat');

assert.match(game, /function triggerHeldDrinkAnimation[\s\S]*?HeldActionAnimations\?\.drink[\s\S]*?_heldDrinkAnimT = _heldDrinkAnimDuration/,
  'the runtime starts the shared authored drink animation');
assert.match(game, /heldMode === 'item' \|\| _heldDrinkAnimT > 0/,
  'the consumed bottle remains rendered through the full animation');
assert.match(game, /window\.FarmCrates\?\.init\(\{[\s\S]*?triggerHeldDrinkAnimation/,
  'the consumption bridge receives the runtime animation trigger');
assert.match(bridge, /triggerHeldDrinkAnimation\?\.\(key, applyDrink\)[\s\S]*?Math\.max\(180, animationMs\)/,
  'successful drinks apply at the animation strike and lock repeats until it finishes');

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
