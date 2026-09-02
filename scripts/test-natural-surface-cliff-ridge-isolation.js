const fs = require('fs');
const path = require('path');
const vm = require('vm');

class BufferAttribute {
  constructor(array, itemSize, normalized = false) { this.array = array; this.itemSize = itemSize; this.normalized = normalized; this.count = array.length / itemSize; this.name = ''; }
  getX(i) { return this.array[i * this.itemSize]; }
  getY(i) { return this.array[i * this.itemSize + 1]; }
  getZ(i) { return this.array[i * this.itemSize + 2]; }
}
class BufferGeometry {
  constructor(position = null) { this.attributes = {}; this.groups = []; this.userData = {}; this.index = null; if (position) this.setAttribute('position', new BufferAttribute(new Float32Array(position), 3)); }
  getAttribute(name) { return this.attributes[name]; }
  setAttribute(name, attr) { this.attributes[name] = attr; return this; }
  addGroup(start, count, materialIndex) { this.groups.push({ start, count, materialIndex }); }
  clone() { const g = new BufferGeometry(); g.userData = { ...this.userData }; for (const [name,a] of Object.entries(this.attributes)) g.setAttribute(name, new BufferAttribute(a.array.slice(), a.itemSize, a.normalized)); return g; }
  toNonIndexed() { return this.clone(); }
  computeBoundingBox() {}
  computeBoundingSphere() {}
}

const remapCalls = [];
const mapCalls = [];
const naturalApi = {
  installed: true,
  naturalizeMesh(mesh, surface) {
    mesh.userData = { ...mesh.userData, naturalSurface: surface };
    mesh.material = { name: `natural_${surface}`, userData: { naturalSurface: surface } };
    return mesh;
  },
};
const mapper = {
  installed: true,
  remapNaturalTerrainMesh(mesh, label) { remapCalls.push({ mesh, label }); return { patchCount: 1 }; },
  mapMesh(mesh, options) { mapCalls.push({ mesh, options }); return { patchCount: 1 }; },
};
const logs = [];
const windowMock = {
  THREE: { BufferGeometry, BufferAttribute },
  NaturalSurfaceMaterials: naturalApi,
  HobunjiSurfaceStretchUV: mapper,
  __farmLog: (...args) => logs.push(args),
};
windowMock.window = windowMock;

const sourcePath = path.join(__dirname, '..', 'docs', 'js', 'natural-surface-cliff-ridge-isolation.js');
vm.runInNewContext(fs.readFileSync(sourcePath, 'utf8'), {
  window: windowMock, console, Float32Array, Uint16Array, Uint32Array, Math, Object, Array, Number, String,
});

if (!windowMock.NaturalSurfaceCliffRidgeIsolation?.installed) throw new Error('ridge isolator did not install');

const positions = [
  // top: +Y
  0,1,0, 0,1,1, 1,1,1,
  0,1,0, 1,1,1, 1,1,0,
  // side: Y-normal 0
  0,0,0, 1,0,0, 1,1,0,
  0,0,0, 1,1,0, 0,1,0,
];
const cliff = { isMesh:true, name:'probe_cliff', geometry:new BufferGeometry(positions), material:{name:'plain'}, userData:{} };
naturalApi.naturalizeMesh(cliff, 'rocks');

if (!Array.isArray(cliff.material) || cliff.material.length !== 2) throw new Error('natural ridge did not duplicate material slots');
if (cliff.userData.naturalSurfaceCliffSlot !== 1) throw new Error('cliff side slot was not assigned');
if (!cliff.userData.terrainJigsawIgnore) throw new Error('ridge-mapped natural surface did not take Jigsaw ownership');
if (cliff.geometry.groups.length !== 2) throw new Error(`expected 2 semantic groups, got ${cliff.geometry.groups.length}`);
if (cliff.geometry.groups[0].materialIndex !== 0 || cliff.geometry.groups[0].count !== 6) throw new Error('top group incorrect');
if (cliff.geometry.groups[1].materialIndex !== 1 || cliff.geometry.groups[1].count !== 6) throw new Error('side group incorrect');
if (mapCalls.length !== 1 || mapCalls[0].options.materialIndex !== 1) throw new Error('final mapper did not target only the cliff-side group');

const unrelated = { isMesh:true, name:'furniture', geometry:new BufferGeometry(positions), material:{name:'plain'}, userData:{} };
const isolated = windowMock.NaturalSurfaceCliffRidgeIsolation.isolateRidge(unrelated, 'furniture');
if (isolated || unrelated.geometry.groups.length) throw new Error('non-natural mesh was ridge-split');

const snapshot = windowMock.NaturalSurfaceCliffRidgeIsolation.snapshot();
if (snapshot.isolated !== 1 || snapshot.topTriangles !== 2 || snapshot.sideTriangles !== 2 || snapshot.remaps !== 1) throw new Error(`unexpected stats ${JSON.stringify(snapshot)}`);
console.log(JSON.stringify({groups: cliff.geometry.groups, mapCalls: mapCalls.length, snapshot}, null, 2));
