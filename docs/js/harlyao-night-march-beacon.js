(() => {
  'use strict';

  const CONFIG_URL = 'config/harlyao-night-march.json'; // Reuses the march's authored spectral beacon tuning.
  const FALLBACK_CHUNK_TILES = 16; // Matches WildernessChunks when its constants are not initialized yet.
  const FALLBACK_MAP_TILES = 200; // Current wilderness dimensions; live zone defs win whenever available.
  const LOCATOR_REFRESH_MS = 100; // Matches the lighting overlay cadence; never becomes per-frame locator work.
  const SNAKE_LOBES = Object.freeze([
    { x: -0.94, y:  0.02, r: 0.34, a: 0.72 },
    { x: -0.68, y: -0.24, r: 0.43, a: 0.82 },
    { x: -0.34, y: -0.31, r: 0.48, a: 0.92 },
    { x:  0.02, y: -0.06, r: 0.52, a: 1.00 },
    { x:  0.34, y:  0.26, r: 0.46, a: 0.92 },
    { x:  0.67, y:  0.31, r: 0.40, a: 0.82 },
    { x:  0.96, y:  0.08, r: 0.31, a: 0.68 },
  ]); // Uneven overlapping lobes form one crooked, recognizably non-lantern S-shaped spectral smear.

  let deps = null; // Captured from BanditCombat.init; used for current-area, map dimensions, and terrain-height sampling.
  let lightingDeps = null; // Captured from WeatherFX.init for the canonical overlay canvas/camera/world projection.
  let config = null; // Parsed Harlyao march config used by the distance-independent locator.
  let weatherInstalled = false; // Mirrors whether the CURRENT WeatherFX draw chain still carries our marker.
  let weatherDrawInstalls = 0; // Mobile-visible count of initial install plus any repair after a later renderer replacement.
  let lastLocatorDrawAt = 0; // Keeps the locator on the lighting overlay's low-frequency cadence.
  let lastScreenState = null; // Mobile-visible diagnostics from the most recent rendered locator.
  const projectedScratch = window.THREE ? new window.THREE.Vector3() : null;
  const cameraRight = window.THREE ? new window.THREE.Vector3() : null;

  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
  const chunkTiles = () => Number(window.WildernessChunks?.constants?.CHUNK_TILES) || FALLBACK_CHUNK_TILES;

  async function loadConfig() {
    if (config) return config;
    try {
      const response = await fetch(CONFIG_URL);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      config = await response.json();
      return config;
    } catch (error) {
      window.__farmLog?.(`[harlyao-beacon] config load failed: ${error.message}`, 'warn', 'visual');
      return null;
    }
  }

  function zoneDims(zoneId) {
    const def = deps?.EXTERIOR_ZONES?.[zoneId] || window.EXTERIOR_ZONES?.[zoneId] || null;
    return {
      cols: Math.max(1, Number(def?.cols) || FALLBACK_MAP_TILES),
      rows: Math.max(1, Number(def?.rows) || FALLBACK_MAP_TILES),
    };
  }

  function chunkCenter(chunk, zoneId) {
    if (!chunk) return null;
    const size = chunkTiles();
    const dims = zoneDims(zoneId);
    const col0 = clamp(Number(chunk.cx) * size, 0, dims.cols - 1);
    const row0 = clamp(Number(chunk.cz) * size, 0, dims.rows - 1);
    const col1 = Math.min(dims.cols, (Number(chunk.cx) + 1) * size);
    const row1 = Math.min(dims.rows, (Number(chunk.cz) + 1) * size);
    return {
      x: (col0 + col1 - 1) * 0.5,
      z: (row0 + row1 - 1) * 0.5,
      col: clamp(Math.floor((col0 + col1 - 1) * 0.5), 0, dims.cols - 1),
      row: clamp(Math.floor((row0 + row1 - 1) * 0.5), 0, dims.rows - 1),
    };
  }

  function beaconHeight(center, zoneId) {
    const liveSurface = Number(center?.surfaceY); // Visible formation exposes its real rendered feet height, keeping the locator on the same elevation.
    if (Number.isFinite(liveSurface)) return liveSurface + 1.2;
    const grid = deps?.getActiveGrid?.() || deps?.getAreaGrid?.(zoneId) || null;
    const tile = grid?.[center?.row]?.[center?.col];
    if (tile && typeof deps?.tileSurfaceYInArea === 'function') {
      const surface = Number(deps.tileSurfaceYInArea(tile, zoneId));
      if (Number.isFinite(surface)) return surface + 1.2;
    }
    return 1.2;
  }

  function beaconSnapshot() {
    const march = window.HarlyaoNightMarch?.debugSnapshot?.();
    const scheduled = march?.scheduled;
    const zoneId = scheduled?.zoneId || null;
    const currentArea = deps?.getCurrentArea?.() || lightingDeps?.getCurrentArea?.() || null;
    const active = !!scheduled && currentArea === zoneId;
    const chunk = march?.visible && march?.liveChunk ? march.liveChunk : scheduled?.chunk || null;
    const liveCenter = march?.visible && march?.liveAnchor ? { ...march.liveAnchor } : null; // Observed locator follows the real formation centroid, not merely its chunk center.
    const center = active ? (liveCenter || chunkCenter(chunk, zoneId)) : null;
    const centerSource = liveCenter ? 'formation-centroid' : 'chunk-center'; // Mobile diagnostics distinguishes exact observed tracking from hidden coarse tracking.
    return { active, zoneId, currentArea, chunk, center, centerSource, armyVisible: !!march?.visible };
  }

  function viewportRect() {
    const rect = lightingDeps?.getThreeRect?.();
    const canvas = lightingDeps?.lctx?.canvas;
    return {
      width: Math.max(1, Number(rect?.width) || Number(canvas?.width) || 1),
      height: Math.max(1, Number(rect?.height) || Number(canvas?.height) || 1),
    };
  }

  function projectWorld(x, y, z, rect) {
    const direct = lightingDeps?.worldToOverlay?.(x, y, z) || null;
    if (Number.isFinite(Number(direct?.x)) && Number.isFinite(Number(direct?.y))) return direct;
    if (!projectedScratch || !lightingDeps?.camera) return null;
    projectedScratch.set(x, y, z).project(lightingDeps.camera);
    if (![projectedScratch.x, projectedScratch.y].every(Number.isFinite)) return null;
    return {
      x: (projectedScratch.x * 0.5 + 0.5) * rect.width,
      y: (-projectedScratch.y * 0.5 + 0.5) * rect.height,
      visible: projectedScratch.z >= -1 && projectedScratch.z <= 1
        && projectedScratch.x >= -1 && projectedScratch.x <= 1
        && projectedScratch.y >= -1 && projectedScratch.y <= 1,
    };
  }

  function worldRadiusPx(beacon, worldY, rect) {
    const visuals = config?.visuals || {};
    const minPx = Math.max(24, Number(visuals.beaconMinScreenRadiusPx) || 96);
    const maxPx = Math.max(minPx, Number(visuals.beaconMaxScreenRadiusPx) || 220);
    let projectedRadius = 0;
    if (cameraRight && lightingDeps?.camera) {
      cameraRight.setFromMatrixColumn(lightingDeps.camera.matrixWorld, 0);
      const center = projectWorld(beacon.center.x, worldY, beacon.center.z, rect);
      const tiles = Math.max(1, Number(visuals.beaconGlowRadiusTiles) || 28);
      const edge = projectWorld(
        beacon.center.x + cameraRight.x * tiles,
        worldY + cameraRight.y * tiles,
        beacon.center.z + cameraRight.z * tiles,
        rect,
      );
      if ([center?.x, center?.y, edge?.x, edge?.y].every(Number.isFinite)) {
        projectedRadius = Math.hypot(edge.x - center.x, edge.y - center.y);
      }
    }
    return clamp(Math.max(minPx, projectedRadius || 0), minPx, maxPx);
  }

  function clampOffscreenPoint(projected, rect, radius) {
    if (projected?.visible) return { x: projected.x, y: projected.y, edge: false };
    let x = Number(projected?.x);
    let y = Number(projected?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      x = rect.width * 0.5;
      y = rect.height;
    }
    let dx = x - rect.width * 0.5;
    let dy = y - rect.height * 0.5;
    if (Math.abs(dx) + Math.abs(dy) < 0.001) dy = 1;
    const authoredMargin = Math.max(12, Number(config?.visuals?.beaconEdgeMarginPx) || 44);
    const margin = Math.min(Math.min(rect.width, rect.height) * 0.32, Math.max(authoredMargin, radius * 0.68));
    const roomX = Math.max(1, rect.width * 0.5 - margin);
    const roomY = Math.max(1, rect.height * 0.5 - margin);
    const scaleX = Math.abs(dx) > 0.001 ? roomX / Math.abs(dx) : Infinity;
    const scaleY = Math.abs(dy) > 0.001 ? roomY / Math.abs(dy) : Infinity;
    const scale = Math.min(scaleX, scaleY);
    return {
      x: clamp(rect.width * 0.5 + dx * scale, margin, rect.width - margin),
      y: clamp(rect.height * 0.5 + dy * scale, margin, rect.height - margin),
      edge: true,
    };
  }

  function snakePose(beacon, screen, rect, radius, now) {
    const chunkSeed = (Number(beacon.chunk?.cx) || 0) * 31 + (Number(beacon.chunk?.cz) || 0) * 17;
    const baseAngle = screen.edge
      ? Math.atan2(screen.y - rect.height * 0.5, screen.x - rect.width * 0.5) + Math.PI * 0.5
      : ((chunkSeed % 19) / 19) * Math.PI * 2;
    const wobbleTime = now / 1750;
    return SNAKE_LOBES.map((lobe, index) => {
      const breathe = 1 + Math.sin(wobbleTime + index * 1.71) * 0.055;
      const localX = lobe.x * radius * 0.95;
      const localY = (lobe.y + Math.sin(wobbleTime * 0.72 + index * 1.37) * 0.055) * radius;
      const cos = Math.cos(baseAngle);
      const sin = Math.sin(baseAngle);
      return {
        x: screen.x + localX * cos - localY * sin,
        y: screen.y + localX * sin + localY * cos,
        radius: radius * lobe.r * breathe,
        alpha: lobe.a,
      };
    });
  }

  function drawLobes(ctx, lobes, color, intensity, erase) {
    const rgb = color.replace('#', '');
    const parsed = Number.parseInt(rgb.length === 3 ? rgb.split('').map(ch => ch + ch).join('') : rgb, 16);
    const r = Number.isFinite(parsed) ? (parsed >> 16) & 255 : 176;
    const g = Number.isFinite(parsed) ? (parsed >> 8) & 255 : 240;
    const b = Number.isFinite(parsed) ? parsed & 255 : 255;
    for (const lobe of lobes) {
      const strength = clamp(intensity * lobe.alpha, 0, 1);
      const gradient = ctx.createRadialGradient(lobe.x, lobe.y, 0, lobe.x, lobe.y, lobe.radius);
      if (erase) {
        gradient.addColorStop(0, `rgba(0,0,0,${0.70 * strength})`);
        gradient.addColorStop(0.42, `rgba(0,0,0,${0.40 * strength})`);
        gradient.addColorStop(1, 'rgba(0,0,0,0)');
      } else {
        gradient.addColorStop(0, `rgba(${r},${g},${b},${0.38 * strength})`);
        gradient.addColorStop(0.48, `rgba(${r},${g},${b},${0.17 * strength})`);
        gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
      }
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(lobe.x, lobe.y, lobe.radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawLocatorOverlay() {
    const now = performance.now();
    if (!config || !lightingDeps?.lctx || !lightingDeps?.worldToOverlay || now - lastLocatorDrawAt < LOCATOR_REFRESH_MS) return;
    lastLocatorDrawAt = now;
    const beacon = beaconSnapshot();
    if (!beacon.active || !beacon.center) {
      lastScreenState = null;
      return;
    }
    if (Number(lightingDeps?.getSceneTransAlpha?.() || 0) > 0) return;

    const rect = viewportRect();
    const worldY = beaconHeight(beacon.center, beacon.zoneId);
    const projected = projectWorld(beacon.center.x, worldY, beacon.center.z, rect);
    const radius = worldRadiusPx(beacon, worldY, rect);
    const screen = clampOffscreenPoint(projected, rect, radius);
    const lobes = snakePose(beacon, screen, rect, radius, now);
    const ctx = lightingDeps.lctx;
    const visuals = config.visuals || {};
    const intensity = clamp(Number(visuals.beaconGlowIntensity) || 0.94, 0, 1);
    const color = visuals.beaconGlowColor || visuals.color || '#b0f0ff';

    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    drawLobes(ctx, lobes, color, intensity, true);
    ctx.globalCompositeOperation = 'screen';
    drawLobes(ctx, lobes, color, intensity, false);
    ctx.restore();

    lastScreenState = {
      edge: screen.edge,
      x: Math.round(screen.x),
      y: Math.round(screen.y),
      radiusPx: Math.round(radius),
      color,
      shape: 'serpentine',
      centerSource: beacon.centerSource,
    };
  }

  function installBanditDeps(api = window.BanditCombat) {
    if (!api || typeof api.init !== 'function') return false;
    if (api.__harlyaoBeaconInitWrapped) return true;
    const original = api.init.bind(api);
    api.init = function harlyaoBeaconBanditInit(injected) {
      deps = injected;
      return original(injected);
    };
    api.__harlyaoBeaconInitWrapped = true;
    return true;
  }

  function watchBanditCombat() {
    if (installBanditDeps()) return;
    const descriptor = Object.getOwnPropertyDescriptor(window, 'BanditCombat');
    if (descriptor && !descriptor.configurable) return;
    let assigned = descriptor?.value;
    Object.defineProperty(window, 'BanditCombat', {
      configurable: true,
      enumerable: true,
      get: () => assigned,
      set(value) {
        assigned = value;
        Object.defineProperty(window, 'BanditCombat', { configurable: true, enumerable: true, writable: true, value });
        installBanditDeps(value);
      },
    });
  }

  function installWeatherBridge(api = window.WeatherFX) {
    if (!api || typeof api.drawLightingOverlay !== 'function') return false;
    if (typeof api.init === 'function' && !api.__harlyaoBeaconInitWrapped) {
      const originalInit = api.init.bind(api);
      api.init = function harlyaoBeaconWeatherInit(injected) {
        lightingDeps = injected;
        return originalInit(injected);
      };
      api.__harlyaoBeaconInitWrapped = true;
    }
    if (api.drawLightingOverlay.__harlyaoBeaconLocatorWrapped) {
      weatherInstalled = true;
      return true;
    }

    const priorDraw = api.drawLightingOverlay;
    const originalDraw = priorDraw.bind(api);
    const wrappedDraw = function harlyaoBeaconLightingOverlay(...args) {
      const ctx = lightingDeps?.lctx;
      let redrawn = false;
      let originalClearRect = null;
      if (ctx?.clearRect) {
        originalClearRect = ctx.clearRect;
        ctx.clearRect = function harlyaoBeaconTrackedClearRect(...clearArgs) {
          redrawn = true;
          return originalClearRect.apply(this, clearArgs);
        };
      }
      let result;
      try { result = originalDraw(...args); }
      finally { if (ctx && originalClearRect) ctx.clearRect = originalClearRect; }
      if (redrawn) drawLocatorOverlay();
      return result;
    };
    Object.assign(wrappedDraw, priorDraw); // Carries lower-layer identity markers through the outer locator wrapper.
    wrappedDraw.__harlyaoBeaconLocatorWrapped = true;
    api.drawLightingOverlay = wrappedDraw;
    weatherInstalled = true;
    weatherDrawInstalls++;
    return true;
  }

  function ensureWeatherBridge() {
    return installWeatherBridge(window.WeatherFX);
  }

  function debugSnapshot() {
    const beacon = beaconSnapshot();
    const visuals = config?.visuals || {};
    return {
      configReady: !!config,
      depsReady: !!deps,
      lightingReady: !!lightingDeps,
      installed: !!window.WeatherFX?.drawLightingOverlay?.__harlyaoBeaconLocatorWrapped,
      weatherDrawInstalls,
      ...beacon,
      radiusTiles: Math.max(1, Number(visuals.beaconGlowRadiusTiles) || 28),
      intensity: clamp(Number(visuals.beaconGlowIntensity) || 0.94, 0, 1),
      color: visuals.beaconGlowColor || visuals.color || '#b0f0ff',
      minScreenRadiusPx: Math.max(24, Number(visuals.beaconMinScreenRadiusPx) || 96),
      maxScreenRadiusPx: Math.max(24, Number(visuals.beaconMaxScreenRadiusPx) || 220),
      edgeMarginPx: Math.max(12, Number(visuals.beaconEdgeMarginPx) || 44),
      screen: lastScreenState,
    };
  }

  window.HarlyaoNightMarchBeacon = Object.freeze({
    loadConfig,
    ensureWeatherBridge,
    debugSnapshot,
    formatDebug: () => {
      const data = debugSnapshot();
      const chunk = data.chunk ? `${data.chunk.cx},${data.chunk.cz}` : 'none';
      const center = data.center ? `${Number(data.center.x).toFixed(2)},${Number(data.center.z).toFixed(2)}` : 'none';
      const screen = data.screen ? `${data.screen.edge ? 'edge' : 'world'}@${data.screen.x},${data.screen.y}/${data.screen.radiusPx}px` : 'none';
      return `Harlyao beacon: active=${data.active} area=${data.currentArea || '-'} zone=${data.zoneId || '-'} chunk=${chunk} center=${center}/${data.centerSource || '-'} color=${data.color} screen=${screen} armyVisible=${data.armyVisible}`;
    },
    __test: Object.freeze({ chunkCenter, clampOffscreenPoint }),
  });

  watchBanditCombat();
  loadConfig();
  if (!ensureWeatherBridge() && typeof window.setInterval === 'function') {
    const retry = window.setInterval(() => {
      if (ensureWeatherBridge()) window.clearInterval?.(retry);
    }, 250);
  }
})();
