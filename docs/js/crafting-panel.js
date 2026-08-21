// CampfireSystem must install before game.js initializes DevSpawner/CalendarSystem
// so it can capture the live map/player/calendar dependencies without adding new
// wiring to the large game closure. Load the normalized furniture database and
// its visual bridge first so CampfireSystem renders the database campfire rather
// than its old placeholder mesh.
(() => {
  if (window.CampfireSystem || document.querySelector('script[data-hobunji-campfire-system]')) return;
  const databaseSrc = 'js/normalized-furniture-database.js?v=20260819a';
  const visualSrc = 'js/campfire-furniture-visual.js?v=20260819a';
  const campfireSrc = 'js/campfire-system.js?v=20260821a';

  if (document.readyState === 'loading') {
    if (!window.HobunjiNormalizedFurnitureDatabase && !document.querySelector('script[data-hobunji-normalized-furniture]')) {
      document.write(`<script src="${databaseSrc}" data-hobunji-normalized-furniture="1"><\/script>`);
    }
    if (!window.CampfireFurnitureVisual && !document.querySelector('script[data-hobunji-campfire-visual]')) {
      document.write(`<script src="${visualSrc}" data-hobunji-campfire-visual="1"><\/script>`);
    }
    document.write(`<script src="${campfireSrc}" data-hobunji-campfire-system="1"><\/script>`);
    return;
  }

  const loadScript = (src, dataKey, ready) => new Promise(resolve => {
    if (ready()) { resolve(); return; }
    let script = document.querySelector(`script[${dataKey}]`);
    if (!script) {
      script = document.createElement('script');
      script.src = src;
      script.async = false;
      script.setAttribute(dataKey, '1');
      document.head.appendChild(script);
    }
    script.addEventListener('load', resolve, { once: true });
  });

  loadScript(databaseSrc, 'data-hobunji-normalized-furniture', () => !!window.HobunjiNormalizedFurnitureDatabase)
    .then(() => loadScript(visualSrc, 'data-hobunji-campfire-visual', () => !!window.CampfireFurnitureVisual))
    .then(() => {
      if (window.CampfireSystem || document.querySelector('script[data-hobunji-campfire-system]')) return;
      const script = document.createElement('script');
      script.src = campfireSrc;
      script.async = false;
      script.dataset.hobunjiCampfireSystem = '1';
      document.head.appendChild(script);
    });
})();

(() => {
  'use strict';

  // Crafting tab (Inventory panel's Crafting sub-tab) — furniture blueprints
  // plus a small set of blueprint-free survival recipes. Furniture still turns
  // an owned blueprint into the finished item using wood + stone; Campfire is
  // deliberately different because it is a disposable portable campsite.
  let deps = null;
  function init(injectedDeps) {
    deps = injectedDeps;
    window.CampfireSystem?.attachCraftingDeps?.(injectedDeps);
  }

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

  function craftFurnitureFromBlueprint(blueprintKey) {
    const bp = deps.FURNITURE_BLUEPRINT_CATALOG.find(b => b.key === blueprintKey);
    if (!bp) return;
    if ((deps.inventory[bp.key] || 0) < 1) { deps.showToast('No blueprint to build from.', false); return; }
    if (ownedWoodCount() < bp.craftCost.wood) { deps.showToast(`Not enough wood — need ${bp.craftCost.wood} (Pine/Shadewood Log).`, false); return; }
    if ((deps.inventory.stone || 0) < bp.craftCost.stone) { deps.showToast(`Not enough stone — need ${bp.craftCost.stone}.`, false); return; }
    deps.inventory[bp.key] -= 1;
    deps.clampInventoryStack(bp.key);
    consumeWood(bp.craftCost.wood);
    deps.inventory.stone -= bp.craftCost.stone;
    deps.clampInventoryStack('stone');
    deps.inventory[bp.furnitureKey] = Math.min(99, (deps.inventory[bp.furnitureKey] || 0) + 1);
    deps.showToast(`Built a ${bp.name}!`, true);
    renderCraftingPanel();
    deps.buildInventoryGrid();
    deps.saveMemberWorldData();
  }

  function appendCampfireRecipe(list) {
    if (craftingActiveCategory !== 'all' || !window.CampfireSystem) return false;
    const cost = window.CampfireSystem.CRAFT_COST;
    const haveWood = ownedWoodCount();
    const haveStone = deps.inventory.stone || 0;
    const owned = window.CampfireSystem.ownedCount?.() || 0;
    const canBuild = haveWood >= cost.wood && haveStone >= cost.stone;
    const row = document.createElement('div');
    row.className = 'shop-row';
    row.innerHTML = `
      <div class="sh-icon">🔥</div>
      <div class="sh-info">
        <div class="sh-name">Campfire</div>
        <div class="sh-desc">Survival recipe — no blueprint. Needs ${cost.wood} Wood (have ${haveWood}) + ${cost.stone} Stone (have ${haveStone}). ${owned} ready to place.</div>
      </div>
      <button class="shop-buy-btn" data-craft-campfire ${canBuild ? '' : 'disabled'}>Craft</button>
    `;
    row.querySelector('[data-craft-campfire]')?.addEventListener('click', () => {
      if (window.CampfireSystem.craft?.()) renderCraftingPanel();
    });
    list.appendChild(row);
    return true;
  }

  function renderCraftingPanel() {
    bindCraftingTabs();
    const list = document.getElementById('craftingList');
    if (!list) return;
    list.innerHTML = '';
    const visible = deps.FURNITURE_BLUEPRINT_CATALOG.filter(bp => craftingActiveCategory === 'all' || bp.category === craftingActiveCategory);
    const owned = visible.filter(bp => (deps.inventory[bp.key] || 0) > 0);
    const hasCampfireRecipe = appendCampfireRecipe(list);
    if (!owned.length && !hasCampfireRecipe) {
      const empty = document.createElement('div');
      empty.className = 'ii-empty';
      empty.textContent = "No blueprints yet — buy one from the carpenter's shop.";
      list.appendChild(empty);
      return;
    }
    const haveWood = ownedWoodCount();
    const haveStone = deps.inventory.stone || 0;
    owned.forEach(bp => {
      const ownedCount = deps.inventory[bp.key] || 0;
      const canBuild = haveWood >= bp.craftCost.wood && haveStone >= bp.craftCost.stone;
      const row = document.createElement('div');
      row.className = 'shop-row';
      row.innerHTML = `
        <div class="sh-icon">${bp.icon}</div>
        <div class="sh-info">
          <div class="sh-name">${deps.esc(bp.name)}</div>
          <div class="sh-desc">Needs ${bp.craftCost.wood} Wood (have ${haveWood}) + ${bp.craftCost.stone} Stone (have ${haveStone}) — Blueprints owned: ${ownedCount}</div>
        </div>
        <button class="shop-buy-btn" data-bp="${bp.key}" ${canBuild ? '' : 'disabled'}>Build</button>
      `;
      row.querySelector('[data-bp]')?.addEventListener('click', () => craftFurnitureFromBlueprint(bp.key));
      list.appendChild(row);
    });
  }

  window.CraftingPanel = { init, render: renderCraftingPanel };
})();
