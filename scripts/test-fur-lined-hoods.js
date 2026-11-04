#!/usr/bin/env node
'use strict';

// Smoke checks for the dyeable Simple Hood and genotype-name-only Fur-lined Hood.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..'); // Resolves the committed docs and scripts for every assertion below.
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8'); // All checks use the checked-out branch, never remote state.
const json = relative => JSON.parse(read(relative)); // Shared loader for authored cosmetics, NPCs and shop data.
const assetExists = url => fs.existsSync(path.join(root, 'docs', url.replace(/^\.\//, ''))); // Validates actual PNG files after the Git tree rename.

const entries = json('docs/config/cosmetics/index.json').entries;
const simple = json('docs/config/cosmetics/simple_hood.json');
const lined = json('docs/config/cosmetics/fur_lined_hood.json');
for (const id of ['simple_hood', 'fur_lined_hood']) {
  assert(entries.some(entry => entry.id === id && entry.path === './' + id + '.json'), id + ' missing from cosmetic index');
}
assert.equal(simple.slot, 'hood');
assert.equal(lined.slot, 'hood');

for (const [key, suffix] of [['tletingan_male', 'tl_m'], ['mashtzarr_male', 'mashtz_m']]) {
  const plain = simple.speciesVariants[key].parts.head.layers;
  const fur = lined.speciesVariants[key].parts.head.layers;
  assert.deepEqual(Object.keys(plain), ['front'], key + ' plain hood must contain no trim');
  assert.equal(plain.front.layerRole, 'base');
  assert.equal(plain.front.image.url, './assets/cosmetics/clothes/hood/simplehood_' + suffix + '.png');
  assert.equal(fur.front.image.url, plain.front.image.url);
  assert.equal(fur.front_trim.layerRole, 'trim');
  assert.deepEqual(fur.front_trim.image.colors, ['B']);
  assert.equal(fur.front_trim.image.url, './assets/cosmetics/clothes/hood/furlinedhood-trim_' + suffix + '.png');
  for (const value of [plain.front, fur.front, fur.front_trim]) {
    assert(assetExists(value.image.url), key + ': missing source sprite ' + value.image.url);
    assert(assetExists(value.behindImage.url), key + ': missing behind sprite ' + value.behindImage.url);
  }
}
for (const oldName of ['simplehood-furtrim_tl_m.png', 'simplehood-trim_fur_mashtz_m.png']) {
  assert(!fs.existsSync(path.join(root, 'docs/assets/cosmetics/clothes/hood', oldName)), 'obsolete trim sprite: ' + oldName);
}

const configSource = read('docs/config/scratchbones-config.js');
const originalFur = read('docs/js/fur-hood-leatherworking.js');
const weaving = read('docs/js/clothing-weaving-system.js');
new vm.Script(configSource, { filename: 'scratchbones-config.js' });
new vm.Script(originalFur, { filename: 'fur-hood-leatherworking.js' });
new vm.Script(weaving, { filename: 'clothing-weaving-system.js' });
assert(configSource.includes('"id": "simple_hood"'));
assert(configSource.includes('"id": "fur_lined_hood"'));
assert(!/if \(id === 'fur_lined_hood'\) return true/.test(weaving), 'fur-lined hood must not be a wool blueprint');
assert(weaving.includes("item?.furTrimColorName"), 'runtime must carry the canonical fur trim name');
assert(weaving.includes("descriptor?.role === 'trim'"), 'runtime must tint trim separately');

const pal = [
  { name: 'Pale Cream', hex: '#c8b991' },
  { name: 'Champagne', hex: '#b99a72' },
  { name: 'Cream', hex: '#c7aa77' },
];
const globalMock = {
  window: { SCRATCHBONES_CONFIG: { game: { creatureGenetics: { palettes: { default: pal } } } } },
  document: { currentScript: { src: 'https://example.test/js/fur-hood-leatherworking.js' }, readyState: 'complete' },
  fetch: async () => ({ ok: false, status: 404 }),
  URL,
};
vm.runInNewContext(originalFur, globalMock, { filename: 'fur-hood-leatherworking.js', timeout: 5000 });
const api = globalMock.window.FurHoodLeatherworking;
assert(api, 'leatherworking API did not initialize');
for (const entry of pal) {
  assert.equal(api.trimHexForName(entry.name), entry.hex);
  assert.equal(api.trimColorNameFor({ genotype: { base: { color: entry.hex } } }), entry.name);
}
assert.equal(api.trimColorNameFor({ genotype: { base: { color: '#fff' } } }), null);
assert.equal(api.trimHexForName('unregistered'), null);

const npcs = json('docs/config/npcs/hobunji-starter-npc-database.json').npcs;
const expected = { binding_hatayap: 'Pale Cream', spearhead_unumanuk: 'Champagne', oddclaw_unumanuk: 'Cream' };
for (const [id, name] of Object.entries(expected)) {
  const npc = npcs.find(entry => entry.id === id);
  assert(npc, id + ' missing');
  assert(npc.equippedCosmetics.includes('fur_lined_hood'), id + ' is not wearing a fur-lined hood');
  assert(!npc.equippedCosmetics.includes('fine_hood'));
  assert(npc.avatarEditor.rawExport.equippedCosmetics.includes('fur_lined_hood'), id + ' editor export is stale');
  assert.equal(npc.clothingPatterns.defaultClothing.hood.furTrimColorName, name);
  assert.equal(npc.appliedDyes.HOOD_B, undefined, 'obsolete dyed trim on ' + id);
  assert.equal(npc.avatarEditor.rawExport.appliedDyes.HOOD_B, undefined);
}
assert(npcs.find(entry => entry.id === 'leaf').equippedCosmetics.includes('fine_hood'), 'Leaf must keep original hood');

console.log('Fur-lined hoods: cosmetic art, palette names, item integrations and NPC defaults OK');
