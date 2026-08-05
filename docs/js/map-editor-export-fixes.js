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
  const baselineObjectById = new Map();
  let installed = false;
  let mapListObserver = null;

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
    if (map?.category === 'building_interior') return buildBuildingInteriorExport(map);
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
    return JSON.stringify(value);
  }

  function tileDiff(beforeTiles, afterTiles) {
    const before = tilesToDictionary(beforeTiles);
    const after = tilesToDictionary(afterTiles);
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
      diff.fallbackReason = 'no-baseline';
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
      diff.mode = 'full-map-fallback';
      diff.fallbackReason = 'no-detected-changes';
      diff._note = 'No differences were detected against the session baseline, so the complete current map is included.';
      diff.fullMap = buildStandaloneMapExport(map);
    }
    return diff;
  }

  function captureMapBaseline(map, force = false) {
    if (!map?.id) return;
    if (!force && baselineObjectById.get(map.id) === map) return;
    baselineById.set(String(map.id), mapSnapshot(map));
    baselineObjectById.set(String(map.id), map);
  }

  function captureWorkspaceBaselines(force = false) {
    const ws = workspace();
    if (!ws || !Array.isArray(ws.maps)) return;
    for (const map of ws.maps) captureMapBaseline(map, force);
  }

  function installMapListObserver() {
    const list = $('mapList');
    if (!list || mapListObserver) return;
    mapListObserver = new MutationObserver(() => captureWorkspaceBaselines(false));
    mapListObserver.observe(list, { childList: true, subtree: true });
  }

  function stopOriginal(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function handleMapExport(event) {
    stopOriginal(event);
    try {
      const map = activeMap();
      if (!map) throw new Error('No active map is available.');
      const output = buildStandaloneMapExport(map);
      const suffix = map.category === 'building_interior' ? '.json' : '.map.json';
      downloadJson(`${fileStem(map.name)}${suffix}`, output);
      setStattÊX\˜Ø]YÛÜHOOH	ØZ[[™×Ú[\š[Ü‰ÈÈ	ĞZ[[™È[\š[Üˆ”ÓÓˆİÛ›ØYY‰Èˆ	ÓX\”ÓÓˆİÛ›ØYY‰ÊNÂˆHØ]Ú
\œ›ÜŠHÂˆÛÛœÛÛK™\œ›ÜŠ	ÓX\”ÓÓˆ^Ü˜Z[Y‰Ë\œ›ÜŠNÂˆÙ]İ]\ÊX\”ÓÓˆ^Ü˜Z[Yˆ	Ù\œ›ÜË›Y\ÜØYÙH\œ›ÜŸX
NÂˆBˆB‚ˆ[˜İ[Ûˆ[™QY™‘^Ü
]™[
HÂˆİÜÜšYÚ[˜[
]™[
NÂˆHÂˆÛÛœİX\HXİ]™SX\

NÂˆYˆ
[X\
H›İÈ™]È\œ›ÜŠ	Ó›ÈXİ]™HX\\È]˜Z[X›K‰ÊNÂˆÛÛœİY™ˆHZ[]Z[YY™ŠX\
NÂˆÛÛœİœÛÛˆH”ÓÓ‹œİš[™ÚYJY™‹[ŠNÂˆYˆ
	
	ÙY™•]IÊJH	
	ÙY™•]IÊK^ÛÛ[Hİš[™ÊX\›˜[YH	ÓX\	ÊNÂˆYˆ
	
	ÙY™”İX]IÊJHÂˆYˆ
Y™‹›[ÙHOOH	Ù[[X\Y˜[˜XÚÉÊHÂˆ	
	ÙY™”İX]IÊK^ÛÛ[H	ÙY™‹—Û›İ_H0­È	ÚœÛÛ‹›[™İÓØØ[Tİš[™Ê
_HÚ\œØÂˆH[ÙHÂˆ	
	ÙY™”İX]IÊK^ÛÛ[H	ÙY™‹œİ[[X\K[PÚ[™Ù\ßH[HÚ[™ÙIÙY™‹œİ[[X\K[PÚ[™Ù\ÈOOHHÈ	ÉÈˆ	ÜÉßH0­È	ÙY™‹œİ[[X\K˜Ú[™ÙYšY[Ë›[™İHÚ[™ÙYšY[	ÙY™‹œİ[[X\K˜Ú[™ÙYšY[Ë›[™İOOHHÈ	ÉÈˆ	ÜÉßH0­È	ÚœÛÛ‹›[™İÓØØ[Tİš[™Ê
_HÚ\œØÂˆBˆBˆYˆ
	
	ÙY™•^\™XIÊJH	
	ÙY™•^\™XIÊK˜[YHHœÛÛÂˆYˆ
	
	ÙY™“[Ù[	ÊJH	
	ÙY™“[Ù[	ÊKœİ[K™\Ü^HH	Ø›ØÚÉÎÂˆHØ]Ú
\œ›ÜŠHÂˆÛÛœÛÛK™\œ›ÜŠ	ÓX\Y™ˆ^Ü˜Z[Y‰Ë\œ›ÜŠNÂˆÙ]İ]\ÊX\Y™ˆ^Ü˜Z[Yˆ	Ù\œ›ÜË›Y\ÜØYÙH\œ›ÜŸX
NÂˆBˆB‚ˆ[˜İ[Ûˆ[™QY™‘İÛ›ØY
]™[
HÂˆİÜÜšYÚ[˜[
]™[
NÂˆHÂˆÛÛœİX\HXİ]™SX\

NÂˆÛÛœİ^H	
	ÙY™•^\™XIÊOË˜[YH	ÉÎÂˆÛÛœİ\œÙYH”ÓÓ‹œ\œÙJ^
NÂˆİÛ›ØYœÛÛŠ	Ùš[Tİ[JX\Ë›˜[YJ_K™Y™‹šœÛÛ˜\œÙY
NÂˆÙ]İ]\Ê	ÑY™ˆİÛ›ØYY‰ÊNÂˆHØ]Ú
\œ›ÜŠHÂˆÛÛœÛÛK™\œ›ÜŠ	ÑY™ˆİÛ›ØY˜Z[Y‰Ë\œ›ÜŠNÂˆÙ]İ]\ÊY™ˆİÛ›ØY˜Z[Yˆ	Ù\œ›ÜË›Y\ÜØYÙH\œ›ÜŸX
NÂˆBˆB‚ˆ[˜İ[Ûˆ[œİ[

HÂˆYˆ
[œİ[Y
H™]\›ÂˆÛÛœİœšYÙHHÚ[™İË—ÛX\Y]ÜœšYÙNÂˆYˆ
XœšYÙOË™Ù]ÛÜšÜÜXÙJHÂˆÙ][Y[İ]
[œİ[JNÂˆ™]\›ÂˆBˆ[œİ[YHYNÂˆØ\\™UÛÜšÜÜXÙP˜\Ù[[™\ÊYJNÂˆ[œİ[X\\İØœÙ\™\Š
NÂˆ	
	Ù^ÜX\‰ÊOË˜Y]™[\İ[™\Š	ØÛXÚÉË[™SX\^ÜÈØ\\™NˆYHJNÂˆ	
	Ù^ÜY™‰ÊOË˜Y]™[\İ[™\Š	ØÛXÚÉË[™QY™‘^ÜÈØ\\™NˆYHJNÂˆ	
	ÙY™‘İÛ›ØY‰ÊOË˜Y]™[\İ[™\Š	ØÛXÚÉË[™QY™‘İÛ›ØYÈØ\\™NˆYHJNÂ‚ˆÚ[™İË“X\Y]Ü‘^Üš^\ÈHÂˆZ[İ[™[Û™SX\^ÜˆZ[]Z[YY™‹ˆØ\\™UÛÜšÜÜXÙP˜\Ù[[™\Îˆ

HOˆØ\\™UÛÜšÜÜXÙP˜\Ù[[™\ÊYJKˆXYÔÛ˜\Úİˆ

HOˆ
Âˆ[œİ[Yˆ˜\Ù[[™RYÎˆ\œ˜^K™œ›ÛJ˜\Ù[[™PRYšÙ^\Ê
JKˆXİ]™SX\YˆXİ]™SX\

OËšY[ˆJKˆNÂˆB‚ˆYˆ
Øİ[Y[œ™XYTİ]HOOH	ÛØY[™ÉÊHØİ[Y[˜Y]™[\İ[™\Š	ÑÓPÛÛ[ØYY	Ë[œİ[ÈÛ˜ÙNˆYHJNÂˆ[ÙH[œİ[

NÂŸJJ
NÂ