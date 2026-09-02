(() => {
  'use strict';

  // Shipping box transfer UI (Pack <-> box) plus the standalone floating
  // window used when the in-world Shipping Box is opened.
  let deps = null;
  let standaloneOpen = false; // Used to suppress camera/game input while the shipping window is visible.
  let standaloneRoot = null; // Used to host #mpShipping outside the main menu panel.
  let standalonePreviousFocus = null; // Used to restore keyboard focus after closing the shipping window.
  let standaloneDebugVisible = false; // Used by the in-window mobile-friendly diagnostics toggle.

  function init(injectedDeps) {
    deps = injectedDeps;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', ensureStandaloneWindow, { once: true });
    } else {
      ensureStandaloneWindow();
    }
  }

  // Narrow bridge for modular content catalogs. ITEM_DEFS and BASE_PRICES are
  // live objects owned by game.js; mutating them here keeps inventory, item
  // info, shipping, and every other reader on the same canonical records.
  function registerItemDefinitions(definitions = {}, basePrices = {}) {
    if (!deps?.ITEM_DEFS || !deps?.BASE_PRICES) return false;
    Object.entries(definitions).forEach(([key, definition]) => {
      deps.ITEM_DEFS[key] = { ...(deps.ITEM_DEFS[key] || {}), ...definition };
    });
    Object.entries(basePrices).forEach(([key, price]) => {
      deps.BASE_PRICES[key] = price;
    });
    return true;
  }

  let shippingSelected = { side: 'left', key: null }; // Used by the transfer controls.
  let shippingAmount = 1; // Used by the stepper and transfer buttons.
  const shippingActiveCat = { left: 'all', right: 'all' }; // Used by the category filters.

  function getShippingBoxContents() {
    const shippingBoxObject = deps?.getShippingBoxObject?.();
    return shippingBoxObject?.getContents?.() || {};
  }

  function getShippingKeys(side) {
    if (!deps) return [];
    const source = side === 'right' ? getShippingBoxContents() : deps.inventory;
    return Object.keys(deps.ITEM_DEFS).filter(key => {
      const def = deps.ITEM_DEFS[key];
      const cat = shippingActiveCat[side];
      if (cat !== 'all' && def.cat !== cat) return false;
      return (source[key] || 0) > 0;
    });
  }

  function getShippingCount(side, key) {
    if (!deps) return 0;
    return side === 'right' ? (getShippingBoxContents()[key] || 0) : (deps.inventory[key] || 0);
  }

  function canShipKey(key) {
    return !!deps && deps.BASE_PRICES[key] !== undefined;
  }

  function selectShippingItem(side, key) {
    shippingSelected = { side, key };
    shippingAmount = Math.max(1, Math.min(shippingAmount, getShippingCount(side, key) || 1));
    buildShippingTransferUI();
  }

  function bumpShippingAmount(delta) {
    const key = shippingSelected.key;
    if (!key) return;
    const max = Math.max(1, getShippingCount(shippingSelected.side, key));
    shippingAmount = Math.max(1, Math.min(max, shippingAmount + delta));
    buildShippingTransferUI();
  }

  function transferShippingAmount(mode) {
    const key = shippingSelected.key;
    const shippingBoxObject = deps?.getShippingBoxObject?.();
    if (!key || !shippingBoxObject) return;
    const count = getShippingCount(shippingSelected.side, key);
    if (count < 1) return;
    let qty = shippingAmount;
    if (mode === 'half') qty = Math.max(1, Math.floor(count / 2));
    if (mode === 'stack') qty = count;
    qty = Math.max(1, Math.min(qty, count));

    let moved = 0;
    if (shippingSelected.side === 'left') {
      if (!canShipKey(key)) { deps.showToast('That item cannot be shipped.', false); return; }
      moved = shippingBoxObject.depositItem(key, qty);
      if (moved > 0) deps.showToast(`📦 Shipped ${moved}× ${deps.ITEM_DEFS[key].label}`, true);
    } else {
      // Taking items back OUT of storage is owner/granted-farmhand only —
      // depositing into it is always allowed.
      if (!deps.hasFarmPermission('storage')) {
        deps.showToast("Only the farm's owner (or a granted farmhand) can take from storage.", false);
        return;
      }
      moved = shippingBoxObject.withdrawItem(key, qty);
      if (moved > 0) deps.showToast(`↩ Took back ${moved}× ${deps.ITEM_DEFS[key].label}`, true);
    }
    if (moved < 1) return;
    deps.clampInventoryStack(key);
    const remaining = getShippingCount(shippingSelected.side, key);
    if (remaining < 1) shippingSelected.key = null;
    shippingAmount = 1;
    deps.buildInventoryGrid();
    buildShippingTransferUI();
    deps.refreshItemScroll();
    deps.saveMemberWorldData();
  }

  function renderShippingGrid(side) {
    const grid = document.getElementById(side === 'left' ? 'shipLeftGrid' : 'shipRightGrid');
    if (!grid || !deps) return;
    grid.innerHTML = '';
    const keys = getShippingKeys(side);
    keys.forEach(key => {
      const def = deps.ITEM_DEFS[key];
      const count = getShippingCount(side, key);
      const blocked = side === 'left' && !canShipKey(key);
      const slot = document.createElement('button');
      slot.className = 'ship-slot' + (shippingSelected.side === side && shippingSelected.key === key ? ' selected' : '') + (blocked ? ' blocked' : '');
      slot.dataset.side = side;
      slot.dataset.key = key;
      slot.innerHTML = `<span class="ship-slot-icon">${def.icon}</span><span class="ship-slot-count">×${count}</span>${side === 'right' ? '<span class="ship-slot-pending">BOX</span>' : ''}`;
      slot.addEventListener('click', () => selectShippingItem(side, key));
      grid.appendChild(slot);
    });
    if (keys.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'ship-footer';
      empty.textContent = side === 'right' ? 'Shipping box is empty.' : 'No items in this filter.';
      grid.appendChild(empty);
    }
  }

  function buildShippingTransferUI() {
    if (!document.getElementById('mpShipping') || !deps) return;
    renderShippingGrid('left');
    renderShippingGrid('right');

    const leftStacks = Object.keys(deps.ITEM_DEFS).filter(k => (deps.inventory[k] || 0) > 0).length;
    const shippingBoxObject = deps.getShippingBoxObject();
    const boxTotal = shippingBoxObject?.getTotalItems?.() || 0;
    const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    setText('shipLeftCap', `${leftStacks} stacks`);
    setText('shipRightCap', boxTotal > 0 ? `${boxTotal} queued` : 'Empty');

    const key = shippingSelected.key;
    const def = key ? deps.ITEM_DEFS[key] : null;
    const count = key ? getShippingCount(shippingSelected.side, key) : 0;
    const max = Math.max(1, count);
    shippingAmount = Math.max(1, Math.min(shippingAmount, max));
    const blocked = key && shippingSelected.side === 'left' && !canShipKey(key);
    const direction = !key ? '↔' : (shippingSelected.side === 'left' ? '→ Box' : '← Bag');

    setText('shipPreviewIcon', def ? def.icon : '📦');
    setText('shipPreviewName', def ? `${def.label} ×${count}` : 'Select item');
    setText('shipDirection', blocked ? 'Blocked' : direction);
    setText('shipAmount', String(shippingAmount));
    setText('shipLeftFooter', shippingSelected.side === 'left' && def ? `${def.label} ×${count}` : 'Select a player item.');
    setText('shipRightFooter', shippingSelected.side === 'right' && def ? `${def.label} ×${count}` : 'Select a boxed item to take it back before sale.');
    setText('shipDetailIcon', def ? def.icon : '📦');
    setText('shipDetailName', def ? def.label : 'Shipping Box Transfer');
    setText('shipDetailValue', def && canShipKey(key) ? `${deps.BASE_PRICES[key]}g each` : (def ? 'Not sellable' : '—'));
    setText('shipDetailDesc', def ? `${def.desc}${blocked ? ' This item stays in your bag because the shipping box only accepts sellable goods.' : ''}` : 'Move sellable crops and materials from the player bag into the shipping box. Select items already in the box to pull them back out before the timed sale.');
    const tags = document.getElementById('shipDetailTags');
    if (tags) tags.innerHTML = def ? def.tags.map(t => `<span class="ship-tag">${t}</span>`).join('') : '<span class="ship-tag">Player ↔ Box</span><span class="ship-tag">Instant transfer</span>';

    const hasTransfer = !!key && count > 0 && !blocked;
    ['shipAmtMinus','shipAmtPlus','shipTransferOne','shipTransferHalf','shipTransferStack'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = !hasTransfer;
    });
    setText('shipTransferOne', shippingSelected.side === 'left' ? 'Ship 1' : 'Take 1');
    setText('shipTransferHalf', shippingSelected.side === 'left' ? 'Ship Half' : 'Take Half');
    setText('shipTransferStack', shippingSelected.side === 'left' ? 'Ship Stack' : 'Take Stack');
    updateStandaloneChrome();
  }

  function injectStandaloneStyles() {
    if (document.getElementById('shippingStandaloneStyles')) return;
    const style = document.createElement('style');
    style.id = 'shippingStandaloneStyles';
    style.textContent = `
      #shippingStandaloneRoot {
        --shipping-pane-w: min(94vw, calc(27 * var(--col)));
        --shipping-pane-h: min(76vh, calc(14 * var(--row) - 1.18 * var(--row)));
        position: fixed;
        inset: 0;
        z-index: 120;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: max(8px, env(safe-area-inset-top)) max(8px, env(safe-area-inset-right)) max(8px, env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left));
        background: rgba(0, 0, 0, 0.22);
        touch-action: none;
      }
      #shippingStandaloneRoot[hidden] { display: none !important; }
      #shippingStandaloneWindow {
        width: calc(var(--shipping-pane-w) + 16px);
        max-width: 96vw;
        max-height: 90vh;
        display: grid;
        grid-template-rows: auto minmax(0, var(--shipping-pane-h)) auto;
        overflow: hidden;
        border: 1px solid var(--border-bright);
        border-radius: 16px;
        background: var(--glass-2);
        box-shadow: 0 18px 60px rgba(0,0,0,.58);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        outline: none;
      }
      .shipping-window-bar {
        min-height: 42px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 7px 9px 7px 12px;
        border-bottom: 1px solid var(--border);
        background: rgba(255,255,255,.035);
      }
      .shipping-window-heading { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
      #shippingStandaloneTitle { color: var(--accent); font-size: 13px; }
      #shippingWindowStatus { color: var(--muted); font-size: 9px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .shipping-window-actions { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; }
      .shipping-window-btn {
        min-width: 34px;
        min-height: 30px;
        padding: 4px 8px;
        border: 1px solid var(--border-bright);
        border-radius: 8px;
        background: rgba(255,255,255,.055);
        color: var(--text);
        font-size: 10px;
      }
      .shipping-window-btn:hover, .shipping-window-btn:focus-visible { border-color: var(--accent); color: var(--accent); }
      #shippingWindowClose { font-size: 18px; line-height: 1; }
      #shippingStandaloneBody { position: relative; min-width: 0; min-height: 0; padding: 8px; overflow: hidden; }
      #shippingStandaloneBody #mpShipping {
        --tr-col: calc(var(--shipping-pane-w) / 60);
        --tr-row: calc(var(--shipping-pane-h) / 32);
        width: var(--shipping-pane-w);
        height: var(--shipping-pane-h) !important;
        display: block !important;
        position: relative;
      }
      #shippingWindowDebugPanel {
        max-height: 25vh;
        overflow: auto;
        margin: 0;
        padding: 7px 10px;
        border-top: 1px solid var(--border);
        background: rgba(0,0,0,.24);
        color: var(--muted);
        font: 9px/1.35 'DM Mono', monospace;
        white-space: pre-wrap;
      }
      #shippingWindowDebugPanel[hidden] { display: none !important; }
      /* Ordinary pack inspection is no longer a point-of-sale surface. */
      #iiActions .ii-btn.sell { display: none !important; }
      @media (max-width: 740px) {
        #shippingStandaloneRoot {
          --shipping-pane-w: 94vw;
          --shipping-pane-h: min(74vh, calc(14 * var(--row) - .3 * var(--row)));
          align-items: flex-start;
        }
        #shippingStandaloneWindow { margin-top: max(4px, env(safe-area-inset-top)); width: 96vw; max-height: 94vh; }
        .shipping-window-bar { min-height: 38px; padding: 5px 7px 5px 9px; }
        #shippingStandaloneTitle { font-size: 12px; }
        #shippingWindowStatus { font-size: 8px; }
        .shipping-window-btn { min-height: 28px; padding-inline: 6px; }
      }
    `;
    document.head.appendChild(style);
  }

  function stopStandaloneInputPropagation(event) {
    if (standaloneOpen) event.stopPropagation();
  }

  function releasePointerLock() {
    if (!standaloneOpen || !document.pointerLockElement || typeof document.exitPointerLock !== 'function') return;
    try { document.exitPointerLock(); } catch (_) {}
  }

  function getSellableInventory() {
    if (!deps) return [];
    return Object.keys(deps.ITEM_DEFS).flatMap(key => {
      const count = Math.max(0, Number(deps.inventory[key]) || 0);
      const price = Number(deps.BASE_PRICES[key]);
      const def = deps.ITEM_DEFS[key];
      if (count < 1 || !Number.isFinite(price) || price < 0 || !def) return [];
      return [{ key, count, price, icon: def.icon || '📦', label: def.label || key, desc: def.desc || '', cat: def.cat || '' }];
    });
  }

  function sellInventoryAtStore(key, quantity = 1) {
    if (!deps || deps.BASE_PRICES[key] === undefined) return { moved: 0, earned: 0 };
    const available = Math.max(0, Number(deps.inventory[key]) || 0);
    const requested = quantity === 'stack' ? available : Math.max(1, Math.floor(Number(quantity) || 1));
    const moved = Math.min(available, requested);
    if (moved < 1) return { moved: 0, earned: 0 };
    const price = Math.max(0, Number(deps.BASE_PRICES[key]) || 0);
    const earned = moved * price;
    deps.inventory[key] -= moved;
    deps.clampInventoryStack(key);
    deps.inventory.gold = (deps.inventory.gold || 0) + earned;
    deps.buildInventoryGrid();
    deps.refreshItemScroll();
    deps.saveMemberWorldData();
    return { moved, earned };
  }

  function getDebugState() {
    const box = deps?.getShippingBoxObject?.();
    const pane = document.getElementById('mpShipping');
    return {
      open: standaloneOpen,
      pointerLocked: !!document.pointerLockElement,
      panelParent: pane?.parentElement?.id || null,
      queuedItems: box?.getTotalItems?.() || 0,
      selectedSide: shippingSelected.side,
      selectedKey: shippingSelected.key,
      selectedAmount: shippingAmount,
      boxPosition: box ? { col: box.col, row: box.row, width: box.w || 1, height: box.h || 1 } : null,
    };
  }

  function updateStandaloneChrome() {
    if (!standaloneRoot) return;
    const state = getDebugState();
    const status = document.getElementById('shippingWindowStatus');
    if (status) status.textContent = `${state.queuedItems} queued · camera input blocked`;
    const debugPanel = document.getElementById('shippingWindowDebugPanel');
    if (debugPanel && standaloneDebugVisible) debugPanel.textContent = JSON.stringify(state, null, 2);
  }

  function closeStandalone() {
    if (!standaloneOpen) return false;
    standaloneOpen = false;
    if (standaloneRoot) {
      standaloneRoot.hidden = true;
      standaloneRoot.setAttribute('aria-hidden', 'true');
    }
    const pane = document.getElementById('mpShipping');
    pane?.classList.remove('shipping-standalone-pane');
    updateStandaloneChrome();
    const restore = standalonePreviousFocus;
    standalonePreviousFocus = null;
    if (restore && typeof restore.focus === 'function' && document.contains(restore)) {
      try { restore.focus({ preventScroll: true }); } catch (_) { restore.focus(); }
    }
    return true;
  }

  function openStandalone() {
    ensureStandaloneWindow();
    if (!standaloneRoot || !deps) return false;
    standalonePreviousFocus = document.activeElement;
    standaloneOpen = true;
    standaloneRoot.hidden = false;
    standaloneRoot.setAttribute('aria-hidden', 'false');
    document.getElementById('mpShipping')?.classList.add('shipping-standalone-pane');
    releasePointerLock();
    buildShippingTransferUI();
    updateStandaloneChrome();
    const dialog = document.getElementById('shippingStandaloneWindow');
    requestAnimationFrame(() => {
      releasePointerLock();
      try { dialog?.focus({ preventScroll: true }); } catch (_) { dialog?.focus(); }
    });
    return true;
  }

  function ensureStandaloneWindow() {
    if (standaloneRoot) return standaloneRoot;
    const pane = document.getElementById('mpShipping');
    if (!pane || !document.body) return null;
    injectStandaloneStyles();

    const root = document.createElement('div');
    root.id = 'shippingStandaloneRoot';
    root.hidden = true;
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML = `
      <section id="shippingStandaloneWindow" role="dialog" aria-modal="true" aria-labelledby="shippingStandaloneTitle" tabindex="-1">
        <header class="shipping-window-bar">
          <div class="shipping-window-heading">
            <strong id="shippingStandaloneTitle">📦 Shipping Box</strong>
            <span id="shippingWindowStatus">0 queued · camera input blocked</span>
          </div>
          <div class="shipping-window-actions">
            <button type="button" class="shipping-window-btn" id="shippingWindowDebug" aria-expanded="false">Debug</button>
            <button type="button" class="shipping-window-btn" id="shippingWindowClose" aria-label="Close shipping box">×</button>
          </div>
        </header>
        <div id="shippingStandaloneBody"></div>
        <pre id="shippingWindowDebugPanel" hidden></pre>
      </section>`;
    document.body.appendChild(root);
    document.getElementById('shippingStandaloneBody').appendChild(pane);
    standaloneRoot = root;

    // The legacy pane's own Close button is wired by game.js to closeMenu().
    // Capture it before that target listener runs so standalone shipping never
    // changes main-menu pause/pointer-lock state as a side effect of closing.
    root.addEventListener('click', event => {
      if (!event.target?.closest?.('#shipCloseBtn')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      closeStandalone();
    }, true);

    // Bubble-phase blockers let the shipping controls receive input normally,
    // then prevent the hidden canvas camera/action listeners from seeing it.
    ['pointerdown','pointermove','pointerup','mousedown','mousemove','mouseup','touchstart','touchmove','touchend','wheel','contextmenu','click'].forEach(type => {
      root.addEventListener(type, stopStandaloneInputPropagation);
    });
    const dialog = document.getElementById('shippingStandaloneWindow');
    dialog.addEventListener('keydown', event => {
      if (!standaloneOpen) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeStandalone();
      }
      event.stopPropagation();
    });
    dialog.addEventListener('keyup', stopStandaloneInputPropagation);
    document.getElementById('shippingWindowClose').addEventListener('click', closeStandalone);
    document.getElementById('shippingWindowDebug').addEventListener('click', event => {
      standaloneDebugVisible = !standaloneDebugVisible;
      event.currentTarget.setAttribute('aria-expanded', String(standaloneDebugVisible));
      const panel = document.getElementById('shippingWindowDebugPanel');
      panel.hidden = !standaloneDebugVisible;
      updateStandaloneChrome();
    });
    root.addEventListener('click', event => {
      if (event.target === root) closeStandalone();
    });
    document.addEventListener('pointerlockchange', () => {
      if (standaloneOpen && document.pointerLockElement) releasePointerLock();
      updateStandaloneChrome();
    });
    return root;
  }

  window.ShippingPanel = {
    init,
    registerItemDefinitions,
    build: buildShippingTransferUI,
    selectItem: selectShippingItem,
    bumpAmount: bumpShippingAmount,
    transferAmount: transferShippingAmount,
    setActiveCat: (side, cat) => { shippingActiveCat[side] = cat; },
    getActiveCat: (side) => shippingActiveCat[side],
    open: openStandalone,
    close: closeStandalone,
    isOpen: () => standaloneOpen,
    getDebugState,
    getSellableInventory,
    sellInventoryAtStore,
  };
})();
