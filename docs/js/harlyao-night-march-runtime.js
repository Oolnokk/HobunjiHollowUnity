(() => {
  'use strict';

  // Harlyao Night March — only the army's coarse chunk exists offscreen.
  // Real humanoid entities are built/woken only while the player shares that
  // chunk. While visible, actual motion may advance ahead of the hourly clock.
  const CONFIG_URL = 'config/harlyao-night-march.json'; // Route/equipment/visual tuning source.
  const SPECIES_ID = 'harlyao'; // Forced species for every generated marcher.
  const DORMANT_AREA_PREFIX = '__harlyao_march_dormant__:'; // Makes updateHostiles skip cached hidden marchers.
  const FALLBACK_CHUNK_TILES = 16; // Matches WildernessChunks' canonical tile chunk size.
  const MATERIALIZE_BATCH = 2; // Portraits yielded after this many builds to reduce one-frame hitching.
  const MIN_MARCH_SPEED_TILES_S = 0.1; // Guards malformed zero/negative visual speed.

  let deps = null; // Captured from BanditCombat.init; used by movement, terrain, tools, scenes, and hostileObjects.
  let cfg = null; // Parsed harlyao-night-march.json used by all route/formation logic.
  let gangCfg = null; // Existing bandit balance config reused for combat stats/abilities.
  let buildPromise = null; // Prevents duplicate 20-member materialization jobs and partial-formation wake races.
  let buildGeneration = 0; // Invalidates an async build when the night/day route is torn down.
  let scheduleKey = null; // Whole-day/hour key; offscreen chunk is recomputed only when this changes.
  let scheduled = null; // Cached hourly route/chunk result used between schedule changes.
  let unregisterGlow = null; // Owns the one formation-level Ghostify glow source.

  const state = {
    day: null, // Civil day currently represented by this controller.
    zoneId: null, // One wilderness zone selected for this civil day.
    members: [], // Cached live humanoid entities created only after first observation.
    visible: false, // True only while player and army share the army's live chunk.
    provoked: false, // Whole formation becomes hostile after any member is hit.
    liveChunk: null, // Leader's actual observed chunk while visible; stable build target while materializing.
    observedStep: 0, // Furthest route step physically observed; prevents later schedule snap-back.
    lastLogKey: null, // Throttles mobile log to hourly route changes.
    reason: 'boot', // Last lifecycle transition for mobile debug reports.
    builds: 0, // Count of materialization jobs started.
    wakes: 0, // Count of complete cached formation wake-ups.
    sleeps: 0, // Count of visible-to-dormant chunk exits.
    updateTicks: 0, // Proves the BanditCamps game-loop seam is still calling this controller.
    lastUpdateAt: 0, // Last performance timestamp observed by update(), used by mobile diagnostics.
  };

  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
  const chunkTiles = () => Number(window.WildernessChunks?.constants?.CHUNK_TILES) || FALLBACK_CHUNK_TILES;
  const chunkCount = tiles => Math.max(1, Math.ceil(Math.max(1, Number(tiles) || 1) / chunkTiles()));
  const sameChunk = (a, b) => !!a && !!b && a.cx === b.cx && a.cz === b.cz;
  const expectedMemberCount = () => Math.max(1, Math.floor(Number(cfg?.memberCount) || 20));

  function civilDay() {
    const rawDay = Number(window.CalendarSystem?.timeDebugSnapshot?.()?.rawDay); // Absolute day survives the civil-midnight bridge.
    if (Number.isFinite(rawDay)) return Math.max(1, Math.floor(rawDay));
    const fallback = Number(deps?.calendar?.day ?? window.calendar?.day ?? 1); // Startup/test fallback.
    return Math.max(1, Math.floor(Number.isFinite(fallback) ? fallback : 1));
  }

  function gameHour() {
    const raw = Number(window.CalendarSystem?.getHour?.()); // Same game clock used by weather/NPC scheduling.
    return Number.isFinite(raw) ? ((raw % 24) + 24) % 24 : 12;
  }

  function routeForDay(day, config = cfg) {
    const routes = config?.routesClockwise || []; // Config order is north → east → south → west.
    if (!routes.length) return null;
    return routes[(Math.max(1, Math.floor(Number(day) || 1)) - 1) % routes.length] || null;
  }

  function zoneDims(zoneId) {
    const def = deps?.EXTERIOR_ZONES?.[zoneId] || window.EXTERIOR_ZONES?.[zoneId] || null; // Live dimensions preferred over today's 200×200 fallback.
    return { cols: Math.max(1, Number(def?.cols) || 200), rows: Math.max(1, Number(def?.rows) || 200) };
  }

  function coarseStateFor(day, hour, config = cfg, dimsOverride = null) {
    const route = routeForDay(day, config); // Selects exactly one daily wilderness zone.
    const start = Number(config?.activeHours?.start ?? 0); // Inclusive 00:00 boundary.
    const end = Number(config?.activeHours?.end ?? 6); // Exclusive 06:00 boundary.
    const stepHours = Math.max(0.25, Number(config?.activeHours?.coarseStepHours ?? 1)); // One hour in authored config.
    if (!route || !Number.isFinite(Number(hour)) || hour < start || hour >= end) {
      return { active: false, day, hour, route, zoneId: route?.zoneId || null };
    }

    const dims = dimsOverride || zoneDims(route.zoneId); // Route-axis and cross-axis extents.
    const routeTiles = route.axis === 'z' ? dims.rows : dims.cols; // N/S uses rows; E/W uses columns.
    const crossTiles = route.axis === 'z' ? dims.cols : dims.rows; // Perpendicular lane dimension.
    const routeChunks = chunkCount(routeTiles); // Current 200-tile axes produce 13 chunks.
    const crossChunks = chunkCount(crossTiles); // Used for one stable center-ish lane.
    const slots = Math.max(1, Math.ceil((end - start) / stepHours)); // 6 states: 00,01,02,03,04,05.
    const slot = clamp(Math.floor((hour - start) / stepHours), 0, slots - 1); // Changes only on whole-hour step.
    const progressStep = slots <= 1 ? 0 : Math.round((slot / (slots - 1)) * (routeChunks - 1)); // Maps 6 hours across every route-axis chunk endpoint-to-endpoint.
    const routeIndex = route.direction >= 0 ? progressStep : routeChunks - 1 - progressStep; // Reverses south/west routes.
    const crossFraction = clamp(Number(config?.routeLane?.crossAxisFraction ?? 0.5), 0, 1); // Fixed perpendicular lane.
    const crossIndex = clamp(Math.round(crossFraction * (crossChunks - 1)), 0, crossChunks - 1); // Lane fraction → chunk.
    return {
      active: true,
      day,
      hour,
      route,
      zoneId: route.zoneId,
      routeChunks,
      crossChunks,
      routeStep: progressStep,
      cx: route.axis === 'x' ? routeIndex : crossIndex,
      cz: route.axis === 'z' ? routeIndex : crossIndex,
      slot,
      slots,
      coarseKey: `${day}:${route.zoneId}:${slot}:${routeIndex}:${crossIndex}`,
    };
  }

  function hourlyState() {
    const day = civilDay(); // Part of cache key so a new civil day can rotate zone at midnight.
    const hour = Math.floor(gameHour()); // Hidden schedule intentionally ignores minute/second progression.
    const key = `${day}:${hour}`; // Sole key permitted to trigger offscreen chunk calculation.
    if (key !== scheduleKey) {
      scheduleKey = key;
      scheduled = coarseStateFor(day, hour);
    }
    return scheduled;
  }

  function effectiveChunk(s) {
    if (!s?.active) return null;
    const step = clamp(Math.max(s.routeStep, state.observedStep || 0), 0, s.routeChunks - 1); // Never moves an observed army backward when hidden again.
    const routeIndex = s.route.direction >= 0 ? step : s.routeChunks - 1 - step; // Progress → physical route coordinate.
    return s.route.axis === 'x' ? { cx: routeIndex, cz: s.cz, routeStep: step } : { cx: s.cx, cz: routeIndex, routeStep: step };
  }

  function playerChunk() {
    if (!deps?.player || !deps?.TILE) return null;
    return {
      cx: Math.floor((deps.player.x / deps.TILE) / chunkTiles()),
      cz: Math.floor((deps.player.y / deps.TILE) / chunkTiles()),
    }; // Player pixels → WildernessChunks 16×16 coordinate.
  }

  function routeStepFromChunk(chunk, s) {
    const physical = s.route.axis === 'x' ? chunk.cx : chunk.cz; // Coordinate that advances along this route.
    return s.route.direction >= 0 ? physical : s.routeChunks - 1 - physical;
  }

  function chunkCenter(chunk, dims) {
    const size = chunkTiles(); // Canonical wilderness chunk tile span.
    const col0 = clamp(chunk.cx * size, 0, dims.cols - 1); // West edge tile.
    const row0 = clamp(chunk.cz * size, 0, dims.rows - 1); // North edge tile.
    const col1 = Math.min(dims.cols, (chunk.cx + 1) * size); // Exclusive east edge.
    const row1 = Math.min(dims.rows, (chunk.cz + 1) * size); // Exclusive south edge.
    return { col: (col0 + col1 - 1) * 0.5, row: (row0 + row1 - 1) * 0.5 };
  }

  function nextChunkCenter(chunk, s, dims) {
    const next = { cx: chunk.cx, cz: chunk.cz }; // One adjacent chunk in current route direction.
    if (s.route.axis === 'x') next.cx += s.route.direction;
    else next.cz += s.route.direction;
    const maxCx = chunkCount(dims.cols) - 1; // Last valid X chunk.
    const maxCz = chunkCount(dims.rows) - 1; // Last valid Z chunk.
    if (next.cx >= 0 && next.cx <= maxCx && next.cz >= 0 && next.cz <= maxCz) return chunkCenter(next, dims);

    const pad = Math.max(0.5, Number(cfg?.routeLane?.edgePaddingTiles ?? 2)); // Final visible target just inside route exit edge.
    const target = chunkCenter(chunk, dims); // Keeps cross-axis coordinate on the same lane.
    if (s.route.axis === 'x') target.col = s.route.direction > 0 ? dims.cols - pad : pad;
    else target.row = s.route.direction > 0 ? dims.rows - pad : pad;
    return target;
  }

  function formationOffset(index, config = cfg) {
    const columns = Math.max(1, Math.floor(Number(config?.formation?.columns) || 4)); // Lateral files.
    const rows = Math.max(1, Math.floor(Number(config?.formation?.rows) || 5)); // Longitudinal ranks.
    const lateral = Math.max(0.5, Number(config?.formation?.lateralSpacingTiles) || 1.35); // File spacing.
    const longitudinal = Math.max(0.5, Number(config?.formation?.longitudinalSpacingTiles) || 1.2); // Rank spacing.
    const col = index % columns; // This member's file index.
    const row = Math.floor(index / columns) % rows; // This member's rank index.
    return { lateral: (col - (columns - 1) / 2) * lateral, longitudinal: (row - (rows - 1) / 2) * longitudinal };
  }

  function memberTile(anchor, offset, s, dims) {
    let col = anchor.col; // Formation-relative world tile X.
    let row = anchor.row; // Formation-relative world tile row/Z.
    if (s.route.axis === 'x') {
      col += offset.longitudinal * s.route.direction;
      row += offset.lateral;
    } else {
      col += offset.lateral;
      row += offset.longitudinal * s.route.direction;
    }
    return { col: clamp(col, 0.5, dims.cols - 1.5), row: clamp(row, 0.5, dims.rows - 1.5) };
  }

  function roster(index) {
    const gender = 'male'; // Army remains male-only until matching female Harlyao head art exists.
    const cosmetics = [...(cfg?.equipment?.forcedCosmetics || ['rugged_poncho'])]; // Every marcher wears the rugged poncho.
    return {
      name: `Harlyao Marcher ${index + 1}`,
      appearance: { speciesId: SPECIES_ID, gender, cosmetics: {} },
      equippedCosmetics: cosmetics,
      appliedDyes: {},
      cosmeticSlots: Object.fromEntries(cosmetics.map(id => [id, 'overwear'])),
    };
  }

  function weapon(index) {
    const shapes = cfg?.equipment?.weaponShapes || ['daggerSword', 'hatchet', 'fishingspear']; // User-required weapon pool.
    const shapeKey = shapes[index % shapes.length]; // Even deterministic distribution.
    const shape = deps?.HELD_SHAPE_DEFS?.[shapeKey] || {}; // Existing damage/animation metadata.
    const metalKey = cfg?.equipment?.weaponMetalKey || 'nativeCopper'; // Existing crafted material key.
    return {
      shapeKey,
      metalKey,
      weaponKey: deps?.craftedToolItemKey?.(shapeKey, metalKey) || shapeKey,
      attackTag: shape.dmgType || 'sharp',
    };
  }

  function neutral(c) {
    if (!c || c.health <= 0) return;
    c._harlyaoAggroRangePx ??= Number(c.def?.aggroRangePx) || deps.TILE * 6; // Restored when provoked.
    if (c.def) c.def.aggroRangePx = 0;
    c.state = cfg?.behavior?.neutralState || 'harlyaoMarch';
    c.wanderTarget = null;
    c.wanderT = 0;
    c.vx = 0;
    c.vy = 0;
  }

  function ghostify(c) {
    const visual = cfg?.visuals || {}; // Shared blue-green translucent/emissive visual settings.
    const options = { color: visual.color, opacity: visual.opacity, emissiveIntensity: visual.emissiveIntensity }; // Ghostify input for body and weapon.
    window.Ghostify?.apply?.(c.avatarRef?.group, options);
    window.Ghostify?.apply?.(c._banditToolHolder, options);
    if (c.groundShadow?.material) {
      c.groundShadow.material = c.groundShadow.material.clone?.() || c.groundShadow.material;
      c.groundShadow.material.transparent = true;
      c.groundShadow.material.opacity = Math.min(0.16, Number(c.groundShadow.material.opacity) || 0.16);
    }
  }

  function hide(c) {
    if (!c) return;
    c.areaId = `${DORMANT_AREA_PREFIX}${state.zoneId}`; // Existing hostile area guard removes all offscreen AI/update cost.
    if (c.avatarRef?.group) c.avatarRef.group.visible = false;
    if (c.groundShadow) c.groundShadow.visible = false;
    if (c._banditToolHolder) c._banditToolHolder.visible = false;
    if (c._banditRangedToolHolder) c._banditRangedToolHolder.visible = false;
    c.vx = 0;
    c.vy = 0;
  }

  function refreshMemberArea(c, zoneId) {
    if (!c || deps?.getCurrentArea?.() !== zoneId) return;
    const liveGrid = deps.getActiveGrid?.(); // Current live grid is authoritative after wilderness rebuilds/re-entry.
    const liveCols = Number(deps.getActiveCols?.()); // Current column count is used by place() clamping.
    const liveRows = Number(deps.getActiveRows?.()); // Current row count is used by place() clamping.
    if (liveGrid) c.areaGrid = liveGrid;
    if (Number.isFinite(liveCols) && liveCols > 0) c.areaCols = liveCols;
    if (Number.isFinite(liveRows) && liveRows > 0) c.areaRows = liveRows;
  }

  function place(c, tile, zoneId) {
    refreshMemberArea(c, zoneId);
    c.x = tile.col * deps.TILE;
    c.y = tile.row * deps.TILE;
    c.homeX = c.x;
    c.homeY = c.y;
    c.areaId = zoneId;
    const col = clamp(Math.floor(tile.col), 0, Math.max(0, c.areaCols - 1)); // Terrain sample column.
    const row = clamp(Math.floor(tile.row), 0, Math.max(0, c.areaRows - 1)); // Terrain sample row.
    const terrain = c.areaGrid?.[row]?.[col]; // Tile below this cached avatar.
    const sampled = terrain && deps.tileSurfaceYInArea ? Number(deps.tileSurfaceYInArea(terrain, zoneId)) : 0; // Current terrain elevation.
    const surface = Number.isFinite(sampled) ? sampled : 0;
    if (c.avatarRef?.group) {
      c.avatarRef.group.position.set(tile.col, surface + (c.halfHeight || 0.45), tile.row);
      c.avatarRef.group.visible = true;
    }
    if (c.groundShadow) {
      c.groundShadow.position.set(tile.col, surface + (deps.characterGroundShadowSurfaceOffset?.() || 0.01), tile.row);
      c.groundShadow.visible = true;
    }
    if (c._banditToolHolder) c._banditToolHolder.visible = true;
    c._harlyaoPlacement = { col: tile.col, row: tile.row, surfaceY: surface, sampleCol: col, sampleRow: row }; // Mobile diagnostics verify rendered feet against sampled terrain.
  }

  async function loadGangConfig() {
    if (!gangCfg) gangCfg = await window.BanditCombat?.loadGangConfig?.(); // Existing humanoid combat balance source.
    return gangCfg;
  }

  function armyBanditConfig(base) {
    return { ...(base || {}), speciesWeights: { [SPECIES_ID]: 1 }, rangedWeaponChanceByRank: { grunt: 0, lieutenant: 0, captain: 0 } }; // Harlyao-only melee grunts.
  }

  const yieldFrame = () => typeof window.requestAnimationFrame === 'function'
    ? new Promise(resolve => window.requestAnimationFrame(resolve))
    : Promise.resolve();

  async function buildMember(index, s, chunk, dims, generation) {
    const base = await loadGangConfig(); // Existing stats/ability table.
    if (!base || generation !== buildGeneration) return null;
    const w = weapon(index); // Forced dagger-sword/hatchet/fishing-spear definition.
    const tile = memberTile(chunkCenter(chunk, dims), formationOffset(index), s, dims); // Initial formation slot inside shared chunk.
    const c = await window.BanditCombat.makeEntity(armyBanditConfig(base), 'grunt', 0, tile.col * deps.TILE, tile.row * deps.TILE, {
      zoneId: s.zoneId,
      rosterOverride: roster(index),
      defOverride: {
        label: 'Harlyao Marcher',
        weaponKey: w.weaponKey,
        weaponShapeKey: w.shapeKey,
        weaponMetalKey: w.metalKey,
        attackTag: w.attackTag,
        rangedWeaponKey: null,
      },
      extra: { isHarlyaoArmyMember: true, harlyaoArmyIndex: index, harlyaoWeaponShape: w.shapeKey },
    });
    if (!c || generation !== buildGeneration) {
      c?.avatarRef?.dispose?.();
      return null;
    }
    neutral(c);
    ghostify(c);
    hide(c); // A partially built army must never wake/march before all async portrait builds finish.
    deps.hostileObjects.push(c);
    return c;
  }

  function teardown(reason) {
    buildGeneration++;
    for (const c of state.members) {
      if (!c) continue;
      const index = deps?.hostileObjects?.indexOf?.(c); // Removes only this army member from shared hostile storage.
      if (index >= 0) deps.hostileObjects.splice(index, 1);
      if (c.health > 0) {
        window.Ghostify?.restore?.(c.avatarRef?.group);
        window.Ghostify?.restore?.(c._banditToolHolder);
        c.avatarRef?.group?.parent?.remove?.(c.avatarRef.group);
        c.groundShadow?.parent?.remove?.(c.groundShadow);
        c._banditToolHolder?.parent?.remove?.(c._banditToolHolder);
        c._banditRangedToolHolder?.parent?.remove?.(c._banditRangedToolHolder);
        c.avatarRef?.dispose?.();
        c.groundShadow?.geometry?.dispose?.();
        c.groundShadow?.material?.dispose?.();
      }
    }
    state.members.length = 0;
    state.visible = false;
    state.liveChunk = null;
    state.reason = reason;
  }

  function wake(s, chunk) {
    const dims = zoneDims(s.zoneId); // Shared dimensions for cached placement.
    const center = chunkCenter(chunk, dims); // Cached formation center in hourly chunk.
    state.liveChunk = { cx: chunk.cx, cz: chunk.cz };
    state.observedStep = Math.max(state.observedStep, chunk.routeStep ?? s.routeStep);
    let slot = 0; // Compacts surviving members into formation after any deaths.
    for (const c of state.members) {
      if (!c || c.health <= 0) continue;
      place(c, memberTile(center, formationOffset(slot++), s, dims), s.zoneId);
      if (state.provoked) {
        if (c.def && Number.isFinite(c._harlyaoAggroRangePx)) c.def.aggroRangePx = c._harlyaoAggroRangePx;
        c.state = 'chase';
      } else neutral(c);
    }
    state.visible = slot > 0;
    state.wakes++;
    state.reason = `wake:${chunk.cx},${chunk.cz}`;
  }

  async function materialize(s, chunk) {
    if (buildPromise || deps.getCurrentArea?.() !== s.zoneId) return buildPromise;
    const generation = ++buildGeneration; // Assigned only after any prior nightly teardown, so it cannot invalidate itself.
    const targetChunk = { cx: chunk.cx, cz: chunk.cz, routeStep: chunk.routeStep ?? s.routeStep }; // Immutable build anchor prevents a partially visible leader from moving the abort gate.
    state.day = s.day;
    state.zoneId = s.zoneId;
    state.liveChunk = { cx: targetChunk.cx, cz: targetChunk.cz };
    state.observedStep = Math.max(state.observedStep, targetChunk.routeStep);
    state.builds++;
    state.reason = `building:${state.members.length}/${expectedMemberCount()}@${targetChunk.cx},${targetChunk.cz}`;

    buildPromise = (async () => {
      const dims = zoneDims(s.zoneId); // Shared dimensions for all 20 slots.
      const count = expectedMemberCount(); // Authored army size.
      for (let i = state.members.length; i < count; i++) {
        if (generation !== buildGeneration || deps.getCurrentArea?.() !== s.zoneId || !sameChunk(playerChunk(), targetChunk)) break;
        const c = await buildMember(i, s, targetChunk, dims, generation); // One fully rigged but still dormant bandit-style Harlyao.
        if (c) state.members.push(c);
        state.reason = `building:${state.members.length}/${count}@${targetChunk.cx},${targetChunk.cz}`;
        if ((i + 1) % MATERIALIZE_BATCH === 0) await yieldFrame();
      }
      if (generation !== buildGeneration) return state.members;
      const stillHere = deps.getCurrentArea?.() === s.zoneId && sameChunk(playerChunk(), targetChunk);
      if (state.members.length >= count && stillHere) {
        wake(s, targetChunk); // First visibility uses the exact same terrain-aware placement path as every later wake.
        state.reason = `visible:${state.members.length}`;
      } else {
        state.visible = false;
        state.liveChunk = { cx: targetChunk.cx, cz: targetChunk.cz };
        state.reason = `build-paused:${state.members.length}/${count}@${targetChunk.cx},${targetChunk.cz}`;
      }
      return state.members;
    })().finally(() => { buildPromise = null; });
    return buildPromise;
  }

  function sleep(reason) {
    if (!state.visible) return;
    for (const c of state.members) if (c?.health > 0) hide(c);
    state.visible = false;
    state.sleeps++;
    state.reason = reason;
  }

  function provoke(reason) {
    if (state.provoked) return;
    state.provoked = true;
    state.reason = `provoked:${reason}`;
    for (const c of state.members) {
      if (!c || c.health <= 0) continue;
      if (c.def && Number.isFinite(c._harlyaoAggroRangePx)) c.def.aggroRangePx = c._harlyaoAggroRangePx;
      c.state = 'chase';
    }
    window.__farmLog?.('[harlyao-march] Army provoked; all surviving marchers are hostile.', 'warn', 'wildlife');
  }

  function detectHit() {
    if (state.provoked) return;
    for (const c of state.members) {
      if (c && (Number(c.health) < Number(c.maxHealth) || Number(c.hitFlashT) > 0)) return provoke(c.id || 'member-hit');
    }
  }

  function marchVisible(dt, s) {
    const living = state.members.filter(c => c && c.health > 0 && c.areaId === s.zoneId); // Only visible live members receive path/movement work.
    if (!living.length) return;
    const leader = living[0]; // Leader defines actual chunk/progress while observed.
    const leaderChunk = {
      cx: Math.floor((leader.x / deps.TILE) / chunkTiles()),
      cz: Math.floor((leader.y / deps.TILE) / chunkTiles()),
    }; // Physical leader chunk from movement, not the hourly schedule.
    state.liveChunk = leaderChunk;
    state.observedStep = Math.max(state.observedStep, routeStepFromChunk(leaderChunk, s));

    const dims = zoneDims(s.zoneId); // Needed for next-chunk target and clamping.
    const next = nextChunkCenter(leaderChunk, s, dims); // Visible formation paths toward adjacent route chunk.
    const speedTiles = Math.max(MIN_MARCH_SPEED_TILES_S, Number(cfg?.formation?.marchSpeedTilesPerSecond) || 1.15); // Authored visual speed.
    const speedPx = speedTiles * deps.TILE; // moveCreatureToward uses pixels/sec.
    for (let i = 0; i < living.length; i++) {
      const c = living[i];
      neutral(c);
      const target = memberTile(next, formationOffset(i), s, dims); // Preserves 4×5 slot during translation.
      const tx = target.col * deps.TILE; // Pixel-space movement target X.
      const ty = target.row * deps.TILE; // Pixel-space movement target row/Z.
      c.homeX = tx;
      c.homeY = ty;
      c.facing = Math.atan2(ty - c.y, tx - c.x);
      deps.moveCreatureToward?.(c, tx, ty, speedPx, Math.max(0, Number(dt) || 0));
    }
  }

  function liveAnchor() {
    if (!state.visible || !deps?.TILE) return null;
    let x = 0; // Sum of visible member world X in tile units.
    let z = 0; // Sum of visible member world Z in tile units.
    let surfaceY = 0; // Sum of visible members' rendered feet heights.
    let n = 0; // Visible member count for centroid.
    for (const c of state.members) {
      if (!c || c.health <= 0 || c.areaId !== state.zoneId || !c.avatarRef?.group?.visible) continue;
      x += c.x / deps.TILE;
      z += c.y / deps.TILE;
      surfaceY += (Number(c.avatarRef.group.position.y) || 0) - (Number(c.halfHeight) || 0);
      n++;
    }
    if (!n) return null;
    const cx = x / n;
    const cz = z / n;
    return { x: cx, z: cz, col: Math.floor(cx), row: Math.floor(cz), surfaceY: surfaceY / n, members: n };
  }

  function placementDebug() {
    const c = state.members.find(member => member && member.health > 0 && member.areaId === state.zoneId && member.avatarRef?.group?.visible);
    if (!c?.avatarRef?.group || !deps?.TILE) return null;
    const feetY = Number(c.avatarRef.group.position.y) - (Number(c.halfHeight) || 0); // Rendered feet should equal sampled surface exactly.
    const surfaceY = Number(c._harlyaoPlacement?.surfaceY);
    return {
      member: c.harlyaoArmyIndex ?? 0,
      simX: c.x / deps.TILE,
      simZ: c.y / deps.TILE,
      renderX: Number(c.avatarRef.group.position.x),
      renderZ: Number(c.avatarRef.group.position.z),
      feetY,
      surfaceY: Number.isFinite(surfaceY) ? surfaceY : null,
      groundErrorY: Number.isFinite(surfaceY) ? feetY - surfaceY : null,
    };
  }

  function glowSource() {
    if (!state.visible || !deps?.TILE || !cfg) return null;
    let x = 0; // Sum of visible member world X/tile units.
    let y = 0; // Sum of visible member rendered height.
    let z = 0; // Sum of visible member world Z/tile units.
    let n = 0; // Visible member count used for centroid.
    for (const c of state.members) {
      if (!c || c.health <= 0 || c.areaId !== state.zoneId || !c.avatarRef?.group?.visible) continue;
      x += c.x / deps.TILE;
      y += (c.avatarRef.group.position.y || 0) + 0.35;
      z += c.y / deps.TILE;
      n++;
    }
    if (!n) return null;
    return {
      x: x / n,
      y: y / n,
      z: z / n,
      radiusTiles: Number(cfg.visuals?.formationGlowRadiusTiles) || 4.2,
      intensity: Number(cfg.visuals?.formationGlowIntensity) || 0.78,
      color: cfg.visuals?.color || '#4fd9c6',
    };
  }

  function resetForRoute(s) {
    if (state.day === s.day && state.zoneId === s.zoneId) return;
    if (state.members.length) teardown('new-daily-route');
    state.day = s.day;
    state.zoneId = s.zoneId;
    state.provoked = false;
    state.observedStep = 0;
    state.lastLogKey = null;
  }

  function logHourly(s, chunk) {
    if (s.coarseKey === state.lastLogKey) return;
    state.lastLogKey = s.coarseKey;
    window.__farmLog?.(`[harlyao-march] ${s.zoneId} ${s.route.directionLabel} hour=${s.hour} chunk=${chunk.cx},${chunk.cz} live=${state.visible}`, 'info', 'wildlife');
  }

  function update(dt) {
    state.updateTicks++;
    state.lastUpdateAt = Number(globalThis.performance?.now?.()) || Date.now(); // Mobile diagnostics distinguish a spawn bug from a dead update seam.
    if (!deps || !cfg) return;
    const s = hourlyState(); // Hidden route calculation changes only on day/whole-hour cache key.
    if (!s?.active) {
      if (state.members.length) teardown('daylight');
      state.day = civilDay();
      state.zoneId = routeForDay(state.day)?.zoneId || null;
      state.provoked = false;
      state.observedStep = 0;
      return;
    }

    resetForRoute(s);
    const chunk = effectiveChunk(s); // Hourly coarse chunk, never behind an already-observed live step.
    logHourly(s, chunk);
    if (deps.getCurrentArea?.() !== s.zoneId) return sleep('different-zone');

    if (state.visible) {
      detectHit();
      if (!state.provoked) marchVisible(dt, s);
      if (!sameChunk(playerChunk(), state.liveChunk || chunk)) sleep('left-army-chunk');
      return;
    }

    // Performance-critical offscreen path: after the cached hourly chunk lookup,
    // only this chunk equality runs. No 20-member loops, pathfinding, animation,
    // combat AI, material work, or formation-light work occurs while hidden.
    if (!sameChunk(playerChunk(), chunk)) return;
    if (buildPromise) return; // Critical: never wake a partially built async formation on the next frame.
    if (state.members.length >= expectedMemberCount()) wake(s, chunk);
    else materialize(s, chunk);
  }

  async function loadConfig() {
    try {
      const response = await fetch(CONFIG_URL); // One-time route/equipment configuration load.
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      cfg = await response.json();
      scheduleKey = null;
      scheduled = null;
      state.reason = 'config-ready';
      return cfg;
    } catch (error) {
      state.reason = `config-error:${error.message}`;
      window.__farmLog?.(`[harlyao-march] config load failed: ${error.message}`, 'warn', 'wildlife');
      return null;
    }
  }

  function installBanditCombat(api = window.BanditCombat) {
    if (!api || typeof api.init !== 'function') return false;
    if (api.__harlyaoMarchInitWrapped) return true;
    const original = api.init.bind(api); // Preserves BanditCombat init while sharing its exact deps object.
    api.init = function harlyaoMarchBanditInit(injected) {
      deps = injected;
      return original(injected);
    };
    api.__harlyaoMarchInitWrapped = true;
    return true;
  }

  function installCampTick(api = window.BanditCamps) {
    if (!api || typeof api.updateCampBanners !== 'function') return false;
    if (api.updateCampBanners.__harlyaoMarchWrapped) return true;
    const original = api.updateCampBanners.bind(api); // Existing cheap pre-updateHostiles seam used by wilderness bandit LOD too.
    const wrapped = function harlyaoMarchTick(dt) {
      update(dt);
      return original(dt);
    };
    wrapped.__harlyaoMarchWrapped = true;
    api.updateCampBanners = wrapped;
    return true;
  }

  function watchNamespace(name, installer) {
    if (installer(window[name])) return;
    const descriptor = Object.getOwnPropertyDescriptor(window, name); // Leaves non-configurable host/test globals alone.
    if (descriptor && !descriptor.configurable) return;
    let assigned = descriptor?.value; // Holds future parser-time namespace assignment until installer can wrap it.
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
    const s = cfg ? hourlyState() : null; // Same cached hourly schedule used by runtime.
    const chunk = s?.active ? effectiveChunk(s) : null; // Scheduled/effective chunk for mobile verification.
    return {
      configReady: !!cfg,
      depsReady: !!deps,
      day: state.day,
      zoneId: state.zoneId,
      scheduled: s?.active ? { zoneId: s.zoneId, direction: s.route.directionLabel, hour: s.hour, chunk } : null,
      playerChunk: playerChunk(),
      liveChunk: state.liveChunk ? { ...state.liveChunk } : null,
      liveAnchor: liveAnchor(),
      placement: placementDebug(),
      expectedMembers: expectedMemberCount(),
      building: !!buildPromise,
      membersCached: state.members.length,
      membersAlive: state.members.filter(c => c?.health > 0).length,
      visible: state.visible,
      provoked: state.provoked,
      observedStep: state.observedStep,
      builds: state.builds,
      wakes: state.wakes,
      sleeps: state.sleeps,
      updateTicks: state.updateTicks,
      lastUpdateAt: state.lastUpdateAt,
      reason: state.reason,
    };
  }

  window.HarlyaoNightMarch = Object.freeze({
    update,
    loadConfig,
    provoke: () => provoke('debug'),
    debugSnapshot,
    formatDebug: () => {
      const d = debugSnapshot();
      const sched = d.scheduled ? `${d.scheduled.zoneId}/${d.scheduled.direction}@${d.scheduled.chunk.cx},${d.scheduled.chunk.cz}` : 'inactive';
      const player = d.playerChunk ? `${d.playerChunk.cx},${d.playerChunk.cz}` : 'none';
      const live = d.liveChunk ? `${d.liveChunk.cx},${d.liveChunk.cz}` : 'none';
      const anchor = d.liveAnchor ? `${d.liveAnchor.x.toFixed(2)},${d.liveAnchor.z.toFixed(2)}` : 'none';
      const ground = Number.isFinite(d.placement?.groundErrorY) ? d.placement.groundErrorY.toFixed(3) : '-';
      return `Harlyao march: cfg=${d.configReady} deps=${d.depsReady} scheduled=${sched} player=${player} live=${live} anchor=${anchor} members=${d.membersAlive}/${d.membersCached}/${d.expectedMembers} building=${d.building} visible=${d.visible} groundErr=${ground} ticks=${d.updateTicks} provoked=${d.provoked} reason=${d.reason}`;
    },
    __test: Object.freeze({ routeForDay, coarseStateFor, chunkCount, formationOffset }),
  });

  watchNamespace('BanditCombat', installBanditCombat);
  watchNamespace('BanditCamps', installCampTick);
  loadConfig();
  unregisterGlow?.();
  unregisterGlow = window.Ghostify?.registerGlowSource?.(glowSource) || null;
})();
