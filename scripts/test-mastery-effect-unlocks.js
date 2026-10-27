'use strict';
const assert = require('node:assert/strict'); // Behavioral checks exercise the shipped progression and loot code.
const fs = require('node:fs'); // Read production code and the actual authored drop pools.
const vm = require('node:vm'); // Isolated profiles make save migration and character switching testable.

async function main() {
  const listeners = {}; // Player-ready events reload the production character state.
  let saved = JSON.stringify({ characters: [{ id: 'hero' }] }); // In-memory browser save persists learned effects independently of inventory counts.
  let spent = 0; // Locked and malformed selections must not cross the mote-spend boundary.
  const window = { Combat: { deps: { toolMasteryLevel: () => 5, weaponDamageTypeForTool: key => key === 'club' ? 'blunt' : 'sharp', spendMotesOfProwess: () => { spent++; return true; } } }, __hobunjiPlayerProfile: { characterId: 'hero' }, dispatchEvent() {} }; // Two sharp weapons and one blunt weapon test unlock scope.
  const context = { window, document: { addEventListener(name, callback) { listeners[name] = callback; } }, localStorage: { getItem: () => saved, setItem(key, value) { saved = value; } }, CustomEvent: class { constructor(name, data) { this.type = name; this.detail = data?.detail; } } }; // Minimal browser dependencies leave all progression behavior intact.
  vm.runInNewContext(fs.readFileSync('docs/js/combat/combat-progression.js', 'utf8'), context);
  const api = window.CombatProgression; // Canonical unlock, choice and effect authority.
  const items = { ITEM_DEFS: {}, inventoryItems: [], inventory: {} }; // Real registration supplies consumable tablets and scrolls.
  api.registerItems(items);
  const scrollKey = api.itemKey('sharp', 1, 'stat_rangeMul_0p12', 'scroll'); // Real registered mastery scroll used to verify the Pack selection path.
  let processorProbes = 0; // Verifies selecting or viewing a mastery item never enumerates workstation outputs.
  const processorWindow = {};
  vm.runInNewContext(fs.readFileSync('docs/js/item-processing.js', 'utf8'), { window: processorWindow });
  processorWindow.ItemProcessing.init({
    ITEM_DEFS: items.ITEM_DEFS,
    getInventoryItems() { processorProbes++; throw new Error('mastery literature must never enter wheel seed catalog'); },
    PROCESSING_METHODS: new Proxy([], { get() { processorProbes++; throw new Error('mastery literature must never enter workstation discovery'); } }),
  });
  assert.equal(processorWindow.ItemProcessing.isWheelEligible(scrollKey), false, 'mastery scrolls are read from their detail, not the wheel');
  assert.equal(processorWindow.ItemProcessing.isWheelEligible(api.itemKey('sharp', 1, 'stat_rangeMul_0p12', 'tablet')), false, 'mastery tablets are not processor inputs');
  assert.equal(processorProbes, 0, 'mastery selection bypasses every material/processor discovery path');
  const itemCount = items.inventoryItems.length; // Repeated initialization must not duplicate item rows.
  assert.equal(items.ITEM_DEFS[api.itemKey('sharp', 1, 'stat_rangeMul_0p12')].sellPrice, 140, 'entry-level mastery literature has meaningful resale value');
  api.registerItems(items);
  assert.equal(items.inventoryItems.length, itemCount);

  const clearedFinalCopyKeys = []; // Ensures successful last-copy reads ask the existing Hold owner to release its empty stack.
  window.InventoryHeldOverride = { clearExhaustedBagHold(key) { clearedFinalCopyKeys.push(key); return true; }, refreshInventoryUseButton() {} };
  const effect = api.getEffectCatalog().find(entry => entry.id === 'stat_rangeMul_0p12'); // Extended Reach is supported by the sharp combo at every rank after expansion.
  assert.ok(effect);
  for (let rank = 1; rank <= 5; rank++) {
    const row = api.getTree('swingCombo', 'sharp')[rank - 1]; // Legacy indexes remain at the front of each row.
    assert.ok(api.isOptionUnlocked('axe', 'swingCombo', rank, 0));
    assert.ok(api.isOptionUnlocked('axe', 'swingCombo', rank, 1));
    const index = row.findIndex(option => option.effectId === effect.id); // Same exact bonus can occupy all five ranks.
    const key = api.itemKey('sharp', rank, effect.id, rank % 2 ? 'tablet' : 'scroll'); // Both literature forms unlock the same persistent lesson.
    if (index >= 2) {
      assert.equal(api.choose('axe', 'swingCombo', rank, index), false);
      assert.equal(spent, rank - 1, 'locked discoveries spend nothing');
    }
    assert.equal(api.readMasteryItem(key), false, 'unowned literature cannot teach anything');
    items.inventory[key] = 1;
    assert.equal(api.readMasteryItem(key), true);
    assert.equal(api.readMasteryItem(key), false, 'duplicate reads are harmless');
    assert.equal(items.inventory[key], 0, 'successful reading consumes exactly one copy');
    assert.equal(api.hasEffectUnlock('sharp', rank, effect.id), true);
    assert.equal(api.hasEffectUnlock('blunt', rank, effect.id), false);
    assert.equal(api.choose('axe', 'swingCombo', rank, index), true);
    assert.equal(api.isOptionUnlocked('sword', 'pokeCombo', rank, index), true, 'same-type weapons share the permanent lesson');
  }
  assert.equal(clearedFinalCopyKeys.length, 5, 'every exhausted mastery stack triggers Hold cleanup exactly once');
  assert.equal(api.getEffects('axe', 'swingCombo').stats.rangeMul, 0.6, 'all five repeated bonuses add');
  assert.equal(spent, 5);
  assert.equal(api.choose('axe', 'swingCombo', 1, 0.5), false);
  assert.equal(api.choose('axe', 'swingCombo', 1, NaN), false);
  assert.equal(spent, 5);
  assert.equal(JSON.parse(saved).characters[0].masteryEffectUnlocks.length, 5);
  const profile = JSON.parse(JSON.stringify(window.__hobunjiPlayerProfile)); // Simulated restart keeps unlocks even after the literature is sold.
  items.inventory = {};
  window.__hobunjiPlayerProfile = {};
  listeners.hobunjiPlayerReady({ detail: window.__hobunjiPlayerProfile });
  assert.equal(api.getDebug().unlocked.length, 0, 'characters do not leak discoveries');
  window.__hobunjiPlayerProfile = profile;
  listeners.hobunjiPlayerReady({ detail: profile });
  assert.equal(api.getDebug().unlocked.length, 5);
  assert.equal(api.getEffects('axe', 'swingCombo').stats.rangeMul, 0.6);

  const legacy = { abilityProgression: { axe: { swingCombo: { 1: 0, 2: 0, 3: 2 } } } }; // An already purchased legacy special option retains its numeric index and gameplay effect.
  listeners.hobunjiPlayerReady({ detail: legacy });
  assert.equal(api.getChosenOption('axe', 'swingCombo', 3).label, 'Lunging Form');
  assert.equal(api.hasEffectUnlock('sharp', 3, api.getChosenOption('axe', 'swingCombo', 3).effectId), true);

  const pools = JSON.parse(fs.readFileSync('docs/config/loot/loot-pools.json', 'utf8')).pools; // Validate every authored allocation, not a parallel fixture.
  const catalog = new Map(api.getEffectCatalog().map(entry => [entry.id, entry])); // Theme/type metadata is derived from real combat payloads.
  const assigned = new Set(); // Every damage-type/rank/effect combination belongs to exactly one activity pool.
  for (const [id, pool] of Object.entries(pools)) if (pool.mastery) {
    const config = pool.mastery; // Source-level chance is independent from the selected rank.
    assert.ok(config.chance > 0 && config.chance <= 1);
    for (const rank of Object.keys(config.rankWeights)) for (const type of ['sharp', 'blunt']) {
      assert.ok(config.effects[rank][type].length, `${id} rank ${rank} ${type} must not have an empty outcome`);
      for (const effectId of config.effects[rank][type]) {
        const entry = catalog.get(effectId); // Imported or stale effect ids must never create unusable loot.
        assert.ok(entry?.types.includes(type), `${id}: unknown ${effectId}`);
        if (config.theme) assert.equal(entry.theme, config.theme);
        const key = `${type}:${rank}:${effectId}`; // Exact unlock identity; other ranks may belong to different activities.
        assert.equal(assigned.has(key), false, `duplicate source for ${key}`);
        assigned.add(key);
        assert.ok(items.ITEM_DEFS[api.itemKey(type, Number(rank), effectId, config.form)]);
      }
    }
  }
  assert.equal(assigned.size, api.getEffectCatalog().reduce((count, entry) => count + Object.values(entry.unlockRanks).reduce((total, ranks) => total + ranks.length, 0), 0), 'every non-initial bonus remains obtainable at every rank');
  assert.deepEqual(pools.mastery_captain.mastery.rankWeights, { 3: 66, 4: 33 });
  assert.deepEqual(pools.mastery_final_hronal.mastery.rankWeights, { 4: 75, 5: 25 });

  window.LocalDBOverrides = { loadDatabase: async id => id === 'lootPools' ? { pools } : null };
  window.CalendarSystem = { currentWeekdayName: () => 'Anan', currentSeason: () => ({ name: 'Stormtide' }) };
  window.Fishing = { timeOfDay: () => 'day' };
  window.ConditionRegistry = { rollIndependentEligible: () => [] };
  window.GameRandom = { random: () => 0 };
  window.CaveSiteSystem = { profileForMapId: area => area === 'cavern' ? { zoneId: 'map_eastern_mire' } : null };
  window.DevRandomRuin = { getState: () => ({ theme: 'kanthic' }) };
  vm.runInNewContext(fs.readFileSync('docs/js/loot-rolling.js', 'utf8'), context);
  const loot = window.LootRolling; // Production roll entry point used by chests and corpses.
  const gameSource = fs.readFileSync('docs/game.js', 'utf8'); // Reuse the live crafted-weapon shape metadata rather than independently assuming Kylie's damage type.
  const generatedShapeCatalog = gameSource.slice(gameSource.indexOf('      const TOOL_SHAPE_DEFS ='), gameSource.indexOf('      window.ModularWeapons?.registerDefinitions')); // Executes only the existing weapon definition + smith-crafted registration block.
  const toolDefs = vm.runInNewContext(`const TOOL_ITEM_DEFS = {}; const METAL_DEFS = { nativeCopper: {label:'Native Copper'} }; const VERDIGRIS_METAL_KEYS = ['nativeCopper']; ${generatedShapeCatalog}; TOOL_ITEM_DEFS;`, { window: {} }); // Canonical runtime keys, including Kylie, feed the actual mastery loot type lookup.
  loot.init({ calendar: {}, getPlayerData: () => null, getCurrentArea: () => 'map_eastern_mire', weaponDamageTypeForTool: key => toolDefs[key]?.dmgType || (key === 'mace' ? 'blunt' : 'sharp') });
  await loot.loadLootShopConfig();
  for (const [id, pool] of Object.entries(pools)) if (pool.mastery) for (const type of ['sharp', 'blunt']) for (const rank of Object.keys(pool.mastery.rankWeights)) {
    const weights = Object.entries(pool.mastery.rankWeights); // Sample the midpoint of every authored rank interval.
    const total = weights.reduce((sum, [, weight]) => sum + weight, 0); // Same weighted domain as the runtime.
    const start = weights.slice(0, weights.findIndex(([value]) => value === rank)).reduce((sum, [, weight]) => sum + weight, 0); // Lower bound of this particular interval.
    const rolls = [0, (start + pool.mastery.rankWeights[rank] / 2) / total, 0]; // Chance succeeds, requested rank wins, first effect is selected.
    const gained = loot.rollLootPool(id, { damageType: type, random: () => rolls.shift() }); // Exercise all source/rank/type outcomes.
    assert.equal(Object.keys(gained).length, 1);
    const definition = items.ITEM_DEFS[Object.keys(gained)[0]]; // The rolled key must be a registered, readable item.
    assert.equal(definition.masteryUnlock.rank, Number(rank));
    assert.equal(definition.masteryUnlock.type, type);
    assert.equal(Object.values(gained)[0], 1);
    assert.deepEqual(Object.keys(loot.rollLootPool(id, { random: () => pool.mastery.chance })), [], 'drop chance boundary must fail');
  }
  const skeleton = { enemyClass: 'minion', rosterRecord: { appearance: { speciesId: 'harlyao-skeleton' } }, def: { weaponKey: 'mace' } }; // Inherited bandit tables must not misclassify non-bandit humanoids.
  assert.equal(loot.masteryPoolForLoot('bandit_grunt', { entity: skeleton }), 'mastery_skeleton');
  assert.equal(loot.masteryPoolForLoot('bandit_grunt', { entity: { ...skeleton, rosterRecord: { appearance: { speciesId: 'ghoul' } } } }), 'mastery_ghoul');
  assert.equal(loot.masteryPoolForLoot('bandit_lieutenant', { entity: { isHarlyaoLich: true, lichType: 'tothal' } }), 'mastery_lich_tothal');
  assert.equal(loot.masteryPoolForLoot('caveSkeletonBody', { entity: { ...skeleton, areaId: 'cavern' } }), 'mastery_cave_map_eastern_mire');
  assert.equal(loot.masteryPoolForLoot('dungeonChest_tier2', { masterySource: 'caveCache', zoneId: 'map_eastern_mire' }), 'mastery_cave_map_eastern_mire');
  assert.equal(loot.masteryPoolForLoot(null, { entity: { isDenMother: true, areaId: 'cavern' } }), 'mastery_den_map_eastern_mire');
  assert.equal(loot.masteryPoolForLoot('dungeonChest_tier1'), 'mastery_ruin_kanthic');
  assert.equal(loot.masteryPoolForLoot('dungeonChest_tier4', { boss: true, theme: 'hronal' }), 'mastery_final_hronal');
  assert.equal(loot.masteryPoolForLoot('bandit_captain', { entity: { enemyClass: 'bandit' } }), 'mastery_captain');
  assert.ok(Object.keys(loot.rollLootPool('bandit_grunt', { entity: skeleton }))[0].includes(':blunt:'), 'enemy weapon determines the damage type');
  assert.ok(Object.keys(loot.rollLootPool('bandit_captain', { entity: { enemyClass: 'bandit', def: { weaponKey: 'sword' } } }))[0].includes(':sharp:'));
  const kylieBandit = { enemyClass: 'bandit', def: { weaponKey: 'kylie_nativeCopper', attackTag: 'blunt' } }; // A real generated Kylie on a bandit must route to the existing blunt scroll pool.
  const kylieDrops = loot.rollLootPool('bandit_captain', { entity: kylieBandit });
  const kylieScroll = Object.keys(kylieDrops)[0];
  assert(kylieScroll?.startsWith('masteryScroll:blunt:'), 'Kylie bandits drop blunt mastery scrolls, not sharp ones');
  assert.equal(items.ITEM_DEFS[kylieScroll]?.masteryUnlock?.type, 'blunt');

  const noop = () => {}; // Minimal existing initialization owners let the held-item integration run without a browser.
  let held = null; // Simulate Inventory Hold while the item arch is inactive.
  window.CookingSystem = { init: noop };
  window.Combat.abilities = { get: () => null, listForCategories: () => [] };
  window.HobunjiDrunkGameplayBridge = { getHeldItemAction: () => null, beginHeldItemAction: () => false, consumeHeldItemImmediate: () => false };
  context.document.getElementById = () => null;
  context.document.querySelector = () => null;
  context.requestAnimationFrame = callback => callback();
  vm.runInNewContext(fs.readFileSync('docs/js/combat/technique-scrolls.js', 'utf8'), context);
  window.CookingSystem.init({ ...items, getManualHeldItem: () => held, getHeldMode: () => 'tool' });
  const heldKey = api.itemKey('sharp', 5, 'stat_lungeMul_0p2', 'scroll'); // This rank-specific lesson was not learned by the earlier migration test.
  items.inventory[heldKey] = 2;
  held = { kind: 'bagItem', key: heldKey };
  assert.equal(window.HobunjiDrunkGameplayBridge.getHeldItemAction().allowed, true);
  assert.equal(window.HobunjiDrunkGameplayBridge.consumeHeldItemImmediate(), true, 'normal item action reads a manually held mastery scroll');
  assert.equal(items.inventory[heldKey], 1, 'one held copy is consumed from a two-item stack');
  assert.equal(window.HobunjiDrunkGameplayBridge.getHeldItemAction().allowed, false, 'already learned lessons remain held, with Read disabled');
  assert.equal(window.HobunjiDrunkGameplayBridge.beginHeldItemAction(), false);
  assert.equal(items.inventory[heldKey], 1, 'repeat reads cannot consume the remaining duplicate');

  const fresh = { abilityProgression: {} }; // Five repeated cooldown reductions must never produce a negative cooldown.
  window.__hobunjiPlayerProfile = fresh;
  // TechniqueScrolls also listens for player-ready; reload progression directly through its original listener.
  vm.runInNewContext(fs.readFileSync('docs/js/combat/combat-progression.js', 'utf8'), context);
  const stacked = window.CombatProgression; // Fresh production owner proves the same stat stacks through all five real choices.
  stacked.registerItems(items);
  for (let rank = 1; rank <= 5; rank++) {
    const key = stacked.itemKey('sharp', rank, 'stat_cooldownMul_p0p25'); // Quick Recovery is a -25% reduction per selected rank.
    items.inventory[key] = 1;
    stacked.readMasteryItem(key);
    const index = stacked.getTree('counterShield', 'sharp')[rank - 1].findIndex(option => option.effectId === 'stat_cooldownMul_p0p25'); // Preserve the original first two choices while using the appended repeatable bonus.
    assert.equal(stacked.choose('axe', 'counterShield', rank, index), true);
  }
  assert.equal(stacked.getEffects('axe', 'counterShield').stats.cooldownMul, -1);
  console.log('Mastery discoveries: permanent single-use lessons, five-rank stacking, legacy saves, all source allocations, exact rank boundaries and live loot routing passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
