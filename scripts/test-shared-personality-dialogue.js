#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..'); // Repository root for tested runtime and authored files.
const read = file => fs.readFileSync(path.join(root, file), 'utf8'); // Reads the shipping modules, not a duplicated test implementation.
const config = JSON.parse(read('docs/config/dialogue/shared-dialogue.json')); // Authored scoped shared conversation source.
const personalities = JSON.parse(read('docs/config/dialogue/npc-reaction-profiles.json')); // Existing single authority for personality assignments.
const localSource = read('docs/js/local-db-overrides.js'); // Database composition under test.
const contentSource = read('docs/js/dialogue-content.js'); // Real conversation picker/render entry under test.
const conditionsSource = read('docs/js/condition-registry.js'); // Same eligibility rules used by the runtime.

for (const source of [localSource, contentSource, conditionsSource]) assert.doesNotThrow(() => new vm.Script(source));
assert.equal(config.schema, 'hobunji_shared_dialogue.v1');
assert.deepEqual(Object.keys(config.personalityFamilies).sort(), Object.keys(personalities.profiles).sort(), 'every existing reaction personality has a shared speech family');
for (const [family, entries] of Object.entries(config.personalityFamilies)) {
  assert.ok(entries.length >= 2, family + ' has multiple shared lines');
  assert.equal(new Set(entries.map(entry => entry.id)).size, entries.length, family + ' line IDs are unique');
}

const npcIds = ['pahu', 'spearhead_unumanuk', 'garanki_gabu', 'sloomi', 'dzibim_khibu', 'child_ab12', 'unassigned_wanderer']; // Fixture covers named, family, dynamic child, and unassigned story NPCs.
const database = { schema: 'hobunji_npc_database.v2', npcs: npcIds.map(id => ({ id, name: id, dialogueTrees: [] })) }; // Minimal dialogue records for composition.
const fetchMock = async () => ({ ok: true, json: async () => ({}) }); // Species/creature registry bootstrap has no network dependency in this test.
const windowMock = { fetch: fetchMock, addEventListener() {} }; // Browser-like host for the actual LocalDBOverrides initializer.
const localContext = {
  window: windowMock, fetch: fetchMock, console, URL,
  document: { currentScript: { src: 'https://example.invalid/docs/js/local-db-overrides.js' }, readyState: 'complete', querySelector: () => ({}) },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  location: { href: 'https://example.invalid/docs/index.html' },
};
vm.runInNewContext(localSource, localContext, { filename: 'local-db-overrides.js' });
const compose = windowMock.LocalDBOverrides.applySharedDialogue; // Production composer exported for other editors and regression tests.
assert.equal(typeof compose, 'function');
const composed = compose(database, config, personalities);
assert.equal(database.npcs[0].sharedDialogueTrees, undefined, 'composition does not mutate original NPC database');
assert.equal(composed.npcs.length, database.npcs.length);
const byId = Object.fromEntries(composed.npcs.map(npc => [npc.id, npc])); // ID lookup used by the scoped-ownership assertions below.
assert.equal(byId.pahu.dialoguePersonalityFamily, 'playful');
assert.equal(byId.sloomi.dialoguePersonalityFamily, 'reserved');
assert.equal(byId.spearhead_unumanuk.dialoguePersonalityFamily, 'stern');
assert.equal(byId.child_ab12.dialoguePersonalityFamily, 'child');
assert.equal(byId.unassigned_wanderer.dialoguePersonalityFamily, null, 'unassigned special NPC is not given a generic personality');
assert.equal(byId.unassigned_wanderer.sharedDialogueTrees.length, 0, 'unassigned special NPC keeps only their own authored conversation');
assert.equal(byId.pahu.sharedDialogueTrees[0].sharedDialogueScope, 'character', 'named lines precede inherited family lines');
assert.equal(byId.pahu.sharedDialogueTrees[0].sharedDialogueOwner, 'pahu');
assert.ok(byId.pahu.sharedDialogueTrees.some(t => t.sharedDialogueOwner === 'playful'), 'named NPC retains family lines when no named line qualifies');
assert.ok(byId.sloomi.sharedDialogueTrees.every(t => t.sharedDialogueScope === 'personality'), 'other NPCs inherit only their family');
assert.equal(new Set(byId.pahu.sharedDialogueTrees.map(t => t.id)).size, byId.pahu.sharedDialogueTrees.length, 'generated tree history IDs cannot collide');
assert.ok(byId.pahu.sharedDialogueTrees.every(t => t.nodes.length === 2 && t.entryNode === t.nodes[0].id), 'shared lines use the standard text/end dialogue nodes');
assert.deepEqual(
  JSON.parse(JSON.stringify(compose(composed, config, personalities))),
  JSON.parse(JSON.stringify(composed)), 'composing a direct fetch and loadDatabase twice remains idempotent'
);

const speechEl = { textContent: '' }; // Captures the production renderer's resolved line without needing a canvas or audio device.
const doc = { getElementById: id => id === 'npcDialogueText' ? speechEl : null }; // Other UI elements are optional and skipped by the renderer.
const dialogueWindow = {
  SCRATCHBONES_CONFIG: { game: { npcDialogue: { text: { typewriter: { enabled: false } } } } },
  DialogueRichText: { parse: text => [{ text }], plain: runs => runs.map(run => run.text).join(''), render: (el, runs) => { el.textContent = runs.map(run => run.text).join(''); } },
  DevCompanion: null,
};
const sandbox = { window: dialogueWindow, console, performance: { now: () => 0 }, setTimeout, clearTimeout, Date, Math }; // Actual condition registry and dialogue runtime share a browser-like VM.
vm.createContext(sandbox);
vm.runInContext(conditionsSource, sandbox, { filename: 'condition-registry.js' });
sandbox.document = doc;
vm.runInContext(contentSource, sandbox, { filename: 'dialogue-content.js' });
let current = null; // Test-controlled active NPC record for dialogue world-state lookup.
let weather = 'clear'; // Test-controlled weather exercises conditioned shared dialogue.
const deps = {
  getDialogueWalker: () => ({ rec: current, currentScheduleTarget: null }), getDialogueOpen: () => false,
  getPlayerData: () => ({ nickname: 'Friend', appearance: { speciesId: 'mao-ao', gender: 'neutral' } }),
  getCurrentArea: () => 'map_hobunji_town', currentWeekdayName: () => 'Anan', currentSeason: () => ({ name: 'Longpour' }),
  calendar: { day: 4, get weather() { return weather; } }, fishingTimeOfDay: () => 'day',
  normalizeStationLabel: text => text, canAccessContent: () => true, closeNpcDialogue() {},
};
dialogueWindow.DialogueContent.init(deps);
function say(rec) { // Starts an actual normal Talk conversation and returns the text rendered by the existing UI.
  current = rec;
  speechEl.textContent = '';
  dialogueWindow.DialogueContent.beginNpcConversation(rec);
  return speechEl.textContent;
}
function fallback(id) { // The canonical last-resort NPC tree used to test shared family selection.
  const treeId = 'tree_' + id + '_fallback';
  return { id: treeId, label: 'Fallback', trigger: 'interact', priority: 0, entryNode: 'speak', nodes: [{ id: 'speak', type: 'text', text: 'UNSCOPED FALLBACK' }] };
}
for (const npc of Object.values(byId)) npc.dialogueTrees = [fallback(npc.id)]; // Named starter NPCs begin with their own authored fallback.
byId.child_ab12.dialogueTrees = []; // Generated children without a canonical NPC record can use their family straight away.
byId.pahu.dialogueTrees[0].nodes[0].text = '{{pool:Pahu Greetings}}'; // A canonical NPC fallback references an individual phrase pool by this token.
byId.pahu.phrasePools = [{
  id: 'pool_pahu_greetings', name: 'Pahu Greetings',
  entries: [
    { id: 'pahu_personal_1', text: 'ORIGINAL PAHU GREETING 1' },
    { id: 'pahu_personal_2', text: 'ORIGINAL PAHU GREETING 2', conditions: { timesOfDay: ['day'] } },
    { id: 'pahu_hint_placeholder', text: '<Write a gift hint here.>' },
  ],
}]; // Two genuine authored lines and an unfilled hint should keep family dialogue from taking over early, but the hint must not block it forever.
byId.sloomi.dialogueTrees[0].nodes[0].text = '{{pool:Sloomi Greetings}}';
byId.sloomi.phrasePools = [{ name: 'Sloomi Greetings', entries: [{ id: 'sloomi_personal', text: 'ORIGINAL SLOOMI GREETING' }] }]; // A single individual line also takes first turn.
const firstPahuLine = say(byId.pahu); // First Talk must preserve an authored personal greeting rather than use shared text.
const secondPahuLine = say(byId.pahu); // The next unheard individual greeting still wins.
assert.ok(['ORIGINAL PAHU GREETING 1', 'ORIGINAL PAHU GREETING 2'].includes(firstPahuLine));
assert.ok(['ORIGINAL PAHU GREETING 1', 'ORIGINAL PAHU GREETING 2'].includes(secondPahuLine));
assert.notEqual(firstPahuLine, secondPahuLine, 'both eligible personal greetings play before inherited material');
const namedPahuLine = say(byId.pahu); // Exhausted authored greetings hand off to named character shared lines.
assert.ok(config.characters.pahu.some(entry => entry.text === namedPahuLine), 'Pahu can use named shared speech once his individual greetings play');
const playfulPahuLine = say(byId.pahu); // Then the personality family supplements his exhausted unique copy.
assert.ok(config.personalityFamilies.playful.some(entry => entry.text === playfulPahuLine), 'Pahu inherits playful speech after his named line');
const firstSpearheadLine = say(byId.spearhead_unumanuk); // A plain-text character fallback keeps first greeting precedence too.
assert.equal(firstSpearheadLine, 'UNSCOPED FALLBACK', 'existing literal character greeting is not displaced on first meeting');
const secondSpearheadLine = say(byId.spearhead_unumanuk);
assert.ok(config.characters.spearhead_unumanuk.some(entry => entry.text === secondSpearheadLine), 'Spearhead then selects his character shared dialogue');
const firstSloomiLine = say(byId.sloomi); // Reserved family waits until her unique greeting has been heard.
assert.equal(firstSloomiLine, 'ORIGINAL SLOOMI GREETING');
const secondSloomiLine = say(byId.sloomi);
assert.ok(config.personalityFamilies.reserved.some(entry => entry.text === secondSloomiLine), 'Sloomi then draws from Reserved, not other personality speech');
const firstChildLine = say(byId.child_ab12); // Generated children have no default individual records.
assert.ok(config.personalityFamilies.child.some(entry => entry.text === firstChildLine), 'generated children receive child-appropriate dialogue');
const firstUnassignedLine = say(byId.unassigned_wanderer); // No explicit family assignment means no generic invented voice.
assert.equal(firstUnassignedLine, 'UNSCOPED FALLBACK', 'unassigned story NPC preserves their original fallback');
weather = 'rain';
const dzibimFirst = say(byId.dzibim_khibu);
assert.equal(dzibimFirst, 'UNSCOPED FALLBACK', 'ordinary personally authored dialogue gets first turn even in rain');
const rainyPlayfulLine = say(byId.dzibim_khibu); // Rain condition is read at the next conversation time.
assert.ok(config.personalityFamilies.playful.some(entry => entry.text === rainyPlayfulLine), 'weather-conditioned family dialogue is eligible');
const scripted = { id: 'story_first', label: 'Story', trigger: 'interact', priority: 12, conditions: { encounter: ['first'] },
  entryNode: 'story', nodes: [{ id: 'story', type: 'text', text: 'SCRIPTED CHARACTER SCENE' }] }; // A specific authored tree should outrank ordinary family chatter.
byId.garanki_gabu.dialogueTrees.unshift(scripted);
assert.equal(say(byId.garanki_gabu), 'SCRIPTED CHARACTER SCENE', 'important NPC-specific story dialogue remains first');
assert.equal(say(byId.garanki_gabu), 'UNSCOPED FALLBACK', 'unique fallback still plays after the story scene');
const garankiChatter = say(byId.garanki_gabu);
assert.ok(config.characters.garanki_gabu.some(entry => entry.text === garankiChatter), 'named chatter becomes available after the scripted and ordinary individual dialogue');
const shop = { id: 'shop_access', trigger: 'interact', generatedFromShopAccess: true, priority: 0, entryNode: 'shop',
  nodes: [{ id: 'shop', type: 'text', text: 'SHOP ACCESS' }] }; // Existing shop access stays reachable even when shared chatter is eligible.
byId.sloomi.dialogueTrees.push(shop);
assert.equal(say(byId.sloomi), 'SHOP ACCESS', 'shared chatter cannot displace generated shop access');
const anotherSloomiLine = say(byId.sloomi);
assert.ok(anotherSloomiLine === 'SHOP ACCESS' || config.personalityFamilies.reserved.some(entry => entry.text === anotherSloomiLine), 'repeated dialogue cannot leak unrelated personality speech');

const starter = JSON.parse(read('docs/config/npcs/hobunji-starter-npc-database.json')); // Full shipped character roster verifies existing authored greetings are never silently displaced.
const starterScoped = compose(starter, config, personalities);
assert.equal(starterScoped.npcs.length, starter.npcs.length, 'the shared layer preserves all starter NPC records');
let personalGreetingsChecked = 0; // Counts canonical, individual greeting pools exercised before shared speech is allowed.
for (let index = 0; index < starter.npcs.length; index++) {
  const original = starter.npcs[index]; // Existing authored dialogue must remain byte-for-byte equivalent after composition.
  const composedNpc = starterScoped.npcs[index]; // Runtime-composed record used to test first Talk selection and scopes.
  assert.deepEqual(JSON.parse(JSON.stringify(composedNpc.dialogueTrees || [])),
    JSON.parse(JSON.stringify(original.dialogueTrees || [])), original.id + ' authored tree changed');
  assert.deepEqual(JSON.parse(JSON.stringify(composedNpc.phrasePools || [])),
    JSON.parse(JSON.stringify(original.phrasePools || [])), original.id + ' authored phrase pool changed');
  const fallbackTree = original.dialogueTrees?.find(tree => tree.id === 'tree_' + original.id + '_fallback'); // Canonical starter fallbacks route through a personal phrase pool.
  if (!fallbackTree || !fallbackTree.nodes?.find(node => node.id === fallbackTree.entryNode)?.text?.includes('{{pool:')) continue;
  const speech = say(composedNpc); // A real NPC's first Talk should consume the normal personal greeting instead of inherited personality dialogue.
  const history = dialogueWindow.DialogueContent.getNpcDlgState(original.id); // The existing heardPoolEntries tracks genuine personal lines.
  assert.ok(history.heardPoolEntries.length >= 1, original.id + ' personal greeting pool was bypassed');
  assert.ok(speech && !/^<[^<>]+>$/.test(speech), original.id + ' showed an unfinished authoring placeholder');
  assert.ok(!speech.includes('{{pool:'), original.id + ' leaked an unresolved personal pool token');
  personalGreetingsChecked++;
}
assert.ok(personalGreetingsChecked >= 30, 'canonical starter roster exercised individual greetings widely enough');
console.log('Scoped personality/character shared dialogue passed (' + personalGreetingsChecked + ' real NPC first-greeting checks).');
