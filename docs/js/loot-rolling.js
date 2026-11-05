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
  let lastMixedRoll = null; // Mobile-readable source selection and empty-source exclusions for authored mixed pools.

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
  function rollLootPool(poolId, context = {}, ancestry = []) {
    const pool = _lootPools[poolId];
    // Shared composition is data-driven so later puzzle-cave tables can be
    // populated without touching Tzatzul AI or making new loot grant paths.
    if (pool?.kind === 'exclusive') {
      // Puzzle-cave trinkets are an actual one-of-N reward, not 13 independent
      // Bernoulli rolls (which could otherwise award zero or multiple trinkets).
      const desiredTier = Math.max(1,Math.min(5,Math.floor(Number(context.rewardTier) || 1))); // Song difficulty determines this cave's reward band.
      const definitions = window.TrinketSystem?.DEFINITIONS || {}; // Prevent the mixed source from giving unknown items before the dependent trinket PR is loaded.
      const entries = (pool.entries || []).filter(entry => entry?.itemKey &&
        (entry.tier == null || Number(entry.tier) === desiredTier) &&
        Number(entry.weight ?? 1) > 0 && (poolId !== 'puzzleCave' || !!definitions[String(entry.itemKey).replace(/^trinket_/, '')]));
      if (!entries.length) return {};
      const totalWeight = entries.reduce((sum,entry) => sum+Number(entry.weight ?? 1),0); // Stable configured probability mass.
      const random = typeof context.random === 'function' ? context.random :
        () => window.GameRandom?.random?.() ?? Math.random();
      let pick = Math.max(0,Math.min(.999999999,Number(random()) || 0))*totalWeight;
      for(const entry of entries){
        pick-=Number(entry.weight ?? 1);
        if(pick<0)return {[entry.itemKey]:1};
      }
      return {[entries[entries.length-1].itemKey]:1};
    }
    if (pool?.kind === 'mixed') {
      const parentIds = Array.isArray(ancestry) ? ancestry : []; // Recursion guard; cyclic edited tables never hang the game.
      if (parentIds.includes(poolId) || parentIds.length >= 8) return {};
      const sources = (Array.isArray(pool.sourcePools) ? pool.sourcePools : [])
        .filter(source => source && typeof source.poolId === 'string' && source.poolId !== poolId
          && !parentIds.includes(source.poolId) && Number.isFinite(Number(source.weight))
          && Number(source.weight) > 0 && _lootPools[source.poolId]
          && (_lootPools[source.poolId].kind === 'mixed'
            || Array.isArray(_lootPools[source.poolId].entries) && _lootPools[source.poolId].entries.length > 0));
      const gained = {}; // Flat inventory stacks; the caller's clothingDrops side-channel stores rich garment records.
      const selected = []; // Bound-sized diagnostics for test UI / mobile.
      const draws = Math.max(0, Math.min(10, Math.floor(Number(pool.rolls) || 1)));
      const random = typeof context.random === 'function' ? context.random
        : () => window.GameRandom?.random?.() ?? Math.random();
      const total = sources.reduce((sum, source) => sum + Number(source.weight), 0);
      for (let draw = 0; draw < draws && total > 0; draw++) {
        let remaining = Math.max(0, Math.min(0.999999999, Number(random()) || 0)) * total;
        let source = sources[sources.length - 1]; // Floating-point fallback preserves last source's weight.
        for (const candidate of sources) {
          remaining -= Number(candidate.weight);
          if (remaining < 0) { source = candidate; break; }
        }
        selected.push(source.poolId);
        const rolled = rollLootPool(source.poolId, context, [...parentIds, poolId]);
        for (const [itemKey, amount] of Object.entries(rolled || {}))
          if (Number.isFinite(Number(amount)) && Number(amount) > 0)
            gained[itemKey] = (gained[itemKey] || 0) + Number(amount);
      }
      lastMixedRoll = { poolId, selected, availableSources: sources.map(source => source.poolId),
        deferredSources: (Array.isArray(pool.sourcePools) ? pool.sourcePools : []).map(source => source?.poolId)
          .filter(id => id && !sources.some(source => source.poolId === id)),
        rolledItems: Object.keys(gained).length }; // No persistent entity references or expensive per-frame scanning.
      return gained;
    }
    if (poolId === 'treasureChest' && typeof window.WildTreasure?.rollTreasureLootAsItems === 'function') {
      const generated = window.WildTreasure.rollTreasureLootAsItems(context); // Full wilderness chest bundle only with fully initialized world data.
      if (generated && typeof generated === 'object') return generated;
    } // Pre-bootstrap and isolated dungeon callers retain the original flat-entry fallback.
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
    getMixedLootDebug: () => lastMixedRoll && { ...lastMixedRoll, selected: [...lastMixedRoll.selected],
      availableSources: [...lastMixedRoll.availableSources], deferredSources: [...lastMixedRoll.deferredSources] },
    masteryPoolForLoot, rollMasteryPool,
    getMasteryDebug: () => ({ lastRoll: lastMasteryRoll && { ...lastMasteryRoll }, pools: Object.entries(_lootPools).filter(([, pool]) => pool.mastery).map(([id, pool]) => ({ id, ...pool.mastery })) }),
  };
})();
