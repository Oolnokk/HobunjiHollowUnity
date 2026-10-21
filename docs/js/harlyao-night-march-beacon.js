(() => {
  'use strict';

  const CONFIG_URL = 'config/harlyao-night-march.json'; // Shares the army's spectral presentation tuning.
  const SCHEDULER_ID = 'harlyao-commander-beacon'; // World-space presentation runs after native movement, before render.
  let deps = null; // Captured from BanditCombat for scene, player and terrain access.
  let config = null; // Loaded once alongside the march.
  let root = null; // One reusable Three.js marker, detached when inactive.
  let marker = null; // Latest marker position for glow and mobile diagnostics.
  let installed = false; // Guards duplicate scheduler subscriptions.
  const num = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

  function markerPosition(target, player, distance) {
    const dx = target.x - player.x, dz = target.z - player.z; // Ground-plane bearing to the exact commander.
    const length = Math.hypot(dx, dz); // Avoids division by zero when standing at the target.
    const fraction = length > 0 ? Math.min(1, Math.max(1, distance) / length) : 1; // Keep distant bearings within the local view distance.
    return { x: player.x + dx * fraction, z: player.z + dz * fraction, distanceTiles: length, directional: fraction < 1 };
  }

  function targetState() {
    const target = window.HarlyaoNightMarch?.commanderTarget?.(); // Reads a specific actor, including while data-only.
    if (!target || target.zoneId !== deps?.getCurrentArea?.() || !deps?.player || !(deps.TILE > 0)) return null;
    return target;
  }

  function makeMarker() {
    const THREE = window.THREE; // Scene primitives are intentionally volumetric, not authored PNG planes.
    if (!THREE || root) return root;
    const height = Math.max(4, num(config?.visuals?.beaconHeightTiles, 18)); // Visible above ordinary scenery.
    const radius = Math.max(0.1, num(config?.visuals?.beaconRadiusTiles, 0.8)); // Thin column rather than a UI glow patch.
    const color = config?.visuals?.beaconGlowColor || '#b0f0ff'; // Shared spectral locator color.
    root = new THREE.Group();
    root.name = 'HarlyaoCommanderBeacon';
    root.userData.noOutline = true;
    for (let layer = 0; layer < 3; layer++) { // Three cheap nested shells soften the column without textures or lights.
      const geometry = new THREE.CylinderGeometry(radius * (1 + layer * 0.8), radius * (1 + layer * 0.8), height, 8, 1, true); // Allocated once.
      const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.24 / (layer + 1), depthWrite: false, depthTest: false, fog: false, side: THREE.DoubleSide }); // Terrain cannot hide the bearing.
      const shell = new THREE.Mesh(geometry, material); // Reusable world-space child.
      shell.position.y = height * 0.5;
      shell.renderOrder = 900;
      shell.userData.noOutline = true;
      root.add(shell);
    }
    return root;
  }

  function update() {
    const target = targetState(); // Exact commander position after this frame's native movement.
    const scene = deps?.getActiveScene?.(); // Re-entry/regeneration may replace the scene.
    if (!target || !config || !scene) {
      root?.parent?.remove?.(root);
      marker = null;
      return;
    }
    const position = markerPosition(target, { x: deps.player.x / deps.TILE, z: deps.player.y / deps.TILE }, num(config.visuals?.beaconDirectionDistanceTiles, 18)); // Proxy lies on the true compass bearing; nearby it lands on the commander.
    const grid = deps.getActiveGrid?.(); // Height comes from the displayed marker's actual tile.
    const tile = grid?.[Math.floor(position.z)]?.[Math.floor(position.x)]; // Safe at the route's edges.
    const surface = tile ? num(deps.tileSurfaceYInArea?.(tile, target.zoneId)) : 0; // Same terrain sampling as humanoids.
    const visual = makeMarker(); // Lazy creation after Three.js and gameplay are ready.
    if (!visual) return;
    if (visual.parent !== scene) { visual.parent?.remove?.(visual); scene.add(visual); }
    visual.position.set(position.x, surface + 0.15, position.z);
    marker = { ...position, y: surface + 0.15, commanderId: target.id, targetX: target.x, targetZ: target.z };
  }

  function install() {
    if (installed) return true;
    if (!window.RuntimeFrameScheduler?.register) return false;
    window.RuntimeFrameScheduler.register(SCHEDULER_ID, update, {
      phase: 'pre-render', owner: 'HarlyaoNightMarchBeacon',
      description: 'Positions a spectral 3D bearing beacon toward the moving Harlyao commander after native movement.',
    });
    installed = true;
    return true;
  }

  function installBanditDeps(api = window.BanditCombat) {
    if (!api || typeof api.init !== 'function') return false;
    if (api.__harlyaoBeaconInitWrapped) return true;
    const original = api.init.bind(api); // Preserves the army/Porakaneki initialization chain.
    api.init = function harlyaoBeaconBanditInit(injected) { deps = injected; return original(injected); };
    api.__harlyaoBeaconInitWrapped = true;
    return true;
  }

  function watchBanditCombat() {
    if (installBanditDeps()) return;
    const descriptor = Object.getOwnPropertyDescriptor(window, 'BanditCombat'); // Preserve earlier namespace waiters.
    if (descriptor && !descriptor.configurable) return;
    if (typeof descriptor?.set === 'function') {
      Object.defineProperty(window, 'BanditCombat', {
        configurable: true, enumerable: true,
        get() { return descriptor.get?.call(window); },
        set(value) { descriptor.set.call(window, value); installBanditDeps(descriptor.get ? descriptor.get.call(window) : value); },
      });
      return;
    }
    let assigned = descriptor?.value; // Deferred namespace until parser-time loading finishes.
    Object.defineProperty(window, 'BanditCombat', {
      configurable: true, enumerable: true,
      get: () => assigned,
      set(value) {
        assigned = value;
        Object.defineProperty(window, 'BanditCombat', { configurable: true, enumerable: true, writable: true, value });
        installBanditDeps(value);
      },
    });
  }

  async function loadConfig() {
    try {
      const response = await fetch(CONFIG_URL); // Shared authored tuning.
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      config = await response.json();
      return config;
    } catch (error) { window.__farmLog?.(`[harlyao-beacon] ${error.message}`, 'warn', 'visual'); return null; }
  }

  function debugSnapshot() {
    const target = targetState(); // No army debug-array allocation in the render loop.
    return { active: !!target, installed, configReady: !!config, depsReady: !!deps, zoneId: target?.zoneId || null, commander: target, marker, presentation: 'world-space-commander-bearing' };
  }

  window.HarlyaoNightMarchBeacon = Object.freeze({
    loadConfig, update, debugSnapshot,
    ensureWeatherBridge: install, // Legacy Ghostify repair callback now only ensures scheduler installation.
    formatDebug: () => {
      const d = debugSnapshot(); // Existing Pixel Probe includes this copyable report.
      return `Harlyao beacon: active=${d.active} commander=${d.commander?.id || '-'} target=${d.commander ? `${d.commander.x.toFixed(2)},${d.commander.z.toFixed(2)}` : '-'} marker=${d.marker ? `${d.marker.x.toFixed(2)},${d.marker.z.toFixed(2)}` : '-'} space=3D directional=${!!d.marker?.directional}`;
    },
    __test: Object.freeze({ markerPosition }),
  });
  watchBanditCombat();
  loadConfig();
  install();
  window.Ghostify?.registerGlowSource?.(() => marker && targetState() ? {
    x: marker.x, y: marker.y + 5, z: marker.z, radiusTiles: 5, intensity: 0.85,
    color: config?.visuals?.beaconGlowColor || '#b0f0ff',
  } : null); // Reuses the existing darkness-mask owner; the beacon itself is a real 3D object.
})();
