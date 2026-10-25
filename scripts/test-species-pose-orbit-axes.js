'use strict';
// A species/gender orbit may be one number (X and Z alike, Y untouched) or { x, y, z } so each axis is authored
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
assert.deepEqual(plain(api.axesFromValue(0.5)), { x: 0.5, y: 1, z: 0.5 });
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
assert.deepEqual(plain(api.resolveAxes('tletingan', 'female', 9)), { x: 0.47, y: 1, z: 0.47 });
assert.deepEqual(plain(api.resolveAuthored('tletingan', 'male')), { x: 0.5, y: 0.8, z: 0.3 }, 'inheritance can copy the entry without flattening it');
assert.ok(api.setScale('nuhongan', 'male', api.resolveAuthored('tletingan', 'male')));
assert.deepEqual(plain(api.resolveAxes('nuhongan', 'male')), { x: 0.5, y: 0.8, z: 0.3 });

// transformPosePoint: X, Y and Z are scaled independently (no facing yaw: coordinates are already the pose frame).
const options = axes => ({ cx: 0.1, cz: -0.2, floorY: 0, baseY: 0.4, speciesId: 'mao-ao', gender: 'male', modelHeight: 0.9, rigScaleY: 1, armLength: 99, poseOrbitScale: axes });
const raw = { x: 0.6, y: 0.7, z: -0.5 };
const uniform = api.transformPosePoint({ ...raw }, options(1));
const stretched = api.transformPosePoint({ ...raw }, options({ x: 0.5, y: 0.8, z: 2 }));
near(stretched.x - 0.1, (raw.x - 0.1) * 0.5, 'X scaled by its own factor');
near(stretched.z + 0.2, (raw.z + 0.2) * 2, 'Z scaled by its own factor');
near(stretched.y - 0.4, (uniform.y - 0.4) * 0.8, 'authored Y multiplies the rigger-derived vertical mapping');

// A plain number still never touches Y, exactly as before.
const scalar = api.transformPosePoint({ ...raw }, options(0.5));
near(scalar.y, uniform.y, 'plain-number orbit leaves Y alone');
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
near(legacy.x, 0.3, 'legacy X'); near(legacy.z, -1, 'legacy Z'); near(legacy.y, 0.3 + (0.7 - 0.3) * 0.5, 'legacy Y around the centroid');

// Head-relative offsets map like hand-relative displacements (X/Z by the orbit axes, Y by body height x orbit Y),
// in the pose's own frame, and unscaleHeadOffset is the exact inverse so the editor keeps authoring baseline units.
{
  const headOpts = { speciesId: 'mao-ao', gender: 'male', modelHeight: 0.9, rigScaleY: 1, armLength: 99, poseOrbitScale: { x: 0.5, y: 0.8, z: 0.3 } };
  const authored = { x: -0.05, y: 0.1, z: 0.88 };
  const scaled = api.scaleHeadOffset({ ...authored }, headOpts);
  near(scaled.x, -0.05 * 0.5, 'head offset X follows the lateral orbit');
  near(scaled.y, 0.1 * 0.8, 'head offset Y follows the height ratio times the orbit Y');
  near(scaled.z, 0.88 * 0.3, 'head offset Z follows the forward orbit');
  const back = api.unscaleHeadOffset({ ...scaled }, headOpts);
  near(back.x, authored.x, 'inverse X'); near(back.y, authored.y, 'inverse Y'); near(back.z, authored.z, 'inverse Z');
  const identity = api.scaleHeadOffset({ ...authored }, { ...headOpts, poseOrbitScale: 1 });
  near(identity.x, authored.x, 'Mao\'ao male is the unscaled baseline'); near(identity.y, authored.y, 'baseline Y'); near(identity.z, authored.z, 'baseline Z');
}

console.log('species pose orbit axes ok');
