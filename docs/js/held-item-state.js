// Canonical manual held-item state bridge.
//
// Inventory "Hold" is intentionally different from the item-selection arch:
// combat manuals, clothing, and other off-arch objects stay out of the visible
// arch, but a held bag item still has to become the REAL game-level held item
// so game.js's hand renderer and ordinary item actions can see it.
//
// The projection below is deliberately narrow. While a manual bag item is held,
// it makes that one stack visible to game.js's existing getInventoryStackItems()
// resolver, points the real active item index at it, and sets heldMode='item'.
// ActionArcUI/HudUpdate receive filtered views so the projected stack never
// appears in the selection arch. No inventory count or persistence data is
// written by this module.
(() => {
  'use strict';
  if (window.HobunjiHeldItemState) return;

  let deps = {}; // Merged read/control dependencies captured from existing one-time module init calls.
  let actionRaw = null; // Unwrapped game.js held-mode/index/list controls captured from ActionArcUI.init().
  let activeSignature = null; // Identity of the manual Hold currently owning the player's hands.
  let projectionKey = null; // Off-arch bag key temporarily projected into game.js's active-stack resolver.
  let previousWheelKey = null; // Real wheel selection restored when manual Hold ends without a new ordinary selection.
  let previousHeldMode = null; // Diagnostic only; manual Hold itself always puts ordinary equipment away.
  let baseWheelEligible = null; // Canonical ItemProcessing eligibility underneath the one-stack projection.
  let syncTimer = null; // Low-frequency synchronizer for stale/external state changes.
  let keyListenerInstalled = false;

  const debug = {
    version: 2,
    captures: {},
    activeSignature: null,
    projectionKey: null,
    previousWheelKey: null,
    previousHeldMode: null,
    lastHeldMode: null,
    lastResolvedKey: null,
    lastEvent: null,
    staleClears: 0,
    ordinarySelectionClears: 0,
  };

  function mergeDeps(injectedDeps) {
    if (!injectedDeps || typeof injectedDeps !== 'object') return;
    deps = { ...deps, ...injectedDeps };
  }

  function rawManualHeldItem() {
    return deps.getManualHeldItem?.() || null;
  }

  function resolveClothingInstance(uid) {
    const gearInventory = deps.getGearInventory?.();
    const gearMatch = (gearInventory?.clothingItems || []).find(item => item?.uid === uid);
    if (gearMatch) return gearMatch;
    const packClothing = deps.getPackClothing?.() || [];
    return packClothing.find(item => item?.uid === uid) || null;
  }

  function resolveManualHeldThing() {
    const held = rawManualHeldItem();
    if (!held) return null;
    if (held.kind === 'bagItem') {
      const key = held.key;
      const count = Math.max(0, Number(deps.inventory?.[key]) || 0);
      if (!key || count <= 0) return null;
      const def = deps.ITEM_DEFS?.[key] || {};
      return { kind: 'bagItem', key, count, def, label: def.label || key, icon: def.icon || '✋' };
    }
    if (held.kind === 'clothing') {
      const instance = resolveClothingInstance(held.uid);
      if (!instance) return null;
      return { kind: 'clothing', uid: held.uid, instance, label: instance.label || instance.baseLabel || 'Clothing', icon: '👕' };
    }
    return null;
  }

  function signatureFor(thing) {
    if (!thing) return null;
    return thing.kind === 'bagItem' ? `bag:${thing.key}` : `clothing:${thing.uid}`;
  }

  function resetTracking() {
    activeSignature = null;
    previousHeldMode = null;
    debug.activeSignature = null;
    debug.previousHeldMode = null;
  }

  function installWheelProjection() {
    const api = window.ItemProcessing;
    if (!api?.isWheelEligible) return false;
    if (api.__hobunjiManualHoldProjectionPatched) {
      baseWheelEligible = api.__hobunjiManualHoldProjectionBase || baseWheelEligible;
      return true;
    }

    const base = api.isWheelEligible.bind(api);
    baseWheelEligible = base;
    api.isWheelEligible = function hobunjiManualHoldWheelProjection(key, ...rest) {
      // getInventoryStackItems() calls isWheelEligible from Array.filter,
      // supplying (definition, sourceArray) after the key. Only that exact
      // stack-resolution call sees the projection. Inventory's ordinary
      // isWheelEligible(key) check therefore still reports this item as
      // off-arch and continues to show its Hold button.
      const stackResolutionCall = rest.length >= 2 && Array.isArray(rest[1]);
      if (stackResolutionCall && projectionKey && key === projectionKey && (Number(deps.inventory?.[key]) || 0) > 0) return true;
      return base(key, ...rest);
    };
    api.__hobunjiManualHoldProjectionPatched = true;
    api.__hobunjiManualHoldProjectionBase = base;
    return true;
  }

  function rawStacks() {
    return actionRaw?.getInventoryStackItems?.() || [];
  }

  function stackIndexForKey(stacks, key) {
    return key ? stacks.findIndex(item => item?.key === key) : -1;
  }

  function rawActiveKey() {
    const stacks = rawStacks();
    if (!stacks.length) return null;
    const rawIndex = Number(actionRaw?.getActiveItemIndex?.());
    const index = Number.isFinite(rawIndex) ? Math.max(0, Math.min(stacks.length - 1, rawIndex)) : 0;
    return stacks[index]?.key || null;
  }

  function archStacks() {
    const stacks = rawStacks();
    return projectionKey ? stacks.filter(item => item?.key !== projectionKey) : stacks;
  }

  function archActiveIndex() {
    if (!projectionKey) return Number(actionRaw?.getActiveItemIndex?.()) || 0;
    const stacks = archStacks();
    if (!stacks.length) return 0;
    const priorIndex = stackIndexForKey(stacks, previousWheelKey);
    return priorIndex >= 0 ? priorIndex : Math.max(0, Math.min(stacks.length - 1, Number(actionRaw?.getActiveItemIndex?.()) || 0));
  }

  function refreshHeldUi() {
    deps.refreshActionBar?.();
    window.HudUpdate?.refreshItemScroll?.();
  }

  function restorePreviousWheelSelection() {
    if (!actionRaw?.setActiveItemIndex) return;
    const stacks = rawStacks(); // projectionKey must already be null before this runs.
    if (!stacks.length) {
      actionRaw.setActiveItemIndex(0);
      return;
    }
    const previousIndex = stackIndexForKey(stacks, previousWheelKey);
    const fallback = Math.max(0, Math.min(stacks.length - 1, Number(actionRaw.getActiveItemIndex?.()) || 0));
    actionRaw.setActiveItemIndex(previousIndex >= 0 ? previousIndex : fallback);
  }

  function clearManualSelector() {
    if (!rawManualHeldItem()) return;
    if (typeof deps.clearManualHeldItem === 'function') deps.clearManualHeldItem();
    else deps.setManualHeldItem?.(null);
  }

  function endBagProjection({ clearManual = false, restoreWheel = true, putHandsFree = false, reason = 'clear' } = {}) {
    const oldKey = projectionKey;
    if (!oldKey && !rawManualHeldItem()) {
      resetTracking();
      return false;
    }
    if (clearManual) clearManualSelector();

    projectionKey = null;
    debug.projectionKey = null;
    if (restoreWheel) restorePreviousWheelSelection();
    previousWheelKey = null;
    debug.previousWheelKey = null;
    resetTracking();

    if (putHandsFree && actionRaw?.setHeldMode) actionRaw.setHeldMode('none');
    debug.lastEvent = { type: 'clear', key: oldKey, reason, restoreWheel, putHandsFree, at: Date.now() };
    refreshHeldUi();
    return true;
  }

  function clearManualHeld(reason = 'manual-clear') {
    const hadProjection = Boolean(projectionKey);
    const hadManual = Boolean(rawManualHeldItem());
    if (!hadProjection && !hadManual) {
      resetTracking();
      return false;
    }
    if (hadProjection) return endBagProjection({ clearManual: true, restoreWheel: true, putHandsFree: true, reason });
    clearManualSelector();
    resetTracking();
    debug.lastEvent = { type: 'clear', reason, at: Date.now() };
    refreshHeldUi();
    return true;
  }

  function ordinarySelectionReady() {
    return Boolean(actionRaw?.getHeldMode && actionRaw?.getActiveItemIndex && actionRaw?.getInventoryStackItems);
  }

  function activateBagProjection(thing, signature) {
    if (!ordinarySelectionReady() || !installWheelProjection()) return false;

    // Capture the real pre-Hold wheel selection while the item is still
    // excluded. This is separate from the rendered/effective held item.
    const beforeStacks = rawStacks();
    const beforeIndex = Number(actionRaw.getActiveItemIndex?.());
    const safeBeforeIndex = beforeStacks.length && Number.isFinite(beforeIndex)
      ? Math.max(0, Math.min(beforeStacks.length - 1, beforeIndex))
      : 0;
    previousWheelKey = beforeStacks[safeBeforeIndex]?.key || null;
    previousHeldMode = actionRaw.getHeldMode?.() ?? null;

    // Canonically remove the old tool/weapon/item first. Then project only
    // this off-arch stack into game.js's resolver and point the raw held state
    // at it, which is what updateHeldItemHolder() actually reads.
    actionRaw.putAwayHeldEquipment?.();
    projectionKey = thing.key;
    const projectedStacks = rawStacks();
    const projectedIndex = stackIndexForKey(projectedStacks, thing.key);
    if (projectedIndex < 0) {
      projectionKey = null;
      restorePreviousWheelSelection();
      previousWheelKey = null;
      previousHeldMode = null;
      debug.lastEvent = { type: 'activate-failed', key: thing.key, reason: 'not-in-resolved-stack', at: Date.now() };
      return false;
    }

    actionRaw.setActiveItemIndex?.(projectedIndex);
    actionRaw.setHeldMode?.('item');
    activeSignature = signature;
    debug.activeSignature = signature;
    debug.projectionKey = projectionKey;
    debug.previousWheelKey = previousWheelKey;
    debug.previousHeldMode = previousHeldMode;
    deps.showToast?.(`✋ Holding ${thing.label}.`, true);
    debug.lastEvent = { type: 'activate', key: thing.key, previousWheelKey, previousHeldMode, at: Date.now() };
    refreshHeldUi();
    return true;
  }

  function activateClothingHold(thing, signature) {
    activeSignature = signature;
    previousHeldMode = actionRaw?.getHeldMode?.() ?? deps.getHeldMode?.() ?? null;
    debug.activeSignature = signature;
    debug.previousHeldMode = previousHeldMode;
    (actionRaw?.putAwayHeldEquipment || deps.putAwayHeldEquipment)?.();
    deps.refreshActionBar?.();
    window.HudUpdate?.refreshItemScroll?.();
    deps.showToast?.(`✋ Holding ${thing.label}.`, true);
    debug.lastEvent = { type: 'activate-clothing', signature, label: thing.label, at: Date.now() };
  }

  function syncNow() {
    const rawHeld = rawManualHeldItem();
    const thing = resolveManualHeldThing();
    if (rawHeld && !thing) {
      debug.staleClears++;
      if (projectionKey) endBagProjection({ clearManual: true, restoreWheel: true, putHandsFree: true, reason: 'stale-manual-reference' });
      else clearManualHeld('stale-manual-reference');
      return null;
    }

    if (!thing) {
      // Pressing "Holding — Stop" clears the selector first. If a bag
      // projection is still active, remove it and return to hands-free while
      // restoring the pre-Hold wheel selection.
      if (projectionKey) endBagProjection({ clearManual: false, restoreWheel: true, putHandsFree: true, reason: 'hold-stop' });
      else resetTracking();
      return null;
    }

    const signature = signatureFor(thing);
    if (signature !== activeSignature) {
      if (projectionKey) endBagProjection({ clearManual: false, restoreWheel: true, putHandsFree: false, reason: 'manual-item-changed' });
      if (thing.kind === 'bagItem') activateBagProjection(thing, signature);
      else activateClothingHold(thing, signature);
      return thing;
    }

    if (projectionKey && ordinarySelectionReady()) {
      const heldMode = actionRaw.getHeldMode?.() ?? null;
      const resolvedKey = rawActiveKey();
      debug.lastHeldMode = heldMode;
      debug.lastResolvedKey = resolvedKey;
      // Our own projection is exactly mode=item + activeKey=projectionKey.
      // Any different real mode/index means some normal selection path won;
      // relinquish manual Hold without overwriting that newer selection.
      if (heldMode !== 'item' || resolvedKey !== projectionKey) {
        debug.ordinarySelectionClears++;
        endBagProjection({ clearManual: true, restoreWheel: false, putHandsFree: false, reason: heldMode !== 'item' ? `ordinary-mode:${heldMode}` : 'ordinary-item-changed' });
        return null;
      }
    }
    return thing;
  }

  function getManualBagItem() {
    const thing = resolveManualHeldThing();
    if (thing?.kind !== 'bagItem') return null;
    return { ...thing.def, key: thing.key, _manualHeld: true };
  }

  function getHeldBagItem() {
    const manual = getManualBagItem();
    if (manual) return manual;
    if ((actionRaw?.getHeldMode?.() ?? deps.getHeldMode?.()) !== 'item') return null;
    return (actionRaw?.getActiveInventoryItem?.() || deps.getActiveInventoryItem?.()) ?? null;
  }

  function getManualGiftItem() {
    const thing = resolveManualHeldThing();
    if (!thing) return null;
    if (thing.kind === 'clothing') return { kind: 'clothing', instance: thing.instance };
    return { kind: 'bagItem', key: thing.key, def: thing.def };
  }

  function releaseForNormalSelection(reason = 'ordinary-selection') {
    if (!projectionKey && !rawManualHeldItem()) return false;
    if (projectionKey) return endBagProjection({ clearManual: true, restoreWheel: true, putHandsFree: false, reason });
    clearManualSelector();
    resetTracking();
    return true;
  }

  function captureActionRaw(injectedDeps) {
    actionRaw = {
      getInventoryStackItems: injectedDeps.getInventoryStackItems,
      getActiveItemIndex: injectedDeps.getActiveItemIndex,
      setActiveItemIndex: injectedDeps.setActiveItemIndex,
      getHeldMode: injectedDeps.getHeldMode,
      setHeldMode: injectedDeps.setHeldMode,
      getActiveInventoryItem: injectedDeps.getActiveInventoryItem,
      cycleActiveInventoryItem: injectedDeps.cycleActiveInventoryItem,
      putAwayHeldEquipment: injectedDeps.putAwayHeldEquipment,
      refreshActionBar: injectedDeps.refreshActionBar,
    };
  }

  function actionArcDeps(injectedDeps) {
    captureActionRaw(injectedDeps);
    return {
      ...injectedDeps,
      getInventoryStackItems: archStacks,
      getActiveItemIndex: archActiveIndex,
      setActiveItemIndex: index => {
        if (!projectionKey) return actionRaw.setActiveItemIndex?.(index);
        const selectedKey = archStacks()[index]?.key || null;
        releaseForNormalSelection('arch-item-select');
        const stacks = rawStacks();
        const realIndex = stackIndexForKey(stacks, selectedKey);
        return actionRaw.setActiveItemIndex?.(realIndex >= 0 ? realIndex : Math.max(0, Number(index) || 0));
      },
      cycleActiveInventoryItem: dir => {
        if (projectionKey) releaseForNormalSelection('arch-item-cycle');
        return actionRaw.cycleActiveInventoryItem?.(dir);
      },
      setHeldMode: mode => {
        if (projectionKey && mode !== 'item') releaseForNormalSelection(`switch-held-mode:${mode}`);
        return actionRaw.setHeldMode?.(mode);
      },
      putAwayHeldEquipment: (...args) => {
        if (projectionKey) releaseForNormalSelection('put-away');
        return actionRaw.putAwayHeldEquipment?.(...args);
      },
    };
  }

  function hudDeps(injectedDeps) {
    const fallbackCycle = injectedDeps.cycleActiveInventoryItem;
    return {
      ...injectedDeps,
      getInventoryStackItems: () => projectionKey ? (injectedDeps.getInventoryStackItems?.() || []).filter(item => item?.key !== projectionKey) : (injectedDeps.getInventoryStackItems?.() || []),
      getActiveItemIndex: () => projectionKey ? archActiveIndex() : (injectedDeps.getActiveItemIndex?.() || 0),
      getHeldMode: () => projectionKey ? 'item' : injectedDeps.getHeldMode?.(),
      getActiveInventoryItem: () => projectionKey ? getManualBagItem() : injectedDeps.getActiveInventoryItem?.(),
      cycleActiveInventoryItem: dir => {
        if (projectionKey) releaseForNormalSelection('hud-item-cycle');
        return fallbackCycle?.(dir);
      },
    };
  }

  function installKeyListener() {
    if (keyListenerInstalled || typeof document === 'undefined') return;
    keyListenerInstalled = true;
    document.addEventListener('keydown', event => {
      const target = event.target;
      const tagName = String(target?.tagName || '').toLowerCase();
      const isTextEntry = tagName === 'input' || tagName === 'textarea' || tagName === 'select' || target?.isContentEditable;
      if (isTextEntry || String(event.key || '').toLowerCase() !== 'z' || !rawManualHeldItem()) return;
      clearManualHeld('put-away-key');
    }, true);
  }

  function ensureSynchronizer() {
    if (syncTimer !== null || typeof window.setInterval !== 'function') return;
    syncTimer = window.setInterval(syncNow, 80);
  }

  function wrapInit(name, { mode = 'capture', giftResolver = false } = {}) {
    const api = window[name];
    if (!api?.init || api.__hobunjiHeldItemStateBound) return false;
    const originalInit = api.init.bind(api);
    api.init = (injectedDeps, ...rest) => {
      mergeDeps(injectedDeps);
      installWheelProjection();
      let forwardedDeps = injectedDeps;
      if (mode === 'action') forwardedDeps = actionArcDeps(injectedDeps);
      else if (mode === 'hud') forwardedDeps = hudDeps(injectedDeps);
      if (giftResolver && forwardedDeps && typeof forwardedDeps === 'object') {
        const fallbackGetHeldGiftItem = forwardedDeps.getHeldGiftItem;
        forwardedDeps = {
          ...forwardedDeps,
          getHeldGiftItem: () => getManualGiftItem() || fallbackGetHeldGiftItem?.() || null,
        };
      }
      const result = originalInit(forwardedDeps, ...rest);
      debug.captures[name] = true;
      installKeyListener();
      ensureSynchronizer();
      syncNow();
      return result;
    };
    api.__hobunjiHeldItemStateBound = true;
    return true;
  }

  installWheelProjection();
  wrapInit('ActionArcUI', { mode: 'action' });
  wrapInit('HudUpdate', { mode: 'hud' });
  wrapInit('EquipmentPanel');
  wrapInit('NpcGifting', { giftResolver: true });
  installKeyListener();
  ensureSynchronizer();

  window.HobunjiHeldItemState = {
    version: 2,
    syncNow,
    clearManualHeld,
    releaseForNormalSelection,
    getManualHeldThing: resolveManualHeldThing,
    getManualBagItem,
    getHeldBagItem,
    getManualGiftItem,
    getDebug: () => ({
      ...debug,
      captures: { ...debug.captures },
      rawManualHeldItem: rawManualHeldItem(),
      resolvedManualHeldItem: resolveManualHeldThing(),
      rawHeldMode: actionRaw?.getHeldMode?.() ?? deps.getHeldMode?.() ?? null,
      rawActiveKey: rawActiveKey(),
      visibleArchKeys: archStacks().map(item => item?.key).filter(Boolean),
      wheelProjectionReady: typeof baseWheelEligible === 'function',
    }),
    formatDebug: () => {
      const thing = resolveManualHeldThing();
      const rawMode = actionRaw?.getHeldMode?.() ?? deps.getHeldMode?.() ?? '?';
      return `Manual Hold v2: ${thing ? `${thing.kind}:${thing.key || thing.uid}` : 'none'} | projected=${projectionKey || 'none'} | mode=${rawMode} | resolved=${rawActiveKey() || 'none'} | prior=${previousWheelKey || 'none'}`;
    },
  };
})();
