// Weapon Enchantments + Immundanity.
//
// This module owns only enchantment definitions/persistence and cross-cutting
// effects. Individual combat abilities remain authoritative for whether a
// Combo/Quick/Held/Flurry/Defensive trigger actually qualified; they publish
// those facts through CombatAttackEvents.
(() => {
  'use strict';

  const PLANES = Object.freeze(['Tothal', 'Hronal', 'Kanthic', 'Ohthic']);
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
      id: 'sicced', displayName: 'Sicced', type: 'Flourish', alignment: 'Tothal',
      icon: '🐾', flurryBehavior: 'proc',
      scalable: Object.freeze({ companionPower: true }),
      description: 'Marks the struck enemy as the animal companion’s exclusive target and empowers the companion against it.',
    }),
    fury: Object.freeze({
      id: 'fury', displayName: 'Fury', type: 'Flourish', alignment: 'Hronal',
      icon: '🔥', flurryBehavior: 'proc',
      scalable: Object.freeze({ amount: true }),
      description: 'Grants Furious Stamina. Offensive Held attack progress funded by it consumes/progresses at 3× tempo.',
    }),
    moralized: Object.freeze({
      id: 'moralized', displayName: 'Moralized', type: 'Flourish', alignment: 'Kanthic',
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
    livingFlame: Object.freeze({
      id: 'livingFlame', displayName: 'Living Flame', type: 'Base', alignment: 'Hronal',
      icon: '♨', scalable: Object.freeze({ burningAmount: true, kindlingAmount: true }),
      description: 'Hits burn enemies and kindle the wielder. Rolling away Burning throws three times the cured fire into nearby enemies.',
    }),
    livingGust: Object.freeze({
      id: 'livingGust', displayName: 'Living Gust', type: 'Base', alignment: 'Ohthic',
      icon: '〰', scalable: Object.freeze({ selfFootingCost: true }),
      description: 'Strengthens knockback and lunges, widens a knockback-only gust cone, and rewards attacks that topple their wielder.',
    }),
  });

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

  function cleanWeaponState(raw) {
    const base = Array.isArray(raw?.base)
      ? [...new Set(raw.base.filter(id => DEFINITIONS[id]?.type === 'Base'))].slice(0, BASE_LIMIT)
      : [];
    const flourishes = {};
    for (const slotId of window.Combat?.loadout?.SLOT_IDS || ['tap1','tap2','hold1','hold2']) {
      const id = raw?.flourishes?.[slotId];
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
  function unlockFromState(raw) {
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
      persist();
      logEvent(`Garanki learned: ${learned.join(', ')}`);
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
  function equipBase(key, slotIndex, enchantmentId) {
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
    persist();
    return true;
  }

  // Appends into the first free Base slot; false when both are taken.
  function addBase(key, enchantmentId) {
    return equipBase(key, stateFor(key).base.length, enchantmentId);
  }

  function setFlourish(key, slotId, enchantmentId) {
    if (!(window.Combat?.loadout?.SLOT_IDS || ['tap1','tap2','hold1','hold2']).includes(slotId)) return false;
    const def = DEFINITIONS[enchantmentId];
    if (enchantmentId && def?.type !== 'Flourish') return false;
    const state = stateFor(key, true);
    if (enchantmentId) state.flourishes[slotId] = enchantmentId;
    else delete state.flourishes[slotId];
    persist();
    return true;
  }

  function activeDefinitions(key = weaponKey()) {
    const state = stateFor(key);
    const ids = [...state.base, ...Object.values(state.flourishes)].filter(Boolean);
    return ids.map(id => DEFINITIONS[id]).filter(Boolean);
  }

  function getWeaponImmundanity(input = weaponKey()) {
    const key = typeof input === 'string' ? input : input?.key || input?.id || weaponKey();
    const counts = { Tothal: 0, Hronal: 0, Kanthic: 0, Ohthic: 0 };
    for (const def of activeDefinitions(key)) if (counts[def.alignment] != null) counts[def.alignment]++;
    return Math.abs(counts.Tothal - counts.Hronal) + Math.abs(counts.Kanthic - counts.Ohthic);
  }

  function planarCounts(key = weaponKey()) {
    const counts = { Tothal: 0, Hronal: 0, Kanthic: 0, Ohthic: 0 };
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

  function scaled(def, key, baseValue, property) {
    return Number(baseValue) * (def.scalable?.[property] ? getEnchantmentPowerMultiplier(key) : 1);
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
      if (!actor || actor.health <= 0 || actor.stableRole === 'shoulderPet') continue;
      if ((actor.master || attacker) === attacker) out.push(actor);
    }
    return out;
  }

  function applySicced(event, def, power) {
    const target = event.target;
    if (!target || target.health <= 0) return;
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

  const FLOURISH_HANDLERS = { sicced: applySicced, fury: applyFury, moralized: applyMoralized, resolve: applyResolve };

  function applyFlourish(event) {
    const id = flourishForSlot(event.slotId, event.weaponKey);
    const def = DEFINITIONS[id];
    if (!def || def.type !== 'Flourish' || !flourishQualifies(event)) return false;

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
    handler(event, def, power * (event.flourishNumericMultiplier || 1));
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
    const power = getEnchantmentPowerMultiplier(key);
    const target = event.target;
    if (!target || target.health <= 0 && !(event.actualDamage > 0)) return;

    if (hasBase('burning', key)) {
      window.ResourceSystem?.addAffliction?.(target, 'burningHealth', scaled(DEFINITIONS.burning, key, TUNING.BURNING_APPLICATION, 'amount'));
    }
    if (hasBase('frostbitten', key)) {
      window.ResourceSystem?.addAffliction?.(target, 'frostbittenStamina', scaled(DEFINITIONS.frostbitten, key, TUNING.FROSTBITTEN_APPLICATION, 'amount'));
    }
    if (hasBase('mirrored', key) && event.actualDamage > 0) {
      const amount = scaled(DEFINITIONS.mirrored, key, event.actualDamage * TUNING.MIRRORED_HEALTH_RATIO, 'amount');
      applyEnhanced(event.attacker, 'mirroredHealth', amount, 'Mirrored');
    }
    if (hasBase('livingFlame', key)) {
      const targetBurn = scaled(DEFINITIONS.livingFlame, key, TUNING.LIVING_FLAME_ENEMY_BURNING_APPLICATION, 'burningAmount');
      const selfKindling = scaled(DEFINITIONS.livingFlame, key, TUNING.LIVING_FLAME_SELF_KINDLING_APPLICATION, 'kindlingAmount');
      window.ResourceSystem?.addAffliction?.(target, 'burningHealth', targetBurn);
      window.ResourceSystem?.addAffliction?.(event.attacker, 'kindlingHealth', selfKindling);
    }

    applyFlourish(event);
  }

  function onDefensive(event) {
    const id = flourishForSlot(event.slotId, event.weaponKey);
    const def = DEFINITIONS[id];
    if (!def || def.type !== 'Flourish') return false;
    const power = getEnchantmentPowerMultiplier(event.weaponKey);
    FLOURISH_HANDLERS[id]?.(event, def, power);
    logEvent(event.defensiveResult === 'block' ? 'Defensive Flourish triggered on block' : 'Defensive Flourish triggered on near-hit dodge');
    return true;
  }

  function pruneSiccedTargets() {
    const t = nowMs();
    for (const target of Array.from(siccedTargets)) {
      if (!target || target.health <= 0 || t >= (Number(target._siccedUntilMs) || 0)) siccedTargets.delete(target);
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

  function getCurrentSiccedTarget() {
    return pruneSiccedTargets();
  }

  function getCompanionTargetPowerMultiplier(companion, target) {
    if (!companion?.isCompanion || !target || !siccedTargets.has(target) || nowMs() >= (Number(target._siccedUntilMs) || 0)) return 1;
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
      * TUNING.LIVING_GUST_PERIPHERAL_KNOCKBACK_MULTIPLIER;
    let affected = 0;
    for (const target of deps.hostileObjects || []) {
      if (!target || target.health <= 0 || ordinaryHitTargets.has(target) || target.areaId !== deps.getCurrentArea?.()) continue;
      const inWide = deps.inCone?.(context.attacker.x, context.attacker.y, context.metadata?.attackAngle ?? context.attacker.angle, target.x, target.y, context.rangePx, widened);
      const inNormal = deps.inCone?.(context.attacker.x, context.attacker.y, context.metadata?.attackAngle ?? context.attacker.angle, target.x, target.y, context.rangePx, context.halfConeRad);
      if (!inWide || inNormal) continue;

      if (typeof deps.applyKnockback === 'function') {
        deps.applyKnockback(target, context.attacker.x, context.attacker.y, strength, { source: 'living-gust', footingDamageMultiplier: 0 });
      } else if (typeof deps.damageCreature === 'function') {
        // damageCreature is the existing public combat seam that owns knockback.
        // A zero-damage call intentionally asks it for movement only; no Base
        // enchantment hit event is emitted for this peripheral gust.
        deps.damageCreature(target, 0, context.attacker.x, context.attacker.y, strength, {
          tag: 'wind',
          footingDamageMultiplier: 0,
          noAfflictions: true,
          enchantmentPeripheralGust: true,
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
      window.ResourceSystem?.addAffliction?.(target, 'burningHealth', amount);
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

  function makeSelect(type, value, onChange) {
    const select = document.createElement('select');
    select.className = 'settings-select';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = '— None —';
    select.appendChild(none);
    for (const def of definitionOptions(type)) {
      const option = document.createElement('option');
      option.value = def.id;
      option.textContent = `${def.icon || ''} ${def.displayName} · ${def.alignment}`;
      option.title = def.description;
      option.selected = def.id === value;
      select.appendChild(option);
    }
    select.addEventListener('change', () => onChange(select.value || null));
    return select;
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
      `Tothal ${counts.Tothal} · Hronal ${counts.Hronal} · Kanthic ${counts.Kanthic} · Ohthic ${counts.Ohthic}`,
      `Immundanity: ${getWeaponImmundanity(key)}`,
      `Enchantment power: ×${getEnchantmentPowerMultiplier(key).toFixed(2)}`,
      `Mastery effects: ×${getMasteryPowerMultiplier(key).toFixed(2)}`,
      `Sicced target: ${getCurrentSiccedTarget() ? targetName(getCurrentSiccedTarget()) : 'none'}`,
      ...attunement,
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
    const editable = !!window.Combat?.deps?.isDevMode?.(); // Players enchant through Garanki Gabu; dev mode edits freely for testing.
    const summary = document.createElement('div');
    summary.className = 'loadout-slot-combo-note';
    summary.textContent = `Immundanity ${getWeaponImmundanity(key)} · Enchantment power ×${getEnchantmentPowerMultiplier(key).toFixed(2)} · Mastery effects ×${getMasteryPowerMultiplier(key).toFixed(2)}`
      + (editable ? ' · [Dev] free editing' : ' · Garanki Gabu applies enchantments');
    section.appendChild(summary);
    for (let i = 0; i < BASE_LIMIT; i++) {
      const row = document.createElement('div');
      row.className = 'loadout-slot';
      const label = document.createElement('div');
      label.className = 'settings-label';
      label.innerHTML = `<div class="settings-name">Base Enchantment ${i + 1}</div><div class="settings-desc">Applies to every qualifying hit made with this weapon.</div>`;
      row.append(label, editable
        ? makeSelect('Base', state.base[i] || '', id => { equipBase(key, i, id); window.CombatLoadoutUI?.render?.(); })
        : readOnlyValue(state.base[i]));
      section.appendChild(row);
    }

    for (const slotId of window.Combat?.loadout?.SLOT_IDS || ['tap1','tap2','hold1','hold2']) {
      const row = document.createElement('div');
      row.className = 'loadout-slot';
      const label = document.createElement('div');
      label.className = 'settings-label';
      const ability = window.Combat?.abilities?.get?.(window.Combat?.loadout?.getSlot?.(slotId));
      label.innerHTML = `<div class="settings-name">${slotId.toUpperCase()} Flourish · ${ability?.label || 'Empty'}</div><div class="settings-desc">${flourishTriggerText(slotId)}</div>`;
      row.append(label, editable
        ? makeSelect('Flourish', state.flourishes?.[slotId] || '', id => { setFlourish(key, slotId, id); window.CombatLoadoutUI?.render?.(); })
        : readOnlyValue(state.flourishes?.[slotId]));
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
      return mul > 1 ? { damage: mul, footing: mul, affliction: mul } : null;
    });
  }

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
    activeDefinitions,
    hasBase,
    flourishForSlot,
    planarCounts,
    getWeaponImmundanity,
    getEnchantmentPowerMultiplier,
    getMasteryPowerMultiplier,
    flourishQualifies,
    applyPeripheralGust,
    getCurrentSiccedTarget,
    getCompanionTargetPowerMultiplier,
    enforceCompanionTargeting,
    renderLoadoutUI,
    debugSnapshot,
    logEvent,
  });

  init();
})();
