(() => {
  'use strict';

  // Collision Footing still passes through ResourceSystem.spendFooting(), whose shared
  // bridge doubles requested loss. Keep these fallback coefficients aligned with the
  // config's pre-bridge values so a missing config never restores the old overtuned hit.
  const DEFAULTS = Object.freeze({
    fallback: Object.freeze({ footing: 6 }),
    stone: Object.freeze({ health: 4, footing: 10, shatteredStamina: 5, bruisedHealth: 4 }),
    wood: Object.freeze({ footing: 7, bleedingHealth: 4, woundedStamina: 4 }),
    bladed: Object.freeze({ health: 10, bleedingHealth: 11, woundedStamina: 7 }),
    fire: Object.freeze({ burningHealth: 9 }),
    burningDodgeRecovery: 12,
  });

  let lastImpact = null; // Copied by Pixel Probe so mobile testing does not need a console.

  function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function config() {
    const raw = window.SCRATCHBONES_CONFIG?.game?.combat?.knockbackCollision || {};
    const profile = (id) => ({ ...DEFAULTS[id], ...(raw[id] || {}) });
    return {
      fallback: profile('fallback'),
      stone: profile('stone'),
      wood: profile('wood'),
      bladed: profile('bladed'),
      fire: profile('fire'),
      burningDodgeRecovery: Math.max(0, finite(raw.burningDodgeRecovery, DEFAULTS.burningDodgeRecovery)),
    };
  }

  function begin(entity, speedPxS, durationS) {
    if (!entity) return null;
    const speed = Math.max(0, Math.abs(finite(speedPxS)));
    const duration = Math.max(0, finite(durationS));
    entity._knockbackCollisionImpact = { // Used only while this knockback is in flight to measure the actual lost travel at first collision.
      startX: finite(entity.x),
      startY: finite(entity.y),
      intendedPx: speed * duration,
      resolved: false,
    };
    return entity._knockbackCollisionImpact;
  }

  function cancel(entity) {
    if (entity) entity._knockbackCollisionImpact = null;
  }

  function impactStrength(entity, tilePx) {
    const state = entity?._knockbackCollisionImpact;
    const tile = Math.max(0.001, finite(tilePx, 1));
    if (!state || state.resolved || !(state.intendedPx > 0)) return { deficitTiles: 0, traveledPx: 0, intendedPx: 0 };
    const traveledPx = Math.hypot(finite(entity.x) - state.startX, finite(entity.y) - state.startY);
    const deficitTiles = Math.max(0, (state.intendedPx - traveledPx) / tile);
    return { deficitTiles, traveledPx, intendedPx: state.intendedPx };
  }

  function addScaledEffects(target, source, scale) {
    for (const [key, base] of Object.entries(source || {})) {
      const amount = Math.max(0, finite(base) * scale);
      if (amount > 0) target[key] = (target[key] || 0) + amount;
    }
  }

  function effectsFor(descriptor = {}, deficitTiles = 0) {
    const strength = Math.max(0, finite(deficitTiles));
    const cfg = config();
    const effects = {};
    const bladed = descriptor.bladedHazard === true;
    const fire = descriptor.fireHazard === true;

    if (bladed) addScaledEffects(effects, cfg.bladed, strength);
    else if (fire) addScaledEffects(effects, cfg.fire, strength);
    else if (descriptor.kind === 'stone') addScaledEffects(effects, cfg.stone, strength);
    else if (descriptor.kind === 'wood') addScaledEffects(effects, cfg.wood, strength);
    else addScaledEffects(effects, cfg.fallback, strength);

    // A deliberately dual-tagged authored hazard gets both special hazards,
    // but never also receives the ordinary furniture profile underneath them.
    if (bladed && fire) addScaledEffects(effects, cfg.fire, strength);
    return effects;
  }

  function applyResolvedImpact(entity, descriptor, tilePx, hooks, strengthTiles, measure, meta = {}) {
    const strength = Math.max(0, finite(strengthTiles));
    const effects = effectsFor(descriptor, strength);
    const appliedEffects = {}; // Pixel Probe reports what actually landed after resource caps/lethality, separate from the full scaled profile.
    const resource = window.ResourceSystem;
    let lethal = false;

    if (effects.health > 0) {
      const result = hooks.dealHealthDamage?.(entity, effects.health, descriptor) || null;
      const applied = Math.max(0, finite(result?.applied, effects.health));
      if (applied > 0) appliedEffects.health = applied;
      lethal = result?.lethal === true;
    }

    // A lethal Health impact may synchronously transition/respawn its target.
    // Never continue applying Footing or statuses to a corpse or freshly
    // respawned player after that transition has already happened.
    if (!lethal) {
      if (effects.footing > 0) {
        const footingLost = resource?.spendFooting?.(entity, effects.footing, 'knockback collision') || 0;
        if (footingLost > 0) appliedEffects.footing = footingLost;
        hooks.afterFootingDamage?.(entity, footingLost, descriptor);
      }
      for (const id of ['shatteredStamina', 'bruisedHealth', 'bleedingHealth', 'woundedStamina', 'burningHealth']) {
        if (!(effects[id] > 0)) continue;
        const added = resource?.addAffliction?.(entity, id, effects[id]) || 0;
        if (added > 0) appliedEffects[id] = added;
      }
      resource?.enforceCaps?.(entity);
    }

    const tile = Math.max(0.001, finite(tilePx, 1));
    lastImpact = {
      at: Date.now(),
      mode: meta.mode || 'horizontal',
      label: descriptor?.label || descriptor?.kind || 'unspecified collision',
      kind: descriptor?.kind || 'fallback',
      bladedHazard: descriptor?.bladedHazard === true,
      fireHazard: descriptor?.fireHazard === true,
      lethal,
      deficitTiles: strength,
      strengthPercent: strength * 100,
      intendedTiles: Math.max(0, finite(measure?.intendedPx)) / tile,
      traveledTiles: Math.max(0, finite(measure?.traveledPx)) / tile,
      dropWorld: Math.max(0, finite(meta.dropWorld)),
      dropTiers: Math.max(0, finite(meta.dropTiers)),
      effects: Object.fromEntries(Object.entries(effects).map(([key, value]) => [key, Math.round(value * 10) / 10])),
      appliedEffects: Object.fromEntries(Object.entries(appliedEffects).map(([key, value]) => [key, Math.round(value * 10) / 10])),
    };
    if (meta.clearState !== false) entity._knockbackCollisionImpact = null;
    return lastImpact;
  }

  function resolve(entity, descriptor, tilePx, hooks = {}) {
    const state = entity?._knockbackCollisionImpact;
    if (!state || state.resolved) return null;
    const measure = impactStrength(entity, tilePx);
    state.resolved = true;
    return applyResolvedImpact(entity, descriptor, tilePx, hooks, measure.deficitTiles, measure, { mode: 'horizontal' });
  }

  function resolveStrength(entity, descriptor, strengthTiles, tilePx, hooks = {}, meta = {}) {
    if (!entity) return null;
    const strength = Math.max(0, finite(strengthTiles));
    if (!(strength > 0)) return null;
    return applyResolvedImpact(entity, descriptor, tilePx, hooks, strength, { intendedPx: 0, traveledPx: 0 }, {
      ...meta,
      mode: meta.mode || 'explicit',
    });
  }

  function coolBurningOnDodge(entity) {
    const amount = config().burningDodgeRecovery;
    if (!(amount > 0)) return 0;
    return window.ResourceSystem?.removeAffliction?.(entity, 'burningHealth', amount) || 0;
  }

  function extinguishInWater(entity) {
    const burning = window.ResourceSystem?.getAffliction?.(entity, 'burningHealth') || 0;
    if (!(burning > 0)) return 0;
    return window.ResourceSystem?.removeAffliction?.(entity, 'burningHealth', burning) || 0;
  }

  function debugSnapshot() {
    return lastImpact ? {
      ...lastImpact,
      effects: { ...lastImpact.effects },
      appliedEffects: { ...lastImpact.appliedEffects },
    } : null;
  }

  window.KnockbackCollisionImpact = {
    begin,
    cancel,
    impactStrength,
    effectsFor,
    resolve,
    resolveStrength,
    coolBurningOnDodge,
    extinguishInWater,
    debugSnapshot,
  };
})();
