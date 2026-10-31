(() => {
  'use strict';

  // Porakaneki wilderness camp network.
  //
  // Every generated wilderness map receives one hunting camp per rival tribe,
  // at opposing ends of the map. A separate large camp contains the named chief plus
  // a larger procedural population and migrates between wilderness maps when
  // CalendarSystem's regional season changes. Small camps stay put for the
  // whole Tothal generation.
  //
  // Generated residents use the same loose planner-like neutral behavior as the
  // previous single-camp implementation: hunt, wander, socialize, investigate
  // nearby stimuli, or drift around home. Full humanoid/combat simulation exists
  // while an individual is inside a distance-based player bubble; a wider exit
  // radius provides hysteresis so crossing an arbitrary tile/chunk boundary can
  // never make a nearby resident disappear. Everywhere else the character is an
  // abstract position/activity updated every few seconds.
  //
  // Porakaneki Avengers: a tribe whose config has an `avengers` block also
  // keeps one small band of mounted riders (a Porakaneki seated on a Nazgraku,
  // see omgurku-species-runtime.js MOUNTS) at the first hunting camp of every
  // wilderness map. They are ordinary camp residents with role 'avenger' whose
  // planner rides out after the rival tribe's travelling hunters and kills
  // them: off-screen as an abstract slay, near the player through the normal
  // rival-tribe ecology fight among live actors around the player.
  const BENCHLOG_KEY = 'benchlog'; // Used by camp log rendering and the shared NPC seating stations.
  const BONFIRE_KEY = 'bonfire'; // Used to select the shared 2x2 large-fire furniture instead of the old one-tile campfire.
  const TICK_INTERVAL_S = 0.20; // Neutral planner/LOD cadence; actual entity movement/render/combat stays in the normal hostile loop.
  const PROVOKE_SECONDS = 45; // Temporary same-camp self-defense window after an assault without permanent Favor loss.
  const DORMANT_ENTITY_RELEASE_S = 3; // Grace period before a hidden off-radius/sleeping hunter's real entity is torn down.
  const MIN_HUNTING_CAMPS_PER_ZONE = 1; // Hard ecology floor: every wilderness zone keeps at least one ordinary hunting camp per tribe.

  let combatDeps = null; // Captured from BanditCombat.init; movement/scenes/terrain/tools/hostileObjects. Shared by every tribe.
  let schedulingDeps = null; // Captured from NpcScheduling.init; live named-chief walkers. Shared by every tribe.
  const tribeRuntimes = []; // Every created tribe, in creation order; later tribes place their camps around earlier tribes' sites.

  const num = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
  function markOutline(root) {
    root?.traverse?.(child => {
      if (!child?.isMesh || child.userData?.noOutline === true) return;
      child.layers?.enable?.(1);
    });
  }
  const nowMs = () => typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  const rand = () => {
    const value = combatDeps?.rnd?.();
    return Number.isFinite(value) ? value : Math.random();
  };
  function currentArea() { return combatDeps?.getCurrentArea?.() || null; }
  function gameHour() {
    const value = Number(window.CalendarSystem?.getHour?.());
    return Number.isFinite(value) ? ((value % 24) + 24) % 24 : 12;
  }
  function gameDay() {
    const raw = Number(window.CalendarSystem?.timeDebugSnapshot?.()?.rawDay);
    if (Number.isFinite(raw)) return Math.max(0, Math.floor(raw));
    return Math.max(0, Math.floor(Number(combatDeps?.calendar?.day ?? 0) || 0));
  }
  function generationYear() {
    const year = Number(window.CalendarSystem?.tothalCycle?.());
    return Number.isFinite(year) ? Math.max(1, Math.floor(year)) : 1;
  }
  function currentSeasonName() {
    try { return String(window.CalendarSystem?.currentSeason?.()?.name || 'Stormtide'); }
    catch { return 'Stormtide'; }
  }
  function hashSeed(text) {
    let h = 2166136261 >>> 0;
    for (const ch of String(text || '')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function seededRng(text) {
    let a = hashSeed(text) || 0x9e3779b9;
    return () => {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function integerRoll(rng, min, max) {
    const lo = Math.floor(Math.min(min, max)), hi = Math.floor(Math.max(min, max));
    return lo + Math.floor(rng() * (hi - lo + 1));
  }
  function disposeObject3D(root) {
    if (!root) return;
    root.parent?.remove?.(root);
    root.traverse?.(object => {
      object.geometry?.dispose?.();
      if (Array.isArray(object.material)) object.material.forEach(material => material?.dispose?.());
      else object.material?.dispose?.();
    });
  }
  function streamChunkSizeTiles() {
    return Math.max(1, Math.floor(num(window.WildernessChunks?.constants?.CHUNK_TILES, 16)));
  } // Canonical streamed wilderness chunk span used by camp exclusion and local ecology.
  function streamChunkKeysForSite(site) {
    if (!site) return [];
    const size = streamChunkSizeTiles();
    const minCx = Math.floor(num(site.x, 0) / size);
    const maxCx = Math.floor((num(site.x, 0) + Math.max(1, num(site.w, 1)) - 1) / size);
    const minCz = Math.floor(num(site.y, 0) / size);
    const maxCz = Math.floor((num(site.y, 0) + Math.max(1, num(site.h, 1)) - 1) / size);
    const keys = [];
    for (let cz = minCz; cz <= maxCz; cz++) for (let cx = minCx; cx <= maxCx; cx++) keys.push(`${cx},${cz}`);
    return keys;
  } // Expands a whole padded camp footprint rather than only checking its center chunk.
  function playerTilePosition() {
    if (!combatDeps?.player || !combatDeps?.TILE) return null;
    return { col: combatDeps.player.x / combatDeps.TILE, row: combatDeps.player.y / combatDeps.TILE };
  }
  function streamChunkOfTile(col, row) {
    const size = streamChunkSizeTiles();
    return { x: Math.floor(num(col, 0) / size), y: Math.floor(num(row, 0) / size) };
  } // Actual WildernessChunks coordinate, distinct from the old config-era 10-tile debug chunk.
  function sameStreamChunk(a, b) { return !!a && !!b && a.x === b.x && a.y === b.y; }
  function playerStreamChunk() {
    const player = playerTilePosition();
    return player ? streamChunkOfTile(player.col, player.row) : null;
  }
  // Faction fights (tribe vs tribe, bandits, predators) run for every live
  // actor within this radius of the player: the release radius out to which
  // camp residents stay visible actors, so anything on screen fights. It used to
  // be the player's exact 16x16 stream chunk, which left rival camps in the
  // next chunk over standing peacefully side by side in plain view.
  let ecologyRadiusTiles = 24; // Replaced from the first tribe's behavior.ecologyRadiusTiles (default fullSimulationReleaseRadiusTiles).
  function entityInPlayerEcologyRange(entity) {
    if (!entity || entity.areaId !== currentArea() || !combatDeps?.TILE) return false;
    const player = playerTilePosition();
    return !!player && Math.hypot(entity.x / combatDeps.TILE - player.col, entity.y / combatDeps.TILE - player.row) <= ecologyRadiusTiles;
  }

  function normalizedEcologySpeciesKey(entity) {
    return String(entity?.creatureKey || '')
      .replace(/-herd-mother$/, '')
      .replace(/-den-mother$/, '')
      .replace(/-nestmother$/, '')
      .replace(/-alpha$/, '');
  } // Used only as a fallback for older spawned wildlife without an explicit wildlifeRole.
  // Tribe camp hunters carry isTribeHunter + tribeId; older Porakaneki-only
  // spawns (dev arena, saved test fixtures) set just isPorakanekiHunter.
  function tribeOf(entity) {
    if (entity?.isTribeHunter) return String(entity.tribeId || '');
    return entity?.isPorakanekiHunter ? 'porakaneki' : '';
  }
  function ecologyRole(entity) {
    if (!entity || entity.health <= 0 || entity.isCompanion) return null;
    if (tribeOf(entity)) return 'tribe';
    if (entity.isBandit || entity.banditCompanion) return 'bandit';
    if (entity.wildlifeRole === 'predator' || entity.wildlifeRole === 'prey') return entity.wildlifeRole;
    const zdef = combatDeps?.EXTERIOR_ZONES?.[currentArea()] || {};
    const key = normalizedEcologySpeciesKey(entity);
    if ((zdef.packSpecies || []).some(species => species === key || species === entity.creatureKey)) return 'predator';
    if ([...(zdef.herbivoreSpecies || []), ...(zdef.roamingHerdSpecies || [])].some(species => species === key || species === entity.creatureKey)) return 'prey';
    const diet = String(entity.def?.diet || '').toLowerCase();
    if (diet === 'predator' || diet === 'carnivore') return 'predator';
    if (diet === 'prey' || diet === 'herbivore') return 'prey';
    return null;
  }
  // Bandits, predators and every other tribe's hunters are a tribe hunter's
  // shared enemies: fights with them never count against the player.
  function isSharedEnemyOf(entity, other) {
    const role = ecologyRole(other);
    if (role === 'bandit' || role === 'predator') return true;
    return role === 'tribe' && !!tribeOf(entity) && tribeOf(other) !== tribeOf(entity);
  }
  function nearestEcologyTarget(source, candidates) {
    let best = null, bestD = Infinity;
    for (const target of candidates) {
      if (!target || target === source || target.health <= 0) continue;
      const d = Math.hypot(target.x - source.x, target.y - source.y);
      if (d < bestD) { best = target; bestD = d; }
    }
    return best;
  }
  function validChunkCombatTarget(entity, target) {
    return !!entity && !!target && target.health > 0
      && entity.areaId === currentArea() && target.areaId === currentArea()
      && entityInPlayerEcologyRange(entity) && entityInPlayerEcologyRange(target);
  }
  function committedEcologyTarget(entity, candidates, targetKey = '_chunkCombatTarget') {
    // A fight owns its target until that opponent dies, leaves the active area,
    // or stops being a valid enemy. Distance changes alone never restart the fight.
    const committed = entity?.[targetKey];
    if (candidates.includes(committed) && validChunkCombatTarget(entity, committed)) return committed;
    return nearestEcologyTarget(entity, candidates);
  }
  // The player outranks the ecology. An actor that is already fighting the
  // player, just got hit by the player or their companion, or has the player
  // inside its own aggro range must never be handed to an actor-vs-actor fight:
  // that silently dropped the bandit's attack on the player (it read as
  // "non-hostile") and, because ecology-fight chasers are exempt from
  // isPlayerInCombat, cut the combat music mid-fight.
  const PLAYER_ENGAGEMENT_HOLD_MS = 6000;
  function engagedWithPlayer(entity) {
    if (!entity || !(entity.health > 0)) return false;
    if (tribeOf(entity)) return entity._porakanekiPlannerControlled !== true; // Neutral hunters ignore the player (crossfire hits are forgiven by design); a provoked one is already hostile and stays so.
    const pursuingPlayer = (entity.state === 'chase' || entity.state === 'searching') && !entity._chunkCombatTarget; // A target reference, even a just-dead one, means the ecology (not the player) set this 'chase'; the pass below releases it.
    if (pursuingPlayer) return true;
    if (nowMs() - num(entity._teamHitAt, -Infinity) <= PLAYER_ENGAGEMENT_HOLD_MS) return true; // Stamped by PlayerDowned.noteTeamHit for every player/companion hit.
    const player = playerTilePosition();
    const aggroTiles = num(entity.def?.aggroRangePx, 0) / (combatDeps?.TILE || 1);
    return !!player && aggroTiles > 0 && Math.hypot(entity.x / combatDeps.TILE - player.col, entity.y / combatDeps.TILE - player.row) <= aggroTiles;
  }
  // A fight that outlasts its camp leash would otherwise send the actor
  // straight home ('return') the moment it turns on the player, so the leash
  // anchor moves to where the player fight starts and is restored afterwards.
  function rebaseHomeForPlayerFight(entity) {
    const leash = num(entity.def?.leashRangePx, 0);
    if (!(leash > 0) || !Number.isFinite(entity.homeX) || !Number.isFinite(entity.homeY)) return;
    if (Math.hypot(entity.x - entity.homeX, entity.y - entity.homeY) <= leash * 0.85) return;
    entity._ecologyHome ??= { x: entity.homeX, y: entity.homeY };
    entity.homeX = entity.x;
    entity.homeY = entity.y;
  }
  function restoreEcologyHome(entity) {
    if (!entity?._ecologyHome) return;
    entity.homeX = entity._ecologyHome.x;
    entity.homeY = entity._ecologyHome.y;
    entity._ecologyHome = null;
  }
  function yieldToPlayer(entity) {
    const factionTarget = entity._chunkFactionEcologyTarget;
    if (!entity._chunkCombatTarget && !factionTarget) return; // Already on the ordinary player-hostility path.
    entity._chunkCombatTarget = null;
    if (factionTarget) {
      entity._chunkFactionEcologyTarget = null;
      if (entity.targetCreature === factionTarget) entity.targetCreature = null;
    }
    entity.targetPlayer = null; // Re-acquired as the nearest player by the ordinary hostile loop.
    entity.state = 'chase';
    rebaseHomeForPlayerFight(entity);
  }
  function setHumanoidEcologyTarget(entity, target) {
    if (!entity) return;
    const prior = entity._chunkCombatTarget;
    entity._chunkCombatTarget = target || null; // Read by BanditCombat.updateCombatAI to replace only the current attack target.
    if (!target) {
      // A finished fight must not leave the actor in 'chase' with no target: that
      // reads as the player being in combat (music blip) and, past the leash,
      // trips a 'return' that looks like the bandit going passive.
      if (prior && (entity.state === 'chase' || entity.state === 'searching')) entity.state = 'return';
      return;
    }
    if (tribeOf(entity)) {
      entity._porakanekiPlannerControlled = true; // Ecology combat must not make neutral hunters hostile/targetable to the player.
      entity._porakanekiActivity = 'ecology-combat';
      if (entity.def) entity.def.aggroRangePx = 0;
      if (isSharedEnemyOf(entity, target)) entity._porakanekiSharedEnemyUntilMs = nowMs() + 1500; // Preserves crossfire forgiveness through a same-frame enemy death.
    }
    entity.state = 'chase';
  }
  function setPredatorEcologyTarget(entity, target) {
    if (!entity) return;
    const prior = entity._chunkFactionEcologyTarget;
    entity._chunkFactionEcologyTarget = target || null; // Tracks ownership so clearing this encounter never erases unrelated wildlife targets.
    if (target) {
      entity.targetCreature = target;
      entity.state = 'patrol-chase'; // Reuses the existing visible predator-vs-creature pursuit/attack path in game.js.
    } else if (prior && entity.targetCreature === prior) {
      entity.targetCreature = null;
      if (entity.state === 'patrol-chase') entity.state = 'idle';
    }
  }
  function activePlayerChunkEcology() {
    const groups = { tribe: [], bandit: [], predator: [], prey: [] };
    for (const entity of combatDeps?.hostileObjects || []) {
      if (!entityInPlayerEcologyRange(entity) || entity.health <= 0) continue;
      const role = ecologyRole(entity);
      if (role && groups[role]) groups[role].push(entity);
    }
    return groups;
  }
  function hasSharedEnemyNearby(entity) {
    if (!entityInPlayerEcologyRange(entity)) return false;
    for (const other of combatDeps?.hostileObjects || []) {
      if (other === entity || !entityInPlayerEcologyRange(other) || other.health <= 0) continue;
      if (isSharedEnemyOf(entity, other)) {
        if (tribeOf(entity)) entity._porakanekiSharedEnemyUntilMs = nowMs() + 1500;
        return true;
      }
    }
    return !!tribeOf(entity) && nowMs() < num(entity._porakanekiSharedEnemyUntilMs, 0);
  } // "Nearby" means the same player ecology radius the fights use, with a 1.5s grace so simultaneous crossfire deaths stay forgiven.
  let ecologyState = { chunk: null, bandits: 0, predators: 0, prey: 0, humanoidTargets: 0, predatorTargets: 0 }; // Copyable mobile debug summary of the currently observed stream-chunk ecology pass.
  function updateChunkEcology() {
    const observedChunk = playerStreamChunk(); // Used both as the hard simulation gate and the mobile-visible debug identity.
    if (!combatDeps?.hostileObjects || !observedChunk) return;
    const groups = activePlayerChunkEcology();
    const active = new Set([...groups.tribe, ...groups.bandit, ...groups.predator, ...groups.prey]);
    let humanoidTargets = 0; // Counted below for Pixel-Probe/debugSnapshot verification without inspecting entity internals.
    let predatorTargets = 0; // Counted below for the same mobile-visible ecology summary.

    // Clear only targets this system previously owned once either participant
    // leaves the player's ecology radius. No actor-vs-actor simulation continues offscreen.
    for (const entity of combatDeps.hostileObjects) {
      if (active.has(entity)) continue;
      if (entity._chunkCombatTarget) setHumanoidEcologyTarget(entity, null);
      if (entity._chunkFactionEcologyTarget) setPredatorEcologyTarget(entity, null);
      restoreEcologyHome(entity);
    }

    for (const bandit of groups.bandit) {
      if (engagedWithPlayer(bandit)) { yieldToPlayer(bandit); continue; }
      restoreEcologyHome(bandit);
      const target = committedEcologyTarget(bandit, [...groups.tribe, ...groups.predator]);
      setHumanoidEcologyTarget(bandit, target);
      if (target) humanoidTargets++;
    }
    for (const hunter of groups.tribe) {
      if (hunter._avengerRetreating === true) { setHumanoidEcologyTarget(hunter, null); continue; } // Outnumbered Avengers disengage and ride off.
      if (engagedWithPlayer(hunter)) { hunter._chunkCombatTarget = null; continue; } // Provoked hunters fight the player only; updateDetailedHunter keeps them hostile.
      const rivals = groups.tribe.filter(other => tribeOf(other) !== tribeOf(hunter)); // Rival tribes fight on sight inside the observed chunk.
      const threat = committedEcologyTarget(hunter, [...groups.bandit, ...groups.predator, ...rivals]);
      const prey = threat ? null : committedEcologyTarget(hunter, groups.prey); // Genuine threats can still interrupt a hunt, but not another fight of equal priority.
      const target = threat || prey;
      setHumanoidEcologyTarget(hunter, target);
      if (target) humanoidTargets++;
    }
    for (const predator of groups.predator) {
      if (engagedWithPlayer(predator)) { yieldToPlayer(predator); continue; }
      restoreEcologyHome(predator);
      const target = committedEcologyTarget(predator, [...groups.tribe, ...groups.bandit], '_chunkFactionEcologyTarget');
      setPredatorEcologyTarget(predator, target);
      if (target) predatorTargets++;
    }
    const tribeCounts = {}; // One count per registered tribe, keyed by tribe id (porakaneki, omgurku).
    for (const runtime of tribeRuntimes) tribeCounts[runtime.tribeId] = 0;
    for (const hunter of groups.tribe) tribeCounts[tribeOf(hunter)] = (tribeCounts[tribeOf(hunter)] || 0) + 1;
    ecologyState = {
      chunk: `${observedChunk.x},${observedChunk.y}`,
      ...tribeCounts,
      bandits: groups.bandit.length,
      predators: groups.predator.length,
      prey: groups.prey.length,
      humanoidTargets,
      predatorTargets,
    };
  }

  // One independent camp network per tribe (Porakaneki, Omgurku). The factory
  // body keeps this module's original two-space indentation so the shared
  // planner code reads exactly as it did when it served a single tribe.
  function createTribeCamps(tribe) {
  const KEY = tribe.id; // Lowercase tribe key used in camp/station/agenda ids and seeds (unchanged 'porakaneki' keeps existing worlds stable).
  const LABEL = tribe.label; // Player-facing tribe name.
  const CONFIG_URL = tribe.configUrl; // Network/population/LOD/reputation tuning loaded once at startup.
  const SMALL_LOCALE_URL = tribe.smallLocaleUrl; // Little procedural-only camp footprint.
  const CHIEF_LOCALE_URL = tribe.chiefLocaleUrl; // Large seasonal named-chief camp footprint.
  const TENT_PIECE_URL = tribe.tentPieceUrl; // Dedicated 2x2 hunting tent used only by the wilderness camps.
  const TENT_HEIGHT_SCALE = tribe.tentHeightScale ?? 1; // Per-tribe vertical stretch of the shared hunting tent.
  const SPECIES_ID = tribe.speciesId; // Forced species for every generated camp resident.
  const CHIEF_ID = tribe.chiefNpcId; // Default named chief / Favor owner when the config omits reputation.npcId.
  const DORMANT_AREA_PREFIX = `__${KEY}_dormant__:`; // Removes hidden/off-radius residents from the normal hostile loop.
  const SCHEDULER_ID = `${KEY}-camps-runtime`; // Stable shared-frame owner; production no longer depends on the obsolete BanditCamps banner tick being called.
  let cfg = null; // Parsed porakaneki-camp.json.
  let smallLocaleDef = null; // Parsed small-camp locale.
  let chiefLocaleDef = null; // Parsed large chief-camp locale.
  let tentPiece = null; // Parsed 3x3 authored Porakaneki tent piece used by tentMesh().
  let tentCanvasTextureCache = null; // Shared canvas texture reused by every authored Porakaneki tent material.
  let gangCfg = null; // Existing humanoid combat balance reused by generated residents.
  let tickAccum = 0; // Accumulates detailed neutral update time.
  let coarseAccum = 0; // Accumulates off-radius abstract update time.
  let buildGeneration = 0; // Invalidates asynchronous entity builds after wilderness regeneration.

  const state = {
    zones: new Map(), // zoneId -> {layoutRef, view, chiefReservation, chiefCamp, smallCamps}.
    chiefZoneId: null, // Wilderness map currently hosting the one active large camp.
    chiefSeason: null, // CalendarSystem.currentSeason().name corresponding to chiefZoneId.
    chiefBehaviorKey: null, // Prevents rewriting the named chief's planner data every tick.
    lastReason: 'boot', // Copyable mobile diagnostic lifecycle note.
    stamps: 0, // Successful visible + reserved camp stamps this session.
    materializations: 0, // Generated residents promoted from abstract agents into real humanoid entities.
    coarseTicks: 0, // Low-frequency abstract simulation ticks.
    greetings: 0, // Friendly Porakaneki greetings shown this session.
    kills: 0, // Player-attributed Porakaneki deaths charged to tribe Favor.
    avengerKills: 0, // Rival travellers slain off-screen by this tribe's Avengers.
    avengerLosses: 0, // Avengers killed off-screen by a quarry that fought back.
    avengerEscapes: 0, // Off-screen quarries that got away from an Avenger band.
    avengerWithdrawals: 0, // Times a band broke off because the rival group outnumbered it.
    updateTicks: 0, // Counts actual 5 Hz planner updates so a dead runtime cadence is visible in snapshots.
    tickOwner: 'uninstalled', // 'RuntimeFrameScheduler' in shipped gameplay, legacy BanditCamps wrapper only in isolated tests/tools.
  };


  function desiredChiefZone(seasonName = currentSeasonName()) {
    const map = cfg?.chiefCamp?.seasonZoneMap || {};
    return map[seasonName] || cfg?.wildernessZones?.[0] || null;
  }
  function isSleepingHour(hour = gameHour()) {
    const start = num(cfg?.schedule?.sleepStartHour, 22);
    const wake = num(cfg?.schedule?.wakeHour, 6);
    return start > wake ? (hour >= start || hour < wake) : (hour >= start && hour < wake);
  }


  function buildZoneView(zoneId, layout) {
    if (!layout?.cols || !layout?.rows || !combatDeps) return null;
    const cols = layout.cols, rows = layout.rows;
    const tiles = Array.from({ length: rows }, () => new Array(cols).fill(null));
    const objects = [];
    for (const source of (layout.tiles || [])) {
      if (!(source.r >= 0 && source.r < rows && source.c >= 0 && source.c < cols)) continue;
      const rockKind = source.rockKind || (source.type === combatDeps.TileType?.ROCK ? source.generatedObjectType : null); // Some generated layouts retain object type but derive rockKind only when the live grid is built.
      const boulderId = source.boulderId || (rockKind === 'undiggableBoulder' ? source.generatedObjectId : null); // The source object ID groups every tile of a boulder even before live-grid rendering adds its map prefix.
      const tile = {
        height: source.elevTier || 0,
        water: !!combatDeps.WATERWAY_TYPES?.has?.(source.type),
        path: source.type === combatDeps.TileType?.PATH,
        ramp: source.type === combatDeps.TileType?.RAMP || !!source.incline,
        waterfall: source.type === combatDeps.TileType?.WATERFALL,
        terrain: source.type,
        rockKind: rockKind || null, // Retains the true source rock classification through reversible camp placement.
        boulderId: boulderId || null, // Identifies the whole generated boulder even when its original layout has not acquired a runtime boulderId.
        generatedObjectId: source.generatedObjectId || null, // Source resource identity required for restoration when a chief camp migrates.
        generatedObjectType: source.generatedObjectType || null, // Resource kind is carried separately from the live grid's rockKind.
        borderEscarpment: !!(source.borderEscarpment || source.mapBoundary), // Map-boundary rock/cliff walls are never bulldozed by a fallback camp.
        occupiedBy: null,
      };
      tiles[source.r][source.c] = tile;
      const ordinaryRock = source.type === combatDeps.TileType?.ROCK && (!!boulderId || ['diggableRockOre', 'rockOutcrop', 'resourceNode'].includes(rockKind)); // Only identified replaceable rocks are ordinary camp clutter; untyped cliff rock stays protected.
      if (source.type === combatDeps.TileType?.SHRUB || ordinaryRock) {
        const id = `${KEY}_clutter_${source.c}_${source.r}`;
        tile.occupiedBy = id;
        objects.push({ id, type: 'unique', x: source.c, y: source.r, w: 1, h: 1, localeMeta: true });
      } else if (source.type === combatDeps.TileType?.ROCK) {
        const id = `${KEY}_natural_cliff_${source.c}_${source.r}`; // Hard blocker, intentionally excluded from prepareClutter's mutable prefix.
        tile.occupiedBy = id;
        objects.push({ id, type: 'unique', x: source.c, y: source.r, w: 1, h: 1, localeMeta: true });
      }
    }

    let blockerSeq = 0;
    const blockRect = (col, row, w = 1, h = 1) => {
      if (!Number.isFinite(col) || !Number.isFinite(row)) return;
      const id = `${KEY}_blocker_${blockerSeq++}`;
      objects.push({ id, type: 'unique', x: col, y: row, w, h, localeMeta: true });
      for (let r = row; r < row + h; r++) for (let c = col; c < col + w; c++) if (tiles[r]?.[c]) tiles[r][c].occupiedBy = id;
    };
    for (const building of (layout.buildings || [])) blockRect(building.gridX || 0, building.gridZ || 0, building.footprintW ?? building.w ?? 1, building.footprintD ?? building.h ?? 1);
    for (const den of (layout.dens || [])) blockRect(den.x, den.y, den.w || 1, den.h || 1);
    for (const decor of (layout.decor || [])) blockRect(decor.col, decor.row);
    for (const furniture of (layout.furniture || [])) blockRect(furniture.col, furniture.row);
    for (const transition of (layout.transitions || [])) blockRect(transition.col, transition.row);
    for (const totem of (layout.rootTotems || [])) blockRect(totem.x ?? totem.col, totem.y ?? totem.row, totem.w || 1, totem.h || 1);
    for (const instance of (layout.localeInstances || [])) for (const object of (instance.objects || [])) blockRect(object.x, object.y, object.w || 1, object.h || 1);

    const zoneDef = combatDeps.EXTERIOR_ZONES?.[zoneId];
    const entry = layout.toTownExit
      ? { x: layout.toTownExit.col, y: layout.toTownExit.row }
      : (Number.isFinite(zoneDef?.entryCol) ? { x: zoneDef.entryCol, y: zoneDef.entryRow } : null);
    return { cols, rows, tiles, objects, entry };
  }

  const MIN_HUNTER_SEPARATION_TILES = 0.75;
  function _tooCloseToAvoidPoint(col, row, avoidPoints) {
    if (!avoidPoints || !avoidPoints.length) return false;
    for (const p of avoidPoints) if (Math.hypot(col - p.col, row - p.row) < MIN_HUNTER_SEPARATION_TILES) return true;
    return false;
  }
  function pointIsOpen(zoneState, col, row, avoidPoints) {
    const c = Math.floor(col), r = Math.floor(row);
    const tile = zoneState?.view?.tiles?.[r]?.[c];
    return !!tile && !tile.water && !tile.waterfall && !tile.occupiedBy && !_tooCloseToAvoidPoint(col, row, avoidPoints);
  }
  function nearestOpenPoint(zoneState, col, row, avoidPoints) {
    const cols = zoneState?.view?.cols || 1, rows = zoneState?.view?.rows || 1;
    const baseCol = clamp(col, 1.25, Math.max(1.25, cols - 1.25));
    const baseRow = clamp(row, 1.25, Math.max(1.25, rows - 1.25));
    if (pointIsOpen(zoneState, baseCol, baseRow, avoidPoints)) return { col: baseCol, row: baseRow };
    for (let radius = 1; radius <= 4; radius++) {
      for (let attempt = 0; attempt < 16; attempt++) {
        const angle = attempt / 16 * Math.PI * 2;
        const candidate = { col: baseCol + Math.cos(angle) * radius, row: baseRow + Math.sin(angle) * radius };
        if (pointIsOpen(zoneState, candidate.col, candidate.row, avoidPoints)) return candidate;
      }
    }
    if (avoidPoints?.length) return nearestOpenPoint(zoneState, col, row);
    return { col: baseCol, row: baseRow };
  }
  function randomPointAround(camp, origin, minRadius, maxRadius, rng = rand) {
    const angle = rng() * Math.PI * 2;
    const distance = minRadius + rng() * Math.max(0, maxRadius - minRadius);
    return nearestOpenPoint(camp.zoneState, origin.col + Math.cos(angle) * distance, origin.row + Math.sin(angle) * distance);
  }

  function propsForInstance(view, instance) {
    return (view?.objects || []).filter(object => object.temporaryLocaleInstanceId === instance?.id);
  }
  function centerForInstance(instance) {
    return instance ? { col: instance.site.x + instance.site.w * 0.5, row: instance.site.y + instance.site.h * 0.5 } : null;
  }
  function makeCamp(zoneState, instance, kind, residentTarget, seedLabel) {
    return {
      id: instance.id,
      kind,
      zoneId: zoneState.zoneId,
      zoneState,
      instance,
      props: propsForInstance(zoneState.view, instance),
      center: centerForInstance(instance),
      residentTarget,
      rng: seededRng(`${generationYear()}:${zoneState.zoneId}:${seedLabel}:residents`),
      hunters: [],
      huntingParty: null, // One small surface hunting group per camp; it follows a shared random den-to-den patrol route.
      huntingPartySeq: 0,
      propMeshes: new Map(),
      benchStationsRegistered: false,
      provokedUntilMs: 0,
      warningEnteredAtMs: 0,
      warningInitialShown: false,
      warningEscalated: false,
    };
  }

  function teardownEntity(hunter) {
    const entity = hunter?.entity;
    if (!entity) return;
    combatDeps.hostileObjects.delete(entity);
    window.BanditCombat.discardEntity(entity); // Canonical disposal also releases shadow, weapon-holder, ring, and trail resources.
    hunter.entity = null;
  }
  function clearCampMeshes(camp) {
    for (const entry of camp?.propMeshes?.values?.() || []) {
      if (entry.record) window.FoliageFurnitureRuntime?.unregisterExternalInstance?.(camp.zoneId, entry.record.id); // Releases the same player Sit actions registered when this log mesh loaded.
      if (entry.light) entry.light.parent?.remove?.(entry.light);
      if (entry.sharedFoliage) entry.mesh?.parent?.remove?.(entry.mesh);
      else disposeObject3D(entry.mesh);
    }
    camp?.propMeshes?.clear?.();
    if (camp) camp.benchStationsRegistered = false;
  }
  function teardownCamp(camp) {
    if (!camp) return;
    for (const hunter of camp.hunters) teardownEntity(hunter);
    clearCampMeshes(camp);
    camp.hunters.length = 0;
  }
  function teardownZone(zoneState) {
    if (!zoneState) return;
    for (const camp of zoneState.smallCamps) teardownCamp(camp);
    teardownCamp(zoneState.chiefCamp);
    buildGeneration += 1;
  }

  function smallCampCountForZone() {
    return MIN_HUNTING_CAMPS_PER_ZONE; // Exactly one per tribe and map, regardless of saved/older config overrides.
  }
  function smallResidentCount(zoneId, campIndex) {
    const small = cfg?.smallCamps || {};
    const rng = seededRng(`${generationYear()}:${zoneId}:${KEY}-small-${campIndex}:population`);
    return integerRoll(rng, num(small.minResidents, 2), num(small.maxResidents, 4));
  }

  function earlierTribes() {
    const index = tribeRuntimes.indexOf(api);
    return index < 0 ? [...tribeRuntimes] : tribeRuntimes.slice(0, index);
  } // Tribes created before this one already own their camp chunks in every zone.
  function banditCampAvoidChunks(zoneId) {
    const recs = window.BanditCamps?.campInstances?.get?.(zoneId);
    const keys = new Set();
    for (const rec of (recs || [])) for (const key of streamChunkKeysForSite(rec?.instance?.site)) keys.add(key);
    for (const rival of earlierTribes()) for (const key of rival.reservedCampChunks(zoneId)) keys.add(key);
    return [...keys];
  } // Prevents this tribe's reservations/hunting camps from touching any chunk already occupied by a bandit camp or an earlier tribe's camp.
  function reservedCampChunks(zoneId) {
    const zoneState = state.zones.get(zoneId);
    if (!zoneState) return [];
    const keys = new Set();
    if (zoneState.chiefReservation) for (const key of streamChunkKeysForSite(zoneState.chiefReservation.site)) keys.add(key);
    for (const camp of zoneState.smallCamps) for (const key of streamChunkKeysForSite(camp.instance?.site)) keys.add(key);
    return [...keys];
  } // Includes the inactive chief reservation so a later seasonal migration can never land in a bandit chunk.
  function reduceHuntingCampsForBandit(zoneId) {
    const zoneState = state.zones.get(zoneId);
    if (!zoneState?.smallCamps || zoneState.smallCamps.length <= MIN_HUNTING_CAMPS_PER_ZONE) return null;
    const camp = zoneState.smallCamps.pop(); // Deterministic sacrifice: newest surplus hunting-camp slot goes first when bandit placement needs room.
    teardownCamp(camp);
    window.TemporaryLocales?.release?.(zoneState.view, camp.instance);
    state.lastReason = `hunting-camp-reduced-for-bandits:${zoneId}:${camp.id}`;
    window.__farmLog?.(`[${KEY}] removed hunting camp ${camp.id} so a bandit or rival-tribe camp can keep its required chunk separation.`, 'wildlife');
    return camp.id;
  }

  function banditCampAvoidPoints(zoneId, minDistance) {
    if (!(minDistance > 0)) return [];
    const recs = window.BanditCamps?.campInstances?.get?.(zoneId);
    const sites = (recs || []).map(rec => rec?.instance?.site);
    for (const rival of earlierTribes()) sites.push(...rival.occupiedSites(zoneId), ...rival.reservedSites(zoneId)); // Rival tribes keep the same spacing a bandit camp gets.
    return sites.map(site => site ? { col: site.x + site.w * 0.5, row: site.y + site.h * 0.5, minDistance } : null).filter(Boolean);
  }
  function huntingCampPreferredPoint(zoneState, zoneId) {
    const view = zoneState.view; // This map's dimensions determine which pair of opposing edges are its "ends".
    const horizontal = view.cols >= view.rows; // Split the map along its longest axis for maximum tribe separation.
    const rivalSite = earlierTribes().flatMap(rival => rival.occupiedSites(zoneId))[0]; // Earlier tribe's hunting camp, never its inactive chief reservation.
    const axisLength = horizontal ? view.cols : view.rows; // End-to-end span used to choose the edge farthest from the rival.
    const rivalAxis = rivalSite ? (horizontal ? rivalSite.x + rivalSite.w / 2 : rivalSite.y + rivalSite.h / 2) : null; // Rival's site center on the long axis.
    const highEnd = rivalAxis == null ? earlierTribes().length > 0 : rivalAxis < axisLength / 2; // First tribe takes the low end; second takes the far end.
    return horizontal
      ? { col: highEnd ? view.cols : 0, row: rivalSite ? rivalSite.y + rivalSite.h / 2 : view.rows / 2 }
      : { col: rivalSite ? rivalSite.x + rivalSite.w / 2 : view.cols / 2, row: highEnd ? view.rows : 0 };
  }

  function stampHuntingCamp(zoneState, zoneId, campIndex, minimumFallback = false) {
    if (!zoneState?.view || !smallLocaleDef) return null;
    const instanceId = minimumFallback
      ? `${KEY}_small_${zoneId}_minimum`
      : `${KEY}_small_${zoneId}_${campIndex}`; // Distinct fallback id makes the one-camp guarantee visible in diagnostics/tests.
    const instance = window.TemporaryLocales.stamp(zoneState.view, smallLocaleDef, {
      rng: seededRng(`${generationYear()}:${zoneId}:${KEY}-small-site:${minimumFallback ? 'minimum' : campIndex}`),
      preferredPoint: huntingCampPreferredPoint(zoneState, zoneId), // Rank legal camp sites toward the assigned end; all hard exclusions still apply.
      clearableTypes: new Set(),
      minimumCampRequired: minimumFallback,
      clearanceTiles: minimumFallback ? 0 : (smallLocaleDef.placement?.clearanceTiles ?? 2),
      requiresFlatGround: minimumFallback ? false : (smallLocaleDef.placement?.requiresFlatGround !== false),
      minDistanceFromEntry: minimumFallback ? 0 : (smallLocaleDef.placement?.minDistanceFromEntry ?? 10),
      avoidPoints: minimumFallback ? [] : banditCampAvoidPoints(zoneId, smallLocaleDef.placement?.minDistanceFromBanditCamp ?? 12),
      avoidChunks: banditCampAvoidChunks(zoneId),
      chunkSizeTiles: streamChunkSizeTiles(),
      instanceId,
    });
    if (!instance) return null;
    const camp = makeCamp(zoneState, instance, 'small', smallResidentCount(zoneId, campIndex), `small-${minimumFallback ? 'minimum' : campIndex}`);
    zoneState.smallCamps.push(camp);
    state.stamps += 1;
    return camp;
  } // Minimum fallback relaxes only soft terrain/spacing rules; bandit stream chunks remain hard exclusions.

  function buildZoneCamps(zoneId, layout) {
    const view = buildZoneView(zoneId, layout);
    if (!view) return null;
    const zoneState = {
      zoneId,
      layoutRef: layout,
      view,
      chiefReservation: null,
      chiefCamp: null,
      smallCamps: [],
    };

    zoneState.chiefReservation = window.TemporaryLocales.stamp(view, chiefLocaleDef, {
      rng: seededRng(`${generationYear()}:${zoneId}:${KEY}-chief-site`),
      clearableTypes: new Set(),
      clearanceTiles: chiefLocaleDef.placement?.clearanceTiles ?? 3,
      requiresFlatGround: chiefLocaleDef.placement?.requiresFlatGround !== false,
      minDistanceFromEntry: chiefLocaleDef.placement?.minDistanceFromEntry ?? 14,
      avoidPoints: banditCampAvoidPoints(zoneId, chiefLocaleDef.placement?.minDistanceFromBanditCamp ?? 16),
      avoidChunks: banditCampAvoidChunks(zoneId),
      chunkSizeTiles: streamChunkSizeTiles(),
      instanceId: `${KEY}_chief_reservation_${zoneId}`,
    });
    if (zoneState.chiefReservation) state.stamps += 1;

    const targetCount = smallCampCountForZone(zoneId); // Shared single-camp cap, still used by the protected minimum fallback.
    stampHuntingCamp(zoneState, zoneId, 0, false); // No additional or rival-slot-replacement hunting camps.
    if (zoneState.smallCamps.length < MIN_HUNTING_CAMPS_PER_ZONE) {
      stampHuntingCamp(zoneState, zoneId, targetCount, true); // Exhaustive zero-clearance/non-flat fallback prevents an unlucky zone from ending up camp-less.
    }
    if (zoneState.smallCamps.length < MIN_HUNTING_CAMPS_PER_ZONE) {
      state.lastReason = `hunting-camp-minimum-placement-failed:${zoneId}`;
      window.__farmLog?.(`[${KEY}] ERROR: zone "${zoneId}" has no legal hunting-camp site even after the minimum fallback.`, 'warn');
    }
    state.zones.set(zoneId, zoneState);
    registerTentCollisionProvider(zoneId); // The shared sub-tile blocker now follows both tribes' live camp footprints, including seasonal chief migration.
    return zoneState;
  }

  function ensureZoneState(zoneId) {
    const layout = combatDeps?.zoneLayouts?.get?.(zoneId);
    if (!layout || !window.TemporaryLocales || !smallLocaleDef || !chiefLocaleDef) return null;
    const prior = state.zones.get(zoneId);
    if (prior?.layoutRef === layout) return prior;
    if (earlierTribes().some(rival => !rival.ensureZoneState(zoneId))) return null; // Earlier tribes place first so this tribe can avoid their camps.
    if (prior) teardownZone(prior);
    state.zones.delete(zoneId);
    return buildZoneCamps(zoneId, layout);
  }

  function activateChiefCamp(zoneState) {
    if (!zoneState?.chiefReservation) return null;
    if (zoneState.chiefCamp) return zoneState.chiefCamp;
    const count = Math.max(1, Math.floor(num(cfg?.chiefCamp?.generatedResidents, 6)));
    zoneState.chiefCamp = makeCamp(zoneState, zoneState.chiefReservation, 'chief', count, 'chief');
    return zoneState.chiefCamp;
  }
  function deactivateChiefCamp(zoneState) {
    if (!zoneState?.chiefCamp) return;
    teardownCamp(zoneState.chiefCamp);
    zoneState.chiefCamp = null;
  }
  function syncChiefCamp() {
    const season = currentSeasonName();
    const desiredZone = desiredChiefZone(season);
    if (!desiredZone) return;
    const changed = state.chiefZoneId !== desiredZone || state.chiefSeason !== season;
    if (changed && state.chiefZoneId) deactivateChiefCamp(state.zones.get(state.chiefZoneId));
    state.chiefZoneId = desiredZone;
    state.chiefSeason = season;
    const zoneState = ensureZoneState(desiredZone);
    if (zoneState) activateChiefCamp(zoneState);
    if (changed) {
      state.chiefBehaviorKey = null;
      state.lastReason = `chief-migrated:${season}:${desiredZone}`;
    }
  }
  function ensureWorldCamps() {
    if (!cfg || !combatDeps || !smallLocaleDef || !chiefLocaleDef || !window.TemporaryLocales) return false;
    for (const zoneId of (cfg.wildernessZones || [])) ensureZoneState(zoneId);
    syncChiefCamp();
    return state.zones.size > 0;
  }

  function activeCamps(zoneState) {
    return zoneState ? [...zoneState.smallCamps, ...(zoneState.chiefCamp ? [zoneState.chiefCamp] : [])] : [];
  }
  function currentZoneState() { return state.zones.get(currentArea()) || null; }

  function tentWallsBlockBox(prop, x, z, half = 0) {
    const w = Math.max(1, num(prop.w, 2)), h = Math.max(1, num(prop.h, 2)); // Cheap footprint rejection precedes any canvas wall tests.
    const left = prop.x, top = prop.y; // World-space tent origin used by the cached wall rectangles.
    if (x + half <= left || x - half >= left + w || z + half <= top || z - half >= top + h) return false;
    let walls = prop._tentCollisionWalls; // Per-stamped-tent geometry cache avoids creating collision-probe closures/rectangles on every NPC movement step.
    if (!walls) {
      const right = left + w, bottom = top + h, t = 0.16; // Thin solid canvas perimeter with an entrance facing the central bonfire.
      const front = ((Math.round(num(prop.rot, 0) / 90) % 4) + 4) % 4; // HousePieceGen yaw: 0=+row, 1=+col, 2=-row, 3=-col.
      const cx = left + w * 0.5, cz = top + h * 0.5; // Entrance opening center aligned to the authored front panel.
      const gapX = Math.min(w * 0.43, 0.85), gapZ = Math.min(h * 0.43, 0.85); // Wide enough for the NPC sleeping waypoint inside each 2x2 tent.
      walls = []; // Collision rectangles [[minX,minZ,maxX,maxZ]] checked without allocating closures in the hot path.
      const horizontal = (row, entrance) => {
        if (!entrance) walls.push([left, row, right, row + t]);
        else walls.push([left, row, cx - gapX, row + t], [cx + gapX, row, right, row + t]);
      };
      const vertical = (col, entrance) => {
        if (!entrance) walls.push([col, top, col + t, bottom]);
        else walls.push([col, top, col + t, cz - gapZ], [col, cz + gapZ, col + t, bottom]);
      };
      horizontal(top, front === 2);
      horizontal(bottom - t, front === 0);
      vertical(left, front === 3);
      vertical(right - t, front === 1);
      Object.defineProperty(prop, '_tentCollisionWalls', { value: walls, configurable: true }); // Cache belongs to this immutable stamped prop, not the shared authored locale data.
    }
    for (const rect of walls) {
      if (x + half > rect[0] && x - half < rect[2] && z + half > rect[1] && z - half < rect[3]) return true;
    }
    return false;
  }

  function registerTentCollisionProvider(zoneId) {
    if (!window.AreaFootprintBlockers?.register) return false;
    window.AreaFootprintBlockers.register(`${KEY}-camp-tents:${zoneId}`, {
      area: zoneId,
      blocksBox(x, z, half = 0, worldY = null) {
        const zoneState = state.zones.get(zoneId); // The latest generated camp layout, not a captured stale seasonal reservation.
        if (!zoneState) return false;
        const smallCamps = zoneState.smallCamps; // Reuses the existing camp array, avoiding per-probe activeCamps() allocations during NPC pathfinding.
        for (let index = 0; index <= smallCamps.length; index++) {
          const camp = index < smallCamps.length ? smallCamps[index] : zoneState.chiefCamp; // Seasonal chief is the optional final active camp.
          if (!camp) continue;
          for (const prop of camp.props) {
            if (prop.type !== 'tent' || prop.destroyed || !tentWallsBlockBox(prop, x, z, half)) continue;
            if (worldY != null) {
              const grid = combatDeps?.zoneScenes?.get?.(zoneId)?.grid || (currentArea() === zoneId ? combatDeps?.getActiveGrid?.() : null); // High projectiles still clear the canvas roof.
              const col = Math.floor(prop.x + Math.max(1, num(prop.w, 2)) * 0.5);
              const row = Math.floor(prop.y + Math.max(1, num(prop.h, 2)) * 0.5);
              const tile = grid?.[row]?.[col];
              const groundY = tile && combatDeps?.tileSurfaceYInArea ? num(combatDeps.tileSurfaceYInArea(tile, zoneId), 0) : 0;
              if (worldY > groundY + 1.275 * TENT_HEIGHT_SCALE) continue;
            }
            return true;
          }
        }
        return false;
      },
    });
    return true;
  }

  function reservedSites(zoneId) {
    const zoneState = state.zones.get(zoneId);
    if (!zoneState) return [];
    return [zoneState.chiefReservation, ...zoneState.smallCamps.map(camp => camp.instance)].map(instance => instance?.site).filter(Boolean);
  } // Every stamped footprint, including the inactive chief reservation.
  function occupiedSites(zoneId) {
    const zoneState = state.zones.get(zoneId);
    return activeCamps(zoneState).map(camp => {
      const site = camp?.instance?.site;
      return site ? { x:num(site.x, 0), y:num(site.y, 0), w:Math.max(1, num(site.w, 1)), h:Math.max(1, num(site.h, 1)) } : null;
    }).filter(Boolean);
  } // Exact live temporary-locale footprints used by other ecology systems that must not spawn through a Porakaneki camp.

  function tentCanvasTexture() {
    if (tentCanvasTextureCache) return tentCanvasTextureCache;
    tentCanvasTextureCache = new THREE.TextureLoader().load(
      'assets/textures/canvas.png',
      texture => {
        texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.needsUpdate = true;
      },
      undefined,
      () => window.__farmLog?.(`[${KEY}] canvas.png failed to load; tents are using the canvas-color fallback.`, 'warn', 'wildlife'),
    );
    tentCanvasTextureCache.wrapS = tentCanvasTextureCache.wrapT = THREE.ClampToEdgeWrapping;
    if ('colorSpace' in tentCanvasTextureCache && THREE.SRGBColorSpace) tentCanvasTextureCache.colorSpace = THREE.SRGBColorSpace;
    return tentCanvasTextureCache;
  }
  function tentMesh(prop, elevationY) {
    if (!tentPiece || !prop || !window.HousePieceGen?.buildGroupFromPiece) return null;
    const centerCol = prop.x + (prop.w || 1) * 0.5; // Used to preserve authored House Editor transforms relative to the camp footprint.
    const centerRow = prop.y + (prop.h || 1) * 0.5; // Used with centerCol so the outer prop group remains centered for runtime systems.
    const authored = window.HousePieceGen.buildGroupFromPiece(THREE, tentPiece, prop.x, prop.y, {
      elevationY,
      rotationDeg: prop.rot || 0,
      matCanvas: new THREE.MeshLambertMaterial({ color: 0x8b7656, map: tentCanvasTexture(), side: THREE.DoubleSide }),
      matDoorOpening: new THREE.MeshBasicMaterial({ color: 0x18130f, side: THREE.DoubleSide }),
    });
    authored.position.set(-centerCol, -elevationY, -centerRow);
    const group = new THREE.Group();
    group.add(authored);
    group.scale.y = TENT_HEIGHT_SCALE; // Group origin is the ground under the tent center, so only the roof height changes.
    group.userData.projectileCoverHeightTiles = 1.275 * TENT_HEIGHT_SCALE;
    group.userData.projectileCoverRadiusTiles = 1.0;
    group.userData.projectileCoverKind = `${KEY}-tent`;
    return group;
  }
  function crateMesh() {
    const group = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.65, 0.75), new THREE.MeshLambertMaterial({ color: 0x6b4d2c }));
    box.position.y = 0.325;
    box.castShadow = true;
    group.add(box);
    return group;
  }
  function fireMesh(key = 'campfire') {
    const built = window.ProceduralFurniture?.buildFurnitureGroup?.(key, 0x6b4a28); // Reuses the same furniture catalog as ordinary placed campfires/bonfires.
    if (built) return built;
    const group = new THREE.Group(); // Fallback keeps the camp visible if procedural furniture has not initialized yet.
    const isBonfire = key === BONFIRE_KEY; // Used below to keep the fallback proportionate to the requested large fire.
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(isBonfire ? 0.38 : 0.18, isBonfire ? 0.9 : 0.48, 6),
      new THREE.MeshBasicMaterial({ color: 0xff8a22 }),
    );
    flame.position.y = isBonfire ? 0.45 : 0.25;
    group.add(flame);
    return group;
  }

  function benchRecordForProp(camp, prop) {
    const width = Math.max(1, num(prop?.w, 2)); // Used to preserve the stamped log's rotated footprint center.
    const depth = Math.max(1, num(prop?.h, 1)); // Used with width for the exact wilderness-furniture placement record.
    return {
      id: `${camp.id}:${prop.id}`,
      mapId: camp.zoneId,
      sourceObjectType: 'fallenLog',
      furnitureKey: BENCHLOG_KEY,
      col: prop.x,
      row: prop.y,
      footprintW: width,
      footprintD: depth,
      centerX: prop.x + width * 0.5,
      centerZ: prop.y + depth * 0.5,
      yawDeg: num(prop.rot, 0),
      elevTier: 0,
    };
  }

  function registerCampBenchStations(camp) {
    if (camp?.benchStationsRegistered) return camp.props.filter(prop => prop.key === BENCHLOG_KEY).length * 2;
    if (!window.NpcScheduling?.registerNpcStations || !camp?.props?.length) return 0;
    const stations = []; // Registered below so ordinary NPC free-time AI can discover these logs through role:'sit'.
    for (const prop of camp.props) {
      if (prop.key !== BENCHLOG_KEY) continue;
      const record = benchRecordForProp(camp, prop); // Supplies the same placement center/yaw as the rendered wilderness log.
      for (let seatIndex = 0; seatIndex < 2; seatIndex++) {
        stations.push({
          id: `${KEY}_bench_${camp.id}_${prop.id}_${seatIndex}`,
          label: camp.kind === 'chief' ? 'Council Sitting Log' : 'Hunting Camp Sitting Log',
          area: camp.zoneId,
          c: record.col,
          r: record.row,
          rotY: record.yawDeg,
          pose: 'sit',
          roles: ['sit', `${KEY}-camp-rest`],
          furnitureKey: BENCHLOG_KEY,
          seatIndex,
        });
      }
    }
    if (stations.length) {
      window.NpcScheduling.registerNpcStations(stations, camp.zoneId);
      camp.benchStationsRegistered = true;
    }
    return stations.length;
  }

  function queueBenchLogMesh(camp, prop, zone, elevationY, failures = 0) {
    if (!window.FoliageFurnitureRenderer?.buildInstance) return;
    const record = benchRecordForProp(camp, prop); // Used by the shared wilderness-log renderer so camps do not duplicate log geometry.
    const generation = buildGeneration; // Used after the async V27 build to discard logs from a torn-down/rebuilt wilderness generation.
    const entry = { mesh: null, light: null, pending: true, record, failures, retryAtMs: 0 };
    camp.propMeshes.set(prop.id, entry);
    Promise.resolve().then(() => window.FoliageFurnitureRenderer.buildInstance(record, camp.zoneState?.layoutRef, {
      PLATEAU_UNIT: combatDeps?.PLATEAU_UNIT,
      NORMAL_TOP: combatDeps?.NORMAL_TOP,
    })).then(({ instance, data }) => {
      const liveEntry = camp.propMeshes.get(prop.id); // Used to ensure this result still belongs to the current camp before publishing it.
      if (generation !== buildGeneration || liveEntry !== entry || currentArea() !== camp.zoneId) {
        instance.parent?.remove?.(instance);
        return;
      }
      instance.position.set(record.centerX, elevationY, record.centerZ);
      instance.userData.porakanekiCampBench = true;
      instance.userData.porakanekiCampId = camp.id;
      markOutline(instance);
      zone.scene.add(instance);
      window.FoliageFurnitureRuntime?.registerExternalInstance?.(camp.zoneId, record, data, instance); // Shared wilderness seating buttons and anchors, not just NPC schedule stations.
      camp.propMeshes.set(prop.id, { mesh: instance, light: null, pending: false, record, data, sharedFoliage: true });
    }).catch(error => {
      if (generation !== buildGeneration || camp.propMeshes.get(prop.id) !== entry) return;
      entry.pending = false;
      entry.failures++;
      entry.retryAtMs = performance.now() + Math.min(60000, 2000 * 2 ** Math.min(5, entry.failures - 1));
      window.__farmLog?.(`[${KEY}] bench log failed (${prop.id}): ${error?.message || error}`, 'warn', 'wildlife');
    });
  }

  function ensureCampMeshes(camp) {
    const zone = combatDeps?.zoneScenes?.get?.(camp.zoneId); // Supplies the active Three.js scene for camp props.
    if (!zone?.scene || currentArea() !== camp.zoneId) return;
    registerCampBenchStations(camp);
    for (const prop of camp.props) {
      const prior = camp.propMeshes.get(prop.id); // Used to avoid rebuilding both sync props and pending async bench logs every camp tick.
      if (prior?.mesh?.parent === zone.scene || prior?.pending) continue;
      if (prior?.retryAtMs > performance.now()) continue;
      if (prior) {
        if (prior.light) prior.light.parent?.remove?.(prior.light);
        if (prior.record) window.FoliageFurnitureRuntime?.unregisterExternalInstance?.(camp.zoneId, prior.record.id); // Avoid stale seat hitboxes during asynchronous mesh retries.
        if (prior.sharedFoliage) prior.mesh?.parent?.remove?.(prior.mesh); // Foliage's cloned prototype shares cached V27 geometry; never dispose that shared geometry on a scene rebuild.
        else disposeObject3D(prior.mesh);
        camp.propMeshes.delete(prop.id);
      }
      const col = prop.x + (prop.w || 1) * 0.5; // Runtime center used by fire/crate meshes and terrain sampling.
      const row = prop.y + (prop.h || 1) * 0.5; // Runtime center paired with col.
      const grid = combatDeps.getActiveGrid?.(); // Used below to place the prop on the live terrain surface.
      const tile = grid?.[Math.floor(row)]?.[Math.floor(col)]; // Used to resolve the exact surface elevation under this prop.
      const elevationY = tile && combatDeps.tileSurfaceYInArea ? num(combatDeps.tileSurfaceYInArea(tile, camp.zoneId), 0) : 0; // Shared world-space surface height for all camp props.

      if (prop.key === BENCHLOG_KEY) {
        queueBenchLogMesh(camp, prop, zone, elevationY, prior?.failures || 0);
        continue;
      }

      const isBonfire = prop.key === BONFIRE_KEY; // Used to select the large shared fire and its wider light radius.
      let mesh = prop.type === 'tent' ? tentMesh(prop, elevationY) : (isBonfire || prop.key === 'campfire') ? fireMesh(prop.key) : crateMesh(); // Keeps tent/fire/crate routing centralized.
      if (!mesh) continue;
      mesh.position.set(col, elevationY, row);
      markOutline(mesh);
      zone.scene.add(mesh);
      let light = null; // Stored with the mesh so teardown removes the matching fire light.
      if (isBonfire || prop.key === 'campfire') {
        light = new THREE.PointLight(0xff7722, isBonfire ? 1.75 : 1.1, isBonfire ? 7.5 : 3.2);
        light.position.set(col, elevationY + (isBonfire ? 0.8 : 0.45), row);
        light.userData.furnitureLightMask = true; // Local lights only show through the 2D fake-light overlay, same as bandit campfires.
        window.FurnitureLightRegistry?.register(light);
        zone.scene.add(light);
      }
      camp.propMeshes.set(prop.id, { mesh, light, pending: false });
    }
  }
  function ensureCurrentCampMeshes() {
    const zoneState = currentZoneState();
    for (const camp of activeCamps(zoneState)) ensureCampMeshes(camp);
  }

  function tentCenters(camp) {
    return (camp?.props || []).filter(prop => prop.type === 'tent').map(prop => ({ col: prop.x + (prop.w || 1) * 0.5, row: prop.y + (prop.h || 1) * 0.5 }));
  }

  function getNearbyGiftWalker(x, z, radius = 2) {
    if (window.NpcRapport?.canGiftToday?.(CHIEF_ID) === false) return null;
    let closest = null; // Reuses cached hunter proxies so the action bar does not refresh every frame.
    let distance = radius; // The nearest named NPC already limits this search radius.
    for (const camp of activeCamps(currentZoneState())) for (const hunter of camp.hunters) {
      const entity = hunter.entity; // Only living, visible, neutral residents can accept a gift.
      if (!entity || entity.health <= 0 || entity._porakanekiPlannerControlled !== true || entity._chunkCombatTarget || !entity.avatarRef?.group?.visible || entity.areaId !== currentArea()) continue;
      const nextDistance = Math.hypot(entity.x / combatDeps.TILE - x, entity.y / combatDeps.TILE - z); // Matches named NPC interaction distances.
      if (nextDistance >= distance) continue;
      distance = nextDistance;
      entity._porakanekiGiftWalker ||= { rec: { ...entity.rosterRecord, id: hunter.id, name: `${LABEL} Hunter`, species: SPECIES_ID }, isTribeHunter: true, tribeId: KEY, isPorakanekiHunter: KEY === 'porakaneki' }; // Cached interaction-only proxy shares the actual hunter root.
      entity._porakanekiGiftWalker.root = entity.avatarRef.group;
      entity._porakanekiGiftWalker.area = entity.areaId;
      closest = entity._porakanekiGiftWalker;
    }
    return closest;
  }

  function chiefWalker() {
    const id = cfg?.reputation?.npcId || CHIEF_ID;
    return schedulingDeps?.npcWalkers?.find?.(walker => walker?.rec?.id === id) || null;
  }
  function authorChiefBehavior() {
    const camp = state.zones.get(state.chiefZoneId)?.chiefCamp;
    const walker = chiefWalker();
    if (!camp || !walker?.rec || !window.NpcScheduling?.registerNpcStations) return false;
    const key = `${state.chiefSeason}:${camp.id}:${camp.center.col.toFixed(2)}:${camp.center.row.toFixed(2)}`;
    if (state.chiefBehaviorKey === key && walker.rec.scheduleHooks?.__porakanekiCampRuntime) return true;

    const role = `${KEY}-chief-sleep`;
    registerCampBenchStations(camp);
    window.NpcScheduling.registerNpcStations(tentCenters(camp).map((tent, index) => ({
      id: `${KEY}_chief_sleep_${camp.zoneId}_${index}`,
      label: `${LABEL} Chief Camp Tent`,
      area: camp.zoneId,
      c: tent.col,
      r: tent.row,
      pose: 'lie',
      roles: [role],
    })), camp.zoneId);

    walker.rec.gender = 'male';
    walker.rec.species = SPECIES_ID;
    walker.rec.appearance = { ...(walker.rec.appearance || {}), speciesId: SPECIES_ID, gender: 'male' };
    walker.rec.scheduleHooks = {
      ...(walker.rec.scheduleHooks || {}),
      defaultMapId: camp.zoneId,
      defaultPosition: { c: camp.center.col, r: camp.center.row },
      __porakanekiCampRuntime: true,
      rules: [],
    };
    walker.rec.agenda = [
      { id: `${KEY}_sleep_late`, activity: 'goToRole', obligation: 'plan', window: ['22:00', '23:59'], destinationRole: role, destinationArea: camp.zoneId, activityLabel: 'sleeping' },
      { id: `${KEY}_sleep_early`, activity: 'goToRole', obligation: 'plan', window: ['00:00', '06:00'], destinationRole: role, destinationArea: camp.zoneId, activityLabel: 'sleeping' },
      { id: `${KEY}_day`, activity: 'break', obligation: 'leisure', window: ['06:00', '22:00'], destinationArea: camp.zoneId, activityLabel: 'around the chief camp' },
    ];
    state.chiefBehaviorKey = key;
    return true;
  }

  function relationshipState() {
    const id = cfg?.reputation?.npcId || CHIEF_ID;
    return window.DialogueContent?.getNpcDlgState?.(id) || window.DialogueContent?.npcDlgState?.get?.(id) || null;
  }
  function memoryHas(relation, event) { return !!relation?.memory?.some?.(entry => entry?.event === event || entry?.type === event); }
  function pushMemory(relation, event) {
    if (!relation) return;
    relation.memory ||= [];
    relation.memory.push({ event, day: gameDay(), ts: Date.now() });
    if (relation.memory.length > 50) relation.memory.shift();
  }
  function initializeReputation() {
    const relation = relationshipState();
    if (!relation) return false;
    const rep = cfg?.reputation || {};
    const marker = rep.initializationMemoryEvent || `${KEY}_faction_initialized`;
    if (memoryHas(relation, marker)) return true;
    const current = Number(relation.favor);
    if (!Number.isFinite(current) || current === 0) relation.favor = num(rep.initialFavor, -3);
    relation.favor = clamp(num(relation.favor, -3), num(rep.minimumFavor, -5), num(rep.maximumFavor, 10));
    pushMemory(relation, marker);
    state.lastReason = `reputation-initialized:${relation.favor}`;
    return true;
  }
  function favor() { initializeReputation(); return num(relationshipState()?.favor, 0); }
  function peacefulRapport() {
    return num(window.NpcRapport?.get?.(cfg?.reputation?.npcId || CHIEF_ID), 0) > 0;
  }
  function adjustFavor(amount, reason) {
    const relation = relationshipState();
    if (!relation || !amount) return favor();
    const rep = cfg?.reputation || {};
    relation.favor = clamp(num(relation.favor, 0) + amount, num(rep.minimumFavor, -5), num(rep.maximumFavor, 10));
    pushMemory(relation, reason);
    window.WorldPopupText?.queueReward?.('favor', `${amount > 0 ? '+' : '-'}${Math.abs(amount)} ${LABEL} Favor`);
    return relation.favor;
  }

  function chooseLine(lines) {
    if (!Array.isArray(lines) || !lines.length) return '';
    return lines[Math.floor(rand() * lines.length)] || lines[0];
  }
  function speakOverheadFromWalker(walker, text, options = {}) {
    if (text && walker?.root && window.AmbientDialogue?.show) {
      const shown = window.AmbientDialogue.show(walker.root, text, {
        speakerId: walker.rec?.id || CHIEF_ID,
        profile: walker.profile,
        mode: 'chathead',
        tone: options.tone || 'greeting',
      });
      if (shown) return true;
    }
    if (text && options.allowToastFallback !== false) combatDeps.showToast?.(text, options.important !== false);
    return false;
  }
  function speakOverheadFromHunter(hunter, text, options = {}) {
    const entity = hunter?.entity;
    const anchor = entity?.avatarRef?.group;
    if (text && anchor?.visible && entity.areaId === hunter?.camp?.zoneId && window.AmbientDialogue?.show) {
      const profile = window.NpcAvatarPreview?.buildProfileFromNpcExport?.(entity.rosterRecord) || null;
      const shown = window.AmbientDialogue.show(anchor, text, {
        speakerId: entity.id,
        profile,
        mode: profile ? 'chathead' : 'overhead',
        tone: options.tone || 'greeting',
      });
      if (shown) return true;
    }
    if (text && options.allowToastFallback !== false) combatDeps.showToast?.(text, options.important !== false);
    return false;
  }
  function speakerHunterFor(camp) {
    const player = playerTilePosition();
    const candidates = (camp?.hunters || []).filter(hunter => {
      const entity = hunter?.entity;
      return entity?.health > 0 && entity.areaId === camp.zoneId && !!entity.avatarRef?.group?.visible;
    });
    if (!candidates.length) return null;
    if (!player) return candidates[0];
    candidates.sort((a, b) => Math.hypot(a.x - player.col, a.y - player.row) - Math.hypot(b.x - player.col, b.y - player.row));
    return candidates[0];
  }
  function resetCampWarning(camp) {
    if (!camp) return;
    camp.warningEnteredAtMs = 0;
    camp.warningInitialShown = false;
    camp.warningEscalated = false;
  }
  function updateTerritoryWarnings() {
    const rep = cfg?.reputation || {};
    const currentFavor = favor();
    const zoneState = currentZoneState();
    const camps = activeCamps(zoneState);
    if (!zoneState || !combatDeps?.player || peacefulRapport() || currentFavor >= 0 || currentFavor <= num(rep.attackOnSightFavor, -5)) {
      for (const camp of camps) resetCampWarning(camp);
      return;
    }
    const playerCol = combatDeps.player.x / combatDeps.TILE, playerRow = combatDeps.player.y / combatDeps.TILE;
    let nearest = null, nearestDistance = Infinity;
    for (const camp of camps) {
      const distance = Math.hypot(playerCol - camp.center.col, playerRow - camp.center.row);
      if (distance < nearestDistance) { nearest = camp; nearestDistance = distance; }
    }
    for (const camp of camps) if (camp !== nearest) resetCampWarning(camp);
    if (!nearest || nearestDistance > num(rep.warningRadiusTiles, 10)) { resetCampWarning(nearest); return; }

    // A warning is not considered delivered until a real materialized hunter
    // successfully owns an Ambient Dialogue bubble. This avoids the old race
    // where territory detection ran before async materialization, consumed the
    // one-shot flag, and permanently degraded the warning to a HUD toast.
    if (!nearest.warningInitialShown) {
      const text = chooseLine(rep.initialWarnings);
      const speaker = speakerHunterFor(nearest);
      if (text && speaker && speakOverheadFromHunter(speaker, text, { tone: 'warning', important: false, allowToastFallback: false })) {
        nearest.warningInitialShown = true;
        nearest.warningEnteredAtMs = nowMs();
      }
      return;
    }
    if (!nearest.warningEscalated && nowMs() - nearest.warningEnteredAtMs >= num(rep.warningStaySeconds, 10) * 1000) {
      const text = chooseLine(rep.escalationWarnings);
      const speaker = speakerHunterFor(nearest);
      if (text && speaker && speakOverheadFromHunter(speaker, text, { tone: 'warning', important: false, allowToastFallback: false })) nearest.warningEscalated = true;
    }
  }

  function maybeChiefGreeting() {
    if (favor() < num(cfg?.reputation?.greetingFavorThreshold, 1) || currentArea() !== state.chiefZoneId) return;
    const walker = chiefWalker();
    if (!walker?.root || walker.area !== currentArea() || !combatDeps?.player) return;
    const distance = Math.hypot(walker.root.position.x - combatDeps.player.x / combatDeps.TILE, walker.root.position.z - combatDeps.player.y / combatDeps.TILE);
    if (distance > num(cfg?.reputation?.greetingRadiusTiles, 3)) return;
    const marker = `${KEY}_chief_greet_day_${gameDay()}`;
    const relation = relationshipState();
    if (!relation || memoryHas(relation, marker)) return;
    pushMemory(relation, marker);
    const text = chooseLine(cfg?.reputation?.greetingLines) || `The ${LABEL} chief greets you.`;
    speakOverheadFromWalker(walker, text, { tone: 'greeting' });
    state.greetings += 1;
  }

  // Kept for debug/test compatibility with older snapshots; chunk equality is
  // no longer the LOD gate. The real gate below is radial and hysteretic.
  function chunkSizeTiles() { return Math.max(2, Math.floor(num(cfg?.behavior?.fullSimulationChunkTiles, 10))); }
  function chunkOf(col, row) {
    const size = chunkSizeTiles();
    return { x: Math.floor(col / size), y: Math.floor(row / size) };
  }
  function fullSimulationRadiusTiles() {
    return Math.max(2, num(cfg?.behavior?.fullSimulationRadiusTiles, chunkSizeTiles() * 1.2));
  }
  function fullSimulationReleaseRadiusTiles() {
    const enter = fullSimulationRadiusTiles();
    return Math.max(enter + 0.5, num(cfg?.behavior?.fullSimulationReleaseRadiusTiles, enter + 4));
  }
  function detailedEntityActive(hunter) {
    const entity = hunter?.entity;
    return !!entity && entity.areaId === hunter.camp.zoneId && !!entity.avatarRef?.group?.visible;
  }
  function simulationDistanceToPlayer(hunter) {
    if (!hunter || currentArea() !== hunter.camp.zoneId) return Infinity;
    const player = playerTilePosition();
    if (!player) return Infinity;
    return Math.hypot(hunter.x - player.col, hunter.y - player.row);
  }

  function sharesPlayerChunk(hunter) {
    const distance = simulationDistanceToPlayer(hunter);
    if (!Number.isFinite(distance)) return false;
    const playerChunk = playerStreamChunk();
    const hunterChunk = streamChunkOfTile(hunter.x, hunter.y);
    if (sameStreamChunk(playerChunk, hunterChunk)) return true; // Everything in the player's own streamed chunk is live, even at its far corners.
    // Once live, keep the resident live until the wider release radius. That
    // prevents edge oscillation/rebuild thrash; faction fights cover the same
    // release radius (entityInPlayerEcologyRange).
    return distance <= (detailedEntityActive(hunter) ? fullSimulationReleaseRadiusTiles() : fullSimulationRadiusTiles());
  }


  function weaponRoll(rng = rand) {
    const shapes = Array.isArray(cfg?.equipment?.weaponShapes) && cfg.equipment.weaponShapes.length ? cfg.equipment.weaponShapes : ['fishingspear', 'hatchet', 'dagger'];
    return shapes[Math.floor(rng() * shapes.length)] || shapes[0];
  }
  function weaponDef(shapeKey) {
    const metalKey = cfg?.equipment?.weaponMetalKey || 'nativeCopper';
    const shape = combatDeps?.HELD_SHAPE_DEFS?.[shapeKey] || {};
    return {
      shapeKey,
      metalKey,
      weaponKey: combatDeps?.craftedToolItemKey?.(shapeKey, metalKey) || shapeKey,
      attackTag: shape.dmgType || 'sharp',
      ranged: shapeKey === 'dagger',
    };
  }
  function randomCampPoint(camp, rng = rand) {
    const radius = num(cfg?.behavior?.campSocialRadiusTiles, 8);
    return randomPointAround(camp, camp.center, 1.5, radius, rng);
  }
  function makeResident(camp, id, rng, extra = null) {
    const index = camp.hunters.length;
    const spawn = randomCampPoint(camp, rng);
    camp.hunters.push({
      id,
      index,
      camp,
      weaponShape: weaponRoll(rng),
      x: spawn.col,
      y: spawn.row,
      activity: 'camp',
      target: null,
      decisionT: rng() * 2,
      entity: null,
      building: false,
      dormantSinceMs: null,
      sleepDay: -1,
      sleepPoint: null,
      greetingDay: -1,
      lastHealth: null,
      killCounted: false,
      ...extra,
    });
  }
  function ensureCampHunters(camp) {
    if (!camp?.center) return;
    while (camp.hunters.length < camp.residentTarget) makeResident(camp, `${camp.id}:resident:${camp.hunters.length}`, camp.rng);
    if (!camp.avengerBand && isAvengerHome(camp)) seedAvengerBand(camp);
  }

  function gameClockHours() { return gameDay() * 24 + gameHour(); } // Monotonic game time for short reprieves that may cross midnight.
  function avengerCfg() { return cfg?.avengers && cfg.avengers.enabled !== false ? cfg.avengers : null; }
  function isAvenger(hunter) { return hunter?.role === 'avenger'; }
  function isAvengerHome(camp) { return !!avengerCfg() && camp?.kind === 'small' && camp.zoneState?.smallCamps?.[0] === camp; }
  function seedAvengerBand(camp) {
    const av = avengerCfg();
    const rng = seededRng(`${generationYear()}:${camp.id}:avengers`); // Own stream so the band never reshuffles the residents' party rolls.
    camp.avengerBand = { quarry: null, patrolTarget: null, routeStep: 0, kills: 0, losses: 0, escapes: 0, withdrawals: 0,
      retreatUntil: -Infinity, lastEscapeId: null, killDay: -1, killsToday: 0, escaped: new Map(), rng };
    const riders = clamp(Math.floor(num(av.riders, 3)), 1, 6);
    const shapes = Array.isArray(av.weaponShapes) && av.weaponShapes.length ? av.weaponShapes : null;
    for (let i = 0; i < riders; i++) {
      makeResident(camp, `${camp.id}:avenger:${i}`, rng, {
        role: 'avenger',
        mountSpecies: String(av.mountSpecies || 'nazgraku'),
        ...(shapes ? { weaponShape: shapes[Math.floor(rng() * shapes.length)] || shapes[0] } : null),
      });
    }
  }
  function avengerRiders(camp) {
    return camp.hunters.filter(hunter => isAvenger(hunter) && !hunter.slain && !hunter.killCounted && (!hunter.entity || hunter.entity.health > 0));
  }
  function quarryRuntime() {
    const tribeId = avengerCfg()?.quarryTribe;
    return tribeId ? tribeRuntimes.find(runtime => runtime.tribeId === tribeId) || null : null;
  }
  function quarryAlive(quarry, zoneId) {
    return !!quarry && !quarry.slain && !quarry.killCounted && !(quarry.entity && quarry.entity.health <= 0) && quarry.camp?.zoneId === zoneId;
  }
  function quarryLive(quarry) { return !!quarry?.entity && quarry.entity.health > 0 && !!quarry.entity.avatarRef?.group?.visible; }
  function assignAvengerFormation(camp, riders, center) {
    const band = camp.avengerBand;
    const radius = Math.max(0.6, num(avengerCfg()?.formationRadiusTiles, 1.3));
    riders.forEach((rider, index) => {
      const angle = (index / riders.length) * Math.PI * 2 + band.routeStep * 0.73;
      rider.activity = band.quarry ? 'avenge' : 'patrol';
      rider.target = nearestOpenPoint(camp.zoneState, center.col + Math.cos(angle) * radius, center.row + Math.sin(angle) * radius);
    });
  }
  // The rival group around a point: every living quarry-tribe resident within
  // avengers.groupRadiusTiles (live residents report their on-screen position).
  function outnumbered(camp, riders, col, row) {
    const group = quarryRuntime()?.huntersNear?.(camp.zoneId, col, row, num(avengerCfg()?.groupRadiusTiles, 6)) || 0;
    return group > riders.length;
  }
  // Mounted riders can always disengage: break off, ride home and regroup.
  function withdrawAvengerBand(camp, riders, quarry) {
    const band = camp.avengerBand, av = avengerCfg();
    const clock = gameClockHours();
    band.retreatUntil = clock + Math.max(0, num(av.retreatHours, 1));
    if (quarry) band.escaped.set(quarry.id, clock + Math.max(0, num(av.escapeReprieveHours, 2)));
    band.quarry = null;
    band.withdrawals += 1;
    state.avengerWithdrawals += 1;
    state.lastReason = `${KEY}-avengers-withdrew:${camp.id}:${quarry?.id || '-'}`;
    band.patrolTarget = { col: camp.center.col, row: camp.center.row };
    band.routeStep += 1;
    assignAvengerFormation(camp, riders, band.patrolTarget);
    for (const rider of riders) rider.activity = 'withdraw';
    markAvengerRetreat(riders, true);
  }
  function markAvengerRetreat(riders, retreating) {
    for (const rider of riders) if (rider.entity) rider.entity._avengerRetreating = retreating; // Read by updateChunkEcology and makeNeutral.
  }

  // Band planner, 5 Hz. Picks the nearest travelling rival within reach, rides
  // the whole band at it, and slays it on contact only when nobody involved is
  // live on screen; a visible encounter is fought out by updateChunkEcology.
  // The Porakaneki mean to wipe the Omgurku out: a band hunts without a daily
  // limit unless avengers.killsPerDay (> 0) sets one. An off-screen catch is
  // still a contest, not a sure kill (see resolveAvengerCatch). The band only
  // takes on groups no larger than itself; if the quarry's group outnumbers
  // it (on or off screen) it withdraws home to regroup, so Omgurku are safest
  // travelling together and the Avengers prey on stragglers.
  function updateAvengerBand(camp) {
    const band = camp?.avengerBand, av = avengerCfg();
    if (!band || !av) return;
    const riders = avengerRiders(camp);
    if (!riders.length) { band.quarry = null; return; }
    const retreating = band.retreatUntil > gameClockHours();
    markAvengerRetreat(riders, retreating);
    if (retreating) {
      for (const rider of riders) { rider.activity = 'withdraw'; rider.target ||= { ...band.patrolTarget }; } // Riders replaced mid-retreat join the ride home.
      return;
    }
    if (band.killDay !== gameDay()) { band.killDay = gameDay(); band.killsToday = 0; }
    const dailyCap = Math.floor(num(av.killsPerDay, 0)); // 0 = no limit.
    const sated = dailyCap > 0 && band.killsToday >= dailyCap;
    if (band.quarry && (sated || !quarryAlive(band.quarry, camp.zoneId))) band.quarry = null;
    if (!band.quarry && !sated) {
      const lead = riders[0];
      let quarry = null, best = num(av.seekRadiusTiles, 64);
      for (const traveller of quarryRuntime()?.travellingHunters?.(camp.zoneId, num(av.travellerMinDistanceTiles, 8)) || []) {
        if (num(band.escaped.get(traveller.id), -Infinity) > gameClockHours()) continue; // Brief reprieve for a traveller that just got away.
        const d = Math.hypot(traveller.x - lead.x, traveller.y - lead.y);
        if (d <= best && !outnumbered(camp, riders, traveller.x, traveller.y)) { quarry = traveller; best = d; }
      }
      if (quarry) {
        band.quarry = quarry;
        band.routeStep += 1;
        state.lastReason = `${KEY}-avengers-ride:${camp.id}:${quarry.id}`;
      }
    }
    const quarry = band.quarry;
    if (!quarry) {
      const arrived = band.patrolTarget && riders.every(rider => Math.hypot(rider.x - band.patrolTarget.col, rider.y - band.patrolTarget.row) <= 2.5);
      if (!band.patrolTarget || arrived || riders.some(rider => rider.activity === 'avenge')) {
        band.patrolTarget = randomPointAround(camp, camp.center, 3, Math.max(4, num(av.patrolRadiusTiles, 18)), band.rng);
        band.routeStep += 1;
        assignAvengerFormation(camp, riders, band.patrolTarget);
      }
      return;
    }
    if (outnumbered(camp, riders, quarry.x, quarry.y)) { // The quarry joined up with others (or riders fell): break off.
      withdrawAvengerBand(camp, riders, quarry);
      return;
    }
    band.patrolTarget = null;
    assignAvengerFormation(camp, riders, { col: quarry.x, row: quarry.y });
    const reach = num(av.catchRadiusTiles, 1.6) + num(av.formationRadiusTiles, 1.3);
    const caught = riders.some(rider => Math.hypot(rider.x - quarry.x, rider.y - quarry.y) <= reach);
    if (!caught || riders.some(detailedEntityActive) || quarryLive(quarry)) return;
    resolveAvengerCatch(camp, riders, quarry);
    band.quarry = null;
  }
  // The quarry fights back: it may kill a rider (and get away) or, rarely,
  // outrun the Nazgraku; otherwise the band kills it. Either escape only buys
  // a reprieve of avengers.escapeReprieveHours before the band rides again. Slain riders are replaced like any
  // other off-screen loss (replaceSlainResidents).
  function resolveAvengerCatch(camp, riders, quarry) {
    const band = camp.avengerBand, av = avengerCfg();
    const riderLoss = clamp(num(av.riderLossChance, 0.10), 0, 1);
    const escape = clamp(num(av.quarryEscapeChance, 0.05), 0, 1 - riderLoss);
    const roll = rand();
    const where = `${camp.id}:${quarry.id}`;
    if (roll < riderLoss + escape) {
      band.escaped.set(quarry.id, gameClockHours() + Math.max(0, num(av.escapeReprieveHours, 2)));
      band.lastEscapeId = quarry.id;
      band.escapes += 1;
      state.avengerEscapes += 1;
      if (roll < riderLoss) {
        const rider = riders[Math.floor(rand() * riders.length)] || riders[0];
        rider.slain = true;
        rider.slainDay = gameDay();
        rider.activity = 'slain';
        rider.target = null;
        teardownEntity(rider);
        band.losses += 1;
        state.avengerLosses += 1;
        state.lastReason = `${KEY}-avenger-slain:${where}:${rider.id}`;
        window.__farmLog?.(`[${KEY}] Travelling hunter ${quarry.id} killed Avenger ${rider.id} and escaped`, 'wildlife');
      } else {
        state.lastReason = `${KEY}-avengers-escaped:${where}`;
        window.__farmLog?.(`[${KEY}] Travelling hunter ${quarry.id} escaped the Avengers from ${camp.id}`, 'wildlife');
      }
      return 'escaped';
    }
    if (!quarryRuntime()?.slayHunter?.(quarry, `avenged-by:${camp.id}`)) return null;
    band.kills += 1;
    band.killsToday += 1;
    state.avengerKills += 1;
    state.lastReason = `${KEY}-avengers-slew:${where}`;
    window.__farmLog?.(`[${KEY}] Avengers from ${camp.id} slew travelling ${quarry.camp?.id || '?'} hunter ${quarry.id}`, 'wildlife');
    return 'killed';
  }

  function campDens(camp) {
    return Array.isArray(camp?.zoneState?.layoutRef?.dens)
      ? camp.zoneState.layoutRef.dens.filter(den => den && den.id != null && !den.collapsed && den.isAnimalDen !== false) // Hunting parties only target caves an animal den lives in (js/cave-site-system.js).
      : [];
  }
  function denExteriorPoint(camp, den) {
    if (!camp || !den) return null;
    const candidates = [];
    if (den.mouthAnchor && Number.isFinite(Number(den.mouthAnchor.x)) && Number.isFinite(Number(den.mouthAnchor.y))) {
      candidates.push({ col: Number(den.mouthAnchor.x) + 0.5, row: Number(den.mouthAnchor.y) + 0.5 });
    }
    const x = num(den.x, NaN), y = num(den.y, NaN), w = Math.max(1, num(den.w, 1)), h = Math.max(1, num(den.h, 1));
    if (Number.isFinite(x) && Number.isFinite(y)) {
      const cx = x + w * 0.5, cy = y + h * 0.5;
      candidates.push(
        { col: x - 1.25, row: cy },
        { col: x + w + 1.25, row: cy },
        { col: cx, row: y - 1.25 },
        { col: cx, row: y + h + 1.25 },
      );
    }
    for (const candidate of candidates) {
      const open = nearestOpenPoint(camp.zoneState, candidate.col, candidate.row);
      if (pointIsOpen(camp.zoneState, open.col, open.row)) return open;
    }
    return null;
  } // Targets only exterior walkable tiles; hunters never invoke den transitions or enter cavern maps.

  function huntingPartyMembers(camp) {
    const ids = camp?.huntingParty?.memberIds;
    if (!ids?.size) return [];
    return camp.hunters.filter(hunter => ids.has(hunter.id) && !hunter.killCounted && !hunter.slain && (!hunter.entity || hunter.entity.health > 0));
  }
  function huntingPartyFor(hunter) {
    const party = hunter?.camp?.huntingParty;
    return party?.memberIds?.has?.(hunter.id) ? party : null;
  }
  function clearHuntingParty(camp) {
    if (!camp?.huntingParty) return;
    for (const hunter of camp.hunters) {
      if (!camp.huntingParty.memberIds.has(hunter.id)) continue;
      hunter.huntPartyId = null;
      hunter.huntDenId = null;
      hunter.huntRouteStep = -1;
      if (hunter.activity === 'hunt-den') { hunter.activity = 'camp'; hunter.target = null; hunter.decisionT = 0; }
    }
    camp.huntingParty = null;
  }
  function chooseNextPartyDen(camp) {
    const party = camp?.huntingParty;
    const dens = campDens(camp);
    if (!party || !dens.length) return false;
    const choices = dens.length > 1 ? dens.filter(den => String(den.id) !== String(party.denId)) : dens;
    const shuffled = [...choices];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(camp.rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    let den = null, target = null;
    for (const candidate of shuffled) {
      const exterior = denExteriorPoint(camp, candidate);
      if (!exterior) continue;
      den = candidate; target = exterior; break;
    }
    if (!den || !target) return false;
    party.denId = String(den.id);
    party.target = target;
    party.routeStep += 1;
    party.dwellT = 0;
    const members = huntingPartyMembers(camp);
    const radius = Math.max(0.6, num(cfg?.behavior?.denHuntFormationRadiusTiles, 1.15));
    members.forEach((hunter, index) => {
      const angle = ((index / Math.max(1, members.length)) * Math.PI * 2) + party.routeStep * 0.73;
      hunter.huntPartyId = party.id;
      hunter.huntDenId = party.denId;
      hunter.huntRouteStep = party.routeStep;
      hunter.activity = 'hunt-den';
      hunter.target = nearestOpenPoint(camp.zoneState, target.col + Math.cos(angle) * radius, target.row + Math.sin(angle) * radius);
      hunter.decisionT = Math.max(hunter.decisionT, num(cfg?.behavior?.decisionMaxSeconds, 11));
    });
    state.lastReason = `den-hunt-route:${camp.zoneId}:${camp.id}:${party.denId}`;
    return true;
  }
  function ensureHuntingParty(camp) {
    if (!camp || isSleepingHour() || camp.huntingParty || campDens(camp).length === 0) return camp?.huntingParty || null;
    const eligible = camp.hunters.filter(hunter => !isAvenger(hunter) && !hunter.killCounted && !hunter.slain && (!hunter.entity || hunter.entity.health > 0));
    const minSize = Math.max(2, Math.floor(num(cfg?.behavior?.denHuntGroupMin, 2)));
    const maxSize = Math.max(minSize, Math.floor(num(cfg?.behavior?.denHuntGroupMax, 3)));
    if (eligible.length < minSize) return null;
    const shuffled = [...eligible];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(camp.rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const size = Math.min(eligible.length, minSize + Math.floor(camp.rng() * (maxSize - minSize + 1)));
    const members = shuffled.slice(0, size);
    camp.huntingParty = {
      id: `${camp.id}:hunt-party:${gameDay()}:${camp.huntingPartySeq++}`,
      memberIds: new Set(members.map(hunter => hunter.id)),
      denId: null,
      target: null,
      routeStep: 0,
      dwellT: 0,
    };
    if (!chooseNextPartyDen(camp)) { clearHuntingParty(camp); return null; }
    return camp.huntingParty;
  }
  function updateHuntingParty(camp, dt) {
    const party = camp?.huntingParty;
    if (!party) return;
    const members = huntingPartyMembers(camp);
    const minSize = Math.max(2, Math.floor(num(cfg?.behavior?.denHuntGroupMin, 2)));
    if (members.length < minSize) { clearHuntingParty(camp); return; }
    const liveDen = party.denId != null ? campDens(camp).find(den => String(den.id) === String(party.denId)) : null; // Used to abandon a collapsed den or follow the same den slot after it relocates.
    if (party.denId != null && !liveDen) { if (!chooseNextPartyDen(camp)) clearHuntingParty(camp); return; }
    if (liveDen && party.target) {
      const liveTarget = denExteriorPoint(camp, liveDen); // Re-resolves coordinates because den IDs remain stable while their physical site can migrate.
      if (liveTarget && Math.hypot(liveTarget.col - party.target.col, liveTarget.row - party.target.row) > 1.5) {
        party.target = liveTarget;
        party.routeStep += 1;
        party.dwellT = 0;
        const radius = Math.max(0.6, num(cfg?.behavior?.denHuntFormationRadiusTiles, 1.15)); // Same formation radius chooseNextPartyDen uses for an ordinary route step.
        members.forEach((hunter, index) => {
          const angle = ((index / Math.max(1, members.length)) * Math.PI * 2) + party.routeStep * 0.73;
          hunter.huntRouteStep = party.routeStep;
          hunter.huntDenId = party.denId;
          hunter.activity = 'hunt-den';
          hunter.target = nearestOpenPoint(camp.zoneState, liveTarget.col + Math.cos(angle) * radius, liveTarget.row + Math.sin(angle) * radius);
        });
      }
    }
    if (!party.target) { if (!chooseNextPartyDen(camp)) clearHuntingParty(camp); return; }
    const arrivalRadius = Math.max(1, num(cfg?.behavior?.denHuntArrivalRadiusTiles, 2.5));
    const allArrived = members.every(hunter => Math.hypot(hunter.x - party.target.col, hunter.y - party.target.row) <= arrivalRadius);
    if (!allArrived) { party.dwellT = 0; return; }
    if (!(party.dwellT > 0)) {
      const min = Math.max(0, num(cfg?.behavior?.denHuntDwellMinSeconds, 4));
      const max = Math.max(min, num(cfg?.behavior?.denHuntDwellMaxSeconds, 8));
      party.dwellT = min + camp.rng() * (max - min);
      return;
    }
    party.dwellT -= Math.max(0, num(dt, 0));
    if (party.dwellT <= 0 && !chooseNextPartyDen(camp)) clearHuntingParty(camp);
  }

  function chooseHunterActivity(hunter) {
    const camp = hunter.camp;
    if (isAvenger(hunter)) { // updateAvengerBand owns every rider destination; only cover a band that has not planned yet.
      if (!hunter.target) hunter.target = randomCampPoint(camp);
      return;
    }
    const party = huntingPartyFor(hunter);
    if (party?.target) {
      hunter.activity = 'hunt-den';
      hunter.huntPartyId = party.id;
      hunter.huntDenId = party.denId;
      if (hunter.huntRouteStep !== party.routeStep || !hunter.target) {
        const members = huntingPartyMembers(camp);
        const index = Math.max(0, members.indexOf(hunter));
        const radius = Math.max(0.6, num(cfg?.behavior?.denHuntFormationRadiusTiles, 1.15));
        const angle = ((index / Math.max(1, members.length)) * Math.PI * 2) + party.routeStep * 0.73;
        hunter.target = nearestOpenPoint(camp.zoneState, party.target.col + Math.cos(angle) * radius, party.target.row + Math.sin(angle) * radius);
        hunter.huntRouteStep = party.routeStep;
      }
      return;
    }
    const stimulusRadius = num(cfg?.behavior?.stimulusInterestRadiusTiles, 12);
    const found = window.NpcSocialStimuli?.strongestNear?.(camp.zoneId, hunter.x, hunter.y);
    if (found?.stimulus) {
      const sx = num(found.stimulus.x, NaN), sy = num(found.stimulus.z, NaN);
      if (Number.isFinite(sx) && Number.isFinite(sy) && Math.hypot(sx - hunter.x, sy - hunter.y) <= stimulusRadius) {
        hunter.activity = 'investigate';
        hunter.target = nearestOpenPoint(camp.zoneState, sx + (rand() - 0.5) * 2, sy + (rand() - 0.5) * 2);
        return;
      }
    }

    const weights = cfg?.behavior?.activityWeights || {};
    const entries = [
      ['wander', Math.max(0, num(weights.wander, 0.24))],
      ['socialize', Math.max(0, num(weights.socialize, 0.16))],
      ['camp', Math.max(0, num(weights.camp, 0.08))],
    ]; // Den hunting is now group-owned above; non-party residents keep ordinary camp/wander/social behavior.
    const total = entries.reduce((sum, [, weight]) => sum + weight, 0) || 1;
    let roll = rand() * total, activity = 'wander';
    for (const [name, weight] of entries) { roll -= weight; if (roll <= 0) { activity = name; break; } }

    if (activity === 'socialize') {
      const peers = camp.hunters.filter(other => other !== hunter && !other.slain && Math.hypot(other.x - hunter.x, other.y - hunter.y) <= 14);
      if (peers.length) {
        const peer = peers[Math.floor(rand() * peers.length)];
        hunter.activity = 'socialize';
        hunter.target = nearestOpenPoint(camp.zoneState, peer.x + (rand() - 0.5) * 3, peer.y + (rand() - 0.5) * 3);
        return;
      }
      activity = 'wander';
    }

    hunter.activity = activity;
    if (activity === 'camp') hunter.target = randomCampPoint(camp);
    else hunter.target = randomPointAround(camp, { col: hunter.x, row: hunter.y }, 2, num(cfg?.behavior?.localWanderRadiusTiles, 7));
  }

  function travelSpeedTiles(hunter) {
    return isAvenger(hunter) ? num(avengerCfg()?.rideSpeedTilesPerSecond, 2.6) : num(cfg?.behavior?.travelSpeedTilesPerSecond, 1.05);
  } // Mounted Avengers cover ground at a Nazgraku trot even while neutral.
  function sleepPointFor(hunter) {
    if (hunter.sleepDay === gameDay() && hunter.sleepPoint) return hunter.sleepPoint;
    const tents = tentCenters(hunter.camp);
    const rng = seededRng(`${generationYear()}:${hunter.camp.id}:sleep:${gameDay()}:${hunter.index}`);
    const tent = tents.length ? tents[Math.floor(rng() * tents.length)] : hunter.camp.center;
    hunter.sleepDay = gameDay();
    hunter.sleepPoint = nearestOpenPoint(hunter.camp.zoneState, tent.col + (rng() - 0.5) * 0.5, tent.row + (rng() - 0.5) * 0.5);
    return hunter.sleepPoint;
  }
  function advanceAbstractHunter(hunter, dt) {
    if (isSleepingHour()) {
      const sleep = sleepPointFor(hunter);
      hunter.x = sleep.col; hunter.y = sleep.row; hunter.activity = 'sleep'; hunter.target = null; hunter.decisionT = 0;
      return;
    }
    hunter.decisionT -= dt;
    const reached = hunter.target && Math.hypot(hunter.target.col - hunter.x, hunter.target.row - hunter.y) < 0.8;
    if (!hunter.target || hunter.decisionT <= 0 || reached) {
      chooseHunterActivity(hunter);
      const min = num(cfg?.behavior?.decisionMinSeconds, 4), max = Math.max(min, num(cfg?.behavior?.decisionMaxSeconds, 11));
      hunter.decisionT = min + rand() * (max - min);
    }
    if (!hunter.target) return;
    const dx = hunter.target.col - hunter.x, dy = hunter.target.row - hunter.y, distance = Math.hypot(dx, dy);
    if (!distance) return;
    const step = Math.min(distance, travelSpeedTiles(hunter) * dt);
    hunter.x += dx / distance * step;
    hunter.y += dy / distance * step;
  }

  function hideEntity(hunter) {
    const entity = hunter?.entity;
    if (!entity) return;
    const wasDetailed = entity.areaId === hunter.camp.zoneId && !!entity.avatarRef?.group?.visible;
    if (wasDetailed) { hunter.x = entity.x / combatDeps.TILE; hunter.y = entity.y / combatDeps.TILE; }
    entity.areaId = `${DORMANT_AREA_PREFIX}${hunter.camp.zoneId}`;
    if (entity.avatarRef?.group) entity.avatarRef.group.visible = false;
    if (entity.groundShadow) entity.groundShadow.visible = false;
    if (entity._banditToolHolder) entity._banditToolHolder.visible = false;
    if (entity._banditRangedToolHolder) entity._banditRangedToolHolder.visible = false;
    entity.vx = 0; entity.vy = 0;
  }
  function retireDormantEntity(hunter) {
    if (!hunter?.entity) return;
    hideEntity(hunter);
    if (hunter.dormantSinceMs == null) hunter.dormantSinceMs = nowMs();
    else if (nowMs() - hunter.dormantSinceMs >= DORMANT_ENTITY_RELEASE_S * 1000) teardownEntity(hunter);
  }
  function placeEntity(hunter) {
    const entity = hunter?.entity, camp = hunter?.camp;
    if (!entity || !camp || currentArea() !== camp.zoneId) return false;
    const avoidPoints = [];
    for (const other of camp.hunters) {
      if (other === hunter || !other.entity || other.entity.areaId !== camp.zoneId || !other.entity.avatarRef?.group?.visible) continue;
      avoidPoints.push({ col: other.entity.x / combatDeps.TILE, row: other.entity.y / combatDeps.TILE });
    }
    const open = nearestOpenPoint(camp.zoneState, hunter.x, hunter.y, avoidPoints);
    hunter.x = open.col; hunter.y = open.row;
    const grid = combatDeps.getActiveGrid?.();
    const cols = num(combatDeps.getActiveCols?.(), camp.zoneState.view?.cols || 1), rows = num(combatDeps.getActiveRows?.(), camp.zoneState.view?.rows || 1);
    const c = clamp(Math.floor(open.col), 0, Math.max(0, cols - 1)), r = clamp(Math.floor(open.row), 0, Math.max(0, rows - 1));
    const tile = grid?.[r]?.[c];
    const surface = tile && combatDeps.tileSurfaceYInArea ? num(combatDeps.tileSurfaceYInArea(tile, camp.zoneId), 0) : 0;
    entity.x = open.col * combatDeps.TILE; entity.y = open.row * combatDeps.TILE;
    entity.homeX = entity.x; entity.homeY = entity.y; entity.areaId = camp.zoneId; entity.areaGrid = grid; entity.areaCols = cols; entity.areaRows = rows;
    if (entity.avatarRef?.group) { entity.avatarRef.group.position.set(open.col, surface + (entity.halfHeight || 0.45), open.row); entity.avatarRef.group.visible = true; }
    if (entity.groundShadow) { entity.groundShadow.position.set(open.col, surface + (combatDeps.characterGroundShadowSurfaceOffset?.() || 0.01), open.row); entity.groundShadow.visible = true; }
    if (entity._banditToolHolder) entity._banditToolHolder.visible = true;
    if (entity._banditRangedToolHolder) entity._banditRangedToolHolder.visible = false;
    return true;
  }

  async function loadGangConfig() {
    if (!gangCfg) gangCfg = await window.BanditCombat?.loadGangConfig?.();
    return gangCfg;
  }
  async function materializeHunter(hunter, generation) {
    const camp = hunter?.camp;
    if (!hunter || !camp || hunter.entity || hunter.building || currentArea() !== camp.zoneId) return hunter?.entity || null;
    hunter.building = true;
    try {
      const base = await loadGangConfig();
      if (!base || generation !== buildGeneration || currentArea() !== camp.zoneId) return null;
      const weapon = weaponDef(hunter.weaponShape);
      const avenger = isAvenger(hunter);
      const title = `${LABEL} ${avenger ? 'Avenger' : 'Hunter'}`;
      const entity = await window.BanditCombat.makeEntity({
        ...base,
        speciesWeights: { [SPECIES_ID]: 1 },
        rangedWeaponChanceByRank: { grunt: 0, lieutenant: 0, captain: 0 },
      }, 'grunt', avenger ? Math.max(0, Math.floor(num(avengerCfg()?.tier, 1))) : 0, hunter.x * combatDeps.TILE, hunter.y * combatDeps.TILE, {
        zoneId: camp.zoneId,
        nameOverride: title,
        mountSpecies: hunter.mountSpecies || null, // Avengers ride a Nazgraku (compound rider + mount avatar).
        bodyColorsOverride: tribe.bodyColorsForSeed?.(hunter.id) || null,
        defOverride: {
          label: title,
          weaponKey: weapon.weaponKey,
          weaponShapeKey: weapon.shapeKey,
          weaponMetalKey: weapon.metalKey,
          attackTag: weapon.attackTag,
          rangedWeaponKey: weapon.ranged ? weapon.weaponKey : null,
        },
        extra: {
          isTribeHunter: true, // Shared tribe-camp semantics (neutral planner, Favor, gifts, barbarian voice).
          tribeId: KEY,
          isPorakanekiHunter: KEY === 'porakaneki', // Porakaneki-only checks (older modules, Porakaneki species runtime).
          porakanekiHunterIndex: hunter.index,
          porakanekiCampId: camp.id,
          porakanekiCampKind: camp.kind,
          porakanekiWeaponShape: weapon.shapeKey,
          isTribeAvenger: avenger,
        },
      });
      if (!entity || generation !== buildGeneration || currentArea() !== camp.zoneId || !sharesPlayerChunk(hunter)) {
        window.BanditCombat.discardEntity?.(entity); // Drop a completed build whose data-only owner moved outside the activation bubble.
        return null;
      }
      hunter.entity = entity;
      hunter.lastHealth = entity.health;
      if (avenger && entity.def) { // Mounted pace for fights too; makeNeutral/makeHostile capture this as the base speed.
        const mounted = Math.max(1, num(avengerCfg()?.combatSpeedMultiplier, 1.4));
        entity.def.moveSpeed = num(entity.def.moveSpeed, 118) * mounted;
        entity.def.chaseSpeed = num(entity.def.chaseSpeed, 165) * mounted;
      }
      placeEntity(hunter);
      makeNeutral(entity, hunter);
      combatDeps.hostileObjects.add(entity);
      state.materializations += 1;
      return entity;
    } finally { hunter.building = false; }
  }

  function makeNeutral(entity, hunter) {
    if (!entity || entity.health <= 0) return;
    entity._porakanekiAggroRangePx ??= num(entity.def?.aggroRangePx, combatDeps.TILE * 6);
    entity._porakanekiBaseMoveSpeed ??= num(entity.def?.moveSpeed, 118);
    const neutralSpeed = travelSpeedTiles(hunter) * combatDeps.TILE;
    if (entity.def) {
      entity.def.aggroRangePx = 0;
      entity.def.moveSpeed = entity._avengerRetreating === true
        ? Math.max(neutralSpeed, num(entity.def.chaseSpeed, neutralSpeed)) // Withdrawing riders gallop clear of their pursuers.
        : neutralSpeed;
    }

    // The Porakaneki planner owns only WHAT the resident wants to do and WHERE
    // its next target is. The ordinary hostile loop owns actual per-frame travel,
    // collision, facing, portrait front/back selection, procedural feet and
    // animation. Using its existing `return -> homeX/homeY` travel state gives us
    // that renderer/locomotion path without letting its fallback wander AI fight
    // the Porakaneki planner.
    entity._porakanekiPlannerControlled = true;
    entity._porakanekiActivity = hunter.activity;
    if (hunter.target) {
      entity.homeX = hunter.target.col * combatDeps.TILE;
      entity.homeY = hunter.target.row * combatDeps.TILE;
    } else {
      entity.homeX = entity.x;
      entity.homeY = entity.y;
    }
    entity.state = 'return';
    entity._banditAction = null;
    entity._rangedAction = null;
    entity._rangedMode = false;
    // If updateHostiles notices it has reached home before the next 5 Hz
    // planner tick and momentarily changes `return` to `idle`, pin its fallback
    // wander target to the current spot so it cannot choose a competing route.
    entity.wanderTarget = { x: entity.x, y: entity.y };
    entity.wanderT = 9999;
  }
  function makeHostile(entity) {
    if (!entity || entity.health <= 0) return;
    entity._porakanekiAggroRangePx ??= num(entity.def?.aggroRangePx, combatDeps.TILE * 6);
    if (entity.def) {
      entity.def.aggroRangePx = entity._porakanekiAggroRangePx;
      if (Number.isFinite(entity._porakanekiBaseMoveSpeed)) entity.def.moveSpeed = entity._porakanekiBaseMoveSpeed;
    }
    entity._porakanekiPlannerControlled = false;
    entity.wanderTarget = null;
    entity.wanderT = 0;
    entity.state = 'chase';
  }
  function campProvoked(camp) { return nowMs() < num(camp?.provokedUntilMs, 0); }

  function updateViolence(camp) {
    if (!camp || currentArea() !== camp.zoneId) return;
    const player = playerTilePosition();
    if (!player) return;
    const radius = num(cfg?.reputation?.damageAttributionRadiusTiles, 14);
    for (const hunter of camp.hunters) {
      const entity = hunter.entity;
      if (!entity) continue;
      const previous = Number.isFinite(hunter.lastHealth) ? hunter.lastHealth : num(entity.maxHealth, entity.health);
      const health = num(entity.health, 0);
      const close = Math.hypot(hunter.x - player.col, hunter.y - player.row) <= radius;
      const sharedEnemy = hasSharedEnemyNearby(entity); // Prevents nearby bandit/predator crossfire from being treated as a player crime.
      if (health < previous && close && !sharedEnemy) camp.provokedUntilMs = Math.max(camp.provokedUntilMs, nowMs() + PROVOKE_SECONDS * 1000);
      if (previous > 0 && health <= 0 && !hunter.killCounted && close) {
        hunter.killCounted = true;
        if (!sharedEnemy) {
          adjustFavor(-Math.abs(num(cfg?.reputation?.killPenalty, -1)), `${KEY}_kill_${camp.id}_${hunter.index}`);
          state.kills += 1;
        } else {
          state.lastReason = `${KEY}-crossfire-forgiven:${camp.id}:${hunter.index}`;
        }
      }
      hunter.lastHealth = health;
    }
  }

  function maybeHunterGreeting(hunter) {
    if (hunter.greetingDay === gameDay() || favor() < num(cfg?.reputation?.greetingFavorThreshold, 1) || !sharesPlayerChunk(hunter)) return;
    const player = playerTilePosition();
    if (!player || Math.hypot(hunter.x - player.col, hunter.y - player.row) > num(cfg?.reputation?.greetingRadiusTiles, 3)) return;
    const text = chooseLine(cfg?.reputation?.greetingLines) || `A ${LABEL} hunter greets you.`;
    if (speakOverheadFromHunter(hunter, text, { tone: 'greeting' })) {
      hunter.greetingDay = gameDay();
      state.greetings += 1;
    }
  }
  function updateDetailedHunter(hunter, dt) {
    const entity = hunter.entity;
    if (!entity || entity.health <= 0) return;
    hunter.x = entity.x / combatDeps.TILE; hunter.y = entity.y / combatDeps.TILE;
    if ((!peacefulRapport() && favor() <= num(cfg?.reputation?.attackOnSightFavor, -5)) || campProvoked(hunter.camp)) {
      entity._chunkCombatTarget = null;
      makeHostile(entity);
      return;
    }
    if (validChunkCombatTarget(entity, entity._chunkCombatTarget)) {
      // Keep an already-running staged weapon action intact between the 5 Hz
      // ecology scans; makeNeutral would otherwise cancel it every planner tick.
      entity._porakanekiPlannerControlled = true;
      entity._porakanekiActivity = 'ecology-combat';
      if (entity.def) entity.def.aggroRangePx = 0;
      entity.state = 'chase';
      return;
    }
    entity._chunkCombatTarget = null;

    hunter.decisionT -= dt;
    const reached = hunter.target && Math.hypot(hunter.target.col - hunter.x, hunter.target.row - hunter.y) < 0.75;
    if (!hunter.target || hunter.decisionT <= 0 || reached) {
      chooseHunterActivity(hunter);
      const min = num(cfg?.behavior?.decisionMinSeconds, 4), max = Math.max(min, num(cfg?.behavior?.decisionMaxSeconds, 11));
      hunter.decisionT = min + rand() * (max - min);
    }
    makeNeutral(entity, hunter);
    maybeHunterGreeting(hunter);
  }
  function placeEntityIfDormant(hunter) {
    const entity = hunter.entity;
    if (entity && (entity.areaId !== hunter.camp.zoneId || !entity.avatarRef?.group?.visible)) placeEntity(hunter);
  }

  function updateCampHunterTick(hunter, dt, coarseDt, sleeping, generation) {
    if (hunter.slain) return; // Killed off-screen (slayHunter); stays dead for this world generation like an observed death.
    if (hunter.entity?.health <= 0 || hunter.killCounted && hunter.entity?.health <= 0) return;
    if (sleeping) {
      retireDormantEntity(hunter);
      if (coarseDt > 0 || currentArea() === hunter.camp.zoneId) advanceAbstractHunter(hunter, coarseDt || dt);
      return;
    }
    if (!sharesPlayerChunk(hunter)) {
      retireDormantEntity(hunter);
      if (coarseDt > 0) advanceAbstractHunter(hunter, coarseDt);
      return;
    }
    hunter.dormantSinceMs = null;
    if (!hunter.entity && !hunter.building) materializeHunter(hunter, generation).catch(error => window.__farmLog?.(`[${KEY}] materialize failed: ${error.message}`, 'warn'));
    if (hunter.entity) { placeEntityIfDormant(hunter); updateDetailedHunter(hunter, dt); }
  }
  // Off-screen losses are replaced by newcomers after a few days, so a rival
  // band can thin a camp but never empty the wilderness of a tribe.
  function replaceSlainResidents(camp) {
    const days = Math.max(1, num(cfg?.behavior?.slainReplacementDays, 2));
    for (const hunter of camp.hunters) {
      if (!hunter.slain || gameDay() - num(hunter.slainDay, 0) < days) continue;
      const spawn = randomCampPoint(camp);
      Object.assign(hunter, { slain: false, slainDay: null, activity: 'camp', target: null, x: spawn.col, y: spawn.row, decisionT: 0, lastHealth: null });
    }
  }
  function updateCampHunters(camp, dt, coarseDt) {
    ensureCampHunters(camp);
    replaceSlainResidents(camp);
    updateViolence(camp);
    const generation = buildGeneration;
    const sleeping = isSleepingHour();
    if (sleeping) {
      clearHuntingParty(camp);
      if (camp.avengerBand) { camp.avengerBand.quarry = null; camp.avengerBand.patrolTarget = null; }
    } else {
      ensureHuntingParty(camp);
      updateHuntingParty(camp, coarseDt > 0 ? coarseDt : dt);
      updateAvengerBand(camp);
    }
    for (const hunter of camp.hunters) {
      try { updateCampHunterTick(hunter, dt, coarseDt, sleeping, generation); }
      catch (error) { window.__farmLog?.(`[${KEY}] hunter tick failed (${hunter.id}): ${error?.message || error}`, 'warn'); }
    }
  }
  // Read by js/porakaneki-avengers.js: living residents out on the road
  // (den-hunting parties, wanderers, investigators) at least minDistanceTiles
  // from their own camp. Returns live planner records; callers only read
  // id/x/y/activity/entity and leave every change to slayHunter.
  function travellingHunters(zoneId, minDistanceTiles = 8) {
    const zoneState = state.zones.get(zoneId);
    if (!zoneState || isSleepingHour()) return [];
    const travellers = [];
    for (const camp of activeCamps(zoneState)) {
      for (const hunter of camp.hunters) {
        if (hunter.slain || hunter.killCounted || (hunter.entity && hunter.entity.health <= 0)) continue;
        if (hunter.activity !== 'hunt-den' && hunter.activity !== 'wander' && hunter.activity !== 'investigate') continue;
        if (Math.hypot(hunter.x - camp.center.col, hunter.y - camp.center.row) >= minDistanceTiles) travellers.push(hunter);
      }
    }
    return travellers;
  }
  // Off-screen death for an abstract resident (no live combat happened); a
  // materialized resident must instead die through ordinary combat.
  function slayHunter(hunter, reason = 'slain') {
    if (!hunter || hunter.slain || (hunter.entity && hunter.entity.health > 0 && detailedEntityActive(hunter))) return false;
    hunter.slain = true;
    hunter.slainDay = gameDay();
    hunter.activity = 'slain';
    hunter.target = null;
    teardownEntity(hunter);
    state.lastReason = `${KEY}-slain:${reason}:${hunter.id}`;
    return true;
  }

  // Living residents (on or off screen) within radiusTiles of a point; read by
  // a rival tribe's Avengers to size up the group around their quarry.
  function huntersNear(zoneId, col, row, radiusTiles) {
    const zoneState = state.zones.get(zoneId);
    if (!zoneState) return 0;
    let count = 0;
    for (const camp of activeCamps(zoneState)) {
      for (const hunter of camp.hunters) {
        if (hunter.slain || hunter.killCounted || (hunter.entity && hunter.entity.health <= 0)) continue;
        if (Math.hypot(hunter.x - col, hunter.y - row) <= radiusTiles) count += 1;
      }
    }
    return count;
  }

  function updateAllHunters(dt, coarseDt) {
    for (const zoneState of state.zones.values()) {
      for (const camp of activeCamps(zoneState)) {
        try { updateCampHunters(camp, dt, coarseDt); }
        catch (error) { window.__farmLog?.(`[${KEY}] camp tick failed (${camp.id}): ${error?.message || error}`, 'warn'); }
      }
    }
  }

  async function loadConfig() {
    try {
      const [configResponse, smallResponse, chiefResponse, tentResponse] = await Promise.all([
        fetch(CONFIG_URL),
        fetch(SMALL_LOCALE_URL),
        fetch(CHIEF_LOCALE_URL),
        fetch(TENT_PIECE_URL),
      ]);
      if (!configResponse.ok) throw new Error(`config HTTP ${configResponse.status}`);
      if (!smallResponse.ok) throw new Error(`small locale HTTP ${smallResponse.status}`);
      if (!chiefResponse.ok) throw new Error(`chief locale HTTP ${chiefResponse.status}`);
      if (!tentResponse.ok) throw new Error(`tent piece HTTP ${tentResponse.status}`);
      cfg = await configResponse.json();
      smallLocaleDef = await smallResponse.json();
      chiefLocaleDef = await chiefResponse.json();
      tentPiece = await tentResponse.json();
      if (tribeRuntimes[0] === api) ecologyRadiusTiles = Math.max(1, num(cfg?.behavior?.ecologyRadiusTiles, num(cfg?.behavior?.fullSimulationReleaseRadiusTiles, 24)));
      state.lastReason = 'config-ready';
      return cfg;
    } catch (error) {
      state.lastReason = `config-error:${error.message}`;
      window.__farmLog?.(`[${KEY}] ${error.message}`, 'warn', 'wildlife');
      return null;
    }
  }

  function update(dt) {
    tickAccum += Math.max(0, num(dt, 0));
    coarseAccum += Math.max(0, num(dt, 0));
    if (tickAccum < TICK_INTERVAL_S) return;
    const step = tickAccum; tickAccum = 0;
    state.updateTicks += 1;
    const coarseInterval = Math.max(1, num(cfg?.behavior?.offChunkTickSeconds, 4));
    const coarseStep = coarseAccum >= coarseInterval ? coarseAccum : 0;
    if (coarseStep) { coarseAccum = 0; state.coarseTicks += 1; }
    if (!cfg || !smallLocaleDef || !chiefLocaleDef || !combatDeps || !ensureWorldCamps()) return;

    initializeReputation();
    authorChiefBehavior();
    window.PorakanekiCampPlacementPolicy?.syncCurrentZoneClutter?.(); // Clear rock/boulder footprints before any tent or sitting log samples its ground elevation.
    ensureCurrentCampMeshes();
    // Start/promote nearby residents before attempting territory speech. Async
    // portrait construction may still finish on a later tick, in which case the
    // warning remains pending rather than being consumed as a toast.
    updateAllHunters(step, coarseStep);
    if (tribeRuntimes[0] === api) updateChunkEcology(); // One shared pass for every tribe. Assigns only same-stream-chunk actor targets; movement/attacks remain in the existing per-frame combat loops.
    updateTerritoryWarnings();
    maybeChiefGreeting();
  }

  function installTick(api = window.BanditCamps) {
    if (!api || typeof api.updateCampBanners !== 'function') return false;
    if (api.updateCampBanners.__porakanekiCampWrapped) return true;
    const original = api.updateCampBanners.bind(api);
    const wrapped = function porakanekiTick(dt) { update(dt); return original(dt); };
    wrapped.__porakanekiCampWrapped = true;
    api.updateCampBanners = wrapped;
    return true;
  }
  function installRuntimeTick() {
    if (!window.RuntimeFrameScheduler?.register) return false;
    window.RuntimeFrameScheduler.register(SCHEDULER_ID, frameContext => {
      update(Math.max(0, num(frameContext?.deltaMs, 0)) / 1000);
    }, {
      phase: 'pre-game',
      owner: 'PorakanekiCamps',
      description: 'Updates abstract Porakaneki residents, den-hunting parties, LOD promotion, and local ecology before shared hostile AI runs.',
    });
    state.tickOwner = 'RuntimeFrameScheduler';
    return true;
  }
  function campDebug(camp) {
    const player = playerTilePosition();
    return {
      id: camp.id,
      kind: camp.kind,
      center: { col: Number(camp.center.col.toFixed(1)), row: Number(camp.center.row.toFixed(1)) },
      streamChunks: streamChunkKeysForSite(camp.instance?.site),
      residents: camp.residentTarget,
      provoked: campProvoked(camp),
      tents: camp.props.filter(prop => prop.type === 'tent').length,
      bonfires: camp.props.filter(prop => prop.key === BONFIRE_KEY).length,
      benchLogs: camp.props.filter(prop => prop.key === BENCHLOG_KEY).length,
      benchSeats: camp.props.filter(prop => prop.key === BENCHLOG_KEY).length * 2,
      benchMeshesReady: [...camp.propMeshes.values()].filter(entry => entry?.sharedFoliage && entry?.mesh).length,
      avengers: camp.avengerBand ? {
        riders: avengerRiders(camp).length,
        kills: camp.avengerBand.kills,
        losses: camp.avengerBand.losses,
        escapes: camp.avengerBand.escapes,
        withdrawals: camp.avengerBand.withdrawals,
        retreating: camp.avengerBand.retreatUntil > gameClockHours(),
        lastEscapeId: camp.avengerBand.lastEscapeId,
        quarryId: camp.avengerBand.quarry?.id || null,
        quarry: camp.avengerBand.quarry ? { col: Number(camp.avengerBand.quarry.x.toFixed(1)), row: Number(camp.avengerBand.quarry.y.toFixed(1)) } : null,
      } : null,
      huntingParty: camp.huntingParty ? {
        id: camp.huntingParty.id,
        denId: camp.huntingParty.denId,
        routeStep: camp.huntingParty.routeStep,
        memberCount: huntingPartyMembers(camp).length,
        target: camp.huntingParty.target ? { col: Number(camp.huntingParty.target.col.toFixed(1)), row: Number(camp.huntingParty.target.row.toFixed(1)) } : null,
      } : null,
      hunters: camp.hunters.map(hunter => {
        const entity = hunter.entity;
        const group = entity?.avatarRef?.group;
        const simX = entity && combatDeps?.TILE ? entity.x / combatDeps.TILE : null;
        const simY = entity && combatDeps?.TILE ? entity.y / combatDeps.TILE : null;
        const renderX = Number.isFinite(Number(group?.position?.x)) ? Number(group.position.x) : null;
        const renderY = Number.isFinite(Number(group?.position?.z)) ? Number(group.position.z) : null;
        const renderDelta = simX != null && simY != null && renderX != null && renderY != null ? Math.hypot(renderX - simX, renderY - simY) : null;
        const distance = player && camp.zoneId === currentArea() ? Math.hypot(hunter.x - player.col, hunter.y - player.row) : null;
        return {
          index: hunter.index,
          role: hunter.role || 'resident',
          mount: hunter.mountSpecies || null,
          weapon: hunter.weaponShape,
          activity: hunter.activity,
          huntPartyId: hunter.huntPartyId || null,
          huntDenId: hunter.huntDenId || null,
          huntRouteStep: Number.isFinite(hunter.huntRouteStep) ? hunter.huntRouteStep : null,
          x: Number(hunter.x.toFixed(1)), y: Number(hunter.y.toFixed(1)),
          chunk: chunkOf(hunter.x, hunter.y),
          distanceToPlayer: distance == null ? null : Number(distance.toFixed(2)),
          lodRadius: detailedEntityActive(hunter) ? fullSimulationReleaseRadiusTiles() : fullSimulationRadiusTiles(),
          fullSimulation: sharesPlayerChunk(hunter),
          materialized: !!entity,
          visible: !!group?.visible,
          registered: !!entity && !!combatDeps?.hostileObjects?.has?.(entity),
          entityState: entity?.state || null,
          plannerControlled: !!entity?._porakanekiPlannerControlled,
          simPosition: simX == null ? null : { x: Number(simX.toFixed(2)), y: Number(simY.toFixed(2)) },
          renderPosition: renderX == null ? null : { x: Number(renderX.toFixed(2)), y: Number(renderY.toFixed(2)) },
          renderDelta: renderDelta == null ? null : Number(renderDelta.toFixed(3)),
          health: entity ? entity.health : null,
        };
      }),
    };
  }
  // Cheap per-frame accessors: callers that only need these used to build the
  // whole debugSnapshot() (every camp, hunter and party) every frame.
  function attackOnSight(relation = relationshipState()) {
    return !!relation && !!cfg && !peacefulRapport() && num(relation.favor, 0) <= num(cfg.reputation?.attackOnSightFavor, -5);
  }
  // Same zones/camps shape as debugSnapshot(), limited to id/kind/center.
  function campCenters() {
    const zones = {};
    for (const [zoneId, zoneState] of state.zones) {
      zones[zoneId] = { camps: activeCamps(zoneState).map(camp => ({ id: camp.id, kind: camp.kind, center: { col: Number(camp.center.col.toFixed(1)), row: Number(camp.center.row.toFixed(1)) } })) };
    }
    return { zones };
  }
  function debugSnapshot() {
    const relation = relationshipState();
    const player = playerTilePosition();
    const zones = {};
    let totalSmallCamps = 0, totalGeneratedResidents = 0;
    for (const [zoneId, zoneState] of state.zones) {
      totalSmallCamps += zoneState.smallCamps.length;
      const camps = activeCamps(zoneState);
      totalGeneratedResidents += camps.reduce((sum, camp) => sum + camp.residentTarget, 0);
      zones[zoneId] = {
        smallCampCount: zoneState.smallCamps.length,
        chiefReserved: !!zoneState.chiefReservation,
        chiefActive: !!zoneState.chiefCamp,
        camps: camps.map(campDebug),
      };
    }
    return {
      version: 8,
      configReady: !!cfg,
      localesReady: !!smallLocaleDef && !!chiefLocaleDef,
      combatDepsReady: !!combatDeps,
      schedulingDepsReady: !!schedulingDeps,
      currentArea: currentArea(),
      season: currentSeasonName(),
      chiefZoneId: state.chiefZoneId,
      favor: relation ? num(relation.favor, 0) : null,
      rapport: num(window.NpcRapport?.get?.(cfg?.reputation?.npcId || CHIEF_ID), 0),
      attackOnSight: attackOnSight(relation),
      chunkSizeTiles: chunkSizeTiles(),
      fullSimulationRadiusTiles: fullSimulationRadiusTiles(),
      fullSimulationReleaseRadiusTiles: fullSimulationReleaseRadiusTiles(),
      playerTile: player ? { col: Number(player.col.toFixed(2)), row: Number(player.row.toFixed(2)) } : null,
      playerChunk: player ? chunkOf(player.col, player.row) : null,
      totalSmallCamps,
      totalActiveCamps: totalSmallCamps + (state.chiefZoneId && state.zones.get(state.chiefZoneId)?.chiefCamp ? 1 : 0),
      totalGeneratedResidents,
      updateTicks: state.updateTicks,
      tickOwner: state.tickOwner,
      chiefPlannerAgenda: !!chiefWalker()?.rec?.agenda?.some?.(beat => beat.id === `${KEY}_day`),
      zones,
      stamps: state.stamps,
      materializations: state.materializations,
      coarseTicks: state.coarseTicks,
      greetings: state.greetings,
      kills: state.kills,
      avengerKills: state.avengerKills,
      avengerLosses: state.avengerLosses,
      avengerEscapes: state.avengerEscapes,
      avengerWithdrawals: state.avengerWithdrawals,
      ecology: { ...ecologyState },
      lastReason: state.lastReason,
    };
  }

  const api = Object.freeze({
    version: 8,
    tribeId: KEY,
    label: LABEL,
    speciesId: SPECIES_ID,
    ensureZoneState,
    getNearbyGiftWalker,
    update,
    ensureWorldCamps,
    ensureCampStamp: ensureWorldCamps,
    initializeReputation,
    favor,
    reservedCampChunks,
    reduceHuntingCampsForBandit,
    occupiedSites,
    reservedSites,
    hasSharedEnemyNearby,
    travellingHunters,
    huntersNear,
    slayHunter,
    attackOnSight: () => attackOnSight(),
    campCenters,
    debugSnapshot,
    formatDebug: () => {
      const d = debugSnapshot();
      const zoneBits = Object.entries(d.zones).map(([zoneId, z]) => `${zoneId}:${z.smallCampCount}${z.chiefActive ? '+CHIEF' : ''}`).join(' ');
      return `${LABEL} camps: v8 ticks=${d.updateTicks} owner=${d.tickOwner} season=${d.season} chief=${d.chiefZoneId || '-'} area=${d.currentArea || '-'} small=${d.totalSmallCamps} active=${d.totalActiveCamps} residents=${d.totalGeneratedResidents} favor=${d.favor ?? '-'} rapport=${d.rapport} AOS=${d.attackOnSight} lod=${d.fullSimulationRadiusTiles}/${d.fullSimulationReleaseRadiusTiles} player=${d.playerTile ? `${d.playerTile.col},${d.playerTile.row}` : '-'} ecology=${d.ecology.chunk || '-'}:${d.ecology[KEY] ?? 0}/${d.ecology.bandits}/${d.ecology.predators}/${d.ecology.prey} targets=${d.ecology.humanoidTargets}/${d.ecology.predatorTargets} mats=${d.materializations} coarse=${d.coarseTicks} greet=${d.greetings} kills=${d.kills} avengers=${d.avengerKills}k/${d.avengerLosses}l/${d.avengerEscapes}e/${d.avengerWithdrawals}w zones=[${zoneBits}] reason=${d.lastReason}`;
    },
    __test: Object.freeze({ updateAvengerBand, resolveAvengerCatch, MIN_HUNTING_CAMPS_PER_ZONE, isSleepingHour, chunkOf, streamChunkSizeTiles, streamChunkKeysForSite, streamChunkOfTile, ecologyRole, nearestEcologyTarget, activePlayerChunkEcology, updateChunkEcology, fullSimulationRadiusTiles, fullSimulationReleaseRadiusTiles, simulationDistanceToPlayer, weaponRoll, currentSeasonName, desiredChiefZone, smallCampCountForZone, huntingCampPreferredPoint, smallResidentCount, denExteriorPoint, chooseNextPartyDen, ensureHuntingParty, updateHuntingParty, speakOverheadFromHunter, speakOverheadFromWalker, markOutline, buildZoneView, tentWallsBlockBox }),
  });

  tribeRuntimes.push(api);
  if (!installRuntimeTick()) {
    state.tickOwner = 'BanditCamps-fallback';
    watchNamespace('BanditCamps', installTick);
  }
  loadConfig();
  return api;
  }

  function installBanditCombat(api = window.BanditCombat) {
    if (!api || typeof api.init !== 'function') return false;
    if (api.__porakanekiCampInitWrapped) return true;
    const original = api.init.bind(api);
    api.init = function porakanekiBanditInit(injected) { combatDeps = injected; return original(injected); };
    api.__porakanekiCampInitWrapped = true;
    return true;
  }
  function installScheduling(api = window.NpcScheduling) {
    if (!api || typeof api.init !== 'function') return false;
    if (api.__porakanekiCampInitWrapped) return true;
    const original = api.init.bind(api);
    api.init = function porakanekiSchedulingInit(injected) { schedulingDeps = injected; return original(injected); };
    api.__porakanekiCampInitWrapped = true;
    return true;
  }
  function watchNamespace(name, installer) {
    if (installer(window[name])) return;
    const descriptor = Object.getOwnPropertyDescriptor(window, name);
    if (descriptor && !descriptor.configurable) return;
    // Preserve earlier startup subscribers, including DoorstepVisits' NPC adapters.
    if (typeof descriptor?.set === 'function') {
      Object.defineProperty(window, name, {
        configurable: true,
        enumerable: descriptor.enumerable ?? true,
        get() { return descriptor.get?.call(window); },
        set(value) {
          descriptor.set.call(window, value);
          installer(descriptor.get ? descriptor.get.call(window) : value);
        },
      });
      return;
    }
    let assigned = descriptor?.value;
    Object.defineProperty(window, name, {
      configurable: true, enumerable: true,
      get: () => assigned,
      set(value) {
        assigned = value;
        Object.defineProperty(window, name, { configurable: true, enumerable: true, writable: true, value });
        installer(value);
      },
    });
  }

  // Every tribe's live/reserved camp footprints. Bandit placement, wildlife
  // spawning, traders and later tribes all avoid the union of these.
  const TribeCamps = Object.freeze({
    list: () => [...tribeRuntimes],
    get: tribeId => tribeRuntimes.find(runtime => runtime.tribeId === tribeId) || null,
    occupiedSites: zoneId => tribeRuntimes.flatMap(runtime => runtime.occupiedSites(zoneId)),
    reservedCampChunks: zoneId => [...new Set(tribeRuntimes.flatMap(runtime => runtime.reservedCampChunks(zoneId)))],
    reduceHuntingCampsForBandit(zoneId) { // Sacrifices from the tribe with the most surplus camps first.
      const ordered = [...tribeRuntimes].sort((a, b) => (b.debugSnapshot().zones?.[zoneId]?.smallCampCount || 0) - (a.debugSnapshot().zones?.[zoneId]?.smallCampCount || 0));
      for (const runtime of ordered) { const removed = runtime.reduceHuntingCampsForBandit(zoneId); if (removed) return removed; }
      return null;
    },
    hasSharedEnemyNearby: entity => hasSharedEnemyNearby(entity),
  });

  watchNamespace('BanditCombat', installBanditCombat);
  watchNamespace('NpcScheduling', installScheduling);
  window.PorakanekiCamps = createTribeCamps({
    id: 'porakaneki', label: 'Porakaneki', speciesId: 'porakaneki', chiefNpcId: 'porakaneki_chief',
    configUrl: 'config/porakaneki-camp.json',
    smallLocaleUrl: 'config/locales/locale_porakaneki_camp_small.json',
    chiefLocaleUrl: 'config/locales/locale_porakaneki_camp_chief.json',
    tentPieceUrl: 'config/pieces/porakaneki-hunting-tent.json',
    tentHeightScale: 0.75, // Low hunting shelters, a quarter shorter than the authored tent.
    bodyColorsForSeed: seed => window.HobunjiPorakanekiSpecies?.bodyColorsForSeed?.(seed, 'male') || null,
  });
  window.OmgurkuCamps = createTribeCamps({
    id: 'omgurku', label: 'Omgurku', speciesId: 'omgurku', chiefNpcId: 'omgurku_chief',
    configUrl: 'config/omgurku-camp.json',
    smallLocaleUrl: 'config/locales/locale_porakaneki_camp_small.json', // Same camp footprints; the tents differ in height.
    chiefLocaleUrl: 'config/locales/locale_porakaneki_camp_chief.json',
    tentPieceUrl: 'config/pieces/porakaneki-hunting-tent.json',
    tentHeightScale: 1.25, // Tall tents for the larger hybrid riders.
    bodyColorsForSeed: () => null, // Omgurku portraits roll their own body colors through the shared species palette.
  });
  window.TribeCamps = TribeCamps;
})();
