#!/usr/bin/env node
'use strict';
// Voice-bridge regression: the real Shattercasks carry registry is the sole proxy authority.
// Separate from baby-burden geometry tests so future mesh changes cannot collide with voice coverage.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const speechRecords = new Map(); // Emulates AmbientDialogue's dynamic per-NPC greeting registration.
const burdens = new Map(); // Emulates Shattercasks current-zone burden registry without copying a baby pose rig.
let carryBy = null; // Current parent holding the newborn, used by frozen family-burden carrying().
let flying = false; // Airborne state, used to verify the invisible-cradle ghost-bubble guard.
const window = {
  AmbientDialogue: { setNpcGreetings(id, pool) {
    if (pool) speechRecords.set(id, pool); else speechRecords.delete(id);
    return true;
  } },
  FamilyBabyBurdens: {
    carrying: id => id === 'child_voice' && ['player', 'spouse'].includes(carryBy),
    isProxyActive: id => id === 'child_voice' && (flying || !!carryBy),
  },
  Shattercasks: { getBurden(id) { return burdens.get(id) || null; } },
};
vm.runInNewContext(fs.readFileSync('docs/js/family-baby-ambient-voice.js', 'utf8'), { window });
const speech = window.FamilyBabyAmbientVoice;
const config = {
  babyAmbientNoises: ['Agoo!', 'Gah-bah!', 'Eeh!'],
  toddlerAmbientGreetings: ['Da!', 'Up!', 'Hiya!'],
};
assert.equal(speech.sound('child_voice', true, config, () => 0), 'Agoo!');
assert.equal(speech.sound('child_voice', true, config, () => .99), 'Eeh!');
assert.equal(speech.sound('child_voice', false, config, () => 0), null, 'Toddlers do not babble');
assert.equal(speech.sound('child_voice', true, {}, () => 0), 'Agoo!', 'Missing config uses safe phonetic fallback');
assert.equal(speech.sync('child_voice', 'basket', config), true);
assert.deepEqual([...speechRecords.get('child_voice').player], config.babyAmbientNoises);
assert.equal(speech.sync('child_voice', 'toddler', config), true);
assert.deepEqual([...speechRecords.get('child_voice').player], config.toddlerAmbientGreetings);
assert.equal(speech.sync('child_voice', 'child', config), true);
assert.ok(speechRecords.get('child_voice').player.some(line => line.includes('Can we play later?')));
assert.equal(speech.sync('child_voice', 'basket', config), true);

const baby = {
  id: 'family_baby_child_voice', mapId: 'interior', flying: false,
  group: { visible: true, name: 'new posed baby proxy' },
}; // The new main-branch posed rig still uses exactly this Shattercasks physical burden record.
burdens.set(baby.id, baby);
assert.equal(speech.anchorFor('child_voice'), null, 'Basket child uses its real walker, not the invisible proxy');
carryBy = 'player';
assert.equal(speech.anchorFor('child_voice'), baby, 'Player hands/back uses the existing physical burden');
carryBy = 'spouse';
assert.equal(speech.anchorFor('child_voice'), baby, 'Spouse carry uses the same authoritative physical burden');
baby.group.visible = false;
assert.equal(speech.anchorFor('child_voice'), null, 'Hidden proxy cannot become a ghost-bubble anchor');
baby.group.visible = true;
baby.flying = true; flying = true;
assert.equal(speech.anchorFor('child_voice'), null, 'Thrown burden cannot speak from the old basket');
assert.equal(speech.isProxyActive('child_voice'), true, 'Existing burden owner still controls all carried/throw state');
baby.flying = false; flying = false;
burdens.delete(baby.id);
assert.equal(speech.anchorFor('child_voice'), null, 'Zone unload or missing burden fails closed');
burdens.set(baby.id, baby);
speech.clear();
assert.equal(speechRecords.size, 0, 'Restoring a different family clears its dynamic greeting pools');
assert.equal(speech.sync('child_voice', 'basket', config), true, 'Cleared stage registration can be re-established');
assert.ok(speechRecords.has('child_voice'));
console.log('Family baby ambient voice bridge passed: all stages, parents, hidden/airborne/missing burdens and world restore.');
