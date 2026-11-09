#!/usr/bin/env node
'use strict';
// Ruin Skeeri (the bomber roosts ~23 tiles from the player) must keep their rig at any distance,
// while ordinary far wildlife still streams out to data.
const assert = require('node:assert/strict');
const path = require('node:path');
global.window = global;
window.SCRATCHBONES_CONFIG = {};
window.EntityDistanceLod = { isFar: (hidden, d, wake, release) => hidden ? d > wake : d > release };
window.Combat = {};
require(path.join(__dirname, '..', 'docs/js/wildlife-visual-lod.js'));
const Lod = window.WildlifeVisualLod;
const released = [];
Lod.init({ createVisuals: c => { c._wildlifeVisualsReleased = false; }, releaseVisuals: c => { released.push(c); c._wildlifeVisualsReleased = true; } });
const make = extra => ({ health: 10, streamVisuals: true, state: 'idle', avatarRef: { group: { visible: true } }, ...extra });
const bomber = make({ isRuinSkeeri: true }), deer = make({});
Lod.beginFrame();
assert.equal(Lod.update(bomber, 24), false, 'a bomber 24 tiles away stays visible');
assert.equal(Lod.update(bomber, 60), false, 'and at any distance');
assert.equal(released.includes(bomber), false);
assert.equal(Lod.update(deer, 24), true, 'ordinary far wildlife still streams out');
bomber._wildlifeVisualsReleased = true; bomber._wildlifeVisualLodHidden = true; // Created while far away.
Lod.beginFrame();
Lod.update(bomber, 24);
assert.equal(bomber._wildlifeVisualsReleased, false, 'a data-only ruin Skeeri is promoted to a real rig');
console.log('ruin skeeri never streams out: ok');
