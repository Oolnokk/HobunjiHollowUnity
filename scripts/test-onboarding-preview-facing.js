const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const observations = []; // Records orientation at the renderer boundary, including its shell pass.
const queued = []; // Isolated preview frames are advanced explicitly by this test.
const listeners = {}; // Captures the existing player-ready teardown.
class Vector {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { Object.assign(this, { x, y, z }); }
  clone() { return new Vector(this.x, this.y, this.z); }
  copy(other) { this.set(other.x, other.y, other.z); }
}
class Renderer {
  render(scene, camera) {
    observations.push({ yaw: scene.root?.rotation.y, camera: camera.position.clone() });
    if (scene.fail) throw new Error('render failure');
    return 123;
  }
}
const context = {
  window: { THREE: { WebGLRenderer: Renderer }, HOBUNJI_ONBOARDING_REDESIGN_STATUS: {} },
  document: { querySelector: () => null, addEventListener: (name, fn) => { listeners[name] = fn; } },
  requestAnimationFrame: fn => queued.push(fn),
  setTimeout: fn => fn(),
}; // Minimal browser and renderer interfaces execute the shipped composition hook.
vm.createContext(context);
vm.runInContext(fs.readFileSync('docs/js/onboarding-character-creation-camera-composition.js', 'utf8'), context);
queued.shift()();
const renderer = new Renderer(); // Wrapped renderer exercised without a GPU.
const camera = { isCamera: true, position: new Vector(0, 2, -3), quaternion: new Vector(), lookAt() {}, updateMatrixWorld() {} }; // Starts on a different side to check pose restoration.
const cameraYaw = Math.atan2(1.55, 2.75); // Actual camera azimuth used to determine which face is visible.
const turn = 10 * Math.PI / 180; // Intended subtle turn relative to the camera.
function renderRoot(baseline, drag = 0, fail = false) {
  const root = { rotation: { y: baseline + drag }, userData: { onboardingRestYaw: baseline }, updateMatrixWorld() {} }; // Simulates any root's explicit initial yaw and later drag delta.
  const scene = { root, fail, getObjectByName: () => root }; // Matches the creator scene lookup.
  if (fail) assert.throws(() => renderer.render(scene, camera), /render failure/);
  else assert.equal(renderer.render(scene, camera), 123);
  const rendered = observations.at(-1); // Rotation seen by the actual draw after composition has been applied.
  assert.ok(Math.abs(rendered.yaw - cameraYaw - turn - drag) < 1e-10);
  assert.equal(root.rotation.y, baseline + drag, 'render must restore the pointer-controlled yaw');
  assert.equal(camera.position.z, -3, 'render must restore the original camera');
  return rendered.yaw;
}
for (const baseline of [-0.18, 0, Math.PI, -Math.PI]) {
  const yaw = renderRoot(baseline);
  const poses = JSON.parse(fs.readFileSync('docs/config/combat/weapon-idle-stances.json', 'utf8')).stances; // Authored weapon body turns must keep the front visible from the starting camera.
  for (const pose of Object.values(poses)) {
    const bodyYaw = Number(pose.bodyYaw || 0) * Math.PI / 180; // Runtime weapon stance, preserved by the composition hook.
    assert.ok(Math.cos(yaw + bodyYaw - cameraYaw) > 0, 'starting weapon stance must face the camera');
  }
}
renderRoot(-0.18, 0.6);
renderRoot(-0.18, Math.PI);
renderRoot(-0.18, 0.2, true);
listeners.hobunjiPlayerReady();
const untouched = { rotation: { y: 2 }, userData: {} }; // After handoff gameplay renders must receive their original orientation.
renderer.render({ root: untouched }, camera);
assert.equal(observations.at(-1).yaw, 2);
console.log('creator facing: camera-relative front, stance parity, drag, failure restoration and teardown passed');
