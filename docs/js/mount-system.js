(() => {
  'use strict';

  // Mounted riding (V key / D-pad down calls a mount in or dismisses it —
  // see game.js's 'toggleMount' input action). Extracted out of game.js
  // following the same window.<Namespace> + init(deps) pattern already used
  // by js/combat/*.js: this module owns the ride-state machine and its
  // private state; anything it needs that lives in game.js (player, scene,
  // helper functions, and a handful of shared mutable camera-look fields)
  // is handed over once via init(). See window.Combat's init(deps) call in
  // game.js for the sibling precedent.
  let deps = null;
  const DEFAULT_ANIMAL_GAIT_CYCLES_PER_SECOND = 2; // Baseline for every runtime animal species with a run sprite unless that species authors an override.

  function init(injectedDeps) {
    deps = injectedDeps;
    installSharedCreatureGait();
  }

  // 'none': no mount out. 'rushingIn': a just-summoned mount is dashing in
  // off-screen toward the player. 'mountingUp': the mount has arrived and
  // the player is lerping up onto it. 'mounted': steady-state riding —
  // movement input steers the mount (see updateMountedMovement) instead of
  // the player. 'dismountingDown': the player is lerping back off the
  // mount. 'rushingOut': the (now riderless) mount is dashing away
  // off-screen before despawning.
  let mountRideState = 'none';
  let mountRideEntity = null;
  let mountAngle = 0;              // the mount's own heading; momentum-turned in updateMountedMovement
  let mountCurrentSpeedPxS = 0;    // the mount's current forward speed (momentum — see MOUNT_TURN_RATE_MIN/MAX)
  let mountTransitionT = 0;        // 0..1 progress through the current mountingUp/dismountingDown lerp
  let mountTransitionFromX = 0, mountTransitionFromY = 0;
  let mountDismountTargetX = 0, mountDismountTargetY = 0;
  let mountRushOutAngle = 0;
  let mountRushOutT = 0;
  let mountRushInT = 0;
  const mountRenderSync = { active: false, beforeXzDriftTiles: 0, afterXzDriftTiles: 0, verticalCorrectionTiles: 0 }; // Used by Pixel Probe to expose rider/carrier render drift on mobile.
  const mountFootstepDebug = { emitted: 0, surfaceKey: null, lastDistancePx: 0, lastVolumeScale: 0, lastAtMs: 0, lastTransition: null, nativeLayers: 0, gaitHz: DEFAULT_ANIMAL_GAIT_CYCLES_PER_SECOND }; // Exposed through window.Mounts.footstepDebug for console-free gait/audio checks.

  // A rush-in/out transition well beyond the camera's visible range, so
  // "calling" a mount reads as it charging in from off-screen rather than
  // just popping in nearby.
  const MOUNT_RUSH_SPEED_PX = 900;
  const MOUNT_ARRIVE_PX_TILES = 0.55;
  const MOUNT_DESPAWN_DIST_TILES = 9;
  const MOUNT_SPAWN_DIST_TILES = 9;
  const MOUNT_TRANSITION_S = 0.35; // how long the rider's lerp on/off the mount takes

  // Two native layers are intentional. A single recorded footstep tops out
  // at HTMLAudioElement volume=1, so merely raising the old 3x multiplier to
  // 6x can be silently clamped. Two simultaneous 3x layers preserve the
  // requested second doubling while staying on the reliable native-audio path.
  const MOUNT_FOOTSTEP_VOLUME_SCALE = 6.0;
  const MOUNT_FOOTSTEP_NATIVE_LAYERS = 2;

  // Momentum: a stationary mount can pivot quickly, but the faster it's
  // already moving the more sluggishly it can turn — trading maneuverability
  // for the speed a mount gives you (see updateMountedMovement).
  const MOUNT_TURN_RATE_MAX = Math.PI * 3.2; // rad/s at a standstill
  const MOUNT_TURN_RATE_MIN = Math.PI * 0.9; // rad/s at full mountSpeed

  function mountAllowedInArea(area) {
    // Used by summon and both update paths: every authored/farmhouse/cavern
    // interior rejects mounts, while all exterior exploration areas allow them.
    return area === 'farm' || area === 'town' || deps._isZoneArea(area);
  }

  // ── Shared creature gait ──────────────────────────────────────────
  // game.js already routes ordinary creature movement through
  // AudioSystem.footstepAdvance(c, distPx) before updateCreatureAnimFrame().
  // This turns that EXISTING hook into the single gait authority:
  //   actual movement -> species gait phase -> run1->run2 contact -> footstep.
  // It directly advances c.runFrame and then pins _animLastX/Y to the position
  // just consumed. game.js's existing renderer/compositor therefore displays
  // the shared gait phase without advancing a second distance-based animation.
  //
  // Mounts use the exact same hook. Their only specialization is volume:
  // when a mount contact occurs, this hook emits the loud mount playback and
  // returns false to game.js's generic tickCreatureFootsteps caller so that
  // caller does NOT add a second quiet companion footstep.
  function isCreatureGaitState(state) {
    return !!(state?.def && Array.isArray(state.def.sprites?.run) && state.def.sprites.run.length);
  }

  function creatureGaitRate(state) {
    const def = state?.def; // Actual runtime species definition carried by every creature entity.
    if (!def) return DEFAULT_ANIMAL_GAIT_CYCLES_PER_SECOND;
    if (state?.creatureKey === 'grehlr') def.gaitCyclesPerSecond = 2; // Grehlr is explicitly authored at two complete gait cycles / contacts per second.
    if (!(Number(def.gaitCyclesPerSecond) > 0)) def.gaitCyclesPerSecond = DEFAULT_ANIMAL_GAIT_CYCLES_PER_SECOND; // Lazily covers species registered after Mounts.init too.
    return Number(def.gaitCyclesPerSecond);
  }

  function creatureMotionSpeedPxS(state, distPx) {
    const vx = Number(state?.vx) || 0; // Current actual creature velocity where the movement path exposes it.
    const vy = Number(state?.vy) || 0; // Paired with vx above so diagonal movement keeps the same gait frequency.
    const velocitySpeed = Math.hypot(vx, vy);
    if (velocitySpeed > 0.001) return velocitySpeed;
    const def = state?.def || {};
    const authoredSpeed = state?.stableRole === 'mount'
      ? Number(def.mountSpeed)
      : Number(def.moveSpeed || def.chaseSpeed || def.mountSpeed);
    return Number.isFinite(authoredSpeed) && authoredSpeed > 0.001
      ? authoredSpeed
      : Math.max(0.001, Number(distPx) || 0.001);
  }

  function resetCreatureGait(state) {
    if (!state) return;
    state._creatureGaitFrameProgress = 0; // Absolute fractional frame progress; one full run-array traversal equals one gait cycle.
    state._creatureGaitLastHz = creatureGaitRate(state);
    state._creatureGaitLastContactCount = 0;
    state.runFrame = 0;
    state.runFrameDistPx = 0;
    state.footstepAccum = 0; // Clears the superseded independent creature footstep-distance accumulator.
    state._animLastX = state.x; // Prevents the legacy run-frame distance path from consuming the same movement again.
    state._animLastY = state.y;
  }

  function advanceCreatureGait(state, distPx) {
    if (!isCreatureGaitState(state) || !(distPx > 0)) return 0;
    const runFrames = state.def.sprites.run; // Actual species run sprites; their count defines visual phases in one gait cycle.
    const frameCount = Math.max(1, runFrames.length);
    const gaitHz = creatureGaitRate(state);
    const motionSpeedPxS = creatureMotionSpeedPxS(state, distPx);

    // dist/speed is locomotion time represented by ACTUAL ground covered.
    // Unblocked movement therefore remains exactly gaitHz regardless of
    // walk/chase/mount speed, while collision-shortened motion slows/stops
    // the gait instead of making the feet skate against an obstacle.
    const locomotionSeconds = Math.max(0, distPx / motionSpeedPxS);
    const frameAdvance = locomotionSeconds * gaitHz * frameCount;
    const startProgress = Number.isFinite(state._creatureGaitFrameProgress)
      ? state._creatureGaitFrameProgress
      : Math.max(0, Number(state.runFrame) || 0);
    const rawEndProgress = startProgress + frameAdvance;
    const nearestBoundary = Math.round(rawEndProgress); // Snap harmless FP residue at an authored frame boundary.
    const endProgress = Math.abs(rawEndProgress - nearestBoundary) < 1e-9 ? nearestBoundary : rawEndProgress;
    const firstBoundary = Math.floor(startProgress) + 1;
    const lastBoundary = Math.floor(endProgress);
    let contactCount = 0;

    for (let boundary = firstBoundary; boundary <= lastBoundary; boundary++) {
      if (frameCount === 1) {
        // A one-frame species has no literal run2 image; its cycle wrap is
        // the only possible gait contact until the species gets another frame.
        contactCount++;
        continue;
      }
      const fromFrame = ((boundary - 1) % frameCount + frameCount) % frameCount;
      const toFrame = (boundary % frameCount + frameCount) % frameCount;
      if (fromFrame === 0 && toFrame === 1) contactCount++; // Authored step frame: run1 -> run2.
    }

    state._creatureGaitFrameProgress = endProgress; // Unwrapped so exact boundary crossings cannot double-fire after a cycle wrap.
    state._creatureGaitLastHz = gaitHz;
    state._creatureGaitLastContactCount = contactCount;
    state._creatureGaitLastSpeedPxS = motionSpeedPxS;
    state.runFrame = ((Math.floor(endProgress) % frameCount) + frameCount) % frameCount;
    state.runFrameDistPx = 0;
    state.footstepAccum = 0;
    state._animLastX = state.x;
    state._animLastY = state.y;
    if (contactCount & 1) state.footstepFoot = !state.footstepFoot;
    return contactCount;
  }

  function creatureGaitDebugSnapshot(state) {
    if (!state) return null;
    const runFrames = state.def?.sprites?.run || [];
    return {
      species: state.creatureKey || state.def?.label || 'creature',
      gaitHz: creatureGaitRate(state),
      runFrame: Number(state.runFrame) || 0,
      runFrameCount: runFrames.length,
      frameProgress: Number(state._creatureGaitFrameProgress) || 0,
      lastContacts: Number(state._creatureGaitLastContactCount) || 0,
      lastSpeedPxS: Number(state._creatureGaitLastSpeedPxS) || 0,
    };
  }

  function installSharedCreatureGait() {
    const audio = window.AudioSystem;
    if (!audio) {
      window.__farmLog?.('[creature-gait] AudioSystem unavailable; shared gait hook not installed', 'audio');
      return;
    }

    let configuredSpecies = 0; // Mobile-readable count proving that the real runtime species table received the baseline.
    for (const [speciesKey, def] of Object.entries(deps?.CREATURE_DB || {})) {
      if (!Array.isArray(def?.sprites?.run) || !def.sprites.run.length) continue;
      if (!(Number(def.gaitCyclesPerSecond) > 0)) def.gaitCyclesPerSecond = DEFAULT_ANIMAL_GAIT_CYCLES_PER_SECOND;
      if (speciesKey === 'grehlr') def.gaitCyclesPerSecond = 2; // Explicit Grehlr authoring: exactly two complete gait cycles / step contacts per second.
      configuredSpecies++;
    }

    if (!audio.__sharedCreatureGaitInstalled) {
      const originalFootstepAdvance = audio.footstepAdvance.bind(audio); // Preserves the existing player/NPC/trail distance helper for non-creature callers.
      audio.footstepAdvance = (state, distPx, stridePx) => {
        if (stridePx == null && isCreatureGaitState(state)) {
          const contactCount = advanceCreatureGait(state, distPx);
          if (!contactCount) return false;
          if (state.stableRole === 'mount') {
            // The shared gait owns the contact. Mounts merely substitute their
            // loud playback here; returning false suppresses game.js's generic
            // quiet-companion playback for this same contact.
            for (let i = 0; i < contactCount; i++) emitMountFootstep(state, distPx, state.def.sprites.run.length >= 2 ? 'run1->run2' : 'single-run-frame-cycle');
            return false;
          }
          return true;
        }
        return originalFootstepAdvance(state, distPx, stridePx);
      };
      audio.advanceCreatureGait = advanceCreatureGait;
      audio.resetCreatureGait = resetCreatureGait;
      audio.creatureGaitDebugSnapshot = creatureGaitDebugSnapshot;
      audio.__sharedCreatureGaitInstalled = true;
    }

    window.CreatureGait = {
      DEFAULT_CYCLES_PER_SECOND: DEFAULT_ANIMAL_GAIT_CYCLES_PER_SECOND,
      advance: advanceCreatureGait,
      reset: resetCreatureGait,
      debugSnapshot: creatureGaitDebugSnapshot,
    };
    window.__farmLog?.(`[creature-gait] shared gait installed baseline=${DEFAULT_ANIMAL_GAIT_CYCLES_PER_SECOND.toFixed(2)}Hz species=${configuredSpecies} grehlr=${Number(deps?.CREATURE_DB?.grehlr?.gaitCyclesPerSecond || 0).toFixed(2)}Hz`, 'audio');
  }

  function emitMountFootstep(m, distPx, transition = 'run1->run2') {
    const audio = window.AudioSystem; // Existing surface/water routing and recorded-footstep pool.
    if (!audio) return;
    const distanceToPlayer = Math.hypot(m.x - deps.player.x, m.y - deps.player.y);
    const earshotPx = Math.max(deps.TILE, Number(audio.FOOTSTEP_EARSHOT_PX) || deps.TILE * 9);
    if (distanceToPlayer > earshotPx) return;
    const falloff = mountRideState === 'mounted' ? 1 : Math.max(0, 1 - distanceToPlayer / earshotPx);
    const totalVolumeScale = MOUNT_FOOTSTEP_VOLUME_SCALE * falloff;
    if (totalVolumeScale <= 0.002) return;
    const perLayerVolumeScale = totalVolumeScale / MOUNT_FOOTSTEP_NATIVE_LAYERS;
    const panRangePx = Math.max(deps.TILE, Number(audio.FOOTSTEP_PAN_RANGE_PX) || deps.TILE * 5);
    const pan = mountRideState === 'mounted' ? 0 : deps.clamp((m.x - deps.player.x) / panRangePx, -1, 1);
    const tile = audio.footstepTileAt(m.areaId, m.x, m.y, m.areaGrid);
    const surfaceKey = audio.footstepSurfaceKey(m.areaId, tile?.type ?? null);
    const gaitDebug = audio.creatureGaitDebugSnapshot?.(m);

    for (let layer = 0; layer < MOUNT_FOOTSTEP_NATIVE_LAYERS; layer++) {
      audio.playFootstepSfx(m.areaId, tile, perLayerVolumeScale, pan);
    }
    mountFootstepDebug.emitted++;
    mountFootstepDebug.lastDistancePx = distPx;
    mountFootstepDebug.lastVolumeScale = totalVolumeScale;
    mountFootstepDebug.lastAtMs = Math.round(performance.now());
    mountFootstepDebug.lastTransition = transition;
    mountFootstepDebug.nativeLayers = MOUNT_FOOTSTEP_NATIVE_LAYERS;
    mountFootstepDebug.gaitHz = gaitDebug?.gaitHz ?? creatureGaitRate(m);
    if (surfaceKey !== mountFootstepDebug.surfaceKey) {
      mountFootstepDebug.surfaceKey = surfaceKey;
      window.__farmLog?.(`[mount-footstep] surface=${surfaceKey} transition=${transition} volumeScale=${totalVolumeScale.toFixed(2)} layers=${MOUNT_FOOTSTEP_NATIVE_LAYERS} gait=${mountFootstepDebug.gaitHz.toFixed(2)}Hz`, 'audio');
    }
  }

  // Mounts have no private gait. The caller tells us whether its movement
  // function already passed through game.js's generic tickCreatureFootsteps
  // hook; if not (steady ridden movement), we feed this one movement slice
  // through the SAME AudioSystem.footstepAdvance creature-gait hook exactly once.
  function updateMountLocomotion(m, dt, moving, movedPx, gaitAlreadyAdvanced = false) {
    if (moving && movedPx > 0 && !gaitAlreadyAdvanced) {
      window.AudioSystem?.footstepAdvance?.(m, movedPx);
    }
    deps.updateCreatureAnimFrame(m, dt, moving);
  }

  function toggleMount() {
    if (mountRideState === 'none') beginSummonMount();
    else if (mountRideState === 'mounted' || mountRideState === 'rushingIn') beginDismissMount();
    // 'mountingUp'/'dismountingDown'/'rushingOut': mid-transition, ignore
    // extra presses until it settles into a steady state.
  }

  function beginSummonMount() {
    if (deps.player.climbing) {
      deps.showToast('Finish climbing before calling your mount.', false);
      window.__farmLog?.('[mount] summon blocked during cliff climb', 'wildlife');
      return;
    }
    if (!mountAllowedInArea(deps.getCurrentArea())) {
      deps.showToast('Mounts cannot be called indoors.', false);
      return;
    }
    const activeMountId = deps.getActiveMountId();
    const activeStabled = activeMountId ? deps.getStable().find(s => s.id === activeMountId) : null;
    if (!activeStabled || !deps.CREATURE_DB[activeStabled.kind]) {
      deps.showToast('No mount set in your stable.', false);
      return;
    }
    // Off-screen, in a random-ish direction behind the player rather than
    // always dead behind, so the rush-in doesn't look identical every time
    // — clamped well inside the active area's bounds (with a margin), since
    // a fixed-distance point in an arbitrary direction can easily land
    // outside a smaller map.
    const spawnAngle = deps.player.angle + Math.PI + (deps.rnd() - 0.5) * (Math.PI * 0.6);
    const spawnMarginPx = deps.TILE * 1.5;
    const maxX = deps.getActiveCols() * deps.TILE - spawnMarginPx, maxY = deps.getActiveRows() * deps.TILE - spawnMarginPx;
    const spawnX = deps.clamp(deps.player.x + Math.cos(spawnAngle) * deps.TILE * MOUNT_SPAWN_DIST_TILES, spawnMarginPx, maxX);
    const spawnY = deps.clamp(deps.player.y + Math.sin(spawnAngle) * deps.TILE * MOUNT_SPAWN_DIST_TILES, spawnMarginPx, maxY);
    const mount = deps.makeCreatureEntity(activeStabled.kind, spawnX, spawnY, {
      isCompanion: true, name: activeStabled.name, homeX: spawnX, homeY: spawnY, state: 'idle',
      master: deps.player, genotype: activeStabled.genotype, stableRole: 'mount',
    });
    if (!mount) return;
    deps.companionObjects.add(mount);
    mountRideEntity = mount;
    mountRideState = 'rushingIn';
    mountAngle = deps.player.angle;
    mountCurrentSpeedPxS = 0;
    mountRushInT = 0;
    window.AudioSystem?.resetCreatureGait?.(mount);
    mountFootstepDebug.emitted = 0;
    mountFootstepDebug.surfaceKey = null;
    mountFootstepDebug.lastDistancePx = 0;
    mountFootstepDebug.lastVolumeScale = 0;
    mountFootstepDebug.lastAtMs = 0;
    mountFootstepDebug.lastTransition = null;
    mountFootstepDebug.nativeLayers = 0;
    mountFootstepDebug.gaitHz = creatureGaitRate(mount);
  }

  function beginDismissMount() {
    if (!mountRideEntity) { mountRideState = 'none'; return; }
    mountRideState = 'dismountingDown';
    mountTransitionT = 0;
    mountTransitionFromX = deps.player.x; mountTransitionFromY = deps.player.y;
    // Dismount to the mount's side (perpendicular to its heading) rather
    // than right in front of/behind it.
    const sideAngle = mountAngle + Math.PI / 2;
    mountDismountTargetX = mountRideEntity.x + Math.cos(sideAngle) * deps.TILE * 0.6;
    mountDismountTargetY = mountRideEntity.y + Math.sin(sideAngle) * deps.TILE * 0.6;
  }

  function updateMountRide(dt) {
    deps.btnCallMount?.classList.toggle('active', mountRideState !== 'none');
    if (mountRideState === 'none') return;
    const m = mountRideEntity;
    if (!m || m.health <= 0) {
      if (m) { deps.despawnCreature(m); deps.companionObjects.delete(m); }
      mountRideState = 'none'; mountRideEntity = null;
      return;
    }
    const currentArea = deps.getCurrentArea();
    if (!mountAllowedInArea(currentArea)) {
      // Covers rushing, mounting, mounted, and dismissing states alike; no
      // mount mesh is ever relocated into an interior scene.
      deps.despawnCreature(m);
      deps.companionObjects.delete(m);
      mountRideState = 'none'; mountRideEntity = null;
      deps.btnCallMount?.classList.remove('active');
      window.__farmLog?.(`[mount] dismissed at indoor boundary (${currentArea})`, 'wildlife');
      return;
    }

    // An area transition can land mid-ride-transition, not just mid-mounted.
    if (m.areaId !== currentArea) {
      relocateMountForAreaChange(m);
      if (mountRideState === 'mountingUp' || mountRideState === 'dismountingDown') {
        mountTransitionFromX = deps.player.x; mountTransitionFromY = deps.player.y;
      }
      if (mountRideState === 'dismountingDown') {
        const sideAngle = mountAngle + Math.PI / 2;
        mountDismountTargetX = m.x + Math.cos(sideAngle) * deps.TILE * 0.6;
        mountDismountTargetY = m.y + Math.sin(sideAngle) * deps.TILE * 0.6;
      }
    }

    if (mountRideState === 'rushingIn') {
      mountRushInT += dt;
      const stepStartX = m.x, stepStartY = m.y;
      const moving = deps.moveCreatureToward(m, deps.player.x, deps.player.y, MOUNT_RUSH_SPEED_PX, dt);
      const movedPx = Math.hypot(m.x - stepStartX, m.y - stepStartY);
      const aim = Math.atan2(deps.player.y - m.y, deps.player.x - m.x);
      m.facing = aim;
      deps.updateCreatureMesh(m, dt, aim);
      // moveCreatureToward already invoked the generic creature footstep hook,
      // which is now also the shared gait authority. Render only; do not
      // advance the same displacement a second time here.
      updateMountLocomotion(m, dt, moving, movedPx, true);
      if (Math.hypot(deps.player.x - m.x, deps.player.y - m.y) <= deps.TILE * MOUNT_ARRIVE_PX_TILES || mountRushInT >= 6) {
        mountRideState = 'mountingUp';
        mountTransitionT = 0;
        mountTransitionFromX = deps.player.x; mountTransitionFromY = deps.player.y;
        mountAngle = m.facing;
      }
      return;
    }

    if (mountRideState === 'mountingUp') {
      mountTransitionT = Math.min(1, mountTransitionT + dt / MOUNT_TRANSITION_S);
      deps.player.x = mountTransitionFromX + (m.x - mountTransitionFromX) * mountTransitionT;
      deps.player.y = mountTransitionFromY + (m.y - mountTransitionFromY) * mountTransitionT;
      deps.player.vx = 0; deps.player.vy = 0;
      deps.updateCreatureMesh(m, dt, m.facing);
      updateMountLocomotion(m, dt, false, 0);
      if (mountTransitionT >= 1) mountRideState = 'mounted';
      return;
    }

    if (mountRideState === 'mounted') {
      // Position/heading itself is driven by updateMountedMovement; this just
      // keeps the mount mesh synchronized with its logical transform.
      deps.updateCreatureMesh(m, dt, m.facing);
      return;
    }

    if (mountRideState === 'dismountingDown') {
      mountTransitionT = Math.min(1, mountTransitionT + dt / MOUNT_TRANSITION_S);
      deps.player.x = mountTransitionFromX + (mountDismountTargetX - mountTransitionFromX) * mountTransitionT;
      deps.player.y = mountTransitionFromY + (mountDismountTargetY - mountTransitionFromY) * mountTransitionT;
      deps.player.vx = 0; deps.player.vy = 0;
      deps.updateCreatureMesh(m, dt, m.facing);
      updateMountLocomotion(m, dt, false, 0);
      if (mountTransitionT >= 1) {
        mountRideState = 'rushingOut';
        mountRushOutAngle = m.facing + Math.PI;
        mountRushOutT = 0;
      }
      return;
    }

    if (mountRideState === 'rushingOut') {
      mountRushOutT += dt;
      const targetX = m.x + Math.cos(mountRushOutAngle) * deps.TILE * 2;
      const targetY = m.y + Math.sin(mountRushOutAngle) * deps.TILE * 2;
      const stepStartX = m.x, stepStartY = m.y;
      const moving = deps.moveCreatureToward(m, targetX, targetY, MOUNT_RUSH_SPEED_PX, dt);
      const movedPx = Math.hypot(m.x - stepStartX, m.y - stepStartY);
      deps.updateCreatureMesh(m, dt, mountRushOutAngle);
      // Same as rush-in: moveCreatureToward already consumed this movement
      // through the one shared gait/contact hook.
      updateMountLocomotion(m, dt, moving, movedPx, true);
      if (Math.hypot(deps.player.x - m.x, deps.player.y - m.y) >= deps.TILE * MOUNT_DESPAWN_DIST_TILES || mountRushOutT >= 3) {
        deps.despawnCreature(m);
        deps.companionObjects.delete(m);
        mountRideState = 'none';
        mountRideEntity = null;
      }
      return;
    }
  }

  // Steady mounted movement gives the mount ownership of the rendered world
  // transform. Both entities keep their existing logical coordinates, but the
  // rider uses the carrier's FINAL smoothed mesh position.
  function pinMountedRiderMesh(riderMesh, seatLift = 0) {
    const m = mountRideEntity;
    const carrierPosition = m?.avatarRef?.group?.position;
    if (mountRideState !== 'mounted' || !carrierPosition || !riderMesh?.position) {
      mountRenderSync.active = false;
      return false;
    }

    const riderSeatOffsetY = (Number(seatLift) || 0) - (Number(m.groundLift ?? m.halfHeight) || 0);
    const targetY = carrierPosition.y + riderSeatOffsetY;
    mountRenderSync.active = true;
    mountRenderSync.beforeXzDriftTiles = Math.hypot(riderMesh.position.x - carrierPosition.x, riderMesh.position.z - carrierPosition.z);
    mountRenderSync.verticalCorrectionTiles = targetY - riderMesh.position.y;
    riderMesh.position.set(carrierPosition.x, targetY, carrierPosition.z);
    mountRenderSync.afterXzDriftTiles = Math.hypot(riderMesh.position.x - carrierPosition.x, riderMesh.position.z - carrierPosition.z);
    return true;
  }

  // Catch the mount up after farm/town/wilderness area transitions instead
  // of teaching every player-transition call site about mounts.
  function relocateMountForAreaChange(m) {
    const oldScene = m.scene || deps.scene;
    oldScene.remove(m.avatarRef.group);
    if (m.groundShadow) oldScene.remove(m.groundShadow);
    const newScene = deps.getActiveScene();
    m.scene = newScene;
    m.areaGrid = deps.getActiveGrid();
    m.areaCols = deps.getActiveCols();
    m.areaRows = deps.getActiveRows();
    m.areaId = deps.getCurrentArea();
    m.x = deps.player.x; m.y = deps.player.y;
    m.vx = 0; m.vy = 0;
    window.AudioSystem?.resetCreatureGait?.(m);
    mountFootstepDebug.surfaceKey = null;
    const col = deps.clamp(Math.floor(m.x / deps.TILE), 0, m.areaCols - 1);
    const row = deps.clamp(Math.floor(m.y / deps.TILE), 0, m.areaRows - 1);
    const surfY = m.areaGrid[row]?.[col] ? deps.tileSurfaceYInArea(m.areaGrid[row][col], m.areaId) : 0;
    m.avatarRef.group.position.set(m.x / deps.TILE, surfY + (m.groundLift ?? m.halfHeight) * (m.scaleY ?? 1), m.y / deps.TILE);
    newScene.add(m.avatarRef.group);
    if (m.groundShadow) {
      m.groundShadow.position.set(m.x / deps.TILE, surfY + deps.characterGroundShadowSurfaceOffset(), m.y / deps.TILE);
      newScene.add(m.groundShadow);
    }
    window.ResourceRings?.disposeRingHud(m);
  }

  // Replaces game.js's normal on-foot updateMovement while mounted.
  function updateMountedMovement(dt) {
    const m = mountRideEntity;
    if (!m) { mountRideState = 'none'; return; }
    const currentArea = deps.getCurrentArea();
    if (!mountAllowedInArea(currentArea)) {
      deps.despawnCreature(m);
      deps.companionObjects.delete(m);
      mountRideState = 'none'; mountRideEntity = null;
      return;
    }
    if (m.areaId !== currentArea) relocateMountForAreaChange(m);

    const keyboardVector = deps.getKeyboardVector();
    const usingKeyboard = keyboardVector.active;
    let ix = usingKeyboard ? keyboardVector.x : deps.input.x;
    let iy = usingKeyboard ? keyboardVector.y : deps.input.y;
    const inputLen = Math.hypot(ix, iy);
    let inputStrength = 0;
    if (inputLen > 0.001) {
      inputStrength = usingKeyboard ? 1 : deps.clamp(inputLen, 0, 1);
      ix /= inputLen; iy /= inputLen;
    }

    if (deps.isShoulderSurfMode() && (ix !== 0 || iy !== 0)) {
      const aim = deps.cameraFacingAngleRad();
      const s = Math.sin(aim), c = Math.cos(aim);
      const rIx = -ix * s - iy * c;
      const rIy =  ix * c - iy * s;
      ix = rIx; iy = rIy;
    }
    deps.player.inputX = ix; deps.player.inputY = iy; deps.player.inputStrength = inputStrength;

    const topSpeed = (m.def?.mountSpeed || deps.MOVE_SPEED) * deps.getAlchemySpeedMul() * deps.getDevGlobalSpeedMul();
    if (inputStrength > 0.001) {
      mountCurrentSpeedPxS = Math.min(topSpeed, mountCurrentSpeedPxS + deps.ACCEL * dt);
      const desiredAngle = Math.atan2(iy, ix);
      const speedRatio = topSpeed > 0 ? deps.clamp(mountCurrentSpeedPxS / topSpeed, 0, 1) : 0;
      const turnRate = MOUNT_TURN_RATE_MAX - (MOUNT_TURN_RATE_MAX - MOUNT_TURN_RATE_MIN) * speedRatio;
      const diff = deps.angleDiff(desiredAngle, mountAngle);
      mountAngle += deps.clamp(diff, -turnRate * dt, turnRate * dt);
    } else {
      mountCurrentSpeedPxS = Math.max(0, mountCurrentSpeedPxS - deps.DECEL * dt);
    }

    const stepStartX = m.x, stepStartY = m.y;
    if (mountCurrentSpeedPxS > 0.01) {
      const desiredX = m.x + Math.cos(mountAngle) * mountCurrentSpeedPxS * dt;
      const desiredY = m.y + Math.sin(mountAngle) * mountCurrentSpeedPxS * dt;
      const minX = deps.PLAYER_RADIUS, maxX = deps.getActiveCols() * deps.TILE - deps.PLAYER_RADIUS;
      const minY = deps.PLAYER_RADIUS, maxY = deps.getActiveRows() * deps.TILE - deps.PLAYER_RADIUS;
      const nextX = deps.clamp(desiredX, minX, maxX), nextY = deps.clamp(desiredY, minY, maxY);
      if (deps.canPlayerOccupy(nextX, m.y)) m.x = nextX; else mountCurrentSpeedPxS *= 0.4;
      if (deps.canPlayerOccupy(m.x, nextY)) m.y = nextY; else mountCurrentSpeedPxS *= 0.4;
    }

    const movedDx = m.x - stepStartX;
    const movedDy = m.y - stepStartY;
    const movedPx = Math.hypot(movedDx, movedDy);
    if (dt > 0 && movedPx > 0) {
      m.vx = movedDx / dt;
      m.vy = movedDy / dt;
    } else {
      m.vx = 0; m.vy = 0;
    }
    m.facing = mountAngle;
    deps.player.x = m.x; deps.player.y = m.y;
    deps.player.vx = 0; deps.player.vy = 0;
    updateMountLocomotion(m, dt, mountCurrentSpeedPxS > 5 && movedPx > 0, movedPx);

    // Rider facing remains independent of mount heading while look input is active.
    let facingAngle = deps.getFacingAngle();
    if (deps.getControllerLookActive()) {
      const diff = deps.angleDiff(deps.getControllerLookAngle(), facingAngle);
      facingAngle += diff * Math.min(1, deps.FACING_LERP * 2.5 * dt);
    } else if (deps.isDesktop && deps.getMouseLookActive()) {
      if (performance.now() - deps.getLastMouseMoveTime() > deps.MOUSE_IDLE_MS) {
        deps.setMouseLookActive(false);
      } else {
        const diff = deps.angleDiff(deps.getMouseLookAngle(), facingAngle);
        facingAngle += diff * Math.min(1, deps.FACING_LERP * 2.5 * dt);
      }
    } else {
      const diff = deps.angleDiff(mountAngle, facingAngle);
      facingAngle += diff * Math.min(1, deps.FACING_LERP * dt);
    }
    deps.setFacingAngle(facingAngle);
    deps.player.angle = facingAngle;
  }

  window.Mounts = {
    init,
    toggleMount,
    updateMountRide,
    updateMountedMovement,
    pinMountedRiderMesh,
    get rideState() { return mountRideState; },
    get rideEntity() { return mountRideEntity; },
    get renderSync() { return { ...mountRenderSync }; },
    get footstepDebug() { return { ...mountFootstepDebug }; },
  };
})();
