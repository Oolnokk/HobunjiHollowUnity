// Executes js/camera-tile-collision.js (the grid half of the camera boom
// collision extracted from game.js) against a small hand-built grid.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = vm.createContext({ window: {} });
vm.runInContext(fs.readFileSync('docs/js/camera-tile-collision.js', 'utf8'), context);
const api = context.window.CameraTileCollision;

const grid = [];
for (let r = 0; r < 3; r++) grid.push(Array.from({ length: 8 }, () => ({ type: 'floor' })));
grid[1][4] = { type: 'rock' }; // Structural wall on the boom's row.
grid[1][2] = { type: 'floor', npcFurnitureCollider: true }; // Furniture footprint: NPC-blocking, not structural.
let area = 'map_i_test_room';
api.init({
  getCurrentArea: () => area,
  npcGridForArea: () => grid,
  isSolid: type => type === 'rock',
  isNpcTileWalkable: (_, c, r) => !!grid[r]?.[c] && grid[r][c].type !== 'rock' && !grid[r][c].npcFurnitureCollider,
  tileSurfaceYInArea: () => 0,
  isBuildingArea: id => id.startsWith('map_i_'),
  interiorWallHeight: () => 1.75,
});

// Full walkability stops at the furniture footprint entered at x = 2.
const hitFurniture = api.distance(0.5, 1, 1.5, 7.5, 1, 1.5);
assert.ok(Math.abs(hitFurniture - 1.5) < 0.02, `furniture footprint blocks the boom at its tile edge (got ${hitFurniture})`);

// Structural-only probes ignore the furniture and stop at the rock wall at x = 4.
const hitWall = api.distance(0.5, 1, 1.5, 7.5, 1, 1.5, true);
assert.ok(Math.abs(hitWall - 3.5) < 0.02, `structural probe passes furniture and stops at the wall (got ${hitWall})`);

// Furniture footprints are only 1.45 tall: a boom passing above them is clear.
assert.equal(api.distance(0.5, 2, 1.5, 3.5, 2, 1.5), null, 'boom above a furniture footprint is unobstructed');

// No grid (e.g. an unloaded area) and degenerate segments report no collision.
area = 'farm';
api.init({ getCurrentArea: () => area, npcGridForArea: () => null });
assert.equal(api.distance(0, 1, 0, 5, 1, 0), null, 'missing grid reports no collision');

console.log('camera-tile-collision: ok');
