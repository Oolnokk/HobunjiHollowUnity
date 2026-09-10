(() => {
  'use strict';

  const CONFIG_URL = 'config/harlyao-night-march.json';
  const FALLBACK_LANTERN = Object.freeze({ radiusTiles: 2.4, clarityRadiusTiles: 0.95, centerMaskAlpha: 0.92, clarityMaskAlpha: 0.80, softMaskAlpha: 0.28, softTransitionFraction: 0.18 });

  let config = null;
  let lightingDeps = null;
  let installed = false;
  let priorDrawLightingOverlay = null;
  let cameraRight = null;
  let extraDraws = 0;
  let drawInstalls = 0;

  const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));

  async function loadConfig() {
    if (config) return config;
    try {
      const response = await fetch(CONFIG_URL);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      config = await response.json();
      return config;
    } catch (error) {
      window.__farmLog?.(`[harlyao-atmosphere] config load failed: ${error.message}`, 'warn', 'render');
      return null;
    }
  }

  function activeSnapshot(area = lightingDeps?.getCurrentArea?.()) {
    const snapshot = window.HarlyaoNightMarch?.debugSnapshot?.();
    if (!snapshot?.scheduled || snapshot.scheduled.zoneId !== area) return null;
    return snapshot;
  }

  function darknessMultiplier(area = lightingDeps?.getCurrentArea?.()) {
    if (!activeSnapshot(area)) return 1;
    return Math.max(1, Number(config?.zoneAtmosphere?.darknessMultiplier) || 2);
  }

  function terrorDarknessAlpha(area = lightingDeps?.getCurrentArea?.()) {
    if (!activeSnapshot(area)) return 0;
    return clamp01(window.HarlyaoTerror?.getDarknessAlpha?.() || 0);
  }

  function terrorLanternRadiusMultiplier(area = lightingDeps?.getCurrentArea?.()) {
    if (!activeSnapshot(area)) return 1;
    return Math.max(0.1, Math.min(1, Number(window.HarlyaoTerror?.getLanternRadiusMultiplier?.()) || 1));
  }

  function lanternTuning() {
    const live = window.CloudForestFog?.getDebugState?.()?.tuning?.lantern;
    const base = live ? { ...FALLBACK_LANTERN, ...live } : { ...FALLBACK_LANTERN };
    const radiusMul = terrorLanternRadiusMultiplier();
    base.radiusTiles *= radiusMul;
    base.clarityRadiusTiles *= radiusMul;
    return base;
  }

  function lightScreenRadius(x, z, y, tiles) {
    if (!cameraRight) cameraRight = new window.THREE.Vector3();
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
    const tuning = lanternTuning();
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
    const visible = [];
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
    const base = window.HobunjiSkyDome?.getLightingState?.() || window.WeatherFX?.getLightingState?.();
    if (!base || !Number.isFinite(Number(base.a))) return null;
    const lunarAddition = Number(window.CloudForestFog?.getDebugState?.()?.lunarDarknessAddition) || 0;
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
    if (!light || light.a < 0.09) return;

    const ctx = lightingDeps.lctx;
    const rect = lightingDeps.getThreeRect();
    const extraPasses = Math.max(1, Math.round(multiplier - 1));
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = `rgba(${light.r}, ${light.g}, ${light.b}, ${light.a})`;
    for (let index = 0; index < extraPasses; index++) ctx.fillRect(0, 0, rect.width, rect.height);

    const terrorAlpha = terrorDarknessAlpha(area);
    if (terrorAlpha > 0) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = `rgba(0,0,0,${terrorAlpha})`;
      ctx.fillRect(0, 0, rect.width, rect.height);
    }
    ctx.globalCompositeOperation = 'source-over';
    drawLanternMasks();
    drawFurnitureLightMasks();
    extraDraws++;
  }

  function drawWithRedrawDetection(...args) {
    if (!lightingDeps?.lctx) return priorDrawLightingOverlay.apply(this, args);
    const ctx = lightingDeps.lctx;
    const originalClearRect = ctx.clearRect;
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
    if ((Number(lightingDeps.getLightningAlpha?.()) || 0) > 0) return result;
    if ((Number(lightingDeps.getSceneTransAlpha?.()) || 0) > 0) return result;
    applyExtraDarkness();
    return result;
  }

  function install(api = window.WeatherFX) {
    if (!api || typeof api.init !== 'function' || typeof api.drawLightingOverlay !== 'function') return false;

    if (!api.__harlyaoNightMarchAtmosphereInitWrapped) {
      const originalInit = api.init;
      api.init = function harlyaoAtmosphereInit(injectedDeps) {
        lightingDeps = injectedDeps;
        return originalInit.call(this, injectedDeps);
      };
      api.__harlyaoNightMarchAtmosphereInitWrapped = true;
    }

    if (!api.drawLightingOverlay.__harlyaoNightMarchAtmosphereWrapped) {
      priorDrawLightingOverlay = api.drawLightingOverlay;
      const wrappedDraw = function harlyaoAtmosphereLightingOverlay(...args) {
        return drawWithRedrawDetection.apply(this, args);
      };
      Object.assign(wrappedDraw, priorDrawLightingOverlay);
      wrappedDraw.__harlyaoNightMarchAtmosphereWrapped = true;
      api.drawLightingOverlay = wrappedDraw;
      drawInstalls++;
    }

    api.__harlyaoNightMarchAtmosphere = true;
    installed = !!api.drawLightingOverlay.__harlyaoNightMarchAtmosphereWrapped;
    return true;
  }

  function debugSnapshot() {
    const area = lightingDeps?.getCurrentArea?.() || null;
    return {
      configReady: !!config,
      installed: !!window.WeatherFX?.drawLightingOverlay?.__harlyaoNightMarchAtmosphereWrapped,
      active: !!activeSnapshot(area),
      area,
      darknessMultiplier: darknessMultiplier(area),
      terrorStacks: window.HarlyaoTerror?.getStacks?.() || 0,
      terrorDarknessAlpha: terrorDarknessAlpha(area),
      lanternRadiusMultiplier: terrorLanternRadiusMultiplier(area),
      extraDraws,
      drawInstalls,
      preservesLanternMasks: true,
      preservesFurnitureLightMasks: true,
    };
  }

  window.HarlyaoNightMarchAtmosphere = Object.freeze({ install, loadConfig, debugSnapshot });
  install();
  loadConfig();
})();
