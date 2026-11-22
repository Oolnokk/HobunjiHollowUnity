'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/config/character-rig-scale-defaults.js', 'utf8'); // Executes the shipping scale table so only the explicitly intended authoring edits are locked in.
const window = { SCRATCHBONES_CONFIG: { game: { assets: { pngPlaneAvatar: { proceduralFeet: { footScale: {} } } } } } };
vm.runInNewContext(source, { window });
const values = window.HOBUNJI_CHARACTER_RIG_SCALE_DEFAULTS;

assert.deepEqual(JSON.parse(JSON.stringify(values['mao-ao::female'])), { x: 0.895, y: 0.94, head: 0.7813, offsetY: 0 });
assert.deepEqual(JSON.parse(JSON.stringify(values['mammakhbuur::male'])), { x: 0.96, y: 1.69, head: 0.9771, offsetY: -0.095 });
assert.deepEqual(JSON.parse(JSON.stringify(values['mammakhbuur::female'])), { x: 1.0153, y: 1.3331, head: 0.8402, offsetY: -0.02 });

// Entries accidentally touched during authoring stay on their pre-export defaults.
assert.deepEqual(JSON.parse(JSON.stringify(values['engh-sho::male'])), { x: 0.8, y: 0.845, head: 0.7894736842105263, offsetY: 0 });
assert.deepEqual(JSON.parse(JSON.stringify(values['engh-sho::female'])), { x: 0.795, y: 0.81, head: 0.7894736842105263, offsetY: 0 });
assert.deepEqual(JSON.parse(JSON.stringify(values['mao-ao::male'])), { x: 0.81675, y: 1.089, head: 0.726, offsetY: 0 });
assert.deepEqual(JSON.parse(JSON.stringify(values['kenkari::male'])), { x: 1.225, y: 1.225, head: 1, offsetY: 0 });
assert.deepEqual(JSON.parse(JSON.stringify(values['kenkari::female'])), { x: 1.1, y: 1.1, head: 1, offsetY: 0 });
assert.deepEqual(JSON.parse(JSON.stringify(values['mashtzarr::male'])), { x: 0.955, y: 1.255, head: 0.9856, offsetY: -0.095 });
assert.deepEqual(JSON.parse(JSON.stringify(values['mashtzarr::female'])), { x: 1.01, y: 0.99, head: 0.8475, offsetY: -0.02 });

// Nov 22 visually verified proportion pass (Full Character Scale screenshots):
// Longorans are lanky/thick-framed at the Mammakhbuur's height, Tletingans short
// and stocky, Nuhongans Ewok-like. legLength is authored separately from portrait height.
const pass = {
  'longoran::male': { x: 1.08, y: 1.4, legLength: 2.3, head: 1.05, offsetY: -0.055 },
  'longoran::female': { x: 1.04, y: 2.25, legLength: 2.15, head: 1, offsetY: -0.055 },
  'tletingan::male': { x: 0.675, y: 0.9, legLength: 0.75, head: 0.638, offsetY: 0 },
  'tletingan::female': { x: 0.771, y: 0.986, legLength: 0.814, head: 0.728, offsetY: 0 },
  'nuhongan::male': { x: 0.654, y: 0.587, legLength: 0.461, head: 0.671, offsetY: 0 },
  'nuhongan::female': { x: 0.71, y: 0.622, legLength: 0.488, head: 0.755, offsetY: 0 },
};
for (const [key, tuple] of Object.entries(pass)) {
  assert.deepEqual(JSON.parse(JSON.stringify(values[key])), tuple, key);
  assert(tuple.head / tuple.x >= 0.94, `${key}: head much narrower than the body shows a collar step at the 2px neck band`);
}
assert(values['longoran::male'].legLength > values['longoran::male'].y, 'Longorans are lanky: legs outgrow the portrait');
assert(values['nuhongan::male'].legLength < values['tletingan::male'].legLength && values['nuhongan::male'].y < values['tletingan::male'].y,
  'Nuhongans are shorter and stubbier than Tletingans');
assert.equal(window.HobunjiCharacterRigScaleDefaults.version, 26, 'shipping scale revision must change when species defaults change');

console.log('Only the intended Full Character Scale edits and proportional Mammakhbuur female values are applied.');
