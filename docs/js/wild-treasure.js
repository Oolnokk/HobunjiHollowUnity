(() => {
  'use strict';

  // Buried wilderness treasure (dig sites → chests). A companion (see
  // game.js's updateCompanions treasure-hint branch) periodically bounces
  // toward the nearest buried digsite instead of idly wandering —
  // "leading you to it", Fable 2 dog-style. Digging one up with a shovel
  // or pick equipped turns it into an openable chest holding a few metal
  // bars. Deliberately rarer than reagents/berries — scattered per week
  // (see weekIndex), not per day, and only 1-2 per zone.
  //
  // Extracted out of game.js following the same window.<Namespace> +
  // init(deps) pattern already used by js/wild-berries.js and
  // js/dew-vats.js. Two functions that sat interleaved in the same
  // game.js section — tickFelledTreeRegrowth/tickMinedRockRegrowth,
  // which regrow trees/rocks and have nothing to do with treasure —
  // stayed behind in game.js rather than being dragged along here.
  // currentArea is reassigned on every zone transition, and
  // _lootPools/STORE_CLOTHING_PIECES/packClothing are all reassigned
  // wholesale at various points (config load, save load, character
  // switch), so all four are threaded through as getters rather than
  // captured references, same reasoning as js/dye-system.js's
  // gearInventory getter.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  function weekIndex() {
    return Math.floor((deps.calendar.day - 1) / 7);
  }

  // Weighted toward common low-tier bars with a rare shot at a
  // higher-tier one — Math.pow(rnd(),2.2) biases the roll toward 0
  // (weakest) before scaling across the hierarchy.
  function _rollTreasureMetalKeys() {
    const count = 1 + Math.floor(deps.rnd() * 3); // 1-3 bars
    const keys = [];
    for (let i = 0; i < count; i++) {
      const idx = Math.min(deps.VERDIGRIS_METAL_KEYS.length - 1, Math.floor(Math.pow(deps.rnd(), 2.2) * deps.VERDIGRIS_METAL_KEYS.length));
      keys.push(deps.VERDIGRIS_METAL_KEYS[idx]);
    }
    return keys;
  }

  // Looks up one named entry from the treasureChest loot pool (docs/
  // config/loot/loot-pools.json) by id — used instead of game.js's
  // rollLootPool's generic itemKey-roll path since a chest's bundle
  // isn't a flat {itemKey:qty} map (see the bundle shape below), just
  // its per-roll chance/range/conditions.
  function _treasureChestEntry(id) {
    return (deps.getLootPools().treasureChest?.entries || []).find(e => e.id === id) || null;
  }
  // True if `id`'s entry (a) has no conditions or matches the current
  // ambient world state, and (b) passes its own chance roll (falling
  // back to `fallbackChance` if the entry is missing/chance is unset —
  // this is what keeps the "always" rolls (metal bars, mystery dye)
  // always-on by default while still letting the Loot & Shop Editor
  // dial them down).
  function _rollTreasureChance(id, fallbackChance) {
    const entry = _treasureChestEntry(id);
    if (entry && !window.ConditionRegistry.entryEligible(entry, deps.lootShopWorldState())) return false;
    const chance = entry?.chance != null ? entry.chance : fallbackChance;
    return deps.rnd() < chance;
  }

  // A chest's full loot bundle: metal bars and dye items always, plus a
  // chance each of gold, a random alchemy potion, and a random dyed
  // clothing piece — the same clothing-piece/dye generators the General
  // Store's daily stock rolls from (see game.js's generateDailyClothingStock),
  // just freely randomized instead of seeded by day.
  function _rollTreasureLootBundle() {
    const bundle = { metalKeys: [], dyeItemKeys: [], gold: 0, potionKey: null, recipeItemKey: null, clothing: null };
    if (_rollTreasureChance('metalBars', 1)) bundle.metalKeys = _rollTreasureMetalKeys();
    if (_rollTreasureChance('mysteryDye', 1)) bundle.dyeItemKeys = _rollTreasureDyeItemKeys();
    if (_rollTreasureChance('gold', 0.7)) {
      const entry = _treasureChestEntry('gold');
      const min = entry?.min ?? 10, max = entry?.max ?? 42, step = entry?.step ?? 8;
      const steps = Math.floor((max - min) / step) + 1;
      bundle.gold = min + Math.floor(deps.rnd() * steps) * step;
    }
    if (_rollTreasureChance('potion', 0.35)) {
      const recipes = Object.values(window.AlchemySystem.RECIPE_DEFS); // Only explicitly authored valid reactions can enter treasure.
      const chosen = recipes[Math.floor(deps.rnd() * recipes.length)]; // Seeded treasure choice.
      if (chosen && deps.rnd() < 0.25) bundle.recipeItemKey = window.AlchemySystem.ensureRecipeScrollItemDef(chosen.id);
      else if (chosen) bundle.potionKey = window.AlchemySystem.ensureRecipeItemDef(chosen.id, Math.floor(deps.rnd() * 3));
    }
    if (_rollTreasureChance('clothing', 0.25)) {
      const catalog = window.DyeSystem.getCatalog();
      const pieces = deps.getStoreClothingPieces();
      const piece = pieces[Math.floor(deps.rnd() * pieces.length)];
      const dyeA  = catalog[Math.floor(deps.rnd() * catalog.length)];
      const dyeB  = piece.usesB ? catalog[Math.floor(deps.rnd() * catalog.length)] : null;
      const dyeLbl = piece.usesB && dyeB ? (dyeA.label + ' & ' + dyeB.label) : dyeA.label;
      bundle.clothing = {
        uid: 'citem_chest_' + Date.now() + '_' + Math.floor(deps.rnd() * 1e6),
        cosmeticId: piece.id, slot: piece.category, label: dyeLbl + ' ' + piece.label, baseLabel: piece.label,
        colorA: window.DyeSystem.toClothingColor(dyeA), colorB: window.DyeSystem.toClothingColor(dyeB), price: piece.price, sellPrice: Math.floor(piece.price * 0.4),
        sprite: deps.clothingSpriteForCosmetic(piece.id),
      };
    }
    return bundle;
  }

  // Every chest guarantees at least one Mystery Dye item, averaging 1-3 —
  // dye items are meant to be common treasure filler, unlike the rarer
  // gold/potion/clothing rolls above which can come up empty.
  function _rollTreasureDyeItemKeys() {
    const poolKeys = Object.keys(deps.MYSTERY_DYE_ITEM_KEY_BY_POOL);
    if (!poolKeys.length) return [];
    const count = 1 + Math.floor(deps.rnd() * 3); // 1-3, uniform
    const keys = [];
    for (let i = 0; i < count; i++) {
      keys.push(deps.MYSTERY_DYE_ITEM_KEY_BY_POOL[poolKeys[Math.floor(deps.rnd() * poolKeys.length)]]);
    }
    return keys;
  }

  function _scatterTreasureForZone(mapId) {
    const zi = deps._zoneScenes.get(mapId);
    if (!zi) return [];
    const targetCount = 1 + Math.floor((zi.cols * zi.rows) / 3200); // rare — usually 1-2 per zone
    const rng = deps._mbRng(deps._seedFromString(mapId + ':treasure:' + weekIndex()));
    const avoid = [...(deps._zoneReagentPersist.get(mapId)?.placements || []), ...(deps._zoneBerryPersist.get(mapId)?.placements || [])];
    const spots = deps.findZoneFlatEmptyTiles(mapId, targetCount, rng, avoid);
    return spots.map(({ col, row }) => ({ col, row, found: false, loot: _rollTreasureLootBundle() }));
  }

  // Simple wood-and-band chest silhouette — same box+lid shape as
  // game.js's makeSellCrate/makeSupplyBox, just its own wood/gold coloring.
  function _buildTreasureChestMesh() {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.42, 0.44), new THREE.MeshLambertMaterial({ color: 0x6b4a2b }));
    body.position.y = 0.21;
    body.castShadow = true;
    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.07, 0.46), new THREE.MeshLambertMaterial({ color: 0xcaa233 }));
    lid.position.y = 0.445;
    lid.castShadow = true;
    group.add(body, lid);
    return group;
  }

  // Trench-floor world Y for a tile, for whatever plateau tier it sits
  // on — the same sunken height a real dug trench's own floor renders
  // at (see game.js's TRENCH_TOP/DEPRESSION_TOP) — computed regardless of
  // that tile's CURRENT type, so a chest can sit there genuinely buried
  // before it's ever dug.
  function _treasureChestBuriedY(mapId, col, row) {
    const tile = deps._zoneScenes.get(mapId)?.grid[row]?.[col];
    const tierY = (tile?.elevTier || 0) * deps.PLATEAU_UNIT;
    return deps.NORMAL_TOP + deps.TRENCH_TOP + tierY;
  }

  // A chest is a real world object (getButtons()/onAction()) from the
  // moment its zone is built, sitting at trench-floor depth — but
  // getButtons() only ever offers "Open" once this exact tile is
  // currently a real dug trench, so it can't be cheesed by standing
  // over undisturbed ground, and re-burying it (filling the trench back
  // in before opening) hides the option again.
  function _makeTreasureChestObject(mapId, col, row, placement, mesh) {
    return {
      id: 'treasurechest_' + mapId + '_' + col + '_' + row, type: 'treasure_chest',
      col, row, mesh,
      label: '🗝️ Buried Chest',
      getButtons() {
        const tile = deps._zoneScenes.get(mapId)?.grid[row]?.[col];
        if (tile?.type !== deps.TileType.TRENCH) {
          return [{ icon: '🗝️', label: "Buried — dig a trench here to reach it", action: 'obj_open_treasure_chest', style: 'secondary', allowed: false }];
        }
        return [{ icon: '🗝️', label: 'Open the buried chest', action: 'obj_open_treasure_chest', style: 'primary', allowed: true }];
      },
      onAction(action) {
        if (action !== 'obj_open_treasure_chest') return { ok: false, message: 'Unknown action.' };
        const tile = deps._zoneScenes.get(mapId)?.grid[row]?.[col];
        if (tile?.type !== deps.TileType.TRENCH) return { ok: false, message: "It's still buried — dig a trench here to reach it." };
        const { loot } = placement;
        const parts = [];
        for (const metalKey of loot.metalKeys) {
          const key = deps.metalBarItemKey(metalKey);
          deps.inventory[key] = Math.min(99, (deps.inventory[key] || 0) + 1);
          parts.push((deps.ITEM_DEFS[key]?.icon || '🔶') + ' ' + deps.METAL_DEFS[metalKey].label + ' Bar');
        }
        for (const dyeItemKey of (loot.dyeItemKeys || [])) {
          deps.inventory[dyeItemKey] = Math.min(99, (deps.inventory[dyeItemKey] || 0) + 1);
          parts.push((deps.ITEM_DEFS[dyeItemKey]?.icon || '🎨') + ' ' + (deps.ITEM_DEFS[dyeItemKey]?.label || 'Mystery Dye'));
        }
        if (loot.gold > 0) {
          deps.inventory.gold = (deps.inventory.gold || 0) + loot.gold;
          parts.push('💰' + loot.gold + 'g');
        }
        if (loot.potionKey) {
          deps.inventory[loot.potionKey] = Math.min(99, (deps.inventory[loot.potionKey] || 0) + 1);
          parts.push((deps.ITEM_DEFS[loot.potionKey]?.icon || '🧪') + ' ' + (deps.ITEM_DEFS[loot.potionKey]?.label || 'Potion'));
        }
        if (loot.recipeItemKey) {
          deps.inventory[loot.recipeItemKey] = Math.min(99, (deps.inventory[loot.recipeItemKey] || 0) + 1);
          parts.push((deps.ITEM_DEFS[loot.recipeItemKey]?.icon || '📜') + ' ' + (deps.ITEM_DEFS[loot.recipeItemKey]?.label || 'Alchemy Recipe'));
        }
        if (loot.clothing) {
          deps.getPackClothing().push({ ...loot.clothing });
          parts.push('👘 ' + loot.clothing.label);
        }
        placement.found = true;
        deps._zoneScenes.get(mapId)?.scene.remove(mesh);
        const groups = deps._zoneTreasureMeshGroups.get(mapId);
        if (groups) { const i = groups.indexOf(mesh); if (i >= 0) groups.splice(i, 1); }
        deps._zoneTreasureObjects.get(mapId)?.delete(col + ',' + row);
        const persisted = deps._zoneTreasurePersist.get(mapId);
        if (persisted) persisted.placements = persisted.placements.filter(p => p !== placement);
        deps.refreshItemScroll();
        deps.buildInventoryGrid();
        deps.buildPackClothingSection();
        return { ok: true, message: 'Opened the chest: ' + parts.join(', ') };
      },
    };
  }

  function _clearZoneTreasureMeshes(mapId) {
    const scene = deps._zoneScenes.get(mapId)?.scene;
    const groups = deps._zoneTreasureMeshGroups.get(mapId);
    if (scene && groups) groups.forEach(g => scene.remove(g));
    deps._zoneTreasureMeshGroups.delete(mapId);
    deps._zoneTreasureObjects.delete(mapId);
  }

  // Registers/unregisters a zone's buried chests as getWorldObjectAt
  // objects to match each one's tile's CURRENT type — called after
  // ensureZone and after every refreshZoneGroundVisuals (i.e. any
  // dig/fill/raise/till/smooth in this zone). A chest is only ever
  // registered while its tile is a real dug trench; the moment a tile
  // ISN'T one (never dug yet, or filled back in), it's unregistered —
  // getWorldObjectAt then returns null there, same as any other patch of
  // ground. This is deliberate: registering it unconditionally (even
  // with an always-disabled "buried" button) would make it the ONLY
  // thing the action bar shows at that tile, permanently pre-empting
  // the normal dig/fill/till prompt a player needs to actually reach
  // it. The chest's mesh (placement._mesh) is untouched either way —
  // it's still buried beneath the ground and reappears once dug without
  // rebuilding anything, exactly like before.
  function syncZoneInteractivity(mapId) {
    const persisted = deps._zoneTreasurePersist.get(mapId);
    const zi = deps._zoneScenes.get(mapId);
    if (!persisted || !zi) return;
    let objMap = deps._zoneTreasureObjects.get(mapId);
    if (!objMap) { objMap = new Map(); deps._zoneTreasureObjects.set(mapId, objMap); }
    for (const placement of persisted.placements) {
      if (placement.found || !placement._mesh) continue;
      const key = placement.col + ',' + placement.row;
      const isDug = zi.grid[placement.row]?.[placement.col]?.type === deps.TileType.TRENCH;
      if (isDug && !objMap.has(key)) {
        objMap.set(key, _makeTreasureChestObject(mapId, placement.col, placement.row, placement, placement._mesh));
      } else if (!isDug && objMap.has(key)) {
        objMap.delete(key);
      }
    }
  }

  // Called alongside game.js's ensureZoneReagents/window.WildBerries.
  // ensureZone on every zone entry — rescatters only once a new week
  // starts (see weekIndex); otherwise just rebuilds whatever this
  // week's not-yet-found placements still are, each buried at its own
  // trench-floor depth (see _treasureChestBuriedY).
  function ensureZone(mapId) {
    if (typeof WildernessMapGenerator === 'undefined') return;
    const zi = deps._zoneScenes.get(mapId);
    if (!zi) return;
    let persisted = deps._zoneTreasurePersist.get(mapId);
    if (persisted?.week === weekIndex()) {
      if (deps._zoneTreasureMeshGroups.has(mapId)) return; // already built for this week
    } else {
      persisted = { week: weekIndex(), placements: _scatterTreasureForZone(mapId) };
      deps._zoneTreasurePersist.set(mapId, persisted);
    }
    _clearZoneTreasureMeshes(mapId);
    const groups = [];
    deps._zoneTreasureObjects.set(mapId, new Map());
    for (const placement of persisted.placements) {
      if (placement.found) continue;
      const { col, row } = placement;
      const mesh = _buildTreasureChestMesh();
      mesh.position.set(col + 0.5, _treasureChestBuriedY(mapId, col, row), row + 0.5);
      zi.scene.add(mesh);
      groups.push(mesh);
      // Tracked on the placement (not just built here) so
      // syncZoneInteractivity can reach it later without rebuilding —
      // the mesh itself never moves or gets swapped.
      placement._mesh = mesh;
    }
    deps._zoneTreasureMeshGroups.set(mapId, groups);
    // Only registers a chest as an interactable getWorldObjectAt object
    // for tiles that are ALREADY a dug trench (mid-session state, e.g.
    // re-entering a zone after digging one up earlier).
    syncZoneInteractivity(mapId);
    deps.debugLog(`ensureZoneTreasure(${mapId}): built ${groups.length} buried chest(s) for week ${weekIndex()}`);
  }

  // Nearest still-buried chest in a zone (its tile isn't a dug trench
  // yet), in the same pixel-space coordinates as creature x/y — used by
  // game.js's updateCompanions treasure-hint branch and updateSparkles.
  function nearestBuriedPixelPos(mapId, fromX, fromY) {
    const objs = deps._zoneTreasureObjects.get(mapId);
    if (!objs) return null;
    let best = null, bestDist = Infinity;
    for (const obj of objs.values()) {
      const tile = deps._zoneScenes.get(mapId)?.grid[obj.row]?.[obj.col];
      if (tile?.type === deps.TileType.TRENCH) continue; // already dug — no longer "buried"
      const x = (obj.col + 0.5) * deps.TILE, y = (obj.row + 0.5) * deps.TILE;
      const d = Math.hypot(x - fromX, y - fromY);
      if (d < bestDist) { bestDist = d; best = { x, y, dist: d }; }
    }
    return best;
  }

  // Only rescatters zones whose week has actually gone stale (unlike
  // reagents/berries, treasure isn't meant to reroll every day) — see
  // game.js's advanceDay.
  function respawnAll() {
    if (typeof WildernessMapGenerator === 'undefined') return;
    for (const mapId of WildernessMapGenerator.zoneMapIds()) {
      const persisted = deps._zoneTreasurePersist.get(mapId);
      if (persisted && persisted.week === weekIndex()) continue; // not stale yet
      _clearZoneTreasureMeshes(mapId);
      deps._zoneTreasurePersist.delete(mapId);
    }
    if (deps.isZoneArea(deps.getCurrentArea())) ensureZone(deps.getCurrentArea());
  }

  function serializeState() {
    const out = {};
    deps._zoneTreasurePersist.forEach((v, mapId) => { out[mapId] = { week: v.week, placements: v.placements }; });
    return out;
  }
  function restoreState(saved) {
    deps._zoneTreasurePersist.clear();
    Object.entries(saved || {}).forEach(([mapId, v]) => {
      if (v && Array.isArray(v.placements)) deps._zoneTreasurePersist.set(mapId, { week: v.week, placements: v.placements });
    });
  }

  // Rising sparkle hint for a still-buried chest within a few tiles of
  // the player — the only surface sign one exists at all, since the
  // chest itself is genuinely hidden under the ground mesh until dug
  // (see _treasureChestBuriedY). Reuses game.js's action-particle
  // overlay system (spawnActionParticles/updateActionParticles/
  // drawActionParticles) rather than a real 3D emitter, so it renders
  // through the very terrain that's hiding the chest, the way a
  // stylized "something's glowing down there" effect should.
  let _treasureSparkleTimer = 0;
  const TREASURE_SPARKLE_RANGE_PX_MUL = 3; // "within a few tiles" — × deps.TILE at call time
  function updateSparkles(dt) {
    const currentArea = deps.getCurrentArea();
    if (!deps.isZoneArea(currentArea)) return;
    _treasureSparkleTimer -= dt;
    if (_treasureSparkleTimer > 0) return;
    _treasureSparkleTimer = 0.3 + Math.random() * 0.3;
    const objs = deps._zoneTreasureObjects.get(currentArea);
    if (!objs) return;
    const rangePx = deps.TILE * TREASURE_SPARKLE_RANGE_PX_MUL;
    for (const obj of objs.values()) {
      const tile = deps._zoneScenes.get(currentArea)?.grid[obj.row]?.[obj.col];
      if (tile?.type === deps.TileType.TRENCH) continue; // already dug — no hint needed
      const cx = obj.col + 0.5, cz = obj.row + 0.5;
      const dPx = Math.hypot(cx * deps.TILE - deps.player.x, cz * deps.TILE - deps.player.y);
      if (dPx > rangePx) continue;
      const tierY = (tile?.elevTier || 0) * deps.PLATEAU_UNIT;
      if (deps.actionParticles.length >= deps.ACTION_FX_LIMIT) deps.actionParticles.shift();
      deps.actionParticles.push({
        x: cx + (Math.random() - 0.5) * 0.4,
        y: deps.NORMAL_TOP + tierY + 0.05,
        z: cz + (Math.random() - 0.5) * 0.4,
        vx: (Math.random() - 0.5) * 0.12,
        vy: 0.45 + Math.random() * 0.3,
        vz: (Math.random() - 0.5) * 0.12,
        age: 0,
        maxAge: 1.0 + Math.random() * 0.4,
        size: 8 + Math.random() * 6,
        emoji: '✨',
        color: '#ffe27a',
        gravity: -0.25, // decelerates the rise gently rather than arcing back down
      });
    }
  }

  window.WildTreasure = {
    init,
    weekIndex,
    ensureZone,
    syncZoneInteractivity,
    nearestBuriedPixelPos,
    respawnAll,
    serializeState,
    restoreState,
    updateSparkles,
  };
})();
