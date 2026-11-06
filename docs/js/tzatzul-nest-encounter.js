// Interior-only Tzatzul mother-and-clutch encounter. The normal cavern
// locale supplies floor/collision; TzatzulNestInterior supplies rock perches
// and authored sharp stone. This runs in WildlifeSpawn's existing tick.
(() => {
  'use strict';
  if (window.TzatzulNestEncounter) return;
  const REST_S = 1.35; // Short perch pauses make the mother dangerous without a faraway retreat.
  const MOTHER_HEALTH_MULT = 3.5; // Big encounter health pool relative to the ordinary Tzatzul.
  const MOTHER_DAMAGE_MULT = 1.6; // The indoor dive uses the same body hit logic with stronger existing knockback.
  const rooms = new Map(); // Cave map -> one persisted in-session mother/hatchling encounter, never duplicated on re-entry.
  const owned = new Set(); // Flight-ownership adapter for game.js's canonical ground AI bypass.
  let deps = null; // WildlifeSpawn's existing creature factory, player, and hostile collections.
  let lastArea = null; // Only area changes trigger global-perch registry maintenance.
  const stats = { spawned: 0, completed: 0, dives: 0, wallHits: 0, spikeHits: 0,
    lastImpact: null, lastError: null }; // Serialized mobile diagnostics, no retained mesh snapshots.
  const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const tile = () => Math.max(1, finite(deps?.TILE, 64));
  const healthy = actor => !!actor && actor.health > 0;
  const within = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
  function spawn(mapId) {
    const interior = window.TzatzulNestInterior, flight = window.TzatzulFlightRuntime;
    const plan = interior?.getArena?.(mapId);
    if (!deps?.makeCreatureEntity || !deps?.hostileObjects || !plan || !flight?.beginNestDive) return null;
    const support = interior.ensurePerches(mapId, tile()); // Exactly once per encounter; point supports reuse the shared global system.
    if (support.length < 2) return null;
    const appearance = window.TzatzulRegistration?.identityFor?.(plan.zoneId, plan.slot);
    if (!appearance) return null;
    const first = support[0];
    const mother = deps.makeCreatureEntity('tzatzul', first.x, first.y, {
      homeX: first.x, homeY: first.y, state: 'idle', streamVisuals: true,
      wildlifeRole: 'predator', tzatzulNestCave: mapId, isBoss: true,
    });
    if (!mother) return null;
    const baseline = Math.max(80, finite(mother.maxHealth, finite(mother.health, 100)));
    mother.maxHealth = Math.max(300, baseline * MOTHER_HEALTH_MULT);
    mother.health = mother.maxHealth;
    mother.def = { ...(mother.def || {}), attackDamage: Math.ceil(Math.max(24, finite(mother.def?.attackDamage, 24)) * MOTHER_DAMAGE_MULT) };
    mother.areaId = mapId;
    mother.tzatzulIdentity = appearance;
    mother.tzatzulFlightPose = 'perched';
    mother._tzNestMother = true; // Gameplay knockback and enemy ground-path skipping use this single marker.
    mother._tzFlight = { identity: appearance, roostId: first.id, roost: first,
      phase: 'perched', elapsed: 0, rest: REST_S, target: null,
      segment: null, struck: false, captive: null };
    if (!window.PerchSupport?.attach?.(mother, first)) return null;
    deps.hostileObjects.add(mother);
    owned.add(mother);
    const hatchlings = []; // Real living adds use their registered foot-hinged peck attack, not decorative PNG clones.
    for (const child of plan.hatchlings || []) {
      const x = (finite(child.col) + .5) * tile(), y = (finite(child.row) + .5) * tile();
      const hatchling = deps.makeCreatureEntity('tzatzul-hatchling', x, y, {
        homeX: x, homeY: y, state: 'idle', streamVisuals: true,
        tzatzulNestCave: mapId, wildlifeRole: 'predator',
      });
      if (!hatchling) continue;
      hatchling.areaId = mapId;
      hatchling.tzatzulIdentity = window.TzatzulRegistration?.identityFor?.(plan.zoneId, plan.slot, appearance);
      hatchling.tzatzulMother = mother;
      deps.hostileObjects.add(hatchling);
      hatchlings.push(hatchling);
    }
    const session = { mapId, plan, mother, hatchlings, supports: support,
      floorY: finite(interior.getFloorY?.(mapId)), // Cave wall and stone spike collisions use the renderer's own carved floor elevation.
      perchIndex: 0, completed: false, lastPhase: 'perched', lastEvent: 'mother roosted' };
    rooms.set(mapId, session);
    stats.spawned++;
    window.__farmLog?.('[tzatzul] mother and ' + hatchlings.length + ' hatchlings roosted in ' + mapId,'wildlife');
    return session;
  }
  function init(injected) {
    deps = injected; // Reuse the world data; no new RAF, map, timer, or creature factory.
    for (const old of owned) {
      old._tzNestMother = false;
      if (old._tzFlight?.captive) window.TzatzulFlightRuntime?.__test?.releaseCaptive?.(old._tzFlight.captive,'nest reset');
    }
    owned.clear(); rooms.clear(); lastArea = null;
  }
  function owns(bird) { return owned.has(bird) && !!bird._tzNestMother && healthy(bird); }
  function ensure(mapId = deps?.getCurrentArea?.()) {
    if (!window.TzatzulNestInterior?.isNestMap?.(mapId)) return null;
    const existing = rooms.get(mapId);
    if (existing) return existing;
    return spawn(mapId);
  }
  function impactDamage(target, amount) {
    const before = Math.max(0, finite(target.health));
    const attack = window.Combat?.deps?.damageCreature;
    if (typeof attack === 'function') attack(target, amount, target.x, target.y, 0,
      { tag: 'blunt', attacker: null, environmentalImpact: true });
    else if (typeof window.ResourceSystem?.applyDamage === 'function')
      window.ResourceSystem.applyDamage(target, amount, { tag: 'blunt', source: 'tzatzul nest wall impact' });
    else target.health = Math.max(0, before - amount);
    const after = Math.max(0, finite(target.health));
    return { applied: Math.min(before, before - after), lethal: before > 0 && after <= 0 };
  }
  function nearestObstacle(map, start, end, birdHalf) {
    const plan = map.plan, foot = finite(birdHalf?.y, .55);
    let best = null, bestT = Infinity;
    const check = (tileX, tileZ, hazard) => {
      // Closest point to one compact obstacle on this frame's swept body
      // path. Fast dives cannot skip the sharp stone clusters.
      const dx = end.x - start.x, dz = end.z - start.z, len = dx*dx + dz*dz;
      const t = len > 1e-9 ? within(((tileX-start.x)*dx + (tileZ-start.z)*dz)/len,0,1) : 0;
      const x = start.x+dx*t, z=start.z+dz*t, y=start.y+(end.y-start.y)*t;
      const radius = hazard ? .80 : .77; // Invisible 1x1 stone supports and roughly 0.7 radius rock pillars.
      const height = hazard ? 1.30 : 2.4;
      if (Math.hypot(x-tileX,z-tileZ) > radius + .22 || y-foot > height + map.floorY) return;
      if (t < bestT) { bestT = t; best = { kind: hazard ? 'sharp-spikes' : 'stone-rock', t }; }
    };
    for (const spike of plan.stoneSpikeClusters || []) check(finite(spike.col)+.5,finite(spike.row)+.5,true);
    for (const rock of plan.wallPerches || []) check(finite(rock.col)+.5,finite(rock.row)+.5,false);
    const center = plan.arenaCenter || {};
    const endRadius = Math.hypot(end.x-(finite(center.col)+.5),end.z-(finite(center.row)+.5));
    const allowed = Math.max(3,finite(plan.arenaRadiusTiles,10)-.55);
    if (endRadius > allowed && end.y-foot <= map.floorY + 2.2) {
      const radial = { kind:'cave-wall', t: 1 };
      if (!best || bestT > radial.t) best = radial;
    }
    return best;
  }
  function resolveTerrainImpact(bird, previous, current, segment) {
    const map = rooms.get(bird?.areaId);
    if (!map || map.mother !== bird || bird._tzFlight?.phase !== 'swoop' ||
        !segment || bird.branchT < .20) return false; // Leaving the departure perch never counts as running into it.
    const obstacle = nearestObstacle(map, previous, current, segment.half);
    if (!obstacle) return false;
    const from = segment.from || { x: bird.x, y: bird.y, worldY: bird.branchSurfaceY };
    const to = segment.to || from;
    const intended = Math.hypot(to.x-from.x,to.y-from.y,(to.worldY-from.worldY)*tile());
    const traveled = Math.hypot(bird.x-from.x,bird.y-from.y,(bird.branchSurfaceY-from.worldY)*tile());
    const movement = { airborne:true,lungeMaxDistancePx:intended,lungeTraveledPx:traveled };
    const sharp = obstacle.kind === 'sharp-spikes';
    const impact = window.KnockbackCollisionImpact?.resolveAerialLunge?.(bird,movement,{
      kind:'stone',bladedHazard:sharp,label:sharp?'Sharp nest stalagmites':'Tzatzul nest rock wall'
    },tile(),{dealHealthDamage:impactDamage});
    if (!impact) return false; // Full travel or a harmless contact cannot double damage a bird.
    if (sharp) stats.spikeHits++; else stats.wallHits++;
    stats.lastImpact = { kind:obstacle.kind,deficitTiles:impact.deficitTiles,
      health:finite(bird.health),perchIndex:map.perchIndex };
    map.lastEvent = sharp?'mother struck sharp stalagmites':'mother struck the cave wall';
    window.__farmLog?.('[tzatzul] '+map.lastEvent,'combat');
    return true;
  }
  function update(dt) {
    const area = deps?.getCurrentArea?.();
    if (area !== lastArea) {
      window.TzatzulNestInterior?.releaseInactive?.(area);
      lastArea = area;
    }
    if (!window.TzatzulNestInterior?.isNestMap?.(area)) return;
    const session = ensure(area);
    if (!session || session.completed) return;
    const mother = session.mother, state = mother?._tzFlight;
    if (!healthy(mother) || !deps.hostileObjects.has(mother)) {
      session.completed = true; owned.delete(mother); stats.completed++;
      return; // Mother remains dead until a proper cave turnover/save rule is added.
    }
    if (!state || !healthy(deps.player)) return;
    const step = within(finite(dt), 0, .1);
    if (state.phase !== 'perched') {
      const before = state.phase;
      window.TzatzulFlightRuntime?.advanceNestFlight?.(mother,step); // Same swept BODY hit implementation as exterior Tzatzuls.
      if (before === 'return' && state.phase === 'perched') {
        state.rest = REST_S;
        state.elapsed = 0;
      }
      return;
    }
    state.elapsed += step;
    if (state.elapsed < state.rest) return;
    // Always choose a *different* far-side perch before diving; the normal
    // flight return then continues beyond the player without turning around.
    session.perchIndex = (session.perchIndex + Math.max(1,Math.floor(session.supports.length/2)))%session.supports.length;
    state.roost = session.supports[session.perchIndex]; // The far-side perch is the return/landing objective.
    state.roostId = state.roost.id;
    if (window.TzatzulFlightRuntime?.beginNestDive?.(mother,deps.player)) {
      session.lastEvent = 'mother dived toward the player';
      stats.dives++;
    } else { state.elapsed=0; state.rest=REST_S; }
  }
  function debugSnapshot() {
    return { ...stats, area:lastArea, encounters:[...rooms.values()].map(room => ({
      mapId:room.mapId, motherHealth:finite(room.mother?.health), motherAlive:healthy(room.mother),
      hatchlingsAlive:room.hatchlings.filter(healthy).length,
      phase:room.mother?._tzFlight?.phase || null, perchIndex:room.perchIndex,
      complete:room.completed, lastEvent:room.lastEvent,
    })) };
  }
  window.TzatzulNestEncounter=Object.freeze({init,update,owns,ensure,resolveTerrainImpact,debugSnapshot,
    __test:Object.freeze({nearestObstacle,impactDamage})});
})();
