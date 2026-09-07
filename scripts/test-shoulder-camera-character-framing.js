const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('docs/js/shoulder-camera-character-framing.js', 'utf8'); // Executes the real runtime bridge rather than a duplicate test implementation.

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
} // Minimal Three.js vector surface required by the framing measurement code.

const shoulderMode = { distanceTiles: 2.6, targetYOffsetTiles: 0.62 }; // Reproduces the current Tletingan-authored Shoulder Cam defaults.
const scaleValues = {
  'tletingan::male': 0.85,
  'tletingan::female': 0.89,
  'mao-ao::male': 1.02,
  'mao-ao::female': 0.98,
}; // Supplies representative authored body-height factors for ratio tests.
const windowObject = {
  THREE: { Vector3 },
  SCRATCHBONES_CONFIG: { game: { camera: { modes: { shoulderSurf: shoulderMode } } } },
  HobunjiCharacterRigScale: {
    scaleFor(species, gender) {
      return { y: scaleValues[`${species}::${gender}`] || 1 };
    },
  },
  ProceduralLegAnimation: { attach() { return {}; } },
  ProceduralHandAttachments: { attach() { return {}; } },
}; // Provides the same global APIs the runtime bridge decorates in the game.
windowObject.window = windowObject;
const context = vm.createContext({
  window: windowObject,
  setInterval(fn) { fn(); return 1; },
  clearInterval() {},
  setTimeout(fn) { fn(); return 1; },
}); // Makes bridge installation and deferred leg refresh deterministic for this headless test.
vm.runInContext(source, context, { filename: 'shoulder-camera-character-framing.js' });

function makeRoot({ speciesId, gender, scaleY, neckHeight, modelHeight = 1 }) {
  const neckJoint = {
    getWorldPosition(target) { target.x = 0; target.y = neckHeight; target.z = 0; return target; },
  }; // Represents the actual neck bone whose Y should drive non-Tletingan vertical framing.
  const avatarNode = {
    userData: {
      neckRig: { neckJoint },
      portraitModelHeight: modelHeight,
      hobunjiCharacterRigHeadRuntime: { species: speciesId, gender },
    },
    getWorldScale(target) { target.x = scaleY; target.y = scaleY; target.z = scaleY; return target; },
  }; // Represents the portrait avatar node carrying both rig and model-height metadata.
  return {
    userData: { hobunjiCharacterRigScaleState: { factor: { x: scaleY, y: scaleY }, species: speciesId } },
    updateMatrixWorld() {},
    getWorldPosition(target) { target.x = 0; target.y = 0; target.z = 0; return target; },
    traverse(callback) { callback(this); callback(avatarNode); },
  }; // Represents the shared floor-relative player root used by hands, legs, portrait and camera framing.
}

const api = windowObject.HobunjiShoulderCameraCharacterFraming; // Public/mobile debug API exported by the bridge.
assert.ok(api && api.version >= 1, 'camera framing bridge must install');

const tletinganRoot = makeRoot({ speciesId: 'tletingan', gender: 'male', scaleY: 0.85, neckHeight: 0.71 }); // Deliberately uses a measured neck different from 0.62 to prove Tletingan keeps the authored baseline exactly.
assert.strictEqual(api.refreshPlayerFraming(tletinganRoot, { speciesId: 'tletingan', gender: 'male' }, 'test-tletingan'), true);
assert.strictEqual(shoulderMode.distanceTiles, 2.6, 'Tletingan must keep the current Shoulder Cam distance baseline');
assert.strictEqual(shoulderMode.targetYOffsetTiles, 0.62, 'Tletingan must keep the current Shoulder Cam Y baseline');

const maoRoot = makeRoot({ speciesId: 'mao-ao', gender: 'male', scaleY: 1.02, neckHeight: 0.79 }); // Taller species fixture verifies both neck-Y and full-height distance adaptation.
assert.strictEqual(api.refreshPlayerFraming(maoRoot, { speciesId: 'mao-ao', gender: 'male' }, 'test-mao'), true);
const expectedRatio = 1.02 / 0.85; // Same-gender Tletingan scale is the requested reference height.
assert.ok(Math.abs(shoulderMode.distanceTiles - 2.6 * expectedRatio) < 1e-9, 'camera distance/zoom must scale with full character height');
assert.ok(Math.abs(shoulderMode.targetYOffsetTiles - 0.79) < 1e-9, 'camera Y must follow the live non-reference species neck joint');

const snapshot = api.snapshot(); // Confirms mobile diagnostics expose the measurements needed to validate framing without devtools.
assert.strictEqual(snapshot.speciesId, 'mao-ao');
assert.strictEqual(snapshot.gender, 'male');
assert.ok(Math.abs(snapshot.neckHeightTiles - 0.79) < 1e-9);
assert.ok(Math.abs(snapshot.heightRatio - expectedRatio) < 1e-9);
assert.ok(Math.abs(snapshot.characterHeightTiles - 1.02) < 1e-9);
assert.strictEqual(snapshot.usedMeasuredNeck, true);

console.log('Shoulder camera character framing tests passed.');
