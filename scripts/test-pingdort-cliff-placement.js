#!/usr/bin/env node
'use strict';
// Run: node scripts/test-pingdort-cliff-placement.js
const assert = require('node:assert/strict');
const route = require('../docs/js/cliff-route-network.js'); // Production cliff cap geometry, not a permissive shelfContains test stub.
const oldWindow = global.window; // Restore global test state if this script is reused by a same-process test runner.
global.window = {CliffRouteNetwork: route};
require('../docs/js/pingdort-flocks.js'); // This module registers pure siteForShelf without initializing wildlife or rendering.
const siteForShelf = global.window.PingdortFlocks.siteForShelf; // Shares the actual one-time nest selector used by flock generation.
assert.equal(typeof siteForShelf, 'function');
assert.equal(siteForShelf(null),null,'missing shelf data must not break wildlife generation');
assert.equal(siteForShelf({footprint:[]}),null,'empty caps cannot create phantom nests');

function grid(rows, cols, cliffCols) {
  return Array.from({length:rows}, () => Array.from({length:cols}, (_, c) => ({
    type:cliffCols.includes(c) ? 'rock' : 'grass',
    incline:cliffCols.includes(c),
    elevTier:cliffCols.filter(column => c > column).length,
  })));
}
function rockClearance(shelf, position) {
  const cells = [...(shelf.base?.footprint || []), ...(shelf.base?.boundaryCells || [])]; // Both cliff parts can hide a nest.
  return Math.min(Infinity, ...cells.map(cell => Math.hypot(
    Math.max(cell.c-position.x,0,position.x-(cell.c+1)),
    Math.max(cell.r-position.z,0,position.z-(cell.r+1)),
  )));
}
function verifySite(shelf, point) {
  assert(route.shelfContains(shelf, point.x, point.z, -.2), 'egg nest must rest fully inside the inset ledge');
  assert(rockClearance(shelf,point) >= .4 - 1e-7, 'nest cup must clear both parent plateau and painted cliff rock');
  const reward = shelf.reward === 'herbCluster' && shelf.herbTile
    ? {x:shelf.herbTile.c+.5,z:shelf.herbTile.r+.5} : shelf;
  const gap = shelf.reward === 'oreRock' ? 1.05 : .88; // Same reward reachability gap as runtime.
  if (shelf.reward) assert(Math.hypot(point.x-reward.x,point.z-reward.z) > gap, 'nest must not cover the shelf reward');
  assert.deepEqual(siteForShelf(shelf),point,'nest site must remain deterministic over repeated queries');
}

const cases = [
  {name:'cloud forest',area:'map_southern_cloud_forest',rows:48,cols:52,cliffs:[17,35],height:9,minSites:5},
  {name:'three-tier forest',area:'map_southern_cloud_forest',rows:56,cols:65,cliffs:[12,28,44],height:9,minSites:5},
  {name:'eastern mire',area:'map_eastern_mire',rows:56,cols:65,cliffs:[12,30,45],height:12,minSites:2},
]; // Production-sized cliff corridors exercise many different widths, curves and rock seams.
let checked=0,usable=0; // Both counters appear in test output so density regressions are visible without a browser.
for (const item of cases) {
  const network=route.build(grid(item.rows,item.cols,item.cliffs),{
    area:item.area,tileY:t=>t.elevTier*item.height,
  });
  assert(network.verification.ok,item.name+' generated an invalid climb network');
  let found=0;
  for (const shelf of network.balconies) {
    checked++;
    const point=siteForShelf(shelf);
    if (!point) continue;
    found++;usable++;
    verifySite(shelf,point);
  }
  assert(found>=item.minSites,item.name+' lost too many reachable nest sites: '+found);
}
const cap = {id:'fractional-recovery',x:90.5,z:45.5,y:12.5,normal:{x:0,z:1},tangent:{x:1,z:0},
  width:3,depth:2,overhangDepths:[2,2,2],contourOffsets:[0,0,0],reward:'oreRock',
  footprint:[{c:91,r:45}],base:{footprint:[{c:90,r:45}],boundaryCells:[]}};
const fractional=siteForShelf(cap);
assert(fractional,'an exposed sub-tile location should recover a ledge whose centre blocks the reward');
assert(fractional.x%1!==.5 || fractional.z%1!==.5,'fractional rescue must actually use a sub-tile position');
verifySite(cap,fractional);
const buried={...cap,id:'buried',x:80.5,z:80.5,reward:'buriedTreasure',
  footprint:[{c:80,r:80}],base:{footprint:[{c:80,r:80}],boundaryCells:[]}};
assert.equal(siteForShelf(buried),null,'a cap completely embedded in the parent plateau must be rejected');
const painted={...buried,id:'painted-rock',base:{footprint:[{c:79,r:80}],boundaryCells:[{c:80,r:80}]}};
assert.equal(siteForShelf(painted),null,'painted rock walls must block nests even without parent-plateau overlap');
if (oldWindow === undefined) delete global.window; else global.window=oldWindow;
console.log('Pingdort cliff nest placement PASS: '+usable+'/'+checked+' generated shelves are safe and reachable');
