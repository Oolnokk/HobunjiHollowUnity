#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const WIDTH = 6; // Coat, highlight, hoof, beard, a belly-overlap fringe, and an exposed translucent beard tip.
const HEIGHT = 1; // One row makes the mask/recolor behavior deterministic.
const frameReads = []; // Records which of the three authored beard frame URLs the compositor actually loads.
const coatColor = '#2357bb'; // Used to compare the default beard's tint with the base allele.

function imagePixels(url) {
  const result = new Uint8ClampedArray(WIDTH * HEIGHT * 4); // Fake image buffer shared by the minimal Canvas implementation.
  if (url.includes('voorg-ass_beard1_')) {
    frameReads.push(url);
    result.set([180, 180, 180, 255], 12); // Default beard pixels use normal grayscale pattern shade-fill.
    result.set([180, 180, 180, 100], 16); // A feathered beard edge overlays opaque coat and belly artwork.
    result.set([180, 180, 180, 100], 20); // Exposed beard tip has no backing coat or belly; repeated alpha blending must not thicken it.
  } else if (url.includes('voorg-ass_beard2_')) {
    frameReads.push(url);
    result.set([180, 180, 180, 255], 12); // Future unique beard occupies the exact same location, never an additional layer.
  } else if (url.includes('voorg-ass_belly_')) {
    result.set([200, 100, 40, 255], 16); // Belly shows through the beard's semi-transparent edge after paint.
  } else if (/voorg-ass_(idle|run1|run2)\.png/.test(url)) {
    result.set([0x99, 0xBF, 0x99, 255], 0); // Coat source-key pixel.
    result.set([0xEE, 0xEE, 0xEE, 255], 4); // Unrecolored detail.
    result.set([0xC0, 0x40, 0x40, 255], 8); // Unrelated red detail.
    result.set([0x99, 0xBF, 0x99, 255], 16); // Coat directly behind semi-transparent beard, so its drawn alpha is opaque.
  }
  return result;
}

class Canvas {
  constructor() {
    this.width = WIDTH; // Used by the real compositor's image and pixel dimensions.
    this.height = HEIGHT; // Used by the real compositor's image and pixel dimensions.
    this.pixels = new Uint8ClampedArray(WIDTH * HEIGHT * 4); // Used by synthetic drawImage and getImageData.
  }
  getContext() {
    return {
      drawImage: image => {
        for (let i = 0; i < this.pixels.length; i += 4) {
          const alpha = (image?.pixels?.[i + 3] || 0) / 255;
          if (!alpha) continue;
          const oldAlpha = this.pixels[i + 3] / 255;
          const combinedAlpha = alpha + oldAlpha * (1 - alpha); // Matches normal source-over compositing at feathered edges.
          for (let channel = 0; channel < 3; channel++) {
            this.pixels[i + channel] = (image.pixels[i + channel] * alpha + this.pixels[i + channel] * oldAlpha * (1 - alpha)) / combinedAlpha;
          }
          this.pixels[i + 3] = combinedAlpha * 255;
        }
      },
      getImageData: () => ({ data: new Uint8ClampedArray(this.pixels) }),
      putImageData: data => { this.pixels = new Uint8ClampedArray(data.data); },
    };
  }
}
class FakeImage {
  constructor() {
    this.naturalWidth = WIDTH; // Source image dimensions used by recoloredPattern.
    this.naturalHeight = HEIGHT; // Source image dimensions used by recoloredPattern.
    this.pixels = imagePixels(''); // Reset transparency between loads.
  }
  set src(url) {
    this.pixels = imagePixels(url);
    queueMicrotask(() => this.onload?.());
  }
}

const browser = {
  console,
  document: { createElement: kind => kind === 'canvas' ? new Canvas() : null, addEventListener() {} },
  Image: FakeImage,
  fetch: async () => ({ json: async () => ({}) }), // No base masks; Voorg-Ass uses the coat's keyed source color.
  performance: { now: () => 0 },
  window: { SCRATCHBONES_CONFIG: { game: {} }, __farmLog: () => {}, addEventListener() {} },
};
vm.runInNewContext(fs.readFileSync('docs/js/color-fill.js', 'utf8'), browser);
vm.runInNewContext(fs.readFileSync('docs/js/creature-genetics-render.js', 'utf8'), browser);
vm.runInNewContext(fs.readFileSync('docs/js/voorg-ass-registration.js', 'utf8'), browser);
const { CreatureGeneticsRender: render, VoorgAssRegistration: registration } = browser.window; // Shared real runtime modules, not a recreated compositor.
registration.ensureRendererSpecies(render.SPECIES);
const emptyLegacy = registration.displayGenotypeFor('voorg-ass', null); // Tests default coat on pre-genetics animal saves.
const legacyMother = registration.displayGenotypeFor('voorg-ass-herd-mother', undefined); // Same fallback on carried-baby Herd-Mothers.
assert.equal(emptyLegacy.base.color, '#99BF99');
assert.equal(emptyLegacy.belly.copies, 2);
assert.equal(legacyMother.base.color, '#99BF99');
assert.equal(emptyLegacy.beard1, undefined, 'fallback adds no beard genes');
assert.equal(registration.displayGenotypeFor('puktuk', null), null, 'fallback cannot alter other species');
const authoredGenes = { base: { color: '#112233' }, beard2: { color: '#bb6644', enabled: true, copies: 1 } };
assert.equal(registration.displayGenotypeFor('voorg-ass', authoredGenes), authoredGenes, 'existing genetic variants are preserved by identity');
assert(fs.readFileSync('docs/js/farm-animals.js', 'utf8').includes('VoorgAssRegistration?.displayGenotypeFor'), 'farm animals receive stable legacy display coats');
assert(fs.readFileSync('docs/game.js', 'utf8').includes('VoorgAssRegistration?.displayGenotypeFor'), 'wild animals and companions receive stable legacy display coats');
const spec = render.SPECIES['voorg-ass']; // Registered metadata checked against the default/non-genetic contract.
assert.deepEqual(JSON.parse(JSON.stringify(spec.patterns)), ['belly'], 'beard1 must not be an inherited pattern');
assert.deepEqual(JSON.parse(JSON.stringify(spec.defaultCoatPatterns)), [{ id: 'beard1', family: 'beard' }]);
assert.equal(fs.existsSync('docs/assets/creaturesprites/patterns/voorg-ass_beard1_idle.png'), true);
assert.equal(fs.existsSync('docs/assets/creaturesprites/patterns/voorg-ass_beard1_run1.png'), true);
assert.equal(fs.existsSync('docs/assets/creaturesprites/patterns/voorg-ass_beard1_run2.png'), true);
assert.equal(render.patternUrl('voorg-ass', 'beard1', 'run2'), 'assets/creaturesprites/patterns/voorg-ass_beard1_run2.png');

(async () => {
  const genotype = { base: { color: coatColor }, belly: { enabled: true, copies: 2, color: '#b8a070' } }; // No beard gene at all.
  const sig = render.genotypeSignature('voorg-ass', genotype); // Must not add a separate default beard allele to texture identity.
  const framePixels = canvas => Array.from(canvas.pixels.slice(12, 16)); // Final beard pixel, outside the base/belly region.
  for (const frame of ['idle', 'run1', 'run2']) {
    const output = await render.composeFrame('voorg-ass', frame, genotype);
    const beard = framePixels(output);
    assert(beard[3] > 0 && beard[2] > beard[0], frame + ' default beard uses blue base-coat tint');
    assert(frameReads.some(url => url.endsWith('voorg-ass_beard1_' + frame + '.png')), frame + ' references its authored file');
  }
  const paintCalls = []; // Records each Color Pools region pass, including the separate beard sprite covered by base-coat paint.
  browser.window.ClothingWeavingSystem = {
    applyPatternStackToTintedImage: async (source, patterns, dyeHex, cachePrefix, _shadeSource, _debugLabel, options) => {
      const output = new Canvas(); // Distinct simulated woven result; the renderer's actual clipping/ordering runs unmodified.
      output.pixels.set(source.pixels);
      const paintedPixels = []; // Confirms the original hoof and highlight never reach the weaving pass.
      for (let i = 0; i < output.pixels.length; i += 4) {
        if (!output.pixels[i + 3]) continue;
        paintedPixels.push(i / 4);
        output.pixels.set([0x20, 0xd0, 0xf0, output.pixels[i + 3]], i);
      }
      paintCalls.push({ cachePrefix, paintedPixels, patternCount: patterns.length, dyeHex, continuousSurface: options?.continuousSurface });
      return output;
    },
  };
  const paintedGenotype = {
    ...genotype,
    colorPoolPaint: { version: 1, layers: { base: {
      dyeHex: '#20d0f0', patterns: [
        { motifDataUrl: 'data:image/png;base64,AA==' },
        { motifDataUrl: 'data:image/png;base64,AQ==', inkColorHex: '#20d0f0' },
      ],
    } } },
  }; // Base coat owns both pattern slots; beard remains anatomical, not a paintable allele.
  const paintedSig = render.genotypeSignature('voorg-ass', paintedGenotype); // Verifies live composing never writes hidden genes into the paint signature.
  for (const frame of ['idle', 'run1', 'run2']) {
    paintCalls.length = 0;
    const result = await render.composeFrame('voorg-ass', frame, paintedGenotype);
    const colorAt = pixel => Array.from(result.pixels.slice(pixel * 4, pixel * 4 + 3));
    assert.deepEqual(colorAt(0), [0x20, 0xd0, 0xf0], frame + ': Color Pools reaches coat pixels');
    assert.deepEqual(colorAt(1), [0xee, 0xee, 0xee], frame + ': highlight stays authored');
    assert.deepEqual(colorAt(2), [0xc0, 0x40, 0x40], frame + ': dark hoof/non-coat detail remains unpatterned');
    assert.deepEqual(colorAt(3), [0x20, 0xd0, 0xf0], frame + ': beard inherits the base coat Color Pools paint');
    assert.equal(paintCalls.length, 1, frame + ': body and beard share one continuous Color Pools motif pass');
    assert.deepEqual(paintCalls[0].paintedPixels, [0, 3, 4, 5], frame + ': single coat stencil includes beard and both feathered edges, but excludes hoof and highlights');
    assert.equal(result.pixels[5 * 4 + 3], 100, frame + ': exposed translucent beard must be drawn only once, without doubled alpha');
    assert.equal(paintCalls[0].continuousSurface, true, frame + ': all coat islands use the same pattern origin');
    assert.notDeepEqual(colorAt(4), [0x20, 0xd0, 0xf0], frame + ': transparent beard edge must not erase belly shading underneath');
    assert(colorAt(4)[0] > 0x20, frame + ': restored beard alpha allows some warm belly color through');
    assert(paintCalls.every(call => call.patternCount === 2), frame + ': both pattern slots cover body and beard');
    assert(paintCalls.every(call => call.dyeHex === '#20d0f0'), frame + ': both share the same coat dye');
  }
  assert.equal(paintedGenotype.beard1, undefined, 'Color Pools does not create beard genes');
  assert.equal(render.genotypeSignature('voorg-ass', paintedGenotype), paintedSig, 'painting the beard does not mutate the genotype signature');

  assert.equal(render.genotypeSignature('voorg-ass', genotype), sig, 'default beard never mutates the inherited genotype');
  assert.equal(genotype.beard1, undefined, 'no beard1 allele is created in a saved genotype');

  // Simulate a future authored, inheritable beard: only the replacement is drawn.
  spec.patterns.push('beard2'); // A future beard must be explicitly registered as a drawable genetic pattern.
  const unusual = { ...genotype, secondary: { color: '#cc5522' }, beard2: { enabled: true, copies: 1 } }; // Expressed replacement uses shared B without needing its own color.
  frameReads.length = 0;
  const replaced = await render.composeFrame('voorg-ass', 'idle', unusual);
  const tintedBeard = framePixels(replaced);
  assert(tintedBeard[0] > tintedBeard[2], 'inherited beard2 replaces default blue beard1 with shared red B tint');
  assert(!frameReads.some(url => url.includes('_beard1_')), 'default beard1 was not layered over inherited beard2');
  assert(frameReads.some(url => url.includes('_beard2_')), 'expressed beard2 was rendered');

  // Texture cache may already have both images; inspect actual output rather than network-read counts.
  const firstPatternFallback = { ...genotype, beard2: { enabled: true, copies: 1, color: '#2357bb' } }; // No explicit B: belly supplies B even when the replacement has a conflicting mirror.
  const fallbackPixel = framePixels(await render.composeFrame('voorg-ass', 'idle', firstPatternFallback));
  assert(fallbackPixel[0] > fallbackPixel[2], 'first pattern supplies shared B to replacement beard');
  assert.equal(render.genotypeSignature('voorg-ass', firstPatternFallback), render.genotypeSignature('voorg-ass', { ...firstPatternFallback, beard2: {enabled:true,copies:1} }), 'obsolete or missing mirror does not alter the visible replacement cache key');
  for (const disabled of [{ enabled: false, copies: 2, color: '#cc5522' }, { enabled: true, copies: 0, color: '#cc5522' }, { enabled: false, copies: 1, inheritance: 'recessive' }]) {
    frameReads.length = 0;
    const beardPixel = framePixels(await render.composeFrame('voorg-ass', 'idle', { ...unusual, beard2: disabled }));
    assert(beardPixel[2] > beardPixel[0], 'unexpressed/carrier alternate retains the default blue beard even with explicit B');
    assert(beardPixel[3] > 0, 'fallback beard is opaque even when a non-visible variant gene exists');
  }
  console.log('Voorg-Ass default beard: all frames, coat tint, no genotype, and replacement semantics passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
