(() => {
  'use strict';

  // Southern Cloud Forest mist + non-invasive sky/lighting integration.
  // The original skydome/material rendering paths remain authoritative.
  // Shared with game.js's render loop: the shell/target outline passes draw
  // straight into _mainRT with real depth, with no idea the mist cylinders
  // add extra atmospheric haze beyond the scene's own regular fog -- so an
  // outline on something genuinely behind the mist would otherwise come out
  // fully crisp, reading as a cutout hole in the haze around it. Tagging
  // mist meshes with this layer (in addition to their default one) lets the
  // render loop redraw just them, after those outline passes, so they
  // re-cover any outline drawn on something the mist should still obscure.
  const MIST_REDRAW_LAYER = 5;
  let deps = null;
  let group = null;
  let texture = null;
  const layers = [];
  let attachedScene = null;
  let fogDayColor = null;
  let fogTimeColor = null;
  let fogResultColor = null;
  let lastFogLightingBucket = '';

  // Layer radii used to be 5 / 8.33 / (tied 1:1 to the vegetation cull
  // radius, then 34) — scaled down here by the same ~0.44 ratio the cull
  // radius default dropped by (34 -> 15), since the full-size mist was a
  // real contributor to reported choppiness in this zone. Both radius and
  // opacity are now independently live-adjustable per layer (see
  // setLayerRadius/setLayerOpacity and their Settings-tab sliders) — these
  // are just the startup defaults.
  const LAYER_CONFIG = [
    { defaultRadiusTiles: 2.2, height: 6.5, defaultOpacity: 0.14, repeatX: 5, repeatY: 1.3, driftSpeed: 0.007, spinSpeed: 0.012 },
    { defaultRadiusTiles: 3.7, height: 8.5, defaultOpacity: 0.26, repeatX: 7, repeatY: 1.7, driftSpeed: -0.005, spinSpeed: -0.008 },
    { defaultRadiusTiles: 15, height: 10.5, defaultOpacity: 0.46, repeatX: 9, repeatY: 2.1, driftSpeed: 0.004, spinSpeed: 0.006 },
  ];
  // Mutable per-layer live state, read every frame in update() — separate
  // from LAYER_CONFIG (which stays the fixed startup defaults) so a
  // Settings-tab slider can change these without touching the defaults.
  const layerLive = LAYER_CONFIG.map(cfg => ({ radiusTiles: cfg.defaultRadiusTiles, opacity: cfg.defaultOpacity }));
  const ATMOSPHERE_CONFIG_PATH = './config/atmosphere-lighting.json';
  const DEFAULT_TUNING = Object.freeze({
    cloudForest: Object.freeze({
      dayFogColor: '#ffffff',
      nightTintStartOverlayAlpha: 0.12,
      nightTintFullOverlayAlpha: 0.80,
      dayTintAmount: 0.18,
      nightTintAmount: 0.97,
      matchBackgroundToFog: true,
    }),
    lantern: Object.freeze({
      radiusTiles: 3.6,
      clarityRadiusTiles: 0.95,
      centerMaskAlpha: 0.92,
      clarityMaskAlpha: 0.80,
      softMaskAlpha: 0.28,
      softTransitionFraction: 0.18,
    }),
  });
  let tuning = {
    cloudForest: { ...DEFAULT_TUNING.cloudForest },
    lantern: { ...DEFAULT_TUNING.lantern },
  };

  const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));
  const finiteOr = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;

  function debugLog(message, level = 'info') {
    const logger = window.__farmLog || console.log;
    try { logger(`[cloud-forest-fog] ${message}`, level); }
    catch { console.log(`[cloud-forest-fog] ${message}`); }
  }

  function applyAtmosphereTuning(raw) {
    const cloud = raw?.cloudForest || {};
    const lantern = raw?.lantern || {};

    const radiusTiles = Math.max(0.1, finiteOr(lantern.radiusTiles, DEFAULT_TUNING.lantern.radiusTiles));
    const clarityRadiusTiles = Math.max(0, Math.min(
      radiusTiles,
      finiteOr(lantern.clarityRadiusTiles, DEFAULT_TUNING.lantern.clarityRadiusTiles),
    ));

    tuning = {
      cloudForest: {
        dayFogColor: typeof cloud.dayFogColor === 'string' && cloud.dayFogColor.trim()
          ? cloud.dayFogColor.trim()
          : DEFAULT_TUNING.cloudForest.dayFogColor,
        nightTintStartOverlayAlpha: clamp01(finiteOr(
          cloud.nightTintStartOverlayAlpha,
          DEFAULT_TUNING.cloudForest.nightTintStartOverlayAlpha,
        )),
        nightTintFullOverlayAlpha: clamp01(finiteOr(
          cloud.nightTintFullOverlayAlpha,
          DEFAULT_TUNING.cloudForest.nightTintFullOverlayAlpha,
        )),
        dayTintAmount: clamp01(finiteOr(cloud.dayTintAmount, DEFAULT_TUNING.cloudForest.dayTintAmount)),
        nightTintAmount: clamp01(finiteOr(cloud.nightTintAmount, DEFAULT_TUNING.cloudForest.nightTintAmount)),
        matchBackgroundToFog: cloud.matchBackgroundToFog !== false,
      },
      lantern: {
        radiusTiles,
        clarityRadiusTiles,
        centerMaskAlpha: clamp01(finiteOr(lantern.centerMaskAlpha, DEFAULT_TUNING.lantern.centerMaskAlpha)),
        clarityMaskAlpha: clamp01(finiteOr(lantern.clarityMaskAlpha, DEFAULT_TUNING.lantern.clarityMaskAlpha)),
        softMaskAlpha: clamp01(finiteOr(lantern.softMaskAlpha, DEFAULT_TUNING.lantern.softMaskAlpha)),
        softTransitionFraction: clamp01(finiteOr(
          lantern.softTransitionFraction,
          DEFAULT_TUNING.lantern.softTransitionFraction,
        )),
      },
    };

    if (fogDayColor) {
      try { fogDayColor.set(tuning.cloudForest.dayFogColor); }
      catch {
        tuning.cloudForest.dayFogColor = DEFAULT_TUNING.cloudForest.dayFogColor;
        fogDayColor.set(DEFAULT_TUNING.cloudForest.dayFogColor);
      }
    }
  }

  async function loadAtmosphereTuning() {
    try {
      const response = await fetch(ATMOSPHERE_CONFIG_PATH, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      applyAtmosphereTuning(await response.json());
      debugLog(`loaded tweakable lighting settings from ${ATMOSPHERE_CONFIG_PATH}`);
    } catch (error) {
      debugLog(`using built-in atmosphere defaults; ${ATMOSPHERE_CONFIG_PATH} failed: ${error?.message || error}`, 'warn');
    }
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
    mesh.layers.enable(MIST_REDRAW_LAYER);
    group.add(mesh);
    return { mesh, material, config };
  }

  function init(injectedDeps) {
    deps = injectedDeps;
    const THREE = deps.THREE;
    fogDayColor = new THREE.Color(tuning.cloudForest.dayFogColor);
    fogTimeColor = new THREE.Color();
    fogResultColor = new THREE.Color();
    texture = createSprayTexture();
    group = new THREE.Group();
    group.name = 'cloud_forest_mist_cylinders';
    for (let i = 0; i < LAYER_CONFIG.length; i++) layers.push(makeLayer(LAYER_CONFIG[i], i));
    upgradeTextureIfAvailable();
    loadAtmosphereTuning();
  }

  function getFullDayLighting() {
    const state = window.HobunjiSkyDome?.getLightingState?.() || window.WeatherFX?.getLightingState?.();
    return state && Number.isFinite(state.r) ? state : { r: 255, g: 255, b: 255, a: 0 };
  }

  function updateFogLighting(activeScene) {
    if (!fogDayColor || !fogTimeColor || !fogResultColor) return;
    const light = getFullDayLighting();
    fogTimeColor.setRGB(clamp01(light.r / 255), clamp01(light.g / 255), clamp01(light.b / 255));

    const cloudTuning = tuning.cloudForest;
    const startAlpha = cloudTuning.nightTintStartOverlayAlpha;
    const fullAlpha = cloudTuning.nightTintFullOverlayAlpha;
    const alphaSpan = Math.max(0.000001, fullAlpha - startAlpha);
    const nightStrength = clamp01((clamp01(light.a) - startAlpha) / alphaSpan);
    const timeTintAmount = cloudTuning.dayTintAmount
      + nightStrength * (cloudTuning.nightTintAmount - cloudTuning.dayTintAmount);
    fogResultColor.copy(fogDayColor).lerp(fogTimeColor, clamp01(timeTintAmount));

    for (const layer of layers) layer.material.color.copy(fogResultColor);
    if (activeScene?.fog?.color) activeScene.fog.color.copy(fogResultColor);

    if (cloudTuning.matchBackgroundToFog && activeScene?.background?.isColor) {
      activeScene.background.copy(fogResultColor);
    }

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

    const px = deps.player.x / deps.TILE;
    const pz = deps.player.y / deps.TILE;
    const groundY = deps.getPlayerGroundY();
    const t = performance.now() / 1000;

    for (let i = 0; i < layers.length; i++) {
      const { mesh, material, config } = layers[i];
      const live = layerLive[i];
      // Used to skip both draw submission and animation work for a disabled mist layer.
      const opacity = clamp01(live.opacity);
      material.opacity = opacity;
      mesh.visible = opacity > 0;
      if (!mesh.visible) continue;

      const radius = Math.max(0.1, live.radiusTiles);
      mesh.position.set(px, groundY + config.height * 0.5, pz);
      mesh.scale.set(radius, config.height, radius);
      mesh.rotation.y = t * config.spinSpeed;
      material.map.offset.x = (material.map.offset.x + dt * config.driftSpeed) % 1;
      material.map.offset.y = (material.map.offset.y + dt * config.driftSpeed * 0.6) % 1;
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
    const lanternTuning = tuning.lantern;
    for (const carrier of carriers) {
      const center = lightingDeps.worldToOverlay(carrier.x, carrier.y, carrier.z);
      if (!center.visible) continue;
      const shineR = lightScreenRadius(carrier.x, carrier.z, carrier.y, lanternTuning.radiusTiles);
      if (!(shineR > 0)) continue;
      const clarityFrac = clamp01(lanternTuning.clarityRadiusTiles / Math.max(0.000001, lanternTuning.radiusTiles));
      const grad = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, shineR);
      grad.addColorStop(0, `rgba(0,0,0,${lanternTuning.centerMaskAlpha})`);
      grad.addColorStop(clarityFrac, `rgba(0,0,0,${lanternTuning.clarityMaskAlpha})`);
      grad.addColorStop(
        Math.min(1, clarityFrac + lanternTuning.softTransitionFraction),
        `rgba(0,0,0,${lanternTuning.softMaskAlpha})`,
      );
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
      // Enclosed areas still need the carried lantern to clear the darkness layer.
      drawLanternMasksCompat();
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

  // Settings-tab sliders (game.js) call these directly, by layer index
  // (0=inner, 1=middle, 2=outer, matching LAYER_CONFIG's order) — read live
  // every frame in update(), so both take effect on the very next frame.
  function setLayerRadius(index, tiles) {
    if (layerLive[index]) layerLive[index].radiusTiles = Math.max(0.1, Number(tiles) || 0.1);
  }
  function setLayerOpacity(index, value) {
    if (layerLive[index]) layerLive[index].opacity = clamp01(value);
  }

  window.CloudForestFog = {
    init,
    update,
    setLayerRadius,
    setLayerOpacity,
    // Called by the Settings tab's Cloud Forest Fog toggle. update() itself
    // is simply not called at all while disabled (see game.js's per-frame
    // call site), which freezes the mist mid-animation rather than hiding
    // it — this force-hides the group immediately so turning the toggle off
    // is instant. Re-enabling needs no counterpart: the very next update()
    // call sets group.visible from isCloudForestArea() itself.
    setEnabled: (enabled) => { if (!enabled && group) group.visible = false; },
    getDebugState: () => ({
      active: !!deps?.isCloudForestArea?.(),
      area: skyPolicyDeps?.getCurrentArea?.() ?? null,
      fogColor: fogResultColor ? `#${fogResultColor.getHexString()}` : null,
      skydomeSuppressed: !!isNoSkyArea(skyPolicyDeps?.getCurrentArea?.()),
      renderingMode: 'original-skydome-visibility-only',
      lightingAuthority: window.WeatherFX?.__singleFullDayLightingAuthority ? 'full-day-shared' : 'legacy',
      configPath: ATMOSPHERE_CONFIG_PATH,
      tuning: {
        cloudForest: { ...tuning.cloudForest },
        lantern: { ...tuning.lantern },
      },
      layers: layerLive.map(l => ({ ...l })),
    }),
  };
})();