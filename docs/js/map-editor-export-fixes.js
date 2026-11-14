// Map Editor â€” resilient full-map and diff JSON exports.
//
// The editor's original export handlers assume every map has a dictionary-shaped
// `tiles` field and its diff baseline covers only a subset of map properties.
// This companion controller installs capture-phase handlers over the existing
// buttons so malformed/legacy tile containers cannot crash export and every
// authored map field participates in the diff.
(() => {
  'use strict';

  if (!/\/tools\/map-editor(?:\/index\.html)?\/?$/.test(location.pathname)) return;

  const baselineById = new Map();
  let workspaceBaseline = null; // Used by buildWorkspaceDiffBundle() to include authored workspace-level changes such as plateau groups, ramps, and game links.
  let baselineMapIds = new Set(); // Used by buildWorkspaceDiffBundle() to report whole maps added or removed since the baseline was captured.
  let installed = false;

  function $(id) {
    return document.getElementById(id);
  }

  function setStatus(message) {
    const pill = $('statusPill');
    if (pill) pill.textContent = message;
  }

  function workspace() {
    try {
      return window._mapEditorBridge?.getWorkspace?.() || null;
    } catch (_) {
      return null;
    }
  }

  function activeMap() {
    const ws = workspace();
    if (!ws || !Array.isArray(ws.maps) || !ws.maps.length) return null;
    return ws.maps.find(map => map?.id === ws.activeId) || ws.maps[0] || null;
  }

  function jsonSafeClone(value) {
    const seen = new WeakSet();
    const json = JSON.stringify(value, (_key, current) => {
      if (typeof current === 'bigint') return current.toString();
      if (typeof current === 'function' || typeof current === 'symbol') return undefined;
      if (current instanceof Map) return Object.fromEntries(current.entries());
      if (current instanceof Set) return Array.from(current.values());
      if (current && typeof current === 'object') {
        if (seen.has(current)) return undefined;
        seen.add(current);
      }
      return current;
    });
    return json === undefined ? null : JSON.parse(json);
  }

  function normalizedTileRecord(record) {
    if (!record || typeof record !== 'object') return { type: 'grass', crop: '' };
    const out = jsonSafeClone(record) || {};
    delete out.c;
    delete out.r;
    out.type = out.type || 'grass';
    out.crop = out.crop || '';
    return out;
  }

  function tilesToDictionary(tiles) {
    const out = {};
    if (tiles instanceof Map) {
      for (const [key, value] of tiles.entries()) out[String(key)] = normalizedTileRecord(value);
      return out;
    }
    if (Array.isArray(tiles)) {
      for (const tile of tiles) {
        if (!tile || !Number.isFinite(Number(tile.c)) || !Number.isFinite(Number(tile.r))) continue;
        out[`${Number(tile.c)},${Number(tile.r)}`] = normalizedTileRecord(tile);
      }
      return out;
    }
    if (tiles && typeof tiles === 'object') {
      for (const [key, value] of Object.entries(tiles)) out[key] = normalizedTileRecord(value);
    }
    return out;
  }

  function tilesToArray(tiles) {
    return Object.entries(tilesToDictionary(tiles))
      .map(([key, value]) => {
        const [c, r] = key.split(',').map(Number);
        return { c, r, ...value };
      })
      .filter(tile => Number.isFinite(tile.c) && Number.isFinite(tile.r))
      .sort((a, b) => a.r - b.r || a.c - b.c);
  }

  function mapSnapshot(map) {
    const clone = jsonSafeClone(map) || {};
    clone.id = String(map?.id || clone.id || 'map');
    clone.name = String(map?.name || clone.name || 'Untitled Map');
    clone.tiles = tilesToDictionary(map?.tiles);
    return clone;
  }

  function sanitizeBuildingInteriorBase(raw, map) {
    const base = raw && typeof raw === 'object'
      ? (jsonSafeClone(raw) || {})
      : {};
    base.schema = 'hobunji_building_interior.v1';
    base.id = String(map?.id || base.id || 'map_i_untitled');
    base.name = String(map?.name || base.name || 'Building Interior');
    base.cols = Number.isFinite(Number(map?.cols)) ? Number(map.cols) : Number(base.cols) || 20;
    base.rows = Number.isFinite(Number(map?.rows)) ? Number(map.rows) : Number(base.rows) || 20;
    for (const key of ['furniture', 'exits', 'colliders', 'vendorZones', 'floor', 'routes', 'npcStations', 'npcPaths']) {
      if (!Array.isArray(base[key])) base[key] = [];
    }
    return base;
  }

  function buildBuildingInteriorExport(map) {
    const clean = mapSnapshot(map);
    const base = sanitizeBuildingInteriorBase(clean.buildingInteriorBase, clean);
    const tileDict = tilesToDictionary(clean.tiles);
    const floor = [];
    const colliders = [];
    for (const [key, tile] of Object.entries(tileDict)) {
      const [c, r] = key.split(',').map(Number);
      if (!Number.isFinite(c) || !Number.isFinite(r)) continue;
      if (c < 0 || r < 0 || c >= base.cols || r >= base.rows) continue;
      floor.push([c, r]);
      if ((tile?.type || 'grass') === 'rock') colliders.push([c, r]);
    }
    base.floor = floor;
    base.colliders = colliders;

    const priorById = new Map(base.exits.map(exit => [String(exit?.id || ''), { ...exit, tiles: [] }]));
    const generated = new Map();
    for (const transition of Array.isArray(clean.transitions) ? clean.transitions : []) {
      if (!Number.isFinite(Number(transition?.col)) || !Number.isFinite(Number(transition?.row))) continue;
      const rawId = transition.exitId
        || (typeof transition.id === 'string' ? transition.id.replace(/_\d+_\d+$/, '') : '')
        || 'exit';
      const exitId = String(rawId);
      const exit = generated.get(exitId)
        || priorById.get(exitId)
        || { id: exitId, label: transition.label || exitId, tiles: [], targetMap: '', spawnCol: 0, spawnRow: 0 };
      exit.id = exitId;
      exit.label = String(transition.label || exit.label || exitId);
      exit.targetMap = String(transition.targetMapId || exit.targetMap || '');
      exit.spawnCol = Number.isFinite(Number(transition.spawnCol)) ? Number(transition.spawnCol) : Number(exit.spawnCol) || 0;
      exit.spawnRow = Number.isFinite(Number(transition.spawnRow)) ? Number(transition.spawnRow) : Number(exit.spawnRow) || 0;
      const tile = [Number(transition.col), Number(transition.row)];
      if (!exit.tiles.some(([c, r]) => c === tile[0] && r === tile[1])) exit.tiles.push(tile);
      generated.set(exitId, exit);
    }
    base.exits = Array.from(generated.values());
    base.routes = (Array.isArray(clean.routes) ? clean.routes : [])
      .map(route => ({ id: route.id, label: route.label, nodes: Array.isArray(route.nodes) ? route.nodes.map(node => [node[0], node[1]]) : [] }))
      .filter(route => route.nodes.length);
    base.npcStations = (Array.isArray(clean.npcStations) ? clean.npcStations : []).map(station => ({
      id: station.id,
      label: station.label || station.id,
      col: station.col,
      row: station.row,
      rotY: station.rotY || 0,
      pose: station.pose || 'stand',
      toolKey: station.toolKey || '',
      toolIntervalSec: station.toolIntervalSec || 0,
      toolAnimStyle: station.toolAnimStyle || '',
    }));
    base.npcPaths = (Array.isArray(clean.npcPaths) ? clean.npcPaths : [])
      .map(path => ({ id: path.id, label: path.label, npcId: path.npcId || '', nodes: Array.isArray(path.nodes) ? path.nodes.map(node => [node[0], node[1]]) : [] }))
      .filter(path => path.nodes.length);
    return base;
  }

  function buildStandaloneMapExport(map) {
    if (map?.category === 'building_interior') {
      // The editor's canonical interior serializer retains camera rigs, puzzle wiring, layouts and decorative furniture.
      if (activeMap()?.id === map.id) {
        const fromEditor = window._mapEditorBridge?.exportActiveBuildingInterior?.();
        if (fromEditor?.id === map.id) return jsonSafeClone(fromEditor);
      }
      return buildBuildingInteriorExport(map);
    }
    const clean = mapSnapshot(map);
    clean.tiles = tilesToArray(map?.tiles);
    return clean;
  }

  function fileStem(name) {
    const stem = String(name || 'map').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return stem || 'map';
  }

  function downloadJson(filename, value) {
    const json = JSON.stringify(value, null, 2);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return json.length;
  }

  function stableJson(value) {
    // Authored JSON objects are unordered; reordering keys is not a map edit.
    return JSON.stringify(value, (_key, current) => {
      if (!current || typeof current !== 'object' || Array.isArray(current)) return current;
      return Object.fromEntries(Object.entries(current).sort(([a], [b]) => a.localeCompare(b)));
    });
  }

  function meaningfulTiles(tiles) {
    const records = tilesToDictionary(tiles);
    // Sparse game maps omit default grass, while editor imports may materialize the full grid.
    for (const [key, tile] of Object.entries(records)) {
      if (tile.type === 'grass' && tile.crop === '' && Object.keys(tile).every(field => field === 'type' || field === 'crop')) {
        delete records[key];
      }
    }
    return records;
  }

  function tileDiff(beforeTiles, afterTiles) {
    const before = meaningfulTiles(beforeTiles);
    const after = meaningfulTiles(afterTiles);
    const added = [];
    const removed = [];
    const modified = [];
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) {
      const oldValue = before[key];
      const newValue = after[key];
      const [c, r] = key.split(',').map(Number);
      if (!oldValue && newValue) added.push({ c, r, ...newValue });
      else if (oldValue && !newValue) removed.push({ c, r, ...oldValue });
      else if (stableJson(oldValue) !== stableJson(newValue)) modified.push({ c, r, before: oldValue, after: newValue });
    }
    const out = {};
    if (added.length) out.added = added;
    if (removed.length) out.removed = removed;
    if (modified.length) out.modified = modified;
    return out;
  }

  function buildDetailedDiff(map) {
    const current = mapSnapshot(map);
    const baseline = baselineById.get(current.id);
    const diff = {
      schema: 'hobunji_map_diff.v2',
      mapId: current.id,
      name: current.name,
      baselineAvailable: !!baseline,
    };

    if (!baseline) {
      diff.mode = 'full-map-fallback';
      diff._note = 'No baseline was available for this map, so the complete current map is included.';
      diff.fullMap = buildStandaloneMapExport(map);
      return diff;
    }

    const tiles = tileDiff(baseline.tiles, current.tiles);
    if (Object.keys(tiles).length) diff.tiles = tiles;

    const changes = {};
    const keys = new Set([...Object.keys(baseline), ...Object.keys(current)]);
    keys.delete('tiles');
    keys.delete('id');
    keys.delete('name');
    for (const key of keys) {
      const before = baseline[key];
      const after = current[key];
      if (stableJson(before) !== stableJson(after)) changes[key] = { before, after };
    }
    if (baseline.name !== current.name) changes.name = { before: baseline.name, after: current.name };
    if (Object.keys(changes).length) diff.changes = changes;

    const tileChangeCount = Object.values(tiles).reduce((sum, entries) => sum + entries.length, 0);
    diff.summary = {
      changed: tileChangeCount > 0 || Object.keys(changes).length > 0,
      tileChanges: tileChangeCount,
      changedFields: Object.keys(changes),
    };
    if (!diff.summary.changed) {
      // A saved workspace can already contain the user's edits on reload. Never give an apparently empty export.
      diff.mode = 'unchanged-full-map';
      diff.fullMap = buildStandaloneMapExport(map);
      diff._note = 'No edits since this Map Editor session baseline. This does NOT compare against the bundled game Town or the running game; the current editor map is included instead.';
    }
    return diff;
  }

  function captureMapBaseline(map) {
    if (!map?.id) return;
    // Called only for an explicit baseline reset; imports must not silently redefine the comparison.
    baselineById.set(String(map.id), mapSnapshot(map));
  }

  function adoptBundledMapBaselines(mapIds) {
    const ws = workspace();
    if (!ws || !Array.isArray(mapIds)) return;
    for (const mapId of mapIds) {
      const id = String(mapId || '');
      if (!id || baselineMapIds.has(id)) continue;
      const map = ws.maps.find(entry => String(entry?.id || '') === id);
      if (!map) continue;
      captureMapBaseline(map);
      baselineMapIds.add(id); // Officially imported bundled maps are not new user-authored maps.
    }
  }

  function workspaceAuthoringSnapshot(ws) {
    const clone = jsonSafeClone(ws) || {}; // Used only for diffing persistent workspace-level authoring data, not editor navigation state.
    delete clone.maps;
    delete clone.activeId;
    return clone;
  }

  function adoptBundledWorkspaceBaselines(addedIds) {
    const ws = workspace();
    if (!ws || !workspaceBaseline || !addedIds) return;
    for (const [field, ids] of [['plateauGroups', addedIds.plateauGroupIds], ['ramps', addedIds.rampIds]]) {
      if (!Array.isArray(ids) || !ids.length) continue;
      const baselineRecords = Array.isArray(workspaceBaseline[field]) ? workspaceBaseline[field] : [];
      const baselineIds = new Set(baselineRecords.map(record => String(record?.id || '')));
      for (const rawId of ids) {
        const id = String(rawId || '');
        if (!id || baselineIds.has(id)) continue;
        const record = ws[field]?.find(entry => String(entry?.id || '') === id);
        if (!record) continue;
        baselineRecords.push(jsonSafeClone(record));
        baselineIds.add(id);
      }
      workspaceBaseline[field] = baselineRecords; // Preserve other workspace edits while accepting repo-authored groups and ramps.
    }
  }

  function buildWorkspaceDiffBundle() {
    const ws = workspace();
    if (!ws || !Array.isArray(ws.maps)) throw new Error('No Map Editor workspace is available.');
    const currentById = new Map(ws.maps.filter(map => map?.id).map(map => [String(map.id), map])); // Used below to distinguish changed existing maps from whole-map additions/removals.
    const mapDiffs = [];
    for (const [mapId, map] of currentById) {
      if (!baselineMapIds.has(mapId)) continue;
      const diff = buildDetailedDiff(map);
      if (!diff.baselineAvailable || diff.summary?.changed) mapDiffs.push(diff);
    }

    const workspaceChanges = {};
    const currentWorkspace = workspaceAuthoringSnapshot(ws);
    if (workspaceBaseline && stableJson(workspaceBaseline) !== stableJson(currentWorkspace)) {
      workspaceChanges.fields = { before: workspaceBaseline, after: currentWorkspace };
    }
    const addedMaps = [...currentById.keys()].filter(id => !baselineMapIds.has(id));
    if (addedMaps.length) {
      workspaceChanges.addedMaps = addedMaps.map(id => ({
        mapId: id,
        fullMap: buildStandaloneMapExport(currentById.get(id)),
      }));
    }
    const removedMaps = [...baselineMapIds].filter(id => !currentById.has(id));
    if (removedMaps.length) {
      workspaceChanges.removedMaps = removedMaps.map(id => ({
        mapId: id,
        baseline: baselineById.get(id) || null,
      }));
    }

    const changedWorkspaceFields = Object.keys(workspaceChanges);
    return {
      schema: 'hobunji_map_edit_diff_bundle.v1',
      generatedAt: new Date().toISOString(),
      activeMapId: activeMap()?.id || null,
      maps: mapDiffs,
      workspaceChanges,
      summary: {
        changed: mapDiffs.length > 0 || changedWorkspaceFields.length > 0,
        changedMaps: mapDiffs.length,
        addedMaps: addedMaps.length,
        removedMaps: removedMaps.length,
        workspaceChangeKinds: changedWorkspaceFields,
      },
      ...(mapDiffs.length || changedWorkspaceFields.length ? {} : { _note: 'No changes since the Map Editor baseline was captured.' }),
    };
  }

  function captureWorkspaceBaselines() {
    const ws = workspace();
    if (!ws || !Array.isArray(ws.maps)) return;
    for (const map of ws.maps) captureMapBaseline(map);
    workspaceBaseline = workspaceAuthoringSnapshot(ws);
    baselineMapIds = new Set(ws.maps.filter(map => map?.id).map(map => String(map.id)));
  }

  function stopOriginal(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function handleDiffExport(event) {
    stopOriginal(event);
    try {
      const map = activeMap();
      if (!map) throw new Error('No active map is available.');
      const diff = buildDetailedDiff(map);
      const json = JSON.stringify(diff, null, 2);
      if ($('diffTitle')) $('diffTitle').textContent = String(map.name || 'Map');
      if ($('diffSubtitle')) {
        if (diff.mode === 'full-map-fallback' || diff.mode === 'unchanged-full-map') {
          $('diffSubtitle').textContent = `${diff.mode === 'unchanged-full-map' ? 'No edits since this editor tab opened' : 'No baseline available'}; local editor map included (not compared to game) · ${json.length.toLocaleString()} chars`;
        } else {
          $('diffSubtitle').textContent = `${diff.summary.tileChanges} tile change${diff.summary.tileChanges === 1 ? '' : 's'} Â· ${diff.summary.changedFields.length} changed field${diff.summary.changedFields.length === 1 ? '' : 's'} Â· ${json.length.toLocaleString()} chars`;
        }
      }
      if ($('diffTextarea')) $('diffTextarea').value = json;
      if (diff.mode === 'unchanged-full-map') setStatus('No edits since this editor tab opened; export contains the local editor map, not necessarily the game map.');
      if ($('diffModal')) $('diffModal').style.display = 'block';
    } catch (error) {
      console.error('Map diff export failed:', error);
      setStatus(`Map diff export failed: ${error?.message || error}`);
    }
  }

  function handleDiffDownload(event) {
    stopOriginal(event);
    try {
      const map = activeMap();
      const text = $('diffTextarea')?.value || '';
      const parsed = JSON.parse(text);
      downloadJson(`${fileStem(map?.name)}.diff.json`, parsed);
      setStatus('Diff downloaded.');
    } catch (error) {
      console.error('Diff download failed:', error);
      setStatus(`Diff download failed: ${error?.message || error}`);
    }
  }

  function install() {
    if (installed) return;
    const bridge = window._mapEditorBridge;
    if (!bridge?.getWorkspace) {
      setTimeout(install, 25);
      return;
    }
    installed = true;
    captureWorkspaceBaselines();
    // Keep the editor's own Map JSON handler for complete interior export semantics.
    $('exportDiffBtn')?.addEventListener('click', handleDiffExport, { capture: true });
    $('diffDownloadBtn')?.addEventListener('click', handleDiffDownload, { capture: true });

    window.MapEditorExportFixes = {
      buildStandaloneMapExport,
      buildDetailedDiff,
      buildWorkspaceDiffBundle,
      captureMapBaseline, // Used after confirmed Town reload; other map baselines must not be erased.
      adoptBundledMapBaselines, // Accepts only newly imported indexed maps, without touching unrelated pending diffs.
      adoptBundledWorkspaceBaselines, // Accepts only newly imported canonical plateau groups and ramps.
      captureWorkspaceBaselines,
      debugSnapshot: () => ({
        installed,
        baselineIds: Array.from(baselineById.keys()),
        baselineMapIds: Array.from(baselineMapIds),
        activeMapId: activeMap()?.id || null,
        activeHasBaseline: baselineById.has(String(activeMap()?.id || '')), // Mobile-friendly baseline diagnostic.
        activeDiffSummary: activeMap() ? (buildDetailedDiff(activeMap()).summary || null) : null,
      }),
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
