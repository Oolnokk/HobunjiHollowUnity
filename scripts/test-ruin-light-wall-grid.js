#!/usr/bin/env node
'use strict';
// A torch in a wing whose walls are merged meshes still gets shadows: grid wall runs between
// the light and the player's side produce projected polygons; a wall on another floor does not.
const assert = require('node:assert/strict');
globalThis.DevRandomRuin = { getShaftCollisionMap: floor => ({ y: floor * 6, floorHeight: 6, floorCount: 2,
  blocked: floor === 0 ? ['10,5', '11,5', '12,5', '13,5', '14,5'] : ['10,2'] }) };
const Occlusion = require('../docs/js/ruin-light-occlusion.js');
const project = (x, y, z) => ({ x: x * 10, y: z * 10 });
Occlusion.setEnabled(true); Occlusion.setWallShadows(true); // Off by default (it drew a big dark plane over the player); this test covers the geometry itself.
const shadows = source => Occlusion.projectedShadows({ scene: { traverse() {} }, source, radiusTiles: 9, project, THREE: { Box3: class {} }, now: 1000 });
const ground = shadows({ x: 12.5, y: 1.3, z: 8.5 });
assert.ok(ground.length >= 2, 'a 5-cell wall becomes several shadow polygons (' + ground.length + ')');
assert.ok(ground.every(poly => poly.length === 4 && poly.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))));
assert.ok(ground.some(poly => poly.some(p => p.y < 50)), 'shadows reach beyond the wall, away from the light');
const upstairs = shadows({ x: 12.5, y: 7.3, z: 8.5 });
assert.ok(upstairs.length <= 1, 'the ground floor wall does not shade a light one story up');
console.log('ruin light wall-grid shadows: ok');
