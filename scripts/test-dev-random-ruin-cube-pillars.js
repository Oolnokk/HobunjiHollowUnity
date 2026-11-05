'use strict';
// Regression for js/dev-random-ruin-cube-pillars.js: V50's linked cube pairs are respaced to clear
// their arch, rescaled into true cubes, and given four distinct square icon faces. Runs the real
// module on a fake pair shaped exactly like createLinkedDoorCubePair's output.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class V { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } }
class Obj {
  constructor() { this.children = []; this.parent = null; this.position = new V(); this.scale = new V(1, 1, 1); this.userData = {}; }
  add(...items) { for (const item of items) { item.parent = this; this.children.push(item); } }
  traverse(fn) { fn(this); for (const child of [...this.children]) child.traverse(fn); }
}
class PlaneGeometry { constructor(w, h) { this.w = w; this.h = h; this.disposed = false; } dispose() { this.disposed = true; } }
class Material { constructor(props = {}) { Object.assign(this, props); this.userData = {}; } }
const THREE = {
  PlaneGeometry, DoubleSide: 2, CanvasTexture: class { constructor(canvas) { this.canvas = canvas; } },
  MeshBasicMaterial: Material,
};
const loads = [];
const ctx = new Proxy({}, { get: () => () => {}, set: () => true }); // Canvas 2D stub: every call is a no-op.
const window = { THREE };
window.window = window;
const context = vm.createContext({
  window, THREE, console,
  document: { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) },
  Image: class { set src(value) { loads.push(value); } },
});
vm.runInContext(fs.readFileSync('docs/js/dev-random-ruin-cube-pillars.js', 'utf8'), context, { filename: 'dev-random-ruin-cube-pillars.js' });
const Cubes = window.DevRandomRuinCubePillars;
assert.ok(Cubes?.normalize, 'module exports normalize');
assert.equal(Cubes.FACES.length, 4);
assert.equal(new Set(Cubes.FACES.map(face => face.file)).size, 4, 'four distinct icon files');
assert.equal(loads.length, 4, 'all four PNGs start loading at module load');
for (const url of loads) assert.ok(/^assets\/hud\/generic_icons\/icon_\w+\.png$/.test(url), 'icons come from the shared UI icon folder: ' + url);

const TILE_SCALE = 2, CUBE = .44;
// A pair shaped like createLinkedDoorCubePair: root > 2 pillars > 3 segments (level 0 structural),
// each active segment carrying body, cap and four face decal planes.
function makePair(archWidth, halfSeparation = 1.09) {
  const shell = new Obj(), pair = new Obj(), door = new Obj(), arch = new Obj();
  arch.userData.archFootprint = { width: archWidth, depth: .5 };
  door.position.set(10, 0, 5); arch.position.set(10, 0, 5);
  pair.userData = { activatorType:'linkedCubePillars', rotatingSegments:[], linkedMechanismRoot:door, decalMaterials:['old'] };
  shell.add(pair, door, arch);
  for (let p = 0; p < 2; p++) {
    const pillar = new Obj(); pillar.position.x = (p === 0 ? -1 : 1) * halfSeparation; pair.add(pillar);
    for (let level = 0; level < 3; level++) {
      const segment = new Obj(); pillar.add(segment);
      if (level === 0) continue; // Structural base cube: no decals, not in rotatingSegments.
      for (let f = 0; f < 4; f++) { const plane = new Obj(); plane.userData = { furnitureDecal:true, decalIdentity:'face_' + f }; plane.geometry = new PlaneGeometry(.32, .2); plane.material = 'old'; segment.add(plane); }
      pair.userData.rotatingSegments.push({ segment, pillarIndex:p, level });
    }
  }
  return { shell, pair };
}

const faceSets = [];
for (const archWidth of [1.5, 2.5, 3.0]) {
  const { shell, pair } = makePair(archWidth);
  assert.equal(Cubes.normalize(shell, { tileScale:TILE_SCALE }), 1, 'one pair normalised');
  const pillars = [...new Set(pair.userData.rotatingSegments.map(entry => entry.segment.parent))];
  assert.equal(pillars.length, 2);
  for (const pillar of pillars) {
    // World size of a cube edge: x/z are expanded by the ruin's tile scale, y is not.
    const worldW = CUBE * pillar.scale.x * TILE_SCALE, worldH = CUBE * pillar.scale.y;
    assert.ok(Math.abs(worldW - worldH) < 1e-9, `arch ${archWidth}: cubes are true cubes (${worldW} x ${worldH})`);
    // The cap is the widest part: it must clear the arch's outer edge.
    const capHalf = CUBE * 1.12 / 2 * pillar.scale.x;
    assert.ok(Math.abs(pillar.position.x) - capHalf >= archWidth / 2 - 1e-9, `arch ${archWidth}: pillar at ${pillar.position.x} clears the arch`);
    assert.ok(Math.abs(pillar.position.x) >= 1.09 - 1e-9, 'spacing only ever moves outward');
  }
  // Symbols are square in the world, not stretched by the surface.
  const sx = pillars[0].scale.x * TILE_SCALE, sy = pillars[0].scale.y;
  for (const { segment } of pair.userData.rotatingSegments) {
    const planes = segment.children;
    assert.equal(planes.length, 4);
    for (const plane of planes) {
      assert.equal(plane.geometry.w, plane.geometry.h, 'symbol plane is square in local space');
      assert.ok(Math.abs(plane.geometry.w * sx - plane.geometry.h * sy) < 1e-9, 'and square in the world');
      assert.ok(Math.abs(plane.geometry.w * sy - Cubes.SYMBOL_WORLD) < 1e-9, 'symbol edge is SYMBOL_WORLD');
    }
    assert.equal(new Set(planes.map(plane => plane.material)).size, 4, 'four distinct face materials per cube');
    assert.deepEqual(planes.map(plane => plane.userData.decalIdentity), Array.from(Cubes.FACES, face => 'cube_face_' + face.id), 'faces use the four icons in one fixed order');
  }
  faceSets.push(pair.userData.rotatingSegments.map(entry => entry.segment.children.map(plane => plane.material)));
  // Every cube in the pair shares the same four materials, so "same face out" means solved.
  const [first, ...rest] = faceSets.at(-1);
  for (const other of rest) assert.deepEqual(other, first, 'all cubes carry the same icon on the same face');
  // V50 tints decalMaterials on solve: the replacements must be what renders, with tint colours.
  assert.equal(pair.userData.decalMaterials.length, 4);
  assert.deepEqual([...pair.userData.decalMaterials], first, 'decalMaterials are the materials on the planes');
  for (const material of pair.userData.decalMaterials) {
    assert.equal(material.userData.baseColor, '#ffffff');
    assert.equal(material.userData.activeColor, '#66aaff');
    assert.equal(material.side, 2, 'visible from both sides, like V50 decals');
  }
  assert.equal(Cubes.normalize(shell, { tileScale:TILE_SCALE }), 0, 'normalising twice does nothing');
}

// A pair whose arch cannot be found still gets true cubes and icons, but keeps its spacing.
{
  const { shell, pair } = makePair(2.5);
  pair.userData.linkedMechanismRoot = null;
  assert.equal(Cubes.normalize(shell, { tileScale:TILE_SCALE }), 1);
  const pillar = pair.userData.rotatingSegments[0].segment.parent;
  assert.equal(Math.abs(pillar.position.x), 1.09, 'no arch found: spacing untouched');
  assert.ok(Math.abs(CUBE * pillar.scale.x * TILE_SCALE - CUBE * pillar.scale.y) < 1e-9, 'still true cubes');
}

console.log('dev random ruin cube pillars regression passed');
