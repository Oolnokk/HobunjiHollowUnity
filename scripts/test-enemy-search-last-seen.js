#!/usr/bin/env node
'use strict';

// A hostile that loses sight of its target searches at the last position it actually saw them. That sample is
// never cleared, so a chase forced by something other than sight (a hit from behind or outside the facing
// cone) must not reuse a sighting from an earlier fight.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

let now = 100000;
const context = {
  window: { Combat: { targetInsideAttackCone: () => true }, RangedWeapons: { hasLineOfSight: () => true, rangedAttackRadiusPx: () => 0 }, FormatUtils: { clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)) } },
  THREE: { MathUtils: { degToRad: d => d * Math.PI / 180 } },
  performance: { now: () => now },
};
vm.runInNewContext(fs.readFileSync('docs/js/combat/enemy-search-ai.js', 'utf8'), context);
const AI = context.window.EnemySearchAI;
const maxAge = AI.LAST_SEEN_MAX_AGE_MS;
assert(maxAge > 0, 'the sighting age limit is exported');

const player = { x: 900, y: 300, health: 10 };
const hostile = () => ({ x: 100, y: 100, facing: 0, def: { aggroRangePx: 2000 }, state: 'chase' });

// A normal pursuit: sight is checked every frame, so the sample is current when sight is lost.
{
  const c = hostile();
  assert.equal(AI.enemyCanSeeTarget(c, { ...player, x: 500, y: 200 }, 2000), true);
  now += 100; // Sight breaks a few frames later.
  AI.beginEnemySearch(c, player);
  assert.deepEqual([c._enemySearchLastKnownX, c._enemySearchLastKnownY], [500, 200], 'searches where the target was last actually seen, not where they are now');
}

// An earlier fight left a sample; much later a hit from behind forces a chase with no new sighting.
{
  const c = hostile();
  AI.enemyCanSeeTarget(c, { ...player, x: 500, y: 200 }, 2000); // Old fight.
  now += maxAge + 1000;
  AI.beginEnemySearch(c, player);
  assert.deepEqual([c._enemySearchLastKnownX, c._enemySearchLastKnownY], [player.x, player.y], 'a stale sighting from an earlier fight is not used; the attacker position is');
}

// Right at the limit the sighting still counts; a creature that never saw anyone falls back to the target.
{
  const c = hostile();
  AI.enemyCanSeeTarget(c, { ...player, x: 500, y: 200 }, 2000);
  now += maxAge;
  AI.beginEnemySearch(c, player);
  assert.equal(c._enemySearchLastKnownX, 500, 'a sighting exactly at the limit is still part of this pursuit');
  const never = hostile();
  AI.beginEnemySearch(never, player);
  assert.deepEqual([never._enemySearchLastKnownX, never._enemySearchLastKnownY], [player.x, player.y], 'no sighting at all falls back to the target');
}

// The sweep direction follows the position actually used.
{
  const c = hostile(); c.facing = 0;
  AI.enemyCanSeeTarget(c, { ...player, x: 400, y: 400 }, 2000); // Seen below-right of a creature facing +x.
  now += 50;
  AI.beginEnemySearch(c, { ...player, x: 400, y: -400 });
  assert.equal(c._enemySearchDirection, 1, 'first scan turns toward the side of the last sighting, not the target\'s current side');
}
console.log('Enemy search last-seen sample checks passed.');
