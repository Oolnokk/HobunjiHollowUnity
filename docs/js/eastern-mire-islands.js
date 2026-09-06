// Eastern Mire archipelago terrain adapter.
//
// The shared wilderness generator intentionally stays generic. This module is
// loaded by debug.js before the generator, then waits for WildernessMapGenerator
// and wraps only map_eastern_mire. The underlying generator still owns locale,
// den, root-totem, flora/resource and route placement; this pass reshapes the
// finished Map Editor workspace into low, stepped islands surrounded by water.
(function (root) {
  'use strict';
  if (!root || root.EasternMireIslands) return;

  const ZONE_ID = 'map_eastern_mire';
  const WATER_TARGET = 0.78; // Used by archipelago diagnostics; the layout aims to keep at least this much of the mire as open water.
  const TARGET_ISLANDS = 10; // Used to keep enough separate shelves for dens, locales, camps, and other temporary wilderness content.
  const MIN_CENTER_GAP = 24; // Used while adding unanchored islands so their cliff rings do not merge into one continent.
  const BASE_RX = 17; // Used as the horizontal radius of ordinary islands in final, already-2x-scaled wilderness tiles.
  const BASE_RY = 15; // Used as the vertical radius of ordinary islands in final, already-2x-scaled wilderness tiles.
  const OUTER_TIER_EDGE = 1.0;
  const MID_TIER_EDGE = 0.74;
  const CORE_TIER_EDGE = 0.46;
  const INSTALL_POLL_MS = 25; // Used only during boot until WildernessMapGenerator has been assigned.

  const SPECIAL_DRY_TYPES = new Set([
    'path', 'grass', 'shrub', 'weeds', 'tilled', 'raised', 'ramp', 'paddy',
    'rock', 'ore', 'tree', 'stump', 'log', 'forage', 'treasure'
  ]); // Used to retain ordinary generated tile content when that tile lands on an island.

  function log(message, level = 'info') {
    const text = `[EasternMireIslands] ${message}`;
    if (typeof root.__farmLog === 'function') root.__farmLog(text, level, 'world');
    else if (level === 'warn' || level === 'error') console.warn(text);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function hashSeed(text) {
    let h = 2166136261;
    const source = String(text || 'eastern-mire');
    for (let i = 0; i < source.length; i++) {
      h ^= source.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function makeRng(seedText) {
    let state = hashSeed(seedText);
    return function random() {
      state += 0x6D2B79F5;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function randBetween(random, min, max) {
    return min + (max - min) * random();
  }

  function rootMapOf(workspace) {
    return workspace?.maps?.find(map => map && !map.isSubmap) || workspace?.maps?.[0] || null;
  }

  function tileKey(col, row) {
    return `${col},${row}`;
  }

  function pointDistance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function addCenterIfSeparated(centers, candidate, minimumGap = MIN_CENTER_GAP) {
    if (!candidate || !Number.isFinite(candidate.x) || !Number.isFinite(candidate.y)) return false;
    if (centers.some(center => pointDistance(center, candidate) < minimumGap)) return false;
    centers.push(candidate);
    return true;
  }

  function makeAnchorCenter(kind, x, y, rx = BASE_RX, ry = BASE_RY, extra = {}) {
    return {
      kind,
      x: Math.round(x),
      y: Math.round(y),
      rx: Math.max(BASE_RX, Math.round(rx)),
      ry: Math.max(BASE_RY, Math.round(ry)),
      ...extra,
    };
  }

  function collectAnchorCenters(workspace, map, random) {
    const centers = []; // Used as the authoritative island-center list before filler islands are added.
    const cols = Math.max(1, Number(map.cols) || 1);
    const rows = Math.max(1, Number(map.rows) || 1);

    if (workspace.entry && Number.isFinite(workspace.entry.col) && Number.isFinite(workspace.entry.row)) {
      // Entry is on the west boundary. Move the island core inland, then keep a
      // narrow dry landing tongue back to the actual gate later.
      const entryCenterX = clamp(workspace.entry.col + BASE_RX - 2, BASE_RX + 2, cols - BASE_RX - 2); // Used to keep the west gate from cutting only a tiny crescent off the entry island.
      centers.push(makeAnchorCenter('entry', entryCenterX, workspace.entry.row, BASE_RX + 2, BASE_RY + 1, {
        gateX: workspace.entry.col,
        gateY: workspace.entry.row,
      }));
    }

    for (const locale of workspace.localeInstances || []) {
      const width = Math.max(1, Number(locale.w) || 1);
      const height = Math.max(1, Number(locale.h) || 1);
      const center = makeAnchorCenter(
        'locale',
        Number(locale.x) + width * 0.5,
        Number(locale.y) + height * 0.5,
        width * 0.5 + 9,
        height * 0.5 + 9,
        { localeId: locale.localeId }
      );
      addCenterIfSeparated(centers, center, Math.max(14, Math.min(center.rx, center.ry) * 0.72));
    }

    for (const den of workspace.animalDens || []) {
      const width = Math.max(1, Number(den.w) || 1);
      const height = Math.max(1, Number(den.h) || 1);
      const center = makeAnchorCenter(
        'den',
        Number(den.x) + width * 0.5,
        Number(den.y) + height * 0.5,
        BASE_RX,
        BASE_RY,
        { denId: den.id }
      );
      addCenterIfSeparated(centers, center, 18);
    }

    for (const totem of workspace.rootTotems || []) {
      const anchor = totem.pathAnchor || totem;
      const center = makeAnchorCenter('totem', Number(anchor.x), Number(anchor.y), BASE_RX - 1, BASE_RY - 1, { totemId: totem.id });
      addCenterIfSeparated(centers, center, 18);
    }

    // Filler islands are intentionally large enough that their inner tier-3
    // shelf can host the 9x8 small bandit-camp locale plus clearance.
    let attempts = 0;
    while (centers.length < TARGET_ISLANDS && attempts++ < 700) {
      const rx = Math.round(randBetween(random, BASE_RX, BASE_RX + 4)); // Used for filler-island camp shelf width.
      const ry = Math.round(randBetween(random, BASE_RY, BASE_RY + 4)); // Used for filler-island camp shelf depth.
      const candidate = makeAnchorCenter(
        'open',
        randBetween(random, rx + 7, cols - rx - 7),
        randBetween(random, ry + 7, rows - ry - 7),
        rx,
        ry,
        { campShelf: true }
      );
      addCenterIfSeparated(centers, candidate);
    }

    // Very small test maps can make the normal gap impossible. Do not leave
    // them with zero filler coverage; relax spacing only after normal attempts.
    attempts = 0;
    while (centers.length < Math.min(TARGET_ISLANDS, 6) && attempts++ < 300) {
      const candidate = makeAnchorCenter(
        'open',
        randBetween(random, BASE_RX + 2, Math.max(BASE_RX + 2, cols - BASE_RX - 2)),
        randBetween(random, BASE_RY + 2, Math.max(BASE_RY + 2, rows - BASE_RY - 2)),
        BASE_RX,
        BASE_RY,
        { campShelf: true }
      );
      addCenterIfSeparated(centers, candidate, 14);
    }

    return centers;
  }

  function noiseForCell(seed, col, row) {
    // Integer hash rather than Math.random keeps every Tothal seed perfectly
    // repeatable and avoids changing the generator's own RNG sequence.
    let h = hashSeed(`${seed}|${Math.floor(col / 4)}|${Math.floor(row / 4)}`);
    h ^= h >>> 16;
    h = Math.imul(h, 0x7feb352d);
    h ^= h >>> 15;
    h = Math.imul(h, 0x846ca68b);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  function islandTierAt(center, col, row, seed) {
    const dx = (col - center.x) / Math.max(1, center.rx);
    const dy = (row - center.y) / Math.max(1, center.ry);
    const radial = Math.sqrt(dx * dx + dy * dy);
    // boundaryNoise is used only to make the shoreline and shelf contours
    // organic; its amplitude is intentionally too small to break the broad
    // flat camp/den core in the middle of an island.
    const boundaryNoise = (noiseForCell(`${seed}|${center.x}|${center.y}`, col, row) - 0.5) * 0.13;
    const distorted = radial + boundaryNoise * Math.max(0.18, radial);
    if (distorted > OUTER_TIER_EDGE) return 0;
    if (distorted <= CORE_TIER_EDGE) return 3;
    if (distorted <= MID_TIER_EDGE) return 2;
    return 1;
  }

  function chooseIslandOwnership(centers, col, row, seed) {
    let best = null; // Used to resolve overlap by the deepest normalized point, keeping tiers stable where two islands nearly touch.
    for (let index = 0; index < centers.length; index++) {
      const center = centers[index];
      const tier = islandTierAt(center, col, row, `${seed}|${index}`);
      if (!tier) continue;
      const dx = (col - center.x) / Math.max(1, center.rx);
      const dy = (row - center.y) / Math.max(1, center.ry);
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (!best || distance < best.distance) best = { index, center, tier, distance };
    }
    return best;
  }

  function makeWaterTile(oldTile) {
    const tile = { type: 'stream', crop: '' }; // Used as the canonical shallow-mire water tile; stream is the runtime's existing permanent water surface type.
    if (oldTile?.visualHeight != null) tile.visualHeight = 0;
    return tile;
  }

  function makeLandTile(oldTile, plateauId) {
    const source = oldTile && typeof oldTile === 'object' ? oldTile : { type: 'grass', crop: '' };
    const tile = { ...source, plateau: plateauId };
    // Water/ramp artifacts from the discarded flat generator layout must not
    // punch accidental holes through the new island shelves.
    if (!SPECIAL_DRY_TYPES.has(tile.type) && ['river', 'stream', 'waterfall', 'trench'].includes(tile.type)) tile.type = 'grass';
    tile.crop = tile.crop || '';
    return tile;
  }

  function paintEntryLanding(landByKey, centers, workspace, map) {
    const entryCenter = centers.find(center => center.kind === 'entry');
    if (!entryCenter || !workspace.entry) return;
    const gateX = clamp(Math.round(workspace.entry.col), 0, map.cols - 1);
    const gateY = clamp(Math.round(workspace.entry.row), 0, map.rows - 1);
    const islandX = clamp(Math.round(entryCenter.x), 0, map.cols - 1);
    const direction = islandX >= gateX ? 1 : -1;
    // A three-tile-wide low shelf joins the actual gate to the first island.
    // It is deliberately short and narrow, so it reads as a landing/causeway
    // rather than turning the watery biome back into continuous land.
    for (let x = gateX; x !== islandX + direction; x += direction) {
      for (let dy = -1; dy <= 1; dy++) {
        const y = gateY + dy;
        if (x < 0 || y < 0 || x >= map.cols || y >= map.rows) continue;
        const key = tileKey(x, y);
        if (!landByKey.has(key)) landByKey.set(key, { islandIndex: 0, tier: 1, forcedLanding: true });
      }
    }
  }

  function plateauIdFor(islandIndex, tier) {
    return `eastern_mire_island_${islandIndex + 1}_tier_${tier}`;
  }

  function rebuildPlateauWorkspace(workspace, map, landByKey, originalTiles) {
    const oldNonTerrainSubmaps = (workspace.maps || []).filter(submap => {
      if (!submap?.isSubmap) return false;
      const id = String(submap.id || '');
      const group = String(submap.plateauGroupId || '');
      return !id.startsWith('map_generated_wilderness_') && !group.startsWith('generated_');
    }); // Used to retain any authored/non-generator submaps while replacing generated terrain mesas.

    const usedGroups = new Map(); // Used to emit exactly one plateau group/submap for each island tier that actually has cells.
    const newTiles = {};
    let landCount = 0;
    let waterCount = 0;

    for (let row = 0; row < map.rows; row++) {
      for (let col = 0; col < map.cols; col++) {
        const key = tileKey(col, row);
        const land = landByKey.get(key);
        if (!land) {
          newTiles[key] = makeWaterTile(originalTiles[key]);
          waterCount++;
          continue;
        }
        const plateauId = plateauIdFor(land.islandIndex, land.tier);
        newTiles[key] = makeLandTile(originalTiles[key], plateauId);
        usedGroups.set(plateauId, land.tier);
        landCount++;
      }
    }

    map.tiles = newTiles;
    workspace.plateauGroups = [...usedGroups.entries()].map(([id, elevation]) => ({ id, elevation }));
    const generatedSubmaps = workspace.plateauGroups.map(group => ({
      id: `map_generated_${group.id}`,
      category: map.category || 'exterior',
      isSubmap: true,
      parentMapId: map.id,
      plateauGroupId: group.id,
      cols: map.cols,
      rows: map.rows,
      tiles: {},
    })); // Used by TerrainPreview/runtime folding to materialize each absolute-elevation island shelf as a mesa.
    workspace.maps = [map, ...oldNonTerrainSubmaps, ...generatedSubmaps];
    return { landCount, waterCount, plateauGroups: workspace.plateauGroups.length };
  }

  function preserveAnchoredFootprints(landByKey, centers, workspace, map) {
    const forceRect = (x, y, w, h, center, tier = 3, pad = 2) => {
      if (!center) return;
      const index = Math.max(0, centers.indexOf(center));
      const x0 = clamp(Math.floor(x) - pad, 0, map.cols - 1);
      const y0 = clamp(Math.floor(y) - pad, 0, map.rows - 1);
      const x1 = clamp(Math.ceil(x + w) + pad, 0, map.cols - 1);
      const y1 = clamp(Math.ceil(y + h) + pad, 0, map.rows - 1);
      for (let row = y0; row <= y1; row++) {
        for (let col = x0; col <= x1; col++) landByKey.set(tileKey(col, row), { islandIndex: index, tier, forcedAnchor: true });
      }
    };

    for (const locale of workspace.localeInstances || []) {
      const center = centers.find(item => item.localeId && item.localeId === locale.localeId)
        || centers.reduce((best, item) => !best || pointDistance(item, { x: locale.x, y: locale.y }) < pointDistance(best, { x: locale.x, y: locale.y }) ? item : best, null);
      forceRect(locale.x, locale.y, locale.w || 1, locale.h || 1, center, 3, 3);
    }
    for (const den of workspace.animalDens || []) {
      const center = centers.find(item => item.denId && item.denId === den.id)
        || centers.reduce((best, item) => !best || pointDistance(item, { x: den.x, y: den.y }) < pointDistance(best, { x: den.x, y: den.y }) ? item : best, null);
      forceRect(den.x, den.y, den.w || 1, den.h || 1, center, 3, 3);
      if (den.mouthAnchor) forceRect(den.mouthAnchor.x, den.mouthAnchor.y, 1, 1, center, 3, 2);
    }
    for (const totem of workspace.rootTotems || []) {
      const anchor = totem.pathAnchor || totem;
      const center = centers.find(item => item.totemId && item.totemId === totem.id)
        || centers.reduce((best, item) => !best || pointDistance(item, anchor) < pointDistance(best, anchor) ? item : best, null);
      forceRect(totem.x, totem.y, 1, 1, center, 3, 2);
      forceRect(anchor.x, anchor.y, 1, 1, center, 3, 2);
    }
  }

  function applyToWorkspace(workspace, seedText = 'eastern-mire') {
    const map = rootMapOf(workspace);
    if (!map?.tiles || !Number.isFinite(map.cols) || !Number.isFinite(map.rows)) {
      log('Skipped archipelago pass: generated workspace has no usable root map.', 'warn');
      return workspace;
    }

    const random = makeRng(`${seedText}|archipelago-centers`); // Used only for deterministic filler-island positions and sizes.
    const centers = collectAnchorCenters(workspace, map, random);
    if (!centers.length) {
      log('Skipped archipelago pass: no island centers could be generated.', 'warn');
      return workspace;
    }

    const originalTiles = map.tiles;
    const landByKey = new Map(); // Used as the final per-tile island owner/tier mask before rewriting the workspace.
    for (let row = 0; row < map.rows; row++) {
      for (let col = 0; col < map.cols; col++) {
        const owner = chooseIslandOwnership(centers, col, row, seedText);
        if (owner) landByKey.set(tileKey(col, row), { islandIndex: owner.index, tier: owner.tier });
      }
    }

    preserveAnchoredFootprints(landByKey, centers, workspace, map);
    paintEntryLanding(landByKey, centers, workspace, map);
    const stats = rebuildPlateauWorkspace(workspace, map, landByKey, originalTiles);
    const total = Math.max(1, stats.landCount + stats.waterCount);
    const waterRatio = stats.waterCount / total; // Used in mobile-visible debug output to catch seeds that accidentally merge too much land.
    const openCampShelves = centers.filter(center => center.campShelf).length;

    map.generatedFrom = {
      ...(map.generatedFrom || {}),
      easternMireArchipelago: true,
      easternMireWaterRatio: Number(waterRatio.toFixed(4)),
      easternMireIslandCount: centers.length,
      easternMireOpenCampShelves: openCampShelves,
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
      waterRatio: Number(waterRatio.toFixed(4)),
      targetMinimumWaterRatio: WATER_TARGET,
      centers: centers.map(center => ({ kind: center.kind, x: center.x, y: center.y, rx: center.rx, ry: center.ry })),
    };

    const percent = (waterRatio * 100).toFixed(1);
    const message = `rebuilt ${centers.length} short 3-tier island(s), ${openCampShelves} open camp shelf(s), ${percent}% water, ${stats.plateauGroups} plateau groups`;
    log(message, waterRatio + 0.001 < WATER_TARGET ? 'warn' : 'info');
    return workspace;
  }

  function easternMireOverrides(locales) {
    const eligible = (locales || []).filter(locale => {
      const allowed = locale?.placement?.allowedZones;
      return !Array.isArray(allowed) || allowed.length === 0 || allowed.includes(ZONE_ID);
    }); // Used to preserve the generator's normal allowed-zone locale filtering when bypassing its old Great Basin Eastern Mire preset.
    return {
      entrySide: 'west',
      preset: 'custom',
      boundaryMode: 'followMapHeight',
      boundaryCliffBoost: 0,
      plateaus: 0,
      maxTier: 3,
      lowProfilePlateaus: true,
      plateauAreaMul: 1,
      wideRamps: true,
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
      locales: eligible,
    };
  }

  function installGeneratorPatch() {
    const generator = root.WildernessMapGenerator;
    if (!generator?.generateZoneWorkspace || !generator?.generateWorkspace) return false;
    if (generator.__easternMireArchipelagoPatch) return true;

    const original = generator.generateZoneWorkspace; // Retained for every non-Eastern-Mire zone and as an integration fallback.
    generator.generateZoneWorkspace = function generateZoneWorkspaceWithEasternMireIslands(zoneMapId, seedText, locales = []) {
      if (zoneMapId !== ZONE_ID) return original.call(this, zoneMapId, seedText, locales);
      let value;
      try {
        value = generator.generateWorkspace(seedText, easternMireOverrides(locales));
      } catch (error) {
        log(`custom flat-base generation failed (${error?.message || error}); falling back to shared zone generator before island pass`, 'warn');
        value = original.call(this, zoneMapId, seedText, locales);
      }
      const apply = workspace => applyToWorkspace(workspace, seedText);
      return value && typeof value.then === 'function' ? value.then(apply) : apply(value);
    };
    generator.__easternMireArchipelagoPatch = true;
    log('generator patch installed; Eastern Mire now uses water-dominant stepped islands.');
    return true;
  }

  let installTimer = null; // Used only until the main generator script becomes available during initial page parsing.
  function ensureInstalled() {
    if (installGeneratorPatch()) {
      if (installTimer !== null) clearInterval(installTimer);
      installTimer = null;
      return true;
    }
    return false;
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
