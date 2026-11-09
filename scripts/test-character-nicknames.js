#!/usr/bin/env node
'use strict';

// First-syllable nickname unit and dialogue integration coverage without a browser.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8'); // Loads the actual runtime source.

const player = { nickname: 'Benjamin', appearance: { gender: 'male', speciesId: 'mao-ao' } }; // Test profile for all address paths.
const W = { SCRATCHBONES_CONFIG: { game: { socialRelationships: { relationships: [
  { type: 'friend', members: ['pahu', 'leaf'] }, { type: 'partner', members: ['gorobi', 'gikali'] },
  { type: 'friend', members: ['namui_u_hakaru', 'father_hunundi_hodu'] }, // Tests preservation of the Father's title when a friend greets him.
  { type: 'friend', members: ['other_friend', 'teacup_unumanuk'] }, // Tests Eldress honorifics without changing the existing game graph.
] } } }, CalendarSystem: { timeDebugSnapshot: () => ({ rawDay: 12 }), getHour: () => 10 } }; // Shared stubs for NPC social graph and romance calendar.
W.__hobunjiPlayerProfile = player; // The live romance module reads the same profile as dialogue.
const ctx = vm.createContext({ window: W, document: { getElementById: () => null }, console,
  Date, Math, JSON, Map, Set, WeakMap, Promise, setInterval: () => 1, clearInterval() {},
  fetch: async () => ({ ok: false }) });
function run(file) { vm.runInContext(read(file), ctx, { filename: file }); }
run('docs/js/name-nicknames.js');
const nick = W.CharacterNicknames; // Unit-facing pure name generator.
for (const [input, gender, expected] of [
  ['Pahu', 'male', 'Pah'], ['Pahu', 'female', 'Pa'], ['Jubmir', 'male', 'Jub'],
  ['Benjamin', 'male', 'Ben'], ['Nanahi', 'female', 'Na'], ['Nanahi', 'male', 'Nan'],
  ['Slangoro', 'male', 'Slang'], ['Sloomi', 'female', 'Sloo'], ['Sloomi', 'male', 'Sloom'],
  ["Mao'ao", 'female', 'Mao'], ['Elizabeth', 'male', 'El'],
  ['Leaf', 'female', 'Leaf'], ['Leaf', 'male', 'Leaf'], ['Kzangh', 'male', 'Kzangh'],
]) assert.equal(nick.firstSyllable(input, gender), expected, input + ' (' + gender + ')');
for (const [input, gender, expected] of [
  ['Benjamin', 'male', 'Beny'], ['Jubmir', 'male', 'Juby'], ['Pahu', 'male', 'Pahy'],
  ['Pahu', 'female', 'Pahy'], ['Leaf', 'female', 'Leafy'], ['Sloomi', 'female', 'Sloomy'],
  ['Nanahi', 'female', 'Nany'], ['Nanahi', 'male', 'Nany'], ['Nima', 'female', 'Nimy'],
  ['Kzangh', 'male', 'Kzanghy'],
]) assert.equal(nick.forRelationship(input, 'affectionate', gender), expected, input + ' (' + gender + ') affectionate');
assert.equal(nick.addressPlayer(player.nickname, 'friend', { favor: 2, gender: 'male' }), 'Ben');
assert.equal(nick.addressPlayer(player.nickname, 'neighbor', { favor: 1, gender: 'male' }), 'Benjamin');
assert.equal(nick.addressPlayer(player.nickname, 'friend', { favor: 3, customNickname: 'Sprout', gender: 'male' }), 'Sprout');
assert.equal(nick.preview('Sloomi', null, 2, 'female').friend, 'Sloo', 'mobile preview exposes the friend form');
assert.equal(nick.preview('Sloomi', null, 2, 'female').affectionate, 'Sloomy', 'mobile preview exposes the affectionate form');
assert.equal(nick.npcBond('pahu', 'leaf'), 'friend');
assert.equal(nick.npcBond('gorobi', 'gikali'), 'partner');

run('docs/config/romance-config.js');
run('docs/js/romance-system.js');
vm.runInContext(read('docs/js/dialogue-content.js').replace(
  '  window.DialogueContent = {', '  window.DialogueContent = { testTokens: _resolveTokens,'
), ctx);
vm.runInContext(read('docs/js/ambient-dialogue.js').replace(
  '  window.AmbientDialogue = api;', '  api._test = { playerNicknameFor, playerGreetingPolicy, conditionedPlayerNicknameFor, resolveDialogueNicknameTokens }; window.AmbientDialogue = api;'
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
assert.equal(dialogue.testTokens('{{playerNickname}} / {{playerName}}', friend.rec), 'Ben / Benjamin', 'friend named in a dialogue tree uses a short nickname without changing the full-name token');
assert.equal(ambient._test.resolveDialogueNicknameTokens('{{playerNickname}} / {{playerName}}', friend.rec, friend), 'Ben / Benjamin', 'ambient dialogue token resolution matches normal conversations');
assert.equal(dialogue.testTokens('{{playerLocalNickname}}', other.rec), 'Benjamin');
assert.equal(dialogue.testTokens('{{playerNickname}}', other.rec), 'Benjamin', 'acquaintances still use the full configured name');
assert.equal(ambient._test.playerNicknameFor(friend), 'Ben');
assert.equal(ambient._test.playerNicknameFor(other), 'Benjamin');
assert.equal(ambient.resolveTargetName({ rec: { id: 'pahu' } }, { id: 'leaf', name: 'Leaf' }), 'Leaf');
assert.equal(ambient.resolveTargetName({ rec: { id: 'gorobi' } }, { id: 'gikali', name: 'Gikali', gender: 'female' }), 'Giky');
assert.equal(ambient.resolveTargetName({ rec: { id: 'pahu' } }, { id: 'leaf', name: 'Pahu', gender: 'male' }), 'Pah', 'NPC friend uses the target male gender');
assert.equal(ambient.resolveTargetName({ rec: { id: 'pahu' } }, { id: 'leaf', name: 'Sloomi', gender: 'female' }), 'Sloo', 'NPC friend uses the target female gender');
assert.equal(ambient.resolveTargetName({ rec: { id: 'gorobi' } }, { id: 'gikali', name: 'Sloomi', rec: { appearance: { gender: 'female' } } }), 'Sloomy', 'NPC partner uses the target record gender');
assert.equal(ambient.resolveTargetName({ rec: { id: 'gorobi' } }, { id: 'gikali', name: 'Leaf', gender: 'male' }), 'Leafy', 'one-syllable NPC partner names get y');
assert.equal(ambient.resolveTargetName({ rec: { id: 'namui_u_hakaru' } }, { id: 'father_hunundi_hodu', name: 'Father Hunundi Hodu', gender: 'male' }), 'Father', 'NPC friends must not turn Father into Fath');
assert.equal(ambient.resolveTargetName({ rec: { id: 'other_friend' } }, { id: 'teacup_unumanuk', name: 'Eldress Teacup', gender: 'female' }), 'Eldress', 'NPC friends must not turn Eldress into El');
assert.equal(ambient.resolveTargetName({ rec: { id: 'namui_u_hakaru' } }, { id: 'father_hunundi_hodu', name: 'Pahu', gender: 'male' }), 'Pah', 'non-titled names still shorten normally');
romance.restore({ lastDateRawDay: { date_npc: 8 } }); // Legacy world save with only unambiguous day-level history.
assert.equal(romance.getLastDatedNpcId(), 'date_npc');
assert.equal(dialogue.testTokens('{{playerLocalNickname}}', dateNpc.rec), 'Beny');
assert.equal(ambient._test.playerNicknameFor(dateNpc), 'Beny');
romance.restore({ lastDateRawDay: { date_npc: 8, other_npc: 8 } }); // Two same-day dates cannot be reliably ordered in old saves.
assert.equal(romance.getLastDatedNpcId(), null, 'do not guess which old partner was last on a tie');
romance.restore({ lastDatedNpcId: 'date_npc', lastDateRawDay: { date_npc: 8, other_npc: 8 } });
assert.equal(romance.getLastDatedNpcId(), 'date_npc', 'new saves have exact order');
// The same target-gender rule must reach both dialogue tokens and world greetings.
for (const [name, gender, friendName, intimateName] of [
  ['Pahu', 'male', 'Pah', 'Pahy'], ['Sloomi', 'female', 'Sloo', 'Sloomy'],
  ['Nanahi', 'female', 'Na', 'Nany'], ['Leaf', 'female', 'Leaf', 'Leafy'],
]) {
  player.nickname = name;
  player.appearance.gender = gender;
  assert.equal(dialogue.testTokens('{{playerLocalNickname}}', friend.rec), friendName, name + ' friend conversation');
  assert.equal(dialogue.testTokens('{{playerNickname}}', friend.rec), friendName, name + ' friend generic token');
  assert.equal(ambient._test.resolveDialogueNicknameTokens('{{playerNickname}}', friend.rec, friend), friendName, name + ' friend ambient generic token');
  assert.equal(ambient._test.playerNicknameFor(friend), friendName, name + ' friend ambient greeting');
  assert.equal(dialogue.testTokens('{{playerLocalNickname}}', dateNpc.rec), intimateName, name + ' former date conversation');
  assert.equal(dialogue.testTokens('{{playerNickname}}', dateNpc.rec), intimateName, name + ' former date generic token');
  assert.equal(ambient._test.resolveDialogueNicknameTokens('{{playerNickname}}', dateNpc.rec, dateNpc), intimateName, name + ' former date ambient generic token');
  assert.equal(ambient._test.playerNicknameFor(dateNpc), intimateName, name + ' former date ambient greeting');
}
player.nickname = 'Benjamin';
player.appearance.gender = 'male'; // Restore the original player for the wedding assertions.
romance.completeWedding('other_npc');
assert.equal(dialogue.testTokens('{{playerLocalNickname}}', other.rec), 'Beny', 'spouse overrides the friend/low-Favor rule');
assert.equal(dialogue.testTokens('{{playerNickname}}', other.rec), 'Beny', 'generic nickname token follows married spouse');
assert.equal(ambient._test.resolveDialogueNicknameTokens('{{playerNickname}}', other.rec, other), 'Beny', 'ambient generic nickname follows married spouse');
assert.equal(ambient._test.playerNicknameFor(other), 'Beny');
assert.equal(romance.getLastDatedNpcId(), 'date_npc', 'marriage does not erase the last dated partner');
assert.equal(dialogue.testTokens('{{playerName}}', other.rec), 'Benjamin', 'canonical full name stays available');
assert.equal(romance.snapshot().lastDatedNpcId, 'date_npc', 'the mobile diagnostic exposes the relationship history');
console.log('First-syllable social nickname checks passed');
