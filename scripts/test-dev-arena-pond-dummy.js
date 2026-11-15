'use strict';
// Executes dev-arena-pond-dummy.js against stubbed deps: the pond/waterfall are built into the arena
// scene once, dummies get a scheduler target override at the requested camera-relative tile, and
// clearing despawns them.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const calls = { water: [], fall: [], override: null, spawned: [], despawned: [] };
const grassGroups = [{ visible: true, userData: { isWildernessGrassChunkGroup: true } }, { visible: true, userData: {} }];
const scene = { userData: {}, children: [], add(o) { o.parent = this; this.children.push(o); }, traverse(fn) { grassGroups.forEach(fn); } };
const THREE = {
  Vector3: class { constructor() { this.x = 0; this.y = 0; this.z = 0; } },
  Mesh: class { constructor(g, m) { this.geometry = g; this.material = m; this.position = { set() {} }; } },
  BoxGeometry: class {}, MeshLambertMaterial: class {},
};
const buttons = [];
const section = { className: '', id: '', innerHTML: '', handlers: {}, addEventListener(t, h) { this.handlers[t] = h; } };
global.window = {
  THREE,
  WaterSystem: { buildMergedWaterMesh: (s, cells) => { const m = { cells, parent: s }; calls.water.push(m); s.children.push(m); return m; } },
  ZoneTerrainFeatures: { buildWaterfallCurtainMeshes: (s, grid) => { calls.fall.push(grid); return [{ geometry: { computeBoundingBox() {}, boundingBox: { max: { y: 1.2 } } } }]; } },
  NpcScheduling: { registerTargetOverride: (id, fn) => { calls.override = { id, fn }; } },
};
global.document = {
  querySelector: () => ({ appendChild: () => {} }),
  getElementById: () => null,
  createElement: () => section,
};
const code = fs.readFileSync(path.join(__dirname, '..', 'docs', 'js', 'dev-arena-pond-dummy.js'), 'utf8');
new Function(code).call(global.window);
const mod = global.window.DevArenaPondDummy;
assert.ok(mod, 'module registers window.DevArenaPondDummy');

let area = 'map_dev_arena';
const walkers = [];
mod.init({
  zoneScenes: new Map([['map_dev_arena', { scene }]]),
  zoneWaterMeshes: new Map([['map_dev_arena', []]]),
  getActiveGrid: () => Array.from({ length: 18 }, () => Array.from({ length: 18 }, () => ({}))),
  tileSurfaceYInArea: () => 0.5,
  EXTERIOR_ZONES: { map_dev_arena: { cols: 18, rows: 18 } },
  getCurrentArea: () => area,
  player: { x: 9 * 32, y: 9 * 32, vx: 0, vy: 0 }, TILE: 32,
  getActiveCamera: () => ({ getWorldDirection: v => { v.x = 0; v.y = 0; v.z = -1; return v; } }),
  showToast() {}, markOutline() {}, _snapCameraTarget() {},
  npcWalkers: walkers,
  spawnNpcRecord: async (rec, target) => { const w = { rec, root: { position: { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } } } }; walkers.push(w); calls.spawned.push({ rec, target }); return w; },
  despawnNpcWalker: w => { calls.despawned.push(w); walkers.splice(walkers.indexOf(w), 1); return true; },
});

(async () => {
  // Test look: apply / equip / front view, then restore must put EVERYTHING back (nothing may leak into a save).
  {
    const profile = { appearance: { speciesId: 'mao-ao', gender: 'male', cosmetics: { hat: 'x' } } };
    let offsets = [0.35, 0.6], pitch = 3, azimuth = 10, viewMode = false, rebuilds = 0, refreshes = 0;
    const slots = { weapon: 'hatchet' }, tools = { hatchet: true };
    const look = mod.makeTestLook({
      getProfile: () => profile, getShoulderOffsets: () => offsets.slice(), setShoulderOffsets: (a, b) => { offsets = [a, b]; },
      getCameraPitchOffset: () => pitch, setCameraPitchOffset: v => { pitch = v; },
      getCameraAzimuthOffset: () => azimuth, setCameraAzimuthOffset: v => { azimuth = v; },
      setCharacterViewMode: on => { viewMode = on; }, refreshPlayerAvatar: async () => { refreshes++; },
      toolDefs: { 'modular:fishing-mace:grapple-flail:nativeCopper': {} }, gearTools: () => tools, equipmentSlots: slots,
      rebuildToolMeshes: () => { rebuilds++; }, setActiveTool: () => {},
    });
    assert.strictEqual(await look.apply('kenkari', 'female', 0.02, -8), true);
    assert.deepStrictEqual([profile.appearance.speciesId, profile.appearance.gender, offsets, pitch], ['kenkari', 'female', [0.02, 0.02], -8]);
    assert.strictEqual(look.equipLoopedGrappleFlail(), 'modular:fishing-mace:grapple-flail:nativeCopper');
    assert.strictEqual(slots.weapon, 'modular:fishing-mace:grapple-flail:nativeCopper');
    assert.strictEqual(look.frontView(true), true);
    assert.deepStrictEqual([viewMode, azimuth], [true, 190]);
    assert.strictEqual(look.frontView(false), true);
    assert.deepStrictEqual([viewMode, azimuth], [false, 10], 'front view restores the camera azimuth and leaves character view');
    assert.strictEqual(await look.restore(), true);
    assert.deepStrictEqual([profile.appearance.speciesId, profile.appearance.gender, profile.appearance.cosmetics.hat, offsets, pitch], ['mao-ao', 'male', 'x', [0.35, 0.6], 3], 'appearance, offsets and pitch restored');
    assert.strictEqual(slots.weapon, 'hatchet', 'the real weapon slot is restored');
    assert.strictEqual('modular:fishing-mace:grapple-flail:nativeCopper' in tools, false, 'the dev-granted inventory entry is removed');
    assert.strictEqual(await look.restore(), false, 'a second restore is a no-op');
  }

  const pond = mod.ensurePond();
  assert.strictEqual(grassGroups[0].visible, false, 'arena grass starts hidden');
  assert.strictEqual(grassGroups[1].visible, true, 'only grass chunk groups are hidden');
  mod.setGrassHidden(false);
  assert.strictEqual(grassGroups[0].visible, true, 'grass can be shown again');
  mod.setGrassHidden(true);
  assert.strictEqual(grassGroups[0].visible, false);
  assert.ok(pond && calls.water.length === 1, 'pond mesh built once');
  assert.strictEqual(calls.water[0].cells.length, 30, '10x3 pond cells');
  assert.ok(mod.ensurePond() === pond && calls.water.length === 1, 'ensurePond is idempotent');
  assert.strictEqual(calls.fall.length, 1, 'waterfall curtain requested once');
  assert.ok(scene.userData.devArenaWaterfall, 'waterfall + ledge stored on the scene');
  const fallRow = calls.fall[0].findIndex(row => row.some(t => t.type === 'waterfall'));
  assert.strictEqual(calls.fall[0][fallRow].filter(t => t.type === 'waterfall').length, 3, 'three waterfall tiles');

  const front = await mod.spawnDummy('front');
  assert.ok(front && calls.override?.id === 'dev-arena-dummy-npc', 'override registered');
  assert.deepStrictEqual(calls.spawned[0].target.area, 'map_dev_arena');
  assert.ok(calls.spawned[0].target.r < 9, 'front dummy is farther from a north-facing camera');
  assert.strictEqual(calls.override.fn(calls.spawned[0].rec), calls.spawned[0].target, 'provider pins the dummy tile');
  assert.strictEqual(calls.override.fn({ id: 'someone_else' }), null, 'other NPCs are untouched');
  await mod.spawnDummy('behind');
  assert.ok(calls.spawned[1].target.r > 9, 'behind dummy is nearer the camera');
  area = 'farm';
  assert.strictEqual(await mod.spawnDummy('left'), null, 'refuses outside the arena');
  assert.strictEqual(mod.clearDummies(), 2);
  assert.strictEqual(walkers.length, 0, 'clear despawns every dummy');
  console.log('dev-arena-pond-dummy: ok');
})().catch(e => { console.error(e); process.exit(1); });
