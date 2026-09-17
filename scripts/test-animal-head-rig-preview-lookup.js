'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/animal-head-rig-preview-lookup.js', 'utf8');
const committedRig = { source: 'committed' };
const previewRig = { source: 'preview', shoulderRest: { enabled: true, splitFrame: true, frameShiftX: 0.51 } };
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
assert.equal(context.window.HobunjiAnimalHeadRigPreviewLookup.resolveForKind('grehlr').shoulderRest.frameShiftX, 0.51,
  'debug-visible lookup exposes the same saved shoulder settings gameplay receives');

console.log('animal-head-rig-preview-lookup: all tests passed');
