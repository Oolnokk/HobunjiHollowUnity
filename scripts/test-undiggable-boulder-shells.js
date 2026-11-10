'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repoRoot = path.resolve(__dirname, '..'); // Repository root used to load the runtime modules under test.
const featurePath = path.join(repoRoot, 'docs/js/zone-terrain-features.js'); // Contiguous boulder-shell implementation exercised below.
const gamePath = path.join(repoRoot, 'docs/game.js'); // Zone floor orchestration checked for the legacy-mound bypass.
const previewPath = path.join(repoRoot, 'docs/js/terrain-preview.js'); // Workspace fold checked for exact generated-object identity.
const featureSource = fs.readFileSync(featurePath, 'utf8'); // Runtime source evaluated with a minimal browser global.
const gameSource = fs.readFileSync(gamePath, 'utf8'); // Runtime source inspected to verify the new renderer is wired into chunk builds.
const previewSource = fs.readFileSync(previewPath, 'utf8'); // Source inspected for the boulder identity handoff.
const browser = {}; // Minimal window object receiving the module's public API.
vm.runInNewContext(featureSource, { window: browser, console, THREE: {} }, { filename: featurePath });
browser.ZoneTerrainFeatures.init({
  TileType: { ROCK: 'rock' },
  NORMAL_TOP: 0,
  PLATEAU_UNIT: 0.5,
});

const grass = () => ({ type: 'grass', elevTier: 0 }); // Ordinary surrounding tile factory used by test grids.
const boulder = id => ({ type: 'rock', rockKind: 'undiggableBoulder', boulderId: id, elevTier: 0 }); // Exact generated-object tile factory.
const grid = Array.from({ length: 5 }, () => Array.from({ length: 6 }, grass)); // Two deliberately disconnected boulder footprints.
grid[1][1] = boulder('map:test_a');
grid[1][2] = boulder('map:test_a');
grid[2][1] = boulder('map:test_a');
grid[3][4] = boulder('map:test_b');

const before = browser.ZoneTerrainFeatures.boulderShellSnapshot(); // Baseline cache counters isolate this grid's indexing work.
const shell = browser.ZoneTerrainFeatures.buildUndiggableBoulderShellData(grid, 6, 5); // Exterior geometry report verifies topology and peak policy.
const afterFirst = browser.ZoneTerrainFeatures.boulderShellSnapshot(); // First-build counters prove one full-grid index was created.
const repeated = browser.ZoneTerrainFeatures.buildUndiggableBoulderShellData(grid, 6, 5); // A later chunk request must reuse that index.
const afterRepeat = browser.ZoneTerrainFeatures.boulderShellSnapshot(); // Repeated-build counters catch the previous scan-per-chunk regression.
assert.equal(shell.componentCount, 2, 'tiles sharing an object ID should become one formation while a separate ID remains another');
assert.equal(shell.peakCount, 2, 'each exact generated object should have exactly one selected peak');
assert.equal(shell.topTileCount, 4, 'every footprint tile should contribute exterior top surface');
assert.equal(shell.perimeterEdgeCount, 12, 'the L-shaped footprint plus isolated tile should emit outer edges only');
assert.equal(shell.idx.length / 3, 128, 'only exterior top quads should remain; there are no buried bases or between-tile walls');
assert(shell.pos.every(Number.isFinite), 'every generated shell position should be finite');
for (const [row, cells] of grid.entries()) for (const [col, tile] of cells.entries()) {
  if (tile.type !== 'rock') continue;
  const tops = shell.pos.filter((_, index) => index % 3 === 1 && shell.pos[index - 1] >= col && shell.pos[index - 1] <= col + 1 && shell.pos[index + 1] >= row && shell.pos[index + 1] <= row + 1); // Rendered vertex heights over this tile must match its cached projectile top.
  assert(Math.abs(tile.projectileCoverHeightTiles + (tile.elevTier || 0) * 0.5 - Math.max(...tops)) < 1e-6, 'projectile cover height matches the generated shell');
}
assert(Math.max(...shell.pos.filter((_, index) => index % 3 === 1)) > 0.5, 'the combined surface should rise into a visible summit');
assert.deepEqual(repeated, shell, 'cached reconstruction should remain deterministic');
assert.equal(afterFirst.indexBuilds - before.indexBuilds, 1, 'the first request should index its grid exactly once');
assert.equal(afterRepeat.indexBuilds, afterFirst.indexBuilds, 'later chunk requests must not rescan the whole grid');
assert.equal(afterRepeat.indexHits - afterFirst.indexHits, 1, 'later requests should record a cache hit');

const chunkShell = browser.ZoneTerrainFeatures.buildUndiggableBoulderShellData(grid, 6, 5, {
  colStart: 2, colEnd: 3, rowStart: 1, rowEnd: 2,
}); // One-tile chunk slice verifies shape ownership remains streamable.
assert.equal(chunkShell.componentCount, 1, 'a chunk touching one part of a larger formation should emit that global shell portion');
assert.equal(chunkShell.topTileCount, 1, 'chunk clipping should not duplicate adjacent top patches');
assert.equal(chunkShell.perimeterEdgeCount, 3, 'chunk clipping should retain only true global perimeter sides owned by its tile');

const touchingGrid = [[boulder('map:left'), boulder('map:right')]]; // Adjacent but separately generated boulders must not be fused.
const touchingShell = browser.ZoneTerrainFeatures.buildUndiggableBoulderShellData(touchingGrid, 2, 1);
assert.equal(touchingShell.componentCount, 2, 'generator IDs must keep touching boulder objects separate');
assert.equal(touchingShell.peakCount, 2, 'touching generated objects retain independent summits');

assert(gameSource.includes("if (tile.rockKind === 'undiggableBoulder') continue;"), 'legacy per-tile mounds must be skipped for undiggable formations');
assert(gameSource.includes('ZoneTerrainFeatures.buildUndiggableBoulderMeshes(group, zGrid, ZCOLS, ZROWS, mapId, bounds)'), 'streamed zone chunks must invoke the contiguous shell renderer');
assert(gameSource.includes('zGrid[r][c].boulderId = boulderId || null'), 'runtime grids must retain the exact generated boulder identity');
assert(previewSource.includes("boulderId: type === 'rock' && t.generatedObjectType === 'undiggableBoulder'"), 'merged generated maps must preserve boulder IDs');


const TerrainPreview = require('../docs/js/terrain-preview.js'); // Actual generator-to-game tile fold, exercised without a WebGL renderer.
const rootId = 'map_test_wide_boulder'; // Shared parent identity for rock spanning root plateau rings and child interior tiles.
const plateauId = 'test_raised_plateau'; // Generated plateau whose outer ring previously swallowed boulder rock tiles.
const rootMap = { id: rootId, cols: 6, rows: 6, tiles: {} }; // Minimal parent map covering an edge-crossing 2x2 boulder.
for (let r = 1; r <= 4; r++) for (let c = 1; c <= 4; c++) rootMap.tiles[`${c},${r}`] = { type: 'grass', plateau: plateauId };
for (const [c, r] of [[1, 2], [2, 2], [1, 3], [2, 3]]) {
  rootMap.tiles[`${c},${r}`] = { type: 'rock', plateau: plateauId, generatedObjectType: 'undiggableBoulder', generatedObjectId: 'wide_rock' };
}
const childMap = { id: 'map_test_plateau_child', parentMapId: rootId, isSubmap: true, plateauGroupId: plateauId, cols: 2, rows: 2,
  tiles: { '0,0': { type: 'rock', generatedObjectType: 'undiggableBoulder', generatedObjectId: 'wide_rock' }, '0,1': { type: 'rock', generatedObjectType: 'undiggableBoulder', generatedObjectId: 'wide_rock' } } }; // Child overwrites the interior part of the same wide boulder.
const merged = TerrainPreview.buildMergedZoneGrid({ maps: [rootMap, childMap], plateauGroups: [{ id: plateauId, elevation: 3 }] }, rootId); // Mirrors the live Tothal Shift fold.
for (const [c, r] of [[1, 2], [2, 2], [1, 3], [2, 3]]) {
  const tile = merged.tiles.get(`${c},${r}`); // Collision authority used when buildZoneScene copies this tile into the active grid.
  assert.equal(tile.type, 'rock', 'every tile under a wide plateau boulder must block walking');
  assert.equal(tile.rockKind, 'undiggableBoulder', 'boulder origin must survive the plateau edge and child overlay');
  assert.equal(tile.boulderId, rootId + ':wide_rock', 'the root and child must retain one shared boulder identity');
}
const mergedGrid = TerrainPreview.buildZGrid(merged.cols, merged.rows, merged.tiles); // Verifies that the rendered footprint is also solid in the dense source grid.
assert.equal(mergedGrid[2][1].type, 'rock', 'the outer plateau ring must not erase the rock collision tile');
assert(gameSource.includes("const isGeneratedBoulder = t?.plateau && t.type === 'rock' && t.generatedObjectType === 'undiggableBoulder'"), 'the live game must preserve generated plateau boulders just like terrain preview');
assert(gameSource.includes("boulderId: t.generatedObjectId ? (m.parentMapId || m.id) + ':' + t.generatedObjectId : undefined"), 'the live game must not split wide boulder IDs across plateau submaps');


const WildernessMapGenerator = require('../docs/js/wilderness-map-generator.js'); // Real generated zone data guards against a purely synthetic boulder-collision test passing.
const generatedWorkspace = WildernessMapGenerator.generateWorkspace('boulder collision qa', {
  width: 65, height: 65, entrySide: 'south', preset: 'custom', plateaus: 4, boulders: 100,
  rivers: 0, ponds: 0, plateauPonds: 0, plateauStreams: 0, waterfalls: 0, structures: 0,
}); // A deterministic wilderness with actual broad boulders and plateau overlaps.
const generatedRoot = generatedWorkspace.maps[0]; // Root of the real generator's exported Map Editor workspace.
const generatedMerge = TerrainPreview.buildMergedZoneGrid(generatedWorkspace, generatedRoot.id); // Actual generated source consumed by the live zone builder.
const gameGrid = Array.from({ length: generatedMerge.rows }, () =>
  Array.from({ length: generatedMerge.cols }, () => ({ type: 'grass' }))); // Full live-like runtime grid for direct movement checks.
for (const [key, tile] of generatedMerge.tiles) {
  const [col, row] = key.split(',').map(Number); // World coordinates of the merged source tile.
  if (gameGrid[row]?.[col]) gameGrid[row][col] = tile;
}
const movementContext = {
  TileType: { ROCK: 'rock', SHRUB: 'shrub', GRASS: 'grass', RIVER: 'river', STREAM: 'stream' },
  TILE: 32, SWIM_SPEED_MUL: 0.5, currentArea: 'map_northern_cliffs', player: { x: 48, y: 48 },
  isSolid: type => type === 'rock' || type === 'shrub',
  _isZoneArea: () => true, _isCavernBuildingArea: () => false,
  furnitureBlocksMovementAt: () => false, tileSurfaceYInArea: tile => (tile.elevTier || 0) * 0.5,
  window: { GridTileAccessors: {
    getActiveCols: () => generatedMerge.cols, getActiveRows: () => generatedMerge.rows,
    getActiveGrid: () => gameGrid, isHouseFootprint: () => false,
    isFarmBuildingCollisionTile: () => false, isTownBuildingCollisionTile: () => false,
  }, AreaFootprintBlockers: { blocksBox: () => false },
    FurnitureTableSystem: { blocksBox: () => false },
    ProjectileTileCover: { coverTop: () => 1 },
  },
}; // Same tileSpeedAt/canOccupyAt dependencies used by the normal player, mount, and creature movement paths.
function extractGameFunction(name) {
  const start = gameSource.indexOf(`      function ${name}(`); // Real gameplay function, not a substitute collision algorithm in this test.
  const end = gameSource.indexOf('\n      }', start); // Hoisted top-level function boundary used by the existing projectile-cover test.
  assert(start >= 0 && end > start, `Cannot extract runtime movement function: ${name}`);
  return gameSource.slice(start, end + '\n      }'.length);
}
vm.runInNewContext(`${extractGameFunction('tileSpeedAt')}\n${extractGameFunction('canOccupyAt')}\nthis.__realBoulderOccupancy = canOccupyAt;`, movementContext);
let actualBoulderTiles = 0; // Number of genuine exported boulder tiles tested for walking collision.
const realObjectTileCounts = new Map(); // Checks multi-tile objects, not only incidental one-cell rocks.
for (let row = 0; row < gameGrid.length; row++) for (let col = 0; col < gameGrid[row].length; col++) {
  const tile = gameGrid[row][col]; // Final tile from the generator's complete plateau merge.
  if (tile.rockKind !== 'undiggableBoulder') continue;
  actualBoulderTiles++;
  const key = tile.boulderId || `${col},${row}`; // Tracks one object's contiguous footprint.
  realObjectTileCounts.set(key, (realObjectTileCounts.get(key) || 0) + 1);
  assert.equal(movementContext.__realBoulderOccupancy((col + .5) * 32, (row + .5) * 32, 5), false,
    `Generated wilderness boulder must block player/mount movement at ${col},${row}`);
}
assert(actualBoulderTiles > 20, 'generated test map must contain real wilderness boulders');
assert([...realObjectTileCounts.values()].some(count => count >= 4),
  'collision must be tested on wide multi-tile boulders rather than only single rock cells');

console.log('Undiggable boulder shell and collision tests passed.');
