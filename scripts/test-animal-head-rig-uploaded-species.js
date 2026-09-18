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
assert.equal(api.version, '2026-09-17-uploads1');

const puktuk = renderer.ANIMAL_HEAD_RIGS.puktuk;
assert.equal(puktuk.pivot.x, 0.484375);
assert.equal(puktuk.pivot.y, 0.5);
assert.equal(puktuk.shoulderRest.enabled, true);
assert.equal(puktuk.shoulderRest.useSpline, false, 'Puktuk keeps the exported initial spline-off state while remaining spline-capable');
assert.equal(puktuk.shoulderRest.frameShiftX, 0.52);

const gar = renderer.ANIMAL_HEAD_RIGS['gar-wolf'];
assert.equal(gar.pivot.x, 0.328125);
assert.equal(gar.shoulderRest.useSpline, true);
assert.equal(gar.shoulderRest.frameShiftX, 0.46);
assert.equal(gar.shoulderRest.separatorRotationDeg, -35);
assert.equal(gar.shoulderRest.beforePoints.length, 7);
assert.equal(gar.shoulderRest.afterPoints.length, 7);
assert(gar.shoulderRest.weightMap, 'Gar-wolf uploaded shoulder Influence paint is retained');

const grehlr = renderer.ANIMAL_HEAD_RIGS.grehlr;
assert.equal(grehlr.pivot.x, 0.3615050095996143);
assert.equal(grehlr.pivot.y, 0.4662322932868983);
assert.equal(grehlr.shoulderRest.useSpline, true);
assert.equal(grehlr.shoulderRest.frameShiftX, 0.54);

const dabinggi = renderer.ANIMAL_HEAD_RIGS['dabinggi-hound'];
assert.equal(dabinggi.ownHeadMarker, 'dabinggi-head-stays-dabinggi', 'Dabinggi keeps its own head rig');
assert.deepEqual(JSON.parse(JSON.stringify(dabinggi.shoulderRest)), JSON.parse(JSON.stringify(gar.shoulderRest)),
  'Dabinggi receives Gar-wolf shoulder paint, separator and vertex placement exactly');
assert.notEqual(dabinggi.shoulderRest, gar.shoulderRest, 'Dabinggi shoulder data is deep-cloned, not shared by reference');

console.log('uploaded animal head rigs + Dabinggi shoulder mirror passed');
