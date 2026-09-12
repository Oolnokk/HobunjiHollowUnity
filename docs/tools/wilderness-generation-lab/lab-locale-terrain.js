(() => {
  'use strict';

  const Generator = window.WildernessMapGenerator;
  const Placement = window.LocaleTerrainPlacement;
  const Preview = window.WildernessLabPreview;
  const THREE = window.THREE;
  const TerrainPreview = window.TerrainPreview;
  if (!Generator || !Placement || !Preview || !THREE || !TerrainPreview || window.__wildernessLabLocaleTerrainInstalled) return;
  window.__wildernessLabLocaleTerrainInstalled = true;

  const WORKSPACE_KEY = 'hobunji_locale_editor_workspace_v1';
  const state = {
    enabled: true,
    selectedId: '',
    editorLocales: [],
    importedLocales: [],
    showRejected: true,
  }; // Lab-only locale source state injected into generator settings on every preview run.

  let currentOverlay = null; // Active 3D diagnostic group removed before each regenerated preview.
  let renderToken = 0; // Monotonic overlay token prevents stale delayed scene attachment after rapid regeneration.

  function terrainAware(locales) {
    return (locales || []).filter(locale => Placement.hasTerrainRules(locale));
  }

  function loadEditorLocales() {
    try {
      const parsed = JSON.parse(localStorage.getItem(WORKSPACE_KEY) || 'null'); // Locale Editor autosave is same-origin with the wilderness lab.
      state.editorLocales = terrainAware(Array.isArray(parsed?.locales) ? parsed.locales : []);
    } catch (error) {
      state.editorLocales = [];
      console.warn('[WildernessLab] terrain locale autosave parse failed:', error);
    }
    refreshSelect();
  }

  function allLocales() {
    const byId = new Map(); // Imported files override same-id editor autosaves so one-off experiments are predictable.
    for (const locale of state.editorLocales) byId.set(locale.id, locale);
    for (const locale of state.importedLocales) byId.set(locale.id, locale);
    return [...byId.values()];
  }

  function selectedLocale() {
    return allLocales().find(locale => locale.id === state.selectedId) || null;
  }

  function requestGenerate() {
    const button = document.getElementById('generateBtn'); // Existing Generate button owns status/error handling and every downstream preview adapter.
    if (button && !button.disabled) button.click();
  }

  function refreshSelect() {
    const select = document.getElementById('localeTerrainSelect');
    if (!select) return;
    const locales = allLocales(); // Current editor/import locale list populates the user-facing source picker.
    const previous = state.selectedId;
    select.innerHTML = '<option value="">None</option>' + locales.map(locale => `<option value="${escapeHtml(locale.id)}">${escapeHtml(locale.name || locale.id)} · ${escapeHtml(locale.id)}</option>`).join('');
    if (locales.some(locale => locale.id === previous)) select.value = previous;
    else {
      state.selectedId = locales[0]?.id || '';
      select.value = state.selectedId;
    }
    updateSourceStatus();
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function updateSourceStatus(extra = '') {
    const status = document.getElementById('localeTerrainSourceStatus');
    if (!status) return;
    const locale = selectedLocale(); // Selected definition summary helps mobile testing without opening devtools.
    const probes = Object.keys(locale?.terrainAnchors || {}).length;
    const embedded = Object.keys(locale?.embeddedTiles || {}).length;
    status.textContent = extra || (locale ? `${probes} probe(s) · ${embedded} embedded cell(s)` : 'No terrain-aware locale selected.');
  }

  function installControls() {
    if (document.getElementById('localeTerrainControls')) return;
    const sidebar = document.querySelector('aside'); // Wilderness Lab has one settings sidebar; append a self-contained authoring card without changing its monolithic HTML.
    if (!sidebar) return;
    const panel = document.createElement('details');
    panel.id = 'localeTerrainControls';
    panel.open = true;
    panel.innerHTML = `
      <summary>Locale terrain matching</summary>
      <div style="padding:8px 10px 10px">
        <label style="display:flex;gap:6px;align-items:center"><input id="localeTerrainEnabled" type="checkbox" checked style="width:auto"> Test selected terrain-aware locale</label>
        <label style="display:block;margin-top:6px">Locale source</label>
        <select id="localeTerrainSelect" style="width:100%"></select>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
          <button id="localeTerrainRefresh" class="secondary" type="button">Refresh editor autosave</button>
          <button id="localeTerrainImport" class="secondary" type="button">Import locale JSON</button>
          <input id="localeTerrainFile" type="file" accept=".json,application/json" hidden>
        </div>
        <label style="display:flex;gap:6px;align-items:center;margin-top:6px"><input id="localeTerrainRejected" type="checkbox" checked style="width:auto"> Show rejected near-miss probes</label>
        <div id="localeTerrainSourceStatus" class="help" style="margin-top:6px">No terrain-aware locale selected.</div>
        <div class="help" style="margin-top:5px">Cyan = required/preferred probe · red = avoid/rejected · magenta = embedded/carved footprint · amber = selected generated footprint.</div>
      </div>`;
    sidebar.appendChild(panel);

    document.getElementById('localeTerrainEnabled').addEventListener('change', event => { state.enabled = !!event.target.checked; requestGenerate(); });
    document.getElementById('localeTerrainRejected').addEventListener('change', event => { state.showRejected = !!event.target.checked; requestGenerate(); });
    document.getElementById('localeTerrainSelect').addEventListener('change', event => { state.selectedId = event.target.value; updateSourceStatus(); requestGenerate(); });
    document.getElementById('localeTerrainRefresh').addEventListener('click', () => { loadEditorLocales(); updateSourceStatus('Reloaded Locale Editor autosave.'); requestGenerate(); });
    document.getElementById('localeTerrainImport').addEventListener('click', () => document.getElementById('localeTerrainFile').click());
    document.getElementById('localeTerrainFile').addEventListener('change', async event => {
      const file = event.target.files?.[0]; // Imported standalone locale/workspace is kept in-memory for this Lab tab only.
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        const candidates = Array.isArray(parsed?.locales) ? parsed.locales : [parsed]; // Accept both one locale JSON and Locale Editor workspace JSON.
        const imported = terrainAware(candidates);
        if (!imported.length) throw new Error('No terrain-aware locale found in that JSON.');
        for (const locale of imported) {
          const existingIndex = state.importedLocales.findIndex(item => item.id === locale.id); // Same-id imports replace the earlier in-memory version.
          if (existingIndex >= 0) state.importedLocales.splice(existingIndex, 1, locale);
          else state.importedLocales.push(locale);
        }
        state.selectedId = imported[0].id;
        refreshSelect();
        updateSourceStatus(`Imported ${imported.length} terrain-aware locale(s).`);
        requestGenerate();
      } catch (error) {
        updateSourceStatus(`Import failed: ${error.message}`);
      } finally {
        event.target.value = '';
      }
    });
    loadEditorLocales();
  }

  const originalGenerateWorkspace = Generator.generateWorkspace.bind(Generator); // Current generator already includes LocaleTerrainPlacement; this Lab wrapper only injects the selected definition.
  Generator.generateWorkspace = function localeTerrainLabGenerateWorkspace(seed, settings = {}) {
    const locale = state.enabled ? selectedLocale() : null; // Selected locale is appended without disturbing locales supplied by Advanced JSON or live recipe routing.
    if (!locale) return originalGenerateWorkspace(seed, settings);
    const existing = Array.isArray(settings.locales) ? settings.locales : [];
    const locales = existing.some(item => item?.id === locale.id) ? existing : [...existing, locale];
    return originalGenerateWorkspace(seed, { ...settings, locales });
  };

  function disposeOverlay() {
    renderToken++;
    if (!currentOverlay) return;
    currentOverlay.parent?.remove(currentOverlay);
    const geometries = new Set(); // Shared box/edge geometries are disposed only once per overlay.
    const materials = new Set();
    currentOverlay.traverse(node => {
      if (node.geometry) geometries.add(node.geometry);
      if (Array.isArray(node.material)) node.material.forEach(material => materials.add(material));
      else if (node.material) materials.add(node.material);
    });
    geometries.forEach(geometry => geometry.dispose?.());
    materials.forEach(material => material.dispose?.());
    currentOverlay = null;
  }

  function surfaceY(merged, c, r) {
    const tile = merged?.tiles?.get(`${clamp(Math.floor(c), 0, merged.cols - 1)},${clamp(Math.floor(r), 0, merged.rows - 1)}`); // Merged preview tile yields the same elevation the base mesh used.
    let y = TerrainPreview.NORMAL_TOP || 0;
    if (tile?.type === 'ramp') y += (Number(tile.rampElevation) || 0) * TerrainPreview.PLATEAU_UNIT;
    else y += (Number(tile?.elevTier) || 0) * TerrainPreview.PLATEAU_UNIT;
    y += TerrainPreview.sampleVisualHeight?.(merged.visualHeights, c, r, merged.cols, merged.rows) || 0;
    return y;
  }

  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

  function marker(group, merged, c, r, color, height = 0.18, opacity = 0.9, yOffset = 0.08, scale = 0.72) {
    if (!Number.isFinite(c) || !Number.isFinite(r)) return;
    const geometry = new THREE.BoxGeometry(scale, height, scale); // Simple raised tile marker stays readable from wilderness-scale camera distances.
    const material = new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthTest: false });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(c + 0.5, surfaceY(merged, c + 0.5, r + 0.5) + yOffset + height * 0.5, r + 0.5);
    mesh.renderOrder = 40;
    group.add(mesh);
  }

  function buildOverlay(workspace, merged) {
    const group = new THREE.Group(); // One removable parent contains all selected/rejected terrain-locale diagnostics.
    group.name = 'wilderness_lab_locale_terrain_overlay';
    const diagnostics = workspace?.localeTerrainDiagnostics || [];
    for (const diagnostic of diagnostics) {
      if (diagnostic.status === 'placed' && diagnostic.selected) {
        for (const cell of diagnostic.selected.footprint || []) marker(group, merged, cell.c, cell.r, 0xf5a623, 0.10, 0.55, 0.05, 0.82);
        for (const probe of diagnostic.selected.probes || []) {
          const color = probe.rule?.strength === 'avoid' ? 0xfb7185 : probe.rule?.strength === 'preferred' ? 0xfacc15 : 0x55e6ff;
          marker(group, merged, probe.c, probe.r, color, 0.25, 0.96, 0.11, 0.56);
        }
        for (const cell of diagnostic.selected.embedded || []) marker(group, merged, cell.c, cell.r, 0xd56bff, 0.34, 0.94, 0.14, 0.64);
      }
      if (state.showRejected) {
        for (const rejected of (diagnostic.rejected || []).slice(0, 32)) {
          const point = rejected.failAt || { c: rejected.anchorC, r: rejected.anchorR }; // Failure cell is more informative than candidate origin when available.
          marker(group, merged, point.c, point.r, 0xfb7185, 0.11, 0.26, 0.04, 0.30);
        }
      }
    }
    return group;
  }

  function attachOverlay(group, token, attempts = 0) {
    if (token !== renderToken) return;
    const scene = [...(window.__wildernessLabScenes || [])][0]; // Lab object-marker system exposes captured Three scenes through this shared authoring hook.
    if (!scene) {
      if (attempts < 20) requestAnimationFrame(() => attachOverlay(group, token, attempts + 1));
      return;
    }
    currentOverlay = group;
    scene.add(group);
  }

  function updateDiagnosticStatus(workspace) {
    const diagnostic = (workspace?.localeTerrainDiagnostics || [])[0]; // UI currently previews one selected locale at a time.
    if (!diagnostic) { updateSourceStatus(); return; }
    if (diagnostic.status === 'placed') updateSourceStatus(`Placed after ${diagnostic.tested.toLocaleString()} candidates · ${diagnostic.valid} valid · floor tier ${diagnostic.selected.floorTier}.`);
    else updateSourceStatus(`No placement · ${diagnostic.tested?.toLocaleString?.() || 0} candidates · ${diagnostic.reason || 'no match'}.`);
  }

  function draw2dOverlay(workspace, merged) {
    const canvas = document.getElementById('view2d');
    if (!canvas || !merged) return;
    const context = canvas.getContext('2d'); // Existing 2D terrain renderer has already filled the canvas; diagnostic marks are painted last.
    const sx = canvas.width / merged.cols;
    const sy = canvas.height / merged.rows;
    const square = (c, r, color, alpha = 1, inset = 0.18) => {
      context.globalAlpha = alpha;
      context.fillStyle = color;
      context.fillRect((c + inset) * sx, (r + inset) * sy, Math.max(1, (1 - inset * 2) * sx), Math.max(1, (1 - inset * 2) * sy));
      context.globalAlpha = 1;
    };
    for (const diagnostic of workspace?.localeTerrainDiagnostics || []) {
      if (diagnostic.status === 'placed' && diagnostic.selected) {
        for (const cell of diagnostic.selected.footprint || []) square(cell.c, cell.r, '#f5a623', 0.42, 0.09);
        for (const probe of diagnostic.selected.probes || []) square(probe.c, probe.r, probe.rule?.strength === 'avoid' ? '#fb7185' : probe.rule?.strength === 'preferred' ? '#facc15' : '#55e6ff', 0.92, 0.25);
        for (const cell of diagnostic.selected.embedded || []) square(cell.c, cell.r, '#d56bff', 0.88, 0.18);
      }
      if (state.showRejected) for (const rejected of (diagnostic.rejected || []).slice(0, 32)) {
        const point = rejected.failAt || { c: rejected.anchorC, r: rejected.anchorR };
        square(point.c, point.r, '#fb7185', 0.26, 0.34);
      }
    }
  }

  let lastWorkspace = null; // Latest rendered workspace is reused when the Lab toggles between 2D and 3D without regenerating.
  const originalRenderWorkspace = Preview.renderWorkspace.bind(Preview);
  Preview.renderWorkspace = (workspace, rootId, winterSettings) => {
    disposeOverlay();
    lastWorkspace = workspace;
    const merged = originalRenderWorkspace(workspace, rootId, winterSettings);
    const group = buildOverlay(workspace, merged);
    const token = renderToken;
    attachOverlay(group, token);
    updateDiagnosticStatus(workspace);
    return merged;
  };

  const originalDraw2d = Preview.draw2d.bind(Preview);
  Preview.draw2d = () => {
    originalDraw2d();
    draw2dOverlay(lastWorkspace, Preview.getMerged?.());
  };

  installControls();
  console.log('[WildernessLab] terrain-aware locale source + diagnostics loaded');
})();
