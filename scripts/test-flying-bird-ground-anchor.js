#!/usr/bin/env node
'use strict';

// Run: node scripts/test-flying-bird-ground-anchor.js
const assert = require('node:assert/strict'); // Checks the actual live bird presenter and its native-sprite anchor handshake.
const fs = require('node:fs'); // Reads the production module, not a copy of its positioning logic.
const path = require('node:path'); // Resolves paths from this test's own directory.
const vm = require('node:vm'); // Runs the browser module with a minimal scene/rig model.

const mountedRigs = []; // Captures live rig roots so test cases can inspect their local foot offsets.
const window = {
  RenderHooks: { ORDER: { ACTOR_RENDER_PLACEMENT: 3 }, register() {} },
  CreatureBlink: { isShut() { return false; } },
  __farmLog() {},
  TzatzulRegistration: {
    HATCHLING_KIND: 'tzatzul-hatchling',
    HATCHLING_SCALE: { x: 0.375, y: 0.625 },
    identityFor() { return { id: 'test-hatchling' }; },
  },
}; // Minimal browser services used by the real TzatzulLiveVisuals module.

function makeRig() {
  const rig = {
    root: {
      position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1, setScalar(n) { this.x = this.y = this.z = n; } },
      visible: true,
    },
    dispose() {},
    update(_camera, pose, _seconds, _carrying, _blinkShut, footY) { this.pose = pose; this.footY = footY; },
    restoreTint() { return false; },
  }; // The native group owns all transforms; the wing rig can only change its local pose.
  mountedRigs.push(rig);
  return Promise.resolve(rig);
}
window.PingdortRegistration = { createRig: makeRig };
window.TzatzulRegistration.createRig = makeRig;

const source = fs.readFileSync(path.join(__dirname, '../docs/js/tzatzul-live-visuals.js'), 'utf8'); // The exact shipping JS.
vm.runInNewContext(source, { window, Math, Date, performance: { now: () => 1 }, console }, { filename: 'tzatzul-live-visuals.js' });
function bird(creatureKey, nativeFootY) {
  const group = {
    children: [], parent: {}, userData: {},
    add(node) { node.parent = this; this.children.push(node); },
  }; // The production mount requires an already-attached native avatar.
  const nativePlane = {
    isMesh: true, parent: group, userData: { hobunjiPlaneFace: 'front' },
    position: { y: nativeFootY }, geometry: { parameters: { height: 0.47 } }, visible: true,
  }; // Simulates CreatureGroundAnchor's opaque-bottom plane correction.
  group.children.push(nativePlane);
  return {
    id: creatureKey, creatureKey, areaId: 'perch-test', health: 20, state: 'idle',
    x: 64, y: 64, isWildPingdort: creatureKey === 'pingdort',
    pingdortFlightPose: 'perched', avatarRef: { group, frontPlane: nativePlane },
  };
}

async function check() {
  const pingdort = bird('pingdort', -0.15); // Known native foot correction before flying rig mounting.
  const hatchling = bird('tzatzul-hatchling', -0.23); // Hatchlings keep their hop and the native correction.
  const hostileObjects = new Set([pingdort, hatchling]); // One real native update/scan path handles both species.
  window.TzatzulLiveVisuals.init({
    hostileObjects, companionObjects: new Set(), player: { x: 0, y: 0 },
    TILE: 64, getCurrentArea: () => 'perch-test',
  });
  window.TzatzulLiveVisuals.tick(0.05, 'perch-test');
  for (let i = 0; i < 7; i++) await Promise.resolve(); // Finish the same Promise-based mount pipeline used by the game.
  assert.equal(mountedRigs.length, 2, 'native bird rigs mount for a Pingdort and a hatchling');
  const [pingdortRig, hatchlingRig] = mountedRigs; // Inspected after each actual module update below.
  assert.equal(pingdortRig.root.position.y, -0.15, 'initial mount inherits the native foot anchor');
  assert.equal(hatchlingRig.root.position.y, -0.23, 'initial hatchling mount inherits its native foot anchor');
  window.TzatzulLiveVisuals.tick(0.05, 'perch-test');
  assert.equal(pingdortRig.root.position.y, -0.15, 'perched posture retains the authored ground correction');
  assert.equal(hatchlingRig.root.position.y, -0.23, 'stationary hatchling rests at its native height');
  hatchling.avatarRef.groundAnchorBottomRatio = .8;
  window.TzatzulLiveVisuals.tick(0.05, 'perch-test');
  assert(Math.abs(hatchlingRig.footY + .3) < 1e-9, 'a late opacity scan supplies the same foot hinge used by the native sprite');
  assert.equal(pingdortRig.footY, undefined, 'the wild perch keeps its authored deformation and camera pose');
  assert.equal(pingdortRig.pose, 'perched', 'ground anchoring does not replace the folded-wing pose');
  pingdort.avatarRef.frontPlane.position.y = -0.35;
  window.TzatzulLiveVisuals.tick(0.05, 'perch-test');
  assert.equal(pingdortRig.root.position.y, -0.35, 'late PNG opacity scan synchronizes the live wing rig');
  pingdort.pingdortFlightPose = 'flap';
  pingdort.avatarRef.frontPlane.position.y = -0.1;
  window.TzatzulLiveVisuals.tick(0.05, 'perch-test');
  assert.equal(pingdortRig.root.position.y, -0.1, 'launching from a perch cannot restore the old hover gap');
  hatchling.x += 4;
  window.TzatzulLiveVisuals.tick(0.05, 'perch-test');
  assert(hatchlingRig.root.position.y > -0.23, 'moving hatchlings hop above, not instead of, their foot correction');
  window.TzatzulLiveVisuals.tick(0.05, 'perch-test');
  assert.equal(hatchlingRig.root.position.y, -0.23, 'hatchlings return to the authored foot anchor after landing');
  console.log('flying bird ground-anchor checks passed');
}
check().catch(error => { console.error(error); process.exitCode = 1; });
