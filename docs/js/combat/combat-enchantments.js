// Weapon Enchantments + Immundanity.
//
// This module owns only enchantment definitions/persistence and cross-cutting
// effects. Individual combat abilities remain authoritative for whether a
// Combo/Quick/Held/Flurry/Defensive trigger actually qualified; they publish
// those facts through CombatAttackEvents.
(() => {
  'use strict';

  const PLANES = Object.freeze(['Tothal', 'Hronal', 'Kanthic', 'Ohthic', 'Fey']); // VFX/selection origins: Fey is neutral and is excluded from the two Immundanity opposition pairs.
  const BASE_LIMIT = 2; // Used by equipBase() and the loadout UI; weapons never receive a third active Base enchantment.
  const FLURRY_FLOURISH_NUMERIC_MULTIPLIER = 0.25; // Scales numerical per-hit Flourishes on Flurry.
  const FLURRY_FLOURISH_PROC_CHANCE = 0.25; // Proc chance for instantaneous/duration Flourishes on each successful Flurry hit.
  const ENCHANTMENT_POWER_PER_IMMUNDANITY = 0.10; // +10% numerical enchantment power per uncancelled planar point.
  const MASTERY_POWER_LOSS_PER_IMMUNDANITY = 0.10; // -10% mastery-derived effect power per uncancelled planar point.

  const TUNING = Object.freeze({
    FLURRY_FLOURISH_NUMERIC_MULTIPLIER,
    FLURRY_FLOURISH_PROC_CHANCE,
    ENCHANTMENT_POWER_PER_IMMUNDANITY,
    MASTERY_POWER_LOSS_PER_IMMUNDANITY,

    SICCED_DURATION_S: 8, // Used as the transient target-lock lifetime for Sicced.
    SICCED_COMPANION_POWER_BONUS: 0.60, // Multiplies the companion's complete offensive output against its active Sicced target.

    FURIOUS_STAMINA_AMOUNT: 14, // Enhanced Stamina granted by one Fury Flourish.
    FURIOUS_ATTACK_SPEED_MULTIPLIER: 3, // Charge/flurry progress multiplier only while Furious Stamina actually funds that segment.
    MORALIZED_STAMINA_AMOUNT: 12, // Enhanced Stamina granted by Moralized.
    RESOLUTE_FOOTING_AMOUNT: 12, // Enhanced Footing granted by Resolve.
    RESOLUTE_HEALTH_AMOUNT: 12, // Enhanced Health granted by Resolve.
    ENHANCED_RESOURCE_EFFECTIVE_RATIO: 3, // Moralized/Resolute points each pay for three ordinary points.

    BURNING_APPLICATION: 3.5, // Burning Health buildup from the Base Burning enchantment.
    FROSTBITTEN_APPLICATION: 3.5, // Frostbitten Stamina buildup from the Base Frostbitten enchantment.
    MIRRORED_HEALTH_RATIO: 1, // Mirrored Health gained per actual post-mitigation Health damage dealt.
    SPIRIT_HEAL_SELF_RATIO: 0.05, // Ordinary Health restored to the wielder per actual damage dealt.
    SPIRIT_HEAL_ALLY_RATIO: 0.15, // Full ordinary Health recovery for each eligible ally.
    SPIRIT_HEAL_RADIUS_TILES: 12, // Same-area ally recovery radius centered on the wielder.

    LIVING_FLAME_ENEMY_BURNING_APPLICATION: 8, // Meaningful target Burning Health buildup per successful hit.
    LIVING_FLAME_SELF_KINDLING_APPLICATION: 5, // Kindling Health applied to the wielder per successful hit.
    LIVING_FLAME_KINDLING_TICK_PER_SEC: 0.75, // Slower than Bleeding Health's default 5 points/sec.
    LIVING_FLAME_KINDLING_CONVERSION_CHANCE: 0.12, // Additional Kindling applications can ignite the whole stack.
    LIVING_FLAME_ROLL_TRANSFER_MULTIPLIER: 3,
    LIVING_FLAME_ROLL_TRANSFER_RADIUS_TILES: 1.75,

    LIVING_GUST_KNOCKBACK_MULTIPLIER: 1.25,
    LIVING_GUST_CONE_MULTIPLIER: 1.50,
    LIVING_GUST_PERIPHERAL_KNOCKBACK_MULTIPLIER: 0.50,
    LIVING_GUST_LUNGE_MULTIPLIER: 1.25,
    LIVING_GUST_SELF_FOOTING_COST: 8,
    LIVING_GUST_PRONE_OFFENSE_MULTIPLIER: 3,
  });

  const DEFINITIONS = Object.freeze({
    sicced: Object.freeze({
      id: 'sicced', displayName: 'Sicced', type: 'Flourish', alignment: 'Kanthic',
      icon: '🐾', flurryBehavior: 'proc',
      scalable: Object.freeze({ companionPower: true }),
      description: 'Marks the struck enemy as the animal companion’s exclusive target and empowers the companion against it.',
    }),
    fury: Object.freeze({
      id: 'fury', displayName: 'Fury', type: 'Flourish', alignment: 'Hronal',
      icon: '🔥', flurryBehavior: 'proc',
      scalable: Object.freeze({ amount: true }),
      allowedSlots: Object.freeze(['tap1', 'tap2']),
      description: 'Combo finishers and qualifying Quick Attacks grant Furious Stamina. Offensive Held attacks snapshot +2% speed per point (up to +200%) before spending it.',
    }),
    moralized: Object.freeze({
      id: 'moralized', displayName: 'Moralized', type: 'Flourish', alignment: 'Tothal',
      icon: '✦', flurryBehavior: 'proc',
      scalable: Object.freeze({ amount: true }),
      description: 'Grants Moralized Stamina; each point pays three points of Stamina cost or drain.',
    }),
    resolve: Object.freeze({
      id: 'resolve', displayName: 'Resolve', type: 'Flourish', alignment: 'Ohthic',
      icon: '◆', flurryBehavior: 'proc',
      scalable: Object.freeze({ amount: true }),
      description: 'Grants Resolute Footing and Resolute Health; each enhanced point absorbs three ordinary points.',
    }),
    burning: Object.freeze({
      id: 'burning', displayName: 'Burning', type: 'Base', alignment: 'Hronal',
      icon: '🔥', scalable: Object.freeze({ amount: true }),
      description: 'Every successful hit applies Burning Health.',
    }),
    frostbitten: Object.freeze({
      id: 'frostbitten', displayName: 'Frostbitten', type: 'Base', alignment: 'Tothal',
      icon: '❄', scalable: Object.freeze({ amount: true }),
      description: 'Every successful hit applies Frostbitten Stamina.',
    }),
    mirrored: Object.freeze({
      id: 'mirrored', displayName: 'Mirrored', type: 'Base', alignment: 'Kanthic',
      icon: '◈', scalable: Object.freeze({ amount: true }),
      description: 'Actual Health damage dealt grants an equal amount of Mirrored Health.',
    }),
    spiritHeal: Object.freeze({
      id: 'spiritHeal', displayName: 'Spirit Heal', type: 'Base', alignment: 'Ohthic',
      icon: '♡', scalable: Object.freeze({ amount: true }),
      description: 'Restores 5% of actual Health damage to the wielder and 15% independently to each nearby living ally within 12 tiles. Values scale with Immundanity.',
    }),
    livingFlame: Object.freeze({
      id: 'livingFlame', displayName: 'Living Flame', type: 'Base', alignment: 'Hronal',
      icon: '♨', scalable: Object.freeze({ burningAmount: true, kindlingAmount: true }),
      description: 'Hits burn enemies and kindle the wielder. Rolling away Burning throws three times the cured fire into nearby enemies.',
    }),
    livingGust: Object.freeze({
      id: 'livingGust', displayName: 'Living Gust', type: 'Base', alignment: 'Tothal',
      icon: '〰', scalable: Object.freeze({ selfFootingCost: true }),
      description: 'Strengthens knockback and lunges, widens a knockback-only gust cone, and rewards attacks that topple their wielder.',
    }),
    stormwake: Object.freeze({
      id: 'stormwake', displayName: 'Windblown', type: 'Base', alignment: 'Tothal',
      icon: '🌊', scalable: Object.freeze({ amount: true }),
      hitAffliction: Object.freeze({ id: 'windblownStamina', amount: 6 }),
      description: 'Each hit adds 6 Windblown Stamina and changes the world-space wind direction. The wind adds movement up to 50% of available speed on the ground or 75% in midair at 100 points; moving with it costs Footing (50% more in midair), moving against it slows travel. Naturally fades. Values scale with Immundanity.',
    }),
    stonebind: Object.freeze({
      id: 'stonebind', displayName: 'Leadbound', type: 'Base', alignment: 'Hronal',
      icon: '⛰', scalable: Object.freeze({ amount: true }),
      hitAffliction: Object.freeze({ id: 'leadboundStamina', amount: 5 }),
      description: 'Each hit adds 5 Leadbound Stamina. Movement speed, dodge speed and lunge distance fall by 0.75% per point, up to 75%. Ordinary Stamina expenditure removes it first; it also naturally recovers. Values scale with Immundanity.',
    }),
    soulweight: Object.freeze({
      id: 'soulweight', displayName: 'Soulweight', type: 'Base', alignment: 'Kanthic',
      icon: '◉', scalable: Object.freeze({ amount: true }),
      hitAffliction: Object.freeze({ id: 'soulweightedHealth', amount: 6 }),
      description: 'Each hit adds 6 Soulweighted Health. Subsequent direct Health loss discharges Soulweight into equal ordinary Stamina loss, without creating Exhaustion. Values scale with Immundanity.',
    }),
    ancestralSight: Object.freeze({
      id: 'ancestralSight', displayName: 'Weightless', type: 'Base', alignment: 'Ohthic',
      icon: '◈', scalable: Object.freeze({ amount: true }),
      grantAffliction: Object.freeze({ id: 'weightlessStamina', amount: 5 }),
      description: 'Each successful hit grants the wielder 5 Weightless Stamina. Movement, dodge speed and lunge distance gain +2% per point, up to +200%. It naturally fades and is spent last.'
    }),
    stormRenewal: Object.freeze({
      id: 'stormRenewal', displayName: 'Storm Renewal', type: 'Flourish', alignment: 'Tothal',
      icon: '↻', flurryBehavior: 'numeric', scalable: Object.freeze({ amount: true }),
      grantAffliction: Object.freeze({ id: 'currentStamina', amount: 8 }),
      description: 'Grants 8 Current Stamina, usable exclusively for dodge costs at two ordinary Stamina per point. Values scale with Immundanity; Flurry hits grant one quarter.',
    }),
    bedrock: Object.freeze({
      id: 'bedrock', displayName: 'Tempered', type: 'Flourish', alignment: 'Hronal',
      icon: '◆', flurryBehavior: 'numeric', scalable: Object.freeze({ amount: true }),
      grantAffliction: Object.freeze({ id: 'temperedFooting', amount: 10 }),
      description: 'Grants 10 Tempered Footing. Each point increases Attack Power (affliction buildup) by 2%, up to +200%. Each point absorbs one Footing damage; it does not naturally decay. Values scale with Immundanity; Flurry hits grant one quarter.',
    }),
    blackBargain: Object.freeze({
      id: 'blackBargain', displayName: 'Black Bargain', type: 'Flourish', alignment: 'Kanthic',
      icon: '☾', flurryBehavior: 'numeric', scalable: Object.freeze({ amount: true }),
      grantAffliction: Object.freeze({ id: 'pactHealth', amount: 8 }),
      description: 'Grants 8 Pact Health, which absorbs two direct Health damage per point. Every point spent adds one Soulweighted Health to the wielder. Values scale with Immundanity; Flurry hits grant one quarter.',
    }),
    ancestralMercy: Object.freeze({
      id: 'ancestralMercy', displayName: 'Unshackled', type: 'Flourish', alignment: 'Ohthic',
      icon: '✧', flurryBehavior: 'numeric', scalable: Object.freeze({ amount: true }),
      allowedSlots: Object.freeze(['tap2', 'hold1', 'hold2']),
      grantAffliction: Object.freeze({ id: 'unshackledStamina', amount: 8 }),
      description: 'Quick and Held Flourishes grant 8 Unshackled Stamina. Combo attacks snapshot +2% speed per point (up to +200%) before spending it. Flurry grants one quarter.'
    }),
    feyDementedStamina: Object.freeze({
      id: 'feyDementedStamina', displayName: 'Demented Stamina', type: 'Base', alignment: 'Fey',
      icon: '🌀', description: 'Each hit fills Demented Stamina. While afflicted, every Stamina point spent cumulatively twists perceived movement direction one degree, eased across the action.',
    }),
    feyPanickedStamina: Object.freeze({
      id: 'feyPanickedStamina', displayName: 'Panicked Stamina', type: 'Base', alignment: 'Fey',
      icon: '⚡', description: 'Each hit fills Panicked Stamina. The next dodge burns the entire reserve IN ADDITION to its normal cost, gaining 10% travel per point; allies and walls can be struck.',
    }),
    feyTurnabout: Object.freeze({
      id: 'feyTurnabout', displayName: 'False Bearing', type: 'Base', alignment: 'Fey',
      icon: '↻', description: 'Every successful hit has a seeded 10% chance to rotate the target 180°.',
    }),
    feyHypedPulse: Object.freeze({
      id: 'feyHypedPulse', displayName: 'Hyped Pulse', type: 'Flourish', alignment: 'Fey',
      icon: '✦', flurryBehavior: 'proc', description: 'A qualifying hit grants Hyped Stamina to the wielder. Spending it on attacks produces a fast second impact worth 2% per Hyped point.',
    }),
    feyDreadPulse: Object.freeze({
      id: 'feyDreadPulse', displayName: 'Panic Surge', type: 'Flourish', alignment: 'Fey',
      icon: '☾', flurryBehavior: 'proc', description: 'A qualifying strike adds a stronger burst of Panicked Stamina, making the target’s next dodge dangerous.',
    }),
  });

  const LEGACY_FEY_IDS = Object.freeze({
    feyPhantomWound: 'feyDementedStamina',
    feyFalseBleeding: 'feyPanickedStamina',
    feyNeedlePain: 'feyTurnabout',
    feyMazeStep: 'feyHypedPulse',
    feyEchoDread: 'feyDreadPulse',
  }); // Migrates previously obtained Fey weapons and learned enchantments without deleting their unlock progress.
  const migratedId = id => LEGACY_FEY_IDS[id] || id;

  // Persisted as gearInventory.weaponEnchantments = {weaponKey:{base:[id...],flourishes:{slotId:id}}}
  // (character-scoped, saved by game.js's saveGearInventory like toolPlating).
  // fallbackByWeapon only backs isolated tests/tools that have no gear.
  let fallbackByWeapon = {};
  const fallbackUnlockHolder = {}; // Same role as fallbackByWeapon, for Garanki unlocks.
  const recentEvents = []; // Mobile-readable bounded enchantment event log shown in the Loadout panel.
  const siccedTargets = new Set(); // Runtime target refs whose Sicced duration has not yet expired.
  let currentSiccedTarget = null; // Most recently applied living Sicced target; companion AI is steered toward this one first.
  let lastUiWeaponKey = null; // Used only to avoid stale diagnostics when the equipped tool changes.
  let lastLoggedSiccedTarget = null; // Used only to log automatic Sicced fallback retargets once.
  let initialized = false; // Prevents duplicate event listener installation.

  const nowMs = () => performance.now();
  const rnd = () => window.GameRandom?.random?.() ?? Math.random();

  function logEvent(message) {
    recentEvents.push({ at: Date.now(), message: String(message || '') });
    if (recentEvents.length > 24) recentEvents.splice(0, recentEvents.length - 24);
    window.__farmLog?.(`[enchantments] ${message}`, 'info', 'combat');
  }

  function weaponKey() {
    return window.Combat?.deps?.currentWeaponKey?.() || 'none';
  }

  function allowsFlourishSlot(id, slotId) {
    const def = DEFINITIONS[id]; // Fixed slot families correspond to Combo, Quick and Held abilities.
    return def?.type === 'Flourish' && (!def.allowedSlots || def.allowedSlots.includes(slotId));
  }

  function cleanWeaponState(raw) {
    const base = Array.isArray(raw?.base)
      ? [...new Set(raw.base.map(migratedId).filter(id => DEFINITIONS[id]?.type === 'Base'))].slice(0, BASE_LIMIT)
      : [];
    const flourishes = {};
    for (const slotId of window.Combat?.loadout?.SLOT_IDS || ['tap1','tap2','hold1','hold2']) {
      const id = migratedId(raw?.flourishes?.[slotId]);
      if (DEFINITIONS[id]?.type === 'Flourish') flourishes[slotId] = id;
    }
    return { base, flourishes };
  }

  function gear() {
    return window.Combat?.deps?.getGearInventory?.() || null;
  }

  // Normalizes whatever gearInventory currently holds (old saves: nothing).
  function store() {
    const g = gear();
    if (!g) return fallbackByWeapon;
    if (!g.weaponEnchantments || typeof g.weaponEnchantments !== 'object' || Array.isArray(g.weaponEnchantments)) g.weaponEnchantments = {};
    return g.weaponEnchantments;
  }

  function stateFor(key = weaponKey(), create = false) {
    const enemyState = window.BanditCaptainArmaments?.unlootedEnchantmentState?.(key); // Living enemy magic is not player gear and must never unlock a recipe or enchantment by spawning.
    if (enemyState) return enemyState;
    const all = store();
    if (all[key]) all[key] = cleanWeaponState(all[key]);
    if (!all[key] && create) all[key] = { base: [], flourishes: {} };
    return all[key] || { base: [], flourishes: {} };
  }

  function serialize() {
    return JSON.parse(JSON.stringify(store()));
  }

  // Replaces the whole weapon→enchantment map (tests / explicit imports).
  function load(saved) {
    const all = store();
    for (const key of Object.keys(all)) delete all[key];
    if (saved && typeof saved === 'object') {
      for (const [key, raw] of Object.entries(saved)) {
        const clean = cleanWeaponState(raw);
        if (clean.base.length || Object.keys(clean.flourishes).length) all[key] = clean;
      }
    }
    renderLoadoutUiIfPresent();
  }

  function persist() {
    window.Combat?.deps?.saveGearInventory?.();
  }

  // ── Garanki Gabu unlocks ────────────────────────────────────────
  // gearInventory.enchantmentUnlocks = { base:{id:true}, flourish:{'id@slot':true} }.
  // A Base enchantment unlocks by id; a Flourish unlocks per (id, loadout
  // slot) permutation, so a Sicced tap1 relic does not also teach Sicced hold2.
  function unlockStore() {
    const target = gear() || fallbackUnlockHolder;
    if (!target.enchantmentUnlocks || typeof target.enchantmentUnlocks !== 'object') target.enchantmentUnlocks = {};
    const u = target.enchantmentUnlocks;
    if (!u.base || typeof u.base !== 'object') u.base = {};
    if (!u.flourish || typeof u.flourish !== 'object') u.flourish = {};
    for (const [legacy, modern] of Object.entries(LEGACY_FEY_IDS)) {
      if (u.base[legacy]) u.base[modern] = true; // Keeps existing Garanki unlocks for old Base enchantments.
      for (const slot of window.Combat?.loadout?.SLOT_IDS || ['tap1','tap2','hold1','hold2']) {
        if (u.flourish[`${legacy}@${slot}`]) u.flourish[`${modern}@${slot}`] = true; // Keeps each previously learned Flourish slot.
      }
    }
    return u;
  }

  const flourishUnlockKey = (id, slotId) => `${id}@${slotId}`;

  function isBaseUnlocked(id) {
    return DEFINITIONS[id]?.type === 'Base' && unlockStore().base[id] === true;
  }

  function isFlourishUnlocked(id, slotId) {
    return DEFINITIONS[id]?.type === 'Flourish' && unlockStore().flourish[flourishUnlockKey(id, slotId)] === true;
  }

  // Unlocks everything present on an enchantment state (e.g. an unbound
  // relic). Returns the list of newly learned labels for the UI toast.
  function unlockFromState(raw, options = {}) {
    const clean = cleanWeaponState(raw);
    const u = unlockStore();
    const learned = [];
    for (const id of clean.base) {
      if (u.base[id]) continue;
      u.base[id] = true;
      learned.push(DEFINITIONS[id].displayName);
    }
    for (const [slotId, id] of Object.entries(clean.flourishes)) {
      const k = flourishUnlockKey(id, slotId);
      if (u.flourish[k]) continue;
      u.flourish[k] = true;
      learned.push(`${DEFINITIONS[id].displayName} (${slotId.toUpperCase()} Flourish)`);
    }
    if (learned.length) {
      if (options.deferSave !== true) persist(); // Garanki's gear/member transaction persists its entire learned batch in one write.
      if (options.deferSave !== true) logEvent(`Garanki learned: ${learned.join(', ')}`); // Only report committed normal operations.
    }
    return learned;
  }

  function unlockedOptions() {
    const u = unlockStore();
    return {
      base: Object.keys(u.base).filter(id => u.base[id] && DEFINITIONS[id]?.type === 'Base'),
      flourish: Object.keys(u.flourish).filter(k => u.flourish[k]).map(k => {
        const [id, slotId] = k.split('@');
        return DEFINITIONS[id]?.type === 'Flourish' ? { id, slotId } : null;
      }).filter(Boolean),
    };
  }

  // Rejects rather than silently dropping: the caller learns a third Base
  // enchantment is illegal instead of having one quietly vanish.
  function equipBase(key, slotIndex, enchantmentId, options = {}) {
    const current = stateFor(key).base;
    if (enchantmentId && Math.floor(Number(slotIndex) || 0) >= BASE_LIMIT) return false;
    if (enchantmentId && current.includes(enchantmentId) && current[Math.floor(Number(slotIndex) || 0)] !== enchantmentId) return false; // The same Base enchantment twice on one weapon is not a second enchantment.
    const index = Math.max(0, Math.min(BASE_LIMIT - 1, Math.floor(Number(slotIndex) || 0)));
    const def = DEFINITIONS[enchantmentId];
    if (enchantmentId && def?.type !== 'Base') return false;
    const state = stateFor(key, true);
    const next = state.base.slice(0, BASE_LIMIT);
    if (!enchantmentId) {
      next.splice(index, 1);
    } else {
      while (next.length < index) next.push(null);
      next[index] = enchantmentId;
    }
    state.base = next.filter(Boolean).slice(0, BASE_LIMIT);
    if (options.deferSave !== true) persist(); // Deferred only for a validated combined gear/member transaction.
    if (options.deferSave !== true && def?.alignment === 'Fey' && gear()?.tools?.[key]) window.FeyArmamentQuest?.maybeStart?.(); // An owned ordinary weapon gaining Fey magic also starts the one-time investigation.
    return true;
  }

  // Appends into the first free Base slot; false when both are taken.
  function addBase(key, enchantmentId, options = {}) {
    return equipBase(key, stateFor(key).base.length, enchantmentId, options);
  }

  function setFlourish(key, slotId, enchantmentId, options = {}) {
    if (!(window.Combat?.loadout?.SLOT_IDS || ['tap1','tap2','hold1','hold2']).includes(slotId)) return false;
    const def = DEFINITIONS[enchantmentId];
    if (enchantmentId && !allowsFlourishSlot(enchantmentId, slotId) && !(options.importLegacySlot === true && def?.type === 'Flourish')) return false; // Only an already-owned bound relic may import a now-inactive legacy slot.
    const state = stateFor(key, true);
    if (enchantmentId) state.flourishes[slotId] = enchantmentId;
    else delete state.flourishes[slotId];
    if (options.deferSave !== true) persist(); // Garanki commits the entire transaction once after mutation.
    if (options.deferSave !== true && def?.alignment === 'Fey' && gear()?.tools?.[key]) window.FeyArmamentQuest?.maybeStart?.(); // Flourish-only Fey equipment follows the same acquisition rule.
    return true;
  }

  function activeDefinitions(key = weaponKey()) {
    const state = stateFor(key);
    const ids = [...state.base, ...Object.entries(state.flourishes).filter(([slot, id]) => allowsFlourishSlot(id, slot)).map(([, id]) => id)].filter(Boolean);
    return ids.map(id => DEFINITIONS[id]).filter(Boolean);
  }

  function getWeaponImmundanity(input = weaponKey()) {
    const key = typeof input === 'string' ? input : input?.key || input?.id || weaponKey();
    const counts = { Tothal: 0, Hronal: 0, Kanthic: 0, Ohthic: 0 };
    for (const def of activeDefinitions(key)) if (counts[def.alignment] != null) counts[def.alignment]++; // Fey does not have an opposed Immundanity count.
    return Math.abs(counts.Tothal - counts.Hronal) + Math.abs(counts.Kanthic - counts.Ohthic);
  }

  function planarCounts(key = weaponKey()) {
    const counts = { Tothal: 0, Hronal: 0, Kanthic: 0, Ohthic: 0, Fey: 0 }; // Tracks the neutral origin for effects/presentation without adding it to opposed planar totals.
    for (const def of activeDefinitions(key)) if (counts[def.alignment] != null) counts[def.alignment]++;
    return counts;
  }

  function getEnchantmentPowerMultiplier(input = weaponKey()) {
    return 1 + getWeaponImmundanity(input) * ENCHANTMENT_POWER_PER_IMMUNDANITY;
  }

  function getMasteryPowerMultiplier(input = weaponKey()) {
    return Math.max(0, 1 - getWeaponImmundanity(input) * MASTERY_POWER_LOSS_PER_IMMUNDANITY);
  }

  function hasBase(id, key = weaponKey()) {
    return stateFor(key).base.includes(id);
  }

  function flourishForSlot(slotId, key = weaponKey()) {
    return stateFor(key).flourishes?.[slotId] || null;
  }

  function fullChargeThresholdSatisfied(event) {
    // Charged Breaker owns the real threshold: its full pose is gameplay 100%.
    // Do not duplicate a second authored percentage. Other future held attacks
    // can publish fullCharge directly from their own authority.
    return event.fullCharge === true;
  }

  function flourishQualifies(event) {
    switch (event.attackCategory) {
      case 'combo': return event.comboFinisher === true;
      case 'quickAttack': return event.quickBonusEffectProc === true;
      case 'offensiveHold':
        if (event.isFlurry) return true;
        return fullChargeThresholdSatisfied(event);
      default: return false;
    }
  }

  function scaled(def, key, baseValue, property, power = null) {
    return Number(baseValue) * (def.scalable?.[property] ? (power ?? getEnchantmentPowerMultiplier(key)) : 1);
  }

  function applyEnhanced(entity, id, amount, reason) {
    const added = window.ResourceSystem?.addEnhancedResource?.(entity, id, amount, { reason })
      ?? window.ResourceSystem?.addAffliction?.(entity, id, amount)
      ?? 0;
    return added;
  }

  function resolveAllies(attacker) {
    // Current single-player architecture has one player + companion actors.
    // Keep this centralized so future party/allied-player plumbing can add
    // recipients without changing individual Flourish handlers.
    const out = [attacker].filter(Boolean);
    for (const actor of window.Combat?.deps?.companionObjects || []) {
      if (!livingActor(actor) || actor.stableRole === 'shoulderPet') continue;
      if ((actor.master || window.Combat?.deps?.player) === attacker) out.push(actor); // An unowned/player pet must never inherit a hostile attacker's Flourish.
    }
    return out;
  }

  // Spirit Heal uses a separate recipient scope: existing Flourishes retain their original behavior.
  function applySpiritHeal(event, power) {
    const { attacker, target, actualDamage } = event; // The resolved hit owns the healing budget.
    const deps = window.Combat?.deps; // Live actor collections and local-area authority.
    const registry = window.ActorRegistry; // Live co-op roster and authoritative area lookup.
    const resources = window.ResourceSystem; // Ordinary recovery respects effective maxima and healing penalties.
    if (!livingActor(attacker) || !Number.isFinite(actualDamage) || !(actualDamage > 0) || !(power > 0) || !resources?.applyHealthRecovery) return;
    const isPlayer = actor => !!actor && (actor === deps?.player || registry?.isPlayer?.(actor) === true); // Null ownership never qualifies as a co-op player.
    const canHeal = actor => livingActor(actor) && !actor._inCutscene && !actor.rec?.dead && !actor.rec?.deceased
      && !(actor === deps?.player && window.PlayerDowned?.isDowned?.());
    if (!canHeal(attacker) || !target || target === attacker) return;
    const areaOf = actor => (actor === deps?.player ? deps?.getCurrentArea?.() : null) ?? registry?.areaOf?.(actor) ?? actor.areaId; // Local area authority wins over a stale avatar areaId.
    const area = areaOf(attacker); // Never heal across map boundaries.
    const radius = TUNING.SPIRIT_HEAL_RADIUS_TILES * (Number(deps?.TILE) || 0); // Squared range avoids square roots on recipient checks.
    const radiusSq = radius * radius;
    const amount = actualDamage * power; // One Immundanity calculation already supplied by onHit.
    let restored = Math.max(0, resources.applyHealthRecovery(attacker, amount * TUNING.SPIRIT_HEAL_SELF_RATIO));
    let allyCount = 0; // Counts actual positive ally recoveries for the mobile event log.
    const seen = new Set([attacker, target]); // Prevent duplicate healing and never heal the struck victim.
    const playerSide = isPlayer(attacker); // Only registered co-op players share a party; hostile NPCs never heal that party.
    function healAlly(actor) {
      if (seen.has(actor) || !canHeal(actor) || actor.stableRole === 'shoulderPet' || area == null || areaOf(actor) !== area || !(radius > 0)) return;
      const dx = actor.x - attacker.x, dy = actor.y - attacker.y; // Horizontal world coordinates shared by combat.
      if (!Number.isFinite(dx) || !Number.isFinite(dy) || dx * dx + dy * dy > radiusSq) return;
      seen.add(actor);
      const healed = resources.applyHealthRecovery(actor, amount * TUNING.SPIRIT_HEAL_ALLY_RATIO); // Full amount per ally, never split.
      if (healed > 0) { restored += healed; allyCount++; }
    }
    if (playerSide) {
      healAlly(deps?.player);
      for (const actor of registry?.getPlayers?.() || []) healAlly(actor);
    }
    for (const actor of deps?.companionObjects || []) {
      const owner = registry?.ownerOf?.(actor) || actor.master || (actor.banditCompanion ? null : deps?.player); // Preserve legacy ownership fallback only for non-hostile pets.
      if (playerSide && actor.banditCompanion) continue; // A malformed hostile-pet owner must not turn it into a party ally.
      if (owner === attacker || (playerSide && isPlayer(owner))) healAlly(actor);
    }
    if (playerSide) {
      for (const actor of deps?.hostileObjects || []) {
        // Neutral tribe combatants actively fighting this very opponent are temporary allies, not all neutral wildlife.
        if ((actor.isTribeHunter || actor.isPorakanekiHunter) && actor._porakanekiPlannerControlled === true && actor._chunkCombatTarget === target) healAlly(actor);
      }
    }
    if (restored > 0) logEvent(`Spirit Heal restored ${Math.round(restored * 10) / 10} Health (${allyCount} allies)`);
  }

  // Projectile impacts use this narrow adapter because they do not publish melee attack events.
  function applyRangedSpiritHeal(attacker, target, weaponKey, actualDamage) {
    if (!weaponKey || !Number.isFinite(actualDamage) || !(actualDamage > 0) || !hasBase('spiritHeal', weaponKey)) return;
    applySpiritHeal({ attacker, target, actualDamage }, getEnchantmentPowerMultiplier(weaponKey));
  }

  function applySicced(event, def, power) {
    const target = event.target;
    if (!validSiccedTarget(target)) return;
    target._siccedUntilMs = Math.max(Number(target._siccedUntilMs) || 0, nowMs() + TUNING.SICCED_DURATION_S * 1000);
    target._siccedCompanionPowerMul = 1 + TUNING.SICCED_COMPANION_POWER_BONUS * power;
    siccedTargets.add(target);
    currentSiccedTarget = target; // Newest application always becomes the exclusive target, even if an older Sicced enemy still lives.
    lastLoggedSiccedTarget = target;
    logEvent(`Applied Sicced to ${targetName(target)}`);
  }

  function targetName(target) {
    return target?.name || target?.def?.label || target?.creatureKey || 'enemy';
  }

  function applyFury(event, def, power) {
    const amount = scaled(def, event.weaponKey, TUNING.FURIOUS_STAMINA_AMOUNT, 'amount');
    for (const ally of resolveAllies(event.attacker)) applyEnhanced(ally, 'furiousStamina', amount, 'Fury Flourish');
    logEvent(`Fury granted ${Math.round(amount * 10) / 10} Furious Stamina`);
  }

  function applyMoralized(event, def, power) {
    const amount = scaled(def, event.weaponKey, TUNING.MORALIZED_STAMINA_AMOUNT, 'amount');
    for (const ally of resolveAllies(event.attacker)) applyEnhanced(ally, 'moralizedStamina', amount, 'Moralized Flourish');
    logEvent(`Moralized granted ${Math.round(amount * 10) / 10} Moralized Stamina`);
  }

  function applyResolve(event, def, power) {
    const footing = scaled(def, event.weaponKey, TUNING.RESOLUTE_FOOTING_AMOUNT, 'amount');
    const health = scaled(def, event.weaponKey, TUNING.RESOLUTE_HEALTH_AMOUNT, 'amount');
    for (const ally of resolveAllies(event.attacker)) {
      applyEnhanced(ally, 'resoluteFooting', footing, 'Resolve Flourish');
      applyEnhanced(ally, 'resoluteHealth', health, 'Resolve Flourish');
    }
    logEvent(`Resolve granted ${Math.round(footing * 10) / 10} Resolute Footing + ${Math.round(health * 10) / 10} Resolute Health`);
  }

  function applyFeyFlourish(event, def) {
    // Fey deliberately ignores ordinary positive Immundanity boosts. At a hard zero enchantment-power gate, illusions also fail.
    window.FeyIllusions?.apply?.(def.id, event.target, { weaponKey: event.weaponKey, attacker: event.attacker });
  }
  // Planar effects share one data-driven application path; resource transactions own their unique behavior.
  function livingActor(actor) {
    return !!actor && Number(actor.health) > 0 && !actor._downed && !actor._denHidden && !actor._deathTransitionStarted
      && !(window.RomanceFamily?.isProtectedFamilyChild?.(actor.rec?.id || actor.id) ?? window.RomanceFamily?.isBasketBaby?.(actor.rec?.id || actor.id));
  }

  function applyAttributedAffliction(target, id, amount, attacker) {
    const resource = window.ResourceSystem; // Shared actual buildup and presentation path, retaining compatibility with isolated previews.
    if (resource?.addAttackAffliction) return resource.addAttackAffliction(target, id, amount, { attacker });
    return resource?.addAffliction?.(target, id, amount) || 0;
  }

  function applyRealmHitAffliction(event, def, power) {
    if (!livingActor(event.target) || !(power > 0)) return false;
    const effect = def.hitAffliction; // Authored reserve amount, scaled by weapon Immundanity.
    if (!effect) return false;
    const added = applyAttributedAffliction(event.target, effect.id, effect.amount * power, event.attacker);
    if (!(added > 0)) return false;
    logEvent(`${def.displayName}: +${added} ${window.ResourceSystem.AFFLICTIONS[effect.id].name} on ${targetName(event.target)}`);
    return true;
  }

  function applyRealmFlourish(event, def, power) {
    if (!livingActor(event.attacker) || !(power > 0)) return false;
    const effect = def.grantAffliction; // Authored enhanced reserve; Flurry's numerical scale is already included in power.
    if (!effect) return false;
    const added = effect.id === 'weightlessStamina'
      ? (window.ResourceSystem?.addAffliction?.(event.attacker, effect.id, effect.amount * power) || 0) // Bottom-anchored reserve is ordinary Stamina, not an upfront enhanced payment pool.
      : applyEnhanced(event.attacker, effect.id, effect.amount * power, def.displayName);
    if (!(added > 0)) return false;
    logEvent(`${def.displayName}: +${added} ${window.ResourceSystem.AFFLICTIONS[effect.id].name}`);
    return true;
  }

  const FLOURISH_HANDLERS = { sicced: applySicced, fury: applyFury, moralized: applyMoralized, resolve: applyResolve,
    stormRenewal: applyRealmFlourish, bedrock: applyRealmFlourish, blackBargain: applyRealmFlourish, ancestralMercy: applyRealmFlourish,
    feyHypedPulse: applyFeyFlourish, feyDreadPulse: applyFeyFlourish };

  function applyFlourish(event) {
    const id = flourishForSlot(event.slotId, event.weaponKey);
    const def = DEFINITIONS[id];
    if (!allowsFlourishSlot(id, event.slotId) || !flourishQualifies(event)) return false;
    if (id === 'fury' && !['combo', 'quickAttack'].includes(event.attackCategory)) return false;
    if (id === 'ancestralMercy' && !['quickAttack', 'offensiveHold'].includes(event.attackCategory)) return false;

    if (event.isFlurry) {
      if (def.flurryBehavior === 'numeric') {
        event.flourishNumericMultiplier = FLURRY_FLOURISH_NUMERIC_MULTIPLIER;
      } else {
        const roll = rnd();
        const proc = roll < FLURRY_FLOURISH_PROC_CHANCE;
        logEvent(`Flurry Flourish rolled ${roll.toFixed(2)} / ${FLURRY_FLOURISH_PROC_CHANCE.toFixed(2)} → ${proc ? 'PROC' : 'MISS'}`);
        if (!proc) return false;
      }
    }

    const handler = FLOURISH_HANDLERS[id];
    if (!handler) return false;
    const power = getEnchantmentPowerMultiplier(event.weaponKey);
    if (handler(event, def, power * (event.flourishNumericMultiplier || 1)) === false) return false; // No false proc log when a new Flourish cannot apply its effect.
    if (event.attackCategory === 'combo') logEvent('Combo Flourish triggered');
    else if (event.attackCategory === 'quickAttack') logEvent('Quick Attack Flourish triggered');
    else if (event.isFlurry) logEvent('Flurry Flourish triggered');
    else logEvent('Held Flourish triggered');
    return true;
  }

  function prepareLivingGust(context) {
    if (!hasBase('livingGust', context.weaponKey)) return;
    const player = context.attacker;
    const def = DEFINITIONS.livingGust;
    const power = getEnchantmentPowerMultiplier(context.weaponKey);

    context.modifiers.knockback *= 1 + (TUNING.LIVING_GUST_KNOCKBACK_MULTIPLIER - 1) * power;
    context.modifiers.lunge *= 1 + (TUNING.LIVING_GUST_LUNGE_MULTIPLIER - 1) * power;
    context.modifiers.cone *= TUNING.LIVING_GUST_CONE_MULTIPLIER; // Widened value is used only by applyPeripheralGust(), never ordinary hit validity.

    if (player && !context.metadata?.livingGustSelfFootingApplied) {
      const beforeProne = !!player.prone;
      const cost = scaled(def, context.weaponKey, TUNING.LIVING_GUST_SELF_FOOTING_COST, 'selfFootingCost');
      const lost = window.ResourceSystem?.spendFooting?.(player, cost, 'Living Gust self-Footing') || 0;
      // The ordinary prone owner may set prone after spendFooting returns. A
      // zero Footing crossing is therefore authoritative even before that
      // outer owner flips player.prone later in this frame.
      const causedProne = !beforeProne && lost > 0 && Number(player.footing) <= 0;
      context.causedAttackerProne = causedProne;
      context.metadata.livingGustSelfFootingApplied = true;
      context.metadata.livingGustSelfFootingLost = lost;
      if (causedProne) {
        context.modifiers.damage *= TUNING.LIVING_GUST_PRONE_OFFENSE_MULTIPLIER;
        context.modifiers.footingDamage *= TUNING.LIVING_GUST_PRONE_OFFENSE_MULTIPLIER;
        context.modifiers.affliction *= TUNING.LIVING_GUST_PRONE_OFFENSE_MULTIPLIER;
        context.modifiers.knockback *= TUNING.LIVING_GUST_PRONE_OFFENSE_MULTIPLIER;
        logEvent(`Living Gust prone bonus ×${TUNING.LIVING_GUST_PRONE_OFFENSE_MULTIPLIER}`);
      }
    }
  }

  function onPrepare(context) {
    prepareLivingGust(context);
  }

  function onHit(event) {
    const key = event.weaponKey;
    const target = event.target;
    if (!target || target.health <= 0 && !(event.actualDamage > 0)) return;
    const coffin=event.attacker?.ruinWallCoffin===true; // Read actor-local magic, not player gear sharing a crafted item key.
    const baseIds=coffin?(event.attacker.rosterRecord?.enchantedWeapon?.enchantments?.base||[]):stateFor(key).base;
    const alignment=coffin?DEFINITIONS[baseIds[0]]?.alignment:null; // Exactly one Base: one point of Immundanity for a planar enchantment.
    const power=coffin?1+(['Hronal','Tothal','Kanthic','Ohthic'].includes(alignment)?ENCHANTMENT_POWER_PER_IMMUNDANITY:0):getEnchantmentPowerMultiplier(key); // At most two equipped Base IDs; avoids scanning the expanded catalog on every hit.
    for (const id of baseIds) {
      const def = DEFINITIONS[id];
      if (def?.hitAffliction) applyRealmHitAffliction(event, def, power);
      if (def?.grantAffliction) applyRealmFlourish(event, def, power); // Weightless is a self-grant on every Base hit.
    }

    if (baseIds.includes('burning')) {
      applyAttributedAffliction(target, 'burningHealth', scaled(DEFINITIONS.burning, key, TUNING.BURNING_APPLICATION, 'amount', power), event.attacker);
    }
    if (baseIds.includes('frostbitten')) {
      applyAttributedAffliction(target, 'frostbittenStamina', scaled(DEFINITIONS.frostbitten, key, TUNING.FROSTBITTEN_APPLICATION, 'amount', power), event.attacker);
    }
    if (baseIds.includes('mirrored') && event.actualDamage > 0) {
      const amount = scaled(DEFINITIONS.mirrored, key, event.actualDamage * TUNING.MIRRORED_HEALTH_RATIO, 'amount', power);
      applyEnhanced(event.attacker, 'mirroredHealth', amount, 'Mirrored');
    }
    if (baseIds.includes('spiritHeal')) applySpiritHeal(event, power);
    if (baseIds.includes('livingFlame')) {
      const targetBurn = scaled(DEFINITIONS.livingFlame, key, TUNING.LIVING_FLAME_ENEMY_BURNING_APPLICATION, 'burningAmount', power);
      const selfKindling = scaled(DEFINITIONS.livingFlame, key, TUNING.LIVING_FLAME_SELF_KINDLING_APPLICATION, 'kindlingAmount', power);
      applyAttributedAffliction(target, 'burningHealth', targetBurn, event.attacker);
      window.ResourceSystem?.addAffliction?.(event.attacker, 'kindlingHealth', selfKindling);
    }

    for (const id of ['feyDementedStamina', 'feyPanickedStamina', 'feyTurnabout']) {
      if (baseIds.includes(id)) window.FeyIllusions?.apply?.(id, target, { weaponKey: key, attacker: event.attacker });
    }
    if(!event.attacker?.ruinWallCoffin)applyFlourish(event);
  }

  function onDefensive(event) {
    const id = flourishForSlot(event.slotId, event.weaponKey);
    const def = DEFINITIONS[id];
    if (!def || def.type !== 'Flourish' || def.alignment === 'Fey' || !allowsFlourishSlot(id, event.slotId) || id === 'fury' || id === 'ancestralMercy') return false; // Attack-tempo Flourishes require an attack rather than a block; illusory strikes require a real offensive hit; Fey cannot claim a defensive effect it never applied.
    const handler = FLOURISH_HANDLERS[id];
    if (typeof handler !== 'function') return false;
    const power = getEnchantmentPowerMultiplier(event.weaponKey);
    if (handler(event, def, power) === false) return false;
    logEvent(event.defensiveResult === 'block' ? 'Defensive Flourish triggered on block' : 'Defensive Flourish triggered on near-hit dodge');
    return true;
  }

  function validSiccedTarget(target) {
    return !!target && Number(target.health) > 0 && !target._downed && !target._denHidden && !target._deathTransitionStarted; // Explicit marks cannot hold the pet on an unattackable actor.
  }

  function pruneSiccedTargets() {
    const t = nowMs();
    for (const target of siccedTargets) {
      if (!validSiccedTarget(target) || t >= (Number(target._siccedUntilMs) || 0)) siccedTargets.delete(target);
    }
    if (currentSiccedTarget && siccedTargets.has(currentSiccedTarget)) return currentSiccedTarget;
    currentSiccedTarget = null;
    let lowestHealth = Infinity;
    for (const target of siccedTargets) {
      if (target.health > 0 && target.health < lowestHealth) {
        lowestHealth = target.health;
        currentSiccedTarget = target;
      }
    }
    if (currentSiccedTarget && currentSiccedTarget !== lastLoggedSiccedTarget) logEvent(`Companion retargeted Sicced enemy: ${targetName(currentSiccedTarget)}`);
    if (!currentSiccedTarget && lastLoggedSiccedTarget) logEvent('No living Sicced enemy — companion AI resumes');
    lastLoggedSiccedTarget = currentSiccedTarget;
    return currentSiccedTarget;
  }

  function getCurrentSiccedTarget(areaId) {
    const current = pruneSiccedTargets(); // Global newest mark remains authoritative when no area is requested.
    if (areaId == null || current?.areaId === areaId) return current;
    let local = null; // Find a living marked enemy in this area without erasing a still-valid mark in another area.
    for (const target of siccedTargets) if (target.areaId === areaId && (!local || target.health < local.health)) local = target;
    return local;
  }

  function getCompanionTargetPowerMultiplier(companion, target) {
    if (!companion?.isCompanion || companion.banditCompanion || !validSiccedTarget(target) || !siccedTargets.has(target) || nowMs() >= (Number(target._siccedUntilMs) || 0)) return 1;
    return Math.max(1, Number(target._siccedCompanionPowerMul) || 1);
  }

  // Companion AI reads getCurrentSiccedTarget() every frame (game.js
  // updateCompanions); this only exists for debug/tests that want the
  // resolved target without waiting a frame.
  function enforceCompanionTargeting() {
    return getCurrentSiccedTarget();
  }

  function applyPeripheralGust(context, ordinaryHitTargets = new Set()) {
    if (!hasBase('livingGust', context.weaponKey)) return 0;
    const deps = window.Combat?.deps;
    if (!deps || !(context.rangePx > 0) || !(context.halfConeRad > 0)) return 0;
    const widened = context.halfConeRad * TUNING.LIVING_GUST_CONE_MULTIPLIER;
    const strength = Math.max(0, context.knockbackPxS)
      * (1 + (TUNING.LIVING_GUST_KNOCKBACK_MULTIPLIER - 1) * getEnchantmentPowerMultiplier(context.weaponKey))
      * TUNING.LIVING_GUST_PERIPHERAL_KNOCKBACK_MULTIPLIER
      * (window.WeaponShapeStats?.forKey?.(context.weaponKey, deps.getWeaponDefinition?.(context.weaponKey))?.power || 1); // Peripheral knockback bypasses ordinary hit modifiers, so apply shape Power explicitly once.
    let affected = 0;
    for (const target of deps.hostileObjects || []) {
      if (!target || target.health <= 0 || ordinaryHitTargets.has(target) || target.areaId !== deps.getCurrentArea?.()) continue;
      const inWide = deps.inCone?.(context.attacker.x, context.attacker.y, context.metadata?.attackAngle ?? context.attacker.angle, target.x, target.y, context.rangePx, widened);
      const inNormal = deps.inCone?.(context.attacker.x, context.attacker.y, context.metadata?.attackAngle ?? context.attacker.angle, target.x, target.y, context.rangePx, context.halfConeRad);
      if (!inWide || inNormal) continue;

      if (typeof deps.applyKnockback === 'function') {
        deps.applyKnockback(target, context.attacker.x, context.attacker.y, strength, { source: 'living-gust', footingDamageMultiplier: 0, attacker: context.attacker });
      } else if (typeof deps.damageCreature === 'function') {
        // damageCreature is the existing public combat seam that owns knockback.
        // A zero-damage call intentionally asks it for movement only; no Base
        // enchantment hit event is emitted for this peripheral gust.
        deps.damageCreature(target, 0, context.attacker.x, context.attacker.y, strength, {
          tag: 'wind',
          footingDamageMultiplier: 0,
          noAfflictions: true,
          enchantmentPeripheralGust: true,
          attacker: context.attacker,
        });
      }
      affected++;
    }
    return affected;
  }

  function onBurningRollCured(event) {
    const detail = event?.detail || {};
    const wielder = detail.entity;
    const removed = Math.max(0, Number(detail.removed) || 0);
    const deps = window.Combat?.deps;
    if (!deps?.player || wielder !== deps.player || !(removed > 0) || !hasBase('livingFlame')) return;
    const radius = Math.max(0, Number(deps.TILE) || 64) * TUNING.LIVING_FLAME_ROLL_TRANSFER_RADIUS_TILES;
    const amount = removed * TUNING.LIVING_FLAME_ROLL_TRANSFER_MULTIPLIER * getEnchantmentPowerMultiplier();
    for (const target of deps.hostileObjects || []) {
      if (!target || target.health <= 0 || target.areaId !== deps.getCurrentArea?.()) continue;
      if (Math.hypot(target.x - wielder.x, target.y - wielder.y) > radius) continue;
      applyAttributedAffliction(target, 'burningHealth', amount, wielder);
    }
    logEvent(`Living Flame roll transferred ${Math.round(amount * 10) / 10} Burning`);
  }

  function flourishTriggerText(slotId) {
    const abilityId = window.Combat?.loadout?.getSlot?.(slotId);
    const category = window.Combat?.abilities?.get?.(abilityId)?.category;
    if (category === 'combo') return 'Combo Flourish — triggers on Combo III';
    if (category === 'quickAttack') return 'Quick Attack Flourish — triggers with its conditional bonus';
    if (abilityId === 'acceleratingFlurry') return 'Flurry Flourish — reduced/probabilistic per-hit effect';
    if (category === 'offensiveHold') return 'Held Flourish — triggers at full charge';
    if (category === 'defensiveHold') return 'Defensive Flourish — triggers on block or near-hit dodge';
    return 'Flourish — trigger follows this attack slot’s authored condition';
  }

  function definitionOptions(type) {
    return Object.values(DEFINITIONS).filter(def => def.type === type);
  }

  function readOnlyValue(id) {
    const el = document.createElement('div');
    el.className = 'settings-desc';
    const def = DEFINITIONS[id];
    el.textContent = def ? `${def.icon || ''} ${def.displayName} · ${def.alignment}` : '— Empty —';
    if (def) el.title = def.description;
    return el;
  }

  function diagnosticsLines(key = weaponKey()) {
    const state = stateFor(key);
    const counts = planarCounts(key);
    const attunement = window.TrinketSystem?.debugLines?.() || [];
    return [
      `Weapon: ${key}`,
      `Base: ${state.base.map(id => `${id} (${DEFINITIONS[id]?.alignment})`).join(', ') || 'none'}`,
      ...(window.Combat?.loadout?.SLOT_IDS || ['tap1','tap2','hold1','hold2']).map(slot => `${slot} Flourish: ${state.flourishes?.[slot] ? `${state.flourishes[slot]} (${DEFINITIONS[state.flourishes[slot]]?.alignment})` : '—'}`),
      `Tothal ${counts.Tothal} · Hronal ${counts.Hronal} · Kanthic ${counts.Kanthic} · Ohthic ${counts.Ohthic} · Fey ${counts.Fey} (neutral)`,
      `Immundanity: ${getWeaponImmundanity(key)}`,
      `Enchantment power: ×${getEnchantmentPowerMultiplier(key).toFixed(2)}`,
      `Mastery effects: ×${getMasteryPowerMultiplier(key).toFixed(2)}`,
      `Sicced target: ${getCurrentSiccedTarget() ? targetName(getCurrentSiccedTarget()) : 'none'}`,
      ...attunement,
      `Movement compositor: ${JSON.stringify(window.ResourceSystem?.movementDebug?.(window.Combat?.deps?.player) || {})}`,
      '',
      'Recent events:',
      ...recentEvents.slice(-14).map(item => `• ${item.message}`),
    ];
  }

  function renderLoadoutUI(pane, key = weaponKey()) {
    if (!pane || typeof document === 'undefined') return;
    pane.querySelector('.enchantment-loadout-section')?.remove();
    const section = document.createElement('div');
    section.className = 'enchantment-loadout-section';
    section.style.cssText = 'display:flex;flex-direction:column;gap:7px;margin-top:10px;padding-top:9px;border-top:1px solid rgba(255,255,255,.14);';

    const title = document.createElement('div');
    title.className = 'settings-section-title';
    title.textContent = 'Enchantments & Immundanity';
    section.appendChild(title);

    const state = stateFor(key);
    const summary = document.createElement('div');
    summary.className = 'loadout-slot-combo-note';
    summary.textContent = `Immundanity ${getWeaponImmundanity(key)} · Enchantment power ×${getEnchantmentPowerMultiplier(key).toFixed(2)} · Mastery effects ×${getMasteryPowerMultiplier(key).toFixed(2)}`
      + ' · Garanki Gabu applies enchantments';
    section.appendChild(summary);
    for (let i = 0; i < BASE_LIMIT; i++) {
      const row = document.createElement('div');
      row.className = 'loadout-slot';
      const label = document.createElement('div');
      label.className = 'settings-label';
      label.innerHTML = `<div class="settings-name">Base Enchantment ${i + 1}</div><div class="settings-desc">Applies to every qualifying hit made with this weapon.</div>`;
      row.append(label, readOnlyValue(state.base[i]));
      section.appendChild(row);
    }

    for (const slotId of window.Combat?.loadout?.SLOT_IDS || ['tap1','tap2','hold1','hold2']) {
      const row = document.createElement('div');
      row.className = 'loadout-slot';
      const label = document.createElement('div');
      label.className = 'settings-label';
      const ability = window.Combat?.abilities?.get?.(window.Combat?.loadout?.getSlot?.(slotId));
      label.innerHTML = `<div class="settings-name">${slotId.toUpperCase()} Flourish · ${ability?.label || 'Empty'}</div><div class="settings-desc">${flourishTriggerText(slotId)}</div>`;
      row.append(label, readOnlyValue(state.flourishes?.[slotId]));
      section.appendChild(row);
    }

    const imm = getWeaponImmundanity(key);
    const diagnostics = document.createElement('details');
    diagnostics.className = 'enchantment-debug';
    diagnostics.innerHTML = `<summary>Enchantments diagnostics · Immundanity ${imm}</summary>`;
    const pre = document.createElement('pre');
    pre.style.cssText = 'white-space:pre-wrap;font-size:10px;max-height:260px;overflow:auto;';
    pre.textContent = diagnosticsLines(key).join('\n');
    diagnostics.appendChild(pre);
    section.appendChild(diagnostics);
    pane.appendChild(section);
    lastUiWeaponKey = key;
  }

  function renderLoadoutUiIfPresent() {
    const pane = typeof document !== 'undefined' ? document.getElementById('combatLoadoutPane') : null;
    if (pane && window.CombatLoadoutUI) window.CombatLoadoutUI.render(); // Full re-render keeps the enchantment section in its fixed position within the pane.
  }

  function debugSnapshot(key = weaponKey()) {
    const state = stateFor(key);
    return {
      weaponKey: key,
      base: [...state.base],
      flourishes: { ...state.flourishes },
      counts: planarCounts(key),
      immundanity: getWeaponImmundanity(key),
      enchantmentMultiplier: getEnchantmentPowerMultiplier(key),
      masteryMultiplier: getMasteryPowerMultiplier(key),
      siccedTarget: getCurrentSiccedTarget() ? targetName(getCurrentSiccedTarget()) : null,
      unlocks: unlockedOptions(),
      recentEvents: recentEvents.slice(-16).map(entry => entry.message),
    };
  }

  function init() {
    if (initialized) return;
    initialized = true;
    window.CombatAttackEvents?.on?.('prepare', onPrepare);
    window.CombatAttackEvents?.on?.('hit', onHit);
    window.CombatAttackEvents?.on?.('defensive', onDefensive);
    window.addEventListener?.('hobunji-burning-roll-cured', onBurningRollCured);
    // Sicced multiplies the companion's complete offensive output against
    // its marked target through the shared aggregator, so it stacks with
    // the Engraved Whistle (or anything else) without either knowing.
    window.CompanionOffense?.registerProvider?.('sicced', (companion, target) => {
      const mul = getCompanionTargetPowerMultiplier(companion, target);
      return mul > 1 ? { damage: mul, footing: mul, affliction: mul, knockback: mul } : null;
    });
  }

  window.DevCompanion?.registerCheatPanel?.({
    id: 'enchantment-editing', title: 'Free enchantment editing', order: 32,
    when: () => weaponKey() !== 'none',
    render: () => {
      const key = weaponKey(); // Captures which weapon these selectors edit, including while another weapon is equipped.
      const state = stateFor(key); // Reads canonical enchantments for the companion dropdowns.
      const options = (type, slot) => [{ value: '', label: '— None —' }, ...definitionOptions(type).filter(def => !slot || allowsFlourishSlot(def.id, slot)).map(def => ({ value: def.id, label: `${def.displayName} · ${def.alignment}` }))]; // Shares the same authored options as the former player-menu editors.
      return { summary: key, actions: [
        ...Array.from({ length: BASE_LIMIT }, (_, index) => ({ id: 'base', label: `Base ${index + 1}`, args: { key, index }, value: state.base[index] || '', options: options('Base') })),
        ...(window.Combat?.loadout?.SLOT_IDS || ['tap1','tap2','hold1','hold2']).map(slot => ({ id: 'flourish', label: `${slot.toUpperCase()} Flourish`, args: { key, slot }, value: state.flourishes?.[slot] || '', options: options('Flourish', slot) })),
      ] };
    },
    onAction: (action, args) => {
      if (args.key !== weaponKey()) return { ok: false, error: 'Equipped weapon changed; choose again.' };
      const ok = action === 'base' && Number.isInteger(args.index) && args.index >= 0 && args.index < BASE_LIMIT
        ? equipBase(args.key, args.index, args.value)
        : action === 'flourish' ? setFlourish(args.key, args.slot, args.value) : false; // Uses the existing validation and persistence paths.
      if (ok) renderLoadoutUiIfPresent();
      return { ok };
    },
  });

  window.EnchantmentSystem = Object.freeze({
    PLANES,
    DEFINITIONS,
    TUNING,
    BASE_LIMIT,
    init,
    serialize,
    load,
    persist,
    isBaseUnlocked,
    isFlourishUnlocked,
    unlockFromState,
    unlockedOptions,
    cleanWeaponState,
    diagnosticsLines,
    getCompanionTargetPowerMultiplier,
    stateFor,
    equipBase,
    addBase,
    setFlourish,
    allowsFlourishSlot,
    activeDefinitions,
    hasBase,
    flourishForSlot,
    planarCounts,
    getWeaponImmundanity,
    getEnchantmentPowerMultiplier,
    getMasteryPowerMultiplier,
    flourishQualifies,
    applyPeripheralGust,
    applyRangedSpiritHeal,
    getCurrentSiccedTarget,
    enforceCompanionTargeting,
    renderLoadoutUI,
    debugSnapshot,
    logEvent,
  });

  init();
})();
