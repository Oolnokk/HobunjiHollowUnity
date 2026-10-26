'use strict';
// Regression checks for the game's shared typeface, including async canvas textures.
const assert = require('node:assert/strict'); // Used for explicit runtime and font-contract assertions.
const fs = require('node:fs'); // Reads the shipped modules instead of copies.
const vm = require('node:vm'); // Executes the actual canvas-festival module with a lightweight scene.

const css = fs.readFileSync('docs/gameplay-ui-theme.css', 'utf8'); // Holds overrides for late-injected gameplay overlays.
const baseCss = fs.readFileSync('docs/style.css', 'utf8'); // Declares the shared gameplay font stack.
const gameHtml = fs.readFileSync('docs/index.html', 'utf8'); // Verifies entry-point cache busting.
const requiredSelectors = [ // Prevents regressions in independently styled dialogs.
  '#townProposalReader', '#townProposalReader .proposal-paper', '#townProposalReader h2',
  '#animalBabyArrivalOverlay input', '#animalBabyArrivalOverlay button',
  '#romanceFamilyOverlay', '#hobunjiAutosavePausedBadge',
  '#npcCommandWheel .socialActionLabel', '#socialActionWheel .socialActionLabel',
  '.hobunji-cooking-panel h2', '.cooking-recipe-head h3',
  '#townMineLadderPanel', '#slagothimTradePanel',
  '.cp-overlay', '.pa-overlay', '.loomcraft-overlay',
];
assert.match(baseCss, /--gameplay-font-family:\s*'KhymeryyanRomanLetters\+Numbers'/);
assert.match(baseCss, /font-family:\s*var\(--gameplay-font-family\)/);
for (const selector of requiredSelectors) assert(css.includes(selector), `Missing gameplay-font coverage for ${selector}`);
assert.match(css, /font-family:\s*var\(--gameplay-font-family\)\s*!important/);
for (const path of ['style.css', 'gameplay-ui-theme.css', 'js/festival-props.js', 'js/wilderness-map.js']) {
  assert(new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\?v=[A-Za-z0-9_-]+').test(gameHtml), `Missing cache-busted entry: ${path}`);
}

class Group { // Models only the Three.js lifecycle methods the production module uses.
  constructor() { this.userData = {}; this.children = []; this.scale = { x: 1 }; this.position = { set() {} }; }
  add(child) { child.parent = this; this.children.push(child); }
  getWorldQuaternion(quaternion) { return quaternion; }
  traverse(callback) { callback(this); for (const child of this.children) child.traverse(callback); }
}
class Mesh extends Group { // Supplies the sign plane's owned material and geometry.
  constructor(geometry, material) {
    super(); this.geometry = geometry; this.material = material;
    this.quaternion = { copy: () => ({ multiply() {} }) };
  }
}
class PlaneGeometry { dispose() {} } // Simulates the sign geometry's GPU cleanup hook.
class Quaternion { invert() { return this; } } // Supports the sign's deferred camera-facing hook.

(async () => {
  const painted = []; // Records the live canvas drawing path on every repaint.
  const pendingFontLoads = []; // Controls whether the typeface resolves before or after disposal.
  const disposedTextures = []; // Detects GPU-resource cleanup on removed festival layouts.
  const context = { // Same 2D canvas methods that the shipped sign painter calls.
    clearRect() {}, fillRect() {}, strokeRect() {},
    fillText(value) { painted.push(value); },
  };
  const document = { // Browser font and canvas API stubs; no renderer download needed.
    body: {},
    createElement(tag) {
      assert.equal(tag, 'canvas');
      return { width: 0, height: 0, getContext: () => context };
    },
    fonts: { load(font) {
      assert.match(font, /KhymeryyanRomanLetters\+Numbers/);
      return new Promise((resolve, reject) => pendingFontLoads.push({ resolve, reject }));
    } },
  };
  const window = { // The actual module creates these groups and texture/material pairs.
    THREE: { Group, Mesh, PlaneGeometry, Quaternion, DoubleSide: 2 },
    HobunjiSpritePngSurface: {
      makeCanvasTexture(_three, canvas) { return { image: canvas, needsUpdate: false, dispose() { disposedTextures.push(this); } }; },
      makeMaterial(_three, texture) { return { map: texture, dispose() {} }; },
    },
  };
  vm.runInNewContext(fs.readFileSync('docs/js/festival-props.js', 'utf8'), {
    window, document, getComputedStyle: () => ({ fontFamily: '"KhymeryyanRomanLetters+Numbers", monospace' }),
  });
  const record = { key: 'tableSmall', activity: { type: 'dance', label: 'Harvest Dance' } }; // Drives the actual optional sign path.
  const live = new Group(); // Kept through font resolution.
  window.FestivalProps.decorate(live, record);
  const liveTexture = live.children[0].userData.festivalTexture; // Assert the same canvas texture is reused.
  assert.deepEqual(painted, ['Harvest Dance']);
  pendingFontLoads.shift().resolve([]);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(painted, ['Harvest Dance', 'Harvest Dance'], 'font ready must repaint pre-existing sign text');
  assert.equal(liveTexture.needsUpdate, true, 'repainting must trigger a GPU texture update');

  const removed = new Group(); // Removed before its font load finishes.
  window.FestivalProps.decorate(removed, record);
  const removedTexture = removed.children[0].userData.festivalTexture; // Checks the disposed texture is never resurrected.
  window.FestivalProps.dispose(removed);
  pendingFontLoads.shift().resolve([]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(painted.length, 3, 'disposed signs must not repaint');
  assert.equal(removedTexture.needsUpdate, false, 'disposed textures must not be uploaded again');
  assert(disposedTextures.includes(removedTexture), 'disposed layout must release sign texture');

  const rejected = new Group(); // Font load failures retain the initial readable rendering.
  window.FestivalProps.decorate(rejected, record);
  pendingFontLoads.shift().reject(new Error('font unavailable'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(painted.length, 4, 'failed font loading must preserve the initial sign');
  document.fonts = undefined; // Some embedding/test contexts lack the FontFaceSet API.
  assert.doesNotThrow(() => window.FestivalProps.decorate(new Group(), record));
  console.log('Gameplay font selectors and festival font-ready/disposal regressions passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
