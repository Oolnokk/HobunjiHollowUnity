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
assert.match(source, /resolveSweptLungeEntry\(liveDeps\)/,
  'lunge range entry is checked across movement already completed this frame');
assert.match(source, /LUNGE_CANCEL_RANGE_MULTIPLIER = 0\.5/,
  'lunge cancellation range stays explicitly half of the real attack range');
assert.match(coreSource, /if \(direct >= 0\.999 && pitch >= 0\)[\s\S]{0,700}verticalTravelUnits: baseDistanceWorld \* Math\.sin\(pitch\)[\s\S]{0,500}const distanceScaleAtAngle/,
  'forward/upward direct flight must return exact vector components before legacy diminished-vertical math');
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
assert(indexSource.includes('js/combat/combat-combo.js?v=20260927aerialchain1'));
assert(indexSource.includes('js/combat/combat-quickattacks.js?v=20260927aerialchain1'));
assert(indexSource.includes('js/combat/combat-charged-breaker.js?v=20260927aerialchain1'));
assert(indexSource.includes('game.js?v=20260927aerialchain1'));

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

const perspectiveTarget = () => ({
  point: { x: 10, y: perspectivePointY, z: 0 },
  cameraRay: {
    origin: { x: 0, y: 0.5, z: 0 },
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
    if (player.lunging) return;
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
        return {
          distancePx: distancePx * Math.cos(Math.abs(pitch)),
          pitch,
          hopUnits: 0,
          lungeHeightUnits,
          pitchDistanceResistance,
          directFlightStrength: 1,
          verticalTravelUnits: (distancePx / 64) * Math.sin(pitch),
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
  min: { x: 1.4, y: 0, z: -0.2 },
  max: { x: 1.6, y: 1, z: 0.2 },
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
assert.equal(debug.exactReticleAlignmentInstalled, true);
assert.equal(debug.combatUpdateSweepInstalled, true);
assert(debug.reticleBoxHitCount >= 1);
assert(debug.lungeEarlyStopCount >= 2);
assert.equal(debug.lastLunge.attackRangePx, 64, 'debug keeps the true strike range visible');
assert.equal(debug.lastLunge.cancelRangePx, 32, 'debug exposes the half-length lunge-cancel range separately');
assert.equal(debug.lungeSweepMode, 'piggyback-existing-combat-update-no-independent-loop');
console.log('exact reticle hitbox + half-range swept lunge-stop regression passed');
