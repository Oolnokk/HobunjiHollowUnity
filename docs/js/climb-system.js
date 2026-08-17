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

  const CLIMB_MAX_WALL_TILES = 4;
  function getClimbTarget() {
    if (!deps._isZoneArea(deps.getCurrentArea())) return null;
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
        return { dir, landCol: col, landRow: row, startElevTier, landElevTier: t.elevTier || 0, wallTiles };
      }
      wallTiles++;
    }
    return null;
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
    // -1 so updateClimb's hopIndex-change check always fires for hop 0
    // (the very first stagger) instead of only from hop 1 onward.
    player._climbLastHopIndex = -1;
    climbSafetyDebug.lastBlockReason = null;
    climbSafetyDebug.lastBlockRideState = 'none';
    return true;
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
    }
  }

  window.ClimbSystem = {
    init,
    getClimbTarget,
    startClimb,
    updateClimb,
    get debug() {
      return {
        playerClimbing: !!deps?.player?.climbing,
        mountRideState: deps?.getMountRideState?.() || 'none',
        ...climbSafetyDebug,
      };
    },
  };
})();
