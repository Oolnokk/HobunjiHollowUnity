'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/animal-head-rig-authored.js', 'utf8');
const dabinggiOriginal = {
  enabled: true,
  coordinateSpace: 'sprite-normalized-top-left',
  pivot: { x: .123, y: .456 },
  weightMap: { sentinel: 'dabinggi-head' },
  minDeg: -30,
  maxDeg: 30,
};
const renderer = {
  ANIMAL_HEAD_RIGS: { 'dabinggi-hound': JSON.parse(JSON.stringify(dabinggiOriginal)) },
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
  window: windowStub,
  localStorage: { getItem: () => null },
  console,
  JSON,
  Object,
  String,
});
vm.runInContext(source, context, { filename: 'animal-head-rig-authored.js' });

const api = windowStub.HobunjiAuthoredAnimalHeadRigs;
assert(api, 'authored rig layer should install');
assert.equal(api.version, '2026-09-18-uploads2');

const grehlr = api.get('grehlr');
assert.deepEqual(JSON.parse(JSON.stringify(grehlr.pivot)), { x: 0.3615050095996143, y: 0.4662322932868983 });
assert.equal(grehlr.shoulderRest.frameShiftX, .54);
assert.equal(grehlr.shoulderRest.useSpline, true);

const puktuk = api.get('puktuk');
assert.deepEqual(JSON.parse(JSON.stringify(puktuk.pivot)), { x: .484375, y: .5 });
assert.equal(puktuk.shoulderRest.useSpline, false, 'uploaded Puktuk pose starts disabled; registry permission controls whether user can enable it');
assert.equal(puktuk.shoulderRest.frameShiftX, .52);

const garWolf = api.get('gar-wolf');
assert.deepEqual(JSON.parse(JSON.stringify(garWolf.pivot)), { x: .328125, y: .4375 });
assert.equal(garWolf.shoulderRest.useSpline, true);
assert.equal(garWolf.shoulderRest.separatorRotationDeg, -35);
assert.equal(garWolf.shoulderRest.beforePoints.length, 7);
assert.equal(garWolf.shoulderRest.afterPoints.length, 7);
assert(garWolf.shoulderRest.weightMap, 'Gar-wolf shoulder Influence paint is committed');

const voorg = api.get('voorg-ass');
assert.deepEqual(JSON.parse(JSON.stringify(voorg.pivot)), { x: 0.37400034701593793, y: 0.4193090578163603 });
assert.equal(voorg.shoulderRest.useSpline, true);
assert.equal(voorg.shoulderRest.frameShiftX, .48);

const dabinggi = api.get('dabinggi-hound');
assert.deepEqual(JSON.parse(JSON.stringify(dabinggi.pivot)), dabinggiOriginal.pivot, 'Dabinggi keeps its own head pivot');
assert.deepEqual(JSON.parse(JSON.stringify(dabinggi.weightMap)), dabinggiOriginal.weightMap, 'Dabinggi keeps its own head paint');
assert.deepEqual(
  JSON.parse(JSON.stringify(dabinggi.shoulderRest)),
  JSON.parse(JSON.stringify(garWolf.shoulderRest)),
  'Dabinggi shoulder separator, paints, and all vertex placements exactly mirror Gar-wolf'
);

console.log('animal-head-rig-authored: uploaded species + Dabinggi shoulder mirror passed');
