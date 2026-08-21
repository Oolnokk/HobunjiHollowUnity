'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'docs/js/procedural-hand-frame-driver.js'), 'utf8');
const shoulderSource = fs.readFileSync(path.join(root, 'docs/js/procedural-hand-shoulder-aim.js'), 'utf8'); // Verifies free-hand shoulder-X alignment stays below attachment ownership.

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(other) { return this.set(other.x, other.y, other.z); }
}
class BufferGeometry {
  setAttribute() {}
  dispose() {}
}
class Float32BufferAttribute {}
class MeshBasicMaterial {
  constructor() { this.colorWrite = true; }
  dispose() {}
}
class Mesh {
  constructor(geometry, material) {
    this.geometry = geometry;
    this.material = material;
    this.parent = null;
  }
}

let now = 0; // Advanced below to drive deterministic idle-to-walk fallback transitions.
const frames = []; // Captures requestAnimationFrame callbacks so the test controls every driver tick.
const parent = {
  position: new Vector3(),
  getWorldPosition(target) { return target.copy(this.position); },
  add(child) { child.parent = this; },
  remove(child) { if (child.parent === this) child.parent = null; },
};
const idleCalls = []; // Records per-side fallback poses emitted by the managed test rig.
const rig = {
  parent,
  group: { getObjectByName() { return null; } },
  setSideIdle(side, pose) { idleCalls.push({ side, pose }); },
  useIdlePose(poses) {
    idleCalls.push({ side: 'left', pose: poses?.left });
    idleCalls.push({ side: 'right', pose: poses?.right });
  },
  getDebug() { return {}; },
  dispose() {},
};
const hands = {
  attach() { return rig; },
  installGameRuntime() {},
  gameDeps: null,
};
const avatarApi = {
  buildSinglePlaneAvatarModel(THREE, sourceCanvas, options) {
    return {
      parent,
      name: 'fallback_test_avatar',
      userData: { portraitModelHeight: 1, handAttachX: -0.2, handAttachY: 0.5 },
    };
  },
  disposeAvatarModel() {},
};
const windowObject = {
  THREE: { Vector3, BufferGeometry, Float32BufferAttribute, MeshBasicMaterial, Mesh },
  ProceduralHandAttachments: hands,
  HobunjiHandModelProfiles: {
    modelKeyForSpecies() { return 'feline'; },
    effectiveScaleFor() { return 1; },
    data: { handHeightFraction: 0.12 },
  },
  HobunjiHandToolGrips: {
    toolKeyFor(value) { return value; },
    secondaryGripForTool() { return null; },
    subscribe() {},
  },
  PNGPlaneAvatar: avatarApi,
  requestAnimationFrame(callback) { frames.push(callback); },
};
const sandbox = {
  window: windowObject,
  location: { pathname: '/index.html' },
  performance: { now: () => now },
  document: { getElementById() { return null; } },
};
vm.runInNewContext(source, sandbox, { filename: 'procedural-hand-frame-driver.js' });

const avatar = avatarApi.buildSinglePlaneAvatarModel(windowObject.THREE, {}, {
  speciesId: 'mao-ao', gender: 'male', profile: {},
});
assert(avatar, 'wrapped avatar builder should return the underlying avatar');
assert.strictEqual(frames.length, 1, 'driver should schedule its managed-frame loop');

frames.shift()(); // Attaches the pending rig and establishes its first stationary world sample.
assert.strictEqual(windowObject.ProceduralHandFrameDriver.getDebug()[0].fallback.mode, 'idle');
assert(idleCalls.every(call => call.pose), 'idle fallback must provide a procedural pose for both free hands');

idleCalls.length = 0;
for (let step = 1; step <= 10; step += 1) {
  parent.position.x = step * 0.1;
  now = step * 16;
  frames.shift()(); // Repeated real parent-world deltas settle the free hands into walking motion.
}
const walking = windowObject.ProceduralHandFrameDriver.getDebug()[0].fallback;
assert.strictEqual(walking.mode, 'walk');
assert(walking.speed > 0, 'walking fallback must infer speed from world-space movement');
assert.deepStrictEqual({ ...walking.owners }, { left: 'fallback-walk', right: 'fallback-walk' });
const left = [...idleCalls].reverse().find(call => call.side === 'left')?.pose;
const right = [...idleCalls].reverse().find(call => call.side === 'right')?.pose;
assert(left && right, 'walking fallback must animate both unowned sides');
assert(Math.sign(left.position.z) === -Math.sign(right.position.z), 'left and right hands must swing in opposite directions');

assert.match(source, /owners\.right = 'primary-grip'/, 'primary grip ownership must override right-hand fallback');
assert.match(source, /owners\.left = 'secondary-grip'/, 'secondary grip ownership must override left-hand fallback');
assert.match(source, /applyFallbackSide\(record, 'left'\)/, 'a one-handed grip must leave the other hand on fallback motion');
assert.match(shoulderSource, /socket\.position\.x = shoulder\.x/, 'a free hand must hang at the resolved shoulder X');
assert.match(shoulderSource, /shoulderAimSetSideIdle[\s\S]*alignFreeHandXToShoulder\(side\)/, 'single-side fallback must align X before shoulder aiming');
assert.match(shoulderSource, /shoulderAimUseIdlePose[\s\S]*alignFreeHandXToShoulder\('left'\)[\s\S]*alignFreeHandXToShoulder\('right'\)/, 'two-hand fallback must align both sides');
assert.doesNotMatch(shoulderSource, /shoulderAimPlaceHandWorld[\s\S]{0,300}alignFreeHandXToShoulder/, 'tool-attached hands must retain their authored world positions');

console.log('procedural hand fallback: idle + walk + shoulder-X hang + per-side ownership PASS');
