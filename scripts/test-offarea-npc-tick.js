#!/usr/bin/env node
'use strict';
// Executes the real module: opt-in only, coarse for unseen walkers, per-frame for everyone who needs control.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const window = { location: { search: '' } };
vm.runInNewContext(fs.readFileSync('docs/js/offarea-npc-tick.js', 'utf8'), { window, performance: { now: () => 0 }, URLSearchParams });
const T = window.OffAreaNpcTick;
let current = 'town', special = null;
T.init({ getCurrentArea: () => current, isDialogueOrCutsceneWalker: w => w === special });
const sim = (w, frames, dt = 1 / 60) => { let updates = 0, total = 0; for (let i = 0; i < frames; i++) { const d = T.step(w, dt); if (d !== null) { updates++; total += d; } } return { updates, total }; };

let r0;
const inn = { area: 'inn' };
assert.equal(T.isEnabled(), false, 'off by default');
r0 = sim(inn, 60);
assert.equal(r0.updates, 60, 'disabled: every frame');
assert.ok(Math.abs(r0.total - 1) < 1e-9, 'disabled: unchanged dt');

T.setEnabled(true);
let r = sim({ area: 'inn' }, 60);
assert.ok(r.updates >= 3 && r.updates <= 5, 'off-area walker updates ~4 Hz, got ' + r.updates);
assert.ok(Math.abs(r.total - 1) < 0.26, 'skipped time is accumulated, not lost: ' + r.total);
assert.equal(sim({ area: 'town' }, 60).updates, 60, 'same-area walkers update every frame');
for (const [name, w] of Object.entries({
  animal: { area: 'inn', animalDef: {} }, baby: { area: 'inn', _familyBabyFollowing: true }, climb: { area: 'inn', _npcCliffClimb: {} },
  paused: { area: 'inn', pause: Infinity }, threat: { area: 'inn', _wildlifeThreatUntil: 5 }, noArea: { area: '' },
})) assert.equal(sim(w, 30).updates, 30, name + ' keeps per-frame updates');
special = { area: 'inn' };
assert.equal(sim(special, 30).updates, 30, 'dialogue/cutscene walkers keep per-frame updates');
assert.equal(sim({ area: 'inn', _bedLieActive: true }, 60).updates < 10, true, 'sleepers are coarse too');

const mover = { area: 'inn' }; sim(mover, 5); assert.ok(mover._offAreaCoarseDt > 0);
current = 'inn'; assert.equal(T.step(mover, 1 / 60), 1 / 60, 'entering the walker\'s area resumes real dt immediately');
assert.equal(mover._offAreaCoarseDt, 0, 'accumulator cleared on resume');
const big = { area: 'inn' }; current = 'town'; assert.ok(T.step(big, 5) <= 0.5, 'a huge frame is capped');
console.log('off-area npc coarse tick passed');
