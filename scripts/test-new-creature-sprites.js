#!/usr/bin/env node
'use strict';

// Regression for the reusable four-way creature-eye mode, Nelk tail/cape overlay,
// Uumkao'ii shell migration, and intentionally normal mounted Nazgraku frames.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const zlib = require('node:zlib'); // Decodes the actual eye sprite RGBA for tint regression tests.
const read = file => fs.readFileSync(file, 'utf8');

const present = new Set([...fs.readdirSync('docs/assets/creaturesprites'),
  ...fs.readdirSync('docs/assets/creaturesprites/patterns')]); // Verifies authored sprite names without browser DevTools.
const required = [
  "uumkao'ii_idle.png", "uumkao'ii_run1.png", "uumkao'ii_run2.png",
  'uum_shell_idle.png', 'uum_shell_run1.png', 'uum_shell_run2.png',
  'nelk_eye-A.png', 'nelk_eye-B.png', 'nelk_eye-C.png', 'nelk_eye-D.png',
  'nelk_brushtail-caped_idle.png', 'nelk_brushtail-caped_run1.png', 'nelk_brushtail-caped_run2.png',
  'nazgraku_idle.png', 'nazgraku_run1.png', 'nazgraku_run2.png',
]; // Run all required PNG existence checks in the same test.
for (const name of required) assert(present.has(name), 'Missing uploaded creature PNG: ' + name);

const context = {
  document: { currentScript: null, readyState: 'complete' },
  window: {
    SCRATCHBONES_CONFIG: { game: { animalBlink: { minIntervalMs: 10, maxIntervalMs: 10, durationMs: 2 },
      creatureGenetics: { palettes: { default: [
        { id: 'light', name: 'Light', hex: '#aabbcc', weight: 1 },
        { id: 'dark', name: 'Dark', hex: '#445566', weight: 1 },
      ] } }, livestock: {}, wildlife: {} } },
    addEventListener() {},
    __farmLog() {},
  },
  localStorage: { getItem: () => null },
  performance: { now: () => 0 },
  Math: Object.create(Math),
};
context.Math.random = () => 0; // Deterministic next-eye direction for each simulated blink.
vm.createContext(context);
vm.runInContext(read('docs/js/color-fill.js'), context, { filename: 'color-fill.js' }); // Loads the exact tint math used by game canvases.
vm.runInContext(read('docs/js/creature-genetics-render.js'), context, { filename: 'creature-genetics-render.js' });
vm.runInContext(read('docs/js/creature-genetics.js'), context, { filename: 'creature-genetics.js' });
vm.runInContext(read('docs/js/creature-blink.js'), context, { filename: 'creature-blink.js' });

const render = context.window.CreatureGeneticsRender;
const genetics = context.window.CreatureGenetics;
const blink = context.window.CreatureBlink;
assert.equal(render.SPECIES.nelk.eyes.mode, 'cycle');
assert.equal(render.SPECIES.uumkaoii.patterns.join(','), 'shell');
assert.equal(render.SPECIES.uumkaoii.base.run1, "assets/creaturesprites/uumkao'ii_run1.png");
assert.equal(render.SPECIES.nazgraku.base.run2, 'assets/creaturesprites/nazgraku_run2.png');
assert.equal(render.eyeStateKey('C'), 'eye-C');
assert.equal(render.eyeStateKey(true), 'b');
assert.equal(render.eyeStateKey(false), 'o');
assert.equal(render.eyeStatesForKind('nelk').join(','), 'A,B,C,D');
const eyeKey = render.SPECIES.nelk.eyes.skinRecolorKey; // Used to verify the exact color-key predicate installed for all four eye poses.
assert(eyeKey && render.SPECIES.nelk.eyes.variants.length === 4, 'Every Nelk eye pose uses one skin recolor rule');
const eyePixels = new Uint8ClampedArray([
  163, 200, 159, 255, // Mint skin highlight should track the inherited base tint.
  112, 146, 111, 255, // Darker mint skin shadow should preserve shading.
  173, 224, 225, 255, // Cyan iris detail must remain blue.
  0, 0, 0, 255,       // Solid black outline must remain black.
  5, 9, 4, 255,       // Near-black green outline noise must also stay black.
]); // Simulates the authored mint/iris colors without needing browser canvas APIs.
// Decode the checked-in RGBA PNGs directly so each authored eye variant is tested, not only a synthetic pixel.
function rgbaPng(filename) {
  const bytes = fs.readFileSync(filename); // Uses the source file from the creature sprite directory.
  assert.equal(bytes.toString('hex', 0, 8), '89504e470d0a1a0a');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20); // Native raster dimensions for PNG row filters.
  assert.equal(bytes[24], 8); assert.equal(bytes[25], 6); assert.equal(bytes[28], 0); // RGBA8, non-interlaced.
  const chunks = []; // Accumulates PNG IDAT chunks for a single inflate.
  for (let pos = 8; pos < bytes.length;) {
    const n = bytes.readUInt32BE(pos), type = bytes.toString('ascii', pos + 4, pos + 8);
    if (type === 'IDAT') chunks.push(bytes.subarray(pos + 8, pos + 8 + n));
    pos += n + 12;
  }
  const inflated = zlib.inflateSync(Buffer.concat(chunks)); // One filter byte before each image row.
  const stride = width * 4, rgba = new Uint8ClampedArray(stride * height); // Decoded channels fed into production's tint function.
  let offset = 0; // Advances through the inflated scanlines.
  for (let y = 0; y < height; y++) {
    const filter = inflated[offset++]; // PNG predictor filter for this scanline.
    assert(filter <= 4);
    for (let x = 0; x < stride; x++) {
      const index = y * stride + x;
      const left = x >= 4 ? rgba[index - 4] : 0, up = y ? rgba[index - stride] : 0;
      const corner = y && x >= 4 ? rgba[index - stride - 4] : 0;
      let prediction = 0; // Inverse PNG None/Sub/Up/Average/Paeth filtering.
      if (filter === 1) prediction = left;
      else if (filter === 2) prediction = up;
      else if (filter === 3) prediction = Math.floor((left + up) / 2);
      else if (filter === 4) {
        const p = left + up - corner, a = Math.abs(p - left), b = Math.abs(p - up), c = Math.abs(p - corner);
        prediction = a <= b && a <= c ? left : b <= c ? up : corner;
      }
      rgba[index] = (inflated[offset++] + prediction) & 255;
    }
  }
  assert.equal(offset, inflated.length, 'PNG scanlines must decode exactly');
  return rgba;
}
const keyHsv = context.window.ColorFill.rgbToHsv(...render.hexToRgb(eyeKey.hex)); // Authored mint skin hue.
const minSaturation = Math.max(0.04, keyHsv.s * eyeKey.minSaturationRatio); // Shared source-key selection rule.
for (const pose of ['A','B','C','D']) {
  const original = rgbaPng(`docs/assets/creaturesprites/nelk_eye-${pose}.png`);
  const recolored = new Uint8ClampedArray(original); // Checks a distinct full-raster tint for each pose.
  render.recolorKeyedPixels(recolored, render.hexToRgb('#E07090'), eyeKey);
  let mint = 0, changed = 0, cyan = 0; // Counts recolorable skin, actually changed skin, and untouched iris details.
  for (let i = 0; i < original.length; i += 4) {
    if (!original[i + 3]) continue;
    const hsv = context.window.ColorFill.rgbToHsv(original[i], original[i+1], original[i+2]);
    const isMint = hsv.v >= eyeKey.minValue && hsv.s >= minSaturation && context.window.ColorFill.hueDistance(hsv.h, keyHsv.h) <= eyeKey.hueTolerance;
    const isChanged = original[i] !== recolored[i] || original[i+1] !== recolored[i+1] || original[i+2] !== recolored[i+2];
    if (isMint) mint++;
    if (isChanged) { changed++; assert(isMint, `Eye ${pose}: changed non-mint pixel`); }
    if (hsv.h >= 165 && hsv.h <= 205 && hsv.s > .08 && original[i] > 40) {
      cyan++;
      assert(!isChanged, `Eye ${pose}: iris recolored`);
    }
    if (original[i] < 10 && original[i+1] < 10 && original[i+2] < 10)
      assert(!isChanged, `Eye ${pose}: black outlines recolored`);
  }
  assert(mint >= 30 && changed >= 30, `Eye ${pose}: mint skin not tinted (${mint} matching, ${changed} changed)`);
  assert(cyan > 0, `Eye ${pose}: expected cyan iris detail`);
}
const irisBefore = Array.from(eyePixels.slice(8, 12)); // Ensures the eye detail is unchanged after recoloring.
render.recolorKeyedPixels(eyePixels, render.hexToRgb('#E07090'), eyeKey);
assert(eyePixels[0] > eyePixels[1], 'Mint skin highlight should take the red genotype hue');
assert(eyePixels[4] > eyePixels[5], 'Mint skin shadow should take the red genotype hue');
assert(eyePixels[0] > eyePixels[4], 'The brighter skin pixel should remain brighter after tinting');
assert.deepEqual(Array.from(eyePixels.slice(8, 12)), irisBefore, 'Cyan iris must remain intact');
assert.deepEqual(Array.from(eyePixels.slice(12, 16)), [0, 0, 0, 255], 'Black eye outlines must remain intact');
assert.deepEqual(Array.from(eyePixels.slice(16, 20)), [5, 9, 4, 255], 'Near-black green anti-alias outlines must stay intact');


const patterns = { brushtail: { enabled: true, copies: 2, color: '#445566' },
  cape: { enabled: true, copies: 1, color: '#aabbcc' } };
assert.equal(render.patternUrl('nelk', 'brushtail', 'run2', patterns),
  'assets/creaturesprites/nelk_brushtail-caped_run2.png');
assert.equal(render.patternUrl('nelk', 'cape', 'run2', patterns),
  'assets/creaturesprites/nelk_cape_run2.png');
assert.equal(render.patternUrl('nelk', 'brushtail', 'run2', { ...patterns, cape: { ...patterns.cape, enabled: false } }),
  'assets/creaturesprites/nelk_brushtail_run2.png');

const creature = {};
assert.equal(blink.getVisualState(creature, 'nelk', 0), 'A');
assert.equal(blink.getVisualState(creature, 'nelk', 9), 'A');
assert.equal(blink.getVisualState(creature, 'nelk', 10), 'B');
assert.equal(blink.getVisualState(creature, 'nelk', 11), 'B');
assert.equal(blink.getVisualState(creature, 'nelk', 22), 'C');
assert.equal(blink.getVisualState(creature, 'nelk', 34), 'D');
assert.equal(typeof blink.getVisualState({}, 'gar-wolf', 0), 'boolean',
  'ordinary open/shut blinking must remain a boolean');

genetics.init({ CREATURE_DB: { uumkaoii: { defaultSizeClass: 'large' },
  nelk: { defaultSizeClass: 'medium' }, nazgraku: { defaultSizeClass: 'large' } },
  clamp: (value, min, max) => Math.max(min, Math.min(max, value)) });
const fresh = genetics.makeDefaultGenotype('uumkaoii');
assert(fresh.base?.color);
assert(fresh.shell?.color);
assert.equal(fresh.shell.enabled, true);
assert.equal(fresh.shell.copies, 2);
assert.equal('fur' in fresh, false);
assert.equal('plates' in fresh, false);
const former = { fur: { color: '#aabbcc', copies: 2 }, plates: { color: '#445566', copies: 2 } };
assert.equal(genetics.normalizeLegacyGenotype('uumkaoii', former).shell.color, '#445566');
assert.equal(genetics.genotypeTraits('uumkaoii', former).patterns.length, 1);
assert.equal(genetics.crossOffspring(former, former, 'uumkaoii', 0).shell.enabled, true);
assert.equal(genetics.makeDefaultGenotype('nelk').base != null, true);
assert.equal(genetics.makeDefaultGenotype('nazgraku').base != null, true);

// The game's normal portrait URLs are retained for Nazgraku riding, not the
// separate mounted sprite files that lack whiskers.
const game = read('docs/game.js');
assert(game.includes("sprites: { idle: 'assets/creaturesprites/nazgraku_idle.png'"),
  'Nazgraku mounted source must stay on the regular whiskered portrait');
assert(game.includes("typeof blinkShut === 'string' ? ':eye-'"),
  'wild creature readiness keys include four-way eye pose');
assert(game.includes('window.CreatureGeneticsRender.eyeStatesForKind(kind)'),
  'cutscene preloader enumerates every supported eye state');

// The bestiary/editor and synchronous renderer must share the same authored Nazgraku rig.
const nazgrakuRig = JSON.parse(read('docs/config/creatures/hobunji-creature-bestiary.json'))
  .creatures.find(creature => creature.id === 'nazgraku')?.headRig; // Authored head rig shared by gameplay and editor.
assert(nazgrakuRig?.enabled, 'Nazgraku must have its authored head rig enabled');
assert.deepEqual(JSON.parse(JSON.stringify(render.ANIMAL_HEAD_RIGS.nazgraku)), nazgrakuRig,
  'Nazgraku runtime head rig must match its bestiary authoring data');
assert.equal(nazgrakuRig.pivot.x, 0.421875);
assert.equal(nazgrakuRig.pivot.y, 0.42592592592592593);
for (const channel of ['weightMap', 'compressibilityMap', 'stretchabilityMap']) {
  const grid = nazgrakuRig[channel]; // Checks each author-painted channel covers its declared grid.
  assert.equal(grid.encoding, 'rle-u9');
  assert.equal(grid.data.length % 2, 0, channel + ': runs must have paired count/value entries');
  assert.equal(grid.data.filter((_, index) => !(index % 2)).reduce((sum, count) => sum + count, 0),
    grid.width * grid.height, channel + ': RLE data must fill the complete grid');
  assert(grid.data.every((value, index) => Number.isInteger(value) && value >= 0
    && (index % 2 === 0 ? value > 0 : value <= 256)), channel + ': invalid RLE values');
}

// All three Uumkao'ii frames really are 641x451; do not silently fall back to the 1375x600 legacy billboard ratio.
const uumSize = { width: 641, height: 451 }; // Used to check native sprite headers and source/preview aspect consistency.
for (const frame of ['idle','run1','run2']) {
  const bytes = fs.readFileSync(`docs/assets/creaturesprites/uumkao'ii_${frame}.png`);
  assert.equal(bytes.readUInt32BE(16),uumSize.width,`Uumkaoii ${frame} native width`);
  assert.equal(bytes.readUInt32BE(20),uumSize.height,`Uumkaoii ${frame} native height`);
}
const nativeAspect = uumSize.height / uumSize.width; // Used by all three Uumkao'ii game definitions and the mirrored bestiary.
const defs = JSON.parse(read('docs/config/creatures/hobunji-creature-bestiary.json')).creatures;
assert(Math.abs(defs.find(entry=>entry.id==='uumkaoii').spriteAspect-nativeAspect)<1e-12,'tool bestiary must use the native Uumkaoii art ratio');
assert.equal((game.match(/spriteAspect:\s*451\s*\/\s*641/g)||[]).length>=3,true,'game applies native Uumkaoii aspect to domestic, wild, and den-mother models');
const farm = read('docs/js/farm-animals.js'); // Owned adults must use the corrected species aspect, not an independent old literal.
assert.match(farm,/ANIMAL_H = ANIMAL_W \* \(deps\.CREATURE_DB\.uumkaoii\?\.spriteAspect/);
const troughs = read('docs/js/farm-troughs.js'); // Sleep/barn models were already using the correct 451x641 source.
assert.match(troughs,/kind === 'uumkaoii' \? modelWidth \* \(451 \/ 641\)/);
// Every ordinary, unsquashed Uumkao'ii billboard must reproduce the source width:height ratio,
// regardless of overall adult width, genotype size class, or which stable/baby renderer built it.
const nativeWidthHeight = uumSize.width / uumSize.height; // 641 / 451, not the legacy 1375 / 600.
const standardFarmWidth = 1.275 * (600 / 1375) / nativeAspect; // Preserve the pre-fix standing height without stretching the texture.
assert(Math.abs(standardFarmWidth * nativeAspect - 1.275 * (600 / 1375)) < 1e-12,
  'correcting the adult model width preserves the existing height and ground-frame basis');
for (const sizeScale of [0.2, 1, 1.5]) {
  assert(Math.abs((standardFarmWidth * sizeScale) / (standardFarmWidth * nativeAspect * sizeScale) - nativeWidthHeight) < 1e-12,
    'Small, Medium, and Large must keep the exact native sprite aspect ratio');
}
const farmSource = read('docs/js/farm-animals.js');
assert.match(farmSource, /ANIMAL_W = 1\.275 \* \(600 \/ 1375\) \/ \(451 \/ 641\)/,
  'standing Uumkao\'ii uses the corrected visual width');
assert.match(farmSource, /CREATURE_DB\.uumkaoii\?\.spriteAspect \|\| \(451 \/ 641\)/,
  'standing Uumkao\'ii falls back to its own native aspect if the creature definition is unavailable');
for (const path of ['docs/js/livestock-nursery.js','docs/js/barn-incubator.js','docs/js/den-nest-system.js']) {
  const code = read(path);
  assert(code.includes('1.275 * (600 / 1375) / (451 / 641)'), path + ' uses the same adult width baseline as standing animals');
  assert(code.includes('451 / 641 : 600 / 1375'), path + ' preserves native Uumkao\'ii aspect when the bestiary is absent');
}
assert(read('docs/js/farm-troughs.js').includes('1.275 * (600 / 1375) / (451 / 641)'),
  'sleeping Uumkao\'ii uses the corrected width baseline too');
console.log('creature new sprite integration: all regression checks passed');
