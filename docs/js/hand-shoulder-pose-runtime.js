// Shared per-pose shoulder-compass weights.
//
// Checkboxes are authored as booleans on Neutral/Windup/Strike, but runtime turns
// them into 0..1 influence weights and lerps those weights with the same phase curve
// as the held-item pose. That makes a checked Neutral Pitch box fade smoothly into
// an unchecked Windup Pitch box instead of snapping at the phase boundary.
(function (global) {
  'use strict';

  const IDLE = Object.freeze({ pitch: 1, yaw: 0, roll: 1 });
  const ACTIVE = Object.freeze({ pitch: 0, yaw: 0, roll: 1 });

  const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));
  const normalize = (raw, fallback = ACTIVE) => ({
    pitch: raw?.pitch === true ? 1 : raw?.pitch === false ? 0 : clamp01(raw?.pitch ?? fallback.pitch),
    yaw: raw?.yaw === true ? 1 : raw?.yaw === false ? 0 : clamp01(raw?.yaw ?? fallback.yaw),
    roll: raw?.roll === true ? 1 : raw?.roll === false ? 0 : clamp01(raw?.roll ?? fallback.roll),
  });
  const lerp = (a, b, t) => {
    const k = clamp01(t);
    return {
      pitch: a.pitch + (b.pitch - a.pitch) * k,
      yaw: a.yaw + (b.yaw - a.yaw) * k,
      roll: a.roll + (b.roll - a.roll) * k,
    };
  };

  function normalizePoseSet(raw = {}) {
    return {
      neutral: normalize(raw.neutral?.shoulderAim || raw.neutral, IDLE),
      windup: normalize(raw.windup?.shoulderAim || raw.windup, ACTIVE),
      strike: normalize(raw.strike?.shoulderAim || raw.strike, ACTIVE),
    };
  }

  function weightsAt(progress, timing = {}, poseSet = {}, sequence = 'attack') {
    const t = clamp01(progress);
    const wf = clamp01(timing.windupFrac ?? timing.wf ?? 0.16);
    const sf = Math.max(wf, clamp01(timing.strikeFrac ?? timing.sf ?? 0.55));
    const hf = Math.max(sf, clamp01(timing.holdFrac ?? timing.hf ?? 0.68));
    const poses = normalizePoseSet(poseSet);

    if (sequence === 'load') {
      if (t <= wf) return lerp(poses.neutral, poses.windup, t / Math.max(1e-6, wf));
      return lerp(poses.windup, poses.neutral, (t - wf) / Math.max(1e-6, 1 - wf));
    }
    if (sequence === 'fire') {
      if (t <= sf) return lerp(poses.neutral, poses.strike, t / Math.max(1e-6, sf));
      if (t <= hf) return { ...poses.strike };
      return lerp(poses.strike, poses.neutral, (t - hf) / Math.max(1e-6, 1 - hf));
    }
    if (t <= wf) return lerp(poses.neutral, poses.windup, t / Math.max(1e-6, wf));
    if (t <= sf) return lerp(poses.windup, poses.strike, (t - wf) / Math.max(1e-6, sf - wf));
    if (t <= hf) return { ...poses.strike };
    return lerp(poses.strike, poses.neutral, (t - hf) / Math.max(1e-6, 1 - hf));
  }

  function gameWeights(side) {
    const snapshot = global.WeaponToolStances?.debugSnapshot?.() || null;
    const active = snapshot?.combatNeutralInjected === true && Number.isFinite(Number(snapshot?.combatProgress));
    if (!active) return { ...IDLE };

    // Existing committed attacks all deliberately use Neutral=Pitch+Roll and
    // active endpoints=Roll. WeaponToolStances already exposes its exact neutral
    // interpolation weight, so this remains phase-accurate even for hold/release.
    // Explicit future per-pose metadata can override through shoulderAimRuntimePose.
    const explicit = global.HOBUNJI_ACTIVE_HAND_SHOULDER_POSE || null;
    let weights = explicit?.weights
      ? normalize(explicit.weights, ACTIVE)
      : { pitch: clamp01(snapshot.combatNeutralWeight), yaw: 0, roll: 1 };

    if (side === 'left') {
      const toolKey = snapshot?.itemKey || snapshot?.shape || '';
      const secondary = global.HobunjiHandToolGrips?.secondaryGripForTool?.(toolKey) || null;
      if (!secondary) weights = { ...IDLE };
    }
    return weights;
  }

  function currentWeights(side) {
    // Attack Editor owns its own timeline and can expose the exact authored pose
    // boxes. Use that first so editing/scrubbing previews the lerped influences.
    const editor = global.HobunjiAttackEditorHandShoulderControls;
    if (editor?.currentWeights) {
      const active = editor.currentWeights();
      if (side === 'left') {
        const toolKey = document.getElementById('toolSpriteSelect')?.value || '';
        const secondary = global.HobunjiHandToolGrips?.secondaryGripForTool?.(toolKey) || null;
        if (!secondary) return { ...IDLE };
      }
      return normalize(active, IDLE);
    }
    return gameWeights(side);
  }

  global.HobunjiHandShoulderPoseRuntime = Object.freeze({
    idle: IDLE,
    active: ACTIVE,
    normalize,
    normalizePoseSet,
    lerp,
    weightsAt,
    currentWeights,
  });
})(window);
