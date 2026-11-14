#!/usr/bin/env node
'use strict';
// Instanced brick walls and farm/town grass must leave the camera pass and
// the scissored held/shell depth replays when their instances are outside the
// view; wilderness grass chunks with authored bounds must leave the replays;
// sky shells that cannot write depth must leave the colorless replays.
// Executes the shipping InstancedMeshBounds, InstancedMeshViewCull,
// GrassBillboardRenderChunks and the replay cull from
// held-object-render-order.js against small geometric fakes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const read = p => fs.readFileSync(p, 'utf8');
const boundsSource = read('docs/js/instanced-mesh-bounds.js');
const viewSource = read('docs/js/instanced-mesh-view-cull.js');
const grassSource = read('docs/js/grass-billboard-render-chunks.js');
const heldSource = read('docs/js/held-object-render-order.js');
const wallSource = read('docs/js/WallBuilder.js');
const game = read('docs/game.js');
const index = require('./classic-script-group-index.js').expandClassicScriptGroups();
const sky = read('docs/js/sky-dome.js');
const veg = read('docs/js/vegetation-crop-rendering.js');
const border = read('docs/js/border-terrain.js');
const zoneGrass = read('docs/js/zone-grass-billboards.js');

// Translation-only math: a matrix is an {x,y,z} offset (instance) or a 16-float
// column-major array slice (grass chunks copy raw instance matrices).
class Vector3 { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } }
class Sphere {
  constructor(center = new Vector3(), radius = -1) { this.center = center; this.radius = radius; }
  copy(s) { this.center = new Vector3(s.center.x, s.center.y, s.center.z); this.radius = s.radius; return this; }
  applyMatrix4(m) { this.center.x += m.x; this.center.y += m.y; this.center.z += m.z; return this; }
}
class Box3 {
  constructor() { this.makeEmpty(); }
  makeEmpty() { this.min = new Vector3(Infinity, Infinity, Infinity); this.max = new Vector3(-Infinity, -Infinity, -Infinity); return this; }
  copy(b) { this.min = new Vector3(b.min.x, b.min.y, b.min.z); this.max = new Vector3(b.max.x, b.max.y, b.max.z); return this; }
  applyMatrix4(m) { for (const p of [this.min, this.max]) { p.x += m.x; p.y += m.y; p.z += m.z; } return this; }
  union(b) { for (const k of ['x', 'y', 'z']) { this.min[k] = Math.min(this.min[k], b.min[k]); this.max[k] = Math.max(this.max[k], b.max[k]); } return this; }
  isEmpty() { return this.max.x < this.min.x; }
  getBoundingSphere(target) {
    target.center = new Vector3((this.min.x + this.max.x) / 2, (this.min.y + this.max.y) / 2, (this.min.z + this.max.z) / 2);
    target.radius = Math.hypot(this.max.x - this.min.x, this.max.y - this.min.y, this.max.z - this.min.z) / 2;
    return target;
  }
}
class Matrix4 {
  constructor() { this.x = 0; this.y = 0; this.z = 0; }
  copy(m) { this.x = m.x; this.y = m.y; this.z = m.z; return this; }
  multiplyMatrices(projection) { this.minX = projection.minX; this.maxX = projection.maxX; return this; }
}
class Frustum { // A view is an x-range; a sphere is inside when it touches the range.
  setFromProjectionMatrix(m) { this.minX = m.minX; this.maxX = m.maxX; return this; }
  intersectsSphere(s) { return s.center.x + s.radius >= this.minX && s.center.x - s.radius <= this.maxX; }
  intersectsObject(o) { return this.intersectsSphere(o.testSphere); }
  intersectsSprite(o) { return this.intersectsSphere(o.testSphere); }
}
class Node3 {
  constructor() { this.children = []; this.parent = null; this.visible = true; this.userData = {}; this.matrix = new Matrix4(); this.matrixWorld = new Matrix4(); this.matrixAutoUpdate = true; this.layers = { mask: 1 }; }
  add(c) { if (c.parent) c.parent.remove(c); c.parent = this; this.children.push(c); this.added = (this.added || 0) + 1; return this; }
  remove(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parent = null; return this; }
  updateMatrix() {}
  updateMatrixWorld() { const p = this.parent?.matrixWorld || new Matrix4(); this.matrixWorld = { x: p.x + this.matrix.x, y: p.y + this.matrix.y, z: p.z + this.matrix.z }; for (const c of this.children) c.updateMatrixWorld(); }
}
class Group extends Node3 {}
// Instance matrices are real 16-float arrays; only the translation is read.
class InstancedMesh extends Node3 {
  constructor(geometry, material, capacity) {
    super(); this.isInstancedMesh = true; this.isMesh = true; this.geometry = geometry; this.material = material;
    this.instanceMatrix = { array: new Float32Array(capacity * 16), version: 0, set needsUpdate(v) { if (v) this.version++; } };
    this.count = capacity; this.castShadow = false; this.receiveShadow = false; this.renderOrder = 0; this.frustumCulled = true;
  }
  getMatrixAt(i, m) { const a = this.instanceMatrix.array; m.x = a[i * 16 + 12]; m.y = a[i * 16 + 13]; m.z = a[i * 16 + 14]; }
  setX(i, x, z = 0) { this.instanceMatrix.array[i * 16 + 12] = x; this.instanceMatrix.array[i * 16 + 14] = z; }
  dispose() { this.disposed = true; }
}
let baseRaycasts = 0;
InstancedMesh.prototype.raycast = function () { baseRaycasts++; };
const THREE = { Vector3, Sphere, Box3, Matrix4, Frustum, Group, InstancedMesh };
const blade = () => ({ uuid: 'blade', boundingBox: { min: new Vector3(-0.5, 0, -0.5), max: new Vector3(0.5, 1, 0.5) } });
function instanced(xs, parent) {
  const mesh = new InstancedMesh(blade(), { id: 'brick' }, xs.length);
  xs.forEach((x, i) => mesh.setX(i, x));
  if (parent) parent.add(mesh);
  return mesh;
}

const win = { THREE };
new Function('window', boundsSource)(win);
const B = win.InstancedMeshBounds;
assert(B, 'bounds module exposes window.InstancedMeshBounds');

// ── InstancedMeshBounds ─────────────────────────────────────────────────────
const scene = new Group(); scene.isScene = true;
const otherScene = new Group(); otherScene.isScene = true;
const group = new Group(); scene.add(group);
const otherGroup = new Group(); otherScene.add(otherGroup);
const nearWall = B.tag(instanced([0, 4, 8], group));
const farWall = B.tag(instanced([100, 104], group));
const preHidden = B.tag(instanced([200], group)); preHidden.visible = false;
const elsewhere = B.tag(instanced([300], otherGroup));
const untagged = instanced([400], group);
const hiddenParent = new Group(); hiddenParent.visible = false; scene.add(hiddenParent);
const underHidden = B.tag(instanced([500], hiddenParent));
const out = new Sphere();
const near = B.worldSphere(nearWall, out);
assert.equal(near.center.x, 4, 'sphere is centred on the instances, not the base geometry');
assert(near.center.x - near.radius <= -0.5 && near.center.x + near.radius >= 8.5, 'sphere encloses every instance');
assert.equal(B.worldSphere(untagged, out), null, 'untagged instanced meshes are never bounded');
farWall.setX(1, 20); farWall.instanceMatrix.needsUpdate = true;
const movedSphere = B.worldSphere(farWall, new Sphere());
assert(movedSphere.center.x - movedSphere.radius <= 19.5, 'bounds follow an instance update');
farWall.setX(1, 104); farWall.instanceMatrix.needsUpdate = true;
let visited = 0; B.forEachTracked(() => visited++);
assert.equal(visited, 5, 'tracked meshes are enumerable without a scene traversal');
const replayOnly = B.tag(instanced([0]), { track: false });
visited = 0; B.forEachTracked(m => { if (m === replayOnly) visited++; });
assert.equal(visited, 0, 'track:false tags for the replay cull only');

// WallBuilder delegates its raycast early-out and tags every wall mesh.
assert.match(wallSource, /root\.InstancedMeshBounds\?\.tag\(inst\);/, 'every built wall mesh is tagged');
const rBegin = wallSource.indexOf('  const _rayBoundsSphere = new THREE.Sphere();');
const rEnd = wallSource.indexOf('  function v3(arr) {', rBegin);
const raycastFn = new Function('THREE', 'root', `${wallSource.slice(rBegin, rEnd)}; return boundedInstancedRaycast;`)(THREE, win);
raycastFn.call(nearWall, { ray: { intersectsSphere: () => false } }, []);
assert.equal(baseRaycasts, 0, 'rays that miss the sphere skip the per-instance test');
raycastFn.call(nearWall, { ray: { intersectsSphere: () => true } }, []);
assert.equal(baseRaycasts, 1, 'rays that touch it still test every instance');
new Function('THREE', 'root', `${wallSource.slice(rBegin, rEnd)}; return boundedInstancedRaycast;`)(THREE, {}).call(nearWall, { ray: { intersectsSphere: () => false } }, []);
assert.equal(baseRaycasts, 2, 'without the bounds module (tool pages) rays fall back to the plain test');

// ── InstancedMeshViewCull ───────────────────────────────────────────────────
new Function('window', viewSource)(win);
const view = win.InstancedMeshViewCull;
assert(view?.enabled, 'view cull ships enabled');
const camera = { isCamera: true, projectionMatrix: { minX: -10, maxX: 30 }, matrixWorldInverse: {}, updateMatrixWorld() { this.updated = true; } };
const restoreView = view.suspendForRender(scene, camera);
assert(camera.updated, 'current camera transform is resolved first');
assert.equal(nearWall.visible, true, 'in-view meshes keep drawing');
assert.equal(farWall.visible, false, 'meshes wholly outside the view are not submitted');
assert.equal(preHidden.visible, false);
assert.equal(underHidden.visible, true, 'meshes under a hidden ancestor are left alone');
assert.equal(elsewhere.visible, true, 'meshes of another scene are untouched');
assert.deepEqual([view.snapshot().hidden, view.snapshot().hiddenInstances], [1, 2]);
restoreView();
assert.equal(farWall.visible, true, 'restore returns every mesh');
assert.equal(preHidden.visible, false, 'restore never reveals a mesh it did not hide');
view.suspendForRender(scene, camera);
view.suspendForRender(scene, { ...camera, projectionMatrix: { minX: 90, maxX: 110 } });
assert.equal(farWall.visible, true, 'a missed restore is undone by the next call');
assert.equal(nearWall.visible, false);
view.setEnabled(false);
assert.equal(nearWall.visible, true, 'disabling restores immediately');
assert.equal(view.suspendForRender(scene, camera), null);
view.setEnabled(true);

// ── GrassBillboardRenderChunks ──────────────────────────────────────────────
new Function('window', grassSource)(win);
const chunks = win.GrassBillboardRenderChunks;
assert(chunks?.enabled, 'grass chunks ship enabled');
const farm = new Group(); farm.isScene = true;
const grass = new InstancedMesh(blade(), { id: 'grassMat' }, 64);
grass.userData.isBillboard = true; grass.frustumCulled = false; grass.layers.mask = 1 | (1 << 27); grass.castShadow = true;
grass.matrix.x = 2; // A source local transform must carry over to its chunks.
for (let i = 0; i < 40; i++) grass.setX(i, (i % 4) * 8 + 0.5, Math.floor(i / 20) * 8 + 0.5); // 4 x 2 cells of 8 tiles.
grass.setX(40, NaN);
grass.count = 41;
farm.add(grass);
chunks.register(grass); chunks.register(grass);
assert.equal(chunks.snapshot().chunkTiles, 8);
const restoreGrass = chunks.suspendForRender(farm);
const holder = farm.children.find(c => c.userData.hobunjiGrassRenderChunkHolder);
assert(holder, 'holder is placed beside the source');
assert.equal(grass.visible, false, 'the source is hidden for the world render');
assert.equal(holder.visible, true);
assert.equal(holder.children.length, 8, 'one chunk per occupied 8x8 cell; registering twice adds nothing');
assert.equal(holder.children.reduce((n, c) => n + c.count, 0), 40, 'every finite instance is drawn exactly once');
for (const chunk of holder.children) {
  assert.equal(chunk.geometry, grass.geometry, 'chunks share the source geometry');
  assert.equal(chunk.material, grass.material, 'chunks share the source material');
  assert.equal(chunk.layers.mask, grass.layers.mask);
  assert.equal(chunk.castShadow, true);
  assert.equal(chunk.frustumCulled, false);
  assert.equal(chunk.userData.isBillboard, undefined, 'footprint/height writers never see the chunks');
  assert.equal(chunk.userData.hobunjiInstanceBounds, true, 'chunks are culled by the view and replay culls');
  chunk.raycast(); assert.equal(baseRaycasts, 2, 'chunks never answer raycasts');
}
assert.equal(holder.matrixWorld.x, 2, 'holder copies the source transform');
const firstChunk = holder.children[0];
const world = B.worldSphere(firstChunk, new Sphere());
assert(world.center.x >= 2 && world.radius < 8, 'a chunk sphere covers one cell, not the map');
const viewRestore = view.suspendForRender(farm, { ...camera, projectionMatrix: { minX: 0, maxX: 10 } });
assert.equal(holder.children.filter(c => c.visible).length, 4, 'only chunks in view are submitted (the fake frustum is an x-range: 2 columns x 2 rows)');
viewRestore(); restoreGrass();
assert.equal(grass.visible, true, 'restore shows the source again');
assert.equal(holder.visible, false, 'holder is hidden outside the world render');
const rebuilds = chunks.snapshot().rebuilds;
chunks.suspendForRender(farm)();
assert.equal(chunks.snapshot().rebuilds, rebuilds, 'unchanged sources are not re-partitioned');
grass.count = 10; grass.instanceMatrix.needsUpdate = true; // e.g. a footprint compaction.
chunks.suspendForRender(farm)();
assert.equal(chunks.snapshot().rebuilds, rebuilds + 1, 'a source write triggers one rebuild');
assert.equal(holder.children.reduce((n, c) => n + c.count, 0), 10);
assert.equal(holder.children.length, 4, 'emptied cells are dropped');
grass.material = { id: 'seasonal' };
chunks.suspendForRender(farm)();
assert(holder.children.every(c => c.material === grass.material), 'material swaps follow without a rebuild');
grass.visible = false; // Settings > Grass off.
assert.equal(chunks.suspendForRender(farm), null, 'a hidden source is not swapped');
assert.equal(holder.visible, false);
grass.visible = true;
assert.equal(chunks.suspendForRender(scene), null, 'sources of other scenes are ignored');
chunks.suspendForRender(farm);
chunks.suspendForRender(farm); // Missed restore...
assert.equal(chunks.snapshot().swapped, 1, '...does not double-swap');
chunks.setEnabled(false);
assert.equal(grass.visible, true, 'disabling restores the source');
assert.equal(holder.parent, null, 'disabling releases the chunk copies');
chunks.setEnabled(true);
chunks.suspendForRender(farm)();
farm.remove(grass); // Replaced on rebuild.
chunks.suspendForRender(farm);
assert.equal(holder.parent, null, 'a detached source drops its holder');
assert(firstChunk.disposed, 'chunk instance buffers are released');

// ── Held/shell replay cull ──────────────────────────────────────────────────
const hBegin = heldSource.indexOf('  function isReplayCullable(object) {');
const hEnd = heldSource.indexOf('  function cullReplayGroup(', hBegin);
assert(hBegin > 0 && hEnd > hBegin, 'replay cull block is present');
const replayCullFrustum = new Frustum().setFromProjectionMatrix({ minX: -1, maxX: 1 }); // The small scissor sub-frustum.
const replay = new Function('THREE', 'window', 'replayCullFrustum', `
  let lastReplayCulledCount = 0, lastReplayKeptCount = 0, lastReplayInstancedCulled = 0, lastReplayInstancedKept = 0, lastReplayInertCount = 0;
  ${heldSource.slice(hBegin, hEnd)}
  return { collectReplayCulled, replayFrustumIntersects, stats: () => ({ lastReplayInstancedCulled, lastReplayInstancedKept, lastReplayInertCount }) };
`)(THREE, win, replayCullFrustum);
const plain = (x, extra = {}) => ({ isMesh: true, visible: true, children: [], userData: {}, layers: { mask: 1 }, geometry: {}, testSphere: new Sphere(new Vector3(x, 0, 0), 1), ...extra });
const authored = (x, extra = {}) => plain(x, { isInstancedMesh: true, frustumCulled: true, userData: { hobunjiAuthoredInstanceBounds: true }, geometry: { boundingSphere: {} }, ...extra });
const skyShell = plain(0, { frustumCulled: false, userData: { hobunjiDepthReplayInert: true }, material: { depthWrite: false } });
const cloudMask = plain(0, { frustumCulled: false, userData: { hobunjiDepthReplayInert: true }, material: { depthWrite: true } });
const cutoutShell = plain(0, { frustumCulled: false, userData: { hobunjiDepthReplayInert: true }, material: { depthWrite: false, alphaTest: 0.5 } });
const layeredShell = plain(0, { frustumCulled: false, userData: { hobunjiDepthReplayInert: true }, material: { depthWrite: false }, layers: { mask: 3 } });
const heldHand = plain(50), rock = plain(60), nearRock = plain(0);
const wildNear = authored(0), wildFar = authored(70), wildUnculled = authored(70, { frustumCulled: false });
const nodes = [nearWall, farWall, untagged, skyShell, cloudMask, cutoutShell, layeredShell, heldHand, rock, nearRock, wildNear, wildFar, wildUnculled];
const candidates = [];
const culled = new Set(replay.collectReplayCulled({ traverseVisible(fn) { for (const n of nodes) if (n.visible) fn(n); } }, new Set([heldHand]), candidates));
assert(culled.has(farWall), 'tagged meshes wholly outside the scissor leave the depth replay');
assert(!culled.has(nearWall), 'tagged meshes that can cover the held part stay');
assert(!culled.has(untagged), 'untagged instanced meshes are never culled');
assert(culled.has(wildFar) && !culled.has(wildNear), 'authored-bounds wilderness chunks are culled by their geometry sphere');
assert(!culled.has(wildUnculled), 'authored bounds are only trusted on frustum-cullable meshes');
assert(culled.has(skyShell), 'a depthWrite:false sky shell cannot affect a colorless depth replay');
assert(!culled.has(cloudMask), 'the cloud depth mask keeps writing depth');
assert(!culled.has(cutoutShell), 'alpha-tested shells are forced to write depth and must stay');
assert(!culled.has(layeredShell), 'a shell on another layer may draw in color in a masked pass');
assert(!culled.has(heldHand), 'replay participants are kept');
assert(culled.has(rock) && !culled.has(nearRock), 'ordinary mesh culling is unchanged');
assert(candidates.includes(nearWall) && candidates.includes(wildNear), 'kept meshes are offered to the per-group cull');
assert.deepEqual(replay.stats(), { lastReplayInstancedCulled: 2, lastReplayInstancedKept: 2, lastReplayInertCount: 1 });
assert.equal(replay.replayFrustumIntersects(farWall), false, 'per-group cull uses the instance sphere too');
assert.match(heldSource, /if \(replayFrustumIntersects\(object\)\) continue;/, 'cullReplayGroup shares the instance-aware test');

// ── Wiring ──────────────────────────────────────────────────────────────────
assert.match(game, /const restoreGrassChunks = window\.GrassBillboardRenderChunks\?\.suspendForRender\?\.\(activeScene\);\s*\n\s*const restoreWallVisuals = window\.InstancedMeshViewCull\?\.suspendForRender\?\.\(activeScene, camera\);/, 'grass swaps to chunks before the view cull runs');
assert.match(game, /finally \{[\s\S]{0,500}restoreWallVisuals\?\.\(\);[\s\S]{0,200}restoreGrassChunks\?\.\(\);/, 'both are restored in finally');
for (const file of ['instanced-mesh-bounds', 'instanced-mesh-view-cull', 'grass-billboard-render-chunks']) {
  assert.match(index, new RegExp(`js/${file}\\.js\\?v=[A-Za-z0-9_-]+`), `${file} is loaded by the game page`);
}
assert(index.indexOf('js/instanced-mesh-bounds.js') < index.indexOf('js/WallBuilder.js'), 'bounds load before WallBuilder');
for (const name of ['farmGrassBillMesh', 'farmWeedBillMesh', 'townGrassBillMesh']) {
  assert.match(veg, new RegExp(`GrassBillboardRenderChunks\\?\\.register\\(${name}\\)`), `${name} is chunked`);
}
assert.match(border, /GrassBillboardRenderChunks\?\.register\(townBorderGrassBillMesh\)/, 'town border grass is chunked');
assert.match(zoneGrass, /mesh\.userData\.hobunjiAuthoredInstanceBounds = true;/, 'wilderness chunks declare authored bounds');
assert.match(sky, /skyMesh\.userData\.hobunjiDepthReplayInert = true/);
assert.match(sky, /mesh\.userData\.hobunjiDepthReplayInert = true/);
assert.doesNotMatch(sky, /depthMesh\.userData\.hobunjiDepthReplayInert/, 'cloud depth masks stay in the replay');

console.log('instanced mesh render cull: ok');
