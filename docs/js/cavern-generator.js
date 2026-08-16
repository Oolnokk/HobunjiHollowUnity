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

  function nativeSpeciesFor(mapId) {
    const zoneId = window.WildlifeSpawn.denCavernZoneOf(mapId);
    const zoneDef = deps.EXTERIOR_ZONES[zoneId];
    return { zoneId, nativeSpecies: [...(zoneDef?.packSpecies || []), ...(zoneDef?.herbivoreSpecies || [])] };
  }

  // generateCavernFloor's SDF carve is real work (not the cheap blob-growth
  // it replaced) — and it's already called twice per den visit by design
  // (once by game.js's denTransitions setup, purely for exitCol/exitRow,
  // and again by synthesizeCavernMapData when the scene actually builds).
  // Cached per seed string so the second call is free; safe because the
  // result is deterministic per seed and no caller mutates the returned
  // floor/mesh data after receiving it.
  const _cavernFloorCache = new Map();

  function generateCavernFloor(seedText) {
    if (_cavernFloorCache.has(seedText)) return _cavernFloorCache.get(seedText);
    const makeRng = (typeof WildernessMapGenerator !== 'undefined' && WildernessMapGenerator.makeRng) ? WildernessMapGenerator.makeRng : (s => { let a = 1; for (let i = 0; i < s.length; i++) a = (a * 33 + s.charCodeAt(i)) >>> 0; return () => (a = (a * 1664525 + 1013904223) >>> 0) / 4294967296; });
    const rng = makeRng(seedText + '_cavern');
    const targetTiles = TARGET_TILES_MIN + Math.floor(rng() * (TARGET_TILES_MAX - TARGET_TILES_MIN + 1));
    // branchCount is the main knob controlling how many tiles the maze
    // ends up claiming — scaled from the target so bigger dens actually
    // grow bigger networks instead of just denser/thicker corridors.
    const branchCount = Math.max(6, Math.round(targetTiles / 7));
    // entranceLength (the root's point count, see carveMazeCavern) has to
    // scale right alongside branchCount — a short root with a lot of
    // branches all crowd the same small patch near the entrance and merge
    // into one open pit with no walls between corridors, instead of a real
    // branching network. Root points are spaced one branchLength apart, so
    // this gives every branch genuine room to land somewhere distinct.
    const entranceLength = Math.max(6, Math.round(branchCount * 0.6));

    // Half the tool's own default tile size (1) — same physical cave, but
    // snapped to a twice-as-fine tile grid, so dens read as genuinely
    // bigger maps (roughly 4x the tile count for the same footprint)
    // without changing how large or branchy the actual carve is.
    const tileSize = 0.5;
    const result = window.CavernSculptor.carveMazeCavern({ branchCount, entranceLength, tileSize }, rng);

    // Shift every tile coordinate (and the mesh's X/Z) from the sculptor's
    // arbitrary centered local space into positive grid space, same +1
    // margin convention the old blob-growth generator used so nothing sits
    // flush against col/row 0.
    let minX = Infinity, minY = Infinity;
    for (const key of result.claimed) { const [x, y] = key.split(',').map(Number); if (x < minX) minX = x; if (y < minY) minY = y; }
    const shiftX = -minX + 1, shiftY = -minY + 1;

    const floor = [...result.claimed].map(key => { const [x, y] = key.split(',').map(Number); return [x + shiftX, y + shiftY]; });
    const cols = Math.max(...floor.map(f => f[0])) + 2, rows = Math.max(...floor.map(f => f[1])) + 2;
    const exitTiles = result.entranceTiles.map(([x, y]) => [x + shiftX, y + shiftY]);
    const [nfx, nfy] = result.nestTile;

    const positions = result.mesh.positions;
    for (let i = 0; i < positions.length; i += 3) { positions[i] += shiftX; positions[i + 2] += shiftY; }

    const floorResult = {
      floor, cols, rows,
      exitCol: 0 + shiftX, exitRow: 0 + shiftY,
      exitTiles,
      nestCol: nfx + shiftX, nestRow: nfy + shiftY,
      mesh: { positions, indices: result.mesh.indices },
    };
    _cavernFloorCache.set(seedText, floorResult);
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

  function synthesizeCavernMapData(mapId) {
    const { floor, cols, rows, exitCol, exitRow, exitTiles, nestCol, nestRow, mesh } = generateCavernFloor(mapId);

    const makeRng = (typeof WildernessMapGenerator !== 'undefined' && WildernessMapGenerator.makeRng) ? WildernessMapGenerator.makeRng : (() => Math.random);
    const decorRng = makeRng(mapId + '_decor');
    const excludeSet = new Set([...exitTiles, [nestCol, nestRow], [nestCol + 1, nestRow], [nestCol, nestRow + 1], [nestCol + 1, nestRow + 1]].map(([c, r]) => `${c},${r}`));
    const { nativeSpecies } = nativeSpeciesFor(mapId);
    const oreRocks = pickOreRockTiles(decorRng, floor, excludeSet);
    const creatureSpawns = pickCreatureSpawnTiles(decorRng, floor, excludeSet, nativeSpecies);

    return {
      schema: 'hobunji_building_interior.v1',
      id: mapId, name: 'A Dark Burrow',
      cols, rows,
      // All 3 entrance tiles share one exit id — checkTransitionSpots
      // fires from any of them (buildWallPanelsFromFloorSet's merged-gap
      // reasoning no longer applies since the carved mesh replaces flat
      // wall panels entirely, but the transition-trigger contract is the
      // same either way).
      exits: [{ id: 'den_exit', label: 'Back outside', tiles: exitTiles, targetMap: '', spawnCol: 0, spawnRow: 0 }],
      colliders: [], floor, furniture: [],
      wallStyle: 'cavern',
      mesh,
      oreRocks, creatureSpawns,
      // Den-Mother/nest placement — read by loadBuildingScene after the
      // scene/floor/walls are built (see its 'map_i_den_' handling).
      nestCol, nestRow, denMotherKind: pickDenMotherKind(mapId),
    };
  }

  window.CavernGenerator = {
    init,
    generateCavernFloor,
    pickDenMotherKind,
    synthesizeCavernMapData,
  };
})();
