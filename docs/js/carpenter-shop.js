(() => {
  'use strict';

  // Carpenter's shop: sells barn plans (see BARN_TIERS, game.js), modular
  // barn additions (shop-stock carpenterBarnPlans.additions), house piece
  // deeds (see HOUSE_PIECE_CATALOG, game.js), and furniture blueprints
  // (see FURNITURE_BLUEPRINT_CATALOG). Same shape as the General Store's
  // goods list, just its own catalogs. Extracted out of game.js following
  // the same window.<Namespace> + init(deps) pattern as its sibling shop
  // modules. getBarnTiers()/getHousePieceDeeds() are getters since
  // _applyLoadedShopStock (game.js) reassigns BARN_TIERS/
  // HOUSE_PIECE_CATALOG wholesale once docs/config/shops/shop-stock.json
  // loads. Barn additions deliberately stay in their own shop-stock pool so
  // they never leak into the farmhouse deed catalog/editor.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  function _barnAdditions() {
    return window.LootRolling?.getShopStock?.()?.carpenterBarnPlans?.additions || {};
  }

  function buyBarnPlan(tier) {
    const tierDef = deps.getBarnTiers()[tier];
    if (!tierDef) return;
    const gold = deps.inventory.gold || 0;
    if (gold < tierDef.price) { deps.showToast('Not enough gananji.', false); return; }
    deps.inventory.gold = gold - tierDef.price;
    deps.inventory[tierDef.planItem] = Math.min(9, (deps.inventory[tierDef.planItem] || 0) + 1);
    deps.showToast(`Bought a ${tierDef.label} plan!`, true);
    renderCarpenterShopPage();
    deps.buildInventoryGrid();
    deps.saveMemberWorldData();
  }

  // Generic configured barn additions. An addition owns only an inventory
  // plan item here; its feature module decides how/where that plan is placed
  // and consumed. This keeps the carpenter independent of Incubator logic and
  // lets future barn rooms use the same stock shape without new shop code.
  function buyBarnAddition(additionKey) {
    const def = _barnAdditions()[additionKey];
    if (!def?.planItem) return;
    const gold = deps.inventory.gold || 0;
    if (gold < def.price) { deps.showToast('Not enough gananji.', false); return; }
    deps.inventory.gold = gold - def.price;
    deps.inventory[def.planItem] = Math.min(9, (deps.inventory[def.planItem] || 0) + 1);
    deps.showToast(`Bought a ${def.label}!`, true);
    renderCarpenterShopPage();
    deps.buildInventoryGrid();
    deps.saveMemberWorldData();
  }

  // House piece deeds — bought here instead of built outright; place the
  // owned deed touching the existing house from the Farm tab, then interact
  // with the resulting foundation to build (see js/house-pieces.js).
  function buyHousePieceDeed(pieceKey) {
    const def = deps.getHousePieceDeeds()[pieceKey];
    if (!def) return;
    const gold = deps.inventory.gold || 0;
    if (gold < def.price) { deps.showToast('Not enough gananji.', false); return; }
    deps.inventory.gold = gold - def.price;
    deps.inventory[def.deedItem] = Math.min(9, (deps.inventory[def.deedItem] || 0) + 1);
    deps.showToast(`Bought a ${def.label}!`, true);
    renderCarpenterShopPage();
    deps.buildInventoryGrid();
    deps.saveMemberWorldData();
  }

  // Furniture blueprints — bought here instead of the finished piece (no
  // more direct General Store/mail-order furniture purchase); build the
  // actual furniture from an owned blueprint plus wood/stone at the
  // Inventory's Crafting tab (see game.js's renderCraftingPanel/
  // craftFurnitureFromBlueprint).
  function buyFurnitureBlueprint(blueprintKey) {
    const bp = deps.FURNITURE_BLUEPRINT_CATALOG.find(b => b.key === blueprintKey);
    if (!bp) return;
    const gold = deps.inventory.gold || 0;
    if (gold < bp.price) { deps.showToast('Not enough gananji.', false); return; }
    deps.inventory.gold = gold - bp.price;
    deps.inventory[bp.key] = Math.min(9, (deps.inventory[bp.key] || 0) + 1);
    deps.showToast(`Bought a ${bp.name} blueprint!`, true);
    renderCarpenterShopPage();
    deps.buildInventoryGrid();
    deps.saveMemberWorldData();
  }

  function renderCarpenterShopPage() {
    const goldEl = document.getElementById('cpGoldDisplay');
    if (goldEl) goldEl.innerHTML = `${deps.inventory.gold || 0}<span class="wallet-unit">g</span>`;
    const list = document.getElementById('carpenterShopList');
    if (!list) return;
    list.innerHTML = '';
    const world = deps.lootShopWorldState();

    const planHdr = document.createElement('div');
    planHdr.className = 'shop-section-label';
    planHdr.textContent = '🏚 Barn Plans';
    list.appendChild(planHdr);

    Object.entries(deps.getBarnTiers()).filter(([, def]) => window.ConditionRegistry.entryEligible(def, world)).forEach(([tier, def]) => {
      const owned = deps.inventory[def.planItem] || 0;
      const row = document.createElement('div');
      row.className = 'shop-row';
      row.innerHTML = `
        <div class="sh-icon">🏚</div>
        <div class="sh-info">
          <div class="sh-name">${deps.esc(def.label)} Plan</div>
          <div class="sh-desc">Houses up to ${def.slots} livestock. Owned: ${owned}</div>
          <div class="sh-price">${def.price}g each</div>
        </div>
        <button class="shop-buy-btn" data-tier="${tier}">Buy</button>
      `;
      row.querySelector('[data-tier]')?.addEventListener('click', () => buyBarnPlan(tier));
      list.appendChild(row);
    });

    const additions = Object.entries(_barnAdditions()).filter(([, def]) => window.ConditionRegistry.entryEligible(def, world));
    if (additions.length) {
      const additionHdr = document.createElement('div');
      additionHdr.className = 'shop-section-label';
      additionHdr.textContent = '🪚 Barn Additions';
      list.appendChild(additionHdr);
      additions.forEach(([additionKey, def]) => {
        const owned = deps.inventory[def.planItem] || 0;
        const row = document.createElement('div');
        row.className = 'shop-row';
        row.innerHTML = `
          <div class="sh-icon">${deps.esc(def.icon || '🪚')}</div>
          <div class="sh-info">
            <div class="sh-name">${deps.esc(def.label)}</div>
            <div class="sh-desc">${deps.esc(def.desc || 'A modular addition for a barn.')} Owned: ${owned}</div>
            <div class="sh-price">${def.price}g each</div>
          </div>
          <button class="shop-buy-btn" data-barn-addition="${deps.esc(additionKey)}">Buy</button>
        `;
        row.querySelector('[data-barn-addition]')?.addEventListener('click', () => buyBarnAddition(additionKey));
        list.appendChild(row);
      });
    }

    const deedHdr = document.createElement('div');
    deedHdr.className = 'shop-section-label';
    deedHdr.textContent = '🏗 House Deeds';
    list.appendChild(deedHdr);

    Object.entries(deps.getHousePieceDeeds()).filter(([, def]) => window.ConditionRegistry.entryEligible(def, world)).forEach(([pieceKey, def]) => {
      const owned = deps.inventory[def.deedItem] || 0;
      const row = document.createElement('div');
      row.className = 'shop-row';
      row.innerHTML = `
        <div class="sh-icon">🏗</div>
        <div class="sh-info">
          <div class="sh-name">${deps.esc(def.label)}</div>
          <div class="sh-desc">A ${def.w}×${def.h} room, placed touching your house from the Farm tab. Owned: ${owned}</div>
          <div class="sh-price">${def.price}g each</div>
        </div>
        <button class="shop-buy-btn" data-deed="${pieceKey}">Buy</button>
      `;
      row.querySelector('[data-deed]')?.addEventListener('click', () => buyHousePieceDeed(pieceKey));
      list.appendChild(row);
    });

    const bpHdr = document.createElement('div');
    bpHdr.className = 'shop-section-label';
    bpHdr.textContent = '📜 Furniture Blueprints';
    list.appendChild(bpHdr);

    deps.FURNITURE_BLUEPRINT_CATALOG.filter(bp => window.ConditionRegistry.entryEligible(bp, world)).forEach(bp => {
      const owned = deps.inventory[bp.key] || 0;
      const row = document.createElement('div');
      row.className = 'shop-row';
      row.innerHTML = `
        <div class="sh-icon">${bp.icon}</div>
        <div class="sh-info">
          <div class="sh-name">${deps.esc(bp.name)} Blueprint</div>
          <div class="sh-desc">Build with ${bp.craftCost.wood} Wood + ${bp.craftCost.stone} Stone in the Crafting tab. Owned: ${owned}</div>
          <div class="sh-price">${bp.price}g each</div>
        </div>
        <button class="shop-buy-btn" data-bp="${bp.key}">Buy</button>
      `;
      row.querySelector('[data-bp]')?.addEventListener('click', () => buyFurnitureBlueprint(bp.key));
      list.appendChild(row);
    });
  }

  window.CarpenterShop = {
    init,
    render: renderCarpenterShopPage,
  };
})();
