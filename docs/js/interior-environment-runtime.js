// Authored per-interior wall height and lighting controls shared by gameplay
// and the Building Interior Editor. Loaded by interior-fire-floor-integration.js
// so it runs before game.js builds authored interiors while also enhancing the
// standalone editor without reaching into its closure-private state.
(() => {
  'use strict';

  if (window.InteriorEnvironmentRuntime?.installed) return;

  const THREE = window.THREE; // Used for editor light-constructor bridges and runtime light identification.
  if (!THREE) {
    window.InteriorEnvironmentRuntime = { installed: false, reason: 'missing THREE' };
    return;
  }

  const IS_INTERIOR_EDITOR = /\/tools\/building-interior-author\/(?:index\.html)?$/.test(location.pathname || '');
  const DEFAULT_WALL_HEIGHT = 1.75; // Existing authored-interior wall height; maps without wallHeight stay unchanged.
  const IKMC_LADDER_ITEM_KEY = 'ikmcBalconyLadderFurniture'; // Map furniture key resolved into authored ladder visuals.
  const IKMC_LADDER_VISUAL_KEY = 'ikmcBalconyLadder'; // Actual authored JSON/procedural recipe key used by the furniture builders.
  const EDITOR_SYNC_MS = 500; // Matches the existing external floor-control sync cadence.
  const LIGHTING_UPDATE_MS = 250; // Smooth enough for the slow game clock without doing light work every render frame.
  let isOrdinaryBuildingArea = () => false; // Captured from GridTileAccessors so runtime authored-lighting metadata follows the same ordinary-building policy as the farmhouse overlay route.
  const configCache = new Map(); // mapId -> Promise<normalized environment|null>, avoiding repeated config fetches.
  const lightingRecords = new Map(); // mapId -> captured light references/base values for time-varying daylight updates.
  const editorTrackedLights = new Set(); // Tracks preview lights created through the constructor bridge so sliders can update them live.
  let buildingSceneMap = null; // Real private _buildingScenes Map exposed through GridTileAccessors.init deps.
  let lightingTimer = 0; // Shared interval used only after a custom-lighting interior has loaded.
  let lastMapId = null; // Mobile-friendly diagnostic: most recently applied authored environment.
  let lastWallGroupCount = 0; // Diagnostic count proving the authored wall height reached built wall groups.
  let lastLightCount = 0; // Diagnostic count proving custom lighting found actual Three.js lights.
  let lastLightingMode = 'default'; // Debug snapshot/log state showing whether the latest map used authored Three.js lighting or overlay-only darkness.
  let lastError = null; // Most recent config/runtime error without requiring desktop devtools.
  let ceilingLadderRegistered = false; // Debug state of the interior ladder catalog registration.
  let ladderVisualBridgeInstalled = false; // Confirms that the item-key-to-visual-key bridge intercepts game furniture builds.
  let ladderFallbackRungs = 0; // Counts visible procedural rungs supplied while authored furniture JSON loads.
  let lastLadderBuildKey = null; // Mobile-readable proof that this placed ladder reached its authored key.
  let editorLastSignature = null; // Prevents repeated native reimports while polling Server Layout / Library loads.
  let editorReimports = 0; // Diagnostic count for the editor's native import bridge.

  const clamp = (value, min, max, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
  };

  function normalizeLighting(value) {
    if (!value || typeof value !== 'object') return null;
    return {
      baseLightLevel: clamp(value.baseLightLevel, 0, 4, 1),
      daylightInfluence: clamp(value.daylightInfluence, 0, 6, 1),
      lightRadiusMultiplier: clamp(value.lightRadiusMultiplier, 0.1, 8, 1),
    };
  }

  function normalizeEnvironment(value) {
    if (!value || typeof value !== 'object') return null;
    const hasWallHeight = Number.isFinite(Number(value.wallHeight));
    const lighting = normalizeLighting(value.interiorLighting);
    if (!hasWallHeight && !lighting) return null;
    return {
      wallHeight: hasWallHeight ? clamp(value.wallHeight, 0.5, 8, DEFAULT_WALL_HEIGHT) : null,
      interiorLighting: lighting,
    };
  }

  function authoringEnvironment(value) {
    const normalized = normalizeEnvironment(value) || {};
    return {
      wallHeight: normalized.wallHeight ?? DEFAULT_WALL_HEIGHT,
      interiorLighting: normalized.interiorLighting || {
        baseLightLevel: 1,
        daylightInfluence: 1,
        lightRadiusMultiplier: 1,
      },
    };
  }

  // Gameplay sometimes passes the interior's *itemKey* straight to the mesh
  // builder before consulting the decorative-item registry. The authored JSON
  // and procedural recipe use a different key, so the builder otherwise returns
  // an empty group and loadBuildingScene replaces it with a white cube.
  function installLadderVisualBridge() {
    const furniture = window.ProceduralFurniture; // Shared authored-aware furniture builder used by game interiors and the editor.
    const catalog = furniture?.CATALOG; // Immediate recipe source for the loading/failure fallback.
    const existing = furniture?.buildFurnitureGroup; // Preserve every already-installed authored/VFX decorator.
    if (!catalog || typeof existing !== 'function') return false;
    const recipe = catalog[IKMC_LADDER_VISUAL_KEY]; // Existing two stiles and ceiling hatch, not a new competing asset.
    if (Array.isArray(recipe)) {
      if (!recipe.some(part => part?.id === 'ikmc_fallback_floor')) {
        recipe.push({ id: 'ikmc_fallback_floor', kind: 'box', tint: .85,
          transform: { x: 0, y: .035, z: .08, sx: .8, sy: .07, sz: .22 } });
      }
      for (let i = 0; i < 9; i++) {
        const id = 'ikmc_fallback_rung_' + i; // Stable identity makes retries safe and keeps exactly nine visible steps.
        if (!recipe.some(part => part?.id === id)) {
          recipe.push({ id, kind: 'box', tint: .85,
            transform: { x: 0, y: .19 + i * .169, z: .08, sx: .74, sy: .08, sz: .1 } });
        }
      }
      ladderFallbackRungs = recipe.filter(part => /^ikmc_fallback_rung_\d+$/.test(part?.id || '')).length;
    }
    // Direct catalog consumers may bypass buildFurnitureGroup. Their alias
    // must also see the existing recipe rather than an unknown-key placeholder.
    if (!Object.prototype.hasOwnProperty.call(catalog, IKMC_LADDER_ITEM_KEY)) {
      Object.defineProperty(catalog, IKMC_LADDER_ITEM_KEY, {
        configurable: true, enumerable: false,
        get() { return catalog[IKMC_LADDER_VISUAL_KEY]; },
        set(value) { Object.defineProperty(this, IKMC_LADDER_ITEM_KEY,
          { configurable: true, enumerable: true, writable: true, value }); },
      });
    }
    if (!existing.__hobunjiCeilingLadderKeyAlias) {
      function buildFurnitureGroupWithCeilingLadderAlias(key, baseColor) {
        const visualKey = key === IKMC_LADDER_ITEM_KEY ? IKMC_LADDER_VISUAL_KEY : key; // Alias only this outpost furniture, leaving all other assets unchanged.
        if (visualKey === IKMC_LADDER_VISUAL_KEY) lastLadderBuildKey = visualKey; // Record canonical calls from the real map lookup as well as direct item-key aliases.
        return existing.call(this, visualKey, baseColor);
      }
      Object.assign(buildFurnitureGroupWithCeilingLadderAlias, existing);
      buildFurnitureGroupWithCeilingLadderAlias.__hobunjiCeilingLadderKeyAlias = true;
      furniture.buildFurnitureGroup = buildFurnitureGroupWithCeilingLadderAlias;
    }
    ladderVisualBridgeInstalled = true;
    return true;
  }

  // Install ceiling furniture in the same interior definitions used by ordinary
  // placeables. An unknown map item would otherwise render as a generic cube.
  function registerCeilingFurnitureDefinitions(deps) {
    const defs = deps?.DECORATIVE_FURNITURE_DEFS; // Runtime item metadata consulted during building-scene furniture creation.
    if (!defs) return false;
    const definition = {
      itemKey: IKMC_LADDER_ITEM_KEY, name: 'Roof Access Ladder', icon: '🪜',
      price: 0, area: 'interior', fixture: true, fw: 1, fd: 1,
      procKey: IKMC_LADDER_VISUAL_KEY, color: 0x906c4b,
      desc: 'Ceiling-fitting ladder with rigid rungs and a roof hatch.',
    }; // game.js indexes Object.entries(DECORATIVE_FURNITURE_DEFS) by def.itemKey when building interiors.
    // Register under the authored *visual key* (like mineLadder), never under
    // the item key: both the dictionary key and itemKey field are needed to
    // reach the correct recipe instead of game.js's default gray/white cube.
    if (!defs[IKMC_LADDER_VISUAL_KEY]) defs[IKMC_LADDER_VISUAL_KEY] = definition;
    else if (!defs[IKMC_LADDER_VISUAL_KEY].itemKey) defs[IKMC_LADDER_VISUAL_KEY].itemKey = IKMC_LADDER_ITEM_KEY;
    const items = deps.ITEM_DEFS; // Optional inventory metadata for any granted ladder item.
    if (items && !items[IKMC_LADDER_ITEM_KEY]) {
      items[IKMC_LADDER_ITEM_KEY] = {
        icon: definition.icon, label: definition.name, cat: 'furniture', sellPrice: 20,
        tags: ['Furniture'], desc: definition.desc,
      };
    }
    ceilingLadderRegistered = true;
    return true;
  }

  function wrapInitForCeilingFurniture(name) {
    const namespace = window[name]; // Existing FarmPanel/FarmEditor init hooks carry the actual shared furniture dictionaries.
    if (!namespace?.init || namespace.__hobunjiCeilingFurnitureDefinitionHook) return false;
    const originalInit = namespace.init; // Compose with previously installed decorators, do not replace them.
    namespace.init = function initWithCeilingFurniture(deps) {
      registerCeilingFurnitureDefinitions(deps);
      return originalInit.call(this, deps);
    };
    namespace.__hobunjiCeilingFurnitureDefinitionHook = true;
    return true;
  }

  // ── Shared wall bridge ─────────────────────────────────────────────
  // Runtime maps are already inside loadBuildingScene by the time we know
  // their id, so wall groups are tagged at construction and scaled after the
  // scene record is stored. The editor has the opposite advantage: its current
  // authored value is known before its native rebuild, so buildWallPanels can
  // consume that override directly and preview real-height geometry.
  function installWallBuilderBridge() {
    const builder = window.InteriorSceneBuilder;
    if (!builder?.buildWallPanels || !builder?.buildWallGroup) return false;

    const existingPanels = builder.buildWallPanels;
    if (!existingPanels.__hobunjiEnvironmentWallHeightWrapped) {
      function buildWallPanelsWithEnvironment(floorSet, exitTileSet, wallHeight) {
        const override = IS_INTERIOR_EDITOR ? Number(window.__hobunjiInteriorWallHeightOverride) : NaN;
        const effectiveHeight = Number.isFinite(override)
          ? clamp(override, 0.5, 8, DEFAULT_WALL_HEIGHT)
          : wallHeight;
        return existingPanels.call(builder, floorSet, exitTileSet, effectiveHeight);
      }
      Object.assign(buildWallPanelsWithEnvironment, existingPanels);
      buildWallPanelsWithEnvironment.__hobunjiEnvironmentWallHeightWrapped = true;
      buildWallPanelsWithEnvironment.__hobunjiEnvironmentWallHeightOriginal = existingPanels;
      builder.buildWallPanels = buildWallPanelsWithEnvironment;
    }

    const existingGroup = builder.buildWallGroup;
    if (!existingGroup.__hobunjiEnvironmentWallGroupWrapped) {
      function buildWallGroupWithEnvironment(...args) {
        const panels = Array.isArray(args[2]) ? args[2] : [];
        const group = existingGroup.apply(builder, args);
        if (group) {
          group.userData = group.userData || {};
          group.userData.hobunjiInteriorWallGroup = true;
          group.userData.hobunjiInteriorWallSourceHeight = panels.reduce((height, panel) => {
            const candidate = Number(panel?.height);
            return Number.isFinite(candidate) && candidate > height ? candidate : height;
          }, DEFAULT_WALL_HEIGHT);
          group.userData.hobunjiInteriorWallBaseScaleY = Number(group.scale?.y) || 1;
        }
        return group;
      }
      Object.assign(buildWallGroupWithEnvironment, existingGroup);
      buildWallGroupWithEnvironment.__hobunjiEnvironmentWallGroupWrapped = true;
      buildWallGroupWithEnvironment.__hobunjiEnvironmentWallGroupOriginal = existingGroup;
      builder.buildWallGroup = buildWallGroupWithEnvironment;
    }
    return true;
  }

  function applyWallHeightToObject(object, wallHeight) {
    if (!object?.userData?.hobunjiInteriorWallGroup || !object.scale) return false;
    const sourceHeight = clamp(object.userData.hobunjiInteriorWallSourceHeight, 0.5, 8, DEFAULT_WALL_HEIGHT);
    const baseScaleY = Number(object.userData.hobunjiInteriorWallBaseScaleY) || 1;
    object.scale.y = baseScaleY * wallHeight / sourceHeight;
    object.updateMatrixWorld?.(true);
    return true;
  }

  function applyWallHeight(scene, wallHeight) {
    if (!scene?.traverse || !Number.isFinite(wallHeight)) return 0;
    let count = 0;
    scene.traverse(object => { if (applyWallHeightToObject(object, wallHeight)) count += 1; });
    return count;
  }

  // ── Runtime lighting ───────────────────────────────────────────────
  function daylightFactor() {
    // SkyDome's full-day lighting state already includes dawn/dusk and weather.
    // Its overlay alpha is ~0.04 at bright noon and ~0.80 at full night, so
    // normalize that existing signal instead of inventing a second sun clock.
    const state = window.WeatherFX?.getLightingState?.();
    if (Number.isFinite(state?.a)) return clamp((0.80 - state.a) / 0.76, 0, 1, 1);
    const hour = Number(window.CalendarSystem?.getHour?.());
    if (!Number.isFinite(hour)) return 1;
    if (hour < 5.5 || hour >= 20.5) return 0;
    if (hour < 8) return clamp((hour - 5.5) / 2.5, 0, 1, 0);
    if (hour >= 17) return clamp((20.5 - hour) / 3.5, 0, 1, 0);
    return 1;
  }

  function captureLight(light) {
    light.userData = light.userData || {};
    if (!Number.isFinite(light.userData.hobunjiInteriorBaseIntensity)) {
      light.userData.hobunjiInteriorBaseIntensity = Number(light.intensity) || 0;
    }
    if ((light.isPointLight || light.isSpotLight) && !Number.isFinite(light.userData.hobunjiInteriorBaseDistance)) {
      light.userData.hobunjiInteriorBaseDistance = Number(light.distance) || 0;
    }
    return {
      light,
      baseIntensity: Number(light.userData.hobunjiInteriorBaseIntensity) || 0,
      baseDistance: Number(light.userData.hobunjiInteriorBaseDistance) || 0,
      role: light.isDirectionalLight ? 'daylight'
        : (light.isAmbientLight || light.isHemisphereLight) ? 'base'
        : (light.isPointLight || light.isSpotLight) ? 'local'
        : 'other',
    };
  }

  function collectSceneLights(scene) {
    const records = [];
    scene?.traverse?.(object => {
      if (object?.isLight) records.push(captureLight(object));
    });
    return records;
  }

  function applyLightingRecord(record) {
    if (!record?.settings) return 0;
    const daylight = daylightFactor();
    const settings = record.settings;
    for (const entry of record.lights) {
      const light = entry.light;
      if (!light) continue;
      if (entry.role === 'base') light.intensity = entry.baseIntensity * settings.baseLightLevel;
      else if (entry.role === 'daylight') light.intensity = entry.baseIntensity * settings.daylightInfluence * daylight;
      if (entry.role === 'local' && entry.baseDistance > 0) {
        light.distance = entry.baseDistance * settings.lightRadiusMultiplier;
      }
    }
    return record.lights.length;
  }

  function updateLightingRecords() {
    for (const [mapId, record] of [...lightingRecords]) {
      if (buildingSceneMap && buildingSceneMap.get(mapId) !== record.sceneRecord) {
        lightingRecords.delete(mapId);
        continue;
      }
      applyLightingRecord(record);
    }
    if (!lightingRecords.size && lightingTimer) {
      clearInterval(lightingTimer);
      lightingTimer = 0;
    }
  }

  function ensureLightingTimer() {
    if (!lightingTimer && lightingRecords.size) lightingTimer = setInterval(updateLightingRecords, LIGHTING_UPDATE_MS);
  }

  function applyLighting(sceneRecord, settings, mapId) {
    if (!sceneRecord?.scene || !settings) return 0;
    const record = { sceneRecord, settings, lights: collectSceneLights(sceneRecord.scene) };
    lightingRecords.set(mapId, record);
    const count = applyLightingRecord(record);
    ensureLightingTimer();
    return count;
  }

  function usesOverlayOnlyLighting(mapId, sceneRecord = null) {
    const id = String(mapId || '').trim();
    if (IS_INTERIOR_EDITOR || !isOrdinaryBuildingArea(id)) return false; // The editor keeps its lighting preview controls.
    if (sceneRecord?.wallStyle === 'cavern' || sceneRecord?.wallStyle === 'mine') return false; // Dens/mines keep their own dim cave lighting (_isBuildingArea is every map_i_* id).
    return !/^map_i_(?:den_|town_mine_)/i.test(id); // Every ordinary authored building uses the shared fake-light compositor at runtime.
  }

  function loadEnvironmentForMap(mapId) {
    const key = String(mapId || '').trim();
    if (!/^map_i_[A-Za-z0-9_-]+$/.test(key)) return Promise.resolve(null);
    if (configCache.has(key)) return configCache.get(key);
    const promise = fetch(`config/maps/${encodeURIComponent(key)}.json`, { cache: 'no-store' })
      .then(response => response.ok ? response.json() : null)
      .then(map => normalizeEnvironment(map))
      .catch(error => {
        lastError = `${key}: ${String(error?.message || error || 'environment config fetch failed')}`;
        return null;
      });
    configCache.set(key, promise);
    return promise;
  }


  function ceilingFurnitureInScene(scene) {
    const groups=[]; // Only roots with ceiling-span metadata are resized; no mesh-by-mesh work on regular furniture.
    scene?.traverse?.(node=>{
      if(node?.userData?.authoredFurnitureData?.tileSpan?.axis==='y' &&
        node.userData.authoredFurnitureData.tileSpan.verticalTarget==='ceiling')groups.push(node);
    });
    return groups;
  }

  function fitCeilingFurniture(group, explicitHeight = null) {
    const span=group?.userData?.authoredFurnitureData?.tileSpan;
    if(!span?.enabled||span.axis!=='y'||span.verticalTarget!=='ceiling')return Promise.resolve(false);
    if(!window.AuthoredFurniture?.setTileSpan)return Promise.resolve(false);
    const editorHeight=IS_INTERIOR_EDITOR && window.__hobunjiInteriorWallHeightOverride != null
      ? Number(window.__hobunjiInteriorWallHeightOverride) : NaN; // An unset override is NOT zero height; keep the authored rest span until an actual room height exists.
    if(Number.isFinite(explicitHeight)||Number.isFinite(editorHeight)){
      window.AuthoredFurniture.setTileSpan(group,Number.isFinite(explicitHeight)?explicitHeight:editorHeight);
      return Promise.resolve(true);
    }
    let ownerMapId=null; // Resolve only this furniture's owning interior, never a globally "last opened" room.
    for(const [mapId,record] of buildingSceneMap||[]){
      let parent=group; // Walk the changed furniture root upward; scene groups are usually just two ancestors away.
      while(parent){
        if(parent===record?.scene){ownerMapId=mapId;break;}
        parent=parent.parent;
      }
      if(ownerMapId)break;
    }
    if(!ownerMapId)return Promise.resolve(false);
    return loadEnvironmentForMap(ownerMapId).then(env=>{
      if(!group?.parent)return false; // Ignore late finishes for furniture removed while loading.
      window.AuthoredFurniture?.setTileSpan?.(group,env?.wallHeight??DEFAULT_WALL_HEIGHT);
      return true;
    }).catch(error=>{lastError=String(error?.message||error);return false;});
  }

  function applyEnvironmentToScene(mapId, sceneRecord) {
    if (!sceneRecord?.scene) return Promise.resolve(null);
    return loadEnvironmentForMap(mapId).then(environment => {
      if (!environment) return null;
      const needsWallHeight = environment.wallHeight != null;
      const overlayOnlyLighting = usesOverlayOnlyLighting(mapId, sceneRecord); // Used below to leave baseline Three.js lighting untouched on maps whose darkness comes from the shared overlay.
      const needsLighting = !!environment.interiorLighting && !overlayOnlyLighting;
      let wallGroups = 0;
      let lights = 0;
      if (overlayOnlyLighting) lightingRecords.delete(mapId);
      if (needsWallHeight && needsLighting) {
        // One shared scan instead of two — wall-group rescaling and light
        // collection are independent checks per node, so a single interior
        // load pays for one scene.traverse instead of applyWallHeight's and
        // collectSceneLights's separate walks of the same freshly-built scene.
        const lightRecords = [];
        sceneRecord.scene.traverse(object => {
          if (applyWallHeightToObject(object, environment.wallHeight)) wallGroups += 1;
          if (object?.isLight) lightRecords.push(captureLight(object));
        });
        const record = { sceneRecord, settings: environment.interiorLighting, lights: lightRecords };
        lightingRecords.set(mapId, record);
        lights = applyLightingRecord(record);
        ensureLightingTimer();
      } else {
        if (needsWallHeight) wallGroups = applyWallHeight(sceneRecord.scene, environment.wallHeight);
        if (needsLighting) lights = applyLighting(sceneRecord, environment.interiorLighting, mapId);
      }
      for(const furniture of ceilingFurnitureInScene(sceneRecord.scene))
        fitCeilingFurniture(furniture, environment.wallHeight??DEFAULT_WALL_HEIGHT); // Co-locate the rigid black hatch with the room's actual ceiling.
      lastMapId = mapId;
      lastWallGroupCount = wallGroups;
      lastLightCount = lights;
      lastLightingMode = overlayOnlyLighting ? 'overlay-only' : (needsLighting ? 'three-authored' : 'default');
      window.__farmLog?.(
        `[interior-env] ${mapId} wall=${environment.wallHeight ?? 'default'} lighting=${lastLightingMode} base=${environment.interiorLighting?.baseLightLevel ?? 'default'} daylight=${environment.interiorLighting?.daylightInfluence ?? 'default'} radius=${environment.interiorLighting?.lightRadiusMultiplier ?? 'default'} wallGroups=${wallGroups} lights=${lights}`
      );
      return { environment, wallGroups, lights, lightingMode: lastLightingMode };
    });
  }

  function hookBuildingSceneMap(map, buildingPredicate) {
    if (!map?.set || map.__hobunjiInteriorEnvironmentSetHook) return false;
    buildingSceneMap = map;
    if (typeof buildingPredicate === 'function') isOrdinaryBuildingArea = buildingPredicate;
    const originalSet = map.set.bind(map); // Preserves the existing floor-style Map.set wrapper when both are installed.
    map.set = function setBuildingSceneWithEnvironment(mapId, sceneRecord) {
      const result = originalSet(mapId, sceneRecord);
      queueMicrotask(() => { applyEnvironmentToScene(mapId, sceneRecord); });
      return result;
    };
    Object.defineProperty(map, '__hobunjiInteriorEnvironmentSetHook', { value: true, configurable: true });
    for (const [mapId, sceneRecord] of map.entries()) queueMicrotask(() => { applyEnvironmentToScene(mapId, sceneRecord); });
    return true;
  }

  function wrapGridTileAccessorsInit() {
    const namespace = window.GridTileAccessors;
    if (!namespace?.init || namespace.__hobunjiInteriorEnvironmentInitHook) return false;
    const originalInit = namespace.init;
    namespace.init = function initWithInteriorEnvironment(injectedDeps) {
      registerCeilingFurnitureDefinitions(injectedDeps); // Also register on the scene-loading path, even if FarmPanel is lazy-loaded.
      hookBuildingSceneMap(injectedDeps?._buildingScenes, injectedDeps?._isBuildingArea);
      return originalInit.call(this, injectedDeps);
    };
    namespace.__hobunjiInteriorEnvironmentInitHook = true;
    return true;
  }

  // ── Building Interior Editor ───────────────────────────────────────
  function editorReadInterior() {
    const refresh = document.getElementById('refreshExportBtn');
    const text = document.getElementById('exportText');
    if (!refresh || !text) return null;
    refresh.click();
    try { return JSON.parse(text.value || '{}'); }
    catch (error) { lastError = String(error?.message || error); return null; }
  }

  function editorImportInterior(interior, filename) {
    const input = document.getElementById('importInput');
    if (!input || typeof DataTransfer !== 'function' || typeof File !== 'function') return false;
    const transfer = new DataTransfer();
    transfer.items.add(new File([JSON.stringify(interior, null, 2)], filename || 'interior-environment-edit.json', { type: 'application/json' }));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    editorReimports += 1;
    return true;
  }

  function editorEnvironmentFromControls() {
    return {
      wallHeight: clamp(document.getElementById('biaWallHeight')?.value, 0.5, 8, DEFAULT_WALL_HEIGHT),
      interiorLighting: {
        baseLightLevel: clamp(document.getElementById('biaBaseLightLevel')?.value, 0, 4, 1),
        daylightInfluence: clamp(document.getElementById('biaDaylightInfluence')?.value, 0, 6, 1),
        lightRadiusMultiplier: clamp(document.getElementById('biaLightRadiusMultiplier')?.value, 0.1, 8, 1),
      },
    };
  }

  function setEditorControlValues(value) {
    const environment = authoringEnvironment(value);
    const wall = document.getElementById('biaWallHeight');
    const base = document.getElementById('biaBaseLightLevel');
    const day = document.getElementById('biaDaylightInfluence');
    const radius = document.getElementById('biaLightRadiusMultiplier');
    if (wall) wall.value = environment.wallHeight;
    if (base) base.value = environment.interiorLighting.baseLightLevel;
    if (day) day.value = environment.interiorLighting.daylightInfluence;
    if (radius) radius.value = environment.interiorLighting.lightRadiusMultiplier;
  }

  function applyEditorPreviewLight(light) {
    if (!light) return;
    const environment = window.__hobunjiInteriorEnvironmentOverride;
    const settings = normalizeLighting(environment?.interiorLighting);
    const entry = captureLight(light);
    if (!settings) {
      light.intensity = entry.baseIntensity;
      if (entry.role === 'local' && entry.baseDistance > 0) light.distance = entry.baseDistance;
      return;
    }
    // The editor intentionally previews full daylight. Runtime uses the shared
    // weather/day-night factor above, so authors can see the slider's maximum.
    if (entry.role === 'base') light.intensity = entry.baseIntensity * settings.baseLightLevel;
    else if (entry.role === 'daylight') light.intensity = entry.baseIntensity * settings.daylightInfluence;
    else light.intensity = entry.baseIntensity;
    if (entry.role === 'local' && entry.baseDistance > 0) light.distance = entry.baseDistance * settings.lightRadiusMultiplier;
  }

  function refreshEditorPreviewLights() {
    for (const light of [...editorTrackedLights]) applyEditorPreviewLight(light);
  }

  function wrapEditorLightConstructor(name) {
    const Original = THREE[name];
    if (!Original || Original.__hobunjiInteriorEnvironmentPreviewWrapped) return !!Original;
    function InteriorEnvironmentLight(...args) {
      const light = new Original(...args);
      editorTrackedLights.add(light);
      applyEditorPreviewLight(light);
      return light;
    }
    Object.setPrototypeOf(InteriorEnvironmentLight, Original);
    InteriorEnvironmentLight.prototype = Original.prototype;
    InteriorEnvironmentLight.__hobunjiInteriorEnvironmentPreviewWrapped = true;
    InteriorEnvironmentLight.__hobunjiInteriorEnvironmentPreviewOriginal = Original;
    THREE[name] = InteriorEnvironmentLight;
    return true;
  }

  function installEditorLightBridge() {
    if (!IS_INTERIOR_EDITOR) return false;
    ['AmbientLight', 'HemisphereLight', 'DirectionalLight', 'PointLight', 'SpotLight'].forEach(wrapEditorLightConstructor);
    return true;
  }

  function ensureEditorControls() {
    if (!IS_INTERIOR_EDITOR || document.getElementById('biaInteriorEnvironmentSection')) return !!document.getElementById('biaInteriorEnvironmentSection');
    const floorSection = document.getElementById('biaFloorSurfaceSection');
    const left = document.getElementById('biaLeftPanel');
    const identity = left?.querySelector('.section');
    const anchor = floorSection || identity;
    if (!left || !anchor) return false;
    const section = document.createElement('div');
    section.className = 'section';
    section.id = 'biaInteriorEnvironmentSection';
    section.innerHTML = `
      <h2>1c. Interior light & walls</h2>
      <div class="field"><label>Wall height (tiles)</label><input id="biaWallHeight" type="number" min="0.5" max="8" step="0.05" value="${DEFAULT_WALL_HEIGHT}"></div>
      <div class="grid2" style="margin-top:6px">
        <div class="field"><label>Base light level</label><input id="biaBaseLightLevel" type="number" min="0" max="4" step="0.05" value="1"></div>
        <div class="field"><label>Daylight influence</label><input id="biaDaylightInfluence" type="number" min="0" max="6" step="0.05" value="1"></div>
      </div>
      <div class="field" style="margin-top:6px"><label>Local light radius multiplier</label><input id="biaLightRadiusMultiplier" type="number" min="0.1" max="8" step="0.1" value="1"></div>
      <div class="row" style="margin-top:7px">
        <button id="biaEnvironmentApply" type="button">Apply environment</button>
        <button id="biaEnvironmentDefault" type="button">Use defaults</button>
      </div>
      <p class="hint" id="biaEnvironmentStatus">Preview shows full daylight. Runtime daylight follows the real clock and weather.</p>`;
    anchor.insertAdjacentElement('afterend', section);

    document.getElementById('biaEnvironmentApply').addEventListener('click', () => {
      const interior = editorReadInterior();
      if (!interior) return;
      const environment = editorEnvironmentFromControls();
      interior.wallHeight = environment.wallHeight;
      interior.interiorLighting = environment.interiorLighting;
      window.__hobunjiInteriorWallHeightOverride = environment.wallHeight;
      window.__hobunjiInteriorEnvironmentOverride = environment;
      editorLastSignature = JSON.stringify(environment);
      refreshEditorPreviewLights();
      editorImportInterior(interior, `${interior.id || 'building_interior'}-environment.json`);
      const status = document.getElementById('biaEnvironmentStatus');
      if (status) status.textContent = `walls ${environment.wallHeight} · base ${environment.interiorLighting.baseLightLevel} · daylight ${environment.interiorLighting.daylightInfluence} · radius ×${environment.interiorLighting.lightRadiusMultiplier}`;
    });

    document.getElementById('biaEnvironmentDefault').addEventListener('click', () => {
      const interior = editorReadInterior();
      if (!interior) return;
      delete interior.wallHeight;
      delete interior.interiorLighting;
      window.__hobunjiInteriorWallHeightOverride = null;
      window.__hobunjiInteriorEnvironmentOverride = null;
      editorLastSignature = 'null';
      setEditorControlValues(null);
      refreshEditorPreviewLights();
      editorImportInterior(interior, `${interior.id || 'building_interior'}-default-environment.json`);
      const status = document.getElementById('biaEnvironmentStatus');
      if (status) status.textContent = `Defaults: ${DEFAULT_WALL_HEIGHT}-tile walls, normal base/daylight, normal local-light radius.`;
    });
    return true;
  }

  function syncEditorEnvironmentFromExport() {
    if (!IS_INTERIOR_EDITOR) return false;
    const interior = editorReadInterior();
    if (!interior) return false;
    const normalized = normalizeEnvironment(interior);
    const signature = JSON.stringify(normalized || null);
    if (signature === editorLastSignature) return true;
    editorLastSignature = signature;
    setEditorControlValues(normalized);
    window.__hobunjiInteriorWallHeightOverride = normalized?.wallHeight ?? null;
    window.__hobunjiInteriorEnvironmentOverride = normalized;
    refreshEditorPreviewLights();
    if (normalized) {
      // Native file/Library loads rebuild before this external bridge sees the
      // authored values. Re-import once with both preview overrides primed.
      editorImportInterior(interior, `${interior.id || 'building_interior'}-environment-sync.json`);
    }
    return true;
  }

  function installEditor() {
    if (!IS_INTERIOR_EDITOR) return false;
    installEditorLightBridge();
    installWallBuilderBridge();
    if (!document.getElementById('importInput') || !document.getElementById('exportText')) return false;
    if (!ensureEditorControls()) return false;
    syncEditorEnvironmentFromExport();
    setInterval(() => {
      ensureEditorControls();
      syncEditorEnvironmentFromExport();
    }, EDITOR_SYNC_MS);
    return true;
  }

  function debugSnapshot() {
    return {
      installed: true,
      defaultWallHeight: DEFAULT_WALL_HEIGHT,
      ceilingLadderRegistered, // Mobile-readable via window.__interiorEnvironmentDebug().
      ladderVisualBridgeInstalled,
      ladderFallbackRungs,
      lastLadderBuildKey,
      buildingSceneMapHooked: !!buildingSceneMap?.__hobunjiInteriorEnvironmentSetHook,
      configCacheKeys: [...configCache.keys()],
      overlayOnlyLightingPolicy: IS_INTERIOR_EDITOR ? 'editor-preview' : 'ordinary-authored-buildings',
      lightingMaps: [...lightingRecords.keys()],
      daylightFactor: daylightFactor(),
      lastMapId,
      lastWallGroupCount,
      lastLightCount,
      lastLightingMode,
      lastError,
      editor: IS_INTERIOR_EDITOR ? {
        controlsInstalled: !!document.getElementById('biaInteriorEnvironmentSection'),
        trackedLights: editorTrackedLights.size,
        reimports: editorReimports,
        signature: editorLastSignature,
      } : null,
    };
  }

  installWallBuilderBridge();
  installLadderVisualBridge();
  wrapInitForCeilingFurniture('FarmPanel');
  wrapInitForCeilingFurniture('FarmEditor');
  wrapGridTileAccessorsInit();
  if (IS_INTERIOR_EDITOR) installEditorLightBridge();

  const startedAt = performance.now(); // Bounded startup retry for alternate dev-page script orders.
  const installTimer = setInterval(() => {
    installWallBuilderBridge();
    installLadderVisualBridge();
    wrapInitForCeilingFurniture('FarmPanel');
    wrapInitForCeilingFurniture('FarmEditor');
    wrapGridTileAccessorsInit();
    if (IS_INTERIOR_EDITOR) installEditor();
    const runtimeReady = !IS_INTERIOR_EDITOR && !!window.GridTileAccessors?.__hobunjiInteriorEnvironmentInitHook;
    const editorReady = IS_INTERIOR_EDITOR && !!document.getElementById('biaInteriorEnvironmentSection');
    const definitionsHooked = !!(window.FarmPanel?.__hobunjiCeilingFurnitureDefinitionHook
      || window.FarmEditor?.__hobunjiCeilingFurnitureDefinitionHook); // Do not stop polling before a lazy farm initializer can supply the definitions.
    if ((runtimeReady && ladderVisualBridgeInstalled && definitionsHooked)
      || (editorReady && ladderVisualBridgeInstalled) || performance.now() - startedAt > 5000) clearInterval(installTimer);
  }, 25);

  window.InteriorEnvironmentRuntime = Object.freeze({
    installed: true,
    normalizeLighting,
    normalizeEnvironment,
    registerCeilingFurnitureDefinitions,
    daylightFactor,
    usesOverlayOnlyLighting,
    applyWallHeight,
    applyEnvironmentToScene,
    fitCeilingFurniture, // Called by authored furniture upgrades after their live parent scene is known.
    debugSnapshot,
  });
  window.__interiorEnvironmentDebug = debugSnapshot;
})();