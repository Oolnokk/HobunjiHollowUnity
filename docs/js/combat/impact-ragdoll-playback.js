// Impact/ragdoll clip playback for the player avatar. Samples the baked
// 4-directional blend clips from impact-blend-library.js and writes recorded
// leg poses onto the existing procedural leg rig. Body rotation/translation is
// published as a named channel to PlayerBodyTransformComposer; this module no
// longer owns or resets playerMesh transforms directly.
(() => {
  'use strict';

  const BODY_CHANNEL = 'ragdoll';
  const BODY_PRIORITY = 100;

  let playerLegsRef = null;
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

    const bodyQuat = slerpQuat(
      frameA.ragdoll.body.localQuaternion,
      frameB.ragdoll.body.localQuaternion,
      t
    );
    const bodyY = lerp(
      frameA.ragdoll.body.localPosition.y,
      frameB.ragdoll.body.localPosition.y,
      t
    );
    publishBodyPose(bodyQuat, bodyY - baseBodyY);

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
    baseBodyY = Number(clip.frames[0]?.ragdoll?.body?.localPosition?.y) || 0;

    const [frameA, frameB, t] = findBracket(clip.frames, 0);
    applyFrame(frameA, frameB, t);
    return clip.durationSeconds * durationMultiplier;
  }

  function beginRecoveryArc(durationS, onComplete) {
    playback.active = true;
    playback.holding = false;
    playback.bank = 'recovery';
    playback.clip = null;
    playback.elapsedS = 0;
    playback.recoveryDurationS = Math.max(0.05, Number(durationS) || 0.5);
    playback.recoveryOnComplete = typeof onComplete === 'function' ? onComplete : null;
  }

  function updateRecoveryArc(dt) {
    playback.elapsedS += dt;
    const t = Math.min(1, playback.elapsedS / playback.recoveryDurationS);
    const eased = t * t * (3 - 2 * t);
    const recoveryQuat = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(Math.PI * 2 * (1 - eased), 0, 0, 'YXZ')
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

  window.ImpactRagdollPlayback = {
    attach,
    trigger,
    update,
    beginRecoveryArc,
    stop,
    isActive,
    isHolding,
    currentDirection,
  };
})();
