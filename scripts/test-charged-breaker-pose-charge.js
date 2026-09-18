#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict'); // Verifies Charge Breaker's visible-pose authority and charge-scaled geometry.
const fs = require('node:fs'); // Reads the exact browser modules used by gameplay.
const vm = require('node:vm'); // Executes Charged Breaker with a focused browser dependency fixture.

const breakerSource = fs.readFileSync('docs/js/combat/combat-charged-breaker.js', 'utf8'); // Runtime ability under test.
const coreSource = fs.readFileSync('docs/js/combat/combat-core.js', 'utf8'); // Shared nonlinear pose/lunge math source.
const gameSource = fs.readFileSync('docs/game.js', 'utf8'); // Player weapon-pose owner whose live progress Charge Breaker reads.
const counterSource = fs.readFileSync('docs/js/combat/combat-counter-shield.js', 'utf8'); // Shared silhouette glow owner.
const flurrySource = fs.readFileSync('docs/js/combat/combat-flurry.js', 'utf8'); // Other offensive hold using the same glow service.
const config = JSON.parse(fs.readFileSync('docs/config/combat/attack-values.json', 'utf8')); // Authored production tuning.

assert.match(coreSource, /function windupPoseProgress[\s\S]{0,500}Math\.log1p\(s \* t\) \/ Math\.log1p\(s\)/,
  'shared windup curve starts quickly and continuously slows toward the authored endpoint');
assert.match(gameSource, /function getWeaponSwingWindupPoseProgress\(\)[\s\S]{0,700}windupPoseProgress/,
  'game exposes the exact visible Neutral→Windup interpolation rather than a separate charge clock');
assert.match(gameSource, /function partialCombatPoseAtCharge[\s\S]{0,1800}next\[phase\]\[key\] = neutral \+ \(endpoint - neutral\) \* t/,
  'partial release scales the authored Windup and Strike endpoints from Neutral by visible pose charge');
assert.match(gameSource, /releaseWeaponSwingHold\(options = \{\}\)[\s\S]{0,1800}toolSwingT = toolSwingDur \* \(1 - combatSwingWindupFrac\)/,
  'partial release jumps directly from the current partial pose into Strike instead of secretly finishing Windup');
assert.match(breakerSource, /const poseCharge = poseChargeFromRuntime\(heldSeconds\)/,
  'Charged Breaker release derives gameplay charge from the live pose-progress seam');
assert.match(breakerSource, /releaseWeaponSwingHold\(\{ poseProgress: poseCharge \}\)/,
  'Charged Breaker sends that same pose percentage back to the weapon renderer on release');
assert.match(coreSource, /pitchDistanceResistance[\s\S]{0,1200}noGravityLossScale - naturalScale/,
  'vertical-lunge resistance weakens the existing pitch-distance loss inside the shared lunge profile');
assert.match(counterSource, /window\.Combat\.weaponChargeGlow = \{/,
  'Counter Shield owns the shared weapon-silhouette glow service');
assert.match(flurrySource, /weaponChargeGlow\?\.set\?\.\('acceleratingFlurry'/,
  'Accelerating Flurry uses the shared Counter-Shield-style weapon glow');
assert.doesNotMatch(breakerSource, /player-heavy-attack-fire-telegraph|PointsMaterial|PLAYER_HEAVY_FIRE/,
  'Charged Breaker no longer owns the old particle-fire telegraph');
assert.doesNotMatch(flurrySource, /playerHeavyTelegraph|player-heavy-attack-fire-telegraph/,
  'Accelerating Flurry no longer reuses the old particle-fire telegraph');

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

let nowMs = 1000; // Used to prove elapsed hold time is not the authoritative power value.
let livePoseCharge = 0.73; // Used as the visible Neutral→Windup pose percentage returned by game.js.
let registeredAbility = null; // Captures the runtime Charged Breaker handlers.
let releaseArgs = null; // Captures the pose percentage sent back to the weapon renderer.
let lungeCall = null; // Captures charge-scaled lunge geometry and resistance.
let stagedCall = null; // Captures the generated strike to ensure release completed.
let glowCall = null; // Captures the shared weapon-glow request for mobile-visible verification.

const player = { stamina: 100, angle: 0 }; // Minimal player state used by the ability.
const context = {
  console,
  Math,
  Date,
  performance: { now: () => nowMs },
  window: {
    ResourceSystem: {
      spendStamina(entity, amount) { entity.stamina -= Number(amount) || 0; },
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

registeredAbility.onHoldStart();
nowMs = 3000; // Two seconds have elapsed, but visible pose remains explicitly authored at 73%.
registeredAbility.onHoldEnd();

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
assert(stagedCall, 'pose-authoritative release still commits the strike');

// Same visible pose, radically different elapsed time: gameplay power must be identical.
const firstDistance = lungeCall.distancePx;
const firstResistance = lungeCall.hitTest.pitchDistanceResistance;
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

console.log('Charged Breaker pose-authoritative charge + shared glow regression passed');
