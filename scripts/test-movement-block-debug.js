#!/usr/bin/env node
'use strict';
// MovementBlockDebug names which system blocks each direction: footprint provider id, tiles, dynamic blockers, closed doors.
const assert = require('node:assert/strict');
const path = require('node:path');
global.window = global;
const docs = rel => path.join(__dirname, '..', 'docs', rel);
require(docs('js/area-footprint-blockers.js'));
const Debug = require(docs('js/movement-block-debug.js'));
window.AreaFootprintBlockers.register('test-wall', { area: 'town', blocksBox: (x, z, half) => x + half > 10.5 && z > 4 && z < 6 });
window.DynamicSurfaces = { blockerAt: (x, z) => (x > 9 && x < 9.4 && z > 6 ? { id: 'test-gate' } : null) };
window.InteriorDoorTiles = { blocksBox: (area, x, z) => x < 9.5 && z > 4.9 && z < 5.1 };
const player = { x: 10 * 64, y: 5 * 64, physicalFeetY: 0 };
window.__climbDebug = { getPlayer: () => player, getCurrentArea: () => 'town', tileSpeedAt: (wx, wy) => (wy / 64 > 7 ? null : 1) };
const r = Debug.explain({ reach: .8, half: .2 });
assert.equal(r.area, 'town');
assert.deepEqual(r.directions.E, ['footprint:test-wall'], 'east is blocked by the named footprint provider');
assert.equal(r.directions.N, 'clear');
assert.ok(Array.isArray(r.directions.W) && r.directions.W.includes('closed interior door'));
assert.deepEqual(window.AreaFootprintBlockers.explain('town', 11, 5, .2, null), ['test-wall']);
assert.equal(Debug.explain().here.length, 0, 'standing in the open reports nothing');
console.log('movement block debug: ok');
