(() => {
  'use strict';

  if (Number(window.InventoryCharacterEffects?.version) >= 1) return;

  const VERSION = 1;
  const STYLE_ID = 'inventoryCharacterEffectsStyles'; // Used to keep the split gear-effects panel styling idempotent.
  const BASE_DODGE_PROFILE = Object.freeze({ durationS: 0.22, iframeMs: 380 }); // Used to turn outfit dodge efficacy into the ordinary player's stable dodge timing readout.
  const REFRESH_INTERVAL_MS = 1000; // Used only while the inventory exists; keeps expiring buffs reflected without frame-level work.

  let inventoryUiPatched = false; // Used to avoid wrapping InventoryUI.init/decorate more than once.
  let inventoryHookTimer = null; // Used only until the asynchronously loaded InventoryUI becomes available.
  let refreshTimer = null; // Used for the low-frequency live derived-value refresh.
  let refreshQueued = false; // Used to coalesce click/resource/buff refresh bursts into one animation-frame update.
  let lastSnapshot = null; // Used by the mobile-friendly diagnostics export.
  let lastError = null; // Used by diagnostics when a third-party/runtime helper throws during a read.

  const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, finite(value)));

  function safeNumber(read, fallback = 1) {
    try {
      const value = typeof read === 'function' ? read() : read;
      return Number.isFinite(Number(value)) ? Number(value) : fallback;
    } catch (error) {
      lastError = String(error?.message || error);
      return fallback;
    }
  }

  function currentPlayer(combat = window.Combat) {
    return combat?.deps?.player || null;
  }

  function defaultOutfitStats() {
    return {
      weightUnits: 0,
      damageTakenMul: 1,
      footingTakenMul: 1,
      dodgeEfficacy: 1,
      combatMoveMul: 1,
    };
  }

  function composeSnapshot(apis = {}) {
    const clothing = apis.clothing ?? window.ClothingWeavingSystem; // Shared authority for total outfit weight and every weight-derived multiplier.
    const skill = apis.skill ?? window.SkillSystem; // Shared authority for active food/stat combat modifiers.
    const perks = apis.perks ?? window.PerkSystem; // Shared authority for purchased perk ranks and general combat damage.
    const alchemy = apis.alchemy ?? window.AlchemySystem; // Shared authority for active potion/buff multipliers.
    const cooking = apis.cooking ?? window.CookingSystem; // Shared authority for active food movement and Stamina-regeneration multipliers.
    const combat = apis.combat ?? window.Combat; // Shared authority for the composed current combat movement multiplier.
    const resources = apis.resources ?? window.ResourceSystem; // Shared authority for effective resource maxima and current attack-speed/exhaustion timing.
    const player = apis.player ?? currentPlayer(combat); // Used for literal effective maxima and the current attack-speed result.

    let outfit = defaultOutfitStats(); // Used as a neutral fallback during early boot or tests without the weaving system.
    try {
      outfit = { ...outfit, ...(clothing?.armorStats?.() || {}) };
    } catch (error) {
      lastError = String(error?.message || error);
    }

    const footingResistanceRank = Math.max(0, safeNumber(() => perks?.rank?.('combat', 'increaseFootingResistance'), 0)); // Used to compose the perk beneath outfit Footing resistance exactly as ResourceSystem does.
    const footingPerkTakenMul = 1 - Math.min(0.6, footingResistanceRank * 0.08); // Mirrors ResourceSystem.spendFooting's combat perk calculation.

    const skillAttackMul = safeNumber(() => skill?.attackMultiplier?.(), 1); // Used in final outgoing damage exactly as the gameplay skill/food helper contributes it.
    const perkDamageMul = safeNumber(() => perks?.combatDamageMultiplier?.({}), 1); // Empty context intentionally requests only universally applicable combat damage perks.
    const alchemyDamageMul = safeNumber(() => alchemy?.getOutgoingDamageMultiplier?.(), 1); // Used for current Strength/Fury-style outgoing damage buffs.
    const skillDamageTakenMul = safeNumber(() => skill?.damageTakenMultiplier?.(), 1); // Used for current Fortitude food mitigation.
    const cookingMoveMul = safeNumber(() => cooking?.getSpeedMultiplier?.(), 1); // Used for current Speed food.
    const alchemyMoveMul = safeNumber(() => alchemy?.getMovementSpeedMultiplier?.() ?? alchemy?.getSpeedMul?.(), 1); // Used for current movement potions without depending on one alias.
    const combatMoveMul = safeNumber(() => combat?.getMovementSpeedMul?.(), 1); // Includes current combat-only outfit burden and any other Combat-owned movement policy.
    const attackSpeedMul = player
      ? safeNumber(() => resources?.getExhaustionSpeed?.(player), safeNumber(() => alchemy?.getAttackSpeedMultiplier?.(), 1))
      : safeNumber(() => alchemy?.getAttackSpeedMultiplier?.(), 1); // ResourceSystem already folds Alchemy into exhaustion timing for the player.
    const staminaRegenMul = safeNumber(() => cooking?.getStaminaRegenMultiplier?.(), 1)
      * safeNumber(() => alchemy?.getStaminaRegenMultiplier?.(), 1); // Mirrors PlayerVitals + ResourceSystem's two-stage Stamina recovery composition.

    const effectiveMax = (key, fallbackKey) => player
      ? safeNumber(() => resources?.getEffectiveMax?.(player, key), finite(player?.[fallbackKey], 0))
      : 0; // Stable literal readout; ResourceSystem includes max-resource buffs, perks, and capacity-reducing afflictions.

    return {
      outfit: {
        weightUnits: Math.max(0, finite(outfit.weightUnits, 0)),
        damageTakenMul: clamp(outfit.damageTakenMul ?? 1, 0, 99),
        footingTakenMul: clamp(outfit.footingTakenMul ?? 1, 0, 99),
        dodgeEfficacy: clamp(outfit.dodgeEfficacy ?? 1, 0, 99),
        combatMoveMul: clamp(outfit.combatMoveMul ?? 1, 0, 99),
      },
      final: {
        damageDealtMul: skillAttackMul * perkDamageMul * alchemyDamageMul,
        damageTakenMul: skillDamageTakenMul * finite(outfit.damageTakenMul, 1),
        footingDamageMul: safeNumber(() => alchemy?.getFootingDamageMultiplier?.(), 1),
        footingTakenMul: finite(outfit.footingTakenMul, 1) * footingPerkTakenMul,
        moveSpeedMul: cookingMoveMul * alchemyMoveMul * combatMoveMul,
        attackSpeedMul,
        staminaCostMul: safeNumber(() => alchemy?.getStaminaSpendMultiplier?.(), 1),
        staminaRegenMul,
        healthRegenMul: safeNumber(() => alchemy?.getHealthRegenMultiplier?.(), 1),
        damageAfflictionMul: safeNumber(() => alchemy?.getIncomingDamageAfflictionMultiplier?.(), 1),
        positiveFavorMul: safeNumber(() => alchemy?.getPositiveFavorMultiplier?.(), 1),
        perceptionMul: safeNumber(() => alchemy?.getPerceptionMultiplier?.(), 1),
        maxHealth: effectiveMax('health', 'maxHealth'),
        maxStamina: effectiveMax('stamina', 'maxStamina'),
        maxFooting: effectiveMax('footing', 'maxFooting'),
        dodgeIframeMs: Math.round(BASE_DODGE_PROFILE.iframeMs * finite(outfit.dodgeEfficacy, 1)),
        dodgeDurationMs: Math.round(BASE_DODGE_PROFILE.durationS * 1000 * finite(outfit.dodgeEfficacy, 1)),
      },
    };
  }

  function installStyles() {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style'); // Presentation is isolated here so inventory-ui.js remains responsible for the surrounding gear layout.
    style.id = STYLE_ID;
    style.textContent = `
      #mpInventory .gear-outfit-stats.gear-character-effects-host {
        padding:0; border:0; background:none; overflow:visible; gap:var(--inv-gap);
      }
      #mpInventory .gear-outfit-stats.gear-character-effects-host > .gear-loadout-heading { display:none; }
      #mpInventory .gear-character-effects-card {
        flex:1 1 0; min-height:0; padding:calc(.5 * var(--inv-gap));
        border:1px solid #ffffff17; border-radius:var(--inv-radius); background:#0000001c;
        display:flex; flex-direction:column; overflow:hidden;
      }
      #mpInventory .gear-character-effects-card .gear-loadout-heading {
        flex:0 0 auto; min-height:calc(1.15 * var(--inv-row));
      }
      #mpInventory .gear-effects-list {
        flex:1 1 auto; min-height:0; display:flex; flex-direction:column; gap:2px;
        overflow-y:auto; scrollbar-width:thin;
      }
      #mpInventory .gear-effect-row {
        flex:0 0 auto; min-width:0; display:flex; align-items:baseline; justify-content:space-between; gap:5px;
        padding:2px 4px; border:1px solid #ffffff10; border-radius:calc(.65 * var(--inv-radius)); background:#ffffff05;
        font-size:var(--inv-font-xs); line-height:1.25;
      }
      #mpInventory .gear-effect-label { min-width:0; color:#c8d8ca; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      #mpInventory .gear-effect-value { flex:0 0 auto; color:#f7e9a7; font-weight:800; font-variant-numeric:tabular-nums; white-space:nowrap; }
      #mpInventory .gear-effect-row.literal .gear-effect-value { color:#d8eef7; }
      @media (pointer:coarse) {
        #mpInventory .gear-effect-row { padding:3px 4px; }
      }
    `;
    document.head.appendChild(style);
  }

  function makeCard(kind, headingText) {
    const card = document.createElement('section'); // One half of the old Outfit Effects column: outfit-only above, composed results below.
    card.className = `gear-character-effects-card gear-character-effects-${kind}`;
    card.dataset.effectsKind = kind;
    const heading = document.createElement('div');
    heading.className = 'gear-loadout-heading';
    heading.textContent = headingText;
    const list = document.createElement('div');
    list.className = 'gear-stat-list gear-effects-list'; // gear-stat-list also tells InventoryUI's observer these presentation-only mutations are ignorable.
    card.append(heading, list);
    return card;
  }

  function ensurePanel() {
    if (typeof document === 'undefined') return null;
    const panel = document.querySelector('#mpInventory .gear-outfit-stats');
    if (!panel) return null;
    panel.classList.add('gear-character-effects-host');
    let outfitCard = panel.querySelector('.gear-character-effects-outfit');
    let finalCard = panel.querySelector('.gear-character-effects-final');
    if (!outfitCard || !finalCard) {
      outfitCard = makeCard('outfit', 'Outfit effects');
      finalCard = makeCard('final', 'Final values');
      panel.replaceChildren(outfitCard, finalCard);
    }
    return { panel, outfitCard, finalCard };
  }

  function formatMultiplier(value) {
    const rounded = Math.round(finite(value, 1) * 100) / 100;
    return Number.isInteger(rounded) ? rounded.toFixed(1) : String(rounded);
  }

  function formatNumber(value) {
    const rounded = Math.round(finite(value, 0) * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  }

  function rowSpec(label, value, title = '', literal = false) {
    return { label, value, title, literal }; // Compact immutable-like row description consumed by renderRows below.
  }

  function renderRows(list, rows) {
    if (!list) return;
    while (list.children.length < rows.length) {
      const row = document.createElement('div'); // Reused on later refreshes so buff ticks do not churn inventory DOM nodes.
      row.className = 'gear-effect-row';
      const label = document.createElement('span'); label.className = 'gear-effect-label';
      const value = document.createElement('strong'); value.className = 'gear-effect-value';
      row.append(label, value);
      list.appendChild(row);
    }
    while (list.children.length > rows.length) list.lastElementChild?.remove();
    rows.forEach((spec, index) => {
      const row = list.children[index];
      row.classList.toggle('literal', !!spec.literal);
      row.title = spec.title || '';
      const label = row.querySelector('.gear-effect-label');
      const value = row.querySelector('.gear-effect-value');
      if (label && label.textContent !== spec.label) label.textContent = spec.label;
      if (value && value.textContent !== spec.value) value.textContent = spec.value;
    });
  }

  function refresh() {
    try {
      const ui = ensurePanel();
      if (!ui) return null;
      const snapshot = composeSnapshot();
      lastSnapshot = snapshot;
      const outfit = snapshot.outfit;
      const final = snapshot.final;

      renderRows(ui.outfitCard.querySelector('.gear-effects-list'), [
        rowSpec('Total weight', `${formatNumber(outfit.weightUnits)} u`, 'Total weight of equipped craftable cloth.', true),
        rowSpec('Damage taken', `×${formatMultiplier(outfit.damageTakenMul)}`, 'Outfit-only incoming Health damage multiplier.'),
        rowSpec('Footing taken', `×${formatMultiplier(outfit.footingTakenMul)}`, 'Outfit-only incoming Footing damage multiplier.'),
        rowSpec('Dodge efficacy', `×${formatMultiplier(outfit.dodgeEfficacy)}`, 'Scales ordinary dodge travel/duration and i-frames.'),
        rowSpec('Combat move', `×${formatMultiplier(outfit.combatMoveMul)}`, 'Applied from outfit weight while actively in combat and not mounted.'),
      ]);

      renderRows(ui.finalCard.querySelector('.gear-effects-list'), [
        rowSpec('Damage dealt', `×${formatMultiplier(final.damageDealtMul)}`, 'General result from current stat/food, universal combat perks, and active buffs.'),
        rowSpec('Damage taken', `×${formatMultiplier(final.damageTakenMul)}`, 'Current general Health-damage result from Fortitude-style stats and outfit defense.'),
        rowSpec('Footing dealt', `×${formatMultiplier(final.footingDamageMul)}`, 'Current outgoing Footing-damage multiplier.'),
        rowSpec('Footing taken', `×${formatMultiplier(final.footingTakenMul)}`, 'Current outfit + Footing Resistance perk result.'),
        rowSpec('Move speed', `×${formatMultiplier(final.moveSpeedMul)}`, 'Current food, buff, Combat, and active-combat outfit movement result.'),
        rowSpec('Attack speed', `×${formatMultiplier(final.attackSpeedMul)}`, 'Current attack timing after active buffs and exhaustion.'),
        rowSpec('Stamina cost', `×${formatMultiplier(final.staminaCostMul)}`, 'Current general Stamina-spend multiplier.'),
        rowSpec('Stamina regen', `×${formatMultiplier(final.staminaRegenMul)}`, 'Current food + active-buff recovery multiplier; situational resting remains contextual.'),
        rowSpec('Health regen', `×${formatMultiplier(final.healthRegenMul)}`, 'Current active-buff Health recovery multiplier; situational resting remains contextual.'),
        rowSpec('Damage buildup', `×${formatMultiplier(final.damageAfflictionMul)}`, 'Current incoming Damage-family affliction buildup multiplier.'),
        rowSpec('Positive favor', `×${formatMultiplier(final.positiveFavorMul)}`, 'Current positive favor-gain multiplier.'),
        rowSpec('Perception', `×${formatMultiplier(final.perceptionMul)}`, 'Current perception multiplier where perception checks apply.'),
        rowSpec('Max Health', formatNumber(final.maxHealth), 'Current effective Health maximum after perks and capacity reductions.', true),
        rowSpec('Max Stamina', formatNumber(final.maxStamina), 'Current effective Stamina maximum after perks, buffs, and capacity reductions.', true),
        rowSpec('Max Footing', formatNumber(final.maxFooting), 'Current effective Footing maximum after buffs.', true),
        rowSpec('Dodge i-frames', `${formatNumber(final.dodgeIframeMs)} ms`, 'Ordinary 380 ms dodge i-frame window after outfit-weight efficacy.', true),
        rowSpec('Dodge time', `${formatNumber(final.dodgeDurationMs)} ms`, 'Ordinary 220 ms dodge movement/roll window after outfit-weight efficacy.', true),
      ]);
      return snapshot;
    } catch (error) {
      lastError = String(error?.message || error);
      return null;
    }
  }

  function scheduleRefresh() {
    if (refreshQueued || typeof requestAnimationFrame !== 'function') return;
    refreshQueued = true;
    requestAnimationFrame(() => {
      refreshQueued = false;
      refresh();
    });
  }

  function patchInventoryUi(api = window.InventoryUI) {
    if (!api || inventoryUiPatched || api.__characterEffectsPatched) {
      if (api?.__characterEffectsPatched) inventoryUiPatched = true;
      return inventoryUiPatched;
    }
    if (typeof api.init === 'function') {
      const originalInit = api.init.bind(api); // Preserves inventory initialization before installing this presentation extension.
      api.init = function characterEffectsInventoryInit(...args) {
        const result = originalInit(...args);
        scheduleRefresh();
        return result;
      };
    }
    if (typeof api.decorate === 'function') {
      const originalDecorate = api.decorate.bind(api); // Preserves all existing pack/gear decoration before refreshing derived values.
      api.decorate = function characterEffectsInventoryDecorate(...args) {
        const result = originalDecorate(...args);
        scheduleRefresh();
        return result;
      };
    }
    api.__characterEffectsPatched = true;
    inventoryUiPatched = true;
    scheduleRefresh();
    return true;
  }

  function start() {
    installStyles();
    if (!patchInventoryUi()) {
      inventoryHookTimer = window.setInterval?.(() => {
        if (!patchInventoryUi()) return;
        window.clearInterval?.(inventoryHookTimer);
        inventoryHookTimer = null;
      }, 100) || null;
    }
    refreshTimer = window.setInterval?.(() => {
      const pane = document.getElementById('mpInventory'); // Cheap gate prevents derived reads while the Gear inventory is absent/inactive.
      if (pane?.classList.contains('inv-mode-gear')) refresh();
    }, REFRESH_INTERVAL_MS) || null;
    window.addEventListener?.('hobunji-resource-change', scheduleRefresh);
    window.addEventListener?.('hobunji-attack-values-loaded', scheduleRefresh);
    document.addEventListener?.('hobunji-alchemy-change', scheduleRefresh);
    document.getElementById('mpInventory')?.addEventListener?.('click', scheduleRefresh, true);
    refresh();
  }

  function debugSnapshot() {
    return {
      version: VERSION,
      inventoryUiPatched,
      panelReady: typeof document !== 'undefined' && !!document.querySelector('#mpInventory .gear-character-effects-final'),
      outfitWeight: lastSnapshot?.outfit?.weightUnits ?? null,
      final: lastSnapshot?.final ? { ...lastSnapshot.final } : null,
      lastError,
    };
  }

  window.InventoryCharacterEffects = Object.freeze({
    version: VERSION,
    refresh,
    snapshot: () => composeSnapshot(),
    debugSnapshot,
    __test: Object.freeze({ composeSnapshot, BASE_DODGE_PROFILE }),
  });
  window.__inventoryCharacterEffectsDebug = debugSnapshot;

  if (typeof document !== 'undefined') start();
})();
