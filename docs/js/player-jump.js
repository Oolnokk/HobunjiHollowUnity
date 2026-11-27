// Ordinary player jumps share the semantic cover tops used by projectiles.
// ClimbSystem owns the Jump input; the normal game movement loop owns its tick.
// Wall climbing and free jumps have separate state, so combat/interactions
// are not accidentally disabled after landing on furniture.
(() => {
  'use strict';

  const Motion = window.PlayerAirMotionConfig; // Gameplay may apply future jump/slow-fall multipliers; generators use Motion.BASE only.
  const CONFIG = Object.freeze({
    launchSpeed: Motion?.BASE.jumpLaunchSpeed ?? 6.25 / Math.SQRT2,
    gravity: Motion?.BASE.jumpGravity ?? 11.8, airTilesPerSecond: Motion?.BASE.airTilesPerSecond ?? 3.15,
    groundTilesPerSecond: Motion?.BASE.groundTilesPerSecond ?? 2.6, radius: 0.17, stepSeconds: 1 / 60,
    maxFrameSeconds: 0.22, maxStepUp: 0.25, landingTolerance: 0.045,
    assistReach: 1, assistSeconds: 0.16, // Short, collision-checked forward lerp after clearing an obstacle.
  }); // Halve the original 1.65-world-unit apex (~0.83) via launch speed; retain fall gravity.
  const EASY_JUMP_RISE = Math.max(0, CONFIG.launchSpeed ** 2 / (2 * CONFIG.gravity) - 0.12); // Ruin ledge targeting uses this comfortable, sub-apex jump height instead of its old climb threshold.
  let deps = null; // Injected from ClimbSystem.init; contains the same live player and terrain readers.
  const debug = { starts: 0, landings: 0, blockedMoves: 0, lastEvent: 'not started', lastObstacle: null, grabs: 0, ropeCatches: 0, flights: 0, slides: 0, assists: 0 }; // Mobile diagnostics in ClimbSystem.debug.

  const number = (value, fallback = null) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function tileAt(x, z) {
    return deps?.getActiveGrid?.()?.[Math.floor(z)]?.[Math.floor(x)] || null;
  }

  function groundAt(x, z, maxSupportY = Infinity) {
    const tile = tileAt(x, z);
    if (!tile || tile.incline || tile.mapBoundary || deps.isSolid?.(tile.type) || window.MapBoundaryGuard?.isBoundaryTile?.(tile)) return null;
    if (['void', 'pit'].includes(String(tile.type).toLowerCase()) || window.DynamicSurfaces?.pointInPit?.(x, z)) return null; // An authored death pit is never a jump landing floor.
    const area = deps.getCurrentArea();
    const surface = window.AreaFootprintBlockers?.surfaceYAt?.(area, x, z);
    const continuous = deps.worldSurfaceY?.(x * deps.TILE, z * deps.TILE); // The same smooth farm/town/zone ground used by ordinary physical walking.
    const baseY = Number.isFinite(surface) ? surface
      : Number.isFinite(continuous) ? continuous : deps.tileSurfaceYInArea?.(tile, area);
    if (!Number.isFinite(baseY)) return null;
    const groundY = window.HobunjiWalkableElevation?.worldSurfaceTopAt?.(x, z, baseY, area, maxSupportY) ?? baseY; // Ignore raised decks that are still overhead.
    return window.DynamicSurfaces?.samplePressurePlate?.(area, x, z, groundY, maxSupportY)?.y ?? groundY; // Jump takeoff and landing share the plate's live cap.
  }

  function coverAtTile(tile, col, row) {
    if (!tile) return Infinity; // Beyond the world is always solid, even when moving vertically.
    if (tile.mapBoundary || window.MapBoundaryGuard?.isBoundaryTile?.(tile)) return Infinity; // Sealed map edges retain their boundary authority.
    if (tile.incline) return window.ZonePlateauMesa?.hasTerrain?.(deps.getCurrentArea()) ? null : Infinity; // Generated cliff geometry owns airborne collision when available.
    if (!deps.isSolid?.(tile.type)) return null;
    const candidate = window.ProjectileTileCover?.coverTop?.(tile, col, row);
    // Interior ROCK tiles often denote walls, not the generated wilderness
    // rocks whose explicit finite geometry is traversable.
    const isOutdoorRock = deps._isZoneArea?.(deps.getCurrentArea()) === true;
    const authoredHeight = Number.isFinite(Number(tile.projectileCoverHeightTiles)) || tile.rockKind === 'undiggableBoulder';
    if (!isOutdoorRock && !authoredHeight) return Infinity;
    return Number.isFinite(candidate) ? candidate : Infinity;
  }

  function touchesCover(obstacle, x, z, radius = CONFIG.radius) {
    if (obstacle.shape === 'aabb') {
      return Math.abs(x - obstacle.x) <= obstacle.halfX + radius
        && Math.abs(z - obstacle.z) <= obstacle.halfZ + radius;
    }
    return Math.hypot(x - obstacle.x, z - obstacle.z) <= obstacle.radius + radius;
  }

  function coverCandidates(x, z) {
    // Reuse the renderer-derived semantic metadata rather than calculating a
    // second independent furniture height or hardcoding individual item types.
    return window.NearbyVolumeCollision?.movementCoverNear?.(x, z, CONFIG.radius) || [];
  }

  function highestSupport(x, z, maxY) {
    const floorY = groundAt(x, z, maxY); // Landing cannot pick a higher porch/bridge surface until the descending feet actually reach it.
    let best = floorY != null && floorY <= maxY ? {
      y: floorY,
      kind: window.HobunjiWalkableElevation?.isBalconyAt?.(x, z, floorY, deps.getCurrentArea()) ? 'balcony' : 'ground',
    } : null; // Keep a roof landing supported until the next jump or real fall-off.
    const dynamic = window.DynamicSurfaces?.sampleSupport?.(x, z, { maxY, minY: -Infinity, area: deps.getCurrentArea() });
    if (dynamic && (!best || dynamic.y > best.y)) best = { y: dynamic.y, kind: 'dynamic', id: dynamic.id };
    const c0 = Math.floor(x - CONFIG.radius), c1 = Math.floor(x + CONFIG.radius);
    const r0 = Math.floor(z - CONFIG.radius), r1 = Math.floor(z + CONFIG.radius);
    for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) {
      const top = coverAtTile(deps.getActiveGrid?.()?.[row]?.[col], col, row);
      if (top == null || !Number.isFinite(top) || top > maxY) continue;
      if (!best || top > best.y) best = { y: top, kind: 'rock', id: col + ',' + row };
    }
    for (const obstacle of coverCandidates(x, z)) {
      if (!Number.isFinite(obstacle.topY) || obstacle.topY > maxY) continue;
      // A landing needs the body's centre *on* the surface, not a grazing
      // overlap of the inflated collision footprint at the object's edge.
      if (!touchesCover(obstacle, x, z, -CONFIG.radius * 0.45)) continue;
      if (!best || obstacle.topY > best.y) best = { y: obstacle.topY, kind: obstacle.kind || 'furniture', id: obstacle.key };
    }
    const landmark = window.AreaFootprintBlockers?.supportAt?.(deps.getCurrentArea(), x, z, maxY); // Same indexed physical footprint used by normal wilderness collision.
    if (landmark && (!best || landmark.y > best.y)) best = landmark;
    return best;
  }

  function terrainTopAt(x, z) {
    if (!window.ZonePlateauMesa?.hasTerrain?.(deps.getCurrentArea())) return null;
    let top = null; // Highest rendered terrain touched by the physical foot radius.
    for (const [dx, dz] of [[0, 0], [-CONFIG.radius, 0], [CONFIG.radius, 0], [0, -CONFIG.radius], [0, CONFIG.radius]]) {
      const y = window.ZonePlateauMesa.surfaceYAt(deps.getCurrentArea(), x + dx, z + dz); // Same probes for horizontal and downward contact.
      if (Number.isFinite(y) && (top == null || y > top)) top = y;
    }
    return top;
  }

  function stateIsSupported() {
    return deps?.player?._freeJump?.phase === 'supported'; // Only grounded elevated movement needs full-body railing contact.
  }

  function blockingReason(x, z, feetY) {
    const grid = deps.getActiveGrid?.();
    if (!grid?.length) return 'no terrain';
    const c0 = Math.floor(x - CONFIG.radius), c1 = Math.floor(x + CONFIG.radius);
    const r0 = Math.floor(z - CONFIG.radius), r1 = Math.floor(z + CONFIG.radius);
    for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) {
      const tile = grid[row]?.[col];
      if (!tile) return 'map boundary';
      const top = coverAtTile(tile, col, row);
      if (top != null && feetY < top - CONFIG.landingTolerance) return 'solid tile';
      if (!deps.isSolid?.(tile.type)) {
        const floor = groundAt(col + 0.5, row + 0.5);
        if (floor != null && floor > feetY + CONFIG.maxStepUp) return 'raised floor';
      }
    }
    const terrainTop = terrainTopAt(x, z); // Finite visible plateau/minicliff shell at the actual body footprint.
    if (Number.isFinite(terrainTop) && terrainTop > feetY + CONFIG.landingTolerance) return 'terrain geometry';
    const near = coverCandidates(x, z);
    for (const obstacle of near) {
      if (!touchesCover(obstacle, x, z) || obstacle.bottomY > feetY + 1.25 || obstacle.topY <= feetY + CONFIG.landingTolerance) continue;
      return obstacle.kind || 'furniture';
    }
    const area = deps.getCurrentArea();
    const access = window.GridTileAccessors; // Game's existing house, farm-building, and town-building tile collision authority.
    if (stateIsSupported() && window.HobunjiWalkableElevation?.railBlocksBox?.(x, z, CONFIG.radius, feetY, 1.25))
      return 'railing'; // Raised-support walking checks the whole body against railings; airborne feet can clear their tops.
    if (window.InteriorDoorTiles?.blocksBox?.(area, x, z, CONFIG.radius)) return 'closed interior door';
    for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) {
      if (area === 'farm' && (access?.isHouseFootprint?.(col, row) || access?.isFarmBuildingCollisionTile?.(col, row))) return 'farm building';
      if ((area === 'town' || deps._isZoneArea?.(area)) && access?.isTownBuildingCollisionTile?.(col, row, area, feetY)) return 'town building';
    }
    // Clearing one low piece of cover does not exempt any other blocker.
    const footprintCenterY = feetY + CONFIG.radius + 0.055; // Raised-platform walking uses a body volume ABOVE the floor, never a sphere straddling its own slab.
    if (window.AreaFootprintBlockers?.blocksBox?.(area, x, z, CONFIG.radius, footprintCenterY))
      return 'solid footprint';
    if (window.DynamicSurfaces?.blockerAt?.(x, z, {
      worldY: feetY, radius: CONFIG.radius, actorHeight: 1.25,
    })) return 'dynamic blocker';
    if (deps.canPlayerOccupyAtHeight) {
      const aboveBalcony=window.HobunjiWalkableElevation?.isAboveBalconyAt?.(x,z,feetY,area); // Airborne roof movement may ignore its building shell.
      if (!deps.canPlayerOccupyAtHeight(x * deps.TILE, z * deps.TILE, feetY)) {
        if (!aboveBalcony) return 'world collision';
        // The native probe also includes furniture/table blockers. The balcony exemption
        // bypasses only the building's coarse shell, not any independent obstacle atop it.
        if (window.FurnitureTableSystem?.blocksBox?.(area, x, z, CONFIG.radius, feetY + 0.05)
            || deps.furnitureBlocksMovementAt?.(area, x, z, feetY + 0.05)) return 'furniture';
      }
    } else {
      // Non-game test owners fail closed, rather than granting global passage
      // because a semantically unrelated rock or table is below the feet.
      if (deps.furnitureBlocksMovementAt?.(area, x, z, feetY)) return 'non-cover furniture';
      if (deps.canPlayerOccupy && !deps.canPlayerOccupy(x * deps.TILE, z * deps.TILE))
        return 'world collision';
    }
    return null;
  }

  function setElevation(player, state) {
    const ground = groundAt(player.x / deps.TILE, player.y / deps.TILE, state.feetY + CONFIG.landingTolerance); // Overhead decks are not ground beneath a jumping actor.
    player.physicalFeetY = state.feetY; // World-space physical foot height used by jumping and height-aware interactions.
    player.heightAboveGround = Math.max(0, state.feetY - (ground ?? state.launchGround)); // Includes jumping AND height gained by standing on raised cover.
    player.jumpHeightAboveGround = player.heightAboveGround; // Simple debug/consumer alias for the shared physical elevation.
    player.climbSurfaceY = state.feetY;
    player.climbHopBounce = 0; // Physical lift is already in climbSurfaceY; never add it twice.
  }

  // Hits may change airborne horizontal momentum, but the same gravity owner
  // retains feetY and descending speed. No second knockback movement timer runs.
  function receiveKnockback(dirX, dirZ, speedPxS) {
    const state = deps?.player?._freeJump;
    if (state?.phase !== 'air') return false;
    const magnitude = Math.hypot(Number(dirX) || 0, Number(dirZ) || 0);
    const tilesPerSecond = Math.max(0, number(speedPxS, 0)) / deps.TILE;
    if (magnitude > 1e-6 && tilesPerSecond > 0) {
      const vx = dirX / magnitude * tilesPerSecond, vz = dirZ / magnitude * tilesPerSecond; // Shared hit impulse used by either native or ruin-owned flight integration.
      if (state.external) {
        state.vx = number(state.vx, 0) + vx;
        state.vz = number(state.vz, 0) + vz; // External ruin flights integrate vx/vz directly, not native knockbackVX/Z.
      } else {
        state.knockbackVX = number(state.knockbackVX, 0) + vx;
        state.knockbackVZ = number(state.knockbackVZ, 0) + vz;
      }
    }
    return true;
  }

  function knockProne() {
    const player = deps?.player, state = player?._freeJump;
    if (!state || state.phase !== 'air') return false;
    if (!state.proneFall) {
      state.proneFall = true; // Used only at landing to route the drop through the existing cliff collision profile.
      state.proneFallStartY = Math.max(state.feetY, number(state.launchGround, state.feetY));
      state.deliberate = false;
      state.noGrab = true; // An unconscious/prone actor cannot re-grab a ladder, rope or cliff halfway down.
      state.assist = null;
      if (state.vy > 0) state.vy = 0; // Both native and externally integrated ascending flights start falling; already-descending velocity remains unchanged.
      debug.lastEvent = 'knocked prone in air';
    }
    player.proneThrowT = 0; // Reuse horizontal airborne momentum instead of moving twice with the grounded throw timer.
    player.proneThrowVX = 0; player.proneThrowVY = 0;
    window.KnockbackCollisionImpact?.cancel?.(player);
    return true;
  }

  function reset(player, reason = 'reset') {
    if (!player?._freeJump) return;
    player._freeJump = null;
    player.climbHopBounce = 0; // Wall-climb state remains owned exclusively by ClimbSystem.
    player.heightAboveGround = 0;
    player.jumpHeightAboveGround = 0;
    player.physicalFeetY = null;
    debug.lastEvent = reason;
  }

  // One physical airborne record is shared by free jumps, rope launches and rope rides.
  // Ruins can own the integration of external flights while sharing elevation and input.
  function beginFlight(flight, options = {}) {
    const player = deps?.player;
    if (!player || !flight || !['x', 'y', 'z', 'vy'].every(key => Number.isFinite(Number(flight[key])))) return null;
    if (player._freeJump) reset(player, 'airborne ownership transferred');
    const x = Number(flight.x), z = Number(flight.z), feetY = Number(flight.y);
    const state = {
      ...flight, area: deps.getCurrentArea(), phase: 'air', feetY,
      launchGround: feetY, vy: Number(flight.vy), vx: number(flight.vx, 0), vz: number(flight.vz, 0),
      elapsed: 0, lastX: x, lastZ: z,
      safeX: Number.isFinite(flight.safeX) ? flight.safeX : x,
      safeZ: Number.isFinite(flight.safeZ) ? flight.safeZ : z, // Native falls can retain the last grounded point before leaving a ledge.
      external: options.external === true, source: options.source || 'rope swing',
      ropeId: options.ropeId ?? flight.ropeId ?? null, deliberate: options.deliberate !== false,
    }; // Native free-fall and ruin rope release use the same elevation/state contract.
    player._freeJump = state;
    player.x = x * deps.TILE; player.y = z * deps.TILE;
    player.vx = 0; player.vy = 0;
    setElevation(player, state);
    debug.flights++;
    debug.lastEvent = state.source + ' airborne';
    return state;
  }

  function beginRopeRide(rope) {
    const player = deps?.player, bob = rope?.bob;
    if (!player || !bob || !Number.isFinite(bob.y)) return false;
    if (player._freeJump) reset(player, 'caught rope');
    const x = bob.x, z = bob.z;
    const state = { area: deps.getCurrentArea(), phase: 'rope', feetY: bob.y,
      launchGround: groundAt(x, z, bob.y + CONFIG.landingTolerance) ?? bob.y, ropeId: rope.id, vy: 0, elapsed: 0 };
    player._freeJump = state; // The ordinary renderer and movement loop now respect an outdoor rope rider's physical feet.
    return setRopeRidePoint(bob);
  }

  function setRopeRidePoint(bob) {
    const player = deps?.player, state = player?._freeJump;
    if (!player || state?.phase !== 'rope' || !bob) return false;
    player.x = bob.x * deps.TILE; player.y = bob.z * deps.TILE;
    player.vx = 0; player.vy = 0;
    state.feetY = bob.y;
    setElevation(player, state);
    return true;
  }

  function airControl(scale = 1) {
    const direction = deps?.player?.prone ? { x: 0, z: 0, strength: 0 } : movementVector(); // Prone bodies never steer, including externally integrated ruin rope flights.
    const speed = Math.max(0, number(deps?.getBaseMoveSpeedTiles?.(), CONFIG.airTilesPerSecond))
      * direction.strength * Math.max(0, number(scale, 1));
    return { x: direction.x * speed, z: direction.z * speed, direction }; // World units/second; steering is added to inherited rope momentum.
  }

  function start() {
    const player = deps?.player;
    if (!player) return false;
    if (player._freeJump && player._freeJump.area !== deps.getCurrentArea()) {
      reset(player, 'stale jump discarded'); // Scene transitions do not preserve the previous world's raised supports.
    }
    const old = player._freeJump;
    if (old?.phase === 'rope') return window.HangingRopes?.releaseActiveRope?.() === true;
    if (old?.phase === 'air') return true; // Consume presses; no unintended double jump.
    if (player.climbing || player.onCliffBalcony || player.onClimbSurface) return false; // Scripted traversal retains priority.
    if (deps.canStartFreeJump?.() === false) return false; // Dialogue, cutscenes, sleep and other owned activities cannot queue a jump.
    if (deps.getMountRideState?.() !== 'none' && deps.getMountRideState?.() != null) return false;
    if (player.dodging || player.prone || player.lunging || player.knockbackT > 0 ||
      player.health <= 0 || player._cliffRouteSession || player.onBranch) return false;
    const x = player.x / deps.TILE, z = player.y / deps.TILE;
    // Never select the highest cover above the player as takeoff: a low
    // ceiling or table must not teleport a ground-level jumper onto its top.
    const ruinSupportY = window.DevRandomRuin?.getPlayerGroundSupportY?.(); // V50 supports can be above the plain 2D floor.
    const priorFootY = old?.phase === 'supported' ? old.feetY
      : Number.isFinite(player.physicalFeetY) ? player.physicalFeetY
      : deps.worldSurfaceY?.(player.x, player.y); // Real previous footing limits climbable support at jump takeoff.
    const launchSurfaceY = groundAt(x, z,
      Number.isFinite(priorFootY) ? priorFootY + CONFIG.maxStepUp : Infinity); // Do not launch from a bridge's overhead deck.
    const baseY = old?.phase === 'supported' ? old.feetY
      : (Number.isFinite(ruinSupportY) ? ruinSupportY
        : (launchSurfaceY ?? deps.worldSurfaceY?.(player.x, player.y)));
    if (!Number.isFinite(baseY)) return false;
    const launchGround = launchSurfaceY ?? baseY;
    const state = {
      area: deps.getCurrentArea(), phase: 'air', feetY: baseY,
      takeoffY: baseY, // Ruin wall catches compare with jump launch height, not the inflated midair feet height.
      launchGround, vy: Motion?.jumpLaunchSpeed?.() ?? CONFIG.launchSpeed, vx: 0, vz: 0, elapsed: 0, blocked: null, source: 'free jump',
      lastX: x, lastZ: z, safeX: x, safeZ: z, // Last verified walkable point for fallback when no area-specific abyss physics exists.
    }; // Sole airborne state; kept off save data and discarded on area changes.
    player._freeJump = state; // Independent of player.climbing so the player can use ordinary actions while elevated.
    player.vx = 0; player.vy = 0;
    setElevation(player, state);
    debug.starts++;
    debug.lastEvent = 'jump started';
    window.__farmLog?.('[jump] free jump started at ' + baseY.toFixed(2), 'movement');
    return true;
  }

  function movementVector() {
    const input = deps.getMovementInput?.() || { x: 0, y: 0 };
    const reverse = window.RangedWeapons?.movementDirectionMultiplier?.(deps.player) ?? 1; // Match the ordinary locomotion input reversal.
    const x = number(input.x, 0) * reverse, z = number(input.y, 0) * reverse;
    const intent = window.ResourceSystem?.movementIntent?.(deps.player, x, z, input.rotationApplied === true) || { x, y: z }; // Shoulder input already contains Demented camera yaw.
    const length = Math.hypot(intent.x, intent.y);
    return length > 0.01 ? { x: intent.x / length, z: intent.y / length, strength: Math.min(1, length) }
      : { x: 0, z: 0, strength: 0 };
  }

  function tryAirGrab(state, direction, previousY = state.feetY) {
    if (state.phase !== 'air' || state.noGrab) return false; // A deliberate wall release must not immediately reattach to the grip it just left.
    const pos = { x: deps.player.x / deps.TILE, z: deps.player.y / deps.TILE, y: state.feetY }; // Shared physical airborne position for both climb owners.
    const speed = number(deps.getBaseMoveSpeedTiles?.(), CONFIG.airTilesPerSecond);
    const flight = { ...pos, vx: (state.vx || direction.x * speed), vy: state.vy,
      vz: (state.vz || direction.z * speed), ropeId: state.ropeId ?? null };
    if (window.DevRandomRuinSimplePuzzles?.catchAirborneRope?.(flight) ||
      window.HangingRopes?.catchAirborneRope?.(flight)) {
      debug.grabs++; debug.ropeCatches++;
      debug.lastEvent = 'caught rope in air';
      return true;
    }
    if (state.vy < 0 && window.ClimbSurfaces?.tryFallGrab?.(pos, previousY)) {
      debug.grabs++;
      debug.lastEvent = 'caught shaft ladder while falling';
      return true;
    }
    if (!window.ClimbSurfaces?.tryAirGrab?.(pos, direction) && !window.ClimbSystem?.tryAirGrab?.(pos, direction)) return false;
    debug.grabs++;
    debug.lastEvent = 'caught climbable wall';
    return true;
  }

  function clearPath(x, z, targetX, targetZ, feetY) {
    const steps = Math.max(1, Math.ceil(Math.hypot(targetX - x, targetZ - z) / 0.05)); // Sweep the whole assist; endpoints alone can skip a thin barrier.
    for (let i = 1; i <= steps; i++) {
      if (blockingReason(x + (targetX - x) * i / steps, z + (targetZ - z) * i / steps, feetY)) return false;
    }
    return true;
  }

  function findLandingAssist(state, direction) {
    const x = deps.player.x / deps.TILE, z = deps.player.y / deps.TILE; // Start the search from the cleared collider.
    for (let distance = 0.1; distance <= CONFIG.assistReach + 1e-6; distance += 0.1) {
      const tx = x + direction.x * distance, tz = z + direction.z * distance; // Search only in the player's approach direction.
      const support = highestSupport(tx, tz, state.feetY + CONFIG.landingTolerance); // Adjacent platforms/plateaus become reachable at their actual elevation.
      if (!support || support.y < state.feetY - 1 || blockingReason(tx, tz, support.y)) continue;
      if (!clearPath(x, z, tx, tz, state.feetY)) return null;
      return { x: tx, z: tz }; // Live support and collision are checked again during the lerp and landing.
    }
    return null;
  }

  function slideMovement(x, z, dx, dz, feetY) {
    const obstacles = coverCandidates(x + dx, z + dz); // Reuse semantic bounds to derive round-prop contact normals.
    let nx = 0, nz = 0; // Outward collision normal for tangent projection.
    for (const obstacle of obstacles) {
      if (obstacle.shape === 'aabb' || !touchesCover(obstacle, x + dx, z + dz) || obstacle.topY <= feetY + CONFIG.landingTolerance) continue;
      nx = x - obstacle.x; nz = z - obstacle.z;
      break;
    }
    if (!nx && !nz && window.ZonePlateauMesa?.hasTerrain?.(deps.getCurrentArea())) {
      const height = (px, pz) => window.ZonePlateauMesa.surfaceYAt(deps.getCurrentArea(), px, pz) ?? feetY; // Local displaced-rock gradient provides its contour tangent.
      nx = height(x - 0.04, z) - height(x + 0.04, z);
      nz = height(x, z - 0.04) - height(x, z + 0.04);
    }
    const length = Math.hypot(nx, nz); // Normalize before projecting the approach vector off the face.
    if (length > 1e-6) {
      nx /= length; nz /= length;
      const inward = Math.min(0, dx * nx + dz * nz); // Only remove the component directed into the obstacle.
      const sx = x + dx - nx * inward, sz = z + dz - nz * inward; // Slide along the visible face without gaining speed.
      if (Math.hypot(sx - x, sz - z) > 1e-6 && !blockingReason(sx, sz, feetY)) return { x: sx, z: sz };
    }
    if (Math.abs(dx) > 1e-6 && !blockingReason(x + dx, z, feetY)) return { x: x + dx, z };
    if (Math.abs(dz) > 1e-6 && !blockingReason(x, z + dz, feetY)) return { x, z: z + dz };
    return null;
  }

  function stepMovement(state, seconds, speed, previousY = state.feetY) {
    const player = deps.player;
    const direction = player.prone ? { x: 0, z: 0, strength: 0 } : movementVector(); // Prone bodies retain ballistic travel, not midair steering.
    player.inputX = direction.x; player.inputY = direction.z; player.inputStrength = direction.strength; // Keep aiming/movement systems informed during free jumps and raised-support walking.
    if (tryAirGrab(state, direction.strength ? direction : state.lastDirection || { x: Math.cos(player.angle || 0), z: Math.sin(player.angle || 0) }, previousY)) return;
    const carryX = (number(state.vx, 0) + number(state.knockbackVX, 0)) * seconds;
    const carryZ = (number(state.vz, 0) + number(state.knockbackVZ, 0)) * seconds; // Existing rope momentum and hit impulses share the collision sweep.
    state.knockbackVX = number(state.knockbackVX, 0) * Math.exp(-9 * seconds);
    state.knockbackVZ = number(state.knockbackVZ, 0) * Math.exp(-9 * seconds); // Knockback decays; rope momentum remains untouched.
    const rs = window.ResourceSystem; // Native jump solver still owns elevation, gravity and collision.
    const mobility = player.prone ? 1 : (rs?.movementMultiplier?.(player, 'walk') ?? 1);
    const windy = !player.prone && !!rs?.hasWindblown?.(player);
    const alteredSteering = windy || Math.abs(mobility - 1) > 1e-8 || !!window.FeyIllusions?.movementRotationRad?.(player);
    if (alteredSteering) state.assist = null; // Fixed-target assistance cannot bypass a live mobility/steering modifier.
    if (!direction.strength && !Math.hypot(carryX, carryZ) && !windy) { state.assist = null; return; }
    if (!direction.strength) state.assist = null;
    if (direction.strength) state.lastDirection = direction; // Falling beside the approached face can still catch it after movement input is released.
    if (state.assist && direction.strength) {
      const x = player.x / deps.TILE, z = player.y / deps.TILE; // Lerp from the live position; never skip changed collision.
      const alpha = Math.min(1, seconds / Math.max(seconds, state.assist.remaining)); // Finishes within the short assist window.
      const tx = x + (state.assist.x - x) * alpha, tz = z + (state.assist.z - z) * alpha; // Candidate interpolated point.
      if (direction.x * (state.assist.x - x) + direction.z * (state.assist.z - z) < -0.001 || !clearPath(x, z, tx, tz, state.feetY)) state.assist = null;
      else {
        player.x = tx * deps.TILE; player.y = tz * deps.TILE;
        state.assist.remaining -= seconds;
        if (alpha >= 1) state.assist = null;
        return;
      }
    }
    const nativeSpeed = number(deps.getBaseMoveSpeedTiles?.(), speed); // Uses the same unbuffed speed as ordinary movement; fallback serves isolated tests.
    const reference = (nativeSpeed > 0 ? nativeSpeed : speed) * seconds * mobility; // Tile units, already scaled once.
    const travel = reference * direction.strength;
    const motion = windy ? rs.composeMovement(player, direction.x * travel, direction.z * travel, { mode: 'walk', scalarApplied: true, rotationApplied: true, reference, dt: seconds, airborne: state.phase === 'air', voluntary: direction.strength > 0 }) : null;
    // Rope launch and hit impulses are physical carry, not voluntary steering:
    // they remain unscaled and never contribute to the wind alignment charge.
    const dx = (motion?.x ?? direction.x * travel) + carryX, dz = (motion?.y ?? direction.z * travel) + carryZ;
    const segments = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.08));
    let traveled = 0; // Actual swept distance in tile units, including accepted wall slides.
    try {
    for (let i = 0; i < segments; i++) {
      const x = player.x / deps.TILE + dx / segments;
      const z = player.y / deps.TILE + dz / segments;
      const blocked = blockingReason(x, z, state.feetY);
      if (blocked) {
        state.blocked = blocked;
        debug.blockedMoves++;
        debug.lastObstacle = blocked;
        state.obstaclePending = true; // Trigger assistance only after this actual collider is cleared.
        const slide = slideMovement(player.x / deps.TILE, player.y / deps.TILE,
          dx / segments, dz / segments, state.feetY); // Preserve tangential input while gravity continues.
        if (!slide) { state.vx = 0; state.vz = 0; break; } // A blocked rope launch cannot keep tunnelling into a wall.
        traveled += Math.hypot(slide.x - player.x / deps.TILE, slide.z - player.y / deps.TILE);
        player.x = slide.x * deps.TILE; player.y = slide.z * deps.TILE;
        debug.slides++;
        if (state.phase === 'air' && tryAirGrab(state, direction.strength ? direction : state.lastDirection || direction, previousY)) return; // Also catch at the swept slide point, not only before the frame.
        continue;
      }
      if (state.phase === 'air' && state.obstaclePending) {
        const target = player.prone || alteredSteering ? null : findLandingAssist(state, direction); // Prone cannot use assisted ledge hops. // A collider's clearance opens a bounded, swept landing assist.
        state.obstaclePending = false;
        state.blocked = null;
        if (target) { state.assist = { ...target, remaining: CONFIG.assistSeconds }; debug.assists++; }
      }
      traveled += Math.hypot(dx, dz) / segments;
      player.x = x * deps.TILE; player.y = z * deps.TILE;
      state.lastX = x; state.lastZ = z;
      if (state.phase === 'air' && tryAirGrab(state, direction.strength ? direction : state.lastDirection || direction, previousY)) return; // Fast rope swings can cross a grip between frame starts; sample each swept movement segment.
    }
    } finally {
      if (motion?.wind) rs.commitMovement?.(player, motion, Math.min(1, traveled / Math.max(1e-8, Math.hypot(dx, dz))));
    }
  }

  function slideOffTerrain(state, previous, seconds) {
    if (state.vy > 0 || !window.ZonePlateauMesa?.hasTerrain?.(deps.getCurrentArea())) return;
    const player = deps.player, x = player.x / deps.TILE, z = player.y / deps.TILE; // Falling contact is independent of horizontal input.
    const height = terrainTopAt; // The same footprint envelope used by horizontal collision avoids pinning feet against the upslope edge.
    const top = height(x, z); // Only react when the downward sweep actually crosses this surface.
    if (!Number.isFinite(top) || top < state.feetY || top > previous + CONFIG.landingTolerance) return;
    const support = highestSupport(x, z, top + CONFIG.landingTolerance); // Real platform/plateau tops remain ordinary landings.
    if (support && Math.abs(support.y - top) <= CONFIG.landingTolerance) return;
    const nx = (height(x - 0.04, z) ?? top) - (height(x + 0.04, z) ?? top); // Downhill direction of the displaced face.
    const nz = (height(x, z - 0.04) ?? top) - (height(x, z + 0.04) ?? top); // Both axes follow the rendered contour.
    const length = Math.hypot(nx, nz); // A flat unsupported rim keeps falling until ordinary support is found.
    if (length <= 1e-6) return;
    const distance = Math.min(0.08, CONFIG.airTilesPerSecond * seconds); // Bounded face slide, even with no movement input.
    const tx = x + nx / length * distance, tz = z + nz / length * distance; // Downhill target must still respect independent colliders.
    state.feetY = top;
    if (!blockingReason(tx, tz, top)) { player.x = tx * deps.TILE; player.y = tz * deps.TILE; debug.slides++; }
  }

  function land(state, support) {
    const player = deps.player;
    state.feetY = support.y;
    state.vy = 0;
    debug.landings++;
    debug.lastEvent = 'landed on ' + support.kind;
    const dropWorld = Math.max(0, (state.proneFall ? state.proneFallStartY : state.launchGround) - support.y);
    const cliffImpact = state.proneFall ? window.HobunjiCliffFallImpact?.resolve?.(player, {
      dropWorld, dropTiers: window.FallSystem?.dropTiers?.(dropWorld) ?? dropWorld / 2.5,
      dirX: 0, dirY: 0,
    }) : null; // Same Health/Footing/affliction profile as a knockback off a real cliff.
    if (!cliffImpact) window.FallSystem?.land?.(player, {
      dropWorld, deliberate: state.deliberate !== false, source: state.source || 'free jump',
    });
    if (cliffImpact?.lethal) { reset(player, 'lethal prone cliff landing'); return; }
    state.proneFall = false; // A supported roof landing must not charge the impact again on its next tick.
    if (support.kind === 'ground') {
      window.DevRandomRuin?.acceptFreeJumpLanding?.(support.y); // Prevent multi-story ruins from charging the same drop a second time.
      reset(player, 'landed on ground');
      player.physicalFeetY = support.y; // Preserve the actual raised deck on landing so the next grounded render does not teleport back to the tile below it.
      return;
    }
    state.phase = 'supported'; // Own ground movement atop solid props until the player steps off or jumps again.
    state.supportId = support.id;
    setElevation(player, state);
  }

  function enterRoofSupport(hatch) {
    const player = deps?.player;
    if (!player || deps?.getCurrentArea?.() !== 'town' || player.health <= 0
        || !Number.isFinite(hatch?.topY) || !Number.isInteger(hatch.col) || !Number.isInteger(hatch.row)) return false;
    const x=player.x/deps.TILE,z=player.y/deps.TILE; // Exact tile of the confirmed interior-to-roof arrival.
    if (Math.floor(x)!==hatch.col || Math.floor(z)!==hatch.row) return false;
    if (player._freeJump) reset(player,'entering roof via ladder');
    const roofState={area:'town',phase:'supported',feetY:hatch.topY,launchGround:hatch.topY,
      supportId:hatch.balconyId,vy:0,elapsed:0,source:'roof ladder',safeX:x,safeZ:z,lastX:x,lastZ:z}; // Normal raised-platform walking and fall-off are the only movement owners.
    player._freeJump=roofState;
    setElevation(player,roofState);
    debug.lastEvent='entered rooftop via confirmed interior ladder';
    return true;
  }

  function tick(dt) {
    const player = deps?.player, state = player?._freeJump;
    if (!state) return false;
    if (state.phase === 'rope' && player.dodging && window.HangingRopes?.releaseActiveRope?.() === true) return true; // Dodge dismount uses the same release trajectory as Jump; never snap a rider to the floor.
    if (state.area !== deps.getCurrentArea() || player.health <= 0 ||
      (player.prone && state.phase !== 'air' && state.phase !== 'supported') ||
      player.climbing || player.onBranch || player.onCliffBalcony || player.onClimbSurface ||
      (player.dodging && state.phase !== 'air' && state.phase !== 'supported' && state.source !== 'rope swing' && state.source !== 'ruin rope swing') ||
      (player.lunging && !player.prone) || (player.knockbackT > 0 && state.phase !== 'air')) { // Airborne hits and prone must not cancel gravitational elevation.
      reset(player, 'jump interrupted/area changed');
      return false; // Let the native action/movement handler proceed in this frame.
    }
    if (state.phase === 'rope') {
      const control = airControl();
      player.inputX = control.direction.x; player.inputY = control.direction.z;
      player.inputStrength = control.direction.strength;
      setElevation(player, state);
      return true; // HangingRopes alone steps the attached pendulum.
    }
    if (state.external) {
      state.feetY = Number.isFinite(state.y) ? state.y : state.feetY;
      setElevation(player, state);
      return true; // Ruin rope flight shares state but keeps its special layered sweep and deadly pit checks.
    }
    const nativeDodge=!!player.dodging && (state.phase==='air'||state.phase==='supported'); // Gravity/support remain here, but game.js must advance the real dodge timer and swept dash after this tick.
    let remaining = clamp(number(dt, 0), 0, CONFIG.maxFrameSeconds);
    if (state.phase === 'supported' && player.prone) {
      setElevation(player, state);
      return true; // The settled ragdoll stays where it landed; no grounded steering until recovery.
    }
    if (state.phase === 'supported') {
      const support = highestSupport(player.x / deps.TILE, player.y / deps.TILE,
        state.feetY + CONFIG.maxStepUp);
      if (support && support.y >= state.feetY - CONFIG.maxStepUp) {
        state.feetY = support.y;
        if (!nativeDodge) stepMovement(state, remaining, CONFIG.groundTilesPerSecond); // The native dodge sweeps X/Z at authored speed with elevation-aware collision.
        const after = highestSupport(player.x / deps.TILE, player.y / deps.TILE,
          state.feetY + CONFIG.maxStepUp);
        if (after && after.y >= state.feetY - CONFIG.maxStepUp) {
          state.feetY = after.y;
          if (after.kind === 'ground') { reset(player, 'walked onto ground'); return !nativeDodge; }
          setElevation(player, state);
          player.vx = 0; player.vy = 0;
          return !nativeDodge; // Do not swallow the game's ordinary dodge update.
        }
        if (!nativeDodge) remaining = 0; // The supported sweep already consumed this frame's horizontal time; never apply wind twice when stepping off an edge.
      }
      state.phase = 'air';
      state.vy = 0; // Walking off an object begins a normal gravitational fall.
    }
    while (remaining > 0 && player._freeJump === state) {
      const step = Math.min(remaining, CONFIG.stepSeconds);
      remaining -= step;
      const previous = state.feetY;
      state.vy -= CONFIG.gravity * (Motion?.gravityMultiplier?.() ?? 1) * step; // Future slow-fall never modifies baseline puzzle generation.
      state.feetY += state.vy * step;
      state.elapsed += step;
      if (!nativeDodge) stepMovement(state, step, CONFIG.airTilesPerSecond, previous);
      if (player._freeJump !== state) break; // A wall grab transferred movement ownership and physical elevation.
      slideOffTerrain(state, previous, step);
      if (groundAt(player.x / deps.TILE, player.y / deps.TILE) != null) {
        state.safeX = player.x / deps.TILE; state.safeZ = player.y / deps.TILE; // Track the nearest walkable tile passed above during this jump.
      }
      const px = player.x / deps.TILE, pz = player.y / deps.TILE;
      const support = state.vy <= 0
        ? highestSupport(px, pz, previous + CONFIG.landingTolerance)
        : null;
      if (support && state.feetY <= support.y + CONFIG.landingTolerance
        && previous >= support.y - CONFIG.landingTolerance) {
        land(state, support);
        break;
      }
      // The arbitrary seven-unit cutoff must never erase a real lower
      // landing. Only hand off when no floor exists farther below.
      if (state.feetY < state.launchGround - 7
        && !highestSupport(px, pz, state.feetY - CONFIG.landingTolerance)) {
        const instantPit = window.DevRandomRuinSimplePuzzles?.isInstantDeathPit?.(px, pz);
        const fatalPit = instantPit || window.DevHachutuRuin?.isDeadlyPit?.(px, pz)
          || window.DynamicSurfaces?.pointInPit?.(px, pz);
        if (fatalPit && ((instantPit && window.DevRandomRuinSimplePuzzles?.instantRopeChainDeath?.() === true)
          || window.PlayerDowned?.dieImmediately?.('jump-abyss') === true)) {
          reset(player, 'fatal abyss landing');
        } else if (Number.isFinite(window.DevRandomRuin?.getPlayerGroundSupportY?.())) {
          reset(player, 'unsupported fall handed back to ruin');
        } else {
          player.x = state.safeX * deps.TILE; player.y = state.safeZ * deps.TILE;
          const dropWorld = 7;
          const cliffImpact = state.proneFall ? window.HobunjiCliffFallImpact?.resolve?.(player, {
            dropWorld, dropTiers: window.FallSystem?.dropTiers?.(dropWorld) ?? dropWorld / 2.5,
            dirX: 0, dirY: 0,
          }) : null;
          if (!cliffImpact) window.FallSystem?.land?.(player, { dropWorld, source: 'unsupported jump fall' });
          reset(player, 'unsupported fall returned to safe ground');
        }
        return true;
      }
    }
    if (player._freeJump === state) {
      setElevation(player, state);
      player.vx = 0; player.vy = 0;
    }
    return !nativeDodge; // A jump never cancels a dodge or freezes its 220 ms action timeline.
  }

  // Does the imminent blocked tile offer a real reachable upper surface?
  // Reuses the existing jump collision/landing authority, so trees, walls,
  // furniture and rock tops aren't reclassified by the steering helper.
  function hasJumpableSupportAhead(x, y, dx, dy, reachTiles = 0.42) {
    if (!deps?.player || !(deps.TILE > 0)) return false;
    const length = Math.hypot(dx, dy); // Only the caller's normalized intentional direction is sampled.
    if (!(length > 0.001)) return false;
    const startX = x / deps.TILE, startZ = y / deps.TILE; // Input uses movement pixels; support queries use tile/world coordinates.
    const groundedY = groundAt(startX, startZ);
    const feetY = Number.isFinite(deps.player.physicalFeetY) ? deps.player.physicalFeetY : groundedY; // Matches actual launch footing even on raised decking.
    if (!Number.isFinite(feetY)) return false;
    const reach = clamp(number(reachTiles, 0.42), 0.1, 0.5); // Stops at the adjacent obstacle, never looks beyond it.
    const forwardX = startX + dx / length * reach, forwardZ = startZ + dy / length * reach;
    const support = highestSupport(forwardX, forwardZ, feetY + EASY_JUMP_RISE); // Semantic cover heights, with exact native support restrictions.
    return !!support && support.y > feetY + CONFIG.maxStepUp + CONFIG.landingTolerance
      && support.y <= feetY + EASY_JUMP_RISE;
  }

  window.PlayerJump = Object.freeze({
    init(injected) { deps = injected; },
    start, tick, beginFlight, beginRopeRide, setRopeRidePoint, airControl, receiveKnockback, knockProne,
    enterRoofSupport, // Only the explicit interior exit action may put a grounded actor on a high rooftop.
    canOccupyAir: (x, z, feetY) => blockingReason(x, z, feetY) === null,
    heldPoseGrounded() {
      const flight=deps?.player?._freeJump;
      return !!deps?.player&&flight?.phase!=='air'&&flight?.phase!=='rope'&&!(Number(deps.player.heightAboveGround)>0.05);
    },
    heldPoseGroundY() {
      const player=deps?.player; // Physical support, never the cosmetic body sink or weapon transform.
      if(!player||!(deps.TILE>0))return null;
      const flight=player._freeJump;
      const airborne=flight?.phase==='air'||flight?.phase==='rope';
      const ruin=window.DevRandomRuin?.getPlayerGroundSupportY?.();
      if(!airborne&&Number.isFinite(ruin))return ruin;
      const feet=Number.isFinite(player.physicalFeetY)?player.physicalFeetY:(deps.playerMesh||window.PlayerBodyTransformComposer?.getPlayerMesh?.())?.position?.y;
      if(!Number.isFinite(feet))return null;
      return groundAt(player.x/deps.TILE,player.y/deps.TILE,feet+CONFIG.landingTolerance);
    },
    hasJumpableSupportAhead, // Ground steering yields to objects the existing jump solver can actually land on.
    syncExternalFlight: flight => {
      const player = deps?.player;
      if (!player || player._freeJump !== flight || !flight?.external) return false;
      flight.feetY = flight.y;
      setElevation(player, flight);
      return true;
    },
    reset: () => reset(deps?.player),
    get debug() {
      const s = deps?.player?._freeJump;
      return { ...debug, latestChange: 'Free-jump and raised-support steering share the resource movement compositor; rope carry and gravity remain independent', movement: window.ResourceSystem?.movementDebug?.(deps?.player) || null, active: !!s, phase: s?.phase || null, feetY: s?.feetY ?? null,
        heightAboveGround: deps?.player?.heightAboveGround ?? 0,
        vy: s?.vy ?? 0, proneFall: !!s?.proneFall, proneFallStartY: s?.proneFallStartY ?? null,
        knockbackVX: s?.knockbackVX ?? 0, knockbackVZ: s?.knockbackVZ ?? 0,
        elapsed: s?.elapsed ?? 0, blocked: s?.blocked || null,
        baseAirMotion:Motion?.BASE||null,airMultipliers:Motion?{...Motion.multipliers}:null };
    },
    config: CONFIG,
    easyJumpRise: EASY_JUMP_RISE, // Shared with short-ledge and authored-wall climb selection; real jump physics remain authoritative.
  });
})();
