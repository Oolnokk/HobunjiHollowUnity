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
assert(api, 'BEFORE/AFTER shoulder spline runtime should install');
assert.equal(api.version, 7);
assert.equal(api.POINT_COUNT, 7);
assert.equal(global.AnimalShoulderRest, api, 'legacy diagnostic alias points at v7 runtime');

const straightGuide = { a: { x: 0.2, y: 0.4 }, b: { x: 0.8, y: 0.4 } };
const straightBefore = api.linearPointsForGuide(straightGuide);
const identity = { enabled: true, useSpline: true, beforePoints: straightBefore, afterPoints: straightBefore.map(p => ({ ...p })) };
const source = { x: 0.5, y: 0.58 };
const identityResult = api.deformNormalizedPoint(source, identity);
assert(Math.abs(identityResult.x - source.x) < 1e-4, 'same BEFORE/AFTER preserves X');
assert(Math.abs(identityResult.y - source.y) < 1e-4, 'same BEFORE/AFTER preserves Y');

const curvedBefore = straightBefore.map(p => ({ ...p }));
curvedBefore[2].y = 0.46;
curvedBefore[3].y = 0.51;
curvedBefore[4].y = 0.46;
const curvedIdentity = { enabled: true, useSpline: true, beforePoints: curvedBefore, afterPoints: curvedBefore.map(p => ({ ...p })) };
const curvedSource = { x: 0.5, y: 0.60 };
const curvedIdentityResult = api.deformNormalizedPoint(curvedSource, curvedIdentity);
assert(Math.abs(curvedIdentityResult.x - curvedSource.x) < 3e-3, 'curved BEFORE mapped to itself preserves source X');
assert(Math.abs(curvedIdentityResult.y - curvedSource.y) < 3e-3, 'curved BEFORE mapped to itself preserves source Y');

const after = curvedBefore.map(p => ({ ...p }));
after[3].y += 0.20;
const posed = { enabled: true, useSpline: true, beforePoints: curvedBefore, afterPoints: after };
const posedCenter = api.deformNormalizedPoint({ x: curvedBefore[3].x, y: curvedBefore[3].y }, posed);
assert(posedCenter.y > curvedBefore[3].y + 0.15, 'moving AFTER midpoint moves the same BEFORE bind location');
const fullHead = api.deformWeightedPoint(curvedSource, 1, posed);
assert.deepEqual(fullHead, curvedSource, '100% Head Influence still completely fights shoulder deformation');

const legacyV6 = {
  enabled: true,
  useSpline: true,
  splitFrame: true,
  splitRightUsesIdle: true,
  frameShiftX: 0.52,
  followFrameShiftX: true,
  restGuide: { a: { x: 0.542, y: 0.57 }, b: { x: 1, y: 0.57 } },
  splinePoints: [
    { x: .542, y: .57 }, { x: .58, y: .62 }, { x: .61, y: .68 }, { x: .63, y: .75 },
    { x: .64, y: .83 }, { x: .64, y: .92 }, { x: .63, y: 1.02 },
  ],
};
const migratedV6 = api.normalizeRest({ shoulderRest: legacyV6 });
assert.equal(migratedV6.migratedFromLegacy, true);
assert.equal(migratedV6.beforePoints.length, 7, 'v6 straight restGuide becomes seven BEFORE points');
assert.equal(migratedV6.afterPoints.length, 7, 'v6 splinePoints become seven AFTER points');
assert.deepEqual(migratedV6.afterPoints, legacyV6.splinePoints);
assert(!Object.hasOwn(migratedV6, 'restGuide'));
assert(!Object.hasOwn(migratedV6, 'splinePoints'));

const oldCurl = api.normalizeRest({ shoulderRest: {
  enabled: true, useSpline: true, frameShiftX: .52,
  guide: straightGuide, fullRotationDeg: 40, interVertexRotationDeg: -20, weightFalloff: .4,
} });
assert.equal(oldCurl.beforePoints.length, 7, 'rotation/falloff export gets a BEFORE line');
assert.equal(oldCurl.afterPoints.length, 7, 'rotation/falloff export gets an AFTER line');
assert(!Object.hasOwn(oldCurl, 'weightFalloff'));

assert.match(profilesSource, /\['grehlr', 'voorg-ass', 'uumkaoii', 'gar-wolf', 'dabinggi-hound'\]/,
  'only the approved five species receive temporary shoulder-spline support');
assert.match(profilesSource, /beforePoints:\s*GREHLR_BEFORE/);
assert.match(profilesSource, /afterPoints:\s*GREHLR_AFTER/);
assert.match(profilesSource, /bodyOnlyRig\(\)/, 'Voorg-Ass/Uumkao’ii can carry a body spline before head paint exists');

for (const id of ['shoulderPaintSource','shoulderEditBefore','shoulderEditAfter','copyShoulderBeforeToAfter']) {
  assert(shellSource.includes(`id="${id}"`), `rigger exposes ${id}`);
}
assert(shellSource.includes('BEFORE / Bind') && shellSource.includes('AFTER / Pose'));
assert(!shellSource.includes('id="shoulderFullRotation"'));
assert(!shellSource.includes('id="shoulderInterRotation"'));
assert(!shellSource.toLowerCase().includes('weight falloff'));
assert(shellSource.includes('animal-shoulder-spline.js?v=20260917spline7'));

assert.match(authorSource, /let shoulderBeforePoints=/);
assert.match(authorSource, /let shoulderAfterPoints=/);
assert.match(authorSource, /shoulderEditMode='before'/);
assert.match(authorSource, /beforePoints:cloneShoulderPoints\(shoulderBeforePoints/);
assert.match(authorSource, /afterPoints:cloneShoulderPoints\(shoulderAfterPoints/);
assert.match(authorSource, /selectedPaintSourceImage/,
  'paint canvas can switch the art beneath the shared canonical paint maps');
assert.match(authorSource, /shoulderPaintSource\?\.value==='right'/,
  'right-half paint source explicitly loads run1 when the right side uses it');
assert.match(authorSource, /buildSourceSampler=function buildSelectedShoulderSourceSampler/,
  'bucket color sampling follows the selected paint source too');
assert.match(authorSource, /shoulderPaintSource\.value='right'/,
  'BEFORE mode switches to Right source when split mode is active');
assert.match(authorSource, /for\(const p of shoulderBeforePoints\)p\.x\+=delta;for\(const p of shoulderAfterPoints\)p\.x\+=delta/,
  'frame shift moves BEFORE and AFTER together when follow is enabled');
assert.match(authorSource, /JSON\.stringify\(stored\)!==JSON\.stringify\(rig\)/,
  'Save rig for game preview retains round-trip verification');
assert.match(authorSource, /rest\.beforePoints\.length!==7.*rest\.afterPoints\.length!==7/s,
  'Save Preview verifies both spline stages survive serialization');

assert.match(splineSource, /function bindFrameForPoint\(beforePoints, point\)/,
  'runtime measures PNG vertices against the curved BEFORE spline');
assert.match(splineSource, /splinePoint\(rest\.afterPoints, bind\.t\)/,
  'runtime reconstructs the same bind coordinate against AFTER');
assert.match(splineSource, /bodyWeight = 1 - clamp/,
  'Head Influence remains the only competing body deformation weight');

assert.match(paritySource, /INTRA_PET_RENDER_EPSILON = 0\.01/);
assert.match(paritySource, /Object\.defineProperty\(overlay, 'renderOrder'/,
  'split foreground stays a live follower of pet x-ray render order');
assert.match(paritySource, /'depthWrite','depthTest','depthFunc','colorWrite'/);
assert.match(paritySource, /overlay\.layers\.mask = source\.layers\.mask/);

for (const bootstrapSource of [legacyBootstrapSource, legacyV5BootstrapSource]) {
  assert(bootstrapSource.includes('animal-shoulder-spline.js?v=20260917spline7'));
  assert(bootstrapSource.includes('AnimalShoulderRestV5 = { version: 7'));
}
assert.match(bridgeSource, /AnimalShoulderSpline\.version\) < 7/,
  'game attachment bridge explicitly requires the v7 bind/pose runtime');
assert.match(bridgeSource, /HobunjiShoulderSplineProfiles\.version\) < 2/,
  'game attachment bridge explicitly requires v2 BEFORE/AFTER species defaults');
assert.match(bridgeSource, /stableRole === 'shoulderPet'/, 'game shoulder role remains the activation gate');
assert.match(bridgeSource, /splitRightUsesIdle/, 'game split compositor honors idle-on-right authoring');

console.log('animal-shoulder-spline v7: BEFORE/AFTER + right-paint tests passed');
