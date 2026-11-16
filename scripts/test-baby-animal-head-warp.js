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
assert.equal(warp.getScale(), 1.32, 'every species defaults to the new 132% scale');
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
assert.equal(warp.scaleForKind('pingdort'), 1.32, 'all baby species default to 132%, including babies of naturally small birds');
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
assert.equal(migratedWindow.BabyAnimalHeadWarp.getScale(), 1.32,
  'the deprecated default 122% preference migrates to the approved universal 132%');
writes.set('hobunji_baby_head_warp_scale_v1', '1.23');
const migratedFrom123 = { ...windowStub };
vm.runInNewContext(source, { window: migratedFrom123, document: documentStub, Uint8ClampedArray });
assert.equal(migratedFrom123.BabyAnimalHeadWarp.getScale(), 1.32,
  'previous inherited 123% preference also migrates to the new 132% default');
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
assert.notEqual(warped, pixels, 'the warp returns new pixels and never mutates shared adult art');
assert.equal(at(warped, 0, 0), at(pixels, 0, 0), 'far-away corner is exactly unchanged');
assert.equal(at(warped, width - 1, height - 1, 3), at(pixels, width - 1, height - 1, 3), 'distant transparency is unchanged');
assert.equal(at(warped, 20, 20), at(pixels, 20, 20), 'authored head center is stationary');
assert(at(warped, 26, 20) < at(pixels, 26, 20), 'head expands: right-side destination samples nearer to the center');
assert.equal(at(warped, 40, 20), at(pixels, 40, 20), 'distant torso/limbs are exactly unchanged');
assert.deepEqual(Array.from(warp.warpPixels(pixels, width, height, head, 1, mask)), Array.from(pixels), 'scale 1 is fully reversible');
assert.equal(warp.warpPixels(null, width, height, head), null, 'invalid input is rejected safely');
assert.deepEqual(Array.from(warp.warpPixels(pixels, width, height, head, 1.32)), Array.from(pixels),
  'without an established idle mask no rectangular fallback is permitted');

const input = { width, height, getContext: () => ({ getImageData: () => ({ data: pixels }) }) };
const output = warp.applyToCanvas(input, 'grehlr');
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
assert.equal(warp.frameForKind('grehlr').width, head.width,
  'chathead bounds, not painted head influence, define the alpha-mask source rectangle');
assert.equal(warp.frameFromRig({ weightMap: { ...paintedRig, data: [1, 255, -2, 0] } }), null, 'malformed painted-map runs cannot produce a head frame');
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
assert.equal(warp.debugSnapshot().masksCached >= 1, true, 'mobile diagnostics expose established cached idle masks');
assert.equal(warp.debugSnapshot().scale, warp.MAX_SCALE, 'diagnostics report current effect strength');
assert(warp.debugSnapshot().applied > 0, 'diagnostics report actual use');

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
assert(bridge.includes('await window.BabyAnimalHeadWarp?.ensureIdleMask?.(kind, idleSource)'),
  'small shoulder-pet split source uses the LEFT idle sprite before clipping run1');
assert(bridge.includes('return loadFrameImage(rawUrl)'),
  'non-composited species must still enlarge their real raw shoulder-pet sprite');
const configManifest = fs.readFileSync('docs/js/bootstrap/classic-groups/combat-config.js', 'utf8');
const configLoader = fs.readFileSync('docs/js/combat/combat-config-loader.js', 'utf8');
assert(configManifest.includes('combat-config-loader.js?v=20261116idleMaskAudit3'),
  'game parser must invalidate its cached combat bootstrap when shoulder-pet integration changes');
assert(configLoader.includes('player-body-attachment-bridge.js?v=20261116idleMask132b'),
  'game combat bootstrap must load the audited shoulder-pet bridge, not its prior cached implementation');
const farmManifest = fs.readFileSync('docs/js/bootstrap/classic-groups/farm-buildings.js', 'utf8');
const troughs = fs.readFileSync('docs/js/farm-troughs.js', 'utf8');
const nurseryBridge = fs.readFileSync('docs/js/livestock-nursery-install-bridge.js', 'utf8');
assert(farmManifest.includes('farm-troughs.js?v=20261116idleMaskCoverage3'),
  'the farm bootstrap must invalidate cached nursery and incubator launchers');
assert(troughs.includes('livestock-nursery.js?v=20261116idleMaskCoverage3')
  && troughs.includes('livestock-nursery-install-bridge.js?v=20261116idleMaskCoverage3'),
  'the nursery and its installer must both load new raw-baby fallbacks');
assert(nurseryBridge.includes('barn-incubator.js?v=20261116idleMaskCoverage3'),
  'the installer must load the latest incubator idle-art fallback');
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
  const alternatePose = Uint8ClampedArray.from(pixels); // Movement pose and its colored overlays are warped after the fixed source was chosen.
  alternatePose.set([245, 40, 70, 255], (21 * width + 21) * 4);
  assert.notDeepEqual(
    Array.from(api.warpPixels(alternatePose, width, height, head, 1.32, established)),
    Array.from(alternatePose),
    'a non-idle pose still changes under the stable raw-idle opacity mask',
  );
  console.log('PASS raw idle mask precedence, cross-origin loader, multi-genotype reuse and alternate pose');
})().catch(error => { console.error(error); process.exitCode = 1; });

