#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  traitsForDye,
  wornColorTraitsForNpc,
  deriveGiftPreferences,
} = require('./seed-npc-gift-preferences.js');

const db = JSON.parse(fs.readFileSync('docs/config/npcs/hobunji-starter-npc-database.json', 'utf8'));
assert.equal(db.npcs.length, 39, 'starter NPC database still has the expected roster');

for (const npc of db.npcs) {
  const expected = deriveGiftPreferences(npc);
  assert.deepEqual(npc.gifts, expected, `${npc.name} gift color preferences match the actually worn outfit`);

  const worn = wornColorTraitsForNpc(npc);
  for (const hue of worn.hues) {
    assert.equal((npc.gifts.disliked || []).includes(hue), false, `${npc.name} cannot dislike a hue they currently wear`);
  }
  for (const saturation of worn.saturations) {
    assert.equal((npc.gifts.hated || []).includes(saturation), false, `${npc.name} cannot hate a saturation trait they currently wear`);
  }
}

const byId = new Map(db.npcs.map(npc => [npc.id, npc]));
const mixedMutedCases = [
  'pahu',
  'foroji_funji',
  'jubmir',
  'father_hunundi_hodu',
  'kinami_kunji',
  'tooth_hatayap',
];
for (const id of mixedMutedCases) {
  const npc = byId.get(id);
  assert.ok(npc, `${id} exists`);
  assert.deepEqual(new Set(wornColorTraitsForNpc(npc).saturations), new Set(['hot', 'muted']), `${npc.name} visibly mixes hot and muted clothing`);
  assert.deepEqual(npc.gifts.hated, [], `${npc.name} hates neither saturation category while wearing both`);
}

const gorobi = byId.get('gorobi_ginju');
assert.deepEqual(wornColorTraitsForNpc(gorobi).saturations, ['muted'], 'Gorobi actually wears only runtime-muted dyes');
assert.deepEqual(gorobi.gifts.hated, ['hot'], 'Gorobi hates hot rather than the muted colors he wears');
assert.ok(gorobi.gifts.liked.includes('muted'), 'Gorobi likes the muted saturation present in his outfit');

assert.equal(traitsForDye('dye:CLOTH:muted_indigo').saturation, 'hot', 'named muted_* dyes remain runtime-hot at 60% saturation');
assert.equal(traitsForDye('dye:CLOTH:dark_muted_blue').saturation, 'hot', 'named dark_muted_* dyes remain runtime-hot at 60% saturation');
assert.equal(traitsForDye('dye:CLOTH:dusty_indigo').saturation, 'muted', 'dusty dyes are runtime-muted at 30% saturation');
assert.equal(traitsForDye('dye:CLOTH:smoky_green').saturation, 'muted', 'smoky dyes are runtime-muted at 30% saturation');

console.log('NPC worn-outfit gift color preferences passed.');
