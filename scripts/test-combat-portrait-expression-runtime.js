#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/world-portrait-life.js', 'utf8');

function makeCanvas(tag = 'blank') {
  const canvas = {
    width: 64,
    height: 64,
    tag,
    getContext() {
      return {
        clearRect() { canvas.tag = 'cleared'; },
        drawImage(sourceCanvas) { canvas.tag = sourceCanvas?.tag || 'drawn'; },
      };
    },
  };
  return canvas;
}

const expression = { current: 'neutral' };
const refreshes = [];
let deferredPlayerRender = null;

const avatar = {
  group: { userData: { frontTexture: { image: makeCanvas('live-texture') } } },
  frontCanvas: makeCanvas('neutral'),
  profile: { fighter: { speciesId: 'test', gender: 'male' } },
  generation: 1,
};

const windowStub = {
  SCRATCHBONES_CONFIG: { game: { portrait: { worldLife: { enabled: true, intervalS: 0.16 } } } },
  portraitBreathingComposer: {
    setExpression(seatId, value) { if (seatId === 'player') expression.current = value; },
    clearExpression(seatId) { if (seatId === 'player') expression.current = 'neutral'; },
  },
  NpcAvatarPreview: {
    renderProfileToCanvas(canvas, profile, options = {}) {
      if (options.seatId === 'player-combat-frown-cache') {
        canvas.tag = options.breathingComposer?.getExpression?.() || 'missing-frown';
        return Promise.resolve(true);
      }
      if (options.seatId === 'player') {
        const capturedExpression = expression.current;
        if (deferredPlayerRender) {
          const deferred = deferredPlayerRender;
          deferredPlayerRender = null;
          deferred.canvas = canvas;
          deferred.expression = capturedExpression;
          return deferred.promise;
        }
        canvas.tag = capturedExpression;
        return Promise.resolve(true);
      }
      return Promise.resolve(true);
    },
  },
  PNGPlaneAvatar: {
    refreshSinglePlaneAvatarModel(group, canvas) {
      refreshes.push(canvas.tag);
      group.userData.frontTexture.lastUploadedTag = canvas.tag;
      return true;
    },
  },
};

const documentStub = {
  createElement(tag) {
    assert.equal(tag, 'canvas');
    return makeCanvas();
  },
};

const context = {
  window: windowStub,
  document: documentStub,
  console,
  Promise,
  setTimeout,
  clearTimeout,
};
vm.createContext(context);
vm.runInContext(source, context, { filename: 'world-portrait-life.js' });

windowStub.WorldPortraitLife.init({
  getCurrentArea: () => 'farm',
  getPlayerTile: () => ({ x: 0, y: 0 }),
  getPlayerAvatar: () => avatar,
  rnd: () => 0.5,
});

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

(async () => {
  // Ordinary world ticking must warm a frown render for the current avatar
  // before combat begins, without changing the live neutral portrait.
  windowStub.WorldPortraitLife.tickPlayer(0);
  await flushPromises();
  let debug = windowStub.WorldPortraitLife.snapshot();
  assert.equal(debug.playerCombatFrownCacheReady, true, 'current-generation combat frown cache is prewarmed');
  assert.equal(avatar.frontCanvas.tag, 'neutral', 'prewarming does not mutate the live player canvas');

  // Entering combat with a warm cache must synchronously upload frown pixels.
  const beforeCombatRefreshes = refreshes.length;
  windowStub.WorldPortraitLife.setPlayerCombatExpression(true);
  debug = windowStub.WorldPortraitLife.snapshot();
  assert.equal(debug.playerCombatFrown, true);
  assert.equal(debug.playerCombatExpressionApplied, true, 'combat entry marks frown applied in the same call when cache is ready');
  assert.equal(refreshes.length, beforeCombatRefreshes + 1, 'combat entry performs one immediate texture upload');
  assert.equal(refreshes.at(-1), 'frown', 'immediate combat upload contains the authored frown');
  await flushPromises(); // Let the same-frame live frown breathing render finish before constructing the stale-neutral race below.

  // Reproduce the real race: a neutral breathing render starts while combat
  // exits, then combat re-enters before that async render resolves. Its old
  // canvas result must never be uploaded over the newly restored frown.
  let resolveDeferred;
  const deferredPromise = new Promise(resolve => { resolveDeferred = resolve; });
  deferredPlayerRender = { promise: deferredPromise, canvas: null, expression: null };
  windowStub.WorldPortraitLife.setPlayerCombatExpression(false);
  assert.equal(deferredPlayerRender, null, 'combat exit started the deferred ordinary portrait render');
  const staleCanvas = avatar.frontCanvas;
  const refreshCountBeforeReentry = refreshes.length;
  windowStub.WorldPortraitLife.setPlayerCombatExpression(true);
  assert.equal(refreshes.at(-1), 'frown', 're-entering combat synchronously reapplies cached frown before stale render completes');
  const refreshCountAfterReentry = refreshes.length;
  assert.equal(refreshCountAfterReentry, refreshCountBeforeReentry + 1);

  staleCanvas.tag = 'neutral';
  resolveDeferred(true);
  await flushPromises();
  assert.equal(refreshes.length, refreshCountAfterReentry, 'stale neutral render is rejected instead of uploading over the combat frown');
  assert.equal(refreshes.at(-1), 'frown');

  // A gear/species rebuild changes avatar generation. The old cache must no
  // longer count as applied until the new-generation frown render completes.
  avatar.generation = 2;
  avatar.frontCanvas = makeCanvas('new-neutral');
  windowStub.WorldPortraitLife.tickPlayer(0);
  debug = windowStub.WorldPortraitLife.snapshot();
  assert.equal(debug.playerCombatFrownCacheGeneration, 2, 'cache follows avatar generation changes');
  assert.equal(debug.playerCombatExpressionApplied, false, 'new avatar does not falsely inherit old-generation frown readiness');
  await flushPromises();
  debug = windowStub.WorldPortraitLife.snapshot();
  assert.equal(debug.playerCombatExpressionApplied, true, 'new-generation cache reapplies combat frown once ready');
  assert.equal(refreshes.at(-1), 'frown');

  console.log('Combat portrait expression runtime tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
