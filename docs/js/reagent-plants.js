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
  const HABITAT_VERSION = 3; // One-time rescatters include newly added native mushroom species while preserving daily harvest history.
  const MUSHROOM_SPRITE_PATH = 'assets/objectsprites/mushroom.png'; // Expected user-authored sprite: mint cap, off-white stalk, painted black outlines.
  const mushroomMaterials = new Map(); // Cap pigment -> one shared asynchronous artwork/material record across world plants and cave clusters.
  let mushroomArtUnavailable = false; // Missing future PNG attempts only one load wave per page; grass placeholders remain safe.
  let mushroomPlaneGeometry = null; // Shared grounded, upright plane geometry used when mushroom.png becomes available.
  const WATER_TYPES = new Set(['water', 'river', 'stream', 'waterfall']); // Used by water-edge habitat checks.
  const TREE_FLORA_TYPES = new Set(['tree', 'copse']); // Used by tree-root habitats without treating every shrub as a tree.
  const SHRUB_FLORA_TYPES = new Set(['bush', 'fruitBush', 'mushroomPatch', 'foragePlant', 'shrub', 'vegetation']); // Used by low-cover habitat checks.
  const HABITAT_LABELS = Object.freeze({ waterEdge:'near water', treeRoots:'around tree roots', cliffBase:'at plateau cliff bases', rockEdge:'beside rocks', shrubEdge:'along shrubs' }); // Used by diagnostics.
  function init(injectedDeps) { deps = injectedDeps; }

  function tileAt(grid, col, row) { return grid?.[row]?.[col] || null; }
  function nearbyTiles(grid, col, row, radius, includeCenter = false) {
    const out = []; // Used only during daily habitat placement, never per frame.
    for (let dr = -radius; dr <= radius; dr++) for (let dc = -radius; dc <= radius; dc++) {
      if (!includeCenter && dc === 0 && dr === 0) continue;
      const tile = tileAt(grid, col + dc, row + dr);
      if (tile) out.push(tile);
    }
    return out;
  }
  function habitatMatchesTile(mapId, col, row, habitat) {
    const grid = deps?._zoneScenes?.get(mapId)?.grid;
    const tile = tileAt(grid, col, row);
    if (!tile || !habitat) return false;
    if (habitat === 'waterEdge') return nearbyTiles(grid, col, row, 2).some(neighbor => WATER_TYPES.has(neighbor.type));
    if (habitat === 'treeRoots') return nearbyTiles(grid, col, row, 1).some(neighbor => TREE_FLORA_TYPES.has(neighbor.floraKind || neighbor.generatedObjectType));
    if (habitat === 'rockEdge') return nearbyTiles(grid, col, row, 1).some(neighbor => neighbor.type === 'rock' || !!neighbor.rockKind);
    if (habitat === 'shrubEdge') return nearbyTiles(grid, col, row, 1).some(neighbor => neighbor.type === 'shrub' && (SHRUB_FLORA_TYPES.has(neighbor.floraKind || neighbor.generatedObjectType) || !neighbor.floraKind));
    if (habitat === 'cliffBase') {
      const hereTier = Number(tile.elevTier) || 0; // Candidate-side elevation used to distinguish the lower/base side of a plateau wall.
      return nearbyTiles(grid, col, row, 1).some(neighbor => {
        const neighborTier = Number(neighbor.elevTier) || 0;
        return neighborTier > hereTier || (neighbor.type === 'cliff' && neighborTier >= hereTier);
      });
    }
    return false;
  }
  function placementMatchesHabitat(mapId, placement) {
    const definition = window.AlchemySystem?.REAGENT_DEFS?.[placement?.key];
    return !!definition && habitatMatchesTile(mapId, placement.col, placement.row, definition.habitat);
  }
  function shuffled(values, rng) {
    const out = [...values]; // Used to make species and candidate order vary without mutating shared config.
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  // Mushroom world art uses SpriteRecolor's same mint-cap selection as the
  // inventory: share one CanvasTexture/material per dye, never per instance.
  // Until the authored PNG arrives, the existing grass-reagent placeholder
  // still spawns normally; a missing file does not block gameplay.
  function applyMushroomSprite(meshes, color) {
    if (mushroomArtUnavailable || typeof window.SpriteRecolor?.getRecoloredCanvas !== 'function') return;
    let record = mushroomMaterials.get(color); // Shared asynchronous material and pending meshes for one species color.
    if (!record) {
      record = { state: 'loading', material: null, meshes: new Set() }; // One load/color, with no permanent references after completion.
      mushroomMaterials.set(color, record);
      Promise.resolve().then(() => window.SpriteRecolor.getRecoloredCanvas(MUSHROOM_SPRITE_PATH, color, 'mushroom'))
        .then(canvas => {
          if (!canvas?.width || !canvas?.height) throw new Error('Mushroom artwork has no pixels');
          const texture = new THREE.CanvasTexture(canvas); // Real authored PNG, recolored only once per species.
          texture.minFilter = texture.magFilter = THREE.NearestFilter;
          texture.needsUpdate = true;
          record.material = new THREE.MeshBasicMaterial({ map: texture, transparent: false, alphaTest: 0.5,
            depthWrite: true, side: THREE.DoubleSide, fog: true });
          record.material.userData.hobunjiWorldBakeSafe = true; // Static mushroom cards are eligible for the existing world batcher.
          mushroomPlaneGeometry ||= new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0); // Ground, not the sprite center, is y=0.
          record.width = 0.48 * canvas.width / canvas.height; // Preserve the authored cap/stem aspect ratio without stretching the pixels.
          record.state = 'ready';
          for (const mesh of record.meshes) {
            mesh.geometry = mushroomPlaneGeometry;
            mesh.material = record.material;
            mesh.scale.set(record.width, 0.48, 1);
          }
          record.meshes.clear(); // Do not retain harvested/offscreen groups after the material is ready.
        }).catch(error => {
          mushroomArtUnavailable = true;
          record.state = 'missing';
          record.meshes.clear();
          window.__farmLog?.('[reagent-plants] mushroom.png not available; retaining grass silhouettes until sprite is supplied: ' + error.message, 'world');
        });
    }
    if (record.state === 'ready') {
      for (const mesh of meshes) {
        mesh.geometry = mushroomPlaneGeometry;
        mesh.material = record.material;
        mesh.scale.set(record.width, 0.48, 1);
      }
    } else if (record.state === 'loading') for (const mesh of meshes) record.meshes.add(mesh);
  }

  // A single reagent plant: two crossed cards, still using the legacy grass
  // material until a mushroom's own authored sprite resolves successfully.
  function buildReagentPlantMesh(reagentKey) {
    const def = window.AlchemySystem.REAGENT_DEFS[reagentKey];
    if (!def) return null;
    const mat = deps.getReagentPlantMaterial(def.color);
    if (!mat) return null;
    // The shared grass-blade shader reads only world position (wind phase, fog) for this material, which never defines
    // HOBUNJI_GRASS_DISTANCE_LOD, so its blades can be baked into world space by js/zone-prop-render-batches.js.
    mat.userData.hobunjiWorldBakeSafe = true;
    const group = new THREE.Group();
    const sizeMul = 1.5; // Established wild herb size; mushroom-specific world sprite uses its own authored aspect.
    const w = 0.22 * sizeMul, h = 0.32 * sizeMul;
    const cards = []; // Both crossed surfaces share one color material after the PNG loads.
    for (const rot of [0, Math.PI / 2]) {
      const blade = new THREE.Mesh(deps._grassBladeGeo, mat);
      blade.rotation.y = rot;
      blade.scale.set(w, h, 1);
      group.add(blade);
      cards.push(blade);
    }
    if (def.form === 'mushroom') applyMushroomSprite(cards, def.color); // Separate bitmap silhouettes, no generated outlines.
    group.userData.isBillboard = true;
    group.userData.reagentKey = reagentKey;
    return group;
  }

  // Picks fresh habitat-correct placements for one zone. Species keep their
  // biome (REAGENT_DEFS.zone) but additionally require a terrain sub-habitat.
  // The previous respawn's tiles are passed as occupied so an herb cannot pop
  // straight back into the exact tile it occupied before.
  function scatterReagentsForZone(mapId, previousPlacements = []) {
    const pool = window.AlchemySystem.reagentsForZone(mapId);
    if (!pool.length) return [];
    const zi = deps._zoneScenes.get(mapId);
    if (!zi) return [];
    const targetCount = Math.max(6, Math.min(40, Math.round((zi.cols * zi.rows) / 45)));
    const rng = deps._mbRng(deps._seedFromString(mapId + ':habitat:' + deps.calendar.day));
    const candidateCount = Math.min(zi.cols * zi.rows, Math.max(256, targetCount * 24)); // Broad one-shot sample; this runs only when a zone respawns.
    const candidates = deps.findZoneFlatEmptyTiles(mapId, candidateCount, rng, previousPlacements);
    const queues = new Map(); // Reagent key -> randomized habitat-valid empty tiles.
    for (const key of pool) {
      const habitat = window.AlchemySystem.REAGENT_DEFS[key]?.habitat;
      queues.set(key, shuffled(candidates.filter(({ col, row }) => habitatMatchesTile(mapId, col, row, habitat)), rng));
    }
    const placements = [];
    const used = new Set(); // Shared because one tile can satisfy more than one species' habitat.
    let speciesOrder = shuffled(pool, rng);
    while (placements.length < targetCount) {
      let addedThisPass = 0;
      for (const key of speciesOrder) {
        if (placements.length >= targetCount) break;
        const queue = queues.get(key) || [];
        let spot = null;
        while (queue.length && !spot) {
          const candidate = queue.pop();
          if (!used.has(candidate.col + ',' + candidate.row)) spot = candidate;
        }
        if (!spot) continue;
        used.add(spot.col + ',' + spot.row);
        placements.push({ col: spot.col, row: spot.row, key, harvested: false });
        addedThisPass++;
      }
      if (!addedThisPass) break; // Strict habitat rules: never fall back to an ecologically wrong tile just to hit the count.
      speciesOrder = shuffled(speciesOrder, rng);
    }
    const missing = pool.filter(key => !placements.some(placement => placement.key === key));
    deps.debugLog?.(`scatterReagentsForZone(${mapId}): ${placements.length}/${targetCount} habitat placements; ${missing.length ? 'no valid tile for ' + missing.join(', ') : 'all species represented'}`);
    return placements;
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
        deps.inventory[reagentKey] = Math.min(window.InventoryStacks.MAX_TOTAL, (deps.inventory[reagentKey] || 0) + amount);
        deps.awardForagingXp?.();
        deps._zoneScenes.get(mapId)?.scene.remove(mesh);
        const objs = deps._zoneReagentObjects.get(mapId);
        objs?.delete(col + ',' + row);
        const groups = deps._zoneReagentMeshGroups.get(mapId);
        if (groups) { const i = groups.indexOf(mesh); if (i >= 0) groups.splice(i, 1); }
        // Keep the tile in persisted history, but mark it harvested. This prevents
        // same-day reload respawns and lets tomorrow's scatter explicitly avoid
        // yesterday's exact herb positions.
        const persisted = deps._zoneReagentPersist.get(mapId);
        const placement = persisted?.placements?.find(p => p.col === col && p.row === row);
        if (placement) placement.harvested = true;
        deps.refreshItemScroll();
        window.AudioSystem?.playObjectSfx(window.AudioSystem?.objectSfxConfig().harvest,1,1,null,
          window.AudioSystem?.objectSfxSourceAt?.(col+.5,row+.5,mapId)); // Reagent pickups use the plant's real world position.
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
    if (persisted?.day === deps.calendar.day && persisted?.version === HABITAT_VERSION) {
      if (deps._zoneReagentMeshGroups.has(mapId)) return; // already built for today
    } else if (persisted?.day === deps.calendar.day && persisted.version === HABITAT_VERSION - 1
      && Array.isArray(persisted.placements)) {
      // Version 2 already had habitat-correct placements. Keep this in-progress day's
      // harvests and positions; new fungi join the next normal daily respawn.
      persisted = { ...persisted, version: HABITAT_VERSION }; // One-time save upgrade without spawning extra same-day plants.
      deps._zoneReagentPersist.set(mapId, persisted);
    } else {
      const previousPlacements = persisted?.placements || []; // Includes harvested entries so every prior herb tile is excluded from the next respawn.
      persisted = { version: HABITAT_VERSION, day: deps.calendar.day, placements: scatterReagentsForZone(mapId, previousPlacements) };
      deps._zoneReagentPersist.set(mapId, persisted);
    }
    clearZoneReagentMeshes(mapId);
    const groups = [];
    const objMap = new Map();
    for (const { col, row, key, harvested } of persisted.placements) {
      if (harvested) continue;
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

  // Daily reset clears meshes but deliberately retains yesterday's persisted
  // tile history until each zone is lazily rebuilt. ensureZoneReagents then
  // uses those coordinates as exclusions before replacing the stale record.
  function respawnAllZoneReagents() {
    if (typeof WildernessMapGenerator === 'undefined') return;
    for (const mapId of WildernessMapGenerator.zoneMapIds()) clearZoneReagentMeshes(mapId);
    if (deps._isZoneArea(deps.getCurrentArea())) ensureZoneReagents(deps.getCurrentArea());
  }

  // Save/restore _zoneReagentPersist as a plain object — see
  // saveMemberWorldData/spawnPlayerAvatar.
  function serializeZoneReagentState() {
    const out = {};
    deps._zoneReagentPersist.forEach((v, mapId) => { out[mapId] = { version: v.version || 0, day: v.day, placements: v.placements }; });
    return out;
  }
  function restoreZoneReagentState(saved) {
    deps._zoneReagentPersist.clear();
    Object.entries(saved || {}).forEach(([mapId, v]) => {
      if (v && Array.isArray(v.placements)) deps._zoneReagentPersist.set(mapId, { version: v.version || 0, day: v.day, placements: v.placements });
    });
  }

  function sourceCensus(mapId = deps?.getCurrentArea?.()) {
    const record = deps?._zoneReagentPersist?.get?.(mapId);
    if (!record || !Array.isArray(record.placements)) return {zoneId:mapId,known:false,
      reason:'this habitat has no generated/persisted daily reagent scatter yet'};
    const versionMatches = record.version === HABITAT_VERSION; // Current-day site chances only refer to the active generator layout.
    const today = versionMatches && record.day === deps?.calendar?.day;
    const entries = record.placements;
    const pool = window.AlchemySystem?.reagentsForZone?.(mapId) || [];
    const bySpecies = Object.fromEntries(pool.map(key=>{
      const matching=entries.filter(e=>e.key===key);
      return [key,{generated:matching.length,remaining:matching.filter(e=>!e.harvested).length,
        habitat:window.AlchemySystem?.REAGENT_DEFS?.[key]?.habitat || null,
        shareOfGenerated:entries.length?matching.length/entries.length:null}];
    }));
    const scene = deps?._zoneScenes?.get?.(mapId);
    const zoneTiles = Number(scene?.cols) * Number(scene?.rows); // Generated tile footprint; not a claim that every tile supports each reagent habitat.
    return {zoneId:mapId,known:true,isCurrentDay:today,isCurrentGeneratorVersion:versionMatches,
      generatorVersion:record.version ?? null,day:record.day,
      generatedMapTiles:Number.isFinite(zoneTiles) && zoneTiles > 0 ? zoneTiles : null,
      generatedPlantsPerMapTile:Number.isFinite(zoneTiles) && zoneTiles > 0 ? entries.length/zoneTiles : null,
      generatedTotal:entries.length,remainingTotal:entries.filter(e=>!e.harvested).length,
      bySpecies,certainty:today?'exact current-day recorded habitat placements':'historical scatter only: current day requires regeneration',
      caution:'Habitat-specific opportunities; no assumption that every wilderness tile can grow every reagent'};
  }

  function diagnosticsSnapshot(mapId = deps?.getCurrentArea?.()) {
    const persisted = deps?._zoneReagentPersist?.get(mapId);
    const placements = persisted?.placements || [];
    return {
      mapId, day: persisted?.day ?? null, version: persisted?.version ?? null,
      mushroomArt: { path: MUSHROOM_SPRITE_PATH, status: mushroomArtUnavailable ? 'awaiting-mushroom-png'
        : [...mushroomMaterials.values()].some(entry => entry.state === 'ready') ? 'ready'
          : mushroomMaterials.size ? 'loading' : 'not-requested',
        cachedColors: [...mushroomMaterials.values()].filter(entry => entry.state === 'ready').length }, // Mobile-readable asset fallback state.
      total: placements.length, active: placements.filter(p => !p.harvested).length, harvested: placements.filter(p => p.harvested).length,
      bySpecies: Object.fromEntries(window.AlchemySystem.reagentsForZone(mapId).map(key => [key, placements.filter(p => p.key === key).length])),
      habitats: Object.fromEntries(window.AlchemySystem.reagentsForZone(mapId).map(key => [key, { habitat: window.AlchemySystem.REAGENT_DEFS[key]?.habitat, label: HABITAT_LABELS[window.AlchemySystem.REAGENT_DEFS[key]?.habitat] || 'unknown' }])),
      invalidPlacements: placements.filter(p => !placementMatchesHabitat(mapId, p)).map(p => ({ col:p.col, row:p.row, key:p.key })),
    };
  }
  function diagnosticsText(mapId) { return JSON.stringify(diagnosticsSnapshot(mapId), null, 2); }

  window.ReagentPlants = {
    HABITAT_VERSION,HABITAT_LABELS,
    init,
    habitatMatchesTile,
    placementMatchesHabitat,
    buildReagentPlantMesh,
    scatterReagentsForZone,
    makeReagentPlantObject,
    clearZoneReagentMeshes,
    ensureZoneReagents,
    respawnAllZoneReagents,
    serializeZoneReagentState,
    restoreZoneReagentState,
    diagnosticsSnapshot,
    sourceCensus,
    diagnosticsText,
  };
})();
