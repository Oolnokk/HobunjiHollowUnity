'use strict';

// Verifies the production loot pool, buried-treasure metal picker, and dungeon
// chest grant path together without booting the Three.js renderer.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const poolConfig = JSON.parse(fs.readFileSync('docs/config/loot/loot-pools.json', 'utf8')); // Authored pools loaded by the game.
const metals = ['nativeCopper', 'lowTinBronze', 'tinBronze', 'highTinBronze']; // Representative ordered crafting metals for Town Value gating.
let townValue = 0, randomValue = 0.5; // Controlled inputs for chest quality and material progression.
const granted = [], toasts = []; // Observe the actual inventory grant and player feedback.
const windowObject = { // Browser globals used by the four production modules under test.
  CalendarSystem: { currentWeekdayName: () => 'Anan', currentSeason: () => ({ name: 'Stormtide' }) },
  Fishing: { timeOfDay: () => 'day' },
  TownMine: {
    getTownValue: () => townValue,
    filterMetalKeysForTownValue: (keys, value) => keys.slice(0, Math.max(1, value + 1)),
  },
  GameRandom: { random: () => randomValue },
  LocalDBOverrides: { loadDatabase: async id => id === 'lootPools' ? poolConfig : { shops: {} } },
  ArtifactCollection: { ARTIFACTS: { harlyaoCopperCoin: {} }, rollArtifacts: tier => ({ harlyaoCopperCoin: tier }) },
  THREE: {},
  DynamicSurfaces: { addBeforeRenderClient() {} },
  DevSpawner: { init() {} },
  __farmLog() {},
};
const sandbox = vm.createContext({ window: windowObject, performance: { now: () => 0 }, console }); // Executes real browser IIFEs in isolation.
const load = path => vm.runInContext(fs.readFileSync(path, 'utf8'), sandbox, { filename: path }); // Loads production source rather than duplicate test logic.
for (const modulePath of ['condition-registry.js', 'wild-treasure.js', 'loot-rolling.js', 'dev-random-ruin-dungeon-chests.js']) load('docs/js/' + modulePath);
windowObject.WildTreasure.init({ VERDIGRIS_METAL_KEYS: metals, rnd: () => randomValue, metalBarItemKey: key => 'bar_' + key });
windowObject.LootRolling.init({ calendar: { weather: 'clear' }, getCurrentArea: () => 'ruin', getPlayerData: () => null, applyLoadedShopStock() {} });
windowObject.DevSpawner.init({
  grantLoot: loot => { granted.push({ ...loot }); return Object.keys(loot); },
  showToast: message => toasts.push(message),
});

(async () => {
  await windowObject.LootRolling.loadLootShopConfig();
  for (let tier = 1; tier <= 4; tier++) {
    const entries = poolConfig.pools['dungeonChest_tier' + tier].entries; // The editor-owned entries for this chest tier.
    assert.equal(entries.filter(entry => entry.generatorKey === 'dungeonMetalBars').length, 1, 'every tier has exactly one bar generator');
  }

  let checked = 0; // Total successful open/grant regression scenarios.
  for (const value of [0, 1, 3]) {
    townValue = value;
    for (const roll of [0, 0.3, 0.5, 0.99]) {
      randomValue = roll;
      for (let tier = 1; tier <= 4; tier++) {
        const chest = { tier, poolId: 'dungeonChest_tier' + tier, tierName: 'Test', id: 'test_' + checked, boss: tier === 4, opened: false }; // Minimal live chest shape used by open().
        assert.equal(windowObject.DevRandomRuinDungeonChests.open(chest), true);
        const loot = granted.at(-1); // Inventory quantities emitted by the production chest grant path.
        const bars = Object.entries(loot).filter(([key]) => key.startsWith('bar_')); // Actual material rewards, excluding relic artifacts and trinkets.
        const count = bars.reduce((sum, [, qty]) => sum + qty, 0); // Total granted bars for this chest.
        assert(count >= 1 && count <= 3, 'each dungeon chest grants 1-3 metal bars');
        assert(loot.harlyaoCopperCoin >= 1, 'metal bars do not replace the guaranteed artifact');
        assert(bars.every(([key]) => metals.slice(0, value + 1).includes(key.slice(4))), 'no materials exceed the Town Value ceiling');
        assert.equal(windowObject.DevRandomRuinDungeonChests.open(chest), false, 'opened chests cannot pay out again');
        checked++;
      }
    }
  }

  const firstPool = poolConfig.pools.dungeonChest_tier1; // Mutated to verify authoring control over the new generator.
  const metalEntry = firstPool.entries.find(entry => entry.generatorKey === 'dungeonMetalBars'); // The new independently gated editor entry.
  metalEntry.chance = 0;
  const disabled = windowObject.LootRolling.rollLootPool('dungeonChest_tier1'); // Independent chance-zero roll must suppress only the metal generator.
  assert.equal(Object.keys(disabled).some(key => key.startsWith('bar_')), false);
  assert(disabled.harlyaoCopperCoin >= 1, 'disabling bars does not disable artifacts');
  metalEntry.chance = 1;

  const wildernessPool = windowObject.LootRolling.rollLootPool('treasureChest'); // Wilderness uses its separate treasure bundle generator.
  assert.equal(Object.keys(wildernessPool).some(key => key.startsWith('bar_')), false, 'do not double-grant buried-chest bars');

  assert.equal(granted.length, checked, 'only first-time openings grant inventory');
  assert.equal(toasts.length, checked, 'every successful chest opening reports its loot');
  console.log('Dungeon metal bars: ' + checked + ' live rolls across four tiers, Town Value gating, authoring chance, and duplicate guard passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
