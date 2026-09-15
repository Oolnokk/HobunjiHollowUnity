#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../docs/js/puktuk-den-nest-registration.js'), 'utf8');
let originalNestInitDeps = null; // Confirms the DenNestSystem wrapper delegates without changing its dependency object.
let originalWildlifeInitDeps = null; // Confirms the WildlifeSpawn wrapper delegates after registering Northern Cliffs dens.
const logs = []; // Captures the mobile-visible den diagnostics for regression coverage.
const windowStub = {
  SCRATCHBONES_CONFIG: {
    game: {
      wildlife: { denMothers: { 'gar-wolf': { creatureKey: 'gar-wolf-den-mother', nestItemKey: 'garWolfBaby' } } },
      livestock: { itemKinds: { garWolfBaby: 'gar-wolf' } },
    },
  },
  DenNestSystem: {
    init(deps) { originalNestInitDeps = deps; return 'nest-initialized'; },
  },
  __farmLog(message, channel) { logs.push({ message, channel }); },
};
vm.runInNewContext(source, { window: windowStub }, { filename: 'puktuk-den-nest-registration.js' });

assert.deepEqual(
  JSON.parse(JSON.stringify(windowStub.SCRATCHBONES_CONFIG.game.wildlife.denMothers.puktuk)),
  { creatureKey: 'puktuk', nestItemKey: 'puktukBaby' },
  'Puktuk Den-Mother registration must provide the live-birth baby item before game.js snapshots DEN_MOTHER_ITEM_KEYS',
);
assert.deepEqual(
  JSON.parse(JSON.stringify(windowStub.SCRATCHBONES_CONFIG.game.wildlife.denMothers['voorg-ass'])),
  { creatureKey: 'voorg-ass', nestItemKey: 'voorgAssBaby' },
  'Voorg-Ass must use the same pre-snapshot Den-Mother registration path as Puktuk',
);
assert.equal(windowStub.SCRATCHBONES_CONFIG.game.livestock.itemKinds.puktukBaby, 'puktuk', 'Puktuk baby must use the shared livestock item-to-species path');
assert.equal(windowStub.SCRATCHBONES_CONFIG.game.livestock.itemKinds.voorgAssBaby, 'voorg-ass', 'Voorg-Ass baby must use the shared livestock item-to-species path');
const denMotherItemKeys = Object.fromEntries(Object.values(windowStub.SCRATCHBONES_CONFIG.game.wildlife.denMothers).map(def => [def.creatureKey, def.nestItemKey]));
assert.equal(denMotherItemKeys.puktuk, 'puktukBaby', 'game.js DEN_MOTHER_ITEM_KEYS snapshot must contain the Puktuk clutch reward');
assert.equal(denMotherItemKeys['voorg-ass'], 'voorgAssBaby', 'game.js DEN_MOTHER_ITEM_KEYS snapshot must contain the Voorg-Ass clutch reward');
assert.equal(windowStub.PuktukDenNestRegistration.version, 2);
assert.equal(windowStub.PuktukDenNestRegistration.debugSnapshot().configReady, true);
assert.equal(windowStub.PuktukDenNestRegistration.debugSnapshot().livestockReady, true);
assert.equal(windowStub.PuktukDenNestRegistration.debugSnapshot().voorgConfigReady, true);
assert.equal(windowStub.PuktukDenNestRegistration.debugSnapshot().voorgLivestockReady, true);
assert.equal(windowStub.PuktukDenNestRegistration.debugSnapshot().initBridgeReady, true);
assert.equal(windowStub.PuktukDenNestRegistration.debugSnapshot().wildlifeBridgeReady, true);

const itemDefs = {};
const nestDeps = { ITEM_DEFS: itemDefs };
assert.equal(windowStub.DenNestSystem.init(nestDeps), 'nest-initialized');
assert.equal(originalNestInitDeps, nestDeps, 'DenNestSystem.init must still receive the untouched dependency object');
assert.deepEqual(
  JSON.parse(JSON.stringify(itemDefs.puktukBaby)),
  {
    icon: '🐾',
    label: 'Puktuk Baby',
    cat: 'livestock',
    sellPrice: 0,
    tags: ['Livestock', 'Baby'],
    desc: 'A Puktuk baby taken from a western-slope den. Add it to a farm or stable to raise it.',
  },
  'Puktuk baby pickup must create a normal visible livestock inventory item',
);
assert.deepEqual(
  JSON.parse(JSON.stringify(itemDefs.voorgAssBaby)),
  {
    icon: '🐾',
    label: 'Voorg-Ass Baby',
    cat: 'livestock',
    sellPrice: 0,
    tags: ['Livestock', 'Baby'],
    desc: 'A Voorg-Ass baby taken from a Northern Cliffs den. Add it to a farm or stable to raise it.',
  },
  'Voorg-Ass den babies must use the same livestock pickup path as Puktuk babies',
);

windowStub.WildlifeSpawn = {
  init(deps) { originalWildlifeInitDeps = deps; return 'wildlife-initialized'; },
};
const wildlifeDeps = {
  EXTERIOR_ZONES: {
    map_northern_cliffs: { herbivoreSpecies: ['grehlr', 'voorg-ass'] },
  },
  DEN_MOTHER_DEFS: {
    'gar-wolf': { creatureKey: 'gar-wolf-den-mother', nestItemKey: 'garWolfBaby' },
    grehlr: { creatureKey: 'grehlr-den-mother', nestItemKey: 'grehlrBaby' },
  },
};
assert.equal(windowStub.WildlifeSpawn.init(wildlifeDeps), 'wildlife-initialized');
assert.equal(originalWildlifeInitDeps, wildlifeDeps, 'WildlifeSpawn.init must still receive the untouched dependency object');
assert.deepEqual(
  JSON.parse(JSON.stringify(wildlifeDeps.EXTERIOR_ZONES.map_northern_cliffs.denSpecies)),
  ['grehlr', 'voorg-ass'],
  'Authoring explicit Northern Cliffs den species must preserve Grehlr while adding Voorg-Ass',
);
assert.deepEqual(
  JSON.parse(JSON.stringify(wildlifeDeps.DEN_MOTHER_DEFS['voorg-ass'])),
  { creatureKey: 'voorg-ass', nestItemKey: 'voorgAssBaby' },
  'Runtime den assignment must satisfy CavernGenerator Den-Mother filtering',
);
assert.deepEqual(
  JSON.parse(JSON.stringify(wildlifeDeps.DEN_MOTHER_DEFS.grehlr)),
  { creatureKey: 'grehlr-den-mother', nestItemKey: 'grehlrBaby' },
  'Existing Grehlr Den-Mother authoring must remain untouched',
);
assert(logs.some(entry => /\[voorg-ass\] den registration .*dens=\[grehlr,voorg-ass\].*grehlrPreserved=1.*reward=voorgAssBaby/.test(entry.message) && entry.channel === 'wildlife'), 'mobile-visible diagnostics must report successful mixed Grehlr + Voorg-Ass den registration');

console.log('Puktuk + Grehlr + Voorg-Ass den clutch registration regression passed.');