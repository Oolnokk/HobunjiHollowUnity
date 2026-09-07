'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(repoRoot, 'docs/js/harugasirri-cull-range.js'), 'utf8');
const captureSource = fs.readFileSync(path.join(repoRoot, 'docs/js/harugasirri-map-editor-capture-fix.js'), 'utf8');
const runtimeSource = fs.readFileSync(path.join(repoRoot, 'docs/js/harugasirri-superbackdrop-runtime.js'), 'utf8');

assert.equal(source.includes('requestAnimationFrame('), false, 'Harugasirri render-order/cull guard must not add frame-loop work');
assert.equal(source.includes('setInterval('), false, 'Harugasirri render-order/cull guard must not poll');
assert(source.includes('rendererPrototype.render'), 'camera range should use the shared renderer boundary, not Scene.onBeforeRender');
assert(source.includes('__hobunjiRendererInstances'),
  'camera range should prefer the actual registered r128 renderer instance when available');
assert.equal(source.includes('restoreRenderHook'), false,
  'camera range must remain guarded after the first render because renderer/camera decorators can later restore the stock far plane');
assert(runtimeSource.includes('child.frustumCulled = false;'),
  'normal visual refreshes must preserve the explicit Harugasirri culling bypass');
assert.equal(source.includes('scene.onBeforeRender'), false, 'Scene.onBeforeRender is not a reliable scene-level camera hook');
assert(source.includes('belongsToRenderScene'), 'range logic must support Harugasirri under an intermediate outdoor root Group');
assert(source.includes('Object3D?.prototype'), 'ordinary Object3D/Group additions should be a fallback registration path');
assert(captureSource.includes('const OriginalScene = THREE.Scene;'), 'Map Editor should capture the real preview Scene constructor');
assert(captureSource.includes('const OriginalPerspectiveCamera = THREE.PerspectiveCamera;'), 'Map Editor should capture the real preview camera constructor');
assert.equal(captureSource.includes('requestAnimationFrame('), false, 'Map Editor direct capture must not add another render loop');
assert.equal(captureSource.includes('setInterval('), false, 'Map Editor direct capture must not poll');

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  distanceTo(other) { return Math.hypot(this.x - other.x, this.y - other.y, this.z - other.z); }
}
class Sphere {
  constructor() { this.center = new Vector3(); this.radius = 0; }
}
class Box3 {
  setFromObject(object) { Box3.reads++; this.object = object; return this; }
  isEmpty() { return false; }
  getBoundingSphere(target) {
    // Deliberately require a far plane much larger than the 805u live probe hit.
    target.center = new Vector3(0, 50, 0);
    target.radius = 900;
    return target;
  }
}
Box3.reads = 0;
class Object3D {
  constructor() { this.children = []; this.parent = null; }
  add(...objects) {
    for (const object of objects) { object.parent = this; this.children.push(object); }
    return this;
  }
  traverse(fn) {
    fn(this);
    for (const child of this.children) {
      if (typeof child.traverse === 'function') child.traverse(fn);
      else fn(child);
    }
  }
  getObjectByName(name) {
    let found = null;
    this.traverse(object => { if (!found && object?.name === name) found = object; });
    return found;
  }
}
class Scene extends Object3D {
  constructor() { super(); this.isScene = true; }
}
class WebGLRenderer {
  render(scene, camera) {
    this.renderCalls = (this.renderCalls || 0) + 1;
    this.lastScene = scene;
    this.lastCamera = camera;
    return 'rendered';
  }
}

const THREE = { Object3D, Scene, Box3, Sphere, WebGLRenderer };
const listeners = new Map();
const audits = new Map();
const renderer = new THREE.WebGLRenderer();
const baseInstanceRender = renderer.render;
const windowObj = {
  THREE,
  __hobunjiRendererInstances: new Set([renderer]),
  addEventListener(name, fn) { listeners.set(name, fn); },
  HobunjiCacheAudit: { register(name, fn) { audits.set(name, fn); } },
};
const baseRender = THREE.WebGLRenderer.prototype.render;
vm.runInNewContext(source, { window: windowObj, console, Object, Math, Number, Set, WeakMap });
assert(windowObj.HarugasirriCullRange, 'render-order/cull API should install');

const meshes = [
  { isMesh: true, frustumCulled: true, userData: { harugasirriSuperBackdrop: true } },
  { isMesh: true, frustumCulled: true, userData: { harugasirriSuperBackdrop: true } },
  { isMesh: true, frustumCulled: true, userData: { harugasirriSuperBackdrop: true } },
];
const group = {
  name: 'HarugasirriSuperBackdrop',
  renderOrder: -20,
  userData: { harugasirriSuperBackdrop: true },
  children: meshes,
  parent: null,
  traverse(fn) { fn(this); for (const mesh of meshes) fn(mesh); },
  updateMatrixWorld() {},
};

// Reproduce the live failure shape: Harugasirri's immediate parent is an
// intermediate outdoor root Group, not necessarily the Scene itself.
const scene = new THREE.Scene();
const outdoorRoot = new THREE.Object3D();
scene.add(outdoorRoot);
outdoorRoot.add(group);
windowObj.HarugasirriCullRange.armScene(group);

assert.equal(group.renderOrder, 1,
  'Harugasirri parent group must sort after the sky group instead of inheriting the old -20 opaque group order');
assert(meshes.every(mesh => mesh.frustumCulled === false),
  'all three low-poly Harugasirri meshes should bypass ordinary frustum culling');
assert.equal(group.userData.harugasirriOpaqueGroupOrder, 1);
assert.equal(THREE.WebGLRenderer.prototype.render, baseRender,
  'the prototype should remain untouched when the actual r128 renderer instance is registered');
assert.notEqual(renderer.render, baseInstanceRender,
  'direct registration should arm the actual renderer instance before the next real render');
assert.equal(audits.get('Harugasirri range direct registrations')(), 1,
  'the live attach handoff must be visible in performance snapshots');

const camera = {
  isPerspectiveCamera: true,
  far: 200,
  position: new Vector3(10, 8, 10),
  updates: 0,
  updateProjectionMatrix() { this.updates++; },
};
const result = renderer.render(scene, camera);
assert.equal(result, 'rendered');
assert(camera.far > 900, 'camera far must expand from actual Harugasirri world bounds, not stop at the 512 minimum');
assert.equal(camera.updates, 1, 'camera projection should update exactly once when its far plane is raised');
assert.notEqual(renderer.render, baseInstanceRender,
  'camera-range renderer instance guard must remain installed after the first matching render');
assert.equal(renderer.renderCalls, 1, 'the wrapped render must still call the prior renderer exactly once');
assert.equal(audits.get('Harugasirri frustum bypass meshes')(), 3);
assert.equal(audits.get('Harugasirri opaque group order')(), 1);
assert(audits.get('Harugasirri camera far')() > 900);
assert(audits.get('Harugasirri required camera far')() > 900);
assert.equal(audits.get('Harugasirri camera range hook hits')(), 1);

// A later system or map transition may restore the gameplay camera's stock
// range. The next real render must repair it before Three.js clips geometry.
camera.far = 200;
renderer.render(scene, camera);
assert(camera.far > 900, 'a later camera-range reset must be repaired on the next render');
assert.equal(camera.updates, 2, 'the projection should update again after an external far-plane reset');
assert.equal(audits.get('Harugasirri camera range hook hits')(), 2);

const boundsReadsAfterRepair = Box3.reads;
renderer.render(scene, camera);
assert.equal(Box3.reads, boundsReadsAfterRepair,
  'stable frames should use the cached camera requirement instead of traversing backdrop bounds');
assert.equal(camera.updates, 2, 'stable frames must not rewrite the projection matrix');

console.log('PASS Harugasirri render order/cull range: direct registration works through an intermediate outdoor root, meshes stay outside ordinary culling, and the persistent renderer guard repairs camera range before clipping.');
