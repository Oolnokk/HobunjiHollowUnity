#!/usr/bin/env node
'use strict';
// Executes RemotePlayerState + DevDummyPlayer through DamageAuthority: a second
// player takes damage, goes down, bleeds out/revives and respawns independently
// of the local player.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

let nowMs = 1000;
const scheduled = {};
const ctx = { window: { RuntimeFrameScheduler: { register: (id, cb) => { scheduled[id] = cb; } } }, performance: { now: () => nowMs }, console };
vm.createContext(ctx);
for (const f of ['sim-clock', 'actor-registry', 'damage-authority', 'remote-player-state', 'dev-dummy-player']) vm.runInContext(read(`docs/js/${f}.js`), ctx);
const w = ctx.window;
const { ActorRegistry: reg, DamageAuthority: dmg, RemotePlayerState: rps, DevDummyPlayer: dummy } = w;

const local = { x: 0, y: 0, health: 100, maxHealth: 100, areaId: 'farm' };
reg.registerPlayer(local, { local: true });
const localHits = [];
dmg.init({ damageLocalPlayer: (...a) => { localHits.push(a); }, damageCreature: () => {} });

const d = dummy.spawn({ x: 100, y: 0, areaId: 'cave' });
assert.equal(reg.idOf(d), 'dummy-player');
assert.equal(reg.playerCount(), 2);
assert.ok(scheduled.RemotePlayerState && scheduled.DevDummyPlayer, 'both tick through the frame scheduler');
assert.equal(reg.nearestPlayer(90, 0, { areaId: 'cave', strict: true }), d);

// Damage lands on the dummy only.
dmg.hit(d, 30, 0, 0, 200, { tag: 'sharp' });
assert.equal(d.health, 70);
assert.equal(localHits.length, 0, 'local player untouched');
assert.ok(d.vx > 0, 'knocked away from the source');

// Lethal -> down at 1 HP, not dead; targeting helpers skip it.
nowMs += 5000; // past i-frames if any
dmg.hit(d, 500, 0, 0, 0, { tag: 'sharp' });
assert.equal(rps.isDowned(d), true);
assert.equal(d.health, 1);
assert.equal(d._downed, true);
assert.equal(reg.nearestPlayer(90, 0, { aliveOnly: true }), local, 'downed player is not a live target');

// Hits while down cost bleed-out time, never health.
const t0 = rps.remainingBleedOutS(d);
dmg.hit(d, 10, 0, 0, 0, { tag: 'sharp' });
assert.equal(rps.remainingBleedOutS(d), t0 - 2);
assert.equal(d.health, 1);

// Bleed-out ticks independently; killing revives at half health.
scheduled.RemotePlayerState({ deltaMs: 10000 });
assert.equal(rps.remainingBleedOutS(d), t0 - 12);
const events = []; rps.onEvent(e => events.push(e.type));
assert.equal(rps.noteKillBy(d), true);
assert.equal(rps.isDowned(d), false);
assert.equal(d.health, 50);
assert.deepEqual(events, ['revive']);

// Revive i-frames block an immediate hit; then down again and bleed out -> respawn.
dmg.hit(d, 999, 0, 0, 0, {});
assert.equal(d.health, 50, 'revive invulnerability');
nowMs += 5000;
rps.setRespawnPoint(() => ({ x: 7, y: 8, areaId: 'farm' }));
dmg.hit(d, 999, 0, 0, 0, {});
assert.equal(rps.isDowned(d), true);
scheduled.RemotePlayerState({ deltaMs: 31000 });
assert.equal(rps.isDowned(d), false);
assert.equal(d.health, 100);
assert.deepEqual([d.x, d.y, d.areaId], [7, 8, 'farm']);
assert.ok(events.includes('death'));

// Dummy walks and follows.
dummy.setPosition(0, 0); dummy.walkTo(140, 0);
scheduled.DevDummyPlayer({ deltaMs: 500 });
assert.ok(d.x > 50 && d.x < 100, 'moves at ~140 px/s');
local.x = 500; dummy.follow(true);
scheduled.DevDummyPlayer({ deltaMs: 1000 });
assert.ok(d.x > 100, 'follows the local player');

// Despawn leaves only the local player.
assert.equal(dummy.despawn(), true);
assert.equal(reg.playerCount(), 1);
console.log('remote player state tests passed');
