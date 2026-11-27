#!/usr/bin/env node
'use strict';
// The co-op time panel: right text for each state, no DOM writes on identical frames,
// and its frame callback only runs while a vote/knockout exists.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

let nowMs = 0, writes = 0;
const mkEl = () => { const el = { children: [], _t: '', style: new Proxy({}, { set(t, k, v) { if (t[k] !== v) writes++; t[k] = v; return true; } }),
  appendChild(c) { this.children.push(c); } };
  Object.defineProperty(el, 'textContent', { get() { return this._t; }, set(v) { if (v !== this._t) writes++; this._t = v; } }); return el; };
const document = { body: mkEl(), createElement: mkEl };
const enabled = {}; const callbacks = {};
const scheduler = { register: (id, cb, o) => { callbacks[id] = cb; enabled[id] = o.enabled !== false; }, setEnabled: (id, v) => { enabled[id] = v; } };
const ctx = { window: { RuntimeFrameScheduler: scheduler }, document, performance: { now: () => nowMs }, console };
vm.createContext(ctx);
for (const f of ['sim-clock', 'actor-registry', 'time-consensus', 'time-consensus-hud']) vm.runInContext(read(`docs/js/${f}.js`), ctx);
const { ActorRegistry: reg, TimeConsensus: tc, TimeConsensusHud: hud } = ctx.window;

const me = { x: 0, y: 0, health: 100 }, friend = { x: 30, y: 0, health: 100, name: 'Mira' };
reg.registerPlayer(me, { local: true }); reg.registerPlayer(friend, { playerId: 'mira' });
const panel = () => document.body.children[0];

assert.equal(hud.describe(tc.snapshot(), reg, tc.REVIVE_WINDOW_MS), null, 'nothing queued: hidden');
assert.equal(enabled.TimeConsensusHud, undefined, 'not registered until the first event');

// Local knocked out.
tc.knockOut(me, { kind: 'blackout', minutes: 60, run() {} });
assert.equal(enabled.TimeConsensusHud, true, 'frame callback is enabled by the event');
callbacks.TimeConsensusHud();
assert.match(panel().children[0].textContent, /Out cold — a friend has 1:00 to revive you/);
assert.equal(panel().style.display, 'block');
const before = writes; callbacks.TimeConsensusHud(); callbacks.TimeConsensusHud();
assert.equal(writes, before, 'identical frames perform no DOM writes');
nowMs += 15000; callbacks.TimeConsensusHud();
assert.match(panel().children[0].textContent, /0:45/);
assert.equal(panel().children[1].children[0].style.width, '75%');

// Revived: hides and stops ticking.
tc.revive(me, friend);
callbacks.TimeConsensusHud();
assert.equal(panel().style.display, 'none');
assert.equal(enabled.TimeConsensusHud, false, 'callback disables itself when nothing is pending');

// Someone else is down: the local player sees who and how long.
tc.knockOut(friend, { kind: 'blackout', minutes: 60, run() {} });
callbacks.TimeConsensusHud();
assert.match(panel().children[0].textContent, /Mira is down — revive them within 1:00/);
tc.revive(friend, me);

// Local resting: waiting count; no progress bar.
tc.requestRest(me, { kind: 'sleep', minutes: 600, run() {} });
callbacks.TimeConsensusHud();
assert.match(panel().children[0].textContent, /Waiting for the others to sleep \(1\/2\)/);
assert.equal(panel().children[1].style.display, 'none');
tc.requestRest(friend, { kind: 'sleep', minutes: 600, run() {} }); // everyone resting -> resolves
callbacks.TimeConsensusHud();
assert.equal(panel().style.display, 'none');
console.log('time consensus HUD tests passed');
