(() => {
  'use strict';

  // Shared renderer for every shop pool that deliberately targets the
  // General Store menu surface. Funji's shop keeps clothing + store selling;
  // specialized shops reuse the same buying UI with their own configured goods.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  function shippingCfg() {
    if (!window.ShippingBoxConfig) throw new Error('ShippingBoxConfig must load before GeneralStore Shipping integration');
    return window.ShippingBoxConfig;
  }

  const DEFAULT_POOL_ID = 'generalStoreWares'; // Used only as the backwards-compatible fallback shop.
  let generalStoreActiveCategory = 'goods'; // Existing tab state; reset when moving between different shop pools.
  let lastRenderedPoolId = null; // Used to avoid carrying Clothing/Sell selection into a goods-only specialist shop.

  function shopStock() {
    return window.LootRolling?.getShopStock?.() || {};
  }

  function currentMapId() {
    return deps?.lootShopWorldState?.()?.maps || '';
  }

  function activeShopState() {
    const stock = shopStock();
    const mapId = currentMapId();
    const matchesMap = ([, shop]) => shop?.menuId === 'generalStore'
      && Array.isArray(shop?.dialogueAccess?.businessMaps)
      && shop.dialogueAccess.businessMaps.includes(mapId);
    const match = Object.entries(stock).find(matchesMap);
    const poolId = match?.[0] || DEFAULT_POOL_ID;
    const shop = match?.[1] || stock[DEFAULT_POOL_ID] || {
      label: "Funji & Son's General Store",
      menuId: 'generalStore',
      goods: deps?.getGeneralStoreCatalog?.() || [],
    };
    return { poolId, shop, specialized: poolId !== DEFAULT_POOL_ID };
  }

  function getGeneralStoreCategoryLabel(category, state = activeShopState()) {
    if (state.specialized) return 'Goods';
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

  function bindGeneralStoreTabs(state = activeShopState()) {
    ensureGeneralStoreSellUi();
    if (lastRenderedPoolId !== state.poolId) {
      lastRenderedPoolId = state.poolId;
      generalStoreActiveCategory = 'goods';
    }

    const store = shippingCfg().store;
    document.querySelectorAll('.general-store-tab').forEach(btn => {
      const category = btn.dataset.generalStoreCat || 'goods';
      const allowed = !state.specialized || category === 'goods';
      btn.hidden = !allowed;
      if (!allowed && generalStoreActiveCategory === category) generalStoreActiveCategory = 'goods';
      btn.classList.toggle('active', allowed && category === generalStoreActiveCategory);
      btn.onclick = allowed ? () => {
        generalStoreActiveCategory = category;
        renderGeneralStorePage();
      } : null;
    });

    const tablist = document.querySelector('#mpGeneralStore .supply-tabs');
    if (tablist) tablist.setAttribute('aria-label', state.specialized ? `${state.shop.label || 'Shop'} category filters` : 'General store category filters');
    const sellTab = document.querySelector(`[data-general-store-cat="${store.categoryKey}"]`);
    if (sellTab && state.specialized) sellTab.hidden = true;
  }

  function configuredGrants(item) {
    const grants = { ...(item?.gives || {}) }; // Used for ordinary shop item stacks.
    if (item?.alchemyRecipeId && window.AlchemySystem?.ensureRecipeItemDef) {
      const potencyTier = Math.max(0, Number(item.alchemyPotencyTier) || 0); // Used to register the exact authored potion tier.
      const key = window.AlchemySystem.ensureRecipeItemDef(item.alchemyRecipeId, potencyTier);
      if (key) grants[key] = (grants[key] || 0) + Math.max(1, Number(item.quantity) || 1);
    }
    return grants;
  }

  function configuredQualityStars(item) {
    const authoredStars = Number(item?.qualityStars); // Used to preserve explicitly authored shop-food quality instead of falling back to an item's normal quality later.
    return Number.isFinite(authoredStars) ? Math.max(1, Math.min(5, Math.round(authoredStars))) : null;
  }

  function addConfiguredGrant(key, value, qualityStars) {
    const requestedAmount = Math.max(0, Number(value) || 0); // Used to normalize shop grants before applying the 99-item stack cap.
    const previousAmount = Math.max(0, Number(deps.inventory[key]) || 0); // Used to measure how many units actually fit in the inventory stack.
    const nextAmount = Math.min(99, previousAmount + requestedAmount); // Used as the authoritative post-purchase stack count.
    const addedAmount = Math.max(0, nextAmount - previousAmount); // Used so quality buckets never record units rejected by the stack cap.
    deps.inventory[key] = nextAmount;
    if (qualityStars != null && addedAmount > 0) window.CookingSystem?.recordItemQuality?.(key, qualityStars, addedAmount);
  }

  function ensureConfiguredGoodsDefs(item) {
    configuredGrants(item);
    window.AnimalGrowth?.ensureItemDef?.(deps); // Registers Growth Tonic from the animal-growth module when this shop exposes it.
  }

  function buyGeneralStoreItem(item) {
    const gold = deps.inventory.gold || 0;
    if (gold < item.price) { deps.showToast('Not enough gananji.', false); return; }
    const grants = configuredGrants(item);
    if (!Object.keys(grants).length) {
      deps.showToast('That shop item has no configured inventory grant.', false);
      return;
    }

    const qualityStars = configuredQualityStars(item); // Used for minimum-quality food staples without changing ordinary shop goods.
    deps.inventory.gold = gold - item.price;
    Object.entries(grants).forEach(([key, value]) => addConfiguredGrant(key, value, qualityStars));
    deps.showToast('Bought ' + item.name + '!', true);
    renderGeneralStorePage();
    deps.buildInventoryGrid();
    deps.refreshActionBar?.();
    deps.saveMemberWorldData();
  }

  function goodsForShop(state) {
    if (!state.specialized) return deps.getGeneralStoreCatalog();
    return Array.isArray(state.shop.goods) ? state.shop.goods : [];
  }

  function renderGeneralStoreGoods(list, state = activeShopState()) {
    const world = deps.lootShopWorldState();
    goodsForShop(state).filter(item => window.ConditionRegistry.entryEligible(item, world)).forEach(item => {
      ensureConfiguredGoodsDefs(item);
      const row = document.createElement('div');
      row.className = 'shop-row';
      row.innerHTML = `
        <div class="sh-icon">${item.icon}</div>
        <div class="sh-info">
          <div class="sh-name">${deps.esc?.(item.name) || item.name}</div>
          <div class="sh-desc">${deps.esc?.(item.desc) || item.desc}</div>
          <div class="sh-price">${item.price}g each</div>
        </div>
        <button class="shop-buy-btn" type="button">Buy</button>
      `;
      row.querySelector('.shop-buy-btn')?.addEventListener('click', () => buyGeneralStoreItem(item));
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
        if ((deps.inventory.gold || 0) < item.price) { deps.showToast('Not enough gananji.', false); return; }
        deps.inventory.gold = (deps.inventory.gold || 0) - item.price;
        deps.getPackClothing().push({ ...item });
        deps.showToast('Bought ' + item.label + '!', true);
        renderGeneralStorePage(); deps.buildInventoryGrid(); deps.buildPackClothingSection();
        deps.saveMemberWorldData();
      });
    });
  }

  function renderGeneralStorePage() {
    const state = activeShopState();
    bindGeneralStoreTabs(state);
    const sectionTitle = document.getElementById('generalStoreSectionTitle');
    if (sectionTitle) sectionTitle.textContent = `${state.shop.label || 'Shop'} — ${getGeneralStoreCategoryLabel(generalStoreActiveCategory, state)}`;
    const list = document.getElementById('generalStoreList');
    const goldEl = document.getElementById('gsGoldDisplay');
    if (goldEl) goldEl.innerHTML = `${deps.inventory.gold || 0}<span class="wallet-unit">g</span>`;
    if (!list) return;
    list.innerHTML = '';

    if (state.specialized) {
      renderGeneralStoreGoods(list, state);
      return;
    }
    if (generalStoreActiveCategory === 'goods' || generalStoreActiveCategory === 'all') renderGeneralStoreGoods(list, state);
    if (generalStoreActiveCategory === 'clothing' || generalStoreActiveCategory === 'all') renderGeneralStoreClothing(list);
    if (generalStoreActiveCategory === shippingCfg().store.categoryKey) renderGeneralStoreSell(list);
  }

  function debugSnapshot() {
    const state = activeShopState();
    return {
      mostRecentChange: 'Configured shop food can now grant an explicit 1-5 star quality; the General Store uses this for minimum-quality cooking staples.',
      poolId: state.poolId,
      label: state.shop.label,
      mapId: currentMapId(),
      specialized: state.specialized,
      goods: goodsForShop(state).map(item => ({ key: item.key, name: item.name, price: item.price, qualityStars: configuredQualityStars(item), alchemyRecipeId: item.alchemyRecipeId || null })),
    };
  }

  window.GeneralStore = { init, render: renderGeneralStorePage, debugSnapshot };
})();

// General Store is already loaded before game.js. Use that stable parser slot
// to load ShippingBoxConfig, then the separate world adapter, before game boot.
if (document.readyState === 'loading') {
  if (!window.ShippingBoxConfig) document.write('<script src="js/shipping-box-config.js?v=20260902shipping6"></scr' + 'ipt>');
  if (!window.__shippingBoxWorldInstalled) document.write('<script src="js/shipping-box-world.js?v=20260902shipping6"></scr' + 'ipt>');
}
