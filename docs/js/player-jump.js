// Ordinary player jumps share the semantic cover tops used by projectiles.
// ClimbSystem owns the Jump input; the normal game movement loop owns its tick.
// Wall climbing and free jumps have separate state, so combat/interactions
// are not accidentally disabled after landing on furniture.
(() => {
  'use strict';

  const CONFIG = Object.freeze({
    launchSpeed: 6.25 / Math.SQRT2, gravity: 11.8, airTilesPerSecond: 3.15,
    groundTilesPerSecond: 2.6, radius: 0.17, stepSeconds: 1 / 60,
    maxFrameSeconds: 0.22, maxStepUp: 0.25, landingTolerance: 0.045,
    assistReach: 1, assistSeconds: 0.16, // Short, collision-checked forward lerp after clearing an obstacle.
  }); // Halve the original 1.65-world-unit apex (~0.83) via launch speed; retain fall gravity.
  let deps = null; // Injected from ClimbSystem.init; contains the same live player and terrain readers.
  const debug = { starts: 0, landings: 0, blockedMoves: 0, lastEvent: 'not started', lastObstacle: null, grabs: 0, slides: 0, assists: 0 }; // Mobile diagnostics in ClimbSystem.debug.

  const number = (value, fallback = null) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function tileAt(x, z) {
    return deps?.getActiveGrid?.()?.[Math.floor(z)]?.[Math.floor(x)] || null;
  }

  function groundAt(x, z) {
    const tile = tileAt(x, z);
    if (!tile || tile.incline || tile.mapBoundary || deps.isSolid?.(tile.type) || window.MapBoundaryGuard?.isBoundaryTile?.(tile)) return null;
    if (['void', 'pit'].includes(String(tile.type).toLowerCase()) || window.DynamicSurfaces?.pointInPit?.(x, z)) return null; // An authored death pit is never a jump landing floor.
    const area = deps.getCurrentArea();
    const surface = window.AreaFootprintBlockers?.surfaceYAt?.(area, x, z);
    const y = Number.isFinite(surface) ? surface : deps.tileSurfaceYInArea?.(tile, area);
    return Number.isFinite(y) ? y : null;
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
    const floorY = groundAt(x, z);
    let best = floorY != null && floorY <= maxY ? { y: floorY, kind: 'ground' } : null;
    const dynamic = window.DynamicSurfaces?.sampleSupport?.(x, z, { maxY, minY: -Infinity });
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
    if (window.InteriorDoorTiles?.blocksBox?.(area, x, z, CONFIG.radius)) return 'closed interior door';
    for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) {
      if (area === 'farm' && (access?.isHouseFootprint?.(col, row) || access?.isFarmBuildingCollisionTile?.(col, row))) return 'farm building';
      if ((area === 'town' || deps._isZoneArea?.(area)) && access?.isTownBuildingCollisionTile?.(col, row, area)) return 'town building';
    }
    // Clearing one low piece of cover does not exempt any other blocker.
    if (window.AreaFootprintBlockers?.blocksBox?.(area, x, z, CONFIG.radius, feetY + 0.05))
      return 'solid footprint';
    if (window.DynamicSurfaces?.blockerAt?.(x, z, {
      worldY: feetY, radius: CONFIG.radius, actorHeight: 1.25,
    })) return 'dynamic blocker';
    if (deps.canPlayerOccupyAtHeight) {
      if (!deps.canPlayerOccupyAtHeight(x * deps.TILE, z * deps.TILE, feetY))
        return 'world collision';
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
    const ground = groundAt(player.x / deps.TILE, player.y / deps.TILE);
    player.physicalFeetY = state.feetY; // World-space physical foot height used by jumping and height-aware interactions.
    player.heightAboveGround = Math.max(0, state.feetY - (ground ?? state.launchGround)); // Includes jumping AND height gained by standing on raised cover.
    player.jumpHeightAboveGround = player.heightAboveGround; // Simple debug/consumer alias for the shared physical elevation.
    player.climbSurfaceY = state.feetY;
    player.climbHopBounce = 0; // Physical lift is already in climbSurfaceY; never add it twice.
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

  function start() {
    const player = deps?.player;
    if (!player) return false;
    if (player._freeJump && player._freeJump.area !== deps.getCurrentArea()) {
      reset(player, 'stale jump discarded'); // Scene transitions do not preserve the previous world's raised supports.
    }
    const old = player._freeJump;
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
    const baseY = old?.phase === 'supported' ? old.feetY
      : (Number.isFinite(ruinSupportY) ? ruinSupportY
        : (groundAt(x, z) ?? deps.worldSurfaceY?.(player.x, player.y)));
    if (!Number.isFinite(baseY)) return false;
    const launchGround = groundAt(x, z) ?? baseY;
    const state = {
      area: deps.getCurrentArea(), phase: 'air', feetY: baseY,
      launchGround, vy: CONFIG.launchSpeed, elapsed: 0, blocked: null,
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
    const length = Math.hypot(number(input.x, 0), number(input.y, 0));
    return length > 0.01 ? { x: input.x / length, z: input.y / length, strength: Math.min(1, length) }
      : { x: 0, z: 0, strength: 0 };
  }

  function tryAirGrab(state, direction) {
    if (state.phase !== 'air') return false;
    const pos = { x: deps.player.x / deps.TILE, z: deps.player.y / deps.TILE, y: state.feetY }; // Shared physical airborne position for both climb owners.
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

  function stepMovement(state, seconds, speed) {
    const player = deps.player;
    const direction = movementVector();
    player.inputX = direction.x; player.inputY = direction.z; player.inputStrength = direction.strength; // Keep aiming/movement systems informed during free jumps and raised-support walking.
    if (tryAirGrab(state, direction.strength ? direction : state.lastDirection || { x: Math.cos(player.angle || 0), z: Math.sin(player.angle || 0) })) return;
    if (!direction.strength) { state.assist = null; return; }
    state.lastDirection = direction; // Falling beside the approached face can still catch it after movement input is released.
    if (state.assist) {
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
    const travel = (nativeSpeed > 0 ? nativeSpeed : speed) * seconds * direction.strength;
    const segments = Math.max(1, Math.ceil(travel / 0.08));
    for (let i = 0; i < segments; i++) {
      const x = player.x / deps.TILE + direction.x * travel / segments;
      const z = player.y / deps.TILE + direction.z * travel / segments;
      const blocked = blockingReason(x, z, state.feetY);
      if (blocked) {
        state.blocked = blocked;
        debug.blockedMoves++;
        debug.lastObstacle = blocked;
        state.obstaclePending = true; // Trigger assistance only after this actual collider is cleared.
        const slide = slideMovement(player.x / deps.TILE, player.y / deps.TILE,
          direction.x * travel / segments, direction.z * travel / segments, state.feetY); // Preserve tangential input while gravity continues.
        if (!slide) break;
        player.x = slide.x * deps.TILE; player.y = slide.z * deps.TILE;
        debug.slides++;
        continue;
      }
      if (state.phase === 'air' && state.obstaclePending) {
        const target = findLandingAssist(state, direction); // A collider's clearance opens a bounded, swept landing assist.
        state.obstaclePending = false;
        state.blocked = null;
        if (target) { state.assist = { ...target, remaining: CONFIG.assistSeconds }; debug.assists++; }
      }
      player.x = x * deps.TILE; player.y = z * deps.TILE;
      state.lastX = x; state.lastZ = z;
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
    window.FallSystem?.land?.(player, {
      dropWorld: Math.max(0, state.launchGround - support.y),
      deliberate: true, source: 'free jump',
    });
    if (support.kind === 'ground') {
      window.DevRandomRuin?.acceptFreeJumpLanding?.(support.y); // Prevent multi-story ruins from charging the same drop a second time.
      reset(player, 'landed on ground');
      return;
    }
    state.phase = 'supported'; // Own ground movement atop solid props until the player steps off or jumps again.
    state.supportId = support.id;
    setElevation(player, state);
  }

  function tick(dt) {
    const player = deps?.player, state = player?._freeJump;
    if (!state) return false;
    if (state.area !== deps.getCurrentArea() || player.health <= 0 || player.prone ||
      player.climbing || player.onBranch || player.onCliffBalcony || player.onClimbSurface ||
      player.dodging || player.lunging || player.knockbackT > 0) {
      reset(player, 'jump interrupted/area changed');
      return false; // Let the native action/movement handler proceed in this frame.
    }
    let remaining = clamp(number(dt, 0), 0, CONFIG.maxFrameSeconds);
    if (state.phase === 'supported') {
      const support = highestSupport(player.x / deps.TILE, player.y / deps.TILE,
        state.feetY + CONFIG.maxStepUp);
      if (support && support.y >= state.feetY - CONFIG.maxStepUp) {
        state.feetY = support.y;
        stepMovement(state, remaining, CONFIG.groundTilesPerSecond);
        const after = highestSupport(player.x / deps.TILE, player.y / deps.TILE,
          state.feetY + CONFIG.maxStepUp);
        if (after && after.y >= state.feetY - CONFIG.maxStepUp) {
          state.feetY = after.y;
          if (after.kind === 'ground') { reset(player, 'walked onto ground'); return true; }
          setElevation(player, state);
          player.vx = 0; player.vy = 0;
          return true;
        }
      }
      state.phase = 'air';
      state.vy = 0; // Walking off an object begins a normal gravitational fall.
    }
    while (remaining > 0 && player._freeJump === state) {
      const step = Math.min(remaining, CONFIG.stepSeconds);
      remaining -= step;
      const previous = state.feetY;
      state.vy -= CONFIG.gravity * step;
      state.feetY += state.vy * step;
      state.elapsed += step;
      stepMovement(state, step, CONFIG.airTilesPerSecond);
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
          window.FallSystem?.land?.(player, { dropWorld: 7, source: 'unsupported jump fall' });
          reset(player, 'unsupported fall returned to safe ground');
        }
        return true;
      }
    }
    if (player._freeJump === state) {
      setElevation(player, state);
      player.vx = 0; player.vy = 0;
    }
    return true;
  }

  window.PlayerJump = Object.freeze({
    init(injected) { deps = injected; },
    start, tick,
    reset: () => reset(deps?.player),
    get debug() {
      const s = deps?.player?._freeJump;
      return { ...debug, latestChange: 'Air grabs, geometry sliding, adjacent elevated landings and one-tile landing assist', active: !!s, phase: s?.phase || null, feetY: s?.feetY ?? null,
        heightAboveGround: deps?.player?.heightAboveGround ?? 0,
        vy: s?.vy ?? 0, elapsed: s?.elapsed ?? 0, blocked: s?.blocked || null };
    },
    config: CONFIG,
  });
})();
