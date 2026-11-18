'use strict';
// Regression coverage for player-derived riding caps and ordinary hostile pursuit.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const mountSource = fs.readFileSync('docs/js/mount-system.js', 'utf8'); // Uses the real mounted-speed helpers, not a copied formula.
const gameSource = fs.readFileSync('docs/game.js', 'utf8'); // Uses the real shared ground/cliff creature mover.
const companionSource = fs.readFileSync('docs/js/companion-movement-speed.js', 'utf8'); // Confirms the run baseline is exported to mounted movement.
const stableSource = fs.readFileSync('docs/js/stable-animal-perk-adjustments.js', 'utf8'); // Guards against double-counting Fleet Stride.

assert.match(mountSource, /CRUISE_SPEED_RATIO\s*=\s*1\s*;/, 'ordinary riding uses the full inherited baseline rather than 66% cruise');
assert.match(mountSource, /MOUNT_PLAYER_RUN_RATIO\s*=\s*1\.1\s*;/, 'riding baseline is exactly +10%');
assert.match(companionSource, /playerRunningSpeed,\s*__test:/, 'player-running baseline is exported for the mounted system');
assert.doesNotMatch(stableSource, /ride\.def\s*=\s*\{\s*\.\.\.oldDef/, 'Fleet Stride must not modify an authored mount species definition');

const mountStart = mountSource.indexOf('function currentPlayerRunningSpeedPxS()');
const mountEnd = mountSource.indexOf('function mountedMeleeStaminaMultiplier()', mountStart);
assert(mountStart > 0 && mountEnd > mountStart, 'real mounted speed helpers are extractable');
let liveRun = 238; // Changes the player's hypothetical live running target between reads.
let training = 1; // Changes Fleet Stride without modifying species data.
const mountContext = {
  window: { CompanionMovementSpeed: { playerRunningSpeed: () => liveRun } },
  deps: { player: {}, MOVE_SPEED: 238 },
  mountedTrainingModifiers: () => ({ baseSpeed: training }),
  MOUNT_PLAYER_RUN_RATIO: 1.1,
  Number,
  Math,
};
const mountHelpers = vm.runInNewContext(
  '(() => { ' + mountSource.slice(mountStart, mountEnd) + '; return { currentPlayerRunningSpeedPxS, mountedTopSpeedPxS }; })()',
  mountContext
);
assert.equal(mountHelpers.mountedTopSpeedPxS(), 238 * 1.1, 'untrained mount is 110% of starting player run speed');
liveRun = 238 * 1.08;
assert(Math.abs(mountHelpers.mountedTopSpeedPxS() - 238 * 1.08 * 1.1) < 1e-9, 'Well Rested player buff is inherited before mount perks');
training = 1.2;
assert(Math.abs(mountHelpers.mountedTopSpeedPxS() - 238 * 1.08 * 1.1 * 1.2) < 1e-9, 'Fleet Stride applies once after the baseline');
liveRun = 0;
assert.equal(mountHelpers.mountedTopSpeedPxS(), 0, 'zero-speed player effects cannot accidentally reenable riding movement');
mountContext.window.CompanionMovementSpeed = null;
assert(Math.abs(mountHelpers.mountedTopSpeedPxS() - 238 * 1.1 * 1.2) < 1e-9, 'standalone tools retain a safe base-speed fallback');

const moveStart = gameSource.indexOf('function moveCreatureToward(c, tx, ty, speed, dt)');
const moveEnd = gameSource.indexOf('\n      // Grid-walkability predicate', moveStart);
assert(moveStart > 0 && moveEnd > moveStart, 'real shared creature movement function is extractable');
const player = {}; // Player-owned allied pets must not receive the enemy chase floor.
let heavy = 1; // Simulates ResourceSystem heavy movement debuff.
const enemyDebug = {}; // Mobile diagnostics must expose the actual resolved enemy pursuit target.
const moveContext = {
  window: {
    ResourceSystem: { timedDebuffModifier: () => heavy },
    RangedWeapons: { movementSpeedMultiplier: () => 1, movementDirectionMultiplier: () => 1 },
    CreatureCliffClimb: { navigate: () => false },
    EnemyCollisionReposition: { MIN_MOVE_FRAC: 0.25, tryReposition: () => null },
    DevRandomRuin: { syncShaftCreatureFloor() {} },
  },
  devGlobalSpeedMul: 1,
  ENEMY_PURSUIT_SPEED_PX_S: 238 * 1.08 * 0.95,
  enemyPursuitSpeedDebug: enemyDebug,
  player,
  isCreatureSwimming: () => false,
  isCreatureClimbing: () => false,
  creatureCanEnterTile: () => true,
  tickCreatureFootsteps() {},
  Math, Number,
};
const move = vm.runInNewContext('(' + gameSource.slice(moveStart, moveEnd).trim() + ')', moveContext);
const enemy = (state, chaseSpeed, extra = {}) => ({ id: 'enemy', state, x: 0, y: 0, vx: 0, vy: 0, def: { chaseSpeed }, ...extra });
const floor = 238 * 1.08 * 0.95;
const chasing = enemy('chase', 110);
assert.equal(move(chasing, 1000, 0, 110, 1), true);
assert(Math.abs(chasing.x - floor) < 1e-9, 'ordinary enemy chase uses 95% of the Well Rested starter run speed');
assert(Math.abs(enemyDebug.lastResolvedPxS - floor) < 1e-9, 'mobile chase debug shows the same selected movement speed');
const searching = enemy('searching', 140);
move(searching, 1000, 0, 140, 1);
assert(Math.abs(searching.x - floor) < 1e-9, 'search-phase enemies also move at normal chase pace');
const fast = enemy('chase', 300);
move(fast, 1000, 0, 300, 1);
assert.equal(fast.x, 300, 'intentionally faster hostile species stay faster');
const patrol = enemy('idle', 110);
move(patrol, 1000, 0, 110, 1);
assert.equal(patrol.x, 110, 'idle and patrol locomotion stays authored');
const retreat = enemy('chase', 110);
move(retreat, 1000, 0, 95, 1);
assert.equal(retreat.x, 95, 'special movement requests are never normalized as pursuit');
const ally = enemy('chase', 110, { master: player, isCompanion: true });
move(ally, 1000, 0, 110, 1);
assert.equal(ally.x, 110, 'player-owned pets are not accelerated like enemies');
const armored = enemy('chase', 110, { isBandit: true, _enemyPursuitArmorMul: 0.75 });
move(armored, 1000, 0, 110, 1);
assert(Math.abs(armored.x - floor * 0.75) < 1e-9, 'heavy enemy outfits retain their penalty after chase normalization');
heavy = 0.5;
const slowed = enemy('chase', 110);
move(slowed, 1000, 0, 110, 1);
assert(Math.abs(slowed.x - floor * 0.5) < 1e-9, 'creature Heavy debuff still affects pursuit pace');
console.log('mount player-run and enemy chase baseline regressions passed');
