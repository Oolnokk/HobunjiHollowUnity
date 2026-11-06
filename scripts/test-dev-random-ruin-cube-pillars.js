'use strict';
// Regression for js/dev-random-ruin-cube-pillars.js: V50's linked cube pairs are housed inside the
// arch posts (three compartments per post, one thin true cube in each) and given four distinct
// square icon faces. Runs the real module on a fake pair and arch shaped exactly like
// createLinkedDoorCubePair / createStoneArchFrame output.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class V { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } }
class Obj {
  constructor() { this.children = []; this.parent = null; this.position = new V(); this.rotation = new V(); this.scale = new V(1, 1, 1); this.userData = {}; }
  add(...items) { for (const item of items) { item.parent = this; this.children.push(item); } }
  remove(item) { this.children = this.children.filter(child => child !== item); item.parent = null; }
  traverse(fn) { fn(this); for (const child of [...this.children]) child.traverse(fn); }
}
class BoxGeometry { constructor(w, h, d) { this.parameters = { width:w, height:h, depth:d }; this.disposed = false; } dispose() { this.disposed = true; } }
class Mesh extends Obj { constructor(geometry, material) { super(); this.isMesh = true; this.geometry = geometry; this.material = material; } }
class PlaneGeometry { constructor(w, h) { this.w = w; this.h = h; this.disposed = false; } dispose() { this.disposed = true; } }
class Material { constructor(props = {}) { Object.assign(this, props); this.userData = {}; } }
const THREE = {
  PlaneGeometry, BoxGeometry, Mesh, Group: Obj, DoubleSide: 2, CanvasTexture: class { constructor(canvas) { this.canvas = canvas; } },
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

const TILE_SCALE = 2, CUBE = .44, POST_MATERIAL = { name:'post-stone' };
const CLEAR_H = 2.0915; // createStoneArchFrame(width, 2.35): 2.35 minus the lintel.

// A pair and its arch, shaped like V50's output: arch = [left post, right post, lintel] boxes, pair = 2 pillars x 3 segments.
function makePair(archWidth, { plainArch = true } = {}) {
  const shell = new Obj(), pair = new Obj(), door = new Obj(), arch = new Obj();
  const columnW = Math.max(.22, archWidth * .11), depth = .5;
  arch.userData.archFootprint = { width: archWidth, depth };
  if (plainArch) {
    for (const x of [-archWidth / 2 + columnW / 2, archWidth / 2 - columnW / 2]) {
      const post = new Mesh(new BoxGeometry(columnW, CLEAR_H, depth), POST_MATERIAL); post.position.set(x, CLEAR_H / 2, 0); arch.add(post);
    }
    const lintel = new Mesh(new BoxGeometry(archWidth, .2585, depth), POST_MATERIAL); lintel.position.set(0, CLEAR_H + .129, 0); arch.add(lintel);
  }
  door.position.set(10, 0, 5); arch.position.set(10, 0, 5);
  pair.position.set(10, 0, 5);
  pair.userData = { activatorType:'linkedCubePillars', rotatingSegments:[], linkedMechanismRoot:door, decalMaterials:['old'] };
  shell.add(pair, door, arch);
  for (let p = 0; p < 2; p++) {
    const pillar = new Obj(); pillar.position.x = (p === 0 ? -1 : 1) * 1.09; pair.add(pillar);
    for (let level = 0; level < 3; level++) {
      const segment = new Obj(); segment.position.y = level * .48; pillar.add(segment);
      const body = new Mesh(new BoxGeometry(CUBE, CUBE, CUBE), POST_MATERIAL); body.position.y = CUBE / 2;
      const cap = new Mesh(new BoxGeometry(CUBE * 1.12, .055, CUBE * 1.12), POST_MATERIAL); cap.position.y = CUBE + .0275; // V50's cap plate.
      segment.add(body, cap);
      if (level === 0) continue; // Structural base cube: no decals, not in rotatingSegments.
      for (let f = 0; f < 4; f++) { const plane = new Obj(); plane.userData = { furnitureDecal:true, decalIdentity:'face_' + f }; plane.geometry = new PlaneGeometry(.32, .2); plane.material = 'old'; segment.add(plane); }
      pair.userData.rotatingSegments.push({ segment, pillarIndex:p, level });
    }
  }
  return { shell, pair, arch };
}

const bounds = mesh => { // x/z of a housing box in arch units, with its half extents.
  const { width, depth } = mesh.geometry.parameters;
  return { x:mesh.position.x, y:mesh.position.y, halfW:width / 2, halfD:depth / 2, h:mesh.geometry.parameters.height };
};

for (const archWidth of [1.5, 2.5, 3.0]) {
  const { shell, pair, arch } = makePair(archWidth);
  const columnW = Math.max(.22, archWidth * .11), innerEdge = archWidth / 2 - columnW;
  assert.equal(Cubes.normalize(shell, { tileScale:TILE_SCALE }), 1, 'one pair normalised');

  // Both posts are now housings; the lintel remains and spans them. The opening between the posts is unchanged.
  const housings = arch.children.filter(child => child.name === 'ruin-cube-post-housing');
  assert.equal(housings.length, 2, `arch ${archWidth}: both posts rebuilt as housings`);
  assert.ok(!arch.children.some(child => child.isMesh && Math.abs(child.position.x) > archWidth * .3), 'the plain box posts are gone');
  const lintel = arch.children.find(child => child.isMesh);
  assert.ok(lintel && lintel.scale.x >= 1, 'lintel kept');
  const wide = Cubes.POST_WIDTH / TILE_SCALE;
  for (const housing of housings) {
    const boxes = housing.children.map(bounds);
    const inner = Math.abs(housing.position.x) - wide / 2; // Inner edge of the housing, in arch units.
    assert.ok(Math.abs(inner - innerEdge) < 1e-9, `arch ${archWidth}: the opening and door slab are unchanged`);
    assert.equal(boxes.length, 4, 'base block, two side walls and a cap block');
    const top = Math.max(...boxes.map(b => b.y + b.h / 2)), bottom = Math.min(...boxes.map(b => b.y - b.h / 2));
    assert.ok(Math.abs(top - CLEAR_H) < 1e-9 && Math.abs(bottom) < 1e-9, 'housing fills the full post height, floor to lintel');
  }

  // Three compartments per post, one cube each, resting on the base or the shelf below, with a shelf above.
  const pillars = [...new Set(pair.userData.rotatingSegments.map(entry => entry.segment.parent))].sort((a, b) => a.position.x - b.position.x);
  assert.equal(pillars.length, 2);
  pillars.forEach(pillar => {
    const housing = housings.find(h => Math.sign(h.position.x) === Math.sign(pillar.position.x));
    assert.ok(housing, 'each pillar has a housing on its side');
    assert.ok(Math.abs(pillar.position.x - housing.position.x) < 1e-9, `arch ${archWidth}: pillar sits exactly in its post`);
    const segments = pillar.children.filter(child => !child.isMesh), shelves = pillar.children.filter(child => child.isMesh);
    assert.equal(segments.length, Cubes.CELLS, 'three cubes');
    assert.equal(shelves.length, Cubes.CELLS, 'three shelves');
    const worldW = CUBE * pillar.scale.x * TILE_SCALE, worldH = CUBE * pillar.scale.y;
    assert.ok(Math.abs(worldW - worldH) < 1e-9, `arch ${archWidth}: cubes are true cubes (${worldW} x ${worldH})`);
    assert.ok(worldH * Math.SQRT2 <= Cubes.INNER_W - .03, 'a cube turning in its compartment sweeps its diagonal and still clears the walls');
    segments.forEach((segment, cell) => {
      assert.equal(segment.children.filter(child => child.isMesh).length, 1, 'the cap plate left the rotating cube: only the body turns');
      const cubeBottom = pillar.position.y + segment.position.y * pillar.scale.y;
      assert.ok(Math.abs(cubeBottom - (Cubes.BASE_H + cell * Cubes.CELL_H)) < 1e-9, `arch ${archWidth}: cube ${cell} rests on the base or the shelf below`);
    });
    shelves.forEach((shelf, cell) => {
      assert.equal(shelf.userData.devRuinCubeShelf, true);
      assert.equal(shelf.parent, pillar, 'a shelf is fixed to the pillar, not the turning cube');
      // World size: x/z carry the ruin tile scale and the pillar scale; the cap geometry is CUBE * 1.12 wide.
      const worldWidth = CUBE * 1.12 * shelf.scale.x * pillar.scale.x * TILE_SCALE, worldDepth = CUBE * 1.12 * shelf.scale.z * pillar.scale.x * TILE_SCALE;
      assert.ok(Math.abs(worldWidth - Cubes.INNER_W) < 1e-9, `shelf spans the slot wall to wall (${worldWidth})`);
      assert.ok(Math.abs(worldDepth - .5 * TILE_SCALE) < 1e-9, `and runs the full depth of the post (${worldDepth})`);
      const shelfTop = pillar.position.y + (shelf.position.y + .0275) * pillar.scale.y;
      assert.ok(Math.abs(shelfTop - (Cubes.BASE_H + (cell + 1) * Cubes.CELL_H)) < 1e-9, `shelf ${cell} closes compartment ${cell}`);
    });
  });
  assert.ok(CLEAR_H > Cubes.BASE_H + Cubes.WINDOW_H, 'the compartments fit under the lintel');

  // Symbols are square in the world, not stretched by the surface, with four distinct icons in one fixed order.
  const faceSets = [];
  const sx = pillars[0].scale.x * TILE_SCALE, sy = pillars[0].scale.y;
  for (const { segment } of pair.userData.rotatingSegments) {
    const planes = segment.children.filter(child => child.userData?.furnitureDecal);
    assert.equal(planes.length, 4);
    for (const plane of planes) {
      assert.equal(plane.geometry.w, plane.geometry.h, 'symbol plane is square in local space');
      assert.ok(Math.abs(plane.geometry.w * sx - plane.geometry.h * sy) < 1e-9, 'and square in the world');
      assert.ok(Math.abs(plane.geometry.w * sy - Cubes.SYMBOL_WORLD) < 1e-9, 'symbol edge is SYMBOL_WORLD');
    }
    assert.equal(new Set(planes.map(plane => plane.material)).size, 4, 'four distinct face materials per cube');
    assert.deepEqual(planes.map(plane => plane.userData.decalIdentity), Array.from(Cubes.FACES, face => 'cube_face_' + face.id), 'faces use the four icons in one fixed order');
    faceSets.push(planes.map(plane => plane.material));
  }
  const [first, ...rest] = faceSets;
  for (const other of rest) assert.deepEqual(other, first, 'all cubes carry the same icon on the same face');
  // V50 tints decalMaterials on solve: the replacements must be what renders, with tint colours.
  assert.deepEqual([...pair.userData.decalMaterials], first, 'decalMaterials are the materials on the planes');
  for (const material of pair.userData.decalMaterials) {
    assert.equal(material.userData.baseColor, '#ffffff');
    assert.equal(material.userData.activeColor, '#66aaff');
    assert.equal(material.side, 2, 'visible from both sides, like V50 decals');
  }
  assert.equal(Cubes.normalize(shell, { tileScale:TILE_SCALE }), 0, 'normalising twice does nothing');
}

// An arch that is not the plain three-box frame is left alone; the pair keeps V50's spot, pushed
// clear of the arch, and still gets true cubes and icons.
{
  const { shell, pair, arch } = makePair(2.5, { plainArch:false });
  assert.equal(Cubes.normalize(shell, { tileScale:TILE_SCALE }), 1);
  assert.equal(arch.children.length, 0, 'unrecognised arch untouched');
  const pillar = pair.userData.rotatingSegments[0].segment.parent;
  const capHalf = CUBE * 1.12 / 2 * pillar.scale.x;
  assert.ok(Math.abs(pillar.position.x) - capHalf >= 2.5 / 2 - 1e-9, 'fallback still clears the arch');
  assert.ok(Math.abs(CUBE * pillar.scale.x * TILE_SCALE - CUBE * pillar.scale.y) < 1e-9, 'still true cubes');
}

// A pair whose arch cannot be found still gets true cubes and icons, and keeps V50's spacing.
{
  const { shell, pair } = makePair(2.5);
  pair.userData.linkedMechanismRoot = null;
  assert.equal(Cubes.normalize(shell, { tileScale:TILE_SCALE }), 1);
  const pillar = pair.userData.rotatingSegments[0].segment.parent;
  assert.equal(Math.abs(pillar.position.x), 1.09, 'no arch found: spacing untouched');
  assert.ok(Math.abs(CUBE * pillar.scale.x * TILE_SCALE - CUBE * pillar.scale.y) < 1e-9, 'still true cubes');
}

console.log('dev random ruin cube pillars regression passed');
