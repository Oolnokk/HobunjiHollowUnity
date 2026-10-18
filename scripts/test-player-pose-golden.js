#!/usr/bin/env node
'use strict';

// GOLDEN REFERENCE. The player's attack animations as they were before the shared module existed
// (game.js updateToolMesh + weapon-tool-stances.js, commit 9855210) are the authoritative look for the
// player AND for enemies. The functions below are verbatim copies of that math; SharedAttackPose must
// reproduce them exactly. If this fails, the shared module changed how attacks look: fix the module,
// not this reference (change the reference only for a deliberate, approved animation change).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const sandbox = { window: {} };
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
for (const file of ['docs/js/combat/shared-attack-pose.js', 'docs/js/combat/melee-pose-spacing.js']) vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
const SAP = sandbox.window.SharedAttackPose;
const degToRad = d => d * (Math.PI / 180);

// ── game.js (pre-change) ───────────────────────────────────────────────
function fourPhaseLerp(progress, wf, sf, hf, windupV, strikeV, neutralV = 0, returnNeutralV = neutralV) {
  if (progress <= wf) return neutralV + (windupV - neutralV) * (progress / wf);
  if (progress <= sf) return windupV + (strikeV - windupV) * ((progress - wf) / (sf - wf));
  if (progress <= hf) return strikeV;
  return strikeV + (returnNeutralV - strikeV) * ((progress - hf) / (1.0 - hf));
}
let combatSwingSequence = 'attack';
function sequencedPoseLerp(progress, wf, sf, hf, windupV, strikeV, neutralV = 0, returnNeutralV = neutralV) {
  if (combatSwingSequence === 'load') {
    if (progress <= wf) return neutralV + (windupV - neutralV) * (progress / Math.max(0.0001, wf));
    return windupV + (returnNeutralV - windupV) * ((progress - wf) / Math.max(0.0001, 1 - wf));
  }
  if (combatSwingSequence === 'fire') {
    if (progress <= sf) return neutralV + (strikeV - neutralV) * (progress / Math.max(0.0001, sf));
    if (progress <= hf) return strikeV;
    return strikeV + (returnNeutralV - strikeV) * ((progress - hf) / Math.max(0.0001, 1 - hf));
  }
  return fourPhaseLerp(progress, wf, sf, hf, windupV, strikeV, neutralV, returnNeutralV);
}
const STYLE_NEUTRAL_POSE = {
  thrust: { x: 0, y: 0, z: 0, pitch: 10.31, yaw: 0, roll: 0, bodyYaw: 0, scale: 1 },
  sweep: { x: 0, y: 0, z: 0.16, pitch: 0, yaw: 0, roll: 0, bodyYaw: 0, scale: 1 },
  chop: { x: 0.03, y: 0.37, z: -0.01, pitch: -155, yaw: -79, roll: -82, bodyYaw: 2, scale: 1 },
  ranged: { x: 0.23, y: 0.08, z: 0.14, pitch: 16, yaw: 65, roll: 11, bodyYaw: -52, scale: 1.77 },
};
function playerPose(pose, anim, progress, WF, SF, poseHoldFrac, sign, power, sequence) {
  combatSwingSequence = sequence;
  const styleNeutral = STYLE_NEUTRAL_POSE[anim] || STYLE_NEUTRAL_POSE.thrust;
  const neutral = { ...styleNeutral, ...(pose.neutral || {}) };
  const returnNeutral = { ...neutral, ...(pose.returnNeutral || {}) };
  const hasNeutralMirrorSequence = pose.neutralMirrorSign != null || pose.returnNeutralMirrorSign != null;
  const startMirrorSign = pose.neutralMirrorSign === -1 ? -1 : 1;
  const returnMirrorSign = pose.returnNeutralMirrorSign === -1 ? -1 : 1;
  const scale = (ch, v) => neutral[ch] + ((v ?? neutral[ch]) - neutral[ch]) * power;
  const chan = (ch, mirror = false) => {
    const w = scale(ch, pose.windup?.[ch]) * (mirror ? sign : 1);
    const s = scale(ch, pose.strike?.[ch]) * (mirror ? sign : 1);
    const n = neutral[ch] * (mirror ? sign : 1);
    const rn = returnNeutral[ch] * (mirror ? sign : 1);
    return sequencedPoseLerp(progress, WF, SF, poseHoldFrac, w, s, n, rn);
  };
  const mirrorBlend = hasNeutralMirrorSequence ? sequencedPoseLerp(progress, WF, SF, poseHoldFrac, sign, sign, startMirrorSign, returnMirrorSign) : 1;
  return {
    x: chan('x', true), y: chan('y'), z: chan('z'),
    pitchRad: degToRad(chan('pitch')), yawRad: degToRad(chan('yaw', true)), rollRad: degToRad(chan('roll', true)), bodyYawRad: degToRad(chan('bodyYaw', true)),
    scale: Number.isFinite(Number(neutral.scale)) ? Math.max(0.1, Number(neutral.scale)) : 1, mirrorBlend, hasMirrorSequence: hasNeutralMirrorSequence,
  };
}
function playerThrust(progress, WF, SF, HF, power, combat) {
  const windupBack = (combat ? -0.40 : -0.22) * power;
  return {
    z: fourPhaseLerp(progress, WF, SF, HF, windupBack, 0.32 * power),
    x: fourPhaseLerp(progress, WF, SF, HF, 0, -0.23 * power),
    pitchRad: fourPhaseLerp(progress, WF, SF, HF, degToRad(10.31), degToRad(1), degToRad(10.31)),
    yawRad: fourPhaseLerp(progress, WF, SF, HF, 0, degToRad(-45) * power),
    bodyYawRad: fourPhaseLerp(progress, WF, SF, HF, degToRad(-45) * power, degToRad(46) * power),
  };
}
function playerChop(progress, WF, SF, HF, power) {
  const neutral = { x: 0.03, y: 0.37, z: -0.01, pitch: -155, yaw: -79, bodyYaw: 2, roll: -82 };
  const windup = { x: -0.18, y: 0.41, z: -0.15, pitch: -165, yaw: 13, bodyYaw: -29, roll: -112 };
  const strike = { x: 0, y: 0, z: 0.12, pitch: 13, yaw: -28, bodyYaw: 29, roll: -91 };
  const scale = (ch, v) => neutral[ch] + (v - neutral[ch]) * power;
  const c = ch => fourPhaseLerp(progress, WF, SF, HF, scale(ch, windup[ch]), scale(ch, strike[ch]), neutral[ch]);
  return { x: c('x'), y: c('y'), z: c('z'), pitchRad: degToRad(c('pitch')), yawRad: degToRad(c('yaw')), rollRad: degToRad(c('roll')), bodyYawRad: degToRad(c('bodyYaw')) };
}

// ── weapon-tool-stances.js (pre-change) ────────────────────────────────
const POSE_KEYS = ['x', 'y', 'z', 'pitch', 'yaw', 'bodyYaw', 'roll'];
const MIRRORED = new Set(['x', 'yaw', 'bodyYaw', 'roll']);
const ENGINE_NEUTRAL_POSES = {
  thrust: { x: 0, y: 0, z: 0, pitch: 10.31, yaw: 0, bodyYaw: 0, roll: 0 },
  sweep: { x: 0, y: 0, z: 0.16, pitch: 0, yaw: 0, bodyYaw: 0, roll: 0 },
  chop: { x: 0.03, y: 0.37, z: -0.01, pitch: -155, yaw: -79, bodyYaw: 2, roll: -82 },
};
function normalizePose(raw, fallback) {
  const pose = {};
  for (const key of POSE_KEYS) { const value = Number(raw?.[key]); pose[key] = Number.isFinite(value) ? value : Number(fallback?.[key]) || 0; }
  return pose;
}
function legacyProceduralEndpoints(anim, power) {
  const p = Number.isFinite(Number(power)) ? Number(power) : 1;
  if (anim === 'chop') {
    const neutral = ENGINE_NEUTRAL_POSES.chop;
    const rawWindup = { x: -0.18, y: 0.41, z: -0.15, pitch: -165, yaw: 13, bodyYaw: -29, roll: -112 };
    const rawStrike = { x: 0, y: 0, z: 0.12, pitch: 13, yaw: -28, bodyYaw: 29, roll: -91 };
    const scaleFromNeutral = raw => { const out = {}; for (const key of POSE_KEYS) out[key] = neutral[key] + (raw[key] - neutral[key]) * p; return out; };
    return { windup: scaleFromNeutral(rawWindup), strike: scaleFromNeutral(rawStrike) };
  }
  if (anim === 'sweep') {
    return {
      windup: { x: 0, y: 0, z: 0.16, pitch: 0, yaw: 0, bodyYaw: -2.20 * (180 / Math.PI) * p, roll: 0 },
      strike: { x: 0, y: 0, z: 0.16, pitch: 0, yaw: 0, bodyYaw: 2.12 * (180 / Math.PI) * p, roll: 0 },
    };
  }
  return {
    windup: { x: 0, y: 0, z: -0.40 * p, pitch: 10.31, yaw: 0, bodyYaw: -45 * p, roll: 0 },
    strike: { x: -0.23 * p, y: 0, z: 0.32 * p, pitch: 1, yaw: -45 * p, bodyYaw: 46 * p, roll: 0 },
  };
}
function bakeAuthoredEndpoint(raw, sourceNeutral, power) {
  const out = { ...raw };
  for (const key of POSE_KEYS) { const rawValue = Number(raw?.[key]); const endpoint = Number.isFinite(rawValue) ? rawValue : sourceNeutral[key]; out[key] = sourceNeutral[key] + (endpoint - sourceNeutral[key]) * power; }
  return out;
}
function neutralInputForSigns(targetNeutral, visibleSign, runtimeSign) {
  const out = {};
  for (const key of POSE_KEYS) out[key] = MIRRORED.has(key) ? targetNeutral[key] * visibleSign * runtimeSign : targetNeutral[key];
  return out;
}
function bakedEndpoints(rawOpts, power) { // The endpoint section of the old prepareCombatOptions.
  const anim = rawOpts.anim;
  const authoredPose = rawOpts.pose && typeof rawOpts.pose === 'object' ? rawOpts.pose : null;
  let windup; let strike;
  if (authoredPose) {
    const styleNeutral = ENGINE_NEUTRAL_POSES[anim] || ENGINE_NEUTRAL_POSES.thrust;
    const sourceNeutral = normalizePose(authoredPose.neutral, styleNeutral);
    windup = bakeAuthoredEndpoint(authoredPose.windup, sourceNeutral, power);
    strike = bakeAuthoredEndpoint(authoredPose.strike, sourceNeutral, power);
  } else ({ windup, strike } = legacyProceduralEndpoints(anim, power));
  if (rawOpts.meleeSpacing !== false && anim !== 'ranged' && sandbox.window.MeleePoseSpacing?.adjustEndpoint) {
    windup = sandbox.window.MeleePoseSpacing.adjustEndpoint(windup, 'windup');
    strike = sandbox.window.MeleePoseSpacing.adjustEndpoint(strike, 'strike');
  }
  return { windup, strike };
}

// ── enemies (pre-change combat-bandit.js timeline: rise to windup, then hold strike) ──
function banditPoseLerp(progress, wf, windupV, strikeV, neutralV) {
  if (progress <= wf) return neutralV + (windupV - neutralV) * (progress / Math.max(0.0001, wf));
  return strikeV;
}

// ── fuzz ───────────────────────────────────────────────────────────────
let seed = 987654; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const pick = list => list[Math.floor(rnd() * list.length)];
const randomChannels = partial => { const o = {}; for (const k of POSE_KEYS) if (!partial || rnd() < 0.7) o[k] = (rnd() - 0.5) * (['x', 'y', 'z'].includes(k) ? 1 : 300); return o; };
const same = (a, b, label, ctx) => { for (const k of Object.keys(a)) { const x = a[k]; const y = b[k]; if (typeof x === 'number') assert.ok(Object.is(x, y) || x === y, `${label}.${k}: golden ${x} new ${y} ${JSON.stringify(ctx)}`); else assert.equal(x, y, `${label}.${k}`); } };
const out = SAP.createSample();
const poseKeys = ['x', 'y', 'z', 'pitchRad', 'yawRad', 'rollRad', 'bodyYawRad'];

for (let i = 0; i < 30000; i += 1) {
  const anim = pick(['thrust', 'sweep', 'chop', 'ranged', 'other']);
  const pose = { neutral: rnd() < 0.7 ? randomChannels(true) : undefined, windup: randomChannels(true), strike: randomChannels(true) };
  if (rnd() < 0.3) pose.returnNeutral = randomChannels(true);
  if (rnd() < 0.3) pose.neutralMirrorSign = pick([1, -1]);
  if (rnd() < 0.3) pose.returnNeutralMirrorSign = pick([1, -1]);
  if (rnd() < 0.15) pose.neutral = { ...(pose.neutral || {}), scale: pick([0.5, 1, 1.77, 0, NaN]) };
  const WF = 0.01 + rnd() * 0.5; const SF = WF + 0.01 + rnd() * 0.4; const HF = Math.min(0.99, SF + rnd() * 0.3); const progress = rnd();
  const sign = pick([1, -1]); const power = pick([1, 1, 0.5, 1.3, 0]); const sequence = pick(['attack', 'attack', 'load', 'fire']);
  const ctx = { anim, pose, WF, SF, HF, progress, sign, power, sequence };

  // Player authored pose.
  SAP.samplePose(out, pose, SAP.STYLE_NEUTRAL_POSE[anim] || SAP.STYLE_NEUTRAL_POSE.thrust, progress, WF, SF, HF, sign, power, sequence);
  same(playerPose(pose, anim, progress, WF, SF, HF, sign, power, sequence), out, 'player pose', ctx);

  // Player legacy thrust (tool jab and combat jab) and chop.
  const tp = pick([1, 1, 0.7, 1.4]); const combat = rnd() < 0.5;
  SAP.sampleLegacyThrust(out, progress, WF, SF, HF, tp, (combat ? SAP.LEGACY_THRUST.windupBackCombat : SAP.LEGACY_THRUST.windupBackTool) * tp);
  same(playerThrust(progress, WF, SF, HF, tp, combat), out, 'player thrust', ctx);
  SAP.samplePose(out, SAP.LEGACY_CHOP_POSE, SAP.STYLE_NEUTRAL_POSE.chop, progress, WF, SF, HF, 1, tp, 'attack');
  same(playerChop(progress, WF, SF, HF, tp), out, 'player chop', ctx);

  // Player Light/Heavy stance baking (endpoints, sign policy, neutral handedness) for every anim, ranged included.
  const rawOpts = { anim, pose: rnd() < 0.6 ? pose : null, meleeSpacing: pick([true, true, false]), dirSign: sign };
  const baked = SAP.bakeAttackEndpoints(anim, rawOpts.pose, power, { meleeSpacing: rawOpts.meleeSpacing !== false });
  const goldenBaked = bakedEndpoints(rawOpts, power);
  assert.deepEqual(JSON.parse(JSON.stringify(baked)), JSON.parse(JSON.stringify(goldenBaked)), `baked endpoints ${JSON.stringify(ctx)}`);
  const target = normalizePose(randomChannels(false), {});
  const visible = pick([1, -1]); const runtime = pick([1, -1]);
  assert.deepEqual({ ...SAP.neutralInputForSigns(target, visible, runtime) }, neutralInputForSigns(target, visible, runtime), 'neutral handedness');
  assert.equal(SAP.effectiveDirSign(anim, rawOpts.pose, sign), rawOpts.pose || anim === 'sweep' ? sign : 1, 'dirSign policy');

  // Enemy timeline as it was: rise to the windup, hold the strike.
  const wf = rnd() * 0.9; const bp = Math.min(1, rnd());
  const bn = { ...STYLE_NEUTRAL_POSE[pick(['sweep', 'chop'])], ...(pose.neutral || {}) };
  const goldenEnemy = banditPoseLerp(bp, wf, (bn.x + ((pose.windup.x ?? bn.x) - bn.x) * power) * sign, (bn.x + ((pose.strike.x ?? bn.x) - bn.x) * power) * sign, bn.x * sign);
  SAP.samplePose(out, { neutral: pose.neutral, windup: pose.windup, strike: pose.strike }, bn, bp, wf, wf, 1, sign, power, 'attack');
  assert.ok(Object.is(goldenEnemy, out.x) || goldenEnemy === out.x, `enemy timeline x ${JSON.stringify({ bp, wf, sign, power })}`);
}
// ── game.js triggerWeaponSwingVisual + updateToolMesh HF (pre-change): the player's swing clock ──
const timeline = { totalS: 0, wf: 0, sf: 0, hf: 0 };
for (let i = 0; i < 20000; i += 1) {
  const durationS = 0.05 + rnd() * 1.2; const windupFrac = rnd() * 0.9; const strikeFrac = pick([1, 1, windupFrac + rnd() * (1 - windupFrac) * 0.9, 0.28]);
  const holdS = pick([0, 0, 0.43, rnd()]);
  const hasOwnReturn = strikeFrac < 0.999;
  const returnTailS = hasOwnReturn ? 0 : Math.max(0.12, durationS * 0.35);
  const totalS = durationS + returnTailS + holdS;
  const toolSwingDur = Math.max(0.05, totalS);
  const WF = windupFrac * durationS / totalS; const SF = strikeFrac * durationS / totalS;
  const HF = (holdS > 0) ? Math.min(0.99, SF + holdS / toolSwingDur) : Math.min(0.99, SF + (1 - SF) * 0.3);
  SAP.swingTimeline(timeline, durationS, windupFrac, strikeFrac, holdS);
  for (const [name, golden, actual] of [['totalS', toolSwingDur, timeline.totalS], ['wf', WF, timeline.wf], ['sf', SF, timeline.sf], ['hf', HF, timeline.hf]]) {
    assert.ok(Object.is(golden, actual) || golden === actual, `swing clock ${name}: golden ${golden} new ${actual} ${JSON.stringify({ durationS, windupFrac, strikeFrac, holdS })}`);
  }
}
console.log('player animation golden reference reproduced by SharedAttackPose');
