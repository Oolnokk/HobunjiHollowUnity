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
const nazgrakuOriginal = {
  enabled: true, pivot: { x: .421875, y: .42592592592592593 },
  weightMap: { sentinel: 'nazgraku-head' },
}; // The canonical Nazgraku head map must survive shoulder-only updates.
const renderer = {
  ANIMAL_HEAD_RIGS: {
    'dabinggi-hound': JSON.parse(JSON.stringify(dabinggiOriginal)),
    drenkirra: JSON.parse(JSON.stringify(drenkirraOriginal)),
    nazgraku: JSON.parse(JSON.stringify(nazgrakuOriginal)),
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
assert.equal(api.version, '2026-11-15-uploads7-moot-voorg-neck');
const plain = value => JSON.parse(JSON.stringify(value)); // Normalizes VM-realm arrays for deep equality.
const targets = ['puktuk', 'gar-wolf', 'dabinggi-hound', 'nelk', 'drenkirra', 'nazgraku']; // Six original Puktuk shoulder copies; Moot has an independently editable Voorg-Ass copy.
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
assert.deepEqual(plain(api.get('nazgraku').pivot), nazgrakuOriginal.pivot, 'Nazgraku head pivot preserved');
assert.deepEqual(plain(api.get('nazgraku').weightMap), nazgrakuOriginal.weightMap, 'Nazgraku head paint preserved');
assert.deepEqual(plain(api.get('uumkaoii').pivot), { x: .3921486852536997, y: .4735364861361454 }, 'Uumkao\'ii head pivot preserved');
assert.equal(api.get('uumkaoii').weightMap.width, 128, 'Uumkao\'ii keeps its painted head map');
assert.equal(api.get('moot').weightMap.width, 128, 'Moot receives Voorg-Ass detailed neck paint, not a body-only placeholder');
assert.equal(api.get('gar-wolf').shoulderRest.weightMap, undefined, 'new Puktuk shoulder does not inherit old Gar-wolf shoulder paint');

assert.equal(api.get('grehlr').shoulderRest.frameShiftX, .54, 'Grehlr unchanged');
const uumkaoiiShoulder = api.get('uumkaoii').shoulderRest; // Latest user-edited Uumkao'ii shoulder pose.
assert.equal(uumkaoiiShoulder.useSpline, true);
assert.equal(uumkaoiiShoulder.useRun1, false);
assert.equal(uumkaoiiShoulder.splitFrame, false);
assert.equal(uumkaoiiShoulder.splitRightUsesIdle, false);
assert.equal(uumkaoiiShoulder.frameShiftX, .51);
assert.equal(uumkaoiiShoulder.followFrameShiftX, false);
assert.equal(uumkaoiiShoulder.separatorRotationDeg, -1);
assert.equal(uumkaoiiShoulder.separatorAspect, 1.4212860310421287);
assert.equal(uumkaoiiShoulder.beforePoints.length, 7);
assert.equal(uumkaoiiShoulder.afterPoints.length, 7);
assert.deepEqual(plain(uumkaoiiShoulder.beforePoints[6]), { x: 1.0399996666666664, y: .572691993389205 });
assert.deepEqual(plain(uumkaoiiShoulder.afterPoints[6]), { x: .9672338415359367, y: .9348808700890657 });
const voorgShoulder = api.get('voorg-ass').shoulderRest; // Latest user-edited Voorg-Ass shoulder pose.
assert.equal(voorgShoulder.useSpline, true);
assert.equal(voorgShoulder.useRun1, false);
assert.equal(voorgShoulder.splitFrame, false);
assert.equal(voorgShoulder.splitRightUsesIdle, false);
assert.equal(voorgShoulder.frameShiftX, .46);
assert.equal(voorgShoulder.followFrameShiftX, true);
assert.equal(voorgShoulder.separatorRotationDeg, 0);
assert.equal(voorgShoulder.separatorAspect, 1.7);
assert.equal(voorgShoulder.beforePoints.length, 7);
assert.equal(voorgShoulder.afterPoints.length, 7);
assert.deepEqual(plain(voorgShoulder.beforePoints[6]), { x: .9599996666666666, y: .572691993389205 });
assert.deepEqual(plain(voorgShoulder.afterPoints[6]), { x: .6976709902869936, y: 1.2729887486531961 });
const mootShoulder = api.get('moot').shoulderRest; // Moot starts from the latest Voorg-Ass pose, but remains separately editable.
assert.deepEqual(plain(mootShoulder), plain(voorgShoulder), 'Moot copies every setting and spline point from Voorg-Ass');
assert.notStrictEqual(mootShoulder, voorgShoulder, 'Moot has a separate shoulder settings object');
assert.notStrictEqual(mootShoulder.beforePoints, voorgShoulder.beforePoints, 'Moot has separate BEFORE points');
assert.notStrictEqual(mootShoulder.afterPoints, voorgShoulder.afterPoints, 'Moot has separate AFTER points');
assert.notStrictEqual(mootShoulder.afterPoints[0], voorgShoulder.afterPoints[0], 'Moot has separate control point objects');
assert.notStrictEqual(api.get('moot'), api.get('voorg-ass'), 'Moot retains its own head carrier');
const mootRig = api.get('moot'); // Verify and mutate the independent Moot neck rig.
const voorgRig = api.get('voorg-ass'); // Compare to the original Voorg-Ass neck rig.
const mootNeck = plain(mootRig); // Snapshot all Moot deformation settings, excluding shoulder pose.
const voorgNeck = plain(voorgRig); // Snapshot all Voorg-Ass deformation settings, excluding shoulder pose.
delete mootNeck.shoulderRest;
delete voorgNeck.shoulderRest;
assert.deepEqual(mootNeck, voorgNeck, 'Moot copies the complete Voorg-Ass neck/head rig, including paint, pivot and deformation maps');
assert.notStrictEqual(mootRig.pivot, voorgRig.pivot, 'Moot neck pivot is independently editable');
assert.notStrictEqual(mootRig.weightMap, voorgRig.weightMap, 'Moot neck weight map is independently editable');
assert.notStrictEqual(mootRig.weightMap.data, voorgRig.weightMap.data, 'Moot neck paint bytes are independently editable');
assert.notStrictEqual(mootRig.compressibilityMap.data, voorgRig.compressibilityMap.data, 'Moot compressibility paint is independently editable');
const originalVoorgNeckValue = voorgRig.weightMap.data[0]; // Guard Voorg-Ass against Moot neck edits.
mootRig.weightMap.data[0] += 1;
assert.equal(voorgRig.weightMap.data[0], originalVoorgNeckValue, 'editing Moot neck paint does not alter Voorg-Ass');
assert.equal(api.get('voorg-ass').pivot.x, .37400034701593793, 'Voorg-Ass original head paint and pivot retained');
assert.equal(api.get('voorg-ass').weightMap.width, 128, 'Voorg-Ass original head map retained');
assert.notStrictEqual(uumkaoiiShoulder.beforePoints, voorgShoulder.beforePoints, 'uploaded species have independent point arrays');
assert.notStrictEqual(voorgShoulder.beforePoints, expectedShoulder.beforePoints, 'Voorg-Ass does not share Puktuk points');

const originalX = expectedShoulder.beforePoints[0].x;
api.get('gar-wolf').shoulderRest.beforePoints[0].x = -.5;
assert.equal(expectedShoulder.beforePoints[0].x, originalX, 'editing Gar-wolf cannot move Puktuk');
assert.notEqual(api.get('dabinggi-hound').shoulderRest.beforePoints[0].x, -.5, 'editing Gar-wolf cannot move Dabinggi');
const voorgEnd = voorgShoulder.afterPoints[6].y; // Mutations to either species' editable points must not affect the other.
mootShoulder.afterPoints[6].y += .1;
assert.equal(voorgShoulder.afterPoints[6].y, voorgEnd, 'editing Moot does not alter Voorg-Ass');
voorgShoulder.beforePoints[0].x += .1;
assert.notEqual(mootShoulder.beforePoints[0].x, voorgShoulder.beforePoints[0].x, 'editing Voorg-Ass does not alter Moot');
console.log('animal-head-rig-authored: Moot deep-copies Voorg-Ass neck and shoulder independently; other species preserve their head paint');
