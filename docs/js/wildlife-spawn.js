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

  // CreatureGenetics loads before this module, but its species bootstrap used
  // to wait for DOMContentLoaded before wrapping WildlifeSpawn.init. game.js
  // can initialize WildlifeSpawn before that event, so a real Western Slope
  // session could keep the legacy Drenkirra/Uumkao'ii pools even though the
  // isolated regression (which fired DOMContentLoaded first) passed. Keep an
  // idempotent registration at the owning system's init boundary so runtime
  // correctness no longer depends on document-event ordering.
  function ensurePuktukRuntimeRegistration(injectedDeps) {
    const creatureDb = injectedDeps?.CREATURE_DB;
    const garWolf = creatureDb?.['gar-wolf'];
    const predatorBaseline = garWolf || creatureDb?.grehlr || creatureDb?.drenkirra || {};
    if (creatureDb) {
      const existing = creatureDb.puktuk || {};
      creatureDb.puktuk = {
        ...predatorBaseline,
        ...existing,
        label: 'Puktuk',
        hostile: false,
        defaultSizeClass: 'medium',
        modelWidth: 2.1,
        spriteAspect: 0.43636,
        lootPool: 'creature_puktuk',
        sprites: {
          idle: 'assets/creaturesprites/puktuk_idle.png',
          run: ['assets/creaturesprites/puktuk_run1.png', 'assets/creaturesprites/puktuk_run2.png'],
        },
      };
    }

    const westernZone = injectedDeps?.EXTERIOR_ZONES?.map_western_slope;
    const herbivores = westernZone?.herbivoreSpecies;
    let legacyDrenkirraRemoved = 0;
    if (Array.isArray(herbivores)) {
      for (let i = herbivores.length - 1; i >= 0; i--) {
        if (herbivores[i] !== 'drenkirra') continue;
        herbivores.splice(i, 1);
        legacyDrenkirraRemoved++;
      }
    }
    const packs = westernZone
      ? (Array.isArray(westernZone.packSpecies) ? westernZone.packSpecies : (westernZone.packSpecies = []))
      : null;
    if (Array.isArray(packs) && !packs.includes('puktuk')) packs.push('puktuk');
    const denSpecies = westernZone
      ? (Array.isArray(westernZone.denSpecies) ? westernZone.denSpecies : (westernZone.denSpecies = []))
      : null;
    if (Array.isArray(denSpecies) && !denSpecies.includes('puktuk')) denSpecies.push('puktuk');

    const denMotherDefs = injectedDeps?.DEN_MOTHER_DEFS;
    if (denMotherDefs) {
      const existingMother = denMotherDefs.puktuk || {};
      denMotherDefs.puktuk = {
        ...existingMother,
        creatureKey: existingMother.creatureKey || 'puktuk',
        nestItemKey: existingMother.nestItemKey ?? null,
      };
    }

    const ready = !!creatureDb?.puktuk
      && Array.isArray(denSpecies) && denSpecies.includes('puktuk')
      && Array.isArray(packs) && packs.includes('puktuk');
    window.__farmLog?.(`[puktuk] WildlifeSpawn.init fallback: ready=${ready ? 1 : 0} legacyDrenkirraRemoved=${legacyDrenkirraRemoved} dens=[${Array.isArray(denSpecies) ? denSpecies.join(',') : 'missing'}] packs=[${Array.isArray(packs) ? packs.join(',') : 'missing'}] herbivores=[${Array.isArray(herbivores) ? herbivores.join(',') : 'missing'}]`, ready ? 'wildlife' : 'warn');
    return ready;
  }

  // Same parser-time race as Puktuk above, but more severe for roaming herds:
  // makeCreatureEntity returns null for an unknown CREATURE_DB key, so the
  // authored herd slots can look configured while spawning zero animals.
  // Register the live creature defs + renderer/zone hooks synchronously at
  // WildlifeSpawn.init instead of relying on CreatureGenetics' later
  // DOMContentLoaded wrapper.
  function ensureVoorgAssRuntimeRegistration(injectedDeps) {
    // Creature defs, renderer species, and Northern Cliffs herd config are all
    // shared with creature-genetics.js / puktuk-den-nest-registration.js via
    // js/voorg-ass-registration.js; this call just closes the parser-time race.
    const registration = window.VoorgAssRegistration;
    if (!registration) {
      window.__farmLog?.('[voorg-ass] WildlifeSpawn.init fallback: VoorgAssRegistration missing (voorg-ass-registration.js not loaded)', 'warn');
      return false;
    }
    const creatureDb = injectedDeps?.CREATURE_DB;
    registration.ensureCreatureDefs(creatureDb);
    const rendererSpecies = window.CreatureGeneticsRender?.SPECIES;
    if (rendererSpecies && !rendererSpecies[registration.KIND]) registration.ensureRendererSpecies(rendererSpecies);
    const herds = registration.ensureNorthernCliffsHerds(injectedDeps);
    const ready = !!creatureDb?.[registration.KIND] && !!creatureDb?.[registration.HERD_MOTHER_KIND] && herds.ready;
    window.__farmLog?.(`[voorg-ass] WildlifeSpawn.init fallback: ready=${ready ? 1 : 0} creature=${creatureDb?.[registration.KIND] ? 1 : 0} mother=${creatureDb?.[registration.HERD_MOTHER_KIND] ? 1 : 0} renderer=${rendererSpecies?.[registration.KIND] ? 1 : 0} roaming=[${herds.zone ? herds.roaming.join(',') : 'missing'}] herdCount=${herds.zone?.roamingHerdCount || 0}`, ready ? 'wildlife' : 'warn');
    return ready;
  }

  function init(injectedDeps) {
    ensurePuktukRuntimeRegistration(injectedDeps);
    ensureVoorgAssRuntimeRegistration(injectedDeps);
    deps = injectedDeps;
    installDenTurnoverDeathHook();
  }

  // Once a den's whole pack/herd is wiped, it stays empty — no ambient
  // scatter-spawning — until the next in-game day, when a fresh pack
  // (species re-rolled from the zone's packSpecies pool, not necessarily
  // the one that died) moves in. See game.js's advanceDay().
  const DEN_PACK_SIZE_MIN = 2;
  const DEN_PACK_SIZE_MAX = 4;
  // Grehlr stay in much smaller groups than every other pack species, and
  // (see GREHLR_DAY_SPREAD_TILES_MIN/MAX below) scatter apart from each
  // other by day rather than roaming the den together — see spawnPackAtDen.
  const GREHLR_SPECIES = 'grehlr';
  const GREHLR_PACK_SIZE_MIN = 1;
  const GREHLR_PACK_SIZE_MAX = 2;
  // Each grehlr's own day "home" point (its idle-wander/patrol anchor —
  // DEN_PACK_WANDER_RADIUS_PX in game.js's updateHostiles) is rolled
  // independently in a random direction this far from the den, instead of
  // every pack member sharing the den's own footprint center like every
  // other species — spreads littermates across genuinely separate ground
  // during the day. denEntranceX/Y (the shared doorway, unaffected by this)
  // still brings them back together at night.
  const GREHLR_DAY_SPREAD_TILES_MIN = 5;
  const GREHLR_DAY_SPREAD_TILES_MAX = 12;
  const VOORG_ASS_SPECIES = 'voorg-ass'; // Exterior-only herd species; deliberately excluded from cavern den population selection.
  const VOORG_ASS_HERD_MOTHER_SPECIES = 'voorg-ass-herd-mother'; // Uses Voorg-Ass art/genetics but carries the herd's recoverable babies.
  const VOORG_ASS_BABY_ITEM_KEY = 'voorgAssBaby'; // Added to the Herd-Mother corpse only after she has been killed.
  const ROAMING_HERD_SIZE_MIN = 8;
  const ROAMING_HERD_SIZE_MAX = 12;
  const ROAMING_HERD_WANDER_TILES = 7; // Passed onto each member so game.js's ordinary wanderTick keeps the herd mobile over a broad cliff territory.
  const ROAMING_HERD_SLEEP_RADIUS_TILES = 1.35; // Night positions form one visible bedded-down group instead of disappearing into a cave.
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
    const factionTarget = target?.isBandit === true || target?.isPorakanekiHunter === true || target?.banditCompanion === true;
    if (factionTarget) {
      // Predator-vs-humanoid encounters are real observed combat, not the
      // abstract non-lethal wildlife sparring model. They can kill either
      // faction, but remain tagged actor-vs-actor so Porakaneki reputation
      // never mistakes a predator hit for player aggression.
      deps.damageCreature(target, Math.max(0, amount), attacker.x, attacker.y, deps.HOSTILE_BITE_KNOCKBACK_PX_S, {
        tag: attacker.def?.attackTag || 'sharp',
        friendlyFire: true,
        factionCombat: true,
        attacker,
      });
      return;
    }
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
  const DEN_RELOCATION_DELAY_DAYS = 2; // Used by the Den-Mother turnover lifecycle before a cleared den may reappear at a new site.
  const DEN_RELOCATION_MIN_DISTANCE_TILES = 12; // Used by relocation candidate filtering so a replacement den visibly moves instead of shifting a few tiles.
  const DEN_RELOCATION_PLAYER_CLEARANCE_TILES = 18; // Used while the player is in the same zone so a replacement cave never pops into view nearby.
  const denTurnoverByKey = new Map(); // denKey -> persistent Den-Mother clear/collapse/relocation state.
  const processedDenMotherDeaths = new WeakSet(); // Used by the CreatureDeath wrapper to make begin/recover handoffs idempotent.
  let denTurnoverIdentity = null; // Used to detect world/year changes before reading or writing persisted den turnover state.
  let creatureDeathHookInstalled = false; // Used to avoid stacking CreatureDeath wrappers if WildlifeSpawn.init runs more than once.
  const roamingHerdEverSpawned = new Set(); // Used to avoid refilling a partially/wiped herd immediately during the same day.
  const roamingHerdLastKnownAlive = new Map(); // Herd-key -> prior alive state, mirroring denLastKnownAlive.
  const pendingRoamingHerdRespawn = new Set(); // Cleared with the other wildlife respawn gates when a new day begins.

  function denKeyFor(zoneId, den) { return `${zoneId}:${den.id}`; }

  function currentDenTurnoverIdentity() {
    const worldId = String(window.__hobunjiPlayerProfile?.worldId || window.__hobunjiPlayerProfile?.playerId || 'session'); // Used to isolate den ecology state between worlds/preview sessions.
    const year = Number(window.CalendarSystem?.yearNumber?.() || 1); // Used so a new Tothal generation naturally discards last year's relocated den coordinates.
    return { worldId, year, key: `${worldId}|${year}` };
  }

  function ensureDenTurnoverLoaded() {
    const identity = currentDenTurnoverIdentity();
    if (denTurnoverIdentity === identity.key) return;
    denTurnoverIdentity = identity.key;
    denTurnoverByKey.clear();
    if (identity.worldId === 'session') return;
    try {
      const meta = JSON.parse(localStorage.getItem('hobunjiSaveMeta') || 'null');
      const world = (meta?.worlds || []).find(entry => entry.id === identity.worldId);
      const saved = world?.denTurnover;
      if (!saved || Number(saved.year) !== identity.year || !Array.isArray(saved.records)) {
        if (world?.denTurnover) {
          delete world.denTurnover;
          localStorage.setItem('hobunjiSaveMeta', JSON.stringify(meta));
        }
        return;
      }
      for (const record of saved.records) {
        if (!record?.denKey || !record?.zoneId || record.denId == null) continue;
        denTurnoverByKey.set(String(record.denKey), record);
      }
    } catch (error) {
      window.__farmLog?.(`[den-turnover] failed to load world save state: ${error.message}`, 'warn');
    }
  }

  function persistDenTurnover() {
    ensureDenTurnoverLoaded();
    const identity = currentDenTurnoverIdentity();
    if (identity.worldId === 'session') return;
    try {
      const meta = JSON.parse(localStorage.getItem('hobunjiSaveMeta') || 'null');
      const world = (meta?.worlds || []).find(entry => entry.id === identity.worldId);
      if (!world) return;
      world.denTurnover = {
        version: 1,
        year: identity.year,
        records: [...denTurnoverByKey.values()],
      }; // Stored inside the portable world metadata captured by local-folder/cloud save snapshots.
      localStorage.setItem('hobunjiSaveMeta', JSON.stringify(meta));
    } catch (error) {
      window.__farmLog?.(`[den-turnover] failed to persist world save state: ${error.message}`, 'warn');
    }
  }

  function turnoverRecordForCavern(cavernMapId) {
    ensureDenTurnoverLoaded();
    const direct = [...denTurnoverByKey.values()].find(record => String(record?.cavernMapId || '') === String(cavernMapId || '')); // Survives cold-load ordering before denCavernMapId has repopulated its side tables.
    if (direct) return direct;
    const denKey = denKeyForCavern(cavernMapId);
    return denKey ? (denTurnoverByKey.get(denKey) || null) : null;
  }

  function denTurnoverStateForCavern(cavernMapId) {
    const record = turnoverRecordForCavern(cavernMapId);
    return record ? { stage:record.stage, daysRemaining:record.daysRemaining, generation:Number(record.generation)||0 } : null;
  }

  function ensureActiveDenTurnoverRecord(cavernMapId) {
    const existing = turnoverRecordForCavern(cavernMapId);
    if (existing) return existing;
    const zoneId = _denCavernZoneOf.get(cavernMapId);
    const denId = _denCavernDenIdOf.get(cavernMapId);
    const den = zoneId != null && denId != null
      ? deps.zoneLayouts.get(zoneId)?.dens?.find(candidate => String(candidate.id) === String(denId))
      : null; // Generation-zero persistence needs the live den identity/site; ordinary cavern setup populates both side tables before genotype resolution.
    if (!den) return null;
    const key = denKeyFor(zoneId, den);
    const record = {
      denKey:key, zoneId, denId:String(den.id), cavernMapId,
      stage:'active', daysRemaining:null, generation:0, genotypes:{},
      x:Number(den.x), y:Number(den.y),
      w:Math.max(1, Number(den.w)||1), h:Math.max(1, Number(den.h)||1),
      mouthAnchor:den.mouthAnchor ? { ...den.mouthAnchor } : null,
    }; // Stored immediately so an untouched den cannot silently change bloodline on a page reload.
    denTurnoverByKey.set(key, record);
    persistDenTurnover();
    return record;
  }

  function layoutTileMap(layout) {
    const byKey = new Map(); // Used by collapse/relocation terrain edits without rebuilding a 2D grid for every tile lookup.
    for (const tile of (layout?.tiles || [])) byKey.set(`${tile.c},${tile.r}`, tile);
    return byKey;
  }

  function layoutGrid(layout) {
    const rows = Math.max(0, Number(layout?.rows) || 0); // Used by the den visual synchronizer to resample elevation at a relocated site.
    const cols = Math.max(0, Number(layout?.cols) || 0); // Used with rows to preserve ZoneDenTotemFeatures' ordinary zGrid contract.
    const grid = Array.from({ length: rows }, () => Array(cols));
    for (const tile of (layout?.tiles || [])) if (grid[tile.r]) grid[tile.r][tile.c] = tile;
    return grid;
  }

  function denTransitionId(denId) { return `den_${denId}_enter`; }

  function takeDenTransition(layout, cavernMapId, denId) {
    if (!Array.isArray(layout?.transitions)) return null;
    const index = layout.transitions.findIndex(t => t?.targetMapId === cavernMapId || t?.id === denTransitionId(denId));
    if (index < 0) return null;
    return layout.transitions.splice(index, 1)[0] || null;
  }

  function ensureDenTransition(layout, den, cavernMapId, saved = null) {
    if (!layout || !den?.mouthAnchor) return null;
    if (!Array.isArray(layout.transitions)) layout.transitions = [];
    let transition = layout.transitions.find(t => t?.targetMapId === cavernMapId || t?.id === denTransitionId(den.id));
    if (!transition) {
      transition = {
        ...(saved || {}),
        id: denTransitionId(den.id),
        label: saved?.label || 'A dark burrow',
        target: 'building',
        targetMapId: cavernMapId,
      };
      layout.transitions.push(transition);
    }
    transition.col = den.mouthAnchor.x;
    transition.row = den.mouthAnchor.y;
    return transition;
  }

  function setDenFootprintOverlay(layout, den, present) {
    if (!layout || !den) return;
    const tiles = layoutTileMap(layout); // Used to restore the old generated rock overlay or stamp it at the relocated site.
    const w = Math.max(1, Number(den.w) || 1);
    const h = Math.max(1, Number(den.h) || 1);
    for (let row = Number(den.y); row < Number(den.y) + h; row++) {
      for (let col = Number(den.x); col < Number(den.x) + w; col++) {
        const tile = tiles.get(`${col},${row}`);
        if (!tile) continue;
        if (present) {
          tile.type = 'rock';
          tile.generatedObjectId = den.id;
          tile.generatedObjectType = 'animalDen';
        } else if (tile.generatedObjectType === 'animalDen' && (!tile.generatedObjectId || String(tile.generatedObjectId) === String(den.id))) {
          tile.type = 'grass';
          delete tile.generatedObjectId;
          delete tile.generatedObjectType;
        }
      }
    }
  }

  function rectsOverlap(a, b, margin = 0) {
    return a.x - margin < b.x + b.w && a.x + a.w + margin > b.x
      && a.y - margin < b.y + b.h && a.y + a.h + margin > b.y;
  }

  function largestWalkableDenComponent(layout, tileMap) {
    const walkable = new Set(); // Runtime movement-equivalent terrain used to reject isolated relocation pockets without rebuilding generator navigation.
    for (const [key, tile] of tileMap) {
      const type = String(tile?.type || '').toLowerCase();
      if (type === 'rock' || type === 'shrub' || tile?.incline || tile?._banditTentCollisionId) continue;
      walkable.add(key);
    }
    let largest = new Set();
    const unvisited = new Set(walkable);
    while (unvisited.size) {
      const first = unvisited.values().next().value;
      const component = new Set([first]);
      const queue = [first];
      unvisited.delete(first);
      for (let index = 0; index < queue.length; index++) {
        const [col, row] = queue[index].split(',').map(Number);
        for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const next = `${col + dc},${row + dr}`;
          if (!unvisited.has(next)) continue;
          unvisited.delete(next);
          component.add(next);
          queue.push(next);
        }
      }
      if (component.size > largest.size) largest = component;
    }
    return largest;
  }

  function runtimeDenRelocationBlockers(zoneId) {
    const blockers = []; // Runtime-only footprints are absent from the generator-owned layout arrays used by ordinary relocation validation.
    const add = (site, margin = 3) => {
      if (!site) return;
      const x = Number(site.x), y = Number(site.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      blockers.push({ x, y, w:Math.max(1, Number(site.w)||1), h:Math.max(1, Number(site.h)||1), margin });
    };
    for (const rec of (window.BanditCamps?.campInstances?.get?.(zoneId) || [])) add(rec?.instance?.site, 3);
    for (const site of (window.PorakanekiCamps?.occupiedSites?.(zoneId) || [])) add(site, 3);
    const campfire = window.WildernessCampfire?.serialize?.();
    if (campfire?.mapId === zoneId) add({ x:Math.floor(Number(campfire.x)), y:Math.floor(Number(campfire.z)), w:1, h:1 }, 4);
    return blockers;
  }

  function denCandidateIsSafe(zoneId, layout, tileMap, reachableTiles, runtimeBlockers, den, x, y, oldDen, activeZone) {
    const w = Math.max(1, Number(den.w) || 1);
    const h = Math.max(1, Number(den.h) || 1);
    const cols = Math.max(1, Number(layout?.cols) || 1);
    const rows = Math.max(1, Number(layout?.rows) || 1);
    const mouth = { x: x + Math.floor(w / 2), y: y + h };
    if (x < 2 || y < 2 || x + w >= cols - 2 || mouth.y >= rows - 2) return false;
    if (reachableTiles?.size && !reachableTiles.has(`${mouth.x},${mouth.y}`)) return false; // Replacement mouths must stay on the zone's main traversable terrain network.
    if (Math.hypot(x - Number(oldDen.x), y - Number(oldDen.y)) < DEN_RELOCATION_MIN_DISTANCE_TILES) return false;
    if (activeZone && deps.player && Math.hypot((x + w * .5) - deps.player.x / deps.TILE, (y + h * .5) - deps.player.y / deps.TILE) < DEN_RELOCATION_PLAYER_CLEARANCE_TILES) return false;

    const tiles = tileMap; // Reused for every candidate in one relocation search; rebuilding the full-zone lookup hundreds of times caused avoidable hitches.
    let minElev = Infinity, maxElev = -Infinity;
    const cells = [];
    for (let row = y; row < y + h; row++) for (let col = x; col < x + w; col++) cells.push({ col, row });
    cells.push({ col: mouth.x, row: mouth.y });
    for (const cell of cells) {
      const tile = tiles.get(`${cell.col},${cell.row}`);
      if (!tile || String(tile.type || '').toLowerCase() !== 'grass') return false;
      if (tile.generatedObjectId || tile.generatedObjectType || tile.water || tile.waterfall || tile.incline || tile.ramp || tile.path || tile.invisiblePath || tile.bridge || tile.navBridge) return false;
      const elev = Number(tile.elevTier ?? tile.elevation ?? tile.height ?? 0);
      minElev = Math.min(minElev, elev);
      maxElev = Math.max(maxElev, elev);
    }
    if (maxElev - minElev > 1) return false;

    const candidate = { x, y, w, h: h + 1 };
    for (const other of (layout.dens || [])) {
      if (!other || String(other.id) === String(den.id)) continue;
      if (rectsOverlap(candidate, { x:Number(other.x), y:Number(other.y), w:Math.max(1,Number(other.w)||1), h:Math.max(1,Number(other.h)||1)+1 }, 4)) return false;
    }
    for (const totem of (layout.rootTotems || [])) {
      if (Math.hypot((x + w * .5) - Number(totem.x), (y + h * .5) - Number(totem.y)) < 12) return false;
    }
    for (const locale of (layout.localeInstances || [])) {
      if (rectsOverlap(candidate, { x:Number(locale.x)||0, y:Number(locale.y)||0, w:Math.max(1,Number(locale.w)||1), h:Math.max(1,Number(locale.h)||1) }, 3)) return false;
    }
    for (const building of (layout.buildings || [])) {
      const bx = Number(building.gridX ?? building.col ?? building.x);
      const by = Number(building.gridZ ?? building.row ?? building.y);
      if (!Number.isFinite(bx) || !Number.isFinite(by)) continue;
      if (rectsOverlap(candidate, { x:bx, y:by, w:Math.max(1,Number(building.footprintW ?? building.w)||1), h:Math.max(1,Number(building.footprintD ?? building.h)||1) }, 3)) return false;
    }
    for (const transition of (layout.transitions || [])) {
      if (transition?.targetMapId === denCavernMapId(zoneId, den.id)) continue;
      const tx = Number(transition?.col), ty = Number(transition?.row);
      if (Number.isFinite(tx) && Number.isFinite(ty) && tx >= x - 2 && tx <= x + w + 2 && ty >= y - 2 && ty <= mouth.y + 2) return false;
    }
    for (const blocker of (runtimeBlockers || [])) {
      if (rectsOverlap(candidate, blocker, Math.max(0, Number(blocker.margin)||0))) return false;
    }
    return true;
  }

  function findDenRelocationSite(zoneId, den, oldDen) {
    const layout = deps.zoneLayouts.get(zoneId);
    if (!layout) return null;
    const w = Math.max(1, Number(den.w) || 1);
    const h = Math.max(1, Number(den.h) || 1);
    const maxX = Math.max(2, Number(layout.cols) - w - 3);
    const maxY = Math.max(2, Number(layout.rows) - h - 4);
    const activeZone = deps.getCurrentArea() === zoneId ? zoneId : null;
    const tileMap = layoutTileMap(layout); // Shared by random sampling and fallback scanning for this single relocation attempt.
    const reachableTiles = largestWalkableDenComponent(layout, tileMap); // Computed once; prevents a locally-flat but cliff-isolated grass pocket from becoming a new den site.
    const runtimeBlockers = runtimeDenRelocationBlockers(zoneId); // Snapshots active camps/campfire once so candidate tests stay cheap and internally consistent.
    for (let attempt = 0; attempt < 700; attempt++) {
      const x = 2 + Math.floor(deps.rnd() * Math.max(1, maxX - 1));
      const y = 2 + Math.floor(deps.rnd() * Math.max(1, maxY - 1));
      if (denCandidateIsSafe(zoneId, layout, tileMap, reachableTiles, runtimeBlockers, den, x, y, oldDen, activeZone)) return { x, y, mouthAnchor:{ x:x + Math.floor(w / 2), y:y + h } };
    }
    const start = Math.floor(deps.rnd() * Math.max(1, (maxX - 1) * (maxY - 1))); // Used to vary the deterministic fallback scan instead of always biasing the northwest.
    const width = Math.max(1, maxX - 1);
    const total = width * Math.max(1, maxY - 1);
    for (let offset = 0; offset < total; offset++) {
      const linear = (start + offset) % total;
      const x = 2 + (linear % width);
      const y = 2 + Math.floor(linear / width);
      if (denCandidateIsSafe(zoneId, layout, tileMap, reachableTiles, runtimeBlockers, den, x, y, oldDen, activeZone)) return { x, y, mouthAnchor:{ x:x + Math.floor(w / 2), y:y + h } };
    }
    return null;
  }

  function syncDenVisual(zoneId, den) {
    const scene = deps.zoneScenes?.get(zoneId)?.scene;
    const layout = deps.zoneLayouts.get(zoneId);
    if (!scene || !layout) return false;
    return !!window.ZoneDenTotemFeatures?.syncAnimalDenVisual?.(scene, layoutGrid(layout), den, zoneId);
  }

  function rebuildDenTerrainChunks(zoneId, oldDen, den) {
    const rebuild = window.WildernessChunks?.rebuildZone;
    if (typeof rebuild !== 'function') return;
    if (oldDen) rebuild(zoneId, Number(oldDen.x) + (Number(oldDen.w)||1) * .5, Number(oldDen.y) + (Number(oldDen.h)||1) * .5);
    if (den) rebuild(zoneId, Number(den.x) + (Number(den.w)||1) * .5, Number(den.y) + (Number(den.h)||1) * .5);
  }

  function resetDenPopulationCaches(zoneId, denId, cavernMapId) {
    const key = denKeyFor(zoneId, { id: denId });
    denEverSpawned.delete(key);
    pendingDenRespawn.delete(key);
    denLastKnownAlive.delete(key);
    for (const genotypeKey of [..._denGenotypes.keys()]) if (genotypeKey.startsWith(cavernMapId + '|')) _denGenotypes.delete(genotypeKey);
    deps.denNests.delete(cavernMapId);
    deps.buildingScenes.delete(cavernMapId);
  }

  function collapseClearedDen(record) {
    const layout = deps.zoneLayouts.get(record.zoneId);
    const den = layout?.dens?.find(candidate => String(candidate.id) === String(record.denId));
    if (!layout || !den || record.stage !== 'cleared') return false;
    den.collapsed = true;
    den.turnoverStage = 'collapsed';
    const cavernMapId = denCavernMapId(record.zoneId, den.id);
    record.transition = takeDenTransition(layout, cavernMapId, den.id) || record.transition || null;
    record.stage = 'collapsed';
    record.daysRemaining = DEN_RELOCATION_DELAY_DAYS;
    record.x = Number(den.x); record.y = Number(den.y);
    record.w = Math.max(1, Number(den.w)||1); record.h = Math.max(1, Number(den.h)||1);
    record.mouthAnchor = den.mouthAnchor ? { ...den.mouthAnchor } : null;
    window.BanditCamps?.forgetDenPerception?.(record.denKey); // Removes a companion-discovered map marker/waypoint at the abandoned physical entrance.
    resetDenPopulationCaches(record.zoneId, den.id, cavernMapId);
    syncDenVisual(record.zoneId, den);
    persistDenTurnover();
    window.__farmLog?.(`[den-turnover] collapsed ${record.denKey} at (${den.x},${den.y}); relocation in ${record.daysRemaining} day(s).`, 'wildlife');
    return true;
  }

  function relocateDenRecord(record) {
    if (!record || record.stage !== 'ready') return false;
    const layout = deps.zoneLayouts.get(record.zoneId);
    const den = layout?.dens?.find(candidate => String(candidate.id) === String(record.denId));
    if (!layout || !den) return false;
    const oldDen = {
      id:den.id, x:Number(den.x), y:Number(den.y),
      w:Math.max(1,Number(den.w)||1), h:Math.max(1,Number(den.h)||1),
      mouthAnchor: den.mouthAnchor ? { ...den.mouthAnchor } : null,
    }; // Used to restore the old rock overlay and selectively rebuild the old streamed terrain chunk.
    const site = findDenRelocationSite(record.zoneId, den, oldDen);
    if (!site) {
      window.__farmLog?.(`[den-turnover] no safe relocation site found for ${record.denKey}; will retry when ecology ticks again.`, 'warn');
      return false;
    }
    setDenFootprintOverlay(layout, oldDen, false);
    den.x = site.x; den.y = site.y; den.mouthAnchor = site.mouthAnchor;
    den.collapsed = false; den.turnoverStage = 'active';
    setDenFootprintOverlay(layout, den, true);
    const cavernMapId = denCavernMapId(record.zoneId, den.id);
    ensureDenTransition(layout, den, cavernMapId, record.transition);
    resetDenPopulationCaches(record.zoneId, den.id, cavernMapId);
    record.stage = 'active';
    record.daysRemaining = null;
    record.generation = Math.max(0, Number(record.generation)||0) + 1;
    record.genotypes = {};
    record.x = Number(den.x); record.y = Number(den.y);
    record.mouthAnchor = { ...den.mouthAnchor };
    syncDenVisual(record.zoneId, den);
    rebuildDenTerrainChunks(record.zoneId, oldDen, den);
    persistDenTurnover();
    window.__farmLog?.(`[den-turnover] relocated ${record.denKey} generation=${record.generation} from (${oldDen.x},${oldDen.y}) to (${den.x},${den.y}).`, 'wildlife');
    return true;
  }

  function advanceDenTurnoverDay() {
    ensureDenTurnoverLoaded();
    let changed = false;
    for (const record of denTurnoverByKey.values()) {
      if (record.stage !== 'collapsed') continue;
      record.daysRemaining = Math.max(0, Number(record.daysRemaining) - 1);
      if (record.daysRemaining <= 0) record.stage = 'ready';
      changed = true;
    }
    if (changed) persistDenTurnover();
    const active = deps.getCurrentArea();
    for (const record of denTurnoverByKey.values()) {
      if (record.stage !== 'ready' || record.zoneId === active) continue;
      relocateDenRecord(record); // Inactive zones can safely move immediately on the day tick because nothing there is visible to the player.
    }
  }

  function processDenTurnoverForZone(zoneId) {
    ensureDenTurnoverLoaded();
    for (const record of denTurnoverByKey.values()) {
      if (record.zoneId !== zoneId) continue;
      if (record.stage === 'cleared') collapseClearedDen(record);
      else if (record.stage === 'ready') relocateDenRecord(record);
    }
  }

  function reapplyPersistedDenTurnover(zoneId) {
    ensureDenTurnoverLoaded();
    const layout = deps.zoneLayouts.get(zoneId);
    if (!layout?.dens?.length) return;
    for (const record of denTurnoverByKey.values()) {
      if (record.zoneId !== zoneId) continue;
      const den = layout.dens.find(candidate => String(candidate.id) === String(record.denId));
      if (!den) continue;
      const generatedDen = { id:den.id, x:Number(den.x), y:Number(den.y), w:Math.max(1,Number(den.w)||1), h:Math.max(1,Number(den.h)||1), mouthAnchor:den.mouthAnchor ? {...den.mouthAnchor}:null }; // Used to remove the same-year generator's original den overlay before restoring saved relocation coordinates.
      if (Number.isFinite(Number(record.x)) && Number.isFinite(Number(record.y)) && (Number(record.x) !== generatedDen.x || Number(record.y) !== generatedDen.y)) {
        setDenFootprintOverlay(layout, generatedDen, false);
        den.x = Number(record.x); den.y = Number(record.y);
        den.mouthAnchor = record.mouthAnchor ? { ...record.mouthAnchor } : { x:den.x + Math.floor((Number(den.w)||1)/2), y:den.y + (Number(den.h)||1) };
        setDenFootprintOverlay(layout, den, true);
      }
      const cavernMapId = denCavernMapId(zoneId, den.id);
      const collapsed = record.stage === 'collapsed' || record.stage === 'ready';
      den.collapsed = collapsed;
      den.turnoverStage = record.stage;
      if (collapsed) record.transition = takeDenTransition(layout, cavernMapId, den.id) || record.transition || null;
      else ensureDenTransition(layout, den, cavernMapId, record.transition);
    }
  }

  function markDenSurvivorsAsPrey(cavernMapId, denKey, mother) {
    let changed = 0;
    for (const survivor of deps.hostileObjects) {
      if (!survivor || survivor === mother || survivor.health <= 0 || survivor.isDenMother) continue;
      if (survivor.areaId !== cavernMapId && survivor.denKey !== denKey) continue;
      survivor.denKey = null;
      survivor.wildlifeRole = 'prey';
      survivor.denDisplacedPrey = true;
      survivor.def = { ...survivor.def, hostile:false, diet:'herbivore' };
      survivor.state = 'fleeing-low-health';
      survivor.targetCreature = null;
      survivor.targetPlayer = null;
      survivor._fleeCooldownUntil = Infinity;
      changed++;
    }
    return changed;
  }

  function onDenMotherDeath(mother) {
    if (!mother?.isDenMother || processedDenMotherDeaths.has(mother)) return false;
    const cavernMapId = String(mother.areaId || '');
    const zoneId = _denCavernZoneOf.get(cavernMapId);
    const denId = _denCavernDenIdOf.get(cavernMapId);
    if (!zoneId || denId == null) return false; // Nestmothers/story-cave bosses are not ordinary relocatable dens.
    processedDenMotherDeaths.add(mother);
    ensureDenTurnoverLoaded();
    const key = denKeyFor(zoneId, { id: denId });
    const existing = denTurnoverByKey.get(key);
    const nestRemaining = Math.max(0, Number(deps.denNests.get(cavernMapId)?.remaining) || 0);
    const displaced = markDenSurvivorsAsPrey(cavernMapId, key, mother);
    const record = {
      ...(existing || {}),
      denKey:key, zoneId, denId:String(denId), cavernMapId,
      stage:'cleared',
      daysRemaining:DEN_RELOCATION_DELAY_DAYS,
      generation:Math.max(0, Number(existing?.generation)||0),
      genotypes: existing?.genotypes || {},
      clearedDay:Number(deps.calendar?.day) || 0,
    }; // Stored before the player exits so a reload cannot forget that this Den-Mother was killed.
    denTurnoverByKey.set(key, record);
    denCheckTimer = 0; // Used so the very first exterior frame after leaving processes the pending collapse instead of leaving a brief re-entry window.
    persistDenTurnover();
    if (nestRemaining > 0) deps.showToast('The Den-Mother is dead. Collect the eggs or babies before you leave — the burrow will collapse.', true);
    else deps.showToast('The Den-Mother is dead. The burrow will collapse after you leave.', true);
    window.__farmLog?.(`[den-turnover] cleared ${key}; clutchRemaining=${nestRemaining} displacedSurvivors=${displaced}. Collapse waits until the player leaves.`, 'wildlife');
    return true;
  }

  function installDenTurnoverDeathHook() {
    if (creatureDeathHookInstalled || !window.CreatureDeath?.begin) return;
    creatureDeathHookInstalled = true;
    const originalBegin = window.CreatureDeath.begin.bind(window.CreatureDeath); // Used so ordinary corpse/death handling remains authoritative before turnover side effects run.
    window.CreatureDeath.begin = function denTurnoverDeathBegin(creature, ...args) {
      const result = originalBegin(creature, ...args);
      if (creature?.isDenMother) onDenMotherDeath(creature);
      return result;
    };
    if (typeof window.CreatureDeath.recover === 'function') {
      const originalRecover = window.CreatureDeath.recover.bind(window.CreatureDeath); // Used to catch direct death recovery paths without double-processing normal begin calls.
      window.CreatureDeath.recover = function denTurnoverDeathRecover(creature, ...args) {
        const result = originalRecover(creature, ...args);
        if (creature?.isDenMother) onDenMotherDeath(creature);
        return result;
      };
    }
  }

  function denTurnoverDebug(zoneId = null) {
    ensureDenTurnoverLoaded();
    return [...denTurnoverByKey.values()]
      .filter(record => !zoneId || record.zoneId === zoneId)
      .map(record => ({
        denKey:record.denKey, zoneId:record.zoneId, denId:record.denId,
        stage:record.stage, daysRemaining:record.daysRemaining,
        generation:Number(record.generation)||0, x:record.x, y:record.y,
        clutchLostOnExit: record.stage === 'cleared' ? Math.max(0, Number(deps.denNests.get(record.cavernMapId)?.remaining)||0) : 0,
      }));
  }
  function roamingHerdKeyFor(zoneId, index) { return `${zoneId}:roaming-herd:${index}`; } // Stable per-zone slot, independent of cave/den ids.
  // cavernMapId -> the zone it belongs to — zoneId/denId can't be
  // reliably parsed back out of "map_i_den_<zoneId>_<denId>" (both
  // halves can themselves contain underscores), so this side table is
  // populated wherever a cavern id is minted (denCavernMapId) instead.
  // Used by game.js's teleportToRandomDen to work from inside a den too.
  const _denCavernZoneOf = new Map();
  // Sibling to _denCavernZoneOf, same reasoning — recovers the other half
  // (denId) a cavernMapId's own string can't be reliably split back into,
  // needed by denKeyForCavern to reconstruct the exact denKeyFor(zoneId, den)
  // key the exterior pack (spawnPackAtDen/isDenPackAlive) is tracked under.
  const _denCavernDenIdOf = new Map();
  // Same id shape game.js's performTothalShift's denTransitions and
  // synthesizeCavernMapData both already use for the den's cavern —
  // reused as the shared lookup key so a den's exterior pack, its
  // Den-Mother, and its nest rewards all resolve the same genotype
  // without needing to parse zoneId/denId back out of the mapId string.
  function denCavernMapId(zoneId, denId) {
    const id = `map_i_den_${zoneId}_${denId}`;
    _denCavernZoneOf.set(id, zoneId);
    _denCavernDenIdOf.set(id, denId);
    return id;
  }
  // The exterior-pack denKey (denKeyFor's zoneId:denId shape) a den's
  // cavern mapId belongs to — lets game.js's interior creatureSpawns check
  // isDenPackAlive for the SAME den its exterior pack is tracked under,
  // without either side needing to know the other's id shape. Null until
  // this den's cavernMapId has actually been minted at least once (see
  // denCavernMapId's callers — game.js's denTransitions setup runs for
  // every den in a zone as soon as that zone builds, well before a player
  // could ever reach this den's interior).
  function denKeyForCavern(cavernMapId) {
    const zoneId = _denCavernZoneOf.get(cavernMapId);
    const denId = _denCavernDenIdOf.get(cavernMapId);
    return (zoneId != null && denId != null) ? denKeyFor(zoneId, { id: denId }) : null;
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
  window.HobunjiCacheAudit?.register('WildlifeSpawn.denGenotypes', () => _denGenotypes.size);
  function getOrMakeDenGenotype(cavernMapId, family) {
    const key = `${cavernMapId}|${family}`;
    if (!_denGenotypes.has(key)) {
      const turnover = turnoverRecordForCavern(cavernMapId) || ensureActiveDenTurnoverRecord(cavernMapId); // Generation zero and every relocated generation persist the same way across reloads.
      const persisted = turnover?.genotypes?.[family] || null;
      const genotype = persisted ? JSON.parse(JSON.stringify(persisted)) : window.CreatureGenetics.makeDefaultGenotype(family);
      _denGenotypes.set(key, genotype);
      if (turnover && !persisted) {
        turnover.genotypes = turnover.genotypes || {};
        turnover.genotypes[family] = JSON.parse(JSON.stringify(genotype));
        persistDenTurnover();
      }
      window.__farmLog?.(`[genotype] ${persisted ? 'restored' : 'rolled new'} ${family} family genotype for den ${cavernMapId} (cache size now ${_denGenotypes.size})`, 'wildlife');
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
    const herdPrefix = `${zoneId}:roaming-herd:`; // Terrain regeneration also invalidates the open-air herd anchors derived from this zone's foliage layout.
    for (const key of roamingHerdEverSpawned) if (key.startsWith(herdPrefix)) roamingHerdEverSpawned.delete(key);
    for (const key of pendingRoamingHerdRespawn) if (key.startsWith(herdPrefix)) pendingRoamingHerdRespawn.delete(key);
    for (const key of [...roamingHerdLastKnownAlive.keys()]) if (key.startsWith(herdPrefix)) roamingHerdLastKnownAlive.delete(key);
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
    reapplyPersistedDenTurnover(zoneId);
  }

  function isDenPackAlive(denKey) {
    for (const c of deps.hostileObjects) if (c.denKey === denKey && c.health > 0) return true;
    return false;
  }


  function isRoamingHerdAlive(herdKey) {
    for (const c of deps.hostileObjects) if (c.herdKey === herdKey && c.health > 0) return true;
    return false;
  }

  function roamingHerdAnchor(zoneId, herdIndex, herdCount) {
    const zoneData = deps.zoneLayouts.get(zoneId); // Generated foliage patches give the herd a naturally walkable/grazable outdoor anchor.
    const patches = (zoneData?.foliagePatches || []).filter(patch => Array.isArray(patch?.tiles) && patch.tiles.length);
    if (patches.length) {
      const slot = Math.min(patches.length - 1, Math.floor(((herdIndex + 0.5) / Math.max(1, herdCount)) * patches.length));
      const patch = patches[slot];
      const centroid = patch.centroid || patch.tiles[Math.floor(patch.tiles.length / 2)] || { x: 0, y: 0 };
      return {
        x: (Number(centroid.x) + 0.5) * deps.TILE,
        y: (Number(centroid.y) + 0.5) * deps.TILE,
        tiles: patch.tiles,
      };
    }
    const zdef = deps.EXTERIOR_ZONES?.[zoneId] || {};
    const cols = Number(zoneData?.cols) || Number(zdef.cols) || 22;
    const rows = Number(zoneData?.rows) || Number(zdef.rows) || 16;
    return {
      x: ((herdIndex + 1) / (Math.max(1, herdCount) + 1) * cols + 0.5) * deps.TILE,
      y: (rows * 0.5 + 0.5) * deps.TILE,
      tiles: [],
    };
  }

  function attachVoorgBabiesToMother(mother, babyCount) {
    const parent = mother?.avatarRef?.group;
    const front = mother?.avatarRef?.frontPlane;
    const back = mother?.avatarRef?.backPlane;
    const THREE_NS = window.THREE;
    if (!parent || !front || !back || !THREE_NS?.Group) return 0;

    const saddle = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.creatures?.[VOORG_ASS_SPECIES]?.anchors?.saddle?.position || { x: 0, y: 0.12, z: 0 };
    const largeScale = window.CreatureGenetics?.creatureSizeScale?.(VOORG_ASS_SPECIES, 'large') || { x: 1, y: 1 };
    const smallScale = window.CreatureGenetics?.creatureSizeScale?.(VOORG_ASS_SPECIES, 'small') || { x: 0.28, y: 0.28 };
    const ratioX = (Number(smallScale.x) || 0.28) / Math.max(0.001, Number(largeScale.x) || 1); // Converts the adult parent scale into the authored small-class visual size.
    const ratioY = (Number(smallScale.y) || 0.28) / Math.max(0.001, Number(largeScale.y) || 1); // Used independently because creature size profiles can be non-uniform.
    const offsets = [
      [-0.085, 0.035, -0.045, -0.16],
      [ 0.080, 0.025,  0.035,  0.12],
      [-0.010, 0.090,  0.060, -0.04],
      [ 0.025, 0.075, -0.090,  0.20],
    ]; // Local offsets around the existing saddle attach point; no new per-species anchor is required.

    const visuals = []; // Stored on the mother for diagnostics and automatic scene-graph cleanup with the corpse.
    for (let i = 0; i < Math.max(0, Math.min(offsets.length, babyCount)); i++) {
      const [ox, oy, oz, yaw] = offsets[i];
      const baby = new THREE_NS.Group();
      baby.name = `voorg_ass_carried_baby_${i + 1}`;
      baby.userData.voorgAssCarriedBaby = true;
      baby.add(front.clone(), back.clone()); // Shares the mother's geometry/material maps, so genotype tint/animation updates cost no new texture composites.
      baby.position.set((Number(saddle.x) || 0) + ox, (Number(saddle.y) || 0.12) + oy, (Number(saddle.z) || 0) + oz);
      baby.rotation.y = yaw;
      baby.scale.set(ratioX, ratioY, ratioX);
      parent.add(baby);
      visuals.push(baby);
    }
    mother._carriedBabyVisuals = visuals;
    return visuals.length;
  }

  function spawnRoamingHerd(zoneId, herdIndex, herdKey) {
    const zdef = deps.EXTERIOR_ZONES?.[zoneId];
    const pool = zdef?.roamingHerdSpecies || [];
    if (!pool.length) return 0;
    const speciesKey = pool[Math.floor(deps.rnd() * pool.length)];
    const herdCount = Math.max(1, Math.floor(Number(zdef.roamingHerdCount) || 1));
    const anchor = roamingHerdAnchor(zoneId, herdIndex, herdCount);
    const count = ROAMING_HERD_SIZE_MIN + Math.floor(deps.rnd() * (ROAMING_HERD_SIZE_MAX - ROAMING_HERD_SIZE_MIN + 1));
    const zoneData = deps.zoneLayouts.get(zoneId);
    const waterTile = nearestWaterTile(zoneData, anchor.x, anchor.y);
    const motherIndex = speciesKey === VOORG_ASS_SPECIES ? Math.floor(deps.rnd() * count) : -1; // Exactly one Herd-Mother per Voorg-Ass herd.
    const motherBabyCount = motherIndex >= 0 ? 2 + Math.floor(deps.rnd() * 3) : 0;
    let spawned = 0;

    for (let i = 0; i < count; i++) {
      const formationAngle = (i / Math.max(1, count)) * Math.PI * 2 + herdIndex * 0.47;
      const formationRadius = deps.TILE * (0.55 + (i % 3) * 0.35);
      const tile = anchor.tiles?.length ? anchor.tiles[(i * 5 + herdIndex * 3) % anchor.tiles.length] : null;
      const x = tile ? (tile.x + 0.5) * deps.TILE : anchor.x + Math.cos(formationAngle) * formationRadius;
      const y = tile ? (tile.y + 0.5) * deps.TILE : anchor.y + Math.sin(formationAngle) * formationRadius;
      const homeOffset = deps.TILE * (0.4 + (i % 4) * 0.18);
      const sleepAngle = formationAngle + 0.31;
      const sleepRadius = deps.TILE * (0.25 + (i % 4) / 4 * ROAMING_HERD_SLEEP_RADIUS_TILES);
      const genotype = window.CreatureGenetics?.makeDefaultGenotype?.(speciesKey) || null;
      if (genotype) genotype.sizeClass = 'large'; // Wild Voorg-Ass adults are always large even if a future breeding mutation path permits other farm sizes.
      const isMother = i === motherIndex;
      const creatureKey = isMother ? VOORG_ASS_HERD_MOTHER_SPECIES : speciesKey;
      const opts = {
        homeX: anchor.x + Math.cos(formationAngle) * homeOffset,
        homeY: anchor.y + Math.sin(formationAngle) * homeOffset,
        state: 'idle',
        wildlifeRole: 'prey', // Used by chunk-local faction ecology; roaming herds are valid Porakaneki hunting targets.
        herdKey,
        herdHomeX: anchor.x,
        herdHomeY: anchor.y,
        herdSleepX: anchor.x,
        herdSleepY: anchor.y,
        herdSleepOffsetX: Math.cos(sleepAngle) * sleepRadius,
        herdSleepOffsetY: Math.sin(sleepAngle) * sleepRadius,
        wanderRadiusPx: deps.TILE * ROAMING_HERD_WANDER_TILES,
        genotype,
        ...(waterTile ? { waterTile } : {}),
        ...(isMother ? {
          isHerdMother: true,
          herdMotherLabel: 'Herd-Mother',
          carriedBabyItemKey: VOORG_ASS_BABY_ITEM_KEY,
          carriedBabyCount: motherBabyCount,
        } : {}),
      };
      const creature = deps.makeCreatureEntity(creatureKey, x, y, opts);
      if (!creature) continue;
      if (isMother) attachVoorgBabiesToMother(creature, motherBabyCount);
      deps.hostileObjects.add(creature);
      spawned++;
    }

    if (spawned > 0) {
      window.__farmLog?.(`[voorg-ass] spawned roaming herd key=${herdKey} size=${spawned} mother=${motherIndex >= 0 ? 1 : 0} babies=${motherBabyCount} anchor=(${Math.round(anchor.x / deps.TILE)},${Math.round(anchor.y / deps.TILE)})`, 'wildlife');
      if (zoneId === deps.getCurrentArea() && speciesKey === VOORG_ASS_SPECIES) deps.showToast('A large Voorg-Ass herd is roaming the cliffs.', false);
    }
    return spawned;
  }

  function ensureCurrentZoneRoamingHerds() {
    const zoneId = deps.getCurrentArea();
    const zdef = deps.EXTERIOR_ZONES?.[zoneId];
    if (!Array.isArray(zdef?.roamingHerdSpecies) || !zdef.roamingHerdSpecies.length) return;
    const herdCount = Math.max(1, Math.floor(Number(zdef.roamingHerdCount) || 1));
    for (let index = 0; index < herdCount; index++) {
      const key = roamingHerdKeyFor(zoneId, index);
      const alive = isRoamingHerdAlive(key);
      if (alive) { roamingHerdLastKnownAlive.set(key, true); continue; }

      if (!roamingHerdEverSpawned.has(key)) {
        roamingHerdEverSpawned.add(key);
        roamingHerdLastKnownAlive.set(key, false);
        spawnRoamingHerd(zoneId, index, key);
        continue;
      }
      if (roamingHerdLastKnownAlive.get(key) !== false) {
        roamingHerdLastKnownAlive.set(key, false);
        pendingRoamingHerdRespawn.add(key);
        continue;
      }
      if (pendingRoamingHerdRespawn.has(key)) continue;
      spawnRoamingHerd(zoneId, index, key);
    }
  }

  function denSpeciesFor(zoneId, cavernMapId) {
    const pool = deps.EXTERIOR_ZONES[zoneId]?.denSpecies || [];
    if (!pool.length) return null;
    const rng = window.WildernessMapGenerator.makeRng(cavernMapId + '_denspecies'); // One stable exact species identity per den, shared by exterior and cavern generation.
    return pool[Math.floor(rng() * pool.length)] || null;
  }

  function spawnPackAtDen(zoneId, den, denKey) {
    const zdef = deps.EXTERIOR_ZONES[zoneId];
    const cavernMapId = denCavernMapId(zoneId, den.id);
    // Zones may author denSpecies when den occupants should be independent
    // of general pack/herd ecology. Legacy zones without denSpecies retain
    // the existing deterministic pack-vs-herd choice so this stays fully
    // backward-compatible.
    const explicitSpeciesKey = denSpeciesFor(zoneId, cavernMapId); // Exact authored den identity, stable for this den across respawns and shared with CavernGenerator.
    const hasPack = zdef?.packSpecies?.length, hasHerd = zdef?.herbivoreSpecies?.length;
    const popRng = window.WildernessMapGenerator.makeRng(cavernMapId + '_denpop');
    const useHerd = !explicitSpeciesKey && hasHerd && (!hasPack || popRng() < 0.5);
    const pool = explicitSpeciesKey ? [explicitSpeciesKey] : (useHerd ? zdef.herbivoreSpecies : zdef?.packSpecies);
    if (!pool || !pool.length) {
      window.__farmLog?.(`[wildlife] ${denKey}: no denSpecies/packSpecies/herbivoreSpecies pool configured for zone "${zoneId}" — den stays empty (fallback: skipped spawn).`, 'wildlife');
      return;
    }
    // Which INDIVIDUAL species within that fixed pool (relevant only for a
    // zone with multiple pack or multiple herd species) and how many still
    // vary per spawn cycle — only the pack-vs-herd identity itself is
    // pinned to the den.
    const speciesKey = explicitSpeciesKey || pool[Math.floor(deps.rnd() * pool.length)];
    const speciesIsHerbivore = useHerd || !!zdef?.herbivoreSpecies?.includes(speciesKey); // Explicit den pools can still contain a species authored as part of the zone's herbivore ecology.
    // Every same-family member of this pack (e.g. gar-wolf + alpha, or
    // the whole uumkaoii-wild herd) shares one rolled-once "family"
    // genotype — see getOrMakeDenGenotype.
    const denFamily = denGenotypeFamily(speciesKey);
    const denGenotype = denFamily ? getOrMakeDenGenotype(cavernMapId, denFamily) : null;
    // den.x/den.y are the footprint's top-left tile (see workspace.animalDens
    // in wilderness-map-generator.js) — spawn/home anchor is the footprint center.
    const homeX = (den.x + (den.w || 1) * 0.5) * deps.TILE, homeY = (den.y + (den.h || 1) * 0.5) * deps.TILE;
    // Where an off-shift/overnight pack member actually walks to and
    // disappears from (see game.js's updateHostiles denKey settle branch)
    // — the den's own doorway tile, not its footprint center, so it reads
    // as "went inside" instead of "stopped in the open near the den."
    // Falls back to the footprint center for the rare den with no
    // generated mouthAnchor, same fallback the dev teleport tools use.
    const denEntranceX = den.mouthAnchor ? (den.mouthAnchor.x + 0.5) * deps.TILE : homeX;
    const denEntranceY = den.mouthAnchor ? (den.mouthAnchor.y + 0.5) * deps.TILE : homeY;
    const isGrehlrPack = speciesKey === GREHLR_SPECIES;
    const count = isGrehlrPack
      ? GREHLR_PACK_SIZE_MIN + Math.floor(deps.rnd() * (GREHLR_PACK_SIZE_MAX - GREHLR_PACK_SIZE_MIN + 1))
      : DEN_PACK_SIZE_MIN + Math.floor(deps.rnd() * (DEN_PACK_SIZE_MAX - DEN_PACK_SIZE_MIN + 1));
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
      // Every other pack species shares one literal home point (the den's
      // own footprint center) — a grehlr instead gets its own, rolled
      // independently per member so they go their separate ways by day
      // (see GREHLR_DAY_SPREAD_TILES_MIN/MAX above).
      let memberHomeX = homeX, memberHomeY = homeY;
      if (isGrehlrPack) {
        const spreadAngle = deps.rnd() * Math.PI * 2;
        const spreadDist = deps.TILE * (GREHLR_DAY_SPREAD_TILES_MIN + deps.rnd() * (GREHLR_DAY_SPREAD_TILES_MAX - GREHLR_DAY_SPREAD_TILES_MIN));
        memberHomeX = homeX + Math.cos(spreadAngle) * spreadDist;
        memberHomeY = homeY + Math.sin(spreadAngle) * spreadDist;
      }
      const opts = { homeX: memberHomeX, homeY: memberHomeY, denEntranceX, denEntranceY, state: 'idle', denKey, genotype: denGenotype, wildlifeRole: speciesIsHerbivore ? 'prey' : 'predator' }; // Explicit ecology role avoids guessing from hostility/diet overlays later.
      assignWildlifeStation(opts, zoneData, memberHomeX, memberHomeY, speciesIsHerbivore);
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
      if ((zdef?.denSpecies?.length || zdef?.packSpecies?.length || zdef?.herbivoreSpecies?.length) && !_loggedMissingDenZones.has(currentArea)) {
        _loggedMissingDenZones.add(currentArea);
        window.__farmLog?.(`[wildlife] zone "${currentArea}" has a denSpecies/packSpecies/herbivoreSpecies pool but no den anchors in _zoneLayouts (fallback: no wild packs will spawn here this session).`, 'wildlife');
      }
      return;
    }
    for (const den of dens) {
      const key = denKeyFor(currentArea, den);
      if (den.collapsed || den.turnoverStage === 'collapsed' || den.turnoverStage === 'ready' || den.turnoverStage === 'cleared') {
        denLastKnownAlive.set(key, false);
        pendingDenRespawn.delete(key);
        continue;
      }
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
  const NEST_TREE_MIN_SEPARATION_TILES = 72; // Used to keep different Drenkirra families in distinct forest regions instead of filling the arrival chunk with every nest.
  const NEST_PACK_SIZE_MIN = 2;
  const NEST_PACK_SIZE_MAX = 4;
  // Cache stable tile keys, not branch object identities: chunk streaming
  // destroys and recreates branch objects as chunks unload/reload.
  const _nestTreeSelectionCache = new Map(); // zoneId -> [{ key, col, row, branch }], incrementally filled as distant chunks stream in.

  function branchTileKey(branch) { return `${branch.col},${branch.row}`; }
  function nestTreeKeyFor(zoneId, branch) { return `${zoneId}:nesttree:${branchTileKey(branch)}`; }

  function nestTreeTargetCount(zoneId) {
    const denCount = deps.zoneLayouts.get(zoneId)?.dens?.length || 0; // Used to keep the final nest population comparable to this generated zone's real den population.
    return Math.max(1, Math.min(NEST_TREE_MAX_PER_ZONE, denCount || NEST_TREE_MAX_PER_ZONE));
  }

  function nestBranchDistanceTiles(a, b) {
    return Math.hypot(Number(a?.col) - Number(b?.col), Number(a?.row) - Number(b?.row));
  }

  function nestBranchScore(zoneId, branch) {
    const rng = window.WildernessMapGenerator?.makeRng?.(`${zoneId}_nesttree_${branch.col}_${branch.row}`); // Used to make the winning tree within each newly explored region stable for this generated map.
    return rng ? rng() : deps.rnd();
  }

  function extendScatteredNestSelection(zoneId, branches, selected, targetCount) {
    if (selected.length >= targetCount) return selected;
    const selectedKeys = new Set(selected.map(entry => entry.key)); // Used to reject already-selected trees when their streamed branch objects are rebuilt.
    const candidates = branches
      .filter(branch => !selectedKeys.has(branchTileKey(branch)))
      .map(branch => ({ branch, key: branchTileKey(branch), score: nestBranchScore(zoneId, branch) }))
      .sort((a, b) => a.score - b.score || a.key.localeCompare(b.key));

    for (const candidate of candidates) {
      if (selected.length >= targetCount) break;
      if (selected.some(entry => nestBranchDistanceTiles(entry, candidate.branch) < NEST_TREE_MIN_SEPARATION_TILES)) continue;
      const entry = {
        key: candidate.key,
        col: candidate.branch.col,
        row: candidate.branch.row,
        branch: candidate.branch,
      }; // Retains tile coordinates after this chunk unloads so later selections still respect the same world-space spacing.
      selected.push(entry);
      selectedKeys.add(entry.key);
      window.__farmLog?.(`[wildlife] scattered Drenkirra nest selected at (${entry.col},${entry.row}) (${selected.length}/${targetCount}; min separation ${NEST_TREE_MIN_SEPARATION_TILES} tiles).`, 'wildlife');
    }
    return selected;
  }

  function isNestTreeAlive(key) {
    for (const c of deps.hostileObjects) if (c.nestTreeKey === key && c.health > 0) return true;
    return false;
  }

  // Deterministic per-tree scores keep each streamed region's choice stable.
  // Selection is extended instead of finalized on the first call because the
  // wilderness streamer initially builds only the player's 16x16 arrival
  // chunk. A fixed separation prevents that first local branch registry (or
  // any later resident 3x3/5x5 chunk neighborhood) from claiming every nest.
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
      selected = [];
      _nestTreeSelectionCache.set(zoneId, selected);
    }
    extendScatteredNestSelection(zoneId, branches, selected, nestTreeTargetCount(zoneId));

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
      wildlifeRole: 'prey', // Drenkirra Nestmothers remain prey ecology even though they defend their nest.
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
      const opts = { homeX: branch.baseX, homeY: branch.baseY, state: 'idle', nestTreeKey: key, genotype: nestGenotype, wildlifeRole: 'prey' };
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
    processDenTurnoverForZone(currentArea);
    ensureCurrentZoneDenPacks();
    ensureCurrentZoneRoamingHerds();
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
    const selectedNestTrees = _nestTreeSelectionCache.get(zoneId) || []; // Used to distinguish the generation-wide selection from only the branches resident in streamed chunks right now.
    let nestTreesAlive = 0;
    for (const branch of selectedNestBranches) {
      if (isNestTreeAlive(nestTreeKeyFor(zoneId, branch))) nestTreesAlive++;
    }
    return {
      denCount,
      nestTreeCap: nestTreeTargetCount(zoneId),
      nestTreesSelected: selectedNestTrees.length,
      nestTreesResident: selectedNestBranches.length,
      nestTreesAlive,
      minimumSeparationTiles: NEST_TREE_MIN_SEPARATION_TILES,
      selectedNestTiles: selectedNestTrees.map(entry => ({ col: entry.col, row: entry.row })),
    };
  }

  window.WildlifeSpawn = {
    init,
    applyWildlifeSkirmishDamage,
    denKeyFor,
    denCavernMapId,
    denCavernZoneOf: (mapId) => _denCavernZoneOf.get(mapId),
    denSpeciesFor,
    denKeyForCavern,
    denGenotypeFamily,
    getOrMakeDenGenotype,
    getDenGenotypes: () => _denGenotypes,
    denTurnoverDebug,
    denTurnoverStateForCavern,
    onDenMotherDeath,
    forgetZoneDenState,
    isDenPackAlive,
    updateHostileSpawning,
    onZoneEntered,
    denNestCensus,
    roamingHerdCensus: (zoneId = deps.getCurrentArea()) => {
      const zdef = deps.EXTERIOR_ZONES?.[zoneId] || {};
      const herdCount = Math.max(0, Math.floor(Number(zdef.roamingHerdCount) || 0));
      const herds = [];
      for (let index = 0; index < herdCount; index++) {
        const herdKey = roamingHerdKeyFor(zoneId, index);
        let adults = 0, mothers = 0, babies = 0, sleeping = 0;
        for (const c of deps.hostileObjects) {
          if (c.herdKey !== herdKey || c.health <= 0) continue;
          adults++;
          if (c.isHerdMother) { mothers++; babies += Math.max(0, Number(c.carriedBabyCount) || 0); }
          if (c._animalSleeping) sleeping++;
        }
        herds.push({ herdKey, adults, mothers, carriedBabies: babies, sleeping });
      }
      return { zoneId, configuredHerds: herdCount, species: [...(zdef.roamingHerdSpecies || [])], herds };
    },
    __test: Object.freeze({
      extendScatteredNestSelection,
      minimumNestSeparationTiles: NEST_TREE_MIN_SEPARATION_TILES,
    }),
    // Also clears pendingNestTreeRespawn — a wiped nest tree waits for the
    // next day exactly like a wiped den (see ensureCurrentZoneNestTrees),
    // so it rides the same day-advance call sites as den respawn instead of
    // needing its own.
    clearPendingDenRespawn: () => {
      pendingDenRespawn.clear();
      pendingNestTreeRespawn.clear();
      pendingRoamingHerdRespawn.clear();
      advanceDenTurnoverDay();
    },
  };
})();
