// Companion following and conservative off-screen stuck recovery.
// One decision module; game.js remains the only AI/frame and movement executor.
(() => {
  'use strict';
  let deps = null; // Injected once by game.js; reads the live area, camera and creature collision authority.
  const FAR_TILES = 4.5; // Only animals meaningfully separated from their owner accrue recovery time.
  const STALL_SECONDS = 8; // A blocked follower gets a real pathfinding/catch-up opportunity first.
  const RETRY_SECONDS = 1.5; // Failed off-screen searches do not run every animation frame.
  const COOLDOWN_SECONDS = 18; // A successful recovery cannot repeat on another frame or nearby obstacle.
  const PROGRESS_TILES = 0.7; // Substantial gap reduction proves the animal is still making progress.
  const Y_TOLERANCE = 0.2; // Recovery in a stacked ruin must land on the owner's exact physical floor.
  const UNSAFE_TYPES = new Set(['rock', 'wall', 'river', 'stream', 'trench', 'water', 'lava', 'pit', 'chasm', 'void', 'abyss']);
  const RADII = [4, 5.5, 7, 8.5, 10]; // Search behind/outside the camera, but still near the owner.
  const ANGLES = 16; // Bounded candidate count; no pathfinding or scene-wide scan.
  const debug = { teleports: 0, lastEvent: null, lastFailure: null };

  function init(injected) { deps = injected || null; }
  function area() { return deps?.getCurrentArea?.(); }
  function activeGrid(c) { return c?.areaGrid || deps?.getActiveGrid?.() || null; }
  function tileAt(grid, x, y, tile) { return grid?.[Math.floor(y / tile)]?.[Math.floor(x / tile)] || null; }
  function groundDestination(master) {
    const landing = !!master?.climbing && Number.isFinite(master.climbEndX) && Number.isFinite(master.climbEndY);
    return { x: landing ? master.climbEndX : master?.x, y: landing ? master.climbEndY : master?.y };
  }

  function groundInfo(c, master, requestedArea = area()) {
    if (!deps || requestedArea !== area() || !deps.isZoneArea?.(requestedArea)) return null;
    const tile = deps.TILE, grid = activeGrid(c), end = groundDestination(master);
    if (!Number.isFinite(tile) || tile <= 0 || !grid || ![c?.x, c?.y, end.x, end.y].every(Number.isFinite)) return null;
    const from = tileAt(grid, c.x, c.y, tile), to = tileAt(grid, end.x, end.y, tile);
    if (!from || !to || from.incline || to.incline) return null;
    const network = window.CliffRouteNetwork?.forArea?.(requestedArea);
    const a = network && window.CliffRouteNetwork?.componentAt?.(network, Math.floor(c.x / tile), Math.floor(c.y / tile));
    const b = network && window.CliffRouteNetwork?.componentAt?.(network, Math.floor(end.x / tile), Math.floor(end.y / tile));
    return { fromTier: Number(from.elevTier) || 0, toTier: Number(to.elevTier) || 0,
      separatePlatforms: Number.isInteger(a) && a >= 0 && Number.isInteger(b) && b >= 0 && a !== b };
  }

  function descentState(c, master, requestedArea = area()) {
    if (!c?.isCompanion || c.banditCompanion || (c.stableRole && c.stableRole !== 'companion') ||
        !master || (c.areaId && c.areaId !== requestedArea)) return null;
    if (!deps?.isZoneArea?.(requestedArea) || area() !== requestedArea) return null;
    const info = groundInfo(c, master, requestedArea);
    if (!info) return c._followOwnerDownCliff && (c._cliffClimb || c._cliffRouteTravel)
      ? { above: false, inProgress: true, sameTier: false } : null; // Midair incline does not end retreat.
    return { above: info.fromTier > info.toTier, sameTier: info.fromTier === info.toTier,
      separatePlatforms: info.separatePlatforms };
  }

  function goal(c, master) {
    const end = groundDestination(master); // A moving owner's climb landing, not their current midair body position.
    const info = groundInfo(c, master); // Cached route graph also detects disconnected equal-height shelves.
    return { x: end.x, y: end.y, distance: Math.hypot(end.x - c.x, end.y - c.y),
      routeRequired: !!info && (info.fromTier !== info.toTier || info.separatePlatforms) ||
        !!c._cliffClimb || !!c._cliffRouteTravel };
  }

  function worldVisible(camera, worldPoint) {
    if (!camera || !worldPoint) return true; // Unknown projection is NOT permission for a visible teleport.
    let p = null;
    if (window.THREE?.Vector3 && camera.projectionMatrix) {
      p = new window.THREE.Vector3(worldPoint.x, worldPoint.y, worldPoint.z).project(camera);
    } else if (typeof camera.projectPoint === 'function') p = camera.projectPoint(worldPoint);
    if (!p || ![p.x, p.y, p.z].every(Number.isFinite)) return true;
    return p.z >= -1 && p.z <= 1 && Math.abs(p.x) <= 1.2 && Math.abs(p.y) <= 1.2;
  }

  function hiddenAt(camera, x, z, footY, height = 1.25) {
    return !worldVisible(camera, { x, y: footY + 0.12, z }) &&
      !worldVisible(camera, { x, y: footY + Math.max(0.9, height), z });
  }

  function floorForOwner(master, currentArea) {
    if (currentArea === 'map_i_dev_random_ruin') {
      const floor = window.DevRandomRuin?.getPlayerGroundSupportY?.();
      return Number.isFinite(floor) ? floor : null; // The actual player support, never the highest overlapping story.
    }
    return null;
  }

  function recoveryCandidate(c, master, camera, currentArea, tile, ownerFloor) {
    const grid = activeGrid(c), ruin = currentArea === 'map_i_dev_random_ruin';
    if (!grid || !Number.isFinite(tile) || tile <= 0) return null;
    const masterTile = tileAt(grid, master.x, master.y, tile);
    if (!masterTile) return null;
    const ownerSurface = ruin ? ownerFloor : deps.surfaceYForTile?.(masterTile, currentArea);
    if (!Number.isFinite(ownerSurface)) return null;
    const probe = { x: master.x, y: master.y, areaId: currentArea, areaGrid: grid,
      def: c.def, shaftSupportY: ownerSurface }; // Test creature volume against the owner's story, not the pet's abandoned floor.
    const DS = window.DynamicSurfaces; // Reuses the actual generated ruin floors, pitfalls and blockers.
    let pathAttempts = 0; // Caps expensive ruin path validations to a few hidden candidates per retry.
    for (const radius of RADII) for (let i = 0; i < ANGLES; i++) {
      const angle = (i + (Math.floor(radius) % 2) * 0.5) * Math.PI * 2 / ANGLES;
      const px = master.x + Math.cos(angle) * radius * tile;
      const py = master.y + Math.sin(angle) * radius * tile;
      const ground = tileAt(grid, px, py, tile);
      if (!ground || ground.incline || UNSAFE_TYPES.has(String(ground.type).toLowerCase()) ||
          (Number(ground.water) || 0) >= 0.003 || window.MapBoundaryGuard?.isBoundaryTile?.(ground)) continue;
      const x = px / tile, z = py / tile;
      if (ruin) {
        const support = DS?.sampleSupport?.(x, z,
          { minY: ownerSurface - Y_TOLERANCE, maxY: ownerSurface + Y_TOLERANCE, pad: 0 });
        if (!support || Math.abs(support.y - ownerSurface) > Y_TOLERANCE ||
            DS?.pointInPit?.(x, z, 0.12) ||
            window.DevRandomRuin?.shaftBodyBlocksAtFeet?.(x, z, 0.2, ownerSurface)) continue;
        if (window.DevRandomRuin?.shaftCreatureCanEnter?.(probe, px, py, true) === false) continue;
      } else {
        const surface = deps.surfaceYForTile?.(ground, currentArea);
        if (!Number.isFinite(surface) || Math.abs(surface - ownerSurface) > 0.55) continue;
      }
      if (DS?.blockerAt?.(x, z, { radius: 0.2, actorHeight: 1.25 })) continue;
      if (!deps.creatureCanEnter?.(c.def, px, py, NaN, NaN, probe, true)) continue;
      if (!hiddenAt(camera, x, z, ownerSurface, c.halfHeight * 2 || 1.25)) continue;
      if (ruin) {
        const navigator = window.TilePathfinding; // Existing tile navigator proves a floor-matched path back to the owner.
        if (!navigator?.findPath || !navigator?.boxAround) continue; // Never teleport into an isolated locked chamber.
        if (++pathAttempts > 4) return null; // Avoid dozens of dungeon-wide A* probes on an already slow frame.
        const startCol = Math.floor(px / tile), startRow = Math.floor(py / tile);
        const goalCol = Math.floor(master.x / tile), goalRow = Math.floor(master.y / tile);
        const path = navigator.findPath(startCol, startRow, goalCol, goalRow, (col, row) => {
          const tx = (col + 0.5) * tile, ty = (row + 0.5) * tile;
          const surface = DS?.sampleSupport?.(tx / tile, ty / tile, {
            minY: ownerSurface - Y_TOLERANCE, maxY: ownerSurface + Y_TOLERANCE, pad: 0,
          }); // A path on a different overlapping shaft story does not count.
          return !!surface && !DS?.pointInPit?.(tx / tile, ty / tile, 0.12) &&
            !DS?.blockerAt?.(tx / tile, ty / tile, { radius: 0.2, actorHeight: 1.25 }) &&
            !window.DevRandomRuin?.shaftBodyBlocksAtFeet?.(tx / tile, ty / tile, 0.2, ownerSurface) &&
            window.DevRandomRuin?.shaftCreatureCanEnter?.(probe, tx, ty, true) !== false &&
            !!deps.creatureCanEnter?.(c.def, tx, ty, NaN, NaN, probe, true);
        }, { bounds: navigator.boxAround(startCol, startRow, goalCol, goalRow, 3), maxNodes: 550 });
        if (!path) continue;
      }
      return { x: px, y: py, supportY: ownerSurface };
    }
    return null;
  }

  function tryRecover(c, master, currentArea) {
    const camera = deps.getCamera?.(); // Uses the active real game camera, including zoom and camera rotation.
    if (!camera) { debug.lastFailure = 'no camera'; return false; }
    const tile = deps.TILE, ruin = currentArea === 'map_i_dev_random_ruin';
    const ownerFloor = floorForOwner(master, currentArea);
    const grid = activeGrid(c);
    const petTile = tileAt(grid, c.x, c.y, tile);
    const modelPos = c.avatarRef?.group?.position; // A smoothed pet portrait can supply a last-known ruin feet height.
    const rawPetFloor = c.shaftSupportY ?? c.surfaceYOverride?.();
    const petFloor = ruin ? (Number.isFinite(Number(rawPetFloor)) && rawPetFloor != null
      ? Number(rawPetFloor) : modelPos && Number.isFinite(modelPos.y)
        ? modelPos.y - (c.groundLift ?? c.halfHeight ?? 0) : null)
      : deps.surfaceYForTile?.(petTile, currentArea);
    if (ruin && (!Number.isFinite(ownerFloor) || !Number.isFinite(petFloor))) {
      debug.lastFailure = 'unknown ruin story'; return false;
    }
    const petY = Number.isFinite(petFloor) ? petFloor : 0;
    const groupPos = c.avatarRef?.group?.position;
    if (!hiddenAt(camera, c.x / tile, c.y / tile, petY, c.halfHeight * 2 || 1.25) ||
        (groupPos && !hiddenAt(camera, groupPos.x, groupPos.z,
          groupPos.y - (c.groundLift ?? c.halfHeight ?? 0), c.halfHeight * 2 || 1.25))) {
      debug.lastFailure = 'companion currently visible'; return false;
    }
    const candidate = recoveryCandidate(c, master, camera, currentArea, tile, ownerFloor);
    if (!candidate) { debug.lastFailure = 'no unseen safe landing on owner floor'; return false; }
    window.Combat?.animalAttacks?.cancel?.(c); // Clear all movement-owning attack and route state before relocating.
    window.Combat?.telegraph?.cancel?.(c);
    window.Combat?.cancelStagedForAttacker?.(c);
    c._animalAttack = null;
    c._stage = null;
    c._cliffClimb = null; c._cliffRouteTravel = null; c._cliffEntryPath = null;
    c._travelPath = null; c._travelPathTarget = null; c._travelStuckT = 0;
    c._companionCombatTarget = null; c._companionCombatPriority = null;
    c._honeyfuzzleRescueTarget = null;
    c.x = candidate.x; c.y = candidate.y; c.vx = 0; c.vy = 0;
    c.knockbackT = 0; c.knockbackVX = 0; c.knockbackVY = 0;
    if (ruin) c.shaftSupportY = candidate.supportY;
    const group = c.avatarRef?.group;
    if (group) {
      group.position.x = c.x / tile; group.position.z = c.y / tile;
      group.position.y = candidate.supportY + (c.groundLift ?? c.halfHeight ?? 0);
    }
    debug.teleports++;
    debug.lastEvent = { companion: c.id || c.creatureKey || 'animal', area: currentArea,
      x: c.x, y: c.y, floor: candidate.supportY };
    debug.lastFailure = null;
    window.__farmLog?.('[companion-follow] stuck follower recovered offscreen near owner', 'wildlife');
    return true;
  }

  function tickRecovery(c, master, followGoal, dt) {
    if (!deps || !c?.isCompanion || c.banditCompanion || c.stableRole !== 'companion' ||
        (c.master || deps.player) !== deps.player || c.health <= 0 || c._downed ||
        !master || ![c.x, c.y, master.x, master.y].every(Number.isFinite)) return false;
    const currentArea = area(), tile = deps.TILE, ruin = currentArea === 'map_i_dev_random_ruin';
    if (c.areaId !== currentArea || (!ruin && !deps.isZoneArea?.(currentArea) &&
        currentArea !== 'farm' && currentArea !== 'town')) return false;
    const state = c._companionStuckRecovery || (c._companionStuckRecovery = {
      area: currentArea, owner: master, stalled: 0, retry: 0, cooldown: 0, bestDistance: Infinity
    }); // Actor-local progress tracks the real companion across frames; no global scan.
    if (state.area !== currentArea || state.owner !== master) {
      state.area = currentArea; state.owner = master; state.stalled = 0; state.retry = 0;
      state.cooldown = 0; state.bestDistance = Infinity;
    }
    const elapsed = Math.min(0.1, Math.max(0, Number(dt) || 0)); // Pause/hitches cannot instantly trigger recovery.
    state.cooldown = Math.max(0, state.cooldown - elapsed);
    const far = Number(followGoal?.distance) > tile * FAR_TILES;
    const playerFloor = ruin ? floorForOwner(master, currentArea) : null;
    const rawPetFloor = c.shaftSupportY ?? c.surfaceYOverride?.();
    const modelPos = c.avatarRef?.group?.position; // Fallback only when the ruin has not yet assigned a shaft support to this pet.
    const petFloor = ruin ? (rawPetFloor != null && Number.isFinite(Number(rawPetFloor))
      ? Number(rawPetFloor) : modelPos && Number.isFinite(modelPos.y)
        ? modelPos.y - (c.groundLift ?? c.halfHeight ?? 0) : null) : null;
    const differentFloor = ruin && Number.isFinite(playerFloor) && Number.isFinite(petFloor) &&
      Math.abs(playerFloor - petFloor) > 0.75;
    const unable = c.prone || c._knockbackLedgeFall || c._cliffClimb || c._cliffRouteTravel ||
      c.knockbackT > 0 || c._animalAttack ||
      window.Combat?.telegraph?.isBusy?.(c) || c._honeyfuzzleRescueTarget ||
      c._companionCombatTarget || c.treasureCue || master.climbing || master._freeJump;
    if ((!far && !differentFloor) || unable) {
      state.stalled = 0; state.retry = 0; state.bestDistance = Infinity; return false;
    }
    const remaining = Math.max(0, Number(followGoal?.distance) || 0) +
      (differentFloor ? tile * 4 : 0);
    if (remaining < state.bestDistance - tile * PROGRESS_TILES) {
      state.bestDistance = remaining; state.stalled = 0; state.retry = 0;
    } else if (state.bestDistance === Infinity) state.bestDistance = remaining;
    state.stalled += elapsed;
    if (state.stalled < STALL_SECONDS || state.cooldown > 0) return false;
    state.retry -= elapsed;
    if (state.retry > 0) return false;
    state.retry = RETRY_SECONDS;
    if (!tryRecover(c, master, currentArea)) return false;
    state.stalled = 0; state.retry = 0; state.cooldown = COOLDOWN_SECONDS;
    state.bestDistance = Infinity;
    return true;
  }

  window.CompanionFollowNavigation = Object.freeze({
    init, goal, descentState, tickRecovery,
    debugSnapshot: () => ({ ...debug }),
    tuning: Object.freeze({ FAR_TILES, STALL_SECONDS, COOLDOWN_SECONDS, PROGRESS_TILES }),
  });
})();
