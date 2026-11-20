#!/usr/bin/env node
'use strict';

// Executes js/faceted-rocks.js's rock generator over many tiles: every rock
// is a chiselled block of large flat faces (no slivers, no near-parallel
// neighbours), stays inside its tile, is wound outward, and every face carries
// the whole PNG — fanned from its centre with its rim on the PNG border and
// no folds.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const win = {};
win.window = win;
const storage = new Map();
const context = vm.createContext({ window: win, globalThis: win, console, Math, localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)) } });
win.HobunjiRenderLayers = { SHELL_OUTLINE: 1 };
vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/js/faceted-rocks.js'), 'utf8'), context, { filename: 'faceted-rocks.js' });
const FR = win.FacetedRocks;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = v => { const l = Math.hypot(...v) || 1; return v.map(x => x / l); };
const angleDeg = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(unit(a), unit(b))))) * 180 / Math.PI;
const key = p => p.map(v => Math.round(v * 1e5)).join(',');

let rocks = 0, minDihedral = Infinity, minFaces = Infinity, maxFaces = 0, cutsTotal = 0;
for (let col = -30; col < 60; col += 3) for (let row = -30; row < 60; row += 5) {
  const data = FR.buildRockData(col, row);
  rocks++;
  const faces = Array.from(data.faces), positions = Array.from(data.positions), uvs = Array.from(data.uvs), faceIds = Array.from(data.faceIds);
  cutsTotal += data.cuts;
  minFaces = Math.min(minFaces, faces.length); maxFaces = Math.max(maxFaces, faces.length);
  assert.ok(faces.length >= 8, `rock ${col},${row}: ${faces.length} faces`);
  assert.ok(data.height > 0.2 && data.height <= 0.75, `rock ${col},${row}: height ${data.height}`);
  for (let i = 0; i < positions.length; i += 3) {
    assert.ok(Math.abs(positions[i]) <= 0.4801 && Math.abs(positions[i + 2]) <= 0.4801, `rock ${col},${row} stays inside its tile`);
    assert.ok(positions[i + 1] >= -0.0601, 'nothing below the sunk base');
  }
  // Planar, outward, no slivers.
  const edgeFaces = new Map();
  faces.forEach((face, f) => {
    const pts = Array.from(face.points, p => Array.from(p)), n = Array.from(face.normal);
    for (const p of pts) assert.ok(Math.abs(dot(n, sub(p, pts[0]))) < 1e-7, `rock ${col},${row} face ${f} is planar`);
    let area = [0, 0, 0];
    for (let i = 0; i < pts.length; i++) area = area.map((v, k) => v + cross(pts[i], pts[(i + 1) % pts.length])[k]);
    assert.ok(Math.abs(dot(area, n)) / 2 >= 0.006 - 1e-9, `rock ${col},${row} face ${f} is not a sliver`);
    for (let i = 0; i < pts.length; i++) {
      const e = [key(pts[i]), key(pts[(i + 1) % pts.length])].sort().join('|');
      if (!edgeFaces.has(e)) edgeFaces.set(e, []);
      edgeFaces.get(e).push(f);
    }
  });
  for (let t = 0; t < positions.length / 9; t++) {
    const p = k => positions.slice(t * 9 + k * 3, t * 9 + k * 3 + 3);
    const tri = cross(sub(p(1), p(0)), sub(p(2), p(0)));
    assert.ok(dot(tri, Array.from(faces[faceIds[t * 3]].normal)) > 0, `rock ${col},${row}: triangle ${t} wound outward`);
  }
  // Neighbouring faces meet at a real edge.
  for (const owners of edgeFaces.values()) {
    if (owners.length !== 2) continue;
    const d = angleDeg(Array.from(faces[owners[0]].normal), Array.from(faces[owners[1]].normal));
    minDihedral = Math.min(minDihedral, d);
    assert.ok(d >= 15, `rock ${col},${row}: neighbouring faces only ${d.toFixed(1)} degrees apart`);
  }
  // UVs: centroid fan, rim on the PNG border, never folded.
  let t = 0;
  faces.forEach((face, f) => {
    let sign = 0;
    const corners = new Set();
    for (let i = 0; i < face.points.length; i++, t++) {
      const u = k => uvs.slice((t * 3 + k) * 2, (t * 3 + k) * 2 + 2);
      assert.deepEqual(u(0), [0.5, 0.5], 'each face fans from the PNG centre');
      for (const k of [1, 2]) {
        const [x, y] = u(k);
        assert.ok(x >= 0 && x <= 1 && y >= 0 && y <= 1, 'UVs inside the PNG');
        assert.ok(Math.min(x, 1 - x, y, 1 - y) < 1e-9, 'face rim lies on the PNG border');
        if ((x === 0 || x === 1) && (y === 0 || y === 1)) corners.add(x + ',' + y);
      }
      const area = (u(1)[0] - u(0)[0]) * (u(2)[1] - u(0)[1]) - (u(2)[0] - u(0)[0]) * (u(1)[1] - u(0)[1]);
      assert.ok(Math.abs(area) > 1e-6, 'no collapsed UV triangle');
      if (!sign) sign = Math.sign(area);
      assert.equal(Math.sign(area), sign, `rock ${col},${row} face ${f}: UVs never fold`);
    }
    assert.equal(sign, 1, 'UVs keep the face winding (PNG not mirrored)');
    assert.ok(corners.size >= 2, `rock ${col},${row} face ${f}: border turns at least two PNG corners`);
  });
}
assert.ok(cutsTotal / rocks >= 2.5, `rocks are chiselled (avg ${(cutsTotal / rocks).toFixed(1)} cuts)`);
assert.deepEqual(Array.from(FR.buildRockData(7, 9).positions), Array.from(FR.buildRockData(7, 9).positions), 'deterministic per tile');
assert.notDeepEqual(Array.from(FR.buildRockData(7, 9).positions), Array.from(FR.buildRockData(8, 9).positions));

// styleMesh: off the shell layer, owner of its UVs.
const layers = { mask: 0b11, disable(bit) { this.mask &= ~(1 << bit); } };
const mesh = FR.styleMesh({ layers, userData: {} });
assert.equal(layers.mask, 0b01, 'removed from SHELL_OUTLINE');
assert.equal(mesh.userData.noOutline, true);
assert.equal(mesh.userData.naturalSurfaceUvOwner, 'FacetedRocks');
assert.equal(mesh.userData.terrainJigsawIgnore, true);

// Toggle persists.
assert.equal(FR.enabled(), true);
FR.setEnabled(false);
assert.equal(storage.get(FR.STORAGE_KEY), 'off');
FR.setEnabled(true);

// game.js: faceted ore rocks, no generated outline, and kept out of the chunk jigsaw UV bake.
const game = fs.readFileSync(path.join(__dirname, '../docs/game.js'), 'utf8');
const wild = game.slice(game.indexOf("if (tile.rockKind === 'diggableRockOre' && window.FacetedRocks?.enabled?.())"));
const wildBranch = wild.slice(0, wild.indexOf('continue;'));
assert.match(wildBranch, /window\.FacetedRocks\.buildOreRock\(/);
assert.match(wildBranch, /facetedMaterialFor\(/);
assert.doesNotMatch(wildBranch, /_markOutline|_markTerrainEdgeId/, 'no generated outline on faceted rocks');
assert.match(game, /wildernessChunkOwnsGeometry && !mesh\.userData\.facetedRock\) bakeTargets\.push/, 'jigsaw bake leaves faceted UVs alone');
assert.match(game, /faceted_mine_rock_/);

// Farm loose rocks use it too, and the natural-surface UV passes leave its per-face UVs alone.
const farm = fs.readFileSync(path.join(__dirname, '../docs/js/vegetation-crop-rendering.js'), 'utf8');
assert.match(farm, /window\.FacetedRocks\.buildNaturalRock\(/);
assert.match(fs.readFileSync(path.join(__dirname, '../docs/js/surface-stretch-uv-furniture.js'), 'utf8'), /naturalSurfaceUvOwner === 'FacetedRocks'\) return null;/);
assert.match(fs.readFileSync(path.join(__dirname, '../docs/js/natural-surface-stretch-runtime.js'), 'utf8'), /naturalSurfaceUvOwner === 'FacetedRocks'\) return false;/);

console.log(`faceted rocks: ${rocks} chiselled rocks, ${minFaces}-${maxFaces} flat faces (neighbours >= ${minDihedral.toFixed(1)} deg), whole-PNG faces, unfolded UVs`);
