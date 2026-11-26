#!/usr/bin/env node
'use strict';
// Co-op cutscene rules: everyone is paused and watching wherever they are; the controller
// makes the choices; crowd scenes place the other players; time-skip windows are held.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

let nowMs = 1000;
const ctx = { window: {}, performance: { now: () => nowMs }, console };
vm.createContext(ctx);
for (const f of ['sim-clock', 'actor-registry', 'time-consensus', 'damage-authority', 'remote-player-state', 'shared-cutscene']) vm.runInContext(read(`docs/js/${f}.js`), ctx);
const { ActorRegistry: reg, TimeConsensus: tc, SharedCutscene: sc, RemotePlayerState: rps, DamageAuthority: dmg } = ctx.window;
dmg.init({ damageLocalPlayer() {}, damageCreature() {} });
sc.init({ tilePx: 64 });

const host = { x: 0, y: 0, health: 100, maxHealth: 100 };
reg.registerPlayer(host, { local: true });
const events = []; sc.onEvent(e => events.push(e.type));

// Single player: a harmless shell.
sc.begin({ id: 'solo', area: 'town' });
assert.equal(sc.isActive(), true);
assert.equal(sc.isFrozen(host), true);
assert.equal(host._inCutscene, undefined, 'the local avatar is paused by the existing runner, not flagged');
assert.equal(sc.end(), true);
assert.equal(sc.isActive(), false);

// Two guests, in different areas from the scene and from each other.
const g1 = { x: 640, y: 64, health: 100, maxHealth: 100, areaId: 'cave' }, g2 = { x: 64, y: 64, health: 100, maxHealth: 100, areaId: 'farm' };
reg.registerPlayer(g1, { playerId: 'g1' }); reg.registerPlayer(g2, { playerId: 'g2' });

// A pending revive window is held for the length of the scene.
tc.knockOut(g1, { kind: 'blackout', minutes: 60, run() {} });
assert.equal(tc.remainingMs(g1), 60000);

const s = sc.begin({ id: 'announcement', area: 'town', controller: host });
assert.equal(sc.begin({ id: 'inner', area: 'town' }), s, 'a nested scene shares the session');
assert.deepEqual(events.slice(-1), ['begin']);
for (const p of [host, g1, g2]) assert.equal(sc.isParticipant(p), true, 'every player takes part, whatever their area');
assert.equal(sc.viewAreaFor(g1), 'town');
assert.equal(sc.viewAreaFor(g2), 'town', 'each client shows the cutscene area regardless of where its player is');
assert.equal(g1._inCutscene, true);

nowMs += 90000; // far longer than the 60 s window
assert.equal(tc.tick(), null, 'nothing resolves while the scene plays');
assert.equal(tc.isKnockedOut(g1), true);
assert.equal(tc.remainingMs(g1), 60000, 'the window does not drain during the scene');

// Watchers are not targets and cannot be hurt.
assert.equal(reg.nearestPlayer(0, 0, { aliveOnly: true }), host);
dmg.hit(g2, 50, 0, 0, 100, { tag: 'sharp' });
assert.equal(g2.health, 100, 'a watching player cannot be damaged');

// Late joiner watches; leaver is released.
const g3 = { x: 0, y: 0, health: 100, maxHealth: 100, areaId: 'mine' };
reg.registerPlayer(g3, { playerId: 'g3' });
assert.equal(sc.isParticipant(g3), true, 'joining mid-scene means watching');
reg.unregisterPlayer(g3);
assert.equal(sc.isParticipant(g3), false);
assert.equal(g3._inCutscene, false);

// Crowd: the controller is not in the crowd; everyone else is, in slot order.
assert.deepEqual(Array.from(sc.crowdMembers().map(p => reg.idOf(p))), ['g1', 'g2']);
const placed = sc.joinCrowd({ area: 'town', slots: [{ c: 10, r: 20, rotY: 180, pose: 'stand' }, { c: 11, r: 20, rotY: 0, pose: 'sit', seatTarget: { furnitureKey: 'pew', seatIndex: 1 } }] });
assert.equal(placed, 2);
assert.deepEqual([g1.x, g1.y, g1.areaId], [10.5 * 64, 20.5 * 64, 'town']);
assert.ok(Math.abs(g1.angle + Math.PI / 2) < 1e-9, 'rotY 180 faces north');
assert.ok(Math.abs(g2.angle - Math.PI / 2) < 1e-9, 'rotY 0 faces south');
assert.equal(g2._crowdSlot.pose, 'sit');
assert.equal(g2._crowdSlot.seatTarget.seatIndex, 1);
assert.equal(sc.isInCrowd(g1), true);
assert.equal(sc.joinCrowd({ area: 'town', slots: [] }), 0, 'no slots, nobody placed');

// Not enough slots: the extra player just watches (not drawn in the crowd).
sc.end(); assert.equal(sc.isActive(), true, 'inner end only unwinds one level');
assert.equal(sc.end(), true);
assert.equal(sc.isActive(), false);
assert.equal(events.slice(-1)[0], 'end');
assert.deepEqual([g1.x, g1.y, g1.areaId], [640, 64, 'cave'], 'put back exactly where they were');
assert.equal(g1._crowdSlot, null);
assert.equal(g1._inCutscene, false);
assert.equal(sc.isFrozen(g1), false);
assert.equal(tc.isPaused(), false);
assert.equal(tc.isKnockedOut(g1), true, 'still knocked out after the scene, with a fresh full window');
assert.equal(tc.remainingMs(g1), 60000);
nowMs += 59000; tc.tick();
assert.equal(tc.isKnockedOut(g1), true);
nowMs += 2000; tc.tick();
assert.equal(tc.isKnockedOut(g1), false, 'and the skip happens once the held window finally runs out');
console.log('shared cutscene tests passed');
