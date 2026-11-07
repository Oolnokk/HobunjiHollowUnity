#!/usr/bin/env node
'use strict';
// Execute the final-triangle index and cliff catch owner without a renderer.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const window = {}; // Independent runtime namespace for geometry and climb verification.
vm.runInNewContext(fs.readFileSync('docs/js/zone-plateau-mesa.js', 'utf8'), { window, console });
function mesh(points, indices) {
  return { userData: { hobunjiGroundSurface: true }, geometry: {
    getAttribute: () => ({ array: new Float32Array(points.flat()) }),
    index: indices ? { array: indices } : null,
  } };
}
const slope = mesh([[0, 0, 0], [1, 2, 0], [0, 0, 1]], [0, 1, 2]); // Indexed visible plateau face.
const cap = mesh([[0, 3, 0], [0.5, 3, 0], [0, 3, 0.5]]); // Unindexed translated mini-cliff cap.
const sample = window.ZonePlateauMesa.makeTerrainHeightSampler([slope, cap]); // Actual shipped geometry sampler.
assert.equal(sample(0.1, 0.1), 3, 'stacked mini-cliff wins at the actual cap footprint');
assert(Math.abs(sample(0.7, 0.1) - 1.4) < 1e-6, 'slope collider follows triangle interpolation');
assert.equal(sample(0.8, 0.8), null, 'empty space inside a triangle bounding box has no invisible wall');
assert.equal(sample(2, 2), null, 'outside the rendered geometry is empty');
assert.equal(window.ZonePlateauMesa.hasTerrain('not-loaded'), false, 'missing terrain remains distinguishable from empty indexed space');

vm.runInNewContext(fs.readFileSync('docs/js/climb-system.js', 'utf8'), { window, console });
const player = { x: 1.8 * 64, y: 2.5 * 64, health: 100, climbing: false, _freeJump: { feetY: 1.2 } }; // Physical midair route contact.
const route = { normal: { x: -1, z: 0 }, upperNode: 2, nodes: [
  { id: 0, x: 1.5, z: 2.5, y: 0 },
  { id: 1, x: 2, z: 2.5, y: 1.3 },
  { id: 2, x: 2.5, z: 2.5, y: 3 },
] }; // Only the middle node is a handhold.
window.CliffRouteNetwork = { forGrid: () => ({ routes: [route] }) };
window.PlayerJump = { reset() { player._freeJump = null; } }; // Verify that the catch explicitly transfers ownership.
window.ClimbSystem.init({ player, TILE: 64, _isZoneArea: () => true, getCurrentArea: () => 'zone',
  getActiveGrid: () => [[]], setFacingAngle() {}, setTargetAimAngle() {}, setLastMoveAngle() {} });
assert.equal(window.ClimbSystem.tryAirGrab({ x: 1.8, z: 2.5, y: 1.2 }, { x: -1, z: 0 }), false, 'moving away never grabs the face');
assert.equal(window.ClimbSystem.tryAirGrab({ x: 1.8, z: 2.5, y: 3 }, { x: 1, z: 0 }), false, 'platform exits never masquerade as grips');
assert.equal(window.ClimbSystem.tryAirGrab({ x: 1.8, z: 2.5, y: 1.2 }, { x: 1, z: 0 }), true, 'airborne contact catches an existing nearby handhold');
assert.equal(player._freeJump, null);
assert.equal(player._cliffRouteSession.nodeIndex, 1, 'catch starts at the contacted grip, not the route entrance');
assert.equal(player.climbSurfaceY, 1.3);
console.log('airborne terrain and cliff grabs ok');
