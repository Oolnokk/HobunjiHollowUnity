'use strict';

// Executes docs/js/crop-planting.js against a stub inventory that behaves
// like game.js's: clampInventoryStack deletes spent stacks, so the last seed
// must not be plantable a second time (undefined <= 0 is false).
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const window = {
  LootRolling: { rollItemStars: () => 3, starRatingText: () => '★★★☆☆' },
  CookingSystem: { recordItemQuality() {} },
};
vm.runInNewContext(fs.readFileSync('docs/js/inventory-stacks.js', 'utf8'), { window, Math, Number, Object });
vm.runInNewContext(fs.readFileSync('docs/js/crop-planting.js', 'utf8'), { window, Math });

const inventory = { needlegrainSeeds: 1 };
const cropData = { needlegrain: { emoji: '🌾', seedKey: 'needlegrainSeeds', cropKey: 'needlegrain', idealMin: 0.2, idealMax: 0.5, label: 'needlegrain' } };
window.CropPlanting.init({
  inventory,
  cropData,
  CropType: { NONE: '' },
  canPlantCropOnTile: (crop, tile) => !!cropData[crop] && tile.type === 'tilled' && !tile.crop,
  clampInventoryStack: key => { if (inventory[key] <= 0) delete inventory[key]; },
});

const first = window.CropPlanting.plantCrop({ type: 'tilled', crop: '' }, 'needlegrain');
assert.equal(first.ok, true, 'the last seed plants');
assert.equal('needlegrainSeeds' in inventory, false, 'spent seed stack is removed');

const secondTile = { type: 'tilled', crop: '' };
const second = window.CropPlanting.plantCrop(secondTile, 'needlegrain');
assert.equal(second.ok, false, 'a deleted seed stack cannot plant again');
assert.equal(secondTile.crop, '', 'tile stays empty');
assert.equal('needlegrainSeeds' in inventory, false, 'seed count does not become NaN');

const ready = { crop: 'needlegrain', cropReady: true, cropAge: 3, fertilized: true };
const harvest = window.CropPlanting.harvestCrop(ready);
assert.equal(harvest.ok, true);
assert.ok(inventory.needlegrain >= 1, 'harvest adds the crop');
assert.equal(ready.crop, '');
assert.equal(ready.fertilized, false);

console.log('crop-planting: ok');
