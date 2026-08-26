(() => {
  'use strict';

  // Cliff climbing: the player must be facing straight into a plateau's
  // auto-reserved incline wall (see mergeZoneTiles in game.js) from solid
  // ground, with an actual walkable tile at a different elevation tier on
  // the far side — otherwise there's nothing to climb. Works either
  // direction (climbing up onto a plateau or back down off one uses the
  // same check). Once triggered it's a scripted crossing — bypasses
  // tileSpeedAt/canPlayerOccupy entirely (it deliberately walks through
  // incline tiles that are otherwise impassable) and drains no stamina.
  //
  // Extracted out of game.js following the same window.<Namespace> +
  // init(deps) pattern as its sibling systems. facingCardinal stays behind
  // in game.js on purpose — it's also used by unrelated aiming/tool-use
  // code, not owned by climbing alone — and comes in through deps.
  // facingAngle/targetAimAngle/lastMoveAngle are threaded as getter/setter
  // pairs since they're plain `let`s reassigned all over game.js's
  // movement code.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  // World interaction uses the centered reticle in every exterior camera mode;
  // ranged projectile aim remains on getPlayerAimRay, while climb/nest focus
  // can still work with a melee weapon or empty hands equipped.
  function getInteractionRay() {
    return deps?.getPlayerInteractionRay?.() || deps?.getPlayerAimRay?.() || null;
  }
  const climbSafetyDebug = {
    lastBlockReason: null, lastBlockRideState: 'none', lastBlockAt: 0,
    lastFocusType: null, lastFocusId: null, lastFocusPoint: null,
    lastFocusDistanceWorld: null, lastFocusAt: 0, lastJumpMode: null,
  }; // Used by Pixel Probe and the interaction-ray overlay on mobile.

  // Climbable shadewood branches, registered per zone by game.js right after
  // it positions each shadewood tree instance (see FoliageGenerator's
  // getClimbBranchWorld). Keyed by mapId/currentArea so a target in one zone
  // is never offered while standing in another. baseX/Y and tipX/Y are world
  // px (player.x/y convention); baseWorldY/tipWorldY are THREE-unit heights
  // (player.climbSurfaceY/branchSurfaceY convention).
  const branchesByArea = new Map();
  function resetAreaBranches(mapId) { branchesByArea.set(mapId, []); }
  function registerBranch(mapId, branch) {
    if (!branchesByArea.has(mapId)) branchesByArea.set(mapId, []);
    branchesByArea.get(mapId).push(branch);
  }
  function removeBranchesInBounds(mapId, bounds) {
    const branches = branchesByArea.get(mapId);
    if (!branches?.length || !bounds || !deps?.TILE) return 0;
    const kept = branches.filter(branch => {
      const col = Math.floor(branch.baseX / deps.TILE);
      const row = Math.floor(branch.baseY / deps.TILE);
      return col < bounds.colStart || col >= bounds.colEnd || row < bounds.rowStart || row >= bounds.rowEnd;
    });
    const removed = branches.length - kept.length;
    branchesByArea.set(mapId, kept);
    return removed;
  }

  const CLIMB_MAX_WALL_TILES = 4;
  function getWallClimbTarget() {
    const player = deps.player;
    const dir = deps.facingCardinal(player.angle);
    const grid = deps.getActiveGrid();
    const aC = deps.getActiveCols(), aR = deps.getActiveRows();
    const startCol = Math.floor(player.x / deps.TILE), startRow = Math.floor(player.y / deps.TILE);
    const startTile = grid[startRow]?.[startCol];
    if (!startTile || startTile.incline) return null;
    const startElevTier = startTile.elevTier || 0;
    let col = startCol, row = startRow, wallTiles = 0;
    for (let steps = 0; steps < CLIMB_MAX_WALL_TILES; steps++) {
      col += dir.x; row += dir.y;
      if (col < 0 || row < 0 || col >= aC || row >= aR) return null;
      const t = grid[row][col];
      if (!t) return null;
      if (!t.incline) {
        if (wallTiles === 0) return null; // nothing but open ground ahead
        if (deps.isSolid(t.type)) return null;
        if ((t.elevTier || 0) === startElevTier) return null;
        return { type: 'wall', dir, landCol: col, landRow: row, startElevTier, landElevTier: t.elevTier || 0, wallTiles };
      }
      wallTiles++;
    }
    return null;
  }

  // Camera-ray focus owns branch interactions whenever a 3D aim ray exists;
  // the old facing test remains as the non-shoulder/mobile fallback.
  const BRANCH_CLIMB_PROXIMITY_TILES = 1.15;
  const BRANCH_CLIMB_FACING_COS = 0.55; // ~56 degrees either side of dead-on.
  function branchTrunkBox(branch) {
    const x = branch.baseX / deps.TILE, z = branch.baseY / deps.TILE;
    const half = Math.max(0.32, Number(branch.radius) || 0.25);
    const groundY = deps.worldSurfaceY?.(branch.baseX, branch.baseY) ?? 0;
    const topY = Math.max(groundY + 0.6, Number(branch.baseWorldY) + half);
    return new THREE.Box3(
      new THREE.Vector3(x - half, groundY, z - half),
      new THREE.Vector3(x + half, topY, z + half),
    );
  }
  function recordClimbFocusDebug(focus, type) {
    climbSafetyDebug.lastFocusType = focus ? type : null;
    climbSafetyDebug.lastFocusId = focus?.candidate?.id || null;
    climbSafetyDebug.lastFocusPoint = focus?.point
      ? { x: focus.point.x, y: focus.point.y, z: focus.point.z }
      : null;
    climbSafetyDebug.lastFocusDistanceWorld = focus?.distanceWorld ?? null;
    climbSafetyDebug.lastFocusAt = performance.now();
    if (focus) window.DebugHitboxes?.noteInteractionFocus?.(focus);
  }

  function focusedWorldCandidate(candidates, maxDistanceWorld = 12) {
    const focus = window.RangedWeapons?.focusCandidates?.(candidates, maxDistanceWorld) || null;
    if (!focus) return null;
    const hostile = window.RangedWeapons?.focusedHostile?.(maxDistanceWorld) || null;
    return hostile && hostile.distanceWorld <= focus.distanceWorld + 0.05 ? null : focus;
  }
  function getBranchClimbTarget() {
    const branches = branchesByArea.get(deps.getCurrentArea());
    if (!branches || !branches.length) return null;
    const player = deps.player;
    const proximityPx = deps.TILE * BRANCH_CLIMB_PROXIMITY_TILES;
    const nearby = branches.filter(branch => Math.hypot(branch.baseX - player.x, branch.baseY - player.y) <= proximityPx);
    const hasAimRay = !!getInteractionRay();
    if (hasAimRay && window.RangedWeapons?.focusCandidates) {
      const focus = focusedWorldCandidate(nearby.map(branch => ({
        type: 'branch', id: branch.id || (branch.col + ',' + branch.row), data: branch, box: branchTrunkBox(branch),
      })));
      recordClimbFocusDebug(focus, 'branch');
      return focus ? { type: 'branch', branch: focus.candidate.data, aimDistanceWorld: focus.distanceWorld } : null;
    }
    const facingX = Math.cos(player.angle), facingY = Math.sin(player.angle);
    let best = null, bestDist = Infinity;
    for (const branch of nearby) {
      const dx = branch.baseX - player.x, dy = branch.baseY - player.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 1 || dist >= bestDist) continue;
      if ((dx * facingX + dy * facingY) / dist < BRANCH_CLIMB_FACING_COS) continue;
      bestDist = dist; best = branch;
    }
    climbSafetyDebug.lastFocusType = best ? 'branch-facing-fallback' : null;
    climbSafetyDebug.lastFocusId = best ? (best.id || (best.col + ',' + best.row)) : null;
    climbSafetyDebug.lastFocusPoint = null;
    climbSafetyDebug.lastFocusDistanceWorld = null;
    climbSafetyDebug.lastFocusAt = performance.now();
    return best ? { type: 'branch', branch: best } : null;
  }

  function branchNestBox(branch, nest) {
    const x = nest.x / deps.TILE, z = nest.y / deps.TILE;
    const y = Number(nest.worldY) || ((branch.baseWorldY + branch.tipWorldY) / 2);
    // Keep an authored midpoint volume even when a decorative nest mesh has a
    // local pivot/scale that makes its world bounds too small or offset.
    const authoredBox = new THREE.Box3(
      new THREE.Vector3(x - 0.55, y - 0.15, z - 0.55),
      new THREE.Vector3(x + 0.55, y + 0.65, z + 0.55),
    );
    if (nest.mesh?.isObject3D) {
      nest.mesh.updateWorldMatrix?.(true, true);
      const meshBox = new THREE.Box3().setFromObject(nest.mesh);
      if (!meshBox.isEmpty()) return meshBox.expandByScalar(0.12).union(authoredBox);
    }
    return authoredBox;
  }

  // Branch nests share the exact centered ray/nearest-hit arbitration used
  // by hostile aim. They are only collectible from their own branch.
  function getAimedNest() {
    const player = deps.player;
    const branch = player?.onBranch;
    const nest = branch?.nest;
    if (!nest || nest.remaining <= 0 || nest.areaId !== deps.getCurrentArea()) return null;
    if (Math.hypot(player.x - nest.x, player.y - nest.y) > deps.TILE * 1.6) return null;
    if (getInteractionRay() && window.RangedWeapons?.focusCandidates) {
      const focus = focusedWorldCandidate([{ type: 'nest', id: nest.id, data: nest, box: branchNestBox(branch, nest) }]);
      recordClimbFocusDebug(focus, 'nest');
      return focus?.candidate?.data || null;
    }
    const dx = nest.x - player.x, dy = nest.y - player.y;
    const dist = Math.hypot(dx, dy);
    const facing = dist > 0 ? (dx * Math.cos(player.angle) + dy * Math.sin(player.angle)) / dist : 1;
    return facing >= BRANCH_CLIMB_FACING_COS ? nest : null;
  }

  function currentLook2D() {
    const direction = getInteractionRay()?.direction;
    const len = Math.hypot(Number(direction?.x) || 0, Number(direction?.z) || 0);
    return len > 0.001
      ? { x: direction.x / len, y: direction.z / len }
      : { x: Math.cos(deps.player.angle), y: Math.sin(deps.player.angle) };
  }

  // Jump-down is available at the tip while looking outward, or anywhere on
  // the branch while looking roughly perpendicular to it.
  const BRANCH_TIP_T_THRESHOLD = 0.85;
  const BRANCH_JUMP_FACING_COS = 0.7; // ~45 degrees either side of dead-on outward.
  const BRANCH_JUMP_PERP_DOT_MAX = 0.42;
  function getClimbTarget() {
    if (!deps._isZoneArea(deps.getCurrentArea())) return null;
    const player = deps.player;
    if (player.onBranch) {
      const branch = player.onBranch;
      // An enemy under the same centered ray keeps Action 1 in combat; jump
      // down only claims it when no hostile body volume is in front.
      const hostileFocus = getInteractionRay() ? window.RangedWeapons?.focusedHostile?.(24) : null;
      if (hostileFocus) {
        climbSafetyDebug.lastFocusType = 'hostile';
        climbSafetyDebug.lastFocusId = hostileFocus.candidate?.id || null;
        climbSafetyDebug.lastFocusPoint = hostileFocus.point
          ? { x: hostileFocus.point.x, y: hostileFocus.point.y, z: hostileFocus.point.z }
          : null;
        climbSafetyDebug.lastFocusDistanceWorld = hostileFocus.distanceWorld;
        climbSafetyDebug.lastFocusAt = performance.now();
        return null;
      }
      const axisX = (branch.tipX - branch.baseX) / branch.length;
      const axisY = (branch.tipY - branch.baseY) / branch.length;
      const look = currentLook2D();
      const along = axisX * look.x + axisY * look.y;
      if (Math.abs(along) <= BRANCH_JUMP_PERP_DOT_MAX) {
        return { type: 'branchJumpDown', mode: 'perpendicular', dir: look };
      }
      if ((player.branchT ?? 0) >= BRANCH_TIP_T_THRESHOLD && along >= BRANCH_JUMP_FACING_COS) {
        return { type: 'branchJumpDown', mode: 'tip', dir: { x: axisX, y: axisY } };
      }
      return null;
    }
    return getWallClimbTarget() || getBranchClimbTarget();
  }

  const CLIMB_HOP_ACTIVE_S = 0.32;
  const CLIMB_HOP_PAUSE_S  = 0.26;
  const CLIMB_HOP_BOUNCE_UNITS = 0.4;
  function startClimb(climb) {
    const mountRideState = deps.getMountRideState?.() || 'none'; // Used to keep scripted climbing mutually exclusive with every mount transition phase.
    if (mountRideState !== 'none') {
      climbSafetyDebug.lastBlockReason = 'mounted';
      climbSafetyDebug.lastBlockRideState = mountRideState;
      climbSafetyDebug.lastBlockAt = Date.now();
      deps.showToast?.('Dismount before climbing.', false);
      window.__farmLog?.(`[climb] blocked while mount rideState=${mountRideState}`, 'wildlife');
      return false;
    }
    if (climb.type === 'branch') return startBranchClimb(climb.branch);
    if (climb.type === 'branchJumpDown') return startBranchJumpDown(climb);

    const player = deps.player;
    const currentArea = deps.getCurrentArea();
    const grid = deps.getActiveGrid();
    const startCol = Math.floor(player.x / deps.TILE), startRow = Math.floor(player.y / deps.TILE);
    const startTile = grid[startRow][startCol];
    const landTile = grid[climb.landRow][climb.landCol];
    player.climbing = true;
    player.climbElapsed = 0;
    player.climbHopCount = Math.max(3, climb.wallTiles + 1);
    player.climbStartX = player.x;
    player.climbStartY = player.y;
    player.climbEndX = (climb.landCol + 0.5) * deps.TILE;
    player.climbEndY = (climb.landRow + 0.5) * deps.TILE;
    player.climbSurfaceStartY = deps.tileSurfaceYInArea(startTile, currentArea);
    player.climbSurfaceEndY = deps.tileSurfaceYInArea(landTile, currentArea);
    player.climbSurfaceY = player.climbSurfaceStartY;
    player.climbHopBounce = 0;
    player.vx = 0; player.vy = 0;
    player.angle = Math.atan2(climb.dir.y, climb.dir.x);
    deps.setFacingAngle(player.angle);
    deps.setTargetAimAngle(player.angle);
    deps.setLastMoveAngle(player.angle);
    player._climbTargetBranch = null;
    // -1 so updateClimb's hopIndex-change check always fires for hop 0
    // (the very first stagger) instead of only from hop 1 onward.
    player._climbLastHopIndex = -1;
    climbSafetyDebug.lastBlockReason = null;
    climbSafetyDebug.lastBlockRideState = 'none';
    return true;
  }

  // Reuses the exact same scripted hop-lerp crossing as a wall climb — same
  // animation, same stagger cadence — just landing on the branch's base
  // point (offset sideways from the trunk) at the branch's own height
  // instead of a grid tile at a grid elevation tier. That sideways offset
  // from climbStartX/Y (near the trunk, on the ground) to climbEndX/Y (the
  // branch's base) is the "lerp sideways onto it" the branch feature asks
  // for — see updateClimb's completion, which hands off to beginOnBranch.
  function startBranchClimb(branch) {
    const player = deps.player;
    const currentArea = deps.getCurrentArea();
    const grid = deps.getActiveGrid();
    const startCol = Math.floor(player.x / deps.TILE), startRow = Math.floor(player.y / deps.TILE);
    const startTile = grid[startRow]?.[startCol];
    player.climbing = true;
    player.climbElapsed = 0;
    player.climbHopCount = 3;
    player.climbStartX = player.x;
    player.climbStartY = player.y;
    player.climbEndX = branch.baseX;
    player.climbEndY = branch.baseY;
    player.climbSurfaceStartY = startTile ? deps.tileSurfaceYInArea(startTile, currentArea) : 0;
    player.climbSurfaceEndY = branch.baseWorldY;
    player.climbSurfaceY = player.climbSurfaceStartY;
    player.climbHopBounce = 0;
    player.vx = 0; player.vy = 0;
    player.angle = Math.atan2(branch.baseY - player.y, branch.baseX - player.x);
    deps.setFacingAngle(player.angle);
    deps.setTargetAimAngle(player.angle);
    deps.setLastMoveAngle(player.angle);
    player._climbTargetBranch = branch;
    player._climbLastHopIndex = -1;
    climbSafetyDebug.lastBlockReason = null;
    climbSafetyDebug.lastBlockRideState = 'none';
    return true;
  }

  // A quick one-hop vertical drop from the player's current branch point,
  // followed by the existing landing roll in the aimed jump direction.
  const BRANCH_JUMP_LAND_ROLL_S = 0.32;
  function startBranchJumpDown(climb = {}) {
    const player = deps.player;
    const branch = player.onBranch;
    if (!branch) return false;
    const currentArea = deps.getCurrentArea();
    const grid = deps.getActiveGrid();
    const startX = player.x, startY = player.y;
    const col = Math.floor(startX / deps.TILE), row = Math.floor(startY / deps.TILE);
    const groundTile = grid[row]?.[col];
    const axisX = (branch.tipX - branch.baseX) / branch.length;
    const axisY = (branch.tipY - branch.baseY) / branch.length;
    const jumpDir = climb.dir || { x: axisX, y: axisY };
    player.onBranch = null;
    player.climbing = true;
    player.climbElapsed = 0;
    player.climbHopCount = 1;
    player.climbStartX = startX;
    player.climbStartY = startY;
    player.climbEndX = startX;
    player.climbEndY = startY;
    player.climbSurfaceStartY = player.branchSurfaceY ?? (branch.baseWorldY + (branch.tipWorldY - branch.baseWorldY) * (player.branchT ?? 0));
    player.climbSurfaceEndY = groundTile ? deps.tileSurfaceYInArea(groundTile, currentArea) : 0;
    player.climbSurfaceY = player.climbSurfaceStartY;
    player.climbHopBounce = 0;
    player.vx = 0; player.vy = 0;
    player._climbTargetBranch = null;
    player._climbJumpDownAxis = jumpDir;
    player._climbLastHopIndex = -1;
    climbSafetyDebug.lastJumpMode = climb.mode || 'tip';
    climbSafetyDebug.lastBlockReason = null;
    climbSafetyDebug.lastBlockRideState = 'none';
    return true;
  }

  // Snaps an entity onto a branch at fraction t along it (0 = base/trunk end,
  // 1 = tip) and derives its ground-plane position + height from that.
  function beginOnBranch(entity, branch, t) {
    entity.onBranch = branch;
    entity.branchT = deps.clamp(t, 0, 1);
    entity.x = branch.baseX + (branch.tipX - branch.baseX) * entity.branchT;
    entity.y = branch.baseY + (branch.tipY - branch.baseY) * entity.branchT;
    entity.branchSurfaceY = branch.baseWorldY + (branch.tipWorldY - branch.baseWorldY) * entity.branchT;
  }

  // 1D movement while on a branch: only the component of input along the
  // branch's own axis moves the player, and branchT is clamped to [0,1] —
  // there is no way to walk off the end by accident, only get knocked off
  // (see resolveBranchKnockback, driven from game.js's applyKnockback).
  //
  // Reads deps.getMovementInput() rather than player.inputX/Y: those are
  // written later in game.js's updateMovement than the onBranch early-return
  // that reaches here, so by the time this runs this frame they're still
  // last frame's values (stale, often still zero from before the player
  // ever climbed up) — getMovementInput reads the same raw keyboard/stick
  // vector fresh, independent of that write order.
  const BRANCH_WALK_SPEED_PX_S = 90;
  function updateBranchMovement(dt) {
    const player = deps.player;
    const branch = player.onBranch;
    if (!branch) return;
    const axisX = (branch.tipX - branch.baseX) / branch.length;
    const axisY = (branch.tipY - branch.baseY) / branch.length;
    const raw = deps.getMovementInput?.() || { x: 0, y: 0 };
    const rawLen = Math.hypot(raw.x, raw.y);
    const nx = rawLen > 0.001 ? raw.x / rawLen : 0, ny = rawLen > 0.001 ? raw.y / rawLen : 0;
    player.inputX = nx;
    player.inputY = ny;
    player.inputStrength = Math.min(1, rawLen);
    const inputAlong = nx * axisX + ny * axisY;
    if (Math.abs(inputAlong) > 0.001) {
      player.branchT = deps.clamp(player.branchT + (inputAlong * BRANCH_WALK_SPEED_PX_S * dt) / branch.length, 0, 1);
      const dirSign = Math.sign(inputAlong);
      player.angle = Math.atan2(axisY * dirSign, axisX * dirSign);
      deps.setFacingAngle(player.angle);
      deps.setTargetAimAngle(player.angle);
      deps.setLastMoveAngle(player.angle);
    }
    player.x = branch.baseX + (branch.tipX - branch.baseX) * player.branchT;
    player.y = branch.baseY + (branch.tipY - branch.baseY) * player.branchT;
    player.branchSurfaceY = branch.baseWorldY + (branch.tipWorldY - branch.baseWorldY) * player.branchT;
    player.vx = 0; player.vy = 0;
  }

  // Pure branch-axis knockback math, called from game.js's applyKnockback
  // when the target being hit is onBranch. Knockback beyond the branch's own
  // length (t pushed outside [0,1]) sends the target to the ground at
  // whichever end it went past — game.js applies the actual footing damage
  // and clears any lingering combat state, this only resolves position.
  const BRANCH_KNOCKBACK_DUR_S = 0.18; // Mirrors game.js's own KNOCKBACK_DUR_S so a shove off a branch covers the same distance a ground knockback would.
  function resolveBranchKnockback(entity, fromX, fromY, speedPxS) {
    const branch = entity.onBranch;
    if (!branch) return null;
    const axisX = (branch.tipX - branch.baseX) / branch.length;
    const axisY = (branch.tipY - branch.baseY) / branch.length;
    const ang = Math.atan2(entity.y - fromY, entity.x - fromX);
    const alongPx = speedPxS * BRANCH_KNOCKBACK_DUR_S * (Math.cos(ang) * axisX + Math.sin(ang) * axisY);
    const newT = (entity.branchT ?? 0) + alongPx / branch.length;
    if (newT >= 0 && newT <= 1) {
      entity.branchT = newT;
      entity.x = branch.baseX + (branch.tipX - branch.baseX) * newT;
      entity.y = branch.baseY + (branch.tipY - branch.baseY) * newT;
      entity.branchSurfaceY = branch.baseWorldY + (branch.tipWorldY - branch.baseWorldY) * newT;
      return { fell: false };
    }
    const endT = newT < 0 ? 0 : 1;
    const groundX = branch.baseX + (branch.tipX - branch.baseX) * endT;
    const groundY = branch.baseY + (branch.tipY - branch.baseY) * endT;
    entity.onBranch = null;
    entity.branchT = 0;
    entity.x = groundX;
    entity.y = groundY;
    return { fell: true, x: groundX, y: groundY };
  }

  function updateClimb(dt) {
    const player = deps.player;
    const cycle = CLIMB_HOP_ACTIVE_S + CLIMB_HOP_PAUSE_S;
    const totalDur = player.climbHopCount * cycle;
    player.climbElapsed = Math.min(player.climbElapsed + dt, totalDur);
    const hopIndex = Math.min(player.climbHopCount - 1, Math.floor(player.climbElapsed / cycle));
    // One low gravel thud per stagger — each scripted hop up/down the cliff
    // face lands like a foot planting on loose rock, distinct from ordinary
    // footsteps (see playObjectSfx's climbStep cue, pitched well below a
    // normal gravelstep).
    if (hopIndex !== player._climbLastHopIndex) {
      player._climbLastHopIndex = hopIndex;
      window.AudioSystem?.playObjectSfx(window.AudioSystem?.objectSfxConfig().climbStep);
    }
    const withinCycle = player.climbElapsed - hopIndex * cycle;
    const hopActive = withinCycle < CLIMB_HOP_ACTIVE_S;
    const hopLocalT = hopActive ? deps.clamp(withinCycle / CLIMB_HOP_ACTIVE_S, 0, 1) : 1;
    const eased = 1 - Math.pow(1 - hopLocalT, 2); // quick lift-off, settles into each landing
    const overall = deps.clamp((hopIndex + eased) / player.climbHopCount, 0, 1);

    player.x = player.climbStartX + (player.climbEndX - player.climbStartX) * overall;
    player.y = player.climbStartY + (player.climbEndY - player.climbStartY) * overall;
    player.climbSurfaceY = player.climbSurfaceStartY + (player.climbSurfaceEndY - player.climbSurfaceStartY) * overall;
    player.climbHopBounce = hopActive ? Math.sin(hopLocalT * Math.PI) * CLIMB_HOP_BOUNCE_UNITS : 0;
    player.vx = 0; player.vy = 0;

    if (player.climbElapsed >= totalDur) {
      player.x = player.climbEndX;
      player.y = player.climbEndY;
      player.climbSurfaceY = player.climbSurfaceEndY;
      player.climbHopBounce = 0;
      player.climbing = false;
      if (player._climbTargetBranch) {
        const branch = player._climbTargetBranch;
        player._climbTargetBranch = null;
        beginOnBranch(player, branch, 0);
      }
      if (player._climbJumpDownAxis) {
        // Reuses the same tumble/roll movement state an evasive combat
        // dodge uses (see game.js's performDodge), just without its
        // stamina cost, cooldown, or invulnerability window — this is a
        // landing flourish, not an evasive action.
        const axis = player._climbJumpDownAxis;
        player._climbJumpDownAxis = null;
        player.dodging = true;
        player.dodgeT = BRANCH_JUMP_LAND_ROLL_S;
        player.dodgeDirX = axis.x;
        player.dodgeDirY = axis.y;
        player.angle = Math.atan2(axis.y, axis.x);
        deps.setFacingAngle(player.angle);
        deps.setTargetAimAngle(player.angle);
        deps.setLastMoveAngle(player.angle);
      }
    }
  }

  window.ClimbSystem = {
    init,
    getClimbTarget,
    getAimedNest,
    startClimb,
    updateClimb,
    updateBranchMovement,
    resolveBranchKnockback,
    resetAreaBranches,
    registerBranch,
    removeBranchesInBounds,
    debugBranchesFor: (mapId) => (branchesByArea.get(mapId) || []).slice(),
    get debug() {
      return {
        playerClimbing: !!deps?.player?.climbing,
        playerOnBranch: !!deps?.player?.onBranch,
        mountRideState: deps?.getMountRideState?.() || 'none',
        ...climbSafetyDebug,
      };
    },
  };
})();
