(() => {
  'use strict';

  // NPC walkability/beeline checks and the area-graph search that resolves
  // how an NPC gets from one map to another — pulled out of game.js's ~25k-
  // line closure following the same window.<Namespace> + init(deps) pattern
  // as js/npc-scheduling.js (which owns "where should this NPC be" instead
  // of "can it actually walk there").
  //
  // Movement safety also lives here now: route/path planning, ordinary live
  // walkers, and authored-cutscene walkers all share the same footprint and
  // swept-segment collision checks. That closes the old split where planners
  // knew a tile was blocked but walker.moveToward() could still interpolate
  // straight through a wall/building between two otherwise-valid positions.
  let deps = null;
  const decoratedWalkers = new WeakSet(); // Prevents wrapping the same gameplay/cutscene walker more than once.
  const lastBlockLogAt = new WeakMap(); // Rate-limits mobile-visible collision diagnostics per walker.
  const debugStats = { decoratedWalkers: 0, blockedMoves: 0, pathReplans: 0, pathFailuresSkipped: 0, cutsceneMovesUpgraded: 0, lastBlock: null }; // Read by debugSnapshot() for mobile diagnostics.
  const PATH_FAILURE_RETRY_MS = 750; // How long a walker waits before repeating a grid search that just failed from the same tile.
  const FURNITURE_SAMPLE_OFFSETS = Object.freeze([[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]); // Reused by every per-frame footprint probe instead of allocating nine offsets per check.

  function init(injectedDeps) { deps = injectedDeps; }

  function npcCollisionRadiusTiles() {
    const configured = Number(deps?.npcMovementConfig?.().collisionRadiusTiles);
    return Number.isFinite(configured) && configured > 0 ? configured : 0.22;
  }

  // Tile-level structural blockers. Furniture is intentionally separate:
  // sitting NPCs are allowed to enter their chair's occupied target tile,
  // while walls/building shells remain hard collision in every pose.
  function isNpcTileStructurallyWalkable(area, c, r) {
    if (!deps) return true;
    if (deps.isBuildingArea(area)) {
      const bg = deps.npcGridForArea(area);
      return !!bg?.[r]?.[c] && (!deps.isSolid(bg[r][c].type) || bg[r][c].npcFurnitureCollider === true);
    }
    // Every area (especially a wilderness zone) must validate against its own terrain grid, not the farm's.
    const g = typeof deps.npcGridForArea === 'function' ? deps.npcGridForArea(area) : (area === 'interior' ? deps.getInteriorGrid() : area === 'town' ? deps.getTownGrid() : deps.getGrid());
    const tile = g?.[r]?.[c];
    if (!tile || deps.isSolid(tile.type) || tile.crop || tile.type === deps.TileType.TRENCH || tile.type === deps.TileType.RIVER || tile.type === deps.TileType.STREAM) return false;
    if (area === 'farm' && (deps.worldObjects.has(c + ',' + r) || deps.isHouseFootprint(c, r))) return false;
    if (area === 'town' && deps.isTownBuildingCollisionTile(c, r)) return false;
    if (deps.isZoneArea(area) && (tile.mapBoundary || tile.skipFloor || deps.isTownBuildingCollisionTile(c, r, area))) return false; // Wilderness boundary rock faces and tiles with no floor must not be selected for follower spawning or cover.
    return true;
  }

  function isNpcPositionStructurallyWalkable(area, x, z, radius = npcCollisionRadiusTiles()) {
    if (!deps || !Number.isFinite(x) || !Number.isFinite(z)) return false;
    const minC = Math.floor(x - radius), maxC = Math.floor(x + radius - 1e-6);
    const minR = Math.floor(z - radius), maxR = Math.floor(z + radius - 1e-6);
    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        if (!isNpcTileStructurallyWalkable(area, c, r)) return false;
      }
    }
    // Exact sub-tile providers include authored interior/ruin walls, closed
    // doors, pillars and similar solids that can sit between tile centers.
    if (window.AreaFootprintBlockers?.blocksBox?.(area, x, z, radius, null)) return false;
    return true;
  }

  function isNpcPositionWalkable(area, x, z, radius = npcCollisionRadiusTiles(), { ignoreFurniture = false, ignoreFurnitureTile = null } = {}) {
    if (!isNpcPositionStructurallyWalkable(area, x, z, radius)) return false;
    if (ignoreFurniture) return true;
    const d = radius * 0.82; // Sample spacing for walls of furniture surrounding the body.
    const buildingGrid = deps.isBuildingArea(area) ? deps.npcGridForArea(area) : null; // Shared by all nine samples rather than looking up the scene/grid each time.
    for (const [dx, dz] of FURNITURE_SAMPLE_OFFSETS) {
      const sx = x + dx * d, sz = z + dz * d;
      if (ignoreFurnitureTile && Math.floor(sx) === ignoreFurnitureTile.c && Math.floor(sz) === ignoreFurnitureTile.r) continue;
      if (buildingGrid?.[Math.floor(sz)]?.[Math.floor(sx)]?.npcFurnitureCollider) return false;
      if (deps.furnitureBlocksMovementAt(area, sx, sz)) return false;
    }
    return true;
  }

  // `area`'s own tile grid may live behind reassignable variables (grid/
  // townGrid get replaced wholesale on new-game/reset) — deps exposes those
  // as getters. A tile is considered walkable only when an NPC-sized body,
  // not merely its center point, can stand at that tile center.
  function isNpcTileWalkable(area, c, r) {
    return isNpcPositionWalkable(area, c + 0.5, r + 0.5);
  }

  // Arrival guard: a spawn that lands off the destination map's floor (outside the
  // walkable interior footprint) is moved to the closest tile an NPC can stand on.
  // Only a tile that is structurally blocked is moved, so seats and beds (furniture)
  // keep their authored arrival tile. Maps that are not loaded yet are left alone.
  function nearestWalkableTile(area, c, r, maxRadius = 6) {
    // Wilderness entries need the same safe-arrival search as building doors; unloaded areas cannot be probed yet.
    if (!deps || (!deps.isBuildingArea(area) && !deps.isZoneArea(area)) || !deps.npcGridForArea(area)) return { c, r };
    if (isNpcPositionStructurallyWalkable(area, c + 0.5, r + 0.5)) return { c, r };
    let fallback = null; // Structurally clear but furniture-blocked tile, used only when no free tile is in range.
    for (let radius = 1; radius <= maxRadius; radius++) {
      let best = null, bestDist = Infinity;
      for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
          if (Math.max(Math.abs(dc), Math.abs(dr)) !== radius) continue;
          const tc = c + dc, tr = r + dr;
          if (!isNpcPositionStructurallyWalkable(area, tc + 0.5, tr + 0.5)) continue;
          if (!isNpcTileWalkable(area, tc, tr)) { fallback ||= { c: tc, r: tr }; continue; }
          const dist = Math.hypot(dc, dr);
          if (dist < bestDist) { best = { c: tc, r: tr }; bestDist = dist; }
        }
      }
      if (best) return best;
    }
    return fallback || { c, r };
  }

  function canNpcTraverse(area, fromX, fromZ, toX, toZ, {
    ignoreFurnitureAtEnd = false,
    ignoreFurnitureTile = null,
    structuralOnly = false,
    stepTiles = null,
  } = {}) {
    if (!deps || ![fromX, fromZ, toX, toZ].every(Number.isFinite)) return false;
    const dist = Math.hypot(toX - fromX, toZ - fromZ);
    const configuredStep = Number(deps.npcMovementConfig().beelineSampleStepTiles);
    const step = Number.isFinite(stepTiles) && stepTiles > 0
      ? stepTiles
      : Math.min(Number.isFinite(configuredStep) && configuredStep > 0 ? configuredStep : 0.25, Math.max(0.08, npcCollisionRadiusTiles() * 0.75));
    const samples = Math.max(1, Math.ceil(dist / step));
    const ignoredEndTile = ignoreFurnitureTile || (ignoreFurnitureAtEnd ? { c: Math.floor(toX), r: Math.floor(toZ) } : null); // Explicit seat tiles stay stable across small per-frame steps; path edges may derive theirs from the edge endpoint.
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const x = fromX + (toX - fromX) * t, z = fromZ + (toZ - fromZ) * t;
      const clear = structuralOnly
        ? isNpcPositionStructurallyWalkable(area, x, z)
        : isNpcPositionWalkable(area, x, z, npcCollisionRadiusTiles(), { ignoreFurniture: i === 0, ignoreFurnitureTile: ignoredEndTile });
      if (!clear) return false;
    }
    return true;
  }

  // Route-graph code receives this exact function object, so expose its
  // segment validator without adding another game.js dependency.
  isNpcTileWalkable.canTraverse = (area, fromX, fromZ, toX, toZ) => canNpcTraverse(area, fromX, fromZ, toX, toZ);

  function canNpcBeeline(area, fromX, fromZ, targetC, targetR, allowOccupiedTarget = false) {
    return canNpcTraverse(area, fromX, fromZ, targetC + 0.5, targetR + 0.5, { ignoreFurnitureAtEnd: allowOccupiedTarget });
  }

  // A saved/seated NPC may legitimately begin inside a blocker. Permit only
  // the contiguous prefix needed to leave that existing overlap; once the
  // body reaches clear space it may not enter another wall or furniture item.
  function canNpcEscapeExistingOverlap(area, fromX, fromZ, toX, toZ, {
    startStructuralClear = isNpcPositionStructurallyWalkable(area, fromX, fromZ),
    ignoreFurnitureAtEnd = false,
    ignoreFurnitureTile = null,
    stepTiles = null,
  } = {}) {
    if (!deps || ![fromX, fromZ, toX, toZ].every(Number.isFinite)) return false;
    const dist = Math.hypot(toX - fromX, toZ - fromZ);
    const configuredStep = Number(deps.npcMovementConfig().beelineSampleStepTiles);
    const step = Number.isFinite(stepTiles) && stepTiles > 0
      ? stepTiles
      : Math.min(Number.isFinite(configuredStep) && configuredStep > 0 ? configuredStep : 0.25, Math.max(0.08, npcCollisionRadiusTiles() * 0.75));
    const samples = Math.max(1, Math.ceil(dist / step));
    const ignoredEndTile = ignoreFurnitureTile || (ignoreFurnitureAtEnd ? { c: Math.floor(toX), r: Math.floor(toZ) } : null); // Only the explicitly allowed final-seat tile may be ignored during an escape segment.
    let reachedClearSpace = false;
    for (let i = 1; i <= samples; i++) {
      const t = i / samples;
      const x = fromX + (toX - fromX) * t, z = fromZ + (toZ - fromZ) * t;
      const structuralClear = isNpcPositionStructurallyWalkable(area, x, z);
      if (!startStructuralClear && !reachedClearSpace && !structuralClear) continue;
      if (!structuralClear) return false;
      const fullyClear = isNpcPositionWalkable(area, x, z, npcCollisionRadiusTiles(), { ignoreFurnitureTile: ignoredEndTile });
      if (!reachedClearSpace) {
        if (!fullyClear) {
          if (startStructuralClear) continue; // Still leaving the same furniture footprint.
          return false; // Leaving old structural geometry directly into furniture is not a valid escape.
        }
        reachedClearSpace = true;
        continue;
      }
      if (!fullyClear) return false;
    }
    return true;
  }

  const PATH_DIRS = Object.freeze([
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
  ]); // Used by findNpcPath() for collision-aware local A* including edge checks.

  function findNpcPath(area, fromX, fromZ, targetC, targetR, {
    padding = 6,
    allowOccupiedTarget = false,
    maxNodes = 1200,
  } = {}) {
    targetC = Math.floor(targetC); // Grid search must use integer cells even for post-translated furniture stations.
    targetR = Math.floor(targetR);
    const startC = Math.floor(fromX), startR = Math.floor(fromZ);
    if (startC === targetC && startR === targetR) return [];
    const minC = Math.min(startC, targetC) - padding, maxC = Math.max(startC, targetC) + padding;
    const minR = Math.min(startR, targetR) - padding, maxR = Math.max(startR, targetR) + padding;
    const key = (c, r) => c + ',' + r;
    const heuristic = (c, r) => { const dx = Math.abs(targetC - c), dr = Math.abs(targetR - r); return dx + dr + (Math.SQRT2 - 2) * Math.min(dx, dr); }; // Exact octile lower bound for 8-direction movement.
    const targetKey = key(targetC, targetR);
    const startKey = key(startC, startR);
    const centerClearCache = new Map(); // Reuses footprint/furniture checks while A* revisits neighboring tiles.
    const centerClear = (c, r) => {
      const k = key(c, r);
      if (centerClearCache.has(k)) return centerClearCache.get(k);
      const clear = allowOccupiedTarget && c === targetC && r === targetR
        ? isNpcPositionStructurallyWalkable(area, c + 0.5, r + 0.5)
        : isNpcPositionWalkable(area, c + 0.5, r + 0.5);
      centerClearCache.set(k, clear);
      return clear;
    };
    if (!centerClear(targetC, targetR)) return null;

    const heap = window.TilePathfinding?.MinHeap ? new window.TilePathfinding.MinHeap() : null; // Reuses the generic pathfinder's binary heap in game; the small-array fallback keeps isolated NPC tooling compatible.
    const open = heap ? null : []; // Used only by standalone consumers that did not load tile-pathfinding.js.
    const addOpen = node => { if (heap) heap.push(node, node.f); else open.push(node); }; // Enqueues new A* candidates in either environment.
    const nextOpen = () => { // Pops the best f-score; avoids an O(open-set-size) scan for every game search.
      if (heap) return heap.pop();
      let best = 0;
      for (let i = 1; i < open.length; i++) if (open[i].f < open[best].f) best = i;
      return open.splice(best, 1)[0];
    };
    addOpen({ c: startC, r: startR, key: startKey, f: heuristic(startC, startR) });
    const gScore = new Map([[startKey, 0]]);
    const cameFrom = new Map();
    const closed = new Set();
    let expanded = 0;
    const startStructuralClear = isNpcPositionStructurallyWalkable(area, fromX, fromZ); // Checked once per search, not once per neighbor of the first node.
    const startFullyClear = startStructuralClear && isNpcPositionWalkable(area, fromX, fromZ); // Chooses the seated/legacy-overlap escape rule for the first edge.
    debugStats.pathSearches = (debugStats.pathSearches || 0) + 1;

    while ((heap ? heap.size : open.length) && expanded < maxNodes) {
      const cur = nextOpen();
      if (closed.has(cur.key)) continue;
      closed.add(cur.key);
      expanded++;
      debugStats.pathNodesExpanded = (debugStats.pathNodesExpanded || 0) + 1; // Cumulative node count exposed to the mobile diagnostics panel.
      if (cur.key === targetKey) {
        const path = [];
        let k = targetKey;
        while (k !== startKey) {
          const [col, row] = k.split(',').map(Number);
          path.push({ col, row });
          k = cameFrom.get(k);
          if (!k) return null;
        }
        return path.reverse();
      }

      for (const [dc, dr, cost] of PATH_DIRS) {
        const nc = cur.c + dc, nr = cur.r + dr;
        if (nc < minC || nc > maxC || nr < minR || nr > maxR) continue;
        const nk = key(nc, nr);
        if (closed.has(nk) || !centerClear(nc, nr)) continue;
        const targetStep = allowOccupiedTarget && nc === targetC && nr === targetR;
        const firstEdge = cur.key === startKey; // The first hop must originate at the NPC's real sub-tile position, not an assumed tile center.
        const edgeFromX = firstEdge ? fromX : cur.c + 0.5; // Used only for this edge's swept collision validation.
        const edgeFromZ = firstEdge ? fromZ : cur.r + 0.5; // Used only for this edge's swept collision validation.
        const edgeClear = firstEdge && !startFullyClear
          ? canNpcEscapeExistingOverlap(area, edgeFromX, edgeFromZ, nc + 0.5, nr + 0.5, { startStructuralClear, ignoreFurnitureAtEnd: targetStep })
          : canNpcTraverse(area, edgeFromX, edgeFromZ, nc + 0.5, nr + 0.5, { ignoreFurnitureAtEnd: targetStep });
        if (!edgeClear) continue;
        if (dc !== 0 && dr !== 0) {
          // Prevent a diagonal body from squeezing between two blocked
          // orthogonal neighbors even when the diagonal center itself is open.
          if (!centerClear(cur.c + dc, cur.r) || !centerClear(cur.c, cur.r + dr)) continue;
        }
        const tentative = (gScore.get(cur.key) ?? Infinity) + cost;
        if (tentative >= (gScore.get(nk) ?? Infinity)) continue;
        gScore.set(nk, tentative);
        cameFrom.set(nk, cur.key);
        addOpen({ c: nc, r: nr, key: nk, f: tentative + heuristic(nc, nr) });
      }
    }
    return null;
  }

  // Local box first (cheap, the common case); if that finds nothing, widen the
  // box and node budget so a detour around a long wall/fence is still found;
  // A blocked destination tile stays unreachable on purpose (see the occupied
  // chair case in test-npc-collision-aware-pathing.js).
  function findNpcPathWithFallbacks(area, fromX, fromZ, target, allowOccupiedTarget) {
    const seat = allowOccupiedTarget ? deps.npcSeatTransformForTarget?.(target) : null; // Search toward the rendered seat cell rather than the furniture's origin.
    const c = seat ? Math.floor(seat.x) : target.c; // Final cell used by both bounded search attempts.
    const r = seat ? Math.floor(seat.z) : target.r;
    const attempt = opts => findNpcPath(area, fromX, fromZ, c, r, { allowOccupiedTarget, ...opts });
    let path = attempt({ padding: 6 });
    if (path?.length) return path;
    path = attempt({ padding: 16, maxNodes: 4000 });
    if (path?.length) return path;
    return path;
  }

  // Seats and beds are furniture the NPC is meant to end up on, so their own
  // station tile is a legal destination even though it is a furniture collider.
  function targetOccupiesFurniture(target) { return target?.pose === 'sit' || target?.pose === 'lie'; }

  function _walkerAllowsFurnitureOverlap(walker, tx, tz) {
    const target = walker?.currentScheduleTarget;
    if (!targetOccupiesFurniture(target) || target.area && target.area !== walker.area) return false;
    const seat = deps.npcSeatTransformForTarget?.(target); // Uses the same transformed anchor as seated rendering, including bench seat index.
    const x = seat?.x ?? (target.c + 0.5); // Exact anchor and its grid waypoint are both legitimate final approaches.
    const z = seat?.z ?? (target.r + 0.5);
    return Number.isFinite(x) && Number.isFinite(z)
      && (Math.hypot(tx - x, tz - z) < 0.08
        || Math.hypot(tx - (Math.floor(x) + 0.5), tz - (Math.floor(z) + 0.5)) < 0.08);
  }

  function _recordBlockedMove(walker, tx, tz) {
    debugStats.blockedMoves++;
    debugStats.lastBlock = {
      npcId: walker?.rec?.id || walker?.rec?.name || 'unknown',
      area: walker?.area || '',
      x: Number(walker?.root?.position?.x?.toFixed?.(3) ?? walker?.root?.position?.x),
      z: Number(walker?.root?.position?.z?.toFixed?.(3) ?? walker?.root?.position?.z),
      targetX: Number(tx?.toFixed?.(3) ?? tx),
      targetZ: Number(tz?.toFixed?.(3) ?? tz),
    };
    const now = Date.now();
    if (now - (lastBlockLogAt.get(walker) || 0) < 1500) return;
    lastBlockLogAt.set(walker, now);
    window.__farmLog?.(`[npc collision] ${debugStats.lastBlock.npcId} blocked in ${debugStats.lastBlock.area} while moving toward ${debugStats.lastBlock.targetX},${debugStats.lastBlock.targetZ}`, 'npc');
  }

  function _resolveBlockedStep(walker, startX, startZ, desiredX, desiredZ, { ignoreFurnitureTile = null } = {}) {
    const dx = desiredX - startX, dz = desiredZ - startZ;
    const travel = Math.hypot(dx, dz);
    if (travel < 1e-6) return { x: startX, z: startZ };
    const fx = dx / travel, fz = dz / travel;
    const tx = -fz, tz = fx;
    const positionClear = (x, z) => isNpcPositionWalkable(walker.area, x, z, npcCollisionRadiusTiles(), { ignoreFurnitureTile });
    const segmentClear = (x, z) => canNpcTraverse(walker.area, startX, startZ, x, z, { ignoreFurnitureTile });
    const preferred = walker._npcCollisionAvoidSide === -1 ? -1 : 1;
    for (const side of [preferred, -preferred]) {
      for (const scale of [1.35, 1, 0.65]) {
        const sideTravel = Math.max(travel * scale, Math.min(0.08, travel));
        const x = startX + tx * side * sideTravel + fx * travel * 0.08;
        const z = startZ + tz * side * sideTravel + fz * travel * 0.08;
        if (!positionClear(x, z) || !segmentClear(x, z)) continue;
        walker._npcCollisionAvoidSide = side; // Reused on subsequent blocked frames so wall-following does not oscillate left/right.
        return { x, z };
      }
    }
    return { x: startX, z: startZ };
  }

  function _npcStepIsClear(walker, startX, startZ, desiredX, desiredZ, { ignoreFurnitureTile = null } = {}) {
    const travel = Math.hypot(desiredX - startX, desiredZ - startZ);
    const shortStep = Math.max(0.04, npcCollisionRadiusTiles() * 0.45);
    if (travel <= shortStep) {
      return isNpcPositionWalkable(walker.area, desiredX, desiredZ, npcCollisionRadiusTiles(), { ignoreFurnitureTile });
    }
    return canNpcTraverse(walker.area, startX, startZ, desiredX, desiredZ, { ignoreFurnitureTile });
  }

  // A walker that keeps pressing into a blocker (furniture/building placed after
  // its route graph or grid path was computed) used to slide against it forever,
  // because route/grid paths were only ever recomputed when the *target* changed.
  // Track blocked-progress time; once it passes the threshold, drop the stale
  // route/grid path and search the live collision grid for a fresh detour.
  const STUCK_REPLAN_AFTER_S = 0.9;
  const STUCK_REPLAN_COOLDOWN_MS = 1500;

  function _noteWalkerProgress(walker, dt, blocked) {
    const now = Date.now();
    const s = walker._npcStuck || (walker._npcStuck = { t: 0, lastAt: 0, replanAt: 0, replans: 0 });
    const step = Math.max(0, Math.min(dt || 0, 0.25));
    if (now - s.lastAt > Math.max(600, (dt || 0) * 3000)) s.t = 0; // A gap in movement calls means it wasn't pressing a wall.
    s.lastAt = now;
    if (!blocked) { s.t = Math.max(0, s.t - step * 0.5); return; } // Decay rather than reset: a walker jittering blocked/clear against a corner is still stuck.
    s.t += step;
    if (s.t < STUCK_REPLAN_AFTER_S || now - s.replanAt < STUCK_REPLAN_COOLDOWN_MS) return;
    s.t = 0;
    s.replanAt = now;
    _forceReplan(walker);
  }

  function _forceReplan(walker) {
    const wandering = walker.state === 'station-wander' && walker._wanderTarget; // Recovery must preserve the active wander destination, not return to its station.
    const target = walker._exitSpot ? { ...walker._exitSpot, routeId: 'exit:' + walker._exitToArea } : wandering || walker.currentScheduleTarget; // Exit coordinates belong to the current map.
    if (!target || !Number.isFinite(target.c) || !Number.isFinite(target.r) || typeof walker._tryStartGridPath !== 'function') return false;
    walker._npcPathFailKey = null; // The cached failure was for the world before this blocker mattered.
    walker.routePath = null; walker._routePathTargetKey = null;
    walker.routeNode = null; walker.routeTarget = null; walker._gridPath = null;
    walker._wanderGridPath = null;
    debugStats.stuckReplans = (debugStats.stuckReplans || 0) + 1;
    if (walker._tryStartGridPath(target)) {
      if (wandering && !walker._exitSpot) {
        walker._wanderGridPath = walker._gridPath;
        walker._npcCollisionWanderPathKey = target.c + ',' + target.r;
        walker._gridPath = null;
        walker.state = 'station-wander';
      } else walker.state = 'grid-path';
      return true;
    }
    if (wandering) walker._wanderTarget = null;
    walker.state = 'idle'; // No detour exists right now; the scheduler re-evaluates (and retries) next tick.
    return false;
  }

  function decorateWalkerCollision(walker) {
    if (!walker || decoratedWalkers.has(walker) || typeof walker.moveToward !== 'function') return walker;
    decoratedWalkers.add(walker);
    debugStats.decoratedWalkers++;

    const originalMoveToward = walker.moveToward;
    walker.moveToward = function collisionAwareNpcMoveToward(tx, tz, dt) {
      if (!deps || !this.root?.position) return originalMoveToward.call(this, tx, tz, dt);
      const startX = this.root.position.x, startZ = this.root.position.z;
      const arrived = originalMoveToward.call(this, tx, tz, dt);
      const desiredX = this.root.position.x, desiredZ = this.root.position.z;
      if (arrived && Math.abs(desiredX - startX) + Math.abs(desiredZ - startZ) < 1e-8) return arrived; // Only genuinely completed stationary movement skips collision probes; failed/stuck moves still enter recovery.
      const startStructuralClear = isNpcPositionStructurallyWalkable(this.area, startX, startZ); // Checked only for actual movement to distinguish legacy overlap escapes.
      const startFullyClear = startStructuralClear && isNpcPositionWalkable(this.area, startX, startZ); // Preserves the existing chair/blocked-save escape guard.

      const seatOverlap = _walkerAllowsFurnitureOverlap(this, tx, tz);
      const seatFurnitureTile = seatOverlap ? { c: Math.floor(tx), r: Math.floor(tz) } : null; // Used by every per-frame check so only the actual chair tile is exempted.
      // Old saves can place a walker inside a wall, and seated walkers begin
      // inside their chair by design. Only the contiguous blocked prefix may
      // be escaped; a second wall/table encountered after clear space is hard.
      if (!startFullyClear) {
        if (canNpcEscapeExistingOverlap(this.area, startX, startZ, desiredX, desiredZ, { startStructuralClear, ignoreFurnitureTile: seatFurnitureTile })) return arrived;
        this.root.position.x = startX;
        this.root.position.z = startZ;
        _recordBlockedMove(this, tx, tz);
        _noteWalkerProgress(this, dt, true);
        return false;
      }

      if (_npcStepIsClear(this, startX, startZ, desiredX, desiredZ, { ignoreFurnitureTile: seatFurnitureTile })) { _noteWalkerProgress(this, dt, false); return arrived; }

      const resolved = _resolveBlockedStep(this, startX, startZ, desiredX, desiredZ, { ignoreFurnitureTile: seatFurnitureTile });
      this.root.position.x = resolved.x;
      this.root.position.z = resolved.z;
      const actualDx = resolved.x - startX, actualDz = resolved.z - startZ;
      if (Math.hypot(actualDx, actualDz) > 1e-6) this.applyFacingDeadzone?.(-Math.atan2(actualDz, actualDx) + Math.PI / 2, 0.15);
      _recordBlockedMove(this, tx, tz);
      _noteWalkerProgress(this, dt, true); // Every frame whose intended step was blocked counts, including sideways wall-slides that never get past the blocker.
      return arrived && Math.hypot(resolved.x - tx, resolved.z - tz) < 0.001;
    };

    if (typeof walker._tryStartGridPath === 'function') {
      walker._tryStartGridPath = function collisionAwareNpcGridPath(target) {
        if (!target || !this.root?.position) return false;
        // The scheduler retries this every frame while a target is unreachable
        // (occupied seat, walled-off tile), and a failed swept A* explores its
        // whole bounded box. Remember the failure briefly; a new target, area or
        // start tile searches again immediately.
        const failKey = this.area + '|' + target.c + ',' + target.r + '|' + Math.floor(this.root.position.x) + ',' + Math.floor(this.root.position.z) + '|' + targetOccupiesFurniture(target);
        const now = Date.now();
        if (this._npcPathFailKey === failKey && now < this._npcPathFailUntil) { debugStats.pathFailuresSkipped++; return false; }
        const path = findNpcPathWithFallbacks(this.area, this.root.position.x, this.root.position.z, target, targetOccupiesFurniture(target));
        if (!path?.length) {
          this._npcPathFailKey = failKey;
          this._npcPathFailUntil = now + PATH_FAILURE_RETRY_MS;
          return false;
        }
        this._npcPathFailKey = null;
        this._gridPath = path;
        this._gridPathTargetKey = target.routeId + '|' + target.c + ',' + target.r;
        debugStats.pathReplans++;
        return true;
      };
    }
    if (typeof walker._updateStationWander === 'function') {
      const originalStationWander = walker._updateStationWander;
      walker._updateStationWander = function collisionAwareNpcStationWander(target, dt) {
        const result = originalStationWander.call(this, target, dt);
        if (!this._wanderTarget) { this._npcCollisionWanderPathKey = null; return result; }
        const targetKey = this._wanderTarget.c + ',' + this._wanderTarget.r;
        if (this._wanderGridPath?.length && this._npcCollisionWanderPathKey !== targetKey) {
          const path = findNpcPath(this.area, this.root.position.x, this.root.position.z, this._wanderTarget.c, this._wanderTarget.r, { padding: 4 });
          if (path?.length) {
            this._wanderGridPath = path;
            debugStats.pathReplans++;
          } else {
            this._wanderGridPath = null;
            this._wanderTarget = null;
          }
          this._npcCollisionWanderPathKey = targetKey; // Prevents rebuilding the same wander path every frame.
        }
        return result;
      };
    }
    return walker;
  }

  // game.js hands its live walker array here once (where it is created);
  // every walker pushed afterwards gets the collision-aware movement wrappers.
  function trackWalkerArray(array) {
    if (!Array.isArray(array) || array.__npcCollisionAwarePush) return array;
    for (const walker of array) decorateWalkerCollision(walker);
    const originalPush = array.push;
    Object.defineProperty(array, '__npcCollisionAwarePush', { value: true, configurable: true });
    array.push = function npcCollisionAwareWalkerPush(...walkers) {
      for (const walker of walkers) decorateWalkerCollision(walker);
      return originalPush.apply(this, walkers);
    };
    return array;
  }

  // game.js's runCutscenePreview (live cutscenes and Director previews) runs
  // every payload through this before playing it.
  function upgradeCutscenePayload(payload) {
    if (!payload || !Array.isArray(payload.stages)) return payload;
    let changed = false;
    const stages = payload.stages.map(stage => {
      // Collision-aware navigation is the default for movement now. An
      // intentionally impossible/ghostlike shot can explicitly opt out with
      // collisionAware:false without making every ordinary scene remember a flag.
      if (stage?.type !== 'move' || stage.collisionAware === false || stage.navigate === true) return stage;
      changed = true;
      debugStats.cutsceneMovesUpgraded++;
      return { ...stage, navigate: true };
    });
    return changed ? { ...payload, stages } : payload;
  }

  // One-hop links reachable directly from `area`, in the shape
  // { toArea, exit:{c,r}, spawn:{c,r} } — the raw edges of the area graph
  // findNpcAreaLink() searches below.
  function areaLinksFrom(area, { warmBuildings = true } = {}) {
    const pool = deps.npcTransitionPool(area);
    const links = [];
    for (const t of pool) {
      if (t.target === 'building' && t.targetMapId) {
        if (warmBuildings && !deps.buildingScenes.has(t.targetMapId)) deps.loadBuildingScene(t.targetMapId);
        const bi = deps.buildingScenes.get(t.targetMapId);
        // Interior-to-interior doors (inn hallway <-> rooms) carry an authored
        // spawn, same as the player's enterBuilding. The exit heuristic is only
        // for maps with a town door; a room has none, so it used to send NPCs
        // to its fallback tile far outside the room's floor.
        const authoredSpawn = deps.isBuildingArea?.(area) && Number.isFinite(t.targetCol) && Number.isFinite(t.targetRow)
          && (t.targetCol !== 0 || t.targetRow !== 0) // Exits without spawnCol/spawnRow are loaded as 0,0.
          && !window.TownMine?.floorFromMapId?.(t.targetMapId); // Generated mine floors pick their own walkable entrance.
        const spawn = authoredSpawn ? { col: t.targetCol, row: t.targetRow }
          : bi ? deps.buildingSpawnFromExit(bi, bi.cols, bi.rows)
          : { col: t.targetCol ?? 0, row: t.targetRow ?? 0 };
        links.push({ toArea: t.targetMapId, exit: { c: t.col, r: t.row }, spawn: { c: spawn.col, r: spawn.row } });
      } else if (t.target === 'exit_building') {
        const townSpot = deps.npcTransitionPool('town').find(x => x.target === 'building' && x.targetMapId === area);
        const spawn = townSpot ? { c: townSpot.col, r: townSpot.row } : { c: t.targetCol ?? 0, r: t.targetRow ?? 0 };
        links.push({ toArea: 'town', exit: { c: t.col, r: t.row }, spawn });
      } else if (t.target && t.target !== 'zone' && Number.isFinite(t.targetCol) && Number.isFinite(t.targetRow)) {
        links.push({ toArea: t.target, exit: { c: t.col, r: t.row }, spawn: { c: t.targetCol, r: t.targetRow } });
      }
    }
    return links;
  }

  // Resolves the door an NPC should walk to in order to leave `fromArea`
  // toward `toArea`, plus the spot they should appear at once they arrive.
  function findNpcAreaLink(fromArea, toArea, { warmBuildings = true } = {}) {
    if (fromArea === toArea) return null;
    const visited = new Set([fromArea]);
    const queue = [{ area: fromArea, firstHop: null }]; // Breadth-first traversal queue for a one-hop map-transition route.
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const { area, firstHop } = queue[cursor]; // O(1) dequeue avoids repeated array shifting when many maps are reachable.
      for (const link of areaLinksFrom(area, { warmBuildings })) {
        const hop = firstHop || link;
        if (link.toArea === toArea) return hop;
        if (!visited.has(link.toArea)) {
          visited.add(link.toArea);
          queue.push({ area: link.toArea, firstHop: hop });
        }
      }
    }
    return null;
  }

  function debugSnapshot() {
    return {
      ...debugStats,
      collisionRadiusTiles: npcCollisionRadiusTiles(),
      latestChange: 'Wilderness followers use the actual zone grid, reject missing-floor/boundary cells, and revalidate spawn tiles when pending NPCs attach to loaded scenes.',
    };
  }

  window.NpcPathfinding = {
    init,
    isNpcTileWalkable,
    nearestWalkableTile,
    isNpcPositionWalkable,
    canNpcTraverse,
    canNpcBeeline,
    canNpcEscapeExistingOverlap,
    findNpcPath,
    decorateWalkerCollision,
    trackWalkerArray,
    upgradeCutscenePayload,
    areaLinksFrom,
    findNpcAreaLink,
    debugSnapshot,
  };
})();
