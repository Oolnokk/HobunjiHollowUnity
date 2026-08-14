// Keeps selectable inventory-scroll entries semantically aligned with ITEM_DEFS.
//
// The item scroll intentionally owns presentation/context fields such as seedFor,
// while ITEM_DEFS owns categories/tags used by generic held-item action providers.
// This bridge merges only missing canonical metadata without replacing scroll-owned
// values, so food recognition and seed planting can share the normal action slots.
(() => {
  'use strict';

  if (window.HobunjiInventoryActionMetadataBridge) return;

  let lastDeps = null; // Used by manual refreshes and mobile held-item actions after CookingSystem receives the host inventory registries.
  let targetingDeps = null; // Used by held-seed actions/reticle feedback to resolve the same target tile as the normal action system.
  let farmWorldDeps = null; // Used by direct mobile planting to preserve farm permissions, dirty-tile rebuilds, water updates, and layout saves.
  let plantReticleMesh = null; // Used to cache the farm's 1×0.06×1 wireframe reticle once it is identified in the scene.
  let plantReticleMaterial = null; // Used only while a held seed can actually be planted on the targeted tile.
  let lastPlantDebug = null; // Used by mobile-visible diagnostics to report the most recent direct seed action without developer tools.
  const plantPointers = new Map(); // Used to distinguish taps from the action-arch's existing drag-to-aim gesture.
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

  function hookFutureInit(globalName, marker, onInit) {
    function patch(api) {
      if (!api?.init || api[marker]) return;
      const originalInit = api.init.bind(api); // Used to preserve the owning module's init behavior while retaining the dependency bag this bridge needs.
      api.init = function inventoryActionAwareInit(injectedDeps = {}, ...rest) {
        const result = originalInit(injectedDeps, ...rest);
        onInit(injectedDeps);
        return result;
      };
      api[marker] = true;
    }

    if (window[globalName]) {
      patch(window[globalName]);
      return;
    }

    const descriptor = Object.getOwnPropertyDescriptor(window, globalName); // Used to chain rather than replace any previously installed future-global hook.
    if (descriptor && !descriptor.configurable) return;
    const previousGet = descriptor?.get; // Used to preserve earlier lazy/global read behavior.
    const previousSet = descriptor?.set; // Used to preserve earlier assignment hooks such as the alcohol bridge's FarmCrates hook.
    let value = descriptor?.value; // Used only when no earlier accessor owns storage.
    const readCurrent = next => previousGet ? previousGet.call(window) : (previousSet ? next : value);

    Object.defineProperty(window, globalName, {
      configurable: true,
      get() {
        return previousGet ? previousGet.call(window) : value;
      },
      set(next) {
        if (previousSet) previousSet.call(window, next);
        else value = next;
        patch(readCurrent(next));
      },
    });
  }

  function seedEntryForCrop(crop) {
    return lastDeps?.inventoryItems?.find(entry => entry?.seedFor === crop) || null;
  }

  function plantContext(action) {
    if (!/^plant_.+/.test(String(action || '')) || !lastDeps || !targetingDeps || !farmWorldDeps) {
      return { handled: false, ok: false, message: 'Planting bridge is not ready.' };
    }

    const crop = String(action).slice(6); // Used to keep the action id as the single source of truth for which seed is being planted.
    const seedEntry = seedEntryForCrop(crop); // Used to resolve the exact inventory stack registered for this crop.
    if (!seedEntry) return { handled: false, ok: false, message: `No seed entry is registered for ${crop}.` };

    const reticle = targetingDeps.getReticleTile?.(); // Used to make direct mobile planting target the exact same tile shown by the gameplay reticle.
    const tile = reticle ? targetingDeps.getActiveTileAt?.(reticle.col, reticle.row) : null; // Used as the authoritative mutable tile object.
    if (!reticle || !tile) return { handled: true, ok: false, crop, seedEntry, message: 'No planting tile is targeted.' };

    const area = targetingDeps.getCurrentArea?.(); // Used to prevent the mobile shortcut from creating farm crops in unrelated maps.
    if (area && area !== 'farm') {
      return { handled: true, ok: false, crop, seedEntry, reticle, tile, message: 'Seeds can only be planted on the farm.' };
    }

    if (farmWorldDeps.hasFarmPermission?.('plant') === false) {
      return { handled: true, ok: false, crop, seedEntry, reticle, tile, message: "Only the farm's owner (or a granted farmhand) can plant here." };
    }

    const count = Math.max(0, Number(lastDeps.inventory?.[seedEntry.key]) || 0); // Used to reject stale arch buttons after the last seed was consumed.
    if (count < 1) return { handled: true, ok: false, crop, seedEntry, reticle, tile, message: 'No seeds left.' };
    if (tile.crop) return { handled: true, ok: false, crop, seedEntry, reticle, tile, message: 'Something is already growing here.' };
    if (!['tilled', 'raised'].includes(tile.type)) {
      return { handled: true, ok: false, crop, seedEntry, reticle, tile, message: 'Can only plant on tilled or raised soil.' };
    }

    return { handled: true, ok: true, crop, seedEntry, reticle, tile, count };
  }

  function finishPlantContext(context) {
    if (!context?.handled) return context || { handled: false, ok: false };
    if (!context.ok) {
      lastDeps?.showToast?.(context.message, false);
      lastPlantDebug = {
        ok: false,
        action: context.crop ? `plant_${context.crop}` : null,
        crop: context.crop || null,
        col: context.reticle?.col ?? null,
        row: context.reticle?.row ?? null,
        tileType: context.tile?.type || null,
        message: context.message,
      };
      window.__farmLog?.(`[items] Mobile plant blocked: ${context.message}`, 'items');
      return context;
    }

    const { crop, seedEntry, reticle, tile } = context;
    lastDeps.inventory[seedEntry.key] = Math.max(0, (Number(lastDeps.inventory[seedEntry.key]) || 0) - 1);
    lastDeps.clampInventoryStack?.(seedEntry.key);
    tile.crop = crop;
    tile.cropAge = 0;
    tile.cropReady = false;
    tile.stress = '';

    // Mirror firePendingAction's successful farm mutation path so direct mobile
    // planting persists and rebuilds exactly like keyboard/controller planting.
    farmWorldDeps.recomputeWater?.(false);
    farmWorldDeps.markTileDirty?.(reticle.col, reticle.row);
    farmWorldDeps.saveFarmLayout?.();

    const canonical = lastDeps.ITEM_DEFS?.[seedEntry.key]; // Used to present a friendly planted-crop label while keeping the seed stack key unchanged.
    const seedLabel = canonical?.label || seedEntry.label || crop;
    const plantedLabel = String(seedLabel).replace(/\s+seeds?$/i, '') || crop;
    const message = `Planted ${canonical?.icon || seedEntry.icon || '🌱'} ${plantedLabel}.`;
    lastDeps.showToast?.(message, true);
    lastDeps.refreshItemScroll?.();
    lastDeps.buildInventoryGrid?.();
    lastDeps.refreshActionBar?.();
    lastDeps.saveMemberWorldData?.();

    lastPlantDebug = {
      ok: true,
      action: `plant_${crop}`,
      crop,
      seedKey: seedEntry.key,
      remaining: Math.max(0, Number(lastDeps.inventory[seedEntry.key]) || 0),
      col: reticle.col,
      row: reticle.row,
      tileType: tile.type,
      message,
    };
    window.__farmLog?.(`[items] Mobile plant: ${crop} @ c${reticle.col},r${reticle.row}; ${lastPlantDebug.remaining} seed(s) left`, 'items');
    return { ...context, message };
  }

  function tryPlantAction(action) {
    return finishPlantContext(plantContext(action));
  }

  function visiblePlantAction() {
    if (typeof document === 'undefined') return null;
    const ids = ['btnAction1', 'btnAction2', 'btnAction3', 'btnItemAction1', 'btnItemAction2']; // Used to mirror the five mobile-visible action-arch slots.
    for (const id of ids) {
      const button = document.getElementById(id);
      const action = button?.dataset?.action || '';
      if (button && !button.classList.contains('abt-hidden') && action.startsWith('plant_')) return action;
    }
    return null;
  }

  function reticleMeshFor(scene, reticle) {
    if (plantReticleMesh?.parent && plantReticleMesh.geometry?.parameters) return plantReticleMesh;
    if (!scene?.traverse || !reticle) return null;

    let found = null; // Used to find the unnamed base reticle mesh by its unique authored BoxGeometry dimensions and target position.
    scene.traverse(object => {
      if (found || !object?.isMesh || !object.geometry?.parameters) return;
      const p = object.geometry.parameters;
      if (Math.abs(Number(p.width) - 1) > 0.0001
        || Math.abs(Number(p.height) - 0.06) > 0.0001
        || Math.abs(Number(p.depth) - 1) > 0.0001
        || !object.material?.wireframe) return;
      if (Math.abs(Number(object.position?.x) - (reticle.col + 0.5)) > 0.05
        || Math.abs(Number(object.position?.z) - (reticle.row + 0.5)) > 0.05) return;
      found = object;
    });
    if (found) plantReticleMesh = found;
    return found;
  }

  function applyPlantReticleOverride(scene) {
    const action = visiblePlantAction();
    if (!action) return;
    const context = plantContext(action);
    if (!context.ok) return;

    const mesh = reticleMeshFor(scene, context.reticle);
    if (!mesh || !window.THREE?.MeshBasicMaterial) return;
    if (!plantReticleMaterial) {
      plantReticleMaterial = new window.THREE.MeshBasicMaterial({
        color: 0xf9e28a,
        wireframe: true,
        transparent: true,
        opacity: 0.85,
      }); // Used to show the normal valid-target gold instead of the stale active-tool red while seeds are selected.
    }
    mesh.material = plantReticleMaterial;
  }

  function installPlantReticleOverride() {
    const scene = farmWorldDeps?.scene;
    if (!scene || scene.__inventoryPlantReticleOverrideInstalled) return;
    const previousBeforeRender = scene.onBeforeRender; // Used to preserve any farm-scene render hook installed by another system.
    scene.onBeforeRender = function inventoryPlantReticleBeforeRender(...args) {
      previousBeforeRender?.apply(this, args);
      applyPlantReticleOverride(scene);
    };
    scene.__inventoryPlantReticleOverrideInstalled = true;
  }

  function syntheticPointerCleanup(button, sourceEvent) {
    if (!button || typeof button.dispatchEvent !== 'function') return;
    const wasHidden = button.classList.contains('abt-hidden'); // Used to suppress the original _abtUp -> _abtFire call while still letting it clear drag/pointer state.
    button.classList.add('abt-hidden');
    try {
      if (typeof PointerEvent === 'function') {
        button.dispatchEvent(new PointerEvent('pointercancel', {
          bubbles: true,
          cancelable: true,
          pointerId: sourceEvent.pointerId,
          pointerType: sourceEvent.pointerType || 'touch',
          clientX: sourceEvent.clientX,
          clientY: sourceEvent.clientY,
        }));
      }
    } finally {
      if (!wasHidden) button.classList.remove('abt-hidden');
    }
  }

  function touchLikePointer(event) {
    if (event?.pointerType === 'touch' || event?.pointerType === 'pen') return true;
    if (event?.pointerType === 'mouse') return false;
    return typeof matchMedia === 'function' ? matchMedia('(pointer: coarse)').matches : false;
  }

  function installMobilePlantPointerRoute() {
    if (typeof document === 'undefined' || document.__inventoryPlantPointerRouteInstalled) return;
    document.__inventoryPlantPointerRouteInstalled = true;

    document.addEventListener('pointerdown', event => {
      if (!event.isTrusted || !touchLikePointer(event)) return;
      const button = event.target?.closest?.('button.abt');
      if (!button?.dataset?.action?.startsWith('plant_')) return;
      plantPointers.set(event.pointerId, {
        button,
        x: Number(event.clientX) || 0,
        y: Number(event.clientY) || 0,
        moved: false,
      });
    }, true);

    document.addEventListener('pointermove', event => {
      const state = plantPointers.get(event.pointerId);
      if (!state || state.moved) return;
      const dx = (Number(event.clientX) || 0) - state.x;
      const dy = (Number(event.clientY) || 0) - state.y;
      if (Math.hypot(dx, dy) > 18) state.moved = true;
    }, true);

    document.addEventListener('pointercancel', event => {
      if (event.isTrusted) plantPointers.delete(event.pointerId);
    }, true);

    document.addEventListener('pointerup', event => {
      if (!event.isTrusted || !touchLikePointer(event)) return;
      const state = plantPointers.get(event.pointerId);
      plantPointers.delete(event.pointerId);
      if (!state || state.moved) return; // Preserve the existing action-arch drag-to-aim path unchanged.
      const button = event.target?.closest?.('button.abt') || state.button;
      const action = button?.dataset?.action || '';
      const context = plantContext(action);
      if (!context.handled) return;

      // Mobile taps on held-item actions must not inherit the previous tool's
      // swing cooldown. Swallow the native pointerup fire, clean its private
      // pointer state with a hidden synthetic cancel, then perform planting now.
      event.preventDefault();
      event.stopImmediatePropagation();
      syntheticPointerCleanup(button, event);
      finishPlantContext(context);
    }, true);
  }

  installCookingSystemHook();
  hookFutureInit('Fishing', '__inventoryPlantTargetingHooked', injectedDeps => {
    targetingDeps = injectedDeps;
    installPlantReticleOverride();
  });
  hookFutureInit('HousePieces', '__inventoryPlantFarmWorldHooked', injectedDeps => {
    farmWorldDeps = injectedDeps;
    installPlantReticleOverride();
  });
  installMobilePlantPointerRoute();

  window.HobunjiInventoryActionMetadataBridge = {
    refresh: () => syncInventoryEntries(lastDeps),
    tryPlantAction,
    getDebug: () => ({
      ...lastSync,
      plantingReady: !!(lastDeps && targetingDeps && farmWorldDeps),
      lastPlant: lastPlantDebug ? { ...lastPlantDebug } : null,
    }),
  };
})();
