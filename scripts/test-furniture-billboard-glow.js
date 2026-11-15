'use strict';
// Exercises the actual authored runtime and procedural billboard constructor without a WebGL context.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..'); // Repository root for original runtime files and authored fixture.
const read = file => fs.readFileSync(path.join(root, file), 'utf8'); // Same source browser scripts execute.

class Vector {
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
}
class Quaternion {
  identity() { this.value = 'identity'; return this; }
  copy(other) { this.value = 'copy:' + other.value; return this; }
  invert() { this.value = 'inverse'; return this; }
  multiply(other) { this.value = 'multiply:' + other.value; return this; }
}
class Object3D {
  constructor(geometry, material) {
    this.geometry = geometry; this.material = material;
    this.position = new Vector(); this.rotation = new Vector(); this.quaternion = new Quaternion();
    this.scale = new Vector(); this.children = []; this.userData = {}; this.parent = null; this.visible = true;
  }
  add(...objects) { for (const object of objects) { this.children.push(object); object.parent = this; } }
  remove(object) { this.children = this.children.filter(child => child !== object); object.parent = null; }
  updateMatrixWorld() { this.matrixUpdated = true; }
  rotateZ(radians) { this.lastScreenRoll = radians; }
}
class PlaneGeometry {
  constructor(width, height) { this.width = width; this.height = height; }
  toNonIndexed() { return this; }
}
class Material {
  constructor(settings) { Object.assign(this, settings); this.color = { value: settings.color, set: value => { this.color.value = value; } }; }
  dispose() { this.disposed = true; }
}
class Sprite extends Object3D {
  constructor(material) { super(null, material); }
}
const THREE = { // Minimal Three interfaces exercised by the two real constructors.
  Quaternion, PlaneGeometry, Mesh: Object3D, Group: Object3D, Sprite,
  MeshBasicMaterial: Material, SpriteMaterial: Material,
  TextureLoader: class {}, CanvasTexture: class {}, Matrix4: class {}, Vector3: Vector, Color: class {},
  DoubleSide: 2, AdditiveBlending: 3,
};
const proceduralWindow = {}; // The source's IIFE installs its actual exports on this window.
vm.runInNewContext(read('docs/js/procedural-furniture.js'), { window: proceduralWindow, THREE });
const fixture = JSON.parse(read('docs/config/furniture-authored/glowGlyphOrb.json')); // Actual catalog object under test.
const part = fixture.parts[0]; // The preset's transparent surface definition.
const plane = proceduralWindow.ProceduralFurniture.buildPartMesh(part, 0xffffff);
assert.equal(plane.geometry.width, .325);
assert.equal(plane.geometry.height, .325);
assert.equal(plane.material.opacity, 0, 'surface mesh is invisible instead of hiding its child decals');
assert.equal(plane.material.depthWrite, false, 'transparent plane does not occlude its decals');
assert.equal(plane.renderOrder, -1, 'camera hook runs before transparent decal render');
assert.equal(plane.userData.billboardSurface, true);
assert.equal(plane.frustumCulled, false, 'edge-on parent remains renderable for its child');
const parent = { getWorldQuaternion(quaternion) { quaternion.value = 'parent'; } }; // Simulates the authored furniture transform.
const camera = { getWorldQuaternion(quaternion) { quaternion.value = 'camera'; } }; // Faces the plane from another viewing direction.
plane.parent = parent;
plane.onBeforeRender(null, null, camera);
assert.equal(plane.matrixUpdated, true);
assert.equal(plane.lastScreenRoll, 0);
const rotatedPart = { ...part, transform: { ...part.transform, rz: 45 } }; // Editor-authored screen-space artwork roll.
const rotated = proceduralWindow.ProceduralFurniture.buildPartMesh(rotatedPart, 0xffffff);
rotated.onBeforeRender(null, null, camera);
assert.ok(Math.abs(rotated.lastScreenRoll - Math.PI / 4) < 1e-9);

let canvasCreations = 0; // A single shared alpha mask must serve every glow instance.
const document = {
  createElement() {
    canvasCreations++;
    return { getContext() { return { createRadialGradient() { return { addColorStop() {} }; }, fillRect() {} }; } };
  },
};
const authoredWindow = {}; // Runtime exported from the real authored-furniture script.
vm.runInNewContext(read('docs/js/authored-furniture-runtime.js'), { window: authoredWindow, THREE, document });
const group = new Object3D(), attachedPart = new Object3D(); // The glow is a child of the billboard's transform.
group.userData.meshById = new Map([[part.id, attachedPart]]);
const emitter = fixture.particleEmitters[0]; // The saved fixture, not a hardcoded second emitter.
const fx = authoredWindow.AuthoredFurniture.createEmitterVisual(group, emitter);
assert.equal(fx.points.parent.parent, attachedPart, 'stationary glow is attached to the authored surface');
assert.equal(fx.points.scale.x, emitter.size);
assert.equal(fx.points.parent.children.length, 2, 'core and halo use only two sprites');
fx.update(0, false);
assert.equal(fx.points.parent.visible, false, 'emitter can be turned off');
fx.update(0, true, { size: .8, colorA: '#00ff00', colorB: '#ff0000', enabled: true });
assert.equal(fx.points.parent.visible, true);
assert.equal(fx.points.scale.x, .8);
assert.equal(fx.points.material.color.value, '#ff0000');
const material = fx.points.material; // Must be disposed on removal, keeping the shared texture.
fx.dispose();
assert.equal(attachedPart.children.length, 0);
assert.equal(material.disposed, true);
authoredWindow.AuthoredFurniture.createEmitterVisual(group, emitter).dispose();
assert.equal(canvasCreations, 1, 'radial texture is cached rather than regenerated for each furniture instance');

const index = JSON.parse(read('docs/config/furniture-authored/index.json')); // Catalog wiring guard.
assert.ok(index.furniture.some(entry => entry.key === fixture.key), 'orb is included in authored furniture index');
assert.equal(fixture.decals[0].surfacePartId, part.id, 'transparent glyph is attached to the billboard');
assert.equal(fixture.decals[0].surfaceId, fixture.recognizedSurfaces[0].id);
console.log('PASS furniture billboard surface and stationary glowing sphere');
