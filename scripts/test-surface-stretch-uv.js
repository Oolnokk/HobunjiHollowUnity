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
    const position = this.attributes.position;
    const min = { x: Infinity, y: Infinity, z: Infinity };
    const max = { x: -Infinity, y: -Infinity, z: -Infinity };
    for (let i = 0; i < position.count; i++) {
      min.x = Math.min(min.x, position.getX(i)); min.y = Math.min(min.y, position.getY(i)); min.z = Math.min(min.z, position.getZ(i));
      max.x = Math.max(max.x, position.getX(i)); max.y = Math.max(max.y, position.getY(i)); max.z = Math.max(max.z, position.getZ(i));
    }
    this.boundingBox = { min, max };
  }
}

const logs = []; // Used to verify the mapper routes diagnostics through the game's mobile-visible debug sink.
const windowMock = {
  THREE: { Vector3, BufferAttribute, MathUtils: { degToRad: degrees => degrees * Math.PI / 180 } },
  __farmLog: (message, level, category) => logs.push([message, level, category]),
};
windowMock.window = windowMock;

const sourcePath = path.join(__dirname, '..', 'docs', 'js', 'surface-stretch-uv-furniture.js'); // Used to test the exact centralized production mapper checked into the repo.
vm.runInNewContext(fs.readFileSync(sourcePath, 'utf8'), {
  window: windowMock, console, Float32Array, Float64Array, Uint8Array, Map, Set, WeakSet, Math, Number, Array, Object, String, Infinity,
});

function fanPolygon(points) {
  const centerX = points.reduce((sum, point) => sum + point[0], 0) / points.length; // Used as the fan triangulation center for irregular/rectangular planar tests.
  const centerZ = points.reduce((sum, point) => sum + point[1], 0) / points.length; // Used as the fan triangulation center for irregular/rectangular planar tests.
  const positions = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    positions.push(a[0], 0, a[1], b[0], 0, b[1], centerX, 0, centerZ);
  }
  return new Geometry(positions);
}

function foldedVerticalStrip(panelCount, stepDeg) {
  const points = [[0, 0]]; // Used as the shared-edge polyline defining a progressively turning vertical cliff.
  let heading = 0;
  for (let i = 0; i < panelCount; i++) {
    const previous = points[points.length - 1];
    const radians = heading * Math.PI / 180;
    points.push([previous[0] + Math.cos(radians), previous[1] + Math.sin(radians)]);
    heading += stepDeg;
  }
  const positions = [];
  for (let i = 0; i < panelCount; i++) {
    const a = points[i], b = points[i + 1];
    positions.push(
      a[0], 0, a[1], b[0], 0, b[1], b[0], 1, b[1],
      a[0], 0, a[1], b[0], 1, b[1], a[0], 1, a[1],
    );
  }
  return new Geometry(positions);
}

function nearlyEqual(a, b, tolerance = 1e-6) { return Math.abs(a - b) <= tolerance; }

const mapper = windowMock.HobunjiSurfaceStretchUV; // Used by all regression cases below.
if (!mapper?.installed) throw new Error('surface-stretch mapper did not install');
const mapperSnapshot = mapper.snapshot();
if (mapperSnapshot.version !== 3 || mapperSnapshot.segmentation !== 'furniture-edge-adjacency' || mapperSnapshot.mapping !== 'edge-preserving-nine-slice') {
  throw new Error(`Expected centralized v3 edge-preserving mapper: ${JSON.stringify(mapperSnapshot)}`);
}
if (!windowMock.HobunjiSurfacePerimeterFrame?.centralizedInSurfaceMapper) throw new Error('perimeter behavior is not centralized in HobunjiSurfaceStretchUV');

const texasLike = fanPolygon([[0, 0], [4, 0], [5, 1], [4, 2], [4.5, 4], [2.5, 3.2], [1, 4], [0.5, 2.2], [-0.5, 1.5]]); // Used to prove one square PNG can fill an irregular connected planar outline.
const texasMapped = mapper.mapGeometry(texasLike);
const texasReport = texasMapped.userData.hobunjiSurfaceStretch;
if (texasReport.version !== 3 || texasReport.patchCount !== 1 || texasReport.fallbackCount !== 0) throw new Error(`Texas-like unwrap failed: ${JSON.stringify(texasReport)}`);
const texasUv = texasMapped.getAttribute('uv');
const corners = new Set();
for (let i = 0; i < texasUv.count; i++) {
  const u = texasUv.getX(i), v = texasUv.getY(i);
  if ((u === 0 || u === 1) && (v === 0 || v === 1)) corners.add(`${u},${v}`);
}
if (corners.size !== 4) throw new Error(`Expected all four square UV corners, got ${Array.from(corners).join(' ')}`);

const nativeScaleRect = mapper.mapGeometry(fanPolygon([[0, 0], [12, 0], [12, 6], [0, 6]])); // Used to prove protected borders keep constant perpendicular world size on differently-scaled axes.
const nativeScaleReport = nativeScaleRect.userData.hobunjiSurfaceStretch;
const edgeBand = nativeScaleReport.edgeBands[0];
if (!edgeBand) throw new Error('Expected edge-band diagnostics for rectangular surface');
if (!nearlyEqual(nativeScaleReport.edgeSourceFraction, 0.32)) throw new Error(`Expected 32% protected source edge, got ${nativeScaleReport.edgeSourceFraction}`);
if (!nearlyEqual(edgeBand.edgeWorldSize, 1.92)) throw new Error(`Expected 1.92-world-unit protected edge, got ${edgeBand.edgeWorldSize}`);
if (!nearlyEqual(edgeBand.surfaceEdgeFractionU * edgeBand.projectedSpanU, 1.92) || !nearlyEqual(edgeBand.surfaceEdgeFractionV * edgeBand.projectedSpanV, 1.92)) {
  throw new Error(`Protected edge changed perpendicular world size: ${JSON.stringify(edgeBand)}`);
}
if (!nearlyEqual(Math.min(edgeBand.surfaceEdgeFractionU, edgeBand.surfaceEdgeFractionV), 0.16) || !nearlyEqual(Math.max(edgeBand.surfaceEdgeFractionU, edgeBand.surfaceEdgeFractionV), 0.32)) {
  throw new Error(`Expected 12x6 surface to use 16%/32% destination edge bands: ${JSON.stringify(edgeBand)}`);
}

const bentPositions = [
  0, 0, 0, 1, 0, 0, 1, 0, 1,
  0, 0, 0, 1, 0, 1, 0, 0, 1,
  1, 0, 0, 1, 1, 0, 1, 1, 1,
  1, 0, 0, 1, 1, 1, 1, 0, 1,
]; // Used to prove a 90-degree hard corner becomes two separate texture surfaces.
const bentMapped = mapper.mapGeometry(new Geometry(bentPositions));
const bentReport = bentMapped.userData.hobunjiSurfaceStretch;
if (bentReport.patchCount !== 2 || bentReport.fallbackCount !== 0) throw new Error(`Bent-surface segmentation failed: ${JSON.stringify(bentReport)}`);

const gradualMapped = mapper.mapGeometry(foldedVerticalStrip(4, 20)); // Used to distinguish furniture adjacency from the old seed/average-normal veto.
const gradualReport = gradualMapped.userData.hobunjiSurfaceStretch;
if (gradualReport.patchCount !== 1) throw new Error(`Furniture adjacency should keep 20° local bends connected: ${JSON.stringify(gradualReport)}`);

const formerlyBoundedMapped = mapper.mapGeometry(foldedVerticalStrip(18, 0), { maxPatchWorldSize: 6 }); // Used to prove the old six-unit patch hint is now a native texture-scale compatibility alias, not a surface splitter.
const formerlyBoundedReport = formerlyBoundedMapped.userData.hobunjiSurfaceStretch;
if (formerlyBoundedReport.patchCount !== 1 || formerlyBoundedReport.maxPatchWorldSize !== null || formerlyBoundedReport.edgeReferenceWorldSize !== 6 || !formerlyBoundedReport.legacyPatchHintIgnored) {
  throw new Error(`Legacy patch hint was not converted to centralized native-scale behavior: ${JSON.stringify(formerlyBoundedReport)}`);
}

const multiPositions = [
  0, 0, 0, 1, 0, 0, 1, 0, 1,
  0, 0, 0, 1, 0, 1, 0, 0, 1,
  0, 0, 1, 1, 0, 1, 1, -1, 1,
  0, 0, 1, 1, -1, 1, 0, -1, 1,
]; // Used to model a shared grass/cliff geometry with distinct material groups.
const multi = new Geometry(multiPositions, [{ start: 0, count: 6, materialIndex: 0 }, { start: 6, count: 6, materialIndex: 1 }]);
const seedUv = new Float32Array((multiPositions.length / 3) * 2); // Used to detect accidental mutation of material-0 grass UVs.
for (let i = 0; i < seedUv.length; i++) seedUv[i] = 0.123 + i * 0.001;
multi.setAttribute('uv', new BufferAttribute(seedUv, 2));
const multiMapped = mapper.mapGeometry(multi, { materialIndex: 1 });
const multiUv = multiMapped.getAttribute('uv');
for (let i = 0; i < 6; i++) {
  if (Math.abs(multiUv.getX(i) - seedUv[i * 2]) > 1e-7 || Math.abs(multiUv.getY(i) - seedUv[i * 2 + 1]) > 1e-7) {
    throw new Error('Material-0 UVs changed while remapping material-1 cliffs');
  }
}
const multiReport = multiMapped.userData.hobunjiSurfaceStretch;
if (multiReport.materialIndex !== 1 || multiReport.patchCount !== 1) throw new Error(`Material-slot unwrap failed: ${JSON.stringify(multiReport)}`);

const stale = mapper.mapGeometry(fanPolygon([[0, 0], [2, 0], [2, 2], [0, 2]])); // Used to prove a v3 signature is not trusted after the UV attribute disappears downstream.
delete stale.attributes.uv;
const rebuilt = mapper.mapGeometry(stale);
if (!rebuilt.getAttribute('uv') || rebuilt.getAttribute('uv').count !== rebuilt.getAttribute('position').count) throw new Error('Missing UVs were not regenerated despite a stale v3 signature');

for (const [angle, expected] of [[79, 1], [80, 2], [81, 2]]) {
  const mapped = mapper.mapGeometry(foldedVerticalStrip(2, angle), { angleToleranceDeg: 80, splitAtThreshold: true }); // Verifies the user's exact boundary, including equality.
  if (mapped.userData.hobunjiSurfaceStretch.patchCount !== expected) throw new Error(`Shingle ${angle}-degree boundary should produce ${expected} side(s)`);
}
const windingSide = mapper.mapGeometry(foldedVerticalStrip(4, 60), { angleToleranceDeg: 80, splitAtThreshold: true }); // A curved side stays connected through local bends even as its total heading changes drastically.
if (windingSide.userData.hobunjiSurfaceStretch.patchCount !== 1) throw new Error('Gradual shingle bends were split by total heading instead of adjacent-face angles');

const boxFaces = [
  [[0,0,0],[0,0.2,0],[3,0.2,0],[3,0,0]],
  [[0,0,0.15],[3,0,0.15],[3,0.2,0.15],[0,0.2,0.15]],
  [[0,0,0],[3,0,0],[3,0,0.15],[0,0,0.15]],
  [[0,0.2,0],[0,0.2,0.15],[3,0.2,0.15],[3,0.2,0]],
  [[0,0,0],[0,0,0.15],[0,0.2,0.15],[0,0.2,0]],
  [[3,0,0],[3,0.2,0],[3,0.2,0.15],[3,0,0.15]],
]; // Uses six connected hard-edged sides with drastically different aspect ratios.
const boxPositions = boxFaces.flatMap(face => [face[0],face[1],face[2],face[0],face[2],face[3]].flat()); // Expands independent triangle corners for the UV seam test.
const boxMapped = mapper.mapGeometry(new Geometry(boxPositions), { angleToleranceDeg: 80, splitAtThreshold: true, edgeReferenceWorldSize: 0.5 }); // Every recognized side must receive all four PNG corners.
if (boxMapped.userData.hobunjiSurfaceStretch.patchCount !== 6) throw new Error('Hard-edged shingle box must have six independent PNG sides');
const boxUv = boxMapped.getAttribute('uv'); // Reads the full PNG domain assigned to each of the six sides.
for (let face = 0; face < 6; face++) {
  const corners = new Set(); // Collects exact UV corners without assuming face orientation.
  for (let i = face * 6; i < face * 6 + 6; i++) corners.add(`${boxUv.getX(i)},${boxUv.getY(i)}`);
  for (const corner of ['0,0','0,1','1,0','1,1']) if (!corners.has(corner)) throw new Error(`Side ${face} is missing PNG corner ${corner}`);
}

const shingleBytes = fs.readFileSync(path.join(__dirname, '..', 'docs', 'assets', 'models', 'HighlandLongshingle_boned.glb')); // Exercises the real irregular GLB rather than relying solely on a box.
const jsonLength = shingleBytes.readUInt32LE(12); // Locates the GLB's JSON and binary chunks.
const shingleGlb = JSON.parse(shingleBytes.subarray(20, 20 + jsonLength).toString()); // Supplies accessor layouts from the shipped model.
const primitive = shingleGlb.meshes[0].primitives[0]; // Selects the visible shell, excluding its hidden guide bone.
const positionAccessor = shingleGlb.accessors[primitive.attributes.POSITION]; // Used to read actual shell vertices.
const positionView = shingleGlb.bufferViews[positionAccessor.bufferView]; // Locates the shell's position bytes.
const indexAccessor = shingleGlb.accessors[primitive.indices]; // Used to preserve the original indexed topology before mapping.
const indexView = shingleGlb.bufferViews[indexAccessor.bufferView]; // Locates the shell's triangle index bytes.
const binaryOffset = 28 + jsonLength; // Points to the binary GLB payload.
const shellPositions = Array.from({ length: positionAccessor.count * 3 }, (_, i) => shingleBytes.readFloatLE(binaryOffset + (positionView.byteOffset || 0) + (positionAccessor.byteOffset || 0) + i * 4)); // Reads Float32 position components.
const shellIndices = Array.from({ length: indexAccessor.count }, (_, i) => shingleBytes.readUInt16LE(binaryOffset + (indexView.byteOffset || 0) + (indexAccessor.byteOffset || 0) + i * 2)); // Reads the shipped Uint16 indices.
const shellGeometry = new Geometry(shellPositions); // Matches the indexed shell geometry that GLTFLoader provides to HousePieceGen.
shellGeometry.index = new BufferAttribute(new Uint16Array(shellIndices), 1);
shellGeometry.toNonIndexed = function () { return new Geometry(shellIndices.flatMap(index => shellPositions.slice(index * 3, index * 3 + 3))); };
const shellMesh = { name: 'Highland_Longshingle_shell', isMesh: true, geometry: shellGeometry }; // Allows production template analysis to replace its geometry.
const shellScene = { traverse(fn) { fn(shellMesh); } }; // Drives the public GLB load path without unrelated renderer APIs.
windowMock.THREE.GLTFLoader = class { load(url, callback) { callback({ scene: shellScene }); } };
windowMock.THREE.Box3 = class { setFromObject() { return this; } getSize() { return { x: 1, y: 1, z: 1 }; } };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'docs', 'js', 'HousePieceGen.js'), 'utf8'), { window: windowMock });
windowMock.HousePieceGen.loadShingleGlb('assets/models/');
const shingleReport = windowMock.HousePieceGen.shingleSurfaceSnapshot(); // Confirms the real runtime owner uses the requested side-detection rule.
if (!shingleReport.ready || shingleReport.meshes !== 1 || shingleReport.surfaces !== 6 || shingleReport.angleToleranceDeg !== 78) throw new Error(`Real shingle side mapping failed: ${JSON.stringify(shingleReport)}`);
if (shellMesh.geometry === shellGeometry || shellMesh.geometry.index || shellMesh.geometry.getAttribute('uv').count !== shellIndices.length) throw new Error('Real shingle corners did not receive independent seam-capable UVs');
for (const value of shellMesh.geometry.getAttribute('uv').array) if (!Number.isFinite(value) || value < -1e-6 || value > 1 + 1e-6) throw new Error('Real shingle UV escaped its full-PNG domain');
const shellUv = shellMesh.geometry.getAttribute('uv'); // Verifies the original model's irregular side triangles retain visible PNG coverage.
const shellPosition = shellMesh.geometry.getAttribute('position'); // Distinguishes a real triangle from the source GLB's nearly zero-area cap triangle.
for (let i = 0; i < shellUv.count; i += 3) {
  const a = new Vector3(shellPosition.getX(i), shellPosition.getY(i), shellPosition.getZ(i)); // First source triangle corner.
  const b = new Vector3(shellPosition.getX(i+1), shellPosition.getY(i+1), shellPosition.getZ(i+1)).sub(a); // First geometric edge.
  const c = new Vector3(shellPosition.getX(i+2), shellPosition.getY(i+2), shellPosition.getZ(i+2)).sub(a); // Second geometric edge.
  if (new Vector3().crossVectors(b,c).length() * 0.5 <= 1e-8) continue;
  const uvArea = Math.abs((shellUv.getX(i+1)-shellUv.getX(i))*(shellUv.getY(i+2)-shellUv.getY(i))-(shellUv.getX(i+2)-shellUv.getX(i))*(shellUv.getY(i+1)-shellUv.getY(i))); // Detects square-boundary fitting that would leave a triangle sampling a single line.
  if (uvArea <= 1e-10) throw new Error(`Real shingle triangle ${i/3} lost its PNG coverage`);
}

if (!logs.some(entry => entry[2] === 'render')) throw new Error('Expected mobile-visible render diagnostics');
console.log(JSON.stringify({ texas: texasReport, nativeScale: edgeBand, bent: bentReport, gradual: gradualReport, legacyScaleAlias: formerlyBoundedReport, multi: multiReport, debug: mapper.snapshot() }, null, 2));
