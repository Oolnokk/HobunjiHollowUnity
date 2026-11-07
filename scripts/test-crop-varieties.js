'use strict';

// Standalone regression: node scripts/test-crop-varieties.js
// Runs real browser modules in a lightweight fake game; no renderer or desktop devtools required.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = { window: {}, console, setInterval: () => 0, clearInterval() {}, localStorage: { setItem() {} } }; // Fake browser host used throughout this test.
const run = path => vm.runInNewContext(fs.readFileSync(path, 'utf8'), context, { filename: path }); // Evaluates production files unchanged.
const game = context.window; // Shared game globals supplied to the extracted modules.
run('docs/config/farm-specializations.js');
const catalog = game.FARM_SPECIALIZATIONS_CONFIG.buildings; // Real carpenter/farm preset authority.
assert.equal(catalog.seedMakerSmall.price, 150);
assert.equal(catalog.seedMakerSmall.daysPerInput, 2);
assert.equal(catalog.seedMakerSmall.yield, 2);
assert.ok(game.FARM_SPECIALIZATIONS_CONFIG.specializations.grower.buildings.includes('seedMakerSmall'));

const cropData = { // Canonical crop data supplied by game.js in production.
  needlegrain: { cropKey: 'needlegrain', seedKey: 'needlegrainSeeds', label: 'Needlegrain', emoji: '🌾', growDays: 3, idealMin: .2, idealMax: .5 },
  heftroot: { cropKey: 'heftroot', seedKey: 'heftrootSeeds', label: 'Heftroot', emoji: '🥔', growDays: 4, idealMin: .2, idealMax: .5 },
  redberries: { cropKey: 'redberries', seedKey: 'redberrySeeds', label: 'Redberries', emoji: '🍓', growDays: 3, idealMin: .2, idealMax: .5 },
};
const itemDefs = { // Current native item/seed records used as templates for variants.
  needlegrain: { label: 'Needlegrain', cat: 'crop', sellPrice: 24, cookingCategories: ['grain'] },
  needlegrainSeeds: { label: 'Needlegrain Seeds', cat: 'seed', sellPrice: 5 },
  heftroot: { label: 'Heftroot', cat: 'crop', sellPrice: 34, cookingCategories: ['vegetable'] },
  heftrootSeeds: { label: 'Heftroot Seeds', cat: 'seed', sellPrice: 5 },
  redberries: { label: 'Redberries', cat: 'crop', sellPrice: 36, cookingCategories: ['berry', 'fruit'] },
  redberrySeeds: { label: 'Redberry Seeds', cat: 'seed', sellPrice: 5 },
};
const inventory = { seedMakerSmallPlan: 1, needlegrain: 1, heftroot: 1, gold: 999 }; // Bag inventory used by parent validation and building purchases.
const storage = { needlegrain: 1 }; // Farm-storage inventory used for the second parent.
const calendar = { day: 1, time01: 0, season: 'Coldmuck' }; // Controllable in-game clock for processing and crop growth.
game.InventoryStacks = { MAX_TOTAL: 999 };
game.CookingSystem = { registerIngredientItems() {}, recordItemQuality() {} };
game.HobunjiCookingData = { items: {
  needlegrain: { id: 'needlegrain', primaryEffect: 'farming', categories: ['grain', 'crop'] },
  heftroot: { id: 'heftroot', primaryEffect: 'fortitude', categories: ['vegetable', 'crop'] },
  redberries: { id: 'redberries', primaryEffect: 'speed', categories: ['berry', 'fruit'] },
} };
game.GameRandom = { random: () => .6 };
run('docs/js/crop-varieties.js');
game.CropVarieties.attach({ cropData, ITEM_DEFS: itemDefs, inventory, inventoryItems: [], loadStorage: () => storage });
const regions = game.CropVarieties.REGIONS; // Source geography and climate gene indices.
assert.equal(regions.length, 6);
assert.equal(regions[2].label, 'Eastern Highplains');
assert.equal(regions[3].label, 'Western Highlands');
const east = game.CropVarieties.ensure('cv_needlegrain_222222'); // Mashtzarr permafrost-plains genotype.
const west = game.CropVarieties.ensure('cv_needlegrain_333333'); // Eternal-snow western plateau genotype.
assert.equal(east.region, 'Eastern Highplains');
assert.equal(west.region, 'Western Highlands');
assert.notEqual(east.idealMin, west.idealMin);
assert.ok(west.seasonGrowth.Coldmuck > east.seasonGrowth.Coldmuck);
const offspring = game.CropVarieties.breed(east.id, west.id, () => .6); // Predictable recombination without mutation.
assert.ok(offspring.id.startsWith('cv_needlegrain_'));
assert.equal(Object.keys(offspring.effects).length, 2);
assert.ok(itemDefs[offspring.seedKey]);
const rgbMidpoint = (a, b) => [16, 8, 0].reduce((rgb, shift) => rgb | (Math.round((((a >>> shift) & 255) + ((b >>> shift) & 255)) / 2) << shift), 0); // Independent exact 50/50 color expectation.
const expectedPigment = rgbMidpoint(east.color, west.color); // Both visible parent colors contribute equally.
assert.equal(offspring.color, expectedPigment, 'first-generation color must blend both parents');
assert.equal(game.CropVarieties.colorOf(offspring.seedKey), expectedPigment, 'seed key must preserve blended crop pigment');
assert.equal(itemDefs[offspring.id].ingredientColor, expectedPigment, 'harvested item uses the same inherited color');
assert.equal(offspring.id.endsWith('_' + expectedPigment.toString(16).padStart(6, '0')), true, 'blended RGB remains in serialized cultivar identity');
const grandchild = game.CropVarieties.breed(offspring.id, east.id, () => .6); // Breed an already mixed cultivar again.
assert.equal(grandchild.color, rgbMidpoint(expectedPigment, east.color), 'second generation blends actual parent appearances, not original allele colors');
assert.equal(game.CropVarieties.details(grandchild.seedKey).color, grandchild.color, 'genetic color survives round-trip through a seed key');
assert.equal(game.CropVarieties.colorOf('cv_needlegrain_222222'), east.color, 'older six-gene imported seeds retain their original coloring');
assert.equal(game.CropVarieties.blendedColor(east.id, 'heftroot'), null, 'incompatible crop species cannot get a preview color');
assert.equal(game.CropVarieties.blendedColor(offspring.id, east.id), grandchild.color, 'seed-maker preview exactly matches actual breeding result');
assert.equal(game.CropVarieties.breed(east.id, 'heftroot', () => .6), null);
assert.equal(game.CropVarieties.breed('needlegrain', 'needlegrain', () => .6).seedKey, 'needlegrainSeeds');
assert.equal(game.CropVarieties.offers(() => .5).length, 3); // One import offering per available family in this fixture.
assert.equal(game.CropVarieties.registered({ ownedOnly: true }).length, 0); // Unpurchased imports do not clutter the Farm Editor.
inventory[east.seedKey] = 3;
assert.ok(game.CropVarieties.registered({ ownedOnly: true }).some(v => v.id === east.id));

game.FarmProduction = { irrigate() {} };
game.CalendarSystem = { currentSeason: () => ({ name: calendar.season }) };
run('docs/js/crop-growth.js');
const tile = { crop: east.id, type: 'tilled', water: .9, cropAge: 0, cropReady: false, stress: '' }; // Well-watered east-highplains crop tile.
game.CropGrowth.init({ cropData, getGrid: () => [[tile]], getCalendar: () => calendar, MAX_WATER: 3, RAIN_RATE: 0, ROWS: 1, COLS: 1, cardinalNeighbors: () => [] });
const winterRate = game.CropGrowth.cropGrowthMultiplier(tile, 0, 0);
calendar.season = 'Deadgrass';
assert.ok(winterRate > game.CropGrowth.cropGrowthMultiplier(tile, 0, 0));
calendar.season = 'Coldmuck';

run('docs/js/item-processing.js');
game.ItemProcessing.init({ ITEM_DEFS: itemDefs, cropData, PROCESSING_METHODS: ['grinding', 'mashing', 'squeezing'], getActiveInventoryItem: () => null });
const flour = game.ItemProcessing.getProcessingOutputs('grinding', offspring.id); // The existing mill recipe should preserve hybrid traits.
assert.equal(flour[0].key, offspring.id + 'Flour');
assert.equal(Object.keys(flour[0].foodEffects).length, 2);
game.ItemProcessing.ensureProcessedItemDef(flour[0]);
assert.equal(Object.keys(itemDefs[flour[0].key].foodEffects).length, 2);

game.FarmWorldSettings = { read: () => ({ meta: {}, world: { farmStarterBuildings: [] } }), current: () => ({}) };
game.FarmPanel = { cancelBarnPlacement() {}, render() {} };
game.FarmBuildings = { canPlaceAt: () => true, clearFootprint() {} };
game.AuthoredFurniture = { load: async () => null };
game.HoneyfuzzleHouse = { tick() {}, syncVisual() {}, removeVisual() {} };
run('docs/js/farm-production.js');
const deps = { // Same farm/production injection seam used by game.js.
  calendar, inventory, cropData, ITEM_DEFS: itemDefs, inventoryItems: [],
  loadStorage: () => storage, saveStorage() {}, COLS: 30, ROWS: 30,
  TileType: { TRENCH: 'trench' }, MAX_WATER: 3, scene: { add() {}, remove() {} }, worldObjects: new Map(),
  hasFarmPermission: () => true, getGrid: () => [], surfaceY: () => 0, markOutline() {}, debugLog() {},
  showToast() {}, saveFarmLayout: () => true, saveMemberWorldData() {}, buildInventoryGrid() {},
  consumeInput(key) { inventory[key]--; return 4; },
};
game.FarmProduction.init(deps);
game.FarmProduction.load([]);
game.FarmProduction.arm('seedMakerSmall');
assert.equal(game.FarmProduction.placeAt(0, 0).ok, true);
const maker = game.FarmProduction.entries()[0]; // The placed, persistent production machine.
assert.equal(inventory.seedMakerSmallPlan, 0);
const incompatible = game.FarmProduction.enqueueSeeds(maker.id, { source: 'bag', itemKey: 'needlegrain' }, { source: 'bag', itemKey: 'heftroot' });
assert.equal(incompatible.ok, false);
assert.equal(inventory.needlegrain, 1);
const duplicate = game.FarmProduction.enqueueSeeds(maker.id, { source: 'bag', itemKey: 'needlegrain' }, { source: 'bag', itemKey: 'needlegrain' });
assert.equal(duplicate.ok, false);
assert.equal(inventory.needlegrain, 1);
const crossing = game.FarmProduction.enqueueSeeds(maker.id, { source: 'bag', itemKey: 'needlegrain' }, { source: 'storage', itemKey: 'needlegrain' });
assert.equal(crossing.ok, true);
assert.equal(inventory.needlegrain, 0);
assert.equal(storage.needlegrain, 0);
calendar.day = 2; game.FarmProduction.tick(); assert.equal(maker.ready.length, 0);
calendar.day = 3; game.FarmProduction.tick(); assert.equal(maker.ready[0].count, 2);
const saved = game.FarmProduction.serialize(); // Finished seeds must be in the ordinary layout's saved ready buffer.
game.FarmProduction.load(saved);
const restored = game.FarmProduction.entries()[0];
assert.equal(restored.ready[0].count, 2);
assert.equal(game.FarmProduction.collect(restored.id).ok, true);
assert.ok(inventory.needlegrainSeeds >= 2);

game.LootRolling = { rollItemStars: () => 3, starRatingText: () => '★★★☆☆' };
run('docs/js/crop-planting.js');
game.CropPlanting.init({ cropData, inventory, CropType: { NONE: '' },
  canPlantCropOnTile: (crop, target) => !!cropData[crop] && target.type === 'tilled',
  clampInventoryStack: key => { if (inventory[key] <= 0) delete inventory[key]; },
});
const planted = { crop: '', type: 'tilled' };
assert.equal(game.CropPlanting.plantCrop(planted, 'needlegrain').ok, true);
assert.equal(planted.crop, 'needlegrain');
inventory[offspring.seedKey] = 1; // Persisted mixed-color seed is plantable without a special inventory or tile format.
const blendedTile = { crop: '', type: 'tilled' }; // Holds a genuine crossbred plant in the ordinary farm grid.
assert.equal(game.CropPlanting.plantCrop(blendedTile, offspring.id).ok, true);
assert.equal(blendedTile.crop, offspring.id);
assert.equal(cropData[blendedTile.crop].varietyColor, expectedPigment, 'world renderer uses the exact blended offspring color');

const html = fs.readFileSync('docs/index.html', 'utf8'); // The real Farm Editor hosts a mobile-accessible cultivar selector.
assert.match(html, /id="regionalCropBrushes"/);
assert.match(fs.readFileSync('docs/js/farm-production.js', 'utf8'), /Blended offspring/, 'mobile seed maker shows the parental color mixture');
assert.match(fs.readFileSync('docs/js/crop-sprite-art.js', 'utf8'), /hobunjiCropVarietyColor/, 'authored garlink\/ongyums sprite bridge carries hybrid pigment');
assert.match(fs.readFileSync('docs/js/vegetation-crop-rendering.js', 'utf8'), /hobunjiCropBaseKey/, 'renderer identifies hybrid plants by species, not their new hue');
new vm.Script(fs.readFileSync('docs/js/vegetation-crop-rendering.js', 'utf8'), { filename: 'docs/js/vegetation-crop-rendering.js' }); // Compile-check for duplicate let/const declarations without a Three.js scene.
assert.match(fs.readFileSync('docs/js/farm-production.js', 'utf8'), /AuthoredFurniture\.load\(definition\.base \|\| entry\.key\)/);
console.log('crop-varieties: ok (regional climates, inheritance, processing, seeds, planting, persistence)');
