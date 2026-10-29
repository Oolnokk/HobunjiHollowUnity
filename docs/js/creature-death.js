(() => {
  'use strict';

  // Grounded recorded knockdown -> persistent lootable corpse. The authored
  // breakThrow bank is shared with zero-Footing prone hits; its last frame
  // remains posed on a corpse instead of launching it into the sky.

  // Extracted out of game.js following the same window.<Namespace> +
  // init(deps) pattern already used by js/farm-buildings.js and
  // js/farm-animals.js. currentArea/grid are reassigned wholesale on
  // zone transitions, so they're threaded through as getters rather than
  // captured references.
  const DEATH_TUMBLE_TILES_MIN = 0.35; // Short grounded slide: the fatal hit must not send corpses several tiles away.
  const DEATH_TUMBLE_TILES_MAX = 1.15; // Upper bound for a walkable, wall-checked resting tile.
  const DEATH_AIM_CONE_RAD = 35 * Math.PI / 180; // Varies the horizontal knockback angle without steering through obstacles.
  const DEATH_FALLBACK_DURATION_S = 0.7; // Simple local tip-over when the recorded clip or rig is unavailable.
  const DEATH_BLOOD_PARTICLES = 24; // Reused in a single lightweight Points emitter only when a colored spray is called for.
  const activeSprays = new Set(); // Updated and disposed by updateCorpses; never left attached to a looted or unloaded body.
  let deps = null;

  const deathDebug = { lastBegin: null, lastRecovery: null }; // Used by mobile diagnostics to expose chosen cause/clip and interrupted transitions.
  function init(injectedDeps) { deps = injectedDeps; }

  function _deathCause(c) {
    const raw = String(c._lethalDamageCause || c._lastDamageCause || c.lastDamageTag || '').toLowerCase();
    if (/poison|venom|toxin|infected/.test(raw)) return 'poison';
    if (/burn|fire|flame|kindling|heat|lava/.test(raw)) return 'fire';
    if (/bleed|sharp|slash|pierc|cut|blade|shrapnel/.test(raw)) return 'sharp';
    if (/blunt|impact|collision|crush|hammer|punch|club|fall/.test(raw)) return 'blunt';
    if (/frost|cold|ice/.test(raw)) return 'frost';
    if (/shock|lightning|electric/.test(raw)) return 'shock';
    if (/acid|corros|corrod/.test(raw)) return 'acid';
    return 'other';
  }

  function _impactDirection(c, fromX, fromY) {
    if (!Number.isFinite(fromX) || !Number.isFinite(fromY)) return 'front';
    const angle = Math.atan2(fromY - c.y, fromX - c.x) - (Number(c.facing) || 0);
    const x = Math.cos(angle), y = Math.sin(angle);
    return Math.abs(x) > Math.abs(y) ? (x > 0 ? 'front' : 'back') : (y > 0 ? 'right' : 'left');
  }

  function _colorForCause(cause) {
    const colors = window.HOBUNJI_CONFIG?.resourceRings?.afflictionColors || {};
    if (cause === 'sharp') return colors.bleedingHealth || '#d11832';
    if (cause === 'poison') return colors.poisonedHealth || '#17a44b';
    if (cause === 'frost') return colors.frostbittenStamina || '#89ecfa';
    if (cause === 'shock') return '#b989f5';
    if (cause === 'acid') return '#bfde36';
    if (cause === 'other') return '#b6a49b'; // An untyped fall/impact gives a little earth-toned dust, not invented blood.
    return null;
  }

  function _spawnSpray(c) {
    const color = _colorForCause(c.deathCause);
    const THREE = window.THREE;
    const grp = c.avatarRef?.group;
    if (!color || !THREE?.Points || !grp?.parent?.add || !THREE.BufferGeometry) return;
    const positions = new Float32Array(DEATH_BLOOD_PARTICLES * 3); // Local emitter positions animated in _updateSprays each frame.
    const velocities = new Float32Array(DEATH_BLOOD_PARTICLES * 3); // Single-use initial radial velocities for the same emitter.
    const away = Number(c.deathAwayAngle) || 0;
    for (let i = 0; i < DEATH_BLOOD_PARTICLES; i++) {
      const j = i * 3;
      const a = away + (Math.random() - 0.5) * 2.1;
      const speed = 0.6 + Math.random() * 1.45;
      positions[j] = (Math.random() - 0.5) * 0.12;
      positions[j + 1] = (Math.random() - 0.5) * 0.3;
      positions[j + 2] = (Math.random() - 0.5) * 0.12;
      velocities[j] = Math.cos(a) * speed;
      velocities[j + 1] = 0.6 + Math.random() * 1.6;
      velocities[j + 2] = Math.sin(a) * speed;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color, size: 0.065, sizeAttenuation: true, transparent: true,
      depthWrite: false, opacity: 0.98,
    });
    const points = new THREE.Points(geometry, material);
    points.position.copy(grp.position);
    points.position.y += (Number(c.halfHeight) || 0.3) * 0.25;
    grp.parent.add(points);
    activeSprays.add({ points, positions, velocities, age: 0, duration: 0.65 });
  }

  function _updateSprays(dt) {
    for (const effect of activeSprays) {
      const step = Math.max(0, Math.min(0.1, dt));
      effect.age += step;
      for (let i = 0; i < effect.positions.length; i += 3) {
        effect.positions[i] += effect.velocities[i] * step;
        effect.positions[i + 1] += effect.velocities[i + 1] * step;
        effect.positions[i + 2] += effect.velocities[i + 2] * step;
        effect.velocities[i + 1] -= 5 * step;
      }
      effect.points.geometry.attributes.position.needsUpdate = true;
      effect.points.material.opacity = Math.max(0, 1 - effect.age / effect.duration);
      if (effect.age >= effect.duration) {
        effect.points.parent?.remove(effect.points);
        effect.points.geometry.dispose();
        effect.points.material.dispose();
        activeSprays.delete(effect);
      }
    }
  }

  function _prepareScorch(c) {
    if (c.deathCause !== 'fire') return;
    const clonedMaterials = []; // Disposed alongside the owning avatar instead of leaking when the corpse is looted.
    c._deathScorch = clonedMaterials; // Per-corpse tint records preserve the unmodified material color across animation frames.
    c.avatarRef?.group?.traverse?.(object => {
      if (!object.isMesh || !object.material) return;
      const clone = material => {
        if (!material?.color?.clone || !material.clone) return material;
        const individual = material.clone();
        individual.onBeforeCompile = material.onBeforeCompile; // Keep pants occlusion/depth shaders when fire creates a corpse-local material.
        individual.customProgramCacheKey = material.customProgramCacheKey;
        clonedMaterials.push({
          material: individual, color: individual.color.clone(),
          emissive: individual.emissive?.clone?.() || null,
        });
        return individual;
      };
      object.material = Array.isArray(object.material) ? object.material.map(clone) : clone(object.material);
    });
    const priorDispose = c.avatarRef?.dispose; // Original avatar teardown still owns textures, meshes and original materials.
    if (typeof priorDispose === 'function') {
      c.avatarRef.dispose = function disposeScorchedAvatar(...args) {
        for (const entry of clonedMaterials) entry.material.dispose?.();
        clonedMaterials.length = 0;
        return priorDispose.apply(this, args);
      };
    }
  }

  function _updateScorch(c) {
    if (!c._deathScorch) return;
    const brightness = 1 - 0.94 * Math.min(1, (Number(c.deathT) || 0) / 0.32); // Lerp across the first 320 ms, then hold the char on the corpse.
    for (const entry of c._deathScorch) {
      entry.material.color.copy(entry.color).multiplyScalar(brightness);
      if (entry.emissive) entry.material.emissive.copy(entry.emissive).multiplyScalar(brightness);
    }
  }

  // Walks outward from the creature's own tile within a cone around
  // awayAngle (the direction the killing blow traveled), looking for a
  // tile the corpse can actually rest on — falls back to its own tile
  // if nothing nearby is valid (map edge, water, cliff face, ...).
  // The tumble must not hop a wall: every point along the flight line has
  // to be open ground too, or a body could land in the next room/vault
  // (or inside rock) where it can never be reached or looted.
  function _pathClear(fromX, fromY, toX, toY) {
    const TILE = deps.TILE;
    const steps = Math.max(1, Math.ceil(Math.hypot(toX - fromX, toY - fromY) / (TILE * 0.2)));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (!deps.canOccupyAt(fromX + (toX - fromX) * t, fromY + (toY - fromY) * t, TILE * 0.2)) return false;
    }
    return true;
  }

  function _findRestTile(c, awayAngle) {
    const TILE = deps.TILE;
    const startCol = Math.floor(c.x / TILE), startRow = Math.floor(c.y / TILE);
    for (let attempt = 0; attempt < 12; attempt++) {
      const ang = awayAngle + (Math.random() * 2 - 1) * DEATH_AIM_CONE_RAD;
      const distTiles = DEATH_TUMBLE_TILES_MIN + Math.random() * (DEATH_TUMBLE_TILES_MAX - DEATH_TUMBLE_TILES_MIN);
      const col = deps.clamp(Math.round(startCol + Math.cos(ang) * distTiles), 0, (c.areaCols || deps.COLS) - 1);
      const row = deps.clamp(Math.round(startRow + Math.sin(ang) * distTiles), 0, (c.areaRows || deps.ROWS) - 1);
      const cx = (col + 0.5) * TILE, cy = (row + 0.5) * TILE;
      if (deps.canOccupyAt(cx, cy, TILE * 0.3) && _pathClear(c.x, c.y, cx, cy)) return { x: cx, y: cy, col, row };
    }
    return { x: (startCol + 0.5) * TILE, y: (startRow + 0.5) * TILE, col: startCol, row: startRow };
  }

  function beginInternal(c, fromX, fromY) {
    // A corpse doesn't get further updateCreatureMesh() calls to keep
    // its resource ring synced/rebuilt, so drop it now rather than
    // leaving a stale 0-health ring hovering over the corpse forever.
    window.ResourceRings?.disposeRingHud(c);
    // A bandit's weapon lives in its own world-space toolHolder (see
    // updateBanditToolMesh), not parented under the avatar the tumble
    // below animates -- hide it now rather than leaving it floating in
    // place, disconnected from the corpse, once the fall starts.
    if (c._banditToolHolder) c._banditToolHolder.visible = false;
    if (c._banditRangedToolHolder) c._banditRangedToolHolder.visible = false;
    if (c._banditFlaskToolHolder) c._banditFlaskToolHolder.visible = false;
    if (c._banditTrailMesh) c._banditTrailMesh.visible = false;
    c.deathCause = _deathCause(c); // The genuinely lethal Health transaction wins over earlier afflictions or weapon hits.
    const sourceIsDistant = Number.isFinite(fromX) && Number.isFinite(fromY)
      && Math.hypot(c.x - fromX, c.y - fromY) > 1e-4; // A lethal DoT normally passes the victim's own coordinates; it has no impulse.
    const isDamageOverTime = /^(bleedingHealth|poisonedHealth|burningHealth|kindlingHealth)$/.test(String(c._lethalDamageCause || ''));
    const hasImpactImpulse = sourceIsDistant && !isDamageOverTime; // Used to prevent ambient/DoT deaths from skidding across a tile arbitrarily.
    const awayAngle = hasImpactImpulse ? Math.atan2(c.y - fromY, c.x - fromX) : (Number(c.facing) || 0);
    const rest = hasImpactImpulse ? _findRestTile(c, awayAngle) : {
      x: c.x, y: c.y,
      col: deps.clamp(Math.floor(c.x / deps.TILE), 0, (c.areaCols || deps.COLS) - 1),
      row: deps.clamp(Math.floor(c.y / deps.TILE), 0, (c.areaRows || deps.ROWS) - 1),
    }; // Bleeding, poison, burning and unforced deaths collapse where they stood.
    c.deathDirection = _impactDirection(c, fromX, fromY);
    c.deathAwayAngle = awayAngle;
    c.deathHadImpulse = hasImpactImpulse; // Mobile-readable proof of whether the corpse actually received a horizontal hit.
    c.state = 'dying';
    c.deathT = 0;
    const clipSeconds = window.ImpactRagdollPlayback?.startCreatureDeath?.(c, c.deathDirection) || 0;
    c.deathRecorded = clipSeconds > 0;
    c.deathDurationS = c.deathRecorded ? clipSeconds * (c.deathCause === 'blunt' ? 0.78 : 1) : DEATH_FALLBACK_DURATION_S;
    c.deathStartX = c.x; c.deathStartY = c.y;
    c.deathTargetX = rest.x; c.deathTargetY = rest.y;
    c.corpseCol = rest.col; c.corpseRow = rest.row;
    // Recorded root Y stays near the ground. No airborne hop, full flips, or
    // long-distance throw; the last authored frame is the corpse's pose.
    c.deathRestRotZ = Math.PI / 2; // Used only by the missing-clip fallback and pre-placed bodies.
    c.deathRestRotX = 0;
    c.deathRestRotY = Number(c.groupRot) || 0;
    c.scaleY = 1;
    c.avatarRef.group.scale.y = c.isBandit && Number(c.visualScaleY) > 0 ? c.visualScaleY : 1; // Humanoid hostiles keep their species body height on the corpse; animals keep the existing reset.
    // Snap the cutout's two planes back to the exact pose they were
    // built with, undoing any camera-relative deadzone drift
    // (updateCreatureMesh's pngRot/perpState smoothing) frozen in at the
    // moment of death — otherwise the corpse lands a few degrees off
    // "flat" instead of showing its clean flat face.
    if (c.avatarRef.frontPlane) c.avatarRef.frontPlane.rotation.y = Math.PI / 2;
    if (c.avatarRef.backPlane)  c.avatarRef.backPlane.rotation.y  = -Math.PI / 2;
    // legsPivot carries no extra ±PI/2 twist (see updateCreatureMesh), so
    // its own matching "rest" value is plain 0, not PI/2 -- planeDelta 0
    // means pngRot === groupRot, the same nominal-facing convention the
    // planes' own PI/2 rest implicitly encodes once combined with their
    // baked mesh orientation.
    if (c.avatarRef.legsPivot) c.avatarRef.legsPivot.rotation.y = 0;
    deps.corpseObjects.add(c);
    _prepareScorch(c);
    _spawnSpray(c);
  }

  // A lethal hit must never strand an entity after game.js removes it from
  // hostileObjects. If a secondary visual/path calculation throws during
  // beginInternal(), settle it on its current tile as a lootable corpse and
  // record the original error for the in-game diagnostics.
  function recover(c, fromX, fromY, error) {
    if (!c || !deps) return false;
    const TILE = deps.TILE;
    const col = deps.clamp(Math.floor((Number(c.x) || 0) / TILE), 0, (c.areaCols || deps.COLS) - 1); // Used as the guaranteed fallback corpse column.
    const row = deps.clamp(Math.floor((Number(c.y) || 0) / TILE), 0, (c.areaRows || deps.ROWS) - 1); // Used as the guaranteed fallback corpse row.
    try { window.ResourceRings?.disposeRingHud(c); } catch (_) {}
    if (c._banditToolHolder) c._banditToolHolder.visible = false;
    if (c._banditRangedToolHolder) c._banditRangedToolHolder.visible = false;
    if (c._banditFlaskToolHolder) c._banditFlaskToolHolder.visible = false;
    if (c._banditTrailMesh) c._banditTrailMesh.visible = false;
    window.ImpactRagdollPlayback?.stopCreatureDeath?.(c); // A failed particle/path setup cannot leave the fallback corpse with a half-played recorded pivot.
    c.deathRecorded = false;
    c.health = 0;
    c.state = 'corpse';
    c.corpseCol = col; c.corpseRow = row;
    c.x = (col + 0.5) * TILE; c.y = (row + 0.5) * TILE;
    c.vx = 0; c.vy = 0;
    c.knockbackT = 0;
    c.hitFlashT = 0;
    c.telegraphState = null;
    deps.corpseObjects.add(c);
    const grp = c.avatarRef?.group; // Used to force the fallback corpse into a visible lying pose.
    let visualError = null; // Used to retain a secondary fallback-pose failure without preventing corpse registration.
    try {
      if (grp) {
        const g = c.areaGrid || deps.getGrid();
        const surfY = g[row]?.[col] ? deps.tileSurfaceYInArea(g[row][col], c.areaId) : 0;
        const restHeight = (Number(c.halfHeight) || 0) * 0.12;
        grp.position.set(c.x / TILE, surfY + restHeight, c.y / TILE);
        grp.rotation.set(0, Number(c.groupRot) || 0, Math.PI / 2);
        if (c.avatarRef.frontPlane) c.avatarRef.frontPlane.rotation.y = Math.PI / 2;
        if (c.avatarRef.backPlane) c.avatarRef.backPlane.rotation.y = -Math.PI / 2;
        if (c.avatarRef.legsPivot) c.avatarRef.legsPivot.rotation.y = 0;
        if (c.avatarRef.legs) c.avatarRef.legs.update(0, 0, true);
      }
    } catch (caught) { visualError = caught; }
    const reason = [error, visualError].filter(Boolean).map(value => value?.stack || value?.message || String(value)).join(' | ') || 'unknown death-transition interruption'; // Used in the copyable mobile debug record.
    deathDebug.lastRecovery = { at: Date.now(), creature: c.id || c.def?.label || 'creature', areaId: c.areaId || '', col, row, reason };
    window.__farmLog?.(`[creature-death] recovered ${deathDebug.lastRecovery.creature} as a corpse after: ${reason}`, 'combat');
    return true;
  }

  function begin(c, fromX, fromY) {
    deathDebug.lastBegin = { at: Date.now(), creature: c?.id || c?.def?.label || 'creature', areaId: c?.areaId || '', cause: _deathCause(c), recording: false };
    try {
      beginInternal(c, fromX, fromY);
      deathDebug.lastBegin.recording = !!c.deathRecorded;
      deathDebug.lastBegin.hadImpulse = !!c.deathHadImpulse;
      return true;
    } catch (error) {
      return recover(c, fromX, fromY, error);
    }
  }

  // Uses the authored throw all the way to its prone tail. Blunt kills play
  // faster and briefly rewind only the last 18% of the recorded fall before
  // returning to that same tail (a small impact recoil). No recoil on blades,
  // DoTs, fire, or other elemental causes.
  function _recordedPhase(c, t) {
    if (c.deathCause !== 'blunt') return t;
    if (t < 0.78) return t / 0.78;
    if (t < 0.89) return 1 - 0.18 * ((t - 0.78) / 0.11);
    return 0.82 + 0.18 * ((t - 0.89) / 0.11);
  }

  function updateCorpses(dt) {
    _updateSprays(dt);
    const TILE = deps.TILE;
    const currentArea = deps.getCurrentArea();
    for (const c of deps.corpseObjects) {
      if (c.state !== 'dying' || c.areaId !== currentArea) continue;
      c.deathT = Math.min(c.deathDurationS, c.deathT + Math.max(0, Number(dt) || 0));
      const t = Math.min(1, c.deathT / c.deathDurationS);
      const eased = 1 - Math.pow(1 - t, 2); // Short grounded slide; no ballistic arc.
      c.x = c.deathStartX + (c.deathTargetX - c.deathStartX) * eased;
      c.y = c.deathStartY + (c.deathTargetY - c.deathStartY) * eased;

      const grp = c.avatarRef.group;
      const g = c.areaGrid || deps.getGrid();
      const col = deps.clamp(Math.floor(c.x / TILE), 0, (c.areaCols || deps.COLS) - 1);
      const row = deps.clamp(Math.floor(c.y / TILE), 0, (c.areaRows || deps.ROWS) - 1);
      const surfY = g[row]?.[col] ? deps.tileSurfaceYInArea(g[row][col], c.areaId) : 0;
      const halfHeight = Number(c.halfHeight) || 0.3;
      const bodyHeightFraction = c.deathRecorded ? 1 - 0.18 * eased : 1 - 0.88 * eased; // Keeps recorded root offsets aligned, but lets fallback corpses descend continuously instead of snapping downward at the last frame.
      grp.position.set(c.x / TILE, surfY + halfHeight * bodyHeightFraction, c.y / TILE);
      if (c.groundShadow) c.groundShadow.position.set(grp.position.x, surfY + deps.characterGroundShadowSurfaceOffset(), grp.position.z);

      if (c.deathRecorded) {
        window.ImpactRagdollPlayback.sampleCreatureDeath(c, _recordedPhase(c, t));
      } else {
        // Missing/unloaded recording: simply fall in place and lie flat,
        // rather than restoring the obsolete multi-flip sky-launch.
        grp.rotation.set(0, c.deathRestRotY, c.deathRestRotZ * eased);
        c.avatarRef.legs?.update?.(dt, 0, true);
      }
      _updateScorch(c);
      if (t >= 1) {
        c.state = 'corpse';
        c.x = c.deathTargetX; c.y = c.deathTargetY;
        grp.position.set(c.x / TILE, surfY + halfHeight * (c.deathRecorded ? 0.82 : 0.12), c.y / TILE);
        if (!c.deathRecorded) grp.rotation.set(c.deathRestRotX, c.deathRestRotY, c.deathRestRotZ);
      }
    }
  }

  // Places an entity straight into the settled, flat corpse pose on its
  // current tile, with no tumble — for bodies that are already dead when the
  // player arrives (cave catacomb skeletons). They join corpseObjects and loot
  // exactly like any other settled corpse.
  function settleAsCorpse(c, opts = {}) {
    if (!c?.avatarRef?.group) return false;
    const TILE = deps.TILE;
    window.ResourceRings?.disposeRingHud(c);
    if (c._banditToolHolder) c._banditToolHolder.visible = false;
    if (c._banditRangedToolHolder) c._banditRangedToolHolder.visible = false;
    if (c._banditFlaskToolHolder) c._banditFlaskToolHolder.visible = false;
    if (c._banditTrailMesh) c._banditTrailMesh.visible = false;
    const col = deps.clamp(Math.floor(c.x / TILE), 0, (c.areaCols || deps.COLS) - 1);
    const row = deps.clamp(Math.floor(c.y / TILE), 0, (c.areaRows || deps.ROWS) - 1);
    c.health = 0;
    c.state = 'corpse';
    c.corpseCol = col; c.corpseRow = row;
    c.deathTargetX = c.x; c.deathTargetY = c.y;
    c.deathRestRotZ = Math.PI / 2;
    c.deathRestRotX = Number.isFinite(opts.roll) ? opts.roll : (Math.random() * 2 - 1) * 0.22;
    c.deathRestRotY = Number.isFinite(opts.yaw) ? opts.yaw : Math.random() * Math.PI * 2;
    c.scaleY = 1;
    const grp = c.avatarRef.group;
    grp.scale.y = 1;
    if (c.avatarRef.frontPlane) c.avatarRef.frontPlane.rotation.y = Math.PI / 2; // Same clean flat face as a settled ragdoll (see beginInternal).
    if (c.avatarRef.backPlane) c.avatarRef.backPlane.rotation.y = -Math.PI / 2;
    if (c.avatarRef.legsPivot) c.avatarRef.legsPivot.rotation.y = 0;
    if (c.avatarRef.legs) c.avatarRef.legs.update(0, 0, true);
    const g = c.areaGrid || deps.getGrid();
    const surfY = g[row]?.[col] ? deps.tileSurfaceYInArea(g[row][col], c.areaId) : 0;
    grp.position.set(c.x / TILE, surfY + c.halfHeight * 0.12, c.y / TILE);
    grp.rotation.set(c.deathRestRotX, c.deathRestRotY, c.deathRestRotZ);
    if (c.groundShadow) c.groundShadow.position.set(grp.position.x, surfY + deps.characterGroundShadowSurfaceOffset(), grp.position.z);
    deps.corpseObjects.add(c);
    return true;
  }

  window.CreatureDeath = {
    init,
    begin,
    settleAsCorpse,
    recover,
    updateCorpses,
    getDebug: () => ({ lastBegin: deathDebug.lastBegin && { ...deathDebug.lastBegin }, lastRecovery: deathDebug.lastRecovery && { ...deathDebug.lastRecovery }, activeSprays: activeSprays.size }),
    formatDebug: () => deathDebug.lastRecovery
      ? `Creature death recovery: ${deathDebug.lastRecovery.creature} at ${deathDebug.lastRecovery.areaId}:${deathDebug.lastRecovery.col},${deathDebug.lastRecovery.row} | ${deathDebug.lastRecovery.reason}`
      : `Creature death: last begin ${deathDebug.lastBegin?.creature || 'none'} (${deathDebug.lastBegin?.cause || 'unknown'}, recorded=${!!deathDebug.lastBegin?.recording}); no recovery needed`,
  };
})();
