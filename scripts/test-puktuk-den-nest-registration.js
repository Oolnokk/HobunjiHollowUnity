#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../docs/js/puktuk-den-nest-registration.js'), 'utf8');
let originalNestInitDeps = null; // Confirms the DenNestSystem wrapper delegates without changing its dependency object.
let originalWildlifeInitDeps = null; // Confirms the WildlifeSpawn wrapper delegates after registering Northern Cliffs dens.
let originalCookingInitDeps = null; // Confirms the CookingSystem wrapper delegates after registering Heavy/Light Wool inventory items.
const logs = []; // Captures the mobile-visible den diagnostics for regression coverage.
const windowStub = {
  SCRATCHBONES_CONFIG: {
    game: {
      wildlife: { denMothers: { 'gar-wolf': { creatureKey: 'gar-wolf-den-mother', nestItemKey: 'garWolfBaby' } } },
      livestock: { itemKinds: { garWolfBaby: 'gar-wolf' } },
    },
  },
  HobunjiCookingData: {
    items: {
      puktukWool: { id: 'puktukWool', name: 'Heavy Wool', categories: ['wool', 'material'], tags: ['Puktuk', 'Heavy'] },
      lightWool: { id: 'lightWool', name: 'Light Wool', categories: ['wool', 'material'], tags: ['Voorg-Ass', 'Light'] },
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
assert.equal(windowStub.PuktukDenNestRegistration.version, 3);
assert.equal(windowStub.PuktukDenNestRegistration.debugSnapshot().configReady, true);
assert.equal(windowStub.PuktukDenNestRegistration.debugSnapshot().livestockReady, true);
assert.equal(windowStub.PuktukDenNestRegistration.debugSnapshot().voorgConfigReady, true);
assert.equal(windowStub.PuktukDenNestRegistration.debugSnapshot().voorgLivestockReady, true);
assert.equal(windowStub.PuktukDenNestRegistration.debugSnapshot().initBridgeReady, true);
assert.equal(windowStub.PuktukDenNestRegistration.debugSnapshot().wildlifeBridgeReady, true);
assert.equal(windowStub.PuktukDenNestRegistration.debugSnapshot().woolBridgeReady, true);

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

windowStub.CookingSystem = {
  init(deps) { originalCookingInitDeps = deps; return 'cooking-initialized'; },
};
const woolItemDefs = {};
const inventoryItems = [];
const cookingDeps = { ITEM_DEFS: woolItemDefs, inventoryItems };
assert.equal(windowStub.CookingSystem.init(cookingDeps), 'cooking-initialized');
assert.equal(originalCookingInitDeps, cookingDeps, 'CookingSystem.init must still receive the untouched dependency object');
assert.equal(woolItemDefs.puktukWool.label, 'Heavy Wool', 'Puktuk shearing output must be presented as Heavy Wool');
assert.equal(woolItemDefs.puktukWool.cat, 'material', 'Heavy Wool must be a normal material inventory item');
assert(woolItemDefs.puktukWool.tags.includes('Puktuk') && woolItemDefs.puktukWool.tags.includes('Heavy') && woolItemDefs.puktukWool.tags.includes('Wool'), 'Heavy Wool must preserve its Puktuk/heavy material identity');
assert.equal(woolItemDefs.lightWool.label, 'Light Wool', 'Voorg-Ass shearing output must be presented as Light Wool');
assert.equal(woolItemDefs.lightWool.cat, 'material', 'Light Wool must be a normal material inventory item');
assert(woolItemDefs.lightWool.tags.includes('Voorg-Ass') && woolItemDefs.lightWool.tags.includes('Light') && woolItemDefs.lightWool.tags.includes('Wool'), 'Light Wool must preserve its Voorg-Ass/light material identity');
assert.deepEqual(
  JSON.parse(JSON.stringify(inventoryItems.map(({ key, label, max }) => ({ key, label, max })))),
  [
    { key: 'puktukWool', label: 'HEAVY WOOL', max: 99 },
    { key: 'lightWool', label: 'LIGHT WOOL', max: 99 },
  ],
  'Both harvested wool types must be visible in the normal inventory picker under their player-facing names',
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

console.log('Puktuk + Grehlr + Voorg-Ass den clutch and wool inventory registration regression passed.');