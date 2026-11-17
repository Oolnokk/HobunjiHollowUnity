'use strict';
// Executable render-scope regression test for the production wilderness culler.
// Node-only fakes cover the scene graph and translated Box3 bounds without WebGL.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/wilderness-distance-cull.js', 'utf8'); // Production module under test.
const clock = { now: 0 }; // Controlled scan cadence and teleport sequencing.
class Box3 {
  constructor(min = { x: 0, y: 0, z: 0 }, max = { x: 0, y: 0, z: 0 }) {
    this.min = { ...min }; this.max = { ...max };
  }
  copy(other) { this.min = { ...other.min }; this.max = { ...other.max }; return this; }
  applyMatrix4(matrix) {
    // The harness intentionally uses translation-only matrices. The browser
    // supplies real Three.Box3.applyMatrix4 for rotated/meshed terrain.
    for (const endpoint of [this.min, this.max]) {
      endpoint.x += matrix.elements[12];
      endpoint.y += matrix.elements[13];
      endpoint.z += matrix.elements[14];
    }
    return this;
  }
  isEmpty() { return this.min.x > this.max.x || this.min.z > this.max.z; }
}
const logs = []; // Captures fail-open diagnostics without a DevTools console.
const window = {
  THREE: { Box3, Sphere: class Sphere { constructor() { this.center = { x: 0, y: 0, z: 0 }; this.radius = 0; } }, Object3D: function Object3D() {} },
  InstancedMeshBounds: {
    worldSphere(mesh, target) {
      const spec = mesh.userData?.testSphere; // Same conservative world-sphere contract as the game's instance bounds owner.
      if (!spec) return null;
      target.center.x = spec.x; target.center.y = 0; target.center.z = spec.z;
      target.radius = spec.radius;
      return target;
    },
  },
  __farmLog: message => logs.push(message),
};
vm.runInNewContext(source, { window, performance: { now: () => clock.now } }, { filename: 'wilderness-distance-cull.js' });
const api = window.WildernessDistanceCull; // Same exported runtime API game.js uses.

const matrixAt = (x, z = 0) => ({ elements: [
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, z, 1,
] }); // A translated world matrix with no rotation in this harness.
const attach = (parent, child) => { parent.children.push(child); child.parent = parent; return child; };
const group = (name, userData = {}) => ({
  name, userData, children: [], visible: true,
}); // Generic Three.Object3D test owner.
function mesh(name, x, userData = {}, options = {}) {
  const localMinX = options.minX ?? -1; // Optional long geometry for nearest-edge tests.
  const localMaxX = options.maxX ?? 1;
  const position = { version: 0 }; // Simulates BufferAttribute version invalidation.
  const geometry = {
    attributes: { position },
    boundingBox: new Box3({ x: localMinX, y: -1, z: -1 }, { x: localMaxX, y: 1, z: 1 }),
    computeBoundingBox() { this.computed = (this.computed || 0) + 1; },
  }; // World geometry is not cloned or modified by the culler.
  return {
    name, userData, geometry, matrixWorld: matrixAt(x), children: [], visible: true,
    isMesh: true, frustumCulled: true, ...options,
  };
}
const scene = Object.assign(group('Northern Cliffs'), { isScene: true }); // Render-active wilderness zone.
const chunk = attach(scene, group('WildernessChunk_12_12', { wildernessChunk: true }));
const nearRock = attach(chunk, mesh('rock', 12));
const farRock = attach(chunk, mesh('rock', 164));
const farTree = attach(chunk, mesh('tree_branches', 169));
const farGrass = attach(chunk, mesh('grass_tuft', 162));
const farHooked = attach(chunk, mesh('rock_with_hook', 166, {}, { onBeforeRender() {} }));
const farSkinned = attach(chunk, mesh('rigged_rock', 171, {}, { isSkinnedMesh: true }));
const farInstanced = attach(chunk, mesh('instanced_rock', 171, {}, { isInstancedMesh: true }));
const taggedInstancedWall = attach(scene, mesh('wall_bricks', 171, {
  hobunjiInstanceBounds: true, testSphere: { x: 171, z: 0, radius: 4 },
}, { isInstancedMesh: true, frustumCulled: false })); // Only authoritative bounded instances may be distance-culled.
const farWater = attach(chunk, mesh('water_surface', 172));
const nearEdge = attach(chunk, mesh('long_cliff', 175, {}, { minX: -100, maxX: 1 }));
const invisibleGroup = attach(chunk, group('invisible_group'));
const invisibleChild = attach(invisibleGroup, mesh('rock', 180));
invisibleGroup.visible = false;
const batch = attach(scene, mesh('zone_prop_render_batch', 160, { hobunjiZonePropBatch: true, hobunjiZonePropKind: 'furniture' }));
const plantBatch = attach(scene, mesh('zone_prop_render_batch', 165, { hobunjiZonePropBatch: true, hobunjiZonePropKind: 'reagent' }));
const standalone = attach(scene, mesh('distant_mesa_rock', 182));
const terrainSource = attach(scene, mesh('zone_floor', 0, { terrainRenderChunkSource: true },
  { frustumCulled: false })); // TerrainRenderChunks keeps the source as parent of draw-range children.
const terrainChunk = attach(terrainSource, mesh('zone_floor__spatial_chunk_10_0', 0,
  { terrainRenderChunk: true }, { minX: 159, maxX: 175 }));
terrainChunk.geometry.computeBoundingBox = function () {
  this.computed = (this.computed || 0) + 1;
  this.boundingBox = new Box3({ x: 0, y: -1, z: -1 }, { x: 220, y: 1, z: 1 });
}; // Actual THREE computes every vertex in the shared buffer, ignoring the chunk's drawRange.
const actor = attach(scene, mesh('npc_walker_01', 190));
const untagged = attach(scene, mesh('ordinary_debug_mesh', 195));
const camera = { isCamera: true, matrixWorld: matrixAt(0), updateMatrixWorld() {} };
const focus = { x: 0, z: 0 }; // Player's authoritative tile-space location.
const render = (active = scene, opts = { isZone: true }) => api.suspendForRender(active, camera, focus, opts);
let release;

assert.equal(render(scene, { isZone: false }), null, 'non-wilderness scenes keep their ordinary renderer');
release = render();
assert.equal(farRock.visible, false, 'distant chunk mesh culled');
assert.equal(batch.visible, false, 'post-batching mesh culled');
assert.equal(standalone.visible, false, 'independent mesa culled');
assert.equal(terrainChunk.visible, false, 'distant spatial terrain bucket culled despite sharing vertices with near buckets');
assert.equal(terrainChunk.geometry.computed, undefined, 'authoritative terrain bucket bounds are not overwritten by full-buffer computeBoundingBox');
assert.equal(taggedInstancedWall.visible, false, 'authoritatively bounded wall instances culled');
for (const [object, message] of [
  [nearRock, 'near geometry'], [farTree, 'tree vegetation'], [farGrass, 'grass vegetation'],
  [farHooked, 'render-hook mesh'], [farSkinned, 'skinned rig'], [farInstanced, 'other instanced culler'],
  [farWater, 'water surface'], [nearEdge, 'large bounds intersect near space'],
  [invisibleChild, 'hidden ancestor'], [plantBatch, 'reagent vegetation batch'],
  [actor, 'actor'], [untagged, 'untagged unrelated mesh'],
]) assert.equal(object.visible, true, message + ' must not be altered');
assert.equal(api.snapshot().hidden, 5, 'only five actually drawable distant meshes are suppressed');
assert.equal(api.snapshot().hiddenInstanced, 1, 'tagged instanced meshes are measured separately');
assert.equal(typeof release, 'function', 'scope returns a restore callback');
release();
assert.equal(farRock.visible, true, 'first render restores static object before simulation');
assert.equal(batch.visible, true, 'first render restores batch before prop rendering tears it down');
assert.equal(taggedInstancedWall.visible, true, 'first render restores instanced structure');
assert.equal(terrainChunk.visible, true, 'spatial terrain draw-range visibility restored');

camera.matrixWorld = matrixAt(160);
release = render();
assert.equal(batch.visible, true, 'cutscene camera protects the mesh near its own origin');
assert.equal(terrainChunk.visible, true, 'camera proximity protects the spatial terrain bucket');
assert.equal(farRock.visible, true, 'camera proximity overrides distant player safely');
release?.();

camera.matrixWorld = matrixAt(0);
release = render();
assert.equal(farRock.visible, false, 'ordinary view continues to cull at a distance');
release();
farRock.matrixWorld = matrixAt(105);
release = render();
assert.equal(farRock.visible, false, 'previously hidden geometry remains hidden in the 12-tile hysteresis band');
release();
farRock.matrixWorld = matrixAt(97);
release = render();
assert.equal(farRock.visible, true, 'bounds crossing the conservative wake distance show immediately');
release?.();

farRock.matrixWorld = matrixAt(164);
release = render();
assert.equal(farRock.visible, false);
api.setEnabled(false);
assert.equal(farRock.visible, true, 'A/B switch cleans up an interrupted frame even without caller finally');
assert.equal(render(), null, 'disabled mode retains all scene objects');
api.setEnabled(true);
assert.equal(api.setDistanceTiles(NaN), 112, 'invalid threshold cannot poison culling');
assert.equal(api.setDistanceTiles(20), 112, 'dangerously short draw threshold rejected');
assert.equal(api.setDistanceTiles(128), 128, 'distance can be tuned for different fog/landmark coverage');

const late = attach(chunk, mesh('late_cliff', 220)); // Emulates a chunk object streamed after the previous scan.
release = render();
assert.equal(late.visible, true, 'new arrivals are retained until the next controlled scan');
release?.();
clock.now += 800;
release = render();
assert.equal(late.visible, false, 'next low-frequency scene scan includes streaming additions');
release();
assert.equal(late.visible, true, 'newly discovered object also restores correctly');

farRock.visible = false; // A different gameplay/render system intentionally hid this mesh.
release = render();
assert.equal(farRock.visible, false);
release?.();
assert.equal(farRock.visible, false, 'culling never overwrites a pre-existing hidden flag');
farRock.visible = true;
focus.x = 180;
release = render();
assert.equal(batch.visible, true, 'player teleport keeps newly nearby props rendered');
release?.();
focus.x = 0;

clock.now += 800;
const broken = attach(scene, group('faulty-geometry-owner'));
Object.defineProperty(broken, 'children', { get() { throw new Error('scan-injected'); } });
assert.equal(render(), null, 'scan exceptions fail open before render visibility mutation');
assert.equal(farRock.visible, true, 'scan exception does not strand previous objects hidden');
assert(logs.some(line => line.includes('scan failed open')), 'scan failures surface to in-game diagnostics');
scene.children.splice(scene.children.indexOf(broken), 1);
clock.now += 800;
release = render();
assert.equal(batch.visible, false, 'later scans recover after a transient scene error');
release?.();

assert(api.snapshot().scans >= 3, 'low-frequency scan count is exposed');
assert.equal(api.snapshot().renderOnly, true);
terrainChunk.geometry.attributes.position.version++; // A procedural vertex edit invalidates authoritative bucket bounds.
release = render();
assert.equal(terrainChunk.visible, true, 'updated shared position buffer falls back to a conservative whole-buffer box');
assert.equal(terrainChunk.geometry.computed, 1, 'position version change recomputes the box once');
release?.();

const loader = fs.readFileSync('docs/js/bootstrap/classic-groups/render.js', 'utf8'); // Ordered parser loader must install the module before game.js.
const game = fs.readFileSync('docs/game.js', 'utf8'); // Actual renderWorldPasses must wrap ALL outline/replay passes.
assert(loader.includes('js/wilderness-distance-cull.js?v='), 'classic rendering bootstrap includes the module');
const batchIndex = game.indexOf('const restoreZonePropBatches = window.ZonePropRenderBatches?.suspendForRender');
const distanceIndex = game.indexOf('const restoreWildernessDistance = window.WildernessDistanceCull?.suspendForRender');
const renderTryIndex = game.indexOf('        try {\n        // Frame-scoped whole-actor suppression', distanceIndex);
assert(batchIndex >= 0 && distanceIndex > batchIndex && renderTryIndex > distanceIndex,
  'distance cull begins after prop batching, before every world render pass');
const releaseIndex = game.indexOf('restoreWildernessDistance?.();');
const wallReleaseIndex = game.indexOf('restoreWallVisuals?.();', releaseIndex);
assert(releaseIndex > renderTryIndex && wallReleaseIndex > releaseIndex,
  'distance cull is restored by renderWorldPasses finally before wall/prop restore');
console.log('PASS wilderness distance cull: terrain draw-range bounds, batches, chunks, instances, exclusions, streaming, hysteresis, camera, restore, A/B and fail-open');
