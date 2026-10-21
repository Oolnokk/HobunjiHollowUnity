(() => {
  'use strict';

  // Persistent data-only marchers travel offscreen; nearby members use the
  // ordinary hostile return/travel state, just like Porakaneki residents.
  const CONFIG_URL = 'config/harlyao-night-march.json'; // Shared march tuning.
  const SPECIES_ID = 'harlyao'; // Forced army species.
  const DORMANT_AREA_PREFIX = '__harlyao_march_dormant__:'; // Skips parked rigs in hostile AI.
  const FALLBACK_CHUNK_TILES = 16; // Music/debug chunk coordinates only.
  const TICK_INTERVAL_S = 0.2; // Planner cadence; native AI owns per-frame movement.
  const SCHEDULER_ID = 'harlyao-night-march'; // One shared frame subscription.
  let deps = null; // BanditCombat dependency seam.
  let cfg = null; // Shared config loaded once.
  let gangCfg = null; // Cached humanoid balance definitions.
  let buildPromise = null; // At most one portrait build is requested at a time.
  let buildGeneration = 0; // Cancels builds across dawn/day/zone changes.
  let tickAccum = 0; // Detailed planner elapsed seconds.
  let coarseAccum = 0; // Abstract travel elapsed seconds.
  const state = {
    day: null, zoneId: null, members: [], agents: [], commanderIndex: 0,
    visible: false, provoked: false, liveChunk: null, regrouping: false,
    reason: 'boot', builds: 0, wakes: 0, sleeps: 0, coarseTicks: 0,
    updateTicks: 0, lastUpdateAt: 0, tickOwner: 'uninstalled',
  }; // Single authority for identities, simulated positions, lifecycle and diagnostics.
  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
  const num = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const chunkTiles = () => Number(window.WildernessChunks?.constants?.CHUNK_TILES) || FALLBACK_CHUNK_TILES;
  const chunkCount = tiles => Math.max(1, Math.ceil(Math.max(1, num(tiles, 1)) / chunkTiles()));
  const expectedMemberCount = () => Math.max(1, Math.floor(num(cfg?.memberCount, 20)));
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
    // Generated layout dimensions win over the small pre-generation zone definitions.
    const live = deps?.zoneLayouts?.get?.(zoneId) || window.zoneLayouts?.get?.(zoneId) || null;
    const def = deps?.EXTERIOR_ZONES?.[zoneId] || window.EXTERIOR_ZONES?.[zoneId] || null; // Fallback only for a zone with no live layout yet.
    return {
      cols: Math.max(1, Number(live?.cols) || Number(def?.cols) || 200),
      rows: Math.max(1, Number(live?.rows) || Number(def?.rows) || 200),
    };
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
      name: index === 0 ? 'Harlyao Commander' : `Harlyao Marcher ${index + 1}`,
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

  function memberVisualRoots(c) {
    return [c?.avatarRef?.group, c?.groundShadow, c?._banditToolHolder, c?._banditRangedToolHolder].filter(Boolean); // Shared root list used when parking/waking cached marchers and by on-demand complexity diagnostics.
  }

  function setMemberVisualAttachment(c, attached) {
    if (!c) return;
    const roots = memberVisualRoots(c); // All independently scene-attached roots created by BanditCombat.makeEntity.
    if (!attached) {
      for (const root of roots) root.parent?.remove?.(root); // Invisible Object3D trees still participate in Scene.updateMatrixWorld; parking removes that hidden transform cost entirely.
      return;
    }
    const scene = deps?.getActiveScene?.() || c.scene || null; // Current live scene wins after a wilderness rebuild/re-entry.
    if (!scene?.add) return;
    c.scene = scene;
    for (const root of roots) {
      if (root.parent === scene) continue;
      root.parent?.remove?.(root);
      scene.add(root);
    }
  }

  function hide(c) {
    if (!c) return;
    c.areaId = `${DORMANT_AREA_PREFIX}${state.zoneId}`; // Existing hostile area guard removes all offscreen AI/update cost.
    if (c.avatarRef?.group) c.avatarRef.group.visible = false;
    if (c.groundShadow) c.groundShadow.visible = false;
    if (c._banditToolHolder) c._banditToolHolder.visible = false;
    if (c._banditRangedToolHolder) c._banditRangedToolHolder.visible = false;
    setMemberVisualAttachment(c, false); // Also removes cached hidden rigs from Three's matrix traversal until the army wakes again.
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

  function openPlacement(c, tile) {
    if (!deps?.creatureCanEnterTile || deps.creatureCanEnterTile(c.def, tile.col * deps.TILE, tile.row * deps.TILE)) return tile;
    const col = Math.floor(tile.col), row = Math.floor(tile.row); // Search nearby tile centers using the same collision authority as native travel.
    for (let radius = 1; radius <= 8; radius++) {
      for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
        if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
        const candidate = { col: col + dx + 0.5, row: row + dy + 0.5 }; // Only allocation during a blocked spawn/wake, never per frame.
        if (deps.creatureCanEnterTile(c.def, candidate.col * deps.TILE, candidate.row * deps.TILE)) return candidate;
      }
    }
    return null;
  }

  function place(c, tile, zoneId) {
    refreshMemberArea(c, zoneId);
    tile = openPlacement(c, tile);
    if (!tile) { hide(c); return false; } // Keep the actor abstract if this neighborhood has no valid emergence tile.
    setMemberVisualAttachment(c, true); // Reattaches a parked cached rig only when this member is genuinely returning to the live army chunk.
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
    return true;
  }


  function routeState(day = civilDay(), hour = gameHour(), config = cfg) {
    const route = routeForDay(day, config); // Daily rotation still owns which zone hosts the march.
    return { active: !!route && hour >= num(config?.activeHours?.start, 0) && hour < num(config?.activeHours?.end, 6), day, hour, route, zoneId: route?.zoneId || null };
  }

  function routeEndpoints(s, dims) {
    const pad = clamp(num(cfg?.routeLane?.edgePaddingTiles, 2), 0.5, Math.min(dims.cols, dims.rows) * 0.5); // Safe start/end inset.
    const fraction = clamp(num(cfg?.routeLane?.crossAxisFraction, 0.5), 0, 1); // Authored cross-axis lane.
    const start = { col: pad + fraction * Math.max(0, dims.cols - 2 * pad), row: pad + fraction * Math.max(0, dims.rows - 2 * pad) }; // Entry point.
    const end = { ...start }; // Route exit; reaching it is optional before dawn.
    const key = s.route.axis === 'x' ? 'col' : 'row'; // Moving coordinate.
    const extent = key === 'col' ? dims.cols : dims.rows; // Full generated map extent.
    start[key] = s.route.direction > 0 ? pad : extent - pad;
    end[key] = s.route.direction > 0 ? extent - pad : pad;
    return { start, end };
  }

  function resetForRoute(s) {
    if (state.day === s.day && state.zoneId === s.zoneId && state.agents.length) return;
    teardown('new-daily-route');
    state.day = s.day;
    state.zoneId = s.zoneId;
    state.provoked = false;
    state.commanderIndex = 0;
    state.regrouping = false;
    coarseAccum = 0;
    const dims = zoneDims(s.zoneId); // Actual generated dimensions.
    const { start } = routeEndpoints(s, dims); // New nights start at the entry, never at a clock-derived chunk.
    for (let index = 0; index < expectedMemberCount(); index++) {
      const offset = formationOffset(index); // Loose trailing ranks behind the commander.
      offset.longitudinal = index === 0 ? 0 : -Math.ceil(index / Math.max(1, num(cfg?.formation?.columns, 4))) * num(cfg?.formation?.longitudinalSpacingTiles, 1.2);
      if (index === 0) offset.lateral = 0;
      const tile = memberTile(start, offset, s, dims); // Clamped data-only spawn.
      state.agents.push({ id: `harlyao:${s.day}:${index}`, index, x: tile.col, y: tile.row, offset, entity: null, dead: false, target: tile, dormantSeconds: 0 });
    }
    state.reason = 'simulating';
  }

  function commander() {
    const current = state.agents[state.commanderIndex]; // Stable commander identity, independent of visible order.
    if (current && !current.dead) return current;
    const replacement = state.agents.find(agent => !agent.dead); // Surviving officer succeeds a slain commander.
    if (!replacement) return null;
    state.commanderIndex = replacement.index;
    return replacement;
  }

  function syncAgents() {
    for (const agent of state.agents) {
      const c = agent.entity; // Existing visible rig is authoritative until parked.
      if (!c) continue;
      if (c.health <= 0) { agent.dead = true; continue; }
      if (c.areaId === state.zoneId) { agent.x = c.x / deps.TILE; agent.y = c.y / deps.TILE; }
    }
  }

  function planFormation(s) {
    const leader = commander(); // Every follower targets this specific actor.
    if (!leader) return;
    let spread = 0; // Farthest follower controls regrouping, with hysteresis.
    for (const agent of state.agents) if (!agent.dead) spread = Math.max(spread, Math.hypot(agent.x - leader.x, agent.y - leader.y));
    const stop = Math.max(2, num(cfg?.formation?.regroupDistanceTiles, 9)); // Pause distance.
    const resume = clamp(num(cfg?.formation?.resumeDistanceTiles, 5), 1, stop); // Resume distance.
    state.regrouping = state.regrouping ? spread > resume : spread > stop;
    const dims = zoneDims(s.zoneId); // Bounds for trail slots and route endpoint.
    leader.target = state.regrouping ? { col: leader.x, row: leader.y } : routeEndpoints(s, dims).end;
    for (const agent of state.agents) {
      if (agent.dead || agent === leader) continue;
      // Once strung out, converge on the commander rather than an unreachable
      // rigid slot. Otherwise aim for a loose, trailing rank.
      agent.target = state.regrouping ? { col: leader.x, row: leader.y } : memberTile({ col: leader.x, row: leader.y }, agent.offset, s, dims);
    }
  }

  function speedFor(agent) {
    const speed = Math.max(0.1, num(cfg?.formation?.marchSpeedTilesPerSecond, 1.15)); // Shared detailed/abstract speed.
    return agent.index === state.commanderIndex ? speed : speed * Math.max(1, num(cfg?.formation?.followerCatchUpMultiplier, 1.2));
  }

  function advanceAbstract(agent, dt) {
    const dx = agent.target.col - agent.x, dy = agent.target.row - agent.y; // Target delta in tiles.
    const distance = Math.hypot(dx, dy); // Prevent zero-distance division.
    if (distance <= 0.15) return;
    const step = Math.min(distance, speedFor(agent) * dt); // No deadline-driven speed or clock snap.
    agent.x += dx / distance * step;
    agent.y += dy / distance * step;
  }

  function neutral(c, agent) {
    if (!c || c.health <= 0) return;
    c._harlyaoAggroRangePx ??= num(c.def?.aggroRangePx, deps.TILE * 6);
    c._harlyaoBaseMoveSpeed ??= num(c.def?.moveSpeed, 118);
    c.def.aggroRangePx = 0;
    c.def.moveSpeed = speedFor(agent) * deps.TILE;
    c.homeX = agent.target.col * deps.TILE;
    c.homeY = agent.target.row * deps.TILE;
    c.state = 'return'; // Shared travelCreatureToward owns pathing, facing, feet and animation.
    c.wanderTarget ??= { x: c.x, y: c.y };
    c.wanderTarget.x = c.x;
    c.wanderTarget.y = c.y;
    c.wanderT = 9999;
  }

  function simulationDistance(agent) {
    if (deps?.getCurrentArea?.() !== state.zoneId || !deps?.player || !(deps.TILE > 0)) return Infinity;
    return Math.hypot(agent.x - deps.player.x / deps.TILE, agent.y - deps.player.y / deps.TILE);
  }

  function shouldRender(agent) {
    const radius = Math.max(1, num(cfg?.behavior?.fullSimulationRadiusTiles, 18)); // Same bubble as Porakaneki.
    const release = Math.max(radius, num(cfg?.behavior?.fullSimulationReleaseRadiusTiles, 24)); // Prevent boundary flicker.
    return !agent.dead && simulationDistance(agent) <= (agent.entity?.areaId === state.zoneId ? release : radius);
  }

  function setHostile(c) {
    if (c._harlyaoProvoked) return;
    c._harlyaoProvoked = true; // Native combat/search owns the actor after the first provocation.
    c.homeX = c.x;
    c.homeY = c.y; // A distant route endpoint must not leash a newly provoked commander out of combat.
    c.def.aggroRangePx = c._harlyaoAggroRangePx || deps.TILE * 6;
    c.def.moveSpeed = c._harlyaoBaseMoveSpeed || c.def.moveSpeed;
    if (c.state !== 'chase') c.state = 'chase';
  }

  function provoke(reason) {
    if (state.provoked) return;
    state.provoked = true;
    state.reason = `provoked:${reason}`;
    for (const c of state.members) if (c?.health > 0) setHostile(c);
    window.__farmLog?.('[harlyao-march] Army provoked; surviving marchers defend their commander.', 'warn', 'wildlife');
  }

  function releaseEntity(agent) {
    const c = agent.entity; // Cached rig being retired; data-only identity/position survives.
    if (!c) return;
    deps?.hostileObjects?.delete?.(c);
    window.BanditCombat?.discardEntity?.(c);
    const index = state.members.indexOf(c); // Keep compatibility diagnostics limited to retained entities.
    if (index >= 0) state.members.splice(index, 1);
    agent.entity = null;
  }

  function teardown(reason) {
    buildGeneration++;
    for (const agent of state.agents) releaseEntity(agent);
    state.agents.length = 0;
    state.members.length = 0;
    state.visible = false;
    state.liveChunk = null;
    state.reason = reason;
  }

  const yieldFrame = () => typeof window.requestAnimationFrame === 'function'
    ? new Promise(resolve => window.requestAnimationFrame(resolve))
    : Promise.resolve(); // One-shot portrait-build yield; never owns a frame loop.

  async function materialize(agent, s) {
    if (buildPromise || !shouldRender(agent)) return;
    const generation = buildGeneration; // Captured across asynchronous avatar construction.
    state.builds++;
    buildPromise = (async () => {
      gangCfg ||= await window.BanditCombat?.loadGangConfig?.();
      if (!gangCfg || generation !== buildGeneration || !shouldRender(agent)) return;
      const w = weapon(agent.index); // Existing melee equipment pool.
      const c = await window.BanditCombat.makeEntity({ ...gangCfg, speciesWeights: { [SPECIES_ID]: 1 }, rangedWeaponChanceByRank: { grunt: 0, lieutenant: 0, captain: 0 } }, 'grunt', 0, agent.x * deps.TILE, agent.y * deps.TILE, {
        zoneId: s.zoneId,
        rosterOverride: roster(agent.index),
        defOverride: { label: agent.index === state.commanderIndex ? 'Harlyao Commander' : 'Harlyao Marcher', weaponKey: w.weaponKey, weaponShapeKey: w.shapeKey, weaponMetalKey: w.metalKey, attackTag: w.attackTag, rangedWeaponKey: null },
        extra: { isHarlyaoArmyMember: true, harlyaoArmyIndex: agent.index, harlyaoCommanderId: state.agents[state.commanderIndex]?.id, harlyaoWeaponShape: w.shapeKey },
      });
      if (!c) return;
      if (generation !== buildGeneration || !routeState().active || !shouldRender(agent)) { window.BanditCombat.discardEntity?.(c); return; }
      agent.entity = c;
      state.members.push(c);
      ghostify(c);
      if (!place(c, { col: agent.x, row: agent.y }, s.zoneId)) { releaseEntity(agent); return; }
      agent.x = c.x / deps.TILE;
      agent.y = c.y / deps.TILE;
      neutral(c, agent);
      if (state.provoked) setHostile(c);
      deps.hostileObjects.add(c);
      state.reason = 'member-materialized';
      await yieldFrame();
    })().catch(error => {
      state.reason = `build-error:${error.message}`;
      window.__farmLog?.(`[harlyao-march] ${state.reason}`, 'warn', 'wildlife');
    }).finally(() => { buildPromise = null; });
    return buildPromise;
  }

  function update(dt) {
    if (deps?.isPaused?.()) return;
    tickAccum += clamp(num(dt), 0, 0.5); // Browser stalls never become map-length teleports.
    if (tickAccum < TICK_INTERVAL_S) return;
    const step = tickAccum; // Real elapsed time, independent of game-clock deadlines.
    tickAccum = 0;
    state.updateTicks++;
    state.lastUpdateAt = num(globalThis.performance?.now?.(), Date.now());
    if (!deps || !cfg) return;
    const s = routeState(); // Clock only decides presence and daily zone.
    if (!s.active) {
      if (state.agents.length) teardown('daylight');
      return;
    }
    resetForRoute(s);
    syncAgents();
    if (!state.provoked) for (const c of state.members) {
      if (c.health < c.maxHealth || c.hitFlashT > 0) { provoke(c.id); break; }
    }
    planFormation(s);
    coarseAccum += step;
    const interval = Math.max(0.2, num(cfg?.behavior?.offChunkTickSeconds, 1)); // Cheap abstract steering cadence.
    const coarseStep = coarseAccum >= interval ? coarseAccum : 0; // One shared batch for offscreen agents.
    if (coarseStep) { coarseAccum = 0; state.coarseTicks++; }
    state.visible = false;
    for (const agent of state.agents) {
      if (agent.dead) continue;
      const c = agent.entity; // Optional nearby detailed representation.
      if (shouldRender(agent)) {
        agent.dormantSeconds = 0;
        if (!c) {
          if (coarseStep) advanceAbstract(agent, coarseStep); // Travel continues while a portrait waits in the build queue.
          materialize(agent, s);
          continue;
        }
        if (c.areaId !== s.zoneId) {
          if (!place(c, { col: agent.x, row: agent.y }, s.zoneId)) {
            if (coarseStep) advanceAbstract(agent, coarseStep);
            continue;
          }
          agent.x = c.x / deps.TILE;
          agent.y = c.y / deps.TILE;
          state.wakes++;
        }
        if (state.provoked) setHostile(c); else neutral(c, agent);
        c.harlyaoCommanderId = commander()?.id || null;
        state.visible = true;
      } else {
        if (c?.areaId === s.zoneId) { hide(c); state.sleeps++; }
        agent.dormantSeconds += step;
        if (c && agent.dormantSeconds >= Math.max(1, num(cfg?.behavior?.dormantEntityReleaseSeconds, 3))) releaseEntity(agent);
        if (coarseStep) advanceAbstract(agent, coarseStep);
      }
    }
    const leader = commander(); // Also updates music's compatibility chunk to the real simulated position.
    state.liveChunk = leader ? { cx: Math.floor(leader.x / chunkTiles()), cz: Math.floor(leader.y / chunkTiles()) } : null;
  }

  function commanderTarget() {
    const leader = commander(); // Cheap target accessor used by the beacon, without allocating a whole debug snapshot.
    if (!leader || !routeState().active) return null;
    const c = leader.entity; // Native movement may have advanced since the last planner tick.
    const live = c?.health > 0 && c.areaId === state.zoneId;
    const x = live ? c.x / deps.TILE : leader.x, z = live ? c.y / deps.TILE : leader.y; // Target always points at this actor.
    return { id: leader.id, index: leader.index, zoneId: state.zoneId, x, z, col: Math.floor(x), row: Math.floor(z), surfaceY: live ? num(c.avatarRef?.group?.position?.y) - num(c.halfHeight) : undefined, simulated: !live };
  }
  function placementDebug() {
    const c = state.members.find(member => member && member.health > 0 && member.areaId === state.zoneId && member.avatarRef?.group?.visible);
    if (!c?.avatarRef?.group || !deps?.TILE) return null;
    const feetY = Number(c.avatarRef.group.position.y) - (Number(c.halfHeight) || 0); // Rendered feet should equal sampled surface exactly.
    const tile = c.areaGrid?.[Math.floor(c.y / deps.TILE)]?.[Math.floor(c.x / deps.TILE)]; // Sample current feet rather than the old spawn tile.
    const surfaceY = tile ? Number(deps.tileSurfaceYInArea?.(tile, state.zoneId)) : NaN;
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

  async function loadConfig() {
    try {
      const response = await fetch(CONFIG_URL); // One-time route/equipment configuration load.
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      cfg = await response.json();
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
      if (state.tickOwner !== 'RuntimeFrameScheduler') update(dt);
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
    if (typeof descriptor?.set === 'function') {
      Object.defineProperty(window, name, {
        configurable: true, enumerable: descriptor.enumerable ?? true,
        get() { return descriptor.get?.call(window); },
        set(value) { descriptor.set.call(window, value); installer(descriptor.get ? descriptor.get.call(window) : value); },
      });
      return;
    }
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

  function visualComplexitySnapshot() {
    const geometries = new Set(); // Unique Harlyao geometry resources represented by all cached member visual roots.
    const materials = new Set(); // Unique Harlyao material resources represented by all cached member visual roots.
    let roots = 0; // Total avatar/shadow/tool roots owned by cached army members.
    let attachedRoots = 0; // Roots currently attached to a scene and therefore participating in Scene.updateMatrixWorld.
    let visibleRoots = 0; // Attached roots whose root-level visibility is enabled.
    let nodes = 0; // Object3D nodes beneath attached roots; direct proxy for matrix-hierarchy work.
    let meshes = 0; // Renderable mesh nodes beneath attached roots.
    let skinnedMeshes = 0; // Skinned portrait planes, a relatively expensive subset of the mesh count.
    for (const c of state.members) {
      if (!c) continue;
      for (const root of memberVisualRoots(c)) {
        roots++;
        if (!root.parent) continue;
        attachedRoots++;
        if (root.visible !== false) visibleRoots++;
        const visit = object => {
          nodes++;
          if (!object?.isMesh) return;
          meshes++;
          if (object.isSkinnedMesh) skinnedMeshes++;
          if (object.geometry) geometries.add(object.geometry);
          const list = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of list) if (material) materials.add(material);
        };
        if (typeof root.traverse === 'function') root.traverse(visit);
        else visit(root);
      }
    }
    return {
      membersCached: state.members.length,
      membersAlive: state.members.filter(c => c?.health > 0).length,
      armyVisible: state.visible,
      roots,
      attachedRoots,
      visibleRoots,
      attachedNodes: nodes,
      attachedMeshes: meshes,
      attachedSkinnedMeshes: skinnedMeshes,
      uniqueGeometries: geometries.size,
      uniqueMaterials: materials.size,
    };
  }


  function installRuntimeTick() {
    if (!window.RuntimeFrameScheduler?.register) return false;
    window.RuntimeFrameScheduler.register(SCHEDULER_ID, frame => update(num(frame?.deltaMs) / 1000), {
      phase: 'pre-game', owner: 'HarlyaoNightMarch',
      description: 'Steers the commander-led spectral army and promotes nearby simulated marchers before native hostile travel.',
    });
    state.tickOwner = 'RuntimeFrameScheduler';
    return true;
  }

  function debugSnapshot() {
    const s = cfg ? routeState() : null; // Same lifecycle authority as update.
    const target = commanderTarget(); // Stable exact moving target for diagnostics and music.
    return {
      configReady: !!cfg, depsReady: !!deps, day: state.day, zoneId: state.zoneId,
      scheduled: s?.active ? { zoneId: s.zoneId, direction: s.route.directionLabel, hour: s.hour, chunk: state.liveChunk } : null,
      playerChunk: deps?.player ? { cx: Math.floor(deps.player.x / deps.TILE / chunkTiles()), cz: Math.floor(deps.player.y / deps.TILE / chunkTiles()) } : null,
      liveChunk: state.liveChunk, liveAnchor: target, commander: target,
      placement: placementDebug(), expectedMembers: expectedMemberCount(),
      building: !!buildPromise, membersCached: state.members.length,
      membersAlive: state.agents.filter(agent => !agent.dead).length,
      detailedMembers: state.members.filter(c => c.health > 0 && c.areaId === state.zoneId).length,
      visible: state.visible, provoked: state.provoked, regrouping: state.regrouping,
      builds: state.builds, wakes: state.wakes, sleeps: state.sleeps,
      coarseTicks: state.coarseTicks, updateTicks: state.updateTicks,
      lastUpdateAt: state.lastUpdateAt, tickOwner: state.tickOwner, reason: state.reason,
      latestChange: 'Commander-led persistent simulation; loose regrouping, individual distance LOD, native travel and moving 3D beacon.',
      agents: state.agents.map(agent => ({ id: agent.id, index: agent.index, x: agent.x, y: agent.y, dead: agent.dead, target: agent.target })),
    };
  }

  window.HarlyaoNightMarch = Object.freeze({
    update, loadConfig, commanderTarget, visualComplexitySnapshot,
    provoke: () => provoke('debug'), debugSnapshot,
    formatDebug: () => {
      const d = debugSnapshot(); // Copyable mobile report uses the existing Pixel Probe surface.
      return `Harlyao march: ${d.latestChange} commander=${d.commander?.id || '-'} position=${d.commander ? `${d.commander.x.toFixed(2)},${d.commander.z.toFixed(2)}` : '-'} alive=${d.membersAlive} detailed=${d.detailedMembers} regrouping=${d.regrouping} ticks=${d.updateTicks}/${d.coarseTicks} owner=${d.tickOwner} reason=${d.reason}`;
    },
    __test: Object.freeze({ routeForDay, routeState, chunkCount, formationOffset }),
  });
  watchNamespace('BanditCombat', installBanditCombat);
  if (!installRuntimeTick()) watchNamespace('BanditCamps', installCampTick);
  loadConfig();
  window.Ghostify?.registerGlowSource?.(glowSource);
})();
