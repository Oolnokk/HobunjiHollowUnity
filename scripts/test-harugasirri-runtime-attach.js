'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(repoRoot, 'docs/js/harugasirri-superbackdrop-runtime.js'), 'utf8');
const asset = JSON.parse(fs.readFileSync(path.join(repoRoot, 'docs/assets/terrain/harugasirri-superbackdrop.json'), 'utf8'));

class Vec3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
}
class Color {
  constructor(value = 0xffffff) { this.value = value; }
  setHex(value) { this.value = value; return this; }
  copy(other) { this.value = other?.value; return this; }
}
class Material {
  constructor(opts = {}) {
    this.map = opts.map || null;
    this.color = new Color(opts.color ?? 0xffffff);
    this.side = opts.side;
    this.fog = opts.fog;
    this.depthTest = true;
    this.transparent = false;
    this.opacity = 1;
    this.wireframe = false;
    this.userData = {};
    this.needsUpdate = false;
  }
  clone() {
    const copy = new Material({ map: this.map, color: this.color.value, side: this.side, fog: this.fog });
    copy.depthTest = this.depthTest;
    copy.transparent = this.transparent;
    copy.opacity = this.opacity;
    copy.wireframe = this.wireframe;
    copy.userData = { ...this.userData };
    return copy;
  }
}
class Float32BufferAttribute {
  constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; this.count = array.length / itemSize; }
}
class BufferGeometry {
  constructor() { this.attributes = {}; }
  setAttribute(name, value) { this.attributes[name] = value; return this; }
  getAttribute(name) { return this.attributes[name]; }
  computeVertexNormals() {}
  computeBoundingBox() {}
  computeBoundingSphere() {}
}
class Mesh {
  constructor(geometry, material) {
    this.geometry = geometry;
    this.material = material;
    this.children = [];
    this.parent = null;
    this.userData = {};
    this.name = '';
    this.castShadow = false;
    this.receiveShadow = false;
    this.renderOrder = 0;
    this.frustumCulled = true;
  }
  clone() {
    const copy = new Mesh(this.geometry, this.material);
    copy.userData = { ...this.userData };
    copy.name = this.name;
    copy.castShadow = this.castShadow;
    copy.receiveShadow = this.receiveShadow;
    copy.renderOrder = this.renderOrder;
    copy.frustumCulled = this.frustumCulled;
    return copy;
  }
}
class Group {
  constructor() {
    this.children = [];
    this.parent = null;
    this.userData = {};
    this.name = '';
    this.renderOrder = 0;
    this.scale = new Vec3(1, 1, 1);
    this.position = new Vec3();
    this.rotation = { y: 0 };
  }
  add(object) { if (!this.children.includes(object)) this.children.push(object); object.parent = this; return this; }
  getObjectByName(name) {
    if (this.name === name) return this;
    for (const child of this.children) {
      if (child.name === name) return child;
      const nested = child.getObjectByName?.(name);
      if (nested) return nested;
    }
    return null;
  }
  clone(recursive = true) {
    const copy = new Group();
    copy.userData = { ...this.userData };
    copy.name = this.name;
    copy.renderOrder = this.renderOrder;
    copy.scale.set(this.scale.x, this.scale.y, this.scale.z);
    copy.position.set(this.position.x, this.position.y, this.position.z);
    copy.rotation.y = this.rotation.y;
    if (recursive) for (const child of this.children) copy.add(child.clone(true));
    return copy;
  }
}
class TextureLoader {
  // Deliberately never calls success OR failure. Runtime geometry must not wait.
  load() {}
}

const THREE = {
  Group,
  Mesh,
  BufferGeometry,
  Float32BufferAttribute,
  MeshLambertMaterial: Material,
  TextureLoader,
  DoubleSide: 2,
  FrontSide: 0,
  RepeatWrapping: 1000,
  sRGBEncoding: 3001,
};
const audits = new Map();
const windowObject = {
  THREE,
  addEventListener() {},
  HobunjiCacheAudit: { register(name, reader) { audits.set(name, reader); } },
};
const context = {
  window: windowObject,
  document: { currentScript: { src: 'https://example.test/js/harugasirri-superbackdrop-runtime.js' } },
  location: { href: 'https://example.test/tools/map-editor/index.html', pathname: '/tools/map-editor/index.html' },
  URL,
  console,
  fetch: async () => ({ ok: true, json: async () => asset }),
  Promise,
  Set,
  WeakMap,
  WeakSet,
};
vm.runInNewContext(source, context);

(async () => {
  const runtime = windowObject.HarugasirriSuperBackdrop;
  assert(runtime, 'runtime API should install');
  const scene = new Group();
  const group = await runtime.attach(scene, 'regression_test');
  assert(group, 'attach must resolve a backdrop group even when texture loaders never finish');
  assert.equal(group.parent, scene, 'backdrop group should be parented to the target scene');
  assert.equal(scene.children.includes(group), true, 'target scene should contain the backdrop group');
  assert.equal(group.children.length, 3, 'cliff, snow, and plateau meshes should all exist');
  assert.equal(audits.get('Harugasirri backdrop scenes')?.(), 1, 'cache audit should report one attached scene');
  assert.equal(audits.get('Harugasirri attach attempts')?.(), 1, 'cache audit should report the attach attempt');
  assert.equal(audits.get('Harugasirri backdrop failures')?.(), 0, 'attach should not record a failure');
  const debug = runtime.getDebugState();
  assert.equal(debug.assetStatus, 'ready');
  assert.equal(debug.attachCount, 1);
  assert.equal(debug.attachedSceneCount, 1);
  assert.equal(debug.failureCount, 0);
  assert.equal(debug.transform.width, 264);
  assert.equal(debug.transform.depth, 264);
  assert(Math.abs(debug.transform.height - 119.058828) < 1e-6);
  for (const child of group.children) {
    assert.equal(child.material.userData.textureStatus, 'loading', 'flat fallback should exist while texture IO is unresolved');
    assert.equal(child.material.side, THREE.DoubleSide, 'backdrop should remain visible regardless of authored winding');
  }
  console.log('PASS Harugasirri runtime attach: scene group appears before texture IO resolves and reports cache count 1.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
