// Executes js/transition-markers.js (extracted from game.js's
// buildTransitionMarkers) against a stub THREE: one ring per transition whose
// tile exists, placed in the farm or interior scene, and reading the live
// (reassignable) farm grid through its getter.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

class Mesh {
  constructor(geometry, material) {
    this.geometry = geometry; this.material = material;
    this.rotation = { x: 0 };
    this.position = { set: (x, y, z) => Object.assign(this.position, { x, y, z }) };
  }
}
const THREE = {
  DoubleSide: 2,
  RingGeometry: class { constructor(...args) { this.args = args; } },
  MeshBasicMaterial: class { constructor(opts) { Object.assign(this, opts); } },
  Mesh,
};
const makeScene = () => ({ children: [], add(child) { this.children.push(child); } });
const context = { Math, THREE };
context.window = context;
vm.createContext(context);
const sourcePath = path.join(__dirname, '..', 'docs', 'js', 'transition-markers.js');
vm.runInContext(fs.readFileSync(sourcePath, 'utf8'), context, { filename: sourcePath });

const api = context.TransitionMarkers;
assert.equal(typeof api.init, 'function');
api.buildTransitionMarkers(); // Before init: must be a safe no-op.

const scene = makeScene(), interiorScene = makeScene();
let grid = [[{ type: 'normal' }, { type: 'raised' }]];
const interiorGrid = [[{ type: 'normal' }]];
const transitions = [
  { area: 'farm', col: 1, row: 0 },
  { area: 'interior', col: 0, row: 0 },
  { area: 'farm', col: 5, row: 5 }, // No tile here: skipped.
];
api.init({
  interiorGrid, scene, interiorScene,
  tileSurfaceY: type => (type === 'raised' ? 1 : 0),
  getGrid: () => grid,
  getWorldTransitions: () => transitions,
});
api.buildTransitionMarkers();
assert.equal(scene.children.length, 1, 'one farm ring');
assert.equal(interiorScene.children.length, 1, 'one interior ring');
const ring = scene.children[0];
assert.deepEqual([ring.position.x, ring.position.y, ring.position.z], [1.5, 1.02, 0.5], 'ring sits just above the tile surface at the tile centre');
assert.equal(ring.rotation.x, -Math.PI / 2, 'ring lies flat');
assert.equal(ring.material.color, 0xfbbf24);

grid = [[{ type: 'normal' }]]; // Farm grid reassigned: the getter must see the new one.
api.buildTransitionMarkers();
assert.equal(scene.children.length, 1, 'reassigned grid without (1,0) adds no farm ring');
console.log('transition markers: ok');
