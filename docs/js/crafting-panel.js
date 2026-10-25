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

  let knownBlueprints = new Set(); // Permanent furniture lessons for the active character in this world.

  function restoreBlueprints(keys) {
    knownBlueprints = new Set(Array.isArray(keys) ? keys.filter(key => typeof key === 'string') : []);
  }

  function serializeBlueprints() { return [...knownBlueprints]; }

  function blueprintForItem(key) {
    return deps?.FURNITURE_BLUEPRINT_CATALOG?.find(bp => bp.key === key) || null;
  }

  function readBlueprint(key) {
    const bp = blueprintForItem(key); // Only ordinary registered recipe items can grant a lesson.
    if (!bp || bp.moteOnly || bp.masteryUnlockId || !(Number(deps.inventory[key]) > 0)) return { ok: false, message: 'That blueprint cannot be read.' };
    if (ownsBlueprint(bp)) return { ok: false, message: 'You already know this blueprint.' };
    knownBlueprints.add(key);
    deps.inventory[key]--;
    deps.clampInventoryStack(key);
    deps.saveMemberWorldData();
    return { ok: true, message: `Learned ${bp.name}!` };
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
    deps.inventory[barKey] = Math.min(window.InventoryStacks.MAX_TOTAL, (deps.inventory[barKey] || 0) + 1);
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

  function ownsBlueprint(bp) {
    if (bp?.masteryUnlockId) return !!window.CraftingMasterySystem?.hasUnlock?.(bp.masteryUnlockId);
    return !!bp && !bp.moteOnly && (bp.alwaysKnown || knownBlueprints.has(bp.key)); // Mastery ownership is world-scoped; legacy shop blueprint items cannot bypass it.
  }

  // Every UI and build check reads these same authored material rows. Wood
  // remains a shared Pine/Shadewood pool; other keys are real inventory items.
  function furnitureIngredients(bp) {
    if (!bp?.craftCost || typeof bp.craftCost !== 'object') return null;
    const rows = []; // Used by affordability, consumption, labels and mobile diagnostics.
    for (const [key, rawAmount] of Object.entries(bp.craftCost)) {
      const amount = Number(rawAmount); // Rejects malformed costs rather than silently making a recipe free.
      if (!Number.isSafeInteger(amount) || amount < 0) return null;
      if (!amount) continue;
      rows.push({
        key, amount,
        have: key === 'wood' ? ownedWoodCount() : Math.max(0, Number(deps.inventory[key]) || 0),
        label: key === 'wood' ? 'Wood (Pine/Shadewood Log)' : (deps.ITEM_DEFS?.[key]?.label || key),
      });
    }
    return rows.length ? rows : null;
  }

  function furnitureCostDescription(bp, includeHave = false) {
    const ingredients = furnitureIngredients(bp); // Used by both the carpenter preview and Crafting-tab recipe details.
    return ingredients ? ingredients.map(row => `${row.amount} ${row.label}${includeHave ? ` (have ${row.have})` : ''}`).join(' + ') : 'valid material costs';
  }

  function canBuildFurniture(bp) {
    const ingredients = furnitureIngredients(bp); // The exact rows also used by the click-time validation.
    return ownsBlueprint(bp) && !!ingredients && ingredients.every(row => row.have >= row.amount)
      && (deps.inventory[bp.furnitureKey] || 0) < window.InventoryStacks.MAX_TOTAL;
  }

  // Learned designs remain known after their recipe item is consumed. Validate every ingredient before
  // spending any stock, including a stale UI click after inventory changes.
  function craftFurnitureFromBlueprint(blueprintKey) {
    const bp = deps.FURNITURE_BLUEPRINT_CATALOG.find(b => b.key === blueprintKey); // Resolves only registered recipes.
    if (!bp) return false;
    if (!ownsBlueprint(bp)) { deps.showToast('No blueprint to build from.', false); return false; }
    const ingredients = furnitureIngredients(bp); // Captures the same live quantities displayed in the recipe row.
    if (!ingredients) { deps.showToast('This blueprint has invalid material costs.', false); return false; }
    const missing = ingredients.find(row => row.have < row.amount); // Blocks the transaction before consuming wood or any other ingredient.
    if (missing) { deps.showToast(`Not enough ${missing.label} — need ${missing.amount}.`, false); return false; }
    if ((deps.inventory[bp.furnitureKey] || 0) >= window.InventoryStacks.MAX_TOTAL) {
      deps.showToast('No room for more of this furniture.', false);
      return false;
    }
    // Wool uses the shared quality ledger so spent units cannot reappear as
    // phantom quality stacks. Automatic consumption protects the best stock.
    for (const row of ingredients.filter(row => row.key === 'lightWool' || row.key === 'puktukWool')) {
      if (window.CookingSystem?.consumeQualityByPolicy) {
        if (!window.CookingSystem.consumeQualityByPolicy(row.key, row.amount, 'lowest')) {
          deps.showToast(`Could not consume ${row.label}.`, false);
          return false;
        }
      } else {
        deps.inventory[row.key] -= row.amount;
        deps.clampInventoryStack(row.key);
      }
    }
    for (const row of ingredients) {
      if (row.key === 'lightWool' || row.key === 'puktukWool') continue;
      if (row.key === 'wood') consumeWood(row.amount);
      else {
        deps.inventory[row.key] -= row.amount;
        deps.clampInventoryStack(row.key);
      }
    }
    deps.inventory[bp.furnitureKey] = (deps.inventory[bp.furnitureKey] || 0) + 1;
    deps.showToast(`Built a ${bp.name}!`, true);
    renderCraftingPanel();
    deps.buildInventoryGrid();
    deps.saveMemberWorldData();
    return true;
  }

  function debugSnapshot() {
    return {
      latestChange: 'Read furniture blueprints directly from the bag to learn them permanently for this character in this world; Grooming Kit and Campfire Kit are automatically known.',
      knownBlueprints: serializeBlueprints(),
      recipes: (deps?.FURNITURE_BLUEPRINT_CATALOG || []).map(bp => ({
        key: bp.key, owned: ownsBlueprint(bp), canBuild: canBuildFurniture(bp), ingredients: furnitureIngredients(bp),
      })),
    };
  }

  function renderCraftingPanel() {
    bindCraftingTabs();
    const list = document.getElementById('craftingList');
    if (!list) return;
    list.innerHTML = '';
    const showMetallurgy = craftingActiveCategory === 'all' || craftingActiveCategory === 'metallurgy'; // Used to keep ore recipes out of furniture-specific filters.
    const visible = deps.FURNITURE_BLUEPRINT_CATALOG.filter(bp => craftingActiveCategory === 'all' || bp.category === craftingActiveCategory);
    const owned = visible.filter(ownsBlueprint);
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
    owned.forEach(bp => {
      const canBuild = canBuildFurniture(bp); // Shares validation with the build action, including extra materials and full stacks.
      const row = document.createElement('div');
      row.className = 'shop-row';
      row.innerHTML = `
        <div class="sh-icon">${bp.icon}</div>
        <div class="sh-info">
          <div class="sh-name">${deps.esc(bp.name)}</div>
          <div class="sh-desc">Needs ${deps.esc(furnitureCostDescription(bp, true))} — blueprint known, build as many as you like</div>
        </div>
        <button class="shop-buy-btn" data-bp="${bp.key}" ${canBuild ? '' : 'disabled'}>Build</button>
      `;
      row.querySelector('[data-bp]')?.addEventListener('click', () => craftFurnitureFromBlueprint(bp.key));
      list.appendChild(row);
    });
  }

  window.CraftingPanel = { ownsBlueprint, blueprintForItem, readBlueprint, restoreBlueprints, serializeBlueprints, init, render: renderCraftingPanel, craftMetalBar, visibleMetalRecipes, craftFurnitureFromBlueprint, furnitureCostDescription, debugSnapshot };
})();

// Crafting mastery + NPC crafting commissions live next to the CraftingPanel
// rather than in the broad combat compatibility loader. They install their
// adapters synchronously here; future-global hooks let them safely patch task,
// gifting, and shop modules regardless of those modules' parser order.
(() => {
  'use strict';
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return; // Headless regression VMs intentionally execute CraftingPanel without a browser loader.
  const modules = [
    ['js/crafting-mastery-system.js?v=20261005craft2', () => Number(window.CraftingMasterySystem?.version) >= 2],
    ['js/advanced-loom-system.js?v=20261005loom1', () => Number(window.AdvancedLoomSystem?.version) >= 1],
    ['js/dye-trait-labels.js?v=20261005craft1', () => Number(window.DyeTraitLabels?.version) >= 1],
    ['js/npc-crafting-commission-generator.js?v=20261022h2d5dcb6', () => Number(window.NpcCraftingCommissionGenerator?.version) >= 2],
    ['js/npc-crafting-commission-delivery.js?v=20261025h133c6f7', () => Number(window.NpcCraftingCommissionDelivery?.version) >= 2],
    ['js/npc-crafting-commissions.js?v=20261022hae47de3', () => Number(window.NpcCraftingCommissions?.version) >= 2],
  ]; // Local progression/commission modules loaded immediately after CraftingPanel publishes its API. Cache ownership is refreshed by the repo checker.

  function loadModule(src, alreadyLoaded) {
    if (alreadyLoaded()) return;
    if (document.readyState === 'loading' && typeof document.write === 'function') {
      document.write(`<script src="${src}"></` + 'script>');
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    document.head?.appendChild(script);
  }

  for (const [src, alreadyLoaded] of modules) loadModule(src, alreadyLoaded);
})();
