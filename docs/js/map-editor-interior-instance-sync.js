// Map Editor — sync indexed standalone interiors into the editable workspace.
//
// The live game gives docs/config/maps/index.json precedence over stale inline
// copies in town-workspace-v1.json. The Map Editor used to keep the inline copy
// and attach the standalone file only as buildingInteriorBase, so furniture-
// derived NPC stations were invisible in the editor even though runtime
// schedules could resolve them. This companion mirrors the live precedence and
// also provides per-instance walkable-elevation authoring for exterior furniture.
(() => {
  'use strict';

  if (!/\/tools\/map-editor(?:\/index\.html)?\/?$/.test(location.pathname)) return;

  const INDEX_URL = '../../config/maps/index.json'; // Used by syncStandaloneInteriors to find authoritative map files.
  const WORKSPACE_KEY = 'hobunji_map_editor_workspace_v1'; // Used to persist the refreshed editor workspace immediately.
  const SITTING_KEYS = new Set(['stool', 'chairsimple', 'chaircushion', 'bench']); // Used to identify runtime-sittable furniture.
  const EDITOR_ONLY_FLAG = '_editorOnlyDynamicFurnitureStation'; // Used to omit visualized runtime stations from static exports.
  const WALKABLE_ELEVATION_KEY = 'walkableElevation'; // Used by runtime to opt a placed furniture instance into geometry-derived vertical support.
  const state = { // Used by the visible debug report and MapEditorInteriorInstanceSync.debug().
    installed: false,
    syncing: false,
    lastReason: '',
    lastStartedAt: '',
    lastFinishedAt: '',
    indexedInteriorCount: 0,
    syncedMapIds: [],
    changedMapIds: [],
    errors: [],
    stationCounts: {},
    walkableEdits: 0,
  };

  let activeSync = null; // Used to collapse simultaneous startup/manual/load-town sync requests.
  let loadTownPollToken = 0; // Used to cancel an older Load Town completion poll.

  function $(id) { return document.getElementById(id); }
  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  function workspace() { try { return window._mapEditorBridge?.getWorkspace?.() || null; } catch (_) { return null; } }
  function activeMap() {
    const ws = workspace();
    if (!ws || !Array.isArray(ws.maps) || !ws.maps.length) return null;
    return ws.maps.find(map => String(map?.id || '') === String(ws.activeId || '')) || ws.maps[0] || null;
  }
  function setStatus(message) { const pill = $('statusPill'); if (pill) pill.textContent = message; }
  function finiteNumber(value, fallback = 0) { const number = Number(value); return Number.isFinite(number) ? number : fallback; }
  function clampInt(value, min, max, fallback) { const number = Math.round(Number(value)); return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback; }
  function normalizedFurnitureKey(furniture) { return String(furniture?.itemKey || furniture?.key || furniture?.kind || furniture?.type || '').trim().replace(/Furniture$/i, ''); }
  function isSittingFurniture(furniture) { return SITTING_KEYS.has(normalizedFurnitureKey(furniture).toLowerCase()); }
  function furnitureStationId(mapId, col, row) { return `furniture_chair_${mapId}_${col}_${row}`; }
  function furnitureStationLabel(furniture) {
    const key = normalizedFurnitureKey(furniture);
    const names = { stool: 'Round Stool', chairsimple: 'Simple Chair', chaircushion: 'Cushioned Chair', bench: 'Bench' };
    return names[key.toLowerCase()] || key || 'Seat';
  }
  function normalizeAuthoredStation(station, index, mapId) {
    const col = finiteNumber(station?.col ?? station?.c, NaN);
    const row = finiteNumber(station?.row ?? station?.r, NaN);
    if (!Number.isFinite(col) || !Number.isFinite(row)) return null;
    const id = String(station?.id || station?.stationId || `${mapId}_station_${index + 1}`);
    return { ...clone(station), id, stationId: String(station?.stationId || id), col, row, rotY: finiteNumber(station?.rotY, 0), pose: String(station?.pose || 'stand') };
  }
  function deriveFurnitureStations(mapData, mapId) {
    const authored = (Array.isArray(mapData?.npcStations) ? mapData.npcStations : []).map((station, index) => normalizeAuthoredStation(station, index, mapId)).filter(Boolean);
    const usedIds = new Set(authored.map(station => station.id));
    const generated = [];
    for (const furniture of (Array.isArray(mapData?.furniture) ? mapData.furniture : [])) {
      if (!isSittingFurniture(furniture)) continue;
      const col = finiteNumber(furniture?.col, NaN);
      const row = finiteNumber(furniture?.row, NaN);
      if (!Number.isFinite(col) || !Number.isFinite(row)) continue;
      const id = furnitureStationId(mapId, col, row);
      if (usedIds.has(id)) continue;
      usedIds.add(id);
      generated.push({ id, stationId: id, label: `${furnitureStationLabel(furniture)} (auto seat)`, col, row, rotY: finiteNumber(furniture?.rotY, 0), pose: 'sit', toolKey: '', toolIntervalSec: 0, toolAnimStyle: '', sourceFurnitureId: String(furniture?.id || ''), sourceFurnitureKey: String(furniture?.itemKey || furniture?.key || ''), seatIndex: 0, [EDITOR_ONLY_FLAG]: true });
    }
    return { authored, generated, all: [...authored, ...generated] };
  }
  function tilesFromInterior(mapData) {
    const tiles = {};
    const colliderKeys = new Set();
    for (const cell of (Array.isArray(mapData?.colliders) ? mapData.colliders : [])) {
      if (!Array.isArray(cell) || cell.length < 2) continue;
      const col = finiteNumber(cell[0], NaN), row = finiteNumber(cell[1], NaN);
      if (Number.isFinite(col) && Number.isFinite(row)) colliderKeys.add(`${col},${row}`);
    }
    for (const cell of (Array.isArray(mapData?.floor) ? mapData.floor : [])) {
      if (!Array.isArray(cell) || cell.length < 2) continue;
      const col = finiteNumber(cell[0], NaN), row = finiteNumber(cell[1], NaN);
      if (!Number.isFinite(col) || !Number.isFinite(row)) continue;
      const key = `${col},${row}`;
      tiles[key] = { type: colliderKeys.has(key) ? 'rock' : 'grass', crop: '' };
    }
    for (const key of colliderKeys) if (!tiles[key]) tiles[key] = { type: 'rock', crop: '' };
    return tiles;
  }
  function transitionsFromInterior(mapData) {
    const transitions = [];
    for (const exit of (Array.isArray(mapData?.exits) ? mapData.exits : [])) {
      const exitId = String(exit?.id || 'exit');
      for (const tile of (Array.isArray(exit?.tiles) ? exit.tiles : [])) {
        if (!Array.isArray(tile) || tile.length < 2) continue;
        const col = finiteNumber(tile[0], NaN), row = finiteNumber(tile[1], NaN);
        if (!Number.isFinite(col) || !Number.isFinite(row)) continue;
        transitions.push({ id: `${exitId}_${col}_${row}`, exitId, label: String(exit?.label || exitId), col, row, targetMapId: String(exit?.targetMap || ''), spawnCol: finiteNumber(exit?.spawnCol, 0), spawnRow: finiteNumber(exit?.spawnRow, 0) });
      }
    }
    return transitions;
  }
  function convertInterior(mapData, entry, existingMap) {
    const id = String(entry?.id || mapData?.id || '').trim();
    if (!id) throw new Error('Indexed building interior is missing an id.');
    const stations = deriveFurnitureStations(mapData, id);
    return { schema: 'hobunji_map.v1', id, name: String(entry?.name || mapData?.name || id), category: 'building_interior', cols: clampInt(mapData?.cols, 2, 400, 20), rows: clampInt(mapData?.rows, 2, 400, 20), tiles: tilesFromInterior(mapData), visualHeights: {}, objects: {}, furniture: [], decor: [], routes: clone(Array.isArray(mapData?.routes) ? mapData.routes : []), rivers: [], npcPaths: clone(Array.isArray(mapData?.npcPaths) ? mapData.npcPaths : []), transitions: transitionsFromInterior(mapData), npcStations: stations.all, buildings: [], isSubmap: false, parentMapId: null, plateauGroupId: null, elevation: 0, audioIndex: String(existingMap?.audioIndex || mapData?.audioIndex || ''), buildingInteriorBase: clone(mapData), _standaloneInteriorSource: String(entry?.file || ''), _standaloneInteriorGeneratedStations: stations.generated.length };
  }
  function comparableMap(map) { return JSON.stringify({ id: map?.id, name: map?.name, category: map?.category, cols: map?.cols, rows: map?.rows, tiles: map?.tiles, routes: map?.routes, npcPaths: map?.npcPaths, transitions: map?.transitions, npcStations: map?.npcStations, buildingInteriorBase: map?.buildingInteriorBase, source: map?._standaloneInteriorSource }); }
  function applyConvertedMap(ws, converted) {
    const index = ws.maps.findIndex(map => String(map?.id || '') === converted.id);
    if (index < 0) { ws.maps.push(converted); return true; }
    const existing = ws.maps[index], before = comparableMap(existing);
    Object.assign(existing, converted);
    return before !== comparableMap(existing);
  }
  function mapFileUrl(file) { const normalized = String(file || '').replace(/^\/+/, '').replace(/^docs\//, ''); return normalized ? `../../${normalized}` : ''; }
  async function fetchJson(url) { const response = await fetch(url, { cache: 'no-store' }); if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`); return response.json(); }
  function persistWorkspace(ws) { try { localStorage.setItem(WORKSPACE_KEY, JSON.stringify(ws)); } catch (error) { state.errors.push({ mapId: '', message: `Workspace save failed: ${error?.message || error}` }); } }
  function refreshEditor() {
    const bridge = window._mapEditorBridge;
    for (const method of ['rerender', 'refresh', 'updateAll']) { if (typeof bridge?.[method] === 'function') { bridge[method](); return; } }
    const selected = document.querySelector('#mapList .sel, #mapList .active, #mapList [aria-selected="true"]');
    if (selected instanceof HTMLElement) selected.click();
    window.dispatchEvent(new Event('resize'));
  }
  function updateButton() {
    const button = $('syncInteriorInstancesBtn'); if (!button) return;
    button.disabled = state.syncing; button.textContent = state.syncing ? 'Syncing Interiors…' : 'Sync Interiors';
    const inn = state.stationCounts.map_i_inn;
    button.title = inn ? `Inn: ${inn.total} shown (${inn.generated} furniture-derived). Click for a fresh sync.` : 'Refresh indexed standalone interiors and furniture-derived stations.';
  }
  function debugText() {
    const lines = ['Standalone Interior Sync', `Installed: ${state.installed}`, `Syncing: ${state.syncing}`, `Last reason: ${state.lastReason || '—'}`, `Last finished: ${state.lastFinishedAt || '—'}`, `Indexed interiors: ${state.indexedInteriorCount}`, `Synced: ${state.syncedMapIds.length}`, `Changed: ${state.changedMapIds.length}`, `Walkable elevation edits: ${state.walkableEdits}`, `Errors: ${state.errors.length}`, ''];
    for (const [mapId, counts] of Object.entries(state.stationCounts)) lines.push(`${mapId}: ${counts.total} stations (${counts.generated} furniture-derived)`);
    for (const error of state.errors) lines.push(`ERROR ${error.mapId || '(general)'}: ${error.message}`);
    return lines.join('\n');
  }
  function showDebugReport() {
    const text = debugText(); $('interiorSyncDebugDialog')?.remove();
    const dialog = document.createElement('dialog'); dialog.id = 'interiorSyncDebugDialog'; dialog.style.cssText = 'max-width:min(92vw,720px);width:720px;background:#111827;color:#e5e7eb;border:1px solid #4b5563;border-radius:10px;padding:14px';
    dialog.innerHTML = `<h3 style="margin:0 0 8px">Interior Sync Debug</h3><textarea readonly style="width:100%;height:46vh;box-sizing:border-box;background:#030712;color:#d1d5db;border:1px solid #374151;border-radius:6px;padding:8px"></textarea><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px"><button data-copy>Copy</button><button data-close>Close</button></div>`;
    dialog.querySelector('textarea').value = text; dialog.querySelector('[data-copy]').addEventListener('click', () => navigator.clipboard?.writeText(text)); dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close()); dialog.addEventListener('close', () => dialog.remove()); document.body.appendChild(dialog); dialog.showModal();
  }
  function walkableFurnitureCollections(map) {
    const collections = [];
    if (Array.isArray(map?.decor)) collections.push({ label: 'Exterior decor/furniture', list: map.decor });
    if (Array.isArray(map?.furniture)) collections.push({ label: 'Exterior processing furniture', list: map.furniture });
    if (Array.isArray(map?.buildingInteriorBase?.furniture)) collections.push({ label: 'Interior furniture', list: map.buildingInteriorBase.furniture });
    return collections;
  }
  function furnitureDisplayLabel(record, index) {
    const key = record?.itemKey || record?.key || record?.kind || record?.type || `piece ${index + 1}`;
    const col = finiteNumber(record?.col ?? record?.c, NaN), row = finiteNumber(record?.row ?? record?.r, NaN);
    return `${key}${Number.isFinite(col) && Number.isFinite(row) ? ` · ${col},${row}` : ''}`;
  }
  function escapeHtml(value) { return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function showWalkableElevationEditor() {
    const map = activeMap(); if (!map) { setStatus('No active map is available for walkable elevation.'); return; }
    $('walkableElevationDialog')?.remove();
    const dialog = document.createElement('dialog'); // Used as a mobile-friendly per-instance furniture toggle without requiring devtools.
    dialog.id = 'walkableElevationDialog'; dialog.style.cssText = 'max-width:min(94vw,760px);width:760px;max-height:84vh;background:#111827;color:#e5e7eb;border:1px solid #4b5563;border-radius:10px;padding:14px;overflow:auto';
    const collections = walkableFurnitureCollections(map), rows = [];
    collections.forEach((collection, collectionIndex) => {
      if (!collection.list.length) return;
      rows.push(`<h4 style="margin:12px 0 6px">${collection.label}</h4>`);
      collection.list.forEach((record, recordIndex) => rows.push(`<label style="display:flex;align-items:center;gap:8px;padding:7px 4px;border-bottom:1px solid rgba(255,255,255,.07)"><input type="checkbox" data-walk-collection="${collectionIndex}" data-walk-index="${recordIndex}"${record?.[WALKABLE_ELEVATION_KEY] ? ' checked' : ''}><span>${escapeHtml(furnitureDisplayLabel(record, recordIndex))}</span></label>`));
    });
    dialog.innerHTML = `<h3 style="margin:0 0 4px">Walkable Furniture Elevation</h3><div style="font-size:12px;color:#9ca3af;margin-bottom:8px">Map: ${escapeHtml(map.name || map.id || 'Untitled')}. Enabled instances use a runtime Box3 calculated from their complete rendered geometry. The top is walkable; the box sides remain non-blocking.</div><div data-walk-list>${rows.join('') || '<div style="color:#9ca3af">This map has no furniture/decor instances to toggle.</div>'}</div><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px"><button data-walk-save>Save</button><button data-walk-close>Close</button></div>`;
    dialog.querySelector('[data-walk-save]').addEventListener('click', () => {
      const liveMap = activeMap(); if (!liveMap) return;
      const liveCollections = walkableFurnitureCollections(liveMap); let changed = 0;
      dialog.querySelectorAll('input[data-walk-collection]').forEach(input => {
        const record = liveCollections[Number(input.dataset.walkCollection)]?.list?.[Number(input.dataset.walkIndex)]; if (!record) return;
        const before = !!record[WALKABLE_ELEVATION_KEY]; if (input.checked) record[WALKABLE_ELEVATION_KEY] = true; else delete record[WALKABLE_ELEVATION_KEY]; if (before !== !!record[WALKABLE_ELEVATION_KEY]) changed += 1;
      });
      state.walkableEdits += changed; persistWorkspace(workspace()); refreshEditor(); window.MapEditorExportFixes?.captureWorkspaceBaselines?.(); setStatus(changed ? `Saved walkable elevation on ${changed} furniture instance${changed === 1 ? '' : 's'}.` : 'Walkable elevation settings unchanged.'); dialog.close();
    });
    dialog.querySelector('[data-walk-close]').addEventListener('click', () => dialog.close()); dialog.addEventListener('close', () => dialog.remove()); document.body.appendChild(dialog); dialog.showModal();
  }
  async function performSync(reason, announce) {
    const ws = workspace(); if (!ws || !Array.isArray(ws.maps)) throw new Error('Map Editor workspace is unavailable.');
    state.syncing = true; state.lastReason = reason; state.lastStartedAt = new Date().toISOString(); state.syncedMapIds = []; state.changedMapIds = []; state.errors = []; state.stationCounts = {}; updateButton();
    try {
      const index = await fetchJson(INDEX_URL); const entries = (Array.isArray(index?.maps) ? index.maps : []).filter(entry => entry?.category === 'building_interior' && entry?.id && entry?.file); state.indexedInteriorCount = entries.length;
      for (const entry of entries) {
        try { const mapData = await fetchJson(mapFileUrl(entry.file)); if (mapData?.schema !== 'hobunji_building_interior.v1') continue; const existing = ws.maps.find(map => String(map?.id || '') === String(entry.id)); const converted = convertInterior(mapData, entry, existing); if (applyConvertedMap(ws, converted)) state.changedMapIds.push(converted.id); state.syncedMapIds.push(converted.id); state.stationCounts[converted.id] = { total: converted.npcStations.length, generated: converted._standaloneInteriorGeneratedStations }; }
        catch (error) { state.errors.push({ mapId: String(entry?.id || ''), message: String(error?.message || error) }); }
      }
      persistWorkspace(ws); refreshEditor(); window.MapEditorExportFixes?.captureWorkspaceBaselines?.(); state.lastFinishedAt = new Date().toISOString();
      if (announce) { const inn = state.stationCounts.map_i_inn; const innText = inn ? ` Inn shows ${inn.total} stations (${inn.generated} stools).` : ''; const errorText = state.errors.length ? ` ${state.errors.length} error(s); use Debug Sync.` : ''; setStatus(`Synced ${state.syncedMapIds.length} standalone interiors; refreshed ${state.changedMapIds.length}.${innText}${errorText}`); }
      return clone(state);
    } finally { state.syncing = false; updateButton(); }
  }
  function sync(reason = 'manual', announce = true) {
    if (activeSync) return activeSync;
    activeSync = performSync(reason, announce).catch(error => { state.errors.push({ mapId: '', message: String(error?.message || error) }); state.lastFinishedAt = new Date().toISOString(); if (announce) setStatus(`Interior sync failed: ${error?.message || error}`); console.error('Map Editor interior sync failed:', error); return clone(state); }).finally(() => { activeSync = null; state.syncing = false; updateButton(); });
    return activeSync;
  }
  function installButtons() {
    const loadTownButton = $('loadTownBtn'); if (!loadTownButton?.parentNode || $('syncInteriorInstancesBtn')) return;
    const syncButton = document.createElement('button'); syncButton.id = 'syncInteriorInstancesBtn'; syncButton.type = 'button'; syncButton.className = loadTownButton.className; syncButton.textContent = 'Sync Interiors'; syncButton.addEventListener('click', () => sync('manual', true)); loadTownButton.insertAdjacentElement('afterend', syncButton);
    const debugButton = document.createElement('button'); debugButton.id = 'debugInteriorInstancesBtn'; debugButton.type = 'button'; debugButton.className = loadTownButton.className; debugButton.textContent = 'Debug Sync'; debugButton.addEventListener('click', showDebugReport); syncButton.insertAdjacentElement('afterend', debugButton);
    const elevationButton = document.createElement('button'); // Used to edit exterior furniture support flags on desktop or mobile.
    elevationButton.id = 'editWalkableElevationBtn'; elevationButton.type = 'button'; elevationButton.className = loadTownButton.className; elevationButton.textContent = 'Walkable Furniture'; elevationButton.title = 'Toggle geometry-derived vertical support on individual furniture/decor instances.'; elevationButton.addEventListener('click', showWalkableElevationEditor); debugButton.insertAdjacentElement('afterend', elevationButton); updateButton();
  }
  function scheduleAfterLoadTown() {
    const token = ++loadTownPollToken; let attempts = 0;
    const poll = () => { if (token !== loadTownPollToken) return; attempts += 1; const status = String($('statusPill')?.textContent || ''); if (!status.startsWith('Fetching town workspace') || attempts >= 100) { sync('load-town', true); return; } setTimeout(poll, 100); };
    setTimeout(poll, 0);
  }
  function installExportGuard() {
    window.addEventListener('click', event => {
      const button = event.target instanceof Element ? event.target.closest('button') : null; if (!button || !['exportMapBtn', 'saveWsOverrideBtn'].includes(button.id)) return;
      const ws = workspace(); if (!ws?.maps) return; const removed = [];
      for (const map of ws.maps) { if (!Array.isArray(map.npcStations)) continue; const dynamic = map.npcStations.filter(station => station?.[EDITOR_ONLY_FLAG]); if (!dynamic.length) continue; removed.push([map, dynamic]); map.npcStations = map.npcStations.filter(station => !station?.[EDITOR_ONLY_FLAG]); }
      setTimeout(() => { for (const [map, dynamic] of removed) map.npcStations = [...map.npcStations, ...dynamic]; }, 0);
    }, true);
  }
  function install() {
    if (!window._mapEditorBridge?.getWorkspace) { setTimeout(install, 25); return; }
    if (state.installed) return; state.installed = true; installButtons(); installExportGuard(); $('loadTownBtn')?.addEventListener('click', scheduleAfterLoadTown);
    window.MapEditorInteriorInstanceSync = { sync: () => sync('api', true), debug: () => clone(state), debugText, showWalkableElevationEditor, walkableElevationKey: WALKABLE_ELEVATION_KEY, deriveFurnitureStations: (mapData, mapId) => clone(deriveFurnitureStations(mapData, mapId)), convertInterior: (mapData, entry = {}, existingMap = null) => clone(convertInterior(mapData, entry, existingMap)) };
    window.__mapEditorWalkableElevationDebug = () => ({ mapId: activeMap()?.id || null, collections: walkableFurnitureCollections(activeMap()).map(collection => ({ label: collection.label, total: collection.list.length, enabled: collection.list.filter(record => record?.[WALKABLE_ELEVATION_KEY]).length })), edits: state.walkableEdits });
    sync('startup', false);
  }
  install();
})();
