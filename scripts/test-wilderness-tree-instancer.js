#!/usr/bin/env node
'use strict';

// Runs js/wilderness-tree-instancer.js (the 'wilderness-tree-instancing'
// render scope) against real Three.js r128 with trees built the way
// FoliageGenerator places them: clones of a shared variant (shared geometry
// and material per part). Checks what is batched, that instance matrices are
// the trees' world matrices, that every exclusion keeps the tree drawing
// itself (fading, transparent, authored-hidden part, draw hook, outline
// layer split, lone mesh), that restore puts the originals back, and that
// scene switches and the A/B switch release the batches.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

let THREE;
try {
  THREE = require('three');
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
  console.log('SKIPPED wilderness tree instancer: three@0.128.0 is unavailable.');
  process.exit(0);
}

const storage = new Map();
const fading = new Set();
let cullables = [];
const tagged = [];
const win = {
  THREE,
  ZoneVegetationCull: { currentCullables: () => cullables },
  ZoneTreeFade: { hasFade: tree => fading.has(tree) },
  InstancedMeshBounds: { tag: mesh => { mesh.userData.hobunjiInstanceBounds = true; tagged.push(mesh); return mesh; } },
};
win.window = win;
vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/js/wilderness-tree-instancer.js'), 'utf8'),
  vm.createContext({ window: win, globalThis: win, console, localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)) } }),
  { filename: 'wilderness-tree-instancer.js' });
const I = win.WildernessTreeInstancer;

// One shared variant: trunk (outlined), vines (outlined), leaf cards (no outline), climb branch.
const trunkGeo = new THREE.CylinderGeometry(0.2, 0.3, 3, 8), vineGeo = new THREE.TorusGeometry(0.3, 0.05, 4, 8), leafGeo = new THREE.PlaneGeometry(1, 1), branchGeo = new THREE.BoxGeometry(1, 0.1, 0.1);
const trunkMat = new THREE.MeshBasicMaterial({ name: 'natural_trunks' }), vineMat = new THREE.MeshBasicMaterial({ name: 'natural_vines' });
const leafMat = new THREE.MeshBasicMaterial({ alphaTest: 0.5, side: THREE.DoubleSide });
const variant = new THREE.Group();
for (const [geo, mat, outlined, name] of [[trunkGeo, trunkMat, true, ''], [vineGeo, vineMat, true, ''], [leafGeo, leafMat, false, ''], [branchGeo, vineMat, true, 'climbBranch']]) {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = name;
  if (outlined) mesh.layers.enable(1); else mesh.userData.noOutline = true;
  variant.add(mesh);
}
const scene = new THREE.Scene();
const chunk = new THREE.Group();
chunk.name = 'WildernessChunk_test_0_0';
scene.add(chunk);
function placeTree(x, z, { climb = true } = {}) {
  const tree = variant.clone(); // Shares geometry and material, like buildTreeInstance.
  tree.position.set(x, 0, z);
  tree.rotation.y = x * 0.37;
  tree.scale.setScalar(1 + z * 0.01);
  tree.userData.cullSphere = { x, z, radius: 3, xzRadius: 2 };
  if (!climb) tree.getObjectByName('climbBranch').visible = false; // Unrolled climb branch: authored-hidden.
  chunk.add(tree);
  return tree;
}
const trees = [placeTree(0, 0), placeTree(2, 1), placeTree(4, 2, { climb: false }), placeTree(6, 3)];
const grass = new THREE.Mesh(leafGeo, leafMat);
grass.userData = { isWildernessGrassChunk: true, cullSphere: { x: 0, z: 0, radius: 1 } };
chunk.add(grass);
cullables = [...trees, grass];
scene.updateMatrixWorld(true);

const holderOf = s => s.children.find(c => c.name === 'wilderness_tree_instances');

// Off by default (a net loss on the user's device); nothing happens until opted in.
assert.equal(I.enabled(), false, 'off by default');
assert.equal(I.suspendForRender(scene, { isZone: true }), null);
assert.equal(I.setEnabled(true), true);
assert.equal(storage.get(I.STORAGE_KEY), undefined, 'a plain toggle (benchmark windows) is not persisted');
const batches = s => holderOf(s).children.filter(m => m.visible);

// Not a zone / disabled / nothing to do: no scope.
assert.equal(I.suspendForRender(scene, { isZone: false }), null);

let restore = I.suspendForRender(scene, { isZone: true });
assert.equal(typeof restore, 'function');
let snap = I.snapshot();
assert.equal(snap.trees, 4);
assert.equal(snap.members, 15, '4 trunks + 4 vines + 4 leaves + 3 rolled climb branches');
assert.equal(snap.batches, 4, 'one InstancedMesh per shared part');
assert.equal(snap.drawsSaved, 11);
const live = batches(scene);
for (const mesh of live) {
  assert.ok(mesh.isInstancedMesh);
  assert.equal(mesh.frustumCulled, false);
  assert.equal(mesh.userData.hobunjiInstanceBounds, true, 'tagged for the instanced view cull and held replay cull');
}
const trunkBatch = live.find(m => m.geometry === trunkGeo);
assert.equal(trunkBatch.material, trunkMat, 'shares the trees\' own material: same shader, same pixels');
assert.equal(trunkBatch.count, 4);
assert.equal(trunkBatch.layers.mask, trees[0].children[0].layers.mask, 'outline layer carried over');
const leafBatch = live.find(m => m.geometry === leafGeo);
assert.equal(leafBatch.userData.noOutline, true);
const m = new THREE.Matrix4();
trees.forEach((tree, i) => {
  trunkBatch.getMatrixAt(i, m);
  m.elements.forEach((v, k) => assert.equal(v, Math.fround(tree.children[0].matrixWorld.elements[k]), 'instance matrix = the tree part\'s world matrix (float32 buffer)'));
  assert.equal(tree.children[0].visible, false, 'original hidden for the frame');
  assert.equal(tree.children[0].userData.hobunjiDrawProxyHidden, true, 'flagged for Perception Mode');
});
assert.equal(live.find(m => m.geometry === branchGeo).count, 3, 'the unrolled (authored-hidden) climb branch is not drawn');
assert.equal(grass.visible, true, 'grass chunks are left to their own system');
assert.equal(holderOf(scene).visible, true);
restore();
for (const tree of trees) for (const part of tree.children) {
  assert.equal(part.visible, part.name !== 'climbBranch' || tree !== trees[2], 'restore: every original back as it was');
  assert.equal(part.userData.hobunjiDrawProxyHidden, undefined);
}
assert.equal(holderOf(scene).visible, false, 'batches never draw outside the world frame');
assert.equal(trunkBatch.raycast(new THREE.Raycaster(), []), undefined, 'batches are not raycast targets (originals are)');

// Unchanged frame: no instance upload.
const uploads = I.snapshot().uploads;
const keyBuilds = I.snapshot().keyBuilds;
I.suspendForRender(scene, { isZone: true })();
assert.equal(I.snapshot().uploads, uploads, 'static trees: matrices uploaded once');
assert.equal(I.snapshot().keyBuilds, keyBuilds, 'still trees reuse grouping keys');

// A fading tree keeps its own transparent clone material: drawn by itself.
fading.add(trees[1]);
restore = I.suspendForRender(scene, { isZone: true });
assert.equal(trees[1].children[0].visible, true);
assert.equal(trunkBatch.count, 3);
assert.equal(I.snapshot().skipped.fading, 1);
restore();
fading.clear();

// Corridor-culled tree (hidden group) is not drawn by the batch either.
trees[3].visible = false;
restore = I.suspendForRender(scene, { isZone: true });
assert.equal(trunkBatch.count, 3);
restore();
trees[3].visible = true;

// Outline budget: a tree whose meshes left the shell layer goes to a separate batch.
for (const part of trees[0].children) part.layers.disable(1);
restore = I.suspendForRender(scene, { isZone: true });
const trunkBatches = batches(scene).filter(b => b.geometry === trunkGeo);
assert.deepEqual(trunkBatches.map(b => b.count).sort(), [3], 'lone non-outlined trunk stays an ordinary mesh');
assert.equal(trees[0].children[0].visible, true);
restore();
for (const part of trees[0].children) if (!part.userData.noOutline) part.layers.enable(1);

// Ineligible parts draw themselves: transparent material, custom draw hook.
const glass = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.5 });
trees[2].children[1].material = glass;
trees[3].children[1].onBeforeRender = () => {};
restore = I.suspendForRender(scene, { isZone: true });
assert.equal(trees[2].children[1].visible, true);
assert.equal(trees[3].children[1].visible, true);
assert.equal(I.snapshot().skipped.transparent, 1);
assert.equal(I.snapshot().skipped['draw-hook'], 1);
restore();
trees[2].children[1].material = vineMat;
delete trees[3].children[1].onBeforeRender;

// Capacity grows with the forest.
const many = [];
for (let i = 0; i < 12; i++) many.push(placeTree(16 + (i % 6), 4 + Math.floor(i / 6)));
cullables = [...trees, ...many, grass];
scene.updateMatrixWorld(true);
restore = I.suspendForRender(scene, { isZone: true });
const spatialTrunks = batches(scene).filter(b => b.geometry === trunkGeo);
assert.deepEqual(spatialTrunks.map(b => b.count).sort((a,b)=>a-b), [4,12], 'distant cells never share a corridor-wide batch');
assert.equal(I.snapshot().cells,2);
for (const batch of spatialTrunks) {
  const xs = [];
  for (let i = 0; i < batch.count; i++) { batch.getMatrixAt(i,m); xs.push(m.elements[12]); }
  assert(Math.max(...xs)-Math.min(...xs)<I.CELL_TILES, 'tight cell-local instance centers');
}
restore();
// Real bounds/camera cull on the production instanced-culling owners.
const realContext = vm.createContext({window:win,globalThis:win,console,WeakRef});
for (const pathName of ['instanced-mesh-bounds.js','instanced-mesh-view-cull.js']) {
  if(pathName==='instanced-mesh-bounds.js') delete win.InstancedMeshBounds;
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../docs/js',pathName),'utf8'),realContext);
}
// Recreate proxies so the actual bounds tracker enrolls them.
I.setEnabled(false); I.setEnabled(true);
restore = I.suspendForRender(scene,{isZone:true});
scene.updateMatrixWorld(true);
const camera = new THREE.OrthographicCamera(-4,4,4,-4,.1,100);
camera.position.set(3,2,20); camera.lookAt(3,2,0); camera.updateMatrixWorld(true);
const undoCull = win.InstancedMeshViewCull.suspendForRender(scene,camera);
assert(undoCull, 'far cell actually culls');
const near = batches(scene).filter(b=>b.geometry===trunkGeo);
assert.equal(near.length,1);
assert.equal(near[0].count,4,'near cell remains in camera pass, far cell excluded');
undoCull(); restore();
// Negative scale and descendant-bearing source meshes fail open.
trees[0].scale.x = -1;
const child = new THREE.Mesh(leafGeo,leafMat); trees[1].children[0].add(child);
scene.updateMatrixWorld(true);
restore=I.suspendForRender(scene,{isZone:true});
assert(trees[0].children[0].visible);
assert(trees[1].children[0].visible,'a source with visible descendants is not hidden');
restore();
trees[0].scale.x=1; trees[1].children[0].remove(child);
// Freshly streamed trees must be positioned correctly before the renderer's first update.
const freshA = placeTree(33, 2), freshB = placeTree(34, 2);
cullables = [freshA,freshB,freshA]; // Duplicate discovery must not duplicate instances.
restore=I.suspendForRender(scene,{isZone:true}); // Deliberately no scene.updateMatrixWorld().
const freshBatch=batches(scene).find(b=>b.geometry===trunkGeo);
assert.equal(freshBatch.count,2);
freshBatch.getMatrixAt(0,m);
assert.equal(m.elements[12],33);
restore();
// Explicit culling / shader / group-order policy stays with the original.
freshA.children[0].frustumCulled=false;
freshA.children[1].material=new THREE.MeshBasicMaterial();
freshA.children[1].material.onBeforeCompile=()=>{};
freshA.renderOrder=4;
restore=I.suspendForRender(scene,{isZone:true});
assert.equal(restore,null,'group order cannot be represented by a scene-level instance');
assert(freshA.children.every(part=>part.visible));
freshA.renderOrder=0;
restore=I.suspendForRender(scene,{isZone:true});
assert(freshA.children[0].visible);
assert(freshA.children[1].visible);
assert.equal(I.snapshot().skipped.uncullable,1);
assert.equal(I.snapshot().skipped['shader-hook'],1);
restore?.();
// Force a failure after at least one batch has already hidden its sources.
I.setEnabled(false); I.setEnabled(true);
cullables=trees;
const OriginalInstance=THREE.InstancedMesh;
let created=0;
THREE.InstancedMesh=class extends OriginalInstance {
  constructor(...args) { if(++created===2) throw Error('injected proxy failure'); super(...args); }
};
assert.throws(()=>I.suspendForRender(scene,{isZone:true}),/injected proxy failure/);
THREE.InstancedMesh=OriginalInstance;
assert.equal(holderOf(scene),undefined);
for (const tree of trees) for (const part of tree.children) {
  assert.equal(part.visible,part.name!=='climbBranch'||tree!==trees[2]);
  assert.equal(part.userData.hobunjiDrawProxyHidden,undefined);
}
// Rebuild after rollback and then retire distant cell buffers.
cullables=[...trees,...many];
I.suspendForRender(scene,{isZone:true})();
// Retired cell buffers are removed after their short reuse window.
cullables=trees; scene.updateMatrixWorld(true);
for(let i=0;i<=I.RETIRE_AFTER_FRAMES+1;i++) I.suspendForRender(scene,{isZone:true})?.();
assert(holderOf(scene).children.every(batch=>batch.count>0),'unloaded cells release their instance buffers');
assert.equal(I.snapshot().retired,0);

// Leaving the scene, or switching it off, releases the batches.
const other = new THREE.Scene();
I.suspendForRender(other, { isZone: true });
assert.equal(holderOf(scene), undefined, 'previous scene\'s holder removed');
assert.equal(I.setEnabled(false, { persist: true }), false);
assert.equal(storage.get(I.STORAGE_KEY), '0', 'an explicit choice is persisted');
assert.equal(I.suspendForRender(scene, { isZone: true }), null);
I.setEnabled(true);

// Wiring: registered as a render scope between the prop batches and the instanced view cull; loads before game.js.
const pipeline = fs.readFileSync(path.join(__dirname, '../docs/js/world-render-pipeline.js'), 'utf8');
assert.match(pipeline, /id: 'wilderness-tree-instancing', owner: 'wilderness-tree-instancer\.js', order: 250,/);
assert.match(fs.readFileSync(path.join(__dirname, '../docs/js/bootstrap/classic-groups/render.js'), 'utf8'), /js\/wilderness-tree-instancer\.js\?v=/);
console.log('wilderness tree instancer: shared-variant batches, exact instance matrices, fading/transparent/hook/outline/lone exclusions, restore, growth, release');
