#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = path => fs.readFileSync(path, 'utf8');
const livestock = read('docs/js/livestock-dialogue.js');
const chathead = read('docs/js/animal-chathead-frame.js');
const locks = read('docs/js/character-action-locks.js');
const farm = read('docs/js/farm-animals.js');
const game = read('docs/game.js');
const index = read('docs/index.html');
const author = read('docs/tools/animation-author/index.html');

for (const [name, source] of Object.entries({ livestock, chathead, locks, farm })) {
  assert.doesNotThrow(() => new Function(source), `${name} parses as JavaScript`);
}

assert.match(locks, /animal-chathead-frame\.js\?v=20260902modular1/,
  'the existing early interaction-lock script parser-loads animal chathead metadata');
assert.match(locks, /livestock-dialogue\.js\?v=20260902modular1/,
  'the existing early interaction-lock script parser-loads the modular livestock session');
assert.doesNotMatch(index, /livestock-dialogue\.js|animal-chathead-frame\.js/,
  'main index.html stays untouched by the livestock feature bootstrap');

assert.match(livestock, /watchGlobal\('FarmAnimals', installFarmBridge\)/,
  'livestock dialogue injects its open callback through FarmAnimals.init');
assert.match(livestock, /watchGlobal\('DialogueContent', installDialogueBridge\)/,
  'livestock dialogue composes DialogueContent injected callbacks');
assert.match(livestock, /CharacterActionLocks\?\.acquire/,
  'livestock dialogue uses the shared player interaction lock');
assert.match(livestock, /setCameraMode\?\.\(cameraModeKey\(\)\)/,
  'livestock dialogue selects the existing dialogue camera mode');
assert.match(livestock, /headWorldPosition\(animal, kind, cameraScratch\)/,
  'the camera target is the authored animal head point');
assert.match(livestock, /CREATURE_PERP_DEAD_RAD/,
  'dialogue animal facing reuses the existing camera-relative creature deadzone');
assert.match(livestock, /DIALOGUE_FACE_EXTRA_DEG/,
  'dialogue adds only the authored readability margin on top of that deadzone');
assert.doesNotMatch(livestock, /PerspectiveCamera\.prototype|\.prototype\.lookAt|Object\.defineProperty\(animal, ['"]groupRot/,
  'the modular session does not patch Three.js globally or replace per-animal rotation properties');

assert.match(farm, /openLivestockDialogue\?\.\(animal, rec, \[line\]\)/,
  'FarmAnimals delegates its Talk action through the injected modular callback');
assert.match(farm, /Talk to \$\{talkName\}/,
  'livestock still exposes the contextual Talk action');
assert.doesNotMatch(game, /createLivestockNpcDialogueAdapter|_livestockDialogueHeadWorldPosition|openLivestockDialogue/,
  'game.js contains no livestock-specific dialogue implementation');

assert.match(chathead, /SPECIAL_NPC_KINDS[\s\S]*banubu: 'grehlr'[\s\S]*hiki_hiki: 'drenkirra'/,
  'Banubu and Hiki-hiki retain Grehlr/Drenkirra chathead mapping');
assert.match(chathead, /frameCenterForKind/,
  'chathead metadata exposes a canonical authored head center');
assert.doesNotMatch(chathead, /patchDialogueFacingAnimal|FarmAnimals.*groupRot/,
  'chathead metadata no longer owns farm-animal dialogue facing');
assert.match(chathead, /three@0\.128\.0/,
  'V15.45 authoring is normalized to the current main Three.js compatibility pin');

assert.match(author, /Hobunji Animation Author V15\.45/,
  'the V15.45 authoring build is retained');
assert.match(author, /maaAnimalChatheadFrameSection/,
  'Rig Coordinates still contains the animal chathead frame tool');
assert.match(author, /chatheadFrame: normalizedAnimalChatheadFrameV1543/,
  'Rig profile serialization persists authored chathead frames');

console.log('modular livestock dialogue/chathead regression checks passed');
