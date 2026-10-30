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
  // Body sink: how far the whole body (portrait, hands, tool) sits below standing, as a PERCENT of the avatar's total height. It is a
  // pose channel (authored per Neutral/Windup/Strike, lerped like the rest) but deliberately NOT in POSE_KEYS: that list is the 7-channel
  // schema the stance matching/baking code compares, and a missing bodySink simply inherits the Neutral's. Not mirrored by Backhand.
  const SINK_KEY = 'bodySink';
  const MAX_BODY_SINK_PCT = 25;
  const CHANNELS = Object.freeze([...POSE_KEYS, 'scale', SINK_KEY]); // Merged for the per-frame sample; scale is the static holder scale, never lerped.
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

  // The stance baker's fallback source neutral is melee-only (thrust / sweep / chop); any other style falls back to
  // thrust, exactly as the player's WeaponToolStances always did.
  const MELEE_STYLE_NEUTRAL = Object.freeze({ thrust: STYLE_NEUTRAL_POSE.thrust, sweep: STYLE_NEUTRAL_POSE.sweep, chop: STYLE_NEUTRAL_POSE.chop });

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

  // ── The swing clock ────────────────────────────────────────────────

  // Where the strike pose is held until before easing back: an ability's explicit holdS (real seconds), else a
  // proportional share of what is left. This is the player's rule (game.js updateToolMesh), shared with enemies.
  function holdFrac(sf, holdS, totalS) {
    return holdS > 0 ? Math.min(0.99, sf + holdS / totalS) : Math.min(0.99, sf + (1 - sf) * 0.3);
  }

  // The player's cosmetic swing timeline (game.js triggerWeaponSwingVisual), written once and shared with enemies so
  // an enemy's strike, hold and eased return last exactly as long as the player's for the same ability data.
  // durationS is windup + strike (+ the ability's own returnS); an ability that budgets no return of its own
  // (strikeFrac of 1) gets a proportional tail so it eases back instead of snapping. holdS is the post-strike pause,
  // added on top. Fills `out` { totalS, wf, sf, hf }; progress is elapsed / totalS.
  function swingTimeline(out, durationS, windupFrac, strikeFrac, holdS) {
    const returnTailS = strikeFrac < 0.999 ? 0 : Math.max(0.12, durationS * 0.35);
    const hold = Math.max(0, holdS || 0);
    const rawTotalS = durationS + returnTailS + hold;
    out.totalS = Math.max(0.05, rawTotalS);
    out.wf = windupFrac * durationS / rawTotalS;
    out.sf = strikeFrac * durationS / rawTotalS;
    out.hf = holdFrac(out.sf, hold, out.totalS);
    return out;
  }

  // ── Per-frame sampling (allocation-free) ───────────────────────────

  // One reusable result shape for samplePose / sampleLegacyThrust. x/y/z are the
  // hand-relative right / up / forward offsets; the *Rad fields are the tool's
  // own yaw / pitch / roll and the whole body's turn; scale is the holder scale;
  // mirrorBlend runs 1 -> -1 across a true midline flip (1 when the pose has no
  // mirror sequence) and multiplies the hand-attach X.
  function createSample() {
    return { x: 0, y: 0, z: 0, pitchRad: 0, yawRad: 0, rollRad: 0, bodyYawRad: 0, bodySink: 0, scale: 1, mirrorBlend: 1, hasMirrorSequence: false };
  }

  const _neutral = {}; // Scratch: pose.neutral merged over the style neutral.
  const _returnNeutral = {}; // Scratch: pose.returnNeutral merged over _neutral.
  function mergeChannels(target, base, over) {
    for (let i = 0; i < CHANNELS.length; i += 1) {
      const key = CHANNELS[i];
      const value = over ? over[key] : undefined;
      target[key] = value != null ? value : (base[key] ?? 0);
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
    out.headRelative = pose.headRelative === true || pose.neutral?.headRelative === true;
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
    out.bodySink = Math.max(0, poseChannel(SINK_KEY, false, pose, progress, wf, sf, hf, sign, power, sequence)); // Percent of avatar height; the swing's sunk-ness at this instant.
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
    out.bodySink = NaN; // Legacy arcs author no sink: consumers fall back to the stance's idle sink.
    out.scale = 1;
    out.mirrorBlend = 1;
    out.hasMirrorSequence = false;
    out.headRelative = false;
    return out;
  }

  // The legacy sweep: only the whole body turns (windup -> strike -> hold -> back
  // to 0), the hand rides at LEGACY_SWEEP.z, and Backhand mirrors the hand attach
  // point itself -- reported through mirrorBlend, which callers multiply into the
  // hand-attach X exactly like a midline-flip pose. game.js updateToolMesh's
  // sweep branch is the reference.
  function sampleLegacySweep(out, progress, wf, sf, hf, sign = 1, power = 1) {
    const S = LEGACY_SWEEP;
    const dir = sign === -1 ? -1 : 1;
    out.x = 0;
    out.y = 0;
    out.z = S.z;
    out.pitchRad = 0;
    out.yawRad = 0;
    out.rollRad = 0;
    out.bodyYawRad = fourPhaseLerp(progress, wf, sf, hf, S.windupRad * power * dir, S.strikeRad * power * dir);
    out.bodySink = NaN;
    out.scale = 1;
    out.mirrorBlend = dir;
    out.hasMirrorSequence = false;
    out.headRelative = false;
    return out;
  }

  // Any melee swing as the player's updateToolMesh plays it: an authored pose
  // (any style) through samplePose over the style's neutral, else the legacy
  // chop pose, sweep turn or thrust jab. Actors that draw a swing without the
  // player's tool-only branches (every BanditCombat humanoid) sample here.
  function sampleSwing(out, anim, pose, progress, wf, sf, hf, sign = 1, power = 1, sequence = 'attack') {
    if (pose) return samplePose(out, pose, STYLE_NEUTRAL_POSE[anim] || STYLE_NEUTRAL_POSE.thrust, progress, wf, sf, hf, sign, power, sequence);
    if (anim === 'chop') return samplePose(out, LEGACY_CHOP_POSE, STYLE_NEUTRAL_POSE.chop, progress, wf, sf, hf, 1, power, 'attack');
    if (anim === 'sweep') return sampleLegacySweep(out, progress, wf, sf, hf, sign, power);
    return sampleLegacyThrust(out, progress, wf, sf, hf, power);
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
      const sourceNeutral = normalizePose(authoredPose.neutral, MELEE_STYLE_NEUTRAL[anim] || MELEE_STYLE_NEUTRAL.thrust);
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

  // The pose the free hand holds when it carries an INVISIBLE copy of the weapon (a pose that is neither 2H nor Dual Wield; see hand-tool-grips.js
  // offhandIdle). Same channel frame as the idle stances. Deliberately separate from the Dual Wield offhand stance, which places a real, visible weapon.
  const IDLE_OFFHAND_POSE = deepFreeze({ x: 0, y: -0.12, z: 0.05, pitch: -90, yaw: -90, roll: 0 });

  // The weapon-stance idle sink in percent of height (proceduralFeet.stanceDrop.heightFraction): what a Light/Heavy stance sinks to at rest,
  // and the Neutral the player's baked swings ease out of and back into (weapon-tool-stances.js adds it to the baked Neutral). 0 when the feature is disabled.
  function idleBodySinkPct() {
    const c = window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar?.proceduralFeet?.stanceDrop || {};
    if (c.enabled === false) return 0;
    const fraction = Number(c.heightFraction);
    return (Number.isFinite(fraction) ? Math.max(0, Math.min(MAX_BODY_SINK_PCT / 100, fraction)) : 0.06) * 100;
  }

  // A whole attack against a weapon's Light/Heavy (or dual-wield main) stance: the baked Windup/Strike endpoints, the
  // replacement Neutral, and the Neutral the swing RETURNS to. Heavy weapons alternate: a swing finishes ready on the
  // opposite side, so a mirrored/backhand swing starts mirrored and returns to the regular idle while a regular swing
  // does the inverse; Light weapons keep their one-sided idle. Shared by the player (weapon-tool-stances.js, which
  // adds its hand-flag decoration) and every enemy (enemy-weapon-stances.js). Allocates: run once per swing.
  function bakeStanceSequence(anim, authoredPose, requestedSign, power, targetNeutral, { alternatesHeavyNeutral = false, meleeSpacing = true } = {}) {
    const effectiveSign = effectiveDirSign(anim, authoredPose, requestedSign);
    const startNeutralSign = alternatesHeavyNeutral ? effectiveSign : 1;
    const returnNeutralSign = alternatesHeavyNeutral ? -effectiveSign : 1;
    const { windup, strike } = bakeAttackEndpoints(anim, authoredPose, power, { meleeSpacing });
    return {
      effectiveSign, startNeutralSign, returnNeutralSign, windup, strike,
      neutral: neutralInputForSigns(targetNeutral, startNeutralSign, effectiveSign),
      returnNeutral: neutralInputForSigns(targetNeutral, returnNeutralSign, effectiveSign),
    };
  }

  // Resolves the visible head into world or actor-local space using caller-owned scratch.
  // Head-space offsets deliberately bypass the arm-length/orbit mapper.
  function headAnchor(out, avatar, localRoot = null) {
    const rig = avatar?.userData?.neckRig; // Live centroid and neck transform, shared by editor/player/NPCs.
    const pixelResolver = window.PNGPlaneAvatar?.resolveSkinnedPixelWorldPosition; // Canonical shader-parity path includes portrait flipping, head compensation and age offsets.
    const head = rig?.available && rig.headCentroidPx && pixelResolver?.(avatar, rig.headCentroidPx, out); // Uses caller-owned output so head-relative animation stays allocation-free.
    if (head) {
      if (head !== out) out.copy(head); // Compatibility with an older resolver that returns a separate vector.
    } else if (rig?.available && rig.headCentroidLocal && rig.neckLocal && rig.neckJoint) {
      out.set(rig.headCentroidLocal.x - rig.neckLocal.x,
        rig.headCentroidLocal.y - rig.neckLocal.y,
        (rig.headCentroidLocal.z || 0) - (rig.neckLocal.z || 0));
      const headJoint = rig.headScaleJoint || rig.neckJoint; // Fallback rigs still include their separate head scale/offset transform when present.
      headJoint.updateWorldMatrix(true, false);
      headJoint.localToWorld(out);
    } else if (avatar?.localToWorld) {
      out.set(0, (Number(avatar.userData?.portraitModelHeight) || 0.9) * 0.3, 0);
      avatar.updateWorldMatrix(true, false);
      avatar.localToWorld(out);
    } else return false;
    if (localRoot) {
      localRoot.updateWorldMatrix(true, false);
      localRoot.worldToLocal(out);
    }
    return true;
  }

  // ── Head attach frame ──────────────────────────────────────────────────────────────────────────
  // Head-anchored poses (blowgun, drink) hang off the portrait's species "mouth" point, not off the camera or a
  // body orbit: the head already takes its yaw/pitch from the camera, so the tool takes its rotation, position and
  // scale from the head alone. A tool's "aperture" (a point in its own holder space) is mated with the mouth and the
  // pose x/y/z/pitch/yaw/roll/scale are an offset in the head's frame.

  // Reference head size: the Mao'ao male head world scale every head-anchored pose was authored against.
  function referenceHeadScale() {
    const head = Number(window.HobunjiCharacterRigScale?.scaleFor?.('mao-ao', 'male')?.head);
    return head > 0 ? head : 0.726;
  }

  // Caller-owned scratch for headFrame/placeAtMouth, built once from the host's THREE so this module stays dependency-free.
  function createHeadFrame(THREE) {
    return {
      position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), scale: 1,
      _v: new THREE.Vector3(), _w: new THREE.Vector3(), _q: new THREE.Quaternion(), _r: new THREE.Quaternion(), _q3: new THREE.Quaternion(), _e: new THREE.Euler(), cameraPosition: null,
    };
  }

  // Mouth pixel for this avatar's species/gender (the head centroid until a real one is authored).
  function mouthPixel(avatar) {
    const rig = avatar?.userData?.neckRig;
    if (!rig?.available) return null;
    const data = avatar.userData;
    return window.HobunjiPortraitMouthPoints?.pixelFor?.(data.speciesId, data.gender, rig, data.sourceCanvas) || rig.headCentroidPx || null;
  }

  // Edge-on deadzone. Tools are flat sprites, so a tool seen edge-on vanishes. For a head-anchored tool the holder's z axis is the haft (the
  // sprite's long axis; grip spans and "Tool Z rotation" are about it) and its y axis is the sprite normal. When the camera would see the
  // sprite within this many degrees of edge-on, the tool is rolled about its OWN haft, by the least rotation, until it is just outside
  // that zone. The one case it cannot help is a haft pointing along the camera ray (any roll is then edge-on), so it leaves the tool alone.
  // The aperture/mouth attach, haft direction and everything else are untouched. 0 disables it (the attack editor shows exact poses).
  let toolEdgeOnDeadzoneRad = Math.max(0, Number(window.SCRATCHBONES_CONFIG?.game?.movement?.toolEdgeOnDeadzoneDeg ?? 10)) * DEG_TO_RAD;
  const DEADZONE_STALE_MS = 250; // A gap this long (weapon re-equipped, tab switched) forgets which side of edge-on the sprite was on.
  const TWO_PI = Math.PI * 2;
  const wrapAngle = angle => angle - TWO_PI * Math.round(angle / TWO_PI);
  let cameraProvider = null; // () => THREE.Camera|null: the camera the sprite is judged against (the game registers its live camera).
  function setToolEdgeOnDeadzone(deg) { toolEdgeOnDeadzoneRad = Math.max(0, Number(deg) || 0) * DEG_TO_RAD; }
  function toolEdgeOnDeadzoneDeg() { return toolEdgeOnDeadzoneRad / DEG_TO_RAD; }
  function setCameraProvider(provider) { cameraProvider = typeof provider === 'function' ? provider : null; }

  // frame._q is the tool's world rotation, frame._v the world point the camera ray is cast to (the mouth). Rolls frame._q about its own
  // z by the minimum angle that takes the sprite out of the deadzone; returns the roll applied (radians, 0 when none).
  function applyEdgeOnDeadzone(holder, frame) {
    if (!(toolEdgeOnDeadzoneRad > 0)) return 0;
    const camera = frame.cameraPosition || cameraProvider?.()?.position;
    if (!camera) return 0;
    const q = frame._q;
    const { x, y, z, w } = q;
    const hx = 2 * (x * z + w * y), hy = 2 * (y * z - w * x), hz = 1 - 2 * (x * x + y * y); // Haft: q * +z
    const nx = 2 * (x * y - w * z), ny = 1 - 2 * (x * x + z * z), nz = 2 * (y * z + w * x); // Sprite normal: q * +y
    let cx = frame._v.x - camera.x, cy = frame._v.y - camera.y, cz = frame._v.z - camera.z; // Camera ray through the tool.
    const length = Math.hypot(cx, cy, cz);
    if (!(length > 1e-6)) return 0;
    cx /= length; cy /= length; cz /= length;
    const a = nx * cx + ny * cy + nz * cz; // Sprite normal . ray: +-1 face-on, 0 edge-on.
    const b = (hy * nz - hz * ny) * cx + (hz * nx - hx * nz) * cy + (hx * ny - hy * nx) * cz; // (haft x normal) . ray: how the roll changes it.
    const reach = Math.hypot(a, b); // Best |normal . ray| any roll can give = sin(angle between haft and ray).
    const state = (holder.userData ||= {}).__edgeOnDeadzone ||= { side: 0, t: -Infinity };
    const now = performance.now();
    if (now - state.t > DEADZONE_STALE_MS) state.side = 0;
    state.t = now;
    const limit = Math.sin(toolEdgeOnDeadzoneRad); // |normal . ray| must stay at or above this.
    if (Math.abs(a) >= limit) { state.side = Math.sign(a) || 1; return 0; } // Outside the zone: nothing to do, and remember which face is showing.
    if (reach < 1e-3) return 0; // Haft along the camera ray: every roll is edge-on, nothing to rotate to.
    if (!state.side) state.side = Math.sign(a) || 1; // Hysteresis: stay on the face that was showing rather than popping across edge-on.
    const target = state.side * Math.min(limit, reach);
    const base = Math.atan2(b, a), spread = Math.acos(Math.max(-1, Math.min(1, target / reach))); // a(alpha) = reach * cos(alpha - base)
    const one = wrapAngle(base + spread), two = wrapAngle(base - spread);
    const roll = Math.abs(one) <= Math.abs(two) ? one : two; // Least rotation.
    q.multiply(frame._q3.set(0, 0, Math.sin(roll / 2), Math.cos(roll / 2))); // Rotate about the tool's own z (the haft).
    return roll;
  }

  // The head's world rotation as the product of its ancestors' local rotations, ignoring scale: exactly how the player composer
  // aims the neck at the interaction ray. A matrix decomposition would skew by a degree or two under the avatar's non-uniform body scale.
  function headRotation(out, joint) {
    if (!joint.quaternion) return joint.getWorldQuaternion(out); // Stand-in joints without a transform hierarchy.
    out.copy(joint.quaternion);
    for (let node = joint.parent; node; node = node.parent) out.premultiply(node.quaternion);
    return out;
  }

  // Fills `frame` (WORLD space) with the mouth position, the head's world rotation and its uniform scale ratio vs the
  // Mao'ao-male baseline. False when the avatar has no skinned head to attach to.
  function headFrame(frame, avatar) {
    const rig = avatar?.userData?.neckRig;
    const pixel = mouthPixel(avatar);
    const resolver = window.PNGPlaneAvatar?.resolveSkinnedPixelWorldPosition;
    const joint = rig?.headScaleJoint || rig?.neckJoint;
    if (!pixel || !joint || !resolver) return false;
    const mouth = resolver(avatar, pixel, frame.position);
    if (!mouth) return false;
    if (mouth !== frame.position) frame.position.copy(mouth);
    joint.updateWorldMatrix(true, false);
    headRotation(frame.quaternion, joint);
    joint.getWorldScale(frame._v);
    const headScale = (frame._v.x + frame._v.y) / 2; // Head size is x/y; z mirrors the body and must not feed back into the tool.
    frame.scale = headScale > 0 ? headScale / referenceHeadScale() : 1;
    return true;
  }

  // Places `holder` so its aperture meets the head frame's mouth. `pose` is an offset in the head frame (units scale with
  // the head), `poseScale` the holder's own uniform scale, `aperture` the mating point in HOLDER space (null = holder
  // origin). With `localRoot` the result is expressed in that parent's space (a scaled/rotated body root).
  function placeAtMouth(holder, frame, pose, poseScale, aperture, localRoot = null, aimPoint = null) {
    const scale = Math.max(0.0001, (Number(poseScale) || 1) * frame.scale); // World scale of the tool, inherited from the head.
    frame._e.set((pose.pitch || 0) * DEG_TO_RAD, (pose.yaw || 0) * DEG_TO_RAD, (pose.roll || 0) * DEG_TO_RAD, 'YXZ');
    frame._r.setFromEuler(frame._e);
    frame._q.copy(frame.quaternion).multiply(frame._r); // World rotation: head rotation, then the authored tool rotation.
    // Optional head-anchored muzzle convergence: keep the aperture on the actual mouth,
    // but rotate the shaft (-Z from the +Z mouthpiece end) toward the SAME finite
    // perspective point as the head-to-reticle diagnostic guide. Character View can
    // straighten the head without detaching the blowgun from this live reticle ray.
    if (aimPoint && [aimPoint.x, aimPoint.y, aimPoint.z].every(Number.isFinite)) {
      const dx = aimPoint.x - frame.position.x, dy = aimPoint.y - frame.position.y, dz = aimPoint.z - frame.position.z; // Mouth-to-reticle vector used only when a caller opts into muzzle convergence.
      const distance = Math.hypot(dx, dy, dz); // Prevents zero-length aim targets from changing the authored pose.
      if (distance > 1e-6) {
        frame._v.set(dx / distance, dy / distance, dz / distance); // Desired world-space barrel direction from the true mouth.
        frame._w.set(0, 0, -1).applyQuaternion(frame._q); // Current barrel direction before any convergence correction.
        frame._q3.setFromUnitVectors(frame._w, frame._v); // Minimal world-space rotation preserves the authored shaft roll.
        frame._q.premultiply(frame._q3); // Only the gun's orientation changes; the mouthpiece stays anchored below.
      }
    }
    frame._v.set((pose.x || 0) * frame.scale, (pose.y || 0) * frame.scale, (pose.z || 0) * frame.scale).applyQuaternion(frame.quaternion).add(frame.position); // World point the aperture sits on.
    applyEdgeOnDeadzone(holder, frame); // Roll about the haft if the camera would see the sprite edge-on; the aperture stays on that point.
    if (aperture) frame._v.sub(frame._w.set(aperture.x, aperture.y, aperture.z).multiplyScalar(scale).applyQuaternion(frame._q));
    if (localRoot) {
      localRoot.updateWorldMatrix(true, false);
      localRoot.worldToLocal(frame._v);
      localRoot.getWorldQuaternion(frame._r).invert();
      frame._q.premultiply(frame._r);
      localRoot.getWorldScale(frame._w);
      holder.scale.setScalar(scale / Math.max(0.0001, frame._w.x));
    } else holder.scale.setScalar(scale);
    holder.position.copy(frame._v);
    holder.quaternion.copy(frame._q);
    return holder;
  }

  // Hand-aligned poses scale around the main-hand grip: with the holder's position/rotation already final and its scale set to
  // `scale`, shifts it so `grip` (a holder-space point measured at scale 1) stays where it was at scale 1. Head-aligned poses
  // get the same guarantee from placeAtMouth, which pivots on the aperture.
  function anchorScaleAtPoint(holder, grip, scale) {
    const k = (Number(scale) || 1) - 1;
    if (!grip || Math.abs(k) < 1e-9) return holder;
    const shift = holder.__anchorShift ||= new holder.position.constructor();
    holder.position.sub(shift.set(grip.x, grip.y, grip.z).multiplyScalar(k).applyQuaternion(holder.quaternion));
    return holder;
  }

  // Inverse of placeAtMouth for an editor drag: given the holder's WORLD transform, writes the head-frame pose
  // (x/y/z in baseline units, pitch/yaw/roll in degrees) that would reproduce it.
  function poseFromHolderWorld(out, frame, worldPosition, worldQuaternion, worldScale, aperture) {
    const scale = Math.max(0.0001, Number(worldScale) || 1);
    frame._v.copy(worldPosition);
    if (aperture) frame._v.add(frame._w.set(aperture.x, aperture.y, aperture.z).multiplyScalar(scale).applyQuaternion(worldQuaternion));
    frame._v.sub(frame.position).applyQuaternion(frame._r.copy(frame.quaternion).invert()).multiplyScalar(1 / Math.max(0.0001, frame.scale));
    out.x = frame._v.x; out.y = frame._v.y; out.z = frame._v.z;
    frame._e.setFromQuaternion(frame._q.copy(frame._r).multiply(worldQuaternion), 'YXZ'); // _r still holds the inverse head rotation.
    out.pitch = frame._e.x / DEG_TO_RAD; out.yaw = frame._e.y / DEG_TO_RAD; out.roll = frame._e.z / DEG_TO_RAD;
    return out;
  }

  window.SharedAttackPose = Object.freeze({
    headAnchor, headFrame, placeAtMouth, anchorScaleAtPoint, poseFromHolderWorld, setToolEdgeOnDeadzone, toolEdgeOnDeadzoneDeg, setCameraProvider, createHeadFrame, mouthPixel, referenceHeadScale,
    version: 1,
    POSE_KEYS,
    SINK_KEY,
    MAX_BODY_SINK_PCT,
    idleBodySinkPct,
    IDLE_OFFHAND_POSE,
    MIRRORED_POSE_KEYS,
    STYLE_NEUTRAL_POSE,
    LEGACY_THRUST,
    LEGACY_SWEEP,
    LEGACY_CHOP_POSE,
    fourPhaseLerp,
    sequencedPoseLerp,
    holdFrac,
    swingTimeline,
    createSample,
    samplePose,
    sampleLegacyThrust,
    sampleLegacySweep,
    sampleSwing,
    normalizePose,
    legacyProceduralEndpoints,
    bakeAuthoredEndpoint,
    effectiveDirSign,
    neutralInputForSigns,
    bakeAttackEndpoints,
    bakeStanceSequence,
  });
})();
