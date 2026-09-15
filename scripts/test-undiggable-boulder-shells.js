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

console.log('Undiggable boulder shell tests passed.');
