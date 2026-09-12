(() => {
  'use strict';

  // Porakaneki hunting-camp runtime.
  //
  // The named chief remains a normal NPC walker, so dialogue, gifting,
  // Rapport, ambient social reactions, and the new Agenda/Activity Planner
  // continue to work through the same path as every other authored NPC. The
  // unnamed hunters are combat-capable generated humanoids, so they keep the
  // BanditCombat entity shape but use a lightweight planner-like neutral AI:
  // hunt, wander, socialize, investigate nearby stimuli, or drift back toward
  // camp. None owns a fixed station or patrol point.
  //
  // Full neutral simulation only runs when an individual hunter shares the
  // player's wilderness chunk. Outside that chunk the visible entity goes
  // dormant and only a coarse abstract position/activity is advanced every
  // few seconds. This mirrors the newer NPC planner's off-screen philosophy
  // without forcing combat entities into npcWalkers.
  const CONFIG_URL = 'config/porakaneki-camp.json'; // Authored population, LOD, loadout, schedule, and reputation tuning used throughout this module.
  const LOCALE_URL = 'config/locales/locale_porakaneki_camp_small.json'; // Hand-authored temporary-locale footprint stamped into the generated Western Slope.
  const SPECIES_ID = 'porakaneki'; // Forced generated-hunter appearance species.
  const DORMANT_AREA_PREFIX = '__porakaneki_dormant__:'; // Area id used to remove off-chunk/sleeping hunters from the shared hostile update loop.
  const TICK_INTERVAL_S = 0.20; // Cheap neutral/LOD cadence; actual combat continues through the normal hostile loop.
  const PROVOKE_SECONDS = 45; // Temporary self-defense window after the player hurts a hunter without yet changing permanent Favor.

  let combatDeps = null; // Captured from BanditCombat.init; provides scenes, movement, terrain, tool definitions, and hostileObjects.
  let schedulingDeps = null; // Captured from NpcScheduling.init; provides the live chief walker and normal NPC database record.
  let cfg = null; // Parsed porakaneki-camp.json used by all behavior below.
  let localeDef = null; // Parsed locale definition used by TemporaryLocales.stamp.
  let gangCfg = null; // Existing bandit balance config reused for generated humanoid stats/abilities.
  let tickAccum = 0; // Throttles neutral behavior/LOD work to TICK_INTERVAL_S.
  let coarseAccum = 0; // Drives the deliberately low-frequency off-chunk abstract simulation.
  let buildGeneration = 0; // Invalidates async portrait builds when the generated wilderness layout changes.

  const state = {
    layoutRef: null, // Exact generated-zone layout currently carrying the camp.
    view: null, // TemporaryLocales-compatible 2D occupancy view inflated from that layout.
    instance: null, // TemporaryLocales stamp record.
    props: [], // Camp objects created by the stamp.
    propMeshes: new Map(), // propId -> render entry for tents/campfire/supplies.
    center: null, // Camp center in tile/world-unit coordinates.
    hunters: [], // Abstract hunters: {index, weaponShape, x, y, activity, target, decisionT, entity, ...}.
    chiefBehaviorKey: null, // Prevents reauthoring the same live chief record every tick.
    warningEnteredAtMs: 0, // Territory warning timer while negative Favor and inside the warning radius.
    warningInitialShown: false, // One immediate warning per approach.
    warningEscalated: false, // One 10-second escalation per approach.
    provokedUntilMs: 0, // Temporary group self-defense window after any hunter is attacked.
    lastReason: 'boot', // Mobile-debug lifecycle note.
    stamps: 0, // Session diagnostic: successful camp stamps.
    materializations: 0, // Session diagnostic: generated humanoid entities built.
    coarseTicks: 0, // Session diagnostic: abstract off-chunk updates.
    greetings: 0, // Session diagnostic: Porakaneki greetings shown at Favor >= 1.
    kills: 0, // Session diagnostic: player-attributed hunter deaths penalized.
  };

  const num = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
  const nowMs = () => typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  const rand = () => {
    const value = combatDeps?.rnd?.(); // Use the game's current seeded/random stream when available so hunter variation participates in normal world randomness.
    return Number.isFinite(value) ? value : Math.random();
  };

  function currentArea() { return combatDeps?.getCurrentArea?.() || null; }
  function gameHour() {
    const value = Number(window.CalendarSystem?.getHour?.()); // Same 24-hour clock used by normal NPC scheduling.
    return Number.isFinite(value) ? ((value % 24) + 24) % 24 : 12;
  }
  function gameDay() {
    const raw = Number(window.CalendarSystem?.timeDebugSnapshot?.()?.rawDay); // Absolute day is preferred for daily greeting/sleep randomization markers.
    if (Number.isFinite(raw)) return Math.max(0, Math.floor(raw));
    return Math.max(0, Math.floor(Number(combatDeps?.calendar?.day ?? 0) || 0));
  }
  function isSleepingHour(hour = gameHour()) {
    const start = num(cfg?.schedule?.sleepStartHour, 22); // Authored nightly sleep start used by chief agenda and hunters.
    const wake = num(cfg?.schedule?.wakeHour, 6); // Authored wake hour used by chief agenda and hunters.
    return start > wake ? (hour >= start || hour < wake) : (hour >= start && hour < wake);
  }

  function hashSeed(text) {
    let h = 2166136261 >>> 0; // Deterministic FNV-style seed used only for camp placement and day-stable sleeping choices.
    for (const ch of String(text || '')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function seededRng(text) {
    let a = hashSeed(text) || 0x9e3779b9; // Mulberry32 state keeps locale placement repeatable for one generated layout.
    return () => {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function buildZoneView(zoneId, layout) {
    if (!layout?.cols || !layout?.rows || !combatDeps) return null;
    const cols = layout.cols, rows = layout.rows; // Dimensions used to inflate sparse generated tiles for TemporaryLocales and abstract-target validity checks.
    const tiles = Array.from({ length: rows }, () => new Array(cols).fill(null));
    const objects = [];
    for (const tileSource of (layout.tiles || [])) {
      if (!(tileSource.r >= 0 && tileSource.r < rows && tileSource.c >= 0 && tileSource.c < cols)) continue;
      const tile = {
        height: tileSource.elevTier || 0,
        water: !!combatDeps.WATERWAY_TYPES?.has?.(tileSource.type),
        path: tileSource.type === combatDeps.TileType?.PATH,
        ramp: tileSource.type === combatDeps.TileType?.RAMP || !!tileSource.incline,
        waterfall: tileSource.type === combatDeps.TileType?.WATERFALL,
        terrain: tileSource.type,
        occupiedBy: null,
      }; // TemporaryLocales' site-fit fields only; underlying generated terrain is never mutated.
      tiles[tileSource.r][tileSource.c] = tile;
      if (tileSource.type === combatDeps.TileType?.SHRUB || tileSource.type === combatDeps.TileType?.ROCK) {
        const id = `porakaneki_clutter_${tileSource.c}_${tileSource.r}`; // Existing visible clutter blocks placement rather than being cleared by the camp.
        tile.occupiedBy = id;
        objects.push({ id, type: 'unique', x: tileSource.c, y: tileSource.r, w: 1, h: 1, localeMeta: true });
      }
    }

    let blockerSeq = 0; // Generates stable-enough blocker ids for the temporary occupancy view.
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

    const zoneDef = combatDeps.EXTERIOR_ZONES?.[zoneId]; // Entry fallback used only when the generated layout has no toTownExit.
    const entry = layout.toTownExit
      ? { x: layout.toTownExit.col, y: layout.toTownExit.row }
      : (Number.isFinite(zoneDef?.entryCol) ? { x: zoneDef.entryCol, y: zoneDef.entryRow } : null);
    return { cols, rows, tiles, objects, entry };
  }

  function pointIsOpen(col, row) {
    const c = Math.floor(col), r = Math.floor(row); // Integer tile inspected in the abstract occupancy view.
    const tile = state.view?.tiles?.[r]?.[c];
    return !!tile && !tile.water && !tile.waterfall && !tile.occupiedBy;
  }
  function nearestOpenPoint(col, row) {
    const cols = state.view?.cols || 1, rows = state.view?.rows || 1; // Bounds keep abstract agents inside the generated map.
    const baseCol = clamp(col, 1.25, Math.max(1.25, cols - 1.25));
    const baseRow = clamp(row, 1.25, Math.max(1.25, rows - 1.25));
    if (pointIsOpen(baseCol, baseRow)) return { col: baseCol, row: baseRow };
    for (let radius = 1; radius <= 4; radius++) {
      for (let attempt = 0; attempt < 16; attempt++) {
        const angle = (attempt / 16) * Math.PI * 2;
        const candidate = { col: baseCol + Math.cos(angle) * radius, row: baseRow + Math.sin(angle) * radius };
        if (pointIsOpen(candidate.col, candidate.row)) return candidate;
      }
    }
    return { col: baseCol, row: baseRow };
  }
  function randomPointAround(origin, minRadius, maxRadius) {
    const angle = rand() * Math.PI * 2; // Fresh random direction makes every neutral decision an opportunity to drift somewhere new.
    const distance = minRadius + rand() * Math.max(0, maxRadius - minRadius);
    return nearestOpenPoint(origin.col + Math.cos(angle) * distance, origin.row + Math.sin(angle) * distance);
  }

  function ensureCampStamp() {
    if (!cfg || !localeDef || !combatDeps || !window.TemporaryLocales) return false;
    const layout = combatDeps.zoneLayouts?.get?.(cfg.zoneId); // Current generated Western Slope layout that owns the camp for this Tothal generation.
    if (!layout) return false;
    if (state.layoutRef !== layout) resetForLayout(layout);
    if (state.instance) return true;

    const view = buildZoneView(cfg.zoneId, layout); // Separate occupancy adapter prevents runtime camp placement from rewriting procedural terrain.
    if (!view) return false;
    const instance = window.TemporaryLocales.stamp(view, localeDef, {
      rng: seededRng(`${cfg.zoneId}:${layout.cols}x${layout.rows}:porakaneki-camp`),
      clearableTypes: new Set(), // Explicitly bulldozes nothing.
      clearanceTiles: localeDef.placement?.clearanceTiles ?? 2,
      requiresFlatGround: localeDef.placement?.requiresFlatGround !== false,
      minDistanceFromEntry: localeDef.placement?.minDistanceFromEntry ?? 10,
      instanceId: `porakaneki_camp_${cfg.zoneId}`,
    });
    if (!instance) { state.lastReason = 'no-valid-camp-site'; return false; }

    state.view = view;
    state.instance = instance;
    state.props = view.objects.filter(object => object.temporaryLocaleInstanceId === instance.id); // Only newly stamped camp objects, excluding placement blockers.
    state.center = { col: instance.site.x + instance.site.w * 0.5, row: instance.site.y + instance.site.h * 0.5 };
    state.stamps += 1;
    state.lastReason = `stamped:${state.center.col.toFixed(1)},${state.center.row.toFixed(1)}`;
    return true;
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
  function clearCampMeshes() {
    for (const entry of state.propMeshes.values()) {
      if (entry.light) entry.light.parent?.remove?.(entry.light);
      disposeObject3D(entry.mesh);
    }
    state.propMeshes.clear();
  }
  function tentMesh() {
    const group = new THREE.Group(); // Tent root used for placement and outline treatment.
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
    const group = new THREE.Group(); // Lightweight supply-prop fallback when no authored furniture builder is available.
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.65, 0.75), new THREE.MeshLambertMaterial({ color: 0x6b4d2c }));
    box.position.y = 0.325;
    box.castShadow = true;
    group.add(box);
    return group;
  }
  function campfireMesh() {
    const built = window.ProceduralFurniture?.buildFurnitureGroup?.('campfire', 0x6b4a28); // Existing furniture art preferred for visual parity.
    if (built) return built;
    const group = new THREE.Group();
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.48, 6), new THREE.MeshBasicMaterial({ color: 0xff8a22 }));
    flame.position.y = 0.25;
    group.add(flame);
    return group;
  }
  function ensureCampMeshes() {
    if (!combatDeps || currentArea() !== cfg?.zoneId || !state.instance || typeof THREE === 'undefined') return;
    const zone = combatDeps.zoneScenes?.get?.(cfg.zoneId); // Live streamed Western Slope scene/grid.
    if (!zone?.scene) return;
    const liveIds = new Set();
    for (const prop of state.props) {
      liveIds.add(prop.id);
      const prior = state.propMeshes.get(prop.id);
      if (prior?.mesh?.parent === zone.scene) continue;
      if (prior) { if (prior.light) prior.light.parent?.remove?.(prior.light); disposeObject3D(prior.mesh); state.propMeshes.delete(prop.id); }
      const col = prop.x + (prop.w || 1) * 0.5; // Prop center used for terrain sampling and scene placement.
      const row = prop.y + (prop.h || 1) * 0.5;
      const tile = zone.grid?.[Math.floor(row)]?.[Math.floor(col)];
      const y = tile && combatDeps.tileSurfaceYInArea ? num(combatDeps.tileSurfaceYInArea(tile, cfg.zoneId), 0) : 0;
      let mesh = prop.type === 'tent' ? tentMesh() : prop.key === 'campfire' ? campfireMesh() : crateMesh();
      if (!mesh) continue;
      mesh.position.set(col, y, row);
      combatDeps.markOutline?.(mesh);
      zone.scene.add(mesh);
      let light = null;
      if (prop.key === 'campfire') {
        light = new THREE.PointLight(0xff7722, 1.1, 3.2); // Campfire point light exists only while this zone scene is live.
        light.position.set(col, y + 0.45, row);
        light.userData.furnitureLightMask = true;
        zone.scene.add(light);
      }
      state.propMeshes.set(prop.id, { mesh, light });
    }
    for (const [id, entry] of [...state.propMeshes]) if (!liveIds.has(id)) { if (entry.light) entry.light.parent?.remove?.(entry.light); disposeObject3D(entry.mesh); state.propMeshes.delete(id); }
  }

  function tentCenters() {
    return state.props.filter(prop => prop.type === 'tent').map(prop => ({ col: prop.x + (prop.w || 1) * 0.5, row: prop.y + (prop.h || 1) * 0.5 })); // Available tents used as a shared sleep pool, never permanently assigned to specific people.
  }

  function chiefWalker() {
    const id = cfg?.reputation?.npcId || 'porakaneki_chief'; // Existing named lore NPC doubles as the tribe's relationship/social representative.
    return schedulingDeps?.npcWalkers?.find?.(walker => walker?.rec?.id === id) || null;
  }
  function authorChiefBehavior() {
    const walker = chiefWalker();
    if (!walker?.rec || !state.instance || !window.NpcScheduling?.registerNpcStations) return false;
    const key = `${state.instance.id}:${state.center.col.toFixed(2)}:${state.center.row.toFixed(2)}`; // Reauthor only when a new generated layout moves the camp.
    if (state.chiefBehaviorKey === key && walker.rec.scheduleHooks?.__porakanekiCampRuntime) return true;

    const tents = tentCenters();
    window.NpcScheduling.registerNpcStations(tents.map((tent, index) => ({
      id: `porakaneki_sleep_${index}`,
      label: 'Porakaneki Tent',
      area: cfg.zoneId,
      c: tent.col,
      r: tent.row,
      pose: 'lie',
      roles: ['porakaneki-sleep'],
    })), cfg.zoneId); // Multiple equivalent sleep stations let the ordinary activity planner choose available tent space instead of pinning the chief to one tent.

    walker.rec.gender = 'male';
    walker.rec.species = SPECIES_ID;
    walker.rec.appearance = { ...(walker.rec.appearance || {}), speciesId: SPECIES_ID, gender: 'male' };
    walker.rec.scheduleHooks = {
      ...(walker.rec.scheduleHooks || {}),
      defaultMapId: cfg.zoneId,
      defaultPosition: { c: state.center.col, r: state.center.row }, // Spawn/bootstrap fallback only; daytime movement is planner-driven rather than station-locked.
      __porakanekiCampRuntime: true,
      rules: [],
    };
    walker.rec.agenda = [
      { id: 'porakaneki_sleep_late', activity: 'goToRole', obligation: 'plan', window: ['22:00', '23:59'], destinationRole: 'porakaneki-sleep', destinationArea: cfg.zoneId, activityLabel: 'sleeping' },
      { id: 'porakaneki_sleep_early', activity: 'goToRole', obligation: 'plan', window: ['00:00', '06:00'], destinationRole: 'porakaneki-sleep', destinationArea: cfg.zoneId, activityLabel: 'sleeping' },
      { id: 'porakaneki_day', activity: 'break', obligation: 'leisure', window: ['06:00', '22:00'], activityLabel: 'around the hunting camp' },
    ]; // Daytime intentionally routes through the new free-time planner: wander, socialize, watch stimuli, sit where applicable, and generally react rather than march between fixed authored points.
    state.chiefBehaviorKey = key;
    return true;
  }

  function relationshipState() {
    const id = cfg?.reputation?.npcId || 'porakaneki_chief'; // One durable relationship record is the tribe-wide Favor source.
    return window.DialogueContent?.getNpcDlgState?.(id) || window.DialogueContent?.npcDlgState?.get?.(id) || null;
  }
  function memoryHas(relation, event) { return !!relation?.memory?.some?.(entry => entry?.event === event || entry?.type === event); }
  function pushMemory(relation, event) {
    if (!relation) return;
    relation.memory ||= [];
    relation.memory.push({ event, day: gameDay(), ts: Date.now() }); // Same minimal serializable memory shape used by the dialogue relationship system.
    if (relation.memory.length > 50) relation.memory.shift();
  }
  function initializeReputation() {
    const relation = relationshipState();
    if (!relation) return false;
    const rep = cfg?.reputation || {};
    const marker = rep.initializationMemoryEvent || 'porakaneki_faction_initialized'; // Persistent marker guarantees the initial disposition is a one-time migration.
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
    relation.favor = clamp(num(relation.favor, 0) + amount, num(rep.minimumFavor, -5), num(rep.maximumFavor, 10)); // Porakaneki reputation never leaves the canonical -5..10 Favor range.
    pushMemory(relation, reason);
    window.WorldPopupText?.queueReward?.('favor', `${amount > 0 ? '+' : '-'}${Math.abs(amount)} Porakaneki Favor`);
    return relation.favor;
  }

  function chooseLine(lines) {
    if (!Array.isArray(lines) || !lines.length) return '';
    return lines[Math.floor(rand() * lines.length)] || lines[0]; // Independent random line choice avoids every approach sounding identical.
  }
  function updateTerritoryWarnings() {
    const rep = cfg?.reputation || {};
    const currentFavor = favor();
    if (!state.center || currentArea() !== cfg.zoneId || !combatDeps?.player || currentFavor >= 0 || currentFavor <= num(rep.attackOnSightFavor, -5)) {
      state.warningEnteredAtMs = 0; state.warningInitialShown = false; state.warningEscalated = false; return;
    }
    const playerCol = combatDeps.player.x / combatDeps.TILE; // Player tile/world-unit position used for camp territory distance.
    const playerRow = combatDeps.player.y / combatDeps.TILE;
    const distance = Math.hypot(playerCol - state.center.col, playerRow - state.center.row);
    if (distance > num(rep.warningRadiusTiles, 10)) {
      state.warningEnteredAtMs = 0; state.warningInitialShown = false; state.warningEscalated = false; return;
    }
    if (!state.warningEnteredAtMs) state.warningEnteredAtMs = nowMs();
    if (!state.warningInitialShown) {
      state.warningInitialShown = true;
      const text = chooseLine(rep.initialWarnings);
      if (text) combatDeps.showToast?.(text, false);
    }
    if (!state.warningEscalated && nowMs() - state.warningEnteredAtMs >= num(rep.warningStaySeconds, 10) * 1000) {
      state.warningEscalated = true;
      const text = chooseLine(rep.escalationWarnings);
      if (text) combatDeps.showToast?.(text, false);
    }
  }

  function maybeChiefGreeting() {
    const rep = cfg?.reputation || {};
    if (favor() < num(rep.greetingFavorThreshold, 1)) return;
    const walker = chiefWalker();
    if (!walker?.root || walker.area !== currentArea() || walker.area !== cfg.zoneId || !combatDeps?.player) return;
    const distance = Math.hypot(walker.root.position.x - combatDeps.player.x / combatDeps.TILE, walker.root.position.z - combatDeps.player.y / combatDeps.TILE); // Actual chief-to-player distance; no authored greeting position.
    if (distance > num(rep.greetingRadiusTiles, 3)) return;
    const marker = `porakaneki_chief_greet_day_${gameDay()}`; // Prevents greeting spam without modifying Favor/Rapport.
    const relation = relationshipState();
    if (!relation || memoryHas(relation, marker)) return;
    pushMemory(relation, marker);
    combatDeps.showToast?.('The Porakaneki chief greets you.', true);
    state.greetings += 1;
  }

  function chunkSizeTiles() { return Math.max(2, Math.floor(num(cfg?.behavior?.fullSimulationChunkTiles, 10))); }
  function chunkOf(col, row) {
    const size = chunkSizeTiles(); // Shared chunk granularity used by materialization and diagnostics.
    return { x: Math.floor(col / size), y: Math.floor(row / size) };
  }
  function playerTilePosition() {
    if (!combatDeps?.player || !combatDeps?.TILE) return null;
    return { col: combatDeps.player.x / combatDeps.TILE, row: combatDeps.player.y / combatDeps.TILE };
  }
  function sharesPlayerChunk(hunter) {
    if (currentArea() !== cfg?.zoneId || !hunter) return false;
    const player = playerTilePosition();
    if (!player) return false;
    const a = chunkOf(hunter.x, hunter.y), b = chunkOf(player.col, player.row);
    return a.x === b.x && a.y === b.y;
  }

  function weaponRoll() {
    const shapes = Array.isArray(cfg?.equipment?.weaponShapes) && cfg.equipment.weaponShapes.length
      ? cfg.equipment.weaponShapes : ['fishingspear', 'hatchet', 'daggerSword']; // Allowed Porakaneki hunting weapons; every hunter samples independently, so duplicates are intentionally possible.
    return shapes[Math.floor(rand() * shapes.length)] || shapes[0];
  }
  function weaponDef(shapeKey) {
    const metalKey = cfg?.equipment?.weaponMetalKey || 'nativeCopper'; // Shared authored material used when building the generated held tool key.
    const shape = combatDeps?.HELD_SHAPE_DEFS?.[shapeKey] || {};
    return {
      shapeKey,
      metalKey,
      weaponKey: combatDeps?.craftedToolItemKey?.(shapeKey, metalKey) || shapeKey,
      attackTag: shape.dmgType || 'sharp',
      ranged: shapeKey === 'daggerSword',
    };
  }
  function randomCampPoint() {
    const radius = num(cfg?.behavior?.campSocialRadiusTiles, 8); // Broad camp-social radius, never one fixed return coordinate.
    return randomPointAround(state.center, 1.5, radius);
  }
  function ensureAbstractHunters() {
    if (!state.center) return;
    const count = Math.max(1, Math.floor(num(cfg?.population?.hunters, 3)));
    while (state.hunters.length < count) {
      const index = state.hunters.length;
      const spawn = randomCampPoint();
      state.hunters.push({
        index,
        weaponShape: weaponRoll(), // Independent roll: any combination of spear/hatchet/dagger, including repeats, is valid.
        x: spawn.col,
        y: spawn.row,
        activity: 'camp',
        target: null,
        decisionT: rand() * 2,
        entity: null,
        building: false,
        sleepDay: -1,
        sleepPoint: null,
        greetingDay: -1,
        lastHealth: null,
        killCounted: false,
      });
    }
  }

  function chooseHunterActivity(hunter) {
    const stimulusRadius = num(cfg?.behavior?.stimulusInterestRadiusTiles, 12); // Maximum nearby social/world-stimulus distance considered by generated hunters.
    const found = window.NpcSocialStimuli?.strongestNear?.(cfg.zoneId, hunter.x, hunter.y);
    if (found?.stimulus) {
      const sx = num(found.stimulus.x, NaN), sy = num(found.stimulus.z, NaN);
      if (Number.isFinite(sx) && Number.isFinite(sy) && Math.hypot(sx - hunter.x, sy - hunter.y) <= stimulusRadius) {
        hunter.activity = 'investigate';
        hunter.target = nearestOpenPoint(sx + (rand() - 0.5) * 2, sy + (rand() - 0.5) * 2); // Reacts to music/social stimuli without every hunter stacking on the exact source point.
        return;
      }
    }

    const weights = cfg?.behavior?.activityWeights || {};
    const entries = [
      ['hunt', Math.max(0, num(weights.hunt, 0.52))],
      ['wander', Math.max(0, num(weights.wander, 0.24))],
      ['socialize', Math.max(0, num(weights.socialize, 0.16))],
      ['camp', Math.max(0, num(weights.camp, 0.08))],
    ]; // Same broad free-time philosophy as normal NPCs: a weighted opportunity choice, not a hard patrol script.
    const total = entries.reduce((sum, [, weight]) => sum + weight, 0) || 1;
    let roll = rand() * total;
    let activity = 'wander';
    for (const [name, weight] of entries) { roll -= weight; if (roll <= 0) { activity = name; break; } }

    if (activity === 'socialize') {
      const peers = state.hunters.filter(other => other !== hunter && !isSleepingHour() && Math.hypot(other.x - hunter.x, other.y - hunter.y) <= 14);
      if (peers.length) {
        const peer = peers[Math.floor(rand() * peers.length)]; // Any nearby Porakaneki can become the current social anchor; no permanent pairings or locations.
        hunter.activity = 'socialize';
        hunter.target = nearestOpenPoint(peer.x + (rand() - 0.5) * 3, peer.y + (rand() - 0.5) * 3);
        return;
      }
      activity = 'wander';
    }

    hunter.activity = activity;
    if (activity === 'hunt') {
      hunter.target = randomPointAround(state.center, num(cfg?.behavior?.huntRadiusMinTiles, 7), num(cfg?.behavior?.huntRadiusMaxTiles, 22)); // Broad hunting annulus around camp; a fresh point is chosen every decision cycle.
    } else if (activity === 'camp') {
      hunter.target = randomCampPoint();
    } else {
      hunter.target = randomPointAround({ col: hunter.x, row: hunter.y }, 2, num(cfg?.behavior?.localWanderRadiusTiles, 7));
    }
  }

  function sleepPointFor(hunter) {
    if (hunter.sleepDay === gameDay() && hunter.sleepPoint) return hunter.sleepPoint;
    const tents = tentCenters();
    const rng = seededRng(`porakaneki-sleep:${gameDay()}:${hunter.index}`); // One night-stable choice, rerolled next day; no hunter owns a permanent tent.
    const tent = tents.length ? tents[Math.floor(rng() * tents.length)] : state.center;
    hunter.sleepDay = gameDay();
    hunter.sleepPoint = nearestOpenPoint(tent.col + (rng() - 0.5) * 0.5, tent.row + (rng() - 0.5) * 0.5);
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
      hunter.decisionT = min + rand() * (max - min); // Variable commitment time produces loose, asynchronous movement rather than synchronized route changes.
    }
    if (!hunter.target) return;
    const dx = hunter.target.col - hunter.x, dy = hunter.target.row - hunter.y, distance = Math.hypot(dx, dy);
    if (!distance) return;
    const step = Math.min(distance, num(cfg?.behavior?.travelSpeedTilesPerSecond, 1.05) * dt);
    hunter.x += dx / distance * step;
    hunter.y += dy / distance * step;
  }

  function hunterRoster(hunter) {
    const cosmetics = [...(cfg?.equipment?.forcedCosmetics || ['rugged_poncho'])]; // Shared rough hunting clothes; hair/body variation remains species-driven where avatar composition supports it.
    return {
      name: `Porakaneki Hunter ${hunter.index + 1}`,
      appearance: { speciesId: SPECIES_ID, gender: 'male', cosmetics: {} },
      equippedCosmetics: cosmetics,
      appliedDyes: {},
      cosmeticSlots: Object.fromEntries(cosmetics.map(id => [id, 'overwear'])),
    };
  }
  function hideEntity(hunter) {
    const entity = hunter?.entity;
    if (!entity) return;
    hunter.x = entity.x / combatDeps.TILE; hunter.y = entity.y / combatDeps.TILE; // Preserve last detailed position before collapsing back into the abstract agent.
    entity.areaId = `${DORMANT_AREA_PREFIX}${cfg.zoneId}`;
    if (entity.avatarRef?.group) entity.avatarRef.group.visible = false;
    if (entity.groundShadow) entity.groundShadow.visible = false;
    if (entity._banditToolHolder) entity._banditToolHolder.visible = false;
    if (entity._banditRangedToolHolder) entity._banditRangedToolHolder.visible = false;
    entity.vx = 0; entity.vy = 0;
  }
  function placeEntity(hunter) {
    const entity = hunter?.entity;
    if (!entity || currentArea() !== cfg.zoneId) return false;
    const open = nearestOpenPoint(hunter.x, hunter.y); // Re-snaps coarse abstract positions to nearby valid ground before full simulation resumes.
    hunter.x = open.col; hunter.y = open.row;
    const grid = combatDeps.getActiveGrid?.();
    const cols = num(combatDeps.getActiveCols?.(), state.view?.cols || 1), rows = num(combatDeps.getActiveRows?.(), state.view?.rows || 1);
    const c = clamp(Math.floor(open.col), 0, Math.max(0, cols - 1)), r = clamp(Math.floor(open.row), 0, Math.max(0, rows - 1));
    const tile = grid?.[r]?.[c];
    const surface = tile && combatDeps.tileSurfaceYInArea ? num(combatDeps.tileSurfaceYInArea(tile, cfg.zoneId), 0) : 0;
    entity.x = open.col * combatDeps.TILE; entity.y = open.row * combatDeps.TILE;
    entity.homeX = entity.x; entity.homeY = entity.y; entity.areaId = cfg.zoneId; entity.areaGrid = grid; entity.areaCols = cols; entity.areaRows = rows;
    if (entity.avatarRef?.group) { entity.avatarRef.group.position.set(open.col, surface + (entity.halfHeight || 0.45), open.row); entity.avatarRef.group.visible = true; }
    if (entity.groundShadow) { entity.groundShadow.position.set(open.col, surface + (combatDeps.characterGroundShadowSurfaceOffset?.() || 0.01), open.row); entity.groundShadow.visible = true; }
    if (entity._banditToolHolder) entity._banditToolHolder.visible = true;
    if (entity._banditRangedToolHolder) entity._banditRangedToolHolder.visible = false;
    return true;
  }

  async function loadGangConfig() {
    if (!gangCfg) gangCfg = await window.BanditCombat?.loadGangConfig?.(); // Reuses existing humanoid combat tuning rather than forking Porakaneki-only attack math.
    return gangCfg;
  }
  async function materializeHunter(hunter, generation) {
    if (!hunter || hunter.entity || hunter.building || currentArea() !== cfg.zoneId) return hunter?.entity || null;
    hunter.building = true;
    try {
      const base = await loadGangConfig();
      if (!base || generation !== buildGeneration || currentArea() !== cfg.zoneId) return null;
      const weapon = weaponDef(hunter.weaponShape);
      const entity = await window.BanditCombat.makeEntity({
        ...base,
        speciesWeights: { [SPECIES_ID]: 1 },
        rangedWeaponChanceByRank: { grunt: 0, lieutenant: 0, captain: 0 },
      }, 'grunt', 0, hunter.x * combatDeps.TILE, hunter.y * combatDeps.TILE, {
        zoneId: cfg.zoneId,
        rosterOverride: hunterRoster(hunter),
        defOverride: {
          label: 'Porakaneki Hunter',
          weaponKey: weapon.weaponKey,
          weaponShapeKey: weapon.shapeKey,
          weaponMetalKey: weapon.metalKey,
          attackTag: weapon.attackTag,
          rangedWeaponKey: weapon.ranged ? weapon.weaponKey : null, // A randomly rolled dagger remains an ordinary melee dagger and also gets the generic thrown-weapon path.
        },
        extra: { isPorakanekiHunter: true, porakanekiHunterIndex: hunter.index, porakanekiWeaponShape: weapon.shapeKey, porakanekiCampInstanceId: state.instance?.id || null },
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
    entity._porakanekiAggroRangePx ??= num(entity.def?.aggroRangePx, combatDeps.TILE * 6); // Original combat aggro distance restored during temporary/permanent hostility.
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
  function groupProvoked() { return nowMs() < state.provokedUntilMs; }

  function updateViolence() {
    const player = playerTilePosition();
    if (!player) return;
    const attributionRadius = num(cfg?.reputation?.damageAttributionRadiusTiles, 14); // Fallback attribution because not every damage path currently carries explicit source ownership.
    for (const hunter of state.hunters) {
      const entity = hunter.entity;
      if (!entity) continue;
      const previous = Number.isFinite(hunter.lastHealth) ? hunter.lastHealth : num(entity.maxHealth, entity.health);
      const health = num(entity.health, 0);
      const closeToPlayer = Math.hypot(hunter.x - player.col, hunter.y - player.row) <= attributionRadius;
      if (health < previous && closeToPlayer) state.provokedUntilMs = Math.max(state.provokedUntilMs, nowMs() + PROVOKE_SECONDS * 1000); // Immediate group self-defense, but no permanent Favor loss for merely landing a hit.
      if (previous > 0 && health <= 0 && !hunter.killCounted && closeToPlayer) {
        hunter.killCounted = true;
        adjustFavor(-Math.abs(num(cfg?.reputation?.killPenalty, -1)), `porakaneki_kill_${hunter.index}`);
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
    hunter.x = entity.x / combatDeps.TILE; hunter.y = entity.y / combatDeps.TILE; // Detailed combat/movement position is authoritative while materialized.
    const permanentlyHostile = favor() <= num(cfg?.reputation?.attackOnSightFavor, -5);
    if (permanentlyHostile || groupProvoked()) { makeHostile(entity); return; }

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
      combatDeps.moveCreatureToward?.(entity, tx, ty, num(cfg?.behavior?.travelSpeedTilesPerSecond, 1.05) * combatDeps.TILE, dt); // Existing collision-aware creature movement keeps full-sim neutral wandering on actual walkable terrain.
      hunter.x = entity.x / combatDeps.TILE; hunter.y = entity.y / combatDeps.TILE;
    }
    maybeHunterGreeting(hunter);
  }

  function updateHunters(dt, coarseDt) {
    ensureAbstractHunters();
    updateViolence();
    const generation = buildGeneration;
    const sleeping = isSleepingHour();
    for (const hunter of state.hunters) {
      if (hunter.entity?.health <= 0) continue;
      if (sleeping) {
        advanceAbstractHunter(hunter, coarseDt || dt); // Sleeping collapses immediately into a randomly chosen tent for that night.
        hideEntity(hunter);
        continue;
      }

      const full = sharesPlayerChunk(hunter);
      if (!full) {
        hideEntity(hunter);
        if (coarseDt > 0) advanceAbstractHunter(hunter, coarseDt); // Different chunk: only coarse abstract activity/position, no pathfinding/avatar/combat work.
        continue;
      }

      if (!hunter.entity && !hunter.building) materializeHunter(hunter, generation).catch(error => window.__farmLog?.(`[porakaneki] materialize failed: ${error.message}`, 'warn'));
      if (hunter.entity) { placeEntityIfDormant(hunter); updateDetailedHunter(hunter, dt); }
    }
  }
  function placeEntityIfDormant(hunter) {
    const entity = hunter.entity;
    if (!entity) return;
    if (entity.areaId !== cfg.zoneId || !entity.avatarRef?.group?.visible) placeEntity(hunter); // Rematerializes at the abstract location when the player's chunk catches up with the hunter.
  }

  function teardownHunters(reason) {
    buildGeneration += 1;
    for (const hunter of state.hunters) {
      const entity = hunter.entity;
      if (!entity) continue;
      const index = combatDeps?.hostileObjects?.indexOf?.(entity); // Removes only generated Porakaneki entries from the shared hostile array.
      if (index >= 0) combatDeps.hostileObjects.splice(index, 1);
      entity.avatarRef?.group?.parent?.remove?.(entity.avatarRef.group);
      entity.groundShadow?.parent?.remove?.(entity.groundShadow);
      entity._banditToolHolder?.parent?.remove?.(entity._banditToolHolder);
      entity._banditRangedToolHolder?.parent?.remove?.(entity._banditRangedToolHolder);
      entity.avatarRef?.dispose?.();
    }
    state.hunters.length = 0;
    state.lastReason = reason;
  }
  function resetForLayout(layout) {
    teardownHunters('layout-changed');
    clearCampMeshes();
    state.layoutRef = layout;
    state.view = null;
    state.instance = null;
    state.props = [];
    state.center = null;
    state.chiefBehaviorKey = null;
    state.warningEnteredAtMs = 0;
    state.warningInitialShown = false;
    state.warningEscalated = false;
  }

  async function loadConfig() {
    try {
      const [configResponse, localeResponse] = await Promise.all([fetch(CONFIG_URL), fetch(LOCALE_URL)]); // Parallel startup fetch; both payloads are tiny and cached by the browser.
      if (!configResponse.ok) throw new Error(`config HTTP ${configResponse.status}`);
      if (!localeResponse.ok) throw new Error(`locale HTTP ${localeResponse.status}`);
      cfg = await configResponse.json(); localeDef = await localeResponse.json(); state.lastReason = 'config-ready'; return cfg;
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
    const step = tickAccum; tickAccum = 0; // Actual accumulated neutral-detailed step used for collision-aware movement.
    const coarseInterval = Math.max(1, num(cfg?.behavior?.offChunkTickSeconds, 4));
    const coarseStep = coarseAccum >= coarseInterval ? coarseAccum : 0;
    if (coarseStep) { coarseAccum = 0; state.coarseTicks += 1; }
    if (!cfg || !localeDef || !combatDeps || !ensureCampStamp()) return;

    initializeReputation();
    authorChiefBehavior();
    ensureCampMeshes();
    updateTerritoryWarnings();
    maybeChiefGreeting();
    updateHunters(step, coarseStep);
  }

  function installBanditCombat(api = window.BanditCombat) {
    if (!api || typeof api.init !== 'function') return false;
    if (api.__porakanekiCampInitWrapped) return true;
    const original = api.init.bind(api); // Existing combat initialization stays authoritative; this wrapper only captures its dependency bundle.
    api.init = function porakanekiBanditInit(injected) { combatDeps = injected; return original(injected); };
    api.__porakanekiCampInitWrapped = true;
    return true;
  }
  function installScheduling(api = window.NpcScheduling) {
    if (!api || typeof api.init !== 'function') return false;
    if (api.__porakanekiCampInitWrapped) return true;
    const original = api.init.bind(api); // Existing scheduler initialization stays authoritative; this wrapper only captures live npcWalkers.
    api.init = function porakanekiSchedulingInit(injected) { schedulingDeps = injected; return original(injected); };
    api.__porakanekiCampInitWrapped = true;
    return true;
  }
  function installTick(api = window.BanditCamps) {
    if (!api || typeof api.updateCampBanners !== 'function') return false;
    if (api.updateCampBanners.__porakanekiCampWrapped) return true;
    const original = api.updateCampBanners.bind(api); // Existing cheap game-loop seam, shared with Harlyao-style runtimes.
    const wrapped = function porakanekiTick(dt) { update(dt); return original(dt); };
    wrapped.__porakanekiCampWrapped = true;
    api.updateCampBanners = wrapped;
    return true;
  }
  function watchNamespace(name, installer) {
    if (installer(window[name])) return;
    const descriptor = Object.getOwnPropertyDescriptor(window, name); // Parser-time setter catches modules assigned later without polling forever.
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

  function debugSnapshot() {
    const relation = relationshipState(); // Relationship and LOD data included for copyable mobile verification without a console.
    const player = playerTilePosition();
    const playerChunk = player ? chunkOf(player.col, player.row) : null;
    return {
      configReady: !!cfg,
      localeReady: !!localeDef,
      combatDepsReady: !!combatDeps,
      schedulingDepsReady: !!schedulingDeps,
      zoneId: cfg?.zoneId || null,
      currentArea: currentArea(),
      stamped: !!state.instance,
      center: state.center ? { ...state.center } : null,
      favor: relation ? num(relation.favor, 0) : null,
      attackOnSight: !!relation && !!cfg && num(relation.favor, 0) <= num(cfg.reputation?.attackOnSightFavor, -5),
      provoked: groupProvoked(),
      chunkSizeTiles: chunkSizeTiles(),
      playerChunk,
      hunters: state.hunters.map(hunter => ({
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
      chiefPlannerAgenda: !!chiefWalker()?.rec?.agenda?.some?.(beat => beat.id === 'porakaneki_day'),
      materializations: state.materializations,
      coarseTicks: state.coarseTicks,
      greetings: state.greetings,
      kills: state.kills,
      lastReason: state.lastReason,
    };
  }

  window.PorakanekiCamps = Object.freeze({
    version: 2,
    update,
    ensureCampStamp,
    initializeReputation,
    favor,
    debugSnapshot,
    formatDebug: () => {
      const d = debugSnapshot();
      const center = d.center ? `${d.center.col.toFixed(1)},${d.center.row.toFixed(1)}` : '-';
      const hunters = d.hunters.map(h => `#${h.index}:${h.weapon}/${h.activity}@${h.chunk.x},${h.chunk.y}${h.fullSimulation ? '*' : ''}`).join(' ');
      return `Porakaneki camp: v2 cfg=${d.configReady}/${d.localeReady} deps=${d.combatDepsReady}/${d.schedulingDepsReady} zone=${d.zoneId || '-'} area=${d.currentArea || '-'} camp=${d.stamped}@${center} favor=${d.favor ?? '-'} AOS=${d.attackOnSight} provoked=${d.provoked} chunk=${d.chunkSizeTiles} player=${d.playerChunk ? `${d.playerChunk.x},${d.playerChunk.y}` : '-'} chiefPlanner=${d.chiefPlannerAgenda} hunters=[${hunters || '-'}] mats=${d.materializations} coarse=${d.coarseTicks} greet=${d.greetings} kills=${d.kills} reason=${d.lastReason}`;
    },
    __test: Object.freeze({ isSleepingHour, chunkOf, weaponRoll, chooseHunterActivity }),
  });

  watchNamespace('BanditCombat', installBanditCombat);
  watchNamespace('NpcScheduling', installScheduling);
  watchNamespace('BanditCamps', installTick);
  loadConfig();
})();
