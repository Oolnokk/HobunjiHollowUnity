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


  const TRINKET_STAT_LABELS = Object.freeze({
    maxHealth: 'Max Health', maxStamina: 'Max Stamina', maxFooting: 'Max Footing',
    healthRegen: 'Health recovery', healthRegenInCombat: 'Health regen (combat)',
    staminaRegen: 'Stamina recovery', ordinaryStaminaRegen: 'Normal Stamina regen',
    footingRegen: 'Footing recovery', afflictionRecovery: 'Affliction recovery',
    exhaustionRecovery: 'Exhaustion recovery', footingRecoveryDelay: 'Footing regen delay',
    dodgeEfficacy: 'Dodge travel & i-frames', dodgeTravel: 'Dodge travel',
    dodgeIframe: 'Dodge i-frames', dodgeStaminaCost: 'Dodge Stamina cost',
    knockbackDistance: 'Knockback received',
    outgoingHealthDamage: 'Weapon Health damage', outgoingFootingDamage: 'Weapon Footing damage',
    incomingHealthDamage: 'Health damage taken', incomingFootingDamage: 'Footing damage taken',
    heavyFootingDamage: 'Heavy Footing damage', heavyAttackStaminaCost: 'Heavy Stamina cost',
    attackSpeed: 'Weapon attack speed', attackStaminaCost: 'Attack Stamina cost',
    outgoingAffliction: 'Weapon affliction buildup', incomingAffliction: 'Affliction buildup taken',
    lowHealthDamage: 'Damage below 35% HP', lowHealthHealing: 'Healing below 35% HP',
    proneTargetDamage: 'Health damage vs prone', killStaminaRestore: 'Stamina restored on kill',
    rangedDamage: 'Ranged Health damage', rangedProjectileSpeed: 'Ranged projectile speed',
    flaskPower: 'Flask impact power', flaskRadius: 'Flask splash radius',
    shatterPower: 'Shattercask power', shatterRadius: 'Shattercask radius',
  }); // Displays every authored trinket stat channel with a short, gameplay-accurate label in the left rail.
  const TRINKET_LOWER_IS_BETTER = new Set([
    'footingRecoveryDelay', 'knockbackDistance', 'dodgeStaminaCost',
    'heavyAttackStaminaCost', 'attackStaminaCost', 'incomingHealthDamage',
    'incomingFootingDamage', 'incomingAffliction',
  ]); // Distinguishes reduced incoming damage/cost/delay from drawbacks when coloring combined trinket-only effects.

  function trinketPercent(multiplier) {
    const percent = Math.round((multiplier - 1) * 1000) / 10; // Rounded to a tenth so multiplicative duplicate bonuses remain visible.
    return (percent > 0 ? '+' : '') + formatNumber(percent) + '%';
  }

  function composeTrinketEffects(trinkets = window.TrinketSystem, perks = window.PerkSystem) {
    let equipped = []; // Snapshot of equipped item instances; duplicates intentionally contribute separately.
    try {
      const entries = trinkets?.equippedEntries?.(); // Uses the exact equipped gear collection rather than the owned trinkets list.
      if (Array.isArray(entries)) equipped = entries;
    } catch (error) {
      lastError = String(error?.message || error);
    }
    const stats = new Map(); // Accumulates same-channel stat effects multiplicatively, matching TrinketSystem.statMultiplier.
    const perkRanks = new Map(); // Accumulates Combat perk bonus ranks additively, matching TrinketSystem.perkBonusRanks.
    const companion = { damage: 1, footing: 1, affliction: 1 }; // Accumulates companion channels independently as CompanionOffense does.
    const contributors = new Map(); // Adds source trinket names to row tooltips for diagnosing unexpectedly stacked effects.
    let used = 0; // Displays the Attunement spent by these equipped instances beside the section heading.
    for (const entry of equipped) {
      const def = entry?.def || trinkets?.DEFINITIONS?.[entry?.id]; // Saved entries can resolve their definitions through either public API shape.
      if (!def) continue;
      used += Math.max(0, Number(def.attunementCost) || 0);
      for (const [key, raw] of Object.entries(def.effects?.stats || {})) {
        const value = Number(raw); // Ignores invalid or non-positive channels just like the gameplay provider.
        if (!Number.isFinite(value) || value <= 0) continue;
        stats.set(key, (stats.get(key) || 1) * value);
        if (!contributors.has(key)) contributors.set(key, []);
        contributors.get(key).push(def.displayName || entry.id || key);
      }
      for (const [key, raw] of Object.entries(def.effects?.perkRanks || {})) {
        const value = Number(raw); // Trinket perk grants are additional ranks, not new purchased perk allocations.
        if (Number.isFinite(value) && value > 0) perkRanks.set(key, (perkRanks.get(key) || 0) + value);
      }
      for (const channel of Object.keys(companion)) {
        const value = Number(def.effects?.companion?.[channel]); // Non-companion trinkets leave that channel unchanged.
        if (Number.isFinite(value) && value > 0) companion[channel] *= value;
      }
    }
    const capacity = Math.max(0, safeNumber(() => trinkets?.capacity?.(), safeNumber(() => trinkets?.ATTUNEMENT_CAPACITY, 8))); // Mirrors the current Attunement budget in the heading.
    const order = Object.keys(TRINKET_STAT_LABELS); // Keeps row positions stable when equipment selection order changes.
    const rows = []; // Rendered at the top of the left-side character-effects list before Outfit and Final values.
    for (const [key, multiplier] of [...stats].sort((a, b) => {
      const aIndex = order.indexOf(a[0]), bIndex = order.indexOf(b[0]); // Unknown future keys remain visible after the known stats.
      return (aIndex < 0 ? order.length : aIndex) - (bIndex < 0 ? order.length : bIndex) || a[0].localeCompare(b[0]);
    })) {
      const label = TRINKET_STAT_LABELS[key] || key.replace(/([a-z])([A-Z])/g, '$1 $2'); // New stats remain visible without needing a UI update.
      const favorable = TRINKET_LOWER_IS_BETTER.has(key) ? multiplier < 1 : multiplier > 1; // Marks drawbacks even when the numeric value grows.
      const tone = Math.abs(multiplier - 1) < 1e-8 ? 'neutral' : favorable ? 'bonus' : 'penalty'; // Offset effects still appear as a neutral 0% entry.
      const value = trinketPercent(multiplier) + (key === 'killStaminaRestore' ? ' max / kill' : ''); // Death's Momentum is a refund of max Stamina, not a generic regen multiplier.
      rows.push(rowSpec(label, value, 'Combined trinket-only effect from: ' + (contributors.get(key) || []).join(', '), false, tone));
    }
    const perkNames = perks?.TREES?.combat || []; // Reuses the actual Combat perk names instead of duplicating perk display text.
    for (const [key, count] of perkRanks) {
      const name = perkNames.find(perk => perk.id === key)?.name || key.replace(/([a-z])([A-Z])/g, '$1 $2'); // Unknown future perks retain a readable label.
      rows.push(rowSpec('Perk: ' + name, '+' + formatNumber(count) + ' ranks', 'Bonus Combat perk ranks from equipped trinkets; purchased ranks are separate.', false, 'bonus'));
    }
    for (const [channel, multiplier] of Object.entries(companion)) {
      if (multiplier === 1) continue;
      const name = { damage: 'Companion Health damage', footing: 'Companion Footing damage', affliction: 'Companion affliction buildup' }[channel]; // Independent animal-attack channels never count twice.
      rows.push(rowSpec(name, trinketPercent(multiplier), 'Combined equipped trinket bonus to your animal companion.', false, multiplier > 1 ? 'bonus' : 'penalty'));
    }
    if (!rows.length) rows.push(rowSpec(equipped.length ? 'No net trinket effects' : 'No trinkets equipped', '—', 'Equip trinkets from the middle Gear inventory.', false, 'empty'));
    return { equipped: equipped.length, used, capacity, rows, stats: Object.fromEntries(stats), perkRanks: Object.fromEntries(perkRanks), companion };
  }

  function composeSnapshot(apis = {}) {
    const clothing = apis.clothing ?? window.ClothingWeavingSystem; // Shared authority for total outfit weight and every weight-derived multiplier.
    const skill = apis.skill ?? window.SkillSystem; // Shared authority for active food/stat combat modifiers.
    const perks = apis.perks ?? window.PerkSystem; // Shared authority for purchased perk ranks and general combat damage.
    const alchemy = apis.alchemy ?? window.AlchemySystem; // Shared authority for active potion/buff multipliers.
    const trinkets = apis.trinkets ?? window.TrinketSystem; // Current equipped trinkets affect the displayed dodge and knockback modifiers.
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
      trinkets: composeTrinketEffects(trinkets, perks), // Live combined trinket-only summary used above Outfit and Final Values.
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
        dodgeIframeMs: Math.round(BASE_DODGE_PROFILE.iframeMs * finite(outfit.dodgeEfficacy, 1) * safeNumber(() => trinkets?.combatMultiplier?.('dodgeEfficacy'), 1)),
        dodgeDurationMs: Math.round(BASE_DODGE_PROFILE.durationS * 1000 * finite(outfit.dodgeEfficacy, 1) * safeNumber(() => trinkets?.combatMultiplier?.('dodgeEfficacy'), 1)),
      },
    };
  }

  function installStyles() {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style'); // Presentation is isolated here so inventory-ui.js remains responsible for the surrounding gear layout.
    style.id = STYLE_ID;
    style.textContent = `
      /* The loadout owns the top of the available Gear region. Only the variable-size owned collection may scroll. */
      #mpInventory.inv-mode-gear .inv-equip-section {
        display:flex;
        flex-direction:column;
        height:calc(21 * var(--inv-row));
        max-height:calc(21 * var(--inv-row));
        overflow:hidden;
        box-sizing:border-box;
      }
      #mpInventory.inv-mode-gear .gear-loadout-grid {
        flex:0 0 auto;
        height:auto;
        min-height:0;
        max-height:none;
        box-sizing:border-box;
        overflow:visible;
        margin-bottom:calc(1.1 * var(--inv-gap));
      }
      #mpInventory.inv-mode-gear .gear-owned-section {
        position:relative;
        z-index:0;
        flex:1 1 auto;
        min-height:0;
        margin-top:0;
        padding-top:0;
        overflow-y:auto;
        overflow-x:hidden;
        scrollbar-width:thin;
      }
      #mpInventory .gear-outfit-stats.gear-character-effects-host {
        display:grid;
        grid-template-rows:auto auto;
        align-content:start;
        padding:0;
        border:0;
        background:none;
        overflow:visible;
        gap:var(--inv-gap);
      }
      #mpInventory .gear-outfit-stats.gear-character-effects-host > .gear-loadout-heading { display:none; }
      #mpInventory .gear-character-effects-card {
        min-height:0;
        padding:calc(.35 * var(--inv-gap));
        border:1px solid #ffffff17;
        border-radius:var(--inv-radius);
        background:#0000001c;
        display:flex;
        flex-direction:column;
        overflow:visible;
      }
      #mpInventory .gear-character-effects-card .gear-loadout-heading {
        flex:0 0 auto;
        min-height:calc(1.05 * var(--inv-row));
      }
      /* Extra card specificity is deliberate: InventoryUI injects its generic .gear-stat-list flex rules later. */
      #mpInventory .gear-character-effects-card .gear-effects-list {
        flex:none;
        min-height:0;
        display:grid;
        grid-template-columns:repeat(2,minmax(0,1fr));
        grid-auto-flow:row;
        align-content:start;
        gap:1px 4px;
        overflow:visible;
      }
      #mpInventory .gear-character-effects-card .gear-effect-row {
        min-width:0;
        display:flex;
        align-items:baseline;
        justify-content:space-between;
        gap:3px;
        padding:1px 2px;
        border:1px solid #ffffff0d;
        border-radius:calc(.55 * var(--inv-radius));
        background:#ffffff04;
        font-size:clamp(11px,calc(.56 * var(--inv-row)),13px);
        line-height:1.04;
      }
      #mpInventory .gear-character-effects-card .gear-effect-label {
        min-width:0;
        color:#c8d8ca;
        white-space:normal;
        overflow-wrap:anywhere;
        line-height:1.02;
      }
      #mpInventory .gear-character-effects-card .gear-effect-value {
        flex:0 0 auto;
        color:#f7e9a7;
        font-weight:800;
        font-variant-numeric:tabular-nums;
        white-space:nowrap;
      }
      #mpInventory .gear-character-effects-card .gear-effect-row.literal .gear-effect-value { color:#d8eef7; }
      #mpInventory .gear-character-effects-trinkets .gear-effect-row.bonus .gear-effect-value { color:#9ee9bf; }
      #mpInventory .gear-character-effects-trinkets .gear-effect-row.penalty .gear-effect-value { color:#ffaaa0; }
      #mpInventory .gear-character-effects-trinkets .gear-effect-row.neutral .gear-effect-value { color:#d8eef7; }
      #mpInventory .gear-character-effects-trinkets .gear-effect-row.empty { grid-column:1 / -1; }
      @media (max-width:720px) {
        #mpInventory .gear-character-effects-card .gear-effect-row {
          gap:2px;
          padding:1px;
          font-size:clamp(11px,calc(.52 * var(--inv-row)),12px);
        }
        #mpInventory .gear-character-effects-card .gear-effects-list { gap:1px 2px; }
      }
    `;
    document.head.appendChild(style);
  }

  function makeCard(kind, headingText) {
    const card = document.createElement('section'); // One stacked outfit/final card; height follows its own compact two-column content.
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
    if (!panel.classList.contains('gear-character-effects-host')) panel.classList.add('gear-character-effects-host'); // Avoid redundant class mutations that wake the Gear layout observer.
    let trinketCard = panel.querySelector('.gear-character-effects-trinkets');
    let outfitCard = panel.querySelector('.gear-character-effects-outfit');
    let finalCard = panel.querySelector('.gear-character-effects-final');
    if (!trinketCard || !outfitCard || !finalCard) {
      trinketCard = makeCard('trinkets', 'Trinket effects'); // First card in the left-rail stat list, before Outfit and Final Values.
      outfitCard = makeCard('outfit', 'Outfit effects');
      finalCard = makeCard('final', 'Final values');
      panel.replaceChildren(trinketCard, outfitCard, finalCard);
    }
    return { panel, trinketCard, outfitCard, finalCard };
  }

  function formatMultiplier(value) {
    const rounded = Math.round(finite(value, 1) * 100) / 100;
    return Number.isInteger(rounded) ? rounded.toFixed(1) : String(rounded);
  }

  function formatNumber(value) {
    const rounded = Math.round(finite(value, 0) * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  }

  function rowSpec(label, value, title = '', literal = false, tone = '') {
    return { label, value, title, literal, tone }; // Compact immutable-like row description consumed by renderRows below.
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
      if (row.classList.contains('literal') !== !!spec.literal) row.classList.toggle('literal', !!spec.literal); // Avoid a redundant class rewrite on each 1 Hz stat refresh.
      for (const tone of ['bonus', 'penalty', 'neutral', 'empty']) {
        const active = spec.tone === tone; // Changes the benefit/drawback class only when the relevant trinket result changes.
        if (row.classList.contains(tone) !== active) row.classList.toggle(tone, active);
      }
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
      const trinketHeading = ui.trinketCard.querySelector('.gear-loadout-heading'); // Shows current Attunement without a second read of saved equipment.
      const headingText = 'Trinket effects · ' + snapshot.trinkets.used + '/' + snapshot.trinkets.capacity; // Only rewrite Attunement heading when the displayed value changes.
      if (trinketHeading && trinketHeading.textContent !== headingText) trinketHeading.textContent = headingText;
      renderRows(ui.trinketCard.querySelector('.gear-effects-list'), snapshot.trinkets.rows);

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
      trinkets: lastSnapshot?.trinkets ? { ...lastSnapshot.trinkets, rows: lastSnapshot.trinkets.rows.map(row => ({ ...row })) } : null, // Mobile diagnostics include exactly the displayed combined bonuses.
      final: lastSnapshot?.final ? { ...lastSnapshot.final } : null,
      lastError,
    };
  }

  window.InventoryCharacterEffects = Object.freeze({
    version: VERSION,
    refresh,
    snapshot: () => composeSnapshot(),
    debugSnapshot,
    __test: Object.freeze({ composeSnapshot, composeTrinketEffects, BASE_DODGE_PROFILE }),
  });
  window.__inventoryCharacterEffectsDebug = debugSnapshot;

  if (typeof document !== 'undefined') start();
})();