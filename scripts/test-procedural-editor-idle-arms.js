'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'docs/js/procedural-editor-idle-arm-parity.js'), 'utf8');
const loaderSource = fs.readFileSync(path.join(root, 'docs/js/procedural-dance-mode.js'), 'utf8');

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(other) { return this.set(other.x, other.y, other.z); }
  clone() { return new Vector3(this.x, this.y, this.z); }
}

function makeHand(name, x, y, z = 0) {
  return {
    name,
    position: new Vector3(x, y, z),
    parent: null,
    updateMatrix() {},
    updateMatrixWorld() {},
  };
}

const left = makeHand('Preview_LeftHand', 0.2, 0.5); // Starts at the old broken shoulder-default position.
const right = makeHand('Preview_RightHand', -0.2, 0.5); // Starts at the old broken shoulder-default position.
const identityParent = {
  userData: { hobunjiCharacterRigScaleState: { species: 'test-species', gender: 'male' } },
  parent: null,
};
const model = {
  name: 'Preview',
  position: new Vector3(),
  userData: { portraitModelHeight: 1, portraitModelWidth: 0.9, handAttachY: 0.5 },
  children: [left, right],
  parent: identityParent,
  getObjectByName(name) { return this.children.find(child => child.name === name) || null; },
  updateMatrixWorld() {},
  localToWorld(point) { return point; },
};
left.parent = model;
right.parent = model;

const scene = { onBeforeRender: null };
const frames = []; // Captures the adapter's scene-binding loop so the test controls when it attaches.
let danceDebug = { enabled: false, armStyle: 'none' }; // Lets the test verify explicit procedural arm ownership wins over idle fallback.
const diagnostics = []; // Captures mobile-visible Diagnostics entries emitted by the adapter.
const profile = {
  species: 'test-species',
  gender: 'male',
  posteriorRule: { heightPercentFromFloor: 30 },
  anchors: {
    leftHandShoulder: { position: { x: 0.2, y: 0.5, z: 0 } },
    rightHandShoulder: { position: { x: -0.2, y: 0.5, z: 0 } },
  },
  anatomy: { armLengthHeightPercentOffset: 10 },
};
const windowObject = {
  HOBUNJI_ATTACHMENT_RIG_PROFILES: { characters: { 'test-species::male': profile } },
  HOBUNJI_ATTACHMENT_RIG_MATH: {
    characterPosteriorY(rule, modelHeight) { return modelHeight * rule.heightPercentFromFloor / 100; },
  },
  HobunjiGameplayBackdrop: {
    getScene() { return scene; },
    getAvatarModel() { return model; },
    log(message, level, extra) { diagnostics.push({ message, level, extra }); },
  },
  ProceduralDanceMode: { getDebug() { return danceDebug; } },
};
const sandbox = {
  window: windowObject,
  performance: { now: () => 0 },
  requestAnimationFrame(callback) { frames.push(callback); },
  console,
};
vm.runInNewContext(source, sandbox, { filename: 'procedural-editor-idle-arm-parity.js' });
assert.strictEqual(windowObject.HobunjiProceduralEditorIdleArms?.installed, true, 'idle-arm parity adapter should expose a debug/sync API');
assert.strictEqual(frames.length, 1, 'idle-arm parity adapter should schedule its scene-binding loop');
frames.shift()();
assert.strictEqual(typeof scene.onBeforeRender, 'function', 'idle-arm parity adapter should attach a final scene pre-render hook');

scene.onBeforeRender();
assert(Math.abs(left.position.x - 0.2) < 1e-9, 'left idle hand should preserve the canonical left shoulder X');
assert(Math.abs(left.position.y - 0.2) < 1e-9, 'left idle hand should use posterior Y minus authored arm length at zero idle phase');
assert(Math.abs(left.position.z - 0.003) < 1e-9, 'left idle hand should include the shared idle forward/back breathing offset');
assert(Math.abs(right.position.x + 0.2) < 1e-9, 'right idle hand should preserve the canonical right shoulder X');
assert(Math.abs(right.position.y - (0.2 + 0.0045 * Math.sin(0.28))) < 1e-9, 'right idle hand should include the shared phase-split idle breathing offset');
assert(Math.abs(right.position.z - (0.003 * Math.cos(0.28))) < 1e-9, 'right idle hand should include the shared phase-split idle depth offset');

left.position.set(0.7, 0.7, 0.7); // Simulates another procedural authoring writer taking left-hand ownership after the default pass.
scene.onBeforeRender();
assert.deepStrictEqual([left.position.x, left.position.y, left.position.z], [0.7, 0.7, 0.7], 'idle fallback must yield when an explicit animation writer moves a hand');
assert.strictEqual(windowObject.HobunjiProceduralEditorIdleArms.getDebug().left.owns, false, 'debug state should expose per-side ownership loss');

danceDebug = { enabled: true, armStyle: 'raise-reach' };
right.position.set(-0.8, 0.9, 0.4); // Simulates the explicit Dance arm solver's final target.
scene.onBeforeRender();
assert.deepStrictEqual([right.position.x, right.position.y, right.position.z], [-0.8, 0.9, 0.4], 'explicit Dance arm styles must remain higher priority than the idle default');
assert.match(windowObject.HobunjiProceduralEditorIdleArms.getDebug().reason, /^dance:/, 'debug state should identify explicit Dance ownership');

danceDebug = { enabled: false, armStyle: 'none' };
scene.onBeforeRender();
assert(Math.abs(left.position.y - 0.2) < 1e-9, 'ending an explicit Dance arm pose should reacquire canonical idle ownership immediately');
assert(Math.abs(right.position.x + 0.2) < 1e-9, 'ending an explicit Dance arm pose should restore the canonical right-hand shoulder X immediately');
assert(diagnostics.some(entry => /gameplay\/Attack Editor free-hand placement/.test(entry.message)), 'adapter should report its resolved idle-arm rule through the editor Diagnostics panel');

assert.match(loaderSource, /procedural-editor-idle-arm-parity\.js/, 'procedural editor Dance loader must load the idle-arm parity adapter');
assert.match(source, /HOBUNJI_ATTACHMENT_RIG_MATH\?\.characterPosteriorY/, 'editor idle arms must reuse the canonical posterior resolver');
assert.match(source, /armLengthHeightPercentOffset/, 'editor idle arms must consume the authored species/gender arm-length setting');
assert.match(source, /hand\.position\.copy\(target\)/, 'editor idle arms must drive the existing generated hand wrapper instead of creating a duplicate hand rig');
assert.match(source, /explicit-animation-owner/, 'editor idle arms must retain explicit animation ownership diagnostics');

console.log('procedural editor idle arms: canonical shoulder/posterior/arm-length fallback + ownership parity PASS');
