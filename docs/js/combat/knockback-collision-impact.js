(() => {
  'use strict';

  const DEFAULTS = Object.freeze({
    fallback: Object.freeze({ footing: 12 }),
    stone: Object.freeze({ health: 8, footing: 20, shatteredStamina: 10, bruisedHealth: 8 }),
    wood: Object.freeze({ footing: 14, bleedingHealth: 8, woundedStamina: 8 }),
    bladed: Object.freeze({ health: 20, bleedingHealth: 22, woundedStamina: 14 }),
    fire: Object.freeze({ burningHealth: 18 }),
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

  function resolve(entity, descriptor, tilePx, hooks = {}) {
    const state = entity?._knockbackCollisionImpact;
    if (!state || state.resolved) return null;
    const measure = impactStrength(entity, tilePx);
    state.resolved = true;
    const deficitTiles = measure.deficitTiles;
    const effects = effectsFor(descriptor, deficitTiles);
    const resource = window.ResourceSystem;

    if (effects.health > 0) hooks.dealHealthDamage?.(entity, effects.health, descriptor);
    if (effects.footing > 0) {
      const footingLost = resource?.spendFooting?.(entity, effects.footing, 'knockback collision') || 0; // Used by game.js to turn a collision-depleted Footing bar into the existing prone state without inventing a second knockdown system.
      hooks.afterFootingDamage?.(entity, footingLost, descriptor);
    }
    for (const id of ['shatteredStamina', 'bruisedHealth', 'bleedingHealth', 'woundedStamina', 'burningHealth']) {
      if (effects[id] > 0) resource?.addAffliction?.(entity, id, effects[id]);
    }
    resource?.enforceCaps?.(entity);

    lastImpact = {
      at: Date.now(),
      label: descriptor?.label || descriptor?.kind || 'unspecified collision',
      kind: descriptor?.kind || 'fallback',
      bladedHazard: descriptor?.bladedHazard === true,
      fireHazard: descriptor?.fireHazard === true,
      deficitTiles,
      strengthPercent: deficitTiles * 100,
      intendedTiles: measure.intendedPx / Math.max(0.001, finite(tilePx, 1)),
      traveledTiles: measure.traveledPx / Math.max(0.001, finite(tilePx, 1)),
      effects: Object.fromEntries(Object.entries(effects).map(([key, value]) => [key, Math.round(value * 10) / 10])),
    };
    entity._knockbackCollisionImpact = null;
    return lastImpact;
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
    return lastImpact ? { ...lastImpact, effects: { ...lastImpact.effects } } : null;
  }

  window.KnockbackCollisionImpact = {
    begin,
    cancel,
    impactStrength,
    effectsFor,
    resolve,
    coolBurningOnDodge,
    extinguishInWater,
    debugSnapshot,
  };
})();
