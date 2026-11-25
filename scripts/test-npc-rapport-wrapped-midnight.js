'use strict';

const assert = require('node:assert/strict'); // Used for deterministic social-day and conversion assertions.
const fs = require('node:fs'); // Used to read the shipped Rapport bridge under test.
const path = require('node:path'); // Used to resolve the repository-relative bridge path.
const vm = require('node:vm'); // Used to execute the browser bridge in a compact runtime-shaped sandbox.

const source = fs.readFileSync(path.join(__dirname, '..', 'docs', 'js', 'npc-social-relationship-bridge-v2.js'), 'utf8'); // Runtime source exercised below.
let rawDay = 5; // Raw 06:00→06:00 simulation day held constant across civil midnight.
let time01 = 0.70; // Pre-midnight normalized clock position.
let wrappedHour = 22.8; // Player-facing 0-23 hour returned by the full-day clock.
let civilDay = 5; // Civil day exposed by CalendarSystem.timeDebugSnapshot().
const states = new Map(); // Minimal NPC relationship store used by DialogueContent.

function stateFor(id) {
  if (!states.has(id)) states.set(id, { favor: 0, rapport: 0, rapportDay: civilDay, lastGiftDay: -1, memory: [] });
  return states.get(id);
}

const dialogue = {
  getNpcDlgState: stateFor,
  npcRelationshipsSnapshot() {
    return Object.fromEntries([...states].map(([id, state]) => [id, { ...state, memory: [...state.memory] }]));
  },
  loadNpcRelationships() {},
};
const gifting = { // Required so the bridge can install its normal daily-gift wrapper.
  getNpcGiftOfferAction() { return { action: 'gift' }; },
  offerGift() { return true; },
};
const windowStub = {
  SCRATCHBONES_CONFIG: { game: {} },
  CalendarSystem: {
    constants: { FULL_DAY_CYCLE: true, DAY_ROLLOVER_HOUR: 6 },
    timeDebugSnapshot: () => ({ rawDay, time01, civilDay }),
    getHour: () => wrappedHour,
  },
  DialogueContent: dialogue,
  NpcGifting: gifting,
  performance: { now: () => 0 },
  addEventListener() {},
  __farmLog() {},
};

vm.runInNewContext(source, { window: windowStub, Math, Date, console, Object, Number, String, Set, Map, JSON });
const rapport = windowStub.NpcRapport; // Installed event-driven Rapport API under test.
assert.equal(rapport?.eventDriven, true, 'Rapport bridge installs');

rapport.adjust('npc_test', 37, 'before_midnight');
assert.equal(stateFor('npc_test').rapport, 37, 'Rapport is retained before midnight');
assert.equal(stateFor('npc_test').favor, 0, 'Favor is unchanged before midnight');
assert.equal(rapport.currentGameDay(), 5, 'pre-midnight civil day is the current social day');

wrappedHour = 0.05;
time01 = 0.752;
civilDay = 6;
rapport.flushRollover();
assert.equal(rapport.currentGameDay(), 6, 'wrapped 00:xx clock uses the new civil day');
assert.equal(stateFor('npc_test').rapport, 0, 'Rapport is cleared immediately on the new civil day');
assert.equal(stateFor('npc_test').favor, 4, '37 Rapport converts with Math.round(37 × 10%) at midnight');
assert.equal(stateFor('npc_test').rapportDay, 6, 'relationship metadata advances at civil midnight rather than raw 06:00 rollover');

// Real gameplay now reads live scalar fields, preserving the old debug
// fallback for test/standalone pages. Prove the modern route needs no report.
Object.assign(windowStub.CalendarSystem,{
  isInitialized:()=>true, getRawDay:()=>rawDay, getRawTime01:()=>time01,
  civilDayForRawDay:()=>civilDay,
  timeDebugSnapshot:()=>{throw new Error('gameplay should not build calendar debug reports');},
});
assert.equal(rapport.currentGameDay(),6);
rapport.adjust('npc_test',21,'live_clock');
wrappedHour=6; time01=0; rawDay=6;
rapport.flushRollover();
assert.equal(rapport.currentGameDay(),6,'morning rollover does not settle twice');
assert.equal(stateFor('npc_test').rapport,21);
wrappedHour=0.01; time01=.751; civilDay=7;
rapport.flushRollover();
assert.equal(stateFor('npc_test').rapport,0);
assert.equal(stateFor('npc_test').favor,6,'same conversion at the following midnight');
const boney={rec:{id:'boney_shinjimi',name:'Boney Shinjimi'}}; // One-night milk exchanges bypass regular per-day gifting.
const resident={rec:{id:'npc_test',name:'Resident'}}; // Ordinary NPCs must retain the daily limit.
assert.equal(gifting.offerGift(boney),true);
assert.equal(gifting.offerGift(boney),true,'a second Boney milk exchange works on the same day');
assert.equal(stateFor('boney_shinjimi').lastGiftDay,-1,'Boney exchanges do not mark daily gift usage');
assert(gifting.getNpcGiftOfferAction(boney),'Boney still has a gift action after the first exchange');
assert.equal(gifting.offerGift(resident),true);
assert.equal(gifting.offerGift(resident),false,'ordinary residents remain daily-limited');
assert.equal(gifting.getNpcGiftOfferAction(resident),null,'ordinary gift action remains hidden after a gift');
console.log('npc Rapport wrapped-midnight regression tests passed');
