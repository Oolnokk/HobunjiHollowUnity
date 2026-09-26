(() => {
  'use strict';

  // Porakaneki wilderness camp network.
  //
  // Every generated wilderness map receives 2-4 small camps populated only by
  // procedural Porakaneki. A separate large camp contains the named chief plus
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
  const CONFIG_URL = 'config/porakaneki-camp.json'; // Network/population/LOD/reputation tuning loaded once at startup.
  const SMALL_LOCALE_URL = 'config/locales/locale_porakaneki_camp_small.json'; // Little procedural-only camp footprint.
  const CHIEF_LOCALE_URL = 'config/locales/locale_porakaneki_camp_chief.json'; // Large seasonal named-chief camp footprint.
  const TENT_PIECE_URL = 'config/pieces/porakaneki-hunting-tent.json'; // Dedicated half-height 2x2 hunting tent used only by the wilderness camps.
  const BENCHLOG_KEY = 'benchlog'; // Used by camp log rendering and the shared NPC seating stations.
  const BONFIRE_KEY = 'bonfire'; // Used to select the shared 2x2 large-fire furniture instead of the old one-tile campfire.
  const SPECIES_ID = 'porakaneki'; // Forced species for every generated camp resident.
  const DORMANT_AREA_PREFIX = '__porakaneki_dormant__:'; // Removes hidden/off-radius residents from the normal hostile loop.
  const TICK_INTERVAL_S = 0.20; // Neutral planner/LOD cadence; actual entity movement/render/combat stays in the normal hostile loop.
  const PROVOKE_SECONDS = 45; // Temporary same-camp self-defense window after an assault without permanent Favor loss.
  const DORMANT_ENTITY_RELEASE_S = 3; // Grace period before a hidden off-radius/sleeping hunter's real entity is torn down.
  const MIN_HUNTING_CAMPS_PER_ZONE = 1; // Hard ecology floor: every wilderness zone keeps at least one ordinary Porakaneki hunting camp.
  const SCHEDULER_ID = 'porakaneki-camps-runtime'; // Stable shared-frame owner; production no longer depends on the obsolete BanditCamps banner tick being called.

  let combatDeps = null; // Captured from BanditCombat.init; movement/scenes/terrain/tools/hostileObjects.
  let schedulingDeps = null; // Captured from NpcScheduling.init; live named-chief walker.
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
    ecology: { chunk: null, porakaneki: 0, bandits: 0, predators: 0, prey: 0, humanoidTargets: 0, predatorTargets: 0 }, // Copyable mobile debug summary of the currently observed stream-chunk ecology pass.
    updateTicks: 0, // Counts actual 5 Hz planner updates so a dead runtime cadence is visible in snapshots.
    tickOwner: 'uninstalled', // 'RuntimeFrameScheduler' in shipped gameplay, legacy BanditCamps wrapper only in isolated tests/tools.
  };

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
    const year = Number(window.CalendarSystem?.yearNumber?.());
    return Number.isFinite(year) ? Math.max(1, Math.floor(year)) : 1;
  }
  function currentSeasonName() {
    try { return String(window.CalendarSystem?.currentSeason?.()?.name || 'Stormtide'); }
    catch { return 'Stormtide'; }
  }
  function desiredChiefZone(seasonName = currentSeasonName()) {
    const map = cfg?.chiefCamp?.seasonZoneMap || {};
    return map[seasonName] || cfg?.wildernessZones?.[0] || null;
  }
  function isSleepingHour(hour = gameHour()) {
    const start = num(cfg?.schedule?.sleepStartHour, 22);
    const wake = num(cfg?.schedule?.wakeHour, 6);
    return start > wake ? (hour >= start || hour < wake) : (hour >= start && hour < wake);
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

  function buildZoneView(zoneId, layout) {
    if (!layout?.cols || !layout?.rows || !combatDeps) return null;
    const cols = layout.cols, rows = layout.rows;
    const tiles = Array.from({ length: rows }, () => new Array(cols).fill(null));
    const objects = [];
    for (const source of (layout.tiles || [])) {
      if (!(source.r >= 0 && source.r < rows && source.c >= 0 && source.c < cols)) continue;
      const tile = {
        height: source.elevTier || 0,
        water: !!combatDeps.WATERWAY_TYPES?.has?.(source.type),
        path: source.type === combatDeps.TileType?.PATH,
        ramp: source.type === combatDeps.TileType?.RAMP || !!source.incline,
        waterfall: source.type === combatDeps.TileType?.WATERFALL,
        terrain: source.type,
        occupiedBy: null,
      };
      tiles[source.r][source.c] = tile;
      if (source.type === combatDeps.TileType?.SHRUB || source.type === combatDeps.TileType?.ROCK) {
        const id = `porakaneki_clutter_${source.c}_${source.r}`;
        tile.occupiedBy = id;
        objects.push({ id, type: 'unique', x: source.c, y: source.r, w: 1, h: 1, localeMeta: true });
      }
    }

    let blockerSeq = 0;
    const blockRect = (col, row, w = 1, h = 1) => {
      if (!Number.isFinite(col) || !Number.isFinite(row)) return;
      const id = `porakaneki_blocker_${blockerSeq++}`;
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
    entity.avatarRef?.group?.parent?.remove?.(entity.avatarRef.group);
    entity.groundShadow?.parent?.remove?.(entity.groundShadow);
    entity._banditToolHolder?.parent?.remove?.(entity._banditToolHolder);
    entity._banditRangedToolHolder?.parent?.remove?.(entity._banditRangedToolHolder);
    entity.avatarRef?.dispose?.();
    hunter.entity = null;
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
  function clearCampMeshes(camp) {
    for (const entry of camp?.propMeshes?.values?.() || []) {
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

  function smallCampCountForZone(zoneId) {
    const small = cfg?.smallCamps || {};
    const rng = seededRng(`${generationYear()}:${zoneId}:porakaneki-small-count`);
    return Math.max(MIN_HUNTING_CAMPS_PER_ZONE, integerRoll(rng, num(small.minPerZone, 2), num(small.maxPerZone, 4)));
  }
  function smallResidentCount(zoneId, campIndex) {
    const small = cfg?.smallCamps || {};
    const rng = seededRng(`${generationYear()}:${zoneId}:porakaneki-small-${campIndex}:population`);
    return integerRoll(rng, num(small.minResidents, 2), num(small.maxResidents, 4));
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
  function banditCampAvoidChunks(zoneId) {
    const recs = window.BanditCamps?.campInstances?.get?.(zoneId);
    if (!recs?.length) return [];
    const keys = new Set();
    for (const rec of recs) for (const key of streamChunkKeysForSite(rec?.instance?.site)) keys.add(key);
    return [...keys];
  } // Prevents Porakaneki reservations/hunting camps from touching any chunk already occupied by a bandit camp.
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
    window.__farmLog?.(`[porakaneki] removed hunting camp ${camp.id} so a bandit camp can keep its required chunk separation.`, 'wildlife');
    return camp.id;
  }

  function banditCampAvoidPoints(zoneId, minDistance) {
    if (!(minDistance > 0)) return [];
    const recs = window.BanditCamps?.campInstances?.get?.(zoneId);
    if (!recs?.length) return [];
    return recs.map(rec => {
      const site = rec?.instance?.site;
      return site ? { col: site.x + site.w * 0.5, row: site.y + site.h * 0.5, minDistance } : null;
    }).filter(Boolean);
  }
  function stampHuntingCamp(zoneState, zoneId, campIndex, minimumFallback = false) {
    if (!zoneState?.view || !smallLocaleDef) return null;
    const instanceId = minimumFallback
      ? `porakaneki_small_${zoneId}_minimum`
      : `porakaneki_small_${zoneId}_${campIndex}`; // Distinct fallback id makes the one-camp guarantee visible in diagnostics/tests.
    const instance = window.TemporaryLocales.stamp(zoneState.view, smallLocaleDef, {
      rng: seededRng(`${generationYear()}:${zoneId}:porakaneki-small-site:${minimumFallback ? 'minimum' : campIndex}`),
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
      rng: seededRng(`${generationYear()}:${zoneId}:porakaneki-chief-site`),
      clearableTypes: new Set(),
      clearanceTiles: chiefLocaleDef.placement?.clearanceTiles ?? 3,
      requiresFlatGround: chiefLocaleDef.placement?.requiresFlatGround !== false,
      minDistanceFromEntry: chiefLocaleDef.placement?.minDistanceFromEntry ?? 14,
      avoidPoints: banditCampAvoidPoints(zoneId, chiefLocaleDef.placement?.minDistanceFromBanditCamp ?? 16),
      avoidChunks: banditCampAvoidChunks(zoneId),
      chunkSizeTiles: streamChunkSizeTiles(),
      instanceId: `porakaneki_chief_reservation_${zoneId}`,
    });
    if (zoneState.chiefReservation) state.stamps += 1;

    const targetCount = smallCampCountForZone(zoneId);
    for (let i = 0; i < targetCount; i++) stampHuntingCamp(zoneState, zoneId, i, false);
    if (zoneState.smallCamps.length < MIN_HUNTING_CAMPS_PER_ZONE) {
      stampHuntingCamp(zoneState, zoneId, targetCount, true); // Exhaustive zero-clearance/non-flat fallback prevents an unlucky zone from ending up camp-less.
    }
    if (zoneState.smallCamps.length < MIN_HUNTING_CAMPS_PER_ZONE) {
      state.lastReason = `hunting-camp-minimum-placement-failed:${zoneId}`;
      window.__farmLog?.(`[porakaneki] ERROR: zone "${zoneId}" has no legal hunting-camp site even after the minimum fallback.`, 'warn');
    }
    state.zones.set(zoneId, zoneState);
    return zoneState;
  }

  function ensureZoneState(zoneId) {
    const layout = combatDeps?.zoneLayouts?.get?.(zoneId);
    if (!layout || !window.TemporaryLocales || !smallLocaleDef || !chiefLocaleDef) return null;
    const prior = state.zones.get(zoneId);
    if (prior?.layoutRef === layout) return prior;
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
      () => window.__farmLog?.('[porakaneki] canvas.png failed to load; tents are using the canvas-color fallback.', 'warn', 'wildlife'),
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
    group.userData.projectileCoverHeightTiles = 1.275;
    group.userData.projectileCoverRadiusTiles = 1.0;
    group.userData.projectileCoverKind = 'porakaneki-tent';
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
          id: `porakaneki_bench_${camp.id}_${prop.id}_${seatIndex}`,
          label: camp.kind === 'chief' ? 'Council Sitting Log' : 'Hunting Camp Sitting Log',
          area: camp.zoneId,
          c: record.col,
          r: record.row,
          rotY: record.yawDeg,
          pose: 'sit',
          roles: ['sit', 'porakaneki-camp-rest'],
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

  function queueBenchLogMesh(camp, prop, zone, elevationY) {
    if (!window.FoliageFurnitureRenderer?.buildInstance) return;
    const record = benchRecordForProp(camp, prop); // Used by the shared wilderness-log renderer so camps do not duplicate log geometry.
    const generation = buildGeneration; // Used after the async V27 build to discard logs from a torn-down/rebuilt wilderness generation.
    camp.propMeshes.set(prop.id, { mesh: null, light: null, pending: true, record });
    window.FoliageFurnitureRenderer.buildInstance(record, camp.zoneState?.layoutRef, {
      PLATEAU_UNIT: combatDeps?.PLATEAU_UNIT,
      NORMAL_TOP: combatDeps?.NORMAL_TOP,
    }).then(({ instance, data }) => {
      const liveEntry = camp.propMeshes.get(prop.id); // Used to ensure this result still belongs to the current camp before publishing it.
      if (generation !== buildGeneration || !liveEntry?.pending || currentArea() !== camp.zoneId) {
        instance.parent?.remove?.(instance);
        return;
      }
      instance.position.set(record.centerX, elevationY, record.centerZ);
      instance.userData.porakanekiCampBench = true;
      instance.userData.porakanekiCampId = camp.id;
      markOutline(instance);
      zone.scene.add(instance);
      camp.propMeshes.set(prop.id, { mesh: instance, light: null, pending: false, record, data, sharedFoliage: true });
    }).catch(error => {
      if (camp.propMeshes.get(prop.id)?.pending) camp.propMeshes.delete(prop.id);
      window.__farmLog?.(`[porakaneki] bench log failed (${prop.id}): ${error?.message || error}`, 'warn', 'wildlife');
    });
  }

  function ensureCampMeshes(camp) {
    const zone = combatDeps?.zoneScenes?.get?.(camp.zoneId); // Supplies the active Three.js scene for camp props.
    if (!zone?.scene || currentArea() !== camp.zoneId) return;
    registerCampBenchStations(camp);
    for (const prop of camp.props) {
      const prior = camp.propMeshes.get(prop.id); // Used to avoid rebuilding both sync props and pending async bench logs every camp tick.
      if (prior?.mesh?.parent === zone.scene || prior?.pending) continue;
      if (prior) {
        if (prior.light) prior.light.parent?.remove?.(prior.light);
        disposeObject3D(prior.mesh);
        camp.propMeshes.delete(prop.id);
      }
      const col = prop.x + (prop.w || 1) * 0.5; // Runtime center used by fire/crate meshes and terrain sampling.
      const row = prop.y + (prop.h || 1) * 0.5; // Runtime center paired with col.
      const grid = combatDeps.getActiveGrid?.(); // Used below to place the prop on the live terrain surface.
      const tile = grid?.[Math.floor(row)]?.[Math.floor(col)]; // Used to resolve the exact surface elevation under this prop.
      const elevationY = tile && combatDeps.tileSurfaceYInArea ? num(combatDeps.tileSurfaceYInArea(tile, camp.zoneId), 0) : 0; // Shared world-space surface height for all camp props.

      if (prop.key === BENCHLOG_KEY) {
        queueBenchLogMesh(camp, prop, zone, elevationY);
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

  function chiefWalker() {
    const id = cfg?.reputation?.npcId || 'porakaneki_chief';
    return schedulingDeps?.npcWalkers?.find?.(walker => walker?.rec?.id === id) || null;
  }
  function authorChiefBehavior() {
    const camp = state.zones.get(state.chiefZoneId)?.chiefCamp;
    const walker = chiefWalker();
    if (!camp || !walker?.rec || !window.NpcScheduling?.registerNpcStations) return false;
    const key = `${state.chiefSeason}:${camp.id}:${camp.center.col.toFixed(2)}:${camp.center.row.toFixed(2)}`;
    if (state.chiefBehaviorKey === key && walker.rec.scheduleHooks?.__porakanekiCampRuntime) return true;

    const role = 'porakaneki-chief-sleep';
    registerCampBenchStations(camp);
    window.NpcScheduling.registerNpcStations(tentCenters(camp).map((tent, index) => ({
      id: `porakaneki_chief_sleep_${camp.zoneId}_${index}`,
      label: 'Porakaneki Chief Camp Tent',
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
      { id: 'porakaneki_sleep_late', activity: 'goToRole', obligation: 'plan', window: ['22:00', '23:59'], destinationRole: role, destinationArea: camp.zoneId, activityLabel: 'sleeping' },
      { id: 'porakaneki_sleep_early', activity: 'goToRole', obligation: 'plan', window: ['00:00', '06:00'], destinationRole: role, destinationArea: camp.zoneId, activityLabel: 'sleeping' },
      { id: 'porakaneki_day', activity: 'break', obligation: 'leisure', window: ['06:00', '22:00'], destinationArea: camp.zoneId, activityLabel: 'around the chief camp' },
    ];
    state.chiefBehaviorKey = key;
    return true;
  }

  function relationshipState() {
    const id = cfg?.reputation?.npcId || 'porakaneki_chief';
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
    const marker = rep.initializationMemoryEvent || 'porakaneki_faction_initialized';
    if (memoryHas(relation, marker)) return true;
    const current = Number(relation.favor);
    if (!Number.isFinite(current) || current === 0) relation.favor = num(rep.initialFavor, -3);
    relation.favor = clamp(num(relation.favor, -3), num(rep.minimumFavor, -5), num(rep.maximumFavor, 10));
    pushMemory(relation, marker);
    state.lastReason = `reputation-initialized:${relation.favor}`;
    return true;
  }
  function favor() { initializeReputation(); return num(relationshipState()?.favor, 0); }
  function adjustFavor(amount, reason) {
    const relation = relationshipState();
    if (!relation || !amount) return favor();
    const rep = cfg?.reputation || {};
    relation.favor = clamp(num(relation.favor, 0) + amount, num(rep.minimumFavor, -5), num(rep.maximumFavor, 10));
    pushMemory(relation, reason);
    window.WorldPopupText?.queueReward?.('favor', `${amount > 0 ? '+' : '-'}${Math.abs(amount)} Porakaneki Favor`);
    return relation.favor;
  }

  function chooseLine(lines) {
    if (!Array.isArray(lines) || !lines.length) return '';
    return lines[Math.floor(rand() * lines.length)] || lines[0];
  }
  function speakOverheadFromWalker(walker, text, options = {}) {
    if (text && walker?.root && window.AmbientDialogue?.show) {
      const shown = window.AmbientDialogue.show(walker.root, text, {
        speakerId: walker.rec?.id || 'porakaneki_chief',
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
    if (!zoneState || !combatDeps?.player || currentFavor >= 0 || currentFavor <= num(rep.attackOnSightFavor, -5)) {
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
    const marker = `porakaneki_chief_greet_day_${gameDay()}`;
    const relation = relationshipState();
    if (!relation || memoryHas(relation, marker)) return;
    pushMemory(relation, marker);
    const text = chooseLine(cfg?.reputation?.greetingLines) || 'The Porakaneki chief greets you.';
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
  function playerTilePosition() {
    if (!combatDeps?.player || !combatDeps?.TILE) return null;
    return { col: combatDeps.player.x / combatDeps.TILE, row: combatDeps.player.y / combatDeps.TILE };
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
  function streamChunkOfTile(col, row) {
    const size = streamChunkSizeTiles();
    return { x: Math.floor(num(col, 0) / size), y: Math.floor(num(row, 0) / size) };
  } // Actual WildernessChunks coordinate, distinct from the old config-era 10-tile debug chunk.
  function sameStreamChunk(a, b) { return !!a && !!b && a.x === b.x && a.y === b.y; }
  function playerStreamChunk() {
    const player = playerTilePosition();
    return player ? streamChunkOfTile(player.col, player.row) : null;
  }
  function entityStreamChunk(entity) {
    if (!entity || !combatDeps?.TILE) return null;
    return streamChunkOfTile(entity.x / combatDeps.TILE, entity.y / combatDeps.TILE);
  }
  function entitySharesPlayerStreamChunk(entity) {
    if (!entity || entity.areaId !== currentArea()) return false;
    return sameStreamChunk(entityStreamChunk(entity), playerStreamChunk());
  }

  function sharesPlayerChunk(hunter) {
    const distance = simulationDistanceToPlayer(hunter);
    if (!Number.isFinite(distance)) return false;
    const playerChunk = playerStreamChunk();
    const hunterChunk = streamChunkOfTile(hunter.x, hunter.y);
    if (sameStreamChunk(playerChunk, hunterChunk)) return true; // Required for observed same-chunk faction encounters, even at opposite chunk corners.
    // Once live, keep the resident live until the wider release radius. That
    // prevents edge oscillation/rebuild thrash while faction-vs-faction combat
    // itself remains restricted to the exact streamed player chunk.
    return distance <= (detailedEntityActive(hunter) ? fullSimulationReleaseRadiusTiles() : fullSimulationRadiusTiles());
  }

  function normalizedEcologySpeciesKey(entity) {
    return String(entity?.creatureKey || '')
      .replace(/-herd-mother$/, '')
      .replace(/-den-mother$/, '')
      .replace(/-nestmother$/, '')
      .replace(/-alpha$/, '');
  } // Used only as a fallback for older spawned wildlife without an explicit wildlifeRole.
  function ecologyRole(entity) {
    if (!entity || entity.health <= 0 || entity.isCompanion) return null;
    if (entity.isPorakanekiHunter) return 'porakaneki';
    if ((entity.isBandit && !entity.isPorakanekiHunter) || entity.banditCompanion) return 'bandit';
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
      && entitySharesPlayerStreamChunk(entity) && entitySharesPlayerStreamChunk(target);
  }
  function setHumanoidEcologyTarget(entity, target) {
    if (!entity) return;
    entity._chunkCombatTarget = target || null; // Read by BanditCombat.updateCombatAI to replace only the current attack target.
    if (!target) return;
    if (entity.isPorakanekiHunter) {
      entity._porakanekiPlannerControlled = true; // Ecology combat must not make neutral hunters hostile/targetable to the player.
      entity._porakanekiActivity = 'ecology-combat';
      if (entity.def) entity.def.aggroRangePx = 0;
      const role = ecologyRole(target); // Used to preserve crossfire forgiveness through a same-frame enemy death.
      if (role === 'bandit' || role === 'predator') entity._porakanekiSharedEnemyUntilMs = nowMs() + 1500;
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
    const groups = { porakaneki: [], bandit: [], predator: [], prey: [] };
    for (const entity of combatDeps?.hostileObjects || []) {
      if (!entitySharesPlayerStreamChunk(entity) || entity.health <= 0) continue;
      const role = ecologyRole(entity);
      if (role && groups[role]) groups[role].push(entity);
    }
    return groups;
  }
  function hasSharedEnemyNearby(entity) {
    if (!entitySharesPlayerStreamChunk(entity)) return false;
    for (const other of combatDeps?.hostileObjects || []) {
      if (other === entity || !entitySharesPlayerStreamChunk(other) || other.health <= 0) continue;
      const role = ecologyRole(other);
      if (role === 'bandit' || role === 'predator') {
        if (entity?.isPorakanekiHunter) entity._porakanekiSharedEnemyUntilMs = nowMs() + 1500;
        return true;
      }
    }
    return entity?.isPorakanekiHunter === true && nowMs() < num(entity._porakanekiSharedEnemyUntilMs, 0);
  } // "Nearby" intentionally means the observed 16x16 player chunk, with a 1.5s grace so simultaneous crossfire deaths stay forgiven.
  function updateChunkEcology() {
    const observedChunk = playerStreamChunk(); // Used both as the hard simulation gate and the mobile-visible debug identity.
    if (!combatDeps?.hostileObjects || !observedChunk) return;
    const groups = activePlayerChunkEcology();
    const active = new Set([...groups.porakaneki, ...groups.bandit, ...groups.predator, ...groups.prey]);
    let humanoidTargets = 0; // Counted below for Pixel-Probe/debugSnapshot verification without inspecting entity internals.
    let predatorTargets = 0; // Counted below for the same mobile-visible ecology summary.

    // Clear only targets this system previously owned once either participant
    // leaves the player's chunk. No actor-vs-actor simulation continues offscreen.
    for (const entity of combatDeps.hostileObjects) {
      if (active.has(entity)) continue;
      if (entity._chunkCombatTarget) entity._chunkCombatTarget = null;
      if (entity._chunkFactionEcologyTarget) setPredatorEcologyTarget(entity, null);
    }

    for (const bandit of groups.bandit) {
      const target = nearestEcologyTarget(bandit, [...groups.porakaneki, ...groups.predator]);
      setHumanoidEcologyTarget(bandit, target);
      if (target) humanoidTargets++;
    }
    for (const hunter of groups.porakaneki) {
      const threat = nearestEcologyTarget(hunter, [...groups.bandit, ...groups.predator]);
      const prey = threat ? null : nearestEcologyTarget(hunter, groups.prey);
      const target = threat || prey;
      setHumanoidEcologyTarget(hunter, target);
      if (target) humanoidTargets++;
    }
    for (const predator of groups.predator) {
      const target = nearestEcologyTarget(predator, [...groups.porakaneki, ...groups.bandit]);
      setPredatorEcologyTarget(predator, target);
      if (target) predatorTargets++;
    }
    state.ecology = {
      chunk: `${observedChunk.x},${observedChunk.y}`,
      porakaneki: groups.porakaneki.length,
      bandits: groups.bandit.length,
      predators: groups.predator.length,
      prey: groups.prey.length,
      humanoidTargets,
      predatorTargets,
    };
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
  function ensureCampHunters(camp) {
    if (!camp?.center) return;
    while (camp.hunters.length < camp.residentTarget) {
      const index = camp.hunters.length;
      const spawn = randomCampPoint(camp, camp.rng);
      camp.hunters.push({
        id: `${camp.id}:resident:${index}`,
        index,
        camp,
        weaponShape: weaponRoll(camp.rng),
        x: spawn.col,
        y: spawn.row,
        activity: 'camp',
        target: null,
        decisionT: camp.rng() * 2,
        entity: null,
        building: false,
        dormantSinceMs: null,
        sleepDay: -1,
        sleepPoint: null,
        greetingDay: -1,
        lastHealth: null,
        killCounted: false,
      });
    }
  }

  function campDens(camp) {
    return Array.isArray(camp?.zoneState?.layoutRef?.dens)
      ? camp.zoneState.layoutRef.dens.filter(den => den && den.id != null && !den.collapsed)
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
    return camp.hunters.filter(hunter => ids.has(hunter.id) && !hunter.killCounted && (!hunter.entity || hunter.entity.health > 0));
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
    const eligible = camp.hunters.filter(hunter => !hunter.killCounted && (!hunter.entity || hunter.entity.health > 0));
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
      const peers = camp.hunters.filter(other => other !== hunter && Math.hypot(other.x - hunter.x, other.y - hunter.y) <= 14);
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
    const step = Math.min(distance, num(cfg?.behavior?.travelSpeedTilesPerSecond, 1.05) * dt);
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
      const entity = await window.BanditCombat.makeEntity({
        ...base,
        speciesWeights: { [SPECIES_ID]: 1 },
        rangedWeaponChanceByRank: { grunt: 0, lieutenant: 0, captain: 0 },
      }, 'grunt', 0, hunter.x * combatDeps.TILE, hunter.y * combatDeps.TILE, {
        zoneId: camp.zoneId,
        nameOverride: 'Porakaneki Hunter',
        bodyColorsOverride: window.HobunjiPorakanekiSpecies?.bodyColorsForSeed?.(hunter.id, 'male') || null,
        defOverride: {
          label: 'Porakaneki Hunter',
          weaponKey: weapon.weaponKey,
          weaponShapeKey: weapon.shapeKey,
          weaponMetalKey: weapon.metalKey,
          attackTag: weapon.attackTag,
          rangedWeaponKey: weapon.ranged ? weapon.weaponKey : null,
        },
        extra: {
          isPorakanekiHunter: true,
          porakanekiHunterIndex: hunter.index,
          porakanekiCampId: camp.id,
          porakanekiCampKind: camp.kind,
          porakanekiWeaponShape: weapon.shapeKey,
        },
      });
      if (!entity || generation !== buildGeneration) { entity?.avatarRef?.dispose?.(); return null; }
      hunter.entity = entity;
      hunter.lastHealth = entity.health;
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
    const neutralSpeed = num(cfg?.behavior?.travelSpeedTilesPerSecond, 1.05) * combatDeps.TILE;
    if (entity.def) {
      entity.def.aggroRangePx = 0;
      entity.def.moveSpeed = neutralSpeed;
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
          adjustFavor(-Math.abs(num(cfg?.reputation?.killPenalty, -1)), `porakaneki_kill_${camp.id}_${hunter.index}`);
          state.kills += 1;
        } else {
          state.lastReason = `porakaneki-crossfire-forgiven:${camp.id}:${hunter.index}`;
        }
      }
      hunter.lastHealth = health;
    }
  }

  function maybeHunterGreeting(hunter) {
    if (hunter.greetingDay === gameDay() || favor() < num(cfg?.reputation?.greetingFavorThreshold, 1) || !sharesPlayerChunk(hunter)) return;
    const player = playerTilePosition();
    if (!player || Math.hypot(hunter.x - player.col, hunter.y - player.row) > num(cfg?.reputation?.greetingRadiusTiles, 3)) return;
    const text = chooseLine(cfg?.reputation?.greetingLines) || 'A Porakaneki hunter greets you.';
    if (speakOverheadFromHunter(hunter, text, { tone: 'greeting' })) {
      hunter.greetingDay = gameDay();
      state.greetings += 1;
    }
  }
  function updateDetailedHunter(hunter, dt) {
    const entity = hunter.entity;
    if (!entity || entity.health <= 0) return;
    hunter.x = entity.x / combatDeps.TILE; hunter.y = entity.y / combatDeps.TILE;
    if (favor() <= num(cfg?.reputation?.attackOnSightFavor, -5) || campProvoked(hunter.camp)) {
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
    if (!hunter.entity && !hunter.building) materializeHunter(hunter, generation).catch(error => window.__farmLog?.(`[porakaneki] materialize failed: ${error.message}`, 'warn'));
    if (hunter.entity) { placeEntityIfDormant(hunter); updateDetailedHunter(hunter, dt); }
  }
  function updateCampHunters(camp, dt, coarseDt) {
    ensureCampHunters(camp);
    updateViolence(camp);
    const generation = buildGeneration;
    const sleeping = isSleepingHour();
    if (sleeping) clearHuntingParty(camp);
    else {
      ensureHuntingParty(camp);
      updateHuntingParty(camp, coarseDt > 0 ? coarseDt : dt);
    }
    for (const hunter of camp.hunters) {
      try { updateCampHunterTick(hunter, dt, coarseDt, sleeping, generation); }
      catch (error) { window.__farmLog?.(`[porakaneki] hunter tick failed (${hunter.id}): ${error?.message || error}`, 'warn'); }
    }
  }
  function updateAllHunters(dt, coarseDt) {
    for (const zoneState of state.zones.values()) {
      for (const camp of activeCamps(zoneState)) {
        try { updateCampHunters(camp, dt, coarseDt); }
        catch (error) { window.__farmLog?.(`[porakaneki] camp tick failed (${camp.id}): ${error?.message || error}`, 'warn'); }
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
      state.lastReason = 'config-ready';
      return cfg;
    } catch (error) {
      state.lastReason = `config-error:${error.message}`;
      window.__farmLog?.(`[porakaneki] ${error.message}`, 'warn', 'wildlife');
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
    ensureCurrentCampMeshes();
    // Start/promote nearby residents before attempting territory speech. Async
    // portrait construction may still finish on a later tick, in which case the
    // warning remains pending rather than being consumed as a toast.
    updateAllHunters(step, coarseStep);
    updateChunkEcology(); // Assigns only same-stream-chunk actor targets; movement/attacks remain in the existing per-frame combat loops.
    updateTerritoryWarnings();
    maybeChiefGreeting();
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
  function watchNamespace(name, installer) {
    if (installer(window[name])) return;
    const descriptor = Object.getOwnPropertyDescriptor(window, name);
    if (descriptor && !descriptor.configurable) return;
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
      attackOnSight: !!relation && !!cfg && num(relation.favor, 0) <= num(cfg.reputation?.attackOnSightFavor, -5),
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
      chiefPlannerAgenda: !!chiefWalker()?.rec?.agenda?.some?.(beat => beat.id === 'porakaneki_day'),
      zones,
      stamps: state.stamps,
      materializations: state.materializations,
      coarseTicks: state.coarseTicks,
      greetings: state.greetings,
      kills: state.kills,
      ecology: { ...state.ecology },
      lastReason: state.lastReason,
    };
  }

  window.PorakanekiCamps = Object.freeze({
    version: 8,
    update,
    ensureWorldCamps,
    ensureCampStamp: ensureWorldCamps,
    initializeReputation,
    favor,
    reservedCampChunks,
    reduceHuntingCampsForBandit,
    occupiedSites,
    hasSharedEnemyNearby,
    debugSnapshot,
    formatDebug: () => {
      const d = debugSnapshot();
      const zoneBits = Object.entries(d.zones).map(([zoneId, z]) => `${zoneId}:${z.smallCampCount}${z.chiefActive ? '+CHIEF' : ''}`).join(' ');
      return `Porakaneki camps: v8 ticks=${d.updateTicks} owner=${d.tickOwner} season=${d.season} chief=${d.chiefZoneId || '-'} area=${d.currentArea || '-'} small=${d.totalSmallCamps} active=${d.totalActiveCamps} residents=${d.totalGeneratedResidents} favor=${d.favor ?? '-'} AOS=${d.attackOnSight} lod=${d.fullSimulationRadiusTiles}/${d.fullSimulationReleaseRadiusTiles} player=${d.playerTile ? `${d.playerTile.col},${d.playerTile.row}` : '-'} ecology=${d.ecology.chunk || '-'}:${d.ecology.porakaneki}/${d.ecology.bandits}/${d.ecology.predators}/${d.ecology.prey} targets=${d.ecology.humanoidTargets}/${d.ecology.predatorTargets} mats=${d.materializations} coarse=${d.coarseTicks} greet=${d.greetings} kills=${d.kills} zones=[${zoneBits}] reason=${d.lastReason}`;
    },
    __test: Object.freeze({ MIN_HUNTING_CAMPS_PER_ZONE, isSleepingHour, chunkOf, streamChunkSizeTiles, streamChunkKeysForSite, streamChunkOfTile, ecologyRole, nearestEcologyTarget, activePlayerChunkEcology, updateChunkEcology, fullSimulationRadiusTiles, fullSimulationReleaseRadiusTiles, simulationDistanceToPlayer, weaponRoll, currentSeasonName, desiredChiefZone, smallCampCountForZone, smallResidentCount, denExteriorPoint, chooseNextPartyDen, ensureHuntingParty, updateHuntingParty, speakOverheadFromHunter, speakOverheadFromWalker }),
  });

  watchNamespace('BanditCombat', installBanditCombat);
  watchNamespace('NpcScheduling', installScheduling);
  if (!installRuntimeTick()) {
    state.tickOwner = 'BanditCamps-fallback';
    watchNamespace('BanditCamps', installTick);
  }
  loadConfig();
})();
