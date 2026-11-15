#!/usr/bin/env node
'use strict';

// A lunge afterimage used to clone the whole skinned portrait grid (png-plane-avatar.js buildSkinnedPlaneGeometry:
// segmentsX x segmentsY cells, 6 non-indexed vertices per cell, front face then back face = 4,032 triangles) and run
// boneTransform on all 12,096 vertices per snapshot. The ghost now merges 2x2 cells into one quad using the block's
// four corner vertices. This builds a grid with that exact layout on a real three r128 SkinnedMesh and runs the
// production snapshotter: the ghost must have a quarter of the triangles, UVs and posed positions taken from the right
// source corners (both faces), the right material groups, and must be reusable from the pool. A geometry that is not
// that grid keeps the full clone. Needs three.js r128; skips (exit 0) when it is not resolvable from here.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
let THREE;
try { THREE = require('three'); } catch (_) { try { THREE = require(require.resolve('three', { paths: [process.env.THREE_DIR || process.cwd()] })); } catch (__) { console.log('SKIP: three not resolvable (set THREE_DIR to a dir with node_modules/three@0.128)'); process.exit(0); } }
const source = fs.readFileSync('docs/js/combat/combat-blink-dodge.js', 'utf8');

function gridPortrait(segX, segY, withUserData = true) {
  const positions = [], uvs = [], skinIndex = [], skinWeight = [];
  const W = 2, H = 3;
  const vertex = (px, py) => { // px/py in 0..1 plane space, like appendVertex.
    positions.push(-W / 2 + px * W, H / 2 - py * H, 0); uvs.push(px, 1 - py);
    skinIndex.push(0, 1, 0, 0); const t = 1 - py; skinWeight.push(1 - t, t, 0, 0); // Bottom follows bone 0, top follows bone 1.
  };
  const cell = (c, r, back) => {
    const x0 = c / segX, x1 = (c + 1) / segX, y0 = r / segY, y1 = (r + 1) / segY;
    const front = [[x0, y1], [x1, y1], [x0, y0], [x1, y1], [x1, y0], [x0, y0]];
    for (const [x, y] of back ? [...front].reverse() : front) vertex(x, y);
  };
  for (let r = 0; r < segY; r += 1) for (let c = 0; c < segX; c += 1) cell(c, r, false);
  const frontCount = positions.length / 3;
  for (let r = 0; r < segY; r += 1) for (let c = 0; c < segX; c += 1) cell(c, r, true);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
  geometry.addGroup(0, frontCount, 0); geometry.addGroup(frontCount, frontCount, 1);
  if (withUserData) geometry.userData = { segmentsX: segX, segmentsY: segY };
  const root = new THREE.Bone(), top = new THREE.Bone();
  top.position.y = 1; root.add(top);
  const skeleton = new THREE.Skeleton([root, top]);
  const mesh = new THREE.SkinnedMesh(geometry, [new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial()]);
  mesh.add(root); mesh.bind(skeleton);
  mesh.name = 'portrait_grid';
  for (const material of mesh.material) material.name = 'npc_avatar_skinned_front_grid';
  mesh.updateMatrixWorld(true);
  top.rotation.z = 0.4; top.position.x = 0.3; // Pose the upper bone so positions differ from bind.
  mesh.updateMatrixWorld(true);
  return mesh;
}

function runner(mesh) {
  const scene = new THREE.Scene(); const root = new THREE.Group(); scene.add(root); root.add(mesh);
  const player = { x: 0, y: 0, lunging: false, dodging: false, stamina: 200 };
  const combat = { abilities: { register() {} }, deps: { player, playerMesh: root, TILE: 64, hostileObjects: [], getCurrentArea: () => null }, update() {}, setMovementSpeedMul() {} };
  const windowStub = { Combat: combat, THREE, BanditCombat: { setCombatExpression() {} }, WorldPortraitLife: { setPlayerCombatExpression() {}, isPlayerCombatExpressionApplied: () => true }, HobunjiSpritePngSurface: { alphaTest: () => 0.001 } };
  let now = 1000;
  vm.runInNewContext(source, { window: windowStub, document: { createElement: () => ({ width: 0, height: 0, getContext: () => ({ clearRect() {}, drawImage() {} }) }) }, performance: { now: () => now }, console }, { filename: 'combat-blink-dodge.js' });
  player.lunging = true; combat.update(0.016);
  const step = () => { player.x += 64; now += 60; combat.update(0.06); };
  const ghosts = () => scene.children.filter(child => child.name === 'combat_portrait_afterimage');
  return { step, ghosts, debug: () => windowStub.HobunjiDodgeFeedback.getDebug().blink.afterimages };
}

const segX = 28, segY = 36, mesh = gridPortrait(segX, segY);
const run = runner(mesh);
run.step();
const ghost = run.ghosts()[0];
assert.ok(ghost, 'a lunge produced a ghost');
const g = ghost.geometry, pos = g.getAttribute('position'), uv = g.getAttribute('uv');
const sourceTris = mesh.geometry.getAttribute('position').count / 3;
assert.equal(sourceTris, 4032, 'the fixture matches the real 28x36 two-sided grid');
assert.equal(pos.count / 3, sourceTris / 4, 'the ghost has a quarter of the triangles');
assert.equal(g.groups.length, 2, 'front and back material groups are kept');
assert.deepEqual(g.groups.map(group => [group.start, group.count, group.materialIndex]), [[0, pos.count / 2, 0], [pos.count / 2, pos.count / 2, 1]]);
assert.ok(!g.getAttribute('skinIndex') && !g.getAttribute('skinWeight'), 'the ghost is a plain static mesh');

// Every ghost vertex must equal the stock-skinned source vertex whose UV it carries (corner vertices of a block).
mesh.skeleton.update();
const sourceUv = mesh.geometry.getAttribute('uv'), sourcePos = mesh.geometry.getAttribute('position');
const v = new THREE.Vector3();
const expectedByUv = new Map(); // "face|u|v" -> posed position of that corner (each plane position is a unique grid corner).
const half = sourcePos.count / 2;
for (let i = 0; i < sourcePos.count; i += 1) {
  v.fromBufferAttribute(sourcePos, i); mesh.boneTransform(i, v);
  expectedByUv.set(`${i < half ? 0 : 1}|${sourceUv.getX(i).toFixed(5)}|${sourceUv.getY(i).toFixed(5)}`, [v.x, v.y, v.z]);
}
let worst = 0;
for (let i = 0; i < pos.count; i += 1) {
  const key = `${i < pos.count / 2 ? 0 : 1}|${uv.getX(i).toFixed(5)}|${uv.getY(i).toFixed(5)}`;
  const want = expectedByUv.get(key);
  assert.ok(want, `ghost vertex ${i} maps to a source corner (${key})`);
  worst = Math.max(worst, Math.abs(pos.getX(i) - want[0]), Math.abs(pos.getY(i) - want[1]), Math.abs(pos.getZ(i) - want[2]));
}
assert.ok(worst < 1e-5, `ghost corners are the posed source vertices (worst error ${worst})`);
// The ghost covers the same rectangle as the source: min/max of its positions match.
const bounds = (attribute, count) => { let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity; for (let i = 0; i < count; i += 1) { minX = Math.min(minX, attribute.getX(i)); maxX = Math.max(maxX, attribute.getX(i)); minY = Math.min(minY, attribute.getY(i)); maxY = Math.max(maxY, attribute.getY(i)); } return [minX, maxX, minY, maxY]; };
const gb = bounds(pos, pos.count);
const sb = [...expectedByUv.values()].reduce((b, p) => [Math.min(b[0], p[0]), Math.max(b[1], p[0]), Math.min(b[2], p[1]), Math.max(b[3], p[1])], [Infinity, -Infinity, Infinity, -Infinity]);
for (let i = 0; i < 4; i += 1) assert.ok(Math.abs(gb[i] - sb[i]) < 1e-5, 'the ghost spans the same posed silhouette extent');

// Pool reuse keeps the decimated topology and refreshes its pose.
const createdBefore = run.debug().entriesCreated;
for (let i = 0; i < 6; i += 1) run.step();
assert.equal(run.ghosts().length, 3, 'one actor keeps at most three live ghosts');
assert.ok(run.debug().entriesReused > 0, 'evicted ghosts are reused from the pool');
assert.equal(run.debug().entriesCreated, createdBefore + 2, 'only the first three ghosts were allocated');
for (const ghostMesh of run.ghosts()) assert.equal(ghostMesh.geometry.getAttribute('position').count / 3, 1008, 'reused ghosts stay decimated');

// A segment count that does not divide by 2 still tiles (edge blocks are narrower) and keeps every cell covered.
const odd = runner(gridPortrait(5, 7)); odd.step();
assert.equal(odd.ghosts()[0].geometry.getAttribute('position').count / 6, 2 * 3 * 4, 'odd 5x7 grid merges into 3x4 blocks per face');

// Not the grid (no segment metadata) -> full clone, old behaviour.
const plain = runner(gridPortrait(4, 4, false)); plain.step();
assert.equal(plain.ghosts()[0].geometry.getAttribute('position').count, 4 * 4 * 6 * 2, 'a geometry without grid metadata keeps the full-density clone');
console.log('OK: afterimage ghosts are decimated, correct, pooled and capped');
