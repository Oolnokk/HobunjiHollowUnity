(() => {
  'use strict';

  const Preview = window.WildernessLabPreview;
  const Generator = window.WildernessMapGenerator;
  const THREE = window.THREE;
  if (!Preview || Preview.__environmentRefreshInstalled) return;
  Preview.__environmentRefreshInstalled = true;

  const LAND_TARGETS = new Set(['grass','path','tilled','trench','raised','paddy','rock','shrub','cliff']); // Western Slope avalanche snow is geographic snowpack, so it covers exposed land rather than one seasonal terrain material.
  const LIVE_ZONE_BY_RECIPE = Object.freeze({
    liveNorthernCliffs: 'map_northern_cliffs',
    liveSouthernCloudForest: 'map_southern_cloud_forest',
    liveWesternSlope: 'map_western_slope',
    liveEasternMire: 'map_eastern_mire',
  }); // Live recipes resolve through the current main generator instead of preserving August-era copied overrides.

  // CalendarSystem's current-main Deadgrass surface tint is HSL(45deg, 0.40, 0.34).
  // Coldmuck slush uses that same underlying grass appearance with only a small
  // additional saturation reduction, so it reads as cold/wet Deadgrass rather
  // than an unrelated gray substrate.
  const DEADGRASS_H = 45 / 360;
  const DEADGRASS_S = 0.40;
  const DEADGRASS_L = 0.34;
  const COLDMUCK_DESATURATION = 0.15;
  const COLDMUCK_GROUND_TINT = THREE
    ? new THREE.Color().setHSL(DEADGRASS_H, DEADGRASS_S * (1 - COLDMUCK_DESATURATION), DEADGRASS_L)
    : null;
  const DEFAULT_GRASS_GREEN = THREE ? new THREE.Color(0x2f711e) : null;
  const activeColdmuckGroundMeshes = new Map(); // Mesh -> previous onBeforeRender hook; only the generated grass surface is season-tinted.

  function relabelEnvironmentUi() {
    const seasonal = [...document.querySelectorAll('details.card > summary')].find(summary => /Seasonal surface lab|Environmental surface preview/i.test(summary.textContent || ''));
    if (seasonal) seasonal.textContent = 'Environmental surface preview';
    const cardBody = seasonal?.parentElement?.querySelector('.card-body');
    const help = cardBody?.querySelector('.help');
    if (help) help.innerHTML = '<b>Coldmuck is not winter.</b> Coldmuck slush is a low-opacity black wet layer over the <b>Deadgrass-season grass surface</b>, with that underlying surface slightly desaturated. The Western Slope instead carries persistent deep snow deposited by avalanches from extremely high altitude. Neither preview changes collision or exported workspace data.';

    const enabledLabel = document.querySelector('label[for="winterEnabled"]');
    if (enabledLabel) enabledLabel.textContent = 'Enable surface layer';
    const layerLabel = document.querySelector('label[for="winterPreset"]');
    if (layerLabel) layerLabel.textContent = 'Environment layer';
    const targetLabel = document.querySelector('label[for="winterTarget"]');
    if (targetLabel) targetLabel.textContent = 'Slush target material';
    const heightLabel = document.querySelector('label[for="winterHeight"]');
    if (heightLabel) heightLabel.textContent = 'Accumulation depth';
    const opacityLabel = document.querySelector('label[for="winterOpacity"]');
    if (opacityLabel) opacityLabel.textContent = 'Layer opacity';

    const preset = document.getElementById('winterPreset');
    if (preset) {
      const snow = [...preset.options].find(option => option.value === 'snow');
      const slush = [...preset.options].find(option => option.value === 'slush');
      if (snow) snow.textContent = 'Western avalanche snowpack';
      if (slush) slush.textContent = 'Coldmuck slush';
    }

    if (cardBody && !document.getElementById('previewColdmuckSlushBtn')) {
      const row = document.createElement('div'); // One-click authoring previews make the two unrelated environmental systems explicit and easy to compare.
      row.className = 'row';
      row.style.margin = '8px 0';
      row.innerHTML = '<button id="previewColdmuckSlushBtn" class="secondary" type="button">Preview Coldmuck slush</button><button id="previewWesternSnowBtn" class="secondary" type="button">Preview Western snowpack</button>';
      help?.after(row);
    }
  }

  function normalizeEnvironmentSettings(settings) {
    if (!settings) return settings;
    const next = { ...settings };
    if (next.preset === 'slush') {
      const requestedOpacity = Number(next.opacity);
      next.opacity = Number.isFinite(requestedOpacity) && requestedOpacity < 0.85 ? requestedOpacity : 0.22; // Low-opacity black reads as waterlogged slush over the Deadgrass base rather than pale ice.
      next.height = Math.min(0.32, Math.max(0.06, Number(next.height) || 0.18)); // Slush is shallow, lumpy three-dimensional accumulation that the player visually wades through.
      next.noise = Number(next.noise) || 1.6;
      next.bulge = Math.min(0.78, Number(next.bulge) || 0.52);
      next.environmentKind = 'coldmuckSlush';
      next.localized = true;
      next.baseSeason = 'Deadgrass';
      next.baseDesaturation = COLDMUCK_DESATURATION;
    } else if (next.preset === 'snow') {
      next.environmentKind = 'westernAvalancheSnowpack';
      next.localized = false;
      next.allLandTargets = true;
      next.opacity = 1;
      next.height = Math.max(0.35, Number(next.height) || 0.55); // Western accumulation is deliberately substantial because it is avalanche-fed permanent snowpack, not seasonal frost.
    }
    return next;
  }

  function restoreGameTerrainUnderSlush() {
    for (const scene of [...(window.__wildernessLabScenes || [])]) {
      scene.traverse?.(node => {
        if (!node?.isMesh) return;
        const baseMaterial = node.material?.userData?.__labBaseTerrain || String(node.material?.name || '').startsWith('wilderness_lab_'); // Lab terrain meshes use the current terrain-material config and should remain visible below translucent slush.
        if (baseMaterial) node.visible = true;
      });
    }
  }

  function clearColdmuckGroundLook() {
    for (const [mesh, previousOnBeforeRender] of activeColdmuckGroundMeshes) {
      mesh.onBeforeRender = previousOnBeforeRender || (() => {});
      const material = mesh.material;
      if (!material?.color?.isColor) continue;
      if (material.map) material.color.set(0xffffff); // Textured grass materials are white in the normal preview so the authored texture is unmodified.
      else if (DEFAULT_GRASS_GREEN) material.color.copy(DEFAULT_GRASS_GREEN); // Untextured grass falls back to the Lab/game-authored green.
      material.needsUpdate = true;
    }
    activeColdmuckGroundMeshes.clear();
  }

  function applyColdmuckGroundLook() {
    clearColdmuckGroundLook();
    if (!COLDMUCK_GROUND_TINT) return;
    for (const scene of [...(window.__wildernessLabScenes || [])]) {
      scene.traverse?.(mesh => {
        if (!mesh?.isMesh) return;
        const terrainKey = mesh.material?.userData?.terrainKey || mesh.userData?.terrainKey;
        if (terrainKey !== 'grass') return; // Current-main seasonal tinting changes grass surfaces; paths/rock/cliffs keep their own authored surface materials.
        const material = mesh.material;
        if (!material?.color?.isColor) return;
        const previousOnBeforeRender = mesh.onBeforeRender;
        activeColdmuckGroundMeshes.set(mesh, previousOnBeforeRender);
        material.color.copy(COLDMUCK_GROUND_TINT);
        if (material.emissive?.isColor) material.emissive.copy(COLDMUCK_GROUND_TINT).multiplyScalar(0.3); // Mirrors the game's seasonal Lambert emissive floor behavior when present.
        material.needsUpdate = true;
        mesh.onBeforeRender = function (...args) {
          if (typeof previousOnBeforeRender === 'function') previousOnBeforeRender.apply(this, args);
          if (material.color?.isColor) material.color.copy(COLDMUCK_GROUND_TINT); // Reassert after async texture loads, which normally reset the Lab grass material color to white.
          if (material.emissive?.isColor) material.emissive.copy(COLDMUCK_GROUND_TINT).multiplyScalar(0.3);
        };
      });
    }
  }

  function withColdmuckSlushMaterial(build) {
    if (!THREE?.MeshPhongMaterial) return build();
    const OriginalMeshPhongMaterial = THREE.MeshPhongMaterial;
    function ColdmuckAwareMeshPhongMaterial(parameters = {}) {
      const wet = {
        ...parameters,
        color: 0x000000,
        specular: new THREE.Color(0x70777c), // Small neutral glint keeps the black transparent mass looking wet without turning it silver/white.
        shininess: 72,
        transparent: true,
        depthWrite: false,
      };
      return new OriginalMeshPhongMaterial(wet);
    }
    ColdmuckAwareMeshPhongMaterial.prototype = OriginalMeshPhongMaterial.prototype;
    Object.setPrototypeOf(ColdmuckAwareMeshPhongMaterial, OriginalMeshPhongMaterial);
    THREE.MeshPhongMaterial = ColdmuckAwareMeshPhongMaterial;
    try {
      return build();
    } finally {
      THREE.MeshPhongMaterial = OriginalMeshPhongMaterial;
    }
  }

  function rebuildEnvironmentLayer(settings, rebuild) {
    const normalized = normalizeEnvironmentSettings(settings);
    if (!normalized?.enabled || normalized.preset !== 'slush') {
      clearColdmuckGroundLook();
      return rebuild(normalized);
    }
    const result = withColdmuckSlushMaterial(() => rebuild(normalized));
    restoreGameTerrainUnderSlush(); // Old preview hid the terrain entirely; Coldmuck is real Deadgrass terrain plus translucent black slush.
    applyColdmuckGroundLook();
    return result;
  }

  const previousRebuild = typeof Preview.rebuildWinter === 'function' ? Preview.rebuildWinter.bind(Preview) : null;
  if (previousRebuild) {
    Preview.rebuildWinter = settings => rebuildEnvironmentLayer(settings, previousRebuild);
  }

  const previousRender = Preview.renderWorkspace.bind(Preview);
  Preview.renderWorkspace = (workspace, rootId, environmentSettings) => {
    const normalized = normalizeEnvironmentSettings(environmentSettings);
    if (normalized?.preset === 'slush' && normalized.enabled) {
      clearColdmuckGroundLook();
      const merged = withColdmuckSlushMaterial(() => previousRender(workspace, rootId, normalized));
      restoreGameTerrainUnderSlush();
      applyColdmuckGroundLook();
      return merged;
    }
    clearColdmuckGroundLook();
    if (normalized?.preset !== 'snow' || !normalized.enabled) return previousRender(workspace, rootId, normalized);

    const merged = previousRender(workspace, rootId, null); // Build current-main terrain first; avalanche snow is layered after every current terrain adapter has run.
    const scenes = [...(window.__wildernessLabScenes || [])];
    const changedNodes = [];
    const changedMaterials = new Map(); // Shared materials are restored once so one grass bucket cannot accidentally restore another bucket to the temporary avalanche key.
    for (const scene of scenes) {
      scene.traverse?.(node => {
        if (!node?.isMesh) return;
        const nodeKey = node.userData?.terrainKey;
        const materialKey = node.material?.userData?.terrainKey;
        const originalKey = LAND_TARGETS.has(nodeKey) ? nodeKey : materialKey;
        if (!LAND_TARGETS.has(originalKey)) return;
        changedNodes.push({ node, key: nodeKey });
        node.userData.terrainKey = '__western_avalanche_land__';
        if (node.material?.userData && !changedMaterials.has(node.material)) {
          changedMaterials.set(node.material, materialKey);
          node.material.userData.terrainKey = '__western_avalanche_land__';
        }
      });
    }
    try {
      Preview.rebuildWinter({ ...normalized, target: '__western_avalanche_land__' }); // One shared target lets true-boundary welding treat the entire exposed landmass as one continuous snowfield.
    } finally {
      for (const item of changedNodes) item.node.userData.terrainKey = item.key;
      for (const [material, key] of changedMaterials) material.userData.terrainKey = key;
    }
    return merged;
  };

  function setEnvironmentPreset(kind) {
    const preset = document.getElementById('winterPreset');
    const enabled = document.getElementById('winterEnabled');
    const opacity = document.getElementById('winterOpacity');
    const opacityNum = document.getElementById('winterOpacityNum');
    const height = document.getElementById('winterHeight');
    const heightNum = document.getElementById('winterHeightNum');
    const target = document.getElementById('winterTarget');
    if (!preset || !enabled) return;
    preset.value = kind;
    enabled.checked = true;
    if (kind === 'slush') {
      if (opacity) opacity.value = '0.22';
      if (opacityNum) opacityNum.value = '0.22';
      if (height) height.value = '0.18';
      if (heightNum) heightNum.value = '0.18';
      if (target) { target.value = 'grass'; target.disabled = false; }
    } else {
      if (opacity) opacity.value = '1';
      if (opacityNum) opacityNum.value = '1';
      if (height) height.value = '0.55';
      if (heightNum) heightNum.value = '0.55';
      if (target) target.disabled = true;
    }
    preset.dispatchEvent(new Event('change', { bubbles:true }));
    const generate = document.getElementById('generateBtn');
    if (generate && !generate.disabled) generate.click();
  }

  function installEnvironmentUiBehavior() {
    const preset = document.getElementById('winterPreset');
    if (preset && !preset.__environmentDefaultsInstalled) {
      preset.__environmentDefaultsInstalled = true;
      preset.addEventListener('change', () => {
        const target = document.getElementById('winterTarget');
        if (target) target.disabled = preset.value === 'snow';
        if (preset.value !== 'slush') clearColdmuckGroundLook();
      });
      const target = document.getElementById('winterTarget');
      if (target) target.disabled = preset.value === 'snow';
    }
    document.getElementById('previewColdmuckSlushBtn')?.addEventListener('click', () => setEnvironmentPreset('slush'));
    document.getElementById('previewWesternSnowBtn')?.addEventListener('click', () => setEnvironmentPreset('snow'));
  }

  function installCurrentMainLiveRecipeRouting() {
    if (!Generator || Generator.__wildernessLabCurrentMainRouting || typeof Generator.generateZoneWorkspace !== 'function') return;
    Generator.__wildernessLabCurrentMainRouting = true;
    const ordinaryGenerateWorkspace = Generator.generateWorkspace.bind(Generator); // Non-live recipes still use every tweakable Lab control exactly as before.
    Generator.generateWorkspace = (seed, settings = {}) => {
      const recipeId = document.getElementById('recipeSelect')?.value;
      const zoneId = LIVE_ZONE_BY_RECIPE[recipeId];
      if (!zoneId) return ordinaryGenerateWorkspace(seed, settings);
      const workspace = Generator.generateZoneWorkspace(zoneId, seed, settings.locales || []); // Current-main ZONE_CONFIG is now the authority, so the four LIVE recipes cannot silently drift stale again.
      workspace.wildernessLabLiveRecipe = { zoneId, source: 'current-main generateZoneWorkspace' };
      return workspace;
    };
  }

  relabelEnvironmentUi();
  installEnvironmentUiBehavior();
  installCurrentMainLiveRecipeRouting();
  console.log(`[WildernessLab] Coldmuck preview: black slush at low opacity over Deadgrass HSL(45, 0.40, 0.34) with ${Math.round(COLDMUCK_DESATURATION * 100)}% extra desaturation.`);
})();