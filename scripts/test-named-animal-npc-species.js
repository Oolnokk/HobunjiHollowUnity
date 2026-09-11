'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const localDb = fs.readFileSync('docs/js/local-db-overrides.js', 'utf8');
const namedAnimal = fs.readFileSync('docs/js/named-animal-npc.js', 'utf8');
const nativeAppearance = fs.readFileSync('docs/js/character-studio-animal-appearance.js', 'utf8');
const feyExtras = fs.readFileSync('docs/js/character-studio-animal-fey-extras.js', 'utf8');
const headwear = fs.readFileSync('docs/js/animal-npc-headwear.js', 'utf8');
const repoPicker = fs.readFileSync('docs/js/repo-picker.js', 'utf8');
const studio = fs.readFileSync('docs/tools/character-studio/index.html', 'utf8');
const chathead = fs.readFileSync('docs/js/animal-chathead-frame.js', 'utf8');
const overrides = JSON.parse(fs.readFileSync('docs/config/npcs/species-overrides.json', 'utf8'));

assert.equal(overrides.npcs.banubu.species, 'grehlr', 'Banubu must be authored as Grehlr');
assert.equal(overrides.npcs.banubu.kind, 'animal', 'Banubu must use the animal NPC route');
assert.equal(overrides.npcs.hiki_hiki.species, 'drenkirra', 'Hiki-hiki must be authored as Drenkirra');
assert.equal(overrides.npcs.hiki_hiki.kind, 'animal', 'Hiki-hiki must use the animal NPC route');

assert.match(localDb, /function applyNpcSpeciesOverrides\(/, 'NPC database loads must compose reviewed species overrides');
assert.match(localDb, /CREATURE_BESTIARY_PATH/, 'animal species choices must come from the shared creature bestiary');
assert.match(localDb, /HobunjiNpcSpeciesRegistry/, 'runtime/editor must share one creature species registry');
assert.match(localDb, /document\.write\([\s\S]*named-animal-npc/, 'normal parser-time boot must install the generalized bridge before avatar APIs');

assert.match(studio, /id="npcSpecies"/, 'Character Studio must retain the ordinary Species field');
assert.match(namedAnimal, /npcSpeciesChoices/, 'the ordinary Species field must retain person + animal bestiary choices');
assert.match(namedAnimal, /syncSpeciesFromAppearance/, 'native animal form edits must synchronize back to authoritative npc.species');
assert.match(namedAnimal, /appearance\.creatureKind = speciesId/, 'species selection must synchronize creature identity into appearance data');
assert.match(namedAnimal, /appearance\.avatarType = 'animal'/, 'animal species must explicitly select the animal avatar route');
assert.match(namedAnimal, /creatureColorOverrides/, 'runtime bridge must apply native editor custom-hex overrides');
assert.match(namedAnimal, /animalOpacity/, 'runtime bridge must carry native editor opacity');
assert.match(namedAnimal, /animalHatId/, 'runtime bridge must carry native editor animal headwear');
assert.match(namedAnimal, /AnimalNpcHeadwear\.composeWithHat/, 'runtime render must reuse the restored animal headwear compositor');
assert.match(namedAnimal, /canvas\.toDataURL\('image\/png'\)/, 'world animal planes must use the composed authored appearance rather than a plain base sprite when possible');
assert.match(namedAnimal, /buildAnimalPlaneAvatarModel/, 'world models must retain the existing side-view animal plane builder');
assert.match(namedAnimal, /watchGlobalAssignment\('NpcAvatarPreview'\)/, 'profile bridge must install before late avatar API assignment');
assert.match(namedAnimal, /watchGlobalAssignment\('PNGPlaneAvatar'\)/, 'world-plane bridge must install before late PNG-plane API assignment');
assert.doesNotMatch(namedAnimal, /namedAnimalAppearancePanel/, 'the generalized bridge must not inject the discarded simplified appearance panel');
assert.doesNotMatch(namedAnimal, /creatureBaseControl/, 'the generalized bridge must not rebuild animal authoring controls itself');
assert.match(namedAnimal, /__namedAnimalNpcDebug/, 'mobile/dev diagnostics must remain available');
assert.doesNotMatch(namedAnimal, /banubu\s*:/i, 'general named-animal bridge must not hardcode Banubu');
assert.doesNotMatch(namedAnimal, /hiki_hiki\s*:/i, 'general named-animal bridge must not hardcode Hiki-hiki');

// Exact native Character Studio extension recovered from feature/animal-npc-appearance.
assert.match(nativeAppearance, /id = 'animalNpcAppearanceCard'|id='animalNpcAppearanceCard'|card\.id = 'animalNpcAppearanceCard'/, 'native editor must inject the Character form card');
assert.match(nativeAppearance, />Person<\/button>/, 'native Character form must retain Person mode');
assert.match(nativeAppearance, />Animal<\/button>/, 'native Character form must retain Animal mode');
assert.match(nativeAppearance, /Animal NPCs use the same creature genotype colors and pattern layers as breeding/, 'native editor must retain the breeding/genetics workflow');
assert.match(nativeAppearance, /findHumanCards\(\)/, 'native animal mode must extend the regular Appearance pane rather than creating a separate editor');
assert.match(nativeAppearance, /humanCard\.style\.display = animal \? 'none' : ''/, 'person-only regular Appearance cards must swap cleanly in animal mode');
assert.match(nativeAppearance, /creatureGenotype/, 'native editor must persist breeding-compatible genotype data');
assert.match(nativeAppearance, /class=\"colorSwatch animalNpcColor/, 'native editor must retain its original coat/pattern swatches');
assert.match(nativeAppearance, /animalNpcPatternToggle/, 'native editor must retain per-pattern expression toggles');
assert.match(nativeAppearance, /renderStudioAnimal/, 'native editor must retain the regular Character Studio live preview integration');

assert.match(feyExtras, /class=\"animalNpcCustomHex\"/, 'native extension must retain independent #RRGGBB fields for animal layers');
assert.match(feyExtras, /Each base\/pattern layer has its own independent #RRGGBB override/, 'hex overrides must remain intentionally independent of breeding presets');
assert.match(feyExtras, /id=\"animalNpcOpacity\" type=\"range\"/, 'native extension must retain animal opacity control');
assert.match(feyExtras, /id=\"animalNpcHatSelect\"/, 'native extension must retain animal hat selection');
assert.match(feyExtras, /controlsSignature/, 'native extension must avoid rebuilding focused hex/select controls during polling');
assert.match(headwear, /window\.AnimalNpcHeadwear/, 'restored headwear module must expose its shared compositor');
assert.match(headwear, /composeWithHat/, 'restored headwear module must composite existing portrait hats onto animal sprites');

assert.match(repoPicker, /character-studio-animal-appearance\.js/, 'Character Studio must load the recovered native animal appearance extension');
assert.match(repoPicker, /character-studio-animal-fey-extras\.js/, 'Character Studio must load the recovered hex/opacity/headwear controls');
assert.match(repoPicker, /animal-npc-headwear\.js/, 'Character Studio must load animal headwear before the fey extras');
assert.match(chathead, /banubu: 'grehlr'/, 'legacy Banubu chathead mapping remains backward compatibility only');
assert.match(chathead, /hiki_hiki: 'drenkirra'/, 'legacy Hiki-hiki chathead mapping remains backward compatibility only');

const storage = new Map();
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
  window: { fetch: undefined },
};
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
vm.runInContext(localDb, sandbox, { filename: 'local-db-overrides.js' });

const sample = {
  npcs: [
    { id: 'banubu', species: 'mashtzarr', appearance: { speciesId: 'mashtzarr', cosmetics: { hairFront: 'legacy' } } },
    { id: 'ordinary', species: 'mao-ao', appearance: { speciesId: 'mao-ao' } },
  ],
};
const composed = sandbox.window.LocalDBOverrides.applyNpcSpeciesOverrides(sample, overrides);
const banubu = composed.npcs.find(npc => npc.id === 'banubu');
const ordinary = composed.npcs.find(npc => npc.id === 'ordinary');
assert.equal(banubu.species, 'grehlr');
assert.equal(banubu.creatureKind, 'grehlr');
assert.equal(banubu.appearance.speciesId, 'grehlr');
assert.equal(banubu.appearance.creatureKind, 'grehlr');
assert.equal(banubu.appearance.avatarType, 'animal');
assert.deepEqual(banubu.appearance.cosmetics, { hairFront: 'legacy' }, 'species composition must preserve unrelated appearance data');
assert.equal(ordinary.species, 'mao-ao', 'unlisted NPCs must remain unchanged');
assert.equal(sample.npcs[0].species, 'mashtzarr', 'composition must not mutate the imported/source database object');

console.log('named animal NPC + restored native appearance integration: ok');