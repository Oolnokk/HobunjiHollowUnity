'use strict';

// Exercise the actual installed shoulder-pet frame bridge without browser-devtools access.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const bridgeSource = fs.readFileSync('docs/js/player-body-attachment-bridge.js', 'utf8');
const rigSource = fs.readFileSync('docs/js/animal-head-rig-authored.js', 'utf8');
const hooks = {};
const composited = [];
const warped = [];
const maskRequests = []; // Tracks the once-per-species idle mask prerequisite before final pose enlargement.
const frameSwaps = [];
const overlays = [];
let canvasSerial = 0; // Gives each composited/warped frame a distinct URL in the assertions.
let splitFrame = false; // Test toggle between ordinary shoulder art and split left/right presentation.
function canvas(extra = {}) {
  const id = ++canvasSerial;
  const calls = [];
  return {
    width: 48, height: 32, ...extra, calls,
    getContext() { return {
      clearRect() {}, save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {},
      closePath() {}, clip() {}, drawImage(image) { calls.push(image); },
    }; },
    toDataURL() { return 'data:image/png;base64,head' + id; },
  };
}
const player = { id: 'player' };
function companion(kind, size) {
  return {
    health: 5, stableRole: 'shoulderPet', creatureKey: kind,
    genotype: { sizeClass: size, color: 'blue', pattern: 'spectacles' },
    def: { sprites: { idle: 'base-idle.png', run: ['base-run1.png'] } },
    avatarRef: {
      group: { kind }, setShoulderRestEnabled() {},
      setShoulderSplitOverlayCanvas(image, visible) { overlays.push({ image, visible }); },
      setShoulderSplitOverlayEnabled(visible) { overlays.push({ visible }); },
    },
    currentFrameUrl: null,
  };
}
const mediumSpeciesPet = companion('grehlr', 'small');
const deps = {
  player, companionObjects: [mediumSpeciesPet],
  genotypeKindFor: pet => pet.creatureKey,
  setCreatureFrame(avatarRef, url, genotypeKind, frame, genotype) {
    frameSwaps.push({ avatarRef, url, genotypeKind, frame, genotype });
  },
};
const renderer = {
  ANIMAL_HEAD_RIGS: {},
  HEAD_RIG_VARIANT_ALIASES: {},
  headRigForKind: () => ({ shoulderRest: {
    enabled: true, authored: true, useSpline: false, useRun1: false,
    splitFrame, splitRightUsesIdle: false, frameShiftX: 0.52,
  } }),
  genotypeSignature: (kind, genes) => kind + ':' + genes.color + ':' + genes.pattern,
  composeFrame: async (kind, frame, genes) => {
    const art = canvas({ kind, frame, pattern: genes.pattern, eyes: 'painted-after-patterns' });
    composited.push(art);
    return art;
  },
};
const headBox = { x: .25, y: .2, width: .4, height: .4 };
const warp = {
  isSmallSizeVariantPet(kind, genes, role) {
    return role === 'shoulderPet' && genes?.sizeClass === 'small' && kind !== 'pingdort';
  },
  frameForKind: () => headBox,
  scaleForKind: () => 1.23,
  async ensureIdleMask(kind, idleCanvas = null) {
    maskRequests.push({ kind, sourcePose: idleCanvas?.frame || null });
    return { kind, opaquePixels: 20 }; // Represents a cached idle alpha silhouette supplied by the actual warp module.
  },
  applyToCanvas(input, kind) {
    assert.equal(input.eyes, 'painted-after-patterns', 'head warp receives the already composed eye overlay');
    assert.equal(input.pattern, 'spectacles', 'head warp receives the existing expressed pattern');
    warped.push({ input, kind });
    return canvas({ composedFrom: input });
  },
  debugSnapshot: () => ({ lastError: null }),
};
const win = {
  HobunjiGrehlrHeadRigCorrection: { version: 7 },
  HobunjiAuthoredAnimalHeadRigs: { version: '2026-11-16-moot-painted-baby-pets1' },
  HobunjiShoulderSplineProfiles: { version: 5, allows: () => true },
  AnimalShoulderSpline: {
    version: 10,
    separatorPolygon: () => [{ x: 0, y: 0 }, { x: 48, y: 0 }, { x: 48, y: 32 }, { x: 0, y: 32 }],
  },
  HobunjiShoulderSplitLayerParity: { version: 4 },
  PlayerBodyTransformComposer: {
    registerExternalRootProvider(name, fn) { hooks[name] = fn; },
  },
  CreatureGeneticsRender: renderer,
  BabyAnimalHeadWarp: warp,
  Combat: { deps },
};
const doc = {
  readyState: 'complete',
  querySelector: () => null,
  createElement(tag) { assert.equal(tag, 'canvas'); return canvas(); },
};
vm.runInNewContext(bridgeSource, { window: win, document: doc, console }, { filename: 'player-body-attachment-bridge.js' });
const provider = hooks.shoulderPets;
assert.equal(typeof provider, 'function', 'bridge exposes the existing shoulder-pet integration provider');
const flush = () => new Promise(resolve => setImmediate(resolve));

(async () => {
  // Rare genetically Small pet: texture is enlarged *after* the genotype's eyes and patterns.
  provider();
  await flush();
  assert.equal(warped.length, 1);
  assert.equal(composited.length, 1);
  assert.equal(maskRequests[0]?.kind, 'grehlr', 'small pet first requests its idle opacity mask before pose composition');
  assert(frameSwaps.at(-1).url.startsWith('data:image/png'), 'small pet displays its final enlarged canvas');
  assert.equal(frameSwaps.at(-1).genotypeKind, null, 'already composed frame cannot be recolored or have eyes re-applied');
  provider();
  await flush();
  assert.equal(composited.length, 1, 'repeated render ticks reuse the cached final frame');
  assert.equal(warped.length, 1);

  // The naturally Small adult Pingdort does not get the juvenile-looking head.
  const naturallySmall = companion('pingdort', 'small');
  deps.companionObjects = [naturallySmall];
  provider();
  await flush();
  assert.equal(warped.length, 1, 'naturally small adult is exempt');
  assert.equal(frameSwaps.at(-1).url, 'base-idle.png', 'naturally small adult keeps original sprite');

  // When the owner re-equips a rare Small pet with a split-frame shoulder pose,
  // both already-composited idle and run1 images must be enlarged BEFORE clipping.
  splitFrame = true;
  const splitPet = companion('grehlr', 'small');
  deps.companionObjects = [splitPet];
  provider();
  await flush();
  await flush();
  assert.equal(warped.length, 3, 'split needs exactly two enlarged final genotype frames');
  assert(maskRequests.some(request => request.sourcePose === 'idle'),
    'split shoulder pet uses an actual idle frame to seed its shared head mask');
  assert.deepEqual(warped.slice(-2).map(x => x.input.frame), ['idle', 'run1']);
  assert(overlays.some(x => x.visible === true && x.image), 'split foreground receives enlarged left layer');
  assert(frameSwaps.at(-1).url.startsWith('data:image/png'), 'split back face gets the enlarged right layer');
  const composedCount = composited.length;
  provider();
  await flush();
  assert.equal(composited.length, composedCount, 'split cache is stable across frames');

  // The existing head-paint and genotype key must invalidate when coat patterns change.
  splitPet.genotype = { ...splitPet.genotype, pattern: 'spectacles' };
  splitPet.genotype.color = 'green'; // Existing runtime genotype compositing is keyed by tint/pattern genes.
  provider();
  await flush();
  await flush();
  assert.equal(warped.length, 5, 'new genotype regenerates both enlarged shoulder layers');

  // Never carry juvenile enlargement into non-shoulder or unsized adult presentation.
  splitPet.stableRole = 'companion';
  provider();
  assert.equal(win.PlayerBodyAttachmentBridge.getDebug().smallPetHead.active, 0);
  assert(bridgeSource.includes('smallPetHeadFrameCache.delete(companion)'), 'leaving shoulder invalidates pending textures');

  // Uploaded Moot painting is committed, not merely present in a local browser.
  const rigWindow = { CreatureGeneticsRender: { ANIMAL_HEAD_RIGS: {}, HEAD_RIG_VARIANT_ALIASES: {} } };
  vm.runInNewContext(rigSource, { window: rigWindow, localStorage: { getItem: () => null }, JSON },
    { filename: 'animal-head-rig-authored.js' });
  const moot = rigWindow.HobunjiAuthoredAnimalHeadRigs.get('moot');
  const voorg = rigWindow.HobunjiAuthoredAnimalHeadRigs.get('voorg-ass');
  assert(moot && voorg);
  assert.notDeepEqual(Array.from(moot.weightMap.data), Array.from(voorg.weightMap.data),
    'Moot owns the uploaded painted map, never the old borrowed Voorg-Ass neck');
  assert.equal(moot.weightMap.width, 128);
  assert.equal(moot.weightMap.height, 75);
  assert.equal(moot.weightMap.data.filter((_, i) => !(i % 2)).reduce((a, b) => a + b, 0), 9600);
  assert.equal(moot.compressibilityMap.data.filter((_, i) => !(i % 2)).reduce((a, b) => a + b, 0), 9600);
  assert.equal(moot.pivot.x, 0.37400034701593793);
  assert.equal(moot.babyHeadScale, undefined, 'Moot must inherit the new 123% default instead of freezing a species override');
  assert.equal(moot.babyHeadFrame.width, 0.46468750000000003);
  assert.equal(moot.shoulderRest.afterPoints[6].y, 1.2729887486531961);
  console.log('Rare Small pet final textures, naturally Small exemption, split patterns and eyes, and Moot paint pass.');
})().catch(error => { console.error(error); process.exitCode = 1; });
