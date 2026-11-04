'use strict';

// Execute the real FarmAnimals selection path with a minimal 3D hit harness.
// The logical livestock tile changes before the visible avatar reaches it.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/farm-animals.js', 'utf8');

const rayStats = { calls: 0 }; // Counts mesh intersections to verify one pick per game frame.
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
    hits.push({ point: mesh.hitPoint, distance: mesh.hitDistance });
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
const THREE = { Raycaster };
vm.runInNewContext(source, { window, THREE, Map, Set, Number, Math, performance: { now: () => 1 } }, { filename: 'farm-animals.js' });

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
  const face = { isMesh: true, visible: true, hitPoint: { x, y: 1, z }, hitDistance }; // Real ray intersections occur on the moving visible PNG planes.
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
    avatarRef: { group, frontPlane: face, backPlane: { isMesh: true, visible: true, hitPoint: null } },
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

console.log('Livestock camera-ray interaction regression checks passed.');
