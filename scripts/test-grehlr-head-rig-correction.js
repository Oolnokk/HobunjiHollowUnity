'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/grehlr-head-rig-correction.js', 'utf8');
const sharedRig = { legacy: true };
const context = {
  window: {
    CreatureGeneticsRender: { ANIMAL_HEAD_RIGS: { grehlr: sharedRig } },
    __farmLog() {},
  },
  console,
  Math,
  JSON,
};
vm.createContext(context);
vm.runInContext(source, context, { filename: 'grehlr-head-rig-correction.js' });

const api = context.window.HobunjiGrehlrHeadRigCorrection;
assert(api, 'Grehlr correction module should expose a debug-visible API');
assert.equal(api.version, 3);
assert.equal(context.window.CreatureGeneticsRender.ANIMAL_HEAD_RIGS.grehlr, sharedRig, 'correction mutates the shared rig object in place');
assert.equal(sharedRig.legacy, undefined, 'obsolete shared-rig keys are cleared before applying the authored correction');
assert.equal(sharedRig.pivot.x, 0.3615050095996143);
assert.equal(sharedRig.pivot.y, 0.4662322932868983);

const rest = sharedRig.shoulderRest;
assert(rest?.enabled, 'Grehlr should carry the authored shoulder presentation');
assert.equal(rest.useSpline, true, 'Grehlr uses the hanging-body spline');
assert.equal(rest.useRun1, false, 'Grehlr does not use full run1');
assert.equal(rest.splitFrame, true, 'Grehlr uses the idle/run1 hybrid');
assert.equal(rest.frameShiftX, 0.51, 'Grehlr hybrid seam stays at the authored 51%');
assert.equal(rest.guide.a.x, 0.5186980056541073);
assert.equal(rest.guide.a.y, 0.5593845204658472);
assert.equal(rest.guide.b.x, 0.9999996666666666);
assert.equal(rest.guide.b.y, 0.572691993389205);
assert(Number.isFinite(rest.fullRotationDeg) && Number.isFinite(rest.interVertexRotationDeg),
  'Grehlr shoulder spline stores the new two-angle curl controls');
assert.equal(Object.prototype.hasOwnProperty.call(rest, 'bend'), false,
  'discarded midpoint-peak bend is no longer serialized');

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
assert.equal(decodedCellCount(sharedRig.weightMap), expectedCells, 'Influence map should decode to the full authored grid');
assert.equal(decodedCellCount(sharedRig.compressibilityMap), expectedCells, 'Compressibility correction should decode to the full authored grid');
assert.equal(decodedCellCount(sharedRig.stretchabilityMap), expectedCells, 'Stretchability correction should decode to the full authored grid');

console.log('grehlr-head-rig-correction: all tests passed');
