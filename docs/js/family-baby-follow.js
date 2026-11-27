// Baby wilderness follow adapter. The NPC remains the sole physical actor;
// the companion-shaped object below is private navigation state, not combat or stable membership.
(() => {
  'use strict';
  if (window.FamilyBabyFollow) return;
  const CRAWL_SPEED_TILES = 0.25; // Slow average ground speed, in tiles per second.
  const TODDLER_WALK_FALLBACK_TILES = 1.25; // Used only when the normal NPC walker exposes neither an authored nor measured walking speed.
  const STOP_TILES = 0.7; // Stop within easy pickup range of the parent.
  let deps = null; // Game supplies the existing companion movement and current world.
  let bound = new Map(); // Only currently spawned family infants; no per-frame world scan.
  const debug = { latestChange: 'Infants crawl; toddlers use ordinary NPC gait and age-specific footing while following', lastEvent: null, recoveries: 0 };
  function init(injected) { deps = injected; }
  function isWilderness(area) { return deps?.isWilderness?.(area) === true; }
  function canFollowIn(area) { return isWilderness(area) || area === 'farm' || area === 'town'; }
  function scheduleTarget(child, phase = 'basket') {
    if (!child.followPlayer || child.carryBy || !child.carrySpot) return null;
    const spot = child.carrySpot;
    return { area: spot.area, c: spot.c, r: spot.r, activity: phase === 'toddler' ? 'toddling after you' : 'crawling after you', run: false };
  }
  function clearWalker(walker) {
    if (!walker) return;
    const entry = bound.get(walker); // Remove only the baby-owned animation and route.
    if (!entry) return;
    bound.delete(walker);
    walker._familyBabyFollowing = false;
    if (entry.phase === 'basket') window.PlayerCrawl?.clearNpc?.(walker);
    walker.resetRouteState?.();
  }
  function bind(child, walker, phase) {
    if (!walker) return;
    if ((phase !== 'basket' && phase !== 'toddler') || !child.followPlayer || child.carryBy) { clearWalker(walker); return; }
    for (const [old, entry] of bound) if (old !== walker && entry.child.id === child.id) clearWalker(old);
    const existing = bound.get(walker); // Retire the old pose owner on an age transition, but keep ordinary repeat binds cheap.
    if (existing?.phase === phase) { existing.child = child; return; }
    if (existing) clearWalker(walker);
    window.BedLiePose?.releaseNpc?.(walker); // Release any older floor/bed pose before taking the rig.
    if (walker._bedLieActive) { // releaseNpc retires bookkeeping, but does not undo its transform.
      walker._npcCharacterRigRoot?.rotation?.set(0, 0, 0);
      walker._npcCharacterRigRoot?.position?.set(0, 0, 0);
      walker._bedLieActive = false;
    }
    if (walker._npcRunLeanActive) { walker._npcRunLeanPivot?.quaternion?.identity(); walker._npcRunLeanActive = false; }
    if (walker._npcMotionLookActive || walker._ambientLookActive) {
      walker.neckJoint?.rotation?.set(0, 0, 0);
      walker._npcMotionLookActive = false; walker._ambientLookActive = false;
      window.PerpRotation?.clearHeadtrackHint?.(walker.perpState);
    }
    // Resolve the ordinary walk baseline once, before follower motion overwrites measured speed.
    const explicitPx = Number(walker.walkSpeedPxS || walker.moveSpeedPxS || walker.rec?.walkSpeedPxS || walker.rec?.moveSpeedPxS);
    const explicitTiles = Number(walker.walkSpeedTilesPerSecond || walker.moveSpeedTilesPerSecond || walker.rec?.walkSpeedTilesPerSecond || walker.rec?.moveSpeedTilesPerSecond);
    const measured = Number(walker._moveSpeedTiles) / Math.max(.35, Number(walker.catchup) || 1);
    const walkTiles = explicitTiles > 0 ? explicitTiles : explicitPx > 0 && deps?.TILE ? explicitPx / deps.TILE
      : measured > .02 && Number(walker.catchup) >= .35 ? measured : TODDLER_WALK_FALLBACK_TILES;
    bound.set(walker, { child, phase, walkTiles, actor: null }); // Actor state persists between frames for detours/recovery.
    walker._familyBabyFollowing = true;
    walker.resetRouteState?.();
  }
  function recordPosition(entry, walker) {
    const p = walker.root.position; // Save the same real NPC position used by carry interactions.
    const c = Math.floor(p.x), r = Math.floor(p.z);
    const old = entry.child.carrySpot;
    if (old?.area !== walker.area || old.c !== c || old.r !== r) {
      entry.child.carrySpot = { area: walker.area, c, r };
      entry.positionDirty = true; // Coalesce normal crawling saves, not only teleport saves.
    }
  }
  function followActor(entry, walker) {
    const p = walker.root.position;
    if (!entry.actor || entry.actor.areaId !== walker.area) {
      const speed = deps.TILE * (entry.phase === 'toddler' ? entry.walkTiles : CRAWL_SPEED_TILES); // Navigation remains shared, but gait speed is stage-specific.
      const def = { canClimb: false, canSwim: false, moveSpeed: speed, chaseSpeed: speed }; // Baby uses ordinary creature travel without active fighting or cliff hops.
      entry.actor = { id: entry.child.id, _familyBabyFollower: true, isCompanion: true, stableRole: 'companion',
        master: deps.player, areaId: walker.area, health: 1, def, halfHeight: 0.15, groundLift: 0,
        avatarRef: { group: walker.root }, vx: 0, vy: 0, state: 'idle' };
    }
    const actor = entry.actor;
    actor.x = p.x * deps.TILE; actor.y = p.z * deps.TILE;
    actor.areaGrid = deps.getActiveGrid?.();
    return actor;
  }
  function safeArrival(area) {
    if (!deps || !canFollowIn(area)) return null;
    const player = deps.player, tile = deps.TILE, angle = Number(player.angle) || 0;
    const pc = Math.floor(player.x / tile), pr = Math.floor(player.y / tile);
    const c = Math.floor(player.x / tile + Math.cos(angle + Math.PI) * 1.4);
    const r = Math.floor(player.y / tile + Math.sin(angle + Math.PI) * 1.4);
    const grid = deps.getActiveGrid?.(), ownerTile = grid?.[pr]?.[pc];
    const ownerY = deps.surfaceY(area, pc, pr);
    const probe = { _familyBabyFollower: true, areaId: area, areaGrid: grid, def: { canSwim: false, canClimb: false } };
    for (let radius = 0; radius <= 4; radius++) {
      for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
        const tc = c + dx, tr = r + dz, ground = grid?.[tr]?.[tc];
        if (!ground || ground.incline || (ownerTile && (ground.elevTier || 0) !== (ownerTile.elevTier || 0))) continue;
        if (Math.abs(deps.surfaceY(area, tc, tr) - ownerY) > 0.55) continue;
        if (deps.canEnter && !deps.canEnter(probe.def, (tc + .5) * tile, (tr + .5) * tile, NaN, NaN, probe, true)) continue;
        return { area, c: tc, r: tr };
      }
    }
    return null; // Wait for a safe companion-style arrival rather than spawning inside terrain.
  }
  function safeLanding(area, c, r) {
    if (area !== deps?.getCurrentArea?.() || !canFollowIn(area)) return null;
    const grid = deps.getActiveGrid?.(), tile = deps.TILE;
    const probe = { _familyBabyFollower: true, areaId: area, areaGrid: grid, def: { canSwim: false, canClimb: false } }; // Same collision authority as moving infants.
    if (grid?.[r]?.[c] && !grid[r][c].incline && deps.canEnter?.(probe.def, (c + .5) * tile, (r + .5) * tile, NaN, NaN, probe, true)) return { area, c, r };
    return safeArrival(area); // An invalid throw/drop never strands a baby in water or a wall.
  }
  function savedCarrySpot() {
    const area = deps?.getCurrentArea?.();
    return canFollowIn(area) ? safeArrival(area) : null; // Farm and town saves also restore the dropped follower safely.
  }
  function updateWalker(walker, dt) {
    const entry = bound.get(walker);
    if (!entry || !deps || !walker.root) return false;
    if (!entry.child.followPlayer || entry.child.carryBy) { clearWalker(walker); return false; }
    if (window.FamilyBabyBurdens?.isProxyActive?.(entry.child.id)) return true; // The thrown/held burden owns the baby until landing.
    const area = deps.getCurrentArea();
    if (walker.area !== area) {
      // Companions reappear behind the owner when changing maps. Keep the SAME NPC and use its
      // native transfer/nearest-walkable placement instead of respawning a family member.
      if (canFollowIn(area) && deps.isAreaSettled?.() !== false) {
        entry.arrivalRetry = Math.max(0, (entry.arrivalRetry || 0) - dt);
        if (entry.arrivalRetry > 0) return true;
        const arrival = safeArrival(area);
        if (!arrival) { entry.arrivalRetry = 0.5; return true; } // Never scan a blocked entry every frame.
        walker.transferToArea?.(area, arrival);
        entry.actor = null; entry.heading = null; entry.movedLastFrame = false;
        recordPosition(entry, walker);
        window.FamilyBabyBurdens?.syncFollowingWalker?.(entry.child.id);
        deps.scheduleMemberSave?.();
        debug.lastEvent = 'transferred ' + entry.child.id + ' to ' + area;
      }
      return true; // Never let the ordinary schedule drag a following infant to its basket.
    }
    if (!canFollowIn(area) || deps.isAreaSettled?.() === false) return true;
    const actor = followActor(entry, walker), nav = window.CompanionFollowNavigation;
    if (!nav) return true;
    const goal = nav.goal(actor, deps.player);
    const beforeX = actor.x, beforeY = actor.y;
    const chasing = goal.routeRequired || goal.distance > deps.TILE * STOP_TILES;
    const heading = entry.movedLastFrame && Number.isFinite(entry.heading) ? entry.heading : Math.atan2(goal.y - actor.y, goal.x - actor.x);
    const toddler = entry.phase === 'toddler'; // Only infants acquire the crawl limb/hand pose provider.
    const tumbling = toddler && walker._toddleTumbleUntil > performance.now();
    const pull = toddler ? Number(walker.catchup) : window.PlayerCrawl?.poseNpc?.(walker, dt, chasing, heading);
    const pace = tumbling ? 0 : Number.isFinite(pull) ? Math.max(0, pull) : 1; // Same low-footing catchup multiplier used by ordinary toddler walking.
    if (chasing && pace > 0) {
      const walkSpeed = toddler ? deps.getToddlerWalkSpeed?.(walker) : null; // Live ordinary NPC pace includes shared drunkenness/yawn modifiers.
      const speed = Number.isFinite(walkSpeed) && walkSpeed >= 0 ? walkSpeed * deps.TILE : actor.def.chaseSpeed;
      deps.travelCreatureToward(actor, goal.x, goal.y, speed * pace, dt);
    } else { actor.vx = 0; actor.vy = 0; }
    const recovered = !tumbling && nav.tickRecovery(actor, deps.player, goal, dt); // Exact animal companion unseen-stall timing and safe candidate search.
    const p = walker.root.position;
    p.x = actor.x / deps.TILE; p.z = actor.y / deps.TILE;
    const surface = deps.surfaceY(area, Math.floor(p.x), Math.floor(p.z));
    if (Number.isFinite(surface)) p.y = recovered ? surface : p.y + (surface - p.y) * (1 - Math.exp(-13.4 * dt));
    const moved = !recovered && Math.hypot(actor.x - beforeX, actor.y - beforeY) > 0.001;
    if (moved) {
      entry.heading = Math.atan2(actor.y - beforeY, actor.x - beforeX); // The actual detour, not the unobstructed target direction.
      if (toddler) {
        walker.applyFacingDeadzone?.(-entry.heading + Math.PI / 2, 0.15); // Existing upright NPC facing convention.
        if (Number.isFinite(walker.rot)) walker.root.rotation.y = walker.rot;
      } else {
        // Crawl owns absolute body yaw and both leg chains.
        walker.desiredRot = -entry.heading;
      }
    }
    entry.movedLastFrame = moved;
    walker._moveSpeedTiles = moved && dt > 0 ? Math.hypot(actor.x - beforeX, actor.y - beforeY) / deps.TILE / dt : 0;
    if (toddler) {
      walker.legs?.update?.(dt, walker._moveSpeedTiles, false); // Normal procedural NPC feet, not the infant crawl.
      if (moved) walker._tickFootsteps?.(walker._moveSpeedTiles * dt);
    }
    walker._legsPrevX = p.x; walker._legsPrevZ = p.z;
    walker.currentScheduleTarget = null; walker._bedLieSurface = null;
    recordPosition(entry, walker);
    entry.saveElapsed = (entry.saveElapsed || 0) + dt;
    if (recovered || (entry.positionDirty && entry.saveElapsed >= 5)) {
      entry.positionDirty = false; entry.saveElapsed = 0; deps.scheduleMemberSave?.();
    }
    if (recovered) { debug.recoveries++; debug.lastEvent = 'recovered ' + entry.child.id; }
    if (moved || recovered) window.FamilyBabyBurdens?.syncFollowingWalker?.(entry.child.id); // Only move the pickup proxy when the actual NPC moved.
    return true;
  }
  function clear() { for (const walker of bound.keys()) clearWalker(walker); }
  window.FamilyBabyFollow = Object.freeze({ init, isWilderness, canFollowIn, scheduleTarget, safeLanding, savedCarrySpot, bind, updateWalker, clearWalker, clear,
    snapshot: () => ({ ...debug, speedTiles: CRAWL_SPEED_TILES, babies: [...bound].map(([walker, entry]) => ({
      id: entry.child.id, phase: entry.phase, gait: entry.phase === 'toddler' ? 'walk' : 'crawl', walkTiles: entry.phase === 'toddler' ? entry.walkTiles : undefined, area: walker.area, position: entry.child.carrySpot, stalled: entry.actor?._companionStuckRecovery?.stalled || 0
    })) })
  });
})();
