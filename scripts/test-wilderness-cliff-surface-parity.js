'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

const parityPath = path.join(__dirname, '../docs/js/wilderness-cliff-surface-parity.js');
const parity = fs.readFileSync(parityPath, 'utf8');
const loader = fs.readFileSync(path.join(__dirname, '../docs/js/house-pieces.js'), 'utf8');

for (const expected of [
  'buildRockFormationMeshes', 'buildPlateauMesa', 'buildZoneMesaMeshes', 'rebuildZoneMesaMeshes', 'buildZoneBorderTerrain',
  "natural.naturalizeMesh(proxy, 'rocks', 'planar-stretch')", "natural.naturalizeMesh(mesh, 'rocks')",
  'PLATEAU_CLIFF_MATERIAL_SLOT = 1', 'delete geometry.userData.hobunjiSurfaceStretchSignature',
  'delete geometry.userData.hobunjiSurfaceStretch', 'delete geometry.userData.naturalSurfaceUvMapping',
  'maxPatchWorldSize: WILDERNESS_CLIFF_UV_PATCH_WORLD_SIZE', 'queueMicrotask(run)',
  "chainGlobal('ZoneTerrainFeatures', patchZoneTerrainFeatures)", "chainGlobal('ZonePlateauMesa', patchPlateauMesa)",
  "chainGlobal('BorderTerrain', patchBorderTerrain)",
]) assert.ok(parity.includes(expected), `missing parity contract: ${expected}`);

assert.ok(loader.includes("['WildernessCliffSurfaceParity', 'wilderness-cliff-surface-parity.js?v=20260907b']"), 'loader does not include refreshed wilderness cliff parity adapter');
assert.ok(loader.indexOf('farm-cliff-rock-outline.js?v=20260907b') < loader.indexOf('wilderness-cliff-surface-parity.js?v=20260907b'), 'wilderness parity must load after farm cliff material helper');
assert.ok(loader.indexOf('wilderness-cliff-surface-parity.js?v=20260907b') < loader.indexOf('terrain-render-chunks.js?v=20260812a'), 'wilderness parity must load before terrain chunking');

function color(hex) {
  const normalized = String(hex).replace(/^#/, '').toLowerCase();
  return { isColor: true, getHexString: () => normalized };
}
class MeshBasicMaterial {
  constructor({ map = null, hex = 'ffffff', userData = {} } = {}) {
    this.isMeshBasicMaterial = true; this.isMeshLambertMaterial = false; this.map = map; this.color = color(hex); this.userData = userData;
  }
}
class MeshLambertMaterial {
  constructor({ map = null, hex = '79807c', userData = {} } = {}) {
    this.isMeshBasicMaterial = false; this.isMeshLambertMaterial = true; this.map = map; this.color = color(hex); this.userData = userData;
  }
}
class PlaneGeometry {
  constructor() { this.userData = {}; this.attributes = { position: { count: 4, itemSize: 3 }, uv: { count: 4, itemSize: 2 } }; }
  getAttribute(name) { return this.attributes[name] || null; }
  dispose() { this.disposed = true; }
}
class Mesh {
  constructor(geometry, material) { this.isMesh = true; this.geometry = geometry; this.material = material; this.userData = {}; this.name = ''; }
}
class Scene {
  constructor() { this.isScene = true; this.children = []; }
  add(...objects) { this.children.push(...objects); for (const object of objects) if (object) object.parent = this; return this; }
}
function terrainGeometry() {
  return {
    userData: { hobunjiSurfaceStretchSignature: 'stale-pre-final-pass', hobunjiSurfaceStretch: { version: 1 }, naturalSurfaceUvMapping: 'world-stretch' },
    attributes: { position: { count: 12, itemSize: 3 }, uv: { count: 12, itemSize: 2 } },
    getAttribute(name) { return this.attributes[name] || null; },
  };
}
function plateauMesh() {
  const grass = new MeshBasicMaterial({ map: { kind: 'grass' }, hex: '2e701d' });
  const litRock = new MeshLambertMaterial({ map: null, hex: '79807c' });
  const mesh = new Mesh(terrainGeometry(), [grass, litRock]); mesh.name = 'plateau_under_test'; return { mesh, grass };
}
function singleCliff(surface, { map = null, hex = '79807c' } = {}) {
  const material = new MeshLambertMaterial({ map, hex, userData: { naturalSurface: surface } });
  const mesh = new Mesh(terrainGeometry(), material); mesh.userData.naturalSurface = surface; mesh.name = `${surface}_under_test`; return mesh;
}

const queued = [], mapperCalls = [], naturalizeCalls = [];
const context = { console, performance: { now: () => 1234 }, queueMicrotask: fn => queued.push(fn), THREE: { Mesh, Scene, PlaneGeometry } };
context.window = context;
context.window.__farmLog = () => {};
context.window.NaturalSurfaceMaterials = {
  naturalizeMesh(mesh, surface, mapping) {
    naturalizeCalls.push({ mesh, surface, mapping });
    mesh.material = new MeshBasicMaterial({ map: { kind: 'carved_smooth_body_tinted' }, hex: 'ffffff', userData: { naturalSurface: 'rocks' } });
    mesh.userData = Object.assign({}, mesh.userData, { naturalSurface: 'rocks' });
    return mesh;
  },
};
context.window.HobunjiSurfaceStretchUV = {
  mapMesh(mesh, options) {
    mapperCalls.push({ mesh, options: Object.assign({}, options) });
    mesh.geometry.userData.hobunjiSurfaceStretchSignature = 'surface-island-v2-test';
    mesh.geometry.userData.hobunjiSurfaceStretch = { patchCount: 3, materialIndex: options.materialIndex ?? null };
    return mesh.geometry.userData.hobunjiSurfaceStretch;
  },
};
context.window.FacetedNaturalSurfaceShellReduction = { suppressMesh() {} };
vm.runInNewContext(parity, context, { filename: parityPath });
const flushQueued = () => { while (queued.length) queued.shift()(); };

const initialPlateau = plateauMesh(), directPlateau = plateauMesh(), rebuiltPlateau = plateauMesh(), rebuildScene = new Scene();
context.window.ZonePlateauMesa = {
  buildPlateauMesa() { return directPlateau.mesh; },
  buildZoneMesaMeshes() { return [initialPlateau.mesh]; },
  rebuildZoneMesaMeshes() { rebuildScene.add(rebuiltPlateau.mesh); },
};
const built = context.window.ZonePlateauMesa.buildZoneMesaMeshes(null, 'map_northern_cliffs');
assert.strictEqual(built[0], initialPlateau.mesh, 'zone plateau wrapper changed the returned mesh identity');
flushQueued();
assert.strictEqual(initialPlateau.mesh.material[0], initialPlateau.grass, 'plateau grass material slot was modified');
assert.ok(initialPlateau.mesh.material[1].isMeshBasicMaterial, 'plateau cliff slot stayed lit instead of becoming MeshBasicMaterial');
assert.strictEqual(initialPlateau.mesh.material[1].color.getHexString(), 'ffffff', 'plateau cliff slot retained a second material tint');
assert.ok(initialPlateau.mesh.material[1].map, 'plateau cliff slot did not receive the farm rock PNG');
assert.strictEqual(initialPlateau.mesh.material[1].userData.naturalSurface, 'rocks', 'plateau cliff slot did not use farm rock material semantics');
assert.strictEqual(initialPlateau.mesh.userData.naturalSurfaceCliffSlot, 1, 'plateau cliff slot ownership was not tagged');
assert.ok(mapperCalls.some(call => call.mesh === initialPlateau.mesh && call.options.materialIndex === 1 && call.options.maxPatchWorldSize === 6), 'plateau cliff slot did not use bounded per-surface mapping');
assert.ok(!('naturalSurfaceUvMapping' in initialPlateau.mesh.geometry.userData), 'legacy whole-mesh UV marker survived final plateau mapping');

context.window.ZonePlateauMesa.buildPlateauMesa(null, 'map_northern_cliffs'); flushQueued();
assert.ok(directPlateau.mesh.material[1].isMeshBasicMaterial && directPlateau.mesh.material[1].map, 'direct plateau build did not receive farm material parity');
context.window.ZonePlateauMesa.rebuildZoneMesaMeshes('map_northern_cliffs'); flushQueued();
assert.ok(rebuiltPlateau.mesh.material[1].isMeshBasicMaterial && rebuiltPlateau.mesh.material[1].map, 'runtime rebuilt plateau cliff stayed on Lambert/no-map material');
assert.ok(mapperCalls.some(call => call.mesh === rebuiltPlateau.mesh && call.options.materialIndex === 1), 'runtime rebuilt plateau cliff skipped slot-isolated surface detection');

const litMappedRock = singleCliff('rocks', { map: { kind: 'wrong_lit_png' }, hex: '808080' }), rockScene = new Scene();
context.window.ZoneTerrainFeatures = { buildRockFormationMeshes(scene) { scene.add(litMappedRock); } };
context.window.ZoneTerrainFeatures.buildRockFormationMeshes(rockScene, null, 10, 10, 'map_northern_cliffs'); flushQueued();
assert.ok(litMappedRock.material.isMeshBasicMaterial, 'mapped wilderness rock remained Lambert-lit');
assert.strictEqual(litMappedRock.material.color.getHexString(), 'ffffff', 'mapped wilderness rock retained a second tint multiplier');
assert.strictEqual(litMappedRock.material.userData.naturalSurface, 'rocks', 'mapped wilderness rock did not converge on farm rock material semantics');

const boundaryCliff = singleCliff('cliffs'), borderScene = new Scene();
context.window.BorderTerrain = { buildZoneBorderTerrain(scene) { scene.add(boundaryCliff); } };
context.window.BorderTerrain.buildZoneBorderTerrain(borderScene, 20, 20, 'map_northern_cliffs'); flushQueued();
assert.ok(boundaryCliff.material.isMeshBasicMaterial && boundaryCliff.material.map, 'wilderness boundary cliff did not receive farm material parity');
assert.strictEqual(boundaryCliff.material.color.getHexString(), 'ffffff', 'wilderness boundary cliff retained lit/tinted material color');
assert.ok(mapperCalls.some(call => call.mesh === boundaryCliff && call.options.maxPatchWorldSize === 6), 'wilderness boundary cliff skipped bounded surface detection');
assert.ok(naturalizeCalls.length >= 4, 'canonical natural-surface material factory was not reused by all cliff paths');
console.log('PASS wilderness cliffs converge on farm unlit rock material and furniture-style per-surface UV mapping, including plateau slot 1 and runtime rebuilds.');
