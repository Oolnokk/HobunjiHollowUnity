const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8'); // Used to inspect the shipped dialogue integration and load the shared naming helper.

const sandbox = { window: {} }; // Used to execute the browser-global naming helper without needing a DOM.
vm.runInNewContext(read('docs/js/dialogue-species-names.js'), sandbox, { filename: 'dialogue-species-names.js' });
const names = sandbox.window.DialogueSpeciesNames; // Used for every behavioral assertion below.

assert(names, 'DialogueSpeciesNames must register on window');
assert.equal(names.labelFor('tletingan', 'mao-ao'), 'Slagothim', 'outsiders call Tletingans Slagothim');
assert.equal(names.labelFor('tletingan', 'tletingan'), 'Tletingan', 'Tletingans distinguish their own subspecies');
assert.equal(names.labelFor('tletingan', 'nuhongan'), 'Tletingan', 'other Slagothim subspecies distinguish Tletingans');
assert.equal(names.labelFor('tletingan', 'longoran'), 'Tletingan', 'all authored Slagothim subspecies distinguish Tletingans');

assert.equal(names.labelFor('rakakoan', 'mao-ao'), 'Kenkari', "outsiders call Rakako'ans Kenkari");
assert.equal(names.labelFor('rakakoan', 'kenkari'), "Rakako'an", "Kenkari distinguish Rakako'ans");
assert.equal(names.labelFor('rakakoan', 'rakakoan'), "Rakako'an", "Rakako'ans distinguish their own subgroup");
assert.equal(names.labelFor("Rakako'an", 'kenkari'), "Rakako'an", 'display-label input normalizes to the same rule');

assert.equal(names.labelFor('mao-ao', 'tletingan'), 'mao-ao', 'unrelated species labels retain existing token behavior');

const dialogue = read('docs/js/dialogue-content.js');
const ambient = read('docs/js/ambient-dialogue.js');
const index = read('docs/index.html');

assert.match(dialogue, /dialogueSpeciesLabel\(speakerSpeciesId, speakerSpeciesId\)/, '{{npcSpecies}} must use speaker-relative naming');
assert.match(dialogue, /dialogueSpeciesLabel\(p\?\.appearance\?\.speciesId, speakerSpeciesId\)/, '{{playerSpecies}} must use the NPC speaker as naming context');
assert.match(ambient, /dialogueSpeciesLabel\(speakerSpeciesId, speakerSpeciesId\)/, 'ambient nickname-token resolution must use speaker-relative npc naming');
assert.match(ambient, /dialogueSpeciesLabel\(player\?\.appearance\?\.speciesId, speakerSpeciesId\)/, 'ambient nickname-token resolution must use speaker-relative player naming');

const helperIndex = index.indexOf('js/dialogue-species-names.js'); // Used to guarantee the shared helper exists before either dialogue consumer evaluates.
assert(helperIndex >= 0, 'index must load dialogue-species-names.js');
assert(helperIndex < index.indexOf('js/dialogue-content.js'), 'species naming helper must load before dialogue-content.js');
assert(helperIndex < index.indexOf('js/ambient-dialogue.js'), 'species naming helper must load before ambient-dialogue.js');

console.log('dialogue speaker-relative species naming regression: ok');
