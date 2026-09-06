(() => {
  'use strict';

  // Pack <-> Shipping Box transfer UI plus its standalone floating window.
  // ShippingBoxConfig owns the feature's tuning/labels/style values.
  let deps = null;
  let standaloneOpen = false;
  let standaloneRoot = null;
  let standalonePreviousFocus = null;
  let standaloneDebugVisible = false;
  let shippingSelected = { side: null, key: null };
  let shippingAmount = 0;
  const shippingActiveCat = Object.create(null);

  function config() {
    if (!window.ShippingBoxConfig) throw new Error('ShippingBoxConfig must load before ShippingPanel.init');
    return window.ShippingBoxConfig;
  }
  const panelCfg = () => config().panel;
  const inventoryCfg = () => config().inventory;
  const storeCfg = () => config().store;

  function initializeConfiguredState() {
    const panel = panelCfg();
    if (!shippingSelected.side) shippingSelected.side = panel.defaultSide;
    if (shippingAmount < 1) shippingAmount = Number(panel.defaultAmount);
    if (!shippingActiveCat[panel.defaultSide]) shippingActiveCat[panel.defaultSide] = panel.allCategory;
    if (!shippingActiveCat[panel.boxSide]) shippingActiveCat[panel.boxSide] = panel.allCategory;
  }

  function init(injectedDeps) {
    config();
    initializeConfiguredState();
    deps = injectedDeps;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensureStandaloneWindow, { once: true });
    else ensureStandaloneWindow();
  }

  function registerItemDefinitions(definitions = {}, basePrices = {}) {
    if (!deps?.ITEM_DEFS || !deps?.BASE_PRICES) return false;
    Object.entries(definitions).forEach(([key, definition]) => {
      deps.ITEM_DEFS[key] = { ...(deps.ITEM_DEFS[key] || {}), ...definition };
    });
    Object.entries(basePrices).forEach(([key, price]) => { deps.BASE_PRICES[key] = price; });
    return true;
  }

  function getShippingBoxContents() {
    return deps?.getShippingBoxObject?.()?.getContents?.() || {};
  }

  function isBoxSide(side) {
    return side === panelCfg().boxSide;
  }

  function getShippingKeys(side) {
    if (!deps) return [];
    initializeConfiguredState();
    const source = isBoxSide(side) ? getShippingBoxContents() : deps.inventory;
    return Object.keys(deps.ITEM_DEFS).filter(key => {
      const def = deps.ITEM_DEFS[key];
      const cat = shippingActiveCat[side];
      if (cat !== panelCfg().allCategory && def.cat !== cat) return false;
      return (source[key] || 0) > 0;
    });
  }

  function getShippingCount(side, key) {
    if (!deps) return 0;
    return isBoxSide(side) ? (getShippingBoxContents()[key] || 0) : (deps.inventory[key] || 0);
  }

  // Mirrors FarmCrates' own sellPriceFor: raw crops price through
  // deps.BASE_PRICES, but every processed good (jam, wine, butter, cheese,
  // flour…) instead gets its sellPrice registered onto ITEM_DEFS the first
  // time its recipe fires (see ItemProcessing.ensureProcessedItemDef). Without
  // this fallback the Shipping Box transfer UI treated every processed item
  // as unsellable, even though FarmCrates' own deposit/settle pipeline
  // already prices anything with an ITEM_DEFS sellPrice.
  function sellPriceFor(key) {
    const basePrice = deps.BASE_PRICES[key];
    if (basePrice !== undefined) return basePrice;
    const processedPrice = deps.ITEM_DEFS?.[key]?.sellPrice;
    return Number.isFinite(processedPrice) ? processedPrice : undefined;
  }

  function canShipKey(key) {
    return !!deps && sellPriceFor(key) !== undefined;
  }

  function selectShippingItem(side, key) {
    initializeConfiguredState();
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
    initializeConfiguredState();
    const panel = panelCfg();
    const key = shippingSelected.key;
    const shippingBoxObject = deps?.getShippingBoxObject?.();
    if (!key || !shippingBoxObject) return;
    const count = getShippingCount(shippingSelected.side, key);
    if (count < 1) return;
    let qty = shippingAmount;
    if (mode === 'half') qty = Math.max(1, Math.floor(count / Number(panel.halfDivisor)));
    if (mode === storeCfg().stackQuantityToken) qty = count;
    qty = Math.max(1, Math.min(qty, count));

    let moved = 0;
    if (!isBoxSide(shippingSelected.side)) {
      if (!canShipKey(key)) { deps.showToast(panel.text.cannotShip, false); return; }
      moved = shippingBoxObject.depositItem(key, qty);
      if (moved > 0) deps.showToast(`${config().object.icon} ${config().interactionUi.shipVerb}${moved}× ${deps.ITEM_DEFS[key].label}`, true);
    } else {
      if (!deps.hasFarmPermission(inventoryCfg().permissions.withdraw)) {
        deps.showToast(panel.text.withdrawDenied, false);
        return;
      }
      moved = shippingBoxObject.withdrawItem(key, qty);
      if (moved > 0) deps.showToast(`↩ ${panel.text.takeBackPrefix}${moved}× ${deps.ITEM_DEFS[key].label}`, true);
    }
    if (moved < 1) return;
    deps.clampInventoryStack(key);
    if (getShippingCount(shippingSelected.side, key) < 1) shippingSelected.key = null;
    shippingAmount = Number(panel.defaultAmount);
    deps.buildInventoryGrid();
    buildShippingTransferUI();
    deps.refreshItemScroll();
    deps.saveMemberWorldData();
  }

  function renderShippingGrid(side) {
    const panel = panelCfg();
    const grid = document.getElementById(isBoxSide(side) ? 'shipRightGrid' : 'shipLeftGrid');
    if (!grid || !deps) return;
    grid.innerHTML = '';
    const keys = getShippingKeys(side);
    keys.forEach(key => {
      const def = deps.ITEM_DEFS[key];
      const count = getShippingCount(side, key);
      const blocked = !isBoxSide(side) && !canShipKey(key);
      const slot = document.createElement('button');
      slot.className = 'ship-slot' + (shippingSelected.side === side && shippingSelected.key === key ? ' selected' : '') + (blocked ? ' blocked' : '');
      slot.dataset.side = side;
      slot.dataset.key = key;
      slot.innerHTML = `<span class="ship-slot-icon">${def.icon}</span><span class="ship-slot-count">×${count}</span>${isBoxSide(side) ? `<span class="ship-slot-pending">${panel.boxBadge}</span>` : ''}`;
      slot.addEventListener('click', () => selectShippingItem(side, key));
      grid.appendChild(slot);
    });
    if (!keys.length) {
      const empty = document.createElement('div');
      empty.className = 'ship-footer';
      empty.textContent = isBoxSide(side) ? panel.text.boxEmpty : panel.text.noFilterItems;
      grid.appendChild(empty);
    }
  }

  function buildShippingTransferUI() {
    if (!document.getElementById('mpShipping') || !deps) return;
    initializeConfiguredState();
    const panel = panelCfg();
    renderShippingGrid(panel.defaultSide);
    renderShippingGrid(panel.boxSide);

    const leftStacks = Object.keys(deps.ITEM_DEFS).filter(k => (deps.inventory[k] || 0) > 0).length;
    const shippingBoxObject = deps.getShippingBoxObject();
    const boxTotal = shippingBoxObject?.getTotalItems?.() || 0;
    const pendingTotal = shippingBoxObject?.getPendingSaleTotal?.() || 0;
    const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    setText('shipLeftCap', `${leftStacks} stacks`);
    setText('shipRightCap', boxTotal > 0 ? `${boxTotal} ${panel.text.statusInBox}${pendingTotal > 0 ? ` · ${pendingTotal} ${panel.midnightReadyLabel}` : ''}` : config().interactionUi.labels.emptyContents);

    const key = shippingSelected.key;
    const def = key ? deps.ITEM_DEFS[key] : null;
    const count = key ? getShippingCount(shippingSelected.side, key) : 0;
    const max = Math.max(1, count);
    shippingAmount = Math.max(1, Math.min(shippingAmount, max));
    const blocked = key && !isBoxSide(shippingSelected.side) && !canShipKey(key);
    const direction = !key ? panel.directionEmpty : (!isBoxSide(shippingSelected.side) ? panel.directionToBox : panel.directionToBag);

    setText('shipPreviewIcon', def ? def.icon : panel.iconFallback);
    setText('shipPreviewName', def ? `${def.label} ×${count}` : panel.text.selectItem);
    setText('shipDirection', blocked ? panel.blockedLabel : direction);
    setText('shipAmount', String(shippingAmount));
    setText('shipLeftFooter', !isBoxSide(shippingSelected.side) && def ? `${def.label} ×${count}` : panel.text.selectPackItem);
    setText('shipRightFooter', isBoxSide(shippingSelected.side) && def ? `${def.label} ×${count}` : panel.text.rightFooter);
    setText('shipDetailIcon', def ? def.icon : panel.iconFallback);
    setText('shipDetailName', def ? def.label : panel.text.detailName);
    setText('shipDetailValue', def && canShipKey(key) ? `${sellPriceFor(key)}${panel.text.valueEachSuffix}` : (def ? panel.text.notSellable : panel.emptyValue));
    setText('shipDetailDesc', def ? `${def.desc}${blocked ? panel.text.blockedSuffix : ''}` : panel.text.detailEmpty);
    const tags = document.getElementById('shipDetailTags');
    if (tags) tags.innerHTML = def
      ? (def.tags || []).map(tag => `<span class="ship-tag">${tag}</span>`).join('')
      : `<span class="ship-tag">${panel.transferTag}</span><span class="ship-tag">${panel.pendingTag}</span>`;

    const hasTransfer = !!key && count > 0 && !blocked;
    panel.transferControlIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = !hasTransfer;
    });
    const towardBox = !isBoxSide(shippingSelected.side);
    setText('shipTransferOne', towardBox ? panel.text.shipOne : panel.text.takeOne);
    setText('shipTransferHalf', towardBox ? panel.text.shipHalf : panel.text.takeHalf);
    setText('shipTransferStack', towardBox ? panel.text.shipStack : panel.text.takeStack);
    updateStandaloneChrome();
  }

  function injectStandaloneStyles() {
    if (document.getElementById('shippingStandaloneStyles')) return;
    const panel = panelCfg();
    const s = panel.style;
    const style = document.createElement('style');
    style.id = 'shippingStandaloneStyles';
    style.textContent = `
      #shippingStandaloneRoot {
        --shipping-pane-w:${s.paneWidth}; --shipping-pane-h:${s.paneHeight};
        position:fixed; inset:0; z-index:${s.zIndex}; display:flex; align-items:center; justify-content:center;
        padding:${s.rootPadding}; background:${s.backdrop}; touch-action:none;
      }
      #shippingStandaloneRoot[hidden]{display:none!important}
      #shippingStandaloneWindow {
        width:${s.windowWidth}; max-width:${s.windowMaxWidth}; max-height:${s.windowMaxHeight};
        display:grid; grid-template-rows:auto minmax(0,var(--shipping-pane-h)) auto; overflow:hidden;
        border:${s.windowBorder}; border-radius:${s.borderRadiusPx}px; background:var(--glass-2);
        box-shadow:${s.windowShadow}; backdrop-filter:blur(${s.blurPx}px); -webkit-backdrop-filter:blur(${s.blurPx}px);
        outline:none; color:var(--text); font-family:${panel.fontStack}; font-size:${s.baseFont};
      }
      #shippingStandaloneWindow button,#shippingStandaloneWindow input{font-family:${panel.fontStack}}
      .shipping-window-bar{min-height:${s.headerMinHeight};display:flex;align-items:center;justify-content:space-between;gap:${s.headerGap};padding:${s.headerPadding};border-bottom:1px solid var(--border);background:${s.headerBackground}}
      .shipping-window-heading{min-width:0;display:flex;flex-direction:column;gap:${s.headingGap}}
      #shippingStandaloneTitle{color:var(--accent);font-size:${s.titleFont};line-height:${s.titleLineHeight}}
      #shippingWindowStatus{color:var(--muted);font-size:${s.smallFont};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .shipping-window-actions{display:flex;align-items:center;gap:${s.actionGap};flex:0 0 auto}
      .shipping-window-btn{min-width:${s.buttonMinWidth};min-height:${s.buttonMinHeight};padding:${s.buttonPadding};border:1px solid var(--border-bright);border-radius:${s.buttonRadius};background:${s.buttonBackground};color:var(--text);font-size:${s.buttonFont}}
      .shipping-window-btn:hover,.shipping-window-btn:focus-visible{border-color:var(--accent);color:var(--accent)}
      #shippingWindowClose{font-size:${s.closeFont};line-height:1}
      #shippingStandaloneBody{position:relative;min-width:0;min-height:0;padding:${s.bodyPadding};overflow:hidden}
      #shippingStandaloneBody #mpShipping{--tr-col:calc(var(--shipping-pane-w)/60);--tr-row:calc(var(--shipping-pane-h)/32);--tr-font-xs:${s.smallFont};--tr-font-sm:${s.mediumFont};width:var(--shipping-pane-w);height:var(--shipping-pane-h)!important;display:block!important;position:relative;font-family:${panel.fontStack}!important;font-size:var(--tr-font-sm)}
      #shippingStandaloneBody #mpShipping .ship-title,#shippingStandaloneBody #mpShipping .ship-transfer-title,#shippingStandaloneBody #mpShipping .ship-preview-name,#shippingStandaloneBody #mpShipping .ship-direction,#shippingStandaloneBody #mpShipping .ship-detail-name{font-size:var(--tr-font-sm)!important;line-height:${s.mediumLineHeight}}
      #shippingStandaloneBody #mpShipping .ship-capacity,#shippingStandaloneBody #mpShipping .ship-cat,#shippingStandaloneBody #mpShipping .ship-slot-count,#shippingStandaloneBody #mpShipping .ship-slot-pending,#shippingStandaloneBody #mpShipping .ship-footer,#shippingStandaloneBody #mpShipping .ship-detail-value,#shippingStandaloneBody #mpShipping .ship-detail-desc,#shippingStandaloneBody #mpShipping .ship-tag{font-size:var(--tr-font-xs)!important;line-height:${s.smallLineHeight}}
      #shippingStandaloneBody #mpShipping .ship-transfer-btn,#shippingStandaloneBody #mpShipping .ship-amt-btn,#shippingStandaloneBody #mpShipping .ship-amount{font-size:${s.transferButtonFont}!important}
      #shippingStandaloneBody #mpShipping .ship-slot-icon{font-size:${s.iconFont}!important}
      #shippingWindowDebugPanel{max-height:${s.debugMaxHeight};overflow:auto;margin:0;padding:${s.debugPadding};border-top:1px solid var(--border);background:${s.debugBackground};color:var(--muted);font:${s.debugFont}/${s.debugLineHeight} ${panel.monoFontStack};white-space:pre-wrap}
      #shippingWindowDebugPanel[hidden]{display:none!important}
      #iiActions .ii-btn.sell{display:none!important}
      @media(max-width:${s.mobileBreakpointPx}px){
        #shippingStandaloneRoot{--shipping-pane-w:${s.mobilePaneWidth};--shipping-pane-h:${s.mobilePaneHeight};align-items:flex-start}
        #shippingStandaloneWindow{margin-top:${s.mobileMarginTop};width:${s.mobileWindowWidth};max-height:${s.mobileWindowMaxHeight}}
        .shipping-window-bar{min-height:${s.mobileHeaderMinHeight};padding:${s.mobileHeaderPadding}}
        #shippingStandaloneTitle{font-size:${s.mobileTitleFont}}
        #shippingWindowStatus{font-size:${s.mobileStatusFont}}
        .shipping-window-btn{min-height:${s.mobileButtonMinHeight};padding-inline:${s.mobileButtonPaddingInline};font-size:${s.mobileButtonFont}}
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
    const fallbackIcon = panelCfg().iconFallback;
    return Object.keys(deps.ITEM_DEFS).flatMap(key => {
      const count = Math.max(0, Number(deps.inventory[key]) || 0);
      const price = Number(deps.BASE_PRICES[key]);
      const def = deps.ITEM_DEFS[key];
      if (count < 1 || !Number.isFinite(price) || price < 0 || !def) return [];
      return [{ key, count, price, icon: def.icon || fallbackIcon, label: def.label || key, desc: def.desc || '', cat: def.cat || '' }];
    });
  }

  function sellInventoryAtStore(key, quantity = 1) {
    if (!deps || deps.BASE_PRICES[key] === undefined) return { moved: 0, earned: 0 };
    const available = Math.max(0, Number(deps.inventory[key]) || 0);
    const requested = quantity === storeCfg().stackQuantityToken ? available : Math.max(1, Math.floor(Number(quantity) || 1));
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
    initializeConfiguredState();
    const box = deps?.getShippingBoxObject?.();
    const pane = document.getElementById('mpShipping');
    return {
      configVersion: config().version,
      open: standaloneOpen,
      pointerLocked: !!document.pointerLockElement,
      panelParent: pane?.parentElement?.id || null,
      queuedItems: box?.getTotalItems?.() || 0,
      midnightReadyItems: box?.getPendingSaleTotal?.() || 0,
      midnightCutoffDay: box?.getMidnightCutoffDay?.() || null,
      selectedSide: shippingSelected.side,
      selectedKey: shippingSelected.key,
      selectedAmount: shippingAmount,
      boxPosition: box ? { col: box.col, row: box.row, width: box.w, height: box.h } : null,
    };
  }

  function updateStandaloneChrome() {
    if (!standaloneRoot) return;
    const state = getDebugState();
    const panel = panelCfg();
    const status = document.getElementById('shippingWindowStatus');
    if (status) status.textContent = `${state.queuedItems} ${panel.text.statusInBox} · ${state.midnightReadyItems} ${panel.midnightReadyLabel} · ${panel.cameraBlockedText}`;
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
    document.getElementById('mpShipping')?.classList.remove('shipping-standalone-pane');
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
    if (!window.ShippingBoxConfig) return null;
    const pane = document.getElementById('mpShipping');
    if (!pane || !document.body) return null;
    initializeConfiguredState();
    injectStandaloneStyles();
    const panel = panelCfg();

    const root = document.createElement('div');
    root.id = 'shippingStandaloneRoot';
    root.hidden = true;
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML = `
      <section id="shippingStandaloneWindow" role="dialog" aria-modal="true" aria-labelledby="shippingStandaloneTitle" tabindex="-1">
        <header class="shipping-window-bar">
          <div class="shipping-window-heading">
            <strong id="shippingStandaloneTitle">${panel.title}</strong>
            <span id="shippingWindowStatus">0 ${panel.text.statusInBox} · 0 ${panel.midnightReadyLabel} · ${panel.cameraBlockedText}</span>
          </div>
          <div class="shipping-window-actions">
            <button type="button" class="shipping-window-btn" id="shippingWindowDebug" aria-expanded="false">${panel.debugButton}</button>
            <button type="button" class="shipping-window-btn" id="shippingWindowClose" aria-label="${panel.closeAriaLabel}">${panel.closeGlyph}</button>
          </div>
        </header>
        <div id="shippingStandaloneBody"></div>
        <pre id="shippingWindowDebugPanel" hidden></pre>
      </section>`;
    document.body.appendChild(root);
    document.getElementById('shippingStandaloneBody').appendChild(pane);
    standaloneRoot = root;

    root.addEventListener('click', event => {
      if (!event.target?.closest?.('#shipCloseBtn')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      closeStandalone();
    }, true);

    panel.pointerBlockedEvents.forEach(type => root.addEventListener(type, stopStandaloneInputPropagation));
    const dialog = document.getElementById('shippingStandaloneWindow');
    dialog.addEventListener('keydown', event => {
      if (!standaloneOpen) return;
      if (event.key === panel.escapeKey) {
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
      const debugPanel = document.getElementById('shippingWindowDebugPanel');
      debugPanel.hidden = !standaloneDebugVisible;
      updateStandaloneChrome();
    });
    root.addEventListener('click', event => { if (event.target === root) closeStandalone(); });
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
    getActiveCat: side => shippingActiveCat[side],
    open: openStandalone,
    close: closeStandalone,
    isOpen: () => standaloneOpen,
    getDebugState,
    getSellableInventory,
    sellInventoryAtStore,
    getConfig: config,
  };
})();
