#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = { console };
context.window = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync('docs/js/grid-tile-accessors.js', 'utf8'), context, { filename: 'grid-tile-accessors.js' });

const area = 'test-cliff-cave';
const den = {
  x: 10,
  y: 10,
  w: 6,
  h: 5,
  cliffBacked: true,
  mouthAnchor: { x: 13, y: 12 },
};
const deps = {
  _zoneLayouts: new Map([[area, { dens: [den] }]]),
};
context.GridTileAccessors.init(deps);

for (let row = den.mouthAnchor.y; row < den.y + den.h; row++) {
  for (let col = den.mouthAnchor.x - 1; col <= den.mouthAnchor.x + 1; col++) {
    assert.equal(
      context.GridTileAccessors.isAnimalDenCollisionTile(col, row, area),
      false,
      `three-column cliff entrance swathe must remain open at ${col},${row}`,
    );
  }
  assert.equal(context.GridTileAccessors.isAnimalDenCollisionTile(10, row, area), true, 'rock left of the swathe stays solid');
  assert.equal(context.GridTileAccessors.isAnimalDenCollisionTile(15, row, area), true, 'rock right of the swathe stays solid');
}
assert.equal(context.GridTileAccessors.isAnimalDenCollisionTile(10, 11, area), true, 'rock behind the entrance band remains solid');
assert.equal(context.GridTileAccessors.isAnimalDenCollisionTile(9, 12, area), false, 'tiles outside the den footprint stay unaffected');

context.ZoneDenTotemFeatures = {
  denEntranceCollisionState: () => ({
    useLegacyCave: true,
    rects: [{ mode: 'rect', x: 10, y: 12, w: 1, h: 1 }],
  }),
};
assert.equal(context.GridTileAccessors.isAnimalDenCollisionTile(10, 12, area), true, 'authored colliders still override the widened legacy entrance clearance');
assert.equal(context.GridTileAccessors.isAnimalDenCollisionTile(12, 12, area), false, 'legacy shell remains clear beside an authored collider');

den.collapsed = true;
assert.equal(context.GridTileAccessors.isAnimalDenCollisionTile(13, 12, area), true, 'collapsed dens keep the entire former entrance solid');

console.log('cliff cave entrance lateral collision clearance checks passed');
