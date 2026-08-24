(() => {
  'use strict';

  // A handful of large translucent mist cylinders centered on the player,
  // shown only in the Southern Cloud Forest. The cloud forest intentionally
  // does not show the dynamic skydome; its FogExp2 + mist inherit the same
  // 24-hour lighting state instead.
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
    const stampBlob = (x, y, r, alpha) => {
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, `rgba(255,255,255,${alpha})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    };
    for (let i = 0; i < 70; i++) {
      const x = random() * size, y = random() * size;
      const r = 18 + random() * 58;
      const alpha = 0.12 + random() * 0.34;
      for (const dx of [-size, 0, size]) {
        for (const dy of [-size, 0, size]) {
          if (x + dx > -r && x + dx < size + r && y + dy > -r && y + dy < size + r) stampBlob(x + dx, y + dy, r, alpha);
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
    const geometry = new THREE.CylinderGeometry(1, 1, 1, 28, 1, true);
    const mesh = new THREE.Mesh(geometry, material);
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
    if (!fogTimeColor || !fogResultColor || !fogDayColor) return;
    const light = getFullDayLighting();
    fogTimeColor.setRGB(clamp01(light.r / 255), clamp01(light.g / 255), clamp01(light.b / 255));
    const timeTintAmount = Math.max(0.18, Math.min(0.86, 0.18 + clamp01(light.a) * 0.82));
    fogResultColor.copy(fogDayColor).lerp(fogTimeColor, timeTintAmount);
    for (const layer of layers) layer.material.color.copy(fogResultColor);
    if (activeScene?.fog?.color) activeScene.fog.color.copy(fogResultColor);

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

    // Visibility policy only: do not alter the skydome's materials, textures,
    // shader, render order, or geometry in the Cloud Forest.
    const skyRoot = activeScene?.getObjectByName?.('hobunji_dynamic_skydome');
    if (skyRoot) skyRoot.visible = false;
    updateFogLighting(activeScene);

    const outerRadius = deps.getCloudForestFogRadiusTiles?.() ?? FALLBACK_OUTER_RADIUS_TILES;
    const px = deps.player.x / deps.TILE, pz = deps.player.y / deps.TILE;
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

  // Area-only skydome policy. This wraps the existing RainPlanes integration
  // after sky-dome.js has installed itself, and only toggles root visibility.
  // It does not change any sky/material rendering behavior.
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
      if (scene?.background?.isColor && isNoSkyArea(skyPolicyDeps?.getCurrentArea?.()) && !deps?.isCloudForestArea?.()) {
        scene.background.set(0x000000);
      }
      return result;
    };
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
    }),
  };
})();
