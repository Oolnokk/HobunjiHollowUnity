(() => {
  'use strict';

  // Funji & Son's General Store: goods + a daily-rotating clothing rack.
  // Extracted out of game.js following the same window.<Namespace> +
  // init(deps) pattern as its sibling shop modules (most directly mirrors
  // js/jubmir-shop.js). GENERAL_STORE_CATALOG/STORE_CLOTHING_PIECES/
  // GENERAL_STORE_CLOTHING_SLOTS are threaded as getters since
  // _applyLoadedShopStock (game.js) reassigns them wholesale once
  // docs/config/shops/shop-stock.json loads; packClothing/gearInventory
  // likewise, since character load/logout reassigns those wholesale too.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  let generalStoreActiveCategory = 'goods'; // Mirrors the Supply Shop's own category tabs.

  function getGeneralStoreCategoryLabel(category) {
    return ({ all: 'All', goods: 'Goods', clothing: 'Clothing' })[category] || 'General Store';
  }

  function bindGeneralStoreTabs() {
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
      Object.entries(item.gives).forEach(([k, v]) => {
        deps.inventory[k] = Math.min(99, (deps.inventory[k] || 0) + v);
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
    const eligible = allPieces.filter(p => window.ConditionRegistry.entryEligible(p, world));
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
  }

  window.GeneralStore = {
    init,
    render: renderGeneralStorePage,
  };
})();
