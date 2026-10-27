// Shared animal-companion offensive stat aggregation.
//
// Every source that empowers a player's animal companion (Engraved Whistle
// trinket, Sicced target debuff, future perks) registers ONE provider here
// instead of searching for the others. Providers return per-channel
// multipliers; this module multiplies them together and applies the result
// to a single companion hit's outgoing payload (Health damage, Footing
// damage, affliction buildup) before it reaches the ordinary damageCreature
// path. Wild/bandit animals are never affected: only entities flagged
// isCompanion whose master is the player.
(() => {
  'use strict';

  const providers = new Map(); // id -> provider(companion, target) => { damage?, footing?, affliction? } multipliers.

  function registerProvider(id, provider) {
    const key = String(id || '').trim();
    if (!key) return () => {};
    if (typeof provider === 'function') providers.set(key, provider);
    else providers.delete(key);
    return () => providers.delete(key);
  }

  registerProvider('companionTactics', companion => window.StableAnimalTrainingRefinements?.hitModifiers?.(companion));

  function isPlayerCompanion(companion) {
    if (!companion?.isCompanion || companion.banditCompanion === true) return false;
    const player = window.Combat?.deps?.player;
    return !player || (companion.master || player) === player;
  }

  function channel(value) {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : 1;
  }

  // Aggregated multipliers for one companion→target hit. `sources` lists
  // every provider that contributed something other than 1× (debug UI).
  function getModifiers(companion, target) {
    const out = { damage: 1, footing: 1, affliction: 1, knockback: 1, sources: [] };
    if (!isPlayerCompanion(companion)) return out;
    for (const [id, provider] of providers) {
      let result = null;
      try { result = provider(companion, target); } catch (_) { result = null; }
      if (!result) continue;
      const damage = channel(result.damage), footing = channel(result.footing), affliction = channel(result.affliction);
      const knockback = channel(result.knockback); // Tactical Drive focus scales the existing impulse independently of damage.
      if (damage === 1 && footing === 1 && affliction === 1 && knockback === 1) continue;
      out.damage *= damage;
      out.footing *= footing;
      out.affliction *= affliction;
      out.knockback *= knockback;
      out.sources.push({ id, damage, footing, affliction, knockback });
    }
    return out;
  }

  // Returns the scaled (amount, opts) pair for damageCreature. The caller's
  // opts object is never mutated.
  function scaleHit(companion, target, amount, opts = {}) {
    const mods = getModifiers(companion, target);
    if (!mods.sources.length) return { amount, opts, modifiers: mods };
    const next = { ...(opts || {}) };
    if (next.afflictionBonuses) {
      const scaled = {};
      for (const [id, value] of Object.entries(next.afflictionBonuses)) {
        const n = Number(value);
        if (Number.isFinite(n)) scaled[id] = n * mods.affliction / (mods.damage || 1); // ResourceSystem multiplies these coefficients by hit damage; keep buildup independent of Health boosts.
      }
      next.afflictionBonuses = scaled;
    }
    const baseFooting = Number.isFinite(Number(next.footingDamageMultiplier)) ? Math.max(0, Number(next.footingDamageMultiplier)) : 1;
    next.footingDamageMultiplier = baseFooting * mods.footing / (mods.damage || 1); // hitResourceDamage derives Footing from amount, so divide out the Health multiplier to keep channels independent.
    next.companionOffense = mods;
    return { amount: (Number(amount) || 0) * mods.damage, opts: next, modifiers: mods };
  }

  // Drop-in replacement for deps.damageCreature(target, amount, ...) at a
  // companion's hit site.
  function damageCreature(damageFn, companion, target, amount, fromX, fromY, knockbackPxS, opts) {
    if (typeof damageFn !== 'function') return undefined;
    const scaled = scaleHit(companion, target, amount, opts);
    const hitOpts = scaled.opts?.fromCompanion ? scaled.opts : { ...(scaled.opts || {}), fromCompanion: companion }; // Lets kill-credit systems (Second Wind) know a companion landed the hit.
    return damageFn(target, scaled.amount, fromX, fromY, knockbackPxS * scaled.modifiers.knockback, hitOpts);
  }

  window.CompanionOffense = Object.freeze({
    registerProvider,
    getModifiers,
    scaleHit,
    damageCreature,
    isPlayerCompanion,
    providerIds: () => [...providers.keys()],
  });
})();
