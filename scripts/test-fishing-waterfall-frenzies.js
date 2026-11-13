#!/usr/bin/env node
'use strict';

// Regression covers the actual gameplay fish gate and the Frenzy cast wrapper.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/game.js', 'utf8'); // Live gameplay action gate.
const match = source.match(/function canUseAction\(tool, action, col, row\) \{[\s\S]*?\n      \}/);
assert(match, 'existing gameplay canUseAction owner must be present');
const TileType = { RIVER: 'river', STREAM: 'stream', WATERFALL: 'waterfall', GRASS: 'grass', ROCK: 'rock' }; // Terrain identifiers used by the action gate.
const terrain = [[{ type: 'river' }, { type: 'stream' }, { type: 'waterfall' }, { type: 'grass' }]]; // Cast targets for all permanent water types and dry ground.
const canUseAction = vm.runInNewContext('(' + match[0] + ')', {
  TileType, currentArea: 'map_northern_cliffs', player: { onCliffBalcony: false },
  window: { GridTileAccessors: { getActiveGrid: () => terrain } },
});
for (let i = 0; i < 3; i++) assert.equal(canUseAction('harpoon', 'fish', i, 0), true, 'water tile ' + i);
assert.equal(canUseAction('harpoon', 'fish', 3, 0), false, 'dry land is not fishable');
assert.equal(canUseAction('harpoon', 'fish', 5, 0), false, 'outside the grid is not fishable');
assert.equal(canUseAction('hoe', 'fish', 2, 0), false, 'other tools do not gain fish action');

const frenzySource = fs.readFileSync('docs/js/fishing-events.js', 'utf8'); // Live water-edge and bonus owner.
const hook = '  hookWildTreasureInit();'; // Existing end-of-module setup, used to expose private helpers only in this fixture.
assert(frenzySource.includes(hook));
const instrumented = frenzySource.replace(hook,
  '  window.__waterfallTest = { isWaterEdgeTile, frenzyAtReticle, frenzyState };\n' + hook);
const cells = new Map([
  ['2,3', { type: 'waterfall' }], ['1,3', { type: 'grass' }],
  ['3,3', { type: 'river' }], ['2,2', { type: 'stream' }],
]); // Waterfall crest with a bank and adjacent flowing water.
let aim = { col: 2, row: 3 }; // Reticle tile shared with the actual cast.
const game = {
  RuntimeFrameScheduler: { register() {} },
  Fishing: {
    state: null,
    init(deps) { this.deps = deps; },
    beginCast() { this.state = { biteAt: 4 }; return true; },
  },
};
vm.runInNewContext(instrumented, {
  window: game, document: { getElementById: () => null },
  performance: { now: () => 1000 }, console, URLSearchParams,
}, { filename: 'fishing-events.js' });
game.Fishing.init({
  getCurrentArea: () => 'map_northern_cliffs',
  getActiveTileAt: (c, r) => cells.get(c + ',' + r) || null,
  getReticleTile: () => aim,
  showToast() {},
});
const fixture = game.__waterfallTest; // Private Frenzy functions exercised without a second implementation.
assert.equal(fixture.isWaterEdgeTile(2, 3), true, 'waterfall bank can host a Frenzy');
fixture.frenzyState.event = {
  area: 'map_northern_cliffs',
  tiles: [{ col: 2, row: 3, key: 'map_northern_cliffs:2,3' }],
  remainingHours: 1, ageRealSeconds: 0,
}; // One live Frenzy marker at the crest.
assert.equal(fixture.frenzyAtReticle(), true, 'crest marker is detected by the reticle');
assert.equal(game.Fishing.beginCast(), true, 'original cast still runs');
assert.equal(game.Fishing.state.frenzyActive, true, 'waterfall cast gets the frenzy bonus');
assert(Math.abs(game.Fishing.state.biteAt - 1.8) < 1e-9, 'frenzy bite timer is reduced');
aim = { col: 3, row: 3 };
assert.equal(fixture.frenzyAtReticle(), false, 'unmarked neighboring water gets no bonus');
console.log('waterfall fishing and Frenzy integration passed');
