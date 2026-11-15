(() => {
  'use strict';

  // Local, input-led ground steering only. Collision still belongs to the
  // caller; this helper never moves actors or weakens their occupancy rules.
  // Mounts use real tile paths. On foot, only a physical-contact-like probe
  // permits a very short lateral slide; interaction and jump targets win.
  const PROFILES = Object.freeze({
    foot: { contactTiles: 0.055, lateralTiles: 0.20, maxTurn: Math.PI / 9 }, // Contact-only and left/right; never pathfind while walking.
    mounted: { lookTiles: 3.7, goalTiles: 4.6, maxSide: 3, maxTurn: Math.PI * 0.49, maxNodes: 300, padding: 6 },
  }); // Shared tuning for both player and rider steering.
  const states = {
    foot: makeState(),
    mounted: makeState(),
  }; // Caches short local routes so neither movement loop runs A* every frame.
  const SCAN_INTERVAL_S = 0.12;
  const REPLAN_INTERVAL_S = 0.55;

  function makeState() {
    return {
      area: null, lastX: NaN, lastY: NaN, dirX: 0, dirY: 0, planDirX: 0, planDirY: 0,
      scanAge: Infinity, routeAge: Infinity, blocked: false, clearScans: 0,
      path: null, index: 0, footSide: 0, probes: 0, plans: 0, status: 'idle', // footSide remembers the chosen side during the current contact.
      output: { x: 0, y: 0, engaged: true, turnRad: 0 },
    };
  }

  function reset(mode) {
    if (!states[mode]) return;
    const st = states[mode];
    st.path = null;
    st.index = 0;
    st.footSide = 0;
    st.blocked = false;
    st.planDirX = st.planDirY = 0; // Tracks the intentional direction at the last route plan.
    st.clearScans = 0;
    st.scanAge = Infinity;
    st.routeAge = Infinity;
    st.status = 'idle';
  }

  function rayIsClear(x, y, vx, vy, distance, tile, canOccupy) {
    const steps = Math.max(1, Math.ceil(distance / (tile * 0.32))); // Fractional-footprint samples between tile centers.
    for (let i = 1; i <= steps; i++) {
      const progress = distance * i / steps;
      if (!canOccupy(x + vx * progress, y + vy * progress)) return false;
    }
    return true;
  }

  function findRoute(st, profile, x, y, dx, dy, tile, canOccupy) {
    const finder = window.TilePathfinding;
    if (!finder?.findPath || !finder?.boxAround) return null;
    const startCol = Math.floor(x / tile), startRow = Math.floor(y / tile);
    const sideX = -dy, sideY = dx; // Perpendicular to the requested travel direction.
    const sideOrder = [0, 1, -1, 2, -2, 3, -3]; // Nearest-to-heading free goals win; no distant wandering.
    const forwardOrder = [profile.goalTiles, profile.goalTiles - 1, profile.goalTiles + 1];
    const walkable = (col, row) => canOccupy((col + 0.5) * tile, (row + 0.5) * tile);
    for (const forward of forwardOrder) {
      for (const side of sideOrder) {
        if (Math.abs(side) > profile.maxSide) continue;
        const goalX = x + (dx * forward + sideX * side) * tile;
        const goalY = y + (dy * forward + sideY * side) * tile;
        const col = Math.floor(goalX / tile), row = Math.floor(goalY / tile);
        if (col === startCol && row === startRow || !walkable(col, row)) continue;
        const bounds = finder.boxAround(startCol, startRow, col, row, profile.padding);
        const path = finder.findPath(startCol, startRow, col, row, walkable, {
          bounds, maxNodes: profile.maxNodes,
        });
        if (!path?.length) continue;
        // The actor begins at its real fractional position, not necessarily
        // at the center of the A* starting tile. Reject initial hops that
        // would scrape a real furniture footprint from that position.
        const next = path[0];
        const wx = (next.col + 0.5) * tile, wy = (next.row + 0.5) * tile;
        const dist = Math.hypot(wx - x, wy - y);
        if (dist > 0.001 && !rayIsClear(x, y, (wx - x) / dist, (wy - y) / dist, dist, tile, canOccupy)) continue;
        st.plans++;
        return path;
      }
    }
    st.plans++;
    return null;
  }


  // The same facing-based action targets used by the game take precedence
  // over foot steering. Query these only after a genuine near-contact probe.
  function facingIntentionalStop(area, x, y, dx, dy, tile) {
    const player = window.__climbDebug?.getPlayer?.(); // The current live player, not a duplicated facing controller.
    if (!player || Math.hypot(player.x - x, player.y - y) > tile * 0.2) return false;
    const facing = Number(player.angle); // Compare actual aim/facing with this movement input, not the deflected velocity.
    if (!Number.isFinite(facing) || Math.cos(facing) * dx + Math.sin(facing) * dy < 0.9) return false;
    if (window.WorldPopupText?.debugSnapshot?.()?.interactionRows?.length) return true;
    if (window.ClimbSystem?.getClimbTarget?.() || window.ClimbSystem?.getWorldClimbTarget?.()) return true;
    const frontX = x / tile + dx * 0.28, frontY = y / tile + dy * 0.28; // Just inside the adjacent obstacle, never a distant search.
    if (window.InteriorDoorTiles?.blocksBox?.(area, frontX, frontY, 0.12)) return true;
    return window.PlayerJump?.hasJumpableSupportAhead?.(x, y, dx, dy, 0.42) === true;
  }

  // On-foot behavior is intentionally NOT the mounted route follower. The
  // player must already be within ~0.055 tile of colliding before we act.
  // Once pressed against an obstacle, choose only a short free sideways lane
  // and bend velocity slightly toward it; native axis collision does the rest.
  function steerFoot(st, profile, area, x, y, dx, dy, tile, canOccupy) {
    const contactX = x + dx * profile.contactTiles * tile, contactY = y + dy * profile.contactTiles * tile; // Movement's imminent footprint test.
    if (canOccupy(contactX, contactY)) {
      st.blocked = false;
      st.footSide = 0;
      st.status = 'clear';
      return null; // No pre-emptive steering, and no lingering slide after clearing the edge.
    }
    st.blocked = true;
    if (st.scanAge >= SCAN_INTERVAL_S || st.status === 'idle' || st.status === 'clear') {
      st.scanAge = 0;
      st.probes++;
      if (facingIntentionalStop(area, x, y, dx, dy, tile)) {
        st.footSide = 0;
        st.status = 'yielding';
        return null; // Facing a door, interaction, climb, or jump target is deliberate.
      }
      const sideX = -dy, sideY = dx; // Only the two directions perpendicular to the held input.
      const initial = st.footSide || 1; // Keep a stable side when both lanes are otherwise equivalent.
      let best = 0, bestScore = -1;
      for (const sign of [initial, -initial]) {
        const sx = sideX * sign, sy = sideY * sign;
        const nearX = x + sx * tile * 0.09, nearY = y + sy * tile * 0.09; // No sideways collision shortcut.
        const farX = x + sx * profile.lateralTiles * tile, farY = y + sy * profile.lateralTiles * tile; // Maximum local lateral foresight.
        if (!canOccupy(nearX, nearY) || !canOccupy(farX, farY)) continue;
        const score = canOccupy(farX + dx * tile * 0.22, farY + dy * tile * 0.22) ? 2 : 1; // One small forward tie-break probe, not a goal.
        if (score > bestScore) { bestScore = score; best = sign; }
      }
      st.footSide = best;
      st.status = best ? 'sliding' : 'no-lane';
    }
    if (st.status === 'yielding' || !st.footSide) return null;
    const angle = Math.atan2(dy, dx) + st.footSide * profile.maxTurn; // Keeps desired movement overwhelmingly forward.
    const result = st.output; // Reuse the same object as the mounted steering path.
    result.x = Math.cos(angle);
    result.y = Math.sin(angle);
    result.turnRad = st.footSide * profile.maxTurn;
    return result;
  }

  // Returns null for untouched direct movement, otherwise a unit direction.
  // mode: 'foot' or 'mounted'; area prevents routes surviving region changes.
  function steer(mode, area, x, y, inputX, inputY, tile, canOccupy, dt) {
    const profile = PROFILES[mode], st = states[mode];
    if (!profile || typeof canOccupy !== 'function' || !(tile > 0)) return null;
    const strength = Math.hypot(inputX, inputY);
    if (!(strength > 0.001) || !Number.isFinite(x) || !Number.isFinite(y)) {
      reset(mode);
      return null;
    }
    const dx = inputX / strength, dy = inputY / strength;
    if (st.area !== area || Math.hypot(x - st.lastX, y - st.lastY) > tile * 1.8 ||
        dx * st.dirX + dy * st.dirY < 0.82 ||
        ((st.path || st.status === 'no-route') && dx * st.planDirX + dy * st.planDirY < 0.82)) {
      reset(mode); // New area, teleport, or deliberate turn cancels the previous detour.
    }
    st.area = area;
    st.lastX = x; st.lastY = y;
    st.dirX = dx; st.dirY = dy;
    st.scanAge += Math.max(0, dt || 0);
    st.routeAge += Math.max(0, dt || 0);
    if (mode === 'foot') return steerFoot(st, profile, area, x, y, dx, dy, tile, canOccupy); // Walking never enters A*.

    if (st.scanAge >= SCAN_INTERVAL_S) {
      st.probes++;
      st.blocked = !rayIsClear(x, y, dx, dy, profile.lookTiles * tile, tile, canOccupy);
      st.clearScans = st.blocked ? 0 : st.clearScans + 1;
      st.scanAge = 0;
    }
    // Two clean scans prevent rapid left/right flickering as the actor
    // crosses the outer edge of a tree or rock.
    if (st.clearScans >= 2 || (!st.blocked && !st.path)) {
      st.path = null;
      st.status = 'clear';
      return null;
    }

    // Failed searches are cached too: a solid fence must not trigger up to
    // 21 bounded A* searches on every frame while the stick is held.
    // A new blockage (previously 'clear') still plans immediately.
    if (st.routeAge >= REPLAN_INTERVAL_S || (!st.path && st.status !== 'no-route')) {
      st.planDirX = dx; st.planDirY = dy; // Slow stick turns must not follow a stale route from an old bearing.
      st.path = findRoute(st, profile, x, y, dx, dy, tile, canOccupy);
      st.index = 0;
      st.routeAge = 0;
    }
    if (!st.path) {
      st.status = 'no-route';
      return null; // Never force a path into impassable terrain.
    }

    // Follow tile-center waypoints, not a far-off goal through the obstacle.
    while (st.index < st.path.length) {
      const next = st.path[st.index];
      if (Math.hypot((next.col + 0.5) * tile - x, (next.row + 0.5) * tile - y) > tile * 0.26) break;
      st.index++;
    }
    if (st.index >= st.path.length) {
      st.path = null;
      st.status = 'arrived';
      return null;
    }
    const waypoint = st.path[st.index];
    const targetAngle = Math.atan2((waypoint.row + 0.5) * tile - y, (waypoint.col + 0.5) * tile - x);
    const requestedAngle = Math.atan2(dy, dx);
    const delta = Math.atan2(Math.sin(targetAngle - requestedAngle), Math.cos(targetAngle - requestedAngle));
    const turn = Math.max(-profile.maxTurn, Math.min(profile.maxTurn, delta));
    const result = st.output; // Reused response object avoids allocations each frame.
    result.x = Math.cos(requestedAngle + turn);
    result.y = Math.sin(requestedAngle + turn);
    result.turnRad = turn;
    st.status = 'detouring';
    return result;
  }

  // Mobile-friendly diagnostics: inspect through the game's existing debug
  // console/pixel-probe integrations without relying on browser devtools.
  function debugSnapshot() {
    const out = {};
    for (const [mode, st] of Object.entries(states)) {
      out[mode] = {
        status: st.status, area: st.area, blocked: st.blocked,
        waypoint: st.path?.[st.index] || null, plans: st.plans, probes: st.probes,
        side: mode === 'foot' ? st.footSide : null,
      };
    }
    return out;
  }

  window.GroundObstacleAvoidance = Object.freeze({ steer, reset, debugSnapshot });
})();
