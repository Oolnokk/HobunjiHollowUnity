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
      if (shopData?.shops) { _shopStock = shopData.shops; deps.applyLoadedShopStock(); }
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
  function rollLootPool(poolId) {
    const pool = _lootPools[poolId];
    if (!pool) return {};
    const world = _lootShopWorldState();
    const eligible = window.ConditionRegistry.rollIndependentEligible(pool.entries || [], world);
    const gained = {};
    for (const entry of eligible) {
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
  };
})();
