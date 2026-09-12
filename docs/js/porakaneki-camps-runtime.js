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
  // only while an individual shares the player's wilderness chunk. Everywhere
  // else the character is an abstract position/activity updated every few
  // seconds.
  const CONFIG_URL = 'config/porakaneki-camp.json'; // Network/population/LOD/reputation tuning loaded once at startup.
  const SMALL_LOCALE_URL = 'config/locales/locale_porakaneki_camp_small.json'; // Little procedural-only camp footprint.
  const CHIEF_LOCALE_URL = 'config/locales/locale_porakaneki_camp_chief.json'; // Large seasonally migrating chief-camp footprint.
  const SPECIES_ID = 'porakaneki'; // Forced species for every generated camp resident.
  const DORMANT_AREA_PREFIX = '__porakaneki_dormant__:'; // Removes hidden/off-chunk residents from the normal hostile loop.
  const TICK_INTERVAL_S = 0.20; // Neutral LOD/planning cadence; hostile combat still uses the normal combat loop.
  const PROVOKE_SECONDS = 45; // Temporary same-camp self-defense window after an assault without permanent Favor loss.

  let combatDeps = null; // Captured from BanditCombat.init; movement/scenes/terrain/tools/hostileObjects.
  let schedulingDeps = null; // Captured from NpcScheduling.init; live named-chief walker.
  let cfg = null; // Parsed porakaneki-camp.json.
  let smallLocaleDef = null; // Parsed small-camp locale.
  let chiefLocaleDef = null; // Parsed large chief-camp locale.
  let gangCfg = null; // Existing humanoid combat balance reused by generated residents.
  let tickAccum = 0; // Accumulates detailed neutral update time.
  let coarseAccum = 0; // Accumulates off-chunk abstract update time.
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
  };

  const num = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
  const nowMs = () => typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  const rand = () => {
    const value = combatDeps?.rnd?.(); // Uses the world's normal RNG when available for moment-to-moment behavior.
    return Number.isFinite(value) ? value : Math.random();
  };

  function currentArea() { return combatDeps?.getCurrentArea?.() || null; }
  function gameHour() {
    const value = Number(window.CalendarSystem?.getHour?.()); // Same 24-hour clock normal NPC planning uses.
    return Number.isFinite(value) ? ((value % 24) + 24) % 24 : 12;
  }
  function gameDay() {
    const raw = Number(window.CalendarSystem?.timeDebugSnapshot?.()?.rawDay); // Stable day key for greetings/nightly tent choice.
    if (Number.isFinite(raw)) return Math.max(0, Math.floor(raw));
    return Math.max(0, Math.floor(Number(combatDeps?.calendar?.day ?? 0) || 0));
  }
  function generationYear() {
    const year = Number(window.CalendarSystem?.yearNumber?.()); // Matches the Tothal wilderness-generation cycle used by game.js.
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
    const start = num(cfg?.schedule?.sleepStartHour, 22); // Shared night schedule for generated residents and the named chief.
    const wake = num(cfg?.schedule?.wakeHour, 6);
    return start > wake ? (hour >= start || hour < wake) : (hour >= start && hour < wake);
  }

  function hashSeed(text) {
    let h = 2166136261 >>> 0; // Deterministic FNV-style seed used for generation-stable camp placement/population.
    for (const ch of String(text || '')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function seededRng(text) {
    let a = hashSeed(text) || 0x9e3779b9; // Mulberry32 keeps each Tothal generation reproducible.
    return () => {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function integerRoll(rng, min, max) {
    const lo = Math.floor(Math.min(min, max)), hi = Math.floor(Math.max(min, max)); // Inclusive deterministic integer roll for camp/population counts.
    return lo + Math.floor(rng() * (hi - lo + 1));
  }

  function buildZoneView(zoneId, layout) {
    if (!layout?.cols || !layout?.rows || !combatDeps) return null;
    const cols = layout.cols, rows = layout.rows; // Sparse generated-layout dimensions inflated for TemporaryLocales site fitting.
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
      }; // TemporaryLocales fields only; the generated terrain itself remains untouched.
      tiles[source.r][source.c] = tile;
      if (source.type === combatDeps.TileType?.SHRUB || source.type === combatDeps.TileType?.ROCK) {
        const id = `porakaneki_clutter_${source.c}_${source.r}`;
        tile.occupiedBy = id;
        objects.push({ id, type: 'unique', x: source.c, y: source.r, w: 1, h: 1, localeMeta: true });
      }
    }

    let blockerSeq = 0; // Unique occupancy ids for generated structures/landmarks copied into the site-fit view.
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

    const zoneDef = combatDeps.EXTERIOR_ZONES?.[zoneId]; // Entry fallback for layouts without an explicit to-town exit.
    const entry = layout.toTownExit
      ? { x: layout.toTownExit.col, y: layout.toTownExit.row }
      : (Number.isFinite(zoneDef?.entryCol) ? { x: zoneDef.entryCol, y: zoneDef.entryRow } : null);
    return { cols, rows, tiles, objects, entry };
  }

  function pointIsOpen(zoneState, col, row) {
    const c = Math.floor(col), r = Math.floor(row); // Abstract residents still respect the runtime occupancy view.
    const tile = zoneState?.view?.tiles?.[r]?.[c];
    return !!tile && !tile.water && !tile.waterfall && !tile.occupiedBy;
  }
  function nearestOpenPoint(zoneState, col, row) {
    const cols = zoneState?.view?.cols || 1, rows = zoneState?.view?.rows || 1;
    const baseCol = clamp(col, 1.25, Math.max(1.25, cols - 1.25));
    const baseRow = clamp(row, 1.25, Math.max(1.25, rows - 1.25));
    if (pointIsOpen(zoneState, baseCol, baseRow)) return { col: baseCol, row: baseRow };
    for (let radius = 1; radius <= 4; radius++) {
      for (let attempt = 0; attempt < 16; attempt++) {
        const angle = attempt / 16 * Math.PI * 2;
        const candidate = { col: baseCol + Math.cos(angle) * radius, row: baseRow + Math.sin(angle) * radius };
        if (pointIsOpen(zoneState, candidate.col, candidate.row)) return candidate;
      }
    }
    return { col: baseCol, row: baseRow };
  }
  function randomPointAround(camp, origin, minRadius, maxRadius, rng = rand) {
    const angle = rng() * Math.PI * 2; // Fresh direction prevents route-like repeated movement.
    const distance = minRadius + rng() * Math.max(0, maxRadius - minRadius);
    return nearestOpenPoint(camp.zoneState, origin.col + Math.cos(angle) * distance, origin.row + Math.sin(angle) * distance);
  }

  function propsForInstance(view, instance) {
    return (view?.objects || []).filter(object => object.temporaryLocaleInstanceId === instance?.id); // Runtime render list for one stamped/reserved locale.
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
      propMeshes: new Map(),
      provokedUntilMs: 0,
      warningEnteredAtMs: 0,
      warningInitialShown: false,
      warningEscalated: false,
    }; // Self-contained camp state lets small camps remain stable while the chief camp migrates independently.
  }

  function teardownEntity(hunter) {
    const entity = hunter?.entity;
    if (!entity) return;
    const index = combatDeps?.hostileObjects?.indexOf?.(entity); // Only removes this generated Porakaneki entity from the shared combat array.
    if (index >= 0) combatDeps.hostileObjects.splice(index, 1);
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
      disposeObject3D(entry.mesh);
    }
    camp?.propMeshes?.clear?.();
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
    const rng = seededRng(`${generationYear()}:${zoneId}:porakaneki-small-count`); // Stable 2-4 roll for this wilderness generation.
    return integerRoll(rng, num(small.minPerZone, 2), num(small.maxPerZone, 4));
  }
  function smallResidentCount(zoneId, campIndex) {
    const small = cfg?.smallCamps || {};
    const rng = seededRng(`${generationYear()}:${zoneId}:porakaneki-small-${campIndex}:population`); // Each little camp gets its own stable 2-4 resident roll.
    return integerRoll(rng, num(small.minResidents, 2), num(small.maxResidents, 4));
  }

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
    }; // One persistent runtime camp network for this generated wilderness layout.

    // Reserve the large site FIRST in every zone. Only one reservation is
    // activated/rendered at a time, but keeping a silent reservation elsewhere
    // guarantees a seasonal migration never has to evict or reshuffle small camps.
    zoneState.chiefReservation = window.TemporaryLocales.stamp(view, chiefLocaleDef, {
      rng: seededRng(`${generationYear()}:${zoneId}:porakaneki-chief-site`),
      clearableTypes: new Set(),
      clearanceTiles: chiefLocaleDef.placement?.clearanceTiles ?? 3,
      requiresFlatGround: chiefLocaleDef.placement?.requiresFlatGround !== false,
      minDistanceFromEntry: chiefLocaleDef.placement?.minDistanceFromEntry ?? 14,
      instanceId: `porakaneki_chief_reservation_${zoneId}`,
    });
    if (zoneState.chiefReservation) state.stamps += 1;

    const targetCount = smallCampCountForZone(zoneId);
    for (let i = 0; i < targetCount; i++) {
      const instance = window.TemporaryLocales.stamp(view, smallLocaleDef, {
        rng: seededRng(`${generationYear()}:${zoneId}:porakaneki-small-site:${i}`),
        clearableTypes: new Set(),
        clearanceTiles: smallLocaleDef.placement?.clearanceTiles ?? 2,
        requiresFlatGround: smallLocaleDef.placement?.requiresFlatGround !== false,
        minDistanceFromEntry: smallLocaleDef.placement?.minDistanceFromEntry ?? 10,
        instanceId: `porakaneki_small_${zoneId}_${i}`,
      });
      if (!instance) continue;
      zoneState.smallCamps.push(makeCamp(zoneState, instance, 'small', smallResidentCount(zoneId, i), `small-${i}`));
      state.stamps += 1;
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
    zoneState.chiefCamp = null; // Reservation remains silently stamped so the site is available next season/year.
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
    for (const zoneId of (cfg.wildernessZones || [])) ensureZoneState(zoneId); // Builds little camps on every generated wilderness map, not only the current one.
    syncChiefCamp();
    return state.zones.size > 0;
  }

  function activeCamps(zoneState) {
    return zoneState ? [...zoneState.smallCamps, ...(zoneState.chiefCamp ? [zoneState.chiefCamp] : [])] : [];
  }
  function currentZoneState() { return state.zones.get(currentArea()) || null; }

  function tentMesh() {
    const group = new THREE.Group(); // Lightweight shared tent render used by both small and chief camps.
    const shell = new THREE.Mesh(new THREE.ConeGeometry(0.9, 1.2, 5, 1, false, -Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x8b7656, side: THREE.DoubleSide }));
    shell.position.y = 0.6;
    shell.castShadow = true;
    const doorway = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.55), new THREE.MeshBasicMaterial({ color: 0x18130f, side: THREE.DoubleSide }));
    doorway.position.set(0, 0.28, 0.91);
    group.userData.projectileCoverHeightTiles = 1.2;
    group.userData.projectileCoverRadiusTiles = 0.9;
    group.userData.projectileCoverKind = 'porakaneki-tent';
    group.add(shell, doorway);
    return group;
  }
  function crateMesh() {
    const group = new THREE.Group(); // Fallback supplies mesh for crateStack locale props.
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.65, 0.75), new THREE.MeshLambertMaterial({ color: 0x6b4d2c }));
    box.position.y = 0.325;
    box.castShadow = true;
    group.add(box);
    return group;
  }
  function campfireMesh() {
    const built = window.ProceduralFurniture?.buildFurnitureGroup?.('campfire', 0x6b4a28); // Prefer existing player-furniture campfire art when available.
    if (built) return built;
    const group = new THREE.Group();
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.48, 6), new THREE.MeshBasicMaterial({ color: 0xff8a22 }));
    flame.position.y = 0.25;
    group.add(flame);
    return group;
  }
  function ensureCampMeshes(camp) {
    if (!camp || currentArea() !== camp.zoneId || typeof THREE === 'undefined') return;
    const zone = combatDeps.zoneScenes?.get?.(camp.zoneId);
    if (!zone?.scene) return;
    const live = new Set(); // Removes stale prop meshes after wilderness regeneration/deactivation.
    for (const prop of camp.props) {
      live.add(prop.id);
      const prior = camp.propMeshes.get(prop.id);
      if (prior?.mesh?.parent === zone.scene) continue;
      if (prior) { if (prior.light) prior.light.parent?.remove?.(prior.light); disposeObject3D(prior.mesh); camp.propMeshes.delete(prop.id); }
      const col = prop.x + (prop.w || 1) * 0.5, row = prop.y + (prop.h || 1) * 0.5;
      const tile = zone.grid?.[Math.floor(row)]?.[Math.floor(col)];
      const y = tile && combatDeps.tileSurfaceYInArea ? num(combatDeps.tileSurfaceYInArea(tile, camp.zoneId), 0) : 0;
      let mesh = prop.type === 'tent' ? tentMesh() : prop.key === 'campfire' ? campfireMesh() : crateMesh();
      if (!mesh) continue;
      mesh.position.set(col, y, row);
      combatDeps.markOutline?.(mesh);
      zone.scene.add(mesh);
      let light = null;
      if (prop.key === 'campfire') {
        light = new THREE.PointLight(0xff7722, 1.1, 3.2); // One modest local light per active rendered campfire.
        light.position.set(col, y + 0.45, row);
        light.userData.furnitureLightMask = true;
        zone.scene.add(light);
      }
      camp.propMeshes.set(prop.id, { mesh, light });
    }
    for (const [id, entry] of [...camp.propMeshes]) if (!live.has(id)) { if (entry.light) entry.light.parent?.remove?.(entry.light); disposeObject3D(entry.mesh); camp.propMeshes.delete(id); }
  }
  function ensureCurrentCampMeshes() {
    const zoneState = currentZoneState();
    for (const camp of activeCamps(zoneState)) ensureCampMeshes(camp); // Inactive chief reservations are deliberately never rendered.
  }

  function tentCenters(camp) {
    return (camp?.props || []).filter(prop => prop.type === 'tent').map(prop => ({ col: prop.x + (prop.w || 1) * 0.5, row: prop.y + (prop.h || 1) * 0.5 })); // Shared nightly sleep pool; no permanent tent ownership.
  }

  function chiefWalker() {
    const id = cfg?.reputation?.npcId || 'porakaneki_chief'; // Named chief remains a normal NPC walker/social target.
    return schedulingDeps?.npcWalkers?.find?.(walker => walker?.rec?.id === id) || null;
  }
  function authorChiefBehavior() {
    const camp = state.zones.get(state.chiefZoneId)?.chiefCamp;
    const walker = chiefWalker();
    if (!camp || !walker?.rec || !window.NpcScheduling?.registerNpcStations) return false;
    const key = `${state.chiefSeason}:${camp.id}:${camp.center.col.toFixed(2)}:${camp.center.row.toFixed(2)}`; // Rewrites only on seasonal migration or wilderness regeneration.
    if (state.chiefBehaviorKey === key && walker.rec.scheduleHooks?.__porakanekiCampRuntime) return true;

    const role = 'porakaneki-chief-sleep';
    window.NpcScheduling.registerNpcStations(tentCenters(camp).map((tent, index) => ({
      id: `porakaneki_chief_sleep_${camp.zoneId}_${index}`,
      label: 'Porakaneki Chief Camp Tent',
      area: camp.zoneId,
      c: tent.col,
      r: tent.row,
      pose: 'lie',
      roles: [role],
    })), camp.zoneId); // The chief can use any tent in the current large camp rather than owning a fixed coordinate.

    walker.rec.gender = 'male';
    walker.rec.species = SPECIES_ID;
    walker.rec.appearance = { ...(walker.rec.appearance || {}), speciesId: SPECIES_ID, gender: 'male' };
    walker.rec.scheduleHooks = {
      ...(walker.rec.scheduleHooks || {}),
      defaultMapId: camp.zoneId,
      defaultPosition: { c: camp.center.col, r: camp.center.row }, // Spawn fallback only; daytime behavior remains planner-driven.
      __porakanekiCampRuntime: true,
      rules: [],
    };
    walker.rec.agenda = [
      { id: 'porakaneki_sleep_late', activity: 'goToRole', obligation: 'plan', window: ['22:00', '23:59'], destinationRole: role, destinationArea: camp.zoneId, activityLabel: 'sleeping' },
      { id: 'porakaneki_sleep_early', activity: 'goToRole', obligation: 'plan', window: ['00:00', '06:00'], destinationRole: role, destinationArea: camp.zoneId, activityLabel: 'sleeping' },
      { id: 'porakaneki_day', activity: 'break', obligation: 'leisure', window: ['06:00', '22:00'], destinationArea: camp.zoneId, activityLabel: 'around the chief camp' },
    ]; // Daytime intentionally falls through the normal free-time planner instead of fixed work/patrol points.
    state.chiefBehaviorKey = key;
    return true;
  }

  function relationshipState() {
    const id = cfg?.reputation?.npcId || 'porakaneki_chief'; // Chief relationship record is the tribe-wide persistent Favor score.
    return window.DialogueContent?.getNpcDlgState?.(id) || window.DialogueContent?.npcDlgState?.get?.(id) || null;
  }
  function memoryHas(relation, event) { return !!relation?.memory?.some?.(entry => entry?.event === event || entry?.type === event); }
  function pushMemory(relation, event) {
    if (!relation) return;
    relation.memory ||= [];
    relation.memory.push({ event, day: gameDay(), ts: Date.now() }); // Minimal serializable relationship-memory event.
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
    return lines[Math.floor(rand() * lines.length)] || lines[0]; // Keeps repeated camp approaches from always using the same warning.
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
    if (!nearest.warningEnteredAtMs) nearest.warningEnteredAtMs = nowMs();
    if (!nearest.warningInitialShown) {
      nearest.warningInitialShown = true;
      const text = chooseLine(rep.initialWarnings);
      if (text) combatDeps.showToast?.(text, false);
    }
    if (!nearest.warningEscalated && nowMs() - nearest.warningEnteredAtMs >= num(rep.warningStaySeconds, 10) * 1000) {
      nearest.warningEscalated = true;
      const text = chooseLine(rep.escalationWarnings);
      if (text) combatDeps.showToast?.(text, false);
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
    combatDeps.showToast?.('The Porakaneki chief greets you.', true);
    state.greetings += 1;
  }

  function chunkSizeTiles() { return Math.max(2, Math.floor(num(cfg?.behavior?.fullSimulationChunkTiles, 10))); }
  function chunkOf(col, row) {
    const size = chunkSizeTiles();
    return { x: Math.floor(col / size), y: Math.floor(row / size) };
  }
  function playerTilePosition() {
    if (!combatDeps?.player || !combatDeps?.TILE) return null;
    return { col: combatDeps.player.x / combatDeps.TILE, row: combatDeps.player.y / combatDeps.TILE };
  }
  function sharesPlayerChunk(hunter) {
    if (!hunter || currentArea() !== hunter.camp.zoneId) return false;
    const player = playerTilePosition();
    if (!player) return false;
    const a = chunkOf(hunter.x, hunter.y), b = chunkOf(player.col, player.row);
    return a.x === b.x && a.y === b.y;
  }

  function weaponRoll(rng = rand) {
    const shapes = Array.isArray(cfg?.equipment?.weaponShapes) && cfg.equipment.weaponShapes.length ? cfg.equipment.weaponShapes : ['fishingspear', 'hatchet', 'daggerSword'];
    return shapes[Math.floor(rng() * shapes.length)] || shapes[0]; // Independent sample per resident; duplicates are deliberately legal.
  }
  function weaponDef(shapeKey) {
    const metalKey = cfg?.equipment?.weaponMetalKey || 'nativeCopper';
    const shape = combatDeps?.HELD_SHAPE_DEFS?.[shapeKey] || {};
    return {
      shapeKey,
      metalKey,
      weaponKey: combatDeps?.craftedToolItemKey?.(shapeKey, metalKey) || shapeKey,
      attackTag: shape.dmgType || 'sharp',
      ranged: shapeKey === 'daggerSword',
    };
  }
  function randomCampPoint(camp, rng = rand) {
    const radius = num(cfg?.behavior?.campSocialRadiusTiles, 8);
    return randomPointAround(camp, camp.center, 1.5, radius, rng); // Broad home area, never one assigned standing point.
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
        sleepDay: -1,
        sleepPoint: null,
        greetingDay: -1,
        lastHealth: null,
        killCounted: false,
      }); // Entire small-camp population is procedural; the named chief exists only through chiefWalker().
    }
  }

  function chooseHunterActivity(hunter) {
    const camp = hunter.camp;
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
      ['hunt', Math.max(0, num(weights.hunt, 0.52))],
      ['wander', Math.max(0, num(weights.wander, 0.24))],
      ['socialize', Math.max(0, num(weights.socialize, 0.16))],
      ['camp', Math.max(0, num(weights.camp, 0.08))],
    ]; // Loose opportunity selection mirrors normal NPC free-time behavior instead of a patrol script.
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
    if (activity === 'hunt') hunter.target = randomPointAround(camp, camp.center, num(cfg?.behavior?.huntRadiusMinTiles, 7), num(cfg?.behavior?.huntRadiusMaxTiles, 22));
    else if (activity === 'camp') hunter.target = randomCampPoint(camp);
    else hunter.target = randomPointAround(camp, { col: hunter.x, row: hunter.y }, 2, num(cfg?.behavior?.localWanderRadiusTiles, 7));
  }

  function sleepPointFor(hunter) {
    if (hunter.sleepDay === gameDay() && hunter.sleepPoint) return hunter.sleepPoint;
    const tents = tentCenters(hunter.camp);
    const rng = seededRng(`${generationYear()}:${hunter.camp.id}:sleep:${gameDay()}:${hunter.index}`); // Night-stable, but rerolled every day and never permanently assigned.
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
    const wasDetailed = entity.areaId === hunter.camp.zoneId && !!entity.avatarRef?.group?.visible; // Capture transform once when collapsing; repeated coarse ticks must not snap abstract movement backward.
    if (wasDetailed) { hunter.x = entity.x / combatDeps.TILE; hunter.y = entity.y / combatDeps.TILE; }
    entity.areaId = `${DORMANT_AREA_PREFIX}${hunter.camp.zoneId}`;
    if (entity.avatarRef?.group) entity.avatarRef.group.visible = false;
    if (entity.groundShadow) entity.groundShadow.visible = false;
    if (entity._banditToolHolder) entity._banditToolHolder.visible = false;
    if (entity._banditRangedToolHolder) entity._banditRangedToolHolder.visible = false;
    entity.vx = 0; entity.vy = 0;
  }
  function placeEntity(hunter) {
    const entity = hunter?.entity, camp = hunter?.camp;
    if (!entity || !camp || currentArea() !== camp.zoneId) return false;
    const open = nearestOpenPoint(camp.zoneState, hunter.x, hunter.y);
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
        nameOverride: 'Porakaneki Hunter', // Appearance still rolls procedurally through BanditCombat's normal roster generator.
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
      combatDeps.hostileObjects.push(entity);
      state.materializations += 1;
      placeEntity(hunter);
      return entity;
    } finally { hunter.building = false; }
  }

  function makeNeutral(entity, hunter) {
    if (!entity || entity.health <= 0) return;
    entity._porakanekiAggroRangePx ??= num(entity.def?.aggroRangePx, combatDeps.TILE * 6);
    if (entity.def) entity.def.aggroRangePx = 0;
    entity.state = `porakaneki:${hunter.activity}`;
    entity._banditAction = null;
    entity._rangedAction = null;
    entity._rangedMode = false;
    entity.wanderTarget = null;
  }
  function makeHostile(entity) {
    if (!entity || entity.health <= 0) return;
    entity._porakanekiAggroRangePx ??= num(entity.def?.aggroRangePx, combatDeps.TILE * 6);
    if (entity.def) entity.def.aggroRangePx = entity._porakanekiAggroRangePx;
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
      if (health < previous && close) camp.provokedUntilMs = Math.max(camp.provokedUntilMs, nowMs() + PROVOKE_SECONDS * 1000); // Only this camp joins immediate self-defense.
      if (previous > 0 && health <= 0 && !hunter.killCounted && close) {
        hunter.killCounted = true;
        adjustFavor(-Math.abs(num(cfg?.reputation?.killPenalty, -1)), `porakaneki_kill_${camp.id}_${hunter.index}`);
        state.kills += 1;
      }
      hunter.lastHealth = health;
    }
  }

  function maybeHunterGreeting(hunter) {
    if (hunter.greetingDay === gameDay() || favor() < num(cfg?.reputation?.greetingFavorThreshold, 1) || !sharesPlayerChunk(hunter)) return;
    const player = playerTilePosition();
    if (!player || Math.hypot(hunter.x - player.col, hunter.y - player.row) > num(cfg?.reputation?.greetingRadiusTiles, 3)) return;
    hunter.greetingDay = gameDay();
    combatDeps.showToast?.('A Porakaneki hunter greets you.', true);
    state.greetings += 1;
  }
  function updateDetailedHunter(hunter, dt) {
    const entity = hunter.entity;
    if (!entity || entity.health <= 0) return;
    hunter.x = entity.x / combatDeps.TILE; hunter.y = entity.y / combatDeps.TILE;
    if (favor() <= num(cfg?.reputation?.attackOnSightFavor, -5) || campProvoked(hunter.camp)) { makeHostile(entity); return; }

    makeNeutral(entity, hunter);
    hunter.decisionT -= dt;
    const reached = hunter.target && Math.hypot(hunter.target.col - hunter.x, hunter.target.row - hunter.y) < 0.75;
    if (!hunter.target || hunter.decisionT <= 0 || reached) {
      chooseHunterActivity(hunter);
      const min = num(cfg?.behavior?.decisionMinSeconds, 4), max = Math.max(min, num(cfg?.behavior?.decisionMaxSeconds, 11));
      hunter.decisionT = min + rand() * (max - min);
      makeNeutral(entity, hunter);
    }
    if (hunter.target) {
      const tx = hunter.target.col * combatDeps.TILE, ty = hunter.target.row * combatDeps.TILE;
      entity.facing = Math.atan2(ty - entity.y, tx - entity.x);
      combatDeps.moveCreatureToward?.(entity, tx, ty, num(cfg?.behavior?.travelSpeedTilesPerSecond, 1.05) * combatDeps.TILE, dt);
      hunter.x = entity.x / combatDeps.TILE; hunter.y = entity.y / combatDeps.TILE;
    }
    maybeHunterGreeting(hunter);
  }
  function placeEntityIfDormant(hunter) {
    const entity = hunter.entity;
    if (entity && (entity.areaId !== hunter.camp.zoneId || !entity.avatarRef?.group?.visible)) placeEntity(hunter);
  }

  function updateCampHunters(camp, dt, coarseDt) {
    ensureCampHunters(camp);
    updateViolence(camp);
    const generation = buildGeneration;
    const sleeping = isSleepingHour();
    for (const hunter of camp.hunters) {
      if (hunter.entity?.health <= 0 || hunter.killCounted && hunter.entity?.health <= 0) continue;
      if (sleeping) {
        hideEntity(hunter);
        if (coarseDt > 0 || currentArea() === camp.zoneId) advanceAbstractHunter(hunter, coarseDt || dt);
        continue;
      }
      if (!sharesPlayerChunk(hunter)) {
        hideEntity(hunter);
        if (coarseDt > 0) advanceAbstractHunter(hunter, coarseDt);
        continue;
      }
      if (!hunter.entity && !hunter.building) materializeHunter(hunter, generation).catch(error => window.__farmLog?.(`[porakaneki] materialize failed: ${error.message}`, 'warn'));
      if (hunter.entity) { placeEntityIfDormant(hunter); updateDetailedHunter(hunter, dt); }
    }
  }
  function updateAllHunters(dt, coarseDt) {
    for (const zoneState of state.zones.values()) for (const camp of activeCamps(zoneState)) updateCampHunters(camp, dt, coarseDt); // Every map gets coarse life; only the player's chunk gets expensive simulation.
  }

  async function loadConfig() {
    try {
      const [configResponse, smallResponse, chiefResponse] = await Promise.all([fetch(CONFIG_URL), fetch(SMALL_LOCALE_URL), fetch(CHIEF_LOCALE_URL)]);
      if (!configResponse.ok) throw new Error(`config HTTP ${configResponse.status}`);
      if (!smallResponse.ok) throw new Error(`small locale HTTP ${smallResponse.status}`);
      if (!chiefResponse.ok) throw new Error(`chief locale HTTP ${chiefResponse.status}`);
      cfg = await configResponse.json();
      smallLocaleDef = await smallResponse.json();
      chiefLocaleDef = await chiefResponse.json();
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
    const coarseInterval = Math.max(1, num(cfg?.behavior?.offChunkTickSeconds, 4));
    const coarseStep = coarseAccum >= coarseInterval ? coarseAccum : 0;
    if (coarseStep) { coarseAccum = 0; state.coarseTicks += 1; }
    if (!cfg || !smallLocaleDef || !chiefLocaleDef || !combatDeps || !ensureWorldCamps()) return;

    initializeReputation();
    authorChiefBehavior();
    ensureCurrentCampMeshes();
    updateTerritoryWarnings();
    maybeChiefGreeting();
    updateAllHunters(step, coarseStep);
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
    return {
      id: camp.id,
      kind: camp.kind,
      center: { col: Number(camp.center.col.toFixed(1)), row: Number(camp.center.row.toFixed(1)) },
      residents: camp.residentTarget,
      provoked: campProvoked(camp),
      hunters: camp.hunters.map(hunter => ({
        index: hunter.index,
        weapon: hunter.weaponShape,
        activity: hunter.activity,
        x: Number(hunter.x.toFixed(1)), y: Number(hunter.y.toFixed(1)),
        chunk: chunkOf(hunter.x, hunter.y),
        fullSimulation: sharesPlayerChunk(hunter),
        materialized: !!hunter.entity,
        visible: !!hunter.entity?.avatarRef?.group?.visible,
        health: hunter.entity ? hunter.entity.health : null,
      })),
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
      version: 3,
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
      playerChunk: player ? chunkOf(player.col, player.row) : null,
      totalSmallCamps,
      totalActiveCamps: totalSmallCamps + (state.chiefZoneId && state.zones.get(state.chiefZoneId)?.chiefCamp ? 1 : 0),
      totalGeneratedResidents,
      chiefPlannerAgenda: !!chiefWalker()?.rec?.agenda?.some?.(beat => beat.id === 'porakaneki_day'),
      zones,
      stamps: state.stamps,
      materializations: state.materializations,
      coarseTicks: state.coarseTicks,
      greetings: state.greetings,
      kills: state.kills,
      lastReason: state.lastReason,
    };
  }

  window.PorakanekiCamps = Object.freeze({
    version: 3,
    update,
    ensureWorldCamps,
    ensureCampStamp: ensureWorldCamps, // Backward-compatible debug/test alias from the earlier single-camp runtime.
    initializeReputation,
    favor,
    debugSnapshot,
    formatDebug: () => {
      const d = debugSnapshot();
      const zoneBits = Object.entries(d.zones).map(([zoneId, z]) => `${zoneId}:${z.smallCampCount}${z.chiefActive ? '+CHIEF' : ''}`).join(' ');
      return `Porakaneki camps: v3 season=${d.season} chief=${d.chiefZoneId || '-'} area=${d.currentArea || '-'} small=${d.totalSmallCamps} active=${d.totalActiveCamps} residents=${d.totalGeneratedResidents} favor=${d.favor ?? '-'} AOS=${d.attackOnSight} chunk=${d.chunkSizeTiles} player=${d.playerChunk ? `${d.playerChunk.x},${d.playerChunk.y}` : '-'} mats=${d.materializations} coarse=${d.coarseTicks} greet=${d.greetings} kills=${d.kills} zones=[${zoneBits}] reason=${d.lastReason}`;
    },
    __test: Object.freeze({ isSleepingHour, chunkOf, weaponRoll, currentSeasonName, desiredChiefZone, smallCampCountForZone, smallResidentCount }),
  });

  watchNamespace('BanditCombat', installBanditCombat);
  watchNamespace('NpcScheduling', installScheduling);
  watchNamespace('BanditCamps', installTick);
  loadConfig();
})();
