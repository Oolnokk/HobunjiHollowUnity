#!/usr/bin/env node
'use strict';

// Exercise the real farmhouse recovery routine with isolated world-storage
// adapters. These assertions protect older saves when new room walls cover
// previously legal furniture tiles.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../docs/game.js'), 'utf8'); // Use the live game function, not a duplicated implementation.
const start = source.indexOf('function reconcileFurnitureWithFarmhousePartitions() {');
const end = source.indexOf('\n      function removeDecorativeFurniture(', start);
assert(start >= 0 && end > start, 'farmhouse furniture migration entry point must exist');

const grass = 'grass', rock = 'rock'; // The mocked grid has the same tile-type comparisons as gameplay.
const interiorGrid = Array.from({ length: 20 }, () => Array.from({ length: 20 }, () => ({ type: grass })));
const furniture = []; // Mutable authoritative furniture instances that the recovery routine may move or remove.
const changes = { saved: 0, moves: [], removals: [] }; // Captures all effects without a browser or game loop.
const storage = {}; // Simulated world-scoped farm storage used only for overflow recovery.
let allowStorage = true; // Tests both successful and rejected storage transactions.
const scene = vm.createContext({
  window: { WallOrnamentPlacement: { isPlayerMounted: () => false } },
  housePieces: [{ id: 'main', col: 1, row: 1, w: 4, h: 3, stage: 'built' }],
  interiorFurnitureObjects: furniture,
  interiorGrid,
  TileType: { ROCK: rock },
  interiorRoomRect: piece => ({ col: piece.col * 2, row: piece.row * 2, w: piece.w * 2, h: piece.h * 2 }), // The new recovery loop searches the actual indoor piece rectangle.
  _interiorRoomDoorTiles: new Set(['5,2']), // Door tiles must stay unoccupied after a migration.
  _interiorArrivalTiles: new Set(['5,3']), // Exterior house arrivals must stay unoccupied too.
  DECORATIVE_FURNITURE_DEFS: { chair: { itemKey: 'chairFurniture' } },
  decorativeFurnitureSize: () => ({ fw: 1, fd: 1 }),
  canPlaceDecorativeFurnitureAt(col, row, ignoreId) {
    return interiorGrid[row]?.[col]?.type === grass && !(col === 5 && (row === 2 || row === 3))
      && !furniture.some(f => f.id !== ignoreId && f.col === col && f.row === row);
  },
  moveDecorativeFurniture(id, col, row, opts) {
    assert.equal(opts.area, 'interior');
    assert.equal(opts.skipSave, true, 'migration must not save an incomplete world layout');
    const object = furniture.find(f => f.id === id);
    if (!object) return { ok: false };
    changes.moves.push({ id, before: [object.col, object.row], after: [col, row] });
    object.col = col; object.row = row;
    return { ok: true };
  },
  _loadWorldStorage: () => ({ ...storage }), // Mirrors the parsed snapshot returned by the real world-meta store.
  _saveWorldStorage: updated => {
    changes.saved++;
    if (!allowStorage) return false;
    Object.assign(storage, updated);
    return true;
  },
  disposeDecorativeFurniture(object) {
    changes.removals.push(object.id);
    const index = furniture.indexOf(object);
    if (index >= 0) furniture.splice(index, 1);
  },
});
const reconcile = vm.runInContext(source.slice(start, end) + '\nreconcileFurnitureWithFarmhousePartitions', scene);

const chair = () => ({ id: 'old-chair', area: 'interior', ownerPieceId: 'main', key: 'chair', col: 4, row: 4, rotYDeg: 0 });
furniture.push(chair());
interiorGrid[4][4].type = rock;
let result = reconcile();
assert.equal(result.length, 1);
assert.equal(result[0].action, 'moved', 'an obstructed furniture piece moves into a valid nearby floor tile');
assert.equal(result[0].from.join(','), '4,4', 'the diagnostic records the original tile before moving');
assert.equal(changes.saved, 0, 'successful relocation does not modify world storage');
assert.equal(changes.removals.length, 0);
assert.notEqual(furniture[0].col + ',' + furniture[0].row, '5,2', 'no object is relocated into a room doorway');

// With no valid destination, storage receives the item before the scene object is disposed.
furniture.length = 0;
furniture.push(chair());
for (const row of interiorGrid) for (const tile of row) tile.type = rock;
result = reconcile();
assert.equal(result[0].action, 'stored');
assert.equal(storage.chairFurniture, 1);
assert.equal(furniture.length, 0);
assert.equal(changes.removals.length, 1);

// A failed storage write must leave the original physical item intact.
furniture.push(chair());
allowStorage = false;
result = reconcile();
assert.equal(result[0].action, 'unresolved');
assert.equal(furniture.length, 1);
assert.equal(changes.removals.length, 1, 'no second disposal on failed storage write');
assert.equal(storage.chairFurniture, 1, 'a failed storage transaction never creates an extra stored copy');

// Derived windows belong to their wall bindings and must not be treated as ordinary floor furniture.
furniture.length = 0;
furniture.push({ ...chair(), derivedLinkedWindow: true });
assert.equal(reconcile().length, 0);
assert.equal(furniture.length, 1);
console.log('Farmhouse furniture recovery: all regression assertions passed.');
