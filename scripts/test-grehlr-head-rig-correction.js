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
assert.equal(api.version, 6);
assert.equal(context.window.CreatureGeneticsRender.ANIMAL_HEAD_RIGS.grehlr, sharedRig,
  'correction mutates the shared rig object in place');
assert.equal(sharedRig.legacy, undefined, 'obsolete shared-rig keys are cleared before applying the authored correction');
assert.equal(sharedRig.pivot.x, 0.3615050095996143);
assert.equal(sharedRig.pivot.y, 0.4662322932868983);

const rest = sharedRig.shoulderRest;
assert(rest?.enabled, 'Grehlr carries the authored shoulder presentation');
assert.equal(rest.useSpline, true, 'Grehlr uses the seven-point body spline');
assert.equal(rest.useRun1, false, 'Grehlr does not use full run1');
assert.equal(rest.splitFrame, true, 'Grehlr uses split overlap layers');
assert.equal(rest.splitRightUsesIdle, true, 'Grehlr currently uses idle art on both split halves');
assert.equal(rest.frameShiftX, 0.52, 'Grehlr seam stays at the authored 52%');
assert.equal(rest.followFrameShiftX, true, 'Grehlr spline follows seam X by default');
assert.deepEqual(JSON.parse(JSON.stringify(rest.restGuide)), {
  a: { x: 0.5423902927484727, y: 0.5694472546137244 },
  b: { x: 0.9999996666666666, y: 0.572691993389205 },
});
assert.equal(rest.splinePoints?.length, 7, 'Grehlr shoulder pose is stored as exactly seven directly editable points');
assert.deepEqual(JSON.parse(JSON.stringify(rest.splinePoints[0])), rest.restGuide.a,
  'point 1 begins at source-guide A');
assert.deepEqual(JSON.parse(JSON.stringify(rest.splinePoints[6])), {
  x: 0.6304422111109205,
  y: 1.0185111823033606,
}, 'point 7 preserves the migrated hanging-tail pose');
for (const obsolete of ['guide','bend','fullRotationDeg','interVertexRotationDeg','weightFalloff','curveFalloff','guideFrameShiftX']) {
  assert.equal(Object.prototype.hasOwnProperty.call(rest, obsolete), false,
    `new Grehlr export should not serialize retired shoulder field ${obsolete}`);
}

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

console.log('grehlr-head-rig-correction: seven-point rig integrity passed');
