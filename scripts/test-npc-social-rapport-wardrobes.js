#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const socialSource = read('docs/js/npc-social-relationship-bridge.js');
const wardrobeSource = read('docs/js/npc-furniture-wardrobe-bridge.js');
const wardrobeEditorSource = read('docs/js/building-interior-npc-wardrobe-editor.js');
const dialogueSource = read('docs/js/dialogue-content.js');
const dialogueEditorState = read('docs/tools/dialogue-editor/dialogue-editor-state.js');
const panelUiSource = read('docs/js/panel-ui.js');
const loaderSource = read('docs/js/combat/combat-config-loader.js');
const relationshipsSource = read('docs/js/relationships-panel.js');
const skySource = read('docs/js/sky-dome.js');

for (const [name, source] of Object.entries({
  socialSource,
  wardrobeSource,
  wardrobeEditorSource,
  dialogueSource,
  dialogueEditorState,
  panelUiSource,
  loaderSource,
  relationshipsSource,
})) {
  assert.doesNotThrow(() => new vm.Script(source, { filename: name }), `${name} must parse as JavaScript`);
}

assert.match(skySource, /injectedDeps\.NIGHT_HOUR\s*=\s*morningHour\s*\+\s*24/,
  'the current game clock really spans 24 represented hours per simulation day');
assert.match(socialSource, /representedMinutesPerDay:\s*24\s*\*\s*60/,
  'social cooldown minutes use the current 24-hour represented clock');
assert.match(socialSource, /drinkAcceptedCooldownMinutes:\s*30/,
  'the default 30-minute accepted-sip cooldown is exposed in config');
assert.match(socialSource, /config\.drinkAcceptedCooldownMinutes/,
  'liquor cooldown handlers read the configurable value rather than an inline literal');
assert.match(socialSource, /NpcSocialInhibition[\s\S]*?\.evaluate/,
  'liquor acceptance reuses the shared dance inhibition evaluator');
assert.match(socialSource, /player-dance-invitation/,
  'liquor acceptance reuses the dance evaluator relationship modifier');
assert.match(socialSource, /GameRandom\?\.random/,
  'the hidden d100 uses seeded gameplay randomness when available');
assert.match(socialSource, /lastGiftDay/,
  'per-NPC once-per-day gift state is persisted');
assert.match(socialSource, /rapportToFavorRate/,
  'Rapport-to-Favor exchange is configurable');
assert.match(socialSource, /hour\s*>=\s*24[\s\S]*?rawDay\s*\+\s*1/,
  'social day advances at midnight even though the simulation day rolls at 06:00');

let rawDay = 3; // Used by the social-module VM to exercise the 06:00-backed simulation day independently from midnight social rollover.
let time01 = 0.50; // Used by the social-module VM as the authoritative normalized time within the current 24-hour simulation day.
let clockHour = 18; // Used by the social-module VM to make the social day switch exactly at displayed midnight.
let gameRandom = 0.49; // Used by the social-module VM to make the hidden d100 deterministic (draw 50).
let bottleRemaining = 4; // Used by the alcohol stub so the bridge can detect a genuinely consumed NPC sip.
const relationshipStates = new Map(); // Used as the stub DialogueContent relationship store extended by NpcRapport.
const refusalLines = []; // Used to verify rejected/cooldown offers do not consume alcohol silently.

function relation(id) {
  if (!relationshipStates.has(id)) relationshipStates.set(id, {
    favor: 0,
    memory: [],
    visitedSeqSlots: {},
    heardTrees: [],
    heardPoolEntries: [],
  });
  return relationshipStates.get(id);
}

const dialogueStub = {
  getNpcDlgState: relation,
  npcDlgState: relationshipStates,
  npcRelationshipsSnapshot() {
    return Object.fromEntries([...relationshipStates.entries()].map(([id, state]) => [id, {
      favor: state.favor || 0,
      memory: [...(state.memory || [])],
    }]));
  },
  loadNpcRelationships(playerData) {
    relationshipStates.clear();
    for (const [id, saved] of Object.entries(playerData?.npcRelationships || {})) {
      relationshipStates.set(id, {
        favor: Number(saved.favor) || 0,
        memory: [...(saved.memory || [])],
        visitedSeqSlots: {},
        heardTrees: [],
        heardPoolEntries: [],
      });
    }
  },
  adjustNpcFavor(id, amount, reason) {
    const state = relation(id);
    state.favor += Number(amount) || 0;
    state.memory.push({ event: reason });
  },
};

const giftingStub = {
  getNpcGiftOfferAction() { return { action: 'npc_offer_gift' }; },
  offerGift(walker) {
    dialogueStub.adjustNpcFavor(walker.rec.id, 8, 'gift_loved');
    return true;
  },
};

const alcoholStub = {
  getNpcSwigOfferAction() { return { action: 'npc_offer_alcohol_swig' }; },
  offerNpcSwig() { bottleRemaining -= 1; return true; },
  serializeBottleSwigs() { return { testBottle: { remaining: bottleRemaining } }; },
  serializeNpcAlcoholState() { return { baseState: true }; },
  restoreNpcAlcoholState() { return true; },
};

const socialWindow = {
  SCRATCHBONES_CONFIG: { game: {} },
  CalendarSystem: {
    constants: { FULL_DAY_CYCLE: true, DAY_ROLLOVER_HOUR: 6 },
    timeDebugSnapshot: () => ({ rawDay, time01 }),
    getHour: () => clockHour,
  },
  DialogueContent: dialogueStub,
  NpcGifting: giftingStub,
  HobunjiDrunkGameplayBridge: alcoholStub,
  NpcSocialStimuli: { getActive: () => [] },
  NpcSocialInhibition: {
    evaluate(rec, walker, context) {
      const invite = context?.stimulus?.type === 'dance';
      return {
        effective: 40,
        blockedReason: null,
        modifiers: invite ? [{ label: 'player-dance-invitation', amount: -10 }] : [],
      };
    },
    getDebugState: () => ({ activeEvaluations: [] }),
  },
  AmbientDialogue: { showAlcoholOfferResponse(walker, response) { refusalLines.push(response.text || response.line); } },
  GameRandom: { random: () => gameRandom },
  TILE_SIZE: 64,
  __farmLog() {},
};

vm.runInNewContext(socialSource, {
  window: socialWindow,
  performance: { now: () => 1000 },
  requestAnimationFrame() {},
  Math,
  console,
});

const rapport = socialWindow.NpcRapport;
assert(rapport?.installed, 'NpcRapport installs in the social-module VM');
assert.equal(rapport.config.representedMinutesPerDay, 1440, '24-hour clock equals 1440 represented minutes');
assert.equal(rapport.config.drinkAcceptedCooldownMinutes, 30, 'accepted-sip cooldown defaults to 30 represented minutes');

rapport.adjust('midnight_npc', 50, 'test_before_midnight');
assert.equal(rapport.get('midnight_npc'), 50, 'Rapport can accumulate before midnight');
assert.equal(relation('midnight_npc').favor, 0, 'daily Rapport does not immediately become permanent Favor');
clockHour = 24.01;
time01 = 18.01 / 24;
assert.equal(rapport.currentGameDay(), 4, 'social day advances at midnight while raw simulation day remains unchanged');
assert.equal(rapport.get('midnight_npc'), 0, 'Rapport resets on first access after midnight');
assert.equal(relation('midnight_npc').favor, 5, '50 Rapport converts to Favor at the configurable 10% default rate');

clockHour = 10;
rawDay = 4;
time01 = 4 / 24;
assert.equal(giftingStub.offerGift({ rec: { id: 'gift_npc', name: 'Gift NPC' } }), true, 'first gift of a social day is accepted');
assert.equal(rapport.get('gift_npc'), 10, 'loved gift awards configured temporary Rapport instead of immediate Favor');
assert.equal(relation('gift_npc').favor, 0, 'gift reward is not written directly to permanent Favor');
assert.equal(giftingStub.getNpcGiftOfferAction({ rec: { id: 'gift_npc' } }), null, 'gift action disappears after gifting that NPC today');
assert.equal(giftingStub.offerGift({ rec: { id: 'gift_npc', name: 'Gift NPC' } }), false, 'execution path independently blocks a second same-day gift');
clockHour = 24.1;
time01 = 18.1 / 24;
assert.equal(rapport.canGiftToday('gift_npc'), true, 'gift eligibility resets at midnight, not the 06:00 simulation rollover');

clockHour = 12;
rawDay = 5;
time01 = 6 / 24;
bottleRemaining = 4;
gameRandom = 0.49;
const drinkWalker = { rec: { id: 'drink_npc', name: 'Drink NPC' }, root: { position: { x: 0, z: 0 } }, currentScheduleTarget: null };
assert.equal(alcoholStub.offerNpcSwig(drinkWalker), true, 'd100 roll 50 accepts against effective inhibition 30');
assert.equal(bottleRemaining, 3, 'accepted social check still delegates the actual sip to the established alcohol implementation');
assert.equal(rapport.get('drink_npc'), 4, 'accepted consumed sip awards configured Rapport');
let drinkDebug = rapport.getDebug().drink.drink_npc;
assert.equal(drinkDebug.lastCheck.draw, 50, 'debug reports the seeded hidden d100 result');
assert.equal(drinkDebug.lastCheck.effective, 30, 'debug reports inhibition including the reused player-invitation relationship modifier');
assert(rapport.drinkCooldownRemaining('drink_npc') > 29.9, 'accepted sip starts the configured 30-minute cooldown');
assert.equal(alcoholStub.getNpcSwigOfferAction(drinkWalker), null, 'alcohol offer action is hidden during cooldown');
time01 += 31 / 1440;
assert.equal(rapport.drinkCooldownRemaining('drink_npc'), 0, 'cooldown expires after 30 displayed in-game minutes');
assert(alcoholStub.getNpcSwigOfferAction(drinkWalker), 'alcohol offer action returns after cooldown');

gameRandom = 0.10;
const beforeRefusalBottle = bottleRemaining;
assert.equal(alcoholStub.offerNpcSwig({ ...drinkWalker, rec: { id: 'refuse_npc', name: 'Refuse NPC' } }), false,
  'low d100 result can refuse a sip even when no cooldown is active');
assert.equal(bottleRemaining, beforeRefusalBottle, 'refused social check consumes no alcohol');
assert.equal(rapport.drinkCooldownRemaining('refuse_npc'), 0, 'refusal does not start the accepted-sip cooldown');
assert(refusalLines.length >= 1, 'refusal uses player-visible alcohol response feedback');

const savedRelationships = dialogueStub.npcRelationshipsSnapshot();
assert.equal(savedRelationships.drink_npc.rapport, 4, 'relationship snapshot persists Rapport');
assert.equal(savedRelationships.gift_npc.lastGiftDay, 4, 'relationship snapshot persists daily gift gate');

assert.match(dialogueEditorState, /type:'adjustRapport'[\s\S]*?field:'amount'/,
  'Dialogue Editor exposes numeric positive/negative Rapport actions through its existing choice-action UI');
assert.match(dialogueSource, /act\.type === 'adjustRapport'[\s\S]*?NpcRapport\?\.adjust/,
  'runtime dialogue choice execution applies authored Rapport changes');
assert.match(relationshipsSource, /NpcRapport\?\.get\?\.\(npcId\)/,
  'Relationships panel reads temporary Rapport from NpcRapport');
assert.match(relationshipsSource, /Rapport \$\{Math\.round\(rapport\)\}\/100/,
  'Relationships panel displays the temporary Rapport value');

assert.match(wardrobeEditorSource, /METADATA_KEY = 'npcWardrobeFor'/,
  'Interior Author stores wardrobe ownership on a specific furniture instance');
assert.match(wardrobeEditorSource, /other === piece[\s\S]*?delete other\[METADATA_KEY\]/,
  'assigning one NPC clears another wardrobe assignment for that NPC within the interior');
assert.match(wardrobeEditorSource, /__biaNpcWardrobeDebug/,
  'Interior Author provides mobile-friendly wardrobe binding diagnostics');
assert.match(panelUiSource, /building-interior-author[\s\S]*?building-interior-npc-wardrobe-editor\.js/,
  'the shared tool bootstrap loads the wardrobe authoring extension only in the Interior Author');

const wardrobeWindow = {
  SCRATCHBONES_CONFIG: { game: { input: { targeting: { orbitRadiusTiles: 0.62 } } } },
  NpcWardrobe: { openWardrobePanel() { return true; } },
  __hobunjiFurnitureDebug: {
    getCurrentArea: () => 'map_i_test_house',
    playerState: { x: (4.5 - 0.62) * 64, y: 2.5 * 64 },
    targetAimAngleDeg: 0,
  },
  matchMedia: () => ({ matches: false }),
};
const documentStub = {
  documentElement: { dataset: {} },
  body: { dataset: {} },
  getElementById() { return null; },
  addEventListener() {},
};
class MutationObserverStub { observe() {} }
vm.runInNewContext(wardrobeSource, {
  window: wardrobeWindow,
  document: documentStub,
  MutationObserver: MutationObserverStub,
  fetch: async () => ({ ok: false, status: 404, json: async () => ({}) }),
  setInterval() {},
  queueMicrotask() {},
  localStorage: { getItem: () => null },
  Math,
  console,
});
const furnitureWardrobes = wardrobeWindow.NpcFurnitureWardrobes;
assert(furnitureWardrobes?.installed, 'furniture wardrobe runtime bridge installs');
const authoredMap = {
  cols: 10,
  rows: 10,
  furniture: [
    { id: 'cabinet_1', itemKey: 'cabinetFurniture', col: 4, row: 2, npcWardrobeFor: 'gorobi_ginju' },
    { id: 'chair_1', itemKey: 'chairFurniture', col: 1, row: 1 },
  ],
};
assert.deepEqual(JSON.parse(JSON.stringify(furnitureWardrobes.wardrobeBindings(authoredMap))), [{
  id: 'cabinet_1', itemKey: 'cabinetFurniture', col: 4, row: 2, npcId: 'gorobi_ginju', interactionRadiusTiles: 0.82,
}], 'runtime reads instance-level npcWardrobeFor metadata from authored map furniture');
assert.equal(furnitureWardrobes.bindingAtTarget(authoredMap)?.npcId, 'gorobi_ginju',
  'aiming at the assigned furniture resolves the correct NPC wardrobe');
assert.match(wardrobeSource, /directWardrobeButtons[\s\S]*?npc_open_wardrobe/,
  'runtime identifies the old character-side wardrobe action so it can be suppressed/repurposed');
assert.match(wardrobeSource, /openWardrobePanel = function furnitureOnlyWardrobePanel/,
  'existing wardrobe panel entry point is gated through an authored furniture target');
assert.match(wardrobeSource, /__npcFurnitureWardrobeDebug/,
  'runtime provides mobile-friendly wardrobe targeting diagnostics');
assert.match(loaderSource, /npc-furniture-wardrobe-bridge\.js[\s\S]*?npc-social-relationship-bridge\.js/,
  'runtime bootstrap loads furniture wardrobes and Rapport after their existing dependencies');

console.log('NPC Rapport, social gating, dialogue, and furniture wardrobe regression checks passed.');
