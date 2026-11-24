(() => {
  'use strict';

  // Shared limits for repeatable purchases, expressed in orders rather than granted units.
  const MAX_ORDERS = 9999; // Bounds free items and malformed/huge wallet balances.
  function count(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  }

  function max(inventory, { price = 0, limit = MAX_ORDERS, grants = {}, tradeCost = {}, stackCap = window.InventoryStacks?.MAX_TOTAL ?? MAX_ORDERS } = {}) {
    const cost = Number(price);
    if (!Number.isFinite(cost) || cost < 0) return 0;
    let available = Math.min(MAX_ORDERS, count(limit)); // Used for stock and one-copy restrictions.
    if (cost > 0) available = Math.min(available, Math.floor(count(inventory.gold) / cost));
    for (const [key, raw] of Object.entries(tradeCost || {})) {
      const perOrder = Number(raw);
      if (!Number.isSafeInteger(perOrder) || perOrder < 0) return 0;
      if (perOrder) available = Math.min(available, Math.floor(count(inventory[key]) / perOrder));
    }
    for (const [key, raw] of Object.entries(grants || {})) {
      const perOrder = Number(raw);
      if (!Number.isSafeInteger(perOrder) || perOrder < 0) return 0;
      // Barter is consumed before the grant; account for the net stack increase.
      const net = perOrder - (Number(tradeCost?.[key]) || 0);
      if (net > 0) available = Math.min(available, Math.floor((count(stackCap) - count(inventory[key])) / net));
    }
    return Math.max(0, available);
  }

  function valid(quantity, maximum) {
    return Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= maximum;
  }

  // Reuse Supply Shop CSS. Updating a count does not rebuild the row or lose controller focus.
  function attach(button, { maximum, price, purchase, label = 'Buy', showControls = true, unavailableLabel = () => 'Unavailable', describeCost = quantity => `${Number(price || 0) * quantity}g` }) {
    if (!button) return;
    let quantity = 1; // Used by this row's arrows and its purchase action.
    const readMax = () => Math.max(0, count(maximum())); // Recheck live wallet/stock at every click.
    let minus, plus, value; // Optional controls are omitted for inherently single-copy purchases.
    if (showControls) {
      const controls = document.createElement('div');
      controls.className = 'shop-qty-ctrl shop-bulk-qty';
      button.parentElement?.classList?.add('shop-bulk-row'); // Gives narrow touch layouts room for the two purchase controls.
      minus = document.createElement('button');
      minus.className = 'shop-qty-btn';
      minus.type = 'button';
      minus.textContent = '−';
      minus.setAttribute('aria-label', 'Decrease purchase quantity');
      minus.setAttribute('data-ctrl-inspect', ''); // Keep controller focus on the arrow when it reaches its limit.
      value = document.createElement('span');
      value.className = 'shop-qty-val';
      value.setAttribute('aria-live', 'polite');
      plus = document.createElement('button');
      plus.className = 'shop-qty-btn';
      plus.type = 'button';
      plus.textContent = '+';
      plus.setAttribute('aria-label', 'Increase purchase quantity');
      plus.setAttribute('data-ctrl-inspect', '');
      controls.appendChild(minus);
      controls.appendChild(value);
      controls.appendChild(plus);
      button.before(controls);
      minus.addEventListener('click', () => { if (quantity > 1) quantity--; refresh(); });
      plus.addEventListener('click', () => { const limit = readMax(); if (quantity < limit) quantity++; refresh(); });
    }
    function refresh() {
      const limit = readMax(); // Used to prevent selecting more than can actually be bought.
      quantity = Math.max(1, Math.min(quantity, limit));
      if (value) value.textContent = limit ? String(quantity) : '—';
      if (minus) minus.setAttribute('aria-disabled', String(quantity <= 1));
      if (plus) plus.setAttribute('aria-disabled', String(quantity >= limit));
      button.disabled = limit < 1;
      const caption = limit ? (quantity === 1 ? label : `${label} ×${quantity} · ${describeCost(quantity)}`) : unavailableLabel(); // Always clear stale totals when resources change.
      if (button.textContent !== caption) button.textContent = caption;
      button.title = limit ? `${quantity} order(s), ${describeCost(quantity)} total` : 'Not enough money, stock, trade goods, or inventory space.';
    }
    button.addEventListener('click', () => {
      if (!valid(quantity, readMax())) { refresh(); return; }
      purchase(quantity);
      quantity = 1;
      if (button.isConnected !== false) refresh(); // Shop renderers usually replace the entire row after a purchase.
    });
    refresh();
  }

  window.ShopQuantity = Object.freeze({ max, valid, attach, latestChange: 'Bulk purchases validate all costs; controller arrows retain focus at their bounds.' });
})();
