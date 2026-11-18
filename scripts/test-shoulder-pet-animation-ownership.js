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
  performance: { now: () => 1000 },
  swaps,
  Set,
};
vm.createContext(sandbox);
vm.runInContext(`
  const RUN_FRAME_STRIDE_PX = 30;
  function setCreatureFrame(_avatarRef, url, kind, frameKey) {
    swaps.push({ url, kind, frameKey });
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
animal.x += 40;
sandbox.animateCreatureForTest(animal, 0.2, true);
assert.equal(swaps.at(-1).url, 'adult-run2.png', 'ordinary movement/run animation resumes when pet is a companion');

animal.stableRole = 'shoulderPet';
animal.master = { id: 'different-owner' };
animal.currentFrameUrl = 'data:image/png;base64,enlarged-head';
sandbox.animateCreatureForTest(animal, 0.2, false);
assert.equal(swaps.at(-1).url, 'adult-idle.png', 'another owner cannot suppress this client\'s normal creature rendering');
console.log('PASS shoulder texture ownership prevents idle/run/blink overwrites and restores ordinary animation afterward');
