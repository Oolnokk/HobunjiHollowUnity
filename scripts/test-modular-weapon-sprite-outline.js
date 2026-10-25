'use strict';

const assert = require('node:assert/strict'); // Checks uploaded catalog and black-outline raster behavior.
const fs = require('node:fs'); // Reads actual editor/runtime files, not duplicated algorithms.
const vm = require('node:vm'); // Runs browser code without requiring a canvas.
const cutter = fs.readFileSync('docs/tools/modular-weapon-editor/sprite-cutter.js', 'utf8'); // Verifies bundled upload manifest and controls.
const editorHtml = fs.readFileSync('docs/tools/modular-weapon-editor/index.html', 'utf8'); // Confirms UI integration.
const gameHtml = fs.readFileSync('docs/index.html', 'utf8'); // Confirms gameplay and editor load matching catalog assets.
const window = {}; // Isolated browser global for the configuration and outline API.
const context = vm.createContext({ window, Uint8ClampedArray, Uint32Array }); // Native typed arrays for exact RGBA tests.
for (const path of ['docs/tools/modular-weapon-editor/sprite-outline.js',
  'docs/config/modular-weapons.js', 'docs/js/modular-weapons.js']) {
  vm.runInContext(fs.readFileSync(path, 'utf8'), context, { filename: path });
}
const outline = window.ModularWeaponOutline.outlinePixels; // Shared function invoked by the tool's button.
const api = window.ModularWeapons; // Current in-game modular weapon catalog API.

assert(editorHtml.includes('id="cut-outline-thickness"') && editorHtml.includes('id="cut-outline"'));
assert(editorHtml.includes('sprite-outline.js?') && editorHtml.includes('id="cut-uploaded"'));
assert(editorHtml.includes('id="cut-load-uploaded"') && editorHtml.includes('id="cut-refresh-uploaded"'));
assert(editorHtml.includes('id="allow-head"') && editorHtml.includes('id="allow-shaft"'));
assert(cutter.includes('ModularWeaponOutline.outlinePixels'), 'Black outline button must call the shared pixel implementation.');
assert(cutter.includes('weaponhead_bshuakauitl.png') && cutter.includes('weaponshaft_bgungku.png'));
const editorVersion = editorHtml.match(/config\/modular-weapons\.js\?v=([^"']+)/)?.[1]; // Cache-busted config token shared by game/editor.
const gameVersion = gameHtml.match(/config\/modular-weapons\.js\?v=([^"']+)/)?.[1];
assert(editorVersion && editorVersion === gameVersion);

const width = 9, height = 9; // Small canvas with room for two-pixel dilation.
const sample = new Uint8ClampedArray(width * height * 4); // A single red pixel and empty background.
const mark = (arr, x, y, rgba) => arr.set(rgba, (y * width + x) * 4); // Test pixel helper.
const pixel = (arr, x, y) => Array.from(arr.slice((y * width + x) * 4, (y * width + x) * 4 + 4)); // RGBA at one point.
mark(sample, 4, 4, [230, 12, 9, 255]);
const one = outline(sample, width, height, 1); // One pixel thickness must catch diagonal transparency.
assert.deepEqual(pixel(one.pixels, 4, 4), [230, 12, 9, 255]);
for (let y = 3; y <= 5; y++) for (let x = 3; x <= 5; x++) {
  if (x !== 4 || y !== 4) assert.deepEqual(pixel(one.pixels, x, y), [0, 0, 0, 255]);
}
assert.equal(one.added, 8);
assert.deepEqual(pixel(one.pixels, 2, 4), [0, 0, 0, 0]);
const two = outline(sample, width, height, 2); // Requested width counts pixels outward from the original alpha.
assert.equal(two.added, 24);
assert.deepEqual(pixel(two.pixels, 2, 2), [0, 0, 0, 255]);
assert.deepEqual(pixel(two.pixels, 1, 4), [0, 0, 0, 0]);
assert.deepEqual(pixel(sample, 3, 4), [0, 0, 0, 0], 'Input sprite must remain intact for Undo.');

const edge = new Uint8ClampedArray(width * height * 4); // Colored pixels at frame edges cannot get external expansion.
mark(edge, 0, 0, [20, 40, 60, 200]);
const edged = outline(edge, width, height, 1);
assert.deepEqual(pixel(edged.pixels, 0, 0), [0, 0, 0, 255], 'Frame-edge colored pixels must become opaque black.');
assert.deepEqual(pixel(edged.pixels, 1, 1), [0, 0, 0, 255], 'Diagonally adjacent empty pixel gets black outline.');
assert.equal(edged.edgeDarkened, 1);
assert.deepEqual(pixel(edge, 0, 0), [20, 40, 60, 200]);

const hole = new Uint8ClampedArray(width * height * 4); // Transparent hole surrounded by opaque colored pixels.
for (let y = 3; y < 6; y++) for (let x = 3; x < 6; x++) if (x !== 4 || y !== 4) mark(hole, x, y, [34, 56, 78, 255]);
assert.deepEqual(pixel(outline(hole, width, height, 1).pixels, 4, 4), [0, 0, 0, 255]);
const empty = new Uint8ClampedArray(width * height * 4); // Nothing to outline if the sprite is empty.
assert.equal(outline(empty, width, height, 2).added, 0);
assert.throws(() => outline(sample, width, height, 0), /1–32/);
assert.throws(() => outline(sample, width, height, 33), /1–32/);
assert.throws(() => outline(sample, width, height, 1.25), /1–32/);
assert.throws(() => outline(sample, width - 1, height, 1), /valid pixels/);

const uploaded = { heads: ['bshuakauitl'], shafts: ['bgungku', 'hatchet', 'hoe', 'kylie', 'pick-shovel', 'plains-sword'] }; // New authoring-only exports on main.
for (const [kind, keys] of Object.entries(uploaded)) for (const key of keys) {
  const part = api.getConfig()[kind][key]; // Newly registered parts must be visible in the authoring dropdowns.
  assert(part && part.editorOnly, kind + '/' + key + ' should require calibration.');
  assert(fs.existsSync('docs/' + part.sprite), 'Configured export is missing: ' + part.sprite);
}
const stock = api.unlockedParts(['hatchet', 'bshuakauitl', 'dagger'], { tools: {} }, {});
assert(!stock.shafts.includes('hatchet') && !stock.heads.includes('bshuakauitl'), 'New uncalibrated parts must not unlock in-game.');
const defs = {}; // Foundry definitions created from calibrated entries only.
api.registerDefinitions(defs, { hatchet: { animStyle: 'sweep' } }, { nativeCopper: { label: 'Copper' } }, ['nativeCopper']);
assert(!defs['modular:hatchet:dagger:nativeCopper']);
assert(!defs['modular:dagger:bshuakauitl:nativeCopper']);
const approved = JSON.parse(JSON.stringify(api.getConfig())); // User-controlled approval persisted by replace().
approved.shafts.hatchet.editorOnly = false;
approved.heads.bshuakauitl.editorOnly = false;
api.replace(approved);
assert(api.unlockedParts(['hatchet', 'bshuakauitl'], { tools: {} }, {}).shafts.includes('hatchet'));
assert(api.unlockedParts(['hatchet', 'bshuakauitl'], { tools: {} }, {}).heads.includes('bshuakauitl'));
api.registerDefinitions(defs, { hatchet: { animStyle: 'sweep' } }, { nativeCopper: { label: 'Copper' } }, ['nativeCopper']);
assert(defs['modular:hatchet:bshuakauitl:nativeCopper'], 'Approval makes previously provisional parts forgeable.');
assert(api.getConfig().shafts.bgungku.editorOnly, "B'gungku must remain editor-only without its own gameplay donor.");

console.log('Modular exported parts and black-outline processing: pixel edges, alpha, thickness, uploaded catalog, and Foundry gating passed.');
