// Shared wildlife food web: dietary targets, resource-site foraging, and food defense.
// Dietary relationships are directional. A hunted animal can fight back without
// being marked as a predator, and a berry-eater can defend food without hunting.
(() => {
  'use strict';

  const PROFILES = Object.freeze({
    nelk: Object.freeze({ hunts: ['puktuk'], huntRadiusTiles: 13 }),
    puktuk: Object.freeze({ forage: 'burrow', particles: 'snow', fightBackAgainst: ['nelk'] }),
    nazgraku: Object.freeze({ forage: 'berry-tuber', particles: 'dirt', guardFood: true }),
  }); // Species-driven food/defense declarations; future species add rules here, not diet enums.
  const BOLT_MIN_TILES = 1.2; // Used by forage destination generation.
  const BOLT_MAX_TILES = 3.1; // Used to vary successive short sprints.
  const DIVE_SECONDS = 0.5; // Same duration as the Grehlr burrow's first/dive phase.
  const REVERSE_SECONDS = 0.43; // Reverses the dive pose; never uses Grehlr emergence.
  const CHEW_MIN_SECONDS = 1.7; // Used for rapid head bob separated by irregular pauses.
  const CHEW_MAX_SECONDS = 3.2; // Upper randomized chew duration.
  const GUARD_RADIUS_TILES = 2.8; // Creature/player entry distance from a food spot that triggers defense.
  const GUARD_RELEASE_TILES = 4.4; // Hysteresis so intruders can leave without perpetual aggro.
  const GUARD_TICK_SECONDS = 0.35; // Bounded per-actor local animal/player perception interval.
  const HUNT_TICK_SECONDS = 0.85; // Predator checks don't perform full actor scans per animation frame.
  const MAX_BURST = 14; // Shared low-poly spray budget per digging stroke, only when visible.
  const MAX_PARTICLES = 200; // Global cap across every wildlife animal, including overlapping groups.

  const debug = { hunting: 0, defensive: 0, bolting: 0, digging: 0, chewing: 0, last: '', particles: 0 }; // Mobile-readable live state snapshots.
  const particles = []; // Tracks world-space snow/dirt clods independently of any creature's streamed avatar lifetime.
  const materials = new Map(); // One material per snow/dirt subtype, shared by every burst.
  let geometry = null; // Shared tetrahedron geometry for every lightweight dig particle.
  const npcProxies = new WeakMap(); // Keeps ordinary walker targets stable when they are close to a guarded site.

  function rng() { return window.GameRandom?.random?.() ?? Math.random(); }
  function kindOf(c) { return window.CreatureGenetics?.SPECIES_ALIAS?.[c?.creatureKey] || c?.creatureKey || ''; }
  function profile(c) { return PROFILES[kindOf(c)] || null; }
  function available(c) {
    return !!c && c.health > 0 && !c.isCompanion && !c._denHidden && !c._animalSleeping &&
      !c.prone && !(c.knockbackT > 0) && !c.combatTutorialTarget && !c.combatTutorialPreview;
  }
  function combatBusy(c) {
    return c.state === 'chase' || c.state === 'patrol-chase' || c.state === 'return' ||
      c.state === 'searching' || c.state === 'fleeing-low-health' ||
      !!window.Combat?.animalAttacks?.isBusy?.(c) || !!window.Combat?.telegraph?.isBusy?.(c);
  }
  function stateFor(c) {
    return c._foodWeb || (c._foodWeb = {
      phase: 'rest', t: rng() * 1.9, destination: null, spot: null, berry: null,
      cycles: 0, guardTarget: null, nextGuardScanS: 0, nextHuntScanS: rng() * HUNT_TICK_SECONDS,
      lastVisual: null,
    }); // Per-animal state: no global timeout/interval, and no shared-forager animation lockstep.
  }
  function near(a, b, d) { return Math.hypot(a.x - b.x, a.y - b.y) <= d; }
  function pxSpot(col, row, tile) { return { x: (col + 0.5) * tile, y: (row + 0.5) * tile, col, row }; }
  function clearSpot(c, state) {
    if (state.berry) state.berry.reserved = false; // Release shared bush claims on interruptions, death, or completion.
    state.berry = null;
    state.spot = null;
    state.destination = null;
  }
  function safeTile(c, tile, canOccupyAt, radiusTiles = BOLT_MAX_TILES) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const angle = rng() * Math.PI * 2;
      const radius = BOLT_MIN_TILES + rng() * (radiusTiles - BOLT_MIN_TILES);
      const col = Math.floor(c.x / tile + Math.cos(angle) * radius);
      const row = Math.floor(c.y / tile + Math.sin(angle) * radius);
      const point = pxSpot(col, row, tile);
      if (canOccupyAt(point.x, point.y, tile * 0.3)) return point;
    }
    return pxSpot(Math.floor(c.x / tile), Math.floor(c.y / tile), tile); // Never teleport or force motion through a cliff.
  }
  function ensureFoodSpot(c, state, ctx) {
    if (state.spot) return state.spot;
    if (kindOf(c) === 'nazgraku') {
      const berry = window.WildBerries?.nearestAvailableBerry?.(ctx.zoneId, c.x / ctx.tile, c.y / ctx.tile);
      if (berry && Math.hypot(berry.col - c.x / ctx.tile, berry.row - c.y / ctx.tile) <= 11) {
        berry.reserved = true;
        state.berry = berry;
        state.spot = { ...pxSpot(berry.col, berry.row, ctx.tile), kind: 'berry' };
      } else {
        state.spot = { ...safeTile(c, ctx.tile, ctx.canOccupyAt, 5), kind: 'tuber' }; // Invisible per-animal buried-food tile, no artificial plant mesh.
      }
    } else {
      state.spot = { ...safeTile(c, ctx.tile, ctx.canOccupyAt), kind: 'burrow' };
    }
    return state.spot;
  }
  function scanPrey(c, actors, tile) {
    const rule = profile(c);
    if (!rule?.hunts?.length) return null;
    const maxD2 = (rule.huntRadiusTiles * tile) ** 2;
    let chosen = null, best = maxD2;
    for (const other of actors) {
      if (other === c || !available(other) || other.areaId !== c.areaId ||
          other.state === 'fleeing-low-health' || other._fleeCooldownUntil > performance.now() ||
          !rule.hunts.includes(kindOf(other))) continue;
      const dx = c.x - other.x, dy = c.y - other.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < best) { best = d2; chosen = other; }
    }
    return chosen;
  }
  function npcProxy(walker, area, tile) {
    let proxy = npcProxies.get(walker);
    if (!proxy) {
      proxy = {
        isNpcWalker: true, walker, health: 1, maxHealth: 1,
        get x() { return walker.root?.position?.x * tile; },
        get y() { return walker.root?.position?.z * tile; },
        get areaId() { return walker.area; },
      }; // Existing NPC walkers have no creature Health/resources; use a nonlethal approach/repel target.
      npcProxies.set(walker, proxy);
    }
    return proxy;
  }
  function scanGuardThreat(c, actors, players, walkers, ctx) {
    const s = stateFor(c), spot = ensureFoodSpot(c, s, ctx), radius = ctx.tile * GUARD_RADIUS_TILES;
    if (!spot) return null;
    let best = null, bestD2 = radius * radius;
    const candidates = [...players, ...actors]; // Local proximity checked only at the 350ms guard cadence.
    for (const other of candidates) {
      if (!other || other === c || other.isCompanion || other.health <= 0 ||
          (other.creatureKey && kindOf(other) === kindOf(c)) ||
          (other.areaId != null && other.areaId !== c.areaId) ||
          !Number.isFinite(other.x) || !Number.isFinite(other.y)) continue;
      const dx = spot.x - other.x, dy = spot.y - other.y, dist2 = dx * dx + dy * dy;
      if (dist2 < bestD2) { best = other; bestD2 = dist2; }
    }
    // Non-combat NPC walkers are approached/repelled without inventing a creature Health pool.
    for (const walker of walkers || []) {
      if (walker.area !== ctx.zoneId || !walker.root?.position) continue;
      const candidate = npcProxy(walker, ctx.zoneId, ctx.tile);
      const dx = candidate.x - spot.x, dy = candidate.y - spot.y, dist2 = dx * dx + dy * dy;
      if (dist2 < bestD2) { best = candidate; bestD2 = dist2; }
    }
    return best;
  }
  function isPlayerTarget(target, players) { return players.includes(target) || target?.isPlayer === true; }
  function defend(c, target, players) {
    const state = stateFor(c);
    state.guardTarget = target;
    if (state.originalHomeX == null) { state.originalHomeX = c.homeX; state.originalHomeY = c.homeY; } // Guard leash follows the food site, not an unrelated herd den.
    c.homeX = state.spot.x; c.homeY = state.spot.y;
    if (isPlayerTarget(target, players)) {
      c.state = 'chase'; c.targetPlayer = target; c.targetCreature = null;
    } else {
      c.state = 'patrol-chase'; c.targetCreature = target; c.targetPlayer = null;
    }
    debug.defensive++;
    debug.last = kindOf(c) + ' defended ' + state.spot?.kind;
    window.__farmLog?.('[food-web] ' + debug.last, 'wildlife');
  }
  function updateThreats(c, dt, actors, players, walkers, ctx) {
    if (!available(c) || !profile(c)) return;
    const state = stateFor(c), food = profile(c);
    if (food.guardFood) {
      const guard = state.guardTarget, spot = state.spot;
      const stillNear = guard && spot && guard.health > 0 && guard.areaId !== '__gone__' &&
        (!guard.areaId || guard.areaId === c.areaId) &&
        Number.isFinite(guard.x) && Number.isFinite(guard.y) &&
        near(spot, guard, ctx.tile * GUARD_RELEASE_TILES);
      if (guard && !stillNear) {
        state.guardTarget = null;
        if (state.originalHomeX != null) { c.homeX = state.originalHomeX; c.homeY = state.originalHomeY; state.originalHomeX = null; state.originalHomeY = null; }
        c.targetCreature = null; c.targetPlayer = null;
        c.state = 'idle'; // Disengage on departure; do not chase a non-hunting animal across its biome.
      }
      if (stillNear) {
        if (c.state !== 'fleeing-low-health' && !c.prone) {
          if (isPlayerTarget(guard, players)) { c.state = 'chase'; c.targetPlayer = guard; }
          else { c.state = 'patrol-chase'; c.targetCreature = guard; }
        }
        return;
      }
      if (combatBusy(c) && !state.guardTarget) return;
      state.nextGuardScanS -= dt;
      if (state.nextGuardScanS <= 0) {
        state.nextGuardScanS = GUARD_TICK_SECONDS;
        const intruder = scanGuardThreat(c, actors, players, walkers, ctx);
        if (intruder) defend(c, intruder, players);
      }
      return;
    }
    if (!food.hunts?.length || combatBusy(c) || c._fleeCooldownUntil > performance.now()) return;
    state.nextHuntScanS -= dt;
    if (state.nextHuntScanS > 0) return;
    state.nextHuntScanS = HUNT_TICK_SECONDS;
    const prey = scanPrey(c, actors, ctx.tile);
    if (prey) {
      c.state = 'patrol-chase';
      c.targetCreature = prey;
      state.phase = 'rest';
      state.t = 0;
      debug.hunting++;
      debug.last = kindOf(c) + ' hunting ' + kindOf(prey);
      window.__farmLog?.('[food-web] ' + debug.last, 'wildlife');
    }
  }
  function onSkirmishHit(attacker, target) {
    if (!target || !attacker || target.health <= 0) return;
    const counter = profile(target)?.fightBackAgainst;
    if (!counter?.includes(kindOf(attacker)) || target.health / (target.maxHealth || 1) <= 0.3) return;
    target._animalSleeping = false;
    target.state = 'patrol-chase';
    target.targetCreature = attacker; // Defending does not make Puktuk hunt unprovoked.
    const state = stateFor(target);
    state.phase = 'rest';
    state.t = 0;
    debug.defensive++;
    debug.last = 'puktuk retaliated against ' + kindOf(attacker);
    window.__farmLog?.('[food-web] ' + debug.last, 'wildlife');
  }
  function isDefending(c) { return !!stateForIfPresent(c)?.guardTarget; }
  function stateForIfPresent(c) { return c?._foodWeb; }
  function stepPhase(state, phase, duration) { state.phase = phase; state.t = 0; state.duration = duration; }

  function tickForage(c, dt, ctx) {
    const rule = profile(c);
    if (!rule?.forage || !available(c) || combatBusy(c) ||
      (c.denKey && (window.Music?.isNightTime?.() || window.HobunjiCloudForestWildlife?.isPackOffShift?.(c))) ||
      (c.herdKey && window.Music?.isNightTime?.())) {
      if (c?._foodWeb?.phase && c._foodWeb.phase !== 'rest') cancelForage(c);
      return null;
    }
    const state = stateFor(c), tile = ctx.tile;
    if (state.phase === 'rest') {
      state.t -= dt;
      if (state.t > 0) return { handled: true, moving: false, aimAngle: c.facing || 0 }; // Pause on site rather than falling into unrelated grazing/pathing mid-cycle.
      const spot = ensureFoodSpot(c, state, ctx);
      state.destination = rule.forage === 'burrow' ? safeTile(c, tile, ctx.canOccupyAt) : spot;
      stepPhase(state, 'bolt', 2.3);
      debug.bolting++;
    }
    if (state.phase === 'bolt') {
      state.t += dt;
      const target = state.destination;
      const arrived = near(c, target, tile * 0.38);
      if (!arrived && state.t < state.duration) {
        const moving = ctx.moveCreatureToward(c, target.x, target.y, (c.def.chaseSpeed || c.def.moveSpeed) * 1.28, dt);
        c.state = 'foraging-bolt';
        return { handled: true, moving, aimAngle: Math.atan2(target.y - c.y, target.x - c.x) };
      }
      stepPhase(state, 'dive', DIVE_SECONDS);
      c.state = 'foraging-dig';
      emitDig(c, rule.particles, tile); // Snow clods in Western Slope, dirt clods around northern buried tubers.
      debug.digging++;
    }
    if (state.phase === 'dive') {
      state.t = Math.min(state.duration, state.t + dt);
      if (state.t >= state.duration) stepPhase(state, 'reverse', REVERSE_SECONDS);
    } else if (state.phase === 'reverse') {
      state.t = Math.min(state.duration, state.t + dt);
      if (state.t >= state.duration) {
        c.scaleY = 1;
        stepPhase(state, 'chew', CHEW_MIN_SECONDS + rng() * (CHEW_MAX_SECONDS - CHEW_MIN_SECONDS));
        debug.chewing++; // Counts the distinct chew stage rather than every head-nod animation frame.
      }
    } else if (state.phase === 'chew') {
      state.t += dt;
      if (state.t >= state.duration) {
        if (state.berry) {
          window.WildBerries?.removeBerryBush?.(ctx.zoneId, state.berry.col, state.berry.row);
        }
        if (rule.forage === 'berry-tuber') clearSpot(c, state);
        state.cycles++;
        stepPhase(state, 'rest', 0.45 + rng() * 1.15); // Independent pauses make neighboring diggers look less synchronized.
        state.t = state.duration;
      }
    }
    c.state = state.phase === 'chew' ? 'foraging-chew' : 'foraging-dig';
    return { handled: true, moving: false, aimAngle: c.facing || 0 };
  }
  function cancelForage(c) {
    const state = stateForIfPresent(c);
    if (!state) return;
    state.phase = 'rest'; state.t = 0.8 + rng();
    c.scaleY = 1;
    const front = c.avatarRef?.frontPlane, back = c.avatarRef?.backPlane;
    if (front) front.rotation.x = 0;
    if (back) back.rotation.x = 0;
    if (!profile(c)?.guardFood) clearSpot(c, state);
  }
  function abandon(c) {
    const s = stateForIfPresent(c);
    if (!s) return;
    clearSpot(c, s);
    s.guardTarget = null;
    if (s.originalHomeX != null) { c.homeX = s.originalHomeX; c.homeY = s.originalHomeY; s.originalHomeX = null; s.originalHomeY = null; }
    cancelForage(c);
  }
  function applyPose(c, dt) {
    const s = stateForIfPresent(c);
    if (!s || c._wildlifeVisualsReleased) return false;
    if (s.phase === 'dive' || s.phase === 'reverse') {
      const progress = s.phase === 'dive' ? s.t / DIVE_SECONDS : 1 - s.t / REVERSE_SECONDS;
      if (window.HobunjiGrehlrBurrow?.applyForagingDivePose) window.HobunjiGrehlrBurrow.applyForagingDivePose(c, progress);
      else {
        const eased = 1 - Math.pow(1 - Math.max(0, Math.min(1, progress)), 3);
        const pitch = 66 * Math.PI / 180 * eased; // Exact fallback to Grehlr first-phase tilt if its lazy attack module has not loaded.
        if (c.avatarRef.frontPlane) c.avatarRef.frontPlane.rotation.x = pitch;
        if (c.avatarRef.backPlane) c.avatarRef.backPlane.rotation.x = pitch;
        c.scaleY = 1 - 0.94 * eased;
      }
      return true;
    }
    if (s.phase === 'chew') {
      // Irregular double-bob and pause pattern; positive pitch points the head down.
      const period = (s.t + (s.cycles % 3) * 0.13) % 0.88;
      const down = period < 0.16 ? Math.sin(Math.PI * period / 0.16) * 23
        : period < 0.34 ? 0 : period < 0.52 ? Math.sin(Math.PI * (period - 0.34) / 0.18) * 16 : 0;
      c.avatarRef?.updateHeadRotation?.((c.avatarRef?.headRig?.rig?.restDeg || 0) + down, dt);
      return true;
    }
    return false;
  }
  function materialFor(type) {
    const THREE = window.THREE;
    if (!THREE) return null;
    if (!geometry) geometry = new THREE.TetrahedronGeometry(0.11, 0); // Same four-face silhouette as Grehlr's dirt spray.
    if (materials.has(type)) return materials.get(type);
    const color = type === 'snow' ? 0xffffff : 0x423d35;
    const material = new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true }); // Shared with all particles of this substrate.
    materials.set(type, material);
    if (THREE.TextureLoader) {
      new THREE.TextureLoader().load('assets/textures/canvas.png', loaded => {
        let texture = loaded; // Matches Grehlr dirt and Western Slope snow's authored canvas texture.
        const rgb = window.parseHexColor?.(type === 'snow' ? '#ffffff' : '#423d35');
        if (rgb && window.getShadeFillCanvas && window.getPortraitTintingConfig && THREE.CanvasTexture) {
          const image = window.getShadeFillCanvas(loaded.image, 'food-web|' + type, {
            mode: 'shadeFill', rgb: [rgb.r, rgb.g, rgb.b], options: window.getPortraitTintingConfig(),
          });
          texture = new THREE.CanvasTexture(image);
          material.color.set(0xffffff);
        }
        material.map = texture;
        material.needsUpdate = true;
      }, undefined, () => {});
    }
    return material;
  }
  function emitDig(c, substrate, tile) {
    const group = c.avatarRef?.group, parent = group?.parent;
    if (!group || !parent || c._wildlifeVisualsReleased || particles.length >= MAX_PARTICLES) return;
    const THREE = window.THREE, material = materialFor(substrate);
    if (!THREE || !material) return;
    const surface = group.position.y - (c.groundLift || c.halfHeight || 0.5) + (substrate === 'snow' ? 0.23 : 0); // Raised Western snow cap is 0.22 world units above normal terrain. // Particle origin stays on the real terrain, not the actor's sinking plane center.
    for (let i = 0; i < MAX_BURST && particles.length < MAX_PARTICLES; i++) {
      const angle = rng() * Math.PI * 2, speed = 0.3 + rng() * 1.0;
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(c.x / tile + Math.cos(angle) * 0.15, surface + 0.04, c.y / tile + Math.sin(angle) * 0.15);
      mesh.scale.setScalar(0.6 + rng() * 1.2);
      parent.add(mesh);
      particles.push({ mesh, vx: Math.cos(angle) * speed, vz: Math.sin(angle) * speed, vy: 0.6 + rng() * 1.6, life: 0.48 + rng() * 0.45 }); // Shared simulation cleans all clods even when the owner despawns.
    }
    debug.particles = particles.length;
  }
  function tickParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      p.vy -= dt * 3.8;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.z += p.vz * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.rotation.x += dt * 4;
      if (p.life <= 0 || !p.mesh.parent) {
        p.mesh.parent?.remove(p.mesh);
        particles.splice(i, 1);
      }
    }
    debug.particles = particles.length;
  }
  function npcWalkerStrike(attacker, target) {
    // Ordinary NPC walkers lack Health/Combat resources. This records an actual
    // defended confrontation without assigning fabricated health or killing an NPC.
    const walker = target?.walker;
    if (!walker) return false;
    walker._wildlifeThreatUntil = performance.now() + 2500;
    walker._wildlifeThreatSource = { x: attacker.x, y: attacker.y }; // Walker's normal pathing update steers away from this bite source. // Exposed for NPC scheduling/flight behavior to consume in a later combat-aware update.
    debug.last = 'nazgraku confronted NPC ' + (walker.rec?.id || 'walker');
    return true;
  }

  window.WildlifeFoodWeb = Object.freeze({
    PROFILES, profile, kindOf, updateThreats, tickForage, applyPose,
    onSkirmishHit, isDefending, cancelForage, abandon, tickParticles,
    npcWalkerStrike, getDebug: () => ({ ...debug }),
  });
})();
