#!/usr/bin/env node
'use strict';
// Holes in the generated ruin shaft, found by flying through dungeons headlessly:
//  * the death pit (jump platforms and reaching obelisks) had a floor but no sides, so the 8-unit drop was
//    open to the black void — RuinWallFaces.pitWallQuads now closes all four sides, facing into the pit;
//  * ground-story wing doorways are carved through the shell outside the octagon, where the floor mask
//    never reached, so their tunnels were walkable void — the octagonal floor now covers them.
// Also runs the developer fly camera / enemy freeze module (js/dev-inspect-tools.js) under a stub window.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const docs = rel => path.join(__dirname, '..', 'docs', rel);
const Faces = require(docs('js/ruin-wall-faces.js'));
const Jump = require(docs('js/ruin-jump-shaft.js'));
const Obelisks = require(docs('js/ruin-reaching-obelisks.js'));
const Hub = require(docs('js/shaft-hub.js'));
const Plan = require(docs('js/ruin-layer-plan.js'));

// Minimal THREE with real buffer geometry so the built quads can be inspected.
class Node {
  constructor() {
    this.children = []; this.parent = null; this.userData = {}; this.visible = true; this.name = '';
    this.position = { x:0, y:0, z:0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } };
    this.rotation = { x:0, y:0, z:0 }; this.scale = { x:1, y:1, z:1 };
    this.layers = { mask:1 | 2, disable(bit) { this.mask &= ~(1 << bit); }, enable(bit) { this.mask |= 1 << bit; } };
  }
  add(child) { this.children.push(child); child.parent = this; }
  remove(child) { this.children = this.children.filter(c => c !== child); child.parent = null; }
  traverse(fn) { fn(this); for (const c of this.children) c.traverse(fn); }
}
class Geometry { dispose() {} }
class BufferGeometry extends Geometry { constructor() { super(); this.attributes = {}; } setAttribute(name, attr) { this.attributes[name] = attr; } setIndex(i) { this.index = i; } }
class BufferAttribute { constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; } }
class Material { constructor(o) { Object.assign(this, o || {}); } dispose() {} }
class Mesh extends Node { constructor(g, m) { super(); this.geometry = g; this.material = m; this.isMesh = true; } }
const THREE = { Group:Node, Mesh, BoxGeometry:Geometry, PlaneGeometry:Geometry, BufferGeometry, BufferAttribute, MeshBasicMaterial:Material, Vector3:class { constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); } } };
const key2 = (x, z) => x + ',' + z;
const find = (root, name) => { let hit = null; root.traverse(n => { if (!hit && n.name === name) hit = n; }); return hit; };
const triangles = mesh => {
  const p = mesh.geometry.attributes.position.array, n = mesh.geometry.attributes.normal.array, idx = mesh.geometry.index.array, out = [];
  for (let i = 0; i < idx.length; i += 3) {
    const v = [idx[i], idx[i + 1], idx[i + 2]].map(k => [p[k * 3], p[k * 3 + 1], p[k * 3 + 2]]);
    out.push({ v, n:[n[idx[i] * 3], n[idx[i] * 3 + 1], n[idx[i] * 3 + 2]] });
  }
  return out;
};
const coversPoint = (tris, x, y, z, axis) => tris.some(({ v }) => { // Point-in-triangle on the plane perpendicular to `axis`.
  const [i, j] = axis === 'x' ? [2, 1] : axis === 'z' ? [0, 1] : [0, 2], k = { x:0, y:1, z:2 }[axis], pt = [x, y, z];
  if (v.some(q => Math.abs(q[k] - pt[k]) > 1e-6)) return false;
  const [a, b, c] = v, s = (p1, p2, p3) => (p1[i] - p3[i]) * (p2[j] - p3[j]) - (p2[i] - p3[i]) * (p1[j] - p3[j]);
  const d1 = s(pt, a, b), d2 = s(pt, b, c), d3 = s(pt, c, a);
  return !((d1 < -1e-9 || d2 < -1e-9 || d3 < -1e-9) && (d1 > 1e-9 || d2 > 1e-9 || d3 > 1e-9));
});
// Every side of a pit footprint is closed from `bottom` to `top`, and each face points into the pit.
function assertClosedPit(mesh, { minX, minZ, size, bottom, top }, label) {
  assert(mesh, label + ': pit walls exist');
  const tris = triangles(mesh), cx = minX + size / 2, cz = minZ + size / 2;
  for (const t of tris) {
    const mid = t.v.reduce((m, q) => [m[0] + q[0] / 3, m[1] + q[1] / 3, m[2] + q[2] / 3], [0, 0, 0]);
    assert(t.n[0] * (cx - mid[0]) + t.n[2] * (cz - mid[2]) > 0, label + ': every face points into the pit');
    assert(mid[1] > bottom - 1e-6 && mid[1] < top + 1e-6, label + ': walls stay between the bed and the gallery');
  }
  for (let f = .05; f < 1; f += .1) for (let h = .02; h < 1; h += .12) {
    const y = bottom + (top - bottom) * h, along = size * f;
    assert(coversPoint(tris, minX, y, minZ + along, 'x'), `${label}: west side closed at ${along.toFixed(2)},${y.toFixed(2)}`);
    assert(coversPoint(tris, minX + size, y, minZ + along, 'x'), `${label}: east side closed`);
    assert(coversPoint(tris, minX + along, y, minZ, 'z'), `${label}: north side closed`);
    assert(coversPoint(tris, minX + along, y, minZ + size, 'z'), `${label}: south side closed`);
  }
  assert.equal(mesh.layers.mask & 2, 0, label + ': inked stone patches never join the generated shell outline');
}

// 1. The shared quad helper.
{
  const data = Faces.pitWallQuads({ minX:10, minZ:20, size:13, bottom:-8.42, top:0 });
  const mesh = new Mesh(Faces.toGeometry(THREE, data), new Material());
  mesh.layers.disable(1);
  assertClosedPit(mesh, { minX:10, minZ:20, size:13, bottom:-8.42, top:0 }, 'pitWallQuads');
  for (let i = 0; i < data.uvs.length; i++) assert(data.uvs[i] >= 0 && data.uvs[i] <= 1, 'each patch stretches one texture (UV 0..1)');
}
// 1a. Rectangular basins (a rope chamber's abyss): every side closed down past the hazard sheet.
{
  const rect = { minX:3, minZ:7, sizeX:9, sizeZ:4, bottom:33.55, top:36 };
  const mesh = new Mesh(Faces.toGeometry(THREE, Faces.pitWallQuads(rect)), new Material());
  const tris = triangles(mesh), cx = rect.minX + rect.sizeX / 2, cz = rect.minZ + rect.sizeZ / 2;
  for (const t of tris) {
    const mid = t.v.reduce((m, q) => [m[0] + q[0] / 3, m[1] + q[1] / 3, m[2] + q[2] / 3], [0, 0, 0]);
    assert(t.n[0] * (cx - mid[0]) + t.n[2] * (cz - mid[2]) > 0, 'rect: faces point into the abyss');
  }
  for (let f = .05; f < 1; f += .15) for (const y of [33.6, 35, 35.9]) {
    assert(coversPoint(tris, rect.minX, y, rect.minZ + rect.sizeZ * f, 'x') && coversPoint(tris, rect.minX + rect.sizeX, y, rect.minZ + rect.sizeZ * f, 'x'), 'rect: west/east sides closed');
    assert(coversPoint(tris, rect.minX + rect.sizeX * f, y, rect.minZ, 'z') && coversPoint(tris, rect.minX + rect.sizeX * f, y, rect.minZ + rect.sizeZ, 'z'), 'rect: north/south sides closed');
  }
}

// 1b. Thin-wall ends (doorway jambs) are capped across the full wall thickness, facing out along the run.
{
  const runs = Faces.mergeEdges([{ along:'x', line:4, from:0, to:3 }, { along:'x', line:4, from:6, to:9 }, { along:'z', line:2, from:1, to:5, side:1 }]);
  const data = Faces.buildEdgeCapQuads(runs, { y0:0, y1:3.6, thickness:.14 });
  const mesh = new Mesh(Faces.toGeometry(THREE, data), new Material());
  const tris = triangles(mesh);
  assert.equal(tris.length, 2 * 6, 'one cap per run end');
  for (const [x, dir] of [[0, -1], [3, 1], [6, -1], [9, 1]]) for (const off of [-.06, 0, .06]) for (const y of [.1, 1.8, 3.5])
    assert(coversPoint(tris, x, y, 4 + off, 'x'), `jamb at x=${x} closed (z offset ${off}, y ${y})`);
  assert(tris.filter(t => t.n[0] !== 0).every(t => { const x = t.v[0][0]; return t.n[0] === (x < 1 || (x > 5 && x < 7) ? -1 : 1); }), 'caps face away from their wall');
  for (const z of [1, 5]) assert(coversPoint(tris, 2, 1.8, z, 'z'), 'one-sided runs are capped too');
}

// 2. Jump-platform shaft (every tier) mounts a closed pit.
{
  const DS = { registerSurface() {}, registerPit() {}, clearScope() {} };
  const priorPatterns=globalThis.FurniturePatternSurfaces; // Restored after the Kanthic face-authoring integration checks.
  const authored=[]; // Captures the real shaft mount's calls into the existing surface-pattern renderer.
  globalThis.FurniturePatternSurfaces={applyPart(mesh,part){
    assert.equal(part.patternSurfaces.length,1,'one top-face rune treatment per slab, not layered duplicate sheets');
    assert.equal(part.patternSurfaces[0].selector,'top','the slab sides and underside remain plain carved stone');
    assert.equal(part.patternSurfaces[0].mode,'engraving','platform runes use the canonical emissive engraving path');
    const overlay=new Mesh({dispose(){this.disposed=true;}},{dispose(){this.disposed=true;}});
    overlay.userData.furniturePattern={slot:'top'};mesh.add(overlay);authored.push(overlay);
  }};
  for (const tier of ['cave', 'hole', 'lich']) for (const theme of ['tothal', 'hronal', 'kanthic']) {
    const o = Plan.tierOptions(tier);
    const plan = Jump.compose({ shaft:o.shaftSize, spacing:o.floorHeight, floors:o.floors, seed:11, theme, originX:40, originZ:60, baseY:0 });
    assert(plan.ok, `${tier}/${theme} jump plan`);
    const priorCount=authored.length;
    const parent = new Node(), runtime = Jump.mount(plan, { THREE, DynamicSurfaces:DS, parent, tradition:theme });
    const added=authored.slice(priorCount);
    assert.equal(added.length,theme==='kanthic'?plan.platforms.length:0,
      'every Kanthic rope/jump slab gets exactly one top rune; other traditions remain unchanged');
    assert.equal(runtime.getState().engravedPlatformTops,added.length,'mobile shaft diagnostics count active rune surfaces');
    const visualSlabs=[]; // Exercises the real mount, including Hronal and Tothal parity, before it is disposed.
    parent.traverse(node=>{if(node.userData?.ruinShaftPlatform===true)visualSlabs.push(node);});
    assert.equal(visualSlabs.length,plan.platforms.length,
      'every walkable shaft slab keeps its explicit platform-occlusion marker when geometries are stretched');
    const half = plan.central / 2;
    assertClosedPit(find(parent, 'jump-shaft-death-pit-walls'), { minX:plan.centre.x - half, minZ:plan.centre.z - half, size:plan.central, bottom:plan.pit.bottomY - .42, top:0 }, `${tier}/${theme} jump shaft`);
    runtime.dispose();
    assert(added.every(overlay=>!overlay.parent&&overlay.geometry.disposed&&overlay.material.disposed),
      'every Kanthic glyph overlay releases its geometry and material on shaft teardown');
    assert.equal(parent.children.length, 0, 'the walls leave with the shaft');
  }
  if(priorPatterns===undefined)delete globalThis.FurniturePatternSurfaces;
  else globalThis.FurniturePatternSurfaces=priorPatterns;
}

// 3. Reaching-obelisk shaft (dev Random Test Ruin) mounts a closed pit too.
{
  const plan = Obelisks.compose({ seed:91, shaft:45, wall:8, spacing:16, floors:3, balconySides:['N', 'E'], originX:100, originZ:100, baseY:0 });
  assert(plan.ok);
  const DS = { registerSurface() {}, clearScope() {} };
  const CS = { register:s => ({ ...s, enabled:true }), remove() {}, clearScope() {}, getAttachedSession:() => null };
  const parent = new Node();
  const rt = Obelisks.mount(plan, { THREE, parent, DynamicSurfaces:DS, ClimbSurfaces:CS, tradition:'hronal', getPlayerPosition:() => ({ x:0, z:0 }), getPlayerY:() => 0 });
  const size = 45 - 10, minX = 100 + 8 + 45 / 2 - size / 2;
  assertClosedPit(find(parent, 'obelisk-death-pit-walls'), { minX, minZ:minX, size, bottom:plan.pit.bottomY - .42, top:0 }, 'obelisk shaft');
  rt.dispose?.();
}

// 4. Ground-story wing doorways have a visible floor along their whole tunnel; upper doorways keep theirs.
{
  const SIDES = ['N', 'E', 'S', 'W'];
  for (const tier of ['cave', 'hole', 'lich']) for (const entranceSide of SIDES) {
    const o = Plan.tierOptions(tier);
    const portals = SIDES.filter(s => s !== entranceSide).map(side => ({ floor:0, side })).concat([{ floor:1, side:entranceSide }]);
    const hub = Hub.compose({ seed:5, floors:o.floors, chambers:false, wall:8, shaft:o.shaftSize, spacing:o.floorHeight,
      traversal:'jumpPlatforms', entranceSide, theme:'tothal', portals });
    assert(hub.ok, `${tier}/${entranceSide} hub`);
    const parent = new Node();
    Hub.mount(hub, { THREE, parent, scope:'test-holes' });
    const floor = triangles(find(parent, 'shaft-hub-octagonal-floor'));
    const ledges = triangles(find(parent, 'shaft-hub-ledges')).filter(t => t.n[1] > .5);
    const g = hub.grid;
    for (const portal of hub.wingPortals) for (const t of portal.tunnel) {
      const x = g.colToX(t.col + .5), z = g.rowToZ(t.row + .5), y = g.levelToY(portal.level);
      const surface = portal.level === 0 ? floor : ledges;
      assert(coversPoint(surface, x, y, z, 'y'), `${tier}/${entranceSide}: doorway ${portal.id} cell ${t.col},${t.row} has a floor`);
    }
    Hub.unmount({ scope:'test-holes' });
  }
}

// 5. The entrance hall from the ruin to the shaft has a ceiling over every cell, as tall as its walls.
{
  const Connector = require(docs('js/ruin-shaft-connector.js'));
  class Matrix4 { makeTranslation(x, y, z) { this.t = [x, y, z]; return this; } }
  class Plane extends Geometry { constructor(w, h) { super(); this.w = w; this.h = h; this.rx = 0; } rotateX(a) { this.rx += a; return this; } }
  class Box extends Geometry { constructor(w, h, d) { super(); Object.assign(this, { w, h, d }); } }
  class Instanced extends Mesh { constructor(g, m, n) { super(g, m); this.at = []; this.count = n; } setMatrixAt(i, m) { this.at[i] = m.t.slice(); } }
  class StoneMaterial extends Material { clone() { return new StoneMaterial(this); } }
  const T = { Group:Node, Mesh, InstancedMesh:Instanced, Matrix4, PlaneGeometry:Plane, BoxGeometry:Box, MeshBasicMaterial:StoneMaterial, FrontSide:0 };
  const tiles = [[10, 5], [10, 6], [11, 6], [12, 6]], parent = new Node();
  const dispose = Connector.corridorVisual(tiles, T, parent, 0, null);
  const hall = parent.children[0], roof = find(hall, 'ruin-corridor-ceiling'), walls = find(hall, 'ruin-corridor-east-west-walls');
  assert(roof, 'the hall has a ceiling');
  assert.equal(roof.count, tiles.length, 'one ceiling tile per hall cell');
  assert(Math.abs(roof.geometry.rx - Math.PI / 2) < 1e-9, 'ceiling tiles face down (see-through from the overhead camera)');
  tiles.forEach(([c, r], i) => assert.deepEqual(roof.at[i], [c + .5, Connector.CORRIDOR_HEIGHT, r + .5]));
  assert.equal(walls.geometry.h, Connector.CORRIDOR_HEIGHT, 'walls reach the ceiling');
  assert(Connector.CORRIDOR_HEIGHT > 2.35, 'the hall clears the V50 arch opening it starts from');
  assert.equal(roof.layers.mask & 2, 0, 'inked stone tile: no generated outline');
  dispose();
  // A one-cell hall leaving a three-cell doorway: the doorway's side cells are walled off from the room.
  const room = [], hallTiles = [[5, 9], [5, 8], [5, 7]];
  for (let x = 2; x < 9; x++) for (let z = 10; z < 14; z++) room.push(key2(x, z));
  const walk = new Set([...room, ...hallTiles.map(([c, r]) => key2(c, r))]);
  const parent2 = new Node();
  Connector.corridorVisual(hallTiles, T, parent2, 0, walk);
  const alongX = find(parent2.children[0], 'ruin-corridor-north-south-walls').at.map(p => p.join(','));
  for (const x of [4.5, 6.5]) assert(alongX.includes(x + ',1.2,10'), `the doorway side cell at x=${x - .5} is walled off from the room`);
  assert(!alongX.includes('5.5,1.2,10'), 'the hall itself stays open to the room');
}

// 6. Developer fly camera + enemy freeze (stub browser).
{
  const listeners = {}, scheduled = {}, storage = { hobunjiDevMode:'1' };
  const camera = {
    position:{ x:5, y:6, z:7, set(x, y, z) { this.x = x; this.y = y; this.z = z; } }, fov:42, look:null,
    getWorldDirection(v) { v.x = 0; v.y = 0; v.z = -1; return v; },
    lookAt(x, y, z) { this.look = [x, y, z]; }, updateMatrixWorld() {}, updateProjectionMatrix() {},
  };
  const locks = [];
  const window = {
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    RuntimeFrameScheduler:{ register(id, fn, opts) { scheduled[opts.phase] = fn; return () => {}; } },
    CharacterActionLocks:{ acquire(o) { const h = { o, release() { h.released = true; } }; locks.push(h); return h; } },
  };
  const document = { getElementById:() => null, createElement:() => ({ style:{}, dataset:{}, appendChild() {}, addEventListener() {} }), body:{ appendChild() {} } };
  const localStorage = { getItem:k => storage[k] ?? null };
  vm.runInNewContext(fs.readFileSync(docs('js/dev-inspect-tools.js'), 'utf8'), { window, document, localStorage, performance:{ now:() => 0 }, Math, Number, Set, Object, String });
  const T = window.DevInspectTools;
  const player = { x:0, y:0 };
  assert(T.init({ THREE:{ Vector3:THREE.Vector3 }, camera, renderer:{ domElement:{} }, player, TILE:32, getCurrentArea:() => 'farm', showToast() {} }));
  assert(scheduled['pre-game'] && scheduled['pre-render'], 'pose applied before gameplay and after the follow camera');
  assert.equal(T.ownsCamera(), false);
  const key = (type, code) => listeners[type].forEach(fn => fn({ type, code, repeat:false, target:null, preventDefault() {}, stopImmediatePropagation() {} }));
  key('keydown', 'F8');
  assert.equal(T.ownsCamera(), true, 'F8 starts flying');
  assert.equal(locks.length, 1, 'the player is locked while flying');
  assert.deepEqual([camera.position.x, camera.position.y, camera.position.z], [5, 6, 7], 'flying starts from the current view');
  key('keydown', 'KeyW');
  scheduled['pre-game']({ timestamp:1000 }); scheduled['pre-game']({ timestamp:1100 });
  assert(camera.position.z < 7 - .5, 'W flies along the view direction');
  key('keyup', 'KeyW'); key('keydown', 'Space');
  const y0 = camera.position.y; scheduled['pre-game']({ timestamp:1200 });
  assert(camera.position.y > y0, 'Space rises');
  key('keyup', 'Space');
  assert(T.lookFrom(1, 2, 3, 1, 2, 10, 70));
  scheduled['pre-render']({});
  assert.deepEqual([camera.position.x, camera.position.y, camera.position.z], [1, 2, 3]);
  assert(Math.abs(camera.look[2] - 4) < 1e-9 && camera.fov === 70, 'lookFrom aims the camera and keeps its fov over the follow rig');
  assert.equal(T.dropPlayer(), true, 'outside ruins the player is moved under the camera');
  assert.deepEqual([player.x, player.y], [32, 96]);
  assert.equal(T.ownsCamera(), false, 'dropping hands the camera back');
  assert.equal(locks[0].released, true, 'the player lock is released');
  key('keydown', 'F9');
  assert.equal(T.enemiesFrozen(), true, 'F9 freezes enemies');
  key('keydown', 'F9');
  assert.equal(T.enemiesFrozen(), false);
  storage.hobunjiDevMode = '0';
  key('keydown', 'F8');
  assert.equal(T.ownsCamera(), false, 'nothing happens without developer mode');
  assert.equal(T.setEnemiesFrozen(true), false);
}

// The freeze is honoured by every enemy owner.
for (const file of ['game.js', 'js/skeeri-ruins.js', 'js/ruin-wall-coffins.js', 'js/ruin-encounters.js'])
  assert(fs.readFileSync(docs(file), 'utf8').includes('DevInspectTools?.enemiesFrozen?.()'), file + ' honours Enemies off');

console.log('ruin shaft visual holes + dev inspect tools: ok');
