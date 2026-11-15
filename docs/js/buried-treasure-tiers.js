// Higher-tier wilderness treasure. The existing WildTreasure module owns placement,
// locking, and the final save; this module owns rarity and specialty reward selection.
(() => {
  'use strict';

  const TIERS = Object.freeze({
    1: Object.freeze({ label: 'Weathered', weight: .62, gold: [0, 0], extraBars: 0, trinket: 0, mastery: 0, breeding: 0, enchanted: 0 }),
    2: Object.freeze({ label: 'Reinforced', weight: .25, gold: [20, 60], extraBars: 1, trinket: .10, mastery: .07, breeding: .18, enchanted: 0 }),
    3: Object.freeze({ label: 'Ornate', weight: .10, gold: [55, 110], extraBars: 2, trinket: .28, mastery: .18, breeding: .38, enchanted: .015 }),
    4: Object.freeze({ label: 'Ancient', weight: .03, gold: [110, 220], extraBars: 3, trinket: .48, mastery: .36, breeding: .58, enchanted: .045 }),
  }); // Source of truth for all buried-chest rarity, bonus value, specialty chances, and UI labels.

  function tier(value) {
    const id = Math.floor(Number(value));
    return Object.prototype.hasOwnProperty.call(TIERS, id) ? id : 1; // Legacy saves predate tiers and remain easy weathered chests.
  }

  function rollTier(random) {
    let remaining = Math.max(0, Math.min(.999999999, Number(random()) || 0)); // Driven by a separate zone/week RNG in WildTreasure.
    for (const [id, config] of Object.entries(TIERS)) {
      remaining -= config.weight;
      if (remaining < 0) return Number(id);
    }
    return 4;
  }

  function enhanceLoot(bundle, tierValue, deps, rollMetals) {
    const id = tier(tierValue);
    if (id === 1) return bundle; // The original common chest remains unchanged.
    const config = TIERS[id];
    const random = deps.rnd; // Same world reward random source the original chest generator already uses.
    bundle.gold += config.gold[0] + Math.floor(random() * (config.gold[1] - config.gold[0] + 1));
    for (let i = 0; i < config.extraBars; i++) {
      const metal = rollMetals()[0]; // Town Value gating remains in WildTreasure's existing metal picker.
      if (metal) bundle.metalKeys.push(metal);
    }

    if (random() < config.trinket) {
      const entries = deps.getLootPools?.()['dungeonChest_tier' + id]?.entries || []; // Reuse the existing tier-specific, editor-authored dungeon trinket catalogs.
      const keys = entries.map(entry => entry?.itemKey).filter(key =>
        typeof key === 'string' && key.startsWith('trinket_') && window.TrinketSystem?.DEFINITIONS?.[key.slice(8)]);
      if (keys.length) bundle.trinketKey = keys[Math.floor(random() * keys.length)];
    }

    if (random() < config.mastery) {
      const source = id === 4 ? 'mastery_captain' : 'mastery_tent'; // Rank 2–3 scrolls in reinforced/ornate; rank 3–4 for ancient.
      const items = window.LootRolling?.rollMasteryPool?.(source, { random });
      bundle.masteryScrollKey = Object.keys(items || {}).find(key => key.startsWith('masteryScroll:')) || null;
    }

    if (random() < config.breeding) {
      const recipes = Object.values(window.AlchemySystem?.RECIPE_DEFS || {}).filter(recipe => recipe?.useMode === 'livestock'); // Automatically includes future authored breeding recipes.
      const recipe = recipes[Math.floor(random() * recipes.length)];
      if (recipe) bundle.breedingPotionKey = window.AlchemySystem.ensureRecipeItemDef(recipe.id, Math.floor(random() * 3));
    }

    if (random() < config.enchanted) {
      bundle.enchantedRelic = window.HarlyaoRelics?.makeRelic?.() || null; // Plain JSON record, retaining its exact enchantments across saves/retries.
    }
    return bundle;
  }

  function grantLoot(bundle, deps) {
    const parts = []; // Collected display names appended to the ordinary chest's loot toast.
    const maxStack = window.InventoryStacks?.MAX_TOTAL ?? 999;
    const giveStack = (key, fallback) => {
      if (!key) return;
      const before = Math.max(0, Number(deps.inventory[key]) || 0);
      deps.inventory[key] = Math.min(maxStack, before + 1);
      if (deps.inventory[key] > before) parts.push((deps.ITEM_DEFS[key]?.icon || '📜') + ' ' + (deps.ITEM_DEFS[key]?.label || fallback));
      return deps.inventory[key] - before;
    }; // Normal inventory caps and display definition are shared with ordinary treasure.

    if (bundle?.breedingPotionKey) {
      const count = giveStack(bundle.breedingPotionKey, 'Breeding Potion');
      window.AlchemySystem?.recordPotionAcquisition?.(bundle.breedingPotionKey, count || 0);
    }
    if (bundle?.masteryScrollKey) giveStack(bundle.masteryScrollKey, 'Mastery Scroll');
    if (bundle?.trinketKey) parts.push(...(window.TrinketSystem?.claimLoot?.({ [bundle.trinketKey]: 1 }, 'buried-treasure') || [])); // Trinkets are character gear, not inventory stacks.
    if (bundle?.enchantedRelic) {
      const key = window.HarlyaoRelics?.encodeBoundKey?.(bundle.enchantedRelic);
      if (key && window.HarlyaoRelics?.ensureBoundItemDef?.(key) && !(deps.inventory[key] > 0)) {
        deps.inventory[key] = 1; // Do not invoke grantBoundRelic: its early save would precede removal of the opened chest.
        parts.push('🗡️ ' + (deps.ITEM_DEFS[key]?.label || 'Bound Enchanted Weapon'));
      }
    }
    return parts;
  }

  window.BuriedTreasureTiers = Object.freeze({ TIERS, tier, rollTier, enhanceLoot, grantLoot });
})();
