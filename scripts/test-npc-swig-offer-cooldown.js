#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'docs/js/npc-social-relationship-bridge-v2.js'), 'utf8');
assert.doesNotThrow(() => new vm.Script(source, { filename: 'npc-social-relationship-bridge-v2.js' }), 'NPC Rapport bridge must parse');

let rawDay = 1; // Used by the bridge's absolute in-game minute calculation.
let time01 = 0.5; // Used to advance the accepted-sip cooldown without a timer.
let gameRandom = 0.99; // Used to force an inhibition acceptance or refusal deterministically.
let bottleRemaining = 4; // Used to prove blocked repeat offers do not consume a serving.
const refusals = []; // Used to verify cooldown/refusal feedback remains player-visible.

const originalGetNpcSwigOfferAction = walker => ({ action: 'npc_offer_alcohol_swig', label: `Offer ${walker.rec.name} a swig` });
const alcoholStub = {
  getNpcSwigOfferAction: originalGetNpcSwigOfferAction,
  offerNpcSwig() { bottleRemaining -= 1; return true; },
  serializeBottleSwigs() { return { bottle: { remaining: bottleRemaining } }; },
};

const windowStub = {
  SCRATCHBONES_CONFIG: { game: {} },
  CalendarSystem: {
    constants: { FULL_DAY_CYCLE: true },
    timeDebugSnapshot: () => ({ rawDay, time01 }),
    getHour: () => time01 * 24,
  },
  HobunjiDrunkGameplayBridge: alcoholStub,
  NpcSocialStimuli: { getActive: () => [] },
  NpcSocialInhibition: {
    evaluate() { return { effectiveInhibition: 30, blocked: false, modifiers: [] }; },
  },
  AmbientDialogue: {
    showAlcoholOfferResponse(walker, response) { refusals.push({ npcId: walker.rec.id, reason: response.reason, text: response.text }); },
  },
  GameRandom: { random: () => gameRandom },
  __farmLog() {},
};

vm.runInNewContext(source, { window: windowStub, Math, console, Object, JSON });
const rapport = windowStub.NpcRapport;
const walker = { rec: { id: 'test_npc', name: 'Test NPC' }, root: { position: { x: 0, z: 0 } }, currentScheduleTarget: null };

assert.strictEqual(alcoholStub.getNpcSwigOfferAction, originalGetNpcSwigOfferAction, 'Rapport must not replace or hide the legacy offer action');
assert.equal(alcoholStub.offerNpcSwig(walker), true, 'first accepted offer delegates to established alcohol consumption');
assert.equal(bottleRemaining, 3, 'first accepted offer consumes exactly one serving');
assert(rapport.drinkCooldownRemaining('test_npc') > 29.9, 'accepted sip starts the configured 30-minute acceptance cooldown');
assert.equal(alcoholStub.getNpcSwigOfferAction(walker)?.action, 'npc_offer_alcohol_swig', 'offer action remains visible while acceptance is cooling down');
const bottleDuringCooldown = bottleRemaining; // Used to ensure a visible repeat offer is refused without consumption.
assert.equal(alcoholStub.offerNpcSwig(walker), false, 'repeat offer during cooldown is refused at execution time');
assert.equal(bottleRemaining, bottleDuringCooldown, 'cooldown refusal consumes no serving');
assert.equal(refusals.at(-1)?.reason, 'cooldown', 'cooldown refusal reports the correct visible reason');

time01 += 31 / 1440;
assert.equal(rapport.drinkCooldownRemaining('test_npc'), 0, 'acceptance cooldown expires after 30 represented minutes');
assert.equal(alcoholStub.offerNpcSwig(walker), true, 'NPC can accept again after cooldown expires');
assert.equal(bottleRemaining, 2, 'post-cooldown acceptance consumes one serving');

rawDay = 0;
time01 = 0;
gameRandom = 0;
const refusalWalker = { rec: { id: 'refusal_npc', name: 'Refusal NPC' }, root: { position: { x: 0, z: 0 } }, currentScheduleTarget: null };
assert.equal(alcoholStub.offerNpcSwig(refusalWalker), false, 'failed inhibition check refuses the offer');
assert.equal(rapport.drinkCooldownRemaining('refusal_npc'), 0, 'a refusal with null accepted-sip timestamp does not become a false minute-zero cooldown');
assert.equal(alcoholStub.getNpcSwigOfferAction(refusalWalker)?.action, 'npc_offer_alcohol_swig', 'refused NPC can still be offered another swig');

console.log('NPC swig offer visibility and acceptance-cooldown regression checks passed.');
