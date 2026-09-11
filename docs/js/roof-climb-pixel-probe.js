// Roof-climb Pixel Probe diagnostics + entrance-adjacency exclusion disable.
(() => {
  'use strict';

  if (window.HobunjiRoofClimbProbe) return;

  const META_KEY = 'hobunjiRoofClimbStructure';
  const SECTION = '=== Roof climb diagnostics ===';
  const MAX_PLAYER_WALL_DISTANCE = 1.75; // Mirrors roof-climb.js player-proximity targeting.
  const EPS = 1e-6;

  let runtimeDeps = null; // Captured from PixelProbe.init; used to report the live player/roof target state.
  let observer = null; // Watches Pixel Probe's text output and appends roof-climb diagnostics exactly once per capture.
  let appending = false; // Prevents the MutationObserver from recursively reacting to its own report append.

  function finite(value) { return Number.isFinite(Number(value)); }

  function activeStructureMetas() {
    const scene = window.GridTileAccessors?.getActiveScene?.();
    const found = [];
    scene?.traverse?.(object => {
      const meta = object?.userData?.[META_KEY];
      if (!meta?.walls?.length || !meta?.roofs?.length) return;
      // Entrance adjacency is intentionally no longer part of roof-climb eligibility.
      // Clear legacy metadata too, so the original roof-climb target resolver cannot
      // accidentally apply the old exclusion if a group predates this bridge.
      meta.entrance = null;
      meta.entranceClimbExclusionDisabled = true;
      found.push({ object, meta });
    });
    return found;
  }

  function nearestWallDistanceFromPlayer() {
    const player = runtimeDeps?.player || window.Combat?.deps?.player;
    const tile = Number(runtimeDeps?.TILE || window.Combat?.deps?.TILE) || 1;
    if (!player || !finite(player.x) || !finite(player.y)) return null;
    const px = Number(player.x) / tile;
    const pz = Number(player.y) / tile;
    let best = null;

    const pointSegmentDistance = (a, b) => {
      const ax = Number(a?.x) || 0, az = Number(a?.z) || 0;
      const bx = Number(b?.x) || 0, bz = Number(b?.z) || 0;
      const dx = bx - ax, dz = bz - az;
      const lenSq = dx * dx + dz * dz;
      const t = lenSq > EPS ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lenSq)) : 0;
      const x = ax + dx * t, z = az + dz * t;
      return { x, z, distance: Math.hypot(px - x, pz - z) };
    };

    for (const entry of activeStructureMetas()) {
      for (const wall of entry.meta.walls) {
        const vertices = Array.isArray(wall?.vertices) ? wall.vertices : [];
        for (let index = 0; index < vertices.length; index++) {
          const point = pointSegmentDistance(vertices[index], vertices[(index + 1) % vertices.length]);
          if (!best || point.distance < best.distance) {
            best = { ...point, wallFaceId: wall.id ?? null, meta: entry.meta };
          }
        }
      }
    }
    return best;
  }

  function roofDebug() {
    return window.HobunjiRoofClimb?.getDebug?.() || {};
  }

  function evaluateRay(_ray) {
    // Kept under the old API name because Pixel Probe already calls/evaluates
    // this helper, but climbability itself is now the same player-proximity
    // decision used by HobunjiRoofClimb.getRoofClimbTarget(), not a pixel-ray hit.
    activeStructureMetas();
    const player = runtimeDeps?.player || window.Combat?.deps?.player;
    const debug = roofDebug();
    if (!player) return { wallHit: false, climbable: false, reason: 'player state unavailable', debug };

    const mountState = window.Mounts?.rideState || 'none';
    if (mountState !== 'none') {
      return { wallHit: false, climbable: false, reason: 'player is mounted', nearestWall: nearestWallDistanceFromPlayer(), debug };
    }
    if (player.climbing) return { wallHit: false, climbable: false, reason: 'player is already climbing', nearestWall: nearestWallDistanceFromPlayer(), debug };
    if (player.prone) return { wallHit: false, climbable: false, reason: 'player is prone', nearestWall: nearestWallDistanceFromPlayer(), debug };
    if (player.onBranch) return { wallHit: false, climbable: false, reason: 'player is already on an elevated climb surface', nearestWall: nearestWallDistanceFromPlayer(), debug };
    if (player.dodging) return { wallHit: false, climbable: false, reason: 'player is currently dodging', nearestWall: nearestWallDistanceFromPlayer(), debug };

    const target = window.HobunjiRoofClimb?.getRoofClimbTarget?.() || null;
    const latestDebug = roofDebug();
    const nearestWall = nearestWallDistanceFromPlayer();
    if (!target) {
      const distance = nearestWall?.distance;
      const reason = Number.isFinite(distance) && distance > MAX_PLAYER_WALL_DISTANCE
        ? `nearest structural wall is too far from player (${distance.toFixed(3)} > ${MAX_PLAYER_WALL_DISTANCE.toFixed(2)} tiles)`
        : latestDebug.lastBlockReason || 'no valid structural roof climb target';
      return {
        wallHit: !!nearestWall,
        climbable: false,
        reason,
        nearestWall,
        debug: latestDebug,
      };
    }

    return {
      wallHit: true,
      climbable: true,
      reason: 'eligible nearby structural wall with reachable authored roof landing',
      wallFaceId: target.wallFaceId ?? nearestWall?.wallFaceId ?? null,
      playerDistance: Number(target.playerWallDistance ?? nearestWall?.distance),
      point: target.wallPoint || (nearestWall ? { x: nearestWall.x, y: 0, z: nearestWall.z } : null),
      landing: {
        x: Number(target.endWorldX),
        y: Number(target.endSurfaceY),
        z: Number(target.endWorldZ),
      },
      landingSource: target.landingSource || latestDebug.lastCandidate?.landingSource || 'unknown',
      selectionModel: 'nearest-player-wall',
      debug: latestDebug,
    };
  }

  function reportLines(text) {
    const result = evaluateRay(null);
    const debug = result.debug || {};
    const lines = [
      '',
      SECTION,
      'Entrance-adjacent exclusion: DISABLED',
      'Targeting model: nearest structural wall to PLAYER (camera ray not required)',
      `Roof runtime: source=${debug.runtimeDepsSource || 'unknown'} player=${debug.runtimePlayerReady ? 'ready' : 'missing'} climbInitCapture=${debug.climbDepsCaptured ? 'yes' : 'no'}`,
    ];
    const nearest = result.nearestWall;
    if (!result.climbable) {
      if (nearest && Number.isFinite(nearest.distance)) {
        lines.push(`Nearest structural wall: face=${nearest.wallFaceId ?? '-'} distance=${nearest.distance.toFixed(3)} / ${MAX_PLAYER_WALL_DISTANCE.toFixed(2)} tiles`);
      } else {
        lines.push('Nearest structural wall: none');
      }
      lines.push(`Climbable: NO — ${result.reason}`);
      return lines;
    }
    lines.push(`Structural wall target: YES face=${result.wallFaceId ?? '-'} distance=${Number(result.playerDistance || 0).toFixed(3)} / ${MAX_PLAYER_WALL_DISTANCE.toFixed(2)} tiles`);
    if (result.point) lines.push(`Wall point: (${Number(result.point.x || 0).toFixed(3)},${Number(result.point.y || 0).toFixed(3)},${Number(result.point.z || 0).toFixed(3)})`);
    if (result.landing && [result.landing.x, result.landing.y, result.landing.z].every(Number.isFinite)) {
      lines.push(`Roof landing: (${result.landing.x.toFixed(3)},${result.landing.y.toFixed(3)},${result.landing.z.toFixed(3)}) on authored roof plane via ${result.landingSource}`);
    }
    lines.push(`Climbable: YES — ${result.reason}`);
    return lines;
  }

  function appendProbeDiagnostics() {
    if (appending) return;
    const report = document.getElementById('debugProbeResult');
    const text = report?.textContent || '';
    if (!report || !text.startsWith('Pixel Probe report') || text.includes(SECTION)) return;
    const lines = reportLines(text);
    appending = true;
    try {
      report.textContent = `${text}${text.endsWith('\n') ? '' : '\n'}${lines.join('\n')}`;
    } finally {
      appending = false;
    }
  }

  function ensureObserver() {
    if (observer) return;
    const install = () => {
      if (observer) return;
      const report = document.getElementById('debugProbeResult');
      if (!report || typeof MutationObserver !== 'function') return;
      observer = new MutationObserver(appendProbeDiagnostics);
      observer.observe(report, { childList: true, characterData: true, subtree: true });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
    else install();
  }

  function chainFutureGlobal(name, patch) {
    if (window[name]) { patch(window[name]); return; }
    const descriptor = Object.getOwnPropertyDescriptor(window, name);
    if (descriptor && typeof descriptor.set === 'function') {
      const priorGet = descriptor.get;
      const priorSet = descriptor.set;
      Object.defineProperty(window, name, {
        configurable: descriptor.configurable !== false,
        enumerable: descriptor.enumerable !== false,
        get() { return priorGet ? priorGet.call(window) : undefined; },
        set(value) {
          priorSet.call(window, value);
          patch(priorGet ? priorGet.call(window) : value);
        },
      });
      return;
    }
    if (descriptor && descriptor.configurable === false) return;
    let value;
    Object.defineProperty(window, name, {
      configurable: true,
      enumerable: true,
      get() { return value; },
      set(next) { value = next; patch(next); },
    });
  }

  function patchPixelProbe(api) {
    if (!api || api.__hobunjiRoofClimbProbe || typeof api.init !== 'function') return;
    const originalInit = api.init;
    api.init = function roofClimbProbePixelProbeInit(injectedDeps) {
      runtimeDeps = injectedDeps || runtimeDeps;
      const result = originalInit.apply(this, arguments);
      ensureObserver();
      return result;
    };
    api.__hobunjiRoofClimbProbe = true;
    ensureObserver();
  }

  function patchHousePieceGen() {
    const api = window.HousePieceGen;
    const original = api?.buildGroupFromPiece;
    if (typeof original !== 'function' || original.__hobunjiRoofEntranceExclusionDisabled) return false;
    function buildGroupWithoutRoofEntranceExclusion(...args) {
      const group = original.apply(this, args);
      const meta = group?.userData?.[META_KEY];
      if (meta) {
        meta.entrance = null;
        meta.entranceClimbExclusionDisabled = true;
      }
      return group;
    }
    Object.assign(buildGroupWithoutRoofEntranceExclusion, original);
    buildGroupWithoutRoofEntranceExclusion.__hobunjiRoofEntranceExclusionDisabled = true;
    api.buildGroupFromPiece = buildGroupWithoutRoofEntranceExclusion;
    return true;
  }

  patchHousePieceGen();
  chainFutureGlobal('PixelProbe', patchPixelProbe);
  ensureObserver();

  window.HobunjiRoofClimbProbe = Object.freeze({
    evaluateRay,
    reportLines,
    clearEntranceExclusions: activeStructureMetas,
    get runtimeReady() { return !!runtimeDeps; },
  });
})();
