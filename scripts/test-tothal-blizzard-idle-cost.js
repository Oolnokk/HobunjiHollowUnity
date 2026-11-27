#!/usr/bin/env node
'use strict';
// Zero idle snow resources and a bounded polling cost in non-storm wilderness.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
let area = 'map_southern_cloud_forest'; // Current terrain area controlled by the test.
let snow = 0; // Tothal accumulation fraction, normally zero.
let tick = null; // Production scheduler callback captured for repeatable simulation.
let loads = 0; // Counts snow texture load requests.
let gridReads = 0; // Detects unnecessary grid sampling while snow is inactive.
let traversals = 0; // Detects hidden scene walks while snow is inactive.
let sceneAdds = 0; // Detects hidden GPU drawable groups.
const scene = { add() { sceneAdds++; }, traverse() { traversals++; } }; // Fake scene with observable side effects.
const win = {
  RuntimeFrameScheduler: { register(id, fn) { assert.equal(id, 'environment-surface-micro-plateau-tick'); tick = fn; } },
  GridTileAccessors: { getCurrentArea: () => area, getActiveScene: () => scene,
    getActiveGrid: () => { gridReads++; return [[{type:'grass'}]]; }, getActiveCols: () => 1, getActiveRows: () => 1 },
  CalendarSystem: { currentSeason: () => ({name:'Longpour'}) },
  TothalBlizzard: { snowCoverageFor: () => snow },
  THREE: { TextureLoader: class { load(url, done) { loads++; done({image:null,needsUpdate:false}); } }, RepeatWrapping: 1, LinearFilter: 1 },
};
vm.runInNewContext(fs.readFileSync('docs/js/environment-surface-micro-plateau.js','utf8'),
  {window:win,document:{currentScript:{src:'https://example.org/docs/js/environment-surface-micro-plateau.js'}},
    globalThis:{performance:{now:()=>0}},URL,console}, {filename:'environment-surface-micro-plateau.js'});
assert.equal(loads,0,'no eager snow texture');
for(let i=1;i<=1200;i++) tick({timestamp:i*17});
const surface=win.EnvironmentSurfaceMicroPlateau; // Production debug owner after simulated ordinary frames.
const state=surface.debugSnapshot(); // Zero-work proof also exposed via mobile diagnostic.
assert.equal(state.mode,'none'); assert.equal(state.active,false);
assert.equal(state.snowMeshCount,0); assert.equal(state.textureState,'not-requested');
assert.equal(sceneAdds,0,'no hidden snow scene group');
assert.equal(traversals,0,'no surprise scene traversal');
assert.equal(gridReads,0,'no background tile scanning');
assert.equal(loads,0,'no background snow texture work');
assert(state.skippedInactiveTicks>900,'over 75% of ordinary 60Hz frames skip even mode checks');
const decorated={map:null}; // Simulates a real Western Slope decoration requesting snow.
assert.equal(surface.bindSnowTexture(decorated),true);
assert.equal(loads,1,'snow texture loads on first demand only');
assert(decorated.map,'async snow consumer receives the shared texture');
surface.bindSnowTexture({map:null}); assert.equal(loads,1,'reuse loaded texture');
area='map_eastern_mire'; tick({timestamp:20500});
assert.equal(surface.debugSnapshot().snowMeshCount,0,'ordinary Mire also has zero snow draws');
snow=1; assert.equal(surface.debugSnapshot().mode,'snow','storm can still activate the existing snow owner');
area='map_i_den_map_southern_cloud_forest_1';
assert.equal(surface.debugSnapshot().mode,'none','interior dens have no snow');
console.log('Tothal dormant snow resource regression passed.');
