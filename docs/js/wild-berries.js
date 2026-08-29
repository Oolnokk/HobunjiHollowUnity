(() => {
  'use strict';

  // Wild berry bushes — the wilderness-zone counterpart of purchasable
  // berry seeds. All 5 berry varieties, split across the 4 wilderness
  // zones. Mirrors game.js's reagent-plant scatter system function-for-
  // function (deterministic per zone+day, daily respawn, persisted
  // placements) — see that system's comments for the shared mechanics.
  // Colors reuse BERRY_COLORS (already defined for the jam/wine sprite
  // recolor pipeline).
  //
  // Extracted out of game.js following the same window.<Namespace> +
  // init(deps) pattern already used by js/dew-vats.js and
  // js/dye-system.js. The reagent-plant scatter system this mirrors
  // stays in game.js — findZoneFlatEmptyTiles/getReagentPlantMaterial
  // are shared helpers read through deps rather than duplicated here.
  // currentArea is reassigned on every zone transition, so it's threaded
  // through as a getter rather than a captured reference, same reasoning
  // as js/dye-system.js's gearInventory getter.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  const WILD_BERRY_ZONES = {
    redberries:    'map_northern_cliffs',       // canon per redDew's "Red Berry Bushes" flavor tag
    blueberries:   'map_southern_cloud_forest',
    yellowberries: 'map_western_slope',
    whiteberries:  'map_western_slope',
    blackberries:  'map_eastern_mire',
  };
  const WILD_BERRY_SEED_CHANCE = 0.2; // "small chance to give seeds when harvested"
  function forZone(mapId) {
    return Object.keys(WILD_BERRY_ZONES).filter(k => WILD_BERRY_ZONES[k] === mapId);
  }

  // A real 3D leafy bush (window.FoliageGenerator's TREE_PRESETS.bush —
  // the same model wilderness-generator 'bush' scatter objects use, see
  // game.js's SHRUB-tile rendering) with small berry-colored spheres
  // scattered through the canopy, instead of the old flat billboard
  // cross. Seeded off (col,row) like every other FoliageGenerator call,
  // so a given tile's bush shape is stable; berry placement itself is
  // just decorative scatter and doesn't need to be.
  function _buildBerryBushMesh(berryKey, col, row) {
    const color = deps.BERRY_COLORS[berryKey];
    if (color == null || !window.FoliageGenerator) return null;
    const group = window.FoliageGenerator.buildWildernessBushMesh(col, row);
    const berryGeo = new THREE.SphereGeometry(0.035, 6, 5);
    const berryMat = new THREE.MeshLambertMaterial({ color });
    const berryCount = 6 + Math.floor(Math.random() * 5); // 6-10
    for (let i = 0; i < berryCount; i++) {
      const berry = new THREE.Mesh(berryGeo, berryMat);
      const angle = Math.random() * Math.PI * 2;
      const radius = 0.14 + Math.random() * 0.16;
      berry.position.set(Math.cos(angle) * radius, 0.28 + Math.random() * 0.22, Math.sin(angle) * radius);
      group.add(berry);
    }
    group.userData.berryKey = berryKey;
    return group;
  }

  // Same deterministic per-(zone,day) scatter as game.js's
  // scatterReagentsForZone, but seeded independently ('berries' in the
  // seed string) and excluding that same day's reagent-plant tiles so
  // the two systems never overlap a spot — see findZoneFlatEmptyTiles's
  // optional extraOccupied param.
  function _scatterBerriesForZone(mapId) {
    const pool = forZone(mapId);
    if (!pool.length) return [];
    const zi = deps._zoneScenes.get(mapId);
    if (!zi) return [];
    // Roughly doubled density (was /70, capped 4-24) — berries were meant
    // to read as a common wild forageable, not a rare find.
    const targetCount = Math.max(8, Math.min(40, Math.round((zi.cols * zi.rows) / 35)));
    const rng = deps._mbRng(deps._seedFromString(mapId + ':berries:' + deps.calendar.day));
    const reagentPlacements = deps._zoneReagentPersist.get(mapId)?.placements || [];
    const spots = deps.findZoneFlatEmptyTiles(mapId, targetCount, rng, reagentPlacements);
    return spots.map(({ col, row }) => ({ col, row, key: pool[Math.floor(rng() * pool.length)] }));
  }

  // Builds a worldObjects-shaped pickable for one wild berry bush.
  // Always grants the fruit; WILD_BERRY_SEED_CHANCE also grants a seed —
  // the only way to get berry seeds, since they're no longer purchasable.
  function _makeBerryBushObject(mapId, col, row, berryKey, mesh) {
    const data = deps.cropData[berryKey];
    const fruitDef = deps.ITEM_DEFS[berryKey];
    return {
      id: 'berrybush_' + mapId + '_' + col + '_' + row, type: 'berry_bush',
      col, row, mesh, berryKey,
      label: data.emoji + ' Wild ' + (fruitDef?.label || berryKey),
      getButtons() {
        return [{ icon: data.emoji, label: 'Pick ' + (fruitDef?.label || berryKey), action: 'obj_pick_berry', style: 'primary', allowed: true }];
      },
      onAction(action) {
        if (action !== 'obj_pick_berry') return { ok: false, message: 'Unknown action.' };
        deps.inventory[berryKey] = Math.min(99, (deps.inventory[berryKey] || 0) + 1);
        let seedMsg = '';
        if (Math.random() < WILD_BERRY_SEED_CHANCE) {
          deps.inventory[data.seedKey] = Math.min(99, (deps.inventory[data.seedKey] || 0) + 1);
          seedMsg = ' and found a seed!';
        }
        deps._zoneScenes.get(mapId)?.scene.remove(mesh);
        const objs = deps._zoneBerryObjects.get(mapId);
        objs?.delete(col + ',' + row);
        const groups = deps._zoneBerryMeshGroups.get(mapId);
        if (groups) { const i = groups.indexOf(mesh); if (i >= 0) groups.splice(i, 1); }
        const persisted = deps._zoneBerryPersist.get(mapId);
        if (persisted) persisted.placements = persisted.placements.filter(p => !(p.col === col && p.row === row));
        deps.refreshItemScroll();
        window.AudioSystem?.playObjectSfx(window.AudioSystem?.objectSfxConfig().harvest);
        return { ok: true, message: 'Picked ' + (fruitDef?.label || berryKey) + seedMsg };
      },
    };
  }

  // Wildlife-forage read/consume pair, used by js/wildlife-grehlr-foraging.js
  // so a grehlr can eat a wild berry bush the same way a player picks one —
  // reuses the exact same live object/mesh/persisted-placement bookkeeping
  // _makeBerryBushObject's own onAction already maintains, just without the
  // player-facing inventory grant/toast/harvest sfx that reusing onAction
  // directly would incorrectly trigger for a wild animal eating it itself.
  // col/row are tile-index units (this file's own convention throughout),
  // not TILE-scaled world pixels — callers convert their own creature
  // position first. `.reserved` isn't set by this module; a forage caller
  // is expected to flag/clear it directly on the returned object so two
  // animals don't both walk toward the same bush.
  function nearestAvailableBerry(mapId, col, row) {
    const objs = deps._zoneBerryObjects.get(mapId);
    if (!objs?.size) return null;
    let best = null, bestD = Infinity;
    for (const obj of objs.values()) {
      if (obj.reserved) continue;
      const d = Math.hypot(obj.col - col, obj.row - row);
      if (d < bestD) { bestD = d; best = obj; }
    }
    return best;
  }
  // Read-only listing for the Wildlife tab's behavior map (see
  // js/wildlife-behavior-map.js) — every currently live berry bush's
  // position/kind/reserved state, without exposing the live objects
  // themselves (a caller mutating one of those would affect real
  // gameplay bookkeeping; this returns plain copies).
  function listBerries(mapId) {
    const objs = deps._zoneBerryObjects.get(mapId);
    if (!objs?.size) return [];
    return [...objs.values()].map(obj => ({ col: obj.col, row: obj.row, berryKey: obj.berryKey, reserved: !!obj.reserved }));
  }

  function removeBerryBush(mapId, col, row) {
    const objs = deps._zoneBerryObjects.get(mapId);
    const obj = objs?.get(col + ',' + row);
    if (!obj) return false;
    deps._zoneScenes.get(mapId)?.scene.remove(obj.mesh);
    objs.delete(col + ',' + row);
    const groups = deps._zoneBerryMeshGroups.get(mapId);
    if (groups) { const i = groups.indexOf(obj.mesh); if (i >= 0) groups.splice(i, 1); }
    const persisted = deps._zoneBerryPersist.get(mapId);
    if (persisted) persisted.placements = persisted.placements.filter(p => !(p.col === col && p.row === row));
    return true;
  }

  function _clearZoneBerryMeshes(mapId) {
    const scene = deps._zoneScenes.get(mapId)?.scene;
    const groups = deps._zoneBerryMeshGroups.get(mapId);
    if (scene && groups) groups.forEach(g => scene.remove(g));
    deps._zoneBerryMeshGroups.delete(mapId);
    deps._zoneBerryObjects.delete(mapId);
  }

  // Called right after game.js's ensureZoneReagents(mapId) on every zone
  // entry, so _scatterBerriesForZone can see that same day's already-
  // placed reagent spots and avoid them.
  function ensureZone(mapId) {
    if (typeof WildernessMapGenerator === 'undefined') return;
    if (!forZone(mapId).length) return;
    const zi = deps._zoneScenes.get(mapId);
    if (!zi) return;
    let persisted = deps._zoneBerryPersist.get(mapId);
    if (persisted?.day === deps.calendar.day) {
      if (deps._zoneBerryMeshGroups.has(mapId)) return; // already built for today
    } else {
      persisted = { day: deps.calendar.day, placements: _scatterBerriesForZone(mapId) };
      deps._zoneBerryPersist.set(mapId, persisted);
    }
    _clearZoneBerryMeshes(mapId);
    const groups = [];
    const objMap = new Map();
    for (const { col, row, key } of persisted.placements) {
      const mesh = _buildBerryBushMesh(key, col, row);
      if (!mesh) continue;
      const tile = zi.grid[row]?.[col];
      mesh.position.set(col + 0.5, tile ? deps.tileSurfaceYInArea(tile, mapId) : deps.NORMAL_TOP, row + 0.5);
      zi.scene.add(mesh);
      groups.push(mesh);
      objMap.set(col + ',' + row, _makeBerryBushObject(mapId, col, row, key, mesh));
    }
    deps._zoneBerryMeshGroups.set(mapId, groups);
    deps._zoneBerryObjects.set(mapId, objMap);
    deps.debugLog(`ensureZoneBerries(${mapId}): built ${groups.length} berry bushes for day ${deps.calendar.day}`);
  }

  function respawnAll() {
    if (typeof WildernessMapGenerator === 'undefined') return;
    for (const mapId of WildernessMapGenerator.zoneMapIds()) {
      _clearZoneBerryMeshes(mapId);
      deps._zoneBerryPersist.delete(mapId);
    }
    if (deps.isZoneArea(deps.getCurrentArea())) ensureZone(deps.getCurrentArea());
  }

  function serializeState() {
    const out = {};
    deps._zoneBerryPersist.forEach((v, mapId) => { out[mapId] = { day: v.day, placements: v.placements }; });
    return out;
  }
  function restoreState(saved) {
    deps._zoneBerryPersist.clear();
    Object.entries(saved || {}).forEach(([mapId, v]) => {
      if (v && Array.isArray(v.placements)) deps._zoneBerryPersist.set(mapId, { day: v.day, placements: v.placements });
    });
  }

  window.WildBerries = {
    init,
    forZone,
    ensureZone,
    respawnAll,
    serializeState,
    restoreState,
    nearestAvailableBerry,
    removeBerryBush,
    listBerries,
  };
})();
