#!/usr/bin/env node
'use strict';

// Execute the shipped free-jump physics and the game-owned hit/airfall entry
// points against controlled entities. An airborne knockdown must never erase
// the fall or apply the cliff collision profile more than once.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const game = fs.readFileSync('docs/game.js', 'utf8');
const grid = Array.from({ length: 12 }, () => Array.from({ length: 12 }, () => ({ type: 'floor' })));
const player = { x: 4 * 64, y: 4 * 64, health: 100, angle: 0, vx: 0, vy: 0, prone: false };
const impacts = [];
const window = {
  FallSystem: { dropTiers: distance => distance / 2.5, land: () => { throw Error('Prone fall used gentle landing'); } },
  HobunjiCliffFallImpact: { resolve: (_entity, fall) => { impacts.push({ ...fall }); return { lethal: false }; } },
  KnockbackCollisionImpact: { cancel: () => {} },
};
const context = { window, Math };
vm.runInNewContext(fs.readFileSync('docs/js/player-jump.js', 'utf8'), context);
const jump = window.PlayerJump;
jump.init({
  player, TILE: 64, getCurrentArea: () => 'test', getActiveGrid: () => grid,
  getActiveCols: () => 12, getActiveRows: () => 12,
  isSolid: () => false, worldSurfaceY: () => 0, getMovementInput: () => ({ x: 1, y: 0 }),
  getBaseMoveSpeedTiles: () => 3, getMountRideState: () => 'none',
  _isZoneArea: () => true,
});

let state = jump.beginFlight({ x: 4, z: 4, y: 5, vy: -2 }, { deliberate: true });
assert(state);
player.prone = true;
assert.equal(jump.knockProne(), true);
assert.strictEqual(player._freeJump, state, 'knockdown cannot replace airborne ownership');
assert.equal(state.vy, -2, 'already falling velocity must not be reset');
assert.equal(state.proneFallStartY, 5, 'impact measures original elevated release height');
assert.equal(state.noGrab, true, 'prone body cannot catch a ledge');
const beforeX = player.x;
assert.equal(jump.receiveKnockback(1, 0, 128), true);
jump.tick(1 / 60);
assert(state.vy < -2, 'gravity continues after another hit');
assert(player.x > beforeX, 'the hit may still redirect horizontal movement');
assert.equal(player.inputStrength, 0, 'prone flight ignores steering input');
for (let i = 0; i < 180 && player._freeJump; i++) jump.tick(1 / 60);
assert.equal(player._freeJump, null, 'the physical flight reaches ground');
assert.equal(impacts.length, 1, 'cliff landing effects fire once');
assert(Math.abs(impacts[0].dropWorld - 5) < 0.001);
assert(Math.abs(impacts[0].dropTiers - 2) < 0.001);

player.prone = true;
state = jump.beginFlight({ x: 4, z: 4, y: 2.7, vy: 4 }, { deliberate: true });
assert(jump.knockProne());
assert.equal(state.vy, 0, 'ascending actor starts falling from the impact height');
assert.equal(state.proneFallStartY, 2.7);
jump.knockProne();
assert.equal(state.proneFallStartY, 2.7, 'repeat hits do not restart/drop the fall');
for (let i = 0; i < 120 && player._freeJump; i++) jump.tick(1 / 60);
assert.equal(impacts.length, 2);
assert(Math.abs(impacts[1].dropWorld - 2.7) < 0.001);

// The ground-supported prone pose stays supported without running or falling.
player.prone = true;
state = jump.beginFlight({ x: 4, z: 4, y: 0.2, vy: 0 });
state.phase = 'supported';
const supportedX = player.x;
assert.equal(jump.tick(1 / 60), true);
assert.equal(state.phase, 'supported');
assert.equal(player.x, supportedX);
jump.reset();

// The real game hit entry is extracted, not a re-implementation of its rules.
const hitStart = game.indexOf('function applyKnockback(');
const hitEnd = game.indexOf('function startProneThrow(', hitStart);
assert(hitStart >= 0 && hitEnd > hitStart);
const events = [];
const combatWorld = {
  ResourceSystem: { timedDebuffModifier: () => 1 },
  ImpactRagdollPlayback: { triggerTumble: (...args) => events.push(['tumble', ...args]) },
  KnockbackCollisionImpact: { begin: () => events.push(['begin']) },
  PlayerJump: { receiveKnockback: (...args) => events.push(['air impulse', ...args]), knockProne: () => true },
};
const entry = new Function('window', 'player', 'startProneThrow', 'hitDirectionRelativeToFacing',
  'KNOCKBACK_DUR_S', 'PRONE_THROW_DUR_S', 'PRONE_THROW_PLAYER_MIN_PX_S',
  'PRONE_THROW_CREATURE_MIN_PX_S', 'playerMesh',
  game.slice(hitStart, hitEnd) + '\nreturn applyKnockback;')(
  combatWorld, player, (...args) => events.push(['prone throw', ...args]),
  () => 'front', 0.18, 0.34, 600, 480, { position: { y: 0 } });

const target = { x: 100, y: 100, facing: 0, health: 50, prone: true, knockbackT: 4 };
entry(target, 0, 100, 300);
assert(events.some(e => e[0] === 'prone throw'), 'a prone target can be knocked back again');
assert(events.some(e => e[0] === 'tumble'), 'the hit starts the procedural somersault');
assert.equal(target.knockbackT, 0, 'old ordinary impulse is not left to resume on get-up');
const capturedTarget = { x: 100, y: 100, health: 50, onBranch: { perchSupport: true }, tzatzulCapturedBy: 'bird' };
events.length = 0;
entry(capturedTarget, 0, 100, 300);
assert.strictEqual(capturedTarget.onBranch.perchSupport, true, 'ordinary hits do not drop a talon captive using legacy branch knockback');
assert.equal(events.length, 0, 'only a real prone transition releases captured airborne prey');
events.length = 0;
entry(target, 0, 100, 0);
assert.equal(events.length, 0, 'a zero-knockback attack does not launch a prone victim');
const ongoing = { elapsed: 0.1, duration: 0.5, dropWorld: 5 };
target._knockbackLedgeFall = ongoing;
entry(target, 0, 100, 300);
assert.strictEqual(target._knockbackLedgeFall, ongoing, 'a second hit cannot reinitialize the existing fall');
assert.equal(target._knockbackLedgeFall.elapsed, 0.1);
target._knockbackLedgeFall = null;
player.prone = true;
player._freeJump = { phase: 'air', vy: -3 };
events.length = 0;
entry(player, player.x - 100, player.y, 280);
assert(events.some(e => e[0] === 'air impulse') && events.some(e => e[0] === 'tumble'));
assert.equal(player._freeJump.vy, -3, 'repeat prone knockback cannot reset player fall speed');

// Exercise the exact game-owned transition that hands airborne creature and
// scripted climb motion to the existing fall owner after the prone pose begins.
const airStart = game.indexOf('function beginProneAirFall(entity, isPlayer)');
const airEnd = game.indexOf('// The same full breakThrow knockdown', airStart);
assert(airStart >= 0 && airEnd > airStart);
const airWorld = {
  FormatUtils: { clamp: (n, a, b) => Math.max(a, Math.min(b, n)) },
  KnockbackCollisionImpact: { cancel: () => {} },
  PlayerJump: { knockProne: () => false },
  ClimbSystem: { knockProneOffClimb: actor => { actor._climbFall = { dropWorld: 1.5 }; return true; } },
};
const beginProneAirFall = new Function('window', 'player', 'knockbackSurfaceAtPixel',
  'KNOCKBACK_LEDGE_HEIGHT_EPSILON', 'PLATEAU_UNIT', 'TILE', 'beginKnockbackLedgeFall',
  game.slice(airStart, airEnd) + '\nreturn beginProneAirFall;')(
  airWorld, player, () => 1, 0.08, 2.5, 64,
  actor => { actor._knockbackLedgeFall = { elapsed: 0, dropWorld: 4 }; actor._knockbackLedgeAir = null; return true; });
const leapingCreature = {
  x: 100, y: 100, prone: true, health: 100, _proneAirFallStartY: 4.5,
  proneThrowT: .34, proneThrowVX: 600, proneThrowVY: 0,
};
assert.equal(beginProneAirFall(leapingCreature, false), true);
assert.equal(leapingCreature._knockbackLedgeFall.dropWorld, 3.5, 'the interrupted aerial height drives cliff impact');
assert.equal(leapingCreature._knockbackLedgeFall.startSurfaceY, 4.5);
assert.equal(leapingCreature._knockbackLedgeFall.endSurfaceY, 1);
assert.equal(leapingCreature.proneThrowT, 0, 'a creature falling from its lunge cannot throw again after landing');
const alreadyFalling = leapingCreature._knockbackLedgeFall;
assert.equal(beginProneAirFall(leapingCreature, false), true);
assert.strictEqual(leapingCreature._knockbackLedgeFall, alreadyFalling, 'second knockdown keeps the existing creature fall object');

const launchedOverLedge = {
  x: 100, y: 100, prone: true, health: 100, _knockbackLedgeAir: { originSurfaceY: 5 },
  proneThrowT: 0.34,
};
assert.equal(beginProneAirFall(launchedOverLedge, false), true);
assert.equal(launchedOverLedge._knockbackLedgeAir, null, 'the ledge-crossing phase releases into an actual fall');
assert.equal(launchedOverLedge._knockbackLedgeFall.dropWorld, 4);
assert.equal(launchedOverLedge.proneThrowT, 0, 'no queued ground launch can cancel the fall');

player._freeJump = null; player.climbing = true; player._cliffRouteSession = {};
player.proneThrowT = .34;
assert.equal(beginProneAirFall(player, true), true, 'prone scripted climber starts its existing fall');
assert.equal(player.proneThrowT, 0, 'climbing fall and grounded throw cannot be queued together');
player.climbing = false; player._cliffRouteSession = null;
player._knockbackLedgeFall = { dropWorld: 3, elapsed: 0.2 };
player.proneThrowT = .34;
assert.equal(beginProneAirFall(player, true), true, 'already falling player stays in the same ledge fall');
assert.equal(player.proneThrowT, 0);
assert.equal(player._knockbackLedgeFall.elapsed, .2);

// A captured player and a creature on a high perch must detach at their
// live flight height, not snap to the pre-capture floor or take an extra
// immediate branch injury before the final cliff-impact calculation.
let captiveDrops = 0, legacyPerchDamage = 0, physicalFlight = null;
airWorld.TzatzulFlightRuntime = { releaseProneCaptive(actor) {
  captiveDrops++;
  actor.tzatzulCapturedBy = null;
  actor.onPerch = null; actor.onBranch = null;
  return true;
} };
airWorld.PerchSupport = { release(actor, _reason, options) {
  assert.equal(options.deferLegacyKnockback, true);
  legacyPerchDamage++;
  actor.onPerch = null; actor.onBranch = null;
  return { fell: true };
} };
airWorld.PlayerJump = {
  knockProne: () => player._freeJump?.phase === 'air',
  beginFlight: flight => { physicalFlight = { ...flight, phase: 'air' }; player._freeJump = physicalFlight; return physicalFlight; },
};
player._knockbackLedgeFall = null;
player.climbing = false; player.onClimbSurface = null; player._freeJump = null;
player.tzatzulCapturedBy = 'carrier'; player.onBranch = { perchSupport: true };
player.onPerch = { id: 'talon' }; player.branchSurfaceY = 6.2;
player.proneThrowT = 0.34;
assert.equal(beginProneAirFall(player, true), true);
assert.equal(captiveDrops, 1);
assert.equal(player.tzatzulCapturedBy, null);
assert.equal(legacyPerchDamage, 0, 'Tzatzul release already detached the perch; no second release is applied');
assert.equal(physicalFlight.y, 6.2, 'player flight starts at live talon elevation');
assert.equal(physicalFlight.vy, 0);
assert.equal(player.prone, true);
const highPerchCreature = {
  health: 60, x: 100, y: 100, prone: true, onBranch: { perchSupport: true },
  onPerch: { id: 'branch' }, branchSurfaceY: 3.75,
};
assert.equal(beginProneAirFall(highPerchCreature, false), true);
assert.equal(legacyPerchDamage, 1);
assert.equal(highPerchCreature._knockbackLedgeFall.startSurfaceY, 3.75);
assert.equal(highPerchCreature._knockbackLedgeFall.endSurfaceY, 1);
assert.equal(highPerchCreature._knockbackLedgeFall.dropWorld, 2.75);

// A shorter normal attack hop has its own authored lift; it must not vanish
// when the regular combat-lunge timeline is interrupted before the knockdown.
player._freeJump = null; player._proneAirFallStartY = 4.1;
physicalFlight = null;
assert.equal(beginProneAirFall(player, true), true);
assert.equal(physicalFlight.y, 4.1, 'the ordinary combat lunge snapshot is converted to physical falling height');
assert.equal(player._proneAirFallStartY, null, 'consumed launch height cannot leak to a later hit');

console.log('Prone airborne gravity, cliff cost, repeated hits and throw routing: OK');
