#!/usr/bin/env node
'use strict';
// RemotePlayerAvatar lifecycle with a stubbed walker factory: a body exists only while the
// remote player is in the area this client shows, mirrors the entity, and is always disposed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

let nowMs = 1000;
const ctx = { window: {}, performance: { now: () => nowMs }, console };
vm.createContext(ctx);
for (const f of ['actor-registry', 'remote-player-avatar']) vm.runInContext(read(`docs/js/${f}.js`), ctx);
const w = ctx.window, reg = w.ActorRegistry, avatar = w.RemotePlayerAvatar;

let area = 'town', built = [], disposed = [], releaseBuild = null;
const makeWalker = () => {
  const root = { position: { x: 0, y: 0, z: 0 }, rotation: { y: 0 }, parent: null, visible: true };
  const scene = { add(r) { r.parent = scene; } };
  root.parent = scene;
  return { root, rot: 0, rec: {}, legsDt: [], legs: { update(dt, speed) { this.last = { dt, speed }; } },
    applyFacingDeadzone(raw) { this.rot = raw; }, _tickFootsteps() {} };
};
avatar.init({
  TILE: 64,
  getCurrentArea: () => area,
  npcSurfaceY: () => 0.5,
  getActiveScene: () => ({ add(r) { r.parent = this; } }),
  getLocalProfile: () => ({ appearance: { speciesId: 'x' }, equippedCosmetics: [], appliedDyes: {} }),
  makeNpcWalker: async rec => { const wk = makeWalker(); wk.rec = rec; built.push(rec.id); if (releaseBuild) await releaseBuild; return wk; },
  despawnWalker: (wk, allow) => { assert.equal(allow, true); disposed.push(wk.rec.id); },
});

const local = { x: 0, y: 0, health: 100 };
reg.registerPlayer(local, { local: true }); reg.setLocalAreaResolver(() => area);
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

(async () => {
  avatar.sync();
  assert.equal(built.length, 0, 'no remote players: nothing built');

  const guest = { x: 128, y: 192, angle: Math.PI / 2, health: 100, areaId: 'cave' };
  reg.registerPlayer(guest, { playerId: 'g1' });
  avatar.sync(); await flush();
  assert.equal(built.length, 0, 'a guest in another area gets no body here');

  guest.areaId = 'town';
  avatar.sync(); await flush();
  assert.deepEqual(built, ['__remote_player_g1']);
  assert.equal(avatar.has(guest), true);
  assert.equal(avatar.debug()[0].built, true);
  avatar.sync(); await flush();
  assert.equal(built.length, 1, 'built once');

  // Mirrors the entity: position in tiles, surface height, facing, gait from real speed.
  const walker = avatar.getWalker(guest);
  avatar.update(1 / 30);
  assert.deepEqual([walker.root.position.x, walker.root.position.z, walker.root.position.y], [2, 3, 0.5]);
  assert.equal(walker.rot, -Math.PI / 2 + Math.PI / 2, 'angle pi/2 (facing +z) maps through the NPC facing rule');
  guest.x += 64 / 3; // ~0.33 tile in 1/30 s = 10 tiles/s raw, smoothed
  for (let i = 0; i < 20; i++) { avatar.update(1 / 30); guest.x += 64 / 30 * 2.5; }
  assert.ok(walker.legs.last.speed > 1, 'feet animate while moving');
  for (let i = 0; i < 40; i++) avatar.update(1 / 30);
  assert.equal(walker.legs.last.speed, 0, 'and stop when the entity stops');

  // Leaving the area removes the body; returning rebuilds it.
  guest.areaId = 'cave'; avatar.sync();
  assert.deepEqual(disposed, ['__remote_player_g1']);
  assert.equal(avatar.has(guest), false);
  guest.areaId = 'town'; avatar.sync(); await flush();
  assert.equal(built.length, 2);

  // This client changing area disposes bodies that belong to the old one.
  area = 'forest'; avatar.sync();
  assert.equal(disposed.length, 2, 'body from the previous area is removed');
  area = 'town';

  // Stale build: the player leaves while the portrait is still rendering -> the late walker is disposed.
  let release; releaseBuild = new Promise(r => { release = r; });
  avatar.sync(); await flush();
  assert.equal(built.length, 3);
  guest.areaId = 'cave'; avatar.sync();
  release(); releaseBuild = null; await flush();
  assert.equal(avatar.has(guest), false);
  assert.equal(disposed.length, 3, 'a build that finishes after the player left is disposed, not leaked');

  // Leaving the session disposes everything.
  guest.areaId = 'town'; avatar.sync(); await flush();
  const before = disposed.length;
  reg.unregisterPlayer(guest); avatar.sync();
  assert.equal(disposed.length, before + 1);
  assert.equal(avatar.debug().length, 0);
  console.log('remote player avatar tests passed');
})().catch(e => { console.error(e); process.exit(1); });
