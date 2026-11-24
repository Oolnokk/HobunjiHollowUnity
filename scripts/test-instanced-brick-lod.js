#!/usr/bin/env node
'use strict';
// Far default-brick InstancedMeshes (WallBuilder walls and path chunks) draw a
// 12-triangle octant hull of the brick for the world render only.
// Runs the real modules against real three r128 objects (no WebGL needed).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
let THREE;
try { THREE = require('three'); }
catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
  console.log('SKIPPED instanced brick LOD: three@0.128.0 is unavailable.');
  process.exit(0);
}
const window = { THREE };
const ctx = vm.createContext({ window, globalThis: window, WeakRef, WeakMap, Map, Set, Float64Array, Int32Array, Math, Number, Object, Array, console });
const load = file => vm.runInContext(fs.readFileSync(path.resolve(__dirname, '..', 'docs/js', file), 'utf8'), ctx, { filename: file });
load('instanced-mesh-bounds.js');
load('instanced-brick-lod.js');
const lod = window.InstancedBrickLod, bounds = window.InstancedMeshBounds;

// The real default brick (Roughbrick1.glb, 70 flat-shaded triangles).
(async () => {
global.THREE = THREE; global.window = global.window || global; global.self = global.self || global;
try { require(require.resolve('three/examples/js/loaders/GLTFLoader.js')); } catch (_) { /* reported below */ }
if (!THREE.GLTFLoader) { console.log('SKIPPED instanced brick LOD: GLTFLoader unavailable.'); return; }
const buf = fs.readFileSync(path.resolve(__dirname, '..', 'docs/assets/models/Roughbrick1.glb'));
const gltf = await new Promise((resolve, reject) => new THREE.GLTFLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', resolve, reject));
let rock = null;
gltf.scene.traverse(o => { if (o.isMesh && !rock) rock = o.geometry; });
const p = rock.attributes.position;
const sourceTris = (rock.index ? rock.index.count : p.count) / 3;
assert.equal(sourceTris, 70, 'fixture is the real 70-triangle brick');
const volume = geo => {
  const pos = geo.attributes.position, ix = geo.index, n = ix ? ix.count : pos.count;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(); let v = 0;
  for (let i = 0; i < n; i += 3) {
    a.fromBufferAttribute(pos, ix ? ix.getX(i) : i); b.fromBufferAttribute(pos, ix ? ix.getX(i + 1) : i + 1); c.fromBufferAttribute(pos, ix ? ix.getX(i + 2) : i + 2);
    v += a.dot(b.clone().cross(c)) / 6;
  }
  return v;
};

const lite = lod.liteFor(rock);
assert.ok(lite, 'a faceted brick gets a far geometry');
assert.strictEqual(lod.liteFor(rock), lite, 'built once per source');
const liteTris = lite.attributes.position.count / 3;
assert.ok(liteTris <= 12 && liteTris >= 10, 'octant hull: at most 12 triangles (' + liteTris + ' vs ' + sourceTris + ')');
rock.computeBoundingBox();
const box = rock.boundingBox, liteBox = lite.boundingBox, center = box.getCenter(new THREE.Vector3());
for (const axis of ['x', 'y', 'z']) {
  assert.ok(Math.abs(liteBox.min[axis] - box.min[axis]) < 1e-5 && Math.abs(liteBox.max[axis] - box.max[axis]) < 1e-5, 'exactly the brick\'s ' + axis + ' extent');
}
const ratio = volume(lite) / volume(rock);
assert.ok(ratio > 0.92 && ratio < 1.12, 'about the brick\'s volume (' + ratio.toFixed(3) + ')');
const lp = lite.attributes.position, ln = lite.attributes.normal;
for (let t = 0; t < lp.count; t += 3) {
  const c = new THREE.Vector3();
  for (let k = 0; k < 3; k++) c.add(new THREE.Vector3(lp.getX(t + k), lp.getY(t + k), lp.getZ(t + k)));
  c.multiplyScalar(1 / 3).sub(center);
  assert.ok(c.dot(new THREE.Vector3(ln.getX(t), ln.getY(t), ln.getZ(t))) > 0, 'every face is wound outward (flat normal points away)');
}
assert.equal(lite.attributes.uv, undefined, 'no uv when the source has none');

// A later tint that adds projected uvs rebuilds the far brick with uvs.
const uvs = new Float32Array(p.count * 2);
for (let i = 0; i < p.count; i++) { uvs[i * 2] = p.getX(i) + 0.5; uvs[i * 2 + 1] = p.getY(i) + 0.5; }
rock.setAttribute('uv', new THREE.BufferAttribute(uvs, 2)); // Like WallBuilder's ensureProjectedUv after a tint.
const liteUv = lod.liteFor(rock);
assert.notStrictEqual(liteUv, lite, 'source attribute change rebuilds');
const lu = liteUv.attributes.uv;
assert.ok(lu && lu.count === liteUv.attributes.position.count, 'uv copied for every far vertex');
const sourceUvs = new Set();
for (let i = 0; i < p.count; i++) sourceUvs.add(uvs[i * 2].toFixed(5) + ',' + uvs[i * 2 + 1].toFixed(5));
for (let i = 0; i < lu.count; i++) assert.ok(sourceUvs.has(lu.getX(i).toFixed(5) + ',' + lu.getY(i).toFixed(5)), 'uv taken from a source vertex at that corner');

// Scope: whole far meshes swap, near/straddling/untagged ones do not.
const scene = new THREE.Scene();
const material = new THREE.MeshBasicMaterial();
function bricks(x, z, tagged = true, n = 4) {
  const mesh = new THREE.InstancedMesh(rock, material, n);
  const m = new THREE.Matrix4();
  for (let i = 0; i < n; i++) mesh.setMatrixAt(i, m.makeTranslation(x + i * 0.3, 0, z));
  mesh.frustumCulled = false;
  if (tagged) mesh.userData.hobunjiBrickLod = true;
  bounds.tag(mesh);
  scene.add(mesh);
  return mesh;
}
const near = bricks(0, -3), far = bricks(0, -40), untaggedFar = bricks(5, -40, false);
const straddle = bricks(0, -3, true, 2); straddle.setMatrixAt(1, new THREE.Matrix4().makeTranslation(0, 0, -60));
const hiddenFar = bricks(-5, -40); hiddenFar.visible = false;
const camera = new THREE.PerspectiveCamera(60, 1.5, 0.1, 200);
camera.position.set(0, 2, 5); camera.lookAt(0, 0, -20);
scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
lod.setDistance(14);
const restore = lod.suspendForRender(scene, camera);
assert.equal(typeof restore, 'function');
assert.strictEqual(far.geometry, liteUv, 'a far tagged mesh draws the octant hull');
assert.strictEqual(near.geometry, rock, 'a near mesh keeps the full brick');
assert.strictEqual(straddle.geometry, rock, 'a mesh reaching near the camera keeps the full brick');
assert.strictEqual(untaggedFar.geometry, rock, 'only meshes WallBuilder tagged as the default brick');
assert.strictEqual(hiddenFar.geometry, rock, 'hidden meshes are not touched');
assert.equal(far.count, 4, 'instance count untouched');
const snap = lod.snapshot();
assert.equal(snap.farMeshes, 1); assert.equal(snap.farInstances, 4);
assert.equal(snap.trianglesAvoided, (sourceTris - liteUv.attributes.position.count / 3) * 4);
restore();
assert.strictEqual(far.geometry, rock, 'restore puts the full brick back');
lod.setDistance(1000);
assert.equal(lod.suspendForRender(scene, camera), null, 'nothing far: nothing swapped');
lod.setDistance(14);
lod.setEnabled(false);
assert.equal(lod.suspendForRender(scene, camera), null, 'A/B switch');
assert.strictEqual(far.geometry, rock);
console.log('ok - instanced brick LOD: far default-brick meshes draw a 12-triangle octant hull, restored after the render');
})().catch(error => { console.error(error); process.exit(1); });
