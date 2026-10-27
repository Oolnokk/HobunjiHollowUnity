// Regression coverage for shared movement-only NPC/bandit gaze.
const assert = require('node:assert/strict'); // Used for deterministic motion, ownership, and render-undo assertions.
const fs = require('node:fs'); // Reads the actual game/module integration instead of a duplicate implementation.
const vm = require('node:vm'); // Isolates the browser module's window globals from Node.
const path = require('node:path'); // Resolves source paths relative to this test.

const root = path.resolve(__dirname, '..'); // Repository root for the source and integration checks.
const source = fs.readFileSync(path.join(root, 'docs/js/npc-movement-head-target.js'), 'utf8'); // The production movement gaze implementation.
const window = { PerpRotation: { clearHeadtrackHint() { window.clears = (window.clears || 0) + 1; } } }; // Minimal browser stand-in, including headtrack cleanup.
vm.runInNewContext(source, { window });
const gaze = window.NpcMovementHeadTarget; // API shared by game.js and render-time hostile lean.
const near = (a, b) => Math.abs(a - b) < 1e-6; // Avoids treating harmless trigonometric rounding as a regression.

const ahead = gaze.targetAhead({ x: 1, y: 2, z: 3 }, 3, 4, 0.8);
assert(near(ahead.x, 2.8) && near(ahead.y, 2.8) && near(ahead.z, 5.4), 'carrot remains three tiles ahead at eye height');
assert.equal(gaze.targetAhead({ x: 0, y: 0, z: 0 }, 0, 0, 1), null, 'idle movement has no default target');
assert.equal(gaze.targetAhead({ x: 0, y: 0, z: 0 }, Number.NaN, 1, 1), null, 'nonfinite movement cannot drive gaze');

const neck = { rotation: { set(x, y, z) { this.x = x; this.y = y; this.z = z; } } }; // Captures the existing neck-joint pose changes.
const walker = { root: { position: { x: 0, y: 1, z: 0 } }, neckJoint: neck, avatarHeight: 1.2, area: 'town', perpState: {} }; // A floor-origin humanoid walker.
let observed = null; // Records the world carrot/head positions forwarded to the existing neck solver.
const options = {
  currentArea: 'town', eyeHeightRatio: 0.8,
  makeWorldPoint: point => point,
  getFaceWorld: () => ({ x: 0, y: 1.8, z: 0 }),
  aimAtWorldPoint: (_walker, point, eye) => { observed = { point, eye }; return true; },
};
walker.root.position.z = 0.5;
assert.equal(gaze.updateWalker(walker, 0, 0, options), true);
assert(near(observed.point.z, 3.5) && near(observed.point.y, 1.96), 'travel direction wins over billboard facing');
assert.equal(walker._npcMotionLookActive, true);
assert.equal(gaze.updateWalker(walker, 0, 0.5, options), false);
assert.equal(walker._npcMotionLookActive, false);
assert.equal(neck.rotation.x, 0, 'stopping restores head rest');
assert.equal(window.clears, 1, 'stopping clears the motion-only headtrack hint');

walker.root.position.x = 0.5;
options.hasScriptedGaze = true;
assert.equal(gaze.updateWalker(walker, 0, 0.5, options), false, 'scripted gaze has priority');
options.hasScriptedGaze = false;
assert.equal(gaze.updateWalker(walker, 0, 0.5, options), true);
walker._ambientLookActive = true; // An authored station owns head pose after its arrival.
assert.equal(gaze.updateWalker(walker, 0.5, 0.5, options), false);
assert.equal(neck.rotation.x, 0, 'station gaze is not overwritten by movement cleanup');
walker._ambientLookActive = false;
walker.root.position.z = 0.7;
assert.equal(gaze.updateWalker(walker, 0.5, 0.5, options), true);
options.currentArea = 'mine';
assert.equal(gaze.updateWalker(walker, 0.5, 0.7, options), false);
assert.equal(walker._npcMotionLookActive, false, 'off-area LOD does not strand the last gait gaze');

// Minimal Three.js quaternion composition; tests actual head orientation,
// not only whether one local Euler pitch happened to change.
class MockQuaternion {
  constructor(x = 0, y = 0, z = 0, w = 1) { this.set(x, y, z, w); }
  set(x, y, z, w) { Object.assign(this, { x, y, z, w }); return this; }
  clone() { return new MockQuaternion(this.x, this.y, this.z, this.w); }
  copy(other) { return this.set(other.x, other.y, other.z, other.w); }
  multiply(q) {
    const { x, y, z, w } = this;
    return this.set(w * q.x + x * q.w + y * q.z - z * q.y,
      w * q.y - x * q.z + y * q.w + z * q.x,
      w * q.z + x * q.y - y * q.x + z * q.w,
      w * q.w - x * q.x - y * q.y - z * q.z);
  }
}
const sameRotation = (a, b) => ['x', 'y', 'z', 'w'].every(key => near(a[key], b[key])); // Covers all 3 axes and the scalar quaternion term.
const yawQuaternion = yaw => new MockQuaternion(0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)); // Front/back portrait plane orientation.
const leanQuaternion = (lean, heading) => new MockQuaternion(
  Math.cos(heading) * Math.sin(lean / 2), 0, -Math.sin(heading) * Math.sin(lean / 2), Math.cos(lean / 2),
); // Exactly the runtime's world-forward run-lean axis.

for (const heading of [0, Math.PI / 6, Math.PI / 3, Math.PI / 2, Math.PI, -Math.PI / 2]) {
  for (const lean of [-0.48, 0.1, 0.3]) {
    const frontBone = { quaternion: new MockQuaternion() }; // The original combat-yaw pose survives in the neck bone.
    const backBone = { quaternion: new MockQuaternion() }; // Independent back portrait card has opposite ±90° yaw.
    const avatar = { neckJoint: { front: frontBone, back: backBone },
      frontPlane: { rotation: { y: Math.PI / 2 } }, backPlane: { rotation: { y: -Math.PI / 2 } } };
    const undo = []; // Actual 3D renderer restores neck transforms between independent passes.
    assert.equal(gaze.applyHostileRunPitch(avatar, lean, heading, undo), true);
    const bodyLean = leanQuaternion(lean, heading);
    for (const [bone, yaw] of [[frontBone, Math.PI / 2], [backBone, -Math.PI / 2]]) {
      const restPlane = yawQuaternion(yaw);
      const renderedHead = bodyLean.clone().multiply(restPlane).multiply(bone.quaternion);
      assert(sameRotation(renderedHead, restPlane), 'head stays exactly level for all run headings and both cameras');
    }
    for (let i = undo.length - 1; i >= 0; i--) undo[i]();
    assert(sameRotation(frontBone.quaternion, new MockQuaternion()), 'front render cleanup is exact');
    assert(sameRotation(backBone.quaternion, new MockQuaternion()), 'rear render cleanup is exact');
  }
}

// Pre-existing combat yaw must be preserved AFTER correction and render cleanup.
const combatYaw = yawQuaternion(0.2);
const front = { quaternion: combatYaw.clone() }, back = { quaternion: yawQuaternion(-0.3) };
const yawAvatar = { neckJoint: { front, back }, frontPlane: { rotation: { y: Math.PI / 2 } }, backPlane: { rotation: { y: -Math.PI / 2 } } };
const yawUndo = [];
assert.equal(gaze.applyHostileRunPitch(yawAvatar, 0.28, 0, yawUndo), true);
assert(sameRotation(
  leanQuaternion(0.28, 0).multiply(yawQuaternion(Math.PI / 2)).multiply(front.quaternion),
  yawQuaternion(Math.PI / 2).multiply(combatYaw),
), 'running correction preserves committed combat neck yaw while canceling lean');
yawUndo.forEach(fn => fn());
assert(sameRotation(front.quaternion, combatYaw), 'restores exact combat yaw');
assert(sameRotation(back.quaternion, yawQuaternion(-0.3)), 'restores independent rear combat yaw');
assert.equal(gaze.applyHostileRunPitch(yawAvatar, 0, 0, []), false, 'stationary bodies receive no extra pitch');
assert.equal(gaze.applyHostileRunPitch({ neckJoint: { front, back } }, .25, 0, []), false, 'missing card yaw does not mutate the head');

const game = fs.readFileSync(path.join(root, 'docs/game.js'), 'utf8'); // Verifies the actual walker/hostile simulation invokes the new API.
const bridge = fs.readFileSync(path.join(root, 'docs/js/drunk-prone-composition-bridge.js'), 'utf8'); // Ensures hostile correction runs inside the render boundary.
const combat = fs.readFileSync(path.join(root, 'docs/js/combat/combat-bandit.js'), 'utf8'); // All humanoid enemies share the exposed fallback.
const html = fs.readFileSync(path.join(root, 'docs/index.html'), 'utf8'); // Checks the new browser module is loaded before the game.
assert(game.includes('updateWalker?.(w, oldHeadX, oldHeadZ, npcMovementHeadLookOptions)'));
assert(game.includes('updateMovementHeadLook?.(c, entityDt, moving, aimAngle)'));
assert(bridge.includes('applyHostileRunPitch?.(entity.avatarRef, runLean, localHeading, undo)'));
assert(combat.includes('updateMovementHeadLook,'));
assert(html.indexOf('js/npc-movement-head-target.js') > 0 && html.indexOf('js/npc-movement-head-target.js') < html.indexOf('js/combat/combat-bandit.js'));
console.log('NPC movement-head carrot, hostile counter-pitch, and runtime integration: PASS');
