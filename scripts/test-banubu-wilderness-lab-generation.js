const assert = require('assert');
const generator = require('../docs/js/wilderness-map-generator.js');
const terrainPlacement = require('../docs/js/locale-terrain-placement.js');
const locale = require('../docs/config/locales/locale_banubu_shrine.json');

terrainPlacement.install(generator);

const settings = {
  ...generator.defaultSettings(),
  preset: 'cliffs',
  stepCurve: 'northernCliffs',
  boundaryMode: 'followMapHeight',
  boundaryCliffBoost: 5,
  plateaus: 92,
  maxTier: 12,
  ramps: 18,
  locales: [locale],
}; // Mirrors the Wilderness Lab's ordinary Northern Cliffs recipe plus Banubu injection.

const workspace = generator.generateWorkspace('wild-lab-2', settings);
const diagnostic = (workspace.localeTerrainDiagnostics || []).find(item => item.localeId === locale.id);
const instance = (workspace.localeInstances || []).find(item => item.localeId === locale.id);

console.log(JSON.stringify({
  diagnostic,
  instance: instance ? {
    localeId: instance.localeId,
    x: instance.x,
    y: instance.y,
    floorTier: instance.floorTier,
    objects: instance.objects,
    npcAnchors: instance.npcAnchors,
  } : null,
}, null, 2));

assert(diagnostic, 'Banubu Cave must produce a terrain-placement diagnostic in the real Northern Cliffs generation.');
assert.strictEqual(diagnostic.status, 'placed', `Banubu Cave must place in the Wilderness Lab default Northern Cliffs seed; got ${diagnostic.reason || diagnostic.status}`);
assert(instance, 'Banubu Cave must produce a localeInstance in the real Northern Cliffs generation.');
assert((instance.objects || []).some(object => object.key === 'cave_small'), 'placed Banubu locale must carry its cave_small object into runtime data.');
assert((instance.npcAnchors || []).some(anchor => anchor.npcId === 'banubu'), 'placed Banubu locale must carry Banubu into runtime data.');

console.log('Banubu Cave real Wilderness Lab Northern Cliffs generation regression passed');
