#!/usr/bin/env node
'use strict';

// Regression for the dungeon CellGrid3D / DynamicSurfaces bridge used by wilderness mini-cliffs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const CG = require('../docs/js/cell-grid-3d.js');
const route = require('../docs/js/cliff-route-network.js');
const elevated = require('../docs/js/cliff-elevated-surfaces.js');
const windowMock = { window: {} }; // Isolated browser global; no shared state with other tests.
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../docs/js/dynamic-surfaces.js'), 'utf8'), windowMock);
const DS = windowMock.window.DynamicSurfaces;
const rects = elevated.groupedRectangles([{c:3,r:1},{c:4,r:1},{c:3,r:2},{c:4,r:2},{c:4,r:2},{c:7,r:2}]);
assert.equal(rects.length, 2, 'adjacent footprint cells batch but disconnected groups do not');
assert(rects.some(r => r.minC === 3 && r.maxC === 4 && r.minR === 1 && r.maxR === 2));

function shelf(id, y) {
  return {
    id, x:4.5, z:3.5, y, width:2.6, depth:1.4,
    tangent:{x:1,z:0}, normal:{x:0,z:1},
    footprint:[3,4,5].map(c=>({c,r:3,elevation:y})),
  };
}
const lower = shelf('lower', 2.375), upper = shelf('upper', 5.125);
const network = {area:'western-slope',balconies:[lower,upper]};
let active = true; // Simulates the zone-specific enable predicate injected by game.js.
const first = elevated.mount(network, {DynamicSurfaces:DS,CellGrid3D:CG,isActive:()=>active});
assert(first.ok, first.reason);
assert.equal(first.supportCount,2, 'two balconies register two batched rectangles, not six tiles');
assert.equal(elevated.mount(network,{DynamicSurfaces:DS,CellGrid3D:CG}).supportCount,2,'no duplicate registrations');
assert.equal(elevated.supportAt(network,4.5,3.5,lower.y)?.shelf.id,'lower','overhead shelf is not ground');
assert.equal(elevated.supportAt(network,4.5,3.5,upper.y)?.shelf.id,'upper','upper walker stays on upper shelf');
assert.equal(elevated.supportAt(network,4.5,3.5,0),null,'ground walker cannot step up several units');
assert.equal(elevated.highestBelow(network,4.5,3.5,9,0)?.id,'upper','falls catch top shelf first');
assert.equal(elevated.highestBelow(network,4.5,3.5,4,0)?.id,'lower','falls from between decks catch lower shelf');
assert.equal(elevated.highestBelow(network,4.5,3.5,9,6),null,'minimum landing elevation honored');
assert(elevated.canStandOn(network,'lower',4.5,3.5),'local cubic grid supports lower feet');
assert(elevated.canStandOn(network,'upper',4.5,3.5),'local cubic grid supports upper feet');
assert(!elevated.canStandOn(network,'lower',9,3.5),'do not walk outside footprint');

active=false;
assert.equal(elevated.highestBelow(network,4.5,3.5,9,0),null,'offscreen zones cannot affect the active world');
const previousBridge=globalThis.CliffElevatedSurfaces; // Node-only bridge injection exercises the real graph's fallback decision.
globalThis.CliffElevatedSurfaces=elevated;
try {
  assert.equal(route.highestBelow(network,4.5,3.5,9,0),null,
    'network-level fallback must not resurrect an offscreen registered balcony');
  active=true;
  assert.equal(route.highestBelow(network,4.5,3.5,9,0)?.id,'upper',
    'network-level falls use the registered world-height support authority');
} finally {
  if (previousBridge === undefined) delete globalThis.CliffElevatedSurfaces;
  else globalThis.CliffElevatedSurfaces=previousBridge;
}
active=true;
DS.registerSurface({id:'shaft-unrelated',scope:'shaft-hub',bounds:{minX:4,maxX:5,minZ:3,maxZ:4},topY:12});
const rerolled={area:network.area,balconies:[lower]};
assert.equal(elevated.mount(rerolled,{DynamicSurfaces:DS,CellGrid3D:CG}).supportCount,1,'rerolls clear old support');
assert.equal(elevated.highestBelow(rerolled,4.5,3.5,9,0)?.id,'lower','upper balcony no longer exists');
assert.equal(elevated.highestBelow(network,4.5,3.5,9,0),null,'reject stale network identities');
assert.equal(DS.sampleSupport(4.5,3.5,{scope:'shaft-hub'})?.y,12,'dungeon support remains registered');
assert(elevated.clear(network.area),'unload clears only its own supports');
assert.equal(DS.sampleSupport(4.5,3.5,{scope:first.scope}),null,'no leaked balcony support');
assert.equal(DS.sampleSupport(4.5,3.5,{scope:'shaft-hub'})?.y,12,'dungeon support survives unload');

const game=fs.readFileSync(path.join(__dirname,'../docs/game.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../docs/index.html'),'utf8');
const mesa=fs.readFileSync(path.join(__dirname,'../docs/js/zone-plateau-mesa.js'),'utf8');
assert(html.indexOf('cell-grid-3d.js')<html.indexOf('cliff-elevated-surfaces.js'),'module load order');
assert(html.includes('dynamic-surfaces.js?v='),'the main game must load DynamicSurfaces, not just the isolated test harness');
assert(html.indexOf('dynamic-surfaces.js?v=')<html.indexOf('cliff-elevated-surfaces.js'),'the dynamic surface registry exists before any wilderness balcony mount');
assert(mesa.includes('CliffElevatedSurfaces?.mount?.(network'),'register on mesa rebuild');
assert(mesa.includes('tileY: t => deps.tileSurfaceYInArea(t, mapId)'),
  'outdoor route nodes use the same ground height as player and wildlife');
assert(game.includes('CliffElevatedSurfaces?.clear?.(mapId)'),'unregister on area unload');
assert(game.includes('CliffRouteNetwork?.releaseArea?.(mapId)'),'retire stale world geometry and reward handles');
assert(game.includes('getCurrentArea: () => currentArea'),'active area predicate provided');
assert(typeof route.verifyReachability==='function','ShaftHub-style connectivity proof available');
console.log('PASS wilderness stacked support, fractional heights, dungeon isolation, remount and cleanup');
