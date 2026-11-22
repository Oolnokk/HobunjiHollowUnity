#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm'); // Executes the actual portrait parser.
const read = path => fs.readFileSync(path, 'utf8');
const context = vm.createContext({ window: {}, console });
vm.runInContext(read('docs/config/scratchbones-config.js'), context);
vm.runInContext(read('docs/js/portrait-utils.js'), context);
const catalog = context.window.SCRATCHBONES_CONFIG.game.account.shopCatalog;
const entries = JSON.parse(read('docs/config/cosmetics/index.json')).entries; // Keep legacy save assets available.
for (const type of ['low', 'wide']) {
  const id = 'appearance::hat::riverlandskasa_' + type; // The only newly purchasable item for this style.
  const option = context.portraitOptionFromJson({ id }, JSON.parse(read('docs/config/cosmetics/riverlandskasa_' + type + '.json')));
  assert(catalog.some(item => item.id === id), 'the canonical item is still sold');
  const ordinary = Array.from(context.resolveOptionLayers(option, { speciesId: 'mao-ao', gender: 'female' }));
  assert(ordinary.length === 2 && ordinary.every(layer => !layer.url.includes('kenk_')), 'non-Kenkari art is unchanged');
  for (const speciesId of ['kenkari', 'rakakoan']) for (const gender of ['male', 'female']) {
    const layers = Array.from(context.resolveOptionLayers(option, { speciesId, gender }));
    assert(layers.length === 2 && layers.every(layer => layer.url.includes('kenk_riverlandskasa_' + type)), speciesId + ' ' + gender + ' uses Kenkari sprites');
  }
  for (const gender of ['M', 'F']) {
    const oldId = 'appearance::Kenkari_' + gender + '::kenk_riverlandskasa_' + type;
    assert(entries.some(entry => entry.id === oldId), 'legacy cosmetic remains loadable');
    assert(!catalog.some(item => item.id === oldId), 'Kenkari hat is not a separate purchase');
    assert.equal(context.window.canonicalRiverlandKasaId(oldId), id);
  }
  assert.equal(context.window.canonicalRiverlandKasaId(id), id);
}
assert.equal(context.window.canonicalRiverlandKasaId('five_blossom_crown'), 'five_blossom_crown');
console.log('Kenkari Riverland kasa variant and migration checks passed.');
