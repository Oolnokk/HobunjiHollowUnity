(() => {
  'use strict';

  // Honeyfuzzle hive stumps. The wilderness generator's 'beehive' objects are
  // hollowed-out stumps (SHRUB tiles with floraKind === 'beehive', drawn by
  // FoliageGenerator.buildStumpMesh). Each stump is three things at once:
  //   A. the home of one honeyfuzzle swarm: it comes out at the stump in the
  //      morning, drifts around it all day, and flies back in at dusk;
  //   B. a fertile-egg nest, and
  //   C. a natural honey resource.
  // One long hold on the stump (the same hold input/HUD contract as
  // js/corpse-hold-loot.js) yields 1-3 fertile honeyfuzzle eggs plus honey,
  // after which the stump collapses. A collapsed stump is cleared like a felled
  // tree but only regrows after HIVE_REGROW_DAYS (zone-regrowth.js honours
  // entry.regrowDays), and its swarm is left homeless until then.
  //
  // The swarm itself is an ordinary wildlife creature (CREATURE_DB.honeyfuzzle,
  // drawn by js/honeyfuzzle-swarm.js); this module only owns its hive
  // lifecycle. game.js's updateHostiles calls control() before the generic
  // wildlife AI and wildlife-spawn.js calls ensureCurrentZone() on its den
  // check interval.

  const SPECIES = 'honeyfuzzle';
  const EGG_ITEM = 'fertileHoneyfuzzleEgg';
  const HONEY_ITEM = 'honey';
  const HOLD_SECONDS = 5; // Deliberately longer than a nest take (a stump is a bigger, riskier job).
  const EGG_MIN = 1, EGG_MAX = 3;
  const HONEY_MIN = 3, HONEY_MAX = 6;
  const HIVE_REGROW_DAYS = 28;
  const SPAWN_RADIUS_TILES = 24; // Hives farther than this from the player stay empty until approached.
  const REACH_TILES = 2.6; // How close the player must stand to harvest.
  const RESPAWN_DELAY_MS = 15000; // A defeated swarm reforms 15 real-time seconds later while its stump survives.
  const TUCK_DISTANCE_TILES = 1.2; // The stump tile is solid, so a swarm can only ever reach its edge: tuck when it gets there.

  let deps = null;
  const hiveCache = new WeakMap(); // layout -> [{col,row}] — scanned once per generated layout.
  const defeatedAt = new Map(); // hiveKey -> monotonic timestamp when its active defender was defeated.
  const spawnedOnce = new Set(); // hiveKey -> true once a swarm has existed (session scope).

  let listeningForDeaths = false; // Records the precise lethal damage frame rather than waiting for a two-second wildlife spawn scan.
  function init(injectedDeps) {
    deps = injectedDeps;
    if (!listeningForDeaths && typeof window.addEventListener === 'function') {
      window.addEventListener('hobunji-resource-change', event => {
        const actor = event?.detail?.entity; // ResourceSystem emits after applying actual Health damage.
        if (event?.detail?.delta < 0 && actor?.hiveKey && actor.health <= 0) recordDefeat(actor);
      });
      listeningForDeaths = true;
    }
  }

  const hiveKeyFor = (zoneId, col, row) => `${zoneId}:hive:${col},${row}`;

  function hivesInLayout(layout) {
    if (!layout) return [];
    let list = hiveCache.get(layout);
    if (!list) {
      list = [];
      for (const tile of layout.tiles || []) {
        if (tile?.floraKind === 'beehive' && Number.isInteger(tile.c) && Number.isInteger(tile.r)) list.push({ col: tile.c, row: tile.r });
      }
      hiveCache.set(layout, list);
    }
    return list;
  }

  function isLiveHiveTile(grid, col, row) { // True while the stump still stands (a collapsed one is plain grass).
    if (window.HoneyfuzzleColors?.isExcludedZone(deps.getCurrentArea())) return false; // No honeyfuzzles on the Western Slope: its stumps are plain scenery.
    const tile = grid?.[row]?.[col];
    return !!tile && tile.type === deps.TileType.SHRUB && tile.floraKind === 'beehive';
  }

  function isNight() { return !!deps?.isNightTime?.(); }

  function clockMs() { return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now(); }

  function recordDefeat(c) {
    if (!c?.hiveKey || c.health > 0 || defeatedAt.has(c.hiveKey)) return false;
    defeatedAt.set(c.hiveKey, clockMs()); // Only the first death observation starts the 15-second countdown.
    return true;
  }

  function swarmFor(hiveKey) {
    for (const c of deps.hostileObjects) {
      if (c.hiveKey !== hiveKey) continue;
      if (c.health > 0 && !c._deathTransitionStarted) return c;
      recordDefeat(c); // Dead creatures can remain in hostileObjects until corpse cleanup.
    }
    return null;
  }

  // ---- A. swarm lifecycle ---------------------------------------------------

  function hiveGenotype(zoneId, key, primaryColor) {
    const genotype = window.CreatureGenetics?.makeDefaultGenotype?.(SPECIES) || null; // One canonical allele shape for wild swarms and their harvested eggs.
    if (!genotype?.base) return genotype;
    genotype.base.color = primaryColor || genotype.base.color;
    const seed = window.HoneyfuzzleSwarm?.seedFromString?.(key) || 0; // Same deterministic markings even if the defender is not currently spawned.
    const palette = window.HoneyfuzzleColors?.zonePalette(zoneId) || []; // Secondary pigments come from the stump's region.
    for (const [index, id] of ['tailfeathers', 'spectacles'].entries()) {
      const layer = genotype[id];
      if (!layer) continue;
      const enabled = (window.HoneyfuzzleSwarm?.hashUnit?.(seed, 60 + index) ?? 1) < 1 / 3;
      layer.copies = enabled ? 1 : 0;
      layer.enabled = enabled;
      if (palette.length) layer.color = palette[Math.floor((window.HoneyfuzzleSwarm?.hashUnit?.(seed, 80 + index) || 0) * palette.length)];
    }
    return genotype;
  }

  function spawnSwarm(zoneId, hive) {
    const T = deps.TILE;
    const hx = (hive.col + 0.5) * T, hy = (hive.row + 0.5) * T;
    const angle = deps.rnd() * Math.PI * 2;
    const swarmColor = window.HoneyfuzzleColors?.pickForKey(zoneId, hive.key) || undefined;
    const genotype = hiveGenotype(zoneId, hive.key, swarmColor); // One source of truth shared with hive egg genotype persistence.
    const c = deps.makeCreatureEntity(SPECIES, hx + Math.cos(angle) * T * 0.9, hy + Math.sin(angle) * T * 0.9, {
      homeX: hx, homeY: hy, state: 'idle', hiveKey: hive.key, wildlifeRole: 'prey',
      swarmColor, genotype, // The ordinary wildlife entity carries the same cosmetic genes as farm and companion swarms.
    });
    if (!c) return null;
    deps.hostileObjects.add(c);
    spawnedOnce.add(hive.key);
    return c;
  }

  function ensureCurrentZone() {
    if (!deps) return;
    const zoneId = deps.getCurrentArea();
    if (!deps.isZoneArea(zoneId)) return;
    const layout = deps.zoneLayouts.get(zoneId);
    const grid = deps.getGrid();
    const hives = hivesInLayout(layout);
    if (!hives.length || !grid) return;
    const T = deps.TILE, px = deps.player.x, py = deps.player.y, nowMs = clockMs();
    for (const h of hives) {
      const hive = { col: h.col, row: h.row, key: hiveKeyFor(zoneId, h.col, h.row) };
      if (!isLiveHiveTile(grid, hive.col, hive.row)) continue; // Collapsed: the swarm is homeless until it regrows.
      const existing = swarmFor(hive.key);
      if (existing) continue;
      if (Math.hypot((hive.col + 0.5) * T - px, (hive.row + 0.5) * T - py) > SPAWN_RADIUS_TILES * T) continue;
      if (!defeatedAt.has(hive.key) && spawnedOnce.has(hive.key)) {
        defeatedAt.set(hive.key, nowMs); // A despawned/missing defender also waits before being replaced.
        continue;
      }
      const diedAt = defeatedAt.get(hive.key);
      if (diedAt != null && nowMs - diedAt < RESPAWN_DELAY_MS) continue;
      if (isNight() && diedAt == null) continue; // Fresh wild swarms still emerge in the morning only.
      const replacement = spawnSwarm(zoneId, hive);
      if (replacement) {
        defeatedAt.delete(hive.key);
        if (isNight()) provokeDefender(replacement); // A recently defeated night defender returns to the fight.
      }
    }
  }

  // Called by updateHostiles for every creature before the generic wildlife AI.
  // Returns true when the swarm is hive-controlled this frame (flying home,
  // or tucked inside the stump) so the generic AI must be skipped.
  function control(c, dt) {
    if (!c.hiveKey || c.health <= 0) return false;
    const night = isNight();
    const T = deps.TILE;
    if (!night) c._hiveNightProvoked = false;
    if (night && c._hiveNightProvoked) {
      c._hiveTucked = false; // Harvest attempts wake even a swarm already hidden inside its stump.
      if (c.avatarRef?.group) c.avatarRef.group.visible = true;
      if (c.groundShadow) c.groundShadow.visible = true;
      return false; // Territorial chase/combat takes precedence over the ordinary dusk return.
    }
    if (c._hiveTucked) {
      if (night) { if (c.avatarRef?.group?.visible) c.avatarRef.group.visible = false; return true; }
      c._hiveTucked = false; // Morning: pour out of the stump, from the open ground beside it where it tucked in.
      if (c.avatarRef?.group) c.avatarRef.group.visible = true;
      if (c.groundShadow) c.groundShadow.visible = true;
      c.state = 'idle';
      return false;
    }
    if (!night) return false;
    if (c.state === 'chase' || c.state === 'searching' || c.state === 'fleeing-low-health' || c.knockbackT > 0) return false; // Defending itself beats going to bed.
    const dx = c.homeX - c.x, dy = c.homeY - c.y;
    if (Math.hypot(dx, dy) <= T * TUCK_DISTANCE_TILES) {
      c._hiveTucked = true; c.vx = 0; c.vy = 0; c.state = 'idle';
      if (c.avatarRef?.group) c.avatarRef.group.visible = false;
      if (c.groundShadow) c.groundShadow.visible = false;
      return true;
    }
    deps.moveCreatureToward(c, c.homeX, c.homeY, c.def.moveSpeed, dt);
    c.facing = Math.atan2(dy, dx);
    deps.updateCreatureMesh(c, dt, c.facing);
    deps.updateCreatureAnimFrame(c, dt, true);
    return true;
  }

  function provokeDefender(c) {
    if (!c || c.health <= 0) return false;
    c._hiveNightProvoked = true; // Kept active through the current night after an attempted hive theft.
    c._hiveTucked = false;
    if (c.avatarRef?.group) c.avatarRef.group.visible = true;
    if (c.groundShadow) c.groundShadow.visible = true;
    if (!window.HobunjiTerritorialWildlife?.provoke?.(c, deps.player, 'night hive harvest')) {
      c.state = 'chase'; // Fallback when territorial behavior has not initialized yet.
      c.targetPlayer = deps.player;
    }
    return true;
  }

  function onHarvestAttempt(zoneId, col, row) {
    if (!isNight() || zoneId !== deps.getCurrentArea() || !isLiveHiveTile(deps.getGrid(), col, row)) return false;
    const hive = { zoneId, col, row, key: hiveKeyFor(zoneId, col, row) };
    const defender = swarmFor(hive.key) || spawnSwarm(zoneId, hive); // Ignore daytime-only spawn and defeated cooldown for an attempted nighttime theft.
    return provokeDefender(defender); // No duplicates when a defender is returning, tucked or already in combat.
  }

  // ---- B/C. hold-to-harvest -------------------------------------------------

  function addToBag(itemKey, amount) {
    const stack = window.InventoryStacks?.MAX_TOTAL ?? 99;
    const before = Number(deps.inventory[itemKey]) || 0; // Missing keys read as 0, never NaN.
    deps.inventory[itemKey] = Math.min(stack, before + amount);
    return deps.inventory[itemKey] - before;
  }

  function rollHarvest(rand) {
    return {
      eggs: EGG_MIN + Math.floor(rand() * (EGG_MAX - EGG_MIN + 1)),
      honey: HONEY_MIN + Math.floor(rand() * (HONEY_MAX - HONEY_MIN + 1)),
    };
  }

  function collapseHive(zoneId, col, row) {
    const tile = deps.getGrid()?.[row]?.[col];
    if (tile) { tile.type = deps.TileType.GRASS; tile.water = 0; } // floraKind stays so the same stump regrows later.
    defeatedAt.delete(hiveKeyFor(zoneId, col, row)); // A collapsed stump cannot produce delayed replacements.
    spawnedOnce.delete(hiveKeyFor(zoneId, col, row));
    const entries = deps.felledPersist.get(zoneId) || [];
    entries.push({ col, row, feltDay: deps.calendar.day, regrowDays: HIVE_REGROW_DAYS, hive: true });
    deps.felledPersist.set(zoneId, entries);
    const updated = deps.removeZoneVegetationVisual(zoneId, col, row);
    if (!updated) window.ZoneRegrowth?.refreshZoneGroundVisuals?.(zoneId);
    for (const c of deps.hostileObjects) { // Its swarm loses its home: no more night return until a new stump grows.
      if (c.hiveKey === hiveKeyFor(zoneId, col, row)) {
        c.hiveKey = null; c._hiveTucked = false;
        if (c.avatarRef?.group) c.avatarRef.group.visible = true;
        if (c.groundShadow) c.groundShadow.visible = true;
      }
    }
  }

  function harvest(zoneId, col, row) {
    const grid = deps.getGrid();
    if (!isLiveHiveTile(grid, col, row)) return { ok: false, message: 'This stump has already collapsed.' };
    const { eggs, honey } = rollHarvest(deps.rnd);
    const eggRoom = Math.max(0, (window.InventoryStacks?.MAX_TOTAL ?? 99) - (Number(deps.inventory[EGG_ITEM]) || 0));
    if (eggRoom < 1) return { ok: false, message: 'No room in your bag for fertile eggs.' };
    const gotEggs = addToBag(EGG_ITEM, Math.min(eggs, eggRoom));
    const sourceKey = hiveKeyFor(zoneId, col, row); // Identifies the same deterministic genetic lineage as its live swarm.
    const eggColor = window.HoneyfuzzleColors?.pickForKey(zoneId, sourceKey);
    const parentGenotype = swarmFor(sourceKey)?.genotype || hiveGenotype(zoneId, sourceKey, eggColor); // Harvesting an unspawned hive still yields consistent inherited markings.
    if (eggColor && gotEggs) {
      const entries = Array.from({ length: gotEggs }, () => ({ color: eggColor, genotype: parentGenotype })); // Saved FIFO serializes these genes, not shared object references.
      window.HoneyfuzzleColors?.queueEggAppearances?.(deps.getWorldId?.(), entries);
    }
    const gotHoney = addToBag(HONEY_ITEM, honey);
    collapseHive(zoneId, col, row);
    window.HobunjiActivityEvents?.emit?.('hive_harvested', { area: zoneId, eggs: gotEggs, honey: gotHoney });
    deps.buildInventoryGrid?.(); deps.refreshItemScroll?.(); deps.refreshActionBar?.();
    deps.saveMemberWorldData?.();
    return { ok: true, eggs: gotEggs, honey: gotHoney, message: `🍯 Took ${gotEggs} fertile honeyfuzzle egg${gotEggs === 1 ? '' : 's'} and ${gotHoney} honey — the hollow stump collapses.` };
  }

  // The standing stump nearest the reticle tile (within one tile of it, like the
  // corpse hold lookup) that the player is also close enough to reach, or null.
  function getAimedHive(col, row) {
    if (!deps) return null;
    const zoneId = deps.getCurrentArea();
    if (!deps.isZoneArea(zoneId)) return null;
    const grid = deps.getGrid();
    const T = deps.TILE;
    let best = null, bestDist = Infinity;
    for (let r = row - 1; r <= row + 1; r++) {
      for (let c = col - 1; c <= col + 1; c++) {
        if (!isLiveHiveTile(grid, c, r)) continue;
        const dist = Math.hypot((c + 0.5) * T - deps.player.x, (r + 0.5) * T - deps.player.y);
        if (dist > REACH_TILES * T || dist >= bestDist) continue;
        best = { zoneId, col: c, row: r }; bestDist = dist;
      }
    }
    if (!best) return null;
    best.key = hiveKeyFor(zoneId, best.col, best.row);
    best.promptRoot = deps.getVegetationGroup?.(zoneId, best.col, best.row) || null;
    return best;
  }

  // Shaped like the world object corpse-hold-loot.js drives: it calls
  // onAction('obj_loot_corpse') once holdSeconds have elapsed.
  function getHoldTarget(col, row) {
    const hive = getAimedHive(col, row);
    if (!hive) return null;
    return {
      id: hive.key, type: 'honeyfuzzle_hive', promptRoot: hive.promptRoot,
      holdSeconds: HOLD_SECONDS, holdLabel: 'Harvesting hive stump...',
      onHoldStart: () => onHarvestAttempt(hive.zoneId, hive.col, hive.row),
      onAction: () => harvest(hive.zoneId, hive.col, hive.row),
    };
  }

  function senseTargets(scene) {
    if (!deps || !scene) return [];
    const zoneId = deps.getCurrentArea?.(); // Only the active wilderness zone can supply live, harvestable stumps.
    if (!deps.isZoneArea?.(zoneId) || window.HoneyfuzzleColors?.isExcludedZone?.(zoneId)) return [];
    const grid = deps.getGrid?.();
    const roots = []; // Tile-indexed live hive stump visuals, never the hidden swarm or collapsed stump.
    for (const hive of hivesInLayout(deps.zoneLayouts?.get?.(zoneId))) {
      if (!isLiveHiveTile(grid, hive.col, hive.row)) continue;
      const root = deps.getVegetationGroup?.(zoneId, hive.col, hive.row);
      if (root) roots.push(root);
    }
    return roots;
  }

  // Every hive stump in the active zone's layout: whether it still stands,
  // and whether its swarm is out right now. Read by the AI snapshot.
  function census() {
    if (!deps) return null;
    const zoneId = deps.getCurrentArea();
    const grid = deps.getGrid();
    const excluded = !!window.HoneyfuzzleColors?.isExcludedZone(zoneId);
    const hives = hivesInLayout(deps.zoneLayouts.get(zoneId)).map(h => {
      const key = hiveKeyFor(zoneId, h.col, h.row);
      const swarm = swarmFor(key);
      return { key, col: h.col, row: h.row, standing: isLiveHiveTile(grid, h.col, h.row), swarm: !!swarm, swarmState: swarm?.state || null, respawnInSeconds: defeatedAt.has(key) ? Math.max(0, (RESPAWN_DELAY_MS - (clockMs() - defeatedAt.get(key))) / 1000) : null };
    });
    return { zoneId, excluded, night: isNight(), spawnRadiusTiles: SPAWN_RADIUS_TILES, hives };
  }

  window.HoneyfuzzleHives = {
    SPECIES, EGG_ITEM, HONEY_ITEM, HOLD_SECONDS, HIVE_REGROW_DAYS, EGG_MIN, EGG_MAX, HONEY_MIN, HONEY_MAX,
    RESPAWN_DELAY_MS, init, ensureCurrentZone, control, recordDefeat, onHarvestAttempt, getAimedHive, getHoldTarget, harvest, rollHarvest, hivesInLayout, senseTargets, census,
    debugSnapshot: () => ({ defeatedAt: [...defeatedAt], spawned: spawnedOnce.size, activeRespawns: defeatedAt.size }),
  };
})();
