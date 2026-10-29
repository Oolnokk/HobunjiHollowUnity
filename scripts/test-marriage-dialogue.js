#!/usr/bin/env node
'use strict';

// Exercise the shipped marriage state, ambient greeting selection and dialogue tokens together.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..'); // Root used to read the same runtime files the game loads.
const read = file => fs.readFileSync(path.join(root, file), 'utf8'); // Runtime source loader for this isolated integration test.
const player = { nickname: 'Nima', appearance: { speciesId: 'mao-ao', gender: 'female' } }; // Stable player identity for token expectations.
const windowStub = {
  SCRATCHBONES_CONFIG: { game: {} },
  CalendarSystem: { timeDebugSnapshot: () => ({ rawDay: 10 }), getHour: () => 10 },
  HobunjiActivityEvents: { emit() {} },
};
const context = vm.createContext({
  window: windowStub, document: { getElementById: () => null },
  console, Date, Math, JSON, Map, Set, WeakMap, Promise,
  setInterval: () => 1, clearInterval() {},
  fetch: async () => ({ ok: false }), // The embedded default greeting configuration is sufficient here.
});
const run = file => vm.runInContext(read(file), context, { filename: file }); // Executes real module initialization without browser assets.
run('docs/config/romance-config.js');
run('docs/js/romance-system.js');
vm.runInContext(read('docs/js/dialogue-content.js').replace(
  '  window.DialogueContent = {',
  '  window.DialogueContent = { testTokens: _resolveTokens,'
), context);
vm.runInContext(read('docs/js/ambient-dialogue.js').replace(
  '  window.AmbientDialogue = api;',
  '  api._test = { greetingLinesFor, playerNicknameFor, playerGreetingPolicy, templateLine }; window.AmbientDialogue = api;'
), context);
const romance = windowStub.RomanceSystem; // Owns persisted wedding state and post-wedding dialogue lookup.
const dialogue = windowStub.DialogueContent; // Resolves {{playerLocalNickname}} in regular conversations.
const ambient = windowStub.AmbientDialogue; // Selects actual proximity greeting pools and player forms of address.
dialogue.init({ getPlayerData: () => player, calendar: { day: 10 } }); // Wedding memory writes need the ordinary dialogue calendar dependency.
ambient.init({ getPlayerName: () => player.nickname, getWeekDay: () => 'Anan', getDayPart: () => 'morning' });

const sloomi = { rec: { id: 'sloomi', name: 'Sloomi', phrasePools: [] } }; // Romantic NPC used to verify before/after and restoration.
const neighbor = { rec: { id: 'gorobi_ginju', name: 'Gorobi Ginju', phrasePools: [] } }; // Unmarried neighbor must retain normal greeting rules.
dialogue.getNpcDlgState('sloomi').favor = -2;
dialogue.getNpcDlgState('sloomi').localNickname = 'Sprout';
assert.equal(romance.spouseDialogueFor('sloomi'), null, 'no spouse dialogue before marriage');
assert.equal(dialogue.testTokens('{{playerLocalNickname}}', sloomi.rec), 'Sprout', 'pre-marriage local nickname remains');
assert.equal(ambient._test.playerNicknameFor(sloomi), 'Sprout');
assert.equal(ambient._test.playerGreetingPolicy(neighbor).mayUseActualName, false, 'unmarried greeting favor gate unchanged');
const ordinaryGreetings = ambient._test.greetingLinesFor('sloomi', 'player'); // Ordinary pool used to verify the marriage switch reverses on restore.
const npcGreetings = ambient._test.greetingLinesFor('sloomi', 'gorobi_ginju'); // NPC-to-NPC lines must not become spouse greetings.
assert.ok(ordinaryGreetings.length);
romance.completeWedding('sloomi');
const married = romance.spouseDialogueFor('sloomi'); // Marriage-specific lines and nickname resolved from config.
assert.equal(married.nickname, 'sweetheart');
assert.equal(romance.spouseDialogueFor('gorobi_ginju'), null, 'marriage is exclusive to the actual spouse');
assert.equal(dialogue.testTokens('{{playerLocalNickname}} / {{playerName}}', sloomi.rec), 'sweetheart / Nima');
assert.equal(dialogue.testTokens('{{playerLocalNickname}}', neighbor.rec), 'Nima', 'other NPC token fallback unaffected');
assert.equal(ambient._test.playerNicknameFor(sloomi), 'sweetheart');
assert.equal(ambient._test.playerGreetingPolicy(sloomi).allowed, true, 'marriage outranks stale low-favor greeting restrictions');
assert.equal(ambient._test.playerGreetingPolicy(sloomi).mayUseActualName, true);
assert.equal(ambient._test.playerGreetingPolicy(neighbor).mayUseActualName, false);
assert.equal(ambient._test.greetingLinesFor('sloomi', 'player').length, married.greetings.length);
assert.match(ambient._test.templateLine('sweetheart', 'sloomi', 'player', 10, { walker: sloomi }), /sweetheart/);
assert.deepEqual(Array.from(ambient._test.greetingLinesFor('sloomi', 'gorobi_ginju')), Array.from(npcGreetings), 'NPC-to-NPC greeting path remains normal');

const saved = JSON.parse(JSON.stringify(romance.serialize())); // Snapshot used to test save restoration and preserve existing dialogue nickname.
romance.restore(null);
assert.equal(romance.spouseDialogueFor('sloomi'), null, 'reset removes the marriage-only override');
assert.equal(dialogue.testTokens('{{playerLocalNickname}}', sloomi.rec), 'Sprout', 'marriage did not overwrite saved nickname');
assert.equal(ambient._test.playerNicknameFor(sloomi), 'Sprout');
assert.deepEqual(Array.from(ambient._test.greetingLinesFor('sloomi', 'player')), Array.from(ordinaryGreetings));
romance.restore(saved);
assert.equal(romance.spouseDialogueFor('sloomi').nickname, 'sweetheart', 'a saved marriage restores its greeting layer');
romance.restore(null);
romance.completeWedding('unknown_romance_npc');
assert.equal(romance.spouseDialogueFor('unknown_romance_npc').nickname, 'love', 'unlisted spouses use the shared default');
assert.ok(romance.spouseDialogueFor('unknown_romance_npc').greetings.length);
for (const [npcId, entry] of Object.entries(windowStub.SCRATCHBONES_CONFIG.game.romance.spouse.dialogue.byNpc)) {
  assert.ok(entry.nickname && entry.greetings.length >= 2, npcId + ' has a personalized post-wedding voice');
  assert.ok(entry.greetings.every(line => line.includes('{targetName}')), npcId + ' greetings use the shared address token');
}
console.log('Marriage greeting and nickname integration checks passed');
