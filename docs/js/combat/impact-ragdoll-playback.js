// Impact/ragdoll clip playback for the player avatar — samples the baked
// 4-directional blend clips docs/js/combat/impact-blend-library.js loads and
// writes each frame's recorded pose straight onto the SAME rig objects
// docs/js/procedural-leg-animation.js already owns (via its
// applyRecordedLegPose(side, record), added alongside this file), plus a
// couple of playerMesh fields nothing else in game.js ever touches.
//
// Deliberately narrow about what it writes on playerMesh: game.js has ~14
// call sites across several per-frame functions (movement, tool-swing pose,
// mount handling, …) that set playerMesh.rotation.y = <facing angle> in
// whichever one is active that frame, so this module never touches
// rotation.y or .quaternion wholesale (either would fight whichever of
// those runs after it in the same frame — audited via grep, confirmed there
// is no single choke point to guard instead). It only ever writes
// rotation.x/rotation.z (nothing else in game.js sets those — confirmed via
// the same grep) for the ragdoll body's pitch/roll "falling over" tilt, and
// position.y (also untouched elsewhere) for the recorded rise/sink. Legs are
// fully owned by applyRecordedLegPose, which is exclusively this module's to
// call while active — procedural-leg-animation.js's own update() must be
// skipped by the caller while isActive() is true (see game.js's per-frame
// playerLegs?.update(...) site).
(() => {
  "use strict";

  let playerMeshRef = null;
  let playerLegsRef = null;
  let baseMeshY = 0;
  let baseBodyY = 0;

  const playback = {
    active: false,
    holding: false,
    bank: null,
    direction: null,
    clip: null,
    elapsedS: 0,
    playbackRate: 1,
  };

  function attach(playerMesh, playerLegs) {
    playerMeshRef = playerMesh;
    playerLegsRef = playerLegs;
  }

  function findBracket(frames, t) {
    if (t <= frames[0].t) return [frames[0], frames[0], 0];
    const last = frames[frames.length - 1];
    if (t >= last.t) return [last, last, 0];
    for (let i = 0; i < frames.length - 1; i++) {
      const a = frames[i], b = frames[i + 1];
      if (t >= a.t && t <= b.t) {
        const span = b.t - a.t;
        return [a, b, span > 1e-6 ? (t - a.t) / span : 0];
      }
    }
    return [last, last, 0];
  }

  function lerp(a, b, t) { return a + (b - a) * t; }

  const _euler = new THREE.Euler();
  function slerpQuat(qa, qb, t) {
    const out = new THREE.Quaternion(qa.x, qa.y, qa.z, qa.w);
    if (t <= 0) return out;
    return out.slerp(new THREE.Quaternion(qb.x, qb.y, qb.z, qb.w), t);
  }

  function sampleLeg(a, b, t) {
    return {
      thighQuaternion: slerpQuat(a.thighQuaternion, b.thighQuaternion, t),
      calfLocalQuaternion: slerpQuat(a.calfLocalQuaternion, b.calfLocalQuaternion, t),
      upperLength: lerp(a.upperLength, b.upperLength, t),
      lowerLength: lerp(a.lowerLength, b.lowerLength, t),
    };
  }

  function applyFrame(frameA, frameB, t) {
    if (!playerMeshRef || !playerLegsRef) return;
    const bodyQuat = slerpQuat(frameA.ragdoll.body.localQuaternion, frameB.ragdoll.body.localQuaternion, t);
    _euler.setFromQuaternion(bodyQuat, "YXZ");
    playerMeshRef.rotation.x = _euler.x;
    playerMeshRef.rotation.z = _euler.z;
    const bodyY = lerp(frameA.ragdoll.body.localPosition.y, frameB.ragdoll.body.localPosition.y, t);
    playerMeshRef.position.y = baseMeshY + bodyY - baseBodyY;
    playerLegsRef.applyRecordedLegPose("left", sampleLeg(frameA.ragdoll.ik.left, frameB.ragdoll.ik.left, t));
    playerLegsRef.applyRecordedLegPose("right", sampleLeg(frameA.ragdoll.ik.right, frameB.ragdoll.ik.right, t));
  }

  function trigger(bank, direction, opts = {}) {
    const clip = window.ImpactBlendLibrary?.getClip(bank, direction);
    if (!clip || !clip.frames.length) return 0;
    const durationMultiplier = Math.max(0.01, Number(opts.durationMultiplier) || 1);
    if (playback.active && playerMeshRef) playerMeshRef.position.y = baseMeshY;
    playback.active = true;
    playback.holding = false;
    playback.bank = bank;
    playback.direction = direction;
    playback.clip = clip;
    playback.elapsedS = 0;
    playback.playbackRate = 1 / durationMultiplier;
    if (playerMeshRef) baseMeshY = playerMeshRef.position.y;
    baseBodyY = Number(clip.frames[0]?.ragdoll?.body?.localPosition?.y) || 0;
    const [frameA, frameB, t] = findBracket(clip.frames, 0);
    applyFrame(frameA, frameB, t);
    return clip.durationSeconds * durationMultiplier;
  }

  function beginRecoveryArc(durationS, onComplete) {
    playback.active = true;
    playback.holding = false;
    playback.bank = "recovery";
    playback.clip = null;
    playback.elapsedS = 0;
    playback.recoveryDurationS = Math.max(0.05, Number(durationS) || 0.5);
    playback.recoveryOnComplete = typeof onComplete === "function" ? onComplete : null;
  }

  function updateRecoveryArc(dt) {
    playback.elapsedS += dt;
    const t = Math.min(1, playback.elapsedS / playback.recoveryDurationS);
    const eased = t * t * (3 - 2 * t);
    if (playerMeshRef) {
      playerMeshRef.rotation.x = Math.PI * 2 * (1 - eased);
      playerMeshRef.position.y = baseMeshY + Math.sin(Math.PI * t) * 0.12;
    }
    if (t >= 1) {
      const cb = playback.recoveryOnComplete;
      stop();
      cb?.();
    }
  }

  function update(dt) {
    if (!playback.active) return;
    if (playback.bank === "recovery") { updateRecoveryArc(dt); return; }
    if (playback.holding) return;
    playback.elapsedS += dt * playback.playbackRate;
    const clip = playback.clip;
    if (playback.elapsedS >= clip.durationSeconds) {
      const [lastFrame] = findBracket(clip.frames, clip.durationSeconds);
      applyFrame(lastFrame, lastFrame, 0);
      if (playback.bank === "breakThrow") playback.holding = true;
      else stop();
      return;
    }
    const [frameA, frameB, t] = findBracket(clip.frames, playback.elapsedS);
    applyFrame(frameA, frameB, t);
  }

  function stop() {
    playback.active = false;
    playback.holding = false;
    playback.clip = null;
    if (playerMeshRef) {
      playerMeshRef.rotation.x = 0;
      playerMeshRef.rotation.z = 0;
      playerMeshRef.position.y = baseMeshY;
    }
  }

  function isActive() { return playback.active; }
  function isHolding() { return playback.holding; }
  function currentDirection() { return playback.direction; }

  window.ImpactRagdollPlayback = { attach, trigger, update, beginRecoveryArc, stop, isActive, isHolding, currentDirection };
})();

// Footing-driven Regular -> Drunken locomotion bridge. ProceduralLegAnimation
// is loaded before this file; game.js attaches the player's legs later, so
// wrapping attach() here catches the player without changing game.js's large
// animation/update monolith. NPC/bandit handles pass through unchanged.
(() => {
  "use strict";

  const api = window.ProceduralLegAnimation;
  if (!api?.attach || api.__footingDrunkWalkInstalled) return;

  const DEG = Math.PI / 180;
  const DRUNK_MAX_PITCH_DEG = 13;
  const DRUNK_MAX_ROLL_DEG = 30;
  const DRUNK_MAX_YAW_DEG = 22;
  const DRUNK_CROSS_STEP_WIDTH = 0.32;
  const DRUNK_WIDE_STEP_WIDTH = 0.30;
  const DRUNK_STEP_DEPTH = 0.18;
  const DRUNK_HESITATION_LIFT = 0.08;
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
    if (!player || !(Number(player.maxFooting) > 0)) return 0;
    return 1 - clamp01(Number(player.footing) / Number(player.maxFooting));
  }

  function avatarRotationTargets(childrenBeforeAttach, legGroup) {
    const targets = [];
    for (const child of (childrenBeforeAttach || [])) {
      if (!child) continue;
      const name = String(child.name || '').toLowerCase();
      const avatarRoot = child.userData?.modelRole === 'temporary-npc-demo-model';
      const visualHelper = name.includes('player_avatar') || name.includes('player_portrait') ||
        name.includes('hat_xray') || name.includes('occlusion_ghost');
      if (avatarRoot || visualHelper) targets.push(child);
    }
    if (legGroup) targets.push(legGroup);
    return [...new Set(targets)];
  }

  function legPart(root, name) {
    return root?.getObjectByName?.(name) || null;
  }

  function applyFootTwist(foot, yaw, roll) {
    if (!foot) return;
    if (!foot.userData.__drunkBaseRotation) {
      foot.userData.__drunkBaseRotation = { y: foot.rotation.y, z: foot.rotation.z };
    }
    const base = foot.userData.__drunkBaseRotation;
    foot.rotation.y = base.y + yaw;
    foot.rotation.z = base.z + roll;
  }

  function decoratePlayerHandle(THREE, options, handle, childrenBeforeAttach) {
    if (!handle) return handle;
    const modelWidth = Math.max(0.001, Number(options.modelWidth) || 0.9);
    const modelHeight = Math.max(0.001, Number(options.modelHeight) || modelWidth);
    const referenceSpeed = Math.max(0.1,
      Number(window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar?.proceduralFeet?.referenceSpeedWorldUnitsPerSecond) || 4.3);
    const originalUpdate = handle.update.bind(handle);
    const originalDispose = handle.dispose.bind(handle);
    const rotationTargets = avatarRotationTargets(childrenBeforeAttach, handle.group);
    const baseQuaternions = new Map(rotationTargets.map(target => [target, target.quaternion.clone()]));
    const drunkEuler = new THREE.Euler(0, 0, 0, 'YXZ');
    const drunkQuaternion = new THREE.Quaternion();

    const state = {
      phase: 0,
      pitch: 0,
      roll: 0,
      yaw: 0,
      left: { x: 0, y: 0, z: 0 },
      right: { x: 0, y: 0, z: 0 },
      loss: 0,
      blend: 0,
      speed: 0,
      disposed: false,
    };

    function applyBodyRotation(pitch, yaw, roll) {
      drunkEuler.set(pitch, yaw, roll, 'YXZ');
      drunkQuaternion.setFromEuler(drunkEuler);
      for (const target of rotationTargets) {
        const base = baseQuaternions.get(target);
        if (!base || !target?.quaternion) continue;
        target.quaternion.copy(base).multiply(drunkQuaternion);
      }
    }

    function applyDrunkenLayer(dt, speedWorldUnitsPerSecond, suppressed, seatedPose) {
      const speed = Math.max(0, Number(speedWorldUnitsPerSecond) || 0);
      const rawLoss = (suppressed || seatedPose) ? 0 : footingLoss();
      const blend = smoothstep01(rawLoss);
      const extreme = blend * blend;
      const movement = clamp01(speed / referenceSpeed);
      const locomotionStrength = blend * (0.16 + 0.84 * Math.sqrt(movement));
      const phaseRateHz = 0.72 + 0.88 * Math.sqrt(movement);
      if (dt > 0) state.phase = (state.phase + dt * phaseRateHz * Math.PI * 2) % (Math.PI * 2);

      const p = state.phase;
      const irregular = Math.sin(p * 0.47 + 1.1) * 0.55 + Math.sin(p * 1.31 - 0.4) * 0.45;
      const correctionPulse = Math.pow(Math.max(0, Math.sin(p * 0.53 - 0.8)), 5);
      const pitchTarget = locomotionStrength * DRUNK_MAX_PITCH_DEG * DEG *
        (0.50 * Math.sin(p * 0.73 + 0.9) + 0.30 * irregular - 0.38 * correctionPulse * extreme);
      const rollTarget = locomotionStrength * DRUNK_MAX_ROLL_DEG * DEG *
        (0.64 * Math.sin(p * 0.61 - 0.25) + 0.27 * Math.sin(p * 1.17 + 1.7) + 0.34 * correctionPulse * extreme);
      const yawTarget = locomotionStrength * DRUNK_MAX_YAW_DEG * DEG *
        (0.61 * Math.sin(p * 0.49 + 0.3) + 0.29 * Math.sin(p * 1.09 - 1.0));

      state.pitch = damp(state.pitch, pitchTarget, 6.5, dt);
      state.roll = damp(state.roll, rollTarget, 6.0, dt);
      state.yaw = damp(state.yaw, yawTarget, 5.5, dt);
      applyBodyRotation(state.pitch, state.yaw, state.roll);

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
      applyFootTwist(legPart(handle.group, 'left_foot'),
        toeStrength * DEG * (25 * Math.sin(p * 0.83 + 0.4) + 14 * Math.sin(p * 0.29 - 0.5)),
        toeStrength * DEG * (12 * Math.sin(p * 0.67 - 0.2)));
      applyFootTwist(legPart(handle.group, 'right_foot'),
        toeStrength * DEG * (-27 * Math.sin(p * 0.79 + 1.1) + 13 * Math.sin(p * 0.33 + 0.8)),
        toeStrength * DEG * (-13 * Math.sin(p * 0.71 + 0.6)));

      state.loss = rawLoss;
      state.blend = blend;
      state.speed = speed;
    }

    handle.update = function footingDrunkWalkUpdate(dt, speedWorldUnitsPerSecond, suppressed, seatedPose) {
      originalUpdate(dt, speedWorldUnitsPerSecond, suppressed, seatedPose);
      applyDrunkenLayer(dt, speedWorldUnitsPerSecond, suppressed, seatedPose);
    };

    handle.dispose = function footingDrunkWalkDispose() {
      if (state.disposed) return;
      state.disposed = true;
      applyBodyRotation(0, 0, 0);
      if (activePlayerState?.handle === handle) activePlayerState = null;
      originalDispose();
    };

    activePlayerState = { handle, state };
    return handle;
  }

  const originalAttach = api.attach.bind(api);
  api.attach = function footingAwareAttach(THREE, parent, options = {}) {
    const isPlayer = String(options.name || '').toLowerCase() === 'player';
    const childrenBeforeAttach = isPlayer ? Array.from(parent?.children || []) : null;
    const handle = originalAttach(THREE, parent, options);
    return isPlayer ? decoratePlayerHandle(THREE, options, handle, childrenBeforeAttach) : handle;
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
        yawDeg: (state?.yaw || 0) / DEG,
        forcedLoss,
      };
    },
    setForcedLoss(value) { forcedLoss = value == null ? null : clamp01(value); },
    clearForcedLoss() { forcedLoss = null; },
  };
})();
