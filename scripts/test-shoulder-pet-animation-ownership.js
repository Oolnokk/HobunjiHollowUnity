'use strict';
// Exercise the real game.js idle/run/blink animator against the shoulder presenter's ownership boundary.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const gameSource = fs.readFileSync('docs/game.js', 'utf8'); // Production frame writer, not a copied model of animation behavior.
const bridgeSource = fs.readFileSync('docs/js/player-body-attachment-bridge.js', 'utf8'); // Shoulder provider that owns grown/split portraits.
const start = gameSource.indexOf('function updateCreatureAnimFrame(c, dt, moving, runInPlace = false) {');
const end = gameSource.indexOf('\n      const JUMP_BACK_DUR_S', start);
assert(start >= 0 && end > start, 'live animal frame function is available for an executable regression');
assert(bridgeSource.includes('ownsCreatureFrame, // Invoked by game.js'),
  'bridge exports the owner test the main game frame writer must respect');

const player = {}; // The locally-owned character whose Small pet is being worn.
const swaps = []; // Records every normal animation texture replacement.
const windowStub = {
  PlayerBodyAttachmentBridge: {
    ownsCreatureFrame(c) {
      return !!(c?.health > 0 && c.stableRole === 'shoulderPet' && c.avatarRef?.group
        && (c.master || player) === player);
    },
  },
  CreatureGenetics: { SPECIES_ALIAS: {} },
  CreatureBlink: { getVisualState: () => false },
  __farmLog() {},
};
const sandbox = {
  window: windowStub,
  player, // The real animator closes over the player's identity to prioritize only their own pet's coat and patterns.
  performance: { now: () => 1000 },
  swaps,
  Set,
};
vm.createContext(sandbox);
vm.runInContext(`
  const RUN_FRAME_STRIDE_PX = 30;
  function setCreatureFrame(_avatarRef, url, kind, frameKey, _genotype, _blink, priority) {
    swaps.push({ url, kind, frameKey, priority });
    return true;
  }
  ${gameSource.slice(start, end)}
  globalThis.animateCreatureForTest = updateCreatureAnimFrame;
`, sandbox, { filename: 'game.js:updateCreatureAnimFrame' });

const animal = {
  health: 5,
  stableRole: 'shoulderPet',
  master: player,
  avatarRef: { group: {} },
  creatureKey: 'grehlr',
  genotype: { sizeClass: 'small' },
  def: { sprites: { idle: 'adult-idle.png', run: ['adult-run1.png', 'adult-run2.png'] }, moveSpeed: 200 },
  currentFrameUrl: 'data:image/png;base64,enlarged-head',
  x: 12, y: 18,
  runFrame: 0, runFrameDistPx: 0,
  _blinkAppliedShut: false,
  _genotypeReadyFrames: new Set(['idle', 'run1', 'run2']),
};
sandbox.animateCreatureForTest(animal, 0.2, false);
sandbox.animateCreatureForTest(animal, 0.2, true);
assert.equal(swaps.length, 0, 'neither idle/blink nor running animation can overwrite a perched pet');
assert.equal(animal.currentFrameUrl, 'data:image/png;base64,enlarged-head', 'enlarged image stays displayed');
assert.equal(animal._animLastX, animal.x, 'perch updates distance baseline while animation is suspended');
assert.equal(animal._animLastY, animal.y, 'unperch must not accumulate a phantom motion jump');
assert.equal(animal.runFrameDistPx, 0, 'perched pet never advances the ordinary run-frame counter');

animal.stableRole = 'companion';
sandbox.animateCreatureForTest(animal, 0.2, false);
assert.equal(swaps.at(-1).url, 'adult-idle.png', 'ordinary idle frames resume immediately on unperch');
assert.equal(swaps.at(-1).priority, 'pet', 'player-owned companions get their complete color/pattern frame first');
animal.x += 40;
sandbox.animateCreatureForTest(animal, 0.2, true);
assert.equal(swaps.at(-1).url, 'adult-run2.png', 'ordinary movement/run animation resumes when pet is a companion');

animal.stableRole = 'shoulderPet';
animal.master = { id: 'different-owner' };
animal.currentFrameUrl = 'data:image/png;base64,enlarged-head';
sandbox.animateCreatureForTest(animal, 0.2, false);
assert.equal(swaps.at(-1).url, 'adult-idle.png', 'another owner cannot suppress this client\'s normal creature rendering');
assert.equal(swaps.at(-1).priority, 'normal', 'another player\'s pet must not displace the local player\'s pending appearance work');
// The wilderness sleep presenter also owns an alternative eye-closed texture pass; that must defer to the perch.
const sleepSource = fs.readFileSync('docs/js/animal-sleep-presentation.js', 'utf8'); // Shipped pre-render sleeper pass.
const sleepStart = sleepSource.indexOf('  function applyWildernessSleepers() {');
const sleepEnd = sleepSource.indexOf('\n  function prepareRenderFrame(', sleepStart);
assert(sleepStart >= 0 && sleepEnd > sleepStart, 'the live wilderness sleeper pass is extractable');
const sleeper = { ...animal, stableRole: 'shoulderPet', master: player, _animalSleeping: true,
  avatarRef: { group: { parent: {}, visible: true } } }; // Perch is active even if a stale sleep flag remains on the animal.
const sleepFrames = []; // True means the sleep presenter would overwrite the grown shoulder portrait.
const headDownCalls = []; // Tracks ordinary sleep poses, which a shoulder pet must not receive.
const sleepSandbox = { window: windowStub, sleeper, sleepFrames, headDownCalls, Symbol };
vm.createContext(sleepSandbox);
vm.runInContext(`
  let liveSleepFrames = 0;
  const SLEEP_SCALE_Y = 0.5;
  function wildernessSets() { return [[sleeper]]; }
  function setLiveFrame(_animal, _group, _kind, _genotype, _def, sleeping) { sleepFrames.push(sleeping); }
  function forceHeadDown() { headDownCalls.push(true); }
  function applyTemporaryScale() { return true; }
  ${sleepSource.slice(sleepStart, sleepEnd)}
  globalThis.updateSleeperForTest = applyWildernessSleepers;
`, sleepSandbox, { filename: 'animal-sleep-presentation.js:applyWildernessSleepers' });
sleepSandbox.updateSleeperForTest();
assert.deepEqual(sleepFrames, [false], 'sleep renderer releases rather than overwrites an actively perched portrait');
assert.equal(headDownCalls.length, 0, 'ground-sleeper neck pose cannot override the shoulder spline');
sleeper.stableRole = 'companion';
sleepSandbox.updateSleeperForTest();
assert.equal(sleepFrames.at(-1), true, 'sleep textures resume once the pet leaves its shoulder perch');
assert.equal(headDownCalls.length, 1, 'ordinary sleeping neck pose resumes once unperched');

// A generated shoulder portrait also owns game.js's URL-keyed GPU cache entry.
// Revoking a blob URL alone must not leave that texture retained in either cache map.
const cleanupStart = gameSource.indexOf('function releaseCreatureTemporaryFrameTexture(url) {');
const cleanupEnd = gameSource.indexOf('      // Genotype-composited textures', cleanupStart);
assert(cleanupStart >= 0 && cleanupEnd > cleanupStart, 'the production generated-sprite cache cleanup is accessible');
const cache = { front: new Map(), back: new Map() }; // Recreates game.js's native URL-keyed sprite texture cache.
const cleanupSandbox = { _creatureTexCache: cache };
vm.createContext(cleanupSandbox);
vm.runInContext(`
  ${gameSource.slice(cleanupStart, cleanupEnd)}
  globalThis.releaseTemporaryTextureForTest = releaseCreatureTemporaryFrameTexture;
`, cleanupSandbox, { filename: 'game.js:releaseCreatureTemporaryFrameTexture' });
let disposed = 0;
const front = { dispose() { disposed++; } };
const back = { dispose() { disposed++; } };
cache.front.set('blob:shoulder-portrait', front);
cache.back.set('blob:shoulder-portrait', back);
assert.equal(cleanupSandbox.releaseTemporaryTextureForTest('blob:shoulder-portrait'), true, 'generated blob texture is released');
assert.equal(cache.front.size, 0, 'old front texture must not remain in the sprite cache');
assert.equal(cache.back.size, 0, 'old back texture must not remain in the sprite cache');
assert.equal(disposed, 2, 'both independent GPU texture objects are disposed once');
assert.equal(cleanupSandbox.releaseTemporaryTextureForTest('blob:shoulder-portrait'), false, 'double cleanup is harmless');

const shared = { dispose() { disposed++; } }; // Shared two-sided shader uses the same GPU texture on both planes.
cache.front.set('data:image/png;base64,grown-pet', shared);
cache.back.set('data:image/png;base64,grown-pet', shared);
assert.equal(cleanupSandbox.releaseTemporaryTextureForTest('data:image/png;base64,grown-pet'), false,
  'non-unique data URL fallbacks must never dispose a texture that another pet may still display');
assert.equal(disposed, 2, 'shared data-URL textures remain intact until the game reclaims them');
assert.equal(cache.front.get('data:image/png;base64,grown-pet'), shared, 'fallback texture remains available to other identical pets');
cache.front.delete('data:image/png;base64,grown-pet'); // Remove the artificial fixture entry, not a production cache operation.
cache.back.delete('data:image/png;base64,grown-pet');
cache.front.set('assets/creaturesprites/pingdort_idle.png', front);
assert.equal(cleanupSandbox.releaseTemporaryTextureForTest('assets/creaturesprites/pingdort_idle.png'), false,
  'permanent species PNGs must never be purged by the pet-only cleanup API');
assert.equal(cache.front.size, 1, 'original species textures stay cached');

console.log('PASS shoulder texture ownership, sleeper handoff, and temporary GPU cache disposal');
