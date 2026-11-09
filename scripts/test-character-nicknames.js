#!/usr/bin/env node
'use strict';

// First-syllable nickname unit and dialogue integration coverage without a browser.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8'); // Loads the actual runtime source.

const player = { nickname: 'Benjamin', appearance: { gender: 'male', speciesId: 'mao-ao' } }; // Test profile for all address paths.
const romantic = { date: null, spouse: null, lastDatedNpcId: null }; // Persisted romance state supplied through the real RomanceSystem.
const W = { SCRATCHBONES_CONFIG: { game: { socialRelationships: { relationships: [
  { type: 'friend', members: ['pahu', 'leaf'] }, { type: 'partner', members: ['gorobi', 'gikali'] },
] } } }, CalendarSystem: { timeDebugSnapshot: () => ({ rawDay: 12 }), getHour: () => 10 } }; // Shared stubs for NPC social graph and romance calendar.
const ctx = vm.createContext({ window: W, document: { getElementById: () => null }, console,
  Date, Math, JSON, Map, Set, WeakMap, Promise, setInterval: () => 1, clearInterval() {},
  fetch: async () => ({ ok: false }) });
function run(file) { vm.runInContext(read(file), ctx, { filename: file }); }
run('docs/js/name-nicknames.js');
const nick = W.CharacterNicknames; // Unit-facing pure name generator.
for (const [input, expected] of [
  ['Pahu', 'Pa'], ['Jubmir', 'Jub'], ['Benjamin', 'Ben'], ['Nanahi', 'Na'],
  ['Slangoro', 'Slang'], ['Sloomi', 'Sloo'], ["Mao'ao", 'Mao'],
  ['Elizabeth', 'El'], ['Leaf', 'Leaf'], ['Kzangh', 'Kzangh'],
]) assert.equal(nick.firstSyllable(input), expected, input);
assert.equal(nick.forRelationship('Benjamin', 'affectionate'), 'Benny');
assert.equal(nick.forRelationship('Jubmir', 'affectionate'), 'Jubby');
assert.equal(nick.forRelationship('Pahu', 'affectionate'), 'Pay');
assert.equal(nick.forRelationship('Leaf', 'affectionate'), 'Leaf', 'monosyllables stay as-is');
assert.equal(nick.addressPlayer(player.nickname, 'friend', { favor: 2 }), 'Ben');
assert.equal(nick.addressPlayer(player.nickname, 'neighbor', { favor: 1 }), 'Benjamin');
assert.equal(nick.addressPlayer(player.nickname, 'friend', { favor: 3, customNickname: 'Sprout' }), 'Sprout');
assert.equal(nick.npcBond('pahu', 'leaf'), 'friend');
assert.equal(nick.npcBond('gorobi', 'gikali'), 'partner');

run('docs/config/romance-config.js');
run('docs/js/romance-system.js');
vm.runInContext(read('docs/js/dialogue-content.js').replace(
  '  window.DialogueContent = {', '  window.DialogueContent = { testTokens: _resolveTokens,'
), ctx);
vm.runInContext(read('docs/js/ambient-dialogue.js').replace(
  '  window.AmbientDialogue = api;', '  api._test = { playerNicknameFor, playerGreetingPolicy, conditionedPlayerNicknameFor }; window.AmbientDialogue = api;'
), ctx);
const romance = W.RomanceSystem; // Existing authoritative save and date owner.
const dialogue = W.DialogueContent; // Authored dialogue token resolution.
const ambient = W.AmbientDialogue; // Proximity-greeting target names.
dialogue.init({ getPlayerData: () => player, calendar: { day: 12 } });
ambient.init({ getPlayerName: () => player.nickname, getWeekDay: () => 'Anan', getDayPart: () => 'morning' });
const dateNpc = { rec: { id: 'date_npc', name: 'Namui', phrasePools: [] } }; // Last-dated speaker in both dialogue paths.
const friend = { rec: { id: 'friend_npc', name: 'Pahu', phrasePools: [] } }; // Friend at Tier 1.
const other = { rec: { id: 'other_npc', name: 'Leaf', phrasePools: [] } }; // Ordinary acquaintance.
dialogue.getNpcDlgState('friend_npc').favor = 2;
dialogue.getNpcDlgState('other_npc').favor = 1;
assert.equal(dialogue.testTokens('{{playerLocalNickname}}', friend.rec), 'Ben');
assert.equal(dialogue.testTokens('{{playerLocalNickname}}', other.rec), 'Benjamin');
assert.equal(ambient._test.playerNicknameFor(friend), 'Ben');
assert.equal(ambient._test.playerNicknameFor(other), 'Benjamin');
assert.equal(ambient.resolveTargetName({ rec: { id: 'pahu' } }, { id: 'leaf', name: 'Leaf' }), 'Leaf');
assert.equal(ambient.resolveTargetName({ rec: { id: 'gorobi' } }, { id: 'gikali', name: 'Gikali' }), 'Giky');
romance.restore({ lastDateRawDay: { date_npc: 8 } }); // Legacy world save with only unambiguous day-level history.
assert.equal(romance.getLastDatedNpcId(), 'date_npc');
assert.equal(dialogue.testTokens('{{playerLocalNickname}}', dateNpc.rec), 'Benny');
assert.equal(ambient._test.playerNicknameFor(dateNpc), 'Benny');
romance.restore({ lastDateRawDay: { date_npc: 8, other_npc: 8 } }); // Two same-day dates cannot be reliably ordered in old saves.
assert.equal(romance.getLastDatedNpcId(), null, 'do not guess which old partner was last on a tie');
romance.restore({ lastDatedNpcId: 'date_npc', lastDateRawDay: { date_npc: 8, other_npc: 8 } });
assert.equal(romance.getLastDatedNpcId(), 'date_npc', 'new saves have exact order');
romance.completeWedding('other_npc');
assert.equal(dialogue.testTokens('{{playerLocalNickname}}', other.rec), 'Benny', 'spouse overrides the friend/low-Favor rule');
assert.equal(ambient._test.playerNicknameFor(other), 'Benny');
assert.equal(romance.getLastDatedNpcId(), 'date_npc', 'marriage does not erase the last dated partner');
assert.equal(dialogue.testTokens('{{playerName}}', other.rec), 'Benjamin', 'canonical full name stays available');
assert.equal(romance.snapshot().lastDatedNpcId, 'date_npc', 'the mobile diagnostic exposes the relationship history');
console.log('First-syllable social nickname checks passed');
