#!/usr/bin/env node
'use strict';

// Exercises the actual Festival Test functions with an in-memory save store.
// Separate from the pure reward-merge test: checks the time-jump/restore
// transaction, checkbox behavior, restart, and interrupted-reload recovery.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../docs/js/quick-save.js'), 'utf8');
const start = source.indexOf('  function festivalPrefs()');
const end = source.indexOf('  // ── Quick load ─', start);
assert.ok(start > 0 && end > start, 'Festival Test must stay in quick-save.js');

const clone = value => JSON.parse(JSON.stringify(value)); // Used by each mock snapshot to enforce copy isolation.
const sessionData = new Map(); // Models the tab-local sessionStorage JSON envelope.
const savedSlots = new Map(); // Models IndexedDB slots used by QuickSave.
const loads = []; // Asserts which full-world snapshot is scheduled for boot.
let resumeCount = 0; // Verifies autosave is resumed after restoration.
let settleCount = 0; // Verifies pending Festival Fun is paid only on opted-in exit.
let flushError = false; // Simulates a failed live-save capture.

const initial = {
  id: 'baseline', label: 'Before festival', pinned: true, exact: {
    area: 'town', x: 15, y: 20, calendar: { day: 110, time01: 0.2 },
  },
  snapshot: { meta: {
    characters: [{ id: 'farmer', gearInventory: { clothingItems: [], knownMetalArmorBlueprints: [] } }],
    worlds: [{ id: 'world', calendar: { day: 110, time01: 0.2 }, lastDay: 110, lastSeason: 'Stormtide',
      members: { farmer: { nonGearInventory: { gold: 200 }, packClothing: [],
        npcRelationships: { pahu: { favor: 5 } }, cookingState: { qualityBuckets: {} },
        festivals: { claims: { '1155:gorkunash': { potluck: true } },
          festivalFunEarned: { '1155:gorkunash:pahu': 20 },
          festivalFunPaid: { '1155:gorkunash:pahu': 4 }, festivalMealPortions: {},
          festivalFun: { pahu: 12 }, funDay: 1154 * 336 + 110 },
      } },
    }],
  }, farmLayouts: { world: { plots: [1, 2] } } },
};
savedSlots.set('baseline', clone(initial));

const context = vm.createContext({
  window: {
    __hobunjiGameStarted: true,
    CalendarSystem: {
      getHour: t => 6 + 16 * t,
      aotYearNumber: () => 1154,
      absDayForMonthStart: (year, monthIdx) => 1 - 84 + (year - 1154) * 336 + monthIdx * 28,
      dayOfYear: day => ((day + 83) % 336) + 1,
      seasonForDay: () => ({ name: 'Longpour' }),
    },
    FestivalCalendar: {
      get: id => id === 'gorkunash' ? { id, name: 'Gorkunash', month: 5, day: 8 } : null,
    },
    HobunjiAutosavePause: { isPaused: () => false, resume: () => { resumeCount++; } },
    FestivalSystem: { settleTestRewards: () => { settleCount++; } },
    HobunjiSaveSnapshot: { capture: () => clone(testedSnapshot) },
  },
  deps: { flushAll: () => flushError ? { ok: false, error: 'disk full' } : { ok: true } },
  activeIds: () => ({ characterId: 'farmer', worldId: 'world' }),
  readSession: key => sessionData.has(key) ? clone(sessionData.get(key)) : null,
  writeSession: (key, value) => { if (value == null) sessionData.delete(key); else sessionData.set(key, clone(value)); return true; },
  getSlot: async id => clone(savedSlots.get(id) || null),
  putSlot: async slot => { savedSlots.set(slot.id, clone(slot)); },
  deleteSlot: async id => { savedSlots.delete(id); },
  quickSave: async () => ({ ok: true, slot: { id: 'baseline' } }),
  quickLoad: async id => { loads.push(id); return { ok: true, slot: { id } }; },
});
let testedSnapshot = clone(initial.snapshot); // Captures changed working state during a simulated festival exit.
vm.runInContext(source.slice(start, end), context, { filename: 'quick-save-festival-session.js' });

(async () => {
  assert.equal(context.festivalStatus().keepRewards, false, 'opt-in must default OFF');
  const started = await context.startFestivalTest();
  assert.equal(started.ok, true);
  const session = context.festivalTestSession();
  const preview = savedSlots.get(session.previewSlotId);
  assert.equal(preview.snapshot.meta.worlds[0].calendar.day, 372, 'festival preview uses the next opening date');
  assert.equal(preview.snapshot.meta.worlds[0].lastDay, 372, 'previous daily rollover pointer is neutralized');
  assert.equal(preview.snapshot.meta.worlds[0].calendar.time01, 9 / 16, 'festival begins at 3 PM');
  assert.ok(!preview.snapshot.meta.worlds[0].members.farmer.festivals.claims['1155:gorkunash'],
    'preview removes prior event claims');
  assert.deepEqual(savedSlots.get('baseline'), initial, 'the original Quick Save is never changed');

  session.phase = 'active';
  session.journal.favor.pahu = 4;
  context.writeFestivalSession('hobunjiFestivalTestSession.v1', session);
  const restarted = await context.restartFestivalTest();
  assert.equal(restarted.ok, true);
  assert.deepEqual(context.festivalTestSession().journal, { favor: {}, items: [], masks: [] },
    'restart must discard the prior run\'s reward journal');
  assert.equal(context.festivalTestSession().phase, 'starting');

  const active = context.festivalTestSession();
  active.phase = 'active';
  context.writeFestivalSession('hobunjiFestivalTestSession.v1', active);
  const failed = { ...active };
  flushError = true;
  context.setFestivalPrefs({ keepRewards: true });
  const resultFailed = await context.exitFestivalTest();
  assert.equal(resultFailed.ok, false, 'a failed save capture must prevent a reward restore');
  assert.equal(context.festivalTestSession().phase, 'active', 'failed exit leaves the playable test running');
  flushError = false;

  testedSnapshot = clone(preview.snapshot);
  testedSnapshot.meta.worlds[0].members.farmer.nonGearInventory.gold = 999;
  testedSnapshot.meta.worlds[0].members.farmer.npcRelationships.pahu.favor = 100;
  const earning = context.festivalTestSession();
  earning.journal.favor.pahu = 5;
  context.writeFestivalSession('hobunjiFestivalTestSession.v1', earning);
  const exit = await context.exitFestivalTest();
  assert.equal(exit.ok, true);
  assert.ok(settleCount > 0, 'opted-in exit must settle unconverted festival rewards');
  const returning = context.festivalTestSession();
  assert.equal(returning.phase, 'returning');
  const ret = savedSlots.get(returning.returnSlotId);
  assert.equal(ret.snapshot.meta.worlds[0].calendar.day, 110);
  assert.equal(ret.snapshot.meta.worlds[0].members.farmer.nonGearInventory.gold, 200,
    'unrelated item changes never cross the sandbox');
  assert.equal(ret.snapshot.meta.worlds[0].members.farmer.npcRelationships.pahu.favor, 10);

  returning.phase = 'restored';
  context.writeFestivalSession('hobunjiFestivalTestSession.v1', returning);
  assert.equal(await context.finishFestivalReturn({ characterId: 'farmer', worldId: 'world' }), true);
  assert.equal(context.festivalStatus().phase, 'idle');
  assert.equal(resumeCount, 1, 'autosave resumes only after the original world is active');
  assert.ok(savedSlots.has('baseline'), 'the pinned manual recovery snapshot survives completion');
  assert.ok(!savedSlots.has(returning.previewSlotId), 'temporary preview slot is removed');

  context.setFestivalPrefs({ keepRewards: false });
  await context.startFestivalTest();
  const noRewards = context.festivalTestSession();
  noRewards.phase = 'active';
  context.writeFestivalSession('hobunjiFestivalTestSession.v1', noRewards);
  testedSnapshot.meta.worlds[0].members.farmer.nonGearInventory.gold = 100000;
  const unchecked = await context.exitFestivalTest();
  assert.equal(unchecked.ok, true);
  const clean = savedSlots.get(context.festivalTestSession().returnSlotId);
  assert.deepEqual(clean.snapshot, initial.snapshot, 'unchecked exits restore the exact original state');
  assert.equal(settleCount, 2, 'unchecked exit must NOT settle any additional festival rewards');

  const recover = context.festivalTestSession();
  recover.phase = 'starting';
  context.writeFestivalSession('hobunjiFestivalTestSession.v1', recover);
  const recoverResult = await context.recoverFestivalTest();
  assert.equal(recoverResult.ok, true, 'interrupted festival load can recover its pinned original');
  assert.equal(context.festivalTestSession().phase, 'recovering');
  assert.equal(loads.at(-1), 'baseline');

  assert.match(fs.readFileSync(path.resolve(__dirname, '../docs/js/folder-save-primary.js'), 'utf8'),
    /resumeFestivalAutoPlay\?\.\(\)/, 'sandbox refresh must be able to auto-resume the same character');
  console.log('test-dev-festival-test-session: ok');
})().catch(error => { console.error(error); process.exitCode = 1; });
