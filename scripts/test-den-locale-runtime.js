#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'docs/js/den-locale-runtime.js'), 'utf8');
const locale = JSON.parse(fs.readFileSync(path.join(root, 'docs/config/locales/locale_den_mother_nest.json'), 'utf8'));

// Make every transform non-trivial so this test catches world/pixel-space mixups,
// missing scale/rotation propagation, and a bridge that never captures wildlife deps.
locale.meta.denEncounter.motherSpawn.transform = {
  x: 0.25, y: 0.10, z: -0.50,
  rx: 10, ry: 135, rz: 5,
  sx: 1.20, sy: 0.80, sz: 1.10,
};
locale.meta.denEncounter.clutchSpawns[0].transform = {
  x: -0.30, y: 0.08, z: 0.22,
  rx: 4, ry: -12, rz: 3,
  sx: 0.90, sy: 1.10, sz: 1.05,
};

function vec3(x = 0, y = 0, z = 0) {
  return {
    x, y, z,
    set(nx, ny, nz) { this.x = nx; this.y = ny; this.z = nz; return this; },
    copy(other) { this.x = other.x; this.y = other.y; this.z = other.z; return this; },
    clone() { return vec3(this.x, this.y, this.z); },
  };
}

function euler(x = 0, y = 0, z = 0) {
  return {
    x, y, z,
    set(nx, ny, nz, order) { this.x = nx; this.y = ny; this.z = nz; this.order = order; return this; },
    copy(other) { this.x = other.x; this.y = other.y; this.z = other.z; this.order = other.order; return this; },
  };
}

function group(name = '') {
  return {
    name,
    userData: {},
    position: vec3(),
    rotation: euler(),
    scale: vec3(1, 1, 1),
    parent: null,
    updateMatrixWorld() {},
    traverse(fn) { fn(this); },
  };
}

function scene() {
  return {
    children: [],
    add(object) {
      if (!this.children.includes(object)) this.children.push(object);
      object.parent = this;
    },
    remove(object) {
      const index = this.children.indexOf(object);
      if (index >= 0) this.children.splice(index, 1);
      if (object?.parent === this) object.parent = null;
    },
  };
}

function approx(actual, expected, message, epsilon = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${message}: expected ${expected}, got ${actual}`);
}

async function main() {
  let originalWildlifeInitCalls = 0;
  let originalNestInitCalls = 0;
  let currentArea = 'map_i_test_den';
  const branchesByArea = new Map();

  const context = {
    console,
    Date,
    Math,
    Promise,
    Map,
    Set,
    WeakMap,
    Object,
    Array,
    Number,
    String,
    RegExp,
    JSON,
    performance: { now: () => 1000 },
    fetch: async () => ({ ok: true, json: async () => JSON.parse(JSON.stringify(locale)) }),
    LocalDBOverrides: {
      getSourceMode: () => 'repo',
      getOverride: () => null,
    },
    AuthoredFurniture: {
      load: async () => null,
      peek: () => null,
      buildGroup: () => group('authored'),
    },
    ClimbSystem: {
      debugBranchesFor: area => branchesByArea.get(area) || [],
    },
    DenNestSystem: {
      init() { originalNestInitCalls++; },
      updateNestInteraction() { return 'nest-update'; },
    },
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'den-locale-runtime.js' });

  assert.equal(context.DenLocaleRuntime.version, 3, 'reviewed runtime version is installed');
  const wildlifeDescriptor = Object.getOwnPropertyDescriptor(context, 'WildlifeSpawn');
  assert.equal(typeof wildlifeDescriptor?.set, 'function', 'runtime traps the later WildlifeSpawn assignment when loaded first');

  // Simulate the real index.html ordering: wildlife-spawn.js assigns its API only
  // after den-locale-runtime.js has already executed from combat-config-loader.
  context.WildlifeSpawn = {
    init() { originalWildlifeInitCalls++; },
    updateHostileSpawning() {},
  };
  assert.equal(context.WildlifeSpawn.__denLocaleAuthoredEncounterBridge, true, 'late WildlifeSpawn API is patched synchronously');

  const motherGroup = group('den_mother');
  motherGroup.scale.set(2, 3, 4);
  const mother = {
    isDenMother: true,
    areaId: currentArea,
    health: 100,
    x: 0, y: 0,
    homeX: 0, homeY: 0,
    groundLift: 0.4,
    halfHeight: 0.4,
    groupRot: 0,
    pngRot: 0,
    targetRot: 0,
    avatarRef: { group: motherGroup },
  };
  const wildlifeDeps = {
    hostileObjects: new Set([mother]),
    makeDecorativeFurnitureMesh() { return null; },
  };
  context.WildlifeSpawn.init(wildlifeDeps);
  assert.equal(originalWildlifeInitCalls, 1, 'original WildlifeSpawn.init still runs');
  assert.equal(context.DenLocaleRuntime.debugSnapshot().wildlifeDepsReady, true, 'wrapped init captures the live hostile collection');

  const cavernScene = scene();
  const cavernNest = { col: 10, row: 20, w: 2, h: 2, remaining: 3 };
  const cavernRoot = group(`nest_${currentArea}:egg:1_egg`);
  cavernRoot.position.set(11.1, 2.30, 21.1); // legacy layout: 0.30 world-unit lift over floor Y=2
  cavernRoot.scale.set(1.5, 2.0, 2.5);
  cavernScene.add(cavernRoot);

  const denNests = new Map([[currentArea, cavernNest]]);
  const buildingScenes = new Map([[currentArea, { scene: cavernScene }]]);
  const denDeps = {
    TILE: 32,
    _denNests: denNests,
    _buildingScenes: buildingScenes,
    getCurrentArea: () => currentArea,
    activeSurfaceYAtWorld: () => 2,
  };
  context.DenNestSystem.init(denDeps);
  assert.equal(originalNestInitCalls, 1, 'original DenNestSystem.init still runs');

  await context.DenLocaleRuntime.ready;
  await Promise.resolve(); // allow init's ready.then(...) bridge to run
  context.DenLocaleRuntime.syncCurrentDen();

  assert.equal(cavernNest.localeId, 'locale_den_mother_nest', 'cavern nest receives locale metadata');
  assert.equal(cavernNest.clutchSpawnTransforms.length, 3, 'cavern nest receives authored clutch slots');

  const centerX = 11;
  const centerZ = 21;
  approx(mother.x, (centerX + 0.25) * 32, 'Den-Mother X converts authored world offset to simulation pixels');
  approx(mother.y, (centerZ - 0.50) * 32, 'Den-Mother Z converts authored world offset to simulation Y pixels');
  approx(mother.homeX, mother.x, 'Den-Mother homeX follows authored spawn');
  approx(mother.homeY, mother.y, 'Den-Mother homeY follows authored spawn');
  approx(mother.groundLift, 0.50, 'Den-Mother authored vertical offset remains in world units');
  approx(mother.groupRot, 135 * Math.PI / 180, 'Den-Mother authored yaw seeds gameplay rotation');
  approx(motherGroup.rotation.x, 10 * Math.PI / 180, 'Den-Mother pitch reaches avatar group');
  approx(motherGroup.rotation.z, 5 * Math.PI / 180, 'Den-Mother roll reaches avatar group');
  approx(motherGroup.scale.x, 2 * 1.20, 'Den-Mother X scale multiplies original avatar scale');
  approx(motherGroup.scale.y, 3 * 0.80, 'Den-Mother Y scale multiplies original avatar scale');
  approx(motherGroup.scale.z, 4 * 1.10, 'Den-Mother Z scale multiplies original avatar scale');

  // Root keeps its original 0.30 floor lift while authored Y adds on top.
  approx(cavernRoot.position.x, centerX - 0.30, 'cavern clutch X uses authored slot');
  approx(cavernRoot.position.y, 2 + 0.30 + 0.08, 'cavern clutch Y preserves sprite ground lift plus authored lift');
  approx(cavernRoot.position.z, centerZ + 0.22, 'cavern clutch Z uses authored slot');
  approx(cavernRoot.rotation.y, -12 * Math.PI / 180, 'cavern clutch yaw is authored, not player-facing fallback');
  approx(cavernRoot.scale.x, 1.5 * 0.90, 'cavern clutch X scale multiplies original sprite scale');

  // Branch nests use the same clutch authoring but retain their smaller nestBranch furniture identity.
  const zoneScene = scene();
  const branchNest = {
    id: 'map_zone:nesttree:4,7',
    areaId: 'map_zone',
    x: 320,
    y: 640,
    worldY: 4,
    remaining: 3,
    mesh: group('procedural_branch_nest'),
  };
  zoneScene.add(branchNest.mesh);
  const branch = { baseWorldY: 3.5, tipWorldY: 4.5, nest: branchNest };
  branchesByArea.set('map_zone', [branch]);
  const branchRoot = group(`nest_sleep_${branchNest.id}:baby:9`);
  branchRoot.position.set(10.12, 4.25, 20.12); // legacy branch layout with 0.25 lift
  branchRoot.scale.set(0.5, 0.4, 0.5);
  zoneScene.add(branchRoot);

  currentArea = 'map_zone';
  context.DenLocaleRuntime.syncCurrentDen();
  assert.equal(branchNest.nestFurnitureKey, 'nestBranch', 'branch encounter keeps the small branch furniture key');
  assert.equal(branchNest.clutchSpawnTransforms.length, 3, 'branch nest receives authored clutch slots');
  approx(branchRoot.position.x, 10 - 0.30, 'branch clutch X uses authored slot relative to branch nest center');
  approx(branchRoot.position.y, 4 + 0.25 + 0.08, 'branch clutch Y preserves sleeper lift plus authored lift');
  approx(branchRoot.position.z, 20 + 0.22, 'branch clutch Z uses authored slot relative to branch nest center');
  approx(branchRoot.scale.y, 0.4 * 1.10, 'branch sleeper keeps its barn flattening while authored Y scale multiplies it');

  const debug = context.DenLocaleRuntime.debugSnapshot();
  assert.equal(debug.wildlifeInstalled, true, 'debug confirms WildlifeSpawn bridge installed');
  assert.equal(debug.lastMotherApplied.areaId, 'map_i_test_den', 'debug records actual transformed Den-Mother');

  console.log('Den locale runtime load-order, Den-Mother transform, cavern clutch, and branch clutch behavior passed.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
