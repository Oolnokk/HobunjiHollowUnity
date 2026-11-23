#!/usr/bin/env node
'use strict';
// Shadows and markers must not redo calendar/season or grid sampling on each
// render when the active Cloud Forest has no surface mesh in ordinary weather.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
let area='map_southern_cloud_forest'; // Active exterior for the dormant projection fixture.
let time=100; // Monotonic shared scheduler/render timestamp.
let seasonCalls=0; // Detects per-render expensive season lookup.
let gridCalls=0; // Detects terrain sampling with no surface.
let stormSnow=0; // Controls fast reactivation via the canonical Tothal event.
let frameTick=null; // Scheduler owns the environment surface update.
const scene={}; // Stable scene identity needed to reuse a dormant mode verdict.
const win={
  THREE:{},RuntimeFrameScheduler:{register(id,callback){frameTick=callback;}},
  GridTileAccessors:{getCurrentArea:()=>area,getActiveScene:()=>scene,
    getActiveGrid:()=>{gridCalls++;return [[{type:'grass'}]];},
    getActiveCols:()=>1,getActiveRows:()=>1},
  CalendarSystem:{currentSeason:()=>{seasonCalls++;return {name:'Longpour'};}},
  TothalBlizzard:{snowCoverageFor:()=>stormSnow},
};
vm.runInNewContext(fs.readFileSync('docs/js/environment-surface-micro-plateau.js','utf8'),
  {window:win,document:{currentScript:{src:'https://example.org/docs/js/environment-surface-micro-plateau.js'}},
    globalThis:{performance:{now:()=>time}},URL,console});
const owner=win.EnvironmentSurfaceMicroPlateau; // Production API under test, not a test-side reimplementation.
frameTick({timestamp:time});
const before=seasonCalls;
for(let i=0;i<1000;i++)assert.equal(owner.projectionLiftAt(.5,.5,scene),0);
assert.equal(seasonCalls,before,'no repeated season checks in 1,000 ordinary shadow renders');
assert.equal(gridCalls,0,'no grid reads from dormant render callbacks');
assert.equal(owner.debugSnapshot().skippedDormantProjections,1000,'mobile diagnostics expose skipped work');
area='map_western_slope';
assert.equal(owner.projectionLiftAt(.5,.5,scene),.22,'immediate zone change must not reuse the prior area');
area='map_southern_cloud_forest';stormSnow=.5;
time=400; // The 250ms dormant lease expires before the next simulation update.
assert(owner.projectionLiftAt(.5,.5,scene)>0,'fresh event snow becomes visible without waiting for a rebuild');
stormSnow=0;
time=100; // Simulates a backwards/invalid monotonic clock; must not stay cached forever.
assert.equal(owner.projectionLiftAt(.5,.5,scene),0);
console.log('Dormant surface render callbacks avoid calendar/grid work and still react to zone/storm changes.');
