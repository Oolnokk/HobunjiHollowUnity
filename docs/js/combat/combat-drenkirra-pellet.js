// Drenkirra-only Caustic Pellet ranged attack.
(() => {
  'use strict';

  const attacks = window.Combat?.animalAttacks; // Used to register the Drenkirra-specific named animal attack.
  if (!attacks?.register) {
    console.error('combat-drenkirra-pellet.js requires combat-animal-attacks.js to load first');
    return;
  }

  const DEFAULTS = Object.freeze({ // Used as safe tuning when attack-values.json is unavailable or incomplete.
    CHARGE_DURATION_S: 1.04,
    CHARGE_TILT_FRAC: 0.18,
    FIRE_DURATION_S: 1.04,
    FIRE_WINDUP_FRAC: 0.05,
    FIRE_STRIKE_FRAC: 0.08,
    FIRE_HOLD_FRAC: 0.17,
    TILT_DEG: 45,
    ACCORDION_CYCLES: 5,
    ACCORDION_MIN_SCALE_X: 0.52,
    ACCORDION_MAX_SCALE_X: 1.58,
    STRIKE_SCALE_X: 0.5,
    PROJECTILE_SPEED_PX_S: 720,
    PROJECTILE_RANGE_TILES: 7.5,
    PROJECTILE_RADIUS_PX: 8,
    PROJECTILE_PLANE_SIZE: 0.18,
    DAMAGE_MULTIPLIER: 0.3,
    KNOCKBACK_PX_S: 160,
    CORRODED_HEALTH_MULTIPLIER: 2.5,
  });

  const tuning = { ...DEFAULTS }; // Used by animation, projectile simulation, and authored runtime overrides.
  const PELLET_SPRITE = 'assets/creaturesprites/drenkirra_pellet.png'; // Future sprite path; fallback material remains visible until the PNG exists.
  const PELLET_ORIGIN_FORWARD_TILES = 0.3; // Keeps the pellet visibly ahead of the body at the authored mouth/head direction.
  const PELLET_ORIGIN_HEIGHT_WORLD = 0.08; // Small torso-to-mouth lift in Three.js world units until a species mouth anchor is available.
  const PELLET_GROUND_CLEARANCE_WORLD = 0.08; // Lets a downward shot embed cleanly instead of skimming through terrain.
  const FALLBACK_COLOR = 0xb6d94c; // Used as a visible acidic placeholder when the not-yet-authored pellet PNG cannot load.
  let pelletTexture = null; // Reused by every pellet once the future PNG loads successfully.
  let pelletTextureRequested = false; // Prevents repeated 404 requests while the placeholder art is intentionally absent.

  function clamp01(value) {
    return Math.max(0, Math.min(1, value));
  }

  function lerp(a, b, t) {
    return a + (b - a) * clamp01(t);
  }

  function isDrenkirra(creature) {
    const key = creature?.creatureKey; // Used to identify regular and Den-Mother Drenkirra without label-only matching.
    const label = creature?.def?.label; // Used as a fallback for older/runtime-created creature objects.
    return key === 'drenkirra' || key === 'drenkirra-den-mother' || label === 'Drenkirra' || label === 'Drenkirra Den-Mother' || label === 'Drenkirra Nestmother';
  }

  function targetKindFor(creature, target, deps) {
    const players = deps.players || (deps.player ? [deps.player] : []); // Used to match the same player references as the shared pounce attack.
    if (target === deps.player || players.includes(target) || target?.isPlayer === true) return 'player';
    const looksLikeCreature = !!(target?.def || target?.creatureKey || target?.isCompanion || target?.isBandit); // Used to classify companion targets without area-only heuristics.
    if (looksLikeCreature) return 'creature';
    return creature.isCompanion ? 'creature' : 'player';
  }

  function actorWorldY(actor, deps) {
    const injected = Number(deps.getActorWorldY?.(actor)); // Used to share the live player/creature render height from game.js when available.
    if (Number.isFinite(injected)) return injected;
    const avatarY = Number(actor?.avatarRef?.group?.position?.y); // Used for creature targets in older/ad-hoc combat harnesses.
    if (Number.isFinite(avatarY)) return avatarY;
    if (Number.isFinite(actor?.x) && Number.isFinite(actor?.y) && typeof deps.worldSurfaceY === 'function') {
      const surface = Number(deps.worldSurfaceY(actor.x, actor.y)); // Used as a safe ground-relative fallback when no avatar has been built yet.
      if (Number.isFinite(surface)) return surface + 0.4;
    }
    return 0.4;
  }

  function clampHeadPitchDeg(creature, pitchDeg) {
    const rig = creature.avatarRef?.headRig?.rig; // Used to honor the authored Drenkirra limits once PR #251's runtime is present.
    if (!rig) return pitchDeg;
    const minDeg = Number(rig.minDeg), maxDeg = Number(rig.maxDeg); // Used as explicit per-species safety limits rather than a generic global clamp.
    if (!Number.isFinite(minDeg) || !Number.isFinite(maxDeg)) return pitchDeg;
    const lower = Math.min(minDeg, maxDeg), upper = Math.max(minDeg, maxDeg);
    return Math.max(lower, Math.min(upper, pitchDeg));
  }

  function restoreHeadRotation(creature, deltaSeconds = 0.12) {
    const avatar = creature.avatarRef; // Used to keep the head-rig call optional on saves that predate authored animal rigs.
    if (typeof avatar?.updateHeadRotation !== 'function') return;
    const restDeg = Number(avatar.headRig?.rig?.restDeg); // Used to return to the exact authored neutral angle rather than assuming zero.
    avatar.updateHeadRotation(Number.isFinite(restDeg) ? restDeg : 0, deltaSeconds);
  }

  function applyHeadAim(creature, state, dt) {
    const avatar = creature.avatarRef; // Used to make head pitch a no-op for legacy flat-plane Drenkirra avatars.
    if (typeof avatar?.updateHeadRotation !== 'function') return;
    if (!state.aimVector || !Number.isFinite(state.aimPitchDeg)) {
      restoreHeadRotation(creature, dt);
      return;
    }
    avatar.updateHeadRotation(state.aimPitchDeg, dt); // Smoothed authored head pitch during both wind-up and fire.
  }

  function gatherTargets(creature, deps) {
    const targets = []; // Used as the opposing actors this pellet can physically intersect while flying.
    if (creature.isCompanion) {
      for (const hostile of deps.hostileObjects || []) {
        if (hostile.health > 0 && hostile.areaId === creature.areaId) targets.push({ kind: 'creature', ref: hostile });
      }
      return targets;
    }
    for (const player of deps.players || (deps.player ? [deps.player] : [])) {
      if (player) targets.push({ kind: 'player', ref: player });
    }
    for (const companion of deps.companionObjects || []) {
      if (companion.health > 0 && companion.areaId === creature.areaId) targets.push({ kind: 'creature', ref: companion });
    }
    return targets;
  }

  function storeBasePose(creature, state) {
    const front = creature.avatarRef?.frontPlane; // Used to preserve the live front-plane transform before accordion deformation.
    const back = creature.avatarRef?.backPlane; // Used to preserve the live back-plane transform before accordion deformation.
    state.basePose = {
      front: front ? { scaleX: front.scale.x, rotationX: front.rotation.x } : null,
      back: back ? { scaleX: back.scale.x, rotationX: back.rotation.x } : null,
    };
  }

  function applyPlanePose(plane, base, scaleXFactor, tiltRad) {
    if (!plane || !base) return;
    plane.scale.x = base.scaleX * scaleXFactor;
    plane.rotation.x = base.rotationX + tiltRad;
  }

  function resetPose(creature, state) {
    const base = state.basePose; // Used to restore both mirrored sprite planes exactly, including any non-1 base X scale.
    if (!base) return;
    applyPlanePose(creature.avatarRef?.frontPlane, base.front, 1, 0);
    applyPlanePose(creature.avatarRef?.backPlane, base.back, 1, 0);
  }

  // Charge replaces a crossbow reload: first tip the animal upward, then run
  // several exaggerated local-X squeeze/stretch beats while it stays aimed.
  function chargePoseAtProgress(progress) {
    const p = clamp01(progress); // Used to evaluate the complete pre-shot charge.
    const tiltFrac = Math.max(0.0001, Math.min(0.95, tuning.CHARGE_TILT_FRAC)); // Used to reserve a readable initial tilt before the accordion begins.
    if (p < tiltFrac) return { scaleX: 1, tiltAmount: p / tiltFrac };
    const accordionT = (p - tiltFrac) / Math.max(0.0001, 1 - tiltFrac); // Used to spread all accordion cycles across the visible remainder of the charge.
    const wave = Math.sin(accordionT * tuning.ACCORDION_CYCLES * Math.PI * 2); // Used as the cartoon squeeze/stretch oscillator.
    const scaleX = wave >= 0
      ? lerp(1, tuning.ACCORDION_MAX_SCALE_X, wave)
      : lerp(1, tuning.ACCORDION_MIN_SCALE_X, -wave);
    return { scaleX, tiltAmount: 1 };
  }

  // Fire uses the crossbow's authored 5% windup / 8% strike / 17% hold
  // fractions. The pellet releases exactly at strike, then the half-width
  // body slowly returns to normal through the rest of the fire action.
  function firePoseAtProgress(progress) {
    const p = clamp01(progress); // Used to evaluate the crossbow-matched firing fractions safely.
    const windupFrac = Math.max(0, Math.min(0.98, tuning.FIRE_WINDUP_FRAC)); // Used as the end of the ready pose before the sudden compression.
    const strikeFrac = Math.max(windupFrac + 0.0001, Math.min(0.99, tuning.FIRE_STRIKE_FRAC)); // Used as the exact projectile-release moment.
    const holdFrac = Math.max(strikeFrac, Math.min(0.999, tuning.FIRE_HOLD_FRAC)); // Used as the end of the compressed strike hold.
    if (p <= windupFrac) return { scaleX: 1, tiltAmount: 1 };
    if (p < strikeFrac) {
      const t = (p - windupFrac) / Math.max(0.0001, strikeFrac - windupFrac); // Used for the cartoonishly sudden squeeze into strike.
      return { scaleX: lerp(1, tuning.STRIKE_SCALE_X, t), tiltAmount: 1 };
    }
    if (p <= holdFrac) return { scaleX: tuning.STRIKE_SCALE_X, tiltAmount: 1 };
    const t = (p - holdFrac) / Math.max(0.0001, 1 - holdFrac); // Used for the deliberately slow post-shot return.
    return { scaleX: lerp(tuning.STRIKE_SCALE_X, 1, t), tiltAmount: 1 - t };
  }

  function aimVectorFor(creature, target, deps) {
    if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.y)) return null;
    if (Number.isFinite(target.health) && target.health <= 0) return null;

    const targetDxPx = target.x - creature.x, targetDzPx = target.y - creature.y; // Used to choose the horizontal mouth bearing before converting into world units.
    const horizontalTargetPx = Math.hypot(targetDxPx, targetDzPx);
    const angle = horizontalTargetPx > 0.001
      ? Math.atan2(targetDzPx, targetDxPx)
      : (Number.isFinite(creature.facing) ? creature.facing : 0); // Used to keep a stable direction for a point-blank target.
    const originX = creature.x + Math.cos(angle) * deps.TILE * PELLET_ORIGIN_FORWARD_TILES; // Used as the logical mouth position in the game's pixel X axis.
    const originZ = creature.y + Math.sin(angle) * deps.TILE * PELLET_ORIGIN_FORWARD_TILES; // Used as the logical mouth position in the game's pixel Y/Z axis.
    const originWorldY = actorWorldY(creature, deps) + PELLET_ORIGIN_HEIGHT_WORLD; // Used to start the projectile just above the body center.
    const rawDirection = {
      x: (target.x - originX) / deps.TILE,
      y: actorWorldY(target, deps) - originWorldY,
      z: (target.y - originZ) / deps.TILE,
    }; // Used as the complete 3D vector from the mouth to the target point.
    const length = Math.hypot(rawDirection.x, rawDirection.y, rawDirection.z);
    if (!(length > 0.0001)) return null;
    const dir = {
      x: rawDirection.x / length,
      y: rawDirection.y / length,
      z: rawDirection.z / length,
    }; // Used as the normalized projectile velocity direction, including its vertical component.
    const horizontal = Math.hypot(dir.x, dir.z); // Used by the requested atan2 pitch calculation without flattening the shot.
    const pitchDeg = Math.atan2(dir.y, horizontal) * 180 / Math.PI; // Used by the authored head rig and mobile diagnostics.
    return { originX, originZ, originWorldY, dir, angle, pitchDeg };
  }

  function updateAim(creature, state, deps) {
    const target = state.target; // Used to keep the animal tracking its intended target until the strike moment.
    const aim = aimVectorFor(creature, target, deps);
    state.aimVector = aim;
    state.aimPitchDeg = aim ? clampHeadPitchDeg(creature, aim.pitchDeg) : null;
    if (!aim) return false;
    creature.facing = aim.angle;
    return true;
  }

  function projectileParent(creature) {
    return creature.avatarRef?.group?.parent || null;
  }

  function requestPelletTexture(THREE) {
    if (pelletTextureRequested) return;
    pelletTextureRequested = true;
    const loader = new THREE.TextureLoader(); // Used to resolve the future pellet art at most once per page load.
    loader.load(
      PELLET_SPRITE,
      texture => {
        texture.magFilter = texture.minFilter = THREE.NearestFilter;
        pelletTexture = texture;
      },
      undefined,
      () => { /* Intentional: the acid-colored plane is the placeholder until art is authored. */ },
    );
  }

  function createPelletMesh(creature, deps) {
    const THREE = window.THREE; // Used to create the future-PNG projectile plane and its visible fallback.
    const parent = projectileParent(creature); // Used to attach the projectile to the active creature scene.
    if (!THREE || !parent || !deps.TILE) return null;

    requestPelletTexture(THREE);
    const group = new THREE.Group(); // Used as the world-positioned projectile root.
    group.name = 'drenkirraCausticPellet';
    const material = new THREE.MeshBasicMaterial({
      color: pelletTexture ? 0xffffff : FALLBACK_COLOR,
      map: pelletTexture || null,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
      depthWrite: false,
    }); // Used as both the fallback pellet and the eventual PNG material.
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(tuning.PROJECTILE_PLANE_SIZE, tuning.PROJECTILE_PLANE_SIZE), material); // Used as the requested PNG projectile plane.
    plane.rotation.x = -Math.PI / 2;
    plane.renderOrder = 1.5;
    group.add(plane);
    parent.add(group);
    return group;
  }

  function pointSegmentDistanceSq(px, py, ax, ay, bx, by) {
    const abx = bx - ax, aby = by - ay; // Used to form the projectile frame segment.
    const apx = px - ax, apy = py - ay; // Used to project the target onto that frame segment.
    const lenSq = abx * abx + aby * aby;
    const t = lenSq > 0 ? clamp01((apx * abx + apy * aby) / lenSq) : 0; // Used to avoid tunneling through a target between frames.
    const dx = px - (ax + abx * t), dy = py - (ay + aby * t);
    return dx * dx + dy * dy;
  }

  function pointSegmentDistanceSqT(px, py, ax, ay, bx, by) {
    const abx = bx - ax, aby = by - ay; // Used to sample the pellet's world-Y at the same closest horizontal point as the collision check.
    const apx = px - ax, apy = py - ay;
    const lenSq = abx * abx + aby * aby;
    const t = lenSq > 0 ? clamp01((apx * abx + apy * aby) / lenSq) : 0;
    const dx = px - (ax + abx * t), dy = py - (ay + aby * t);
    return { distSq: dx * dx + dy * dy, t };
  }

  function disposeProjectile(projectile) {
    projectile.mesh?.parent?.remove(projectile.mesh);
    projectile.mesh?.traverse?.(object => {
      object.geometry?.dispose?.();
      // The successfully-loaded texture is shared by every future pellet, so
      // only per-projectile geometry/material is disposed here.
      object.material?.dispose?.();
    });
    projectile.dead = true;
  }

  function hitRadiusFor(target, kind, deps) {
    if (kind === 'player') return tuning.PROJECTILE_RADIUS_PX + (deps.playerRadius || deps.TILE * 0.27);
    const modelWidth = target.visualModelWidth || target.def?.modelWidth || 0.8; // Used to approximate the same sprite-sized creature collision envelope as ranged-weapons.js.
    return tuning.PROJECTILE_RADIUS_PX + Math.max(18, modelWidth * deps.TILE * 0.4);
  }

  function applyProjectileHit(creature, state, projectile, targetEntry, deps) {
    const target = targetEntry.ref; // Used as the actor receiving the pellet's low direct damage and Corroded Health payload.
    const damage = Math.max(1, creature.def.attackDamage * tuning.DAMAGE_MULTIPLIER); // Used to retain regular/Den-Mother damage scaling while keeping the pellet low-damage.
    const options = {
      tag: 'corrosive',
      ranged: true,
      footingDamageMultiplier: 0,
      afflictionBonuses: { corrodedHealth: tuning.CORRODED_HEALTH_MULTIPLIER },
    }; // Used to make the projectile affliction-heavy while explicitly preserving zero default ranged Footing damage.
    if (targetEntry.kind === 'player') deps.damagePlayer?.(damage, projectile.prevX, projectile.prevY, tuning.KNOCKBACK_PX_S, options);
    else deps.damageCreature?.(target, damage, projectile.prevX, projectile.prevY, tuning.KNOCKBACK_PX_S, options);
    state.lastResult = `HIT ${targetEntry.kind}`;
    deps.playCreatureClawHit?.(creature);
  }

  function spawnProjectile(creature, state, deps) {
    const mesh = createPelletMesh(creature, deps); // Used as the projectile's requested sprite-plane visual/fallback.
    const aim = state.aimVector || aimVectorFor(creature, state.target, deps); // Used to lock flight to the exact normalized 3D direction at the strike moment.
    const angle = aim?.angle ?? creature.facing ?? 0; // Used to keep horizontal sprite facing aligned with the firing direction.
    const dir = aim?.dir || { x: Math.cos(angle), y: 0, z: Math.sin(angle) }; // Used as a safe horizontal fallback for legacy/ad-hoc callers.
    const originX = aim?.originX ?? creature.x;
    const originZ = aim?.originZ ?? creature.y;
    const originWorldY = aim?.originWorldY ?? actorWorldY(creature, deps);
    const projectile = {
      x: originX,
      y: originZ,
      prevX: originX,
      prevY: originZ,
      worldY: originWorldY,
      prevWorldY: originWorldY,
      vx: dir.x * tuning.PROJECTILE_SPEED_PX_S,
      vy: dir.z * tuning.PROJECTILE_SPEED_PX_S,
      vyWorld: dir.y * (tuning.PROJECTILE_SPEED_PX_S / deps.TILE),
      dir,
      pitchDeg: aim?.pitchDeg ?? 0,
      distancePx: 0,
      maxDistancePx: tuning.PROJECTILE_RANGE_TILES * deps.TILE,
      mesh,
      targets: gatherTargets(creature, deps),
      dead: false,
    }; // Used for the complete in-flight pellet state during this animal attack.
    if (mesh) {
      mesh.position.set(projectile.x / deps.TILE, projectile.worldY, projectile.y / deps.TILE);
      mesh.rotation.y = -angle;
    }
    state.projectiles.push(projectile);
    state.fired = true;
    state.lastResult = 'IN FLIGHT';
  }

  function updateProjectiles(creature, state, dt, deps) {
    for (const projectile of state.projectiles) {
      if (projectile.dead) continue;
      projectile.prevX = projectile.x;
      projectile.prevY = projectile.y;
      projectile.prevWorldY = projectile.worldY;
      const dx = projectile.vx * dt, dy = projectile.vy * dt; // Used as this frame's crossbow-style straight-line flight step.
      const nextX = projectile.x + dx, nextY = projectile.y + dy;
      if (deps.canOccupyAt && !deps.canOccupyAt(nextX, nextY, tuning.PROJECTILE_RADIUS_PX)) {
        if (state.lastResult === 'IN FLIGHT') state.lastResult = 'BLOCKED';
        disposeProjectile(projectile);
        continue;
      }
      projectile.x = nextX;
      projectile.y = nextY;
      projectile.worldY += projectile.vyWorld * dt;
      projectile.distancePx += Math.hypot(dx, dy);
      if (projectile.mesh) {
        projectile.mesh.position.x = projectile.x / deps.TILE;
        projectile.mesh.position.y = projectile.worldY;
        projectile.mesh.position.z = projectile.y / deps.TILE;
      }

      const surfaceY = typeof deps.worldSurfaceY === 'function' ? Number(deps.worldSurfaceY(projectile.x, projectile.y)) : 0;
      if (projectile.worldY <= (Number.isFinite(surfaceY) ? surfaceY : 0) + PELLET_GROUND_CLEARANCE_WORLD) {
        if (state.lastResult === 'IN FLIGHT') state.lastResult = 'BLOCKED';
        disposeProjectile(projectile);
        continue;
      }

      let hit = false; // Used to stop this pellet on the first opposing actor its swept segment intersects.
      for (const targetEntry of projectile.targets) {
        const target = targetEntry.ref;
        if (!target || (Number.isFinite(target.health) && target.health <= 0)) continue;
        if (targetEntry.kind === 'creature' && target.areaId != null && creature.areaId != null && target.areaId !== creature.areaId) continue;
        const hitRadius = hitRadiusFor(target, targetEntry.kind, deps); // Used as the target-plus-projectile swept collision radius.
        const horizontalHit = pointSegmentDistanceSqT(target.x, target.y, projectile.prevX, projectile.prevY, projectile.x, projectile.y);
        if (horizontalHit.distSq > hitRadius * hitRadius) continue;
        const rayWorldY = projectile.prevWorldY + (projectile.worldY - projectile.prevWorldY) * horizontalHit.t; // Used to reject an otherwise-horizontal overlap when the target is above/below the aimed shot.
        const targetWorldY = actorWorldY(target, deps);
        if (Math.abs(rayWorldY - targetWorldY) > hitRadius / deps.TILE) continue;
        applyProjectileHit(creature, state, projectile, targetEntry, deps);
        disposeProjectile(projectile);
        hit = true;
        break;
      }
      if (hit) continue;
      if (projectile.distancePx >= projectile.maxDistancePx) {
        if (state.lastResult === 'IN FLIGHT') state.lastResult = 'MISS';
        disposeProjectile(projectile);
      }
    }
  }

  function clearProjectiles(state) {
    for (const projectile of state.projectiles || []) if (!projectile.dead) disposeProjectile(projectile);
    state.projectiles = [];
  }

  function ensureDebugElement() {
    const pane = document.getElementById('devWildlifePane'); // Used as the existing mobile-visible wildlife debug panel host.
    if (!pane) return null;
    let element = document.getElementById('drenkirraPelletDebug'); // Used to reuse one debug card instead of allocating per frame.
    if (!element) {
      element = document.createElement('div');
      element.id = 'drenkirraPelletDebug';
      element.className = 'small';
      element.style.cssText = 'margin:6px 0;padding:6px;border:1px solid currentColor;border-radius:6px;white-space:pre-line;';
      pane.prepend(element);
    }
    return element;
  }

  function updateDebug(creature, state, stage, progress) {
    const element = ensureDebugElement(); // Used to expose animation/fire state on mobile without desktop devtools.
    if (!element) return;
    const liveProjectiles = state.projectiles.filter(projectile => !projectile.dead).length; // Used as the mobile-visible active pellet count.
    const pitchLabel = Number.isFinite(state.aimPitchDeg) ? `${state.aimPitchDeg.toFixed(1)}°` : '?'; // Used to verify vertical aim and authored clamping from a phone without desktop devtools.
    element.textContent = `Drenkirra Caustic Pellet\n${stage} ${(progress * 100).toFixed(0)}% | pellets ${liveProjectiles}\n${state.lastResult || 'CHARGING'} | target ${state.targetKind || '?'}\nhead pitch ${pitchLabel}\ncorroded x${tuning.CORRODED_HEALTH_MULTIPLIER.toFixed(2)}`;
  }

  function start(creature, state, context, deps) {
    state.stage = 'charge';
    state.t = 0;
    state.target = context?.target || null;
    state.targetKind = targetKindFor(creature, state.target, deps); // Used as debug/route metadata for the intended actor.
    state.fired = false;
    state.projectiles = [];
    state.lastResult = 'CHARGING';
    storeBasePose(creature, state);
    updateAim(creature, state, deps);
    applyHeadAim(creature, state, 0);
    updateDebug(creature, state, state.stage, 0);
  }

  function update(creature, state, dt, deps) {
    state.t += dt;
    if (!state.fired) updateAim(creature, state, deps);

    if (state.stage === 'charge') {
      const duration = Math.max(0.01, tuning.CHARGE_DURATION_S); // Used as the reload-like accordion prep duration.
      const progress = clamp01(state.t / duration); // Used to drive initial tilt plus repeated accordion compression/stretch.
      const pose = chargePoseAtProgress(progress); // Used as this frame's charge width and up-tilt.
      const hasHeadRig = typeof creature.avatarRef?.updateHeadRotation === 'function'; // Used to keep PR #251's skinned body from receiving the old whole-plane pitch.
      const tiltRad = hasHeadRig ? 0 : tuning.TILT_DEG * Math.PI / 180 * pose.tiltAmount; // Legacy sprites retain their authored body pose; rigged Drenkirra uses its head bone instead.
      applyPlanePose(creature.avatarRef?.frontPlane, state.basePose.front, pose.scaleX, tiltRad);
      applyPlanePose(creature.avatarRef?.backPlane, state.basePose.back, pose.scaleX, tiltRad);
      applyHeadAim(creature, state, dt);
      updateDebug(creature, state, state.stage, progress);
      if (progress >= 1) {
        state.stage = 'fire';
        state.t = 0;
        const transitionTilt = hasHeadRig ? 0 : tuning.TILT_DEG * Math.PI / 180;
        applyPlanePose(creature.avatarRef?.frontPlane, state.basePose.front, 1, transitionTilt);
        applyPlanePose(creature.avatarRef?.backPlane, state.basePose.back, 1, transitionTilt);
      }
      return true;
    }

    const duration = Math.max(0.01, tuning.FIRE_DURATION_S); // Used as the crossbow-matched firing animation duration.
    const progress = clamp01(state.t / duration); // Used to drive 5% windup / 8% strike / 17% hold / slow recovery.
    const pose = firePoseAtProgress(progress); // Used as this frame's strike width and return pose.
    const hasHeadRig = typeof creature.avatarRef?.updateHeadRotation === 'function'; // Used to route vertical aiming through the authored head instead of the whole animal.
    const tiltRad = hasHeadRig ? 0 : tuning.TILT_DEG * Math.PI / 180 * pose.tiltAmount; // Unrigged sprites retain the old fallback body pitch.
    applyPlanePose(creature.avatarRef?.frontPlane, state.basePose.front, pose.scaleX, tiltRad);
    applyPlanePose(creature.avatarRef?.backPlane, state.basePose.back, pose.scaleX, tiltRad);
    applyHeadAim(creature, state, dt);

    if (!state.fired && progress >= tuning.FIRE_STRIKE_FRAC) spawnProjectile(creature, state, deps);
    updateProjectiles(creature, state, dt, deps);
    updateDebug(creature, state, state.stage, progress);

    if (progress < 1) return true;
    clearProjectiles(state);
    resetPose(creature, state);
    restoreHeadRotation(creature);
    return false;
  }

  function cancel(creature, state) {
    clearProjectiles(state);
    resetPose(creature, state);
    restoreHeadRotation(creature);
  }

  function applyConfig(config) {
    if (!config || typeof config !== 'object') return;
    for (const key of Object.keys(DEFAULTS)) {
      const value = Number(config[key]); // Used to accept only finite authored numeric overrides for known Caustic Pellet tuning keys.
      if (Number.isFinite(value)) tuning[key] = value;
    }
  }

  attacks.register('causticPellet', { start, update, cancel });

  // Compatibility: Drenkirra CREATURE_DB defaults still say pounce until the
  // asynchronous authored creature config arrives. Redirect stale pounce data
  // only for the two Drenkirra species; every other pounce remains untouched.
  const originalStart = attacks.start.bind(attacks); // Used as the dispatcher after Drenkirra-only stale-ID resolution.
  attacks.start = function drenkirraAwareAnimalAttackStart(creature, attackId, context) {
    const resolvedId = isDrenkirra(creature) && attackId === 'pounce' ? 'causticPellet' : attackId; // Used to guarantee the species-unique ranged attack during early/stale config windows.
    return originalStart(creature, resolvedId, context);
  };

  window.HobunjiDrenkirraPellet = { applyConfig, tuning, spritePath: PELLET_SPRITE, isDrenkirra }; // Used by debug/editor integrations, loader already-loaded checks, and the wildlife AI's ranged-vs-melee trigger range (see updateHostiles).

  const initialConfig = window.__attackValuesConfig?.creatureAttacks?.causticPellet; // Used when authored combat config finished loading before this module executed.
  if (initialConfig) applyConfig(initialConfig);
  window.addEventListener('hobunji-attack-values-loaded', event => {
    const config = event.detail?.creatureAttacks?.causticPellet; // Used to refresh tuning when the normal combat config loader resolves.
    if (config) applyConfig(config);
  });
})();
