#!/usr/bin/env node
'use strict';
// Simulation LOD must measure distance to the NEAREST player (in the entity's
// area), not just the local one: a bandit beside a guest stays awake on the host.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const TILE = 64;
let updateBanners = () => {};
const banditCamps = { init() {}, updateCampBanners: dt => updateBanners(dt) };
const ctx = { window: { BanditCamps: banditCamps }, performance: { now: () => 0 }, console };
vm.createContext(ctx);
for (const f of ['actor-registry', 'entity-distance-lod', 'wilderness-simulation-lod']) vm.runInContext(read(`docs/js/${f}.js`), ctx);
const reg = ctx.window.ActorRegistry;

const local = { x: 0, y: 0, health: 100 };
reg.registerPlayer(local, { local: true });
reg.setLocalAreaResolver(() => 'wild');
const bandit = { isBandit: true, health: 10, state: 'idle', areaId: 'wild', x: 30 * TILE, y: 0, avatarRef: null };
const hostileObjects = [bandit];
banditCamps.init({ hostileObjects, TILE, player: local, getCurrentArea: () => 'wild' });
const sleeping = () => !!bandit._wildernessLodSleeping;
const tick = () => banditCamps.updateCampBanners(1);

tick();
assert.equal(sleeping(), true, 'single player: a bandit 30 tiles away sleeps (unchanged behaviour)');

const guest = { x: 28 * TILE, y: 0, health: 100, areaId: 'wild' };
reg.registerPlayer(guest, { playerId: 'guest-1' });
tick();
assert.equal(sleeping(), false, 'a guest 2 tiles away wakes the camp even though the host is far');

guest.areaId = 'cave'; // guest walks into another zone: it no longer keeps this camp awake
tick();
assert.equal(sleeping(), true, 'a player in a different area does not hold the camp awake');

assert.equal(reg.distanceToNearestPlayer(0, 0), 0);
assert.equal(reg.distanceToNearestPlayer(5, 0, { areaId: 'nowhere', strict: true }), Infinity);
console.log('simulation LOD multiplayer tests passed');
