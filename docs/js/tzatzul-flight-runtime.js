// Cliff-roosted Tzatzul behavior. WildlifeSpawn supplies the existing update
// tick and population lifecycle; the shared perch system owns 3D elevation.
(() => {
  'use strict';
  if (window.TzatzulFlightRuntime) return;

  const ALLOWED_AREAS = new Set(['map_northern_cliffs', 'map_western_slope']); // Real cliff environments.
  const BIRDS_PER_ZONE = 2; // Bounded wildlife population and expensive articulated rig count.
  const MIN_ROOST_GAP_TILES = 14; // Separate nests cannot pile up in adjacent miniature ledges.
  const HUNT_RANGE_TILES = 12; // Target query only occurs once per resting cycle.
  const REST_SECONDS = 5; // Birds visibly perch instead of permanently orbiting.
  const SPEED_TILES_PER_SECOND = 7; // Flight travel across world tiles.
  const BODY_WIDTH_FRACTION = .30; // Damaging torso/core is narrower than the full articulated wing-span portrait.
  const BODY_HEIGHT_FRACTION = .34; // Half-height of the headfirst body box, based on the existing creature hitbox.
  const NOSE_LEAD_FRACTION = .33; // Moves the body toward the head/beak along its actual 3D flight direction.
  const captured = new Map(); // Live non-player victims being carried, keyed by the original actor.
  const spawnedThisDay = new Set(); // Prevents post-death immediate respawning.
  const actors = new Set(); // Only Tzatzul, not all hostile creatures, are animated each tick.
  const stats = { spawned: 0, flights: 0, swoops: 0, hits: 0, misses: 0,
    retreats: 0, captures: 0, releases: 0, lastCapture: null, last: null, lastBodyContact: null }; // Mobile-readable diagnostics, no live object references.
  let deps = null; // WildlifeSpawn injected authoritative gameplay world contract.
  let flightSerial = 0; // Unique ephemeral line-perch IDs for traveling birds.

  const n = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const tile = () => Math.max(1, n(deps?.TILE, 64));
  const surface = (x, y) => n(deps?.worldSurfaceY?.(x, y));
  const distance = (a, b) => Math.hypot(n(a.x) - n(b.x), n(a.y) - n(b.y));
  function mark(bird, event) {
    stats.last = { time: Date.now(), event, bird: bird?._tzFlight?.identity?.id || null,
      area: bird?.areaId || null };
    window.__farmLog?.('[tzatzul] ' + event, 'wildlife');
  }
  function roosts(area) {
    // Existing mini-cliff caps are player-reachable; do not use them as nests.
    // The dedicated Spire owner adds physically separate bird-only point
    // perches without modifying player climb paths or walking surfaces.
    return window.TzatzulCliffSites?.ensure?.(area, {
      zoneScenes: deps?.zoneScenes, TILE: tile(),
    }) || [];
  }
  function init(injected) {
    deps = injected; // No second creature factory, map store, camera loop, or independent timers.
    lastArea = null;
    for (const prey of [...captured.keys()]) releaseCaptive(prey, 'reset');
    actors.clear();
    spawnedThisDay.clear();
    return !!deps?.makeCreatureEntity;
  }
  function ensureZone(area) {
    if (!deps || !ALLOWED_AREAS.has(area) || deps.getCurrentArea?.() !== area) return 0;
    let count = 0;
    const available = roosts(area);
    const supports = new Map(available.map(r => [r.id, r.support])); // Restore roost identity across scene regeneration.
    for (const bird of actors) {
      if (bird.areaId !== area || !(bird.health > 0)) continue;
      const state = bird._tzFlight, support = supports.get(state?.roostId);
      if (!support) continue;
      state.roost = support;
      if (state.phase === 'perched') window.PerchSupport?.attach?.(bird, support);
    }
    for (const [slot, roost] of available.entries()) {
      if (spawnedThisDay.has(roost.id)) continue;
      const identity = window.TzatzulRegistration?.identityFor?.(area, slot);
      if (!identity) continue;
      const bird = deps.makeCreatureEntity('tzatzul', roost.support.x, roost.support.y, {
        homeX: roost.support.x, homeY: roost.support.y, state: 'idle',
        streamVisuals: true, wildlifeRole: 'predator', tzatzulRoostId: roost.id,
      });
      if (!bird || !window.PerchSupport?.attach?.(bird, roost.support)) continue;
      bird.tzatzulIdentity = identity; // Live wing renderer uses this exact stable per-map coloring.
      bird.tzatzulFlightPose = 'perched'; // Reuses TzatzulLiveVisuals; no duplicate renderer.
      bird._tzFlight = { identity, roostId: roost.id, roost: roost.support,
        phase: 'perched', elapsed: 0, rest: REST_SECONDS + slot, target: null,
        segment: null, struck: false, captive: null }; // Independent phase per animal.
      deps.hostileObjects.add(bird);
      actors.add(bird);
      spawnedThisDay.add(roost.id);
      stats.spawned++; count++;
      mark(bird, 'roosted on bird-only cliff spire ' + roost.id);
    }
    return count;
  }
  function viable(bird, other) {
    return other && other !== bird && other.health > 0 && other.areaId === bird.areaId
      && other.creatureKey !== 'tzatzul' && other.creatureKey !== 'tzatzul-hatchling'
      && !other.onBranch && !other.onPerch && !other.tzatzulCapturedBy && !other._denHidden
      && other.state !== 'dying';
  }
  function choosePrey(bird) {
    let target = null, best = tile() * HUNT_RANGE_TILES;
    const player = deps.player; // Player can be attacked, but cannot be abducted before a nest cavern exists.
    if (player?.health > 0 && deps.getCurrentArea() === bird.areaId) {
      const d = distance(player, bird);
      if (d < best) { best = d; target = player; }
    }
    // Each bird scans at most once per REST_SECONDS, never once per frame.
    for (const collection of [deps.hostileObjects, deps.companionObjects || []]) {
      for (const other of collection) {
        if (!viable(bird, other)) continue;
        const d = distance(other, bird);
        if (d < best) { best = d; target = other; }
      }
    } // Wild animals, enemy bandits and both sides' animal companions can be swoop targets.
    return target;
  }
  function hitboxSize(bird) {
    const box = window.RangedWeapons?.actorHitbox?.(bird); // Shared combat geometry, not the wing/rider/talon rig.
    const width = Math.max(.5, n(box?.width, n(bird.def?.modelWidth, 1.6)));
    const height = Math.max(.5, n(box?.height, n(bird.halfHeight, width / 2) * 2));
    const depth = Math.max(.5, n(box?.depth, width));
    return {
      x: Math.max(.24, Math.min(1.05, width * BODY_WIDTH_FRACTION)),
      y: Math.max(.24, Math.min(.85, height * BODY_HEIGHT_FRACTION)),
      z: Math.max(.24, Math.min(1.05, depth * BODY_WIDTH_FRACTION)),
    }; // Only the torso/body is damaging; the wings and carried talons are not.
  }
  function targetBox(target) {
    const hitbox = window.RangedWeapons?.actorHitbox?.(target); // Same authoritative 3D target body volume used by ranged and melee combat.
    if (hitbox?.box?.min && hitbox?.box?.max) {
      const offsetX = n(target.x) / tile() - n(hitbox.center?.x, n(target.x) / tile());
      const offsetZ = n(target.y) / tile() - n(hitbox.center?.z, n(target.y) / tile());
      return {
        min: { x: hitbox.box.min.x + offsetX, y: hitbox.box.min.y, z: hitbox.box.min.z + offsetZ },
        max: { x: hitbox.box.max.x + offsetX, y: hitbox.box.max.y, z: hitbox.box.max.z + offsetZ },
      }; // Correct a same-frame cached hitbox for actual X/Z movement (a last-second dodge).
    }
    const width = Math.max(.35, n(target.def?.modelWidth, target === deps.player ? .72 : .8));
    const height = Math.max(.55, n(target.halfHeight, target === deps.player ? .58 : width / 2) * 2);
    const foot = Number.isFinite(target.branchSurfaceY) && target.onBranch ? target.branchSurfaceY
      : Number.isFinite(target.climbSurfaceY) && target.climbing ? target.climbSurfaceY
      : surface(target.x, target.y);
    const x = n(target.x) / tile(), z = n(target.y) / tile();
    return { min: { x: x - width / 2, y: foot, z: z - width / 2 },
      max: { x: x + width / 2, y: foot + height, z: z + width / 2 } };
  }
  function bodyCenter(bird, segment) {
    const half = segment.half; // Collision box is transported with the bird's body throughout the dive.
    const lead = Math.min(.28, Math.min(half.x, half.z) * NOSE_LEAD_FRACTION);
    return { x: n(bird.x) / tile() + segment.heading.x * lead,
      y: n(bird.branchSurfaceY, surface(bird.x, bird.y)) + half.y + segment.heading.y * lead,
      z: n(bird.y) / tile() + segment.heading.z * lead };
  }
  function sweptBodyHit(start, end, half, box) {
    // Continuous AABB sweep in world units: a large dt can never tunnel the headfirst body through prey.
    let entry = 0, exit = 1;
    for (const axis of ['x', 'y', 'z']) {
      const delta = end[axis] - start[axis];
      const min = box.min[axis] - half[axis], max = box.max[axis] + half[axis];
      if (Math.abs(delta) < 1e-8) {
        if (start[axis] < min || start[axis] > max) return null;
        continue;
      }
      let a = (min - start[axis]) / delta, b = (max - start[axis]) / delta;
      if (a > b) [a, b] = [b, a];
      entry = Math.max(entry, a);
      exit = Math.min(exit, b);
      if (entry > exit) return null;
    }
    return entry <= 1 && exit >= 0 ? entry : null;
  }
  function releaseCaptive(prey, reason) {
    const record = captured.get(prey);
    if (!record) return false;
    captured.delete(prey);
    const bird = record.bird;
    if (bird?._tzFlight?.captive === prey) bird._tzFlight.captive = null;
    if (bird) bird.tzatzulCarrying = false;
    window.PerchSupport?.forget?.(prey); // Restore native ground movement, never leave a dangling synthetic branch.
    prey.onBranch = null; prey.branchT = 0; prey.branchSurfaceY = 0;
    prey.tzatzulCapturedBy = null; prey.state = record.state;
    if (reason === 'returned to roost' && record.areaId === deps?.getCurrentArea?.()) {
      prey.x = n(bird?._tzFlight?.roost?.x, prey.x) + tile() * 2;
      prey.y = n(bird?._tzFlight?.roost?.y, prey.y) + tile() * 2;
    } // Until the nest cave is playable, return living prey to ground instead of invisibly killing them.
    stats.releases++;
    stats.lastCapture = { event: 'released', reason, prey: prey.creatureKey || prey.name || 'npc' };
    return true;
  }
  function carryCaptive(bird) {
    const prey = bird?._tzFlight?.captive;
    if (!prey) return false;
    if (!(bird.health > 0) || !(prey.health > 0) || prey.areaId !== bird.areaId
      || !deps.hostileObjects.has(bird) || captured.get(prey)?.bird !== bird) {
      releaseCaptive(prey, 'owner or prey unavailable'); return false;
    }
    if (!bird.onPerch || !window.PerchSupport?.attach?.(prey, bird.onPerch, bird.branchT)) {
      releaseCaptive(prey, 'flight support lost'); return false;
    }
    prey.tzatzulCapturedBy = bird._tzFlight.identity.id;
    prey.state = 'tzatzul-carried';
    return true;
  }
  function capture(bird, prey) {
    if (!prey || prey === deps.player || prey.isPlayer || !(prey.health > 0)
      || prey.tzatzulCapturedBy || captured.has(prey) || !bird?._tzFlight
      || !bird.onPerch || !window.PerchSupport?.attach?.(prey, bird.onPerch, bird.branchT)) return false;
    captured.set(prey, { bird, state: prey.state, areaId: prey.areaId }); // Original creature, clothing and loot survive transport.
    bird._tzFlight.captive = prey; bird.tzatzulCarrying = true; // Switch the authored flying body to its gripping sprite.
    prey.tzatzulCapturedBy = bird._tzFlight.identity.id; prey.state = 'tzatzul-carried';
    stats.captures++;
    stats.lastCapture = { event: 'captured', prey: prey.creatureKey || prey.name || 'npc' };
    mark(bird, 'captured visible prey');
    return true;
  }
  function startLeg(bird, endpoint, phase, target = null) {
    const state = bird._tzFlight, perch = window.PerchSupport;
    if (!state || !perch) return false;
    const start = { x: n(bird.x), y: n(bird.y),
      worldY: n(bird.branchSurfaceY, surface(bird.x, bird.y)) };
    const end = { x: n(endpoint.x), y: n(endpoint.y), worldY: n(endpoint.worldY, start.worldY) };
    const support = perch.line('tzatzul:flight:' + ++flightSerial + ':' + state.identity.id, start, end);
    if (!perch.attach(bird, support, 0)) return false;
    const horizontal = Math.hypot(end.x - start.x, end.y - start.y) / tile();
    const vertical = end.worldY - start.worldY;
    const length = Math.max(1e-6, Math.hypot(horizontal, vertical));
    const heading = { x: (end.x - start.x) / (tile() * length), y: vertical / length,
      z: (end.y - start.y) / (tile() * length) }; // 3D beak-first facing follows the dive, not the talon pose.
    const half = hitboxSize(bird); // Freeze body dimensions for this leg; no expensive mesh reads each frame.
    state.segment = { duration: Math.max(.55, Math.min(5, distance(start, end) / (tile() * SPEED_TILES_PER_SECOND))),
      half, heading, lastBody: null };
    state.segment.lastBody = bodyCenter(bird, state.segment); // Swept-body starting frame includes elevated roost height.
    state.elapsed = 0; state.phase = phase; state.target = target; state.struck = false;
    bird.tzatzulDivePitchRad = phase === 'swoop' ? Math.atan2(vertical, horizontal) : 0; // Rig pitches with the nose-first body on descent.
    bird.tzatzulFlightPose = 'flap';
    bird.state = 'idle'; // Avoid an additional ground-pathfinding owner for aerial movement.
    bird.facing = Math.atan2(end.y - start.y, end.x - start.x);
    stats.flights++;
    mark(bird, phase);
    return true;
  }
  function swoop(bird, target) {
    if (!target || !(target.health > 0)) return false;
    const box = targetBox(target); // Aim once at the prey's BODY, including its real elevation and size.
    const half = hitboxSize(bird);
    const aim = Math.max(box.min.y, (box.min.y + box.max.y) / 2 - half.y);
    const ok = startLeg(bird, { x: target.x, y: target.y, worldY: aim }, 'swoop', target);
    if (ok) stats.swoops++;
    return ok;
  }
  function returnHome(bird) {
    const state = bird._tzFlight;
    return startLeg(bird, state.roost, 'return');
  }
  function hit(bird, previous, current) {
    const state = bird._tzFlight;
    if (state.struck) return false;
    const target = state.target;
    if (!(target?.health > 0) || target.areaId && target.areaId !== bird.areaId
      || target.creatureKey === 'tzatzul' || target.creatureKey === 'tzatzul-hatchling'
      || target._denHidden || target.state === 'dying') return false;
    const entry = sweptBodyHit(previous, current, state.segment.half, targetBox(target));
    if (entry === null) return false; // No pre-timed hit: only actual 3D torso/body overlap can deal damage.
    state.struck = true; // One collision/attack per committed swoop, even across long frames.
    const combat = window.Combat?.deps;
    const damage = Math.max(1, n(bird.def?.attackDamage, 24));
    const opts = { attacker: bird, tag: 'sharp', aerialSwoop: true, impactCollider: 'body' };
    let applied = false;
    if (target === deps.player && typeof combat?.damagePlayer === 'function') {
      combat.damagePlayer(damage, bird.x, bird.y, 75, opts); applied = true;
    } else if (typeof combat?.damageCreature === 'function') {
      combat.damageCreature(target, damage, bird.x, bird.y, 75, opts); applied = true;
    } else if (target !== deps.player && window.WildlifeSpawn?.applyWildlifeSkirmishDamage) {
      window.WildlifeSpawn.applyWildlifeSkirmishDamage(bird, target, damage); applied = true;
    }
    stats.lastBodyContact = { at: Date.now(), id: state.identity.id,
      target: target === deps.player ? 'player' : target.creatureKey || 'creature',
      sweptFraction: +entry.toFixed(3), phase: state.phase, collider: 'body' };
    if (applied) { stats.hits++; mark(bird, 'headfirst body dive hit');
      if (target !== deps.player && target.health > 0) capture(bird, target); }
    else { stats.misses++; mark(bird, 'body contact (damage unavailable)'); }
    return applied;
  }
  function advance(bird, dt) {
    const state = bird._tzFlight;
    if (!state.segment) return;
    state.elapsed = Math.min(state.segment.duration, state.elapsed + dt);
    const t = Math.max(0, Math.min(1, state.elapsed / state.segment.duration));
    bird.branchT = t;
    window.PerchSupport?.constrain?.(bird); // Reuses native onBranch and branchSurfaceY movement/portrait height.
    carryCaptive(bird); // Prey uses the same elevated support as the flying body.
    bird.tzatzulFlightPose = t < .15 || t > .85 ? 'flap' : 'glide';
    if (state.phase === 'swoop') {
      const previous = state.segment.lastBody;
      const current = bodyCenter(bird, state.segment);
      state.segment.lastBody = current;
      hit(bird, previous, current); // The complete torso is swept from last frame to this frame; no talon point or fixed attack timestamp.
    }
    if (t < 1) return;
    if (state.phase === 'swoop' && !state.struck) {
      state.struck = true; stats.misses++; mark(bird, 'body missed committed dive');
    }
    state.segment = null;
    if (state.phase === 'swoop') { returnHome(bird); return; }
    if (state.phase === 'return' && window.PerchSupport?.attach?.(bird, state.roost)) {
      if (state.captive) releaseCaptive(state.captive, 'returned to roost');
      state.phase = 'perched'; state.elapsed = 0; state.rest = REST_SECONDS;
      state.target = null; bird.tzatzulFlightPose = 'perched'; bird.tzatzulDivePitchRad = 0;
    }
  }
  let lastArea = null; // Changed-zone detection disposes only old spire scene roots.
  function update(dt) {
    if (!deps?.hostileObjects) return;
    const step = Math.max(0, Math.min(.1, n(dt))); // Mobile tab resume cannot skip several seconds of flight.
    const area = deps.getCurrentArea?.();
    if (area !== lastArea) {
      window.TzatzulCliffSites?.releaseInactive?.(area);
      lastArea = area;
    }
    for (const bird of actors) {
      if (!deps.hostileObjects.has(bird) || !(bird.health > 0)) {
        if (bird._tzFlight?.captive) releaseCaptive(bird._tzFlight.captive, 'bird died or unloaded');
        actors.delete(bird); window.TzatzulLiveVisuals?.release?.(bird, 'dead or unloaded'); continue;
      }
      if (bird.areaId !== area) {
        if (bird._tzFlight?.captive) releaseCaptive(bird._tzFlight.captive, 'area transition');
        continue; // No physics or path scanning on inactive maps.
      }
      const state = bird._tzFlight;
      if (!state) continue;
      if (state.phase !== 'perched') { advance(bird, step); continue; }
      state.elapsed += step;
      if (state.elapsed < state.rest) continue;
      if (bird.health <= n(bird.maxHealth, 1) * .3) {
        stats.retreats++; state.elapsed = 0; state.rest = REST_SECONDS * 3;
        continue; // A wounded bird shelters at its real roost; it cannot retreat into a nonexistent cave.
      }
      const prey = choosePrey(bird);
      if (!prey || !swoop(bird, prey)) { state.elapsed = 0; state.rest = REST_SECONDS; }
    }
  }
  function onDayAdvance() {
    const living = new Set([...actors].filter(c => c.health > 0).map(c => c._tzFlight?.roostId));
    for (const key of spawnedThisDay) if (!living.has(key)) spawnedThisDay.delete(key);
  }
  function debugSnapshot() {
    return { ...stats, active: actors.size, populationKeys: spawnedThisDay.size,
      roosts: (window.TzatzulCliffSites?.snapshot?.().areas || []).map(({ area, count }) => ({ area, count })), // The mobile panel counts real spires, not abandoned reachable-balcony entries.
      birds: [...actors].map(c => ({ id: c._tzFlight?.identity?.id, area: c.areaId,
        phase: c._tzFlight?.phase, pose: c.tzatzulFlightPose,
        target: c._tzFlight?.target === deps.player ? 'player' : c._tzFlight?.target?.creatureKey || null,
        captive: c._tzFlight?.captive?.creatureKey || null })) };
  }
  window.TzatzulFlightRuntime = Object.freeze({
    init, ensureZone, update, onDayAdvance, debugSnapshot,
    owns: bird => actors.has(bird) && !!bird._tzFlight && bird.health > 0, // Existing hostile renderer skips ground movement for these flight-owned predators.
    __test: Object.freeze({ roosts, choosePrey, swoop, returnHome, capture, carryCaptive, releaseCaptive }),
  });
})();