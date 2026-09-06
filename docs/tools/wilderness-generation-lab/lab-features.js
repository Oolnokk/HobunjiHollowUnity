(() => {
  'use strict';

  let previewDebugLog = () => {}; // Populated from WildernessLabPreview.init so feature adapters can report into the tool's visible Debug panel.
  let forceAuthoringFogOff = false; // Once a wilderness workspace renders, the captured render loop keeps fog disabled before every frame.
  let specialRecipeUiInstalled = false; // Prevents duplicate recipe options/listeners when the page or helper is initialized more than once.

  const LIVE_ZONE_RECIPES = Object.freeze({
    liveNorthernCliffs: {
      label: 'LIVE — Northern Cliffs exact',
      settings: { entrySide:'south', preset:'cliffs', boundaryMode:'followMapHeight', boundaryCliffBoost:5 },
    },
    liveSouthernCloudForest: {
      label: 'LIVE — Southern Cloud Forest exact',
      settings: {
        entrySide:'north', preset:'greatBasin', boundaryMode:'entrySideDistantLandscape', boundaryCliffBoost:0,
        trees:4000, treesFillGaps:true, bushes:150, treeThinning:0.2, treeVarietyFraction:1/6,
        denEntranceTreeClearance:3, plateaus:25, plateauAreaMul:1.5, lowProfilePlateaus:true, maxTier:2,
        wideRamps:true, ramps:20, pathWindiness:8, entryGateWidthMul:0.2,
      },
    },
    liveWesternSlope: {
      label: 'LIVE — Western Slope exact',
      settings: { entrySide:'east', preset:'cliffs', boundaryMode:'entrySideDistantLandscape', boundaryCliffBoost:0 },
    },
    liveEasternMire: {
      label: 'LIVE — Eastern Mire exact',
      settings: { entrySide:'west', preset:'greatBasin', boundaryMode:'followMapHeight', boundaryCliffBoost:2 },
    },
  });

  const HYBRID_RECIPE = Object.freeze({
    settings: {
      preset:'custom', boundaryMode:'followMapHeight', plateaus:0, ramps:0,
      ponds:0, plateauPonds:0, plateauStreams:0, rivers:0, pathAnchors:3,
    },
    hybrid: {
      enabled:true, approachSide:'south', rise:5, cliffPosition:0.62, inclineRun:0.42,
      width:0.82, center:0.5, shoulder:0.14, curve:1.0, edgeJitter:0.025,
    },
  });

  function installPreviewSceneCapture() {
    const THREE = window.THREE; // Three is loaded before this lab feature module by the tool page.
    if (!THREE?.WebGLRenderer || THREE.WebGLRenderer.__wildernessLabCaptureWrapper) return;
    const OriginalRenderer = THREE.WebGLRenderer; // Preserved constructor used by the narrow lab-only wrapper below.
    window.__wildernessLabScenes = window.__wildernessLabScenes || new Set(); // Captured preview scenes let feature adapters retag generated meshes and add schematic object markers.
    function CapturingRenderer(...args) {
      const renderer = new OriginalRenderer(...args); // Real r128 renderer instance returned unchanged apart from render interception.
      const originalRender = renderer.render.bind(renderer); // Instance-owned r128 render function must be wrapped directly rather than via the prototype.
      renderer.render = (scene, camera) => {
        window.__wildernessLabScenes.add(scene);
        if (forceAuthoringFogOff && scene?.fog) scene.fog = null; // Defensive per-frame policy prevents later preview code from silently restoring opaque town-scale fog.
        return originalRender(scene, camera);
      };
      return renderer;
    }
    CapturingRenderer.prototype = OriginalRenderer.prototype;
    Object.setPrototypeOf(CapturingRenderer, OriginalRenderer);
    CapturingRenderer.__wildernessLabCaptureWrapper = true;
    THREE.WebGLRenderer = CapturingRenderer;
  }

  function applyAuthoringFogPolicy(merged) {
    const scenes = [...(window.__wildernessLabScenes || [])]; // The lab normally has one scene; a Set keeps this safe across renderer reinitialization.
    const cols = Math.max(1, Number(merged?.cols) || 1); // Generated wilderness width after the generator's density-upscale pass.
    const rows = Math.max(1, Number(merged?.rows) || 1); // Generated wilderness height after the generator's density-upscale pass.
    forceAuthoringFogOff = true;
    for (const scene of scenes) if (scene) scene.fog = null; // Authoring view deliberately disables gameplay/map-editor FogExp2 at large fit distances.
    const message = `3D authoring fog OFF for ${cols}×${rows} wilderness preview.`;
    console.log(`[WildernessLab] ${message}`);
    previewDebugLog(message);
  }

  function applyNaturalHybridRampSkin(workspace) {
    const rootMap = rootMapForWorkspace(workspace); // Root tile metadata tells us whether every active ramp belongs to the natural hybrid field.
    if (!rootMap) return false;
    const rampTiles = Object.values(rootMap.tiles || {}).filter(tile => tile?.type === 'ramp'); // All ramp tiles determine whether one merged ramp mesh can be safely reskinned as a unit.
    const naturalRampTiles = rampTiles.filter(tile => tile?.labSurfaceMaterial === 'grass'); // Hybrid-generated ramps carry this tag; ordinary authored/generated ramps do not.
    if (!naturalRampTiles.length || naturalRampTiles.length !== rampTiles.length) return false;
    const scenes = [...(window.__wildernessLabScenes || [])]; // The lab creates one preview scene, but a Set keeps the adapter safe if the renderer is reinitialized.
    let grassMaterial = null;
    for (const scene of scenes) {
      scene.traverse?.(node => {
        if (grassMaterial || !node?.isMesh) return;
        if (node.material?.userData?.terrainKey === 'grass') grassMaterial = node.material;
      });
      if (grassMaterial) break;
    }
    if (!grassMaterial) return false;
    let changed = false;
    for (const scene of scenes) {
      scene.traverse?.(node => {
        if (!node?.isMesh || node.name !== 'ramps') return;
        node.material = grassMaterial;
        node.userData.terrainKey = 'grass';
        changed = true;
      });
    }
    return changed;
  }

  function ensureMarkerScriptLoaded() {
    if (window.WildernessLabPreview?.markerColors || document.querySelector('script[data-wilderness-lab-markers]')) return;
    const script = document.createElement('script'); // Dynamically loaded because older lab HTML already includes this feature module before lab-preview.js.
    script.src = 'lab-markers.js';
    script.async = false;
    script.dataset.wildernessLabMarkers = '1';
    script.addEventListener('load', () => {
      previewDebugLog('3D cube object marker renderer loaded.');
      const rerender = () => {
        const button = document.getElementById('generateBtn'); // A quick rerun ensures the very first preview receives markers even if this script finished after initial generation.
        if (button && !button.disabled) button.click();
      };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(rerender, 0), { once:true });
      else setTimeout(rerender, 0);
    });
    script.addEventListener('error', () => previewDebugLog('ERROR: lab-markers.js failed to load.'));
    document.head.appendChild(script);
  }

  function installPreviewApiAdapter() {
    if (Object.getOwnPropertyDescriptor(window, 'WildernessLabPreview')?.set) return;
    let previewApi = null; // Backing value populated when lab-preview.js publishes its API later in page load.
    Object.defineProperty(window, 'WildernessLabPreview', {
      configurable: true,
      enumerable: true,
      get() { return previewApi; },
      set(value) {
        previewApi = value;
        if (!value || value.__naturalHybridAdapterInstalled || typeof value.renderWorkspace !== 'function') return;
        const originalInit = typeof value.init === 'function' ? value.init.bind(value) : null; // Existing init remains authoritative; wrapper only captures the visible debug sink.
        if (originalInit) {
          value.init = async options => {
            previewDebugLog = options?.debugLog || (() => {});
            return originalInit(options);
          };
        }
        const originalRenderWorkspace = value.renderWorkspace.bind(value); // Existing preview implementation remains authoritative for terrain geometry.
        value.renderWorkspace = (workspace, rootId, winterSettings) => {
          const merged = originalRenderWorkspace(workspace, rootId, winterSettings);
          applyAuthoringFogPolicy(merged); // Large generated wilderness maps must remain visible at their much longer fit-camera distance.
          const reskinned = applyNaturalHybridRampSkin(workspace); // Hybrid-only recipe swaps the merged ramp mesh from path to natural grass.
          if (reskinned && winterSettings?.enabled) value.rebuildWinter?.(winterSettings); // Rebuild after material tagging so snow/slush targeting sees the incline as grass too.
          return merged;
        };
        value.__naturalHybridAdapterInstalled = true;
        ensureMarkerScriptLoaded();
      },
    });
  }

  function setControlRangeMax(key, max) {
    const range = document.getElementById(`ctl_${key}`); // Range generated by the lab's CONTROL_SCHEMA.
    const number = document.getElementById(`ctl_${key}_num`); // Paired numeric input generated beside the range.
    if (range) range.max = String(max);
    if (number) number.max = String(max);
  }

  function setControlValue(key, value) {
    const control = document.getElementById(`ctl_${key}`); // Existing lab control; missing non-UI generator settings simply remain generator defaults.
    if (!control) return;
    if (control.type === 'checkbox') control.checked = !!value;
    else control.value = String(value);
    const number = document.getElementById(`ctl_${key}_num`); // Range controls have a numeric mirror that must stay visually synchronized.
    if (number) number.value = String(value);
  }

  function setHybridControls(settings = {}) {
    const defaults = defaultHybridEscarpmentSettings(); // Missing hybrid fields get the same defaults as the transform itself.
    const merged = { ...defaults, ...settings };
    const enabled = document.getElementById('hybridEnabled');
    if (enabled) enabled.checked = !!merged.enabled;
    const approach = document.getElementById('hybridApproach');
    if (approach) approach.value = merged.approachSide;
    const pairs = [
      ['hybridRise','rise'], ['hybridCliffPosition','cliffPosition'], ['hybridInclineRun','inclineRun'],
      ['hybridWidth','width'], ['hybridCenter','center'], ['hybridShoulder','shoulder'],
      ['hybridCurve','curve'], ['hybridJitter','edgeJitter'],
    ];
    for (const [id, key] of pairs) {
      const range = document.getElementById(id);
      const number = document.getElementById(`${id}Num`);
      if (range) range.value = String(merged[key]);
      if (number) number.value = String(merged[key]);
    }
  }

  function applyResolvedRecipe(settings, hybrid = { enabled:false }) {
    const generatorDefaults = window.WildernessMapGenerator?.defaultSettings?.() || {}; // Live recipes intentionally start from real generator defaults, never the user's previous slider state.
    const resolved = { ...generatorDefaults, ...(settings || {}) };
    setControlRangeMax('trees', 5000); // Southern Cloud Forest currently needs 4000 trees, beyond the original lab cap of 500.
    setControlRangeMax('pathWindiness', 10); // Southern Cloud Forest currently needs windiness 8, beyond the original lab cap of 4.
    for (const [key, value] of Object.entries(resolved)) setControlValue(key, value);
    setHybridControls(hybrid);
    const generateButton = document.getElementById('generateBtn'); // Special recipes are meant to visibly apply immediately, not wait for Auto mode.
    setTimeout(() => { if (generateButton && !generateButton.disabled) generateButton.click(); }, 0);
  }

  function handleSpecialRecipe(value) {
    if (LIVE_ZONE_RECIPES[value]) {
      applyResolvedRecipe(LIVE_ZONE_RECIPES[value].settings, { enabled:false });
      previewDebugLog(`Applied exact live wilderness recipe: ${LIVE_ZONE_RECIPES[value].label}.`);
      return true;
    }
    if (value === 'hybridEscarpment') {
      applyResolvedRecipe(HYBRID_RECIPE.settings, HYBRID_RECIPE.hybrid);
      previewDebugLog('Applied incline → sheer cliff recipe and regenerated immediately.');
      return true;
    }
    return false;
  }

  function installSpecialRecipeUi() {
    if (specialRecipeUiInstalled) return;
    const select = document.getElementById('recipeSelect');
    const trees = document.getElementById('ctl_trees');
    if (!select || !trees) {
      setTimeout(installSpecialRecipeUi, 50); // Controls are built synchronously by the inline lab boot; retry until that has happened.
      return;
    }
    specialRecipeUiInstalled = true;
    setControlRangeMax('trees', 5000);
    setControlRangeMax('pathWindiness', 10);
    const anchor = select.querySelector('option[value="hybridEscarpment"]'); // Exact live recipes are grouped immediately before the experimental hybrid recipe.
    for (const [value, recipe] of Object.entries(LIVE_ZONE_RECIPES)) {
      if (select.querySelector(`option[value="${value}"]`)) continue;
      const option = document.createElement('option');
      option.value = value;
      option.textContent = recipe.label;
      select.insertBefore(option, anchor || null);
    }
    if (anchor) anchor.textContent = 'Incline → sheer cliff (spawn now)';
    select.addEventListener('change', event => {
      if (!handleSpecialRecipe(select.value)) return;
      event.stopImmediatePropagation(); // Stops the older page-level recipe handler from replacing our exact live settings with its fallback/default recipe.
    }, true);
    const applyButton = document.getElementById('applyRecipeBtn');
    applyButton?.addEventListener('click', event => {
      if (!handleSpecialRecipe(select.value)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
    previewDebugLog('Exact live-zone recipes installed; tree/path-windiness ranges expanded for current production values.');
  }

  installPreviewSceneCapture();
  installPreviewApiAdapter();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(installSpecialRecipeUi, 0), { once:true });
  else setTimeout(installSpecialRecipeUi, 0);

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, Number(value)));
  }

  function smoothstep01(value) {
    const t = clamp(value, 0, 1); // Normalized blend used by the incline and shoulder profiles below.
    return t * t * (3 - 2 * t);
  }

  function hash01(value, salt = 0) {
    let h = (2166136261 ^ Math.imul((value | 0) + salt, 374761393)) >>> 0; // Stable cross-axis noise seed used to roughen the cliff line.
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    return h / 4294967296;
  }

  function rootMapForWorkspace(workspace) {
    const roots = (workspace?.maps || []).filter(map => map && !map.isSubmap); // Root maps are the only maps the lab-level terrain modifiers rewrite.
    if (workspace?.activeId) {
      const active = roots.find(map => map.id === workspace.activeId); // Active root wins when the generator exported one explicitly.
      if (active) return active;
    }
    return roots[0] || workspace?.maps?.[0] || null;
  }

  function defaultHybridEscarpmentSettings() {
    return {
      enabled: false,
      approachSide: 'south',
      rise: 3.5,
      cliffPosition: 0.62,
      inclineRun: 0.34,
      width: 0.72,
      center: 0.50,
      shoulder: 0.16,
      curve: 1.15,
      edgeJitter: 0.025,
    };
  }

  function axisCoordinate(c, r, cols, rows, approachSide) {
    if (approachSide === 'north') return rows > 1 ? r / (rows - 1) : 0;
    if (approachSide === 'east') return cols > 1 ? (cols - 1 - c) / (cols - 1) : 0;
    if (approachSide === 'west') return cols > 1 ? c / (cols - 1) : 0;
    return rows > 1 ? (rows - 1 - r) / (rows - 1) : 0;
  }

  function crossCoordinate(c, r, cols, rows, approachSide) {
    const verticalApproach = approachSide === 'north' || approachSide === 'south'; // Vertical approaches use X as their cross-axis coordinate.
    return verticalApproach ? (cols > 1 ? c / (cols - 1) : 0) : (rows > 1 ? r / (rows - 1) : 0);
  }

  function crossIndex(c, r, approachSide) {
    return (approachSide === 'north' || approachSide === 'south') ? c : r;
  }

  function applyHybridEscarpment(workspace, rawOptions = {}) {
    const defaults = defaultHybridEscarpmentSettings(); // Defaults keep the transform deterministic even when older saved lab settings omit new fields.
    const options = { ...defaults, ...(rawOptions || {}) };
    if (!options.enabled) return { applied:false, changedTiles:0, highEdgeTiles:0, options };
    const rootMap = rootMapForWorkspace(workspace);
    if (!rootMap || !Number.isFinite(rootMap.cols) || !Number.isFinite(rootMap.rows)) throw new Error('Hybrid escarpment needs a generated root map with numeric cols/rows.');
    const cols = rootMap.cols;
    const rows = rootMap.rows;
    const approachSide = ['north','east','south','west'].includes(options.approachSide) ? options.approachSide : 'south';
    const rise = clamp(options.rise, 0.05, 16);
    const cliffPosition = clamp(options.cliffPosition, 0.08, 0.92);
    const inclineRun = clamp(options.inclineRun, 0.04, Math.max(0.04, cliffPosition));
    const width = clamp(options.width, 0.05, 1);
    const center = clamp(options.center, 0, 1);
    const shoulder = clamp(options.shoulder, 0.01, 0.49);
    const curve = clamp(options.curve, 0.25, 4);
    const edgeJitter = clamp(options.edgeJitter, 0, 0.12);
    const startPosition = Math.max(0, cliffPosition - inclineRun);
    const tiles = rootMap.tiles || (rootMap.tiles = {});
    let changedTiles = 0;
    let highEdgeTiles = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const u = axisCoordinate(c, r, cols, rows, approachSide);
        const cross = crossCoordinate(c, r, cols, rows, approachSide);
        const jitterSample = hash01(crossIndex(c, r, approachSide), 9341) - 0.5;
        const localCliff = clamp(cliffPosition + jitterSample * edgeJitter * 2, startPosition + 0.01, 0.96);
        if (u < startPosition || u > localCliff) continue;
        const halfWidth = width * 0.5;
        const lateralDistance = Math.abs(cross - center);
        if (lateralDistance > halfWidth) continue;
        const innerHalfWidth = halfWidth * (1 - shoulder);
        const shoulderT = halfWidth > innerHalfWidth ? (lateralDistance - innerHalfWidth) / Math.max(1e-6, halfWidth - innerHalfWidth) : 0;
        const lateralFactor = lateralDistance <= innerHalfWidth ? 1 : 1 - smoothstep01(shoulderT);
        if (lateralFactor <= 0.002) continue;
        const forwardT = (u - startPosition) / Math.max(1e-6, localCliff - startPosition);
        const forwardFactor = Math.pow(smoothstep01(forwardT), curve);
        const rampElevation = rise * forwardFactor * lateralFactor;
        if (rampElevation <= 0.002) continue;
        const key = `${c},${r}`;
        const existing = tiles[key] && typeof tiles[key] === 'object' ? { ...tiles[key] } : { crop:'' };
        existing.type = 'ramp';
        existing.rampElevation = Number(rampElevation.toFixed(4));
        existing.labSurfaceMaterial = existing.labSurfaceMaterial || 'grass';
        existing.crop = existing.crop || '';
        delete existing.plateau;
        delete existing.generatedObjectType;
        delete existing.borderEntryGate;
        tiles[key] = existing;
        changedTiles++;
        if (forwardT >= 0.88 && lateralFactor >= 0.35) highEdgeTiles++;
      }
    }
    workspace.wildernessLabFeatures = workspace.wildernessLabFeatures || {};
    workspace.wildernessLabFeatures.hybridEscarpment = {
      ...options, approachSide, rise, cliffPosition, inclineRun, width, center, shoulder, curve, edgeJitter,
      changedTiles, highEdgeTiles,
      implementation:'root-map rampElevation field with natural-surface material tag; no plateau submaps',
    };
    return { applied:true, changedTiles, highEdgeTiles, options:workspace.wildernessLabFeatures.hybridEscarpment };
  }

  window.WildernessLabFeatures = {
    defaultHybridEscarpmentSettings,
    applyHybridEscarpment,
    rootMapForWorkspace,
    isAuthoringFogForcedOff: () => forceAuthoringFogOff,
    liveZoneRecipes: LIVE_ZONE_RECIPES,
  };
})();