// Map Editor — per-building subtle elevation overrides.
//
// Each building can own an exact-footprint visual-height stamp plus an optional
// outward radius. The stamp is materialized into map.visualHeights so the live
// game consumes the same data as the editor's existing Subtle elevation brush.
(() => {
  'use strict';

  if (!/\/tools\/map-editor(?:\/index\.html)?\/?$/.test(location.pathname)) return;

  const WORKSPACE_KEY = 'hobunji_map_editor_workspace_v1'; // Persists override metadata and the rebuilt runtime visual heights.
  const RADIUS_ZERO_MIGRATION_KEY = 'hobunji_map_editor_building_elevation_level1_radius0_v2'; // Set only by the briefly-published radius-0 preset.
  const RADIUS_ONE_RESTORE_KEY = 'hobunji_map_editor_building_elevation_radius1_restore_v3'; // One-time repair for browsers that opened that radius-0 build.
  const CORE_URL = '../../js/building-subtle-elevation.js'; // Loads the pure footprint/height math used by this controller and tests.
  const PANEL_ID = 'bldgSubtleElevationPanel'; // Identifies the injected Building inspector controls across native rerenders.
  const footprintLoads = new Map(); // Deduplicates piece JSON requests while several UI events target one building.
  let core = null; // Set once BuildingSubtleElevation is loaded; all rebuilds route through it.
  let observer = null; // Watches the native Building list because renderBuildingPanel replaces its selection markup.
  let basePaintActive = false; // True while the native Subtle elevation brush is editing the preserved hand-painted base layer.
  let syntheticSave = false; // Prevents our refresh click from recursively scheduling another rebuild.
  let renderQueued = false; // Coalesces MutationObserver bursts into one injected-panel refresh.

  function workspace() {
    try { return window._mapEditorBridge?.getWorkspace?.() || null; }
    catch (_) { return null; }
  }

  function activeMap() {
    const ws = workspace();
    if (!ws || !Array.isArray(ws.maps)) return null;
    return ws.maps.find(map => String(map?.id || '') === String(ws.activeId || '')) || ws.maps[0] || null;
  }

  function selectedBuildingId() {
    return document.querySelector('#buildingList [data-bid].sel')?.dataset.bid || '';
  }

  function selectedBuilding() {
    const map = activeMap();
    const id = selectedBuildingId();
    return (Array.isArray(map?.buildings) ? map.buildings : []).find(building => String(building?.id || '') === id) || null;
  }

  function persistWorkspace() {
    const ws = workspace();
    if (!ws) return false;
    try {
      localStorage.setItem(WORKSPACE_KEY, JSON.stringify(ws));
      return true;
    } catch (error) {
      console.warn('Building subtle elevation: workspace save failed', error);
      return false;
    }
  }

  function refreshJsonPreview() {
    const map = activeMap();
    const preview = document.getElementById('jsonPreview');
    if (!map || !preview) return;
    try {
      const runtimeMap = core?.materializeMapForRuntime?.(map) || map;
      const out = {
        ...runtimeMap,
        tiles: Object.keys(runtimeMap.tiles || {}).map(key => {
          const [c, r] = key.split(',').map(Number);
          return { c, r, ...runtimeMap.tiles[key] };
        }),
      };
      preview.value = JSON.stringify(out, null, 2);
    } catch (_) {}
  }

  function requestNativeRefresh() {
    refreshJsonPreview();
    const save = document.getElementById('saveBldgBtn');
    if (!save || !selectedBuilding()) {
      window.dispatchEvent(new Event('resize'));
      return;
    }
    syntheticSave = true;
    try { save.click(); }
    finally { syntheticSave = false; }
  }

  function restoreRadiusOneAfterRadiusZeroPreset() {
    if (!core) return false;
    try {
      if (localStorage.getItem(RADIUS_ONE_RESTORE_KEY) === '1') return false;
      // Do not overwrite intentional per-building edits on browsers that never
      // loaded the reverted radius-0 preset. Only repair workspaces carrying
      // that preset's own migration marker.
      if (localStorage.getItem(RADIUS_ZERO_MIGRATION_KEY) !== '1') {
        localStorage.setItem(RADIUS_ONE_RESTORE_KEY, '1');
        return false;
      }
    } catch (_) {}

    const ws = workspace();
    if (!Array.isArray(ws?.maps)) return false;
    let changed = false;
    for (const map of ws.maps) {
      for (const building of (Array.isArray(map?.buildings) ? map.buildings : [])) {
        const existing = core.normalizeOverride(building.subtleElevationOverride);
        building.subtleElevationOverride = { ...existing, radius: 1 };
        changed = true;
      }
      if ((map.buildings || []).length) core.rebuildMapVisualHeights(map);
    }
    if (changed) persistWorkspace();
    try { localStorage.setItem(RADIUS_ONE_RESTORE_KEY, '1'); } catch (_) {}
    return changed;
  }

  function ensureDefaultsForWorkspace() {
    const ws = workspace();
    if (!core || !Array.isArray(ws?.maps)) return false;
    let changed = false;
    for (const map of ws.maps) {
      if (core.ensureBuildingDefaults(map)) changed = true;
      if ((map.buildings || []).some(building => building.subtleElevationOverride?.enabled)) {
        core.rebuildMapVisualHeights(map);
        changed = true;
      }
    }
    if (changed) persistWorkspace();
    return changed;
  }

  async function ensureFootprintShape(building) {
    if (!core || !building) return null;
    const ownerMap = (workspace()?.maps || []).find(map => (map.buildings || []).includes(building)) || activeMap(); // Rebuilds the map that actually owns this async-loaded building.
    if (Array.isArray(building.footprintShape?.cells) && building.footprintShape.cells.length) return building.footprintShape;
    if (!building.pieceFile) return null;
    const cacheKey = `${building.id || ''}|${building.pieceFile}`;
    if (footprintLoads.has(cacheKey)) return footprintLoads.get(cacheKey);

    const promise = fetch('../../' + String(building.pieceFile).replace(/^\/+/, ''), { cache: 'no-store' })
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then(pieceData => {
        const shape = core.deriveFootprintShape(pieceData);
        if (shape) {
          building.footprintShape = shape;
          building.footprintW = shape.bboxW;
          building.footprintD = shape.bboxD;
          core.rebuildMapVisualHeights(ownerMap);
          persistWorkspace();
        }
        return shape;
      })
      .catch(error => {
        console.warn(`Building subtle elevation: footprint load failed for ${building.pieceFile}`, error);
        return null;
      })
      .finally(() => footprintLoads.delete(cacheKey));
    footprintLoads.set(cacheKey, promise);
    return promise;
  }

  function rebuildActive({ refresh = true } = {}) {
    const map = activeMap();
    if (!core || !map) return { activeOverrides: 0, affectedCells: 0 };
    const stats = core.rebuildMapVisualHeights(map);
    persistWorkspace();
    updatePanelStats(stats);
    if (refresh) requestNativeRefresh();
    return stats;
  }

  function updatePanelStats() {
    const line = document.querySelector(`#${PANEL_ID} [data-bse-stats]`);
    const building = selectedBuilding();
    if (!line || !building || !core) return;
    const override = core.normalizeOverride(building.subtleElevationOverride);
    const exactCount = core.worldFootprintCells(building).length;
    const affected = override.enabled ? core.affectedCells(building, activeMap()).length : 0;
    const shapeMode = Array.isArray(building.footprintShape?.cells) ? 'exact authored footprint' : 'rectangle fallback';
    line.textContent = override.enabled
      ? `${exactCount} footprint tile${exactCount === 1 ? '' : 's'} · ${affected} affected with radius · ${shapeMode}`
      : `Off · ${shapeMode}`;
  }

  function applyControls() {
    const building = selectedBuilding();
    const panel = document.getElementById(PANEL_ID);
    if (!building || !panel || !core) return;
    building.subtleElevationOverride = core.normalizeOverride({
      enabled: panel.querySelector('[data-bse-enabled]')?.checked,
      value: panel.querySelector('[data-bse-value]')?.value,
      radius: panel.querySelector('[data-bse-radius]')?.value,
    });
    rebuildActive({ refresh: false });
    ensureFootprintShape(building).then(() => {
      rebuildActive({ refresh: false });
      renderPanel();
      requestNativeRefresh();
    });
  }

  function installPanelStyles() {
    if (document.getElementById('mapEditorBuildingElevationStyles')) return;
    const style = document.createElement('style');
    style.id = 'mapEditorBuildingElevationStyles';
    style.textContent = `
#${PANEL_ID}{margin:0 0 8px;padding:8px;border:1px solid rgba(245,158,11,.24);border-radius:8px;background:rgba(245,158,11,.06)}
#${PANEL_ID} .bseHead{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px}
#${PANEL_ID} .bseToggle{display:flex;align-items:center;gap:7px;margin:0;color:var(--text,#edf5ff);font-size:11px;cursor:pointer}
#${PANEL_ID} .bseToggle input{width:auto}
#${PANEL_ID} .bseGrid{display:grid;grid-template-columns:1fr 1fr;gap:6px}
#${PANEL_ID} .bseStats{font-size:10px;line-height:1.35;color:var(--muted,#9fb4cf);margin-top:5px}
#${PANEL_ID} .bseDebug{padding:2px 7px;font-size:10px}
`;
    document.head.appendChild(style);
  }

  function copyDebug() {
    const map = activeMap();
    if (!map || !core) return;
    const text = JSON.stringify(core.debugSnapshot(map), null, 2);
    navigator.clipboard?.writeText(text).then(() => {
      const line = document.querySelector(`#${PANEL_ID} [data-bse-stats]`);
      if (line) line.textContent = 'Debug snapshot copied.';
    }).catch(() => console.log(text));
  }

  function renderPanel() {
    if (!core) return;
    installPanelStyles();
    const nativePanel = document.getElementById('selectedBuildingPanel');
    const building = selectedBuilding();
    let panel = document.getElementById(PANEL_ID);
    if (!nativePanel || !building || nativePanel.style.display === 'none') {
      panel?.remove();
      return;
    }

    building.subtleElevationOverride = core.normalizeOverride(building.subtleElevationOverride);
    const override = building.subtleElevationOverride;
    if (!panel || panel.parentElement !== nativePanel) {
      panel?.remove();
      panel = document.createElement('div');
      panel.id = PANEL_ID;
      const saveRow = document.getElementById('saveBldgBtn')?.parentElement;
      if (saveRow?.parentElement === nativePanel) nativePanel.insertBefore(panel, saveRow);
      else nativePanel.appendChild(panel);
    }

    panel.innerHTML = `
      <div class="bseHead">
        <label class="bseToggle"><input type="checkbox" data-bse-enabled ${override.enabled ? 'checked' : ''}> Subtle elevation override</label>
        <button type="button" class="sec bseDebug" data-bse-debug>Copy debug</button>
      </div>
      <div class="bseGrid">
        <div><label>Level (-1 to 1)</label><input type="number" min="-1" max="1" step="0.05" data-bse-value value="${override.value}"></div>
        <div><label>Radius (tiles)</label><input type="number" min="0" max="64" step="1" data-bse-radius value="${override.radius}"></div>
      </div>
      <p class="muted" style="margin-top:5px">Matches painting Subtle elevation over this building's exact footprint. Each radius step grows one tile farther around it, including diagonals. The building remains rigid and level.</p>
      <div class="bseStats" data-bse-stats></div>`;

    panel.querySelector('[data-bse-enabled]').addEventListener('change', applyControls);
    panel.querySelector('[data-bse-value]').addEventListener('change', applyControls);
    panel.querySelector('[data-bse-radius]').addEventListener('change', applyControls);
    panel.querySelector('[data-bse-debug]').addEventListener('click', copyDebug);
    updatePanelStats();
    ensureFootprintShape(building).then(() => { updatePanelStats(); });
  }

  function queueRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      renderPanel();
    });
  }

  function isVisualHeightMode() {
    return !!document.querySelector('#modeBar [data-mode="visual-height"].act');
  }

  function beginNativeHeightPaint() {
    const map = activeMap();
    if (!core || !map || !isVisualHeightMode()) return;
    basePaintActive = core.beginBaseEdit(map);
  }

  function finishNativeHeightPaint() {
    if (!basePaintActive || !core) return;
    basePaintActive = false;
    setTimeout(() => {
      const map = activeMap();
      if (!map) return;
      core.endBaseEdit(map);
      persistWorkspace();
      updatePanelStats();
      requestNativeRefresh();
    }, 0);
  }

  function installEventHooks() {
    const canvas = document.getElementById('canvas2d');
    canvas?.addEventListener('pointerdown', beginNativeHeightPaint, true);
    canvas?.addEventListener('pointerup', () => {
      finishNativeHeightPaint();
      if (document.querySelector('#modeBar [data-mode="building"].act')) {
        setTimeout(() => rebuildActive(), 0);
      }
    });
    canvas?.addEventListener('pointercancel', finishNativeHeightPaint);

    document.getElementById('saveBldgBtn')?.addEventListener('click', () => {
      if (syntheticSave) return;
      setTimeout(() => {
        const building = selectedBuilding();
        if (building) ensureFootprintShape(building).then(() => rebuildActive({ refresh: false }));
        else rebuildActive({ refresh: false });
        queueRender();
      }, 0);
    });
    document.getElementById('delBldgBtn')?.addEventListener('click', () => {
      setTimeout(() => { rebuildActive(); queueRender(); }, 0);
    });

    document.getElementById('buildingList')?.addEventListener('click', () => setTimeout(queueRender, 0));
  }

  function installObserver() {
    if (observer) return;
    const root = document.getElementById('buildingList'); // Native list rerenders cover selection/add/remove without observing our injected panel and self-triggering forever.
    if (!root) return;
    observer = new MutationObserver(queueRender);
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  }

  function exposeDebugApi() {
    window.MapEditorBuildingElevation = {
      rebuildActiveMap: () => rebuildActive(),
      rebuildAllMaps: () => {
        const ws = workspace();
        const results = [];
        for (const map of (ws?.maps || [])) results.push({ mapId: map.id, ...core.rebuildMapVisualHeights(map) });
        persistWorkspace();
        requestNativeRefresh();
        return results;
      },
      debugSnapshot: () => core.debugSnapshot(activeMap()),
      materializeActiveMap: () => core.materializeMapForRuntime(activeMap()),
    };
  }

  function install() {
    if (!window._mapEditorBridge?.getWorkspace || !document.getElementById('buildingsSection')) {
      setTimeout(install, 30);
      return;
    }
    core = window.BuildingSubtleElevation;
    if (!core) {
      const existing = document.querySelector('script[data-building-subtle-elevation-core]');
      if (existing) { existing.addEventListener('load', install, { once: true }); return; }
      const script = document.createElement('script');
      script.src = CORE_URL;
      script.dataset.buildingSubtleElevationCore = '1';
      script.addEventListener('load', install, { once: true });
      document.head.appendChild(script);
      return;
    }

    if (window.MapEditorBuildingElevation) return;
    restoreRadiusOneAfterRadiusZeroPreset();
    ensureDefaultsForWorkspace();
    installEventHooks();
    installObserver();
    exposeDebugApi();
    renderPanel();
  }

  install();
})();
