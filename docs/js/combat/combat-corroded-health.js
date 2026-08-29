// Corroded Health — persistent Bruised-Health-style vulnerability.
(() => {
  'use strict';

  const RS = window.ResourceSystem; // Used to extend the already-loaded shared resource system in place.
  if (!RS?.AFFLICTIONS || typeof RS.applyDamage !== 'function') {
    console.error('combat-corroded-health.js requires resource-system.js to load first');
    return;
  }
  if (window.HobunjiCorrodedHealth) return;

  const CORRODED_COLOR = 0xb6d94c; // Used by resource rings and projectile trails for the new acidic vulnerability.
  const originalApplyDamage = RS.applyDamage.bind(RS); // Used after the power-hit extension resolves Bruised + Corroded bonus damage.
  const POWER_HIT_DESC = 'A received heavy attack, condition-qualified quick attack, or combo finisher deals bonus damage up to the attack\'s normal damage, then consumes it.'; // Shared wording keeps Compendium descriptions aligned with the runtime rule.

  if (RS.AFFLICTIONS.bruisedHealth) {
    RS.AFFLICTIONS.bruisedHealth.desc = POWER_HIT_DESC;
  }

  RS.AFFLICTIONS.corrodedHealth = {
    name: 'Corroded Health',
    resource: 'health',
    extend: 'currentBack',
    priority: 75,
    recovers: false,
    desc: `${POWER_HIT_DESC} Does not recover on its own.`,
  };

  // Poisoned Health is the non-homeostatic version of Bleeding Health;
  // Corroded Health follows the same relationship to Bruised Health. Both
  // vulnerabilities are consumed by a power hit: a heavy attack, the third
  // step of a combo, or a quick attack whose own condition bonus is active.
  // Only Bruised naturally recovers; Corroded remains until consumed.
  RS.applyDamage = function applyDamageWithCorrosion(entity, amount, opts = {}) {
    const consumesVulnerability = !!(opts?.heavy || opts?.consumeHealthVulnerability); // Used by heavy attacks plus explicitly-qualified combo/quick attacks.
    if (!consumesVulnerability || !(amount > 0)) return originalApplyDamage(entity, amount, opts);

    const normalDamage = amount; // Used as the independent cap for both power-hit vulnerability pools.
    const bruisedBonus = Math.min(RS.getAffliction(entity, 'bruisedHealth'), normalDamage); // Used to preserve the original Bruised Health heavy rule for every power hit.
    const corrodedBonus = Math.min(RS.getAffliction(entity, 'corrodedHealth'), normalDamage); // Used as the persistent Corroded Health power-hit vulnerability bonus.
    if (bruisedBonus > 0) RS.removeAffliction(entity, 'bruisedHealth', bruisedBonus);
    if (corrodedBonus > 0) RS.removeAffliction(entity, 'corrodedHealth', corrodedBonus);

    // The original function's only vulnerability-specific step is Bruised
    // Health consumption on opts.heavy. We already resolved both pools above,
    // so disable both qualification flags before delegating to avoid consuming
    // Bruised twice while retaining every other option (tag, afflictions,
    // ranged metadata, etc.).
    return originalApplyDamage(entity, normalDamage + bruisedBonus + corrodedBonus, {
      ...opts,
      heavy: false,
      consumeHealthVulnerability: false,
    });
  };

  if (window.ResourceRings?.AFFLICTION_COLORS) {
    window.ResourceRings.AFFLICTION_COLORS.corrodedHealth = CORRODED_COLOR;
  }

  window.HobunjiCorrodedHealth = {
    id: 'corrodedHealth',
    color: CORRODED_COLOR,
  };
})();
