#!/usr/bin/env node
'use strict';
// RuinEncounters against the real WorldEvents and fakes for everything the game provides:
// MinionCombat, Combat.deps.hostileObjects, the burden plinth node, Shattercasks and the witch bombs.
const assert = require('node:assert/strict');
globalThis.window = globalThis;
window.WorldEvents = require('../docs/js/world-events.js');
require('../docs/js/ruin-encounters.js');
const RE = window.RuinEncounters;
const MAP = 'map_test';
const flush = () => new Promise(r => setImmediate(r));

// ---------------------------------------------------------------- fakes
const hostileObjects = new Set();
window.Combat = { deps: { TILE: 64, hostileObjects } };
window.GridTileAccessors = { getCurrentArea: () => MAP, getActiveScene: () => ({}), getActiveGrid: () => [], getActiveCols: () => 10, getActiveRows: () => 10 };
let entityId = 0;
const made = [];
const baseEntity = (o, extra) => ({ id: 'e' + (++entityId), x: o.x, y: o.y, health: 10, ...o.extra, ...extra, avatarRef: { group: { parent: {}, }, dispose() { this.disposed = true; } } });
let bombFuseSeen = null;
window.MinionCombat = {
  async makeEntity(o) { const e = baseEntity(o, { kind: 'skeleton' }); made.push(e); return e; },
  async makeDemolitionist(o) { bombFuseSeen = o.witchBombFuseSeconds; const e = baseEntity(o, { kind: 'demolitionist', ruinEncounter: o.ruinEncounter }); made.push(e); bombs.push({ id: 'b' + e.id, enemyCarrier: e, exploded: false, fuseSeconds: o.witchBombFuseSeconds, spawnedAtMs: 0 }); return e; },
};
const bombs = [];
let dropped = [];
window.Shattercasks = {
  activeBurdenRecords: () => bombs.filter(b => !b.gone),
  discardBurden(b) { discarded.push(b); if (b === payload) { payload = null; node.userData.burdenPlatePayload = null; } },
};
const discarded = [];
window.HronalWitchBombs = { dropEnemyBomb(b) { if (!b.enemyCarrier) return false; b.enemyCarrier = null; dropped.push(b); return true; } };
// the plinth node + a seated statue (world position in tile units)
let payload = null;
const anchor = {};
const node = { userData: { burdenPlateAnchor: anchor, burdenPlatePayload: null, burdenPlateComplete: false, puzzleProgress: 0 } };
window.FurniturePuzzleRuntime = { getNode: (m, id) => (m === MAP && id === 'plinth' ? node : null) };
const seat = (x = 5, z = 5) => { payload = { id: 'statue', exploded: false, group: { parent: anchor, getWorldPosition: v => Object.assign(v, { x, y: 0, z }), position: { x, y: 0, z } } }; node.userData.burdenPlatePayload = payload; };
const reset = () => { RE.clearScope(MAP); hostileObjects.clear(); made.length = 0; bombs.length = 0; dropped = []; discarded.length = 0; payload = null; Object.assign(node.userData, { burdenPlatePayload: null, burdenPlateComplete: false, puzzleProgress: 0 }); };
const events = [];
for (const type of ['encounter:armed', 'encounter:start', 'encounter:spawn', 'encounter:plant', 'encounter:statue-destroyed', 'encounter:success', 'encounter:failed']) window.WorldEvents.on(type, p => events.push(type));
const types = () => [...events];
const run = async (seconds, step = 0.1) => { for (let t = 0; t < seconds - 1e-9; t += step) { RE.tick(step); await flush(); } };

(async () => {
  const sched = [{ t: 0.5, kind: 'skeleton', count: 2, spawner: 0 }, { t: 1, kind: 'demolitionist', count: 1, spawner: 1, plantFuseSeconds: 3 }];
  const spawners = [{ x: 1, z: 1 }, { x: 9, z: 9 }];

  // ---- waits until a statue sits on the plinth
  reset(); events.length = 0;
  let enc = RE.create({ id: 'e1', mapId: MAP, objective: { type: 'defend', plinthId: 'plinth' }, spawners, schedule: sched });
  assert.equal(enc.state, 'waiting'); assert.deepEqual(types(), ['encounter:armed']);
  await run(2);
  assert.equal(enc.state, 'waiting', 'nothing happens with an empty plinth'); assert.equal(made.length, 0);

  // ---- arms when the statue is seated; schedule runs on the encounter clock
  seat(5, 5); events.length = 0;
  await run(0.2);
  assert.equal(enc.state, 'running'); assert(types().includes('encounter:start'));
  await run(0.6); // clock ~0.8: the skeleton wave is out of the pillar but held, not yet in combat
  assert.equal(made.filter(e => e.kind === 'skeleton').length, 2, 'the scheduled skeleton wave spawned');
  assert.equal(hostileObjects.size, 0, 'enemies are held (no AI) while they climb out of the pillar');
  const sk = made.find(e => e.kind === 'skeleton');
  assert.equal(sk.x, 1 * 64); assert.equal(sk.y, 1 * 64); assert.equal(sk.extra, undefined); assert.equal(sk.ruinEncounterId, 'e1', 'spawn options carry the encounter id');
  await run(1.0);
  assert(hostileObjects.has(sk), 'after the emerge time the enemy joins combat');
  assert.equal(made.filter(e => e.kind === 'demolitionist').length, 1);
  assert.equal(bombFuseSeen, RE.CONFIG.carrierFuseSeconds, 'the carried bomb will not go off en route');
  const demo = made.find(e => e.kind === 'demolitionist');
  assert.equal(demo.ruinEncounter, true);

  // ---- the demolitionist targets the statue stand-in, never the player, and plants when close
  await run(0.4); // spawned at t=1, released after the 0.9s emerge
  assert.equal(demo._chunkCombatTarget, enc.proxy, 'steered at the statue stand-in');
  assert.equal(sk._chunkCombatTarget, undefined, 'skeletons keep their normal target (the player)');
  assert.equal(enc.proxy.creatureKey, 'encounterStatueProxy'); assert.equal(enc.proxy.invulnUntil, Infinity);
  assert.equal(enc.proxy.x, 5 * 64); assert.equal(enc.proxy.y, 5 * 64, 'the proxy stands where the statue is');
  assert.equal(dropped.length, 0, 'far away: no planting yet');
  demo.x = 5 * 64 + 2 * 64; demo.y = 5 * 64; // 2 tiles from the statue
  const before = performance.now();
  await run(0.1);
  assert.equal(dropped.length, 1, 'planted the bomb');
  assert.equal(dropped[0].fuseSeconds, 3, 'the fuse is the schedule entry’s plantFuseSeconds, started at planting');
  assert(dropped[0].spawnedAtMs >= before, 'the fuse clock restarts at planting');
  assert.equal(demo._chunkCombatTarget, null, 'released from the proxy after planting');
  assert(types().includes('encounter:plant'));
  await run(0.5);
  assert(enc.enemies.some(e => e.entity === demo), 'it lingers a moment after planting');
  await run(1.2);
  assert(!enc.enemies.some(e => e.entity === demo), 'then it leaves the field');
  assert(!hostileObjects.has(demo)); assert.equal(demo.avatarRef.disposed, true);

  // ---- a blast reaching the statue destroys it; the press reverses (plinth's own watch) and the run fails then re-arms
  events.length = 0;
  window.WorldEvents.emit('blast', { scope: MAP, x: 8, z: 5, radius: 1.5, sourceId: 'bomb' });
  assert(!types().includes('encounter:statue-destroyed'), 'out of the blast radius: the statue is fine');
  window.WorldEvents.emit('blast', { scope: MAP, x: 5.5, z: 5, radius: 2, sourceId: 'bomb' });
  assert(types().includes('encounter:statue-destroyed')); assert.equal(discarded.at(-1)?.id, 'statue');
  await run(0.2);
  assert(types().includes('encounter:failed'), 'the lost statue fails the attempt');
  assert.equal(enc.state, 'waiting', 'retry re-arms');
  assert.equal(enc.enemies.length, 0, 'enemies are cleared when the attempt ends'); assert.equal(hostileObjects.size, 0);
  assert.equal(enc.stats.failures, 1);

  // ---- retry: seat again and it starts over with a fresh clock/schedule; success when the press completes
  seat(5, 5); events.length = 0; made.length = 0;
  await run(0.3);
  assert.equal(enc.state, 'running'); assert(enc.clock < 0.5, 'fresh clock');
  await run(1.2);
  assert(made.length >= 3, 'the schedule ran again');
  node.userData.burdenPlateComplete = true; // the plinth finished pressing
  await run(0.2);
  assert(types().includes('encounter:success')); assert.equal(enc.state, 'success'); assert.equal(enc.enemies.length, 0, 'success clears the field');
  assert.equal(enc.stats.successes, 1);
  await run(1); assert.equal(enc.state, 'success', 'stays finished');

  // ---- the plinth's own progress is the encounter's clock (a slow frame cannot let the press outrun the schedule)
  reset();
  enc = RE.create({ id: 'e1b', mapId: MAP, objective: { type: 'defend', plinthId: 'plinth' }, spawners, schedule: sched });
  node.userData.furniturePuzzle = { motion: { durationSeconds: 30 } };
  seat(); await run(0.2);
  node.userData.puzzleProgress = 0.5; RE.tick(0.016); await flush();
  assert(enc.clock >= 15 - 1e-9 && enc.clock < 15.1, 'clock follows press progress: ' + enc.clock);
  assert.equal(made.length, 3, 'everything scheduled before that point has come out');
  node.userData.puzzleProgress = 0.2; RE.tick(0.016); assert(enc.clock >= 15, 'the clock never runs backwards');
  delete node.userData.furniturePuzzle; node.userData.puzzleProgress = 0;

  // ---- the player taking the statue back is not a failure
  reset(); events.length = 0;
  enc = RE.create({ id: 'e2', mapId: MAP, objective: { type: 'defend', plinthId: 'plinth' }, spawners, schedule: sched });
  seat(); await run(0.5); assert.equal(enc.state, 'running');
  payload.group.parent = null; node.userData.burdenPlatePayload = null; // lifted off
  await run(0.2);
  assert.equal(enc.state, 'waiting'); assert.equal(enc.stats.failures, 0); assert(!types().includes('encounter:failed'));

  // ---- cap on enemies alive
  reset();
  enc = RE.create({ id: 'e3', mapId: MAP, objective: { type: 'defend', plinthId: 'plinth' }, spawners, schedule: [{ t: 0, kind: 'skeleton', count: 20, spawner: 0 }], maxAlive: 3 });
  seat(); await run(0.5);
  assert.equal(made.length, 3, 'never more than maxAlive');

  // ---- dead enemies leave the roster and free capacity
  made[0].health = 0; await run(0.3);
  assert.equal(enc.enemies.length, 2);

  // ---- an encounter ended while an enemy is being built does not leak it
  reset(); events.length = 0;
  let release;
  RE.registerEnemyKind('slow', { spawn: () => new Promise(r => { release = () => r(baseEntity({ x: 0, y: 0 }, { kind: 'slow' })); }) });
  enc = RE.create({ id: 'e4', mapId: MAP, objective: { type: 'defend', plinthId: 'plinth' }, spawners, schedule: [{ t: 0, kind: 'slow', count: 1, spawner: 0 }] });
  seat(); await run(0.3);
  assert.equal(enc.pending, 1);
  payload.group.parent = null; node.userData.burdenPlatePayload = null; await run(0.2);
  const slow = release(); await flush(); await flush();
  assert.equal(enc.enemies.length, 0, 'a late spawn is discarded once the attempt is over');

  // ---- scoping / disposal
  assert.equal(RE.clearScope('another'), 0); assert.equal(RE.clearScope(MAP), 1); assert.equal(RE.encounters.length, 0);
  reset();
  enc = RE.create({ id: 'e5', mapId: 'other_map', objective: { type: 'defend', plinthId: 'plinth' }, spawners, schedule: sched });
  RE.tick(1); assert.equal(enc.clock, 0, 'only the current map’s encounters tick');
  RE.remove('e5'); assert.equal(RE.debugSnapshot().encounters.length, 0);

  console.log('ok test-ruin-encounters');
})().catch(e => { console.error(e); process.exit(1); });
