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
class SphereGeometry extends Geometry { constructor(radius, widthSegments, heightSegments) { super(); this.type = 'SphereGeometry'; this.parameters = { radius, widthSegments, heightSegments }; } }
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
  Color, BoxGeometry: Geometry, PlaneGeometry, BufferGeometry, SphereGeometry, MeshBasicMaterial, MeshLambertMaterial,
  Mesh, Group, InstancedMesh, Object3D, TextureLoader, WebGLRenderer,
  Vector3: class { set(x, y, z) { Object.assign(this, { x, y, z }); return this; } },
  MathUtils: { degToRad: n => n * Math.PI / 180 },
  NearestFilter: 'nearest', DoubleSide: 'double', sRGBEncoding: 'srgb',
};
const families = ['needlegrain', 'heftroot', 'garlink', 'ongyums', 'redberries', 'blueberries', 'yellowberries', 'whiteberries', 'blackberries', 'blackMustard', 'greenMustard']; // Same 11 canonical species as CropVarieties.FAMILIES.
const berryColors = { redberries: 0xff4f62, blueberries: 0x5f80ff, yellowberries: 0xffe86a, whiteberries: 0xffffff, blackberries: 0x17121f }; // Fruit hue of every native shrub.
const berryFamilies = Object.keys(berryColors); // Tests all native fruit colors and their regional/crossbred variants.
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
    buildShrubMesh() {
      const shrub = new Group(); // Simulates the existing cached foliage-generator bush (woody branches plus alpha-tested leaf cards).
      shrub.add(new Mesh(new Geometry(), new MeshLambertMaterial({ color: 0x4a3b33 })));
      const leaves = new Mesh(new PlaneGeometry(), new MeshBasicMaterial({ color: 0x52774f, alphaTest: .5, transparent: false }));
      leaves.userData.noOutline = true; // Preserve the foliage generator's correct PNG cutout policy.
      shrub.add(leaves);
      shrub.scale.setScalar(.96); // Tests that the crop renderer retains per-instance shrub size variation.
      return shrub;
    },
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
  cropDefs[key] = { growDays: 5, ...(family === 'greenMustard' ? {} : { baseCrop: family, varietyColor: pigmentFor(family) }) }; // Green mushtard intentionally exercises missing legacy family AND pigment fields.
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
const npcBerry = renderer.buildStandaloneCropMesh(cultivarFor('redberries'), .8, false, 12, 3); // Town/NPC farm plots use the same crop family and color metadata.
npcBerry.mesh.position.set(12.5, npcBerry.lift, 3.5); // NPC planting code applies the returned lift and half-tile world origin.
scene.add(npcBerry.mesh); // The normal authored-billboard discovery must include NPC fields, not just the player farm.
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
    if (berryFamilies.includes(family)) {
      for (const [crop, expectedColor] of [[native, berryColors[family]], [variant, pigmentFor(family)]]) {
        assert.equal(crop.userData.hobunjiFoliageMesh, true, family + ': planted crop is a real foliage bush');
        assert.equal(crop.userData.hobunjiBerryBush, true, family + ': shrub/fruit builder metadata is retained');
        assert.equal(crop.userData.hobunjiBerryFruitHex, expectedColor, family + ': native or inherited fruit pigment');
        assert.equal(crop.userData.hobunjiBerryFruitCount, 15, family + ': unripe mature bush has five three-berry clusters');
        assert.equal(crop.children.length, 2, family + ': one procedural shrub and one batched fruit mesh');
        const [shrub, fruit] = crop.children;
        assert.equal(shrub.children.length, 2, family + ': woody shrub has branches and transparent leaves');
        assert.equal(shrub.children[1].userData.noOutline, true, family + ': alpha-tested foliage excludes shell rendering');
        assert.equal(shrub.children[1].material.transparent, false, family + ': leaves render as stable alpha cutouts');
        assert.ok(shrub.scale.x < 0.6, family + ': native large bush scales to a cultivated single-tile footprint');
        assert.equal(fruit.userData.hobunjiBerryFruit, true, family + ': berries are attached to the bush');
        assert.equal(fruit.geometry.type, 'SphereGeometry', family + ': fruit is 3D, not floating berry sprite cards');
        assert.equal(fruit.count, 15, family + ': one instanced draw batch per bush');
        assert.equal(fruit.material.color.getHex(), expectedColor, family + ': every fruit uses the exact genotype RGB');
        assert.equal(fruit.userData.noOutline, true, family + ': berry spheres do not generate oversized outlines');
      }
    } else if (['needlegrain', 'heftroot', 'blackMustard', 'greenMustard'].includes(family)) {
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
      for (const [crop, expectedColor] of [[native, null], [variant, pigmentFor(family)]]) {
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

  assert.equal(npcBerry.mesh.userData.hobunjiBerryBush, true, 'NPC berry varieties grow true foliage bushes');
  assert.equal(npcBerry.mesh.children.length, 2, 'NPC berry bushes have woody foliage plus separate fruit');
  assert.equal(npcBerry.mesh.children[1].material.color.getHex(), pigmentFor('redberries'), 'NPC fruit inherits the exact crossbred pigment');
  assert.equal(unrelatedWhiteCube.geometry.type, 'BoxGeometry', 'untagged white scenery stays a cube, never a whiteberry plant');
  assert.equal(unrelatedWhiteCube.userData.hobunjiCropSpriteKey, undefined, 'unrelated scenery receives no crop identity');
  assert.ok(!fills.some(call => call.url.endsWith('berries.png')), 'world berry fruit uses 3D pigmented instances, not detached inventory PNGs');
  const redIndex = families.indexOf('redberries') * 2; // Native redberry plot used to exercise bush life-cycle transitions.
  grid[0][redIndex].cropReady = true;
  renderer.updateCropMeshes();
  assert.equal(renderer.cropMeshes[redIndex].userData.hobunjiBerryFruitCount, 30, 'ripe berry bush doubles its visible canopy fruit');
  assert.equal(renderer.cropMeshes[redIndex].rotation.y, 0, 'rooted berry bushes do not spin when harvestable');
  grid[0][redIndex].cropReady = false;
  grid[0][redIndex].cropAge = 1;
  renderer.updateCropMeshes();
  assert.equal(renderer.cropMeshes[redIndex].userData.hobunjiBerryFruitCount, 0, 'young berry bush is leafy but has no floating fruit');
  assert.equal(renderer.cropMeshes[redIndex].children.length, 1, 'young bush still has its foliage and wooden branch structure');
  const blueIndex = families.indexOf('blueberries') * 2 + 1; // Existing berry cultivar plot for same-species recolor replacement.
  const priorBlue = renderer.cropMeshes[blueIndex];
  const newBlue = 'cv_blueberries_222222_8054da'; // A different inherited purple-blue pigment on the same native shrub shape.
  cropDefs[newBlue] = { growDays: 5, baseCrop: 'blueberries', varietyColor: 0x8054da };
  grid[0][blueIndex].crop = newBlue;
  renderer.updateCropMeshes();
  assert.notEqual(renderer.cropMeshes[blueIndex], priorBlue, 'berry cultivar swaps rebuild the shrub and fruit colors');
  assert.equal(renderer.cropMeshes[blueIndex].children[1].material.color.getHex(), 0x8054da, 'new fruit instances display the new inherited RGB');
  const oldVariant = renderer.cropMeshes[1]; // Replanting within one species must not retain the previous cultivar texture.
  const newCultivar = 'cv_needlegrain_222222_129d86'; // Distinct genotype and RGB sharing the same needlegrain plant structure.
  cropDefs[newCultivar] = { growDays: 5, baseCrop: 'needlegrain', varietyColor: 0x129d86 }; // Saved seed data for an actual changed-color replant.
  grid[0][1].crop = newCultivar;
  renderer.updateCropMeshes();
  assert.notEqual(renderer.cropMeshes[1], oldVariant, 'same-species genotype replacement discards the prior cultivar mesh');
  assert.equal(renderer.cropMeshes[1].children[1].material.color.getHex(), 0x129d86, 'new same-species genotype has its actual inherited pigment');
  grid[0][1].crop = 'needlegrain';
  renderer.updateCropMeshes();
  assert.equal(renderer.cropMeshes[1].children[1].material.color.getHex(), 0x275b43, 'returning to native seed restores native grain shading');
  console.log('ok - all eleven crops preserve native silhouettes; berries are fruiting bushes with exact inherited RGB');
})().catch(error => { console.error(error); process.exitCode = 1; });
