#!/usr/bin/env node
'use strict';
const assert = require('assert');
const BSE = require('../docs/js/building-subtle-elevation.js');

function building(overrides = {}) {
  return {
    id: 'b', gridX: 1, gridZ: 1, footprintW: 2, footprintD: 2,
    footprintShape: { bboxW: 2, bboxD: 2, cells: [{x:0,y:0},{x:1,y:0},{x:0,y:1}] },
    subtleElevationOverride: { enabled: true, value: 0.4, radius: 0 },
    ...overrides,
  };
}

{
  const map = { id:'m', cols:6, rows:6, visualHeights:{'0,0':0.5,'5,5':-0.2}, buildings:[building()] };
  const stats = BSE.rebuildMapVisualHeights(map);
  assert.deepEqual(stats, { activeOverrides: 1, affectedCells: 3 });
  assert.equal(map.visualHeights['1,1'], 0.4);
  assert.equal(map.visualHeights['2,1'], 0.4);
  assert.equal(map.visualHeights['1,2'], 0.4);
  assert.equal(map.visualHeights['0,0'], 0.5, 'hand-painted height remains');
  assert.equal(map.visualHeights['5,5'], -0.2, 'unrelated hand-painted height remains');
}

{
  const b = building({ subtleElevationOverride:{enabled:true,value:0.25,radius:1} });
  const map = { cols:6, rows:6, visualHeights:{}, buildings:[b] };
  const cells = BSE.affectedCells(b, map);
  assert(cells.some(({c,r}) => c === 0 && r === 0), 'radius grows beyond footprint');
  assert(cells.some(({c,r}) => c === 3 && r === 2), 'radius includes diagonal/outer cells');
}

{
  const b = building({ rotationDeg:90 });
  assert.deepEqual(BSE.worldFootprintCells(b).sort((a,z)=>a.r-z.r||a.c-z.c), [
    {c:1,r:1},{c:1,r:2},{c:2,r:2}
  ]);
}

{
  const b = building();
  const map = { cols:8, rows:8, visualHeights:{'0,0':0.3}, buildings:[b] };
  BSE.rebuildMapVisualHeights(map);
  b.gridX = 4; b.gridZ = 4;
  BSE.rebuildMapVisualHeights(map);
  assert.equal(map.visualHeights['1,1'], undefined, 'old building stamp is removed after move');
  assert.equal(map.visualHeights['4,4'], 0.4, 'new building position is stamped');
  assert.equal(map.visualHeights['0,0'], 0.3, 'base paint survives move');
}

{
  const zero = building({ subtleElevationOverride:{enabled:true,value:0,radius:0} });
  const map = { cols:5, rows:5, visualHeights:{'1,1':0.8}, buildings:[zero] };
  BSE.rebuildMapVisualHeights(map);
  assert(Object.prototype.hasOwnProperty.call(map.visualHeights, '1,1'));
  assert.strictEqual(map.visualHeights['1,1'], 0, 'zero override is explicit, so it can cancel inherited height');
}

{
  const first = building({ id:'first', subtleElevationOverride:{enabled:true,value:0.2,radius:0} });
  const second = building({ id:'second', subtleElevationOverride:{enabled:true,value:-0.6,radius:0} });
  const map = { cols:5, rows:5, visualHeights:{}, buildings:[first,second] };
  BSE.rebuildMapVisualHeights(map);
  assert.equal(map.visualHeights['1,1'], -0.6, 'later building wins an overlap deterministically');
}

{
  const b = building();
  const map = { id:'m', cols:5, rows:5, visualHeights:{'0,0':0.2}, buildings:[b] };
  BSE.rebuildMapVisualHeights(map);
  const runtime = BSE.materializeMapForRuntime(map);
  assert(!('visualHeightBase' in runtime), 'editor bookkeeping is stripped from runtime clone');
  assert('visualHeightBase' in map, 'materialization does not mutate editor source');
  b.subtleElevationOverride.enabled = false;
  BSE.rebuildMapVisualHeights(map);
  assert(!('visualHeightBase' in map), 'last disabled override restores and releases base layer');
  assert.deepEqual(map.visualHeights, {'0,0':0.2});
}

{
  const piece = { currentPiece:{ footprint:{ cells:[{x:6,y:7},{x:7,y:7}], extensions:{entryTunnels:[{x:7,y:8}],chimneys:[{x:6,y:6}]}}}};
  assert.deepEqual(BSE.deriveFootprintShape(piece), {
    bboxW:2,bboxD:3,cells:[{x:0,y:1},{x:1,y:1},{x:1,y:2},{x:0,y:0}]
  });
}

console.log('building subtle elevation tests passed');
