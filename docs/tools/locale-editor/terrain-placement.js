// Locale Editor terrain-aware placement extension.
//
// The main Locale Editor intentionally stays untouched: this sidecar keeps
// terrain probes/embedded cells in the editor workspace's `placement` object
// (which the existing sanitizer already preserves), overlays those rules into
// exported locale JSON, and provides a focused mini-grid for authoring them.
(() => {
  'use strict';

  if (window.__localeEditorTerrainPlacementInstalled) return;
  window.__localeEditorTerrainPlacementInstalled = true;

  const WORKSPACE_KEY = 'hobunji_locale_editor_workspace_v1';
  const RULE_STORE_KEY = 'hobunji_locale_editor_terrain_rules_v1';
  const TERRAIN_OPTIONS = [
    ['any', 'Any terrain'],
    ['water', 'Any water'],
    ['river', 'River'],
    ['stream', 'Stream'],
    ['plateau', 'Plateau mass'],
    ['plateauCliff', 'Internal plateau cliff edge'],
    ['boundaryCliff', 'Boundary cliff edge'],
    ['ground', 'Ground level'],
    ['free', 'Free/open terrain'],
  ];
  const TILE_COLORS = {
    grass: '#4a7c43', weeds: '#6b8c3a', tilled: '#7a5230', trench: '#3d2c1e',
    raised: '#a8835a', paddy: '#3f7fae', rock: '#8a8f98', shrub: '#2f6f3f',
    path: '#b8956a', river: '#2f6fb8', stream: '#4f9bd9', waterfall: '#bfe9f7', ramp: '#c2b280',
  };

  let mode = 'probe'; // Active terrain-rule paint mode consumed by mini-grid pointer handlers.
  let cellSize = 12; // Authoring-grid zoom in CSS pixels; adjustable for large locales/mobile.
  let painting = false; // Pointer-drag paint state used by the mini-grid.
  let lastPaintKey = ''; // Prevents repeated bridge/store writes while dragging inside one cell.
  let lastActiveId = ''; // Polling sentinel used to refresh when the main editor switches locales.
  let nativeStorageSetItem = null; // Original Storage#setItem used to avoid recursion in workspace merge interception.
  let store = loadRuleStore(); // Persistent sidecar rule map keyed by locale id.

  const brush = {
    terrain: 'plateauCliff',
    strength: 'required',
    weight: 1,
    facing: 'any',
    height: { mode: 'any', min: null, max: null },
    carveToLocaleFloor: true,
  }; // Shared brush state; embedded mode ignores strength/weight while probe mode ignores carveToLocaleFloor.

  function clone(value) { return JSON.parse(JSON.stringify(value)); }

  function loadRuleStore() {
    try {
      const parsed = JSON.parse(localStorage.getItem(RULE_STORE_KEY) || 'null'); // Sidecar store survives edits made before the main editor reloads its workspace copy.
      return parsed && typeof parsed === 'object' && parsed.byLocale ? parsed : { schema: 'hobunji_locale_terrain_rules.v1', byLocale: {} };
    } catch (_) {
      return { schema: 'hobunji_locale_terrain_rules.v1', byLocale: {} };
    }
  }

  function saveRuleStore() {
    try { localStorage.setItem(RULE_STORE_KEY, JSON.stringify(store)); } catch (error) { debug(`rule store save failed: ${error.message}`); }
  }

  function bridge() { return window._localeEditorBridge || null; }

  function workspaceSnapshot() {
    try { return bridge()?.getWorkspace?.() || null; } catch (_) { return null; }
  }

  function activeLocale() {
    const workspace = workspaceSnapshot(); // Main editor bridge remains authoritative for identity, footprint, objects, and placement settings.
    if (!workspace) return null;
    return workspace.locales?.find(locale => locale.id === workspace.activeId) || null;
  }

  function normalizeHeight(raw) {
    const modeValue = ['any', 'range', 'relativeRange'].includes(raw?.mode) ? raw.mode : 'any'; // Height mode mirrors the generator-side terrain matcher vocabulary.
    const min = raw?.min == null || raw?.min === '' ? null : Number(raw.min); // Optional range lower bound.
    const max = raw?.max == null || raw?.max === '' ? null : Number(raw.max); // Optional range upper bound.
    return { mode: modeValue, min: Number.isFinite(min) ? min : null, max: Number.isFinite(max) ? max : null };
  }

  function sanitizeProbe(raw) {
    return {
      terrain: TERRAIN_OPTIONS.some(([id]) => id === raw?.terrain) ? raw.terrain : 'plateauCliff',
      strength: ['required', 'preferred', 'avoid'].includes(raw?.strength) ? raw.strength : 'required',
      weight: Math.max(0.1, Number(raw?.weight) || 1),
      facing: ['any', 'north', 'east', 'south', 'west'].includes(raw?.facing) ? raw.facing : 'any',
      height: normalizeHeight(raw?.height),
    }; // Safe probe record written to merged locale JSON.
  }

  function sanitizeEmbedded(raw) {
    return {
      terrain: TERRAIN_OPTIONS.some(([id]) => id === raw?.terrain) ? raw.terrain : 'plateau',
      facing: ['any', 'north', 'east', 'south', 'west'].includes(raw?.facing) ? raw.facing : 'any',
      height: normalizeHeight(raw?.height),
      carveToLocaleFloor: raw?.carveToLocaleFloor !== false,
    }; // Safe embedded record written to merged locale JSON.
  }

  function rulesFromLocale(locale) {
    const placement = locale?.placement || {}; // Placement object is the persistence-compatible home for editor-side terrain rules.
    return {
      terrainAnchors: clone(placement.terrainAnchors || locale?.terrainAnchors || {}),
      embeddedTiles: clone(placement.embeddedTiles || locale?.embeddedTiles || {}),
    };
  }

  function ensureRules(locale) {
    if (!locale?.id) return { terrainAnchors: {}, embeddedTiles: {} };
    if (!store.byLocale[locale.id]) store.byLocale[locale.id] = rulesFromLocale(locale);
    const rules = store.byLocale[locale.id]; // Active editable rule set is retained separately from the main editor's closed-over workspace object.
    rules.terrainAnchors = rules.terrainAnchors || {};
    rules.embeddedTiles = rules.embeddedTiles || {};
    return rules;
  }

  function mergedLocale(locale) {
    if (!locale) return null;
    const output = clone(locale); // Export/local-override copy gets both top-level runtime fields and nested editor-persistence fields.
    const rules = ensureRules(locale);
    output.terrainAnchors = clone(rules.terrainAnchors);
    output.embeddedTiles = clone(rules.embeddedTiles);
    output.placement = { ...(output.placement || {}), terrainAnchors: clone(rules.terrainAnchors), embeddedTiles: clone(rules.embeddedTiles) };
    return output;
  }

  function mergedWorkspace(workspace) {
    const output = clone(workspace || { locales: [] }); // Workspace merge is used by autosave interception and local-game override export.
    output.locales = (output.locales || []).map(mergedLocale);
    return output;
  }

  function patchWorkspaceStorage() {
    if (window.__localeEditorTerrainStoragePatched || typeof Storage === 'undefined') return;
    window.__localeEditorTerrainStoragePatched = true;
    nativeStorageSetItem = Storage.prototype.setItem; // Native setter is retained so our own merged write bypasses this interceptor.
    Storage.prototype.setItem = function localeTerrainStorageSetItem(key, value) {
      if (this === localStorage && key === WORKSPACE_KEY) {
        try {
          const parsed = JSON.parse(value); // Every future main-editor autosave is amended with the sidecar rules before hitting localStorage.
          value = JSON.stringify(mergedWorkspace(parsed));
        } catch (_) {}
      }
      return nativeStorageSetItem.call(this, key, value);
    };
  }

  function syncWorkspaceStorage() {
    const workspace = workspaceSnapshot(); // Current in-memory editor state is merged with terrain rules for the Lab and next page reload.
    if (!workspace) return;
    try {
      const merged = mergedWorkspace(workspace);
      (nativeStorageSetItem || Storage.prototype.setItem).call(localStorage, WORKSPACE_KEY, JSON.stringify(merged));
    } catch (error) { debug(`workspace terrain merge failed: ${error.message}`); }
  }

  function setRuleAt(locale, c, r) {
    if (!locale || c < 0 || r < 0 || c >= locale.cols || r >= locale.rows) return;
    const key = `${c},${r}`; // Grid key matches locale.tiles convention and generator compiler input.
    const rules = ensureRules(locale);
    if (mode === 'erase') {
      delete rules.terrainAnchors[key];
      delete rules.embeddedTiles[key];
    } else if (mode === 'probe') {
      rules.terrainAnchors[key] = sanitizeProbe(brush);
    } else if (mode === 'embedded') {
      if (!locale.tiles?.[key]) {
        debug(`embedded cells must already be painted footprint tiles (${key}); paint the locale footprint there first`);
        return;
      }
      rules.embeddedTiles[key] = sanitizeEmbedded(brush);
    }
    saveRuleStore();
    syncWorkspaceStorage();
    draw();
    updateStats();
  }

  function clearRules() {
    const locale = activeLocale();
    if (!locale || !confirm(`Clear every terrain probe and embedded cell from ${locale.name || locale.id}?`)) return;
    store.byLocale[locale.id] = { terrainAnchors: {}, embeddedTiles: {} };
    saveRuleStore();
    syncWorkspaceStorage();
    draw();
    updateStats();
    debug(`cleared terrain rules for ${locale.id}`);
  }

  function applyCavePreset() {
    brush.terrain = mode === 'embedded' ? 'plateau' : 'plateauCliff';
    brush.strength = 'required';
    brush.facing = 'any';
    brush.height = { mode: 'relativeRange', min: 1, max: 32 };
    brush.carveToLocaleFloor = true;
    syncControlsFromBrush();
    debug('cave preset: cliff probe / plateau embedded / host 1–32 tiers above locale floor');
  }

  function terrainOptionsHtml() {
    return TERRAIN_OPTIONS.map(([id, label]) => `<option value="${id}">${label}</option>`).join('');
  }

  function injectUi() {
    if (document.getElementById('localeTerrainAuthoringSection')) return;
    const validation = document.getElementById('validateList')?.closest('.section'); // Insert immediately before Validation in the existing Locale Editor sidebar.
    const host = validation?.parentElement || document.getElementById('sidebar-scroll');
    if (!host) return;
    const section = document.createElement('div');
    section.id = 'localeTerrainAuthoringSection';
    section.className = 'section';
    section.style.setProperty('--sec', '#55e6ff');
    section.style.setProperty('--secBg', 'rgba(85,230,255,.07)');
    section.innerHTML = `
      <div class="sect-head"><b>Terrain anchors / embedding</b><span class="sect-tag" id="localeTerrainStats">0 / 0</span></div>
      <div class="row" style="margin-bottom:6px">
        <button class="sec act" type="button" data-terrain-mode="probe">⌖ Probe</button>
        <button class="sec" type="button" data-terrain-mode="embedded">⬢ Embedded</button>
        <button class="sec" type="button" data-terrain-mode="erase">⌫ Rule erase</button>
        <button class="sec" type="button" id="localeTerrainCavePreset">Cave preset</button>
      </div>
      <div class="helpbox"><b>Probe</b> cells inspect wilderness without generating a locale tile. <b>Plateau cliff</b> means an internal generated plateau face; <b>Boundary cliff</b> means the wilderness perimeter escarpment. <b>Embedded</b> cells are still part of the locale footprint, but must overlap the selected host terrain; “carve” removes higher plateau volume down to the locale floor. The grid below mirrors the main footprint editor.</div>
      <div class="g2">
        <div><label>Terrain</label><select id="localeTerrainKind">${terrainOptionsHtml()}</select></div>
        <div><label>Facing</label><select id="localeTerrainFacing"><option value="any">Any</option><option value="north">North</option><option value="east">East</option><option value="south">South</option><option value="west">West</option></select></div>
      </div>
      <div class="g2" id="localeTerrainProbeControls" style="margin-top:6px">
        <div><label>Probe strength</label><select id="localeTerrainStrength"><option value="required">Required</option><option value="preferred">Preferred</option><option value="avoid">Avoid</option></select></div>
        <div><label>Preferred weight</label><input id="localeTerrainWeight" type="number" min="0.1" max="50" step="0.1" value="1"></div>
      </div>
      <label class="chk" id="localeTerrainCarveRow" style="display:none"><input id="localeTerrainCarve" type="checkbox" checked> Carve matched host down to locale floor</label>
      <div class="g3" style="margin-top:6px">
        <div><label>Height mode</label><select id="localeTerrainHeightMode"><option value="any">Any</option><option value="range">Absolute range</option><option value="relativeRange">Relative to locale floor</option></select></div>
        <div><label>Min tier</label><input id="localeTerrainMin" type="number" step="0.25" placeholder="—"></div>
        <div><label>Max tier</label><input id="localeTerrainMax" type="number" step="0.25" placeholder="—"></div>
      </div>
      <div class="row" style="margin-top:6px"><label style="margin:0">Grid zoom</label><input id="localeTerrainZoom" type="range" min="4" max="18" step="1" value="12" style="flex:1;min-width:100px"><button class="bad" type="button" id="localeTerrainClear">Clear terrain rules</button></div>
      <div id="localeTerrainGridWrap" style="margin-top:6px;max-height:360px;overflow:auto;border:1px solid rgba(255,255,255,.12);border-radius:8px;background:#081018;touch-action:pan-x pan-y"><canvas id="localeTerrainCanvas" style="display:block;touch-action:none"></canvas></div>
      <div class="muted" id="localeTerrainBrushSummary" style="margin-top:5px"></div>
      <div class="muted" id="localeTerrainDebug" style="margin-top:4px"></div>`;
    if (validation) host.insertBefore(section, validation); else host.appendChild(section);

    section.querySelectorAll('[data-terrain-mode]').forEach(button => button.addEventListener('click', () => {
      mode = button.dataset.terrainMode;
      section.querySelectorAll('[data-terrain-mode]').forEach(item => item.classList.toggle('act', item === button));
      updateModeControls();
      draw();
    }));
    document.getElementById('localeTerrainCavePreset').addEventListener('click', applyCavePreset);
    document.getElementById('localeTerrainKind').addEventListener('change', event => { brush.terrain = event.target.value; updateBrushSummary(); });
    document.getElementById('localeTerrainFacing').addEventListener('change', event => { brush.facing = event.target.value; updateBrushSummary(); });
    document.getElementById('localeTerrainStrength').addEventListener('change', event => { brush.strength = event.target.value; updateBrushSummary(); });
    document.getElementById('localeTerrainWeight').addEventListener('change', event => { brush.weight = Math.max(0.1, Number(event.target.value) || 1); updateBrushSummary(); });
    document.getElementById('localeTerrainCarve').addEventListener('change', event => { brush.carveToLocaleFloor = !!event.target.checked; updateBrushSummary(); });
    document.getElementById('localeTerrainHeightMode').addEventListener('change', event => { brush.height.mode = event.target.value; updateHeightInputs(); updateBrushSummary(); });
    document.getElementById('localeTerrainMin').addEventListener('change', event => { brush.height.min = event.target.value === '' ? null : Number(event.target.value); updateBrushSummary(); });
    document.getElementById('localeTerrainMax').addEventListener('change', event => { brush.height.max = event.target.value === '' ? null : Number(event.target.value); updateBrushSummary(); });
    document.getElementById('localeTerrainZoom').addEventListener('input', event => { cellSize = Number(event.target.value) || 12; draw(); });
    document.getElementById('localeTerrainClear').addEventListener('click', clearRules);

    const canvas = document.getElementById('localeTerrainCanvas'); // Mini-grid canvas handles only terrain-rule painting; main footprint canvas remains owned by the original editor.
    canvas.addEventListener('pointerdown', event => {
      if (event.button != null && event.button !== 0) return;
      painting = true;
      lastPaintKey = '';
      canvas.setPointerCapture?.(event.pointerId);
      paintFromEvent(event);
      event.preventDefault();
    });
    canvas.addEventListener('pointermove', event => {
      if (!painting) return;
      paintFromEvent(event);
      event.preventDefault();
    });
    const endPaint = event => {
      painting = false;
      lastPaintKey = '';
      canvas.releasePointerCapture?.(event.pointerId);
    };
    canvas.addEventListener('pointerup', endPaint);
    canvas.addEventListener('pointercancel', endPaint);

    syncControlsFromBrush();
    updateModeControls();
    installExportInterceptors();
    debug('terrain authoring extension ready');
  }

  function updateModeControls() {
    const probeControls = document.getElementById('localeTerrainProbeControls');
    const carveRow = document.getElementById('localeTerrainCarveRow');
    if (probeControls) probeControls.style.display = mode === 'probe' ? 'grid' : 'none';
    if (carveRow) carveRow.style.display = mode === 'embedded' ? 'flex' : 'none';
    updateBrushSummary();
  }

  function syncControlsFromBrush() {
    const set = (id, value) => { const element = document.getElementById(id); if (element) element.value = value ?? ''; };
    set('localeTerrainKind', brush.terrain);
    set('localeTerrainFacing', brush.facing);
    set('localeTerrainStrength', brush.strength);
    set('localeTerrainWeight', brush.weight);
    set('localeTerrainHeightMode', brush.height.mode);
    set('localeTerrainMin', brush.height.min);
    set('localeTerrainMax', brush.height.max);
    const carve = document.getElementById('localeTerrainCarve');
    if (carve) carve.checked = !!brush.carveToLocaleFloor;
    updateHeightInputs();
    updateBrushSummary();
  }

  function updateHeightInputs() {
    const disabled = brush.height.mode === 'any'; // Any-height mode disables numeric bounds to make the brush state obvious.
    const min = document.getElementById('localeTerrainMin');
    const max = document.getElementById('localeTerrainMax');
    if (min) min.disabled = disabled;
    if (max) max.disabled = disabled;
  }

  function updateBrushSummary() {
    const target = document.getElementById('localeTerrainBrushSummary');
    if (!target) return;
    if (mode === 'erase') { target.textContent = 'Erase removes probe/embedded metadata only; it leaves the main footprint tile intact.'; return; }
    const height = brush.height.mode === 'any' ? 'any height' : `${brush.height.mode === 'relativeRange' ? 'Δ' : ''}${brush.height.min ?? '−∞'}…${brush.height.max ?? '∞'} tiers`; // Human-readable brush summary mirrors exported numeric semantics.
    target.textContent = mode === 'embedded'
      ? `Embedded: ${brush.terrain}, facing ${brush.facing}, ${height}${brush.carveToLocaleFloor ? ', carve to locale floor' : ', preserve host height'}.`
      : `Probe: ${brush.strength} ${brush.terrain}, facing ${brush.facing}, ${height}${brush.strength === 'preferred' ? `, weight ${brush.weight}` : ''}.`;
  }

  function eventCell(event) {
    const canvas = document.getElementById('localeTerrainCanvas');
    const rect = canvas.getBoundingClientRect(); // CSS-scaled coordinates map directly into authoring cell size.
    return { c: Math.floor((event.clientX - rect.left) / cellSize), r: Math.floor((event.clientY - rect.top) / cellSize) };
  }

  function paintFromEvent(event) {
    const locale = activeLocale();
    if (!locale) return;
    const point = eventCell(event); // Current pointer cell is deduped during drags to avoid excessive localStorage writes.
    const key = `${point.c},${point.r}`;
    if (key === lastPaintKey) return;
    lastPaintKey = key;
    setRuleAt(locale, point.c, point.r);
  }

  function draw() {
    const canvas = document.getElementById('localeTerrainCanvas');
    const locale = activeLocale();
    if (!canvas || !locale) return;
    const width = Math.max(1, locale.cols * cellSize); // Scrollable pixel dimensions preserve editability on very large locale canvases.
    const height = Math.max(1, locale.rows * cellSize);
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#09111b';
    context.fillRect(0, 0, width, height);

    for (let r = 0; r < locale.rows; r++) {
      for (let c = 0; c < locale.cols; c++) {
        const key = `${c},${r}`;
        const tile = locale.tiles?.[key]; // Existing generated footprint is shown underneath rule overlays for spatial context.
        if (tile) {
          context.fillStyle = TILE_COLORS[tile.type] || '#4a7c43';
          context.fillRect(c * cellSize, r * cellSize, cellSize, cellSize);
        } else {
          context.fillStyle = ((c + r) & 1) ? 'rgba(255,255,255,.018)' : 'rgba(255,255,255,.032)';
          context.fillRect(c * cellSize, r * cellSize, cellSize, cellSize);
        }
        if (cellSize >= 7) {
          context.strokeStyle = 'rgba(255,255,255,.07)';
          context.strokeRect(c * cellSize + 0.5, r * cellSize + 0.5, cellSize - 1, cellSize - 1);
        }
      }
    }

    const rules = ensureRules(locale);
    for (const [key, rule] of Object.entries(rules.terrainAnchors)) {
      const [c, r] = key.split(',').map(Number);
      if (!Number.isFinite(c) || !Number.isFinite(r)) continue;
      const color = rule.strength === 'avoid' ? '#fb7185' : rule.strength === 'preferred' ? '#facc15' : '#55e6ff'; // Probe strength uses same colors as Wilderness Lab diagnostics.
      context.strokeStyle = color;
      context.lineWidth = Math.max(2, cellSize * 0.18);
      context.strokeRect(c * cellSize + cellSize * 0.18, r * cellSize + cellSize * 0.18, cellSize * 0.64, cellSize * 0.64);
      context.lineWidth = 1;
    }
    for (const [key, rule] of Object.entries(rules.embeddedTiles)) {
      const [c, r] = key.split(',').map(Number);
      if (!Number.isFinite(c) || !Number.isFinite(r)) continue;
      context.fillStyle = rule.carveToLocaleFloor === false ? 'rgba(213,107,255,.42)' : 'rgba(213,107,255,.68)';
      context.fillRect(c * cellSize + cellSize * 0.16, r * cellSize + cellSize * 0.16, cellSize * 0.68, cellSize * 0.68);
      context.strokeStyle = '#f1c4ff';
      context.strokeRect(c * cellSize + cellSize * 0.1, r * cellSize + cellSize * 0.1, cellSize * 0.8, cellSize * 0.8);
    }
  }

  function updateStats() {
    const locale = activeLocale();
    const target = document.getElementById('localeTerrainStats');
    if (!target || !locale) return;
    const rules = ensureRules(locale); // Compact count distinguishes non-generating probes from generated/embedded cells.
    target.textContent = `${Object.keys(rules.terrainAnchors).length} probes / ${Object.keys(rules.embeddedTiles).length} embedded`;
  }

  function debug(message) {
    const target = document.getElementById('localeTerrainDebug');
    if (target) target.textContent = message;
    console.log('[LocaleTerrainEditor]', message);
  }

  function mergedActiveLocale() {
    return mergedLocale(activeLocale()); // Export interceptors always snapshot the latest main-editor data before adding terrain rules.
  }

  function downloadJson(locale) {
    const blob = new Blob([JSON.stringify(locale, null, 2)], { type: 'application/json' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `${locale.id}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(anchor.href), 0);
  }

  function installExportInterceptors() {
    const intercept = (id, handler) => {
      const element = document.getElementById(id);
      if (!element || element.dataset.localeTerrainIntercepted === '1') return;
      element.dataset.localeTerrainIntercepted = '1';
      element.addEventListener('click', event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        handler(event);
      }, true);
    }; // Capture-phase interception keeps existing controls/labels while replacing output with merged terrain-aware locale data.

    intercept('copyJsonBtn', () => {
      const locale = mergedActiveLocale();
      if (!locale) return;
      navigator.clipboard?.writeText(JSON.stringify(locale, null, 2)).then(() => debug('copied merged terrain-aware locale JSON')).catch(() => debug('clipboard unavailable'));
    });
    intercept('downloadJsonBtn', () => {
      const locale = mergedActiveLocale();
      if (!locale) return;
      downloadJson(locale);
      debug(`downloaded merged ${locale.id}.json`);
    });
    intercept('saveLocalesOverrideBtn', () => {
      const workspace = workspaceSnapshot();
      if (!workspace || !window.LocalDBOverrides) return;
      window.LocalDBOverrides.setOverride('locales', { locales: workspace.locales.map(mergedLocale) });
      const status = document.getElementById('localesOverrideStatus');
      if (status) status.textContent = `Local override saved with terrain rules at ${new Date().toLocaleTimeString()}.`;
      debug(`saved ${workspace.locales.length} merged locale(s) to LocalDBOverrides`);
    });
  }

  function seedStoreFromWorkspace() {
    const workspace = workspaceSnapshot();
    if (!workspace) return;
    let changed = false; // New persisted nested rules are imported into sidecar store without overwriting edits already made this session.
    for (const locale of workspace.locales || []) {
      if (store.byLocale[locale.id]) continue;
      const fromLocale = rulesFromLocale(locale);
      if (Object.keys(fromLocale.terrainAnchors).length || Object.keys(fromLocale.embeddedTiles).length) {
        store.byLocale[locale.id] = fromLocale;
        changed = true;
      }
    }
    if (changed) saveRuleStore();
  }

  function pollActiveLocale() {
    const locale = activeLocale();
    const id = locale?.id || '';
    if (id !== lastActiveId) {
      lastActiveId = id;
      if (locale) ensureRules(locale);
      draw();
      updateStats();
      debug(locale ? `editing terrain rules for ${locale.id}` : 'no active locale');
    }
  }

  function boot() {
    if (!bridge() || !document.getElementById('sidebar-scroll')) {
      setTimeout(boot, 40);
      return;
    }
    patchWorkspaceStorage();
    seedStoreFromWorkspace();
    injectUi();
    syncWorkspaceStorage();
    pollActiveLocale();
    setInterval(pollActiveLocale, 350); // Main editor keeps activeId private; lightweight polling is the only coupling required by this extension.
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
