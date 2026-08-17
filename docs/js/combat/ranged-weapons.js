// Ranged weapon slot, load/fire actions, and projectile simulation.
(() => {
  'use strict';

  let deps = null;
  const projectiles = [];
  const playerLoaded = new Map();
  let playerAction = null;
  let lastEvent = 'idle';
  let lastAudioEvent = 'idle'; // Exposed through __rangedDebug so mobile testing can confirm cue type and chorus layer count.
  const SCATTERBOW_LOAD_CHORUS_MS = [0, 55, 110]; // Used by playRangedActionSfx() to layer the scatterbow's multiple loading mechanisms.
  const SCATTERBOW_FIRE_CHORUS_MS = [0, 28, 56, 84, 112, 140]; // Used by playRangedActionSfx() to stagger one shot sound per scatterbow projectile.
  const PROJECTILE_PERP_DEAD_DEG = 15; // Used only by projectile PNG facing so arrows turn within tighter windows than animals.
  const PROJECTILE_PERP_DEAD_RAD = THREE.MathUtils.degToRad(PROJECTILE_PERP_DEAD_DEG); // Passed to the shared animal deadzone helpers.
  const PROJECTILE_TRAIL_MAX_POINTS = 14; // Caps each comet ribbon's geometry and per-frame update cost.
  const PROJECTILE_TRAIL_MAX_LANES = 4; // Mirrors the melee trail's readable multi-affliction lane limit.

  // Shared by both loading weapons so crossbow and scatterbow use the exact
  // authored Scatterbow Fire pose set supplied by the animation editor.
  const AUTHORED_FIRE_POSE = {
    neutral: { x: 0.23, y: 0.08, z: 0.14, pitch: 16, yaw: 65, bodyYaw: -52, roll: 11, scale: 1.77 },
    windup:  { x: 0.34, y: 0.14, z: 0.11, pitch: -9, yaw: 86, bodyYaw: -76, roll: 12 },
    strike:  { x: 0.33, y: 0.11, z: 0.12, pitch: -9, yaw: 84, bodyYaw: -109, roll: 9 },
  };
  // Shared by both loading weapons while empty/reloading. Both authored
  // ranged stances use the same enlarged tool scale.
  const AUTHORED_LOAD_POSE = {
    neutral: { x: 0, y: 0.12, z: 0.18, pitch: -8, yaw: 0, bodyYaw: 0, roll: 0, scale: 1.77 },
    windup:  { x: 0, y: -0.17, z: 0.09, pitch: 77, yaw: 0, bodyYaw: -10, roll: 0 },
    strike:  { x: 0, y: 0.18, z: 0.08, pitch: -11, yaw: 0, bodyYaw: 7, roll: 0 },
  };
  // Used to give each weapon its own mutable pose objects when config
  // overrides are merged at runtime.
  function clonePoseSet(source) {
    return {
      neutral: { ...source.neutral },
      windup: { ...source.windup },
      strike: { ...source.strike },
    };
  }

  // Used by runtime tuning overrides so changing one channel or phase does
  // not erase the remaining authored channels in that action's pose set.
  function mergePoseSet(base, incoming = {}) {
    return {
      neutral: { ...base.neutral, ...(incoming.neutral || {}) },
      windup: { ...base.windup, ...(incoming.windup || {}) },
      strike: { ...base.strike, ...(incoming.strike || {}) },
    };
  }

  const CONFIG = {
    crossbow: {
      label: 'Crossbow', projectileSprite: 'assets/toolsprites/arrow_long.png',
      projectileCount: 1, spreadDeg: 0, damage: 16, speedPxS: 720,
      rangeTiles: 9, projectileRadiusPx: 7, knockbackPxS: 260,
      reloadDurationS: 1.04, reloadSequence: 'attack', reloadWindupFrac: 0.55, reloadStrikeFrac: 0.56, reloadHoldFrac: 0.692,
      fireDurationS: 1.04, fireSequence: 'attack', fireWindupFrac: 0.05, fireAtFrac: 0.08, fireHoldFrac: 0.17,
      staminaCost: 10,
      firePose: clonePoseSet(AUTHORED_FIRE_POSE),
      loadPose: clonePoseSet(AUTHORED_LOAD_POSE),
    },
    scatterbow: {
      label: 'Scatterbow', projectileSprite: 'assets/toolsprites/arrow_short.png',
      projectileCount: 6, spreadDeg: 28, damage: 5, speedPxS: 650,
      rangeTiles: 6.5, projectileRadiusPx: 4, knockbackPxS: 110,
      reloadDurationS: 1.04, reloadSequence: 'attack', reloadWindupFrac: 0.55, reloadStrikeFrac: 0.56, reloadHoldFrac: 0.692,
      fireDurationS: 1.04, fireSequence: 'attack', fireWindupFrac: 0.05, fireAtFrac: 0.08, fireHoldFrac: 0.17,
      staminaCost: 14,
      firePose: clonePoseSet(AUTHORED_FIRE_POSE),
      loadPose: clonePoseSet(AUTHORED_LOAD_POSE),
    },
  };

  function init(injectedDeps) {
    deps = injectedDeps;
    deps.debugLog?.('Ranged update: full-volume mobile-safe firing audio, 15-degree projectile sprite windows, and affliction comet trails.');
  }

  function applyConfig(config) {
    if (!config) return;
    for (const key of Object.keys(CONFIG)) {
      if (!config[key]) continue;
      const incoming = config[key]; // Used to merge tuning without discarding either authored action pose set.
      CONFIG[key] = {
        ...CONFIG[key],
        ...incoming,
        firePose: mergePoseSet(CONFIG[key].firePose, incoming.firePose),
        loadPose: mergePoseSet(CONFIG[key].loadPose, incoming.loadPose),
      };
    }
  }

  function defFor(itemKey) { return CONFIG[itemKey] || null; }
  function poseForAction(def, kind) { return kind === 'load' ? def.loadPose : def.firePose; }
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

  function idlePose(itemKey, owner = null) {
    const def = defFor(itemKey); // Used to select the loaded or empty neutral stance for players and bandits.
    if (!def) return null;
    return (isLoaded(itemKey, owner) ? def.firePose : def.loadPose)?.neutral || null;
  }

  // Interpolated by bandit load/fire visuals; scale stays on the action's
  // neutral pose and is applied once to the holder instead of lerping.
  const POSE_CHANNELS = ['x', 'y', 'z', 'pitch', 'yaw', 'roll', 'bodyYaw'];
  function lerpPose(a, b, amount) {
    const k = Math.max(0, Math.min(1, amount)); // Used to keep every authored channel inside its two endpoint poses.
    const pose = {}; // Used as the complete interpolated transform returned to the bandit holder.
    for (const key of POSE_CHANNELS) pose[key] = (a?.[key] ?? 0) + ((b?.[key] ?? 0) - (a?.[key] ?? 0)) * k;
    return pose;
  }

  function poseAtAction(def, kind, progress) {
    const poses = poseForAction(def, kind); // Used as the action-specific neutral/windup/strike source.
    const t = Math.max(0, Math.min(1, progress)); // Used to safely evaluate the authored phase fractions.
    const sequence = kind === 'load' ? (def.reloadSequence || 'attack') : (def.fireSequence || 'fire'); // Used to decouple action state from pose playback order.
    const wf = kind === 'load' ? (def.reloadWindupFrac ?? 0.55) : (def.fireWindupFrac ?? 0.02); // Used as the authored windup arrival point.
    const sf = kind === 'load' ? (def.reloadStrikeFrac ?? 0.56) : (def.fireAtFrac ?? 0.18); // Used as the authored strike arrival point.
    const hf = kind === 'load' ? (def.reloadHoldFrac ?? sf) : (def.fireHoldFrac ?? sf); // Used as the end of the strike hold.
    if (sequence === 'attack') {
      if (t <= wf) return lerpPose(poses.neutral, poses.windup, t / Math.max(0.0001, wf));
      if (t <= sf) return lerpPose(poses.windup, poses.strike, (t - wf) / Math.max(0.0001, sf - wf));
    } else if (sequence === 'load') {
      if (t <= wf) return lerpPose(poses.neutral, poses.windup, t / Math.max(0.0001, wf));
      return lerpPose(poses.windup, poses.neutral, (t - wf) / Math.max(0.0001, 1 - wf));
    } else if (t <= sf) {
      return lerpPose(poses.neutral, poses.strike, t / Math.max(0.0001, sf));
    }
    if (t <= hf) return { ...poses.strike };
    return lerpPose(poses.strike, poses.neutral, (t - hf) / Math.max(0.0001, 1 - hf));
  }

  function playerActionLabel(itemKey) {
    const def = defFor(itemKey);
    if (!def) return 'Fire';
    if (playerAction) return playerAction.kind === 'load' ? 'Loading…' : 'Firing…';
    return isLoaded(itemKey) ? `Fire ${def.label}` : `Load ${def.label}`;
  }

  // Crossbows play one cue. Scatterbows layer the corresponding cue with a
  // short delay and subtle pitch spread so the six-shot volley reads as a
  // chorus rather than six perfectly phase-aligned copies of one recording.
  function playRangedActionSfx(itemKey, kind, owner = null) {
    const audio = window.AudioSystem; // Used to route player cues through global SFX volume and bandit cues through existing distance falloff.
    const cfgEntry = audio?.combatSfxConfig?.()[kind === 'load' ? 'rangedLoad' : 'rangedFire']; // Used as the shared recording/config for this action phase.
    if (!cfgEntry) return;
    const delays = itemKey === 'scatterbow'
      ? (kind === 'load' ? SCATTERBOW_LOAD_CHORUS_MS : SCATTERBOW_FIRE_CHORUS_MS)
      : [0]; // Used to keep an ordinary crossbow mechanically singular.
    const layerVolumeScale = itemKey === 'scatterbow' ? (kind === 'load' ? 0.55 : 0.52) : 1; // Used to keep layered scatterbow cues balanced against one full-volume crossbow cue.
    lastAudioEvent = `${owner?.id || 'player'}:${itemKey}:${kind}:${delays.length}-layer`;
    delays.forEach((delayMs, index) => {
      const playLayer = () => {
        const pitch = itemKey === 'scatterbow' ? 0.96 + index * 0.018 : 1; // Used to keep delayed layers distinct without changing the source's identity.
        if (owner) {
          const spatialCfg = { ...cfgEntry, volume: (Number(cfgEntry.volume) || 0.8) * layerVolumeScale }; // Used because playCreatureSfxAt applies its own distance scale internally.
          audio.playCreatureSfxAt?.(owner, spatialCfg, pitch);
        } else audio.playOneShotSfx?.(cfgEntry, layerVolumeScale, pitch);
      };
      if (delayMs > 0) setTimeout(playLayer, delayMs);
      else playLayer();
    });
  }

  function startPlayerAction(itemKey) {
    const def = defFor(itemKey);
    if (!def || playerAction) return false;
    const loaded = isLoaded(itemKey);
    const kind = loaded ? 'fire' : 'load';
    if (kind === 'fire') window.ResourceSystem?.spendStamina?.(deps.player, def.staminaCost, `${def.label} fire`);
    const durationS = kind === 'fire' ? def.fireDurationS : def.reloadDurationS;
    const pose = poseForAction(def, kind); // Used by the player visual for this specific load/fire action.
    playerAction = { itemKey, def, kind, t: 0, durationS, fired: false };
    deps.triggerRangedWeaponVisual?.(durationS, {
      sequence: kind === 'fire' ? (def.fireSequence || 'fire') : (def.reloadSequence || 'attack'),
      pose,
      windupFrac: kind === 'load' ? (def.reloadWindupFrac ?? 0.55) : (def.fireWindupFrac ?? 0.02),
      strikeFrac: kind === 'fire' ? def.fireAtFrac : (def.reloadStrikeFrac ?? 0.56),
      holdFrac: kind === 'fire' ? (def.fireHoldFrac ?? Math.min(0.99, def.fireAtFrac + 0.12)) : (def.reloadHoldFrac ?? 0.57),
    });
    if (kind === 'load') playRangedActionSfx(itemKey, 'load');
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
      playRangedActionSfx(action.itemKey, 'fire');
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

  // Player ranged weapons do not currently have their own progression tree,
  // so they remain affliction-free unless a weapon config explicitly supplies
  // afflictionBonuses. Enemy arrows reuse the same sharp-tag baseline as the
  // bandit's melee attacks, keeping damage, resource rings, and trail color in
  // agreement instead of applying a visual-only color.
  function projectileAfflictionBonuses(def, team) {
    const configured = def.afflictionBonuses; // Used by future ammunition/weapon definitions to declare their exact status payload.
    if (configured && typeof configured === 'object') return { ...configured };
    if (team === 'player') return {};
    return { ...(window.ResourceSystem?.afflictionBonusesForTag?.(def.damageType || 'sharp') || {}) };
  }

  // Reuses the resource-ring/melee-trail palette verbatim. An affliction-free
  // projectile still receives a white comet, matching the melee cone trail's
  // plain-hit fallback rather than disappearing entirely.
  function projectileTrailColors(afflictionBonuses) {
    const ids = Object.keys(afflictionBonuses || {}).filter(id => Number(afflictionBonuses[id]) > 0); // Used as both the visual lane list and mobile debug payload.
    if (!ids.length) return [{ id: 'plain', color: 0xffffff }];
    return ids.slice(0, PROJECTILE_TRAIL_MAX_LANES).map(id => {
      const raw = window.ResourceRings?.AFFLICTION_COLORS?.[id]; // Used to stay synchronized with resource rings and melee trails.
      const color = raw == null ? 0xffffff : (window.ResourceRings?.neonizeColor?.(raw) ?? raw); // Stored on the lane for its additive vertex gradient.
      return { id, color };
    });
  }

  function createProjectileTrails(scene, colorEntries, radiusPx) {
    const trailWidth = Math.max(0.012, radiusPx / deps.TILE * 0.32); // Used as the head width and spacing scale for this projectile's ribbons.
    return colorEntries.map((entry, laneIndex) => {
      const geometry = new THREE.BufferGeometry(); // Preallocated once and updated in place while this projectile flies.
      const positions = new Float32Array(PROJECTILE_TRAIL_MAX_POINTS * 2 * 3); // Holds left/right ribbon edges for every path sample.
      const colors = new Float32Array(PROJECTILE_TRAIL_MAX_POINTS * 2 * 3); // Holds the tail-to-head brightness gradient in the affliction hue.
      const indices = []; // Connects consecutive left/right pairs into the ribbon triangles.
      for (let i = 0; i < PROJECTILE_TRAIL_MAX_POINTS - 1; i++) {
        const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
        indices.push(a, b, c, b, d, c);
      }
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geometry.setIndex(indices);
      geometry.setDrawRange(0, 0);
      const material = new THREE.MeshBasicMaterial({
        transparent: true, opacity: 0.86, depthWrite: false, vertexColors: true,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      }); // Additive unlit material matches the existing melee trail treatment.
      const mesh = new THREE.Mesh(geometry, material); // Lives in world space so the tail stays behind as the projectile advances.
      mesh.name = `projectileCometTrail:${entry.id}`;
      mesh.frustumCulled = false;
      mesh.renderOrder = (deps.heldObjectRenderOrder || 1.5) - 0.01;
      scene.add(mesh);
      return { mesh, color: new THREE.Color(entry.color), id: entry.id, laneIndex, laneCount: colorEntries.length, trailWidth };
    });
  }

  function updateProjectileTrails(p) {
    const point = { x: p.x / deps.TILE, y: p.mesh.position.y - 0.01, z: p.y / deps.TILE }; // Appended in world space to form the visible comet path.
    const prior = p.trailPoints[p.trailPoints.length - 1]; // Used to suppress duplicate samples while a projectile is stationary/spawning.
    if (!prior || Math.hypot(point.x - prior.x, point.z - prior.z) > 0.01) p.trailPoints.push(point);
    while (p.trailPoints.length > PROJECTILE_TRAIL_MAX_POINTS) p.trailPoints.shift();
    const count = p.trailPoints.length; // Controls the active portion of each preallocated ribbon.
    if (count < 2) return;

    for (const lane of p.trailMeshes) {
      const positionAttr = lane.mesh.geometry.attributes.position; // Updated with the current sampled flight path.
      const colorAttr = lane.mesh.geometry.attributes.color; // Updated with a dim-tail/bright-head comet gradient.
      const laneOffset = (lane.laneIndex - (lane.laneCount - 1) / 2) * lane.trailWidth * 1.45; // Separates simultaneous affliction colors without widening one ribbon.
      for (let i = 0; i < count; i++) {
        const sample = p.trailPoints[i]; // Supplies this ribbon cross-section's world position.
        const before = p.trailPoints[Math.max(0, i - 1)]; // Supplies a stable tangent at the projectile head.
        const after = p.trailPoints[Math.min(count - 1, i + 1)]; // Supplies a stable tangent at the projectile tail.
        const dx = after.x - before.x, dz = after.z - before.z;
        const length = Math.hypot(dx, dz) || 1; // Normalizes the path-perpendicular vector safely.
        const px = -dz / length, pz = dx / length;
        const u = i / Math.max(1, count - 1); // Drives the narrow/dim tail into the wider/brighter projectile head.
        const halfWidth = lane.trailWidth * (0.18 + u * 0.82);
        const centerX = sample.x + px * laneOffset, centerZ = sample.z + pz * laneOffset;
        const vertex = i * 2;
        positionAttr.setXYZ(vertex, centerX - px * halfWidth, sample.y, centerZ - pz * halfWidth);
        positionAttr.setXYZ(vertex + 1, centerX + px * halfWidth, sample.y, centerZ + pz * halfWidth);
        const intensity = 0.05 + 0.95 * u * u; // Keeps the tail colored but makes its projectile-adjacent core read brightest.
        colorAttr.setXYZ(vertex, lane.color.r * intensity, lane.color.g * intensity, lane.color.b * intensity);
        colorAttr.setXYZ(vertex + 1, lane.color.r * intensity, lane.color.g * intensity, lane.color.b * intensity);
      }
      positionAttr.needsUpdate = true;
      colorAttr.needsUpdate = true;
      lane.mesh.geometry.setDrawRange(0, (count - 1) * 6);
      lane.mesh.visible = true;
    }
  }

  function spawnProjectile(itemKey, x, y, angle, team, owner) {
    const def = defFor(itemKey);
    if (!def) return null;
    const scene = deps.getActiveScene();
    const mesh = createProjectileMesh(def, def.projectileRadiusPx);
    const afflictionBonuses = projectileAfflictionBonuses(def, team); // Passed to both impact damage and comet color selection.
    const trailColors = projectileTrailColors(afflictionBonuses); // Used to build one readable ribbon lane per applied affliction.
    const surfaceY = deps.worldSurfaceY(x, y);
    mesh.position.set(x / deps.TILE, surfaceY + 0.55, y / deps.TILE);
    scene.add(mesh);
    const p = {
      itemKey, def, team, owner, mesh, visual: mesh.userData.visual,
      x, y, prevX: x, prevY: y,
      vx: Math.cos(angle) * def.speedPxS, vy: Math.sin(angle) * def.speedPxS,
      angle, distancePx: 0, maxDistancePx: def.rangeTiles * deps.TILE,
      areaId: deps.getCurrentArea(), pngRot: -angle + Math.PI / 2, perpState: {}, dead: false,
      afflictionBonuses, trailAfflictionIds: trailColors.map(entry => entry.id),
      trailPoints: [{ x: x / deps.TILE, y: surfaceY + 0.54, z: y / deps.TILE }], // Seeds the comet at the muzzle so it appears on the first moving frame.
      trailMeshes: createProjectileTrails(scene, trailColors, def.projectileRadiusPx),
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
        deps.damageCreature(c, p.def.damage, p.prevX, p.prevY, p.def.knockbackPxS, { tag: 'sharp', ranged: true, afflictionBonuses: p.afflictionBonuses });
        deps.awardRangedMastery?.(p.itemKey);
        return true;
      }
      return false;
    }
    const player = deps.player;
    const hitRadius = p.def.projectileRadiusPx + deps.playerRadius;
    if (pointSegmentDistanceSq(player.x, player.y, p.prevX, p.prevY, p.x, p.y) <= hitRadius ** 2) {
      deps.damagePlayer(p.def.damage, p.prevX, p.prevY, p.def.knockbackPxS, { tag: 'sharp', ranged: true, afflictionBonuses: p.afflictionBonuses });
      return true;
    }
    return false;
  }

  function updateProjectileVisual(p, dt) {
    // This is intentionally the animal PNG-plane rotation path only. The
    // root sphere's vx/vy and trajectory angle are never changed here.
    const rawTargetRotY = -p.angle + Math.PI / 2;
    const perps = deps.cameraRelativeCreaturePerps();
    const deadRad = PROJECTILE_PERP_DEAD_RAD; // Dedicated 15-degree window; player and animal portrait tuning remains unchanged.
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
    for (const lane of p.trailMeshes || []) {
      lane.mesh.parent?.remove(lane.mesh);
      lane.mesh.geometry?.dispose?.();
      lane.mesh.material?.dispose?.();
    }
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
      updateProjectileTrails(p);
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
    if (kind === 'load') playRangedActionSfx(itemKey, 'load', c);
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
        playRangedActionSfx(itemKey, 'fire', c);
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
    if (!def) return;
    const actionPose = action ? poseForAction(def, action.kind) : null; // Used for action-specific neutral/windup/strike playback.
    const neutral = actionPose?.neutral || idlePose(c.def.rangedWeaponKey, c);
    holder.scale.setScalar(Number.isFinite(Number(neutral?.scale)) ? Math.max(0.1, Number(neutral.scale)) : 1);
    let pose = neutral;
    if (action) {
      const t = Math.min(1, action.t / action.durationS);
      pose = poseAtAction(def, action.kind, t);
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
    cancelBanditAction, disposeOwner, playerLockRangePx, playerIdlePose: itemKey => idlePose(itemKey),
    get config() { return CONFIG; },
  };
  window.__rangedDebug = {
    get projectiles() { return projectiles.map(p => ({ itemKey: p.itemKey, team: p.team, x: p.x, y: p.y, vx: p.vx, vy: p.vy, distancePx: p.distancePx, trailAfflictionIds: [...p.trailAfflictionIds] })); },
    get playerAction() { return playerAction ? { ...playerAction, def: undefined } : null; },
    get lastEvent() { return lastEvent; },
    get lastAudioEvent() { return lastAudioEvent; },
    setPlayerLoaded: (itemKey, loaded) => setLoaded(itemKey, loaded),
    firePlayer: (itemKey) => startPlayerAction(itemKey),
    idlePose: itemKey => ({ ...idlePose(itemKey) }),
    snapshot: () => ({
      latestChange: 'Mobile-safe full-volume fire cue; 15-degree projectile sprite deadzone; affliction-colored comet trails.',
      lastEvent, lastAudioEvent, projectileDeadzoneDeg: PROJECTILE_PERP_DEAD_DEG,
      activeProjectiles: projectiles.length,
      activeTrailMeshes: projectiles.reduce((sum, p) => sum + (p.trailMeshes?.length || 0), 0),
      loaded: Object.fromEntries(playerLoaded),
    }),
  };
})();
