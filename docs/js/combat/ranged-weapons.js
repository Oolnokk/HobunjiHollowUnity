// Ranged weapon slot, load/fire actions, and projectile simulation.
(() => {
  'use strict';

  let deps = null;
  const projectiles = [];
  const playerLoaded = new Map();
  let playerAction = null;
  let lastEvent = 'idle';

  const CONFIG = {
    crossbow: {
      label: 'Crossbow', projectileSprite: 'assets/toolsprites/arrow_long.png',
      projectileCount: 1, spreadDeg: 0, damage: 16, speedPxS: 720,
      rangeTiles: 9, projectileRadiusPx: 7, knockbackPxS: 260,
      reloadDurationS: 0.86, fireDurationS: 0.24, fireAtFrac: 0.16,
      staminaCost: 10,
      pose: {
        neutral: { x: 0, y: 0.12, z: 0.18, pitch: -8, yaw: 0, roll: 0, bodyYaw: 0 },
        windup:  { x: 0, y: 0.10, z: -0.10, pitch: -18, yaw: 0, roll: 0, bodyYaw: -8 },
        strike:  { x: 0, y: 0.15, z: 0.10, pitch: 12, yaw: 0, roll: 0, bodyYaw: 5 },
      },
    },
    scatterbow: {
      label: 'Scatterbow', projectileSprite: 'assets/toolsprites/arrow_short.png',
      projectileCount: 6, spreadDeg: 28, damage: 5, speedPxS: 650,
      rangeTiles: 6.5, projectileRadiusPx: 4, knockbackPxS: 110,
      reloadDurationS: 1.04, fireDurationS: 0.28, fireAtFrac: 0.18,
      staminaCost: 14,
      pose: {
        neutral: { x: 0, y: 0.12, z: 0.18, pitch: -8, yaw: 0, roll: 0, bodyYaw: 0 },
        windup:  { x: 0, y: 0.08, z: -0.13, pitch: -20, yaw: 0, roll: 0, bodyYaw: -10 },
        strike:  { x: 0, y: 0.18, z: 0.08, pitch: 16, yaw: 0, roll: 0, bodyYaw: 7 },
      },
    },
  };

  function init(injectedDeps) { deps = injectedDeps; }

  function applyConfig(config) {
    if (!config) return;
    for (const key of Object.keys(CONFIG)) {
      if (!config[key]) continue;
      CONFIG[key] = { ...CONFIG[key], ...config[key], pose: { ...CONFIG[key].pose, ...(config[key].pose || {}) } };
    }
  }

  function defFor(itemKey) { return CONFIG[itemKey] || null; }
  function isLoaded(itemKey, owner = null) {
    if (owner) return owner._rangedLoaded !== false;
    if (!playerLoaded.has(itemKey)) playerLoaded.set(itemKey, true);
    return playerLoaded.get(itemKey);
  }

  function setLoaded(itemKey, loaded, owner = null) {
    if (owner) owner._rangedLoaded = !!loaded;
    else playerLoaded.set(itemKey, !!loaded);
    deps?.setRangedLoadedVisual?.(itemKey, !!loaded, owner);
    if (!owner) deps?.refreshActionBar?.();
    lastEvent = `${owner ? owner.id : 'player'}:${itemKey}:${loaded ? 'loaded' : 'empty'}`;
  }

  function playerActionLabel(itemKey) {
    const def = defFor(itemKey);
    if (!def) return 'Fire';
    if (playerAction) return playerAction.kind === 'load' ? 'Loading…' : 'Firing…';
    return isLoaded(itemKey) ? `Fire ${def.label}` : `Load ${def.label}`;
  }

  function startPlayerAction(itemKey) {
    const def = defFor(itemKey);
    if (!def || playerAction) return false;
    const loaded = isLoaded(itemKey);
    const kind = loaded ? 'fire' : 'load';
    if (kind === 'fire') window.ResourceSystem?.spendStamina?.(deps.player, def.staminaCost, `${def.label} fire`);
    const durationS = kind === 'fire' ? def.fireDurationS : def.reloadDurationS;
    playerAction = { itemKey, def, kind, t: 0, durationS, fired: false };
    deps.triggerRangedWeaponVisual?.(durationS, {
      sequence: kind, pose: def.pose,
      windupFrac: kind === 'load' ? 0.55 : 0.02,
      strikeFrac: kind === 'fire' ? def.fireAtFrac : 0.56,
      holdFrac: kind === 'fire' ? Math.min(0.72, def.fireAtFrac + 0.12) : 0.57,
    });
    lastEvent = `player:${itemKey}:${kind}-start`;
    deps.refreshActionBar?.();
    return true;
  }

  function cancelPlayerAction() {
    playerAction = null;
    deps?.refreshActionBar?.();
  }

  function updatePlayerAction(dt) {
    if (!playerAction) return;
    const action = playerAction;
    action.t += dt;
    if (action.kind === 'fire' && !action.fired && action.t >= action.durationS * action.def.fireAtFrac) {
      action.fired = true;
      setLoaded(action.itemKey, false);
      const angle = deps.getPlayerAimAngle();
      spawnVolley(action.itemKey, deps.player.x, deps.player.y, angle, 'player', deps.player);
    }
    if (action.t < action.durationS) return;
    if (action.kind === 'load') setLoaded(action.itemKey, true);
    playerAction = null;
    deps.refreshActionBar?.();
  }

  function createProjectileMesh(def, radiusPx) {
    const root = new THREE.Group();
    root.name = 'rangedProjectile';
    const collider = new THREE.Mesh(
      new THREE.SphereGeometry(radiusPx / deps.TILE, 8, 6),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    collider.name = 'hiddenProjectileCollider';
    collider.userData.rangedCollider = true;
    root.add(collider);

    const visual = new THREE.Group();
    visual.name = 'projectilePngDeadzoneVisual';
    const texture = new THREE.TextureLoader().load(def.projectileSprite);
    texture.magFilter = texture.minFilter = THREE.NearestFilter;
    const longArrow = def.projectileSprite.includes('arrow_long');
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(longArrow ? 0.09 : 0.065, longArrow ? 0.72 : 0.38),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, alphaTest: 0.08, side: THREE.DoubleSide })
    );
    plane.rotation.x = -Math.PI / 2;
    plane.renderOrder = deps.heldObjectRenderOrder || 1.5;
    visual.add(plane);
    root.add(visual);
    root.userData.collider = collider;
    root.userData.visual = visual;
    return root;
  }

  function spawnProjectile(itemKey, x, y, angle, team, owner) {
    const def = defFor(itemKey);
    if (!def) return null;
    const scene = deps.getActiveScene();
    const mesh = createProjectileMesh(def, def.projectileRadiusPx);
    const surfaceY = deps.worldSurfaceY(x, y);
    mesh.position.set(x / deps.TILE, surfaceY + 0.55, y / deps.TILE);
    scene.add(mesh);
    const p = {
      itemKey, def, team, owner, mesh, visual: mesh.userData.visual,
      x, y, prevX: x, prevY: y,
      vx: Math.cos(angle) * def.speedPxS, vy: Math.sin(angle) * def.speedPxS,
      angle, distancePx: 0, maxDistancePx: def.rangeTiles * deps.TILE,
      areaId: deps.getCurrentArea(), pngRot: -angle + Math.PI / 2, perpState: {}, dead: false,
    };
    p.visual.rotation.y = p.pngRot;
    projectiles.push(p);
    return p;
  }

  function spawnVolley(itemKey, x, y, angle, team, owner) {
    const def = defFor(itemKey);
    if (!def) return [];
    const count = Math.max(1, Math.round(def.projectileCount));
    const spread = THREE.MathUtils.degToRad(def.spreadDeg || 0);
    const made = [];
    for (let i = 0; i < count; i++) {
      const u = count === 1 ? 0.5 : i / (count - 1);
      made.push(spawnProjectile(itemKey, x, y, angle + (u - 0.5) * spread, team, owner));
    }
    lastEvent = `${team}:${itemKey}:volley-${count}`;
    return made;
  }

  function pointSegmentDistanceSq(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
    const qx = ax + dx * t, qy = ay + dy * t;
    return (px - qx) ** 2 + (py - qy) ** 2;
  }

  function projectileHit(p) {
    if (p.team === 'player') {
      for (const c of deps.hostileObjects) {
        if (c.health <= 0 || c.areaId && c.areaId !== p.areaId) continue;
        const hitRadius = p.def.projectileRadiusPx + Math.max(18, (c.def?.modelWidth || 0.6) * deps.TILE * 0.4);
        if (pointSegmentDistanceSq(c.x, c.y, p.prevX, p.prevY, p.x, p.y) > hitRadius ** 2) continue;
        deps.damageCreature(c, p.def.damage, p.prevX, p.prevY, p.def.knockbackPxS, { tag: 'sharp', ranged: true });
        deps.awardRangedMastery?.(p.itemKey);
        return true;
      }
      return false;
    }
    const player = deps.player;
    const hitRadius = p.def.projectileRadiusPx + deps.playerRadius;
    if (pointSegmentDistanceSq(player.x, player.y, p.prevX, p.prevY, p.x, p.y) <= hitRadius ** 2) {
      deps.damagePlayer(p.def.damage, p.prevX, p.prevY, p.def.knockbackPxS, { tag: 'sharp', ranged: true });
      return true;
    }
    return false;
  }

  function updateProjectileVisual(p, dt) {
    // This is intentionally the animal PNG-plane rotation path only. The
    // root sphere's vx/vy and trajectory angle are never changed here.
    const rawTargetRotY = -p.angle + Math.PI / 2;
    const perps = deps.cameraRelativeCreaturePerps();
    const deadRad = deps.creaturePerpDeadRad;
    const mode = window.PerpRotation?.CREATURE_PLANE_ROT_MODE;
    if (mode === 'snap') {
      const result = window.PerpRotation.creatureSnapSwayTarget(p.perpState, rawTargetRotY, perps, deadRad, dt, true);
      if (result.snap) p.pngRot = result.target;
      else p.pngRot += deps.angleDiff(result.target, p.pngRot) * Math.min(1, dt * 10);
    } else if (mode === 'sway') {
      const target = window.PerpRotation.creatureDeadzoneTarget(p.perpState, rawTargetRotY, perps, deadRad, dt, true);
      p.pngRot += deps.angleDiff(target, p.pngRot) * Math.min(1, dt * 10);
    } else if (window.PerpRotation?.perpClamp) {
      const result = window.PerpRotation.perpClamp(p.perpState, rawTargetRotY, perps, deadRad);
      if (result.snapTo !== null) p.pngRot = result.effectiveTarget;
      else p.pngRot += deps.angleDiff(result.effectiveTarget, p.pngRot) * Math.min(1, dt * 10);
    }
    p.visual.rotation.y = p.pngRot;
  }

  function disposeProjectile(p) {
    p.dead = true;
    p.mesh.parent?.remove(p.mesh);
    p.mesh.traverse(child => {
      child.geometry?.dispose?.();
      child.material?.map?.dispose?.();
      child.material?.dispose?.();
    });
  }

  function updateProjectiles(dt) {
    for (const p of projectiles) {
      if (p.dead) continue;
      if (p.areaId !== deps.getCurrentArea()) { disposeProjectile(p); continue; }
      p.prevX = p.x; p.prevY = p.y;
      const dx = p.vx * dt, dy = p.vy * dt;
      p.x += dx; p.y += dy; p.distancePx += Math.hypot(dx, dy);
      if (!deps.canOccupyAt(p.x, p.y, p.def.projectileRadiusPx) || projectileHit(p) || p.distancePx >= p.maxDistancePx) {
        disposeProjectile(p);
        continue;
      }
      p.mesh.position.x = p.x / deps.TILE;
      p.mesh.position.z = p.y / deps.TILE;
      p.mesh.position.y = deps.worldSurfaceY(p.x, p.y) + 0.55;
      updateProjectileVisual(p, dt);
    }
    for (let i = projectiles.length - 1; i >= 0; i--) if (projectiles[i].dead) projectiles.splice(i, 1);
  }

  function beginBanditAction(c, kind, targetPlayer) {
    const itemKey = c.def.rangedWeaponKey;
    const def = defFor(itemKey);
    if (!def) return;
    c._rangedMode = true;
    c._rangedAction = { kind, t: 0, durationS: kind === 'fire' ? def.fireDurationS : def.reloadDurationS, fired: false };
    c._rangedAimAngle = Math.atan2(targetPlayer.y - c.y, targetPlayer.x - c.x);
    lastEvent = `${c.id}:${itemKey}:${kind}-start`;
  }

  function updateBanditAI(c, dt, targetPlayer, distToPlayer) {
    const itemKey = c.def?.rangedWeaponKey;
    const def = defFor(itemKey);
    if (!def || !targetPlayer) return null;
    c._rangedCooldownT = Math.max(0, (c._rangedCooldownT || 0) - dt);
    const action = c._rangedAction;
    if (action) {
      action.t += dt;
      c._rangedAimAngle = Math.atan2(targetPlayer.y - c.y, targetPlayer.x - c.x);
      if (action.kind === 'fire' && !action.fired && action.t >= action.durationS * def.fireAtFrac) {
        action.fired = true;
        setLoaded(itemKey, false, c);
        spawnVolley(itemKey, c.x, c.y, c._rangedAimAngle, 'bandit', c);
      }
      if (action.t >= action.durationS) {
        if (action.kind === 'load') setLoaded(itemKey, true, c);
        c._rangedAction = null;
        c._rangedCooldownT = action.kind === 'fire' ? 0.55 : 0.18;
      }
      return { aimAngle: c._rangedAimAngle, moving: false, handled: true };
    }

    const minRange = deps.TILE * 2.25;
    const maxRange = deps.TILE * def.rangeTiles * 0.9;
    if (distToPlayer < minRange) { c._rangedMode = false; return null; }
    c._rangedMode = true;
    const aimAngle = Math.atan2(targetPlayer.y - c.y, targetPlayer.x - c.x);
    if (distToPlayer > maxRange) {
      const moving = deps.moveCreatureToward(c, targetPlayer.x, targetPlayer.y, c.def.chaseSpeed, dt);
      return { aimAngle, moving, handled: true };
    }
    if (c._rangedCooldownT <= 0) beginBanditAction(c, isLoaded(itemKey, c) ? 'fire' : 'load', targetPlayer);
    return { aimAngle, moving: false, handled: true };
  }

  function updateBanditVisual(c) {
    const holder = c._banditRangedToolHolder;
    if (!holder) return;
    holder.visible = !!c._rangedMode;
    if (!holder.visible) return;
    const θ = c.facing || c._rangedAimAngle || 0;
    const action = c._rangedAction;
    const def = defFor(c.def.rangedWeaponKey);
    let pose = def.pose.neutral;
    if (action) {
      const t = Math.min(1, action.t / action.durationS);
      const target = action.kind === 'load' ? def.pose.windup : def.pose.strike;
      const peak = action.kind === 'load' ? 0.55 : def.fireAtFrac;
      const k = t <= peak ? t / Math.max(0.001, peak) : (1 - t) / Math.max(0.001, 1 - peak);
      pose = {};
      for (const key of ['x','y','z','pitch','yaw','roll','bodyYaw']) pose[key] = def.pose.neutral[key] + (target[key] - def.pose.neutral[key]) * Math.max(0, Math.min(1, k));
    }
    const vθ = θ + THREE.MathUtils.degToRad(pose.bodyYaw || 0);
    const rx = Math.cos(vθ), rz = -Math.sin(vθ), fx = Math.sin(vθ), fz = Math.cos(vθ);
    holder.position.set(c.x / deps.TILE + rx * (-0.34 + pose.x) + fx * pose.z, c.avatarRef.group.position.y + pose.y, c.y / deps.TILE + rz * (-0.34 + pose.x) + fz * pose.z);
    holder.rotation.set(THREE.MathUtils.degToRad(pose.pitch), vθ + THREE.MathUtils.degToRad(pose.yaw), THREE.MathUtils.degToRad(pose.roll), 'YXZ');
  }

  function cancelBanditAction(c) { if (c) { c._rangedAction = null; c._rangedMode = false; } }
  function disposeOwner(c) { cancelBanditAction(c); if (c?._banditRangedToolHolder) c._banditRangedToolHolder.parent?.remove(c._banditRangedToolHolder); }

  function update(dt) { updatePlayerAction(dt); updateProjectiles(dt); }
  function playerLockRangePx(itemKey) { return (defFor(itemKey)?.rangeTiles || 7) * (deps?.TILE || 64); }

  window.RangedWeapons = {
    init, applyConfig, startPlayerAction, cancelPlayerAction, playerActionLabel,
    isLoaded, setLoaded, update, updateBanditAI, updateBanditVisual,
    cancelBanditAction, disposeOwner, playerLockRangePx,
    get config() { return CONFIG; },
  };
  window.__rangedDebug = {
    get projectiles() { return projectiles.map(p => ({ itemKey: p.itemKey, team: p.team, x: p.x, y: p.y, vx: p.vx, vy: p.vy, distancePx: p.distancePx })); },
    get playerAction() { return playerAction ? { ...playerAction, def: undefined } : null; },
    get lastEvent() { return lastEvent; },
    setPlayerLoaded: (itemKey, loaded) => setLoaded(itemKey, loaded),
    firePlayer: (itemKey) => startPlayerAction(itemKey),
    snapshot: () => ({ lastEvent, activeProjectiles: projectiles.length, loaded: Object.fromEntries(playerLoaded) }),
  };
})();
