'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const runtimeV4Path = path.join(root, 'docs/js/animal-shoulder-rest.js');
const runtimeV5Path = path.join(root, 'docs/js/animal-shoulder-rest-v5.js');
const authorPath = path.join(root, 'docs/tools/animal-head-rig/author-part6.js');
const authorRefreshPath = path.join(root, 'docs/tools/animal-head-rig/author-part7.js');
const authorEventsPath = path.join(root, 'docs/tools/animal-head-rig/author-part5.js');
const shellPath = path.join(root, 'docs/tools/animal-head-rig/index.html');
const bridgePath = path.join(root, 'docs/js/player-body-attachment-bridge.js');
const geneticsRenderPath = path.join(root, 'docs/js/creature-genetics-render.js');
const correctionPath = path.join(root, 'docs/js/grehlr-head-rig-correction.js');
const runtimeV4Source = fs.readFileSync(runtimeV4Path, 'utf8');
const runtimeV5Source = fs.readFileSync(runtimeV5Path, 'utf8');
const authorSource = fs.readFileSync(authorPath, 'utf8');
const authorRefreshSource = fs.readFileSync(authorRefreshPath, 'utf8');
const authorEventsSource = fs.readFileSync(authorEventsPath, 'utf8');
const shellSource = fs.readFileSync(shellPath, 'utf8');
const bridgeSource = fs.readFileSync(bridgePath, 'utf8');
const geneticsRenderSource = fs.readFileSync(geneticsRenderPath, 'utf8');
const correctionSource = fs.readFileSync(correctionPath, 'utf8');

global.window = global;
global.AnimalHeadRigRuntime = {
  UNSET_WEIGHT: 256,
  normalizeRig(raw) { return raw?.__normalized || null; },
};
require(runtimeV4Path);
require(runtimeV5Path);
const api = global.AnimalShoulderRest;
assert(api, 'AnimalShoulderRest should install on window/global');
assert.strictEqual(api.version, 5, 'v5 should upgrade the public shoulder-rest API');
assert(runtimeV4Source.includes('Version 4 is retained as a compatibility layer'),
  'v4 explicitly documents that v5 owns final weight/layer semantics');

const guide = { a: { x: 0.2, y: 0.5 }, b: { x: 0.8, y: 0.5 } };
const curl = { enabled: true, useSpline: true, guide, fullRotationDeg: 0, interVertexRotationDeg: 90, weightFalloff: 0 };
const midpoint = { x: 0.5, y: 0.5 };
const noFalloffCurve = api.deformNormalizedPoint(midpoint, curl);
const sameCurveWithFalloffAuthored = api.deformNormalizedPoint(midpoint, { ...curl, weightFalloff: 1 });
assert(Math.abs(noFalloffCurve.x - sameCurveWithFalloffAuthored.x) < 1e-10 && Math.abs(noFalloffCurve.y - sameCurveWithFalloffAuthored.y) < 1e-10,
  'weight falloff must not redistribute or alter the spline curve itself');

const uniformWeighted = api.deformWeightedPoint(midpoint, 0, curl);
const fallenWeighted = api.deformWeightedPoint(midpoint, 0, { ...curl, weightFalloff: 1 });
const uniformMove = Math.hypot(uniformWeighted.x - midpoint.x, uniformWeighted.y - midpoint.y);
const fallenMove = Math.hypot(fallenWeighted.x - midpoint.x, fallenWeighted.y - midpoint.y);
assert(fallenMove > 0 && fallenMove < uniformMove,
  '100% weight falloff reduces deformation in the earlier/middle body while leaving the curve unchanged');
assert.strictEqual(api.splineWeightForT(0, 1), 0, '100% falloff gives guide A zero spline weight');
assert.strictEqual(api.splineWeightForT(1, 1), 1, 'guide B always retains full spline weight');
assert.strictEqual(api.splineWeightForT(0.35, 0), 1, '0% falloff keeps uniform spline weight');

const endUniform = api.deformWeightedPoint(guide.b, 0, curl);
const endFalloff = api.deformWeightedPoint(guide.b, 0, { ...curl, weightFalloff: 1 });
assert(Math.abs(endUniform.x - endFalloff.x) < 1e-10 && Math.abs(endUniform.y - endFalloff.y) < 1e-10,
  'falloff changes weight toward A but never weakens the tail/B endpoint');

const headFight = api.deformWeightedPoint(midpoint, 0.75, { ...curl, weightFalloff: 1 });
const headFightMove = Math.hypot(headFight.x - midpoint.x, headFight.y - midpoint.y);
assert(headFightMove < fallenMove,
  'Head Influence continues to fight the shoulder spline on top of the A-to-B weight falloff');

const migrated = api.normalizeRest({ shoulderRest: {
  enabled: true, useSpline: true, useRun1: false, splitFrame: true, frameShiftX: 0.51,
  guide, fullRotationDeg: -20, interVertexRotationDeg: 55, curveFalloff: 0.62,
} });
assert.strictEqual(migrated.weightFalloff, 0.62, 'short-lived curveFalloff data migrates into the corrected weightFalloff meaning');
const authored = api.normalizeRest({ shoulderRest: {
  enabled: true, useSpline: true, guide, fullRotationDeg: 0, interVertexRotationDeg: 0,
  weightFalloff: 0.4, curveFalloff: 0.9,
} });
assert.strictEqual(authored.weightFalloff, 0.4, 'explicit weightFalloff wins over migrated curveFalloff');

assert(runtimeV5Source.includes('weightFalloff') && runtimeV5Source.includes('splineWeightForT'),
  'v5 runtime owns saved deformation-weight falloff');
assert(runtimeV5Source.includes('cloneOverlayMesh') && runtimeV5Source.includes('depthWrite = false'),
  'v5 creates an explicit foreground mesh for idle-left split pixels');
assert(runtimeV5Source.includes('hobunjiShoulderSplitOverlay'),
  'split foreground meshes are identifiable for diagnostics and mesh lookup exclusion');
assert(authorRefreshSource.includes('Spline weight falloff A→B') && authorRefreshSource.includes('rig.shoulderRest.weightFalloff=shoulderWeightFalloffValue()'),
  'rigger exposes and serializes corrected spline weight falloff');
assert(authorRefreshSource.includes('delete rig.shoulderRest.curveFalloff'),
  'new saves remove the misleading curveFalloff field after migration');
assert(authorRefreshSource.includes('drawLayer(layers.right,rightVertices)') && authorRefreshSource.includes('drawLayer(layers.left,leftVertices)'),
  'live preview draws run1-right first and idle-left second for explicit foreground layering');
assert(authorSource.includes('previewAngle is deliberately not serialized'),
  'live neck preview angle remains the one preview-only shoulder/head setting');
assert(shellSource.includes('animal-shoulder-rest-v5.js'),
  'authoring preview loads the same v5 weight-falloff math used by gameplay');
assert(shellSource.includes('height:calc(100dvh - 24px)') && shellSource.includes('.preview-settings{min-height:0;overflow:auto'),
  'right workbench remains viewport-bounded while its settings scroll');
assert(authorEventsSource.includes('Preview rig write did not round-trip from browser storage.'),
  'Save rig for game preview still verifies localStorage round-trip');
assert(geneticsRenderSource.includes('return preview[kind] || preview[baseKind] || ANIMAL_HEAD_RIGS[baseKind] || null'),
  'game avatar resolution still prefers browser-saved preview rigs');
assert(bridgeSource.includes("renderer.composeFrame(kind, 'idle'") && bridgeSource.includes("renderer.composeFrame(kind, 'run1'"),
  'runtime split layers preserve genotype-composited idle/run1 art');
assert(bridgeSource.includes('leftCanvas') && bridgeSource.includes('rightCanvas') && bridgeSource.includes('setShoulderSplitOverlayCanvas'),
  'runtime uses separate idle-left foreground and run1-right background layers');
assert(bridgeSource.includes('combinedSplitFallbackCanvas') && bridgeSource.includes('ctx.drawImage(layers.rightCanvas') && bridgeSource.includes('ctx.drawImage(layers.leftCanvas'),
  'unusual avatars without overlay support still keep both halves with left drawn over right');
assert(bridgeSource.includes('Number(window.AnimalShoulderRestV5.version) < 5') && bridgeSource.includes('animal-shoulder-rest-v5.js'),
  'game bootstrap requires the v5 shoulder decorator');
assert(bridgeSource.includes("companion.stableRole === 'shoulderPet'"),
  'shoulder presentation remains gated by the actual shoulder-pet role');
assert(correctionSource.includes('HobunjiGrehlrHeadRigCorrection'),
  'Grehlr correction remains a late debug-visible authored layer');

console.log('animal-shoulder-rest v5: all tests passed');
