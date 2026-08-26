// Contextual held Potion Select adapter.
// Replaces the old Medicine / Utility tap hierarchy with one hold-and-scroll
// selector shared by mobile, mouse-wheel, keyboard, and controller inputs.
(() => {
  'use strict';

  const ROOT_MODE = 'potion-contextual-root'; // Used to bypass the legacy Medicine/Utility branch rules in game.js.
  const BUFF_MODE = 'potion-contextual-buffs'; // Used by the shared arch while browsing buff bottles.
  const FLASK_MODE = 'potion-contextual-flasks'; // Used by the shared arch while browsing throwable flasks.
  const MAX_ITEM_SCAN = 512; // Safety cap used by the ordinary item-wheel bridge when committing a potion stack.
  const DRINK_RESTORE_PAD_MS = 40; // Keeps the bottle visible through the last authored drink-animation frames.

  let installed = false; // Guards the proxy against duplicate installation from load-order retries.
  let stage = null; // Tracks which custom potion view owns the shared arch for release/navigation handling.
  let selectionOriginSlot = null; // Combat slot that was out when the current Potion Select hold began.
  let temporarySelection = null; // Bottle temporarily replacing the remembered combat slot until it is consumed/thrown.
  let restoreTimer = null; // Delayed drink restore so the weapon does not reappear before the swig animation finishes.
  let selectHeldPotion = () => false; // Assigned during install; wheel entries live outside install and call this shared commit bridge.
  let lastRootOrder = []; // Exposed through diagnostics so mobile testing can verify clockwise ordering without DevTools.
  let lastSelection = null; // Exposed through diagnostics to report the most recent committed bottle.
  let lastRestore = null; // Exposed through diagnostics to verify temporary potion handoff and exact combat-slot restoration.
  let lastError = null; // Exposed through diagnostics when a displayed potion cannot be resolved/restored.

  const normalized = value => String(value || '').replace(/\s+/g, ' ').trim();
  const activeSlot = () => document.querySelector('.arc-slot.arc-active:not(.arc-arrow):not(.shared-selection-exit-ghost)');
  const activeId = () => activeSlot()?.dataset?.contextualPotionId || '';
  const activeLabel = () => normalized(activeSlot()?.getAttribute?.('aria-label') || activeSlot()?.title || activeSlot()?.querySelector?.('.arc-label')?.textContent || activeSlot()?.textContent);

  function alchemy() {
    return window.AlchemySystem || null;
  }

  function entryPayload(entry) {
    const A = alchemy();
    return entry?.payload || A?.POTION_ITEMS?.[entry?.itemKey] || A?.parseBrewedItemKey?.(entry?.itemKey) || null;
  }

  function entryDefinition(entry) {
    const A = alchemy();
    const payload = entryPayload(entry);
    return entry?.recipe || A?.RECIPE_DEFS?.[payload?.recipeId] || null;
  }

  function inventoryLabel(entry) {
    const payload = entryPayload(entry);
    const definition = entryDefinition(entry);
    if (!definition) return '';
    const tier = Math.max(0, Math.min(4, Number(payload?.potencyTier) || 0));
    return `${definition.label}${tier ? ` · Potency ${tier + 1}` : ''}`;
  }

  function currentCombatSlot() {
    const stanceSlot = window.WeaponToolStances?.debugSnapshot?.()?.activeSlot;
    if (stanceSlot === 'weapon' || stanceSlot === 'ranged') return stanceSlot;
    const actions = [...document.querySelectorAll('#btnAction1,#btnAction2,#btnAction3')].map(button => button?.dataset?.action).filter(Boolean);
    if (actions.includes('shoot') || actions.includes('ammo_select')) return 'ranged';
    if (actions.includes('cut') || actions.includes('slash')) return 'weapon';
    return null;
  }

  function drinkRestoreDelayMs() {
    const animation = window.HeldActionAnimations?.drink;
    if (!animation) return 0;
    const durationS = Math.max(0.1, Number(animation.durationS) || 0.95);
    const strikeFrac = Math.max(0, Math.min(1, Number(animation.strikeFrac) || 0.62));
    return Math.max(0, Math.round(durationS * (1 - strikeFrac) * 1000) + DRINK_RESTORE_PAD_MS);
  }

  function restorePreviousEquipment(reason, itemKey) {
    if (!temporarySelection || (itemKey && temporarySelection.itemKey !== itemKey)) return false;
    if (restoreTimer) { clearTimeout(restoreTimer); restoreTimer = null; }
    const pending = temporarySelection;
    temporarySelection = null;
    const switchButton = document.getElementById('btnWeaponSwitch');
    if (!pending.priorSlot || !switchButton?.click) {
      lastError = `Potion Select consumed ${pending.label}, but could not restore the previous combat slot.`;
      lastRestore = { ok:false, reason, itemKey:pending.itemKey, priorSlot:pending.priorSlot, restoredSlot:currentCombatSlot(), at:Date.now() };
      return false;
    }

    // From item mode the existing combat quick-switch first re-enters a combat
    // slot. If that is the opposite slot, one additional click returns to the
    // exact melee/ranged slot that was active before Potion Select.
    switchButton.click();
    let restoredSlot = currentCombatSlot();
    if (restoredSlot !== pending.priorSlot) {
      switchButton.click();
      restoredSlot = currentCombatSlot();
    }
    const ok = restoredSlot === pending.priorSlot;
    lastRestore = { ok, reason, itemKey:pending.itemKey, priorSlot:pending.priorSlot, restoredSlot, at:Date.now() };
    lastError = ok ? null : `Potion Select could not return to ${pending.priorSlot} after ${reason}.`;
    return ok;
  }

  function scheduleDrinkRestore(itemKey) {
    if (!temporarySelection || temporarySelection.itemKey !== itemKey) return false;
    const delayMs = drinkRestoreDelayMs();
    if (!(delayMs > 0)) return restorePreviousEquipment('drink', itemKey);
    if (restoreTimer) clearTimeout(restoreTimer);
    restoreTimer = setTimeout(() => {
      restoreTimer = null;
      restorePreviousEquipment('drink', itemKey);
    }, delayMs);
    return true;
  }

  function wheelEntry(entry, className = 'potion-contextual') {
    const definition = entryDefinition(entry);
    const label = inventoryLabel(entry);
    if (!entry?.itemKey || !definition || !label) return null;
    return {
      id: entry.itemKey,
      icon: definition.icon || '🧪',
      label: `${label} ×${Math.max(1, Number(entry.count) || 1)}`,
      className,
      disabled: false,
      onSelect: () => selectHeldPotion(entry),
    };
  }

  function rootSpacer(side) {
    return {
      id:`spacer-${side}`,
      icon:'',
      label:'',
      className:`potion-category potion-contextual-spacer potion-contextual-spacer-${side}`,
      disabled:true,
      onSelect:() => false,
    };
  }

  function markEntryIds() {
    // The core arch deliberately keeps entry data private; this small DOM mirror
    // lets this adapter identify its gateways after pointer/wheel navigation.
    document.querySelectorAll('.arc-slot:not(.arc-arrow)').forEach(slot => {
      const label = normalized(slot.getAttribute('aria-label') || slot.title || slot.querySelector?.('.arc-label')?.textContent || slot.textContent);
      if (slot.classList.contains('potion-contextual-spacer')) slot.dataset.contextualPotionId = 'spacer';
      else if (label === 'Buffs') slot.dataset.contextualPotionId = 'buffs';
      else if (label === 'Flasks') slot.dataset.contextualPotionId = 'flasks';
      else if (label === 'Cancel') slot.dataset.contextualPotionId = 'cancel';
      else slot.dataset.contextualPotionId = 'item';
    });
  }

  function install() {
    if (installed) return true;
    const arc = window._desktopSelectionArc;
    const A = alchemy();
    if (!arc?.openEntries || !arc?.openPotions || !arc?.scrollEntries || !arc?.scrollItem || !arc?.openItem || !arc?.commit || !arc?.movePointer || !A?.contextualRestoratives || !A?.potionCategoryState) return false;

    installed = true;
    const baseOpenEntries = arc.openEntries.bind(arc); // Used to render every custom potion view on the existing shared arch.
    const baseOpenItem = arc.openItem.bind(arc); // Used only during an instantaneous commit bridge to the normal inventory selector.
    const baseScrollItem = arc.scrollItem.bind(arc); // Used to find the exact potency-specific stack in the ordinary inventory selector.
    const baseScrollEntries = arc.scrollEntries.bind(arc); // Used for generic movement inside custom modes that avoid legacy branch names.
    const baseMovePointer = arc.movePointer.bind(arc); // Used by mobile drag and pointer-held Potion Select.
    const baseCommit = arc.commit.bind(arc); // Used because legacy releaseSelection intentionally cancels non-item potion branches.
    const baseClose = arc.close.bind(arc); // Used to close custom roots/categories and the hidden item-selection bridge.

    const spacerStyle = document.createElement?.('style'); // Keeps balance-only root slots in layout while making them completely invisible/non-interactive.
    if (spacerStyle && !document.getElementById?.('contextualPotionSelectorSpacerStyle')) {
      spacerStyle.id = 'contextualPotionSelectorSpacerStyle';
      spacerStyle.textContent = `
        body .arc-slot.potion-contextual-spacer {
          --shared-selection-opacity:0 !important;
          opacity:0 !important;
          background:transparent !important;
          border-color:transparent !important;
          box-shadow:none !important;
          pointer-events:none !important;
        }
        body .arc-slot.potion-contextual-spacer .arc-icon,
        body .arc-slot.potion-contextual-spacer .arc-label { display:none !important; }
      `;
      (document.head || document.body)?.appendChild?.(spacerStyle);
    }

    function closeSelector() {
      stage = null;
      selectionOriginSlot = null;
      baseClose();
    }

    function currentCategoryEntries(kind) {
      const state = A.potionCategoryState() || {};
      if (kind === 'buffs') return state.buffs?.items || [];
      return state.flasks?.items || [];
    }

    function openCategory(kind) {
      const raw = currentCategoryEntries(kind);
      const itemEntries = raw.map(entry => wheelEntry(entry, `potion-contextual potion-${kind}-item`)).filter(Boolean);
      const cancel = { id:'cancel', icon:'✕', label:'Cancel', className:'potion-cancel', active:true, disabled:false, onSelect:closeSelector };
      // Buffs extend farther counterclockwise from their left gateway; flasks
      // extend farther clockwise from their right gateway. Cancel occupies the
      // gateway edge so the same continued scroll direction enters the items.
      const entries = kind === 'buffs' ? [...itemEntries.reverse(), cancel] : [cancel, ...itemEntries];
      stage = kind;
      baseOpenEntries(kind === 'buffs' ? BUFF_MODE : FLASK_MODE, entries);
      markEntryIds();
      return true;
    }

    function contextualRootEntries() {
      const context = (A.contextualRestoratives() || []).slice();
      const categoryState = A.potionCategoryState() || {};
      const contextual = context.reverse().map(entry => wheelEntry(entry)).filter(Boolean); // Highest-scored restorative ends nearest Cancel.
      const buffs = categoryState.buffs?.items || [];
      const flasks = categoryState.flasks?.items || [];
      const buffGateway = buffs.length ? { id:'buffs', icon:'✨', label:'Buffs', className:'potion-category potion-buff-gateway', disabled:false, onSelect:() => openCategory('buffs') } : null;
      const flaskGateway = flasks.length ? { id:'flasks', icon:'🫙', label:'Flasks', className:'potion-category potion-flask-gateway', disabled:false, onSelect:() => openCategory('flasks') } : null;
      const cancel = { id:'cancel', icon:'✕', label:'Cancel', className:'potion-cancel', active:true, disabled:false, onSelect:closeSelector };

      // With no currently useful medicine, keep Cancel physically at the same
      // center point regardless of whether Buffs/Flasks exist. Invisible blocked
      // spacers preserve the three-slot geometry and also prevent the old
      // Medicine/Utility curved breadcrumb from leaking into this root view.
      const entries = contextual.length
        ? [
            ...(buffGateway ? [buffGateway] : []),
            ...contextual,
            cancel,
            ...(flaskGateway ? [flaskGateway] : []),
          ]
        : [buffGateway || rootSpacer('left'), cancel, flaskGateway || rootSpacer('right')];
      lastRootOrder = entries.filter(entry => !String(entry.id).startsWith('spacer-')).map(entry => entry.label);
      return entries;
    }

    function openRoot() {
      stage = 'root';
      selectionOriginSlot = currentCombatSlot();
      lastError = null;
      baseOpenEntries(ROOT_MODE, contextualRootEntries());
      markEntryIds();
      return true;
    }

    function returnFromSpacer() {
      if (stage !== 'root' || activeId() !== 'spacer') return false;
      const slot = activeSlot();
      const backDir = slot?.classList.contains('potion-contextual-spacer-left') ? 1 : -1;
      baseScrollEntries(backDir);
      markEntryIds();
      return true;
    }

    function maybeEnterGateway(pointerX = null, pointerY = null) {
      if (stage !== 'root') return false;
      const id = activeId();
      if (id !== 'buffs' && id !== 'flasks') return false;
      const slot = activeSlot();
      if (slot?.classList.contains('blocked')) return false;
      openCategory(id);
      if (Number.isFinite(pointerX) && Number.isFinite(pointerY)) baseMovePointer(pointerX, pointerY);
      return true;
    }

    function selectedInventoryLabel() {
      return normalized(document.getElementById('itemName')?.textContent);
    }

    selectHeldPotion = function selectHeldPotionEntry(entry) {
      const targetLabel = inventoryLabel(entry);
      if (!targetLabel) {
        lastError = `Potion Select could not resolve ${entry?.itemKey || '(unknown item)'}.`;
        closeSelector();
        return false;
      }

      // Commit through the existing item selector instead of mutating private
      // activeItemIndex/heldMode state. All changes remain inside the ordinary
      // inventory path, including potency-specific stacks and action refreshes.
      const priorSlot = selectionOriginSlot || currentCombatSlot();
      stage = null;
      baseClose();
      baseOpenItem();
      let found = selectedInventoryLabel() === targetLabel;
      for (let scans = 0; !found && scans < MAX_ITEM_SCAN; scans++) {
        baseScrollItem(1);
        found = selectedInventoryLabel() === targetLabel;
      }
      if (!found) {
        selectionOriginSlot = null;
        lastError = `Potion Select displayed ${targetLabel}, but the inventory selector could not find that stack.`;
        baseClose();
        return false;
      }
      lastSelection = { itemKey:entry.itemKey, label:targetLabel, priorSlot, at:Date.now() };
      temporarySelection = { itemKey:entry.itemKey, label:targetLabel, priorSlot, selectedAt:Date.now() };
      selectionOriginSlot = null;
      lastError = null;
      baseCommit();
      return true;
    };

    if (!A.__contextualPotionRestoreHooked && typeof A.drinkPotion === 'function') {
      const originalDrinkPotion = A.drinkPotion;
      A.drinkPotion = function contextualPotionRestoreDrink(itemKey, ...args) {
        const result = originalDrinkPotion.call(this, itemKey, ...args);
        if (result?.ok) scheduleDrinkRestore(itemKey);
        return result;
      };
      Object.defineProperty(A, '__contextualPotionRestoreHooked', { value:true, configurable:true });
    }

    document.addEventListener?.('hobunji-alchemy-change', event => {
      if (event?.detail?.type === 'flask-release') restorePreviousEquipment('flask-release', event.detail.itemKey);
    });

    const overrides = {
      openPotions() { return openRoot(); },
      scrollEntries(dir) {
        if (!stage) return baseScrollEntries(dir);
        const moved = baseScrollEntries(dir);
        markEntryIds();
        if (returnFromSpacer()) return moved;
        maybeEnterGateway();
        return moved;
      },
      movePointer(x, y) {
        const result = baseMovePointer(x, y);
        markEntryIds();
        if (returnFromSpacer()) return result;
        maybeEnterGateway(x, y);
        return result;
      },
      releaseSelection() {
        if (!stage) return arc.releaseSelection();
        // Root starts on Cancel, so releasing the original held input without
        // movement executes Cancel. Contextual/category items commit normally.
        return baseCommit();
      },
      close() { closeSelector(); },
    };

    const bound = new Map(); // Keeps non-overridden methods stable when accessed through the proxy.
    const proxy = new Proxy(arc, {
      get(target, property) {
        if (Object.prototype.hasOwnProperty.call(overrides, property)) return overrides[property];
        const value = Reflect.get(target, property, target);
        if (typeof value !== 'function') return value;
        if (!bound.has(property)) bound.set(property, value.bind(target));
        return bound.get(property);
      },
      set(target, property, value) { return Reflect.set(target, property, value, target); },
    });

    window._desktopSelectionArc = proxy;
    if (window.SharedSelectionArch === arc) window.SharedSelectionArch = proxy;

    const diagnostics = () => ({
      installed,
      mode:'hold-scroll-contextual',
      stage,
      active:activeLabel(),
      selectionOriginSlot,
      temporarySelection:temporarySelection && { ...temporarySelection },
      rootOrder:lastRootOrder.slice(),
      contextual:(A.contextualRestoratives() || []).map(entry => ({ itemKey:entry.itemKey, label:inventoryLabel(entry), score:entry.score, count:entry.count })),
      buffs:currentCategoryEntries('buffs').map(entry => ({ itemKey:entry.itemKey, label:inventoryLabel(entry), count:entry.count })),
      flasks:currentCategoryEntries('flasks').map(entry => ({ itemKey:entry.itemKey, label:inventoryLabel(entry), count:entry.count })),
      lastSelection:lastSelection && { ...lastSelection },
      lastRestore:lastRestore && { ...lastRestore },
      lastError,
    });
    window.ContextualPotionSelector = Object.freeze({ diagnostics, open:openRoot, restorePreviousEquipment });
    window.MobilePotionTapNavigation = window.ContextualPotionSelector; // Compatibility alias for existing mobile debug probes.
    window.MobilePotionCategoryDrag = window.ContextualPotionSelector; // Compatibility alias for the legacy script name.
    return true;
  }

  if (!install()) {
    const retryTimer = setInterval(() => { if (install()) clearInterval(retryTimer); }, 50); // Handles script-order races without requiring game.js changes.
    setTimeout(() => clearInterval(retryTimer), 10000);
  }
})();
