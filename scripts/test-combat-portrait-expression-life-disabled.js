#!/usr/bin/env node
'use strict';

// With world portrait life disabled, tickPlayer never repaints the player, so
// leaving combat must still restore the resting face instead of leaving the
// cached combat frown on the live texture forever.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/world-portrait-life.js', 'utf8');

function makeCanvas(tag = 'blank') {
  const canvas = {
    width: 64, height: 64, tag,
    getContext() {
      return {
        clearRect() { canvas.tag = 'cleared'; },
        drawImage(sourceCanvas) { canvas.tag = sourceCanvas?.tag || 'drawn'; },
      };
    },
  };
  return canvas;
}

const refreshes = [];
const avatar = {
  group: { userData: { frontTexture: {} } },
  frontCanvas: makeCanvas('neutral'),
  profile: { fighter: { speciesId: 'test', gender: 'male' } },
  generation: 1,
};
const windowStub = {
  SCRATCHBONES_CONFIG: { game: { portrait: { worldLife: { enabled: false } } } },
  portraitBreathingComposer: { setExpression() {}, clearExpression() {} },
  NpcAvatarPreview: {
    renderProfileToCanvas(canvas, profile, options = {}) {
      canvas.tag = options.breathingComposer?.getExpression?.() || 'neutral';
      return Promise.resolve(true);
    },
  },
  PNGPlaneAvatar: {
    refreshSinglePlaneAvatarModel(group, canvas) { refreshes.push(canvas.tag); return true; },
  },
};
const context = {
  window: windowStub,
  document: { createElement: () => makeCanvas() },
  console, Promise, setTimeout, clearTimeout,
};
vm.createContext(context);
vm.runInContext(source, context, { filename: 'world-portrait-life.js' });
windowStub.WorldPortraitLife.init({ getPlayerAvatar: () => avatar });

const flush = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };

(async () => {
  windowStub.WorldPortraitLife.tickPlayer(0); // Warms the frown cache even while portrait life is disabled.
  await flush();
  windowStub.WorldPortraitLife.setPlayerCombatExpression(true);
  await flush();
  assert.equal(refreshes.at(-1), 'frown', 'combat entry applies the frown');
  windowStub.WorldPortraitLife.setPlayerCombatExpression(false);
  await flush();
  assert.equal(refreshes.at(-1), 'neutral', 'combat exit restores the resting face when portrait life is disabled');
  assert.equal(avatar.frontCanvas.tag, 'neutral');
  console.log('Combat portrait expression (portrait life disabled) tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
