(() => {
  'use strict';
  if (window.InventoryHeldOverride) return;

  let equipmentDeps = null; // Used to read/write game.js's existing manualHeldItem slot and inventory counts.
  let itemDeps = null; // Used by direct Inventory actions to resolve canonical item metadata and refresh/save bag state.
  let actionRaw = null; // Used to control the real heldMode/activeItemIndex without the arch-facing wrappers recursing.
  let hudRawCycle = null; // Used to let the inventory scroll relinquish a manual Hold before normal cycling.
  let originalWheelEligible = null; // Used to preserve the canonical item-arch eligibility rules underneath the one-item override.
  let clearQueued = false; // Used to coalesce stale/empty held-item cleanup discovered during wheel filtering.
  let directUseObserver = null; // Used to keep the Inventory detail's direct-use button synchronized with existing renderers.
  let directUseQueued = false; // Used to coalesce Inventory detail mutations into one direct-use render pass.
  let lastDirectUse = null; // Used by mobile-safe diagnostics to report the most recent Inventory action attempt.
  let lastDirectUseUi = null; // Used by diagnostics to explain why a direct-use button did or did not resolve.

  const state = {
    manualKey: null, // Used to remember which off-arch bag item currently owns the held-item override.
    previousWheelKey: null, // Used to restore the arch's prior real selection when the override ends.
    previousHeldMode: null, // Used only when the player explicitly presses "Holding — Stop".
    pendingSnapshot: null, // Used to capture pre-click state before game.js changes manualHeldItem in the Hold button callback.
    lastEvent: null, // Used by mobile-safe diagnostics.
  };

  function rawManualHeldItem() {
    return equipmentDeps?.getManualHeldItem?.() || null;
  }

  function rawManualBagKey() {
    const held = rawManualHeldItem();
    return held?.kind === 'bagItem' && held.key ? held.key : null;
  }

  function liveManualBagKey() {
    const key = rawManualBagKey();
    if (!key) return null;
    return (Number(equipmentDeps?.inventory?.[key]) || 0) > 0 ? key : null;
  }

  function rawStacks() {
    return actionRaw?.getInventoryStackItems?.() || [];
  }

  function rawActiveWheelKey() {
    const stacks = rawStacks();
    if (!stacks.length) return null;
    const index = Math.max(0, Math.min(stacks.length - 1, Number(actionRaw?.getActiveItemIndex?.()) || 0));
    return stacks[index]?.key || null;
  }

  function refreshHeldUi() {
    window.HudUpdate?.refreshItemScroll?.();
    actionRaw?.refreshActionBar?.();
  }

  function restoreWheelKey(key) {
    if (!actionRaw?.setActiveItemIndex) return -1;
    const stacks = rawStacks();
    if (!stacks.length) {
      actionRaw.setActiveItemIndex(0);
      return -1;
    }
    const index = key ? stacks.findIndex(item => item?.key === key) : -1;
    const safe = index >= 0 ? index : Math.max(0, Math.min(stacks.length - 1, Number(actionRaw.getActiveItemIndex?.()) || 0));
    actionRaw.setActiveItemIndex(safe);
    return safe;
  }

  function finishClear({ clearManual = false, restorePriorMode = false, reason = 'clear' } = {}) {
    if (!state.manualKey && !rawManualBagKey()) return false;
    const previousWheelKey = state.previousWheelKey;
    const previousHeldMode = state.previousHeldMode;
    const oldKey = state.manualKey || rawManualBagKey();

    if (clearManual && rawManualBagKey()) equipmentDeps?.setManualHeldItem?.(null);
    state.manualKey = null;
    state.previousWheelKey = null;
    state.previousHeldMode = null;
    state.pendingSnapshot = null;

    restoreWheelKey(previousWheelKey);
    if (restorePriorMode && previousHeldMode != null) actionRaw?.setHeldMode?.(previousHeldMode);
    state.lastEvent = { type: 'clear', key: oldKey, reason, restorePriorMode, at: Date.now() };
    refreshHeldUi();
    return true;
  }

  function queueExternalClear(reason, clearManual) {
    if (clearQueued) return;
    clearQueued = true;
    queueMicrotask(() => {
      clearQueued = false;
      finishClear({ clearManual, restorePriorMode: false, reason });
    });
  }

  function capturePreHoldSnapshot() {
    if (state.manualKey) {
      state.pendingSnapshot = {
        previousWheelKey: state.previousWheelKey,
        previousHeldMode: state.previousHeldMode,
      };
      return;
    }
    state.pendingSnapshot = {
      previousWheelKey: rawActiveWheelKey(),
      previousHeldMode: actionRaw?.getHeldMode?.() ?? null,
    };
  }

  function syncFromManualHold({ restorePriorModeOnClear = false } = {}) {
    const key = liveManualBagKey();
    if (!key) {
      const hadOverride = Boolean(state.manualKey);
      if (hadOverride) finishClear({ clearManual: false, restorePriorMode: restorePriorModeOnClear, reason: restorePriorModeOnClear ? 'hold-stop' : 'external-clear' });
      state.pendingSnapshot = null;
      return false;
    }

    if (state.manualKey !== key) {
      const snapshot = state.pendingSnapshot || {
        previousWheelKey: state.previousWheelKey || rawActiveWheelKey(),
        previousHeldMode: state.previousHeldMode ?? actionRaw?.getHeldMode?.() ?? null,
      };
      state.manualKey = key;
      state.previousWheelKey = snapshot.previousWheelKey || null;
      state.previousHeldMode = snapshot.previousHeldMode;
    }
    state.pendingSnapshot = null;

    const stacks = rawStacks();
    const index = stacks.findIndex(item => item?.key === key);
    if (index < 0) {
      state.lastEvent = { type: 'activate-failed', key, reason: 'not-in-resolved-stack', at: Date.now() };
      return false;
    }

    actionRaw?.setActiveItemIndex?.(index);
    actionRaw?.setHeldMode?.('item');
    state.lastEvent = { type: 'activate', key, previousWheelKey: state.previousWheelKey, previousHeldMode: state.previousHeldMode, at: Date.now() };
    refreshHeldUi();
    return true;
  }

  function releaseForNormalSelection(reason = 'normal-selection') {
    return finishClear({ clearManual: true, restorePriorMode: false, reason });
  }

  function captureItemDeps(injected = {}) {
    if (!injected?.inventory) return;
    itemDeps = { ...itemDeps, ...injected }; // Merged because CookingSystem/FarmCrates expose complementary item helpers.
    scheduleDirectUseUi();
  }

  function canonicalDef(key) {
    return itemDeps?.ITEM_DEFS?.[key] || null;
  }

  function recipeScrollId(key, def) {
    const authored = def?.alchemyRecipeScrollId;
    if (authored && window.AlchemySystem?.RECIPE_DEFS?.[authored]) return authored;
    const match = /^alchemy_recipe_(.+)$/.exec(String(key || '')); // Generated physical recipe keys remain self-describing even before metadata sync.
    const keyed = match?.[1] || null;
    return keyed && window.AlchemySystem?.RECIPE_DEFS?.[keyed] ? keyed : null;
  }

  function techniqueScrollTier(key, def) {
    const authored = Number(def?.techniqueScrollTier) || 0;
    if (authored > 0) return authored;
    const scroll = Object.entries(window.TechniqueScrolls?.SCROLLS || {}).find(([, value]) => value?.key === key);
    return scroll ? Number(scroll[0]) || 0 : 0;
  }

  function inventoryUseAction(key) {
    const inventory = itemDeps?.inventory || equipmentDeps?.inventory;
    if (!key || !(Number(inventory?.[key]) > 0)) return null;
    const def = canonicalDef(key);
    if (!def) return null;

    if (def.combatManualAbilityId) {
      const learned = !!window.TechniqueScrolls?.isUnlocked?.(def.combatManualAbilityId); // Used to disable a manual whose exact technique is already known.
      return { key, kind: 'combatManual', verb: learned ? 'Already learned' : 'Read', icon: def.icon || '📕', itemLabel: def.label || key, allowed: !learned };
    }
    if (techniqueScrollTier(key, def) > 0) return { key, kind: 'techniqueScroll', verb: 'Read', icon: def.icon || '📜', itemLabel: def.label || key, allowed: true };
    if (def.mysteryDyePoolId) return { key, kind: 'mysteryDye', verb: 'Use', icon: def.icon || '🎨', itemLabel: def.label || key, allowed: true };
    if (def.isCookedFood) return { key, kind: 'cookedFood', verb: 'Eat', icon: def.icon || '🍲', itemLabel: def.label || key, allowed: true };
    if (window.AlchemySystem?.REAGENT_DEFS?.[key]) return { key, kind: 'rawReagent', verb: 'Eat', icon: def.icon || '🌿', itemLabel: def.label || key, allowed: true };
    if (recipeScrollId(key, def)) return { key, kind: 'recipe', verb: 'Read', icon: def.icon || '📜', itemLabel: def.label || key, allowed: true };

    const potionPayload = window.AlchemySystem?.POTION_ITEMS?.[key] || window.AlchemySystem?.parseBrewedItemKey?.(key); // Used to reject target-dependent flask/livestock recipes before generic drink detection.
    const potionRecipe = potionPayload?.recipeId && window.AlchemySystem?.RECIPE_DEFS?.[potionPayload.recipeId];
    const explicitUseMode = potionRecipe?.useMode || def.useMode || null; // Used so throw/livestock items never gain a misleading direct Inventory button.
    if (explicitUseMode === 'throw' || explicitUseMode === 'livestock') return null;

    const bridge = window.HobunjiDrunkGameplayBridge;
    if (explicitUseMode === 'drink' || potionPayload?.legacyEffects || bridge?.isPotionOrDrink?.(key, def)) {
      return { key, kind: 'drink', verb: 'Drink', icon: def.icon || '🥤', itemLabel: def.label || key, allowed: true };
    }
    if (bridge?.isFood?.(def)) return { key, kind: 'food', verb: 'Eat', icon: def.icon || '🍽️', itemLabel: def.label || key, allowed: true };
    return null;
  }

  function withTemporaryManualBagItem(key, callback) {
    const previous = rawManualHeldItem(); // Used to let TechniqueScrolls reuse its canonical held-item mutation path without changing the player's actual Hold state.
    equipmentDeps?.setManualHeldItem?.({ kind: 'bagItem', key });
    try {
      return callback();
    } finally {
      const previousKey = previous?.kind === 'bagItem' ? previous.key : null; // Used to avoid restoring an empty stack consumed by the direct action.
      const safePrevious = previousKey && !(Number(equipmentDeps?.inventory?.[previousKey]) > 0) ? null : previous;
      equipmentDeps?.setManualHeldItem?.(safePrevious || null);
    }
  }

  function consumeOrdinaryFood(key, def) {
    const inventory = itemDeps?.inventory || equipmentDeps?.inventory;
    if (!def || !(Number(inventory?.[key]) > 0)) return { ok: false, message: 'Nothing edible is selected.' };
    inventory[key] = Math.max(0, Number(inventory[key]) - 1);
    itemDeps?.clampInventoryStack?.(key);
    const player = window.Combat?.deps?.player; // Used to mirror alcohol-gameplay-bridge's ordinary held-food restoration path.
    const healthRestore = Number(def.healthRestore ?? def.restoreHealth ?? def.health) || 0;
    const staminaRestore = Number(def.staminaRestore ?? def.restoreStamina ?? def.stamina) || 0;
    if (player && healthRestore > 0) player.health = Math.min(Number(player.maxHealth) || 100, (Number(player.health) || 0) + healthRestore);
    if (player && staminaRestore > 0) window.ResourceSystem?.restoreStamina?.(player, staminaRestore);
    window.CookingSystem?.recordFoodEaten?.(); // Ordinary direct-use food shares CookingSystem's one persistent Hunger reset path.
    return { ok: true, message: `${def.icon || '🍽️'} Ate ${def.label || key}.` };
  }

  function refreshAfterInventoryUse(key) {
    const refreshDeps = itemDeps || equipmentDeps; // Used to share the same bag/HUD/save side effects as held-item actions.
    refreshDeps?.refreshItemScroll?.();
    refreshDeps?.buildInventoryGrid?.();
    refreshDeps?.refreshActionBar?.();
    refreshDeps?.saveMemberWorldData?.();
    if (!(Number((refreshDeps?.inventory || equipmentDeps?.inventory)?.[key]) > 0)) equipmentDeps?.clearInventoryDetail?.();
    scheduleDirectUseUi();
  }

  function useInventoryItem(key) {
    const action = inventoryUseAction(key);
    if (!action || action.allowed === false) {
      lastDirectUse = { key: key || null, kind: action?.kind || null, ok: false, reason: action ? 'not-allowed' : 'not-direct-usable', at: Date.now() };
      return false;
    }

    let result = null; // Used to normalize the various existing item-owner return shapes into one Inventory action result.
    let ownerHandlesFeedback = false; // TechniqueScrolls already owns its read toast/refresh path, so do not duplicate it here.
    if (action.kind === 'combatManual') {
      ownerHandlesFeedback = true;
      result = { ok: !!withTemporaryManualBagItem(key, () => window.TechniqueScrolls?.consumeManual?.()), message: '' };
    } else if (action.kind === 'techniqueScroll') {
      ownerHandlesFeedback = true;
      result = { ok: !!withTemporaryManualBagItem(key, () => window.TechniqueScrolls?.consumeScroll?.()), message: '' };
    } else if (action.kind === 'mysteryDye') {
      result = window.DyeSystem?.useMysteryDye?.(key) || { ok: false, message: 'That dye cannot be used.' };
    } else if (action.kind === 'cookedFood') {
      result = window.CookingSystem?.eat?.(key) || { ok: false, message: 'That meal cannot be eaten.' };
    } else if (action.kind === 'rawReagent') {
      result = window.AlchemySystem?.consumeRawReagent?.(key) || { ok: false, message: 'That reagent cannot be eaten.' };
    } else if (action.kind === 'recipe') {
      result = window.AlchemySystem?.readRecipeItem?.(key) || { ok: false, message: 'That recipe cannot be read.' };
    } else if (action.kind === 'drink') {
      result = window.AlchemySystem?.drinkPotion?.(key) || { ok: false, message: 'That drink cannot be consumed.' };
    } else if (action.kind === 'food') {
      result = consumeOrdinaryFood(key, canonicalDef(key));
    }

    const ok = !!result?.ok;
    if (!ownerHandlesFeedback) itemDeps?.showToast?.(result?.message || (ok ? `${action.verb} ${action.itemLabel}.` : `Could not ${action.verb.toLowerCase()} that item.`), ok);
    if (ok && !ownerHandlesFeedback) refreshAfterInventoryUse(key);
    else scheduleDirectUseUi();
    lastDirectUse = { key, kind: action.kind, verb: action.verb, ok, message: result?.message || null, at: Date.now() };
    return ok;
  }

  function normalizeDetailLabel(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function resolveInventoryDetailAction() {
    if (typeof document?.getElementById !== 'function') return null;
    const nameEl = document.getElementById('iiName');
    const actionsEl = document.getElementById('iiActions');
    const detailEl = document.getElementById('iiDetail');
    if (!nameEl || !actionsEl || !detailEl || detailEl.style?.display === 'none') return null;
    const detailName = normalizeDetailLabel(nameEl.textContent);
    if (!detailName) return null;
    const inventory = itemDeps?.inventory || equipmentDeps?.inventory || {};
    const candidates = Object.keys(inventory).filter(key => Number(inventory[key]) > 0).map(key => {
      const action = inventoryUseAction(key);
      const def = canonicalDef(key);
      return action && def ? { key, action, names: [def.label, itemDeps?.inventoryItems?.find?.(item => item?.key === key)?.label].filter(Boolean).map(normalizeDetailLabel) } : null;
    }).filter(Boolean).filter(candidate => candidate.names.includes(detailName));
    if (candidates.length !== 1) {
      lastDirectUseUi = { detailName, resolvedKey: null, reason: candidates.length ? 'ambiguous-label' : 'not-direct-usable', candidates: candidates.map(candidate => candidate.key), at: Date.now() };
      return null;
    }
    lastDirectUseUi = { detailName, resolvedKey: candidates[0].key, kind: candidates[0].action.kind, reason: 'resolved', at: Date.now() };
    return { ...candidates[0], actionsEl };
  }

  function renderDirectUseButton() {
    if (typeof document?.getElementById !== 'function') return;
    const actionsEl = document.getElementById('iiActions');
    const existing = document.getElementById('inventoryDirectUseBtn');
    const resolved = resolveInventoryDetailAction();
    if (!resolved) {
      existing?.remove?.();
      return;
    }
    const { key, action } = resolved;
    const button = existing || document.createElement('button'); // Used as the one shared direct-action control beside Sell/Hold/Transfer actions.
    button.id = 'inventoryDirectUseBtn';
    button.className = 'ii-btn inventory-direct-use';
    button.dataset.itemKey = key;
    button.disabled = action.allowed === false;
    button.textContent = `${action.icon || '✦'} ${action.verb}`;
    button.title = `${action.verb} ${action.itemLabel} directly from Inventory`;
    button.onclick = () => useInventoryItem(key);
    if (!existing) actionsEl?.prepend?.(button);
  }

  function scheduleDirectUseUi() {
    if (directUseQueued) return;
    directUseQueued = true;
    queueMicrotask(() => {
      directUseQueued = false;
      renderDirectUseButton();
    });
  }

  function installDirectUseUi() {
    if (directUseObserver || typeof document?.getElementById !== 'function') return;
    const root = document.getElementById('mpInventory');
    if (!root) return;
    if (typeof MutationObserver === 'function') {
      directUseObserver = new MutationObserver(scheduleDirectUseUi); // Existing inventory renderers stay authoritative; this only decorates their final action row.
      directUseObserver.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'style'] });
    } else directUseObserver = { observe() {} };
    scheduleDirectUseUi();
  }

  function patchItemProcessing(api) {
    if (!api?.isWheelEligible || api.__inventoryHeldOverridePatched) return;
    const base = api.isWheelEligible.bind(api); // Used so authored food/seed/processor eligibility remains unchanged.
    originalWheelEligible = base;
    api.isWheelEligible = function inventoryHeldWheelEligibility(key, ...rest) {
      const heldKey = rawManualBagKey();
      const count = heldKey ? (Number(equipmentDeps?.inventory?.[heldKey]) || 0) : 0;
      const stackFilterCall = rest.length >= 2 && Array.isArray(rest[1]); // Used to affect getInventoryStackItems().filter(...) without making Inventory's Hold button think the item belongs on the arch.

      if (state.manualKey && !heldKey) queueExternalClear('manual-slot-cleared', false);
      if (heldKey && count <= 0) queueExternalClear('held-stack-empty', true);
      if (stackFilterCall && heldKey && count > 0 && key === heldKey) return true;
      return base(key, ...rest);
    };
    api.__inventoryHeldOverridePatched = true;
  }

  function patchEquipmentPanel(api) {
    if (!api?.init || api.__inventoryHeldOverridePatched) return;
    const init = api.init.bind(api);
    api.init = (deps, ...rest) => {
      equipmentDeps = deps; // Used by the Hold-button click bridge, direct Inventory actions, and temporary wheel-eligibility override.
      captureItemDeps(deps);
      const result = init(deps, ...rest);
      installDirectUseUi();
      scheduleDirectUseUi();
      return result;
    };
    api.__inventoryHeldOverridePatched = true;
  }

  function patchItemInit(api, marker) {
    if (!api?.init || api[marker]) return;
    const init = api.init.bind(api); // Used to capture ITEM_DEFS/inventory helpers without taking ownership of the source system.
    api.init = (deps, ...rest) => {
      const result = init(deps, ...rest);
      captureItemDeps(deps);
      return result;
    };
    api[marker] = true;
  }

  function patchActionArc(api) {
    if (!api?.init || api.__inventoryHeldOverridePatched) return;
    const init = api.init.bind(api);
    api.init = (deps, ...rest) => {
      actionRaw = {
        getInventoryStackItems: deps.getInventoryStackItems,
        getActiveItemIndex: deps.getActiveItemIndex,
        setActiveItemIndex: deps.setActiveItemIndex,
        getHeldMode: deps.getHeldMode,
        setHeldMode: deps.setHeldMode,
        cycleActiveInventoryItem: deps.cycleActiveInventoryItem,
        putAwayHeldEquipment: deps.putAwayHeldEquipment,
        refreshActionBar: deps.refreshActionBar,
      }; // Used as the authoritative unwrapped game.js state bridge.

      const archStacks = () => {
        const heldKey = liveManualBagKey(); // Used to keep the manually held off-arch item out of the actual selection arch.
        const stacks = rawStacks();
        return heldKey ? stacks.filter(item => item?.key !== heldKey) : stacks;
      };

      deps.getInventoryStackItems = archStacks;
      deps.getActiveItemIndex = () => {
        const heldKey = liveManualBagKey();
        if (!heldKey) return actionRaw.getActiveItemIndex();
        const stacks = archStacks();
        if (!stacks.length) return 0;
        const previousIndex = state.previousWheelKey ? stacks.findIndex(item => item?.key === state.previousWheelKey) : -1;
        return previousIndex >= 0 ? previousIndex : Math.max(0, Math.min(stacks.length - 1, Number(actionRaw.getActiveItemIndex()) || 0));
      };
      deps.setActiveItemIndex = index => {
        const heldKey = liveManualBagKey();
        if (!heldKey) return actionRaw.setActiveItemIndex(index);
        const selectedKey = archStacks()[index]?.key || null; // Used to translate the arch's filtered index back into the normal stack after releasing Hold.
        releaseForNormalSelection('arch-item-select');
        const normal = rawStacks();
        const realIndex = selectedKey ? normal.findIndex(item => item?.key === selectedKey) : -1;
        return actionRaw.setActiveItemIndex(realIndex >= 0 ? realIndex : Math.max(0, Number(index) || 0));
      };
      deps.cycleActiveInventoryItem = dir => {
        if (liveManualBagKey()) releaseForNormalSelection('arch-item-cycle');
        return actionRaw.cycleActiveInventoryItem(dir);
      };
      deps.setHeldMode = mode => {
        if (mode !== 'item' && liveManualBagKey()) releaseForNormalSelection('switch-held-mode');
        return actionRaw.setHeldMode(mode);
      };
      deps.putAwayHeldEquipment = (...args) => {
        if (liveManualBagKey()) releaseForNormalSelection('put-away');
        return actionRaw.putAwayHeldEquipment(...args);
      };
      return init(deps, ...rest);
    };
    api.__inventoryHeldOverridePatched = true;
  }

  function patchHud(api) {
    if (!api?.init || api.__inventoryHeldOverridePatched) return;
    const init = api.init.bind(api);
    api.init = (deps, ...rest) => {
      if (typeof deps.cycleActiveInventoryItem === 'function') {
        hudRawCycle = deps.cycleActiveInventoryItem; // Used by the prev/next item-scroll buttons after a manual override is relinquished.
        deps.cycleActiveInventoryItem = dir => {
          if (liveManualBagKey()) releaseForNormalSelection('hud-item-cycle');
          return hudRawCycle(dir);
        };
      }
      return init(deps, ...rest);
    };
    api.__inventoryHeldOverridePatched = true;
  }

  function futureGlobal(name, patch) {
    if (window[name]) { patch(window[name]); return; }
    const descriptor = Object.getOwnPropertyDescriptor(window, name);
    if (descriptor && !descriptor.configurable) return;
    const prevGet = descriptor?.get;
    const prevSet = descriptor?.set;
    let value = descriptor?.value;
    Object.defineProperty(window, name, {
      configurable: true,
      enumerable: descriptor?.enumerable ?? true,
      get() { return prevGet ? prevGet.call(window) : value; },
      set(next) {
        if (prevSet) prevSet.call(window, next); else value = next;
        patch(prevGet ? prevGet.call(window) : (prevSet ? next : value));
      },
    });
  }

  patchItemProcessing(window.ItemProcessing);
  futureGlobal('ItemProcessing', patchItemProcessing);
  futureGlobal('EquipmentPanel', patchEquipmentPanel);
  futureGlobal('ActionArcUI', patchActionArc);
  futureGlobal('HudUpdate', patchHud);
  futureGlobal('CookingSystem', api => patchItemInit(api, '__inventoryDirectUseItemHooked'));
  futureGlobal('FarmCrates', api => patchItemInit(api, '__inventoryDirectUseItemHooked'));

  document.addEventListener('click', event => {
    const button = event.target?.closest?.('#iiActions button');
    if (button && button.closest?.('#mpInventory') && /\bHold(?:ing)?\b/i.test(button.textContent || '')) {
      capturePreHoldSnapshot();
      setTimeout(() => syncFromManualHold({ restorePriorModeOnClear: true }), 0); // Runs after the button's own onclick mutates manualHeldItem.
    }
    if (event.target?.closest?.('#mpInventory')) scheduleDirectUseUi();
  }, true);

  if (typeof document?.addEventListener === 'function') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installDirectUseUi, { once: true });
    else installDirectUseUi();
  }

  window.InventoryHeldOverride = {
    sync: syncFromManualHold,
    clear: () => finishClear({ clearManual: true, restorePriorMode: false, reason: 'api-clear' }),
    releaseForNormalSelection,
    getInventoryUseAction: inventoryUseAction,
    useInventoryItem,
    refreshInventoryUseButton: scheduleDirectUseUi,
    getDebug() {
      const held = rawManualHeldItem();
      const stacks = rawStacks();
      const index = Number(actionRaw?.getActiveItemIndex?.()) || 0;
      return {
        held,
        liveManualBagKey: liveManualBagKey(),
        overrideKey: state.manualKey,
        previousWheelKey: state.previousWheelKey,
        previousHeldMode: state.previousHeldMode,
        heldMode: actionRaw?.getHeldMode?.() ?? null,
        activeResolvedKey: stacks[index]?.key || null,
        resolvedStackKeys: stacks.map(item => item?.key).filter(Boolean),
        originalWheelEligibleReady: typeof originalWheelEligible === 'function',
        directUseReady: !!itemDeps?.ITEM_DEFS,
        lastDirectUse: lastDirectUse && { ...lastDirectUse },
        lastDirectUseUi: lastDirectUseUi && { ...lastDirectUseUi },
        lastEvent: state.lastEvent && { ...state.lastEvent },
      };
    },
    formatDebug() {
      const d = this.getDebug();
      return `Inventory Hold: manual=${d.liveManualBagKey || 'none'} override=${d.overrideKey || 'none'} mode=${d.heldMode || 'none'} active=${d.activeResolvedKey || 'none'} previous=${d.previousWheelKey || 'none'} direct=${d.lastDirectUse ? `${d.lastDirectUse.kind}:${d.lastDirectUse.ok ? 'ok' : 'blocked'}` : 'none'} event=${d.lastEvent?.type || 'none'}`;
    },
  };
})();