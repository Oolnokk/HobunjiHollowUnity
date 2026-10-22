#!/usr/bin/env node
'use strict';

// Run with: node scripts/test-npc-preference-dialogue.js
// Protects casual gift/date hints and their coexistence with generated merchant access.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..'); // Used to find the same checked-in data and runtime modules used by the game.
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8'); // Used for both authored data and real runtime sources.
const database = JSON.parse(read('docs/config/npcs/hobunji-starter-npc-database.json')); // Source for every named NPC's dialogue.
const shopStock = JSON.parse(read('docs/config/shops/shop-stock.json')); // Source of generated Shop/Chat access.
const policies = { window: { SCRATCHBONES_CONFIG: { game: {} } } }; // Isolates romance and Great Fey policies from the UI harness.
vm.runInNewContext(read('docs/config/romance-config.js'), policies, { filename: 'romance-config.js' });
vm.runInNewContext(read('docs/js/npc-interaction-policy.js'), policies, { filename: 'npc-interaction-policy.js' });
vm.runInNewContext(read('docs/js/condition-registry.js'), policies, { filename: 'condition-registry.js' });
const likes = policies.window.HobunjiRomanceConfig.likes; // Used to verify that date hints remain aligned with date activity preferences.
const isGreatFey = policies.window.NpcInteractionPolicy.isPassiveGreatFey; // Used to exclude scripted quest-givers from ordinary preference hints.

let giftNPCs = 0, dateNPCs = 0, giftLines = 0, dateLines = 0; // Summary counters for regression results.
for (const npc of database.npcs) {
  assert(npc.gifts, npc.id + ': gift scoring data must remain intact');
  const excluded = isGreatFey(npc); // Great Fey use authored conversation/quests rather than preference hints.
  const oldPools = (npc.phrasePools || []).filter(pool => /_(gift|date)_hints$/.test(pool.id));
  assert.equal(oldPools.length, 0, npc.id + ': hint pools must not remain behind as orphaned selectable topics');
  if (npc.id === 'banubu') continue; // His quest replaces the generic fallback record.
  const fallback = npc.dialogueTrees.find(tree => tree.id === 'tree_' + npc.id + '_fallback');
  assert(fallback, npc.id + ': missing general conversation tree');
  const entry = fallback.nodes.find(node => node.id === fallback.entryNode);
  assert.equal(entry?.type, 'text', npc.id + ': conversation must not require a gift/date choice');
  assert(!entry.choices?.length, npc.id + ': no standalone gift/date choices');
  assert.equal(fallback.nodes.length, 1, npc.id + ': old gift/date nodes must not remain unreachable');
  const greetingName = /^\{\{pool:(.+)\}\}$/.exec(entry.text)?.[1]; // Used to find the regular speech pool, not a special hint submenu.
  const chatter = (npc.phrasePools || []).find(pool => pool.name === greetingName);
  assert(chatter?.entries?.length, npc.id + ': must have an ordinary randomized dialogue pool');
  const gift = chatter.entries.filter(line => line.id.startsWith('pe_' + npc.id + '_gift_hint_'));
  const date = chatter.entries.filter(line => line.id.startsWith('pe_' + npc.id + '_date_hint_'));
  assert(chatter.entries.some(line => !gift.includes(line) && !date.includes(line)), npc.id + ': normal conversation variation was lost');
  if (excluded) {
    assert.equal(gift.length + date.length, 0, npc.id + ': Great Fey must not suggest gifts/dates');
    continue;
  }
  assert(gift.length > 0, npc.id + ': gift writing prompts must appear in ordinary chatter');
  for (const line of [...gift, ...date]) {
    assert.match(line.text, /^<[^<>]+>$/, npc.id + ': hint should remain a writer-facing placeholder');
    assert(policies.window.ConditionRegistry.entryEligible(line, { timesOfDay: 'day', weather: 'clear' }), npc.id + ': an eligible hint must be reachable without topic choices');
  }
  giftNPCs++;
  giftLines += gift.length;
  if (npc.relationship?.canDate) {
    assert(date.length, npc.id + ': romanceable NPC is missing date-writing prompts');
    const configured = likes[npc.id] || []; // Used to verify one authored date prompt per scored activity (or explicit TODO).
    assert.equal(date.length, Math.max(1, configured.length), npc.id + ': mismatched date hints');
    if (!configured.length) assert.match(date[0].text, /TODO.*romance\.likes/);
    dateNPCs++;
    dateLines += date.length;
  } else {
    assert.equal(date.length, 0, npc.id + ': date hints must not leak to non-date NPCs');
  }
}
assert.equal(giftNPCs, database.npcs.length - 4);
assert.equal(dateNPCs, database.npcs.filter(npc => npc.relationship?.canDate).length);
assert.equal(giftLines, 89);
assert.equal(dateLines, 48);
const banubuContent = read('docs/js/banubu-quest-content.js'); // Used to ensure ordinary hint cleanup did not touch the authored fishing quest.
assert(!banubuContent.includes('<Something that indicates that I like receiving fish as gifts.>'));
for (const nodeId of ['banubu_intro_8', 'banubu_q1_active_1', 'banubu_blocked_1']) assert(banubuContent.includes(nodeId));

// Browser-free integration harness runs the actual shop-tree composer,
// dialogue selector, action buttons, and Chat callback—not a reimplementation.
const elements = new Map(); // Used to observe rendered option buttons and spoken dialogue without a real browser.
function element(id) {
  if (!elements.has(id)) {
    const classes = new Set(); // Used to represent the visible option and dialogue shell classes.
    const label = { textContent: '', style: {}, scrollHeight: 10, clientHeight: 10 }; // Used by the option font-fit routine.
    elements.set(id, {
      id, textContent: '', style: {}, label,
      classList: { add: value => classes.add(value), remove: value => classes.delete(value),
        contains: value => classes.has(value), toggle: (value, active) => active ? classes.add(value) : classes.delete(value) },
      setAttribute() {}, querySelector: () => label,
    });
  }
  return elements.get(id);
}
const runtime = {
  console, performance: { now: () => 0 }, // Used for portrait update gating; profiles are absent in this harness.
  SCRATCHBONES_CONFIG: { game: { npcDialogue: { text: { typewriter: { enabled: false } } } } },
  DialogueRichText: {
    parse: text => [{ text }], plain: runs => runs.map(run => run.text).join(''),
    render: (target, runs) => { target.textContent = runs.map(run => run.text).join(''); },
  },
};
runtime.window = runtime;
vm.createContext(runtime);
vm.runInContext(read('docs/js/condition-registry.js'), runtime, { filename: 'condition-registry.js' });
runtime.document = { currentScript: null, getElementById: element }; // Used by DialogueContent and stops the optional dynamic loader in LocalDBOverrides.
vm.runInContext(read('docs/js/local-db-overrides.js'), runtime, { filename: 'local-db-overrides.js' });
vm.runInContext(read('docs/js/dialogue-content.js'), runtime, { filename: 'dialogue-content.js' });
const composed = runtime.LocalDBOverrides.applyShopDialogueAccess(database, shopStock); // Used to inspect real generated shop and fallback trees.
const byId = new Map(composed.npcs.map(npc => [npc.id, npc])); // Used to look up the active seller's composed dialogue.
for (const [poolId, shop] of Object.entries(shopStock.shops)) {
  const access = shop.dialogueAccess; // Used to keep the map-gated merchant requirements from the authoritative shop stock.
  if (!access?.sellerIds || (!access.roaming && !access.businessMaps?.length)) continue;
  for (const sellerId of access.sellerIds) {
    const npc = byId.get(sellerId);
    assert(npc, poolId + ': seller not found in NPC database: ' + sellerId);
    const tree = npc.dialogueTrees.find(tree => tree.generatedFromShopAccess && tree.shopPool === poolId);
    assert(tree, poolId + ': Shop/Chat tree was not generated for ' + sellerId);
    assert.equal(tree.nodes[0].type, 'choice');
    assert(tree.nodes[0].choices.some(choice => choice.actions?.some(action => action.type === 'openShop' && action.pool === poolId)));
    assert(tree.nodes[0].choices.some(choice => choice.actions?.some(action => action.type === 'startChat')));
    assert.deepEqual(Array.from(tree.conditions.maps), Array.from(access.roaming ? [] : access.businessMaps || []));
  }
}

let area = '', activeNPC = null; // Changed between interactions to test location-specific shops.
const menus = []; // Records real openShop actions for assertions.
const deps = {
  canAccessContent: () => true, currentWeekdayName: () => 'Anan',
  currentSeason: () => ({ name: 'Deadgrass' }), calendar: { weather: 'clear' },
  fishingTimeOfDay: () => 'day', getCurrentArea: () => area,
  getPlayerData: () => ({ nickname: 'Farmer', appearance: { speciesId: 'mao-ao' } }),
  getDialogueOpen: () => true, getDialogueWalker: () => ({ rec: activeNPC }),
  normalizeStationLabel: label => String(label || '').toLowerCase(),
  closeNpcDialogue() {}, openMenu: menuId => menus.push(menuId),
  getWaresPools: () => shopStock.shops,
};
runtime.DialogueContent.init(deps);
function visibleChoices() {
  return [1, 2, 3, 4, 5, 6].filter(i => element('dlgOpt' + i).classList.contains('dlg-opt-visible'));
}
function checkMerchant(npcId, mapId, expectedMenu) {
  area = mapId;
  activeNPC = byId.get(npcId);
  const state = runtime.DialogueContent.getNpcDlgState(npcId); // Used to force the previously-heard case where fallback could displace the shop.
  state.heardTrees = activeNPC.dialogueTrees.map(tree => tree.id);
  runtime.DialogueContent.resetDialogueState();
  runtime.DialogueContent.beginNpcConversation(activeNPC);
  assert.deepEqual(visibleChoices(), [1, 2], npcId + ': merchant Shop/Chat should remain available on repeat talks');
  assert.equal(element('dlgOpt2').label.textContent, 'Chat');
  element('dlgOpt1').onclick();
  assert.equal(menus.at(-1), expectedMenu, npcId + ': selecting Shop did not open the correct wares');
  runtime.DialogueContent.resetDialogueState();
  runtime.DialogueContent.beginNpcConversation(activeNPC);
  element('dlgOpt2').onclick(); // Actual startChat action must bypass merchant trees for this interaction.
  assert.deepEqual(visibleChoices(), [], npcId + ': Chat looped back to Shop/Chat instead of ordinary speech');
  assert(element('npcDialogueText').textContent.length > 0, npcId + ': Chat should say an ordinary line');
}
checkMerchant('furunji_funji', 'map_i_general_store', 'generalStore');
checkMerchant('kaboku_kunji', 'map_i_kunjis_potions_F1', 'generalStore');
checkMerchant('dzibim_khibu', 'map_i_carpenters', 'carpenterShop');
checkMerchant('jubmir', 'map_town', 'jubmirShop');
checkMerchant('garanki_gabu', 'map_northern_cliffs', 'garankiEnchanter');

area = 'map_town'; activeNPC = byId.get('kaboku_kunji'); // Proves map restrictions still apply to permanent shop access.
runtime.DialogueContent.resetDialogueState();
runtime.DialogueContent.beginNpcConversation(activeNPC);
assert.deepEqual(visibleChoices(), [], 'Fixed potion shop must not open outside its business map');

// Backstory belongs to editable loreBackground, not NPC speech or an accidental bio fallback.
for (const [npcId, part] of [
  ['kzubug', 'plague'], ['jubmir', 'noble blood'], ['binding_hatayap', 'wyrm'],
  ['tooth_hatayap', 'Tuhupnuk surname'], ['hammerhead_tuhupnuk', 'murdered'],
  ['khannibarri_agent', 'Father Hunundi'],
]) {
  const npc = byId.get(npcId); // Used to pin especially spoiler-prone details to the non-spoken backstory field.
  assert(npc.loreBackground?.includes(part), npcId + ': expected history was not migrated into loreBackground');
  assert(!npc.bio?.includes(part), npcId + ': historical detail remained in short bio');
}
for (const npc of composed.npcs) {
  assert(!/<suggestion:|design doc|source material|no further details provided/i.test(npc.bio || ''), npc.id + ': editorial writing notes must not appear in the short bio');
}
const originalWeather = deps.calendar.weather; // Used to force a condition-ineligible chat tree without mutating other test setup.
activeNPC = byId.get('gikali_ginju');
area = 'map_hobunji_town';
deps.calendar.weather = 'storm';
runtime.DialogueContent.resetDialogueState();
runtime.DialogueContent.beginNpcConversation(activeNPC);
assert.deepEqual(visibleChoices(), [], 'Storm fallback must not invent a special dialogue choice');
const stormLine = element('npcDialogueText').textContent; // Used to verify fallback resolves real casual speech, never narrator prose.
assert(stormLine.length > 0 && stormLine !== activeNPC.bio && !stormLine.includes('Gorobi\'s'), 'Condition-ineligible NPC must speak a regular greeting, not biography');
deps.calendar.weather = originalWeather;

activeNPC = byId.get('banubu'); // Banubu has no generic starter tree; its quest system supplies authored dialogue.
runtime.DialogueContent.resetDialogueState();
runtime.DialogueContent.beginNpcConversation(activeNPC);
assert.equal(element('npcDialogueText').textContent, '...', 'No eligible tree or spoken lines must not fall back to a Great Fey biography');
const spokenOverride = { id: 'test_spoken_override', bio: 'A secret written about the character.', dialogueLines: ['Hello from spoken dialogue.'], dialogueTrees: [] }; // Used to ensure deliberate authored speech still precedes generic fallback.
activeNPC = spokenOverride;
runtime.DialogueContent.resetDialogueState();
runtime.DialogueContent.beginNpcConversation(spokenOverride);
assert.equal(element('npcDialogueText').textContent, 'Hello from spoken dialogue.', 'Explicit dialogueLines must remain playable');

console.log('NPC dialogue: ' + giftNPCs + ' giftable NPCs / ' + giftLines + ' gift hints, ' + dateNPCs +
  ' romanceable NPCs / ' + dateLines + ' date hints; merchant shop actions, Chat and map restrictions verified.');
