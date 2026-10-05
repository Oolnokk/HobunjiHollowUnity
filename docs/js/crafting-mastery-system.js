(() => {
  'use strict';

  if (Number(window.CraftingMasterySystem?.version) >= 2) return;

  // World-scoped counterpart to the character-scoped PerkSystem. The APIs are
  // intentionally similar where that helps consumers: gameplay systems ask for
  // rank(perkId), while this module owns node definitions, Mote costs, tier /
  // prerequisite gating, persistence, and the Crafting-tab presentation.
  const VERSION = 2; // Loader/debug version for the world crafting progression runtime.
  const MASTERY_FIELD = 'craftingMastery'; // Stored directly on the active world entry in hobunjiSaveMeta.
  const TIER_THRESHOLDS = Object.freeze([8, 20]); // Tier 2/3 unlock after this many Motes have been spent elsewhere in the tree.
  const nodesById = new Map(); // Extensible registry used by future weaving/furniture/smithing/etc. perk modules.

  let craftingDeps = null; // Captured CraftingPanel dependency bag used by the two initial generic effects and panel refreshes.
  let worldIdGetter = null; // Active-world getter; keeps Motes/ranks shared by every character in that world.
  let lastError = null; // Latest persistence/UI failure exposed through mobile-friendly diagnostics.
  const furnitureBaseCosts = new WeakMap(); // Authored furniture costs restored before world-specific modifiers are reapplied.
  const metalBaseRecipes = new Map(); // Authored metal recipes restored before world-specific modifiers are reapplied.

  const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

  function normalizeRequires(requires) {
    return (Array.isArray(requires) ? requires : []).map(entry => typeof entry === 'string'
      ? { id: entry, rank: 1 }
      : { id: String(entry?.id || ''), rank: Math.max(1, Math.floor(finite(entry?.rank, 1))) })
      .filter(entry => entry.id); // Future specific nodes can demand exact earlier ranks without hardcoding graph logic.
  }

  function normalizeNode(definition) {
    if (!definition?.id || !definition?.name) return null;
    return Object.freeze({
      id: String(definition.id),
      name: String(definition.name),
      tier: Math.max(1, Math.floor(finite(definition.tier, 1))),
      maxRank: Math.max(1, Math.floor(finite(definition.maxRank, 1))),
      cost: definition.cost ?? 1,
      desc: typeof definition.desc === 'function' ? definition.desc : (() => String(definition.desc || '')),
      requires: Object.freeze(normalizeRequires(definition.requires)),
      category: String(definition.category || 'general'),
    });
  }

  function registerNode(definition) {
    const node = normalizeNode(definition); // Canonical immutable node record shared by persistence, UI, and consumers.
    if (!node) return false;
    nodesById.set(node.id, node);
    renderPanel();
    return true;
  }

  function registerNodes(definitions) {
    let count = 0;
    for (const definition of definitions || []) if (registerNode(definition)) count++;
    return count;
  }

  // Only two broad examples for now. Later systems can register narrower nodes
  // without editing this file; those systems should read their effect through
  // CraftingMasterySystem.rank(id), mirroring PerkSystem.rank(skill,id).
  registerNodes([
    {
      id: 'efficientJoinery', name: 'Efficient Joinery', category: 'general', tier: 1, maxRank: 3, cost: [5, 7, 9],
      desc: rank => `Furniture recipes use ${rank} less Wood (minimum 1).`,
    },
    {
      id: 'temperedCrucible', name: 'Tempered Crucible', category: 'general', tier: 1, maxRank: 3, cost: [6, 8, 10],
      desc: rank => `Metal-bar recipes use ${rank} less of their largest ore ingredient (minimum 1).`,
    },
  ]);

  function node(perkId) { return nodesById.get(String(perkId || '')) || null; }
  function tree() { return [...nodesById.values()].sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name)); }

  function costForRank(definition, oneBasedRank) {
    const rankIndex = Math.max(0, Math.floor(finite(oneBasedRank, 1)) - 1); // Cost arrays are authored rank 1 first.
    const authored = typeof definition?.cost === 'function'
      ? definition.cost(rankIndex + 1)
      : Array.isArray(definition?.cost)
        ? definition.cost[Math.min(rankIndex, definition.cost.length - 1)]
        : definition?.cost;
    return Math.max(1, Math.floor(finite(authored, 1)));
  }

  function currentWorldId() {
    const value = worldIdGetter?.() ?? craftingDeps?.tothalWorldId?.(); // Explicit getter wins; CraftingPanel fallback supports future integration changes.
    return value == null ? null : String(value);
  }

  function setWorldIdGetter(getter) {
    if (typeof getter !== 'function') return false;
    worldIdGetter = getter;
    applyRegisteredEffects();
    renderPanel();
    return true;
  }

  function readWorld() {
    const worldId = currentWorldId(); // World whose shared Motes/ranks are being read or written.
    if (!worldId) return { meta: null, world: null };
    try {
      const meta = JSON.parse(localStorage.getItem('hobunjiSaveMeta') || 'null'); // Existing world-meta store used by livestock/storage/world shops.
      const world = (meta?.worlds || []).find(entry => entry?.id === worldId) || null;
      return { meta, world };
    } catch (error) {
      lastError = `world-read: ${String(error?.message || error)}`;
      return { meta: null, world: null };
    }
  }

  function getState() {
    const raw = readWorld().world?.[MASTERY_FIELD] || {}; // Fresh read keeps characters in the same world synchronized.
    const ranks = {};
    for (const [id, value] of Object.entries(raw.ranks || {})) ranks[String(id)] = Math.max(0, Math.floor(finite(value, 0)));
    // Migration from the first prototype, which stored one-shot `unlocks`.
    for (const id of Array.isArray(raw.unlocks) ? raw.unlocks : []) if (!ranks[id]) ranks[id] = 1;
    return { motes: Math.max(0, Math.floor(finite(raw.motes, 0))), ranks };
  }

  function saveState(nextState) {
    if (!currentWorldId()) return false;
    try {
      const { meta, world } = readWorld(); // Fresh read avoids overwriting unrelated world-meta changes.
      if (!meta || !world) return false;
      const ranks = {};
      for (const [id, value] of Object.entries(nextState?.ranks || {})) {
        const normalized = Math.max(0, Math.floor(finite(value, 0)));
        if (normalized > 0) ranks[String(id)] = normalized;
      }
      world[MASTERY_FIELD] = { motes: Math.max(0, Math.floor(finite(nextState?.motes, 0))), ranks };
      localStorage.setItem('hobunjiSaveMeta', JSON.stringify(meta));
      return true;
    } catch (error) {
      lastError = `world-write: ${String(error?.message || error)}`;
      return false;
    }
  }

  function purchasedRank(perkId, state = getState()) {
    const definition = node(perkId); // Registry definition caps stale/overranked saved values safely.
    const stored = Math.max(0, Math.floor(finite(state?.ranks?.[perkId], 0)));
    return definition ? Math.min(definition.maxRank, stored) : stored;
  }

  function rank(perkId) { return purchasedRank(perkId); }
  function hasUnlock(perkId) { return rank(perkId) > 0; }

  function spentMotes(state = getState()) {
    let spent = 0; // Derived from current registered definitions so the save never needs a second authoritative spent balance.
    for (const definition of tree()) {
      const owned = purchasedRank(definition.id, state);
      for (let r = 1; r <= owned; r++) spent += costForRank(definition, r);
    }
    return spent;
  }

  function tierRequirement(definition) {
    return definition?.tier > 1 ? (TIER_THRESHOLDS[definition.tier - 2] ?? Infinity) : 0;
  }

  function canPurchase(perkId, state = getState()) {
    const definition = node(perkId);
    if (!definition) return { ok: false, reason: 'Unknown crafting perk.', cost: 0 };
    const owned = purchasedRank(perkId, state);
    if (owned >= definition.maxRank) return { ok: false, reason: 'Max rank reached.', cost: 0 };
    const threshold = tierRequirement(definition);
    const spent = spentMotes(state);
    if (spent < threshold) return { ok: false, reason: `Spend ${threshold} Motes in earlier crafting perks to unlock Tier ${definition.tier}.`, cost: costForRank(definition, owned + 1) };
    for (const requirement of definition.requires) {
      if (purchasedRank(requirement.id, state) < requirement.rank) {
        const required = node(requirement.id);
        return { ok: false, reason: `Requires ${required?.name || requirement.id} rank ${requirement.rank}.`, cost: costForRank(definition, owned + 1) };
      }
    }
    const cost = costForRank(definition, owned + 1);
    if (state.motes < cost) return { ok: false, reason: `Need ${cost} Motes of Craft.`, cost };
    return { ok: true, reason: '', cost };
  }

  function notifyChanged(detail) {
    try { window.dispatchEvent?.(new CustomEvent('hobunji-crafting-mastery-changed', { detail })); } catch (_) {}
  }

  function awardMotes(amount, reason = 'crafting_commission', options = {}) {
    const gain = Math.max(0, Math.floor(finite(amount, 0))); // Motes are whole-number world progression currency.
    if (!gain) return 0;
    const state = getState();
    state.motes += gain;
    if (!saveState(state)) return 0;
    if (!options.silent) window.WorldPopupText?.queueReward?.('craft', `+${gain} Mote${gain === 1 ? '' : 's'} of Craft`);
    window.__farmLog?.(`[Crafting Mastery] +${gain} Motes (${reason}); total=${state.motes}`, 'info', 'crafting');
    renderPanel();
    notifyChanged({ type: 'motes', amount: gain, reason, state: clone(state) });
    return gain;
  }

  function purchaseRank(perkId) {
    const definition = node(perkId);
    const state = getState();
    const verdict = canPurchase(perkId, state);
    if (!verdict.ok) {
      craftingDeps?.showToast?.(verdict.reason, false);
      return false;
    }
    state.motes -= verdict.cost;
    state.ranks[definition.id] = purchasedRank(definition.id, state) + 1;
    if (!saveState(state)) {
      craftingDeps?.showToast?.('Could not save crafting mastery.', false);
      return false;
    }
    applyRegisteredEffects();
    craftingDeps?.showToast?.(`Unlocked ${definition.name} rank ${state.ranks[definition.id]}!`, true);
    window.CraftingPanel?.render?.();
    notifyChanged({ type: 'rank', perkId: definition.id, rank: state.ranks[definition.id], state: clone(state) });
    return true;
  }

  // Initial generic perks are integrated here because CraftingPanel currently
  // owns these recipe tables internally. Future specific perks should normally
  // be consumed by their owning systems via rank(perkId), the same pattern used
  // by PerkSystem consumers elsewhere in the game.
  function applyRegisteredEffects() {
    const joineryRank = rank('efficientJoinery'); // Generic furniture material-efficiency rank.
    const crucibleRank = rank('temperedCrucible'); // Generic metallurgy material-efficiency rank.

    for (const blueprint of craftingDeps?.FURNITURE_BLUEPRINT_CATALOG || []) {
      if (!blueprint?.craftCost) continue;
      if (!furnitureBaseCosts.has(blueprint)) furnitureBaseCosts.set(blueprint, clone(blueprint.craftCost));
      const base = furnitureBaseCosts.get(blueprint);
      blueprint.craftCost.wood = Math.max(0, Math.floor(finite(base?.wood, 0)));
      blueprint.craftCost.stone = Math.max(0, Math.floor(finite(base?.stone, 0)));
      if (joineryRank && blueprint.craftCost.wood > 0) blueprint.craftCost.wood = Math.max(1, blueprint.craftCost.wood - joineryRank);
    }

    for (const [metalKey, recipe] of Object.entries(craftingDeps?.METAL_BAR_RECIPES || {})) {
      if (!metalBaseRecipes.has(metalKey)) metalBaseRecipes.set(metalKey, clone(recipe));
      const base = metalBaseRecipes.get(metalKey);
      for (const ingredientKey of Object.keys(recipe || {})) delete recipe[ingredientKey];
      Object.assign(recipe, clone(base));
      if (!crucibleRank) continue;
      const ingredients = Object.entries(recipe).filter(([, amount]) => finite(amount, 0) > 0);
      ingredients.sort((a, b) => finite(b[1], 0) - finite(a[1], 0) || String(a[0]).localeCompare(String(b[0])));
      const chosen = ingredients[0];
      if (chosen) recipe[chosen[0]] = Math.max(1, Math.floor(finite(chosen[1], 1)) - crucibleRank);
    }
  }

  function escapeHtml(value) {
    const esc = craftingDeps?.esc; // Existing game HTML escape helper when available.
    if (typeof esc === 'function') return esc(String(value ?? ''));
    return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  }

  function ensureStyles() {
    if (document.getElementById('craftMasteryStyles')) return;
    const style = document.createElement('style'); // Scoped layout/styles for the Crafting-tab mastery column.
    style.id = 'craftMasteryStyles';
    style.textContent = `
      #mpCrafting .crafting-mastery-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(190px,260px);gap:10px;align-items:start}
      #mpCrafting .crafting-mastery-main{min-width:0}
      #mpCrafting .crafting-mastery-panel{border:1px solid var(--border);border-radius:8px;padding:8px;background:rgba(0,0,0,.12);position:sticky;top:4px}
      #mpCrafting .crafting-mastery-title{font-weight:700;font-size:12px;margin-bottom:3px}
      #mpCrafting .crafting-mastery-currency{font-size:10px;color:var(--accent);margin-bottom:3px}
      #mpCrafting .crafting-mastery-note{font-size:8px;line-height:1.3;color:var(--muted);margin-bottom:7px}
      #mpCrafting .crafting-mastery-tier{font-size:8px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:8px 0 3px}
      #mpCrafting .crafting-mastery-node{display:block;width:100%;text-align:left;border:1px solid var(--border);border-radius:6px;background:transparent;color:inherit;padding:7px;margin:5px 0;cursor:pointer}
      #mpCrafting .crafting-mastery-node:disabled{cursor:default;opacity:.64}
      #mpCrafting .crafting-mastery-node strong{display:block;font-size:10px}
      #mpCrafting .crafting-mastery-node span{display:block;font-size:8px;line-height:1.35;color:var(--muted);margin-top:2px}
      @media(max-width:760px){#mpCrafting .crafting-mastery-layout{grid-template-columns:1fr}#mpCrafting .crafting-mastery-panel{position:static;order:-1}}
    `;
    document.head?.appendChild(style);
  }

  function ensurePanel() {
    const pane = document.getElementById('mpCrafting'); // Existing Inventory > Crafting pane receiving the mastery column.
    const list = document.getElementById('craftingList'); // Existing recipe list whose DOM identity/listeners are preserved.
    if (!pane || !list) return null;
    ensureStyles();
    let layout = pane.querySelector('.crafting-mastery-layout');
    if (!layout) {
      layout = document.createElement('div');
      layout.className = 'crafting-mastery-layout';
      const main = document.createElement('div'); // Existing crafting controls/recipes remain in the main column.
      main.className = 'crafting-mastery-main';
      const topRow = pane.querySelector('.supply-top-row');
      const recipeSection = list.closest('.menu-section') || list;
      if (topRow) main.appendChild(topRow);
      main.appendChild(recipeSection);
      const aside = document.createElement('aside'); // World-shared progression side panel.
      aside.className = 'crafting-mastery-panel';
      aside.dataset.craftingMasteryPanel = '1';
      layout.append(main, aside);
      pane.appendChild(layout);
    }
    return layout.querySelector('[data-crafting-mastery-panel]');
  }

  function renderPanel() {
    const panel = ensurePanel();
    if (!panel) return;
    const state = getState();
    const spent = spentMotes(state);
    panel.innerHTML = '<div class="crafting-mastery-title">Crafting Mastery</div>'
      + `<div class="crafting-mastery-currency">✨ ${state.motes} Mote${state.motes === 1 ? '' : 's'} of Craft · shared by this world</div>`
      + `<div class="crafting-mastery-note">Spend Motes on broad techniques first; later tiers can hold increasingly specific crafting specialties. ${spent} Motes spent.</div>`;

    let lastTier = null;
    for (const definition of tree()) {
      if (definition.tier !== lastTier) {
        lastTier = definition.tier;
        const tier = document.createElement('div');
        tier.className = 'crafting-mastery-tier';
        const threshold = tierRequirement(definition);
        tier.textContent = definition.tier === 1 ? 'Tier 1 · General' : `Tier ${definition.tier} · ${threshold} Motes spent`;
        panel.appendChild(tier);
      }
      const owned = purchasedRank(definition.id, state);
      const verdict = canPurchase(definition.id, state);
      const previewRank = Math.min(definition.maxRank, Math.max(1, owned || 1));
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'crafting-mastery-node';
      button.disabled = owned >= definition.maxRank;
      const rankText = definition.maxRank > 1 ? ` · Rank ${owned}/${definition.maxRank}` : '';
      const costText = owned >= definition.maxRank ? ' · Max' : ` · ${verdict.cost} Motes`;
      const description = definition.desc(Math.max(1, owned || previewRank));
      button.innerHTML = `<strong>${owned ? '✓ ' : ''}${escapeHtml(definition.name)}${rankText}${costText}</strong><span>${escapeHtml(description)}${!verdict.ok && owned < definition.maxRank ? ` · ${escapeHtml(verdict.reason)}` : ''}</span>`;
      if (owned < definition.maxRank) button.addEventListener('click', () => purchaseRank(definition.id));
      panel.appendChild(button);
    }
  }

  function patchCraftingPanel(api) {
    if (!api?.init || api.__craftingMasteryPatched) return false;
    const originalInit = api.init.bind(api); // Existing CraftingPanel initialization retained while capturing its live recipe tables.
    const originalRender = api.render?.bind(api);
    api.init = function craftingMasteryInit(injectedDeps, ...rest) {
      craftingDeps = injectedDeps;
      const result = originalInit(injectedDeps, ...rest);
      applyRegisteredEffects();
      return result;
    };
    if (originalRender) {
      api.render = function craftingMasteryRender(...args) {
        applyRegisteredEffects();
        const result = originalRender(...args);
        renderPanel();
        return result;
      };
    }
    Object.defineProperty(api, '__craftingMasteryPatched', { configurable: true, value: true });
    return true;
  }

  function patchJubmirShop(api) {
    if (!api?.init || api.__craftingMasteryWorldPatched) return false;
    const originalInit = api.init.bind(api); // JubmirShop already receives the authoritative active-world getter.
    api.init = function craftingMasteryWorldInit(injectedDeps, ...rest) {
      if (typeof injectedDeps?.tothalWorldId === 'function') setWorldIdGetter(injectedDeps.tothalWorldId);
      const result = originalInit(injectedDeps, ...rest);
      applyRegisteredEffects();
      renderPanel();
      return result;
    };
    Object.defineProperty(api, '__craftingMasteryWorldPatched', { configurable: true, value: true });
    return true;
  }

  function futureGlobal(name, patch) {
    if (patch(window[name])) return;
    const descriptor = Object.getOwnPropertyDescriptor(window, name); // Chains any earlier lazy-global accessor rather than trampling it.
    if (descriptor && !descriptor.configurable) return;
    const previousGet = descriptor?.get;
    const previousSet = descriptor?.set;
    let value = descriptor?.value;
    Object.defineProperty(window, name, {
      configurable: true,
      enumerable: descriptor?.enumerable ?? true,
      get() { return previousGet ? previousGet.call(window) : value; },
      set(next) {
        if (previousSet) previousSet.call(window, next); else value = next;
        const resolved = previousGet ? previousGet.call(window) : (previousSet ? next : value);
        patch(resolved);
      },
    });
  }

  function debugSnapshot() {
    return {
      version: VERSION,
      worldId: currentWorldId(),
      state: getState(),
      spentMotes: spentMotes(),
      tiers: [...TIER_THRESHOLDS],
      nodes: tree().map(definition => ({ ...definition, desc: definition.desc(rank(definition.id) || 1) })),
      lastError,
    };
  }

  window.CraftingMasterySystem = Object.freeze({
    version: VERSION,
    TIER_THRESHOLDS,
    registerNode,
    registerNodes,
    node,
    tree,
    rank,
    purchasedRank,
    hasUnlock,
    spentMotes,
    canPurchase,
    getState,
    saveState,
    setWorldIdGetter,
    awardMotes,
    purchaseRank,
    applyRegisteredEffects,
    renderPanel,
    debugSnapshot,
  });
  window.__craftingMasteryDebug = debugSnapshot;

  futureGlobal('CraftingPanel', patchCraftingPanel);
  futureGlobal('JubmirShop', patchJubmirShop);
})();
