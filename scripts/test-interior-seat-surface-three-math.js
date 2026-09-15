'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const adapterSource = fs.readFileSync('docs/js/seat-surface-placement-transform.js', 'utf8'); // Used to execute the production adapter instead of duplicating its seat-transform logic.
const templeMap = JSON.parse(fs.readFileSync('docs/config/maps/map_i_temple.json', 'utf8')); // Used to exercise a real saved post-transformed bench from the interior editor.
const benchData = JSON.parse(fs.readFileSync('docs/config/furniture-authored/bench.json', 'utf8')); // Used as the real authored two-seat surface transformed by the temple placement.

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

class Euler {
  constructor(x = 0, y = 0, z = 0, order = 'XYZ') {
    this.x = x; this.y = y; this.z = z; this.order = order;
  }

  setFromQuaternion(quaternion, order = 'XYZ') {
    assert.strictEqual(order, 'XYZ', 'test harness only needs the game\'s XYZ Euler order');
    const x = quaternion.x, y = quaternion.y, z = quaternion.z, w = quaternion.w; // Used to reconstruct the rotation matrix consumed by Three.js's XYZ Euler extraction.
    const xx = x * x, yy = y * y, zz = z * z; // Used by the matrix diagonal terms below.
    const xy = x * y, xz = x * z, yz = y * z; // Used by the matrix off-diagonal terms below.
    const wx = w * x, wy = w * y, wz = w * z; // Used by the matrix off-diagonal terms below.
    const m11 = 1 - 2 * (yy + zz); // Used by XYZ yaw/roll extraction.
    const m12 = 2 * (xy - wz); // Used by XYZ roll extraction.
    const m13 = 2 * (xz + wy); // Used by XYZ pitch-lock detection and yaw extraction.
    const m22 = 1 - 2 * (xx + zz); // Used by the gimbal-lock fallback below.
    const m23 = 2 * (yz - wx); // Used by XYZ pitch extraction.
    const m32 = 2 * (yz + wx); // Used by the gimbal-lock fallback below.
    const m33 = 1 - 2 * (xx + yy); // Used by XYZ pitch extraction.
    this.y = Math.asin(clamp(m13, -1, 1));
    if (Math.abs(m13) < 0.9999999) {
      this.x = Math.atan2(-m23, m33);
      this.z = Math.atan2(-m12, m11);
    } else {
      this.x = Math.atan2(m32, m22);
      this.z = 0;
    }
    this.order = order;
    return this;
  }
}

class Quaternion {
  constructor(x = 0, y = 0, z = 0, w = 1) {
    this.x = x; this.y = y; this.z = z; this.w = w;
  }

  setFromEuler(euler) {
    assert.strictEqual(euler.order, 'XYZ', 'test harness only needs the game\'s XYZ Euler order');
    const c1 = Math.cos(euler.x / 2), c2 = Math.cos(euler.y / 2), c3 = Math.cos(euler.z / 2); // Used by the standard XYZ Euler-to-quaternion conversion.
    const s1 = Math.sin(euler.x / 2), s2 = Math.sin(euler.y / 2), s3 = Math.sin(euler.z / 2); // Used by the standard XYZ Euler-to-quaternion conversion.
    this.x = s1 * c2 * c3 + c1 * s2 * s3;
    this.y = c1 * s2 * c3 - s1 * c2 * s3;
    this.z = c1 * c2 * s3 + s1 * s2 * c3;
    this.w = c1 * c2 * c3 - s1 * s2 * s3;
    return this;
  }

  setFromRotationMatrix(matrix) {
    const te = matrix.elements; // Used to read the column-major basis matrix exactly as Three.js does.
    const m11 = te[0], m12 = te[4], m13 = te[8]; // Used by the quaternion conversion branches below.
    const m21 = te[1], m22 = te[5], m23 = te[9]; // Used by the quaternion conversion branches below.
    const m31 = te[2], m32 = te[6], m33 = te[10]; // Used by the quaternion conversion branches below.
    const trace = m11 + m22 + m33; // Used to select the numerically stable quaternion conversion branch.
    if (trace > 0) {
      const s = 0.5 / Math.sqrt(trace + 1); // Used as the common scale for the positive-trace branch.
      this.w = 0.25 / s;
      this.x = (m32 - m23) * s;
      this.y = (m13 - m31) * s;
      this.z = (m21 - m12) * s;
    } else if (m11 > m22 && m11 > m33) {
      const s = 2 * Math.sqrt(1 + m11 - m22 - m33); // Used as the common scale when X is the dominant diagonal.
      this.w = (m32 - m23) / s;
      this.x = 0.25 * s;
      this.y = (m12 + m21) / s;
      this.z = (m13 + m31) / s;
    } else if (m22 > m33) {
      const s = 2 * Math.sqrt(1 + m22 - m11 - m33); // Used as the common scale when Y is the dominant diagonal.
      this.w = (m13 - m31) / s;
      this.x = (m12 + m21) / s;
      this.y = 0.25 * s;
      this.z = (m23 + m32) / s;
    } else {
      const s = 2 * Math.sqrt(1 + m33 - m11 - m22); // Used as the common scale when Z is the dominant diagonal.
      this.w = (m21 - m12) / s;
      this.x = (m13 + m31) / s;
      this.y = (m23 + m32) / s;
      this.z = 0.25 * s;
    }
    return this;
  }
}

class Vector3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x; this.y = y; this.z = z;
  }

  applyEuler(euler) {
    const quaternion = new Quaternion().setFromEuler(euler); // Used to match Three.js Vector3.applyEuler without bringing a second renderer dependency into Node CI.
    const x = this.x, y = this.y, z = this.z; // Used as the unrotated vector components for quaternion application.
    const qx = quaternion.x, qy = quaternion.y, qz = quaternion.z, qw = quaternion.w; // Used by the quaternion-vector product below.
    const ix = qw * x + qy * z - qz * y; // Used as the X component of q * v.
    const iy = qw * y + qz * x - qx * z; // Used as the Y component of q * v.
    const iz = qw * z + qx * y - qy * x; // Used as the Z component of q * v.
    const iw = -qx * x - qy * y - qz * z; // Used as the W component of q * v.
    this.x = ix * qw + iw * -qx + iy * -qz - iz * -qy;
    this.y = iy * qw + iw * -qy + iz * -qx - ix * -qz;
    this.z = iz * qw + iw * -qz + ix * -qy - iy * -qx;
    return this;
  }

  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  dot(other) { return this.x * other.x + this.y * other.y + this.z * other.z; }
  addScaledVector(other, scale) { this.x += other.x * scale; this.y += other.y * scale; this.z += other.z * scale; return this; }
  lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  normalize() {
    const length = Math.sqrt(this.lengthSq()) || 1; // Used to avoid NaNs for the zero vector in the same benign way this focused harness expects.
    this.x /= length; this.y /= length; this.z /= length;
    return this;
  }
  crossVectors(a, b) {
    const ax = a.x, ay = a.y, az = a.z; // Used as the left operand retained while writing this vector in place.
    const bx = b.x, by = b.y, bz = b.z; // Used as the right operand retained while writing this vector in place.
    this.x = ay * bz - az * by;
    this.y = az * bx - ax * bz;
    this.z = ax * by - ay * bx;
    return this;
  }
}

class Matrix4 {
  constructor() {
    this.elements = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  }

  makeBasis(xAxis, yAxis, zAxis) {
    const te = this.elements; // Used to store the orthonormal basis in Three.js's column-major layout.
    te[0] = xAxis.x; te[1] = xAxis.y; te[2] = xAxis.z;
    te[4] = yAxis.x; te[5] = yAxis.y; te[6] = yAxis.z;
    te[8] = zAxis.x; te[9] = zAxis.y; te[10] = zAxis.z;
    return this;
  }
}

const authoredData = {
  chairSimple: {
    key: 'chairSimple',
    footprint: { w: 1, d: 1 },
    seatAnchors: [{ position: { x: 0.2, y: 0.3, z: 0.1 }, rotationDeg: { x: -5, y: 0, z: 0 } }],
  },
  bench: benchData,
}; // Used as the authored metadata source for both synthetic and real saved placements.
const window = {
  THREE: { Euler, Quaternion, Vector3, Matrix4 },
  FarmEditor: { init() {} },
  AuthoredFurniture: {
    peek(key) { return authoredData[key] || null; },
    load(key) { return Promise.resolve(authoredData[key] || null); },
  },
  ProceduralFurniture: { buildFurnitureGroup(key) { return { key }; } },
  MapLayoutSystem: { getEffectiveMapData(mapData) { return mapData; } },
  __farmLog() {},
}; // Used as the browser-like runtime with enough Three.js math to execute the production non-uniform-scale branch.
const context = vm.createContext({ window, console, Math, Number, String, Object, Array, Map, Set, Promise }); // Used to isolate the adapter from Node globals while preserving standard numeric behavior.
vm.runInContext(adapterSource, context, { filename: 'seat-surface-placement-transform.js' });

const decorativeFurnitureDefs = {
  chairSimple: { itemKey: 'chairSimpleFurniture', name: 'Simple Chair', sit: true, fw: 1, fd: 1 },
  bench: { itemKey: 'benchFurniture', name: 'Bench', sit: true, fw: 2, fd: 1 },
}; // Used to resolve real map item keys to their gameplay furniture keys.
window.FarmEditor.init({ DECORATIVE_FURNITURE_DEFS: decorativeFurnitureDefs });

const chairMap = {
  id: 'seat_orientation_test',
  furniture: [{
    id: 'chair-orientation', itemKey: 'chairSimpleFurniture', col: 2, row: 3, rotY: 90,
    postX: 0.4, postY: 0.2, postZ: -0.1, postSX: 2, postSY: 1.5, postSZ: 0.5,
  }],
}; // Used to force the production adapter through its full Three.js plane-orientation transform.
const chairEffective = window.MapLayoutSystem.getEffectiveMapData(chairMap); // Used to obtain the runtime alias that carries transformed authored metadata.
const chairAliasKey = Object.keys(decorativeFurnitureDefs).find(key => decorativeFurnitureDefs[key].itemKey === chairEffective.furniture[0].itemKey); // Used to resolve the alias definition selected for the transformed chair.
const transformedChairData = window.AuthoredFurniture.peek(chairAliasKey); // Used to inspect the production-derived seat plane rather than a duplicated formula.
const transformedChairAnchor = transformedChairData.seatAnchors[0]; // Used to validate the non-uniformly scaled authored seat plane.
const expectedChairPitch = Math.atan(Math.tan(-5 * Math.PI / 180) * (1.5 / 0.5)) * 180 / Math.PI; // Used as an independent analytic result for an X-only tilted plane under Y/Z scale.
assert(Math.abs(transformedChairAnchor.rotationDeg.x - expectedChairPitch) < 1e-9,
  `non-uniform Y/Z scale should change -5° seat pitch to ${expectedChairPitch}° (got ${transformedChairAnchor.rotationDeg.x})`);
assert(Math.abs(transformedChairAnchor.rotationDeg.x + 5) > 1,
  'test must prove it executed the non-uniform orientation branch instead of the old unchanged-rotation fallback');
assert(Math.abs(transformedChairAnchor.rotationDeg.y) < 1e-9 && Math.abs(transformedChairAnchor.rotationDeg.z) < 1e-9,
  'pure X seat tilt with axis-aligned scale should remain a pure X tilt');

const templeBenchPiece = (templeMap.furniture || []).find(piece =>
  piece.itemKey === 'benchFurniture' && Number(piece.postSX) === 2 && Number(piece.postSZ) === 0.75
); // Used to target the existing transformed two-seat temple bench that reproduces the reported class of bug in real map data.
assert(templeBenchPiece, 'temple map should contain the known post-transformed two-seat bench regression fixture');
const benchEffective = window.MapLayoutSystem.getEffectiveMapData({ id: 'temple_bench_regression', furniture: [templeBenchPiece] }); // Used to run the real saved placement through production aliasing.
const benchAliasKey = Object.keys(decorativeFurnitureDefs).find(key => decorativeFurnitureDefs[key].itemKey === benchEffective.furniture[0].itemKey); // Used to resolve the real bench placement's runtime alias.
const transformedBenchData = window.AuthoredFurniture.peek(benchAliasKey); // Used to verify every authored bench seat inherits the saved post transform.
assert.strictEqual(transformedBenchData.seatAnchors.length, benchData.seatAnchors.length, 'all authored bench seat surfaces must survive the transform');
for (let index = 0; index < benchData.seatAnchors.length; index += 1) {
  const sourceAnchor = benchData.seatAnchors[index]; // Used as the immutable authored seat for this bench position.
  const transformedAnchor = transformedBenchData.seatAnchors[index]; // Used as the runtime seat that should match the visible scaled bench.
  assert(Math.abs(transformedAnchor.position.x - sourceAnchor.position.x * 2) < 1e-9, `bench seat ${index} X should follow postSX`);
  assert(Math.abs(transformedAnchor.position.y - (sourceAnchor.position.y + Number(templeBenchPiece.postY || 0))) < 1e-9, `bench seat ${index} Y should follow postY/postSY`);
  assert(Math.abs(transformedAnchor.position.z - sourceAnchor.position.z * 0.75) < 1e-9, `bench seat ${index} Z should follow postSZ`);
}
assert(Math.abs(transformedBenchData.footprint.d - benchData.footprint.d * 0.75) < 1e-9, 'real bench seat depth should follow postSZ');
const expectedBenchPitch = Math.atan(Math.tan(-5 * Math.PI / 180) * (Number(templeBenchPiece.postSY || 1) / 0.75)) * 180 / Math.PI; // Used as the independent expected plane tilt for the real bench's Y/Z scale.
assert(Math.abs(transformedBenchData.seatAnchors[0].rotationDeg.x - expectedBenchPitch) < 1e-9, 'real bench seat plane pitch should follow its non-uniform scale');
assert.strictEqual(templeBenchPiece.itemKey, 'benchFurniture', 'runtime transformation must not mutate the real saved temple furniture record');

console.log('Interior seat surface Three.js math regression passed.');
