#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const config = JSON.parse(fs.readFileSync('docs/config/town-mine.json', 'utf8'));
assert.ok(config.oreTierOreKeys.flat().every(key => !/bronze|electrum|pewter/i.test(key)), 'Mine tiers must contain elemental ores, never alloy ores');
const townMap = JSON.parse(fs.readFileSync('docs/config/maps/hobunji_hollow_town.map.json', 'utf8'));
const mapIndex = JSON.parse(fs.readFileSync('docs/config/maps/index.json', 'utf8'));
const safeRoom = JSON.parse(fs.readFileSync('docs/config/maps/map_i_town_mine_safe.json', 'utf8'));
const mineLadder = JSON.parse(fs.readFileSync('docs/config/furniture-authored/mineLadder.json', 'utf8'));
const generatedSeeds = [];
const floor = [];
for (let row = 1; row <= 9; row++) for (let col = 1; col <= 9; col++) floor.push([col, row]);
const context = {
  console,
  Date,
  Math,
  setTimeout,
  fetch: async () => ({ ok: true, json: async () => config }),
  window: {
    WildernessMapGenerator: { makeRng: () => () => 0.41 },
    CavernGenerator: {
      generateCavernFloor(seed) {
        generatedSeeds.push(seed);
        return { cols: 11, rows: 11, floor, exitTiles: [[4, 9], [5, 9], [6, 9]], exitCol: 5, exitRow: 8, mesh: {} };
      },
    },
  },
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('docs/js/town-mine.js', 'utf8'), context);

(async () => {
  const mine = context.window.TownMine;
  let mineSaveCalls = 0;
  mine.init({ save: () => { mineSaveCalls += 1; } });
  mine.restore({ deepestFloor: 4, unlockedShortcutTiers: [], townValue: 0, discoveredOreKeys: [] });
  assert.strictEqual(mine.recordFloorReached(5), true, 'Reaching a new deepest floor should report progression');
  assert.strictEqual(mineSaveCalls, 1, 'Reaching a new deepest floor should save immediately');
  assert.strictEqual(mine.recordFloorReached(3), false, 'Revisiting a shallower floor should not count as new progression');
  assert.strictEqual(mineSaveCalls, 1, 'Revisiting an older floor should not cause redundant saves');
  const progressionRoundTrip = mine.serialize();
  mine.restore(null);
  assert.strictEqual(mine.serialize().deepestFloor, 0, 'A blank restore should reset mine progression');
  mine.restore(progressionRoundTrip);
  assert.strictEqual(mine.serialize().deepestFloor, 5, 'Serialized deepest floor should survive a restore round trip');
  const entrance = townMap.buildings.find(building => building.id === 'bldg_town_mine_entry');
  assert.strictEqual(entrance?.pieceFile, 'config/pieces/mine_entrance.json', 'Town should persist the supplied movable mine entrance building');
  assert.ok(townMap.transitions.some(transition => transition.buildingId === entrance.id && transition.targetMapId === safeRoom.id), 'The movable entrance should own the safe-room transition');
  assert.ok(mapIndex.maps.some(map => map.id === safeRoom.id && map.category === 'building_interior'), 'The safe room should be indexed for Map Editor interior sync');
  assert.ok(safeRoom.furniture.some(furniture => furniture.itemKey === 'mineLadderFurniture'), 'The safe-room ladder should be an editable interior fixture');
  assert.strictEqual(mineLadder.key, 'mineLadder', 'The supplied ladder should be available through authored furniture loading');
  assert.strictEqual(mineLadder.parts.length, 6, 'The authored ladder should retain every supplied part');
  assert.strictEqual(mine.descentChance('rock'), 0.08, 'Rock discovery should have the doubled 8% base chance');
  assert.strictEqual(mine.descentChance('enemy'), 0.16, 'Enemy discovery should have the doubled 16% base chance');
  context.window.PerkSystem = { rank: (_skill, perkId) => perkId === 'weakRockSense' || perkId === 'collapsingBlows' ? 5 : 0 };
  assert.strictEqual(mine.descentChance('rock'), 0.155, 'Weak Rock Sense should remain a separate additive bonus');
  assert.strictEqual(mine.descentChance('enemy'), 0.31, 'Collapsing Blows should remain a separate additive bonus');
  const first = await mine.synthesizeFloorMapData(mine.mapIdForFloor(1));
  const floorTwoA = await mine.synthesizeFloorMapData(mine.mapIdForFloor(2));
  const floorTwoB = await mine.synthesizeFloorMapData(mine.mapIdForFloor(2));
  assert.strictEqual(first.exits.length, 1, 'Floor 1 should retain its return ladder');
  assert.ok(first.mineReturnLadder, 'Floor 1 should render the ladder mesh');
  assert.strictEqual(floorTwoA.exits.length, 0, 'Ordinary deeper floors should not have an upward exit');
  assert.strictEqual(floorTwoA.descentRock, undefined, 'No rock should be preselected as the descent');
  assert.ok(floorTwoA.oreRocks.every(rock => !rock.hiddenDescent), 'Rocks should use runtime descent rolls');
  assert.ok(floorTwoA.oreRocks.every(rock => !rock.metalKey && (!rock.oreKey || config.oreTierOreKeys.flat().includes(rock.oreKey))), 'Mine rocks should carry elemental ore keys and never finished-bar metal keys');
  assert.strictEqual((mine.rollOreYield(() => 0.49) + mine.rollOreYield(() => 0.5)) / 2, 1.5, 'Base ore yield should average exactly 1.5 across the equal one/two outcomes');
  assert.strictEqual(mine.rollOreYield(() => 0.5, 1), 2, 'Mining yield bonuses should be additive after the 1.5 base roll');
  const floorSet = new Set(floorTwoA.floor.map(tile => tile.join(','))); // Used to prove spawned rocks keep a full tile of clearance from organic wall geometry.
  assert.ok(floorTwoA.oreRocks.every(rock => {
    for (let rowOffset = -1; rowOffset <= 1; rowOffset++) {
      for (let colOffset = -1; colOffset <= 1; colOffset++) {
        if (!floorSet.has(`${rock.col + colOffset},${rock.row + rowOffset}`)) return false;
      }
    }
    return true;
  }), 'Every mine rock should spawn on an interior floor tile with full surrounding clearance');
  assert.notStrictEqual(generatedSeeds[1], generatedSeeds[2], 'Each visit should use a fresh generation seed');
  assert.ok(floorTwoB, 'A repeat visit should synthesize a complete replacement floor');

  mine.restore({ deepestFloor: 10, unlockedShortcutTiers: [1], townValue: 1 });
  const shortcutFloor = await mine.synthesizeFloorMapData(mine.mapIdForFloor(11));
  assert.strictEqual(shortcutFloor.exits.length, 0, 'A shortcut destination should not provide a return exit');
  assert.strictEqual(shortcutFloor.mineReturnLadder, null, 'Shortcut destinations should rely on the utility-menu escape');
  const shortcutRockTiles = new Set(shortcutFloor.oreRocks.map(rock => `${rock.col},${rock.row}`)); // Used to guard the shared geometry-safe placement pool against rock/enemy overlap.
  assert.ok(shortcutFloor.mineEnemySpawns.every(enemy => !shortcutRockTiles.has(`${enemy.col},${enemy.row}`)), 'Enemies should never spawn hidden inside mine rocks');
  const finalFloor = await mine.synthesizeFloorMapData(mine.mapIdForFloor(100));
  assert.strictEqual(finalFloor.mineCanDescend, false, 'Floor 100 should not roll another descent');

  const perkContext = { window: { SkillSystem: { MAX_LEVEL: 20, level: () => 20 } }, document: { getElementById: () => null }, console };
  vm.createContext(perkContext);
  vm.runInContext(fs.readFileSync('docs/js/perk-system.js', 'utf8'), perkContext);
  const miningPerks = perkContext.window.PerkSystem.TREES.mining;
  assert.ok(miningPerks.some(perk => perk.id === 'increaseMiningYield'));
  assert.ok(miningPerks.some(perk => perk.id === 'increaseMiningSpeed'));
  assert.ok(miningPerks.some(perk => perk.id === 'weakRockSense'));
  assert.ok(miningPerks.some(perk => perk.id === 'collapsingBlows'));
  vm.runInContext(fs.readFileSync('docs/js/skill-system.js', 'utf8'), perkContext);
  perkContext.window.PerkSystem = { rank: (_skill, perkId) => perkId === 'increaseMiningYield' || perkId === 'increaseMiningSpeed' ? 5 : 0 };
  assert.strictEqual(perkContext.window.SkillSystem.bonusYieldChance('mining'), 0.35, 'Five yield ranks should preserve the former maximum bonus');
  assert.strictEqual(perkContext.window.SkillSystem.actionSpeedMultiplier('mining'), 1.5, 'Five speed ranks should preserve the former maximum bonus');
  perkContext.window.PerkSystem = { rank: () => 0 };
  assert.strictEqual(perkContext.window.SkillSystem.bonusYieldChance('mining'), 0, 'Mining level alone should no longer grant yield');
  assert.strictEqual(perkContext.window.SkillSystem.actionSpeedMultiplier('mining'), 1, 'Mining level alone should no longer grant speed');

  const gameSource = fs.readFileSync('docs/game.js', 'utf8');
  assert.ok(gameSource.includes('member.townMineState = window.TownMine?.serialize?.() || null;'), 'Member-world saves must include Town Mine progression');
  assert.ok(gameSource.includes('window.TownMine?.restore?.(playerData.townMineState);'), 'Player startup must restore Town Mine progression');
  const oreDefsMatch = gameSource.match(/const ORE_DEFS = (\{[\s\S]*?\n      \}); \/\/ Used by mine drops/);
  const recipesMatch = gameSource.match(/const METAL_BAR_RECIPES = (\{[\s\S]*?\n      \}); \/\/ Used by the Crafting pane/);
  assert.ok(oreDefsMatch && recipesMatch, 'Metallurgy definitions should remain test-readable in game.js');
  const oreDefs = vm.runInNewContext(`(${oreDefsMatch[1]})`);
  const recipes = vm.runInNewContext(`(${recipesMatch[1]})`);
  for (const [metalKey, ingredients] of Object.entries(recipes)) {
    assert.strictEqual(Object.values(ingredients).reduce((sum, amount) => sum + amount, 0), 5, `${metalKey} should consume exactly five ore`);
    if (/bronze|electrum|pewter/i.test(metalKey)) assert.ok(Object.keys(ingredients).length > 1, `${metalKey} must combine multiple elemental ores`);
    assert.ok(Object.keys(ingredients).every(key => oreDefs[key]), `${metalKey} should reference only registered elemental ores`);
  }

  const discovered = new Set(['copper']);
  const craftingInventory = { ore_copper: 5, ore_tin: 5 };
  const craftingContext = {
    window: {},
    document: { querySelectorAll: () => [], getElementById: () => null },
  };
  vm.createContext(craftingContext);
  vm.runInContext(fs.readFileSync('docs/js/crafting-panel.js', 'utf8'), craftingContext);
  craftingContext.window.CraftingPanel.init({
    inventory: craftingInventory,
    clampInventoryStack: key => { if ((craftingInventory[key] || 0) <= 0) delete craftingInventory[key]; },
    FURNITURE_BLUEPRINT_CATALOG: [], ORE_DEFS: oreDefs,
    METAL_DEFS: Object.fromEntries(Object.keys(recipes).map(key => [key, { label: key }])),
    METAL_BAR_RECIPES: recipes,
    metalOreItemKey: key => `ore_${key}`, metalBarItemKey: key => `bar_${key}`,
    recordHeldOres: keys => keys.forEach(key => discovered.add(key)), hasDiscoveredOre: key => discovered.has(key),
    showToast: () => {}, buildInventoryGrid: () => {}, saveMemberWorldData: () => {}, esc: value => value,
  });
  const visibleRecipeKeys = craftingContext.window.CraftingPanel.visibleMetalRecipes().map(([key]) => key);
  assert.ok(visibleRecipeKeys.includes('nativeCopper') && visibleRecipeKeys.includes('tinBronze'), 'holding copper and tin should reveal their pure/alloy recipes');
  assert.ok(!visibleRecipeKeys.includes('arsenicalBronze'), 'recipes must stay hidden until every ingredient ore has been held');
  craftingContext.window.CraftingPanel.craftMetalBar('nativeCopper');
  assert.strictEqual(craftingInventory.ore_copper || 0, 0, 'crafting one copper bar should consume five copper ore');
  assert.strictEqual(craftingInventory.bar_nativeCopper, 1, 'crafting five ore should produce one existing metal bar item');
  console.log('Town mine descent/regeneration checks passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
