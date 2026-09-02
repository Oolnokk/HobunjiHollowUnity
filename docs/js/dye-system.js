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
  let deps = null; // Used for the live character gear inventory and gear-save path.
  let itemDeps = null; // Used by mystery-dye item registration, held-item actions, inventory refreshes, and world saves.
  let lastDyeItemEvent = null; // Used by mobile-friendly debug inspection without requiring a browser console.

  const MYSTERY_DYE_POOL_ICONS = {
    red: '🔴', orange: '🟠', yellow: '🟡', green: '🟢', blue: '🔵', indigo: '🟣', violet: '🟪',
  }; // Used as the fallback inventory icon for each authored mystery-dye pool.

  function init(injectedDeps) {
    deps = injectedDeps;
    captureItemDeps(injectedDeps);
  }

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
    const gearInventory = deps?.getGearInventory?.(); // Used as the currently loaded character's authoritative gear record.
    if (!gearInventory) return;
    if (!Array.isArray(gearInventory.dyeCollection)) {
      gearInventory.dyeCollection = [...(window.SCRATCHBONES_CONFIG?.game?.dyes?.starterDyeIds || [])];
    }
  }
  function owns(dyeId) {
    const gearInventory = deps?.getGearInventory?.(); // Used to test ownership against the currently loaded character rather than a stale captured object.
    return Array.isArray(gearInventory?.dyeCollection) && gearInventory.dyeCollection.includes(dyeId);
  }
  function unlock(dyeId) {
    ensureCollection();
    const gearInventory = deps?.getGearInventory?.(); // Used as the mutation target after ensureCollection has initialized the live collection.
    if (!gearInventory || !Array.isArray(gearInventory.dyeCollection) || gearInventory.dyeCollection.includes(dyeId)) return false;
    gearInventory.dyeCollection.push(dyeId);
    deps?.saveGearInventory?.();
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

  function mysteryPools() {
    return window.SCRATCHBONES_CONFIG?.game?.dyes?.mysteryPools || [];
  }
  function mysteryItemKeyForPool(pool) {
    const id = String(pool?.id || ''); // Used to reproduce the legacy mystery-dye inventory key format expected by treasure and existing saves.
    return id ? 'mysteryDye' + id.charAt(0).toUpperCase() + id.slice(1) : '';
  }
  function mysteryItemKeyByPool() {
    const map = {}; // Used by treasure/fishing integrations and diagnostics as the canonical pool-id -> item-key mapping.
    mysteryPools().forEach(pool => { map[pool.id] = mysteryItemKeyForPool(pool); });
    return map;
  }
  function mysteryPoolForItemKey(key, def = null) {
    const configuredId = def?.mysteryDyePoolId; // Used to prefer explicit registered metadata when available.
    if (configuredId) return mysteryPools().find(pool => pool.id === configuredId) || null;
    return mysteryPools().find(pool => mysteryItemKeyForPool(pool) === key) || null;
  }

  function registerMysteryDyeItems(sourceDeps) {
    if (!sourceDeps?.ITEM_DEFS || !Array.isArray(sourceDeps.inventoryItems)) return;
    mysteryPools().forEach(pool => {
      const key = mysteryItemKeyForPool(pool); // Used as the persistent inventory stack key for this authored dye pool.
      if (!key) return;
      const old = sourceDeps.ITEM_DEFS[key] || {}; // Used to preserve any newer authored icon/economy/text overrides.
      const icon = old.icon || MYSTERY_DYE_POOL_ICONS[pool.id] || '🎨'; // Used by inventory UI and the held Item Action prompt.
      sourceDeps.ITEM_DEFS[key] = {
        ...old,
        icon,
        label: old.label || pool.label || 'Mystery Dye',
        cat: old.cat || 'dye',
        sellPrice: old.sellPrice ?? Math.floor((window.SCRATCHBONES_CONFIG?.game?.dyes?.mysteryDyePrice || 35) * 0.4),
        tags: [...new Set([...(old.tags || []), 'Dye', 'Mystery', 'Consumable', ...(pool.hueFamilies || [])])],
        desc: old.desc || `${pool.description || 'A sealed packet of unknown dye.'} Use it to permanently unlock one new dye shade from this family.`,
        mysteryDyePoolId: pool.id,
      };
      if (!sourceDeps.inventoryItems.some(item => item.key === key)) {
        sourceDeps.inventoryItems.push({ key, icon, label: String(pool.label || 'Mystery Dye').toUpperCase(), max: 9 });
      }
    });
    window.HobunjiInventoryActionMetadataBridge?.refresh?.();
  }

  function captureItemDeps(sourceDeps) {
    if (!sourceDeps || typeof sourceDeps !== 'object') return;
    itemDeps = { ...itemDeps, ...sourceDeps };
    registerMysteryDyeItems(itemDeps);
  }

  function heldMysteryDye() {
    if (itemDeps?.getHeldMode?.() != null && itemDeps.getHeldMode() !== 'item') return null;
    const active = itemDeps?.getActiveInventoryItem?.(); // Used as the authoritative selected held inventory entry shared by desktop/controller/mobile.
    const key = active?.key; // Used to resolve both its item definition and mystery-dye pool.
    if (!key || !(Number(itemDeps?.inventory?.[key]) > 0)) return null;
    const def = itemDeps?.ITEM_DEFS?.[key] || active; // Used for registered dye metadata and the action-bar label/icon.
    const pool = mysteryPoolForItemKey(key, def); // Used to distinguish mystery dyes from ordinary held materials and consumables.
    return pool ? { key, def, pool } : null;
  }

  function useMysteryDye(key) {
    const def = itemDeps?.ITEM_DEFS?.[key] || null; // Used to resolve explicit pool metadata when this item was registered through a dependency bag.
    const pool = mysteryPoolForItemKey(key, def); // Used to define which hue families this item may unlock.
    if (!pool || !(Number(itemDeps?.inventory?.[key]) > 0)) {
      return { ok: false, message: 'No mystery dye to use.' };
    }
    const candidates = getCatalog().filter(dye => !dye.neutral
      && (pool.hueFamilies || []).includes(dye.hueFamily)
      && !owns(dye.id)); // Used to ensure the item always grants a genuinely new global shade.
    if (!candidates.length) {
      return { ok: false, message: `You already own every dye ${pool.label || 'this mystery dye'} can grant.` };
    }
    const dye = candidates[Math.floor(Math.random() * candidates.length)]; // Used as the single newly unlocked shade for this consumed item.
    if (!unlock(dye.id)) return { ok: false, message: 'That dye could not be unlocked.' };
    itemDeps.inventory[key] = Math.max(0, Number(itemDeps.inventory[key]) - 1);
    itemDeps.clampInventoryStack?.(key);
    lastDyeItemEvent = { type: 'unlock', itemKey: key, poolId: pool.id, dyeId: dye.id, dyeLabel: dye.label, at: Date.now() };
    return { ok: true, dyeId: dye.id, message: `Unlocked ${dye.label} for your dye collection!` };
  }

  function refreshAfterDyeUse() {
    itemDeps?.refreshItemScroll?.();
    itemDeps?.buildInventoryGrid?.();
    itemDeps?.refreshActionBar?.();
    itemDeps?.saveMemberWorldData?.();
  }
  function consumeHeldMysteryDye() {
    const held = heldMysteryDye(); // Used to revalidate the live selection/stack at the exact moment Item Action 1 fires.
    if (!held) return false;
    const result = useMysteryDye(held.key); // Used as the one mutation path for both held actions and any future inventory-panel Use button.
    itemDeps?.showToast?.(result.message, result.ok);
    if (result.ok) refreshAfterDyeUse();
    return result.ok;
  }

  function patchHeldActions(api) {
    if (!api?.getHeldItemAction || !api?.consumeHeldItem || api.__dyeItemsPatched) return;
    const getAction = api.getHeldItemAction.bind(api); // Used to preserve food, drink, alchemy, and technique-scroll actions when no dye is held.
    const consume = api.consumeHeldItem.bind(api); // Used as the fallback mutation path for every non-dye consumable.
    api.getHeldItemAction = () => {
      const held = heldMysteryDye(); // Used to expose mystery dye through the same configurable Item Action 1 path as other consumables.
      return held
        ? { icon: held.def.icon || '🎨', label: `Use ${held.def.label || 'Mystery Dye'}`, action: 'consume_held_item', style: 'primary', allowed: true }
        : getAction();
    };
    api.consumeHeldItem = () => heldMysteryDye() ? consumeHeldMysteryDye() : consume();
    api.__dyeItemsPatched = true;
  }

  function futureGlobal(name, patch) {
    if (window[name]) { patch(window[name]); return; }
    const descriptor = Object.getOwnPropertyDescriptor(window, name); // Used to preserve compatibility setters already installed by other runtime bridges.
    if (descriptor && !descriptor.configurable) return;
    const previousGet = descriptor?.get, previousSet = descriptor?.set; // Used to chain prior lazy-global behavior instead of replacing it.
    let value = descriptor?.value; // Used only when no previous accessor owns storage.
    Object.defineProperty(window, name, {
      configurable: true,
      enumerable: descriptor?.enumerable ?? true,
      get() { return previousGet ? previousGet.call(window) : value; },
      set(next) {
        if (previousSet) previousSet.call(window, next); else value = next;
        patch(previousGet ? previousGet.call(window) : (previousSet ? next : value));
      },
    });
  }
  function hookItemInit(name) {
    futureGlobal(name, api => {
      if (!api?.init || api.__dyeItemHooked) return;
      const originalInit = api.init.bind(api); // Used to preserve the owning system's initialization while capturing its item-capable dependency bag.
      api.init = (sourceDeps, ...rest) => {
        const result = originalInit(sourceDeps, ...rest); // Used as the original system's return value after normal initialization.
        captureItemDeps(sourceDeps);
        return result;
      };
      api.__dyeItemHooked = true;
    });
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
    mysteryItemKeyForPool,
    mysteryItemKeyByPool,
    registerMysteryDyeItems,
    useMysteryDye,
    getDebug() {
      const held = heldMysteryDye(); // Used to make the live mobile-selected dye state inspectable without devtools.
      return {
        itemDepsReady: !!itemDeps?.inventory,
        heldItemKey: held?.key || null,
        heldPoolId: held?.pool?.id || null,
        lastDyeItemEvent: lastDyeItemEvent ? { ...lastDyeItemEvent } : null,
        itemKeyByPool: mysteryItemKeyByPool(),
      };
    },
  };

  futureGlobal('HobunjiDrunkGameplayBridge', patchHeldActions);
  hookItemInit('CookingSystem');
  hookItemInit('FarmCrates');
})();
