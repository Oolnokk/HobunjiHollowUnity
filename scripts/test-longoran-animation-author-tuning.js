#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict'); // Exercises the real Longoran bridge without a canvas.
const fs = require('node:fs'); // Loads shipped source files.
const vm = require('node:vm'); // Isolates editor and gameplay browser contexts.
const runtime = fs.readFileSync('docs/js/longoran-species-runtime.js', 'utf8'); // Canonical Longoran inheritance and tunings.
const authored = fs.readFileSync('docs/js/character-scale-comparison.js', 'utf8'); // Full Character Scale controls.
const state = new Map(); // Simulated same-origin storage shared by author and gameplay.
const localStorage = {
  getItem(key) { return state.has(key) ? state.get(key) : null; },
  setItem(key, value) { state.set(key, value); },
  removeItem(key) { state.delete(key); },
}; // Retains the exact text payload the editor writes, not an in-memory object alias.

function makeContext(pathname) {
  const rig = { characters: {
    'tletingan::male': { species: 'tletingan', gender: 'male', anatomy: { handScale: 1 } },
    'tletingan::female': { species: 'tletingan', gender: 'female', anatomy: { handScale: 1 } },
  } }; // Both baseline Tletingan genders have authorable attachment rigs.
  const win = {
    localStorage,
    HOBUNJI_ATTACHMENT_RIG_PROFILES: rig,
    SCRATCHBONES_CONFIG: { game: {
      appearanceEditor: {
        species: { tletingan: { label: 'Tletingan', genders: ['male','female'], male: {}, female: {} } },
        bodyPalettes: { tletingan: { male: [], female: [] } },
      },
      assets: { pngPlaneAvatar: { behindView: { headUrls: { tletingan: { male: 'back', female: 'back' } } }, proceduralFeet: {} } },
      portrait: { armOnlyOpacityMask: { profiles: {} } },
    } },
  }; // Minimal complete early config ensures real inherited species profiles are registered.
  const ctx = { window: win, location: { pathname }, document: { addEventListener() {} }, console };
  vm.runInNewContext(runtime, ctx);
  return win;
}

const author = makeContext('/tools/animation-author/index.html');
const api = author.HobunjiLongoranSpecies;
assert(api, 'Longoran bridge must load in Animation Author');
for (const gender of ['male','female']) {
  assert(author.HOBUNJI_ATTACHMENT_RIG_PROFILES.characters['longoran::' + gender], 'Longoran ' + gender + ' needs a rig descriptor in the full-character lineup');
  assert.equal(api.gaitFor(gender).lurchDegrees, 19);
  assert.equal(api.spineFor(gender).hunch, .75);
}
assert.equal(api.setAuthorTuning('male', { spine: { hunch: .91, kyphosis: .94 }, gait: { lurchDegrees: 22.5, cadence: .59, dragSide: 'left' } }), true);
assert.equal(api.spineFor('male').hunch, .91);
assert.equal(api.spineFor('female').hunch, .75, 'The female profile must not inherit male editor changes');
assert.equal(api.gaitFor('male').lurchDegrees, 22.5);
assert.equal(api.gaitFor('male').dragSide, 'left');
assert.equal(api.gaitFor('female').lurchDegrees, 19);
assert(state.has('hobunjiLongoranAuthorTuning.v1'), 'Tuning must persist after leaving Full Character Scale');
assert.equal(author.HOBUNJI_ATTACHMENT_RIG_PROFILES.characters['longoran::male'].anatomy.longoranSpine.hunch, .91);
assert.equal(api.exportAuthorTuning().male.gait.cadence, .59);

const gameplay = makeContext('/index.html');
const gameApi = gameplay.HobunjiLongoranSpecies;
assert.equal(gameApi.gaitFor('male').lurchDegrees, 22.5, 'Game must load same-origin edited Longoran gait');
assert.equal(gameApi.spineFor('male').hunch, .91, 'Game must load the edited forward-curve values');
assert.equal(gameApi.gaitFor('female').lurchDegrees, 19, 'Unedited female gait keeps the shipped defaults');
assert.equal(gameApi.setAuthorTuning('female', { spine: { hunch: 1 } }), false, 'Game pages must not mutate authoring settings');

vm.runInNewContext(fs.readFileSync('docs/js/character-spine.js', 'utf8'), { window: gameplay });
assert.equal(gameplay.HobunjiCharacterSpine.resolve({ speciesId: 'longoran', gender: 'male' }).hunch, .91);
assert.equal(gameplay.HobunjiCharacterSpine.resolve({ speciesId: 'longoran', gender: 'female' }).hunch, .75);
assert.equal(gameplay.HobunjiCharacterSpine.resolve({ speciesId: 'longoran', gender: 'male', spine: { hunch: .2 } }).hunch, .2, 'Explicit NPC/Maskbound posture must win');

assert(authored.includes("longoranRow('Lurch'"), 'Full Character Scale must offer lurch angle editing');
assert(authored.includes('window.HobunjiLongoranSpecies?.setAuthorTuning'), 'Animation Author sliders must publish runtime tuning');
assert(authored.includes('refreshLongoranSpine'), 'Spine sliders must visibly deform the portrait');
assert(authored.includes('rebuildLongoranFeet'), 'Gait changes must rebuild the actual procedural leg solver');
assert(authored.includes('toggleLongoranWalk'), 'Walking pose must be previewable in the author');
assert(authored.includes('stopLongoranWalk();'), 'Closing the tool must dispose the opt-in preview');
assert(fs.readFileSync('docs/game.js', 'utf8').includes("this._npcRunning || appearance.speciesId === 'longoran'"), 'Ordinary walking Longoran NPCs must apply the same body pitch as their feet');
console.log('Longoran male/female Animation Author tuning, persistence, gameplay posture and walking preview: PASS');
