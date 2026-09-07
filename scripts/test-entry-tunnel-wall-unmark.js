'use strict';

const assert = require('assert'); // Used for authored tunnel/wall classification regression assertions.
const fs = require('fs'); // Used to read the real mine piece and browser bridge source.
const vm = require('vm'); // Used to execute the classic browser script against a lightweight HousePieceGen stub.

const moduleSource = fs.readFileSync('docs/js/entry-tunnel-wall-unmark.js', 'utf8'); // Used to test the exact runtime wrapper shipped by the game.
const minePiece = JSON.parse(fs.readFileSync('docs/config/pieces/mine_entrance.json', 'utf8')); // Used because its flat house cells are also tunnel cells and exposed the overlapping wall problem.
const formatSource = fs.readFileSync('docs/js/format-utils.js', 'utf8'); // Used to prove the new bridge is loaded before world structures build.

assert(formatSource.includes('entry-tunnel-wall-unmark.js?v=20260907a'), 'format-utils must synchronously load the entry-tunnel wall unmark bridge');

function normalizePiece(piece) { return piece?.currentPiece || piece; }
function makeGroup() { return { children: [], userData: {} }; }

const originalMine = JSON.parse(JSON.stringify(minePiece)); // Used to verify rendering never mutates the cached source piece.
const calls = []; // Used to inspect the piece that actually reaches HousePieceGen after the wrapper preprocesses it.
const windowStub = {
  HousePieceGen: {
    buildGroupFromPiece(THREE, piece, col, row, opts) {
      calls.push({ THREE, piece, col, row, opts });
      return makeGroup();
    },
  },
};
const context = vm.createContext({ window: windowStub, document: undefined, console, Math, Number, Object, String, Set, Map, Array }); // Used to run the browser bridge headlessly.
vm.runInContext(moduleSource, context, { filename: 'entry-tunnel-wall-unmark.js' });

const source = normalizePiece(minePiece);
const sourceWallCount = source.base.faces.filter(face => face.tag === 'wall').length;
const sourceTunnelCount = source.base.faces.filter(face => face.tag === 'entryTunnel').length;
assert(sourceWallCount > 0, 'Mine fixture must contain house wall faces');
assert(sourceTunnelCount > 0, 'Mine fixture must contain entry-tunnel faces');

const group = windowStub.HousePieceGen.buildGroupFromPiece({}, minePiece, 15, -1, { rotationDeg: 180 });
assert.strictEqual(calls.length, 1);
const rendered = normalizePiece(calls[0].piece);
const clearedFaces = rendered.base.faces.filter(face => face.tunnelInteriorWallCleared === true);
assert(clearedFaces.length > 0, 'Mine house-wall fragments submerged inside its tunnel cells should be unmarked');
assert(clearedFaces.every(face => face.tag === '' && face.tunnelInteriorWallOriginalTag === 'wall'), 'Cleared tunnel-interior fragments should retain geometry but lose only the wall tag');
assert.strictEqual(rendered.base.faces.filter(face => face.tag === 'entryTunnel').length, sourceTunnelCount, 'Tunnel geometry/tags must remain untouched');
assert.strictEqual(group.userData.entryTunnelWallFacesUnmarked, clearedFaces.length, 'Runtime group should expose the number of wall fragments unmarked for mobile-safe debugging');
assert.deepStrictEqual(minePiece, originalMine, 'Wall unmarking must not mutate the cached authored mine piece');

// A wall that merely crosses a tunnel cell must stay marked. The bridge only
// clears already-segmented/per-tile fragments wholly contained in the tunnel,
// avoiding accidental removal of a large wall above/beside an entrance.
const synthetic = {
  gridSize: 4,
  tileSize: 1,
  footprint: { cells: [{ x: 1, y: 2 }, { x: 2, y: 2 }], extensions: { entryTunnels: [{ x: 2, y: 2 }], tallEntryTunnels: [] } },
  base: {
    groundY: 0,
    faces: [
      { id: 'ceiling', tag: 'entryTunnel', extensionFace: 'ceiling', sourceTile: { x: 2, y: 2 }, v: [[0, 1.05, 0], [1, 1.05, 0], [1, 1.05, 1], [0, 1.05, 1]] },
      { id: 'inside', tag: 'wall', v: [[0, 0, 0.5], [0, 0.5, 0.5], [1, 0.5, 0.5], [1, 0, 0.5]] },
      { id: 'crossing', tag: 'wall', v: [[-1, 0, 0.5], [-1, 0.5, 0.5], [1, 0.5, 0.5], [1, 0, 0.5]] },
      { id: 'tooTall', tag: 'wall', v: [[0, 0, 0.25], [0, 1.4, 0.25], [1, 1.4, 0.25], [1, 0, 0.25]] },
    ],
  },
};
const prepared = windowStub.EntryTunnelWallUnmark.preparePiece(synthetic);
const preparedFaces = normalizePiece(prepared.piece).base.faces;
assert.strictEqual(prepared.clearedCount, 1, 'Only the fully tunnel-contained low wall fragment should be unmarked');
assert.strictEqual(preparedFaces.find(face => face.id === 'inside').tag, '');
assert.strictEqual(preparedFaces.find(face => face.id === 'crossing').tag, 'wall');
assert.strictEqual(preparedFaces.find(face => face.id === 'tooTall').tag, 'wall');

const secondInstall = windowStub.EntryTunnelWallUnmark.install(); // Used to prove repeated boot/install calls do not nest wrappers.
assert.strictEqual(secondInstall, true);
windowStub.HousePieceGen.buildGroupFromPiece({}, minePiece, 15, -1, {});
assert.strictEqual(calls.length, 2, 'Repeated install should still invoke the original renderer exactly once per build');

console.log('entry-tunnel wall unmark integration: ok');
