'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/prologue-rescue-map-runtime.js', 'utf8'); // Single authoritative prologue loader owner.

function classList() {
  const values = new Set(['visible']); // Simulates the already-painted initial boot loader.
  return {
    add(...items) { items.forEach(item => values.add(item)); },
    remove(...items) { items.forEach(item => values.delete(item)); },
    contains(item) { return values.has(item); },
  };
}

const loaderRoot = { id: 'hobunjiLoadScreen', classList: classList() };
const listeners = new Map();
const documentStub = {
  documentElement: {},
  getElementById(id) { return id === 'hobunjiLoadScreen' ? loaderRoot : null; },
  addEventListener(type, handler) {
    const list = listeners.get(type) || [];
    list.push(handler);
    listeners.set(type, list);
  },
};

let persistedState = null; // Brand-new owner begins before PrologueSystem writes rescue state.
let currentArea = 'farm';
let actorsReady = false;
let dialogueReady = false; // Deliberately remains false through loader release.
let loaderShows = 0;
let loaderHides = 0;
const progress = [];
const rafQueue = [];
const intervals = [];
const scene = {
  fog: null,
  userData: {},
  children: [],
  add(child) { this.children.push(child); },
};
const grid = Array.from({ length: 25 }, (_, row) =>
  Array.from({ length: 25 }, (_, col) => ({
    type: col === 0 || row === 0 || col === 24 || row === 24 ? 'shrub' : 'grass',
  })),
);

function tree() {
  return {
    userData: {},
    position: { set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
  };
}

const windowObject = {
  __hobunjiPlayerProfile: null,
  __hobunjiPrologueHiddenSetup: false,
  GridTileAccessors: {
    getCurrentArea: () => currentArea,
    getActiveCols: () => 25,
    getActiveRows: () => 25,
    getActiveGrid: () => grid,
    getActiveScene: () => scene,
  },
  PrologueDialogueRuntime: {
    isRescueActorsReady: () => actorsReady,
    isRescueStageReady: () => dialogueReady,
  },
  LoadingScreenRuntime: {
    getDebug: () => ({ visible: loaderRoot.classList.contains('visible') }),
    show() { loaderShows++; loaderRoot.classList.add('visible'); },
    setProgress(value, label) { progress.push({ value, label }); },
    async hide() { loaderHides++; loaderRoot.classList.remove('visible'); },
  },
  FoliageGenerator: {
    buildShadewoodMesh() { return tree(); },
  },
  THREE: {
    FogExp2: class FogExp2 {
      constructor(color, density) {
        this.isFogExp2 = true;
        this.density = density;
        this.color = { value: color, setHex(next) { this.value = next; } };
      }
    },
  },
  LocalDBOverrides: {
    async loadDatabase() { return { maps: [] }; },
  },
  CloudForestFog: {
    init() {},
  },
};

const context = {
  window: windowObject,
  document: documentStub,
  console,
  localStorage: {
    getItem(key) {
      if (key !== 'hobunjiSaveMeta') return null;
      return JSON.stringify({
        worlds: [{
          id: 'world-test',
          ...(persistedState ? { prologue: persistedState } : {}),
        }],
      });
    },
  },
  MutationObserver: class MutationObserver {
    constructor(callback) { this.callback = callback; }
    observe() {}
    disconnect() {}
  },
  setInterval(callback) { intervals.push(callback); return intervals.length; },
  clearInterval() {},
  requestAnimationFrame(callback) { rafQueue.push(callback); return rafQueue.length; },
  Promise,
};
context.window.window = context.window;

vm.createContext(context);
vm.runInContext(source, context, { filename: 'prologue-rescue-map-runtime.js' });

const runtime = windowObject.PrologueRescueMapRuntime;
assert.ok(runtime, 'PrologueRescueMapRuntime must export its API');
const playerReady = (listeners.get('hobunjiPlayerReady') || [])[0];
assert.equal(typeof playerReady, 'function', 'player-ready handler must be installed');

const profile = {
  worldId: 'world-test',
  characterId: 'owner',
  isWorldOwner: true,
  isNewWorld: true,
};
windowObject.__hobunjiPlayerProfile = profile;
playerReady({ detail: profile });

assert.equal(runtime.debugSnapshot().loaderHeld, true, 'new owner must acquire one authoritative loading hold');
assert.equal(windowObject.__hobunjiPrologueHiddenSetup, true, 'hidden-audio state starts with loader ownership');
assert.equal(loaderShows, 0, 'already-visible boot loader must be reused instead of restarted');
assert.equal(loaderRoot.classList.contains('visible'), true);

// Re-acquiring while held must be idempotent.
assert.equal(runtime.beginLoadingHold('duplicate-retry'), false);
assert.equal(runtime.beginLoadingHold('duplicate-retry-2'), false);
assert.equal(loaderShows, 0, 'retries must not create new loading generations');

// Map is complete, but scripted world actors are not staged yet. The loader
// stays up for actor pop-in prevention; dialogue/camera readiness is irrelevant.
persistedState = { stage: 'rescue', completed: false };
currentArea = 'map_prologue_rescue';
runtime.requestRevealCheck();
assert.equal(runtime.rescueMapReady(), true, 'real 25x25 map/fog/tree setup is ready');
assert.equal(runtime.rescueActorsReady(), false, 'scripted world actors are still missing');
assert.equal(runtime.rescueRevealReady(), false);
assert.equal(loaderHides, 0, 'map readiness alone cannot hide before actor staging');
assert.equal(loaderRoot.classList.contains('visible'), true);
assert.equal(scene.userData.prologueRescueBoundaryTreeCount, 96, 'outer boundary generates 96 Shadewoods');

// Critical live regression: actors become ready while dialogue/camera remains
// unavailable. The loader MUST release anyway after its two-paint barrier.
actorsReady = true;
dialogueReady = false;
runtime.requestRevealCheck();
assert.equal(runtime.rescueRevealReady(), true, 'dialogue readiness is not part of map reveal anymore');
assert.equal(runtime.debugSnapshot().dialogueReady, false, 'test proves release happens with dialogue still unavailable');
assert.equal(rafQueue.length, 1, 'actor+map readiness schedules first paint frame');
const first = rafQueue.shift();
first();
assert.equal(rafQueue.length, 1, 'first paint schedules second paint frame');
const second = rafQueue.shift();
second();

Promise.resolve().then(() => Promise.resolve()).then(() => {
  assert.equal(loaderHides, 1, 'single loader owner performs exactly one canonical hide');
  assert.equal(loaderRoot.classList.contains('visible'), false, 'final DOM overlay is actually removed');
  assert.equal(windowObject.__hobunjiPrologueHiddenSetup, false, 'audio suppression ends after actual loader removal');
  assert.equal(runtime.debugSnapshot().loaderHeld, false);
  assert.equal(runtime.debugSnapshot().lastReadyArea, 'map_prologue_rescue');
  assert.ok(progress.some(event => event.value === 100 && event.label === 'prologue-ready'));

  assert.equal(source.includes('PrologueDialogueRuntime?.isRescueActorsReady'), true, 'map loader gates on actor world-model readiness');
  assert.equal(source.includes('return rescueMapReady() && rescueActorsReady()'), true, 'rescue reveal must not depend on dialogue/camera readiness');
  assert.equal(source.includes('window.__hobunjiPrologueHiddenSetup = false'), true, 'map owner clears hidden-audio state on final release');

  console.log('prologue actor-gated loading-screen release regression passed');
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
