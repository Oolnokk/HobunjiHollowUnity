(() => {
  'use strict';

  // Crafting tab (Inventory panel's Crafting sub-tab) — turns an owned
  // furniture blueprint into the finished furniture item using wood (any
  // log — pine or shadewood) and stone gathered with the axe and pick.
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
    const visible = deps.FURNITURE_BLUEPRINT_CATALOG.filter(bp => craftingActiveCategory === 'all' || bp.category === craftingActiveCategory);
    const owned = visible.filter(bp => (deps.inventory[bp.key] || 0) > 0);
    if (!owned.length) {
      const empty = document.createElement('div');
      empty.className = 'ii-empty';
      empty.textContent = "No blueprints yet — buy one from the carpenter's shop.";
      list.appendChild(empty);
      return;
    }
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

  window.CraftingPanel = { init, render: renderCraftingPanel };
})();
