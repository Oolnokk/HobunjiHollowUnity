(() => {
  'use strict';

  const Preview = window.WildernessLabPreview;
  if (!Preview || Preview.__environmentRefreshInstalled) return;
  Preview.__environmentRefreshInstalled = true;

  const LAND_TARGETS = new Set(['grass','path','tilled','trench','raised','paddy','rock','shrub','cliff']); // Western Slope avalanche snow is geographic snowpack, so it may cover every exposed land-surface bucket rather than one seasonal material target.

  function relabelEnvironmentUi() {
    const seasonal = [...document.querySelectorAll('details.card > summary')].find(summary => /Seasonal surface lab/i.test(summary.textContent || ''));
    if (seasonal) seasonal.textContent = 'Environmental surface preview';
    const help = seasonal?.parentElement?.querySelector('.help');
    if (help) help.innerHTML = '<b>Coldmuck is not winter.</b> Coldmuck can create localized gray slush. The Western Slope instead carries persistent deep snow deposited by avalanches from extremely high altitude. These preview layers are visual-only and do not change collision or exported workspace data.';

    const enabledLabel = document.querySelector('label[for="winterEnabled"]');
    if (enabledLabel) enabledLabel.textContent = 'Enable surface layer';
    const layerLabel = document.querySelector('label[for="winterPreset"]');
    if (layerLabel) layerLabel.textContent = 'Environment layer';
    const targetLabel = document.querySelector('label[for="winterTarget"]');
    if (targetLabel) targetLabel.textContent = 'Slush target material';
    const heightLabel = document.querySelector('label[for="winterHeight"]');
    if (heightLabel) heightLabel.textContent = 'Accumulation depth';

    const preset = document.getElementById('winterPreset');
    if (preset) {
      const snow = [...preset.options].find(option => option.value === 'snow');
      const slush = [...preset.options].find(option => option.value === 'slush');
      if (snow) snow.textContent = 'Western avalanche snowpack';
      if (slush) slush.textContent = 'Coldmuck slush';
    }
  }

  function normalizeEnvironmentSettings(settings) {
    if (!settings) return settings;
    const next = { ...settings };
    if (next.preset === 'slush') {
      next.opacity = Number.isFinite(Number(next.opacity)) ? Number(next.opacity) : 0.58; // Gray translucent mass approximates the intended in-game Coldmuck slush appearance while preserving real terrain relief.
      if (next.opacity > 0.72) next.opacity = 0.58;
      next.height = Math.min(0.32, Math.max(0.06, Number(next.height) || 0.18)); // Slush is shallow, lumpy three-dimensional accumulation you visually wade through rather than a snowbank.
      next.noise = Number(next.noise) || 1.6;
      next.bulge = Math.min(0.78, Number(next.bulge) || 0.52);
      next.environmentKind = 'coldmuckSlush';
      next.localized = true;
    } else if (next.preset === 'snow') {
      next.environmentKind = 'westernAvalancheSnowpack';
      next.localized = false;
      next.allLandTargets = true; // Persistent Western Slope avalanche deposition covers the zone's exposed land rather than representing a regional winter season.
      next.opacity = 1;
    }
    return next;
  }

  const previousRebuild = typeof Preview.rebuildWinter === 'function' ? Preview.rebuildWinter.bind(Preview) : null;
  if (previousRebuild) {
    Preview.rebuildWinter = settings => previousRebuild(normalizeEnvironmentSettings(settings));
  }

  // `lab-preview.js` historically accepts one terrain target. For avalanche snow,
  // rebuild once per land target and retain each generated overlay group by calling
  // the original renderer through a temporary traversal wrapper. Because the old
  // preview only exposes one current overlay root, the full-land rendering is
  // implemented by temporarily tagging every exposed land mesh with the selected
  // target key, building one continuous true-boundary snow shell, then restoring
  // the original keys immediately afterward.
  const previousRender = Preview.renderWorkspace.bind(Preview);
  Preview.renderWorkspace = (workspace, rootId, environmentSettings) => {
    const normalized = normalizeEnvironmentSettings(environmentSettings);
    if (normalized?.preset !== 'snow' || !normalized.enabled) return previousRender(workspace, rootId, normalized);

    // First build terrain without an environment overlay so scene-capture adapters
    // and current-main terrain changes remain authoritative.
    const merged = previousRender(workspace, rootId, null);
    const scenes = [...(window.__wildernessLabScenes || [])];
    const changed = [];
    for (const scene of scenes) {
      scene.traverse?.(node => {
        if (!node?.isMesh) return;
        const materialKey = node.material?.userData?.terrainKey || node.userData?.terrainKey;
        if (!LAND_TARGETS.has(materialKey)) return;
        changed.push({ node, materialKey, materialUserKey: node.material?.userData?.terrainKey, nodeUserKey: node.userData?.terrainKey });
        if (node.material?.userData) node.material.userData.terrainKey = '__western_avalanche_land__';
        node.userData.terrainKey = '__western_avalanche_land__';
      });
    }
    try {
      Preview.rebuildWinter({ ...normalized, target: '__western_avalanche_land__' });
    } finally {
      for (const item of changed) {
        if (item.node.material?.userData) item.node.material.userData.terrainKey = item.materialUserKey;
        item.node.userData.terrainKey = item.nodeUserKey;
      }
    }
    return merged;
  };

  function applySlushPresetDefaults() {
    const preset = document.getElementById('winterPreset');
    if (!preset || preset.__environmentDefaultsInstalled) return;
    preset.__environmentDefaultsInstalled = true;
    preset.addEventListener('change', () => {
      const opacity = document.getElementById('winterOpacity');
      const opacityNum = document.getElementById('winterOpacityNum');
      const height = document.getElementById('winterHeight');
      const heightNum = document.getElementById('winterHeightNum');
      const target = document.getElementById('winterTarget');
      if (preset.value === 'slush') {
        if (opacity) opacity.value = '0.58';
        if (opacityNum) opacityNum.value = '0.58';
        if (height) height.value = '0.18';
        if (heightNum) heightNum.value = '0.18';
        if (target) target.disabled = false;
      } else {
        if (opacity) opacity.value = '1';
        if (opacityNum) opacityNum.value = '1';
        if (height && Number(height.value) < 0.35) height.value = '0.55';
        if (heightNum && Number(heightNum.value) < 0.35) heightNum.value = '0.55';
        if (target) target.disabled = true;
      }
    });
  }

  relabelEnvironmentUi();
  applySlushPresetDefaults();
  console.log('[WildernessLab] environment refresh: Coldmuck slush + Western avalanche snowpack semantics active.');
})();