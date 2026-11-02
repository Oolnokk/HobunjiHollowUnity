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

  function ingredientItemKey(key) {
    return key.startsWith('bar_') ? key : deps.metalOreItemKey(key); // Alloying consumes native copper bars; direct smelting consumes ore.
  }

  function ingredientLabel(key) {
    if (!key.startsWith('bar_')) return deps.ORE_DEFS[key]?.label || key;
    const metalLabel = deps.METAL_DEFS[key.slice(4)]?.label; // Bar name fallback when an old save has no registered item definition.
    return deps.ITEM_DEFS?.[key]?.label || (metalLabel ? metalLabel + ' Bar' : key);
  }

  function visibleMetalRecipes() {
    const registered = deps?.METAL_DEFS || {}; // Rejects unregistered material keys without tying crafting permissions to Town Value.
    const direct = Object.entries(deps?.METAL_BAR_RECIPES || {})
      .filter(([metalKey, ingredients]) => registered[metalKey] && ingredients && typeof ingredients === 'object')
      .map(([metalKey, ingredients]) => [metalKey, ingredients, 'ore']); // Every known bar can be smelted as soon as its ore is found.
    const alternates = Object.entries(deps?.METAL_BAR_ALTERNATES || {}).flatMap(([metalKey, variants]) =>
      registered[metalKey] && Array.isArray(variants) ? variants.flatMap((ingredients, index) =>
        ingredients && typeof ingredients === 'object' ? [[metalKey, ingredients, 'alloy-' + index]] : []) : []); // Cassiterite/copper alloying is equally available from the outset.
    return direct.concat(alternates);
  }

  function craftMetalBar(metalKey, recipeVariant = 'ore') {
    const ingredients = visibleMetalRecipes().find(([key,,variant]) => key === metalKey && variant === recipeVariant)?.[1]; // Validate the actual authored recipe and live inventory, not Town Value.
    const metal = deps.METAL_DEFS[metalKey];
    if (!ingredients || !metal) return;
    const barKey = deps.metalBarItemKey(metalKey); // Output remains the existing smithing/foundry bar ID.
    if ((deps.inventory[barKey] || 0) >= window.InventoryStacks.MAX_TOTAL) { deps.showToast('No room for another bar.', false); return; }
    for (const [oreKey, amount] of Object.entries(ingredients)) {
      const itemKey = ingredientItemKey(oreKey); // Supports either raw ore or native-copper bars.
      if ((deps.inventory[itemKey] || 0) < amount) { deps.showToast(`Not enough ${ingredientLabel(oreKey)}.`, false); return; }
    }
    for (const [oreKey, amount] of Object.entries(ingredients)) {
      const itemKey = ingredientItemKey(oreKey);
      deps.inventory[itemKey] -= amount;
      deps.clampInventoryStack(itemKey);
    }
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
      latestChange: 'Metal bar recipes and alloy variants require their ingredients, not Town Value; advanced metal loot restrictions are unchanged.',
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
        ? 'No registered metal recipes available.'
        : 'No blueprints or discovered recipes in this category yet.';
      list.appendChild(empty);
      return;
    }
    metalRecipes.forEach(([metalKey, ingredients, recipeVariant]) => {
      const metal = deps.METAL_DEFS[metalKey];
      const ingredientRows = Object.entries(ingredients).map(([oreKey, amount]) => {
        const have = deps.inventory[ingredientItemKey(oreKey)] || 0; // Actual ore or metal-bar stack, whichever this recipe requires.
        return `${amount} ${ingredientLabel(oreKey)} (have ${have})`;
      });
      const canCraft = Object.entries(ingredients).every(([oreKey, amount]) => (deps.inventory[ingredientItemKey(oreKey)] || 0) >= amount) && (deps.inventory[deps.metalBarItemKey(metalKey)] || 0) < window.InventoryStacks.MAX_TOTAL;
      const row = document.createElement('div');
      row.className = 'shop-row';
      row.innerHTML = `
        <div class="sh-icon">🔶</div>
        <div class="sh-info">
          <div class="sh-name">${deps.esc(metal.label)} Bar${recipeVariant.startsWith("alloy") ? " — Alloying" : ""}</div>
          <div class="sh-desc">${ingredientRows.map(deps.esc).join(' + ')} → 1 bar</div>
        </div>
        <button class="shop-buy-btn" data-metal-recipe="${metalKey}" ${canCraft ? '' : 'disabled'}>Craft</button>
      `;
      row.querySelector('[data-metal-recipe]')?.addEventListener('click', () => craftMetalBar(metalKey, recipeVariant));
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
    ['js/npc-crafting-commission-delivery.js?v=20261102h8673330', () => Number(window.NpcCraftingCommissionDelivery?.version) >= 2],
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
