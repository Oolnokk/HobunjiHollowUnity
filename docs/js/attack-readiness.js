// Reusable attack-readiness policy. Hostile AI may stage/telegraph an attack instead of
// striking the player during deliberate, non-combat interactions. No invulnerability
// is granted: each opted-in attacker owns its own movement and collision response.
(() => {
  'use strict';
  if (window.AttackReadiness) return;

  const activities = new Map(); // Registered player-activity predicates, queried only when a hostile has selected the player.
  function registerActivity(id, predicate) {
    const key = String(id || '').trim();
    if (!key || typeof predicate !== 'function') return () => false;
    activities.set(key, predicate);
    return () => {
      if (activities.get(key) !== predicate) return false; // An older registration cannot delete its replacement.
      return activities.delete(key);
    };
  }
  function activityFor(player) {
    if (!player || !(player.health > 0) || player.tzatzulCapturedBy) return null;
    for (const [key, active] of activities) {
      try {
        if (active(player) === true) return key;
      } catch (error) {
        // Minigames may be tearing down during a scene change. Fail open so AI never gets stuck.
      }
    }
    return null;
  }
  function shouldReady(attacker, target, player) {
    return !!attacker && !!player && target === player && activityFor(player) !== null;
  }
  function canStrike(attacker, target, player) {
    return !shouldReady(attacker, target, player);
  }

  registerActivity('fishing', () => !!window.Fishing?.state); // Includes the cast, bite wait, ring and catch celebration.
  registerActivity('lockpicking', () => window.ChestLockpicking?.isActive?.() === true); // Includes asynchronous progress-saving before the lock closes.
  registerActivity('instrument', () => !!window.MusicMinigame?.state); // Hosted puzzle and performance both occupy the player.
  registerActivity('exterior-melody', () => window.PuzzleCaveEntrances?.isPlayerSolvingMelody?.() === true); // A live timed plate needs no hosted instrument overlay.

  window.AttackReadiness = Object.freeze({
    registerActivity, activityFor, shouldReady, canStrike,
    debugSnapshot: player => ({ activity: activityFor(player), registered: [...activities.keys()] }), // Small on-mobile diagnostics; no live objects retained.
  });
})();