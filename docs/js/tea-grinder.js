// Banubu's Tea Grinder: alchemy-style three-reagent selection that can only produce cooking buff Tea Blends.
(() => {
  'use strict';

  const global = window; // Used as the shared browser export surface.
  const STATION_ITEM_KEY = 'teaGrinderFurniture'; // Used by Banubu's quest reward and the normal processing-furniture placement flow.
  const BLEND_CATEGORY = 'teaBlend'; // Used by Nine Leaf Tea's three required cooking slots.
  const BLEND_STACKS = 3; // Used so one blend is canonically "Concentrated" in the shared CookingSystem strength vocabulary.
  const MAX_REAGENTS = 3; // Used to mirror the Alchemy Table's exact three-reagent rule.

  const STAT_TO_COOKING_EFFECT = Object.freeze({ // Used to translate beneficial alchemy reactions into the existing cooking-buff vocabulary.
    outgoingDamage: 'strength',
    footingDamage: 'strength',
    maxFooting: 'fortitude',
    incomingDamageAffliction: 'fortitude',
    healthRegen: 'fortitude',
    attackSpeed: 'speed',
    movementSpeed: 'speed',
    maxStamina: 'vigor',
    staminaRegen: 'vigor',
    staminaSpend: 'vigor',
    perception: 'perception',
  });

  let deps = null; // Injected by game.js; used for real inventory/save/UI integration.
  let selectedReagents = []; // Current Tea Grinder selection; used only while authoring one blend.
  let targetedRecipeId = null; // Optional alchemy reaction target used to reuse Alchemy's targeting probability.
  let openState = false; // Used to keep the modal/input gate idempotent.
  let lastBlend = null; // Mobile-visible debug record for the most recent successful blend.
  const outcomeCache = new Map(); // Sorted three-reagent signature -> filtered Tea Blend outcomes; used to avoid repeated Alchemy enumeration during UI renders.
  const completionCache = new Map(); // Sorted partial-selection signature -> whether any Tea Blend completion exists.
  let blendEffectWitnessCache = null; // Static reagent/recipe catalogs make the complete effect witness list safe to compute once per page load.

  function alchemy() { return global.AlchemySystem || null; } // Used to share the canonical trait enumerator instead of duplicating reaction math.

  function cookingEffectForRecipe(recipe) {
    if (!recipe || recipe.application !== 'buff' || recipe.useMode !== 'drink') return null; // Healing, cures, flasks, livestock effects and narcotics are intentionally impossible as tea.
    return STAT_TO_COOKING_EFFECT[recipe.stat] || STAT_TO_COOKING_EFFECT[recipe.secondaryStat] || null; // Unmapped beneficial oddities (e.g. favor gain) stay unavailable to Tea Blends.
  }

  function enumerateBlendOutcomes(reagentKeys) {
    const keys = [...(reagentKeys || [])];
    const signature = keys.length === MAX_REAGENTS ? [...keys].sort().join('|') : null; // Used as an order-independent cache key because the same ingredient set has the same Alchemy reactions.
    if (signature && outcomeCache.has(signature)) return outcomeCache.get(signature);
    const outcomes = alchemy()?.enumerateRecipes?.(keys) || []; // Used as the exact same Humour/Drive/Magnetism source-assignment search as the Alchemy Table.
    const filtered = outcomes.map(outcome => {
      const cookingEffect = cookingEffectForRecipe(outcome.recipe); // Used to filter the alchemy result set down to food buffs only.
      return cookingEffect ? { ...outcome, cookingEffect } : null;
    }).filter(Boolean);
    if (signature) outcomeCache.set(signature, filtered);
    return filtered;
  }

  function canCompleteSelection(reagentKeys) {
    const keys = [...(reagentKeys || [])]; // Used to keep caller selection immutable during compatibility probing.
    const defs = alchemy()?.REAGENT_DEFS || {};
    if (keys.length > MAX_REAGENTS || new Set(keys).size !== keys.length || keys.some(key => !defs[key])) return false;
    const signature = [...keys].sort().join('|'); // Used to reuse the same completion proof while a Tea Grinder selection is unchanged.
    if (completionCache.has(signature)) return completionCache.get(signature);
    let possible = false;
    if (keys.length === MAX_REAGENTS) possible = enumerateBlendOutcomes(keys).length > 0;
    else {
      const remaining = Object.keys(defs).filter(key => !keys.includes(key)); // Used to prove a partial selection has at least one buff-producing completion.
      if (keys.length === 2) possible = remaining.some(key => enumerateBlendOutcomes([...keys, key]).length > 0);
      else if (keys.length === 1) {
        outer: for (let i = 0; i < remaining.length - 1; i++) {
          for (let j = i + 1; j < remaining.length; j++) {
            if (enumerateBlendOutcomes([...keys, remaining[i], remaining[j]]).length) { possible = true; break outer; }
          }
        }
      } else possible = true;
    }
    completionCache.set(signature, possible);
    return possible;
  }

  function canAddReagent(selected, candidate) {
    return canCompleteSelection([...(selected || []), candidate]); // Used by the UI to gray ingredients that cannot end in any Tea Blend.
  }

  function allBlendEffects() {
    if (blendEffectWitnessCache) return blendEffectWitnessCache.map(entry => ({ ...entry, reagentKeys: [...entry.reagentKeys] })); // Return copies so quest diagnostics cannot mutate the cache.
    const defs = alchemy()?.REAGENT_DEFS || {};
    const keys = Object.keys(defs);
    const witnesses = new Map(); // Used by Banubu Quest 2 to prove every requested tea buff has a concrete three-reagent solution.
    for (let a = 0; a < keys.length - 2; a++) {
      for (let b = a + 1; b < keys.length - 1; b++) {
        for (let c = b + 1; c < keys.length; c++) {
          const reagentKeys = [keys[a], keys[b], keys[c]];
          for (const outcome of enumerateBlendOutcomes(reagentKeys)) {
            if (!witnesses.has(outcome.cookingEffect)) {
              witnesses.set(outcome.cookingEffect, {
                effect: outcome.cookingEffect,
                recipeId: outcome.recipeId,
                reagentKeys: [...reagentKeys],
              });
            }
          }
        }
      }
    }
    blendEffectWitnessCache = [...witnesses.values()].map(entry => ({ ...entry, reagentKeys: [...entry.reagentKeys] }));
    return blendEffectWitnessCache.map(entry => ({ ...entry, reagentKeys: [...entry.reagentKeys] }));
  }

  function blendItemKey(effect) {
    return `teaBlend_${String(effect || '').replace(/[^A-Za-z0-9]/g, '')}`; // Stable stack identity lets different ingredient trios producing the same buff share one inventory stack.
  }

  function registerStationItemDef() {
    if (!deps?.ITEM_DEFS) return null;
    if (!deps.ITEM_DEFS[STATION_ITEM_KEY]) {
      deps.ITEM_DEFS[STATION_ITEM_KEY] = {
        icon: '🍵',
        label: 'Tea Grinder',
        cat: 'furniture',
        sellPrice: 0,
        tags: ['Furniture', 'Processor', 'Quest', 'Banubu'],
        desc: 'Banubu’s grinder for combining exactly three alchemical herbs into a Tea Blend. Only beneficial food-buff reactions survive the grinding process.',
      }; // Used by inventory, furniture placement, and Banubu's one-time station gift.
    }
    return deps.ITEM_DEFS[STATION_ITEM_KEY];
  }

  function ensureBlendItemDef(effect) {
    const key = blendItemKey(effect); // Used as the output stack key and Nine Leaf Tea ingredient identity.
    if (!deps?.ITEM_DEFS) return key;
    if (!deps.ITEM_DEFS[key]) {
      const label = global.CookingSystem?.effectLabel?.(effect) || effect;
      const strength = global.CookingSystem?.effectStrengthLabel?.(BLEND_STACKS) || 'Concentrated';
      deps.ITEM_DEFS[key] = {
        icon: '🍃',
        label: `${label} Tea Blend`,
        cat: 'processed',
        sellPrice: 0,
        tags: ['Processed', 'Tea Blend', 'Banubu'],
        desc: `A ${strength.toLowerCase()} three-herb blend carrying ${label}. Three Tea Blends and White Milk make Nine Leaf Tea.`,
        cookingCategories: [BLEND_CATEGORY],
        foodEffects: { [effect]: BLEND_STACKS },
        cookingDefaultStars: 3,
      }; // Used by CookingSystem so the blend contributes its exact stored buff amount to Nine Leaf Tea.
    }
    return key;
  }

  function registerItemDefs() {
    registerStationItemDef();
    for (const witness of allBlendEffects()) ensureBlendItemDef(witness.effect); // Used so inventory/cooking UIs recognize every currently possible Tea Blend before one is crafted.
  }

  function refreshInventory() {
    deps?.refreshItemScroll?.();
    deps?.buildInventoryGrid?.();
    deps?.refreshActionBar?.();
    deps?.saveMemberWorldData?.();
  }

  function grantStation() {
    if (!deps?.inventory) return { ok: false, message: 'Tea Grinder inventory is not initialized.' };
    registerStationItemDef();
    deps.inventory[STATION_ITEM_KEY] = Math.min(99, (deps.inventory[STATION_ITEM_KEY] || 0) + 1); // Used by Quest 1 to give one ordinary placeable station item.
    deps.clampInventoryStack?.(STATION_ITEM_KEY);
    refreshInventory();
    return { ok: true, itemKey: STATION_ITEM_KEY, message: '🍵 Tea Grinder obtained.' };
  }

  function toggleReagent(key) {
    const index = selectedReagents.indexOf(key);
    if (index >= 0) selectedReagents.splice(index, 1);
    else if (selectedReagents.length < MAX_REAGENTS && canAddReagent(selectedReagents, key)) selectedReagents.push(key);
    if (targetedRecipeId && !enumerateBlendOutcomes(selectedReagents).some(outcome => outcome.recipeId === targetedRecipeId)) targetedRecipeId = null;
    render();
  }

  function grind() {
    if (!deps?.inventory) return { ok: false, message: 'Tea Grinder inventory is unavailable.' };
    if (selectedReagents.length !== MAX_REAGENTS) return { ok: false, message: 'Select exactly three herbs.' };
    if (selectedReagents.some(key => (deps.inventory[key] || 0) < 1)) return { ok: false, message: 'One of those herbs is no longer in your bag.' };
    const outcomes = enumerateBlendOutcomes(selectedReagents);
    if (!outcomes.length) return { ok: false, message: 'Those three herbs cannot make a beneficial Tea Blend.' };
    const level = Math.max(0, Math.min(20, Number(global.SkillSystem?.level?.('alchemy')) || 0)); // Used to give Tea Grinder targeting the same skill curve as the Alchemy Table.
    const chosen = alchemy()?.chooseOutcome?.(outcomes, targetedRecipeId, deps.random, level) || outcomes[0];
    if (!chosen?.cookingEffect) return { ok: false, message: 'No Tea Blend reaction survived the grind.' };
    const discovered = alchemy()?.discoverRecipe?.(chosen.recipeId, 'ground Tea Blend') || false; // Tea grinding reveals the same underlying trait reaction knowledge as brewing, while still producing food instead of a potion.
    const consumed = [...selectedReagents];
    consumed.forEach(key => {
      deps.inventory[key] = Math.max(0, (deps.inventory[key] || 0) - 1);
      deps.clampInventoryStack?.(key);
    });
    const itemKey = ensureBlendItemDef(chosen.cookingEffect);
    deps.inventory[itemKey] = Math.min(99, (deps.inventory[itemKey] || 0) + 1);
    global.CookingSystem?.recordItemQuality?.(itemKey, 3, 1);
    lastBlend = {
      reagentKeys: consumed,
      recipeId: chosen.recipeId,
      effect: chosen.cookingEffect,
      stacks: BLEND_STACKS,
      itemKey,
      targetedRecipeId,
    }; // Used by mobile diagnostics to prove the selected trio, alchemy reaction, and resulting cooking buff.
    selectedReagents = [];
    targetedRecipeId = null;
    refreshInventory();
    return {
      ok: true,
      itemKey,
      effect: chosen.cookingEffect,
      message: `🍃 Ground ${deps.ITEM_DEFS[itemKey]?.label || 'Tea Blend'} — ${global.CookingSystem?.formatEffectStrength?.(chosen.cookingEffect, BLEND_STACKS) || '+' + BLEND_STACKS}${discovered ? ' · new reaction discovered!' : ''}.`,
    };
  }

  function ensureUi() {
    if (typeof document === 'undefined' || document.getElementById('teaGrinderLayer')) return;
    const style = document.createElement('style');
    style.textContent = `
      #teaGrinderLayer{position:fixed;inset:0;z-index:2300;background:rgba(10,17,13,.92);display:none;align-items:center;justify-content:center;padding:clamp(12px,3vw,30px);font-family:inherit;color:#f4f1df}
      #teaGrinderLayer.open{display:flex}
      .tea-grinder-panel{width:min(900px,96vw);max-height:92vh;overflow:auto;background:#17251d;border:2px solid #759269;border-radius:16px;padding:18px;box-shadow:0 14px 42px rgba(0,0,0,.55)}
      .tea-grinder-head{display:flex;justify-content:space-between;gap:12px;align-items:center}.tea-grinder-head h2{margin:0}.tea-grinder-head button{font-size:1.3rem}
      .tea-grinder-note{opacity:.8;margin:.4rem 0 1rem}.tea-grinder-grid{display:grid;grid-template-columns:minmax(240px,1fr) minmax(240px,1fr);gap:14px}
      .tea-grinder-list,.tea-grinder-outcomes{display:flex;flex-direction:column;gap:7px}.tea-grinder-row,.tea-grinder-target{display:flex;align-items:center;gap:8px;padding:8px;border:1px solid rgba(255,255,255,.15);border-radius:9px;background:rgba(255,255,255,.04)}
      .tea-grinder-row.incompatible{opacity:.35}.tea-grinder-row.selected,.tea-grinder-target.selected{outline:2px solid #a7c87d}.tea-grinder-row button,.tea-grinder-target{margin-left:auto}
      .tea-grinder-strip{display:flex;gap:7px;flex-wrap:wrap;margin:.7rem 0}.tea-grinder-chip{padding:5px 8px;border-radius:999px;background:#314936}
      .tea-grinder-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:14px}.tea-grinder-actions button{padding:10px 14px}
      .tea-grinder-debug{white-space:pre-wrap;font-size:.75rem;opacity:.72;margin-top:12px}
      @media(max-width:700px){.tea-grinder-grid{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
    const layer = document.createElement('div');
    layer.id = 'teaGrinderLayer';
    layer.setAttribute('aria-hidden', 'true');
    layer.innerHTML = `<section class="tea-grinder-panel"><div class="tea-grinder-head"><div><small>BANUBU'S PROCESSOR</small><h2>🍵 Tea Grinder</h2></div><button type="button" data-tea-close aria-label="Close">×</button></div><p class="tea-grinder-note">Choose exactly three herbs. The same trait-source math as Alchemy applies, but only beneficial reactions that translate into food buffs can become Tea Blends.</p><div class="tea-grinder-strip" data-tea-selected></div><div class="tea-grinder-grid"><div><h3>Herbs</h3><div class="tea-grinder-list" data-tea-reagents></div></div><div><h3>Possible Tea Blends</h3><div class="tea-grinder-outcomes" data-tea-outcomes></div></div></div><div class="tea-grinder-actions"><button type="button" data-tea-grind>Grind Tea Blend</button></div><pre class="tea-grinder-debug" data-tea-debug></pre></section>`;
    document.body.appendChild(layer);
    layer.querySelector('[data-tea-close]')?.addEventListener('click', close);
    layer.querySelector('[data-tea-grind]')?.addEventListener('click', () => {
      const result = grind();
      deps?.showToast?.(result.message, result.ok !== false);
      render();
    });
  }

  function render() {
    ensureUi();
    const layer = document.getElementById('teaGrinderLayer');
    if (!layer) return;
    const defs = alchemy()?.REAGENT_DEFS || {};
    selectedReagents = selectedReagents.filter(key => (deps?.inventory?.[key] || 0) > 0);
    const reagentHost = layer.querySelector('[data-tea-reagents]');
    const selectedHost = layer.querySelector('[data-tea-selected]');
    const outcomesHost = layer.querySelector('[data-tea-outcomes]');
    const grindButton = layer.querySelector('[data-tea-grind]');
    const held = Object.keys(defs).filter(key => (deps?.inventory?.[key] || 0) > 0);
    if (reagentHost) {
      reagentHost.innerHTML = held.map(key => {
        const definition = defs[key];
        const selected = selectedReagents.includes(key);
        const compatible = selected || selectedReagents.length >= MAX_REAGENTS ? selected : canAddReagent(selectedReagents, key);
        return `<div class="tea-grinder-row${selected ? ' selected' : ''}${compatible ? '' : ' incompatible'}" data-tea-row="${key}"><span>${definition.icon}</span><span><strong>${definition.label}</strong><br><small>${definition.traits.humour} · ${definition.traits.drive} · ${definition.traits.magnetism} · ×${deps.inventory[key] || 0}</small></span><button type="button" ${compatible ? '' : 'disabled'}>${selected ? 'Remove' : 'Select'}</button></div>`;
      }).join('') || '<p>No alchemical herbs in your bag.</p>';
      reagentHost.querySelectorAll('[data-tea-row] button').forEach(button => button.addEventListener('click', () => toggleReagent(button.parentElement.dataset.teaRow)));
    }
    if (selectedHost) selectedHost.innerHTML = selectedReagents.length
      ? selectedReagents.map(key => `<span class="tea-grinder-chip">${defs[key]?.icon || '🌿'} ${defs[key]?.label || key}</span>`).join('')
      : '<span>Select three herbs.</span>';
    const outcomes = enumerateBlendOutcomes(selectedReagents);
    if (outcomesHost) {
      outcomesHost.innerHTML = selectedReagents.length < MAX_REAGENTS
        ? '<p>Complete the trio to see its possible beneficial blends.</p>'
        : outcomes.length
          ? outcomes.map(outcome => {
              const known = alchemy()?.isRecipeKnown?.(outcome.recipeId) === true; // Same discovery gate as Alchemy Table targeting.
              if (!known) return '<div class="tea-grinder-target"><span>❓ Unknown beneficial blend</span><small>Grind randomly to discover this reaction.</small></div>';
              const label = global.CookingSystem?.effectLabel?.(outcome.cookingEffect) || outcome.cookingEffect;
              const chance = Math.round((alchemy()?.targetingProbability?.(Math.max(0, Math.min(20, Number(global.SkillSystem?.level?.('alchemy')) || 0)), outcomes, outcome.recipeId) || 0) * 100);
              return `<button type="button" class="tea-grinder-target${targetedRecipeId === outcome.recipeId ? ' selected' : ''}" data-tea-target="${outcome.recipeId}"><span>🍃 ${label} Tea Blend</span><small>${outcome.recipe.label} · target ${chance}%</small></button>`;
            }).join('')
          : '<p>These herbs have no beneficial Tea Blend reaction.</p>';
      outcomesHost.querySelectorAll('[data-tea-target]').forEach(button => button.addEventListener('click', () => {
        targetedRecipeId = targetedRecipeId === button.dataset.teaTarget ? null : button.dataset.teaTarget;
        render();
      }));
    }
    if (grindButton) grindButton.disabled = !outcomes.length;
    const debug = layer.querySelector('[data-tea-debug]');
    if (debug) debug.textContent = diagnosticsText();
  }

  function open() {
    if (!deps) return { ok: false, message: 'Tea Grinder is not initialized.' };
    ensureUi();
    registerItemDefs();
    openState = true;
    selectedReagents = [];
    targetedRecipeId = null;
    const layer = document.getElementById('teaGrinderLayer');
    layer?.classList.add('open');
    layer?.setAttribute('aria-hidden', 'false');
    deps.setInteractionBlocked?.(true);
    render();
    return { ok: true, message: 'Opened the Tea Grinder.' };
  }

  function close() {
    openState = false;
    selectedReagents = [];
    targetedRecipeId = null;
    const layer = document.getElementById('teaGrinderLayer');
    layer?.classList.remove('open');
    layer?.setAttribute('aria-hidden', 'true');
    deps?.setInteractionBlocked?.(false);
  }

  function diagnosticsText() {
    return [
      'Tea Grinder:',
      `  open=${openState}`,
      `  selected=${selectedReagents.join(', ') || 'none'}`,
      `  outcomes=${enumerateBlendOutcomes(selectedReagents).map(outcome => outcome.cookingEffect).join(', ') || 'none'}`,
      `  target=${targetedRecipeId || 'none'}`,
      `  possibleEffects=${allBlendEffects().map(entry => entry.effect).join(', ') || 'none'}`,
      `  lastBlend=${lastBlend ? JSON.stringify(lastBlend) : 'none'}`,
    ].join('\n');
  }

  function init(injectedDeps = {}) {
    deps = injectedDeps; // Used by every inventory, save, toast, and modal-input operation in this module.
    registerItemDefs();
    ensureUi();
  }

  global.TeaGrinder = {
    STATION_ITEM_KEY,
    BLEND_CATEGORY,
    BLEND_STACKS,
    STAT_TO_COOKING_EFFECT,
    init,
    open,
    close,
    grind,
    grantStation,
    registerItemDefs,
    blendItemKey,
    cookingEffectForRecipe,
    enumerateBlendOutcomes,
    canCompleteSelection,
    canAddReagent,
    allBlendEffects,
    diagnosticsText,
    get selectedReagents() { return [...selectedReagents]; },
  };
})();
