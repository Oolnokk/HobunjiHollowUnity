#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/combat/combat-camera-alignment-bridge.js', 'utf8');
const coreSource = fs.readFileSync('docs/js/combat/combat-core.js', 'utf8');
const gameSource = fs.readFileSync('docs/game.js', 'utf8'); // Native player lunge/render path must actually apply ordinary hop height, not merely compute it.
const comboSource = fs.readFileSync('docs/js/combat/combat-combo.js', 'utf8'); // Player combo hit-confirm must arm aerial chaining only after a real strike hit.
const quickSource = fs.readFileSync('docs/js/combat/combat-quickattacks.js', 'utf8'); // Quick attacks use the same real-hit aerial chain seam.
const breakerSource = fs.readFileSync('docs/js/combat/combat-charged-breaker.js', 'utf8'); // Charged Breaker uses the same real-hit aerial chain seam.
const indexSource = fs.readFileSync('docs/index.html', 'utf8'); // Changed lunge/attack runtimes must be cache-busted together.
assert.doesNotMatch(source, /requestAnimationFrame\s*\(|setInterval\s*\(/,
  'reticle/lunge correction must piggyback existing combat ticks instead of adding another loop');
assert.match(source, /rayBoxInterval\(ray, box\)/,
  'transient melee alignment uses an exact center-ray/Box3 test');
assert.match(source, /nearestReticleHostileTarget[\s\S]{0,1800}source: 'screen-reticle-box3'/,
  'lunge start freezes the nearest exact hostile Box3 point under the centered reticle');
assert.match(source, /committedMeleeTarget:/,
  'bridge exposes the frozen endpoint for strike collision to reuse');
assert.match(source, /resolveSweptLungeEntry\(liveDeps\)/,
  'lunge range entry is checked across movement already completed this frame');
assert.match(source, /LUNGE_CANCEL_RANGE_MULTIPLIER = 0\.5/,
  'lunge cancellation range stays explicitly half of the real attack range');
assert.match(coreSource, /upwardPitchFraction = THREE\.MathUtils\.clamp\(pitch \/ \(Math\.PI \/ 2\), 0, 1\)[\s\S]{0,180}upwardDistanceScale = 1 - 0\.5 \* upwardPitchFraction/,
  'upward lunge total distance must be 100% at 0 degrees, 75% at 45 degrees, and 50% at 90 degrees');
assert.match(coreSource, /distancePx: directDistancePx \* straightHorizontalScale[\s\S]{0,220}verticalTravelUnits: directDistanceWorld \* Math\.sin\(pitch\)[\s\S]{0,500}const distanceScaleAtAngle/,
  'forward/upward direct flight must split the angle-scaled total distance into exact reticle-vector XZ/Y components before legacy math');
assert.doesNotMatch(gameSource, /const lungeTarget = \(activeTool === 'weapon'[\s\S]{0,700}LUNGE_HOMING_RATE/,
  'native player lunge update must not home toward an enemy after attack start');
assert.match(gameSource, /aimUsesDirectReticleFlight = aimPitch >= 0[\s\S]{0,520}aimUsesDirectReticleFlight \? 1 : \(hitTest\?\.directFlightStrength \|\| 0\)[\s\S]{0,160}aimUsesDirectReticleFlight,/,
  'native beginCombatLunge must select full direct reticle flight from pitch alone, independent of target detection');
assert(gameSource.includes('const ordinaryLungeHopY = player.lunging && !Number.isFinite(player.lungeFlightWorldY)'),
  'ordinary lunge hop must be promoted from simulation into the player render path');
assert(gameSource.includes(': groundedTargetY + ordinaryLungeHopY;'),
  'ordinary lunge hop must raise the real player mesh/hitbox instead of existing only as simulated lungeHopCurrent');
assert.match(gameSource, /MIDAIR_LUNGE_HIT_WINDOW_MS = 1000/,
  'confirmed melee hits must grant exactly one second of aerial lunge opportunity');
assert.match(gameSource, /MIDAIR_LUNGE_SLOW_FALL_GRAVITY = 1\.6[\s\S]{0,160}MIDAIR_LUNGE_SLOW_FALL_SPEED_CAP = 0\.45/,
  'the hit-confirm second must use deliberately super-slow fall acceleration and a low fall-speed cap');
assert.match(gameSource, /airborneBetweenLunges = !!player\.lungeLandingPending && Number\.isFinite\(player\.lungeFlightWorldY\)[\s\S]{0,320}midairLungeWindowUntilMs[\s\S]{0,180}return false/,
  'a post-lunge airborne player cannot start another movement lunge without an active hit-confirm window');
assert.match(gameSource, /player\.midairLungeWindowUntilMs = 0; \/\/ One confirmed hit buys one aerial follow-up/,
  'starting the aerial follow-up must consume the permission immediately');
assert.match(gameSource, /confirmEnemyHit:[\s\S]{0,650}_lungeHitConfirmEligibleUntilMs[\s\S]{0,600}midairLungeWindowUntilMs = nowMs \+ MIDAIR_LUNGE_HIT_WINDOW_MS/,
  'only a strike associated with a real prior lunge may arm the one-second window');
assert.match(gameSource, /midairChainWindowActive[\s\S]{0,300}MIDAIR_LUNGE_SLOW_FALL_GRAVITY[\s\S]{0,400}MIDAIR_LUNGE_SLOW_FALL_SPEED_CAP/,
  'post-lunge gravity must switch to super-slow fall only while the hit window remains active');
assert.match(gameSource, /lungeFlightWorldY = null;[\s\S]{0,180}midairLungeWindowUntilMs = 0[\s\S]{0,220}lungeLandingPending = false/,
  'landing must clear unused aerial-chain permission');
for (const [name, sourceText] of [['combo', comboSource], ['quick', quickSource], ['breaker', breakerSource]]) {
  assert.match(sourceText, /if \(hits > 0\) \{[\s\S]{0,180}PlayerLunge\?\.confirmEnemyHit\?\.\(\)/,
    `${name} must grant aerial chaining only after its real strike reports at least one enemy hit`);
}
assert(indexSource.includes('js/combat/combat-combo.js?v=20260930h81d72c4'));
assert(indexSource.includes('js/combat/combat-quickattacks.js?v=20260930h1fa1790'));
assert(indexSource.includes('js/combat/combat-charged-breaker.js?v=20260930hbbcd28d'));
assert(indexSource.includes('game.js?v=20260930h7ae6528'));

const player = {
  x: 0, y: 0, health: 100, facing: 0,
  lunging: false,
  lungeT: 0, lungeDur: 0,
  lungeStartX: 0, lungeStartY: 0,
  lungeDirX: 0, lungeDirY: 0,
  lungeDistancePx: 0, lungeHopUnits: 0, lungeHopCurrent: 0,
  lungeHeightUnits: 1, lungeAimPitch: 0, lungeHitTest: null,
};
const target = { x: 96, y: 0, health: 100, areaId: 'test' };
let targetBox = {
  min: { x: 5, y: 0, z: -0.5 },
  max: { x: 6, y: 1, z: 0.5 },
};
let baseAlignment = {
  eligible: true,
  aligned: false,
  desiredFacing: 0.2,
  nextFacing: 0,
  deltaRad: 0.2,
  reticleOverTarget: false,
  screenCorrectionRad: 0.2,
  targetHalfAngularWidthRad: 0.1,
  alignmentSource: 'screen-reticle',
};
let nativeUpdateCalls = 0;
let nativeUpdateSawX = null;
let lastProfileResistance = null; // Captures the effective upward-gravity resistance supplied by the camera-authored lunge wrapper.
let lastProfileAirAssist = false; // Captures the pitch-only airborne assist bit passed into the shared lunge profile.
let lastProfileDirect = null; // Confirms forward/upward player attacks use the straight reticle-vector path, not the old ballistic blend.
let perspectivePointY = 0.55; // Mutable shared aim height lets this regression exercise an elevated target without changing camera yaw.
let perspectivePointZ = 0; // Mutable horizon depth exposes shoulder-camera parallax without changing the center-ray direction.
let cameraRayOriginZ = 0; // Mutable camera shoulder offset used by the frozen-reticle lunge regression.
let blockNativeLunge = false; // Simulates game.js refusing movement while the melee strike itself is still allowed to resolve.

const perspectiveTarget = () => ({
  point: { x: 10, y: perspectivePointY, z: perspectivePointZ },
  cameraRay: {
    origin: { x: 0, y: 0.5, z: cameraRayOriginZ },
    direction: { x: 1, y: 0, z: 0 },
  },
});

const deps = {
  TILE: 64,
  player,
  hostileObjects: [target],
  getCurrentArea: () => 'test',
  getActorWorldY: () => 0,
  getPlayerPerspectiveTarget: perspectiveTarget,
  getPlayerInteractionRay: () => perspectiveTarget().cameraRay,
  getPlayerAimRay: () => perspectiveTarget().cameraRay,
  getPlayerMeleeAimDirection: () => ({ x: 1, y: 0, z: 0 }),
  getPlayerMeleeAimPitch: () => 0,
  beginCombatLunge(distancePx, durationS, hopUnits = 0, hitTest = null) {
    if (blockNativeLunge || player.lunging) return false;
    player.lunging = true;
    player.lungeT = durationS;
    player.lungeDur = durationS;
    player.lungeStartX = player.x;
    player.lungeStartY = player.y;
    // Deliberately wrong native direction; the bridge must replace it with the reticle direction.
    player.lungeDirX = 0;
    player.lungeDirY = 1;
    player.lungeDistancePx = distancePx;
    player.lungeHopUnits = hopUnits;
    player.lungeAimPitch = 0;
    player.lungeHitTest = hitTest;
  },
};

const windowStub = {
  __farmLog() {},
  RangedWeapons: {
    init() { return true; },
    actorHitbox(actor) {
      return actor === target ? { box: targetBox } : null;
    },
  },
  Combat: {
    deps: null,
    init(injectedDeps) {
      this.deps = injectedDeps;
      return true;
    },
    attackAlignmentStep() {
      return { ...baseAlignment };
    },
    meleeLungeProfile(distancePx, pitch, hopUnits, lungeHeightUnits, pitchDistanceResistance, directFlightStrength, inRangeAirAssist) {
      lastProfileResistance = pitchDistanceResistance;
      lastProfileAirAssist = !!inRangeAirAssist;
      lastProfileDirect = directFlightStrength;
      if (directFlightStrength >= 0.999 && pitch >= 0) {
        const upwardDistanceScale = 1 - 0.5 * Math.max(0, Math.min(1, pitch / (Math.PI / 2)));
        return {
          distancePx: distancePx * upwardDistanceScale * Math.cos(Math.abs(pitch)),
          pitch,
          hopUnits: 0,
          lungeHeightUnits,
          pitchDistanceResistance,
          directFlightStrength: 1,
          upwardDistanceScale,
          verticalTravelUnits: (distancePx / 64) * upwardDistanceScale * Math.sin(pitch),
          inRangeAirAssist,
        };
      }
      return { distancePx, pitch, hopUnits, lungeHeightUnits, pitchDistanceResistance, directFlightStrength, verticalTravelUnits: 0, inRangeAirAssist };
    },
    meleeColliderVolume(attacker, opts) {
      const pitch = Number(opts.pitch) || 0;
      const yaw = Number(opts.yaw) || 0;
      const rangeWorld = Math.max(0, Number(opts.rangePx) || 0) / 64;
      const horizontal = Math.cos(pitch);
      return {
        origin: { x: attacker.x / 64, y: 0.5, z: attacker.y / 64 },
        direction: { x: Math.cos(yaw) * horizontal, y: Math.sin(pitch), z: Math.sin(yaw) * horizontal },
        yaw,
        pitch,
        rangeWorld,
        horizontalRangeWorld: rangeWorld * horizontal,
        verticalRiseWorld: rangeWorld * Math.sin(pitch),
        halfConeRad: Math.max(0, Number(opts.halfConeRad) || 0),
        halfHeightWorld: 0.5,
      };
    },
    beginStagedAction(options = {}) {
      return {
        options,
        fire() { return options.onStrike?.(this); },
      }; // Minimal core stand-in lets the bridge prove each staged strike owns the reticle snapshot from its immediately preceding lunge request.
    },
    update() {
      nativeUpdateCalls++;
      nativeUpdateSawX = player.x;
    },
  },
};

const context = { window: windowStub, Date, Math, console };
vm.runInNewContext(source, context, { filename: 'combat-camera-alignment-bridge.js' });
windowStub.Combat.init(deps);

let step = windowStub.Combat.attackAlignmentStep(player, target, 0, { facing: 0 });
assert.equal(step.exactReticleHitboxIntersection, true, 'real reticle ray intersection is recognized');
assert.equal(step.reticleOverTarget, true, 'real Box3 intersection counts as reticle-on-target');
assert.equal(step.deltaRad, 0, 'exact Box3 intersection releases aim assist with zero corrective turn');
assert.equal(step.desiredFacing, 0, 'exact hit keeps the existing reticle heading');

// Horizontal-only overlap must no longer be enough. This box sits above the
// actual center ray, while the legacy base step claims the reticle overlaps it.
targetBox = {
  min: { x: 5, y: 2, z: -0.5 },
  max: { x: 6, y: 3, z: 0.5 },
};
baseAlignment = {
  ...baseAlignment,
  reticleOverTarget: true,
  screenCorrectionRad: 0.15,
  deltaRad: 0,
  desiredFacing: 0,
};
step = windowStub.Combat.attackAlignmentStep(player, target, 0, { facing: 0 });
assert.equal(step.exactReticleHitboxIntersection, false, '3D miss is not treated as a reticle hit');
assert.equal(step.reticleOverTarget, false, 'legacy horizontal-overlap approximation cannot release assist');
assert(Math.abs(step.deltaRad - 0.15) < 1e-9, 'screen-side correction continues until the real ray intersects');

baseAlignment = { ...baseAlignment, screenCorrectionRad: 0, deltaRad: 0 };
step = windowStub.Combat.attackAlignmentStep(player, target, 0, { facing: 0 });
assert.equal(step.eligible, false, 'pure vertical miss is not ranked as a fake zero-error autotarget');

// Shoulder-camera parallax: the horizon point and a near enemy can lie on the
// same camera ray but produce different player-origin directions. Freeze the
// exact Box3 entry point at lunge start so movement commits to what the reticle
// actually covered instead of the far 160-tile-style endpoint.
cameraRayOriginZ = 1;
perspectivePointZ = 1;
perspectivePointY = 0.55;
targetBox = {
  min: { x: 2, y: 0, z: 0.8 },
  max: { x: 2.4, y: 1, z: 1.2 },
};
deps.hostileObjects = [target];
player.x = 0;
player.y = 0;
player.lunging = false;
deps.beginCombatLunge(128, 0.4, 0, { rangePx: 64, halfConeRad: 0.25 });
const committed = windowStub.HobunjiCombatCameraAlignment.committedMeleeTarget();
assert(committed, 'lunge captures an exact reticle endpoint when the camera ray intersects a hostile Box3');
assert.equal(committed.source, 'screen-reticle-box3');
assert(Math.abs(committed.point.x - 2) < 1e-9, 'frozen endpoint is the near Box3 entry rather than the far horizon point');
assert(Math.abs(committed.point.z - 1) < 1e-9, 'frozen endpoint stays on the shoulder camera center ray');
assert(player.lungeDirY > 0.35, 'lunge ground direction converges strongly toward the near reticle point from the player origin');
assert.equal(windowStub.HobunjiCombatCameraAlignment.debugSnapshot().lastLunge.targetSource, 'screen-reticle-box3');
let firstStrikeTarget = null; // Captured inside the first staged strike to prove later attacks cannot replace its ownership.
const firstStagedAction = windowStub.Combat.beginStagedAction({
  onStrike: () => { firstStrikeTarget = windowStub.HobunjiCombatCameraAlignment.meleeHitTarget(); },
});
const frozenPoint = { ...committed.point };
targetBox = {
  min: { x: 2, y: 0, z: -3.2 },
  max: { x: 2.4, y: 1, z: -2.8 },
};
const committedAfterMove = windowStub.HobunjiCombatCameraAlignment.committedMeleeTarget();
assert(committedAfterMove, 'frozen endpoint remains available through the staged strike window');
for (const axis of ['x', 'y', 'z']) {
  assert(Math.abs(committedAfterMove.point[axis] - frozenPoint[axis]) < 1e-9,
    `moving the enemy after attack start must not move frozen ${axis} or create homing`);
}

// A second attack can be requested while the previous movement lunge is still
// flagged active (different attack modules have independent busy gates). Its
// STRIKE target must refresh, while the old movement lunge keeps its own point.
targetBox = {
  min: { x: 3, y: 0, z: 0.8 },
  max: { x: 3.4, y: 1, z: 1.2 },
};
deps.beginCombatLunge(128, 0.4, 0, { rangePx: 64, halfConeRad: 0.25 });
const secondAttackCommit = windowStub.HobunjiCombatCameraAlignment.committedMeleeTarget();
let secondStrikeTarget = null; // Captured only while the second staged strike executes.
const secondStagedAction = windowStub.Combat.beginStagedAction({
  onStrike: () => { secondStrikeTarget = windowStub.HobunjiCombatCameraAlignment.meleeHitTarget(); },
});
const activeOldLunge = windowStub.HobunjiCombatCameraAlignment.debugSnapshot().activeLungeReticleTarget;
assert(secondAttackCommit && Math.abs(secondAttackCommit.point.x - 3) < 1e-9,
  'a denied second movement lunge still refreshes the new strike endpoint');
assert(activeOldLunge && Math.abs(activeOldLunge.point.x - frozenPoint.x) < 1e-9,
  'refreshing strike aim cannot bend the older lunge that remains in flight');
assert(Math.abs(windowStub.HobunjiCombatCameraAlignment.meleeHitTarget().point.x - frozenPoint.x) < 1e-9,
  'outside a strike, native movement probes still resolve against the older active lunge endpoint');
secondStagedAction.fire();
assert(secondStrikeTarget && Math.abs(secondStrikeTarget.point.x - 3) < 1e-9,
  'second staged strike resolves against its own frozen endpoint despite the older movement lunge');
assert(Math.abs(windowStub.HobunjiCombatCameraAlignment.meleeHitTarget().point.x - frozenPoint.x) < 1e-9,
  'after the second strike callback, movement-probe ownership returns to the older lunge');
firstStagedAction.fire();
assert(firstStrikeTarget && Math.abs(firstStrikeTarget.point.x - frozenPoint.x) < 1e-9,
  'first staged strike retains its original endpoint even after a newer attack committed');

// game.js also refuses a midair movement lunge after a miss/expired chain
// window. The attack still swings, so it must receive fresh reticle aim rather
// than inheriting the previous attack target.
player.lunging = false;
windowStub.Combat.update(0); // Mirrors the real frame boundary that releases the completed movement-lunge snapshot before another attack.
assert.equal(windowStub.HobunjiCombatCameraAlignment.meleeHitTarget(), null,
  'after movement and staged-strike ownership end, live melee aim no longer inherits the latest historical commit');
blockNativeLunge = true;
targetBox = {
  min: { x: 4, y: 0, z: 0.8 },
  max: { x: 4.4, y: 1, z: 1.2 },
};
deps.beginCombatLunge(128, 0.4, 0, { rangePx: 64, halfConeRad: 0.25 });
const deniedMovementCommit = windowStub.HobunjiCombatCameraAlignment.committedMeleeTarget();
let deniedStrikeTarget = null; // Proves denied movement still hands the fresh attack snapshot to its staged strike.
const deniedStagedAction = windowStub.Combat.beginStagedAction({
  onStrike: () => { deniedStrikeTarget = windowStub.HobunjiCombatCameraAlignment.meleeHitTarget(); },
});
assert.equal(player.lunging, false, 'fixture confirms native movement lunge was denied');
assert(deniedMovementCommit && Math.abs(deniedMovementCommit.point.x - 4) < 1e-9,
  'movement denial still commits the current attack reticle point for strike collision');
assert.equal(windowStub.HobunjiCombatCameraAlignment.debugSnapshot().activeLungeReticleTarget, null,
  'denied movement does not steal or fabricate an active-lunge endpoint');
deniedStagedAction.fire();
assert(deniedStrikeTarget && Math.abs(deniedStrikeTarget.point.x - 4) < 1e-9,
  'denied movement attack still resolves its staged strike against the fresh reticle endpoint');
blockNativeLunge = false;
cameraRayOriginZ = 0;
perspectivePointZ = 0;

// Grounding is now determined only by pitch: forward/upward aim can leave the
// ground regardless of whether an enemy is already horizontally inside the attack.
perspectivePointY = 2.35; // ~10.2° upward from the player's 0.55 origin: below the old 12° leap threshold.
deps.hostileObjects = []; // Explicitly prove airborne attack setup does not depend on any enemy existing or being in range.
targetBox = {
  min: { x: 5.55, y: 1.55, z: -0.15 },
  max: { x: 5.75, y: 2.25, z: 0.15 },
};
player.x = 0;
player.y = 0;
player.lunging = false;
lastProfileResistance = null;
lastProfileAirAssist = false;
deps.beginCombatLunge(128, 0.4, 0, { rangePx: 64, halfConeRad: 0.25, pitchDistanceResistance: 0 });
assert.equal(lastProfileResistance, 1,
  'any upward aim forces full pitch resistance so gravity cannot pin the lunge to the ground');
assert.equal(lastProfileAirAssist, true,
  'upward aim enables airborne assist without checking enemy range, ledges, or branches');
assert.equal(lastProfileDirect, 1, 'upward aim selects full direct reticle flight');
assert.equal(player.lungeHopUnits, 0, 'upward direct flight must not use the old curved hop');
assert(player.lungeVerticalTravelUnits > 0, 'upward reticle aim must create positive real world-Y travel');
assert.equal(windowStub.HobunjiCombatCameraAlignment.debugSnapshot().lastLunge.gravityBypassedForForwardOrUpwardAim, true,
  'debug state exposes the forward/upward pitch grounding bypass');
assert.equal(windowStub.HobunjiCombatCameraAlignment.debugSnapshot().lastLunge.inRangeAirAssist, true,
  'debug state exposes the shared airborne-assist flag');

player.lunging = false;
lastProfileResistance = null;
lastProfileAirAssist = false;
perspectivePointY = 0.55; // Exactly forward.
deps.beginCombatLunge(128, 0.4, 0, { rangePx: 64, halfConeRad: 0.25, pitchDistanceResistance: 0 });
assert.equal(lastProfileResistance, 1, 'exactly forward aim is not considered downward/grounded');
assert.equal(lastProfileAirAssist, true, 'exactly forward aim keeps direct-flight authority enabled');
assert.equal(lastProfileDirect, 1, 'exactly forward aim still bypasses the grounded ballistic path');
assert.equal(player.lungeHopUnits, 0, 'direct reticle flight never synthesizes a hop');
assert.equal(player.lungeVerticalTravelUnits, 0, 'exactly horizontal reticle aim has zero Y component by definition');
assert.equal(deps.hostileObjects.length, 0, 'forward/upward direct-flight behavior is verified with no hostile available');
const noHostileLungeTarget = windowStub.HobunjiCombatCameraAlignment.debugSnapshot().activeLungeReticleTarget;
assert(noHostileLungeTarget && noHostileLungeTarget.source === 'shared-perspective-point',
  'a no-hostile lunge still owns its frozen perspective fallback instead of borrowing a future attack target');

player.lunging = false;
lastProfileResistance = null;
lastProfileAirAssist = true;
lastProfileDirect = 1;
perspectivePointY = 0.15; // Below the player's forward origin.
deps.beginCombatLunge(128, 0.4, 0, { rangePx: 64, halfConeRad: 0.25, pitchDistanceResistance: 0 });
assert.equal(lastProfileResistance, 0, 'below-forward aim preserves ordinary grounded gravity behavior');
assert.equal(lastProfileAirAssist, false, 'only below-forward pitch disables airborne assist');
assert.equal(lastProfileDirect, 0, 'below-forward pitch retains the grounded/legacy lunge model');
player.lunging = false;
player.lungeHitTest = null;
perspectivePointY = 0.55;
deps.hostileObjects = [target]; // Restore the target only for the separate swept collision-stop regression below.

// Simulate updateMovement covering two tiles in one rendered frame. The real
// attack range is 1 tile, but the lunge-cancel cone is only 0.5 tile long. With
// the target beginning at world X 1.4, first cancel entry is player world X 0.9
// = 57.6 logical pixels, long before the attempted endpoint at 128 px.
targetBox = {
  min: { x: 1.4, y: 0, z: 0.02 },
  max: { x: 1.6, y: 1, z: 0.12 },
};
player.x = 0;
player.y = 0;
player.lunging = false;
perspectivePointY = 0.15; // This cancellation case deliberately aims below forward so it remains a fully grounded lunge.
deps.beginCombatLunge(192, 0.4, 0, { rangePx: 64, halfConeRad: 0.2 });
assert.equal(player.lungeDirX, 1, 'lunge direction is reticle-authored before movement');
assert(Math.abs(player.lungeDirY) < 1e-9, 'reticle-authored lunge has no sideways component');
assert.equal(player.lungeHitTest.rangePx, 32, 'lunge cancellation cone is half the real 64px attack reach');
player.x = 128; // stand-in for the native eased/swept movement completed earlier this frame
windowStub.Combat.update(0.016);
assert.equal(player.lunging, false, 'ordinary lunge ends on first half-range cancellation-volume entry');
assert(player.x > 57 && player.x < 58.5,
  `swept stop clamps near the first half-range cancel entry point (got ${player.x})`);
assert(Math.abs(nativeUpdateSawX - player.x) < 1e-9,
  'staged Combat.update observes the clamped stop point before strike callbacks run');

// Charged/elevated lunges freeze only horizontal travel and retain their arc.
perspectivePointY = 0.55; // Forward aim is airborne under the new pitch-only rule.
player.x = 0;
player.y = 0;
player.lunging = false;
deps.beginCombatLunge(192, 0.4, 0.6, { rangePx: 64, halfConeRad: 0.2 });
assert.equal(player.lungeHitTest.rangePx, 32, 'hop lunge uses the same half-length cancellation cone');
player.x = 128;
windowStub.Combat.update(0.016);
assert.equal(player.lunging, true, 'hop lunge keeps its vertical arc alive after range entry');
assert.equal(player.lungeDistancePx, 0, 'hop lunge freezes horizontal travel at range entry');
assert.equal(player.lungeHitTest, null, 'hop lunge stops re-testing once its horizontal endpoint is fixed');
assert(nativeUpdateCalls >= 2, 'native Combat.update continues to run through the bridge');

const debug = windowStub.HobunjiCombatCameraAlignment.debugSnapshot();
assert.equal(debug.stagedActionCommitInstalled, true, 'staged strike ownership wrapper is installed');
assert.equal(debug.exactReticleAlignmentInstalled, true);
assert.equal(debug.combatUpdateSweepInstalled, true);
assert(debug.reticleBoxHitCount >= 1);
assert(debug.lungeEarlyStopCount >= 2);
assert.equal(debug.lastLunge.attackRangePx, 64, 'debug keeps the true strike range visible');
assert.equal(debug.lastLunge.cancelRangePx, 32, 'debug exposes the half-length lunge-cancel range separately');
assert.equal(debug.lungeSweepMode, 'piggyback-existing-combat-update-no-independent-loop');
console.log('exact reticle hitbox + half-range swept lunge-stop regression passed');
