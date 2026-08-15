// Keeps selectable inventory-scroll entries semantically aligned with ITEM_DEFS
// and owns crop actions that must not enter the equipped-tool strike queue.
//
// Plant/Harvest are contextual item interactions. game.js's generic action path
// queues ordinary actions into pendingAction for updateToolMesh() to fire at a
// tool strike. That cannot complete while heldMode === 'item', because
// updateToolMesh() deliberately returns early to render the held bag item.
// The visible action buttons are therefore intercepted here before their native
// pointerup handler and Plant/Harvest are applied immediately.
(() => {
  'use strict';

  if (window.HobunjiInventoryActionMetadataBridge) return;

  let lastDeps = null; // Used by metadata sync and immediate crop actions after CookingSystem receives the host inventory registries.
  let targetingDeps = null; // Used by crop actions/reticle feedback to resolve the exact tile currently targeted by the normal action system.
  let farmWorldDeps = null; // Used by crop actions to preserve farm permissions, tile rebuilds, water updates, and layout saves.
  let plantReticleMesh = null; // Used to cache the farm's 1×0.06×1 wireframe reticle once it is identified in the scene.
  let plantReticleMaterial = null; // Used only while a held seed can actually be planted on the targeted tile.
  let lastCropDebug = null; // Used by mobile-friendly diagnostics to report the most recent immediate Plant/Harvest action.
  const cropPointers = new Map(); // Used to distinguish action-button taps from the existing drag-to-aim gesture on every pointer type.
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

  function isCropAction(action) {
    const id = String(action || '');
    return id === 'harvest' || id.startsWith('plant_');
  }

  function seedEntryForCrop(crop) {
    return lastDeps?.inventoryItems?.find(entry => entry?.seedFor === crop) || null;
  }

  function targetedCropTile() {
    const reticle = targetingDeps?.getReticleTile?.(); // Used to share the normal gameplay reticle instead of inventing a second target calculation.
    const tile = reticle ? targetingDeps?.getActiveTileAt?.(reticle.col, reticle.row) : null; // Used as the authoritative mutable crop tile.
    return { reticle, tile, area: targetingDeps?.getCurrentArea?.() || null };
  }

  function plantContext(action) {
    if (!String(action || '').startsWith('plant_') || !lastDeps || !targetingDeps || !farmWorldDeps) {
      return { handled: false, ok: false, action, message: 'Planting bridge is not ready.' };
    }

    const crop = String(action).slice(6); // Used to keep the action id as the single source of truth for which seed is being planted.
    const seedEntry = seedEntryForCrop(crop); // Used to resolve the exact inventory stack registered for this crop.
    if (!seedEntry) return { handled: false, ok: false, action, message: `No seed entry is registered for ${crop}.` };

    const { reticle, tile, area } = targetedCropTile();
    if (!reticle || !tile) return { handled: true, ok: false, action, crop, seedEntry, message: 'No planting tile is targeted.' };
    if (area && area !== 'farm') return { handled: true, ok: false, action, crop, seedEntry, reticle, tile, message: 'Seeds can only be planted on the farm.' };
    if (farmWorldDeps.hasFarmPermission?.('plant') === false) {
      return { handled: true, ok: false, action, crop, seedEntry, reticle, tile, message: "Only the farm's owner (or a granted farmhand) can plant here." };
    }

    const count = Math.max(0, Number(lastDeps.inventory?.[seedEntry.key]) || 0); // Used to reject stale buttons after the last seed was consumed.
    if (count < 1) return { handled: true, ok: false, action, crop, seedEntry, reticle, tile, message: 'No seeds left.' };
    if (tile.crop) return { handled: true, ok: false, action, crop, seedEntry, reticle, tile, message: 'Something is already growing here.' };
    if (!['tilled', 'raised'].includes(tile.type)) {
      return { handled: true, ok: false, action, crop, seedEntry, reticle, tile, message: 'Can only plant on tilled or raised soil.' };
    }

    return { handled: true, ok: true, action, crop, seedEntry, reticle, tile, count };
  }

  function harvestContext(action) {
    if (String(action || '') !== 'harvest' || !lastDeps || !targetingDeps || !farmWorldDeps) {
      return { handled: false, ok: false, action, message: 'Harvest bridge is not ready.' };
    }

    const { reticle, tile, area } = targetedCropTile();
    if (!reticle || !tile) return { handled: true, ok: false, action, message: 'No harvest tile is targeted.' };
    if (area && area !== 'farm') return { handled: true, ok: false, action, reticle, tile, message: 'Crops can only be harvested on the farm.' };
    if (farmWorldDeps.hasFarmPermission?.('harvest') === false) {
      return { handled: true, ok: false, action, reticle, tile, message: "Only the farm's owner (or a granted farmhand) can harvest here." };
    }
    if (!tile.crop) return { handled: true, ok: false, action, reticle, tile, message: 'Nothing to harvest here.' };
    if (!tile.cropReady) return { handled: true, ok: false, action, reticle, tile, crop: tile.crop, message: `${tile.crop} isn't ready yet.` };

    return { handled: true, ok: true, action, reticle, tile, crop: tile.crop };
  }

  function persistCropTile(reticle) {
    farmWorldDeps.recomputeWater?.(false);
    farmWorldDeps.markTileDirty?.(reticle.col, reticle.row);
    farmWorldDeps.saveFarmLayout?.();
    lastDeps.refreshItemScroll?.();
    lastDeps.buildInventoryGrid?.();
    lastDeps.refreshActionBar?.();
    lastDeps.saveMemberWorldData?.();
  }

  function blockedCropResult(context) {
    lastDeps?.showToast?.(context.message, false);
    lastCropDebug = {
      ok: false,
      action: context.action || null,
      crop: context.crop || null,
      col: context.reticle?.col ?? null,
      row: context.reticle?.row ?? null,
      tileType: context.tile?.type || null,
      message: context.message,
    };
    window.__farmLog?.(`[items] Immediate crop action blocked: ${context.message}`, 'items');
    return context;
  }

  function finishPlantContext(context) {
    if (!context?.handled) return context || { handled: false, ok: false };
    if (!context.ok) return blockedCropResult(context);

    const { crop, seedEntry, reticle, tile } = context;
    lastDeps.inventory[seedEntry.key] = Math.max(0, (Number(lastDeps.inventory[seedEntry.key]) || 0) - 1);
    lastDeps.clampInventoryStack?.(seedEntry.key);
    tile.crop = crop;
    tile.cropAge = 0;
    tile.cropReady = false;
    tile.stress = '';
    persistCropTile(reticle);

    const canonical = lastDeps.ITEM_DEFS?.[seedEntry.key]; // Used to present a friendly crop label while keeping the seed stack key unchanged.
    const seedLabel = canonical?.label || seedEntry.label || crop;
    const plantedLabel = String(seedLabel).replace(/\s+seeds?$/i, '') || crop;
    const message = `Planted ${canonical?.icon || seedEntry.icon || '🌱'} ${plantedLabel}.`;
    lastDeps.showToast?.(message, true);

    lastCropDebug = {
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
    window.__farmLog?.(`[items] Immediate plant: ${crop} @ c${reticle.col},r${reticle.row}; ${lastCropDebug.remaining} seed(s) left`, 'items');
    return { ...context, message };
  }

  function finishHarvestContext(context) {
    if (!context?.handled) return context || { handled: false, ok: false };
    if (!context.ok) return blockedCropResult(context);

    const { crop, reticle, tile } = context;
    const cropDef = lastDeps.ITEM_DEFS?.[crop] || {}; // Used for the inventory icon/label while the tile itself remains the source of crop identity.
    lastDeps.inventory[crop] = Math.min(99, (Number(lastDeps.inventory[crop]) || 0) + 1);
    const stars = Math.max(1, Number(targetingDeps.rollItemStars?.('farming')) || 1); // Used to preserve the same farming-quality roll as game.js harvestCrop().
    targetingDeps.recordItemQuality?.(crop, stars, 1);
    window.SkillSystem?.award?.('farming', window.SkillSystem?.XP_GAINS?.crop || 6, `harvested ${cropDef.label || crop}`);
    const starText = targetingDeps.starRatingText?.(stars) || '';
    const message = `Harvested ${starText ? `${starText} ` : ''}${cropDef.icon || '🌱'} ${cropDef.label || crop}!`;

    tile.crop = '';
    tile.cropAge = 0;
    tile.cropReady = false;
    tile.stress = '';
    window.AudioSystem?.playObjectSfx?.(window.AudioSystem?.objectSfxConfig?.().harvest);
    persistCropTile(reticle);
    lastDeps.showToast?.(message, true);

    lastCropDebug = {
      ok: true,
      action: 'harvest',
      crop,
      stars,
      col: reticle.col,
      row: reticle.row,
      tileType: tile.type,
      message,
    };
    window.__farmLog?.(`[items] Immediate harvest: ${crop} @ c${reticle.col},r${reticle.row}; ${stars} star(s)`, 'items');
    return { ...context, stars, message };
  }

  function cropContext(action) {
    if (String(action || '') === 'harvest') return harvestContext(action);
    if (String(action || '').startsWith('plant_')) return plantContext(action);
    return { handled: false, ok: false, action, message: 'Not a crop action.' };
  }

  function finishCropContext(context) {
    if (String(context?.action || '') === 'harvest') return finishHarvestContext(context);
    if (String(context?.action || '').startsWith('plant_')) return finishPlantContext(context);
    return context || { handled: false, ok: false };
  }

  function tryCropAction(action) {
    return finishCropContext(cropContext(action));
  }

  function tryPlantAction(action) {
    return finishPlantContext(plantContext(action));
  }

  function tryHarvestAction() {
    return finishHarvestContext(harvestContext('harvest'));
  }

  function visiblePlantAction() {
    if (typeof document === 'undefined') return null;
    const ids = ['btnAction1', 'btnAction2', 'btnAction3', 'btnItemAction1', 'btnItemAction2']; // Used to mirror the five visible action-arch slots.
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

  function makePointerCancel(sourceEvent) {
    const init = {
      bubbles: true,
      cancelable: true,
      pointerId: sourceEvent.pointerId,
      pointerType: sourceEvent.pointerType || 'mouse',
      clientX: Number(sourceEvent.clientX) || 0,
      clientY: Number(sourceEvent.clientY) || 0,
    }; // Used to clear game.js's private action-button pointer state without allowing its queued tool-action fire to run.
    if (typeof PointerEvent === 'function') return new PointerEvent('pointercancel', init);
    const fallback = new Event('pointercancel', { bubbles: true, cancelable: true });
    for (const [key, value] of Object.entries(init)) {
      try { Object.defineProperty(fallback, key, { configurable: true, value }); } catch (_) { /* best-effort compatibility field */ }
    }
    return fallback;
  }

  function syntheticPointerCleanup(button, sourceEvent) {
    if (!button || typeof button.dispatchEvent !== 'function') return;
    const wasHidden = button.classList.contains('abt-hidden'); // Used to make game.js's pointercancel cleanup see a non-fireable button while it clears drag/press state.
    button.classList.add('abt-hidden');
    try { button.dispatchEvent(makePointerCancel(sourceEvent)); }
    finally { if (!wasHidden) button.classList.remove('abt-hidden'); }
  }

  function actionButtonFromEvent(event, fallback = null) {
    const direct = event?.target?.closest?.('button.abt'); // Used for ordinary pointer events whose target is the button or one of its icon children.
    if (direct && isCropAction(direct.dataset?.action)) return direct;
    const path = typeof event?.composedPath === 'function' ? event.composedPath() : []; // Used for pointer capture/shadow-DOM cases where target is no longer the original button.
    return path.find(node => node?.matches?.('button.abt') && isCropAction(node.dataset?.action)) || fallback;
  }

  function installImmediateCropPointerRoute() {
    if (typeof document === 'undefined' || document.__inventoryCropPointerRouteInstalled) return;
    document.__inventoryCropPointerRouteInstalled = true;

    document.addEventListener('pointerdown', event => {
      const button = actionButtonFromEvent(event);
      if (!button) return;
      cropPointers.set(event.pointerId, {
        button,
        action: button.dataset.action,
        x: Number(event.clientX) || 0,
        y: Number(event.clientY) || 0,
        moved: false,
      });
    }, true);

    document.addEventListener('pointermove', event => {
      const state = cropPointers.get(event.pointerId);
      if (!state || state.moved) return;
      const dx = (Number(event.clientX) || 0) - state.x;
      const dy = (Number(event.clientY) || 0) - state.y;
      if (Math.hypot(dx, dy) > 18) state.moved = true;
    }, true);

    document.addEventListener('pointercancel', event => {
      cropPointers.delete(event.pointerId);
    }, true);

    document.addEventListener('pointerup', event => {
      const state = cropPointers.get(event.pointerId);
      cropPointers.delete(event.pointerId);
      if (!state || state.moved) return; // Drag-to-aim remains owned by game.js and must not act on the gesture's original tile.
      const button = actionButtonFromEvent(event, state.button);
      const action = button?.dataset?.action || state.action || '';
      const context = cropContext(action);
      if (!context.handled) return;

      // Claim before mutation. This prevents _abtUp -> _abtFire -> pendingAction
      // from running after the immediate crop mutation, which is the exact
      // stranded-action path exposed by switching from a held item to a tool.
      event.preventDefault?.();
      event.stopImmediatePropagation?.();
      syntheticPointerCleanup(button, event);
      finishCropContext(context);
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
  installImmediateCropPointerRoute();

  window.HobunjiInventoryActionMetadataBridge = {
    refresh: () => syncInventoryEntries(lastDeps),
    tryCropAction,
    tryPlantAction,
    tryHarvestAction,
    getDebug: () => ({
      ...lastSync,
      cropActionsReady: !!(lastDeps && targetingDeps && farmWorldDeps),
      plantingReady: !!(lastDeps && targetingDeps && farmWorldDeps), // Backward-compatible diagnostic name used by older probes/tests.
      lastCrop: lastCropDebug ? { ...lastCropDebug } : null,
      lastPlant: lastCropDebug?.action?.startsWith?.('plant_') ? { ...lastCropDebug } : null,
    }),
  };
})();
