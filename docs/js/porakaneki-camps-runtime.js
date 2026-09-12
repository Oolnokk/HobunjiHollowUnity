(() => {
  'use strict';

  // Porakaneki wilderness camp runtime. The tribe chief stays in the normal
  // NPC-walker/scheduling/social pipeline; three generated hunters reuse the
  // existing bandit humanoid combat pipeline. The chief's saved Favor is the
  // tribe-wide reputation so greeting/gifts/rapport and hostility share one
  // durable relationship record instead of creating a second faction save.
  const CONFIG_URL = 'config/porakaneki-camp.json'; // Authored camp, schedule, combat, and reputation tuning loaded once below.
  const LOCALE_URL = 'config/locales/locale_porakaneki_camp_small.json'; // Hand-authored camp footprint stamped into the finished wilderness layout.
  const SPECIES_ID = 'porakaneki'; // Forced appearance species for generated camp hunters.
  const DORMANT_AREA_PREFIX = '__porakaneki_camp_dormant__:'; // Used to make the normal hostile loop skip sleeping/off-zone hunters.
  const CAMP_TICK_INTERVAL_S = 0.20; // Used to keep neutral camp scheduling/social checks cheap while combat itself still runs in the normal hostile loop.
  const BUILD_BATCH = 1; // Used to yield between portrait builds and avoid one large camp-entry hitch.

  let combatDeps = null; // Captured from BanditCombat.init; used by terrain, movement, humanoid combat, scenes, and hostileObjects.
  let schedulingDeps = null; // Captured from NpcScheduling.init; used to find the live chief walker and its mutable NPC record.
  let cfg = null; // Parsed porakaneki-camp.json used by every gameplay rule below.
  let localeDef = null; // Parsed locale footprint used by TemporaryLocales.find/stamp.
  let gangCfg = null; // Existing bandit balance table reused for hunter health/stamina/combat abilities.
  let buildPromise = null; // Prevents duplicate async hunter portrait builds while a prior camp materialization is still running.
  let buildGeneration = 0; // Invalidates stale async builds when a Tothal Shift replaces the zone layout.
  let tickAccum = 0; // Used by the BanditCamps update seam to throttle neutral camp work to CAMP_TICK_INTERVAL_S.

  const state = {
    layoutRef: null, // Exact zone-layout object currently carrying this deterministic camp placement.
    view: null, // TemporaryLocales-compatible 2D view inflated from the generated wilderness layout.
    instance: null, // TemporaryLocales stamp record for the current generated zone layout.
    props: [], // Stamped tent/campfire/crate objects used by the lightweight renderer.
    propMeshes: new Map(), // propId -> render entry, used to rebuild/remove camp geometry with zone scene streaming.
    hunters: [], // Cached generated Porakaneki humanoid combat entities, one per authored weapon slot.
    center: null, // Camp center in tile coordinates; used by warning radii and schedule targets.
    chiefScheduleKey: null, // Prevents rewriting the same live chief schedule every tick.
    warningStage: -1, // Deepest warning ring entered during the current approach; resets after leaving the outer ring.
    phase: 'unknown', // sleep | hunt | camp | hostile, exposed through mobile diagnostics.
    reason: 'boot', // Last major lifecycle transition, exposed through mobile diagnostics.
    stamps: 0, // Count of deterministic camp stamps performed this session.
    builds: 0, // Count of hunter materialization jobs started this session.
    assaults: 0, // Number of hunter first-hit reputation penalties applied this session.
    kills: 0, // Number of hunter death reputation penalties applied this session.
    greetings: 0, // Number of daily chief greeting bonuses applied this session.
  };

  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
  const num = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

  function currentArea() { return combatDeps?.getCurrentArea?.() || null; }
  function gameHour() {
    const value = Number(window.CalendarSystem?.getHour?.()); // Same 24-hour clock used by the ordinary NPC schedule resolver.
    return Number.isFinite(value) ? ((value % 24) + 24) % 24 : 12;
  }
  function gameDay() {
    const raw = Number(window.CalendarSystem?.timeDebugSnapshot?.()?.rawDay); // Absolute day survives midnight and is stable for once-per-day greeting markers.
    if (Number.isFinite(raw)) return Math.max(0, Math.floor(raw));
    return Math.max(0, Math.floor(Number(combatDeps?.calendar?.day ?? window.calendar?.day ?? 0) || 0));
  }

  function phaseForHour(hour = gameHour()) {
    const schedule = cfg?.schedule || {}; // Authored clock boundaries consumed here and by chief schedule authoring.
    const sleepStart = num(schedule.sleepStartHour, 22);
    const wake = num(schedule.wakeHour, 6);
    const huntEnd = num(schedule.huntEndHour, 10);
    if (hour >= sleepStart || hour < wake) return 'sleep';
    if (hour < huntEnd) return 'hunt';
    return 'camp';
  }

  function hashSeed(text) {
    let h = 2166136261 >>> 0; // FNV-style deterministic hash used to seed camp/hunting placement without consuming the mutable gameplay RNG stream.
    for (const ch of String(text || '')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function seededRng(text) {
    let a = hashSeed(text) || 0x9e3779b9; // Mulberry32 state used by TemporaryLocales and deterministic hunting points.
    return () => {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function buildZoneView(zoneId, layout) {
    if (!layout?.cols || !layout?.rows || !combatDeps) return null;
    const cols = layout.cols, rows = layout.rows; // Used to inflate the sparse generated tile list into TemporaryLocales' 2D view shape.
    const tiles = Array.from({ length: rows }, () => new Array(cols).fill(null));
    const objects = [];
    for (const t of (layout.tiles || [])) {
      if (!(t.r >= 0 && t.r < rows && t.c >= 0 && t.c < cols)) continue;
      const tile = {
        height: t.elevTier || 0,
        water: !!combatDeps.WATERWAY_TYPES?.has?.(t.type),
        path: t.type === combatDeps.TileType?.PATH,
        ramp: t.type === combatDeps.TileType?.RAMP || !!t.incline,
        waterfall: t.type === combatDeps.TileType?.WATERFALL,
        terrain: t.type,
        occupiedBy: null,
      }; // TemporaryLocales site-fit fields only; the real generated layout is never mutated by this adapter.
      tiles[t.r][t.c] = tile;
      if (t.type === combatDeps.TileType?.SHRUB || t.type === combatDeps.TileType?.ROCK) {
        const id = `porakaneki_clutter_${t.c}_${t.r}`; // Makes existing visible clutter block camp placement rather than being silently bulldozed.
        objects.push({ id, type: 'unique', x: t.c, y: t.r, w: 1, h: 1, localeMeta: true });
        tile.occupiedBy = id;
      }
    }

    let seq = 0; // Used to mint unique blocker ids for generated structures/landmarks below.
    const blockRect = (col, row, w = 1, h = 1) => {
      if (!Number.isFinite(col) || !Number.isFinite(row)) return;
      const id = `porakaneki_unique_${seq++}`;
      objects.push({ id, type: 'unique', x: col, y: row, w, h, localeMeta: true });
      for (let r = row; r < row + h; r++) for (let c = col; c < col + w; c++) if (tiles[r]?.[c]) tiles[r][c].occupiedBy = id;
    };
    for (const b of (layout.buildings || [])) blockRect(b.gridX || 0, b.gridZ || 0, b.footprintW ?? b.w ?? 1, b.footprintD ?? b.h ?? 1);
    for (const d of (layout.dens || [])) blockRect(d.x, d.y, d.w || 1, d.h || 1);
    for (const d of (layout.decor || [])) blockRect(d.col, d.row);
    for (const f of (layout.furniture || [])) blockRect(f.col, f.row);
    for (const tr of (layout.transitions || [])) blockRect(tr.col, tr.row);
    for (const t of (layout.rootTotems || [])) blockRect(t.x ?? t.col, t.y ?? t.row, t.w || 1, t.h || 1);
    for (const inst of (layout.localeInstances || [])) for (const o of (inst.objects || [])) blockRect(o.x, o.y, o.w || 1, o.h || 1);

    const zdef = combatDeps.EXTERIOR_ZONES?.[zoneId]; // Used only for the entry fallback when this generated layout lacks toTownExit.
    const entry = layout.toTownExit
      ? { x: layout.toTownExit.col, y: layout.toTownExit.row }
      : (Number.isFinite(zdef?.entryCol) ? { x: zdef.entryCol, y: zdef.entryRow } : null);
    return { cols, rows, tiles, objects, entry };
  }

  function disposeObject3D(root) {
    if (!root) return;
    root.parent?.remove?.(root);
    root.traverse?.(obj => {
      obj.geometry?.dispose?.();
      if (Array.isArray(obj.material)) obj.material.forEach(material => material?.dispose?.());
      else obj.material?.dispose?.();
    });
  }

  function clearCampMeshes() {
    for (const entry of state.propMeshes.values()) {
      if (entry.light) entry.light.parent?.remove?.(entry.light);
      if (entry.sfxSource) window.Music?.unregisterFurnitureSfxSource?.(entry.sfxSource);
      disposeObject3D(entry.mesh);
    }
    state.propMeshes.clear();
  }

  function tentMesh() {
    const group = new THREE.Group(); // Used as the world transform/outline root for one lightweight Porakaneki tent.
    const canvas = new THREE.Mesh(
      new THREE.ConeGeometry(0.9, 1.2, 5, 1, false, -Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: 0x8b7656, side: THREE.DoubleSide }),
    ); // Five-sided canvas silhouette deliberately matches the visual language of the existing bandit tents without sharing private helpers.
    canvas.position.y = 0.6;
    canvas.castShadow = true;
    const doorway = new THREE.Mesh(
      new THREE.PlaneGeometry(0.42, 0.55),
      new THREE.MeshBasicMaterial({ color: 0x18130f, side: THREE.DoubleSide }),
    );
    doorway.position.set(0, 0.28, 0.91);
    group.userData.projectileCoverHeightTiles = 1.2;
    group.userData.projectileCoverRadiusTiles = 0.9;
    group.userData.projectileCoverKind = 'porakaneki-tent';
    group.add(canvas, doorway);
    return group;
  }

  function crateMesh() {
    const group = new THREE.Group(); // Used as the fallback hunting-supplies prop when ProceduralFurniture has no matching runtime builder.
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.65, 0.75), new THREE.MeshLambertMaterial({ color: 0x6b4d2c }));
    box.position.y = 0.325;
    box.castShadow = true;
    group.add(box);
    return group;
  }

  function campfireMesh() {
    const built = window.ProceduralFurniture?.buildFurnitureGroup?.('campfire', 0x6b4a28); // Existing furniture art is preferred so the campfire matches player-placeable fires.
    if (built) return built;
    const group = new THREE.Group();
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.48, 6), new THREE.MeshBasicMaterial({ color: 0xff8a22 }));
    flame.position.y = 0.25;
    group.add(flame);
    return group;
  }

  function ensureCampMeshes() {
    if (!combatDeps || currentArea() !== cfg?.zoneId || !state.instance || typeof THREE === 'undefined') return;
    const zoneInfo = combatDeps.zoneScenes?.get?.(cfg.zoneId); // Current streamed zone scene/grid supplies terrain height and the render parent.
    if (!zoneInfo?.scene) return;
    const liveIds = new Set(); // Used to remove stale meshes after a Tothal Shift/restamp.
    for (const prop of state.props) {
      liveIds.add(prop.id);
      const prior = state.propMeshes.get(prop.id);
      if (prior?.mesh?.parent === zoneInfo.scene) continue;
      if (prior) {
        if (prior.light) prior.light.parent?.remove?.(prior.light);
        disposeObject3D(prior.mesh);
        state.propMeshes.delete(prop.id);
      }
      const centerCol = prop.x + (prop.w || 1) * 0.5; // Prop center used for all mesh placement and positional audio/light sources.
      const centerRow = prop.y + (prop.h || 1) * 0.5;
      const gridTile = zoneInfo.grid?.[Math.floor(centerRow)]?.[Math.floor(centerCol)];
      const y = gridTile && combatDeps.tileSurfaceYInArea ? num(combatDeps.tileSurfaceYInArea(gridTile, cfg.zoneId), 0) : 0;
      let mesh = null;
      let light = null;
      let sfxSource = null;
      if (prop.type === 'tent') mesh = tentMesh();
      else if (prop.key === 'campfire') {
        mesh = campfireMesh();
        light = new THREE.PointLight(0xff7722, 1.1, 3.2); // Campfire light used only while the Western Slope scene is instantiated.
        light.position.set(centerCol, y + 0.45, centerRow);
        light.userData.furnitureLightMask = true;
        zoneInfo.scene.add(light);
        const sfxDef = window.Music?.resolveFurnitureSfx?.({ sfxKey: 'fireplace' }); // Existing fireplace loop avoids a separate Porakaneki audio path.
        sfxSource = window.Music?.registerFurnitureSfxSource?.(cfg.zoneId, centerCol, centerRow, sfxDef) || null;
      } else mesh = crateMesh();
      if (!mesh) continue;
      mesh.position.set(centerCol, y, centerRow);
      combatDeps.markOutline?.(mesh);
      zoneInfo.scene.add(mesh);
      state.propMeshes.set(prop.id, { mesh, light, sfxSource });
    }
    for (const [id, entry] of [...state.propMeshes]) {
      if (liveIds.has(id)) continue;
      if (entry.light) entry.light.parent?.remove?.(entry.light);
      disposeObject3D(entry.mesh);
      state.propMeshes.delete(id);
    }
  }

  function teardownHunters(reason) {
    buildGeneration += 1;
    buildPromise = null;
    for (const hunter of state.hunters) {
      if (!hunter) continue;
      const index = combatDeps?.hostileObjects?.indexOf?.(hunter); // Removes only this runtime's generated hunters from the shared hostile array.
      if (index >= 0) combatDeps.hostileObjects.splice(index, 1);
      hunter.avatarRef?.group?.parent?.remove?.(hunter.avatarRef.group);
      hunter.groundShadow?.parent?.remove?.(hunter.groundShadow);
      hunter._banditToolHolder?.parent?.remove?.(hunter._banditToolHolder);
      hunter._banditRangedToolHolder?.parent?.remove?.(hunter._banditRangedToolHolder);
      hunter.avatarRef?.dispose?.();
      hunter.groundShadow?.geometry?.dispose?.();
      hunter.groundShadow?.material?.dispose?.();
    }
    state.hunters.length = 0;
    state.reason = reason;
  }

  function resetForLayout(layout) {
    if (state.layoutRef === layout) return;
    if (state.hunters.length) teardownHunters('layout-changed');
    clearCampMeshes();
    state.layoutRef = layout;
    state.view = null;
    state.instance = null;
    state.props = [];
    state.center = null;
    state.chiefScheduleKey = null;
    state.warningStage = -1;
  }

  function ensureCampStamp() {
    if (!cfg || !localeDef || !combatDeps || !window.TemporaryLocales) return false;
    const zoneId = cfg.zoneId; // Authored single wilderness zone for this camp.
    const layout = combatDeps.zoneLayouts?.get?.(zoneId);
    if (!layout) return false;
    resetForLayout(layout);
    if (state.instance) return true;
    const view = buildZoneView(zoneId, layout); // Independent adapter means camp placement cannot mutate the underlying procedural terrain data.
    if (!view) return false;
    const rng = seededRng(`${zoneId}:${layout.cols}x${layout.rows}:porakaneki-camp`); // Stable candidate shuffle for this generated layout shape.
    const instance = window.TemporaryLocales.stamp(view, localeDef, {
      rng,
      clearableTypes: new Set(), // No bulldozing: trees/shrubs/rocks/landmarks all block the camp and remain untouched in the real zone.
      clearanceTiles: localeDef.placement?.clearanceTiles ?? 2,
      requiresFlatGround: localeDef.placement?.requiresFlatGround !== false,
      minDistanceFromEntry: localeDef.placement?.minDistanceFromEntry ?? 10,
      instanceId: `porakaneki_camp_${zoneId}`,
    });
    if (!instance) {
      state.reason = 'no-valid-camp-site';
      return false;
    }
    state.view = view;
    state.instance = instance;
    state.props = view.objects.filter(obj => obj.temporaryLocaleInstanceId === instance.id); // Render only the objects this stamp added, not blockers copied from the generated map.
    state.center = {
      col: instance.site.x + instance.site.w * 0.5,
      row: instance.site.y + instance.site.h * 0.5,
    }; // Site center drives warning radii and fallback schedule positions.
    state.stamps += 1;
    state.reason = `stamped:${Math.round(state.center.col)},${Math.round(state.center.row)}`;
    return true;
  }

  function tentCenters() {
    return state.props
      .filter(prop => prop.type === 'tent')
      .map(prop => ({ col: prop.x + (prop.w || 1) * 0.5, row: prop.y + (prop.h || 1) * 0.5 })); // Used as sleeping/wake positions for chief and generated hunters.
  }

  function campTarget(index) {
    const center = state.center || { col: 0, row: 0 }; // Camp-relative social/resting positions surrounding the fire rather than stacking every hunter on one tile.
    const offsets = [[-1.7, 0.9], [1.5, 0.7], [0.2, -1.7], [1.7, -1.1]];
    const offset = offsets[index % offsets.length];
    return { col: center.col + offset[0], row: center.row + offset[1] };
  }

  function huntTarget(index, day = gameDay()) {
    const center = state.center || { col: 0, row: 0 };
    const rng = seededRng(`${cfg?.zoneId}:${day}:porakaneki-hunt:${index}`); // Daily deterministic spread prevents hunters from occupying the exact same hunting ground forever.
    const minR = Math.max(2, num(cfg?.hunting?.minRadiusTiles, 8));
    const maxR = Math.max(minR, num(cfg?.hunting?.maxRadiusTiles, 16));
    const angle = rng() * Math.PI * 2;
    const distance = minR + rng() * (maxR - minR);
    const cols = state.view?.cols || combatDeps?.EXTERIOR_ZONES?.[cfg?.zoneId]?.cols || 200; // Bounds used to keep destinations inside the generated map.
    const rows = state.view?.rows || combatDeps?.EXTERIOR_ZONES?.[cfg?.zoneId]?.rows || 200;
    return {
      col: clamp(center.col + Math.cos(angle) * distance, 1.5, cols - 1.5),
      row: clamp(center.row + Math.sin(angle) * distance, 1.5, rows - 1.5),
    };
  }

  function chiefWalker() {
    const id = cfg?.reputation?.npcId || 'porakaneki_chief'; // Existing lore NPC is the relationship/social representative for the whole camp.
    return schedulingDeps?.npcWalkers?.find?.(walker => walker?.rec?.id === id) || null;
  }

  function registerChiefStations() {
    if (!state.instance || !window.NpcScheduling?.registerNpcStations) return;
    const tents = tentCenters(); // First tent is the chief's authored sleeping station; hunt/camp points come from the same live stamp.
    const sleep = tents[0] || campTarget(0);
    const hunt = huntTarget(99, 0); // Fixed chief hunting point; generated hunters themselves change day-by-day.
    const camp = campTarget(3);
    window.NpcScheduling.registerNpcStations([
      { id: 'porakaneki_camp_sleep', label: 'Sleeping at the Porakaneki Camp', area: cfg.zoneId, c: sleep.col, r: sleep.row, pose: 'lie' },
      { id: 'porakaneki_camp_hunt', label: 'Hunting from the Porakaneki Camp', area: cfg.zoneId, c: hunt.col, r: hunt.row, pose: 'stand', wanderRadiusTiles: 2.5 },
      { id: 'porakaneki_camp_fire', label: 'At the Porakaneki Campfire', area: cfg.zoneId, c: camp.col, r: camp.row, pose: 'stand', wanderRadiusTiles: 1.5 },
    ], cfg.zoneId);
  }

  function authorChiefSchedule() {
    const walker = chiefWalker();
    if (!walker?.rec || !state.instance) return false;
    const key = `${state.instance.id}:${state.center?.col?.toFixed?.(2)}:${state.center?.row?.toFixed?.(2)}`; // Prevents repeated mutation until a new generated layout restamps the camp.
    if (state.chiefScheduleKey === key && walker.rec.scheduleHooks?.__porakanekiCampRuntime) return true;
    registerChiefStations();
    const schedule = cfg.schedule || {};
    walker.rec.gender = 'male'; // Species is currently male-only; keeping the live record explicit avoids placeholder lore data selecting a nonexistent fighter.
    walker.rec.species = SPECIES_ID;
    walker.rec.appearance = { ...(walker.rec.appearance || {}), speciesId: SPECIES_ID, gender: 'male' };
    walker.rec.scheduleHooks = {
      ...(walker.rec.scheduleHooks || {}),
      defaultMapId: cfg.zoneId,
      defaultPosition: { c: state.center.col, r: state.center.row },
      workBuildingId: '',
      shopHours: '',
      __porakanekiCampRuntime: true,
      rules: [
        { start: `${String(num(schedule.sleepStartHour, 22)).padStart(2, '0')}:00`, end: `${String(num(schedule.wakeHour, 6)).padStart(2, '0')}:00`, stationId: 'porakaneki_camp_sleep', area: cfg.zoneId, activity: 'sleep' },
        { start: `${String(num(schedule.wakeHour, 6)).padStart(2, '0')}:00`, end: `${String(num(schedule.huntEndHour, 10)).padStart(2, '0')}:00`, stationId: 'porakaneki_camp_hunt', area: cfg.zoneId, activity: 'hunt' },
        { start: `${String(num(schedule.huntEndHour, 10)).padStart(2, '0')}:00`, end: `${String(num(schedule.sleepStartHour, 22)).padStart(2, '0')}:00`, stationId: 'porakaneki_camp_fire', area: cfg.zoneId, activity: 'camp' },
      ],
    };
    // If this placeholder lore NPC ever gains a general agenda later, keep the
    // authored camp schedule authoritative only while the runtime camp exists.
    if (walker.rec.agenda && !walker.rec.agenda.__porakanekiCampRuntime) walker.rec._porakanekiPriorAgenda = walker.rec.agenda;
    walker.rec.agenda = null;
    state.chiefScheduleKey = key;
    return true;
  }

  function relationshipState() {
    const id = cfg?.reputation?.npcId || 'porakaneki_chief'; // Single durable Favor/Rapport identity used as tribe reputation.
    return window.DialogueContent?.getNpcDlgState?.(id) || window.DialogueContent?.npcDlgState?.get?.(id) || null;
  }
  function memoryHas(stateObject, event) {
    return !!stateObject?.memory?.some?.(entry => entry?.event === event || entry?.type === event);
  }
  function pushMemory(stateObject, event) {
    if (!stateObject) return;
    stateObject.memory ||= [];
    stateObject.memory.push({ event, day: gameDay(), ts: Date.now() }); // Uses the same minimal memory shape as DialogueContent.recordNpcMemory.
    if (stateObject.memory.length > 50) stateObject.memory.shift();
  }

  function initializeReputation() {
    const relation = relationshipState();
    const repCfg = cfg?.reputation || {};
    if (!relation) return false;
    const marker = repCfg.initializationMemoryEvent || 'porakaneki_faction_initialized'; // Persistent marker ensures the starting disposition is applied exactly once per character save.
    if (memoryHas(relation, marker)) return true;
    const current = Number(relation.favor); // Existing nonzero favor from an older save is preserved rather than overwritten by the migration.
    if (!Number.isFinite(current) || current === 0) relation.favor = num(repCfg.initialFavor, -3);
    pushMemory(relation, marker);
    state.reason = `reputation-initialized:${num(relation.favor, 0)}`;
    return true;
  }

  function favor() {
    initializeReputation();
    return num(relationshipState()?.favor, 0);
  }

  function adjustFavor(amount, reason, { popup = true } = {}) {
    const relation = relationshipState();
    if (!relation || !amount) return favor();
    relation.favor = Math.round((num(relation.favor, 0) + amount) * 10) / 10; // Exact authored Porakaneki delta; unlike generic gift Favor this is not multiplied by Love Potion.
    pushMemory(relation, reason);
    if (popup) window.WorldPopupText?.queueReward?.('favor', `${amount > 0 ? '+' : '-'}${Math.abs(amount)} Porakaneki Favor`);
    return relation.favor;
  }

  function dailyGreeting() {
    const walker = chiefWalker();
    if (!walker?.root || !combatDeps?.player || walker.area !== currentArea() || walker.area !== cfg?.zoneId) return;
    const repCfg = cfg.reputation || {};
    if (favor() <= num(repCfg.attackOnSightFavor, -5)) return;
    const distance = Math.hypot(walker.root.position.x - combatDeps.player.x / combatDeps.TILE, walker.root.position.z - combatDeps.player.y / combatDeps.TILE); // Tile-space proximity to the actual live chief walker.
    if (distance > num(repCfg.greetingRadiusTiles, 2.5)) return;
    const marker = `porakaneki_greeting_day_${gameDay()}`; // Persisted in normal NPC relationship memory so save/reload cannot award the same day's greeting twice.
    const relation = relationshipState();
    if (!relation || memoryHas(relation, marker)) return;
    const gain = num(repCfg.greetingFavorGain, 1);
    if (gain) adjustFavor(gain, marker);
    else pushMemory(relation, marker);
    const rapportGain = num(repCfg.greetingRapportGain, 1); // Existing daily Rapport system converts temporary affinity to Favor at midnight normally.
    if (rapportGain) window.NpcRapport?.adjust?.(repCfg.npcId || 'porakaneki_chief', rapportGain, 'porakaneki_greeting');
    combatDeps.showToast?.('The Porakaneki chief returns your greeting.', true);
    state.greetings += 1;
  }

  function warningUpdate() {
    if (!state.center || currentArea() !== cfg?.zoneId || !combatDeps?.player) { state.warningStage = -1; return; }
    const repCfg = cfg.reputation || {};
    if (favor() <= num(repCfg.attackOnSightFavor, -5)) { state.warningStage = -1; return; }
    const warnings = Array.isArray(repCfg.warnings) ? repCfg.warnings : [];
    if (!warnings.length) return;
    const distance = Math.hypot(state.center.col - combatDeps.player.x / combatDeps.TILE, state.center.row - combatDeps.player.y / combatDeps.TILE); // Camp-center distance drives the escalating territorial warning rings.
    let stage = -1;
    for (let i = 0; i < warnings.length; i++) if (distance <= num(warnings[i]?.radiusTiles, 0)) stage = i;
    if (stage < 0) { state.warningStage = -1; return; }
    if (stage > state.warningStage) {
      const text = warnings[stage]?.text;
      if (text) combatDeps.showToast?.(text, false);
    }
    state.warningStage = Math.max(state.warningStage, stage);
  }

  function weaponFor(index) {
    const equipment = cfg?.equipment || {};
    const shapes = Array.isArray(equipment.weaponShapes) && equipment.weaponShapes.length
      ? equipment.weaponShapes : ['fishingspear', 'hatchet', 'daggerSword']; // User-required Porakaneki weapon set; deterministic index distribution guarantees all three appear in a full camp.
    const shapeKey = shapes[index % shapes.length];
    const metalKey = equipment.weaponMetalKey || 'nativeCopper';
    const shape = combatDeps?.HELD_SHAPE_DEFS?.[shapeKey] || {};
    const weaponKey = combatDeps?.craftedToolItemKey?.(shapeKey, metalKey) || shapeKey;
    return { shapeKey, metalKey, weaponKey, attackTag: shape.dmgType || 'sharp', ranged: shapeKey === 'daggerSword' };
  }

  function hunterRoster(index) {
    const cosmetics = [...(cfg?.equipment?.forcedCosmetics || ['rugged_poncho'])]; // Shared camp clothing while species randomization still supplies hair/body colors.
    return {
      name: `Porakaneki Hunter ${index + 1}`,
      appearance: { speciesId: SPECIES_ID, gender: 'male', cosmetics: {} },
      equippedCosmetics: cosmetics,
      appliedDyes: {},
      cosmeticSlots: Object.fromEntries(cosmetics.map(id => [id, 'overwear'])),
    };
  }

  function hideHunter(hunter) {
    if (!hunter) return;
    hunter.areaId = `${DORMANT_AREA_PREFIX}${cfg?.zoneId || ''}`; // Existing hostile area guard removes offscreen/sleep AI cost.
    if (hunter.avatarRef?.group) hunter.avatarRef.group.visible = false;
    if (hunter.groundShadow) hunter.groundShadow.visible = false;
    if (hunter._banditToolHolder) hunter._banditToolHolder.visible = false;
    if (hunter._banditRangedToolHolder) hunter._banditRangedToolHolder.visible = false;
    hunter.vx = 0;
    hunter.vy = 0;
  }

  function placeHunter(hunter, target) {
    if (!hunter || !target || currentArea() !== cfg?.zoneId) return false;
    const grid = combatDeps.getActiveGrid?.(); // Current live grid used to resample terrain every wake/re-entry after wilderness rebuilds.
    const cols = num(combatDeps.getActiveCols?.(), state.view?.cols || 1);
    const rows = num(combatDeps.getActiveRows?.(), state.view?.rows || 1);
    const col = clamp(target.col, 0.5, Math.max(0.5, cols - 0.5));
    const row = clamp(target.row, 0.5, Math.max(0.5, rows - 0.5));
    const sampleCol = clamp(Math.floor(col), 0, Math.max(0, cols - 1));
    const sampleRow = clamp(Math.floor(row), 0, Math.max(0, rows - 1));
    const tile = grid?.[sampleRow]?.[sampleCol];
    const surface = tile && combatDeps.tileSurfaceYInArea ? num(combatDeps.tileSurfaceYInArea(tile, cfg.zoneId), 0) : 0;
    hunter.x = col * combatDeps.TILE;
    hunter.y = row * combatDeps.TILE;
    hunter.homeX = hunter.x;
    hunter.homeY = hunter.y;
    hunter.areaId = cfg.zoneId;
    hunter.areaGrid = grid;
    hunter.areaCols = cols;
    hunter.areaRows = rows;
    if (hunter.avatarRef?.group) {
      hunter.avatarRef.group.position.set(col, surface + (hunter.halfHeight || 0.45), row);
      hunter.avatarRef.group.visible = true;
    }
    if (hunter.groundShadow) {
      hunter.groundShadow.position.set(col, surface + (combatDeps.characterGroundShadowSurfaceOffset?.() || 0.01), row);
      hunter.groundShadow.visible = true;
    }
    if (hunter._banditToolHolder) hunter._banditToolHolder.visible = true;
    if (hunter._banditRangedToolHolder) hunter._banditRangedToolHolder.visible = false;
    return true;
  }

  function neutralizeHunter(hunter, phase) {
    if (!hunter || hunter.health <= 0) return;
    hunter._porakanekiAggroRangePx ??= num(hunter.def?.aggroRangePx, combatDeps.TILE * 6); // Restored immediately when tribe reputation reaches attack-on-sight.
    if (hunter.def) hunter.def.aggroRangePx = 0;
    hunter.state = phase === 'hunt' ? 'porakanekiHunt' : 'porakanekiCamp';
    hunter._banditAction = null;
    hunter._rangedAction = null;
    hunter._rangedMode = false;
    hunter.wanderTarget = null;
  }

  function makeHunterHostile(hunter) {
    if (!hunter || hunter.health <= 0) return;
    hunter._porakanekiAggroRangePx ??= num(hunter.def?.aggroRangePx, combatDeps.TILE * 6);
    if (hunter.def) hunter.def.aggroRangePx = hunter._porakanekiAggroRangePx;
    hunter.state = 'chase';
  }

  async function loadGangConfig() {
    if (!gangCfg) gangCfg = await window.BanditCombat?.loadGangConfig?.(); // Reuses already-authored humanoid combat balance rather than inventing Porakaneki-only stats.
    return gangCfg;
  }

  async function buildHunter(index, generation) {
    const base = await loadGangConfig();
    if (!base || generation !== buildGeneration || currentArea() !== cfg?.zoneId) return null;
    const weapon = weaponFor(index);
    const start = campTarget(index);
    const hunter = await window.BanditCombat.makeEntity({
      ...(base || {}),
      speciesWeights: { [SPECIES_ID]: 1 },
      rangedWeaponChanceByRank: { grunt: 0, lieutenant: 0, captain: 0 },
    }, 'grunt', 0, start.col * combatDeps.TILE, start.row * combatDeps.TILE, {
      zoneId: cfg.zoneId,
      rosterOverride: hunterRoster(index),
      defOverride: {
        label: 'Porakaneki Hunter',
        weaponKey: weapon.weaponKey,
        weaponShapeKey: weapon.shapeKey,
        weaponMetalKey: weapon.metalKey,
        attackTag: weapon.attackTag,
        rangedWeaponKey: weapon.ranged ? weapon.weaponKey : null, // Dagger hunters use the generic dual-role thrown-weapon config while retaining the same dagger for melee.
      },
      extra: {
        isPorakanekiHunter: true,
        porakanekiHunterIndex: index,
        porakanekiWeaponShape: weapon.shapeKey,
        porakanekiCampInstanceId: state.instance?.id || null,
      },
    });
    if (!hunter || generation !== buildGeneration) {
      hunter?.avatarRef?.dispose?.();
      return null;
    }
    hunter._porakanekiLastHealth = hunter.health;
    hunter._porakanekiAssaultPenalized = false;
    hunter._porakanekiKillPenalized = false;
    neutralizeHunter(hunter, phaseForHour());
    combatDeps.hostileObjects.push(hunter);
    return hunter;
  }

  function ensureHunters() {
    const count = Math.max(1, Math.floor(num(cfg?.population?.hunters, 3))); // Authored camp population; three guarantees spear/hatchet/dagger representation.
    if (buildPromise || state.hunters.length >= count || currentArea() !== cfg?.zoneId) return buildPromise;
    const generation = ++buildGeneration;
    state.builds += 1;
    buildPromise = (async () => {
      for (let index = state.hunters.length; index < count; index++) {
        if (generation !== buildGeneration || currentArea() !== cfg.zoneId) break;
        const hunter = await buildHunter(index, generation);
        if (hunter) state.hunters.push(hunter);
        if ((index + 1) % BUILD_BATCH === 0) await new Promise(resolve => window.requestAnimationFrame ? window.requestAnimationFrame(resolve) : resolve());
      }
      return state.hunters;
    })().finally(() => { if (generation === buildGeneration) buildPromise = null; });
    return buildPromise;
  }

  function playerNearHunter(hunter) {
    if (!hunter || !combatDeps?.player) return false;
    const radius = num(cfg?.reputation?.damageAttributionRadiusTiles, 14) * combatDeps.TILE; // Conservative proximity attribution keeps wildlife/environmental deaths from automatically blaming the player across the map.
    return Math.hypot(hunter.x - combatDeps.player.x, hunter.y - combatDeps.player.y) <= radius;
  }

  function detectHunterViolence() {
    const repCfg = cfg?.reputation || {};
    for (const hunter of state.hunters) {
      if (!hunter) continue;
      const previous = Number.isFinite(hunter._porakanekiLastHealth) ? hunter._porakanekiLastHealth : num(hunter.maxHealth, hunter.health);
      const now = num(hunter.health, 0);
      const playerAttributed = playerNearHunter(hunter); // Current combat pipeline does not expose source ownership on every damage path, so proximity gates the fallback attribution.
      if (now < previous && !hunter._porakanekiAssaultPenalized && playerAttributed) {
        hunter._porakanekiAssaultPenalized = true;
        const penalty = -Math.abs(num(repCfg.assaultPenalty, -2));
        adjustFavor(penalty, `porakaneki_assault_hunter_${hunter.porakanekiHunterIndex}`);
        combatDeps.showToast?.('The Porakaneki take your attack as a declaration of hostility.', false);
        state.assaults += 1;
      }
      if (previous > 0 && now <= 0 && !hunter._porakanekiKillPenalized && playerAttributed) {
        hunter._porakanekiKillPenalized = true;
        const penalty = -Math.abs(num(repCfg.killPenalty, -2));
        adjustFavor(penalty, `porakaneki_kill_hunter_${hunter.porakanekiHunterIndex}`);
        state.kills += 1;
      }
      hunter._porakanekiLastHealth = now;
    }
  }

  function moveNeutralHunter(hunter, target, speedTilesPerSecond) {
    if (!hunter || hunter.health <= 0 || !target) return;
    const tx = target.col * combatDeps.TILE; // Pixel-space destination fed into the same collision/path movement helper used by other wilderness humanoids.
    const ty = target.row * combatDeps.TILE;
    const distance = Math.hypot(tx - hunter.x, ty - hunter.y);
    hunter.homeX = tx;
    hunter.homeY = ty;
    if (distance <= combatDeps.TILE * 0.35) { hunter.vx = 0; hunter.vy = 0; return; }
    hunter.facing = Math.atan2(ty - hunter.y, tx - hunter.x);
    combatDeps.moveCreatureToward?.(hunter, tx, ty, Math.max(0.1, speedTilesPerSecond) * combatDeps.TILE, CAMP_TICK_INTERVAL_S);
  }

  function updateHunterSchedule() {
    if (!cfg || currentArea() !== cfg.zoneId) {
      for (const hunter of state.hunters) if (hunter?.health > 0) hideHunter(hunter);
      return;
    }
    detectHunterViolence();
    const hostile = favor() <= num(cfg?.reputation?.attackOnSightFavor, -5); // Tribe reputation is checked live so gifts/rapport can eventually repair hostility.
    let phase = hostile ? 'hostile' : phaseForHour();
    state.phase = phase;

    // Neutral hunters genuinely sleep out of the simulation at night. A camp
    // that is already attack-on-sight instead wakes its hunters when the player
    // enters the zone, so hostile reputation cannot be bypassed by visiting at 02:00.
    if (phase === 'sleep') {
      for (const hunter of state.hunters) if (hunter?.health > 0) hideHunter(hunter);
      return;
    }

    ensureHunters();
    const tents = tentCenters();
    for (let i = 0; i < state.hunters.length; i++) {
      const hunter = state.hunters[i];
      if (!hunter || hunter.health <= 0) continue;
      if (hunter.areaId !== cfg.zoneId || !hunter.avatarRef?.group?.visible) placeHunter(hunter, tents[i % Math.max(1, tents.length)] || campTarget(i));
      if (phase === 'hostile') {
        makeHunterHostile(hunter);
        continue;
      }
      neutralizeHunter(hunter, phase);
      if (phase === 'hunt') moveNeutralHunter(hunter, huntTarget(i), num(cfg?.hunting?.travelSpeedTilesPerSecond, 1.15));
      else moveNeutralHunter(hunter, campTarget(i), num(cfg?.hunting?.campTravelSpeedTilesPerSecond, 0.85));
    }
  }

  async function loadConfig() {
    try {
      const [configResponse, localeResponse] = await Promise.all([fetch(CONFIG_URL), fetch(LOCALE_URL)]); // One parallel startup fetch keeps the parser-time bridge cheap.
      if (!configResponse.ok) throw new Error(`config HTTP ${configResponse.status}`);
      if (!localeResponse.ok) throw new Error(`locale HTTP ${localeResponse.status}`);
      cfg = await configResponse.json();
      localeDef = await localeResponse.json();
      state.reason = 'config-ready';
      return cfg;
    } catch (error) {
      state.reason = `config-error:${error.message}`;
      window.__farmLog?.(`[porakaneki-camp] ${error.message}`, 'warn', 'wildlife');
      return null;
    }
  }

  function update(dt) {
    tickAccum += Math.max(0, num(dt, 0));
    if (tickAccum < CAMP_TICK_INTERVAL_S) return;
    tickAccum = 0;
    if (!cfg || !localeDef || !combatDeps) return;
    if (!ensureCampStamp()) return;
    initializeReputation();
    authorChiefSchedule();
    ensureCampMeshes();
    dailyGreeting();
    warningUpdate();
    updateHunterSchedule();
  }

  function installBanditCombat(api = window.BanditCombat) {
    if (!api || typeof api.init !== 'function') return false;
    if (api.__porakanekiCampInitWrapped) return true;
    const original = api.init.bind(api); // Existing BanditCombat initialization remains authoritative; this runtime only shares its injected dependencies.
    api.init = function porakanekiCampBanditInit(injected) {
      combatDeps = injected;
      return original(injected);
    };
    api.__porakanekiCampInitWrapped = true;
    return true;
  }

  function installScheduling(api = window.NpcScheduling) {
    if (!api || typeof api.init !== 'function') return false;
    if (api.__porakanekiCampInitWrapped) return true;
    const original = api.init.bind(api); // Existing scheduler initialization remains authoritative; this captures the live npcWalkers array for the chief.
    api.init = function porakanekiCampSchedulingInit(injected) {
      schedulingDeps = injected;
      return original(injected);
    };
    api.__porakanekiCampInitWrapped = true;
    return true;
  }

  function installTick(api = window.BanditCamps) {
    if (!api || typeof api.updateCampBanners !== 'function') return false;
    if (api.updateCampBanners.__porakanekiCampWrapped) return true;
    const original = api.updateCampBanners.bind(api); // Same cheap pre-hostile-update seam already used by HarlyaoNightMarch.
    const wrapped = function porakanekiCampTick(dt) {
      update(dt);
      return original(dt);
    };
    wrapped.__porakanekiCampWrapped = true;
    api.updateCampBanners = wrapped;
    return true;
  }

  function watchNamespace(name, installer) {
    if (installer(window[name])) return;
    const descriptor = Object.getOwnPropertyDescriptor(window, name); // Parser-time setter preserves whichever module currently owns this global until its later assignment arrives.
    if (descriptor && !descriptor.configurable) return;
    let assigned = descriptor?.value;
    Object.defineProperty(window, name, {
      configurable: true,
      enumerable: true,
      get: () => assigned,
      set(value) {
        assigned = value;
        Object.defineProperty(window, name, { configurable: true, enumerable: true, writable: true, value });
        installer(value);
      },
    });
  }

  function debugSnapshot() {
    const relation = relationshipState(); // Live relationship state included so mobile debugging can distinguish camp/spawn bugs from reputation gating.
    return {
      configReady: !!cfg,
      localeReady: !!localeDef,
      combatDepsReady: !!combatDeps,
      schedulingDepsReady: !!schedulingDeps,
      zoneId: cfg?.zoneId || null,
      currentArea: currentArea(),
      stamped: !!state.instance,
      center: state.center ? { ...state.center } : null,
      phase: state.phase,
      favor: relation ? num(relation.favor, 0) : null,
      attackOnSight: relation && cfg ? num(relation.favor, 0) <= num(cfg.reputation?.attackOnSightFavor, -5) : false,
      huntersCached: state.hunters.length,
      huntersAlive: state.hunters.filter(hunter => hunter?.health > 0).length,
      huntersVisible: state.hunters.filter(hunter => hunter?.health > 0 && hunter.areaId === cfg?.zoneId && hunter.avatarRef?.group?.visible).length,
      hunterWeapons: state.hunters.map(hunter => hunter?.porakanekiWeaponShape || null),
      chiefScheduled: !!state.chiefScheduleKey,
      warnings: state.warningStage,
      stamps: state.stamps,
      builds: state.builds,
      assaults: state.assaults,
      kills: state.kills,
      greetings: state.greetings,
      reason: state.reason,
    };
  }

  window.PorakanekiCamps = Object.freeze({
    version: 1,
    update,
    ensureCampStamp,
    initializeReputation,
    favor,
    debugSnapshot,
    formatDebug: () => {
      const d = debugSnapshot();
      const center = d.center ? `${d.center.col.toFixed(1)},${d.center.row.toFixed(1)}` : '-';
      return `Porakaneki camp: cfg=${d.configReady}/${d.localeReady} deps=${d.combatDepsReady}/${d.schedulingDepsReady} zone=${d.zoneId || '-'} area=${d.currentArea || '-'} stamped=${d.stamped}@${center} phase=${d.phase} favor=${d.favor ?? '-'} AOS=${d.attackOnSight} hunters=${d.huntersVisible}/${d.huntersAlive}/${d.huntersCached} weapons=${d.hunterWeapons.filter(Boolean).join(',') || '-'} chief=${d.chiefScheduled} greet=${d.greetings} assault=${d.assaults} kills=${d.kills} reason=${d.reason}`;
    },
    __test: Object.freeze({ phaseForHour, seededRng, huntTarget }),
  });

  watchNamespace('BanditCombat', installBanditCombat);
  watchNamespace('NpcScheduling', installScheduling);
  watchNamespace('BanditCamps', installTick);
  loadConfig();
})();
