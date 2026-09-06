#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/combat/attack-camera-player-root.js', 'utf8');

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
}
class Object3D {
  constructor() { this.position = new Vector3(); this.lastLookAt = null; }
  lookAt(x, y, z) {
    this.lastLookAt = x && typeof x === 'object'
      ? { x: Number(x.x), y: Number(x.y), z: Number(x.z) }
      : { x: Number(x), y: Number(y), z: Number(z) };
  }
}
class PerspectiveCamera extends Object3D {
  constructor() { super(); this.isPerspectiveCamera = true; }
}

let combatStance = true;
let target = {
  mode: 'ranged',
  source: 'weapon-max-range',
  itemKey: 'crossbow',
  origin: { x: 2, y: 0.55, z: 3 },
  direction: { x: 1, y: 0, z: 0 },
  point: { x: 11, y: 0.55, z: 3 },
};
let camera = null;
const logs = [];
const sliders = {
  settingShoulderSurfOffsetH: { value: '0.18' },
  settingShoulderSurfOffsetV: { value: '-0.05' },
};
const windowStub = {
  THREE: { Vector3, Object3D, PerspectiveCamera },
  SCRATCHBONES_CONFIG: { game: { camera: { modes: { shoulderSurf: { distanceTiles: 1.55, angleFromGroundDeg: 9 } } } } },
  HobunjiRangedCameraFocus: {
    snapshot: () => ({ combatStance }),
    attackCameraTarget: () => target,
  },
  __farmLog: message => logs.push(message),
};
Object.defineProperty(windowStub, '__hobunjiFurnitureDebug', {
  get() {
    return {
      camState: {
        mode: 'shoulderSurf',
        position: camera ? { x: camera.position.x, y: camera.position.y, z: camera.position.z } : { x: 0, y: 0, z: 0 },
      },
    };
  },
});

const context = {
  window: windowStub,
  document: { getElementById: id => sliders[id] || null },
  Math,
  console,
};
vm.runInNewContext(source, context, { filename: 'attack-camera-player-root.js' });
assert.equal(windowStub.HobunjiAttackCameraPlayerRoot.version, 1, 'player-root module installs');

camera = new PerspectiveCamera();
camera.position.set(999, 200, -500); // Simulates a wildly displaced position from the previous feedback-prone frame.
camera.lookAt(0, 0, 0);

const groundDistance = Math.cos(9 * Math.PI / 180) * 1.55;
const heightDistance = Math.sin(9 * Math.PI / 180) * 1.55;
assert(Math.abs(camera.position.x - (2 - groundDistance)) < 1e-9, 'camera X is rebuilt from player/attack origin, not prior camera X');
assert(Math.abs(camera.position.z - 3.18) < 1e-9, 'horizontal shoulder offset is player-rooted on the attack-right axis');
assert(Math.abs(camera.position.y - (0.55 - 0.05 + heightDistance)) < 1e-9, 'camera Y is rebuilt from player origin, vertical offset and authored elevation');
assert.deepEqual(camera.lastLookAt, { x: 11, y: 0.55, z: 3 }, 'camera looks at the authoritative shot-range point');

// Moving the mouse used to feed a changed camera transform back into the next
// aiming frame. Even if the normal camera writes a completely different/wild
// position before lookAt, the rooted hook must resolve to the exact same player-
// relative position while the attack axis itself has not changed.
camera.position.set(-800, -90, 1200);
camera.lookAt(100, 50, -100);
assert(Math.abs(camera.position.x - (2 - groundDistance)) < 1e-9, 'previous-frame/mouse camera X cannot accumulate into combat placement');
assert(Math.abs(camera.position.z - 3.18) < 1e-9, 'previous-frame/mouse camera Z cannot accumulate into combat placement');
const distanceFromRoot = Math.hypot(camera.position.x - 2, camera.position.y - 0.55, camera.position.z - 3);
assert(distanceFromRoot < 2, 'combat camera remains tightly bounded to the player root');

// Once the authoritative attack/player facing itself turns, the rooted camera
// orbits to the new behind-the-player side while remaining the same distance.
target = {
  ...target,
  direction: { x: 0, y: 0, z: 1 },
  point: { x: 2, y: 0.55, z: 12 },
};
camera.position.set(500, 500, 500);
camera.lookAt(0, 0, 0);
assert(Math.abs(camera.position.x - (2 - 0.18)) < 1e-9, 'shoulder offset rotates with the authoritative attack axis');
assert(Math.abs(camera.position.z - (3 - groundDistance)) < 1e-9, 'camera stays behind the player after an attack-axis turn');
assert.deepEqual(camera.lastLookAt, { x: 2, y: 0.55, z: 12 }, 'look target follows the turned attack range point');

combatStance = false;
const before = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
camera.lookAt(7, 8, 9);
assert.deepEqual({ x: camera.position.x, y: camera.position.y, z: camera.position.z }, before, 'outside combat the module does not own camera position');
assert.deepEqual(camera.lastLookAt, { x: 7, y: 8, z: 9 }, 'outside combat the existing camera lookAt path is preserved');
assert(logs.some(line => line.includes('player-rooted combat camera ON')), 'root activation is mirrored into the in-game debug log');

console.log('Player-rooted attack camera checks passed.');
