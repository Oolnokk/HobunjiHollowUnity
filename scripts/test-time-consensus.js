#!/usr/bin/env node
'use strict';
// Co-op time rules: everyone must rest to advance time; forced skips knock the
// victim out for 60 s (revivable by another player); the longest queued skip wins.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

let nowMs = 1000;
const ctx = { window: {}, performance: { now: () => nowMs }, console };
vm.createContext(ctx);
for (const f of ['sim-clock', 'actor-registry', 'time-consensus']) vm.runInContext(read(`docs/js/${f}.js`), ctx);
const { ActorRegistry: reg, TimeConsensus: tc } = ctx.window;

const mk = (x, y) => ({ x, y, health: 100, maxHealth: 100 });
const a = mk(0, 0), b = mk(40, 0), c = mk(80, 0);
const log = [];
tc.init({ onKnockoutStart: p => log.push(['ko', reg.idOf(p)]), onKnockoutEnd: (p, why) => log.push(['ko-end', reg.idOf(p), why]), tilePx: 64 });

// Single player: the gate is off, callers keep their immediate path.
reg.registerPlayer(a, { playerId: 'A', local: true });
assert.equal(tc.shouldGate(), false);

reg.registerPlayer(b, { playerId: 'B' });
reg.registerPlayer(c, { playerId: 'C' });
assert.equal(tc.shouldGate(), true);

const ran = [], resolved = [];
const skip = (kind, minutes, tag) => ({ kind, source: tag, minutes, run: r => ran.push([tag, r.winner.minutes]), onResolved: r => resolved.push(tag) });

// --- Sleep needs everyone.
assert.equal(tc.requestRest(a, skip('sleep', 600, 'a-sleep')).state, 'waiting');
assert.equal(tc.requestRest(b, skip('sleep', 600, 'b-sleep')).state, 'waiting', 'two of three: still waiting');
assert.equal(ran.length, 0, 'time has not advanced');
let r = tc.requestRest(c, skip('sleep', 600, 'c-sleep'));
assert.equal(r.state, 'resolved');
assert.equal(r.resolution.reason, 'everyone-resting');
assert.equal(ran.length, 1, 'one skip is applied once, not once per player');
assert.deepEqual(resolved.sort(), ['a-sleep', 'b-sleep', 'c-sleep'], 'every participant gets its own side effects');
assert.equal(tc.consumeResolution(a).seq, r.resolution.seq);
assert.equal(tc.consumeResolution(a), null, 'consumed once');

// --- Sleepers who walk away are dropped.
ran.length = 0; resolved.length = 0;
tc.requestRest(a, skip('sleep', 600, 'a'));
a.x += 200; tc.tick();
assert.equal(tc.stateOf(a), 'none', 'moving away cancels the rest');
a.x -= 200;

// --- Forced skip: knocked out, others awake -> 60 s to revive.
log.length = 0;
let k = tc.knockOut(b, skip('blackout', 120, 'b-ko'));
assert.equal(k.state, 'waiting');
assert.equal(tc.isKnockedOut(b), true);
assert.equal(tc.remainingMs(b), 60000);
assert.deepEqual(log, [['ko', 'B']]);
nowMs += 30000; tc.tick();
assert.equal(ran.length, 0, 'still inside the window');
assert.equal(tc.remainingMs(b), 30000);

// Revived in time -> that player's skip is cancelled, time does not advance.
let revived = null;
tc.cancelRest(a);
const t = mk(0, 0); // distance guard: a far player cannot revive
assert.equal(tc.revive(b, mk(1000, 0)), false, 'too far away');
assert.equal(tc.revive(b, b), false, 'cannot revive yourself');
assert.equal(tc.revive(b, a), true);
assert.deepEqual(log.pop(), ['ko-end', 'B', 'revived']);
assert.equal(tc.stateOf(b), 'none');
assert.equal(ran.length, 0, 'revived in time: no skip');

// --- Window expires -> skip fires with everyone's queued skip, longest wins.
ran.length = 0; resolved.length = 0;
tc.knockOut(b, skip('blackout', 120, 'b-alcohol'));
nowMs += 20000;
tc.knockOut(c, skip('blackout', 300, 'c-fey')); // another forced skip during the window
assert.equal(ran.length, 0);
nowMs += 40001; // b's 60 s is up (c's still has ~20 s)
r = tc.tick();
assert.equal(r.reason, 'revive-window-expired');
assert.equal(r.winner.minutes, 300, 'longest queued skip wins');
assert.deepEqual(ran, [['c-fey', 300]], 'applied exactly once');
assert.deepEqual(resolved.sort(), ['b-alcohol', 'c-fey']);
assert.equal(tc.snapshot().length, 0, 'queue cleared');
assert.equal(tc.isKnockedOut(c), false, 'knocked-out players wake after the skip');

// --- Re-knockout does not extend the window; longer skip replaces shorter.
ran.length = 0;
tc.knockOut(b, skip('blackout', 100, 'x'));
nowMs += 10000;
tc.knockOut(b, skip('blackout', 500, 'y'));
assert.equal(tc.remainingMs(b), 50000, 'window is not reset by a second skip');
assert.equal(tc.snapshot()[0].minutes, 500);
tc.revive(b, a);

// --- Resting while someone is knocked out does the same: everyone else asleep -> fires now.
ran.length = 0; resolved.length = 0;
tc.knockOut(c, skip('blackout', 90, 'c-ko'));
assert.equal(tc.requestRest(a, skip('sleep', 600, 'a-rest')).state, 'waiting', 'one still awake');
r = tc.requestRest(b, skip('rest', 60, 'b-rest'));
assert.equal(r.state, 'resolved');
assert.equal(r.resolution.winner.minutes, 600, 'sleep to morning outranks the shorter blackout');
assert.equal(ran.length, 1);
assert.ok(resolved.includes('c-ko'), 'the knocked-out player takes part');

// --- Nobody left to revive -> immediate.
ran.length = 0;
tc.knockOut(a, skip('blackout', 60, 'a'));
tc.knockOut(b, skip('blackout', 70, 'b'));
r = tc.knockOut(c, skip('blackout', 80, 'c'));
assert.equal(r.state, 'resolved');
assert.equal(r.resolution.reason, 'nobody-to-revive');
assert.equal(r.resolution.winner.minutes, 80);

// --- A player leaving can complete consensus.
ran.length = 0;
tc.requestRest(a, skip('sleep', 600, 'a')); tc.requestRest(b, skip('sleep', 600, 'b'));
assert.equal(ran.length, 0);
reg.unregisterPlayer(c);
tc.tick();
assert.equal(ran.length, 1, 'remaining players all resting once the third leaves');

// --- Back to one player: gate off again.
reg.unregisterPlayer(b);
assert.equal(tc.shouldGate(), false);

// --- Remote players: knocked out = down for targeting; sleepers wake restored.
{
  const ctx2 = { window: {}, performance: { now: () => nowMs }, console };
  vm.createContext(ctx2);
  for (const f of ['sim-clock', 'actor-registry', 'time-consensus', 'damage-authority', 'remote-player-state']) vm.runInContext(read(`docs/js/${f}.js`), ctx2);
  const { ActorRegistry: R, TimeConsensus: T, RemotePlayerState: RPS } = ctx2.window;
  const host = mk(0, 0), guest = { ...mk(30, 0), health: 40, stamina: 5, maxStamina: 100 };
  R.registerPlayer(host, { local: true }); R.registerPlayer(guest, { playerId: 'G' });
  const worked = [];
  T.knockOut(guest, { kind: 'blackout', minutes: 90, run: () => worked.push('skip') });
  assert.equal(guest._downed, true, 'a knocked-out remote player is down (hostiles skip them)');
  assert.equal(R.nearestPlayer(0, 0, { aliveOnly: true }), host);
  assert.equal(T.revive(guest, host), true);
  assert.equal(guest._downed, false, 'revived');
  T.requestRest(guest, { kind: 'sleep', minutes: 600, run: () => worked.push('sleep') });
  T.requestRest(host, { kind: 'sleep', minutes: 600, run: () => {} });
  assert.deepEqual(worked, ['sleep']);
  assert.equal(guest.health, 100, 'remote sleeper wakes restored');
  assert.equal(guest.stamina, 100);
  assert.equal(guest._downed, false);
  assert.ok(RPS);
}
console.log('time consensus tests passed');
