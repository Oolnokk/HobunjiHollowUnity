(() => {
  'use strict';

  // Procedural cavern generation for animal dens. generateCavernFloor grows
  // a branching maze of tunnels from a fixed entrance row and SDF-carves it
  // via CavernSculptor (see cavern-sculptor.js — the tunnel-carving engine
  // ported from docs/references/(HA)TunnelSculptorV1.html), then snaps the
  // carved shape onto the tile grid the rest of the game already expects —
  // the claimed tiles from that snap pass *are* the room's floor tile set.
  // pickDenMotherKind picks which native species' Den-Mother variant guards
  // the nest; pickOreRockTiles/pickCreatureSpawnTiles scatter a few
  // mineable ore rocks and regular (non-Den-Mother) wildlife through the
  // tunnels so there's a real crawl before the boss chamber.
  // synthesizeCavernMapData combines all of it into the same map-data shape
  // loadBuildingScene expects from a real config/maps/*.json file — see
  // game.js's "map_i_den_" handling.
  // Extracted out of game.js following the same window.<Namespace> +
  // init(deps) pattern as its sibling systems. Pure data generation — no
  // THREE.js/scene-graph calls at all (cavern-sculptor.js keeps the same
  // discipline), deterministic per seed string — so this is an even
  // cleaner candidate than most of what's left in game.js for eventually
  // running standalone (e.g. server-side, for multiplayer).
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  // How many floor tiles a den's cavern should aim for — bumped up from the
  // old blob-growth generator's 40-80 range so there's room for a real
  // "bigger, tunnely" crawl (regular wildlife between the entrance and the
  // Den-Mother's nest) rather than one small room.
  const TARGET_TILES_MIN = 70, TARGET_TILES_MAX = 130;

  // Mirrors spawnPackAtDen's den population resolution. A zone-authored
  // denSpecies list overrides general pack/herd ecology; legacy zones without
  // one retain the deterministic predator-pack XOR herbivore-herd choice.
  function nativeSpeciesFor(mapId) {
    const zoneId = window.WildlifeSpawn.denCavernZoneOf(mapId);
    const zoneDef = deps.EXTERIOR_ZONES[zoneId];
    const exactDenSpecies = window.WildlifeSpawn.denSpeciesFor(zoneId, mapId); // Same per-den deterministic authored species used by exterior den guards.
    const packSpecies = zoneDef?.packSpecies || [];
    const herbivoreSpecies = zoneDef?.herbivoreSpecies || [];
    if (exactDenSpecies) return { zoneId, nativeSpecies: [exactDenSpecies] };
    const hasPack = packSpecies.length, hasHerd = herbivoreSpecies.length;
    const rng = (typeof WildernessMapGenerator !== 'undefined' && WildernessMapGenerator.makeRng) ? WildernessMapGenerator.makeRng(mapId + '_denpop') : Math.random;
    const useHerd = hasHerd && (!hasPack || rng() < 0.5);
    return { zoneId, nativeSpecies: useHerd ? herbivoreSpecies : packSpecies };
  }

  // generateCavernFloor's SDF carve is real work (not the cheap blob-growth
  // it replaced) — and it's already called twice per den visit by design
  // (once by game.js's denTransitions setup, purely for exitCol/exitRow,
  // and again by synthesizeCavernMapData when the scene actually builds).
  // Cached per seed string so the second call is free; safe because the
  // result is deterministic per seed and no caller mutates the returned
  // floor/mesh data after receiving it.
  const _cavernFloorCache = new Map();

  function entranceConnectedFloor(floor, exitCol, exitRow) {
    const floorSet = new Set(floor.map(([col, row]) => `${col},${row}`)); // Used to discard any isolated carved pocket that cannot be reached from the cave mouth.
    const startKey = `${exitCol},${exitRow}`;
    if (!floorSet.has(startKey)) return { floor: [...floor], removed: 0 };
    const reached = new Set([startKey]);
    const queue = [[exitCol, exitRow]];
    for (let index = 0; index < queue.length; index++) {
      const [col, row] = queue[index];
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const next = `${col + dc},${row + dr}`;
        if (!floorSet.has(next) || reached.has(next)) continue;
        reached.add(next);
        queue.push([col + dc, row + dr]);
      }
    }
    return { floor: floor.filter(([col, row]) => reached.has(`${col},${row}`)), removed: floor.length - reached.size };
  }

  function generateCavernFloor(seedText, generationOptions = {}) {
    const singleRoom = generationOptions.singleRoom === true; // Explicit callers may request a compact room; named story caves no longer leak into the generic generator through map-id special cases.
    const cacheKey = `${seedText}${generationOptions.fast ? ':fast' : ''}${singleRoom ? ':single-room' : ''}`; // Used to prevent a normal den carve from poisoning the one-room cache.
    const useCache = generationOptions.cache !== false; // Regenerating roguelike floors opt out so one cache entry is not retained for every visit.
    if (useCache && _cavernFloorCache.has(cacheKey)) return _cavernFloorCache.get(cacheKey);
    const makeRng = (typeof WildernessMapGenerator !== 'undefined' && WildernessMapGenerator.makeRng) ? WildernessMapGenerator.makeRng : (s => { let a = 1; for (let i = 0; i < s.length; i++) a = (a * 33 + s.charCodeAt(i)) >>> 0; return () => (a = (a * 1664525 + 1013904223) >>> 0) / 4294967296; });
    const rng = makeRng(seedText + '_cavern');
    const targetTiles = TARGET_TILES_MIN + Math.floor(rng() * (TARGET_TILES_MAX - TARGET_TILES_MIN + 1));
    // branchCount is the main knob controlling how many tiles the maze
    // ends up claiming — scaled from the target so bigger dens actually
    // grow bigger networks instead of just denser/thicker corridors.
    const branchCount = singleRoom ? 0 : Math.max(6, Math.round(targetTiles / 7)); // Used to eliminate side tunnels in Banubu's private cavern while preserving ordinary den branching.
    // entranceLength (the root's point count, see carveMazeCavern) has to
    // scale right alongside branchCount — a short root with a lot of
    // branches all crowd the same small patch near the entrance and merge
    // into one open pit with no walls between corridors, instead of a real
    // branching network. Root points are spaced one branchLength apart, so
    // this gives every branch genuine room to land somewhere distinct.
    const entranceLength = singleRoom ? 4 : Math.max(6, Math.round(branchCount * 0.6)); // Used by the sculptor's entrance/root sizing for the compact home cavern.

    // Half the tool's own default tile size (1) — same physical cave, but
    // snapped to a twice-as-fine tile grid, so dens read as genuinely
    // bigger maps (roughly 4x the tile count for the same footprint)
    // without changing how large or branchy the actual carve is.
    const tileSize = 0.5;
    const sculptOptions = singleRoom
      ? { branchCount: 0, entranceLength, tileSize, pathPointCount: 4, pathWiggle: 0.08, turnChaos: 0, loopChance: 0, probeRadius: 1.05, brushRadius: 0.42, gridN: generationOptions.fast ? 32 : 48, splineSamples: 5, hitsPerStep: 2, probeDigBursts: 3, probeMaxPasses: 70, enforceWalkableClearance: 1 }
      : generationOptions.fast
        ? { branchCount, entranceLength, tileSize, gridN: 32, splineSamples: 5, hitsPerStep: 1, probeDigBursts: 2, probeMaxPasses: 45, enforceWalkableClearance: 1 }
        : { branchCount, entranceLength, tileSize };
    const result = window.CavernSculptor.carveMazeCavern(sculptOptions, rng);

    // Shift every tile coordinate (and the mesh's X/Z) from the sculptor's
    // arbitrary centered local space into positive grid space, same +1
    // margin convention the old blob-growth generator used so nothing sits
    // flush against col/row 0.
    let minX = Infinity, minY = Infinity;
    for (const key of result.claimed) { const [x, y] = key.split(',').map(Number); if (x < minX) minX = x; if (y < minY) minY = y; }
    const shiftX = -minX + 1, shiftY = -minY + 1;

    const carvedFloor = [...result.claimed].map(key => { const [x, y] = key.split(',').map(Number); return [x + shiftX, y + shiftY]; });
    const exitTiles = result.entranceTiles.map(([x, y]) => [x + shiftX, y + shiftY]);
    const [nfx, nfy] = result.nestTile;

    const positions = result.mesh.positions;
    for (let i = 0; i < positions.length; i += 3) { positions[i] += shiftX; positions[i + 2] += shiftY; }

    // exitCol/exitRow used to be hardcoded to local (0,0)+shift — a leftover
    // from before the entrance moved off the origin (see carveMazeCavern's
    // own entranceZ). That silently broke the "exact
    // guaranteed-walkable spawn tile" path game.js's loadBuildingScene uses
    // for cavern dens specifically (its _pendingEntrySpawnFromExit comment:
    // the generic buildingSpawnFromExit heuristic "can land outside the
    // organic floor blob") — exitCol/exitRow always being wrong (and, worse,
    // never even reaching mapData — see synthesizeCavernMapData below) meant
    // every den fell back to that generic heuristic, which could spawn the
    // player overlapping solid rock at the entrance. The middle exitTiles
    // entry is the same guaranteed-walkable tile carveMazeCavern itself
    // already treats as "the" entrance (see its own startKey).
    const [exitCol, exitRow] = exitTiles[Math.floor(exitTiles.length / 2)];
    const connected = entranceConnectedFloor(carvedFloor, exitCol, exitRow); // Used as the authoritative collision floor so an isolated SDF pocket can never become a spawnable room.
    const floor = connected.floor;
    const cols = Math.max(...floor.map(f => f[0])) + 2, rows = Math.max(...floor.map(f => f[1])) + 2;
    const floorKeys = new Set(floor.map(([col, row]) => `${col},${row}`));
    let nestCol = nfx + shiftX, nestRow = nfy + shiftY;
    if (!floorKeys.has(`${nestCol},${nestRow}`)) {
      const nestCandidates = floor.filter(([col, row]) => floorKeys.has(`${col + 1},${row}`) && floorKeys.has(`${col},${row + 1}`) && floorKeys.has(`${col + 1},${row + 1}`)); // Used to preserve the Den-Mother's complete 2x2 objective footprint after pocket removal.
      [nestCol, nestRow] = (nestCandidates.length ? nestCandidates : floor).reduce((best, tile) => {
        const bestDistance = Math.abs(best[0] - exitCol) + Math.abs(best[1] - exitRow);
        const tileDistance = Math.abs(tile[0] - exitCol) + Math.abs(tile[1] - exitRow);
        return tileDistance > bestDistance ? tile : best;
      }, (nestCandidates.length ? nestCandidates : floor)[0]); // Used to keep the den objective in the retained entrance component if malformed sculpt output ever isolates its original nest.
    }

    const floorResult = {
      floor, cols, rows,
      exitCol, exitRow,
      exitTiles,
      nestCol, nestRow,
      disconnectedFloorTilesRemoved: connected.removed,
      mesh: { positions, indices: result.mesh.indices },
    };
    if (useCache) _cavernFloorCache.set(cacheKey, floorResult);
    return floorResult;
  }

  // Deterministic per den: a handful of sparse mineable ore rock tiles,
  // reusing the exact same rockKind:'diggableRockOre' mechanic and oreKind
  // flavors the wilderness zones already use (see
  // wilderness-map-generator.js's oreKinds and game.js's isMineableRockTile/
  // mine-reward code) — mining one grants the same Stone/Pebble reward as
  // any other ore rock; oreKind only changes the mound's look and rarity
  // weighting, not a distinct reward, so there's nothing new to invent here.
  const ORE_KINDS = ['stone', 'stone', 'stone', 'copper', 'tin', 'iron', 'silver'];

  function pickOreRockTiles(rng, floor, excludeSet) {
    const candidates = floor.filter(([c, r]) => !excludeSet.has(`${c},${r}`));
    const count = Math.max(1, Math.min(4, Math.round(candidates.length / 18)));
    const picks = [];
    const used = new Set();
    let guard = 0;
    while (picks.length < count && guard++ < count * 20 && candidates.length) {
      const [c, r] = candidates[Math.floor(rng() * candidates.length)];
      const key = `${c},${r}`;
      if (used.has(key)) continue;
      used.add(key);
      picks.push({ col: c, row: r, oreKind: ORE_KINDS[Math.floor(rng() * ORE_KINDS.length)] });
    }
    return picks;
  }

  // A few regular (non-Den-Mother) creatures from the same native pool
  // pickDenMotherKind draws from, scattered between the entrance and the
  // nest — "bigger, tunnely" dens should read as a real crawl through the
  // Den-Mother's pack before the boss chamber, not an empty hallway.
  function pickCreatureSpawnTiles(rng, floor, excludeSet, nativeSpecies) {
    if (!nativeSpecies.length) return [];
    const candidates = floor.filter(([c, r]) => !excludeSet.has(`${c},${r}`));
    const count = Math.max(2, Math.min(6, Math.round(candidates.length / 14)));
    const picks = [];
    const used = new Set();
    let guard = 0;
    while (picks.length < count && guard++ < count * 20 && candidates.length) {
      const [c, r] = candidates[Math.floor(rng() * candidates.length)];
      const key = `${c},${r}`;
      if (used.has(key)) continue;
      used.add(key);
      picks.push({ col: c, row: r, kind: nativeSpecies[Math.floor(rng() * nativeSpecies.length)] });
    }
    return picks;
  }

  // Deterministic per den (same mapId -> same pick every time): choose a
  // Den-Mother only from the predator/herbivore species native to this
  // cavern's exterior zone. DEN_MOTHER_DEFS maps each base species to its
  // mother variant and nest reward, keeping Grehlr in the north and
  // Drenkirra in the southern cloud forest all the way through the den.
  function pickDenMotherKind(mapId) {
    const rng = (typeof WildernessMapGenerator !== 'undefined' && WildernessMapGenerator.makeRng) ? WildernessMapGenerator.makeRng(mapId + '_denmother') : Math.random;
    const { zoneId, nativeSpecies } = nativeSpeciesFor(mapId);
    const kinds = nativeSpecies.map(kind => deps.DEN_MOTHER_DEFS[kind]?.creatureKey).filter(Boolean);
    if (!kinds.length) {
      window.__farmLog?.(`[wildlife] ${mapId}: no native Den-Mother configured for zone "${zoneId || 'unknown'}".`, 'warn');
      return null;
    }
    return kinds[Math.floor(rng() * kinds.length)];
  }

  const _localeCavernDefsByMapId = new Map(); // Resolved cave-interior locales, keyed by their runtime map id.
  const _knownLocaleCavernMapIds = new Set(); // Index-only knowledge lets game.js classify a cave before its scene finishes loading.
  let _localeCavernIndexPromise = null; // One repo-index fetch per page; individual cave definitions are fetched lazily.

  function localOverrideCavern(mapId) {
    if (window.LocalDBOverrides?.getSourceMode?.() !== 'local') return null;
    const override = window.LocalDBOverrides.getOverride?.('locales');
    return (override?.locales || []).find(locale =>
      locale?.category === 'cave_interior' && String(locale?.cavern?.mapId || '') === String(mapId || '')) || null;
  }

  async function localeCavernIndex() {
    if (_localeCavernIndexPromise) return _localeCavernIndexPromise;
    _localeCavernIndexPromise = (async () => {
      try {
        const response = await fetch('config/locales/index.json', { cache: 'no-store' });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const index = await response.json();
        for (const entry of (index.locales || [])) {
          if (entry?.category === 'cave_interior' && entry.mapId) _knownLocaleCavernMapIds.add(String(entry.mapId));
        }
        return index;
      } catch (error) {
        console.warn('[CavernGenerator] cave locale index failed to load:', error);
        return { locales: [] };
      }
    })();
    return _localeCavernIndexPromise;
  }

  async function loadLocaleCavernDefinition(mapId) {
    const id = String(mapId || '');
    if (!id) return null;
    const local = localOverrideCavern(id);
    if (local) {
      _knownLocaleCavernMapIds.add(id);
      return local;
    }
    if (_localeCavernDefsByMapId.has(id)) return _localeCavernDefsByMapId.get(id);
    const index = await localeCavernIndex();
    const entry = (index.locales || []).find(candidate =>
      candidate?.category === 'cave_interior' && String(candidate?.mapId || '') === id);
    if (!entry?.file) return null;
    try {
      const response = await fetch(entry.file, { cache: 'no-store' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const locale = await response.json();
      if (locale?.category !== 'cave_interior' || String(locale?.cavern?.mapId || '') !== id) {
        throw new Error('locale cavern mapId/category mismatch');
      }
      _localeCavernDefsByMapId.set(id, locale);
      _knownLocaleCavernMapIds.add(id);
      return locale;
    } catch (error) {
      console.warn('[CavernGenerator] cave locale failed to load for ' + id + ':', error);
      return null;
    }
  }

  function isLocaleCavernMapId(mapId) {
    const id = String(mapId || '');
    if (!id) return false;
    if (localOverrideCavern(id)) return true;
    return _knownLocaleCavernMapIds.has(id) || _localeCavernDefsByMapId.has(id);
  }

  function facingRotation(side) {
    return ({ north: 0, east: 90, south: 180, west: 270 })[String(side || 'south').toLowerCase()] ?? 180;
  }

  function localeFootprint(locale) {
    return Object.keys(locale?.tiles || {}).map(key => key.split(',').map(Number))
      .filter(([col, row]) => Number.isFinite(col) && Number.isFinite(row));
  }

  function sampleMeshSurfaceAt(triangles, worldX, worldZ) {
    let bestY = Infinity; // Lowest standable surface underneath this tile center.
    for (const triangle of triangles || []) { // Spatial bin contains only triangles whose bounds cover this center.
      const { ax, ay, az, bx, by, bz, cx, cy, cz, denom } = triangle;
      const wa = ((bz - cz) * (worldX - cx) + (cx - bx) * (worldZ - cz)) / denom; // Barycentric weights interpolate the carved surface.
      const wb = ((cz - az) * (worldX - cx) + (ax - cx) * (worldZ - cz)) / denom;
      const wc = 1 - wa - wb;
      if (wa < -1e-5 || wb < -1e-5 || wc < -1e-5) continue;
      const y = wa * ay + wb * by + wc * cy; // Sampled floor height, independent of triangle tessellation size.
      if (Number.isFinite(y) && y < bestY) bestY = y;
    }
    return Number.isFinite(bestY) ? bestY : null;
  }

  function floorSurfaceMap(floor, mesh) {
    const bins = new Map(); // Index only requested tile centers so sampling no longer scans the full mesh for every floor tile.
    for (const [col, row] of floor || []) bins.set(`${col},${row}`, []);
    const positions = mesh?.positions || [], indices = mesh?.indices || []; // Read each mesh triangle once while building the temporary spatial index.
    for (let i = 0; i + 2 < indices.length; i += 3) {
      const ia = indices[i] * 3, ib = indices[i + 1] * 3, ic = indices[i + 2] * 3; // Vertex offsets for this triangle.
      const ax = positions[ia], ay = positions[ia + 1], az = positions[ia + 2];
      const bx = positions[ib], by = positions[ib + 1], bz = positions[ib + 2];
      const cx = positions[ic], cy = positions[ic + 1], cz = positions[ic + 2];
      if (![ax, ay, az, bx, by, bz, cx, cy, cz].every(Number.isFinite)) continue;
      const abx = bx - ax, aby = by - ay, abz = bz - az; // Edges used to measure slope independently of triangle area.
      const acx = cx - ax, acy = cy - ay, acz = cz - az;
      const nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx;
      const denom = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz); // Projected area used for barycentric interpolation.
      if (Math.abs(denom) < 1e-12 || Math.abs(ny) < Math.hypot(nx, ny, nz) * 0.5) continue;
      const triangle = { ax, ay, az, bx, by, bz, cx, cy, cz, denom }; // Shared by all tile bins overlapped by this triangle.
      const minCol = Math.ceil(Math.min(ax, bx, cx) - 0.5 - 1e-5), maxCol = Math.floor(Math.max(ax, bx, cx) - 0.5 + 1e-5);
      const minRow = Math.ceil(Math.min(az, bz, cz) - 0.5 - 1e-5), maxRow = Math.floor(Math.max(az, bz, cz) - 0.5 + 1e-5);
      for (let row = minRow; row <= maxRow; row++) {
        for (let col = minCol; col <= maxCol; col++) bins.get(`${col},${row}`)?.push(triangle);
      }
    }
    const byTile = {}; // Serialized onto mapData for shared gameplay and rendering grounding.
    const samples = [], missing = []; // Missing samples use the median of valid samples instead of dragging it toward zero.
    for (const [col, row] of floor || []) {
      const key = `${col},${row}`; // Lookup for this tile's triangles and final height.
      const y = sampleMeshSurfaceAt(bins.get(key), Number(col) + 0.5, Number(row) + 0.5);
      if (y === null) missing.push(key);
      else { byTile[key] = y; samples.push(y); }
    }
    samples.sort((a, b) => a - b);
    const median = samples.length ? samples[Math.floor(samples.length / 2)] : 0; // Stable fallback for missing/degenerate mesh coverage.
    for (const key of missing) byTile[key] = median;
    return { byTile, median };
  }

  function synthesizeLocaleCavernMapData(locale) {
    const cavern = locale?.cavern || {};
    const mapId = String(cavern.mapId || '');
    if (!mapId) throw new Error('cave_interior locale is missing cavern.mapId');
    const floor = localeFootprint(locale);
    if (!floor.length) throw new Error(locale.id + ' has no painted cavern footprint');
    const connectors = Array.isArray(locale.connectors) ? locale.connectors : [];
    const primary = connectors.find(connector => connector.id === cavern.primaryEntranceConnectorId) || connectors[0];
    if (!primary) throw new Error(locale.id + ' has no cavern connector/entrance');
    const seedText = String(cavern.seed || locale.id || mapId);
    const makeRng = (typeof WildernessMapGenerator !== 'undefined' && WildernessMapGenerator.makeRng)
      ? WildernessMapGenerator.makeRng
      : (seed => { let a = 1; for (let i = 0; i < seed.length; i++) a = (a * 33 + seed.charCodeAt(i)) >>> 0; return () => (a = (a * 1664525 + 1013904223) >>> 0) / 4294967296; });
    const generated = window.CavernSculptor.carveFootprintCavern(
      floor,
      { ...(cavern.generation || {}), entrance: { col: primary.col, row: primary.row, side: primary.side } },
      makeRng(seedText + '_locale_cavern')
    );
    const floorSurface = floorSurfaceMap(floor, generated.mesh); // Couples logical standing height to the actual carved mesh instead of an invisible Y=0 plane.

    const exits = connectors.map(connector => ({
      id: connector.id,
      label: connector.label || connector.id,
      tiles: [[Number(connector.col), Number(connector.row)]],
      targetMap: String(connector.targetMap || ''),
      targetSpotId: String(connector.targetSpotId || ''),
      spawnCol: Number.isFinite(Number(connector.spawnCol)) ? Number(connector.spawnCol) : 0,
      spawnRow: Number.isFinite(Number(connector.spawnRow)) ? Number(connector.spawnRow) : 0,
      requiresKeyItem: String(connector.requiresKeyItem || ''),
      hiddenUntilKeyItem: connector.hiddenUntilKeyItem === true,
      doorFurnitureKey: String(connector.doorFurnitureKey || ''),
      side: String(connector.side || 'south'),
    }));
    const entrySpots = Object.fromEntries(connectors.map(connector => [
      connector.id,
      { col: Number(connector.col), row: Number(connector.row), side: String(connector.side || 'south') },
    ]));
    const keyGatedDoors = connectors.filter(connector => connector.requiresKeyItem).map(connector => ({
      id: connector.id,
      col: Number(connector.col),
      row: Number(connector.row),
      rotY: facingRotation(connector.side),
      side: String(connector.side || 'south'),
      requiresKeyItem: String(connector.requiresKeyItem),
      hiddenUntilKeyItem: connector.hiddenUntilKeyItem === true,
      furnitureKey: String(connector.doorFurnitureKey || 'door'),
    }));
    const npcStations = (locale.npcAnchors || []).map(anchor => ({
      id: anchor.id,
      label: anchor.name || anchor.id,
      npcId: anchor.npcId || '',
      col: Number(anchor.col),
      row: Number(anchor.row),
      rotY: facingRotation(anchor.facing),
      pose: anchor.pose || 'stand',
      toolKey: anchor.toolKey || '',
      toolIntervalSec: Number(anchor.toolIntervalSec) || 0,
      toolAnimStyle: anchor.toolAnimStyle || '',
    }));
    const furniture = (locale.objects || []).filter(object => object.itemKey).map(object => ({
      id: object.id,
      itemKey: object.itemKey,
      col: Number(object.col),
      row: Number(object.row),
      rotY: Number(object.rot ?? object.rotY) || 0,
    }));

    return {
      schema: 'hobunji_building_interior.v1',
      id: mapId,
      name: locale.name || mapId,
      cols: Number(locale.cols) || (Math.max(...floor.map(tile => tile[0])) + 2),
      rows: Number(locale.rows) || (Math.max(...floor.map(tile => tile[1])) + 2),
      floor,
      floorSurfaceByTile: floorSurface.byTile,
      floorSurfaceY: floorSurface.median,
      colliders: [],
      exits,
      entrySpots,
      keyGatedDoors,
      entranceLightTiles: [[Number(primary.col), Number(primary.row)]],
      furniture,
      npcStations,
      wallStyle: 'cavern',
      exitCol: Number(primary.col),
      exitRow: Number(primary.row),
      disconnectedFloorTilesRemoved: 0,
      mesh: generated.mesh,
      oreRocks: [],
      creatureSpawns: [],
      denMotherKind: null,
      localeId: locale.id,
      cavernSeed: seedText,
      cavernCreatureKind: String(cavern.creatureKind || ''),
      cavernFeatures: cavern.features || {},
      isLocaleCavern: true,
    };
  }

  function synthesizeCavernMapData(mapId) {
    // Ordinary wildlife dens remain fully procedural. Named/story caverns are
    // authored as cave_interior locales and use synthesizeLocaleCavernMapData
    // instead, so this generic path no longer knows about Banubu or any other
    // individual cave by map id.
    const { floor, cols, rows, exitCol, exitRow, exitTiles, nestCol, nestRow, disconnectedFloorTilesRemoved, mesh } = generateCavernFloor(mapId, { fast: true });
    const floorSurface = floorSurfaceMap(floor, mesh); // Ordinary dens now share the same rendered-surface grounding contract as authored locale caverns.
    const makeRng = (typeof WildernessMapGenerator !== 'undefined' && WildernessMapGenerator.makeRng) ? WildernessMapGenerator.makeRng : (() => Math.random);
    const decorRng = makeRng(mapId + '_decor');
    const excludeSet = new Set([...exitTiles, [nestCol, nestRow], [nestCol + 1, nestRow], [nestCol, nestRow + 1], [nestCol + 1, nestRow + 1]].map(([c, r]) => c + ',' + r));
    const { nativeSpecies } = nativeSpeciesFor(mapId);
    const oreRocks = pickOreRockTiles(decorRng, floor, excludeSet);
    const creatureSpawns = pickCreatureSpawnTiles(decorRng, floor, excludeSet, nativeSpecies);

    return {
      schema: 'hobunji_building_interior.v1',
      id: mapId, name: 'A Dark Burrow',
      cols, rows,
      exits: [{ id: 'den_exit', label: 'Back outside', tiles: exitTiles, targetMap: '', spawnCol: 0, spawnRow: 0 }],
      colliders: [], floor,
      floorSurfaceByTile: floorSurface.byTile, floorSurfaceY: floorSurface.median,
      furniture: [],
      wallStyle: 'cavern',
      exitCol, exitRow,
      disconnectedFloorTilesRemoved,
      mesh,
      oreRocks, creatureSpawns,
      nestCol, nestRow, denMotherKind: pickDenMotherKind(mapId),
    };
  }

  window.CavernGenerator = {
    init,
    generateCavernFloor,
    entranceConnectedFloor,
    pickDenMotherKind,
    synthesizeCavernMapData,
    loadLocaleCavernDefinition,
    synthesizeLocaleCavernMapData,
    isLocaleCavernMapId,
  };
})();
