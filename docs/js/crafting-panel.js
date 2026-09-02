(() => {
  'use strict';

  // Crafting tab (Inventory panel's Crafting sub-tab) — builds furniture
  // from permanent blueprints and works five raw ore into one pure/alloy bar.
  // Reachable from anywhere, not gated to standing at the carpenter's
  // shop, same as any other Inventory tab. Extracted out of game.js
  // following the same window.<Namespace> + init(deps) pattern as its
  // sibling systems.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  let craftingActiveCategory = 'all';

  function ownedWoodCount() {
    return (deps.inventory.pineLog || 0) + (deps.inventory.shadewoodLog || 0);
  }
  function consumeWood(amount) {
    let remaining = amount;
    for (const key of ['pineLog', 'shadewoodLog']) {
      if (remaining <= 0) break;
      const have = deps.inventory[key] || 0;
      const take = Math.min(have, remaining);
      deps.inventory[key] = have - take;
      deps.clampInventoryStack(key);
      remaining -= take;
    }
  }

  function syncHeldOreDiscoveries() {
    const heldOreKeys = Object.keys(deps.ORE_DEFS).filter(oreKey => (deps.inventory[deps.metalOreItemKey(oreKey)] || 0) > 0); // Used to migrate ore held by a save made before permanent discovery tracking existed.
    deps.recordHeldOres(heldOreKeys);
  }

  function visibleMetalRecipes() {
    syncHeldOreDiscoveries();
    return Object.entries(deps.METAL_BAR_RECIPES).filter(([, ingredients]) =>
      Object.keys(ingredients).every(oreKey => deps.hasDiscoveredOre(oreKey)));
  }

  function craftMetalBar(metalKey) {
    const ingredients = deps.METAL_BAR_RECIPES[metalKey]; // Used to validate and consume the same authored quantities shown in the row.
    const metal = deps.METAL_DEFS[metalKey];
    if (!ingredients || !metal) return;
    for (const [oreKey, amount] of Object.entries(ingredients)) {
      const itemKey = deps.metalOreItemKey(oreKey); // Used to keep ore consumption aligned with mine reward inventory keys.
      if ((deps.inventory[itemKey] || 0) < amount) { deps.showToast(`Not enough ${deps.ORE_DEFS[oreKey].label}.`, false); return; }
    }
    for (const [oreKey, amount] of Object.entries(ingredients)) {
      const itemKey = deps.metalOreItemKey(oreKey);
      deps.inventory[itemKey] -= amount;
      deps.clampInventoryStack(itemKey);
    }
    const barKey = deps.metalBarItemKey(metalKey); // Used as the existing smithing, plating, and ladder material key.
    deps.inventory[barKey] = Math.min(99, (deps.inventory[barKey] || 0) + 1);
    deps.showToast(`Crafted 1 ${metal.label} Bar!`, true);
    renderCraftingPanel();
    deps.buildInventoryGrid();
    deps.saveMemberWorldData();
  }

  function bindCraftingTabs() {
    document.querySelectorAll('.crafting-cat-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.craftingCat === craftingActiveCategory);
      btn.onclick = () => {
        craftingActiveCategory = btn.dataset.craftingCat || 'all';
        renderCraftingPanel();
      };
    });
  }

  // Blueprints are a permanent, reusable unlock (bought once from the
  // carpenter — see FURNITURE_BLUEPRINT_CATALOG's price, which is priced
  // higher than the old one-build-per-copy scheme to account for that) —
  // building from one only ever consumes Wood/Stone, never the blueprint
  // itself.
  function craftFurnitureFromBlueprint(blueprintKey) {
    const bp = deps.FURNITURE_BLUEPRINT_CATALOG.find(b => b.key === blueprintKey);
    if (!bp) return;
    if ((deps.inventory[bp.key] || 0) < 1) { deps.showToast('No blueprint to build from.', false); return; }
    if (ownedWoodCount() < bp.craftCost.wood) { deps.showToast(`Not enough wood — need ${bp.craftCost.wood} (Pine/Shadewood Log).`, false); return; }
    if ((deps.inventory.stone || 0) < bp.craftCost.stone) { deps.showToast(`Not enough stone — need ${bp.craftCost.stone}.`, false); return; }
    consumeWood(bp.craftCost.wood);
    deps.inventory.stone -= bp.craftCost.stone;
    deps.clampInventoryStack('stone');
    deps.inventory[bp.furnitureKey] = Math.min(99, (deps.inventory[bp.furnitureKey] || 0) + 1);
    deps.showToast(`Built a ${bp.name}!`, true);
    renderCraftingPanel();
    deps.buildInventoryGrid();
    deps.saveMemberWorldData();
  }

  function renderCraftingPanel() {
    bindCraftingTabs();
    const list = document.getElementById('craftingList');
    if (!list) return;
    list.innerHTML = '';
    const showMetallurgy = craftingActiveCategory === 'all' || craftingActiveCategory === 'metallurgy'; // Used to keep ore recipes out of furniture-specific filters.
    const visible = deps.FURNITURE_BLUEPRINT_CATALOG.filter(bp => craftingActiveCategory === 'all' || bp.category === craftingActiveCategory);
    const owned = visible.filter(bp => (deps.inventory[bp.key] || 0) > 0);
    const metalRecipes = showMetallurgy ? visibleMetalRecipes() : [];
    if (!owned.length && !metalRecipes.length) {
      const empty = document.createElement('div');
      empty.className = 'ii-empty';
      empty.textContent = craftingActiveCategory === 'metallurgy'
        ? 'No metal recipes discovered — hold a kind of ore to reveal recipes that use it.'
        : 'No blueprints or discovered recipes in this category yet.';
      list.appendChild(empty);
      return;
    }
    metalRecipes.forEach(([metalKey, ingredients]) => {
      const metal = deps.METAL_DEFS[metalKey];
      const ingredientRows = Object.entries(ingredients).map(([oreKey, amount]) => {
        const have = deps.inventory[deps.metalOreItemKey(oreKey)] || 0; // Used in the mobile-readable affordability description.
        return `${amount} ${deps.ORE_DEFS[oreKey].label} (have ${have})`;
      });
      const canCraft = Object.entries(ingredients).every(([oreKey, amount]) => (deps.inventory[deps.metalOreItemKey(oreKey)] || 0) >= amount);
      const row = document.createElement('div');
      row.className = 'shop-row';
      row.innerHTML = `
        <div class="sh-icon">🔶</div>
        <div class="sh-info">
          <div class="sh-name">${deps.esc(metal.label)} Bar</div>
          <div class="sh-desc">${ingredientRows.map(deps.esc).join(' + ')} → 1 bar</div>
        </div>
        <button class="shop-buy-btn" data-metal-recipe="${metalKey}" ${canCraft ? '' : 'disabled'}>Craft</button>
      `;
      row.querySelector('[data-metal-recipe]')?.addEventListener('click', () => craftMetalBar(metalKey));
      list.appendChild(row);
    });
    const haveWood = ownedWoodCount();
    const haveStone = deps.inventory.stone || 0;
    owned.forEach(bp => {
      const canBuild = haveWood >= bp.craftCost.wood && haveStone >= bp.craftCost.stone;
      const row = document.createElement('div');
      row.className = 'shop-row';
      row.innerHTML = `
        <div class="sh-icon">${bp.icon}</div>
        <div class="sh-info">
          <div class="sh-name">${deps.esc(bp.name)}</div>
          <div class="sh-desc">Needs ${bp.craftCost.wood} Wood (have ${haveWood}) + ${bp.craftCost.stone} Stone (have ${haveStone}) — blueprint known, build as many as you like</div>
        </div>
        <button class="shop-buy-btn" data-bp="${bp.key}" ${canBuild ? '' : 'disabled'}>Build</button>
      `;
      row.querySelector('[data-bp]')?.addEventListener('click', () => craftFurnitureFromBlueprint(bp.key));
      list.appendChild(row);
    });
  }

  window.CraftingPanel = { init, render: renderCraftingPanel, craftMetalBar, visibleMetalRecipes };
})();
