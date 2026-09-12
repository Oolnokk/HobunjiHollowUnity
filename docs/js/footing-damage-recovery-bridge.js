// Footing damage scaling, recovery grace, and high-surface fall impacts.
(() => {
  'use strict';

  const RS = window.ResourceSystem;
  if (!RS?.spendFooting || !RS?.tick || RS.__footingDamageRecoveryBridgeInstalled) return;
  RS.__footingDamageRecoveryBridgeInstalled = true;

  const FOOTING_DAMAGE_MULTIPLIER = 2;
  const FOOTING_RECOVERY_DELAY_S = 1.5;
  const FOOTING_FULL_RECOVERY_S = 3;
  const nowMs = () => performance.now();

  function recoveryDelayRemaining(entity) {
    const lastDamageAt = Number(entity?.lastFootingDamageAt);
    if (!Number.isFinite(lastDamageAt)) return 0;
    return Math.max(0, FOOTING_RECOVERY_DELAY_S - Math.max(0, (nowMs() - lastDamageAt) / 1000));
  }

  function defaultFootingRegenPerSec(entity) {
    const maxFooting = Math.max(0, Number(entity?.maxFooting) || 0); // Used to keep empty-to-full baseline recovery at three seconds.
    return maxFooting / FOOTING_FULL_RECOVERY_S;
  }

  const previousSpendFooting = RS.spendFooting.bind(RS);
  RS.spendFooting = function doubledFootingDamage(entity, amount, reason = 'hit') {
    if (entity?.prone) return 0;
    const requested = Math.max(0, Number(amount) || 0) * FOOTING_DAMAGE_MULTIPLIER;
    const spent = previousSpendFooting(entity, requested, reason);
    if (spent > 0) entity.lastFootingDamageAt = nowMs();
    return spent;
  };

  const previousTick = RS.tick.bind(RS);
  RS.tick = function delayedFootingRecoveryTick(entity, dt, options = {}) {
    const explicitRate = Number(options.footingRegenPerSec); // Used to preserve encounter-specific recovery overrides.
    const footingRegenPerSec = recoveryDelayRemaining(entity) > 0
      ? 0
      : (Number.isFinite(explicitRate) ? Math.max(0, explicitRate) : defaultFootingRegenPerSec(entity));
    return previousTick(entity, dt, { ...options, footingRegenPerSec });
  };

  window.HobunjiFootingDamageRecovery = Object.freeze({
    damageMultiplier: FOOTING_DAMAGE_MULTIPLIER,
    recoveryDelaySeconds: FOOTING_RECOVERY_DELAY_S,
    fullRecoverySeconds: FOOTING_FULL_RECOVERY_S,
    recoveryDelayRemaining,
    defaultFootingRegenPerSec,
    getDebug(entity = window.Combat?.deps?.player) {
      return {
        damageMultiplier: FOOTING_DAMAGE_MULTIPLIER,
        recoveryDelaySeconds: FOOTING_RECOVERY_DELAY_S,
        fullRecoverySeconds: FOOTING_FULL_RECOVERY_S,
        defaultFootingRegenPerSec: defaultFootingRegenPerSec(entity),
        recoveryDelayRemaining: recoveryDelayRemaining(entity),
        lastFootingDamageAt: Number.isFinite(Number(entity?.lastFootingDamageAt)) ? Number(entity.lastFootingDamageAt) : null,
      };
    },
  });

  // Plateau/high-platform fall extension. Plateau cliffs already use one or
  // more impassable incline cells between discrete elevTier surfaces. Normal
  // movement remains blocked uphill; only a high-to-low crossing can fall.
  const FALL_MAX_WALL_TILES = 4;
  const FALL_EDGE_TRIGGER_TILES = 0.34;
  const FALL_MIN_DROP_WORLD = 0.22;
  const FALL_MIN_DURATION_S = 0.34;
  const FALL_MAX_DURATION_S = 0.88;
  const HARD_FOOTING_BASE = 35; // Used by footingCostForDrop: 70 after the existing x2 Footing bridge.
  const HARD_FOOTING_PER_EXTRA_TIER = 6.25;
  const HARD_FOOTING_CAP = 47.5;
  const ROLL_FOOTING_BASE = 12.5; // Used by footingCostForDrop: 25 after the existing x2 Footing bridge.
  const ROLL_FOOTING_PER_EXTRA_TIER = 3.75;
  const ROLL_FOOTING_CAP = 22.5;
  const LANDING_ROLL_S = 0.32;
  const FALL_INTENT_MIN = 0.12;

  let climbHookInstalled = false; // Used to wrap ClimbSystem.updateClimb exactly once.
  let watchRaf = 0; // Used to expose whether automatic cliff-edge watching is alive.
  const fallDebug = { active: false, candidate: null, lastStarted: null, lastLanding: null }; // Used by getDebug for mobile-visible diagnostics.
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const lerp = (a, b, t) => a + (b - a) * t;
  const runtimeDeps = () => window.Combat?.deps || null;

  function uiBlocksMovement() {
    return !!(window.PlayerChat?.isOpen
      || document.getElementById('npcDialogue')?.classList.contains('open')
      || document.getElementById('menuPanel')?.classList.contains('open'));
  }

  function movementIntent(player) {
    const inputX = Number(player?.inputX) || 0; // Used as the normal movement loop's already-resolved world X input.
    const inputY = Number(player?.inputY) || 0; // Used as the normal movement loop's already-resolved world Y input.
    const inputLen = Math.hypot(inputX, inputY);
    if (inputLen >= FALL_INTENT_MIN) return { active: true, x: inputX / inputLen, y: inputY / inputLen };
    const vx = Number(player?.vx) || 0; // Used as a fallback when cliff collision stops position but velocity still records committed movement.
    const vy = Number(player?.vy) || 0;
    const speed = Math.hypot(vx, vy);
    return speed >= 1 ? { active: true, x: vx / speed, y: vy / speed } : { active: false, x: 0, y: 0 };
  }

  function candidateCardinals(intent) {
    const out = []; // Used to check the dominant side first when approaching a cliff corner diagonally.
    if (Math.abs(intent.x) >= FALL_INTENT_MIN) out.push({ x: Math.sign(intent.x), y: 0, weight: Math.abs(intent.x) });
    if (Math.abs(intent.y) >= FALL_INTENT_MIN) out.push({ x: 0, y: Math.sign(intent.y), weight: Math.abs(intent.y) });
    return out.sort((a, b) => b.weight - a.weight);
  }

  function nearDepartureEdge(player, tileSize, col, row, dir) {
    const localX = (Number(player.x) || 0) / tileSize - col; // Used to measure distance from the player's center to the X tile edges.
    const localY = (Number(player.y) || 0) / tileSize - row; // Used to measure distance from the player's center to the Y tile edges.
    if (dir.x > 0) return 1 - localX <= FALL_EDGE_TRIGGER_TILES;
    if (dir.x < 0) return localX <= FALL_EDGE_TRIGGER_TILES;
    if (dir.y > 0) return 1 - localY <= FALL_EDGE_TRIGGER_TILES;
    return dir.y < 0 && localY <= FALL_EDGE_TRIGGER_TILES;
  }

  function downhillTarget(deps, player, dir) {
    const grid = deps?.getActiveGrid?.(); // Used to follow the live exterior grid, including merged plateau submaps.
    const tileSize = Number(deps?.TILE) || 0; // Used to convert the player pixel position into terrain cells.
    if (!grid || !(tileSize > 0)) return null;
    const startCol = Math.floor((Number(player.x) || 0) / tileSize);
    const startRow = Math.floor((Number(player.y) || 0) / tileSize);
    const startTile = grid[startRow]?.[startCol]; // Used to establish the departure elevation tier.
    if (!startTile || startTile.incline || !nearDepartureEdge(player, tileSize, startCol, startRow, dir)) return null;
    const startTier = Number(startTile.elevTier) || 0; // Used to enforce downhill-only accidental crossings.
    let col = startCol;
    let row = startRow;
    let wallTiles = 0; // Used to require a real incline wall rather than ordinary lower terrain.

    for (let step = 0; step < FALL_MAX_WALL_TILES; step++) {
      col += dir.x;
      row += dir.y;
      const tile = grid[row]?.[col]; // Used as either another cliff-face cell or the first landing-side cell.
      if (!tile) return null;
      if (tile.incline) { wallTiles++; continue; }
      if (wallTiles === 0 || deps.isSolid?.(tile.type)) return null;
      const landTier = Number(tile.elevTier) || 0;
      if (landTier >= startTier) return null;
      const endX = (col + 0.5) * tileSize; // Used as the stable player center after landing.
      const endY = (row + 0.5) * tileSize;
      if (typeof deps.canPlayerOccupy === 'function' && !deps.canPlayerOccupy(endX, endY)) return null;
      return {
        startCol, startRow, landCol: col, landRow: row, startTier, landTier,
        tierDrop: Math.max(1, startTier - landTier), wallTiles,
        dir: { x: dir.x, y: dir.y }, endX, endY,
      };
    }
    return null;
  }

  function footingCostForDrop(tierDrop, rolling) {
    const extra = Math.max(0, Math.floor(Number(tierDrop) || 1) - 1); // Used to make taller drops hurt more while keeping one-tier tuning readable.
    return rolling
      ? Math.min(ROLL_FOOTING_CAP, ROLL_FOOTING_BASE + extra * ROLL_FOOTING_PER_EXTRA_TIER)
      : Math.min(HARD_FOOTING_CAP, HARD_FOOTING_BASE + extra * HARD_FOOTING_PER_EXTRA_TIER);
  }

  function beginFall(options = {}) {
    const deps = options.deps || runtimeDeps(); // Used to resolve the default player and current surface-height helpers.
    const player = options.entity || deps?.player; // Used as the entity being transitioned to the lower surface.
    if (!player || player.prone || player.climbing || player.onBranch) return false;
    const endX = Number(options.endX); // Used as the horizontal landing target.
    const endY = Number(options.endY);
    if (!Number.isFinite(endX) || !Number.isFinite(endY)) return false;
    const startSurfaceY = Number.isFinite(Number(options.startSurfaceY))
      ? Number(options.startSurfaceY) : Number(window.ClimbSystem?.groundYAt?.(player.x, player.y));
    const endSurfaceY = Number.isFinite(Number(options.endSurfaceY))
      ? Number(options.endSurfaceY) : Number(window.ClimbSystem?.groundYAt?.(endX, endY));
    const dropWorld = startSurfaceY - endSurfaceY; // Used to reject tiny discontinuities and set airtime.
    if (!Number.isFinite(dropWorld) || dropWorld < FALL_MIN_DROP_WORLD) return false;
    const rawDirX = Number(options.dir?.x) || 0;
    const rawDirY = Number(options.dir?.y) || 0;
    const dirLen = Math.hypot(rawDirX, rawDirY);
    const dir = dirLen > 0.001
      ? { x: rawDirX / dirLen, y: rawDirY / dirLen }
      : { x: Math.cos(Number(player.angle) || 0), y: Math.sin(Number(player.angle) || 0) };
    const tierDrop = Math.max(1, Math.floor(Number(options.tierDrop) || 1)); // Used to scale impact Footing loss.
    const rolling = options.rolling !== false; // Used to choose the reduced impact and existing tumble state.
    const state = {
      elapsed: 0,
      duration: clamp(0.28 + Math.sqrt(Math.max(0, dropWorld)) * 0.18, FALL_MIN_DURATION_S, FALL_MAX_DURATION_S),
      startX: Number(player.x) || 0,
      startY: Number(player.y) || 0,
      endX, endY, startSurfaceY, endSurfaceY, dropWorld, tierDrop, dir, rolling,
      source: options.source || 'surface fall',
    }; // Stored on the player so the normal ClimbSystem update call can advance this temporary vertical movement.

    player._hobunjiFallState = state;
    player.climbing = true;
    player.climbSurfaceY = startSurfaceY;
    player.climbHopBounce = 0;
    player.vx = 0;
    player.vy = 0;
    player.angle = Math.atan2(dir.y, dir.x);
    fallDebug.active = true;
    fallDebug.lastStarted = { source: state.source, dropWorld, tierDrop, rolling, at: Date.now() };
    window.__farmLog?.(`[fall] ${state.source}: ${tierDrop} tier(s), rolling=${rolling}`, 'combat');
    return true;
  }

  function finishFall(player, state) {
    player.x = state.endX;
    player.y = state.endY;
    player.climbSurfaceY = state.endSurfaceY;
    player.climbHopBounce = 0;
    player.climbing = false;
    player._hobunjiFallState = null;
    const requestedFooting = footingCostForDrop(state.tierDrop, state.rolling); // Sent through spendFooting so perks, x2 scaling, and recovery delay remain authoritative.
    const spentFooting = RS.spendFooting(player, requestedFooting, state.rolling ? 'rolling fall landing' : 'hard fall landing');

    if (state.rolling && !player.prone) {
      // Same landing flourish already used by branch jump-down: movement only,
      // with no stamina charge, dodge cooldown, or new invulnerability window.
      player.dodging = true;
      player.dodgeT = LANDING_ROLL_S;
      player.dodgeDirX = state.dir.x;
      player.dodgeDirY = state.dir.y;
      player.angle = Math.atan2(state.dir.y, state.dir.x);
    }

    fallDebug.active = false;
    fallDebug.lastLanding = {
      source: state.source, tierDrop: state.tierDrop, dropWorld: state.dropWorld,
      rolling: state.rolling, requestedFooting, spentFooting,
      remainingFooting: Number(player.footing), at: Date.now(),
    };
    window.__farmLog?.(`[fall] landed rolling=${state.rolling}; footing=${spentFooting}`, 'combat');
  }

  function updateFall(player, dt) {
    const state = player?._hobunjiFallState; // Used as the authoritative in-flight state created by beginFall.
    if (!state) return false;
    state.elapsed = Math.min(state.duration, state.elapsed + clamp(Number(dt) || 0, 0, 0.1));
    const t = state.duration > 0 ? clamp(state.elapsed / state.duration, 0, 1) : 1; // Used for horizontal carry and accelerated vertical descent.
    const horizontalT = 1 - Math.pow(1 - t, 1.35);
    const verticalT = t * t;
    player.x = lerp(state.startX, state.endX, horizontalT);
    player.y = lerp(state.startY, state.endY, horizontalT);
    player.climbSurfaceY = lerp(state.startSurfaceY, state.endSurfaceY, verticalT);
    player.climbHopBounce = 0;
    player.vx = 0;
    player.vy = 0;
    if (t >= 1) finishFall(player, state);
    return true;
  }

  function installClimbHook() {
    const system = window.ClimbSystem; // Used to share the existing game-loop call that already owns temporary vertical movement.
    if (climbHookInstalled || !system?.updateClimb) return climbHookInstalled;
    const previousUpdateClimb = system.updateClimb.bind(system); // Used for every normal wall/tree climb when no fall is active.
    system.updateClimb = function footingAwareFallUpdate(dt) {
      const player = runtimeDeps()?.player;
      return player?._hobunjiFallState ? updateFall(player, dt) : previousUpdateClimb(dt);
    };
    climbHookInstalled = true;
    return true;
  }

  function probeAccidentalPlateauFall() {
    installClimbHook();
    const deps = runtimeDeps(); // Used for the live player and merged terrain grid.
    const player = deps?.player;
    if (!player || player._hobunjiFallState || player.climbing || player.onBranch || player.prone || player.dodging || player.lunging) return false;
    if (window.Mounts?.rideState && window.Mounts.rideState !== 'none') return false;
    if (uiBlocksMovement()) return false;
    const intent = movementIntent(player); // Used to choose the cliff side the player is actually pressing toward.
    if (!intent.active) return false;

    for (const dir of candidateCardinals(intent)) {
      const target = downhillTarget(deps, player, dir); // Used to reject equal-height and uphill cliff crossings.
      if (!target) continue;
      fallDebug.candidate = { ...target, at: Date.now() };
      return beginFall({
        deps, entity: player, endX: target.endX, endY: target.endY,
        dir: target.dir, tierDrop: target.tierDrop, rolling: true,
        source: 'accidental plateau edge',
      });
    }
    fallDebug.candidate = null;
    return false;
  }

  function watcherFrame() {
    probeAccidentalPlateauFall();
    watchRaf = window.requestAnimationFrame(watcherFrame);
  }

  function startWatcher() {
    if (watchRaf || typeof window.requestAnimationFrame !== 'function') return false;
    watchRaf = window.requestAnimationFrame(watcherFrame);
    return true;
  }

  window.HobunjiPlateauFalls = Object.freeze({
    beginFall, // Future tall platforms can call this without duplicating landing/Footing rules.
    probe: probeAccidentalPlateauFall,
    footingCostForDrop,
    getDebug() {
      const player = runtimeDeps()?.player; // Used to expose active fall state without requiring a desktop console.
      return {
        ...fallDebug,
        watcherRunning: !!watchRaf,
        hookInstalled: climbHookInstalled,
        activeFall: player?._hobunjiFallState ? { ...player._hobunjiFallState } : null,
        config: {
          edgeTriggerTiles: FALL_EDGE_TRIGGER_TILES,
          minDropWorld: FALL_MIN_DROP_WORLD,
          hardFootingBase: HARD_FOOTING_BASE,
          rollFootingBase: ROLL_FOOTING_BASE,
          landingRollSeconds: LANDING_ROLL_S,
        },
      };
    },
  });

  startWatcher();
})();
