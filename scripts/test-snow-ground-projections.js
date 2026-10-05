'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
let area = 'map_western_slope'; // Active map for snow/interior cases.
let season = 'Longpour'; // Live seasonal slush activation.
const scene = {}; // Active scene identity for render hooks.
const grid = [[{type:'grass'}, {type:'water'}, {type:'raised', elevTier:3}, {type:'ramp'}]]; // Covered and uncovered tiles.
const window = {
  GridTileAccessors: {getCurrentArea:()=>area, getActiveScene:()=>scene, getActiveGrid:()=>grid},
  CalendarSystem: {currentSeason:()=>({name:season})},
  RuntimeFrameScheduler: {register() {}},
};
vm.runInNewContext(fs.readFileSync('docs/js/environment-surface-micro-plateau.js', 'utf8'), {window});
const api = window.EnvironmentSurfaceMicroPlateau; // Actual owner under test.
assert.strictEqual(api.projectionLiftAt(.5,.5), .22);
for (const x of [2.5,3.5]) assert.strictEqual(api.projectionLiftAt(x,.5), .22);
for (const x of [1.5,4.5,-.5,NaN,Infinity]) assert.strictEqual(api.projectionLiftAt(x,.5), 0);
assert.strictEqual(api.projectionLiftAt(.5,.5,{}), 0);
let beforeCalls = 0, afterCalls = 0; // Verify composition with existing callbacks.
const mesh = {
  isMesh:true, userData:{}, renderOrder:-1,
  matrixWorld:{elements:[1,0,0,0,0,1,0,0,0,0,1,0,.5,7.018,.5,1]},
  traverse(fn){fn(this);},
  onBeforeRender(){beforeCalls++;}, onAfterRender(){afterCalls++;},
}; // Parent-composed world height, as used by NPC-local shadows.
api.bindGroundProjection(mesh);
const hook = mesh.onBeforeRender; // Binding must be idempotent.
api.bindGroundProjection(mesh);
assert.strictEqual(mesh.onBeforeRender,hook);
assert(mesh.renderOrder > 22.1);
for(let draw=0;draw<20;draw++) {
  mesh.onBeforeRender(null,scene);
  assert(Math.abs(mesh.matrixWorld.elements[13]-7.238)<1e-10);
  mesh.onAfterRender();
  assert(Math.abs(mesh.matrixWorld.elements[13]-7.018)<1e-10);
}
assert.strictEqual(beforeCalls,20); assert.strictEqual(afterCalls,20);
area = 'map_i_den_map_western_slope_test';
assert.strictEqual(api.projectionLiftAt(.5,.5),0);
area='farm';
assert.strictEqual(api.projectionLiftAt(.5,.5),0);
season='Coldmuck';
assert.strictEqual(api.projectionLiftAt(.5,.5),.22);
season='Longpour';
mesh.onBeforeRender(null,scene);
assert(Math.abs(mesh.matrixWorld.elements[13]-7.018)<1e-10);
mesh.onAfterRender();
console.log('Snow/slush ground projection behavior passed.');
