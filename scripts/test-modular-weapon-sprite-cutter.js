'use strict';

const assert = require('node:assert/strict'); // Verifies part names and pixel-edit invariants.
const fs = require('node:fs'); // Reads the shipped editor instead of a duplicate test implementation.
const vm = require('node:vm'); // Loads the browser helpers without a DOM.

const scriptPath = 'docs/tools/modular-weapon-editor/sprite-cutter.js'; // Production cutter under test.
const htmlPath = 'docs/tools/modular-weapon-editor/index.html'; // Existing tool page containing the new controls.
const html = fs.readFileSync(htmlPath, 'utf8'); // Ensures the lasso tool remains integrated into the real editor.
const window = {}; // A DOM-free global deliberately exercises only pure RGBA helpers.
vm.runInNewContext(fs.readFileSync(scriptPath, 'utf8'), { window, Uint8ClampedArray }, { filename: scriptPath });
const core = window.ModularWeaponCutterCore; // Public pure methods called by the canvas UI.

assert(core, 'The cutter must expose its pixel operations for regression tests.');
for (const id of ['sprite-cutter','cut-canvas','cut-existing','cut-load-existing','cut-path',
  'cut-load-path','cut-file','cut-remove','cut-isolate','cut-clear-selection',
  'cut-undo','cut-reset','cut-kind','cut-name','cut-output','cut-export','cut-status','cut-debug']) {
  assert(html.includes('id="' + id + '"'), 'Missing editor control: ' + id);
}
assert(html.includes('sprite-cutter.js?'), 'The existing modular editor must load its cutter extension.');

const source = fs.readFileSync(scriptPath, 'utf8'); // Read shipped built-in sprite picker entries for asset coverage.
const list = source.match(/const builtins = \[([\s\S]*?)\];/); // Extract the literal catalog without running a DOM editor.
assert(list, 'The full-weapon source picker must exist.');
const spriteFiles = [...list[1].matchAll(/,\s*(?:'([^']+\.png)'|"([^"]+\.png)")\]/g)].map(match => match[1] || match[2]); // Both quotation styles support apostrophes in sprite paths.
assert(spriteFiles.length >= 24, 'Stock full-weapon picker should include all shipped weapon/shield art.');
for (const filename of spriteFiles) {
  assert(fs.existsSync('docs/assets/toolsprites/' + filename), 'Missing built-in source sprite: ' + filename);
}


assert.equal(core.fileName('head', 'Fishing Mace'), 'weaponhead_fishing_mace.png');
assert.equal(core.fileName('shaft', 'War-Cleaver'), 'weaponshaft_war-cleaver.png');
assert.equal(core.fileName('head', 'weaponhead_Harlyao Longsword'), 'weaponhead_harlyao_longsword.png');
assert.equal(core.fileName('shaft', "B'shuakauitl"), 'weaponshaft_bshuakauitl.png');
assert.throws(() => core.fileName('handle', 'dagger'), /Choose Head or Shaft/);
assert.throws(() => core.fileName('head', '...'), /Enter a part name/);

const original = new Uint8ClampedArray([
  100, 130, 160, 255,  12, 34, 56, 80,
  22, 44, 66, 0,      99, 88, 77, 255
]); // Four sample RGBA pixels, including partial-alpha and transparent pixels.
const mask = new Uint8ClampedArray([
  0, 0, 0, 255,  0, 0, 0, 0,
  0, 0, 0, 127,  0, 0, 0, 255
]); // Mask edges use alpha >= 128 to select whole pixels, not blend source RGBA.
const remove = core.applyMask(original, mask, 'remove'); // Simulates removing a lasso from a weapon.
const isolate = core.applyMask(original, mask, 'isolate'); // Simulates retaining only a weapon head.
assert.deepEqual(Array.from(remove.pixels), [
  0, 0, 0, 0, 12, 34, 56, 80, 22, 44, 66, 0, 0, 0, 0, 0
]);
assert.deepEqual(Array.from(isolate.pixels), [
  100, 130, 160, 255, 0, 0, 0, 0, 0, 0, 0, 0, 99, 88, 77, 255
]);
assert.equal(remove.affected, 2);
assert.equal(remove.remaining, 1);
assert.equal(isolate.affected, 1);
assert.equal(isolate.remaining, 2);
assert.deepEqual(Array.from(original), [
  100, 130, 160, 255, 12, 34, 56, 80, 22, 44, 66, 0, 99, 88, 77, 255
], 'Lasso operations must not mutate Undo/source buffers.');
assert.throws(() => core.applyMask(original, mask.slice(0, 4), 'remove'), /Invalid pixel selection/);
assert.throws(() => core.applyMask(original, mask, 'paint'), /Invalid pixel selection/);

console.log('Modular weapon sprite cutter: editor wiring, names, RGBA isolation/removal, and input validation passed.');
