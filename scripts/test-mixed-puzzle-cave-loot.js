// Mixed loot source composition and chest-contents parity; run with
// node scripts/test-mixed-puzzle-cave-loot.js (no browser or save files required).
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const config = JSON.parse(fs.readFileSync('docs/config/loot/loot-pools.json', 'utf8'));
const lootSource = fs.readFileSync('docs/js/loot-rolling.js', 'utf8');
const treasureSource = fs.readFileSync('docs/js/wild-treasure.js', 'utf8');
const pools = config.pools; // Authored config under test, not a reimplemented fixture.
const mixed = pools.mixedCrateTreasurePuzzle; // Same pool the Tzatzul victim-corpse consumer will use.
assert(mixed && mixed.kind === 'mixed', 'mixed table is configured');
assert.deepEqual(mixed.sourcePools.map(s => s.poolId), ['crateJunk', 'treasureChest', 'puzzleCave']);
assert.equal(pools.puzzleCave.kind,'exclusive','puzzle source awards exactly one trinket');
assert.equal(pools.puzzleCave.entries.length,13,'all double-edged trinkets are present in the exclusive cave reward table');
const w = {
  LocalDBOverrides: { loadDatabase: async id => id === 'lootPools' ? config : { shops: {} } },
  GameRandom: { random: () => 0 },
  CalendarSystem: { currentWeekdayName: () => 'test', currentSeason: () => ({ name: 'test' }) },
  Fishing: { timeOfDay: () => 'day' },
  ConditionRegistry: { rollIndependentEligible: entries => entries.filter(e => e.itemKey), entryEligible: () => true },
  TownMine: { filterMetalKeysForTownValue: keys => keys, getTownValue: () => 0 },
  TrinketSystem: {DEFINITIONS:{}}, // The parent trinket PR may not yet be merged when this branch is tested.
};
const context = { window: w, console, Math, Date, Object, Array, Number, String };
vm.runInNewContext(lootSource, context, { filename: 'loot-rolling.js' });
vm.runInNewContext(treasureSource, context, { filename: 'wild-treasure.js' });
w.LootRolling.init({
  applyLoadedShopStock() {}, getCurrentArea: () => 'test', getPlayerData: () => ({}),
  calendar: { weather: 'sun' }, getShopStock: () => ({})
});
(async () => {
  await w.LootRolling.loadLootShopConfig();
  const results = {};
  // Before the parent PR is merged, an unavailable trinket must not silently spend a mixed-source draw.
  results.crate = w.LootRolling.rollLootPool('mixedCrateTreasurePuzzle', { random: () => 0 });
  assert(Object.keys(results.crate).length > 0, 'crate source produces real inventory keys');
  assert.deepEqual(Array.from(w.LootRolling.getMixedLootDebug().selected), ['crateJunk','crateJunk']);
  const absent = w.LootRolling.getMixedLootDebug().deferredSources;
  assert(absent.includes('puzzleCave'), 'unavailable trinket source is deferred until its definitions load');
  // Chest source must use the same generator as actual buried treasure.
  w.WildTreasure.init({
    rnd: () => 0, calendar: { day: 1 }, getLootPools: () => pools,
    lootShopWorldState: () => ({}), VERDIGRIS_METAL_KEYS: ['bronze'],
    MYSTERY_DYE_ITEM_KEY_BY_POOL: { flower: 'mysteryFlowerDye' },
    metalBarItemKey: metal => metal + 'Bar',
  });
  const savedEntries = pools.treasureChest.entries;
  pools.treasureChest.entries = savedEntries.map(entry => ({
    ...entry, chance: ['metalBars','mysteryDye','gold'].includes(entry.id) ? 1 : 0,
  }));
  const chest = w.LootRolling.rollLootPool('mixedCrateTreasurePuzzle', { random: () => 0.9999 });
  assert.equal(chest.bronzeBar, 2, 'two rolls each grant a canonical metal bar');
  assert.equal(chest.mysteryFlowerDye, 2, 'mystery dye generator retained');
  assert.equal(chest.gold, 20, 'treasure gold entry retained');
  assert.deepEqual(Array.from(w.LootRolling.getMixedLootDebug().selected), ['treasureChest','treasureChest']);
  pools.treasureChest.entries = savedEntries;
  // The source unlocks dynamically as soon as definitions from the trinket branch are present.
  for(const item of pools.puzzleCave.entries)w.TrinketSystem.DEFINITIONS[item.itemKey.slice('trinket_'.length)]={id:item.itemKey};
  const last=pools.puzzleCave.entries[pools.puzzleCave.entries.length-1];
  assert.equal(w.LootRolling.rollLootPool('mixedCrateTreasurePuzzle', {random:()=>.9999})[last.itemKey],2,
    'two mixed draws each award one actual benefit/drawback trinket');
  assert.deepEqual(Array.from(w.LootRolling.getMixedLootDebug().selected),['puzzleCave','puzzleCave']);
  const firstTier=pools.puzzleCave.entries.filter(entry=>entry.tier===1);
  const tierOne=w.LootRolling.rollLootPool('puzzleCave',{rewardTier:1,random:()=>.9999});
  assert.deepEqual(Object.keys(tierOne),[firstTier[firstTier.length-1].itemKey],
    'song difficulty constrains the reward tier');
  const highTier=pools.puzzleCave.entries.filter(entry=>entry.tier===5);
  const tierFive=w.LootRolling.rollLootPool('puzzleCave',{rewardTier:5,random:()=>0});
  assert.deepEqual(Object.keys(tierFive),[highTier[0].itemKey],
    'the highest-tier cave awards only a highest-tier trinket');
  // Cyclic source composition is bounded; no recursive runaway.
  pools.puzzleCave.kind = 'mixed'; pools.puzzleCave.sourcePools = [{ poolId: 'mixedCrateTreasurePuzzle', weight: 1 }];
  assert(Object.keys(w.LootRolling.rollLootPool('puzzleCave', { random: () => 0 })).length > 0,
    'cyclic source is excluded while its noncyclic independent sources still roll');
  pools.puzzleCave.kind='exclusive'; delete pools.puzzleCave.sourcePools;
  console.log('Mixed loot: crate, canonical chest generators, deferred trinket source, tiered puzzle rewards and cycle guards PASS.');
})().catch(error => { console.error(error); process.exitCode = 1; });
