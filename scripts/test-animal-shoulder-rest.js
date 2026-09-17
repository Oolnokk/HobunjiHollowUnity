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
assert.equal(api.version, 8);
assert.equal(api.POINT_COUNT, 7);
assert.equal(global.AnimalShoulderRest, api, 'legacy diagnostic alias points at v8 runtime');

const straightGuide = { a: { x: 0.2, y: 0.4 }, b: { x: 0.8, y: 0.4 } };
const straightBefore = api.linearPointsForGuide(straightGuide);
const identity = { enabled: true, useSpline: true, frameShiftX: .2, beforePoints: straightBefore, afterPoints: straightBefore.map(p => ({ ...p })) };
const source = { x: 0.5, y: 0.58 };
const identityResult = api.deformNormalizedPoint(source, identity);
assert(Math.abs(identityResult.x - source.x) < 1e-4, 'same BEFORE/AFTER preserves X');
assert(Math.abs(identityResult.y - source.y) < 1e-4, 'same BEFORE/AFTER preserves Y');
assert.equal(api.sampleShoulderInfluence(null, .19, .5, .2), 0, 'default shoulder Influence is zero left of seam');
assert.equal(api.sampleShoulderInfluence(null, .21, .5, .2), 1, 'default shoulder Influence is full right of seam');

const curvedBefore = straightBefore.map(p => ({ ...p }));
curvedBefore[2].y = 0.46;
curvedBefore[3].y = 0.51;
curvedBefore[4].y = 0.46;
const curvedIdentity = { enabled: true, useSpline: true, frameShiftX: .2, beforePoints: curvedBefore, afterPoints: curvedBefore.map(p => ({ ...p })) };
const curvedSource = { x: 0.5, y: 0.60 };
const curvedIdentityResult = api.deformNormalizedPoint(curvedSource, curvedIdentity);
assert(Math.abs(curvedIdentityResult.x - curvedSource.x) < 3e-3, 'curved BEFORE mapped to itself preserves source X');
assert(Math.abs(curvedIdentityResult.y - curvedSource.y) < 3e-3, 'curved BEFORE mapped to itself preserves source Y');

const after = curvedBefore.map(p => ({ ...p }));
after[3].y += 0.20;
const posed = { enabled: true, useSpline: true, frameShiftX: .2, beforePoints: curvedBefore, afterPoints: after };
const posedCenter = api.deformNormalizedPoint({ x: curvedBefore[3].x, y: curvedBefore[3].y }, posed);
assert(posedCenter.y > curvedBefore[3].y + 0.15, 'moving AFTER midpoint moves the same BEFORE bind location');
const fullHead = api.deformWeightedPoint(curvedSource, 1, posed);
assert.deepEqual(fullHead, curvedSource, '100% Head Influence still completely fights shoulder deformation');

const zeroMap = { width: 2, height: 2, encoding: 'rle-u9', unsetValue: 256, data: [4, 0] };
const fullMap = { width: 2, height: 2, encoding: 'rle-u9', unsetValue: 256, data: [4, 255] };
const stretchAfter = api.linearPointsForGuide({ a: { x: .2, y: .4 }, b: { x: 1.0, y: .4 } });
const stretchRest = { enabled: true, useSpline: true, frameShiftX: .2, beforePoints: straightBefore, afterPoints: stretchAfter };
const stretchPoint = { x: .5, y: .4 };
const stretchFree = api.deformWeightedPoint(stretchPoint, 0, stretchRest);
assert(stretchFree.x > stretchPoint.x + .05, 'default right-side shoulder Influence follows a stretching pose');
const stretchLocked = api.deformWeightedPoint(stretchPoint, 0, { ...stretchRest, stretchabilityMap: zeroMap });
assert(Math.abs(stretchLocked.x - stretchPoint.x) < 1e-5, 'zero shoulder Stretchability blocks local spline stretch');
const compressUnaffected = api.deformWeightedPoint(stretchPoint, 0, { ...stretchRest, compressibilityMap: zeroMap });
assert(compressUnaffected.x > stretchPoint.x + .05, 'Compressibility does not block a locally stretching section');
const influenceLocked = api.deformWeightedPoint(stretchPoint, 0, { ...stretchRest, weightMap: zeroMap, stretchabilityMap: fullMap });
assert(Math.abs(influenceLocked.x - stretchPoint.x) < 1e-5, 'zero shoulder Influence blocks the shoulder deformation regardless of material allowance');

const compressAfter = api.linearPointsForGuide({ a: { x: .2, y: .4 }, b: { x: .6, y: .4 } });
const compressRest = { enabled: true, useSpline: true, frameShiftX: .2, beforePoints: straightBefore, afterPoints: compressAfter };
const compressFree = api.deformWeightedPoint(stretchPoint, 0, compressRest);
assert(compressFree.x < stretchPoint.x - .02, 'default right-side shoulder Influence follows a compressing pose');
const compressLocked = api.deformWeightedPoint(stretchPoint, 0, { ...compressRest, compressibilityMap: zeroMap });
assert(Math.abs(compressLocked.x - stretchPoint.x) < 1e-5, 'zero shoulder Compressibility blocks local spline compression');

const legacyV6 = {
  enabled: true, useSpline: true, splitFrame: true, splitRightUsesIdle: true,
  frameShiftX: 0.52, followFrameShiftX: true,
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
assert(shellSource.includes('animal-shoulder-spline.js?v=20260917spline8'));
assert(!shellSource.includes('id="shoulderFullRotation"'));
assert(!shellSource.includes('id="shoulderInterRotation"'));
assert(!shellSource.toLowerCase().includes('weight falloff'));

assert.match(authorSource, /let shoulderInfluenceMap=null/);
assert.match(authorSource, /let shoulderCompressibilityMap=null/);
assert.match(authorSource, /let shoulderStretchabilityMap=null/);
assert.match(authorSource, /shoulderDefaultByteAt/,
  'right-side shoulder Influence has a seam-relative implicit default');
assert.match(authorSource, /shoulderCellOnRight/,
  'shoulder paint is restricted to the frame-shift right side');
assert(authorSource.includes('> Spline<'), 'right paint source relabels Influence target as Spline rather than Head');
assert(authorSource.includes('Rigid'), 'right paint source exposes reducing shoulder Influence toward rigid');
assert.match(authorSource, /weightMap=exportShoulderMap\(shoulderInfluenceMap\)/,
  'shoulder Influence serializes inside shoulderRest separately from head Influence');
assert.match(authorSource, /compressibilityMap=exportShoulderMap\(shoulderCompressibilityMap\)/);
assert.match(authorSource, /stretchabilityMap=exportShoulderMap\(shoulderStretchabilityMap\)/);
assert.match(authorSource, /selectedPaintSourceImage/,
  'paint canvas can switch the art beneath the canonical coordinate grid');
assert.match(authorSource, /shoulderPaintSource\.value='right'/,
  'BEFORE mode switches to Right source when split mode is active');
assert.match(authorSource, /JSON\.stringify\(stored\)!==JSON\.stringify\(rig\)/,
  'Save rig for game preview retains round-trip verification');

assert.match(splineSource, /function bindFrameForPoint\(beforePoints, point\)/,
  'runtime measures PNG vertices against the curved BEFORE spline');
assert.match(splineSource, /function shoulderResponseKind\(rest, bind\)/,
  'runtime classifies local curved-strip strain as compression or stretch');
assert.match(splineSource, /sampleShoulderMaterial\(maps\.stretchability/,
  'runtime samples shoulder Stretchability independently of head material paint');
assert.match(splineSource, /sampleShoulderMaterial\(maps\.compressibility/,
  'runtime samples shoulder Compressibility independently of head material paint');
assert.match(splineSource, /shoulderInfluence.*\* \(1 - clamp/s,
  'shoulder Influence is applied before Head Influence fights the final body deformation');

assert.match(paritySource, /INTRA_PET_RENDER_EPSILON = 0\.01/);
assert.match(paritySource, /Object\.defineProperty\(overlay, 'renderOrder'/,
  'split foreground stays a live follower of pet x-ray render order');
assert.match(paritySource, /overlay\.layers\.mask = source\.layers\.mask/);

for (const bootstrapSource of [legacyBootstrapSource, legacyV5BootstrapSource]) {
  assert(bootstrapSource.includes('animal-shoulder-spline.js?v=20260917spline8'));
  assert(bootstrapSource.includes('AnimalShoulderRestV5 = { version: 8'));
}
assert.match(bridgeSource, /AnimalShoulderSpline\.version\) < 8/,
  'game attachment bridge explicitly requires the v8 shoulder-material runtime');
assert.match(bridgeSource, /stableRole === 'shoulderPet'/, 'game shoulder role remains the activation gate');
assert.match(bridgeSource, /splitRightUsesIdle/, 'game split compositor honors idle-on-right authoring');

console.log('animal-shoulder-spline v8: bind/pose + shoulder material paint tests passed');
