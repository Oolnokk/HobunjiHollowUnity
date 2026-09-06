'use strict';

const assert = require('assert'); // Used for the entry-tunnel door integration assertions below.
const fs = require('fs'); // Used to read the runtime module/config as the browser would load them.
const vm = require('vm'); // Used to execute the browser module against lightweight Three.js/runtime stubs.

const moduleSource = fs.readFileSync('docs/js/entry-tunnel-door-furniture.js', 'utf8'); // Used by the VM integration test.
const doorData = JSON.parse(fs.readFileSync('docs/config/furniture-authored/door.json', 'utf8')); // Used to validate the converted authored-furniture payload.
const formatSource = fs.readFileSync('docs/js/format-utils.js', 'utf8'); // Used to verify the synchronous boot hook remains installed.

assert.strictEqual(doorData.schema, 'hobunji_furniture_authored_runtime.v1');
assert.strictEqual(doorData.key, 'door');
assert.deepStrictEqual(doorData.footprint, { w: 1, d: 1 });
assert.strictEqual(doorData.parts.length, 2);
assert(formatSource.includes('entry-tunnel-door-furniture.js?v=20260906a'), 'format-utils must synchronously load the entry-tunnel door bridge');

function makeGroup() {
  const group = { // Used as a minimal Three.js Group stand-in for tunnel and door groups.
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

const calls = []; // Used to prove the original HousePieceGen tunnel builder still receives its arguments.
const windowStub = { // Used as the browser-global environment for the integration module.
  HousePieceGen: {
    buildEntryTunnelGroup(THREE, col, row, side, opts) {
      calls.push({ THREE, col, row, side, opts });
      const tunnel = makeGroup(); // Used as the generated tunnel returned through the wrapper.
      tunnel.userData.isEntryTunnel = true;
      return tunnel;
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
const context = vm.createContext({ window: windowStub, document: undefined, console, Math, Number, Object, String }); // Used to execute the classic browser script without a DOM.
vm.runInContext(moduleSource, context, { filename: 'entry-tunnel-door-furniture.js' });

const tunnel = windowStub.HousePieceGen.buildEntryTunnelGroup({}, 4, 7, 'west', { elevationY: 0.25 }); // Used to validate one rotated/elevated placement end to end.
assert.strictEqual(calls.length, 1);
assert.strictEqual(calls[0].col, 4);
assert.strictEqual(calls[0].row, 7);
assert.strictEqual(calls[0].side, 'west');
assert.strictEqual(tunnel.userData.entryTunnelDoorStatus, 'attached');
assert.strictEqual(tunnel.children.length, 1);
assert.strictEqual(tunnel.children[0].name, 'entry_tunnel_door');
assert.strictEqual(tunnel.children[0].position.x, 4.5);
assert.strictEqual(tunnel.children[0].position.y, 0.25);
assert.strictEqual(tunnel.children[0].position.z, 7.5);
assert(Math.abs(tunnel.children[0].rotation.y + Math.PI / 2) < 1e-9);
assert.strictEqual(windowStub.EntryTunnelDoorFurniture.debugInfo(tunnel).attached, true);

const secondInstall = windowStub.EntryTunnelDoorFurniture.install(); // Used to prove re-installation does not double-wrap the generator.
assert.strictEqual(secondInstall, true);
const tunnel2 = windowStub.HousePieceGen.buildEntryTunnelGroup({}, 1, 2, 'north', {}); // Used to verify another cardinal orientation after idempotent install.
assert.strictEqual(calls.length, 2);
assert.strictEqual(tunnel2.children.length, 1);
assert(Math.abs(tunnel2.children[0].rotation.y + Math.PI) < 1e-9);

console.log('entry-tunnel door furniture integration: ok');
