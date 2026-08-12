(() => {
  'use strict';

  const FOOD_DURATION_S = 300; // Used as the shared five-minute duration for cooked-food effects.
  const ITEM_ALIASES = { uumkaoiiEggs: 'uumkaoiiEgg', drenkirraEggs: 'drenkirraEgg' }; // Used to reuse existing singular inventory items from the prototype's plural ids.
  const NON_INGREDIENT_CATEGORIES = new Set(['wool', 'mineral', 'material']); // Used to omit prototype reference materials that are not edible/cookable ingredients.
  const CATEGORY_ICONS = {
    sweetPaste: '🍯', sweetLiquid: '🫙', liquor: '🍶', grain: '🌾', powder: '🥣', curds: '🥛', mayonnaise: '🥚', mustardSeed: '🌱', pungentPaste: '🧄', noodleBase: '🍜', cheese: '🧀', poultry: '🍗', meat: '🥩', whiteMilk: '🥛', seeds: '🌱', spice: '🌶️', fish: '🐟', mollusk: '🐚', starchVegetable: '🥔', butter: '🧈', vegetable: '🥬', brothBase: '🫕', berry: '🫐', fruit: '🍎', flour: '🥣', bread: '🍞', oil: '🫗', nut: '🥜', egg: '🥚', dairy: '🥛', sauce: '🫙', juice: '🧃', wine: '🍷', mead: '🍯', herb: '🌿', crop: '🌾', processedCrop: '🥣', processedProtein: '🍖', uumkaoiiDew: '💧', uumkaoiiMilk: '🥛', uumkaoiiCurds: '🥣', uumkaoiiCheese: '🧀', whiteCurds: '🥣', whiteCheese: '🧀',
  }; // Used to give every prototype ingredient an inventory and picker icon.
  const EFFECT_ICONS = { strength: '💪', fortitude: '🛡️', vigor: '⚡', speed: '🏃', perception: '👁️', clarity: '🧠', combat: '⚔️', farming: '🌾', fishing: '🎣', foraging: '🌿', crafting: '🛠️', mining: '⛏️' }; // Used by food previews and the shared buff bar.

  let deps = null; // Used as the only bridge to inventory, saving, and the host game's UI refreshes.
  let selectedRecipeId = null; // Used to preserve the selected recipe while rerendering.
  let selectedSlots = {}; // Used to hold one item-quality choice per recipe slot.
  let qualityBuckets = {}; // Used to persist actual 1–5-star quantities without changing the game's stack inventory shape.
  let cookedDefinitions = {}; // Used to restore procedurally named food item definitions on reload.
  let activeFoodEffects = []; // Used as an independent timed effect source beside alchemy.
  let cookTimer = null; // Used to prevent duplicate cooks during the hearth animation.

  const data = () => window.HobunjiCookingData || { items: {}, recipes: [] }; // Used to keep this module inert if content fails to load.
  const canonicalKey = key => ITEM_ALIASES[key] || key; // Used whenever prototype ids cross into the game's inventory.
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]); // Used for all generated cooking markup.

  function recipeCategorySet() {
    const categories = new Set(); // Used to register only ingredients reachable by the 17 cooking recipes.
    data().recipes.forEach(recipe => recipe.slots.forEach(slot => slot.accepts.forEach(category => categories.add(category))));
    return categories;
  }

  function itemMetadataFor(key) {
    const original = Object.entries(ITEM_ALIASES).find(([, modern]) => modern === key)?.[0]; // Used to find prototype metadata for singular existing egg ids.
    return data().items[key] || (original ? data().items[original] : null) || null;
  }

  function defaultStarsFor(item) {
    return Math.max(1, Math.min(5, ((Number(item?.quality) || 1) - 1) * 2 + 2)); // Used to map prototype quality 1–3 onto the game's 2/4/5-star range.
  }

  function registerIngredientItems() {
    const accepted = recipeCategorySet(); // Used to identify ingredients consumed by current recipes while still registering future food categories.
    Object.values(data().items).forEach(item => {
      if (!item.categories?.some(category => accepted.has(category) || !NON_INGREDIENT_CATEGORIES.has(category))) return;
      const key = canonicalKey(item.id); // Used to avoid duplicate Uumkao'ii/Drenkirra egg stacks.
      const categories = [...new Set(item.categories)]; // Used by recipe-slot compatibility checks.
      const icon = CATEGORY_ICONS[categories[0]] || '🥕'; // Used in inventory and cooking UI when no bespoke art exists yet.
      if (!deps.ITEM_DEFS[key]) {
        deps.ITEM_DEFS[key] = {
          icon, label: item.name, cat: 'food', sellPrice: Math.max(1, Math.round(2 + defaultStarsFor(item) * 2)),
          tags: ['Ingredient', ...categories.map(category => data().categoryLabels[category] || category)],
          desc: 'Cooking ingredient. Its source will be added in a future content pass.',
        };
      }
      Object.assign(deps.ITEM_DEFS[key], {
        cookingCategories: categories,
        cookingPrimaryEffect: item.primaryEffect,
        cookingBaseBoost: Number(item.baseBoost) || 1,
        cookingProcessingTier: item.processingTier || 'raw',
        cookingDefaultStars: defaultStarsFor(item),
      });
      if (!deps.inventoryItems.some(entry => entry.key === key)) deps.inventoryItems.push({ key, icon, label: item.name.toUpperCase(), max: 99 });
    });

    Object.entries(deps.ITEM_DEFS).forEach(([key, definition]) => {
      if (!definition.tags?.some(tag => String(tag).toLowerCase() === 'fish')) return;
      definition.cookingCategories = [...new Set([...(definition.cookingCategories || []), 'fish'])];
      definition.cookingPrimaryEffect ||= 'fishing';
      definition.cookingBaseBoost ||= 1;
      definition.cookingProcessingTier ||= 'raw';
      definition.cookingDefaultStars ||= 3;
      if (!deps.inventoryItems.some(entry => entry.key === key)) deps.inventoryItems.push({ key, icon: definition.icon || '🐟', label: String(definition.label || key).toUpperCase(), max: 99 });
    });
  }

  function registerCookedDefinition(key, definition) {
    const recipeId = definition.recipeId || data().recipes.find(recipe => key.startsWith(`food_${recipe.id}_`))?.id; // Used to migrate reusable foods saved before recipe ids were persisted.
    const recipe = data().recipes.find(candidate => candidate.id === recipeId); // Used to restore recipe-owned ingredient categories.
    const normalized = {
      ...definition,
      ...(recipeId ? { recipeId } : {}),
      cookingCategories: definition.cookingCategories || recipe?.inventoryCategories || [],
    }; // Used to make noodles, mayonnaise, bread, and future bases reusable after reload.
    cookedDefinitions[key] = { ...normalized }; // Used to serialize the generated name, effects, and quality.
    deps.ITEM_DEFS[key] = { ...normalized, isCookedFood: true };
    if (!deps.inventoryItems.some(entry => entry.key === key)) deps.inventoryItems.push({ key, icon: definition.icon || '🍲', label: definition.label.toUpperCase(), max: 99 });
  }

  function reconcileQuality(key) {
    const count = Math.max(0, Number(deps.inventory[key]) || 0); // Used as the authoritative total stack size.
    const bucket = qualityBuckets[key] || (qualityBuckets[key] = {}); // Used to hold tracked quantities by star tier.
    let tracked = [1, 2, 3, 4, 5].reduce((sum, stars) => sum + Math.max(0, Number(bucket[stars]) || 0), 0); // Used to detect legacy/untracked inventory.
    if (tracked < count) {
      const fallback = Math.max(1, Math.min(5, Number(deps.ITEM_DEFS[key]?.cookingDefaultStars) || 3)); // Used to assign old stacks a reasonable quality.
      bucket[fallback] = (Number(bucket[fallback]) || 0) + count - tracked;
      tracked = count;
    }
    if (tracked > count) {
      let excess = tracked - count; // Used to trim phantom quality units after selling/consuming through older paths.
      for (const stars of [1, 2, 3, 4, 5]) {
        const remove = Math.min(excess, Number(bucket[stars]) || 0);
        bucket[stars] = (Number(bucket[stars]) || 0) - remove;
        excess -= remove;
        if (!excess) break;
      }
    }
    return bucket;
  }

  function recordItemQuality(key, stars, amount = 1) {
    if (!key || !(amount > 0)) return;
    const safeStars = Math.max(1, Math.min(5, Math.round(Number(stars) || 3))); // Used to keep quality bucket keys supported.
    const bucket = qualityBuckets[key] || (qualityBuckets[key] = {}); // Used to create the first quality record lazily.
    bucket[safeStars] = (Number(bucket[safeStars]) || 0) + Math.floor(amount);
  }

  function availableQualityEntries(key) {
    const bucket = reconcileQuality(key); // Used so pre-system items immediately appear in the picker.
    return [5, 4, 3, 2, 1].filter(stars => (bucket[stars] || 0) > 0).map(stars => ({ stars, count: bucket[stars] }));
  }

  function consumeQuality(key, stars, amount = 1) {
    const bucket = reconcileQuality(key); // Used to make consumption safe for migrated inventories.
    if ((bucket[stars] || 0) < amount) return false;
    bucket[stars] -= amount;
    deps.inventory[key] = Math.max(0, (deps.inventory[key] || 0) - amount);
    deps.clampInventoryStack(key);
    return true;
  }

  function ingredientCandidates(slot) {
    return Object.entries(deps.ITEM_DEFS).filter(([key, definition]) =>
      (deps.inventory[key] || 0) > 0 && definition.cookingCategories?.some(category => slot.accepts.includes(category))
    ).sort(([, a], [, b]) => String(a.label).localeCompare(String(b.label))); // Used to populate each category-constrained slot picker.
  }

  function selectedRecipe() {
    return data().recipes.find(recipe => recipe.id === selectedRecipeId) || data().recipes[0] || null;
  }

  function selectionIsValid(recipe = selectedRecipe()) {
    if (!recipe || !recipe.slots.every(slot => !slot.required || selectedSlots[slot.id])) return false;
    const required = {}; // Used to prevent one inventory unit from filling multiple recipe slots.
    recipe.slots.forEach(slot => {
      const selected = selectedSlots[slot.id];
      if (!selected) return;
      const id = `${selected.key}:${selected.stars}`;
      required[id] = (required[id] || 0) + 1;
    });
    return Object.entries(required).every(([id, amount]) => {
      const separator = id.lastIndexOf(':');
      const key = id.slice(0, separator), stars = Number(id.slice(separator + 1));
      return (reconcileQuality(key)[stars] || 0) >= amount;
    });
  }

  function effectTotals(recipe = selectedRecipe()) {
    const totals = {}; // Used to preview and persist the chosen ingredients' food buffs.
    if (!recipe) return totals;
    recipe.slots.forEach(slot => {
      const selected = selectedSlots[slot.id];
      const definition = selected ? deps.ITEM_DEFS[selected.key] : null;
      if (definition?.foodEffects && Object.keys(definition.foodEffects).length) {
        Object.entries(definition.foodEffects).forEach(([effect, amount]) => {
          totals[effect] = (totals[effect] || 0) + Math.max(1, Number(amount) || 1);
        });
        return;
      }
      if (!definition?.cookingPrimaryEffect) return;
      const tier = data().processingTiers[definition.cookingProcessingTier] || data().processingTiers.raw || { multiplier: 1 };
      const prototypeQuality = 1 + (selected.stars - 1) / 2; // Used to preserve the prototype's 1–3 quality effect curve atop 1–5 stars.
      const amount = Math.max(1, Math.ceil((definition.cookingBaseBoost || 1) * prototypeQuality * (tier.multiplier || 1)));
      totals[definition.cookingPrimaryEffect] = (totals[definition.cookingPrimaryEffect] || 0) + amount;
    });
    return totals;
  }

  function itemNameToken(key) {
    return data().itemNameTokenOverrides[key] || deps.ITEM_DEFS[key]?.label || key; // Used by recipe identity patterns.
  }

  function foodName(recipe, effects) {
    const identity = data().identityNameRules[recipe.id]; // Used to retain the prototype's ingredient-led dish names.
    let base = recipe.baseOutputName || recipe.name;
    if (identity) {
      base = identity.pattern.replace(/\{([^}]+)\}/g, (_, slotId) => {
        const selected = selectedSlots[slotId];
        return selected ? itemNameToken(selected.key) : slotId;
      });
    }
    const strongest = Object.entries(effects).sort((a, b) => b[1] - a[1])[0]; // Used to add a deterministic stat-flavor prefix.
    if (!strongest) return base;
    const variants = data().effectPrefixVariants[strongest[0]] || [];
    const signature = recipe.slots.map(slot => selectedSlots[slot.id]?.key || '').join('|'); // Used to choose a stable prefix for the same ingredient combination.
    const index = [...signature].reduce((sum, character) => sum + character.charCodeAt(0), 0) % Math.max(1, variants.length);
    return variants.length ? `${variants[index]} ${base}` : base;
  }

  function hash(value) {
    let result = 2166136261; // Used as a compact deterministic FNV-1a-style key for cooked item stacks.
    for (let index = 0; index < value.length; index++) result = Math.imul(result ^ value.charCodeAt(index), 16777619);
    return (result >>> 0).toString(36);
  }

  function outputQuality(recipe) {
    const selections = recipe.slots.map(slot => selectedSlots[slot.id]).filter(Boolean); // Used to average actual input quality.
    const average = selections.reduce((sum, selected) => sum + selected.stars, 0) / Math.max(1, selections.length);
    const craftingLift = Math.max(0, (window.SkillSystem?.effectiveLevel?.('crafting') || 0) / (window.SkillSystem?.MAX_LEVEL || 20) * 1.2); // Used to let Crafting improve food quality.
    const jitter = ((deps.random || Math.random)() - 0.5) * 0.8; // Used to keep cooking outcomes from being fully deterministic.
    return Math.max(1, Math.min(5, Math.round(average + craftingLift + jitter)));
  }

  function recipeOutputIcon(recipe) {
    const categories = recipe.inventoryCategories || []; // Used to visually distinguish reusable bases from finished meals.
    if (categories.includes('noodleBase')) return '🍜';
    if (categories.includes('mayonnaise')) return '🥣';
    if (categories.includes('bread')) return '🍞';
    return '🍲';
  }

  function cook() {
    const recipe = selectedRecipe();
    if (!selectionIsValid(recipe) || cookTimer) return;
    const selections = recipe.slots.map(slot => ({ slot, selected: selectedSlots[slot.id] })).filter(entry => entry.selected); // Used to revalidate selected stock while allowing optional recipe slots to remain empty.
    if (!selectionIsValid(recipe)) {
      deps.showToast('One of those ingredients is no longer available.', false);
      render();
      return;
    }
    const button = document.querySelector('[data-cook-now]'); // Used to show the prototype's short hearth cooking state.
    if (button) { button.disabled = true; button.textContent = '🔥 Cooking…'; }
    cookTimer = setTimeout(() => {
      const effects = effectTotals(recipe); // Used before selections are cleared.
      const stars = outputQuality(recipe); // Used as the persistent cooked-food quality.
      const signature = selections.map(({ slot, selected }) => `${slot.id}:${selected.key}:${selected.stars}`).join('|'); // Used to stack identical dishes only.
      const key = `food_${recipe.id}_${hash(signature + `|${stars}|${JSON.stringify(effects)}`)}`;
      const label = foodName(recipe, effects);
      const saved = [];
      selections.forEach(({ selected }) => {
        const saveChance = window.SkillSystem?.craftIngredientSaveChance?.() || 0; // Used for Crafting's independent per-ingredient save roll.
        if ((deps.random || Math.random)() < saveChance) saved.push(deps.ITEM_DEFS[selected.key]?.label || selected.key);
        else consumeQuality(selected.key, selected.stars, 1);
      });
      const effectText = Object.entries(effects).map(([effect, amount]) => `${data().effectLabels[effect] || effect} +${amount}`).join(', ');
      registerCookedDefinition(key, {
        icon: recipeOutputIcon(recipe), label, cat: 'food', sellPrice: Math.max(4, recipe.slots.length * 4 + stars * 3),
        tags: ['Cooked Food', ...recipe.outputTags, `${stars} Star`],
        desc: `${recipe.description} Eat it for ${effectText || 'a satisfying meal'}.`,
        recipeId: recipe.id,
        cookingCategories: [...(recipe.inventoryCategories || [])],
        foodEffects: effects, foodQuality: stars, cookingDefaultStars: stars,
      });
      deps.inventory[key] = Math.min(99, (deps.inventory[key] || 0) + 1);
      recordItemQuality(key, stars, 1);
      window.SkillSystem?.award?.('crafting', window.SkillSystem?.XP_GAINS?.cook || 8, recipe.name);
      selectedSlots = {};
      cookTimer = null;
      deps.refreshItemScroll();
      deps.buildInventoryGrid();
      deps.refreshActionBar();
      deps.saveMemberWorldData();
      deps.showToast(`🍲 ${window.SkillSystem?.starRatingText?.(stars) || '★'.repeat(stars)} ${label}${saved.length ? ` · saved ${saved.join(', ')}` : ''}`, true);
      render();
    }, 1800);
  }

  function eat(key) {
    const definition = deps.ITEM_DEFS[key];
    if (!definition?.isCookedFood || (deps.inventory[key] || 0) < 1) return { ok: false, message: 'Nothing edible is selected.' };
    const quality = availableQualityEntries(key)[0]?.stars || definition.foodQuality || 3; // Used to consume the best remaining serving first.
    consumeQuality(key, quality, 1);
    const now = performance.now() / 1000; // Used to refresh each matching food-effect timer.
    Object.entries(definition.foodEffects || {}).forEach(([effect, stacks]) => {
      const existing = activeFoodEffects.find(entry => entry.key === effect);
      if (existing) { existing.stacks += Math.max(1, Number(stacks) || 1); existing.expiresAt = now + FOOD_DURATION_S; }
      else activeFoodEffects.push({ key: effect, stacks: Math.max(1, Number(stacks) || 1), durationS: FOOD_DURATION_S, expiresAt: now + FOOD_DURATION_S });
    });
    window.EffectBuffBar?.refresh(true);
    window.SkillSystem?.render?.();
    deps.refreshItemScroll();
    deps.buildInventoryGrid();
    deps.refreshActionBar();
    deps.saveMemberWorldData();
    return { ok: true, message: `Ate ${definition.label}. Food effects last 5 minutes.` };
  }

  function foodBuffEntries() {
    const now = performance.now() / 1000; // Used to convert absolute timers for the shared buff renderer.
    return activeFoodEffects.map(effect => ({
      key: effect.key, label: data().effectLabels[effect.key] || effect.key, icon: EFFECT_ICONS[effect.key] || '🍲', kind: 'boon',
      sourceLabel: 'Food', stacks: effect.stacks, durationS: effect.durationS, remainingS: effect.expiresAt - now,
    }));
  }

  function getFoodEffectStacks(effectKey) {
    const now = performance.now() / 1000; // Used to ignore expired stacks even between update ticks.
    return activeFoodEffects.filter(effect => effect.key === effectKey && effect.expiresAt > now).reduce((sum, effect) => sum + effect.stacks, 0);
  }

  function getSpeedMultiplier() {
    return 1 + Math.min(0.5, getFoodEffectStacks('speed') * 0.02); // Used to convert Speed food stacks into movement speed.
  }

  function getStaminaRegenMultiplier() {
    return 1 + Math.min(1, getFoodEffectStacks('vigor') * 0.04); // Used to convert Vigor stacks into up to double stamina recovery.
  }

  function serialize() {
    const now = performance.now() / 1000; // Used to save portable remaining durations instead of page-relative timestamps.
    return {
      qualityBuckets: JSON.parse(JSON.stringify(qualityBuckets)),
      cookedDefinitions: JSON.parse(JSON.stringify(cookedDefinitions)),
      activeFoodEffects: activeFoodEffects.map(effect => ({ key: effect.key, stacks: effect.stacks, durationS: effect.durationS, remainingS: effect.expiresAt - now })).filter(effect => effect.remainingS > 0),
    };
  }

  function restore(saved = {}) {
    qualityBuckets = saved.qualityBuckets && typeof saved.qualityBuckets === 'object' ? JSON.parse(JSON.stringify(saved.qualityBuckets)) : {};
    cookedDefinitions = {};
    Object.entries(saved.cookedDefinitions || {}).forEach(([key, definition]) => registerCookedDefinition(key, definition));
    const now = performance.now() / 1000; // Used to rebuild absolute effect expiry times for this page session.
    activeFoodEffects = (saved.activeFoodEffects || []).filter(effect => effect.remainingS > 0).map(effect => ({ key: effect.key, stacks: Math.max(1, Number(effect.stacks) || 1), durationS: Number(effect.durationS) || FOOD_DURATION_S, expiresAt: now + effect.remainingS }));
    Object.keys(deps.inventory).forEach(reconcileQuality);
    window.EffectBuffBar?.refresh(true);
    window.SkillSystem?.render?.();
  }

  function update() {
    const now = performance.now() / 1000; // Used to prune expired food effects during the ordinary game loop.
    const before = activeFoodEffects.length;
    activeFoodEffects = activeFoodEffects.filter(effect => effect.expiresAt > now);
    if (before !== activeFoodEffects.length) window.SkillSystem?.render?.();
    window.EffectBuffBar?.refresh(before !== activeFoodEffects.length);
  }

  function ensureUi() {
    if (document.getElementById('hobunjiCookingLayer')) return;
    const layer = document.createElement('div'); // Used as a self-owned modal instead of adding cooking state to game.js.
    layer.id = 'hobunjiCookingLayer';
    layer.className = 'hobunji-cooking-layer';
    layer.setAttribute('aria-hidden', 'true');
    layer.innerHTML = `<section class="hobunji-cooking-panel" role="dialog" aria-modal="true" aria-labelledby="hobunjiCookingTitle">
      <header><div><span class="cooking-kicker">HEARTH COOKING</span><h2 id="hobunjiCookingTitle">Cook a meal</h2></div><button type="button" data-cooking-close aria-label="Close cooking">×</button></header>
      <div class="cooking-layout"><aside><input data-recipe-search type="search" placeholder="Search recipes…" aria-label="Search recipes"><div data-recipe-list class="cooking-recipe-list"></div></aside><main data-recipe-detail></main></div>
      <details class="cooking-diagnostics"><summary>Cooking diagnostics</summary><pre data-cooking-debug></pre></details>
    </section>`;
    document.body.appendChild(layer);
    layer.querySelector('[data-cooking-close]').addEventListener('click', close);
    layer.addEventListener('mousedown', event => { if (event.target === layer) close(); });
    layer.querySelector('[data-recipe-search]').addEventListener('input', renderRecipeList);
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !isOpen()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
    }, true); // Used to close cooking before the host game's Escape handler can open its ordinary menu.
  }

  function renderRecipeList() {
    const list = document.querySelector('[data-recipe-list]');
    if (!list) return;
    const query = document.querySelector('[data-recipe-search]')?.value.trim().toLowerCase() || ''; // Used to filter the 17 prototype recipes.
    list.innerHTML = data().recipes.filter(recipe => !query || `${recipe.name} ${recipe.description}`.toLowerCase().includes(query)).map(recipe => {
      const ready = recipe.slots.every(slot => !slot.required || ingredientCandidates(slot).length); // Used to show whether any valid ingredient combination exists.
      return `<button type="button" class="cooking-recipe-card${recipe.id === selectedRecipeId ? ' selected' : ''}" data-recipe="${esc(recipe.id)}"><span>🍲</span><div><strong>${esc(recipe.name)}</strong><small>${recipe.slots.length} ingredients · ${ready ? 'available' : 'missing items'}</small></div></button>`;
    }).join('') || '<p class="cooking-empty">No recipes match.</p>';
    list.querySelectorAll('[data-recipe]').forEach(button => button.addEventListener('click', () => { selectedRecipeId = button.dataset.recipe; selectedSlots = {}; render(); }));
  }

  function renderDetail() {
    const root = document.querySelector('[data-recipe-detail]');
    const recipe = selectedRecipe();
    if (!root || !recipe) return;
    const slots = recipe.slots.map(slot => {
      const selected = selectedSlots[slot.id];
      const candidates = ingredientCandidates(slot);
      return `<section class="cooking-slot"><div class="cooking-slot-heading"><div><strong>${esc(slot.label)}</strong><small>${slot.accepts.map(category => data().categoryLabels[category] || category).join(' · ')}</small></div>${selected ? `<button type="button" data-clear-slot="${esc(slot.id)}">Clear</button>` : ''}</div>
        ${selected ? `<div class="cooking-picked"><span>${esc(deps.ITEM_DEFS[selected.key]?.icon || '🥕')}</span><strong>${esc(deps.ITEM_DEFS[selected.key]?.label || selected.key)}</strong><em>${'★'.repeat(selected.stars)}${'☆'.repeat(5 - selected.stars)}</em></div>` : `<div class="cooking-picker">${candidates.flatMap(([key, definition]) => availableQualityEntries(key).map(entry => `<button type="button" data-pick-slot="${esc(slot.id)}" data-pick-key="${esc(key)}" data-pick-stars="${entry.stars}"><span>${esc(definition.icon || '🥕')}</span><strong>${esc(definition.label)}</strong><em>${'★'.repeat(entry.stars)}${'☆'.repeat(5 - entry.stars)} ×${entry.count}</em></button>`)).join('') || '<p class="cooking-empty">No matching ingredient in your bag yet.</p>'}</div>`}
      </section>`;
    }).join('');
    const effects = effectTotals(recipe);
    const effectMarkup = Object.entries(effects).map(([effect, amount]) => `<span>${EFFECT_ICONS[effect] || '✦'} ${esc(data().effectLabels[effect] || effect)} +${amount}</span>`).join('') || '<span>No effects until ingredients are selected.</span>';
    root.innerHTML = `<div class="cooking-recipe-head"><h3>${esc(recipe.name)}</h3><p>${esc(recipe.description)}</p></div>${slots}<div class="cooking-preview"><strong>Meal effects</strong><div>${effectMarkup}</div></div><div class="cooking-footer"><button type="button" data-auto-fill>Auto-fill best</button><button type="button" class="cooking-primary" data-cook-now ${selectionIsValid(recipe) ? '' : 'disabled'}>🔥 Cook</button></div>`;
    root.querySelectorAll('[data-pick-slot]').forEach(button => button.addEventListener('click', () => { selectedSlots[button.dataset.pickSlot] = { key: button.dataset.pickKey, stars: Number(button.dataset.pickStars) }; renderDetail(); renderDebug(); }));
    root.querySelectorAll('[data-clear-slot]').forEach(button => button.addEventListener('click', () => { delete selectedSlots[button.dataset.clearSlot]; renderDetail(); renderDebug(); }));
    root.querySelector('[data-auto-fill]')?.addEventListener('click', () => { recipe.slots.forEach(slot => { const first = ingredientCandidates(slot).flatMap(([key]) => availableQualityEntries(key).map(entry => ({ key, stars: entry.stars })))[0]; if (first) selectedSlots[slot.id] = first; }); renderDetail(); renderDebug(); });
    root.querySelector('[data-cook-now]')?.addEventListener('click', cook);
  }

  function renderDebug() {
    const output = document.querySelector('[data-cooking-debug]');
    if (!output) return;
    const tracked = Object.values(qualityBuckets).reduce((sum, bucket) => sum + Object.values(bucket).reduce((inner, count) => inner + (Number(count) || 0), 0), 0); // Used for mobile-visible state verification.
    output.textContent = `Station: ${isOpen() ? 'hearth open' : 'closed'}\nRecipes: ${data().recipes.length}\nRegistered ingredients: ${Object.keys(deps.ITEM_DEFS).filter(key => deps.ITEM_DEFS[key].cookingCategories).length}\nTracked quality units: ${tracked}\nCooked definitions: ${Object.keys(cookedDefinitions).length}\nActive food effects: ${activeFoodEffects.map(effect => `${effect.key}+${effect.stacks}`).join(', ') || 'none'}`;
  }

  function render() {
    if (!selectedRecipeId) selectedRecipeId = data().recipes[0]?.id || null;
    renderRecipeList();
    renderDetail();
    renderDebug();
  }

  function openAtHearth() {
    ensureUi();
    const layer = document.getElementById('hobunjiCookingLayer');
    layer.classList.add('open');
    layer.setAttribute('aria-hidden', 'false');
    deps.setInteractionBlocked?.(true);
    render();
    layer.querySelector('[data-recipe-search]')?.focus();
    return { ok: true, message: 'Opened the hearth.' };
  }

  function close() {
    const layer = document.getElementById('hobunjiCookingLayer');
    if (!layer?.classList.contains('open')) return;
    layer.classList.remove('open');
    layer.setAttribute('aria-hidden', 'true');
    deps.setInteractionBlocked?.(false);
  }

  function isOpen() {
    return document.getElementById('hobunjiCookingLayer')?.classList.contains('open') || false;
  }

  function init(injectedDeps = {}) {
    deps = injectedDeps;
    registerIngredientItems();
    ensureUi();
    window.EffectBuffBar?.registerProvider('food', foodBuffEntries);
  }

  window.CookingSystem = {
    init, restore, serialize, update, openAtHearth, close, isOpen, eat, recordItemQuality,
    getFoodEffectStacks, getSpeedMultiplier, getStaminaRegenMultiplier, registerIngredientItems, availableQualityEntries,
  };
})();
