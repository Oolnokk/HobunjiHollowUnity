'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/config/character-rig-scale-defaults.js', 'utf8'); // Executes the shipping scale table so only the explicitly intended authoring edits are locked in.
const window = { SCRATCHBONES_CONFIG: { game: { assets: { pngPlaneAvatar: { proceduralFeet: { footScale: {} } } } } } };
vm.runInNewContext(source, { window });
const values = window.HOBUNJI_CHARACTER_RIG_SCALE_DEFAULTS;

assert.deepEqual(JSON.parse(JSON.stringify(values['tletingan::male'])), { x: 0.85, y: 0.85, head: 0.8, offsetY: 0 });
assert.deepEqual(JSON.parse(JSON.stringify(values['mao-ao::female'])), { x: 0.895, y: 0.94, head: 0.7813, offsetY: 0 });
assert.deepEqual(JSON.parse(JSON.stringify(values['mammakhbuur::male'])), { x: 0.96, y: 1.69, head: 0.9771, offsetY: -0.095 });
assert.deepEqual(JSON.parse(JSON.stringify(values['mammakhbuur::female'])), { x: 1.0153, y: 1.3331, head: 0.8402, offsetY: -0.02 });

// Entries accidentally touched during authoring stay on their pre-export defaults.
assert.deepEqual(JSON.parse(JSON.stringify(values['tletingan::female'])), { x: 0.915, y: 0.89, head: 0.8823529411764706, offsetY: 0 });
assert.deepEqual(JSON.parse(JSON.stringify(values['engh-sho::male'])), { x: 0.8, y: 0.845, head: 0.7894736842105263, offsetY: 0 });
assert.deepEqual(JSON.parse(JSON.stringify(values['engh-sho::female'])), { x: 0.795, y: 0.81, head: 0.7894736842105263, offsetY: 0 });
assert.deepEqual(JSON.parse(JSON.stringify(values['mao-ao::male'])), { x: 0.81675, y: 1.089, head: 0.726, offsetY: 0 });
assert.deepEqual(JSON.parse(JSON.stringify(values['kenkari::male'])), { x: 1.225, y: 1.225, head: 1, offsetY: 0 });
assert.deepEqual(JSON.parse(JSON.stringify(values['kenkari::female'])), { x: 1.1, y: 1.1, head: 1, offsetY: 0 });
assert.deepEqual(JSON.parse(JSON.stringify(values['mashtzarr::male'])), { x: 0.955, y: 1.255, head: 0.9856, offsetY: -0.095 });
assert.deepEqual(JSON.parse(JSON.stringify(values['mashtzarr::female'])), { x: 1.01, y: 0.99, head: 0.8475, offsetY: -0.02 });

console.log('Only the intended Full Character Scale edits and proportional Mammakhbuur female values are applied.');
