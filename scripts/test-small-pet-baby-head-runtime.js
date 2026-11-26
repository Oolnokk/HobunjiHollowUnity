'use strict';
// Real module integration: a genetically Small shoulder pet must enlarge its RAW sprite even if the genotype renderer has no entry.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const SIZE = 48; // Fixture dimensions for native pixel comparison.
const HEAD_BOX = { x: .2, y: .2, width: .45, height: .45, coordinateSpace: 'sprite-normalized-top-left' }; // Authored chathead frame used by both species.
const original = new Uint8ClampedArray(SIZE * SIZE * 4); // Simulates the real opaque idle PNG without a compositor.
for (let y = 10; y < 30; y++) for (let x = 10; x < 30; x++) {
  const i = (y * SIZE + x) * 4;
  original[i] = x * 5;
  original[i + 1] = y * 5;
  original[i + 2] = (x + y) % 256;
  original[i + 3] = 255;
}

class PixelCanvas {
  constructor() { this.width = this.height = 0; this.data = null; }
  getContext() {
    const canvas = this; // The 2D read/write context operates on this fixture's exact pixels.
    return {
      drawImage(image) { canvas.data = Uint8ClampedArray.from(image.data); },
      getImageData() { return { data: Uint8ClampedArray.from(canvas.data || original) }; },
      createImageData(width, height) { return { data: new Uint8ClampedArray(width * height * 4) }; },
      putImageData(image) { canvas.data = Uint8ClampedArray.from(image.data); },
      clearRect() { canvas.data = null; },
    };
  }
  toDataURL() { return 'data:image/png;base64,' + Buffer.from(this.data || original).toString('base64'); }
}
const documentStub = { readyState: 'complete', baseURI: 'https://example.test/docs/index.html', createElement(tag) {
  assert.equal(tag, 'canvas');
  return new PixelCanvas();
} }; // Head growth uses this readback-safe canvas and not any browser internals.
const imageRequests = []; // Verifies CORS mode before source assignment on both mask and pose image loaders.
class RawSpriteImage {
  constructor() { this.width = this.naturalWidth = SIZE; this.height = this.naturalHeight = SIZE; this.data = original; }
  set src(url) {
    imageRequests.push({ url, mode: this.crossOrigin });
    queueMicrotask(() => this.onload?.());
  }
}
const providers = {}; // Actual compositor provider callbacks registered by the production bridge.
const rendered = []; // Captures the URL ultimately submitted to the real creature avatar integration.
const owner = {};
const animal = kind => ({
  kind, health: 10, stableRole: 'shoulderPet', genotype: { sizeClass: 'small' }, master: owner,
  def: { sprites: { idle: 'assets/creaturesprites/' + kind + '_idle.png', run: ['assets/creaturesprites/' + kind + '_run1.png'] } },
  avatarRef: { group: { kind }, setShoulderRestEnabled() {}, setShoulderSplitOverlayEnabled() {} },
});
const companion = animal('bulky'); // Normally Medium species whose genotype actually turned Small.
const combatDeps = {
  player: owner, companionObjects: [companion], genotypeKindFor: item => item.kind,
  setCreatureFrame(_avatar, url, genotypeKind, frame) { rendered.push({ url, genotypeKind, frame }); },
};
const windowStub = {
  localStorage: { getItem() { return null; }, setItem() {} },
  HOBUNJI_ATTACHMENT_RIG_PROFILES: { creatures: { bulky: { chatheadFrame: HEAD_BOX }, tiny: { chatheadFrame: HEAD_BOX } } },
  HobunjiGrehlrHeadRigCorrection: { version: 10 },
  HobunjiAuthoredAnimalHeadRigs: { version: '2026-11-26-ten-authored-rigs1' },
  HobunjiShoulderSplineProfiles: { version: 5, allows: () => false },
  AnimalShoulderSpline: { version: 10 },
  HobunjiShoulderSplitLayerParity: { version: 3 },
  PlayerBodyTransformComposer: { registerExternalRootProvider(name, provider) { providers[name] = provider; } },
  CreatureGenetics: { creatureSizeClass(kind, genotype) { return kind === 'tiny' ? 'small' : genotype?.sizeClass || 'medium'; } },
  CreatureGeneticsRender: { SPECIES: {}, composeFrame: async () => null, genotypeSignature: () => 'none' },
  Combat: { deps: combatDeps },
};
windowStub.window = windowStub;
const context = vm.createContext({
  window: windowStub, document: documentStub, Image: RawSpriteImage,
  URL, Uint8Array, Uint8ClampedArray, Float32Array, console,
});
vm.runInContext(fs.readFileSync('docs/js/baby-animal-head-warp.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('docs/js/player-body-attachment-bridge.js', 'utf8'), context);
assert(providers.shoulderPets, 'the real gameplay compositor provider must register');

(async () => {
  providers.shoulderPets();
  for (let i = 0; i < 20; i++) await Promise.resolve(); // Drain async idle-mask, image decode and avatar-frame promises.
  const debug = windowStub.PlayerBodyAttachmentBridge.getDebug().smallPetHead;
  assert.equal(debug.applied, 1, 'genetically Small pet renders its enlarged raw pose without a genotype-composer entry');
  assert.equal(debug.failed, 0, debug.lastError || 'raw source should be available');
  assert(rendered.length > 0, 'the enlarged image reaches the live avatar frame setter');
  assert.match(rendered.at(-1).url, /^data:image\/png;base64,/, 'the pet frame setter receives a newly composed pixel texture');
  const after = Buffer.from(rendered.at(-1).url.split(',')[1], 'base64');
  assert(after.some((pixel, i) => pixel !== original[i]), 'raw source has actual enlarged head pixels, not merely a new data URL');
  assert.equal(windowStub.BabyAnimalHeadWarp.maskModeForKind('bulky'), 'legacy-frame',
    'the original painted-frame approach is the default for unsupported raw-pet species too');
  assert.equal(windowStub.BabyAnimalHeadWarp.maskForKind('bulky'), null,
    'default painted selection does not allocate an idle-alpha mask when enlarging a raw shoulder-pet sprite');
  assert(imageRequests.every(req => req.mode === 'anonymous'), 'all image sources request CORS-readable pixels');

  const naturalSmall = animal('tiny');
  combatDeps.companionObjects = [naturalSmall];
  rendered.length = 0;
  providers.shoulderPets();
  assert.equal(windowStub.PlayerBodyAttachmentBridge.getDebug().smallPetHead.active, 0,
    'naturally Small adults never qualify for head enlargement');
  assert.equal(rendered[0]?.url, 'assets/creaturesprites/tiny_idle.png',
    'naturally Small adults keep their original sprite URL and avoid the expensive warp');
  console.log('PASS small shoulder pet raw fallback, actual pixels, idle-source gating and naturally Small exclusion');
})().catch(error => { console.error(error); process.exitCode = 1; });
