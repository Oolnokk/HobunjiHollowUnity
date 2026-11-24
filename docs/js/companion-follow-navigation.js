// Companion following, distance-limited catch-up and conservative off-screen stuck recovery.
// One decision module; game.js remains the only AI/frame and movement executor.
(() => {
  'use strict';
  let deps = null; // Injected once by game.js; reads the live area, camera and creature collision authority.
  const FAR_TILES = 2.6; // Above the normal 2.2-tile follow radius: even a nearby blocked ruin hallway can trigger recovery.
  const HARD_FAR_TILES = 18; // Excessive separation bypasses the stall timer for player-owned animals.
  const HARD_COOLDOWN_SECONDS = 3; // Fast travel can open another large gap before the normal recovery cooldown expires.
  const STALL_SECONDS = 8; // A blocked follower gets a real pathfinding/catch-up opportunity first.
  const RUIN_PATH_BUDGET = 4; // Per-retry A* budget; resume at the next candidate when exhausted.
  const RETRY_SECONDS = 1.5; // Failed off-screen searches do not run every animation frame.
  const COOLDOWN_SECONDS = 18; // A successful recovery cannot repeat on another frame or nearby obstacle.
  const PROGRESS_TILES = 0.7; // Substantial gap reduction proves the animal is still making progress.
  const Y_TOLERANCE = 0.2; // Recovery in a stacked ruin must land on the owner's exact physical floor.
  const UNSAFE_TYPES = new Set(['rock', 'wall', 'river', 'stream', 'trench', 'water', 'lava', 'pit', 'chasm', 'void', 'abyss']);
  const RADII = [4, 5.5, 7, 8.5, 10]; // Search behind/outside the camera, but still near the owner.
  const ANGLES = 16; // Preserve the existing infant recovery search.
  const REAR_RADII = [2.5, 3.25, 4, 5.5, 7, 8.5, 10, 12, 14]; // Closest hidden rear landing first, including wider camera zooms.
  const REAR_OFFSETS = [0, 1, -1, 2, -2, 3, -3]; // Rear cone, directly behind first; at most 63 candidate probes.
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

  function project(camera, point) {
    let p = null; // Invalid or unavailable projection is never permission to teleport.
    if (window.THREE?.Vector3 && camera?.projectionMatrix) {
      p = new window.THREE.Vector3(point.x, point.y, point.z).project(camera);
    } else if (typeof camera?.projectPoint === 'function') p = camera.projectPoint(point);
    return p && [p.x, p.y, p.z].every(Number.isFinite) ? p : null;
  }

  // Transform each padded clip plane into world space once per recovery attempt.
  // Testing the whole conservative body box also works across the perspective near plane,
  // where dividing individual projected points by W can put a visible body on the wrong side.
  function recoveryPlanes(camera) {
    const projection = camera?.projectionMatrix?.elements, view = camera?.matrixWorldInverse?.elements;
    if (!projection || !view) return null;
    const planes = []; // Six inward-facing world planes, reused for all candidate probes.
    for (let axis = 0; axis < 3; axis++) for (const sign of [-1, 1]) {
      const margin = axis === 2 ? 1 : 1.2; // Preserve the existing offscreen padding.
      const p = [0, 0, 0, 0]; // Plane coefficients before world-space transformation.
      for (let j = 0; j < 4; j++) p[j] = margin * projection[j * 4 + 3] + sign * projection[j * 4 + axis];
      const plane = [0, 0, 0, 0]; // Column-major view matrix multiplies the clip-plane row.
      for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) plane[j] += p[k] * view[j * 4 + k];
      if (!plane.every(Number.isFinite) || Math.hypot(plane[0], plane[1], plane[2]) === 0) return null;
      planes.push(plane);
    }
    return planes;
  }

  function hiddenAt(camera, x, z, footY, c, planes) {
    if (![x, z, footY].every(Number.isFinite)) return false; // Invalid render coordinates cannot establish invisibility.
    const halfHeight = Math.max(0.45, Number(c.halfHeight) || 0.625); // Actual scaled portrait half-height.
    const lift = Number.isFinite(c.groundLift) ? c.groundLift : halfHeight; // Authored origin may differ from half-height.
    const width = Math.max(0, Number(c.visualModelWidth) || Number(c.def?.modelWidth) || 0); // Full scaled animal sprite width.
    const halfWidth = width * 0.5; // Conservative horizontal extent regardless of billboard yaw.
    const centerY = footY + lift; // World-space origin used by the actual avatar renderer.
    if (planes) return planes.some(([a, b, d, e]) =>
      a * x + b * centerY + d * z + e + (Math.abs(a) + Math.abs(d)) * halfWidth + Math.abs(b) * halfHeight < 0);
    if (camera?.projectionMatrix || camera?.matrixWorldInverse) return false; // Malformed real camera must fail closed.
    // Lightweight projection adapters (e.g. test fixtures) still require a common outside edge.
    const points = []; // Bound the complete portrait rather than two centerline points.
    for (const dx of halfWidth ? [-halfWidth, halfWidth] : [0])
      for (const dz of halfWidth ? [-halfWidth, halfWidth] : [0])
        for (const dy of [-halfHeight, halfHeight]) points.push(project(camera, { x: x + dx, y: centerY + dy, z: z + dz }));
    if (points.some(p => !p)) return false;
    return ['x', 'y', 'z'].some(axis => {
      const limit = axis === 'z' ? 1 : 1.2; // All corners must agree on which edge excludes the body.
      return points.every(p => p[axis] < -limit) || points.every(p => p[axis] > limit);
    });
  }

  function floorForOwner(master, currentArea) {
    if (currentArea === 'map_i_dev_random_ruin') {
      const floor = window.DevRandomRuin?.getPlayerGroundSupportY?.();
      return Number.isFinite(floor) ? floor : null; // The actual player support, never the highest overlapping story.
    }
    return null;
  }

  function recoveryCandidate(c, master, camera, currentArea, tile, ownerFloor, planes, state) {
    const grid = activeGrid(c), ruin = currentArea === 'map_i_dev_random_ruin';
    if (!grid || !Number.isFinite(tile) || tile <= 0) return null;
    const masterTile = tileAt(grid, master.x, master.y, tile);
    if (!masterTile) return null;
    const ownerSurface = ruin ? ownerFloor : deps.surfaceYForTile?.(masterTile, currentArea);
    if (!Number.isFinite(ownerSurface)) return null;
    const probe = { x: master.x, y: master.y, areaId: currentArea, areaGrid: grid,
      def: c.def, _familyBabyFollower: c._familyBabyFollower, shaftSupportY: ownerSurface }; // Test creature volume against the owner's story, not the pet's abandoned floor.
    const DS = window.DynamicSurfaces; // Reuses the actual generated ruin floors, pitfalls and blockers.
    const baby = !!c._familyBabyFollower; // Infant followers share recovery but retain their existing landing policy.
    const heading = Number.isFinite(master.angle) ? master.angle : Number.isFinite(master.facing) ? master.facing : null; // Player heading in pixel-space x/y.
    const rear = heading === null ? Math.atan2(c.y - master.y, c.x - master.x) : heading + Math.PI; // Rear cone orientation.
    const network = !baby && !ruin && deps.isZoneArea?.(currentArea)
      ? window.CliffRouteNetwork?.forArea?.(currentArea) : null; // Cached exterior graph, never a new path search.
    const ownerComponent = network && window.CliffRouteNetwork?.componentAt?.(network,
      Math.floor(master.x / tile), Math.floor(master.y / tile)); // Avoid disconnected equal-height cliff shelves.
    const radii = baby ? RADII : REAR_RADII; // Candidate ordering remains near-to-far.
    const angleCount = baby ? ANGLES : REAR_OFFSETS.length; // Fixed candidate fan size.
    const total = radii.length * angleCount; // Maximum probes in one full pass.
    const goalCol = Math.floor(master.x / tile), goalRow = Math.floor(master.y / tile); // Same-floor path destination.
    const searchKey = ruin ? Math.round(ownerSurface / Y_TOLERANCE) : null; // Floor changes restart near-first; moving/turning on the same floor must not starve later candidates.
    const start = ruin && state.searchKey === searchKey ? state.searchCursor || 0 : 0; // Positions and collision are recomputed from the live owner each time.
    state.searchKey = searchKey; state.searchCursor = 0;
    let pathAttempts = 0; // Caps expensive ruin path validations to a few hidden candidates per retry.
    const walkability = ruin ? new Map() : null; // Share collision results across the synchronous A* probes, never across frames.
    const triedTiles = ruin ? new Set() : null; // Multiple sampled offsets in one tile need only one A* proof.
    function cachedWalkable(col, row) {
      const key = col + ',' + row; // Reuse tile results across distinct start points within this attempt.
      if (walkability.has(key)) return walkability.get(key);
      const allowed = pathTileWalkable(col, row);
      walkability.set(key, allowed);
      return allowed;
    }
    function pathTileWalkable(col, row) {
      const tx = (col + 0.5) * tile, ty = (row + 0.5) * tile;
      const cell = tileAt(grid, tx, ty, tile); // A tile occupancy wall is impassable even if an underlying floor remains.
      if (!cell || cell.incline || UNSAFE_TYPES.has(String(cell.type).toLowerCase()) ||
          (Number(cell.water) || 0) >= 0.003 || window.MapBoundaryGuard?.isBoundaryTile?.(cell)) return false;
      const surface = DS?.sampleSupport?.(tx / tile, ty / tile, {
        minY: ownerSurface - Y_TOLERANCE, maxY: ownerSurface + Y_TOLERANCE, pad: 0,
      });
      return !!surface && Math.abs(surface.y - ownerSurface) <= Y_TOLERANCE && !DS?.pointInPit?.(tx / tile, ty / tile, 0.12) &&
        !DS?.blockerAt?.(tx / tile, ty / tile, { radius: 0.2, actorHeight: 1.25, worldY: surface.y, y: surface.y }) &&
        !window.DevRandomRuin?.shaftBodyBlocksAtFeet?.(tx / tile, ty / tile, 0.2, ownerSurface) &&
        window.DevRandomRuin?.shaftCreatureCanEnter?.(probe, tx, ty, true) !== false &&
        !!deps.creatureCanEnter?.(c.def, tx, ty, NaN, NaN, probe, true);
    }
    for (let step = 0; step < total; step++) {
      const index = (start + step) % total; // A failed bounded batch resumes at the next point on the next retry.
      const radius = radii[Math.floor(index / angleCount)], i = index % angleCount;
      const angle = baby ? (i + (Math.floor(radius) % 2) * 0.5) * Math.PI * 2 / ANGLES
        : rear + REAR_OFFSETS[i] * Math.PI * 2 / ANGLES;
      const px = master.x + Math.cos(angle) * radius * tile;
      const py = master.y + Math.sin(angle) * radius * tile;
      const ground = tileAt(grid, px, py, tile);
      if (!ground || ground.incline || UNSAFE_TYPES.has(String(ground.type).toLowerCase()) ||
          (Number(ground.water) || 0) >= 0.003 || window.MapBoundaryGuard?.isBoundaryTile?.(ground)) continue;
      const x = px / tile, z = py / tile;
      let landingY = ruin ? ownerSurface : deps.surfaceYForTile?.(ground, currentArea); // Use the candidate's actual ground height.
      if (!Number.isFinite(landingY) || Math.abs(landingY - ownerSurface) > 0.55) continue;
      if (!hiddenAt(camera, x, z, landingY, c, planes)) continue; // Reject visible points before expensive collision and path probes.
      if (Number.isInteger(ownerComponent) && ownerComponent >= 0 &&
          window.CliffRouteNetwork?.componentAt?.(network, Math.floor(x), Math.floor(z)) !== ownerComponent) continue;
      if (ruin) {
        const support = DS?.sampleSupport?.(x, z,
          { minY: ownerSurface - Y_TOLERANCE, maxY: ownerSurface + Y_TOLERANCE, pad: 0 });
        if (!support || !Number.isFinite(support.y) || Math.abs(support.y - ownerSurface) > Y_TOLERANCE ||
            DS?.pointInPit?.(x, z, 0.12) ||
            window.DevRandomRuin?.shaftBodyBlocksAtFeet?.(x, z, 0.2, ownerSurface)) continue;
        landingY = support.y; // Snap to the actual candidate floor, not the owner's approximate Y.
        if (!hiddenAt(camera, x, z, landingY, c, planes)) continue;
        if (window.DevRandomRuin?.shaftCreatureCanEnter?.(probe, px, py, true) === false) continue;
      }
      if (DS?.blockerAt?.(x, z, { radius: 0.2, actorHeight: 1.25, worldY: landingY, y: landingY })) continue;
      if (!ruin && !baby && deps.canOccupy?.(px, py, tile * 0.2) === false) continue; // Check existing sub-tile prop/furniture occupancy.
      if (!deps.creatureCanEnter?.(c.def, px, py, NaN, NaN, probe, true)) continue;
      if (ruin) {
        const navigator = window.TilePathfinding; // Existing tile navigator proves a floor-matched path back to the owner.
        if (!navigator?.findPath || !navigator?.boxAround) continue; // Never teleport into an isolated locked chamber.
        const startCol = Math.floor(px / tile), startRow = Math.floor(py / tile); // Validated continuous landing, then its tile route.
        const tileKey = startCol + ',' + startRow; // Deduplicate same-tile path probes within this attempt.
        if (triedTiles.has(tileKey)) continue;
        triedTiles.add(tileKey);
        // The generic A* deliberately permits escaping a blocked start tile; a teleport must not create one.
        if (!cachedWalkable(startCol, startRow)) continue;
        pathAttempts++;
        const path = navigator.findPath(startCol, startRow, goalCol, goalRow, cachedWalkable,
          { bounds: navigator.boxAround(startCol, startRow, goalCol, goalRow, 3), maxNodes: 550, cacheWalkability: true });
        if (!path) {
          if (pathAttempts >= RUIN_PATH_BUDGET) {
            state.searchCursor = (index + 1) % total; // No starvation on a fifth or later viable landing.
            return null;
          }
          continue;
        }

      }
      return { x: px, y: py, supportY: landingY };
    }
    return null;
  }

  function tryRecover(c, master, currentArea, reason, state) {
    const camera = deps.getCamera?.(); // Uses the active real game camera, including zoom and camera rotation.
    if (!camera) { debug.lastFailure = 'no camera'; return false; }
    const planes = recoveryPlanes(camera); // The last rendered camera's world clip volume, computed only on recovery attempts.
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
    if (!hiddenAt(camera, c.x / tile, c.y / tile, petY, c, planes) ||
        (groupPos && !hiddenAt(camera, groupPos.x, groupPos.z,
          groupPos.y - (c.groundLift ?? c.halfHeight ?? 0), c, planes))) {
      debug.lastFailure = 'companion currently visible'; return false;
    }
    const candidate = recoveryCandidate(c, master, camera, currentArea, tile, ownerFloor, planes, state);
    if (!candidate) { debug.lastFailure = 'no unseen safe landing on owner floor'; return false; }
    if (!c._familyBabyFollower) { // Infant navigation is private; it has no combat actor to cancel.
      window.Combat?.animalAttacks?.cancel?.(c); // Clear all movement-owning attack and route state before relocating.
      window.Combat?.telegraph?.cancel?.(c);
      window.Combat?.cancelStagedForAttacker?.(c);
    }
    c._animalAttack = null;
    c._stage = null;
    c._cliffClimb = null; c._cliffRouteTravel = null; c._cliffEntryPath = null;
    c._followOwnerDownCliff = false; // Discard the obsolete retreat route after relocating.
    c._travelPath = null; c._travelPathTarget = null; c._travelStuckT = 0;
    c._companionCombatTarget = null; c._companionCombatPriority = null;
    c._companionEffectiveTarget = null; c._companionBiteTarget = null; c._companionDecisionNextAt = 0; c._travelPathFailure = null;
    c._honeyfuzzleRescueTarget = null;
    c.treasureCue = null; c.watchPlayerIdle = null; c.wanderTarget = null; c.wanderT = 0; // Retire remote secondary movement goals too.
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
      x: c.x, y: c.y, floor: candidate.supportY, reason };
    debug.lastFailure = null;
    window.__farmLog?.(`[companion-follow] ${reason} follower recovered offscreen near owner`, 'wildlife');
    return true;
  }

  function isHardDistance(c, followGoal) {
    return !!deps && c?.isCompanion && !c.banditCompanion && c.stableRole === 'companion' &&
      !c._familyBabyFollower && (c.master || deps.player) === deps.player &&
      Number(followGoal?.distance) > deps.TILE * HARD_FAR_TILES;
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
      state.cooldown = 0; state.bestDistance = Infinity; state.searchCursor = 0; state.searchKey = null;
    }
    const elapsed = Math.min(0.1, Math.max(0, Number(dt) || 0)); // Pause/hitches cannot instantly trigger recovery.
    state.cooldown = Math.max(0, state.cooldown - elapsed);
    state.retry = Math.max(0, state.retry - elapsed); // Count down even while briefly busy or crossing the distance boundary.
    const distance = Number(followGoal?.distance); // Shared follow goal already computed by the live movement loop.
    const far = distance > tile * FAR_TILES;
    const hardFar = isHardDistance(c, followGoal); // A moving animal can still be excessively distant.
    const playerFloor = ruin ? floorForOwner(master, currentArea) : null;
    const rawPetFloor = c.shaftSupportY ?? c.surfaceYOverride?.();
    const modelPos = c.avatarRef?.group?.position; // Fallback only when the ruin has not yet assigned a shaft support to this pet.
    const petFloor = ruin ? (rawPetFloor != null && Number.isFinite(Number(rawPetFloor))
      ? Number(rawPetFloor) : modelPos && Number.isFinite(modelPos.y)
        ? modelPos.y - (c.groundLift ?? c.halfHeight ?? 0) : null) : null;
    const differentFloor = (ruin && Number.isFinite(playerFloor) && Number.isFinite(petFloor) &&
      Math.abs(playerFloor - petFloor) > 0.75) || (c._familyBabyFollower && followGoal?.routeRequired === true);
    const unsafe = c.prone || c._knockbackLedgeFall || c._cliffClimb || c._climbLeap ||
      c.knockbackT > 0 || c._animalAttack || c._furiousSpecial ||
      (!c._familyBabyFollower && window.Combat?.telegraph?.isBusy?.(c)) || master.climbing || master._freeJump;
    const busy = c._cliffRouteTravel || c._honeyfuzzleRescueTarget ||
      c._companionEffectiveTarget || c._companionCombatTarget || c.treasureCue; // Distant intentions must not indefinitely retain an abandoned path or target.
    const unable = unsafe || (!hardFar && busy);
    if ((!far && !differentFloor) || unable) {
      state.stalled = 0; state.bestDistance = Infinity; return false;
    }
    const remaining = Math.max(0, Number(followGoal?.distance) || 0) +
      (differentFloor ? tile * 4 : 0);
    if (!hardFar && remaining < state.bestDistance - tile * PROGRESS_TILES) {
      state.bestDistance = remaining; state.stalled = 0;
      // Keep the retry throttle if a recent hard-distance probe failed.
    } else if (state.bestDistance === Infinity) state.bestDistance = remaining;
    state.stalled = hardFar ? 0 : state.stalled + elapsed; // A long-distance attempt is not evidence of ordinary stalling.
    const cooldownLimit = hardFar ? COOLDOWN_SECONDS - HARD_COOLDOWN_SECONDS : 0; // Any successful jump still enforces the short minimum interval.
    if ((!hardFar && state.stalled < STALL_SECONDS) || state.cooldown > cooldownLimit) return false;
    if (state.retry > 0.000001) return false;
    state.retry = RETRY_SECONDS;
    if (!tryRecover(c, master, currentArea, hardFar ? 'distance-limit' : 'stalled', state)) return false;
    state.stalled = 0; state.retry = 0; state.cooldown = COOLDOWN_SECONDS; state.searchCursor = 0; state.searchKey = null;
    state.bestDistance = Infinity;
    return true;
  }

  window.CompanionFollowNavigation = Object.freeze({
    init, goal, descentState, isHardDistance, tickRecovery,
    debugSnapshot: () => ({ ...debug }),
    tuning: Object.freeze({ FAR_TILES, HARD_FAR_TILES, HARD_COOLDOWN_SECONDS, STALL_SECONDS, RETRY_SECONDS, COOLDOWN_SECONDS, PROGRESS_TILES }),
  });
})();
