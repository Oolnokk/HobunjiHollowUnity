(() => {
  'use strict';

  // Attackers follow the player up (and down) cliffs. A chasing hostile that
  // reaches the foot of a plateau wall while its target stands on a
  // different elevation tier scales it with the same staggered hop crossing
  // the player's own cliff climb uses (js/climb-system.js) — a scripted lerp
  // from the wall's foot to the landing tile beyond it, with its height
  // carried in c._cliffClimb.surfaceY (read by game.js's updateCreatureMesh,
  // exactly like a mount's _climbLeap).
  //
  // A creature mid-climb is exposed: any projectile hit (game.js's
  // damageCreature calls knockOff for every ranged hit) peels it off the
  // face, and it drops back to where it started and lands hard (a Footing
  // hit plus a little Health, matching a branch fall). It may try again
  // after a short cooldown.
  //
  // Wired from game.js: init(deps) once, update(c, dt, target) at the top
  // of the hostile AI loop (returns true while the climb owns the creature
  // this frame), knockOff(c) from damageCreature.
  let deps = null;
  function init(injected) { deps = injected; }

  const HOP_ACTIVE_S = 0.34;
  const HOP_PAUSE_S = 0.22;
  const HOP_BOUNCE_UNITS = 0.35;
  const DESCEND_ACTIVE_S = 0.42; // Going down is one leap, like the player's jump-down.
  const FALL_S = 0.38;
  const MAX_WALL_TILES = 4;
  const TRIGGER_PROBE_TILES = 0.6; // How close to the wall's foot the creature must be.
  const MAX_TARGET_DIST_TILES = 14;
  const RETRY_COOLDOWN_S = 2.5;
  const FALL_FOOTING = 47.5;
  const FALL_HEALTH_MAX = 3;

  const debug = { started: 0, completed: 0, knockedOff: 0, lastEvent: null };

  function grid() { return deps?.getActiveGrid?.() || null; }
  function tileAtPx(g, x, y) { return g?.[Math.floor(y / deps.TILE)]?.[Math.floor(x / deps.TILE)] || null; }
  function isBoundary(tile) { return !!window.MapBoundaryGuard?.isBoundaryTile?.(tile); }

  // Elevation tier the target is on — or about to be on, mid-climb.
  function targetTier(g, target) {
    if (!target || target.onBranch) return null;
    if (target.climbing && Number.isFinite(target.climbEndX)) return tileAtPx(g, target.climbEndX, target.climbEndY)?.elevTier || 0;
    const t = tileAtPx(g, target.x, target.y);
    return t && !t.incline ? (t.elevTier || 0) : null;
  }

  // Same cardinal wall scan as ClimbSystem's getWallClimbTarget, from a
  // creature's tile: one or more incline tiles, then a walkable landing at a
  // different tier. Boundary escarpments are never climbable.
  function scanWall(g, startCol, startRow, dir) {
    const cols = deps.getActiveCols(), rows = deps.getActiveRows();
    const startTile = g[startRow]?.[startCol];
    if (!startTile || startTile.incline || isBoundary(startTile)) return null;
    const startTier = startTile.elevTier || 0;
    let col = startCol, row = startRow, wallTiles = 0;
    for (let step = 0; step < MAX_WALL_TILES; step++) {
      col += dir.x; row += dir.y;
      if (col < 0 || row < 0 || col >= cols || row >= rows) return null;
      const t = g[row]?.[col];
      if (!t || isBoundary(t)) return null;
      if (!t.incline) {
        if (!wallTiles || deps.isSolid(t.type) || (t.elevTier || 0) === startTier) return null;
        return { dir, landCol: col, landRow: row, startTier, landTier: t.elevTier || 0, wallTiles, startTile, landTile: t };
      }
      wallTiles++;
    }
    return null;
  }

  function findClimbToward(c, target) {
    // Legacy probing is retained for authored non-route cliffs only; the
    // exterior route network takes priority in update/navigate below.
    const g = grid();
    if (!g) return null;
    const goalTier = targetTier(g, target);
    if (goalTier === null) return null;
    const startCol = Math.floor(c.x / deps.TILE), startRow = Math.floor(c.y / deps.TILE);
    const here = g[startRow]?.[startCol];
    if (!here || here.incline) return null;
    const hereTier = here.elevTier || 0;
    if (hereTier === goalTier) return null;
    const dx = target.x - c.x, dy = target.y - c.y;
    const dirs = Math.abs(dx) >= Math.abs(dy)
      ? [{ x: Math.sign(dx) || 1, y: 0 }, { x: 0, y: Math.sign(dy) || 1 }]
      : [{ x: 0, y: Math.sign(dy) || 1 }, { x: Math.sign(dx) || 1, y: 0 }];
    for (const dir of dirs) {
      // Only once the creature is actually at the wall's foot.
      const probe = tileAtPx(g, c.x + dir.x * deps.TILE * TRIGGER_PROBE_TILES, c.y + dir.y * deps.TILE * TRIGGER_PROBE_TILES);
      if (!probe?.incline) continue;
      const wall = scanWall(g, startCol, startRow, dir);
      if (!wall) continue;
      // The landing must bring it closer to its target's tier.
      if (Math.abs(wall.landTier - goalTier) >= Math.abs(hereTier - goalTier)) continue;
      return wall;
    }
    return null;
  }

  function beginClimb(c, wall) {
    const area = deps.getCurrentArea();
    const descending = wall.landTier < wall.startTier;
    const surfaceStartY = deps.tileSurfaceYInArea(wall.startTile, area);
    const surfaceEndY = deps.tileSurfaceYInArea(wall.landTile, area);
    c._cliffClimb = {
      phase: 'climb',
      t: 0,
      hops: descending ? 1 : Math.max(2, wall.wallTiles + 1),
      activeS: descending ? DESCEND_ACTIVE_S : HOP_ACTIVE_S,
      pauseS: descending ? 0 : HOP_PAUSE_S,
      startX: c.x, startY: c.y,
      endX: (wall.landCol + 0.5) * deps.TILE, endY: (wall.landRow + 0.5) * deps.TILE,
      surfaceStartY, surfaceEndY, surfaceY: surfaceStartY,
      originX: c.x, originY: c.y, originSurfaceY: surfaceStartY,
      descending,
    };
    c.vx = 0; c.vy = 0;
    c.facing = Math.atan2(wall.dir.y, wall.dir.x);
    c.state = 'chase';
    debug.started++;
    debug.lastEvent = `${c.id || c.creatureKey} ${descending ? 'leaping down' : 'climbing'} toward tier ${wall.landTier}`;
    window.__farmLog?.(`[climb] ${c.creatureKey || 'hostile'} ${descending ? 'leaps down' : 'climbs'} a cliff after its target`, 'wildlife');
  }

  function advance(c, dt) {
    const climb = c._cliffClimb;
    if (climb.phase === 'fall') {
      climb.t = Math.min(1, climb.t + dt / FALL_S);
      const eased = climb.t * climb.t; // Accelerates into the ground.
      c.x = climb.startX + (climb.endX - climb.startX) * Math.min(1, climb.t * 1.6);
      c.y = climb.startY + (climb.endY - climb.startY) * Math.min(1, climb.t * 1.6);
      climb.surfaceY = climb.surfaceStartY + (climb.surfaceEndY - climb.surfaceStartY) * eased;
      if (climb.t >= 1) land(c, true);
      return;
    }
    const cycle = climb.activeS + climb.pauseS;
    const total = climb.hops * cycle;
    climb.t = Math.min(total, climb.t + dt);
    const hop = Math.min(climb.hops - 1, Math.floor(climb.t / cycle));
    const within = climb.t - hop * cycle;
    const active = within < climb.activeS;
    const localT = active ? Math.max(0, Math.min(1, within / climb.activeS)) : 1;
    const eased = 1 - Math.pow(1 - localT, 2);
    const overall = Math.max(0, Math.min(1, (hop + eased) / climb.hops));
    c.x = climb.startX + (climb.endX - climb.startX) * overall;
    c.y = climb.startY + (climb.endY - climb.startY) * overall;
    climb.surfaceY = climb.surfaceStartY + (climb.surfaceEndY - climb.surfaceStartY) * overall
      + (active ? Math.sin(localT * Math.PI) * HOP_BOUNCE_UNITS : 0);
    c.facing = Math.atan2(climb.endY - climb.startY, climb.endX - climb.startX);
    if (climb.t >= total) land(c, false);
  }

  function land(c, fell) {
    const climb = c._cliffClimb;
    c.x = climb.endX; c.y = climb.endY;
    c._cliffClimb = null;
    c.vx = 0; c.vy = 0;
    c.knockbackT = 0; c.knockbackVX = 0; c.knockbackVY = 0;
    window.KnockbackCollisionImpact?.cancel?.(c);
    if (fell) {
      const health = Number(c.health);
      const impact = Math.min(FALL_HEALTH_MAX, Math.max(0, (Number.isFinite(health) ? health : 1) - 1));
      if (impact > 0) window.ResourceSystem?.applyDamage?.(c, impact, { tag: 'blunt', source: 'fell from cliff' });
      window.ResourceSystem?.spendFooting?.(c, FALL_FOOTING, 'fell from cliff');
      c._cliffClimbCooldownT = RETRY_COOLDOWN_S;
    } else {
      debug.completed++;
      c._cliffClimbCooldownT = 0.6;
    }
  }

  // Projectile hit while on the face: let go and fall back to the foot.
  function knockOff(c, reason = 'shot while climbing') {
    const climb = c?._cliffClimb;
    if (!climb || climb.phase !== 'climb' || climb.descending) return false;
    climb.phase = 'fall';
    climb.t = 0;
    climb.startX = c.x; climb.startY = c.y;
    climb.endX = climb.originX; climb.endY = climb.originY;
    climb.surfaceStartY = climb.surfaceY;
    climb.surfaceEndY = climb.originSurfaceY;
    debug.knockedOff++;
    debug.lastEvent = `${c.id || c.creatureKey} knocked off (${reason})`;
    window.__farmLog?.(`[climb] ${c.creatureKey || 'hostile'} ${reason} — falls`, 'wildlife');
    return true;
  }

  function update(c, dt, target) {
    if (!deps || !c) return false;
    if (c._cliffClimb) {
      if (c.health <= 0 || c.areaId !== deps.getCurrentArea()) { c._cliffClimb = null; c._cliffRouteTravel = null; return false; }
      advance(c, Math.max(0, Number(dt) || 0));
      return true;
    }
    if (c._cliffRouteTravel) {
      // Ownership persists between hops: main wildlife AI must never move
      // vertically through the cliff or select another destination halfway.
      if (c.health <= 0 || c.areaId !== deps.getCurrentArea()) { c._cliffRouteTravel = null; return false; }
      const travel = c._cliffRouteTravel, route = travel.route;
      if (travel.node === travel.exit) {
        c._cliffRouteTravel = null; c._cliffClimbCooldownT = 0; return false;
      }
      const next = travel.node + Math.sign(travel.exit - travel.node);
      const fromNode = route.nodes[travel.node], toNode = route.nodes[next];
      if (!fromNode || !toNode || !fromNode.links.includes(next)) { c._cliffRouteTravel = null; return false; }
      beginRouteHop(c, fromNode, toNode, travel);
      advance(c, 0);
      return true;
    }
    if (c._cliffClimbCooldownT > 0) { c._cliffClimbCooldownT = Math.max(0, c._cliffClimbCooldownT - dt); return false; }
    if (c.isCompanion || c.health <= 0 || c.state !== 'chase' || c.onBranch || c._branchDefense || c.prone) return false;
    if (!deps.isZoneArea(deps.getCurrentArea()) || c.areaId !== deps.getCurrentArea()) return false;
    if (!target || target.health <= 0) return false;
    // Route graph is authoritative for exterior climbs, including enemies
    // approaching a distant branch in the wall instead of their nearest face.
    if (navigate(c, target.x, target.y, c.def?.chaseSpeed || c.def?.moveSpeed || deps.TILE * 2, dt)) return true;
    const network = networkForCurrentArea();
    if (network) return false; // Never fall back to an unrestricted legacy wall scan in wilderness.
    if (Math.hypot(target.x - c.x, target.y - c.y) > deps.TILE * MAX_TARGET_DIST_TILES) return false;
    if (window.Combat?.animalAttacks?.isBusy?.(c) || c.knockbackT > 0) return false;
    const wall = findClimbToward(c, target);
    if (!wall) return false;
    beginClimb(c, wall);
    advance(c, 0);
    return true;
  }

  const entryDebug = { approaches: 0, hops: 0, failures: 0 }; // Mobile snapshot identifies chosen route and navigation stalls.

  function networkForCurrentArea() {
    if (!deps?.isZoneArea?.(deps.getCurrentArea())) return null;
    const active = grid();
    return active && window.CliffRouteNetwork?.forGrid?.(active, {
      area: deps.getCurrentArea(),
      blocked: tile => !tile || tile.incline || deps.isSolid(tile.type),
      isBoundary,
      tileY: tile => deps.tileSurfaceYInArea(tile, deps.getCurrentArea()),
    });
  }
  function beginRouteHop(c, start, end, travel) {
    const startY = Number(start.y), endY = Number(end.y);
    c._cliffClimb = {
      phase: 'climb', t: 0, hops: 1,
      activeS: HOP_ACTIVE_S, pauseS: HOP_PAUSE_S,
      startX: c.x, startY: c.y,
      endX: end.x * deps.TILE, endY: end.z * deps.TILE,
      surfaceStartY: startY, surfaceEndY: endY, surfaceY: startY,
      originX: travel.route.nodes[travel.entry].x * deps.TILE,
      originY: travel.route.nodes[travel.entry].z * deps.TILE,
      originSurfaceY: travel.route.nodes[travel.entry].y,
      descending: endY < startY,
    };
    c.facing = Math.atan2(c._cliffClimb.endY - c.y, c._cliffClimb.endX - c.x);
    travel.node = end.id; // Only the scripted hop owns c.x/y until it finishes.
    c.vx = 0; c.vy = 0;
    entryDebug.hops++;
  }

  function walkToEntry(c, tx, ty, speed, dt, route, entry, net) {
    const node = route.nodes[entry];
    const targetX = node.x * deps.TILE, targetY = node.z * deps.TILE;
    const distance = Math.hypot(c.x - targetX, c.y - targetY);
    if (distance < deps.TILE * 0.36) {
      c._cliffRouteTravel = { route, entry, node: entry, exit: entry === 0 ? route.upperNode : 0 };
      c._cliffEntryPath = null;
      c._cliffClimbCooldownT = 0;
      entryDebug.approaches++;
      return true;
    }
    const entryKey = route.id + '|' + entry;
    if (c._cliffEntryKey !== entryKey || !c._cliffEntryPath?.length) {
      const startCol = Math.floor(c.x / deps.TILE), startRow = Math.floor(c.y / deps.TILE);
      const endCol = Math.floor(targetX / deps.TILE), endRow = Math.floor(targetY / deps.TILE);
      const component = window.CliffRouteNetwork.componentAt(net, startCol, startRow);
      const path = window.TilePathfinding?.findPath?.(startCol, startRow, endCol, endRow, (col, row) => {
        const tile = grid()?.[row]?.[col];
        return !!tile && !tile.incline && !isBoundary(tile) && !deps.isSolid(tile.type) &&
          window.CliffRouteNetwork.componentAt(net, col, row) === component &&
          deps.creatureCanEnterTile(c.def, (col + 0.5) * deps.TILE, (row + 0.5) * deps.TILE, NaN, NaN, c, true);
      }, { bounds: window.TilePathfinding.boxAround(startCol, startRow, endCol, endRow, 10), maxNodes: 6500 });
      c._cliffEntryPath = path || [];
      c._cliffEntryKey = entryKey;
      if (!path?.length) { entryDebug.failures++; return false; }
    }
    const waypoint = c._cliffEntryPath?.[0];
    if (!waypoint) return false;
    const wx = (waypoint.col + 0.5) * deps.TILE, wy = (waypoint.row + 0.5) * deps.TILE;
    const dx = wx - c.x, dy = wy - c.y, length = Math.hypot(dx, dy);
    if (length <= deps.TILE * 0.19) { c._cliffEntryPath.shift(); return true; }
    const step = Math.min(length, Math.max(0, speed * dt));
    const x = c.x + dx / length * step, y = c.y + dy / length * step;
    if (!deps.creatureCanEnterTile(c.def, x, y, c.x, c.y, c)) {
      c._cliffEntryPath = null;
      entryDebug.failures++;
      c.vx = 0; c.vy = 0;
      return false;
    }
    c.x = x; c.y = y;
    c.vx = dx / length * speed; c.vy = dy / length * speed;
    c.facing = Math.atan2(dy, dx);
    return true;
  }

  // Used both by chasing enemies and the shared moveCreatureToward choke
  // point (herds, prey, companions, returning animals). A higher/lower goal
  // is routed to a *selected* cliff path instead of teleporting in height.
  function navigate(c, goalX, goalY, speed, dt) {
    if (!deps || !c || ![goalX, goalY, c.x, c.y].every(Number.isFinite)) return false;
    if (!deps.isZoneArea(deps.getCurrentArea()) || c.areaId !== deps.getCurrentArea()) return false;
    if (c._cliffClimb || c._cliffRouteTravel) return true;
    if (c.health <= 0 || c.prone || c.knockbackT > 0 || c.onBranch) return false;
    const net = networkForCurrentArea();
    if (!net) return false;
    const fromC = Math.floor(c.x / deps.TILE), fromR = Math.floor(c.y / deps.TILE);
    const goalC = Math.floor(goalX / deps.TILE), goalR = Math.floor(goalY / deps.TILE);
    const edge = window.CliffRouteNetwork.toward(net, fromC, fromR, goalC, goalR);
    if (!edge) {
      c._cliffEntryPath = null;
      c._cliffEntryKey = null;
      return false;
    }
    return walkToEntry(c, goalX, goalY, speed, dt, edge.route, edge.entry, net);
  }

  window.CreatureCliffClimb = {
    init,
    update,
    navigate,
    knockOff,
    isClimbing: c => !!c?._cliffClimb,
    get debug() { return { ...debug, ...entryDebug }; },
  };
})();
