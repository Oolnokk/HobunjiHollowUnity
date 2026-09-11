// Roof-climb Pixel Probe diagnostics + entrance-adjacency exclusion disable.
(() => {
  'use strict';

  if (window.HobunjiRoofClimbProbe) return;

  const META_KEY = 'hobunjiRoofClimbStructure';
  const SECTION = '=== Roof climb diagnostics ===';
  const MAX_PLAYER_WALL_DISTANCE = 1.75; // Mirrors roof-climb.js; used to report whether the player is close enough to the probed wall.
  const DIRECT_WALL_DOT_MIN = 0.62; // Mirrors roof-climb.js; used to reject glancing probe rays against structural walls.
  const ROOF_SAMPLE_OFFSETS = [0.28, 0.5, 0.75, 1.0, 1.25]; // Mirrors roof-climb.js; used to find a roof landing just behind the wall plane.
  const EPS = 1e-6;

  let runtimeDeps = null; // Captured from PixelProbe.init; used to reconstruct the clicked screen ray and read player state.
  let observer = null; // Watches Pixel Probe's text output and appends roof-climb diagnostics exactly once per capture.
  let appending = false; // Prevents the MutationObserver from recursively reacting to its own report append.

  function finite(value) { return Number.isFinite(Number(value)); }
  function vecSub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
  function cross(a, b) { return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }; }
  function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
  function length(v) { return Math.hypot(v.x, v.y, v.z); }
  function normalize(v) {
    const len = length(v);
    return len > EPS ? { x: v.x / len, y: v.y / len, z: v.z / len } : { x: 0, y: 0, z: 0 };
  }

  function faceTriangles(face) {
    const vertices = face?.vertices || [];
    if (vertices.length === 3) return [[vertices[0], vertices[1], vertices[2]]];
    if (vertices.length >= 4) return [[vertices[0], vertices[1], vertices[2]], [vertices[0], vertices[2], vertices[3]]];
    return [];
  }

  function rayTriangle(origin, direction, a, b, c) {
    const edge1 = vecSub(b, a), edge2 = vecSub(c, a);
    const h = cross(direction, edge2);
    const det = dot(edge1, h);
    if (Math.abs(det) < EPS) return null;
    const invDet = 1 / det;
    const s = vecSub(origin, a);
    const u = invDet * dot(s, h);
    if (u < -EPS || u > 1 + EPS) return null;
    const q = cross(s, edge1);
    const v = invDet * dot(direction, q);
    if (v < -EPS || u + v > 1 + EPS) return null;
    const t = invDet * dot(edge2, q);
    if (t <= EPS) return null;
    return {
      t,
      point: {
        x: origin.x + direction.x * t,
        y: origin.y + direction.y * t,
        z: origin.z + direction.z * t,
      },
    };
  }

  function wallHorizontalNormal(face) {
    const triangle = faceTriangles(face)[0];
    if (!triangle) return null;
    const normal = normalize(cross(vecSub(triangle[1], triangle[0]), vecSub(triangle[2], triangle[0])));
    const horizontal = Math.hypot(normal.x, normal.z);
    return horizontal > EPS ? { x: normal.x / horizontal, z: normal.z / horizontal } : null;
  }

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

  function playerHorizontalDistanceToPoint(point) {
    const player = runtimeDeps?.player || window.Combat?.deps?.player;
    const tile = Number(runtimeDeps?.TILE || window.Combat?.deps?.TILE) || 1;
    if (!player || !finite(player.x) || !finite(player.y) || !finite(point?.x) || !finite(point?.z)) return Infinity;
    return Math.hypot(Number(point.x) - Number(player.x) / tile, Number(point.z) - Number(player.y) / tile);
  }

  function roofSurfaceYAt(meta, x, z) {
    return window.HobunjiRoofClimb?.roofSurfaceYAt?.(meta, x, z);
  }

  function evaluateRay(ray) {
    const origin = ray?.origin;
    const rawDirection = ray?.direction;
    const player = runtimeDeps?.player || window.Combat?.deps?.player;
    if (!origin || !rawDirection) return { wallHit: false, climbable: false, reason: 'probe ray unavailable' };
    if (!player) return { wallHit: false, climbable: false, reason: 'player state unavailable' };

    const direction = normalize({
      x: Number(rawDirection.x) || 0,
      y: Number(rawDirection.y) || 0,
      z: Number(rawDirection.z) || 0,
    });
    const horizontalLookLen = Math.hypot(direction.x, direction.z);
    if (length(direction) < EPS || horizontalLookLen < EPS) {
      return { wallHit: false, climbable: false, reason: 'probe ray has no horizontal wall direction' };
    }

    let best = null;
    let sawStructuralWall = false;
    let sawDirectWall = false;
    let sawCloseWall = false;
    for (const entry of activeStructureMetas()) {
      for (const wall of entry.meta.walls) {
        const normal = wallHorizontalNormal(wall);
        if (!normal) continue;
        for (const triangle of faceTriangles(wall)) {
          const hit = rayTriangle(origin, direction, triangle[0], triangle[1], triangle[2]);
          if (!hit) continue;
          sawStructuralWall = true;
          const directness = Math.abs((direction.x / horizontalLookLen) * normal.x + (direction.z / horizontalLookLen) * normal.z);
          if (directness < DIRECT_WALL_DOT_MIN) continue;
          sawDirectWall = true;
          const playerDistance = playerHorizontalDistanceToPoint(hit.point);
          if (!Number.isFinite(playerDistance) || playerDistance > MAX_PLAYER_WALL_DISTANCE) continue;
          sawCloseWall = true;
          if (best && hit.t >= best.cameraDistance) continue;
          best = { ...entry, wall, point: hit.point, cameraDistance: hit.t, playerDistance, directness };
        }
      }
    }

    if (!best) {
      const reason = !sawStructuralWall
        ? 'pixel ray does not intersect an authored structural wall plane'
        : !sawDirectWall
          ? `wall is too glancing (needs directness >= ${DIRECT_WALL_DOT_MIN.toFixed(2)})`
          : !sawCloseWall
            ? `wall is too far from player (needs <= ${MAX_PLAYER_WALL_DISTANCE.toFixed(2)} tiles)`
            : 'no eligible structural wall';
      return { wallHit: sawStructuralWall, climbable: false, reason };
    }

    const nx = direction.x / horizontalLookLen;
    const nz = direction.z / horizontalLookLen;
    let landing = null;
    for (const offset of ROOF_SAMPLE_OFFSETS) {
      const x = best.point.x + nx * offset;
      const z = best.point.z + nz * offset;
      const y = roofSurfaceYAt(best.meta, x, z);
      if (Number.isFinite(y)) { landing = { x, y, z }; break; }
    }
    if (!landing) {
      return {
        wallHit: true,
        climbable: false,
        reason: 'wall has no reachable authored roof plane behind it',
        wallFaceId: best.wall.id,
        playerDistance: best.playerDistance,
        cameraDistance: best.cameraDistance,
        directness: best.directness,
        point: best.point,
      };
    }

    let stateReason = null;
    if (player.climbing) stateReason = 'player is already climbing';
    else if (player.prone) stateReason = 'player is prone';
    else if (player.onBranch) stateReason = 'player is already on an elevated climb surface';
    else if (player.dodging) stateReason = 'player is currently dodging';
    else if ((window.Mounts?.rideState || 'none') !== 'none') stateReason = 'player is mounted';

    return {
      wallHit: true,
      climbable: !stateReason,
      reason: stateReason || 'eligible structural wall with reachable roof landing',
      wallFaceId: best.wall.id,
      playerDistance: best.playerDistance,
      cameraDistance: best.cameraDistance,
      directness: best.directness,
      point: best.point,
      landing,
    };
  }

  function rayFromProbeReport(text) {
    const match = /CSS\((-?[\d.]+),(-?[\d.]+)\)/.exec(text || '');
    const renderer = runtimeDeps?.renderer;
    const camera = runtimeDeps?.camera;
    const canvas = renderer?.domElement;
    if (!match || !canvas?.getBoundingClientRect || !camera || typeof THREE?.Raycaster !== 'function') return null;
    const rect = canvas.getBoundingClientRect();
    if (!(rect.width > 0) || !(rect.height > 0)) return null;
    const cssX = Number(match[1]), cssY = Number(match[2]);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera({
      x: (cssX / rect.width) * 2 - 1,
      y: -(cssY / rect.height) * 2 + 1,
    }, camera);
    return raycaster.ray;
  }

  function reportLines(text) {
    const result = evaluateRay(rayFromProbeReport(text));
    const lines = ['', SECTION, 'Entrance-adjacent exclusion: DISABLED'];
    if (!result.wallHit) {
      lines.push('Probed structural wall: no');
      lines.push(`Climbable: NO — ${result.reason}`);
      return lines;
    }
    lines.push(`Probed structural wall: YES face=${result.wallFaceId ?? '-'} point=(${Number(result.point?.x || 0).toFixed(3)},${Number(result.point?.y || 0).toFixed(3)},${Number(result.point?.z || 0).toFixed(3)})`);
    if (Number.isFinite(result.playerDistance)) lines.push(`Player distance to wall: ${result.playerDistance.toFixed(3)} / ${MAX_PLAYER_WALL_DISTANCE.toFixed(2)} tiles`);
    if (Number.isFinite(result.directness)) lines.push(`Wall-look directness: ${result.directness.toFixed(3)} / ${DIRECT_WALL_DOT_MIN.toFixed(2)} minimum`);
    if (result.landing) lines.push(`Roof landing: (${result.landing.x.toFixed(3)},${result.landing.y.toFixed(3)},${result.landing.z.toFixed(3)}) on authored roof plane`);
    lines.push(`Climbable: ${result.climbable ? 'YES' : 'NO'} — ${result.reason}`);
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
    // Preserve wrapper markers so roof-climb.js cannot later reinstall outside
    // this bridge and accidentally restore the old entrance-adjacency rule.
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
