#!/usr/bin/env node
'use strict';

// js/combat/shared-attack-pose.js is the single owner of attack-pose math for the
// player (game.js updateToolMesh, weapon-tool-stances.js) AND every BanditCombat
// humanoid (combat-bandit.js updateBanditToolMesh, enemy-weapon-stances.js).
// Executes the real module, then drives the real enemy renderer against a
// SharedAttackPose double to prove enemies consume the shared sampler's output.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const read = file => fs.readFileSync(file, 'utf8');
const approx = (actual, expected, label, eps = 1e-9) => assert.ok(Math.abs(actual - expected) <= eps, `${label}: expected ${actual} ≈ ${expected}`);
const DEG = Math.PI / 180;

// ── The module itself ──────────────────────────────────────────────────
const context = { window: {} };
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(read('docs/js/combat/shared-attack-pose.js'), context, { filename: 'shared-attack-pose.js' });
const SAP = context.window.SharedAttackPose;
assert.ok(SAP && SAP.version >= 1, 'module installs window.SharedAttackPose');
assert.ok(Object.isFrozen(SAP) && Object.isFrozen(SAP.STYLE_NEUTRAL_POSE.thrust), 'shared tables are immutable so no consumer can fork them in place');

// Timeline interpolation.
{
  const f = (p, wf = 0.2, sf = 0.4, hf = 0.6) => SAP.fourPhaseLerp(p, wf, sf, hf, 10, 20, 0, 5);
  approx(f(0), 0, 'neutral at start');
  approx(f(0.1), 5, 'halfway to windup');
  approx(f(0.2), 10, 'windup endpoint');
  approx(f(0.3), 15, 'windup -> strike');
  approx(f(0.4), 20, 'strike endpoint');
  approx(f(0.5), 20, 'hold dwells at strike');
  approx(f(0.8), 12.5, 'return eases to returnNeutral');
  approx(f(1), 5, 'ends on returnNeutral');
  approx(SAP.fourPhaseLerp(0, 0, 0, 1, 10, 20, 3), 3, 'windupFrac 0 never yields NaN at progress 0');
  approx(SAP.sequencedPoseLerp('load', 0.5, 0.2, 0.4, 0.6, 10, 20, 0, 4), 7.75, 'load sequence returns from the windup, never strikes');
  approx(SAP.sequencedPoseLerp('fire', 0.2, 0.2, 0.4, 0.6, 10, 20, 0, 4), 10, 'fire sequence goes neutral -> strike, skipping the windup');
}

// Pose sampling.
const style = SAP.STYLE_NEUTRAL_POSE.sweep;
const pose = {
  neutral: { x: 0.1, y: 0, z: 0.16, pitch: 0, yaw: 10, bodyYaw: 0, roll: 20 },
  windup: { x: 0.3, y: 0.1, z: 0.2, pitch: 30, yaw: 40, bodyYaw: -60, roll: 50 },
  strike: { x: -0.2, y: 0.2, z: 0.4, pitch: -30, yaw: -40, bodyYaw: 70, roll: -50 },
};
const out = SAP.createSample();
{
  SAP.samplePose(out, pose, style, 0, 0.2, 0.4, 0.6);
  approx(out.x, 0.1, 'neutral x'); approx(out.yawRad, 10 * DEG, 'neutral yaw'); approx(out.rollRad, 20 * DEG, 'neutral roll');
  SAP.samplePose(out, pose, style, 0.2, 0.2, 0.4, 0.6);
  approx(out.x, 0.3, 'windup x'); approx(out.pitchRad, 30 * DEG, 'windup pitch'); approx(out.bodyYawRad, -60 * DEG, 'windup bodyYaw');
  SAP.samplePose(out, pose, style, 0.4, 0.2, 0.4, 0.6);
  approx(out.x, -0.2, 'strike x'); approx(out.bodyYawRad, 70 * DEG, 'strike bodyYaw');
  SAP.samplePose(out, pose, style, 1, 0.2, 0.4, 0.6);
  approx(out.x, 0.1, 'returns to neutral'); approx(out.pitchRad, 0, 'returns to neutral pitch');

  // Backhand mirrors only the left/right-handed channels (x, yaw, roll, bodyYaw).
  SAP.samplePose(out, pose, style, 0.4, 0.2, 0.4, 0.6, -1);
  approx(out.x, 0.2, 'mirrored x'); approx(out.yawRad, 40 * DEG, 'mirrored yaw'); approx(out.rollRad, 50 * DEG, 'mirrored roll'); approx(out.bodyYawRad, -70 * DEG, 'mirrored bodyYaw');
  approx(out.y, 0.2, 'y is not mirrored'); approx(out.z, 0.4, 'z is not mirrored'); approx(out.pitchRad, -30 * DEG, 'pitch is not mirrored');

  // Power scales each channel's deviation from ITS OWN neutral.
  SAP.samplePose(out, pose, style, 0.4, 0.2, 0.4, 0.6, 1, 0.5);
  approx(out.x, 0.1 + (-0.2 - 0.1) * 0.5, 'half-power strike x');
  approx(out.bodyYawRad, 35 * DEG, 'half-power strike bodyYaw');

  // Channels a pose leaves out fall back to the style neutral; scale is static.
  SAP.samplePose(out, { windup: { x: 1 } }, SAP.STYLE_NEUTRAL_POSE.chop, 0, 0.2, 0.4, 0.6);
  approx(out.y, 0.37, 'missing neutral channel -> style neutral'); approx(out.pitchRad, -155 * DEG, 'missing neutral pitch -> style neutral');
  SAP.samplePose(out, { neutral: { scale: 1.77 } }, style, 0.3, 0.2, 0.4, 0.6);
  approx(out.scale, 1.77, 'authored neutral scale'); assert.equal(out.hasMirrorSequence, false); assert.equal(out.mirrorBlend, 1);
  SAP.samplePose(out, { neutral: { scale: 0 } }, style, 0.3, 0.2, 0.4, 0.6);
  approx(out.scale, 0.1, 'scale is clamped away from 0');

  // Midline-flip sequences blend the hand-attach X from the start side to the return side.
  const flip = { ...pose, neutralMirrorSign: 1, returnNeutralMirrorSign: -1 };
  SAP.samplePose(out, flip, style, 0, 0.2, 0.4, 0.6);
  assert.equal(out.hasMirrorSequence, true); approx(out.mirrorBlend, 1, 'starts on the attack side');
  SAP.samplePose(out, flip, style, 0.5, 0.2, 0.4, 0.6);
  approx(out.mirrorBlend, 1, 'holds the attack side through impact');
  SAP.samplePose(out, flip, style, 1, 0.2, 0.4, 0.6);
  approx(out.mirrorBlend, -1, 'ends on the flipped side');
}

// An enemy's staged action has no return tail: it samples with sf = wf, hf = 1,
// rising to the windup and then holding the strike pose for the rest of the action.
{
  SAP.samplePose(out, pose, style, 0.25, 0.5, 0.5, 1);
  approx(out.x, 0.1 + (0.3 - 0.1) * 0.5, 'enemy timeline: halfway through the windup');
  SAP.samplePose(out, pose, style, 0.5, 0.5, 0.5, 1);
  approx(out.x, 0.3, 'enemy timeline: windup endpoint');
  SAP.samplePose(out, pose, style, 0.51, 0.5, 0.5, 1);
  approx(out.x, -0.2, 'enemy timeline: strike pose is held immediately after the windup');
  SAP.samplePose(out, pose, style, 1, 0.5, 0.5, 1);
  approx(out.x, -0.2, 'enemy timeline: strike pose is held to the end of the action');
}

// The legacy thrust arc is one set of numbers: the sampler and the stance baker agree.
for (const power of [1, 1.3]) {
  const baked = SAP.legacyProceduralEndpoints('thrust', power);
  const bakedPose = { neutral: SAP.STYLE_NEUTRAL_POSE.thrust, windup: baked.windup, strike: baked.strike };
  for (const progress of [0, 0.16, 0.22, 0.28, 0.5, 1]) {
    const arc = SAP.sampleLegacyThrust(SAP.createSample(), progress, 0.16, 0.28, 0.4, power);
    const viaPose = SAP.samplePose(SAP.createSample(), bakedPose, SAP.STYLE_NEUTRAL_POSE.thrust, progress, 0.16, 0.28, 0.4);
    for (const key of ['x', 'y', 'z', 'pitchRad', 'yawRad', 'rollRad', 'bodyYawRad']) approx(arc[key], viaPose[key], `thrust ${key} @${progress} power ${power}`);
  }
}
for (const power of [1, 1.4]) {
  const baked = SAP.legacyProceduralEndpoints('chop', power);
  const bakedPose = { neutral: SAP.LEGACY_CHOP_POSE.neutral, windup: baked.windup, strike: baked.strike };
  for (const progress of [0, 0.1, 0.2, 0.28, 0.6, 1]) {
    const live = SAP.samplePose(SAP.createSample(), SAP.LEGACY_CHOP_POSE, SAP.STYLE_NEUTRAL_POSE.chop, progress, 0.16, 0.28, 0.4, 1, power);
    const viaBaked = SAP.samplePose(SAP.createSample(), bakedPose, SAP.STYLE_NEUTRAL_POSE.chop, progress, 0.16, 0.28, 0.4);
    for (const key of ['x', 'y', 'z', 'pitchRad', 'yawRad', 'rollRad', 'bodyYawRad']) approx(live[key], viaBaked[key], `chop ${key} @${progress} power ${power}`);
  }
}
{
  const sweep = SAP.legacyProceduralEndpoints('sweep', 1);
  approx(sweep.windup.bodyYaw * DEG, SAP.LEGACY_SWEEP.windupRad, 'sweep windup arc'); approx(sweep.strike.bodyYaw * DEG, SAP.LEGACY_SWEEP.strikeRad, 'sweep strike arc');
}

// Baking an attack against a replacement Neutral.
{
  const authored = {
    neutral: { ...SAP.STYLE_NEUTRAL_POSE.sweep },
    windup: { x: 0.2, y: 0.1, z: 0.3, pitch: 10, yaw: 20, bodyYaw: -30, roll: 40, secondaryGrip: { enabled: false } },
    strike: { x: -0.1, y: 0.2, z: 0.5, pitch: -15, yaw: -25, bodyYaw: 35, roll: -45 },
  };
  const { windup, strike } = SAP.bakeAttackEndpoints('sweep', authored, 1.5, { meleeSpacing: false });
  approx(windup.x, 0.2 * 1.5, 'power baked into windup x'); approx(windup.z, 0.16 + (0.3 - 0.16) * 1.5, 'power baked relative to the source neutral');
  approx(strike.bodyYaw, 35 * 1.5, 'power baked into strike bodyYaw');
  assert.deepEqual(windup.secondaryGrip, { enabled: false }, 'authored hand-grip flags ride along so enemies honor them like the player');
  assert.equal(SAP.effectiveDirSign('thrust', null, -1), 1, 'legacy thrust ignores the combat dirSign');
  assert.equal(SAP.effectiveDirSign('chop', null, -1), 1, 'legacy chop ignores the combat dirSign');
  assert.equal(SAP.effectiveDirSign('sweep', null, -1), -1, 'sweep honors the dirSign');
  assert.equal(SAP.effectiveDirSign('thrust', authored, -1), -1, 'authored poses honor the dirSign');
  const neutralInput = SAP.neutralInputForSigns({ x: 1, y: 2, z: 3, pitch: 4, yaw: 5, bodyYaw: 6, roll: 7 }, 1, -1);
  assert.deepEqual({ ...neutralInput }, { x: -1, y: 2, z: 3, pitch: 4, yaw: -5, bodyYaw: -6, roll: -7 }, 'only left/right-handed channels are pre-mirrored');

  // The melee spacing calibration is applied to both endpoints (and skipped for ranged / meleeSpacing:false).
  const spacingCalls = [];
  context.window.MeleePoseSpacing = { adjustEndpoint: (endpoint, phase) => { spacingCalls.push(phase); return { ...endpoint, y: endpoint.y + 100 }; } };
  const spaced = SAP.bakeAttackEndpoints('sweep', authored, 1);
  assert.deepEqual(spacingCalls, ['windup', 'strike']); approx(spaced.windup.y, 100.1, 'spaced windup'); approx(spaced.strike.y, 100.2, 'spaced strike');
  SAP.bakeAttackEndpoints('ranged', authored, 1);
  SAP.bakeAttackEndpoints('sweep', authored, 1, { meleeSpacing: false });
  assert.equal(spacingCalls.length, 2, 'ranged attacks and meleeSpacing:false skip the calibration');
  delete context.window.MeleePoseSpacing;
}

// ── The enemy renderer plays the shared sampler's output ───────────────
// Load the real combat-bandit.js and call its real updateToolMesh with a
// SharedAttackPose double returning sentinel channels: the holder transform
// must be built from exactly those numbers, using the player's own conventions.
{
  const calls = [];
  const sentinel = { x: 0.5, y: 0.25, z: 0.125, pitchRad: 0.3, yawRad: 0.2, rollRad: 0.1, bodyYawRad: 0.4, scale: 1, mirrorBlend: -1, hasMirrorSequence: true };
  const double = {
    createSample: () => ({}),
    STYLE_NEUTRAL_POSE: SAP.STYLE_NEUTRAL_POSE,
    swingTimeline: SAP.swingTimeline, // The shared clock itself: enemies must derive it from here.
    // The renderer asks the shared sampler for whatever style is playing; which arc that picks is
    // sampleSwing's own job (covered with the real module above).
    sampleSwing(sampleOut, anim, poseArg, progress, wf, sf, hf, sign, power, sequence) {
      calls.push({ kind: 'swing', anim, poseArg, progress, wf, sf, hf, sign, power, sequence });
      return Object.assign(sampleOut, sentinel);
    },
  };
  const sandbox = { window: { SharedAttackPose: double }, performance: { now: () => 1000 }, console };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(read('docs/js/combat/combat-bandit.js'), sandbox, { filename: 'combat-bandit.js' });

  const gripCalls = [];
  const restGrip = { dualWieldInfluence: 1, dualWieldIdleBlend: 1, source: 'rest' };
  sandbox.window.HobunjiHandToolGrips = {
    isDualWieldWeapon: key => key === 'fixture_dagger',
    animationGripAt: (progress, timing, poseSet, sequence, toolKey) => { gripCalls.push({ progress, timing, poseSet, sequence, toolKey }); return toolKey === 'fixture_dagger' && progress === 0 ? restGrip : { dualWieldInfluence: toolKey === 'fixture_dagger' ? 1 : 0, source: 'live' }; },
  };
  const angles = {};
  const quat = name => ({ setFromAxisAngle(axis, angle) { angles[name] = angle; return this; } });
  const holderQuaternion = { copy() { return this; }, multiply() { return this; } };
  sandbox.window.BanditCombat.init({
    TILE: 32, qFac: quat('fac'), qToolYaw: quat('yaw'), qAnim: quat('pitch'), qRoll: quat('roll'),
    tUp: 'up', xAxis: 'x', zAxis: 'z', TOOL_ITEM_DEFS: { fixture_axe: { animStyle: 'sweep' }, fixture_dagger: { animStyle: 'thrust' } },
  });

  function makeBandit(extra = {}) {
    const holder = { visible: true, children: [{ scale: { x: 1 }, userData: {} }], quaternion: holderQuaternion, position: { set(x, y, z) { this.x = x; this.y = y; this.z = z; } } };
    return {
      holder,
      c: {
        x: 64, y: 96, facing: 0.5, halfHeight: 0.4,
        def: { weaponKey: 'fixture_axe', aimAngleOffset: 0.1 },
        avatarRef: { group: { position: { x: 2, y: 1, z: 3 }, rotation: { y: 0 }, userData: {} }, handAttachX: -0.25, handAttachY: 0.6, handRigAvatarRoot: { userData: { proceduralHandToolKey: undefined } } },
        _banditToolHolder: holder, _banditAction: { windupS: 0.3, strikeS: 0.1, t: 0.2 },
        _banditSwingAnim: 'sweep', _banditSwingPose: pose, _banditSwingDirSign: -1, _banditSwingPower: 1.25, _banditSwingPoseScale: 1,
        ...extra,
      },
    };
  }
  function expectedHolder(c, sample) {
    const theta = -c.facing + Math.PI / 2;
    const v = theta + sample.bodyYawRad;
    const baseX = c.avatarRef.handAttachX * sample.mirrorBlend;
    return {
      x: c.x / 32 + Math.cos(v) * (baseX + sample.x) + Math.sin(v) * sample.z,
      y: c.avatarRef.group.position.y - c.halfHeight + c.avatarRef.handAttachY + sample.y,
      z: c.y / 32 + -Math.sin(v) * (baseX + sample.x) + Math.cos(v) * sample.z,
      v,
    };
  }

  // Authored pose (sweep / chop): sampled on the player's clock (SharedAttackPose.swingTimeline) built from the
  // action's windup/strike and the ability's own hold, with the action's own power and sign.
  const { c, holder } = makeBandit({ _banditSwingHoldS: 0.43 });
  const expected = SAP.swingTimeline({}, 0.4, 0.3 / 0.4, 1, 0.43);
  sandbox.window.BanditCombat.updateToolMesh(c);
  assert.equal(calls.length, 1); assert.equal(calls[0].kind, 'swing');
  assert.equal(calls[0].poseArg, pose); assert.equal(calls[0].anim, 'sweep');
  approx(calls[0].progress, 0.2 / expected.totalS, 'progress'); approx(calls[0].wf, expected.wf, 'wf'); approx(calls[0].sf, expected.sf, 'sf'); approx(calls[0].hf, expected.hf, 'hf');
  assert.ok(calls[0].sf > calls[0].wf && calls[0].hf > calls[0].sf && calls[0].hf < 1, 'strike travels, holds, then leaves room for the eased return');
  assert.equal(calls[0].sign, -1); assert.equal(calls[0].power, 1.25); assert.equal(calls[0].sequence, 'attack');
  const want = expectedHolder(c, sentinel);
  approx(holder.position.x, want.x, 'holder x'); approx(holder.position.y, want.y, 'holder y'); approx(holder.position.z, want.z, 'holder z');
  approx(angles.pitch, sentinel.pitchRad, 'pitch'); approx(angles.yaw, sentinel.yawRad, 'yaw'); approx(angles.roll, sentinel.rollRad, 'roll'); approx(angles.fac, want.v, 'facing + bodyYaw');
  approx(c.groupRot, want.v - c.def.aimAngleOffset, 'the avatar body leans with the weapon'); approx(c.avatarRef.group.rotation.y, c.groupRot, 'body rotation');
  assert.ok(c._banditToolSettleUntil > 1000, 'a swinging enemy reports its swing as still playing');
  // The hand grip is evaluated for THIS enemy's weapon on the same clock, so the weapon picks the hand mode.
  assert.equal(gripCalls.length, 1); assert.equal(gripCalls[0].sequence, 'attack'); assert.equal(gripCalls[0].toolKey, 'fixture_axe');
  approx(gripCalls[0].timing.windupFrac, expected.wf, 'grip windupFrac'); approx(gripCalls[0].timing.strikeFrac, expected.sf, 'grip strikeFrac'); approx(gripCalls[0].timing.holdFrac, expected.hf, 'grip holdFrac');
  assert.equal(c.avatarRef.handRigAvatarRoot.userData.proceduralHandToolKey, 'fixture_axe');
  // A pose that flips across the midline (Heavy weapons) also reverses the sprite once the blend crosses the midpoint.
  assert.equal(holder.children[0].scale.x, -1, 'sweep sprite follows the mirror blend');
  assert.equal(c._banditToolTimeline.planeMirrorSign, -1);

  // The player keeps animating after the strike lands: a completed action hands the rest of the clock to a tail.
  c._banditToolTail = { startMs: 1000, baseElapsedS: 0.4, durationS: 0.4, windupFrac: 0.75, strikeFrac: 1, holdS: 0.43 };
  c._banditAction = null;
  for (const [nowMs, expectProgress] of [[1000, 0.4], [1300, 0.7], [1900, 1.3]]) {
    sandbox.performance.now = () => nowMs; calls.length = 0;
    sandbox.window.BanditCombat.updateToolMesh(c);
    if (expectProgress < expected.totalS) {
      assert.equal(calls.length, 1, `still playing at +${nowMs - 1000}ms`);
      approx(calls[0].progress, expectProgress / expected.totalS, `tail progress at +${nowMs - 1000}ms`);
      approx(calls[0].hf, expected.hf, 'tail uses the same clock');
      assert.ok(c._banditToolTail, 'tail stays until the return finishes');
    }
  }
  assert.equal(c._banditToolTail, null, 'the tail ends once the eased return has played');
  assert.equal(c._banditSwingAnim, 'sweep', 'rest stance is the weapon natural swing again');

  // Legacy thrust: the same sampler and the same placement, on the same clock.
  sandbox.performance.now = () => 1000; calls.length = 0;
  const thrusting = makeBandit({ _banditSwingAnim: 'thrust', _banditSwingPose: null, _banditSwingDirSign: 1, _banditSwingHoldS: 0.48 });
  sandbox.window.BanditCombat.updateToolMesh(thrusting.c);
  const thrustClock = SAP.swingTimeline({}, 0.4, 0.3 / 0.4, 1, 0.48);
  assert.equal(calls.length, 1); assert.equal(calls[0].kind, 'swing'); assert.equal(calls[0].anim, 'thrust'); assert.equal(calls[0].poseArg, null);
  approx(calls[0].wf, thrustClock.wf, 'thrust wf'); approx(calls[0].sf, thrustClock.sf, 'thrust sf'); approx(calls[0].hf, thrustClock.hf, 'thrust hf'); assert.equal(calls[0].power, 1.25);
  const thrustWant = expectedHolder(thrusting.c, sentinel);
  approx(thrusting.holder.position.x, thrustWant.x, 'thrust holder x'); approx(thrusting.holder.position.y, thrustWant.y, 'thrust holder y'); approx(thrusting.holder.position.z, thrustWant.z, 'thrust holder z');

  // A completed action hands its hold/return to a tail on the same clock; a cancelled one (or a Flasker throw) resets at once.
  const finishing = makeBandit({ _banditSwingHoldS: 0.43, _banditSwingReturnS: 0, _banditSwingAnim: 'sweep', _banditSwingPower: 1.25 });
  sandbox.performance.now = () => 5000;
  finishing.c._banditAction = { windupS: 0.3, strikeS: 0.1, t: 0.4, cancelled: false, data: { isBandit: true } };
  sandbox.window.BanditCombat.finishAction(finishing.c);
  assert.equal(finishing.c._banditAction, null);
  const tail = finishing.c._banditToolTail;
  assert.deepEqual([tail.startMs, tail.baseElapsedS, tail.durationS, tail.strikeFrac, tail.holdS], [5000, 0.4, 0.4, 1, 0.43]);
  approx(tail.windupFrac, 0.75, 'tail windupFrac');
  assert.equal(finishing.c._banditSwingPower, 1.25, 'the swing keeps its pose and power while the tail plays');
  const cancelled = makeBandit({ _banditSwingHoldS: 0.43, _banditSwingPower: 1.25 });
  cancelled.c._banditAction = { windupS: 0.3, strikeS: 0.1, t: 0.1, cancelled: true, data: { isBandit: true } };
  sandbox.window.BanditCombat.finishAction(cancelled.c);
  assert.equal(cancelled.c._banditToolTail, null, 'a staggered (cancelled) swing does not play out its strike');
  assert.equal(cancelled.c._banditSwingPower, 1, 'and returns to the rest stance immediately');
  const flask = makeBandit({ _banditSwingHoldS: 0 });
  flask.c._banditAction = { windupS: 0.3, strikeS: 0.1, t: 0.4, cancelled: false, data: { isBandit: true, flasker: true } };
  sandbox.window.BanditCombat.finishAction(flask.c);
  assert.equal(flask.c._banditToolTail, null, 'a Flasker throw has no melee tail');

  // A dual-wield weapon rests in its two-weapon idle stance (the grip state at Neutral); other weapons rest one-handed.
  const daggerDef = { weaponKey: 'fixture_dagger', aimAngleOffset: 0 };
  const dagger = makeBandit({ def: daggerDef, _banditAction: null, _banditSwingAnim: 'thrust', _banditSwingPose: null });
  gripCalls.length = 0;
  sandbox.window.BanditCombat.updateToolMesh(dagger.c);
  const daggerRoot = dagger.c.avatarRef.handRigAvatarRoot.userData;
  assert.equal(daggerRoot.proceduralHandToolKey, 'fixture_dagger');
  assert.equal(daggerRoot.proceduralHandAnimationGrip, restGrip, 'rest grip carries the dual-wield idle blend');
  sandbox.window.BanditCombat.updateToolMesh(dagger.c);
  assert.equal(gripCalls.length, 1, 'the rest grip is computed once per weapon, not per frame');
  const axeRest = makeBandit({ _banditAction: null });
  sandbox.window.BanditCombat.updateToolMesh(axeRest.c);
  assert.equal(axeRest.c.avatarRef.handRigAvatarRoot.userData.proceduralHandAnimationGrip, null, 'non-dual weapons rest one-handed');
}

console.log('shared attack pose tests passed');
