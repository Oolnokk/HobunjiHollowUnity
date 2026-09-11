'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const localDb = fs.readFileSync('docs/js/local-db-overrides.js', 'utf8'); // Source under test for NPC database composition and registry wiring.
const namedAnimal = fs.readFileSync('docs/js/named-animal-npc.js', 'utf8'); // Source under test for editor/runtime animal NPC routing.
const studio = fs.readFileSync('docs/tools/character-studio/index.html', 'utf8'); // Confirms the bridge preserves the existing species input contract.
const chathead = fs.readFileSync('docs/js/animal-chathead-frame.js', 'utf8'); // Confirms legacy named-NPC mappings remain backward compatibility only.
const overrides = JSON.parse(fs.readFileSync('docs/config/npcs/species-overrides.json', 'utf8')); // Reviewed canonical animal species records.

assert.equal(overrides.npcs.banubu.species, 'grehlr', 'Banubu must be authored as Grehlr');
assert.equal(overrides.npcs.banubu.kind, 'animal', 'Banubu must use the animal NPC route');
assert.equal(overrides.npcs.hiki_hiki.species, 'drenkirra', 'Hiki-hiki must be authored as Drenkirra');
assert.equal(overrides.npcs.hiki_hiki.kind, 'animal', 'Hiki-hiki must use the animal NPC route');

assert.match(localDb, /function applyNpcSpeciesOverrides\(/, 'NPC database loads must compose reviewed species overrides');
assert.match(localDb, /NPC_SPECIES_OVERRIDES_PATH/, 'species-overrides.json must be a first-class NPC composition source');
assert.match(localDb, /CREATURE_BESTIARY_PATH/, 'animal species choices must come from the shared creature bestiary');
assert.match(localDb, /_installNpcDatabaseFetchComposition\(\)/, 'Character Studio direct repo fetches must receive the same species composition');
assert.match(localDb, /HobunjiNpcSpeciesRegistry/, 'runtime/editor must share one creature species registry');
assert.match(localDb, /named-animal-npc\.js/, 'the shared named-animal bridge must load anywhere LocalDBOverrides is loaded');

assert.match(studio, /id="npcSpecies"/, 'Character Studio must retain the existing npcSpecies field id for bridge compatibility');
assert.match(namedAnimal, /npcSpeciesChoices/, 'Character Studio species field must gain a selectable datalist');
assert.match(namedAnimal, /Animal ·/, 'the picker must visibly distinguish creature species from person species');
assert.match(namedAnimal, /appearance\.creatureKind = kind/, 'animal selections must persist creature identity into appearance data');
assert.match(namedAnimal, /appearance\.avatarType = 'animal'/, 'animal selections must explicitly mark the non-humanoid avatar route');
assert.match(namedAnimal, /buildAnimalPlaneAvatarModel/, 'named animal NPC world models must reuse the existing animal plane builder');
assert.match(namedAnimal, /CreatureGeneticsRender/, 'named animal previews must reuse the shared creature genetics renderer when available');
assert.match(namedAnimal, /__namedAnimalNpcDebug/, 'mobile/dev diagnostics must expose named animal NPC bridge state');
assert.doesNotMatch(namedAnimal, /banubu\s*:/i, 'general named-animal bridge must not hardcode Banubu');
assert.doesNotMatch(namedAnimal, /hiki_hiki\s*:/i, 'general named-animal bridge must not hardcode Hiki-hiki');
assert.match(chathead, /banubu: 'grehlr'/, 'legacy Banubu chathead mapping remains as backward compatibility for old data');
assert.match(chathead, /hiki_hiki: 'drenkirra'/, 'legacy Hiki-hiki chathead mapping remains as backward compatibility for old data');

const storage = new Map(); // Minimal localStorage stand-in used while evaluating LocalDBOverrides in isolation.
const sandbox = {
  console,
  Promise,
  URL,
  setTimeout,
  clearTimeout,
  localStorage: {
    getItem: key => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key),
  },
  window: {
    fetch: undefined,
  },
};
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
vm.runInContext(localDb, sandbox, { filename: 'local-db-overrides.js' });

const sample = {
  npcs: [
    { id: 'banubu', species: 'mashtzarr', appearance: { speciesId: 'mashtzarr', cosmetics: { hairFront: 'legacy' } } },
    { id: 'ordinary', species: 'mao-ao', appearance: { speciesId: 'mao-ao' } },
  ],
}; // Exercises the composition function without depending on network or game boot.
const composed = sandbox.window.LocalDBOverrides.applyNpcSpeciesOverrides(sample, overrides); // Public composition API used by runtime and direct database fetches.
const banubu = composed.npcs.find(npc => npc.id === 'banubu'); // Corrected record used for the authoritative-species assertions below.
const ordinary = composed.npcs.find(npc => npc.id === 'ordinary'); // Unrelated record proves composition is narrowly scoped.

assert.equal(banubu.species, 'grehlr');
assert.equal(banubu.creatureKind, 'grehlr');
assert.equal(banubu.appearance.speciesId, 'grehlr');
assert.equal(banubu.appearance.creatureKind, 'grehlr');
assert.equal(banubu.appearance.avatarType, 'animal');
assert.deepEqual(banubu.appearance.cosmetics, { hairFront: 'legacy' }, 'species composition must preserve unrelated appearance data');
assert.equal(ordinary.species, 'mao-ao', 'unlisted NPCs must remain unchanged');
assert.equal(sample.npcs[0].species, 'mashtzarr', 'composition must not mutate the imported/source database object');

console.log('named animal NPC species integration: ok');
