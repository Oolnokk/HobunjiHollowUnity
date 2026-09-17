'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const runtimePath = path.join(root, 'docs/js/animal-shoulder-rest.js');
const authorPath = path.join(root, 'docs/tools/animal-head-rig/author-part6.js');
const authorEventsPath = path.join(root, 'docs/tools/animal-head-rig/author-part5.js');
const authorRefreshPath = path.join(root, 'docs/tools/animal-head-rig/author-part7.js');
const shellPath = path.join(root, 'docs/tools/animal-head-rig/index.html');
const bridgePath = path.join(root, 'docs/js/player-body-attachment-bridge.js');
const geneticsRenderPath = path.join(root, 'docs/js/creature-genetics-render.js');
const correctionPath = path.join(root, 'docs/js/grehlr-head-rig-correction.js');
const runtimeSource = fs.readFileSync(runtimePath, 'utf8');
const authorSource = fs.readFileSync(authorPath, 'utf8');
const authorEventsSource = fs.readFileSync(authorEventsPath, 'utf8');
const authorRefreshSource = fs.readFileSync(authorRefreshPath, 'utf8');
const shellSource = fs.readFileSync(shellPath, 'utf8');
const bridgeSource = fs.readFileSync(bridgePath, 'utf8');
const geneticsRenderSource = fs.readFileSync(geneticsRenderPath, 'utf8');
const correctionSource = fs.readFileSync(correctionPath, 'utf8');

global.window = global;
global.AnimalHeadRigRuntime = {
  UNSET_WEIGHT: 256,
  normalizeRig(raw) { return raw?.__normalized || null; },
};
require(runtimePath);
const api = global.AnimalShoulderRest;
assert(api, 'AnimalShoulderRest should install its public API');
assert.strictEqual(api.version, 3);

const angledRest = {
  enabled: true,
  useSpline: true,
  guide: { a: { x: 0.2, y: 0.25 }, b: { x: 0.8, y: 0.65 } },
  fullRotationDeg: 0,
  interVertexRotationDeg: 0,
};
const original = { x: 0.48, y: 0.34 };
const identity = api.deformNormalizedPoint(original, angledRest);
assert(Math.abs(identity.x - original.x) < 1e-8 && Math.abs(identity.y - original.y) < 1e-8,
  'zero whole/inter rotation is identity even on an independently placed angled guide');

const horizontal = {
  enabled: true, useSpline: true,
  guide: { a: { x: 0.2, y: 0.5 }, b: { x: 0.8, y: 0.5 } },
  fullRotationDeg: 90, interVertexRotationDeg: 0,
};
const rotatedA = api.deformNormalizedPoint(horizontal.guide.a, horizontal);
const rotatedB = api.deformNormalizedPoint(horizontal.guide.b, horizontal);
assert(Math.abs(rotatedA.x - 0.2) < 1e-8 && Math.abs(rotatedA.y - 0.5) < 1e-8,
  'full-strip rotation hinges at guide A');
assert(Math.abs(rotatedB.x - 0.2) < 1e-8 && Math.abs(rotatedB.y - 1.1) < 1e-8,
  '90-degree full rotation turns the complete guide around A');

const curled = {
  enabled: true, useSpline: true,
  guide: { a: { x: 0.2, y: 0.5 }, b: { x: 0.8, y: 0.5 } },
  fullRotationDeg: 0, interVertexRotationDeg: 90,
};
const curledB = api.deformNormalizedPoint(curled.guide.b, curled);
assert(Math.hypot(curledB.x - curled.guide.b.x, curledB.y - curled.guide.b.y) > 0.1,
  'inter-vertex rotation accumulates into a real curl instead of a midpoint peak');
const offAxisInside = api.deformNormalizedPoint({ x: 0.5, y: 0.1 }, curled);
assert.notDeepStrictEqual(offAxisInside, { x: 0.5, y: 0.1 },
  'full cross-sections participate even far from the guide centerline');
const outside = { x: 0.02, y: 0.02 };
assert.deepStrictEqual(api.deformNormalizedPoint(outside, curled), outside,
  'points outside the A-B longitudinal span remain untouched');

const migrated = api.legacyBendRotations(-0.01);
assert(migrated.fullRotationDeg < 0 && migrated.interVertexRotationDeg > 0,
  'legacy midpoint bend migrates to matching start/end tangent directions');

const normalized = { weightMap: { width: 2, height: 1, values: Uint16Array.from([0, 255]) } };
assert.strictEqual(api.sampleHeadInfluence(normalized, 0, 0.5), 0);
assert.strictEqual(api.sampleHeadInfluence(normalized, 1, 0.5), 1);
assert(Math.abs(api.sampleHeadInfluence(normalized, 0.5, 0.5) - 0.5) < 0.01,
  'Head Influence still competes smoothly with the shoulder strip');

const flags = api.normalizeRest({ shoulderRest: {
  enabled: true, useSpline: false, useRun1: true, splitFrame: false, frameShiftX: 0,
  guide: { a: { x: 0.1, y: 0.2 }, b: { x: 0.9, y: 0.7 } },
  fullRotationDeg: -35, interVertexRotationDeg: 62,
} });
assert.strictEqual(flags.useSpline, false);
assert.strictEqual(flags.useRun1, true);
assert.strictEqual(flags.frameShiftX, 0);
assert.strictEqual(flags.fullRotationDeg, -35);
assert.strictEqual(flags.interVertexRotationDeg, 62);

assert(runtimeSource.includes('bodyWeights[i] = 1 - sampleHeadInfluence'), 'runtime rest weight remains 1 - Head Influence');
assert(runtimeSource.includes('alpha/opacity is intentionally never consulted'), 'runtime shoulder strip is based on full plane geometry, not opacity');
assert(runtimeSource.includes('interVertexRotationDeg'), 'runtime owns progressive curl rotation');
assert(runtimeSource.includes('fullRotationDeg'), 'runtime owns whole-strip rotation');
assert(shellSource.includes('height:calc(100dvh - 24px)') && shellSource.includes('.preview-settings{min-height:0;overflow:auto'),
  'desktop right workbench is viewport-bounded and settings scroll internally so both previews remain visible');
assert(shellSource.includes('id="shoulderFullRotation"') && shellSource.includes('id="shoulderInterRotation"'),
  'right panel exposes separate whole-strip and inter-vertex rotation sliders');
assert(shellSource.includes('id="shoulderRestSplitFrame"') && shellSource.includes('id="shoulderFrameShift"'),
  'idle/run1 hybrid and seam remain per-rig controls');
assert(authorSource.includes('fullRotationDeg:shoulderFullRotationValue()') && authorSource.includes('interVertexRotationDeg:shoulderInterRotationValue()'),
  'both curl controls serialize into headRig.shoulderRest');
assert(authorSource.includes('previewAngle is deliberately not serialized'),
  'live neck preview angle is explicitly excluded from rig serialization');
assert(authorSource.includes("shoulderHandleDrag==='a'||shoulderHandleDrag==='b'"),
  'A and B remain directly draggable');
assert(authorSource.includes('bodyWeight=1-clamp(headInfluence,0,1)'),
  'author preview retains the same Head-vs-body competition');
assert(authorRefreshSource.includes('fitCanvasInsideHost') && authorRefreshSource.includes('canvas.style.width') && authorRefreshSource.includes('canvas.style.height'),
  'both right-panel canvases are contained at the loaded sprite aspect instead of being stretched/cropped by shallow grid rows');
assert(authorEventsSource.includes('Preview rig write did not round-trip from browser storage.'),
  'Save rig for game preview verifies its localStorage write before reporting success');
assert(authorEventsSource.includes('const stored=readPreviewRigs()?.[record.id]'),
  'preview save reads the exact species rig back after writing it');
assert(geneticsRenderSource.includes('return preview[kind] || preview[baseKind] || ANIMAL_HEAD_RIGS[baseKind] || null'),
  'game avatar resolution prefers browser-saved painter rigs over committed species rigs');
assert(bridgeSource.includes("companion.stableRole === 'shoulderPet'"),
  'shoulder presentation is gated by the actual shoulder-pet stable role');
assert(bridgeSource.includes('setShoulderRestEnabled?.(isShoulderPet)'), 'spline geometry remains shoulder-role-only');
assert(bridgeSource.includes("renderer.composeFrame(kind, 'idle'") && bridgeSource.includes("renderer.composeFrame(kind, 'run1'"),
  'runtime frame hybrid keeps genotype-composited idle/run1 sources');
assert(bridgeSource.includes('Number.isFinite(authoredSplit)'), '0% and 100% seam positions remain valid');
assert(correctionSource.includes('HobunjiGrehlrHeadRigCorrection'), 'Grehlr correction remains a late debug-visible layer');

console.log('animal-shoulder-rest: all tests passed');
