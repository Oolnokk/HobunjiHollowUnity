#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/combat/combat-camera-alignment-bridge.js', 'utf8');
assert.doesNotMatch(source, /requestAnimationFrame\s*\(|setInterval\s*\(/,
  'reticle/lunge correction must piggyback existing combat ticks instead of adding another loop');
assert.match(source, /rayBoxInterval\(ray, box\)/,
  'transient melee alignment uses an exact center-ray/Box3 test');
assert.match(source, /resolveSweptLungeEntry\(liveDeps\)/,
  'lunge range entry is checked across movement already completed this frame');
assert.match(source, /LUNGE_CANCEL_RANGE_MULTIPLIER = 0\.5/,
  'lunge cancellation range stays explicitly half of the real attack range');

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

const perspectiveTarget = () => ({
  point: { x: 10, y: 0.55, z: 0 },
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
    meleeLungeProfile(distancePx, pitch, hopUnits) {
      return { distancePx, pitch, hopUnits };
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
