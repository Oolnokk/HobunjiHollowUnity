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
  const EDITOR_SYNC_MS = 500; // Matches the existing external floor-control sync cadence.
  const LIGHTING_UPDATE_MS = 250; // Smooth enough for the slow game clock without doing light work every render frame.
  const configCache = new Map(); // mapId -> Promise<normalized environment|null>, avoiding repeated config fetches.
  const lightingRecords = new Map(); // mapId -> captured light references/base values for time-varying daylight updates.
  const editorTrackedLights = new Set(); // Tracks preview lights created through the constructor bridge so sliders can update them live.
  let buildingSceneMap = null; // Real private _buildingScenes Map exposed through GridTileAccessors.init deps.
  let lightingTimer = 0; // Shared interval used only after a custom-lighting interior has loaded.
  let lastMapId = null; // Mobile-friendly diagnostic: most recently applied authored environment.
  let lastWallGroupCount = 0; // Diagnostic count proving the authored wall height reached built wall groups.
  let lastLightCount = 0; // Diagnostic count proving custom lighting found actual Three.js lights.
  let lastError = null; // Most recent config/runtime error without requiring desktop devtools.
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

  function applyEnvironmentToScene(mapId, sceneRecord) {
    if (!sceneRecord?.scene) return Promise.resolve(null);
    return loadEnvironmentForMap(mapId).then(environment => {
      if (!environment) return null;
      const needsWallHeight = environment.wallHeight != null;
      const needsLighting = !!environment.interiorLighting;
      let wallGroups = 0;
      let lights = 0;
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
      lastMapId = mapId;
      lastWallGroupCount = wallGroups;
      lastLightCount = lights;
      window.__farmLog?.(
        `[interior-env] ${mapId} wall=${environment.wallHeight ?? 'default'} base=${environment.interiorLighting?.baseLightLevel ?? 'default'} daylight=${environment.interiorLighting?.daylightInfluence ?? 'default'} radius=${environment.interiorLighting?.lightRadiusMultiplier ?? 'default'} wallGroups=${wallGroups} lights=${lights}`
      );
      return { environment, wallGroups, lights };
    });
  }

  function hookBuildingSceneMap(map) {
    if (!map?.set || map.__hobunjiInteriorEnvironmentSetHook) return false;
    buildingSceneMap = map;
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
      hookBuildingSceneMap(injectedDeps?._buildingScenes);
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
      buildingSceneMapHooked: !!buildingSceneMap?.__hobunjiInteriorEnvironmentSetHook,
      configCacheKeys: [...configCache.keys()],
      lightingMaps: [...lightingRecords.keys()],
      daylightFactor: daylightFactor(),
      lastMapId,
      lastWallGroupCount,
      lastLightCount,
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
  wrapGridTileAccessorsInit();
  if (IS_INTERIOR_EDITOR) installEditorLightBridge();

  const startedAt = performance.now(); // Bounded startup retry for alternate dev-page script orders.
  const installTimer = setInterval(() => {
    installWallBuilderBridge();
    wrapGridTileAccessorsInit();
    if (IS_INTERIOR_EDITOR) installEditor();
    const runtimeReady = !IS_INTERIOR_EDITOR && !!window.GridTileAccessors?.__hobunjiInteriorEnvironmentInitHook;
    const editorReady = IS_INTERIOR_EDITOR && !!document.getElementById('biaInteriorEnvironmentSection');
    if (runtimeReady || editorReady || performance.now() - startedAt > 5000) clearInterval(installTimer);
  }, 25);

  window.InteriorEnvironmentRuntime = Object.freeze({
    installed: true,
    normalizeLighting,
    normalizeEnvironment,
    daylightFactor,
    applyWallHeight,
    applyEnvironmentToScene,
    debugSnapshot,
  });
  window.__interiorEnvironmentDebug = debugSnapshot;
})();
