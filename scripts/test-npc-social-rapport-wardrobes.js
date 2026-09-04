#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const socialSource = read('docs/js/npc-social-relationship-bridge-v2.js');
const wardrobeSource = read('docs/js/npc-furniture-wardrobe-bridge-v2.js');
const wardrobeEditorSource = read('docs/js/building-interior-npc-wardrobe-editor.js');
const dialogueSource = read('docs/js/dialogue-content.js');
const dialogueEditorState = read('docs/tools/dialogue-editor/dialogue-editor-state.js');
const panelUiSource = read('docs/js/panel-ui.js');
const loaderSource = read('docs/js/combat/combat-config-loader.js');
const relationshipsSource = read('docs/js/relationships-panel.js');

for (const [name, source] of Object.entries({ socialSource, wardrobeSource, wardrobeEditorSource, dialogueSource, dialogueEditorState, panelUiSource, loaderSource, relationshipsSource })) {
  assert.doesNotThrow(() => new vm.Script(source, { filename: name }), `${name} must parse as JavaScript`);
}
assert.doesNotMatch(socialSource, /\b(?:requestAnimationFrame|setInterval)\s*\(/, 'loaded Rapport v2 must add no permanent tick/poll loop');
assert.doesNotMatch(wardrobeSource, /\b(?:requestAnimationFrame|setInterval)\s*\(/, 'loaded wardrobe v2 must add no permanent tick/poll loop');
assert.match(socialSource, /eventDriven:\s*true/, 'Rapport v2 identifies its event-driven runtime');
assert.match(wardrobeSource, /eventDriven:\s*true/, 'wardrobe v2 identifies its event-driven runtime');
assert.match(socialSource, /effectiveInhibition/, 'liquor gating reads the real inhibition runtime result field');
assert.match(socialSource, /mod\?\.key === 'player-dance-invitation'/, 'liquor gating reads the real inhibition modifier key');
assert.match(loaderSource, /npc-furniture-wardrobe-bridge-v2\.js[\s\S]*?npc-social-relationship-bridge-v2\.js/, 'bootstrap loads only the event-driven v2 bridges');
assert.doesNotMatch(loaderSource, /npc-furniture-wardrobe-bridge\.js\?v=/, 'bootstrap no longer executes polling wardrobe v1');
assert.doesNotMatch(loaderSource, /npc-social-relationship-bridge\.js\?v=/, 'bootstrap no longer executes polling Rapport v1');

let rawDay = 3; // Simulation-day index used to prove the social day still changes at midnight rather than 06:00.
let time01 = 0.50; // Normalized 24-hour simulation time used by the accepted-sip cooldown.
let clockHour = 18; // Displayed hour, including CalendarSystem's 24..30 post-midnight range.
let gameRandom = 0.49; // Seeded hidden roll source; 0.49 maps to d100 result 50.
let bottleRemaining = 4; // Bottle state used to detect a genuinely consumed NPC sip.
let restoredAlcoholSnapshot = null; // Captures what the legacy alcohol restore function actually receives.
let plannerTarget = { activity: 'wander' }; // Existing planner output changed by this test to simulate dance entry/exit events.
let activeStimuli = []; // Existing social stimuli changed by this test for dance/music and liquor context.
const relationshipStates = new Map(); // Existing DialogueContent relationship store extended by Rapport metadata.
const refusalLines = []; // Player-visible refusal feedback captured for assertions.

function relation(id) {
  if (!relationshipStates.has(id)) relationshipStates.set(id, { favor: 0, memory: [], visitedSeqSlots: {}, heardTrees: [], heardPoolEntries: [] });
  return relationshipStates.get(id);
}
const dialogueStub = {
  getNpcDlgState: relation,
  npcDlgState: relationshipStates,
  npcRelationshipsSnapshot() {
    return Object.fromEntries([...relationshipStates].map(([id, state]) => [id, { favor: state.favor || 0, memory: [...(state.memory || [])] }]));
  },
  loadNpcRelationships(playerData) {
    relationshipStates.clear();
    for (const [id, saved] of Object.entries(playerData?.npcRelationships || {})) relationshipStates.set(id, { favor: Number(saved.favor) || 0, memory: [...(saved.memory || [])], visitedSeqSlots: {}, heardTrees: [], heardPoolEntries: [] });
  },
  adjustNpcFavor(id, amount, reason) { const state = relation(id); state.favor += Number(amount) || 0; state.memory.push({ event: reason }); },
};
const giftingStub = {
  getNpcGiftOfferAction() { return { action: 'npc_offer_gift' }; },
  offerGift(walker) { dialogueStub.adjustNpcFavor(walker.rec.id, 8, 'gift_loved'); return true; },
};
const alcoholStub = {
  getNpcSwigOfferAction() { return { action: 'npc_offer_alcohol_swig' }; },
  offerNpcSwig() { bottleRemaining -= 1; return true; },
  serializeBottleSwigs() { return { testBottle: { remaining: bottleRemaining } }; },
  serializeNpcAlcoholState() { return { baseState: true }; },
  restoreNpcAlcoholState(snapshot) { restoredAlcoholSnapshot = snapshot; return true; },
};
const plannerStub = { resolveNpcTarget() { return plannerTarget; } };
const socialWindow = {
  SCRATCHBONES_CONFIG: { game: {} },
  CalendarSystem: { constants: { FULL_DAY_CYCLE: true, DAY_ROLLOVER_HOUR: 6 }, timeDebugSnapshot: () => ({ rawDay, time01 }), getHour: () => clockHour },
  DialogueContent: dialogueStub,
  NpcGifting: giftingStub,
  HobunjiDrunkGameplayBridge: alcoholStub,
  NpcActivityPlanner: plannerStub,
  NpcSocialStimuli: { getActive: () => activeStimuli },
  NpcSocialInhibition: {
    evaluate(rec, walker, context) {
      const invite = context?.stimulus?.type === 'dance' && context?.stimulus?.sourceIsPlayer;
      return { effectiveInhibition: invite ? 30 : 40, blocked: false, modifiers: invite ? [{ key: 'player-dance-invitation', amount: -10 }] : [] };
    },
  },
  AmbientDialogue: { showAlcoholOfferResponse(walker, response) { refusalLines.push(response.text || response.line); } },
  GameRandom: { random: () => gameRandom },
  __farmLog() {},
};
vm.runInNewContext(socialSource, { window: socialWindow, Math, console });
const rapport = socialWindow.NpcRapport;
assert.equal(rapport?.eventDriven, true, 'Rapport v2 installs without any timer API in its VM');
assert.equal(rapport.config.representedMinutesPerDay, 1440, 'cooldowns use 24 displayed hours');
assert.equal(rapport.config.drinkAcceptedCooldownMinutes, 30, 'accepted-sip cooldown defaults to configurable 30 minutes');

rapport.adjust('midnight_npc', 50, 'test_before_midnight');
rapport.adjust('getter_npc', 40, 'test_relationship_getter');
assert.equal(relation('midnight_npc').favor, 0, 'Rapport remains temporary before midnight');
clockHour = 24.01;
time01 = 18.01 / 24;
assert.equal(rapport.currentGameDay(), 4, 'social day advances at midnight while raw simulation day is still 3');
assert.equal(dialogueStub.getNpcDlgState('getter_npc').favor, 4, 'ordinary relationship reads settle midnight conversion without a timer');
assert.equal(dialogueStub.getNpcDlgState('getter_npc').rapport, 0, 'ordinary relationship reads reset prior-day Rapport before returning state');
assert.equal(rapport.get('midnight_npc'), 0, 'first Rapport access after midnight settles and resets Rapport');
assert.equal(relation('midnight_npc').favor, 5, '50 Rapport converts using the configurable 10% exchange rate');

clockHour = 10;
rawDay = 4;
time01 = 4 / 24;
assert.equal(giftingStub.offerGift({ rec: { id: 'gift_npc', name: 'Gift NPC' } }), true, 'first gift is accepted');
assert.equal(rapport.get('gift_npc'), 10, 'loved gift becomes temporary Rapport');
assert.equal(relation('gift_npc').favor, 0, 'gift no longer writes immediate permanent Favor');
assert.equal(giftingStub.getNpcGiftOfferAction({ rec: { id: 'gift_npc' } }), null, 'gift action hides after one gift that social day');
assert.equal(giftingStub.offerGift({ rec: { id: 'gift_npc', name: 'Gift NPC' } }), false, 'execution independently blocks a second same-day gift');
clockHour = 24.1;
time01 = 18.1 / 24;
assert.equal(rapport.canGiftToday('gift_npc'), true, 'gift eligibility resets at midnight');

clockHour = 12;
rawDay = 5;
time01 = 6 / 24;
bottleRemaining = 4;
gameRandom = 0.49;
const drinkWalker = { rec: { id: 'drink_npc', name: 'Drink NPC' }, root: { position: { x: 0, z: 0 } }, currentScheduleTarget: null };
assert.equal(alcoholStub.offerNpcSwig(drinkWalker), true, 'd100 50 accepts against effective inhibition 30');
assert.equal(bottleRemaining, 3, 'accepted check delegates actual consumption to established alcohol code');
assert.equal(rapport.get('drink_npc'), 4, 'accepted consumed sip awards temporary Rapport');
const drinkDebug = rapport.getDebug().drink.drink_npc;
assert.equal(drinkDebug.lastCheck.draw, 50, 'debug records seeded d100 result');
assert.equal(drinkDebug.lastCheck.effective, 30, 'debug records real evaluator inhibition plus exact player-invitation modifier');
assert(rapport.drinkCooldownRemaining('drink_npc') > 29.9, 'accepted sip starts 30-minute cooldown');
time01 += 31 / 1440;
assert.equal(rapport.drinkCooldownRemaining('drink_npc'), 0, 'cooldown expires after 30 displayed minutes without a timer');
gameRandom = 0.10;
const beforeRefusal = bottleRemaining;
assert.equal(alcoholStub.offerNpcSwig({ ...drinkWalker, rec: { id: 'refuse_npc', name: 'Refuse NPC' } }), false, 'low d100 can refuse off cooldown');
assert.equal(bottleRemaining, beforeRefusal, 'refusal consumes no alcohol');
assert.equal(rapport.drinkCooldownRemaining('refuse_npc'), 0, 'refusal starts no cooldown');
assert(refusalLines.length > 0, 'refusal remains player-visible');

const alcoholSnapshot = alcoholStub.serializeNpcAlcoholState();
alcoholStub.restoreNpcAlcoholState(alcoholSnapshot);
assert.equal(restoredAlcoholSnapshot.__socialSipCooldowns, undefined, 'social cooldown extension is stripped before legacy alcohol restore');
assert.equal(rapport.drinkCooldownRemaining('drink_npc'), 0, 'serialized expired cooldown restores as expired');

clockHour = 13;
activeStimuli = [{ id: 'player-dance-1', type: 'dance', sourceIsPlayer: true, x: 0, z: 0, radius: 8, strength: 1 }];
plannerTarget = { socialDance: { stimulusId: 'player-dance-1', sourceIsPlayer: true } };
plannerStub.resolveNpcTarget({ id: 'dance_npc' });
assert.equal(rapport.get('dance_npc'), 3, 'entering an accepted player-dance target awards dance Rapport once');
plannerStub.resolveNpcTarget({ id: 'dance_npc' });
assert.equal(rapport.get('dance_npc'), 3, 're-resolving the same dance target does not farm Rapport');
plannerTarget = { activity: 'wander' };
plannerStub.resolveNpcTarget({ id: 'dance_npc' });
activeStimuli = [{ id: 'player-music-1', type: 'music', sourceIsPlayer: true, x: 0, z: 0, radius: 8, strength: 1 }];
plannerTarget = { socialDance: { stimulusId: 'player-music-1', sourceIsPlayer: true } };
plannerStub.resolveNpcTarget({ id: 'dance_npc' });
assert.equal(rapport.get('dance_npc'), 5, 'entering a new dance caused by player music awards the configured music Rapport');

assert.match(dialogueEditorState, /type:'adjustRapport'[\s\S]*?field:'amount'/, 'Dialogue Editor exposes positive/negative Rapport actions');
assert.match(dialogueSource, /act\.type === 'adjustRapport'[\s\S]*?NpcRapport\?\.adjust/, 'dialogue runtime applies authored Rapport changes');
assert.match(relationshipsSource, /NpcRapport\?\.get\?\.\(npcId\)/, 'Relationships panel reads temporary Rapport');
assert.match(wardrobeEditorSource, /METADATA_KEY = 'npcWardrobeFor'/, 'Interior Author stores wardrobe ownership on a furniture instance');
assert.match(wardrobeEditorSource, /other === piece[\s\S]*?delete other\[METADATA_KEY\]/, 'assigning an NPC clears their previous wardrobe in that interior');
assert.match(panelUiSource, /building-interior-author[\s\S]*?building-interior-npc-wardrobe-editor\.js/, 'Interior Author loads the wardrobe assignment extension');

const wardrobeWindow = {
  SCRATCHBONES_CONFIG: { game: { input: { targeting: { orbitRadiusTiles: 0.62 } } } },
  NpcWardrobe: { openWardrobePanel() { return true; } },
  __hobunjiFurnitureDebug: { getCurrentArea: () => 'map_i_test_house', playerState: { x: (4.5 - 0.62) * 64, y: 2.5 * 64 }, targetAimAngleDeg: 0 },
  matchMedia: () => ({ matches: false }),
};
const documentStub = { readyState: 'complete', documentElement: { dataset: {} }, body: { dataset: {} }, getElementById() { return null; }, addEventListener() {} };
class MutationObserverStub { observe() {} }
vm.runInNewContext(wardrobeSource, {
  window: wardrobeWindow,
  document: documentStub,
  MutationObserver: MutationObserverStub,
  fetch: async () => ({ ok: false, status: 404, json: async () => ({}) }),
  queueMicrotask(fn) { fn(); },
  localStorage: { getItem: () => null },
  Math,
  console,
});
const furnitureWardrobes = wardrobeWindow.NpcFurnitureWardrobes;
assert.equal(furnitureWardrobes?.eventDriven, true, 'wardrobe v2 installs without any timer API in its VM');
const authoredMap = { cols: 10, rows: 10, furniture: [{ id: 'cabinet_1', itemKey: 'cabinetFurniture', col: 4, row: 2, npcWardrobeFor: 'gorobi_ginju' }, { id: 'chair_1', itemKey: 'chairFurniture', col: 1, row: 1 }] };
assert.deepEqual(JSON.parse(JSON.stringify(furnitureWardrobes.wardrobeBindings(authoredMap))), [{ id: 'cabinet_1', itemKey: 'cabinetFurniture', col: 4, row: 2, npcId: 'gorobi_ginju', interactionRadiusTiles: 0.82 }], 'runtime reads instance-level wardrobe metadata');
assert.equal(furnitureWardrobes.bindingAtTarget(authoredMap)?.npcId, 'gorobi_ginju', 'aimed authored furniture resolves the assigned NPC');
assert.match(wardrobeSource, /new MutationObserver\(scheduleActionRefresh\)/, 'wardrobe refresh piggybacks existing action-bar mutations');
assert.match(wardrobeSource, /openWardrobePanel = function furnitureOnlyWardrobePanel/, 'old direct NPC wardrobe entry point is gated through authored furniture');
assert.match(wardrobeSource, /__npcFurnitureWardrobeDebug/, 'wardrobe targeting remains mobile-debuggable');

console.log('Event-driven NPC Rapport, social gates, dialogue, and furniture wardrobe regression checks passed.');
