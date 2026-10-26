(() => {
  'use strict';

  // Loot-pool/shop-stock config loading and item-quality rolling, extracted
  // out of game.js following the same window.<Namespace> + init(deps)
  // pattern as js/dye-system.js. _lootPools/_shopStock move here entirely
  // (this module owns the fetch that produces them) — game.js's own
  // _applyLoadedShopStock and every other module that used to read the old
  // game.js-local _shopStock/_lootPools closures now go through
  // getShopStock()/getLootPools() instead.
  //
  // currentArea/_playerData are game.js `let`s reassigned elsewhere, so
  // they're threaded through as getters; calendar is a `const` only ever
  // mutated in place, so a direct reference is safe.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  let _lootPools = {};
  let _shopStock = {};
  let _lootShopConfigPromise = null;
  let lastMasteryRoll = null; // Exposed through the existing diagnostics for mobile inspection of source, rank, type and outcome.

  function masteryPoolForLoot(poolId, context = {}) {
    const entity = context.entity; // Actual corpse supplies its weapon and semantic enemy type, rather than the inherited bandit loot table.
    const area = context.zoneId || entity?.areaId || deps?.getCurrentArea?.(); // Resolve interior caves back to their wilderness zone through the existing owners.
    const zone = window.CaveSiteSystem?.profileForMapId?.(area)?.zoneId || window.WildlifeSpawn?.denCavernZoneOf?.(area) || area; // Cave ids must not be split on underscores.
    if (context.masterySource === 'caveCache' || poolId === 'caveSkeletonBody') return `mastery_cave_${zone}`;
    if (entity?.isHarlyaoLich) return `mastery_lich_${entity.ruinTheme || entity.lichType}`;
    if (entity?.isDenMother || /den-mother$/.test(poolId || '')) return `mastery_den_${zone}`;
    const species = entity?.rosterRecord?.appearance?.speciesId || entity?.avatarRef?.speciesId || entity?.speciesId; // Shared humanoid combat shells retain species on their roster.
    if (species === 'ghoul') return 'mastery_ghoul';
    if (species?.includes('skeleton')) return 'mastery_skeleton';
    if (poolId === 'banditTent') return 'mastery_tent';
    if (poolId?.startsWith('dungeonChest_tier')) {
      const theme = context.theme || window.DevRandomRuin?.getState?.()?.theme; // Every ruin chest reads the same theme that selected the lich.
      return theme ? `mastery_${context.boss ? 'final' : 'ruin'}_${theme}` : null;
    }
    if (entity && entity.enemyClass !== 'bandit') return null;
    if (poolId === 'bandit_captain') return 'mastery_captain';
    return poolId?.startsWith('bandit_') ? 'mastery_bandit' : null;
  }

  function rollMasteryPool(poolId, context = {}) {
    const config = _lootPools[poolId]?.mastery; // Authored source chance, rank weights and apportioned effect ids live beside the ordinary loot pools.
    if (!config) return {};
    const random = context.random || (() => window.GameRandom?.random?.() ?? Math.random()); // Seeded callers can supply the same event RNG as their other loot.
    if (random() >= config.chance) { lastMasteryRoll = { poolId, dropped: false }; return {}; }
    const ranks = Object.entries(config.rankWeights).filter(([, weight]) => Number(weight) > 0); // Weighted rank is rolled only after the single per-source drop chance succeeds.
    let roll = random() * ranks.reduce((sum, [, weight]) => sum + Number(weight), 0); // Unnormalized weights preserve the captain's stated 66:33 ratio.
    let rank = Number(ranks.at(-1)?.[0]); // Rounding-safe fallback for the final weighted bucket.
    for (const [value, weight] of ranks) { roll -= Number(weight); if (roll < 0) { rank = Number(value); break; } }
    const entity = context.entity; // A character enemy's melee weapon controls blunt versus sharp; liches instead use their theme family.
    const weaponType = context.damageType || (entity && !entity.isHarlyaoLich ? deps?.weaponDamageTypeForTool?.(entity.def?.weaponKey) || entity.def?.attackTag : null); // Reuse the canonical tool definition lookup, with the combat definition as a fallback.
    const type = ['sharp', 'blunt'].includes(weaponType) ? weaponType : random() < 0.5 ? 'sharp' : 'blunt'; // Containers and non-weapon creatures can supply either damage type.
    const options = config.effects?.[rank]?.[type] || []; // No cross-pool fallback: a source never silently awards another activity's exclusive effect.
    const effectId = options[Math.min(options.length - 1, Math.floor(random() * options.length))]; // One concrete effect+rank+damage-type item, never a generic random-unlock scroll.
    if (!effectId) { lastMasteryRoll = { poolId, rank, type, error: 'Empty authored mastery pool' }; return {}; }
    const key = window.CombatProgression?.itemKey?.(type, rank, effectId, config.form); // Ordinary inventory persistence stores all lesson metadata in the stable item key.
    lastMasteryRoll = { poolId, rank, type, effectId, theme: config.theme || null, key, dropped: !!key };
    window.__farmLog?.(`[mastery loot] ${JSON.stringify(lastMasteryRoll)}`, 'combat');
    return key ? { [key]: 1 } : {};
  }

  function syncGeneralStoreSellerIds() {
    const shopButton = window.SCRATCHBONES_CONFIG?.game?.mobileControls?.generalStoreButton; // Used to keep the contextual Shop action aligned with authored shop sellers.
    if (!shopButton) return;
    const sellerIds = Array.isArray(shopButton.npcIds) ? shopButton.npcIds : (shopButton.npcIds = []); // Mutated in place so any already-captured button config sees newly loaded sellers.
    Object.values(_shopStock).forEach(shop => {
      if (shop?.menuId !== 'generalStore') return;
      const authoredSellerIds = Array.isArray(shop?.dialogueAccess?.sellerIds) ? shop.dialogueAccess.sellerIds : []; // Used to add every seller for shops rendered through the General Store surface.
      authoredSellerIds.forEach(npcId => {
        if (npcId && !sellerIds.includes(npcId)) sellerIds.push(npcId);
      });
    });
  }

  function loadLootShopConfig() {
    if (_lootShopConfigPromise) return _lootShopConfigPromise;
    // Routed through window.LocalDBOverrides.loadDatabase() (see
    // docs/js/local-db-overrides.js) so the onboarding "Database Source"
    // toggle can swap in a locally-saved loot-shop-editor edit of either
    // file without touching the repo copy — falls back to a direct fetch
    // if that module somehow isn't loaded.
    const loadOne = (id, path) => (window.LocalDBOverrides ? window.LocalDBOverrides.loadDatabase(id) : fetch(path).then(r => r.ok ? r.json() : null)).catch(() => null);
    _lootShopConfigPromise = Promise.all([
      loadOne('lootPools', 'config/loot/loot-pools.json'),
      loadOne('shopStock', 'config/shops/shop-stock.json'),
    ]).then(([lootData, shopData]) => {
      _lootPools = lootData?.pools || {};
      if (shopData?.shops) {
        _shopStock = shopData.shops;
        syncGeneralStoreSellerIds();
        deps.applyLoadedShopStock();
      }
    });
    return _lootShopConfigPromise;
  }

  // The subset of the dialogue system's shared condition axes (see
  // docs/js/condition-registry.js) that make sense for loot/shop gating
  // outside of an NPC conversation — no relationship/encounter/station
  // concept here, so those axes are simply never supplied/checked.
  function _lootShopWorldState() {
    return {
      weekdays: window.CalendarSystem.currentWeekdayName(),
      seasons: window.CalendarSystem.currentSeason().name,
      weather: deps.calendar.weather,
      timesOfDay: window.Fishing.timeOfDay(),
      maps: deps.getCurrentArea(),
      playerSpecies: deps.getPlayerData()?.appearance?.speciesId || '',
    };
  }

  // Rolls a docs/config/loot/loot-pools.json pool by id: every entry is
  // independently checked against its conditions and its own `chance`
  // (default 1 = always, matching every migrated creature/bandit table),
  // then contributes a `min..max` quantity (or a `min..max` in steps of
  // `step`, for discrete-increment rolls like the treasure chest's gold).
  function rollLootPool(poolId, context = {}) {
    const pool = _lootPools[poolId];
    if (pool?.mastery) return rollMasteryPool(poolId, context);
    const masteryPool = masteryPoolForLoot(poolId, context); // Select the semantic source before ordinary pool inheritance obscures its identity.
    if (!pool) return masteryPool ? rollMasteryPool(masteryPool, context) : {};
    const world = _lootShopWorldState();
    const eligible = window.ConditionRegistry.rollIndependentEligible(pool.entries || [], world);
    const gained = {};
    for (const entry of eligible) {
      if (entry.kind === 'generator' && entry.generatorKey === 'harlyaoArtifact') {
        const artifacts = window.ArtifactCollection?.rollArtifacts?.(entry.tier) || {}; // Configured guaranteed batch of weighted Harlyao artifacts, alongside existing optional loot.
        for (const [key, qty] of Object.entries(artifacts)) gained[key] = (gained[key] || 0) + qty;
        continue;
      }
      if (entry.kind === 'generator' && entry.generatorKey === 'dungeonMetalBars' && poolId.startsWith('dungeonChest_tier')) {
        const bars = window.WildTreasure?.rollTreasureMetalBarLoot?.() || {}; // Shared buried-treasure picker respects Town Value and prefers lower-tier metals.
        for (const [key, qty] of Object.entries(bars)) if (qty > 0) gained[key] = (gained[key] || 0) + qty;
        continue;
      }
      if (!entry.itemKey) continue; // generator-only entries (see treasureChest) are rolled by name, not through this generic path
      const min = entry.min || 0, max = entry.max != null ? entry.max : min;
      let qty;
      if (entry.step) {
        const steps = Math.floor((max - min) / entry.step) + 1;
        qty = min + Math.floor(window.GameRandom.random() * steps) * entry.step;
      } else {
        qty = min + Math.floor(window.GameRandom.random() * (max - min + 1));
      }
      if (qty > 0) gained[entry.itemKey] = (gained[entry.itemKey] || 0) + qty;
    }
    if (masteryPool) Object.assign(gained, rollMasteryPool(masteryPool, context));
    return gained;
  }

  // Shared 1-5 star quality roll — fish, harvested crops, and butchered
  // meat all use this. Weighted toward the middle (3 stars most common)
  // rather than a flat 20% each, so it doesn't feel like a coin flip;
  // otherwise deliberately simple/random for now, no per-item tuning.
  function rollItemStars(skillKey) {
    return window.SkillSystem?.rollQuality(skillKey) || 3;
  }

  function starRatingText(stars) {
    return window.SkillSystem?.starRatingText(stars) || '★'.repeat(stars) + '☆'.repeat(5 - stars);
  }

  window.LootRolling = {
    init, loadLootShopConfig, rollLootPool, rollItemStars, starRatingText,
    lootShopWorldState: _lootShopWorldState,
    getLootPools: () => _lootPools,
    getShopStock: () => _shopStock,
    masteryPoolForLoot, rollMasteryPool,
    getMasteryDebug: () => ({ lastRoll: lastMasteryRoll && { ...lastMasteryRoll }, pools: Object.entries(_lootPools).filter(([, pool]) => pool.mastery).map(([id, pool]) => ({ id, ...pool.mastery })) }),
  };
})();
