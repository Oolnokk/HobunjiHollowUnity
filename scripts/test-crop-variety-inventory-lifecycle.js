#!/usr/bin/env node
'use strict';

// End-to-end lifecycle regression: no changes to game.js are required for foreign seed registration or restoration.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const read = path => fs.readFileSync(path, 'utf8'); // Reads production modules unchanged for the VM test host.
const inventory = {}; // Shared mutable bag: saved seed stacks arrive after initial system initialization.
const catalog = [{ key: 'needlegrainSeeds', label: 'NEEDLEGRAIN SEEDS', seedFor: 'needlegrain' }]; // Real scroll registry owned by CookingSystem.
const cropData = {
  needlegrain: { label: 'Needlegrain', emoji: '🌾', cropKey: 'needlegrain', seedKey: 'needlegrainSeeds', idealMin: .2, idealMax: .5, growDays: 3 },
};
const defs = { needlegrainSeeds: { label: 'Needlegrain Seeds', cat: 'seed', icon: '🌱', tags: ['Seed'] },
  needlegrain: { label: 'Needlegrain', cat: 'crop', icon: '🌾' } }; // Only native definitions exist at startup.
let restoreSawHybrid = false; // Confirms the cultivar is registered before the ordinary cooking restore runs.
let qualityRecorded = 0; // Counts the normal harvested-produce quality metadata update.
const window = {
  InventoryStacks: { MAX_TOTAL: 999 }, GameRandom: { random: () => .99 },
  LootRolling: { rollItemStars: () => 3, starRatingText: () => '★★★' },
  AudioSystem: { objectSfxConfig: () => ({ harvest: 'harvest' }), playObjectSfx() {} },
  CookingSystem: {
    init(deps) { this.deps = deps; this.registerIngredientItems(); },
    registerIngredientItems() {},
    restore() { restoreSawHybrid = Boolean(defs.cv_needlegrain_223344_a0b1c2Seeds && catalog.some(item => item.seedFor === 'cv_needlegrain_223344_a0b1c2')); },
    recordItemQuality() { qualityRecorded++; },
  },
};
const listeners = new Map(); // The metadata bridge registers its existing immediate-input capture listeners here.
const document = { addEventListener: (name, fn) => listeners.set(name, fn), getElementById: () => null }; // No browser renderer/devtools are required; the optional Farm Editor is absent.
const ctx = { window, document, console, Event: class Event {} }; // Production scripts share one browser-like global scope.
const run = path => vm.runInNewContext(read(path), ctx, { filename: path }); // Executes the actual modules, not copied helpers.
run('docs/js/crop-varieties.js');
run('docs/js/inventory-action-metadata-bridge.js');
run('docs/js/crop-planting.js');
window.CropPlanting.init({ cropData, inventory, CropType: { NONE: '' },
  canPlantCropOnTile: (_crop, tile) => ['tilled', 'raised'].includes(tile.type) && !tile.crop,
  clampInventoryStack: key => { if (inventory[key] <= 0) delete inventory[key]; } });
assert.equal(defs.cv_needlegrain_222222Seeds, undefined, 'crops start before CookingSystem provides canonical inventory definitions');
window.CookingSystem.init({ ITEM_DEFS: defs, inventoryItems: catalog, inventory }); // Calls the bridge's patched init; no FarmProduction/game.js coupling.
assert.equal(defs.cv_needlegrain_222222Seeds?.seedFor, 'cv_needlegrain_222222', 'foreign seed definitions register during cooking initialization');
assert.equal(catalog.find(item => item.key === 'cv_needlegrain_222222Seeds')?.seedFor, 'cv_needlegrain_222222', 'foreign seeds become selectable in the real inventory-scroll catalog');

const hybrid = 'cv_needlegrain_223344_a0b1c2'; // Multi-generation color-preserving hybrid saved in a different world.
const hybridSeed = hybrid + 'Seeds'; // Identical key used by actual bag-save and crop authority.
assert.equal(defs[hybridSeed], undefined, 'unseen hybrid is absent before loading its saved bag');
inventory[hybridSeed] = 2; // Models game.js copying nonGearInventory into the shared bag before CookingSystem.restore.
window.__hobunjiPlayerProfile = { worldId: 'saved-world' }; // Saved world provenance must not be borrowed from a previously loaded world.
window.CookingSystem.restore({}); // Production bridge now rebinds CropVarieties before cooking restores.
assert.equal(restoreSawHybrid, true, 'the cooking restore sees the hybrid definition and item-scroll entry immediately');
assert.equal(defs[hybridSeed].seedFor, hybrid, 'the restored seed retains its precise genotype planting target');
assert.equal(cropData[hybrid].varietyColor, 0xa0b1c2, 'saved crossbreeding pigment survives reload');
assert.equal(catalog.filter(item => item.key === hybridSeed).length, 1, 'restoring does not duplicate hybrid scroll entries');
window.CookingSystem.restore({});
assert.equal(catalog.filter(item => item.key === hybridSeed).length, 1, 'repeated restore never duplicates entries');
assert.equal(window.CropVarieties.registered({ ownedOnly: true }).some(item => item.id === hybrid), true, 'owned-only farm brushes include the saved hybrid');
const tile = { type: 'tilled', crop: '' }; // Shared farm tile verifies planting and harvesting consume/produce the correct genotype.
assert.equal(window.CropPlanting.plantCrop(tile, hybrid).ok, true, 'restored hybrid can be planted without game.js-specific glue');
assert.equal(tile.crop, hybrid);
assert.equal(inventory[hybridSeed], 1, 'planting consumes one saved hybrid seed');
tile.cropReady = true;
assert.equal(window.CropPlanting.harvestCrop(tile).ok, true, 'the hybrid can be harvested through the canonical crop authority');
assert.equal(inventory[hybrid], 1, 'harvest produces the exact hybrid key');
assert.equal(qualityRecorded, 1, 'quality is recorded once, not duplicated by restore hooks');
assert.equal(catalog.find(item => item.key === 'needlegrainSeeds')?.seedFor, 'needlegrain', 'native seed behavior is unchanged');

const game = read('docs/game.js'); // Guards the existing world hydration ordering without editing the monolith.
const restoreAt = game.indexOf('window.CookingSystem.restore(playerData.cookingState);');
assert.ok(game.indexOf('Object.assign(inventory, playerData.isNewWorld') < restoreAt && restoreAt >= 0,
  'the real game restores bag contents before the cooking restore hook');
const loader = read('docs/js/combat/combat-config-loader.js'); // Confirms the metadata hook is available before game.js runs.
assert.match(loader, /inventory-action-metadata-bridge\.js\?v=[A-Za-z0-9_.-]+/); // Any valid cache version passes; do not pin test expectations to one release.
console.log('cultivar inventory lifecycle: imported seeds, saved hybrid rehydration, planting, harvesting, no duplicates');
