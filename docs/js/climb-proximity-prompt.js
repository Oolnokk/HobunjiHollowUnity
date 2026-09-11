// Adds climb rows to the game's existing WorldPopupText interaction-prompt list.
// No separate HUD/DOM popup is created here: this only augments the same
// world-space prompt system already used by NPCs, objects, nests, doors, etc.
(() => {
  'use strict';

  if (window.HobunjiClimbPrompt) return;

  const ACTION_ID = 'dodge'; // Used because climbing is triggered by the existing Dodge/climb input.
  const CLIMB_ACTION = 'climb_branch'; // Existing game.js semantic action; already excluded from Action 1 and mapped to Dodge in prompt coloring.
  const MAX_PLATEAU_WALL_TILES = 4; // Used by proximityPlateau to mirror ClimbSystem's wall-depth limit.
  const BRANCH_NEAR_TILES = 1.15; // Used by proximityBranch to mirror ClimbSystem's branch proximity range.

  let climbAnchor = null; // Used as the ordinary WorldPopupText root when climbing is the only nearby world interaction.
  let popupPatched = false; // Used by getDebug to verify this bridge is augmenting the existing popup pipeline.
  let lastDebug = {
    visible: false,
    targetType: null,
    actionable: false,
    label: null,
    reason: 'waiting for world interaction prompt sync',
  }; // Used by Pixel Probe/mobile diagnostics without introducing another visible UI surface.

  const combatDeps = () => window.Combat?.deps || null;
  const tileSize = () => Math.max(1, Number(combatDeps()?.TILE) || 64);

  function activeGrid() {
    try { return window.GridTileAccessors?.getActiveGrid?.() || combatDeps()?.getActiveGrid?.() || null; }
    catch (_) { return null; }
  }

  function movementStateBlocksPrompt(player) {
    return !!(player?._hobunjiFallState || player?.climbing || player?.prone || player?.dodging || player?.lunging);
  }

  function mountedTargetUnavailable(target) {
    const rideState = window.ClimbSystem?.debug?.mountRideState || window.Mounts?.rideState || 'none';
    if (rideState === 'none') return false;
    // Plateau wall climbs intentionally remain available because startClimb
    // delegates those to the existing mounted leap. Roofs/branches do not.
    return target?.type !== 'wall';
  }

  function proximityPlateau(player) {
    const area = window.GridTileAccessors?.getCurrentArea?.();
    const isZoneArea = combatDeps()?._isZoneArea;
    if (typeof isZoneArea === 'function' && !isZoneArea(area)) return null;
    const grid = activeGrid();
    if (!Array.isArray(grid) || !grid.length || !player) return null;
    const tile = tileSize();
    const startCol = Math.floor((Number(player.x) || 0) / tile);
    const startRow = Math.floor((Number(player.y) || 0) / tile);
    const startTile = grid[startRow]?.[startCol];
    if (!startTile || startTile.incline) return null;
    const startTier = Number(startTile.elevTier) || 0;
    const solid = combatDeps()?.isSolid;
    const dirs = [
      { x: 1, y: 0 }, { x: -1, y: 0 },
      { x: 0, y: 1 }, { x: 0, y: -1 },
    ];

    for (const dir of dirs) {
      let col = startCol;
      let row = startRow;
      let wallTiles = 0;
      for (let step = 0; step < MAX_PLATEAU_WALL_TILES; step++) {
        col += dir.x;
        row += dir.y;
        const candidate = grid[row]?.[col];
        if (!candidate) break;
        if (candidate.incline) { wallTiles++; continue; }
        if (!wallTiles) break;
        if (typeof solid === 'function' && solid(candidate.type)) break;
        const landTier = Number(candidate.elevTier) || 0;
        if (landTier !== startTier) {
          return {
            type: 'wall', dir, wallTiles, startTier, landTier,
            landCol: col, landRow: row, proximityOnly: true,
          };
        }
        break;
      }
    }
    return null;
  }

  function proximityBranch(player) {
    if (!player || !window.ClimbSystem?.debugBranchesFor) return null;
    const area = window.GridTileAccessors?.getCurrentArea?.();
    if (!area) return null;
    const tile = tileSize();
    let best = null;
    for (const branch of window.ClimbSystem.debugBranchesFor(area) || []) {
      if (!branch || branch.felled) continue;
      const distanceTiles = Math.hypot(
        (Number(branch.baseX) || 0) - (Number(player.x) || 0),
        (Number(branch.baseY) || 0) - (Number(player.y) || 0),
      ) / tile;
      if (distanceTiles > BRANCH_NEAR_TILES || (best && distanceTiles >= best.distanceTiles)) continue;
      best = { type: 'branch', branch, distanceTiles, proximityOnly: true };
    }
    return best;
  }

  function resolveCandidate() {
    const system = window.ClimbSystem;
    const player = combatDeps()?.player;
    if (!system?.getClimbTarget || !player || movementStateBlocksPrompt(player)) return null;

    let exact = null;
    try { exact = system.getClimbTarget(); } catch (_) {}
    if (exact && !mountedTargetUnavailable(exact)) return { ...exact, actionable: true };
    if (player.onBranch) return null;

    const plateau = proximityPlateau(player);
    if (plateau && !mountedTargetUnavailable(plateau)) return { ...plateau, actionable: false };
    const branch = proximityBranch(player);
    if (branch && !mountedTargetUnavailable(branch)) return { ...branch, actionable: false };
    return null;
  }

  function candidateLabel(candidate) {
    if (candidate.type === 'roof') return 'Climb Building';
    if (candidate.type === 'wall') return candidate.actionable ? 'Climb Plateau' : 'Face Cliff to Climb';
    if (candidate.type === 'branchJumpDown') return 'Climb Down';
    if (candidate.type === 'branch') return candidate.actionable ? 'Climb Tree' : 'Look at Tree to Climb';
    return 'Climb';
  }

  function ensureAnchor(candidate) {
    const deps = combatDeps();
    const player = deps?.player;
    const THREE = window.THREE || deps?.THREE;
    if (!player || !THREE?.Object3D) return null;
    if (!climbAnchor) {
      climbAnchor = new THREE.Object3D();
      climbAnchor.name = 'climb_world_interaction_prompt_anchor';
    }

    const tile = tileSize();
    let x = (Number(player.x) || 0) / tile;
    let z = (Number(player.y) || 0) / tile;
    let y = Number(deps?.worldSurfaceY?.(player.x, player.y)) || 0;
    y += 1.15;

    if (candidate.type === 'roof' && candidate.wallPoint) {
      x = Number(candidate.wallPoint.x) || x;
      z = Number(candidate.wallPoint.z) || z;
      y = Math.max(y, (Number(candidate.wallPoint.y) || 0) + 0.55);
    } else if (candidate.type === 'wall' && candidate.dir) {
      x += (Number(candidate.dir.x) || 0) * 0.75;
      z += (Number(candidate.dir.y) || 0) * 0.75;
    } else if (candidate.branch) {
      x = ((Number(candidate.branch.baseX) || 0) + (Number(candidate.branch.tipX) || 0)) / (2 * tile);
      z = ((Number(candidate.branch.baseY) || 0) + (Number(candidate.branch.tipY) || 0)) / (2 * tile);
      y = Math.max(Number(candidate.branch.baseWorldY) || 0, Number(candidate.branch.tipWorldY) || 0) + 0.4;
    }

    climbAnchor.position.set(x, y, z);
    return climbAnchor;
  }

  function inputDescriptor() {
    let label = 'Dodge';
    let color = '#B8C5C0';
    try { label = window.ActionPromptUI?.actionPromptGlyph?.(ACTION_ID, 'Dodge') || label; } catch (_) {}
    try { color = window.ActionPromptUI?.actionPromptColor?.(ACTION_ID) || color; } catch (_) {}
    return { actionId: ACTION_ID, label, color };
  }

  function patchWorldPopupText(api) {
    if (!api?.syncInteractionPrompts || api.syncInteractionPrompts.__hobunjiClimbPromptInjected) return false;
    const original = api.syncInteractionPrompts.bind(api);

    function syncInteractionPromptsWithClimb(options = {}) {
      const buttons = Array.isArray(options.buttons) ? options.buttons.slice() : [];
      const promptInputs = Array.isArray(options.promptInputs) ? options.promptInputs.slice() : [];
      const alreadyHasClimb = buttons.some(button => button?.action === CLIMB_ACTION);
      const alreadyHasWorldInteraction = buttons.some(button => button?.worldInteraction);
      const candidate = options.enabled === false || alreadyHasClimb ? null : resolveCandidate();

      if (!candidate || alreadyHasWorldInteraction) {
        lastDebug = {
          visible: alreadyHasClimb,
          targetType: alreadyHasClimb ? 'existing-game-climb-row' : null,
          actionable: alreadyHasClimb,
          label: alreadyHasClimb ? 'existing climb row' : null,
          reason: alreadyHasClimb
            ? 'game.js already supplied the climb interaction row'
            : alreadyHasWorldInteraction
              ? 'another world interaction owns the popup list'
              : 'no nearby climb candidate',
        };
        return original(options);
      }

      const label = candidateLabel(candidate);
      buttons.push({
        icon: candidate.type === 'branchJumpDown' ? '🪂' : '🧗',
        label,
        action: CLIMB_ACTION,
        style: 'secondary',
        allowed: true,
        worldInteraction: true,
      });
      promptInputs.push(inputDescriptor());
      const root = ensureAnchor(candidate) || options.root;
      lastDebug = {
        visible: true,
        targetType: candidate.type || null,
        actionable: !!candidate.actionable,
        label,
        reason: candidate.actionable ? 'real ClimbSystem target' : 'nearby climbable surface',
      };
      return original({ ...options, buttons, promptInputs, root });
    }

    Object.assign(syncInteractionPromptsWithClimb, api.syncInteractionPrompts);
    syncInteractionPromptsWithClimb.__hobunjiClimbPromptInjected = true;
    api.syncInteractionPrompts = syncInteractionPromptsWithClimb;
    popupPatched = true;
    return true;
  }

  function chainFutureWorldPopup() {
    if (patchWorldPopupText(window.WorldPopupText)) return;
    const descriptor = Object.getOwnPropertyDescriptor(window, 'WorldPopupText');
    if (descriptor && descriptor.configurable === false) return;
    if (descriptor && typeof descriptor.set === 'function') {
      const priorGet = descriptor.get;
      const priorSet = descriptor.set;
      Object.defineProperty(window, 'WorldPopupText', {
        configurable: true,
        enumerable: descriptor.enumerable !== false,
        get() { return priorGet ? priorGet.call(window) : undefined; },
        set(value) {
          priorSet.call(window, value);
          patchWorldPopupText(priorGet ? priorGet.call(window) : value);
        },
      });
      return;
    }
    let value = descriptor?.value;
    Object.defineProperty(window, 'WorldPopupText', {
      configurable: true,
      enumerable: true,
      get() { return value; },
      set(next) { value = next; patchWorldPopupText(next); },
    });
  }

  chainFutureWorldPopup();

  window.HobunjiClimbPrompt = Object.freeze({
    patchWorldPopupText,
    resolveCandidate,
    getDebug() {
      return {
        ...lastDebug,
        popupPatched,
        actionId: ACTION_ID,
        usesWorldPopupText: true,
        branchNearTiles: BRANCH_NEAR_TILES,
      };
    },
  });
})();
