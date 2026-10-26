#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const WIDTH = 4; // Four synthetic pixels: coat, highlight, non-coat detail, beard position.
const HEIGHT = 1; // One row makes the mask/recolor behavior deterministic.
const frameReads = []; // Records which of the three authored beard frame URLs the compositor actually loads.
const coatColor = '#2357bb'; // Used to compare the default beard's tint with the base allele.

function imagePixels(url) {
  const result = new Uint8ClampedArray(WIDTH * HEIGHT * 4); // Fake image buffer shared by the minimal Canvas implementation.
  if (url.includes('voorg-ass_beard1_')) {
    frameReads.push(url);
    result.set([180, 180, 180, 255], 12); // Default beard pixels use normal grayscale pattern shade-fill.
  } else if (url.includes('voorg-ass_beard2_')) {
    frameReads.push(url);
    result.set([180, 180, 180, 255], 12); // Future unique beard occupies the exact same location, never an additional layer.
  } else if (/voorg-ass_(idle|run1|run2)\.png/.test(url)) {
    result.set([0x99, 0xBF, 0x99, 255], 0); // Coat source-key pixel.
    result.set([0xEE, 0xEE, 0xEE, 255], 4); // Unrecolored detail.
    result.set([0xC0, 0x40, 0x40, 255], 8); // Unrelated red detail.
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
          if (image?.pixels?.[i + 3]) this.pixels.set(image.pixels.slice(i, i + 4), i);
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
  assert.equal(render.genotypeSignature('voorg-ass', genotype), sig, 'default beard never mutates the inherited genotype');
  assert.equal(genotype.beard1, undefined, 'no beard1 allele is created in a saved genotype');

  // Simulate a future authored, inheritable beard: only the replacement is drawn.
  spec.patterns.push('beard2'); // A future beard must be explicitly registered as a drawable genetic pattern.
  const unusual = { ...genotype, beard2: { enabled: true, copies: 1, color: '#cc5522' } };
  frameReads.length = 0;
  const replaced = await render.composeFrame('voorg-ass', 'idle', unusual);
  const tintedBeard = framePixels(replaced);
  assert(tintedBeard[0] > tintedBeard[2], 'inherited beard2 replaces default blue beard1 with its own red tint');
  assert(!frameReads.some(url => url.includes('_beard1_')), 'default beard1 was not layered over inherited beard2');
  assert(frameReads.some(url => url.includes('_beard2_')), 'expressed beard2 was rendered');

  // Texture cache may already have both images; inspect actual output rather than network-read counts.
  for (const disabled of [{ enabled: false, copies: 2, color: '#cc5522' }, { enabled: true, copies: 0, color: '#cc5522' }, { enabled: true, copies: 1 }]) {
    frameReads.length = 0;
    const beardPixel = framePixels(await render.composeFrame('voorg-ass', 'idle', { ...genotype, beard2: disabled }));
    assert(beardPixel[2] > beardPixel[0], 'unexpressed/carrier/missing-color alternate retains the default blue beard');
    assert(beardPixel[3] > 0, 'fallback beard is opaque even when a non-visible variant gene exists');
  }
  console.log('Voorg-Ass default beard: all frames, coat tint, no genotype, and replacement semantics passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
