'use strict';

const assert = require('node:assert/strict'); // Regression assertions for independent shoulder presets.
const fs = require('node:fs'); // Loads the committed authored rig module.
const vm = require('node:vm'); // Runs the browser module against minimal renderer stubs.

const source = fs.readFileSync('docs/js/animal-head-rig-authored.js', 'utf8');
const dabinggiOriginal = {
  enabled: true, coordinateSpace: 'sprite-normalized-top-left',
  pivot: { x: .123, y: .456 }, weightMap: { sentinel: 'dabinggi-head' },
  minDeg: -30, maxDeg: 30,
};
const drenkirraOriginal = {
  enabled: true, pivot: { x: .4375, y: .5123456790123457 },
  weightMap: { sentinel: 'drenkirra-head' },
};
const renderer = {
  ANIMAL_HEAD_RIGS: {
    'dabinggi-hound': JSON.parse(JSON.stringify(dabinggiOriginal)),
    drenkirra: JSON.parse(JSON.stringify(drenkirraOriginal)),
  },
  HEAD_RIG_VARIANT_ALIASES: {},
};
const windowStub = {
  CreatureGeneticsRender: renderer,
  CreatureGenetics: { SPECIES_ALIAS: {} },
  HobunjiAnimalHeadRigSpecies: {
    baseSpeciesFor: kind => kind,
    resolveForOptions: () => null,
    ANIMAL_HEAD_RIGS: renderer.ANIMAL_HEAD_RIGS,
  },
  __farmLog() {},
};
const context = vm.createContext({
  window: windowStub, localStorage: { getItem: () => null },
  console, JSON, Object, String,
});
vm.runInContext(source, context, { filename: 'animal-head-rig-authored.js' });

const api = windowStub.HobunjiAuthoredAnimalHeadRigs;
assert(api, 'authored rig layer should install');
assert.equal(api.version, '2026-11-15-uploads3-independent-shoulders');
const plain = value => JSON.parse(JSON.stringify(value)); // Normalizes VM-realm arrays for deep equality.
const targets = ['puktuk', 'gar-wolf', 'dabinggi-hound', 'moot', 'nelk', 'drenkirra']; // Six independently editable shoulder registrations.
const puktuk = api.get('puktuk');
const expectedShoulder = puktuk.shoulderRest;
assert.deepEqual(plain(puktuk.pivot), { x: .484375, y: .5 }, 'uploaded shoulder must not overwrite Puktuk head paint');
assert.equal(expectedShoulder.enabled, true);
assert.equal(expectedShoulder.useSpline, true);
assert.equal(expectedShoulder.useRun1, true);
assert.equal(expectedShoulder.splitFrame, false);
assert.equal(expectedShoulder.splitRightUsesIdle, false);
assert.equal(expectedShoulder.frameShiftX, .51);
assert.equal(expectedShoulder.followFrameShiftX, false);
assert.equal(expectedShoulder.separatorRotationDeg, -13);
assert.equal(expectedShoulder.separatorAspect, 2.2916666666666665);
assert.equal(expectedShoulder.beforePoints.length, 7);
assert.equal(expectedShoulder.afterPoints.length, 7);
assert.equal(expectedShoulder.afterPoints[6].y, 1.9852540076075054);

for (const kind of targets) {
  const rig = api.get(kind);
  assert(rig, kind + ' has an authored head/shoulder carrier');
  assert.deepEqual(plain(rig.shoulderRest), plain(expectedShoulder), kind + ' exactly mirrors the source pose initially');
  if (kind !== 'puktuk') {
    assert.notStrictEqual(rig.shoulderRest, expectedShoulder, kind + ' must own its own shoulder settings object');
    assert.notStrictEqual(rig.shoulderRest.beforePoints, expectedShoulder.beforePoints, kind + ' must own separate BEFORE points');
    assert.notStrictEqual(rig.shoulderRest.afterPoints[0], expectedShoulder.afterPoints[0], kind + ' must own separate AFTER vertices');
  }
}
assert.deepEqual(plain(api.get('dabinggi-hound').pivot), dabinggiOriginal.pivot, 'Dabinggi head pivot preserved');
assert.deepEqual(plain(api.get('dabinggi-hound').weightMap), dabinggiOriginal.weightMap, 'Dabinggi head paint preserved');
assert.deepEqual(plain(api.get('drenkirra').pivot), drenkirraOriginal.pivot, 'Drenkirra head pivot preserved');
assert.deepEqual(plain(api.get('drenkirra').weightMap), drenkirraOriginal.weightMap, 'Drenkirra head paint preserved');
assert.equal(api.get('nelk').weightMap.width, 128, 'Nelk retains its detailed painted head');
assert.equal(api.get('moot').weightMap.width, 2, 'Moot gets a body-only rig until neck paint is authored');
assert.equal(api.get('gar-wolf').shoulderRest.weightMap, undefined, 'new Puktuk shoulder does not inherit old Gar-wolf shoulder paint');

assert.equal(api.get('grehlr').shoulderRest.frameShiftX, .54, 'Grehlr unchanged');
assert.equal(api.get('voorg-ass').shoulderRest.frameShiftX, .48, 'Voorg-ass unchanged');
assert.equal(api.get('uumkaoii').shoulderRest.useSpline, false, 'Uumkao\'ii unchanged');
assert.equal(api.get('uumkaoii').shoulderRest.frameShiftX, .54, 'Uumkao\'ii frame shift unchanged');

const originalX = expectedShoulder.beforePoints[0].x;
api.get('gar-wolf').shoulderRest.beforePoints[0].x = -.5;
assert.equal(expectedShoulder.beforePoints[0].x, originalX, 'editing Gar-wolf cannot move Puktuk');
assert.notEqual(api.get('dabinggi-hound').shoulderRest.beforePoints[0].x, -.5, 'editing Gar-wolf cannot move Dabinggi');
console.log('animal-head-rig-authored: six independent copies, head-paint preservation, and species exclusions passed');
