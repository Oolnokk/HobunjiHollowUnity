#!/usr/bin/env node
'use strict';
// Wilderness props are drawn as merged world-space batches during the world render only (js/zone-prop-render-batches.js).
// Runs the real module with real three r128: batching, restore, still/moving rules, eligibility, and that the merged
// vertices/normals/winding match each source mesh's world transform.
//
// Needs `three@0.128.0` (CI installs it; locally: npm install --no-save three@0.128.0, or set THREE_MIN_JS).
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

function loadThreeSource() {
  for (const candidate of [process.env.THREE_MIN_JS, 'three/build/three.min.js'].filter(Boolean)) {
    try { return fs.readFileSync(candidate.startsWith('three/') ? require.resolve(candidate, { paths: [process.cwd(), __dirname] }) : candidate, 'utf8'); } catch (_) { /* try next */ }
  }
  return null;
}
const threeSource = loadThreeSource();
if (!threeSource) {
  console.log('SKIPPED zone prop render batches: three@0.128.0 is not installed (npm install --no-save three@0.128.0).');
  process.exit(0);
}

let clock = 0;
const win = { console, performance: { now: () => clock } };
win.window = win; win.globalThis = win; win.self = win;
vm.createContext(win);
vm.runInContext(threeSource, win, { filename: 'three.min.js' });
vm.runInContext(fs.readFileSync('docs/js/zone-prop-render-batches.js', 'utf8'), win, { filename: 'zone-prop-render-batches.js' });
const THREE = win.THREE, Batches = win.ZonePropRenderBatches;
assert(Batches, 'module installed');

const scene = new THREE.Scene();
const canvas = new THREE.MeshLambertMaterial({ color: 0x886644 });
const panel = new THREE.PlaneGeometry(1, 1);
function tent(x, z, extra = {}) {
  const group = new THREE.Group();
  group.userData.projectileCoverKind = 'bandit-tent';
  group.position.set(x, 0, z);
  for (let i = 0; i < 4; i++) {
    const mesh = new THREE.Mesh(panel, canvas);
    mesh.position.set(i * 0.3, 0.5, 0);
    mesh.rotation.y = i * 0.7;
    group.add(mesh);
  }
  Object.assign(group.userData, extra);
  scene.add(group);
  return group;
}
const tents = [tent(1, 1), tent(3, 2), tent(40, 40)];
const scaled = tent(5, 5); scaled.scale.set(2, 1, -1); // Non-uniform and mirrored.
const glass = tent(2, 6); glass.children.forEach(m => { m.material = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.5 }); });
const rockGeo = panel.clone(); rockGeo.setAttribute('rockSourceFace', new THREE.BufferAttribute(new Float32Array(rockGeo.attributes.position.count), 1));
const rock = tent(30, 30); rock.children.forEach(m => { m.geometry = rockGeo; }); // Built-in material: the extra bookkeeping attribute is dropped, not a blocker.
const rockShader = tent(31, 31); const bakeSafe = new THREE.ShaderMaterial({ vertexShader: 'void main(){gl_Position=vec4(0.);}', fragmentShader: 'void main(){gl_FragColor=vec4(1.);}' }); bakeSafe.userData.hobunjiWorldBakeSafe = true;
rockShader.children.forEach(m => { m.geometry = rockGeo; m.material = bakeSafe; }); // A custom shader might read it: rejected.
const plain = new THREE.Mesh(panel, canvas); plain.position.set(2, 0, 2); scene.add(plain); // No owner tag: never batched.
const shader = tent(6, 1); const shaderMat = new THREE.ShaderMaterial({ vertexShader: 'void main(){gl_Position=vec4(0.);}', fragmentShader: 'void main(){gl_FragColor=vec4(1.);}' });
shader.children.forEach(m => { m.material = shaderMat; });

const frame = () => { scene.updateMatrixWorld(); const restore = Batches.suspendForRender(scene, { isZone: true }); clock += 100; return restore; };
const holder = () => scene.children.find(c => c.userData.hobunjiZonePropBatchHolder);

assert.strictEqual(Batches.suspendForRender(scene, { isZone: false }), null, 'only wilderness zones are batched');
assert.strictEqual(frame(), null, 'fresh spawns wait out the still period before batching');
clock += 1000;
let restore = frame();
assert(restore, 'still props batch');
const snap = Batches.snapshot();
assert.strictEqual(snap.batches, 3, 'one batch per 8x8 cell + material: tents 1, 2 and the scaled tent share cell 0,0; the far tent and the rock tent have their own');
assert(rock.children.every(m => !m.visible), 'extra attributes do not block a built-in material');
assert(snap.rejectReasons['tent:attribute:rockSourceFace'] >= 4 && rockShader.children.every(m => m.visible), 'but do block a custom shader');
assert(snap.rejectReasons['tent:transparent'] >= 4 && snap.rejectReasons['tent:customShader'] >= 4, 'transparent and unmarked shader materials are left alone (rejections are reported per prop kind)');
for (const t of [tents[0], tents[1], tents[2], scaled]) for (const m of t.children) assert.strictEqual(m.visible, false, 'batched sources are hidden for the render');
for (const m of glass.children) assert.strictEqual(m.visible, true);
assert.strictEqual(plain.visible, true);
assert.strictEqual(holder().visible, true);
const batchMeshes = holder().children.filter(m => m.visible);
assert(batchMeshes.every(m => m.userData.hobunjiZonePropBatch && m.userData.hobunjiZonePropKind === 'tent' && m.material === canvas));

// Merged geometry equals each member's world-space triangles, including the mirrored, non-uniformly scaled tent.
const worldTriangles = meshes => {
  const out = [];
  for (const m of meshes) {
    const g = m.geometry, p = g.attributes.position, idx = g.index, normalMatrix = new THREE.Matrix3().getNormalMatrix(m.matrixWorld);
    for (let i = 0; i < idx.count; i += 3) {
      const v = [0, 1, 2].map(k => new THREE.Vector3().fromBufferAttribute(p, idx.getX(i + k)).applyMatrix4(m.matrixWorld));
      const face = new THREE.Vector3().subVectors(v[1], v[0]).cross(new THREE.Vector3().subVectors(v[2], v[0])).normalize();
      if (m.matrixWorld.determinant() < 0) face.negate(); // Three draws a mirrored mesh with clockwise front faces; the batch (identity matrix) must show that same side.
      const n = new THREE.Vector3().fromBufferAttribute(g.attributes.normal, idx.getX(i)).applyMatrix3(normalMatrix).normalize();
      out.push({ v, face, n });
    }
  }
  return out;
};
const sameCell = batchMeshes.find(m => m.geometry.index.count === (3 * 4 * 2) * 3);
assert(sameCell, 'tents 1, 2 and the scaled tent share one batch (12 panels)');
const expected = worldTriangles([...tents[0].children, ...tents[1].children, ...scaled.children]);
const merged = worldTriangles([sameCell]);
for (const e of expected) {
  const match = merged.find(m => m.v.every(p => e.v.some(q => q.distanceTo(p) < 1e-5)));
  assert(match, 'every source triangle is in the batch');
  assert(match.face.dot(e.face) > 0.999, 'winding (front face) is preserved, mirrored members included');
  assert(match.n.distanceTo(e.n) < 1e-4, 'normals follow the inverse-transpose world transform');
}

restore();
for (const t of tents) for (const m of t.children) assert.strictEqual(m.visible, true, 'restore shows the props again');
assert.strictEqual(holder().visible, false);

// A prop that moves leaves its batch until it has been still for the still period, then rejoins.
const rebuildsBefore = Batches.snapshot().rebuilds;
const fullCollectsBefore = Batches.snapshot().fullCollects;
frame()();
assert.strictEqual(Batches.snapshot().rebuilds, rebuildsBefore, 'unchanged batches are not rebuilt');
assert.strictEqual(Batches.snapshot().fullCollects, fullCollectsBefore, 'settled props do not repeat owner traversal/group construction');
assert(Batches.snapshot().fastReuseFrames >= 1, 'diagnostics count the zero-regrouping fast path');
tents[1].position.x += 0.5;
frame()();
assert(Batches.snapshot().moving >= 4, 'moved panels are drawn normally');
tents[1].children.forEach(m => assert.strictEqual(m.visible, true));
restore = frame();
assert(tents[1].children.every(m => m.visible), 'still moving within the still period');
restore();
clock += 1000;
restore = frame();
assert(tents[1].children.every(m => !m.visible), 'rejoins after holding still');
restore();

// Hidden owners draw nothing and leave the batch; disabling restores everything.
tents[2].visible = false;
frame()();
Batches.setEnabled(false);
assert.strictEqual(frame(), null);
Batches.setEnabled(true);

console.log(`ok zone prop render batches (${JSON.stringify(Batches.snapshot())})`);
