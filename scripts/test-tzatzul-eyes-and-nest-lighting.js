#!/usr/bin/env node
'use strict';
// Regressions for adult/hatchling two-sided eye meshes and nest-only visibility.
const assert = require('node:assert/strict'); // Verifies the actual shared renderer's runtime meshes and lighting policy.
const fs = require('node:fs'); // Loads the shipping modules, not duplicated renderer logic.
const vm = require('node:vm'); // Exercises browser IIFEs with a lightweight Three.js surrogate.

class Vec {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
}
class Node {
  constructor() {
    this.children = []; this.position = new Vec(); this.rotation = new Vec();
    this.userData = {}; this.visible = true; this.parent = null;
  }
  add(child) { child.parent = this; this.children.push(child); }
  remove(child) { this.children = this.children.filter(item => item !== child); child.parent = null; }
  worldToLocal(vector) { return vector; }
}
class Geometry {
  constructor(width, height) {
    this.parameters = { width, height };
    this.attributes = {
      position: { count: 8, setXYZ() {} },
      uv: { getY: () => 0.5, getX: () => 0.5, setX() {} },
    };
  }
  computeVertexNormals() {}
  computeBoundingSphere() {}
  setAttribute() {}
  dispose() {}
}
class Mesh extends Node {
  constructor(geometry, material) { super(); this.geometry = geometry; this.material = material; this.isMesh = true; }
}
class SkinnedMesh extends Mesh {
  bind(skeleton) { this.skeleton = skeleton; }
}
class Skeleton {
  constructor(bones) { this.bones = bones; }
  dispose() {}
}
const THREE = {
  Group: Node, Bone: Node, Mesh, SkinnedMesh, Skeleton, PlaneGeometry: Geometry,
  Uint16BufferAttribute: class {}, Float32BufferAttribute: class {},
  Vector3: Vec, FrontSide: 'front', BackSide: 'back', DoubleSide: 'double',
}; // The production renderer's essential geometry/face contracts.
const textures = []; // Tracks open and blink texture allocation/disposal.
const surface = {
  makeCanvasTexture(_three, image, name) {
    const texture = { image, name, disposed: false, dispose() { this.disposed = true; } };
    textures.push(texture); return texture;
  },
  makeMaterial(_three, texture, name, overrides = {}) {
    return { name, map: texture, side: THREE.DoubleSide, color: { set() {}, getHexString: () => 'ffffff' },
      ...overrides, dispose() { this.disposed = true; } };
  },
}; // Uses the canonical sprite material builder in production, with camera-face flags recorded.
const win = { THREE, HobunjiSpritePngSurface: surface, PerpRotation: {
  perpClamp: () => ({ effectiveTarget: 0 }),
} }; // Supplies only existing renderer dependencies; no browser or GPU required.
vm.runInNewContext(fs.readFileSync('docs/js/flying-animal-rig.js', 'utf8'), { window: win, console });
const img = { width: 1617, height: 1000 }; // Shared source-space dimensions for the mother's authored eye art.
const images = { flying: img, perched: img, wings: img, eyes: img, blink: img }; // The adult and hatchling use the same eye/rig assets.
const rig = win.FlyingAnimalRig.create({}, images); // Constructs the actual runtime mesh assembly, without perch editing.
const eyes = rig.pitch.children.filter(mesh => mesh.userData.flyingAnimalEyeOverlay);
assert.equal(eyes.length, 6, 'each of the three poses must have front and rear eye layers');
assert.equal(eyes.filter(mesh => mesh.material.side === THREE.FrontSide).length, 3);
assert.equal(eyes.filter(mesh => mesh.material.side === THREE.BackSide).length, 3);
assert.deepEqual(eyes.map(mesh => mesh.position.z), [.004, .004, .004, -.004, -.004, -.004],
  'rear face has the opposite depth offset, rather than being hidden beneath the opaque body');
const camera = { getWorldPosition(vec) { vec.set(0, 1, 3); } }; // Camera facing is irrelevant to paired visibility and blink state.
for (const [pose, carrying] of [['perched', false], ['flap', false], ['glide', true]]) {
  rig.update(camera, pose, 0.2, carrying, false);
  assert.equal(eyes.filter(mesh => mesh.visible).length, 2, pose + ': two eye layers should remain active');
  const visibleEyes = eyes.filter(mesh => mesh.visible);
  assert.equal(visibleEyes[0].geometry, visibleEyes[1].geometry,
    pose + ': front/back eyes follow the identical pose-deformed geometry');
  assert.notEqual(visibleEyes[0].material.side, visibleEyes[1].material.side,
    pose + ': front and rear eye sides must not face the same way');
}
rig.update(camera, 'perched', 0.3, false, true);
assert(eyes.every(mesh => mesh.material.map.name === 'flying-animal-eyes-blink'),
  'a blink closes the eyes on both visible and inactive poses, front and back');
rig.update(camera, 'flap', 0.4, false, false);
assert(eyes.every(mesh => mesh.material.map.name === 'flying-animal-eyes'),
  'the eyes reopen on both faces together');
rig.dispose();
assert(textures.every(texture => texture.disposed), 'all shared eye and body textures are released when the bird despawns');

const lightWindow = { THREE: { Vector3: Vec } }; // Cave policy code is evaluated without creating renderer resources.
vm.runInNewContext(fs.readFileSync('docs/js/cloud-forest-fog.js', 'utf8'),
  { window: lightWindow, console, performance: { now: () => 0 } });
const lighting = lightWindow.CloudForestFog.__test; // Exactly the two policies used by the real fog and overlay draw paths.
for (const mapId of [
  'map_i_den_tzatzul_map_western_slope_0',
  'map_i_den_tzatzul_map_western_slope_1',
  'map_i_den_tzatzul_map_northern_cliffs_0',
  'map_i_den_tzatzul_map_northern_cliffs_1',
]) {
  assert.equal(lighting.enclosedDarknessOverlayAlpha(mapId), .68,
    mapId + ': a readable cave when the fog setting is disabled');
  assert.equal(lighting.undergroundLightingForArea(mapId).a, .68,
    mapId + ': the same readable darkness when the cave mist is enabled');
}
assert(Math.abs(lighting.enclosedDarknessOverlayAlpha('map_i_den_map_western_slope_animalDen_0') - .91) < 1e-10,
  'ordinary wildlife dens retain their original 91% darkness');
assert.equal(lighting.undergroundLightingForArea('map_i_town_mine_f_1').a, .8,
  'mine and ruin fog still uses the original underground night level');
console.log('Tzatzul bilateral eyes, all three poses, blink cleanup and nest-only cave visibility PASS.');
