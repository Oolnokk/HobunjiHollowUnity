'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const runtimePath = path.join(root, 'docs/js/animal-shoulder-rest.js');
const authorPath = path.join(root, 'docs/tools/animal-head-rig/author-part6.js');
const authorRefreshPath = path.join(root, 'docs/tools/animal-head-rig/author-part7.js');
const shellPath = path.join(root, 'docs/tools/animal-head-rig/index.html');
const bridgePath = path.join(root, 'docs/js/player-body-attachment-bridge.js');
const correctionPath = path.join(root, 'docs/js/grehlr-head-rig-correction.js');
const runtimeSource = fs.readFileSync(runtimePath, 'utf8');
const authorSource = fs.readFileSync(authorPath, 'utf8');
const authorRefreshSource = fs.readFileSync(authorRefreshPath, 'utf8');
const shellSource = fs.readFileSync(shellPath, 'utf8');
const bridgeSource = fs.readFileSync(bridgePath, 'utf8');
const correctionSource = fs.readFileSync(correctionPath, 'utf8');

// Execute only the runtime's pure public math. PNGPlaneAvatar is intentionally
// absent so install() exits before any Three.js/avatar wiring is needed.
global.window = global;
global.AnimalHeadRigRuntime = {
  UNSET_WEIGHT: 256,
  normalizeRig(raw) {
    return raw?.__normalized || null;
  },
};
require(runtimePath);
const api = global.AnimalShoulderRest;
assert(api, 'AnimalShoulderRest should install its public API');
assert.strictEqual(api.version, 2);

const angledRest = {
  enabled: true,
  useSpline: true,
  guide: { a: { x: 0.2, y: 0.25 }, b: { x: 0.8, y: 0.65 } },
  bend: 0,
};
const original = { x: 0.48, y: 0.34 };
const identity = api.deformNormalizedPoint(original, angledRest);
assert(Math.abs(identity.x - original.x) < 1e-8 && Math.abs(identity.y - original.y) < 1e-8,
  'zero bend is identity even for an independently placed/angled A-B guide');

const bentRest = { ...angledRest, bend: 0.2 };
const a = api.deformNormalizedPoint(angledRest.guide.a, bentRest);
const b = api.deformNormalizedPoint(angledRest.guide.b, bentRest);
assert(Math.abs(a.x - angledRest.guide.a.x) < 1e-8 && Math.abs(a.y - angledRest.guide.a.y) < 1e-8,
  'A centerline endpoint remains fixed');
assert(Math.abs(b.x - angledRest.guide.b.x) < 1e-8 && Math.abs(b.y - angledRest.guide.b.y) < 1e-8,
  'B centerline endpoint remains fixed');
const guideMid = { x: 0.5, y: 0.45 };
const bentMid = api.deformNormalizedPoint(guideMid, bentRest);
assert(Math.hypot(bentMid.x - guideMid.x, bentMid.y - guideMid.y) > 0.1,
  'midpoint receives the authored bend along the guide normal');
const outside = { x: 0.02, y: 0.02 };
const outsideResult = api.deformNormalizedPoint(outside, bentRest);
assert.deepStrictEqual(outsideResult, outside, 'points outside the A-B longitudinal span are not pulled into the spline');

const normalized = {
  weightMap: { width: 2, height: 1, values: Uint16Array.from([0, 255]) },
};
assert.strictEqual(api.sampleHeadInfluence(normalized, 0, 0.5), 0, 'body end has zero Head Influence');
assert.strictEqual(api.sampleHeadInfluence(normalized, 1, 0.5), 1, 'head end has full Head Influence');
assert(Math.abs(api.sampleHeadInfluence(normalized, 0.5, 0.5) - 0.5) < 0.01, 'Head Influence interpolates smoothly through the body/rest seam');

const flags = api.normalizeRest({ shoulderRest: {
  enabled: true, useSpline: false, useRun1: true, splitFrame: false, frameShiftX: 0,
  guide: { a: { x: 0.1, y: 0.2 }, b: { x: 0.9, y: 0.7 } }, bend: 0.15,
} });
assert.strictEqual(flags.useSpline, false, 'spline deformation can be disabled while frame stance stays enabled');
assert.strictEqual(flags.useRun1, true, 'run1 stance is independent from spline deformation');
assert.strictEqual(flags.frameShiftX, 0, '0% split seam is preserved as a real authored value');

assert(runtimeSource.includes('bodyWeights[i] = 1 - sampleHeadInfluence'), 'runtime rest weight must be exactly the complement of Head Influence');
assert(runtimeSource.includes('rest.guide.a') && runtimeSource.includes('rest.guide.b'), 'runtime owns a guide independent of the head pivot');
assert(runtimeSource.includes('avatarRef.setShoulderRestEnabled'), 'runtime exposes explicit shoulder-only spline activation');
assert(shellSource.includes('position:sticky') && shellSource.includes('id="previewSettings"'), 'right-side paint/preview workbench and preview controls stay together while scrolling');
assert(shellSource.includes('id="shoulderRestUseSpline"') && shellSource.includes('id="shoulderRestUseRun1"'), 'spline and run1 stance are independently controllable');
assert(shellSource.includes('id="shoulderRestSplitFrame"') && shellSource.includes('id="shoulderFrameShift"'), 'idle/run1 fusion exposes an X seam control');
assert(shellSource.includes('src="./author-part6.js"') && shellSource.includes('src="./author-part7.js"'), 'shoulder author modules load directly after the base rigger');
assert(authorSource.includes("shoulderGuide={a:{x:.14,y:.46},b:{x:.86,y:.46}}"), 'authoring starts with independent spline-rigger-style A/B endpoints');
assert(authorSource.includes("shoulderHandleDrag==='a'||shoulderHandleDrag==='b'"), 'A and B endpoints are directly draggable');
assert(authorSource.includes('bodyWeight=1-clamp(headInfluence,0,1)'), 'author preview uses the same Head-vs-body weighting rule as runtime');
assert(authorSource.includes('splitPresentationCanvas'), 'author preview can fuse idle-left and run1-right');
assert(authorRefreshSource.includes('applyRecordThenRefreshShoulderFrame'), 'record changes refresh run1 only after the new species becomes current');
assert(bridgeSource.includes("renderer.composeFrame(kind, 'idle'") && bridgeSource.includes("renderer.composeFrame(kind, 'run1'"), 'runtime split uses genotype-composited idle and run1 art when available');
assert(bridgeSource.includes('Number.isFinite(authoredSplit)'), 'runtime split cache preserves exact 0% and 100% seam positions');
assert(bridgeSource.includes('setShoulderRestEnabled?.(isShoulderPet)'), 'leaving the shoulder role restores the undeformed spline geometry');
assert(bridgeSource.includes('grehlr-head-rig-correction.js'), 'latest supplied Grehlr correction loads before companion avatar construction');
assert(correctionSource.includes('HobunjiGrehlrHeadRigCorrection'), 'Grehlr correction module exposes a debug-visible marker');

console.log('animal-shoulder-rest: all tests passed');
