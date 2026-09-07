'use strict';

const assert = require('assert'); // Used for authored tunnel/wall carving regression assertions.
const fs = require('fs'); // Used to read real authored pieces and browser bridge source.
const vm = require('vm'); // Used to execute the classic browser script against a lightweight HousePieceGen stub.

const moduleSource = fs.readFileSync('docs/js/entry-tunnel-wall-unmark.js', 'utf8'); // Used to test the exact runtime wrapper shipped by the game.
const minePiece = JSON.parse(fs.readFileSync('docs/config/pieces/mine_entrance.json', 'utf8')); // Covers the flat authored mine entrance.
const townHousePiece = JSON.parse(fs.readFileSync('docs/config/pieces/hobunjihouse1.json', 'utf8')); // Covers the ordinary Highland town house with crossing cross-gable walls.
const formatSource = fs.readFileSync('docs/js/format-utils.js', 'utf8'); // Proves the corrected bridge is loaded before world structures build.

assert(formatSource.includes('entry-tunnel-wall-unmark.js?v=20260907c'), 'format-utils must synchronously load the wall-carving entry-tunnel bridge');

function normalizePiece(piece) { return piece?.currentPiece || piece; }
function makeGroup() { return { children: [], userData: {} }; }
function isVerticalTunnelWall(face) { return face?.tag === 'entryTunnel' && (face.solidifiedWall === true || face.doorwayFrame === true); }

const originalMine = JSON.parse(JSON.stringify(minePiece)); // Verifies rendering never mutates the cached source piece.
const originalHouse = JSON.parse(JSON.stringify(townHousePiece)); // Same non-mutating guarantee for wrapped town-house exports.
const calls = []; // Inspects the piece that actually reaches HousePieceGen after preprocessing.
const windowStub = {
  HousePieceGen: {
    buildGroupFromPiece(THREE, piece, col, row, opts) {
      calls.push({ THREE, piece, col, row, opts });
      return makeGroup();
    },
  },
};
const context = vm.createContext({ window: windowStub, document: undefined, console, Math, Number, Object, String, Set, Map, Array }); // Runs the browser bridge headlessly.
vm.runInContext(moduleSource, context, { filename: 'entry-tunnel-wall-unmark.js' });

const source = normalizePiece(minePiece);
const sourceWallCount = source.base.faces.filter(face => face.tag === 'wall').length;
const sourceTunnelFaces = source.base.faces.filter(face => face.tag === 'entryTunnel');
const sourceNonWallTunnelFaces = sourceTunnelFaces.filter(face => !isVerticalTunnelWall(face));
assert(sourceWallCount > 0, 'Mine fixture must contain house wall faces');
assert(sourceTunnelFaces.length > 0, 'Mine fixture must contain entry-tunnel faces');
assert(sourceNonWallTunnelFaces.length > 0, 'Mine fixture must contain tunnel floor/ceiling/cap faces that should never become WallBuilder panels');

const group = windowStub.HousePieceGen.buildGroupFromPiece({}, minePiece, 15, -1, { rotationDeg: 180 });
assert.strictEqual(calls.length, 1);
const rendered = normalizePiece(calls[0].piece);
const suppressedTunnelFaces = rendered.base.faces.filter(face => face.tunnelWallBuilderSuppressed === true);
assert(group.userData.entryTunnelWallSectionsCarved > 0, 'Mine house-wall sections inside tunnel cells should be carved out before WallBuilder');
assert.strictEqual(suppressedTunnelFaces.length, sourceNonWallTunnelFaces.length, 'Every non-wall mine tunnel surface should be removed from the WallBuilder classification path');
assert(suppressedTunnelFaces.every(face => face.tag === 'entryTunnelSurface' && face.tunnelWallBuilderOriginalTag === 'entryTunnel'), 'Suppressed tunnel surfaces should retain geometry under a non-wall tag');
assert(rendered.base.faces.filter(face => face.tag === 'entryTunnel').every(isVerticalTunnelWall), 'Every tunnel face still tagged entryTunnel must be an actual vertical shell/frame face');
assert.strictEqual(group.userData.entryTunnelWallFacesUnmarked, group.userData.entryTunnelWallSectionsCarved, 'Backward-compatible debug counter should mirror the explicit carved-section count');
assert.strictEqual(group.userData.entryTunnelNonWallPanelsSuppressed, suppressedTunnelFaces.length, 'Runtime group should expose how many tunnel floor/ceiling panels were kept out of WallBuilder');
assert.deepStrictEqual(minePiece, originalMine, 'Wall/tunnel carving must not mutate the cached authored mine piece');

const houseGroup = windowStub.HousePieceGen.buildGroupFromPiece({}, townHousePiece, 33, 3, {}); // Reproduces the ordinary-town-house path that remained blocked while the farmhouse worked.
assert.strictEqual(calls.length, 2);
const renderedHouse = normalizePiece(calls[1].piece);
const houseSuppressed = renderedHouse.base.faces.filter(face => face.tunnelWallBuilderSuppressed === true);
const houseCarvedFragments = renderedHouse.base.faces.filter(face => face.tunnelWallCarvedFragment === true);
assert(houseSuppressed.length > 0, 'Ordinary Hobunji houses must suppress tunnel floor/ceiling surfaces before WallBuilder');
assert(houseGroup.userData.entryTunnelWallSectionsCarved > 0, 'Ordinary Hobunji houses must carve large crossing wall quads around their tunnel cell');
assert(houseCarvedFragments.length > 0, 'Town-house crossing walls should leave retained beside/above fragments after carving');
assert(renderedHouse.base.faces.filter(face => face.tag === 'entryTunnel').every(isVerticalTunnelWall), 'Ordinary house entryTunnel tags must mean only actual vertical tunnel wall/frame geometry');
assert.strictEqual(houseGroup.userData.entryTunnelNonWallPanelsSuppressed, houseSuppressed.length);
assert.deepStrictEqual(townHousePiece, originalHouse, 'Town-house wall carving must not mutate the cached authored piece');

// Synthetic case proves the exact behavior needed by town cross-gables: a
// fully submerged wall disappears, a wide crossing wall is split at the
// tunnel edge, and a tall crossing wall keeps only the lintel/top portion.
const synthetic = {
  gridSize: 4,
  tileSize: 1,
  footprint: { cells: [{ x: 1, y: 2 }, { x: 2, y: 2 }], extensions: { entryTunnels: [{ x: 2, y: 2 }], tallEntryTunnels: [] } },
  base: {
    groundY: 0,
    faces: [
      { id: 'ceiling', tag: 'entryTunnel', extensionFace: 'ceiling', sourceTile: { x: 2, y: 2 }, solidifiedWalls: true, v: [[0, 1.05, 0], [1, 1.05, 0], [1, 1.05, 1], [0, 1.05, 1]] },
      { id: 'frame', tag: 'entryTunnel', extensionFace: 'south', sourceTile: { x: 2, y: 2 }, solidifiedWall: true, doorwayFrame: true, v: [[0, 0, 1], [0, 1, 1], [0.1, 1, 1], [0.1, 0, 1]] },
      { id: 'inside', tag: 'wall', v: [[0, 0, 0.5], [0, 0.5, 0.5], [1, 0.5, 0.5], [1, 0, 0.5]] },
      { id: 'crossing', tag: 'wall', v: [[-1, 0, 0.5], [-1, 0.5, 0.5], [1, 0.5, 0.5], [1, 0, 0.5]] },
      { id: 'tooTall', tag: 'wall', v: [[0, 0, 0.25], [0, 1.4, 0.25], [1, 1.4, 0.25], [1, 0, 0.25]] },
    ],
  },
};
const prepared = windowStub.EntryTunnelWallUnmark.preparePiece(synthetic);
const preparedFaces = normalizePiece(prepared.piece).base.faces;
assert.strictEqual(prepared.carvedCount, 3, 'All three house-wall sections overlapping the tunnel volume should be carved');
assert.strictEqual(prepared.suppressedTunnelPanelCount, 1, 'Only the non-wall tunnel ceiling should be removed from the WallBuilder path');
assert.strictEqual(preparedFaces.find(face => face.id === 'ceiling').tag, 'entryTunnelSurface');
assert.strictEqual(preparedFaces.find(face => face.id === 'frame').tag, 'entryTunnel', 'Actual vertical doorway frame geometry must keep tunnel wall treatment');
assert(!preparedFaces.some(face => face.id === 'inside'), 'A wall fully submerged in the tunnel must be removed from render/WallBuilder geometry');
const crossingFragments = preparedFaces.filter(face => String(face.tunnelWallOriginalId) === 'crossing');
assert(crossingFragments.length > 0 && crossingFragments.every(face => face.tag === 'wall'), 'A wide crossing wall must retain only its outside wall fragment(s)');
const tallFragments = preparedFaces.filter(face => String(face.tunnelWallOriginalId) === 'tooTall');
assert(tallFragments.length > 0, 'A tall crossing wall must retain a top/lintel fragment above the tunnel');
assert(tallFragments.every(face => Math.min(...face.v.map(v => Number(v[1]))) >= 1.05 - 1e-4), 'Tall retained fragments must begin at the tunnel ceiling or higher');

const secondInstall = windowStub.EntryTunnelWallUnmark.install(); // Proves repeated boot/install calls do not nest wrappers.
assert.strictEqual(secondInstall, true);
windowStub.HousePieceGen.buildGroupFromPiece({}, minePiece, 15, -1, {});
assert.strictEqual(calls.length, 3, 'Repeated install should still invoke the original renderer exactly once per build');

console.log('entry-tunnel wall carving integration: ok');
