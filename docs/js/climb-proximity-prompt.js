// Contextual climb affordance for every target owned by ClimbSystem.
// Exact prompts use ClimbSystem's real target/action APIs; proximity-only hints
// advertise nearby climbable geometry without pretending the climb input will
// work until the player faces/aims at that surface correctly.
(() => {
  'use strict';

  if (window.HobunjiClimbPrompt) return;

  const POLL_MS = 100; // Used to keep structural-roof scene scans responsive without doing them every render frame.
  const ACTION_ID = 'dodge'; // Used because the existing climb action is entered through the dodge/climb input path.
  const PROMPT_ID = 'climbProximityPrompt';
  const STYLE_ID = 'climbProximityPromptStyle';
  const MAX_PLATEAU_WALL_TILES = 4; // Used by proximityPlateau to mirror ClimbSystem's wall-depth limit.
  const BUILDING_NEAR_WORLD = 1.75; // Used by proximityBuilding to mirror roof-climb's player-to-wall range.
  const BRANCH_NEAR_TILES = 1.15; // Used by proximityBranch to mirror ClimbSystem's branch proximity range.

  let currentTarget = null; // Used by the touch/click handler so it executes the same target currently being advertised.
  let lastDebug = {
    visible: false, targetType: null, verb: null, glyph: null,
    actionable: false, proximityOnly: false, reason: 'waiting for climb target',
  }; // Used by getDebug for mobile-visible prompt diagnostics.

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${PROMPT_ID} {
        position: fixed;
        left: 50%;
        bottom: max(110px, 15vh);
        transform: translateX(-50%);
        z-index: 65;
        display: none;
        align-items: center;
        justify-content: center;
        min-width: 150px;
        max-width: min(82vw, 360px);
        padding: 9px 14px;
        border: 1px solid rgba(255,255,255,.28);
        border-radius: 10px;
        background: rgba(10,14,16,.88);
        color: #fff;
        font: 600 14px/1.2 system-ui, sans-serif;
        text-align: center;
        box-shadow: 0 3px 14px rgba(0,0,0,.32);
        backdrop-filter: blur(3px);
        pointer-events: auto;
        touch-action: manipulation;
        user-select: none;
      }
      #${PROMPT_ID}.open { display: flex; }
      #${PROMPT_ID}:disabled {
        opacity: 1;
        cursor: default;
        pointer-events: none;
        border-style: dashed;
      }
    `;
    document.head.appendChild(style);
  }

  function ensurePrompt() {
    let el = document.getElementById(PROMPT_ID);
    if (el) return el;
    ensureStyle();
    el = document.createElement('button');
    el.id = PROMPT_ID;
    el.type = 'button';
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-label', 'Climb');
    el.addEventListener('pointerup', event => {
      event.preventDefault();
      event.stopPropagation();
      activateCurrentTarget();
    });
    document.body.appendChild(el);
    return el;
  }

  function uiBlocksPrompt() {
    return !!(window.PlayerChat?.isOpen
      || document.getElementById('npcDialogue')?.classList?.contains('open')
      || document.getElementById('menuPanel')?.classList?.contains('open'));
  }

  function targetVerb(target) {
    if (target?.type === 'roof') return 'Climb Building';
    if (target?.type === 'wall') return 'Climb Plateau';
    if (target?.type === 'branch') return 'Climb Branch';
    if (target?.type === 'branchJumpDown') return 'Jump Down';
    return 'Climb';
  }

  function proximityVerb(candidate) {
    if (candidate?.type === 'roof') return 'Climb Building — face wall';
    if (candidate?.type === 'wall') return 'Climb Plateau — face cliff';
    if (candidate?.type === 'branch') return 'Climb Branch — look at branch';
    return 'Climb — face surface';
  }

  function currentGlyph() {
    try {
      return window.ActionPromptUI?.actionPromptGlyph?.(ACTION_ID, '🧗') || 'Climb';
    } catch (_) {
      return 'Climb';
    }
  }

  function mountedTargetUnavailable(target) {
    const rideState = window.ClimbSystem?.debug?.mountRideState || 'none';
    if (rideState === 'none') return false;
    // Wall targets intentionally remain available because mounted plateau climbs
    // delegate to Mounts.startClimbLeap. Branches and roofs still require dismounting.
    return target?.type !== 'wall';
  }

  function combatDeps() {
    return window.Combat?.deps || null;
  }

  function activeGrid() {
    try { return window.GridTileAccessors?.getActiveGrid?.() || combatDeps()?.getActiveGrid?.() || null; }
    catch (_) { return null; }
  }

  function tileSize() {
    return Math.max(1, Number(combatDeps()?.TILE) || 64);
  }

  function proximityPlateau(player) {
    const grid = activeGrid();
    if (!Array.isArray(grid) || !grid.length || !player) return null;
    const tile = tileSize();
    const startCol = Math.floor((Number(player.x) || 0) / tile);
    const startRow = Math.floor((Number(player.y) || 0) / tile);
    const startTile = grid[startRow]?.[startCol];
    if (!startTile || startTile.incline) return null;
    const startTier = Number(startTile.elevTier) || 0;
    const dirs = [
      { x: 1, y: 0 }, { x: -1, y: 0 },
      { x: 0, y: 1 }, { x: 0, y: -1 },
    ];
    const solid = combatDeps()?.isSolid;

    for (const dir of dirs) {
      let col = startCol;
      let row = startRow;
      let wallTiles = 0;
      for (let step = 0; step < MAX_PLATEAU_WALL_TILES; step++) {
        col += dir.x;
        row += dir.y;
        const candidate = grid[row]?.[col];
        if (!candidate) break;
        if (candidate.incline) {
          wallTiles++;
          continue;
        }
        if (!wallTiles) break;
        if (typeof solid === 'function' && solid(candidate.type)) break;
        const landTier = Number(candidate.elevTier) || 0;
        if (landTier !== startTier) {
          return { type: 'wall', dir, wallTiles, startTier, landTier, landCol: col, landRow: row };
        }
        break;
      }
    }
    return null;
  }

  function pointSegmentDistance2D(px, pz, a, b) {
    const ax = Number(a?.x) || 0, az = Number(a?.z) || 0;
    const bx = Number(b?.x) || 0, bz = Number(b?.z) || 0;
    const dx = bx - ax, dz = bz - az;
    const lenSq = dx * dx + dz * dz;
    if (lenSq <= 1e-10) return Math.hypot(px - ax, pz - az);
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lenSq));
    return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
  }

  function wallDistance2D(px, pz, wall) {
    const vertices = Array.isArray(wall?.vertices) ? wall.vertices : [];
    if (vertices.length < 2) return Infinity;
    let best = Infinity;
    for (let i = 0; i < vertices.length; i++) {
      const a = vertices[i];
      const b = vertices[(i + 1) % vertices.length];
      best = Math.min(best, pointSegmentDistance2D(px, pz, a, b));
    }
    return best;
  }

  function proximityBuilding(player) {
    if (!player) return null;
    const scene = window.GridTileAccessors?.getActiveScene?.();
    if (!scene?.traverse) return null;
    const tile = tileSize();
    const px = (Number(player.x) || 0) / tile;
    const pz = (Number(player.y) || 0) / tile;
    let best = null;
    scene.traverse(object => {
      const meta = object?.userData?.hobunjiRoofClimbStructure;
      if (!meta?.walls?.length || !meta?.roofs?.length) return;
      for (const wall of meta.walls) {
        const distanceWorld = wallDistance2D(px, pz, wall);
        if (distanceWorld > BUILDING_NEAR_WORLD || (best && distanceWorld >= best.distanceWorld)) continue;
        best = { type: 'roof', distanceWorld, wallFaceId: wall.id ?? null, buildingId: meta.buildingId || null };
      }
    });
    return best;
  }

  function proximityBranch(player) {
    if (!player || !window.ClimbSystem?.debugBranchesFor) return null;
    const area = window.GridTileAccessors?.getCurrentArea?.();
    if (!area) return null;
    const tile = tileSize();
    let best = null;
    for (const branch of window.ClimbSystem.debugBranchesFor(area) || []) {
      if (!branch || branch.felled) continue;
      const distanceTiles = Math.hypot((Number(branch.baseX) || 0) - (Number(player.x) || 0), (Number(branch.baseY) || 0) - (Number(player.y) || 0)) / tile;
      if (distanceTiles > BRANCH_NEAR_TILES || (best && distanceTiles >= best.distanceTiles)) continue;
      best = { type: 'branch', distanceTiles, branchId: branch.id || null };
    }
    return best;
  }

  function nearestProximityHint(player) {
    const building = proximityBuilding(player);
    const plateau = proximityPlateau(player);
    const branch = proximityBranch(player);
    // Building distance and branch distance are already in tile/world-scale units;
    // plateau adjacency is effectively zero-distance because its first incline
    // cell must touch the player's current tile. Prefer it when present.
    if (plateau) return plateau;
    if (building && branch) return building.distanceWorld <= branch.distanceTiles ? building : branch;
    return building || branch || null;
  }

  function hide(reason = 'no climb target') {
    currentTarget = null;
    const el = document.getElementById(PROMPT_ID);
    if (el) el.disabled = false;
    el?.classList?.remove('open');
    lastDebug = {
      visible: false, targetType: null, verb: null, glyph: null,
      actionable: false, proximityOnly: false, reason,
    };
  }

  function renderPrompt(candidate, actionable) {
    const el = ensurePrompt();
    const glyph = currentGlyph();
    const verb = actionable ? targetVerb(candidate) : proximityVerb(candidate);
    const touch = window.ActionPromptUI?.getLastInputDevice?.() === 'touch';
    el.textContent = touch ? `${glyph} ${verb}` : `[${glyph}] ${verb}`;
    el.dataset.targetType = candidate.type || 'climb';
    el.dataset.actionable = actionable ? 'true' : 'false';
    el.disabled = !actionable;
    el.setAttribute('aria-label', verb);
    el.classList.add('open');
    currentTarget = actionable ? candidate : null;
    lastDebug = {
      visible: true,
      targetType: candidate.type || null,
      verb,
      glyph,
      actionable,
      proximityOnly: !actionable,
      reason: actionable ? 'climb target available' : 'near climbable surface; align to climb',
    };
    return actionable ? candidate : null;
  }

  function refresh() {
    const system = window.ClimbSystem;
    const player = combatDeps()?.player;
    if (!system?.getClimbTarget || !system?.startClimb) return hide('ClimbSystem unavailable');
    if (uiBlocksPrompt()) return hide('UI blocks world prompts');
    if (player?._hobunjiFallState || player?.climbing || player?.prone || player?.dodging || player?.lunging) {
      return hide('player is in another movement state');
    }

    let target = null;
    try { target = system.getClimbTarget(); }
    catch (error) { return hide(`target error: ${error?.message || error}`); }
    if (target && !mountedTargetUnavailable(target)) return renderPrompt(target, true);

    const nearby = nearestProximityHint(player);
    if (!nearby) return hide(target ? 'target requires dismounting' : 'no climbable surface nearby');
    if (mountedTargetUnavailable(nearby)) return hide('nearby climbable surface requires dismounting');
    return renderPrompt(nearby, false);
  }

  function activateCurrentTarget() {
    const system = window.ClimbSystem;
    if (!system?.startClimb || !currentTarget) return false;
    // Re-resolve on press so a prompt cannot execute stale geometry after the
    // player turns, a streamed chunk changes, or a building target disappears.
    let target = null;
    try { target = system.getClimbTarget(); }
    catch (_) { return false; }
    if (!target || mountedTargetUnavailable(target)) return false;
    const started = !!system.startClimb(target);
    if (started) hide('climb started');
    return started;
  }

  const pollId = typeof window.setInterval === 'function'
    ? window.setInterval(refresh, POLL_MS)
    : 0; // Used by getDebug to confirm that proximity prompting is actively polling.

  window.HobunjiClimbPrompt = Object.freeze({
    refresh,
    activateCurrentTarget,
    getDebug() {
      return {
        ...lastDebug,
        pollRunning: !!pollId,
        pollMs: POLL_MS,
        actionId: ACTION_ID,
        buildingNearWorld: BUILDING_NEAR_WORLD,
        branchNearTiles: BRANCH_NEAR_TILES,
      };
    },
  });
})();
