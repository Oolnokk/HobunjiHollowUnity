#!/usr/bin/env node
'use strict';

// Executes js/camera-occlusion-chunks.js with a minimal THREE stand-in.
// (Exact hit-distance parity against real three r128 Mesh.raycast was
// checked in the browser on a 47k-triangle mine cavern: 300 rays, 0
// mismatches, ~13x faster.)
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

class Vec { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); } }
class Sphere {
  constructor(center = new Vec(), radius = 0) { this.center = center; this.radius = radius; }
  clone() { return new Sphere(new Vec(this.center.x, this.center.y, this.center.z), this.radius); }
  applyMatrix4(m) { this.center.x += m.tx; this.center.z += m.tz; return this; } // Translation-only stand-in.
}
class Attr {
  constructor(array, size) { this.array = array; this.itemSize = size; this.count = array.length / size; }
  getX(i) { return this.array[i * 3]; } getY(i) { return this.array[i * 3 + 1]; } getZ(i) { return this.array[i * 3 + 2]; }
}
class BufferGeometry {
  constructor() { this.attributes = {}; this.index = null; this.groups = []; }
  setAttribute(name, attr) { this.attributes[name] = attr; }
  computeBoundingBox() {}
  computeBoundingSphere() {
    const p = this.attributes.position; let x = 0, y = 0, z = 0;
    for (let i = 0; i < p.count; i++) { x += p.getX(i); y += p.getY(i); z += p.getZ(i); }
    const c = new Vec(x / p.count, y / p.count, z / p.count); let r = 0;
    for (let i = 0; i < p.count; i++) r = Math.max(r, Math.hypot(p.getX(i) - c.x, p.getY(i) - c.y, p.getZ(i) - c.z));
    this.boundingSphere = new Sphere(c, r);
  }
}
const raycastCalls = [];
class Mesh {
  constructor(geometry, material) { this.geometry = geometry; this.material = material; this.isMesh = true; this.userData = {}; this.matrixWorld = { tx: 0, tz: 0, copy(m) { this.tx = m.tx; this.tz = m.tz; return this; } }; }
  updateWorldMatrix() {}
  raycast() { raycastCalls.push(this); }
}
const THREE = { BufferGeometry, Float32BufferAttribute: Attr, Mesh, DoubleSide: 2, FrontSide: 0 };
const context = { window: {} };
vm.createContext(context);
vm.runInContext(fs.readFileSync('docs/js/camera-occlusion-chunks.js', 'utf8'), context);
const { replaceLargeMeshes, MIN_TRIANGLES, CHUNK_SIZE } = context.window.CameraOcclusionChunks;

// A big flat "cavern" spanning 4 chunks along X, with two material groups.
const soup = [];
const triangles = MIN_TRIANGLES + 400;
for (let t = 0; t < triangles; t++) {
  const x = (t % 4) * CHUNK_SIZE + 1; // Chunk 0..3
  soup.push(x, 0, 1, x + 0.5, 0, 1, x, 0, 1.5);
}
const geometry = new BufferGeometry();
geometry.setAttribute('position', new Attr(soup, 3));
const front = { uuid: 'front', side: 0 }, back = { uuid: 'back', side: 1 };
geometry.groups = [
  { start: 0, count: (triangles - 8) / 2 * 3, materialIndex: 0 },
  { start: (triangles - 8) / 2 * 3, count: (triangles - 8) / 2 * 3, materialIndex: 1 },
]; // The last 8 triangles are in no group: three never raycasts them.
const cavern = new Mesh(geometry, [front, back]);
cavern.matrixWorld.tx = 100; // Proxies inherit the source world transform.
const wall = new Mesh(new BufferGeometry(), front);
wall.geometry.setAttribute('position', new Attr([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));

const list = replaceLargeMeshes(THREE, [wall, cavern]);
assert.strictEqual(list[0], wall, 'Small occluders pass through untouched');
const proxies = list.slice(1);
assert.strictEqual(proxies.length, 8, 'The cavern splits into 4 X chunks x 2 material groups');
assert.ok(proxies.every(p => p.visible === false && p.matrixWorld.tx === 100), 'Proxies are invisible and keep the source world matrix');
assert.ok(proxies.every(p => p.material === front || p.material === back), 'Each proxy carries its group material (face side) instead of a blanket DoubleSide');
const proxiedTriangles = proxies.reduce((sum, p) => sum + p.geometry.attributes.position.count / 3, 0);
assert.strictEqual(proxiedTriangles, triangles - 8, 'Triangles outside every material group are dropped, as three skips them');

// Far-skip: a short ray only reaches the chunk it starts in.
raycastCalls.length = 0;
const raycaster = { far: 2, ray: { origin: new Vec(100 + 1.2, 0, 1.2) } };
for (const proxy of proxies) proxy.raycast(raycaster, []);
assert.ok(raycastCalls.length > 0 && raycastCalls.length <= 2, 'A short ray tests only the nearby chunk(s), not the whole cavern');
raycastCalls.length = 0;
raycaster.far = 1000;
for (const proxy of proxies) proxy.raycast(raycaster, []);
assert.strictEqual(raycastCalls.length, proxies.length, 'A long ray still tests every chunk it could reach');

console.log('Camera occlusion chunk checks passed.');
