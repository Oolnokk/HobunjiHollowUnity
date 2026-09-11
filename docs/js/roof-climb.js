// Climbable structural roofs: authored wall/roof planes only, never brick/shingle detail.
(() => {
  'use strict';

  const META_KEY = 'hobunjiRoofClimbStructure';
  const ROOF_STATE_KEY = '__hobunjiRoofSurface';
  const MAX_PLAYER_WALL_DISTANCE = 1.75; // Used to make standing beside a structural wall sufficient for building climbing.
  const ENTRANCE_CLEARANCE_WORLD = 1.35; // Legacy metadata guard; the companion probe bridge clears entrance exclusions at runtime.
  const ROOF_SAMPLE_OFFSETS = [0.28, 0.5, 0.75, 1.0, 1.25]; // Used to find a stable roof landing point just behind the nearest wall plane.
  const ROOF_WALK_SPEED_PX_S = 90; // Used by the roof movement override; matches the existing branch walking speed.
  const ROOF_KNOCKBACK_DUR_S = 0.18; // Used to mirror ordinary/branch knockback travel time.
  const EPS = 1e-6;

  let climbDeps = null;
  let climbHooksInstalled = false;
  let structureWrapperInstalled = false;
  const debugState = {
    lastCandidate: null,
    lastBlockReason: null,
    lastWallHit: null,
    lastStructureCount: 0,
    lastClimbAt: 0,
  }; // Used by getDebug for mobile-visible roof-climb diagnostics.

  const normalizePiece = piece => piece?.currentPiece || piece || null;
  const finite = value => Number.isFinite(Number(value));

  function preparedPiece(piece) {
    return window.EntryTunnelWallUnmark?.preparePiece?.(piece)?.piece || piece;
  }

  // Mirrors HousePieceGen.buildGroupFromPiece's placement transform exactly so
  // the collision planes remain the authored structural quads even when the
  // visible wall is later replaced by WallBuilder bricks or the roof by shingles.
  function transformedStructureFaces(pieceInput, bldgMinC, bldgMinR, opts = {}) {
    const sourcePiece = preparedPiece(pieceInput);
    const piece = normalizePiece(sourcePiece);
    if (!piece) return { walls: [], roofs: [] };
    const faces = Array.isArray(piece.base?.faces) ? piece.base.faces : [];
    const pcells = Array.isArray(piece.footprint?.cells) ? piece.footprint.cells : [];
    const gc = Math.floor((Number(piece.gridSize) || 18) / 2);
    const minCX = pcells.length ? Math.min(...pcells.map(cell => Number(cell.x))) : gc;
    const minCZ = pcells.length ? Math.min(...pcells.map(cell => Number(cell.y))) : gc;
    const offX = Number(bldgMinC) + (gc - minCX);
    const offZ = Number(bldgMinR) + (gc - minCZ);
    const offY = Number(opts.elevationY) || 0;
    const rotDeg = Number(opts.rotationDeg) || 0;
    const rotRad = -rotDeg * Math.PI / 180;
    let cosR = 1, sinR = 0, pivX = 0, pivZ = 0, txAdj = 0, tzAdj = 0;
    if (rotDeg) {
      cosR = Math.cos(rotRad);
      sinR = Math.sin(rotRad);
      const maxCXp = pcells.length ? Math.max(...pcells.map(cell => Number(cell.x))) : gc + 3;
      const maxCZp = pcells.length ? Math.max(...pcells.map(cell => Number(cell.y))) : gc + 3;
      const fw0 = maxCXp - minCX + 1;
      const fd0 = maxCZp - minCZ + 1;
      pivX = Number(bldgMinC) + fw0 / 2;
      pivZ = Number(bldgMinR) + fd0 / 2;
      if (rotDeg === 90 || rotDeg === 270) {
        txAdj = (fd0 - fw0) / 2;
        tzAdj = (fw0 - fd0) / 2;
      }
    }

    const transformVertex = vertex => {
      let x = Number(vertex?.[0]) + offX;
      let z = Number(vertex?.[2]) + offZ;
      if (rotDeg) {
        const px = x - pivX, pz = z - pivZ;
        x = px * cosR - pz * sinR + pivX + txAdj;
        z = px * sinR + pz * cosR + pivZ + tzAdj;
      }
      return { x, y: Number(vertex?.[1]) + offY, z };
    };

    const structural = faces
      .filter(face => (face?.tag === 'wall' || face?.tag === 'roof') && Array.isArray(face.v) && face.v.length >= 3)
      .map(face => ({
        id: face.id ?? null,
        tag: face.tag,
        gableEnd: !!face.gableEnd,
        vertices: face.v.map(transformVertex),
      }));
    return {
      walls: structural.filter(face => face.tag === 'wall'),
      roofs: structural.filter(face => face.tag === 'roof'),
    };
  }

  function resolveEntrance(pieceInput, bldgMinC, bldgMinR, opts = {}) {
    const doorApi = window.BuildingDoor;
    const entranceShape = doorApi?.resolveDoorEntrance?.(pieceInput);
    const door = entranceShape && doorApi?.doorWorldFromBuilding?.(
      entranceShape,
      Number(bldgMinC) || 0,
      Number(bldgMinR) || 0,
      Number(opts.rotationDeg) || 0,
    );
    return door && finite(door.col) && finite(door.row)
      ? { x: Number(door.col) + 0.5, z: Number(door.row) + 0.5, col: Number(door.col), row: Number(door.row) }
      : null;
  }

  function installStructureWrapper() {
    const generator = window.HousePieceGen;
    const original = generator?.buildGroupFromPiece;
    if (typeof original !== 'function') return false;
    if (original.__hobunjiRoofClimbWrapped) { structureWrapperInstalled = true; return true; }

    function buildGroupWithRoofCollisionMetadata(THREE, piece, bldgMinC, bldgMinR, opts) {
      const group = original.call(this, THREE, piece, bldgMinC, bldgMinR, opts);
      if (!group) return group;
      const planes = transformedStructureFaces(piece, bldgMinC, bldgMinR, opts || {});
      if (!planes.walls.length || !planes.roofs.length) return group;
      group.userData = group.userData || {};
      group.userData[META_KEY] = {
        source: 'authored-structure-planes',
        walls: planes.walls,
        roofs: planes.roofs,
        entrance: resolveEntrance(piece, bldgMinC, bldgMinR, opts || {}),
        buildingId: opts?.buildingId || null,
      }; // Used by proximity climb targeting; visual brick/shingle child meshes are intentionally ignored.
      return group;
    }

    buildGroupWithRoofCollisionMetadata.__hobunjiRoofClimbWrapped = true;
    buildGroupWithRoofCollisionMetadata.__hobunjiRoofClimbOriginal = original;
    generator.buildGroupFromPiece = buildGroupWithRoofCollisionMetadata;
    structureWrapperInstalled = true;
    return true;
  }

  function vecSub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
  function cross(a, b) { return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }; }
  function length(v) { return Math.hypot(v.x, v.y, v.z); }
  function normalize(v) { const len = length(v); return len > EPS ? { x: v.x / len, y: v.y / len, z: v.z / len } : { x: 0, y: 0, z: 0 }; }

  function faceTriangles(face) {
    const v = face?.vertices || [];
    if (v.length === 3) return [[v[0], v[1], v[2]]];
    if (v.length >= 4) return [[v[0], v[1], v[2]], [v[0], v[2], v[3]]];
    return [];
  }

  function wallHorizontalNormal(face) {
    const tri = faceTriangles(face)[0];
    if (!tri) return null;
    const normal = normalize(cross(vecSub(tri[1], tri[0]), vecSub(tri[2], tri[0])));
    const horizontal = Math.hypot(normal.x, normal.z);
    return horizontal > EPS ? { x: normal.x / horizontal, z: normal.z / horizontal } : null;
  }

  function roofSurfaceYAt(meta, x, z) {
    let best = null;
    for (const roof of meta?.roofs || []) {
      for (const [a, b, c] of faceTriangles(roof)) {
        const denom = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
        if (Math.abs(denom) < EPS) continue;
        const wa = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / denom;
        const wb = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / denom;
        const wc = 1 - wa - wb;
        if (wa < -1e-4 || wb < -1e-4 || wc < -1e-4) continue;
        const y = wa * a.y + wb * b.y + wc * c.y;
        if (!Number.isFinite(y)) continue;
        if (best == null || y > best) best = y;
      }
    }
    return best;
  }

  function activeStructureMetas() {
    const scene = window.GridTileAccessors?.getActiveScene?.();
    const found = [];
    scene?.traverse?.(object => {
      const meta = object?.userData?.[META_KEY];
      if (meta?.walls?.length && meta?.roofs?.length) found.push({ object, meta });
    });
    debugState.lastStructureCount = found.length;
    return found;
  }

  function interactionRay() {
    return climbDeps?.getPlayerInteractionRay?.() || climbDeps?.getPlayerAimRay?.() || null;
  }

  function entranceTooClose(meta, point) {
    const entrance = meta?.entrance;
    if (!entrance) return false;
    return Math.hypot(point.x - entrance.x, point.z - entrance.z) <= ENTRANCE_CLEARANCE_WORLD;
  }

  function closestPointOnSegment2D(px, pz, a, b) {
    const ax = Number(a?.x) || 0;
    const ay = Number(a?.y) || 0;
    const az = Number(a?.z) || 0;
    const bx = Number(b?.x) || 0;
    const by = Number(b?.y) || 0;
    const bz = Number(b?.z) || 0;
    const dx = bx - ax;
    const dz = bz - az;
    const lenSq = dx * dx + dz * dz;
    const t = lenSq > EPS ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lenSq)) : 0;
    const x = ax + dx * t;
    const z = az + dz * t;
    return { x, y: ay + (by - ay) * t, z, distance: Math.hypot(px - x, pz - z) };
  }

  function closestPointOnWall2D(px, pz, wall) {
    const vertices = Array.isArray(wall?.vertices) ? wall.vertices : [];
    if (vertices.length < 2) return null;
    let best = null;
    for (let index = 0; index < vertices.length; index++) {
      const candidate = closestPointOnSegment2D(px, pz, vertices[index], vertices[(index + 1) % vertices.length]);
      if (!best || candidate.distance < best.distance) best = candidate;
    }
    return best;
  }

  function nearestStructureWallHit() {
    const player = climbDeps?.player;
    const tile = Number(climbDeps?.TILE) || 1;
    if (!player || !finite(player.x) || !finite(player.y)) {
      debugState.lastBlockReason = 'player position unavailable';
      return null;
    }
    const px = Number(player.x) / tile;
    const pz = Number(player.y) / tile;
    let best = null;

    for (const entry of activeStructureMetas()) {
      for (const wall of entry.meta.walls) {
        const point = closestPointOnWall2D(px, pz, wall);
        if (!point || point.distance > MAX_PLAYER_WALL_DISTANCE) continue;
        if (best && point.distance >= best.playerDistance) continue;
        let dx = point.x - px;
        let dz = point.z - pz;
        let dirLen = Math.hypot(dx, dz);
        if (dirLen < EPS) {
          const ray = interactionRay();
          dx = Number(ray?.direction?.x) || 0;
          dz = Number(ray?.direction?.z) || 0;
          dirLen = Math.hypot(dx, dz);
        }
        if (dirLen < EPS) {
          const normal = wallHorizontalNormal(wall);
          dx = Number(normal?.x) || 0;
          dz = Number(normal?.z) || 0;
          dirLen = Math.hypot(dx, dz);
        }
        const inwardDir = dirLen > EPS ? { x: dx / dirLen, z: dz / dirLen } : null;
        if (!inwardDir) continue;
        best = {
          ...entry,
          wall,
          point: { x: point.x, y: point.y, z: point.z },
          playerDistance: point.distance,
          inwardDir,
        };
      }
    }

    if (!best) {
      debugState.lastBlockReason = `no structural wall within ${MAX_PLAYER_WALL_DISTANCE.toFixed(2)} tiles of player`;
      debugState.lastWallHit = null;
      return null;
    }
    debugState.lastWallHit = {
      x: best.point.x,
      y: best.point.y,
      z: best.point.z,
      cameraDistance: null,
      playerDistance: best.playerDistance,
      selectionModel: 'nearest-player-wall',
    };
    if (entranceTooClose(best.meta, best.point)) { debugState.lastBlockReason = 'entrance adjacent'; return null; }
    return best;
  }

  function findRoofLanding(hit) {
    const directions = [];
    const addDirection = dir => {
      const dx = Number(dir?.x) || 0;
      const dz = Number(dir?.z) || 0;
      const len = Math.hypot(dx, dz);
      if (len < EPS) return;
      const normalized = { x: dx / len, z: dz / len };
      if (directions.some(existing => Math.abs(existing.x - normalized.x) < 1e-4 && Math.abs(existing.z - normalized.z) < 1e-4)) return;
      directions.push(normalized);
    };

    // The player-to-wall direction is the normal case: continue through the
    // nearest wall into the building. The opposite/camera directions are safe
    // fallbacks for corner cases where the closest wall point lies exactly on
    // a concave/cross-gable boundary.
    addDirection(hit?.inwardDir);
    addDirection(hit?.inwardDir ? { x: -hit.inwardDir.x, z: -hit.inwardDir.z } : null);
    const ray = interactionRay();
    addDirection({ x: ray?.direction?.x, z: ray?.direction?.z });

    for (const dir of directions) {
      for (const offset of ROOF_SAMPLE_OFFSETS) {
        const x = hit.point.x + dir.x * offset;
        const z = hit.point.z + dir.z * offset;
        const y = roofSurfaceYAt(hit.meta, x, z);
        if (Number.isFinite(y)) return { x, y, z, dir: { x: dir.x, y: dir.z } };
      }
    }
    return null;
  }

  function getRoofClimbTarget() {
    const player = climbDeps?.player;
    if (!player || player.climbing || player.prone || player.onBranch) return null;
    const hit = nearestStructureWallHit();
    if (!hit) return null;
    const landing = findRoofLanding(hit);
    if (!landing) { debugState.lastBlockReason = 'nearby wall has no reachable authored roof plane'; return null; }
    const startSurfaceY = Number(climbDeps?.worldSurfaceY?.(player.x, player.y));
    if (Number.isFinite(startSurfaceY) && landing.y <= startSurfaceY + 0.12) {
      debugState.lastBlockReason = 'roof is not above player';
      return null;
    }
    const target = {
      type: 'roof',
      meta: hit.meta,
      group: hit.object,
      endWorldX: landing.x,
      endWorldZ: landing.z,
      endSurfaceY: landing.y,
      startSurfaceY: Number.isFinite(startSurfaceY) ? startSurfaceY : 0,
      dir: landing.dir,
      wallFaceId: hit.wall.id,
      wallPoint: { ...hit.point },
      playerWallDistance: hit.playerDistance,
    };
    debugState.lastBlockReason = null;
    debugState.lastCandidate = {
      wallFaceId: hit.wall.id,
      playerWallDistance: hit.playerDistance,
      endWorldX: landing.x,
      endWorldZ: landing.z,
      endSurfaceY: landing.y,
    };
    return target;
  }

  function isRoofState(branch) { return !!branch?.[ROOF_STATE_KEY]; }

  function startRoofClimb(climb) {
    const player = climbDeps?.player;
    if (!player || !climb?.meta) return false;
    const mountRideState = climbDeps?.getMountRideState?.() || 'none';
    if (mountRideState !== 'none') {
      climbDeps?.showToast?.('Dismount before climbing.', false);
      debugState.lastBlockReason = 'mounted';
      return false;
    }
    const tile = Number(climbDeps?.TILE) || 1;
    player.climbing = true;
    player.climbElapsed = 0;
    player.climbHopCount = 4;
    player.climbStartX = player.x;
    player.climbStartY = player.y;
    player.climbEndX = climb.endWorldX * tile;
    player.climbEndY = climb.endWorldZ * tile;
    player.climbSurfaceStartY = Number.isFinite(climb.startSurfaceY) ? climb.startSurfaceY : 0;
    player.climbSurfaceEndY = climb.endSurfaceY;
    player.climbSurfaceY = player.climbSurfaceStartY;
    player.climbHopBounce = 0;
    player.vx = 0;
    player.vy = 0;
    player.angle = Math.atan2(climb.dir.y, climb.dir.x);
    climbDeps?.setFacingAngle?.(player.angle);
    climbDeps?.setTargetAimAngle?.(player.angle);
    climbDeps?.setLastMoveAngle?.(player.angle);
    player._climbTargetBranch = null;
    player._climbJumpDownAxis = null;
    player._climbLastHopIndex = -1;
    player._hobunjiClimbTargetRoof = {
      [ROOF_STATE_KEY]: true,
      meta: climb.meta,
      group: climb.group,
    }; // Used by the updateClimb wrapper to hand the finished climb into roof movement mode.
    debugState.lastClimbAt = Date.now();
    debugState.lastBlockReason = null;
    return true;
  }

  function finishRoofIfNeeded(player) {
    const roof = player?._hobunjiClimbTargetRoof;
    if (!roof || player.climbing) return;
    player._hobunjiClimbTargetRoof = null;
    player.onBranch = roof; // Reuses the renderer's existing elevated-surface branchSurfaceY override without treating visual shingles as collision.
    player.branchT = 0;
    player.branchSurfaceY = player.climbSurfaceEndY;
  }

  function updateRoofMovement(dt) {
    const player = climbDeps?.player;
    const roof = player?.onBranch;
    if (!isRoofState(roof)) return false;
    const tile = Number(climbDeps?.TILE) || 1;
    const raw = climbDeps?.getMovementInput?.() || { x: 0, y: 0 };
    const rawLen = Math.hypot(Number(raw.x) || 0, Number(raw.y) || 0);
    const nx = rawLen > EPS ? (Number(raw.x) || 0) / rawLen : 0;
    const ny = rawLen > EPS ? (Number(raw.y) || 0) / rawLen : 0;
    player.inputX = nx;
    player.inputY = ny;
    player.inputStrength = Math.min(1, rawLen);
    if (rawLen > EPS) {
      const step = ROOF_WALK_SPEED_PX_S * Math.max(0, Number(dt) || 0);
      let nextX = player.x + nx * step;
      let nextY = player.y + ny * step;
      let surface = roofSurfaceYAt(roof.meta, nextX / tile, nextY / tile);
      if (!Number.isFinite(surface)) {
        const xSurface = roofSurfaceYAt(roof.meta, nextX / tile, player.y / tile);
        if (Number.isFinite(xSurface)) { player.x = nextX; surface = xSurface; }
        const ySurface = roofSurfaceYAt(roof.meta, player.x / tile, nextY / tile);
        if (Number.isFinite(ySurface)) { player.y = nextY; surface = ySurface; }
      } else {
        player.x = nextX;
        player.y = nextY;
      }
      if (Number.isFinite(surface)) player.branchSurfaceY = surface;
      player.angle = Math.atan2(ny, nx);
      climbDeps?.setFacingAngle?.(player.angle);
      climbDeps?.setTargetAimAngle?.(player.angle);
      climbDeps?.setLastMoveAngle?.(player.angle);
    }
    player.vx = 0;
    player.vy = 0;
    return true;
  }

  function resolveRoofKnockback(entity, fromX, fromY, speedPxS) {
    const roof = entity?.onBranch;
    if (!isRoofState(roof)) return null;
    const tile = Number(climbDeps?.TILE) || 1;
    const angle = Math.atan2(entity.y - fromY, entity.x - fromX);
    const travel = Math.max(0, Number(speedPxS) || 0) * ROOF_KNOCKBACK_DUR_S;
    const nextX = entity.x + Math.cos(angle) * travel;
    const nextY = entity.y + Math.sin(angle) * travel;
    const surface = roofSurfaceYAt(roof.meta, nextX / tile, nextY / tile);
    if (Number.isFinite(surface)) {
      entity.x = nextX;
      entity.y = nextY;
      entity.branchSurfaceY = surface;
      return { fell: false };
    }
    entity.onBranch = null;
    entity.branchT = 0;
    entity.x = nextX;
    entity.y = nextY;
    return { fell: true, x: nextX, y: nextY, source: 'roof' };
  }

  function installClimbHooks(system) {
    if (!system || climbHooksInstalled) return false;
    climbHooksInstalled = true;
    const originalInit = system.init;
    const originalGetClimbTarget = system.getClimbTarget;
    const originalStartClimb = system.startClimb;
    const originalUpdateClimb = system.updateClimb;
    const originalUpdateBranchMovement = system.updateBranchMovement;
    const originalResolveBranchKnockback = system.resolveBranchKnockback;

    system.init = function roofAwareClimbInit(injectedDeps) {
      climbDeps = injectedDeps;
      return originalInit?.call(this, injectedDeps);
    };
    system.getClimbTarget = function roofAwareGetClimbTarget() {
      if (isRoofState(climbDeps?.player?.onBranch)) return null;
      const existing = originalGetClimbTarget?.call(this);
      return existing || getRoofClimbTarget();
    };
    system.startClimb = function roofAwareStartClimb(climb) {
      if (climb?.type === 'roof') return startRoofClimb(climb);
      return originalStartClimb?.call(this, climb);
    };
    system.updateClimb = function roofAwareUpdateClimb(dt) {
      const result = originalUpdateClimb?.call(this, dt);
      finishRoofIfNeeded(climbDeps?.player);
      return result;
    };
    system.updateBranchMovement = function roofAwareBranchMovement(dt) {
      if (updateRoofMovement(dt)) return;
      return originalUpdateBranchMovement?.call(this, dt);
    };
    system.resolveBranchKnockback = function roofAwareBranchKnockback(entity, fromX, fromY, speedPxS) {
      if (isRoofState(entity?.onBranch)) return resolveRoofKnockback(entity, fromX, fromY, speedPxS);
      return originalResolveBranchKnockback?.call(this, entity, fromX, fromY, speedPxS);
    };
    return true;
  }

  // This file loads before climb-system.js. Intercept that script's one global
  // assignment, then install after its own appended branch-safety wrapper has
  // finished mutating the object but before game.js calls ClimbSystem.init().
  function armClimbAssignmentHook() {
    if (window.ClimbSystem) return installClimbHooks(window.ClimbSystem);
    const existing = Object.getOwnPropertyDescriptor(window, 'ClimbSystem');
    if (existing && !existing.configurable) return false;
    let value = existing?.value;
    Object.defineProperty(window, 'ClimbSystem', {
      configurable: true,
      enumerable: true,
      get() { return value; },
      set(next) {
        value = next;
        queueMicrotask(() => {
          if (window.ClimbSystem !== next) return;
          Object.defineProperty(window, 'ClimbSystem', { configurable: true, enumerable: true, writable: true, value: next });
          installClimbHooks(next);
        });
      },
    });
    return true;
  }

  installStructureWrapper();
  armClimbAssignmentHook();

  window.HobunjiRoofClimb = Object.freeze({
    installStructureWrapper,
    getRoofClimbTarget,
    roofSurfaceYAt,
    transformedStructureFaces,
    getDebug() {
      return {
        structureWrapperInstalled,
        climbHooksInstalled,
        onRoof: isRoofState(climbDeps?.player?.onBranch),
        ...debugState,
      };
    },
  });
})();
