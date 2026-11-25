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
// Add-time surface passes (natural-surface-stretch-runtime.js wraps Object3D.add) must see a batch already marked as a render proxy.
const batchFlagsAtAdd = [];
const plainAdd = THREE.Object3D.prototype.add;
THREE.Object3D.prototype.add = function spyAdd(...objects) {
  for (const o of objects) if (o?.name === 'zone_prop_render_batch') batchFlagsAtAdd.push(o.userData.hobunjiRenderProxy === true && o.userData.hobunjiZonePropBatch === true);
  return plainAdd.apply(this, objects);
};

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

// Eligibility changes do not necessarily bump geometry attribute versions.
// No settled-frame optimization may draw an obsolete merged copy after such edits.
const reuseBeforePartial = Batches.snapshot().fastReuseFrames;
panel.setDrawRange(0, 3); // One triangle rather than the previous full two-triangle panel.
restore = frame();
assert(tents[0].children.every(m => m.visible), 'partial draw ranges unbatch originals immediately');
assert.strictEqual(Batches.snapshot().fastReuseFrames, reuseBeforePartial,
  'partial draw range invalidates settled fast reuse in the same frame');
restore?.();
panel.setDrawRange(0, Infinity);
clock += 1000;
restore = frame();
assert(tents[0].children.every(m => !m.visible), 'full draw ranges can resume batching');
restore();
const defaultHook = canvas.onBeforeCompile;
canvas.onBeforeCompile = function changedShader() {}; // Existing material ID/geometry versions remain unchanged.
const reuseBeforeShader = Batches.snapshot().fastReuseFrames;
restore = frame();
assert(tents[0].children.every(m => m.visible), 'a new non-bake-safe material hook immediately disables merging');
assert.strictEqual(Batches.snapshot().fastReuseFrames, reuseBeforeShader,
  'custom shader invalidates the settled fast path in the same frame');
restore?.();
canvas.onBeforeCompile = defaultHook;
clock += 1000;
restore = frame();
assert(tents[0].children.every(m => !m.visible), 'removing the hook restores legal batching');
restore();

// Ore rocks (faceted-rocks.js): world-space vertices under an identity transform, the ridge isolation's [m, m] top/side
// material pair, and the x-ray elevation compile hook (which declares itself bake-safe).
const rockMat = new THREE.MeshBasicMaterial({ color: 0x888888 });
rockMat.onBeforeCompile = function elevationLike() {};
rockMat.onBeforeCompile.__hobunjiWorldBakeSafe = true;
const otherRockMat = new THREE.MeshBasicMaterial({ color: 0x444444 });
function oreRock(col, row, { material = [rockMat, rockMat], groups = 'full' } = {}) {
  const geometry = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
  geometry.translate(col + 0.5, 0.5, row + 0.5); // Built in world space, like TerrainGeometry.buildRockTileGeo.
  const count = geometry.attributes.position.count;
  geometry.clearGroups(); // BoxGeometry's six face groups; keep only the ridge split's two.
  geometry.addGroup(0, 12, 0);
  if (groups === 'full') geometry.addGroup(12, count - 12, 1);
  const group = new THREE.Group();
  group.name = 'faceted_ore_rock_group';
  group.userData.facetedOreRock = true;
  const stone = new THREE.Mesh(geometry, material);
  group.add(stone);
  scene.add(group);
  return stone;
}
const cellA = [oreRock(100, 100), oreRock(102, 101)]; // Cell 12,12.
const cellB = [oreRock(130, 100), oreRock(131, 102)]; // Cell 16,12.
const mixed = oreRock(101, 103, { material: [rockMat, otherRockMat] });
const partial = oreRock(103, 103, { groups: 'top-only' });
const rockShaderMat = new THREE.ShaderMaterial({ vertexShader: 'void main(){gl_Position=vec4(0.);}', fragmentShader: 'void main(){gl_FragColor=vec4(1.);}' });
rockShaderMat.onBeforeCompile = rockMat.onBeforeCompile; // A flagged hook cannot vouch for a whole custom program.
const shaderRock = oreRock(104, 100, { material: [rockShaderMat, rockShaderMat] });
const rockBatches = () => holder().children.filter(m => m.visible && m.userData.hobunjiZonePropKind === 'oreRock');
clock += 1000;
frame()?.(); // The owner rescan (RESCAN_MS) finds the new rocks; first sight starts their still period.
clock += 1000;
restore = frame();
let rejects = Batches.snapshot().rejectReasons;
assert.strictEqual(rockBatches().length, 2, 'cells come from the world-space geometry centre, not the shared 0,0 origin');
for (const stone of [...cellA, ...cellB]) assert.strictEqual(stone.visible, false, 'stones batched');
for (const batch of rockBatches()) {
  assert.strictEqual(batch.material, rockMat, 'a repeated material draws once, as itself');
  assert.strictEqual(batch.geometry.index.count, 72, 'both stones, every triangle of every group');
  assert.strictEqual(batch.geometry.groups.length, 0);
  assert.strictEqual(batch.userData.hobunjiRenderProxy, true);
}
assert(mixed.visible && rejects['oreRock:multiMaterial'] >= 1, 'two different materials stay a multi-material mesh');
assert(partial.visible, 'groups that leave triangles undrawn are not merged (the batch would draw them)');
assert(shaderRock.visible && rejects['oreRock:customShader'] >= 1, 'a ShaderMaterial needs its owner\'s userData mark');
restore();
restore = frame(); // Settled frame: the fast path compares the array's one material with the batch's.
assert([...cellA, ...cellB].every(stone => !stone.visible), 'settled stones stay batched');
restore();
cellA[1].material = [rockMat, otherRockMat]; // A recolour that splits the slots: drops out at once.
restore = frame();
assert.strictEqual(cellA[1].visible, true);
assert.strictEqual(cellA[0].visible, true, 'its cell partner is alone now: a lone mesh is left as it is');
restore?.();
cellA[1].material = [rockMat, rockMat];
// Mining removes the rock group: the batch drops it.
cellB[1].parent.parent.remove(cellB[1].parent);
restore = frame();
assert.strictEqual(cellB[0].visible, true, 'the remaining lone stone draws itself');
restore?.();
assert(batchFlagsAtAdd.length >= 3 && batchFlagsAtAdd.every(Boolean), 'every batch is a marked render proxy when it is added');
for (const stone of [...cellA, cellB[0], mixed, partial, shaderRock]) scene.remove(stone.parent);

// Hidden owners draw nothing and leave the batch; disabling restores everything.
tents[2].visible = false;
frame()();
Batches.setEnabled(false);
assert.strictEqual(frame(), null);
Batches.setEnabled(true);

// Actual Three.js integration for separate furniture source materials. Untextured
// transparent= true/opacity=1 is provably opaque without needing a browser.
const furnitureScene = new THREE.Scene();
const furniture = new THREE.Group();
furniture.userData.authoredFurnitureKey = 'campfire';
furnitureScene.add(furniture);
const parts = Array.from({length: 3}, (_, i) => {
  const part = new THREE.Mesh(new THREE.BoxGeometry(.2,.2,.2),
    new THREE.MeshLambertMaterial({ color: 0x887766, transparent: true }));
  part.position.set(i * .3, 0, 0);
  part.userData.authoredPart = { kind: 'box' };
  furniture.add(part);
  return part;
});
function furnitureFrame() {
  furnitureScene.updateMatrixWorld(true);
  const restore = Batches.suspendForRender(furnitureScene, {isZone:true});
  clock += 100;
  return restore;
}
const furnitureHolder = () => furnitureScene.children.find(c => c.userData.hobunjiZonePropBatchHolder);
assert.strictEqual(furnitureFrame(), null);
clock += 1000;
let restoreFurniture = furnitureFrame();
assert(restoreFurniture);
assert(parts.every(m => !m.visible));
const furnitureBatch = furnitureHolder().children[0];
assert.strictEqual(furnitureBatch.material.transparent, false);
assert(parts.every(m => m.material.transparent && m.material !== furnitureBatch.material));
restoreFurniture();
const stableFurniture = Batches.snapshot().fastReuseFrames;
restoreFurniture = furnitureFrame();
assert(Batches.snapshot().fastReuseFrames > stableFurniture);
restoreFurniture();
parts[0].material.opacity = .4;
restoreFurniture = furnitureFrame();
assert(parts[0].visible, 'fading part leaves the batch immediately');
assert(parts.slice(1).every(m => !m.visible), 'unchanged siblings remain batched');
restoreFurniture();
parts[1].geometry.setAttribute('position', parts[1].geometry.attributes.position.clone());
restoreFurniture = furnitureFrame();
assert(parts.every(m => m.visible), 'replacement attribute resets stillness immediately');
restoreFurniture?.();
assert.strictEqual(furnitureHolder().children.length, 0);
assert(parts.every(m => m.material.transparent), 'render-proxy disposal never changes source material');

// Independent dirty groups: the untouched cell must preserve its exact proxy
// and geometry, and a dirty source must never leave a stale merged copy visible.
const isolated = new THREE.Scene();
const isolatedMat = new THREE.MeshLambertMaterial({color:0x778855});
function isolatedGroup(x) {
  const root = new THREE.Group();
  root.userData.projectileCoverKind='tent';
  root.position.x=x;
  for(let i=0;i<3;i++) {
    const part=new THREE.Mesh(new THREE.BoxGeometry(.2,.2,.2),isolatedMat);
    part.position.x=i*.3; root.add(part);
  }
  isolated.add(root); return root;
}
const left=isolatedGroup(1), right=isolatedGroup(24);
const step=()=>{isolated.updateMatrixWorld(true);return Batches.suspendForRender(isolated,{isZone:true});};
assert.strictEqual(step(),null);
const emptyStart=Batches.snapshot();
clock+=100;
assert.strictEqual(step(),null);
assert.equal(Batches.snapshot().fullCollects,emptyStart.fullCollects,'empty unsettled scene does not rescan on every frame');
assert.equal(Batches.snapshot().emptyReuseFrames,emptyStart.emptyReuseFrames+1);
clock+=1000;
step()();
const proxies=isolated.children.find(m=>m.userData.hobunjiZonePropBatchHolder);
const rightProxy=proxies.children.find(m=>m.geometry.boundingSphere.center.x>16);
assert(rightProxy);
const rightGeometry=rightProxy.geometry;
const beforeRepair=Batches.snapshot();
clock+=100;
left.children[0].position.y+=1;
const undo=step();
assert(undo);
assert(left.children[0].visible && left.children.slice(1).every(m=>!m.visible),'only moved source leaves its cell batch');
assert(right.children.every(m=>!m.visible),'unrelated cell stays batched');
assert(proxies.children.includes(rightProxy) && rightProxy.geometry===rightGeometry,'unrelated proxy and buffers are not rebuilt');
assert.equal(Batches.snapshot().fullCollects,beforeRepair.fullCollects,'dirty group did not force full collection');
assert.equal(Batches.snapshot().partialRepairFrames,beforeRepair.partialRepairFrames+1);
assert.equal(Batches.snapshot().repairedGroups,beforeRepair.repairedGroups+1);
undo();
assert([...left.children,...right.children].every(m=>m.visible) && !proxies.visible,'gameplay visibility restored');
clock+=50;
left.children[1].geometry.attributes.position.needsUpdate=true;
step()();
assert.equal(proxies.children.length,1,'a group that shrinks to one member is removed');
assert.strictEqual(proxies.children[0],rightProxy);
clock+=1100;
step()();
assert.equal(proxies.children.length,2,'settled sources rediscovered after the usual interval');
assert(proxies.children.includes(rightProxy),'timed discovery also reuses unaffected geometry');

console.log(`ok zone prop render batches (${JSON.stringify(Batches.snapshot())})`);
