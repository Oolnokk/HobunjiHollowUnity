'use strict';
// A species/gender orbit may be one number (spherical scaling on X/Y/Z) or { x, y, z } so each axis is authored
// independently. X/Z are the pose's own lateral/forward axes (they turn with the character's facing), and Y is an
// extra multiplier on top of the rigger-derived height mapping.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const sandbox = { window: {}, console, document: undefined };
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('docs/js/species-pose-scaling.js', 'utf8'), sandbox);
const api = sandbox.window.HobunjiSpeciesPoseScale;
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);
const plain = value => JSON.parse(JSON.stringify(value));

// Parsing: a number is the original contract; an object fills missing axes with 1; junk is rejected.
assert.deepEqual(plain(api.axesFromValue(0.5)), { x: 0.5, y: 0.5, z: 0.5 });
assert.deepEqual(plain(api.axesFromValue({ x: 0.5, y: 0.9, z: 0.7 })), { x: 0.5, y: 0.9, z: 0.7 });
assert.deepEqual(plain(api.axesFromValue({ z: 0.7 })), { x: 1, y: 1, z: 0.7 });
assert.equal(api.axesFromValue({ x: -1, y: 'a' }), null);
assert.equal(api.axesFromValue(null), null);
assert.equal(api.axesFromValue(0), null);

// Config: object entries survive normalization/export, plain numbers stay numbers, resolveScale keeps meaning X.
api.replaceConfig({ species: { tletingan: { male: { x: 0.5, y: 0.8, z: 0.3 }, female: 0.47 }, junk: { male: { x: 'no' } } } });
const exported = api.getConfig().species;
assert.deepEqual(plain(exported.tletingan.male), { x: 0.5, y: 0.8, z: 0.3 });
assert.equal(exported.tletingan.female, 0.47, 'plain numbers stay numbers');
assert.equal(exported.junk?.male, undefined, 'unusable entries are not stored');
assert.equal(api.resolveScale('tletingan', 'male', 9), 0.5, 'single-number view of an object entry is its X orbit');
assert.deepEqual(plain(api.resolveAxes('tletingan', 'male', 9)), { x: 0.5, y: 0.8, z: 0.3 });
assert.deepEqual(plain(api.resolveAxes('tletingan', 'female', 9)), { x: 0.47, y: 0.47, z: 0.47 });
assert.deepEqual(plain(api.resolveAuthored('tletingan', 'male')), { x: 0.5, y: 0.8, z: 0.3 }, 'inheritance can copy the entry without flattening it');
assert.ok(api.setScale('nuhongan', 'male', api.resolveAuthored('tletingan', 'male')));
assert.deepEqual(plain(api.resolveAxes('nuhongan', 'male')), { x: 0.5, y: 0.8, z: 0.3 });

// transformPosePoint: X, Y and Z are scaled independently (no facing yaw: coordinates are already the pose frame).
const options = axes => ({ cx: 0.1, cy: 0.5, cz: -0.2, floorY: 0, baseY: 0.4, speciesId: 'mao-ao', gender: 'male', modelHeight: 0.9, rigScaleY: 1, armLength: 99, poseOrbitScale: axes });
const raw = { x: 0.6, y: 0.7, z: -0.5 };
const uniform = api.transformPosePoint({ ...raw }, options(1));
const stretched = api.transformPosePoint({ ...raw }, options({ x: 0.5, y: 0.8, z: 2 }));
near(stretched.x - 0.1, (raw.x - 0.1) * 0.5, 'X scaled by its own factor');
near(stretched.z + 0.2, (raw.z + 0.2) * 2, 'Z scaled by its own factor');
near(stretched.y - 0.5, (uniform.y - 0.5) * 0.8, 'authored Y scales around the body centroid');

// A scalar must preserve the 3D orbit radius, not just its horizontal projection.
const scalar = api.transformPosePoint({ ...raw }, options(0.5));
near(scalar.y - 0.5, (uniform.y - 0.5) * 0.5, 'numeric orbit scales Y about the body centroid');
near(Math.hypot(scalar.x - 0.1, scalar.y - 0.5, scalar.z + 0.2),
  Math.hypot(uniform.x - 0.1, uniform.y - 0.5, uniform.z + 0.2) * 0.5, 'spherical radius invariant');
near(scalar.x - 0.1, (raw.x - 0.1) * 0.5, 'plain-number orbit scales X');
near(scalar.z + 0.2, (raw.z + 0.2) * 0.5, 'plain-number orbit scales Z');

// Facing: in world space, X/Z are the pose's lateral/forward axes. Facing +X (yaw 90deg): forward = world +X,
// right = world -Z. Doubling lateral and keeping forward must double the -Z offset and leave the +X offset alone.
const yaw = Math.PI / 2;
const world = api.transformPosePoint({ x: 1, y: 0.4, z: -1 }, { ...options({ x: 2, y: 1, z: 1 }), cx: 0, cz: 0, yawRad: yaw });
near(world.x, 1, 'forward component unchanged'); near(world.z, -2, 'lateral component doubled');
// Equal X/Z are rotation-invariant, so the facing never changes them.
const a = api.transformPosePoint({ ...raw }, { ...options(0.5), yawRad: 0.7 });
const b = api.transformPosePoint({ ...raw }, options(0.5));
for (const axis of ['x', 'y', 'z']) near(a[axis], b[axis], `isotropic ${axis} ignores facing`);

// Inverse round-trips for any axes and facing, including the authored Y multiplier.
for (const axes of [{ x: 0.5, y: 0.8, z: 2 }, { x: 1.3, y: 1, z: 0.4 }, 0.65]) {
  for (const yawRad of [0, 0.9, -2.2]) {
    const forward = api.transformPosePoint({ ...raw }, { ...options(axes), yawRad });
    const back = api.untransformPosePoint({ ...forward }, { ...options(axes), yawRad });
    for (const axis of ['x', 'y', 'z']) near(back[axis], raw[axis], `round trip ${axis} axes=${JSON.stringify(axes)} yaw=${yawRad}`);
  }
}

// The legacy centroid helper honours the same axes.
const legacy = api.scalePointAroundCentroid({ ...raw }, 0, 0.3, 0, 9, { x: 0.5, y: 0.5, z: 2 });
const scalarLegacy = api.scalePointAroundCentroid({ ...raw }, 0, 0.3, 0, 9, 0.5);
near(scalarLegacy.y, 0.3 + (raw.y - 0.3) * 0.5, 'legacy scalar orbit scales Y');
near(legacy.x, 0.3, 'legacy X'); near(legacy.z, -1, 'legacy Z'); near(legacy.y, 0.3 + (0.7 - 0.3) * 0.5, 'legacy Y around the centroid');

// With the actual attachment shoulder pair available, the orbit's centre and
// diameter come from rendered anatomy, not the old per-species scalar table.
const anchors = (left, right) => ({
  anchors: { leftHandShoulder: { position: left }, rightHandShoulder: { position: right } },
  anatomy: { portraitScale: 1, portraitVerticalPlacementRatio: 0.5 },
});
const mao = anchors({ x: -0.3, y: 0.65, z: 0 }, { x: 0.3, y: 0.65, z: 0 });
const eng = anchors({ x: -0.2, y: 0.7, z: -0.15 }, { x: 0.4, y: 0.9, z: 0.25 });
sandbox.window.HOBUNJI_ATTACHMENT_RIG_PROFILES = {
  characters: { 'mao-ao::male': mao, 'engh-sho::male': eng },
};
sandbox.window.HOBUNJI_ATTACHMENT_RIG_MATH = { characterArmLength: () => 0.5 };
sandbox.window.HobunjiCharacterRigScale = {
  scaleFor: (species) => species === 'engh-sho' ? { x: 1.5, y: 1.2 } : { x: 1, y: 1 },
};
const shoulderOpts = {
  cx: 2, cy: 99, cz: -3, floorY: 0.3, baseY: 0.4, speciesId: 'engh-sho',
  gender: 'male', modelHeight: 1.1, armLength: 0.45, poseOrbitScale: 0.01,
};
const geometry = api.shoulderOrbitGeometry(shoulderOpts);
assert.ok(geometry, 'the shoulder pair enables geometry-led orbit mapping');
const expectedGap = Math.hypot((eng.anchors.leftHandShoulder.position.x - eng.anchors.rightHandShoulder.position.x) * 1.5,
  (eng.anchors.leftHandShoulder.position.y - eng.anchors.rightHandShoulder.position.y) * 1.2,
  (eng.anchors.leftHandShoulder.position.z - eng.anchors.rightHandShoulder.position.z) * 1.5);
near(geometry.shoulderGap, expectedGap, '3D shoulder distance in final rig space');
near(geometry.finalArmLength, 0.45 * 1.2, 'final arm length includes the render rig scale');
near(geometry.diameter, 2 * 0.45 * 1.2 + expectedGap, 'diameter is twice arm reach plus shoulder separation');
near(geometry.center.x, 2 + 0.1 * 1.5, 'sphere X is midway between rendered shoulders');
near(geometry.center.y, 0.3 + 0.8 * 1.2, 'sphere Y is midway between rendered shoulders');
near(geometry.center.z, -3 + 0.05 * 1.5, 'sphere Z is midway between rendered shoulders');
near(geometry.referenceRadius, 0.5 + 0.6 / 2, 'Mao-ao male shoulder envelope defines original authored radius');
for (const axis of ['x', 'y', 'z']) {
  const authored = { ...geometry.rawCenter, [axis]: geometry.rawCenter[axis] + geometry.referenceRadius };
  const finished = api.transformPosePoint({ ...authored }, shoulderOpts);
  for (const other of ['x', 'y', 'z']) {
    near(finished[other], geometry.center[other] + (other === axis ? geometry.radius : 0),
      `spherical ${axis} orbit has computed final radius on ${other}`);
  }
  const oldAxesIgnored = api.transformPosePoint({ ...authored }, { ...shoulderOpts, poseOrbitScale: { x: 3, y: 0.1, z: 2 } });
  for (const other of ['x', 'y', 'z']) near(oldAxesIgnored[other], finished[other], 'automatic shoulder orbit overrides old authored axes');
  const undone = api.untransformPosePoint({ ...finished }, shoulderOpts);
  for (const other of ['x', 'y', 'z']) near(undone[other], authored[other], 'geometry-led inverse round-trip');
}
for (const yawRad of [0, Math.PI / 2, -2.3]) {
  const opts = { ...shoulderOpts, yawRad, orbitOffset: { x: 0.17, y: -0.08, z: 0.13 } };
  const sphere = api.shoulderOrbitGeometry(opts);
  const rawPoint = { x: sphere.rawCenter.x + 0.25, y: sphere.rawCenter.y - 0.14, z: sphere.rawCenter.z + 0.31 };
  const transformed = api.transformPosePoint({ ...rawPoint }, opts);
  const roundTrip = api.untransformPosePoint({ ...transformed }, opts);
  for (const axis of ['x', 'y', 'z']) near(roundTrip[axis], rawPoint[axis], `turned spine pose round-trip ${axis}`);
}
// Shoulder edits affect the very next sample, without reloading a cached orbit
// scalar; missing shoulder geometry retains the documented compatibility path.
eng.anchors.leftHandShoulder.position.x -= 0.1;
assert.notEqual(api.shoulderOrbitGeometry(shoulderOpts).diameter, geometry.diameter, 'live shoulder spacing changes the orbit immediately');
assert.equal(api.shoulderOrbitGeometry({ ...shoulderOpts, speciesId: 'no-such-species' }), null, 'unknown rig uses the legacy fallback');
const oldFallback = api.transformPosePoint({ x: 1, y: 0.4, z: 0 }, { ...shoulderOpts, speciesId: 'no-such-species', cx: 0, cz: 0, poseOrbitScale: 0.5 });
near(oldFallback.x, 0.5, 'a missing shoulder pair still respects the old config multiplier');

// Depth-offset shoulder anchors are a diagonal arm: nonuniform X/Y rig
// scaling must project Y and Z separately before sizing the final sphere.
const depthRig = anchors({ x: -0.2, y: 0.7, z: 0.3 }, { x: 0.3, y: 0.7, z: -0.3 });
depthRig.anatomy.armLengthHeightPercentOffset = 0;
sandbox.window.HOBUNJI_ATTACHMENT_RIG_PROFILES.characters['depth-wing::male'] = depthRig;
const previousScaleFor = sandbox.window.HobunjiCharacterRigScale.scaleFor;
sandbox.window.HobunjiCharacterRigScale.scaleFor = species =>
  species === 'depth-wing' ? { x: 2, y: 1 } : previousScaleFor(species);
sandbox.window.HOBUNJI_ATTACHMENT_RIG_MATH.characterPosteriorY = () => 0.25;
const diagonalReach = Math.hypot(0.45, 0.3);
const depthOptions = {
  ...shoulderOpts, speciesId: 'depth-wing', modelHeight: 1, armLength: diagonalReach,
  rigScaleY: 1, baseY: 0.4,
};
const depthSphere = api.shoulderOrbitGeometry(depthOptions);
near(depthSphere.finalArmLength, Math.hypot(0.45, 0.6), 'rendered arm reach must use Y for height and X for depth');
near(depthSphere.shoulderGap, Math.hypot(0.5 * 2, 0.6 * 2), '3D shoulder gap follows nonuniform rig scale');
near(depthSphere.diameter, 2 * Math.hypot(0.45, 0.6) + Math.hypot(1, 1.2),
  'sphere diameter uses final rendered 3D arm length, not raw arm length times Y');
const depthTestPoint = { x: depthSphere.rawCenter.x + 0.13, y: depthSphere.rawCenter.y + 0.26, z: depthSphere.rawCenter.z - 0.41 };
const depthInverse = api.untransformPosePoint(api.transformPosePoint({ ...depthTestPoint }, depthOptions), depthOptions);
for (const axis of ['x', 'y', 'z']) near(depthInverse[axis], depthTestPoint[axis], `nonuniform arm rig inverse on ${axis}`);

console.log('species pose orbit axes ok');
