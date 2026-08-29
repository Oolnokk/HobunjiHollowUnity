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
    const floor = target.maxHealth * WILDLIFE_HP_FLOOR_FRACTION;
    const clamped = Math.max(0, Math.min(amount, target.health - floor));
    if (clamped > 0) deps.damageCreature(target, clamped, attacker.x, attacker.y, deps.HOSTILE_BITE_KNOCKBACK_PX_S, { tag: attacker.def?.attackTag || 'sharp' });
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
    // Scatter radius must clear the footprint's own half-diagonal (den.x/y
    // is the top-left tile, footprint is den.w x den.h) or a spawn angle
    // pointed at a corner lands the creature inside the den's solid rock
    // volume (see isAnimalDenCollisionTile) with every neighboring tile
    // blocked too — stuck on the footprint with nowhere to step.
    const footprintClearance = deps.TILE * Math.hypot((den.w || 1) * 0.5, (den.h || 1) * 0.5) + deps.TILE * 0.3;
    for (let i = 0; i < count; i++) {
      const angle = deps.rnd() * Math.PI * 2;
      const dist = footprintClearance + deps.rnd() * deps.TILE * 1.6;
      const x = homeX + Math.cos(angle) * dist, y = homeY + Math.sin(angle) * dist;
      const opts = { homeX, homeY, state: 'idle', denKey, genotype: denGenotype };
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
  const NEST_TREE_ZONE_ID = 'map_southern_cloud_forest';
  // The UPPER BOUND on how many nest trees a zone can ever have, not a
  // fraction of however many climbable branches happen to exist — a dense
  // shadewood forest can easily carry hundreds of registered branches (see
  // foliage-generator.js's climbBranchChance, rolled per shared tree shape,
  // so it's common for most trees in the zone to have one), and spawning a
  // full pack + Nestmother at every one of them independently blew up
  // hostileObjects into the hundreds the moment the zone loaded — the cause
  // of the severe slowdown entering this zone. eligibleNestBranches further
  // clamps this down to the zone's own actual den count so nests end up
  // about as common as gar-wolf dens, not just nominally capped at the
  // same number.
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
      // Nest trees should be about as common as gar-wolf dens in this same
      // zone — a flat NEST_TREE_MAX_PER_ZONE cap regardless of how many
      // dens the terrain generator actually managed to place (placeAnimalDens'
      // border/elevation constraints routinely place fewer than its own
      // nominal target) made nests noticeably outnumber dens in practice
      // even though both nominally capped at "5". Falls back to the flat
      // cap only if this zone somehow has no den data at all (e.g. an
      // authored fallback layout — see game.js's other _zoneLayouts.set
      // call site, which always sets dens: []).
      const denCount = deps.zoneLayouts.get(zoneId)?.dens?.length || 0;
      const maxNestTrees = Math.max(1, Math.min(NEST_TREE_MAX_PER_ZONE, denCount || NEST_TREE_MAX_PER_ZONE));
      const scored = branches.map(branch => {
        const rng = window.WildernessMapGenerator?.makeRng?.(`${zoneId}_nesttree_${branch.col}_${branch.row}`);
        return { branch, key: branchTileKey(branch), score: rng ? rng() : deps.rnd() };
      });
      scored.sort((a, b) => a.score - b.score);
      selected = scored.slice(0, maxNestTrees)
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
      // Same nestGenotype the Nestmother above got — guards should carry
      // her colors/patterns, not spawn plain (makeCreatureEntity only
      // recolors a creature when opts.genotype is present).
      const opts = { homeX: branch.baseX, homeY: branch.baseY, state: 'idle', nestTreeKey: key, genotype: nestGenotype };
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

  // Debug/verification readout for "nest trees should be about as common
  // as gar-wolf dens" (see eligibleNestBranches' den-count clamp above) —
  // surfaced in the 🧬 Wildlife dev tab (js/wildlife-debug-panel.js) so
  // that claim is checkable against a live zone/seed instead of taken on
  // faith. nestTreeCap is the already-den-clamped resolved count for this
  // zone this session (<= NEST_TREE_MAX_PER_ZONE), not the flat constant.
  function denNestCensus(zoneId) {
    const denCount = deps.zoneLayouts.get(zoneId)?.dens?.length || 0;
    const selectedNestBranches = eligibleNestBranches(zoneId);
    let nestTreesAlive = 0;
    for (const branch of selectedNestBranches) {
      if (isNestTreeAlive(nestTreeKeyFor(zoneId, branch))) nestTreesAlive++;
    }
    return { denCount, nestTreeCap: selectedNestBranches.length, nestTreesAlive };
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
    updateHostileSpawning,
    onZoneEntered,
    denNestCensus,
    // Also clears pendingNestTreeRespawn — a wiped nest tree waits for the
    // next day exactly like a wiped den (see ensureCurrentZoneNestTrees),
    // so it rides the same day-advance call sites as den respawn instead of
    // needing its own.
    clearPendingDenRespawn: () => { pendingDenRespawn.clear(); pendingNestTreeRespawn.clear(); },
  };
})();
