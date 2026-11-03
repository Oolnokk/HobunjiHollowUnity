#!/usr/bin/env node
'use strict';
const assert = require('assert');
const S = require('../docs/js/ruin-solver.js');
const RL = require('../docs/js/rope-launch.js');

// A west platform and an east platform with a gap between them along x.
const room = (gapWidth, extra = {}) => ({
  id: 'bridge-room', bounds: { minX: 0, maxX: 36, minZ: 0, maxZ: 16 }, floorY: 0, ceilingY: 3.5,
  zones: { near: { x: 6, z: 8, r: 3.6 }, far: { x: 9.5 + gapWidth + 3, z: 8, r: 3.6 } },
  gaps: [{ id: 'g1', axis: 'x', start: 9.5, end: 9.5 + gapWidth, crossMin: 7, crossMax: 9, y: 0 }],
  playerReach: { throwRange: 6 }, ...extra,
});
const connect = { type: 'connect', from: 'near', to: 'far', gap: 'g1' };
const pieces = plan => S.flatten(plan).map(p => p.piece).sort();

// ---- the rope-bomb pillar bridge, generated from a goal
let r = S.solve(connect, room(3.4), { seed: 7 });
assert(r.ok, 'a 3.4 gap is bridgeable: ' + JSON.stringify(r.rejected));
assert.equal(r.plan.rule, 'pillarBridge');
assert.deepEqual(pieces(r.plan), ['bombDispenser', 'crackedPillar', 'ropeMount', 'strikeStand'], 'the chain: pillar <- blast <- rope bomb <- dispenser');
assert.equal(r.plan.subplans[0].goal.type, 'blast'); assert.equal(r.plan.subplans[0].rule, 'ropeBomb'); assert.equal(r.plan.subplans[0].subplans[0].rule, 'bombDispenser');
assert(S.validate(r.plan).ok, 'every check in the whole tree passed');
assert(S.describe(r.plan).join('\n').includes('connect → pillarBridge'), 'a readable explanation');
const pillar = S.flatten(r.plan).find(p => p.piece === 'crackedPillar');
assert.deepEqual(pillar.params.input, { event: 'blast', withinTiles: 2.5, once: true }, 'the pillar carries the event input the puzzle runtime understands');
near(pillar.x, 12.9); assert(pillar.facing.x < 0, 'it topples toward the near side');

// the plan is not a promise on paper: replay it with the game's physics and the bomb lands on the pillar
const mount = S.flatten(r.plan).find(p => p.piece === 'ropeMount'), stand = S.flatten(r.plan).find(p => p.piece === 'strikeStand');
const ropePlan = r.plan.subplans[0];
const replay = RL.predict({ anchor: { x: mount.x, y: 3.5 - 0.035, z: mount.z }, length: mount.params.length, dirX: mount.params.strikeDir.x, dirZ: mount.params.strikeDir.z, speed: RL.strikeSpeedForFraction((ropePlan.window.range[0] + ropePlan.window.range[1]) / 2), groundAt: 0, restHeight: S.BOMB.restHeight });
assert(Math.hypot(replay.landing.x - pillar.x, replay.landing.z - pillar.z) <= 2.5, 'replayed with RopeLaunch, a mid-range strike lands within the pillar trigger');
assert(Math.hypot(stand.x - replay.landing.x, stand.z - replay.landing.z) > S.BOMB.blastRadius, 'and the player is outside the blast');
assert(ropePlan.window.width >= 0.12, 'with a real skill window: ' + ropePlan.window.width);
assert(stand.params.lungeRange[0] < stand.params.lungeRange[1], 'the stand records which lunge strengths work');

// determinism and variety
const key = res => JSON.stringify(S.flatten(res.plan).map(p => [p.piece, +p.x.toFixed(2), +p.z.toFixed(2)]));
assert.equal(key(S.solve(connect, room(3.4), { seed: 7 })), key(r), 'the same seed gives the same room');
const variants = new Set(Array.from({ length: 12 }, (_, i) => key(S.solve(connect, room(3.4), { seed: 100 + i }))));
assert(variants.size >= 4, 'different seeds give different layouts: ' + variants.size);
for (let i = 0; i < 12; i++) assert(S.validate(S.solve(connect, room(3.4), { seed: 100 + i }).plan).ok, 'every variant is valid');

// ---- a wider gap needs a different rule
r = S.solve(connect, room(5.5), { seed: 3 });
assert(r.ok && r.plan.rule === 'ropeSwing', 'a 5.5 gap is crossed by the original rope traversal: ' + (r.plan && r.plan.rule));
assert.deepEqual(pieces(r.plan), ['ropeMount']); assert(r.rejected.some(x => x.rule === 'pillarBridge' && /pillarSpansGap/.test(x.reason)), 'and the solver says why the pillar bridge was rejected');
r = S.solve(connect, room(8), { seed: 3 });
assert(!r.ok && /pillarSpansGap|no candidate/.test(r.reason), 'an 8-wide gap has no rule: ' + r.reason);

// ---- walls matter: the layout must not throw a bomb through solid
const wallRoom = room(3.4, { solid: (x, z) => x > 9.9 && x < 10.4 }); // a wall across the whole route
r = S.solve(connect, wallRoom, { seed: 7 });
assert(!r.ok || r.plan.subplans[0].rule !== 'ropeBomb', 'a wall across the flight path rules out the rope bomb' + (r.ok ? '' : ': ' + r.reason));

// ---- unreachable target falls back to a throw when the room allows it, and fails clearly when not
const far = room(3.4); far.gaps[0].start = 36; far.gaps[0].end = 39.4; far.bounds.maxX = 60; far.zones.far.x = 43;
r = S.solve({ type: 'blast', at: { x: 38, z: 8 }, radius: 2.5 }, far, { seed: 1 });
assert(!r.ok && r.rejected.some(x => x.rule === 'ropeBomb'), 'no rope layout reaches a point 32 tiles away');
far.playerReach = { throwRange: 40 };
r = S.solve({ type: 'blast', at: { x: 38, z: 8 }, radius: 2.5 }, far, { seed: 1 });
assert(!r.ok || r.plan.rule === 'thrownBomb', 'thrown bombs need the thrower to retreat from the blast');

// ---- extensibility: a registered rule takes part in the search
S.registerRule('connect', { id: 'magicBridge', build: () => [{ rule: 'magicBridge', score: 99, placements: [{ piece: 'magic', x: 1, z: 1 }], subgoals: [], checks: [{ name: 'always', ok: true }] }] });
r = S.solve(connect, room(3.4), { seed: 7 }); assert.equal(r.plan.rule, 'magicBridge', 'the highest-scoring valid rule wins'); assert(r.alternatives.some(a => a.rule === 'pillarBridge'));
r = S.solve(connect, room(3.4), { seed: 7, only: ['pillarBridge'] }); assert.equal(r.plan.rule, 'pillarBridge', "options.only restricts the rules considered");
assert.equal(S.unregisterRule('connect', 'magicBridge'), true); assert.equal(S.unregisterRule('connect', 'magicBridge'), false);
S.registerRule('connect', { id: 'broken', build: () => { throw new Error('boom'); } });
r = S.solve(connect, room(3.4), { seed: 7 }); assert(r.ok, 'a throwing rule is reported, not fatal'); assert(r.rejected.some(x => x.rule === 'broken' && /boom/.test(x.reason))); S.unregisterRule('connect', 'broken');
S.registerRule('connect', { id: 'needsVoid', build: () => [{ rule: 'needsVoid', score: 99, placements: [], subgoals: [{ type: 'nonsense' }], checks: [] }] });
r = S.solve(connect, room(3.4), { seed: 7 }); assert.equal(r.plan.rule, 'pillarBridge', 'a rule whose sub-goal cannot be solved is rejected, not chosen'); assert(r.rejected.some(x => x.rule === 'needsVoid' && /nonsense/.test(x.reason))); S.unregisterRule('connect', 'needsVoid');
assert(!S.solve({ type: 'teleport' }, room(3)).ok);

// ---- defend the statue
const arena = (extra = {}) => ({ id: 'arena', bounds: { minX: 0, maxX: 24, minZ: 0, maxZ: 24 }, floorY: 0, ceilingY: 4, zones: { near: { x: 12, z: 12, r: 3 } }, gaps: [], ...extra });
const defend = { type: 'defend', at: { x: 12, z: 12 }, pressSeconds: 45, difficulty: 3 };
r = S.solve(defend, arena(), { seed: 5 });
assert(r.ok && r.plan.rule === 'plinthDefense', JSON.stringify(r.rejected));
const dp = S.flatten(r.plan);
assert.equal(dp.filter(p => p.piece === 'spawnerPillar').length, 5, 'difficulty 3 places five spawner pillars'); assert(dp.some(p => p.piece === 'plinth') && dp.some(p => p.piece === 'statueDispenser'));
assert(r.plan.schedule.some(w => w.kind === 'demolitionist') && r.plan.schedule.some(w => w.kind === 'skeleton'), 'skeletons to distract, demolitionists to threaten the statue');
assert(r.plan.schedule.every(w => w.t < 45 && w.spawner < 5), 'every wave is inside the press and uses a real spawner');
assert(r.plan.schedule.filter(w => w.kind === 'demolitionist').every(w => w.plantFuseSeconds >= 2.5 && w.plantFuseSeconds <= 5), 'plant fuses are readable');
assert(dp.filter(p => p.piece === 'spawnerPillar').every(p => Math.hypot(p.x - 12, p.z - 12) >= 5), 'spawners start far enough away to give the player time');
assert(S.solve({ ...defend, difficulty: 1 }, arena(), { seed: 5 }).plan.schedule.every(w => w.kind === 'skeleton'), 'an easy defence has no demolitionists');
assert(S.solve({ ...defend, difficulty: 3 }, arena(), { seed: 5 }).plan.schedule.length > S.solve({ ...defend, difficulty: 1 }, arena(), { seed: 5 }).plan.schedule.length, 'and harder ones have more pressure');
r = S.solve(defend, arena({ bounds: { minX: 6, maxX: 18, minZ: 6, maxZ: 18 } }), { seed: 5 });
assert(!r.ok && /leadTime|nearest spawner/.test(r.reason), 'a room too small to give lead time is rejected: ' + r.reason);
r = S.solve(defend, arena({ solid: (x, z) => Math.abs(x - 12) < 0.6 && z > 9 }), { seed: 5, }); // a pillar of wall to one side blocks some approaches
assert(r.ok || /approach|spawner/.test(r.reason), 'solid geometry is respected: ' + (r.reason || 'ok'));
console.log('ruin-solver: ok');
function near(a, b, tol = 0.05) { assert(Math.abs(a - b) <= tol, `expected ${b}, got ${a}`); }
