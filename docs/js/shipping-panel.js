(() => {
  'use strict';

  // Shipping tab (player bag <-> shipping-box transfer UI, category
  // filters, amount stepper, ship/take buttons). Extracted out of
  // game.js following the same window.<Namespace> + init(deps) pattern
  // as its sibling systems.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

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
    const shippingBoxObject = deps.getShippingBoxObject();
    return shippingBoxObject && shippingBoxObject.getContents ? shippingBoxObject.getContents() : {};
  }

  function getShippingKeys(side) {
    const source = side === 'right' ? getShippingBoxContents() : deps.inventory;
    return Object.keys(deps.ITEM_DEFS).filter(key => {
      const def = deps.ITEM_DEFS[key];
      const cat = shippingActiveCat[side];
      if (cat !== 'all' && def.cat !== cat) return false;
      return (source[key] || 0) > 0;
    });
  }

  function getShippingCount(side, key) {
    return side === 'right' ? (getShippingBoxContents()[key] || 0) : (deps.inventory[key] || 0);
  }

  function canShipKey(key) {
    return deps.BASE_PRICES[key] !== undefined;
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
    const shippingBoxObject = deps.getShippingBoxObject();
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
    if (!grid) return;
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
    if (!document.getElementById('mpShipping')) return;
    renderShippingGrid('left');
    renderShippingGrid('right');

    const leftStacks = Object.keys(deps.ITEM_DEFS).filter(k => (deps.inventory[k] || 0) > 0).length;
    const shippingBoxObject = deps.getShippingBoxObject();
    const boxTotal = shippingBoxObject && shippingBoxObject.getTotalItems ? shippingBoxObject.getTotalItems() : 0;
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
  };
})();