'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const helperSource = fs.readFileSync('docs/js/character-studio-mammakhbuur-config.js', 'utf8'); // Executes the exact pre-config hook loaded by Character Studio.
const window = {};
vm.runInNewContext(helperSource, { window, console });
const donorMale = {
  slots: [
    { slot: 'hairFront', label: 'Front Hair', options: [{ id: null }, { id: 'front-a' }] },
    { slot: 'hairBack', label: 'Back Hair', options: [{ id: null }, { id: 'back-a' }] },
  ],
  defaultCosmetics: { hairFront: 'front-a', hairBack: 'back-a' },
};
const donorFemale = {
  slots: [
    { slot: 'hairFront', label: 'Front Hair', options: [{ id: null }, { id: 'front-f' }] },
    { slot: 'hairBack', label: 'Back Hair', options: [{ id: null }, { id: 'back-f' }] },
  ],
};
const config = {
  game: {
    appearanceEditor: {
      species: { mashtzarr: { label: 'Mashtzarr', genders: ['male', 'female'], male: donorMale, female: donorFemale } },
      bodyPalettes: { mashtzarr: { male: [{ h: 1 }], female: [{ h: 2 }] } },
    },
  },
};
window.SCRATCHBONES_CONFIG = config; // Exercises the one-shot assignment hook used because panel-ui loads before scratchbones-config.js.
const appearance = window.SCRATCHBONES_CONFIG.game.appearanceEditor;
assert.equal(appearance.species.mammakhbuur.parentSpecies, 'mashtzarr');
for (const gender of ['male', 'female']) {
  const data = appearance.species.mammakhbuur[gender];
  assert(!data.slots.some(slot => slot.slot === 'hairFront'), gender + ' Character Studio Mammakhbuur front hair must be absent');
  assert.equal(data.forcedCosmetics.hairFront, null, gender + ' stale front hair must be suppressed');
}
assert(appearance.species.mammakhbuur.male.slots.some(slot => slot.slot === 'hairBack'), 'non-front-hair Mashtzarr cosmetics must remain inherited');
assert(appearance.species.mashtzarr.male.slots.some(slot => slot.slot === 'hairFront'), 'Mashtzarr front hair must remain untouched');
assert.deepEqual(JSON.parse(JSON.stringify(appearance.bodyPalettes.mammakhbuur)), JSON.parse(JSON.stringify(appearance.bodyPalettes.mashtzarr)));

const panelSource = fs.readFileSync('docs/js/panel-ui.js', 'utf8'); // Guards the loader path that makes Character Studio see the helper before its config assignment.
assert.match(panelSource, /character-studio-mammakhbuur-config\.js\?v=/);
assert.match(panelSource, /tools\\\/character-studio/);
console.log('Character Studio Mammakhbuur no-front-hair config checks passed.');
