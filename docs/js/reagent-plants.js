(() => {
  'use strict';

  // Alchemy reagent plant scatter/pick, per wilderness zone.
  //
  // Extracted out of game.js following the same window.<Namespace> +
  // init(deps) pattern as the other recent extractions (most directly
  // mirrors js/wild-berries.js, its sibling scatter system). A few
  // utilities stay behind in game.js on purpose, deliberately shared
  // across all three wilderness scatter systems (reagents/berries/
  // treasure) rather than owned by any one of them: _seedFromString,
  // findZoneFlatEmptyTiles (so berries/treasure can avoid tiles reagents
  // already claimed the same day — see scatterReagentsForZone), and
  // getReagentPlantMaterial (wild berries reuses the same tinted-shader
  // material cache). All three come in through deps here, same as they
  // already do for WildBerries/WildTreasure. currentArea is reassigned
  // wholesale elsewhere in game.js (zone switching), so it's threaded
  // through as a getter. window.AlchemySystem/window.AudioSystem and the
  // globally-loaded WildernessMapGenerator script are left as direct
  // references — same treatment as THREE.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  // A single reagent plant: a small two-blade cross (mirrors the
  // "cross of quads" billboard-grass look) at 150% of a normal grass
  // blade's size, standing alone as an individually pickable sprite
  // instead of being folded into a shared InstancedMesh tuft.
  function buildReagentPlantMesh(reagentKey) {
    const def = window.AlchemySystem.REAGENT_DEFS[reagentKey];
    if (!def) return null;
    const mat = deps.getReagentPlantMaterial(def.color);
    if (!mat) return null;
    const group = new THREE.Group();
    const sizeMul = 1.5; // 150% size, per the placeholder-billboard spec
    const w = 0.22 * sizeMul, h = 0.32 * sizeMul;
    for (const rot of [0, Math.PI / 2]) {
      const blade = new THREE.Mesh(deps._grassBladeGeo, mat);
      blade.rotation.y = rot;
      blade.scale.set(w, h, 1);
      group.add(blade);
    }
    group.userData.isBillboard = true;
    group.userData.reagentKey = reagentKey;
    return group;
  }

  // Picks fresh (col,row,reagentKey) placements for one zone — deterministic
  // per (zone, day) so re-entering the same zone on the same day doesn't
  // reshuffle plants that just haven't been picked yet.
  function scatterReagentsForZone(mapId) {
    const pool = window.AlchemySystem.reagentsForZone(mapId);
    if (!pool.length) return [];
    const zi = deps._zoneScenes.get(mapId);
    if (!zi) return [];
    const targetCount = Math.max(6, Math.min(40, Math.round((zi.cols * zi.rows) / 45)));
    const rng = deps._mbRng(deps._seedFromString(mapId + ':' + deps.calendar.day));
    const spots = deps.findZoneFlatEmptyTiles(mapId, targetCount, rng);
    return spots.map(({ col, row }) => ({ col, row, key: pool[Math.floor(rng() * pool.length)] }));
  }

  // Builds a worldObjects-shaped pickable for one reagent plant, matching
  // the { getButtons(), onAction() } shape getWorldObjectAt's callers expect.
  function makeReagentPlantObject(mapId, col, row, reagentKey, mesh) {
    const def = window.AlchemySystem.REAGENT_DEFS[reagentKey];
    return {
      id: 'reagent_' + mapId + '_' + col + '_' + row, type: 'reagent_plant',
      col, row, mesh, reagentKey,
      label: def.icon + ' ' + def.label,
      getButtons() {
        return [{ icon: def.icon, label: 'Pick ' + def.label, action: 'obj_pick_reagent', style: 'primary', allowed: true }];
      },
      onAction(action) {
        if (action !== 'obj_pick_reagent') return { ok: false, message: 'Unknown action.' };
        const bonus = (deps.random || Math.random)() < (deps.bonusYieldChance?.('foraging') || 0) ? 1 : 0; // Used for Foraging's extra-herb chance.
        const doubleRank = window.PerkSystem?.rank('foraging', 'doubleForageables') || 0; // Double Forageables perk.
        const amount = (1 + bonus) * (doubleRank > 0 ? 2 : 1);
        deps.inventory[reagentKey] = Math.min(99, (deps.inventory[reagentKey] || 0) + amount);
        deps.awardForagingXp?.();
        deps._zoneScenes.get(mapId)?.scene.remove(mesh);
        const objs = deps._zoneReagentObjects.get(mapId);
        objs?.delete(col + ',' + row);
        const groups = deps._zoneReagentMeshGroups.get(mapId);
        if (groups) { const i = groups.indexOf(mesh); if (i >= 0) groups.splice(i, 1); }
        // Drop it from the persisted placement list too, so a reload
        // before the next daily respawn doesn't bring it back.
        const persisted = deps._zoneReagentPersist.get(mapId);
        if (persisted) persisted.placements = persisted.placements.filter(p => !(p.col === col && p.row === row));
        deps.refreshItemScroll();
        window.AudioSystem?.playObjectSfx(window.AudioSystem?.objectSfxConfig().harvest);
        return { ok: true, message: `Picked ${amount} ${def.icon} ${def.label}${bonus ? ' (Foraging bonus)' : ''}.` };
      },
    };
  }

  // Removes every currently-built reagent plant mesh/object for a zone
  // without regenerating placement data — used both before a fresh
  // scatter (ensureZoneReagents) and by the daily respawn to eagerly
  // clear zones the player isn't currently standing in.
  function clearZoneReagentMeshes(mapId) {
    const scene = deps._zoneScenes.get(mapId)?.scene;
    const groups = deps._zoneReagentMeshGroups.get(mapId);
    if (scene && groups) groups.forEach(g => scene.remove(g));
    deps._zoneReagentMeshGroups.delete(mapId);
    deps._zoneReagentObjects.delete(mapId);
  }

  // Makes sure a zone's reagent plants are up to date for *today* —
  // reuses today's persisted placements (see _zoneReagentPersist) if any
  // exist, scattering fresh ones only the first time a zone is touched
  // on a given day. Called on every enterZone so a zone that was already
  // built (cached scene) still picks up a day's worth of staleness, or a
  // reload's restored placements, on re-entry.
  function ensureZoneReagents(mapId) {
    if (typeof WildernessMapGenerator === 'undefined') return;
    if (!window.AlchemySystem.reagentsForZone(mapId).length) return;
    const zi = deps._zoneScenes.get(mapId);
    if (!zi) return;
    let persisted = deps._zoneReagentPersist.get(mapId);
    if (persisted?.day === deps.calendar.day) {
      if (deps._zoneReagentMeshGroups.has(mapId)) return; // already built for today
    } else {
      persisted = { day: deps.calendar.day, placements: scatterReagentsForZone(mapId) };
      deps._zoneReagentPersist.set(mapId, persisted);
    }
    clearZoneReagentMeshes(mapId);
    const groups = [];
    const objMap = new Map();
    for (const { col, row, key } of persisted.placements) {
      const mesh = buildReagentPlantMesh(key);
      if (!mesh) continue;
      const tile = zi.grid[row]?.[col];
      mesh.position.set(col + 0.5, tile ? deps.tileSurfaceYInArea(tile, mapId) : deps.NORMAL_TOP, row + 0.5);
      zi.scene.add(mesh);
      groups.push(mesh);
      objMap.set(col + ',' + row, makeReagentPlantObject(mapId, col, row, key, mesh));
    }
    deps._zoneReagentMeshGroups.set(mapId, groups);
    deps._zoneReagentObjects.set(mapId, objMap);
    deps.debugLog(`ensureZoneReagents(${mapId}): built ${groups.length} reagent plants for day ${deps.calendar.day}`);
  }

  // Daily reset: clears every zone's reagent plants (freeing their
  // meshes right away) and drops all four zones' persisted placements so
  // the next visit to each scatters a fresh set — see ensureZoneReagents.
  // Mirrors how den wildlife lazily repopulates only the zone currently
  // being entered rather than eagerly rebuilding all four every day.
  function respawnAllZoneReagents() {
    if (typeof WildernessMapGenerator === 'undefined') return;
    for (const mapId of WildernessMapGenerator.zoneMapIds()) {
      clearZoneReagentMeshes(mapId);
      deps._zoneReagentPersist.delete(mapId);
    }
    if (deps._isZoneArea(deps.getCurrentArea())) ensureZoneReagents(deps.getCurrentArea());
  }

  // Save/restore _zoneReagentPersist as a plain object — see
  // saveMemberWorldData/spawnPlayerAvatar.
  function serializeZoneReagentState() {
    const out = {};
    deps._zoneReagentPersist.forEach((v, mapId) => { out[mapId] = { day: v.day, placements: v.placements }; });
    return out;
  }
  function restoreZoneReagentState(saved) {
    deps._zoneReagentPersist.clear();
    Object.entries(saved || {}).forEach(([mapId, v]) => {
      if (v && Array.isArray(v.placements)) deps._zoneReagentPersist.set(mapId, { day: v.day, placements: v.placements });
    });
  }

  window.ReagentPlants = {
    init,
    buildReagentPlantMesh,
    scatterReagentsForZone,
    makeReagentPlantObject,
    clearZoneReagentMeshes,
    ensureZoneReagents,
    respawnAllZoneReagents,
    serializeZoneReagentState,
    restoreZoneReagentState,
  };
})();
