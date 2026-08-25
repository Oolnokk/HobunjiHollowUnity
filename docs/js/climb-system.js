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
  const climbSafetyDebug = { lastBlockReason: null, lastBlockRideState: 'none', lastBlockAt: 0 }; // Used by Pixel Probe to expose rejected mounted-climb attempts on mobile.

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

  // Facing + proximity scan against this zone's registered branches — same
  // shape of check as the wall-climb scan above, just angle/distance based
  // instead of tile-wall based since a branch isn't grid-aligned.
  const BRANCH_CLIMB_PROXIMITY_TILES = 1.15;
  const BRANCH_CLIMB_FACING_COS = 0.55; // ~56 degrees either side of dead-on.
  function getBranchClimbTarget() {
    const branches = branchesByArea.get(deps.getCurrentArea());
    if (!branches || !branches.length) return null;
    const player = deps.player;
    const proximityPx = deps.TILE * BRANCH_CLIMB_PROXIMITY_TILES;
    const facingX = Math.cos(player.angle), facingY = Math.sin(player.angle);
    let best = null, bestDist = Infinity;
    for (const branch of branches) {
      const dx = branch.baseX - player.x, dy = branch.baseY - player.y;
      const dist = Math.hypot(dx, dy);
      if (dist > proximityPx || dist < 1 || dist >= bestDist) continue;
      if ((dx * facingX + dy * facingY) / dist < BRANCH_CLIMB_FACING_COS) continue;
      bestDist = dist; best = branch;
    }
    return best ? { type: 'branch', branch: best } : null;
  }

  // Jump-down prompt: only offered once the player has walked out to (near)
  // the branch's tip AND is facing beyond it (roughly along the branch's
  // own outward axis) — reaching the tip mid-branch while still facing back
  // toward the trunk (e.g. after being pushed there) doesn't count. Walking
  // to the tip under normal branch movement naturally faces the player
  // outward already (see updateBranchMovement), so in practice this is just
  // "walk to the end."
  const BRANCH_TIP_T_THRESHOLD = 0.85;
  const BRANCH_JUMP_FACING_COS = 0.7; // ~45 degrees either side of dead-on outward.
  function getClimbTarget() {
    if (!deps._isZoneArea(deps.getCurrentArea())) return null;
    const player = deps.player;
    if (player.onBranch) {
      const branch = player.onBranch;
      if ((player.branchT ?? 0) < BRANCH_TIP_T_THRESHOLD) return null;
      const axisX = (branch.tipX - branch.baseX) / branch.length;
      const axisY = (branch.tipY - branch.baseY) / branch.length;
      const facingX = Math.cos(player.angle), facingY = Math.sin(player.angle);
      if (axisX * facingX + axisY * facingY < BRANCH_JUMP_FACING_COS) return null;
      return { type: 'branchJumpDown' };
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
    if (climb.type === 'branchJumpDown') return startBranchJumpDown();

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

  // Jump down from the tip: a quick single drop (climbHopCount=1, versus 3
  // for a careful climb) straight down to the tip's own ground projection —
  // same X/Y, branch height to terrain height — and then, on landing,
  // updateClimb hands off into a dodge-roll (player._climbJumpDownAxis)
  // instead of just standing. Safe: unlike being knocked off (see
  // resolveBranchKnockback/game.js's applyKnockback), this never deals
  // footing damage.
  const BRANCH_JUMP_LAND_ROLL_S = 0.32;
  function startBranchJumpDown() {
    const player = deps.player;
    const branch = player.onBranch;
    if (!branch) return false;
    const currentArea = deps.getCurrentArea();
    const grid = deps.getActiveGrid();
    const col = Math.floor(branch.tipX / deps.TILE), row = Math.floor(branch.tipY / deps.TILE);
    const groundTile = grid[row]?.[col];
    const axisX = (branch.tipX - branch.baseX) / branch.length;
    const axisY = (branch.tipY - branch.baseY) / branch.length;
    player.onBranch = null;
    player.climbing = true;
    player.climbElapsed = 0;
    player.climbHopCount = 1;
    player.climbStartX = branch.tipX;
    player.climbStartY = branch.tipY;
    player.climbEndX = branch.tipX;
    player.climbEndY = branch.tipY;
    player.climbSurfaceStartY = player.branchSurfaceY ?? branch.tipWorldY;
    player.climbSurfaceEndY = groundTile ? deps.tileSurfaceYInArea(groundTile, currentArea) : 0;
    player.climbSurfaceY = player.climbSurfaceStartY;
    player.climbHopBounce = 0;
    player.vx = 0; player.vy = 0;
    player._climbTargetBranch = null;
    player._climbJumpDownAxis = { x: axisX, y: axisY };
    player._climbLastHopIndex = -1;
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
