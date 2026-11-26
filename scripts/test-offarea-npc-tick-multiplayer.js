#!/usr/bin/env node
'use strict';
// "Off-area" means off EVERY player's area: an NPC in a zone where a guest stands keeps
// per-frame updates, and goes back to coarse ticking once the guest leaves.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const ctx = { window: { location: { search: '?offAreaNpcTick=1' } }, performance: { now: () => 0 }, console, URLSearchParams };
vm.createContext(ctx);
for (const f of ['actor-registry', 'offarea-npc-tick']) vm.runInContext(read(`docs/js/${f}.js`), ctx);
const { ActorRegistry: reg, OffAreaNpcTick: tick } = ctx.window;
let current = 'farm';
tick.init({ getCurrentArea: () => current });
const host = { x: 0, y: 0, health: 100 };
reg.registerPlayer(host, { local: true }); reg.setLocalAreaResolver(() => current);
const npc = () => ({ area: 'cave' });

assert.equal(tick.isEnabled(), true);
assert.equal(tick.eligible(npc()), true, 'single player: an NPC in another area is off-area');
assert.equal(tick.step(npc(), 0.016), null, 'and gets the coarse tick');

const guest = { x: 0, y: 0, health: 100, areaId: 'cave' };
reg.registerPlayer(guest, { playerId: 'guest' });
assert.equal(tick.eligible(npc()), false, 'a guest in the cave: those NPCs are on-screen for them');
const w = npc();
assert.equal(tick.step(w, 0.016), 0.016, 'full-rate update');
guest.areaId = 'town';
assert.equal(tick.eligible(npc()), true, 'guest leaves: coarse ticking resumes');
assert.equal(tick.eligible({ area: 'town' }), false, 'NPCs where the guest now is stay at full rate');
console.log('off-area NPC tick multiplayer tests passed');
