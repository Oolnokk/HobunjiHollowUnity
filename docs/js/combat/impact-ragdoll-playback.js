// Impact/ragdoll clip playback for player and creature avatars. Samples the
// baked 4-directional blend clips from impact-blend-library.js. Player leg
// poses target the procedural rig and body motion goes through
// PlayerBodyTransformComposer; creature planes reuse the body channel through
// an isolated, quarter-turned visual pivot and deliberately ignore humanoid IK.
(() => {
  'use strict';

  const BODY_CHANNEL = 'ragdoll';
  const BODY_PRIORITY = 100;
  const CREATURE_REFERENCE_HEIGHT = 0.9; // Converts player-authored body-height offsets to each animal plane's visible height in applyCreatureFrame.
  const CREATURE_DIRECTION_QUARTER_TURN = Object.freeze({ front: 'left', right: 'front', back: 'right', left: 'back' }); // Rotates the humanoid blend poles +90° for side-on animal planes.
  const CREATURE_BASIS_QUATERNION = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2); // Rotates humanoid-authored motion axes into the animal card's local basis.
  const CREATURE_BASIS_INVERSE = CREATURE_BASIS_QUATERNION.clone().invert(); // Reused each frame to avoid allocating basis transforms per active animal.

  let playerLegsRef = null;
  let baseBodyY = 0;
  const creatureStates = new Set(); // Tracks active creature reactions for mobile diagnostics and cleanup when playback ends.

  const recoveryAxis = new THREE.Vector3(1, 0, 0); // Used by recovery rolls; dodge direction blends X/Z while prone recovery keeps +X.
  const playback = {
    active: false,
    holding: false,
    bank: null,
    direction: null,
    clip: null,
    elapsedS: 0,
    playbackRate: 1,
    suppressLocomotion: false,
    recoveryBlend: null,
  };

  // Keep the historical two-argument signature because game.js already calls
  // attach(playerMesh, playerLegs). The mesh argument is intentionally ignored:
  // visual body ownership now belongs to PlayerBodyTransformComposer.
  function attach(_playerMesh, playerLegs) {
    playerLegsRef = playerLegs;
  }

  function findBracket(frames, t) {
    if (t <= frames[0].t) return [frames[0], frames[0], 0];
    const last = frames[frames.length - 1];
    if (t >= last.t) return [last, last, 0];
    for (let i = 0; i < frames.length - 1; i++) {
      const a = frames[i];
      const b = frames[i + 1];
      if (t >= a.t && t <= b.t) {
        const span = b.t - a.t;
        return [a, b, span > 1e-6 ? (t - a.t) / span : 0];
      }
    }
    return [last, last, 0];
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

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

  function sampleBody(frameA, frameB, t) {
    return {
      quaternion: slerpQuat(
        frameA.ragdoll.body.localQuaternion,
        frameB.ragdoll.body.localQuaternion,
        t
      ),
      y: lerp(
        frameA.ragdoll.body.localPosition.y,
        frameB.ragdoll.body.localPosition.y,
        t
      ),
    };
  }

  function publishBodyPose(quaternion, yOffset = 0) {
    window.PlayerBodyTransformComposer?.setChannel(BODY_CHANNEL, {
      priority: BODY_PRIORITY,
      mode: 'override',
      quaternion,
      translation: { x: 0, y: Number(yOffset) || 0, z: 0 },
    });
  }

  function applyFrame(frameA, frameB, t) {
    if (!frameA || !frameB) return;

    const body = sampleBody(frameA, frameB, t);
    publishBodyPose(body.quaternion, body.y - baseBodyY);

    if (!playerLegsRef) return;
    playerLegsRef.applyRecordedLegPose(
      'left',
      sampleLeg(frameA.ragdoll.ik.left, frameB.ragdoll.ik.left, t)
    );
    playerLegsRef.applyRecordedLegPose(
      'right',
      sampleLeg(frameA.ragdoll.ik.right, frameB.ragdoll.ik.right, t)
    );
  }

  function ensureCreatureImpactPivot(entity) {
    const avatarRef = entity?.avatarRef;
    const front = avatarRef?.frontPlane;
    const back = avatarRef?.backPlane;
    if (!front?.isObject3D || !back?.isObject3D) return null;
    if (avatarRef.impactPivot?.isObject3D) return avatarRef.impactPivot;
    if (!front.parent || front.parent !== back.parent) return null;

    const parent = front.parent;
    const pivot = new THREE.Group(); // Isolates impact pitch/roll from the creature group's persistent facing yaw.
    pivot.name = 'creature_impact_visual';
    parent.add(pivot);
    pivot.add(front);
    pivot.add(back);
    avatarRef.impactPivot = pivot;
    return pivot;
  }

  function applyCreatureFrame(state, frameA, frameB, t) {
    if (!frameA || !frameB || !state?.pivot) return;
    const body = sampleBody(frameA, frameB, t);
    // Animal cards face along local X rather than the player's local Z.
    // Conjugating by +90° Y rotates the authored pitch/roll axes with the
    // blendspace instead of merely renaming its four directional clips.
    state.pivot.quaternion.copy(CREATURE_BASIS_QUATERNION).multiply(body.quaternion).multiply(CREATURE_BASIS_INVERSE);
    state.pivot.position.y = (body.y - state.baseBodyY) * state.heightScale;
  }

  function stopCreature(entity) {
    const state = entity?._impactRagdollPlayback;
    if (!state) return;
    state.pivot?.quaternion?.identity?.();
    if (state.pivot?.position) state.pivot.position.y = 0;
    creatureStates.delete(state);
    entity._impactRagdollPlayback = null;
  }

  function triggerCreature(entity, bank, direction, opts = {}) {
    const mappedDirection = CREATURE_DIRECTION_QUARTER_TURN[direction] || 'front';
    const clip = window.ImpactBlendLibrary?.getClip(bank, mappedDirection);
    const pivot = ensureCreatureImpactPivot(entity);
    if (!clip?.frames?.length || !pivot) return 0;

    stopCreature(entity);
    const requestedDurationS = Number(opts.durationSeconds);
    const durationMultiplier = requestedDurationS > 0 && clip.durationSeconds > 0
      ? Math.max(0.01, requestedDurationS / clip.durationSeconds)
      : Math.max(0.01, Number(opts.durationMultiplier) || 1);
    const visibleHeight = Math.max(0.05, Number(entity?.halfHeight) * 2 || CREATURE_REFERENCE_HEIGHT);
    const state = {
      entity,
      pivot,
      bank,
      direction: mappedDirection,
      clip,
      elapsedS: 0,
      playbackRate: 1 / durationMultiplier,
      holding: false,
      baseBodyY: Number(clip.frames[0]?.ragdoll?.body?.localPosition?.y) || 0,
      heightScale: visibleHeight / CREATURE_REFERENCE_HEIGHT,
    }; // Stored on the entity so updateCreatureMesh can advance only the creature it is already rendering.
    entity._impactRagdollPlayback = state;
    creatureStates.add(state);
    const [frameA, frameB, blend] = findBracket(clip.frames, 0);
    applyCreatureFrame(state, frameA, frameB, blend);
    return clip.durationSeconds * durationMultiplier;
  }

  function updateCreature(entity, dt) {
    const state = entity?._impactRagdollPlayback;
    if (!state) return false;
    if (state.holding) {
      if (!entity.prone) stopCreature(entity);
      return true;
    }

    state.elapsedS += Math.max(0, Number(dt) || 0) * state.playbackRate;
    if (state.elapsedS >= state.clip.durationSeconds) {
      const [lastFrame] = findBracket(state.clip.frames, state.clip.durationSeconds);
      applyCreatureFrame(state, lastFrame, lastFrame, 0);
      if (state.bank === 'breakThrow' && entity.prone) state.holding = true;
      else stopCreature(entity);
      return true;
    }

    const [frameA, frameB, blend] = findBracket(state.clip.frames, state.elapsedS);
    applyCreatureFrame(state, frameA, frameB, blend);
    return true;
  }

  function trigger(bank, direction, opts = {}) {
    const clip = window.ImpactBlendLibrary?.getClip(bank, direction);
    if (!clip || !clip.frames.length) return 0;

    const durationMultiplier = Math.max(0.01, Number(opts.durationMultiplier) || 1);
    playback.active = true;
    playback.holding = false;
    playback.bank = bank;
    playback.direction = direction;
    playback.clip = clip;
    playback.elapsedS = 0;
    playback.playbackRate = 1 / durationMultiplier;
    playback.suppressLocomotion = false;
    playback.recoveryBlend = null;
    recoveryAxis.set(1, 0, 0);
    baseBodyY = Number(clip.frames[0]?.ragdoll?.body?.localPosition?.y) || 0;

    const [frameA, frameB, t] = findBracket(clip.frames, 0);
    applyFrame(frameA, frameB, t);
    return clip.durationSeconds * durationMultiplier;
  }

  // Treat the four cardinal dodge directions as blend poles. Forward/back use
  // opposite X-axis somersaults; right/left use opposite Z-axis side rolls.
  // A diagonal dodge weights its two adjacent poles, producing one normalized
  // intermediate roll axis instead of snapping between four discrete clips.
  function setRecoveryDirectionBlend(player, suppressLocomotion) {
    if (!suppressLocomotion) {
      playback.recoveryBlend = { forward: 1, backward: 0, left: 0, right: 0 };
      recoveryAxis.set(1, 0, 0);
      return;
    }

    let dx = Number(player?.dodgeDirX) || 0;
    let dy = Number(player?.dodgeDirY) || 0;
    const magnitude = Math.hypot(dx, dy);
    if (magnitude > 1e-6) {
      dx /= magnitude;
      dy /= magnitude;
    } else {
      // performDodge normally supplies a direction even from rest. Preserve the
      // old forward somersault as the safe fallback if a future caller does not.
      dx = 0;
      dy = -1;
    }

    const forward = Math.max(0, -dy); // Negative map-Y is the forward/up dodge pole.
    const backward = Math.max(0, dy); // Positive map-Y is the backward/down dodge pole.
    const left = Math.max(0, -dx); // Negative map-X supplies the left side-roll pole.
    const right = Math.max(0, dx); // Positive map-X supplies the right side-roll pole.
    playback.recoveryBlend = { forward, backward, left, right };

    recoveryAxis.set(
      forward - backward,
      0,
      right - left
    );
    if (recoveryAxis.lengthSq() < 1e-8) recoveryAxis.set(1, 0, 0);
    else recoveryAxis.normalize();
  }

  // Recovery rolls started from ordinary movement suppress the procedural
  // gait; prone recovery keeps its existing held ragdoll leg pose and +X roll.
  function beginRecoveryArc(durationS, onComplete, opts = {}) {
    const player = window.Combat?.deps?.player;
    playback.active = true;
    playback.holding = false;
    playback.bank = 'recovery';
    playback.clip = null;
    playback.elapsedS = 0;
    playback.recoveryDurationS = Math.max(0.05, Number(durationS) || 0.5);
    playback.recoveryOnComplete = typeof onComplete === 'function' ? onComplete : null;
    playback.suppressLocomotion = opts.suppressLocomotion === true || !player?.prone;
    setRecoveryDirectionBlend(player, playback.suppressLocomotion);
  }

  function updateRecoveryArc(dt) {
    if (playback.suppressLocomotion && playerLegsRef?.update) {
      playerLegsRef.update(dt, 0, true, false);
    }

    playback.elapsedS += dt;
    const t = Math.min(1, playback.elapsedS / playback.recoveryDurationS);
    const eased = t * t * (3 - 2 * t);
    const recoveryQuat = new THREE.Quaternion().setFromAxisAngle(
      recoveryAxis,
      Math.PI * 2 * (1 - eased)
    );
    publishBodyPose(recoveryQuat, Math.sin(Math.PI * t) * 0.12);

    if (t >= 1) {
      const callback = playback.recoveryOnComplete;
      stop();
      callback?.();
    }
  }

  function update(dt) {
    if (!playback.active) return;
    if (playback.bank === 'recovery') {
      updateRecoveryArc(dt);
      return;
    }
    if (playback.holding) return;

    playback.elapsedS += dt * playback.playbackRate;
    const clip = playback.clip;
    if (!clip) {
      stop();
      return;
    }

    if (playback.elapsedS >= clip.durationSeconds) {
      const [lastFrame] = findBracket(clip.frames, clip.durationSeconds);
      applyFrame(lastFrame, lastFrame, 0);
      if (playback.bank === 'breakThrow') playback.holding = true;
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
    playback.suppressLocomotion = false;
    playback.recoveryBlend = null;
    recoveryAxis.set(1, 0, 0);
    window.PlayerBodyTransformComposer?.clearChannel(BODY_CHANNEL);
  }

  function isActive() {
    return playback.active;
  }

  function isHolding() {
    return playback.holding;
  }

  function currentDirection() {
    return playback.direction;
  }

  function getDebug() {
    return {
      active: playback.active,
      bank: playback.bank,
      direction: playback.direction,
      suppressLocomotion: playback.suppressLocomotion,
      recoveryBlend: playback.recoveryBlend ? { ...playback.recoveryBlend } : null,
      recoveryAxis: { x: recoveryAxis.x, y: recoveryAxis.y, z: recoveryAxis.z },
      activeCreatureReactions: creatureStates.size,
    };
  }

  window.ImpactRagdollPlayback = {
    attach,
    trigger,
    update,
    beginRecoveryArc,
    stop,
    isActive,
    isHolding,
    currentDirection,
    triggerCreature,
    updateCreature,
    stopCreature,
    getDebug,
  };
})();
