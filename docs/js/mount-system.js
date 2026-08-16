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
  function init(injectedDeps) { deps = injectedDeps; }

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

  // A rush-in/out transition well beyond the camera's visible range, so
  // "calling" a mount reads as it charging in from off-screen rather than
  // just popping in nearby.
  const MOUNT_RUSH_SPEED_PX = 900;
  const MOUNT_ARRIVE_PX_TILES = 0.55;
  const MOUNT_DESPAWN_DIST_TILES = 9;
  const MOUNT_SPAWN_DIST_TILES = 9;
  const MOUNT_TRANSITION_S = 0.35; // how long the rider's lerp on/off the mount takes
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

  function toggleMount() {
    if (mountRideState === 'none') beginSummonMount();
    else if (mountRideState === 'mounted' || mountRideState === 'rushingIn') beginDismissMount();
    // 'mountingUp'/'dismountingDown'/'rushingOut': mid-transition, ignore
    // extra presses until it settles into a steady state.
  }

  function beginSummonMount() {
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
    // outside a smaller map (creatureCanEnterTile rejects any move once the
    // mount is stuck outside those bounds, freezing it at spawn forever).
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
    // An area transition (e.g. riding through the farm's town gate) can
    // land mid-ride-transition, not just mid-'mounted'. The 'mounted'
    // state's own area-change handling lives in updateMountedMovement
    // (relocateMountForAreaChange), which only runs while mountRideState
    // === 'mounted' — every other phase here needs the same relocation, or
    // the rider gets dragged toward stale old-area coordinates for the rest
    // of an in-flight lerp.
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
      const moving = deps.moveCreatureToward(m, deps.player.x, deps.player.y, MOUNT_RUSH_SPEED_PX, dt);
      const aim = Math.atan2(deps.player.y - m.y, deps.player.x - m.x);
      m.facing = aim;
      deps.updateCreatureMesh(m, dt, aim);
      deps.updateCreatureAnimFrame(m, dt, moving);
      // Falls back to a flat timeout if the mount's dash toward the player
      // gets blocked by terrain partway — otherwise a cornered mount would
      // never arrive at all.
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
      deps.updateCreatureAnimFrame(m, dt, false);
      if (mountTransitionT >= 1) mountRideState = 'mounted';
      return;
    }

    if (mountRideState === 'mounted') {
      // Position/heading itself is driven by updateMountedMovement (called
      // from game.js's updateMovement while mounted) — this just keeps the
      // mount's own mesh/animation in sync with wherever that left m.x/m.y/m.facing.
      deps.updateCreatureMesh(m, dt, m.facing);
      return;
    }

    if (mountRideState === 'dismountingDown') {
      mountTransitionT = Math.min(1, mountTransitionT + dt / MOUNT_TRANSITION_S);
      deps.player.x = mountTransitionFromX + (mountDismountTargetX - mountTransitionFromX) * mountTransitionT;
      deps.player.y = mountTransitionFromY + (mountDismountTargetY - mountTransitionFromY) * mountTransitionT;
      deps.player.vx = 0; deps.player.vy = 0;
      deps.updateCreatureMesh(m, dt, m.facing);
      deps.updateCreatureAnimFrame(m, dt, false);
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
      const moving = deps.moveCreatureToward(m, targetX, targetY, MOUNT_RUSH_SPEED_PX, dt);
      deps.updateCreatureMesh(m, dt, mountRushOutAngle);
      deps.updateCreatureAnimFrame(m, dt, moving);
      // Falls back to a flat timeout if the dash direction happens to run
      // straight into a wall/map edge — otherwise a cornered mount would
      // never reach the despawn distance and would sit there forever.
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
  // transform. Both entities still keep their existing logical coordinates,
  // but the rider must use the carrier's FINAL smoothed mesh position instead
  // of independently lerping toward the same target and arriving sooner.
  // Mount-up/down keep their authored transitions because this only pins the
  // settled 'mounted' state.
  function pinMountedRiderMesh(riderMesh, seatLift = 0) {
    const m = mountRideEntity; // Carrier whose already-smoothed render transform becomes authoritative for the seated rider.
    const carrierPosition = m?.avatarRef?.group?.position; // Final mount mesh position written by updateMountRide earlier this frame.
    if (mountRideState !== 'mounted' || !carrierPosition || !riderMesh?.position) {
      mountRenderSync.active = false;
      return false;
    }

    const riderSeatOffsetY = (Number(seatLift) || 0) - (Number(m.halfHeight) || 0); // Converts the existing floor-relative seat lift into a carrier-center-relative offset.
    const targetY = carrierPosition.y + riderSeatOffsetY; // Keeps the posterior/saddle alignment attached to the mount's rendered vertical lerp too.
    mountRenderSync.active = true;
    mountRenderSync.beforeXzDriftTiles = Math.hypot(riderMesh.position.x - carrierPosition.x, riderMesh.position.z - carrierPosition.z);
    mountRenderSync.verticalCorrectionTiles = targetY - riderMesh.position.y;
    riderMesh.position.set(carrierPosition.x, targetY, carrierPosition.z);
    mountRenderSync.afterXzDriftTiles = Math.hypot(riderMesh.position.x - carrierPosition.x, riderMesh.position.z - carrierPosition.z);
    return true;
  }

  // A map transition (farm↔town↔wilderness zone↔den cavern) moves the
  // player instantly via a bunch of separate game.js call sites that only
  // ever touch player.x/y/currentArea and the player's OWN scene graph
  // nodes — none of them know a mount might be along for the ride, so a
  // mount's x/y/areaId/scene are left stale in the OLD area. Rather than
  // teach every one of those call sites about mounts, this runs once per
  // actual mismatch (from the top of updateMountRide/updateMountedMovement)
  // and catches the mount up to the player's already-correct new
  // position/scene.
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
    const col = deps.clamp(Math.floor(m.x / deps.TILE), 0, m.areaCols - 1);
    const row = deps.clamp(Math.floor(m.y / deps.TILE), 0, m.areaRows - 1);
    const surfY = m.areaGrid[row]?.[col] ? deps.tileSurfaceYInArea(m.areaGrid[row][col], m.areaId) : 0;
    m.avatarRef.group.position.set(m.x / deps.TILE, surfY + m.halfHeight * (m.scaleY ?? 1), m.y / deps.TILE);
    newScene.add(m.avatarRef.group);
    if (m.groundShadow) {
      m.groundShadow.position.set(m.x / deps.TILE, surfY + deps.characterGroundShadowSurfaceOffset(), m.y / deps.TILE);
      newScene.add(m.groundShadow);
    }
    // Rebuilt fresh next tick against the new scene if still applicable —
    // cheaper and safer than trying to reparent a resource ring HUD.
    window.ResourceRings?.disposeRingHud(m);
  }

  // Replaces game.js's normal on-foot updateMovement while mountRideState
  // === 'mounted': movement input steers the MOUNT (which turns gradually,
  // with momentum lowering its turn rate — see MOUNT_TURN_RATE_MIN/MAX)
  // instead of moving the player directly, and the player is glued to the
  // mount's position. The rider's own facing stays independently
  // controllable via right-stick/mouse-look exactly like on foot, easing
  // back to match the mount's heading once look input goes idle (instead of
  // easing back to the raw movement direction, since that now drives the
  // mount, not the rider's facing).
  function updateMountedMovement(dt) {
    const m = mountRideEntity;
    if (!m) { mountRideState = 'none'; return; }
    const currentArea = deps.getCurrentArea();
    // updateMountRide normally handles this first, but movement runs earlier
    // in the frame; retain the same guard here for a mounted player crossing
    // an indoor boundary during that ordering window.
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

    if (mountCurrentSpeedPxS > 0.01) {
      const desiredX = m.x + Math.cos(mountAngle) * mountCurrentSpeedPxS * dt;
      const desiredY = m.y + Math.sin(mountAngle) * mountCurrentSpeedPxS * dt;
      const minX = deps.PLAYER_RADIUS, maxX = deps.getActiveCols() * deps.TILE - deps.PLAYER_RADIUS;
      const minY = deps.PLAYER_RADIUS, maxY = deps.getActiveRows() * deps.TILE - deps.PLAYER_RADIUS;
      const nextX = deps.clamp(desiredX, minX, maxX), nextY = deps.clamp(desiredY, minY, maxY);
      // A blocked axis bleeds most of the mount's speed instead of a hard
      // stop, so clipping a corner at a gallop doesn't feel like hitting a
      // wall outright.
      if (deps.canPlayerOccupy(nextX, m.y)) m.x = nextX; else mountCurrentSpeedPxS *= 0.4;
      if (deps.canPlayerOccupy(m.x, nextY)) m.y = nextY; else mountCurrentSpeedPxS *= 0.4;
    }
    m.facing = mountAngle;
    deps.player.x = m.x; deps.player.y = m.y;
    deps.player.vx = 0; deps.player.vy = 0; // the mount is what's moving — the rider's own velocity stays inert
    deps.updateCreatureAnimFrame(m, dt, mountCurrentSpeedPxS > 5);

    // Facing: independent of the mount's heading via right-stick/mouse-look
    // (identical to the on-foot system in game.js's updateMovement), easing
    // back to match mountAngle once look input goes idle.
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
  };
})();
