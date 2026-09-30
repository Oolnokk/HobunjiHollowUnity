// Shared player-weapon attack events.
//
// Ability modules remain authoritative for their own timing/condition checks.
// They publish those already-resolved facts here so cross-cutting systems
// (Enchantments first) can observe/modify attacks without reimplementing
// combo-step, Quick Attack, charge, flurry, or defensive-hit logic.
(() => {
  'use strict';

  const listeners = {
    prepare: new Set(),   // Mutates the one per-attack context before payload values are committed.
    hit: new Set(),       // Observes one successful target hit after ordinary damage resolves.
    defensive: new Set(), // Observes an authoritative successful block / iframe near-hit dodge.
  };

  const SLOT_IDS = ['tap1', 'tap2', 'hold1', 'hold2']; // Used to resolve an ability back to the active weapon loadout slot.

  function currentWeaponKey() {
    return window.Combat?.deps?.currentWeaponKey?.() || 'none';
  }

  function slotForAbility(abilityId) {
    const loadout = window.Combat?.loadout?.get?.() || {};
    return SLOT_IDS.find(slotId => loadout[slotId] === abilityId) || null;
  }

  function resolveIncomingSource(fromX, fromY, deps = window.Combat?.deps) {
    if (!Number.isFinite(Number(fromX)) || !Number.isFinite(Number(fromY)) || !deps) return null;
    let best = null; // Used to attribute an already-authoritative block/iframe miss to the attacking actor without inventing a second hit test.
    let bestDistance = Infinity; // Used only to choose among living actors nearest the source coordinates supplied by damagePlayer.
    for (const actor of deps.hostileObjects || []) {
      if (!actor || actor.health <= 0 || actor.areaId !== deps.getCurrentArea?.()) continue;
      const distance = Math.hypot((Number(actor.x) || 0) - Number(fromX), (Number(actor.y) || 0) - Number(fromY));
      if (distance < bestDistance) { best = actor; bestDistance = distance; }
    }
    return best;
  }

  function cloneAfflictions(source) {
    const out = {};
    for (const [id, value] of Object.entries(source || {})) {
      const amount = Number(value);
      if (Number.isFinite(amount) && amount > 0) out[id] = amount;
    }
    return out;
  }

  function scaleAfflictions(source, multiplier = 1) {
    const mul = Math.max(0, Number(multiplier) || 0); // Used by Living Gust's one attack-wide offensive multiplier.
    const out = {};
    for (const [id, value] of Object.entries(source || {})) {
      const amount = Number(value);
      if (Number.isFinite(amount) && amount > 0) out[id] = amount * mul;
    }
    return out;
  }

  function makeContext(input = {}) {
    const abilityId = input.abilityId || null;
    return {
      attacker: input.attacker || window.Combat?.deps?.player || null,
      weaponKey: input.weaponKey || currentWeaponKey(),
      abilityId,
      slotId: input.slotId || slotForAbility(abilityId),
      attackCategory: input.attackCategory || window.Combat?.abilities?.get?.(abilityId)?.category || null,
      target: input.target || null,
      damage: Math.max(0, Number(input.damage) || 0), // Pre-hit outgoing Health payload; prepare listeners may scale it before the ordinary damage API runs.
      actualDamage: Math.max(0, Number(input.actualDamage) || 0),
      afflictionBonuses: cloneAfflictions(input.afflictionBonuses),
      footingDamage: Math.max(0, Number(input.footingDamage) || 0),
      knockbackPxS: Math.max(0, Number(input.knockbackPxS) || 0),
      rangePx: Math.max(0, Number(input.rangePx) || 0),
      halfConeRad: Math.max(0, Number(input.halfConeRad) || 0),
      lungePx: Math.max(0, Number(input.lungePx) || 0),
      chargePercentage: Math.max(0, Math.min(1, Number(input.chargePercentage) || 0)),
      comboStep: Number.isFinite(Number(input.comboStep)) ? Number(input.comboStep) : null,
      comboFinisher: !!input.comboFinisher,
      quickConditionalBonus: !!input.quickConditionalBonus,
      fullCharge: !!input.fullCharge,
      isFlurry: !!input.isFlurry,
      flurryHitIndex: Number.isFinite(Number(input.flurryHitIndex)) ? Number(input.flurryHitIndex) : null,
      causedAttackerProne: !!input.causedAttackerProne,
      defensiveResult: input.defensiveResult || null,
      metadata: { ...(input.metadata || {}) },
      modifiers: {
        damage: 1,
        footingDamage: 1,
        affliction: 1,
        knockback: 1,
        lunge: 1,
        cone: 1,
        ...(input.modifiers || {}),
      },
    };
  }

  function notify(kind, context) {
    for (const listener of listeners[kind]) {
      try { listener(context); } catch (error) {
        window.__farmLog?.(`[combat-events] ${kind} listener failed: ${error?.message || error}`, 'warn', 'combat');
      }
    }
    return context;
  }

  function prepare(input = {}) {
    return notify('prepare', makeContext(input));
  }

  function hit(baseContext, patch = {}) {
    const event = {
      ...(baseContext || makeContext(patch)),
      ...patch,
      metadata: { ...(baseContext?.metadata || {}), ...(patch.metadata || {}) },
    };
    event.actualDamage = Math.max(0, Number(event.actualDamage) || 0);
    event.target = patch.target ?? baseContext?.target ?? null;
    event.afflictionBonuses = cloneAfflictions(patch.afflictionBonuses ?? baseContext?.afflictionBonuses);
    return notify('hit', event);
  }

  function defensive(input = {}) {
    return notify('defensive', makeContext(input));
  }

  function on(kind, listener) {
    if (!listeners[kind] || typeof listener !== 'function') return () => {};
    listeners[kind].add(listener);
    return () => listeners[kind].delete(listener);
  }

  window.CombatAttackEvents = Object.freeze({
    prepare,
    hit,
    defensive,
    on,
    slotForAbility,
    resolveIncomingSource,
    scaleAfflictions,
    currentWeaponKey,
  });
})();
