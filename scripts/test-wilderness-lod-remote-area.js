#!/usr/bin/env node
'use strict';
// Bandit sleep/wake in an area the local player is NOT in (remote-area tick, stage 2): a camp next to a guest
// stays awake, goes to sleep when every player in that area is far away, and wakes when one comes near; the
// per-area cadence keeps the local pass and the remote pass from starving each other.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const TILE = 64;
const banditCamps = { init() {}, updateCampBanners() {} };
const ctx = { window: { BanditCamps: banditCamps }, performance: { now: () => 0 }, console };
vm.createContext(ctx);
for (const f of ['actor-registry', 'entity-distance-lod', 'wilderness-simulation-lod']) vm.runInContext(read(`docs/js/${f}.js`), ctx);
const w = ctx.window, reg = w.ActorRegistry;

let area = 'zone_a'; // what game.js's currentArea is: swapped to the guest's zone during a remote-area tick
let listenerArea = 'zone_a';
reg.setLocalAreaResolver(() => listenerArea);
const local = { x: 0, y: 0, health: 100 };
const guest = { x: 500 * TILE, y: 0, health: 100, areaId: 'zone_b' };
reg.registerPlayer(local, { local: true }); reg.registerPlayer(guest, { playerId: 'guest' });

const bandit = { isBandit: true, health: 10, state: 'idle', areaId: 'zone_b', x: 520 * TILE, y: 0 };
const localBandit = { isBandit: true, health: 10, state: 'idle', areaId: 'zone_a', x: 2 * TILE, y: 0 };
const hostileObjects = [bandit, localBandit];
banditCamps.init({ hostileObjects, TILE, player: local, getCurrentArea: () => area });
const asleep = b => !!b._wildernessLodSleeping;
const scoped = fn => { const saved = area; area = 'zone_b'; try { return fn(); } finally { area = saved; } };
const tickLocal = dt => w.WildernessSimulationLOD.tick(dt);
const tickRemote = dt => scoped(() => w.WildernessSimulationLOD.tick(dt));

// The guest is 20 tiles from the zone_b bandit (outside the 14 wake radius, inside the 18+ sleep band): the first
// remote pass puts it to sleep only if it is at least 18 tiles away.
tickRemote(1);
assert.equal(asleep(bandit), true, 'a zone_b camp whose only player is 20 tiles away sleeps (the local player being near zone_a is irrelevant)');
assert.equal(bandit.areaId.startsWith('__wilderness_lod_sleep__:zone_b'), true, 'parked under its own zone, which the hostile loop then skips');
assert.equal(asleep(localBandit), false, 'a remote pass never touches the local zone\'s bandits');

// The guest walks up to the camp: it wakes.
guest.x = 510 * TILE;
tickRemote(1);
assert.equal(asleep(bandit), false, 'a guest within the wake radius wakes the camp');
assert.equal(bandit.areaId, 'zone_b');

// Per-area cadence: each area has its own 0.25 s accumulator, so the local pass cannot starve (or reset) the remote one.
guest.areaId = 'zone_b';
guest.x = 0;                       // far from the camp: it should go back to sleep on the next due pass...
tickRemote(0.05);                  // ...but 0.05 s is not due yet,
assert.equal(asleep(bandit), false, 'not due yet (cadence is per area)');
tickLocal(1);                      // a local pass in between must not reset the remote accumulator,
assert.equal(asleep(bandit), false, 'a local pass never touches the zone_b camp');
tickRemote(0.25);                  // now the accumulated 0.30 s is due.
assert.equal(asleep(bandit), true, 'the remote pass ran on its own cadence');

// First pass in a brand-new area is immediate.
const lone = { isBandit: true, health: 10, state: 'idle', areaId: 'zone_d', x: 900 * TILE, y: 0 };
hostileObjects.push(lone);
const guestD = { x: 0, y: 0, health: 100, areaId: 'zone_d' };
reg.registerPlayer(guestD, { playerId: 'guestD' });
const savedArea = area; area = 'zone_d'; w.WildernessSimulationLOD.tick(0.01); area = savedArea;
assert.equal(asleep(lone), true, 'the first pass for a new area runs at once (no 0.25 s wait)');

console.log('wilderness LOD remote-area tests passed');
