(() => {
  'use strict';

  // Funji & Son's General Store: goods + a daily-rotating clothing rack +
  // immediate player-pack sales. ShippingPanel owns the canonical sale-price
  // bridge so the store and Shipping Box cannot drift onto different values.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  let generalStoreActiveCategory = 'goods'; // Mirrors the Supply Shop's own category tabs.

  function getGeneralStoreCategoryLabel(category) {
    return ({ all: 'All', goods: 'Goods', clothing: 'Clothing', sell: 'Sell' })[category] || 'General Store';
  }

  function ensureGeneralStoreSellUi() {
    const tabs = document.querySelector('.general-store-tab')?.parentElement; // Used to add the missing point-of-sale category without duplicating index markup.
    if (tabs && !tabs.querySelector('[data-general-store-cat="sell"]')) {
      const sellTab = document.createElement('button'); // Used as the General Store's dedicated player-item selling tab.
      sellTab.className = 'supply-tab general-store-tab';
      sellTab.dataset.generalStoreCat = 'sell';
      sellTab.type = 'button';
      sellTab.textContent = 'Sell';
      const allTab = tabs.querySelector('[data-general-store-cat="all"]'); // Used to keep Sell beside the other specific categories, before All.
      tabs.insertBefore(sellTab, allTab || null);
    }
    if (!document.getElementById('generalStoreSellStyles')) {
      const style = document.createElement('style'); // Used for compact two-button sell controls on desktop and mobile.
      style.id = 'generalStoreSellStyles';
      style.textContent = `
        #mpGeneralStore .gs-sell-actions { display:flex; flex:0 0 auto; gap:4px; align-items:center; flex-wrap:wrap; justify-content:flex-end; }
        #mpGeneralStore .gs-sell-actions .shop-buy-btn { min-width:74px; padding-inline:7px; }
        #mpGeneralStore .gs-sell-empty { color:var(--muted); font-size:11px; padding:12px; text-align:center; border:1px dashed var(--border); border-radius:10px; }
        @media (max-width:760px) { #mpGeneralStore .gs-sell-actions { flex-direction:column; align-items:stretch; } #mpGeneralStore .gs-sell-actions .shop-buy-btn { min-width:68px; } }
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
    const result = window.ShippingPanel?.sellInventoryAtStore?.(item.key, quantity); // Used to route immediate store sales through the same canonical economy bridge as shipping.
    if (!result?.moved) { deps.showToast('Nothing to sell.', false); return; }
    deps.showToast(`Sold ${result.moved}× ${item.label} for ${result.earned}g`, true);
    renderGeneralStorePage();
  }

  function renderGeneralStoreSell(list) {
    const sellable = window.ShippingPanel?.getSellableInventory?.() || []; // Used to show only pack stacks accepted by the Shipping Box economy table.
    if (!sellable.length) {
      const empty = document.createElement('div'); // Used as clear feedback when the player has no store-sellable pack items.
      empty.className = 'gs-sell-empty';
      empty.textContent = 'No sellable items in your pack.';
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
          <div class="sh-desc">${deps.esc(item.desc || 'Sell directly to Funji & Son.')}</div>
          <div class="sh-price">${item.count} in pack · ${item.price}g each · ${item.count * item.price}g stack</div>
        </div>
        <div class="gs-sell-actions">
          <button class="shop-buy-btn gs-sell-one" type="button">Sell 1</button>
          <button class="shop-buy-btn gs-sell-stack" type="button">Sell Stack</button>
        </div>
      `;
      row.querySelector('.gs-sell-one')?.addEventListener('click', () => sellGeneralStoreItem(item, 1));
      row.querySelector('.gs-sell-stack')?.addEventListener('click', () => sellGeneralStoreItem(item, 'stack'));
      list.appendChild(row);
    });
  }

  // Rerolled fresh every calendar day from a seeded RNG (deterministic per
  // day, so opening the store twice the same day always shows the same
  // rack) — one entry per GENERAL_STORE_CLOTHING_SLOTS slot.
  function generateDailyClothingStock(day) {
    const stock = [];
    const catalog = window.DyeSystem.getCatalog();
    // Condition-eligible candidates only (e.g. a season-gated piece) --
    // falls back to the full list if conditions would otherwise empty it
    // out entirely, so a misconfigured pool never bricks the shop.
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
        uid:        'citem_gs_' + day + '_' + i,
        cosmeticId: piece.id,
        slot:       piece.category,
        label:      dyeLbl + ' ' + piece.label,
        baseLabel:  piece.label,
        colorA:     window.DyeSystem.toClothingColor(dyeA),
        colorB:     window.DyeSystem.toClothingColor(dyeB),
        price:      piece.price,
        sellPrice:  Math.floor(piece.price * 0.4),
        sprite:     deps.clothingSpriteForCosmetic(piece.id),
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
    const sectionTitle = document.getElementById('generalStoreSectionTitle');
    if (sectionTitle) sectionTitle.textContent = 'Funji & Son\'s General Store — ' + getGeneralStoreCategoryLabel(generalStoreActiveCategory);
    const list   = document.getElementById('generalStoreList');
    const goldEl = document.getElementById('gsGoldDisplay');
    if (goldEl) goldEl.innerHTML = `${deps.inventory.gold || 0}<span class="wallet-unit">g</span>`;
    if (!list) return;
    list.innerHTML = '';
    if (generalStoreActiveCategory === 'goods' || generalStoreActiveCategory === 'all') renderGeneralStoreGoods(list);
    if (generalStoreActiveCategory === 'clothing' || generalStoreActiveCategory === 'all') renderGeneralStoreClothing(list);
    if (generalStoreActiveCategory === 'sell') renderGeneralStoreSell(list);
  }

  window.GeneralStore = {
    init,
    render: renderGeneralStorePage,
  };
})();