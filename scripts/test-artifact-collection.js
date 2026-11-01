'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const storage = new Map(); // Execute the real world-save boundary with two independent worlds.
let failSave = false, worldId = 'a', seed = .999; // Drives save failure, world switching and worst-case optional loot rolls.
const providers = new Map(), nodeHandlers = new Map(), queued = []; // Observe ordinary NPC dialogue wiring.
const context = { console, Date, performance: { now: () => 0 }, Math: Object.create(Math),
  localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => { if (failSave) throw new Error('quota'); storage.set(key, value); } },
  GameRandom: { random: () => seed },
  DialogueContent: { registerTreeProvider: (id, fn) => providers.set(id, fn), registerNodeEnterHandler: (id, fn) => nodeHandlers.set(id, fn), queueConversationTree: (id, tree) => queued.push({ id, tree }) },
  CalendarSystem: { currentWeekdayName: () => 'day', currentSeason: () => ({ name: 'spring' }) }, Fishing: { timeOfDay: () => 'morning' },
  fetch: async path => ({ ok: true, json: async () => JSON.parse(fs.readFileSync('docs/' + path, 'utf8')) }),
  THREE: {}, DynamicSurfaces: { addBeforeRenderClient() {} }, DevSpawner: { init() {} },
};
context.Math.random = () => seed;
context.window = context;
vm.createContext(context);
const load = path => vm.runInContext(fs.readFileSync(path, 'utf8'), context, { filename: path }); // Runs shipping modules, not copied implementations.
const plain = value => JSON.parse(JSON.stringify(value));
storage.set('hobunjiSaveMeta', JSON.stringify({ characters: [], worlds: [{ id: 'a' }, { id: 'b' }] }));
load('docs/js/world-meta-store.js');
load('docs/js/artifact-collection.js');
const AC = context.ArtifactCollection;
const inventory = { gold: 1000 }, ITEM_DEFS = {}, inventoryItems = []; // Inventory has sellable definitions before any chest can be opened.
let saves = 0;
AC.init({ inventory, ITEM_DEFS, inventoryItems, tothalWorldId: () => worldId, saveMemberWorldData: () => saves++ });
assert.equal(AC.value(), 0);
assert.equal(inventoryItems.filter(item => item.key.startsWith('harlyao')).length, 8, 'legacy Harlyao museum catalog stays intact');
assert.equal(inventoryItems.filter(item => item.key.startsWith('hachutu')).length, 5, 'new Hachutu artifacts register independently');
for (const def of Object.values(ITEM_DEFS)) assert(def.sellPrice >= 90);
assert.equal(AC.donate('unknown').reason, 'artifact');
assert.equal(AC.donate('harlyaoCopperCoin').reason, 'not-owned');
inventory.harlyaoCopperCoin = 2;
failSave = true;
assert.equal(AC.donate('harlyaoCopperCoin').reason, 'save');
assert.equal(inventory.harlyaoCopperCoin, 2);
assert.equal(AC.value(), 0);
failSave = false;
assert.deepEqual(plain(AC.donate('harlyaoCopperCoin')), { ok: true, value: 1, unlocked: ['unbind'] });
assert.equal(inventory.harlyaoCopperCoin, 1, 'exactly one copy consumed');
assert.equal(AC.donate('harlyaoCopperCoin').reason, 'duplicate');
assert.equal(AC.value(), 1);
assert(AC.unlocked('unbind')); assert(!AC.unlocked('remove'));
assert(queued[0].tree.nodes[0].text.includes('dead owner'));
assert.equal(providers.get('garanki_gabu')().entryNode, 'artifact_explanation');
nodeHandlers.get('garanki_gabu')({ id: 'artifact_explanation' });
assert.equal(providers.get('garanki_gabu')(), null, 'milestone is not repeated once its dialogue is shown');
for (const key of Object.keys(AC.ARTIFACTS).slice(1, 6)) { inventory[key] = 1; assert(AC.donate(key).ok); }
assert.equal(AC.value(), 6); assert(AC.unlocked('remove')); assert(AC.unlocked('base')); assert(AC.unlocked('flourish'));
assert.equal(new Set(queued.map(q => q.tree.nodes[0].text)).size, 4, 'each milestone has a distinct explanation');
assert.equal(JSON.parse(storage.get('hobunjiSaveMeta')).worlds[0].artifactCollectionValue, 6);
const expected = AC.debugSnapshot().donated;
AC.init({ inventory, ITEM_DEFS, inventoryItems, tothalWorldId: () => worldId });
assert.deepEqual(plain(AC.debugSnapshot().donated), plain(expected), 'progress and donation order survive reinitialization');
worldId = 'b'; assert.equal(AC.value(), 0, 'different world starts empty');
worldId = 'a'; assert.equal(AC.value(), 6, 'returning to world restores its collection');
for (let tier = 1; tier <= 4; tier++) for (const random of [0, .25, .75, .999]) {
  seed = random;
  const loot = AC.rollArtifacts(tier), key = Object.keys(loot)[0];
  const total = Object.values(loot).reduce((sum, qty) => sum + qty, 0); // Quantities respect the configured chest tier even at RNG boundaries.
  assert(total >= AC.LOOT_TUNING.countsByTier[tier - 1].min && total <= AC.LOOT_TUNING.countsByTier[tier - 1].max);
  for (const [key, qty] of Object.entries(loot)) { assert(qty > 0); assert(AC.ARTIFACTS[key].tier <= tier); }
}
const mixedRolls = [.999, 0, .75, 0]; // Three draws deliberately produce both distinct types and a duplicate coin stack.
context.GameRandom.random = () => mixedRolls.shift();
assert.deepEqual(plain(AC.rollArtifacts(1)), { harlyaoCopperCoin: 2, harlyaoTinCoin: 1 });
context.GameRandom.random = () => seed;
// Sweep every percentile across the complete tier-4 pool; each chest has exactly two identical draws.
const frequencies = {};
for (let percentile = 0; percentile < 100; percentile++) {
  let calls = 0; // First draw chooses the smallest batch; subsequent draws cover the weighted selection interval.
  context.GameRandom.random = () => calls++ === 0 ? 0 : (percentile + .5) / 100;
  for (const [key, qty] of Object.entries(AC.rollArtifacts(4))) frequencies[key] = (frequencies[key] || 0) + qty;
}
for (const [key, def] of Object.entries(AC.ARTIFACTS)) {
  if (!key.startsWith('hachutu')) assert.equal(frequencies[key], def.weight * 2, 'Harlyao tier-4 distribution preserves its original authored rarity');
  else assert.equal(frequencies[key], undefined, 'Hachutu items must not enter Harlyao chest rolls');
  assert.equal(def.sellPrice, Math.round(AC.LOOT_TUNING.commonSellPrice * Math.sqrt(AC.LOOT_TUNING.commonWeight / def.weight) / AC.LOOT_TUNING.priceStep) * AC.LOOT_TUNING.priceStep);
  for (const other of Object.values(AC.ARTIFACTS)) if (def.weight < other.weight) assert(def.sellPrice > other.sellPrice, 'rarer artifacts always sell for more');
}
assert.equal(Object.entries(frequencies).filter(([key]) => key.endsWith('Coin')).reduce((sum, [, qty]) => sum + qty, 0), 156, 'coins account for 78% of top-tier draws');
for (const tier of [undefined, null, 0, -5, 'bad', Infinity, 100, 2.4]) {
  context.GameRandom.random = () => 1; // An inclusive/invalid RNG boundary still produces bounded, nonempty loot.
  const loot = AC.rollArtifacts(tier);
  assert(Object.values(loot).reduce((sum, qty) => sum + qty, 0) >= 1);
}
context.GameRandom.random = () => seed;
load('docs/js/condition-registry.js');
load('docs/js/loot-rolling.js');
context.LootRolling.init({ calendar: {}, getCurrentArea: () => 'ruin', getPlayerData: () => null, applyLoadedShopStock() {} });
load('docs/js/dev-random-ruin-dungeon-chests.js');
const grants = [];
context.DevSpawner.init({ grantLoot: loot => { grants.push(plain(loot)); return Object.keys(loot).map(key => ITEM_DEFS[key]?.label || key); }, showToast() {} });
(async () => {
  await context.LootRolling.loadLootShopConfig();
  seed = .999; // Every optional trinket fails.
  for (let tier = 1; tier <= 4; tier++) {
    const gained = context.LootRolling.rollLootPool('dungeonChest_tier' + tier);
    assert(Object.keys(gained).some(key => AC.ARTIFACTS[key] && gained[key] >= 1));
    const chest = { tier, poolId: 'dungeonChest_tier' + tier, tierName: 'Test', id: String(tier), opened: false };
    assert(context.DevRandomRuinDungeonChests.open(chest));
    assert(Object.keys(grants.at(-1)).some(key => AC.ARTIFACTS[key]));
    assert.equal(context.DevRandomRuinDungeonChests.open(chest), false, 'cannot loot twice');
  }
  const chest = { tier: 4, poolId: 'missing_or_local_empty', tierName: 'Test', id: 'fallback' };
  assert(context.DevRandomRuinDungeonChests.open(chest));
  assert(Object.keys(grants.at(-1)).some(key => AC.ARTIFACTS[key]), 'missing/empty pool still has an artifact');
  const snapshots = fs.readFileSync('docs/js/save-snapshot-core.js', 'utf8');
  vm.runInContext(snapshots, context);
  assert.equal(context.HobunjiSaveSnapshot.capture().meta.worlds[0].artifactCollectionValue, 6, 'collection travels in portable/recovery world snapshots');
  load('docs/js/local-db-overrides.js');
  const shops = JSON.parse(fs.readFileSync('docs/config/shops/shop-stock.json', 'utf8'));
  const npc = context.LocalDBOverrides.applyShopDialogueAccess({ npcs: [{ id: 'garanki_gabu' }] }, shops).npcs[0];
  const service = npc.dialogueTrees.find(tree => tree.shopPool === 'garankiEnchanting');
  assert.deepEqual(plain(service.conditions.maps), ['map_i_researchers_tent', 'map_northern_cliffs']);
  assert.equal(service.nodes[0].choices[0].label, 'Artifacts & Enchanting', 'service is clearly named in the camp conversation');
  const generator = require('../docs/js/wilderness-map-generator.js');
  const terrain = require('../docs/js/terrain-preview.js');
  const camp = JSON.parse(fs.readFileSync('docs/config/locales/locale_researchers_tent.json', 'utf8'));
  const workspace = generator.generateZoneWorkspace('map_northern_cliffs', 'artifact-camp-test', [camp]);
  const instance = workspace.localeInstances.find(locale => locale.localeId === camp.id);
  assert.equal(instance.objects.filter(object => object.key === 'artifactPedestal').length, 3);
  const structure = instance.objects.find(object => object.id === 'obj_structure');
  const merged = terrain.buildMergedZoneGrid(workspace, workspace.maps[0].id);
  for (let row = structure.y; row < structure.y + structure.h; row++) for (let col = structure.x; col < structure.x + structure.w; col++) assert.notEqual(merged.tiles.get(`${col},${row}`).type, 'rock', 'tent metadata does not export as random rock terrain');
  console.log('Artifact collection: donations, world persistence, milestones, dialogue, tier loot and guaranteed chest fallback passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
