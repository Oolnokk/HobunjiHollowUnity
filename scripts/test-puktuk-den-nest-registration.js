#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../docs/js/puktuk-den-nest-registration.js'), 'utf8');
let originalInitDeps = null;
const windowStub = {
  SCRATCHBONES_CONFIG: {
    game: {
      wildlife: { denMothers: { 'gar-wolf': { creatureKey: 'gar-wolf-den-mother', nestItemKey: 'garWolfBaby' } } },
      livestock: { itemKinds: { garWolfBaby: 'gar-wolf' } },
    },
  },
  DenNestSystem: {
    init(deps) { originalInitDeps = deps; return 'initialized'; },
  },
  __farmLog() {},
};
vm.runInNewContext(source, { window: windowStub }, { filename: 'puktuk-den-nest-registration.js' });

assert.deepEqual(
  JSON.parse(JSON.stringify(windowStub.SCRATCHBONES_CONFIG.game.wildlife.denMothers.puktuk)),
  { creatureKey: 'puktuk', nestItemKey: 'puktukBaby' },
  'Puktuk Den-Mother registration must provide the live-birth baby item before game.js snapshots DEN_MOTHER_ITEM_KEYS',
);
assert.equal(windowStub.SCRATCHBONES_CONFIG.game.livestock.itemKinds.puktukBaby, 'puktuk', 'Puktuk baby must use the shared livestock item-to-species path');
assert.equal(windowStub.PuktukDenNestRegistration.debugSnapshot().configReady, true);
assert.equal(windowStub.PuktukDenNestRegistration.debugSnapshot().livestockReady, true);
assert.equal(windowStub.PuktukDenNestRegistration.debugSnapshot().initBridgeReady, true);

const itemDefs = {};
const deps = { ITEM_DEFS: itemDefs };
assert.equal(windowStub.DenNestSystem.init(deps), 'initialized');
assert.equal(originalInitDeps, deps, 'DenNestSystem.init must still receive the untouched dependency object');
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

console.log('Puktuk den clutch registration regression passed.');
