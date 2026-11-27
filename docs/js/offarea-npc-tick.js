// Opt-in coarse ticking for NPC walkers that are in a different area than the player (extracted from game.js).
// Nobody can see them, so their real schedule update runs at 4 Hz with the skipped time accumulated instead of
// every frame. Off by default: ?offAreaNpcTick=1, localStorage.hobunjiOffAreaNpcTick='1', or
// OffAreaNpcTick.setEnabled(true) at runtime for A/B comparison. See docs/architecture/runtime-frame-scheduler.md.
(function () {
  'use strict';
  const INTERVAL_S = 0.25; // Real update still runs; only its cadence changes.
  const MAX_DT_S = 0.5; // No single coarse step is larger than this.
  let enabled = false;
  const stats = { skippedUpdates: 0, coarseUpdates: 0 };
  let deps = {};
  try {
    enabled = new URLSearchParams(window.location?.search || '').get('offAreaNpcTick') === '1'
      || window.localStorage?.getItem('hobunjiOffAreaNpcTick') === '1';
  } catch (_) { enabled = false; }

  function init(nextDeps) { deps = nextDeps || {}; }

  // True only for walkers nobody can see AND that need no per-frame control from another system.
  function eligible(w) {
    const area = w.area, current = deps.getCurrentArea?.();
    if (typeof area !== 'string' || !area || area === current) return false;
    if (window.ActorRegistry?.playerCount() > 1 && window.ActorRegistry.isAnyPlayerInArea(area)) return false; // Another player is there: not off-area for them.
    if (w.animalDef || w._familyBabyFollowing || w._npcCliffClimb || w.pause === Infinity) return false;
    if (w._wildlifeThreatUntil > (deps.now ? deps.now() : performance.now())) return false;
    if (deps.isDialogueOrCutsceneWalker?.(w)) return false;
    return true;
  }

  // Returns the dt to pass to walker.update this frame, or null to skip the update entirely.
  function step(w, dt) {
    if (!enabled || !eligible(w)) {
      if (w._offAreaCoarseDt) w._offAreaCoarseDt = 0; // Entered the player's area or needs control again: resume per-frame updates at once.
      return dt;
    }
    w._offAreaCoarseDt = (w._offAreaCoarseDt || 0) + dt;
    if (w._offAreaCoarseDt < INTERVAL_S) { stats.skippedUpdates++; return null; }
    const out = Math.min(MAX_DT_S, w._offAreaCoarseDt);
    w._offAreaCoarseDt = 0;
    stats.coarseUpdates++;
    return out;
  }

  window.OffAreaNpcTick = {
    init, step, eligible,
    setEnabled(on) { enabled = !!on; return enabled; },
    isEnabled: () => enabled,
    getDebug: () => ({ enabled, ...stats }),
  };
})();
