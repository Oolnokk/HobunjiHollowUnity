// Eastern Mire archipelago terrain adapter.
(function (root) {
  'use strict';
  if (!root || root.EasternMireIslands) return;

  const ZONE_ID = 'map_eastern_mire';
  const WATER_TARGET = 0.78; // Used by diagnostics to catch seeds that become too land-heavy.
  const TARGET_ISLANDS = 10; // Used to leave enough distinct shelves for dens, locales, and temporary camps.
  const MIN_CENTER_GAP = 25; // Used when spacing filler islands so neighboring cliff rings stay visually separate.
  const BASE_RX = 16; // Used as the ordinary island horizontal radius in final, 2x-scaled wilderness tiles.
  const BASE_RY = 14; // Used as the ordinary island vertical radius in final, 2x-scaled wilderness tiles.
  const CAMP_HALF_SIZE = 6; // Used to clear a 13x13 flat pad around filler-island centers for 9x8 camps plus clearance.
  const INSTALL_POLL_MS = 25; // Used only during boot until WildernessMapGenerator becomes available.

  const WATER_TYPES = new Set(['river', 'stream', 'waterfall', 'trench']); // Used when converting inherited generator water back to dry island surface.

  function log(message, level = 'info') {
    const text = `[EasternMireIslands] ${message}`;
    if (typeof root.__farmLog === 'function') root.__farmLog(text, level, 'world');
    else if (level === 'warn' || level === 'error') console.warn(text);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function hashSeed(text) {
    let hash = 2166136261; // Used as the deterministic state for island placement/noise.
    for (const ch of String(text || 'eastern-mire')) {
      hash ^= ch.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function makeRng(seedText) {
    let state = hashSeed(seedText); // Used to place filler islands without disturbing the shared generator's RNG.
    return function random() {
      state += 0x6D2B79F5;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  function randBetween(random, min, max) {
    return min + (max - min) * random();
  }

  function rootMapOf(workspace) {
    return workspace?.maps?.find(map => map && !map.isSubmap) || workspace?.maps?.[0] || null;
  }

  function key(col, row) {
    return `${col},${row}`;
  }

  function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function makeCenter(kind, x, y, rx = BASE_RX, ry = BASE_RY, extra = {}) {
    return {
      kind,
      x: Math.round(x),
      y: Math.round(y),
      rx: Math.max(BASE_RX, Math.round(rx)),
      ry: Math.max(BASE_RY, Math.round(ry)),
      ...extra,
    };
  }

  function addSeparatedCenter(centers, candidate, minimumGap = MIN_CENTER_GAP) {
    if (!candidate || !Number.isFinite(candidate.x) || !Number.isFinite(candidate.y)) return false;
    if (centers.some(center => distance(center, candidate) < minimumGap)) return false;
    centers.push(candidate);
    return true;
  }

  function nearestCenter(centers, point) {
    return centers.reduce((best, center) => (
      !best || distance(center, point) < distance(best, point) ? center : best
    ), null);
  }

  function collectCenters(workspace, map, random) {
    const centers = []; // Used as the authoritative island list before terrain painting.
    const cols = Math.max(1, Number(map.cols) || 1);
    const rows = Math.max(1, Number(map.rows) || 1);

    if (workspace.entry && Number.isFinite(workspace.entry.col) && Number.isFinite(workspace.entry.row)) {
      const centerX = clamp(workspace.entry.col + BASE_RX - 1, BASE_RX + 2, cols - BASE_RX - 2); // Used to put the entry island inland while retaining a short landing.
      centers.push(makeCenter('entry', centerX, workspace.entry.row, BASE_RX + 2, BASE_RY + 1, {
        gateX: workspace.entry.col,
        gateY: workspace.entry.row,
      }));
    }

    for (const locale of workspace.localeInstances || []) {
      const width = Math.max(1, Number(locale.w) || 1);
      const height = Math.max(1, Number(locale.h) || 1);
      addSeparatedCenter(centers, makeCenter(
        'locale',
        Number(locale.x) + width * 0.5,
        Number(locale.y) + height * 0.5,
        width * 0.5 + 8,
        height * 0.5 + 8,
        { localeId: locale.localeId }
      ), 16);
    }

    for (const den of workspace.animalDens || []) {
      const width = Math.max(1, Number(den.w) || 1);
      const height = Math.max(1, Number(den.h) || 1);
      addSeparatedCenter(centers, makeCenter(
        'den',
        Number(den.x) + width * 0.5,
        Number(den.y) + height * 0.5,
        BASE_RX,
        BASE_RY,
        { denId: den.id }
      ), 18);
    }

    for (const totem of workspace.rootTotems || []) {
      const anchor = totem.pathAnchor || totem;
      addSeparatedCenter(centers, makeCenter(
        'totem',
        Number(anchor.x),
        Number(anchor.y),
        BASE_RX,
        BASE_RY,
        { totemId: totem.id }
      ), 18);
    }

    let attempts = 0; // Used to cap filler-island search work on crowded seeds.
    while (centers.length < TARGET_ISLANDS && attempts++ < 900) {
      const rx = Math.round(randBetween(random, BASE_RX + 1, BASE_RX + 4)); // Used to size a filler island's camp-capable inner shelf.
      const ry = Math.round(randBetween(random, BASE_RY + 1, BASE_RY + 4)); // Used to size a filler island's camp-capable inner shelf.
      const candidate = makeCenter(
        'open',
        randBetween(random, rx + 7, Math.max(rx + 7, cols - rx - 7)),
        randBetween(random, ry + 7, Math.max(ry + 7, rows - ry - 7)),
        rx,
        ry,
        { campShelf: true }
      );
      addSeparatedCenter(centers, candidate);
    }

    return centers;
  }

  function cellNoise(seed, col, row) {
    let hash = hashSeed(`${seed}|${Math.floor(col / 4)}|${Math.floor(row / 4)}`); // Used to roughen island contours without fragmenting their flat cores.
    hash ^= hash >>> 16;
    hash = Math.imul(hash, 0x7feb352d);
    hash ^= hash >>> 15;
    hash = Math.imul(hash, 0x846ca68b);
    hash ^= hash >>> 16;
    return (hash >>> 0) / 4294967296;
  }

  function islandTierAt(center, col, row, seed) {
    const dx = (col - center.x) / Math.max(1, center.rx);
    const dy = (row - center.y) / Math.max(1, center.ry);
    const radial = Math.sqrt(dx * dx + dy * dy);
    const edgeNoise = (cellNoise(`${seed}|${center.x}|${center.y}`, col, row) - 0.5) * 0.12; // Used only near island contours.
    const distorted = radial + edgeNoise * Math.max(0.18, radial);
    if (distorted > 1) return 0;
    if (distorted <= 0.50) return 3;
    if (distorted <= 0.76) return 2;
    return 1;
  }

  function buildIslandMask(centers, map, seedText) {
    const land = new Map(); // Used as the final per-tile island owner/tier lookup.
    for (let row = 0; row < map.rows; row++) {
      for (let col = 0; col < map.cols; col++) {
        let best = null; // Used to resolve overlap in favor of the island whose normalized center is closest.
        for (let index = 0; index < centers.length; index++) {
          const center = centers[index];
          const tier = islandTierAt(center, col, row, `${seedText}|${index}`);
          if (!tier) continue;
          const dx = (col - center.x) / Math.max(1, center.rx);
          const dy = (row - center.y) / Math.max(1, center.ry);
          const normalizedDistance = Math.sqrt(dx * dx + dy * dy); // Used only to pick one owner where island masks overlap.
          if (!best || normalizedDistance < best.normalizedDistance) {
            best = { islandIndex: index, tier, normalizedDistance };
          }
        }
        if (best) land.set(key(col, row), { islandIndex: best.islandIndex, tier: best.tier });
      }
    }
    return land;
  }

  function forceRect(land, map, center, x, y, w, h, tier = 3, pad = 2) {
    if (!center) return;
    const islandIndex = center.index; // Used to retain the anchored feature on the same island's plateau groups.
    const x0 = clamp(Math.floor(x) - pad, 0, map.cols - 1);
    const y0 = clamp(Math.floor(y) - pad, 0, map.rows - 1);
    const x1 = clamp(Math.ceil(x + Math.max(1, w) - 1) + pad, 0, map.cols - 1);
    const y1 = clamp(Math.ceil(y + Math.max(1, h) - 1) + pad, 0, map.rows - 1);
    for (let row = y0; row <= y1; row++) {
      for (let col = x0; col <= x1; col++) land.set(key(col, row), { islandIndex, tier, forcedAnchor: true });
    }
  }

  function preserveAnchoredFootprints(land, centers, workspace, map) {
    centers.forEach((center, index) => { center.index = index; });

    for (const locale of workspace.localeInstances || []) {
      const center = centers.find(item => item.localeId && item.localeId === locale.localeId)
        || nearestCenter(centers, { x: locale.x, y: locale.y });
      forceRect(land, map, center, locale.x, locale.y, locale.w || 1, locale.h || 1, 3, 3);
    }

    for (const den of workspace.animalDens || []) {
      const center = centers.find(item => item.denId && item.denId === den.id)
        || nearestCenter(centers, { x: den.x, y: den.y });
      forceRect(land, map, center, den.x, den.y, den.w || 1, den.h || 1, 3, 3);
      if (den.mouthAnchor) forceRect(land, map, center, den.mouthAnchor.x, den.mouthAnchor.y, 1, 1, 3, 2);
    }

    for (const totem of workspace.rootTotems || []) {
      const anchor = totem.pathAnchor || totem;
      const center = centers.find(item => item.totemId && item.totemId === totem.id)
        || nearestCenter(centers, anchor);
      forceRect(land, map, center, totem.x, totem.y, 1, 1, 3, 2);
      forceRect(land, map, center, anchor.x, anchor.y, 1, 1, 3, 2);
    }
  }

  function reserveCampPads(land, centers, map, originalTiles) {
    const pads = []; // Used both to clear generated clutter and to remove exported foliage furniture from future camp sites.
    for (let index = 0; index < centers.length; index++) {
      const center = centers[index];
      if (!center.campShelf) continue;
      const x0 = clamp(center.x - CAMP_HALF_SIZE, 0, map.cols - 1);
      const y0 = clamp(center.y - CAMP_HALF_SIZE, 0, map.rows - 1);
      const x1 = clamp(center.x + CAMP_HALF_SIZE, 0, map.cols - 1);
      const y1 = clamp(center.y + CAMP_HALF_SIZE, 0, map.rows - 1);
      pads.push({ x0, y0, x1, y1 });
      for (let row = y0; row <= y1; row++) {
        for (let col = x0; col <= x1; col++) {
          land.set(key(col, row), { islandIndex: index, tier: 3, campPad: true });
          originalTiles[key(col, row)] = { type: 'grass', crop: '' };
        }
      }
    }
    return pads;
  }

  function preserveThinRoutes(land, originalTiles, map) {
    let causewayTiles = 0;
    for (let row = 0; row < map.rows; row++) {
      for (let col = 0; col < map.cols; col++) {
        const tile = originalTiles[key(col, row)];
        if (tile?.type !== 'path' || land.has(key(col, row))) continue;
        land.set(key(col, row), { causeway: true, tier: 1, islandIndex: -1 });
        causewayTiles++;
      }
    }
    return causewayTiles;
  }

  function paintEntryLanding(land, centers, workspace, map) {
    const entryCenter = centers.find(center => center.kind === 'entry');
    if (!entryCenter || !workspace.entry) return 0;
    const gateX = clamp(Math.round(workspace.entry.col), 0, map.cols - 1);
    const gateY = clamp(Math.round(workspace.entry.row), 0, map.rows - 1);
    const targetX = clamp(Math.round(entryCenter.x), 0, map.cols - 1);
    const direction = targetX >= gateX ? 1 : -1;
    let painted = 0;
    for (let col = gateX; col !== targetX + direction; col += direction) {
      for (let dy = -1; dy <= 1; dy++) {
        const row = gateY + dy;
        if (row < 0 || row >= map.rows) continue;
        const tileKey = key(col, row);
        if (!land.has(tileKey)) {
          land.set(tileKey, { islandIndex: entryCenter.index || 0, tier: 1, entryLanding: true });
          painted++;
        }
      }
    }
    return painted;
  }

  function insidePad(col, row, pad) {
    return col >= pad.x0 && col <= pad.x1 && row >= pad.y0 && row <= pad.y1;
  }

  function filterCampPadExports(workspace, pads) {
    workspace.wildernessFoliageFurniture = (workspace.wildernessFoliageFurniture || []).filter(item => (
      !pads.some(pad => insidePad(item.col, item.row, pad))
    ));
    workspace.foliagePatches = (workspace.foliagePatches || []).filter(patch => {
      const point = patch.center || patch;
      const col = Number(point.x ?? point.col);
      const row = Number(point.y ?? point.row);
      return !Number.isFinite(col) || !Number.isFinite(row) || !pads.some(pad => insidePad(col, row, pad));
    });
    workspace.ambushStations = (workspace.ambushStations || []).filter(station => {
      const col = Number(station.x ?? station.col);
      const row = Number(station.y ?? station.row);
      return !Number.isFinite(col) || !Number.isFinite(row) || !pads.some(pad => insidePad(col, row, pad));
    });
  }

  function plateauIdFor(cell) {
    return cell.causeway ? 'eastern_mire_causeway_tier_1' : `eastern_mire_island_${cell.islandIndex + 1}_tier_${cell.tier}`;
  }

  function landTile(sourceTile, plateauId) {
    const tile = { ...(sourceTile || { type: 'grass', crop: '' }), plateau: plateauId };
    if (WATER_TYPES.has(tile.type)) tile.type = 'grass';
    tile.crop = tile.crop || '';
    delete tile.incline;
    delete tile.ramp;
    return tile;
  }

  function waterTile() {
    return { type: 'stream', crop: '' };
  }

  function rebuildWorkspace(workspace, map, land, originalTiles) {
    const newTiles = {}; // Used as the replacement root-map tile dictionary after archipelago carving.
    const groups = new Map(); // Used to emit one absolute-elevation plateau group per island shelf/causeway.
    let landCount = 0;
    let waterCount = 0;

    for (let row = 0; row < map.rows; row++) {
      for (let col = 0; col < map.cols; col++) {
        const tileKey = key(col, row);
        const cell = land.get(tileKey);
        if (!cell) {
          newTiles[tileKey] = waterTile();
          waterCount++;
          continue;
        }
        const plateauId = plateauIdFor(cell);
        const source = cell.causeway ? { type: 'path', crop: '' } : originalTiles[tileKey];
        newTiles[tileKey] = landTile(source, plateauId);
        groups.set(plateauId, cell.tier);
        landCount++;
      }
    }

    map.tiles = newTiles;
    map.visualHeights = {};
    workspace.ramps = [];
    workspace.plateauGroups = [...groups.entries()].map(([id, elevation]) => ({ id, elevation }));
    const islandSubmaps = workspace.plateauGroups.map(group => ({
      id: `map_generated_${group.id}`,
      category: map.category || 'exterior',
      isSubmap: true,
      parentMapId: map.id,
      plateauGroupId: group.id,
      cols: map.cols,
      rows: map.rows,
      tiles: {},
    })); // Used by the existing TerrainPreview/runtime fold to materialize the tiered island mesas.
    workspace.maps = [map, ...islandSubmaps];
    return { landCount, waterCount, plateauGroups: workspace.plateauGroups.length };
  }

  function applyToWorkspace(workspace, seedText = 'eastern-mire') {
    const map = rootMapOf(workspace);
    if (!map?.tiles || !Number.isFinite(map.cols) || !Number.isFinite(map.rows)) {
      log('Skipped archipelago pass because the generated workspace has no usable root map.', 'warn');
      return workspace;
    }

    const originalTiles = { ...map.tiles }; // Used as the dry-surface source for tiles retained on islands.
    const random = makeRng(`${seedText}|archipelago-centers`); // Used only for deterministic filler-island placement.
    const centers = collectCenters(workspace, map, random);
    if (!centers.length) {
      log('Skipped archipelago pass because no island centers could be generated.', 'warn');
      return workspace;
    }
    centers.forEach((center, index) => { center.index = index; });

    const land = buildIslandMask(centers, map, seedText);
    preserveAnchoredFootprints(land, centers, workspace, map);
    const campPads = reserveCampPads(land, centers, map, originalTiles); // Used to guarantee actual empty camp-capable ground, not merely a geometrically flat shelf.
    const causewayTiles = preserveThinRoutes(land, originalTiles, map); // Used to retain only the generator's narrow path crossings between otherwise separated islands.
    const entryLandingTiles = paintEntryLanding(land, centers, workspace, map); // Used to connect the west entry gate to its first island.
    filterCampPadExports(workspace, campPads);

    const stats = rebuildWorkspace(workspace, map, land, originalTiles);
    const total = Math.max(1, stats.landCount + stats.waterCount);
    const waterRatio = stats.waterCount / total; // Used by the mobile-visible debug summary and seed diagnostics.
    const openCampShelves = centers.filter(center => center.campShelf).length;

    map.generatedFrom = {
      ...(map.generatedFrom || {}),
      easternMireArchipelago: true,
      easternMireWaterRatio: Number(waterRatio.toFixed(4)),
      easternMireIslandCount: centers.length,
      easternMireOpenCampShelves: openCampShelves,
      easternMireCausewayTiles: causewayTiles,
      easternMireMaxTier: 3,
    };
    workspace.generatorPreset = {
      ...(workspace.generatorPreset || {}),
      easternMireArchipelago: true,
      waterDominant: true,
      maxTier: 3,
    };
    workspace.easternMireArchipelago = {
      islandCount: centers.length,
      openCampShelves,
      campPadSize: CAMP_HALF_SIZE * 2 + 1,
      causewayTiles,
      entryLandingTiles,
      waterRatio: Number(waterRatio.toFixed(4)),
      targetMinimumWaterRatio: WATER_TARGET,
      centers: centers.map(center => ({
        kind: center.kind,
        x: center.x,
        y: center.y,
        rx: center.rx,
        ry: center.ry,
      })),
    };

    const message = `rebuilt ${centers.length} short 3-tier island(s), ${openCampShelves} clear 13x13 camp pad(s), ${(waterRatio * 100).toFixed(1)}% water, ${causewayTiles} thin route tile(s)`;
    log(message, waterRatio + 0.001 < WATER_TARGET ? 'warn' : 'info');
    return workspace;
  }

  function easternMireOverrides(locales) {
    const eligibleLocales = (locales || []).filter(locale => {
      const allowed = locale?.placement?.allowedZones;
      return !Array.isArray(allowed) || allowed.length === 0 || allowed.includes(ZONE_ID);
    }); // Used to preserve the shared generator's allowed-zone locale filtering.

    return {
      entrySide: 'west',
      preset: 'custom',
      boundaryMode: 'followMapHeight',
      boundaryCliffBoost: 0,
      plateaus: 0,
      maxTier: 3,
      lowProfilePlateaus: true,
      ramps: 0,
      ponds: 0,
      plateauPonds: 0,
      plateauStreams: 0,
      rivers: 0,
      pathAnchors: 3,
      pathWindiness: 2,
      entryGateWidthMul: 0.55,
      animalDens: 5,
      rootTotems: 4,
      structures: 5,
      caves: 5,
      locales: eligibleLocales,
    };
  }

  function installGeneratorPatch() {
    const generator = root.WildernessMapGenerator;
    if (!generator?.generateZoneWorkspace || !generator?.generateWorkspace) return false;
    if (generator.__easternMireArchipelagoPatch) return true;

    const originalGenerateZoneWorkspace = generator.generateZoneWorkspace; // Used unchanged for every non-Eastern-Mire zone and as the fallback path.
    generator.generateZoneWorkspace = function generateZoneWorkspaceWithEasternMireIslands(zoneMapId, seedText, locales = []) {
      if (zoneMapId !== ZONE_ID) return originalGenerateZoneWorkspace.call(this, zoneMapId, seedText, locales);
      let value;
      try {
        value = generator.generateWorkspace(seedText, easternMireOverrides(locales));
      } catch (error) {
        log(`custom flat-base generation failed (${error?.message || error}); using the shared Eastern Mire generator before reshaping`, 'warn');
        value = originalGenerateZoneWorkspace.call(this, zoneMapId, seedText, locales);
      }
      const apply = workspace => applyToWorkspace(workspace, seedText);
      return value && typeof value.then === 'function' ? value.then(apply) : apply(value);
    };
    generator.__easternMireArchipelagoPatch = true;
    log('generator patch installed; Eastern Mire now uses water-dominant stepped islands.');
    return true;
  }

  let installTimer = null; // Used only until the main wilderness generator script is assigned during initial parsing.
  function ensureInstalled() {
    if (!installGeneratorPatch()) return false;
    if (installTimer !== null && typeof root.clearInterval === 'function') root.clearInterval(installTimer);
    installTimer = null;
    return true;
  }

  root.EasternMireIslands = Object.freeze({
    ZONE_ID,
    applyToWorkspace,
    installGeneratorPatch,
    ensureInstalled,
    targetWaterRatio: WATER_TARGET,
  });

  if (!ensureInstalled() && typeof root.setInterval === 'function') {
    installTimer = root.setInterval(ensureInstalled, INSTALL_POLL_MS);
  }
})(typeof window !== 'undefined' ? window : globalThis);
