'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const growthConfigSource = fs.readFileSync('docs/config/animal-growth-config.js', 'utf8');
const growthSource = fs.readFileSync('docs/js/animal-growth.js', 'utf8');
const shopConfig = JSON.parse(fs.readFileSync('docs/config/shops/shop-stock.json', 'utf8'));
const generalStoreSource = fs.readFileSync('docs/js/general-store.js', 'utf8');
const lootRollingSource = fs.readFileSync('docs/js/loot-rolling.js', 'utf8'); // Used to pin shop-stock seller synchronization into the contextual Shop action.

const stable = [];
const inventory = { gold: 2000, growthTonic: 2 };
let activeMountId = null;
let activeCompanionId = null;
let activeShoulderPetId = null;
let saveStableCount = 0;

const deps = {
  inventory,
  ITEM_DEFS: {},
  getStable: () => stable,
  saveStable: () => { saveStableCount++; },
  saveMemberWorldData() {},
  clampInventoryStack() {},
  buildInventoryGrid() {},
  refreshActionBar() {},
  refreshItemScroll() {},
  showToast() {},
  getActiveMountId: () => activeMountId,
  setActiveMountId: value => { activeMountId = value; },
  getActiveCompanionId: () => activeCompanionId,
  setActiveCompanionId: value => { activeCompanionId = value; },
  getActiveShoulderPetId: () => activeShoulderPetId,
  setActiveShoulderPetId: value => { activeShoulderPetId = value; },
};

const documentStub = {
  addEventListener() {},
  getElementById() { return null; },
  createElement() { throw new Error('DOM rendering is not used by this headless test'); },
};

const context = {
  console,
  queueMicrotask,
  document: documentStub,
  window: {
    CreatureGenetics: {
      stableEntryRole(entry) { return entry.kind === 'drenkirra' ? 'mount' : 'companion'; },
    },
    FarmAnimals: {
      init() {},
      addToStable() {
        const entry = { id: 'stable_new', kind: 'drenkirra', name: 'Hatchling', level: 0, stabledAt: Date.now() };
        stable.push(entry);
        activeMountId = entry.id; // Simulates the existing auto-assignment that must be cleared for babies.
        return { ok: true, entry, message: 'added' };
      },
    },
    FarmPanel: {
      init() {},
      renderStablePanel() {},
    },
    LivestockNursery: {
      growBaby() { return { ok: true, message: 'Farm baby grew.' }; },
      debugSnapshot() { return { babies: [] }; },
    },
  },
};
context.window.window = context.window;
vm.runInNewContext(growthConfigSource, context, { filename: 'animal-growth-config.js' });
vm.runInNewContext(growthSource, context, { filename: 'animal-growth.js' });

context.window.FarmAnimals.init(deps);
context.window.FarmPanel.init(deps);
assert.ok(deps.ITEM_DEFS.growthTonic, 'Growth Tonic registers as a normal inventory item');

const added = context.window.FarmAnimals.addToStable('unused');
assert.equal(added.entry.lifeStage, 'baby', 'new Stable creatures start as babies');
assert.equal(activeMountId, null, 'a newly stabled baby cannot remain auto-equipped as a mount');

const grown = context.window.AnimalGrowth.growStableBaby(added.entry.id, { equip: true });
assert.equal(grown.ok, true, 'Stable baby grows when a tonic is owned');
assert.equal(added.entry.lifeStage, 'adult', 'Stable baby becomes an adult');
assert.equal(inventory.growthTonic, 1, 'Stable growth consumes exactly one tonic');
assert.equal(activeMountId, added.entry.id, 'grow-and-equip assigns the now-adult animal to its role');

stable.push({ id: 'legacy', kind: 'drenkirra', name: 'Legacy' });
context.window.AnimalGrowth.normalizeStableLifeStages();
assert.equal(stable.find(entry => entry.id === 'legacy').lifeStage, 'adult', 'legacy Stable entries migrate to adult');

const farmGrow = context.window.LivestockNursery.growBaby('farm_baby');
assert.equal(farmGrow.ok, true, 'public Nursery growth still succeeds with a tonic');
assert.equal(inventory.growthTonic, 0, 'farm Nursery growth consumes exactly one tonic');

const blocked = context.window.LivestockNursery.growBaby('another_farm_baby');
assert.equal(blocked.ok, false, 'farm Nursery growth is blocked without a tonic');
assert.match(blocked.message, /Growth Tonic/, 'blocked farm growth explains the requirement');

const kunji = shopConfig.shops.kunjiPotionWares;
assert.ok(kunji, 'Kunji potion shop is authored in shop-stock.json');
assert.deepEqual(kunji.dialogueAccess.sellerIds, ['kinami_kunji', 'kaboku_kunji'], 'both Kunji shopkeepers expose the shop');
assert.ok(kunji.dialogueAccess.businessMaps.includes('map_i_kunjis_potions_F1'), 'Kunji shop is limited to the potion shop floor');
const tonic = kunji.goods.find(item => item.key === 'growthTonic');
assert.equal(tonic.price, 200, 'Growth Tonic price is authored as 200g');
assert.equal(tonic.gives.growthTonic, 1, 'Growth Tonic shop row grants the shared tonic item');
const healing = kunji.goods.find(item => item.alchemyRecipeId === 'healingPotion');
assert.equal(healing.price, 200, 'Healing Potion price is authored as 200g');
assert.equal(healing.alchemyPotencyTier, 0, 'shop Healing Potion uses the basic brewed potency tier');

const generalStore = shopConfig.shops.generalStoreWares; // Used to verify Funji's basic cooking stock without duplicating the authored goods elsewhere.
const stapleGrants = { // Used to pin the intended representative staple for each newly stocked cooking category.
  heftrootStaple: 'heftroot',
  garlinkStaple: 'garlink',
  ongyumsStaple: 'ongyums',
  needlegrainFlourStaple: 'needlegrainFlour',
  crownedPineNutOilStaple: 'crownedPineNutOil',
  uumkaoiiMeatStaple: 'uumkaoiiMeat',
  whiteDewStaple: 'whiteDew',
};
Object.entries(stapleGrants).forEach(([shopKey, inventoryKey]) => {
  const row = generalStore.goods.find(item => item.key === shopKey); // Used to check each authored general-store row against its inventory grant.
  assert.ok(row, `${shopKey} is stocked by the General Store`);
  assert.equal(row.gives[inventoryKey], 1, `${shopKey} grants exactly one ${inventoryKey}`);
  assert.equal(row.qualityStars, 1, `${shopKey} is explicitly minimum-quality`);
});

assert.match(generalStoreSource, /activeShopState/, 'General Store renderer resolves the active configured shop pool');
assert.match(generalStoreSource, /AlchemySystem\.ensureRecipeItemDef/, 'configured alchemy shop goods register canonical brewed potion stacks');
assert.match(generalStoreSource, /CookingSystem\?\.recordItemQuality/, 'configured food quality is recorded in CookingSystem when a shop purchase is added');
assert.match(generalStoreSource, /addedAmount = Math\.max\(0, nextAmount - previousAmount\)/, 'shop quality tracking records only units that fit under the stack cap');
assert.match(generalStoreSource, /state\.specialized/, 'specialized shops reuse the General Store menu without clothing/sell categories');
assert.match(lootRollingSource, /syncGeneralStoreSellerIds/, 'shop loading synchronizes authored sellers into the contextual Shop action');

const contextualShopNpcIds = ['furunji_funji', 'foroji_funji']; // Used as the pre-load contextual Shop whitelist to prove Kunji sellers are added from shop stock.
let appliedShopStockCount = 0; // Used to prove normal shop-stock application still runs after seller synchronization.
const lootContext = { // Used to execute the real LootRolling loader against the authored shop stock without a browser/network dependency.
  console,
  window: {
    SCRATCHBONES_CONFIG: {
      game: { mobileControls: { generalStoreButton: { npcIds: contextualShopNpcIds } } },
    },
    LocalDBOverrides: {
      loadDatabase(id) {
        return Promise.resolve(id === 'shopStock' ? shopConfig : { pools: {} });
      },
    },
  },
};
lootContext.window.window = lootContext.window;
vm.runInNewContext(lootRollingSource, lootContext, { filename: 'loot-rolling.js' });
lootContext.window.LootRolling.init({
  applyLoadedShopStock() { appliedShopStockCount++; },
});
lootContext.window.LootRolling.loadLootShopConfig().then(() => {
  assert.deepEqual(
    contextualShopNpcIds,
    ['furunji_funji', 'foroji_funji', 'kinami_kunji', 'kaboku_kunji'],
    'contextual Shop action inherits both Kunji sellers from shop-stock dialogueAccess',
  );
  assert.equal(appliedShopStockCount, 1, 'shop stock still applies once after contextual seller synchronization');
  console.log('animal growth + configured shop tests passed');
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
