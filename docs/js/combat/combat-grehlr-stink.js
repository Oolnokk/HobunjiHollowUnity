// Grehlr close-range stink spray + underground burrow protection.
// Registers alongside Grehlr Burrow and keeps the shared animal-attack dispatcher intact.
(() => {
  'use strict';

  const attacks = window.Combat?.animalAttacks; // Used to register the stink attack and wrap Grehlr attack selection/protection.
  if (!attacks?.register) {
    console.error('combat-grehlr-stink.js requires combat-animal-attacks.js to load first');
    return;
  }
  if (window.HobunjiGrehlrStink) return;

  const STINK_OIL_COLOR = 0x8A9A3D; // Used for spray particles; matches ITEM_DEFS.grehlrStinkOil.spriteColor.
  const DEFAULTS = Object.freeze({ // Used when authored attack config is unavailable or incomplete.
    SELECTION_CHANCE: 0.4,
    MAX_SELECTION_RANGE_TILES: 2.25,
    FLIP_S: 0.10,
    SPRAY_S: 0.16,
    RECOVER_S: 0.18,
    RANGE_TILES: 2.7,
    HALF_CONE_DEG: 36,
    REAR_OFFSET_TILES: 0.36,
    CHOKED_STAMINA_AMOUNT: 24, // Legacy tuning name; Choked Stamina is the old name for today's Winded Stamina.
    PARTICLES_PER_S: 96,
    PARTICLE_SPEED_MIN_TILES_S: 4.2,
    PARTICLE_SPEED_MAX_TILES_S: 7.2,
    PARTICLE_LIFE_MIN_S: 0.16,
    PARTICLE_LIFE_MAX_S: 0.32,
  });
  const tuning = { ...DEFAULTS }; // Used by selection, hit resolution, animation, and VFX.

  const DEBUG_STEP_MS = 250; // Used to throttle the existing mobile Wildlife diagnostics pane to 4 Hz.
  let lastDebugAt = 0; // Used to limit DOM writes from the stink/protection diagnostics.
  let lastDebugText = ''; // Used to skip redundant debug text writes.
  let particleGeometry = null; // Shared by all stink droplets to avoid per-particle geometry allocation.
  let particleMaterial = null; // Shared by all stink droplets to avoid per-particle material allocation.

  function clamp01(value) {
    return Math.max(0, Math.min(1, value));
  }

  function gameplayRandom() {
    const random = window.GameRandom?.random; // Used for gameplay-relevant attack selection.
    return typeof random === 'function' ? random() : Math.random();
  }

  function visualRandom() {
    return Math.random(); // Cosmetic particle scatter is intentionally not gameplay-deterministic.
  }

  function isGrehlr(creature) {
    const key = creature?.creatureKey; // Used to include normal/Den-Mother Grehlrs and migrated label-only actors.
    const label = creature?.def?.label;
    return key === 'grehlr' || key === 'grehlr-den-mother' || label === 'Grehlr' || label === 'Grehlr Den-Mother';
  }

  function isMediumCompanionGrehlr(creature) {
    if (!creature?.isCompanion || !isGrehlr(creature)) return false;
    const followupHelper = window.HobunjiGrehlrDrenkirraFollowup?.isMediumCompanion; // Used to share the companion module's exact Medium-size rule when available.
    if (typeof followupHelper === 'function') return followupHelper(creature);
    const sizeClass = window.CreatureGenetics?.creatureSizeClass?.('grehlr', creature.genotype); // Used as a fallback if stink selection runs before the follow-up helper is available.
    return !sizeClass || sizeClass === 'medium';
  }

  function isBurrowProtected(entity) {
    return entity?._grehlrBurrowProtected === true; // Used by targeting and damage choke points while fully underground.
  }

  function targetKindFor(creature, target, deps) {
    const players = deps.players || (deps.player ? [deps.player] : []); // Used to preserve the existing player-vs-creature damage/status route.
    if (target === deps.player || players.includes(target) || target?.isPlayer === true) return 'player';
    return 'creature';
  }

  function targetIsUsable(creature, target) {
    if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.y)) return false;
    if (Number.isFinite(target.health) && target.health <= 0) return false;
    if (isBurrowProtected(target)) return false;
    if (target.areaId != null && creature.areaId != null && target.areaId !== creature.areaId) return false;
    return true;
  }

  function normalizeAngle(angle) {
    let value = angle;
    while (value > Math.PI) value -= Math.PI * 2;
    while (value < -Math.PI) value += Math.PI * 2;
    return value;
  }

  function angleDelta(from, to) {
    return normalizeAngle(to - from); // Used for the shortest visible turn toward each attack pose.
  }

  function lerpAngle(from, to, amount) {
    return normalizeAngle(from + angleDelta(from, to) * clamp01(amount));
  }

  function ensureParticleAssets() {
    const THREE = window.THREE; // Used to lazily create the low-poly stink spray meshes.
    if (!THREE) return null;
    if (!particleGeometry) particleGeometry = new THREE.TetrahedronGeometry(0.045, 0);
    if (!particleMaterial) particleMaterial = new THREE.MeshBasicMaterial({
      color: STINK_OIL_COLOR,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
    });
    return THREE;
  }

  function particleParent(creature) {
    return creature.avatarRef?.group?.parent || null; // Used to place spray particles in the same world scene as the Grehlr.
  }

  function sprayWorldY(creature) {
    const groupY = creature.avatarRef?.group?.position?.y ?? 0; // Used as the creature-root reference for the rear spray origin.
    return groupY + Math.max(0.03, (creature.halfHeight || 0.5) * 0.05); // Lowered from 15% of half-height / 0.08 minimum so the spray leaves near the Grehlr's rear instead of mid-body.
  }

  function spawnParticle(creature, state, deps) {
    const THREE = ensureParticleAssets(); // Used to create this one cosmetic stink droplet.
    const parent = particleParent(creature);
    if (!THREE || !parent || !deps.TILE) return;

    const halfConeRad = tuning.HALF_CONE_DEG * Math.PI / 180; // Used as the same cone width that determines actual status hits.
    const angle = state.sprayAngle + (visualRandom() * 2 - 1) * halfConeRad;
    const rearOffsetPx = deps.TILE * tuning.REAR_OFFSET_TILES; // Used to emit from the Grehlr's rear after it turns around.
    const originX = creature.x + Math.cos(state.sprayAngle) * rearOffsetPx;
    const originY = creature.y + Math.sin(state.sprayAngle) * rearOffsetPx;
    const speedTilesS = tuning.PARTICLE_SPEED_MIN_TILES_S
      + visualRandom() * Math.max(0, tuning.PARTICLE_SPEED_MAX_TILES_S - tuning.PARTICLE_SPEED_MIN_TILES_S);
    const life = tuning.PARTICLE_LIFE_MIN_S
      + visualRandom() * Math.max(0, tuning.PARTICLE_LIFE_MAX_S - tuning.PARTICLE_LIFE_MIN_S);
    const mesh = new THREE.Mesh(particleGeometry, particleMaterial);
    const scale = 0.7 + visualRandom() * 1.2;

    mesh.position.set(originX / deps.TILE, sprayWorldY(creature), originY / deps.TILE);
    mesh.scale.setScalar(scale);
    mesh.rotation.set(visualRandom() * Math.PI, visualRandom() * Math.PI, visualRandom() * Math.PI);
    parent.add(mesh);
    state.particles.push({
      mesh,
      vx: Math.cos(angle) * speedTilesS,
      vz: Math.sin(angle) * speedTilesS,
      vy: (visualRandom() * 2 - 1) * 0.22,
      life,
      maxLife: life,
    });
  }

  function updateParticles(state, dt) {
    for (let index = state.particles.length - 1; index >= 0; index -= 1) {
      const particle = state.particles[index]; // Used to integrate and retire one active stink droplet.
      particle.life -= dt;
      particle.mesh.position.x += particle.vx * dt;
      particle.mesh.position.y += particle.vy * dt;
      particle.mesh.position.z += particle.vz * dt;
      particle.mesh.rotation.x += dt * 9;
      particle.mesh.rotation.z += dt * 7;
      particle.mesh.scale.multiplyScalar(Math.max(0.72, particle.life / Math.max(0.001, particle.maxLife)));
      if (particle.life <= 0) {
        particle.mesh.parent?.remove(particle.mesh);
        state.particles.splice(index, 1);
      }
    }
  }

  function clearParticles(state) {
    for (const particle of state.particles || []) particle.mesh.parent?.remove(particle.mesh);
    state.particles = [];
  }

  function gatherTargets(creature, deps) {
    const targets = []; // Used to let the short cone affect every valid opposing actor it actually catches.
    if (creature.isCompanion) {
      for (const hostile of deps.hostileObjects || []) {
        if (targetIsUsable(creature, hostile)) targets.push(hostile);
      }
      return targets;
    }
    for (const player of deps.players || (deps.player ? [deps.player] : [])) {
      if (targetIsUsable(creature, player)) targets.push(player);
    }
    for (const companion of deps.companionObjects || []) {
      // A shoulder pet rides on the player's own body, not a separate
      // ground position — never a legitimate independent target for this
      // cone (see combat-drenkirra-pellet.js's gatherTargets for the same
      // exclusion and reasoning).
      if (companion.stableRole === 'shoulderPet') continue;
      if (targetIsUsable(creature, companion)) targets.push(companion);
    }
    return targets;
  }

  function applyWindedStamina(target) {
    const resourceSystem = window.ResourceSystem; // Used to apply the live affliction that replaced the older Choked Stamina name.
    if (!resourceSystem?.AFFLICTIONS?.windedStamina) return 0;
    const amount = resourceSystem.addAffliction?.(target, 'windedStamina', tuning.CHOKED_STAMINA_AMOUNT) || 0;
    resourceSystem.enforceCaps?.(target);
    return amount;
  }

  function resolveSpray(creature, state, deps) {
    const rangePx = tuning.RANGE_TILES * deps.TILE; // Used as the gameplay cone's authored reach; now 2.7 tiles (150% of the original 1.8).
    const halfConeRad = tuning.HALF_CONE_DEG * Math.PI / 180;
    state.hitCount = 0;
    state.windedApplied = 0;

    for (const target of gatherTargets(creature, deps)) {
      if (!deps.inCone(creature.x, creature.y, state.sprayAngle, target.x, target.y, rangePx, halfConeRad)) continue;
      state.hitCount += 1;
      state.windedApplied += applyWindedStamina(target);
    }
    updateDebug(creature, state, true);
  }

  function ensureDebugElement() {
    const pane = document.getElementById('devWildlifePane'); // Used as the existing mobile-visible wildlife diagnostics host.
    if (!pane) return null;
    let element = document.getElementById('grehlrStinkDebug'); // Used to reuse one compact card for stink/protection diagnostics.
    if (!element) {
      element = document.createElement('div');
      element.id = 'grehlrStinkDebug';
      element.className = 'small';
      element.style.cssText = 'margin:6px 0;padding:6px;border:1px solid currentColor;border-radius:6px;white-space:pre-line;';
      pane.prepend(element);
    }
    return element;
  }

  function updateDebug(creature, state, force = false) {
    const now = performance.now(); // Used to enforce the 4 Hz DOM update ceiling unless a hit/result just resolved.
    if (!force && now - lastDebugAt < DEBUG_STEP_MS) return;
    lastDebugAt = now;
    const phaseDuration = state.stage === 'flip' ? tuning.FLIP_S : state.stage === 'spray' ? tuning.SPRAY_S : tuning.RECOVER_S;
    const remaining = Math.max(0, phaseDuration - state.t);
    const status = state.hitCount > 0 ? `Winded Stamina +${state.windedApplied || 0}` : 'no cone hit';
    const actorKind = creature?.isCompanion ? (isMediumCompanionGrehlr(creature) ? 'medium companion' : 'companion') : 'wild';
    const text = `Grehlr Stink: ${state.stage}\nremaining ${remaining.toFixed(2)}s | particles ${state.particles.length}\nhits ${state.hitCount || 0} | ${status}\n${actorKind} | range ${tuning.RANGE_TILES.toFixed(2)} tiles\nburrow protected ${isBurrowProtected(creature) ? 'YES' : 'no'} | color #8A9A3D`;
    if (text === lastDebugText) return;
    const element = ensureDebugElement();
    if (!element) return;
    element.textContent = text;
    lastDebugText = text;
  }

  function stinkStart(creature, state, context, deps) {
    const target = context?.target || null; // Used to lock the rear-spray direction at attack start.
    const targetAngle = targetIsUsable(creature, target)
      ? Math.atan2(target.y - creature.y, target.x - creature.x)
      : (creature.facing || 0);
    state.stage = 'flip';
    state.t = 0;
    state.target = target;
    state.targetKind = targetKindFor(creature, target, deps);
    state.startFacing = Number.isFinite(creature.facing) ? creature.facing : targetAngle;
    state.sprayAngle = targetAngle;
    state.flippedFacing = normalizeAngle(targetAngle + Math.PI);
    state.particles = [];
    state.particleCarry = 0;
    state.sprayResolved = false;
    state.hitCount = 0;
    state.windedApplied = 0;
    updateDebug(creature, state, true);
  }

  function stinkUpdate(creature, state, dt, deps) {
    state.t += dt;
    updateParticles(state, dt);

    if (state.stage === 'flip') {
      const progress = clamp01(state.t / Math.max(0.001, tuning.FLIP_S));
      creature.facing = lerpAngle(state.startFacing, state.flippedFacing, progress);
      if (progress >= 1) {
        creature.facing = state.flippedFacing;
        state.stage = 'spray';
        state.t = 0;
      }
      updateDebug(creature, state);
      return true;
    }

    if (state.stage === 'spray') {
      creature.facing = state.flippedFacing;
      if (!state.sprayResolved) {
        state.sprayResolved = true;
        resolveSpray(creature, state, deps);
      }
      state.particleCarry += tuning.PARTICLES_PER_S * dt;
      while (state.particleCarry >= 1) {
        state.particleCarry -= 1;
        spawnParticle(creature, state, deps);
      }
      if (state.t >= tuning.SPRAY_S) {
        state.stage = 'recover';
        state.t = 0;
      }
      updateDebug(creature, state);
      return true;
    }

    const progress = clamp01(state.t / Math.max(0.001, tuning.RECOVER_S));
    creature.facing = lerpAngle(state.flippedFacing, state.sprayAngle, progress);
    updateDebug(creature, state);
    if (progress < 1 || state.particles.length > 0) return true;
    creature.facing = state.sprayAngle;
    clearParticles(state);
    return false;
  }

  function stinkCancel(creature, state) {
    clearParticles(state);
    if (Number.isFinite(state?.sprayAngle)) creature.facing = state.sprayAngle;
  }

  function shouldUseStink(creature, attackId, context, deps) {
    if (!isGrehlr(creature) || (attackId !== 'pounce' && attackId !== 'grehlrBurrow')) return false;
    if (creature.isCompanion && !isMediumCompanionGrehlr(creature)) return false; // Medium animal companions share the wild Grehlr stink selector; other companion sizes keep their normal behavior.
    const target = context?.target;
    if (!targetIsUsable(creature, target) || !deps?.TILE) return false;
    const distanceTiles = Math.hypot(target.x - creature.x, target.y - creature.y) / deps.TILE;
    if (distanceTiles > tuning.MAX_SELECTION_RANGE_TILES) return false;
    return gameplayRandom() < tuning.SELECTION_CHANCE;
  }

  function setBurrowProtected(creature, protectedState) {
    if (!creature) return;
    creature._grehlrBurrowProtected = !!protectedState; // Used by auto-target and damage guards for the fully underground phases.
  }

  function syncBurrowProtection(creature) {
    const attack = creature?._animalAttack; // Used to derive protection from the actual live attack stage rather than timers duplicated here.
    const protectedState = attack?.id === 'grehlrBurrow'
      && (attack.state?.stage === 'burrow' || attack.state?.stage === 'telegraph');
    setBurrowProtected(creature, protectedState);
  }

  function installProtectionChokePoints() {
    const combat = window.Combat; // Used to patch the dependency seam before game.js injects its closure-private combat functions.
    if (!combat || combat.__grehlrBurrowProtectionInstalled) return;
    combat.__grehlrBurrowProtectionInstalled = true;

    const previousTargetable = combat.isTargetableEntity; // Used to compose with any future/general targetability rule instead of replacing it.
    combat.isTargetableEntity = entity => previousTargetable?.(entity) !== false && !isBurrowProtected(entity);

    const resourceSystem = window.ResourceSystem; // Used as a second-line damage guard for callers that bypass game.js damageCreature.
    if (resourceSystem?.applyDamage && !resourceSystem.__grehlrBurrowDamageGuardInstalled) {
      const originalApplyDamage = resourceSystem.applyDamage.bind(resourceSystem);
      resourceSystem.applyDamage = function grehlrBurrowGuardedApplyDamage(entity, ...args) {
        if (isBurrowProtected(entity)) return 0;
        return originalApplyDamage(entity, ...args);
      };
      resourceSystem.__grehlrBurrowDamageGuardInstalled = true;
    }

    const previousInit = combat.init.bind(combat); // Used to preserve every existing Combat.init dependency assignment.
    combat.init = function grehlrBurrowProtectedCombatInit(injectedDeps) {
      if (injectedDeps && !injectedDeps.__grehlrBurrowProtectionInstalled) {
        const originalDamageCreature = injectedDeps.damageCreature; // Used to reject the whole hit before damage/Footing/knockback side effects.
        if (typeof originalDamageCreature === 'function') {
          injectedDeps.damageCreature = function grehlrBurrowGuardedDamageCreature(target, ...args) {
            if (isBurrowProtected(target)) return false;
            return originalDamageCreature.call(this, target, ...args);
          };
        }

        const originalFindAutoTarget = injectedDeps.findAutoTarget; // Used to make player lock-on/quick-attack condition targeting ignore buried Grehlrs.
        const hostileObjects = injectedDeps.hostileObjects; // Used as the same live array the closure-private auto-target helper scans.
        if (typeof originalFindAutoTarget === 'function' && Array.isArray(hostileObjects)) {
          injectedDeps.findAutoTarget = function grehlrBurrowAwareFindAutoTarget(...args) {
            const removed = []; // Stores protected actors and their indices so the live array can be restored immediately after synchronous targeting.
            for (let index = hostileObjects.length - 1; index >= 0; index -= 1) {
              if (!isBurrowProtected(hostileObjects[index])) continue;
              removed.push({ index, target: hostileObjects[index] });
              hostileObjects.splice(index, 1);
            }
            try {
              return originalFindAutoTarget.apply(this, args);
            } finally {
              removed.sort((a, b) => a.index - b.index);
              for (const entry of removed) hostileObjects.splice(entry.index, 0, entry.target);
            }
          };
        }
        injectedDeps.__grehlrBurrowProtectionInstalled = true;
      }
      return previousInit(injectedDeps);
    };
  }

  function applyConfig(config) {
    if (!config || typeof config !== 'object') return;
    for (const key of Object.keys(DEFAULTS)) {
      const value = Number(config[key]); // Used to accept only finite authored numeric overrides for known stink tuning keys.
      if (Number.isFinite(value)) tuning[key] = value;
    }
  }

  attacks.register('grehlrStink', {
    label: 'Stink Spray',
    start: stinkStart,
    update: stinkUpdate,
    cancel: stinkCancel,
    isStriking: state => state?.stage === 'spray',
  });

  const previousStart = attacks.start.bind(attacks); // Used to mix Stink Spray into both authored Burrow IDs and stale Grehlr pounce IDs.
  attacks.start = function grehlrStinkAwareStart(creature, attackId, context) {
    const resolvedId = shouldUseStink(creature, attackId, context, window.Combat?.deps) ? 'grehlrStink' : attackId;
    return previousStart(creature, resolvedId, context);
  };

  const previousUpdate = attacks.update.bind(attacks); // Used to derive burrow protection after the owning attack module advances its actual stage.
  attacks.update = function grehlrProtectionAwareUpdate(creature, dt) {
    const busy = previousUpdate(creature, dt);
    syncBurrowProtection(creature);
    return busy;
  };

  const previousCancel = attacks.cancel.bind(attacks); // Used to guarantee protection cannot leak after an interrupted burrow.
  attacks.cancel = function grehlrProtectionAwareCancel(creature) {
    setBurrowProtected(creature, false);
    return previousCancel(creature);
  };

  installProtectionChokePoints();

  window.HobunjiGrehlrStink = {
    applyConfig,
    tuning,
    STINK_OIL_COLOR,
    isBurrowProtected,
    isMediumCompanionGrehlr,
    staminaAfflictionId: 'windedStamina',
  }; // Used by mobile/manual diagnostics and the compatibility loader's already-loaded check.

  const initialConfig = window.__attackValuesConfig?.creatureAttacks?.grehlrStink; // Used when authored combat config finished loading before this module executed.
  if (initialConfig) applyConfig(initialConfig);
  window.addEventListener('hobunji-attack-values-loaded', event => {
    const config = event.detail?.creatureAttacks?.grehlrStink; // Used to refresh stink tuning when the normal combat config loader resolves.
    if (config) applyConfig(config);
  });
})();
