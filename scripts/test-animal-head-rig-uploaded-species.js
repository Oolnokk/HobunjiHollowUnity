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
assert.match(String(api.version), /uploads/, 'uploaded rig layer reports its data version');

const targets = ['puktuk', 'gar-wolf', 'dabinggi-hound', 'moot', 'nelk', 'drenkirra']; // Every intended species gets an independent shoulder rig.
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
const gar = renderer.ANIMAL_HEAD_RIGS['gar-wolf'];
assert.equal(gar.pivot.x, .328125, 'Gar-wolf keeps its original head pivot');
const dabinggi = renderer.ANIMAL_HEAD_RIGS['dabinggi-hound'];
assert.equal(dabinggi.ownHeadMarker, 'dabinggi-head-stays-dabinggi', 'Dabinggi keeps its own head rig');
const grehlr = renderer.ANIMAL_HEAD_RIGS.grehlr;
assert.equal(grehlr.pivot.x, .3615050095996143);
assert.equal(grehlr.shoulderRest.frameShiftX, .54, 'Grehlr remains unchanged');
const avatar = avatarApi.buildAnimalPlaneAvatarModel(null, 'moot_idle.png', {creatureId:'moot'});
assert(avatar.options.headRig?.shoulderRest, 'Moot avatar receives its published shoulder rig through the avatar bridge');

console.log('uploaded animal head rigs: six independent Puktuk shoulder copies passed');
