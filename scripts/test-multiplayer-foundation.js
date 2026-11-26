#!/usr/bin/env node
'use strict';
// Executes the single-player multiplayer foundations: ActorRegistry (stable
// ids, player list, area-aware targeting), DamageAuthority (target-aware
// routing) and SimClock. See MULTIPLAYER.md.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

let nowMs = 1000;
const ctx = { window: {}, performance: { now: () => nowMs }, console };
vm.createContext(ctx);
for (const f of ['docs/js/sim-clock.js', 'docs/js/actor-registry.js', 'docs/js/damage-authority.js']) vm.runInContext(read(f), ctx);
const { SimClock, ActorRegistry: reg, DamageAuthority: dmg } = ctx.window;

// --- SimClock: identical to performance.now() until a session sets an offset.
assert.equal(SimClock.now(), 1000);
SimClock.setOffsetMs(250);
assert.equal(SimClock.now(), 1250, 'guest offset shifts gameplay time');
SimClock.setOffsetMs(NaN);
assert.equal(SimClock.now(), 1000, 'bad offset falls back to 0');

// --- ActorRegistry: one local player, live shared array, stable ids.
const local = { x: 0, y: 0, health: 100, areaId: 'farm' };
const players = reg.getPlayers();
reg.setLocalAreaResolver(() => 'town'); // game.js `currentArea`, not local.areaId
reg.registerPlayer(local, { local: true });
assert.equal(reg.getPlayers(), players, 'array identity is stable (modules hold it by reference)');
assert.equal(reg.getLocalPlayer(), local);
assert.equal(reg.areaOf(local), 'town', 'local avatar area comes from the game, not a stale areaId');
const localId = reg.idOf(local);
assert.ok(localId.startsWith('player:'));
assert.equal(reg.assignId(local, 'hostile'), localId, 'ids never change once assigned');
assert.equal(reg.getById(localId), local);
assert.deepEqual(Object.keys(local).sort(), ['areaId', 'health', 'x', 'y'], 'ids are not written onto entities (saves stay clean)');

// Second player in another area.
const guest = { x: 100, y: 0, health: 50, areaId: 'cave' };
reg.registerPlayer(guest, { playerId: 'guest-1' });
assert.equal(reg.idOf(guest), 'guest-1');
assert.equal(reg.isLocalPlayer(guest), false);
assert.equal(reg.getLocalPlayer(), local, 'registering a remote player does not steal local');
assert.equal(reg.playerCount(), 2);
assert.equal(reg.nearestPlayer(90, 0), guest, 'unfiltered nearest');
assert.equal(reg.nearestPlayer(90, 0, { areaId: 'town' }), local, 'area filter prefers same-area player');
assert.equal(reg.nearestPlayer(90, 0, { areaId: 'cave' }), guest);
assert.equal(reg.nearestPlayer(90, 0, { areaId: 'mine', strict: true }), null, 'strict: nobody in that area');
assert.equal(reg.nearestPlayer(90, 0, { areaId: 'mine' }), guest, 'non-strict falls back to nearest anywhere');
guest.health = 0;
assert.equal(reg.nearestPlayer(90, 0, { aliveOnly: true }), local);
guest.health = 50;
assert.deepEqual(Array.from(reg.playersInArea('cave')), [guest]);

// Occupied areas: every zone with a player in it must be kept alive by the host.
{
  const occ = Array.from(reg.occupiedAreas()).sort();
  assert.deepEqual(occ, ['cave', 'town'], 'local avatar (town, via the game) + guest (cave)');
  guest.areaId = 'town';
  assert.deepEqual(Array.from(reg.occupiedAreas()), ['town'], 'two players in one area occupy it once');
  guest.areaId = 'cave';
  const nowhere = { x: 0, y: 0, health: 1 };
  reg.registerPlayer(nowhere, { playerId: 'ghost' });
  assert.equal(reg.occupiedAreas().has(undefined) || reg.occupiedAreas().has(null), false, 'a player with no known area occupies nothing');
  reg.unregisterPlayer(nowhere);
}

// Ownership: companion master / projectile owner resolve to a player.
assert.equal(reg.ownerPlayerOf({ master: guest }), guest);
assert.equal(reg.ownerPlayerOf({ owner: local }), local);
assert.equal(reg.ownerPlayerOf({ master: { x: 0 } }), null, 'NPC-owned companion has no owning player');

// Cap.
for (let i = 0; i < 6; i++) reg.registerPlayer({ x: 0, y: 0, health: 1 });
assert.equal(reg.playerCount(), reg.MAX_PLAYERS, 'four-player cap');
for (const p of Array.from(reg.getPlayers())) if (p !== local && p !== guest) reg.unregisterPlayer(p);
assert.equal(reg.playerCount(), 2);

// --- DamageAuthority: routes by the actual victim.
const calls = [];
dmg.init({
  damageLocalPlayer: (...a) => { calls.push(['local', ...a]); return 'L'; },
  damageCreature: (...a) => { calls.push(['creature', ...a]); return 'C'; },
});
const wolf = { x: 5, y: 5, health: 10 };
reg.assignId(wolf, 'hostile');
const opts = { attacker: wolf, tag: 'sharp' };

assert.equal(dmg.hit(local, 7, 1, 2, 30, opts), 'L');
assert.deepEqual(calls.pop(), ['local', 7, 1, 2, 30, opts]);

assert.equal(dmg.hit(guest, 9, 1, 2, 30, opts), undefined, 'no remote handler: unhandled');
assert.equal(calls.length, 0, 'a hit on a remote player must never damage the local player');
assert.equal(dmg.getRecent().pop().outcome, 'unhandled');

const forwarded = [];
dmg.setRemotePlayerHandler((target, amount) => { forwarded.push([reg.idOf(target), amount]); return 'R'; });
assert.equal(dmg.hit(guest, 9, 1, 2, 30, opts), 'R');
assert.deepEqual(forwarded, [['guest-1', 9]]);
assert.equal(calls.length, 0);

const companion = { x: 1, y: 1, health: 5 };
assert.equal(dmg.hit(companion, 3, 0, 0, 0, {}), 'C');
assert.equal(calls.pop()[0], 'creature');

// Event stream carries stable ids for a future host broadcast.
const seen = [];
dmg.onHit(ev => seen.push(ev));
dmg.hit(local, 4, 0, 0, 0, opts);
assert.equal(seen[0].attackerId, reg.idOf(wolf));
assert.equal(seen[0].targetId, localId);
assert.equal(seen[0].amount, 4);
assert.equal(dmg.hit(null, 1, 0, 0, 0, {}), undefined);

console.log('multiplayer foundation tests passed');
