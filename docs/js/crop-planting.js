(() => {
  'use strict';

  // Seed planting and crop harvesting on a single tile, extracted out of
  // game.js following the same window.<Namespace> + init(deps) pattern as
  // js/loot-rolling.js. `inventory` and `cropData` are game.js `const`s only
  // ever mutated in place, so direct references are safe; canPlantCropOnTile
  // and clampInventoryStack stay in game.js (other farm code shares them).
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  function plantCrop(tile, crop) {
    const data = deps.cropData[crop];
    if (!data) return { ok: false, message: 'Unknown crop.' };
    // A spent seed stack is deleted (clampInventoryStack), and
    // `undefined <= 0` is false — so the count is normalized first, or the
    // last seed could be "planted" forever while the stack turns into NaN.
    if ((Number(deps.inventory[data.seedKey]) || 0) <= 0) return { ok: false, message: `No ${data.label} seeds left.` };
    if (tile.crop) return { ok: false, message: 'Something is already growing here.' };
    if (!deps.canPlantCropOnTile(crop, tile))
      return { ok: false, message: 'Can only plant on tilled or raised soil.' };
    deps.inventory[data.seedKey]--;
    deps.clampInventoryStack(data.seedKey);
    tile.crop = crop;
    tile.cropAge = 0;
    tile.cropReady = false;
    tile.stress = '';
    const idealPct = Math.round(data.idealMin * 100) + '–' + Math.round(data.idealMax * 100);
    const ditchNote = data.needsAdjacentDitch ? ' Grows well beside adjacent ditches.' : '';
    return { ok: true, message: `Planted ${data.emoji} ${data.label}. Ideal water: ${idealPct}%.${ditchNote}` };
  }

  function harvestCrop(tile) {
    if (!tile.crop) return { ok: false, message: 'Nothing to harvest here.' };
    if (!tile.cropReady) return { ok: false, message: `${tile.crop} isn't ready yet.` };
    const data = deps.cropData[tile.crop];
    // Bountiful Harvest (Farming perk): a chance for one extra crop unit
    // from the same harvest, capped well below Foraging/Mining's yield
    // perks since processed goods already amplify quality economically.
    const bonusChance = Math.min(0.3, (window.PerkSystem?.rank('farming', 'bountifulHarvest') || 0) * 0.06);
    const amount = 1 + ((window.GameRandom?.random?.() ?? Math.random()) < bonusChance ? 1 : 0);
    deps.inventory[data.cropKey] = Math.min(window.InventoryStacks.MAX_TOTAL, (deps.inventory[data.cropKey] || 0) + amount);
    const stars = window.LootRolling.rollItemStars('farming');
    window.CookingSystem.recordItemQuality(data.cropKey, stars, amount);
    window.SkillSystem?.award?.('farming', window.SkillSystem?.XP_GAINS?.crop || 10, `harvested ${data.label}`);
    window.HobunjiActivityEvents?.emit('crop_harvested', { cropKey: data.cropKey, label: data.label });
    const msg = `Harvested ${window.LootRolling.starRatingText(stars)} ${data.emoji} ${data.label}${amount > 1 ? ` ×${amount}` : ''}!`;
    tile.crop = deps.CropType.NONE;
    tile.fertilized = false; // Fertilizer is consumed by this harvest, never carried into the next planting.
    tile.cropAge = 0;
    tile.cropReady = false;
    tile.stress = '';
    window.AudioSystem?.playObjectSfx(window.AudioSystem?.objectSfxConfig().harvest);
    return { ok: true, message: msg };
  }

  window.CropPlanting = { init, plantCrop, harvestCrop };
})();
