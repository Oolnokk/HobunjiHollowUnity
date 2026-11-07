'use strict';

const assert = require('node:assert/strict'); // Validates real public house edits and their side effects.
const fs = require('node:fs'); // Loads the production house module without replacing its adjacency rules.
const vm = require('node:vm'); // Only rendering and persistence are stubbed.
const source = fs.readFileSync('docs/js/house-pieces-core.js', 'utf8'); // Shared source for isolated farm layouts below.

function fixture(records) {
  let pieces = records.map(record => ({ pieceKey: 'wing', stage: 'built', features: [], ...record })); // Live authoritative house registry.
  const worldObjects = new Map(); // A rejected edit must leave every footprint registration untouched.
  const grid = Array.from({ length: 20 }, () => Array.from({ length: 20 }, () => ({ type: 'grass', crop: '' }))); // Clear ground isolates connectivity validation.
  const calls = { saves: 0, recovered: 0 }; // Demolition must validate before recovering or deleting furniture.
  for (const room of pieces) {
    room._worldObj = { id: room.id };
    for (let row = room.row; row < room.row + room.h; row++) for (let col = room.col; col < room.col + room.w; col++) worldObjects.set(col + ',' + row, room._worldObj);
  }
  const window = {}; // No generator is needed to execute the real placement/rotation/demolition paths.
  vm.runInNewContext(source, { window, console });
  window.HousePieces.init({ TileType: {}, COLS: 20, ROWS: 20, getGrid: () => grid,
    getHousePieces: () => pieces, setHousePieces: next => { pieces = next; }, getFarmBuildings: () => [], worldObjects,
    getPieceCatalog: () => ({ wing: { label: 'Wing' } }), hasFarmPermission: () => true,
    scene: { remove() {} }, debugLog() {}, recomputeWater() {}, markTileDirty() {},
    recoverFurnitureInInteriorRect() { calls.recovered++; return 1; },
    saveFarmLayout() { calls.saves++; }, saveMemberWorldData() {} });
  return { api: window.HousePieces, pieces: () => pieces, worldObjects, calls };
}

function chain() {
  return fixture([
    { id: 'house_starter', pieceKey: 'starter', col: 2, row: 2, w: 2, h: 2 },
    { id: 'bridge', col: 4, row: 2, w: 4, h: 2 },
    { id: 'end', col: 8, row: 2, w: 2, h: 2 },
  ]);
}

const moving = chain(); // The moved bridge would still touch the end room while detaching the entire wing.
const before = [...moving.worldObjects]; // Compare registrations as well as coordinates after failed validation.
assert.equal(moving.api.canMovePieceTo('bridge', 8, 4), false);
assert.equal(moving.api.movePiece('bridge', 8, 4).ok, false);
assert.equal(moving.pieces()[1].col, 4);
assert.deepEqual([...moving.worldObjects], before);
assert.equal(moving.calls.saves, 0);

const turning = chain(); // Swapping the bridge's dimensions would lose its connection to the end room.
assert.equal(turning.api.rotatePiece('bridge').ok, false);
assert.equal(turning.pieces()[1].w, 4);
assert.equal(turning.calls.saves, 0);

const removing = chain(); // Removing a bridge must not first refund furniture and strand the surviving wing.
assert.equal(removing.api.demolish('bridge').ok, false);
assert.equal(removing.calls.recovered, 0);
assert.equal(removing.pieces().length, 3);
assert.equal(removing.calls.saves, 0);
assert.equal(removing.api.demolish('end').ok, true, 'removing a peripheral room remains allowed');
assert.equal(removing.calls.recovered, 1);

const peripheral = chain(); // A leaf room may be moved to a different shared edge without splitting the house.
assert.equal(peripheral.api.canMovePieceTo('end', 4, 4), true);
assert.equal(peripheral.api.movePiece('end', 4, 4).ok, true);
assert.equal(peripheral.calls.saves, 1);

const alternate = fixture([
  { id: 'house_starter', pieceKey: 'starter', col: 2, row: 2, w: 2, h: 2 },
  { id: 'east', col: 4, row: 2, w: 2, h: 2 },
  { id: 'south', col: 2, row: 4, w: 2, h: 2 },
  { id: 'corner', col: 4, row: 4, w: 2, h: 2 },
]); // Existing alternate routes permit a room to move or be removed.
assert.equal(alternate.api.movePiece('east', 6, 4).ok, true);
assert.equal(alternate.api.demolish('east').ok, true);

const legacy = fixture([
  { id: 'house_starter', pieceKey: 'starter', col: 2, row: 2, w: 2, h: 2 },
  { id: 'isolated', col: 8, row: 2, w: 2, h: 2 },
]); // A save already affected by the old bug can reconnect its isolated room.
assert.equal(legacy.api.movePiece('isolated', 4, 2).ok, true);

console.log('house connectivity: bridge moves, rotations and demolition blocked; alternate routes, peripheral edits and legacy reconnection passed');
