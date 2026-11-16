#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const gameSource = fs.readFileSync('docs/game.js', 'utf8');
const indexSource = fs.readFileSync('docs/index.html', 'utf8');

assert.match(gameSource, /updateShoulderPetMeshPin\(\);/, 'gameplay still re-pins shoulder pets after player/tool pose');
assert.match(gameSource, /const s_shoulderPetRotationSource = 'head';/,
  'head/neck remains the fixed authored shoulder rotation frame');
assert.doesNotMatch(indexSource, /Shoulder-Pet Rotation Source|Invert Selected Shoulder Rotation|Cancel Shoulder-Pet Rotational Offset/,
  'shoulder presentation tuning controls are no longer exposed in Settings');
assert.match(gameSource, /const SHOULDER_PET_HALF_TURN_QUATERNION = new THREE\.Quaternion\(\)\.setFromAxisAngle\(new THREE\.Vector3\(0, 1, 0\), Math\.PI\);/,
  'shoulder facing swap is authored as an exact 180-degree local-Y quaternion');
assert.match(gameSource,
  /const facingTowardPlayerCenter = pet\?\.__hobunjiShoulderFacingInward === true;[\s\S]{0,3200}const shoulderFacingTurnDeg = facingTowardPlayerCenter \? 180 : 0;/,
  'brief inward/front state selects the 180-degree local transform while outward/behind stays at zero extra turn');
assert.match(gameSource,
  /worldQuaternion\.multiply\(authoredRotationOffset\);[\s\S]{0,180}worldQuaternion\.multiply\(SHOULDER_PET_HALF_TURN_QUATERNION\)/,
  'the half-turn is applied after the authored perch/grip correction in pet-local space');
assert.doesNotMatch(gameSource, /authoredRotationOffset\.invert\(\)/,
  'opposite shoulder facing never inverts the authored quaternion');
assert.doesNotMatch(gameSource, /desiredVisualFacingSign|observationMirrored|canonicalFacingSign/,
  'shoulder facing no longer computes or requests sprite mirror parity');
assert.match(gameSource,
  /facingTowardPlayerCenter: finalTransform\.facingTowardPlayerCenter === true[\s\S]{0,180}shoulderFacingTurnDeg:[\s\S]{0,360}spriteMirrored: false/,
  'final diagnostics record 0/180 local turn and guarantee no sprite mirror');
assert.match(gameSource,
  /worldPosition: perchWorldPosition\.clone\(\)\.sub\(gripWorldOffset\)/,
  'the pet root is re-solved after rotation so shoulderGrip remains pinned to shoulderPerch');
assert.match(gameSource, /authoritativeRootTransform: true/,
  'final attachment remains authoritative');
assert.match(gameSource,
  /const shoulderLeanDeg = Number\(pet\?\.shoulderCuriosity\?\.currentLeanDeg\);[\s\S]{0,260}worldQuaternion\.multiply\(SHOULDER_PET_LEAN_QUATERNION\.setFromAxisAngle\(SHOULDER_PET_LEAN_AXIS, THREE\.MathUtils\.degToRad\(shoulderLeanDeg\)\)\)/,
  'whole-pet curiosity lean participates in the final root rotation before grip translation');
assert.match(gameSource,
  /const SHOULDER_PET_LEAN_AXIS = new THREE\.Vector3\(1, 0, 0\)/,
  'sprite-plane Z roll is represented as a pet-local X rotation without foreshortening');
const curiositySource = gameSource.slice(gameSource.indexOf('function _applyShoulderPetCuriosity'), gameSource.indexOf('function _isPlayerGenuinelyIdle'));
assert.doesNotMatch(curiositySource, /frontPlane\.rotation\.z|backPlane\.rotation\.z|baseFrontRoll|baseBackRoll/,
  'curiosity does not rotate the visible image planes about their centers');
assert.match(gameSource, /shoulderLeanDeg: Number\(finalTransform\.shoulderLeanDeg\) \|\| 0/,
  'mobile attachment debug reports the lean included in the grip pin');
console.log('shoulder pet direction-signed rotation tests passed');


// Production shoulder-surface solver regression: exercise the real function with
// a non-central grip, rather than simply checking that an algebraic formula exists.
const pivotStart = gameSource.indexOf('      const SHOULDER_PET_BODY_NECK_BLEND ='); // Start of the actual attachment solver and its rotation constants.
const pivotEnd = gameSource.indexOf('\n      // Guessed fallbacks', pivotStart); // End immediately after the production solver declaration.
assert.ok(pivotStart >= 0 && pivotEnd > pivotStart, 'production grip-pivot solver can be isolated for direct execution');
const pivotSource = gameSource.slice(pivotStart, pivotEnd); // Used by the direct test harness; not a duplicated implementation.

class TestVector3 {
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
}; // Production solver sees a rotated body, but must use the head follow frame for orientation.
const playerNeckJoint = {
  isObject3D: true,
  updateWorldMatrix() {},
  getWorldQuaternion() { return yaw(31); },
}; // Different from the body frame to catch mistaken head/body orientation coupling.
const skinnedPerchPosition = new TestVector3(5.3, 8.7, -2.6); // Actual live-animated shoulder target, deliberately not the static local-coordinate fallback.
const solverFactory = new Function('THREE', 'playerMesh', 'playerNeckJoint', 'window',
  's_shoulderPetRotationSource', 's_invertShoulderPetRotationSource',
  's_cancelShoulderPetRotationalOffset',
  pivotSource + '\nreturn _shoulderPetSurfaceTransform;'); // Uses the production source verbatim.
const closeness = (actual, expected, description) =>
  assert.ok(actual.distanceTo(expected) < 1e-9, description + ': ' + actual.distanceTo(expected)); // Grip error tolerance in world units.
const finalStart = gameSource.indexOf('      function _applyShoulderPetFinalTransform('); // Includes the production matrix and mobile diagnostic path.
const finalEnd = gameSource.indexOf('\n      function updateShoulderPetMeshPin()', finalStart); // Ends before the unrelated per-companion loop.
assert.ok(finalStart >= 0 && finalEnd > finalStart, 'production final pin can be exercised directly');
const applyFinalTransform = new Function('THREE', 'window',
  gameSource.slice(finalStart, finalEnd) + '\nreturn _applyShoulderPetFinalTransform;')(
  THREE, { ShoulderPetObservationFlip: null }); // Runs real attachment application against a minimal THREE-compatible group.
assert.match(gameSource, /gripPositionSource: finalTransform\.gripLocalPosition \? 'rendered-group-matrix'/,
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
      for (const lean of [-7, -3, 0, 3, 7]) {
        const pose = pinAt(lean);
        const localGrip = new TestVector3(rawGrip.x, rawGrip.y, rawGrip.z); // Native grip coordinates before THREE's nonuniform group scale.
        const worldGrip = localGrip.multiply(renderedScale).applyQuaternion(pose.worldQuaternion).add(pose.worldPosition);
        closeness(worldGrip, perchWorld, 'actual rendered shoulderGrip stays on shoulderPerch through breathing and lean');
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
        assert.equal(pose.shoulderFacingTurnDeg, facingInward ? 180 : 0, 'facing state remains unchanged by lean');
        assert.equal(pose.shoulderLeanDeg, lean, 'runtime exposes the exact applied lean');
        if (lean !== 0) {
          assert.ok(pose.worldPosition.distanceTo(neutral.worldPosition) > 1e-5,
            'the root translates around an off-center grip rather than pivoting about its image center');
        }
      }
      const withoutCuriosity = solve(perch, grip, {
        __hobunjiShoulderFacingInward: facingInward, avatarRef: { group: { scale: renderedScale } },
      });
      assert.equal(withoutCuriosity.shoulderLeanDeg, 0, 'missing curiosity state is neutral, not NaN');
      closeness(withoutCuriosity.worldPosition, neutral.worldPosition, 'neutral lean leaves the authored facing pose unchanged');
    }
  }
}
console.log('production shoulder grip-pivot solver numerical cases passed');
