#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict'); // Verifies Charge Breaker's visible-pose authority and charge-scaled geometry.
const fs = require('node:fs'); // Reads the exact browser modules used by gameplay.
const vm = require('node:vm'); // Executes Charged Breaker with a focused browser dependency fixture.

const breakerSource = fs.readFileSync('docs/js/combat/combat-charged-breaker.js', 'utf8'); // Runtime ability under test.
const coreSource = fs.readFileSync('docs/js/combat/combat-core.js', 'utf8'); // Shared nonlinear pose/lunge math source.
const gameSource = fs.readFileSync('docs/game.js', 'utf8'); // Player weapon-pose owner whose live progress Charge Breaker reads.
const counterSource = fs.readFileSync('docs/js/combat/combat-counter-shield.js', 'utf8'); // Shared silhouette glow owner.
const enemyTelegraphSource = fs.readFileSync('docs/js/combat/combat-enemy-telegraph.js', 'utf8'); // Bandit heavy presentation must not reintroduce the retired fire-particle tell.
const flurrySource = fs.readFileSync('docs/js/combat/combat-flurry.js', 'utf8'); // Other offensive hold using the same glow service.
const stanceSource = fs.readFileSync('docs/js/weapon-tool-stances.js', 'utf8'); // Shared weapon-stance amplitude owner for partial release continuity.
const shoulderSource = fs.readFileSync('docs/js/hand-shoulder-pose-runtime.js', 'utf8'); // Shoulder metadata must scale with the same partial release percentage.
const gripSource = fs.readFileSync('docs/js/hand-tool-grips.js', 'utf8'); // Secondary-grip metadata must scale with the same partial release percentage.
const banditSource = fs.readFileSync('docs/js/combat/combat-bandit.js', 'utf8'); // Bandit mirror keeps legacy heavy identity separate from sampled pose amplitude.
const cameraBridgeSource = fs.readFileSync('docs/js/combat/combat-camera-alignment-bridge.js', 'utf8'); // Shared perspective-point lunge wrapper must preserve the 3D flight profile.
const config = JSON.parse(fs.readFileSync('docs/config/combat/attack-values.json', 'utf8')); // Authored production tuning.

assert.match(coreSource, /function windupPoseProgress[\s\S]{0,500}Math\.log1p\(s \* t\) \/ Math\.log1p\(s\)/,
  'shared windup curve starts quickly and continuously slows toward the authored endpoint');
assert.match(gameSource, /function getWeaponSwingWindupPoseProgress\(\)[\s\S]{0,700}windupPoseProgress/,
  'game exposes the exact visible Neutral→Windup interpolation rather than a separate charge clock');
assert.match(gameSource, /function partialCombatPoseAtCharge[\s\S]{0,1800}next\[phase\]\[key\] = neutral \+ \(endpoint - neutral\) \* t/,
  'partial release scales the authored Windup and Strike endpoints from Neutral by visible pose charge');
assert.match(gameSource, /releaseWeaponSwingHold\(options = \{\}\)[\s\S]{0,1800}toolSwingT = toolSwingDur \* \(1 - combatSwingWindupFrac\)/,
  'partial release jumps directly from the current partial pose into Strike instead of secretly finishing Windup');
assert.match(breakerSource, /const poseCharge = poseChargeFromRuntime\(\)/,
  'Charged Breaker release derives gameplay charge from the live pose-progress seam');
assert.match(breakerSource, /releaseWeaponSwingHold\(\{ poseProgress: poseCharge \}\)/,
  'Charged Breaker sends that same pose percentage back to the weapon renderer on release');
assert.match(coreSource, /upwardDistanceScale = 1 - 0\.5 \* upwardPitchFraction[\s\S]{0,700}distancePx: directDistancePx \* straightHorizontalScale[\s\S]{0,260}verticalTravelUnits: directDistanceWorld \* Math\.sin\(pitch\)[\s\S]{0,220}hopUnits: 0/,
  'full forward/upward direct flight first scales total distance by pitch, then splits it into exact reticle-vector XZ/Y components with no curved hop');
assert.match(coreSource, /return \{[\s\S]{0,700}hopUnits: 0,[\s\S]{0,180}\}; \/\/ Forward\/upward direct player flight exits before any legacy diminished-vertical\/ballistic calculations can run\.[\s\S]{0,500}const distanceScaleAtAngle/,
  'forward/upward player flight exits before the legacy diminished-vertical model');
assert.match(coreSource, /const distanceScaleAtAngle[\s\S]{0,1500}appliedResistance = pitch > 0 \? resistance : 0[\s\S]{0,500}noGravityLossScale - naturalScale/,
  'legacy pitch-distance resistance remains available only in the fallback ballistic path');
assert.match(coreSource, /verticalTravelUnits: baseDistanceWorld \* Math\.sin\(pitch\) \* direct/,
  'partial-direct fallback lunges still retain their authored signed vertical component');
assert.match(coreSource, /hopUnits: ballisticHopUnits \* \(1 - direct\)/,
  'partial-direct fallback still blends curved hop out as direct strength rises');
assert.match(gameSource, /lungeFlightWorldY = player\.lungeFlightStartWorldY[\s\S]{0,220}player\.lungeVerticalTravelUnits \* eased/,
  'player runtime advances world-Y on the same lunge progress parameter as XZ');
assert.match(gameSource, /directY = player\.lunging \? window\.FormatUtils\.clamp\(player\.lungeDirectFlightStrength/,
  'rendered player/hitbox Y approaches exact flight authority as direct-flight strength rises');
assert.match(cameraBridgeSource, /effectiveDirectFlightStrength = ungroundedByAim[\s\S]{0,120}\? 1[\s\S]{0,120}: \(hitTest\?\.directFlightStrength \|\| 0\)/,
  'forward/upward player attacks override trajectory shaping to full reticle flight while below-forward attacks retain authored Charged Breaker direct strength');
assert.match(breakerSource, /beginStagedAction\(\{[\s\S]{0,500}windupS: strikeS,[\s\S]{0,160}strikeS: 0/,
  'released Charged Breaker waits through its visible strike/lunge arc before resolving impact');
assert.match(counterSource, /window\.Combat\.weaponChargeGlow = \{/,
  'Counter Shield owns the shared weapon-silhouette glow service');
assert.match(counterSource, /mesh\.position\.set\(0, 0, 0\)[\s\S]{0,120}mesh\.quaternion\.identity\(\)[\s\S]{0,500}source\.add\(mesh\)/,
  'weapon glow is structurally parented to the real weapon mesh with identity local transform');
assert.doesNotMatch(counterSource, /mesh\.position\.copy\(source\.position\)|mesh\.quaternion\.copy\(source\.quaternion\)/,
  'weapon glow no longer samples/copies a potentially stale weapon transform');
assert.match(counterSource, /vUv\.y \* 15\.0 - flowTime \* flowSpeed/,
  'offensive glow flows from weapon base toward tip instead of pulsing outward');
assert.match(counterSource, /kind: 'over', tier: 1[\s\S]{0,600}kind: 'over', tier: 3/,
  'shared glow owns six above-weapon layers grouped into three Charged Breaker milestone tiers');
assert.match(counterSource, /TRAIL_MIN_ANGULAR_SPEED[\s\S]{0,1800}weapon-charge-motion-trail/,
  'weapon-shaped motion trails are spawned only after real swing-speed thresholds are exceeded');
assert.match(counterSource, /if \(offensiveGlowByOwner\.size \|\| externalWeaponGlowActive \|\| cleanupVisualsNextTick\)/,
  'expensive glow/trail work is gated off during idle gameplay');
assert.match(counterSource, /visual\.defensive[\s\S]{0,900}visual\.offensive[\s\S]{0,1200}OFFENSIVE_CHARGE_COLOR/,
  'the authored silhouette adapter also covers bandit Charged Breaker');
assert.match(enemyTelegraphSource, /if \(visual\.fireGroup\) visual\.fireGroup\.visible = false/,
  'bandit Charged Breaker suppresses the legacy offensive fire-particle group');
assert.match(flurrySource, /weaponChargeGlow\?\.set\?\.\('acceleratingFlurry'/,
  'Accelerating Flurry uses the shared Counter-Shield-style weapon glow');
assert.match(flurrySource, /heldSeconds \/ GLOW_FULL_S/,
  'Accelerating Flurry glow growth remains linear in hold duration');
assert.match(flurrySource, /overlayMode: 'linear'[\s\S]{0,180}overlayProgress: intensity[\s\S]{0,180}motionTrail: true/,
  'Accelerating Flurry continuously raises transparent over-layers and enables swing trails');
assert.match(breakerSource, /FULL_CHARGE_POSE = 0\.999[\s\S]*thresholds = \[MIN_READY_POSE, 0\.50, FULL_CHARGE_POSE\]/,
  'Charged Breaker flare milestones occur at readiness, 50%, and full pose charge');
assert.match(breakerSource, /glowFlareQueue\.push\(i \+ 1\)/,
  'close Charged Breaker milestones are queued so the readiness and 50% flares cannot collapse into one flash');
assert.match(breakerSource, /overlayMode: 'stepped'[\s\S]{0,220}overlayLevel: milestone\.overlayLevel[\s\S]{0,220}motionTrail: true/,
  'Charged Breaker turns on two over-layers per milestone in visible steps and enables swing trails');
assert.match(enemyTelegraphSource, /anyWeaponGlowActive !== lastExternalWeaponGlowActive/,
  'enemy heavy presentation signals the glow renderer only on active/inactive transitions');
assert.match(stanceSource, /combatVisualState\.poseScale = requestedPoseScale/,
  'partial held release records the same pose amplitude in the shared stance runtime');
assert.match(stanceSource, /runtimeState\.combatPoseScale = visual\?\.poseScale \?\? 1/,
  'hot hand/shoulder consumers receive the partial-release pose amplitude without allocating debug snapshots');
assert.match(stanceSource, /runtimeState\.combatNeutralWeight = visual \? neutralWeightForVisual\(visual\) : null/,
  'shoulder fallback consumers receive the live neutral weight from runtime state');
assert.match(shoulderSource, /scaledWindup = lerp\(poses\.neutral, poses\.windup, poseScale\)[\s\S]{0,250}scaledStrike = lerp\(poses\.neutral, poses\.strike, poseScale\)/,
  'shoulder metadata Windup/Strike endpoints are sliced from Neutral by the same partial-release amplitude');
assert.match(gripSource, /scaledWindup = lerpAnimationGrip\(neutral, windup, poseScale\)[\s\S]{0,250}scaledStrike = lerpAnimationGrip\(neutral, strike, poseScale\)/,
  'secondary-grip Windup/Strike endpoints are sliced from Neutral by the same partial-release amplitude');
assert.match(banditSource, /_banditSwingPower = cb\.POWER \|\| 1\.7;[\s\S]{0,180}_banditSwingPoseScale = chargeT/,
  'bandit Charged Breaker preserves the legacy heavy-attack identity power while storing sampled charge separately');
assert.match(banditSource, /const power = \(c\._banditSwingPower \|\| 1\) \* poseScale/,
  'bandit renderer applies sampled pose charge without corrupting heavy-attack identity consumers');
assert.doesNotMatch(breakerSource, /heldSeconds\s*\/\s*MAX_CHARGE_S/,
  'gameplay charge must never be reconstructed from elapsed hold time');
assert.doesNotMatch(breakerSource, /CHARGE_DRAIN_PER_S/,
  'Charged Breaker must not contain a time-based Stamina drain path');
assert.match(breakerSource, /delta = Math\.max\(0, target - staminaCostCommitted\)/,
  'held charge spends only the newly reached portion of one cumulative attack cost');
assert.match(breakerSource, /if \(poseCharge < MIN_READY_POSE\)/,
  'minimum strike readiness must be checked against visible pose charge');
assert.doesNotMatch(breakerSource, /player-heavy-attack-fire-telegraph|PointsMaterial|PLAYER_HEAVY_FIRE/,
  'Charged Breaker no longer owns the old particle-fire telegraph');
assert.doesNotMatch(flurrySource, /playerHeavyTelegraph|player-heavy-attack-fire-telegraph/,
  'Accelerating Flurry no longer reuses the old particle-fire telegraph');

assert.equal(config.chargedBreaker.MIN_READY_POSE, 0.48,
  'minimum release readiness is authored in visible pose space, not elapsed seconds');
assert.equal(config.chargedBreaker.MAX_CHARGE_S, 4.0,
  'full Windup / 100% pose charge takes substantially longer than the old short charge');
assert.equal(config.chargedBreaker.WINDUP_SLOWDOWN, 25,
  'authored windup uses a strong decelerating tail');
assert(config.chargedBreaker.RANGE_MUL_MAX < 1.4,
  'Charged Breaker cone length is shorter than the old minimum reach multiplier');
assert(config.chargedBreaker.LUNGE_TILE_MUL_MAX > config.chargedBreaker.LUNGE_TILE_MUL_MIN,
  'lunge distance grows with pose charge');
assert(config.chargedBreaker.HALF_CONE_DEG_MAX > config.chargedBreaker.HALF_CONE_DEG_MIN,
  'cone width grows with pose charge');
assert(config.chargedBreaker.KNOCKBACK_MUL_MAX > config.chargedBreaker.KNOCKBACK_MUL_MIN,
  'knockback grows with pose charge');
assert(config.chargedBreaker.LUNGE_GRAVITY_RESIST_MAX > config.chargedBreaker.LUNGE_GRAVITY_RESIST_MIN,
  'upward-lunge gravity resistance grows with pose charge');
assert(config.chargedBreaker.LUNGE_DIRECT_FLIGHT_MAX >= 0.95,
  'maximum pose charge is authored as an almost fully straight 3D lunge');
assert(config.chargedBreaker.LUNGE_DIRECT_FLIGHT_MAX > config.chargedBreaker.LUNGE_DIRECT_FLIGHT_MIN,
  'straight-line aerial authority grows with pose charge');

let nowMs = 1000; // Used to prove elapsed hold time is not the authoritative power value.
let livePoseCharge = 0.73; // Used as the visible Neutral→Windup pose percentage returned by game.js.
let registeredAbility = null; // Captures the runtime Charged Breaker handlers.
let releaseArgs = null; // Captures the pose percentage sent back to the weapon renderer.
let lungeCall = null; // Captures charge-scaled lunge geometry and resistance.
let stagedCall = null; // Captures the generated strike to ensure release completed.
let glowCall = null; // Captures the shared weapon-glow request for mobile-visible verification.
let staminaSpendLog = []; // Captures cumulative charge-cost deltas so fixed-pose holding can be proven free of time-based drain.
let regenBlockLog = []; // Captures the hold-stage Stamina-regeneration blocker lifecycle.

const player = { stamina: 100, angle: 0 }; // Minimal player state used by the ability.
const context = {
  console,
  Math,
  Date,
  performance: { now: () => nowMs },
  window: {
    ResourceSystem: {
      spendStamina(entity, amount) {
        const spent = Math.max(0, Number(amount) || 0); // Mirrors a no-modifier ResourceSystem spend for cumulative-cost assertions.
        entity.stamina -= spent;
        staminaSpendLog.push(spent);
        return { spent, excess: 0 };
      },
      setStaminaRegenBlocked(entity, source, blocked) { regenBlockLog.push({ entity, source, blocked: !!blocked }); },
      getExhaustionSpeed: () => 1,
    },
    CombatProgression: {
      getEffects: () => ({ afflictions: {}, stats: {} }),
    },
    Combat: {
      poses: {
        SWEEP_POSE: {
          neutral: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, bodyYaw: 0 },
          windup: { x: 0, y: 0, z: 0, pitch: 0, yaw: -42, bodyYaw: -90 },
          strike: { x: 0, y: 0, z: 0, pitch: 0, yaw: 20, bodyYaw: 120 },
        },
      },
      abilities: {
        register(id, ability) { if (id === 'chargedBreaker') registeredAbility = ability; },
      },
      deps: {
        player,
        TILE: 64,
        hostileObjects: [],
        currentWeaponKey: () => 'hatchet',
        currentWeaponDamageType: () => 'sharp',
        weaponAbility: () => ({ damage: 14, rangePx: 64, knockbackPxS: 360 }),
        showToast() {},
        triggerWeaponHoldVisual() {},
        getWeaponSwingWindupPoseProgress: () => livePoseCharge,
        releaseWeaponSwingHold(options) { releaseArgs = options; },
        cancelWeaponSwingHold() {},
        setCombatSwingCone() {},
        beginCombatLunge(distancePx, strikeS, hopUnits, hitTest) {
          lungeCall = { distancePx, strikeS, hopUnits, hitTest };
        },
        clearVegetationInAttackCone: () => 0,
        getCurrentArea: () => 'test',
        getPlayerMeleeAimPitch: () => 0,
        awardWeaponMasteryXp() {},
      },
      isStaggered: () => false,
      beginStagedAction(opts) { stagedCall = opts; return { opts }; },
      playerMeleeThreat: () => ({}),
      weaponChargeGlow: {
        set(owner, intensity, options) { glowCall = { owner, intensity, options }; },
        clear() {},
        snapshot: () => ({}),
      },
      windupPoseProgress(raw, slowdown) {
        if (!(slowdown > 0)) return Math.max(0, Math.min(1, raw));
        return Math.log1p(slowdown * Math.max(0, Math.min(1, raw))) / Math.log1p(slowdown);
      },
    },
  },
};

vm.runInNewContext(breakerSource, context, { filename: 'combat-charged-breaker.js' });
assert(registeredAbility, 'Charged Breaker registers in the focused runtime fixture');
assert.equal('CHARGE_DRAIN_PER_S' in config.chargedBreaker, false,
  'authored Charged Breaker config no longer exposes a time-based drain rate');
assert.equal(config.chargedBreaker.COST_MIN, 24,
  'first releasable charge starts at the intentionally expensive 24-Stamina commitment');
assert.equal(config.chargedBreaker.COST_MAX, 54,
  'full Windup reaches the intentionally expensive 54-Stamina cumulative cost');

const costForPose = pose => {
  const releasableT = Math.max(0, Math.min(1,
    (pose - config.chargedBreaker.MIN_READY_POSE) / (1 - config.chargedBreaker.MIN_READY_POSE),
  )); // Mirrors runtime's interruptible single-cost interpolation across only the releasable portion of Windup.
  return config.chargedBreaker.COST_MIN
    + (config.chargedBreaker.COST_MAX - config.chargedBreaker.COST_MIN) * releasableT;
};

// Hold-stage regen pauses immediately, but releasing before readiness spends nothing.
player.stamina = 100;
livePoseCharge = 0.47;
staminaSpendLog = [];
regenBlockLog = [];
registeredAbility.onHoldStart();
assert.equal(regenBlockLog.at(-1)?.source, 'charged-breaker-hold',
  'Charged Breaker owns a distinct composable hold-stage regen blocker');
assert.equal(regenBlockLog.at(-1)?.blocked, true,
  'Stamina regeneration pauses as soon as the real hold stage begins');
registeredAbility.onHoldUpdate(null, 5);
assert.equal(player.stamina, 100,
  'pre-ready Charged Breaker hold spends no Stamina even if held for a long time');
registeredAbility.onHoldEnd();
assert.equal(player.stamina, 100,
  'releasing before readiness remains free');
assert.equal(regenBlockLog.at(-1)?.blocked, false,
  'ending a pre-ready hold clears its Stamina-regeneration blocker');

// Crossing readiness commits the partial attack cost once.
player.stamina = 100;
livePoseCharge = 0.48;
staminaSpendLog = [];
regenBlockLog = [];
registeredAbility.onHoldStart();
registeredAbility.onHoldUpdate(null, 0.01);
const readyCost = costForPose(0.48);
assert(Math.abs((100 - player.stamina) - readyCost) < 1e-12,
  'first releasable pose pays exactly the authored partial-charge cost');

// Time alone cannot spend anything more at the same visible pose.
const staminaAtReady = player.stamina;
nowMs += 5000;
registeredAbility.onHoldUpdate(null, 5);
assert.equal(player.stamina, staminaAtReady,
  'holding at the same releasable pose does not continuously drain Stamina');

// Advancing the visible pose spends only the difference to its new cumulative target.
livePoseCharge = 0.73;
registeredAbility.onHoldUpdate(null, 0.01);
const costAt73 = costForPose(0.73);
assert(Math.abs((100 - player.stamina) - costAt73) < 1e-12,
  'advancing charge spends only enough to reach the new pose-derived cumulative cost');
const staminaBeforeRelease = player.stamina;
registeredAbility.onHoldEnd();
assert.equal(player.stamina, staminaBeforeRelease,
  'release adds no second Stamina cost after cumulative charge payment');
assert.equal(regenBlockLog.at(-1)?.blocked, false,
  'release restores Stamina regeneration');
assert(Math.abs(context.window.Combat.chargedBreakerDebug.snapshot().staminaCostCommitted - costAt73) < 1e-12,
  'mobile diagnostics expose the cumulative authored cost already committed');

// Full Windup consumes exactly COST_MAX and cannot spend more while held there.
player.stamina = 100;
livePoseCharge = 1;
staminaSpendLog = [];
regenBlockLog = [];
nowMs = 9000;
registeredAbility.onHoldStart();
registeredAbility.onHoldUpdate(null, 0.01);
assert(Math.abs((100 - player.stamina) - config.chargedBreaker.COST_MAX) < 1e-12,
  'full Windup consumes exactly the authored maximum Charged Breaker cost');
const staminaAtFull = player.stamina;
nowMs += 10000;
registeredAbility.onHoldUpdate(null, 10);
assert.equal(player.stamina, staminaAtFull,
  'holding indefinitely at full power cannot spend beyond COST_MAX');
registeredAbility.onHoldEnd();
assert.equal(player.stamina, staminaAtFull,
  'full-power release has no separate surcharge');

// A release that occurs between update samples catches cost up to the exact visible pose once.
player.stamina = 100;
livePoseCharge = 0.73;
staminaSpendLog = [];
regenBlockLog = [];
releaseArgs = null;
lungeCall = null;
stagedCall = null;
glowCall = null;
nowMs = 1000;
registeredAbility.onHoldStart();
nowMs = 3000; // Two seconds have elapsed, but visible pose remains explicitly authored at 73%.
registeredAbility.onHoldEnd();
assert(Math.abs((100 - player.stamina) - costAt73) < 1e-12,
  'release catches cumulative cost up to its exact visible pose when no final hold-update ran');

assert.equal(releaseArgs.poseProgress, 0.73,
  'release power is the exact visible pose percentage, not two seconds divided by max charge time');
assert.equal(glowCall.owner, 'chargedBreaker',
  'visible charge drives the shared weapon glow');
assert(Math.abs(glowCall.intensity - 0.73) < 1e-12,
  'weapon glow brightness follows the same visible pose percentage as attack power');

const expectedLungeTiles = 1.8 + (4.2 - 1.8) * 0.73;
assert(Math.abs(lungeCall.distancePx / 64 - expectedLungeTiles) < 1e-12,
  'lunge distance scales from pose charge');
const expectedResistance = 0.9 * 0.73;
assert(Math.abs(lungeCall.hitTest.pitchDistanceResistance - expectedResistance) < 1e-12,
  'upward-lunge gravity resistance scales from pose charge');
const expectedDirectFlight = 0.98 * 0.73;
assert(Math.abs(lungeCall.hitTest.directFlightStrength - expectedDirectFlight) < 1e-12,
  'straight-line 3D flight authority scales from the same visible pose charge');
assert(stagedCall, 'pose-authoritative release still commits the strike');

// Same visible pose, radically different elapsed time: gameplay power must be identical.
const firstDistance = lungeCall.distancePx;
const firstResistance = lungeCall.hitTest.pitchDistanceResistance;
const firstDirectFlight = lungeCall.hitTest.directFlightStrength;
releaseArgs = null;
lungeCall = null;
player.stamina = 100;
nowMs = 10000;
registeredAbility.onHoldStart();
nowMs = 10650; // Only 0.65 seconds this time; still above the anti-tap ready threshold.
registeredAbility.onHoldEnd();
assert.equal(releaseArgs.poseProgress, 0.73,
  'same visible pose releases at the same charge despite a different elapsed hold time');
assert.equal(lungeCall.distancePx, firstDistance,
  'same visible pose produces the same lunge distance regardless of elapsed hold time');
assert.equal(lungeCall.hitTest.pitchDistanceResistance, firstResistance,
  'same visible pose produces the same gravity resistance regardless of elapsed hold time');
assert.equal(lungeCall.hitTest.directFlightStrength, firstDirectFlight,
  'same visible pose produces the same 3D flight strength regardless of elapsed hold time');

// Global cost reductions (Reduce Stamina Use perk, alchemy) shrink what
// ResourceSystem actually consumes. Committed progress must still be tracked
// in authored units, or every update would re-spend the same pose slice.
const plainSpend = context.window.ResourceSystem.spendStamina;
context.window.ResourceSystem.spendStamina = (entity, amount) => {
  const spent = Math.max(0, Number(amount) || 0) * 0.5; // Mirrors a 50% global Stamina-use reduction.
  entity.stamina -= spent;
  return { spent, excess: 0, enhancedPaid: 0, tempoMultiplier: 1 };
};
player.stamina = 100;
livePoseCharge = 0.73;
nowMs = 20000;
registeredAbility.onHoldStart();
registeredAbility.onHoldUpdate(null, 0.01);
const staminaAfterDiscountedSlice = player.stamina;
assert(Math.abs((100 - staminaAfterDiscountedSlice) - costAt73 * 0.5) < 1e-12,
  'global Stamina-use reductions apply to the cumulative charge cost');
nowMs += 5000;
registeredAbility.onHoldUpdate(null, 5);
registeredAbility.onHoldUpdate(null, 5);
assert.equal(player.stamina, staminaAfterDiscountedSlice,
  'a discounted payment never makes a fixed pose re-spend its already-committed slice');
registeredAbility.onHoldEnd();
assert.equal(player.stamina, staminaAfterDiscountedSlice,
  'release after a discounted charge adds no catch-up surcharge');
context.window.ResourceSystem.spendStamina = plainSpend;

console.log('Charged Breaker pose-authoritative charge + shared glow regression passed');
