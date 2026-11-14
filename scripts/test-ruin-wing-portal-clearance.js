#!/usr/bin/env node
'use strict';
// Regression: every visibly open upper-floor wing entrance must have the same
// three-cell walkable throat in the shaft voxel grid and in the wing corridor.
// Native V50 entry doors intentionally retain their one-cell authored opening.
const assert = require('node:assert/strict');
const Plan = require('../docs/js/ruin-layer-plan.js');
const Hub = require('../docs/js/shaft-hub.js');
const Playable = require('../docs/js/ruin-layer-playable.js');

const SIDES = ['N', 'E', 'S', 'W']; // Exercise all cardinal layouts, not only the seed's original wing orientations.
const THEMES = ['tothal', 'hronal', 'kanthic']; // Theme-specific puzzle selection can change stage geometry without changing the entrance contract.
function leadsToFirstRoom(start, tiles, room) {
  const key = (x,z) => x+','+z;
  const visited = new Set([key(...start)]); // Bounded flood from one actual portal lane through the exact generated wing floor.
  const queue = [start]; // A separate queue per lane proves none of the three seemingly open lanes ends in an isolated tile.
  for (let i=0; i<queue.length; i++) {
    const [x,z] = queue[i];
    if (x>=room.x&&x<room.x+room.w&&z>=room.z&&z<room.z+room.d)return true;
    for (const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx=x+dx,nz=z+dz,nk=key(nx,nz);
      if (visited.has(nk)||!tiles.has(nk))continue;
      visited.add(nk);queue.push([nx,nz]);
    }
  }
  return false;
}
const SEEDS = [3687055066, 1, 104729, 7919, 0x7fffffff]; // Includes the F2 blocked-doorway report plus different layout/offset rolls.
let checked = 0; // Count physically inspected mouths for the test summary.
for (const tier of ['cave', 'hole', 'lich']) for (const theme of THEMES) for (const seed of SEEDS) for (const entrySide of SIDES) {
  const plan = Plan.compose({
    seed, theme, spacing:64, anchorX:256, anchorZ:256, groundEntranceSide:entrySide,
    ...Plan.tierOptions(tier),
  });
  assert.ok(plan.ok, `${tier}/${seed}/${entrySide}: invalid plan ${plan.checks.filter(c=>!c.ok).map(c=>c.name)}`);
  const portals = plan.floors.flatMap(f => f.wings.map(w => ({
    floor:f.floor, side:w.side, width:plan.options.corridorWidth,
  })));
  const opts = {
    seed, floors:plan.floorCount, chambers:false, wall:plan.options.shaftWall,
    shaft:plan.options.shaftSize, spacing:plan.options.floorHeight,
    traversal:plan.options.shaftTraversal, entranceSide:entrySide, theme, portals,
  };
  const dimensions = Hub.compose(opts);
  const hub = Hub.compose({
    ...opts, originX:plan.shaft.anchor.x-Math.floor(dimensions.cols/2),
    originZ:plan.shaft.anchor.z-Math.floor(dimensions.rows/2),
  });
  assert.ok(hub.ok, `${tier}/${seed}/${entrySide}: invalid shaft ${hub.checks.filter(c=>!c.ok).map(c=>c.name)}`);
  for (const floor of plan.floors) for (const wing of floor.wings) {
    const portal = hub.wingPortals.find(p => p.floor === floor.floor && p.side === wing.side);
    assert.ok(portal, `missing ${wing.id} portal`);
    assert.equal(portal.width, 3, `${wing.id}: corridor must have a full three-lane opening`);
    assert.equal(portal.mouth.length, portal.width, `${wing.id}: every lane must reach the shaft's outer edge`);
    const roomTiles = Playable.collect(wing);
    for (const [x,z] of portal.mouth) {
      assert.ok(roomTiles.has(x+','+z), `${wing.id}: visible wing floor missing at portal lane ${x},${z}`);
      assert.ok(leadsToFirstRoom([x,z],roomTiles,wing.rooms[0]),
        `${tier}/${theme}/${seed}/${entrySide}/${wing.id}: portal lane ${x},${z} cannot reach its first room`);
      const col = hub.grid.xToCol(x+.5), row = hub.grid.zToRow(z+.5);
      assert.ok(hub.grid.canStand(col,row,portal.level), `${wing.id}: open doorway has solid collision at ${x},${z}`);
      assert.ok(hub.grid.hasHeadroom(col,row,portal.level), `${wing.id}: doorway headroom blocked at ${x},${z}`);
    }
    assert.equal(portal.tunnel.length,portal.width*(plan.options.shaftWall+1),
      `${wing.id}: every shaft-wall depth must be carved across the full corridor width`);
    for (const tile of portal.tunnel)
      assert.ok(hub.grid.canStand(tile.col,tile.row,portal.level),
        `${wing.id}: hidden solid in the doorway tunnel ${tile.col},${tile.row}`);
    checked++;
  }
}
// The native V50 corridor uses a single-tile threshold at its authored entrance.
const nativePlan = Plan.compose({
  seed:3687055066, spacing:64, anchorX:256, anchorZ:256,
  groundEntranceSide:'W', nativeV50:true,
});
assert.ok(nativePlan.ok);
for (const floor of nativePlan.floors.filter(f=>f.nativePort)) {
  const h=Hub.compose({
    seed:3687055066, floors:nativePlan.floorCount, shaft:nativePlan.options.shaftSize,
    wall:nativePlan.options.shaftWall, spacing:nativePlan.options.floorHeight,
    portals:[{floor:floor.floor,side:floor.nativePort.side,width:1}],
  });
  assert.ok(h.ok);
  const portal=h.wingPortals[0];
  assert.equal(portal.width,1);
  assert.equal(portal.mouth.length,1);
}
console.log(`ok ruin wing doorway clearance: ${checked} three-wide traversable wing mouths across all themes; native doors stay one-wide`);
