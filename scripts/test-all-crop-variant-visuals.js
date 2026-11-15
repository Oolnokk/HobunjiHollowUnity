#!/usr/bin/env node
'use strict';

// Exercise the actual farm foliage renderer and PNG-crop bridge for every
// native/variant species, including alpha cutouts, shade-fill and replanting.
const assert = require('node:assert/strict'); // Used to assert that real rendered mesh types and pigment match the crop genome.
const fs = require('node:fs'); // Reads the shipped modules instead of making a second test-specific crop renderer.
const path = require('node:path'); // Resolves the real module paths from the script runner.
const vm = require('node:vm'); // Runs the browser classic scripts against minimal deterministic Three.js fakes.

class Color {
  constructor(hex = 0xffffff) { this.hex = hex; }
  setHex(hex) { this.hex = hex; return this; }
  getHex() { return this.hex; }
  setHSL() { return this; }
  lerp(other, ratio) { this.hex = Math.round(this.hex * (1 - ratio) + other.hex * ratio); return this; }
}
class Geometry {
  constructor(width = 1, height = 1, depth = 1) {
    this.type = 'BoxGeometry'; this.parameters = { width, height, depth };
    this.boundingSphere = { center: { set() {} }, radius: 0 };
  }
  translate() { return this; }
  getAttribute() { return { count: 3, getX: i => i / 2 - .5, getY: i => i / 2, setXYZ() {}, needsUpdate: false }; }
  computeVertexNormals() {}
  computeBoundingSphere() {}
  dispose() {}
}
class PlaneGeometry extends Geometry { constructor(...args) { super(...args); this.type = 'PlaneGeometry'; } }
class BufferGeometry extends Geometry { constructor() { super(); this.type = 'BufferGeometry'; } }
class Material {
  constructor(def = {}) { Object.assign(this, def); this.color = new Color(def.color instanceof Color ? def.color.getHex() : def.color ?? 0xffffff); }
  clone() { return new this.constructor({ ...this, color: this.color.getHex() }); }
  dispose() {}
}
class MeshBasicMaterial extends Material {}
class MeshLambertMaterial extends Material { constructor(def) { super(def); this.isMeshLambertMaterial = true; } }
function vector() { return { x: 0, y: 0, z: 0, set(x, y, z) { Object.assign(this, { x, y, z }); }, setScalar(s) { this.set(s, s, s); } }; }
class Group {
  constructor() {
    this.userData = {}; this.children = []; this.parent = null; this.position = vector(); this.scale = vector();
    this.scale.setScalar(1); this.rotation = { y: 0, set(x, y, z) { this.y = y; } };
    this.quaternion = { copy() { return this; }, identity() { return this; } };
  }
  add(child) { this.children.push(child); child.parent = this; }
  remove(child) { this.children = this.children.filter(obj => obj !== child); if (child.parent === this) child.parent = null; }
  traverse(callback) { callback(this); for (const child of this.children.slice()) child.traverse(callback); }
}
class Mesh extends Group {
  constructor(geometry, material) { super(); this.isMesh = true; this.geometry = geometry; this.material = material; this.layers = { outline: false, enable(id) { if (id === 1) this.outline = true; } }; }
}
class InstancedMesh extends Mesh {
  constructor(geometry, material, count) { super(geometry, material); this.count = count; this.instanceMatrix = { needsUpdate: false }; }
  setMatrixAt() {}
}
class Object3D extends Group {
  constructor() { super(); this.matrix = {}; }
  rotateY() {}
  updateMatrix() {}
}
class TextureLoader {
  load(url, onLoad) {
    const texture = { image: { width: 76, height: 153, url } }; // Authored dimensions and alpha map are represented by the texture source reference.
    if (!url.endsWith('grass_1.png')) onLoad?.(texture); // The grass setup is unrelated to crop rendering in this test.
    return texture;
  }
}
class WebGLRenderer { render() { return true; } }
const THREE = {
  Color, BoxGeometry: Geometry, PlaneGeometry, BufferGeometry, MeshBasicMaterial, MeshLambertMaterial,
  Mesh, Group, InstancedMesh, Object3D, TextureLoader, WebGLRenderer,
  Vector3: class { set(x, y, z) { Object.assign(this, { x, y, z }); return this; } },
  MathUtils: { degToRad: n => n * Math.PI / 180 },
  NearestFilter: 'nearest', DoubleSide: 'double', sRGBEncoding: 'srgb',
};
const families = ['needlegrain', 'heftroot', 'garlink', 'ongyums', 'redberries', 'blueberries', 'yellowberries', 'whiteberries', 'blackberries', 'blackMustard', 'greenMustard']; // Same 11 canonical species as CropVarieties.FAMILIES.
const berryColors = { redberries: 0xff4f62, blueberries: 0x5f80ff, yellowberries: 0xffe86a, whiteberries: 0xffffff, blackberries: 0x17121f }; // Native berry silhouettes must also get a color fill.
const pigmentFor = family => family === 'whiteberries' ? 0x8234a7 : 0xba7142; // Two visibly distinct inherited palettes, including nonnative whiteberries.
const cultivarFor = family => 'cv_' + family + '_111111_' + pigmentFor(family).toString(16).padStart(6, '0'); // Saved genotype key follows the real registrar's current format.
const fills = []; // Collects the production shade-fill calls and their source art so no crop family silently skips its tint.
const window = {
  THREE,
  SpriteRecolor: {
    getRecoloredCanvas(url, color, mode) {
      fills.push({ url, color, mode });
      return Promise.resolve({ width: 76, height: 153, color, url });
    },
  },
  HobunjiSpritePngSurface: {
    makeCanvasTexture(_THREE, canvas) { return { image: canvas, needsUpdate: true }; },
    alphaTest() { return .04; },
  },
  CropVarieties: {
    ensure: key => key.startsWith('cv_') ? { family: families.find(f => key.startsWith('cv_' + f + '_')), color: pigmentFor(families.find(f => key.startsWith('cv_' + f + '_'))) } : null,
    produceFamily: key => families.find(f => key === f || key.startsWith('cv_' + f + '_')) || null,
    colorOf: key => pigmentFor(families.find(f => key.startsWith('cv_' + f + '_'))),
  },
  FoliageGenerator: {
    buildNeedlegrainMesh() { const root = new Group(); root.add(new Mesh(new Geometry(), new MeshBasicMaterial({ color: 0x60482f }))); root.add(new Mesh(new Geometry(), new MeshBasicMaterial({ color: 0x275b43 }))); return root; },
    buildHeftrootMesh() {
      const root = new Group();
      const sprite = new Mesh(new PlaneGeometry(), new MeshBasicMaterial({ map: { image: { url: 'assets/objectsprites/heftroot.png' } }, color: 0xffffff }));
      sprite.userData.hobunjiHeftrootBillboard = true; sprite.userData.noOutline = true;
      root.add(sprite); return root;
    },
  },
};
const context = vm.createContext({ window, THREE, performance: { now: () => 1000 }, Math, Map, Set, console }); // Runs both modules with their real side effects.
for (const relative of ['docs/js/vegetation-crop-rendering.js', 'docs/js/crop-sprite-art.js']) {
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '..', relative), 'utf8'), context, { filename: relative });
}
const renderer = window.VegetationCropRendering; // Real player-farm renderer, not an isolated reconstructed geometry builder.
const cropDefs = {}; // Game-like crop data for both native and saved variants, with one deliberately missing legacy baseCrop.
const grid = [families.flatMap(family => {
  const native = { crop: family, type: 'tilled', water: 0, cropAge: 5, cropReady: false };
  const key = cultivarFor(family);
  cropDefs[family] = { growDays: 5 };
  cropDefs[key] = { growDays: 5, varietyColor: pigmentFor(family), ...(family === 'greenMustard' ? {} : { baseCrop: family }) };
  const variant = { crop: key, type: 'tilled', water: 0, cropAge: 5, cropReady: false };
  return [native, variant];
})];
const scene = new Group(); // Farm scene accepts native and regional crops as direct children.
renderer.init({
  COLS: grid[0].length, ROWS: 1, cropData: cropDefs, getGrid: () => grid, scene, WATER_UNIT: .1,
  tileSurfaceY: () => 0,
  markOutline(root) { root.traverse(child => { if (child.isMesh && !child.userData.noOutline) child.layers.enable(1); }); },
});
renderer.updateCropMeshes();
const unrelatedWhiteCube = new Mesh(new Geometry(), new MeshLambertMaterial({ color: 0xffffff })); // Non-crop scenery deliberately shares a whiteberries growth color.
unrelatedWhiteCube.position.set(.5, .5, .5); // Matches the old color-only crop detector's tile-centred position and height.
unrelatedWhiteCube.scale.setScalar(.5); // Keeps the exact uniform scale expected of a partially grown crop.
scene.add(unrelatedWhiteCube); // The production scanner must not silently turn unrelated scenery into a berry cluster.
const camera = { quaternion: {} };
const fullRender = new THREE.WebGLRenderer();
async function flush() { for (let i = 0; i < 4; i++) await Promise.resolve(); } // Gives shade-fill and its loaded GPU texture a chance to resolve.
(async () => {
  fullRender.render(scene, camera); // Crop-sprite-art discovers generic cubes and swaps them for PNG cards.
  await flush();
  fullRender.render(scene, camera);
  await flush();

  for (let i = 0; i < families.length; i++) {
    const family = families[i];
    const native = renderer.cropMeshes[i * 2], variant = renderer.cropMeshes[i * 2 + 1]; // One native and one inherited tile per species.
    assert.equal(native.userData.hobunjiCropRootKey, family, family + ': native base family');
    assert.equal(variant.userData.hobunjiCropRootKey, family, family + ': inherited base family');
    assert.equal(variant.userData.hobunjiCropId, cultivarFor(family), family + ': saved cultivar identity');
    if (['needlegrain', 'heftroot', 'blackMustard', 'greenMustard'].includes(family)) {
      assert.equal(variant.userData.hobunjiFoliageMesh, true, family + ': authored non-cube crop geometry');
      assert.equal(native.userData.hobunjiFoliageMesh, true);
      if (family === 'needlegrain') {
        assert.equal(variant.children[1].material.color.getHex(), pigmentFor(family), 'grain needles fully inherit RGB; bark remains original');
        assert.equal(variant.children[0].material.color.getHex(), 0x60482f, 'needles do not recolor the supporting wood');
      } else {
        const leaves = [];
        variant.traverse(node => { if (node.userData.hobunjiMustardLeaf || node.userData.hobunjiHeftrootBillboard) leaves.push(node); });
        assert.ok(leaves.length, family + ': original planted sprite components are retained');
        for (const leaf of leaves) {
          assert.equal(leaf.material.map?.image?.color, pigmentFor(family), family + ': full color-fill texture, not a multiplied green base');
          assert.equal(leaf.material.color.getHex(), 0xffffff, family + ': completed shade-fill uses neutral material tint');
          assert.equal(leaf.userData.noOutline, true, family + ': transparent leaf cutouts are excluded from the opaque shell pass');
        }
      }
    } else {
      for (const [crop, expectedColor] of [[native, berryColors[family] ?? null], [variant, pigmentFor(family)]]) {
        assert.equal(crop.geometry.type, 'BufferGeometry', family + ': source placeholder cube is now an invisible anchor');
        assert.equal(crop.children.length, 3, family + ': three authored fruit or vegetable planes');
        for (const child of crop.children) {
          assert.equal(child.userData.noOutline, true, family + ': PNG silhouette does not get a black rectangle outline');
          assert.equal(child.layers.outline, false, family + ': transparent pixels are not in the shell pass');
          assert.equal(child.material.transparent, false, family + ': cutouts avoid transparent-card sorting glitches');
          if (expectedColor != null) {
            assert.equal(child.material.map?.image?.color, expectedColor, family + ': native/variant sprite is fully recolored');
            assert.equal(child.material.color.getHex(), 0xffffff, family + ': pixel fill is not double tinted');
          }
        }
      }
    }
  }

  assert.equal(unrelatedWhiteCube.geometry.type, 'BoxGeometry', 'untagged white scenery stays a cube, never a whiteberry plant');
  assert.equal(unrelatedWhiteCube.userData.hobunjiCropSpriteKey, undefined, 'unrelated scenery receives no crop identity');
  assert.ok(fills.some(call => call.url.endsWith('berries.png') && call.color === pigmentFor('whiteberries')),
    'berry variants use authored fruit pixels rather than a colored cube');
  const oldVariant = renderer.cropMeshes[1]; // Replanting a new color within one species must not retain the previous texture.
  grid[0][1].crop = 'needlegrain';
  renderer.updateCropMeshes();
  assert.notEqual(renderer.cropMeshes[1], oldVariant, 'same-tile crop replacement discards the prior cultivar mesh');
  console.log('ok - all eleven crops preserve native silhouettes and render inherited colors across foliage and PNG world meshes');
})().catch(error => { console.error(error); process.exitCode = 1; });
