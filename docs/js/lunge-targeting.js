// Lunge-stop target test, extracted from game.js (was `isHostileInLungeCone`).
//
// A player lunge stops in place the instant something is already inside the attack's own
// hit cone, so the target is guaranteed to still be inside the collider where the lunge
// halts instead of being overshot. That something used to be live hostiles only. It is now
// live hostiles (unchanged) OR any Targetable carrying the 'lungeStop' capability: a
// thing that opts in (e.g. a bomb hanging on a rope) behaves like an enemy for lunge
// cancelling, so a close strike spends little lunge and a distant one spends all of it.
// Nothing carries 'lungeStop' by default, so existing gameplay is unchanged.
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
  // deps: { player, getHostiles: () => iterable of hostile actors, getCurrentArea: () => mapId }
  function init(injected) { deps = injected; }

  // hitTest = { rangePx, halfConeRad } as published by beginCombatLunge.
  function hasTargetInCone(hitTest) {
    if (!hitTest || !deps) return false;
    const player = deps.player, area = deps.getCurrentArea();
    const opts = { // One options object per probe, identical for every candidate.
      rangePx: hitTest.rangePx,
      halfConeRad: hitTest.halfConeRad,
      yaw: Math.atan2(player.lungeDirY, player.lungeDirX),
      pitch: player.lungeAimPitch || 0,
    };
    for (const c of deps.getHostiles()) {
      if (c.health <= 0 || c.areaId !== area || c._denHidden) continue;
      if (root.Combat?.meleeHit?.(player, c, opts)) return true;
    }
    return !!root.Targetables?.firstInCone?.(player, opts, root.Targetables.CAPS.LUNGE_STOP, area);
  }

  return Object.freeze({ init, hasTargetInCone });
});
