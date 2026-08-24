(() => {
  'use strict';

  // Southern Cloud Forest mist + non-invasive sky/lighting integration.
  // The original skydome/material rendering paths remain authoritative.
  let deps = null;
  let group = null;
  let texture = null;
  const layers = [];
  let attachedScene = null;
  let fogDayColor = null;
  let fogTimeColor = null;
  let fogResultColor = null;
  let lastFogLightingBucket = '';

  const INNER_RADIUS_TILES = 5;
  const MIDDLE_RADIUS_TILES = INNER_RADIUS_TILES * (0.70 / 0.42);
  const LAYER_CONFIG = [
    { radiusTiles: INNER_RADIUS_TILES, height: 6.5, opacity: 0.14, repeatX: 5, repeatY: 1.3, driftSpeed: 0.007, spinSpeed: 0.012 },
    { radiusTiles: MIDDLE_RADIUS_TILES, height: 8.5, opacity: 0.26, repeatX: 7, repeatY: 1.7, driftSpeed: -0.005, spinSpeed: -0.008 },
    { radiusFrac: 1.00, height: 10.5, opacity: 0.46, repeatX: 9, repeatY: 2.1, driftSpeed: 0.004, spinSpeed: 0.006 },
  ];
  const FALLBACK_OUTER_RADIUS_TILES = 34;
  const LANTERN_RADIUS_TILES = 3.6;
  const LANTERN_CLARITY_TILES = 0.95;
  const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));

  function debugLog(message, level = 'info') {
    const logger = window.__farmLog || console.log;
    try { logger(`[cloud-forest-fog] ${message}`, level); }
    catch { console.log(`[cloud-forest-fog] ${message}`); }
  }

  function mulberry32(seed) {
    return () => {
      seed |= 0;
      seed = seed + 0x6D2B79F5 | 0;
      let value = Math.imul(seed ^ seed >>> 15, 1 | seed);
      value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
      return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
  }

  function createSprayTexture() {
    const THREE = deps.THREE;
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const random = mulberry32(0x666f6721);
    ctx.clearRect(0, 0, size, size);
    const stampBlob = (x, y, radius, alpha) => {
      const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);
      grad.addColorStop(0, `rgba(255,255,255,${alpha})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    };
    for (let i = 0; i < 70; i++) {
      const x = random() * size;
      const y = random() * size;
      const radius = 18 + random() * 58;
      const alpha = 0.12 + random() * 0.34;
      for (const dx of [-size, 0, size]) {
        for (const dy of [-size, 0, size]) {
          if (x + dx > -radius && x + dx < size + radius && y + dy > -radius && y + dy < size + radius) {
            stampBlob(x + dx, y + dy, radius, alpha);
          }
        }
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
  }

  function upgradeTextureIfAvailable() {
    const THREE = deps.THREE;
    new THREE.TextureLoader().load(
      'assets/textures/cloud_forest_mist.png',
      loaded => {
        loaded.wrapS = loaded.wrapT = THREE.RepeatWrapping;
        loaded.minFilter = THREE.LinearFilter;
        loaded.magFilter = THREE.LinearFilter;
        for (const layer of layers) {
          layer.material.map = loaded;
          layer.material.needsUpdate = true;
        }
      },
      undefined,
      () => {},
    );
  }

  function makeLayer(config, index) {
    const THREE = deps.THREE;
    const tex = texture.clone();
    tex.image = texture.image;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(config.repeatX, config.repeatY);
    tex.offset.set(index * 0.271, index * 0.133);
    tex.needsUpdate = true;
    const material = new THREE.MeshBasicMaterial({
      map: tex,
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      fog: true,
    });
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 28, 1, true), material);
    mesh.name = `cloud_forest_mist_${index}`;
    mesh.frustumCulled = false;
    mesh.renderOrder = 890 + index;
    mesh.visible = false;
    group.add(mesh);
    return { mesh, material, config };
  }

  function init(injectedDeps) {
    deps = injectedDeps;
    const THREE = deps.THREE;
    fogDayColor = new THREE.Color(0xffffff);
    fogTimeColor = new THREE.Color();
    fogResultColor = new THREE.Color();
    texture = createSprayTexture();
    group = new THREE.Group();
    group.name = 'cloud_forest_mist_cylinders';
    for (let i = 0; i < LAYER_CONFIG.length; i++) layers.push(makeLayer(LAYER_CONFIG[i], i));
    upgradeTextureIfAvailable();
  }

  function getFullDayLighting() {
    const state = window.HobunjiSkyDome?.getLightingState?.() || window.WeatherFX?.getLightingState?.();
    return state && Number.isFinite(state.r) ? state : { r: 255, g: 255, b: 255, a: 0 };
  }

  function updateFogLighting(activeScene) {
    if (!fogDayColor || !fogTimeColor || !fogResultColor) return;
    const light = getFullDayLighting();
    fogTimeColor.setRGB(clamp01(light.r / 255), clamp01(light.g / 255), clamp01(light.b / 255));

    // The previous blend always retained too much white in the fog. Once the
    // full-day lighting reaches dusk/night, drive the actual fog scattering
    // color almost completely toward the same dark atmospheric color.
    const nightStrength = clamp01((clamp01(light.a) - 0.12) / 0.68);
    const timeTintAmount = 0.18 + nightStrength * 0.79;
    fogResultColor.copy(fogDayColor).lerp(fogTimeColor, timeTintAmount);

    for (const layer of layers) layer.material.color.copy(fogResultColor);
    if (activeScene?.fog?.color) activeScene.fog.color.copy(fogResultColor);

    // Cloud Forest intentionally has no skydome. Match the clear/background
    // color to the fog itself so distant mist is not backlit by a daytime-white
    // framebuffer at night.
    if (activeScene?.background?.isColor) activeScene.background.copy(fogResultColor);

    const hour = window.CalendarSystem?.getHour?.() ?? 12;
    const bucket = `${Math.floor(hour)}:${fogResultColor.getHexString()}`;
    if (bucket !== lastFogLightingBucket && [0, 6, 12, 18, 22].includes(Math.floor(hour))) {
      lastFogLightingBucket = bucket;
      debugLog(`fog lighting ${String(Math.floor(hour)).padStart(2, '0')}:00 -> #${fogResultColor.getHexString()}`);
    }
  }

  function update(dt) {
    if (!deps || !group) return;
    const active = deps.isCloudForestArea();
    const activeScene = active ? deps.getActiveScene() : null;
    if (activeScene !== attachedScene) {
      attachedScene?.remove(group);
      activeScene?.add(group);
      attachedScene = activeScene;
    }
    group.visible = active;
    if (!active) return;

    const skyRoot = activeScene?.getObjectByName?.('hobunji_dynamic_skydome');
    if (skyRoot) skyRoot.visible = false;
    updateFogLighting(activeScene);

    const outerRadius = deps.getCloudForestFogRadiusTiles?.() ?? FALLBACK_OUTER_RADIUS_TILES;
    const px = deps.player.x / deps.TILE;
    const pz = deps.player.y / deps.TILE;
    const groundY = deps.getPlayerGroundY();
    const t = performance.now() / 1000;

    for (const layer of layers) {
      const { mesh, material, config } = layer;
      const radius = config.radiusTiles ?? outerRadius * config.radiusFrac;
      mesh.position.set(px, groundY + config.height * 0.5, pz);
      mesh.scale.set(radius, config.height, radius);
      mesh.rotation.y = t * config.spinSpeed;
      material.opacity = config.opacity;
      material.map.offset.x = (material.map.offset.x + dt * config.driftSpeed) % 1;
      material.map.offset.y = (material.map.offset.y + dt * config.driftSpeed * 0.6) % 1;
      mesh.visible = true;
    }
  }

  let skyPolicyDeps = null;
  function isNoSkyArea(area) {
    const id = String(area || '').toLowerCase();
    return id === 'map_southern_cloud_forest'
      || id === 'interior'
      || id.includes('map_i_den_')
      || id.includes('den')
      || id.includes('cavern')
      || id.includes('burrow');
  }

  if (window.RainPlanes) {
    const priorRainInit = window.RainPlanes.init;
    const priorRainUpdate = window.RainPlanes.update;
    window.RainPlanes.init = function (injectedDeps) {
      skyPolicyDeps = injectedDeps;
      return priorRainInit.call(this, injectedDeps);
    };
    window.RainPlanes.update = function (dt) {
      const result = priorRainUpdate.call(this, dt);
      const scene = skyPolicyDeps?.getActiveScene?.();
      const skyRoot = scene?.getObjectByName?.('hobunji_dynamic_skydome');
      if (skyRoot) {
        const area = skyPolicyDeps?.getCurrentArea?.();
        const outside = skyPolicyDeps?.isOutdoorArea?.() !== false;
        skyRoot.visible = outside && !isNoSkyArea(area);
      }
      const area = skyPolicyDeps?.getCurrentArea?.();
      if (scene?.background?.isColor && isNoSkyArea(area) && area !== 'map_southern_cloud_forest') scene.background.set(0x000000);
      return result;
    };
  }

  // WeatherFX originally owns the same 2D lighting/lantern canvas before and
  // after this patch. The only change here is that its outdoor base tint now
  // reads the exact same 24-hour state as the skydome. This removes the
  // overnight 22:00-06:00 disagreement between WeatherFX's legacy stops and
  // the full-day sky stops without changing the rendering architecture.
  let lightingDeps = null;
  let lastUnifiedLightingDraw = 0;
  const lightCamRight = new window.THREE.Vector3();

  function lightScreenRadius(x, z, y, tiles) {
    lightCamRight.setFromMatrixColumn(lightingDeps.camera.matrixWorld, 0);
    const c = lightingDeps.worldToOverlay(x, y, z);
    const e = lightingDeps.worldToOverlay(
      x + lightCamRight.x * tiles,
      y + lightCamRight.y * tiles,
      z + lightCamRight.z * tiles,
    );
    return Math.hypot(e.x - c.x, e.y - c.y);
  }

  function drawLanternMasksCompat() {
    const ctx = lightingDeps.lctx;
    const carriers = [{
      x: lightingDeps.player.x / lightingDeps.TILE,
      y: lightingDeps.getPlayerWorldY() + 0.5,
      z: lightingDeps.player.y / lightingDeps.TILE,
    }];
    const currentArea = lightingDeps.getCurrentArea();
    for (const walker of lightingDeps.npcWalkers) {
      if (walker.area === currentArea && walker.rec?.tags?.includes('watch')) {
        carriers.push({ x: walker.root.position.x, y: walker.root.position.y + 0.5, z: walker.root.position.z });
      }
    }
    ctx.globalCompositeOperation = 'destination-out';
    for (const carrier of carriers) {
      const center = lightingDeps.worldToOverlay(carrier.x, carrier.y, carrier.z);
      if (!center.visible) continue;
      const shineR = lightScreenRadius(carrier.x, carrier.z, carrier.y, LANTERN_RADIUS_TILES);
      if (!(shineR > 0)) continue;
      const clarityFrac = LANTERN_CLARITY_TILES / LANTERN_RADIUS_TILES;
      const grad = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, shineR);
      grad.addColorStop(0, 'rgba(0,0,0,0.92)');
      grad.addColorStop(clarityFrac, 'rgba(0,0,0,0.80)');
      grad.addColorStop(Math.min(1, clarityFrac + 0.18), 'rgba(0,0,0,0.28)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(center.x, center.y, shineR, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawFurnitureLightMasksCompat() {
    const ctx = lightingDeps.lctx;
    const visible = [];
    for (const light of lightingDeps.getFurnitureLightSources()) {
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
      const grad = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, shineR);
      grad.addColorStop(0, `rgba(0,0,0,${strength})`);
      grad.addColorStop(clarityFrac, `rgba(0,0,0,${strength * 0.78})`);
      grad.addColorStop(Math.min(1, clarityFrac + 0.3), `rgba(0,0,0,${strength * 0.22})`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
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

  function drawUnifiedLightingOverlay() {
    if (!lightingDeps?.lctx) return;
    const now = performance.now();
    const lightningAlpha = lightingDeps.getLightningAlpha();
    const sceneTransAlpha = lightingDeps.getSceneTransAlpha();
    if (now - lastUnifiedLightingDraw < 100 && lightningAlpha <= 0 && sceneTransAlpha <= 0) return;
    lastUnifiedLightingDraw = now;

    const ctx = lightingDeps.lctx;
    const rect = lightingDeps.getThreeRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    const currentArea = lightingDeps.getCurrentArea();
    const enclosed = currentArea === 'interior'
      || lightingDeps._isBuildingArea(currentArea)
      || (isNoSkyArea(currentArea) && currentArea !== 'map_southern_cloud_forest');

    if (enclosed) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fillRect(0, 0, rect.width, rect.height);
      drawFurnitureLightMasksCompat();
      if (sceneTransAlpha > 0) {
        ctx.fillStyle = `rgba(0,0,0,${sceneTransAlpha})`;
        ctx.fillRect(0, 0, rect.width, rect.height);
      }
      return;
    }

    const { r, g, b, a } = getFullDayLighting();
    ctx.globalCompositeOperation = a < 0.09 ? 'screen' : 'multiply';
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${a})`;
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.globalCompositeOperation = 'source-over';

    // Same original local-light behavior; no horizon/depth masking or canvas proxy.
    drawLanternMasksCompat();
    drawFurnitureLightMasksCompat();

    if (lightningAlpha > 0) {
      ctx.fillStyle = `rgba(220,240,255,${lightningAlpha * 0.45})`;
      ctx.fillRect(0, 0, rect.width, rect.height);
    }
    if (sceneTransAlpha > 0) {
      ctx.fillStyle = `rgba(0,0,0,${sceneTransAlpha})`;
      ctx.fillRect(0, 0, rect.width, rect.height);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  if (window.WeatherFX && !window.WeatherFX.__singleFullDayLightingAuthority) {
    const priorWeatherInit = window.WeatherFX.init;
    window.WeatherFX.init = function (injectedDeps) {
      lightingDeps = injectedDeps;
      return priorWeatherInit.call(this, injectedDeps);
    };
    window.WeatherFX.drawLightingOverlay = drawUnifiedLightingOverlay;
    window.WeatherFX.__singleFullDayLightingAuthority = true;
  }

  window.CloudForestFog = {
    init,
    update,
    getDebugState: () => ({
      active: !!deps?.isCloudForestArea?.(),
      area: skyPolicyDeps?.getCurrentArea?.() ?? null,
      fogColor: fogResultColor ? `#${fogResultColor.getHexString()}` : null,
      skydomeSuppressed: !!isNoSkyArea(skyPolicyDeps?.getCurrentArea?.()),
      renderingMode: 'original-skydome-visibility-only',
      lightingAuthority: window.WeatherFX?.__singleFullDayLightingAuthority ? 'full-day-shared' : 'legacy',
    }),
  };
})();