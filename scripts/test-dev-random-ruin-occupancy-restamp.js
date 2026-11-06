'use strict';
// Regression: the shaft connector stamps the vestibule corridor walkable in the ordinary interior
// grid and then calls TileOccupancy.create() again, which destroys the previous model. Destroying
// the old model used to revert EVERY tile it had ever seen to its first-seen type, turning the
// corridor back into rock, so the start room had no way out to the shaft.
// Runs the real occupancy module against a small grid.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class V { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } }
class Box3 { // Only walls are measured here: a stub wall carries its own world box.
  setFromObject(object) { this.min = new V(...object.box.min); this.max = new V(...object.box.max); return this; }
  isEmpty() { return false; }
}
const THREE = { Vector3: V, Box3, Matrix4: class {} };

const registered = [];
const window = {
  THREE,
  DynamicSurfaces: {
    registerBlocker: record => registered.push(record),
    remove: () => {},
    sampleSupport: () => null,
  },
  GridTileAccessors: { getCurrentArea: () => 'map_i_dev_random_ruin' },
  WildernessMap: { renderMapPanel() {} },
  AreaFootprintBlockers: null,
};
window.window = window;
const context = vm.createContext({
  window, THREE, console,
  document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
});
for (const name of ['dev-random-ruin-solid-footprints', 'dev-random-ruin-tile-occupancy']) {
  vm.runInContext(fs.readFileSync(`docs/js/${name}.js`, 'utf8'), context, { filename: `${name}.js` });
}
const Occupancy = window.DevRandomRuinTileOccupancy;
assert.ok(Occupancy?.create, 'occupancy module loads');

// 6x6 grid: room floor in rows 3-5, a void column (rock) above it for the future corridor.
const COLS = 6, ROWS = 6;
const grid = Array.from({ length: ROWS }, (_, row) =>
  Array.from({ length: COLS }, () => ({ type: row >= 3 ? 'grass' : 'rock' })));
const roomFloor = new Set();
for (let row = 3; row < ROWS; row++) for (let col = 0; col < COLS; col++) roomFloor.add(`${col},${row}`);

// A wall along the boundary between rows 1 and 2 (the way V50 walls sit on floor/void boundaries).
// Its sources make the first model run its grid sync, which snapshots every tile's type for destroy().
const wall = { id: 'w1', box: { min: [0, 0, 2], max: [COLS, 3, 2] }, updateWorldMatrix() {}, updateMatrixWorld() {} };

const makeConfig = floorSet => ({
  mapId: 'map_i_dev_random_ruin', scope: 'test', cols: COLS, rows: ROWS,
  floorSet, grid, solidType: 'rock',
  walls: [wall], solidRoots: [], mechanisms: new Map(), transitDoors: [], activators: [], pushBlocks: [],
  getPlayerPosition: () => ({ x: -1, z: -1 }),
});

Occupancy.create(makeConfig(roomFloor));
assert.ok(Occupancy.getSnapshot().sources['2,1'], 'fixture: the wall gives the first model sources, so it snapshots base tile types');

// The connector stamps a corridor (column 2, rows 0-2) walkable and adds it to the floor set...
const floorWithCorridor = new Set(roomFloor);
for (let row = 0; row < 3; row++) {
  grid[row][2] = { type: 'grass' };
  floorWithCorridor.add(`2,${row}`);
}
// ...then rebuilds the occupancy model, which destroys the first one.
Occupancy.create(makeConfig(floorWithCorridor));

for (let row = 0; row < 3; row++)
  assert.equal(grid[row][2].type, 'grass', `corridor tile 2,${row} must stay walkable after the occupancy model is rebuilt`);
assert.equal(grid[0][0].type, 'rock', 'void tiles stay solid');

console.log('dev random ruin occupancy re-stamp regression passed');
