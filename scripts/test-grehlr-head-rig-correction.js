'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const correctionSource = fs.readFileSync('docs/js/grehlr-head-rig-correction.js', 'utf8');
const splineSource = fs.readFileSync('docs/js/animal-shoulder-spline.js', 'utf8');
const sharedRig = { legacy: true };
const context = {
  window: {
    CreatureGeneticsRender: { ANIMAL_HEAD_RIGS: { grehlr: sharedRig } },
    __farmLog() {},
  },
  console,
  Math,
  JSON,
  Float32Array,
};
vm.createContext(context);
vm.runInContext(correctionSource, context, { filename: 'grehlr-head-rig-correction.js' });
vm.runInContext(splineSource, context, { filename: 'animal-shoulder-spline.js' });

const api = context.window.HobunjiGrehlrHeadRigCorrection;
assert(api, 'Grehlr correction module should expose a debug-visible API');
assert.equal(api.version, 6);
assert.equal(context.window.CreatureGeneticsRender.ANIMAL_HEAD_RIGS.grehlr, sharedRig,
  'correction mutates the shared rig object in place');
assert.equal(sharedRig.legacy, undefined, 'obsolete shared-rig keys are cleared before applying the authored correction');
assert.equal(sharedRig.pivot.x, 0.3615050095996143);
assert.equal(sharedRig.pivot.y, 0.4662322932868983);

const rest = sharedRig.shoulderRest;
assert(rest?.enabled, 'Grehlr carries the authored shoulder presentation');
assert.equal(rest.useSpline, true);
assert.equal(rest.useRun1, false);
assert.equal(rest.splitFrame, true);
assert.equal(rest.splitRightUsesIdle, true);
assert.equal(rest.frameShiftX, 0.52);
assert.equal(rest.followFrameShiftX, true);

// The committed Grehlr payload is still allowed to be v6-shaped; the new v7
// runtime must convert it losslessly into explicit BEFORE/AFTER authoring lines.
const normalizedRest = context.window.AnimalShoulderSpline.normalizeRest({ shoulderRest: rest });
assert.equal(normalizedRest.beforePoints.length, 7);
assert.equal(normalizedRest.afterPoints.length, 7);
assert.equal(normalizedRest.migratedFromLegacy, true);
assert.deepEqual(JSON.parse(JSON.stringify(normalizedRest.beforePoints[0])), {
  x: 0.5423902927484727,
  y: 0.5694472546137244,
});
assert.deepEqual(JSON.parse(JSON.stringify(normalizedRest.afterPoints[0])), {
  x: 0.5423902927484727,
  y: 0.5694472546137244,
});
assert.deepEqual(JSON.parse(JSON.stringify(normalizedRest.afterPoints[6])), {
  x: 0.6304422111109205,
  y: 1.0185111823033606,
});

function decodedCellCount(map) {
  assert.equal(map?.width, 128);
  assert.equal(map?.height, 96);
  assert.equal(map?.encoding, 'rle-u9');
  assert(Array.isArray(map?.data) && map.data.length % 2 === 0, 'RLE payload must be run/value pairs');
  let total = 0;
  for (let i = 0; i < map.data.length; i += 2) {
    const run = Number(map.data[i]);
    const value = Number(map.data[i + 1]);
    assert(Number.isInteger(run) && run > 0, `invalid RLE run at pair ${i / 2}`);
    assert(Number.isInteger(value) && value >= 0 && value <= 256, `invalid RLE value at pair ${i / 2}`);
    total += run;
  }
  return total;
}

const expectedCells = 128 * 96;
assert.equal(decodedCellCount(sharedRig.weightMap), expectedCells, 'Influence map decodes to the full authored grid');
assert.equal(decodedCellCount(sharedRig.compressibilityMap), expectedCells, 'Compressibility map decodes to the full authored grid');
assert.equal(decodedCellCount(sharedRig.stretchabilityMap), expectedCells, 'Stretchability map decodes to the full authored grid');

console.log('grehlr-head-rig-correction: v7 BEFORE/AFTER migration integrity passed');
