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
      frontPlane: { material: { map: null } }, // The actual GPU map may be changed without updating the actor's frame URL.
      backPlane: { material: { map: null } }, // Mirror of the current bound portrait for overwrite recovery tests.
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
    const texture = { url, isCanvasTexture: !!genotypeKind }; // Simulates the synchronous game-owned material assignment.
    avatarRef.frontPlane.material.map = texture;
    avatarRef.backPlane.material.map = texture;
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
  HobunjiGrehlrHeadRigCorrection: { version: 8 },
  HobunjiAuthoredAnimalHeadRigs: { version: '2026-11-17-gar-wolf-grehlr-rigs1' },
  HobunjiShoulderSplineProfiles: { version: 5, allows: () => true },
  AnimalShoulderSpline: {
    version: 10,
    separatorPolygon: () => [{ x: 0, y: 0 }, { x: 48, y: 0 }, { x: 48, y: 32 }, { x: 0, y: 32 }],
  },
  HobunjiShoulderSplitLayerParity: { version: 3 },
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
  const grownUrl = mediumSpeciesPet.currentFrameUrl; // Remember the intended image even if an animation silently replaces its GPU map.
  const swapCount = frameSwaps.length;
  mediumSpeciesPet.avatarRef.frontPlane.material.map = { url: 'unwarped-idle' }; // A blink/animation update can leave currentFrameUrl untouched.
  mediumSpeciesPet.avatarRef.backPlane.material.map = { url: 'unwarped-idle' };
  provider();
  await flush();
  assert.equal(frameSwaps.length, swapCount + 1, 'underlying texture overwrite is recovered despite the unchanged currentFrameUrl');
  assert.equal(mediumSpeciesPet.avatarRef.frontPlane.material.map.url, grownUrl, 'correct enlarged head is actually rebound to the GPU');
  assert.equal(warped.length, 1, 'repair reuses the completed head warp rather than regenerating the sprite');
  provider();
  assert.equal(frameSwaps.length, swapCount + 1, 'stable map ownership avoids per-frame texture churn');

  // The naturally Small adult Pingdort does not get the juvenile-looking head.
  const naturallySmall = companion('pingdort', 'small');
  deps.companionObjects = [naturallySmall];
  provider();
  await flush();
  assert.equal(warped.length, 1, 'naturally small adult is exempt');
  assert.equal(frameSwaps.at(-1).url, 'base-idle.png', 'naturally small adult keeps original sprite');
  const naturalSwaps = frameSwaps.length;
  naturallySmall.avatarRef.frontPlane.material.map = { url: 'wrong-run-frame' };
  provider();
  assert.equal(frameSwaps.length, naturalSwaps + 1, 'ordinary shoulder pets also recover from a same-URL texture overwrite');

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
  const overlayUploads = overlays.filter(event => event.image).length; // Each actual split canvas may be uploaded once, never per frame.
  for (let i = 0; i < 25; i++) provider(); // Many ordinary render passes must not provoke repeated texture swaps.
  await flush();
  assert.equal(composited.length, composedCount, 'split cache is stable across frames');
  assert.equal(overlays.filter(event => event.image).length, overlayUploads,
    'unchanged shoulder split canvas is not re-uploaded as a new GPU texture each render');
  assert(win.PlayerBodyAttachmentBridge.getDebug().smallPetHead.reusedOverlays >= 25,
    'mobile debug counter verifies that duplicate overlay writes were suppressed');
  const splitUrl = splitPet.currentFrameUrl;
  const splitSwaps = frameSwaps.length;
  splitPet.avatarRef.frontPlane.material.map = { url: 'normal-animated-frame' };
  splitPet.avatarRef.backPlane.material.map = { url: 'normal-animated-frame' };
  provider();
  assert.equal(frameSwaps.length, splitSwaps + 1, 'split-frame shoulder keeps control of the displayed texture');
  assert.equal(splitPet.avatarRef.frontPlane.material.map.url, splitUrl, 'split shoulder map is restored without re-encoding the pose');
  assert.equal(overlays.filter(event => event.image).length, overlayUploads, 'split overlay is retained during underlying texture repair');
  assert(win.PlayerBodyAttachmentBridge.getDebug().smallPetHead.overwritesRestored >= 2,
    'the in-game debug snapshot records texture recovery rather than only head-warps completed');

  // The existing head-paint and genotype key must invalidate when coat patterns change.
  splitPet.genotype = { ...splitPet.genotype, pattern: 'spectacles' };
  splitPet.genotype.color = 'green'; // Existing runtime genotype compositing is keyed by tint/pattern genes.
  provider();
  await flush();
  await flush();
  assert.equal(warped.length, 5, 'new genotype regenerates both enlarged shoulder layers');
  const swapBeforeRigRebuild = frameSwaps.length;
  splitPet.avatarRef = companion('grehlr', 'small').avatarRef; // Runtime LOD/equip can replace the avatar without changing animal identity.
  const overlaysBeforeRigRebuild = overlays.filter(event => event.image).length;
  provider();
  assert.equal(frameSwaps.length, swapBeforeRigRebuild + 1, 'recreated avatar receives the already-enlarged split frame');
  assert.equal(overlays.filter(event => event.image).length, overlaysBeforeRigRebuild + 1,
    'recreated avatar receives the split foreground once, even with unchanged URLs');

  // Never carry juvenile enlargement into non-shoulder or unsized adult presentation.
  splitPet.stableRole = 'companion';
  provider();
  assert.equal(win.PlayerBodyAttachmentBridge.getDebug().smallPetHead.active, 0);
  assert(bridgeSource.includes('smallPetHeadFrameCache.delete(companion)'), 'leaving shoulder invalidates pending textures');
  const splineSource = fs.readFileSync('docs/js/animal-shoulder-spline.js', 'utf8');
  assert(splineSource.includes('layer.canvas === canvas'), 'low-level shoulder setter also reuses existing CanvasTextures');
  assert(bridgeSource.includes('MAX_SHOULDER_SPRITE_PIXELS'), 'large wearable sprite raster memory is bounded');
  assert(bridgeSource.includes('canvas.toBlob('), 'browser PNG encode is asynchronous instead of synchronous base64');

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
