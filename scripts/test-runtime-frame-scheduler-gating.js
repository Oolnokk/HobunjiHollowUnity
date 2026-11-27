#!/usr/bin/env node
'use strict';
// Executes the real scheduler to prove opt-in cadence (everyMs) and perception (when) gating.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const frames = new Map(); let handle = 0;
const errors = [];
const context = { window: {}, console: { error: (...a) => errors.push(a) }, performance: { now: () => 0 },
  requestAnimationFrame(cb) { frames.set(++handle, cb); return handle; }, cancelAnimationFrame(id) { frames.delete(id); } };
vm.runInNewContext(fs.readFileSync('docs/js/runtime-frame-scheduler.js', 'utf8'), context, { filename: 'runtime-frame-scheduler.js' });
const S = context.window.RuntimeFrameScheduler;
let t = 0;
const frame = ms => { t += ms; const [id, cb] = [...frames][0]; frames.delete(id); cb(t); };

const counts = { every: 0, plain: 0, gated: 0, bad: 0 }; let visible = false; const since = [];
S.register('plain', () => counts.plain++);
S.register('every', ctx => { counts.every++; since.push(ctx.sinceLastRunMs); }, { everyMs: 100 });
S.register('gated', () => counts.gated++, { when: () => visible });
S.register('bad-gate', () => counts.bad++, { when: () => { throw new Error('gate broke'); } });

for (let i = 0; i < 30; i++) frame(16); // 480 ms of 16 ms frames.
assert.equal(counts.plain, 30, 'default subscribers still run every browser frame');
assert.ok(counts.every >= 4 && counts.every <= 6, 'everyMs:100 runs about every 100 ms, got ' + counts.every);
assert.ok(since.slice(1).every(ms => ms >= 100 && ms < 120), 'sinceLastRunMs reports accumulated time: ' + since);
assert.equal(counts.gated, 0, 'when() false skips the callback');
assert.equal(counts.bad, 30, 'a throwing when() fails open so the runtime keeps running');
visible = true; frame(16);
assert.equal(counts.gated, 1, 'when() true runs it again on the next frame');
const dbg = Object.fromEntries(S.getDebug().entries.map(e => [e.id, e]));
assert.equal(dbg.gated.skippedCalls, 30); assert.equal(dbg.every.everyMs, 100);
assert.equal(dbg.plain.skippedCalls, 0);
S.register('gated', () => counts.gated++, { everyMs: 50 }); // Re-registration keeps the earlier when() unless replaced.
console.log('runtime frame scheduler gating passed');
