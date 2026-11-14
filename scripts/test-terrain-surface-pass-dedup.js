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
const rock = { isMesh: true, name: 'rock', userData: { naturalSurface: 'rocks' },
  material: { userData: { naturalSurface: 'rocks' } }, geometry }; // Used as the runtime natural-surface repair target.
assert.equal(reassert(rock), false);
assert.equal(remaps, 0, 'valid rock UVs do not rerun the mapper');
delete geometry.attributes.uv;
reassert(rock);
assert.equal(remaps, 1, 'lost UVs still force recovery');
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
  () => {}, () => { notices++; }, new WeakMap(), 500, { call() { renders++; } }]);
const scene = { isScene: true, children: [] }; // Used as one scene rendered during color, depth, and outline passes.
render(scene, {});
now = 200; render(scene, {});
now = 400; render(scene, {});
assert.equal(notices, 1, 'repeated passes do not rescan terrain owners');
now = 601; render(scene, {});
assert.equal(notices, 2, 'late registrations are still checked on the next interval');
now = 602; chunked = 1; render(scene, {});
assert.equal(notices, 3, 'chunk mutation immediately notifies the terrain owners');
assert.equal(renders, 5, 'no native render passes are discarded');
assert.equal(renderStats.geometryNoticeScansAvoided, 2);

console.log('Terrain surface pass deduplication, material reuse, repair and notification checks passed.');
