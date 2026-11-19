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
  CreatureGeneticsRender: { SPECIES: { pingdort: { base: { idle: 'pingdort_idle.png' } } } },
  CreatureGenetics: {
    creatureSizeClass(kind, genotype) {
      const original = kind === 'pingdort' ? 'small' : kind === 'honeyfuzzle' ? 'medium' : 'medium';
      return kind === 'honeyfuzzle' ? original : (genotype?.sizeClass || original);
    },
  },
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
assert.equal(warp.getScale(), 1.23, 'every species defaults to the new 123% scale');
assert.equal(warp.getShortening(), 0.08, 'all baby and eligible Small shoulder-pet heads inherit 8% shortening');
assert.equal(warp.shorteningForKind('grehlr'), 0.08, 'registered Medium species inherit the same 8% shortening');
assert.equal(warp.shorteningForKind('pingdort'), 0.08, 'naturally Small species babies also inherit 8% shortening');
const formerDefaultWindow = { localStorage: {
  getItem: key => key === 'hobunji_baby_head_shortening_v1' ? '0.20' : null,
} }; // Simulates a returning player whose old 20% Nursery default was stored in localStorage.
vm.runInNewContext(source, { window: formerDefaultWindow, document: documentStub, Uint8ClampedArray },
  { filename: 'baby-animal-head-warp.js' });
assert.equal(formerDefaultWindow.BabyAnimalHeadWarp.getShortening(), 0.08,
  'migrate an old saved universal 20% default to the new inherited 8%');
const customDefaultWindow = { localStorage: {
  getItem: key => key === 'hobunji_baby_head_shortening_v1' ? '0.35' : null,
} }; // Intentional global settings other than the retired default stay customizable.
vm.runInNewContext(source, { window: customDefaultWindow, document: documentStub, Uint8ClampedArray },
  { filename: 'baby-animal-head-warp.js' });
assert.equal(customDefaultWindow.BabyAnimalHeadWarp.getShortening(), 0.35,
  'preserve a user-selected global shortening that does not equal the retired default');
const newChoiceStorage = new Map([ // New versioned settings must not re-migrate a consciously chosen 20%.
  ['hobunji_baby_head_shortening_v1', '0.20'],
  ['hobunji_baby_head_shortening_v2', '0.20'],
]);
const newChoiceWindow = { localStorage: {
  getItem: key => newChoiceStorage.get(key) ?? null,
  setItem: (key, value) => newChoiceStorage.set(key, value),
} };
vm.runInNewContext(source, { window: newChoiceWindow, document: documentStub, Uint8ClampedArray },
  { filename: 'baby-animal-head-warp.js' });
assert.equal(newChoiceWindow.BabyAnimalHeadWarp.getShortening(), 0.20,
  'explicit 20% selection in the new storage format is not mistaken for an old inherited default');
assert.equal(newChoiceWindow.BabyAnimalHeadWarp.setShortening(0.08), 0.08);
assert.equal(newChoiceStorage.get('hobunji_baby_head_shortening_v2'), '0.08',
  'new Nursery adjustments write the versioned setting');
assert.equal(warp.maskModeForKind('grehlr'), 'legacy-frame', 'all species default to the original painted Head selection');
assert.equal(warp.frameForKind('grehlr').width, 0.4);
assert.equal(warp.frameForKind('missing'), null, 'an unknown sprite species never guesses where the head is');
windowStub.AnimalChatheadFrame = { frameForKind: () => ({ ...head, source: 'animal-head-rig-fallback' }) }; // The dialogue module returns a generic crop even for non-species.
assert.equal(warp.frameForKind('missing'), null, 'generic chathead fallback must not enable arbitrary unknown animals');
windowStub.HobunjiAuthoredAnimalHeadRigs = { get: kind => kind === 'moot' ? {
  babyHeadFrame: { x: .05, y: .12, width: .4, height: .55, coordinateSpace: 'sprite-normalized-top-left' },
} : null };
assert.equal(warp.frameForKind('moot').height, .55, 'explicit Moot source box outranks an automatic generic dialogue fallback');
windowStub.HobunjiAuthoredAnimalHeadRigs = null;
windowStub.AnimalChatheadFrame = null;
assert(warp.frameForKind('pingdort'), 'unpainted registered species retain a conservative baby head frame');
assert.equal(warp.scaleForKind('pingdort'), 1.23, 'all baby species default to 123%, including babies of naturally small birds');
assert.equal(warp.isSmallSizeVariantPet('grehlr', { sizeClass: 'small' }, 'shoulderPet'), true,
  'genetically Small animals of normally Medium species use the juvenile head warp as pets');
assert.equal(warp.isSmallSizeVariantPet('pingdort', { sizeClass: 'small' }, 'shoulderPet'), false,
  'a naturally Small adult pet does not get an enlarged head');
assert.equal(warp.isSmallSizeVariantPet('pingdort', { sizeClass: 'small' }, 'baby'), false,
  'baby status is handled by the separate baby texture pipeline, irrespective of species');
assert.equal(warp.isSmallSizeVariantPet('grehlr', { sizeClass: 'medium' }, 'shoulderPet'), false,
  'ordinary Medium adults are not eligible');
assert.equal(warp.isSmallSizeVariantPet('grehlr', { sizeClass: 'small' }, 'companion'), false,
  'only small-sized pets receive the extra head warp; ordinary companions do not');
writes.set('hobunji_baby_head_warp_scale_v1', '1.22'); // Prior experiments saved a former default for returning users.
const migratedWindow = { ...windowStub };
const migratedCanvas = { ...documentStub };
vm.runInNewContext(source, { window: migratedWindow, document: migratedCanvas, Uint8ClampedArray });
assert.equal(migratedWindow.BabyAnimalHeadWarp.getScale(), 1.23,
  'the deprecated default 122% preference migrates to the approved universal 123%');
writes.set('hobunji_baby_head_warp_scale_v1', '1.23');
const migratedFrom123 = { ...windowStub };
vm.runInNewContext(source, { window: migratedFrom123, document: documentStub, Uint8ClampedArray });
assert.equal(migratedFrom123.BabyAnimalHeadWarp.getScale(), 1.23,
  'a previously saved 123% remains at the new universal default');
writes.set('hobunji_baby_head_warp_scale_v1', '1.32');
const migratedFrom132 = { ...windowStub }; // Previous inherited 132% must not pin existing browsers to an obsolete setting.
vm.runInNewContext(source, { window: migratedFrom132, document: documentStub, Uint8ClampedArray });
assert.equal(migratedFrom132.BabyAnimalHeadWarp.getScale(), 1.23,
  'existing browsers using the former 132% default migrate to 123%');
writes.set('hobunji_baby_head_warp_scale_v1', '1.27');
const userChosenScale = { ...windowStub }; // Non-default manual Nursery adjustments survive the default migration.
vm.runInNewContext(source, { window: userChosenScale, document: documentStub, Uint8ClampedArray });
assert.equal(userChosenScale.BabyAnimalHeadWarp.getScale(), 1.27,
  'a separate manually chosen scale is not overwritten by migration');
writes.delete('hobunji_baby_head_warp_scale_v1');
const paintedFrame = { x: 0.25, y: 0.18, width: 0.3, height: 0.42, coordinateSpace: 'sprite-normalized-top-left' };
writes.set('hobunji_animal_head_rigs_v1', JSON.stringify({ 'custom-pet': { babyHeadScale: 1.4, babyHeadFrame: paintedFrame } }));
assert.equal(warp.frameForKind('custom-pet').height, paintedFrame.height, 'custom animals use the frame exported from painted Head influence');
assert.equal(warp.scaleForKind('custom-pet'), 1.4, 'custom animals retain their saved head proportion independently');
writes.set('hobunji_animal_head_rigs_v1', JSON.stringify({ 'custom-pet': { babyHeadScale: 1.4, babyHeadFrame: { ...paintedFrame, width: -1 } } }));
assert.equal(warp.frameForKind('custom-pet'), null, 'malformed custom frame is rejected rather than corrupting pixels');
writes.delete('hobunji_animal_head_rigs_v1');

const width = 41, height = 41;
const pixels = new Uint8ClampedArray(width * height * 4);
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  const i = (y * width + x) * 4;
  pixels[i] = x * 5; pixels[i + 1] = y * 5; pixels[i + 2] = x ^ y; pixels[i + 3] = (x + y) % 2 ? 255 : 0;
}
const at = (array, x, y, channel = 0) => array[(y * width + x) * 4 + channel];
const idleSource = { width, height, data: Uint8ClampedArray.from(pixels) }; // Synthetic IDLE frame, separate from all run/eye/pattern textures.
const mask = warp.primeIdleMask('grehlr', idleSource);
assert(mask && mask.opaquePixels > 0, 'idle opaque pixels inside chathead frame define the first mask');
assert.equal(warp.maskForKind('grehlr'), mask, 'same cached idle mask is reused for every animated pose');
const warped = warp.warpPixels(pixels, width, height, head, 1.32, mask);
assert(warp.warpPixels(pixels, width, height, head, 1.23, mask).some((value, i) => value !== pixels[i]),
  'the new 123% setting must visibly change original head pixels');
assert.notEqual(warped, pixels, 'the warp returns new pixels and never mutates shared adult art');
assert.equal(at(warped, 0, 0), at(pixels, 0, 0), 'far-away corner is exactly unchanged');
assert.equal(at(warped, width - 1, height - 1, 3), at(pixels, width - 1, height - 1, 3), 'distant transparency is unchanged');
assert.equal(at(warped, 20, 20), at(pixels, 20, 20), 'authored head center is stationary');
assert(at(warped, 26, 20) < at(pixels, 26, 20), 'head expands: right-side destination samples nearer to the center');
assert.equal(at(warped, 40, 20), at(pixels, 40, 20), 'distant torso/limbs are exactly unchanged');
const shortenedOnly = warp.warpPixels(pixels, width, height, head, 1, mask, 0.2); // Brachycephaly independent from head enlargement.
assert(at(shortenedOnly, 26, 20) > at(pixels, 26, 20), 'head shortening samples farther outward source pixels at the same visible destination X');
assert.equal(at(shortenedOnly, 20, 26, 1), at(pixels, 20, 26, 1), 'horizontal shortening never modifies vertical sprite coordinates');
assert.equal(at(shortenedOnly, 40, 20), at(pixels, 40, 20), 'shortening leaves distant body/limb pixels unchanged');
assert.deepEqual(Array.from(warp.warpPixels(pixels, width, height, head, 1, mask, 0)),
  Array.from(pixels), '100% enlargement with 0% shortening exactly preserves source art');
assert.deepEqual(Array.from(warp.warpPixels(pixels, width, height, head, 1, mask)), Array.from(pixels), 'scale 1 is fully reversible');
assert.equal(warp.warpPixels(null, width, height, head), null, 'invalid input is rejected safely');
assert.deepEqual(Array.from(warp.warpPixels(pixels, width, height, head, 1.32)), Array.from(pixels),
  'without an established idle mask no rectangular fallback is permitted');

const input = { width, height, getContext: () => ({ getImageData: () => ({ data: pixels }) }) };
const output = warp.applyToCanvas(input, 'grehlr', 1.32, null, 0, false); // Explicitly request idle-alpha mode to compare its established pixel fixture.
assert.notEqual(output, input, 'warped baby art occupies its own canvas');
assert.equal(output, lastOutput, 'canvas uses the native dimensions and the nearest-neighbor pixel map');
assert.equal(at(output.bytes, 26, 20), at(warped, 26, 20));
const blankIdle = new Uint8ClampedArray(width * height * 4);
assert.equal(warp.buildIdleMask(blankIdle, width, height, head), null, 'an entirely transparent chathead area never becomes a rectangular mask');
const sparseIdle = new Uint8ClampedArray(width * height * 4);
for (let y = 18; y <= 22; y++) for (let x = 18; x <= 22; x++) sparseIdle[(y * width + x) * 4 + 3] = 255;
const sparse = warp.buildIdleMask(sparseIdle, width, height, head);
assert.equal(sparse.opaquePixels, 25, 'only truly opaque IDLE pixels within the chathead frame define the head');
assert.equal(sparse.coverage[20 * width + 20], 1, 'opaque idle-head pixels receive full deformation strength');
assert(sparse.coverage[20 * width + 26] < 1, 'transparent space inside the rectangular frame is no longer treated as full-strength head');
assert.equal(sparse.coverage[0], 0, 'distant transparent and torso pixels have no effect');
assert.notEqual(warp.warpPixels(pixels, width, height, head, 1.32, mask), pixels,
  'any pose samples the original idle silhouette but warps its own final texture');
const layeredArt = Uint8ClampedArray.from(pixels);
const eye = (19 * width + 23) * 4, pattern = (22 * width + 25) * 4; // Distinct final-composite colors: eye and painted coat pattern.
layeredArt.set([252, 22, 75, 255], eye);
layeredArt.set([19, 155, 235, 255], pattern);
const layeredWarp = warp.warpPixels(layeredArt, width, height, head, 1.32, mask);
const position = (x, y) => (y * width + x) * 4;
assert(layeredWarp.some((value, i) => value !== layeredArt[i]), 'post-composite head warp moves genuine image pixels');
const enlargedEye = [25, 19].map((value, i) => value); // Head-local test samples move outward with the same inverse pixel transform.
assert(layeredWarp.some((_, i) => i % 4 === 0 && layeredWarp[i] === 252 && layeredWarp[i+1] === 22),
  'red eye artwork stays in the enlarged texture');
assert(layeredWarp.some((_, i) => i % 4 === 0 && layeredWarp[i] === 19 && layeredWarp[i+1] === 155),
  'blue coat-pattern artwork remains in the same enlarged texture');
const rgbaAt = (bytes, x, y) => Array.from(bytes.slice((y * width + x) * 4, (y * width + x) * 4 + 4)); // Compare exactly the repositioned overlay, not just existence somewhere.
assert.deepEqual(rgbaAt(layeredWarp, 24, 19), [252, 22, 75, 255],
  'the eye actually moves outward inside the enlarged head instead of remaining at its old position');
assert.deepEqual(rgbaAt(layeredWarp, 26, 22), [19, 155, 235, 255],
  'the colored coat pattern actually moves outward with the same head pixels');
assert.equal(warp.applyToCanvas(input, 'missing'), input, 'unsupported baby species retain their original appearance');
const paintedRig = { width: 4, height: 4, encoding: 'rle-u9', data: [5, 0, 2, 255, 2, 0, 2, 255, 5, 0] };
windowStub.HobunjiAuthoredAnimalHeadRigs = { get: kind => kind === 'grehlr' ? { babyHeadScale: 1.33, weightMap: paintedRig } : null };
assert.notEqual(warp.frameForKind('grehlr').width, head.width,
  'default original growth method derives the box from painted Head influence instead of the chathead');
assert.equal(warp.frameForKind('grehlr', false).width, head.width,
  'the optional idle alpha method still uses the authored dialogue head frame');
assert.equal(warp.frameFromRig({ weightMap: { ...paintedRig, data: [1, 255, -2, 0] } }), null, 'malformed painted-map runs cannot produce a head frame');
assert.equal(warp.scaleForKind('grehlr'), 1.33, 'a committed species head-rig overrides the global Nursery default');
writes.set('hobunji_animal_head_rigs_v1', JSON.stringify({ grehlr: { babyHeadScale: 1.4 } }));
assert.equal(warp.scaleForKind('grehlr'), 1.4, 'a saved head-rigger preview overrides the committed species rig');
assert.equal(warp.maskModeForKind('grehlr'), 'legacy-frame', 'a saved rig without mode override inherits the original method');
writes.set('hobunji_animal_head_rigs_v1', JSON.stringify({ grehlr: {
  babyHeadScale: 1.4, babyHeadUsePaintedFrame: false,
} }));
assert.equal(warp.maskModeForKind('grehlr'), 'idle-alpha', 'explicit false selects the newer idle-alpha method for one species');
assert.equal(warp.frameForKind('grehlr').width, head.width, 'alpha opt-in uses the chathead frame');
writes.set('hobunji_animal_head_rigs_v1', JSON.stringify({ grehlr: {
  babyHeadScale: 1.4, babyHeadShortening: 0.35, babyHeadUsePaintedFrame: true,
  weightMap: paintedRig,
} }));
assert.equal(warp.shorteningForKind('grehlr'), 0.35, 'per-species shortening overrides the inherited global amount');
assert.equal(warp.maskModeForKind('grehlr'), 'legacy-frame', 'painted-selection checkbox reaches the live runtime');
assert.notEqual(warp.frameForKind('grehlr').width, head.width, 'legacy mode uses painted Head bounds rather than the chathead frame');
const legacyPixels = warp.warpPixels(pixels, width, height, warp.frameForKind('grehlr'), 1.23, null, 0.25, 'legacy-frame');
assert(legacyPixels.some((pixel, i) => pixel !== pixels[i]), 'legacy painted selection runs without an idle alpha mask');
assert.notEqual(warp.applyToCanvas(input, 'grehlr', null, null, null, true), input,
  'legacy mode stays functional when idle opacity has not been primed for its painted frame');

assert.notEqual(warp.applyToCanvas(input, 'grehlr'), input, 'species-specific preview produces a warped baby canvas');
assert.equal(warp.applyToCanvas(input, 'grehlr', 1, null, 0), input, 'editor preview 100% size and 0% shortening yields the original');
assert.notEqual(warp.applyToCanvas(input, 'grehlr', 1), input, 'brachycephaly remains independently active even at 100% enlargement');
writes.delete('hobunji_animal_head_rigs_v1');
assert.equal(warp.scaleForKind('grehlr'), 1.33, 'clearing preview restores committed species setting');
assert.equal(warp.setScale(1), 1, 'global experimental scale can be turned off');
assert.equal(warp.setShortening(0), 0, 'global head shortening can be independently disabled');
assert.notEqual(warp.applyToCanvas(input, 'grehlr'), input, 'authored species scales remain active independently of global default');
windowStub.HobunjiAuthoredAnimalHeadRigs = null;
assert.equal(warp.applyToCanvas(input, 'grehlr'), input, 'global 100% disables an animal without its own authored scale');
assert.equal(warp.setScale(7), warp.MAX_SCALE, 'setter safely clamps extreme values');
assert.equal(warp.setShortening(7), warp.MAX_SHORTENING, 'head shortening has a safe upper bound');
assert.equal(warp.setShortening(-7), 0, 'head shortening cannot invert the skull');
assert.equal(warp.debugSnapshot().masksCached >= 1, true, 'mobile diagnostics expose established cached idle masks');
assert.equal(warp.debugSnapshot().scale, warp.MAX_SCALE, 'diagnostics report current effect strength');
assert.equal(warp.debugSnapshot().shortening, 0, 'mobile debug includes independent shortening amount');
assert(warp.debugSnapshot().applied > 0, 'diagnostics report actual use');

// Grehlr's source PNG is 3000×2250: the old 4MP sourcePixels ceiling rejected it outright.
const largeW = 3000, largeH = 2250; // Real Grehlr source dimensions exercise adaptive idle-mask sampling.
const largeIdle = new Uint8ClampedArray(largeW * largeH * 4); // Mostly transparent pixels mimic a detailed sprite canvas.
for (let y = 900; y < 1400; y++) for (let x = 1000; x < 1600; x++)
  largeIdle[(y * largeW + x) * 4 + 3] = 255;
const largeMask = warp.primeIdleMask('grehlr', { width: largeW, height: largeH, data: largeIdle }, head);
assert(largeMask?.opaquePixels > 0, 'full-resolution Grehlr idle artwork must produce a valid alpha-only head mask');
assert(largeMask.width * largeMask.height <= 1024 * 1024, 'large idle masks stay under the one-megapixel memory budget');
assert.equal(warp.maskForKind('grehlr', head), largeMask, 'large masks remain available for different pose textures');
assert.equal(warp.warpPixels(pixels, width, height, head, 1.32, largeMask).length, pixels.length,
  'the bounded idle mask scales correctly to another pose resolution');

assert(index.indexOf('baby-animal-head-warp.js') > index.indexOf('creature-genetics-render.js'), 'runtime module loads after genotype renderer');
assert(nursery.includes('BabyAnimalHeadWarp?.applyToCanvas(canvases[i], entry.kind)'), 'all baby nursery movement frames use the warp');
assert(nursery.includes('ensureIdleMask?.(entry.kind, canvases[0])'), 'nursery primes the fixed mask from the actual idle frame before run frames');
assert(nursery.includes('speciesDef.sprites?.idle') && nursery.includes('rawBabyFrameCanvas('),
  'nursery baby visuals work for species with ordinary PNG sprites and no genotype-compositor registry');
assert(nursery.includes("image.crossOrigin = 'anonymous'"),
  'raw nursery sources are CORS readable for the idle alpha mask');
assert(incubator.includes('ensureIdleMask?.(slot.baby.kind, composed)'), 'incubator primes from composed idle before sleep presentation');
assert(incubator.includes('speciesDef.sprites?.idle') && incubator.includes("image.crossOrigin = 'anonymous'"),
  'incubator babies without a genotype renderer use their authored idle sprite with a readable opacity mask');
assert(nest.includes('ensureIdleMask?.(kind, canvas)'), 'nest babies prime from their idle silhouette before applying their pose');
const bridge = fs.readFileSync('docs/js/player-body-attachment-bridge.js', 'utf8');
assert(bridge.includes('await warp?.ensureIdleMask?.(kind)'),
  'small shoulder-pet frame pipeline awaits the registered idle sprite');
assert(bridge.includes('await warp?.ensureIdleMask?.(kind, idleSource)'),
  'small shoulder-pet split source uses the LEFT idle sprite before clipping run1');
assert(bridge.includes('return loadFrameImage(rawUrl)'),
  'non-composited species must still enlarge their real raw shoulder-pet sprite');
const configManifest = fs.readFileSync('docs/js/bootstrap/classic-groups/combat-config.js', 'utf8');
const configLoader = fs.readFileSync('docs/js/combat/combat-config-loader.js', 'utf8');
assert.match(configManifest, /combat-config-loader\.js\?v=[A-Za-z0-9_-]+/,
  'game parser must load a cache-versioned combat bootstrap after shoulder-pet changes');
assert.match(configLoader, /held-item-action-input\.js\?v=[A-Za-z0-9_-]+/,
  'merge must retain the newer main hold-release input bridge');
assert.match(configLoader, /player-body-attachment-bridge\.js\?v=[A-Za-z0-9_-]+/,
  'game combat bootstrap must load the cache-versioned shoulder-pet bridge');
const farmManifest = fs.readFileSync('docs/js/bootstrap/classic-groups/farm-buildings.js', 'utf8');
const troughs = fs.readFileSync('docs/js/farm-troughs.js', 'utf8');
const nurseryBridge = fs.readFileSync('docs/js/livestock-nursery-install-bridge.js', 'utf8');
assert.match(farmManifest, /farm-troughs\.js\?v=[A-Za-z0-9_-]+/,
  'the farm bootstrap must load a cache-versioned nursery launcher');
assert.match(troughs, /livestock-nursery\.js\?v=[A-Za-z0-9_-]+/,
  'the trough loader must load the cache-versioned nursery for raw sprite fallbacks');
assert.match(troughs, /livestock-nursery-install-bridge\.js\?v=[A-Za-z0-9_-]+/,
  'the trough loader must load the cache-versioned nursery installer');
assert.match(nurseryBridge, /barn-incubator\.js\?v=[A-Za-z0-9_-]+/,
  'the installer must load the cache-versioned incubator idle sprite fallback');
assert(nursery.includes('Baby head size (experiment)'), 'touch-accessible Nursery tuning is visible');
assert(nursery.includes('headWarp.setScale(slider.value)') && nursery.includes('rerollSwarm()'), 'size changes refresh active babies');
assert(incubator.includes('BabyAnimalHeadWarp?.applyToCanvas(composed, slot.baby.kind)'), 'incubator baby renders are warped AFTER the sleep composer');
assert(nest.includes('BabyAnimalHeadWarp?.applyToCanvas(canvas, kind)'), 'nest babies and fallback textures use the same math');
console.log('Baby animal authored-head warp integration and pixel tests passed.');
 
// Verify that the first genetically decorated baby CANNOT poison the per-species head silhouette.
// A registered unmodified base idle PNG must win even when a genotype-composited idle canvas is supplied first.
(async () => {
  const rawIdle = new Uint8ClampedArray(width * height * 4); // Actual base artwork silhouette, deliberately smaller than the decorated genotype.
  const decorated = new Uint8ClampedArray(width * height * 4); // Individual variant with extra opaque pattern and eye layers.
  for (let y = 15; y < 26; y++) for (let x = 15; x < 26; x++) decorated[(y * width + x) * 4 + 3] = 255;
  for (let y = 19; y < 23; y++) for (let x = 19; x < 23; x++) rawIdle[(y * width + x) * 4 + 3] = 255;
  const requested = []; // Observes actual loader mode/source instead of assuming a CORS-safe image.
  class RawIdleImage {
    constructor() { this.naturalWidth = width; this.naturalHeight = height; this.data = rawIdle; }
    set src(url) {
      requested.push({ url, mode: this.crossOrigin });
      queueMicrotask(() => this.onload?.());
    }
  }
  const isolatedWindow = {
    localStorage: storage,
    HOBUNJI_ATTACHMENT_RIG_PROFILES: windowStub.HOBUNJI_ATTACHMENT_RIG_PROFILES,
    CreatureGeneticsRender: { SPECIES: { grehlr: { base: { idle: 'assets/creaturesprites/grehlr_idle.png' } } } },
  };
  const isolatedDocument = { ...documentStub, baseURI: 'https://example.test/docs/index.html' };
  vm.runInNewContext(source, {
    window: isolatedWindow, document: isolatedDocument, Image: RawIdleImage, URL,
    Uint8Array, Uint8ClampedArray, Float32Array,
  });
  const api = isolatedWindow.BabyAnimalHeadWarp;
  const decoratedIdle = { width, height, data: decorated };
  const established = await api.ensureIdleMask('grehlr', decoratedIdle);
  assert(established && established.opaquePixels === 16, 'only the original base IDLE opaque pixels establish the shared mask');
  assert.equal(established.sourceLabel, 'unmodified-base-idle-png', 'species masks must record that the authoritative sprite was used');
  assert.equal(requested.length, 1, 'load the base idle PNG exactly once');
  assert.equal(requested[0].mode, 'anonymous', 'CORS mode precedes base idle PNG source assignment');
  assert.match(requested[0].url, /grehlr_idle\.png$/, 'the source is always the idle sprite, not a running frame');
  assert.equal(await api.ensureIdleMask('grehlr', { width, height, data: pixels }), established,
    'a second animal with different eyes and patterns cannot replace the established idle mask');
  assert.equal(api.frameForKind('pingdort'), null, 'a species missing from the genotype renderer is initially unknown');
  const birdMask = await api.ensureIdleMask('pingdort', decoratedIdle); // Real baby-bird idle art still exists, despite missing genotype metadata.
  assert(birdMask?.opaquePixels > 0, 'a supplied idle sprite establishes the baby mask for a naturally Small species');
  assert(api.frameForKind('pingdort'), 'the chathead fallback is now available for that verified real idle-sprite species');
  api.setScale(1.23);
  assert.notEqual(api.applyToCanvas(input, 'pingdort'), input,
    'a naturally Small baby without a genotype renderer still receives the universal 123% head warp');
  const alternatePose = Uint8ClampedArray.from(pixels); // Movement pose and its colored overlays are warped after the fixed source was chosen.
  alternatePose.set([245, 40, 70, 255], (21 * width + 21) * 4);
  assert.notDeepEqual(
    Array.from(api.warpPixels(alternatePose, width, height, head, 1.32, established)),
    Array.from(alternatePose),
    'a non-idle pose still changes under the stable raw-idle opacity mask',
  );
  console.log('PASS raw idle mask precedence, cross-origin loader, multi-genotype reuse and alternate pose');
})().catch(error => { console.error(error); process.exitCode = 1; });

