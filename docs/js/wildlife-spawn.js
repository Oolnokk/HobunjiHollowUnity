(() => {
  'use strict';

  // Wildlife schedule AI's den layer: ambient pack/herd spawning at a
  // wilderness zone's den anchors, per-den shared "family" genotype
  // rolls (reused by a den's exterior pack, its Den-Mother, and any nest
  // eggs/babies), and the non-lethal wildlife-vs-wildlife skirmish damage
  // path. Extracted out of game.js following the same window.<Namespace> +
  // init(deps) pattern as its sibling systems.
  //
  // This one has more external touchpoints than most: game.js's Tothal
  // Shift, zone-entry, den/cavern building-entry, and day-advance code all
  // reach into this system directly (not just through updateHostileSpawning's
  // own tick), and window.BanditCamps reads isDenPackAlive/denKeyFor too.
  // Everything those call sites need is exposed below; anything genuinely
  // shared with the (much larger, still-in-game.js) updateHostiles AI loop
  // — DEN_PACK_WANDER_RADIUS_PX, DEN_SETTLE_RADIUS_PX,
  // WILDLIFE_FLEE_REAGGRO_COOLDOWN_MS, PATROL_SIGHT_RANGE_PX,
  // WILDLIFE_DRINK_INTERVAL_HOURS, WILDLIFE_DRINK_DURATION_S — stays
  // declared in game.js instead of moving here, since this module's own
  // functions never actually read them.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  const CLOUD_FOREST_ID = 'map_southern_cloud_forest'; // Used to keep the specialized routines out of every other biome.
  const WOLF_SHIFT_HALF_WIDTH_HOURS = 2; // Used to create four-hour shifts centered on sunrise and sunset.
  const DRENKIRRA_EAT_GAME_HOURS = 0.5; // Used to hold a Drenkirra at one fruit for thirty in-game minutes.
  const COARSE_NEAR_TILES = 16; // Used as the inner hysteresis edge when returning distant wildlife to full simulation.
  const COARSE_FAR_TILES = 18; // Used as the outer hysteresis edge before switching wildlife to grid-step simulation.
  const COARSE_TICK_SECONDS = 1.5; // Used to rate-limit offscreen movement and statistical fights.
  const MAX_BRANCH_FRUIT = 24; // Used to cap fruit meshes and focus candidates in the dense Cloud Forest.
  const FRUIT_ITEM_KEY = 'blueberries'; // Used for the existing Southern Cloud Forest forage item granted to the player.
  const cloudPackGroups = new Map(); // denKey -> shared roaming target used to keep active gar-wolves together.
  const cloudFruitById = new Map(); // Stable branch key -> today's hanging fruit record.
  const cloudFruitReservations = new Map(); // Fruit id -> Drenkirra id, preventing the herd from stacking on one meal.
  const cloudSleepAssignments = new Map(); // Drenkirra id -> branch slot, reused instead of sorting every branch every frame.
  let cloudFruitDay = null; // Used to rebuild hanging fruit once per in-game day.
  let cloudFruitLastEnsureAt = 0; // Used to rate-limit branch rescans when chunks have not registered fruit-capable branches yet.
  let cloudSleepAssignmentsBuiltAt = 0; // Used to refresh night assignments at a low rate as creatures die or chunks change.
  let cloudFightRolls = 0; // Used by mobile wildlife diagnostics to confirm offscreen fights are being resolved.
  let lastCloudFight = 'none'; // Used by the mobile-readable wildlife snapshot as the latest coarse fight result.

  function creatureKeyOf(creature) {
    return String(creature?.creatureKey || creature?.def?.id || creature?.def?.key || '').toLowerCase();
  }

  function isGarWolf(creature) {
    return creatureKeyOf(creature).startsWith('gar-wolf') && !creature?.isDenMother;
  }

  function isDrenkirra(creature) {
    return creatureKeyOf(creature).includes('drenkirra') && !creature?.isDenMother;
  }

  function circularHourDistance(hour, center) {
    const raw = Math.abs((((Number(hour) || 0) - center + 12) % 24 + 24) % 24 - 12); // Used to compare shifts across midnight.
    return raw;
  }

  function wolfShiftAtHour(hour) {
    const sunrise = Number(deps?.MORNING_HOUR) || 6; // Used as the center of the first gar-wolf shift.
    const sunset = Number(deps?.NIGHT_HOUR) || 22; // Used as the center of the second gar-wolf shift.
    return circularHourDistance(hour, sunrise) <= WOLF_SHIFT_HALF_WIDTH_HOURS
      || circularHourDistance(hour, sunset) <= WOLF_SHIFT_HALF_WIDTH_HOURS;
  }

  function cloudForestDaytime(hour) {
    const sunrise = Number(deps?.MORNING_HOUR) || 6; // Used as the start of Drenkirra foraging time.
    const sunset = Number(deps?.NIGHT_HOUR) || 22; // Used as the start of Drenkirra sleeping time.
    return hour >= sunrise && hour < sunset;
  }

  function isCloudForestCreature(creature) {
    return creature?.areaId === CLOUD_FOREST_ID && (isGarWolf(creature) || isDrenkirra(creature));
  }

  function setCreatureVisible(creature, visible) {
    if (creature?.avatarRef?.group) creature.avatarRef.group.visible = visible;
    if (creature?.groundShadow) creature.groundShadow.visible = visible;
  }

  function canAggroPlayer(creature) {
    if (!isCloudForestCreature(creature)) return true;
    if (isGarWolf(creature)) return wolfShiftAtHour(deps.getHour());
    // Ordinary Drenkirra are prey/foragers. Nestmothers are excluded above
    // and retain the existing nest-defense attack behavior.
    return false;
  }

  function noteCreatureDamaged(creature) {
    if (!isGarWolf(creature) || creature.areaId !== CLOUD_FOREST_ID || creature.health <= 0) return;
    creature.state = 'chase';
    creature.targetPlayer = deps.player;
    setCreatureVisible(creature, true);
  }

  function canPredatorHunt(creature) {
    if (!isGarWolf(creature) || creature?.areaId !== CLOUD_FOREST_ID) return true;
    return wolfShiftAtHour(deps.getHour());
  }

  function isCloudForestHuntTarget(attacker, prey) {
    if (!isGarWolf(attacker) || attacker?.areaId !== CLOUD_FOREST_ID || !wolfShiftAtHour(deps.getHour())) return false;
    if (!prey || prey.health <= 0 || prey.areaId !== attacker.areaId || prey.onBranch || prey._cloudBranchTransition) return false;
    return prey.def?.diet === 'herbivore' || isDrenkirra(prey);
  }

  function huntLeashRangePx(creature) {
    return isGarWolf(creature) && creature?.areaId === CLOUD_FOREST_ID ? deps.TILE * 20 : null;
  }

  function predatorSightRangePx(creature, fallback) {
    return isGarWolf(creature) && creature?.areaId === CLOUD_FOREST_ID ? deps.TILE * 9 : fallback;
  }

  function isLethalCloudHunt(attacker, target) {
    return isCloudForestHuntTarget(attacker, target);
  }

  // Once a den's whole pack/herd is wiped, it stays empty — no ambient
  // scatter-spawning — until the next in-game day, when a fresh pack
  // (species re-rolled from the zone's packSpecies pool, not necessarily
  // the one that died) moves in. See game.js's advanceDay().
  const DEN_PACK_SIZE_MIN = 2;
  const DEN_PACK_SIZE_MAX = 4;
  const DEN_CHECK_INTERVAL_S = 2;
  let denCheckTimer = 0;

  // Wildlife schedule AI (den = home, foliage patches = feeding/patrol
  // grounds) — see applyWildlifeSkirmishDamage/assignWildlifeStation and
  // game.js's updateHostiles' 'fleeing-low-health'/'patrol-chase'/
  // 'at-station-grazing'/'patrolling' states.
  const WILDLIFE_FLEE_HP_THRESHOLD = 0.3; // health ratio that forces a losing animal to disengage and run home
  const WILDLIFE_HP_FLOOR_FRACTION = 0.12; // wildlife-vs-wildlife skirmishes can never reduce health below this fraction — nothing dies from them

  // Non-lethal analogue of game.js's damageCreature, used only for
  // predator-vs-prey wildlife skirmishes (see the 'patrol-chase' state) —
  // player and companion combat still go through damageCreature directly
  // and stay lethal. Clamps damage so health can never drop below
  // WILDLIFE_HP_FLOOR_FRACTION, and forces the target into
  // 'fleeing-low-health' once it's hurt enough, even if it was already
  // below threshold before this hit.
  function applyWildlifeSkirmishDamage(attacker, target, amount) {
    if (isLethalCloudHunt(attacker, target)) {
      deps.damageCreature(target, amount, attacker.x, attacker.y, deps.HOSTILE_BITE_KNOCKBACK_PX_S, { tag: attacker.def?.attackTag || 'sharp', wildlifeSource: true });
      return;
    }
    const floor = target.maxHealth * WILDLIFE_HP_FLOOR_FRACTION;
    const clamped = Math.max(0, Math.min(amount, target.health - floor));
    if (clamped > 0) deps.damageCreature(target, clamped, attacker.x, attacker.y, deps.HOSTILE_BITE_KNOCKBACK_PX_S, { tag: attacker.def?.attackTag || 'sharp', wildlifeSource: true });
    if (target.health > 0 && target.health / target.maxHealth <= WILDLIFE_FLEE_HP_THRESHOLD) {
      target.state = 'fleeing-low-health';
      target.targetCreature = null;
    }
  }

  // The foliage patch (see workspace.foliagePatches) nearest a den's home
  // point — geographic proximity, not zone-wide random pick, so a pack
  // doesn't get assigned a patrol route clear across the map. preferRich
  // only matters for predators (see assignWildlifeStation): a predator
  // needs a *rich* patch (the only ones with a nearby-cover point set —
  // see workspace.ambushStations — to patrol), a herbivore will graze at
  // any patch.
  function nearestFoliagePatch(zoneData, homeX, homeY, { preferRich = false } = {}) {
    const patches = zoneData?.foliagePatches;
    if (!patches || !patches.length) return null;
    const homeCol = homeX / deps.TILE, homeRow = homeY / deps.TILE;
    const scored = patches.map(p => ({ p, d: Math.hypot(p.centroid.x - homeCol, p.centroid.y - homeRow) })).sort((a, b) => a.d - b.d);
    if (preferRich) {
      const rich = scored.find(s => s.p.rich);
      if (rich) return rich.p;
      return null; // no rich patch anywhere in the zone — this predator gets no patrol route, falls back to plain wander
    }
    return scored[0].p;
  }

  // Nearest river/stream tile to a home point, scanning the zone's own
  // exported tile list (zoneData.tiles — the same data buildZoneScene
  // folds into zGrid) rather than requiring a live 2D grid, since this
  // runs once at spawn time (see assignWildlifeStation) before the
  // creature necessarily has one. Null if the zone has no water at all.
  function nearestWaterTile(zoneData, homeX, homeY) {
    const tiles = zoneData?.tiles;
    if (!tiles || !tiles.length) return null;
    const homeCol = homeX / deps.TILE, homeRow = homeY / deps.TILE;
    let best = null, bestD = Infinity;
    for (const t of tiles) {
      if (t.type !== deps.TileType.RIVER && t.type !== deps.TileType.STREAM) continue;
      const d = Math.hypot(t.c - homeCol, t.r - homeRow);
      if (d < bestD) { bestD = d; best = { x: t.c, y: t.r }; }
    }
    return best;
  }

  // Assigns a herbivore's grazing tile or a predator's patrol route,
  // mutating the opts object makeCreatureEntity is about to be called
  // with (see spawnPackAtDen) — a creature with neither field set just
  // falls back to plain wandering (legacy zones without generator data,
  // or no rich patch found).
  function assignWildlifeStation(opts, zoneData, homeX, homeY, isHerbivore) {
    if (isHerbivore) {
      // Assigned independently of grazing-patch availability — a
      // herbivore still needs to know where to drink even if (rarely) no
      // foliage patch was found nearby (see game.js's updateHostiles'
      // drink check).
      const water = nearestWaterTile(zoneData, homeX, homeY);
      if (water) opts.waterTile = water;
      const patch = nearestFoliagePatch(zoneData, homeX, homeY, { preferRich: false });
      if (!patch) return;
      const tile = patch.tiles[Math.floor(deps.rnd() * patch.tiles.length)];
      opts.grazingTile = { x: tile.x, y: tile.y };
      opts.grazingPatchId = patch.id;
    } else {
      const patch = nearestFoliagePatch(zoneData, homeX, homeY, { preferRich: true });
      if (!patch) return;
      // The full nearby-cover point set (see workspace.ambushStations —
      // wilderness-map-generator.js still names it after the stationary
      // "ambush" behavior this used to drive) becomes the patrol route,
      // walked in a loop rather than camped at as one fixed spot.
      const group = (zoneData.ambushStations || []).find(g => g.patchId === patch.id);
      if (!group?.points?.length) return;
      opts.patrolPoints = group.points.map(pt => ({ x: pt.x, y: pt.y }));
      opts.patrolIndex = Math.floor(deps.rnd() * opts.patrolPoints.length);
      opts.linkedPatchId = patch.id;
    }
  }

  // Set on entering a wilderness zone (see onZoneEntered, called from
  // game.js's enterZone); cleared the next time updateHostileSpawning's
  // den-check actually runs for that same zone, at which point it logs
  // the living-animal count so entering a zone reliably reports whether
  // wildlife is actually spawning there — logging immediately in
  // enterZone itself would usually just show 0, since den spawning is
  // lazy/timer-gated rather than synchronous.
  let _zoneEntryAnimalLogPending = null;

  // denKey → true once that den has ever had a pack spawned (so a fresh
  // zone's dens seed immediately, while a den that's merely between packs
  // waits for pendingDenRespawn to clear on the next day instead).
  const denEverSpawned = new Set();
  // denKey → alive/dead as of the last check — lets ensureCurrentZoneDenPacks
  // tell "just now wiped" (alive → dead transition: start waiting for the
  // next day) apart from "already known empty and the day has since
  // turned over" (spawn a fresh pack right now).
  const denLastKnownAlive = new Map();
  // denKey → true while a den is empty and deliberately waiting for the
  // next day (game.js's advanceDay/sleepInBed clear these) rather than
  // instantly refilling.
  const pendingDenRespawn = new Set();

  function denKeyFor(zoneId, den) { return `${zoneId}:${den.id}`; }
  // cavernMapId -> the zone it belongs to — zoneId/denId can't be
  // reliably parsed back out of "map_i_den_<zoneId>_<denId>" (both
  // halves can themselves contain underscores), so this side table is
  // populated wherever a cavern id is minted (denCavernMapId) instead.
  // Used by game.js's teleportToRandomDen to work from inside a den too.
  const _denCavernZoneOf = new Map();
  // Same id shape game.js's performTothalShift's denTransitions and
  // synthesizeCavernMapData both already use for the den's cavern —
  // reused as the shared lookup key so a den's exterior pack, its
  // Den-Mother, and its nest rewards all resolve the same genotype
  // without needing to parse zoneId/denId back out of the mapId string.
  function denCavernMapId(zoneId, denId) {
    const id = `map_i_den_${zoneId}_${denId}`;
    _denCavernZoneOf.set(id, zoneId);
    return id;
  }
  // Which shared-genotype "family" a CREATURE_DB key rolls/renders as —
  // gar-wolf/gar-wolf-alpha/gar-wolf-den-mother all share one gar-wolf-
  // shaped genotype (base+pattern layers), uumkaoii-wild/uumkaoii-wild-
  // den-mother share a uumkaoii-shaped one (fur+plates). Derived from
  // window.CreatureGenetics.SPECIES_ALIAS + CreatureGeneticsRender.SPECIES
  // — the exact same "which real species does this variant's genotype
  // render against" resolution game.js's updateCreatureAnimFrame/
  // spawnDevArenaCreature already do — rather than a second, separate
  // hardcoded name-prefix check that has to be kept in sync by hand and
  // silently doesn't recognize any future species until someone
  // remembers to add its prefix here too. Returns null for any species
  // with no gene system.
  function denGenotypeFamily(kind) {
    const resolved = window.CreatureGenetics.SPECIES_ALIAS[kind] || kind;
    return window.CreatureGeneticsRender?.SPECIES?.[resolved] ? resolved : null;
  }
  // (cavernMapId, family) -> shared genotype — one roll per den PER
  // FAMILY, reused by every same-family pack member, the Den-Mother, and
  // any eggs/babies taken from its nest, using the exact same odds as a
  // farm-bought crate (see makeDefaultGenotype). Keyed by family, not
  // just cavernMapId: a den's exterior population (predator pack vs.
  // herbivore herd, re-rolled each cycle) and its Den-Mother species
  // (pickDenMotherKind, a separate deterministic-per-den roll, game.js)
  // are chosen independently, so the SAME den can have a gar-wolf-family
  // occupant and a uumkaoii-family occupant at once — sharing one plain
  // cavernMapId key would mean whichever family asked first clobbers the
  // cache with its own shape, and the other family's genotype reads
  // would silently come back with none of the fields it expects.
  const _denGenotypes = new Map(); // key: `${cavernMapId}|${family}`
  function getOrMakeDenGenotype(cavernMapId, family) {
    const key = `${cavernMapId}|${family}`;
    if (!_denGenotypes.has(key)) {
      _denGenotypes.set(key, window.CreatureGenetics.makeDefaultGenotype(family));
      window.__farmLog?.(`[genotype] rolled new ${family} family genotype for den ${cavernMapId} (cache size now ${_denGenotypes.size})`, 'wildlife');
    } else {
      window.__farmLog?.(`[genotype] reused cached ${family} family genotype for den ${cavernMapId}`, 'wildlife');
    }
    return _denGenotypes.get(key);
  }

  // Forgets all pack/respawn bookkeeping for a zone whose terrain (and
  // therefore den ids) just got regenerated (see game.js's
  // performTothalShift) — otherwise stale keys from the previous
  // layout's dens would linger forever and any of this zone's dens that
  // happen to reuse an id could resume mid-"waiting for next day"
  // instead of seeding fresh.
  function forgetZoneDenState(zoneId) {
    const prefix = `${zoneId}:`;
    for (const key of denEverSpawned) if (key.startsWith(prefix)) denEverSpawned.delete(key);
    for (const key of pendingDenRespawn) if (key.startsWith(prefix)) pendingDenRespawn.delete(key);
    for (const key of [...denLastKnownAlive.keys()]) if (key.startsWith(prefix)) denLastKnownAlive.delete(key);
    // Terrain regen also reshuffles which tiles have a shadewood tree with a
    // climbable branch — old nest-tree bookkeeping keyed by col,row would
    // otherwise wrongly apply to whatever unrelated tree ends up there now.
    for (const key of nestTreeEverSpawned) if (key.startsWith(prefix)) nestTreeEverSpawned.delete(key);
    for (const key of pendingNestTreeRespawn) if (key.startsWith(prefix)) pendingNestTreeRespawn.delete(key);
    for (const key of [...nestTreeLastKnownAlive.keys()]) if (key.startsWith(prefix)) nestTreeLastKnownAlive.delete(key);
    _nestTreeSelectionCache.delete(zoneId);
    if (zoneId === CLOUD_FOREST_ID) {
      disposeCloudFruit();
      cloudFruitDay = null;
      cloudPackGroups.clear();
      cloudSleepAssignments.clear();
      cloudSleepAssignmentsBuiltAt = 0;
    }
    // Den ids (e.g. "animalDen_3") are assigned sequentially per zone
    // generation, so a fresh Tothal Shift very likely reuses an old
    // den's exact id — without this, that den's cavern would keep
    // returning its stale cached scene/nest/genotype from before the
    // shift (see game.js's loadBuildingScene's _buildingScenes.has()
    // early-return and getOrMakeDenGenotype's cache-forever lookup)
    // instead of rolling a fresh one for the new pack that just spawned
    // there.
    const cavernPrefix = `map_i_den_${zoneId}_`;
    for (const key of [..._denGenotypes.keys()]) if (key.startsWith(cavernPrefix)) _denGenotypes.delete(key);
    for (const key of [...deps.denNests.keys()]) if (key.startsWith(cavernPrefix)) deps.denNests.delete(key);
    for (const key of [...deps.buildingScenes.keys()]) if (key.startsWith(cavernPrefix)) deps.buildingScenes.delete(key);
  }

  function isDenPackAlive(denKey) {
    for (const c of deps.hostileObjects) if (c.denKey === denKey && c.health > 0) return true;
    return false;
  }

  function spawnPackAtDen(zoneId, den, denKey) {
    const zdef = deps.EXTERIOR_ZONES[zoneId];
    const cavernMapId = denCavernMapId(zoneId, den.id);
    // Pack-vs-herd used to be re-rolled fresh every spawn cycle from the
    // general mutable RNG stream — independent of the den's cavern
    // interior, which picks its own Den-Mother/creature-spawn species from
    // a FIXED roll keyed to the den's own identity (see
    // cavern-generator.js's nativeSpeciesFor). When a zone configures both
    // a packSpecies and a herbivoreSpecies pool, that let the exterior and
    // interior of the same den independently land on different answers —
    // confirmed directly: a den with gar-wolves guarding the mouth turned
    // out to be full of drenkirra inside. Same formula, same deterministic
    // per-den seed (mapId + '_denpop') as nativeSpeciesFor, so a den's
    // population type is one fixed identity everywhere it's decided, not
    // two independent coin flips that happen to usually agree.
    const hasPack = zdef?.packSpecies?.length, hasHerd = zdef?.herbivoreSpecies?.length;
    const popRng = window.WildernessMapGenerator.makeRng(cavernMapId + '_denpop');
    const useHerd = hasHerd && (!hasPack || popRng() < 0.5);
    const pool = useHerd ? zdef.herbivoreSpecies : zdef?.packSpecies;
    if (!pool || !pool.length) {
      window.__farmLog?.(`[wildlife] ${denKey}: no packSpecies/herbivoreSpecies pool configured for zone "${zoneId}" — den stays empty (fallback: skipped spawn).`, 'wildlife');
      return;
    }
    // Which INDIVIDUAL species within that fixed pool (relevant only for a
    // zone with multiple pack or multiple herd species) and how many still
    // vary per spawn cycle — only the pack-vs-herd identity itself is
    // pinned to the den.
    const speciesKey = pool[Math.floor(deps.rnd() * pool.length)];
    // Every same-family member of this pack (e.g. gar-wolf + alpha, or
    // the whole uumkaoii-wild herd) shares one rolled-once "family"
    // genotype — see getOrMakeDenGenotype.
    const denFamily = denGenotypeFamily(speciesKey);
    const denGenotype = denFamily ? getOrMakeDenGenotype(cavernMapId, denFamily) : null;
    // den.x/den.y are the footprint's top-left tile (see workspace.animalDens
    // in wilderness-map-generator.js) — spawn/home anchor is the footprint center.
    const homeX = (den.x + (den.w || 1) * 0.5) * deps.TILE, homeY = (den.y + (den.h || 1) * 0.5) * deps.TILE;
    const count = DEN_PACK_SIZE_MIN + Math.floor(deps.rnd() * (DEN_PACK_SIZE_MAX - DEN_PACK_SIZE_MIN + 1));
    const zoneData = deps.zoneLayouts.get(zoneId);
    let spawned = 0;
    for (let i = 0; i < count; i++) {
      const angle = deps.rnd() * Math.PI * 2;
      const dist = deps.TILE * (0.8 + deps.rnd() * 1.6);
      const x = homeX + Math.cos(angle) * dist, y = homeY + Math.sin(angle) * dist;
      const opts = {
        homeX, homeY, state: 'idle', denKey, genotype: denGenotype,
        packIndex: i, packSize: count,
        denBounds: { x: den.x, y: den.y, w: den.w || 1, h: den.h || 1 },
      }; // Used by group formation and the own-den collision exemption.
      assignWildlifeStation(opts, zoneData, homeX, homeY, useHerd);
      const creature = deps.makeCreatureEntity(speciesKey, x, y, opts);
      if (creature) { deps.hostileObjects.add(creature); spawned++; }
      else window.__farmLog?.(`[wildlife] ${denKey}: makeCreatureEntity("${speciesKey}") returned null (attempt ${i + 1}/${count}) — bad/missing CREATURE_DB entry?`, 'wildlife');
    }
    if (spawned > 0 && zoneId === deps.getCurrentArea()) {
      deps.showToast(`${deps.CREATURE_DB[speciesKey]?.label || speciesKey} pack moved into a den nearby.`, false);
    } else if (spawned === 0) {
      window.__farmLog?.(`[wildlife] ${denKey}: pack spawn for "${speciesKey}" placed 0/${count} creatures (fallback: den left empty).`, 'wildlife');
    }
  }

  // Spawning only positions/heights correctly for the currently active
  // area (makeCreatureEntity resolves ground height against `currentArea`
  // regardless of which scene it's told to target), so dens in a zone
  // the player isn't currently in just wait — a wipe there still marks
  // pendingDenRespawn immediately, and the very next visit (or the rest
  // of this visit, once the day turns over) lazily seeds it correctly.
  const _loggedMissingDenZones = new Set();
  function ensureCurrentZoneDenPacks() {
    const currentArea = deps.getCurrentArea();
    const layout = deps.zoneLayouts.get(currentArea);
    const dens = layout?.dens;
    if (!dens || !dens.length) {
      // A zone configured with a packSpecies pool is expected to have
      // den data (see game.js's performTothalShift's `dens:
      // workspace.animalDens`) — if it doesn't, something upstream
      // (generation, or a stale/authored-only layout — see the other
      // _zoneLayouts.set call site) silently produced none. Only log
      // once per zone per session so this doesn't spam every
      // DEN_CHECK_INTERVAL_S.
      const zdef = deps.EXTERIOR_ZONES[currentArea];
      if ((zdef?.packSpecies?.length || zdef?.herbivoreSpecies?.length) && !_loggedMissingDenZones.has(currentArea)) {
        _loggedMissingDenZones.add(currentArea);
        window.__farmLog?.(`[wildlife] zone "${currentArea}" has a packSpecies/herbivoreSpecies pool but no den anchors in _zoneLayouts (fallback: no wild packs will spawn here this session).`, 'wildlife');
      }
      return;
    }
    for (const den of dens) {
      const key = denKeyFor(currentArea, den);
      const alive = isDenPackAlive(key);

      if (alive) { denLastKnownAlive.set(key, true); continue; }

      if (!denEverSpawned.has(key)) {
        // Never populated (fresh zone/den) — seed immediately, no wait.
        denEverSpawned.add(key);
        denLastKnownAlive.set(key, false);
        spawnPackAtDen(currentArea, den, key);
        continue;
      }

      if (denLastKnownAlive.get(key) !== false) {
        // Alive as of the last check (or never checked while alive) and
        // empty now — just got wiped. Start waiting for the next day
        // instead of refilling on the spot.
        denLastKnownAlive.set(key, false);
        pendingDenRespawn.add(key);
        continue;
      }

      if (pendingDenRespawn.has(key)) continue; // still waiting for the next day

      // Already known empty, and no longer pending — the day turned
      // over since this den was wiped (see game.js's advanceDay()).
      // Move in a fresh pack now, species re-rolled from the zone's pool.
      spawnPackAtDen(currentArea, den, key);
    }
  }

  // Drenkirra nest trees: drenkirra no longer den underground (see
  // EXTERIOR_ZONES.map_southern_cloud_forest's now-empty herbivoreSpecies
  // pool) — instead a ground pack gathers at the base of a shadewood tree
  // that rolled a climbable branch (see climb-system.js's branch registry,
  // populated by game.js as each tree instance is placed), with the
  // Nestmother stationed directly on the branch itself. Mirrors
  // ensureCurrentZoneDenPacks' wipe/respawn-next-day bookkeeping, keyed by
  // tree tile instead of den id since there's no den anchor here.
  const nestTreeEverSpawned = new Set();
  const pendingNestTreeRespawn = new Set();
  const nestTreeLastKnownAlive = new Map();
  const NEST_TREE_ZONE_ID = CLOUD_FOREST_ID;
  // A HARD CAP on how many nest trees a zone can ever have, not a fraction
  // of however many climbable branches happen to exist — a dense shadewood
  // forest can easily carry hundreds of registered branches (see
  // foliage-generator.js's climbBranchChance, rolled per shared tree shape,
  // so it's common for most trees in the zone to have one), and spawning a
  // full pack + Nestmother at every one of them independently blew up
  // hostileObjects into the hundreds the moment the zone loaded — the cause
  // of the severe slowdown entering this zone. Capped to roughly the same
  // scale a zone's normal den count already runs at.
  const NEST_TREE_MAX_PER_ZONE = 5;
  const NEST_PACK_SIZE_MIN = 2;
  const NEST_PACK_SIZE_MAX = 4;
  // Cache stable tile keys, not branch object identities: chunk streaming
  // destroys and recreates branch objects as chunks unload/reload.
  const _nestTreeSelectionCache = new Map(); // zoneId -> [{ key, branch }]

  function branchTileKey(branch) { return `${branch.col},${branch.row}`; }
  function nestTreeKeyFor(zoneId, branch) { return `${zoneId}:nesttree:${branchTileKey(branch)}`; }

  function isNestTreeAlive(key) {
    for (const c of deps.hostileObjects) if (c.nestTreeKey === key && c.health > 0) return true;
    return false;
  }

  // Deterministic per-tree score (not the general mutable RNG stream) so
  // the same handful of trees hosts a nest across a session/save rather
  // than reshuffling whenever this check happens to run — sorted and
  // capped to NEST_TREE_MAX_PER_ZONE regardless of how many climbable
  // branches this zone actually has registered.
  function rebindStreamedNestBranch(zoneId, entry, liveBranch) {
    const prior = entry.branch;
    if (!prior || prior === liveBranch) return;
    if (prior.felled) liveBranch.felled = true;
    if (prior.nest && (!liveBranch.nest || prior.nest.fallen)) liveBranch.nest = prior.nest;
    const key = nestTreeKeyFor(zoneId, liveBranch);
    for (const creature of deps.hostileObjects) {
      if (creature.nestTreeKey !== key || creature.onBranch !== prior) continue;
      creature.onBranch = liveBranch;
      const t = Math.max(0, Math.min(1, Number(creature.branchT) || 0));
      creature.x = liveBranch.baseX + (liveBranch.tipX - liveBranch.baseX) * t;
      creature.y = liveBranch.baseY + (liveBranch.tipY - liveBranch.baseY) * t;
      creature.branchSurfaceY = liveBranch.baseWorldY + (liveBranch.tipWorldY - liveBranch.baseWorldY) * t;
    }
    entry.branch = liveBranch;
  }

  function eligibleNestBranches(zoneId) {
    const branches = (window.ClimbSystem?.debugBranchesFor?.(zoneId) || []).filter(branch => !branch.felled);
    let selected = _nestTreeSelectionCache.get(zoneId);
    if (!selected) {
      const scored = branches.map(branch => {
        const rng = window.WildernessMapGenerator?.makeRng?.(`${zoneId}_nesttree_${branch.col}_${branch.row}`);
        return { branch, key: branchTileKey(branch), score: rng ? rng() : deps.rnd() };
      });
      scored.sort((a, b) => a.score - b.score);
      selected = scored.slice(0, NEST_TREE_MAX_PER_ZONE)
        .map(({ key, branch }) => ({ key, branch }));
      _nestTreeSelectionCache.set(zoneId, selected);
    }

    const liveByKey = new Map(branches.map(branch => [branchTileKey(branch), branch]));
    const liveSelected = [];
    for (const entry of selected) {
      const liveBranch = liveByKey.get(entry.key);
      if (!liveBranch) continue;
      rebindStreamedNestBranch(zoneId, entry, liveBranch);
      liveSelected.push(liveBranch);
    }
    return liveSelected;
  }

  function allLiveCloudBranches() {
    return (window.ClimbSystem?.debugBranchesFor?.(CLOUD_FOREST_ID) || []).filter(branch => !branch.felled);
  }

  function branchPoint(branch, t) {
    const amount = Math.max(0, Math.min(1, Number(t) || 0)); // Used to keep branch assignments on the finite segment.
    return {
      x: branch.baseX + (branch.tipX - branch.baseX) * amount,
      y: branch.baseY + (branch.tipY - branch.baseY) * amount,
      worldY: branch.baseWorldY + (branch.tipWorldY - branch.baseWorldY) * amount,
    };
  }

  function disposeCloudFruit() {
    const scene = deps?.zoneScenes?.get(CLOUD_FOREST_ID)?.scene; // Used to detach the previous day's fruit meshes.
    for (const fruit of cloudFruitById.values()) {
      if (!fruit.mesh) continue;
      if (scene) scene.remove(fruit.mesh);
      fruit.mesh.traverse?.(node => { node.geometry?.dispose?.(); node.material?.dispose?.(); });
    }
    cloudFruitById.clear();
    cloudFruitReservations.clear();
    for (const creature of deps?.hostileObjects || []) {
      creature._cloudFruitId = null;
      creature._cloudEatT = 0;
    }
  }

  function makeFruitMesh(fruit) {
    const group = new THREE.Group(); // Used as the interaction prompt root and removable fruit cluster.
    group.name = `cloud_branch_fruit_${fruit.id}`;
    const geometry = new THREE.SphereGeometry(0.04, 6, 5); // Used by four low-poly blueberries in this one cluster.
    const material = new THREE.MeshLambertMaterial({ color: 0x4779cf }); // Used to match the existing blueberry forage color family.
    for (let index = 0; index < 4; index++) {
      const berry = new THREE.Mesh(geometry, material); // Used as one hanging fruit in the cluster.
      const angle = index / 4 * Math.PI * 2; // Used to spread berries around the branch instead of overlapping them.
      berry.position.set(Math.cos(angle) * 0.055, -0.05 - (index % 2) * 0.025, Math.sin(angle) * 0.055);
      group.add(berry);
    }
    group.position.set(fruit.x / deps.TILE, fruit.worldY, fruit.y / deps.TILE);
    group.userData.cloudFruitId = fruit.id;
    deps.zoneScenes.get(CLOUD_FOREST_ID)?.scene?.add(group);
    return group;
  }

  function ensureCloudForestFruit() {
    if (deps.getCurrentArea() !== CLOUD_FOREST_ID) return;
    cloudFruitLastEnsureAt = performance.now();
    const day = Number(deps.getDay()) || 1; // Used to make picked fruit return on the next in-game day.
    if (cloudFruitDay !== day) {
      disposeCloudFruit();
      cloudFruitDay = day;
    }
    const livingDrenkirraIds = new Set([...deps.hostileObjects]
      .filter(creature => creature.health > 0 && isDrenkirra(creature))
      .map(creature => creature.id)); // Used to release fruit reserved by a dead/despawned forager.
    for (const [fruitId, creatureId] of cloudFruitReservations) {
      if (!livingDrenkirraIds.has(creatureId)) cloudFruitReservations.delete(fruitId);
    }
    const branches = allLiveCloudBranches(); // Used to choose a bounded deterministic subset of non-nest branches.
    const scored = [];
    for (const branch of branches) {
      if (branch.nest) continue; // The Nestmother remains alone with her nest and never shares that branch with fruit/sleepers.
      const id = `${CLOUD_FOREST_ID}:fruit:${branchTileKey(branch)}`; // Used to rebind a fruit record after chunk streaming recreates its branch object.
      const rng = window.WildernessMapGenerator?.makeRng?.(`${id}:day:${day}`); // Used to make today's fruit selection stable rather than frame-order dependent.
      scored.push({ id, branch, score: rng ? rng() : deps.rnd() });
    }
    scored.sort((left, right) => left.score - right.score);
    for (const selected of scored.slice(0, MAX_BRANCH_FRUIT)) {
      const point = branchPoint(selected.branch, 0.68); // Used as both the rendered fruit location and Drenkirra eating perch.
      let fruit = cloudFruitById.get(selected.id); // Used to preserve picked/eaten state while a live chunk re-registers its branch.
      if (!fruit) {
        fruit = {
          id: selected.id, itemKey: FRUIT_ITEM_KEY, branch: selected.branch, t: 0.68,
          x: point.x, y: point.y, worldY: point.worldY, remaining: 1, mesh: null,
        }; // Used by player focus, Drenkirra reservations, and daily disposal.
        fruit.mesh = makeFruitMesh(fruit);
        cloudFruitById.set(selected.id, fruit);
      } else {
        fruit.branch = selected.branch;
        fruit.x = point.x; fruit.y = point.y; fruit.worldY = point.worldY;
        if (fruit.mesh) fruit.mesh.position.set(point.x / deps.TILE, point.worldY, point.y / deps.TILE);
      }
      selected.branch.fruit = fruit;
    }
  }

  function fruitInteractionBox(fruit) {
    const half = 0.18; // Used to make the small fruit cluster practical to aim at on mobile.
    return new THREE.Box3(
      new THREE.Vector3(fruit.x / deps.TILE - half, fruit.worldY - 0.2, fruit.y / deps.TILE - half),
      new THREE.Vector3(fruit.x / deps.TILE + half, fruit.worldY + 0.18, fruit.y / deps.TILE + half),
    );
  }

  function getAimedFruit() {
    if (deps?.getCurrentArea?.() !== CLOUD_FOREST_ID || !window.RangedWeapons?.focusCandidates) return null;
    const player = deps.player; // Used to prevent plucking fruit remotely from across the forest.
    const candidates = [];
    for (const fruit of cloudFruitById.values()) {
      if (fruit.remaining <= 0) continue;
      const closeToTree = Math.hypot(player.x - fruit.x, player.y - fruit.y) <= deps.TILE * 1.15; // Used as the physical reach gate in addition to ray focus.
      if (!closeToTree && player.onBranch !== fruit.branch) continue;
      candidates.push({ type: 'branch-fruit', id: fruit.id, data: fruit, box: fruitInteractionBox(fruit) });
    }
    const focus = window.RangedWeapons.focusCandidates(candidates, 3); // Used to select only the centered, nearby fruit cluster.
    if (!focus?.candidate?.data) return null;
    const hostile = window.RangedWeapons.focusedHostile?.(3); // Used to keep a closer animal from being hidden behind a fruit prompt.
    if (hostile && hostile.distanceWorld <= focus.distanceWorld + 0.05) return null;
    window.DebugHitboxes?.noteInteractionFocus?.(focus);
    return focus.candidate.data;
  }

  function removeFruit(fruit) {
    if (!fruit || fruit.remaining <= 0) return false;
    fruit.remaining = 0;
    cloudFruitReservations.delete(fruit.id);
    if (fruit.mesh) {
      deps.zoneScenes.get(CLOUD_FOREST_ID)?.scene?.remove(fruit.mesh);
      fruit.mesh.visible = false;
    }
    return true;
  }

  function takeAimedFruit() {
    const fruit = getAimedFruit(); // Used to revalidate focus at the instant the action fires.
    if (!removeFruit(fruit)) return { ok: false, message: 'No fruit is within reach.' };
    deps.inventory[fruit.itemKey] = Math.min(99, (deps.inventory[fruit.itemKey] || 0) + 1);
    deps.clampInventoryStack(fruit.itemKey);
    deps.refreshItemScroll();
    deps.buildInventoryGrid();
    deps.saveMemberWorldData();
    window.AudioSystem?.playObjectSfx(window.AudioSystem?.objectSfxConfig?.().harvest);
    return { ok: true, message: 'Picked Blueberries.' };
  }

  function chooseFruitFor(creature) {
    const reserved = creature._cloudFruitId ? cloudFruitById.get(creature._cloudFruitId) : null; // Used to keep a Drenkirra committed to its current meal.
    if (reserved?.remaining > 0 && cloudFruitReservations.get(reserved.id) === creature.id) return reserved;
    if (creature._cloudFruitId) cloudFruitReservations.delete(creature._cloudFruitId);
    creature._cloudFruitId = null;
    let best = null; // Used to select this individual Drenkirra's nearest unclaimed fruit.
    let bestDistance = Infinity; // Used to compare candidate fruit without sorting the entire map.
    for (const fruit of cloudFruitById.values()) {
      if (fruit.remaining <= 0 || cloudFruitReservations.has(fruit.id)) continue;
      const distance = Math.hypot(creature.x - fruit.x, creature.y - fruit.y); // Used to distribute the herd spatially instead of random clumping.
      if (distance < bestDistance) { best = fruit; bestDistance = distance; }
    }
    if (best) {
      creature._cloudFruitId = best.id;
      cloudFruitReservations.set(best.id, creature.id);
    }
    return best;
  }

  function clearCreatureBranch(creature) {
    if (!creature.onBranch) return;
    const branch = creature.onBranch; // Used to return the creature to the trunk before resuming ground navigation.
    creature.x = branch.baseX;
    creature.y = branch.baseY;
    creature.onBranch = null;
    creature.branchT = 0;
    creature.branchSurfaceY = 0;
  }

  function startBranchTransition(creature, branch, targetT, purpose) {
    const point = branchPoint(branch, targetT); // Used as the interpolation destination on the assigned branch.
    creature._cloudBranchTransition = {
      branch, targetT, purpose, t: 0,
      startX: creature.x, startY: creature.y,
      startSurfaceY: Number(deps.worldSurfaceY?.(creature.x, creature.y)) || 0,
      endX: point.x, endY: point.y, endSurfaceY: point.worldY,
    }; // Used to animate the climb without teleporting from ground to branch.
    creature.state = purpose === 'sleep' ? 'cloud-climbing-to-sleep' : 'cloud-climbing-to-fruit';
  }

  function updateBranchTransition(creature, dt) {
    const transition = creature._cloudBranchTransition; // Used as the active ground-to-branch climb interpolation.
    if (!transition) return null;
    transition.t = Math.min(1, transition.t + Math.max(0, Number(dt) || 0) / 0.78);
    const eased = 1 - Math.pow(1 - transition.t, 2); // Used to ease the creature onto the branch rather than move linearly.
    creature.x = transition.startX + (transition.endX - transition.startX) * eased;
    creature.y = transition.startY + (transition.endY - transition.startY) * eased;
    creature.branchSurfaceY = transition.startSurfaceY + (transition.endSurfaceY - transition.startSurfaceY) * eased;
    const aimAngle = Math.atan2(transition.endY - creature.y, transition.endX - creature.x); // Used to face into the climb.
    if (transition.t >= 1) {
      creature.onBranch = transition.branch;
      creature.branchT = transition.targetT;
      creature.x = transition.endX; creature.y = transition.endY; creature.branchSurfaceY = transition.endSurfaceY;
      creature.state = transition.purpose === 'sleep' ? 'cloud-tree-sleep' : 'cloud-eating-fruit';
      creature._cloudBranchTransition = null;
    }
    return { handled: true, moving: true, aimAngle };
  }

  function sleepAssignmentFor(creature) {
    const now = performance.now(); // Used to avoid rebuilding the global two-per-branch allocation for every sleeper every frame.
    const cached = cloudSleepAssignments.get(creature.id); // Used as this creature's current stable night perch.
    if (cached && !cached.branch.felled && now - cloudSleepAssignmentsBuiltAt < 1000) return cached;
    cloudSleepAssignments.clear();
    cloudSleepAssignmentsBuiltAt = now;
    const liveBranches = allLiveCloudBranches(); // Used as the one shared branch pool for every nest group.
    const nestByKey = new Map(liveBranches.filter(branch => branch.nest?.id).map(branch => [branch.nest.id, branch])); // Used to center each sleeper's preference on its own Nestmother.
    const sleepingBranches = liveBranches.filter(branch => !branch.nest); // Used to guarantee every Nestmother remains alone with her nest.
    const members = [...deps.hostileObjects]
      .filter(member => member.health > 0 && isDrenkirra(member) && member.areaId === CLOUD_FOREST_ID)
      .sort((left, right) => `${left.nestTreeKey}:${left.id}`.localeCompare(`${right.nestTreeKey}:${right.id}`)); // Used to make the global two-per-branch allocation deterministic.
    const occupancy = new Map(); // Branch -> assigned count, used to enforce two Drenkirra total rather than two per nest group.
    for (const member of members) {
      const nestBranch = nestByKey.get(member.nestTreeKey); // Used as this member's distance origin.
      if (!nestBranch) continue;
      const candidates = sleepingBranches.slice().sort((left, right) => {
        const leftDistance = Math.hypot(left.baseX - nestBranch.baseX, left.baseY - nestBranch.baseY); // Used to rank the nearest available sleeping tree.
        const rightDistance = Math.hypot(right.baseX - nestBranch.baseX, right.baseY - nestBranch.baseY); // Used to rank the nearest available sleeping tree.
        return leftDistance - rightDistance || branchTileKey(left).localeCompare(branchTileKey(right));
      });
      const branch = candidates.find(candidate => (occupancy.get(candidate) || 0) < 2); // Used to select the nearest branch with a free one-of-two slot.
      if (!branch) continue;
      const slot = occupancy.get(branch) || 0; // Used to place the pair apart along the same branch.
      occupancy.set(branch, slot + 1);
      cloudSleepAssignments.set(member.id, { branch, t: slot === 0 ? 0.35 : 0.65 });
    }
    return cloudSleepAssignments.get(creature.id) || null;
  }

  function cloudGroupTargetFor(creature) {
    const key = creature.denKey || `wolf:${Math.round(creature.homeX)},${Math.round(creature.homeY)}`; // Used to share one roaming center among den-mates.
    let group = cloudPackGroups.get(key); // Used to reuse the current group target until its roaming leg expires.
    const now = performance.now(); // Used to time group target changes in real seconds.
    if (!group || now >= group.expiresAt) {
      const angle = deps.rnd() * Math.PI * 2; // Used to select the pack's next shared roaming bearing.
      const radius = deps.TILE * (5 + deps.rnd() * 7); // Used to send each active shift well beyond the den mouth.
      group = {
        x: creature.homeX + Math.cos(angle) * radius,
        y: creature.homeY + Math.sin(angle) * radius,
        expiresAt: now + 5000 + deps.rnd() * 5000,
      }; // Used as the center of the pack's loose moving formation.
      cloudPackGroups.set(key, group);
    }
    const formationAngle = ((Number(creature.packIndex) || 0) / Math.max(1, Number(creature.packSize) || 1)) * Math.PI * 2; // Used to keep den-mates visibly grouped without exact overlap.
    return {
      x: group.x + Math.cos(formationAngle) * deps.TILE * 0.65,
      y: group.y + Math.sin(formationAngle) * deps.TILE * 0.65,
    };
  }

  function moveCoarseToward(creature, targetX, targetY, speedScale = 1) {
    const dx = targetX - creature.x, dy = targetY - creature.y; // Used to advance one low-rate grid-simulation step.
    const distance = Math.hypot(dx, dy); // Used to clamp the coarse step at the target.
    if (distance < 1) return false;
    const step = Math.min(distance, deps.TILE * 2.5 * speedScale); // Used to move distant dots without running per-frame pathfinding.
    creature.x += dx / distance * step;
    creature.y += dy / distance * step;
    creature.facing = Math.atan2(dy, dx);
    return true;
  }

  function distantFightScore(creature, randomValue) {
    const stats = (Number(creature?.maxHealth) || 1)
      + (Number(creature?.def?.attackDamage) || 1) * 5
      + (Number(creature?.def?.chaseSpeed) || Number(creature?.def?.moveSpeed) || 1) * 0.2; // Used as the statistical strength behind offscreen fight dice.
    const healthRatio = Math.max(0.1, Math.min(1, (Number(creature?.health) || 0) / Math.max(1, Number(creature?.maxHealth) || 1))); // Used to make injured animals less likely to win.
    return stats * healthRatio * (0.7 + (Number(randomValue) || 0) * 0.6);
  }

  function resolveDistantFight(wolf, prey) {
    const wolfScore = distantFightScore(wolf, deps.rnd()); // Used as the gar-wolf's weighted die roll.
    const preyScore = distantFightScore(prey, deps.rnd()); // Used as the prey's weighted die roll.
    const winner = wolfScore >= preyScore ? wolf : prey; // Used to report and preserve the surviving entity.
    const loser = winner === wolf ? prey : wolf; // Used as the entity sent through the real death pipeline.
    deps.damageCreature(loser, Math.max(1, loser.health + 1), winner.x, winner.y, 0, { tag: winner.def?.attackTag || 'sharp', wildlifeSource: true });
    cloudFightRolls += 1;
    lastCloudFight = `${winner.creatureKey} defeated ${loser.creatureKey}`;
    window.__farmLog?.(`[wildlife] coarse fight: ${lastCloudFight} (${wolfScore.toFixed(1)} vs ${preyScore.toFixed(1)})`, 'wildlife');
  }

  function updateCoarseCreature(creature) {
    const hour = deps.getHour(); // Used to choose the same schedule state as the nearby visual simulation.
    if (isGarWolf(creature)) {
      if (!wolfShiftAtHour(hour)) {
        moveCoarseToward(creature, creature.homeX, creature.homeY, 1);
        creature.state = 'cloud-den-resting-coarse';
        return;
      }
      let prey = null; // Used to select the nearest on-ground prey for this coarse hunt step.
      let preyDistance = Infinity; // Used to compare distant prey without sorting every hostile.
      for (const candidate of deps.hostileObjects) {
        if (!isCloudForestHuntTarget(creature, candidate)) continue;
        const distance = Math.hypot(candidate.x - creature.x, candidate.y - creature.y); // Used to limit coarse awareness to a local grid neighborhood.
        if (distance < preyDistance && distance <= deps.TILE * 18) { prey = candidate; preyDistance = distance; }
      }
      if (prey) {
        if (preyDistance <= deps.TILE * 1.25) resolveDistantFight(creature, prey);
        else moveCoarseToward(creature, prey.x, prey.y, 1.25);
        creature.state = 'cloud-hunting-coarse';
      } else {
        const target = cloudGroupTargetFor(creature); // Used to keep offscreen pack dots moving as one shift group.
        moveCoarseToward(creature, target.x, target.y, 1);
        creature.state = 'cloud-wolf-shift-coarse';
      }
      return;
    }

    if (isDrenkirra(creature)) {
      if (!cloudForestDaytime(hour)) {
        const sleep = sleepAssignmentFor(creature); // Used to move the coarse dot toward its Nestmother-adjacent sleeping tree.
        if (sleep) moveCoarseToward(creature, sleep.branch.baseX, sleep.branch.baseY, 0.8);
        creature.state = 'cloud-tree-sleep-coarse';
        return;
      }
      const fruit = chooseFruitFor(creature); // Used to give each coarse Drenkirra an independent feeding destination.
      if (fruit) {
        const distance = Math.hypot(creature.x - fruit.x, creature.y - fruit.y); // Used to decide whether this coarse step travels or eats.
        if (distance > deps.TILE) {
          moveCoarseToward(creature, fruit.branch.baseX, fruit.branch.baseY, 0.8);
          creature.state = 'cloud-foraging-coarse';
        } else {
          creature._cloudCoarseEatHours = (creature._cloudCoarseEatHours || 0) + deps.gameHoursPerCoarseTick;
          creature.state = 'cloud-eating-fruit-coarse';
          if (creature._cloudCoarseEatHours >= DRENKIRRA_EAT_GAME_HOURS) {
            removeFruit(fruit);
            creature._cloudCoarseEatHours = 0;
            creature._cloudFruitId = null;
          }
        }
      } else {
        const angle = ((String(creature.id).length * 1.618) % (Math.PI * 2)); // Used as an individual fallback bearing when today's fruit is exhausted.
        moveCoarseToward(creature, creature.homeX + Math.cos(angle) * deps.TILE * 5, creature.homeY + Math.sin(angle) * deps.TILE * 5, 0.6);
        creature.state = 'cloud-foraging-coarse';
      }
    }
  }

  function updateCloudForestCreature(creature, dt) {
    if (!isCloudForestCreature(creature)) return null;
    const currentDay = Number(deps.getDay()) || 1; // Used to avoid rescanning hundreds of branches once per creature per frame.
    if (cloudFruitDay !== currentDay || (cloudFruitById.size === 0 && performance.now() - cloudFruitLastEnsureAt >= 2000)) ensureCloudForestFruit();
    const playerDistance = Math.hypot(creature.x - deps.player.x, creature.y - deps.player.y); // Used to switch between nearby visuals and coarse grid simulation.
    const coarseThreshold = deps.TILE * (creature._coarseSimulated ? COARSE_NEAR_TILES : COARSE_FAR_TILES); // Used as hysteresis so the mode does not flicker at one boundary.
    if (playerDistance > coarseThreshold && !creature._branchDefense) {
      creature._coarseSimulated = true;
      setCreatureVisible(creature, false);
      creature._cloudCoarseTimer = (creature._cloudCoarseTimer || 0) - dt;
      if (creature._cloudCoarseTimer <= 0) {
        creature._cloudCoarseTimer = COARSE_TICK_SECONDS;
        clearCreatureBranch(creature);
        updateCoarseCreature(creature);
      }
      return { handled: true, moving: false, aimAngle: creature.facing || 0 };
    }

    if (creature._coarseSimulated) {
      creature._coarseSimulated = false;
      creature._cloudCoarseTimer = 0;
      setCreatureVisible(creature, true);
      creature.scaleY = 1;
    }
    if (creature.state === 'chase' || creature.state === 'patrol-chase') setCreatureVisible(creature, true);
    const transitionResult = updateBranchTransition(creature, dt); // Used to let an in-progress climb own this frame's movement.
    if (transitionResult) return transitionResult;

    const hour = deps.getHour(); // Used to choose the nearby shift/forage/sleep routine.
    if (isGarWolf(creature)) {
      if (creature.state === 'chase' || creature.state === 'patrol-chase' || creature.state === 'fleeing-low-health' || creature.prone || creature.knockbackT > 0) return null;
      if (!wolfShiftAtHour(hour)) {
        const distance = Math.hypot(creature.x - creature.homeX, creature.y - creature.homeY); // Used to hide the wolf only after it has actually returned inside its den.
        if (distance > deps.TILE * 0.35) {
          const moving = deps.travelCreatureToward(creature, creature.homeX, creature.homeY, creature.def.moveSpeed, dt); // Used to path home through the creature's own den exemption.
          creature.state = 'cloud-returning-to-den';
          return { handled: true, moving, aimAngle: Math.atan2(creature.homeY - creature.y, creature.homeX - creature.x) };
        }
        creature.state = 'cloud-den-resting';
        setCreatureVisible(creature, false);
        return { handled: true, moving: false, aimAngle: creature.facing || 0 };
      }
      setCreatureVisible(creature, true);
      const target = cloudGroupTargetFor(creature); // Used to keep the nearby pack in one loose sunrise/sunset formation.
      const moving = deps.travelCreatureToward(creature, target.x, target.y, creature.def.moveSpeed, dt); // Used to route the whole shift around real structures.
      creature.state = 'cloud-wolf-shift';
      return { handled: true, moving, aimAngle: moving ? Math.atan2(target.y - creature.y, target.x - creature.x) : creature.facing || 0 };
    }

    if (creature.state === 'fleeing-low-health' || creature.prone || creature.knockbackT > 0) return null;
    if (!cloudForestDaytime(hour)) {
      if (creature._cloudFruitId) cloudFruitReservations.delete(creature._cloudFruitId);
      creature._cloudFruitId = null;
      creature._cloudEatT = 0;
      const sleep = sleepAssignmentFor(creature); // Used to enforce two ordinary Drenkirra per branch nearest their Nestmother.
      if (!sleep) {
        creature.scaleY = 0.5;
        creature.state = 'cloud-ground-sleep-fallback';
        return { handled: true, moving: false, aimAngle: creature.facing || 0 };
      }
      if (creature.onBranch === sleep.branch) {
        const point = branchPoint(sleep.branch, sleep.t); // Used to hold the sleeper in its assigned one-of-two branch slot.
        creature.branchT = sleep.t; creature.x = point.x; creature.y = point.y; creature.branchSurfaceY = point.worldY;
        creature.scaleY = 0.5;
        creature.state = 'cloud-tree-sleep';
        return { handled: true, moving: false, aimAngle: creature.facing || 0 };
      }
      if (creature.onBranch) clearCreatureBranch(creature);
      creature.scaleY = 1;
      const distance = Math.hypot(creature.x - sleep.branch.baseX, creature.y - sleep.branch.baseY); // Used to decide whether to travel to or climb the sleeping tree.
      if (distance > deps.TILE * 0.55) {
        const moving = deps.travelCreatureToward(creature, sleep.branch.baseX, sleep.branch.baseY, creature.def.moveSpeed, dt); // Used to route separately to the assigned tree.
        creature.state = 'cloud-traveling-to-sleep-tree';
        return { handled: true, moving, aimAngle: Math.atan2(sleep.branch.baseY - creature.y, sleep.branch.baseX - creature.x) };
      }
      startBranchTransition(creature, sleep.branch, sleep.t, 'sleep');
      return updateBranchTransition(creature, dt);
    }

    creature.scaleY = 1;
    if (creature.onBranch && creature.state === 'cloud-tree-sleep') clearCreatureBranch(creature);
    const fruit = chooseFruitFor(creature); // Used to send each daytime Drenkirra toward a separate hanging fruit.
    if (!fruit) {
      const moving = deps.wanderTick(creature, dt, creature.homeX, creature.homeY, deps.TILE * 6); // Used as independent daytime searching after all fruit is gone/reserved.
      creature.state = 'cloud-searching-for-fruit';
      return { handled: true, moving, aimAngle: moving ? Math.atan2(creature.vy, creature.vx) : creature.facing || 0 };
    }
    if (creature.onBranch === fruit.branch) {
      const point = branchPoint(fruit.branch, fruit.t); // Used to keep the eater beside its selected fruit for the full timer.
      creature.branchT = fruit.t; creature.x = point.x; creature.y = point.y; creature.branchSurfaceY = point.worldY;
      creature._cloudEatT = (creature._cloudEatT || 0) + dt;
      creature.state = 'cloud-eating-fruit';
      const eatSeconds = Math.max(0.1, DRENKIRRA_EAT_GAME_HOURS / deps.gameHoursPerSecond); // Used to convert thirty game minutes to real simulation seconds.
      if (creature._cloudEatT >= eatSeconds) {
        removeFruit(fruit);
        creature._cloudEatT = 0;
        creature._cloudFruitId = null;
        clearCreatureBranch(creature);
      }
      return { handled: true, moving: false, aimAngle: creature.facing || 0 };
    }
    if (creature.onBranch) clearCreatureBranch(creature);
    const distance = Math.hypot(creature.x - fruit.branch.baseX, creature.y - fruit.branch.baseY); // Used to decide whether this individual travels or starts climbing.
    if (distance > deps.TILE * 0.55) {
      const moving = deps.travelCreatureToward(creature, fruit.branch.baseX, fruit.branch.baseY, creature.def.moveSpeed, dt); // Used to route independently to the fruit tree.
      creature.state = 'cloud-traveling-to-fruit';
      return { handled: true, moving, aimAngle: Math.atan2(fruit.branch.baseY - creature.y, fruit.branch.baseX - creature.x) };
    }
    startBranchTransition(creature, fruit.branch, fruit.t, 'fruit');
    return updateBranchTransition(creature, dt);
  }

  function cloudForestDebugSnapshot() {
    const hour = Number(deps?.getHour?.()) || 0; // Used to report the exact schedule branch active in mobile diagnostics.
    let coarse = 0, wolves = 0, drenkirra = 0, sleepers = 0, eaters = 0; // Used as compact counters in the debug panel/dump.
    for (const creature of deps?.hostileObjects || []) {
      if (creature.areaId !== CLOUD_FOREST_ID || creature.health <= 0) continue;
      if (creature._coarseSimulated) coarse++;
      if (isGarWolf(creature)) wolves++;
      if (isDrenkirra(creature)) drenkirra++;
      if (String(creature.state).includes('sleep')) sleepers++;
      if (String(creature.state).includes('eating-fruit')) eaters++;
    }
    const fruitRemaining = [...cloudFruitById.values()].filter(fruit => fruit.remaining > 0).length; // Used to expose today's remaining meals/pickups.
    return {
      hour, wolfShiftActive: wolfShiftAtHour(hour), daytime: cloudForestDaytime(hour),
      wolves, drenkirra, sleepers, eaters, coarse,
      fruitRemaining, fruitTotal: cloudFruitById.size,
      coarseFightRolls: cloudFightRolls, lastCloudFight,
    };
  }

  function refreshCloudForestDebugCard() {
    const pane = document.getElementById('devWildlifePane'); // Used as the existing mobile-visible wildlife diagnostics host.
    if (!pane) return;
    let card = document.getElementById('cloudForestRoutineDebug'); // Used to reuse one live schedule/simulation card.
    if (!card) {
      card = document.createElement('div');
      card.id = 'cloudForestRoutineDebug';
      card.className = 'small';
      card.style.cssText = 'margin:6px 0;padding:6px;border:1px solid currentColor;border-radius:6px;white-space:pre-line;';
      pane.prepend(card);
    }
    const snapshot = cloudForestDebugSnapshot(); // Used to format current shift, feeding, sleep, fruit, and coarse-fight state.
    card.textContent = [
      'Cloud Forest Routines',
      `hour ${snapshot.hour.toFixed(2)} · wolves ${snapshot.wolfShiftActive ? 'ON SHIFT' : 'in dens'} · ${snapshot.daytime ? 'day forage' : 'tree sleep'}`,
      `wolves ${snapshot.wolves} · drenkirra ${snapshot.drenkirra} · sleep ${snapshot.sleepers} · eat ${snapshot.eaters}`,
      `coarse dots ${snapshot.coarse} · fruit ${snapshot.fruitRemaining}/${snapshot.fruitTotal}`,
      `far fights ${snapshot.coarseFightRolls} · ${snapshot.lastCloudFight}`,
    ].join('\n');
  }

  function spawnNestAtBranch(zoneId, branch, key) {
    const nestMotherConfig = deps.DEN_MOTHER_DEFS?.drenkirra;
    const motherKey = nestMotherConfig?.creatureKey;
    const motherDef = motherKey ? deps.CREATURE_DB[motherKey] : null;
    if (!motherDef) {
      window.__farmLog?.(`[wildlife] ${key}: no drenkirra Nestmother configured (DEN_MOTHER_DEFS.drenkirra missing) — nest tree left empty.`, 'warn');
      return;
    }
    const midX = (branch.baseX + branch.tipX) / 2, midY = (branch.baseY + branch.tipY) / 2;
    const midWorldY = (branch.baseWorldY + branch.tipWorldY) / 2;
    const midT = 0.5;
    const motherFamily = denGenotypeFamily(motherKey);
    const nestGenotype = motherFamily ? getOrMakeDenGenotype(key, motherFamily) : null;
    const nestRng = window.WildernessMapGenerator?.makeRng?.(key + '_nestcount') || deps.rnd;
    const clutchCfg = window.SCRATCHBONES_CONFIG?.game?.wildlife?.nestClutch || {};
    const clutchMin = Math.max(1, Math.floor(Number(clutchCfg.min) || 1));
    const clutchMax = Math.max(clutchMin, Math.floor(Number(clutchCfg.max) || clutchMin));
    const itemKey = deps.DEN_MOTHER_ITEM_KEYS?.[motherKey];
    const remaining = clutchMin + Math.floor(nestRng() * (clutchMax - clutchMin + 1));

    // Nestmother — stationed directly on the branch (skips the scripted
    // climb animation; she's simply placed there), ready to fire her
    // caustic pellet down at anyone approaching the tree. onBranch/branchT
    // plug her into the same 1D-movement/fall-to-ground-knockback rules a
    // climbed-up player gets (see climb-system.js/game.js's applyKnockback).
    const mother = deps.makeCreatureEntity(motherKey, midX, midY, {
      homeX: midX, homeY: midY, state: 'idle', isDenMother: true, nestTreeKey: key,
      genotype: nestGenotype,
    });
    if (!mother) {
      window.__farmLog?.(`[wildlife] ${key}: makeCreatureEntity("${motherKey}") returned null — nest tree left empty.`, 'wildlife');
      return;
    }
    // updateCreatureMesh reads onBranch/branchSurfaceY every frame (mirrors
    // the player's climbSurfaceY/branchSurfaceY override) to place her at
    // the branch's height instead of terrain-follow.
    mother.onBranch = branch;
    mother.branchT = midT;
    mother.branchSurfaceY = midWorldY;
    deps.hostileObjects.add(mother);

    // Ground pack — same size range as a den's exterior pack, scattered
    // around the tree's base instead of a den footprint's center.
    const zoneData = deps.zoneLayouts.get(zoneId);
    const count = NEST_PACK_SIZE_MIN + Math.floor(deps.rnd() * (NEST_PACK_SIZE_MAX - NEST_PACK_SIZE_MIN + 1));
    let spawned = 0;
    for (let i = 0; i < count; i++) {
      const angle = deps.rnd() * Math.PI * 2;
      const dist = deps.TILE * (0.8 + deps.rnd() * 1.6);
      const x = branch.baseX + Math.cos(angle) * dist, y = branch.baseY + Math.sin(angle) * dist;
      const opts = { homeX: branch.baseX, homeY: branch.baseY, state: 'idle', nestTreeKey: key };
      assignWildlifeStation(opts, zoneData, branch.baseX, branch.baseY, true);
      const creature = deps.makeCreatureEntity('drenkirra', x, y, opts);
      if (creature) { deps.hostileObjects.add(creature); spawned++; }
    }

    // Store the branch objective on the registered branch itself so the
    // climb system can resolve its 3D focus box without a second registry.
    branch.nest = itemKey ? {
      id: key, areaId: zoneId, x: midX, y: midY, worldY: midWorldY,
      itemKey, liveBirth: !!nestMotherConfig?.liveBirth, remaining,
      genotype: nestGenotype, mesh: null,
      interactionCollider: { halfWidth: 0.55, bottomOffset: -0.15, topOffset: 0.65 },
    } : null;
    if (!itemKey) {
      window.__farmLog?.(`[wildlife] Nestmother "${motherKey}" has no configured nest reward; branch collection is disabled.`, 'warn');
    }

    // Branch-nest furniture, centered where the Nestmother sits.
    const zi = deps.zoneScenes?.get(zoneId);
    if (zi?.scene && window.ProceduralFurniture) {
      const col = midX / deps.TILE - 0.5, row = midY / deps.TILE - 0.5;
      const rotYDeg = Math.atan2(branch.tipY - branch.baseY, branch.tipX - branch.baseX) * 180 / Math.PI;
      const result = deps.makeDecorativeFurnitureMesh?.(col, row, 'nestBranch', zi.scene, zoneId, rotYDeg);
      if (result) {
        result.mesh.position.y += midWorldY;
        if (branch.nest) branch.nest.mesh = result.mesh;
      }
    }

    if (zoneId === deps.getCurrentArea()) deps.showToast(`${motherDef.label || 'A drenkirra Nestmother'} is nesting nearby.`, false);
  }

  function ensureCurrentZoneNestTrees() {
    const currentArea = deps.getCurrentArea();
    if (currentArea !== NEST_TREE_ZONE_ID) return;
    for (const branch of eligibleNestBranches(currentArea)) {
      const key = nestTreeKeyFor(currentArea, branch);
      const alive = isNestTreeAlive(key);

      if (alive) { nestTreeLastKnownAlive.set(key, true); continue; }

      if (!nestTreeEverSpawned.has(key)) {
        nestTreeEverSpawned.add(key);
        nestTreeLastKnownAlive.set(key, false);
        spawnNestAtBranch(currentArea, branch, key);
        continue;
      }

      if (nestTreeLastKnownAlive.get(key) !== false) {
        nestTreeLastKnownAlive.set(key, false);
        pendingNestTreeRespawn.add(key);
        continue;
      }

      if (pendingNestTreeRespawn.has(key)) continue; // still waiting for the next day

      spawnNestAtBranch(currentArea, branch, key);
    }
  }

  function updateHostileSpawning(dt) {
    // Ambient wildlife spawning has no business intruding on an
    // authored cutscene once this scene finally lives on a real
    // wilderness zone map — the combat card's own wolves are added to
    // hostileObjects explicitly (see game.js's runCombat).
    if (deps.getCutscenePreviewActive()) return;
    const currentArea = deps.getCurrentArea();
    if (!deps._isZoneArea(currentArea)) return;
    denCheckTimer -= dt;
    if (denCheckTimer > 0) return;
    denCheckTimer = DEN_CHECK_INTERVAL_S;
    if (!deps.buildZoneScene(currentArea)) return;
    ensureCurrentZoneDenPacks();
    ensureCurrentZoneNestTrees();
    ensureCloudForestFruit();
    refreshCloudForestDebugCard();
    window.BanditCamps.ensureCurrentZoneCamps();
    if (_zoneEntryAnimalLogPending === currentArea) {
      _zoneEntryAnimalLogPending = null;
      let alive = 0;
      for (const c of deps.hostileObjects) if (c.health > 0 && c.areaId === currentArea) alive++;
      window.__farmLog?.(`[wildlife] entered "${currentArea}": ${alive} living animal${alive === 1 ? '' : 's'} present.`, 'wildlife');
    }
  }

  // Called from game.js's enterZone — fires the den-check on the very
  // next frame instead of waiting up to DEN_CHECK_INTERVAL_S, so wildlife
  // populates promptly on arrival and the log reflects it.
  function onZoneEntered(mapId) {
    denCheckTimer = 0;
    _zoneEntryAnimalLogPending = mapId;
  }

  window.WildlifeSpawn = {
    init,
    applyWildlifeSkirmishDamage,
    denKeyFor,
    denCavernMapId,
    denCavernZoneOf: (mapId) => _denCavernZoneOf.get(mapId),
    denGenotypeFamily,
    getOrMakeDenGenotype,
    getDenGenotypes: () => _denGenotypes,
    forgetZoneDenState,
    isDenPackAlive,
    canAggroPlayer,
    noteCreatureDamaged,
    canPredatorHunt,
    isCloudForestHuntTarget,
    huntLeashRangePx,
    predatorSightRangePx,
    updateCloudForestCreature,
    getAimedFruit,
    takeAimedFruit,
    cloudForestDebugSnapshot,
    updateHostileSpawning,
    onZoneEntered,
    // Also clears pendingNestTreeRespawn — a wiped nest tree waits for the
    // next day exactly like a wiped den (see ensureCurrentZoneNestTrees),
    // so it rides the same day-advance call sites as den respawn instead of
    // needing its own.
    clearPendingDenRespawn: () => { pendingDenRespawn.clear(); pendingNestTreeRespawn.clear(); },
    _test: { circularHourDistance, wolfShiftAtHour, cloudForestDaytime, distantFightScore },
  };
})();
