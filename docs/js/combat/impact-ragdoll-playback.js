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
//
// Usage (see game.js's damagePlayer / updateMovement / the per-frame leg
// update site):
//   ImpactRagdollPlayback.attach(playerMesh, playerLegs)
//   const staggerS = ImpactRagdollPlayback.trigger('impact', direction, { durationMultiplier })
//   ImpactRagdollPlayback.update(dt)     — call instead of playerLegs.update() while isActive()
//   ImpactRagdollPlayback.isActive()     — true while a clip is playing OR holding
//   ImpactRagdollPlayback.isHolding()    — true once a 'breakThrow' clip has settled into its prone hold
//   ImpactRagdollPlayback.stop()         — releases control back to normal gait/facing
(() => {
  "use strict";

  let playerMeshRef = null;
  let playerLegsRef = null;
  let baseMeshY = 0;
  let baseBodyY = 0;

  const playback = {
    active: false,
    holding: false, // true once a 'breakThrow' clip has finished and settled into its prone hold — see this file's header comment on why that needs no separate authored 'stun' clip
    bank: null,
    direction: null,
    clip: null,
    elapsedS: 0,
    playbackRate: 1, // clip-time seconds per wall-clock second; 1/durationMultiplier
  };

  function attach(playerMesh, playerLegs) {
    playerMeshRef = playerMesh;
    playerLegsRef = playerLegs;
  }

  // Frames aren't guaranteed perfectly evenly spaced (authored at ~30/sec
  // but re-timed on export) — a linear scan over a clip's 20-50 frames is
  // cheap enough per active-playback-per-frame not to bother with anything
  // fancier. Returns [frameA, frameB, localT] to lerp/slerp between; at or
  // past either end, both frames are the same (localT irrelevant).
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
  // Always returns a freshly allocated Quaternion — applyFrame/sampleLeg
  // below need up to 5 independent slerped quaternions alive at once (body +
  // 2 legs' thigh/calf each), so a single shared scratch object here would
  // alias and silently corrupt earlier results as each later call overwrote
  // it. Playback only runs while a clip is active, so a few small
  // allocations per frame is not worth the aliasing risk to avoid.
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
    // 'YXZ' so .x/.z read as pitch/roll independent of any yaw component —
    // see this file's header comment on why rotation.y is never written here.
    _euler.setFromQuaternion(bodyQuat, "YXZ");
    playerMeshRef.rotation.x = _euler.x;
    playerMeshRef.rotation.z = _euler.z;
    // Authored body positions are absolute in the avatar-local locomotion
    // space: the standing first frame is around the body's 0.45-unit centre,
    // not a 0.45-unit root-motion lift. Only apply the change from that
    // first-frame position to the floor-anchored playerMesh. Adding the raw
    // value here double-counted the avatar's standing height and made every
    // ordinary stagger float far above the ground.
    const bodyY = lerp(frameA.ragdoll.body.localPosition.y, frameB.ragdoll.body.localPosition.y, t);
    playerMeshRef.position.y = baseMeshY + bodyY - baseBodyY;
    playerLegsRef.applyRecordedLegPose("left", sampleLeg(frameA.ragdoll.ik.left, frameB.ragdoll.ik.left, t));
    playerLegsRef.applyRecordedLegPose("right", sampleLeg(frameA.ragdoll.ik.right, frameB.ragdoll.ik.right, t));
  }

  // Returns the wall-clock seconds this playback will actually take
  // (clip.durationSeconds * durationMultiplier) so the caller can hand that
  // exact number to combat-core.js's beginStagger — the two are kept in sync
  // by construction instead of each recomputing the multiplier separately.
  // Returns 0 (and does nothing) if the bank/direction has no loaded clip.
  function trigger(bank, direction, opts = {}) {
    const clip = window.ImpactBlendLibrary?.getClip(bank, direction);
    if (!clip || !clip.frames.length) return 0;
    const durationMultiplier = Math.max(0.01, Number(opts.durationMultiplier) || 1);
    // A new hit can replace a clip before its previous stagger completes.
    // Recover the floor-level root rather than treating the previous clip's
    // currently offset pose as the new baseline, which would accumulate
    // vertical displacement across rapid hits.
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

  // Somersault recovery — no authored clip exists for prone-to-standing (see
  // this file's header and game.js's beginSomersaultRecovery, which calls
  // this from performDodge while player.prone). Procedurally coded rather
  // than sampled: a full 2π forward-pitch roll on playerMesh eased back to
  // upright, with a small rise-height hump layered on top, over
  // opts.durationS. Legs deliberately stay frozen at whatever prone IK pose
  // they were last holding for the whole roll — the billboard root rotating
  // through the roll is what actually reads as "somersaulting" for a flat
  // sprite avatar; bespoke per-leg choreography for a one-off recovery arc
  // isn't worth a second authored-pose system. stop() (called at t=1, via
  // update()) hands the legs back to normal gait, which settles to idle
  // stance within its own existing damping over the next frame or two.
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
      if (playback.bank === "breakThrow") {
        // The zero-Footing throw settles here instead of handing control
        // back — its authored tail IS the settled prone pose (see header
        // comment), so this doubles as the 'stun' hold with no extra clip.
        playback.holding = true;
      } else {
        stop();
      }
      return;
    }
    const [frameA, frameB, t] = findBracket(clip.frames, playback.elapsedS);
    applyFrame(frameA, frameB, t);
  }

  // Releases control back to normal gait/facing. Restores playerMesh's tilt
  // and height to whatever they were before trigger() — normal per-frame
  // code never wrote rotation.x/z or position.y itself (see header comment),
  // so nothing else needs to be told playback stopped; it just resumes
  // reading rotation.y as it always has.
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
