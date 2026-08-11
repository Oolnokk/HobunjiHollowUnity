// Regular -> Drunken locomotion layer shared by the local player and NPCs.
//
// This module owns ONLY the drunken gait contribution: procedural leg offsets,
// non-accumulating additive foot twist, and a named body-tilt channel
// published to PlayerBodyTransformComposer. It never owns playerMesh rotation
// or facing yaw: game.js's dead-zone/facing resolver remains the sole yaw owner.
(() => {
  'use strict';

  const api = window.ProceduralLegAnimation;
  if (!api?.attach || api.__footingDrunkWalkInstalled) return;

  const DEG = Math.PI / 180;
  const DRUNK_FOOTING_ID = 'drunkenFooting';
  const DRUNK_MAX_PITCH_DEG = 13;
  const DRUNK_MAX_ROLL_DEG = 30;
  const DRUNK_CROSS_STEP_WIDTH = 0.32;
  const DRUNK_WIDE_STEP_WIDTH = 0.30;
  const DRUNK_STEP_DEPTH = 0.18;
  const DRUNK_HESITATION_LIFT = 0.08;
  const BODY_CHANNEL = 'drunk';
  const BODY_PRIORITY = 200;
  const FOOT_TWIST_LIMIT = Math.PI - 1e-4;

  let forcedLoss = null;
  let activePlayerState = null;

  function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
  }

  function smoothstep01(value) {
    const t = clamp01(value);
    return t * t * (3 - 2 * t);
  }

  function damp(current, target, lambda, dt) {
    return current + (target - current) * (1 - Math.exp(-Math.max(0, lambda) * Math.max(0, dt)));
  }

  function footingLoss() {
    if (forcedLoss != null) return clamp01(forcedLoss);
    const player = window.Combat?.deps?.player;
    const maxFooting = Number(player?.maxFooting) || 0;
    if (!player || !(maxFooting > 0)) return 0;
    const drunkenFooting = Math.max(0,
      Number(window.ResourceSystem?.getAffliction?.(player, 'footing', DRUNK_FOOTING_ID))
      || Number(player.afflictions?.[DRUNK_FOOTING_ID])
      || 0);
    return clamp01(drunkenFooting / maxFooting);
  }

  function legPart(root, name) {
    return root?.getObjectByName?.(name) || null;
  }

  function removeTrackedFootTwist(foot, trackedQuaternion) {
    if (!foot?.quaternion || !trackedQuaternion?.isQuaternion) return;
    const hasDelta = Math.abs(trackedQuaternion.x) + Math.abs(trackedQuaternion.y) + Math.abs(trackedQuaternion.z) > 1e-10
      || Math.abs(trackedQuaternion.w - 1) > 1e-10;
    if (hasDelta) foot.quaternion.multiply(trackedQuaternion.clone().invert());
    trackedQuaternion.identity();
  }

  function applyTrackedFootTwist(THREE, foot, yaw, roll, trackedQuaternion) {
    if (!foot?.quaternion || !trackedQuaternion?.isQuaternion) return;
    const safeYaw = Math.max(-FOOT_TWIST_LIMIT, Math.min(FOOT_TWIST_LIMIT, Number(yaw) || 0));
    const safeRoll = Math.max(-FOOT_TWIST_LIMIT, Math.min(FOOT_TWIST_LIMIT, Number(roll) || 0));
    trackedQuaternion.setFromEuler(new THREE.Euler(0, safeYaw, safeRoll, 'YXZ'));
    foot.quaternion.multiply(trackedQuaternion);
  }

  function publishBodyChannel(state) {
    window.PlayerBodyTransformComposer?.setChannel(BODY_CHANNEL, {
      priority: BODY_PRIORITY,
      mode: 'additive',
      preserveFacingSide: true,
      // Facing/dead-zone code owns Y rotation. Adding a second body-yaw here
      // can push the PNG plane across its north-facing front/back boundary
      // after facing has already resolved, producing a rapid flip-flop. Drunk
      // sway therefore contributes tilt only; foot yaw remains independent.
      rotation: {
        pitch: state.pitch,
        roll: state.roll,
      },
    });
  }

  function decorateDrunkHandle(THREE, options, handle, lossProvider, isPlayer) {
    if (!handle) return handle;
    const modelWidth = Math.max(0.001, Number(options.modelWidth) || 0.9);
    const modelHeight = Math.max(0.001, Number(options.modelHeight) || modelWidth);
    const referenceSpeed = Math.max(0.1,
      Number(window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar?.proceduralFeet?.referenceSpeedWorldUnitsPerSecond) || 4.3);
    const originalUpdate = handle.update.bind(handle);
    const originalDispose = handle.dispose.bind(handle);

    const state = {
      phase: 0,
      pitch: 0,
      roll: 0,
      left: { x: 0, y: 0, z: 0 },
      right: { x: 0, y: 0, z: 0 },
      footTwist: {
        left: new THREE.Quaternion(),
        right: new THREE.Quaternion(),
      },
      bodyTilt: new THREE.Quaternion(), // Removed before each update so NPC body sway never accumulates.
      loss: 0,
      blend: 0,
      speed: 0,
      disposed: false,
    };

    function clearPreviousFootTwist() {
      removeTrackedFootTwist(legPart(handle.group, 'left_foot'), state.footTwist.left);
      removeTrackedFootTwist(legPart(handle.group, 'right_foot'), state.footTwist.right);
    }

    function clearPreviousBodyTilt() {
      const bodyRoot = options.drunkBodyRoot;
      if (!bodyRoot?.quaternion || !state.bodyTilt?.isQuaternion) return;
      const hasDelta = Math.abs(state.bodyTilt.x) + Math.abs(state.bodyTilt.y) + Math.abs(state.bodyTilt.z) > 1e-10
        || Math.abs(state.bodyTilt.w - 1) > 1e-10;
      if (hasDelta) bodyRoot.quaternion.multiply(state.bodyTilt.clone().invert());
      state.bodyTilt.identity();
    }

    function publishOrApplyBodyTilt() {
      if (isPlayer) {
        publishBodyChannel(state);
        return;
      }
      const bodyRoot = options.drunkBodyRoot;
      if (!bodyRoot?.quaternion) return;
      state.bodyTilt.setFromEuler(new THREE.Euler(state.pitch, 0, state.roll, 'YXZ'));
      bodyRoot.quaternion.multiply(state.bodyTilt);
    }

    function applyDrunkenLayer(dt, speedWorldUnitsPerSecond, suppressed, seatedPose) {
      const speed = Math.max(0, Number(speedWorldUnitsPerSecond) || 0);
      const rawLoss = (suppressed || seatedPose) ? 0 : clamp01(lossProvider?.() || 0);
      const blend = smoothstep01(rawLoss);
      const extreme = blend * blend;
      const movement = clamp01(speed / referenceSpeed);
      const locomotionStrength = blend * (0.16 + 0.84 * Math.sqrt(movement));
      const phaseRateHz = 0.72 + 0.88 * Math.sqrt(movement);
      if (dt > 0) state.phase = (state.phase + dt * phaseRateHz * Math.PI * 2) % (Math.PI * 2);

      const p = state.phase;
      const irregular = Math.sin(p * 0.47 + 1.1) * 0.55 + Math.sin(p * 1.31 - 0.4) * 0.45;
      const correctionPulse = Math.pow(Math.max(0, Math.sin(p * 0.53 - 0.8)), 5);
      const stepWave = Math.sin(p);
      const crossCatch = Math.sign(stepWave || 1) * Math.pow(Math.abs(stepWave), 1.8);
      const hesitationL = Math.pow(Math.max(0, Math.sin(p - 0.55)), 7);
      const hesitationR = Math.pow(Math.max(0, Math.sin(p + Math.PI - 0.55)), 7);
      const hesitationBias = hesitationL - hesitationR;
      const hesitationTotal = hesitationL + hesitationR;

      const pitchTarget = locomotionStrength * DRUNK_MAX_PITCH_DEG * DEG *
        (0.50 * Math.sin(p * 0.73 + 0.9) + 0.30 * irregular
          - 0.38 * correctionPulse * extreme
          - 0.24 * crossCatch * crossCatch * extreme
          + 0.16 * hesitationTotal * extreme);
      const rollTarget = locomotionStrength * DRUNK_MAX_ROLL_DEG * DEG *
        (0.64 * Math.sin(p * 0.61 - 0.25) + 0.27 * Math.sin(p * 1.17 + 1.7)
          + 0.34 * correctionPulse * extreme
          + 0.42 * crossCatch * extreme
          + 0.16 * hesitationBias * extreme);

      state.pitch = damp(state.pitch, pitchTarget, 6.5, dt);
      state.roll = damp(state.roll, rollTarget, 6.0, dt);

      const sideEntries = [
        { key: 'left', thigh: legPart(handle.group, 'left_thigh'), side: -1, phase: p },
        { key: 'right', thigh: legPart(handle.group, 'right_thigh'), side: 1, phase: p + Math.PI },
      ];
      for (const entry of sideEntries) {
        if (!entry.thigh) continue;
        const wave = Math.sin(entry.phase);
        const cross = Math.pow(Math.max(0, wave), 2.1);
        const wide = Math.pow(Math.max(0, -wave), 1.8);
        const hesitation = Math.pow(Math.max(0, Math.sin(entry.phase - 0.55)), 7);
        const lateralNoise = Math.sin(entry.phase * 0.41 + entry.side * 1.9) * 0.04 * modelWidth * blend;
        const xTarget = lateralNoise + extreme * modelWidth *
          (entry.side * DRUNK_WIDE_STEP_WIDTH * wide - entry.side * DRUNK_CROSS_STEP_WIDTH * cross);
        const zTarget = blend * modelHeight * DRUNK_STEP_DEPTH *
          (0.56 * Math.sin(entry.phase * 0.57 + 0.7) + 0.44 * Math.sin(entry.phase * 1.37 - 0.9));
        const yTarget = extreme * modelHeight * DRUNK_HESITATION_LIFT * hesitation;
        const sideState = state[entry.key];
        sideState.x = damp(sideState.x, xTarget, 8.5, dt);
        sideState.y = damp(sideState.y, yTarget, 10.5, dt);
        sideState.z = damp(sideState.z, zTarget, 8.0, dt);
        entry.thigh.position.x += sideState.x;
        entry.thigh.position.y += sideState.y;
        entry.thigh.position.z += sideState.z;
      }

      const toeStrength = extreme * (0.35 + 0.65 * Math.sqrt(movement));
      applyTrackedFootTwist(THREE, legPart(handle.group, 'left_foot'),
        toeStrength * DEG * (25 * Math.sin(p * 0.83 + 0.4) + 14 * Math.sin(p * 0.29 - 0.5)),
        toeStrength * DEG * (12 * Math.sin(p * 0.67 - 0.2)),
        state.footTwist.left);
      applyTrackedFootTwist(THREE, legPart(handle.group, 'right_foot'),
        toeStrength * DEG * (-27 * Math.sin(p * 0.79 + 1.1) + 13 * Math.sin(p * 0.33 + 0.8)),
        toeStrength * DEG * (-13 * Math.sin(p * 0.71 + 0.6)),
        state.footTwist.right);

      state.loss = rawLoss;
      state.blend = blend;
      state.speed = speed;
      publishOrApplyBodyTilt();
    }

    handle.update = function footingDrunkWalkUpdate(dt, speedWorldUnitsPerSecond, suppressed, seatedPose) {
      // Remove only the delta we added last frame. The normal procedural,
      // ragdoll, seat, and future foot-pose writers then resolve a clean base
      // quaternion before the current drunk twist is composed exactly once.
      clearPreviousFootTwist();
      clearPreviousBodyTilt();
      originalUpdate(dt, speedWorldUnitsPerSecond, suppressed, seatedPose);
      applyDrunkenLayer(dt, speedWorldUnitsPerSecond, suppressed, seatedPose);
    };

    handle.dispose = function footingDrunkWalkDispose() {
      if (state.disposed) return;
      state.disposed = true;
      clearPreviousFootTwist();
      clearPreviousBodyTilt();
      state.pitch = state.roll = 0;
      if (isPlayer && activePlayerState?.handle === handle) activePlayerState = null;
      if (isPlayer) window.PlayerBodyTransformComposer?.clearChannel(BODY_CHANNEL);
      originalDispose();
    };

    if (isPlayer) {
      activePlayerState = { handle, state };
      publishBodyChannel(state);
    }
    return handle;
  }

  const originalAttach = api.attach.bind(api);
  api.attach = function footingAwareAttach(THREE, parent, options = {}) {
    const isPlayer = String(options.name || '').toLowerCase() === 'player';
    const handle = originalAttach(THREE, parent, options);
    const npcLossProvider = typeof options.drunkLossProvider === 'function' ? options.drunkLossProvider : null;
    return isPlayer || npcLossProvider
      ? decorateDrunkHandle(THREE, options, handle, isPlayer ? footingLoss : npcLossProvider, isPlayer)
      : handle;
  };
  api.__footingDrunkWalkInstalled = true;

  window.HobunjiDrunkWalk = {
    getDebug() {
      const state = activePlayerState?.state;
      const player = window.Combat?.deps?.player;
      const loss = state?.loss ?? footingLoss();
      return {
        footing: Number(player?.footing) || 0,
        maxFooting: Number(player?.maxFooting) || 0,
        loss,
        blend: state?.blend ?? smoothstep01(loss),
        speed: state?.speed ?? 0,
        pitchDeg: (state?.pitch || 0) / DEG,
        rollDeg: (state?.roll || 0) / DEG,
        yawDeg: 0,
        bodyYawOwnedByFacing: true,
        forcedLoss,
      };
    },
    setForcedLoss(value) { forcedLoss = value == null ? null : clamp01(value); },
    clearForcedLoss() { forcedLoss = null; },
  };
})();
