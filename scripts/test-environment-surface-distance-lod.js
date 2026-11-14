'use strict';
// Far snow/slush chunks draw a flat slab instead of the full micro-plateau; the slab covers the same tiles,
// keeps dug/raised tiles as their own patches, never covers water, and swaps by camera distance with hysteresis.
const assert = require('node:assert/strict');
const fs = require('node:fs'); // Loads the production owners.
const vm = require('node:vm'); // Runs the renderer-independent geometry and camera code.
class Node {
  constructor() { this.children = []; this.userData = {}; this.visible = true; }
  add(child) { child.parent = this; this.children.push(child); }
  remove(child) { this.children = this.children.filter(entry => entry !== child); child.parent = null; }
  traverse(fn) { fn(this); for (const child of this.children) child.traverse(fn); }
}
class Attribute {
  constructor(array, size) { this.array = array; this.itemSize = size; this.count = array.length / size; }
  getX(i) { return this.array[i * this.itemSize]; }
  getY(i) { return this.array[i * this.itemSize + 1]; }
  getZ(i) { return this.array[i * this.itemSize + 2]; }
}
class Geometry {
  constructor() { this.attributes = {}; }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name]; }
  setIndex(value) { this.index = value; }
  computeBoundingBox() {
    const p = this.attributes.position; // Geometry extents needed by the production UV fallback.
    this.boundingBox = { min: {x:Infinity,z:Infinity}, max:{x:-Infinity,z:-Infinity} };
    for (let i = 0; i < p.count; i++) for (const axis of ['x','z']) {
      const value = axis === 'x' ? p.getX(i) : p.getZ(i); // Reads the current vertex axis.
      this.boundingBox.min[axis] = Math.min(this.boundingBox.min[axis], value);
      this.boundingBox.max[axis] = Math.max(this.boundingBox.max[axis], value);
    }
  }
  computeBoundingSphere() {}
  dispose() {}
  toNonIndexed() {
    const result = new Geometry(); // Expands indexed geometry just as Three.js does before chunk slicing.
    for (const [name, attr] of Object.entries(this.attributes)) {
      const array = new Float32Array(this.index.count * attr.itemSize); // Independent output attribute.
      for (let i = 0; i < this.index.count; i++) for (let axis = 0; axis < attr.itemSize; axis++) array[i * attr.itemSize + axis] = attr.array[this.index.getX(i) * attr.itemSize + axis];
      result.setAttribute(name, new Attribute(array, attr.itemSize));
    }
    return result;
  }
}

const COLS = 48, ROWS = 4;
const grid = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => ({ type: 'grass' })));
grid[1][5] = { type: 'trench' }; // A dug hole: its own, lower surface.
grid[2][9] = { type: 'water' }; // Never covered.
grid[1][20] = { type: 'raised' };
grid[3][40] = { type: 'ramp', rampElevation: 1 };
let area = 'map_western_slope', season = 'Longpour', scene = new Node(), tick;
const window = {
  THREE: {
    Group: Node, BufferGeometry: Geometry, BufferAttribute: Attribute, Float32BufferAttribute: Attribute,
    Mesh: class extends Node { constructor(geometry, material) { super(); this.geometry = geometry; this.material = material; } },
    MeshBasicMaterial: class { constructor(config) { Object.assign(this, config); this.userData = {}; } },
    TextureLoader: class { load() {} }, DoubleSide: 2,
  },
  GridTileAccessors: { getCurrentArea: () => area, getActiveScene: () => scene, getActiveGrid: () => grid, getActiveCols: () => COLS, getActiveRows: () => ROWS },
  CalendarSystem: { currentSeason: () => ({ name: season }) },
  RuntimeFrameScheduler: { register(id, callback) { tick = callback; } },
};
vm.runInNewContext(fs.readFileSync('docs/js/environment-surface-micro-plateau.js', 'utf8'), { window });
const api = window.EnvironmentSurfaceMicroPlateau;
const cameraAt = (x, z) => ({ matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 30, z, 1] } });
const triangles = mesh => mesh.geometry.getAttribute('position').count / 3;
// Height of the slab under a point, or null where no patch covers it.
function slabYAt(meshes, x, z) {
  for (const mesh of meshes) {
    const p = mesh.geometry.getAttribute('position');
    for (let i = 0; i < mesh.userData.environmentSurfaceFarSlabTriangles.patches * 3; i += 6) { // Two triangles per patch: v00, v01, v11, v00, v11, v10.
      const x0 = p.getX(i), z0 = p.getZ(i), x1 = p.getX(i + 2), z1 = p.getZ(i + 2);
      if (x < x0 || x > x1 || z < z0 || z > z1) continue;
      const u = (x - x0) / (x1 - x0), v = (z - z0) / (z1 - z0);
      const y00 = p.getY(i), y01 = p.getY(i + 1), y11 = p.getY(i + 2), y10 = p.getY(i + 5);
      return (y00 * (1 - u) + y10 * u) * (1 - v) + (y01 * (1 - u) + y11 * u) * v;
    }
  }
  return null;
}
function build() {
  scene = new Node();
  tick({ timestamp: (build.t = (build.t || 0) + 1000) });
  const meshes = scene.children[0].children;
  return { near: meshes.filter(m => !m.userData.environmentSurfaceFarSlab), far: meshes.filter(m => m.userData.environmentSurfaceFarSlab) };
}

// ---- Snow: merged patches.
let { near, far } = build();
assert.equal(near.length, 3, 'three 16-tile chunks');
assert.equal(far.length, 3, 'every chunk has a slab');
assert.ok(near.every(m => m.visible === true) && far.every(m => m.visible === false), 'full detail until the game reports a camera');
const covered = COLS * ROWS - 1;
assert.equal(near.reduce((n, m) => n + triangles(m), 0), covered * 18);
const patchTriangles = meshes => meshes.reduce((n, m) => n + m.userData.environmentSurfaceFarSlabTriangles.patches, 0);
const rimTriangles = meshes => meshes.reduce((n, m) => n + m.userData.environmentSurfaceFarSlabTriangles.rims, 0);
const slabTriangles = patchTriangles(far);
assert.ok(slabTriangles < covered * 2 / 4, `flat snow merges into far fewer than two triangles a tile (${slabTriangles})`);
assert.equal(rimTriangles(far), api.debugSnapshot().exposedEdges * 2, 'one rim quad for every side where the snow ends, so a far clifftop keeps its white edge');
{ // The rim on the map's north edge runs from the walkable surface at the boundary up to the cap an edge-width inside.
  const p = far[0].geometry.getAttribute('position'); let low = Infinity, high = -Infinity, inner = -Infinity;
  for (let i = far[0].userData.environmentSurfaceFarSlabTriangles.patches * 3; i < p.count; i++) if (p.getX(i) <= 1 && p.getZ(i) < 0.5) { low = Math.min(low, p.getY(i)); high = Math.max(high, p.getY(i)); inner = Math.max(inner, p.getZ(i)); }
  assert.ok(Math.abs(low) < 1e-6 && Math.abs(high - 0.22) < 1e-6 && Math.abs(inner - 0.22) < 1e-6, `rim spans base to cap (${low}, ${high}, ${inner})`);
}
const snap = api.debugSnapshot().distanceLod;
assert.deepEqual([snap.chunksWithSlab, snap.fullTriangles, snap.slabTriangles], [3, covered * 18, slabTriangles + rimTriangles(far)]);
for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
  const y = slabYAt(far, col + 0.5, row + 0.5);
  const tile = grid[row][col];
  if (tile.type === 'water') { assert.equal(y, null, 'water is never covered by a slab patch'); continue; }
  const expected = api.cameraSurfaceYAt(col + 0.5, row + 0.5); // The full-detail cap height at the tile centre.
  assert.ok(y !== null && Math.abs(y - expected) < 1e-6, `slab at ${col},${row} sits at the cap height (${y} vs ${expected})`);
}
assert.ok(slabYAt(far, 5.5, 1.5) < slabYAt(far, 4.5, 1.5) - 0.4, 'a dug tile keeps its own lower patch instead of being merged away');
assert.ok(slabYAt(far, 20.5, 1.5) > slabYAt(far, 19.5, 1.5) + 0.4, 'and a raised one its own higher patch');
for (const mesh of far) { assert.equal(typeof mesh.raycast, 'function'); assert.equal(mesh.raycast(), undefined, 'the slab never answers raycasts'); }

// ---- Distance swap with hysteresis (enter 28 tiles, exit 24, measured to the chunk's nearest edge).
const state = () => near.map((m, i) => (m.visible ? 'N' : '') + (far[i].visible ? 'F' : '')).join(' ');
api.updateDistanceLod(cameraAt(0, 2));
assert.equal(state(), 'N N F', 'the chunk starting 32 tiles away shows its slab');
api.updateDistanceLod(cameraAt(7, 2));
assert.equal(state(), 'N N F', '25 tiles away is inside the hysteresis gap: no swap back yet');
api.updateDistanceLod(cameraAt(9, 2));
assert.equal(state(), 'N N N', '23 tiles away returns to full detail');
api.updateDistanceLod(cameraAt(5, 2));
assert.equal(state(), 'N N N', '27 tiles away is still inside the gap going the other way');
api.updateDistanceLod(cameraAt(0, 2));
api.setDistanceLodEnabled(false);
api.updateDistanceLod(cameraAt(0, 2));
assert.equal(state(), 'N N N', 'the A/B switch restores full detail everywhere');
api.setDistanceLodEnabled(true);
api.updateDistanceLod({});
assert.equal(state(), 'N N N', 'an unusable camera never hides the detailed surface');

// ---- A non-linear stretch map: patches may only merge where the texture stays where it was.
window.HobunjiSurfaceStretchUV = { mapGeometry(geometry) {
  const position = geometry.getAttribute('position'); // Warps strongly along x, the way the real mapper does toward a snowfield's outline.
  const uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) { const x = position.getX(i) / COLS; uv[i * 2] = x * x * x; uv[i * 2 + 1] = position.getZ(i) / ROWS; }
  geometry.setAttribute('uv', new Attribute(uv, 2));
  return geometry;
} };
({ near, far } = build());
const warpedTriangles = patchTriangles(far);
assert.ok(warpedTriangles > slabTriangles && warpedTriangles < covered * 2, `a warped map merges less, but still merges where it is nearly linear (${warpedTriangles})`);
for (const mesh of far) { // Every tile corner under a patch keeps its mapped texture coordinate to within the merge tolerance.
  const pos = mesh.geometry.getAttribute('position'), uv = mesh.geometry.getAttribute('uv');
  for (let i = 0; i < mesh.userData.environmentSurfaceFarSlabTriangles.patches * 3; i += 6) {
    const x0 = Math.round(pos.getX(i)), x1 = Math.round(pos.getX(i + 2)), u0 = uv.getX(i), u1 = uv.getX(i + 2);
    for (let x = x0; x <= x1; x++) {
      const linear = u0 + (u1 - u0) * (x - x0) / (x1 - x0), mapped = Math.pow(x / COLS, 3);
      assert.ok(Math.abs(linear - mapped) < 0.0013, `patch ${x0}-${x1} keeps the texture at column ${x} (${linear} vs ${mapped})`);
    }
  }
}
delete window.HobunjiSurfaceStretchUV;

// ---- Translucent slush: exact one-tile patches, no overlap (it would blend twice).
area = 'map_eastern_mire'; season = 'Coldmuck';
({ near, far } = build());
assert.equal(far.reduce((n, m) => n + triangles(m), 0), covered * 2, 'slush keeps two triangles a tile and no rims');
const p = far[0].geometry.getAttribute('position');
for (let i = 0; i < p.count; i++) assert.ok(Number.isInteger(p.getX(i)) && Number.isInteger(p.getZ(i)), 'slush patches end exactly on tile corners');
console.log('environment-surface distance LOD: ok');
