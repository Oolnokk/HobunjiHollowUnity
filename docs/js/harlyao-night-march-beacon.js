(() => {
  'use strict';

  const CONFIG_URL = 'config/harlyao-night-march.json'; // Reuses the march's authored spectral color and distant-beacon tuning.
  const FALLBACK_CHUNK_TILES = 16; // Matches WildernessChunks when its constants are not initialized yet.
  const FALLBACK_MAP_TILES = 200; // Current wilderness dimensions; live zone defs win whenever available.

  let deps = null; // Captured from BanditCombat.init; used only for current-area, map dimensions, and optional terrain-height sampling.
  let config = null; // Parsed Harlyao march config used by the one cheap persistent beacon provider.
  let unregisterGlow = null; // Unregister closure for the one Ghostify provider installed by this module.

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
    const def = deps?.EXTERIOR_ZONES?.[zoneId] || window.EXTERIOR_ZONES?.[zoneId] || null; // Uses the same live zone dimensions as the march controller when available.
    return {
      cols: Math.max(1, Number(def?.cols) || FALLBACK_MAP_TILES),
      rows: Math.max(1, Number(def?.rows) || FALLBACK_MAP_TILES),
    };
  }

  function chunkCenter(chunk, zoneId) {
    if (!chunk) return null;
    const size = chunkTiles();
    const dims = zoneDims(zoneId);
    const col0 = clamp(Number(chunk.cx) * size, 0, dims.cols - 1); // West edge of the army's simulation chunk.
    const row0 = clamp(Number(chunk.cz) * size, 0, dims.rows - 1); // North edge of the army's simulation chunk.
    const col1 = Math.min(dims.cols, (Number(chunk.cx) + 1) * size); // Exclusive east edge, including partial final chunks.
    const row1 = Math.min(dims.rows, (Number(chunk.cz) + 1) * size); // Exclusive south edge, including partial final chunks.
    return {
      x: (col0 + col1 - 1) * 0.5,
      z: (row0 + row1 - 1) * 0.5,
      col: clamp(Math.floor((col0 + col1 - 1) * 0.5), 0, dims.cols - 1),
      row: clamp(Math.floor((row0 + row1 - 1) * 0.5), 0, dims.rows - 1),
    };
  }

  function beaconHeight(center, zoneId) {
    const grid = deps?.getActiveGrid?.() || deps?.getAreaGrid?.(zoneId) || null; // Optional live terrain grid; the beacon remains valid if this dependency is absent.
    const tile = grid?.[center?.row]?.[center?.col];
    if (tile && typeof deps?.tileSurfaceYInArea === 'function') {
      const surface = Number(deps.tileSurfaceYInArea(tile, zoneId));
      if (Number.isFinite(surface)) return surface + 1.2;
    }
    return 1.2; // Ground-ish fallback keeps the projected glow centered near the distant route chunk.
  }

  function beaconSnapshot() {
    const march = window.HarlyaoNightMarch?.debugSnapshot?.(); // Reads the controller's cached hourly/live chunk instead of re-simulating the route.
    const scheduled = march?.scheduled;
    const zoneId = scheduled?.zoneId || null;
    const currentArea = deps?.getCurrentArea?.() || null;
    const active = !!scheduled && currentArea === zoneId;
    const chunk = march?.visible && march?.liveChunk ? march.liveChunk : scheduled?.chunk || null; // Offscreen beacon follows hourly state; observed beacon follows the physical army.
    const center = active ? chunkCenter(chunk, zoneId) : null;
    return { active, zoneId, currentArea, chunk, center, armyVisible: !!march?.visible };
  }

  function glowSource() {
    if (!config || !deps) return null;
    const beacon = beaconSnapshot();
    if (!beacon.active || !beacon.center) return null;
    const visuals = config.visuals || {};
    return {
      x: beacon.center.x,
      y: beaconHeight(beacon.center, beacon.zoneId),
      z: beacon.center.z,
      radiusTiles: Math.max(1, Number(visuals.beaconGlowRadiusTiles) || 28),
      intensity: clamp(Number(visuals.beaconGlowIntensity) || 0.72, 0, 1),
      color: visuals.color || '#4fd9c6',
    }; // One oversized 2D WeatherFX/Ghostify halo remains visible while all twenty soldiers stay unmaterialized outside their chunk.
  }

  function installBanditDeps(api = window.BanditCombat) {
    if (!api || typeof api.init !== 'function') return false;
    if (api.__harlyaoBeaconInitWrapped) return true;
    const original = api.init.bind(api); // Chains after the march controller's own dependency-capture wrapper.
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
    let assigned = descriptor?.value; // Holds a later parser-time assignment until the dependency wrapper can be installed.
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

  function installGlow() {
    if (unregisterGlow || !window.Ghostify?.registerGlowSource) return !!unregisterGlow;
    unregisterGlow = window.Ghostify.registerGlowSource(glowSource); // Exactly one cheap provider for the entire distant army beacon.
    return true;
  }

  function debugSnapshot() {
    const beacon = beaconSnapshot();
    const visuals = config?.visuals || {};
    return {
      configReady: !!config,
      depsReady: !!deps,
      installed: !!unregisterGlow,
      ...beacon,
      radiusTiles: Math.max(1, Number(visuals.beaconGlowRadiusTiles) || 28),
      intensity: clamp(Number(visuals.beaconGlowIntensity) || 0.72, 0, 1),
    };
  }

  window.HarlyaoNightMarchBeacon = Object.freeze({
    loadConfig,
    installGlow,
    debugSnapshot,
    formatDebug: () => {
      const data = debugSnapshot();
      const chunk = data.chunk ? `${data.chunk.cx},${data.chunk.cz}` : 'none';
      return `Harlyao beacon: active=${data.active} area=${data.currentArea || '-'} zone=${data.zoneId || '-'} chunk=${chunk} radius=${data.radiusTiles} intensity=${data.intensity.toFixed(2)} armyVisible=${data.armyVisible}`;
    },
    __test: Object.freeze({ chunkCenter }),
  });

  watchBanditCombat();
  loadConfig().then(() => {
    if (installGlow() || typeof window.setInterval !== 'function') return;
    const retry = window.setInterval(() => {
      if (installGlow()) window.clearInterval?.(retry);
    }, 250); // Covers dev/tool load orders where Ghostify arrives after this adapter.
  });
})();
