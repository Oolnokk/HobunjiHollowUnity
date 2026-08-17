// Grehlr-only burrow + emerge attack.
// Registers into Combat.animalAttacks without changing the shared pounce implementation.
(() => {
  'use strict';

  const attacks = window.Combat?.animalAttacks; // Used to register and route the Grehlr-specific named attack.
  if (!attacks?.register) {
    console.error('combat-grehlr-burrow.js requires combat-animal-attacks.js to load first');
    return;
  }

  const DEFAULTS = Object.freeze({ // Used as safe tuning when attack-values.json is unavailable or incomplete.
    DIVE_S: 0.5,
    BURROW_MIN_S: 3,
    BURROW_MAX_S: 8,
    TELEGRAPH_S: 2,
    EMERGE_S: 0.5,
    HIDDEN_SCALE_Y: 0.06,
    DIVE_TILT_DEG: 66,
    BURROW_SPEED_MULTIPLIER: 1.2,
    MIN_RADIUS_TILES: 1.35,
    MODEL_RADIUS_MULTIPLIER: 0.55,
    DAMAGE_MULTIPLIER: 2.5,
    KNOCKBACK_PX_S: 980,
    SELF_FOOTING_DRAIN_FRACTION: 0.8,
    SELF_STAMINA_DRAIN_FRACTION: 0.9,
    TRAIL_PARTICLES_PER_S: 24,
    TELEGRAPH_PARTICLES_PER_S: 34,
    INITIAL_RING_PARTICLES: 28,
    DIVE_BURST_PARTICLES: 18,
    BURROW_BURST_PARTICLES: 24,
    EMERGE_BURST_PARTICLES: 42,
  });

  const tuning = { ...DEFAULTS }; // Used by every attack phase and refreshed from authored combat configuration.
  let dirtGeometry = null; // Shared by all dirt clods so particles do not allocate geometry individually.
  let dirtMaterial = null; // Shared by all dirt clods so particles do not allocate material individually.

  function clamp01(value) {
    return Math.max(0, Math.min(1, value));
  }

  function easeOutCubic(value) {
    const t = clamp01(value); // Used to keep dive/emerge interpolation bounded.
    return 1 - Math.pow(1 - t, 3);
  }

  function gameplayRandom() {
    const random = window.GameRandom?.random; // Used for gameplay-relevant random burrow timing.
    return typeof random === 'function' ? random() : Math.random();
  }

  function isGrehlr(creature) {
    const key = creature?.creatureKey; // Used to identify authored Grehlr species without relying only on labels.
    const label = creature?.def?.label; // Used as a fallback for older/runtime-created creature objects.
    return key === 'grehlr' || key === 'grehlr-den-mother' || label === 'Grehlr' || label === 'Grehlr Den-Mother';
  }

  function targetKindFor(creature, target, deps) {
    const players = deps.players || (deps.player ? [deps.player] : []); // Used to match the same explicit player references the working pounce attack gathers.
    if (target === deps.player || players.includes(target) || target?.isPlayer === true) return 'player';

    const looksLikeCreature = !!(target?.def || target?.creatureKey || target?.isCompanion || target?.isBandit); // Used to recognize companion/hostile targets without relying on areaId alone.
    if (looksLikeCreature) return 'creature';

    // Hostile creature AI aims its named attack at the player. Some runtime
    // target adapters are position/resource proxies rather than the exact
    // object stored in deps.players, so object identity is not a safe final
    // test. A companion attacks creatures; a hostile's otherwise-untyped
    // target is therefore the player, matching the shared pounce behavior.
    return creature.isCompanion ? 'creature' : 'player';
  }

  function targetStatus(creature, state) {
    const target = state.target; // Used as the attack's original target throughout burrow tracking and eruption resolution.
    if (!target) return { valid: false, reason: 'missing target' };
    if (!Number.isFinite(target.x) || !Number.isFinite(target.y)) return { valid: false, reason: 'missing position' };
    if (Number.isFinite(target.health) && target.health <= 0) return { valid: false, reason: 'dead' };
    if (state.targetKind === 'player') return { valid: true, reason: 'player' };

    // Creature targets still need to be in the Grehlr's area. Missing area
    // metadata is treated as valid instead of manufacturing a false miss;
    // the attack was already explicitly aimed at this object by the AI.
    const hasBothAreas = target.areaId != null && creature.areaId != null; // Used to avoid rejecting valid ad-hoc creature targets that omit area metadata.
    if (hasBothAreas && target.areaId !== creature.areaId) return { valid: false, reason: 'different area' };
    return { valid: true, reason: 'creature' };
  }

  function ensureDirtAssets() {
    const THREE = window.THREE; // Used to lazily build low-poly dirt particle rendering assets.
    if (!THREE) return null;
    // A tetrahedron is the minimum closed 3D polyhedron: exactly four
    // triangles. The previous detail-0 icosahedron used 20 triangles per
    // clod, five times as many faces with no useful silhouette gain at this
    // particle size. Random scale/rotation in spawnDirt keeps four-face clods
    // from looking cloned.
    if (!dirtGeometry) dirtGeometry = new THREE.TetrahedronGeometry(0.11, 0);
    if (!dirtMaterial) dirtMaterial = new THREE.MeshStandardMaterial({ color: 0x654127, roughness: 1, metalness: 0, flatShading: true });
    return THREE;
  }

  function particleParent(creature) {
    return creature.avatarRef?.group?.parent || null;
  }

  function groundWorldY(creature) {
    const groupY = creature.avatarRef?.group?.position?.y ?? 0; // Used to recover the terrain surface under the bottom-anchored creature sprite.
    const scaledHalfHeight = (creature.halfHeight || 0.5) * (creature.scaleY ?? 1); // Used to remove the current sprite half-height from its group center.
    return groupY - scaledHalfHeight;
  }

  function spawnDirt(creature, state, deps, xPx, yPx, options = {}) {
    const THREE = ensureDirtAssets(); // Used to create this low-poly clod only when Three.js exists.
    const parent = particleParent(creature); // Used to attach dirt to the creature's active world scene.
    if (!THREE || !parent || !deps.TILE) return;

    const angle = options.angle ?? Math.random() * Math.PI * 2; // Used for radial spawn position and horizontal launch direction.
    const radiusTiles = options.radiusTiles ?? 0.12; // Used as the nominal radial distance from the requested world point.
    const radiusJitterTiles = options.radiusJitterTiles ?? radiusTiles * 0.35; // Used to keep sprays/rings from looking mechanically uniform.
    const actualRadiusTiles = Math.max(0, radiusTiles + (Math.random() * 2 - 1) * radiusJitterTiles); // Used as this clod's final spawn radius.
    const minScale = options.scaleMin ?? 0.9; // Used as the smallest visual clod size for this effect.
    const maxScale = options.scaleMax ?? 1.8; // Used as the largest visual clod size for this effect.
    const scale = minScale + Math.random() * Math.max(0, maxScale - minScale); // Used as this clod's randomized visual size.
    const minHorizontal = options.horizontalSpeedMin ?? 0.25; // Used as the low end of outward clod velocity.
    const maxHorizontal = options.horizontalSpeedMax ?? 0.9; // Used as the high end of outward clod velocity.
    const horizontalSpeed = minHorizontal + Math.random() * Math.max(0, maxHorizontal - minHorizontal); // Used for this clod's outward velocity.
    const minUp = options.upSpeedMin ?? 0.7; // Used as the low end of the upward dirt launch.
    const maxUp = options.upSpeedMax ?? 1.7; // Used as the high end of the upward dirt launch.
    const upSpeed = minUp + Math.random() * Math.max(0, maxUp - minUp); // Used for this clod's popcorn-like vertical launch.
    const minLife = options.lifeMin ?? 0.45; // Used as the shortest time this clod remains active.
    const maxLife = options.lifeMax ?? 1.0; // Used as the longest time this clod remains active.
    const life = minLife + Math.random() * Math.max(0, maxLife - minLife); // Used as this clod's individual lifetime.
    const mesh = new THREE.Mesh(dirtGeometry, dirtMaterial); // Used as the visible dirt clod in the world scene.

    mesh.position.set(
      xPx / deps.TILE + Math.cos(angle) * actualRadiusTiles,
      groundWorldY(creature) + 0.03,
      yPx / deps.TILE + Math.sin(angle) * actualRadiusTiles,
    );
    mesh.scale.setScalar(scale);
    mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    parent.add(mesh);

    state.dirtParticles.push({
      mesh,
      vx: Math.cos(angle) * horizontalSpeed,
      vy: upSpeed,
      vz: Math.sin(angle) * horizontalSpeed,
      life,
    });
  }

  function updateDirt(state, dt) {
    const gravity = 3.8; // Used to pull launched dirt clods back down after each burst/pop.
    for (let index = state.dirtParticles.length - 1; index >= 0; index -= 1) {
      const particle = state.dirtParticles[index]; // Used to integrate and retire one active dirt clod.
      particle.life -= dt;
      particle.vy -= gravity * dt;
      particle.mesh.position.x += particle.vx * dt;
      particle.mesh.position.y += particle.vy * dt;
      particle.mesh.position.z += particle.vz * dt;
      particle.mesh.rotation.x += dt * 4;
      particle.mesh.rotation.z += dt * 3;
      if (particle.life <= 0) {
        particle.mesh.parent?.remove(particle.mesh);
        state.dirtParticles.splice(index, 1);
      }
    }
  }

  function clearDirt(state) {
    const particles = state.dirtParticles || []; // Used to remove every still-live attack-owned dirt clod during cleanup.
    for (const particle of particles) particle.mesh.parent?.remove(particle.mesh);
    state.dirtParticles = [];
  }

  function emitBurst(creature, state, deps, count, xPx = creature.x, yPx = creature.y) {
    for (let index = 0; index < count; index += 1) {
      spawnDirt(creature, state, deps, xPx, yPx, {
        radiusTiles: 0.3,
        radiusJitterTiles: 0.22,
        scaleMin: 1.2,
        scaleMax: 2.5,
        horizontalSpeedMin: 0.65,
        horizontalSpeedMax: 1.9,
        upSpeedMin: 0.95,
        upSpeedMax: 2.5,
        lifeMin: 0.6,
        lifeMax: 1.2,
      });
    }
  }

  function emitTrailPop(creature, state, deps) {
    spawnDirt(creature, state, deps, creature.x, creature.y, {
      radiusTiles: 0.24,
      radiusJitterTiles: 0.18,
      scaleMin: 1.15,
      scaleMax: 2.3,
      horizontalSpeedMin: 0.35,
      horizontalSpeedMax: 1.2,
      upSpeedMin: 0.85,
      upSpeedMax: 2.1,
      lifeMin: 0.5,
      lifeMax: 1.05,
    });
  }

  function emitTelegraphPop(creature, state, deps, angle) {
    const radialScale = 0.9 + Math.random() * 0.18; // Used to make the warning perimeter thick enough to read as a circle.
    const xPx = state.centerX + Math.cos(angle) * state.telegraphRadiusPx * radialScale; // Used as this perimeter eruption's world-pixel X origin.
    const yPx = state.centerY + Math.sin(angle) * state.telegraphRadiusPx * radialScale; // Used as this perimeter eruption's world-pixel Y origin.
    spawnDirt(creature, state, deps, xPx, yPx, {
      angle,
      radiusTiles: 0.035,
      radiusJitterTiles: 0.045,
      scaleMin: 1.1,
      scaleMax: 2.1,
      horizontalSpeedMin: 0.08,
      horizontalSpeedMax: 0.45,
      upSpeedMin: 0.95,
      upSpeedMax: 2.15,
      lifeMin: 0.5,
      lifeMax: 1.05,
    });
  }

  function setDivePose(creature, amount) {
    const pitch = -(tuning.DIVE_TILT_DEG * Math.PI / 180) * clamp01(amount); // Used as the temporary nose-down sprite-plane pitch.
    if (creature.avatarRef?.frontPlane) creature.avatarRef.frontPlane.rotation.x = pitch;
    if (creature.avatarRef?.backPlane) creature.avatarRef.backPlane.rotation.x = pitch;
  }

  function resetPose(creature) {
    creature.scaleY = 1;
    if (creature.avatarRef?.frontPlane) creature.avatarRef.frontPlane.rotation.x = 0;
    if (creature.avatarRef?.backPlane) creature.avatarRef.backPlane.rotation.x = 0;
  }

  function moveBurrowTowardTarget(creature, state, deps, dt) {
    const target = state.target; // Used as the moving underground pursuit target before the telegraph locks.
    if (!targetStatus(creature, state).valid) return;

    const dx = target.x - creature.x; // Used to aim underground travel on X.
    const dy = target.y - creature.y; // Used to aim underground travel on Y.
    const distance = Math.hypot(dx, dy); // Used to normalize travel and stop cleanly at the target.
    if (distance <= 1) return;

    const angle = Math.atan2(dy, dx); // Used to face and move the buried Grehlr toward its target.
    const speedPxS = Math.max(creature.def.chaseSpeed || 0, creature.def.moveSpeed || 0) * tuning.BURROW_SPEED_MULTIPLIER; // Used as hidden pursuit speed.
    const stepPx = Math.min(speedPxS * dt, distance); // Used as this frame's capped underground movement distance.
    const nextX = creature.x + Math.cos(angle) * stepPx; // Used as the preferred buried X position before collision checks.
    const nextY = creature.y + Math.sin(angle) * stepPx; // Used as the preferred buried Y position before collision checks.

    creature.facing = angle;
    if (deps.canOccupyAt?.(nextX, nextY, state.collideRadiusPx)) {
      creature.x = nextX;
      creature.y = nextY;
    } else if (deps.canOccupyAt?.(nextX, creature.y, state.collideRadiusPx)) {
      creature.x = nextX;
    } else if (deps.canOccupyAt?.(creature.x, nextY, state.collideRadiusPx)) {
      creature.y = nextY;
    }
  }

  function beginTelegraph(creature, state, deps) {
    const target = state.target; // Used to lock the dirt warning circle where the target is when the random burrow interval ends.
    const status = targetStatus(creature, state); // Used to fall back to the Grehlr's current location only when the original target is genuinely unusable.
    state.centerX = status.valid ? target.x : creature.x;
    state.centerY = status.valid ? target.y : creature.y;
    state.lastTargetStatus = status;
    state.stage = 'telegraph';
    state.t = 0;
    state.telegraphEmitCarry = 0;
    creature.x = state.centerX;
    creature.y = state.centerY;

    const ringCount = Math.max(8, Math.round(tuning.INITIAL_RING_PARTICLES)); // Used to seed an immediately readable full perimeter before continuous random pops.
    for (let index = 0; index < ringCount; index += 1) {
      const angle = (index / ringCount) * Math.PI * 2; // Used to evenly distribute the initial telegraph ring.
      emitTelegraphPop(creature, state, deps, angle);
    }
  }

  function applySelfExhaustion(creature) {
    const maxFooting = Number.isFinite(creature.maxFooting) ? creature.maxFooting : 100; // Used to convert the 80% self-footing cost into points.
    const currentFooting = Number.isFinite(creature.footing) ? creature.footing : maxFooting; // Used as the starting footing value for the raw self-drain.
    creature.footing = Math.max(0, currentFooting - maxFooting * tuning.SELF_FOOTING_DRAIN_FRACTION);

    const maxStamina = Number.isFinite(creature.maxStamina) ? creature.maxStamina : (creature.def.maxStamina || 0); // Used to convert the 90% immediate stamina cost into points.
    const staminaCost = maxStamina * tuning.SELF_STAMINA_DRAIN_FRACTION; // Used as the post-attack stamina spend through the shared resource rules.
    window.ResourceSystem?.spendStamina?.(creature, staminaCost, 'grehlr burrow exhaustion');
  }

  function resolveBite(creature, state, deps) {
    const target = state.target; // Used as the only actor the fixed telegraph can punish.
    const status = targetStatus(creature, state); // Used to reject only genuinely unusable targets instead of failing player identity/area checks.
    const distance = status.valid ? Math.hypot(target.x - state.centerX, target.y - state.centerY) : Infinity; // Used to decide whether the target escaped the warning circle.
    state.lastTargetStatus = status;
    state.lastDistancePx = distance;
    state.hit = status.valid && distance <= state.telegraphRadiusPx;
    state.damageAttempted = false;

    if (state.hit) {
      const biteAngle = distance > 1 ? Math.atan2(target.y - state.centerY, target.x - state.centerX) : creature.facing; // Used to give knockback a stable outward direction at/near circle center.
      const sourceX = state.centerX - Math.cos(biteAngle) * deps.TILE * 0.35; // Used as the bite's knockback source X.
      const sourceY = state.centerY - Math.sin(biteAngle) * deps.TILE * 0.35; // Used as the bite's knockback source Y.
      const damageTag = creature.def.attackTag || 'sharp'; // Used to preserve the Grehlr's authored sharp affliction identity.
      const afflictionBonuses = window.ResourceSystem?.afflictionBonusesForTag?.(damageTag); // Used by the shared damage path to apply the species-consistent affliction.
      const damage = creature.def.attackDamage * tuning.DAMAGE_MULTIPLIER; // Used as the heavy emergence bite health/footing pressure.
      const damageOptions = { tag: damageTag, afflictionBonuses }; // Used to route affliction and damage-type footing behavior through existing combat code.

      if (state.targetKind === 'player') deps.damagePlayer?.(damage, sourceX, sourceY, tuning.KNOCKBACK_PX_S, damageOptions);
      else deps.damageCreature?.(target, damage, sourceX, sourceY, tuning.KNOCKBACK_PX_S, damageOptions);
      state.damageAttempted = true;
      deps.playCreatureClawHit?.(creature);
    }

    // Both a successful bite and an escaped telegraph pay the same commitment cost.
    applySelfExhaustion(creature);
    state.exhaustionApplied = true;
    emitBurst(creature, state, deps, Math.round(tuning.EMERGE_BURST_PARTICLES), state.centerX, state.centerY);
  }

  function ensureDebugElement() {
    const pane = document.getElementById('devWildlifePane'); // Used as the existing mobile-visible wildlife debug panel host.
    if (!pane) return null;
    let element = document.getElementById('grehlrBurrowDebug'); // Used to reuse one status card instead of allocating one every frame.
    if (!element) {
      element = document.createElement('div');
      element.id = 'grehlrBurrowDebug';
      element.className = 'small';
      element.style.cssText = 'margin:6px 0;padding:6px;border:1px solid currentColor;border-radius:6px;white-space:pre-line;';
      pane.prepend(element);
    }
    return element;
  }

  function updateDebug(creature, state) {
    const element = ensureDebugElement(); // Used to expose phase/timing/resources on mobile without devtools.
    if (!element) return;
    const phaseDuration = state.stage === 'burrow'
      ? state.burrowDurationS
      : state.stage === 'telegraph'
        ? tuning.TELEGRAPH_S
        : state.stage === 'dive'
          ? tuning.DIVE_S
          : tuning.EMERGE_S; // Used to calculate the current phase countdown.
    const remaining = Math.max(0, phaseDuration - state.t); // Used as the displayed seconds until the next attack phase.
    const status = targetStatus(creature, state); // Used to show why a target is or is not eligible without requiring desktop devtools.
    const distancePx = status.valid && Number.isFinite(state.centerX) && Number.isFinite(state.centerY)
      ? Math.hypot(state.target.x - state.centerX, state.target.y - state.centerY)
      : Infinity; // Used to show whether the target is physically inside the fixed warning circle right now.
    const radiusPx = state.telegraphRadiusPx || 0; // Used as the debug comparison radius for the eruption circle.
    const inside = status.valid && radiusPx > 0 && distancePx <= radiusPx; // Used as the live mobile-visible hit eligibility indicator.
    const distanceText = Number.isFinite(distancePx) ? `${Math.round(distancePx)}/${Math.round(radiusPx)}px` : `--/${Math.round(radiusPx)}px`; // Used as compact circle-distance diagnostics.
    const result = state.exhaustionApplied ? ` | ${state.hit ? 'HIT' : 'MISS'}${state.damageAttempted ? ' DAMAGE SENT' : ''}` : ''; // Used to preserve the last resolution result during emergence.
    element.textContent = `Grehlr Burrow: ${state.stage}\nremaining ${remaining.toFixed(2)}s | particles ${state.dirtParticles.length}\ntarget ${state.targetKind || '?'} ${status.valid ? 'valid' : status.reason} | ${inside ? 'INSIDE' : 'OUTSIDE'} ${distanceText}\nfooting ${Math.round(creature.footing ?? 0)}/${Math.round(creature.maxFooting ?? 0)} | stamina ${Math.round(creature.stamina ?? 0)}/${Math.round(creature.maxStamina ?? 0)}${result}`;
  }

  function start(creature, state, context, deps) {
    const randomSpan = Math.max(0, tuning.BURROW_MAX_S - tuning.BURROW_MIN_S); // Used to randomize the hidden travel duration inside the authored 3–8 second range.
    const modelWidth = creature.visualModelWidth || creature.def.modelWidth || 2; // Used to enlarge the Den-Mother's danger circle without a separate attack.
    const radiusTiles = Math.max(tuning.MIN_RADIUS_TILES, modelWidth * tuning.MODEL_RADIUS_MULTIPLIER); // Used as the fixed telegraph/bite radius in tile units.

    state.stage = 'dive';
    state.t = 0;
    state.target = context?.target || null;
    state.targetKind = targetKindFor(creature, state.target, deps); // Used to keep the player-vs-creature damage route stable for the whole multi-second attack.
    state.burrowDurationS = tuning.BURROW_MIN_S + gameplayRandom() * randomSpan;
    state.collideRadiusPx = deps.TILE * 0.32;
    state.telegraphRadiusPx = radiusTiles * deps.TILE;
    state.dirtParticles = [];
    state.trailEmitCarry = 0;
    state.telegraphEmitCarry = 0;
    state.exhaustionApplied = false;
    state.hit = false;
    state.damageAttempted = false;
    state.lastTargetStatus = targetStatus(creature, state);
    state.lastDistancePx = Infinity;

    if (state.target) creature.facing = Math.atan2(state.target.y - creature.y, state.target.x - creature.x);
    creature.scaleY = 1;
    setDivePose(creature, 0);
    emitBurst(creature, state, deps, Math.round(tuning.DIVE_BURST_PARTICLES));
    updateDebug(creature, state);
  }

  function update(creature, state, dt, deps) {
    state.t += dt;
    updateDirt(state, dt);

    if (state.stage === 'dive') {
      const progress = Math.min(1, state.t / tuning.DIVE_S); // Used to synchronize sinking, tilt, travel, and the entry dirt spray.
      const eased = easeOutCubic(progress); // Used to make the dive start decisively and settle underground smoothly.
      setDivePose(creature, eased);
      creature.scaleY = 1 - (1 - tuning.HIDDEN_SCALE_Y) * eased;
      if (progress >= 0.35) moveBurrowTowardTarget(creature, state, deps, dt);

      state.trailEmitCarry += tuning.TRAIL_PARTICLES_PER_S * 1.5 * dt;
      while (state.trailEmitCarry >= 1) {
        state.trailEmitCarry -= 1;
        emitTrailPop(creature, state, deps);
      }

      if (progress >= 1) {
        state.stage = 'burrow';
        state.t = 0;
        creature.scaleY = tuning.HIDDEN_SCALE_Y;
        setDivePose(creature, 1);
        emitBurst(creature, state, deps, Math.round(tuning.BURROW_BURST_PARTICLES));
      }
      updateDebug(creature, state);
      return true;
    }

    if (state.stage === 'burrow') {
      creature.scaleY = tuning.HIDDEN_SCALE_Y;
      setDivePose(creature, 1);
      moveBurrowTowardTarget(creature, state, deps, dt);
      state.trailEmitCarry += tuning.TRAIL_PARTICLES_PER_S * dt;
      while (state.trailEmitCarry >= 1) {
        state.trailEmitCarry -= 1;
        emitTrailPop(creature, state, deps);
      }
      if (state.t >= state.burrowDurationS) beginTelegraph(creature, state, deps);
      updateDebug(creature, state);
      return true;
    }

    if (state.stage === 'telegraph') {
      creature.scaleY = tuning.HIDDEN_SCALE_Y;
      setDivePose(creature, 1);
      state.telegraphEmitCarry += tuning.TELEGRAPH_PARTICLES_PER_S * dt;
      while (state.telegraphEmitCarry >= 1) {
        state.telegraphEmitCarry -= 1;
        emitTelegraphPop(creature, state, deps, Math.random() * Math.PI * 2);
      }
      if (state.t >= tuning.TELEGRAPH_S) {
        resolveBite(creature, state, deps);
        state.stage = 'emerge';
        state.t = 0;
      }
      updateDebug(creature, state);
      return true;
    }

    const progress = Math.min(1, state.t / tuning.EMERGE_S); // Used to raise and un-tilt the Grehlr after hit or miss resolution.
    const eased = easeOutCubic(progress); // Used to smooth the final emergence without delaying the actual bite timing.
    creature.scaleY = tuning.HIDDEN_SCALE_Y + (1 - tuning.HIDDEN_SCALE_Y) * eased;
    setDivePose(creature, 1 - eased);
    updateDebug(creature, state);
    if (progress < 1) return true;

    clearDirt(state);
    resetPose(creature);
    return false;
  }

  function cancel(creature, state) {
    clearDirt(state);
    resetPose(creature);
  }

  function applyConfig(config) {
    if (!config || typeof config !== 'object') return;
    for (const key of Object.keys(DEFAULTS)) {
      const value = Number(config[key]); // Used to accept only finite authored numeric overrides for known Grehlr tuning keys.
      if (Number.isFinite(value)) tuning[key] = value;
    }
  }

  attacks.register('grehlrBurrow', { start, update, cancel });

  // Compatibility: Grehlr CREATURE_DB defaults still say pounce until the
  // asynchronous authored creature config arrives. Route only those two
  // species to the new attack so early spawns/saves cannot fall back to the
  // generic leap; every other pounce user remains untouched.
  const originalStart = attacks.start.bind(attacks); // Used as the shared dispatcher after Grehlr-only ID resolution.
  attacks.start = function grehlrAwareAnimalAttackStart(creature, attackId, context) {
    const resolvedId = isGrehlr(creature) && attackId === 'pounce' ? 'grehlrBurrow' : attackId; // Used to preserve new behavior for stale pounce data only on Grehlrs.
    return originalStart(creature, resolvedId, context);
  };

  window.HobunjiGrehlrBurrow = { applyConfig, tuning }; // Used by debug/editor integrations and the compatibility loader's already-loaded check.

  const initialConfig = window.__attackValuesConfig?.creatureAttacks?.grehlrBurrow; // Used when authored combat config finished loading before this module executed.
  if (initialConfig) applyConfig(initialConfig);
  window.addEventListener('hobunji-attack-values-loaded', event => {
    const config = event.detail?.creatureAttacks?.grehlrBurrow; // Used to refresh Grehlr tuning when the normal combat config loader resolves.
    if (config) applyConfig(config);
  });
})();
