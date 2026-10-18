// Shared attack-pose math: the ONE place that turns an authored attack pose
// (Neutral / Windup / Strike channels from the attack-animation editor, or the
// legacy procedural thrust / chop / sweep arcs) into this frame's tool and body
// channels. Every humanoid that swings a weapon reads from here:
//   - the player           (game.js updateToolMesh, weapon-tool-stances.js)
//   - every BanditCombat humanoid -- bandits, ghouls, skeletons, minions,
//     liches, Porakaneki, ... (combat-bandit.js updateBanditToolMesh,
//     enemy-weapon-stances.js)
// so editing a pose formula, a style's rest pose, the mirroring rule, the
// legacy arc numbers or how a Light/Heavy stance is baked into an attack
// changes the player and every enemy at once. Authored pose DATA was already
// shared (attack-pose-templates.js); this module shares the code that plays it.
//
// What stays per-actor on purpose: WHERE the sampled channels are placed (the
// player's hand anchor, reticle orbit and species scaling vs. an enemy's own
// avatar anchor) and the swing CLOCK (the player's long eased return tail vs. an
// enemy's staged action that holds its strike pose). Callers pass that clock in
// as wf/sf/hf; an enemy simply uses sf = wf and hf = 1.
//
// Everything on the per-frame path (fourPhaseLerp, sequencedPoseLerp,
// samplePose, sampleLegacyThrust) is allocation-free: it writes into a caller
// owned sample object and module scratch, so N enemies swinging at once cost N
// small loops and no garbage (see AGENTS.md "Per-frame waste").
(() => {
  'use strict';
  if (window.SharedAttackPose) return;

  const POSE_KEYS = Object.freeze(['x', 'y', 'z', 'pitch', 'yaw', 'bodyYaw', 'roll']);
  const CHANNELS = Object.freeze([...POSE_KEYS, 'scale']); // Merged for the per-frame sample; scale is the static holder scale, never lerped.
  // Mirroring across the character's midline (Backhand, dirSign -1) negates the
  // left/right-handed channels and leaves y, z and pitch alone -- the attack
  // editor's flipPose() convention.
  const MIRRORED_POSE_KEYS = Object.freeze({ x: true, yaw: true, bodyYaw: true, roll: true });
  const RAD_TO_DEG = 180 / Math.PI;
  const DEG_TO_RAD = Math.PI / 180; // Identical to THREE.MathUtils.DEG2RAD, so sampled radians match what the callers used to compute.

  function deepFreeze(value) {
    if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
    return value;
  }

  // Each tool style's natural at-rest pose (degrees for angle channels). Also the
  // fallback neutral for any channel a pose's own `neutral` leaves out. Must stay
  // in sync with the attack-animation editor's STYLE_NEUTRAL_POSE
  // (docs/tools/attack-animation-editor/index.html).
  const STYLE_NEUTRAL_POSE = deepFreeze({
    thrust: { x: 0,    y: 0,    z: 0,    pitch: 10.31, yaw: 0,   roll: 0,   bodyYaw: 0,   scale: 1 },
    sweep:  { x: 0,    y: 0,    z: 0.16, pitch: 0,     yaw: 0,   roll: 0,   bodyYaw: 0,   scale: 1 },
    chop:   { x: 0.03, y: 0.37, z: -0.01, pitch: -155, yaw: -79, roll: -82, bodyYaw: 2,   scale: 1 },
    ranged: { x: 0.23, y: 0.08, z: 0.14, pitch: 16,    yaw: 65,  roll: 11,  bodyYaw: -52, scale: 1.77 },
  });

  // The legacy procedural arcs, written once. game.js's tool branches, the
  // enemy renderer and the Light/Heavy stance bakers all read these numbers.
  const LEGACY_THRUST = deepFreeze({
    windupBackCombat: -0.40, windupBackTool: -0.22, // Combat jabs pull back farther so the windup reads as a tell.
    strikeForward: 0.32, strikeLateral: -0.23,
    restPitchDeg: 10.31, strikePitchDeg: 1,
    strikeYawDeg: -45, windupBodyYawDeg: -45, strikeBodyYawDeg: 46,
  });
  const LEGACY_SWEEP = deepFreeze({ windupRad: -2.20, strikeRad: 2.12, z: 0.16 }); // The editor's "Hatchet - Swing (sweep)" preset: -126.05deg / 121.49deg.
  const LEGACY_CHOP_POSE = deepFreeze({
    neutral: { x: 0.03,  y: 0.37, z: -0.01, pitch: -155, yaw: -79, bodyYaw: 2,   roll: -82 },
    windup:  { x: -0.18, y: 0.41, z: -0.15, pitch: -165, yaw: 13,  bodyYaw: -29, roll: -112 },
    strike:  { x: 0,     y: 0,    z: 0.12,  pitch: 13,   yaw: -28, bodyYaw: 29,  roll: -91 },
  });

  // ── Timeline interpolation ─────────────────────────────────────────

  // Four-phase neutral -> windup -> strike -> hold -> neutral interpolation,
  // shared by every pose channel. Mirrors the attack-animation editor's
  // poseAt()/lerpPose(). The hold phase (sf -> hf) dwells exactly at the strike
  // value before easing back, so an impact reads as a clean hit. A caller with
  // no return tail (an enemy's staged action) passes sf = wf and hf = 1: the
  // windup rises, then the strike value holds for the rest of the action.
  function fourPhaseLerp(progress, wf, sf, hf, windupV, strikeV, neutralV = 0, returnNeutralV = neutralV) {
    if (progress <= wf) return neutralV + (windupV - neutralV) * (progress / Math.max(0.0001, wf));
    if (progress <= sf) return windupV + (strikeV - windupV) * ((progress - wf) / (sf - wf));
    if (progress <= hf) return strikeV;
    return strikeV + (returnNeutralV - strikeV) * ((progress - hf) / (1.0 - hf));
  }

  // Ranged sequences reuse the same endpoints on a different timeline: 'load'
  // winds up then returns, 'fire' strikes then returns, anything else is the
  // ordinary four-phase attack.
  function sequencedPoseLerp(sequence, progress, wf, sf, hf, windupV, strikeV, neutralV = 0, returnNeutralV = neutralV) {
    if (sequence === 'load') {
      if (progress <= wf) return neutralV + (windupV - neutralV) * (progress / Math.max(0.0001, wf));
      return windupV + (returnNeutralV - windupV) * ((progress - wf) / Math.max(0.0001, 1 - wf));
    }
    if (sequence === 'fire') {
      if (progress <= sf) return neutralV + (strikeV - neutralV) * (progress / Math.max(0.0001, sf));
      if (progress <= hf) return strikeV;
      return strikeV + (returnNeutralV - strikeV) * ((progress - hf) / Math.max(0.0001, 1 - hf));
    }
    return fourPhaseLerp(progress, wf, sf, hf, windupV, strikeV, neutralV, returnNeutralV);
  }

  // ── Per-frame sampling (allocation-free) ───────────────────────────

  // One reusable result shape for samplePose / sampleLegacyThrust. x/y/z are the
  // hand-relative right / up / forward offsets; the *Rad fields are the tool's
  // own yaw / pitch / roll and the whole body's turn; scale is the holder scale;
  // mirrorBlend runs 1 -> -1 across a true midline flip (1 when the pose has no
  // mirror sequence) and multiplies the hand-attach X.
  function createSample() {
    return { x: 0, y: 0, z: 0, pitchRad: 0, yawRad: 0, rollRad: 0, bodyYawRad: 0, scale: 1, mirrorBlend: 1, hasMirrorSequence: false };
  }

  const _neutral = {}; // Scratch: pose.neutral merged over the style neutral.
  const _returnNeutral = {}; // Scratch: pose.returnNeutral merged over _neutral.
  function mergeChannels(target, base, over) {
    for (let i = 0; i < CHANNELS.length; i += 1) {
      const key = CHANNELS[i];
      const value = over ? over[key] : undefined;
      target[key] = value != null ? value : base[key];
    }
  }

  function poseChannel(key, mirror, pose, progress, wf, sf, hf, sign, power, sequence) {
    const n = _neutral[key];
    const m = mirror ? sign : 1;
    // `power` scales every channel's deviation from its own neutral, so a
    // heavier-telegraphed finisher needs no bespoke formula per style.
    const windup = (n + ((pose.windup?.[key] ?? n) - n) * power) * m;
    const strike = (n + ((pose.strike?.[key] ?? n) - n) * power) * m;
    return sequencedPoseLerp(sequence, progress, wf, sf, hf, windup, strike, n * m, _returnNeutral[key] * m);
  }

  // Samples a full 7-channel authored pose at `progress` into `out`. `pose` is
  // { neutral?, windup?, strike?, returnNeutral?, neutralMirrorSign?,
  // returnNeutralMirrorSign? } (any missing channel falls back to the style
  // neutral); `sign` is the dirSign mirror (-1 = Backhand); `power` scales every
  // channel's deviation from its neutral; `sequence` is 'attack' | 'load' | 'fire'.
  function samplePose(out, pose, styleNeutral, progress, wf, sf, hf, sign = 1, power = 1, sequence = 'attack') {
    mergeChannels(_neutral, styleNeutral, pose.neutral);
    mergeChannels(_returnNeutral, _neutral, pose.returnNeutral);
    const scale = Number(_neutral.scale);
    out.scale = Number.isFinite(scale) ? Math.max(0.1, scale) : 1;

    // The hand attachment is part of a true midline flip: it stays on the attack
    // side through impact, then crosses over during recovery.
    const hasMirrorSequence = pose.neutralMirrorSign != null || pose.returnNeutralMirrorSign != null;
    out.hasMirrorSequence = hasMirrorSequence;
    out.mirrorBlend = hasMirrorSequence
      ? sequencedPoseLerp(sequence, progress, wf, sf, hf, sign, sign, pose.neutralMirrorSign === -1 ? -1 : 1, pose.returnNeutralMirrorSign === -1 ? -1 : 1)
      : 1;

    out.x = poseChannel('x', true, pose, progress, wf, sf, hf, sign, power, sequence);
    out.y = poseChannel('y', false, pose, progress, wf, sf, hf, sign, power, sequence);
    out.z = poseChannel('z', false, pose, progress, wf, sf, hf, sign, power, sequence);
    out.pitchRad = poseChannel('pitch', false, pose, progress, wf, sf, hf, sign, power, sequence) * DEG_TO_RAD;
    out.yawRad = poseChannel('yaw', true, pose, progress, wf, sf, hf, sign, power, sequence) * DEG_TO_RAD;
    out.rollRad = poseChannel('roll', true, pose, progress, wf, sf, hf, sign, power, sequence) * DEG_TO_RAD;
    out.bodyYawRad = poseChannel('bodyYaw', true, pose, progress, wf, sf, hf, sign, power, sequence) * DEG_TO_RAD;
    return out;
  }

  // The legacy thrust jab as the same channels samplePose produces. `windupBack`
  // defaults to the combat tell; ordinary tool jabs pass LEGACY_THRUST.windupBackTool.
  function sampleLegacyThrust(out, progress, wf, sf, hf, power = 1, windupBack = LEGACY_THRUST.windupBackCombat * power) {
    const T = LEGACY_THRUST;
    out.x = fourPhaseLerp(progress, wf, sf, hf, 0, T.strikeLateral * power); // lateral
    out.y = 0;
    out.z = fourPhaseLerp(progress, wf, sf, hf, windupBack, T.strikeForward * power); // jab forward/back
    // Pitch rests at its own windup value rather than 0 -- a thrust weapon sits
    // at this held-up tilt, drops to ~flat at the strike, then eases back.
    out.pitchRad = fourPhaseLerp(progress, wf, sf, hf, T.restPitchDeg * DEG_TO_RAD, T.strikePitchDeg * DEG_TO_RAD, T.restPitchDeg * DEG_TO_RAD);
    out.yawRad = fourPhaseLerp(progress, wf, sf, hf, 0, T.strikeYawDeg * DEG_TO_RAD * power);
    out.rollRad = 0;
    out.bodyYawRad = fourPhaseLerp(progress, wf, sf, hf, T.windupBodyYawDeg * DEG_TO_RAD * power, T.strikeBodyYawDeg * DEG_TO_RAD * power);
    out.scale = 1;
    out.mirrorBlend = 1;
    out.hasMirrorSequence = false;
    return out;
  }

  // ── Baking an attack against a replacement Neutral (Light/Heavy stances) ──
  //
  // WeaponToolStances (player) and EnemyWeaponStances (enemies) both replace an
  // attack's Neutral with the weapon's Light/Heavy idle stance while keeping the
  // attack's own Windup/Strike endpoints. These helpers are that shared policy.
  // They allocate, so callers run them once per swing (or memoize), not per frame.

  function normalizePose(raw, fallback) {
    const pose = {};
    for (const key of POSE_KEYS) {
      const value = Number(raw?.[key]);
      pose[key] = Number.isFinite(value) ? value : (Number(fallback?.[key]) || 0);
    }
    return pose;
  }

  // The old procedural attack endpoints in the generic pose schema, so a legacy
  // thrust/chop/sweep can ride the real Neutral -> Windup -> Strike -> Neutral
  // cycle against a different Neutral. Thrust's pitch is intentionally NOT
  // power-scaled; reach, lateral offset, tool yaw and body yaw are.
  function legacyProceduralEndpoints(anim, power) {
    const p = Number.isFinite(Number(power)) ? Number(power) : 1;
    if (anim === 'chop') {
      const neutral = LEGACY_CHOP_POSE.neutral;
      const scaleFromNeutral = raw => {
        const out = {};
        for (const key of POSE_KEYS) out[key] = neutral[key] + (raw[key] - neutral[key]) * p;
        return out;
      };
      return { windup: scaleFromNeutral(LEGACY_CHOP_POSE.windup), strike: scaleFromNeutral(LEGACY_CHOP_POSE.strike) };
    }
    if (anim === 'sweep') {
      const S = LEGACY_SWEEP;
      return {
        windup: { x: 0, y: 0, z: S.z, pitch: 0, yaw: 0, bodyYaw: S.windupRad * RAD_TO_DEG * p, roll: 0 },
        strike: { x: 0, y: 0, z: S.z, pitch: 0, yaw: 0, bodyYaw: S.strikeRad * RAD_TO_DEG * p, roll: 0 },
      };
    }
    const T = LEGACY_THRUST;
    return {
      windup: { x: 0, y: 0, z: T.windupBackCombat * p, pitch: T.restPitchDeg, yaw: 0, bodyYaw: T.windupBodyYawDeg * p, roll: 0 },
      strike: { x: T.strikeLateral * p, y: 0, z: T.strikeForward * p, pitch: T.strikePitchDeg, yaw: T.strikeYawDeg * p, bodyYaw: T.strikeBodyYawDeg * p, roll: 0 },
    };
  }

  // One authored endpoint scaled from the pose's own source neutral by `power`.
  // Non-channel keys (hand grip / dual-wield flags) ride along untouched so an
  // enemy honors the same authored hand state the player does.
  function bakeAuthoredEndpoint(raw, sourceNeutral, power) {
    const out = { ...raw };
    for (const key of POSE_KEYS) {
      const rawValue = Number(raw?.[key]);
      const endpoint = Number.isFinite(rawValue) ? rawValue : sourceNeutral[key];
      out[key] = sourceNeutral[key] + (endpoint - sourceNeutral[key]) * power;
    }
    return out;
  }

  // Legacy thrust/chop never used the combat dirSign; authored poses and sweeps do.
  function effectiveDirSign(anim, authoredPose, requestedSign) {
    const sign = requestedSign === -1 ? -1 : 1;
    return authoredPose || anim === 'sweep' ? sign : 1;
  }

  // The runtime mirrors x/yaw/roll/bodyYaw after interpolating whenever the sign
  // is -1. Convert a desired VISIBLE Neutral handedness back into the input pose
  // that produces it after that runtime mirror. Allocates a fresh pose.
  function neutralInputForSigns(targetNeutral, visibleSign, runtimeSign) {
    const out = {};
    for (const key of POSE_KEYS) {
      out[key] = MIRRORED_POSE_KEYS[key] ? targetNeutral[key] * visibleSign * runtimeSign : targetNeutral[key];
    }
    return out;
  }

  // Windup/Strike endpoints for an attack: the authored pose's (power baked in
  // against its own source neutral) or the legacy procedural arc's, then the
  // shared melee spacing calibration. meleeSpacing:false skips the calibration.
  function bakeAttackEndpoints(anim, authoredPose, power, { meleeSpacing = true } = {}) {
    const p = Number.isFinite(Number(power)) ? Number(power) : 1;
    let windup;
    let strike;
    if (authoredPose) {
      const sourceNeutral = normalizePose(authoredPose.neutral, STYLE_NEUTRAL_POSE[anim] || STYLE_NEUTRAL_POSE.thrust);
      windup = bakeAuthoredEndpoint(authoredPose.windup, sourceNeutral, p);
      strike = bakeAuthoredEndpoint(authoredPose.strike, sourceNeutral, p);
    } else {
      ({ windup, strike } = legacyProceduralEndpoints(anim, p));
    }
    // Every offensive melee endpoint passes through one Mao'ao-space calibration
    // (melee-pose-spacing.js) after its power/pose math is baked.
    if (meleeSpacing && anim !== 'ranged' && window.MeleePoseSpacing?.adjustEndpoint) {
      windup = window.MeleePoseSpacing.adjustEndpoint(windup, 'windup');
      strike = window.MeleePoseSpacing.adjustEndpoint(strike, 'strike');
    }
    return { windup, strike };
  }

  window.SharedAttackPose = Object.freeze({
    version: 1,
    POSE_KEYS,
    MIRRORED_POSE_KEYS,
    STYLE_NEUTRAL_POSE,
    LEGACY_THRUST,
    LEGACY_SWEEP,
    LEGACY_CHOP_POSE,
    fourPhaseLerp,
    sequencedPoseLerp,
    createSample,
    samplePose,
    sampleLegacyThrust,
    normalizePose,
    legacyProceduralEndpoints,
    bakeAuthoredEndpoint,
    effectiveDirSign,
    neutralInputForSigns,
    bakeAttackEndpoints,
  });
})();
