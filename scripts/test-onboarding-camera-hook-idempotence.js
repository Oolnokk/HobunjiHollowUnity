'use strict';
const assert = require('node:assert/strict'); // Checks rendered yaw through the real decorator chain.
const fs = require('node:fs'); // Loads the owning camera module.
const vm = require('node:vm'); // Supplies a small renderer and frame queue.
const frames = []; // Runs installation frames in the same order as late runtime decorators.
const root = { rotation: { y: -0.18 }, updateMatrixWorld() {} }; // Original resting preview yaw.
const scene = { getObjectByName: () => root }; // Only creator scenes receive this composition.
const position = { set() {}, clone() { return this; }, copy() {} }; // Camera state preservation fixture.
const camera = { isCamera: true, position, quaternion: position, lookAt() {}, updateMatrixWorld() {} }; // Composition camera fixture.
let drawnYaw; // Captures the final draw angle rather than the restored scene state.
function Renderer() {}
Renderer.prototype.render = function () { drawnYaw = root.rotation.y; };
const context = { window: { THREE: { WebGLRenderer: Renderer } }, document: { addEventListener() {} }, requestAnimationFrame: callback => frames.push(callback), setTimeout() {} }; // Module environment.
vm.runInNewContext(fs.readFileSync('docs/js/onboarding-character-creation-camera-composition.js', 'utf8'), context);
frames.shift()();
for (let index = 0; index < 10; index++) {
  const previous = Renderer.prototype.render; // Late decorators retain the earlier hook without copying its function properties.
  Renderer.prototype.render = function (...args) { return previous.apply(this, args); };
  frames.shift()();
}
new Renderer().render(scene, camera);
assert.ok(Math.abs(drawnYaw - Math.PI / 18) < 1e-10, 'eleven installation frames must still apply exactly one resting turn');
assert.equal(root.rotation.y, -0.18, 'render restores the owning preview input angle');
root.rotation.y += 0.5;
new Renderer().render(scene, camera);
assert.ok(Math.abs(drawnYaw - (Math.PI / 18 + 0.5)) < 1e-10, 'drag rotation remains relative to the resting turn');
console.log('Creator camera hook remains idempotent beneath later render decorators.');
