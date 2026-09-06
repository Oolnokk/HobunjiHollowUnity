#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const socialSource = fs.readFileSync(path.join(root, 'docs/js/npc-social-relationship-bridge-v2.js'), 'utf8');

assert.doesNotThrow(() => new vm.Script(socialSource, { filename: 'npc-social-relationship-bridge-v2.js' }), 'dance Rapport bridge must parse');
assert.doesNotMatch(socialSource, /\b(?:requestAnimationFrame|setInterval)\s*\(/, 'continuous dance Rapport must reuse existing planner observations instead of adding a permanent polling loop');

let performanceNow = 0; // Monotonic gameplay clock advanced by this test to verify exact per-second Rapport accrual.
let plannerTarget = { activity: 'wander' }; // Existing planner output changed by this test to enter, remain in, and leave dance targets.
let activeStimuli = []; // Active social stimuli changed by this test to distinguish direct player dancing from music-caused dancing.
const relationshipStates = new Map(); // Minimal DialogueContent relationship store used by the real Rapport bridge under test.

function relation(id) {
  if (!relationshipStates.has(id)) {
    relationshipStates.set(id, { favor: 0, rapport: 0, memory: [], visitedSeqSlots: {}, heardTrees: [], heardPoolEntries: [] });
  }
  return relationshipStates.get(id);
}

const plannerStub = {
  resolveNpcTarget() { return plannerTarget; },
};

const socialWindow = {
  SCRATCHBONES_CONFIG: { game: {} },
  performance: { now: () => performanceNow },
  CalendarSystem: {
    constants: { FULL_DAY_CYCLE: true },
    timeDebugSnapshot: () => ({ rawDay: 1, time01: 0.5 }),
    getHour: () => 12,
  },
  DialogueContent: {
    getNpcDlgState: relation,
    npcDlgState: relationshipStates,
  },
  NpcActivityPlanner: plannerStub,
  NpcSocialStimuli: { getActive: () => activeStimuli },
  __farmLog() {},
};

vm.runInNewContext(socialSource, { window: socialWindow, Math, Date, console });
const rapport = socialWindow.NpcRapport;
assert.equal(rapport?.eventDriven, true, 'Rapport bridge installs in event-driven mode');
assert.equal(rapport.config.danceRapport.basePerSecond, 1, 'neutral dancing defaults to 1 Rapport per second');
assert.equal(rapport.config.danceRapport.perPositiveHeartPerSecond, 1, 'every completed positive heart adds 1 Rapport per second');

activeStimuli = [{ id: 'player-dance', type: 'dance', sourceIsPlayer: true, x: 0, z: 0, radius: 8, strength: 1 }];
plannerTarget = { socialDance: { stimulusId: 'player-dance', sourceIsPlayer: true } };
performanceNow = 0;
plannerStub.resolveNpcTarget({ id: 'dance_npc' });
assert.equal(rapport.get('dance_npc'), 0, 'starting a dance no longer gives the old one-time +3 Rapport award');

performanceNow = 999;
plannerStub.resolveNpcTarget({ id: 'dance_npc' });
assert.equal(rapport.get('dance_npc'), 0, 'less than one completed second gives no Rapport yet');

performanceNow = 1000;
plannerStub.resolveNpcTarget({ id: 'dance_npc' });
assert.equal(rapport.get('dance_npc'), 1, 'neutral direct player dancing gives exactly 1 Rapport per completed second');

relation('dance_npc').favor = 2;
plannerStub.resolveNpcTarget({ id: 'dance_npc' });
assert.equal(rapport.danceRapportPerSecond('dance_npc'), 3, 'two hearts above neutral produce a 3 Rapport/sec dance rate');
performanceNow = 2000;
plannerStub.resolveNpcTarget({ id: 'dance_npc' });
assert.equal(rapport.get('dance_npc'), 4, 'positive-heart bonus is applied to continuous dancing');

relation('dance_npc').favor = -2;
plannerStub.resolveNpcTarget({ id: 'dance_npc' });
assert.equal(rapport.danceRapportPerSecond('dance_npc'), 1, 'negative hearts never reduce the neutral 1 Rapport/sec base');
performanceNow = 3000;
plannerStub.resolveNpcTarget({ id: 'dance_npc' });
assert.equal(rapport.get('dance_npc'), 5, 'a willing negative-Favor NPC still earns the neutral base dance rate');

relation('dance_npc').favor = 12;
plannerStub.resolveNpcTarget({ id: 'dance_npc' });
assert.equal(rapport.danceRapportPerSecond('dance_npc'), 11, 'heart bonus is capped to the existing ten positive relationship hearts');
assert.equal(rapport.getDebug().danceRapportByNpc.dance_npc.rapportPerSecond, 11, 'mobile-friendly Rapport debug snapshot exposes the active dance rate');

plannerTarget = { activity: 'wander' };
plannerStub.resolveNpcTarget({ id: 'dance_npc' });
assert.equal(rapport.getDebug().danceRapportByNpc.dance_npc, undefined, 'leaving the dance clears the continuous dance debug session');

activeStimuli = [{ id: 'player-music', type: 'music', sourceIsPlayer: true, x: 0, z: 0, radius: 8, strength: 1 }];
plannerTarget = { socialDance: { stimulusId: 'player-music', sourceIsPlayer: true } };
plannerStub.resolveNpcTarget({ id: 'dance_npc' });
assert.equal(rapport.get('dance_npc'), 7, 'music-caused dancing keeps its separate one-time +2 Rapport award');
plannerStub.resolveNpcTarget({ id: 'dance_npc' });
assert.equal(rapport.get('dance_npc'), 7, 're-resolving the same music dance cannot farm its one-time award');

console.log('Continuous player-dance Rapport rate regression passed.');
