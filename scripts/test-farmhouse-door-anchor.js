#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict'); // Verifies the live HousePieces world-object registrations.

function makeMesh() {
  return { // Minimal Three-like group used by the house renderer during this logic-only test.
    position: { set() {} },
    userData: {},
    add() {},
    traverse() {},
  };
}

global.window = global; // Supplies the browser global expected by house-pieces-core.js.
global.THREE = {}; // HousePieceGen receives this token but the test renderer never constructs geometry.
global.HousePieceGen = { // Keeps the test focused on door registration instead of Three.js rendering.
  shingleReady: () => true,
  buildGroup: makeMesh,
  buildGroupFromPiece: makeMesh,
  buildEntryTunnelGroup: makeMesh,
  buildChimneyGroup: makeMesh,
};

require('../docs/js/house-pieces-core.js');

let pieces = []; // Mutable house-piece collection used by the injected module dependencies.
const worldObjects = new Map(); // Mirrors the farm's tile-keyed interaction/occupancy map.
const grid = Array.from({ length: 20 }, () => Array.from({ length: 20 }, () => ({ type: 'grass', crop: '' }))); // Clear farm ground for the starter house.
const scene = { add() {}, remove() {} }; // Accepts generated placeholder groups without rendering them.

window.HousePieces.init({
  TileType: {
    TRENCH: 'trench', TILLED: 'tilled', RAISED: 'raised', PADDY: 'paddy',
    RIVER: 'river', STREAM: 'stream', WATERFALL: 'waterfall', RAMP: 'ramp',
    ROCK: 'rock', SHRUB: 'shrub', WEEDS: 'weeds',
  },
  COLS: 20,
  ROWS: 20,
  scene,
  worldObjects,
  houseWallBuilder: {},
  getGrid: () => grid,
  getHousePieces: () => pieces,
  setHousePieces: next => { pieces = next; },
  getFarmBuildings: () => [],
  getPieceCatalog: () => ({}),
  loadHousePieceFaceTexture: () => ({}),
  onPieceGeometryChanged() {},
  markTileDirty() {},
  recomputeWater() {},
  hasFarmPermission: () => true,
  saveFarmLayout() {},
  saveMemberWorldData() {},
  debugLog() {},
});

window.HousePieces.seedStarter(4, 4);

const feature = window.HousePieces.debugPieceFeatures() // Locates the starter house's auto-derived south entrance.
  .flatMap(piece => piece.features)
  .find(candidate => candidate.type === 'entrance');
assert(feature, 'starter house has an entrance');
assert.equal(feature.doorTile, '6,6', 'interaction is registered on the wall/entry-tunnel tile');
assert.equal(feature.approachTile, '6,7', 'the exterior tile remains a separate approach reservation');
assert.equal(worldObjects.get(feature.doorTile)?.type, 'house_entrance');
assert.equal(worldObjects.get(feature.doorTile)?.getButtons()[0]?.action, 'obj_enter_house');
assert.equal(worldObjects.get(feature.approachTile)?.type, 'house_entrance_approach');
assert.deepEqual(worldObjects.get(feature.approachTile)?.getButtons(), [], 'aiming at the approach tile no longer enters');

window.HousePieces.rebuildStructureMeshes();
assert.equal(worldObjects.get(feature.doorTile)?.type, 'house_entrance', 'door survives a structure rebuild');
assert.equal(worldObjects.get(feature.approachTile)?.type, 'house_entrance_approach', 'approach reservation survives a structure rebuild');

window.HousePieces.clearAll();
assert.equal(worldObjects.size, 0, 'clearing the house removes door, approach, and restored footprint objects');

console.log('farmhouse door anchor checks passed');
