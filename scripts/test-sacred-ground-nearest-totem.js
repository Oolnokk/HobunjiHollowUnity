#!/usr/bin/env node
'use strict';
// Executes HobunjiSacredGround.nearestRootTotem (moved out of game.js's
// respawn path): nearest pathAnchor in the same zone, null when the zone has none.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = { console, Math, Number, Array };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'docs/js/sacred-ground.js'), 'utf8'), ctx);
const SG = ctx.HobunjiSacredGround;
const layouts = new Map([
  ['map_western_slope', { rootTotems: [{ pathAnchor: { x: 10, y: 10 } }, { pathAnchor: { x: 40, y: 12 } }, { x: 3, y: 30 }] }],
]);
SG.init({ tileSize: 55, getRootTotems: id => layouts.get(id)?.rootTotems || [] });
assert.deepEqual({ ...SG.nearestRootTotem('map_western_slope', 38 * 55, 12 * 55) }, { x: 40, y: 12 });
assert.deepEqual({ ...SG.nearestRootTotem('map_western_slope', 4 * 55, 29 * 55) }, { x: 3, y: 30 }, 'bare totems without pathAnchor still count');
assert.equal(SG.nearestRootTotem('map_northern_cliffs', 0, 0), null, 'a zone without totems has no recovery point');
console.log('sacred ground nearest totem: ok');
