(() => {
  'use strict';

  // Funji & Son's General Store: goods + a daily-rotating clothing rack +
  // immediate player-pack sales. ShippingPanel owns the canonical sale-price
  // bridge so the store and Shipping Box cannot drift onto different values.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  function shippingCfg() {
    if (!window.ShippingBoxConfig) throw new Error('ShippingBoxConfig must load before GeneralStore Shipping integration');
    return window.ShippingBoxConfig;
  }
  let generalStoreActiveCategory = 'goods'; // Existing General Store category state; Shipping adds one configured category to it.

  function getGeneralStoreCategoryLabel(category) {
    const store = shippingCfg().store;
    return ({ all: 'All', goods: 'Goods', clothing: 'Clothing', [store.categoryKey]: store.categoryLabel })[category] || 'General Store';
  }

  function ensureGeneralStoreSellUi() {
    const store = shippingCfg().store;
    const tabs = document.querySelector('.general-store-tab')?.parentElement;
    if (tabs && !tabs.querySelector(`[data-general-store-cat="${store.categoryKey}"]`)) {
      const sellTab = document.createElement('button');
      sellTab.className = 'supply-tab general-store-tab';
      sellTab.dataset.generalStoreCat = store.categoryKey;
      sellTab.type = 'button';
      sellTab.textContent = store.categoryLabel;
      const beforeTab = tabs.querySelector(`[data-general-store-cat="${store.insertBeforeCategoryKey}"]`);
      tabs.insertBefore(sellTab, beforeTab || null);
    }
    if (!document.getElementById('generalStoreSellStyles')) {
      const css = store.css;
      const style = document.createElement('style');
      style.id = 'generalStoreSellStyles';
      style.textContent = `
        #mpGeneralStore .gs-sell-actions { display:flex; flex:0 0 auto; gap:${css.actionGapPx}px; align-items:center; flex-wrap:wrap; justify-content:flex-end; }
        #mpGeneralStore .gs-sell-actions .shop-buy-btn { min-width:${css.buttonMinWidthPx}px; padding-inline:${css.buttonPaddingInlinePx}px; }
        #mpGeneralStore .gs-sell-empty { color:var(--muted); font-size:${css.emptyFontSizePx}px; padding:${css.emptyPaddingPx}px; text-align:center; border:1px dashed var(--border); border-radius:${css.emptyRadiusPx}px; }
        @media (max-width:${css.mobileBreakpointPx}px) { #mpGeneralStore .gs-sell-actions { flex-direction:column; align-items:stretch; } #mpGeneralStore .gs-sell-actions .shop-buy-btn { min-width:${css.mobileButtonMinWidthPx}px; } }
      `;
      document.head.appendChild(style);
    }
  }

  function bindGeneralStoreTabs() {
    ensureGeneralStoreSellUi();
    document.querySelectorAll('.general-store-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.generalStoreCat === generalStoreActiveCategory);
      btn.onclick = () => {
        generalStoreActiveCategory = btn.dataset.generalStoreCat || 'goods';
        renderGeneralStorePage();
      };
    });
  }

  function buyGeneralStoreItem(item) {
    const gold = deps.inventory.gold || 0;
    if (gold < item.price) { deps.showToast('Not enough gold.', false); return; }
    deps.inventory.gold = gold - item.price;
    if (item.gives) {
      Object.entries(item.gives).forEach(([key, value]) => {
        deps.inventory[key] = Math.min(99, (deps.inventory[key] || 0) + value);
      });
    }
    deps.showToast('Bought ' + item.name + '!', true);
    renderGeneralStorePage();
    deps.buildInventoryGrid();
    deps.saveMemberWorldData();
  }

  function renderGeneralStoreGoods(list) {
    const world = deps.lootShopWorldState();
    deps.getGeneralStoreCatalog().filter(item => window.ConditionRegistry.entryEligible(item, world)).forEach(item => {
      const row = document.createElement('div');
      row.className = 'shop-row';
      row.innerHTML = `
        <div class="sh-icon">${item.icon}</div>
        <div class="sh-info">
          <div class="sh-name">${item.name}</div>
          <div class="sh-desc">${item.desc}</div>
          <div class="sh-price">${item.price}g each</div>
        </div>
        <button class="shop-buy-btn" data-key="${item.key}">Buy</button>
      `;
      row.querySelector('[data-key]')?.addEventListener('click', () => buyGeneralStoreItem(item));
      list.appendChild(row);
    });
  }

  function sellGeneralStoreItem(item, quantity) {
    const store = shippingCfg().store;
    const result = window.ShippingPanel?.sellInventoryAtStore?.(item.key, quantity);
    if (!result?.moved) { deps.showToast(store.nothingToSellMessage, false); return; }
    deps.showToast(`${store.soldPrefix}${result.moved}× ${item.label}${store.soldForText}${result.earned}${store.goldSuffix}`, true);
    renderGeneralStorePage();
  }

  function renderGeneralStoreSell(list) {
    const store = shippingCfg().store;
    const sellable = window.ShippingPanel?.getSellableInventory?.() || [];
    if (!sellable.length) {
      const empty = document.createElement('div');
      empty.className = 'gs-sell-empty';
      empty.textContent = store.emptyMessage;
      list.appendChild(empty);
      return;
    }
    sellable.forEach(item => {
      const row = document.createElement('div');
      row.className = 'shop-row';
      row.innerHTML = `
        <div class="sh-icon">${item.icon}</div>
        <div class="sh-info">
          <div class="sh-name">${deps.esc(item.label)}</div>
          <div class="sh-desc">${deps.esc(item.desc || store.defaultDescription)}</div>
          <div class="sh-price">${item.count} ${store.inPackText} · ${item.price}${store.eachText} · ${item.count * item.price}${store.stackValueText}</div>
        </div>
        <div class="gs-sell-actions">
          <button class="shop-buy-btn gs-sell-one" type="button">${store.sellOneLabel}</button>
          <button class="shop-buy-btn gs-sell-stack" type="button">${store.sellStackLabel}</button>
        </div>
      `;
      row.querySelector('.gs-sell-one')?.addEventListener('click', () => sellGeneralStoreItem(item, store.singleQuantity));
      row.querySelector('.gs-sell-stack')?.addEventListener('click', () => sellGeneralStoreItem(item, store.stackQuantityToken));
      list.appendChild(row);
    });
  }

  function generateDailyClothingStock(day) {
    const stock = [];
    const catalog = window.DyeSystem.getCatalog();
    const world = deps.lootShopWorldState();
    const allPieces = deps.getStoreClothingPieces();
    const eligible = allPieces.filter(piece => window.ConditionRegistry.entryEligible(piece, world));
    const pieces = eligible.length ? eligible : allPieces;
    const slots = deps.getGeneralStoreClothingSlots();
    for (let i = 0; i < slots; i++) {
      const piece   = pieces[Math.floor(deps.seededRandom(day * 97 + i * 31) * pieces.length)];
      const dyeA    = catalog[Math.floor(deps.seededRandom(day * 53 + i * 71 + 13) * catalog.length)];
      const dyeB    = piece.usesB ? catalog[Math.floor(deps.seededRandom(day * 113 + i * 43 + 7) * catalog.length)] : null;
      const dyeLbl  = piece.usesB && dyeB ? (dyeA.label + ' & ' + dyeB.label) : dyeA.label;
      stock.push({
        uid: 'citem_gs_' + day + '_' + i,
        cosmeticId: piece.id,
        slot: piece.category,
        label: dyeLbl + ' ' + piece.label,
        baseLabel: piece.label,
        colorA: window.DyeSystem.toClothingColor(dyeA),
        colorB: window.DyeSystem.toClothingColor(dyeB),
        price: piece.price,
        sellPrice: Math.floor(piece.price * 0.4),
        sprite: deps.clothingSpriteForCosmetic(piece.id),
      });
    }
    return stock;
  }

  function renderGeneralStoreClothing(list) {
    const clothHdrEl = document.createElement('div');
    clothHdrEl.className = 'shop-section-label';
    clothHdrEl.textContent = '🧥 Today\'s Clothing  (rerolls each day)';
    list.appendChild(clothHdrEl);

    generateDailyClothingStock(deps.calendar.day).forEach(item => {
      const row = document.createElement('div');
      row.className = 'shop-row';
      row.innerHTML = `
        <div class="sh-icon">👘</div>
        <div class="sh-info">
          <div class="sh-name">${deps.esc(item.label)}</div>
          <div class="sh-desc">${item.slot.charAt(0).toUpperCase() + item.slot.slice(1)} — goes to pack inventory</div>
          <div class="sh-price">${item.price}g each</div>
        </div>
        <button class="shop-buy-btn gs-cloth-buy">Buy</button>
      `;
      row.querySelector('.gs-cloth-buy')?.addEventListener('click', () => {
        if ((deps.inventory.gold || 0) < item.price) { deps.showToast('Not enough gold.', false); return; }
        deps.inventory.gold = (deps.inventory.gold || 0) - item.price;
        deps.getPackClothing().push({ ...item });
        deps.showToast('Bought ' + item.label + '!', true);
        renderGeneralStorePage(); deps.buildInventoryGrid(); deps.buildPackClothingSection();
        deps.saveMemberWorldData();
      });
      list.appendChild(row);
    });
  }

  function renderGeneralStorePage() {
    bindGeneralStoreTabs();
    const store = shippingCfg().store;
    const sectionTitle = document.getElementById('generalStoreSectionTitle');
    if (sectionTitle) sectionTitle.textContent = 'Funji & Son\'s General Store — ' + getGeneralStoreCategoryLabel(generalStoreActiveCategory);
    const list = document.getElementById('generalStoreList');
    const goldEl = document.getElementById('gsGoldDisplay');
    if (goldEl) goldEl.innerHTML = `${deps.inventory.gold || 0}<span class="wallet-unit">g</span>`;
    if (!list) return;
    list.innerHTML = '';
    if (generalStoreActiveCategory === 'goods' || generalStoreActiveCategory === 'all') renderGeneralStoreGoods(list);
    if (generalStoreActiveCategory === 'clothing' || generalStoreActiveCategory === 'all') renderGeneralStoreClothing(list);
    if (generalStoreActiveCategory === store.categoryKey) renderGeneralStoreSell(list);
  }

  window.GeneralStore = { init, render: renderGeneralStorePage };
})();

// General Store is already loaded before game.js. Use that stable parser slot
// to load ShippingBoxConfig, then the separate world adapter, before game boot.
if (document.readyState === 'loading') {
  if (!window.ShippingBoxConfig) document.write('<script src="js/shipping-box-config.js?v=20260902shipping6"></scr' + 'ipt>');
  if (!window.__shippingBoxWorldInstalled) document.write('<script src="js/shipping-box-world.js?v=20260902shipping6"></scr' + 'ipt>');
}
