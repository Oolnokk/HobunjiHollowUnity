'use strict';

const assert = require('assert'); // Regression assertions exercise transactions rather than pinning source text.
const fs = require('fs'); // Loads the shipped module in an isolated runtime.
const vm = require('vm'); // Supplies ordinary injected game services without a browser.
const path = require('path'); // Makes the test independent of its launch directory.
const root = path.resolve(__dirname, '..'); // Repository root used for module reads.
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const inventory = {}; // Shared mutable inventory matches the game injection contract.
const ITEM_DEFS = { lightWool: { label: 'Light Wool' }, puktukWool: { label: 'Heavy Wool' } }; // Existing full cloth materials.
const items = []; // Registered item list is tested for duplicate-free initialization.
let townValue = 0; // Encounter progression is independent of combine results.
let roll = 0; // Controlled RNG exposes every group endpoint deterministically.
let rolls = 0; // Failed transactions must never consume randomness.
let saves = 0; // Successful inventory changes must invoke the save service.
const window = { InventoryStacks: { MAX_TOTAL: 99 }, TownMine: { getTownValue: () => townValue },
  WildernessMapGenerator: { makeRng: () => () => roll } }; // Ordinary game authorities.
const context = vm.createContext({ window, console, Math, Map, Set, WeakMap, JSON, document: {
  createElement: () => ({ width: 0, height: 0, getContext: () => ({ fillText() {} }), toDataURL: () => 'data:image/png;base64,placeholder' }),
} }); // Placeholder sprites need no actual rasterizer for inventory tests.
vm.runInContext(read('docs/js/surface-loot-system.js'), context);
const system = window.SurfaceLootSystem; // Production API under test.
for (const metals of Object.values(system.METAL_GROUPS)) for (const metal of metals) ITEM_DEFS[`bar_${metal}`] = { label: metal + ' Bar' };
const services = { ITEM_DEFS, inventory, inventoryItems: items, random: () => { rolls++; return roll; },
  clampInventoryStack: key => { if (inventory[key] <= 0) delete inventory[key]; }, saveMemberWorldData: () => saves++ }; // Matches the existing inventory transactions.
system.init(services);
system.init(services);
assert.equal(items.length, Object.keys(system.SCRAP_DEFS).length + Object.keys(system.LOOT_ITEMS).length);

assert.equal(system.scrapItem('junkBentCup').ok, false);
inventory.junkBentCup = 1;
inventory.cheapMetalScraps = 98;
assert.equal(system.scrapItem('junkBentCup').ok, false, 'capacity failure must retain the entire junk item');
assert.equal(inventory.junkBentCup, 1);
assert.equal(inventory.cheapMetalScraps, 98);
inventory.cheapMetalScraps = 0;
assert.equal(system.scrapItem('junkBentCup').ok, true);
assert.equal(inventory.junkBentCup, undefined);
assert.equal(inventory.cheapMetalScraps, 2);
assert.equal(saves, 1);

inventory.cheapMetalScraps = 4;
assert.equal(system.combineScraps('cheapMetalScraps').ok, false);
assert.equal(rolls, 0);
assert.equal(inventory.cheapMetalScraps, 4);
inventory.rareMetalScraps = 5;
assert.equal(system.combineScraps('rareMetalScraps').ok, true, 'rare scraps still yield precious metal at Town Value zero');
assert.equal(inventory.bar_silver, 1);
assert.equal(inventory.rareMetalScraps, undefined);
inventory.strongMetalScraps = 7;
roll = .999999;
assert.equal(system.combineScraps('strongMetalScraps').ok, true);
assert.equal(inventory.bar_leadedBronze, 1, 'strong recovery is not capped by the town progression');
assert.equal(inventory.strongMetalScraps, 2, 'five scraps are consumed, preserving a remainder');
inventory.clothScraps = 10;
roll = 0;
assert.equal(system.combineScraps('clothScraps').ok, true);
roll = .99;
assert.equal(system.combineScraps('clothScraps').ok, true);
assert.equal(inventory.lightWool, 1);
assert.equal(inventory.puktukWool, 1);

inventory.rareMetalScraps = 5;
inventory.bar_gold = 99;
const beforeRolls = rolls; // Failed capacity checks must retain both inputs and RNG state.
assert.equal(system.combineScraps('rareMetalScraps').ok, false);
assert.equal(inventory.rareMetalScraps, 5);
assert.equal(rolls, beforeRolls, 'a full possible output must not force a favorable reroll');
inventory.bar_gold = 0;
assert.equal(system.combineScraps('not_a_material').ok, false);
assert.equal(system.availableRecipes().find(recipe => recipe.key === 'rareMetalScraps').canCraft, true);
inventory.rareMetalScraps = NaN;
assert.equal(system.combineScraps('rareMetalScraps').ok, false, 'malformed/missing quantities cannot become free materials');

assert(!system.eligibleLootKeys(0).includes('junkBrokenBronzeFitting'));
assert(!system.eligibleLootKeys(0).includes('lootGoldBrooch'));
assert(system.eligibleLootKeys(3).includes('junkBrokenBronzeFitting'));
assert(!system.eligibleLootKeys(3).includes('junkGildedFitting'));
assert(system.eligibleLootKeys(6).includes('junkGildedFitting'));
assert(system.eligibleLootKeys(6).includes('lootGoldBrooch'));
assert(system.eligibleLootKeys(-9).includes('junkTornBlanket'));
assert.equal(system.imageSource({ imageUrl: 'https://raw.githubusercontent.com/Oolnokk/HobunjiHollowUnity/main/docs/assets/objectsprites/bottle_potion.png' }), 'assets/objectsprites/bottle_potion.png');

system.restore(['persisted-placement', null, 5]);
assert.deepEqual(Array.from(system.serialize()), ['persisted-placement']);
system.restore(undefined);
assert.deepEqual(Array.from(system.serialize()), []);

class Group {
  constructor() { this.userData = {}; this.children = []; this.position = { set() {} }; }
  add(child) { this.children.push(child); child.parent = this; }
} // Minimal scene container tests actual scatter generation without duplicating placement math.
window.THREE = { Group, Matrix4: class {}, Vector3: class {}, Quaternion: class {} };
context.THREE = window.THREE;
const parent = new Group(); // Procedural camp/chest parent used by the production encounter builder.
roll = 0;
const scatter = system.scatter(parent, { id: 'camp:first' }); // The renderer correctly skips unavailable browser-only sprite services in this harness.
const placements = scatter.userData.surfaceLootPlacements; // Inspect the actual authored-schema records, not copied expected data.
assert.equal(placements.length, 5);
assert(placements.some(record => record.itemKey === 'alchemy_healingPotion_p0'));
assert(placements.some(record => record.itemKey === 'alchemy_venomFlask_p0'));
assert(placements.every(record => record.surfaceId === 'loot_top' && record.lootable));
assert.equal(parent.children[0], scatter);

let built = 0; // Confirms the existing authored furniture authority actually calls the placement renderer.
window.SurfaceLootSystem = { buildPlacements: (group, data) => { built++; assert.equal(data.key, 'test'); return group; } };
vm.runInContext(read('docs/js/authored-furniture-runtime.js'), context);
window.AuthoredFurniture.buildGroup({ key: 'test', parts: [], itemPlacements: placements });
assert.equal(built, 1);
console.log('surface loot: salvage, generic recovery, progression, persistence, encounter generation, and furniture integration passed');
