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
  const debugStats = { decoratedWalkers: 0, blockedMoves: 0, pathReplans: 0, cutsceneMovesUpgraded: 0, lastBlock: null }; // Read by debugSnapshot() for mobile diagnostics.

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
      return !!bg?.[r]?.[c] && !deps.isSolid(bg[r][c].type);
    }
    const g = area === 'interior' ? deps.getInteriorGrid() : area === 'town' ? deps.getTownGrid() : deps.getGrid();
    const tile = g?.[r]?.[c];
    if (!tile || deps.isSolid(tile.type) || tile.crop || tile.type === deps.TileType.TRENCH || tile.type === deps.TileType.RIVER || tile.type === deps.TileType.STREAM) return false;
    if (area === 'farm' && (deps.worldObjects.has(c + ',' + r) || deps.isHouseFootprint(c, r))) return false;
    if (area === 'town' && deps.isTownBuildingCollisionTile(c, r)) return false;
    if (deps.isZoneArea(area) && deps.isTownBuildingCollisionTile(c, r, area)) return false;
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
    const d = radius * 0.82;
    const samples = [[0, 0], [-d, 0], [d, 0], [0, -d], [0, d], [-d, -d], [d, -d], [-d, d], [d, d]];
    for (const [dx, dz] of samples) {
      const sx = x + dx, sz = z + dz;
      if (ignoreFurnitureTile && Math.floor(sx) === ignoreFurnitureTile.c && Math.floor(sz) === ignoreFurnitureTile.r) continue;
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

  function canNpcTraverse(area, fromX, fromZ, toX, toZ, {
    ignoreFurnitureAtEnd = false,
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
    const ignoredEndTile = ignoreFurnitureAtEnd ? { c: Math.floor(toX), r: Math.floor(toZ) } : null; // Allows chair overlap only inside the final destination tile.
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

  const PATH_DIRS = Object.freeze([
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
  ]); // Used by findNpcPath() for collision-aware local A* including edge checks.

  function findNpcPath(area, fromX, fromZ, targetC, targetR, {
    padding = 6,
    allowOccupiedTarget = false,
    maxNodes = 1200,
  } = {}) {
    const startC = Math.floor(fromX), startR = Math.floor(fromZ);
    if (startC === targetC && startR === targetR) return [];
    const minC = Math.min(startC, targetC) - padding, maxC = Math.max(startC, targetC) + padding;
    const minR = Math.min(startR, targetR) - padding, maxR = Math.max(startR, targetR) + padding;
    const key = (c, r) => c + ',' + r;
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

    const open = [{ c: startC, r: startR, key: startKey, f: Math.hypot(targetC - startC, targetR - startR) }]; // Small bounded searches make a compact array faster/simpler than another heap implementation here.
    const gScore = new Map([[startKey, 0]]);
    const cameFrom = new Map();
    const closed = new Set();
    let expanded = 0;

    while (open.length && expanded < maxNodes) {
      let bestIndex = 0;
      for (let i = 1; i < open.length; i++) if (open[i].f < open[bestIndex].f) bestIndex = i;
      const cur = open.splice(bestIndex, 1)[0];
      if (closed.has(cur.key)) continue;
      closed.add(cur.key);
      expanded++;
      if (cur.key === targetKey) {
        const path = [];
        let k = targetKey;
        while (k !== startKey) {
          const [col, row] = k.split(',').map(Number);
          path.unshift({ col, row });
          k = cameFrom.get(k);
          if (!k) return null;
        }
        return path;
      }

      for (const [dc, dr, cost] of PATH_DIRS) {
        const nc = cur.c + dc, nr = cur.r + dr;
        if (nc < minC || nc > maxC || nr < minR || nr > maxR) continue;
        const nk = key(nc, nr);
        if (closed.has(nk) || !centerClear(nc, nr)) continue;
        const targetStep = allowOccupiedTarget && nc === targetC && nr === targetR;
        const edgeClear = canNpcTraverse(area, cur.c + 0.5, cur.r + 0.5, nc + 0.5, nr + 0.5, { ignoreFurnitureAtEnd: targetStep });
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
        open.push({ c: nc, r: nr, key: nk, f: tentative + Math.hypot(targetC - nc, targetR - nr) });
      }
    }
    return null;
  }

  function _walkerAllowsFurnitureOverlap(walker, tx, tz) {
    const target = walker?.currentScheduleTarget;
    return target?.pose === 'sit'
      && Number.isFinite(target.c) && Number.isFinite(target.r)
      && Math.hypot(tx - (target.c + 0.5), tz - (target.r + 0.5)) < 0.08;
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

  function _resolveBlockedStep(walker, startX, startZ, desiredX, desiredZ, structuralOnly) {
    const dx = desiredX - startX, dz = desiredZ - startZ;
    const travel = Math.hypot(dx, dz);
    if (travel < 1e-6) return { x: startX, z: startZ };
    const fx = dx / travel, fz = dz / travel;
    const tx = -fz, tz = fx;
    const positionClear = (x, z) => structuralOnly
      ? isNpcPositionStructurallyWalkable(walker.area, x, z)
      : isNpcPositionWalkable(walker.area, x, z);
    const segmentClear = (x, z) => canNpcTraverse(walker.area, startX, startZ, x, z, { structuralOnly });
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

  function _npcStepIsClear(walker, startX, startZ, desiredX, desiredZ, structuralOnly) {
    const travel = Math.hypot(desiredX - startX, desiredZ - startZ);
    const shortStep = Math.max(0.04, npcCollisionRadiusTiles() * 0.45);
    if (travel <= shortStep) {
      return structuralOnly
        ? isNpcPositionStructurallyWalkable(walker.area, desiredX, desiredZ)
        : isNpcPositionWalkable(walker.area, desiredX, desiredZ);
    }
    return canNpcTraverse(walker.area, startX, startZ, desiredX, desiredZ, { structuralOnly });
  }

  function decorateWalkerCollision(walker) {
    if (!walker || decoratedWalkers.has(walker) || typeof walker.moveToward !== 'function') return walker;
    decoratedWalkers.add(walker);
    debugStats.decoratedWalkers++;

    const originalMoveToward = walker.moveToward;
    walker.moveToward = function collisionAwareNpcMoveToward(tx, tz, dt) {
      if (!deps || !this.root?.position) return originalMoveToward.call(this, tx, tz, dt);
      const startX = this.root.position.x, startZ = this.root.position.z;
      const startStructuralClear = isNpcPositionStructurallyWalkable(this.area, startX, startZ);
      const startFullyClear = startStructuralClear && isNpcPositionWalkable(this.area, startX, startZ);
      const arrived = originalMoveToward.call(this, tx, tz, dt);
      const desiredX = this.root.position.x, desiredZ = this.root.position.z;

      // Old saves can place a walker inside a wall, and seated walkers begin
      // inside their chair by design. Let either escape its existing overlap,
      // but never let furniture escape cross a structural wall on the way out.
      if (!startStructuralClear) return arrived;
      if (!startFullyClear && isNpcPositionStructurallyWalkable(this.area, desiredX, desiredZ)) return arrived;

      const seatOverlap = _walkerAllowsFurnitureOverlap(this, tx, tz);
      if (_npcStepIsClear(this, startX, startZ, desiredX, desiredZ, seatOverlap)) return arrived;

      const resolved = _resolveBlockedStep(this, startX, startZ, desiredX, desiredZ, seatOverlap);
      this.root.position.x = resolved.x;
      this.root.position.z = resolved.z;
      const actualDx = resolved.x - startX, actualDz = resolved.z - startZ;
      if (Math.hypot(actualDx, actualDz) > 1e-6) this.applyFacingDeadzone?.(-Math.atan2(actualDz, actualDx) + Math.PI / 2, 0.15);
      _recordBlockedMove(this, tx, tz);
      return arrived && Math.hypot(resolved.x - tx, resolved.z - tz) < 0.001;
    };

    if (typeof walker._tryStartGridPath === 'function') {
      walker._tryStartGridPath = function collisionAwareNpcGridPath(target) {
        if (!target || !this.root?.position) return false;
        const path = findNpcPath(this.area, this.root.position.x, this.root.position.z, target.c, target.r, {
          padding: 6,
          allowOccupiedTarget: target.pose === 'sit',
        });
        if (!path?.length) return false;
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

  function _patchWalkerArray(array) {
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

  function _upgradeCutscenePayload(payload) {
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

  function _installAssignmentHook(name, transform) {
    const existing = window[name];
    let stored = transform(existing);
    const descriptor = Object.getOwnPropertyDescriptor(window, name);
    if (descriptor && descriptor.configurable === false) {
      if (existing) transform(existing);
      return;
    }
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        enumerable: descriptor?.enumerable ?? true,
        get() { return stored; },
        set(value) { stored = transform(value); },
      });
    } catch (_) {
      if (existing) transform(existing);
    }
  }

  function _wrapAuthoredCutsceneRuntime(api) {
    if (!api?.run || api.__npcCollisionAwareRun) return api;
    const wrapped = {
      ...api,
      run(payload, options = {}) {
        return api.run(_upgradeCutscenePayload(payload), options);
      },
    };
    Object.defineProperty(wrapped, '__npcCollisionAwareRun', { value: true });
    return Object.freeze(wrapped);
  }

  function _wrapNpcHeldEquipment(api) {
    if (!api?.attachCutsceneWalker || api.__npcCollisionAwareAttach) return api;
    const originalAttach = api.attachCutsceneWalker;
    try {
      api.attachCutsceneWalker = function collisionAwareAttachCutsceneWalker(walker, ...args) {
        decorateWalkerCollision(walker);
        return originalAttach.call(this, walker, ...args);
      };
      Object.defineProperty(api, '__npcCollisionAwareAttach', { value: true, configurable: true });
    } catch (_) {}
    return api;
  }

  // These globals are assigned after this module loads. Intercepting the
  // assignment keeps integration at the existing module seam instead of
  // adding collision code back into game.js's walker/cutscene monolith.
  _installAssignmentHook('_npcWalkers', _patchWalkerArray);
  _installAssignmentHook('NpcHeldEquipment', _wrapNpcHeldEquipment);
  _installAssignmentHook('AuthoredCutsceneRuntime', _wrapAuthoredCutsceneRuntime);
  _installAssignmentHook('__hobunjiCutscenePreview', _upgradeCutscenePayload);

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
        const spawn = bi ? deps.buildingSpawnFromExit(bi, bi.cols, bi.rows)
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
    const queue = [{ area: fromArea, firstHop: null }];
    while (queue.length) {
      const { area, firstHop } = queue.shift();
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
      latestChange: 'NPC gameplay and authored-cutscene movement now share footprint-aware swept collision, edge-aware detours, and default cutscene navigation.',
    };
  }

  window.NpcPathfinding = {
    init,
    isNpcTileWalkable,
    isNpcPositionWalkable,
    canNpcTraverse,
    canNpcBeeline,
    findNpcPath,
    decorateWalkerCollision,
    areaLinksFrom,
    findNpcAreaLink,
    debugSnapshot,
  };
})();
