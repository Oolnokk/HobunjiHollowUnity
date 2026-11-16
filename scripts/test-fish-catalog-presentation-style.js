'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Execute the real catalog with a tiny DOM/RAF harness; no browser or network required.
function makeFishImage() {
  let writes = 0;
  const values = { transformBox: '', transformOrigin: '', transform: '' };
  const style = {};
  for (const name of Object.keys(values)) {
    Object.defineProperty(style, name, {
      get() { return values[name]; },
      set(value) {
        writes++;
        // Browsers normalize the comma spacing in CSS function values.
        values[name] = String(value).replace(/,\s*/g, ', ');
      },
    });
  }
  const attributes = new Map();
  return {
    style,
    get writes() { return writes; },
    getAttribute: key => attributes.get(key) || null,
    setAttribute: (key, value) => { attributes.set(key, value); },
  };
}

let image = makeFishImage();
const queued = [];
let observers = 0;
let disconnects = 0;
const fishing = {
  state: { phase: 'active', fishDef: { key: 'not-an-authored-fish', minigameScaleX: 1, minigameScaleY: 1 }, fishAnimT: 0 },
  init() {},
  beginCast() { return true; },
};
const global = {
  console,
  Fishing: fishing,
  document: { getElementById: id => id === 'fishDeformedImage' ? image : null },
  requestAnimationFrame: callback => { queued.push(callback); return queued.length; },
  Image: class { set src(_value) {} },
  MutationObserver: class {
    observe() { observers++; }
    disconnect() { disconnects++; }
  },
};
global.window = global;
vm.runInNewContext(fs.readFileSync('docs/js/fish-catalog.js', 'utf8'), global, { filename: 'fish-catalog.js' });

function nextFrame() {
  assert.ok(queued.length > 0, 'catalog must have scheduled a frame');
  queued.shift()();
}

assert.equal(global.Fishing.beginCast(), true);
nextFrame();
assert.equal(image.writes, 3, 'first frame initializes all three styles');
assert.equal(image.style.transform, 'scale(1, 1)');
assert.equal(observers, 1);

for (let i = 0; i < 120; i++) nextFrame();
assert.equal(image.writes, 3, 'unchanged fish must not rewrite styles on later frames');
assert.equal(global.FishCatalog.getPresentationStyleDebug().skips, 120 * 3);
assert.equal(global.FishCatalog.getPresentationStyleDebug().writes, 3);

// A new species can change both axes; the presentation must still track it.
global.Fishing.state.fishDef.minigameScaleX = 1.25;
global.Fishing.state.fishDef.minigameScaleY = 0.8;
nextFrame();
assert.equal(image.writes, 4, 'changing fish scale only writes the changed transform');
assert.equal(image.style.transform, 'scale(1.25, 0.8)');

// External styles must be corrected rather than trusted from cached values.
image.style.transformOrigin = 'left top';
image.style.transform = 'none';
const prior = image.writes;
nextFrame();
assert.equal(image.writes, prior + 2, 'external style overrides must be restored');
assert.equal(image.style.transformOrigin, 'center');

// The minigame can replace its image node without restarting the catalog.
const oldImage = image;
image = makeFishImage();
nextFrame();
assert.equal(image.writes, 3, 'replacement images must be initialized');
assert.equal(image.style.transform, 'scale(1.25, 0.8)');
assert.equal(observers, 2);
assert.ok(disconnects >= 1);
assert.equal(oldImage.writes, prior + 2);

// No surviving loop once the minigame state is cleared; a new cast restarts it.
global.Fishing.state = null;
nextFrame();
assert.equal(global.FishCatalog.getPresentationStyleDebug().running, false);
assert.equal(queued.length, 0);
global.Fishing.state = { phase: 'active', fishDef: { key: 'not-an-authored-fish', minigameScale: 1 }, fishAnimT: 0 };
global.Fishing.beginCast();
nextFrame();
assert.equal(global.FishCatalog.getPresentationStyleDebug().running, true);
assert.equal(image.style.transform, 'scale(1, 1)');

console.log('Fish presentation style mutation regression passed.');
