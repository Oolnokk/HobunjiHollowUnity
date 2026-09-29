(() => {
  'use strict';

  // Pinned-enemy collision escape used by game.js's moveCreatureToward.
  // Axis-separated movement already slides a creature along a wall; when a
  // chasing enemy is still genuinely stuck (it achieved less than
  // MIN_MOVE_FRAC of its step on a blocked frame), tryReposition spends the
  // remaining step on one short lateral sidestep, or failing that a backoff,
  // remembering the successful side so the escape stays stable across frames.
  // Extracted out of game.js following the same window.<Namespace> +
  // init(deps) pattern as its sibling systems; deps.creatureCanEnterTile is
  // game.js's own tile/volume passability test.
  let deps = null;

  function init(injectedDeps) { deps = injectedDeps; }

  const ENEMY_COLLISION_REPOSITION_MIN_MOVE_FRAC = 0.25; // Used by moveCreatureToward to distinguish useful wall-sliding from a combatant that is genuinely pinned at a collision point.
  const ENEMY_COLLISION_REPOSITION_FORWARD_MUL = 0.35; // Used by tryEnemyCollisionReposition to keep the first escape choice mostly lateral while retaining some progress toward its target.
  const ENEMY_COLLISION_REPOSITION_SIDE_MUL = 0.94; // Used with the forward multiplier to produce the short around-the-corner sidestep vector.
  const ENEMY_COLLISION_REPOSITION_BACK_MUL = -0.35; // Used by the fallback escape choice so a boxed-in enemy can give ground before trying the same side again.

  function enemyCollisionRepositionSide(c) {
    if (c._collisionRepositionSide === -1 || c._collisionRepositionSide === 1) return c._collisionRepositionSide;
    const identity = String(c.id || c.name || c.creatureKey || c.def?.id || 'enemy'); // Used only to pick a deterministic initial left/right preference without consuming gameplay RNG.
    let hash = 0; // Used to spread nearby enemies across opposite initial sidestep directions rather than making every actor choose the same side.
    for (let i = 0; i < identity.length; i++) hash = ((hash * 31) + identity.charCodeAt(i)) | 0;
    c._collisionRepositionSide = (hash & 1) ? 1 : -1;
    return c._collisionRepositionSide;
  }

  function tryEnemyCollisionReposition(c, nx, ny, step, blockedX, blockedY) {
    if (!(step > 0) || (c.state !== 'chase' && c.state !== 'patrol-chase')) return null;
    const preferredSide = enemyCollisionRepositionSide(c); // Used by both escape arcs so direction remains stable across consecutive blocked frames.
    const sideOrder = [preferredSide, -preferredSide]; // Used to try the remembered side first, then immediately recover if that side is the obstructed one.
    const escapeProfiles = [
      { forward: ENEMY_COLLISION_REPOSITION_FORWARD_MUL, mode: 'sidestep' },
      { forward: ENEMY_COLLISION_REPOSITION_BACK_MUL, mode: 'backoff' },
    ]; // Used to prefer a lateral around-obstacle move before conceding distance from the combat target.
    for (const profile of escapeProfiles) {
      for (const side of sideOrder) {
        const rawX = nx * profile.forward + (-ny) * ENEMY_COLLISION_REPOSITION_SIDE_MUL * side; // Used to rotate the requested movement toward this candidate escape side.
        const rawY = ny * profile.forward + nx * ENEMY_COLLISION_REPOSITION_SIDE_MUL * side; // Used with rawX as the matching 2D escape vector.
        const length = Math.max(0.001, Math.hypot(rawX, rawY)); // Used to keep every escape attempt at the same remaining per-frame movement budget.
        const escapeNX = rawX / length, escapeNY = rawY / length; // Used for both the collision probe and velocity reported to animation.
        const escapeX = c.x + escapeNX * step, escapeY = c.y + escapeNY * step; // Used as the local reposition destination rather than a persistent AI target.
        if (!deps.creatureCanEnterTile(c.def, escapeX, escapeY)) continue;
        c.x = escapeX;
        c.y = escapeY;
        c._collisionRepositionSide = side;
        c._collisionRepositionDebug = { // Mobile-readable entity state showing the most recent successful collision escape.
          active: true,
          mode: profile.mode,
          blockedX: !!blockedX,
          blockedY: !!blockedY,
          side,
          movedPx: step,
          atMs: performance.now(),
        };
        return { nx: escapeNX, ny: escapeNY, moved: step };
      }
    }
    c._collisionRepositionDebug = { // Records a failed escape too, which makes "still pinned" distinguishable from the helper never running.
      active: true,
      mode: 'blocked',
      blockedX: !!blockedX,
      blockedY: !!blockedY,
      side: preferredSide,
      movedPx: 0,
      atMs: performance.now(),
    };
    return null;
  }

  window.EnemyCollisionReposition = {
    init,
    MIN_MOVE_FRAC: ENEMY_COLLISION_REPOSITION_MIN_MOVE_FRAC,
    tryReposition: tryEnemyCollisionReposition,
    repositionSide: enemyCollisionRepositionSide,
  };
})();
