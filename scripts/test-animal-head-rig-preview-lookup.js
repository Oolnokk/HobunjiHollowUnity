'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/animal-head-rig-preview-lookup.js', 'utf8');
const blinkSource = fs.readFileSync('docs/js/creature-blink.js', 'utf8');
const committedRig = { source: 'committed' };
const previewRig = {
  source: 'preview',
  shoulderRest: {
    enabled: true,
    useSpline: true,
    useRun1: false,
    splitFrame: true,
    frameShiftX: 0.51,
    fullRotationDeg: -2.2906100426385296,
    interVertexRotationDeg: 4.581220085277059,
  },
};
const context = {
  window: {
    CreatureGeneticsRender: {
      headRigForKind() { return committedRig; },
    },
    HobunjiAnimalHeadRigSpecies: {
      resolveForOptions(options) {
        return options?.creatureId === 'grehlr' ? previewRig : null;
      },
    },
  },
};
vm.createContext(context);
vm.runInContext(source, context, { filename: 'animal-head-rig-preview-lookup.js' });

assert.equal(context.window.CreatureGeneticsRender.headRigForKind('grehlr'), previewRig,
  'legacy explicit headRigForKind callers must receive the browser preview rig');
assert.equal(context.window.CreatureGeneticsRender.headRigForKind('unknown'), committedRig,
  'committed lookup remains the fallback when the shared preview resolver has no match');
assert.equal(context.window.HobunjiAnimalHeadRigPreviewLookup.version, 1);
const resolvedShoulder = context.window.HobunjiAnimalHeadRigPreviewLookup.resolveForKind('grehlr').shoulderRest;
assert.equal(resolvedShoulder.useSpline, true);
assert.equal(resolvedShoulder.useRun1, false);
assert.equal(resolvedShoulder.splitFrame, true);
assert.equal(resolvedShoulder.frameShiftX, 0.51,
  'debug-visible lookup exposes the same saved hybrid seam gameplay receives');
assert.equal(resolvedShoulder.fullRotationDeg, previewRig.shoulderRest.fullRotationDeg);
assert.equal(resolvedShoulder.interVertexRotationDeg, previewRig.shoulderRest.interVertexRotationDeg,
  'saved curl controls survive explicit runtime lookup unchanged');
assert.match(blinkSource, /animal-head-rig-preview-lookup\.js/, 'preview-aware lookup is parser-loaded before gameplay creature consumers');

console.log('animal-head-rig-preview-lookup: all tests passed');
