#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/combat/combat-blink-dodge.js', 'utf8'); // Used to exercise the real Blink hold state machine in isolation.
const gameSource = fs.readFileSync('docs/game.js', 'utf8'); // Used to guard the camera-relative movement-publication ordering in the monolith.

let nowMs = 0; // Used by the fake performance clock to deterministically cross the reversal-hop cooldown.
let registeredAbility = null; // Filled by Combat.abilities.register and used to drive the real hold callbacks below.
let movementSpeedFn = null; // Filled by Combat.setMovementSpeedMul and used to inspect the live speed buildup.
const dodgeVoices = []; // Records the character passed to each successful Blink hop vocalization.
const spendLog = []; // Used to confirm hop costs and quantized passive Blink drain independently.
const player = { x: 0, y: 0, inputX: 0, inputY: 0, inputStrength: 0, stamina: 200, invulnUntil: 0, dodging: false }; // Shared fake player mutated by the Blink module.

const combat = {
  abilities: {
    register(id, ability) {
      assert.equal(id, 'blinkDodge');
      registeredAbility = ability;
    },
  },
  deps: {
    player,
    canPlayerOccupy: () => true,
    currentWeaponKey: () => 'test-weapon',
    showToast() {},
  },
  setMovementSpeedMul(fn) { movementSpeedFn = fn; },
  update() {},
  init(deps) { this.deps = deps; return true; },
};

const windowStub = {
  Combat: combat,
  CombatVocalizations: { playDodge: entity => dodgeVoices.push(entity) },
  CombatProgression: {
    getEffects: () => ({ afflictions: {}, stats: {} }),
  },
  ResourceSystem: {
    spendStamina(entity, amount, reason) {
      entity.stamina -= amount;
      spendLog.push({ amount, reason });
    },
  },
  ImpactRagdollPlayback: { beginRecoveryArc() {} },
  WorldPopupText: { showChange() {} },
};

const context = {
  window: windowStub,
  console,
  Math,
  performance: { now: () => nowMs },
};
vm.createContext(context);
vm.runInContext(source, context, { filename: 'combat-blink-dodge.js' });

assert(registeredAbility, 'Blink Dodge registers its hold ability');
registeredAbility.onHoldStart();
assert.equal(typeof movementSpeedFn, 'function', 'Blink Dodge installs a dynamic movement-speed multiplier while held');

// Regression for the bug that made the old 2.2/sec passive drain disappear:
// ResourceSystem stores stamina at tenth-point precision, so per-frame ~0.037
// costs must accumulate instead of being individually rounded away.
for (let frame = 0; frame < 60; frame += 1) {
  nowMs += 1000 / 60;
  registeredAbility.onHoldUpdate('hold1', 1 / 60);
}
const stationaryPassiveSpent = spendLog
  .filter(entry => entry.reason === 'Blink Dodge (passive)')
  .reduce((sum, entry) => sum + entry.amount, 0);
assert(Math.abs(stationaryPassiveSpent - 2.2) < 1e-9, 'stationary held Blink drains the authored 2.2 stamina/sec despite tenth-point resource rounding');
assert(windowStub.HobunjiDodgeFeedback.getDebug().blink.passiveDrainCarry < 0.1, 'fractional passive cost is retained only below the next tenth-point spend quantum');

player.inputX = 1;
player.inputY = 0;
player.inputStrength = 1;
registeredAbility.onHoldUpdate('hold1', 1 / 60);
assert.equal(player.x, 82, 'fresh movement input performs exactly one forward hop');
assert.equal(player.y, 0);
assert.deepEqual(dodgeVoices, [player], 'one Blink hop produces one dodge vocal');
assert.equal(spendLog.filter(entry => entry.reason === 'Blink Dodge hop').length, 1, 'initial movement spends exactly one hop cost');

const firstFrameSpeed = movementSpeedFn(); // Used to verify buildup begins near normal locomotion rather than at the final boost.
assert(firstFrameSpeed >= 1 && firstFrameSpeed < 1.05, 'speed buildup starts near normal movement speed');
const firstPassiveRate = windowStub.HobunjiDodgeFeedback.getDebug().blink.passiveDrainPerS; // Used as the low-speed reference for the speed-scaled drain assertion below.
assert(firstPassiveRate >= 2.2 && firstPassiveRate < 2.3, 'fresh movement begins near the baseline passive drain rate');

for (let frame = 0; frame < 5; frame += 1) {
  nowMs += 1000 / 60;
  registeredAbility.onHoldUpdate('hold1', 1 / 60);
}
assert.equal(player.x, 82, 'holding one direction does not repeatedly pond-skip');
assert.equal(spendLog.filter(entry => entry.reason === 'Blink Dodge hop').length, 1, 'straight-line hold does not spend additional hop costs');

player.inputX = -1;
nowMs += 1000 / 60;
registeredAbility.onHoldUpdate('hold1', 1 / 60);
assert.equal(player.x, 82, 'a reversal inside the anti-jitter cooldown is queued instead of hopping early');
assert.equal(windowStub.HobunjiDodgeFeedback.getDebug().blink.pendingReversal, true, 'queued reversal is visible in mobile diagnostics');

for (let frame = 0; frame < 7; frame += 1) {
  nowMs += 1000 / 60;
  registeredAbility.onHoldUpdate('hold1', 1 / 60);
}
assert.equal(player.x, 0, 'queued opposite-hemisphere reversal hops as soon as the cooldown opens');
assert.equal(spendLog.filter(entry => entry.reason === 'Blink Dodge hop').length, 2, 'queued reversal produces exactly one additional hop');

const speedBeforeLongBuild = movementSpeedFn(); // Used to prove the reversal did not reset uninterrupted-input acceleration.
for (let frame = 0; frame < 90; frame += 1) {
  nowMs += 1000 / 60;
  registeredAbility.onHoldUpdate('hold1', 1 / 60);
}
const builtSpeed = movementSpeedFn(); // Used to verify the held movement reaches the authored speed ceiling.
assert(builtSpeed > speedBeforeLongBuild, 'movement speed continues building after the reversal hop');
assert(Math.abs(builtSpeed - 1.7) < 1e-9, 'unupgraded Blink Dodge reaches the authored 1.7x movement ceiling');
assert.equal(player.x, 0, 'continuous post-reversal input still does not auto-hop again');
const builtPassiveRate = windowStub.HobunjiDodgeFeedback.getDebug().blink.passiveDrainPerS; // Used to prove passive stamina cost rises with the built movement multiplier.
assert(builtPassiveRate > firstPassiveRate, 'passive stamina drain increases as Blink movement speed builds');
assert(Math.abs(builtPassiveRate - 3.74) < 1e-9, '1.7x Blink speed raises the 2.2/sec passive drain to 3.74/sec');

player.inputStrength = 0;
nowMs += 1000 / 60;
registeredAbility.onHoldUpdate('hold1', 1 / 60);
assert.equal(movementSpeedFn(), 1, 'releasing movement resets the accumulated Blink speed boost');
assert(Math.abs(windowStub.HobunjiDodgeFeedback.getDebug().blink.passiveDrainPerS - 2.2) < 1e-9, 'stationary held Blink returns immediately to baseline passive drain');

player.inputX = 0;
player.inputY = 1;
player.inputStrength = 1;
nowMs += 1000 / 60;
registeredAbility.onHoldUpdate('hold1', 1 / 60);
assert.equal(player.y, 82, 'a new movement input earns one new hop after release');
assert(movementSpeedFn() < 1.05, 'a new movement input starts a fresh speed buildup');

const movementStart = gameSource.indexOf('function updateMovement(dt)'); // Used to scope the source-order assertions to on-foot movement.
const shoulderTransform = gameSource.indexOf('// Shoulder-surf: rotate the final', movementStart); // Used to locate the camera-relative world transform.
const publishComment = gameSource.indexOf('// Resolved per-frame movement intent', movementStart); // Used to locate the shared player.input publication.
const resolvedInputPublish = gameSource.indexOf('player.inputX = ix;', publishComment); // Used to prove dodge/Blink read the post-camera direction.
assert(movementStart >= 0 && shoulderTransform > movementStart, 'on-foot movement contains the shoulder-camera transform');
assert(publishComment > shoulderTransform, 'resolved input is documented after the shoulder-camera transform');
assert(resolvedInputPublish > shoulderTransform, 'player.inputX/Y are published only after camera-relative rotation');

const debug = windowStub.HobunjiDodgeFeedback.getDebug().blink; // Used to guard the mobile-readable Blink diagnostics requested for runtime testing.
assert.equal(debug.hopCount, 3, 'Blink debug snapshot counts real hops');
assert.equal(debug.lastHopReason, 'input-start', 'Blink debug snapshot reports why the latest hop fired');
assert.equal(debug.tuning.reversalDotThreshold, 0, 'opposite hemisphere is represented by a negative direction dot product');
assert.equal(debug.tuning.passiveDrainBasePerS, 2.2, 'Blink diagnostics expose the authored passive stamina baseline');
assert.equal(debug.tuning.passiveDrainQuantum, 0.1, 'Blink diagnostics expose the tenth-point carry quantum that prevents per-frame rounding loss');

assert.equal(debug.afterimages.supported, false, 'color smears are safely absent when Three.js is unavailable');
assert.equal(debug.afterimages.active, 0, 'no GPU mesh is created in a no-Three movement test');
assert.equal(debug.afterimages.effect, 'rgba-directional-motion-smear', 'mobile debug identifies the new effect');
assert.equal(debug.tuning.smearBaseOpacity, 0.34, 'the smear preserves existing translucent strength');
assert.equal(debug.tuning.smearMaxActors, 24, 'the effect cache remains bounded across combatants');
assert.equal(debug.tuning.smearSampleIntervalS, 0.055, 'velocity samples use the authored cadence');
assert.match(source, /gl_FragColor\.a \*= uSmearOpacity/, 'the blur shader changes alpha, not RGB');
assert.doesNotMatch(source, /boneTransform\(/, 'combat presentation does not CPU-bake skinning per movement');
assert.doesNotMatch(source, /document\.createElement\('canvas'\)/, 'combat presentation never copies avatar textures into canvases');

registeredAbility.onHoldEnd();
assert.equal(movementSpeedFn, null, 'ending Blink Dodge removes its movement-speed modifier');

// The portrait effect is globally owned by Combat.update: the unmodified
// dodge/lunge movement states drive it even when Blink is not equipped.
player.dodging = true;
nowMs += 16;
windowStub.Combat.update(0.016);
let motion = windowStub.HobunjiDodgeFeedback.getDebug().blink.afterimages.motion;
assert.equal(motion.dodging, true);
assert.equal(motion.lunging, false);
assert(Math.abs(motion.lastDodgeSampleAtMs - nowMs) < 1e-6, 'dodge sampling starts immediately');

player.dodging = false;
windowStub.Combat.update(0.016);
player.lunging = true;
nowMs += 16;
windowStub.Combat.update(0.016);
motion = windowStub.HobunjiDodgeFeedback.getDebug().blink.afterimages.motion;
assert.equal(motion.dodging, false);
assert.equal(motion.lunging, true);
assert(Math.abs(motion.lastLungeSampleAtMs - nowMs) < 1e-6, 'melee lunge sampling starts immediately');
player.x += 64;
nowMs += 60;
windowStub.Combat.update(0.06);
let metrics = windowStub.HobunjiDodgeFeedback.getDebug().blink.afterimages;
assert(metrics.lastDistanceTiles > 1, 'one tile of real motion is normalized by sampling interval');
assert(metrics.lastIntensityScale > 0, 'actual lunge velocity generates a smear intensity');
player.x += 64;
nowMs += 60;
windowStub.Combat.update(0.06);
metrics = windowStub.HobunjiDodgeFeedback.getDebug().blink.afterimages;
assert(metrics.lastDistanceTiles > 1 && metrics.lastDistanceTiles < 2, 'consecutive samples do not accumulate unbounded distance');
player.lunging = false;
windowStub.Combat.update(0.016);
player.dodging = true;
player.x += 32;
nowMs += 60;
windowStub.Combat.update(0.06);
assert(windowStub.HobunjiDodgeFeedback.getDebug().blink.afterimages.lastIntensityScale > 0);
player.dodging = false;
windowStub.Combat.update(0.016);
player.lunging = true;
nowMs += 60;
windowStub.Combat.update(0.06);
assert.equal(windowStub.HobunjiDodgeFeedback.getDebug().blink.afterimages.lastIntensityScale, 0, 'stationary attack motion cannot create a blur');
registeredAbility.onHoldStart();
player.inputX = 1; player.inputStrength = 1;
nowMs += 60;
registeredAbility.onHoldUpdate('hold1', 0.06);
assert(Math.abs(windowStub.HobunjiDodgeFeedback.getDebug().blink.afterimages.lastIntensityScale - 82 / 64) < 1e-9, 'Blink teleport strength still reflects actual hop distance');
registeredAbility.onHoldEnd();

console.log('Blink Dodge movement regression tests passed');
