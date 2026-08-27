// Prone/Footing and final body-composition compatibility bridge.
//
// Loaded after drunk-locomotion + alcohol-gameplay-bridge and before game.js.
// It deliberately owns only seams between those already-decoupled systems:
//   1) prone temporarily ignores the Drunken Footing effective-max cap so
//      Footing can refill to the literal max required by get-up logic;
//   2) the player's procedural/unsteady gait is suppressed while prone;
//   3) bandits feed ordinary Footing loss into the existing locomotion layer;
//   4) bandit low-Footing pitch/roll is rendered through an isolated child
//      pivot instead of mutating the same avatar root that owns facing/yaw;
//   5) prone is a hard bandit motion-ownership boundary: attack/lunge and
//      stale knockback state are cancelled while the entity is down;
//   6) immediately before each render, the current player low-Footing pitch/
//      roll is re-published as an additive composer channel after gameplay has
//      resolved facing/auto-target yaw for the frame;
//   7) procedural gait speed is derived from actual X/Z world displacement so
//      stale/smoothed caller velocity cannot delay the idle-foot return.
(() => {
  'use strict';

  const RS = window.ResourceSystem;
  const legApi = window.ProceduralLegAnimation;
  const composer = window.PlayerBodyTransformComposer;
  const THREE = window.THREE;
  if (!RS || !legApi || !composer || !THREE || window.__hobunjiDrunkProneCompositionBridgeInstalled) return;
  window.__hobunjiDrunkProneCompositionBridgeInstalled = true;

  const DRUNK_CHANNEL = 'drunk';
  const DRUNK_PRIORITY = 200;
  const DEG = Math.PI / 180;
  const WALK_STOP_SPEED = 0.02; // Matches procedural-leg-animation.js's own gait stop threshold.
  const banditStateByLegHandle = new WeakMap(); // Binds a pre-entity bandit leg attachment to its entity once makeEntity finishes.
  const banditStates = new Set(); // Iterated only at render time to compose visible sway without touching persistent facing state.
  let lastPlayerMotionGaitSample = null; // Used by mobile Pixel Probe/debug to compare stale reported speed against actual rendered movement.

  function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
  }

  function banditFootingLoss(entity) {
    const maxFooting = Number(entity?.maxFooting) || 0;
    if (!entity || entity.prone || !(maxFooting > 0)) return 0;
    const footing = Math.max(0, Number(entity.footing) || 0);
    return clamp01(1 - footing / maxFooting);
  }

  function clearBanditTransientMotion(entity) {
    if (!entity?.prone) return;
    entity.vx = 0;
    entity.vy = 0;
    entity.knockbackT = 0;
    entity.knockbackVX = 0;
    entity.knockbackVY = 0;
    entity._banditLunging = false;
    entity._banditLungeT = 0;
    entity._banditLungeDistancePx = 0;
    entity._banditLungeHitTest = null;
    if (entity._banditAction) entity._banditAction.cancel?.();
    entity._banditAction = null;
    entity._banditComboIndex = 0;
    entity.telegraphState = null;
  }

  function makeWorldMotionSpeedSampler(THREEArg, parent, isPlayer) {
    const previousWorld = new THREEArg.Vector3(); // Stores the previous gait-update root position for X/Z displacement speed.
    const currentWorld = new THREEArg.Vector3(); // Reused scratch vector for the current root position; avoids per-frame allocation.
    let hasPrevious = false; // Prevents treating the first sample after attachment as a movement delta.

    function publishDebug(reportedSpeed, actualSpeed, effectiveSpeed, source, suppressed, seatedPose) {
      if (!isPlayer) return;
      lastPlayerMotionGaitSample = {
        reportedSpeed: Number(reportedSpeed.toFixed(4)),
        actualSpeed: actualSpeed == null ? null : Number(actualSpeed.toFixed(4)),
        effectiveSpeed: Number(effectiveSpeed.toFixed(4)),
        stoppedByWorldMotion: actualSpeed != null && actualSpeed <= WALK_STOP_SPEED && reportedSpeed > WALK_STOP_SPEED,
        source,
        suppressed: !!suppressed,
        seated: !!seatedPose,
      };
    }

    return function sampleWorldMotionSpeed(dt, speedWorldUnitsPerSecond, suppressed, seatedPose) {
      const reportedSpeed = Math.max(0, Number(speedWorldUnitsPerSecond) || 0);
      const frameDt = Math.max(0, Number(dt) || 0);
      if (!parent?.getWorldPosition || !(frameDt > 1e-5)) {
        publishDebug(reportedSpeed, null, reportedSpeed, 'reported-fallback', suppressed, seatedPose);
        return reportedSpeed;
      }

      parent.updateWorldMatrix?.(true, false);
      parent.getWorldPosition(currentWorld);
      if (!hasPrevious) {
        previousWorld.copy(currentWorld);
        hasPrevious = true;
        publishDebug(reportedSpeed, null, reportedSpeed, 'first-sample', suppressed, seatedPose);
        return reportedSpeed;
      }

      const dx = currentWorld.x - previousWorld.x;
      const dz = currentWorld.z - previousWorld.z;
      previousWorld.copy(currentWorld);
      const actualSpeed = Math.hypot(dx, dz) / frameDt;

      // Keep the baseline current while another pose owns the legs, but let
      // the existing suppressed/seated branches decide how that pose behaves.
      // This avoids a bogus locomotion spike when control returns to the gait.
      if (suppressed || seatedPose) {
        publishDebug(reportedSpeed, actualSpeed, reportedSpeed, 'pose-bypass', suppressed, seatedPose);
        return reportedSpeed;
      }

      // The gait solver already has the desired neutral damping. Giving it an
      // immediate literal zero when the avatar itself stops is enough to start
      // that lerp on the next gait update instead of waiting for a smoothed or
      // cached velocity value to decay for several seconds.
      const effectiveSpeed = actualSpeed <= WALK_STOP_SPEED ? 0 : actualSpeed;
      publishDebug(reportedSpeed, actualSpeed, effectiveSpeed, 'world-motion', suppressed, seatedPose);
      return effectiveSpeed;
    };
  }

  function makeBanditSwayState(THREEArg, legsPivot) {
    const avatarRoot = legsPivot?.parent;
    if (!avatarRoot?.isObject3D || typeof THREEArg?.Group !== 'function') return null;

    let visualRoot = avatarRoot.children?.find?.(child => child?.name === 'bandit_body_sway_visual') || null;
    if (!visualRoot) {
      visualRoot = new THREEArg.Group();
      visualRoot.name = 'bandit_body_sway_visual';
      avatarRoot.add(visualRoot);
      const portraitPlanes = Array.from(avatarRoot.children || [])
        .filter(child => child?.name === 'bandit_front_plane' || child?.name === 'bandit_back_plane');
      for (const plane of portraitPlanes) visualRoot.add(plane);
    }

    // drunk-locomotion owns its own tracked body delta. Give it an off-scene
    // driver instead of the visible/facing root; the render hook copies that
    // delta onto visualRoot only for the actual draw, then restores identity.
    const driverRoot = new THREEArg.Group();
    driverRoot.name = 'bandit_sway_driver';
    return { entity: null, avatarRoot, visualRoot, driverRoot, handle: null };
  }

  if (!RS.__proneIgnoresDrunkenFootingCapInstalled) {
    const previousGetEffectiveMax = RS.getEffectiveMax.bind(RS);
    RS.getEffectiveMax = function proneAwareEffectiveMax(entity, key) {
      if (key === 'footing' && entity?.prone) {
        return Math.max(0, Number(entity.maxFooting) || 0);
      }
      return previousGetEffectiveMax(entity, key);
    };
    RS.__proneIgnoresDrunkenFootingCapInstalled = true;
  }

  // Wrap the common procedural-leg attach seam after drunk-locomotion has
  // already decorated it. The sampler replaces only the gait's speed input;
  // the gait solver continues to own phase, stride, lift and neutral damping.
  if (!legApi.__proneSuppressesDrunkGaitInstalled) {
    const previousAttach = legApi.attach.bind(legApi);
    legApi.attach = function proneAwareLegAttach(THREEArg, parent, options = {}) {
      const isPlayer = String(options.name || '').toLowerCase() === 'player';
      const isBanditLegs = parent?.name === 'bandit_legs_pivot';
      const banditState = isBanditLegs ? makeBanditSwayState(THREEArg, parent) : null;
      const attachOptions = banditState
        ? {
            ...options,
            drunkLossProvider: () => banditFootingLoss(banditState.entity),
            drunkBodyRoot: banditState.driverRoot,
          }
        : options;
      const handle = previousAttach(THREEArg, parent, attachOptions);
      if (!handle) return handle;

      if (typeof handle.update === 'function') {
        const previousLocomotionUpdate = handle.update.bind(handle); // Complete normal+drunk gait; receives actual root-motion speed below.
        const sampleWorldMotionSpeed = makeWorldMotionSpeedSampler(THREEArg, parent, isPlayer); // Converts root X/Z displacement into the gait's speed input.
        handle.update = function worldMotionAwareLegUpdate(dt, speedWorldUnitsPerSecond, suppressed, seatedPose) {
          const effectiveSpeed = sampleWorldMotionSpeed(dt, speedWorldUnitsPerSecond, suppressed, seatedPose);
          return previousLocomotionUpdate(dt, effectiveSpeed, suppressed, seatedPose);
        };
      }

      if (banditState) {
        banditState.handle = handle;
        banditStateByLegHandle.set(handle, banditState);
        banditStates.add(banditState);

        if (typeof handle.update === 'function') {
          const previousBanditUpdate = handle.update.bind(handle);
          handle.update = function proneExclusiveBanditLegUpdate(dt, speedWorldUnitsPerSecond, suppressed, seatedPose) {
            const prone = !!banditState.entity?.prone;
            if (prone) clearBanditTransientMotion(banditState.entity);
            return previousBanditUpdate(dt, speedWorldUnitsPerSecond, !!suppressed || prone, seatedPose);
          };
        }

        if (typeof handle.dispose === 'function') {
          const previousBanditDispose = handle.dispose.bind(handle);
          handle.dispose = function banditSwayAwareDispose() {
            banditStates.delete(banditState);
            banditState.visualRoot?.quaternion?.identity?.();
            return previousBanditDispose();
          };
        }
      }

      if (!isPlayer || typeof handle.update !== 'function') return handle;
      const previousUpdate = handle.update.bind(handle);
      handle.update = function proneAwarePlayerLegUpdate(dt, speedWorldUnitsPerSecond, suppressed, seatedPose) {
        const player = window.Combat?.deps?.player;
        return previousUpdate(dt, speedWorldUnitsPerSecond, !!suppressed || !!player?.prone, seatedPose);
      };
      return handle;
    };
    legApi.__proneSuppressesDrunkGaitInstalled = true;
  }

  const banditApi = window.BanditCombat;
  if (banditApi?.makeEntity && !banditApi.__lowFootingSwayInstalled) {
    const previousMakeBanditEntity = banditApi.makeEntity.bind(banditApi);
    banditApi.makeEntity = async function lowFootingSwayBanditEntity(...args) {
      const entity = await previousMakeBanditEntity(...args);
      const state = banditStateByLegHandle.get(entity?.avatarRef?.legs);
      if (state) state.entity = entity;
      return entity;
    };
    banditApi.__lowFootingSwayInstalled = true;
  }

  if (banditApi?.updateCombatAI && !banditApi.__proneMotionExclusiveInstalled) {
    const previousBanditCombatAI = banditApi.updateCombatAI.bind(banditApi);
    banditApi.updateCombatAI = function proneExclusiveBanditCombatAI(entity, ...args) {
      if (entity?.prone) {
        clearBanditTransientMotion(entity);
        return { aimAngle: Number(entity.facing) || 0, moving: false };
      }
      return previousBanditCombatAI(entity, ...args);
    };
    banditApi.__proneMotionExclusiveInstalled = true;
  }

  function prepareBanditSwayForRender(undo) {
    for (const state of Array.from(banditStates)) {
      const entity = state.entity;
      const visualRoot = state.visualRoot;
      if (!entity || !visualRoot?.quaternion) continue;

      visualRoot.quaternion.identity();
      if (entity.prone) {
        clearBanditTransientMotion(entity);
        continue;
      }

      const loss = banditFootingLoss(entity);
      if (!(loss > 0)) continue;

      const previousRotation = visualRoot.rotation?.clone?.() || null;
      visualRoot.quaternion.copy(state.driverRoot.quaternion);
      undo.push(() => {
        if (previousRotation && visualRoot.rotation?.copy) visualRoot.rotation.copy(previousRotation);
        else visualRoot.quaternion.identity();
      });
    }
  }

  function syncDrunkComposerChannel() {
    const player = window.Combat?.deps?.player;
    if (!player) return;

    if (player.prone) {
      composer.clearChannel(DRUNK_CHANNEL);
      return;
    }

    const debug = window.HobunjiDrunkWalk?.getDebug?.();
    if (!debug) return;
    const pitch = Number(debug.pitchDeg) * DEG;
    const roll = Number(debug.rollDeg) * DEG;
    if (!Number.isFinite(pitch) || !Number.isFinite(roll)) return;

    composer.setChannel(DRUNK_CHANNEL, {
      priority: DRUNK_PRIORITY,
      mode: 'additive',
      rotation: { pitch, roll },
    });
  }

  const rendererProto = THREE.WebGLRenderer?.prototype;
  if (rendererProto?.render && !rendererProto.__drunkProneCompositionRenderHook) {
    const previousRender = rendererProto.render;
    rendererProto.render = function drunkProneCompositionRender(scene, camera, ...rest) {
      syncDrunkComposerChannel();
      const undo = [];
      prepareBanditSwayForRender(undo);
      try {
        return previousRender.call(this, scene, camera, ...rest);
      } finally {
        for (let i = undo.length - 1; i >= 0; i--) undo[i]();
      }
    };
    rendererProto.render.__hobunjiDrunkProneCompositionOriginal = previousRender;
    rendererProto.__drunkProneCompositionRenderHook = true;
  }

  window.HobunjiDrunkProneCompositionBridge = Object.freeze({
    banditFootingLoss,
    getDebug() {
      const player = window.Combat?.deps?.player;
      return {
        playerProne: !!player?.prone,
        footing: Number(player?.footing) || 0,
        maxFooting: Number(player?.maxFooting) || 0,
        effectiveFootingMax: player ? Number(RS.getEffectiveMax(player, 'footing')) || 0 : 0,
        drunkenFooting: Number(player?.afflictions?.drunkenFooting) || 0,
        activeBanditSwayStates: banditStates.size,
        portraitFaceCulling: 'material-frontside',
        forcedPortraitDoubleSide: false,
        motionGaitSpeed: lastPlayerMotionGaitSample,
        drunkWalk: window.HobunjiDrunkWalk?.getDebug?.() || null,
        composer: composer.getDebug?.() || null,
      };
    },
  });
})();
