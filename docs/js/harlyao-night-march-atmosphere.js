(() => {
  'use strict';

  const CONFIG_URL = 'config/harlyao-night-march.json'; // Shared march config owns the zone-specific darkness multiplier.
  const FALLBACK_LANTERN = Object.freeze({ radiusTiles: 2.4, clarityRadiusTiles: 0.95, centerMaskAlpha: 0.92, clarityMaskAlpha: 0.80, softMaskAlpha: 0.28, softTransitionFraction: 0.18 }); // Mirrors the unified lighting defaults if atmosphere tuning has not loaded yet.

  let config = null; // Parsed march config used to resolve the requested darkness multiplier.
  let lightingDeps = null; // WeatherFX dependencies used to redraw the exact existing lantern and furniture-light holes after the extra darkness pass.
  let installed = false; // Prevents duplicate WeatherFX wrappers in dynamic/dev loading orders.
  let priorWeatherInit = null; // Preserves the unified WeatherFX init chain.
  let priorDrawLightingOverlay = null; // Preserves CloudForestFog's current full-day lighting authority.
  let cameraRight = null; // Reused Three.js vector for camera-relative screen-radius projection.
  let extraDraws = 0; // Mobile diagnostics count actual extra darkness redraws rather than game-loop calls.

  const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));

  async function loadConfig() {
    if (config) return config;
    try {
      const response = await fetch(CONFIG_URL); // Browser cache normally shares this with the march and music controllers.
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      config = await response.json();
      return config;
    } catch (error) {
      window.__farmLog?.(`[harlyao-atmosphere] config load failed: ${error.message}`, 'warn', 'render');
      return null;
    }
  }

  function activeSnapshot(area = lightingDeps?.getCurrentArea?.()) {
    const snapshot = window.HarlyaoNightMarch?.debugSnapshot?.(); // One authoritative nightly route source; no duplicate schedule math here.
    if (!snapshot?.scheduled || snapshot.scheduled.zoneId !== area) return null;
    return snapshot;
  }

  function darknessMultiplier(area = lightingDeps?.getCurrentArea?.()) {
    if (!activeSnapshot(area)) return 1;
    return Math.max(1, Number(config?.zoneAtmosphere?.darknessMultiplier) || 2);
  }

  function lanternTuning() {
    const live = window.CloudForestFog?.getDebugState?.()?.tuning?.lantern;
    return live ? { ...FALLBACK_LANTERN, ...live } : FALLBACK_LANTERN; // Uses the same live Settings/config values as the first lighting pass.
  }

  function lightScreenRadius(x, z, y, tiles) {
    if (!cameraRight) cameraRight = new window.THREE.Vector3(); // Allocated once after THREE exists.
    cameraRight.setFromMatrixColumn(lightingDeps.camera.matrixWorld, 0);
    const center = lightingDeps.worldToOverlay(x, y, z);
    const edge = lightingDeps.worldToOverlay(
      x + cameraRight.x * tiles,
      y + cameraRight.y * tiles,
      z + cameraRight.z * tiles,
    );
    return Math.hypot(edge.x - center.x, edge.y - center.y);
  }

  function drawLanternMasks() {
    const ctx = lightingDeps.lctx;
    const tuning = lanternTuning(); // Same player/watch lantern shape used by the unified base pass.
    const carriers = [{
      x: lightingDeps.player.x / lightingDeps.TILE,
      y: lightingDeps.getPlayerWorldY() + 0.5,
      z: lightingDeps.player.y / lightingDeps.TILE,
    }];
    const area = lightingDeps.getCurrentArea();
    for (const walker of (lightingDeps.npcWalkers || [])) {
      if (walker.area === area && walker.rec?.tags?.includes('watch')) carriers.push({ x: walker.root.position.x, y: walker.root.position.y + 0.5, z: walker.root.position.z });
    }

    ctx.globalCompositeOperation = 'destination-out';
    for (const carrier of carriers) {
      const center = lightingDeps.worldToOverlay(carrier.x, carrier.y, carrier.z);
      if (!center.visible) continue;
      const shineR = lightScreenRadius(carrier.x, carrier.z, carrier.y, tuning.radiusTiles);
      if (!(shineR > 0)) continue;
      const clarityFrac = clamp01(tuning.clarityRadiusTiles / Math.max(0.000001, tuning.radiusTiles));
      const gradient = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, shineR);
      gradient.addColorStop(0, `rgba(0,0,0,${tuning.centerMaskAlpha})`);
      gradient.addColorStop(clarityFrac, `rgba(0,0,0,${tuning.clarityMaskAlpha})`);
      gradient.addColorStop(Math.min(1, clarityFrac + tuning.softTransitionFraction), `rgba(0,0,0,${tuning.softMaskAlpha})`);
      gradient.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(center.x, center.y, shineR, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawFurnitureLightMasks() {
    const ctx = lightingDeps.lctx;
    const visible = []; // Stores projected real light sources so the existing warm glow can be redrawn after clearing the extra darkness.
    for (const light of (lightingDeps.getFurnitureLightSources?.() || [])) {
      const center = lightingDeps.worldToOverlay(light.x, light.y, light.z);
      if (!center.visible) continue;
      const shineR = lightScreenRadius(light.x, light.z, light.y, light.distance);
      if (!(shineR > 0)) continue;
      visible.push({ light, center, shineR });
    }

    ctx.globalCompositeOperation = 'destination-out';
    for (const { light, center, shineR } of visible) {
      const clarityFrac = Math.min(0.55, Math.max(0.18, 1.15 / light.distance));
      const strength = Math.min(0.94, 0.58 + light.intensity * 0.22);
      const gradient = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, shineR);
      gradient.addColorStop(0, `rgba(0,0,0,${strength})`);
      gradient.addColorStop(clarityFrac, `rgba(0,0,0,${strength * 0.78})`);
      gradient.addColorStop(Math.min(1, clarityFrac + 0.3), `rgba(0,0,0,${strength * 0.22})`);
      gradient.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(center.x, center.y, shineR, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalCompositeOperation = 'source-over';
    for (const { light, center, shineR } of visible) {
      const glowR = shineR * 0.62;
      const glowAlpha = Math.min(0.18, 0.055 + light.intensity * 0.055);
      const { r, g, b } = light.color;
      const glow = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, glowR);
      glow.addColorStop(0, `rgba(${r},${g},${b},${glowAlpha})`);
      glow.addColorStop(0.4, `rgba(${r},${g},${b},${glowAlpha * 0.45})`);
      glow.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(center.x, center.y, glowR, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function currentOutdoorLighting() {
    const base = window.HobunjiSkyDome?.getLightingState?.() || window.WeatherFX?.getLightingState?.(); // Same full-day color source used by CloudForestFog's unified base pass.
    if (!base || !Number.isFinite(Number(base.a))) return null;
    const lunarAddition = Number(window.CloudForestFog?.getDebugState?.()?.lunarDarknessAddition) || 0; // Preserves the existing lunar-phase darkness adjustment.
    return {
      r: Number(base.r) || 0,
      g: Number(base.g) || 0,
      b: Number(base.b) || 0,
      a: clamp01(Number(base.a) + lunarAddition),
    };
  }

  function applyExtraDarkness() {
    const area = lightingDeps?.getCurrentArea?.();
    const multiplier = darknessMultiplier(area);
    if (multiplier <= 1) return;
    const light = currentOutdoorLighting();
    if (!light || light.a < 0.09) return; // March hours are nighttime; never duplicate daytime screen-brightening behavior.

    const ctx = lightingDeps.lctx;
    const rect = lightingDeps.getThreeRect();
    const extraPasses = Math.max(1, Math.round(multiplier - 1)); // A multiplier of 2 means one additional copy of the exact existing darkness pass.
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = `rgba(${light.r}, ${light.g}, ${light.b}, ${light.a})`;
    for (let index = 0; index < extraPasses; index++) ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.globalCompositeOperation = 'source-over';

    // The extra darkness is global first, then the exact same local-light holes are punched back out.
    // This keeps lanterns/furniture lights at their authored clarity instead of making the light itself twice as dim.
    drawLanternMasks();
    drawFurnitureLightMasks();
    extraDraws++;
  }

  function drawWithRedrawDetection(...args) {
    if (!lightingDeps?.lctx) return priorDrawLightingOverlay.apply(this, args);
    const ctx = lightingDeps.lctx;
    const originalClearRect = ctx.clearRect; // CloudForestFog starts every real 10Hz lighting redraw with clearRect; observing it avoids stacking extra darkness on skipped frames.
    let redrew = false;
    try {
      ctx.clearRect = function harlyaoObservedClearRect(...clearArgs) {
        redrew = true;
        return originalClearRect.apply(this, clearArgs);
      };
    } catch {}

    let result;
    try { result = priorDrawLightingOverlay.apply(this, args); }
    finally {
      try { ctx.clearRect = originalClearRect; } catch {}
    }
    if (!redrew) return result;

    const area = lightingDeps.getCurrentArea?.();
    if (!activeSnapshot(area)) return result;
    if ((Number(lightingDeps.getLightningAlpha?.()) || 0) > 0) return result; // Lightning should remain a flash on top of darkness, not be immediately multiplied back down.
    if ((Number(lightingDeps.getSceneTransAlpha?.()) || 0) > 0) return result; // Never punch lantern holes through a fade-to-black transition.
    applyExtraDarkness();
    return result;
  }

  function install(api = window.WeatherFX) {
    if (installed) return true;
    if (!api || typeof api.init !== 'function' || typeof api.drawLightingOverlay !== 'function') return false;
    priorWeatherInit = api.init;
    priorDrawLightingOverlay = api.drawLightingOverlay;
    api.init = function harlyaoAtmosphereInit(injectedDeps) {
      lightingDeps = injectedDeps;
      return priorWeatherInit.call(this, injectedDeps);
    };
    api.drawLightingOverlay = drawWithRedrawDetection;
    api.__harlyaoNightMarchAtmosphere = true;
    installed = true;
    return true;
  }

  function debugSnapshot() {
    const area = lightingDeps?.getCurrentArea?.() || null;
    return {
      configReady: !!config,
      installed,
      active: !!activeSnapshot(area),
      area,
      darknessMultiplier: darknessMultiplier(area),
      extraDraws,
      preservesLanternMasks: true,
      preservesFurnitureLightMasks: true,
    };
  }

  window.HarlyaoNightMarchAtmosphere = Object.freeze({ install, loadConfig, debugSnapshot }); // Exposed for mobile QA and static regressions.
  install(); // Must wrap WeatherFX before Ghostify so the spectral formation glow is drawn after this extra darkness pass.
  loadConfig();
})();
