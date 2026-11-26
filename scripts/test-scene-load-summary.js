#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const window = {};
vm.runInNewContext(fs.readFileSync('docs/js/scene-load-summary.js', 'utf8'), { window });
const S = window.SceneLoadSummary;
assert.equal(S.summary(), null, 'no combat deps yet: no summary and no throw');
const TILE = 64;
const at = (tiles, extra = {}) => ({ health: 10, x: tiles * TILE, y: 0, areaId: 'zone', state: 'idle', ...extra });
window.Combat = { deps: { player: { x: 0, y: 0 }, TILE, getCurrentArea: () => 'zone',
  hostileObjects: [at(5, { state: 'chase' }), at(15, { state: 'searching' }), at(30, { state: 'attack-windup' }), at(100), at(3, { areaId: 'other' }), at(2, { health: 0 })],
  companionObjects: [{ health: 5 }, { health: 0 }], animalObjects: [{ health: 1 }, { health: 1 }] } };
const s = S.summary();
assert.equal(s.hostilesAlive, 5, 'dead hostiles are not counted');
assert.equal(s.hostilesInArea, 4, 'other-area hostiles are excluded from the in-area counts');
assert.equal(s.hostilesEngaged, 2, 'chase and attack states count as engaged');
assert.deepEqual([s.hostilesWithin10, s.hostilesWithin20, s.hostilesWithin40], [1, 2, 3]);
assert.equal(s.engagedWithin20, 1);
assert.equal(s.companions, 1); assert.equal(s.animals, 2);
assert.ok(Object.values(s).every(Number.isFinite), 'numbers only so a performance window can diff start vs end');
assert.match(S.format(), /within 10\/20\/40 tiles=1\/2\/3/);
console.log('scene load summary passed');
