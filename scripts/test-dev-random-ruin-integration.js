#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
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
const occupancy = read('docs/js/dev-random-ruin-tile-occupancy.js');
const hooks = read('docs/js/dev-random-ruin-prototype-hooks.js');
const renderProxy = read('docs/js/dev-random-ruin-wall-render-proxy.js');
const interactions = read('docs/js/dev-random-ruin-interactions.js');

const loadOrder = [
  'dynamic-surfaces.js',
  'dev-random-ruin-hit-puzzles-loader.js',
  'dev-random-ruin-prototype-hooks.js',
  'dev-random-ruin-tile-occupancy.js',
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
assert(!interior.includes('devruin-wall-${object.id}'), 'wall meshes must not register object-wide blockers');
assert(!interior.includes('devruin-solid-${o.id}'), 'solid furniture must not register object-wide blockers');
assert(interior.includes('TileOccupancy.create'), 'ruin must create the shared tile occupancy snapshot');
assert(interior.includes('getOccupancySnapshot'), 'ruin must expose the exact gameplay snapshot to diagnostics');
assert(occupancy.includes("const BLOCKER_ID = 'devruin-tile-occupancy'"), 'tile occupancy must own one aggregate gameplay blocker');
assert(occupancy.includes('if (!model.floorSet.has(tileKey)) result.add(tileKey);'), 'wall rasterization must place wall collision on the non-floor side');
assert(occupancy.includes('dataset.ruinFog = \'disabled\''), 'test ruin Map renderer must explicitly reveal the entire interior');
assert(occupancy.includes("'#e74c3c'"), 'Map renderer must draw blocked tiles red');
assert(occupancy.includes("'#35c96f'"), 'Map renderer must draw activator tiles green');
assert(occupancy.includes("'#3498db'"), 'Map renderer must draw mechanism tiles blue');
assert(occupancy.includes('doorIsClosed'), 'door collision must use logical open/closed state instead of rendered height');
assert(occupancy.includes('nearestFloorAnchor'), 'mechanism diagnostics must use compact logical anchor tiles');
assert(interior.includes('transitDoors:ruin.transitDoors'), 'transit doors must join the shared tile occupancy snapshot');
assert(interior.includes('motion === \'elevatorPushBlock\''), 'elevator push blocks must join dynamic tile occupancy');
assert(interior.includes('if (d.elevatorWellSocket) furnitureBlockers.push(object);'), 'elevator sockets must be rasterized into static tile occupancy');
assert(renderProxy.includes("data.previewMotion?.type === 'stoneDoor'"), 'parent-realm render bridge must discover stone-door meshes');
assert(renderProxy.includes("add(mesh, 'doorArch', object)"), 'parent-realm render bridge must include complete stone arch frames');
assert(renderProxy.includes('normalizeDoorAssemblies'), 'door panels must be aligned to their matching arch and floor');
assert(renderProxy.includes("add(mesh, 'activator', object)"), 'parent-realm render bridge must discover linked activator meshes');
assert(renderProxy.includes('copySourceWorldTransform(sourceObject, proxy, scene)'), 'door and activator proxies must follow live V50 transforms');
assert(renderProxy.includes('visibleDoorProxies'), 'mobile diagnostics must expose visible door proxy coverage');
assert(renderProxy.includes('visibleActivatorProxies'), 'mobile diagnostics must expose visible activator proxy coverage');
assert(interior.includes('tools/debris-ifier/index.html?devRuntime=1'), 'hidden generator must request embedded V50 runtime mode');
assert(interior.includes('await enterRuin(); updateBadge();'), 'generate must await the actual ruin transition midpoint before reporting success');
assert(interior.includes('const entering=ruin;'), 'ruin entry transition must capture the generated instance it is entering');
assert(interior.includes('if(!entering||ruin!==entering)return;'), 'stale ruin-entry transition callbacks must be identity-guarded');
assert(interior.includes('if(removeMap) removeGeneratorFrame();'), 'rerolls must retain the V50 iframe while full clear/leave removes it');
assert(interior.includes('restorePreviewRoots()'), 'reroll lifecycle comment must retain the V50 preview-root restore contract');
assert(hooks.includes("generatedAccessType === 'stoneLadder'"), 'prototype hook layer must discover V50 ladders');
assert(hooks.includes("motion === 'elevatorPushBlock'"), 'prototype hook layer must discover elevator push blocks');
assert(hooks.includes('moving-platform grounded child'), 'grounded moving-platform children must not produce false unhandled warnings');
assert(!hooks.includes('registerBlocker(`devruin-transit-door-'), 'transit doors must not retain a second object-wide blocker');
assert(!hooks.includes('registerBlocker(`devruin-elevator-'), 'elevator objects must not retain object-wide blockers outside the Map snapshot');
assert(interactions.includes("matchMedia?.('(pointer: coarse)')"), 'mobile ruin actions must recognize coarse-pointer desktop-view devices');
assert(interactions.includes("source:'semantic-glyph'"), 'mobile glyph targets must expose ranged guidance/action');
new vm.Script(interior, { filename:'dev-random-ruin-interior-map.js' });
new vm.Script(occupancy, { filename:'dev-random-ruin-tile-occupancy.js' });
new vm.Script(renderProxy, { filename:'dev-random-ruin-wall-render-proxy.js' });
new vm.Script(interactions, { filename:'dev-random-ruin-interactions.js' });

assert(api.includes('createRuntimeStoneLadder'), 'V50 bridge must expose the real stone ladder constructor');
assert(api.includes('auditInteriorSeeds'), 'V50 bridge must expose multi-seed runtime-tag auditing');
assert(api.includes('inspectRuntimeTags'), 'V50 bridge must classify runtime-tagged prototype output');
assert(api.includes('prepareRuntimeWallPlanes'), 'V50 bridge must explicitly prepare the prototype wall planes for game rendering');
assert(api.includes('runtimeWallPlaneRendered'), 'prototype wall planes must be tagged after runtime render preparation');
assert(api.includes('THREE.DoubleSide'), 'prototype wall planes must render from either game-camera side');
assert(api.includes('runtimeHallwayState'), 'V50 bridge must expose generated hallway clearance metadata');
assert(api.includes('minCrossCells < 5'), 'embedded runtime must reject hallway width regressions below five prototype cells');
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

// The recovered prototype file is immutable source-of-truth. Embedded mode reads
// these exact bytes and applies only verified in-memory game-runtime patches.
assert.equal(
  crypto.createHash('sha256').update(debrisSource).digest('hex'),
  '038a5d54c66b0ae2a9ceeb66967b9e5c32b616040f40b503eec59d5331885f40',
  'readable V50 source must remain byte-for-byte identical to the recovered prototype source',
);
assert(debrisBootstrap.includes("params.get('devRuntime') === '1'"), 'Debris-ifier bootstrap must recognize hidden dev runtime mode');
assert(debrisBootstrap.includes("const EMBEDDED_TREE = 'debrisifier-v50-embedded-tree.json'"), 'embedded runtime must name the committed local tree');
assert(debrisBootstrap.includes('const hallReplacement = \'const width=randomIntInclusive(rng,5,6),length=randomIntInclusive(rng,5,8);\''), 'embedded runtime must widen normal V50 hallways to 5–6 cells');
assert(debrisBootstrap.includes("escapeHallReplacement = 'hallWidth=randomIntInclusive(rng,5,6),hallLen=10+rooms.length*3;'"), 'embedded runtime must widen fallback V50 hallways to 5–6 cells');
assert(debrisBootstrap.includes('Math.max(3,Number(door.widthCells)||3)'), 'hallway door arches must consume the authored doorway width instead of a fixed 3-cell span');
assert(debrisBootstrap.includes('Math.max(3,Number(chosen.door.widthCells)||3)'), 'focus doorway arches must consume the authored doorway width');
assert(debrisBootstrap.includes("new URL('../../'+fromDocsRoot,location.href).href"), 'embedded runtime must map repo asset paths to the local docs origin');
assert(debrisBootstrap.includes('refusing an unverified embedded patch'), 'embedded runtime patching must fail closed if exact V50 bindings drift');
assert(debrisBootstrap.includes("source.src = 'debrisifier-v50-source.js'"), 'direct Debris-ifier mode must keep loading the exact readable source file');
assert(debrisBootstrap.includes('patchedBindings: patches.length'), 'embedded runtime must report the verified patch count');
assert.equal((debrisSource.match(/REPO_RAW_ROOT/g) || []).length, 4, 'V50 source gained an unaudited direct raw-repo transport use');
assert(debrisSource.includes('const width=randomIntInclusive(rng,3,4),length=randomIntInclusive(rng,5,8);'), 'source-of-truth V50 hallway sizing unexpectedly changed');
assert(debrisSource.includes('hallWidth=randomIntInclusive(rng,3,4),hallLen=10+rooms.length*3;'), 'source-of-truth V50 fallback hallway sizing unexpectedly changed');
new vm.Script(debrisBootstrap, { filename:'debrisifier-01.js' });
new vm.Script(debrisSource, { filename:'debrisifier-v50-source.js' });
new vm.Script(api, { filename:'debrisifier-v50-api.js' });

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
