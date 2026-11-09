'use strict';
const assert = require('node:assert/strict'); // Executes the world-space beacon instead of pinning its source.
const fs = require('node:fs'); // Loads the shipped module and config.
const vm = require('node:vm'); // Minimal browser-shaped context.
const source = fs.readFileSync('docs/js/harlyao-night-march-beacon.js', 'utf8'); // Module under test.
const config = JSON.parse(fs.readFileSync('docs/config/harlyao-night-march.json', 'utf8')); // Authored spectral tuning.
class Group {
  constructor() { this.children = []; this.userData = {}; this.position = { set(x, y, z) { Object.assign(this, { x, y, z }); } }; }
  add(child) { this.children.push(child); child.parent = this; }
  remove(child) { this.children = this.children.filter(item => item !== child); child.parent = null; }
}
class Mesh extends Group { constructor(geometry, material) { super(); this.geometry = geometry; this.material = material; } }
class CylinderGeometry { constructor(...args) { this.args = args; } }
class MeshBasicMaterial { constructor(options) { Object.assign(this, options); } }
(async () => {
  const subscriptions = new Map(); // Scheduler wiring is part of the tested production path.
  const glow = []; // Darkness-mask source providers.
  let target = { id: 'commander-0', zoneId: 'map_northern_cliffs', x: 180, z: 100 }; // Moving simulated actor.
  let area = target.zoneId; // Leaving the zone must remove the marker.
  let scene = new Group(); // Scene replacement must reattach the existing marker.
  const player = { x: 100 * 64, y: 100 * 64 }; // Player at map center.
  const combat = { init() {} }; // Captures real dependency injection.
  const window = { THREE: { Group, Mesh, CylinderGeometry, MeshBasicMaterial, DoubleSide: 2 }, BanditCombat: combat, HarlyaoNightMarch: { commanderTarget: () => target }, RuntimeFrameScheduler: { register(id, callback, options) { subscriptions.set(id, { callback, options }); } }, Ghostify: { registerGlowSource(provider) { glow.push(provider); } } }; // Rendering host.
  vm.runInNewContext(source, { window, fetch: async () => ({ ok: true, json: async () => config }) });
  await new Promise(resolve => setImmediate(resolve));
  combat.init({ TILE: 64, player, getCurrentArea: () => area, getActiveScene: () => scene, getActiveGrid: () => Array.from({ length: 200 }, () => Array.from({ length: 200 }, () => ({ height: 12 }))), tileSurfaceYInArea: tile => tile.height });
  const api = window.HarlyaoNightMarchBeacon; // Public mobile/debug API.
  const subscription = subscriptions.get('harlyao-commander-beacon'); // Runs after native movement.
  assert.equal(subscription.options.phase, 'pre-render'); subscription.callback();
  assert.equal(scene.children.length, 1);
  const marker = scene.children[0]; // Actual 3D group with volume geometry.
  assert.equal(marker.children.length, 3); assert.equal(marker.position.x, 118); assert.equal(marker.position.z, 100); assert.equal(marker.position.y, 12.15);
  for (const shell of marker.children) { assert(shell.geometry instanceof CylinderGeometry); assert.equal(shell.material.depthTest, false); assert.equal(shell.material.depthWrite, false); assert.equal(shell.material.fog, false); }
  assert.equal(api.debugSnapshot().marker.commanderId, 'commander-0');
  assert.equal(api.debugSnapshot().marker.directional, true);
  assert.equal(glow[0]().x, 118, 'darkness mask follows the 3D marker');
  target = { ...target, x: 100, z: 20 }; subscription.callback();
  assert.equal(marker.position.x, 100); assert.equal(marker.position.z, 82, 'bearing rotates with moving commander');
  target = { ...target, x: 105, z: 103 }; subscription.callback();
  assert.equal(marker.position.x, target.x); assert.equal(marker.position.z, target.z);
  assert.equal(api.debugSnapshot().marker.directional, false, 'nearby beacon sits on commander');
  target = { ...target, id: 'commander-1', x: 100, z: 100 }; subscription.callback();
  assert.equal(marker.position.x, 100); assert.equal(marker.position.z, 100); assert.equal(api.debugSnapshot().marker.commanderId, 'commander-1');
  const oldScene = scene; scene = new Group(); subscription.callback(); // Re-entry/regeneration replaces the active scene.
  assert.equal(oldScene.children.length, 0); assert.equal(scene.children[0], marker);
  area = 'town'; subscription.callback(); assert.equal(scene.children.length, 0); assert.equal(glow[0](), null);
  area = target.zoneId; subscription.callback(); assert.equal(scene.children[0], marker, 'reuse marker and materials on re-entry');
  target = null; subscription.callback(); assert.equal(scene.children.length, 0); assert.equal(api.debugSnapshot().active, false);
  const zero = api.__test.markerPosition({ x: 4, z: 4 }, { x: 4, z: 4 }, 18); // Zero distance cannot produce NaN.
  assert.equal(zero.x, 4); assert.equal(zero.z, 4);
  assert.match(api.formatDebug(), /space=3D/);
  console.log('3D commander beacon: bearings, nearby target, terrain, succession, scene changes and teardown passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
