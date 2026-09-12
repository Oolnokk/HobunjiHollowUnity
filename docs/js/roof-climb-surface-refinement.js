// Final structural-roof movement/contact refinement layered over roof-climb.js.
(() => {
  'use strict';

  if (window.HobunjiRoofClimbSurfaceRefinement) return;
  const baseApi = window.HobunjiRoofClimb;
  if (!baseApi) return;

  const ROOF_STATE_KEY = '__hobunjiRoofSurface';
  const HOOK_MARK = '__hobunjiRoofSurfaceRefinement';
  const MAX_WALL_DISTANCE_TILES = 0.42; // Requires the player's body to be essentially touching the structural wall before climbing.
  const WALL_SURFACE_OFFSET_TILES = 0.14; // Keeps the portrait outside protruding brickwork while climbing the authored wall plane.
  const ROOF_SURFACE_OFFSET_Y = 0.08; // Keeps feet above the authored roof collision plane so shingles do not visually swallow them.
  const ROOF_EDGE_TOLERANCE_TILES = 0.035; // Bridges tiny authored triangle seams without allowing meaningful off-roof walking.
  const ROOF_WALK_SPEED_PX_S = 90; // Matches branch walking while the refined roof movement path is active.
  const CLIMB_HOP_ACTIVE_S = 0.32; // Mirrors climb-system.js so the custom wall-follow path stays synchronized with its hop cadence.
  const CLIMB_HOP_PAUSE_S = 0.26; // Mirrors climb-system.js; the base roof wrapper still supplies the requested 2x time scale.
  const WALL_PATH_START = 0.12; // First portion eases the nearby player onto the wall-offset guide instead of snapping sideways.
  const WALL_PATH_END = 0.84; // Final portion mantles from the wall top to the roof landing.
  const EPS = 1e-6;

  let climbDeps = null; // Exact ClimbSystem.init deps; owns the fresh keyboard/stick/camera-relative movement getter.
  let systemHooked = false;
  const debug = {
    lastBlockReason: null,
    lastWallDistance: null,
    lastWallFaceId: null,
    lastWallAngleDeg: null,
    lastMovementInput: null,
    lastMovementMovedPx: 0,
    lastMovementAt: 0,
  }; // Mobile-visible state merged into HobunjiRoofClimb.getDebug().

  const finite = value => Number.isFinite(Number(value));
  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
  const runtimePlayer = () => climbDeps?.player || window.Combat?.deps?.player || window.__climbDebug?.getPlayer?.() || null;
  const runtimeTile = () => Math.max(1, Number(climbDeps?.TILE || window.Combat?.deps?.TILE) || 1);
  const runtimeFn = name => typeof climbDeps?.[name] === 'function'
    ? climbDeps[name]
    : (typeof window.Combat?.deps?.[name] === 'function' ? window.Combat.deps[name] : null);

  function isRoofState(value) { return !!value?.[ROOF_STATE_KEY]; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function lerpPoint(a, b, t) {
    return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) };
  }
  function distance2D(a, b) { return Math.hypot((a?.x || 0) - (b?.x || 0), (a?.z || 0) - (b?.z || 0)); }
  function normalize2(x, z) {
    const len = Math.hypot(x, z);
    return len > EPS ? { x: x / len, z: z / len } : null;
  }

  function faceTriangles(face) {
    const v = face?.vertices || [];
    if (v.length === 3) return [[v[0], v[1], v[2]]];
    if (v.length >= 4) return [[v[0], v[1], v[2]], [v[0], v[2], v[3]]];
    return [];
  }

  function roofSurfaceYAt(meta, x, z, tolerance = ROOF_EDGE_TOLERANCE_TILES) {
    let best = null;
    for (const roof of meta?.roofs || []) {
      for (const [a, b, c] of faceTriangles(roof)) {
        const denom = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
        if (Math.abs(denom) < EPS) continue;
        const wa = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / denom;
        const wb = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / denom;
        const wc = 1 - wa - wb;
        if (wa < -tolerance || wb < -tolerance || wc < -tolerance) continue;
        const y = wa * a.y + wb * b.y + wc * c.y;
        if (!Number.isFinite(y)) continue;
        if (best == null || y > best) best = y;
      }
    }
    return best;
  }

  function farthestPair(points) {
    if (!Array.isArray(points) || points.length < 2) return null;
    let best = null;
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const d = distance2D(points[i], points[j]);
        if (!best || d > best.distance) best = { a: points[i], b: points[j], distance: d };
      }
    }
    return best && best.distance > EPS ? [best.a, best.b] : null;
  }

  function horizontalWallNormal(face) {
    const tri = faceTriangles(face)[0];
    if (!tri) return null;
    const [a, b, c] = tri;
    const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
    const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
    const nx = uy * vz - uz * vy;
    const nz = ux * vy - uy * vx;
    return normalize2(nx, nz);
  }

  function wallGuide(target) {
    const player = runtimePlayer();
    const tile = runtimeTile();
    const wall = target?.meta?.walls?.find(face => String(face?.id) === String(target.wallFaceId));
    const vertices = wall?.vertices || [];
    if (!player || vertices.length < 3) return null;

    const minY = Math.min(...vertices.map(v => Number(v.y) || 0));
    const maxY = Math.max(...vertices.map(v => Number(v.y) || 0));
    const yTol = Math.max(0.015, (maxY - minY) * 0.04);
    let bottomPoints = vertices.filter(v => (Number(v.y) || 0) <= minY + yTol);
    let topPoints = vertices.filter(v => (Number(v.y) || 0) >= maxY - yTol);
    if (bottomPoints.length < 2) bottomPoints = vertices.slice().sort((a, b) => a.y - b.y).slice(0, 2);
    if (topPoints.length < 2) topPoints = vertices.slice().sort((a, b) => b.y - a.y).slice(0, 2);
    const bottomPair = farthestPair(bottomPoints);
    let topPair = farthestPair(topPoints);
    if (!bottomPair || !topPair) return null;

    const direct = distance2D(bottomPair[0], topPair[0]) + distance2D(bottomPair[1], topPair[1]);
    const crossed = distance2D(bottomPair[0], topPair[1]) + distance2D(bottomPair[1], topPair[0]);
    if (crossed < direct) topPair = [topPair[1], topPair[0]];

    const px = Number(player.x) / tile;
    const pz = Number(player.y) / tile;
    const bdx = bottomPair[1].x - bottomPair[0].x;
    const bdz = bottomPair[1].z - bottomPair[0].z;
    const bLenSq = bdx * bdx + bdz * bdz;
    const u = bLenSq > EPS
      ? clamp(((px - bottomPair[0].x) * bdx + (pz - bottomPair[0].z) * bdz) / bLenSq, 0, 1)
      : 0.5;
    const bottom = lerpPoint(bottomPair[0], bottomPair[1], u);
    const top = lerpPoint(topPair[0], topPair[1], u);

    let outward = normalize2(px - bottom.x, pz - bottom.z);
    if (!outward) {
      const targetDir = normalize2(Number(target?.dir?.x) || 0, Number(target?.dir?.y) || 0);
      outward = targetDir ? { x: -targetDir.x, z: -targetDir.z } : horizontalWallNormal(wall);
    }
    if (!outward) return null;
    const inward = { x: -outward.x, z: -outward.z };
    const tangent = normalize2(bdx, bdz) || { x: -inward.z, z: inward.x };
    return {
      wall,
      bottom,
      top,
      outward,
      inward,
      tangent,
      distance: Math.hypot(px - bottom.x, pz - bottom.z),
    };
  }

  function refineRoofTarget(target) {
    if (!target || target.type !== 'roof') return target || null;
    if (target.__hobunjiSurfaceRefined) return target;
    const guide = wallGuide(target);
    const distance = guide?.distance ?? Number(target.playerWallDistance);
    debug.lastWallDistance = Number.isFinite(distance) ? distance : null;
    debug.lastWallFaceId = target.wallFaceId ?? null;
    if (!guide || !Number.isFinite(distance)) {
      debug.lastBlockReason = 'unable to resolve structural wall guide';
      return null;
    }
    if (distance > MAX_WALL_DISTANCE_TILES) {
      debug.lastBlockReason = `not close enough to structural wall (${distance.toFixed(3)} > ${MAX_WALL_DISTANCE_TILES.toFixed(2)} tiles)`;
      return null;
    }

    let endX = Number(target.endWorldX);
    let endZ = Number(target.endWorldZ);
    let rawRoofY = roofSurfaceYAt(target.meta, endX, endZ, 0.01);
    // Prefer a landing directly inward from the selected wall top so the two-hop
    // climb follows the wall plane instead of cutting diagonally through masonry.
    for (const offset of [0.18, 0.28, 0.42, 0.62, 0.9, 1.2]) {
      const x = guide.top.x + guide.inward.x * offset;
      const z = guide.top.z + guide.inward.z * offset;
      const y = roofSurfaceYAt(target.meta, x, z, 0.015);
      if (!Number.isFinite(y)) continue;
      endX = x;
      endZ = z;
      rawRoofY = y;
      break;
    }
    if (!Number.isFinite(rawRoofY)) rawRoofY = Number(target.endSurfaceY);
    if (!Number.isFinite(rawRoofY)) {
      debug.lastBlockReason = 'authored roof surface unavailable at refined landing';
      return null;
    }

    debug.lastBlockReason = null;
    debug.lastWallAngleDeg = Math.atan2(guide.tangent.z, guide.tangent.x) * 180 / Math.PI;
    return {
      ...target,
      endWorldX: endX,
      endWorldZ: endZ,
      endSurfaceY: rawRoofY + ROOF_SURFACE_OFFSET_Y,
      rawRoofSurfaceY: rawRoofY,
      dir: { x: guide.inward.x, y: guide.inward.z },
      wallPoint: { x: guide.bottom.x, y: guide.bottom.y, z: guide.bottom.z },
      playerWallDistance: distance,
      wallGuide: guide,
      __hobunjiSurfaceRefined: true,
    };
  }

  function buildClimbPath(target, player) {
    const guide = target?.wallGuide;
    if (!guide || !player) return null;
    const tile = runtimeTile();
    const offset = WALL_SURFACE_OFFSET_TILES;
    const startSurfaceY = Number(player.climbSurfaceStartY) || 0;
    const wallTopSurfaceY = Math.max(startSurfaceY, Number(guide.top.y) || startSurfaceY);
    return {
      guide,
      start: { x: Number(player.climbStartX), y: Number(player.climbStartY), surfaceY: startSurfaceY },
      bottom: {
        x: (guide.bottom.x + guide.outward.x * offset) * tile,
        y: (guide.bottom.z + guide.outward.z * offset) * tile,
        surfaceY: startSurfaceY,
      },
      top: {
        x: (guide.top.x + guide.outward.x * offset) * tile,
        y: (guide.top.z + guide.outward.z * offset) * tile,
        surfaceY: wallTopSurfaceY,
      },
      landing: {
        x: Number(target.endWorldX) * tile,
        y: Number(target.endWorldZ) * tile,
        surfaceY: Number(target.endSurfaceY),
      },
    };
  }

  function climbOverall(player) {
    const count = Math.max(1, Number(player?.climbHopCount) || 1);
    const cycle = CLIMB_HOP_ACTIVE_S + CLIMB_HOP_PAUSE_S;
    const elapsed = clamp(Number(player?.climbElapsed) || 0, 0, count * cycle);
    const hopIndex = Math.min(count - 1, Math.floor(elapsed / cycle));
    const withinCycle = elapsed - hopIndex * cycle;
    const hopLocalT = withinCycle < CLIMB_HOP_ACTIVE_S
      ? clamp(withinCycle / CLIMB_HOP_ACTIVE_S, 0, 1)
      : 1;
    const eased = 1 - Math.pow(1 - hopLocalT, 2);
    return clamp((hopIndex + eased) / count, 0, 1);
  }

  function applyWallFollowingPath(player, path) {
    if (!player || !path) return;
    const overall = climbOverall(player);
    let x, y, surfaceY;
    if (overall < WALL_PATH_START) {
      const t = overall / WALL_PATH_START;
      x = lerp(path.start.x, path.bottom.x, t);
      y = lerp(path.start.y, path.bottom.y, t);
      surfaceY = path.start.surfaceY;
    } else if (overall < WALL_PATH_END) {
      const t = (overall - WALL_PATH_START) / (WALL_PATH_END - WALL_PATH_START);
      x = lerp(path.bottom.x, path.top.x, t);
      y = lerp(path.bottom.y, path.top.y, t);
      surfaceY = lerp(path.bottom.surfaceY, path.top.surfaceY, t);
    } else {
      const t = (overall - WALL_PATH_END) / (1 - WALL_PATH_END);
      x = lerp(path.top.x, path.landing.x, t);
      y = lerp(path.top.y, path.landing.y, t);
      surfaceY = lerp(path.top.surfaceY, path.landing.surfaceY, t);
    }
    player.x = x;
    player.y = y;
    player.climbSurfaceY = surfaceY;
    const facing = Math.atan2(path.guide.inward.z, path.guide.inward.x);
    player.angle = facing;
    runtimeFn('setFacingAngle')?.(facing);
    runtimeFn('setTargetAimAngle')?.(facing);
    runtimeFn('setLastMoveAngle')?.(facing);
  }

  function freshMovementInput(player) {
    const live = runtimeFn('getMovementInput')?.();
    if (live && (finite(live.x) || finite(live.y))) return { x: Number(live.x) || 0, y: Number(live.y) || 0, source: 'ClimbSystem.getMovementInput' };
    return { x: Number(player?.inputX) || 0, y: Number(player?.inputY) || 0, source: 'player.input fallback' };
  }

  function updateRoofMovement(dt) {
    const player = runtimePlayer();
    const roof = player?.onBranch;
    if (!isRoofState(roof)) return false;
    const tile = runtimeTile();
    const raw = freshMovementInput(player);
    const rawLen = Math.hypot(raw.x, raw.y);
    const strength = Math.min(1, rawLen);
    const nx = rawLen > EPS ? raw.x / rawLen : 0;
    const ny = rawLen > EPS ? raw.y / rawLen : 0;
    player.inputX = nx;
    player.inputY = ny;
    player.inputStrength = strength;
    debug.lastMovementInput = { x: raw.x, y: raw.y, source: raw.source };
    debug.lastMovementAt = Date.now();
    debug.lastMovementMovedPx = 0;

    const distancePx = ROOF_WALK_SPEED_PX_S * Math.max(0, Number(dt) || 0) * strength;
    if (distancePx > EPS) {
      const maxSubstepPx = Math.max(1, tile * 0.04);
      const steps = Math.max(1, Math.ceil(distancePx / maxSubstepPx));
      const stepX = nx * distancePx / steps;
      const stepY = ny * distancePx / steps;
      let moved = 0;
      let lastSurface = roofSurfaceYAt(roof.meta, player.x / tile, player.y / tile);

      for (let index = 0; index < steps; index++) {
        const nextX = player.x + stepX;
        const nextY = player.y + stepY;
        let surface = roofSurfaceYAt(roof.meta, nextX / tile, nextY / tile);
        if (Number.isFinite(surface)) {
          player.x = nextX;
          player.y = nextY;
          lastSurface = surface;
          moved += Math.hypot(stepX, stepY);
          continue;
        }

        // Slide along the authored roof boundary instead of freezing completely
        // when a diagonal input reaches an eave or a tiny triangle seam.
        const xSurface = roofSurfaceYAt(roof.meta, nextX / tile, player.y / tile);
        const ySurface = roofSurfaceYAt(roof.meta, player.x / tile, nextY / tile);
        if (Number.isFinite(xSurface) && (!Number.isFinite(ySurface) || Math.abs(stepX) >= Math.abs(stepY))) {
          player.x = nextX;
          lastSurface = xSurface;
          moved += Math.abs(stepX);
        } else if (Number.isFinite(ySurface)) {
          player.y = nextY;
          lastSurface = ySurface;
          moved += Math.abs(stepY);
        }
      }

      if (Number.isFinite(lastSurface)) player.branchSurfaceY = lastSurface + ROOF_SURFACE_OFFSET_Y;
      debug.lastMovementMovedPx = moved;
      player.angle = Math.atan2(ny, nx);
      runtimeFn('setFacingAngle')?.(player.angle);
      runtimeFn('setTargetAimAngle')?.(player.angle);
      runtimeFn('setLastMoveAngle')?.(player.angle);
    } else {
      const surface = roofSurfaceYAt(roof.meta, player.x / tile, player.y / tile);
      if (Number.isFinite(surface)) player.branchSurfaceY = surface + ROOF_SURFACE_OFFSET_Y;
    }

    player.vx = 0;
    player.vy = 0;
    return true;
  }

  function refinedDirectTarget() {
    ensureSystemHooks();
    return refineRoofTarget(baseApi.getRoofClimbTarget?.() || null);
  }

  function refinedStartRoofClimb(target) {
    const refined = refineRoofTarget(target);
    if (!refined) return false;
    const result = baseApi.startRoofClimb?.(refined);
    if (result) {
      const player = runtimePlayer();
      player._hobunjiRoofRefinedPath = buildClimbPath(refined, player); // Used after the base hop timer runs so render position follows the actual wall plane.
    }
    return !!result;
  }

  function markHook(fn, role) {
    if (typeof fn !== 'function') return fn;
    fn[HOOK_MARK] = role;
    return fn;
  }

  function hooksCurrent(system = window.ClimbSystem) {
    return !!system && ['getClimbTarget', 'startClimb', 'updateClimb', 'updateBranchMovement', 'resolveBranchKnockback']
      .every(name => typeof system[name] === 'function' && !!system[name][HOOK_MARK]);
  }

  function installSystemHooks(system) {
    if (!system) return false;
    let changed = false;

    if (typeof system.init === 'function' && !system.init.__hobunjiRoofSurfaceDepsCapture) {
      const originalInit = system.init;
      function captureRefinementDeps(injectedDeps) {
        climbDeps = injectedDeps || climbDeps;
        return originalInit.apply(this, arguments);
      }
      captureRefinementDeps.__hobunjiRoofSurfaceDepsCapture = true;
      captureRefinementDeps.__hobunjiRoofSurfaceDepsCapturePrevious = originalInit;
      system.init = captureRefinementDeps;
      changed = true;
    }

    if (typeof system.getClimbTarget === 'function' && !system.getClimbTarget[HOOK_MARK]) {
      const original = system.getClimbTarget;
      system.getClimbTarget = markHook(function refinedStructureClimbTarget() {
        const target = original.apply(this, arguments);
        return target?.type === 'roof' ? refineRoofTarget(target) : target;
      }, 'getClimbTarget');
      changed = true;
    }

    if (typeof system.startClimb === 'function' && !system.startClimb[HOOK_MARK]) {
      const original = system.startClimb;
      system.startClimb = markHook(function refinedStructureClimbStart(target) {
        if (target?.type !== 'roof') return original.apply(this, arguments);
        const refined = refineRoofTarget(target);
        if (!refined) return false;
        const result = original.call(this, refined);
        if (result) {
          const player = runtimePlayer();
          player._hobunjiRoofRefinedPath = buildClimbPath(refined, player);
        }
        return result;
      }, 'startClimb');
      changed = true;
    }

    if (typeof system.updateClimb === 'function' && !system.updateClimb[HOOK_MARK]) {
      const original = system.updateClimb;
      system.updateClimb = markHook(function refinedStructureClimbUpdate(dt) {
        const player = runtimePlayer();
        const path = player?._hobunjiRoofRefinedPath || null;
        const result = original.call(this, dt);
        if (path) {
          applyWallFollowingPath(player, path);
          if (!player.climbing) {
            const surface = roofSurfaceYAt(player.onBranch?.meta, player.x / runtimeTile(), player.y / runtimeTile());
            if (Number.isFinite(surface)) player.branchSurfaceY = surface + ROOF_SURFACE_OFFSET_Y;
            player._hobunjiRoofRefinedPath = null;
          }
        }
        return result;
      }, 'updateClimb');
      changed = true;
    }

    if (typeof system.updateBranchMovement === 'function' && !system.updateBranchMovement[HOOK_MARK]) {
      const original = system.updateBranchMovement;
      system.updateBranchMovement = markHook(function refinedRoofMovement(dt) {
        if (updateRoofMovement(dt)) return;
        return original.call(this, dt);
      }, 'updateBranchMovement');
      changed = true;
    }

    if (typeof system.resolveBranchKnockback === 'function' && !system.resolveBranchKnockback[HOOK_MARK]) {
      const original = system.resolveBranchKnockback;
      system.resolveBranchKnockback = markHook(function refinedRoofKnockback(entity, fromX, fromY, speedPxS) {
        const wasRoof = isRoofState(entity?.onBranch);
        const result = original.call(this, entity, fromX, fromY, speedPxS);
        if (wasRoof && result && !result.fell && isRoofState(entity?.onBranch)) {
          const surface = roofSurfaceYAt(entity.onBranch.meta, entity.x / runtimeTile(), entity.y / runtimeTile());
          if (Number.isFinite(surface)) entity.branchSurfaceY = surface + ROOF_SURFACE_OFFSET_Y;
        }
        return result;
      }, 'resolveBranchKnockback');
      changed = true;
    }

    systemHooked = hooksCurrent(system);
    return changed || systemHooked;
  }

  function ensureSystemHooks() {
    const system = window.ClimbSystem;
    if (!system) return false;
    installSystemHooks(system);
    systemHooked = hooksCurrent(system);
    return systemHooked;
  }

  function armClimbAssignmentHook() {
    if (window.ClimbSystem) {
      installSystemHooks(window.ClimbSystem);
      return true;
    }
    const descriptor = Object.getOwnPropertyDescriptor(window, 'ClimbSystem');
    if (descriptor && descriptor.configurable === false) return false;
    if (descriptor && typeof descriptor.set === 'function') {
      const priorGet = descriptor.get;
      const priorSet = descriptor.set;
      Object.defineProperty(window, 'ClimbSystem', {
        configurable: true,
        enumerable: descriptor.enumerable !== false,
        get() { return priorGet ? priorGet.call(window) : undefined; },
        set(value) {
          priorSet.call(window, value);
          const resolved = priorGet ? priorGet.call(window) : value;
          if (resolved?.init) {
            const originalInit = resolved.init;
            if (!originalInit.__hobunjiRoofSurfaceDepsCapture) {
              function captureBeforeDeferredHooks(injectedDeps) {
                climbDeps = injectedDeps || climbDeps;
                return originalInit.apply(this, arguments);
              }
              captureBeforeDeferredHooks.__hobunjiRoofSurfaceDepsCapture = true;
              captureBeforeDeferredHooks.__hobunjiRoofSurfaceDepsCapturePrevious = originalInit;
              resolved.init = captureBeforeDeferredHooks;
            }
          }
          queueMicrotask(() => installSystemHooks(window.ClimbSystem || resolved));
        },
      });
      return true;
    }

    let value = descriptor?.value;
    Object.defineProperty(window, 'ClimbSystem', {
      configurable: true,
      enumerable: descriptor?.enumerable !== false,
      get() { return value; },
      set(next) {
        value = next;
        installSystemHooks(next);
      },
    });
    return true;
  }

  // Replace only the public roof API reference. The original frozen object remains
  // the lower-level implementation used by its already-installed closures.
  window.HobunjiRoofClimb = Object.freeze({
    ...baseApi,
    getRoofClimbTarget: refinedDirectTarget,
    startRoofClimb: refinedStartRoofClimb,
    updateRoofMovement,
    ensureSurfaceRefinementHooks: ensureSystemHooks,
    maxWallDistanceTiles: MAX_WALL_DISTANCE_TILES,
    surfaceOffsets: Object.freeze({ wallTiles: WALL_SURFACE_OFFSET_TILES, roofY: ROOF_SURFACE_OFFSET_Y }),
    getDebug() {
      const base = baseApi.getDebug?.() || {};
      return {
        ...base,
        lastBlockReason: debug.lastBlockReason || base.lastBlockReason,
        surfaceRefinementHooksCurrent: hooksCurrent(),
        surfaceRefinementDepsCaptured: !!climbDeps?.player,
        maxWallDistanceTiles: MAX_WALL_DISTANCE_TILES,
        surfaceOffsets: { wallTiles: WALL_SURFACE_OFFSET_TILES, roofY: ROOF_SURFACE_OFFSET_Y },
        ...debug,
      };
    },
  });

  armClimbAssignmentHook();

  window.HobunjiRoofClimbSurfaceRefinement = Object.freeze({
    ensureSystemHooks,
    refineRoofTarget,
    updateRoofMovement,
    roofSurfaceYAt,
    getDebug: () => ({ systemHooked, depsCaptured: !!climbDeps?.player, ...debug }),
  });
})();
