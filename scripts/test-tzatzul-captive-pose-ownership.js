// Regress the old talon tilt surviving a normal yaw-only solver update.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class Vector {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { Object.assign(this, { x, y, z }); return this; }
  clone() { return new this.constructor().copy(this); }
  copy(value) { return this.set(value.x, value.y, value.z); }
}
class Quaternion extends Vector {
  set(x, y, z, w = 1) { super.set(x, y, z); this.w = w; return this; }
  copy(value) { return this.set(value.x, value.y, value.z, value.w); }
  equals(value) { return this.x === value.x && this.y === value.y && this.z === value.z && this.w === value.w; }
  normalize() { return this; }
}
class Object3D {
  constructor() {
    this.isObject3D = true;
    this.position = new Vector();
    this.rotation = new Vector();
    this.quaternion = new Quaternion();
    // Simulate Three's coupled Euler/quaternion fields. This fixture tests
    // ownership and rollback, while authored talon math has its own tests.
    const copyRotation = this.rotation.copy.bind(this.rotation);
    const copyQuaternion = this.quaternion.copy.bind(this.quaternion);
    this.rotation.copy = value => { copyQuaternion(value); return copyRotation(value); };
    this.quaternion.copy = value => { copyRotation(value); return copyQuaternion(value); };
    this.scale = new Vector(1, 1, 1);
    this.matrixWorld = {};
    this.children = [];
  }
  add(child) { child.parent = this; this.children.push(child); }
  updateWorldMatrix() { this.worldZ = this.rotation.z; }
  getWorldScale(out) { return out.copy(this.scale); }
  rotateY() {}
}
class Matrix4 {
  copy() { return this; }
  invert() { return this; }
  multiplyMatrices(_parent, payload) { this.payload = payload; return this; }
  decompose(position, quaternion, scale) {
    position.set(4, 9, 3);
    quaternion.copy(this.payload.talonRotation);
    scale.set(2, 2, 2);
  }
}
class WebGLRenderer {
  render() { this.draw(); }
}

const scene = new Object3D(); // Both the carrier and the original prey share the active gameplay scene.
const preview = new Object3D(); // An unrelated scene drawn with the same renderer must stay isolated.
const carrierGroup = new Object3D();
const rig = { root: new Object3D(), talonCarry: {}, update() {}, dispose() {} };
const bird = { creatureKey: 'tzatzul', areaId: 'wilderness', health: 40,
  avatarRef: { group: carrierGroup }, _tzFlight: { captive: null } };
scene.add(carrierGroup);
const player = { health: 20, avatarRef: { group: new Object3D() } };
const captures = new Map(); // The flight runtime's real capture registry interface, tested separately through its gameplay entry points.
const world = { window: {
  THREE: { Object3D, Vector3: Vector, Quaternion, Matrix4, WebGLRenderer },
  FlyingAnimalRig: { placeTalonPayload(_talon, payload) {
    payload.matrixWorld.talonRotation = new Quaternion(.5, .6, .7); // Distinct pitch, yaw and roll for the render pose.
  } },
  TzatzulRegistration: { KIND: 'tzatzul', HATCHLING_KIND: 'tzatzul-hatchling',
    identityFor: () => ({}), createRig: () => rig },
  TzatzulFlightRuntime: {
    hasCaptives: () => captures.size > 0,
    carrierOf: prey => captures.get(prey),
    forEachCaptive: visit => captures.forEach((carrier, prey) => visit(prey, carrier)),
  },
}, console, performance: { now: () => 1000 } };
for (const name of ['render-hooks', 'rig-transform-layers', 'tzatzul-live-visuals']) {
  vm.runInNewContext(fs.readFileSync('docs/js/' + name + '.js', 'utf8'), world);
}
const { ActorRigCompositor: composer, RenderHooks: hooks, TzatzulLiveVisuals: visuals } = world.window;
const renderer = new WebGLRenderer();
const root = new Object3D(); // The actual player root differs from the portrait child.
const foot = new Object3D(); // Descendant solver must see the render placement owner.
scene.add(root);
root.add(foot);
root.position.set(2, 1, 3);
root.scale.set(1.2, .9, 1.7); // Preserve individual actor size even if the bird matrix has scale.

function hold(prey) {
  bird._tzFlight.captive = prey;
  prey.tzatzulCapturedBy = 'bird';
  captures.set(prey, bird);
}
function release(prey) {
  bird._tzFlight.captive = null;
  prey.tzatzulCapturedBy = null;
  captures.delete(prey);
}
function frame(draw) {
  hooks.beginWorldFrame({ renderer, scene });
  try { draw(); }
  finally { hooks.endWorldFrame(); }
}
function assertCarryPose(group) {
  assert.equal(group.rotation.z, .7, 'authored tilt is visible during every relevant draw');
  assert.equal(group.position.y, 9);
  assert.equal(composer.renderPoseOwner(group), 'tzatzul-carry');
}
function assertNativePose(group, yaw, pitch = 0) {
  assert.equal(group.rotation.x, pitch);
  assert.equal(group.rotation.y, yaw);
  assert.equal(group.rotation.z, 0, 'carry roll cannot feed back into the next yaw-only update');
  assert.equal(group.worldZ, 0, 'cached world matrices return to the native pose too');
  assert.equal(composer.renderPoseOwner(group), null);
  assert.equal(composer.getDebug().activeRenderPoses, 0);
}

(async () => {
  visuals.init({ player, hostileObjects: new Set([bird]) });
  visuals.tick(.01, 'wilderness');
  await new Promise(setImmediate); // Let the ordinary visual tick install the asynchronous flying rig.

  for (let grab = 0; grab < 4; grab++) {
    hold(player);
    for (let step = 1; step <= 3; step++) {
      const yaw = grab + step / 10; // Gait updates just yaw between render frames.
      root.rotation.copy(new Vector(root.rotation.x, yaw, root.rotation.z));
      root.position.x = grab + step;
      const undo = []; // Same player placement and shared unwind API used by the body composer.
      const placement = visuals.getPlayerCarryPlacement(root, scene);
      assert(placement, 'the normal mounted bird rig resolves a carry placement');
      assert.equal(root.rotation.z, 0, 'resolving a placement has no side effects on the player');
      assert.equal(visuals.getPlayerCarryPlacement(root, preview), null);
      assert(visuals.applyPlayerCarryPlacement(root, placement, undo));
      assertCarryPose(root);
      assert.equal(composer.renderPoseOwner(foot), 'tzatzul-carry');
      assert.equal(composer.absoluteOwner(root, 'quaternion'), null);
      assert.equal(root.scale.x, 1.2);
      assert.equal(player.avatarRef.group.rotation.z, 0);
      assert.equal(visuals.applyPlayerCarryPlacement(root, placement, undo), false, 'reentrant draw cannot replace the native snapshot');
      while (undo.length) undo.pop()();
      assertNativePose(root, yaw);
      assert.equal(root.position.x, grab + step, 'current physics position survives the frame');
    }
    release(player);
    root.rotation.copy(new Vector(.2, grab, 0)); // A different native fall/impact pose follows release immediately.
    assert.equal(visuals.getPlayerCarryPlacement(root, scene), null);
    assertNativePose(root, grab, .2);
    root.rotation.copy(new Vector());
  }

  // Three can derive a lossy Euler representation from a nearly singular
  // quaternion. Our fixture's Euler conversion drops w in the same way.
  const nativeQuaternion = new Quaternion(0, .25, 0, .97);
  root.quaternion.copy(nativeQuaternion);
  hold(player);
  const nearSingularUndo = []; // Use the same draw transaction as the player renderer.
  const nearSingularPlacement = visuals.getPlayerCarryPlacement(root, scene);
  assert(visuals.applyPlayerCarryPlacement(root, nearSingularPlacement, nearSingularUndo));
  nearSingularUndo.pop()();
  assert(root.quaternion.equals(nativeQuaternion), 'rollback preserves the exact native quaternion even if the Euler loses information');
  assertNativePose(root, .25);
  release(player);

  const animal = { health: 20, avatarRef: { group: new Object3D() } };
  const animalRoot = animal.avatarRef.group;
  scene.add(animalRoot);
  hold(animal);
  const successor = composer.createAbsoluteSession('impact');
  assert(successor.capture(animalRoot, ['quaternion']));
  frame(() => {
    renderer.draw = () => assert.equal(animalRoot.rotation.z, 0, 'an active absolute solver keeps its own root');
    renderer.render(scene);
  });
  successor.release();

  frame(() => {
    renderer.draw = () => assert.equal(animalRoot.rotation.z, 0);
    renderer.render(preview); // Unrelated previews cannot activate a world hook.
    renderer.draw = () => assertCarryPose(animalRoot);
    renderer.render(scene);
    renderer.render(scene); // Replay sees the same pose through the end of the frame.
  });
  assertNativePose(animalRoot, 0);

  const nextRoot = new Object3D(); // A promoted avatar is resolved on the next draw.
  scene.add(nextRoot);
  animal.avatarRef.group = nextRoot;
  assert.throws(() => frame(() => {
    renderer.draw = () => {
      assert.equal(animalRoot.rotation.z, 0, 'old rig stays untouched');
      assertCarryPose(nextRoot);
      throw new Error('draw failed');
    };
    renderer.render(scene);
  }), /draw failed/);
  assertNativePose(nextRoot, 0);
  release(animal);

  console.log('Tzatzul draw-only carry: repeated grabs, yaw/impact isolation, depth replay and failed draw rollback PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
