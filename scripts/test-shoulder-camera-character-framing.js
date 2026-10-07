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
  PNGPlaneAvatar: { resolveSkinnedPixelWorldPosition(node) { return node.testHeadWorld; } }, // Represents the existing canonical skinned head-centroid resolver used by dialogue.
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

function makeRoot({ speciesId, gender, scaleY, neckHeight, modelHeight = 1, headHeight = neckHeight + 0.12, floorY = 0 }) {
  const neckJoint = {
    getWorldPosition(target) { target.x = 0; target.y = floorY + neckHeight; target.z = 0; return target; },
  }; // Represents the actual neck bone whose Y should drive non-Tletingan vertical framing.
  const avatarNode = {
    userData: {
      neckRig: { neckJoint, headCentroidPx: { x: 50, y: 15 } },
      portraitModelHeight: modelHeight,
      hobunjiCharacterRigHeadRuntime: { species: speciesId, gender },
    },
    testHeadWorld: headHeight == null ? null : { x: 0, y: floorY + headHeight, z: 0 }, // Lets fixtures control measured head height without introducing another head-position implementation.
    getWorldScale(target) { target.x = scaleY; target.y = scaleY; target.z = scaleY; return target; },
  }; // Represents the portrait avatar node carrying both rig and model-height metadata.
  return {
    userData: { hobunjiCharacterRigScaleState: { factor: { x: scaleY, y: scaleY }, species: speciesId } },
    updateMatrixWorld() {},
    getWorldPosition(target) { target.x = 0; target.y = floorY; target.z = 0; return target; },
    traverse(callback) { callback(this); callback(avatarNode); },
  }; // Represents the shared floor-relative player root used by hands, legs, portrait and camera framing.
}

const api = windowObject.HobunjiShoulderCameraCharacterFraming; // Public/mobile debug API exported by the bridge.
assert.ok(api && api.version >= 1, 'camera framing bridge must install');

const tletinganRoot = makeRoot({ speciesId: 'tletingan', gender: 'male', scaleY: 0.85, neckHeight: 0.71 }); // A reference species must now use its actual head center too.
assert.strictEqual(api.refreshPlayerFraming(tletinganRoot, { speciesId: 'tletingan', gender: 'male' }, 'test-tletingan'), true);
assert.strictEqual(shoulderMode.distanceTiles, 2.6, 'Tletingan must keep the current Shoulder Cam distance baseline');
assert.ok(Math.abs(shoulderMode.targetYOffsetTiles - 0.83) < 1e-9, 'Tletingan must target its head center');

const maoRoot = makeRoot({ speciesId: 'mao-ao', gender: 'male', scaleY: 1.02, neckHeight: 0.79 }); // Taller species fixture verifies both neck-Y and full-height distance adaptation.
assert.strictEqual(api.refreshPlayerFraming(maoRoot, { speciesId: 'mao-ao', gender: 'male' }, 'test-mao'), true);
const expectedRatio = 1.02 / 0.85; // Same-gender Tletingan scale is the requested reference height.
assert.ok(Math.abs(shoulderMode.distanceTiles - 2.6 * expectedRatio) < 1e-9, 'camera distance/zoom must scale with full character height');
assert.ok(Math.abs(shoulderMode.targetYOffsetTiles - 0.91) < 1e-9, 'camera Y must follow the live non-reference species head centroid');

const snapshot = api.snapshot(); // Confirms mobile diagnostics expose the measurements needed to validate framing without devtools.
assert.strictEqual(snapshot.speciesId, 'mao-ao');
assert.strictEqual(snapshot.gender, 'male');
assert.ok(Math.abs(snapshot.neckHeightTiles - 0.79) < 1e-9);
assert.ok(Math.abs(snapshot.heightRatio - expectedRatio) < 1e-9);
assert.ok(Math.abs(snapshot.characterHeightTiles - 1.02) < 1e-9);
assert.strictEqual(snapshot.usedMeasuredNeck, false);
assert.strictEqual(snapshot.usedMeasuredHead, true);
assert.strictEqual(snapshot.targetSource, 'head-centroid');
assert.ok(Math.abs(snapshot.headHeightTiles - 0.91) < 1e-9);

// Ranged focus now zooms optically by FOV. It must never freeze or own the
// species-relative shoulder distance while active.
windowObject.HobunjiRangedCameraFocus = { snapshot: () => ({ active: true, blend: 1, baseFovDeg: 55 }) };
const focusedRoot = makeRoot({ speciesId: 'mao-ao', gender: 'female', scaleY: 0.98, neckHeight: 0.76 });
assert.strictEqual(api.refreshPlayerFraming(focusedRoot, { speciesId: 'mao-ao', gender: 'female' }, 'test-focused'), true);
const focusedRatio = 0.98 / 0.89;
assert.ok(Math.abs(shoulderMode.distanceTiles - 2.6 * focusedRatio) < 1e-9,
  'active ranged FOV focus must not defer or overwrite species-relative camera distance');
const focusedSnapshot = api.snapshot();
assert.strictEqual(focusedSnapshot.distanceDeferredForRangedFocus, false);
assert.strictEqual(focusedSnapshot.rangedFocusActive, true);
assert.strictEqual(focusedSnapshot.rangedFocusBaseFovDeg, 55);

// Short species and elevated player roots retain the actual head's local height.
const nuhonganRoot = makeRoot({ speciesId: 'nuhongan', gender: 'male', scaleY: 0.6375, neckHeight: 0.15, headHeight: 0.29, floorY: 2.5 }); // Exercises Nuhongan head centering on a raised terrain tier.
assert.strictEqual(api.refreshPlayerFraming(nuhonganRoot, { speciesId: 'nuhongan', gender: 'male' }), true);
assert.ok(Math.abs(shoulderMode.targetYOffsetTiles - 0.29) < 1e-9, 'short characters target the head, with ground elevation removed');
assert.ok(Math.abs(shoulderMode.distanceTiles - 2.6 * 0.75) < 1e-9, 'head centering preserves existing species-relative distance');
assert.strictEqual(api.snapshot().targetSource, 'head-centroid');
const headlessRoot = makeRoot({ speciesId: 'nuhongan', gender: 'male', scaleY: 0.6375, neckHeight: 0.15, headHeight: null }); // Missing centroid data must keep a usable camera rather than producing NaN.
api.refreshPlayerFraming(headlessRoot, { speciesId: 'nuhongan', gender: 'male' });
assert.equal(shoulderMode.targetYOffsetTiles, 0.15);
assert.equal(api.snapshot().targetSource, 'neck-fallback');
for (const headHeight of [NaN, Infinity, -0.1, 12]) {
  const invalid = api.resolveFraming({ speciesId: 'nuhongan' }, { headHeight, neckHeight: 0.15, heightRatio: 0.75 }); // Verifies malformed head centers use the existing valid neck fallback.
  assert.equal(invalid.targetYOffsetTiles, 0.15);
  assert.equal(invalid.usedMeasuredHead, false);
}
const referenceFallback = api.resolveFraming({ speciesId: 'tletingan' }, { headHeight: null, neckHeight: 0.71, heightRatio: 1 }); // A missing Tletingan centroid retains its authored fallback.
assert.equal(referenceFallback.targetYOffsetTiles, 0.62);

console.log('Shoulder camera character framing tests passed.');
