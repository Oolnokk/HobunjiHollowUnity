#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

const camera = read('docs/js/camera-look-clamp.js');
const motion = read('docs/js/dev-random-ruin-motion-runtime.js');
const api = read('docs/tools/debris-ifier/debrisifier-v50-api.js');
const interior = read('docs/js/dev-random-ruin-interior-map.js');
const hooks = read('docs/js/dev-random-ruin-prototype-hooks.js');

const loadOrder = [
  'dynamic-surfaces.js',
  'dev-random-ruin-hit-puzzles-loader.js',
  'dev-random-ruin-prototype-hooks.js',
  'dev-random-ruin-interior-map.js',
  'dev-random-ruin-motion-runtime.js',
].map(name => camera.indexOf(name));
assert(loadOrder.every(index => index >= 0), 'camera bootstrap must load every Random Test Ruin runtime module');
for (let i = 1; i < loadOrder.length; i++) {
  assert(loadOrder[i] > loadOrder[i - 1], 'Random Test Ruin runtime modules must preserve dependency order');
}

assert(interior.includes("const RUIN_TILE_SCALE = 2"), 'generated ruin must retain 2x horizontal cells');
assert(interior.includes("map_i_dev_random_ruin"), 'generated ruin must remain a real session-only interior map');
assert(hooks.includes("generatedAccessType === 'stoneLadder'"), 'prototype hook layer must discover V50 ladders');
assert(hooks.includes("motion === 'elevatorPushBlock'"), 'prototype hook layer must discover elevator push blocks');

assert(api.includes('createRuntimeStoneLadder'), 'V50 bridge must expose the real stone ladder constructor');
assert(api.includes('auditInteriorSeeds'), 'V50 bridge must expose multi-seed runtime-tag auditing');
assert(api.includes('inspectRuntimeTags'), 'V50 bridge must classify runtime-tagged prototype output');
assert(motion.includes('runtimeRecoveryEgress'), 'motion runtime must mark injected recovery ladders');
assert(motion.includes('exactLevelComponents'), 'motion runtime must audit each negative elevation tier');
assert(motion.includes('ridesMovingDais'), 'motion runtime must carry V50 elevator blocks with moving daises');
assert(motion.includes('pushElevatorBlock'), 'elevator push blocks must be interactable in-game');
assert(motion.includes('DevRandomRuinPrototypeHooks?.rebuild'), 'recovery ladders must re-enter the ordinary prototype hook pass');
assert(motion.includes('auditSeeds'), 'game-side motion runtime must expose isolated multi-seed auditing');

const parts = [];
for (let i = 1; i <= 9; i++) {
  const id = String(i).padStart(2, '0');
  const text = read(`docs/js/dev-random-ruin-hit-puzzles-runtime/part${id}.js`);
  const match = text.match(/__devRuinHitParts\.push\('([^']*)'\);/);
  assert(match, `hit-puzzle part ${id} must contain one base64 payload`);
  parts.push(match[1]);
}
const hitSource = Buffer.from(parts.join(''), 'base64').toString('utf8');
assert(hitSource.startsWith('// Dev Random Test Ruin'), 'decoded hit-puzzle source header must be intact');
assert(hitSource.includes('window.DevRandomRuinHitPuzzles'), 'decoded hit runtime must export its public API');
assert(hitSource.includes('TORCH_BURN_MS = 12000'), 'temporary ruin torch must retain its 12-second burn budget');
assert(hitSource.includes('harpoon_fishingmace.png'), 'temporary ruin torch must reuse the fishing-mace sprite');
assert(hitSource.includes('glyphObelisk'), 'decoded hit runtime must support projectile glyph targets');
assert(hitSource.includes('brazier'), 'decoded hit runtime must support physical brazier ignition');
assert(hitSource.includes('installRanged'), 'decoded hit runtime must install a ranged-projectile seam');
assert(hitSource.includes('installCombat'), 'decoded hit runtime must install its torch-sweep combat seam');
new vm.Script(hitSource, { filename: 'dev-random-ruin-hit-puzzles.js' });

console.log('Random Test Ruin integration static audit passed.');
