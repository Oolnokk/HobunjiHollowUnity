// Enemy sight/search AI — extracted from game.js's hostile loop.
//
// A hostile "sees" its target only inside the same shared ±45° attack cone
// the player's own melee alignment uses (Combat.targetInsideAttackCone).
// Losing sight mid-chase switches it to 'searching': it sweeps back and
// forth around the heading where the target vanished, reacquiring on sight
// or giving up and returning home after ENEMY_SEARCH_DURATION_S. Everything
// here reads/writes only the creature record plus window.Combat, so game.js
// needs no init() handoff.
(() => {
  'use strict';

  const ENEMY_SEARCH_DURATION_S = 3.4; // Time a hostile scans after the player leaves its shared ±45° sight cone.
  const ENEMY_SEARCH_SWEEP_HALF_RAD = Math.PI * 0.85; // Alternating scan reaches well behind the creature before returning.
  const ENEMY_SEARCH_TURN_RATE_RAD_S = THREE.MathUtils.degToRad(190); // Base search rotation, also scaled by post-attack recovery.

  function angleDiff(target, current) {
    let d = target - current;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  function enemyAttackBusy(c) {
    return !!(c._banditAction || c._banditLunging || c._rangedAction ||
      window.Combat?.telegraph?.isBusy(c) || window.Combat?.animalAttacks?.isBusy(c));
  }

  function enemyCanSeeTarget(c, target, maxDistancePx = Infinity) {
    if (!target || target.health <= 0 || Math.hypot(target.x - c.x, target.y - c.y) > maxDistancePx) return false;
    return window.Combat?.targetInsideAttackCone?.(c, target, c.facing || 0) ?? true;
  }

  function beginEnemySearch(c, target) {
    c.state = 'searching';
    c.targetPlayer = target;
    c._enemySearchT = ENEMY_SEARCH_DURATION_S; // Countdown used by updateEnemySearch before the hostile gives up and returns.
    c._enemySearchCenterFacing = c.facing || 0; // Sweep origin remembers the heading where sight was lost.
    c._enemySearchOffset = 0; // Signed scan displacement accumulated around the remembered heading.
    const lostSide = angleDiff(Math.atan2(target.y - c.y, target.x - c.x), c.facing || 0);
    c._enemySearchDirection = lostSide >= 0 ? 1 : -1; // First scan turns toward the side where the player disappeared.
  }

  function updateEnemySearch(c, dt, target) {
    c._enemySearchT = Math.max(0, (c._enemySearchT || 0) - dt);
    if (enemyCanSeeTarget(c, target, c.def.aggroRangePx)) {
      c.state = 'chase';
      c.targetPlayer = target;
      return c.facing || 0;
    }
    const turnMultiplier = window.Combat?.postAttackTurnMultiplier?.(c) ?? 1; // Search honors the same post-attack recovery slowdown.
    c._enemySearchOffset = (c._enemySearchOffset || 0) + (c._enemySearchDirection || 1) * ENEMY_SEARCH_TURN_RATE_RAD_S * turnMultiplier * dt;
    if (Math.abs(c._enemySearchOffset) >= ENEMY_SEARCH_SWEEP_HALF_RAD) {
      c._enemySearchOffset = window.FormatUtils.clamp(c._enemySearchOffset, -ENEMY_SEARCH_SWEEP_HALF_RAD, ENEMY_SEARCH_SWEEP_HALF_RAD);
      c._enemySearchDirection *= -1;
    }
    c.facing = (c._enemySearchCenterFacing || 0) + c._enemySearchOffset;
    if (c._enemySearchT <= 0) {
      c.state = 'return';
      c.targetPlayer = null;
    }
    return c.facing;
  }

  function enemyAttackAlignment(c, target, dt) {
    return window.Combat?.attackAlignmentStep?.(c, target, dt, {
      turnMultiplier: window.Combat?.postAttackTurnMultiplier?.(c) ?? 1,
    }) || { eligible: true, aligned: true, desiredFacing: Math.atan2(target.y - c.y, target.x - c.x), nextFacing: c.facing || 0 };
  }

  window.EnemySearchAI = Object.freeze({
    enemyAttackBusy,
    enemyCanSeeTarget,
    beginEnemySearch,
    updateEnemySearch,
    enemyAttackAlignment,
    ENEMY_SEARCH_DURATION_S,
    ENEMY_SEARCH_SWEEP_HALF_RAD,
    ENEMY_SEARCH_TURN_RATE_RAD_S,
  });
})();
