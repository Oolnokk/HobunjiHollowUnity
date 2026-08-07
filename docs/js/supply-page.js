(() => {
  'use strict';

  // Supplies tab (Supply Box ordering + pending deliveries/sale log).
  // Extracted out of game.js following the same window.<Namespace> +
  // init(deps) pattern as its sibling systems.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  // Used to keep the longer catalog readable on mobile.
  let supplyActiveCategory = 'seeds';

  function getSupplyItemCategory(item) {
    // Avoids hard-coding future catalog rows into the UI.
    if (item.category) return item.category;
    if (item.comingSoon) return 'livestock';
    if (/Seed$|Seeds$/.test(item.key) || item.key === 'mulchBag') return 'seeds';
    return 'all';
  }

  function getSupplyCategoryLabel(category) {
    return ({ all: 'All', seeds: 'Seeds', furniture: 'Furniture', livestock: 'Livestock' })[category] || 'Supply';
  }

  function bindSupplyTabs() {
    document.querySelectorAll('[data-supply-cat]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.supplyCat === supplyActiveCategory);
      btn.onclick = () => {
        supplyActiveCategory = btn.dataset.supplyCat || 'seeds';
        renderSupplyPage();
      };
    });
  }

  function renderSupplyPage() {
    bindSupplyTabs();
    const sectionTitle = document.getElementById('supplySectionTitle');
    if (sectionTitle) sectionTitle.textContent = 'Supply Shop — ' + getSupplyCategoryLabel(supplyActiveCategory);
    const list = document.getElementById('supplyShopList');
    const deliveries = document.getElementById('supplyDeliveryList');
    const goldEl = document.getElementById('supplyGoldDisplay');
    if (goldEl) goldEl.innerHTML = `${deps.inventory.gold || 0}<span class="wallet-unit">g</span>`;
    if (!list) return;
    const supplyBoxObject = deps.getSupplyBoxObject();
    const qtys = supplyBoxObject && supplyBoxObject.getQtys ? supplyBoxObject.getQtys() : {};
    list.innerHTML = '';
    const visibleSupplyItems = deps.SUPPLY_CATALOG.filter(item => supplyActiveCategory === 'all' || getSupplyItemCategory(item) === supplyActiveCategory);
    visibleSupplyItems.forEach(item => {
      const qty = qtys[item.key] || 0;
      const row = document.createElement('div');
      row.className = 'shop-row' + (item.comingSoon ? ' coming-soon' : '');
      row.innerHTML = `
        <div class="sh-icon">${item.icon}</div>
        <div class="sh-info">
          <div class="sh-name">${item.name}</div>
          <div class="sh-desc">${item.desc}</div>
          <div class="sh-price">${item.comingSoon ? 'Livestock system not active yet' : item.price + 'g per order'}</div>
        </div>
        <div class="shop-qty-ctrl">
          <button class="shop-qty-btn" data-act="minus" ${item.comingSoon ? 'disabled' : ''}>−</button>
          <span class="shop-qty-val">${item.comingSoon ? '—' : qty}</span>
          <button class="shop-qty-btn" data-act="plus" ${item.comingSoon ? 'disabled' : ''}>+</button>
        </div>
        <button class="shop-buy-btn" data-act="buy" ${item.comingSoon ? 'disabled' : ''}>${item.comingSoon ? 'Soon' : 'Order'}</button>
      `;
      row.querySelector('[data-act="minus"]')?.addEventListener('click', () => {
        qtys[item.key] = Math.max(0, (qtys[item.key] || 0) - 1);
        renderSupplyPage();
      });
      row.querySelector('[data-act="plus"]')?.addEventListener('click', () => {
        qtys[item.key] = Math.min(99, (qtys[item.key] || 0) + 1);
        renderSupplyPage();
      });
      row.querySelector('[data-act="buy"]')?.addEventListener('click', () => {
        const result = supplyBoxObject ? supplyBoxObject.onAction('obj_buy_' + item.key) : { ok: false, message: 'No supply box linked.' };
        deps.showToast(result.message, result.ok !== false);
        renderSupplyPage();
        deps.buildInventoryGrid();
        if (result.ok !== false) deps.saveMemberWorldData();
      });
      list.appendChild(row);
    });
    if (visibleSupplyItems.length === 0) {
      list.innerHTML = '<div class="delivery-row"><span class="dr-icon">📭</span><span class="dr-name">No entries in this supply category yet.</span><span class="dr-eta">—</span></div>';
    }
    if (deliveries) {
      const pendingOrders = deps.getPendingOrders();
      const deliveryLog = deps.getDeliveryLog();
      if (pendingOrders.length === 0 && deliveryLog.length === 0) {
        deliveries.innerHTML = '<div class="delivery-row"><span class="dr-icon">📭</span><span class="dr-name">No pending deliveries or recent sales.</span><span class="dr-eta">—</span></div>';
      } else {
        const pending = pendingOrders.map(order => `<div class="delivery-row"><span class="dr-icon">${order.item.icon}</span><span class="dr-name">${order.qty}× ${order.item.name}</span><span class="dr-eta">Day ${order.arrivalDay}</span></div>`).join('');
        const history = deliveryLog.map(line => `<div class="delivery-row received"><span class="dr-icon">${line.type === 'sale' ? '🟧' : '📦'}</span><span class="dr-name">${line.text}</span><span class="dr-eta">Done</span></div>`).join('');
        deliveries.innerHTML = pending + history;
      }
    }
  }

  window.SupplyPage = { init, render: renderSupplyPage };
})();
