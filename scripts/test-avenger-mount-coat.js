'use strict';
// Porakaneki Avengers ride real Nazgraku: the mount gets the same genotype coat/markings/eyes a wild Nazgraku has (not the raw, eyeless,
// uncoloured base sprite), and the Workshop loads everything a mount needs to be built and faced like in the game.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const read = p => fs.readFileSync(p, 'utf8');

const runtime = read('docs/js/omgurku-species-runtime.js');
assert.match(runtime, /function prepareMountCoat\(THREE, record\)/, 'mounts have their own coat pass');
assert.match(runtime, /if \(c\?\.mount\) return prepareMountCoat\(THREE, record\)/, 'it runs for mounts only');
assert.match(runtime, /renderer\.composeFrame\(kind, frame, genotype, false\)/, 'the creature genotype compositor paints the mount');
assert.match(runtime, /mountGenotype: mount \? \(options\.mountGenotype \|\| null\) : null/, 'the genotype is kept on the composite');

const bandit = read('docs/js/combat/combat-bandit.js');
assert.match(bandit, /roster\.mountGenotype = window\.CreatureGenetics\?\.makeDefaultGenotype\?\.\(roster\.mountSpecies\)/, 'a mount rolls the wild coat once and keeps it on the roster');
assert.match(bandit, /mountGenotype: roster\.mountGenotype \|\| null/, 'the roster genotype reaches the avatar builder');

const preview = read('docs/tools/enemy-loadout-editor/preview.js');
for (const file of ['js/perp-rotation.js', 'js/creature-texture-cache.js', 'js/creature-genetics.js', 'js/creature-genetics-render.js'])
  assert.ok(preview.includes("'" + file), 'the Workshop loads ' + file);
assert.match(preview, /window\.CreatureGenetics\?\.init\(/, 'Workshop wires the genetics module');
assert.match(preview, /window\.PerpRotation\?\.init\(/, 'Workshop wires dead-zone facing');
assert.match(preview, /setPreviewFacing\(a\.handRigAvatarRoot, Math\.PI \/ 2\)/, 'the Workshop turns the mount side-on');
console.log('Avenger mounts: genotype coat/eyes via the creature compositor, Workshop loads and faces the mount like the game');
