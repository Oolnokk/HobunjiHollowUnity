'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname, '..', 'docs/js', name), 'utf8'); // Used to test the actual production terrain modules.
const parity = read('wilderness-cliff-surface-parity.js'); // Used by material and per-mesh UV tests.
const post = read('natural-surface-stretch-post-jigsaw.js'); // Used by cross-mesh fallback and render budget tests.
const runtime = read('natural-surface-stretch-runtime.js'); // Used by stale-UV and valid-UV tests.
function fromSource(source, name, endMarker, params, args) {
  const start = source.indexOf('  function ' + name + '('); // Used to locate the shipped function, not a duplicate implementation.
  const end = source.indexOf(endMarker, start + 1); // Used to bound the function under test.
  assert.ok(start >= 0 && end > start, 'production function present: ' + name);
  return new Function(...params, source.slice(start, end) + '\nreturn ' + name + ';')(...args);
}
const mesa = id => ({ isMesh: true, name: 'mesa' + id, geometry: {}, material: [{}, {}] }); // Used as the grass-top/cliff-slot mesa fixture.
const tasks = []; // Used to execute scheduled UV microtasks in deterministic order.
let defers = []; // Used to capture the exact mapping policy selected by parity.
const zone = { __hobunjiCrossMeshCliffUvWrapped: true }; // Used to test a batch adapter that is present or absent.
const parityStats = { scheduledPasses: 0, completedPasses: 0, errors: 0, recent: [] }; // Used by parity's scheduled-pass diagnostics.
const schedule = fromSource(parity, 'scheduleFinalSurfacePass', '  function patchZoneTerrainFeatures(', [
  'isNaturalCliffCandidate', 'pendingMeshes', 'stats', 'window', 'performance',
  'PLATEAU_CLIFF_MATERIAL_SLOT', 'WILDERNESS_CLIFF_UV_PATCH_WORLD_SIZE',
  'applyFinalSurfacePass', 'debugLog', 'queueMicrotask', 'Promise',
], [mesh => !!mesh.isMesh, new WeakSet(), parityStats, { ZonePlateauMesa: zone }, { now: () => 1 },
  1, 6, (mesh, label, opts) => { defers.push(opts.deferUvToCrossMesh); return true; },
  () => {}, task => tasks.push(task), Promise]);
schedule([mesa(1), mesa(2)], 'batch', { materialSlot: 1 });
tasks.shift()();
assert.deepEqual(defers, [true, true], 'batched mesas skip the redundant individual UV solve');
assert.equal(parityStats.recent[0].deferred, 2);
zone.__hobunjiCrossMeshCliffUvWrapped = false;
defers = [];
schedule([mesa(1), mesa(2)], 'unavailable', { materialSlot: 1 });
tasks.shift()();
assert.deepEqual(defers, [false, false], 'missing cross-mesh adapter preserves ordinary UV mapping');
zone.__hobunjiCrossMeshCliffUvWrapped = true;
defers = [];
schedule([mesa(1)], 'single', { materialSlot: 1 });
tasks.shift()();
assert.deepEqual(defers, [false], 'single mesa still maps on its own');

let fallbackCalls = 0; // Used to prove a failed combined solve restores each cliff material slot.
const postStats = { failures: 0, perMeshFallbacks: 0 }; // Used by Pixel Probe fallback diagnostics.
const makeBatch = map => fromSource(post, 'schedulePlateauCrossMeshBatch', '  function installPlateauCrossMeshBatching(', [
  'window', 'crossMeshStats', 'debugLog', 'mapTouchingPlateauCliffBatch', 'PLATEAU_CLIFF_MATERIAL_SLOT', 'queueMicrotask', 'Promise',
], [{ WildernessCliffSurfaceParity: { applyFinalSurfacePass(mesh, label, opts) {
  assert.equal(opts.materialSlot, 1);
  fallbackCalls++;
  return true;
} } }, postStats, () => {}, map, 1, task => tasks.push(task), Promise]);
makeBatch(() => false)([mesa(1), mesa(2)], 'bad-batch');
tasks.shift()();
assert.equal(fallbackCalls, 2, 'failed shared UV solve falls back on both individual cliffs');
makeBatch(() => true)([mesa(1), mesa(2)], 'good-batch');
tasks.shift()();
assert.equal(fallbackCalls, 2, 'successful shared UV solve avoids redundant individual work');
makeBatch(() => { throw new Error('solver failed'); })([mesa(1), mesa(2)], 'error-batch');
tasks.shift()();
assert.equal(fallbackCalls, 4, 'thrown shared UV solve still falls back');
assert.equal(postStats.failures, 1);


function checkCompleteBatchBeforeCommit() {
  // The combined solve must not report success if even one deferred mesa
  // lacked cliff triangles. This exercises the actual production adapter.
  class Attribute {
    constructor(values, itemSize) { this.array = Float32Array.from(values); this.itemSize = itemSize; this.count = values.length / itemSize; }
    getX(i) { return this.array[i * this.itemSize]; }
    getY(i) { return this.array[i * this.itemSize + 1]; }
    getZ(i) { return this.array[i * this.itemSize + 2]; }
    setXY(i, u, v) { this.array[i * this.itemSize] = u; this.array[i * this.itemSize + 1] = v; }
    clone() { return new Attribute(this.array, this.itemSize); }
  }
  let abandonedClonesDisposed = 0; // Used to verify rejected batches do not leak temporary geometry clones.
  class Geometry {
    constructor(position, groups) {
      this.attributes = { position: new Attribute(position, 3), uv: new Attribute(new Array(position.length / 3 * 2).fill(0.5), 2) };
      this.groups = groups;
      this.userData = {};
      this.index = null;
    }
    getAttribute(name) { return this.attributes[name]; }
    setAttribute(name, attr) { this.attributes[name] = attr; }
    clone() {
      const clone = new Geometry(this.attributes.position.array, this.groups.slice());
      clone.attributes.uv = this.attributes.uv.clone();
      clone.userData = { ...this.userData };
      return clone;
    }
    dispose() { abandonedClonesDisposed++; }
  }
  class BufferGeometry {
    constructor() { this.attributes = {}; this.userData = {}; }
    setAttribute(name, attr) { this.attributes[name] = attr; }
    getAttribute(name) { return this.attributes[name]; }
    dispose() {}
  }
  class Vector3 {
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    applyMatrix4() { return this; }
  }
  const THREE = { Vector3, BufferGeometry, Float32BufferAttribute: Attribute }; // Used to run the shipped adapter on real-shaped geometry buffers.
  const vertices = [0,0,0, 1,0,0, 0,1,0, 1,0,0, 1,1,0, 0,1,0]; // Two triangles provide six cliff corners per mesa.
  const makeMesa = (id, groups) => ({
    isMesh: true, name: 'mesa-' + id, material: [{}, {}], geometry: new Geometry(vertices, groups), userData: {},
  });
  const stats = { batches: 0, meshes: 0, uvVertices: 0, failures: 0, recent: [] }; // Used to check batch completion accounting.
  let solverCalls = 0; // Used to confirm incomplete batches never enter the costly central mapper.
  const windowMock = { HobunjiSurfaceStretchUV: { mapGeometry(geometry) {
    solverCalls++;
    const count = geometry.getAttribute('position').count;
    geometry.setAttribute('uv', new Attribute(new Array(count * 2).fill(0.75), 2));
    geometry.userData.hobunjiSurfaceStretch = { patchCount: 1, mapping: 'edge-preserving-nine-slice' };
    return geometry;
  } } };
  const sourceStart = post.indexOf('  function selectedUvRanges('); // Used to include the shipped range, clone and batch helpers together.
  const sourceEnd = post.indexOf('  function captureSceneMeshes(', sourceStart); // Used to stop before unrelated scene capture logic.
  assert.ok(sourceStart >= 0 && sourceEnd > sourceStart, 'batch implementation present');
  const solve = new Function('THREE', 'window', 'PLATEAU_CLIFF_MATERIAL_SLOT',
    'CROSS_MESH_UV_OWNER', 'crossMeshStats', 'FRAME_DEBUG_HISTORY_LIMIT', 'debugLog',
    post.slice(sourceStart, sourceEnd) + '\nreturn mapTouchingPlateauCliffBatch;')(
    THREE, windowMock, 1, 'plateau-cliff-cross-mesh-v1', stats, 16, () => {});

  const one = makeMesa(1, [{ start: 0, count: 6, materialIndex: 1 }]);
  const noCliff = makeMesa(2, []); // Material slot exists but this mesh contributes no cliff-face geometry.
  const originalOne = one.geometry; // Used to confirm failed batch attempts cannot replace a mesh's visible ground or cliffs.
  const originalNoCliff = noCliff.geometry; // Used to confirm the no-cliff participant remains unchanged.
  assert.equal(solve([one, noCliff], 'partial'), false,
    'partial solve cannot claim success and suppress the per-mesh fallback');
  assert.equal(solverCalls, 0, 'incomplete batch must not invoke the central mapper');
  assert.equal(stats.batches, 0);
  assert.equal(one.geometry, originalOne, 'rejected batch retains the original textured geometry');
  assert.equal(noCliff.geometry, originalNoCliff, 'rejected no-cliff mesh retains its original geometry');
  assert.equal(abandonedClonesDisposed, 2, 'failed batch disposes every unused geometry clone');
  const two = makeMesa(3, [{ start: 0, count: 6, materialIndex: 1 }]);
  assert.equal(solve([one, two], 'complete'), true, 'complete two-mesa batch is still supported');
  assert.equal(stats.batches, 1);
  assert.notEqual(one.geometry, originalOne, 'successful batch adopts its independent UV geometry');
  assert.equal(one.userData.terrainJigsawIgnore, true);
  assert.equal(two.userData.naturalSurfaceUvOwner, 'HobunjiSurfaceStretchUV');
  assert.equal(one.userData.wildernessCliffSurfaceParity, true, 'deferred cliff retains the completed parity marker');
  assert.equal(two.userData.wildernessCliffUvPatchWorldSize, 6, 'deferred cliff retains the authored rock texture scale');
  assert.equal(one.geometry.getAttribute('uv').getX(0), 0.75, 'the combined solver writes the cliff UV corners');

  const priorOne = one.geometry; // Used to verify a throwing central mapper leaves a previously committed mesh untouched.
  const priorTwo = two.geometry; // Used for the same ownership check on the second mesa.
  windowMock.HobunjiSurfaceStretchUV.mapGeometry = () => { throw new Error('deliberate unwrap failure'); };
  let caught = false; // Used to confirm the adapter propagates the exception to its scheduled per-mesh fallback.
  try { solve([one, two], 'throwing'); } catch (error) { caught = error.message === 'deliberate unwrap failure'; }
  assert.equal(caught, true, 'central unwrap exception propagates to the safe batch fallback');
  assert.equal(one.geometry, priorOne, 'throwing batch never replaces the first mesh');
  assert.equal(two.geometry, priorTwo, 'throwing batch never replaces the second mesh');
  assert.equal(abandonedClonesDisposed, 4, 'throwing batch disposes both uncommitted mesh clones');
}

function checkFallbackOwnershipReset() {
  let remapCalls = 0; // Used to verify the per-mesh fallback takes the central mapper's ownership wrappers.
  const stats = { candidateMeshes: 0, crossMeshUvsDeferred: 0, remappedMeshes: 0, missingUvsBefore: 0, missingUvsAfter: 0 }; // Used by parity's fallback diagnostics.
  const windowMock = { HobunjiSurfaceStretchUV: {
    mapMesh() { throw new Error('plateau fallback bypassed ownership wrappers'); },
    remapNaturalTerrainMesh(mesh) {
      remapCalls++;
      assert.equal(mesh.userData.naturalSurfaceCrossMeshUvOwner, undefined, 'stale cross-mesh ownership cleared before fallback');
      mesh.userData.facetedSurfaceTextureOutline = true;
      return { patchCount: 1 };
    },
  } };
  const apply = fromSource(parity, 'applyFinalSurfacePass', '  function scheduleFinalSurfacePass(', [
    'isNaturalCliffCandidate', 'stats', 'hasValidUvs', 'PLATEAU_CLIFF_MATERIAL_SLOT',
    'makeMaterialMatchFarm', 'clearCachedSurfaceMapping', 'window', 'WILDERNESS_CLIFF_UV_PATCH_WORLD_SIZE',
  ], [() => true, stats, () => true, 1, () => false, () => false, windowMock, 6]);
  const mesh = { isMesh: true, name: 'fallback', material: [{}, {}], userData: {
    naturalSurfaceCliffSlot: 1,
    naturalSurfaceCrossMeshUvOwner: 'plateau-cliff-cross-mesh-v1',
    naturalSurfaceCrossMeshUvBatch: 'old-batch',
  }, geometry: { userData: {} } };
  assert.equal(apply(mesh, 'fallback', { materialSlot: 1 }), true);
  assert.equal(remapCalls, 1);
  assert.equal(mesh.userData.naturalSurfaceCrossMeshUvBatch, undefined);
  assert.equal(mesh.userData.naturalSurfaceUvOwner, 'HobunjiSurfaceStretchUV');
  assert.equal(mesh.userData.terrainJigsawIgnore, true);
}

checkCompleteBatchBeforeCommit();
checkFallbackOwnershipReset();

let allocations = 0; // Used to count temporary geometry creation for material naturalization.
let disposals = 0; // Used to ensure temporary proxy geometry is released.
let naturalizes = 0; // Used to prove repeated cliffs with the same source material are reused.
class PlaneGeometry { constructor() { allocations++; } dispose() { disposals++; } }
class Mesh { constructor(geometry, material) { this.geometry = geometry; this.material = material; this.isMesh = true; } }
const materialStats = { farmMaterialCacheHits: 0 }; // Used to expose the effectiveness of proxy caching.
const materialFor = fromSource(parity, 'farmRockMaterialFromSource', '  function makeMaterialMatchFarm(', [
  'window', 'THREE', 'farmMaterialCache', 'stats',
], [{ NaturalSurfaceMaterials: { naturalizeMesh(mesh) {
  naturalizes++;
  mesh.geometry = new PlaneGeometry();
  mesh.material = { map: {}, generation: naturalizes };
} } }, { PlaneGeometry, Mesh }, new WeakMap(), materialStats]);
let color = '808080'; // Used to invalidate the material when an editable palette changes.
const sourceMaterial = { color: { getHexString: () => color }, opacity: 1 };
const first = materialFor(sourceMaterial);
assert.equal(materialFor(sourceMaterial), first, 'unchanged source material is reused');
assert.equal(naturalizes, 1);
color = '999999';
assert.notEqual(materialFor(sourceMaterial), first, 'changed source material is regenerated');
assert.equal(allocations, disposals, 'temporary material-only geometries are disposed');

let remaps = 0; // Used to assert a valid surface island avoids redundant UV rebuilding.
const uvStats = { validUvFastPaths: 0, missingUvSurfaceMarkersFound: 0, missingUvSurfaceRepairs: 0, islandUvReassertions: 0 }; // Used by runtime repair diagnostics.
const reassert = fromSource(runtime, 'reassertIslandUvs', '  function inspectMesh(', [
  'window', 'stats', 'debugLog', 'naturalSurfaceFor',
], [{ HobunjiSurfaceStretchUV: { remapNaturalTerrainMesh() { remaps++; return { patchCount: 1 }; } } },
  uvStats, () => {}, () => 'rocks']);
const geometry = { userData: {
  hobunjiSurfaceStretchSignature: 'surface-island-v3|furniture-adjacency|angle=24|material=*|edge=0.32|reference=6',
  hobunjiSurfaceStretch: { version: 3, mapping: 'edge-preserving-nine-slice' },
}, attributes: { position: { count: 6 }, uv: { count: 6, itemSize: 2 } },
getAttribute(name) { return this.attributes[name]; } }; // Used to model complete rock UVs and deliberately corrupted UVs.
const rock = { isMesh: true, name: 'rock', userData: { naturalSurface: 'rocks', terrainJigsawIgnore: true,
  naturalSurfaceUvOwner: 'HobunjiSurfaceStretchUV', facetedSurfaceTextureOutline: true },
  material: { userData: { naturalSurface: 'rocks' } }, geometry }; // Used as the runtime natural-surface repair target.
assert.equal(reassert(rock), false);
assert.equal(remaps, 0, 'valid rock UVs with completed Jigsaw/outline decisions do not rerun the mapper');
rock.userData.terrainJigsawIgnore = false;
reassert(rock);
assert.equal(remaps, 1, 'valid UVs missing ownership markers still invoke the wrappers that establish Jigsaw and outline policy');
rock.userData.terrainJigsawIgnore = true;
delete geometry.attributes.uv;
reassert(rock);
assert.equal(remaps, 2, 'lost UVs still force recovery');
assert.equal(uvStats.missingUvSurfaceMarkersFound, 1);

let now = 100; // Used to simulate several render passes in one frame.
let notices = 0; // Used to count expensive terrain geometry-ready scene scans.
let renders = 0; // Used to ensure every actual render still executes.
let chunked = 0; // Used to force immediate geometry notifications on a real chunk mutation.
const renderStats = { renderPasses: 0, jigsawMutations: 0, chunkMutations: 0,
  geometryNoticeScans: 0, geometryNoticeScansAvoided: 0 }; // Used by the post-Jigsaw render budget.
const render = fromSource(post, 'wrappedRender', '  wrappedRender.__hobunjiNaturalSurfacePostJigsawWrapped', [
  'performance', 'stats', 'jigsawApi', 'chunkApi', 'inspectSceneTerrain',
  'notifyTerrainGeometryReady', 'lastGeometryNoticeAt', 'GEOMETRY_NOTICE_INTERVAL_MS', 'originalRender',
], [{ now: () => now }, renderStats, { scanScene: () => 0 }, { scanScene: () => chunked },
  () => {}, () => { notices++; }, new WeakMap(), 16, { call() { renders++; } }]);
const scene = { isScene: true, children: [] }; // Used as one scene rendered during color, depth, and outline passes.
render(scene, {});
now = 101; render(scene, {});
now = 105; render(scene, {});
assert.equal(notices, 1, 'same-frame auxiliary passes do not rescan terrain owners');
now = 117; render(scene, {});
assert.equal(notices, 2, 'terrain notices resume on the next 16ms frame, not after a half-second delay');
now = 118; chunked = 1; render(scene, {});
assert.equal(notices, 3, 'chunk mutation immediately notifies the terrain owners');
assert.equal(renders, 5, 'no native render passes are discarded');
assert.equal(renderStats.geometryNoticeScansAvoided, 2);

console.log('Terrain surface pass deduplication, material reuse, repair and notification checks passed.');
