#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const reverbSource = fs.readFileSync(path.join(root, 'docs/js/environmental-reverb.js'), 'utf8');
const vocalSource = fs.readFileSync(path.join(root, 'docs/js/animal-vocalizations.js'), 'utf8');

assert.doesNotThrow(() => new vm.Script(reverbSource), 'environmental reverb module parses');
assert.match(vocalSource, /environmental-reverb\.js/, 'animal vocal bootstrap loads environmental reverb');
assert.match(reverbSource, /parallel wet-only layer/, 'dry playback is intentionally left untouched');
assert.match(reverbSource, /\/music\\\/|\\\/bgm\\\//, 'score is excluded from world reverb routing');
assert.match(reverbSource, /ANIMAL_EXTRA_WET/, 'animals receive a small extra reverb tail');
assert.match(reverbSource, /__independentAnimalVoiceWrapped/, 'animal wet tail waits for the independent WSOLA adapter');

const window = {
  SCRATCHBONES_CONFIG: { game: { audio: { environmentalReverb: {} } } },
};
vm.runInNewContext(reverbSource, {
  window,
  document: undefined,
  console,
  Math,
  Number,
  String,
  Object,
  Map,
  WeakMap,
  Set,
  Promise,
  URL,
  fetch: undefined,
  setTimeout,
  clearTimeout,
}, { filename: 'environmental-reverb.js' });

const R = window.EnvironmentalReverb;
assert.ok(R, 'module exports EnvironmentalReverb');
const town = R.profileForArea('map_hobunji_town');
const forest = R.profileForArea('cloud-forest-wilderness');
const interior = R.profileForArea('map_i_general_store');
const temple = R.profileForArea('map_i_temple');
const basement = R.profileForArea('map_i_temple_basement');
const cavern = R.profileForArea('wilderness_cavern_01');
const tent = R.profileForArea('map_i_researchers_tent');

assert.equal(town.preset, 'outdoor');
assert.equal(forest.preset, 'forest');
assert.equal(interior.preset, 'interior');
assert.equal(temple.preset, 'temple');
assert.equal(basement.preset, 'basement');
assert.equal(cavern.preset, 'cavern');
assert.equal(tent.preset, 'tent');
assert.ok(forest.wet > town.wet, 'forest reflections are slightly stronger than open town');
assert.ok(interior.wet > forest.wet, 'ordinary rooms are wetter than forest');
assert.ok(temple.wet > interior.wet, 'large temple is more reverberant than an ordinary room');
assert.ok(basement.wet > temple.wet, 'basement is wetter than temple hall');
assert.ok(cavern.wet > basement.wet, 'cavern is the strongest built-in reverb space');
assert.ok(tent.wet < interior.wet, 'fabric tent remains relatively dry');

window.SCRATCHBONES_CONFIG.game.audio.environmentalReverb.byArea = {
  map_hobunji_town: { wet: 0.1, decayS: 1.1 },
};
const authoredTown = R.profileForArea('map_hobunji_town');
assert.equal(authoredTown.wet, 0.1, 'exact per-map authoring overrides built-in wet amount');
assert.equal(authoredTown.decayS, 1.1, 'exact per-map authoring overrides decay');

console.log('environmental reverb checks passed');
