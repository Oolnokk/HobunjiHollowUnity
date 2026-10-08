const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const gear = { clothingItems: [], clothing: {} }; // Permanent smith knowledge and owned articles.
const pack = []; // Actual corpse loot destination.
const inventory = { gold: 100, bar_nativeCopper: 10 }; // Enough resources to distinguish recipe locks from affordability.
let saves = 0; // Confirms permanent discovery is persisted on acquisition.
const windowObject = { GameRandom: { random: () => 0.9 }, BanditCombat: { TINT_SLOT_BY_SLOT: {} } }; // Shared production modules run in one browser-like VM.
const context = vm.createContext({ window: windowObject, fetch: async () => ({ ok: true, json: async () => ({}) }) }); // Authored tent fetch is unrelated to loot.
for (const file of ['metal-armor-system.js', 'combat/combat-minion.js', 'bandit-camps.js']) vm.runInContext(fs.readFileSync('docs/js/' + file, 'utf8'), context);
const armor = windowObject.MetalArmorSystem; // Production smith lifecycle.
armor.init({ getGearInventory: () => gear, getPackClothing: () => pack, saveGearInventory: () => saves++, inventory,
  VERDIGRIS_METAL_KEYS: ['nativeCopper'], metalBarItemKey: key => 'bar_' + key });
assert.equal(armor.__test.craft('tangedcirclet', 'nativeCopper'), false);
assert.equal(inventory.bar_nativeCopper, 10);
windowObject.BanditCamps.init({ getDyeCatalog: () => [], getPackClothing: () => pack,
  rollLootPool: () => ({}), getStoreClothingPieces: () => [], rnd: () => 0.5, dyeToClothingColor: () => null,
  clothingSpriteForCosmetic: () => null, refreshItemScroll() {}, buildInventoryGrid() {}, buildPackClothingSection() {}, saveMemberWorldData() {} });
const roster = windowObject.MinionCombat.rollRoster('harlyao-skeleton', 'Skeleton'); // Female case also exercises the authored skeleton circlet variant.
const corpse = windowObject.BanditCamps.makeCorpseWorldObject({ id: 'test', name: 'Skeleton', def: { lootPool: 'bandit_grunt' }, rosterRecord: roster, keepCorpseAfterLoot: true }); // Execute the real player loot action.
assert.equal(corpse.onAction('obj_loot_corpse').ok, true);
for (const id of ['rounded_pauldron', 'tangedcirclet']) {
  const item = pack.find(item => armor.baseCosmeticId(item) === id); // Loot must preserve article state instead of becoming ordinary cloth.
  assert(item);
  assert.equal(armor.isMetalArmor(item), true);
  assert.equal(armor.temperLevel(item), 5);
  assert.equal(item.metalKey, 'nativeCopper');
  assert(gear.knownMetalArmorBlueprints.includes(id));
}
assert(pack.find(item => armor.baseCosmeticId(item) === 'tangedcirclet').sprite.endsWith('hskel_tangedcirclet_f.png'));
pack.length = 0;
assert.equal(armor.__test.craft('tangedcirclet', 'nativeCopper'), true, 'discovery survives removing all loot');
assert.equal(inventory.bar_nativeCopper, 9);
assert(saves >= 2);

const source = fs.readFileSync('docs/js/portrait-utils.js', 'utf8'); // Execute the shared authored-layer extractor to verify mask color routing.
const start = source.indexOf('function _extractLayersFromParts('); // Function boundary for the isolated production parser.
const end = source.indexOf('\nfunction ', start + 1); // Ends before the next unrelated parser helper.
const parser = vm.createContext({ portraitRelPath: path => path.replace('./assets/', '') }); // Asset root normalization only.
vm.runInContext(source.slice(start, end), parser);
for (const animal of ['gar-wolf', 'grehlr', "uumkao'ii", 'voorg-ass']) {
  const config = JSON.parse(fs.readFileSync('docs/config/cosmetics/clothes/masks/festivalmask_' + animal + '.json', 'utf8')); // Production cosmetic config.
  const layers = parser._extractLayersFromParts(config.parts, config.palette.layers); // Routes palette A/B/C through the real extractor.
  assert.deepEqual(Array.from(layers, layer => layer.paletteColorKey), animal === 'grehlr' ? ['A', 'B', 'C'] : ['A', 'B']);
  for (const layer of layers) assert(fs.existsSync('docs/assets/' + layer.url));
}
console.log('Harlyao armor corpse loot, permanent smith unlocks, and festival mask color layers passed.');
