// Runtime corrections for authored interior fire furniture and the exterior
// void seen around building interiors. Loaded by interior-fire-floor-integration
// after the normal authored/procedural furniture runtimes are available.
(() => {
  'use strict';

  if (window.InteriorFireVoidRuntime?.installed) return;

  const THREE = window.THREE; // Used for the unlit black interior backdrop and screen-space light-radius projection.
  const furniture = window.ProceduralFurniture; // Shared procedural fallback path used by gameplay and the editor.
  if (!THREE || !furniture?.buildFurnitureGroup || !furniture?.CATALOG) {
    window.InteriorFireVoidRuntime = { installed: false, reason: 'missing THREE/ProceduralFurniture' };
    return;
  }

  const FIRE_KEY_ALIASES = Object.freeze({ // Converts authored item keys into the visual keys consumed by both furniture runtimes.
    campfireFurniture: 'campfire',
    bonfireFurniture: 'bonfire',
  });
  const FIRE_DEFS = Object.freeze({ // Mirrors runtime + editor catalog fields so early lookups cannot fall through to a gray placeholder cube.
    campfireFurniture: Object.freeze({
      key: 'campfireFurniture', label: 'Campfire', name: 'Campfire', icon: '🔥', fw: 1, fd: 1,
      procKey: 'campfire', col: 0x6d3e20, color: 0x6d3e20,
      desc: 'A compact stone-ring campfire using the authored campfire furniture preset.',
    }),
    bonfireFurniture: Object.freeze({
      key: 'bonfireFurniture', label: 'Bonfire', name: 'Bonfire', icon: '🔥', fw: 2, fd: 2,
      procKey: 'bonfire', col: 0x6d3e20, color: 0x6d3e20,
      desc: 'A two-by-two bonfire derived from the authored campfire at double scale.',
    }),
  });
  const VOID_NAME = 'hobunji_interior_unlit_black_void'; // Stable name used to update/reuse one backdrop per loaded interior.

  // Enclosed-area lighting deliberately stays a 2D darkness mask, matching
  // outdoor night/lantern rendering instead of converting flat character art
  // to Lambert/Phong materials. That means NPC/player/creature PNG planes,
  // unlit floors, and lit 3D props all receive the same visible darkness.
  const ENCLOSED_MAX_DARKNESS_ALPHA = 0.80; // Matches the existing full-night overlay ceiling used by the day/night system.
  const ENCLOSED_REFERENCE_ALPHA = 0.28; // Historical interior dimness at normal authored illumination (1.0).
  const ENCLOSED_FALLOFF = Math.log(ENCLOSED_MAX_DARKNESS_ALPHA / ENCLOSED_REFERENCE_ALPHA);
  const UNDERGROUND_ILLUMINATION = 0.08; // Mines/dens without authored lighting stay near full-night darkness until locally lit.
  const LANTERN_TUNING = Object.freeze({
    radiusTiles: 3.6,
    clarityRadiusTiles: 0.95,
    centerMaskAlpha: 0.92,
    clarityMaskAlpha: 0.80,
    softMaskAlpha: 0.28,
    softTransitionFraction: 0.18,
  }); // Mirrors atmosphere-lighting.json / cloud-forest-fog defaults so the same lantern reads consistently indoors and outdoors.

  let buildingSceneMap = null; // The private building-scene map exposed by GridTileAccessors.init.
  let lastVoidMapId = null; // Debug snapshot of the most recently blackened interior.
  let lastFireKey = null; // Debug snapshot of the most recently canonicalized fire furniture key.
  let definitionBridgeInstalled = false; // Confirms the early decorative-definition compatibility bridge is active.
  let catalogFallbackInstalled = false; // Confirms the bonfire has non-empty immediate procedural geometry.

  const enclosedLightingCache = new Map(); // mapId -> { status, settings }; populated lazily because the overlay draw is synchronous.
  let weatherDeps = null; // Captured from WeatherFX.init so the enclosed overlay uses the exact existing lighting canvas and projections.
  let weatherDrawUpstream = null; // Latest normal/cloud-forest WeatherFX draw function; outdoor areas delegate to it unchanged.
  let weatherBridgeInstalled = false;
  let weatherAssignmentBridgeInstalled = false;
  let lastEnclosedDraw = 0;
  let lastOverlayArea = null;
  let lastOverlayAlpha = null;
  let lastOverlayIllumination = null;
  let lastOverlayLocalLights = 0;
  const lightCamRight = new THREE.Vector3();

  const clamp = (value, min, max, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
  };

  function canonicalFireKey(key) {
    const raw = String(key || '').trim();
    return FIRE_KEY_ALIASES[raw] || raw;
  }

  function scaleRecipe(source, scale) {
    return (Array.isArray(source) ? source : []).map(part => {
      const clone = JSON.parse(JSON.stringify(part)); // Recipes are plain JSON-shaped objects; clone keeps the campfire recipe independent.
      const t = clone.transform || {};
      for (const field of ['x', 'y', 'z', 'sx', 'sy', 'sz']) {
        if (Number.isFinite(Number(t[field]))) t[field] = Number(t[field]) * scale;
      }
      return clone;
    });
  }

  function installImmediateFireCatalog() {
    const catalog = furniture.CATALOG;
    const campfire = catalog.campfire;
    if (Array.isArray(campfire) && campfire.length && (!Array.isArray(catalog.bonfire) || !catalog.bonfire.length)) {
      // The authored bonfire still replaces this when its JSON resolves; this
      // only prevents an empty group from causing the caller's generic cube
      // fallback during that asynchronous window.
      catalog.bonfire = scaleRecipe(campfire, 2);
      catalogFallbackInstalled = true;
    }
    for (const [itemKey, visualKey] of Object.entries(FIRE_KEY_ALIASES)) {
      if (Object.prototype.hasOwnProperty.call(catalog, itemKey)) continue;
      Object.defineProperty(catalog, itemKey, {
        configurable: true,
        enumerable: false,
        get() { return catalog[visualKey]; },
        set(value) { Object.defineProperty(catalog, itemKey, { configurable: true, enumerable: true, writable: true, value }); },
      });
    }
  }

  function isDecorativeDefinitionMap(value) {
    return !!value && typeof value === 'object'
      && Object.prototype.hasOwnProperty.call(value, 'basicBedFurniture')
      && Object.prototype.hasOwnProperty.call(value, 'chairSimpleFurniture')
      && Object.prototype.hasOwnProperty.call(value, 'rugFurniture');
  }

  function installDecorativeDefinitionBridge() {
    for (const [itemKey, definition] of Object.entries(FIRE_DEFS)) {
      if (Object.prototype.hasOwnProperty.call(Object.prototype, itemKey)) continue;
      Object.defineProperty(Object.prototype, itemKey, {
        configurable: true,
        enumerable: false,
        get() { return isDecorativeDefinitionMap(this) ? definition : undefined; },
        set(value) {
          // Preserve ordinary assignment semantics for unrelated objects that genuinely use this property name.
          Object.defineProperty(this, itemKey, { configurable: true, enumerable: true, writable: true, value });
        },
      });
    }
    definitionBridgeInstalled = true;
  }

  function installFurnitureKeyBridge() {
    const existing = furniture.buildFurnitureGroup;
    if (existing.__hobunjiFireItemKeyCanonicalized) return true;
    function buildFurnitureGroupWithFireAliases(key, baseColor) {
      const canonical = canonicalFireKey(key);
      if (canonical !== key) lastFireKey = `${key}->${canonical}`;
      return existing.call(this, canonical, baseColor);
    }
    Object.assign(buildFurnitureGroupWithFireAliases, existing);
    buildFurnitureGroupWithFireAliases.__hobunjiFireItemKeyCanonicalized = true;
    buildFurnitureGroupWithFireAliases.__hobunjiFireItemKeyOriginal = existing;
    furniture.buildFurnitureGroup = buildFurnitureGroupWithFireAliases;
    return true;
  }

  function blackVoidForScene(sceneRecord, mapId) {
    const root = sceneRecord?.scene;
    if (!root?.add) return null;
    let backdrop = root.getObjectByName?.(VOID_NAME) || null;
    if (!backdrop) {
      const bounds = new THREE.Box3().setFromObject(root); // Centers the backdrop around the authored room instead of assuming maps start at 0,0.
      const center = new THREE.Vector3();
      const size = new THREE.Vector3();
      if (!bounds.isEmpty()) {
        bounds.getCenter(center);
        bounds.getSize(size);
      }
      const horizontalSpan = Math.max(size.x || 0, size.z || 0, 20);
      const boxSize = Math.max(240, horizontalSpan * 8); // Large enough that normal interior cameras never see past an edge.
      const boxHeight = Math.max(160, (size.y || 0) * 10 + 40);
      // This is the actual outside-of-room atmosphere: pure black and
      // deliberately unlit. Neither ambient/daylight/local lights nor fog can
      // turn it brown/gray as the church lighting changes.
      const material = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide, depthWrite: false });
      material.fog = false;
      material.toneMapped = false;
      backdrop = new THREE.Mesh(new THREE.BoxGeometry(boxSize, boxHeight, boxSize), material);
      backdrop.name = VOID_NAME;
      backdrop.position.set(center.x, 0, center.z);
      backdrop.renderOrder = -10000;
      backdrop.frustumCulled = false;
      backdrop.userData.hobunjiInteriorVoid = true;
      backdrop.userData.unlitBlack = true;
      backdrop.raycast = () => {}; // Backdrop must never block gameplay/camera interaction rays.
      root.add(backdrop);
    } else {
      for (const material of (Array.isArray(backdrop.material) ? backdrop.material : [backdrop.material]).filter(Boolean)) {
        material.color?.set?.(0x000000);
        material.fog = false;
        material.toneMapped = false;
        material.needsUpdate = true;
      }
    }
    lastVoidMapId = mapId;
    return backdrop;
  }

  function hookBuildingSceneMap(map) {
    if (!map?.set || map.__hobunjiInteriorBlackVoidSetHook) return false;
    buildingSceneMap = map;
    const originalSet = map.set.bind(map); // Chains cleanly with the floor/environment Map.set wrappers already installed.
    map.set = function setBuildingSceneWithBlackVoid(mapId, sceneRecord) {
      const result = originalSet(mapId, sceneRecord);
      queueMicrotask(() => { blackVoidForScene(sceneRecord, mapId); });
      return result;
    };
    Object.defineProperty(map, '__hobunjiInteriorBlackVoidSetHook', { value: true, configurable: true });
    for (const [mapId, sceneRecord] of map.entries()) queueMicrotask(() => { blackVoidForScene(sceneRecord, mapId); });
    return true;
  }

  function wrapGridTileAccessorsInit() {
    const namespace = window.GridTileAccessors;
    if (!namespace?.init || namespace.__hobunjiInteriorBlackVoidInitHook) return false;
    const originalInit = namespace.init;
    namespace.init = function initWithInteriorBlackVoid(injectedDeps) {
      hookBuildingSceneMap(injectedDeps?._buildingScenes);
      return originalInit.call(this, injectedDeps);
    };
    namespace.__hobunjiInteriorBlackVoidInitHook = true;
    return true;
  }

  // ── Night-style enclosed-area overlay lighting ─────────────────────
  function isUndergroundArea(area) {
    const id = String(area || '').trim().toLowerCase();
    return id === 'map_i_town_mine_safe'
      || id.startsWith('map_i_town_mine_f_')
      || id.startsWith('map_i_den_')
      || id.includes('cavern')
      || id.includes('burrow')
      || /(?:^|[_:-])den(?:[_:-]|$)/.test(id);
  }

  function isEnclosedArea(area) {
    const id = String(area || '').trim().toLowerCase();
    if (!id) return false;
    return id === 'interior'
      || id.startsWith('map_i_')
      || isUndergroundArea(id)
      || !!window.GridTileAccessors?.isBuildingArea?.(area);
  }

  function normalizeOverlayLighting(value) {
    if (!value || typeof value !== 'object') return null;
    return {
      baseLightLevel: clamp(value.baseLightLevel, 0, 4, 1),
      daylightInfluence: clamp(value.daylightInfluence, 0, 6, 1),
    };
  }

  function mapIdForArea(area) {
    const id = String(area || '').trim();
    if (/^map_i_[A-Za-z0-9_-]+$/.test(id)) return id;
    const buildingMatch = id.match(/(map_i_[A-Za-z0-9_-]+)/);
    return buildingMatch ? buildingMatch[1] : null;
  }

  function requestOverlayLighting(area) {
    const mapId = mapIdForArea(area);
    if (!mapId || enclosedLightingCache.has(mapId) || typeof fetch !== 'function') return;
    const record = { status: 'loading', settings: null };
    enclosedLightingCache.set(mapId, record);
    fetch(`config/maps/${encodeURIComponent(mapId)}.json`, { cache: 'no-store' })
      .then(response => response.ok ? response.json() : null)
      .then(map => {
        record.settings = normalizeOverlayLighting(map?.interiorLighting);
        record.status = 'ready';
      })
      .catch(() => { record.status = 'failed'; record.settings = null; });
  }

  function overlayDaylightFactor() {
    const shared = Number(window.InteriorEnvironmentRuntime?.daylightFactor?.());
    if (Number.isFinite(shared)) return clamp(shared, 0, 1, 1);
    const state = window.HobunjiSkyDome?.getLightingState?.() || window.WeatherFX?.getLightingState?.();
    if (Number.isFinite(state?.a)) return clamp((0.80 - Number(state.a)) / 0.76, 0, 1, 1);
    return 1;
  }

  function enclosedIlluminationForArea(area) {
    requestOverlayLighting(area);
    const record = enclosedLightingCache.get(mapIdForArea(area));
    if (record?.settings) {
      return Math.max(0,
        record.settings.baseLightLevel
        + record.settings.daylightInfluence * overlayDaylightFactor());
    }
    return isUndergroundArea(area) ? UNDERGROUND_ILLUMINATION : 1;
  }

  function enclosedDarknessAlphaForIllumination(illumination) {
    const level = Math.max(0, Number(illumination) || 0);
    return clamp(ENCLOSED_MAX_DARKNESS_ALPHA * Math.exp(-ENCLOSED_FALLOFF * level), 0, ENCLOSED_MAX_DARKNESS_ALPHA, ENCLOSED_REFERENCE_ALPHA);
  }

  function lightScreenRadius(x, z, y, tiles) {
    if (!weatherDeps?.camera || !weatherDeps?.worldToOverlay) return 0;
    lightCamRight.setFromMatrixColumn(weatherDeps.camera.matrixWorld, 0);
    const center = weatherDeps.worldToOverlay(x, y, z);
    const edge = weatherDeps.worldToOverlay(
      x + lightCamRight.x * tiles,
      y + lightCamRight.y * tiles,
      z + lightCamRight.z * tiles,
    );
    return Math.hypot(edge.x - center.x, edge.y - center.y);
  }

  function drawEnclosedLanternMasks() {
    const ctx = weatherDeps?.lctx;
    if (!ctx) return 0;
    const carriers = [{
      x: weatherDeps.player.x / weatherDeps.TILE,
      y: weatherDeps.getPlayerWorldY() + 0.5,
      z: weatherDeps.player.y / weatherDeps.TILE,
    }];
    const currentArea = weatherDeps.getCurrentArea();
    for (const walker of (weatherDeps.npcWalkers || [])) {
      if (walker.area === currentArea && walker.rec?.tags?.includes('watch')) {
        carriers.push({ x: walker.root.position.x, y: walker.root.position.y + 0.5, z: walker.root.position.z });
      }
    }

    let drawn = 0;
    ctx.globalCompositeOperation = 'destination-out';
    for (const carrier of carriers) {
      const center = weatherDeps.worldToOverlay(carrier.x, carrier.y, carrier.z);
      if (!center.visible) continue;
      const shineR = lightScreenRadius(carrier.x, carrier.z, carrier.y, LANTERN_TUNING.radiusTiles);
      if (!(shineR > 0)) continue;
      const clarityFrac = clamp(LANTERN_TUNING.clarityRadiusTiles / LANTERN_TUNING.radiusTiles, 0, 1, 0);
      const grad = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, shineR);
      grad.addColorStop(0, `rgba(0,0,0,${LANTERN_TUNING.centerMaskAlpha})`);
      grad.addColorStop(clarityFrac, `rgba(0,0,0,${LANTERN_TUNING.clarityMaskAlpha})`);
      grad.addColorStop(
        Math.min(1, clarityFrac + LANTERN_TUNING.softTransitionFraction),
        `rgba(0,0,0,${LANTERN_TUNING.softMaskAlpha})`,
      );
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(center.x, center.y, shineR, 0, Math.PI * 2);
      ctx.fill();
      drawn += 1;
    }
    ctx.globalCompositeOperation = 'source-over';
    return drawn;
  }

  function drawEnclosedLocalLightMasks() {
    const ctx = weatherDeps?.lctx;
    if (!ctx) return 0;
    const visible = [];
    for (const light of (weatherDeps.getFurnitureLightSources?.() || [])) {
      const distance = Number(light?.distance) || 0;
      const intensity = Number(light?.intensity) || 0;
      if (!(distance > 0) || !(intensity > 0)) continue;
      const center = weatherDeps.worldToOverlay(light.x, light.y, light.z);
      if (!center.visible) continue;
      const shineR = lightScreenRadius(light.x, light.z, light.y, distance);
      if (!(shineR > 0)) continue;
      visible.push({ light, center, shineR, distance, intensity });
    }

    // Local lights clear the darkness exactly like the carried lantern. This
    // is what makes unlit NPC/player/creature planes visually respond to the
    // same candles, fires and lamps as the room around them.
    ctx.globalCompositeOperation = 'destination-out';
    for (const { center, shineR, distance, intensity } of visible) {
      const clarityFrac = Math.min(0.55, Math.max(0.18, 1.15 / distance));
      const strength = Math.min(0.94, 0.58 + intensity * 0.22);
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

    // Preserve the existing restrained warm halo after the darkness is cut.
    ctx.globalCompositeOperation = 'source-over';
    for (const { light, center, shineR, intensity } of visible) {
      const glowR = shineR * 0.62;
      const glowAlpha = Math.min(0.18, 0.055 + intensity * 0.055);
      const r = Number(light.color?.r) || 0;
      const g = Number(light.color?.g) || 0;
      const b = Number(light.color?.b) || 0;
      const glow = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, glowR);
      glow.addColorStop(0, `rgba(${r},${g},${b},${glowAlpha})`);
      glow.addColorStop(0.4, `rgba(${r},${g},${b},${glowAlpha * 0.45})`);
      glow.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(center.x, center.y, glowR, 0, Math.PI * 2);
      ctx.fill();
    }
    return visible.length;
  }

  function drawEnclosedLightingOverlay() {
    if (!weatherDeps?.lctx) return undefined;
    const now = performance.now();
    const sceneTransAlpha = Number(weatherDeps.getSceneTransAlpha?.()) || 0;
    if (now - lastEnclosedDraw < 100 && sceneTransAlpha <= 0) return undefined;
    lastEnclosedDraw = now;

    const area = weatherDeps.getCurrentArea?.() ?? window.GridTileAccessors?.getCurrentArea?.();
    const illumination = enclosedIlluminationForArea(area);
    const darknessAlpha = enclosedDarknessAlphaForIllumination(illumination);
    const ctx = weatherDeps.lctx;
    const rect = weatherDeps.getThreeRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = `rgba(0,0,0,${darknessAlpha})`;
    ctx.fillRect(0, 0, rect.width, rect.height);

    const lanterns = drawEnclosedLanternMasks();
    const localLights = drawEnclosedLocalLightMasks();
    if (sceneTransAlpha > 0) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = `rgba(0,0,0,${sceneTransAlpha})`;
      ctx.fillRect(0, 0, rect.width, rect.height);
    }
    ctx.globalCompositeOperation = 'source-over';

    lastOverlayArea = area;
    lastOverlayAlpha = darknessAlpha;
    lastOverlayIllumination = illumination;
    lastOverlayLocalLights = lanterns + localLights;
    return undefined;
  }

  function drawLightingOverlayWithEnclosedDarkness(...args) {
    const area = weatherDeps?.getCurrentArea?.() ?? window.GridTileAccessors?.getCurrentArea?.();
    if (!weatherDeps || !isEnclosedArea(area)) return weatherDrawUpstream?.apply(this, args);
    return drawEnclosedLightingOverlay();
  }

  function installWeatherObjectBridge(weather) {
    if (!weather || weather.__hobunjiEnclosedOverlayBridge) return !!weather?.__hobunjiEnclosedOverlayBridge;

    const priorInit = weather.init;
    if (typeof priorInit === 'function') {
      weather.init = function initWithEnclosedOverlayCapture(injectedDeps) {
        weatherDeps = injectedDeps;
        return priorInit.call(this, injectedDeps);
      };
    }

    weatherDrawUpstream = typeof weather.drawLightingOverlay === 'function' ? weather.drawLightingOverlay : null;
    Object.defineProperty(weather, 'drawLightingOverlay', {
      configurable: true,
      enumerable: true,
      get() { return drawLightingOverlayWithEnclosedDarkness; },
      set(next) {
        if (typeof next === 'function' && next !== drawLightingOverlayWithEnclosedDarkness) weatherDrawUpstream = next;
      },
    });
    Object.defineProperty(weather, '__hobunjiEnclosedOverlayBridge', { value: true, configurable: true });
    weatherBridgeInstalled = true;
    return true;
  }

  function installWeatherAssignmentBridge() {
    if (window.WeatherFX) return installWeatherObjectBridge(window.WeatherFX);
    const existingDescriptor = Object.getOwnPropertyDescriptor(window, 'WeatherFX');
    if (existingDescriptor && existingDescriptor.configurable === false) return false;
    let pendingValue;
    Object.defineProperty(window, 'WeatherFX', {
      configurable: true,
      enumerable: true,
      get() { return pendingValue; },
      set(value) {
        pendingValue = value;
        // Restore an ordinary data property immediately; only the first module
        // assignment is intercepted. The object-level draw accessor above is
        // what survives cloud-forest-fog's later drawLightingOverlay override.
        Object.defineProperty(window, 'WeatherFX', {
          configurable: true,
          enumerable: true,
          writable: true,
          value,
        });
        installWeatherObjectBridge(value);
      },
    });
    weatherAssignmentBridgeInstalled = true;
    return true;
  }

  installImmediateFireCatalog();
  installDecorativeDefinitionBridge();
  installFurnitureKeyBridge();
  wrapGridTileAccessorsInit();
  installWeatherAssignmentBridge();
  setTimeout(() => { // One bounded retry covers alternate script load order on dev/editor pages.
    installImmediateFireCatalog();
    installFurnitureKeyBridge();
    wrapGridTileAccessorsInit();
    if (!weatherBridgeInstalled) installWeatherAssignmentBridge();
  }, 0);

  function debugSnapshot() {
    return {
      installed: true,
      definitionBridgeInstalled,
      catalogFallbackInstalled,
      campfireParts: Array.isArray(furniture.CATALOG?.campfire) ? furniture.CATALOG.campfire.length : 0,
      bonfireParts: Array.isArray(furniture.CATALOG?.bonfire) ? furniture.CATALOG.bonfire.length : 0,
      lastFireKey,
      buildingSceneMapHooked: !!buildingSceneMap?.__hobunjiInteriorBlackVoidSetHook,
      lastVoidMapId,
      enclosedOverlay: {
        weatherAssignmentBridgeInstalled,
        weatherBridgeInstalled,
        depsCaptured: !!weatherDeps,
        cachedMaps: [...enclosedLightingCache.entries()].map(([mapId, record]) => ({ mapId, status: record.status, settings: record.settings })),
        lastArea: lastOverlayArea,
        lastIllumination: lastOverlayIllumination,
        lastDarknessAlpha: lastOverlayAlpha,
        lastLocalLights: lastOverlayLocalLights,
      },
    };
  }

  window.InteriorFireVoidRuntime = Object.freeze({
    installed: true,
    canonicalFireKey,
    blackVoidForScene,
    isUndergroundArea,
    isEnclosedArea,
    enclosedDarknessAlphaForIllumination,
    enclosedIlluminationForArea,
    debugSnapshot,
  });
  window.__interiorFireVoidDebug = debugSnapshot;
})();