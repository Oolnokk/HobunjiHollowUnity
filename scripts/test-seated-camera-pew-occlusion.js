'use strict';
const assert = require('node:assert/strict'); // Checks camera obstacles against the occupied authored seat.
const fs = require('node:fs'); // Reads the actual game collector and authored Temple placements.
const vm = require('node:vm'); // Executes production camera selection without a renderer.
const game = fs.readFileSync('docs/game.js', 'utf8'); // Exercises the same seat filter shipped to the browser.
const temple = JSON.parse(fs.readFileSync('docs/config/maps/map_i_temple.json', 'utf8')); // Real pew grid coordinates.
const pews = temple.furniture.filter(piece => piece.itemKey === 'benchFurniture'); // Neighboring pews must remain camera obstacles.
assert(pews.length >= 2, 'Temple must contain at least two pews');
const activePew = pews[0], neighborPew = pews[1]; // Distinct coordinates for the active and adjacent seats.
const makeRoot = piece => ({ userData: { mapEditorRef: {
  mapId: 'map_i_temple', kind: 'furniture', itemKey: piece.itemKey,
  col: piece.col, row: piece.row,
} }, parent: null }); // Reproduces loadBuildingScene's authored furniture metadata.
const occupiedRoot = makeRoot(activePew); // The seated player's own pew.
const occupiedChild = { userData: { cameraObstacle: true }, parent: occupiedRoot }; // Tagged nested furniture geometry.
const occupiedChunk = { userData: { cameraObstacleSource: occupiedChild }, parent: null }; // Large camera-obstacle proxy.
const neighbor = makeRoot(neighborPew); // A distinct pew must still block the camera.
const wall = { userData: { cameraObstacle: true }, parent: null }; // Architecture must also keep blocking.
const obstacles = [occupiedRoot, occupiedChild, occupiedChunk, neighbor, wall]; // Cached scene obstacles from the actual collector.
const context = {
  sitInteraction: { furnitureKey: 'bench', col: activePew.col, row: activePew.row, phase: 'active' },
  DECORATIVE_FURNITURE_DEFS: { bench: { itemKey: 'benchFurniture' } },
  PROCESSING_FURNITURE_DEFS: {},
  currentArea: 'map_i_temple',
  _isZoneArea: () => false, _isBuildingArea: area => area.startsWith('map_i_'),
  _buildingScenes: new Map([['map_i_temple', { occlusionMeshes: obstacles }]]),
  interiorFurnitureObjects: [],
}; // Minimal live closure dependencies required to evaluate the real building-area path.
const start = game.indexOf('      // An occupied authored seat appears'); // Includes the production filter and its collector.
const end = game.indexOf('      // Pulls the camera in along the target', start); // Stops immediately before unrelated camera math.
assert(start >= 0 && end > start, 'production occupied-seat filter and camera collector must exist');
vm.runInNewContext(game.slice(start, end)
  + '\nthis.collect = currentAreaOcclusionMeshes; this.isOccupied = cameraObstacleIsCurrentSeat;', context);
const selected = context.collect(); // Executes currentAreaOcclusionMeshes on the populated Temple scene.
assert.equal(selected.length, 2, 'active pew root, child and chunk proxy must all be excluded');
assert(selected.includes(neighbor) && selected.includes(wall), 'other pews and building walls must stay solid');
assert(context.isOccupied(occupiedRoot) && context.isOccupied(occupiedChild) && context.isOccupied(occupiedChunk));
assert(!context.isOccupied(neighbor) && !context.isOccupied(wall));
context.sitInteraction.phase = 'out';
assert.equal(context.collect().length, 2, 'standing up must not collide with the seat until the transition finishes');
context.sitInteraction = null;
assert.equal(context.collect().length, obstacles.length, 'the normal camera collision list returns after standing');
context.sitInteraction = { furnitureKey: 'benchFurniture', col: activePew.col, row: activePew.row, phase: 'active' };
assert.equal(context.collect().length, 2, 'direct item-key seats are supported in addition to the runtime furniture key');
context.currentArea = 'map_i_other';
assert(!context.isOccupied(occupiedRoot), 'the seat filter cannot mistakenly suppress furniture in another building');
console.log('Seated camera pew occlusion: occupied root, child, proxy, neighbors, and lifecycle passed.');
