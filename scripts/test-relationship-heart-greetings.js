'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const dialogueSource = fs.readFileSync(path.join(root, 'docs/js/dialogue-content.js'), 'utf8'); // Used to execute the shipped relationship-heart renderer in isolation.
const ambientSource = fs.readFileSync(path.join(root, 'docs/js/ambient-dialogue.js'), 'utf8'); // Used to execute the shipped player-greeting policy helpers in isolation.

function extract(source, startPattern, endPattern, label) {
  const start = source.search(startPattern); // Used to locate the beginning of the runtime helper block under test.
  assert.notEqual(start, -1, `Could not locate ${label} start`);
  const tail = source.slice(start); // Used to search for the helper block's terminating marker without changing source offsets.
  const endMatch = tail.match(endPattern); // Used to stop extraction immediately before unrelated browser/runtime code.
  assert.ok(endMatch, `Could not locate ${label} end`);
  return tail.slice(0, endMatch.index);
}

const heartBlock = extract(
  dialogueSource,
  /function renderRelationshipHearts\(rec\)/,
  /\n\n  \/\/ Clears the active conversation/,
  'renderRelationshipHearts'
);

const relationshipState = { favor: 0 }; // Used by the isolated renderer to simulate each relationship score.
const renderRelationshipHearts = new Function(
  'getNpcDlgState',
  `${heartBlock}\nreturn renderRelationshipHearts;`
)(() => relationshipState);

function heartsAt(favor) {
  relationshipState.favor = favor;
  return renderRelationshipHearts({ id: 'test_npc', relationship: true });
}

assert.equal(heartsAt(-5), `🩶${'🤍'.repeat(14)}`, '-5 starts filling the first heart');
assert.equal(heartsAt(-1), `💜💜💜💜🩶${'🤍'.repeat(10)}`, '-1 has four completed purple hearts and fills the fifth');
assert.equal(heartsAt(0), `💜💜💜💜💜🩶${'🤍'.repeat(9)}`, 'neutral fills the sixth heart after five negative purple hearts');
assert.equal(heartsAt(1), `💜💜💜💜💜❤️🩶${'🤍'.repeat(8)}`, '+1 is exactly one completed red heart');
assert.equal(heartsAt(2), `💜💜💜💜💜❤️❤️🩶${'🤍'.repeat(7)}`, '+2 is exactly two completed red hearts');
assert.equal(heartsAt(10), `💜💜💜💜💜${'❤️'.repeat(10)}`, '+10 completes the whole relationship meter');

const greetingBlock = extract(
  ambientSource,
  /const PLAYER_GREETING_NAME_EXCEPTIONS/,
  /\n\n  function templateLine/,
  'player greeting policy helpers'
);

const favorByNpc = new Map(); // Used by the isolated greeting policy to supply live per-NPC favor values.
let playerSpeciesId = 'tletingan'; // Used by the isolated Kinami policy to switch Mao'ao versus non-Mao'ao behavior.
const playerNickname = 'Ben'; // Used to verify already-resolved pending-request call-over nicknames are removed below +1.
const fakeWindow = {
  DialogueContent: {
    getNpcDlgState(npcId) {
      return { favor: favorByNpc.get(npcId) ?? 0 };
    },
  },
};
const fakeState = {
  dialogueDeps: {
    getPlayerData() {
      return { nickname: playerNickname, appearance: { speciesId: playerSpeciesId } };
    },
  },
  deps: {
    getPlayerName() {
      return playerNickname;
    },
    getPlayerSpecies() {
      return playerSpeciesId;
    },
  },
};

const greetingPolicy = new Function(
  'window',
  'state',
  `${greetingBlock}\nreturn { playerGreetingAllowed, playerGreetingMayUseName, omitGreetingTargetName, omitResolvedGreetingTargetName };`
)(fakeWindow, fakeState);

function walker(id) {
  return { rec: { id } };
}

favorByNpc.set('takua_ao_hakaru', 0);
assert.equal(greetingPolicy.playerGreetingAllowed(walker('takua_ao_hakaru')), false, "Taku'a does not greet below +1");
favorByNpc.set('takua_ao_hakaru', 1);
assert.equal(greetingPolicy.playerGreetingAllowed(walker('takua_ao_hakaru')), true, "Taku'a greets at +1");

favorByNpc.set('kinami_kunji', 1);
playerSpeciesId = 'tletingan';
assert.equal(greetingPolicy.playerGreetingAllowed(walker('kinami_kunji')), false, 'Kinami does not greet a non-Mao\'ao player below +2');
favorByNpc.set('kinami_kunji', 2);
assert.equal(greetingPolicy.playerGreetingAllowed(walker('kinami_kunji')), true, 'Kinami greets a non-Mao\'ao player at +2');
favorByNpc.set('kinami_kunji', 0);
playerSpeciesId = 'mao-ao';
assert.equal(greetingPolicy.playerGreetingAllowed(walker('kinami_kunji')), true, "Kinami's +2 gate does not apply to Mao'ao players");

playerSpeciesId = 'tletingan';
favorByNpc.set('gorobi_ginju', 0);
assert.equal(greetingPolicy.playerGreetingMayUseName(walker('gorobi_ginju')), false, 'ordinary NPCs omit names below +1');
favorByNpc.set('gorobi_ginju', 1);
assert.equal(greetingPolicy.playerGreetingMayUseName(walker('gorobi_ginju')), true, 'ordinary NPCs may use names at +1');
for (const id of ['father_hunundi_hodu', 'teacup_unumanuk', 'spearhead_unumanuk', 'jubmir']) {
  favorByNpc.set(id, -5);
  assert.equal(greetingPolicy.playerGreetingMayUseName(walker(id)), true, `${id} remains a low-favor naming exception`);
}

assert.equal(greetingPolicy.omitGreetingTargetName('Hello, {targetName}!'), 'Hello!', 'comma-wrapped target names remove cleanly');
assert.equal(greetingPolicy.omitGreetingTargetName('{targetName}! Good to see you.'), 'Good to see you.', 'leading target names remove cleanly');
assert.equal(greetingPolicy.omitGreetingTargetName('Good {dayPart}, {targetName}!'), 'Good {dayPart}!', 'other greeting placeholders remain intact when the player name is removed');
assert.equal(greetingPolicy.omitResolvedGreetingTargetName('Hey, Ben. You need work?', playerNickname), 'Hey. You need work?', 'resolved request call-over nicknames remove cleanly below +1');
assert.equal(greetingPolicy.omitResolvedGreetingTargetName('Thank the breath, there you are, Ben.', playerNickname), 'Thank the breath, there you are.', 'trailing resolved request call-over nicknames remove cleanly below +1');

console.log('relationship heart/greeting regression checks passed');
