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

  function hasAuthoredPoseAim(raw = {}) {
    return ['neutral','windup','strike'].some(phase => raw?.[phase]?.shoulderAim && typeof raw[phase].shoulderAim === 'object');
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

  function secondaryGripActive(toolKey) {
    return !!global.HobunjiHandToolGrips?.secondaryGripForTool?.(toolKey || '');
  }

  function applyLeftIdleRule(side, toolKey, weights) {
    return side === 'left' && !secondaryGripActive(toolKey) ? { ...IDLE } : weights;
  }

  function rangedWeights(side) {
    const action = global.__rangedDebug?.playerAction || null;
    if (!action?.itemKey || !action?.kind || !(Number(action.durationS) > 0)) return null;
    const def = global.RangedWeapons?.config?.[action.itemKey] || null;
    if (!def) return null;
    const kind = action.kind === 'load' ? 'load' : 'fire';
    const progress = clamp01(Number(action.t) / Number(action.durationS));
    const timing = kind === 'load' ? {
      windupFrac: def.reloadWindupFrac ?? 0.55,
      strikeFrac: def.reloadStrikeFrac ?? 0.56,
      holdFrac: def.reloadHoldFrac ?? 0.57,
    } : {
      windupFrac: def.fireWindupFrac ?? 0.02,
      strikeFrac: def.fireAtFrac ?? 0.18,
      holdFrac: def.fireHoldFrac ?? (def.fireAtFrac ?? 0.18),
    };
    const sequence = kind === 'load' ? (def.reloadSequence || 'attack') : (def.fireSequence || 'fire');
    const key = `ranged:${action.itemKey}:${kind}`;
    const configuredPose = kind === 'load' ? def.loadPose : def.firePose;
    const authored = hasAuthoredPoseAim(configuredPose)
      ? configuredPose
      : (global.HobunjiHandShoulderPoseProfiles?.forKey?.(key) || {});
    return applyLeftIdleRule(side, action.itemKey, weightsAt(progress, timing, authored, sequence));
  }

  function gameWeights(side) {
    // Ranged load/fire has its own timeline and exposes the live player action.
    // Evaluate it directly before the melee stance system.
    const ranged = rangedWeights(side);
    if (ranged) return ranged;

    const snapshot = global.WeaponToolStances?.debugSnapshot?.() || null;
    const active = snapshot?.combatNeutralInjected === true && Number.isFinite(Number(snapshot?.combatProgress));
    if (!active) return { ...IDLE };

    // Melee's current committed per-pose entries all use Neutral=Pitch+Roll and
    // Windup/Strike=Roll-only. WeaponToolStances already computes the exact amount
    // of Neutral blended into its four-phase cycle, so it is the precise Pitch
    // influence for these individually-authored animation profiles.
    const profileKey = `melee:${snapshot?.combatAnim || 'thrust'}`;
    const authored = global.HobunjiHandShoulderPoseProfiles?.forKey?.(profileKey);
    const profile = normalizePoseSet(authored || {});
    const neutralWeight = clamp01(snapshot.combatNeutralWeight);
    const weights = {
      pitch: profile.strike.pitch + (profile.neutral.pitch - profile.strike.pitch) * neutralWeight,
      yaw: profile.strike.yaw + (profile.neutral.yaw - profile.strike.yaw) * neutralWeight,
      roll: profile.strike.roll + (profile.neutral.roll - profile.strike.roll) * neutralWeight,
    };
    return applyLeftIdleRule(side, snapshot?.itemKey || snapshot?.shape || '', weights);
  }

  function currentWeights(side) {
    // Attack Editor owns its own timeline and exposes the exact authored pose boxes.
    const editor = global.HobunjiAttackEditorHandShoulderControls;
    if (editor?.currentWeights) {
      const weights = editor.currentWeights();
      const toolKey = document.getElementById('toolSpriteSelect')?.value || '';
      return applyLeftIdleRule(side, toolKey, normalize(weights, IDLE));
    }
    return gameWeights(side);
  }

  global.HobunjiHandShoulderPoseRuntime = Object.freeze({
    idle: IDLE,
    active: ACTIVE,
    normalize,
    normalizePoseSet,
    hasAuthoredPoseAim,
    lerp,
    weightsAt,
    currentWeights,
  });
})(window);