// Map Editor — keep indexed standalone building interiors authoritative.
//
// The live game already prefers config/maps/index.json files over the inline
// copies inside town-workspace-v1.json. The core Map Editor historically kept
// the inline copy and attached the standalone file only as buildingInteriorBase,
// which left the editable floor/station overlays stale. This controller mirrors
// the game's precedence inside the editor and derives deterministic sitting
// stations from standalone stool furniture.
(() => {
  'use strict';

  if (!/\/tools\/map-editor(?:\/index\.html)?\/?$/.test(location.pathname)) return;

  const INDEX_URL = '../../config/maps/index.json';
  const STATION_RULES = Object.freeze({
    stool: Object.freeze({ pose: 'sit_living_chair', label: 'Stool Station' }),
  });
  const DEBUG = {
    installed: false,
    syncing: false,
    lastReason: '',
    lastStartedAt: null,
    lastFinishedAt: null,
    indexedInteriorCount: 0,
    syncedMapIds: [],
    changedMapIds: [],
    errors: [],
    stationCounts: {},
  };

  let syncPromise = null;
  let loadTownPollToken = 0;

  function $(id) {
    return document.getElementById(id);
  }

  function workspace() {
    try {
      return window._mapEditorBridge?.getWorkspace?.() || null;
    } catch (_) {
      return null;
    }
  }

  function setStatus(message) {
    const pill = $('statusPill');
    if (pill) pill.textContent = message;
  }

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function clampInt(value, min, max, fallback) {
    const numeric = Math.round(Number(value));
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(max, Math.max(min, numeric));
  }

  function finiteNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  }

  function safeId(value, fallback) {
    const normalized = String(value || '')
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '');
    return normalized || fallback;
  }

  function titleFromId(value) {
    return String(value || '')
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, letter => letter.toUpperCase())
      .trim();
  }

  function stationCoordinates(station, tileSize) {
    const col = finiteNumber(station?.col, NaN);
    const row = finiteNumber(station?.row, NaN);
    return {
      col,
      row,
      worldX: finiteNumber(station?.worldX, Number.isFinite(col) ? (col + 0.5) * tileSize : 0),
      worldZ: finiteNumber(station?.worldZ, Number.isFinite(row) ? -(row + 0.5) * tileSize : 0),
    };
  }

  function normalizeSourceStation(station, index, mapData) {
    const tileSize = Math.max(1, finiteNumber(mapData?.tileSize, 128));
    const coordinates = stationCoordinates(station, tileSize);
    if (!Number.isFinite(coordinates.col) || !Number.isFinite(coordinates.row)) return null;

    const fallbackId = `${safeId(mapData?.id, 'interior')}_station_${index + 1}`;
    const id = safeId(station?.id || station?.stationId, fallbackId);
    return {
      ...clone(station),
      id,
      stationId: safeId(station?.stationId || id, id),
      label: String(station?.label || titleFromId(id) || `Station ${index + 1}`),
      col: coordinates.col,
      row: coordinates.row,
      worldX: coordinates.worldX,
      worldZ: coordinates.worldZ,
      rotY: finiteNumber(station?.rotY, 0),
      pose: String(station?.pose || 'stand'),
      sleepPose: String(station?.sleepPose || ''),
    };
  }

  function furnitureKind(item) {
    return String(item?.kind || item?.type || item?.key || item?.itemKey || '')
      .trim()
      .toLowerCase()
      .replace(/furniture$/, '');
  }

  function stationMatchesFurniture(station, furniture) {
    if (!station || !furniture) return false;
    if (station.sourceFurnitureId && String(station.sourceFurnitureId) === String(furniture.id)) return true;
    return finiteNumber(station.col, NaN) === finiteNumber(furniture.col, NaN)
      && finiteNumber(station.row, NaN) === finiteNumber(furniture.row, NaN);
  }

  function deriveFurnitureStation(furniture, index, mapData) {
    const kind = furnitureKind(furniture);
    const rule = STATION_RULES[kind];
    if (!rule) return null;

    const col = finiteNumber(furniture?.col, NaN);
    const row = finiteNumber(furniture?.row, NaN);
    if (!Number.isFinite(col) || !Number.isFinite(row)) return null;

    const tileSize = Math.max(1, finiteNumber(mapData?.tileSize, 128));
    const sourceFurnitureId = safeId(furniture?.id, `${kind}_${index + 1}`);
    const id = `${sourceFurnitureId}_station`;
    return {
      id,
      stationId: id,
      label: `${titleFromId(sourceFurnitureId) || rule.label} Station`,
      col,
      row,
      worldX: (col + 0.5) * tileSize,
      worldZ: -(row + 0.5) * tileSize,
      rotY: finiteNumber(furniture?.rotY ?? furniture?.rotation, 0),
      pose: rule.pose,
      sleepPose: '',
      sourceFurnitureId,
      autoGeneratedFromFurniture: true,
    };
  }

  function buildStations(mapData) {
    const sourceStations = (Array.isArray(mapData?.npcStations) ? mapData.npcStations : [])
      .map((station, index) => normalizeSourceStation(station, index, mapData))
      .filter(Boolean);
    const generatedStations = [];

    for (const [index, furniture] of (Array.isArray(mapData?.furniture) ? mapData.furniture : []).entries()) {
      if (!STATION_RULES[furnitureKind(furniture)]) continue;
      if (sourceStations.some(station => stationMatchesFurniture(station, furniture))) continue;
      const generated = deriveFurnitureStation(furniture, index, mapData);
      if (generated) generatedStations.push(generated);
    }

    return {
      stations: [...sourceStations, ...generatedStations],
      sourceCount: sourceStations.length,
      generatedCount: generatedStations.length,
    };
  }

  function tilesFromInterior(mapData) {
    const tiles = {};
    const floor = Array.isArray(mapData?.floor) ? mapData.floor : [];
    const colliders = Array.isArray(mapData?.colliders) ? mapData.colliders : [];
    const colliderKeys = new Set(
      colliders
        .filter(cell => Array.isArray(cell) && cell.length >= 2)
        .map(([col, row]) => `${finiteNumber(col)},${finiteNumber(row)}`),
    );

    for (const cell of floor) {
      if (!Array.isArray(cell) || cell.length < 2) continue;
      const col = finiteNumber(cell[0], NaN);
      const row = finiteNumber(cell[1], NaN);
      if (!Number.isFinite(col) || !Number.isFinite(row)) continue;
      const key = `${col},${row}`;
      tiles[key] = { type: colliderKeys.has(key) ? 'rock' : 'grass', crop: '' };
    }
    for (const key of colliderKeys) {
      if (!tiles[key]) tiles[key] = { type: 'rock', crop: '' };
    }
    return tiles;
  }

  function transitionsFromInterior(mapData) {
    const transitions = [];
    for (const exit of (Array.isArray(mapData?.exits) ? mapData.exits : [])) {
      const exitId = safeId(exit?.id, 'exit');
      for (const tile of (Array.isArray(exit?.tiles) ? exit.tiles : [])) {
        if (!Array.isArray(tile) || tile.length < 2) continue;
        const col = finiteNumber(tile[0], NaN);
        const row = finiteNumber(tile[1], NaN);
        if (!Number.isFinite(col) || !Number.isFinite(row)) continue;
        transitions.push({
          id: `${exitId}_${col}_${row}`,
          exitId,
          col,
          row,
          label: String(exit?.label || exitId),
          targetMapId: String(exit?.targetMap || ''),
          spawnCol: finiteNumber(exit?.spawnCol, 0),
          spawnRow: finiteNumber(exit?.spawnRow, 0),
        });
      }
    }
    return transitions;
  }

  function convertInterior(mapData, entry, existingMap) {
    const id = String(entry?.id || mapData?.id || '').trim();
    if (!id) throw new Error('Indexed building interior is missing an id.');

    const stationBuild = buildStations(mapData);
    const authoritativeBase = {
      ...clone(mapData),
      id,
      name: String(mapData?.name || entry?.name || id),
      npcStations: clone(stationBuild.stations),
    };

    return {
      schema: 'hobunji_map.v1',
      id,
      name: String(entry?.name || mapData?.name || id),
      category: 'building_interior',
      cols: clampInt(mapData?.cols, 2, 400, 20),
      rows: clampInt(mapData?.rows, 2, 400, 20),
      tiles: tilesFromInterior(mapData),
      visualHeights: {},
      objects: {},
      furniture: [],
      decor: [],
      routes: clone(Array.isArray(mapData?.routes) ? mapData.routes : []),
      rivers: [],
      npcPaths: clone(Array.isArray(mapData?.npcPaths) ? mapData.npcPaths : []),
      transitions: transitionsFromInterior(mapData),
      npcStations: clone(stationBuild.stations),
      buildings: [],
      isSubmap: false,
      parentMapId: null,
      plateauGroupId: null,
      elevation: 0,
      audioIndex: String(existingMap?.audioIndex || mapData?.audioIndex || ''),
      buildingInteriorBase: authoritativeBase,
      _standaloneInteriorSource: String(entry?.file || ''),
      _standaloneInteriorSyncedAt: new Date().toISOString(),
      _standaloneInteriorGeneratedStations: stationBuild.generatedCount,
    };
  }

  function mapComparableSnapshot(map) {
    if (!map) return '';
    return JSON.stringify({
      id: map.id,
      name: map.name,
      category: map.category,
      cols: map.cols,
      rows: map.rows,
      tiles: map.tiles,
      routes: map.routes,
      npcPaths: map.npcPaths,
      transitions: map.transitions,
      npcStations: map.npcStations,
      buildingInteriorBase: map.buildingInteriorBase,
      source: map._standaloneInteriorSource,
    });
  }

  function applyConvertedMap(ws, converted) {
    const index = ws.maps.findIndex(map => String(map?.id || '') === converted.id);
    if (index < 0) {
      ws.maps.push(converted);
      return { changed: true, added: true };
    }

    const existing = ws.maps[index];
    const before = mapComparableSnapshot(existing);
    Object.assign(existing, converted);
    const after = mapComparableSnapshot(existing);
    return { changed: before !== after, added: false };
  }

  function resolveMapUrl(file) {
    const normalized = String(file || '').replace(/^\/+/, '');
    if (!normalized) return '';
    if (normalized.startsWith('docs/')) return `../../${normalized.slice(5)}`;
    return `../../${normalized}`;
  }

  async function fetchJson(url) {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    return response.json();
  }

  function updateDebugButton() {
    const button = $('syncInteriorInstancesBtn');
    if (!button) return;
    const changed = DEBUG.changedMapIds.length;
    const errors = DEBUG.errors.length;
    button.disabled = DEBUG.syncing;
    button.textContent = DEBUG.syncing ? 'Syncing Interiors…' : 'Sync Interiors';
    button.title = errors
      ? `${errors} interior sync error${errors === 1 ? '' : 's'}; open MapEditorInteriorInstanceSync.debug() for details.`
      : `Last sync: ${DEBUG.syncedMapIds.length} interiors checked, ${changed} refreshed.`;
  }

  async function performSync(reason, announce) {
    const ws = workspace();
    if (!ws || !Array.isArray(ws.maps)) throw new Error('Map Editor workspace is unavailable.');

    DEBUG.syncing = true;
    DEBUG.lastReason = reason;
    DEBUG.lastStartedAt = new Date().toISOString();
    DEBUG.syncedMapIds = [];
    DEBUG.changedMapIds = [];
    DEBUG.errors = [];
    DEBUG.stationCounts = {};
    updateDebugButton();

    try {
      const indexData = await fetchJson(INDEX_URL);
      const entries = (Array.isArray(indexData?.maps) ? indexData.maps : [])
        .filter(entry => entry?.category === 'building_interior' && entry?.id && entry?.file);
      DEBUG.indexedInteriorCount = entries.length;

      for (const entry of entries) {
        try {
          const mapData = await fetchJson(resolveMapUrl(entry.file));
          if (mapData?.schema !== 'hobunji_building_interior.v1') continue;
          const existing = ws.maps.find(map => String(map?.id || '') === String(entry.id));
          const converted = convertInterior(mapData, entry, existing);
          const result = applyConvertedMap(ws, converted);
          DEBUG.syncedMapIds.push(converted.id);
          if (result.changed) DEBUG.changedMapIds.push(converted.id);
          DEBUG.stationCounts[converted.id] = {
            total: converted.npcStations.length,
            generatedFromFurniture: converted._standaloneInteriorGeneratedStations,
          };
        } catch (error) {
          DEBUG.errors.push({ mapId: String(entry?.id || ''), message: String(error?.message || error) });
        }
      }

      window._mapEditorBridge?.rerender?.();
      window.MapEditorExportFixes?.captureWorkspaceBaselines?.();
      DEBUG.lastFinishedAt = new Date().toISOString();

      if (announce) {
        const inn = DEBUG.stationCounts.map_i_inn;
        const innDetail = inn ? ` Inn: ${inn.total} stations (${inn.generatedFromFurniture} from stools).` : '';
        const errorDetail = DEBUG.errors.length ? ` ${DEBUG.errors.length} failed; see debug details.` : '';
        setStatus(`Synced ${DEBUG.syncedMapIds.length} standalone interiors; refreshed ${DEBUG.changedMapIds.length}.${innDetail}${errorDetail}`);
      }
      return clone(DEBUG);
    } finally {
      DEBUG.syncing = false;
      updateDebugButton();
    }
  }

  function sync(reason = 'manual', announce = true) {
    if (syncPromise) return syncPromise;
    syncPromise = performSync(reason, announce)
      .catch(error => {
        DEBUG.errors.push({ mapId: '', message: String(error?.message || error) });
        DEBUG.lastFinishedAt = new Date().toISOString();
        if (announce) setStatus(`Interior sync failed: ${error?.message || error}`);
        console.error('Map Editor interior sync failed:', error);
        return clone(DEBUG);
      })
      .finally(() => {
        syncPromise = null;
        DEBUG.syncing = false;
        updateDebugButton();
      });
    return syncPromise;
  }

  function mapObjectReferences() {
    const ws = workspace();
    return new Map((Array.isArray(ws?.maps) ? ws.maps : []).map(map => [String(map?.id || ''), map]));
  }

  function workspaceMapObjectsChanged(before) {
    const ws = workspace();
    if (!ws || !Array.isArray(ws.maps)) return false;
    if (ws.maps.length !== before.size) return true;
    return ws.maps.some(map => before.get(String(map?.id || '')) !== map);
  }

  function syncAfterLoadTown(beforeReferences) {
    const token = ++loadTownPollToken;
    let attempts = 0;
    const poll = () => {
      if (token !== loadTownPollToken) return;
      attempts += 1;
      const status = String($('statusPill')?.textContent || '');
      const fetchFinished = !status.startsWith('Fetching town workspace');
      if ((fetchFinished && workspaceMapObjectsChanged(beforeReferences)) || attempts >= 80) {
        sync('load-town', true);
        return;
      }
      setTimeout(poll, 100);
    };
    setTimeout(poll, 0);
  }

  function installButton() {
    if ($('syncInteriorInstancesBtn')) return;
    const loadTownButton = $('loadTownBtn');
    if (!loadTownButton?.parentNode) return;

    const button = document.createElement('button');
    button.id = 'syncInteriorInstancesBtn';
    button.type = 'button';
    button.className = loadTownButton.className;
    button.textContent = 'Sync Interiors';
    button.title = 'Refresh indexed standalone interiors and regenerate furniture stations.';
    button.addEventListener('click', () => sync('manual', true));
    loadTownButton.insertAdjacentElement('afterend', button);
    updateDebugButton();
  }

  function install() {
    const bridge = window._mapEditorBridge;
    if (!bridge?.getWorkspace || !bridge?.rerender) {
      setTimeout(install, 25);
      return;
    }
    if (DEBUG.installed) return;
    DEBUG.installed = true;

    installButton();
    const loadTownButton = $('loadTownBtn');
    loadTownButton?.addEventListener('click', () => {
      const beforeReferences = mapObjectReferences();
      syncAfterLoadTown(beforeReferences);
    });

    window.MapEditorInteriorInstanceSync = {
      sync: () => sync('api', true),
      debug: () => clone(DEBUG),
      buildStations: mapData => clone(buildStations(mapData)),
      convertInterior: (mapData, entry = {}, existingMap = null) => clone(convertInterior(mapData, entry, existingMap)),
    };
    window.__mapEditorInteriorSyncDebug = DEBUG;

    sync('startup', false);
  }

  install();
})();
