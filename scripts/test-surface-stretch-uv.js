const fs = require('fs');
const path = require('path');
const vm = require('vm');

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  clone() { return new Vector3(this.x, this.y, this.z); }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  crossVectors(a, b) { this.x = a.y * b.z - a.z * b.y; this.y = a.z * b.x - a.x * b.z; this.z = a.x * b.y - a.y * b.x; return this; }
  lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  length() { return Math.sqrt(this.lengthSq()); }
  multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  normalize() { const length = this.length(); if (length > 1e-12) this.multiplyScalar(1 / length); return this; }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
}

class BufferAttribute {
  constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; this.count = array.length / itemSize; this.needsUpdate = false; }
  getX(i) { return this.array[i * this.itemSize]; }
  getY(i) { return this.array[i * this.itemSize + 1]; }
  getZ(i) { return this.array[i * this.itemSize + 2]; }
  setXY(i, x, y) { this.array[i * 2] = x; this.array[i * 2 + 1] = y; }
  clone() { return new BufferAttribute(this.array.slice(), this.itemSize); }
}

class Geometry {
  constructor(position, groups = []) {
    this.attributes = { position: new BufferAttribute(new Float32Array(position), 3) }; // Used as the source triangle buffer in each regression case.
    this.groups = groups.map(group => ({ ...group })); // Used by the material-slot preservation regression.
    this.index = null;
    this.userData = {};
    this.boundingBox = null;
  }
  getAttribute(name) { return this.attributes[name]; }
  setAttribute(name, attribute) { this.attributes[name] = attribute; return this; }
  clone() {
    const geometry = new Geometry([]); // Used to emulate Three.BufferGeometry.clone() without importing Three into Node.
    geometry.attributes = {};
    for (const [name, attribute] of Object.entries(this.attributes)) geometry.attributes[name] = attribute.clone();
    geometry.groups = this.groups.map(group => ({ ...group }));
    geometry.index = null;
    geometry.userData = { ...this.userData };
    return geometry;
  }
  toNonIndexed() { return this.clone(); }
  computeBoundingBox() {
    const position = this.attributes.position; // Used to calculate the bounding box API expected by the mapper.
    const min = { x: Infinity, y: Infinity, z: Infinity };
    const max = { x: -Infinity, y: -Infinity, z: -Infinity };
    for (let i = 0; i < position.count; i++) {
      min.x = Math.min(min.x, position.getX(i)); min.y = Math.min(min.y, position.getY(i)); min.z = Math.min(min.z, position.getZ(i));
      max.x = Math.max(max.x, position.getX(i)); max.y = Math.max(max.y, position.getY(i)); max.z = Math.max(max.z, position.getZ(i));
    }
    this.boundingBox = { min, max };
  }
}

const logs = []; // Used to verify the mapper can route diagnostics through the game's mobile-visible debug sink.
const windowMock = {
  THREE: { Vector3, BufferAttribute, MathUtils: { degToRad: degrees => degrees * Math.PI / 180 } },
  __farmLog: (message, level, category) => logs.push([message, level, category]),
};
windowMock.window = windowMock;

const sourcePath = path.join(__dirname, '..', 'docs', 'js', 'surface-stretch-uv.js'); // Used to test the exact production module checked into the repo.
vm.runInNewContext(fs.readFileSync(sourcePath, 'utf8'), {
  window: windowMock, console, Float32Array, Float64Array, Int32Array, Map, Set, WeakSet, Math, Number, Array, Object, String, Infinity,
});

function fanPolygon(points) {
  const centerX = points.reduce((sum, point) => sum + point[0], 0) / points.length; // Used as the fan triangulation center for the irregular flat-surface test.
  const centerZ = points.reduce((sum, point) => sum + point[1], 0) / points.length; // Used as the fan triangulation center for the irregular flat-surface test.
  const positions = []; // Used to create a non-indexed concave-ish Texas-like surface outline.
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    positions.push(a[0], 0, a[1], b[0], 0, b[1], centerX, 0, centerZ);
  }
  return new Geometry(positions);
}

const mapper = windowMock.HobunjiSurfaceStretchUV; // Used by all three regression cases below.
if (!mapper?.installed) throw new Error('surface-stretch mapper did not install');

const texasLike = fanPolygon([[0, 0], [4, 0], [5, 1], [4, 2], [4.5, 4], [2.5, 3.2], [1, 4], [0.5, 2.2], [-0.5, 1.5]]); // Used to prove one square PNG can fill an irregular connected planar outline.
const texasMapped = mapper.mapGeometry(texasLike, { angleToleranceDeg: 18 });
const texasReport = texasMapped.userData.hobunjiSurfaceStretch; // Used to assert the irregular polygon remains one planar island with no fallback.
if (texasReport.patchCount !== 1 || texasReport.fallbackCount !== 0) throw new Error(`Texas-like unwrap failed: ${JSON.stringify(texasReport)}`);
const texasUv = texasMapped.getAttribute('uv'); // Used to prove real perimeter vertices are pinned to all four square texture corners.
const corners = new Set();
for (let i = 0; i < texasUv.count; i++) {
  const u = texasUv.getX(i), v = texasUv.getY(i);
  if ((u === 0 || u === 1) && (v === 0 || v === 1)) corners.add(`${u},${v}`);
}
if (corners.size !== 4) throw new Error(`Expected all four square UV corners, got ${Array.from(corners).join(' ')}`);

const bentPositions = [
  0, 0, 0, 1, 0, 0, 1, 0, 1,
  0, 0, 0, 1, 0, 1, 0, 0, 1,
  1, 0, 0, 1, 1, 0, 1, 1, 1,
  1, 0, 0, 1, 1, 1, 1, 0, 1,
]; // Used to prove a 90-degree bend becomes two separate planar texture surfaces.
const bentMapped = mapper.mapGeometry(new Geometry(bentPositions), { angleToleranceDeg: 18 });
const bentReport = bentMapped.userData.hobunjiSurfaceStretch; // Used to assert planar-rotation segmentation rather than one global bounding-box stretch.
if (bentReport.patchCount !== 2 || bentReport.fallbackCount !== 0) throw new Error(`Bent-surface segmentation failed: ${JSON.stringify(bentReport)}`);

const multiPositions = [
  0, 0, 0, 1, 0, 0, 1, 0, 1,
  0, 0, 0, 1, 0, 1, 0, 0, 1,
  0, 0, 1, 1, 0, 1, 1, -1, 1,
  0, 0, 1, 1, -1, 1, 0, -1, 1,
]; // Used to model a shared grass/cliff geometry with distinct material groups.
const multi = new Geometry(multiPositions, [{ start: 0, count: 6, materialIndex: 0 }, { start: 6, count: 6, materialIndex: 1 }]);
const seedUv = new Float32Array((multiPositions.length / 3) * 2); // Used to detect any accidental mutation of material-0 grass UVs.
for (let i = 0; i < seedUv.length; i++) seedUv[i] = 0.123 + i * 0.001;
multi.setAttribute('uv', new BufferAttribute(seedUv, 2));
const multiMapped = mapper.mapGeometry(multi, { materialIndex: 1 });
const multiUv = multiMapped.getAttribute('uv'); // Used to compare preserved grass coordinates against their exact source values.
for (let i = 0; i < 6; i++) {
  if (Math.abs(multiUv.getX(i) - seedUv[i * 2]) > 1e-7 || Math.abs(multiUv.getY(i) - seedUv[i * 2 + 1]) > 1e-7) {
    throw new Error('Material-0 UVs changed while remapping material-1 cliffs');
  }
}
const multiReport = multiMapped.userData.hobunjiSurfaceStretch; // Used to assert only the selected cliff material group was processed.
if (multiReport.materialIndex !== 1 || multiReport.patchCount !== 1) throw new Error(`Material-slot unwrap failed: ${JSON.stringify(multiReport)}`);

if (!logs.some(entry => entry[2] === 'render')) throw new Error('Expected mobile-visible render diagnostics');
console.log(JSON.stringify({ texas: texasReport, bent: bentReport, multi: multiReport, debug: mapper.snapshot() }, null, 2));
