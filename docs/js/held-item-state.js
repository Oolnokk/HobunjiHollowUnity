// Canonical manual held-item state bridge.
//
// Inventory "Hold" is intentionally different from the item-selection arch:
// combat manuals, clothing, and other off-arch objects stay out of
// getInventoryStackItems(), but pressing Hold still needs to replace whatever
// ordinary tool/item the player has in their hands. This module only coordinates
// the existing game state exposed through module init dependency bags. It never
// edits inventory counts, active item lists, save data, or wheel eligibility.
(() => {
  'use strict';
  if (window.HobunjiHeldItemState) return;

  let deps = {}; // Merged read/control dependencies captured from the existing one-time module init calls.
  let activeSignature = null; // Identity of the manual Hold currently owning the player's hands.
  let baselineItemIndex = null; // Item-arch index at manual-Hold activation, used to detect an explicit later wheel/scroll selection.
  let syncTimer = null; // Low-frequency synchronizer that observes existing held-state changes without patching their functions.
  let keyListenerInstalled = false; // Guards the hands-free Z listener from duplicate registration.
  const debug = { // Mobile-visible state for diagnosing Hold behavior without DevTools.
    version: 1,
    captures: {},
    activeSignature: null,
    baselineItemIndex: null,
    lastHeldMode: null,
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
    const gearInventory = deps.getGearInventory?.(); // Gear collection containing wearable clothing instances.
    const gearMatch = (gearInventory?.clothingItems || []).find(item => item?.uid === uid); // Matching owned gear article, if present.
    if (gearMatch) return gearMatch;
    const packClothing = deps.getPackClothing?.() || []; // World-scoped loose clothing that may also be manually held for gifting.
    return packClothing.find(item => item?.uid === uid) || null;
  }

  function resolveManualHeldThing() {
    const held = rawManualHeldItem(); // Raw selector written by the existing Inventory/Equipment Hold buttons.
    if (!held) return null;
    if (held.kind === 'bagItem') {
      const key = held.key; // Canonical stack key selected by Inventory Hold.
      const count = Math.max(0, Number(deps.inventory?.[key]) || 0); // Live count used only to reject a stale/consumed Hold reference.
      if (!key || count <= 0) return null;
      const def = deps.ITEM_DEFS?.[key] || {}; // Existing item metadata used for actions, labels, and debug output.
      return { kind: 'bagItem', key, count, def, label: def.label || key, icon: def.icon || '✋' };
    }
    if (held.kind === 'clothing') {
      const instance = resolveClothingInstance(held.uid); // Exact gear/pack article referenced by the Hold selector.
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
    baselineItemIndex = null;
    debug.activeSignature = null;
    debug.baselineItemIndex = null;
  }

  function clearManualHeld(reason = 'manual-clear') {
    const held = rawManualHeldItem(); // Current raw selector checked before invoking its canonical clear setter.
    if (!held) {
      resetTracking();
      return false;
    }
    if (typeof deps.clearManualHeldItem === 'function') deps.clearManualHeldItem();
    else deps.setManualHeldItem?.(null);
    resetTracking();
    debug.lastEvent = { type: 'clear', reason, at: Date.now() };
    return true;
  }

  function ordinarySelectionReady() {
    return typeof deps.putAwayHeldEquipment === 'function' && typeof deps.getHeldMode === 'function';
  }

  function activateManualHold(thing, signature, itemIndex) {
    activeSignature = signature;
    baselineItemIndex = Number.isFinite(itemIndex) ? itemIndex : null;
    debug.activeSignature = activeSignature;
    debug.baselineItemIndex = baselineItemIndex;
    deps.putAwayHeldEquipment();
    deps.refreshActionBar?.();
    window.HudUpdate?.refreshItemScroll?.();
    deps.showToast?.(`✋ Holding ${thing.label}.`, true);
    debug.lastEvent = { type: 'activate', signature, label: thing.label, at: Date.now() };
  }

  function syncNow() {
    const rawHeld = rawManualHeldItem(); // Raw value distinguishes "nothing held" from a stale selector that must be cleaned up.
    const thing = resolveManualHeldThing(); // Valid live manual-held item resolved without mutating inventory or wheel state.
    if (rawHeld && !thing) {
      debug.staleClears++;
      clearManualHeld('stale-manual-reference');
      return null;
    }
    if (!thing) {
      resetTracking();
      return null;
    }
    if (!ordinarySelectionReady()) return thing;

    const signature = signatureFor(thing); // Stable identity used to detect a newly pressed Hold button.
    const heldMode = deps.getHeldMode?.() ?? null; // Canonical ordinary held mode controlled by game.js/ActionArcUI.
    const itemIndexValue = Number(deps.getActiveItemIndex?.()); // Current arch index used only to detect explicit wheel navigation.
    const itemIndex = Number.isFinite(itemIndexValue) ? itemIndexValue : null; // Normalized index for comparisons/debug.
    debug.lastHeldMode = heldMode;

    if (signature !== activeSignature) {
      activateManualHold(thing, signature, itemIndex);
      return thing;
    }

    const ordinaryModeSelected = heldMode !== null && heldMode !== undefined && heldMode !== 'none'; // True when the player explicitly drew a tool or wheel item after Hold.
    const itemIndexChanged = baselineItemIndex !== null && itemIndex !== null && itemIndex !== baselineItemIndex; // True when prev/next/wheel navigation selected a different ordinary item.
    if (ordinaryModeSelected || itemIndexChanged) {
      debug.ordinarySelectionClears++;
      clearManualHeld(ordinaryModeSelected ? `ordinary-mode:${heldMode}` : 'item-index-changed');
      return null;
    }
    return thing;
  }

  function getManualBagItem() {
    const thing = resolveManualHeldThing(); // Live manual state queried by consumers that specifically require a bag item.
    if (thing?.kind !== 'bagItem') return null;
    return { ...thing.def, key: thing.key, _manualHeld: true };
  }

  function getHeldBagItem() {
    const manual = getManualBagItem(); // Manual Hold always wins over the ordinary item arch.
    if (manual) return manual;
    if (deps.getHeldMode?.() !== 'item') return null;
    return deps.getActiveInventoryItem?.() || null;
  }

  function getManualGiftItem() {
    const thing = resolveManualHeldThing(); // Manual Hold shape translated to the existing NpcGifting contract.
    if (!thing) return null;
    if (thing.kind === 'clothing') return { kind: 'clothing', instance: thing.instance };
    return { kind: 'bagItem', key: thing.key, def: thing.def };
  }

  function installKeyListener() {
    if (keyListenerInstalled || typeof document === 'undefined') return;
    keyListenerInstalled = true;
    document.addEventListener('keydown', event => {
      const target = event.target; // Focused element used to avoid consuming a typed Z in text fields/contenteditable UI.
      const tagName = String(target?.tagName || '').toLowerCase(); // Normalized tag name for lightweight text-entry filtering.
      const isTextEntry = tagName === 'input' || tagName === 'textarea' || tagName === 'select' || target?.isContentEditable; // Existing browser controls where Z should remain ordinary text input.
      if (isTextEntry || String(event.key || '').toLowerCase() !== 'z' || !rawManualHeldItem()) return;
      clearManualHeld('put-away-key');
    }, true);
  }

  function ensureSynchronizer() {
    if (syncTimer !== null || typeof window.setInterval !== 'function') return;
    syncTimer = window.setInterval(syncNow, 80);
  }

  function wrapInit(name, { giftResolver = false } = {}) {
    const api = window[name]; // Existing parser-loaded module whose normal init call supplies canonical game-state dependencies.
    if (!api?.init || api.__hobunjiHeldItemStateBound) return false;
    const originalInit = api.init.bind(api); // Original one-time initialization preserved exactly after dependency capture.
    api.init = (injectedDeps, ...rest) => {
      mergeDeps(injectedDeps);
      let forwardedDeps = injectedDeps; // Dependency bag passed to the owning module after optional read-only held-gift resolution is added.
      if (giftResolver && injectedDeps && typeof injectedDeps === 'object') {
        const fallbackGetHeldGiftItem = injectedDeps.getHeldGiftItem; // Existing game getter retained for ordinary wheel-held gifts.
        forwardedDeps = {
          ...injectedDeps,
          getHeldGiftItem: () => getManualGiftItem() || fallbackGetHeldGiftItem?.() || null,
        };
      }
      const result = originalInit(forwardedDeps, ...rest); // Owning module's canonical initialization/result.
      debug.captures[name] = true;
      installKeyListener();
      ensureSynchronizer();
      syncNow();
      return result;
    };
    api.__hobunjiHeldItemStateBound = true;
    return true;
  }

  wrapInit('ActionArcUI');
  wrapInit('HudUpdate');
  wrapInit('EquipmentPanel');
  wrapInit('NpcGifting', { giftResolver: true });
  installKeyListener();
  ensureSynchronizer();

  window.HobunjiHeldItemState = {
    version: 1,
    syncNow,
    clearManualHeld,
    getManualHeldThing: resolveManualHeldThing,
    getManualBagItem,
    getHeldBagItem,
    getManualGiftItem,
    getDebug: () => ({ ...debug, captures: { ...debug.captures }, rawManualHeldItem: rawManualHeldItem(), resolvedManualHeldItem: resolveManualHeldThing() }),
    formatDebug: () => {
      const thing = resolveManualHeldThing(); // Current resolved item summarized for copyable mobile diagnostics.
      return `Manual Hold: ${thing ? `${thing.kind}:${thing.key || thing.uid} (${thing.label})` : 'none'} | ordinary=${deps.getHeldMode?.() ?? '?'} | active=${activeSignature || 'none'} | clears=${debug.ordinarySelectionClears}/${debug.staleClears}`;
    },
  };
})();
