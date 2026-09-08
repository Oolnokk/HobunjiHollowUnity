// Shared interior furniture/fire/floor extensions.
// Loaded immediately after FurnitureVesselRuntime so the normal game and the
// Building Interior Editor use one data path for campfires, bonfires, candle
// flames, and authored per-map floor surfaces.
(() => {
  'use strict';

  if (window.InteriorFireFloorRuntime?.installed) return;

  const THREE = window.THREE; // Used by ambient particle playback and floor material overrides.
  const furniture = window.ProceduralFurniture; // Used to expose campfire/bonfire on the normal furniture visual path.
  const authored = window.AuthoredFurniture; // Used to derive bonfire data and attach authored particle emitters.
  if (!THREE || !furniture?.buildFurnitureGroup || !authored?.load || !authored?.buildGroup) {
    window.InteriorFireFloorRuntime = { installed: false, reason: 'missing THREE/ProceduralFurniture/AuthoredFurniture' };
    return;
  }

  const AMBIENT_FIRE_KEYS = new Set(['campfire', 'bonfire', 'candleTable']); // Used to limit always-on VFX to intentional flame-bearing furniture.
  const AMBIENT_UNATTACHED_TTL_MS = 5000; // Used to discard preview groups that were built but never added to a scene.
  const FIRE_FURNITURE_DEFS = Object.freeze({ // Used to register real placeable decorative furniture definitions before game init.
    campfireFurniture: Object.freeze({
      name: 'Campfire', icon: '🔥', fw: 1, fd: 1, procKey: 'campfire', color: 0x6d3e20,
      desc: 'A compact stone-ring campfire using the authored campfire furniture preset.',
    }),
    bonfireFurniture: Object.freeze({
      name: 'Bonfire', icon: '🔥', fw: 2, fd: 2, procKey: 'bonfire', color: 0x6d3e20,
      desc: 'A two-by-two bonfire derived exactly from the campfire preset at double scale.',
    }),
  });
  const floorConfigCache = new Map(); // mapId -> Promise<floorStyle|null>, used by loaded building scenes.
  const ambientRecords = new Set(); // Holds live always-on emitter controllers so one RAF can update all of them.
  const ambientRecordByGroup = new WeakMap(); // Prevents duplicate emitter controllers when an authored fallback upgrades in place.
  const decoratedData = new WeakSet(); // Prevents duplicate candle emitters when load()/peek() return the same authored object repeatedly.
  const originalAuthoredLoad = authored.load.bind(authored); // Used underneath the bonfire alias and candle emitter augmentation.
  const originalAuthoredPeek = authored.peek?.bind(authored); // Used underneath the synchronous bonfire/candle lookup wrapper.
  const originalFurnitureBuilder = furniture.buildFurnitureGroup; // Used underneath the always-on ambient VFX wrapper.
  let bonfirePromise = null; // Caches the one campfire->bonfire derivation request shared by all bonfire instances.
  let bonfireData = null; // Stores the resolved derived bonfire object for synchronous peek() calls.
  let ambientRafId = 0; // Stores the shared requestAnimationFrame handle while ambient emitters exist.
  let ambientLastNow = 0; // Stores the previous RAF timestamp for frame-rate-independent particle updates.
  let buildingSceneMap = null; // Stores the live game building-scene Map once GridTileAccessors exposes it.
  let lastFloorMapId = null; // Included in the mobile-friendly debug snapshot after a floor style is applied.
  let lastFloorMaterialCount = 0; // Included in debug output so a map can prove its floor meshes were found.
  let lastFloorError = null; // Captures the most recent per-map floor config/texture failure without requiring devtools.
  let lastAmbientKey = null; // Captures the most recently attached ambient-fire furniture key for diagnostics.
  let registeredDefinitions = false; // Reports whether the real campfire/bonfire decorative definitions reached game deps.

  // Empty procedural recipes are intentional: they make the two new keys legal
  // on every existing furniture call site while FurnitureVesselRuntime supplies
  // the authored visual immediately (or upgrades it when the JSON cache resolves).
  if (!Object.prototype.hasOwnProperty.call(furniture.CATALOG || {}, 'campfire')) furniture.CATALOG.campfire = [];
  if (!Object.prototype.hasOwnProperty.call(furniture.CATALOG || {}, 'bonfire')) furniture.CATALOG.bonfire = [];

  function deepCloneJson(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value)); // Used only for JSON-shaped authored furniture data.
  }

  function scaleFiniteField(target, field, scale) {
    if (Number.isFinite(Number(target?.[field]))) target[field] = Number(target[field]) * scale; // Used by makeBonfireData for spatial fields only.
  }

  function makeBonfireData(campfireData) {
    if (!campfireData) return null;
    const scale = 2; // Used to make the bonfire a true doubled campfire, including its particle trajectories.
    const data = deepCloneJson(campfireData); // Used as the independent authored record returned for the bonfire key.
    data.key = 'bonfire';
    data.derivedFrom = 'campfire';
    data.sourceScale = scale;
    data.footprint = { w: 2, d: 2 };
    for (const part of (data.parts || [])) {
      const transform = part.transform || {}; // Used to double every authored part around the unchanged furniture origin.
      for (const field of ['x', 'y', 'z', 'sx', 'sy', 'sz']) scaleFiniteField(transform, field, scale);
    }
    for (const emitter of (data.particleEmitters || [])) {
      const position = emitter.position || {}; // Used to keep flame/smoke origins proportional to the doubled geometry.
      for (const field of ['x', 'y', 'z']) scaleFiniteField(position, field, scale);
      for (const field of ['radius', 'size', 'speed', 'spread', 'gravity']) scaleFiniteField(emitter, field, scale);
      if (emitter.id) emitter.id = String(emitter.id).replace(/^campfire_/, 'bonfire_');
      if (emitter.name) emitter.name = String(emitter.name).replace(/Campfire/g, 'Bonfire');
    }
    return data;
  }

  function ensureCandleFlame(data) {
    if (!data || decoratedData.has(data)) return data;
    const parts = Array.isArray(data.parts) ? data.parts : []; // Used to find the authored candle body without relying only on one generated part id.
    const candlePart = parts.find(part => part?.id === 'part_msc118d7_7u8jl')
      || parts.find(part => /candle/i.test(String(part?.name || '')) && part?.kind === 'cylinder'); // Used as the parent so the flame follows any table transform.
    if (candlePart) {
      if (!Array.isArray(data.particleEmitters)) data.particleEmitters = [];
      const alreadyHasFlame = data.particleEmitters.some(emitter => emitter?.id === 'candle_table_fire'); // Used to keep the augmentation idempotent.
      if (!alreadyHasFlame) {
        data.particleEmitters.push({
          id: 'candle_table_fire', name: 'Candle Flame', type: 'fire', enabled: true,
          attachedPartId: candlePart.id,
          position: { x: 0, y: 0.14, z: 0 }, rotation: { x: 0, y: 0, z: 0 },
          radius: 0.018, size: 0.055, rate: 16, lifetime: 0.45,
          speed: 0.22, spread: 0.055, gravity: -0.02,
          colorA: '#ffd45a', colorB: '#ff3d12',
        });
      }
    }
    decoratedData.add(data);
    return data;
  }

  function decorateAuthoredData(key, data) {
    if (!data) return null;
    if (key === 'candleTable') return ensureCandleFlame(data);
    return data;
  }

  authored.load = function loadInteriorFireFurniture(key) {
    const normalizedKey = String(key || '').trim(); // Used as the canonical lookup key for aliases and decorators.
    if (normalizedKey === 'bonfire') {
      if (!bonfirePromise) {
        bonfirePromise = Promise.resolve(originalAuthoredLoad('campfire')).then(source => {
          bonfireData = makeBonfireData(source); // Used by the synchronous bonfire peek path after the first load.
          return bonfireData;
        });
      }
      return bonfirePromise;
    }
    return Promise.resolve(originalAuthoredLoad(normalizedKey)).then(data => decorateAuthoredData(normalizedKey, data));
  };

  authored.peek = function peekInteriorFireFurniture(key) {
    const normalizedKey = String(key || '').trim(); // Used as the canonical synchronous lookup key.
    if (normalizedKey === 'bonfire') {
      if (bonfireData) return bonfireData;
      const source = originalAuthoredPeek?.('campfire'); // Used to derive a synchronous bonfire when campfire was already cached before this module loaded.
      if (source) bonfireData = makeBonfireData(source);
      return bonfireData;
    }
    return decorateAuthoredData(normalizedKey, originalAuthoredPeek?.(normalizedKey) || null);
  };

  function disposeAmbientRecord(record) {
    if (!record) return;
    for (const visual of record.visuals || []) visual?.dispose?.();
    ambientRecords.delete(record);
    ambientRecordByGroup.delete(record.group);
  }

  function ambientTick(now) {
    ambientRafId = 0;
    const dt = Math.min(0.05, Math.max(0, ambientLastNow ? (now - ambientLastNow) / 1000 : 1 / 60)); // Used to keep particle motion stable after tab stalls.
    ambientLastNow = now;
    for (const record of [...ambientRecords]) {
      const attached = !!record.group?.parent; // Used to begin playback only after the caller actually places the furniture in a scene.
      if (attached) record.wasAttached = true;
      if (!attached) {
        if (record.wasAttached || now - record.createdAt > AMBIENT_UNATTACHED_TTL_MS) disposeAmbientRecord(record);
        continue;
      }
      for (const visual of record.visuals) visual?.update?.(dt, true);
    }
    if (ambientRecords.size) ambientRafId = requestAnimationFrame(ambientTick);
    else ambientLastNow = 0;
  }

  function ensureAmbientLoop() {
    if (!ambientRafId && ambientRecords.size) ambientRafId = requestAnimationFrame(ambientTick);
  }

  function attachAmbientEmitters(group, data, key) {
    if (!group || !AMBIENT_FIRE_KEYS.has(key) || !Array.isArray(data?.particleEmitters) || !authored.createEmitterVisual) return group;
    if (ambientRecordByGroup.has(group)) return group;
    const emitters = data.particleEmitters.filter(emitter => emitter?.enabled !== false); // Used to create only authored emitters that are meant to run continuously.
    if (!emitters.length) return group;
    const visuals = emitters.map(emitter => authored.createEmitterVisual(group, emitter)).filter(Boolean); // Used by the shared ambient RAF below.
    if (!visuals.length) return group;
    const record = { group, visuals, key, createdAt: performance.now(), wasAttached: false }; // Stored until the furniture is removed from its scene.
    ambientRecords.add(record);
    ambientRecordByGroup.set(group, record);
    group.userData = group.userData || {};
    group.userData.hobunjiAmbientFurnitureVfx = true;
    group.userData.hobunjiAmbientFurnitureVfxKey = key;
    lastAmbientKey = key;
    ensureAmbientLoop();
    return group;
  }

  function buildFurnitureWithAmbientVfx(key, baseColor) {
    const normalizedKey = String(key || '').trim(); // Used to decide whether this furniture needs always-on authored VFX.
    const group = originalFurnitureBuilder.call(this, normalizedKey, baseColor); // Used to preserve FurnitureVesselRuntime's normal authored/fallback upgrade path.
    if (!AMBIENT_FIRE_KEYS.has(normalizedKey) || !group) return group;
    const readyData = authored.peek?.(normalizedKey); // Used to attach immediately when the authored data was already cached.
    if (readyData) attachAmbientEmitters(group, readyData, normalizedKey);
    else Promise.resolve(authored.load(normalizedKey)).then(data => {
      if (data) attachAmbientEmitters(group, data, normalizedKey); // The inner runtime registered its fallback-upgrade callback first, so meshById is ready before this callback runs.
    }).catch(() => {});
    return group;
  }

  if (!originalFurnitureBuilder.__hobunjiAmbientFireWrapped) {
    Object.assign(buildFurnitureWithAmbientVfx, originalFurnitureBuilder);
    buildFurnitureWithAmbientVfx.__hobunjiAmbientFireWrapped = true;
    buildFurnitureWithAmbientVfx.__hobunjiAmbientFireOriginal = originalFurnitureBuilder;
    furniture.buildFurnitureGroup = buildFurnitureWithAmbientVfx;
  }

  function registerFireFurnitureDefinitions(injectedDeps) {
    const defs = injectedDeps?.DECORATIVE_FURNITURE_DEFS; // Used by interior map loading/placement to resolve itemKey footprint and procKey.
    if (!defs) return false;
    for (const [itemKey, definition] of Object.entries(FIRE_FURNITURE_DEFS)) {
      if (!defs[itemKey]) defs[itemKey] = { ...definition };
    }
    const itemDefs = injectedDeps?.ITEM_DEFS; // Used to make the new furniture keys readable/placeable anywhere a furniture inventory item is granted.
    if (itemDefs) {
      for (const [itemKey, definition] of Object.entries(FIRE_FURNITURE_DEFS)) {
        if (itemDefs[itemKey]) continue;
        itemDefs[itemKey] = {
          icon: definition.icon,
          label: definition.name,
          cat: 'furniture',
          sellPrice: 0,
          tags: ['Furniture'],
          desc: definition.desc,
        };
      }
    }
    registeredDefinitions = true;
    return true;
  }

  function wrapInitForDefinitions(namespaceName) {
    const namespace = window[namespaceName]; // Used to intercept the normal game dependency injection without reaching into game.js closures.
    if (!namespace?.init || namespace.__hobunjiFireFurnitureDefinitionHook) return false;
    const originalInit = namespace.init; // Used beneath the additive definition registration wrapper.
    namespace.init = function initWithFireFurnitureDefinitions(injectedDeps) {
      registerFireFurnitureDefinitions(injectedDeps);
      return originalInit.call(this, injectedDeps);
    };
    namespace.__hobunjiFireFurnitureDefinitionHook = true;
    return true;
  }

  function normalizeTextureFilename(value) {
    const leaf = String(value || '').trim().replace(/\\/g, '/').split('/').pop(); // Used to keep map-authored floor textures inside assets/textures.
    return leaf && /^[A-Za-z0-9_.-]+\.png$/i.test(leaf) ? leaf : '';
  }

  function normalizeFloorStyle(style) {
    if (!style || typeof style !== 'object') return null;
    const texture = normalizeTextureFilename(style.texture || style.textureFile || style.png); // Used as the safe repo texture filename.
    const tint = /^#[0-9a-f]{6}$/i.test(String(style.tint || '')) ? String(style.tint) : '#ffffff'; // Used as the material color multiplied over the PNG.
    const tilesPerTile = Math.max(0.05, Math.min(64, Number(style.tilesPerTile ?? style.repeat ?? 1) || 1)); // Used as the UV repeat on every 1x1 floor tile.
    return { texture, tint, tilesPerTile };
  }

  function defaultFloorStyleForWallStyle(wallStyle) {
    if (wallStyle === 'cavern') return { texture: '', tint: '#4a463f', tilesPerTile: 1 };
    if (wallStyle === 'mine') return { texture: 'carved_smooth.png', tint: '#8a8d91', tilesPerTile: 0.42 };
    if (wallStyle === 'canvas') return { texture: '', tint: '#8a7a5c', tilesPerTile: 1 };
    return { texture: 'boards.png', tint: '#ffffff', tilesPerTile: 1 };
  }

  function textureBase(basePath) {
    const base = String(basePath || 'assets/'); // Used to resolve both game-root and nested-editor texture paths.
    return base.endsWith('/') ? base : base + '/';
  }

  function applyFloorStyleToMaterial(material, style, basePath) {
    if (!material) return material;
    const normalized = normalizeFloorStyle(style); // Used to compare/apply one stable surface signature.
    if (!normalized) return material;
    material.userData = material.userData || {};
    material.userData.hobunjiInteriorFloorMaterial = true;
    const signature = JSON.stringify(normalized); // Used to avoid restarting the same asynchronous texture request every render frame.
    if (material.userData.hobunjiFloorStyleSignature === signature) return material;
    material.userData.hobunjiFloorStyleSignature = signature;
    material.userData.hobunjiFloorStyleRequest = (material.userData.hobunjiFloorStyleRequest || 0) + 1;
    const requestId = material.userData.hobunjiFloorStyleRequest; // Used to reject a stale texture callback after the user changes the floor again.
    material.color?.set?.(normalized.tint);
    if (!normalized.texture) {
      material.map = null;
      material.needsUpdate = true;
      return material;
    }
    const url = textureBase(basePath) + 'textures/' + normalized.texture; // Used as the final safe PNG request path.
    new THREE.TextureLoader().load(url, texture => {
      if (material.userData?.hobunjiFloorStyleRequest !== requestId) {
        texture.dispose?.();
        return;
      }
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(normalized.tilesPerTile, normalized.tilesPerTile);
      if ('colorSpace' in texture && THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
      material.map = texture;
      material.color?.set?.(normalized.tint);
      material.needsUpdate = true;
      material.userData.hobunjiFloorTextureUrl = url;
    }, undefined, error => {
      lastFloorError = `${url}: ${String(error?.message || error || 'texture load failed')}`;
    });
    return material;
  }

  function installFloorMaterialBuilderHook() {
    const builder = window.InteriorSceneBuilder; // Used to tag every future interior floor material for per-map restyling.
    const existingBuilder = builder?.buildFloorMaterial; // Used beneath the additive floorStyle-aware wrapper.
    if (!existingBuilder || existingBuilder.__hobunjiFloorStyleWrapped) return !!existingBuilder;
    function buildFloorMaterialWithStyle(threeArg, wallStyle, basePath, floorStyle) {
      const material = existingBuilder.call(builder, threeArg, wallStyle, basePath); // Preserves all legacy brick/cavern/mine/canvas defaults.
      material.userData = material.userData || {};
      material.userData.hobunjiInteriorFloorMaterial = true;
      material.userData.hobunjiInteriorWallStyle = wallStyle || '';
      const override = floorStyle || window.__hobunjiInteriorFloorStyleOverride; // Used by the Interior Editor before a map is committed to disk.
      if (override) applyFloorStyleToMaterial(material, override, basePath);
      return material;
    }
    Object.assign(buildFloorMaterialWithStyle, existingBuilder);
    buildFloorMaterialWithStyle.__hobunjiFloorStyleWrapped = true;
    buildFloorMaterialWithStyle.__hobunjiFloorStyleOriginal = existingBuilder;
    builder.buildFloorMaterial = buildFloorMaterialWithStyle;
    return true;
  }

  function loadFloorStyleForMap(mapId) {
    const key = String(mapId || '').trim(); // Used as the canonical map filename/cache key.
    if (!/^map_i_[A-Za-z0-9_-]+$/.test(key)) return Promise.resolve(null);
    if (floorConfigCache.has(key)) return floorConfigCache.get(key);
    const promise = fetch(`config/maps/${encodeURIComponent(key)}.json`, { cache: 'no-store' }) // Used only after a building scene is created, so it cannot delay scene loading.
      .then(response => response.ok ? response.json() : null)
      .then(map => normalizeFloorStyle(map?.floorStyle))
      .catch(error => {
        lastFloorError = `${key}: ${String(error?.message || error || 'floor config fetch failed')}`;
        return null;
      });
    floorConfigCache.set(key, promise);
    return promise;
  }

  function applyFloorStyleToScene(mapId, sceneRecord) {
    if (!sceneRecord?.scene?.traverse) return Promise.resolve(0);
    return loadFloorStyleForMap(mapId).then(style => {
      if (!style) return 0;
      const materials = new Set(); // Used to apply the texture once even though every floor tile shares the same material.
      sceneRecord.scene.traverse(object => {
        for (const material of (Array.isArray(object?.material) ? object.material : [object?.material]).filter(Boolean)) {
          if (material.userData?.hobunjiInteriorFloorMaterial) materials.add(material);
        }
      });
      for (const material of materials) applyFloorStyleToMaterial(material, style, 'assets/');
      lastFloorMapId = mapId;
      lastFloorMaterialCount = materials.size;
      window.__farmLog?.(`[interior-floor] ${mapId} texture=${style.texture || 'flat'} tint=${style.tint} repeat=${style.tilesPerTile} materials=${materials.size}`);
      return materials.size;
    });
  }

  function hookBuildingSceneMap(map) {
    if (!map?.set || map.__hobunjiFloorStyleSetHook) return false;
    buildingSceneMap = map;
    const originalSet = map.set.bind(map); // Used beneath the per-map floorStyle notification wrapper.
    map.set = function setBuildingSceneWithFloorStyle(mapId, sceneRecord) {
      const result = originalSet(mapId, sceneRecord); // Preserves native Map.set chaining and storage semantics.
      queueMicrotask(() => { applyFloorStyleToScene(mapId, sceneRecord); });
      return result;
    };
    Object.defineProperty(map, '__hobunjiFloorStyleSetHook', { value: true, configurable: true });
    for (const [mapId, sceneRecord] of map.entries()) queueMicrotask(() => { applyFloorStyleToScene(mapId, sceneRecord); });
    return true;
  }

  function wrapGridTileAccessorsInit() {
    const namespace = window.GridTileAccessors; // Used because its existing dependency object exposes the real private _buildingScenes Map by reference.
    if (!namespace?.init || namespace.__hobunjiFloorStyleInitHook) return false;
    const originalInit = namespace.init; // Used beneath the building-scene Map hook.
    namespace.init = function initWithInteriorFloorStyles(injectedDeps) {
      hookBuildingSceneMap(injectedDeps?._buildingScenes);
      return originalInit.call(this, injectedDeps);
    };
    namespace.__hobunjiFloorStyleInitHook = true;
    return true;
  }

  installFloorMaterialBuilderHook();
  wrapInitForDefinitions('FarmPanel');
  wrapInitForDefinitions('FarmEditor');
  wrapGridTileAccessorsInit();

  // The game normally loads every namespace before this companion, but these
  // one-shot retries keep alternate dev pages/load orders from silently missing
  // the additive init hooks without installing a permanent polling loop.
  setTimeout(() => {
    wrapInitForDefinitions('FarmPanel');
    wrapInitForDefinitions('FarmEditor');
    wrapGridTileAccessorsInit();
    installFloorMaterialBuilderHook();
  }, 0);

  function debugSnapshot() {
    return {
      installed: true,
      registeredDefinitions,
      campfireCatalog: Object.prototype.hasOwnProperty.call(furniture.CATALOG || {}, 'campfire'),
      bonfireCatalog: Object.prototype.hasOwnProperty.call(furniture.CATALOG || {}, 'bonfire'),
      bonfireReady: !!bonfireData,
      ambientGroups: ambientRecords.size,
      ambientVisuals: [...ambientRecords].reduce((sum, record) => sum + record.visuals.length, 0),
      lastAmbientKey,
      floorBuilderWrapped: !!window.InteriorSceneBuilder?.buildFloorMaterial?.__hobunjiFloorStyleWrapped,
      buildingSceneMapHooked: !!buildingSceneMap?.__hobunjiFloorStyleSetHook,
      floorConfigCacheKeys: [...floorConfigCache.keys()],
      lastFloorMapId,
      lastFloorMaterialCount,
      lastFloorError,
    };
  }

  window.InteriorFireFloorRuntime = Object.freeze({
    installed: true,
    makeBonfireData,
    ensureCandleFlame,
    registerFireFurnitureDefinitions,
    normalizeFloorStyle,
    defaultFloorStyleForWallStyle,
    applyFloorStyleToMaterial,
    applyFloorStyleToScene,
    debugSnapshot,
  });
  window.__interiorFireFloorDebug = debugSnapshot;
})();
