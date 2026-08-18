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
  const originalApplyDamage = RS.applyDamage.bind(RS); // Used after the heavy-hit extension resolves Bruised + Corroded bonus damage.

  RS.AFFLICTIONS.corrodedHealth = {
    name: 'Corroded Health',
    resource: 'health',
    extend: 'currentBack',
    priority: 75,
    recovers: false,
    desc: 'A subsequent received heavy attack deals bonus damage up to the attack\'s normal damage, then consumes it. Does not recover on its own.',
  };

  // Poisoned Health is the non-homeostatic version of Bleeding Health;
  // Corroded Health follows the same relationship to Bruised Health. Both
  // Bruised and Corroded are consumed by a heavy hit, but only Bruised can
  // naturally recover while Corroded remains until something consumes it.
  RS.applyDamage = function applyDamageWithCorrosion(entity, amount, opts = {}) {
    if (!opts?.heavy || !(amount > 0)) return originalApplyDamage(entity, amount, opts);

    const normalDamage = amount; // Used as the independent cap for both heavy-hit vulnerability pools.
    const bruisedBonus = Math.min(RS.getAffliction(entity, 'bruisedHealth'), normalDamage); // Used to preserve the original Bruised Health heavy rule.
    const corrodedBonus = Math.min(RS.getAffliction(entity, 'corrodedHealth'), normalDamage); // Used as the persistent Corroded Health heavy vulnerability bonus.
    if (bruisedBonus > 0) RS.removeAffliction(entity, 'bruisedHealth', bruisedBonus);
    if (corrodedBonus > 0) RS.removeAffliction(entity, 'corrodedHealth', corrodedBonus);

    // The original function's only heavy-specific step is Bruised Health
    // consumption. We already resolved that together with Corroded above, so
    // pass heavy:false to avoid consuming Bruised twice while retaining every
    // other option (tag, affliction payloads, ranged metadata, etc.).
    return originalApplyDamage(entity, normalDamage + bruisedBonus + corrodedBonus, { ...opts, heavy: false });
  };

  if (window.ResourceRings?.AFFLICTION_COLORS) {
    window.ResourceRings.AFFLICTION_COLORS.corrodedHealth = CORRODED_COLOR;
  }

  window.HobunjiCorrodedHealth = {
    id: 'corrodedHealth',
    color: CORRODED_COLOR,
  };
})();
