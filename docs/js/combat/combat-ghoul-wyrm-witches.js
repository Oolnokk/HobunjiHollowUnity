// Ghoul Wyrm-witch combat. Uses the shared BanditCombat actor, attack scheduler and hit resolver.
(() => {
  'use strict';
  const TYPE_WIND = 'shadow-wind'; // Selects the short-lived, wildly erratic cloud projectile.
  const TYPE_WATER = 'rend-water'; // Selects the stationary expanded-cone melee attack.
  const WIND_KNOCKBACK_PX_S = 4200; // Exceeds twice the 1900 px/s Voorg-ass rear kick; terrain collisions use normal knockback physics.
  const WIND_LIFETIME_S = 0.85; // Maximum flight after the telegraphed release.
  const WIND_SPEED_TILES_S = 12; // Shared tile-relative flight speed, independent of map scale.
  const WIND_COOLDOWN_S = 2.5; // Per-witch interval between released clouds.
  const WATER_COOLDOWN_S = 1.8; // Per-witch interval between water-cone strikes.
  const WATER_RENT_HEALTH = 3; // Effective maximum Health reserved per successful strike until sacred ground.
  const WATER_CONE_HALF_RAD = Math.PI * 0.29; // Slightly wider than the ordinary weapon swing.
  const projectileGeometry = new WeakMap(); // Tracks disposable cloud meshes by their individual active staged action.
  const ACTIVE_WITCH_DEBUG_LIMIT = 24; // Bounds retained debug actor references across repeated mine floor regeneration.
  const activeWitches = new Set(); // Mobile debug snapshot only; never retain an unbounded history of defeated/removed witches.
  const random = () => window.GameRandom?.random?.() ?? Math.random();

  function removeEffect(action) {
    const object = projectileGeometry.get(action);
    if (!object) return;
    object.parent?.remove(object);
    object.traverse?.(node => { node.geometry?.dispose?.(); if (node.material) node.material.dispose?.(); });
    projectileGeometry.delete(action);
  }

  function coneVisual(c, tile, rangePx, yaw) {
    const THREE = window.THREE;
    if (!THREE || !c.scene) return null;
    const points = []; // Distributed blue water motes within the actual elongated melee wedge.
    for (let i = 0; i < 52; i++) {
      const radius = (0.2 + 0.8 * Math.sqrt(random())) * rangePx / tile;
      const angle = yaw + (random() * 2 - 1) * WATER_CONE_HALF_RAD;
      points.push(Math.cos(angle) * radius, 0.14 + random() * 0.35, Math.sin(angle) * radius);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    const material = new THREE.PointsMaterial({ color: 0x69dfff, size: 0.2, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending });
    const mesh = new THREE.Points(geometry, material);
    mesh.position.set(c.x / tile, c.avatarRef?.group?.position?.y != null ? c.avatarRef.group.position.y - (c.halfHeight || 0) + 0.14 : 0.25, c.y / tile);
    c.scene.add(mesh);
    return mesh;
  }

  function cloudVisual(c, tile) {
    const THREE = window.THREE;
    if (!THREE || !c.scene) return null;
    const cloud = new THREE.Group();
    const geometry = new THREE.SphereGeometry(0.28, 6, 4);
    const material = new THREE.MeshBasicMaterial({ color: 0x0b0814, transparent: true, opacity: 0.75, depthWrite: false });
    for (let i = 0; i < 7; i++) {
      const mote = new THREE.Mesh(i === 0 ? geometry : geometry.clone(), i === 0 ? material : material.clone()); // First mote owns the original disposable buffers instead of leaking unused templates per cast.
      mote.position.set((random() - 0.5) * 0.55, (random() - 0.5) * 0.35, (random() - 0.5) * 0.55);
      mote.scale.setScalar(0.6 + random() * 0.65);
      cloud.add(mote);
    }
    cloud.position.set(c.x / tile, (c.avatarRef?.group?.position?.y || 1) + 0.15, c.y / tile);
    c.scene.add(cloud);
    return cloud;
  }

  function stillInOwningArea(c, api) { return !c.areaId || !api.getCurrentArea || api.getCurrentArea() === c.areaId; } // Prevent unloaded-mine spells from striking players in a different map.

  function castShadowWind(c, target, api) {
    const angleToTarget = Math.atan2(target.y - c.y, target.x - c.x);
    const state = { x: c.x, y: c.y, angle: angleToTarget + (random() - 0.5) * Math.PI * 1.4, elapsed: 0, hit: false }; // One independent in-flight cloud owned by this cast.
    c.facing = angleToTarget;
    c.telegraphState = 'windup';
    c._banditSwingAnim = 'thrust';
    function advanceCloud(current) {
      if (!stillInOwningArea(c, api)) { current.cancel?.(); return; }
      if (!current.strikeFired || state.hit) return;
      const elapsed = Math.min(WIND_LIFETIME_S, Math.max(0, current.t - current.windupS));
      const dt = elapsed - state.elapsed;
      if (!(dt > 0)) return;
      state.elapsed = elapsed;
      const sweepSteps = Math.max(1, Math.ceil(WIND_SPEED_TILES_S * dt / 0.22)); // No more than 0.22 tiles per collision test: prevents fast clouds tunneling through cover or the target after frame hitches.
      const stepDt = dt / sweepSteps; // Uses the same integrated flight distance at every frame rate.
      for (let step = 0; step < sweepSteps; step++) {
        state.angle += (random() - 0.5) * stepDt * 8 + Math.sin((elapsed - dt + stepDt * (step + 1)) * 23) * stepDt * 2.5;
        const nextX = state.x + Math.cos(state.angle) * api.TILE * WIND_SPEED_TILES_S * stepDt;
        const nextY = state.y + Math.sin(state.angle) * api.TILE * WIND_SPEED_TILES_S * stepDt;
        if (api.canOccupyAt && !api.canOccupyAt(nextX, nextY, api.TILE * 0.18)) { state.hit = true; break; }
        state.x = nextX; state.y = nextY;
        if (target.health > 0 && (!target.areaId || target.areaId === c.areaId) && Math.hypot(target.x - nextX, target.y - nextY) <= api.TILE * 0.55) {
          state.hit = true;
          const randomPushAngle = random() * Math.PI * 2; // Random throw direction, independent of travel or initial aim.
          api.damage(target, 2, target.x - Math.cos(randomPushAngle) * api.TILE, target.y - Math.sin(randomPushAngle) * api.TILE, WIND_KNOCKBACK_PX_S, { tag: 'blunt' });
          break;
        }
      }
      if (state.hit) { removeEffect(action); return; }
      const visual = projectileGeometry.get(action);
      if (visual) visual.position.set(state.x / api.TILE, visual.position.y + Math.sin(elapsed * 19) * dt * 0.12, state.y / api.TILE);
    }

    const action = window.Combat.beginStagedAction({
      windupS: 0.43, strikeS: WIND_LIFETIME_S, recoverS: 0,
      data: { isBandit: true, attacker: c, silentSfx: true, wyrmWitch: TYPE_WIND },
      onStrike: () => {
        if (!stillInOwningArea(c, api)) { action.cancel?.(); return; }
        c.telegraphState = 'strike';
        projectileGeometry.set(action, cloudVisual(c, api.TILE));
        advanceCloud(action); // The scheduler updates before firing strikes; sweep elapsed flight even if this frame also completes the entire cast.
      },
      onUpdate: advanceCloud,
      onComplete: () => { removeEffect(action); c._banditAction = null; c.telegraphState = null; c._wyrmCooldown = WIND_COOLDOWN_S; },
      onCancel: () => { removeEffect(action); c._banditAction = null; c.telegraphState = null; c._wyrmCooldown = 0.45; },
    });
    c._banditAction = action;
  }

  function rendWaterRangePx(c, tileSize) {
    const combo = window.Combat?.comboData; // The same first-step lunge table ordinary humanoid attacks use.
    const step = combo?.[c.def?.banditAbilityLoadout?.tap1]?.[0]; // First combo swing supplies its normal forward lunge distance.
    const lungeDistancePx = tileSize * (step?.lungeMul || 2) * (combo?.LUNGE_SCALE || 1.5); // Added to cone length instead of moving the witch.
    const swingDistancePx = (c.def.attackRangePx || tileSize) * (step?.rangeMul || 1) * (combo?.RANGE_SCALE || 1); // Keeps the authored combo attack range, not only its lunge.
    return swingDistancePx + lungeDistancePx;
  }

  function castRendWater(c, target, api) {
    const yaw = Math.atan2(target.y - c.y, target.x - c.x);
    const rangePx = rendWaterRangePx(c, api.TILE); // Render, collision and AI positioning all use the same non-lunging reach.
    c.facing = yaw;
    c.telegraphState = 'windup';
    c._banditSwingAnim = 'sweep';
    const action = window.Combat.beginStagedAction({
      windupS: 0.42, strikeS: 0.34, recoverS: 0.12,
      data: { isBandit: true, attacker: c, silentSfx: true, wyrmWitch: TYPE_WATER },
      onStrike: () => {
        if (!stillInOwningArea(c, api)) { action.cancel?.(); return; }
        c.telegraphState = 'strike';
        projectileGeometry.set(action, coneVisual(c, api.TILE, rangePx, yaw));
        if (window.Combat?.meleeHit?.(c, target, { rangePx, halfConeRad: WATER_CONE_HALF_RAD, yaw, pitch: window.Combat?.meleeAimSolution?.(c, target, yaw, 0)?.pitch || 0 })) {
          api.damage(target, Math.max(1, Number(c.def.attackDamage) || 8), c.x, c.y, api.TILE * 3.3, {
            tag: 'sharp',
            fixedAfflictionBuildup: { rentHealth: WATER_RENT_HEALTH }, // Damage resolver applies Rent only if the hit survives invulnerability/defense.
          });
        }
      },
      onUpdate: current => {
        if (!stillInOwningArea(c, api)) { current.cancel?.(); return; }
        const visual = projectileGeometry.get(action);
        if (visual) visual.material.opacity = Math.max(0, 1 - (current.t - current.windupS) / (current.strikeS + current.recoverS));
      },
      onComplete: () => { removeEffect(action); c._banditAction = null; c.telegraphState = null; c._wyrmCooldown = WATER_COOLDOWN_S; },
      onCancel: () => { removeEffect(action); c._banditAction = null; c.telegraphState = null; c._wyrmCooldown = 0.45; },
    });
    c._banditAction = action;
  }

  function update(c, dt, target, distance, api) {
    const type = c?.mineWyrmWitchType;
    if (type !== TYPE_WIND && type !== TYPE_WATER) return null;
    if (!stillInOwningArea(c, api)) return { handled: true, aimAngle: c.facing || 0, moving: false }; // Transfer/unload cannot start another attack in the old room.
    if (!activeWitches.has(c)) {
      if (activeWitches.size >= ACTIVE_WITCH_DEBUG_LIMIT) {
        for (const old of activeWitches) {
          if (old.health <= 0 || !old.avatarRef?.group?.parent) activeWitches.delete(old); // Cull obsolete actors only as newly spawned witches arrive.
        }
        if (activeWitches.size >= ACTIVE_WITCH_DEBUG_LIMIT) activeWitches.delete(activeWitches.values().next().value); // Preserve a bounded newest-first diagnostic history.
      }
      activeWitches.add(c);
    }
    c._wyrmCooldown = Math.max(0, (c._wyrmCooldown || 0) - dt);
    const aimAngle = Math.atan2(target.y - c.y, target.x - c.x);
    const attackRange = type === TYPE_WIND ? api.TILE * 7 : rendWaterRangePx(c, api.TILE) * 0.9; // Melee commits only after entering its REAL no-lunge cone.
    if (c._banditAction) return { handled: true, aimAngle: c.facing, moving: false };
    if (distance > attackRange) return { handled: true, aimAngle, moving: api.moveToward(c, target.x, target.y, c.def.chaseSpeed, dt) };
    if (c._wyrmCooldown > 0) return { handled: true, aimAngle, moving: false };
    if (type === TYPE_WIND) castShadowWind(c, target, api);
    else castRendWater(c, target, api);
    return { handled: true, aimAngle, moving: false };
  }

  function debugSnapshot() {
    for (const c of activeWitches) if (!c || c.health <= 0 || !c.scene?.parent && !c.avatarRef?.group?.parent) activeWitches.delete(c);
    return { active: [...activeWitches].map(c => ({ id: c.id, type: c.mineWyrmWitchType, state: c.telegraphState || 'ready', cooldown: c._wyrmCooldown || 0 })), shadowWindKnockbackPxS: WIND_KNOCKBACK_PX_S, waterRentHealth: WATER_RENT_HEALTH };
  }
  window.GhoulWyrmWitches = { update, debugSnapshot, WIND_KNOCKBACK_PX_S, WATER_RENT_HEALTH };
})();
