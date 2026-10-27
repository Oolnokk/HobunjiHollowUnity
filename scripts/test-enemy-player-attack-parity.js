#!/usr/bin/env node
'use strict';

// Player / enemy attack-animation parity, end to end through the real modules.
//
// The player's swing (game.js updateToolMesh, pinned by test-player-pose-golden)
// is the reference. For every attack an enemy shares with the player, this runs
// the PLAYER's real ability code (combat-combo.js / combat-quickattacks.js onTap)
// to capture what it hands the swing visual, runs the ENEMY's real fire function
// (sliced from combat-bandit.js) to capture what it hands its renderer, and
// samples both through SharedAttackPose the way each renderer does. Also covers
// the enemy-only follow-ups found in the same review: the Charged Breaker windup
// curve, enemy hand-grip timing, and leaps/lunges that end mid-hop.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const read = rel => fs.readFileSync(rel, 'utf8');
const approx = (actual, expected, label, eps = 1e-9) => assert.ok(Math.abs(actual - expected) <= eps, `${label}: ${actual} vs ${expected}`);

// ── Shared runtime: the real pose math, templates, combo and quick-attack modules ──
const registered = {};
let visualCall = null;
let stagedCall = null;
const player = { angle: 0, x: 0, y: 0, health: 100, maxHealth: 100, stamina: 100, maxStamina: 100 };
const runtime = { performance: { now: () => 1000 }, console, Math };
runtime.window = runtime;
runtime.ResourceSystem = { spendStamina: () => ({ spent: 10, excess: 0 }), getExhaustionSpeed: () => 1 };
runtime.CombatProgression = { getEffects: () => ({ afflictions: {}, stats: {} }) };
runtime.Combat = {
  abilities: { register(id, ability) { registered[id] = ability; } },
  isStaggered: () => false,
  beginStagedAction(opts) { stagedCall = opts; return { ...opts, t: 0, cancel() {} }; },
  playerMeleeThreat: () => null,
  deps: {
    player, TILE: 32, hostileObjects: [],
    currentWeaponKey: () => 'hatchet',
    currentWeaponDamageType: () => 'sharp',
    weaponAbility: () => ({ damage: 14, rangePx: 34, knockbackPxS: 360 }),
    triggerWeaponSwingVisual(durationS, opts) { visualCall = { durationS, opts }; },
    beginCombatLunge() {},
    getCurrentArea: () => 'farm',
  },
};
vm.createContext(runtime);
for (const file of ['docs/js/combat/shared-attack-pose.js', 'docs/js/combat/attack-pose-templates.js', 'docs/js/combat/combat-combo.js', 'docs/js/combat/combat-quickattacks.js']) {
  vm.runInContext(read(file), runtime, { filename: file });
}
const SAP = runtime.SharedAttackPose;
const Combat = runtime.Combat;

// ── The enemy's real fire functions, sliced out of combat-bandit.js ──
const banditSource = read('docs/js/combat/combat-bandit.js');
const fireSlice = banditSource.slice(banditSource.indexOf('  function fireBanditComboStep('), banditSource.indexOf('  function updateBanditGuardWindow('));
const banditScope = {
  window: runtime, performance: runtime.performance, Math,
  deps: { TILE: 32, rnd: () => 0.5 },
  banditAttackBaseline: () => ({ damage: 10, rangePx: 40, knockbackPxS: 300 }),
  banditQuickAttackConditions: () => ({}),
  beginBanditLunge() {}, finishBanditAction() {}, spawnBanditTrailArc() {}, damageBanditCombatTarget() {},
  banditRetreatDurationS: () => 0, BANDIT_COMBO_CHAIN_GAP_S: 0, BANDIT_HOLD1_COOLDOWN_S: 0,
};
vm.createContext(banditScope);
vm.runInContext(fireSlice, banditScope, { filename: 'combat-bandit.js#fire' });
Combat.meleeAimSolution = () => ({ pitch: 0 });
Combat.buildQuickAttack = def => ({ damageMul: 1, rangeMul: def.rangeMul || 1, halfConeDeg: def.halfConeDeg || 10, knockbackMul: 1, sourceText: 'test' });
const makeBandit = () => ({ x: 0, y: 0, facing: 0, def: { attackTag: 'sharp', attackCooldownS: 1 }, _banditComboIndex: 0 });
const target = { x: 64, y: 0, health: 100, maxHealth: 100, stamina: 100, maxStamina: 100, angle: 0 };

// Samples the player's pose-driven branch (game.js: samplePose over STYLE_NEUTRAL_POSE[anim] || thrust, the
// visual's own sign and power) against the enemy renderer's sampler (sampleSwing with the enemy's own fields).
function assertSameSwing(label, opts, enemy) {
  const playerSample = SAP.createSample();
  const enemySample = SAP.createSample();
  const neutral = SAP.STYLE_NEUTRAL_POSE[opts.anim] || SAP.STYLE_NEUTRAL_POSE.thrust;
  const wf = 0.3, sf = 0.42, hf = 0.7;
  for (let i = 0; i <= 20; i += 1) {
    const t = i / 20;
    SAP.samplePose(playerSample, opts.pose, neutral, t, wf, sf, hf, opts.dirSign || 1, opts.power ?? 1, 'attack');
    SAP.sampleSwing(enemySample, enemy._banditSwingAnim, enemy._banditSwingPose, t, wf, sf, hf, enemy._banditSwingDirSign, enemy._banditSwingPower * enemy._banditSwingPoseScale, 'attack');
    for (const key of ['x', 'y', 'z', 'pitchRad', 'yawRad', 'rollRad', 'bodyYawRad', 'mirrorBlend']) {
      approx(enemySample[key], playerSample[key], `${label} ${key} @${t}`);
    }
  }
}

// ── Every combo step: player onTap vs BanditCombat fireBanditComboStep ──
for (const comboId of ['swingCombo', 'pokeCombo']) {
  const steps = Combat.comboData[comboId];
  const bandit = makeBandit();
  for (let i = 0; i < steps.length; i += 1) {
    visualCall = null;
    registered[comboId].onTap();
    assert.ok(visualCall, `${comboId} step ${i} starts the player's swing visual`);
    stagedCall?.onComplete?.(); // Frees the combo for its next step.
    assert.equal(banditScope.fireBanditComboStep(bandit, bandit.def, { tap1: comboId }, target), true);
    assert.equal(bandit._banditSwingAnim, visualCall.opts.anim, `${comboId} step ${i} style`);
    assert.ok(bandit._banditSwingPose, `${comboId} step ${i}: the enemy plays an authored pose, not the legacy arc`);
    assertSameSwing(`${comboId} step ${i}`, visualCall.opts, bandit);
  }
}

// ── Weapon shape speed: the player's and the enemy's swing clocks for the same weapon ──
// weapon-shape-stats.js scales both sides' timing; every combo step and quick attack must still build the same
// SharedAttackPose.swingTimeline (same total length and phase fractions) for a fast and a slow weapon.
{
  const timelineOf = (durationS, windupFrac, strikeFrac, holdS) => SAP.swingTimeline({}, durationS, windupFrac, strikeFrac, holdS);
  const banditTimeline = (c, action) => {
    const durationS = action.windupS + action.strikeS + (c._banditSwingReturnS || 0);
    return timelineOf(durationS, action.windupS / durationS, (action.windupS + action.strikeS) / durationS, c._banditSwingHoldS);
  };
  const sameTimeline = (label, a, b) => { for (const key of ['totalS', 'wf', 'sf', 'hf']) approx(b[key], a[key], `${label} ${key}`, 1e-9); };
  for (const speed of [1.25, 0.8]) {
    const stats = { power: 1, speed, range: 1, efficiency: 1 };
    runtime.WeaponShapeStats = { current: () => stats, forShape: () => stats, DEFAULT: { power: 1, speed: 1, range: 1, efficiency: 1 } };
    for (const comboId of ['swingCombo', 'pokeCombo']) {
      const bandit = makeBandit();
      bandit.def.weaponShapeStats = stats;
      for (let i = 0; i < Combat.comboData[comboId].length; i += 1) {
        visualCall = null;
        registered[comboId].onTap();
        stagedCall?.onComplete?.();
        const playerClock = timelineOf(visualCall.durationS, visualCall.opts.windupFrac, visualCall.opts.strikeFrac, visualCall.opts.holdS);
        banditScope.fireBanditComboStep(bandit, bandit.def, { tap1: comboId }, target);
        sameTimeline(`speed ${speed} ${comboId} step ${i}`, playerClock, banditTimeline(bandit, stagedCall));
      }
    }
    for (const id of Object.keys(Combat.quickAttackData.TECHNIQUES)) {
      visualCall = null;
      try { registered[id].onTap(); } catch (error) { if (!visualCall) throw error; }
      stagedCall?.onComplete?.();
      const playerClock = timelineOf(visualCall.durationS, visualCall.opts.windupFrac, visualCall.opts.strikeFrac, visualCall.opts.holdS);
      const bandit = makeBandit();
      bandit.def.weaponShapeStats = stats;
      banditScope.fireBanditQuickAttack(bandit, bandit.def, { tap2: id }, target);
      sameTimeline(`speed ${speed} quick ${id}`, playerClock, banditTimeline(bandit, stagedCall));
    }
  }
  delete runtime.WeaponShapeStats;
}

// Long Lunge specifically: the enemy no longer pulls back farther or reaches farther than the player.
{
  const longLunge = Combat.comboData.pokeCombo[2];
  const pose = Combat.comboStepPose('pokeCombo', longLunge);
  const windup = SAP.sampleSwing(SAP.createSample(), 'thrust', pose, 0.3, 0.3, 0.42, 0.7, 1, 1);
  approx(windup.z, -0.22, 'Long Lunge windup pull-back is the template value');
}

// ── Quick attacks: player onTap vs fireBanditQuickAttack ──
Combat.deps.weaponAbility = () => ({ damage: 14, rangePx: 34, knockbackPxS: 360 });
for (const id of Object.keys(Combat.quickAttackData.TECHNIQUES)) {
  visualCall = null;
  try { registered[id].onTap(); } catch (error) { if (!visualCall) throw error; } // Only the swing visual is under test.
  assert.ok(visualCall, `${id} starts the player's swing visual`);
  stagedCall?.onComplete?.();
  const bandit = makeBandit();
  assert.equal(banditScope.fireBanditQuickAttack(bandit, bandit.def, { tap2: id }, target), true);
  assertSameSwing(`quick ${id}`, visualCall.opts, bandit);
}

// ── sampleSwing picks the same arc the player's updateToolMesh branch would ──
{
  const a = SAP.createSample(), b = SAP.createSample();
  // Legacy chop: the player's chop branch samples LEGACY_CHOP_POSE with sign 1.
  SAP.sampleSwing(a, 'chop', null, 0.25, 0.3, 0.42, 0.7, -1, 1.2);
  SAP.samplePose(b, SAP.LEGACY_CHOP_POSE, SAP.STYLE_NEUTRAL_POSE.chop, 0.25, 0.3, 0.42, 0.7, 1, 1.2, 'attack');
  for (const key of ['x', 'y', 'z', 'pitchRad', 'yawRad', 'rollRad', 'bodyYawRad']) approx(a[key], b[key], `legacy chop ${key}`);
  // Legacy sweep: game.js's sweepOff piecewise, the hand mirrored to the swing side, z at LEGACY_SWEEP.z.
  const S = SAP.LEGACY_SWEEP;
  for (const [t, sign] of [[0.15, 1], [0.36, -1], [0.5, -1], [0.85, 1]]) {
    const wf = 0.3, sf = 0.42, hf = 0.7, power = 1.3;
    const W = S.windupRad * power * sign, St = S.strikeRad * power * sign;
    const want = t <= wf ? W * (t / wf) : t <= sf ? W + (St - W) * ((t - wf) / (sf - wf)) : t <= hf ? St : St * (1 - (t - hf) / (1 - hf));
    SAP.sampleSwing(a, 'sweep', null, t, wf, sf, hf, sign, power);
    approx(a.bodyYawRad, want, `legacy sweep body turn @${t}`);
    assert.equal(a.mirrorBlend, sign, 'legacy Backhand mirrors the hand attach point');
    approx(a.z, S.z, 'legacy sweep reach');
  }
  // Thrust without a pose: the legacy jab (combat windup).
  SAP.sampleSwing(a, 'thrust', null, 0.3, 0.3, 0.42, 0.7, 1, 1);
  approx(a.z, SAP.LEGACY_THRUST.windupBackCombat, 'legacy thrust windup');
}

// ── Enemy renderer: Charged Breaker windup curve and hand-grip timing ──
{
  const fake = SAP; // The real sampler; the renderer's placement is covered by test-shared-attack-pose.
  const sampled = [];
  const SAPSpy = { ...fake,
    sampleSwing(out, anim, pose, progress, wf, sf, hf, sign, power, sequence) { sampled.push({ progress, wf, power }); return fake.sampleSwing(out, anim, pose, progress, wf, sf, hf, sign, power, sequence); },
  };
  const windupCurve = (raw, s) => { const t = Math.max(0, Math.min(1, raw)); return s > 0 ? Math.log1p(s * t) / Math.log1p(s) : t; };
  let nowMs = 1000;
  const gripCalls = [];
  const sandbox = { performance: { now: () => nowMs }, console, Math };
  sandbox.window = sandbox;
  sandbox.SharedAttackPose = SAPSpy;
  sandbox.Combat = { windupCurve, windupPoseProgress() { throw new Error('enemies must not use the player-transformed curve'); } };
  sandbox.HobunjiHandToolGrips = { animationGripAt(progress, timing) { gripCalls.push({ progress, timing }); return null; } };
  vm.createContext(sandbox);
  vm.runInContext(banditSource, sandbox, { filename: 'combat-bandit.js' });
  const quat = () => ({ setFromAxisAngle() { return this; } });
  sandbox.BanditCombat.init({ TILE: 32, qFac: quat(), qToolYaw: quat(), qAnim: quat(), qRoll: quat(), tUp: 'up', xAxis: 'x', zAxis: 'z', TOOL_ITEM_DEFS: { axe: { animStyle: 'sweep' } } });

  const MAX_CHARGE_S = 4, SLOWDOWN = 25, STRIKE_S = 0.12;
  const chargeT = 0.75; // fireBanditChargedBreaker's chargeT with rnd() = 0.5.
  const holdSecondsForPoseCharge = charge => ((Math.exp(charge * Math.log1p(SLOWDOWN)) - 1) / SLOWDOWN) * MAX_CHARGE_S;
  Combat.chargedBreakerData = { POWER: 1.7, HOLD_S: 0.2, STRIKE_S, MAX_CHARGE_S, WINDUP_S: MAX_CHARGE_S, WINDUP_SLOWDOWN: SLOWDOWN, holdSecondsForPoseCharge,
    DAMAGE_MUL_MIN: 1, DAMAGE_MUL_MAX: 1, RANGE_MUL_MIN: 1, RANGE_MUL_MAX: 1, HALF_CONE_DEG_MIN: 10, HALF_CONE_DEG_MAX: 10, KNOCKBACK_MUL_MIN: 1, KNOCKBACK_MUL_MAX: 1,
    LUNGE_TILE_MUL_MIN: 1, LUNGE_TILE_MUL_MAX: 1, LUNGE_GRAVITY_RESIST_MIN: 0, LUNGE_GRAVITY_RESIST_MAX: 0 };
  Combat.poses = { SWEEP_POSE: runtime.AttackPoseTemplates.poseFor('hatchet_swing') };
  const holder = { visible: true, children: [{ scale: { x: 1 }, userData: {} }], quaternion: { copy() { return this; }, multiply() { return this; } }, position: { set() {} } };
  const makeChargingBandit = shapeStats => ({ ...makeBandit(), def: { weaponKey: 'axe', attackTag: 'blunt', ...(shapeStats ? { weaponShapeStats: shapeStats } : {}) }, halfHeight: 0.4, _banditToolHolder: holder,
    avatarRef: { group: { position: { x: 0, y: 1, z: 0 }, rotation: { y: 0 }, userData: {} }, handAttachX: -0.2, handAttachY: 0.5, handRigAvatarRoot: { userData: {} } } });
  // Weapon shape speed (weapon-shape-stats.js) shortens the player's whole held windup to MAX_CHARGE_S / speed
  // (combat-charged-breaker.js), so at hold time t the player shows windupCurve(t * speed / MAX_CHARGE_S).
  let c = null;
  for (const speed of [1, 1.25, 0.8]) {
    c = makeChargingBandit(speed === 1 ? null : { power: 1, speed, range: 1, efficiency: 1 });
    assert.equal(banditScope.fireBanditChargedBreaker(c, c.def, target), true);
    const action = c._banditAction;
    assert.equal(c._banditSwingWindupCurve.action, action, 'the curve is bound to this one windup');
    const windupS = action.windupS;
    approx(windupS, holdSecondsForPoseCharge(chargeT) / speed, `speed ${speed}: bandit windup lasts as long as the player needs to reach this charge`, 1e-12);
    for (const u of [0.1, 0.25, 0.5, 0.75, 0.95]) {
      sampled.length = 0; gripCalls.length = 0;
      action.t = u * windupS;
      sandbox.BanditCombat.updateToolMesh(c);
      const { progress, wf, power } = sampled[0];
      const enemyVisibleFraction = (progress / wf) * c._banditSwingPoseScale; // Fraction of the FULL Windup pose on screen.
      const playerVisibleFraction = windupCurve(action.t * speed / MAX_CHARGE_S, SLOWDOWN); // The player holding the same weapon for the same time.
      approx(enemyVisibleFraction, playerVisibleFraction, `speed ${speed}: charged breaker windup at ${u}`, 1e-9);
      approx(power, 1.7 * chargeT, 'charge still scales the pose amplitude');
      assert.equal(gripCalls[0].timing.heldTransforms, false, 'enemy hands ignore the player-only held transforms');
      approx(gripCalls[0].timing.poseScale, chargeT, 'enemy hands use the charge fraction, not the ability power');
      approx(gripCalls[0].progress, progress, 'hands and weapon share one eased windup clock');
      approx(c._banditToolTimeline.poseScale, chargeT, 'the blade-twist fade sees the charge fraction');
    }
  }
  // A later swing never inherits the curve.
  banditScope.fireBanditComboStep(c, c.def, { tap1: 'swingCombo' }, target);
  assert.equal(c._banditSwingWindupCurve, null);

  // ── Bandit lunge cancelled mid-hop lands at once ──
  c._banditLunging = true; c._banditLungeHopCurrent = 0.8;
  sandbox.BanditCombat.cancelLunge(c);
  assert.equal(c._banditLunging, false);
  assert.equal(c._banditLungeHopCurrent, 0, 'a staggered/killed bandit does not stay in mid-air');
}

// ── Hand grips: the player's held-ability speed-up never reaches an enemy ──
{
  const sandbox = { location: { pathname: '/index.html' }, document: { getElementById: () => null }, performance: { now: () => 0 } };
  sandbox.window = { localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, requestAnimationFrame() {},
    Combat: { deps: {}, windupCurve: raw => raw, windupPoseProgress: raw => Math.min(1, raw + 0.5) } }; // A Furious-style transform is active.
  sandbox.localStorage = sandbox.window.localStorage;
  vm.runInNewContext(read('docs/js/hand-tool-grips.js'), sandbox, { filename: 'hand-tool-grips.js' });
  const grips = sandbox.window.HobunjiHandToolGrips;
  const poseSet = { neutral: {}, windup: { secondaryGrip: { enabled: true, percent: 50, primaryPercent: 50 } }, strike: {} };
  const timing = { windupFrac: 0.5, strikeFrac: 0.6, holdFrac: 0.8 };
  const playerGrip = grips.animationGripAt(0.1, timing, poseSet, 'attack', 'hatchet');
  const enemyGrip = grips.animationGripAt(0.1, { ...timing, heldTransforms: false }, poseSet, 'attack', 'hatchet');
  assert.ok(playerGrip.influence > enemyGrip.influence, 'the player\'s transform still applies to the player');
  approx(enemyGrip.influence, 0.2 * grips.animationGripAt(0.5, { ...timing, heldTransforms: false }, poseSet, 'attack', 'hatchet').influence, 'enemy grip follows the bare clock', 1e-9);
}

// ── Animal leaps: sub-stepped travel, and landing a hit mid-arc puts the body down ──
{
  const sandbox = { console, Math, performance: { now: () => 0 } };
  sandbox.window = sandbox;
  let leapHits = 0;
  sandbox.Combat = {
    meleeAimSolution: () => ({ pitch: 0.6 }),
    meleeLungeProfile: distancePx => ({ distancePx, hopUnits: 1, pitch: 0.6 }),
    meleeHit: (attacker, victim) => { const hit = Math.abs(victim.x - attacker.x) < 20; if (hit) leapHits += 1; return hit; },
  };
  vm.createContext(sandbox);
  vm.runInContext(read('docs/js/combat/combat-animal-attacks.js'), sandbox, { filename: 'combat-animal-attacks.js' });
  const attacks = sandbox.Combat.animalAttacks;
  let damaged = null;
  const deps = { TILE: 32, players: [], companionObjects: [], hostileObjects: [], canOccupyAt: () => true, damagePlayer(amount) { damaged = amount; }, setCreatureFrame() {} };
  sandbox.Combat.deps = deps;
  const run = (c, dt, frames = 400) => { for (let i = 0; i < frames && attacks.isBusy(c); i += 1) attacks.update(c, dt); };
  const animal = () => ({ x: 0, y: 0, scaleY: 1, def: { attackRangePx: 24, attackHalfConeRad: 0.6, attackDamage: 7 } });

  // Hit lands halfway through the leap: damage applies and the hop is lowered.
  deps.players = [{ x: 200, y: 0, health: 100 }];
  const pouncer = animal();
  attacks.start(pouncer, 'pounce', { target: deps.players[0] });
  run(pouncer, 1 / 60);
  assert.equal(damaged, 7, 'the pounce lands');
  assert.ok(pouncer.x > 150 && pouncer.x < 200, 'it stopped at the target');
  assert.equal(pouncer._banditLungeHopCurrent, 0, 'a pounce that lands mid-arc puts the animal back on the ground');
  assert.equal(pouncer.scaleY, 1);

  // A frame hitch can't carry the leap through a thin wall (one big dt used to move in a single unchecked step).
  damaged = null;
  deps.players = [{ x: 400, y: 0, health: 100 }];
  deps.canOccupyAt = x => !(x > 100 && x < 108);
  const hitched = animal();
  attacks.start(hitched, 'pounce', { target: deps.players[0] });
  run(hitched, 0.6, 3); // windup, uncrouch, then one huge leap frame.
  run(hitched, 1 / 60);
  assert.ok(hitched.x <= 100, `stopped at the wall instead of tunnelling through it (x=${hitched.x})`);
  assert.equal(damaged, null);
  assert.equal(hitched._banditLungeHopCurrent, 0);

  // Cancelling mid-leap (stagger) also lowers the hop.
  deps.canOccupyAt = () => true;
  const staggered = animal();
  attacks.start(staggered, 'pounce', { target: { x: 400, y: 0, health: 100 } });
  run(staggered, 1 / 60, 50);
  attacks.cancel(staggered);
  assert.equal(staggered._banditLungeHopCurrent, 0);
  assert.ok(leapHits >= 1);
}

console.log('test-enemy-player-attack-parity: ok');
