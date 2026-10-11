'use strict';
const assert = require('node:assert/strict'); // Validates actual locale carving and collision expansion.
const fs = require('node:fs'); // Loads the current geometry owners into a browser-free context.
const vm = require('node:vm'); // The fixture captures expensive carving while executing real synthesis and sampling.
const context = {console}; // Shared window surface used by the production modules.
context.window=context;
vm.createContext(context);
vm.runInContext(fs.readFileSync('docs/js/cavern-sculptor.js','utf8'),context);
vm.runInContext(fs.readFileSync('docs/js/cavern-generator.js','utf8'),context);
const sculptor=context.CavernSculptor; // Locale and procedural objectives both call this footprint owner.
const expanded=sculptor.expandFootprint([[2,2]], [null,{col:3,row:2,width:2,depth:2},{tiles:[[4,3],[5,3],[NaN,2]]},{col:0,row:0,width:-1,depth:4}]); // Mixed requests verify invalid data, deduplication, and rectangles.
assert.equal(expanded.length,6);
assert.equal(sculptor.expandFootprint([[2,2]],{}).length,1,'malformed optional clearances are ignored');
let requestedFloor=null, carveCount=0; // Captures the actual expanded footprint passed into the common carver.
sculptor.carveFootprintCavern = floor => {
  requestedFloor=floor;carveCount++;
  return {mesh:{positions:[0,0,0,20,0,0,0,0,20,20,0,20],indices:[0,2,1,1,2,3]}};
};
const locale={id:'clearance-test',name:'Clearance cave',cols:5,rows:5,tiles:{'2,2':{},'2,3':{},'3,3':{}},connectors:[{id:'entry',col:2,row:2,side:'north'}],cavern:{mapId:'map_i_clearance_test',generation:{clearanceFootprints:[{col:3,row:3,width:8,depth:8}]}}}; // Authoring options can grow the room beyond the painted map dimensions.
const map=context.CavernGenerator.synthesizeLocaleCavernMapData(locale); // Runs the real locale runtime synthesis.
assert.equal(map.floor.length,66);
assert.equal(requestedFloor.length,map.floor.length,'geometry and collision receive the same expanded floor');
assert(map.cols>=12 && map.rows>=12,'bounds grow with the carved room');
assert.equal(map.floorSurfaceByTile['10,10'],0,'new room has shared standing height');
assert.equal(Object.keys(locale.tiles).length,3,'synthesis never changes the authored painted mask');
assert.equal(map.exits[0].tiles[0].join(','),'2,2','room growth preserves connector coordinates');
console.log('locale clearance footprint expansion, bounds and grounding checks passed');

function freshMap() { return {id:'cached-expansion',cols:5,rows:5,floor:[[2,2],[2,3],[3,3]],exitCol:2,exitRow:2}; }
const requests=[{col:3,row:3,width:8,depth:8}]; // Stable objective request reused when the player re-enters this map.
const first=context.CavernGenerator.expandCavernMapData(freshMap(),requests,()=>0.5);
const beforeReentry=carveCount; // Re-entry must avoid repeating the SDF generation.
first.colliders.push([100,100]);
const second=context.CavernGenerator.expandCavernMapData(freshMap(),requests,()=>0.5);
assert.equal(carveCount,beforeReentry);
assert.equal(first.mesh.positions,second.mesh.positions,'re-entry shares cached geometry');
assert(!second.colliders.some(tile=>tile[0]===100),'runtime collider edits never poison cached geometry');
assert(second.outerRimTiles.every(tile=>!second.floor.some(cell=>cell.join(',')===tile.join(','))),'expanded rim remains entirely solid');
context.CavernGenerator.expandCavernMapData({...freshMap(),exitCol:3,exitRow:3},requests,()=>0.5);
assert.equal(carveCount,beforeReentry+1,'changed entrance invalidates the cached shell');
console.log('expanded cave caching and collision isolation checks passed');
