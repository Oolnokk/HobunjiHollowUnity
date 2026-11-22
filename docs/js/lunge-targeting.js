// Lunge-stop target test, extracted from game.js (was `isHostileInLungeCone`).
//
// A player lunge stops in place the instant something is already inside the attack's own
// hit cone, so the target is guaranteed to still be inside the collider where the lunge
// halts instead of being overshot. That something used to be live hostiles only. It is now
// live hostiles (unchanged) OR any Targetable carrying the 'lungeStop' capability: a
// thing that opts in (e.g. a bomb hanging on a rope) behaves like an enemy for lunge
// cancelling, so a close strike spends little lunge and a distant one spends all of it.
// Crate piles opt into contact via their existing melee collider; lunge contact also commits
// the same crate/burden hit pass as an ordinary strike, once per lunge.
//
// game.js hands in the few bits of live state it needs through init(); see
// docs/architecture/ruin-capabilities.md.
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LungeTargeting = api;
})(typeof self !== 'undefined' ? self : globalThis, function (root) {
  'use strict';

  let deps = null;
  let lastContactStamp = null; // The lunge origin timestamp is one stable attack identity across repeated movement probes.
  // deps: { player, getHostiles: () => iterable of hostile actors, getCurrentArea: () => mapId }
  function init(injected) { deps = injected; lastContactStamp = null; }

  // hitTest = { rangePx, halfConeRad } as published by beginCombatLunge.
  function hasTargetInCone(hitTest) {
    if (!hitTest || !deps) return false;
    const player = deps.player, area = deps.getCurrentArea();
    const opts = { // Same melee volume used for hostiles, hanging burdens and destructible crates.
      rangePx: hitTest.rangePx,
      halfConeRad: hitTest.halfConeRad,
      yaw: Math.atan2(player.lungeDirY, player.lungeDirX),
      pitch: player.lungeAimPitch || 0,
    };
    let hostileHit = false;
    for (const c of deps.getHostiles()) {
      if (c.health <= 0 || c.areaId !== area || c._denHidden) continue;
      if (root.Combat?.meleeHit?.(player, c, opts)) { hostileHit = true; break; }
    }
    const burdenHit = root.Targetables?.firstInCone?.(player, opts, root.Targetables.CAPS.LUNGE_STOP, area);
    const crateHit = root.CratePiles?.hasLungeTarget?.(player, opts) === true;
    const contact = hostileHit || !!burdenHit || crateHit;
    if (contact && player.lunging === true) {
      const stamp = Number(player.lungeOriginMs); // One origin per lunge, including multi-frame contact with a stationary object.
      if (Number.isFinite(stamp) && stamp > 0 && lastContactStamp !== stamp) {
        lastContactStamp = stamp;
        // Strike at actual contact, not only at the earlier scheduled windup endpoint.
        // The regular melee pass keeps crate loot, blasts, rope impulses and world events authoritative.
        root.Shattercasks?.sweepMelee?.({
          actor: player, ...opts, lungeContact: true, targetBurden: burdenHit?.owner || null,
        });
      }
    }
    return contact;
  }

  return Object.freeze({ init, hasTargetInCone });
});
