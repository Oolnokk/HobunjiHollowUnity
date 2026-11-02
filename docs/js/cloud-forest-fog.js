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
    { defaultRadiusTiles: 4, height: 6.5, defaultOpacity: 0.14, repeatX: 5, repeatY: 1.3, driftSpeed: 0.007, spinSpeed: 0.012 },
    { defaultRadiusTiles: 3.7, height: 8.5, defaultOpacity: 0.26, repeatX: 7, repeatY: 1.7, driftSpeed: -0.005, spinSpeed: -0.008 },
    { defaultRadiusTiles: 15, height: 10.5, defaultOpacity: 0.46, repeatX: 9, repeatY: 2.1, driftSpeed: 0.004, spinSpeed: 0.006 },
  ];
  // Mutable per-layer live state, read every frame in update() — separate
  // from LAYER_CONFIG (which stays the fixed startup defaults) so a
  // Settings-tab slider can change these without touching the defaults.
  const layerLive = LAYER_CONFIG.map(cfg => ({ radiusTiles: cfg.defaultRadiusTiles, opacity: cfg.defaultOpacity }));
  const ATMOSPHERE_CONFIG_PATH = './config/atmosphere-lighting.json';
  // Mines, animal dens and the Kanthic ruin borrow the Cloud Forest's
  // midnight look instead of a flat near-black overlay: the skydome's deepest
  // night stop for the overlay, plus near-black fog and mist that swallow the
  // distance while nearby things stay readable.
  const UNDERGROUND_NIGHT_LIGHTING = Object.freeze({ r: 5, g: 8, b: 23, a: 0.80 });
  const KANTHIC_STANDARD_DARKNESS_ALPHA = 0.95; // Kanthic uses the same unified mist/night darkness pass at higher opacity, never a second vignette.
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

  function currentMoonIllumination() {
    const value = window.HobunjiSkyDome?.getDebugState?.().moonIllumination; // Reuses the skydome's existing 28-day lunar-month phase calculation so lighting and the rendered moon cannot disagree.
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

  function update(dt) {
    if (!deps || !group) return;
    const cloudForest = deps.isCloudForestArea();
    const underground = !cloudForest && isUndergroundFogArea(deps.getCurrentArea?.());
    const active = cloudForest || underground;
    const activeScene = active ? deps.getActiveScene() : null;
    if (activeScene !== attachedScene) {
      attachedScene?.remove(group);
      activeScene?.add(group);
      attachedScene = activeScene;
    }
    syncUndergroundFog(underground ? activeScene : null);
    group.visible = active;
    if (!active) return;

    if (cloudForest) {
      const skyRoot = namedInScene(activeScene, 'hobunji_dynamic_skydome');
      if (skyRoot) skyRoot.visible = false;
      updateFogLighting(activeScene);
    } else {
      updateFogLighting(activeScene, UNDERGROUND_NIGHT_LIGHTING);
    }

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
  let lastUnifiedLightingArea = null; // Forces a new darkness frame as soon as the player area changes.
  let lastUnifiedLightingScene = null; // Detects activation of a farmhouse scene even if its area identifier has not switched yet.
  let lastInteriorDarknessDraw = null; // Mobile diagnostics of the shared compositor's actual enclosed base fill.
  const lightCamRight = new window.THREE.Vector3(); // Reused camera-right axis for stable screen-space light radii.
  const lightCamUp = new window.THREE.Vector3(); // Reused camera-up axis for camera-independent farmhouse light projection.
  const lightCameraPosition = new window.THREE.Vector3(); // Reused camera position for off-screen source depth checks.
  const lightViewDirection = new window.THREE.Vector3(); // Reused camera forward direction for off-screen source depth checks.
  const lightToSource = new window.THREE.Vector3(); // Reused camera-to-source vector; no per-light allocations.
  const lightPlayerPosition = new window.THREE.Vector3(); // Reused player-depth plane origin for farmhouse light projection.
  const ambientWindowScratch = new window.THREE.Vector3(); // Reused for window world positions so the mask pass allocates nothing per source.
  const windowMaskStats = { sources: 0, drawn: 0, glows: 0, colorAuras: 0, daylight: 0 }; // Mobile QA readout for the daylight-window mask pass.

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
    let projectedX = x, projectedY = y, projectedZ = z, projectedRadius = tiles;
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
      if (distanceSquared > rangeTiles * rangeTiles) return null; // The visual mask radius and the fixture's actual influence range are separate.
      const lateralX = lightToSource.dot(lightCamRight);
      const lateralY = lightToSource.dot(lightCamUp);
      projectedX = playerX + lightCamRight.x * lateralX + lightCamUp.x * lateralY;
      projectedY = playerY + lightCamRight.y * lateralX + lightCamUp.y * lateralY;
      projectedZ = playerZ + lightCamRight.z * lateralX + lightCamUp.z * lateralY;
    }
    const center = lightingDeps.worldToOverlay(projectedX, projectedY, projectedZ);
    const radius = lightScreenRadius(projectedX, projectedZ, projectedY, projectedRadius);
    if (!lightMaskIntersectsViewport(center, radius, context, projectedX, projectedY, projectedZ, projectedRadius)) return null;
    return { center, radius, x: projectedX, y: projectedY, z: projectedZ };
  }

  function lightMaskIntersectsViewport(center, radius, context, x, y, z, worldRadius) {
    if (!Number.isFinite(center?.x) || !Number.isFinite(center?.y) || !(radius > 0) || !Number.isFinite(radius)) return false;
    if (!(worldRadius > 0) || !Number.isFinite(worldRadius)) return false;
    const camera = lightingDeps.camera;
    camera.getWorldPosition(lightCameraPosition);
    camera.getWorldDirection(lightViewDirection);
    lightToSource.set(x, y, z).sub(lightCameraPosition);
    const depth = lightToSource.dot(lightViewDirection);
    const near = Number.isFinite(camera.near) ? camera.near : 0;
    const far = Number.isFinite(camera.far) ? camera.far : Infinity;
    // Keep a light while its world-space influence sphere overlaps the camera depth range.
    // The projected center can leave the near/far clip range before the soft edge leaves view.
    if (depth <= 0 || depth + worldRadius < near || depth - worldRadius > far) return false;
    const rect = lightingDeps.getThreeRect?.();
    const width = Number(rect?.width || context?.canvas?.clientWidth || context?.canvas?.width);
    const height = Number(rect?.height || context?.canvas?.clientHeight || context?.canvas?.height);
    return width > 0 && height > 0
      && center.x + radius >= 0 && center.x - radius <= width
      && center.y + radius >= 0 && center.y - radius <= height;
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
    const ruinLanternScale = 1; // Kanthic uses the ordinary full-radius, soft-edged lantern rather than a separate circular vignette.
    const ctx = lightingDeps.lctx;
    const activeScene = lightingDeps.getActiveScene?.() || window.GridTileAccessors?.getActiveScene?.(); // The player farmhouse's special base-light rule uses its active scene identity.
    const farmhouseSceneActive = activeScene?.userData?.hobunjiPlayerFarmhouseInterior === true; // Unlike mines, the farmhouse has no permanently lit player torch.
    const carriers = farmhouseSceneActive ? [] : [{ // Other areas preserve their legacy always-on carried lantern; farmhouse relies on real furniture/window light sources.
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
    const linearInterior = ordinaryBuildingInterior(currentArea); // Only ordinary buildings expand their physical light radius.
    for (const carrier of carriers) {
      const center = lightingDeps.worldToOverlay(carrier.x, carrier.y, carrier.z);
      const shineR = lightScreenRadius(carrier.x, carrier.z, carrier.y, lanternTuning.radiusTiles * ruinLanternScale * (linearInterior ? INTERIOR_LIGHT_RADIUS_MULTIPLIER : 1));
      if (!lightMaskIntersectsViewport(center, shineR, ctx, carrier.x, carrier.y, carrier.z, lanternTuning.radiusTiles * ruinLanternScale * (linearInterior ? INTERIOR_LIGHT_RADIUS_MULTIPLIER : 1))) continue;
      const clarityFrac = clamp01(lanternTuning.clarityRadiusTiles / Math.max(0.000001, lanternTuning.radiusTiles));
      const grad = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, shineR);
      const transmission = interiorLightTransmission(carrier.x, carrier.z);
      if (transmission <= 0.005) continue;
      const effectiveStrength = lanternStrength * transmission;
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
      ctx.beginPath();
      ctx.arc(center.x, center.y, shineR, 0, Math.PI * 2);
      ctx.fill();
    }

    const weatherTint = preserveOutdoorWeatherTint ? currentOutdoorWeatherTintState() : null; // Used below to put back weather color without restoring the darkness the lantern just removed.
    if (weatherTint) {
      ctx.globalCompositeOperation = 'multiply';
      for (const carrier of carriers) {
        const center = lightingDeps.worldToOverlay(carrier.x, carrier.y, carrier.z);
        const shineR = lightScreenRadius(carrier.x, carrier.z, carrier.y, lanternTuning.radiusTiles * ruinLanternScale);
        if (!lightMaskIntersectsViewport(center, shineR, ctx, carrier.x, carrier.y, carrier.z, lanternTuning.radiusTiles * ruinLanternScale)) continue;
        const clarityFrac = clamp01(lanternTuning.clarityRadiusTiles / Math.max(0.000001, lanternTuning.radiusTiles));
        const grad = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, shineR);
        addWeatherTintStops(
          grad,
          weatherTint,
          lanternTuning.centerMaskAlpha * lanternStrength,
          lanternTuning.clarityMaskAlpha * lanternStrength,
          lanternTuning.softMaskAlpha * lanternStrength,
          clarityFrac,
          lanternTuning.softTransitionFraction,
        );
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(center.x, center.y, shineR, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawFurnitureLightMasksCompat(preserveOutdoorWeatherTint = false) {
    const ctx = lightingDeps.lctx;
    const visible = [];
    const currentArea = lightingDeps.getCurrentArea();
    const softInterior = enclosedLightingArea(currentArea); // All enclosed spaces fade softly into their own darkness.
    const linearInterior = ordinaryBuildingInterior(currentArea); // Only ordinary buildings expand the physical light radius.
    for (const light of lightingDeps.getFurnitureLightSources()) {
      const transmission = interiorLightTransmission(light.x, light.z);
      if (transmission <= 0.005) continue;
      const projected = projectInteriorLightMask(light.x, light.y, light.z, light.distance * (linearInterior ? INTERIOR_LIGHT_RADIUS_MULTIPLIER : 1), ctx);
      if (!projected) continue;
      visible.push({ light, center: projected.center, shineR: projected.radius, transmission });
    }

    ctx.globalCompositeOperation = 'destination-out';
    for (const { light, center, shineR, transmission } of visible) {
      const clarityFrac = Math.min(0.55, Math.max(0.18, 1.15 / light.distance));
      const strength = Math.min(0.94, 0.58 + light.intensity * 0.22) * transmission;
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
      ctx.beginPath();
      ctx.arc(center.x, center.y, shineR, 0, Math.PI * 2);
      ctx.fill();
    }

    const weatherTint = preserveOutdoorWeatherTint ? currentOutdoorWeatherTintState() : null; // Used below so static outdoor lights preserve the same weather coloration as carried/watch lanterns.
    if (weatherTint) {
      ctx.globalCompositeOperation = 'multiply';
      for (const { light, center, shineR, transmission } of visible) {
        const clarityFrac = Math.min(0.55, Math.max(0.18, 1.15 / light.distance));
        const strength = Math.min(0.94, 0.58 + light.intensity * 0.22) * transmission;
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
        ctx.beginPath();
        ctx.arc(center.x, center.y, shineR, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.globalCompositeOperation = 'source-over';
    for (const { light, center, shineR, transmission } of visible) {
      const glowR = shineR * (linearInterior ? 1 : 0.62);
      const glowAlpha = Math.min(0.18, 0.055 + light.intensity * 0.055) * transmission;
      const { r, g, b } = light.color;
      const glow = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, glowR);
      glow.addColorStop(0, `rgba(${r},${g},${b},${glowAlpha})`);
      if (softInterior) {
        glow.addColorStop(0.36, `rgba(${r},${g},${b},${glowAlpha * 0.82})`);
        glow.addColorStop(0.72, `rgba(${r},${g},${b},${glowAlpha * 0.32})`);
      } else glow.addColorStop(0.4, `rgba(${r},${g},${b},${glowAlpha * 0.45})`);
      glow.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(center.x, center.y, glowR, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawRuinTraditionLightMasks() {
    const lights = window.DevRandomRuinLichThemes?.lightSources?.() || []; // Cached generation-time floor/wall/ceiling sources, never scene traversals.
    if (!lights.length) return;
    const ctx = lightingDeps.lctx;
    const visible = []; // Kept for the second coloured-glow pass, so project each source just once.
    for (const light of lights) {
      const transmission = interiorLightTransmission(light.x, light.z);
      if (transmission <= 0.005) continue;
      const center = lightingDeps.worldToOverlay(light.x, light.y, light.z);
      const radius = lightScreenRadius(light.x, light.z, light.y, light.radius);
      if (!lightMaskIntersectsViewport(center, radius, ctx, light.x, light.y, light.z, light.radius)) continue;
      visible.push({light,center,radius,transmission});
    }
    ctx.globalCompositeOperation = 'destination-out';
    for (const {light,center,radius,transmission} of visible) {
      const strength = light.strength * transmission;
      const grad = ctx.createRadialGradient(center.x,center.y,0,center.x,center.y,radius);
      grad.addColorStop(0,'rgba(0,0,0,'+strength+')');
      if (enclosedLightingArea(lightingDeps.getCurrentArea())) addInteriorFalloffStops(grad,strength);
      else grad.addColorStop(.42,'rgba(0,0,0,'+(strength*.42)+')');
      grad.addColorStop(1,'rgba(0,0,0,0)'); // Special-ruin light now shares the enclosed-room eased edge.
      ctx.fillStyle=grad;
      ctx.beginPath();ctx.arc(center.x,center.y,radius,0,Math.PI*2);ctx.fill();
    }
    ctx.globalCompositeOperation='source-over';
    for (const {light,center,radius,transmission} of visible) {
      const [r,g,b]=light.color;
      const grad=ctx.createRadialGradient(center.x,center.y,0,center.x,center.y,radius);
      const glowStrength = .18 * transmission;
      grad.addColorStop(0,'rgba('+r+','+g+','+b+','+glowStrength+')');
      if (enclosedLightingArea(lightingDeps.getCurrentArea())) {
        grad.addColorStop(.36,'rgba('+r+','+g+','+b+','+(glowStrength*.82)+')');
        grad.addColorStop(.72,'rgba('+r+','+g+','+b+','+(glowStrength*.32)+')');
      } else grad.addColorStop(.35,'rgba('+r+','+g+','+b+','+(.065*transmission)+')');
      grad.addColorStop(1,'rgba('+r+','+g+','+b+',0)');
      ctx.fillStyle=grad;ctx.beginPath();ctx.arc(center.x,center.y,radius,0,Math.PI*2);ctx.fill();
    }
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

  function interiorLightTransmission(sourceX, sourceZ) {
    const currentArea = lightingDeps?.getCurrentArea?.();
    const activeScene = lightingDeps?.getActiveScene?.() || window.GridTileAccessors?.getActiveScene?.();
    if (!enclosedLightingArea(currentArea)) return 1;
    const player = lightingDeps.player;
    const fromX = finiteOr(player?.x, 0) / lightingDeps.TILE;
    const fromZ = finiteOr(player?.y, 0) / lightingDeps.TILE;
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
        drawWindowRevealCircle(ctx, pane.center, pane.radius, WINDOW_PANE_GLOW_STRENGTH * transmission, 0.55); // Pane glow: day and night, no spread.
        windowMaskStats.glows += 1;
      }
      if (daylight <= 0.02) continue;
      const radiusTiles = Math.max(0.25, finiteOr(source.radiusTiles, 2.8));
      const projected = projectInteriorLightMask(ambientWindowScratch.x, ambientWindowScratch.y, ambientWindowScratch.z, radiusTiles * INTERIOR_LIGHT_RADIUS_MULTIPLIER, ctx);
      const strength = Math.min(0.9, clamp01(source.strength) * daylight * 0.85) * transmission;
      if (!(strength > 0) || !projected) continue;
      drawWindowRevealCircle(ctx, projected.center, projected.radius, strength, 0.35, true); // Daylight pool spreading into the room.
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
      if (drawStainedGlassAura(ctx, source, projected.center, projected.radius, strength)) windowMaskStats.colorAuras++;
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
    const activeScene = lightingDeps.getActiveScene?.() || window.GridTileAccessors?.getActiveScene?.() || null; // The rendered scene is authoritative if the area-id update trails a transition.
    const farmhouseSceneActive = activeScene?.userData?.hobunjiPlayerFarmhouseInterior === true; // Keeps the farmhouse dark even during a temporarily stale outdoor area id.
    if (now - lastUnifiedLightingDraw < LIGHTING_OVERLAY_MIN_INTERVAL_MS && lightningAlpha <= 0 && sceneTransAlpha <= 0
        && currentArea === lastUnifiedLightingArea && activeScene === lastUnifiedLightingScene) return;
    lastUnifiedLightingDraw = now;
    lastUnifiedLightingArea = currentArea;
    lastUnifiedLightingScene = activeScene;

    const ctx = lightingDeps.lctx;
    ctx.globalAlpha = 1; // The darkness fill must not inherit opacity changes from another canvas consumer.
    const surface = window.WeatherFX?.ensurePresentationSurface?.({ reason: 'unified-lighting-draw' }); // Keeps the authoritative replacement lighting pass on the same repaired CSS/backing dimensions as WebGL.
    const rect = surface?.rect || lightingDeps.getThreeRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
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
      lastInteriorDarknessDraw = { area: currentArea, farmhouseSceneActive, alpha: effectiveDarknessAlpha, at: now }; // Mobile diagnostics reflect the painted base, not a hypothetical calculation.
      ctx.globalCompositeOperation = 'source-over';
      const ruinTradition = currentArea === 'map_i_dev_random_ruin' ? (window.DevRandomRuinLichThemes?.activeTheme?.() || window.DevRandomRuin?.getRuntimeContext?.()?.theme) : null;
      ctx.fillStyle = ruinTradition === 'tothal' ? 'rgba(6,18,44,'+effectiveDarknessAlpha+')' : ruinTradition === 'hronal' ? 'rgba(20,7,2,'+effectiveDarknessAlpha+')' : 'rgba(0,0,0,'+effectiveDarknessAlpha+')';
      ctx.fillRect(0, 0, rect.width, rect.height);
      drawLanternMasksCompat(1);
      if (ruinTradition !== 'kanthic' && ruinTradition !== 'tothal') drawFurnitureLightMasksCompat(); // The pure-black Kanthic room and cold Tothal room have no generic warm furniture pools.
      if (ruinTradition === 'hronal' || ruinTradition === 'tothal') drawRuinTraditionLightMasks();
      if (ordinaryBuildingInterior(currentArea) && !ruinTradition) drawWindowLightMasks();
      if (sceneTransAlpha > 0) {
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = `rgba(0,0,0,${sceneTransAlpha})`;
        ctx.fillRect(0, 0, rect.width, rect.height);
      }
      return;
    }

    lastInteriorDarknessDraw = null; // Never report an interior base fill after returning outside.
    const { r, g, b, a } = undergroundFog ? UNDERGROUND_NIGHT_LIGHTING : getFullDayLighting();
    const darknessAlpha = undergroundFog && activeRuinTradition() === 'kanthic' ? Math.max(a, KANTHIC_STANDARD_DARKNESS_ALPHA) : a; // Stronger ordinary ambient darkness replaces the old hard circular cutout.
    ctx.globalCompositeOperation = darknessAlpha < 0.09 ? 'screen' : 'multiply';
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${darknessAlpha})`;
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.globalCompositeOperation = 'source-over';

    // Outdoor carried/watch lanterns still clear darkness, but preserve a configurable amount of the active weather tint.
    drawLanternMasksCompat(undergroundFog ? 1 : currentOutdoorLanternActivation(), !undergroundFog);
    if (!(undergroundFog && activeRuinTradition() === 'kanthic')) drawFurnitureLightMasksCompat(!undergroundFog); // The pure-black Kanthic room has no generic warm furniture pools.

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
    init,
    update,
    setLayerRadius,
    setLayerOpacity,
    getKanthicLanternRadiusTiles:()=>tuning.lantern.radiusTiles, // Compatibility API: Kanthic now uses the normal smooth lantern radius.
    refreshLightingOverlay: () => { lastUnifiedLightingDraw = -Infinity; window.WeatherFX?.drawLightingOverlay?.(); }, // Lets dev-only lighting controls redraw immediately without owning a second lighting path.
    // Called by the Settings tab's Cloud Forest Fog toggle. update() itself
    // is simply not called at all while disabled (see game.js's per-frame
    // call site), which freezes the mist mid-animation rather than hiding
    // it — this force-hides the group immediately so turning the toggle off
    // is instant. Re-enabling needs no counterpart: the very next update()
    // call sets group.visible from isCloudForestArea() itself.
    setEnabled: (enabled) => { if (!enabled && group) { group.visible = false; syncUndergroundFog(null); } },
    // True only while the mist group is attached and showing, so game.js can
    // skip its layer-5 mist redraw (a full extra scene render) everywhere else.
    isActive: () => !!(group?.visible && attachedScene),
    getDebugState: () => {
      const debugScene = skyPolicyDeps?.getActiveScene?.(); // Used below to expose the actual runtime player-lantern light state for mobile QA.
      const debugArea = skyPolicyDeps?.getCurrentArea?.() ?? null; // Used below to show which underground-area rule is currently active.
      return {
        active: !!deps?.isCloudForestArea?.(),
        undergroundFog: isUndergroundFogArea(debugArea) && !!(group?.visible && attachedScene),
        area: debugArea,
        fogColor: fogResultColor ? `#${fogResultColor.getHexString()}` : null,
        skydomeSuppressed: !!isNoSkyArea(debugArea),
        undergroundLanternArea: isUndergroundLanternArea(debugArea),
        latestChange: 'Interior light pools use a wider eased fade and fade through animated closed-door blockers; farmhouse and authored rooms share the same compositor.',
        interiorLightRadiusMultiplier: INTERIOR_LIGHT_RADIUS_MULTIPLIER,
        interiorLightFalloff: 'ease-out',
        undergroundDarknessKind: enclosedDarknessKind(debugArea),
        undergroundDarknessOverlayAlpha: enclosedDarknessOverlayAlpha(debugArea),
        lastInteriorDarknessDraw: lastInteriorDarknessDraw ? { ...lastInteriorDarknessDraw } : null, // Mobile QA shows whether a base mask was drawn for the active farmhouse.
        playerLanternVisible: !!debugScene?.getObjectByName?.('mine_player_torch')?.visible,
        outdoorLanternActivation: currentOutdoorLanternActivation(),
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
        layers: layerLive.map(l => ({ ...l })),
      };
    },
  };
})();
