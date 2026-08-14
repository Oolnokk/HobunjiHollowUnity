// Keeps selectable inventory-scroll entries semantically aligned with ITEM_DEFS.
//
// The item scroll intentionally owns presentation/context fields such as seedFor,
// while ITEM_DEFS owns categories/tags used by generic held-item action providers.
// This bridge merges only missing canonical metadata without replacing scroll-owned
// values, so food recognition and seed planting can share the normal action slots.
(() => {
  'use strict';

  if (window.HobunjiInventoryActionMetadataBridge) return;

  let lastDeps = null; // Used by manual refreshes after CookingSystem has received the host inventory registries.
  let lastSync = { ok: false, synced: 0, total: 0, missingDefinitions: 0 }; // Used by lightweight in-game/debug inspection.

  function syncInventoryEntries(injectedDeps = lastDeps) {
    if (!injectedDeps?.ITEM_DEFS || !Array.isArray(injectedDeps.inventoryItems)) {
      lastSync = { ok: false, synced: 0, total: 0, missingDefinitions: 0 };
      return { ...lastSync };
    }

    lastDeps = injectedDeps;
    let synced = 0; // Used to verify that selectable inventory entries were enriched from their canonical definitions.
    let missingDefinitions = 0; // Used to surface inventory-scroll entries that have no corresponding ITEM_DEFS record.

    for (const entry of injectedDeps.inventoryItems) {
      const definition = injectedDeps.ITEM_DEFS[entry?.key]; // Used to supply semantic fields such as cat/tags/isCookedFood to held-item action discovery.
      if (!definition) {
        missingDefinitions++;
        continue;
      }

      // Canonical metadata fills gaps; every pre-existing scroll field wins so
      // seedFor, icon/label presentation, max stack size, and future context
      // fields cannot be erased by this bridge.
      Object.assign(entry, { ...definition, ...entry });

      const semanticTags = Array.isArray(entry.tags) ? entry.tags : []; // Used to make canonical fish items count as ordinary edible food without changing ITEM_DEFS category/filter ownership.
      if (semanticTags.some(tag => String(tag).toLowerCase() === 'fish')
        && !semanticTags.some(tag => String(tag).toLowerCase() === 'food')) {
        entry.tags = [...semanticTags, 'Food'];
      }
      synced++;
    }

    lastSync = {
      ok: true,
      synced,
      total: injectedDeps.inventoryItems.length,
      missingDefinitions,
    };
    return { ...lastSync };
  }

  function patchCookingSystem(api) {
    if (!api?.init || api.__inventoryActionMetadataBridgePatched) return;

    const originalInit = api.init.bind(api); // Used to enrich entries immediately after CookingSystem registers all current ingredients/fish.
    api.init = function inventoryActionMetadataInit(injectedDeps = {}) {
      const result = originalInit(injectedDeps);
      syncInventoryEntries(injectedDeps);
      return result;
    };

    if (typeof api.registerIngredientItems === 'function') {
      const originalRegisterIngredientItems = api.registerIngredientItems.bind(api); // Used to keep later ingredient-registration passes synchronized too.
      api.registerIngredientItems = function inventoryActionMetadataRegisterIngredients(...args) {
        const result = originalRegisterIngredientItems(...args);
        syncInventoryEntries(lastDeps);
        return result;
      };
    }

    api.__inventoryActionMetadataBridgePatched = true;
  }

  function installCookingSystemHook() {
    if (window.CookingSystem) {
      patchCookingSystem(window.CookingSystem);
      return;
    }

    const descriptor = Object.getOwnPropertyDescriptor(window, 'CookingSystem'); // Used to preserve any pre-existing future-global getter/setter chain.
    if (descriptor && !descriptor.configurable) return;
    const previousGet = descriptor?.get; // Used when another module already owns CookingSystem reads.
    const previousSet = descriptor?.set; // Used when another module already owns CookingSystem assignment.
    let value = descriptor?.value; // Used as local storage when no earlier future-global setter exists.

    Object.defineProperty(window, 'CookingSystem', {
      configurable: true,
      get() {
        return previousGet ? previousGet.call(window) : value;
      },
      set(next) {
        if (previousSet) previousSet.call(window, next);
        else value = next;
        patchCookingSystem(previousGet ? previousGet.call(window) : value);
      },
    });
  }

  installCookingSystemHook();

  window.HobunjiInventoryActionMetadataBridge = {
    refresh: () => syncInventoryEntries(lastDeps),
    getDebug: () => ({ ...lastSync }),
  };
})();
