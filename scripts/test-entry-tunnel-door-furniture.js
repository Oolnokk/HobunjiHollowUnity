'use strict';

const assert = require('assert'); // Used for the entry-tunnel door integration assertions below.
const fs = require('fs'); // Used to read the runtime module/config as the browser would load them.
const vm = require('vm'); // Used to execute the browser module against lightweight Three.js/runtime stubs.

const moduleSource = fs.readFileSync('docs/js/entry-tunnel-door-furniture.js', 'utf8'); // Used by the VM integration test.
const doorData = JSON.parse(fs.readFileSync('docs/config/furniture-authored/door.json', 'utf8')); // Used to validate the converted authored-furniture payload.
const mineEntrancePiece = JSON.parse(fs.readFileSync('docs/config/pieces/mine_entrance.json', 'utf8')); // Used to cover the real authored mine entrance that exposed the missing wrapper path.
const townHousePiece = JSON.parse(fs.readFileSync('docs/config/pieces/hobunjihouse1.json', 'utf8')); // Used to cover an ordinary wrapped town-house export as well as the mine.
const formatSource = fs.readFileSync('docs/js/format-utils.js', 'utf8'); // Used to verify the synchronous boot hook remains installed.

assert.strictEqual(doorData.schema, 'hobunji_furniture_authored_runtime.v1');
assert.strictEqual(doorData.key, 'door');
assert.deepStrictEqual(doorData.footprint, { w: 1, d: 1 });
assert.strictEqual(doorData.parts.length, 2);
assert(formatSource.includes('entry-tunnel-door-furniture.js?v=20260907b'), 'format-utils must synchronously load the current entry-tunnel door bridge');

function makeGroup() {
  const group = { // Used as a minimal Three.js Group stand-in for tunnel, building, and door groups.
    children: [],
    userData: {},
    name: '',
    position: { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
    rotation: { y: 0 },
    add(child) { this.children.push(child); },
    getObjectByName(name) { return this.children.find(child => child.name === name) || null; },
  };
  return group;
}

function normalizedPiece(payload) {
  return payload?.currentPiece || payload;
}

function tunnelTileCount(payload) {
  const ext = normalizedPiece(payload)?.footprint?.extensions || {};
  const keys = new Set(); // Used to mirror runtime de-duplication across regular/tall entry-tunnel arrays.
  for (const cell of [...(ext.entryTunnels || []), ...(ext.tallEntryTunnels || [])]) keys.add(`${cell.x},${cell.y}`);
  return keys.size;
}

const tunnelCalls = []; // Used to prove the original HousePieceGen generated-tunnel builder still receives its arguments.
const pieceCalls = []; // Used to prove authored buildings stay on buildGroupFromPiece while receiving doors afterward.
const windowStub = { // Used as the browser-global environment for the integration module.
  HousePieceGen: {
    buildEntryTunnelGroup(THREE, col, row, side, opts) {
      tunnelCalls.push({ THREE, col, row, side, opts });
      const tunnel = makeGroup(); // Used as the generated tunnel returned through the wrapper.
      tunnel.userData.isEntryTunnel = true;
      return tunnel;
    },
    buildGroupFromPiece(THREE, piece, col, row, opts) {
      pieceCalls.push({ THREE, piece, col, row, opts });
      return makeGroup();
    },
  },
  AuthoredFurniture: {
    peek(key) { return key === 'door' ? doorData : null; },
    buildGroup(data) {
      assert.strictEqual(data.key, 'door');
      return makeGroup();
    },
  },
};
const context = vm.createContext({ window: windowStub, document: undefined, console, Math, Number, Object, String, Set, Map, Array }); // Used to execute the classic browser script without a DOM.
vm.runInContext(moduleSource, context, { filename: 'entry-tunnel-door-furniture.js' });

const tunnel = windowStub.HousePieceGen.buildEntryTunnelGroup({}, 4, 7, 'west', { elevationY: 0.25 }); // Used to validate one generated, rotated/elevated placement end to end.
assert.strictEqual(tunnelCalls.length, 1);
assert.strictEqual(tunnelCalls[0].col, 4);
assert.strictEqual(tunnelCalls[0].row, 7);
assert.strictEqual(tunnelCalls[0].side, 'west');
assert.strictEqual(tunnel.userData.entryTunnelDoorStatus, 'attached');
assert.strictEqual(tunnel.children.length, 1);
assert.strictEqual(tunnel.children[0].name, 'entry_tunnel_door');
assert.strictEqual(tunnel.children[0].position.x, 4.5);
assert.strictEqual(tunnel.children[0].position.y, 0.25);
assert.strictEqual(tunnel.children[0].position.z, 7.5);
assert(Math.abs(tunnel.children[0].rotation.y + Math.PI / 2) < 1e-9);
assert.strictEqual(windowStub.EntryTunnelDoorFurniture.debugInfo(tunnel).attached, true);
assert.strictEqual(windowStub.EntryTunnelDoorFurniture.debugInfo(tunnel).count, 1);

const mineExpectedDoors = tunnelTileCount(mineEntrancePiece); // Used to prove every baked mine-entrance tunnel tile receives a real authored door.
assert(mineExpectedDoors > 0, 'The real mine entrance fixture must contain authored entry-tunnel tiles for this regression test');
const mineGroup = windowStub.HousePieceGen.buildGroupFromPiece({}, mineEntrancePiece, 15, -1, { rotationDeg: 180, elevationY: 0.5 });
const mineDebug = windowStub.EntryTunnelDoorFurniture.debugInfo(mineGroup);
assert.strictEqual(pieceCalls.length, 1);
assert.strictEqual(mineDebug.expectedCount, mineExpectedDoors);
assert.strictEqual(mineDebug.count, mineExpectedDoors, 'Every authored mine entry-tunnel tile should receive door furniture');
assert(mineDebug.doors.every(door => door.localTile && Number.isFinite(door.position.x) && Number.isFinite(door.position.z)), 'Authored mine doors should expose mobile-readable local/world placement data');
assert(mineGroup.children.every(child => child.userData.entryTunnelDoorFurniture === true), 'The authored wrapper should add only the expected door children to the stubbed mine building group');

const houseExpectedDoors = tunnelTileCount(townHousePiece); // Used to cover the wrapped currentPiece export shape used by ordinary Hobunji houses.
assert(houseExpectedDoors > 0, 'The real Hobunji house fixture must contain authored entry-tunnel tiles for this regression test');
const houseGroup = windowStub.HousePieceGen.buildGroupFromPiece({}, townHousePiece, 33, 3, { rotationDeg: 0 });
const houseDebug = windowStub.EntryTunnelDoorFurniture.debugInfo(houseGroup);
assert.strictEqual(pieceCalls.length, 2);
assert.strictEqual(houseDebug.expectedCount, houseExpectedDoors);
assert.strictEqual(houseDebug.count, houseExpectedDoors, 'Every authored town-house entry-tunnel tile should receive door furniture');

const secondInstall = windowStub.EntryTunnelDoorFurniture.install(); // Used to prove re-installation does not double-wrap either generator path.
assert.strictEqual(secondInstall, true);
const tunnel2 = windowStub.HousePieceGen.buildEntryTunnelGroup({}, 1, 2, 'north', {}); // Used to verify another cardinal orientation after idempotent install.
assert.strictEqual(tunnelCalls.length, 2);
assert.strictEqual(tunnel2.children.length, 1);
assert(Math.abs(tunnel2.children[0].rotation.y + Math.PI) < 1e-9);
const mineGroup2 = windowStub.HousePieceGen.buildGroupFromPiece({}, mineEntrancePiece, 15, -1, { rotationDeg: 180 });
assert.strictEqual(pieceCalls.length, 3, 'A second install must not nest another authored-piece wrapper');
assert.strictEqual(windowStub.EntryTunnelDoorFurniture.debugInfo(mineGroup2).count, mineExpectedDoors);

console.log('entry-tunnel door furniture integration: ok');
