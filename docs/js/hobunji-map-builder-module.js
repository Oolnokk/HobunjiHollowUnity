/* Hobunji Hollow HTML-stage map builder module.
 * This is intentionally browser-only and dependency-light so demos can load it from docs/js.
 * It centralizes indexes, JSON loading, map normalization, NPC lookup, house/wall/furniture/landscape placement,
 * and mobile-friendly debug reporting.
 */
(() => {
  'use strict';

  const DEFAULT_INDEX_URL = '../config/map-builder-index.json';
  const DEFAULT_TILE_SIZE = 1;

  function normalizeId(value, fallback = 'id') {
    const raw = String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
    return raw || `${fallback}_${Date.now().toString(36)}`;
  }

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function clampInt(value, min, max, fallback = min) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function uniqueById(items, fallbackPrefix) {
    const seen = new Set();
    return asArray(items).map((item, index) => {
      const out = item && typeof item === 'object' ? { ...item } : {};
      out.id = normalizeId(out.id || out.npcId || out.pieceId || out.recipeId || out.furnitureId || out.landscapeId || `${fallbackPrefix}_${index + 1}`, fallbackPrefix);
      let id = out.id;
      let suffix = 2;
      while (seen.has(id)) id = `${out.id}_${suffix++}`;
      out.id = id;
      seen.add(id);
      return out;
    });
  }

  async function fetchJson(url) {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Failed to load ${url}: HTTP ${response.status}`);
    return response.json();
  }

  function joinUrl(baseUrl, maybeRelative) {
    if (!maybeRelative) return '';
    try { return new URL(maybeRelative, baseUrl).toString(); }
    catch (_err) { return maybeRelative; }
  }

  function buildLookup(items, idKeys = ['id']) {
    const lookup = Object.create(null);
    asArray(items).forEach((item, index) => {
      if (!item || typeof item !== 'object') return;
      idKeys.forEach(key => {
        const id = normalizeId(item[key]);
        if (id && lookup[id] === undefined) lookup[id] = index;
      });
      asArray(item.aliases).forEach(alias => {
        const id = normalizeId(alias);
        if (id && lookup[id] === undefined) lookup[id] = index;
      });
    });
    return lookup;
  }

  function normalizeIndex(rawIndex, indexUrl = DEFAULT_INDEX_URL) {
    const baseUrl = new URL(indexUrl, document.baseURI).toString();
    const index = rawIndex && typeof rawIndex === 'object' ? { ...rawIndex } : {};
    index.schema = index.schema || 'hobunji-map-builder-index/v1';
    index.npcDatabases = uniqueById(index.npcDatabases, 'npc_database');
    index.townMaps = uniqueById(index.townMaps, 'town_map');
    index.housePieces = uniqueById(index.housePieces, 'house_piece');
    index.wallRecipes = uniqueById(index.wallRecipes, 'wall_recipe');
    index.furniture = uniqueById(index.furniture, 'furniture');
    index.distantLandscape = uniqueById(index.distantLandscape, 'landscape');

    for (const collectionName of ['npcDatabases', 'townMaps', 'housePieces', 'wallRecipes', 'furniture', 'distantLandscape']) {
      index[collectionName].forEach(entry => {
        for (const key of ['url', 'jsonUrl', 'modelUrl', 'recipeUrl', 'thumbnailUrl', 'previewUrl']) {
          if (entry[key]) entry[key] = joinUrl(baseUrl, entry[key]);
        }
      });
    }

    index.generatedIndexes = {
      npcDatabaseById: buildLookup(index.npcDatabases),
      townMapById: buildLookup(index.townMaps),
      housePieceById: buildLookup(index.housePieces, ['id', 'pieceId']),
      wallRecipeById: buildLookup(index.wallRecipes, ['id', 'recipeId']),
      furnitureById: buildLookup(index.furniture, ['id', 'furnitureId']),
      landscapeById: buildLookup(index.distantLandscape, ['id', 'landscapeId'])
    };
    return index;
  }

  function makeLogger(targetElement) {
    const lines = [];
    return {
      lines,
      log(message, level = 'info') {
        const line = `[${new Date().toLocaleTimeString()}] ${level}: ${message}`;
        lines.push(line);
        if (lines.length > 260) lines.shift();
        if (targetElement) {
          targetElement.textContent = lines.slice(-120).join('\n');
          targetElement.scrollTop = targetElement.scrollHeight;
        }
        const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
        console[method](line);
      }
    };
  }

  function normalizeTownMap(rawMap = {}) {
    const source = rawMap.map ? rawMap : { map: rawMap };
    const map = { ...(source.map || {}) };
    map.id = normalizeId(map.id || source.id || source.mapId || 'hobunji_map', 'map');
    map.name = map.name || map.displayName || source.displayName || map.id;
    map.cols = clampInt(map.cols ?? map.columns, 8, 240, 48);
    map.rows = clampInt(map.rows ?? map.height ?? source.rows, 8, 240, 32);
    map.tileSize = Number(map.tileSize || source.tileSize || DEFAULT_TILE_SIZE) || DEFAULT_TILE_SIZE;

    const houses = uniqueById(source.houses || source.houseFootprints, 'house').map(h => ({
      ...h,
      x: clampInt(h.x, 0, map.cols - 1, 0),
      y: clampInt(h.y, 0, map.rows - 1, 0),
      width: clampInt(h.width || h.w, 1, map.cols, 4),
      depth: clampInt(h.depth || h.d || h.height, 1, map.rows, 4),
      rotationDeg: Number(h.rotationDeg ?? h.rotation ?? 0) || 0,
      pieceId: normalizeId(h.pieceId || h.housePieceId || h.footprintType || 'highland_room_default', 'house_piece'),
      wallRecipeId: normalizeId(h.wallRecipeId || h.wallRecipe || 'roughbrick_default', 'wall_recipe'),
      furnitureSetId: normalizeId(h.furnitureSetId || h.furnitureSet || '', 'furniture_set')
    }));

    const npcPaths = uniqueById(source.npcPaths || source.paths, 'npc_path').map(p => ({
      ...p,
      npcId: normalizeId(p.npcId || p.npc || '', 'npc'),
      nodes: asArray(p.nodes).map((node, index) => ({
        x: clampInt(node.x, 0, map.cols - 1, 0),
        y: clampInt(node.y, 0, map.rows - 1, 0),
        label: node.label || `node_${index + 1}`
      }))
    }));

    const furniture = uniqueById(source.furniture || source.furniturePlacements, 'furniture_instance').map(f => ({
      ...f,
      furnitureId: normalizeId(f.furnitureId || f.assetId || f.kind || f.id, 'furniture'),
      houseId: normalizeId(f.houseId || '', 'house'),
      x: clampInt(f.x, 0, map.cols - 1, 0),
      y: clampInt(f.y, 0, map.rows - 1, 0),
      rotationDeg: Number(f.rotationDeg ?? f.rotation ?? 0) || 0
    }));

    const distantLandscape = uniqueById(source.distantLandscape || source.landscape || source.backgroundPlacements, 'landscape_instance').map(l => ({
      ...l,
      landscapeId: normalizeId(l.landscapeId || l.assetId || l.kind || l.id, 'landscape'),
      x: clampInt(l.x, -9999, 9999, 0),
      y: clampInt(l.y, -9999, 9999, 0),
      rotationDeg: Number(l.rotationDeg ?? l.rotation ?? 0) || 0,
      scale: Number(l.scale || 1) || 1
    }));

    return {
      schema: source.schema || 'hobunji-town-map/v1',
      editor: source.editor || 'hobunji-map-builder-module',
      map,
      houses,
      npcPaths,
      npcSchedules: asArray(source.npcSchedules || source.schedules),
      npcs: asArray(source.npcs || source.npcPlacements),
      furniture,
      distantLandscape,
      implementationHints: asArray(source.implementationHints)
    };
  }

  function deriveDoorTile(house) {
    const side = house.door?.side || house.doorSide || 'south';
    const offset = clampInt(house.door?.offset ?? house.doorOffset ?? 0, 0, Math.max(house.width, house.depth), 0);
    if (side === 'north') return { x: house.x + Math.min(offset, house.width - 1), y: house.y - 1, side };
    if (side === 'east') return { x: house.x + house.width, y: house.y + Math.min(offset, house.depth - 1), side };
    if (side === 'west') return { x: house.x - 1, y: house.y + Math.min(offset, house.depth - 1), side };
    return { x: house.x + Math.min(offset, house.width - 1), y: house.y + house.depth, side: 'south' };
  }

  function deriveOccupiedTiles(houses) {
    const out = [];
    asArray(houses).forEach(house => {
      for (let y = 0; y < house.depth; y++) {
        for (let x = 0; x < house.width; x++) out.push({ houseId: house.id, x: house.x + x, y: house.y + y });
      }
    });
    return out;
  }

  function resolveEntry(index, collectionName, lookupName, id) {
    const normalized = normalizeId(id);
    const collection = asArray(index[collectionName]);
    const lookup = index.generatedIndexes?.[lookupName] || buildLookup(collection);
    const matchIndex = lookup[normalized];
    return matchIndex === undefined ? null : collection[matchIndex] || null;
  }

  async function loadNpcDatabase(entryOrUrl) {
    const url = typeof entryOrUrl === 'string' ? entryOrUrl : (entryOrUrl?.jsonUrl || entryOrUrl?.url);
    if (!url) return { schema: 'hobunji-npc-database/v1', npcs: [] };
    const db = await fetchJson(url);
    const npcs = asArray(db.npcs || db.characters || db.records).map(npc => ({
      ...npc,
      id: normalizeId(npc.id || npc.npcId || npc.name, 'npc')
    }));
    return { ...db, npcs, npcById: buildLookup(npcs, ['id', 'npcId', 'name']) };
  }

  function buildMapBundle(mapState, index, npcDatabase = null) {
    const normalized = normalizeTownMap(mapState);
    const npcById = npcDatabase?.npcById || buildLookup(asArray(npcDatabase?.npcs), ['id', 'npcId', 'name']);
    const housePlans = normalized.houses.map(house => ({
      house,
      doorTile: deriveDoorTile(house),
      housePiece: resolveEntry(index, 'housePieces', 'housePieceById', house.pieceId),
      wallRecipe: resolveEntry(index, 'wallRecipes', 'wallRecipeById', house.wallRecipeId),
      furniture: normalized.furniture.filter(f => f.houseId === house.id)
    }));
    const npcPlans = normalized.npcPaths.map(path => ({
      path,
      npc: asArray(npcDatabase?.npcs)[npcById[normalizeId(path.npcId)]] || null,
      scheduleBlocks: normalized.npcSchedules.filter(s => normalizeId(s.npcId) === normalizeId(path.npcId))
    }));
    const furniturePlans = normalized.furniture.map(furniture => ({
      placement: furniture,
      asset: resolveEntry(index, 'furniture', 'furnitureById', furniture.furnitureId)
    }));
    const landscapePlans = normalized.distantLandscape.map(landscape => ({
      placement: landscape,
      asset: resolveEntry(index, 'distantLandscape', 'landscapeById', landscape.landscapeId)
    }));
    return {
      ...normalized,
      generatedAt: new Date().toISOString(),
      derived: {
        houseDoorTiles: normalized.houses.map(deriveDoorTile),
        occupiedFootprintTiles: deriveOccupiedTiles(normalized.houses),
        housePlans,
        npcPlans,
        furniturePlans,
        landscapePlans,
        missing: {
          housePieces: housePlans.filter(p => !p.housePiece).map(p => p.house.pieceId),
          wallRecipes: housePlans.filter(p => !p.wallRecipe).map(p => p.house.wallRecipeId),
          furniture: furniturePlans.filter(p => !p.asset).map(p => p.placement.furnitureId),
          landscape: landscapePlans.filter(p => !p.asset).map(p => p.placement.landscapeId),
          npcs: npcPlans.filter(p => !p.npc).map(p => p.path.npcId)
        }
      }
    };
  }

  function makeHouseFootprintFromPlacement(house) {
    const cells = [];
    for (let y = 0; y < house.depth; y++) for (let x = 0; x < house.width; x++) cells.push({ x, y });
    const door = deriveDoorTile({ ...house, x: 0, y: 0 });
    return {
      schema: 'modular-house-piece-author/v37-derived-placement',
      id: house.pieceId || house.id,
      name: house.label || house.id,
      type: house.footprintType || 'house',
      preset: 'highland',
      gridSize: Math.max(house.width, house.depth) + 4,
      tileSize: 1,
      footprint: {
        cells,
        entrances: [{ x: Math.max(0, Math.min(house.width - 1, door.x)), y: Math.max(0, Math.min(house.depth - 1, door.y)) }],
        connectors: [],
        extensions: { entryTunnels: [], chimneys: [], porches: [], porchStairs: [], railings: [] }
      }
    };
  }

  window.HobunjiMapBuilder = {
    DEFAULT_INDEX_URL,
    normalizeId,
    normalizeIndex,
    normalizeTownMap,
    loadIndex: async (url = DEFAULT_INDEX_URL) => normalizeIndex(await fetchJson(url), url),
    loadNpcDatabase,
    buildMapBundle,
    makeHouseFootprintFromPlacement,
    deriveDoorTile,
    deriveOccupiedTiles,
    makeLogger,
    fetchJson
  };
})();
