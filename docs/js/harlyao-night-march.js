(() => {
  'use strict';

  // Nightly Harlyao army controller.
  //
  // The persistent/offscreen state is intentionally tiny: civil day, active
  // wilderness zone, and one 16x16 wilderness chunk coordinate. Twenty full
  // humanoid portraits/hands/feet/weapons are constructed only while the player
  // shares that chunk. Once observed, movement is allowed to drift naturally
  // across chunk boundaries rather than teleporting to satisfy the clock.
  const CONFIG_URL = 'config/harlyao-night-march.json'; // Loaded once to keep route/equipment/formation/visual tuning out of runtime logic.
  const SPECIES_ID = 'harlyao'; // Used in every forced roster so the army always exercises the dedicated NPC-only species path.
  const DORMANT_AREA_PREFIX = '__harlyao_night_march__:'; // Makes the existing hostile loop skip cached army members while they are outside the player's chunk.
  const FALLBACK_CHUNK_TILES = 16; // Matches WildernessChunks and keeps the controller functional if that module has not exported constants yet.
  const MATERIALIZE_YIELD_EVERY = 2; // Yields between small portrait batches so building twenty humanoid rigs does not monopolize one frame.
  const ROUTE_EPSILON_TILES = 0.15; // Keeps formation targets safely inside/at wilderness boundaries instead of asking occupancy code to step outside the map.

  let deps = null; // Captured from BanditCombat.init; supplies the same movement/grid/scene/tool helpers already used by ordinary bandits.
  let config = null; // Holds parsed harlyao-night-march.json after the one-time fetch completes.
  let gangConfig = null; // Reuses the established bandit stat/mastery data while overriding species/equipment/ranged behavior for this army.
  let materializePromise = null; // Prevents two chunk-entry updates from constructing duplicate twenty-member formations concurrently.
  let generation = 0; // Invalidates an in-flight materialization when daylight/day/zone changes before its async portrait builds finish.
  let unregisterGlow = null; // Removes the one formation-level Ghostify lighting provider if this controller is ever reinstalled.

  const runtime = {
    civilDay: null, // Identifies the currently active daily clockwise route.
    zoneId: null, // Stores the single wilderness zone selected for the current civil day.
    members: [], // Holds cached live humanoid entities only after the player has actually encountered the formation.
    visible: false, // Distinguishes expensive fully active entities from cached/dormant objects skipped by updateHostiles.
    provoked: false, // Becomes true for the whole army after any member takes a hit and persists for that night's route.
    liveChunk: null, // Tracks actual observed movement, which can drift ahead of the coarse hourly schedule.
    observedRouteStep: 0, // Prevents an observed march from snapping backward if it later dematerializes before the clock catches up.
    lastCoarseKey: null, // Used to emit one mobile/debug log per whole-hour coarse route change rather than per frame.
    lastReason: 'boot', // Exposed in debugSnapshot so mobile reports explain the latest show/hide/reset transition.
    materializations: 0, // Counts completed/started visible formation builds for performance diagnostics.
    dematerializations: 0, // Counts chunk-exit hides without destroying cached portrait rigs.
  };

  function clamp(value, lo, hi) {
    return Math.max(lo, Math.min(hi, value));
  }

  function chunkTiles() {
    return Number(window.WildernessChunks?.constants?.CHUNK_TILES) || FALLBACK_CHUNK_TILES;
  }

  function chunkCount(axisTiles) {
    return Math.max(1, Math.ceil(Math.max(1, Number(axisTiles) || 1) / chunkTiles()));
  }

  function civilDayNumber() {
    const debug = window.CalendarSystem?.timeDebugSnapshot?.(); // Preferred source survives the civil-midnight compatibility bridge and exposes its raw absolute day.
    const raw = Number(debug?.rawDay);
    if (Number.isFinite(raw)) return Math.max(1, Math.floor(raw));
    const fallback = Number(deps?.calendar?.day ?? window.calendar?.day ?? 1); // Keeps tests/early startup functional before timeDebugSnapshot exists.
    return Math.max(1, Math.floor(Number.isFinite(fallback) ? fallback : 1));
  }

  function gameHour() {
    const raw = Number(window.CalendarSystem?.getHour?.()); // Uses the same clock read by WeatherFX/NPC schedules rather than inventing a second night timer.
    if (!Number.isFinite(raw)) return 12;
    return ((raw % 24) + 24) % 24;
  }

  function routeForDay(dayNumber, cfg = config) {
    const routes = cfg?.routesClockwise || []; // Canonical clockwise sequence: north, east, south, west wilderness zones.
    if (!routes.length) return null;
    const zeroBasedDay = Math.max(0, Math.floor(Number(dayNumber) || 1) - 1); // Makes civil day 1 start in Northern Cliffs while preserving a simple modulo cycle afterward.
    return routes[zeroBasedDay % routes.length] || null;
  }

  function zoneDimensions(zoneId) {
    const zdef = deps?.EXTERIOR_ZONES?.[zoneId] || window.EXTERIOR_ZONES?.[zoneId] || null; // Reads actual procedural-map dimensions instead of hardcoding today's 200x200 wilderness size.
    return {
      cols: Math.max(1, Number(zdef?.cols) || 200),
      rows: Math.max(1, Number(zdef?.rows) || 200),
    };
  }

  function coarseStateFor(dayNumber, hourValue, cfg = config, dimsOverride = null) {
    const route = routeForDay(dayNumber, cfg); // Selects exactly one wilderness zone for the whole civil day.
    const start = Number(cfg?.activeHours?.start ?? 0); // Defines the inclusive midnight start of the spectral march.
    const end = Number(cfg?.activeHours?.end ?? 6); // Defines the exclusive 06:00 disappearance boundary.
    const stepHours = Math.max(0.25, Number(cfg?.activeHours?.coarseStepHours ?? 1)); // Controls how rarely the offscreen chunk state is recomputed.
    const hour = Number(hourValue); // Kept separate so regression tests can feed exact night hours without touching CalendarSystem.
    if (!route || !Number.isFinite(hour) || hour < start || hour >= end) {
      return { active: false, day: dayNumber, hour, route, zoneId: route?.zoneId || null };
    }

    const dims = dimsOverride || zoneDimensions(route.zoneId); // Supplies the route-axis and cross-axis chunk counts from the live wilderness definition.
    const routeTiles = route.axis === 'z' ? dims.rows : dims.cols; // Converts the user's N/S routes to row count and E/W routes to column count.
    const crossTiles = route.axis === 'z' ? dims.cols : dims.rows; // Supplies the fixed central lane coordinate perpendicular to travel.
    const routeChunks = chunkCount(routeTiles); // Current 200-tile maps yield thirteen 16-tile chunks along the travel axis.
    const crossChunks = chunkCount(crossTiles); // Used to pick the configured center-ish lane on the perpendicular axis.
    const slotCount = Math.max(1, Math.ceil((end - start) / stepHours)); // Six one-hour slots map midnight through 05:59 across the entire thirteen-chunk axis.
    const slot = clamp(Math.floor((hour - start) / stepHours), 0, slotCount - 1); // Ensures offscreen simulation changes only when the configured coarse time step changes.
    const routeStep = slotCount <= 1 ? 0 : Math.round((slot / (slotCount - 1)) * (routeChunks - 1)); // Maps the six hourly states over all route chunks, including both endpoints.
    const directionalIndex = route.direction >= 0 ? routeStep : (routeChunks - 1 - routeStep); // Reverses southern/western traversals without changing progress semantics.
    const crossFraction = clamp(Number(cfg?.routeLane?.crossAxisFraction ?? 0.5), 0, 1); // Places the army on one deterministic lane rather than chasing the player's cross-axis chunk.
    const crossIndex = clamp(Math.round(crossFraction * (crossChunks - 1)), 0, crossChunks - 1); // Converts the lane fraction into one stable perpendicular chunk coordinate.
    const cx = route.axis === 'x' ? directionalIndex : crossIndex; // Northern/Southern routes vary X and keep Z fixed.
    const cz = route.axis === 'z' ? directionalIndex : crossIndex; // Eastern/Western routes vary Z and keep X fixed.
    return {
      active: true,
      day: dayNumber,
      hour,
      route,
      zoneId: route.zoneId,
      routeChunks,
      crossChunks,
      routeStep,
      directionalIndex,
      cx,
      cz,
      slot,
      slotCount,
      coarseKey: `${dayNumber}:${route.zoneId}:${slot}:${cx},${cz}`,
    };
  }

  function playerChunk() {
    if (!deps?.player || !deps?.TILE) return null;
    const tileCol = deps.player.x / deps.TILE; // Converts the player's pixel X into the same tile coordinate basis WildernessChunks uses.
    const tileRow = deps.player.y / deps.TILE; // Converts the player's pixel Y/map-Z into wilderness row coordinates.
    return { cx: Math.floor(tileCol / chunkTiles()), cz: Math.floor(tileRow / chunkTiles()) };
  }

  function sameChunk(a, b) {
    return !!a && !!b && a.cx === b.cx && a.cz === b.cz;
  }

  function routeStepFromChunk(chunk, state) {
    if (!chunk || !state?.route) return state?.routeStep || 0;
    const directionalIndex = state.route.axis === 'x' ? chunk.cx : chunk.cz; // Extracts the moving coordinate from an observed 2D chunk.
    return state.route.direction >= 0 ? directionalIndex : (state.routeChunks - 1 - directionalIndex); // Converts reverse travel back into monotonically increasing route progress.
  }

  function effectiveCoarseChunk(state) {
    if (!state?.active) return null;
    const routeStep = clamp(Math.max(state.routeStep, runtime.observedRouteStep || 0), 0, state.routeChunks - 1); // Never snaps a formation backward after the player watched it advance faster than schedule.
    const directionalIndex = state.route.direction >= 0 ? routeStep : (state.routeChunks - 1 - routeStep); // Re-applies the route's physical orientation after monotonic progress correction.
    return state.route.axis === 'x'
      ? { cx: directionalIndex, cz: state.cz, routeStep }
      : { cx: state.cx, cz: directionalIndex, routeStep };
  }

  function chunkBounds(chunk, dims) {
    const size = chunkTiles(); // Supplies exact 16-tile boundaries while still respecting a smaller partial final chunk.
    return {
      colStart: clamp(chunk.cx * size, 0, dims.cols - 1),
      colEnd: clamp(Math.min(dims.cols, (chunk.cx + 1) * size), 1, dims.cols),
      rowStart: clamp(chunk.cz * size, 0, dims.rows - 1),
      rowEnd: clamp(Math.min(dims.rows, (chunk.cz + 1) * size), 1, dims.rows),
    };
  }

  function formationOffset(index, cfg = config) {
    const columns = Math.max(1, Math.floor(Number(cfg?.formation?.columns) || 4)); // Controls lateral files in the visible formation.
    const rows = Math.max(1, Math.floor(Number(cfg?.formation?.rows) || 5)); // Controls longitudinal ranks in the visible formation.
    const lateralSpacing = Math.max(0.5, Number(cfg?.formation?.lateralSpacingTiles) || 1.35); // Keeps twenty large Harlyao from visually stacking side-by-side.
    const longitudinalSpacing = Math.max(0.5, Number(cfg?.formation?.longitudinalSpacingTiles) || 1.2); // Keeps front/back ranks readable while fitting inside one chunk at materialization.
    const col = index % columns; // Assigns each member to one lateral file.
    const row = Math.floor(index / columns) % rows; // Assigns each member to one longitudinal rank.
    return {
      lateral: (col - (columns - 1) / 2) * lateralSpacing,
      longitudinal: (row - (rows - 1) / 2) * longitudinalSpacing,
    };
  }

  function anchorForChunk(chunk, state, dims) {
    const bounds = chunkBounds(chunk, dims); // Keeps initial formation placement fully inside the current route chunk.
    return {
      col: (bounds.colStart + bounds.colEnd - 1) * 0.5,
      row: (bounds.rowStart + bounds.rowEnd - 1) * 0.5,
    };
  }

  function targetAnchorForChunk(chunk, state, dims) {
    const next = { cx: chunk.cx, cz: chunk.cz }; // Starts from the live chunk and advances exactly one adjacent chunk in the route direction.
    if (state.route.axis === 'x') next.cx += state.route.direction;
    else next.cz += state.route.direction;
    const maxCx = chunkCount(dims.cols) - 1; // Prevents the final east/west target from indexing beyond the zone.
    const maxCz = chunkCount(dims.rows) - 1; // Prevents the final north/south target from indexing beyond the zone.
    if (next.cx >= 0 && next.cx <= maxCx && next.cz >= 0 && next.cz <= maxCz) return anchorForChunk(next, state, dims);

    const pad = Math.max(0, Number(config?.routeLane?.edgePaddingTiles ?? 2)); // Gives the final observed rank a clear march-to-exit target just inside the wilderness edge.
    const current = anchorForChunk(chunk, state, dims); // Supplies the perpendicular coordinate for the final boundary target.
    if (state.route.axis === 'x') current.col = state.route.direction > 0 ? dims.cols - pad - ROUTE_EPSILON_TILES : pad + ROUTE_EPSILON_TILES;
    else current.row = state.route.direction > 0 ? dims.rows - pad - ROUTE_EPSILON_TILES : pad + ROUTE_EPSILON_TILES;
    return current;
  }

  function memberTilePosition(anchor, offset, state, dims) {
    let col = anchor.col; // Receives longitudinal or lateral formation offset depending on route axis.
    let row = anchor.row; // Receives the complementary formation offset while preserving the same 2D formation shape.
    if (state.route.axis === 'x') {
      col += offset.longitudinal * state.route.direction;
      row += offset.lateral;
    } else {
      col += offset.lateral;
      row += offset.longitudinal * state.route.direction;
    }
    const pad = Math.max(0.25, Number(config?.routeLane?.edgePaddingTiles ?? 2) * 0.25); // Avoids placing a large avatar center exactly on the map boundary.
    return { col: clamp(col, pad, dims.cols - 1 - pad), row: clamp(row, pad, dims.rows - 1 - pad) };
  }

  function setEntityVisible(c, visible, zoneId) {
    if (!c) return;
    c.areaId = visible ? zoneId : `${DORMANT_AREA_PREFIX}${zoneId}`; // Existing updateHostiles area guard becomes the offscreen simulation LOD for free.
    if (c.avatarRef?.group) c.avatarRef.group.visible = visible;
    if (c.groundShadow) c.groundShadow.visible = visible;
    if (c._banditToolHolder) c._banditToolHolder.visible = visible;
    if (c._banditRangedToolHolder) c._banditRangedToolHolder.visible = false;
    if (!visible && c._banditTrailMesh) c._banditTrailMesh.visible = false;
  }

  function placeEntity(c, tilePos, zoneId) {
    if (!c || !deps?.TILE) return;
    c.x = tilePos.col * deps.TILE;
    c.y = tilePos.row * deps.TILE;
    c.homeX = c.x;
    c.homeY = c.y;
    c.areaId = zoneId;
    const col = clamp(Math.floor(tilePos.col), 0, c.areaCols - 1); // Samples surface elevation at the same tile used by the entity's collision/navigation state.
    const row = clamp(Math.floor(tilePos.row), 0, c.areaRows - 1); // Samples map-Z/row elevation for visual grounding after a cached formation is reawakened.
    const tile = c.areaGrid?.[row]?.[col]; // Supplies the live wilderness surface record at this member's placement.
    const surfaceY = tile && deps.tileSurfaceYInArea ? deps.tileSurfaceYInArea(tile, zoneId) : 0; // Keeps teleported cached portraits/ground shadows grounded instead of retaining their previous chunk elevation.
    if (c.avatarRef?.group) c.avatarRef.group.position.set(tilePos.col, surfaceY + (c.halfHeight || 0.45), tilePos.row);
    if (c.groundShadow) c.groundShadow.position.set(tilePos.col, surfaceY + (deps.characterGroundShadowSurfaceOffset?.() || 0.01), tilePos.row);
  }

  function neutralizeMember(c) {
    if (!c || c.health <= 0) return;
    c._harlyaoOriginalAggroRangePx ??= Number(c.def?.aggroRangePx) || deps.TILE * 6; // Restored for ordinary bandit combat the instant the formation is provoked.
    if (c.def) c.def.aggroRangePx = 0;
    c.state = config?.behavior?.neutralState || 'harlyaoMarch';
    c.wanderTarget = null;
    c.wanderT = 0;
    c.vx = 0;
    c.vy = 0;
  }

  function provokeArmy(reason = 'hit') {
    if (runtime.provoked) return;
    runtime.provoked = true;
    runtime.lastReason = `provoked:${reason}`;
    for (const c of runtime.members) {
      if (!c || c.health <= 0) continue;
      if (c.def && Number.isFinite(c._harlyaoOriginalAggroRangePx)) c.def.aggroRangePx = c._harlyaoOriginalAggroRangePx;
      c.state = 'chase';
      c.wanderTarget = null;
    }
    window.__farmLog?.('[harlyao-march] Army provoked; all visible Harlyao entered ordinary bandit combat AI.', 'warn', 'wildlife');
  }

  function detectProvocation() {
    if (runtime.provoked) return;
    for (const c of runtime.members) {
      if (!c || c.health <= 0) continue;
      if (c.health < c.maxHealth || Number(c.hitFlashT) > 0) {
        provokeArmy(c.id || 'member-hit');
        return;
      }
    }
  }

  function ghostifyMember(c) {
    const visuals = config?.visuals || {}; // Supplies one coherent blue-green spectral treatment for body, clothing, feet, hands, and weapon.
    const options = { color: visuals.color, opacity: visuals.opacity, emissiveIntensity: visuals.emissiveIntensity }; // Forwarded to the reusable module rather than reimplementing ghost materials here.
    window.Ghostify?.apply?.(c.avatarRef?.group, options);
    window.Ghostify?.apply?.(c._banditToolHolder, options);
    if (c.groundShadow?.material) {
      c.groundShadow.material = c.groundShadow.material.clone?.() || c.groundShadow.material;
      c.groundShadow.material.transparent = true;
      c.groundShadow.material.opacity = Math.min(0.18, Number(c.groundShadow.material.opacity) || 0.18);
    }
  }

  function weaponDefFor(index) {
    const shapes = config?.equipment?.weaponShapes || ['daggerSword', 'hatchet', 'fishingspear']; // Restricts this army to the three user-authored weapon families without modifying ordinary bandit randomization.
    const shapeKey = shapes[index % shapes.length]; // Cycles evenly so a twenty-member army visibly contains all three weapon types every night.
    const shape = deps?.HELD_SHAPE_DEFS?.[shapeKey] || {}; // Supplies the existing weapon animation/damage type for the forced crafted item.
    const metalKey = config?.equipment?.weaponMetalKey || 'nativeCopper'; // Uses a guaranteed existing metal; Ghostify later recolors the complete weapon silhouette anyway.
    const weaponKey = deps?.craftedToolItemKey?.(shapeKey, metalKey) || shapeKey; // Reuses the player's/bandit's existing crafted-tool item-key convention and texture pipeline.
    return { shapeKey, metalKey, weaponKey, attackTag: shape.dmgType || 'sharp' };
  }

  function rosterFor(index) {
    const gender = index % 2 === 0 ? 'male' : 'female'; // Produces an even male/female formation deterministically without paying or persisting an extra random roster state.
    const cosmetics = [...(config?.equipment?.forcedCosmetics || ['rugged_poncho'])]; // Makes every marcher wear the required rugged poncho and nothing randomly rolled on top of it.
    const cosmeticSlots = Object.fromEntries(cosmetics.map(id => [id, 'overwear'])); // Preserves bandit corpse-loot reconstruction metadata for the forced clothing.
    return {
      name: `Harlyao Marcher ${index + 1}`,
      appearance: { speciesId: SPECIES_ID, gender, cosmetics: {} },
      equippedCosmetics: cosmetics,
      appliedDyes: {},
      cosmeticSlots,
    };
  }

  async function waitOneFrame() {
    if (typeof window.requestAnimationFrame !== 'function') return Promise.resolve();
    return new Promise(resolve => window.requestAnimationFrame(() => resolve()));
  }

  async function ensureGangConfig() {
    if (gangConfig) return gangConfig;
    gangConfig = await window.BanditCombat?.loadGangConfig?.(); // Reuses established rank/mastery/health tuning rather than creating a parallel humanoid-combat configuration.
    return gangConfig;
  }

  function spawnConfigFromGang(base) {
    return {
      ...(base || {}),
      speciesWeights: { [SPECIES_ID]: 1 },
      rangedWeaponChanceByRank: { grunt: 0, lieutenant: 0, captain: 0 },
    }; // Keeps all ordinary bandit stat formulas while guaranteeing Harlyao and suppressing crossbows/scatterbows.
  }

  async function buildMember(index, state, spawnChunk, dims, buildGeneration) {
    const baseGang = await ensureGangConfig(); // Supplies the standard grunt balance/ability configuration used by BanditCombat.makeEntity.
    if (!baseGang || buildGeneration !== generation) return null;
    const anchor = anchorForChunk(spawnChunk, state, dims); // Centers the initial formation inside the shared chunk before per-member offsets are applied.
    const tilePos = memberTilePosition(anchor, formationOffset(index), state, dims); // Gives this marcher a unique but compact slot in the 4x5 formation.
    const weapon = weaponDefFor(index); // Selects dagger-sword, hatchet, or fishing spear and an existing crafted-tool key.
    const entity = await window.BanditCombat.makeEntity(
      spawnConfigFromGang(baseGang),
      'grunt',
      0,
      tilePos.col * deps.TILE,
      tilePos.row * deps.TILE,
      {
        zoneId: state.zoneId,
        rosterOverride: rosterFor(index),
        defOverride: {
          label: 'Harlyao Marcher',
          weaponKey: weapon.weaponKey,
          weaponShapeKey: weapon.shapeKey,
          weaponMetalKey: weapon.metalKey,
          attackTag: weapon.attackTag,
          rangedWeaponKey: null,
        },
        extra: {
          isHarlyaoArmyMember: true,
          harlyaoArmyIndex: index,
          harlyaoWeaponShape: weapon.shapeKey,
          _harlyaoNeutral: true,
        },
      },
    );
    if (!entity || buildGeneration !== generation) {
      entity?.avatarRef?.dispose?.();
      return null;
    }
    neutralizeMember(entity);
    ghostifyMember(entity);
    deps.hostileObjects.push(entity);
    return entity;
  }

  async function materializeFormation(state, chunk) {
    if (materializePromise || !deps || !config || deps.getCurrentArea?.() !== state.zoneId) return materializePromise;
    const buildGeneration = ++generation; // Invalidates this build if sunrise/day/zone changes while twenty async portraits are being composed.
    runtime.lastReason = `materializing:${state.zoneId}:${chunk.cx},${chunk.cz}`;
    runtime.materializations++;
    materializePromise = (async () => {
      const dims = zoneDimensions(state.zoneId); // Reused for all twenty spawn slots and later target movement in this materialization.
      if (runtime.members.length && runtime.zoneId === state.zoneId) {
        wakeCachedFormation(state, chunk, dims);
        return runtime.members;
      }
      destroyCachedFormation('zone-rebuild');
      runtime.zoneId = state.zoneId;
      runtime.civilDay = state.day;
      runtime.liveChunk = { cx: chunk.cx, cz: chunk.cz };
      runtime.observedRouteStep = Math.max(runtime.observedRouteStep || 0, chunk.routeStep ?? state.routeStep);

      const count = Math.max(1, Math.floor(Number(config.memberCount) || 20)); // Creates the authored ~20-person army, with failed portrait members simply omitted rather than retry-looped.
      for (let i = 0; i < count; i++) {
        if (buildGeneration !== generation || deps.getCurrentArea?.() !== state.zoneId || !sameChunk(playerChunk(), runtime.liveChunk)) break;
        const member = await buildMember(i, state, chunk, dims, buildGeneration); // Constructs one full bandit-style Harlyao with forced rugged poncho and weapon.
        if (member) runtime.members.push(member);
        if ((i + 1) % MATERIALIZE_YIELD_EVERY === 0) await waitOneFrame();
      }
      if (buildGeneration !== generation) return runtime.members;
      runtime.visible = runtime.members.length > 0;
      runtime.lastReason = runtime.visible ? `visible:${runtime.members.length}` : 'materialize-empty';
      return runtime.members;
    })().finally(() => { materializePromise = null; });
    return materializePromise;
  }

  function wakeCachedFormation(state, chunk, dims = zoneDimensions(state.zoneId)) {
    runtime.liveChunk = { cx: chunk.cx, cz: chunk.cz };
    runtime.observedRouteStep = Math.max(runtime.observedRouteStep || 0, chunk.routeStep ?? state.routeStep);
    const anchor = anchorForChunk(chunk, state, dims); // Repositions cached hidden rigs to the current coarse chunk entirely offscreen before making them visible.
    let liveIndex = 0; // Keeps surviving cached members packed into deterministic formation slots after any earlier deaths.
    for (const c of runtime.members) {
      if (!c || c.health <= 0) continue;
      placeEntity(c, memberTilePosition(anchor, formationOffset(liveIndex++), state, dims), state.zoneId);
      setEntityVisible(c, true, state.zoneId);
      if (runtime.provoked) {
        if (c.def && Number.isFinite(c._harlyaoOriginalAggroRangePx)) c.def.aggroRangePx = c._harlyaoOriginalAggroRangePx;
        c.state = 'chase';
      } else neutralizeMember(c);
    }
    runtime.visible = liveIndex > 0;
    runtime.lastReason = `wake-cached:${chunk.cx},${chunk.cz}`;
  }

  function dematerializeFormation(reason = 'left-shared-chunk') {
    if (!runtime.visible) return;
    for (const c of runtime.members) {
      if (!c || c.health <= 0) continue;
      setEntityVisible(c, false, runtime.zoneId);
      c.vx = 0;
      c.vy = 0;
    }
    runtime.visible = false;
    runtime.dematerializations++;
    runtime.lastReason = reason;
  }

  function disposeHolder(holder) {
    if (!holder) return;
    window.Ghostify?.restore?.(holder);
    holder.traverse?.(object => {
      object.geometry?.dispose?.();
      const materials = Array.isArray(object.material) ? object.material : [object.material]; // Disposes holder-local materials/geometry while intentionally leaving shared tool texture maps alive.
      for (const material of materials) material?.dispose?.();
    });
    holder.parent?.remove?.(holder);
  }

  function destroyCachedFormation(reason = 'reset') {
    generation++;
    const hostiles = deps?.hostileObjects; // Removes cached members from the shared combat/death array before disposing their visual rigs.
    for (const c of runtime.members) {
      if (!c) continue;
      if (Array.isArray(hostiles)) {
        const index = hostiles.indexOf(c); // Used to remove this exact cached entity without touching unrelated wildlife/bandits.
        if (index >= 0) hostiles.splice(index, 1);
      }
      if (c.health > 0) {
        window.Ghostify?.restore?.(c.avatarRef?.group);
        c.avatarRef?.group?.parent?.remove?.(c.avatarRef.group);
        c.groundShadow?.parent?.remove?.(c.groundShadow);
        disposeHolder(c._banditToolHolder);
        disposeHolder(c._banditRangedToolHolder);
        c.avatarRef?.dispose?.();
        c.groundShadow?.geometry?.dispose?.();
        c.groundShadow?.material?.dispose?.();
      }
    }
    runtime.members.length = 0;
    runtime.visible = false;
    runtime.liveChunk = null;
    runtime.lastReason = reason;
  }

  function centroidGlowSource() {
    if (!runtime.visible || !config) return null;
    let sumX = 0; // Accumulates live member world X in tile/Three units for one formation-level light source.
    let sumY = 0; // Accumulates rendered avatar height so the glow projects around their bodies instead of only at their feet.
    let sumZ = 0; // Accumulates live member world Z (entity pixel-y converted to tile units).
    let count = 0; // Divides the accumulated centroid and ignores dead/hidden members.
    for (const c of runtime.members) {
      if (!c || c.health <= 0 || c.areaId !== runtime.zoneId || !c.avatarRef?.group?.visible) continue;
      sumX += c.x / deps.TILE;
      sumY += (c.avatarRef.group.position.y || 0) + 0.35;
      sumZ += c.y / deps.TILE;
      count++;
    }
    if (!count) return null;
    return {
      x: sumX / count,
      y: sumY / count,
      z: sumZ / count,
      radiusTiles: Number(config.visuals?.formationGlowRadiusTiles) || 4.2,
      intensity: Number(config.visuals?.formationGlowIntensity) || 0.78,
      color: config.visuals?.color || '#4fd9c6',
    };
  }

  function tickNeutralMarch(dt, state) {
    const living = runtime.members.filter(c => c && c.health > 0 && c.areaId === state.zoneId); // Restricts manual marching to visible living Harlyao; dormant/dead entries cost no movement work.
    if (!living.length) return;
    const leader = living[0]; // First surviving marcher defines the observed live chunk/progress for the whole formation.
    const leaderChunk = { cx: Math.floor((leader.x / deps.TILE) / chunkTiles()), cz: Math.floor((leader.y / deps.TILE) / chunkTiles()) }; // Converts actual movement back into the wilderness streamer's chunk basis.
    runtime.liveChunk = leaderChunk;
    runtime.observedRouteStep = Math.max(runtime.observedRouteStep || 0, routeStepFromChunk(leaderChunk, state));

    const dims = zoneDimensions(state.zoneId); // Supplies one-chunk-ahead target centers and map-edge clamping for all members this frame.
    const targetAnchor = targetAnchorForChunk(leaderChunk, state, dims); // Makes the formation visibly path toward the NEXT adjacent chunk, independent of the coarse hourly snap schedule.
    const speedPx = Math.max(8, Number(config.formation?.marchSpeedTilesPerSecond) || 1.15) * deps.TILE; // Converts the visual march speed into the same pixels/sec moveCreatureToward expects.
    for (let i = 0; i < living.length; i++) {
      const c = living[i];
      neutralizeMember(c);
      const targetTile = memberTilePosition(targetAnchor, formationOffset(i), state, dims); // Translates the whole 4x5 formation one chunk forward while retaining individual slots.
      const targetX = targetTile.col * deps.TILE; // Supplies this member's collision/path movement target in entity pixel coordinates.
      const targetY = targetTile.row * deps.TILE; // Supplies the map-Z/row movement target in entity pixel coordinates.
      c.homeX = targetX;
      c.homeY = targetY;
      c.facing = Math.atan2(targetY - c.y, targetX - c.x);
      deps.moveCreatureToward?.(c, targetX, targetY, speedPx, dt);
    }
  }

  function resetForDailyRoute(state) {
    if (runtime.civilDay === state.day && runtime.zoneId === state.zoneId) return;
    destroyCachedFormation('daily-route-change');
    runtime.civilDay = state.day;
    runtime.zoneId = state.zoneId;
    runtime.provoked = false;
    runtime.observedRouteStep = 0;
    runtime.lastCoarseKey = null;
  }

  function logCoarseState(state, effectiveChunk) {
    if (!state?.active || state.coarseKey === runtime.lastCoarseKey) return;
    runtime.lastCoarseKey = state.coarseKey;
    window.__farmLog?.(
      `[harlyao-march] day=${state.day} zone=${state.zoneId} ${state.route.directionLabel} hour=${Math.floor(state.hour)} coarse=${effectiveChunk.cx},${effectiveChunk.cz} live=${runtime.visible ? 'yes' : 'no'}`,
      'info',
      'wildlife',
    );
  }

  function update(dt) {
    if (!deps || !config) return;
    const day = civilDayNumber(); // Selects today's single clockwise wilderness zone.
    const state = coarseStateFor(day, gameHour()); // Performs the only required offscreen simulation: one hourly chunk mapping.
    if (!state.active) {
      if (runtime.members.length) destroyCachedFormation('daylight');
      runtime.civilDay = day;
      runtime.zoneId = routeForDay(day)?.zoneId || null;
      runtime.provoked = false;
      runtime.observedRouteStep = 0;
      return;
    }

    resetForDailyRoute(state);
    const coarseChunk = effectiveCoarseChunk(state); // Uses hourly schedule unless an observed live march has already advanced farther.
    logCoarseState(state, coarseChunk);
    const currentArea = deps.getCurrentArea?.(); // Full entity work is impossible outside today's one active wilderness zone.
    if (currentArea !== state.zoneId) {
      dematerializeFormation('different-zone');
      return;
    }

    detectProvocation();
    if (runtime.visible) {
      if (!runtime.provoked) tickNeutralMarch(Math.max(0, Number(dt) || 0), state);
      const armyChunk = runtime.liveChunk || coarseChunk; // Once visible, actual leader movement replaces the rigid hourly chunk for shared-chunk checks.
      if (!sameChunk(playerChunk(), armyChunk)) dematerializeFormation('left-army-chunk');
      return;
    }

    if (sameChunk(playerChunk(), coarseChunk)) {
      if (runtime.members.length) wakeCachedFormation(state, coarseChunk);
      else materializeFormation(state, coarseChunk);
    }
  }

  async function loadConfig() {
    try {
      const response = await fetch(CONFIG_URL); // Loads data asynchronously; until it resolves the controller performs no world/entity work.
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      config = await response.json();
      runtime.lastReason = 'config-ready';
      return config;
    } catch (error) {
      runtime.lastReason = `config-error:${error.message}`;
      window.__farmLog?.(`[harlyao-march] config load failed: ${error.message}`, 'warn', 'wildlife');
      return null;
    }
  }

  function installBanditCombatBridge(api = window.BanditCombat) {
    if (!api || typeof api.init !== 'function') return false;
    if (api.__harlyaoNightMarchInitWrapped) return true;
    const originalInit = api.init.bind(api); // Preserves BanditCombat's existing dependency capture before storing the same object for the march controller.
    api.init = function harlyaoNightMarchBanditInit(injectedDeps) {
      deps = injectedDeps;
      const result = originalInit(injectedDeps);
      return result;
    };
    api.__harlyaoNightMarchInitWrapped = true;
    return true;
  }

  function installBanditCampUpdateBridge(api = window.BanditCamps) {
    if (!api || typeof api.updateCampBanners !== 'function') return false;
    if (api.updateCampBanners.__harlyaoNightMarchWrapped) return true;
    const originalUpdate = api.updateCampBanners.bind(api); // Keeps existing camp banners and WildernessSimulationLOD prepasses chained around the same before-updateHostiles seam.
    const wrapped = function harlyaoNightMarchUpdate(dt) {
      update(dt);
      return originalUpdate(dt);
    };
    wrapped.__harlyaoNightMarchWrapped = true;
    wrapped.__harlyaoNightMarchOriginal = originalUpdate;
    api.updateCampBanners = wrapped;
    return true;
  }

  function watchNamespace(name, installer) {
    if (installer(window[name])) return;
    const descriptor = Object.getOwnPropertyDescriptor(window, name); // Avoids trampling a non-configurable namespace installed by a host/test harness.
    if (descriptor && !descriptor.configurable) return;
    let assigned = descriptor?.value; // Temporarily holds the eventual combat/camp namespace during parser-time module assignment.
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
    const state = config ? coarseStateFor(civilDayNumber(), gameHour()) : null; // Reports scheduled state even when no expensive formation exists.
    const effective = state?.active ? effectiveCoarseChunk(state) : null; // Shows the monotonic chunk used for future materialization after observed drift.
    return {
      configReady: !!config,
      depsReady: !!deps,
      civilDay: runtime.civilDay,
      zoneId: runtime.zoneId,
      scheduled: state?.active ? { zoneId: state.zoneId, direction: state.route.directionLabel, slot: state.slot, chunk: { cx: state.cx, cz: state.cz }, effectiveChunk: effective } : null,
      playerChunk: playerChunk(),
      liveChunk: runtime.liveChunk ? { ...runtime.liveChunk } : null,
      membersCached: runtime.members.length,
      membersAlive: runtime.members.filter(c => c && c.health > 0).length,
      visible: runtime.visible,
      provoked: runtime.provoked,
      observedRouteStep: runtime.observedRouteStep,
      materializations: runtime.materializations,
      dematerializations: runtime.dematerializations,
      lastReason: runtime.lastReason,
    };
  }

  window.HarlyaoNightMarch = Object.freeze({
    update,
    loadConfig,
    debugSnapshot,
    formatDebug: () => {
      const d = debugSnapshot();
      const scheduled = d.scheduled ? `${d.scheduled.zoneId}/${d.scheduled.direction}@${d.scheduled.effectiveChunk.cx},${d.scheduled.effectiveChunk.cz}` : 'inactive';
      return `Harlyao march: cfg=${d.configReady} deps=${d.depsReady} scheduled=${scheduled} player=${d.playerChunk ? `${d.playerChunk.cx},${d.playerChunk.cz}` : 'none'} live=${d.liveChunk ? `${d.liveChunk.cx},${d.liveChunk.cz}` : 'none'} members=${d.membersAlive}/${d.membersCached} visible=${d.visible} provoked=${d.provoked} reason=${d.lastReason}`;
    },
    provoke: () => provokeArmy('debug'),
    __test: Object.freeze({ routeForDay, coarseStateFor, chunkCount, formationOffset, effectiveCoarseChunk }),
  });

  watchNamespace('BanditCombat', installBanditCombatBridge);
  watchNamespace('BanditCamps', installBanditCampUpdateBridge);
  loadConfig();
  unregisterGlow?.();
  unregisterGlow = window.Ghostify?.registerGlowSource?.(centroidGlowSource) || null;
})();
