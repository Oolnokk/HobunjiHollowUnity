#!/usr/bin/env node
'use strict';
// Instanced brick walls/paths must leave the camera pass and the scissored
// held/shell depth replays when every instance is outside the view, and sky
// shells that cannot write depth must leave the colorless replays. Executes
// the shipping WallBuilder bounds helper, InstancedWallViewCull and the replay
// cull from held-object-render-order.js against small geometric fakes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const wallSource = fs.readFileSync('docs/js/WallBuilder.js', 'utf8');
const cullSource = fs.readFileSync('docs/js/instanced-wall-view-cull.js', 'utf8');
const heldSource = fs.readFileSync('docs/js/held-object-render-order.js', 'utf8');
const game = fs.readFileSync('docs/game.js', 'utf8');
const index = fs.readFileSync('docs/index.html', 'utf8');
const sky = fs.readFileSync('docs/js/sky-dome.js', 'utf8');

// Translation-only math: an instance/world "matrix" is an {x,y,z} offset.
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
  multiplyMatrices(projection) { this.minX = projection.minX; this.maxX = projection.maxX; return this; }
}
// A view is an x-range; a sphere is inside when it touches the range.
class Frustum {
  setFromProjectionMatrix(m) { this.minX = m.minX; this.maxX = m.maxX; return this; }
  intersectsSphere(s) { return s.center.x + s.radius >= this.minX && s.center.x - s.radius <= this.maxX; }
  intersectsObject(o) { return this.intersectsSphere(o.testSphere); }
  intersectsSprite(o) { return this.intersectsSphere(o.testSphere); }
}
let baseRaycasts = 0;
const THREE = { Vector3, Sphere, Box3, Matrix4, Frustum, InstancedMesh: { prototype: { raycast() { baseRaycasts++; } } } };

function instancedMesh(xs, { parent = null, worldX = 0 } = {}) {
  return {
    isInstancedMesh: true, isMesh: true, visible: true, count: xs.length, children: [], userData: {}, parent, layers: { mask: 1 },
    matrixWorld: { x: worldX, y: 0, z: 0 },
    geometry: { boundingBox: { min: new Vector3(-0.5, 0, -0.5), max: new Vector3(0.5, 1, 0.5) } },
    instanceMatrix: { version: 1 }, xs,
    getMatrixAt(i, m) { m.x = this.xs[i]; m.y = 0; m.z = 0; },
  };
}

// ── WallBuilder: one authority for "where are this mesh's bricks" ──────────
const begin = wallSource.indexOf('  const _rayBoundsBox = new THREE.Box3();');
const end = wallSource.indexOf('  function v3(arr) {', begin);
assert(begin > 0 && end > begin, 'WallBuilder instance-bounds block is present');
const WallBuilder = {};
const wallApi = new Function('THREE', 'WallBuilder', 'WeakRef',
  `${wallSource.slice(begin, end)}; return { trackInstanceMesh, boundedInstancedRaycast, instanceLocalSphere };`)(THREE, WallBuilder, WeakRef);
assert.match(wallSource, /inst\.raycast = boundedInstancedRaycast;\s*\n\s*trackInstanceMesh\(inst\);/, 'every built wall mesh is tracked for render culling');

const scene = { isScene: true, parent: null }, otherScene = { isScene: true, parent: null };
const group = { parent: scene }, otherGroup = { parent: otherScene };
const nearWall = instancedMesh([0, 4, 8], { parent: group });
const farWall = instancedMesh([100, 104], { parent: group });
const preHidden = instancedMesh([200], { parent: group }); preHidden.visible = false;
const elsewhere = instancedMesh([300], { parent: otherGroup });
const untagged = instancedMesh([400], { parent: group }); // e.g. grass: no instance-aware bounds contract.
for (const mesh of [nearWall, farWall, preHidden, elsewhere]) wallApi.trackInstanceMesh(mesh);
assert.equal(nearWall.userData.hobunjiInstanceBounds, true);

const out = new Sphere();
const nearSphere = WallBuilder.instanceWorldSphere(nearWall, out);
assert(nearSphere && nearSphere.center.x === 4, 'sphere is centred on the instances, not the base geometry');
assert(nearSphere.center.x - nearSphere.radius <= -0.5 && nearSphere.center.x + nearSphere.radius >= 8.5, 'sphere encloses every brick');
assert.equal(WallBuilder.instanceWorldSphere(untagged, out), null, 'untagged instanced meshes are never bounded');
farWall.xs = [100, 104, 20]; farWall.count = 3; farWall.instanceMatrix.version++;
const moved = WallBuilder.instanceWorldSphere(farWall, new Sphere());
assert(moved.center.x - moved.radius <= 19.5, 'bounds follow an instance-matrix update');
farWall.xs = [100, 104]; farWall.count = 2; farWall.instanceMatrix.version++;
const shifted = WallBuilder.instanceWorldSphere(instancedMesh([0], { worldX: 50 }), out);
assert.equal(shifted, null, 'an untracked mesh stays unbounded even with a world offset');
const offsetWall = instancedMesh([0], { worldX: 50 }); wallApi.trackInstanceMesh(offsetWall);
assert.equal(WallBuilder.instanceWorldSphere(offsetWall, new Sphere()).center.x, 50, 'sphere is in world space');
let visited = 0; WallBuilder.forEachInstanceMesh(() => visited++);
assert.equal(visited, 5, 'tracked meshes are enumerable without a scene traversal');

// The raycast early-out still uses the same sphere.
const ray = hit => ({ ray: { intersectsSphere: () => hit } });
wallApi.boundedInstancedRaycast.call(nearWall, ray(false), []);
assert.equal(baseRaycasts, 0, 'rays that miss the wall sphere skip the per-instance test');
wallApi.boundedInstancedRaycast.call(nearWall, ray(true), []);
assert.equal(baseRaycasts, 1, 'rays that touch the sphere still raycast every instance');

// ── InstancedWallViewCull: camera pass ─────────────────────────────────────
const win = { THREE, WallBuilder };
new Function('window', cullSource)(win);
const viewCull = win.InstancedWallViewCull;
assert(viewCull && viewCull.enabled, 'wall view cull ships enabled');
const camera = { isCamera: true, projectionMatrix: { minX: -10, maxX: 30 }, matrixWorldInverse: {}, updateMatrixWorld() { this.updated = true; } };
const restore = viewCull.suspendForRender(scene, camera);
assert(camera.updated, 'the current camera transform is resolved before testing');
assert.equal(nearWall.visible, true, 'walls in view keep drawing');
assert.equal(farWall.visible, false, 'walls fully outside the view are not submitted');
assert.equal(preHidden.visible, false, 'a wall hidden by gameplay stays hidden');
assert.equal(elsewhere.visible, true, 'walls of another scene are untouched');
assert.equal(viewCull.snapshot().hidden, 1);
assert.equal(viewCull.snapshot().hiddenInstances, 2);
restore();
assert.equal(farWall.visible, true, 'restore returns every wall');
assert.equal(preHidden.visible, false, 'restore never reveals a wall it did not hide');
viewCull.suspendForRender(scene, camera); // Never restored by the caller...
viewCull.suspendForRender(scene, { ...camera, projectionMatrix: { minX: 90, maxX: 110 } });
assert.equal(farWall.visible, true, '...the next call first undoes a missed restore');
assert.equal(nearWall.visible, false);
viewCull.setEnabled(false);
assert.equal(nearWall.visible, true, 'disabling restores immediately');
assert.equal(viewCull.suspendForRender(scene, camera), null, 'disabled cull hides nothing');
viewCull.setEnabled(true);
assert.match(game, /const restoreWallVisuals = window\.InstancedWallViewCull\?\.suspendForRender\?\.\(activeScene, camera\);/);
assert.match(game, /finally \{[\s\S]{0,400}restoreWallVisuals\?\.\(\);/, 'world render restores walls in finally');
assert.match(index, /js\/instanced-wall-view-cull\.js\?v=[A-Za-z0-9_-]+/, 'module is loaded by the game page');

// ── Held/shell replay cull ──────────────────────────────────────────────────
const hBegin = heldSource.indexOf('  function isReplayCullable(object) {');
const hEnd = heldSource.indexOf('  function cullReplayGroup(', hBegin);
assert(hBegin > 0 && hEnd > hBegin, 'replay cull block is present');
const replayCullFrustum = new Frustum().setFromProjectionMatrix({ minX: -1, maxX: 1 }); // The 3% scissor sub-frustum.
const replay = new Function('THREE', 'window', 'replayCullFrustum', `
  let lastReplayCulledCount = 0, lastReplayKeptCount = 0, lastReplayInstancedCulled = 0, lastReplayInstancedKept = 0, lastReplayInertCount = 0;
  ${heldSource.slice(hBegin, hEnd)}
  return { collectReplayCulled, replayFrustumIntersects, stats: () => ({ lastReplayInstancedCulled, lastReplayInstancedKept, lastReplayInertCount }) };
`)(THREE, win, replayCullFrustum);
const plain = (x, extra = {}) => ({ isMesh: true, visible: true, children: [], userData: {}, layers: { mask: 1 }, geometry: {}, testSphere: new Sphere(new Vector3(x, 0, 0), 1), ...extra });
const skyShell = plain(0, { frustumCulled: false, userData: { hobunjiDepthReplayInert: true }, material: { depthWrite: false } });
const cloudMask = plain(0, { frustumCulled: false, userData: { hobunjiDepthReplayInert: true }, material: { depthWrite: true } });
const cutoutShell = plain(0, { frustumCulled: false, userData: { hobunjiDepthReplayInert: true }, material: { depthWrite: false, alphaTest: 0.5 } });
const layeredShell = plain(0, { frustumCulled: false, userData: { hobunjiDepthReplayInert: true }, material: { depthWrite: false }, layers: { mask: 3 } });
const heldHand = plain(50);
const rock = plain(60), nearRock = plain(0);
const nodes = [nearWall, farWall, untagged, skyShell, cloudMask, cutoutShell, layeredShell, heldHand, rock, nearRock];
const replayScene = { traverseVisible(fn) { for (const node of nodes) if (node.visible) fn(node); } };
const candidates = [];
const culled = new Set(replay.collectReplayCulled(replayScene, new Set([heldHand]), candidates));
assert(culled.has(farWall), 'bricks wholly outside the scissor leave the depth replay');
assert(!culled.has(nearWall), 'bricks that can cover the held part stay');
assert(!culled.has(untagged), 'instanced meshes without instance bounds are never culled');
assert(culled.has(skyShell), 'a depthWrite:false sky shell cannot affect a colorless depth replay');
assert(!culled.has(cloudMask), 'the cloud depth mask keeps writing depth');
assert(!culled.has(cutoutShell), 'alpha-tested shells are forced to write depth by the replay and must stay');
assert(!culled.has(layeredShell), 'a shell on any other layer may be drawn in color by a masked replay pass');
assert(!culled.has(heldHand), 'replay participants are kept');
assert(culled.has(rock) && !culled.has(nearRock), 'ordinary mesh culling is unchanged');
assert(candidates.includes(nearWall), 'kept walls are offered to the tighter per-group cull');
assert.deepEqual(replay.stats(), { lastReplayInstancedCulled: 1, lastReplayInstancedKept: 1, lastReplayInertCount: 1 });
assert.equal(replay.replayFrustumIntersects(farWall), false, 'per-group cull uses the instance sphere too');
assert.match(heldSource, /if \(replayFrustumIntersects\(object\)\) continue;/, 'cullReplayGroup shares the instance-aware test');
assert.match(sky, /skyMesh\.userData\.hobunjiDepthReplayInert = true/);
assert.match(sky, /mesh\.userData\.hobunjiDepthReplayInert = true/);
assert.doesNotMatch(sky, /depthMesh\.userData\.hobunjiDepthReplayInert/, 'cloud depth masks stay in the replay');

console.log('instanced wall render cull: ok');
