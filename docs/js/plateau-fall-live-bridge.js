// Live plateau walk-off detector. Uses ClimbSystem's fresh movement input/deps
// instead of player.inputX/Y, which are updated too late for elevated-surface logic.
(() => {
  'use strict';

  if (window.HobunjiPlateauFallLive) return;

  const MAX_WALL_TILES = 4;
  const EDGE_TRIGGER_TILES = 0.34;
  const INTENT_MIN = 0.12;

  let climbDeps = null; // Used by the live watcher for the same terrain/input authority as ClimbSystem.
  let watcherRaf = 0; // Used to expose whether the replacement live watcher is running.
  let climbInitPatched = false; // Used to avoid wrapping ClimbSystem.init more than once.
  let lastDebug = {
    at: 0,
    reason: 'waiting for ClimbSystem.init',
    inputSource: null,
    intent: null,
    startTile: null,
    candidate: null,
    started: false,
  }; // Used by Pixel Probe/mobile diagnostics to explain why a walk-off did or did not trigger.

  const finite = value => Number.isFinite(Number(value));

  function uiBlocksMovement() {
    return !!(window.PlayerChat?.isOpen
      || document.getElementById('npcDialogue')?.classList.contains('open')
      || document.getElementById('menuPanel')?.classList.contains('open'));
  }

  function runtimeDeps() {
    if (climbDeps?.player) return climbDeps;
    return window.Combat?.deps || climbDeps || null;
  }

  function runtimeDepsSource() {
    if (climbDeps?.player) return 'ClimbSystem.init';
    if (window.Combat?.deps?.player) return 'Combat.deps fallback';
    return 'none';
  }

  function movementIntent(deps, player) {
    const fresh = deps?.getMovementInput?.(); // Same raw keyboard/stick vector ClimbSystem uses before player.inputX/Y are refreshed.
    let x = Number(fresh?.x) || 0;
    let y = Number(fresh?.y) || 0;
    let source = 'getMovementInput';
    let len = Math.hypot(x, y);

    if (len < INTENT_MIN) {
      x = Number(player?.inputX) || 0;
      y = Number(player?.inputY) || 0;
      source = 'player.input';
      len = Math.hypot(x, y);
    }
    if (len < INTENT_MIN) {
      x = Number(player?.vx) || 0;
      y = Number(player?.vy) || 0;
      source = 'velocity';
      len = Math.hypot(x, y);
    }
    return len >= INTENT_MIN
      ? { active: true, x: x / len, y: y / len, source }
      : { active: false, x: 0, y: 0, source: 'none' };
  }

  function cardinals(intent) {
    const dirs = [];
    if (Math.abs(intent.x) >= INTENT_MIN) dirs.push({ x: Math.sign(intent.x), y: 0, weight: Math.abs(intent.x) });
    if (Math.abs(intent.y) >= INTENT_MIN) dirs.push({ x: 0, y: Math.sign(intent.y), weight: Math.abs(intent.y) });
    return dirs.sort((a, b) => b.weight - a.weight);
  }

  function nearEdge(player, tileSize, col, row, dir) {
    const localX = Number(player.x) / tileSize - col;
    const localY = Number(player.y) / tileSize - row;
    if (dir.x > 0) return 1 - localX <= EDGE_TRIGGER_TILES;
    if (dir.x < 0) return localX <= EDGE_TRIGGER_TILES;
    if (dir.y > 0) return 1 - localY <= EDGE_TRIGGER_TILES;
    return dir.y < 0 && localY <= EDGE_TRIGGER_TILES;
  }

  function findTarget(deps, player, dir) {
    const grid = deps?.getActiveGrid?.() || window.GridTileAccessors?.getActiveGrid?.();
    const tileSize = Number(deps?.TILE) || 0;
    if (!Array.isArray(grid) || !grid.length) return { target: null, reason: 'no active terrain grid' };
    if (!(tileSize > 0)) return { target: null, reason: 'invalid TILE size' };

    const startCol = Math.floor(Number(player.x) / tileSize);
    const startRow = Math.floor(Number(player.y) / tileSize);
    const startTile = grid[startRow]?.[startCol];
    const startTier = finite(startTile?.elevTier) ? Number(startTile.elevTier) : 0;
    lastDebug.startTile = startTile
      ? { col: startCol, row: startRow, type: startTile.type, incline: !!startTile.incline, elevTier: startTier }
      : null;
    if (!startTile) return { target: null, reason: 'player tile missing' };
    if (startTile.incline) return { target: null, reason: 'player center is already on incline' };
    if (!nearEdge(player, tileSize, startCol, startRow, dir)) return { target: null, reason: 'not close enough to pressed cliff edge' };

    let col = startCol;
    let row = startRow;
    let wallTiles = 0;
    for (let step = 0; step < MAX_WALL_TILES; step++) {
      col += dir.x;
      row += dir.y;
      const tile = grid[row]?.[col];
      if (!tile) return { target: null, reason: 'terrain ended before landing tile' };
      if (tile.incline) {
        wallTiles++;
        continue;
      }
      if (!wallTiles) return { target: null, reason: 'pressed edge has no incline wall' };
      if (deps?.isSolid?.(tile.type)) return { target: null, reason: 'lower landing tile is solid' };
      const landTier = finite(tile.elevTier) ? Number(tile.elevTier) : 0;
      if (landTier >= startTier) return { target: null, reason: 'far side is not lower' };
      const endX = (col + 0.5) * tileSize;
      const endY = (row + 0.5) * tileSize;
      if (typeof deps?.canPlayerOccupy === 'function' && !deps.canPlayerOccupy(endX, endY)) {
        return { target: null, reason: 'lower landing center is not occupiable' };
      }
      return {
        target: {
          startCol, startRow, landCol: col, landRow: row,
          startTier, landTier, tierDrop: Math.max(1, startTier - landTier),
          wallTiles, dir: { x: dir.x, y: dir.y }, endX, endY,
        },
        reason: null,
      };
    }
    return { target: null, reason: `no landing within ${MAX_WALL_TILES} incline tiles` };
  }

  function probe() {
    const deps = runtimeDeps();
    const player = deps?.player;
    lastDebug = {
      at: Date.now(), reason: null, inputSource: null, intent: null,
      startTile: null, candidate: null, started: false,
    };
    if (!deps || !player) { lastDebug.reason = 'runtime deps/player unavailable'; return false; }
    if (!window.HobunjiPlateauFalls?.beginFall) { lastDebug.reason = 'plateau fall animation API unavailable'; return false; }
    if (player._hobunjiFallState || player.climbing || player.onBranch || player.prone || player.dodging || player.lunging) {
      lastDebug.reason = 'player is in another movement state';
      return false;
    }
    if (window.Mounts?.rideState && window.Mounts.rideState !== 'none') { lastDebug.reason = 'player is mounted'; return false; }
    if (uiBlocksMovement()) { lastDebug.reason = 'UI blocks movement'; return false; }

    const intent = movementIntent(deps, player);
    lastDebug.inputSource = intent.source;
    lastDebug.intent = { x: intent.x, y: intent.y, active: intent.active };
    if (!intent.active) { lastDebug.reason = 'no fresh movement intent'; return false; }

    let lastReason = 'no downhill cliff in pressed direction';
    for (const dir of cardinals(intent)) {
      const found = findTarget(deps, player, dir);
      if (!found.target) { lastReason = found.reason || lastReason; continue; }
      lastDebug.candidate = { ...found.target };
      const started = !!window.HobunjiPlateauFalls.beginFall({
        deps,
        entity: player,
        endX: found.target.endX,
        endY: found.target.endY,
        dir: found.target.dir,
        tierDrop: found.target.tierDrop,
        rolling: true,
        source: 'accidental plateau edge (fresh input)',
      });
      lastDebug.started = started;
      lastDebug.reason = started ? 'fall started' : 'fall animation API rejected candidate';
      return started;
    }
    lastDebug.reason = lastReason;
    return false;
  }

  function watcherFrame() {
    try { probe(); }
    catch (error) {
      lastDebug = { ...lastDebug, at: Date.now(), reason: `watcher error: ${error?.message || error}`, started: false };
    }
    watcherRaf = window.requestAnimationFrame(watcherFrame);
  }

  function startWatcher() {
    if (watcherRaf || typeof window.requestAnimationFrame !== 'function') return false;
    watcherRaf = window.requestAnimationFrame(watcherFrame);
    return true;
  }

  function patchClimbSystem(system) {
    if (!system?.init || system.init.__hobunjiPlateauFallLiveInit) return false;
    const originalInit = system.init;
    function plateauFallLiveInit(injectedDeps) {
      climbDeps = injectedDeps || climbDeps;
      return originalInit.apply(this, arguments);
    }
    plateauFallLiveInit.__hobunjiPlateauFallLiveInit = true;
    system.init = plateauFallLiveInit;
    climbInitPatched = true;
    return true;
  }

  function watchClimbSystemAssignment() {
    if (window.ClimbSystem) {
      patchClimbSystem(window.ClimbSystem);
      return;
    }
    const descriptor = Object.getOwnPropertyDescriptor(window, 'ClimbSystem');
    if (descriptor && descriptor.configurable === false) return;
    if (descriptor && typeof descriptor.set === 'function') {
      const previousGet = descriptor.get;
      const previousSet = descriptor.set;
      Object.defineProperty(window, 'ClimbSystem', {
        configurable: true,
        enumerable: descriptor.enumerable !== false,
        get() { return previousGet ? previousGet.call(window) : undefined; },
        set(value) {
          previousSet.call(window, value);
          patchClimbSystem(previousGet ? previousGet.call(window) : value);
        },
      });
      return;
    }
    let value = descriptor?.value;
    Object.defineProperty(window, 'ClimbSystem', {
      configurable: true,
      enumerable: true,
      get() { return value; },
      set(next) { value = next; patchClimbSystem(next); },
    });
  }

  function installProbeReportHook() {
    const install = () => {
      const report = document.getElementById('debugProbeResult');
      if (!report || typeof MutationObserver !== 'function' || report.__hobunjiPlateauFallLiveObserved) return;
      report.__hobunjiPlateauFallLiveObserved = true;
      let appending = false;
      const observer = new MutationObserver(() => {
        if (appending) return;
        const text = report.textContent || '';
        if (!text.startsWith('Pixel Probe report') || text.includes('=== Plateau fall diagnostics ===')) return;
        const d = { ...lastDebug };
        const candidate = d.candidate
          ? `(${d.candidate.startCol},${d.candidate.startRow}) -> (${d.candidate.landCol},${d.candidate.landRow}) drop=${d.candidate.tierDrop} tier(s)`
          : 'none';
        const deps = runtimeDeps();
        const section = [
          '', '=== Plateau fall diagnostics ===',
          `Live watcher: ${watcherRaf ? 'RUNNING' : 'NOT RUNNING'}   Runtime deps: source=${runtimeDepsSource()} player=${deps?.player ? 'ready' : 'missing'} climbInitCapture=${climbDeps?.player ? 'yes' : 'no'}`,
          `Fresh input: ${d.inputSource || '-'} ${d.intent ? `(${Number(d.intent.x).toFixed(2)},${Number(d.intent.y).toFixed(2)}) active=${d.intent.active}` : '-'}`,
          `Current plateau tile: ${d.startTile ? `(${d.startTile.col},${d.startTile.row}) type=${d.startTile.type || '-'} tier=${d.startTile.elevTier} incline=${d.startTile.incline}` : 'unknown'}`,
          `Fall candidate: ${candidate}`,
          `Result: ${d.started ? 'FALL STARTED' : 'no fall'} — ${d.reason || '-'}`,
        ].join('\n');
        appending = true;
        report.textContent = `${text}${text.endsWith('\n') ? '' : '\n'}${section}`;
        appending = false;
      });
      observer.observe(report, { childList: true, characterData: true, subtree: true });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
    else install();
  }

  watchClimbSystemAssignment();
  startWatcher();
  installProbeReportHook();

  window.HobunjiPlateauFallLive = Object.freeze({
    probe,
    getDebug() {
      const deps = runtimeDeps();
      return {
        ...lastDebug,
        watcherRunning: !!watcherRaf,
        climbInitPatched,
        climbDepsCaptured: !!climbDeps?.player,
        runtimeDepsSource: runtimeDepsSource(),
        runtimePlayerReady: !!deps?.player,
        config: { edgeTriggerTiles: EDGE_TRIGGER_TILES, maxWallTiles: MAX_WALL_TILES, intentMin: INTENT_MIN },
      };
    },
  });
})();