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

const npcIds = ['pahu', 'spearhead_unumanuk', 'garanki_gabu', 'sloomi', 'dzibim_khibu', 'child_ab12', 'unassigned_wanderer']; // Fixture covers named, family, dynamic child, and default assignment.
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
assert.equal(byId.unassigned_wanderer.dialoguePersonalityFamily, personalities.defaultProfile);
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
for (const npc of Object.values(byId)) npc.dialogueTrees = [fallback(npc.id)];
const firstPahuLine = say(byId.pahu); // Conversation starts exactly once; .some() must not consume extra unheard entries while asserting.
assert.ok(config.characters.pahu.some(entry => entry.text === firstPahuLine), 'Pahu speaks his named dialogue instead of an unrelated personality line');
const firstSpearheadLine = say(byId.spearhead_unumanuk); // Named-only dialogue precedes the stern family.
assert.ok(config.characters.spearhead_unumanuk.some(entry => entry.text === firstSpearheadLine), 'Spearhead selects his own character dialogue');
const firstSloomiLine = say(byId.sloomi); // Reserved family should speak without accessing other families.
assert.ok(config.personalityFamilies.reserved.some(entry => entry.text === firstSloomiLine), 'Sloomi draws from Reserved, not general/shared world copy');
const firstChildLine = say(byId.child_ab12); // Generated children have no per-save authored NPC record.
assert.ok(config.personalityFamilies.child.some(entry => entry.text === firstChildLine), 'generated children receive child-appropriate dialogue');
const firstUnassignedLine = say(byId.unassigned_wanderer); // Missing assignment uses the existing default family.
assert.ok(config.personalityFamilies.neighborly.some(entry => entry.text === firstUnassignedLine), 'unassigned NPCs use the existing default family');
weather = 'rain';
const rainyPlayfulLine = say(byId.dzibim_khibu); // Rain condition is read at conversation time, not while iterating test assertions.
assert.ok(config.personalityFamilies.playful.some(entry => entry.text === rainyPlayfulLine), 'weather-conditioned family dialogue is eligible');
const scripted = { id: 'story_first', label: 'Story', trigger: 'interact', priority: 12, conditions: { encounter: ['first'] },
  entryNode: 'story', nodes: [{ id: 'story', type: 'text', text: 'SCRIPTED CHARACTER SCENE' }] }; // A specific authored tree should outrank ordinary family chatter.
byId.garanki_gabu.dialogueTrees.unshift(scripted);
assert.equal(say(byId.garanki_gabu), 'SCRIPTED CHARACTER SCENE', 'important NPC-specific story dialogue remains first');
const garankiChatter = say(byId.garanki_gabu); // The prior scripted tree advanced Garanki's per-NPC encounter history once.
assert.ok(config.characters.garanki_gabu.some(entry => entry.text === garankiChatter), 'named chatter becomes available after the scripted first encounter');
const shop = { id: 'shop_access', trigger: 'interact', generatedFromShopAccess: true, priority: 0, entryNode: 'shop',
  nodes: [{ id: 'shop', type: 'text', text: 'SHOP ACCESS' }] }; // Existing shop access stays reachable even when shared chatter is eligible.
byId.unassigned_wanderer.dialogueTrees.push(shop);
assert.equal(say(byId.unassigned_wanderer), 'SHOP ACCESS', 'shared chatter cannot displace generated shop access');
assert.notEqual(say(byId.sloomi), 'UNSCOPED FALLBACK', 'heard family dialogue still participates in normal cycling');

console.log('Scoped personality/character shared dialogue passed.');
