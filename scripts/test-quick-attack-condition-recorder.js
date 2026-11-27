#!/usr/bin/env node
'use strict';

// Runs the real recorder module against a stub Combat evaluator: groups, episode counting,
// the frame-scheduler subscription and the threshold suggestion that matches "behind".
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

let nowMs = 0;
let frameCb = null;
let unregistered = false;
const player = { id: 'player', x: 0, y: 0, health: 100, maxHealth: 100 };
const enemies = [
  { id: 'bandit_grunt_1', x: 10, y: 0, health: 100, maxHealth: 100, stamina: 100, maxStamina: 100, areaId: 'a' },
  { id: 'bandit_grunt_2', x: 20, y: 0, health: 50, maxHealth: 100, stamina: 100, maxStamina: 100, areaId: 'a', tribeId: 'porakaneki' },
  { id: 'far_away', x: 99999, y: 0, health: 100, maxHealth: 100, stamina: 100, maxStamina: 100, areaId: 'a' },
];
const window = {
  SimClock: { now: () => nowMs },
  ActorRegistry: { getLocalPlayer: () => player },
  RuntimeFrameScheduler: { register(id, cb, opts) { assert.equal(opts.phase, 'post-game'); frameCb = cb; return () => { unregistered = true; frameCb = null; }; } },
  Combat: {
    quickAttackData: { OPPORTUNITY_GRACE_S: 3 },
    deps: { TILE: 32, hostileObjects: new Set(enemies), getCurrentArea: () => 'a' },
    // enemy 1 is "behind" half the time; enemy 2 has low health (<=0.3 never), counter window open for 1 of every 4 frames.
    getQuickAttackConditions(deps, c) {
      const frame = Math.floor(nowMs / 100);
      return { behind: c.id === 'bandit_grunt_1' && frame % 2 === 0, enemyStriking: c.tribeId && frame % 4 === 0, exhausted: false, lowHealth: false };
    },
  },
};
const document = { readyState: 'complete', getElementById: () => null, addEventListener() {} };
vm.runInNewContext(fs.readFileSync('docs/js/combat/quick-attack-condition-recorder.js', 'utf8'),
  { window, document, console, Math, Number, Object, Array, Set, Map, JSON, String, Date, performance: { now: () => nowMs }, navigator: {} },
  { filename: 'quick-attack-condition-recorder.js' });

const rec = window.QuickAttackConditionRecorder;
assert.equal(rec.isRecording(), false);
assert.equal(rec.start(), true);
assert.equal(rec.start(), false, 'cannot start twice');
for (let i = 0; i < 100; i++) { nowMs += 100; frameCb(); }
const report = rec.stop();
assert.equal(unregistered, true, 'stop() releases the scheduler subscription');
assert.equal(rec.isRecording(), false);
assert.deepEqual(Object.keys(report.groups).sort(), ['bandit', 'porakaneki'], 'enemies are grouped by tribe/bandit and far enemies are ignored');
const bandit = report.groups.bandit;
assert.equal(bandit.conditions.behind.activePct, 50, 'behind was true on alternate frames');
assert.ok(bandit.conditions.behind.episodes >= 49 && bandit.conditions.behind.episodes <= 50, 'each alternate-frame opening is one episode');
assert.equal(report.groups.porakaneki.conditions.enemyStriking.activePct, 25);
assert.equal(bandit.sample.length, 1);
// Enemy 1 spent all its time at full Health, so no Health threshold below 100% can reach a 50% benchmark.
assert.equal(bandit.suggested.benchmarkBehindPct, 50);
assert.equal(bandit.suggested.lowHealthHpAtMost, 1, 'suggestion is capped at 100% and never exceeds it');
// Enemy 2 sat at 50% Health, so its group needs HP<=0.5 to be low-health as often as its (0%) benchmark -> no suggestion.
assert.equal(report.groups.porakaneki.suggested.lowHealthHpAtMost, null);
const text = rec.formatReport(report);
assert.match(text, /QUICK ATTACK CONDITION RECORDING/);
assert.match(text, /not reachable within/);
assert.equal(rec.stop(), null, 'stopping while idle is a no-op');
console.log('quick attack condition recorder tests passed');
