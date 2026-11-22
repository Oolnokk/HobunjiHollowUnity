#!/usr/bin/env node
'use strict';
// CameraCanopyZoom (js/camera-canopy-zoom.js, extracted from game.js): under a canopy the zoom scale is raised so
// the follow camera's boom stays under the canopy underside; elsewhere, and outside wilderness zones, it is 0.
const assert = require('node:assert/strict');
const Zoom = require('../docs/js/camera-canopy-zoom.js');

assert.equal(Zoom.floor(0, 0, 0), 0, 'no deps yet: no limit');
let area = 'map_forest', pitch = 0;
const zones = [{ x:10, z:10, radius:3, undersideY:4.3 }, { x:30, z:10, radius:2, undersideY:1 }];
Zoom.init({
  isZoneArea:a => a.startsWith('map_'), getCurrentArea:() => area,
  getZoneInfo:a => a === 'map_forest' ? { canopyZones:zones } : null,
  getModeConfig:() => ({ angleFromGroundDeg:30, distanceTiles:14 }), getPitchOffsetDeg:() => pitch,
});
const expected = Math.sin(Math.PI / 6) * 14 / (4.3 - Zoom.CANOPY_CLEARANCE - 1);
assert(Math.abs(Zoom.floor(11, 10, 1) - expected) < 1e-9, 'inside the radius: boom length / headroom');
assert.equal(Zoom.floor(14, 10, 1), 0, 'outside every radius: no limit');
assert.equal(Zoom.floor(30, 10, 1), Infinity, 'no headroom under a low canopy: clamp fully');
pitch = 30;
assert(Math.abs(Zoom.floor(11, 10, 1) - Math.sin(Math.PI / 3) * 14 / 3) < 1e-9, 'the player pitch offset steepens the boom');
area = 'farm';
assert.equal(Zoom.floor(11, 10, 1), 0, 'only wilderness zones have canopies');
console.log('camera canopy zoom: ok');
