'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repoRoot = path.resolve(__dirname, '..'); // Repository root used to load the runtime modules under test.
const featurePath = path.join(repoRoot, 'docs/js/zone-terrain-features.js'); // Contiguous boulder-shell implementation exercised below.
const gamePath = path.join(repoRoot, 'docs/game.js'); // Zone floor orchestration checked for the legacy-mound bypass.
const featureSource = fs.readFileSync(featurePath, 'utf8'); // Runtime source evaluated with a minimal browser global.
const gameSource = fs.readFileSync(gamePath, 'utf8'); // Runtime source inspected to verify the new renderer is wired into chunk builds.
const browser = {}; // Minimal window object receiving the module's public API.
vm.runInNewContext(featureSource, { window: browser, console, THREE: {} }, { filename: featurePath });
browser.ZoneTerrainFeatures.init({
  TileType: { ROCK: 'rock' },
  NORMAL_TOP: 0,
  PLATEAU_UNIT: 0.5,
});

const grass = () => ({ type: 'grass', elevTier: 0 }); // Ordinary surrounding tile factory used by test grids.
const boulder = () => ({ type: 'rock', rockKind: 'undiggableBoulder', elevTier: 0 }); // Undiggable footprint tile factory used by test grids.
const grid = Array.from({ length: 5 }, () => Array.from({ length: 6 }, grass)); // Two deliberately disconnected boulder footprints.
grid[1][1] = boulder();
grid[1][2] = boulder();
grid[2][1] = boulder();
grid[3][4] = boulder();

const components = browser.ZoneTerrainFeatures.collectUndiggableBoulderComponents(grid, 6, 5); // Connected-component result verifies adjacent source rocks combine.
const shell = browser.ZoneTerrainFeatures.buildUndiggableBoulderShellData(grid, 6, 5); // Exterior geometry report verifies topology and peak policy.
assert.equal(components.length, 2, 'three touching source tiles should become one formation while a separated tile remains another');
assert.equal(shell.componentCount, 2, 'the shell should represent both connected formations');
assert.equal(shell.peakCount, 2, 'each connected formation should have exactly one selected peak');
assert.equal(shell.topTileCount, 4, 'every footprint tile should contribute exterior top surface');
assert.equal(shell.perimeterEdgeCount, 12, 'the L-shaped footprint plus isolated tile should emit outer edges only');
assert.equal(shell.idx.length / 3, 224, 'top and perimeter triangle counts should contain no between-tile walls or buried base');
assert(shell.pos.every(Number.isFinite), 'every generated shell position should be finite');
assert(Math.max(...shell.pos.filter((_, index) => index % 3 === 1)) > 0.5, 'the combined surface should rise into a visible summit');

const chunkShell = browser.ZoneTerrainFeatures.buildUndiggableBoulderShellData(grid, 6, 5, {
  colStart: 2, colEnd: 3, rowStart: 1, rowEnd: 2,
}); // One-tile chunk slice verifies shape ownership remains streamable.
assert.equal(chunkShell.componentCount, 1, 'a chunk touching one part of a larger formation should emit that global shell portion');
assert.equal(chunkShell.topTileCount, 1, 'chunk clipping should not duplicate adjacent top patches');
assert.equal(chunkShell.perimeterEdgeCount, 2, 'chunk clipping should retain only true global perimeter sides owned by its tile');

assert(gameSource.includes("if (tile.rockKind === 'undiggableBoulder') continue;"), 'legacy per-tile mounds must be skipped for undiggable formations');
assert(gameSource.includes('ZoneTerrainFeatures.buildUndiggableBoulderMeshes(group, zGrid, ZCOLS, ZROWS, mapId, bounds)'), 'streamed zone chunks must invoke the contiguous shell renderer');

console.log('Undiggable boulder shell tests passed.');
