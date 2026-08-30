(() => {
  'use strict';

  // Dye catalog (see docs/config/scratchbones-config.js game.dyes) — single
  // source of truth for every clothing dye color in the game. Character
  // creation's Collections tab, the redye system, the General Store's daily
  // clothing stock, and treasure-chest loot all draw from this same catalog
  // so a given dye always looks the same (exact hex, not an approximate CSS
  // filter) no matter where it came from.
  //
  // Extracted out of game.js following the same window.<Namespace> +
  // init(deps) pattern already used by js/bounty-board.js and
  // js/alchemy-system.js. gearInventory (unlike alchemy's `inventory`) is
  // reassigned wholesale on every player load (see game.js's
  // spawnPlayerAvatar), so it's threaded through as a getter — a plain
  // reference captured at init() time would go stale the moment game.js
  // swaps in a freshly loaded save. EquipmentPanel owns the redye UI and
  // consumes this module's catalog/ownership API instead of touching
  // gearInventory.dyeCollection directly.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  function getCatalog() {
    return window.SCRATCHBONES_CONFIG?.game?.dyes?.catalog || [];
  }
  function getById(dyeId) {
    return getCatalog().find(d => d.id === dyeId) || null;
  }
  // Trims a catalog entry down to the {h,s,v,hex,dyeId,label} shape
  // clothing items store on colorA/colorB (see makeClothingItem in
  // onboarding.js and EquipmentPanel's makeClothingGearEntry).
  function toClothingColor(dye) {
    if (!dye) return null;
    return { ...(dye.color || {}), hex: dye.hex, dyeId: dye.id, label: dye.label };
  }
  function ensureCollection() {
    const gearInventory = deps.getGearInventory();
    if (!gearInventory) return;
    if (!Array.isArray(gearInventory.dyeCollection)) {
      gearInventory.dyeCollection = [...(window.SCRATCHBONES_CONFIG?.game?.dyes?.starterDyeIds || [])];
    }
  }
  function owns(dyeId) {
    const gearInventory = deps.getGearInventory();
    return Array.isArray(gearInventory?.dyeCollection) && gearInventory.dyeCollection.includes(dyeId);
  }
  function unlock(dyeId) {
    ensureCollection();
    const gearInventory = deps.getGearInventory();
    if (gearInventory.dyeCollection.includes(dyeId)) return false;
    gearInventory.dyeCollection.push(dyeId);
    deps.saveGearInventory();
    return true;
  }
  function ownedByHue(articleDyeIds = []) {
    const localDyeIds = new Set(Array.isArray(articleDyeIds) ? articleDyeIds : []); // Used only to add this article's learned shades to the redye picker.
    const groups = new Map();
    for (const dye of getCatalog()) {
      if (!owns(dye.id) && !localDyeIds.has(dye.id)) continue;
      const groupKey = dye.neutral ? 'neutral' : dye.hueFamilyId;
      const groupLabel = dye.neutral ? 'Neutral' : dye.hueFamily;
      if (!groups.has(groupKey)) groups.set(groupKey, { id: groupKey, label: groupLabel, dyes: [] });
      groups.get(groupKey).dyes.push(dye);
    }
    for (const group of groups.values()) group.dyes.sort((a, b) => a.sortOrder - b.sortOrder);
    return [...groups.values()];
  }

  window.DyeSystem = {
    init,
    getCatalog,
    getById,
    toClothingColor,
    ensureCollection,
    owns,
    unlock,
    ownedByHue,
  };
})();
