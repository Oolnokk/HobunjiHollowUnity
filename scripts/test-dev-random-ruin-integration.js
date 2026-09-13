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
const coverage = read('docs/js/dev-random-ruin-runtime-coverage.js');
const api = read('docs/tools/debris-ifier/debrisifier-v50-api.js');
const debrisBootstrap = read('docs/tools/debris-ifier/debrisifier-01.js');
const debrisSource = read('docs/tools/debris-ifier/debrisifier-v50-source.js');
const embeddedTree = JSON.parse(read('docs/tools/debris-ifier/debrisifier-v50-embedded-tree.json'));
const interior = read('docs/js/dev-random-ruin-interior-map.js');
const hooks = read('docs/js/dev-random-ruin-prototype-hooks.js');

const loadOrder = [
  'dynamic-surfaces.js',
  'dev-random-ruin-hit-puzzles-loader.js',
  'dev-random-ruin-prototype-hooks.js',
  'dev-random-ruin-interior-map.js',
  'dev-random-ruin-motion-runtime.js',
  'dev-random-ruin-runtime-coverage.js',
].map(name => camera.indexOf(name));
assert(loadOrder.every(index => index >= 0), 'camera bootstrap must load every Random Test Ruin runtime module');
for (let i = 1; i < loadOrder.length; i++) {
  assert(loadOrder[i] > loadOrder[i - 1], 'Random Test Ruin runtime modules must preserve dependency order');
}

assert(interior.includes("const RUIN_TILE_SCALE = 2"), 'generated ruin must retain 2x horizontal cells');
assert(interior.includes("map_i_dev_random_ruin"), 'generated ruin must remain a real session-only interior map');
assert(interior.includes('tools/debris-ifier/index.html?devRuntime=1'), 'hidden generator must request embedded V50 runtime mode');
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
assert(coverage.includes("entry.activatorType === 'alwaysLitTorch'"), 'cross-layer audit must recognize V50 always-lit fuel torches');
assert(coverage.includes('registeredTorchSources'), 'always-lit audit coverage must be backed by actual Batch 2 torch-source discovery');
assert(coverage.includes('data.groundedToMovingPlatform && object?.parent'), 'platform-parented displays must be recognized as transform-driven');
assert(coverage.includes('effectiveUnhandled'), 'cross-layer audit must retain truly unhandled prototype objects');
assert(coverage.includes('filterSeedAudit'), 'multi-seed audit must reconcile known cross-layer activator classes');

// The hidden in-game generator must not discover furniture or load authored assets
// from GitHub at runtime. The readable V50 file remains exact; debrisifier-01.js
// swaps only its repository transport while executing devRuntime=1.
assert(debrisBootstrap.includes("params.get('devRuntime') === '1'"), 'Debris-ifier bootstrap must recognize hidden dev runtime mode');
assert(debrisBootstrap.includes("const EMBEDDED_TREE = 'debrisifier-v50-embedded-tree.json'"), 'embedded runtime must name the committed local tree');
assert(debrisBootstrap.includes('sourceText.replace(treeNeedle, treeReplacement).replace(rawNeedle, rawReplacement)'), 'embedded runtime must substitute both verified transport bindings');
assert(debrisBootstrap.includes("new URL('../../'+fromDocsRoot,location.href).href"), 'embedded runtime must map repo asset paths to the local docs origin');
assert(debrisBootstrap.includes('refusing an unverified embedded patch'), 'embedded transport patch must fail closed if exact V50 bindings drift');
assert(debrisBootstrap.includes("source.src = 'debrisifier-v50-source.js'"), 'direct Debris-ifier mode must keep loading the exact readable source file');
new vm.Script(debrisBootstrap, { filename:'debrisifier-01.js' });
new vm.Script(debrisSource, { filename:'debrisifier-v50-source.js' });

const furnitureRoots = ['docs/config/furniture-authored/', 'docs/assets/models/furniture/data/'];
const ruinRe = /(pillar|stone|obelisk|ruin|statue|buttress|arch|pedestal|support)/i;
const treePaths = embeddedTree.tree.filter(entry => entry.type === 'blob').map(entry => entry.path);
const furniturePaths = treePaths.filter(file => furnitureRoots.some(dir => file.startsWith(dir)) && /\.json$/i.test(file));
assert.equal(furniturePaths.length, 11, 'embedded V50 tree must contain the exact 11 ruin-friendly furniture paths');
assert(furniturePaths.every(file => ruinRe.test(path.basename(file))), 'embedded furniture manifest must contain only V50 ruin-friendly candidates');
assert(furniturePaths.includes('docs/config/furniture-authored/statue.json'), 'embedded candidate pool must retain authored statue furniture');
assert(furniturePaths.includes('docs/assets/models/furniture/data/pillar_square.json'), 'embedded candidate pool must retain authored square pillars');
assert(furniturePaths.includes('docs/assets/models/furniture/data/stone_arch.json'), 'embedded candidate pool must retain stone arches');
for (const asset of [
  'docs/assets/textures/carved_smooth.png',
  'docs/assets/textures/inn_sign_text.png',
  'docs/assets/textures/general_store_sign_text.png',
  'docs/assets/models/Roughbrick1.glb',
]) assert(treePaths.includes(asset), `embedded V50 tree must retain ${asset}`);
assert.equal(embeddedTree.truncated, false, 'embedded V50 tree must be complete');

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
assert(hitSource.includes('alwaysLitTorch'), 'decoded hit runtime must discover V50 always-lit reference torches as fuel sources');
assert(hitSource.includes('installRanged'), 'decoded hit runtime must install a ranged-projectile seam');
assert(hitSource.includes('installCombat'), 'decoded hit runtime must install its torch-sweep combat seam');
new vm.Script(hitSource, { filename: 'dev-random-ruin-hit-puzzles.js' });
new vm.Script(coverage, { filename: 'dev-random-ruin-runtime-coverage.js' });

console.log('Random Test Ruin integration static audit passed.');
