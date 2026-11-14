#!/usr/bin/env node
'use strict';

// Regression for Hachutu's live bandit generation: optional Slagothim
// inheritance adapters may not be installed when the name forge is called.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..'); // Resolves the shipping name forge and canonical species/config manifests.
const read = filename => fs.readFileSync(path.join(root, filename), 'utf8'); // Reads actual game source, not a copied name-generation implementation.
const context = { console }; // Headless browser-like global used to load the game's original classic script without adapters.
context.window = context;
vm.runInNewContext(read('docs/js/bounty-board.js'), context, { filename: 'bounty-board.js' });
const forge = context.BanditNameForge; // The same public API that normal bandit and Hachutu generation call.
const gang = JSON.parse(read('docs/config/bandits/bandit-gang-config.json')); // Guards against a species being added to the roll pool without name support.
assert(forge?.generateCulturalIdentity && forge.generateCaptainIdentity, 'canonical BanditNameForge is loaded');

for (const speciesId of ['tletingan', 'nuhongan', 'longoran']) {
  assert(gang.speciesWeights[speciesId] > 0, speciesId + ' is a genuine bandit population');
  if (speciesId !== 'tletingan') {
    const species = JSON.parse(read('docs/config/species/' + speciesId + '.json')); // Checks the authoritatively declared culture parent, not a hard-coded name assumption.
    assert.equal(species.parentSpecies, 'tletingan', speciesId + ' inherits Tletingan names');
  }
  assert.equal(forge.cultureIdForSpecies(speciesId), 'slagothim', speciesId + ' resolves the Slagothim naming culture');
  for (const gender of ['male', 'female']) {
    const options = { speciesId, gender, seed: 'hachutu-1791275128:' + speciesId + ':' + gender }; // Repeatable failing-world species fixture.
    const ordinary = forge.generateCulturalIdentity(options); // Replays the actual bandit creation path with no inheritance wrapper installed.
    const repeated = forge.generateCulturalIdentity(options);
    const captain = forge.generateCaptainIdentity(options); // Named captains must also support subspecies.
    assert.equal(ordinary.speciesId, speciesId, 'generated identity must retain its actual subspecies');
    assert.equal(ordinary.gender, gender);
    assert.equal(ordinary.cultureId, 'slagothim');
    assert(ordinary.givenName && ordinary.surname && ordinary.loreName, 'must produce complete cultural name');
    assert.equal(ordinary.loreName, repeated.loreName, 'same saved world seed must produce the same name');
    assert.equal(captain.speciesId, speciesId);
    assert.equal(captain.cultureId, 'slagothim');
    assert(captain.display && captain.nickname && captain.nicknameSyllables < 4, 'captain must also have a valid short nickname');
    assert.equal(forge.generateCaptainIdentity(options).display, captain.display, 'captain names must be deterministic');
  }
}
assert.throws(() => forge.generateCulturalIdentity({ speciesId: 'invented-invalid-species', gender: 'male', seed: 'test' }),
  /Unsupported bandit species/, 'unknown species still fail loudly instead of silently receiving the wrong culture');
assert.equal(forge.selfTest(2).ok, true, 'all registered cultures still pass built-in deterministic name checks');
console.log('PASS inherited Nuhongan/Longoran bandit and captain naming, gender and saved-seed determinism');
