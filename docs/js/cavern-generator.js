(() => {
  'use strict';

  // Procedural cavern floor generation for animal dens (generateCavernFloor
  // grows an organic connected-cell blob from a fixed entrance row and
  // reserves a nest chamber for the Den-Mother; pickDenMotherKind picks
  // which native species' Den-Mother variant guards it; synthesizeCavernMapData
  // combines both into the same map-data shape loadBuildingScene expects
  // from a real config/maps/*.json file — see game.js's "map_i_den_" handling).
  // Extracted out of game.js following the same window.<Namespace> +
  // init(deps) pattern as its sibling systems. Pure data generation — no
  // THREE.js/scene-graph calls at all, deterministic per seed string — so
  // this is an even cleaner candidate than most of what's left in game.js
  // for eventually running standalone (e.g. server-side, for multiplayer).
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  function generateCavernFloor(seedText) {
    const rng = (typeof WildernessMapGenerator !== 'undefined' && WildernessMapGenerator.makeRng) ? WildernessMapGenerator.makeRng(seedText) : Math.random;
    const targetTiles = 40 + Math.floor(rng() * 41); // 40-80 tiles — room for a Den-Mother boss fight plus the nest chamber
    const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    // The entrance is always a straight 3-wide row (x=-1,0,1 at y=0) with
    // an exit tile in the middle — not just wherever the organic blob
    // happened to touch a boundary — so buildWallPanelsFromFloorSet
    // always has 3 adjacent south-facing edges to skip (merged into one
    // wide gap) instead of a single-tile doorway. y>0 (south of the
    // entrance row) is never grown into, so this row stays the cavern's
    // southern boundary and that gap reads as a real cave mouth.
    const ENTRANCE_CELLS = ['-1,0', '0,0', '1,0'];
    const cells = new Set(ENTRANCE_CELLS);
    const frontier = new Map();
    const addFrontier = (x, y) => {
      for (const [dx, dy] of DIRS4) {
        const nx = x + dx, ny = y + dy;
        if (ny > 0) continue;
        const key = `${nx},${ny}`;
        if (!cells.has(key)) frontier.set(key, [nx, ny]);
      }
    };
    for (const key of ENTRANCE_CELLS) addFrontier(...key.split(',').map(Number));
    while (cells.size < targetTiles && frontier.size) {
      const keys = [...frontier.keys()];
      const weights = keys.map(k => {
        const [x, y] = frontier.get(k);
        let n = 0;
        for (const [dx, dy] of DIRS4) if (cells.has(`${x + dx},${y + dy}`)) n++;
        return n * n + 0.2; // bias toward rounder growth over spindly arms
      });
      const total = weights.reduce((a, b) => a + b, 0);
      let r = rng() * total, pick = keys[keys.length - 1];
      for (let i = 0; i < keys.length; i++) { r -= weights[i]; if (r <= 0) { pick = keys[i]; break; } }
      const [px, py] = frontier.get(pick);
      frontier.delete(pick);
      cells.add(pick);
      addFrontier(px, py);
    }
    // Erode dead-end spurs only (leaves — safe to remove, can't disconnect anything).
    // The entrance row is the cavern's entrance and is never eroded.
    for (const key of [...cells]) {
      if (ENTRANCE_CELLS.includes(key) || cells.size <= 6) continue;
      const [x, y] = key.split(',').map(Number);
      let n = 0;
      for (const [dx, dy] of DIRS4) if (cells.has(`${x + dx},${y + dy}`)) n++;
      if (n <= 1 && rng() < 0.5) cells.delete(key);
    }
    // Reserve a 2x2 nest chamber at the point farthest (by walk distance)
    // from the entrance — the Den-Mother's territory, deliberately placed
    // so the player has to cross the whole cavern to reach it. Forced in
    // after erosion (never itself eroded) by adding whichever of its 4
    // tiles the organic growth didn't already produce, so the nest always
    // exists regardless of blob shape.
    const dist = new Map([['0,0', 0]]);
    const queue = ['0,0'];
    let farKey = '0,0', farDist = 0;
    while (queue.length) {
      const key = queue.shift();
      const d = dist.get(key);
      const [x, y] = key.split(',').map(Number);
      for (const [dx, dy] of DIRS4) {
        const nk = `${x + dx},${y + dy}`;
        if (cells.has(nk) && !dist.has(nk)) {
          dist.set(nk, d + 1);
          queue.push(nk);
          if (d + 1 > farDist) { farDist = d + 1; farKey = nk; }
        }
      }
    }
    const [nfx, nfy] = farKey.split(',').map(Number);
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) cells.add(`${nfx + dx},${nfy + dy}`);

    let minX = Infinity, minY = Infinity;
    for (const key of cells) { const [x, y] = key.split(',').map(Number); if (x < minX) minX = x; if (y < minY) minY = y; }
    const floor = [...cells].map(key => { const [x, y] = key.split(',').map(Number); return [x - minX + 1, y - minY + 1]; });
    const cols = Math.max(...floor.map(f => f[0])) + 2, rows = Math.max(...floor.map(f => f[1])) + 2;
    return {
      floor, cols, rows,
      exitCol: 0 - minX + 1, exitRow: 0 - minY + 1,
      // The full 3-wide entrance row, shifted the same way as floor —
      // synthesizeCavernMapData hands all 3 to the exit's tiles[] so
      // buildWallPanelsFromFloorSet skips all 3 south edges as one gap.
      exitTiles: ENTRANCE_CELLS.map(key => { const [x, y] = key.split(',').map(Number); return [x - minX + 1, y - minY + 1]; }),
      nestCol: nfx - minX + 1, nestRow: nfy - minY + 1,
    };
  }

  // Synthesized in-memory map data for a den's cavern — no map_i_den_*.json
  // is ever written to disk; loadBuildingScene builds this on the fly the
  // first time the id is requested, exactly like a wilderness zone itself
  // regenerates from a seed with nothing persisted (see performTothalShift).
  // The seed is the mapId itself (already unique per zone+den, see
  // performTothalShift's denTransitions), so re-entering the same den
  // always reaches the same cavern.
  // Deterministic per den (same mapId -> same pick every time): choose a
  // Den-Mother only from the predator/herbivore species native to this
  // cavern's exterior zone. DEN_MOTHER_DEFS maps each base species to its
  // mother variant and nest reward, keeping Grehlr in the north and
  // Drenkirra in the southern cloud forest all the way through the den.
  function pickDenMotherKind(mapId) {
    const rng = (typeof WildernessMapGenerator !== 'undefined' && WildernessMapGenerator.makeRng) ? WildernessMapGenerator.makeRng(mapId + '_denmother') : Math.random;
    const zoneId = window.WildlifeSpawn.denCavernZoneOf(mapId);
    const zoneDef = deps.EXTERIOR_ZONES[zoneId];
    const nativeSpecies = [...(zoneDef?.packSpecies || []), ...(zoneDef?.herbivoreSpecies || [])];
    const kinds = nativeSpecies.map(kind => deps.DEN_MOTHER_DEFS[kind]?.creatureKey).filter(Boolean);
    if (!kinds.length) {
      window.__farmLog?.(`[wildlife] ${mapId}: no native Den-Mother configured for zone "${zoneId || 'unknown'}".`, 'warn');
      return null;
    }
    return kinds[Math.floor(rng() * kinds.length)];
  }

  function synthesizeCavernMapData(mapId) {
    const { floor, cols, rows, exitCol, exitRow, exitTiles, nestCol, nestRow } = generateCavernFloor(mapId);
    return {
      schema: 'hobunji_building_interior.v1',
      id: mapId, name: 'A Dark Burrow',
      cols, rows,
      // All 3 entrance tiles share one exit id — checkTransitionSpots
      // fires from any of them, and buildWallPanelsFromFloorSet skips
      // all 3 south edges as a single merged 3-wide gap (see
      // generateCavernFloor).
      exits: [{ id: 'den_exit', label: 'Back outside', tiles: exitTiles, targetMap: '', spawnCol: 0, spawnRow: 0 }],
      colliders: [], floor, furniture: [],
      wallStyle: 'cavern',
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
