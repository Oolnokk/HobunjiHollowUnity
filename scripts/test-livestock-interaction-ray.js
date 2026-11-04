'use strict';

// Execute the real FarmAnimals selection path with a minimal 3D hit harness.
// The logical livestock tile changes before the visible avatar reaches it.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/farm-animals.js', 'utf8');

const rayStats = { calls: 0, alphaReads: 0 }; // Counts triangle intersections and first-use alpha reads separately.
const notes = []; // Captures focus changes sent to the mobile-visible raycast overlay.
const clears = []; // Captures misses sent to the overlay so stale targets disappear.
let area = 'farm'; // Current area, used to reject livestock selection indoors.
let frame = 1; // Game loop frame key, used to share button/prompt/press selection.
let ray = { origin: { x: 0, y: 2, z: 0 }, direction: { x: 1, y: 0, z: 0 } }; // Same camera ray that the game's interaction-reticle uses.

class Raycaster {
  constructor() {
    this.ray = {
      origin: { set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
      direction: { set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
    };
  }
  intersectObject(mesh, recursive, hits) {
    rayStats.calls++;
    assert.equal(recursive, false, 'only the visible authored plane should be tested');
    if (!mesh.hitPoint || mesh.acceptDirection && mesh.acceptDirection !== this.ray.direction.x) return hits;
    hits.push({ object: mesh, point: mesh.hitPoint, distance: mesh.hitDistance, uv: mesh.hitUv || { x: 0.5, y: 0.5 } });
    return hits;
  }
}

const window = {
  CreatureTextureCache: {
    create: () => ({ get() { return null; }, put(k, v) { return v; }, retain() {} }),
    genotypeFrameSetKey: key => key,
  },
  DebugHitboxes: {
    noteInteractionFocus: focus => notes.push(focus),
    clearInteractionFocus: type => clears.push(type),
  },
};
window.window = window;
const THREE = {
  Raycaster,
  Vector2: class { set(x, y) { this.x = x; this.y = y; return this; } }, // Alpha pixel UV scratch used in the production picker.
};
const document = {
  createElement(tag) {
    assert.equal(tag, 'canvas');
    return {
      width: 0, height: 0,
      getContext() {
        let sourceImage = null; // Source image passed to drawImage, used to simulate canvas alpha readback.
        return {
          drawImage(image) { sourceImage = image; },
          getImageData(_x, _y, width, height) {
            rayStats.alphaReads++;
            const data = new Uint8ClampedArray(width * height * 4); // Opaque body with transparent sprite margins.
            for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
              data[(y * width + x) * 4 + 3] = sourceImage.opaque(x / width, y / height) ? 255 : 0;
            }
            return { data };
          },
        };
      },
    };
  },
};
vm.runInNewContext(source, { window, THREE, document, Map, WeakMap, Set, Number, Math, Uint8ClampedArray, performance: { now: () => 1 } }, { filename: 'farm-animals.js' });

const animals = new Set(); // Live animal registry, independent of obsolete logical tile reservations.
const player = { x: 0, y: 0 }; // Player position in pixels; TILE=10 makes 20 world px equal two tiles.
window.FarmAnimals.init({
  getCurrentArea: () => area,
  getInteractionFrameTime: () => frame,
  getPlayerInteractionRay: () => ray,
  animalObjects: animals,
  player,
  TILE: 10,
});

function animal(id, x, z, hitDistance, options = {}) {
  const texture = { image: { width: 800, height: 450, opaque: (u, v) => u >= 0.2 && u <= 0.8 && v >= 0.2 && v <= 0.8 }, transformUv(uv) { uv.y = 1 - uv.y; } }; // Simulates the actual loaded sprite texture's transparent background.
  const face = { isMesh: true, visible: true, hitPoint: { x, y: 1, z }, hitDistance, material: { map: texture, alphaTest: 0.35 } }; // The real Mesh material owns the loaded, alpha-tested PNG map.
  const group = {
    visible: true,
    parent: {},
    position: { x, y: 1, z },
    scale: { x: 1, y: 1, z: 1 },
    updateMatrixWorld() {},
  };
  return {
    id, livestockId: id, animalKey: 'gar-wolf',
    col: 9, row: 9, // Logical reservation deliberately far away from the rendered sprite!
    modelWidth: 1.5, modelHeight: 1,
    avatarRef: { group, frontPlane: face, backPlane: { isMesh: true, visible: true, hitPoint: null, material: { map: texture, alphaTest: 0.35 } } },
    ...options,
  };
}

const near = animal('near', 1.4, 0.3, 3);
const far = animal('far', 2.1, 0.2, 5);
animals.add(far);
animals.add(near);
assert.equal(window.FarmAnimals.aimedAnimal(), near, 'moving visible avatar wins despite outdated tile reservation');
assert.equal(notes.at(-1).candidate.id, 'near', 'selected livestock identity is reported to the existing debug overlay');
assert.equal(notes.at(-1).candidate.type, 'livestock');
assert.equal(notes.at(-1).point.x, 1.4, 'debug overlay draws the actual 3D hit point');
const firstCallCount = rayStats.calls;
assert.equal(window.FarmAnimals.aimedAnimal(), near, 'button list and press agree within the same frame');
assert.equal(rayStats.calls, firstCallCount, 'no duplicate raycast cost for repeated action-bar queries');
assert.equal(rayStats.alphaReads, 2, 'each visible animal sprite image is sampled only once for all subsequent frames');

frame++;
near.avatarRef.frontPlane.hitUv = { x: 0.01, y: 0.5 }; // Intersects the plane geometry but lands on a transparent PNG pixel.
assert.equal(window.FarmAnimals.aimedAnimal(), far, 'a transparent foreground sprite rectangle must not steal the interaction');
assert.equal(rayStats.alphaReads, 2, 'cached alpha masks avoid per-frame drawImage/getImageData costs');
near.avatarRef.frontPlane.hitUv = { x: 0.5, y: 0.5 };
frame++;
near.avatarRef.frontPlane.hitPoint = null;
assert.equal(window.FarmAnimals.aimedAnimal(), far, 'closer missing face lets a visible animal behind it win');
frame++;
far.avatarRef.frontPlane.hitPoint = null;
assert.equal(window.FarmAnimals.aimedAnimal(), null, 'logical tile alone never selects a livestock animal');
assert.equal(clears.at(-1), 'livestock', 'miss clears stale focus diagnostics');

frame++;
near.avatarRef.frontPlane.hitPoint = { x: 3, y: 1, z: 0 };
assert.equal(window.FarmAnimals.aimedAnimal(), null, 'hits beyond player interaction reach are ignored');
frame++;
near.avatarRef.frontPlane.hitPoint = { x: 1.2, y: 1, z: 0 };
near.avatarRef.group.visible = false;
assert.equal(window.FarmAnimals.aimedAnimal(), null, 'hidden barn livestock are not selectable');
near.avatarRef.group.visible = true;
near._vatWorkPose = { vatId: 'v1' };
frame++;
assert.equal(window.FarmAnimals.aimedAnimal(), null, 'vat workers are not selectable through their animated pose');
near._vatWorkPose = null;
frame++;
area = 'town';
assert.equal(window.FarmAnimals.aimedAnimal(), null, 'livestock targeting cannot claim other scenes');

area = 'farm';
near.avatarRef.group.position.x = 3.7; // A large animal's center can be farther away while its visible front corner remains in reach.
near.modelWidth = 2.4;
near.modelHeight = 2.4;
near.avatarRef.frontPlane.hitPoint = { x: 2.05, y: 1, z: 0 };
far.avatarRef.frontPlane.hitPoint = null;
frame++;
assert.equal(window.FarmAnimals.aimedAnimal(), near, 'bounding prefilter must include the corners of a scaled/rotated sprite rectangle');

near._harvestFrozen = true;
frame++;
assert.equal(window.FarmAnimals.aimedAnimal(), null, 'ongoing milk/venom harvesting prevents duplicate animal interactions');
near._harvestFrozen = false;

const back = near.avatarRef.backPlane; // Rigged front/back planes share one mirrored source texture in the production renderer.
near.avatarRef.frontPlane.hitPoint = null;
back.hitPoint = { x: 2, y: 1, z: 0 };
back.hitDistance = 3;
back.hitUv = { x: 0.85, y: 0.5 };
back.material.map = near.avatarRef.frontPlane.material.map;
back.material.map.image = {
  width: 800, height: 450,
  opaque: (u, v) => u >= 0.1 && u <= 0.2 && v >= 0.4 && v <= 0.6,
};
frame++;
assert.equal(window.FarmAnimals.aimedAnimal(), near, 'the shared-face shader mirror is honored when checking reverse-card PNG alpha');

console.log('Livestock camera-ray interaction regression checks passed.');
