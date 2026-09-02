#!/usr/bin/env node
'use strict';

// Unit tests for js/npc-agenda.js — the pure daypart/window/jitter/
// eligibility logic underneath the NPC Agenda + Activity Planner redesign.
// No DOM/THREE/game state involved, so this loads the module in isolation
// (same vm.runInNewContext pattern scripts/test-npc-schedule-overrides.js
// already uses for a browser-global-style IIFE file).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const sandbox = { window: {}, console };
vm.runInNewContext(fs.readFileSync('docs/js/npc-agenda.js', 'utf8'), sandbox, { filename: 'npc-agenda.js' });
const Agenda = sandbox.window.NpcAgenda;
assert.equal(typeof Agenda, 'object', 'window.NpcAgenda is exported');
// Objects built inside the vm sandbox are plain objects from a *different*
// V8 realm — deepEqual (aliased to deepStrictEqual under node:assert/strict)
// treats that as "not the same prototype" and fails even when every field
// matches. Round-tripping through JSON strips the foreign realm, same fix
// scripts/test-npc-schedule-overrides.js already uses for the same reason.
const plain = x => JSON.parse(JSON.stringify(x));

// ── obligation weighting ────────────────────────────────────────────────
assert(Agenda.obligationWeight('critical') > Agenda.obligationWeight('duty'), 'critical outweighs duty');
assert(Agenda.obligationWeight('duty') > Agenda.obligationWeight('plan'), 'duty outweighs plan');
assert(Agenda.obligationWeight('plan') > Agenda.obligationWeight('leisure'), 'plan outweighs leisure');
assert.equal(Agenda.obligationWeight('not-a-real-level'), Agenda.obligationWeight('plan'), 'unknown obligation falls back to plan-equivalent weight, not zero/NaN');

// ── dailySeed determinism ───────────────────────────────────────────────
const s1 = Agenda.dailySeed('kzubug', 14, 'work:dur');
const s2 = Agenda.dailySeed('kzubug', 14, 'work:dur');
assert.equal(s1, s2, 'dailySeed is pure — same (npc,day,salt) always gives the same answer');
assert(s1 >= 0 && s1 < 1, 'dailySeed is a [0,1) fraction');
assert.notEqual(Agenda.dailySeed('kzubug', 14, 'work:dur'), Agenda.dailySeed('kzubug', 15, 'work:dur'), 'different day usually changes the seed');
assert.notEqual(Agenda.dailySeed('kzubug', 14, 'work:dur'), Agenda.dailySeed('sloomi', 14, 'work:dur'), 'different NPC usually changes the seed');
assert.notEqual(Agenda.dailySeed('kzubug', 14, 'work:dur'), Agenda.dailySeed('kzubug', 14, 'work:start'), 'different salt usually changes the seed (independent jitter draws)');

// ── exact windows: no daily variation authored → returned unchanged ────
{
  const beat = { id: 'work', window: ['08:00', '16:00'] };
  const win = Agenda.resolveBeatWindow(beat, { npcId: 'x', day: 1 });
  assert.deepEqual(plain(win), { startMin: 480, endMin: 960 }, 'exact window with no duration/jitter is returned exactly, every day');
  const win2 = Agenda.resolveBeatWindow(beat, { npcId: 'x', day: 99 });
  assert.deepEqual(plain(win2), plain(win), 'still exact on a different day — authors relying on exact hours (e.g. shop hours) see no drift');
}

// ── dayparts: single name and [from,to] range ───────────────────────────
{
  const morning = Agenda.daypartRange('morning');
  assert.deepEqual(plain(morning), { id: 'morning', startMin: 420, endMin: 660 }, 'morning is 07:00-11:00');
  const beatSingle = { id: 'chores', daypart: 'morning' };
  assert.deepEqual(plain(Agenda.resolveBeatWindow(beatSingle, { npcId: 'x', day: 1 })), { startMin: 420, endMin: 660 });
  const beatRange = { id: 'work', daypart: ['morning', 'afternoon'] };
  assert.deepEqual(plain(Agenda.resolveBeatWindow(beatRange, { npcId: 'x', day: 1 })), { startMin: 420, endMin: 1020 }, 'morning->afternoon spans 07:00-17:00 (design doc §6/§7 example)');
}

// ── daily variation: duration range stays inside the outer window ──────
{
  const beat = { id: 'work', daypart: ['morning', 'afternoon'], duration: ['4h', '6h'] };
  const seenStarts = new Set();
  for (let day = 1; day <= 60; day++) {
    const win = Agenda.resolveBeatWindow(beat, { npcId: 'kzubug', day });
    const outer = Agenda.daypartRange('morning');
    const outerEnd = Agenda.daypartRange('afternoon').endMin;
    assert(win.startMin >= outer.startMin - 1, `day ${day}: jittered start ${win.startMin} isn't before the outer window`);
    let duration = win.endMin - win.startMin;
    if (duration < 0) duration += 1440;
    assert(duration >= 239 && duration <= 361, `day ${day}: duration ${duration}min should be ~4-6h (allowing rounding)`);
    assert(win.endMin <= outerEnd + 1 || win.endMin < win.startMin, `day ${day}: jittered end ${win.endMin} stays inside the outer 07:00-17:00 span`);
    seenStarts.add(win.startMin);
  }
  assert(seenStarts.size > 5, 'daily variation actually varies across many days rather than collapsing to one constant time');
  const winA = Agenda.resolveBeatWindow(beat, { npcId: 'kzubug', day: 14 });
  const winB = Agenda.resolveBeatWindow(beat, { npcId: 'kzubug', day: 14 });
  assert.deepEqual(plain(winA), plain(winB), 'the same NPC+day always jitters to the same window (deterministic, not random-per-call)');
}

// ── overnight wrap ───────────────────────────────────────────────────────
assert.equal(Agenda.isWithinWindow(23 * 60, 22 * 60, 6 * 60), true, '23:00 is within an overnight 22:00-06:00 window');
assert.equal(Agenda.isWithinWindow(3 * 60, 22 * 60, 6 * 60), true, '03:00 is within an overnight 22:00-06:00 window');
assert.equal(Agenda.isWithinWindow(12 * 60, 22 * 60, 6 * 60), false, 'noon is not within an overnight 22:00-06:00 window');

// ── day/days/daysExcept filtering ───────────────────────────────────────
assert.equal(Agenda.isBeatActiveOnDay({ day: 'Naru' }, 'Naru'), true);
assert.equal(Agenda.isBeatActiveOnDay({ day: 'Naru' }, 'Uung'), false);
assert.equal(Agenda.isBeatActiveOnDay({ days: ['Naru', 'Uung'] }, 'Uung'), true);
assert.equal(Agenda.isBeatActiveOnDay({ daysExcept: ['Tothu'] }, 'Tothu'), false);
assert.equal(Agenda.isBeatActiveOnDay({ daysExcept: ['Tothu'] }, 'Anan'), true);
assert.equal(Agenda.isBeatActiveOnDay({}, 'Anan'), true, 'no day filter at all runs every day');

// ── isBeatActiveNow combines day + window, and alwaysEligible bypasses window ──
{
  const beat = Agenda.normalizeAgendaBeat({ activity: 'work', window: ['08:00', '16:00'], days: ['Anan'] }, 0);
  assert.equal(Agenda.isBeatActiveNow(beat, { npcId: 'x', day: 1, weekdayName: 'Anan', nowMin: 600 }), true);
  assert.equal(Agenda.isBeatActiveNow(beat, { npcId: 'x', day: 1, weekdayName: 'Uung', nowMin: 600 }), false, 'wrong weekday');
  assert.equal(Agenda.isBeatActiveNow(beat, { npcId: 'x', day: 1, weekdayName: 'Anan', nowMin: 100 }), false, 'outside window');
  const always = { id: 'legacy', activity: 'legacyScheduleActivity', obligation: 'duty', alwaysEligible: true };
  assert.equal(Agenda.isBeatActiveNow(always, { npcId: 'x', day: 1, weekdayName: 'Uung', nowMin: 0 }), true, 'alwaysEligible ignores day/window entirely');
}

// ── pickEligibleBeats: obligation-weight ordering, ties keep authoring order ──
{
  const beats = [
    { id: 'leisure-first', activity: 'wander', obligation: 'leisure', window: ['00:00', '23:59'] },
    { id: 'duty-1', activity: 'work', obligation: 'duty', window: ['00:00', '23:59'] },
    { id: 'plan-1', activity: 'eat', obligation: 'plan', window: ['00:00', '23:59'] },
    { id: 'duty-2', activity: 'work', obligation: 'duty', window: ['00:00', '23:59'] },
    { id: 'not-eligible', activity: 'work', obligation: 'critical', window: ['01:00', '02:00'] },
  ];
  const eligible = Agenda.pickEligibleBeats(beats, { npcId: 'x', day: 1, weekdayName: 'Anan', nowMin: 600 });
  assert.deepEqual(plain(eligible.map(b => b.id)), ['duty-1', 'duty-2', 'plan-1', 'leisure-first'], 'highest obligation first, ties keep authoring order, time-ineligible beats excluded');
}

console.log('npc agenda tests passed');
