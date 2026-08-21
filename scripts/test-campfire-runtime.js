#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class Vector2 {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
}
class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(value) { return this.set(value.x, value.y, value.z); }
  transformDirection() { return this; }
}
class Plane {
  constructor(normal, constant) { this.normal = normal; this.constant = constant; }
}
class Raycaster {
  constructor() {
    this.ray = { intersectPlane: () => null };
  }
  setFromCamera() {}
  set() {}
  intersectObjects() { return []; }
}

const THREE = { Vector2, Vector3, Plane, Raycaster }; // Minimal geometry surface needed while the standalone runtimes install.
const listeners = new Map(); // Captures global lifecycle hooks without running the full browser loop.
const animationFrames = []; // Lets the test advance the campfire lifecycle one deterministic frame at a time.
let timePassageOpen = false;
let saveMeta = {
  worlds: [{
    id: 'world',
    members: {
      character: {
        campfireState: { version: 1, area: 'farm', col: 1, row: 1, surfaceY: 0, checkpoint: null },
      },
    },
  }],
};
const document = {
  addEventListener() {},
  getElementById: () => null,
  querySelector: selector => selector === '.time-passage-backdrop'
    ? { classList: { contains: name => name === 'open' && timePassageOpen } }
    : null,
};
const window = {
  THREE,
  addEventListener(type, listener) { listeners.set(type, listener); },
  requestAnimationFrame() {},
};
const context = {
  console,
  document,
  navigator: { getGamepads: () => [] },
  localStorage: {
    getItem: key => key === 'hobunjiSaveMeta' ? JSON.stringify(saveMeta) : null,
    setItem(key, value) { if (key === 'hobunjiSaveMeta') saveMeta = JSON.parse(value); },
  },
  requestAnimationFrame(callback) { animationFrames.push(callback); },
  THREE,
  window,
};

vm.runInNewContext(fs.readFileSync('docs/js/seated-head-facing.js', 'utf8'), context);
vm.runInNewContext(fs.readFileSync('docs/js/campfire-system.js', 'utf8'), context);

let pixelProbeInitialized = false; // Confirms both late-global wrappers still delegate to the original runtime.
window.PixelProbe = {
  init() { pixelProbeInitialized = true; },
};
const renderer = { render() {} };
const camera = {};
window.PixelProbe.init({
  renderer,
  camera,
  playerMesh: { children: [] },
  player: { angle: 0 },
  getSitInteraction: () => null,
});

assert(pixelProbeInitialized, 'PixelProbe original init still runs through both wrappers');
assert.equal(window.SeatedHeadFacing.installed, true, 'campfire interceptor preserves the earlier seated-head PixelProbe interceptor');
assert.equal(window.CampfireSystem.snapshot().cameraReady, true, 'campfire captures the same late PixelProbe camera dependency');
assert(listeners.has('hobunji-time-passage'), 'checkpoint completion listens for confirmed time-passage events');

const player = { x: 82.5, y: 82.5, angle: 0 }; // Starts at the center of the persisted campfire tile.
window.__hobunjiPlayerProfile = { worldId: 'world', characterId: 'character' };
window.__hobunjiGameStarted = true;
window.DevSpawner = { init() {} };
window.DevSpawner.init({
  getCurrentArea: () => 'farm',
  getActiveScene: () => null,
  EXTERIOR_ZONES: {},
  COLS: 36,
  ROWS: 26,
  TILE: 55,
  player,
  restoreCampfireCheckpoint: async () => true,
});
window.CalendarSystem = {
  init() {},
  openTimePassage() { timePassageOpen = true; return true; },
};
window.CalendarSystem.init({ calendar: { day: 1, time01: 0.5 } });
animationFrames.shift()(0);

assert.equal(window.CampfireSystem.beginSleep(), true, 'nearby campfire opens and arms the sleep dialog');
timePassageOpen = false;
animationFrames.shift()(16);
assert.equal(window.CampfireSystem.snapshot().pendingSleep, null, 'closing the dialog without confirmation cancels pending sleep');
assert.equal(window.CampfireSystem.snapshot().checkpointActive, false, 'cancelled sleep cannot activate a checkpoint');

assert.equal(window.CampfireSystem.beginSleep(), true, 'sleep can be opened again after cancellation');
listeners.get('hobunji-time-passage')({ detail: { kind: 'sleep' } });
assert.equal(window.CampfireSystem.snapshot().checkpointActive, true, 'confirmed sleep activates the campfire checkpoint');
assert.deepEqual(saveMeta.worlds[0].members.character.campfireState.checkpoint, player, 'confirmed checkpoint persists exact position and facing');

const inventory = { campfireKit: 99, pineLog: 20, stone: 20 }; // Full-stack crafting must not consume ingredients.
window.CampfireSystem.attachCraftingDeps({ inventory, showToast() {} });
assert.equal(window.CampfireSystem.craft(), false, 'crafting refuses a full campfire stack');
assert.deepEqual(inventory, { campfireKit: 99, pineLog: 20, stone: 20 }, 'full-stack refusal preserves all ingredients');

const campfireSource = fs.readFileSync('docs/js/campfire-system.js', 'utf8');
const gameSource = fs.readFileSync('docs/game.js', 'utf8');
assert.doesNotMatch(campfireSource, /finishSleepCheckpointIfNeeded/, 'ordinary clock drift cannot complete a sleep checkpoint');
assert.match(campfireSource, /event\?\.detail\?\.kind !== 'sleep'/, 'only a confirmed sleep passage completes a checkpoint');
assert.match(campfireSource, /d\.canPlaceCampfireAt\?\.\(col, row\) === false/, 'placement delegates to the game collision boundary');
assert.match(gameSource, /function canPlaceCampfireAt\(col, row\)/, 'game exports a clear, dry tile validator');
assert.match(gameSource, /await enterZone\(record\.area/, 'wilderness checkpoint restore uses the normal zone-entry lifecycle');
assert.match(gameSource, /facingAngle = Number\(checkpoint\.angle\)/, 'checkpoint restore updates private and public facing state');

console.log('campfire runtime tests passed');
