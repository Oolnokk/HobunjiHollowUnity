'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const splinePath = path.join(root, 'docs/js/animal-shoulder-spline.js');
const profilesPath = path.join(root, 'docs/js/animal-shoulder-spline-profiles.js');
const parityPath = path.join(root, 'docs/js/animal-shoulder-spline-layering.js');
const legacyBootstrapPath = path.join(root, 'docs/js/animal-shoulder-rest.js');
const legacyV5BootstrapPath = path.join(root, 'docs/js/animal-shoulder-rest-v5.js');
const authorPath = path.join(root, 'docs/tools/animal-head-rig/author-part6.js');
const shellPath = path.join(root, 'docs/tools/animal-head-rig/index.html');
const bridgePath = path.join(root, 'docs/js/player-body-attachment-bridge.js');

const splineSource = fs.readFileSync(splinePath, 'utf8');
const profilesSource = fs.readFileSync(profilesPath, 'utf8');
const paritySource = fs.readFileSync(parityPath, 'utf8');
const legacyBootstrapSource = fs.readFileSync(legacyBootstrapPath, 'utf8');
const legacyV5BootstrapSource = fs.readFileSync(legacyV5BootstrapPath, 'utf8');
const authorSource = fs.readFileSync(authorPath, 'utf8');
const shellSource = fs.readFileSync(shellPath, 'utf8');
const bridgeSource = fs.readFileSync(bridgePath, 'utf8');

global.window = global;
delete global.AnimalShoulderSpline;
delete global.AnimalShoulderRest;
require(splinePath);
const api = global.AnimalShoulderSpline;
assert(api, 'seven-point shoulder spline runtime should install');
assert.equal(api.version, 6);
assert.equal(api.POINT_COUNT, 7);
assert.equal(global.AnimalShoulderRest, api, 'legacy diagnostic alias should point at v6 runtime');

const guide = { a: { x: 0.2, y: 0.4 }, b: { x: 0.8, y: 0.4 } };
const linear = api.linearPointsForGuide(guide);
assert.equal(linear.length, 7);
const straight = { enabled: true, useSpline: true, restGuide: guide, splinePoints: linear };
const straightPoint = { x: 0.5, y: 0.58 };
const straightResult = api.deformNormalizedPoint(straightPoint, straight);
assert(Math.abs(straightResult.x - straightPoint.x) < 1e-9, 'straight seven-point spline should preserve X');
assert(Math.abs(straightResult.y - straightPoint.y) < 1e-9, 'straight seven-point spline should be identity even off the centerline');

const curvedPoints = linear.map(point => ({ ...point }));
curvedPoints[3].y = 0.68;
const curved = { ...straight, splinePoints: curvedPoints };
const centerSource = { x: 0.5, y: 0.4 };
const centerTarget = api.deformNormalizedPoint(centerSource, curved);
assert(centerTarget.y > 0.55, 'dragging the middle control point should visibly pull the center of the strip');
const fullBody = api.deformWeightedPoint(centerSource, 0, curved);
const fullHead = api.deformWeightedPoint(centerSource, 1, curved);
const halfHead = api.deformWeightedPoint(centerSource, 0.5, curved);
assert(Math.abs(fullBody.y - centerTarget.y) < 1e-9, 'Body receives full spline deformation');
assert.deepEqual(fullHead, centerSource, '100% Head Influence completely fights shoulder spline deformation');
assert(Math.abs(halfHead.y - (centerSource.y + centerTarget.y) / 2) < 1e-9, '50% Head Influence halves spline deformation');

const legacy = {
  enabled: true,
  useSpline: true,
  splitFrame: true,
  splitRightUsesIdle: true,
  frameShiftX: 0.52,
  followFrameShiftX: true,
  guideFrameShiftX: 0.52,
  guide: { a: { x: 0.542, y: 0.57 }, b: { x: 1, y: 0.57 } },
  fullRotationDeg: 78,
  interVertexRotationDeg: 1,
  weightFalloff: 0.44,
};
const migrated = api.normalizeRest({ shoulderRest: legacy });
assert.equal(migrated.migratedFromLegacy, true);
assert.equal(migrated.splinePoints.length, 7, 'older A/B + rotation/falloff exports convert to exactly seven points');
assert.equal(migrated.splitRightUsesIdle, true);
assert.equal(migrated.frameShiftX, 0.52);
assert(!Object.hasOwn(migrated, 'fullRotationDeg'));
assert(!Object.hasOwn(migrated, 'interVertexRotationDeg'));
assert(!Object.hasOwn(migrated, 'weightFalloff'));
assert(!Object.hasOwn(migrated, 'curveFalloff'));
const bendMigrated = api.normalizeRest({ shoulderRest: { enabled: true, bend: -0.05, guide } });
assert.equal(bendMigrated.splinePoints.length, 7, 'old midpoint-bend exports also migrate');

assert.match(profilesSource, /\['grehlr', 'voorg-ass', 'uumkaoii', 'gar-wolf', 'dabinggi-hound'\]/,
  'only the approved five species receive temporary shoulder-spline support');
assert.match(profilesSource, /splitRightUsesIdle:\s*true/,
  'shared temporary shoulder profile uses idle on both sides of the seam');
assert.match(profilesSource, /bodyOnlyRig\(\)/,
  'Voorg-Ass/Uumkao’ii can carry a body spline before receiving head paint');

assert(shellSource.includes('id="shoulderRestUseSpline"'));
assert(shellSource.includes('id="shoulderSplitRightIdle"'));
assert(shellSource.includes('id="shoulderFollowFrameShiftX"'));
assert(shellSource.includes('id="resetShoulderSpline"'));
assert(!shellSource.includes('id="shoulderFullRotation"'), 'retired whole-rotation slider should be gone');
assert(!shellSource.includes('id="shoulderInterRotation"'), 'retired inter-vertex rotation slider should be gone');
assert(!shellSource.toLowerCase().includes('weight falloff'), 'retired weight-falloff UI should be gone');
assert(shellSource.includes('author-part6.js') && !shellSource.includes('author-part7.js') && !shellSource.includes('author-part8.js'),
  'shoulder authoring should be consolidated into one module');
assert(shellSource.includes('animal-shoulder-spline-layering.js'), 'rigger loads the same split-layer parity adapter as gameplay');

assert.match(authorSource, /SHOULDER_POINT_COUNT=7/);
assert.match(authorSource, /shoulderSplinePoints\[shoulderPointDrag\]=next/,
  'all seven spline handles are direct draggable authoring state');
assert.match(authorSource, /if\(shoulderPointDrag===0\)shoulderRestGuide\.a=/,
  'first spline handle owns source-guide A');
assert.match(authorSource, /shoulderPointDrag===SHOULDER_POINT_COUNT-1\)shoulderRestGuide\.b=/,
  'last spline handle owns source-guide B');
assert.match(authorSource, /for\(const p of shoulderSplinePoints\)p\.x\+=delta/,
  'frame-shift follow moves all seven points together along X');
assert.match(authorSource, /shoulderSplineApi\?\.normalizeRest/,
  'import path delegates old-export conversion to the v6 runtime');
assert.match(authorSource, /JSON\.stringify\(stored\)!==JSON\.stringify\(rig\)/,
  'Save rig for game preview retains synchronous storage round-trip verification');
assert.match(authorSource, /fitCanvasInsideHost/,
  'canvas containment remains in the consolidated module so short viewports do not crop previews');

assert.match(paritySource, /INTRA_PET_RENDER_EPSILON = 0\.01/,
  'split foreground gets only a tiny within-pet ordering offset');
assert.match(paritySource, /Object\.defineProperty\(overlay, 'renderOrder'/,
  'split foreground renderOrder is a live follower so Three.js sorting sees pet-layer parity before onBeforeRender');
assert.match(paritySource, /sourceOrder.*INTRA_PET_RENDER_EPSILON/s,
  'live renderOrder getter stays immediately above its paired half only');
assert.match(paritySource, /'depthWrite','depthTest','depthFunc','colorWrite'/,
  'split overlay copies the source half x-ray/depth material state');
assert.match(paritySource, /overlay\.layers\.mask = source\.layers\.mask/,
  'split overlay follows the same Three.js layers mask as its paired half');
assert(!paritySource.includes('renderOrder = (source.renderOrder || 0) + 20'),
  'split overlay must not escape the normal shoulder-pet render stack');

for (const bootstrapSource of [legacyBootstrapSource, legacyV5BootstrapSource]) {
  assert(bootstrapSource.includes('animal-shoulder-spline.js?v=20260917spline6'));
  assert(bootstrapSource.includes('animal-shoulder-spline-layering.js?v=20260917parity1'));
  assert(bootstrapSource.includes('AnimalShoulderRestV5 = { version: 6'));
}
assert.match(bridgeSource, /stableRole === 'shoulderPet'/, 'game shoulder role remains the activation gate');
assert.match(bridgeSource, /splitRightUsesIdle/, 'game split compositor honors idle-on-right authoring');

console.log('animal-shoulder-spline: all tests passed');
