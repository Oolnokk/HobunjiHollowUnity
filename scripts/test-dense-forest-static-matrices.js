#!/usr/bin/env node
'use strict';

// Actual Three r128 Object3D traversal plus the real render-hook and attachment owners.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
let THREE;
try { THREE = require('three'); }
catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
  console.log('SKIPPED static wall matrices: three@0.128.0 unavailable');
  process.exit(0);
}
const window = { THREE };
const context = vm.createContext({ window, globalThis: window, console, performance, WeakRef });
const load = name => vm.runInContext(fs.readFileSync('docs/js/' + name, 'utf8'), context, { filename: name });
load('render-hooks.js');
const render = THREE.WebGLRenderer.prototype.render; // Actual hook dispatcher, not the outline wrapper.
load('outline-render-performance.js');
load('dense-forest-wall-batches.js');
const W = window.DenseForestWallBatches;
const originalWorld = THREE.Object3D.prototype.updateMatrixWorld;
const geometry = new THREE.BoxGeometry(), material = new THREE.MeshBasicMaterial();
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
let onNative = null, drawFailure = false;
const renderer = { __hobunjiR128NativeRender(s) {
  if (s.autoUpdate === true) s.updateMatrixWorld();
  onNative?.();
  if (drawFailure) throw Error('native draw failed');
}};
function draw(s = scene) {
  window.RenderHooks.beginWorldFrame({ renderer, scene:s, camera });
  try { render.call(renderer,s,camera); }
  finally { window.RenderHooks.endWorldFrame(); }
}
function group(s = scene, n = 12, enroll = true) {
  const g = new THREE.Group();
  Object.assign(g.userData,{denseForestWall:true,backgroundScenery:true});
  for(let i=0;i<n;i++) {
    const m = new THREE.InstancedMesh(geometry,material,2);
    m.setMatrixAt(0,new THREE.Matrix4().makeTranslation(i,0,0));
    m.setMatrixAt(1,new THREE.Matrix4().makeTranslation(i,0,1));
    m.instanceMatrix.needsUpdate=true;
    g.add(m);
  }
  s.add(g);
  if(enroll) assert.equal(W.enrollStaticMatrixBranch(g),true);
  return g;
}
assert.equal(W.staticMatrixSnapshot().enabled,false,'experiment off by default');
const wall = Array.from({length:63},()=>group());
let actualLeafCompositions = 0; // Count native matrix arithmetic, not just the optimization's own counters.
for (const root of wall) for (const part of root.children) {
  const compose = part.matrix.compose;
  part.matrix.compose = function (...args) { actualLeafCompositions++; return compose.apply(this,args); };
}
const first = wall[0], leaf = first.children[0];
first.visible=false;
draw();
assert.equal(W.staticMatrixSnapshot().skippedLeaves,0);
W.setStaticMatrixEnabled(true);
draw();
const warm=W.staticMatrixSnapshot();
assert.equal(warm.refreshes,63);
assert.equal(actualLeafCompositions,2*63*12,'disabled and warm draws run native local composition');
actualLeafCompositions=0;
draw();
assert.equal(actualLeafCompositions,0,'steady cached traversal never calls native leaf composition');
const hot=W.staticMatrixSnapshot();
assert.equal(hot.skippedBranches-warm.skippedBranches,63);
assert.equal(hot.skippedLeaves-warm.skippedLeaves,63*12,'one native leaf call avoided per enrolled mesh, including hidden chunks');
assert.equal(hot.refreshes,warm.refreshes,'no child refresh while steady');
assert.equal(first.visible,false);
assert.equal(Object.hasOwn(scene,'updateMatrixWorld'),false,'scene instance restored after draw');
assert.equal(THREE.Object3D.prototype.updateMatrixWorld,originalWorld,'no global matrix override');
assert.equal(W.auditStaticMatrixBranches(scene).violations,0);
leaf.count=1; leaf.instanceMatrix.needsUpdate=true; leaf.visible=false; leaf.layers.enable(1);
first.visible=true;
draw();
assert.equal(W.staticMatrixSnapshot().refreshes,warm.refreshes,'density/material/layer/visibility updates do not invalidate transforms');
// Explicit root updates outside the scene recursion must take native path.
first.updateMatrixWorld(true);
let prev=W.staticMatrixSnapshot();
draw();
assert.equal(W.staticMatrixSnapshot().refreshes,prev.refreshes+1);
// Parent/root motion falls back to native, including hidden descendants.
scene.position.x=5;
draw();
assert.equal(leaf.matrixWorld.elements[12],5);
scene.position.x=0;
first.position.y=3;
draw();
assert.equal(leaf.matrixWorld.elements[13],3);
first.position.y=0; draw(); draw();
assert.equal(leaf.matrixWorld.elements[13],0);
assert.equal(W.auditStaticMatrixBranches(scene).violations,0);
// Owner invalidates before adding a new local-transform writer. Native behavior
// takes over permanently if a leaf is no longer an identity-local static part.
assert.equal(W.invalidateStaticMatrixBranch(leaf),true);
leaf.position.x=2;
draw(); draw();
assert.equal(leaf.matrixWorld.elements[12],2);
const delayed=wall[6].children[0];
assert.equal(W.invalidateStaticMatrixBranch(delayed),true);
draw(); draw(); // The newly introduced writer has not made a nonidentity edit yet.
delayed.position.z=4; draw();
assert.equal(delayed.matrixWorld.elements[14],4,'writer registration retires even when its first edit is identity');
// A nested object addition goes through the real shared topology observer.
const other=wall[1], part=other.children[0], child=new THREE.Object3D();
child.position.z=7; part.add(child); draw(); draw();
assert.equal(child.matrixWorld.elements[14],7);
const removed=wall[2]; scene.remove(removed); scene.add(removed);
removed.children[0].position.y=4; draw();
assert.equal(removed.children[0].matrixWorld.elements[13],4,'reattached branch retains native traversal');
const replaced=wall[3], old=replaced.children[0];
replaced.remove(old); const replacement=new THREE.InstancedMesh(geometry,material,1);
replacement.position.x=8; replaced.add(replacement); draw();
assert.equal(replacement.matrixWorld.elements[12],8,'same child count replacement cannot use cached branch');
const explicit=wall[4], moved=explicit.children[0];
onNative=()=>{ explicit.position.z=9; explicit.updateMatrixWorld(true); };
draw(); onNative=null;
assert.equal(moved.matrixWorld.elements[14],9,'explicit subtree update during draw is not short-circuited');
explicit.position.z=0; draw();
// A missed owner invalidation is detected by explicit audit and retires branch.
const missed=wall[5].children[0]; missed.position.y=6;
assert.equal(W.auditStaticMatrixBranches(scene).violations,1);
draw(); assert.equal(missed.matrixWorld.elements[13],6);
// Disabled mode never skips; reenabling must warm the cache again.
W.setStaticMatrixEnabled(false); prev=W.staticMatrixSnapshot(); draw();
assert.equal(W.staticMatrixSnapshot().skippedLeaves,prev.skippedLeaves);
W.setStaticMatrixEnabled(true); draw(); draw();
// Native render exceptions still restore the scene instance's method.
drawFailure=true; assert.throws(()=>draw(),/native draw failed/); drawFailure=false;
assert.equal(Object.hasOwn(scene,'updateMatrixWorld'),false);
scene.autoUpdate=false; prev=W.staticMatrixSnapshot(); draw(); scene.autoUpdate=true;
assert.equal(W.staticMatrixSnapshot().skippedLeaves,prev.skippedLeaves,'no work when another pass reuses scene matrices');
// Unowned/unknown groups and non-flat roots never enroll.
const unowned=group(scene,1,false); unowned.userData.denseForestWall=false;
assert.equal(W.enrollStaticMatrixBranch(unowned),false);
const nested=group(scene,1,false); nested.children[0].add(new THREE.Group());
assert.equal(W.enrollStaticMatrixBranch(nested),false);
// Actual producer enrollment, not merely the fixture helper.
const border = fs.readFileSync('docs/js/border-terrain.js','utf8');
const begin = border.indexOf('  function forEachDrawnTreeMesh(');
const end = border.indexOf('  function installGeneratorPatch()',begin);
assert.ok(begin>=0 && end>begin);
const build = new Function('THREE','window',
  'const FOREST_CHUNK_WIDTH=10,FOREST_CHUNK_DEPTH=6;'+border.slice(begin,end)+';return instanceDenseShadewoodForest;')(THREE,window);
window.FoliageGenerator = { buildShadewoodMesh() {
  const tree = new THREE.Group(); tree.add(new THREE.Mesh(geometry,material)); return tree;
}};
const builtScene = new THREE.Scene();
const beforeBuild = W.staticMatrixSnapshot().enrolled;
const built = build(builtScene,[{x:1,y:0,z:-2,yaw:0,scale:1,seedA:1,seedB:2},{x:14,y:0,z:-2,yaw:0,scale:1,seedA:3,seedB:4}]);
assert.equal(built.chunks,2);
assert.equal(W.staticMatrixSnapshot().enrolled,beforeBuild+2,'real BorderTerrain builder enrolls its own roots');
draw(builtScene); prev=W.staticMatrixSnapshot(); draw(builtScene);
assert.equal(W.staticMatrixSnapshot().skippedLeaves,prev.skippedLeaves+2);
const movedNative = THREE.Group.prototype.updateMatrixWorld; let laterHooks=0;
THREE.Group.prototype.updateMatrixWorld=function(force){laterHooks++;return movedNative.call(this,force);};
try { draw(builtScene); assert.equal(laterHooks,2,'later native group hook is not bypassed'); }
finally { delete THREE.Group.prototype.updateMatrixWorld; }
console.log('PASS static dense wall matrices: real r128 scene/hook/topology and producer, 756 actual leaf compositions skipped, transform and lifecycle fallback, A/B and failure cleanup');
