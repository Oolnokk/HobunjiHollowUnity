(() => {
  'use strict';
  if (window.InventoryHeldOverride) return;

  let equipmentDeps = null; // Used to read/write game.js's existing manualHeldItem slot and inventory counts.
  let actionRaw = null; // Used to control the real heldMode/activeItemIndex without the arch-facing wrappers recursing.
  let hudRawCycle = null; // Used to let the inventory scroll relinquish a manual Hold before normal cycling.
  let originalWheelEligible = null; // Used to preserve the canonical item-arch eligibility rules underneath the one-item override.
  let clearQueued = false; // Used to coalesce stale/empty held-item cleanup discovered during wheel filtering.

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
      equipmentDeps = deps; // Used by the Hold-button click bridge and temporary wheel-eligibility override.
      return init(deps, ...rest);
    };
    api.__inventoryHeldOverridePatched = true;
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

  document.addEventListener('click', event => {
    const button = event.target?.closest?.('#iiActions button');
    if (!button || !button.closest?.('#mpInventory') || !/\bHold(?:ing)?\b/i.test(button.textContent || '')) return;
    capturePreHoldSnapshot();
    setTimeout(() => syncFromManualHold({ restorePriorModeOnClear: true }), 0); // Runs after the button's own onclick mutates manualHeldItem.
  }, true);

  window.InventoryHeldOverride = {
    sync: syncFromManualHold,
    clear: () => finishClear({ clearManual: true, restorePriorMode: false, reason: 'api-clear' }),
    releaseForNormalSelection,
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
        lastEvent: state.lastEvent && { ...state.lastEvent },
      };
    },
    formatDebug() {
      const d = this.getDebug();
      return `Inventory Hold: manual=${d.liveManualBagKey || 'none'} override=${d.overrideKey || 'none'} mode=${d.heldMode || 'none'} active=${d.activeResolvedKey || 'none'} previous=${d.previousWheelKey || 'none'} event=${d.lastEvent?.type || 'none'}`;
    },
  };
})();
