'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const runtimePath = path.join(root, 'docs/js/animal-shoulder-rest.js');
const authorPath = path.join(root, 'docs/tools/animal-head-rig/author-part6.js');
const authorLoaderPath = path.join(root, 'docs/tools/animal-head-rig/author-part5.js');
const bridgePath = path.join(root, 'docs/js/player-body-attachment-bridge.js');
const runtimeSource = fs.readFileSync(runtimePath, 'utf8');
const authorSource = fs.readFileSync(authorPath, 'utf8');
const authorLoaderSource = fs.readFileSync(authorLoaderPath, 'utf8');
const bridgeSource = fs.readFileSync(bridgePath, 'utf8');

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
assert.strictEqual(api.version, 1);

const centerlineLeft = api.restPoint(-1, 0, 2, 1, 0.5, 0.2);
const centerlineRight = api.restPoint(1, 0, 2, 1, 0.5, 0.2);
assert(Math.abs(centerlineLeft.x + 1) < 1e-8 && Math.abs(centerlineLeft.y) < 1e-8, 'left centerline endpoint remains fixed');
assert(Math.abs(centerlineRight.x - 1) < 1e-8 && Math.abs(centerlineRight.y) < 1e-8, 'right centerline endpoint remains fixed');
const mid = api.restPoint(0, 0, 2, 1, 0.5, 0.2);
assert(Math.abs(mid.y - 0.2) < 1e-8, 'bend value is the visible midpoint displacement as a fraction of sprite height');

const normalized = {
  weightMap: { width: 2, height: 1, values: Uint16Array.from([0, 255]) },
};
assert.strictEqual(api.sampleHeadInfluence(normalized, 0, 0.5), 0, 'body end has zero Head Influence');
assert.strictEqual(api.sampleHeadInfluence(normalized, 1, 0.5), 1, 'head end has full Head Influence');
assert(Math.abs(api.sampleHeadInfluence(normalized, 0.5, 0.5) - 0.5) < 0.01, 'Head Influence interpolates smoothly through the body/rest seam');

assert(runtimeSource.includes('bodyWeights[i] = 1 - sampleHeadInfluence'), 'runtime rest weight must be exactly the complement of Head Influence');
assert(runtimeSource.includes('avatarRef.setShoulderRestEnabled'), 'runtime exposes an explicit shoulder-only activation method');
assert(authorSource.includes('id="shoulderRestEnabled"'), 'rigger creates the shoulder-rest opt-in checkbox');
assert(authorSource.includes('currentRun1PreviewPath'), 'checkbox can swap the rigger preview to run1');
assert(authorSource.includes('bodyWeight=1-clamp(headInfluence,0,1)'), 'rigger preview uses the same Head-vs-body weighting rule as runtime');
assert(authorSource.includes('Drag the diamond on the paint canvas'), 'rigger keeps shoulder-rest authoring to one visible spline handle');
assert(authorLoaderSource.includes("shoulderRestAuthorScript.src='./author-part6.js'"), 'base rigger loads the shoulder-rest author extension');
assert(bridgeSource.includes('setShoulderRestEnabled?.(isShoulderPet)'), 'game bridge enables the rest pose only for active shoulder pets');
assert(bridgeSource.includes("frameName = run1.url ? 'run1' : 'idle'"), 'authored rest pets use run1 when available and legacy pets keep idle');
assert(bridgeSource.includes('setShoulderRestEnabled?.(isShoulderPet)'), 'leaving the shoulder role disables/restores the undeformed geometry');

console.log('animal-shoulder-rest: all tests passed');
