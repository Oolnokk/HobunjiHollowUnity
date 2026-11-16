// Baby animal head warp is a texture-only, baby-only postprocess.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/baby-animal-head-warp.js', 'utf8'); // Exact game module, not a reimplemented mathematical approximation.
const nursery = fs.readFileSync('docs/js/livestock-nursery.js', 'utf8'); // Baby swarm integration and touch control.
const incubator = fs.readFileSync('docs/js/barn-incubator.js', 'utf8'); // Sleeping baby integration.
const nest = fs.readFileSync('docs/js/den-nest-system.js', 'utf8'); // Wild nest baby integration.
const index = fs.readFileSync('docs/index.html', 'utf8'); // Runtime bootstrap order.
const writes = new Map();
const storage = { getItem(key) { return writes.get(key) ?? null; }, setItem(key, value) { writes.set(key, value); } };
const head = { x: 0.3, y: 0.3, width: 0.4, height: 0.4, coordinateSpace: 'sprite-normalized-top-left' };
const windowStub = {
  localStorage: storage,
  HOBUNJI_ATTACHMENT_RIG_PROFILES: { creatures: { grehlr: { chatheadFrame: head } } },
};
let lastOutput = null;
const documentStub = {
  createElement(tag) {
    assert.equal(tag, 'canvas');
    const canvas = { width: 0, height: 0, bytes: null };
    canvas.getContext = () => ({
      createImageData(width, height) { return { data: new Uint8ClampedArray(width * height * 4) }; },
      putImageData(image) { canvas.bytes = image.data; },
    });
    lastOutput = canvas;
    return canvas;
  },
};
vm.runInNewContext(source, { window: windowStub, document: documentStub, Uint8ClampedArray }, { filename: 'baby-animal-head-warp.js' });
const warp = windowStub.BabyAnimalHeadWarp;
assert.equal(warp.getScale(), 1.22, 'experimental size defaults to 122%');
assert.equal(warp.frameForKind('grehlr').width, 0.4);
assert.equal(warp.frameForKind('missing'), null, 'a missing authored frame never guesses where the head is');

const width = 41, height = 41;
const pixels = new Uint8ClampedArray(width * height * 4);
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  const i = (y * width + x) * 4;
  pixels[i] = x * 5; pixels[i + 1] = y * 5; pixels[i + 2] = x ^ y; pixels[i + 3] = (x + y) % 2 ? 255 : 0;
}
const at = (array, x, y, channel = 0) => array[(y * width + x) * 4 + channel];
const warped = warp.warpPixels(pixels, width, height, head, 1.22);
assert.notEqual(warped, pixels, 'the warp returns new pixels and never mutates shared adult art');
assert.equal(at(warped, 0, 0), at(pixels, 0, 0), 'far-away corner is exactly unchanged');
assert.equal(at(warped, width - 1, height - 1, 3), at(pixels, width - 1, height - 1, 3), 'distant transparency is unchanged');
assert.equal(at(warped, 20, 20), at(pixels, 20, 20), 'authored head center is stationary');
assert(at(warped, 26, 20) < at(pixels, 26, 20), 'head expands: right-side destination samples nearer to the center');
assert.equal(at(warped, 40, 20), at(pixels, 40, 20), 'distant torso/limbs are exactly unchanged');
assert.deepEqual(Array.from(warp.warpPixels(pixels, width, height, head, 1)), Array.from(pixels), 'scale 1 is fully reversible');
assert.equal(warp.warpPixels(null, width, height, head), null, 'invalid input is rejected safely');

const input = { width, height, getContext: () => ({ getImageData: () => ({ data: pixels }) }) };
const output = warp.applyToCanvas(input, 'grehlr');
assert.notEqual(output, input, 'warped baby art occupies its own canvas');
assert.equal(output, lastOutput, 'canvas uses the native dimensions and the nearest-neighbor pixel map');
assert.equal(at(output.bytes, 26, 20), at(warped, 26, 20));
assert.equal(warp.applyToCanvas(input, 'missing'), input, 'unsupported baby species retain their original appearance');
windowStub.HobunjiAuthoredAnimalHeadRigs = { get: kind => kind === 'grehlr' ? { babyHeadScale: 1.33 } : null };
assert.equal(warp.scaleForKind('grehlr'), 1.33, 'a committed species head-rig overrides the global Nursery default');
writes.set('hobunji_animal_head_rigs_v1', JSON.stringify({ grehlr: { babyHeadScale: 1.4 } }));
assert.equal(warp.scaleForKind('grehlr'), 1.4, 'a saved head-rigger preview overrides the committed species rig');
assert.notEqual(warp.applyToCanvas(input, 'grehlr'), input, 'species-specific preview produces a warped baby canvas');
assert.equal(warp.applyToCanvas(input, 'grehlr', 1), input, 'editor preview 100% overrides any authored scale without mutating it');
writes.delete('hobunji_animal_head_rigs_v1');
assert.equal(warp.scaleForKind('grehlr'), 1.33, 'clearing preview restores committed species setting');
assert.equal(warp.setScale(1), 1, 'global experimental scale can be turned off');
assert.notEqual(warp.applyToCanvas(input, 'grehlr'), input, 'authored species scales remain active independently of global default');
windowStub.HobunjiAuthoredAnimalHeadRigs = null;
assert.equal(warp.applyToCanvas(input, 'grehlr'), input, 'global 100% disables an animal without its own authored scale');
assert.equal(warp.setScale(7), warp.MAX_SCALE, 'setter safely clamps extreme values');
assert.equal(warp.debugSnapshot().scale, warp.MAX_SCALE, 'diagnostics report current effect strength');
assert(warp.debugSnapshot().applied > 0, 'diagnostics report actual use');

assert(index.indexOf('baby-animal-head-warp.js') > index.indexOf('creature-genetics-render.js'), 'runtime module loads after genotype renderer');
assert(nursery.includes('BabyAnimalHeadWarp?.applyToCanvas(canvases[i], entry.kind)'), 'all baby nursery movement frames use the warp');
assert(nursery.includes('Baby head size (experiment)'), 'touch-accessible Nursery tuning is visible');
assert(nursery.includes('headWarp.setScale(slider.value)') && nursery.includes('rerollSwarm()'), 'size changes refresh active babies');
assert(incubator.includes('BabyAnimalHeadWarp?.applyToCanvas(composed, slot.baby.kind)'), 'incubator baby renders are warped AFTER the sleep composer');
assert(nest.includes('BabyAnimalHeadWarp?.applyToCanvas(canvas, kind)'), 'nest babies and fallback textures use the same math');
console.log('Baby animal authored-head warp integration and pixel tests passed.');
