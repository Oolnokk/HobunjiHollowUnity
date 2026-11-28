(() => {
  'use strict';

  // Southern Cloud Forest mist (also reused for Western Slope blowing snow) + non-invasive sky/lighting integration.
  // The original skydome/material rendering paths remain authoritative.
  // The outline pass uses the existing world depth; its mist redraw needs only the three cylinders.
  const MIST_REDRAW_LAYER = globalThis.HobunjiRenderLayers?.MIST_REDRAW ?? 5; // Named in js/render-layers.js.
  let deps = null;
  let group = null;
  let redrawScene = null; // Holds lightweight copies that share the live mist geometry and materials.
  let lastRedrawLayerCount = 0; // Reported by the mobile lighting snapshot.
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
    { defaultRadiusTiles: 4, height: 6.5, defaultOpacity: 0.14, repeatX: 5, repeatY: 1.3, driftSpeed: 0.007, spinSpeed: 0.012 },
    { defaultRadiusTiles: 3.7, height: 8.5, defaultOpacity: 0.26, repeatX: 7, repeatY: 1.7, driftSpeed: -0.005, spinSpeed: -0.008 },
    { defaultRadiusTiles: 15, height: 10.5, defaultOpacity: 0.46, repeatX: 9, repeatY: 2.1, driftSpeed: 0.004, spinSpeed: 0.006 },
  ];
  // Mutable per-layer live state, read every frame in update() — separate
  // from LAYER_CONFIG (which stays the fixed startup defaults) so a
  // Settings-tab slider can change these without touching the defaults.
  const layerLive = LAYER_CONFIG.map(cfg => ({ radiusTiles: cfg.defaultRadiusTiles, opacity: cfg.defaultOpacity }));
  const WESTERN_SLOPE_ID = 'map_western_slope'; // Enables the existing three mist cylinders for outdoor blowing snow, not for Slope interiors.
  const SLOPE_FADE_SECONDS = 0.7; // Eases the snow haze as wind and precipitation change without sudden white walls.
  const SLOPE_TINT_REFRESH_SECONDS = 0.2; // Daylight tint changes slowly, so five refreshes/second avoid costly sky diagnostics every frame.
  let lastSlopeTintSeconds = -Infinity; // Updated only when snow is visible, reset when leaving the Western Slope.
  let slopeOpacityScale = 0; // Multiples each Cloud Forest layer opacity; 1 is the absolute Slope blizzard cap.
  let slopeTargetScale = 0; // Last sampled weather/wind target for the mobile diagnostic snapshot.
  let slopeGustStrength = 0; // Shared WeatherWind gust component, exposed for mobile weather diagnostics.
  let slopeWindStrength = 0; // Actual 0..1 wind strength used for lifting snow and shared with wind SFX.
  let slopePrecipitationStrength = 0; // Active snowfall intensity read from WeatherFX, not the daily forecast label.
  const ATMOSPHERE_CONFIG_PATH = './config/atmosphere-lighting.json';
  // Mines, animal dens and the Kanthic ruin borrow the Cloud Forest's
  // midnight look instead of a flat near-black overlay: the skydome's deepest
  // night stop for the overlay, plus near-black fog and mist that swallow the
  // distance while nearby things stay readable.
  const UNDERGROUND_NIGHT_LIGHTING = Object.freeze({ r: 5, g: 8, b: 23, a: 0.80 });
  const TZATZUL_NEST_LIGHTING = Object.freeze({ r: 18, g: 22, b: 31, a: 0.68 }); // Abduction arenas keep cave-colored mist but retain roughly a third of the unlit image for boss/hatchling readability.
  // Independent Kanthic defaults, expressed relative to the shared live sliders.
  // Inner shells darken with the Cloud Forest texture; the outer shell is solid black.
  const KANTHIC_MIST_PROFILE = Object.freeze([
    Object.freeze({ radius: 1.25, opacity: 0.42 }),
    Object.freeze({ radius: 2.25, opacity: 0.78 }),
    Object.freeze({ radius: 4.5, opacity: 1 }),
  ]); // Used by the existing three player-centered meshes only.
  const KANTHIC_CAMERA_MIST_LEAD = 0.75; // Keep the lens inside the inner shell while centering its view just ahead of it.
  const KANTHIC_CAMERA_LANTERN_DEPTH = 2.25; // Project the existing sub-tile light from a stable point along the active camera's view ray.
  const KANTHIC_VOID_HEIGHT = 128; // Span the shaft above and below the player without adding cylinder segments.
  const KANTHIC_STANDARD_DARKNESS_ALPHA = 0.95; // Kanthic uses the same unified mist/night darkness pass at higher opacity, never a second vignette.
  const RUIN_SCREEN_TINT_ALPHA = 0.07; // Used once per ruin lighting redraw for a gentle full-screen tradition tint.
  const RUIN_SCREEN_TINT = Object.freeze({
    hronal: Object.freeze([145, 73, 48]),
    tothal: Object.freeze([78, 112, 168]),
    kanthic: Object.freeze([96, 83, 140]),
  }); // Subtle colored ambience over the complete viewport, not over projected room-shaped polygons.
  const UNDERGROUND_FOG_DENSITY = 0.055; // Same as map_southern_cloud_forest's fogDensity.
  let undergroundFogOverride = null; // { scene, fog, background } restored when the player leaves.
  const GLOBAL_DARKNESS_DELTA = 0.09; // Added to the previous mine/den/interior darkness levels and scaled by lunar phase for outdoor night darkness.
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
      radiusTiles: 2.4,
      clarityRadiusTiles: 0.95,
      centerMaskAlpha: 0.92,
      clarityMaskAlpha: 0.80,
      softMaskAlpha: 0.28,
      softTransitionFraction: 0.18,
      weatherTintRetentionAlpha: 0.20,
    }),
  });
  let tuning = {
    cloudForest: { ...DEFAULT_TUNING.cloudForest },
    lantern: { ...DEFAULT_TUNING.lantern },
  };

  const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));
  const finiteOr = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const smoothstep01 = value => { const t = clamp01(value); return t * t * (3 - 2 * t); }; // Used by lunarNightWindowStrength() to match the skydome's dusk/dawn easing.

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
        weatherTintRetentionAlpha: clamp01(finiteOr(
          lantern.weatherTintRetentionAlpha,
          DEFAULT_TUNING.lantern.weatherTintRetentionAlpha,
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
    group.add(mesh);

    const redrawMesh = new THREE.Mesh(mesh.geometry, material); // Shares texture animation and tint with the base pass.
    redrawMesh.matrixAutoUpdate = false;
    redrawMesh.frustumCulled = false;
    redrawMesh.renderOrder = mesh.renderOrder;
    redrawMesh.layers.set(MIST_REDRAW_LAYER);
    redrawScene.add(redrawMesh);
    const voidMaterial = index === LAYER_CONFIG.length - 1 ? new THREE.MeshBasicMaterial({
      color: 0x000000, transparent: true, opacity: 1, side: THREE.BackSide,
      depthWrite: false, depthTest: true, fog: false,
    }) : null; // The outer Kanthic shell must not inherit the cloud texture's transparent holes.
    return { mesh, material, config, redrawMesh, voidMaterial };
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
    redrawScene = new THREE.Scene();
    redrawScene.name = 'cloud_forest_mist_redraw';
    redrawScene.userData.cloudForestMistRedraw = true;
    redrawScene.autoUpdate = false;
    for (let i = 0; i < LAYER_CONFIG.length; i++) layers.push(makeLayer(LAYER_CONFIG[i], i));
    upgradeTextureIfAvailable();
    loadAtmosphereTuning();
  }

  function currentMoonIllumination() {
    const value = window.HobunjiSkyDome?.lunarIllumination?.(); // Reuses the skydome's existing 28-day lunar-month phase calculation so lighting and the rendered moon cannot disagree.
    return Number.isFinite(value) ? clamp01(value) : 1;
  }

  function lunarNightWindowStrength() {
    const rawHour = Number(window.CalendarSystem?.getHour?.()); // Used to confine lunar darkness to the same dusk-through-dawn window as the skydome.
    if (!Number.isFinite(rawHour)) return 0;
    const hour = rawHour < 12 ? rawHour + 24 : rawHour;
    if (hour < 18) return 0;
    if (hour < 20) return smoothstep01((hour - 18) / 2);
    if (hour < 29) return 1;
    if (hour < 31) return 1 - smoothstep01((hour - 29) / 2);
    return 0;
  }

  function currentLunarDarknessAddition() {
    const newMoonStrength = 1 - currentMoonIllumination(); // Used below so day 14/full moon preserves the existing darkness while the month boundary approaches the new darker target.
    return GLOBAL_DARKNESS_DELTA * newMoonStrength * lunarNightWindowStrength();
  }

  function getFullDayLighting() {
    const state = window.HobunjiSkyDome?.getLightingState?.() || window.WeatherFX?.getLightingState?.();
    const base = state && Number.isFinite(state.r) ? state : { r: 255, g: 255, b: 255, a: 0 }; // Base full-moon lighting state before lunar darkness is added.
    return { ...base, a: clamp01(base.a + currentLunarDarknessAddition()) };
  }

  function updateFogLighting(activeScene, light = getFullDayLighting()) {
    if (!fogDayColor || !fogTimeColor || !fogResultColor) return;
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

  // Swaps in dark fog on an underground scene (which has none of its own
  // tuned for this) and puts the original back once the player leaves it.
  function syncUndergroundFog(scene) {
    if (undergroundFogOverride?.scene === scene) return;
    if (undergroundFogOverride) {
      const { scene: prior, fog, background } = undergroundFogOverride;
      prior.fog = fog;
      prior.background = background;
      undergroundFogOverride = null;
    }
    if (!scene) return;
    undergroundFogOverride = { scene, fog: scene.fog, background: scene.background };
    scene.fog = new deps.THREE.FogExp2(0x000000, UNDERGROUND_FOG_DENSITY);
    if (scene.background?.isColor) scene.background = scene.background.clone();
  }

  function westernSlopeSnowOpacity(precipitation, windStrength) {
    const snow = Math.max(0, finiteOr(precipitation, 0));
    if (snow >= 3) return 1; // Full blizzard cannot exceed the Cloud Forest per-layer opacity ceiling.
    // At lower wind strengths the loose snow stays on the ground. Wind lifts
    // more of it continuously, even in clear weather, without artificial gusts.
    const liftedSnow = clamp01((windStrength - 0.68) / 0.27);
    const fallingSnow = clamp01(snow / 3);
    return Math.min(0.88, liftedSnow * (0.58 + 0.15 * fallingSnow)
      + (snow > 0 ? fallingSnow * 0.13 : 0));
  }

  function update(dt) {
    if (!deps || !group) return;
    const currentArea = deps.getCurrentArea?.(); // One area read determines both lighting and which 3D mist policy applies.
    const cloudForest = deps.isCloudForestArea();
    const westernSlope = currentArea === WESTERN_SLOPE_ID;
    const shiftBlizzard = window.TothalBlizzard?.stormIntensityFor?.(currentArea) || 0; // The same windblown snow density pipeline now applies to all four wilderness zones.
    const snowy = westernSlope || shiftBlizzard > 0;
    const underground = !cloudForest && !snowy && isUndergroundFogArea(currentArea);
    const active = cloudForest || underground || snowy;
    const mistActive = active; // Kanthic uses the actual Cloud Forest mist cylinders and underground depth fog.
    const kanthicMist = underground && currentArea === 'map_i_dev_random_ruin'; // Underground ruin mist is already restricted to Kanthic by isUndergroundFogArea.
    if (snowy) {
      const snowStrength = window.WeatherFX?.getPrecipitationStrength?.();
      slopePrecipitationStrength = Math.max(shiftBlizzard * 6, Number.isFinite(snowStrength) ? snowStrength
        : (deps.calendar?.isRaining ? Math.max(0, Number(deps.calendar.rainStrength) || 0) : 0));
      slopeWindStrength = clamp01(window.WeatherWind?.getStrengthForArea?.(currentArea) ?? 0); // Preserve the ordinary normalized mist contract.
      slopeGustStrength = clamp01(window.WeatherWind?.gustForArea?.(currentArea) ?? 0);
      slopeTargetScale = Math.max(westernSlopeSnowOpacity(slopePrecipitationStrength, slopeWindStrength), shiftBlizzard);
      const elapsed = Math.max(0, Math.min(0.25, Number(dt) || 0)); // Clamp long tab-resume frames; never overshoot the Cloud Forest cap.
      slopeOpacityScale += (slopeTargetScale - slopeOpacityScale) * (1 - Math.exp(-elapsed / SLOPE_FADE_SECONDS));
      if (Math.abs(slopeOpacityScale - slopeTargetScale) < 0.0005) slopeOpacityScale = slopeTargetScale;
    } else {
      slopeOpacityScale = slopeTargetScale = slopeGustStrength = slopeWindStrength = slopePrecipitationStrength = 0;
      lastSlopeTintSeconds = -Infinity; // Entering the Slope again must refresh its sky-lit mist immediately.
    }

    const activeScene = active ? deps.getActiveScene() : null;
    if (activeScene !== attachedScene) {
      attachedScene?.remove(group);
      activeScene?.add(group);
      attachedScene = activeScene;
    }
    syncUndergroundFog(underground && mistActive ? activeScene : null); // Never replace the Western Slope's or Cloud Forest's native depth fog.
    group.visible = mistActive && (!westernSlope || slopeOpacityScale > 0.002); // Cloud Forest remains native; calm Slope skips mist.
    if (!active || (snowy && !group.visible)) return; // Calm air skips lighting colors as well as all geometry/outline work.

    if (cloudForest) {
      const skyRoot = namedInScene(activeScene, 'hobunji_dynamic_skydome');
      if (skyRoot) skyRoot.visible = false;
      updateFogLighting(activeScene);
    } else if (snowy) {
      // Snow uses the outdoor day/night palette, but sky state and lunar
      // diagnostics are too expensive to re-query at every rendered frame.
      // The Slope's own scene fog, skydome and background remain untouched.
      const tintSeconds = performance.now() / 1000;
      if (tintSeconds - lastSlopeTintSeconds >= SLOPE_TINT_REFRESH_SECONDS) {
        lastSlopeTintSeconds = tintSeconds;
        const light = getFullDayLighting();
        fogTimeColor.setRGB(clamp01(light.r / 255), clamp01(light.g / 255), clamp01(light.b / 255));
        fogResultColor.set(0xffffff).lerp(fogTimeColor, 0.3);
        for (const layer of layers) layer.material.color.copy(fogResultColor);
      }
    } else {
      updateFogLighting(activeScene, undergroundLightingForArea(currentArea));
      if (kanthicMist) {
        // Black mist only subtracts visibility; it cannot brighten the outer void.
        for (const layer of layers) layer.material.color.setHex(0x000000);
        activeScene?.fog?.color?.setHex(0x000000);
        if (activeScene?.background?.isColor) activeScene.background.setHex(0x000000);
      }
    }

    if (!group.visible) return; // Clear calm weather submits no mist meshes or outline redraw.
    const px = deps.player.x / deps.TILE;
    const pz = deps.player.y / deps.TILE;
    const groundY = deps.getPlayerGroundY();
    const t = performance.now() / 1000;
    const strengthScale = cloudForest ? 1 : snowy ? slopeOpacityScale : 1; // All non-Kanthic biomes retain their original opacity policy.
    const driftScale = snowy ? 1.5 + (slopeWindStrength + shiftBlizzard) * 2.5 + (slopePrecipitationStrength >= 3 ? 2.5 : 0) : 1; // Extreme shift adds drift beyond normalized ambient wind.
    for (let i = 0; i < layers.length; i++) {
      const { mesh, material, config, redrawMesh, voidMaterial } = layers[i];
      const live = layerLive[i];
      const profile = kanthicMist ? KANTHIC_MIST_PROFILE[i] : null; // Retain relative slider control without affecting the outdoor defaults.
      const useVoid = !!(profile && voidMaterial);
      const effectiveMaterial = useVoid ? voidMaterial : material; // Shared by the base and outline redraw, with no new draw calls.
      mesh.material = redrawMesh.material = effectiveMaterial;
      const opacity = clamp01(clamp01(live.opacity) * (profile ? profile.opacity / config.defaultOpacity : strengthScale));
      effectiveMaterial.opacity = opacity;
      mesh.visible = opacity > 0.002;
      if (!mesh.visible) continue;

      const radius = Math.max(0.1, profile ? live.radiusTiles * profile.radius / config.defaultRadiusTiles : live.radiusTiles);
      const height = useVoid ? KANTHIC_VOID_HEIGHT : config.height; // Tall outer shell prevents the abyss showing through the open shaft sides.
      mesh.position.set(px, useVoid ? groundY : groundY + height * 0.5, pz);
      mesh.scale.set(radius, height, radius);
      mesh.rotation.y = t * config.spinSpeed;
      material.map.offset.x = (material.map.offset.x + dt * config.driftSpeed * driftScale) % 1;
      material.map.offset.y = (material.map.offset.y + dt * config.driftSpeed * 0.6 * driftScale) % 1;
    }
  }

  function renderOutlineMist(renderer, camera, scene) {
    lastRedrawLayerCount = 0;
    if (!group?.visible || attachedScene !== scene || group.parent !== scene) return;

    for (const { mesh, redrawMesh } of layers) {
      redrawMesh.visible = mesh.visible && mesh.material.opacity > 0;
      if (!redrawMesh.visible) continue;
      redrawMesh.matrixWorld.copy(mesh.matrixWorld); // The base pass already applied gameplay and developer overrides.
      lastRedrawLayerCount++;
    }
    if (!lastRedrawLayerCount) return;

    redrawScene.fog = scene.fog;
    const previousMask = camera.layers.mask; // Restored even if the renderer throws.
    const autoClear = renderer.autoClear; // Preserve the world color, depth and stencil already in the target.
    try {
      camera.layers.set(MIST_REDRAW_LAYER);
      renderer.autoClear = false;
      renderer.render(redrawScene, camera);
    } finally {
      renderer.autoClear = autoClear;
      camera.layers.mask = previousMask;
    }
  }

  const MINE_DARKNESS_OVERLAY_ALPHA = 0.99; // Raised from 0.90 so untouched mine-screen edges retain only about one percent of the rendered image.
  const DEN_DARKNESS_OVERLAY_ALPHA = clamp01(0.82 + GLOBAL_DARKNESS_DELTA); // Applies the mine's +0.09 darkness change to the previous den level.
  const INTERIOR_DARKNESS_OVERLAY_ALPHA = 0.80; // Unlit building areas retain twenty percent of their image; windows and lamps reveal local pools.
  const INTERIOR_LIGHT_RADIUS_MULTIPLIER = 2.5; // Extends the room-light transition so illumination eases into base darkness over more floor space.

  let skyPolicyDeps = null;
  function isCloudForestMap(area) { return area === 'map_southern_cloud_forest' || area === 'map_opening_cloud_forest'; } // The temporary rescue map shares the biome's sky and mist policy.
  function isNoSkyArea(area) {
    const id = String(area || '').toLowerCase();
    return isCloudForestMap(id)
      || id === 'interior'
      || id === 'map_i_dev_random_ruin'
      || id.includes('map_i_den_')
      || id.includes('den')
      || id.includes('cavern')
      || id.includes('burrow');
  }

  function isMineArea(area) {
    const id = String(area || '').toLowerCase();
    return id === 'map_i_town_mine_safe' || id.startsWith('map_i_town_mine_f_');
  }

  function isDenArea(area) {
    const id = String(area || '').toLowerCase(); // Random Test Ruin opts into the exact den darkness/lantern policy without pretending to be a persistent animal-den map.
    return id.startsWith('map_i_den_') || id === 'map_i_dev_random_ruin';
  }

  function isTzatzulNestArea(area) {
    return String(area || '').toLowerCase().startsWith('map_i_den_tzatzul_'); // Only the four authored Tzatzul abduction caves use the brighter encounter profile.
  }

  function undergroundLightingForArea(area) {
    return isTzatzulNestArea(area) ? TZATZUL_NEST_LIGHTING : UNDERGROUND_NIGHT_LIGHTING; // Shared by physical cave mist and the overlaid nighttime tint.
  }

  function enclosedDarknessOverlayAlpha(area) {
    if (String(area || '').toLowerCase() === 'map_i_dev_random_ruin') {
      const testSettings = window.DevRandomRuin?.getDarknessSettings?.(); // Random Test Ruin defaults bright for inspection while retaining an explicit den-darkness preview control.
      const rawSeverity = Number(testSettings?.severity);
      const severity = Number.isFinite(rawSeverity) ? clamp01(rawSeverity) : 1;
      const tradition = window.DevRandomRuinLichThemes?.activeTheme?.() || window.DevRandomRuin?.getRuntimeContext?.()?.theme; // The lich's seeded tradition also owns darkness; no dev-only bright default in live ruins.
      const base = tradition === 'kanthic' ? 1 : tradition === 'hronal' ? .91 : tradition === 'tothal' ? .73 : DEN_DARKNESS_OVERLAY_ALPHA;
      return testSettings?.enabled === true ? base * severity : base;
    }
    if (isMineArea(area)) return MINE_DARKNESS_OVERLAY_ALPHA;
    if (isTzatzulNestArea(area)) return TZATZUL_NEST_LIGHTING.a; // Same brightness whether Cloud Forest Mist is enabled or disabled.
    if (isDenArea(area)) return DEN_DARKNESS_OVERLAY_ALPHA;
    return INTERIOR_DARKNESS_OVERLAY_ALPHA;
  }

  function enclosedDarknessKind(area) {
    if (isMineArea(area)) return 'mine';
    if (isDenArea(area)) return 'den';
    return 'interior';
  }

  function activeRuinTradition() {
    return window.DevRandomRuinLichThemes?.activeTheme?.() || window.DevRandomRuin?.getRuntimeContext?.()?.theme || null;
  }

  function isUndergroundFogArea(area) {
    const id = String(area || '').toLowerCase();
    if (id === 'map_i_dev_random_ruin') return activeRuinTradition() === 'kanthic';
    return isMineArea(id) || isDenArea(id);
  }

  function isUndergroundLanternArea(area) {
    return isMineArea(area) || isDenArea(area);
  }

  // scene.getObjectByName walks the whole scene graph (and a miss walks all of
  // it); these lookups ran every frame. Results, misses included, are reused
  // per scene for a second, or until a found object leaves that scene.
  const NAMED_LOOKUP_TTL_MS = 1000;
  const namedLookups = new WeakMap(); // scene -> Map(name -> { object, at })
  function namedInScene(scene, name) {
    if (!scene?.getObjectByName) return null;
    let byName = namedLookups.get(scene);
    if (!byName) namedLookups.set(scene, byName = new Map());
    const now = performance.now(), hit = byName.get(name);
    if (hit && now - hit.at < NAMED_LOOKUP_TTL_MS) {
      let attached = !hit.object;
      for (let node = hit.object; node; node = node.parent) if (node === scene) { attached = true; break; }
      if (attached) return hit.object;
    }
    const object = scene.getObjectByName(name) || null;
    byName.set(name, { object, at: now });
    return object;
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
      const area = skyPolicyDeps?.getCurrentArea?.();
      const playerLanternLight = namedInScene(scene, 'mine_player_torch'); // Used here to override game.js's legacy mine-floor-only visibility before the active scene renders.
      if (playerLanternLight) playerLanternLight.visible = isUndergroundLanternArea(area);
      const skyRoot = namedInScene(scene, 'hobunji_dynamic_skydome');
      if (skyRoot) {
        const outside = skyPolicyDeps?.isOutdoorArea?.() !== false;
        skyRoot.visible = outside && !isNoSkyArea(area);
      }
      if (scene?.background?.isColor && isNoSkyArea(area) && !isCloudForestMap(area)) scene.background.set(0x000000);
      return result;
    };
  }

  // WeatherFX originally owns the same 2D lighting/lantern canvas before and
  // after this patch. This shared pass reads the exact same 24-hour + overcast
  // state as the skydome and now also applies the skydome's ambient-darkness
  // lantern activation curve to outdoor player/watch lantern masks.
  let lightingDeps = null;
  const LIGHTING_OVERLAY_MIN_INTERVAL_MS = 1000 / 60; // Camera rotation and moving lights need frame-rate projection, not 10 Hz screen-space steps.
  let lastUnifiedLightingDraw = 0;
  let unifiedLightingPaintRevision=0; // GPU upload follows actual canvas paints, including forced same-timestamp room refreshes.
  let lastUnifiedLightingArea = null; // Forces a new darkness frame as soon as the player area changes.
  let lastUnifiedLightingScene = null; // Detects activation of a farmhouse scene even if its area identifier has not switched yet.
  let lastInteriorDarknessDraw = null; // Mobile diagnostics of the shared compositor's actual enclosed base fill.
  const lightCamRight = new window.THREE.Vector3(); // Reused camera-right axis for stable screen-space light radii.
  const lightCamUp = new window.THREE.Vector3(); // Reused camera-up axis for camera-independent farmhouse light projection.
  const lightCameraPosition = new window.THREE.Vector3(); // Reused camera position for off-screen source depth checks.
  const lightViewDirection = new window.THREE.Vector3(); // Reused camera forward direction for off-screen source depth checks.
  const kanthicCameraPosition = new window.THREE.Vector3(); // Reused render-camera world position, including cinematic blends.
  const kanthicCameraDirection = new window.THREE.Vector3(); // Reused final view axis.
  const kanthicCameraMistCenter = new window.THREE.Vector3(); // Shared center of the existing three mist cylinders.
  const kanthicCameraLantern = { x: 0, y: 0, z: 0, cameraLantern: true }; // Reused camera-relative carried-light source.
  let kanthicCameraValid = false, kanthicCameraScene = null, kanthicRenderCamera = null; // Invalidate stale lighting on camera or scene changes.
  let kanthicCameraFov, kanthicCameraAspect, kanthicCameraZoom, kanthicCameraNear, kanthicCameraFar; // Track projection changes without allocating a per-frame signature.
  const lightToSource = new window.THREE.Vector3(); // Reused camera-to-source vector; no per-light allocations.
  const lightPlayerPosition = new window.THREE.Vector3(); // Reused player-depth plane origin for farmhouse light projection.
  const ambientWindowScratch = new window.THREE.Vector3(); // Reused for window world positions so the mask pass allocates nothing per source.
  const windowMaskStats = { sources: 0, drawn: 0, glows: 0, colorAuras: 0, daylight: 0 }; // Mobile QA readout for the daylight-window mask pass.
  const OUTDOOR_LIGHT_VISIBILITY_MARGIN_TILES = 8; // Keeps a fire or lantern fully visible a short way beyond its physical illumination radius.
  const OUTDOOR_LIGHT_FADE_TILES = 6; // Smoothly retires distant outdoor glows instead of leaving sharp popping light spots on wilderness horizons.
  const outdoorLightStats = { considered: 0, drawn: 0, fading: 0, culled: 0 }; // Displayed by the existing mobile Pixel Probe to verify wilderness source culling.

  function outdoorLightVisibility(x, y, z, radiusTiles) {
    if (!lightingDeps?.player || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return 0;
    const playerX = finiteOr(lightingDeps.player.x, 0) / lightingDeps.TILE; // World-space player coordinates are in tiles, the same units as local lights.
    const playerY = finiteOr(lightingDeps.getPlayerWorldY?.(), 0); // Vertical separation matters for wilderness cliffs and multi-level walkways.
    const playerZ = finiteOr(lightingDeps.player.y, 0) / lightingDeps.TILE;
    const sourceDistance = Math.hypot(x - playerX, y - playerY, z - playerZ); // Used to limit overlay light visibility independently of its projection onto the camera.
    const fadeStart = Math.max(0, finiteOr(radiusTiles, 0)) + OUTDOOR_LIGHT_VISIBILITY_MARGIN_TILES; // Full brightness near a light's authored reach.
    if (sourceDistance <= fadeStart) return 1;
    if (sourceDistance >= fadeStart + OUTDOOR_LIGHT_FADE_TILES) return 0;
    return 1 - smoothstep01((sourceDistance - fadeStart) / OUTDOOR_LIGHT_FADE_TILES);
  }

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

  function projectInteriorLightMask(x, y, z, tiles, context, rangeTiles = tiles) {
    let projectedX = x, projectedY = y, projectedZ = z;
    let rangeStrength = 1; // Smoothly retires the farmhouse's player-relative light pools at their existing range.
    const activeScene = lightingDeps.getActiveScene?.() || window.GridTileAccessors?.getActiveScene?.();
    if (activeScene?.userData?.hobunjiPlayerFarmhouseInterior === true) {
      const camera = lightingDeps.camera;
      camera.getWorldDirection(lightViewDirection);
      const player = lightingDeps.player;
      const playerX = finiteOr(player?.x, 0) / lightingDeps.TILE;
      const playerY = finiteOr(lightingDeps.getPlayerWorldY?.(), 0);
      const playerZ = finiteOr(player?.y, 0) / lightingDeps.TILE;
      lightPlayerPosition.set(playerX, playerY, playerZ);
      lightToSource.set(x, y, z).sub(lightPlayerPosition);
      lightCamRight.setFromMatrixColumn(camera.matrixWorld, 0);
      lightCamUp.setFromMatrixColumn(camera.matrixWorld, 1);
      const distanceSquared = lightToSource.x * lightToSource.x + lightToSource.y * lightToSource.y + lightToSource.z * lightToSource.z;
      if (!(rangeTiles > 0) || distanceSquared >= rangeTiles * rangeTiles) return null; // Keep the authored world-space range; the pane's visual radius can be smaller.
      const fadeStart = rangeTiles * 0.75; // Preserve the inner three quarters of the authored reach.
      if (distanceSquared > fadeStart * fadeStart) rangeStrength = 1 - smoothstep01((Math.sqrt(distanceSquared) - fadeStart) / (rangeTiles - fadeStart));
      const lateralX = lightToSource.dot(lightCamRight);
      const lateralY = lightToSource.dot(lightCamUp);
      projectedX = playerX + lightCamRight.x * lateralX + lightCamUp.x * lateralY;
      projectedY = playerY + lightCamRight.y * lateralX + lightCamUp.y * lateralY;
      projectedZ = playerZ + lightCamRight.z * lateralX + lightCamUp.z * lateralY;
    }
    const mask = projectLightMask(projectedX, projectedY, projectedZ, tiles, context, activeScene?.userData?.hobunjiPlayerFarmhouseInterior === true);
    if (!mask) return null;
    mask.coverage *= rangeStrength;
    return mask;
  }

  // The light pool, not its emitter, determines viewport visibility. Perspective
  // projection becomes singular at the camera plane, so project the cross-section
  // of a near-camera light sphere approximately onto a stable forward plane instead of suddenly
  // dropping it when its center passes behind the camera. Normal-depth pools keep
  // their exact authored size and intensity. Only overlapping masks create gradients.
  function projectLightMask(x, y, z, worldRadius, context, playerPlane = false) {
    if (!(worldRadius > 0) || !Number.isFinite(worldRadius) || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    const camera = lightingDeps.camera;
    camera.getWorldPosition(lightCameraPosition);
    camera.getWorldDirection(lightViewDirection);
    lightToSource.set(x, y, z).sub(lightCameraPosition);
    const depth = lightToSource.dot(lightViewDirection);
    const near = Number.isFinite(camera.near) ? Math.max(0, camera.near) : 0;
    const far = Number.isFinite(camera.far) ? camera.far : Infinity;
    if (depth + worldRadius <= near || depth - worldRadius >= far) return null;
    let coverage = 1; // Shared strength for the reveal, colored glow and weather tint.
    let radiusTiles = worldRadius;
    const safeDepth = Math.min(far, Math.max(near + (playerPlane ? 0 : worldRadius * 0.5), 0.001)); // Stable projection depth for sources crossing the camera plane.
    if (depth < safeDepth) {
      const shift = safeDepth - depth; // Move along the view axis, preserving the light's lateral position.
      const overlap = (depth + worldRadius - near) / (safeDepth + worldRadius - near); // Normalize against the actual near-plane overlap, not the shifted projection plane.
      coverage = smoothstep01(overlap);
      if (coverage <= 0) return null;
      radiusTiles *= Math.sqrt(coverage);
      x += lightViewDirection.x * shift;
      y += lightViewDirection.y * shift;
      z += lightViewDirection.z * shift;
    } else if (depth > far) {
      coverage = 1 - smoothstep01((depth - far) / worldRadius); // Fade the far-plane overlap instead of dropping a bright disk.
    }
    const center = lightingDeps.worldToOverlay(x, y, z);
    const radius = lightScreenRadius(x, z, y, radiusTiles);
    if (!Number.isFinite(center?.x) || !Number.isFinite(center?.y) || !(radius > 0) || !Number.isFinite(radius)) return null;
    const rect = lightingDeps.getThreeRect?.();
    const width = Number(rect?.width || context?.canvas?.clientWidth || context?.canvas?.width);
    const height = Number(rect?.height || context?.canvas?.clientHeight || context?.canvas?.height);
    if (!(width > 0 && height > 0 && center.x + radius >= 0 && center.x - radius <= width
      && center.y + radius >= 0 && center.y - radius <= height)) return null;
    return { center, radius, coverage };
  }

  // Sample the actual rendered camera, not a cinematic's eventual authored target.
  function syncKanthicCameraAtmosphere(scene, camera = lightingDeps?.camera) {
    if (!camera?.getWorldPosition || !camera?.getWorldDirection) return false;
    camera.updateWorldMatrix?.(true, false);
    camera.getWorldPosition(kanthicCameraPosition);
    camera.getWorldDirection(kanthicCameraDirection);
    const p = kanthicCameraPosition, d = kanthicCameraDirection;
    if (!Number.isFinite(p.x+p.y+p.z+d.x+d.y+d.z)) return false;
    const x = p.x + d.x * KANTHIC_CAMERA_LANTERN_DEPTH;
    const y = p.y + d.y * KANTHIC_CAMERA_LANTERN_DEPTH;
    const z = p.z + d.z * KANTHIC_CAMERA_LANTERN_DEPTH;
    const changed = !kanthicCameraValid || kanthicCameraScene !== scene || kanthicRenderCamera !== camera
      || kanthicCameraLantern.x !== x || kanthicCameraLantern.y !== y || kanthicCameraLantern.z !== z
      || kanthicCameraFov !== camera.fov || kanthicCameraAspect !== camera.aspect || kanthicCameraZoom !== camera.zoom
      || kanthicCameraNear !== camera.near || kanthicCameraFar !== camera.far;
    kanthicCameraValid = true; kanthicCameraScene = scene; kanthicRenderCamera = camera;
    kanthicCameraFov = camera.fov; kanthicCameraAspect = camera.aspect; kanthicCameraZoom = camera.zoom;
    kanthicCameraNear = camera.near; kanthicCameraFar = camera.far;
    kanthicCameraLantern.x = x; kanthicCameraLantern.y = y; kanthicCameraLantern.z = z;
    kanthicCameraMistCenter.set(p.x+d.x*KANTHIC_CAMERA_MIST_LEAD,p.y+d.y*KANTHIC_CAMERA_MIST_LEAD,p.z+d.z*KANTHIC_CAMERA_MIST_LEAD);
    if (group?.visible && attachedScene === scene) {
      for (const { mesh } of layers) mesh.position.copy(kanthicCameraMistCenter); // Reapply after gameplay's ordinary fog update, before either world draw.
    }
    if (changed) lastUnifiedLightingDraw = -Infinity; // Never retain the previous shot's darkness mask for a frame.
    return changed;
  }

  function currentOutdoorLanternActivation() {
    const value = window.HobunjiSkyDome?.getLanternActivationStrength?.(); // Used by outdoor lantern masks so weather/daylight and lantern visibility share one darkness threshold.
    return Number.isFinite(value) ? clamp01(value) : 1;
  }

  function currentOutdoorWeatherTintState() {
    const state = window.HobunjiSkyDome?.getLightingState?.(); // Supplies the already-authoritative overcast color used by the outdoor overlay.
    const overcast = clamp01(state?.overcast); // Scales the tint retained inside outdoor light masks without changing darkness or lantern activation.
    if (!state || overcast <= 0 || tuning.lantern.weatherTintRetentionAlpha <= 0) return null;
    return {
      r: Math.max(0, Math.min(255, finiteOr(state.r, 255))),
      g: Math.max(0, Math.min(255, finiteOr(state.g, 255))),
      b: Math.max(0, Math.min(255, finiteOr(state.b, 255))),
      alpha: clamp01(overcast * tuning.lantern.weatherTintRetentionAlpha),
    };
  }

  function addWeatherTintStops(grad, weatherTint, centerStrength, clarityStrength, softStrength, clarityFrac, softTransitionFraction) {
    const centerAlpha = weatherTint.alpha * centerStrength; // Reapplies only the weather coloration removed at the brightest center of a local-light mask.
    const clarityAlpha = weatherTint.alpha * clarityStrength; // Reapplies the same coloration through the authored clear-radius portion of the mask.
    const softAlpha = weatherTint.alpha * softStrength; // Reapplies a small amount through the feathered edge so the weather tint does not visibly ring around the light.
    grad.addColorStop(0, `rgba(${weatherTint.r},${weatherTint.g},${weatherTint.b},${centerAlpha})`);
    grad.addColorStop(clarityFrac, `rgba(${weatherTint.r},${weatherTint.g},${weatherTint.b},${clarityAlpha})`);
    grad.addColorStop(
      Math.min(1, clarityFrac + softTransitionFraction),
      `rgba(${weatherTint.r},${weatherTint.g},${weatherTint.b},${softAlpha})`,
    );
    grad.addColorStop(1, `rgba(${weatherTint.r},${weatherTint.g},${weatherTint.b},0)`);
  }

  function drawLanternMasksCompat(activation = 1, preserveOutdoorWeatherTint = false) {
    const lanternStrength = clamp01(activation); // Scales all player/watch mask alphas while the ambient-light threshold fades lanterns on or off.
    if (lanternStrength <= 0) return;
    const currentArea = lightingDeps.getCurrentArea(); // Use the same carried-lantern gradient in every room; Tothal alone suppresses it.
    const ruinTradition = currentArea === 'map_i_dev_random_ruin' ? (window.DevRandomRuinLichThemes?.activeTheme?.() || window.DevRandomRuin?.getRuntimeContext?.()?.theme) : null;
    if (ruinTradition === 'tothal') return; // Even an equipped lantern cannot lift Tothal's blue overcast.
    const ruinLanternScale = ruinTradition === 'kanthic' ? 0.32 : 1; // Default 2.4 tiles contracts to 0.768 in Kanthic, with the same smooth falloff.
    const ctx = lightingDeps.lctx;
    const activeScene = lightingDeps.getActiveScene?.() || window.GridTileAccessors?.getActiveScene?.(); // The player farmhouse's special base-light rule uses its active scene identity.
    const farmhouseSceneActive = activeScene?.userData?.hobunjiPlayerFarmhouseInterior === true; // Unlike mines, the farmhouse has no permanently lit player torch.
    const carriers = farmhouseSceneActive ? [] : ruinTradition === 'kanthic' && kanthicCameraValid ? [kanthicCameraLantern] : [{ // Other areas preserve their legacy always-on carried lantern; farmhouse relies on real furniture/window light sources.
      x: lightingDeps.player.x / lightingDeps.TILE,
      y: lightingDeps.getPlayerWorldY() + 0.5,
      z: lightingDeps.player.y / lightingDeps.TILE,
    }];
    for (const walker of lightingDeps.npcWalkers) {
      if (walker.area === currentArea && walker.rec?.tags?.includes('watch')) {
        carriers.push({ x: walker.root.position.x, y: walker.root.position.y + 0.5, z: walker.root.position.z });
      }
    }
    ctx.globalCompositeOperation = 'destination-out';
    const lanternTuning = tuning.lantern;
    const softInterior = enclosedLightingArea(currentArea); // Every enclosed room uses the eased edge, including mines and dens.
    const outdoors = !softInterior; // Outdoor player/watch lanterns obey the wilderness visibility fade; enclosed rooms retain their existing behavior.
    const linearInterior = ordinaryBuildingInterior(currentArea); // Only ordinary buildings expand their physical light radius.
    for (const carrier of carriers) {
      if(!carrier.cameraLantern&&!ruinRoomLightAllowed(carrier))continue;
      const visibility = outdoors ? outdoorLightVisibility(carrier.x, carrier.y, carrier.z, lanternTuning.radiusTiles) : 1; // Ignore far-away watch lanterns; carried player light stays nearby.
      if (visibility <= 0) continue;
      const projected = projectLightMask(carrier.x, carrier.y, carrier.z, lanternTuning.radiusTiles * ruinLanternScale * (linearInterior ? INTERIOR_LIGHT_RADIUS_MULTIPLIER : 1), ctx);
      if (!projected) continue;
      const { center, radius: shineR, coverage } = projected; // One shared pool projection, independent of emitter visibility.
      const clarityFrac = clamp01(lanternTuning.clarityRadiusTiles / Math.max(0.000001, lanternTuning.radiusTiles));
      const grad = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, shineR);
      const transmission = interiorLightTransmission(carrier.x, carrier.z, carrier.cameraLantern ? kanthicCameraPosition : null);
      if (transmission <= 0.005) continue;
      const effectiveStrength = lanternStrength * transmission * visibility * coverage; // Fade the actual darkness reveal, not just the decorative warm halo.
      grad.addColorStop(0, `rgba(0,0,0,${lanternTuning.centerMaskAlpha * effectiveStrength})`);
      if (softInterior) {
        addInteriorFalloffStops(grad, lanternTuning.centerMaskAlpha * effectiveStrength);
      } else {
        grad.addColorStop(clarityFrac, `rgba(0,0,0,${lanternTuning.clarityMaskAlpha * effectiveStrength})`);
        grad.addColorStop(
          Math.min(1, clarityFrac + lanternTuning.softTransitionFraction),
          `rgba(0,0,0,${lanternTuning.softMaskAlpha * effectiveStrength})`,
        );
      }
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      const shadows = ruinShadowPolygons(carrier, lanternTuning.radiusTiles * ruinLanternScale * (linearInterior ? INTERIOR_LIGHT_RADIUS_MULTIPLIER : 1)); // Carried light throws stone shadows like a wall torch (was an undefined name that aborted every dark-area overlay frame).
      withRuinRoomLightClip(ctx,carrier,()=>withRuinShadowClip(ctx,shadows,()=>{
        ctx.beginPath();ctx.arc(center.x,center.y,shineR,0,Math.PI*2);ctx.fill();
        if(ruinTradition!=='kanthic')return; // Tothal's suppression and Hronal's original lantern behavior are deliberately untouched.
        // A rope's projected top and bottom can lie outside the floor-height lantern disk even
        // when its fibers are near the player in 3D. Clear darkness *on those fibers only*.
        const ropes=window.DevRandomRuinSimplePuzzles?.getIlluminableRopes?.()||EMPTY_LIGHT_LIST;
        const localRadius=(window.RopeCore?.COLLISION_RADIUS||.24)+(window.RopeCore?.BODY_RADIUS||.045);
        for(const rope of ropes){
          const anchor=rope.anchor,bob=rope.bob||window.RopeCore?.bobAt?.(rope);
          if(!anchor||!bob)continue;
          if(Math.min(Math.hypot(anchor.x-carrier.x,anchor.z-carrier.z),
             Math.hypot(bob.x-carrier.x,bob.z-carrier.z))>lanternTuning.radiusTiles*ruinLanternScale+localRadius)continue;
          for(let segment=1;segment<=6;segment++){
            const t=segment/6,x=anchor.x+(bob.x-anchor.x)*t,y=anchor.y+(bob.y-anchor.y)*t,z=anchor.z+(bob.z-anchor.z)*t;
            const distance=Math.hypot(x-carrier.x,y-carrier.y,z-carrier.z);
            if(distance>=lanternTuning.radiusTiles*ruinLanternScale)continue;
            const projected=lightingDeps.worldToOverlay(x,y,z);
            const radius=lightScreenRadius(x,z,y,localRadius);
            if(!(radius>0)&&radius!==0)continue;
            const alpha=lanternTuning.centerMaskAlpha*effectiveStrength*(1-distance/(lanternTuning.radiusTiles*ruinLanternScale));
            const glow=ctx.createRadialGradient(projected.x,projected.y,0,projected.x,projected.y,Math.max(.01,radius));
            glow.addColorStop(0,'rgba(0,0,0,'+alpha+')');
            glow.addColorStop(1,'rgba(0,0,0,0)');
            ctx.fillStyle=glow;ctx.beginPath();ctx.arc(projected.x,projected.y,Math.max(.01,radius),0,Math.PI*2);ctx.fill();
          }
        }
      }));
    }

    const weatherTint = preserveOutdoorWeatherTint ? currentOutdoorWeatherTintState() : null; // Used below to put back weather color without restoring the darkness the lantern just removed.
    if (weatherTint) {
      ctx.globalCompositeOperation = 'multiply';
      for (const carrier of carriers) {
        if(!ruinRoomLightAllowed(carrier))continue;
        const visibility = outdoors ? outdoorLightVisibility(carrier.x, carrier.y, carrier.z, lanternTuning.radiusTiles) : 1; // Weather tint follows the same faded visibility as the matching darkness cutout.
        if (visibility <= 0) continue;
        const projected = projectLightMask(carrier.x, carrier.y, carrier.z, lanternTuning.radiusTiles * ruinLanternScale * (linearInterior ? INTERIOR_LIGHT_RADIUS_MULTIPLIER : 1), ctx);
        if (!projected) continue;
        const { center, radius: shineR, coverage } = projected; // Match the darkness reveal's radius and near-camera fade.
        const clarityFrac = clamp01(lanternTuning.clarityRadiusTiles / Math.max(0.000001, lanternTuning.radiusTiles));
        const grad = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, shineR);
        addWeatherTintStops(
          grad,
          weatherTint,
          lanternTuning.centerMaskAlpha * lanternStrength * visibility * coverage,
          lanternTuning.clarityMaskAlpha * lanternStrength * visibility * coverage,
          lanternTuning.softMaskAlpha * lanternStrength * visibility * coverage,
          clarityFrac,
          lanternTuning.softTransitionFraction,
        );
        ctx.fillStyle = grad;
        withRuinRoomLightClip(ctx,carrier,()=>{ctx.beginPath();
          ctx.arc(center.x, center.y, shineR, 0, Math.PI * 2);
          ctx.fill();});
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function ruinShadowPolygons(light,radiusTiles) {
    if(lightingDeps?.getCurrentArea?.()!=='map_i_dev_random_ruin')return [];
    const scene=lightingDeps.getActiveScene?.() || window.GridTileAccessors?.getActiveScene?.();
    return window.RuinLightOcclusion?.projectedShadows?.({
      scene,source:light,radiusTiles,THREE:window.THREE,
      project:(x,y,z)=>lightingDeps.worldToOverlay(x,y,z),
      now:performance.now(),
    }) || []; // Shared 3D blocker bounds shadow the fake light pools without enabling real-time renderer shadows.
  }
  function withRuinShadowClip(ctx,polygons,draw) {
    const shadows=window.RuinLightOcclusion;
    return shadows?.withClip ? shadows.withClip(ctx,polygons,draw) : draw();
  }
  function drawFurnitureLightMasksCompat(preserveOutdoorWeatherTint = false) {
    const ctx = lightingDeps.lctx;
    const visible = [];
    const currentArea = lightingDeps.getCurrentArea();
    const softInterior = enclosedLightingArea(currentArea); // All enclosed spaces fade softly into their own darkness.
    const outdoors = !softInterior; // Only world-exterior furniture masks get limited by player-to-source distance.
    const linearInterior = ordinaryBuildingInterior(currentArea); // Only ordinary buildings expand the physical light radius.
    for (const light of lightingDeps.getFurnitureLightSources()) {
      if(!ruinRoomLightAllowed(light))continue;
      const visibility = outdoors ? outdoorLightVisibility(light.x, light.y, light.z, light.distance) : 1; // Bound remote campfire/torch glows by their actual world positions.
      if (outdoors) {
        outdoorLightStats.considered++;
        if (visibility <= 0) outdoorLightStats.culled++;
        else if (visibility < 1) outdoorLightStats.fading++;
      }
      if (visibility <= 0) continue;
      const transmission = interiorLightTransmission(light.x, light.z);
      if (transmission <= 0.005) continue;
      const projected = projectInteriorLightMask(light.x, light.y, light.z, light.distance * (linearInterior ? INTERIOR_LIGHT_RADIUS_MULTIPLIER : 1), ctx);
      if (!projected) continue;
      visible.push({ light, center: projected.center, shineR: projected.radius, transmission, visibility: visibility * projected.coverage,
        shadows:ruinShadowPolygons(light,light.distance * (linearInterior ? INTERIOR_LIGHT_RADIUS_MULTIPLIER : 1)) }); // Reuse one fade factor across light reveal, weather tint and colored glow.
      if (outdoors) outdoorLightStats.drawn++;
    }

    ctx.globalCompositeOperation = 'destination-out';
    for (const { light, center, shineR, transmission, visibility, shadows } of visible) {
      const clarityFrac = Math.min(0.55, Math.max(0.18, 1.15 / light.distance));
      const strength = Math.min(0.94, 0.58 + light.intensity * 0.22) * transmission * visibility;
      const grad = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, shineR);
      grad.addColorStop(0, `rgba(0,0,0,${strength})`);
      if (softInterior) {
        addInteriorFalloffStops(grad, strength);
      } else {
        grad.addColorStop(clarityFrac, `rgba(0,0,0,${strength * 0.78})`);
        grad.addColorStop(Math.min(1, clarityFrac + 0.3), `rgba(0,0,0,${strength * 0.22})`);
      }
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      withRuinRoomLightClip(ctx,light,()=>withRuinShadowClip(ctx,shadows,()=>{ctx.beginPath();ctx.arc(center.x,center.y,shineR,0,Math.PI*2);ctx.fill();}));
    }

    const weatherTint = preserveOutdoorWeatherTint ? currentOutdoorWeatherTintState() : null; // Used below so static outdoor lights preserve the same weather coloration as carried/watch lanterns.
    if (weatherTint) {
      ctx.globalCompositeOperation = 'multiply';
      for (const { light, center, shineR, transmission, visibility, shadows } of visible) {
        const clarityFrac = Math.min(0.55, Math.max(0.18, 1.15 / light.distance));
        const strength = Math.min(0.94, 0.58 + light.intensity * 0.22) * transmission * visibility;
        const grad = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, shineR);
        addWeatherTintStops(
          grad,
          weatherTint,
          strength,
          strength * 0.78,
          strength * 0.22,
          clarityFrac,
          0.3,
        );
        ctx.fillStyle = grad;
        withRuinRoomLightClip(ctx,light,()=>withRuinShadowClip(ctx,shadows,()=>{ctx.beginPath();ctx.arc(center.x,center.y,shineR,0,Math.PI*2);ctx.fill();}));
      }
    }

    ctx.globalCompositeOperation = 'source-over';
    for (const { light, center, shineR, transmission, visibility, shadows } of visible) {
      const glowR = shineR * (linearInterior ? 1 : 0.62);
      const glowAlpha = Math.min(0.18, 0.055 + light.intensity * 0.055) * transmission * visibility; // Distant sources cannot leave a glowing dot after the reveal fades.
      const { r, g, b } = light.color;
      const glow = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, glowR);
      glow.addColorStop(0, `rgba(${r},${g},${b},${glowAlpha})`);
      if (softInterior) {
        glow.addColorStop(0.36, `rgba(${r},${g},${b},${glowAlpha * 0.82})`);
        glow.addColorStop(0.72, `rgba(${r},${g},${b},${glowAlpha * 0.32})`);
      } else glow.addColorStop(0.4, `rgba(${r},${g},${b},${glowAlpha * 0.45})`);
      glow.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = glow;
      withRuinRoomLightClip(ctx,light,()=>withRuinShadowClip(ctx,shadows,()=>{ctx.beginPath();ctx.arc(center.x,center.y,glowR,0,Math.PI*2);ctx.fill();}));
    }
  }

  const EMPTY_LIGHT_LIST = Object.freeze([]);
  function ruinRoomLightAllowed(source){
    return lightingDeps?.getCurrentArea?.()!=='map_i_dev_random_ruin'
      ||window.RuinRoomSystem?.lightAllowed?.(source)!==false; // Sealed rooms do not share light sources.
  }
  function withRuinLightRegion(ctx,draw){
    if(lightingDeps?.getCurrentArea?.()!=='map_i_dev_random_ruin'||!window.RuinRoomSystem?.withLightRegion)return draw();
    return window.RuinRoomSystem.withLightRegion(ctx,(x,y,z)=>lightingDeps.worldToOverlay(x,y,z),draw); // One room-footprint clip around the entire light pass; never a painted room-shaped tint.
  }
  function withRuinRoomLightClip(ctx,source,draw){
    if(source?.cameraLantern)return draw(); // Camera-carried reveal follows the shot, not the player's occupied-room filter; physical shadows still apply.
    if(lightingDeps?.getCurrentArea?.()!=='map_i_dev_random_ruin'||!window.RuinRoomSystem?.withLightClip)return draw();
    return window.RuinRoomSystem.withLightClip(ctx,source,null,draw); // Existing source-room filter, but no camera-projected rectangular paint mask.
  }
  function paintRuinScreenTint(ctx,rect,theme){
    const rgb=RUIN_SCREEN_TINT[theme]; // Each tradition uses the same single full-viewport overlay instead of a room silhouette.
    if(!rgb||!rect||!(rect.width>0&&rect.height>0))return;
    ctx.save();
    try{
      ctx.globalAlpha=1;
      ctx.globalCompositeOperation='source-over';
      ctx.fillStyle='rgba('+rgb.join(',')+','+RUIN_SCREEN_TINT_ALPHA+')';
      ctx.fillRect(0,0,rect.width,rect.height);
    }finally{ctx.restore();}
  }
  const ruinFireMaskStats={sources:0,lit:0,projected:0,drawn:0,nearbyBraziers:0}; // Distinguishes local illumination from darkness-piercing flame pixels.
  const KANTHIC_BRAZIER_RADIUS=0.95; // Maximum local pool, in world tiles.
  const KANTHIC_BRAZIER_FULL_DISTANCE=1.1, KANTHIC_BRAZIER_FADE_DISTANCE=3.2; // Smooth player-relative fade, including elevation.
  const kanthicBrazierPosition=new window.THREE.Vector3(); // Reused actual flame center for proximity and projection.
  function kanthicBrazierProximity(light){
    const p=lightingDeps.player, tile=Number(lightingDeps.TILE);
    const dx=light.x-Number(p?.x)/tile, dz=light.z-Number(p?.y)/tile;
    const dy=light.y-(Number(lightingDeps.getPlayerWorldY?.())+.8);
    const d=Math.hypot(dx,dy,dz);
    if(!Number.isFinite(d))return 0;
    return 1-smoothstep01((d-KANTHIC_BRAZIER_FULL_DISTANCE)/(KANTHIC_BRAZIER_FADE_DISTANCE-KANTHIC_BRAZIER_FULL_DISTANCE));
  }
  function drawRuinTraditionLightMasks(lights = window.DevRandomRuinLichThemes?.lightSources?.() || []) { // Existing Hronal/Tothal sources and Kanthic fixture sources share one compositing path.
    ruinFireMaskStats.sources+=lights.length;
    ruinFireMaskStats.lit+=lights.filter(light=>light.active!==false).length; // Multiple fixture owners contribute to the same overlay draw.
    if (!lights.length) return;
    const ctx = lightingDeps.lctx;
    const visible = []; // Kept for the second coloured-glow pass, so project each source just once.
    const kanthic=isKanthicGlyphArea();
    for (const source of lights) {
      if (source.active === false) continue; // Ignition still owns whether a fixture emits.
      const brazier=kanthic&&!!source.flameAnchor; // Other room rewards, portable lanterns, rope torches and boss reveals retain their own light policy.
      let light=source, proximity=1; // The original light record remains immutable to other consumers.
      if(brazier){
        let visible=true; // Match actual holder/story visibility before creating any light mask.
        for(let node=source.flameAnchor;node;node=node.parent)if(node.visible===false){visible=false;break;}
        if(!visible)continue;
        const position=source.flameAnchor.getWorldPosition?.(kanthicBrazierPosition);
        const center=position||source; // Legacy/test records can still supply scalar coordinates.
        proximity=kanthicBrazierProximity(center);
        if(proximity<=0)continue; // No room lookup, projection, shadow query or gradient for distant braziers.
        if(position)light={...source,x:position.x,y:position.y,z:position.z};
        // The continuous 3D proximity fade already rejects distant stories. Do
        // not apply the old hard floorTolerance cutoff to a nearby brazier.
      }else{
        const playerY=Number(lightingDeps.getPlayerWorldY?.());
        const floorTolerance=Number.isFinite(light.floorTolerance)?light.floorTolerance:10;
        if(Number.isFinite(light.floorY)&&Number.isFinite(playerY)&&Math.abs(light.floorY-playerY)>floorTolerance)continue;
      }
      if(!ruinRoomLightAllowed(light))continue;
      const transmission = interiorLightTransmission(light.x, light.z);
      if (transmission <= 0.005) continue;
      const radiusTiles = brazier?Math.min(KANTHIC_BRAZIER_RADIUS,light.radius):light.roomBound===true
        ? (window.RuinRoomSystem?.roomGlowRadius?.(light,light.radius) ?? light.radius) : light.radius; // Solved-room glows fade naturally before stone instead of making a bright rectangle.
      const projected = projectLightMask(light.x, light.y, light.z, radiusTiles, ctx);
      if (!projected) continue;
      if(brazier)ruinFireMaskStats.nearbyBraziers++;
      visible.push({light,brazier,center:projected.center,radius:projected.radius,transmission:transmission*projected.coverage*proximity,shadows:ruinShadowPolygons(light,radiusTiles)});
    }
    ruinFireMaskStats.projected+=visible.length; // Count sources actually in view across all fixture owners.
    ctx.globalCompositeOperation = 'destination-out';
    for (const {light,brazier,center,radius,transmission,shadows} of visible) {
      const strength = (brazier?Math.min(.72,light.strength):light.strength) * transmission;
      const grad = ctx.createRadialGradient(center.x,center.y,0,center.x,center.y,radius);
      grad.addColorStop(0,'rgba(0,0,0,'+strength+')');
      if (enclosedLightingArea(lightingDeps.getCurrentArea())) addInteriorFalloffStops(grad,strength);
      else grad.addColorStop(.42,'rgba(0,0,0,'+(strength*.42)+')');
      grad.addColorStop(1,'rgba(0,0,0,0)'); // Special-ruin light now shares the enclosed-room eased edge.
      ctx.fillStyle=grad;
      withRuinRoomLightClip(ctx,light,()=>withRuinShadowClip(ctx,shadows,()=>{ctx.beginPath();ctx.arc(center.x,center.y,radius,0,Math.PI*2);ctx.fill();}));
      ruinFireMaskStats.drawn++; // A destination-out mask was actually submitted this frame.
    }
    ctx.globalCompositeOperation='source-over';
    for (const {light,center,radius,transmission,shadows} of visible) {
      const [r,g,b]=light.color;
      const grad=ctx.createRadialGradient(center.x,center.y,0,center.x,center.y,radius);
      const glowStrength = (light.doorRune?.07:.18) * transmission; // Great Door illumination is intentionally subtle.
      grad.addColorStop(0,'rgba('+r+','+g+','+b+','+glowStrength+')');
      if (enclosedLightingArea(lightingDeps.getCurrentArea())) {
        grad.addColorStop(.36,'rgba('+r+','+g+','+b+','+(glowStrength*.82)+')');
        grad.addColorStop(.72,'rgba('+r+','+g+','+b+','+(glowStrength*.32)+')');
      } else grad.addColorStop(.35,'rgba('+r+','+g+','+b+','+(.065*transmission)+')');
      grad.addColorStop(1,'rgba('+r+','+g+','+b+',0)');
      ctx.fillStyle=grad;
      withRuinRoomLightClip(ctx,light,()=>withRuinShadowClip(ctx,shadows,()=>{ctx.beginPath();ctx.arc(center.x,center.y,radius,0,Math.PI*2);ctx.fill();}));
    }
  }



  // Kanthic's former Canvas2D UV projection could not see WebGL depth.
  // Draw the already-authored emissive meshes against the world's restored depth
  // after applying the ordinary darkness canvas as a textured fullscreen quad.
  // The normal engraved stone is untouched. No projected glyphs, rays or slab clips.
  const KANTHIC_GLYPH_LAYER=globalThis.HobunjiRenderLayers?.KANTHIC_GLYPH_DEPTH??7; // Auxiliary pass, not a main-world X-ray replay.
  const ruinGlowProjection = new window.THREE.Vector3(); // Scratch world center for room ownership and legacy non-Kanthic glows.
  const KANTHIC_LIGHT_UPLOAD_PIXELS=524288; // Bound mobile canvas-to-GPU transfers to 2 MiB of RGBA per new lighting paint.
  const kanthicClipPlanes=[]; // World-space clipping planes for the occupied region, rebuilt only on transition.
  const kanthicMaterialStates=new Map(); // Restore borrowed materials' clipping state after the auxiliary draw.
  const kanthicPendingAtlases=new WeakSet(); // Async engraving atlas promises invalidate discovery once, without a per-frame scene traversal.
  let kanthicFrustum=null,kanthicFrustumMatrix=null,kanthicLightingPrepared=false; // Scratch camera cull and pre-world lighting readiness.
  const ruinGlowSource={x:0,y:0,z:0}; // Legacy Hronal/Tothal radial light source.
  const ruinGlowStats={found:0,drawn:0,flamesDrawn:0,flamesCulled:0,triangles:0,examined:0,scans:0,region:null,roomCandidates:0,depthPasses:0,textureUploads:0,uploadPixels:0,lastError:null};
  let ruinGlowScene=null,ruinGlowNextScan=0,ruinGlowMeshes=[],kanthicIndexedScene=null; // Discovery follows scene/room lifecycle and delayed atlases.
  let kanthicRecords=[],kanthicActiveRecords=[],kanthicRegion=null,kanthicRegionBounds=null,kanthicFrame=false; // Room-local GPU candidates, rebuilt only on region change or discovery.
  let kanthicProxyScene=null,kanthicQuadScene=null,kanthicQuadCamera=null,kanthicTexture=null; // Borrowed geometry/materials and one reusable darkness quad.
  let kanthicCanvas=null,kanthicCanvasVisibility='',kanthicUploadAt=-Infinity,kanthicWidth=0,kanthicHeight=0,kanthicUploadCanvas=null; // Restore the DOM darkness canvas on exit and upload only new paints.
  const kanthicProxyCache=new WeakMap(); // Reuse proxy meshes across room transitions without retaining removed sources.
  const kanthicFlameProxies=new Map(); // Canonical particle draw objects, cached until region/index rebuild.
  const kanthicFlameHidden=[]; // Original particle/halo visibility restored at the end of the render frame.
  const kanthicFlameSeen=new Set(); // A shared fixture may be exposed by more than one owner.
  const kanthicBrazierProviders=['RuinMultifloorV50Style','RuinCheckpointTravel','DevRandomRuinSanctum']; // Existing live source registries; no scene traversal for flames.
  function hideKanthicFlamePart(part){
    if(part&&part.visible!==false){kanthicFlameHidden.push(part);part.visible=false;}
  }
  let kanthicFlameSphere=null; // One conservative particle bound for all offscreen checks.
  function restoreKanthicFlameParts(){
    for(const part of kanthicFlameHidden)part.visible=true;
    kanthicFlameHidden.length=0;
  }
  function prepareKanthicFlames(scene,bounds,cull){
    ruinGlowStats.flamesDrawn=ruinGlowStats.flamesCulled=0;
    kanthicFlameSeen.clear();
    for(const proxy of kanthicFlameProxies.values())proxy.visible=false;
    if(!bounds||!kanthicProxyScene||Number(lightingDeps.getSceneTransAlpha?.())>0)return;
    const canvas=lightingDeps.lctx?.canvas;
    if(!canvas?.style||!canvas.width||!canvas.height)return; // Without the GPU darkness target leave original flames visible.
    const THREE=window.THREE;
    for(const owner of kanthicBrazierProviders)for(const light of window[owner]?.lightSources?.()||EMPTY_LIGHT_LIST){
      const anchor=light.flameAnchor;
      if(!anchor||kanthicFlameSeen.has(anchor)||light.active===false||!glyphAttachedAndVisible(anchor,scene))continue;
      kanthicFlameSeen.add(anchor);
      hideKanthicFlamePart(light.flameHalo); // No broad translucent halo in Kanthic darkness.
      if(anchor.getWorldPosition)anchor.getWorldPosition(ruinGlowProjection);
      else ruinGlowProjection.set(light.x,light.y,light.z);
      const {x,y,z}=ruinGlowProjection;
      if(x<bounds.minX-.5||x>bounds.maxX+.5||y<bounds.minY-.5||y>bounds.maxY+.5||z<bounds.minZ-.5||z>bounds.maxZ+.5)continue;
      // The authored emitter attaches its live Points directly to this anchor.
      // The geometry is borrowed, not copied; inactive particle sentinel coordinates
      // deliberately make ordinary geometry-bound culling unsuitable for Points.
      for(const part of anchor.children||EMPTY_LIGHT_LIST){
        if(part.visible===false||part.material?.visible===false||!part.geometry||!part.material||(!part.isPoints&&!part.isMesh))continue;
        part.updateWorldMatrix?.(true,false);
        const bound=Number(part.userData?.hobunjiFlameBoundsRadius); // Canonical emitter travel bound, excluding inactive sentinel vertices.
        if(cull&&bound>0&&THREE.Sphere&&kanthicFrustum.intersectsSphere){
          kanthicFlameSphere||=new THREE.Sphere();
          kanthicFlameSphere.center.copy(ruinGlowProjection);
          kanthicFlameSphere.radius=bound*Math.max(1,part.matrixWorld?.getMaxScaleOnAxis?.()||1);
          if(!kanthicFrustum.intersectsSphere(kanthicFlameSphere)){
            hideKanthicFlamePart(part); // Offscreen in both passes; avoid drawing the original darkened particle batch as well.
            ruinGlowStats.flamesCulled++;
            continue;
          }
        }
        let proxy=kanthicFlameProxies.get(part);
        if(!proxy){
          const Type=part.isPoints?THREE.Points:THREE.Mesh;
          if(!Type)continue;
          proxy=new Type(part.geometry,part.material);
          proxy.matrixAutoUpdate=false;proxy.frustumCulled=false;proxy.layers.set(KANTHIC_GLYPH_LAYER);
          kanthicFlameProxies.set(part,proxy);kanthicProxyScene.add(proxy);
        }
        proxy.geometry=part.geometry;proxy.material=part.material;proxy.renderOrder=part.renderOrder;
        proxy.matrix.copy(part.matrixWorld);proxy.matrixWorldNeedsUpdate=true;proxy.visible=true;
        hideKanthicFlamePart(part);
        ruinGlowStats.flamesDrawn++;
      }
    }
  }
  function hasKanthicEmission(){return ruinGlowStats.drawn>0||ruinGlowStats.flamesDrawn>0;}

  function isKanthicGlyphArea(){
    return lightingDeps?.getCurrentArea?.()==='map_i_dev_random_ruin'&&activeRuinTradition()==='kanthic';
  }
  function glyphCenter(mesh){
    mesh.updateWorldMatrix?.(true,false);
    if(!mesh.geometry?.boundingSphere)mesh.geometry?.computeBoundingSphere?.();
    const sphere=mesh.geometry?.boundingSphere;
    if(sphere)ruinGlowProjection.copy(sphere.center).applyMatrix4(mesh.matrixWorld);
    else mesh.getWorldPosition?.(ruinGlowProjection);
    return Number.isFinite(ruinGlowProjection.x)&&Number.isFinite(ruinGlowProjection.y)&&Number.isFinite(ruinGlowProjection.z);
  }
  function glyphBounds(mesh){
    mesh.updateWorldMatrix?.(true,false);
    if(!mesh.geometry?.boundingBox)mesh.geometry?.computeBoundingBox?.();
    if(!mesh.geometry?.boundingBox)return null;
    return new window.THREE.Box3().copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld); // Discovery only, not every frame.
  }
  function glyphIntersectsRegion(box,bounds){
    return !!box&&!!bounds&&box.max.x>=bounds.minX&&box.min.x<=bounds.maxX
      &&box.max.z>=bounds.minZ&&box.min.z<=bounds.maxZ&&box.max.y>=bounds.minY&&box.min.y<=bounds.maxY;
  }
  function setKanthicClipBounds(bounds){
    kanthicClipPlanes.length=0;
    if(!bounds)return;
    const THREE=window.THREE;
    for(const [x,y,z,c] of [[1,0,0,-bounds.minX],[-1,0,0,bounds.maxX],[0,0,1,-bounds.minZ],[0,0,-1,bounds.maxZ],[0,1,0,-bounds.minY],[0,-1,0,bounds.maxY]]){
      if(Number.isFinite(c))kanthicClipPlanes.push(new THREE.Plane(new THREE.Vector3(x,y,z),c));
    }
  }
  function glyphAttachedAndVisible(mesh,scene){
    if(mesh.visible===false)return false;
    let parent=mesh.parent;
    for(;parent&&parent!==scene;parent=parent.parent)if(parent.visible===false)return false;
    return parent===scene;
  }
  function scanRuinGlowMeshes(scene,now,force=false){
    if(!scene?.traverse)return false;
    if(!force&&ruinGlowScene===scene&&now<ruinGlowNextScan)return false;
    const kanthic=isKanthicGlyphArea();
    ruinGlowScene=scene;ruinGlowNextScan=now+(kanthic?5000:1600);ruinGlowMeshes=[]; // Slow safety net for live rule edits; atlas completion and room registration invalidate sooner.
    scene.traverse(node=>{
      if(node.isMesh&&(node.name==='engraving-glyph-glow'||node.userData?.ruinLadderRuneGlow||node.userData?.ruinDoorRuneGlow)){ruinGlowMeshes.push(node);return;}
      const pending=node.userData?.patternReady;
      if(kanthic&&node.userData?.furniturePattern?.mode==='engraving'&&!node.userData?.engravingGlowMesh
        &&pending?.then&&!kanthicPendingAtlases.has(pending)){
        kanthicPendingAtlases.add(pending);
        const invalidate=()=>{if(ruinGlowScene===scene)ruinGlowNextScan=0;};
        pending.then(invalidate,invalidate); // Coalesces late PNG atlas readiness into the next frame's discovery.
      }
    });
    ruinGlowStats.found=ruinGlowMeshes.length;ruinGlowStats.scans++;
    return true;
  }
  function restoreKanthicCanvas(){
    if(kanthicCanvas){
      if(kanthicCanvas.style)kanthicCanvas.style.visibility=kanthicCanvasVisibility;
      kanthicCanvas=null;
    }
  }
  function resetKanthicGlyphCache(){
    restoreKanthicCanvas();
    kanthicRecords=[];kanthicActiveRecords=[];kanthicRegion=null;kanthicRegionBounds=null;
    kanthicFlameProxies.clear();kanthicFlameSeen.clear();ruinGlowStats.flamesDrawn=ruinGlowStats.flamesCulled=0;
    setKanthicClipBounds(null);
    kanthicTexture?.dispose?.();kanthicTexture=null;kanthicUploadCanvas=null;kanthicUploadAt=-Infinity;kanthicWidth=kanthicHeight=0;
    if(kanthicQuadScene)kanthicQuadScene.children[0].material.uniforms.tLighting.value=null;
    ruinGlowStats.uploadPixels=0;
    if(kanthicProxyScene)for(let i=kanthicProxyScene.children.length-1;i>=0;i--)kanthicProxyScene.remove(kanthicProxyScene.children[i]);
    ruinGlowScene=null;ruinGlowMeshes=[];ruinGlowNextScan=0;kanthicIndexedScene=null;kanthicLightingPrepared=false;
    ruinGlowStats.found=ruinGlowStats.drawn=ruinGlowStats.roomCandidates=0;ruinGlowStats.region=null;
  }
  function kanthicRegionAt(x,y,z){
    return window.DevRandomRuinSanctum?.glyphRegionAt?.(x,y,z)||window.RuinRoomSystem?.glyphRegionAt?.(x,y,z)||null;
  }
  function prepareKanthicGlyphFrame(scene,now,camera){
    kanthicLightingPrepared=false;
    if(!isKanthicGlyphArea()||!scene?.traverse){
      kanthicCameraValid=false;kanthicCameraScene=null;kanthicRenderCamera=null;
      if(kanthicIndexedScene||kanthicRecords.length||kanthicCanvas||kanthicRegion!==null)resetKanthicGlyphCache();
      return false;
    }
    const cameraMoved=syncKanthicCameraAtmosphere(scene,camera);
    const system=window.RuinRoomSystem,sanctum=window.DevRandomRuinSanctum;
    const cinematic=kanthicCameraValid&&window.CinematicCameraRuntime?.isActive?.();
    const viewRegion=cinematic?(kanthicRegionAt(kanthicCameraLantern.x,kanthicCameraLantern.y,kanthicCameraLantern.z)
      ||kanthicRegionAt(kanthicCameraPosition.x,kanthicCameraPosition.y,kanthicCameraPosition.z)):null; // Render-only region ownership; never wake encounters in the viewed room.
    const player=lightingDeps.player,tile=lightingDeps.TILE;
    const playerSanctumRegion=player&&tile?sanctum?.glyphRegionAt?.(player.x/tile,Number(lightingDeps.getPlayerWorldY?.()),player.y/tile):null;
    const region=viewRegion||playerSanctumRegion||system?.activeGlyphRegion?.()||null;
    const bounds=region?(sanctum?.glyphRegionBounds?.(region)||system?.glyphRegionBounds?.(region)):null;
    const changed=region!==kanthicRegion||bounds!==kanthicRegionBounds;
    const scanned=scanRuinGlowMeshes(scene,now,kanthicIndexedScene!==scene);
    kanthicIndexedScene=scene;
    if(scanned){
      kanthicRecords=ruinGlowMeshes.map(mesh=>({mesh,bounds:glyphBounds(mesh),hidden:false,proxy:null}));
    }
    if(scanned||changed){
      kanthicRegion=region;kanthicRegionBounds=bounds;setKanthicClipBounds(bounds);
      kanthicActiveRecords=bounds?kanthicRecords.filter(record=>glyphIntersectsRegion(record.bounds,bounds)):[];
      if(!kanthicProxyScene){kanthicProxyScene=new window.THREE.Scene();kanthicProxyScene.name='kanthic_room_glyph_depth';kanthicProxyScene.userData||={};kanthicProxyScene.userData.hobunjiOutlineSequenceNeutral=true;}
      for(let i=kanthicProxyScene.children.length-1;i>=0;i--)kanthicProxyScene.remove(kanthicProxyScene.children[i]);
      kanthicFlameProxies.clear();
      for(const record of kanthicActiveRecords){
        const mesh=record.mesh;
        let proxy=kanthicProxyCache.get(mesh);
        if(!proxy){
          proxy=new window.THREE.Mesh(mesh.geometry,mesh.material);
          proxy.matrixAutoUpdate=false;proxy.frustumCulled=true;proxy.layers.set(KANTHIC_GLYPH_LAYER);
          proxy.onBeforeRender=(...args)=>mesh.onBeforeRender?.call(mesh,...args); // Preserve authored pulse and palette.
          kanthicProxyCache.set(mesh,proxy);
        }
        record.proxy=proxy;kanthicProxyScene.add(proxy);
      }
    }
    ruinGlowStats.region=region;ruinGlowStats.roomCandidates=kanthicActiveRecords.length;
    ruinGlowStats.drawn=0;ruinGlowStats.examined=0;ruinGlowStats.triangles=0;
    kanthicFrame=true; // endKanthicGlyphFrame restores the actual scene's visibility even if rendering fails.
    const THREE=window.THREE;
    const cull=!!(camera?.isCamera&&THREE.Frustum&&THREE.Matrix4);
    if(cull){
      kanthicFrustum||=new THREE.Frustum();kanthicFrustumMatrix||=new THREE.Matrix4();
      camera.updateWorldMatrix?.(true,false);
      kanthicFrustum.setFromProjectionMatrix(kanthicFrustumMatrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
    }
    for(const record of kanthicActiveRecords){
      const mesh=record.mesh,proxy=record.proxy;
      proxy.visible=glyphAttachedAndVisible(mesh,scene)&&!!mesh.material?.map&&mesh.material.visible!==false;
      if(proxy.visible){
        mesh.updateWorldMatrix?.(true,false); // Moving slabs keep their current transforms.
        if(cull&&!kanthicFrustum.intersectsObject(mesh))proxy.visible=false; // Avoid a fullscreen lighting upload and draw when no active glyph is in view.
      }
      if(!proxy.visible)continue;
      proxy.geometry=mesh.geometry;proxy.material=mesh.material;proxy.renderOrder=mesh.renderOrder;
      proxy.matrix.copy(mesh.matrixWorld);proxy.matrixWorldNeedsUpdate=true;
      ruinGlowStats.drawn++;
    }
    for(const record of kanthicRecords){
      record.hidden=record.mesh.visible!==false;
      if(record.hidden)record.mesh.visible=false; // No base-pass emissive draw, including every off-room glyph.
    }
    prepareKanthicFlames(scene,bounds,cull);
    if(kanthicProxyScene)kanthicProxyScene.fog=null; // Room-local depth-tested runes and existing emissive flames pierce the black mist.
    if(!hasKanthicEmission()||Number(lightingDeps.getSceneTransAlpha?.())>0){
      restoreKanthicCanvas();
      if(cameraMoved)window.WeatherFX?.drawLightingOverlay?.(); // DOM fallback must move even in corridors with no emissive geometry.
      return true;
    }
    const canvas=lightingDeps.lctx?.canvas;
    if(!canvas?.style||!canvas.width||!canvas.height){restoreKanthicCanvas();return true;}
    try{
      if(kanthicWidth!==canvas.width||kanthicHeight!==canvas.height){
        lastUnifiedLightingDraw=-Infinity;kanthicUploadAt=-Infinity;
      }
      // Surface recovery can dispatch a resize or switch the renderer target.
      // Paint before mainRT/base rendering, NEVER while its world depth is bound.
      window.WeatherFX?.drawLightingOverlay?.();
      kanthicWidth=canvas.width;kanthicHeight=canvas.height;
      kanthicLightingPrepared=true;
    }catch(error){ruinGlowStats.lastError=String(error?.message||error);restoreKanthicFlameParts();restoreKanthicCanvas();}
    return true;
  }
  function endKanthicGlyphFrame(){
    if(!kanthicFrame)return;
    for(const record of kanthicRecords)if(record.hidden){record.mesh.visible=true;record.hidden=false;}
    restoreKanthicFlameParts();
    kanthicFrame=false;kanthicLightingPrepared=false;
  }
  function boundedKanthicTextureSource(canvas){
    const pixels=canvas.width*canvas.height;
    if(pixels<=KANTHIC_LIGHT_UPLOAD_PIXELS||typeof document==='undefined')return canvas;
    if(!kanthicUploadCanvas)kanthicUploadCanvas=document.createElement('canvas');
    const scale=Math.sqrt(KANTHIC_LIGHT_UPLOAD_PIXELS/pixels);
    const w=Math.max(1,Math.floor(canvas.width*scale)),h=Math.max(1,Math.floor(canvas.height*scale));
    if(kanthicUploadCanvas.width!==w)kanthicUploadCanvas.width=w;
    if(kanthicUploadCanvas.height!==h)kanthicUploadCanvas.height=h;
    return kanthicUploadCanvas;
  }
  // Shared readiness gate: ink must precede the GPU darkness even with mist off.
  function hasKanthicLightingPass(){
    if(!kanthicFrame||!kanthicLightingPrepared||!hasKanthicEmission()||Number(lightingDeps.getSceneTransAlpha?.())>0)return false;
    const canvas=lightingDeps.lctx?.canvas;
    return !!(canvas?.style&&canvas.width&&canvas.height);
  }
  function renderKanthicGlyphFrame(renderer,camera,scene,direct=false){
    if(!hasKanthicLightingPass()){restoreKanthicCanvas();return false;}
    const canvas=lightingDeps.lctx.canvas;
    const THREE=window.THREE;
    const oldAutoClear=renderer.autoClear,oldClearColor=renderer.autoClearColor,oldClearDepth=renderer.autoClearDepth,oldClearStencil=renderer.autoClearStencil,oldMask=camera.layers.mask,oldClipping=renderer.localClippingEnabled; // Existing target and depth buffer stay bound for both draws.
    let painted=false;
    try{
      const uploadSource=boundedKanthicTextureSource(canvas);
      if(!kanthicTexture||kanthicTexture.image!==uploadSource){
        kanthicTexture?.dispose?.();
        kanthicTexture=new THREE.CanvasTexture(uploadSource);
        kanthicTexture.minFilter=THREE.LinearFilter;kanthicTexture.magFilter=THREE.LinearFilter;
        kanthicTexture.generateMipmaps=false;kanthicUploadAt=-Infinity;
        if(!kanthicQuadScene){
          kanthicQuadScene=new THREE.Scene();kanthicQuadScene.name='kanthic_lighting_quad';kanthicQuadScene.userData||={};kanthicQuadScene.userData.hobunjiOutlineSequenceNeutral=true;kanthicQuadCamera=new THREE.Camera();kanthicQuadCamera.layers.set(KANTHIC_GLYPH_LAYER);
          const material=new THREE.ShaderMaterial({
            uniforms:{tLighting:{value:kanthicTexture}},
            vertexShader:'varying vec2 vUv; void main(){vUv=uv; gl_Position=vec4(position.xy,0.0,1.0);}',
            fragmentShader:'uniform sampler2D tLighting; varying vec2 vUv; void main(){gl_FragColor=texture2D(tLighting,vUv);}',
            transparent:true,depthTest:false,depthWrite:false,toneMapped:false,
          });
          const quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),material);
          quad.frustumCulled=false;quad.layers.set(KANTHIC_GLYPH_LAYER);kanthicQuadScene.add(quad);
        }else kanthicQuadScene.children[0].material.uniforms.tLighting.value=kanthicTexture;
      }
      if(kanthicUploadAt!==unifiedLightingPaintRevision){
        if(uploadSource!==canvas){
          const ctx=uploadSource.getContext('2d');
          ctx.globalCompositeOperation='copy';ctx.drawImage(canvas,0,0,uploadSource.width,uploadSource.height);
        }
        kanthicTexture.needsUpdate=true;kanthicUploadAt=unifiedLightingPaintRevision;ruinGlowStats.textureUploads++;
        ruinGlowStats.uploadPixels=uploadSource.width*uploadSource.height;
      }
      renderer.autoClear=false;renderer.autoClearColor=false;renderer.autoClearDepth=false;renderer.autoClearStencil=false; // THREE's Color background can force a clear despite autoClear=false.
      if(direct)window.PngPlaneOutlineOccluder?.renderDepth?.(scene); // The outlines-off path also respects alpha-cutout actors/props.
      renderer.render(kanthicQuadScene,kanthicQuadCamera);
      painted=true;
      camera.layers.set(KANTHIC_GLYPH_LAYER); // No base-world replay on auxiliary glyphs.
      renderer.localClippingEnabled=true;
      for(const proxy of kanthicProxyScene.children){
        const material=proxy.material;
        if(!proxy.visible||!material||kanthicMaterialStates.has(material))continue;
        kanthicMaterialStates.set(material,{planes:material.clippingPlanes,intersection:material.clipIntersection});
        material.clippingPlanes=kanthicClipPlanes;material.clipIntersection=false;
      }
      renderer.render(kanthicProxyScene,camera); // Ordinary material depthTest rejects every foreground solid/alpha-tested pixel.
      ruinGlowStats.depthPasses++;ruinGlowStats.lastError=null;
      return true;
    }catch(error){
      ruinGlowStats.lastError=String(error?.message||error);
      return false;
    }finally{
      for(const [material,state] of kanthicMaterialStates){material.clippingPlanes=state.planes;material.clipIntersection=state.intersection;}
      kanthicMaterialStates.clear();renderer.localClippingEnabled=oldClipping;
      renderer.autoClear=oldAutoClear;renderer.autoClearColor=oldClearColor;renderer.autoClearDepth=oldClearDepth;renderer.autoClearStencil=oldClearStencil;camera.layers.mask=oldMask;
      if(painted){
        if(kanthicCanvas!==canvas){restoreKanthicCanvas();kanthicCanvas=canvas;kanthicCanvasVisibility=canvas.style.visibility||'';}
        if(canvas.style.visibility!=='hidden')canvas.style.visibility='hidden'; // The GPU already composited this exact canvas; never double-darken.
      }else restoreKanthicCanvas();
    }
  }

  function drawRuinPatternGlowMasks(scene,now){
    // Only Hronal/Tothal retain their original small radial ambient masks.
    // Kanthic's depth-tested emissive pass never modifies this 2D canvas.
    if(isKanthicGlyphArea())return;
    scanRuinGlowMeshes(scene,now);
    const ctx=lightingDeps.lctx,playerY=Number(lightingDeps.getPlayerWorldY?.());
    ruinGlowStats.drawn=0;
    ctx.globalCompositeOperation='destination-out';
    for(const mesh of ruinGlowMeshes){
      if(ruinGlowStats.drawn>=80||!mesh.material?.visible||!(mesh.material.opacity>.001)
        ||!glyphAttachedAndVisible(mesh,scene)||!glyphCenter(mesh))continue;
      const {x,y,z}=ruinGlowProjection;
      if(Number.isFinite(playerY)&&Math.abs(y-playerY)>11)continue;
      ruinGlowSource.x=x;ruinGlowSource.y=y;ruinGlowSource.z=z;
      if(!ruinRoomLightAllowed(ruinGlowSource))continue;
      const radiusTiles=Math.min(5,Math.max(.8,(mesh.geometry?.boundingSphere?.radius||1)*(mesh.matrixWorld?.getMaxScaleOnAxis?.()||1)));
      const projected=projectLightMask(x,y,z,radiusTiles,ctx);
      if(!projected)continue;
      const {center,radius,coverage}=projected; // Near-camera glyph glow fades with the same light-sphere overlap.
      const gradient=ctx.createRadialGradient(center.x,center.y,0,center.x,center.y,radius);
      gradient.addColorStop(0,'rgba(0,0,0,'+(.98*coverage)+')');gradient.addColorStop(.58,'rgba(0,0,0,'+(.96*coverage)+')');
      gradient.addColorStop(.83,'rgba(0,0,0,'+(.70*coverage)+')');gradient.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle=gradient;
      withRuinRoomLightClip(ctx,ruinGlowSource,()=>{ctx.beginPath();ctx.arc(center.x,center.y,radius,0,Math.PI*2);ctx.fill();});
      ruinGlowStats.drawn++;
    }
    ctx.globalCompositeOperation='source-over';
  }

  function ordinaryBuildingInterior(area) {
    const activeScene = lightingDeps?.getActiveScene?.() || window.GridTileAccessors?.getActiveScene?.();
    return !isUndergroundLanternArea(area) && (area === 'interior' || !!lightingDeps?._isBuildingArea?.(area) || activeScene?.userData?.hobunjiPlayerFarmhouseInterior === true); // Scene identity remains authoritative while the area id catches up.
  }

  function enclosedLightingArea(area) {
    return ordinaryBuildingInterior(area) || isMineArea(area) || isDenArea(area)
      || (isNoSkyArea(area) && !isCloudForestMap(area));
  }

  // One lighting draw asks for transmission once per light (lanterns, furniture, ruin lights, window
  // panes), and the door blockers cannot change in the middle of a draw, so the list is read once per
  // draw. Outside a draw (tests, diagnostics) every call reads it fresh.
  let lightingDrawActive = false;
  let drawBlockers = null, drawBlockersArea = null, drawBlockersScene = null;
  function lightBlockersForDraw(area, scene) {
    const read = () => window.InteriorDoorTiles?.getLightBlockers?.(area, scene) || NO_LIGHT_BLOCKERS;
    if (!lightingDrawActive) return read();
    if (drawBlockers === null || drawBlockersArea !== area || drawBlockersScene !== scene) {
      drawBlockers = read(); drawBlockersArea = area; drawBlockersScene = scene;
    }
    return drawBlockers;
  }
  const NO_LIGHT_BLOCKERS = Object.freeze([]);

  function interiorLightTransmission(sourceX, sourceZ, viewer = null) {
    const currentArea = lightingDeps?.getCurrentArea?.();
    const activeScene = lightingDeps?.getActiveScene?.() || window.GridTileAccessors?.getActiveScene?.();
    if (!enclosedLightingArea(currentArea)) return 1;
    const player = lightingDeps.player;
    const fromX = viewer ? viewer.x : finiteOr(player?.x, 0) / lightingDeps.TILE;
    const fromZ = viewer ? viewer.z : finiteOr(player?.y, 0) / lightingDeps.TILE;
    const dx = sourceX - fromX, dz = sourceZ - fromZ;
    const lengthSquared = dx * dx + dz * dz;
    if (lengthSquared < 0.000001) return 1;
    const doors = lightBlockersForDraw(currentArea, activeScene);
    let transmission = 1;
    for (const door of doors) {
        const progress = clamp01(door.openProgress);
        if (progress >= 0.999) continue;
        const nx = finiteOr(door.normalX, 0), nz = finiteOr(door.normalZ, 0);
        const denominator = dx * nx + dz * nz;
        if (Math.abs(denominator) < 0.000001) continue;
        const t = ((door.x - fromX) * nx + (door.z - fromZ) * nz) / denominator;
        if (t <= 0.001 || t >= 0.999) continue;
        const hitX = fromX + dx * t, hitZ = fromZ + dz * t;
        const tangentX = -nz, tangentZ = nx;
        const lateral = Math.abs((hitX - door.x) * tangentX + (hitZ - door.z) * tangentZ);
        if (lateral > Math.max(0.5, finiteOr(door.halfWidth, 0.5)) + 0.12) continue;
      transmission *= progress; // The same eased progress that swings the slab smoothly restores light as the door opens.
      if (transmission <= 0.005) return 0;
    }
    return clamp01(transmission);
  }

  function addInteriorFalloffStops(gradient, strength) {
    gradient.addColorStop(0.36, `rgba(0,0,0,${strength * 0.82})`);
    gradient.addColorStop(0.72, `rgba(0,0,0,${strength * 0.32})`);
  }

  // Daylight windows reveal the stable enclosed darkness locally, exactly like
  // furniture lights do: a spreading pool scaled by outdoor daylight, plus a
  // tight non-spreading glow on the pane itself that persists at night so the
  // window always reads as an opening to the outside.
  const WINDOW_PANE_GLOW_RADIUS = 0.55; // World units; about the authored pane's half-diagonal.
  const WINDOW_PANE_GLOW_STRENGTH = 0.85;

  function drawWindowRevealCircle(ctx, center, radius, strength, clarity, linear = false) {
    const grad = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, radius);
    grad.addColorStop(0, `rgba(0,0,0,${strength})`);
    if (linear) {
      addInteriorFalloffStops(grad, strength);
    } else {
      grad.addColorStop(clarity, `rgba(0,0,0,${strength * 0.7})`);
      grad.addColorStop(Math.min(1, clarity + 0.35), `rgba(0,0,0,${strength * 0.2})`);
    }
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  const STAINED_GLASS_AURA_ALPHA = 0.2; // Used only by diffuse window-color washes; keeps normal daylight and lamp masks dominant.
  const STAINED_GLASS_AURA_SPREAD = 1.18; // Broad overlapping colors deliberately never reproduce a window motif or floor footprint.

  function drawStainedGlassAura(ctx, source, center, radius, daylightStrength) {
    const palette = source.projectionPalette; // Existing glass-pattern dyes supply the colors without rasterizing or projecting its exact design.
    const tint = source.glassTint; // Solid tinted windows have no authored pattern palette.
    const colors = Array.isArray(palette) && palette.length ? palette : tint?.getHexString ? [`#${tint.getHexString()}`] : []; // Fallback uses Three.Color only for solid colored glass.
    const amount = Math.min(0.25, STAINED_GLASS_AURA_ALPHA * daylightStrength / Math.sqrt(Math.max(1, colors.length))); // Each color remains subtle as multiple windows overlap.
    if (!(radius > 0) || !(amount > 0)) return false;
    let drawn = false;
    for (let i = 0; i < Math.min(3, colors.length); i++) {
      const hex = colors[i]; // Authoring normalizes palettes to #rrggbb; reject missing/invalid colors rather than tinting clear windows.
      if (typeof hex !== 'string' || !/^#[a-f0-9]{6}$/i.test(hex)) continue;
      const rgb = parseInt(hex.slice(1), 16); // One dye becomes the center hue of a very broad, feathered daylight variation.
      const red = rgb >> 16 & 255, green = rgb >> 8 & 255, blue = rgb & 255;
      const offsetX = (i - (colors.length - 1) * 0.5) * radius * 0.23; // Closely spaced centers blend glass dyes rather than preserving their shapes.
      const offsetY = (i % 2 ? 0.12 : -0.12) * radius;
      const x = center.x + offsetX, y = center.y + offsetY;
      const spread = radius * STAINED_GLASS_AURA_SPREAD;
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, spread);
      gradient.addColorStop(0, `rgba(${red},${green},${blue},${amount})`);
      gradient.addColorStop(0.45, `rgba(${red},${green},${blue},${amount * 0.42})`);
      gradient.addColorStop(1, `rgba(${red},${green},${blue},0)`);
      ctx.fillStyle = gradient;
      ctx.beginPath(); ctx.arc(x, y, spread, 0, Math.PI * 2); ctx.fill();
      drawn = true;
    }
    return drawn;
  }

  function drawWindowLightMasks() {
    const runtime = window.DaylightWindowRuntime;
    const activeScene = lightingDeps.getActiveScene?.() || window.GridTileAccessors?.getActiveScene?.() || null; // Without a scene filter the farm-side exterior window would also reveal the interior overlay.
    if (!activeScene) return;
    const sources = runtime?.getActiveSources?.(activeScene) || [];
    windowMaskStats.sources = sources.length;
    windowMaskStats.drawn = 0;
    windowMaskStats.glows = 0;
    windowMaskStats.colorAuras = 0;
    if (!sources.length) { windowMaskStats.daylight = 0; return; }
    const outdoor = getFullDayLighting(); // Same day/night + lunar state the windows' pane tint uses, without its debug-state round trip.
    const daylight = clamp01(1 - clamp01(outdoor.a)); // Outdoor overlay darkness alpha: night windows admit little light.
    windowMaskStats.daylight = daylight;
    const ctx = lightingDeps.lctx;
    ctx.globalCompositeOperation = 'destination-out';
    for (const source of sources) {
      source.mesh?.getWorldPosition?.(ambientWindowScratch);
      const transmission = interiorLightTransmission(ambientWindowScratch.x, ambientWindowScratch.z);
      if (transmission <= 0.005) continue;
      const paneRange = Math.max(WINDOW_PANE_GLOW_RADIUS, finiteOr(source.radiusTiles, 2.8) * INTERIOR_LIGHT_RADIUS_MULTIPLIER); // Keep the small pane glow visible throughout the window's actual room-light range, including at night.
      const pane = projectInteriorLightMask(ambientWindowScratch.x, ambientWindowScratch.y, ambientWindowScratch.z, WINDOW_PANE_GLOW_RADIUS, ctx, paneRange);
      if (pane) {
        drawWindowRevealCircle(ctx, pane.center, pane.radius, WINDOW_PANE_GLOW_STRENGTH * transmission * pane.coverage, 0.55); // Pane glow: day and night, no spread.
        windowMaskStats.glows += 1;
      }
      if (daylight <= 0.02) continue;
      const radiusTiles = Math.max(0.25, finiteOr(source.radiusTiles, 2.8));
      const projected = projectInteriorLightMask(ambientWindowScratch.x, ambientWindowScratch.y, ambientWindowScratch.z, radiusTiles * INTERIOR_LIGHT_RADIUS_MULTIPLIER, ctx);
      const strength = Math.min(0.9, clamp01(source.strength) * daylight * 0.85) * transmission;
      if (!(strength > 0) || !projected) continue;
      drawWindowRevealCircle(ctx, projected.center, projected.radius, strength * projected.coverage, 0.35, true); // Daylight pool spreading into the room.
      windowMaskStats.drawn += 1;
    }
    ctx.globalCompositeOperation = 'screen'; // Add only soft color to the shared fake-daylight mask; never draw an exact textured floor projection.
    if (daylight > 0.02) for (const source of sources) {
      if (!source.projectionPalette?.length && !source.glassTint) continue; // Plain daylight windows keep their existing neutral illumination.
      source.mesh?.getWorldPosition?.(ambientWindowScratch);
      const transmission = interiorLightTransmission(ambientWindowScratch.x, ambientWindowScratch.z);
      if (transmission <= 0.005) continue;
      const radiusTiles = Math.max(0.25, finiteOr(source.radiusTiles, 2.8));
      const projected = projectInteriorLightMask(ambientWindowScratch.x, ambientWindowScratch.y, ambientWindowScratch.z, radiusTiles * INTERIOR_LIGHT_RADIUS_MULTIPLIER, ctx);
      if (!projected) continue;
      const strength = Math.min(0.9, clamp01(source.strength) * daylight * 0.85) * transmission;
      if (drawStainedGlassAura(ctx, source, projected.center, projected.radius, strength * projected.coverage)) windowMaskStats.colorAuras++;
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawUnifiedLightingOverlay() {
    lightingDrawActive = true; drawBlockers = null; // Door blockers are read once per draw (see lightBlockersForDraw).
    try { drawUnifiedLightingOverlayPass(); } finally { lightingDrawActive = false; drawBlockers = null; }
  }

  function drawUnifiedLightingOverlayPass() {
    if (!lightingDeps?.lctx) return;
    const now = performance.now();
    const lightningAlpha = lightingDeps.getLightningAlpha();
    const sceneTransAlpha = lightingDeps.getSceneTransAlpha();
    const currentArea = lightingDeps.getCurrentArea(); // Selects room darkness and detects transitions that must bypass the normal redraw throttle.
    if(!isKanthicGlyphArea())restoreKanthicCanvas(); // Exiting a ruin restores the ordinary DOM lighting owner even before the next world frame.
    const activeScene = lightingDeps.getActiveScene?.() || window.GridTileAccessors?.getActiveScene?.() || null; // The rendered scene is authoritative if the area-id update trails a transition.
    const farmhouseSceneActive = activeScene?.userData?.hobunjiPlayerFarmhouseInterior === true; // Keeps the farmhouse dark even during a temporarily stale outdoor area id.
    if(isKanthicGlyphArea())syncKanthicCameraAtmosphere(activeScene, kanthicFrame ? kanthicRenderCamera || lightingDeps.camera : lightingDeps.camera); // Also covers overlay draws outside the world-render pipeline.
    if (now - lastUnifiedLightingDraw < LIGHTING_OVERLAY_MIN_INTERVAL_MS && lightningAlpha <= 0 && sceneTransAlpha <= 0
        && currentArea === lastUnifiedLightingArea && activeScene === lastUnifiedLightingScene) return;
    lastUnifiedLightingDraw = now;
    lastUnifiedLightingArea = currentArea;
    lastUnifiedLightingScene = activeScene;

    const ctx = lightingDeps.lctx;
    ctx.globalAlpha = 1; // The darkness fill must not inherit opacity changes from another canvas consumer.
    const surface = window.WeatherFX?.ensurePresentationSurface?.({ reason: 'unified-lighting-draw' }); // Keeps the authoritative replacement lighting pass on the same repaired CSS/backing dimensions as WebGL.
    const rect = surface?.rect || lightingDeps.getThreeRect();
    ctx.clearRect(0, 0, rect.width, rect.height);unifiedLightingPaintRevision++;
    outdoorLightStats.considered = outdoorLightStats.drawn = outdoorLightStats.fading = outdoorLightStats.culled = 0; // Count only lights in the latest frame for mobile debugging.
    ruinFireMaskStats.sources=ruinFireMaskStats.lit=ruinFireMaskStats.projected=ruinFireMaskStats.drawn=ruinFireMaskStats.nearbyBraziers=0; // Reset once per frame so mobile diagnostics include every light owner.
    const enclosed = farmhouseSceneActive || currentArea === 'interior'
      || lightingDeps._isBuildingArea(currentArea)
      || (isNoSkyArea(currentArea) && !isCloudForestMap(currentArea));

    // Fog-darkened underground areas fall through to the outdoor overlay below
    // with a fixed midnight state, but only while the mist is really showing
    // (the Cloud Forest Mist setting can turn it off), else they keep the
    // flat darkness.
    const undergroundFog = !farmhouseSceneActive && isUndergroundFogArea(currentArea) && !!(group?.visible && attachedScene);
    if (enclosed && !undergroundFog) {
      const darknessAlpha = enclosedDarknessOverlayAlpha(currentArea); // Existing mine/den/room darkness policy, preserved for every area.
      const effectiveDarknessAlpha = farmhouseSceneActive ? INTERIOR_DARKNESS_OVERLAY_ALPHA : darknessAlpha; // The farmhouse uses 80% base darkness regardless of a lagging outdoor area id.
      const roomAmbient = currentArea==='map_i_dev_random_ruin' ? window.RuinRoomSystem?.ambient?.() : null; // Room-specific ambient settings preserve the user's darkness preference.
      const roomAlpha=clamp01(effectiveDarknessAlpha+(roomAmbient?.darknessOffset||0));
      lastInteriorDarknessDraw = { area: currentArea, farmhouseSceneActive, alpha: roomAlpha,
        baseAlpha: effectiveDarknessAlpha, roomId: roomAmbient?.roomId||null,
        roomIllumination: roomAmbient?.illumination||0, at: now }; // Mobile Pixel Probe exposes the actual room-darkness result, not just its base setting.
      ctx.globalCompositeOperation = 'source-over';
      const ruinTradition = currentArea === 'map_i_dev_random_ruin' ? (window.DevRandomRuinLichThemes?.activeTheme?.() || window.DevRandomRuin?.getRuntimeContext?.()?.theme) : null;
      ctx.fillStyle = roomAmbient?.color ? 'rgba('+roomAmbient.color.join(',')+','+roomAlpha+')'
        :ruinTradition === 'tothal' ? 'rgba(6,18,44,'+effectiveDarknessAlpha+')'
        :ruinTradition === 'hronal' ? 'rgba(20,7,2,'+effectiveDarknessAlpha+')' : 'rgba(0,0,0,'+effectiveDarknessAlpha+')';
      ctx.fillRect(0, 0, rect.width, rect.height);
      withRuinLightRegion(ctx,()=>{
        drawLanternMasksCompat(1);
        if (ruinTradition !== 'kanthic' && ruinTradition !== 'tothal') drawFurnitureLightMasksCompat(); // The pure-black Kanthic room and cold Tothal room have no generic warm furniture pools.
        if (ruinTradition === 'hronal' || ruinTradition === 'tothal') drawRuinTraditionLightMasks();
        if (ruinTradition === 'kanthic') drawRuinTraditionLightMasks(window.RuinMultifloorV50Style?.lightSources?.() || []); // Dedicated Kanthic braziers reveal only a tiny player-near pool.
        if (ruinTradition === 'kanthic') drawRuinTraditionLightMasks(window.RuinRopeTorch?.lightSources?.() || EMPTY_LIGHT_LIST); // Rope-end flames light less than one tile.
        if (ruinTradition) drawRuinTraditionLightMasks(window.RuinLayerPlayable?.roomLights?.() || []); // A solved puzzle room fills with light.
        if (ruinTradition) drawRuinTraditionLightMasks(window.DevRandomRuinSanctum?.lightSources?.() || []); // Lit arena braziers and the temporary boss reveal brighten their sealed chamber.
        if (ruinTradition) drawRuinTraditionLightMasks(window.RuinCheckpointTravel?.lightSources?.() || []); // White checkpoints keep their traditional pools outside Kanthic.
        if (ruinTradition) drawRuinTraditionLightMasks(window.SkeeriRuins?.eyeLights?.() || EMPTY_LIGHT_LIST); // Planebent Skeeri eyes pierce the dark.
        if (ruinTradition) drawRuinPatternGlowMasks(activeScene,now); // An emissive wall engraving is legible without a carried lantern.
      }); // Clip ONLY local light contributions; the tradition tint below always covers the whole viewport.
      if (ruinTradition) paintRuinScreenTint(ctx,rect,ruinTradition); // Low-opacity full-screen ambience, with no rectangular room boundary.
      if (ordinaryBuildingInterior(currentArea) && !ruinTradition) drawWindowLightMasks();
      if (sceneTransAlpha > 0) {
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = `rgba(0,0,0,${sceneTransAlpha})`;
        ctx.fillRect(0, 0, rect.width, rect.height);
      }
      return;
    }

    lastInteriorDarknessDraw = null; // Never report an interior base fill after returning outside.
    const { r, g, b, a } = undergroundFog ? undergroundLightingForArea(currentArea) : getFullDayLighting();
    const kanthicVoid = undergroundFog && currentArea === 'map_i_dev_random_ruin' && activeRuinTradition() === 'kanthic'; // A black overlay cannot add color back to the black outer shell.
    const darknessAlpha = kanthicVoid ? Math.max(a, KANTHIC_STANDARD_DARKNESS_ALPHA) : a; // Stronger ordinary ambient darkness replaces the old hard circular cutout.
    ctx.globalCompositeOperation = darknessAlpha < 0.09 ? 'screen' : 'multiply';
    ctx.fillStyle = kanthicVoid ? `rgba(0,0,0,${darknessAlpha})` : `rgba(${r}, ${g}, ${b}, ${darknessAlpha})`;
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.globalCompositeOperation = 'source-over';

    // Outdoor carried/watch lanterns still clear darkness, but preserve a configurable amount of the active weather tint.
    withRuinLightRegion(ctx,()=>{
      drawLanternMasksCompat(undergroundFog ? 1 : currentOutdoorLanternActivation(), !undergroundFog);
      if (!(undergroundFog && activeRuinTradition() === 'kanthic')) drawFurnitureLightMasksCompat(!undergroundFog); // The pure-black Kanthic room has no generic warm furniture pools.
      if (undergroundFog && activeRuinTradition() === 'kanthic') drawRuinTraditionLightMasks(window.RuinMultifloorV50Style?.lightSources?.() || []);
      if (undergroundFog && activeRuinTradition() === 'kanthic') drawRuinTraditionLightMasks(window.RuinRopeTorch?.lightSources?.() || EMPTY_LIGHT_LIST);
      if (currentArea === 'map_i_dev_random_ruin') drawRuinTraditionLightMasks(window.RuinLayerPlayable?.roomLights?.() || []); // Solved rooms are lit in the fog path too.
      if (currentArea === 'map_i_dev_random_ruin') drawRuinTraditionLightMasks(window.DevRandomRuinSanctum?.lightSources?.() || []); // Fog-backed Kanthic light masks include the sanctum.
      if (currentArea === 'map_i_dev_random_ruin') drawRuinTraditionLightMasks(window.RuinCheckpointTravel?.lightSources?.() || []); // Checkpoint light uses the same Kanthic proximity policy in actual fog.
      if (currentArea === 'map_i_dev_random_ruin') drawRuinTraditionLightMasks(window.SkeeriRuins?.eyeLights?.() || EMPTY_LIGHT_LIST);
      if (currentArea === 'map_i_dev_random_ruin') drawRuinPatternGlowMasks(activeScene,now); // The fog and enclosed paths must agree about engraved emission.
    });
    if (currentArea === 'map_i_dev_random_ruin' && !kanthicVoid) paintRuinScreenTint(ctx,rect,activeRuinTradition()); // Fog-backed ruins receive the same low-opacity full-screen tint.

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
    window.WeatherFX.__daylightWindowAtmosphereHook = true; // Diagnostics flag: the unified pass owns window composition before local light masks.
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
    __test: Object.freeze({ undergroundLightingForArea, enclosedDarknessOverlayAlpha, westernSlopeSnowOpacity }), // Pure policy checks; the production overlay and mobile diagnostics use these same functions.
    init,
    update,
    renderOutlineMist,
    prepareKanthicGlyphFrame,hasKanthicLightingPass,renderKanthicGlyphFrame,endKanthicGlyphFrame,
    invalidateKanthicGlyphs:()=>{ruinGlowNextScan=0;},
    setLayerRadius,
    setLayerOpacity,
    getKanthicLanternRadiusTiles:()=>tuning.lantern.radiusTiles*0.32, // Reports the same effective tiny radius used by the shared compositor.
    refreshLightingOverlay: () => { lastUnifiedLightingDraw = -Infinity; window.WeatherFX?.drawLightingOverlay?.(); }, // Lets dev-only lighting controls redraw immediately without owning a second lighting path.
    projectLightMask: (x, y, z, radiusTiles, context) => lightingDeps ? projectLightMask(x, y, z, radiusTiles, context) : null, // Secondary gameplay overlays share this projection and coverage.
    outdoorLightVisibilityAt: (x, y, z, radiusTiles = 0) => {
      const area = lightingDeps?.getCurrentArea?.(); // Reuses the compositor's actual current area instead of asking separate glow owners to guess indoor status.
      const scene = lightingDeps?.getActiveScene?.() || window.GridTileAccessors?.getActiveScene?.(); // Farmhouse transitions may temporarily report the old outdoor area.
      if (!lightingDeps || enclosedLightingArea(area) || scene?.userData?.hobunjiPlayerFarmhouseInterior === true) return 1;
      return outdoorLightVisibility(x, y, z, radiusTiles); // Shared fade policy for spectral glows, Harlyao's second darkness pass and emissive orbs.
    },
    // Called by the Settings tab's Cloud Forest Fog toggle. update() itself
    // is simply not called at all while disabled (see game.js's per-frame
    // call site), which freezes the mist mid-animation rather than hiding
    // it — this force-hides the group immediately so turning the toggle off
    // is instant. Re-enabling needs no counterpart: the very next update()
    // call sets group.visible from isCloudForestArea() itself.
    setEnabled: (enabled) => { if (!enabled && group) { group.visible = false; syncUndergroundFog(null); } },
    isActive: () => !!(group?.visible && attachedScene),
    getDebugState: () => {
      const debugScene = skyPolicyDeps?.getActiveScene?.(); // Used below to expose the actual runtime player-lantern light state for mobile QA.
      const debugArea = skyPolicyDeps?.getCurrentArea?.() ?? deps?.getCurrentArea?.() ?? null; // Falls back to fog's own injected area if RainPlanes has not initialized its sky-policy hook.
      return {
        active: !!deps?.isCloudForestArea?.(),
        undergroundFog: isUndergroundFogArea(debugArea) && !!(group?.visible && attachedScene),
        westernSlopeSnow: {
          active: debugArea === WESTERN_SLOPE_ID && !!group?.visible,
          gustStrength: slopeGustStrength,
          windStrength: slopeWindStrength,
          precipitationStrength: slopePrecipitationStrength,
          targetScale: slopeTargetScale,
          opacityScale: slopeOpacityScale,
          cap: 'Cloud Forest per-layer opacity',
          meshCount: group?.visible ? layers.filter(layer => layer.mesh.visible).length : 0,
        }, // Phone-readable gust/storm transition and no-draw clear-weather checks.
        area: debugArea,
        fogColor: fogResultColor ? `#${fogResultColor.getHexString()}` : null,
        skydomeSuppressed: !!isNoSkyArea(debugArea),
        undergroundLanternArea: isUndergroundLanternArea(debugArea),
        latestChange: 'Kanthic black mist and lantern reveal follow the final camera pose, including cinematic blends; depth-tested emissions pierce the fog.',
        kanthicMistMode: debugArea === 'map_i_dev_random_ruin' && activeRuinTradition() === 'kanthic' ? (group?.visible ? 'cloud-forest-mist-and-underground-depth-fog' : 'mist-disabled-in-settings') : null, // Mobile Pixel Probe identifies the actual fog geometry policy.
        ruinLightOcclusion: window.RuinLightOcclusion?.debugSnapshot?.() || null, // Mobile debug readout counts scanned casters, firelight evaluations and clipped shadow projections.
        ruinEngravingGlowMasks: { ...ruinGlowStats, mode:isKanthicGlyphArea()?'room-local-world-depth':'legacy-radial',occlusionChecks:0,platformClips:0 }, // Mobile Pixel Probe exposes active region, candidates, GPU passes and texture uploads.
        kanthicFirelight: { ...ruinFireMaskStats, ...(window.RuinMultifloorV50Style?.lightDebug?.()||{}) }, // Both emitted/visible mask counts and actual ignited brazier counts are readable without devtools.
        interiorLightRadiusMultiplier: INTERIOR_LIGHT_RADIUS_MULTIPLIER,
        interiorLightFalloff: 'ease-out',
        undergroundDarknessKind: enclosedDarknessKind(debugArea),
        undergroundDarknessOverlayAlpha: enclosedDarknessOverlayAlpha(debugArea),
        undergroundFogLighting: { ...undergroundLightingForArea(debugArea) }, // Mobile Pixel Probe distinguishes the more legible Tzatzul nest fog from ordinary den darkness.
        lastInteriorDarknessDraw: lastInteriorDarknessDraw ? { ...lastInteriorDarknessDraw } : null, // Mobile QA shows whether a base mask was drawn for the active farmhouse.
        playerLanternVisible: !!debugScene?.getObjectByName?.('mine_player_torch')?.visible,
        outdoorLanternActivation: currentOutdoorLanternActivation(),
        outdoorLightVisibility: { ...outdoorLightStats, marginTiles: OUTDOOR_LIGHT_VISIBILITY_MARGIN_TILES, fadeTiles: OUTDOOR_LIGHT_FADE_TILES }, // Pixel Probe exposes how many wilderness lights were actually suppressed.
        outdoorWeatherTintRetention: currentOutdoorWeatherTintState()?.alpha ?? 0,
        renderingMode: 'original-skydome-visibility-only',
        lightingAuthority: window.WeatherFX?.__singleFullDayLightingAuthority ? 'full-day-shared' : 'legacy',
        moonIllumination: currentMoonIllumination(),
        lunarDarknessAddition: currentLunarDarknessAddition(),
        globalDarknessDelta: GLOBAL_DARKNESS_DELTA,
        daylightWindowMasks: { ...windowMaskStats }, // Live window count, masks drawn, and outdoor daylight factor for mobile QA.
        configPath: ATMOSPHERE_CONFIG_PATH,
        tuning: {
          cloudForest: { ...tuning.cloudForest },
          lantern: { ...tuning.lantern },
        },
        outlineMistRedrawLayers: group?.visible ? lastRedrawLayerCount : 0,
        kanthicCameraAtmosphere: kanthicCameraValid ? { center: {x:kanthicCameraMistCenter.x,y:kanthicCameraMistCenter.y,z:kanthicCameraMistCenter.z}, lantern: {x:kanthicCameraLantern.x,y:kanthicCameraLantern.y,z:kanthicCameraLantern.z} } : null, // Actual final-camera anchors for mobile QA.
        effectiveMistLayers: group?.visible ? layers.map(({ mesh }) => ({ visible: mesh.visible, radiusTiles: mesh.scale.x, height: mesh.scale.y, opacity: mesh.material.opacity, color: `#${mesh.material.color.getHexString()}`, textured: !!mesh.material.map })) : [], // Actual material values for phone-readable QA.
        treeFade: window.ZoneTreeFade?.snapshot(),
        layers: layerLive.map(l => ({ ...l })),
      };
    },
  };
})();
