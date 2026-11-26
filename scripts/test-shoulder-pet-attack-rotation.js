#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const gameSource = fs.readFileSync('docs/game.js', 'utf8');
const indexSource = fs.readFileSync('docs/index.html', 'utf8');
const runtimeSource = fs.readFileSync('docs/js/shoulder-pet-attachment-runtime.js', 'utf8'); // Executes the actual extracted grip solver and pin.
const renderManifest = fs.readFileSync('docs/js/bootstrap/classic-groups/render.js', 'utf8'); // Ensures dependency loads before game.js.

assert.match(gameSource, /updateShoulderPetMeshPin\(\);/, 'gameplay still re-pins shoulder pets after player/tool pose');
assert.match(gameSource, /const s_shoulderPetRotationSource = 'head';/,
  'head/neck remains the fixed authored shoulder rotation frame');
assert.doesNotMatch(indexSource, /Shoulder-Pet Rotation Source|Invert Selected Shoulder Rotation|Cancel Shoulder-Pet Rotational Offset/,
  'shoulder presentation tuning controls are no longer exposed in Settings');
assert.match(runtimeSource,
  /const facingTowardPlayerCenter = pet\?\.__hobunjiShoulderFacingInward === true;[\s\S]{0,5000}const shoulderFacingTurnDeg = facingTowardPlayerCenter !== authoredFacesInward \? 180 : 0;/,
  'the chosen half-turn depends on the authored heading and the observation pose');
assert.match(runtimeSource,
  /worldQuaternion\.multiply\(authoredRotationOffset\);[\s\S]{0,700}worldQuaternion\.multiply\(SHOULDER_PET_HALF_TURN_QUATERNION\)/,
  'the half-turn is applied after the authored perch/grip correction in pet-local space');
assert.doesNotMatch(runtimeSource, /authoredRotationOffset\.invert\(\)/,
  'opposite shoulder facing never inverts the authored quaternion');
assert.doesNotMatch(runtimeSource, /desiredVisualFacingSign|observationMirrored|canonicalFacingSign/,
  'shoulder facing no longer computes or requests sprite mirror parity');
assert.match(runtimeSource,
  /facingTowardPlayerCenter: finalTransform\.facingTowardPlayerCenter === true[\s\S]{0,180}shoulderFacingTurnDeg:[\s\S]{0,360}spriteMirrored: false/,
  'final diagnostics record 0/180 local turn and guarantee no sprite mirror');
assert.match(runtimeSource,
  /worldPosition: perchWorldPosition\.clone\(\)\.sub\(gripWorldOffset\)/,
  'the pet root is re-solved after rotation so shoulderGrip remains pinned to shoulderPerch');
assert.match(runtimeSource, /authoritativeRootTransform: true/,
  'final attachment remains authoritative');
assert.match(runtimeSource, /const shoulderLeanDeg = 0;/,
  'curiosity never applies a whole-body lean to the shoulder-pet root');
assert.doesNotMatch(runtimeSource, /SHOULDER_PET_LEAN_AXIS|SHOULDER_PET_LEAN_QUATERNION/,
  'the retired whole-body curiosity rotation is not reachable');
const curiositySource = gameSource.slice(gameSource.indexOf('function _applyShoulderPetCuriosity'), gameSource.indexOf('function _isPlayerGenuinelyIdle'));
assert.doesNotMatch(curiositySource, /frontPlane\.rotation\.z|backPlane\.rotation\.z|baseFrontRoll|baseBackRoll/,
  'curiosity does not rotate the visible image planes about their centers');
assert.match(runtimeSource, /shoulderLeanDeg: Number\(finalTransform\.shoulderLeanDeg\) \|\| 0/,
  'mobile attachment debug reports the neutralized body lean');
console.log('shoulder pet direction-signed rotation tests passed');


// Verify the entrypoint delegates both shoulder operations to their single feature owner.
assert.match(gameSource, /shoulderPetAttachment\.solveSurfaceTransform\(perch, grip, c\)/,
  'gameplay delegates the shoulder solver without adding an update loop');
assert.match(gameSource, /shoulderPetAttachment\.applyFinalTransform\(c, finalTransform\)/,
  'gameplay delegates final root pinning to the same instance');
assert.match(renderManifest, /js\/shoulder-pet-attachment-runtime\.js\?v=[A-Za-z0-9_-]+/,
  'the existing parser-ordered render group owns the module');
assert.doesNotMatch(indexSource, /src="js\/shoulder-pet-attachment-runtime\.js/,
  'index.html does not acquire a new standalone script registration');

class TestVector3 {
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  clone() { return new TestVector3(this.x, this.y, this.z); }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  toArray() { return [this.x, this.y, this.z]; }
  multiply(v) { this.x *= v.x; this.y *= v.y; this.z *= v.z; return this; }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
  applyQuaternion(q) {
    const { x, y, z } = this;
    const ix = q.w * x + q.y * z - q.z * y;
    const iy = q.w * y + q.z * x - q.x * z;
    const iz = q.w * z + q.x * y - q.y * x;
    const iw = -q.x * x - q.y * y - q.z * z;
    this.x = ix * q.w - iw * q.x - iy * q.z + iz * q.y;
    this.y = iy * q.w - iw * q.y - iz * q.x + ix * q.z;
    this.z = iz * q.w - iw * q.z - ix * q.y + iy * q.x;
    return this;
  }
}
class TestQuaternion {
  constructor(x = 0, y = 0, z = 0, w = 1) { Object.assign(this, { x, y, z, w }); }
  clone() { return new TestQuaternion(this.x, this.y, this.z, this.w); }
  copy(v) { Object.assign(this, { x: v.x, y: v.y, z: v.z, w: v.w }); return this; }
  identity() { return this.copy(new TestQuaternion()); } // THREE.Quaternion's API used by the mirrored-parent fallback resolver.
  toArray() { return [this.x, this.y, this.z, this.w]; }
  setFromAxisAngle(a, radians) {
    const s = Math.sin(radians / 2);
    Object.assign(this, { x: a.x * s, y: a.y * s, z: a.z * s, w: Math.cos(radians / 2) });
    return this;
  }
  setFromEuler(e) {
    assert.equal(e.order, 'YXZ', 'authoring rotation order remains explicit');
    const q = new TestQuaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, e.y)
      .multiply(new TestQuaternion().setFromAxisAngle({ x: 1, y: 0, z: 0 }, e.x))
      .multiply(new TestQuaternion().setFromAxisAngle({ x: 0, y: 0, z: 1 }, e.z));
    Object.assign(this, q);
    return this;
  }
  multiply(b) {
    const a = this.clone();
    this.x = a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y;
    this.y = a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x;
    this.z = a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w;
    this.w = a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z;
    return this;
  }
  invert() { this.x *= -1; this.y *= -1; this.z *= -1; return this; }
  normalize() {
    const size = Math.hypot(this.x, this.y, this.z, this.w) || 1;
    this.x /= size; this.y /= size; this.z /= size; this.w /= size;
    return this;
  }
}
class TestEuler {
  constructor(x, y, z, order) { Object.assign(this, { x, y, z, order }); }
}
const degrees = value => value * Math.PI / 180; // Used by the stub THREE provider and independent fixture orientations.
const yaw = angle => new TestQuaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, degrees(angle)); // Stable player/neck fixture.
const THREE = { Vector3: TestVector3, Quaternion: TestQuaternion, Euler: TestEuler,
  MathUtils: { degToRad: degrees } }; // Only production THREE APIs actually needed by the extracted solver.
const playerPosition = new TestVector3(4, 8, -3); // Off-origin body translation checks fallback world anchoring.
const playerQuaternion = yaw(17); // Owner body rotation differs from neck rotation.
const playerMesh = {
  updateWorldMatrix() {},
  getWorldQuaternion() { return playerQuaternion.clone(); },
  localToWorld(point) { return point.applyQuaternion(playerQuaternion).add(playerPosition); },
  worldToLocal(point) { return point.sub(playerPosition).applyQuaternion(playerQuaternion.clone().invert()); },
}; // Production solver sees a rotated body, but must use the head follow frame for orientation.
const playerNeckJoint = {
  isObject3D: true,
  updateWorldMatrix() {},
  getWorldQuaternion() { return yaw(31); },
}; // Different from the body frame to catch mistaken head/body orientation coupling.
const skinnedPerchPosition = new TestVector3(5.3, 8.7, -2.6); // Actual live-animated shoulder target, on the opposite side from the authored X, as when the portrait art is flipped.
const solverFactory = new Function('THREE', 'playerMesh', 'playerNeckJoint', 'window',
  's_shoulderPetRotationSource', 's_invertShoulderPetRotationSource',
  's_cancelShoulderPetRotationalOffset',
  runtimeSource + '\nreturn window.ShoulderPetAttachmentRuntime.create({ THREE,'
    + ' getPlayerMesh: () => playerMesh, getPlayerNeckJoint: () => playerNeckJoint,'
    + ' getRotationSource: () => s_shoulderPetRotationSource,'
    + ' getInvertRotationSource: () => s_invertShoulderPetRotationSource,'
    + ' getCancelRotationalOffset: () => s_cancelShoulderPetRotationalOffset'
    + ' }).solveSurfaceTransform;'); // Runs the production module, not a duplicated solver.
const closeness = (actual, expected, description) =>
  assert.ok(actual.distanceTo(expected) < 1e-9, description + ': ' + actual.distanceTo(expected)); // Grip error tolerance in world units.
const applyFinalTransform = new Function('THREE', 'window',
  runtimeSource + '\nreturn window.ShoulderPetAttachmentRuntime.create({ THREE,'
    + ' getPlayerMesh: () => null, getPlayerNeckJoint: () => null,'
    + " getRotationSource: () => 'head', getInvertRotationSource: () => false,"
    + ' getCancelRotationalOffset: () => false }).applyFinalTransform;')(
  THREE, { ShoulderPetObservationFlip: null }); // Exercises actual module pin against a THREE-compatible root.
assert.match(runtimeSource, /gripPositionSource: finalTransform\.gripLocalPosition \? 'rendered-group-matrix'/,
  'mobile grip error identifies actual rendered-matrix measurement');

for (const skinned of [true, false]) {
  const windowFixture = {
    PNGPlaneAvatar: {
      resolveSkinnedPixelWorldFrame() {
        return skinned ? { position: skinnedPerchPosition.clone(), quaternion: yaw(24) } : null;
      },
    },
  }; // Checks live-skinned shoulder placement and its static owner-body fallback.
  const solve = solverFactory(THREE, playerMesh, playerNeckJoint, windowFixture,
    'head', false, false); // All supplied configuration values match production defaults.
  for (const facingInward of [false, true]) {
    for (const multiplier of [0.7, 1, 1.9]) {
      const perch = {
        x: -0.32, y: 0.48, z: 0.14,
        sourcePixel: { x: 123, y: 42 },
        rotationDeg: { x: 4, y: -12, z: 7 },
        scale: { x: multiplier, y: multiplier, z: multiplier },
      }; // Off-center authored shoulder surface with a nontrivial 3D orientation.
      const rawGrip = { x: 0.19, y: -0.36, z: 0.08 }; // Deliberately off-center authoring-space grip, independent of genotype rendering scale.
      const renderedScale = { x: multiplier, y: multiplier * 0.8 * 1.018, z: multiplier * 1.5 }; // Mirrors THREE's depth/height/width scale mapping plus breathing.
      const grip = {
        x: rawGrip.x * 1.5, y: rawGrip.y * 0.8, z: rawGrip.z, // Legacy fields retain their old genotype-normalized form for unrelated consumers.
        localPosition: rawGrip, // The updated shoulder pin must use the raw grip through the actual group scale instead.
        rotationDeg: { x: -9, y: 61, z: 3 },
      }; // Renderer deliberately scales width, depth, and breathing differently; a simplistic uniform offset must fail this test.
      const perchWorld = skinned
        ? skinnedPerchPosition.clone()
        : playerMesh.localToWorld(new TestVector3(perch.x, perch.y, perch.z));
      const pinAt = lean => solve(perch, grip, {
        __hobunjiShoulderFacingInward: facingInward,
        shoulderCuriosity: { currentLeanDeg: lean },
        avatarRef: { group: { scale: renderedScale } },
      }); // Samples the real pin with the full rendered scale, not just the static authored perch multiplier.
      const neutral = pinAt(0);
      closeness(new TestVector3(0, 1, 0).applyQuaternion(neutral.worldQuaternion), new TestVector3(0, 1, 0),
        'authored perch and grip angles keep the neutral pet upright');
      for (const lean of [-7, -3, 0, 3, 7]) {
        const pose = pinAt(lean);
        const localGrip = new TestVector3(rawGrip.x, rawGrip.y, rawGrip.z); // Native grip coordinates before THREE's nonuniform group scale.
        const worldGrip = localGrip.multiply(renderedScale).applyQuaternion(pose.worldQuaternion).add(pose.worldPosition);
        closeness(worldGrip, perchWorld, 'actual rendered shoulderGrip stays on shoulderPerch through breathing and head-only curiosity');
        assert.ok(pose.gripLocalPosition, 'production solver exposes native grip for a real matrix measurement');
        const fakeGroup = {
          parent: null, position: new TestVector3(), quaternion: new TestQuaternion(), scale: renderedScale,
          userData: { hobunjiShoulderSpriteCanonicalized: true },
          localToWorld(v) { return v.multiply(this.scale).applyQuaternion(this.quaternion).add(this.position); },
        }; // Simulates the THREE root, including its real nonuniform width/depth and breathing scale.
        const fakePlane = () => ({ rotation: { set() {} }, updateMatrix() {}, matrixWorldNeedsUpdate: false }); // Minimal visible front/back plane reset.
        const fakePet = { avatarRef: { group: fakeGroup, frontPlane: fakePlane(), backPlane: fakePlane() } }; // Captures actual rendered grip error after the final pin.
        applyFinalTransform(fakePet, pose);
        closeness(fakeGroup.localToWorld(new TestVector3(rawGrip.x, rawGrip.y, rawGrip.z)),
          perchWorld, 'the production final-render transform preserves the physical grip');
        assert.ok(fakeGroup.userData.hobunjiShoulderPetAttachment.gripPerchError < 1e-9,
          'reported grip error is measured from the rendered group matrix');
        assert.equal(fakeGroup.userData.hobunjiShoulderPetAttachment.gripPositionSource,
          'rendered-group-matrix', 'mobile diagnostics report the live render-matrix source');
        assert.equal(pose.shoulderFacingTurnDeg, neutral.shoulderFacingTurnDeg, 'lean leaves the selected half-turn alone');
        const heading = new TestVector3(0, 0, 1).applyQuaternion(pose.worldQuaternion);
        const ownerRight = new TestVector3(1, 0, 0).applyQuaternion(playerQuaternion);
        const renderedPerchX = playerMesh.worldToLocal(perchWorld.clone()).x; // Check the visible shoulder, which flips when the pixel resolver returns the other side.
        const lateralHeading = heading.x * ownerRight.x + heading.z * ownerRight.z;
        assert.equal(lateralHeading * renderedPerchX < 0, facingInward,
          'the nose points toward the midline in the inward pose, including on the UV-flipped shoulder');
        assert.equal(pose.shoulderLeanDeg, 0, 'head-only curiosity never changes the rendered body lean');
        closeness(pose.worldPosition, neutral.worldPosition,
          'the whole body stays fixed as curiosity changes, without shifting its perch');
        assert.ok(Math.abs(pose.worldQuaternion.x - neutral.worldQuaternion.x) < 1e-9
          && Math.abs(pose.worldQuaternion.y - neutral.worldQuaternion.y) < 1e-9
          && Math.abs(pose.worldQuaternion.z - neutral.worldQuaternion.z) < 1e-9
          && Math.abs(pose.worldQuaternion.w - neutral.worldQuaternion.w) < 1e-9,
          'body yaw/pitch/roll remains exactly fixed across the head-only curiosity animation');
      }
      const withoutCuriosity = solve(perch, grip, {
        __hobunjiShoulderFacingInward: facingInward, avatarRef: { group: { scale: renderedScale } },
      });
      assert.equal(withoutCuriosity.shoulderLeanDeg, 0, 'missing curiosity state is neutral, not NaN');
      closeness(withoutCuriosity.worldPosition, neutral.worldPosition, 'neutral lean leaves the authored facing pose unchanged');
    }
  }
}
// Grehlr, Drenkirra and neutral grip rigs differ in which authored half-turn starts toward the midline.
const solveBody = solverFactory(THREE, playerMesh, playerNeckJoint, {}, 'body', false, false);
for (const shoulderX of [-0.28, 0.28]) for (const gripYaw of [-61, 0, 61]) {
  const headings = [false, true].map(inward => {
    const pose = solveBody({ x: shoulderX, y: 0.45, z: 0 },
      { rotationDeg: { y: gripYaw } }, { __hobunjiShoulderFacingInward: inward });
    const localHeading = new TestVector3(0, 0, 1).applyQuaternion(pose.worldQuaternion)
      .applyQuaternion(playerQuaternion.clone().invert()); // Root +Z is the art's nose direction.
    assert(Math.abs(localHeading.x) > 0.5, 'neutral grips also present a readable side profile');
    assert.equal(localHeading.x * shoulderX < 0, inward, 'pose points toward the actual perch side of the midline');
    return localHeading;
  });
  closeness(headings[0].add(headings[1]), new TestVector3(), 'both poses stay opposite around the grip');
}
// Even the legacy option to cancel the authored perch/grip rotation must not cancel the observation's 180° facing swap.
const canceledRotationSolver = solverFactory(THREE, playerMesh, playerNeckJoint,
  { PNGPlaneAvatar: { resolveSkinnedPixelWorldFrame: () => null } },
  'head', false, true); // Uses the production solver with the authored offset deliberately suppressed.
const canceledPerch = { x: -0.1, y: 0.5, z: 0.1, rotationDeg: { x: 16, y: 48, z: -7 } }; // Nontrivial authored rotation would expose accidental offset application.
const canceledGrip = { x: 0.12, y: -0.2, z: 0.08, rotationDeg: { x: 0, y: 23, z: 0 } }; // Off-center grip must still pin during the 180-degree turn.
const canceledOutward = canceledRotationSolver(canceledPerch, canceledGrip, { __hobunjiShoulderFacingInward: false });
const canceledInward = canceledRotationSolver(canceledPerch, canceledGrip, { __hobunjiShoulderFacingInward: true });
const outwardAxis = new TestVector3(1, 0, 0).applyQuaternion(canceledOutward.worldQuaternion); // Compares rendered pet-local facing between the two observation poses.
const inwardAxis = new TestVector3(1, 0, 0).applyQuaternion(canceledInward.worldQuaternion); // The inward pose must face exactly opposite the outward pose.
closeness(outwardAxis, new TestVector3(1, 0, 0).applyQuaternion(yaw(31)),
  'cancel-authored-offset preserves the selected head rotation in the outward pose');
closeness(outwardAxis.clone().add(inwardAxis), new TestVector3(),
  'cancel-authored-offset does not suppress the observation 180-degree sprite turn');
assert.equal(canceledOutward.shoulderFacingTurnDeg, 0);
assert.equal(canceledInward.shoulderFacingTurnDeg, 180);
for (const transform of [canceledOutward, canceledInward]) {
  const gripAt = new TestVector3(canceledGrip.x, canceledGrip.y, canceledGrip.z)
    .applyQuaternion(transform.worldQuaternion).add(transform.worldPosition); // Final pin is checked independently for both turns.
  closeness(gripAt, transform.perchWorldPosition, 'cancel-authored-offset still pins both observation poses to the perch');
}
// Rebuilding the player portrait/neck must not strand the attachment on a stale reference.
const runtimeFactory = new Function('window',
  runtimeSource + '\nreturn window.ShoulderPetAttachmentRuntime.create;')({
  PNGPlaneAvatar: { resolveSkinnedPixelWorldFrame: () => null },
}); // Uses the same production module but swaps its owner getters between frames.
let livePlayerMesh = playerMesh; // First solve uses the original owner; then an avatar rebuild replaces it.
let liveNeckJoint = playerNeckJoint; // The neck rig can be replaced independently of the owner root.
const liveRuntime = runtimeFactory({
  THREE,
  getPlayerMesh: () => livePlayerMesh, getPlayerNeckJoint: () => liveNeckJoint,
  getRotationSource: () => 'head', getInvertRotationSource: () => false,
  getCancelRotationalOffset: () => false,
});
const livePerch = { x: -0.2, y: 0.4, z: 0.15, rotationDeg: { x: 0, y: 0, z: 0 } }; // Static fallback socket for replacement checks.
const liveGrip = { x: 0.1, y: -0.25, z: 0.03, rotationDeg: { x: 0, y: 0, z: 0 } }; // Noncentral grip detects stale translation.
const livePet = { __hobunjiShoulderFacingInward: false }; // No curiosity/scale effects obscure the getter regression.
const beforeReplace = liveRuntime.solveSurfaceTransform(livePerch, liveGrip, livePet);
liveNeckJoint = { isObject3D: true, updateWorldMatrix() {}, getWorldQuaternion: () => yaw(75) };
const newNeck = liveRuntime.solveSurfaceTransform(livePerch, liveGrip, livePet);
assert.ok(Math.abs(newNeck.worldQuaternion.y - beforeReplace.worldQuaternion.y) > 0.1,
  'attachment reads the newly rebuilt player neck rather than its old captured quaternion');
livePlayerMesh = {
  ...playerMesh, localToWorld: point => point.applyQuaternion(yaw(17)).add(new TestVector3(-9, 3, 4)),
}; // Simulates a fresh owner root at another world position.
const newOwner = liveRuntime.solveSurfaceTransform(livePerch, liveGrip, livePet);
assert.ok(newOwner.perchWorldPosition.distanceTo(newNeck.perchWorldPosition) > 1,
  'attachment reads the newly replaced player root and repositions the pinned grip');

for (const pitch of [-68, 48, 90]) {
  const tilt = new TestQuaternion().setFromEuler(new TestEuler(degrees(pitch), degrees(17), 0, 'YXZ')); // Tilt the socket while holding the owner's heading fixed.
  const roll = new TestQuaternion().setFromAxisAngle({ x: 0, y: 0, z: 1 }, degrees(pitch === 90 ? 0 : 35)); // Include compound pitch and roll outside the vertical-forward case.
  tilt.multiply(roll);
  livePlayerMesh = {
    ...playerMesh,
    localToWorld: point => point.applyQuaternion(tilt).add(playerPosition),
  };
  liveNeckJoint = { ...playerNeckJoint, getWorldQuaternion: () => tilt.clone() };
  const tilted = liveRuntime.solveSurfaceTransform(livePerch, liveGrip, livePet); // Exercise the actual gameplay head source and moving fallback perch.
  const upright = solveBody(livePerch, liveGrip, livePet); // Same heading on a level carrier.
  const expectedPerch = livePlayerMesh.localToWorld(new TestVector3(livePerch.x, livePerch.y, livePerch.z)); // Independent position from the tilted owner matrix.
  assert.ok(expectedPerch.distanceTo(upright.perchWorldPosition) > 0.1, 'carrier tilt actually moves the perch');
  closeness(new TestVector3(0, 1, 0).applyQuaternion(tilted.worldQuaternion), new TestVector3(0, 1, 0),
    'the pet stays world-up with the carrier pitched and rolled');
  closeness(new TestVector3(0, 0, 1).applyQuaternion(tilted.worldQuaternion),
    new TestVector3(0, 0, 1).applyQuaternion(upright.worldQuaternion), 'tilt keeps the same horizontal heading');
  closeness(new TestVector3(liveGrip.x, liveGrip.y, liveGrip.z).applyQuaternion(tilted.worldQuaternion).add(tilted.worldPosition),
    expectedPerch, 'the upright rotation keeps the grip on the moved perch');
}

// Legacy pets whose authored shoulderPerch/shoulderGrip are absent arrive via
// game.js with its old getWorldQuaternion() from a potentially reflected rig.
const reflectedAncestor = { isObject3D: true, quaternion: yaw(27), parent: null, scale: { x: -1, y: 1, z: 1 } }; // Model a body-mirror ancestor, not an animation flip.
const actualPlayerRoot = {
  isObject3D: true, quaternion: new TestQuaternion().setFromEuler(new TestEuler(degrees(32), degrees(14), degrees(-19), 'YXZ')), parent: reflectedAncestor,
  getWorldQuaternion: () => yaw(221), // A false 180° rotation from negative-scale matrix decomposition must not be applied.
}; // Physical horizontal heading is 41° through reflection and tilt.
const fallbackRuntime = runtimeFactory({
  THREE, getPlayerMesh: () => actualPlayerRoot, getPlayerNeckJoint: () => null,
  getRotationSource: () => 'body', getInvertRotationSource: () => false,
  getCancelRotationalOffset: () => false,
});
const fallbackGroup = {
  parent: null, position: new TestVector3(), quaternion: new TestQuaternion(),
  userData: { hobunjiShoulderSpriteCanonicalized: true },
}; // Actual pet scene sibling has no mirrored ancestor of its own.
const fallbackPlane = () => ({ rotation: { set() {} }, updateMatrix() {} }); // One canonical plane reset per drawn face.
const fallbackPet = { avatarRef: {
  group: fallbackGroup, frontPlane: fallbackPlane(), backPlane: fallbackPlane(),
} };
fallbackRuntime.applyFinalTransform(fallbackPet, {
  worldPosition: new TestVector3(2, 1, 3),
  worldQuaternion: yaw(221),
  faceRotationSource: 'player-body-fallback-no-authored-anchors',
});
const physicalWorldQuaternion = yaw(41);
const orientationDot = (a, b) => Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w); // Quaternion parity ignores the equivalent q/-q representation.
assert.ok(orientationDot(fallbackGroup.quaternion, physicalWorldQuaternion) > 1 - 1e-9,
  'legacy shoulder pets without authored anchors ignore a reflected 180° body quaternion');
assert.equal(fallbackGroup.userData.hobunjiShoulderPetAttachment.rotationSource,
  'player-body-fallback-no-authored-anchors', 'debug identifies this no-authored-anchor ownership path');
assert.ok(orientationDot(
  { x: fallbackGroup.userData.hobunjiShoulderPetAttachment.finalWorldQuaternion[0],
    y: fallbackGroup.userData.hobunjiShoulderPetAttachment.finalWorldQuaternion[1],
    z: fallbackGroup.userData.hobunjiShoulderPetAttachment.finalWorldQuaternion[2],
    w: fallbackGroup.userData.hobunjiShoulderPetAttachment.finalWorldQuaternion[3] },
  physicalWorldQuaternion,
) > 1 - 1e-9, 'mobile debug reports the repaired applied orientation, not the false reflected source');

console.log('production shoulder grip-pivot solver numerical cases passed');


// Render-time shoulder correction follows the final posed pixel, not the
// stale GPU palette or the simulation-time world position. The tiny fixture
// uses the same cached triangle/skin interpolation as a real portrait.
TestVector3.prototype.applyMatrix4=function(m){
  const a=m.elements,{x,y,z}=this;
  return this.set(a[0]*x+a[4]*y+a[8]*z+a[12],a[1]*x+a[5]*y+a[9]*z+a[13],a[2]*x+a[6]*y+a[10]*z+a[14]);
};
const translation=(x=0,y=0,z=0)=>({elements:[1,0,0,0,0,1,0,0,0,0,1,0,x,y,z,1]});
let reads=0,fullUpdates=0,frameSamples=0,flipped=false;
const attr=points=>({count:points.length,version:0,getX:i=>{reads++;return points[i][0];},getY:i=>{reads++;return points[i][1];},getZ:i=>{reads++;return points[i][2]||0;}});
const coords=[[0,0],[1,0],[0,1],[1,0],[1,1],[0,1]];
const attributes={position:attr(coords),uv:attr(coords.map(([x,y])=>[x,1-y])),skinIndex:{array:new Uint16Array(24),version:0},skinWeight:{array:new Float32Array(24),version:0}};
for(let i=0;i<6;i++){attributes.skinIndex.array[i*4]=coords[i][0];attributes.skinWeight.array[i*4]=1;}
const bone=(x=0,y=0,z=0)=>({x,y,z,matrixWorld:translation(x,y,z),updateWorldMatrix(){this.matrixWorld=translation(this.x,this.y,this.z);}});
const torso=bone(10,0,0),neck=bone(10,4,0);
const mesh={geometry:{userData:{portraitGridRows:[0,1],segmentsX:1,segmentsY:1},getAttribute:k=>attributes[k]},bindMatrix:translation(),bindMode:'attached',
  skeleton:{bones:[torso,neck],boneInverses:[translation(),translation()],boneMatrices:new Float32Array(32),update(){fullUpdates++;}}};
const owner={userData:{sourceCanvas:{width:100,height:100},neckRig:{available:true,skinnedPlane:mesh}},updateWorldMatrix(){},
  getWorldQuaternion(){return yaw(0);},localToWorld(v){return v;},worldToLocal(v){return v;}};
const win={PNGPlaneAvatar:{resolveSkinnedPortraitRoot:()=>owner,getPortraitsFlipped:()=>flipped,
  resolveSkinnedPixelWorldPosition(){throw Error('regular grid must not use the full legacy sampler');},
  resolveSkinnedPixelWorldFrame(){frameSamples++;throw Error('head mode must not compute five samples');}}};
new Function('window',runtimeSource)(win);
const sampler=win.ShoulderPetAttachmentRuntime.createPerchSampler(THREE);
const pixel={x:25,y:25},out=new TestVector3();
closeness(sampler(owner,pixel,out),new TestVector3(10.25,1.25,0),'weighted skin point matches barycentric triangle');
const firstReads=reads;
neck.y=8;
closeness(sampler(owner,pixel,out),new TestVector3(10.25,2.25,0),'live neck matrix replaces stale skeleton palette');
assert.equal(reads,firstReads,'same pixel never re-reads geometry attributes');
assert.equal(fullUpdates,0,'no full skeleton update is needed');
flipped=true;
closeness(sampler(owner,pixel,out),new TestVector3(10.75,6.25,0),'mirrored source pixel recompiles the correct triangle');
flipped=false;
const runtime=win.ShoulderPetAttachmentRuntime.create({THREE,getOwnerMesh:()=>owner,getOwnerNeckJoint:()=>null,
  getRotationSource:()=> 'head',getInvertRotationSource:()=>false,getCancelRotationalOffset:()=>false});
const parent={scale:new TestVector3(-2,3,.5),offset:new TestVector3(3,4,5),getWorldQuaternion(){return yaw(0);},updateWorldMatrix(){},
  localToWorld(v){return v.multiply(this.scale).add(this.offset);},
  worldToLocal(v){v.sub(this.offset);return v.set(v.x/this.scale.x,v.y/this.scale.y,v.z/this.scale.z);}};
const group={isObject3D:true,visible:true,parent,position:new TestVector3(),quaternion:yaw(0),scale:new TestVector3(.5,.75,1.2),userData:{},
  updateWorldMatrix(){},updateMatrix(){},localToWorld(v){return parent.localToWorld(v.multiply(this.scale).applyQuaternion(this.quaternion).add(this.position));}};
const pet={avatarRef:{group}};
const grip={localPosition:new TestVector3(.12,-.34,.05),rotationDeg:{y:-61}};
const perch={sourcePixel:pixel,x:.3,y:.5,z:.1};
const pose=runtime.solveSurfaceTransform(perch,grip,pet);
runtime.applyFinalTransform(pet,pose);
closeness(group.localToWorld(grip.localPosition.clone()),pose.perchWorldPosition,'initial pin accounts for reflected nonuniform parent');
assert.equal(frameSamples,0,'normal gameplay samples only the center pixel');
const simPosition=group.position.clone(),simRotation=group.quaternion.clone();
// Simulate late owner neck deformation and the pet's render-only body delta.
neck.y=12;group.position.x+=.14;group.quaternion.copy(yaw(47));group.scale.y=.9;
const composedPosition=group.position.clone(),composedRotation=group.quaternion.clone(),undo=[],renderDebug={};
assert.equal(win.ShoulderPetAttachmentRuntime.repinForRender(group,undo,renderDebug),true);
closeness(group.localToWorld(grip.localPosition.clone()),new TestVector3(10.25,3.25,0),'final composed grip follows live shoulder pixel');
assert.deepEqual(group.quaternion,composedRotation,'translation correction does not change body rotation');
assert.equal(group.scale.y,.9,'translation correction preserves live breathing scale');
assert.ok(renderDebug.shoulderPerchPin.beforeError>.01);
assert.ok(renderDebug.shoulderPerchPin.afterError<1e-9);
assert.equal(undo.length,1);
undo.pop()();
closeness(group.position,composedPosition,'rollback restores the already composed transform, not the simulation root');
group.position.copy(simPosition);group.quaternion.copy(simRotation);
group.visible=false;
assert.equal(win.ShoulderPetAttachmentRuntime.repinForRender(group,undo,renderDebug),false,'hidden pet does not incur a render pin');
assert.equal(undo.length,0);
const bridge=fs.readFileSync('docs/js/player-body-attachment-bridge.js','utf8');
assert.match(bridge,/composer\.addPostHeadAimHook\?\.\(\(undo,renderDebug\)/,'late correction is attached to the existing final pose transaction');
assert.match(bridge,/for\(const root of shoulderPetsForFrame\(\)\)repin\(root,undo,renderDebug\)/,'reuses active shoulder roots instead of traversing the scene');
console.log('cached source pixel, live skinning and render-only shoulder translation passed');
