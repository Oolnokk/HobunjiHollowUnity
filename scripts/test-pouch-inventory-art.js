'use strict';

// Regression: authored pouch sprite inherits crop pigments without changing saved item keys.
const assert = require('node:assert/strict'); // Validates the live catalogue and breeding data, not duplicated tint logic.
const fs = require('node:fs'); // Reads the actual shipped sprite and modules.
const vm = require('node:vm'); // Loads browser modules in a minimal game-like context.

const read = file => fs.readFileSync(file, 'utf8'); // Used by both the live-module runner and source asset assertion.
const runtime = { window: {} }; // Reuses one browser global for crop genetics and inventory art.
const run = file => vm.runInNewContext(read(file), runtime, { filename: file }); // Executes the shipped implementation directly.
const game = runtime.window; // Mirrors the game.js global registry.

assert.ok(fs.existsSync('docs/assets/objectsprites/pouch.png'), 'the uploaded pouch PNG must ship with the game');
run('docs/js/object-sprite-catalog.js');
run('docs/js/crop-varieties.js');
const cropData = { // Native crop registry is the same authority used for planting and regional varieties.
  needlegrain: { cropKey: 'needlegrain', seedKey: 'needlegrainSeeds', label: 'Needlegrain', idealMin: .2, idealMax: .5, growDays: 3 },
  redberries: { cropKey: 'redberries', seedKey: 'redberrySeeds', label: 'Redberries', idealMin: .2, idealMax: .5, growDays: 3 },
  blackMustard: { cropKey: 'blackMustard', seedKey: 'blackMustardSeed', label: 'Black Mushtard', idealMin: .2, idealMax: .5, growDays: 3 },
};
const ITEM_DEFS = { // Representative native seeds, artifact coins, other little finds, and protected bespoke items.
  needlegrainSeeds: { label: 'Needlegrain Seeds', cat: 'seed' },
  redberrySeeds: { label: 'Redberry Seeds', cat: 'seed' },
  blackMustardSeed: { label: 'Black Mushtard Seed', cat: 'seed' },
  harlyaoCopperCoin: { label: 'Harlyao Copper Coin', cat: 'material', tags: ['Harlyao', 'Artifact'] },
  harlyaoTinCoin: { label: 'Harlyao Tin Coin', cat: 'material', tags: ['Harlyao', 'Artifact'] },
  harlyaoBronzeCoin: { label: 'Harlyao Bronze Coin', cat: 'material', tags: ['Harlyao', 'Artifact'] },
  hachutuMoneyBones: { label: 'Hachutu Money-Bones', cat: 'material', tags: ['Hachutu', 'Artifact'] },
  pebble: { label: 'Pebble', cat: 'material' },
  coralBead: { label: 'Coral Bead', cat: 'material' },
  bespokePebble: { label: 'Pebble with Authored Art', cat: 'material', spriteIcon: 'custom.png' },
  seedOil: { label: 'Seed Oil', cat: 'ingredient', spriteIcon: 'jar_liquid.png' },
  gold: { label: 'Gold', cat: 'currency' },
};
const inventoryItems = Object.entries(ITEM_DEFS).map(([key, def]) => ({ key, label: def.label })); // Metadata-light item-wheel records must inherit canonical art.
game.CropVarieties.attach({ cropData, ITEM_DEFS, inventory: {}, inventoryItems }); // Registers imported varieties into the same inventory catalog.
const objects = game.ObjectSpriteCatalog; // Actual resolver shared by Pack, HUD and held-item planes.
const genetics = game.CropVarieties; // Canonical cultivar color source.
const artFor = key => objects.ensure(key, ITEM_DEFS[key]); // Exercises mutation/caching as normal inventory draws do.

for (const [key, color] of [
  ['needlegrainSeeds', 0xd4c526], ['redberrySeeds', 0xff4f62], ['blackMustardSeed', 0x1f1812],
]) {
  assert.equal(genetics.seedColorOf(key), color, key + ' resolves its native ripe crop pigment');
  assert.equal(artFor(key).spriteIcon, 'pouch.png', key + ' uses the authored pouch');
  assert.equal(ITEM_DEFS[key].spriteColor, color, key + ' pouch matches the harvested crop');
  assert.equal(ITEM_DEFS[key].spriteMode, 'direct', key + ' uses the shared shade-fill renderer');
}

const nativeSeedColors = [ // Each current native seed ID must follow the visible vegetable/berry pigment, not an emoji or fallback.
  ['needlegrainSeeds', 0xd4c526], ['heftrootSeeds', 0xf0d15a], ['garlinkSeeds', 0xf2ead0],
  ['ongyumsSeeds', 0xe09a4b], ['redberrySeeds', 0xff4f62], ['blueberrySeeds', 0x5f80ff],
  ['yellowberrySeeds', 0xffe86a], ['whiteberrySeeds', 0xffffff], ['blackberrySeeds', 0x17121f],
  ['blackMustardSeed', 0x1f1812], ['greenMustardSeed', 0x9bd66b],
];
const beforeCropAttach = { window: {} }; // Proves native pouch tint remains correct even if the HUD asks before farm initialization.
vm.runInNewContext(read('docs/js/crop-varieties.js'), beforeCropAttach);
for (const [key, color] of nativeSeedColors) {
  assert.equal(beforeCropAttach.window.CropVarieties.seedColorOf(key), color, key + ' has an early-boot color fallback');
  assert.equal(genetics.seedColorOf(key), color, key + ' reads the existing ripe crop palette');
  const definition = { cat: 'seed', label: key }; // Exercises seed metadata with and without pre-registered crop definitions.
  assert.equal(objects.ensure(key, definition).spriteColor, color, key + ' colors the pouch correctly');
}
assert.equal(objects.ensure('grassSeeds', { cat: 'ingredient', label: 'Grass Seeds' }).spriteIcon, 'pouch.png',
  'non-vegetable seeds still receive a neutral pouch');

const east = genetics.ensure('cv_needlegrain_222222'); // Independent parental varieties with distinctive regional colors.
const west = genetics.ensure('cv_needlegrain_333333');
const cross = genetics.breed(east.id, west.id, () => .6); // Deterministic child: no rare mutation.
const childArt = artFor(cross.seedKey); // Uses the dynamically created, ordinary inventory seed definition.
assert.equal(childArt.spriteIcon, 'pouch.png');
assert.equal(childArt.spriteColor, cross.color, 'first-generation hybrid pouch matches its actual blended color');
assert.equal(genetics.seedColorOf(cross.seedKey), cross.color);
assert.equal(artFor(east.seedKey).spriteColor, east.color, 'regional import seeds match their vegetable color');
const next = genetics.breed(cross.id, east.id, () => .6); // Multi-generation color must not revert to a native parent.
assert.equal(artFor(next.seedKey).spriteColor, next.color, 'second-generation seeds retain their inherited RGB');
assert.equal(genetics.seedColorOf(next.seedKey), next.color);

for (const key of ['harlyaoCopperCoin', 'harlyaoTinCoin', 'harlyaoBronzeCoin', 'hachutuMoneyBones', 'pebble', 'coralBead']) {
  assert.equal(artFor(key).spriteIcon, 'pouch.png', key + ' is stored as a loose-object pouch');
  assert.equal(artFor(key).spriteColor, undefined, key + ' keeps the untinted authored pouch colors');
  assert.equal(artFor(key).spriteIcon, 'pouch.png', key + ' retains its pouch across repeated inventory refreshes');
}
assert.equal(artFor('gold'), null, 'ordinary money must not be confused with a collectible Harlyao coin');
assert.equal(artFor('bespokePebble'), null, 'bespoke object art wins over generic small-item detection');
assert.equal(artFor('seedOil'), null, 'prepared oil must retain its authored bottle');

objects.applyAll({ ITEM_DEFS, inventoryItems }); // Simulates a normal HUD/Pack metadata synchronization.
for (const key of ['needlegrainSeeds', 'redberrySeeds', 'harlyaoCopperCoin', 'pebble']) {
  const entry = inventoryItems.find(item => item.key === key);
  assert.equal(entry.spriteIcon, 'pouch.png', key + ' item-wheel entry uses the pouch');
  assert.equal(entry.spriteColor, ITEM_DEFS[key].spriteColor, key + ' wheel icon keeps the canonical tint');
}
assert.equal(objects.getDebug().last?.spriteIcon, 'pouch.png', 'mobile diagnostics expose the last pouch assignment');

const reloaded = { window: {} }; // A new page load restores the same genetically inherited appearance from the saved seed ID.
vm.runInNewContext(read('docs/js/crop-varieties.js'), reloaded);
vm.runInNewContext(read('docs/js/object-sprite-catalog.js'), reloaded);
const freshDefs = { needlegrainSeeds: { ...ITEM_DEFS.needlegrainSeeds } }; // No dynamic cultivar definitions are carried across reloads.
reloaded.window.CropVarieties.attach({ cropData: { needlegrain: { ...cropData.needlegrain } }, ITEM_DEFS: freshDefs,
  inventory: { [next.seedKey]: 1 }, inventoryItems: [] });
assert.equal(reloaded.window.ObjectSpriteCatalog.ensure(next.seedKey, freshDefs[next.seedKey]).spriteColor, next.color,
  'restored multi-generation seed pouch still matches the farm color after world reload');

console.log('Pouch inventory art: native seeds, regional genetics, crosses, relic coins, small finds, wheel copies, save reload passed.');
