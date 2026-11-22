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
const hitStart = game.indexOf('function applyKnockback(target, fromX, fromY, speedPxS)');
const hitEnd = game.indexOf('function startProneThrow(entity, isPlayer, facingAngle, direction)', hitStart);
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

console.log('Prone airborne gravity, cliff cost, repeated hits and throw routing: OK');
