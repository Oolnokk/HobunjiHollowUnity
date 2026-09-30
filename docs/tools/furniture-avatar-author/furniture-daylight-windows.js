// Furniture + Avatar Author daylight-window surface extension.
// Marks any recognized furniture surface as a daylight aperture, reusing the
// editor's existing material-fill model for the pane preview and exporting the
// radius/strength consumed by DaylightWindowRuntime.
(() => {
'use strict';

const dwq = id => document.getElementById(id); // Used only by this extension's Surfaces-panel controls.
const DW_VERSION = 1; // Persisted authoring metadata version for future explicit migrations.
const DW_ROLE = 'daylightWindow'; // Generic recognized-surface role; not tied to rectangular window furniture.
const DW_PREVIEW_COLOR = '#dce9f4'; // Representative neutral daylight; runtime replaces it with live outdoor RGB.
const DW_DEFAULT_RADIUS = 2.8; // Starting room-light radius in tiles when a surface is first marked.
const DW_DEFAULT_STRENGTH = 1; // Starting interior mask-uncover strength when a surface is first marked.

function dwFinite(value, fallback = 0) {
  const number = Number(value); // Used to reject NaN/Infinity from imported authoring JSON.
  return Number.isFinite(number) ? number : fallback;
}

function dwClamp01(value) {
  return Math.max(0, Math.min(1, dwFinite(value))); // Normalizes user-entered window strengths.
}

function ensureDaylightState() {
  if (!state.daylightWindows || typeof state.daylightWindows !== 'object' || Array.isArray(state.daylightWindows)) state.daylightWindows = {}; // Surface id -> radius/strength settings used across rebuilds.
  return state.daylightWindows;
}

function selectedDaylightSurface() {
  const direct = typeof selectedSurface === 'function' ? selectedSurface() : null; // Reuses the editor's canonical currently selected recognized surface.
  if (direct) return direct;
  const ids = typeof activeSurfaceIds === 'function' ? activeSurfaceIds() : []; // Multi-select fallback matches the wall-ornament authoring extension.
  return ids?.length ? surfaceGroups.get(ids[ids.length - 1]) : null;
}

function surfaceMaterialSetting(surface) {
  if (!surface) return null;
  try {
    if (typeof ensureSurfaceSetting === 'function') return ensureSurfaceSetting(surface.id); // Canonical base-editor surface setting keeps fill preview/render behavior consistent.
  } catch (_) {}
  return surface; // Older tool builds can still carry role/fill fields directly on the recognized group.
}

function windowSettingsFor(surfaceId) {
  const record = ensureDaylightState()[surfaceId]; // Exact surface id keeps multiple windows on one furniture item independent.
  return record ? record : null;
}

function applyWindowToSurface(surface, record) {
  if (!surface || !record) return false;
  surface.role = DW_ROLE; // Visible semantic role also flows through the base recognized-surface exporter.
  surface.daylightRadiusTiles = Math.max(0.25, dwFinite(record.daylightRadiusTiles, DW_DEFAULT_RADIUS));
  surface.daylightStrength = dwClamp01(record.daylightStrength == null ? DW_DEFAULT_STRENGTH : record.daylightStrength);
  const setting = surfaceMaterialSetting(surface); // Existing fill pipeline neutralizes texture shading before multiplying by this preview color.
  if (setting) {
    setting.surfaceRole = DW_ROLE;
    setting.materialFillEnabled = true;
    setting.materialFillColor = String(record.previewFillColor || DW_PREVIEW_COLOR);
  }
  surface.materialFillEnabled = true;
  surface.materialFillColor = String(record.previewFillColor || DW_PREVIEW_COLOR);
  return true;
}

function reapplyDaylightSurfaces() {
  const records = ensureDaylightState(); // Called after geometry rebuilds because recognized surface objects are regenerated.
  for (const [surfaceId, record] of Object.entries(records)) {
    const surface = surfaceGroups.get(surfaceId); // Same-id surfaces preserve their daylight role/settings across ordinary part edits.
    if (surface) applyWindowToSurface(surface, record);
  }
}

function markSelectedAsWindow() {
  const surface = selectedDaylightSurface(); // User-selected recognized face is the single source of truth.
  if (!surface) { log?.('Select a recognized furniture surface first.', 'warn'); return; }
  if (state.wallOrnament?.attachmentSurfaceId === surface.id) {
    log?.('That surface is the wall attachment face. Select the visible pane face instead so one surface does not have two conflicting roles.', 'warn');
    return;
  }
  const prior = windowSettingsFor(surface.id); // Keeps authored radius/strength when re-marking an existing window.
  ensureDaylightState()[surface.id] = {
    version: DW_VERSION,
    daylightRadiusTiles: Math.max(0.25, dwFinite(prior?.daylightRadiusTiles, DW_DEFAULT_RADIUS)),
    daylightStrength: dwClamp01(prior?.daylightStrength == null ? DW_DEFAULT_STRENGTH : prior.daylightStrength),
    previewFillColor: String(prior?.previewFillColor || DW_PREVIEW_COLOR),
  }; // Stored separately so base surface regeneration cannot erase authoring-only controls.
  applyWindowToSurface(surface, ensureDaylightState()[surface.id]);
  try { renderSurfaceRecognition?.(); } catch (_) {}
  try { rebuildFurnitureMeshes?.(); } catch (_) {}
  renderDaylightUi();
  queueUndoHistory?.('mark daylight window surface');
  log?.(`Daylight window surface set to ${surface.id}.`);
}

function clearSelectedWindow() {
  const surface = selectedDaylightSurface(); // Clears only the selected window so furniture can contain several daylight apertures.
  if (!surface) { log?.('Select a daylight-window surface first.', 'warn'); return; }
  const records = ensureDaylightState();
  if (!records[surface.id] && surface.role !== DW_ROLE) { log?.('Selected surface is not a daylight window.', 'warn'); return; }
  delete records[surface.id];
  if (surface.role === DW_ROLE) surface.role = 'none';
  delete surface.daylightRadiusTiles;
  delete surface.daylightStrength;
  const setting = surfaceMaterialSetting(surface); // Material remains textured but stops forcing the daylight preview fill.
  if (setting) {
    if (setting.surfaceRole === DW_ROLE) setting.surfaceRole = 'none';
    setting.materialFillEnabled = false;
  }
  surface.materialFillEnabled = false;
  try { renderSurfaceRecognition?.(); } catch (_) {}
  try { rebuildFurnitureMeshes?.(); } catch (_) {}
  renderDaylightUi();
  queueUndoHistory?.('clear daylight window surface');
}

function updateSelectedWindowSettings() {
  const surface = selectedDaylightSurface(); // Direct numeric controls target only the current recognized window surface.
  if (!surface) return;
  const record = ensureDaylightState()[surface.id];
  if (!record) return;
  record.daylightRadiusTiles = Math.max(0.25, dwFinite(dwq('daylightWindowRadius')?.value, DW_DEFAULT_RADIUS));
  record.daylightStrength = dwClamp01(dwq('daylightWindowStrength')?.value ?? DW_DEFAULT_STRENGTH);
  record.previewFillColor = dwq('daylightWindowPreviewColor')?.value || DW_PREVIEW_COLOR;
  applyWindowToSurface(surface, record);
  try { renderSurfaceRecognition?.(); } catch (_) {}
  try { rebuildFurnitureMeshes?.(); } catch (_) {}
  renderDaylightUi();
  queueUndoHistory?.('edit daylight window');
}

function renderDaylightUi() {
  const surface = selectedDaylightSurface(); // Readout follows normal surface selection rather than maintaining a competing selection model.
  const record = surface ? ensureDaylightState()[surface.id] : null;
  const radius = dwq('daylightWindowRadius'); // Radius input is disabled unless current surface is already marked.
  const strength = dwq('daylightWindowStrength'); // Strength input mirrors the current marked surface.
  const color = dwq('daylightWindowPreviewColor'); // Preview-only fill swatch; runtime ignores this color and uses outdoor RGB.
  if (radius) { radius.disabled = !record; radius.value = dwFinite(record?.daylightRadiusTiles, DW_DEFAULT_RADIUS); }
  if (strength) { strength.disabled = !record; strength.value = dwClamp01(record?.daylightStrength == null ? DW_DEFAULT_STRENGTH : record.daylightStrength); }
  if (color) { color.disabled = !record; color.value = record?.previewFillColor || DW_PREVIEW_COLOR; }
  dwq('clearDaylightWindowSurface')?.toggleAttribute('disabled', !record);
  const readout = dwq('daylightWindowReadout'); // In-tool mobile-visible diagnostics replace reliance on console output.
  if (readout) {
    const count = Object.keys(ensureDaylightState()).length; // Total authored apertures on this furniture item.
    readout.textContent = record
      ? `${surface.id} · radius ${dwFinite(record.daylightRadiusTiles).toFixed(2)} tiles · strength ${dwClamp01(record.daylightStrength).toFixed(2)} · texture fill follows live outdoor lighting in game · ${count} window surface${count === 1 ? '' : 's'} total`
      : `${count} daylight window surface${count === 1 ? '' : 's'} authored. Select a recognized pane face to edit or mark another.`;
  }
}

function installDaylightUi() {
  if (dwq('daylightWindowPanel')) return;
  const host = dwq('tab-surfaces'); // Daylight semantics belong with surface recognition/material fill controls.
  if (!host) return;
  const panel = document.createElement('div'); // Self-contained section avoids modifying the giant editor HTML.
  panel.id = 'daylightWindowPanel';
  panel.className = 'section';
  panel.innerHTML = `<h2>Daylight Window</h2>
    <div class="muted">Mark a visible pane surface as an outdoor-light aperture. In game the ordinary interior darkness mask is locally uncovered here, then the current outdoor time/weather tint is applied. The surface texture uses the existing shade-preserving fill method and follows the same outdoor RGB.</div>
    <div class="g2" style="margin-top:6px"><button id="markDaylightWindowSurface" class="ok">Use Selected Surface as Window</button><button id="clearDaylightWindowSurface" class="bad">Clear Selected Window</button></div>
    <div class="g2"><div><label>Daylight radius <span class="muted">(tiles)</span></label><input id="daylightWindowRadius" type="number" min="0.25" max="12" step="0.1"></div><div><label>Daylight strength</label><input id="daylightWindowStrength" type="number" min="0" max="1" step="0.05"></div></div>
    <label>Editor preview fill <span class="muted">(runtime follows outdoor light)</span></label><input id="daylightWindowPreviewColor" type="color" value="${DW_PREVIEW_COLOR}">
    <div id="daylightWindowReadout" class="readout muted" style="margin-top:6px"></div>`;
  host.prepend(panel);
  dwq('markDaylightWindowSurface').onclick = markSelectedAsWindow;
  dwq('clearDaylightWindowSurface').onclick = clearSelectedWindow;
  for (const id of ['daylightWindowRadius', 'daylightWindowStrength', 'daylightWindowPreviewColor']) dwq(id)?.addEventListener('change', updateSelectedWindowSettings);
  renderDaylightUi();
}

function importDaylightRecords(data) {
  const records = {}; // Reconstructed from exported recognized surfaces so old files without the companion state object still work.
  for (const surface of data?.recognizedSurfaces || []) {
    if (surface?.role !== DW_ROLE) continue;
    records[surface.id] = {
      version: DW_VERSION,
      daylightRadiusTiles: Math.max(0.25, dwFinite(surface.daylightRadiusTiles, DW_DEFAULT_RADIUS)),
      daylightStrength: dwClamp01(surface.daylightStrength == null ? DW_DEFAULT_STRENGTH : surface.daylightStrength),
      previewFillColor: String(surface.materialFillColor || DW_PREVIEW_COLOR),
    };
  }
  state.daylightWindows = records;
  reapplyDaylightSurfaces();
}

const daylightOriginalExport = exportData; // Loaded after wall authoring so both extensions serialize through one wrapper chain.
exportData = function exportFurnitureWithDaylightWindows(...args) {
  const data = daylightOriginalExport(...args); // Base + wall exporters remain authoritative for every unrelated field.
  const records = ensureDaylightState();
  for (const surface of data.recognizedSurfaces || []) {
    const record = records[surface.id];
    if (!record) continue;
    surface.role = DW_ROLE;
    surface.daylightRadiusTiles = Math.max(0.25, dwFinite(record.daylightRadiusTiles, DW_DEFAULT_RADIUS));
    surface.daylightStrength = dwClamp01(record.daylightStrength == null ? DW_DEFAULT_STRENGTH : record.daylightStrength);
    surface.materialFillEnabled = true;
    surface.materialFillColor = String(record.previewFillColor || DW_PREVIEW_COLOR);
  }
  data.daylightWindowAuthoring = { version: DW_VERSION, role: DW_ROLE, lightingModel: 'interior-overlay-aperture', surfaceTint: 'live-outdoor-rgb-over-neutralized-texture' };
  return data;
};

const daylightOriginalLoad = loadData; // Restores radius/strength after the base loader regenerates recognized surfaces.
loadData = function loadFurnitureWithDaylightWindows(data, ...args) {
  const result = daylightOriginalLoad(data, ...args);
  importDaylightRecords(data);
  renderDaylightUi();
  return result;
};

const daylightOriginalClear = clearFurniture; // New documents never inherit stale window ids/settings.
clearFurniture = function clearFurnitureWithDaylightWindows(...args) {
  const result = daylightOriginalClear(...args);
  state.daylightWindows = {};
  renderDaylightUi();
  return result;
};

const daylightOriginalRebuild = rebuildFurnitureMeshes; // Geometry edits recreate surface objects; reapply semantic/material fields afterward.
rebuildFurnitureMeshes = function rebuildFurnitureWithDaylightWindows(...args) {
  const result = daylightOriginalRebuild(...args);
  reapplyDaylightSurfaces();
  renderDaylightUi();
  return result;
};

installDaylightUi();
window.FurnitureDaylightWindowAuthor = {
  version: DW_VERSION,
  role: DW_ROLE,
  refresh: renderDaylightUi,
  debugSnapshot: () => ({ selectedSurfaceId: selectedDaylightSurface()?.id || null, windows: JSON.parse(JSON.stringify(ensureDaylightState())) }),
};
})();
