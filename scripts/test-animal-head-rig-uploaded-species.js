'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/animal-head-rig-authored.js', 'utf8');
const localStorage = { getItem() { return null; } };
const dabinggiBase = {
  enabled: true,
  pivot: { x: 0.2578125, y: 0.4107142857142857 },
  weightMap: { width: 1, height: 1, encoding: 'rle-u9', unsetValue: 256, data: [1, 255] },
  ownHeadMarker: 'dabinggi-head-stays-dabinggi',
};
const baseMap = {
  grehlr: { legacy: true },
  puktuk: { legacy: true },
  'gar-wolf': { legacy: true },
  'dabinggi-hound': dabinggiBase,
  nazgraku: { enabled:true,pivot:{x:.421875,y:.42592592592592593},weightMap:{marker:'nazgraku-head'} }, // Original head data must be retained.
};
const renderer = {
  ANIMAL_HEAD_RIGS: baseMap,
  HEAD_RIG_VARIANT_ALIASES: {},
};
const speciesApi = {
  ANIMAL_HEAD_RIGS: baseMap,
  baseSpeciesFor(kind) { return kind; },
  resolveForOptions() { return null; },
};
const avatarApi = {
  buildAnimalPlaneAvatarModel(_THREE, _spriteUrl, options) { return { options }; },
};
const windowStub = {
  CreatureGeneticsRender: renderer,
  HobunjiAnimalHeadRigSpecies: speciesApi,
  PNGPlaneAvatar: avatarApi,
  CreatureGenetics: { SPECIES_ALIAS: {} },
  AnimalHeadRigRuntime: { STORAGE_KEY: 'hobunji_animal_head_rigs_v1' },
  __farmLog() {},
  localStorage,
};
windowStub.window = windowStub;
const context = vm.createContext({ window: windowStub, localStorage, console, JSON, Object, String, Array, Number });
vm.runInContext(source, context, { filename: 'animal-head-rig-authored.js' });

const api = windowStub.HobunjiAuthoredAnimalHeadRigs;
assert(api, 'uploaded rig layer exposes a debug-visible API');
assert.match(String(api.version), /moot-painted-baby-pets1/, 'authored rig layer reports its current Moot-paint release');

const targets = ['puktuk', 'gar-wolf', 'dabinggi-hound', 'nelk', 'drenkirra', 'nazgraku']; // Six species retain the original Puktuk shoulder pose.
const puktuk = renderer.ANIMAL_HEAD_RIGS.puktuk;
assert.equal(puktuk.pivot.x, .484375, 'Puktuk retains its original head pivot');
assert.equal(puktuk.pivot.y, .5);
assert.equal(puktuk.shoulderRest.useSpline, true);
assert.equal(puktuk.shoulderRest.useRun1, true);
assert.equal(puktuk.shoulderRest.splitFrame, false);
assert.equal(puktuk.shoulderRest.frameShiftX, .51);
assert.equal(puktuk.shoulderRest.separatorRotationDeg, -13);
assert.equal(puktuk.shoulderRest.afterPoints.length, 7);
for(const kind of targets) {
  const rig = renderer.ANIMAL_HEAD_RIGS[kind];
  assert(rig?.shoulderRest, kind + ' has an installed authored shoulder rig');
  assert.deepEqual(JSON.parse(JSON.stringify(rig.shoulderRest)), JSON.parse(JSON.stringify(puktuk.shoulderRest)), kind + ' begins with the exact Puktuk shoulder pose');
  if(kind !== 'puktuk') {
    assert.notStrictEqual(rig.shoulderRest, puktuk.shoulderRest, kind + ' shoulder settings are not linked');
    assert.notStrictEqual(rig.shoulderRest.beforePoints[0], puktuk.shoulderRest.beforePoints[0], kind + ' points are not linked');
  }
}
const uumkaoii = renderer.ANIMAL_HEAD_RIGS.uumkaoii; // Newly uploaded species-specific shoulder pose.
const voorg = renderer.ANIMAL_HEAD_RIGS['voorg-ass']; // Newly uploaded Voorg-Ass pose, different from Puktuk.
assert.equal(uumkaoii.shoulderRest.useRun1, false, 'Uumkao’ii follows the updated file, not Puktuk');
assert.equal(uumkaoii.shoulderRest.separatorRotationDeg, -1);
assert.equal(uumkaoii.shoulderRest.afterPoints[6].y, .9348808700890657);
assert.equal(voorg.shoulderRest.frameShiftX, .46);
assert.equal(voorg.shoulderRest.splitRightUsesIdle, false);
assert.equal(voorg.shoulderRest.afterPoints[6].y, 1.2729887486531961);
assert.notStrictEqual(voorg.shoulderRest, uumkaoii.shoulderRest, 'uploaded shoulder profiles remain independent');
const moot = renderer.ANIMAL_HEAD_RIGS.moot; // Independent copies of the Voorg-Ass painted neck and shoulder.
assert.notDeepEqual(JSON.parse(JSON.stringify(moot.shoulderRest)), JSON.parse(JSON.stringify(voorg.shoulderRest)), 'Moot preserves the newly uploaded independent shoulder pose');
assert.equal(moot.shoulderRest.separatorAspect, 1.617, 'Moot keeps its uploaded shoulder separator aspect');
assert.notStrictEqual(moot.shoulderRest, voorg.shoulderRest, 'Moot shoulder is an independent record');
assert.notStrictEqual(moot.shoulderRest.beforePoints, voorg.shoulderRest.beforePoints, 'Moot before points are independently editable');
assert.notStrictEqual(moot.shoulderRest.afterPoints[6], voorg.shoulderRest.afterPoints[6], 'Moot after points are independently editable');
assert.equal(moot.weightMap.width, 128, 'Moot has Voorg-Ass painted neck geometry');
assert.equal(moot.weightMap.height, 75, 'Moot has the full painted neck grid');
const mootNeck = JSON.parse(JSON.stringify(moot)); // Full head/neck settings without shoulder data.
const voorgNeck = JSON.parse(JSON.stringify(voorg)); // Source head/neck settings without shoulder data.
delete mootNeck.shoulderRest;
delete voorgNeck.shoulderRest;
assert.notDeepEqual(mootNeck, voorgNeck, 'Moot has its own independently authored head paint and pivot');
assert.equal(moot.pivot.x, .37400034701593793, 'Moot retains the uploaded head pivot');
assert.equal(moot.babyHeadScale, undefined, 'Moot inherits the universal 132% default');
assert.equal(moot.babyHeadFrame.width, .46468750000000003, 'Moot preserves its uploaded head-frame fallback');
assert.notStrictEqual(moot.weightMap.data, voorg.weightMap.data, 'Moot neck paint is independently editable');
assert.notStrictEqual(moot.compressibilityMap.data, voorg.compressibilityMap.data, 'Moot neck compression is independently editable');
assert.notStrictEqual(uumkaoii.shoulderRest, puktuk.shoulderRest, 'Uumkao’ii stays independent of Puktuk');
const gar = renderer.ANIMAL_HEAD_RIGS['gar-wolf'];
assert.equal(gar.pivot.x, .328125, 'Gar-wolf keeps its original head pivot');
const dabinggi = renderer.ANIMAL_HEAD_RIGS['dabinggi-hound'];
assert.equal(dabinggi.ownHeadMarker, 'dabinggi-head-stays-dabinggi', 'Dabinggi keeps its own head rig');
assert.equal(renderer.ANIMAL_HEAD_RIGS.nazgraku.weightMap.marker, 'nazgraku-head', 'Nazgraku keeps its own painted neck');
assert.equal(renderer.ANIMAL_HEAD_RIGS.uumkaoii.weightMap.width, 128, 'Uumkao\'ii retains its own original detailed head paint');
const grehlr = renderer.ANIMAL_HEAD_RIGS.grehlr;
assert.equal(grehlr.pivot.x, .3615050095996143);
assert.equal(grehlr.shoulderRest.frameShiftX, .54, 'Grehlr remains unchanged');
const avatar = avatarApi.buildAnimalPlaneAvatarModel(null, 'moot_idle.png', {creatureId:'moot'});
assert(avatar.options.headRig?.shoulderRest, 'Moot avatar receives its published shoulder rig through the avatar bridge');

console.log('uploaded animal head rigs: Moot retains its independently uploaded head/shoulder painting');
