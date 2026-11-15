'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.resolve(__dirname, '..'); // Absolute repository root for CI and local execution.
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8'); // Checked-in sources, not duplicates.
const shell = read('docs/tools/animal-head-rig/index.html'); // Browser load order for the authoring workspace.
const workbench = read('docs/tools/animal-head-rig/hat-tab.js'); // Actual hat tab UI and brush wiring.
const runtime = read('docs/js/animal-npc-headwear.js'); // Existing named-animal compositor, now with geometric deformation.
const brushSource = read('docs/js/modular-weapon-bridge-fill.js'); // Shared modular weapon displacement implementation.

for (const source of [workbench, runtime, brushSource]) new vm.Script(source);
assert.match(shell, /src="\.\/author-part9\.js"/, 'existing shoulder-pose editor must still load');
assert.match(shell, /src="\.\/hat-tab\.js\?v=/, 'hat workbench is loaded from the rigger page');
assert.match(shell, /src="\.\.\/\.\.\/js\/animal-npc-headwear\.js\?v=/, 'workbench shares runtime attachment normalization');
assert.match(shell, /src="\.\.\/\.\.\/js\/modular-weapon-bridge-fill\.js\?v=/, 'workbench loads the weapon brush module');
assert(shell.indexOf('author-part9.js') < shell.indexOf('hat-tab.js'), 'hat tab must hook the final existing rig API');
assert.match(workbench, /originalBuildRecord\s*=\s*buildRecord/, 'animal export includes the same attachment used in UI');
assert.match(workbench, /originalNormalizedRig\s*=\s*normalizedRig/, 'existing game-preview rig is extended, not replaced');
assert.match(workbench, /originalApplyRecord\s*=\s*applyRecord/, 'hat settings follow animal selection and import');
assert.match(workbench, /brushApi\.smudgeStep/, 'smudge uses shared modular weapon displacement');
assert.match(workbench, /brushApi\.plowStep/, 'plow uses shared modular weapon displacement');
assert.match(workbench, /brushApi\.revertStep/, 'restore uses shared modular weapon undo/revert brush');
assert.match(workbench, /rgba|pixels|pixel/i, 'hat tab includes raster authoring');
assert.match(workbench, /Edited PNG pixels still require exported assets/i, 'UI distinguishes hat fit previews from exported sprite art');
assert.match(workbench, /HAT_PREVIEW_STORAGE_KEY = 'hobunji_animal_hat_fits_v1'/, 'hat-only preview uses a key distinct from complete neck rigs');
assert.doesNotMatch(workbench, /writePreviewRigs\(rigs\)/, 'hat-only save must not overwrite runtime head-rig records');
assert.match(workbench, /view\.layers\.filter\(layer => layer\.dirty\)/, 'multi-layer export only selects edited layers');

const context = {
  window: {
    NpcAvatarPreview: { ensurePortraitCosmetics: async () => ({
      optionCache: new Map([['test-hat', { id: 'test-hat', layers: [
        { url: './assets/test-front.png', pos: 'front' },
        { url: './assets/test-back.png', pos: 'back' }
      ] }]])
    }) }
  },
  document: {
    currentScript: { src: 'https://example.test/js/animal-npc-headwear.js' },
    createElement(tag) {
      assert.equal(tag, 'canvas');
      const canvas = { width: 0, height: 0 }; // Minimal fake output canvas to capture runtime drawing calls.
      canvas.getContext = () => ({
        drawImage: (...args) => operations.push(['drawImage', ...args]),
        getImageData: () => {
          const pixels = new Uint8ClampedArray(canvas.width * canvas.height * 4);
          for (let i = 0; i < pixels.length; i += 4) pixels[i + 3] = 255;
          return { data: pixels };
        },
        save: () => operations.push(['save']),
        restore: () => operations.push(['restore']),
        translate: (...v) => operations.push(['translate', ...v]),
        rotate: (...v) => operations.push(['rotate', ...v]),
        transform: (...v) => operations.push(['transform', ...v]),
        scale: (...v) => operations.push(['scale', ...v]),
      });
      return canvas;
    }
  },
  Image: class Image {
    constructor() { this.naturalWidth = 4; this.naturalHeight = 2; }
    set src(value) { this.path = value; queueMicrotask(() => this.onload?.()); }
  },
  URL, console, Uint8ClampedArray
};
const operations = []; // Recorded drawing commands for front/back layers and skew scaling.
vm.createContext(context);
vm.runInContext(runtime, context, { filename: 'animal-npc-headwear.js' });
const hats = context.window.AnimalNpcHeadwear;
assert(hats, 'runtime hat adapter must register');
const committedRig = { enabled: true, weightMap: { width: 1, height: 1, data: [255] }, pivot: { x: .4, y: .5 } };
const hatPreview = { enabled: true, width: .49, heightScale: 1.4, skewXDeg: 18, anchor: { x: .35, y: .22 } };
const storedPreviews = {
  hobunji_animal_head_rigs_v1: JSON.stringify({ 'test-kind': committedRig }),
  hobunji_animal_hat_fits_v1: JSON.stringify({ 'test-kind': hatPreview })
};
context.localStorage = { getItem: key => storedPreviews[key] || null };
context.window.HobunjiAnimalHeadRigSpecies = { baseSpeciesFor: id => id === 'test-kind-den-mother' ? 'test-kind' : id };
assert.equal(hats.previewHatForKind('test-kind').width, .49, 'independent hat preview is readable by runtime');
assert.equal(hats.previewHatForKind('test-kind-den-mother').heightScale, 1.4,
  'sprite-equivalent animal variants inherit the authored base hat fit');
assert.deepEqual(JSON.parse(storedPreviews.hobunji_animal_head_rigs_v1)['test-kind'], committedRig,
  'reading a hat preview cannot mutate a complete head-rig record');

const original = hats.normalizeAttachment({ width: .4, rotationDeg: 10 });
assert.equal(original.heightScale, 1, 'older attachments remain vertically unmodified');
assert.equal(original.skewXDeg, 0, 'older attachments remain unskewed');
const authored = hats.normalizeAttachment({ width: .4, heightScale: 1.5, skewXDeg: 25,
  flipX: true, anchor: { x: .7, y: .3 }, artAnchor: { x: .4, y: .75 } });
assert.equal(authored.heightScale, 1.5);
assert.equal(authored.skewXDeg, 25);
assert.equal(authored.flipX, true);
const disabled = hats.normalizeAttachment({ enabled: false, width: .7, heightScale: 1.8 });
assert.equal(disabled.enabled, false, 'disabled hats must remain disabled');
assert.equal(disabled.width, .7, 'disabled hat placement retains editable geometry');
assert.equal(disabled.heightScale, 1.8, 'disabled hat deformation survives serialization');
assert.equal(hats.normalizeAttachment({ heightScale: 99, skewXDeg: -90 }).heightScale, 3,
  'untrusted vertical scale must clamp to the editor range');
assert.equal(hats.normalizeAttachment({ heightScale: 99, skewXDeg: -90 }).skewXDeg, -45,
  'untrusted skew must clamp to the editor range');
assert.equal(hats.normalizeAttachment({ heightScale: -99 }).heightScale, .2);

(async () => {
  const previewPlacement = await hats.attachmentForKind('test-kind');
  assert.equal(previewPlacement.width, .49, 'hat attachment loader must prefer the dedicated preview store');
  assert.equal(previewPlacement.skewXDeg, 18);
  const composed = await hats.composeWithHat({ width: 100, height: 80 }, 'test-kind', 'test-hat',
    { attachment: { ...authored, enabled: true } });
  assert.equal(composed.width, 100);
  assert.equal(composed.height, 80);
  const skew = operations.filter(o => o[0] === 'transform');
  assert.equal(skew.length, 2, 'back/front hat art must each receive the attachment deformation');
  for (const op of skew) assert(Math.abs(op[3] - Math.tan(25 * Math.PI / 180)) < 1e-9);
  assert.equal(operations.filter(o => o[0] === 'scale' && o[1] === -1).length, 2);
  const drawnHat = operations.filter(o => o[0] === 'drawImage' && o.length === 6 && o[1]?.width === 4 && o[1]?.height === 2);
  assert.equal(drawnHat.length, 2, 'both hat layers render, in addition to the creature base');
  assert.equal(drawnHat[0][5], 100 * .4 * (2 / 4) * 1.5,
    'vertical scale must adjust hat drawing geometry without modifying the source PNG');

  const brushContext = { window: {}, Uint8Array, Uint8ClampedArray, Uint32Array, Int8Array,
    Int32Array, Float32Array, Float64Array, console };
  vm.createContext(brushContext);
  vm.runInContext(brushSource, brushContext, { filename: 'modular-weapon-bridge-fill.js' });
  const tools = brushContext.window.ModularWeaponBridgeFill;
  const w = 24, h = 24;
  const pixels = new Uint8ClampedArray(w * h * 4);
  for (let y = 7; y < 15; y++) for (let x = 5; x < 12; x++) {
    const i = (y * w + x) * 4;
    pixels.set(x % 2 ? [0, 0, 0, 255] : [180, 60, 95, 255], i);
  }
  const before = new Uint8ClampedArray(pixels);
  const allOpaque = (p, offset) => p[offset + 3] >= 8 ? 2 : 0;
  const changed = tools.smudgeStep(pixels, w, h, { x: 7, y: 10 }, { x: 14, y: 10 }, 5,
    { classify: allOpaque });
  assert(changed > 0, 'shared brush displaces a general animal hat rather than only a metal palette');
  assert.notDeepEqual(pixels, before, 'hat sprite pixels actually deform');
  const restored = tools.revertStep(pixels, before, w, h, { x: 12, y: 12 }, { x: 12, y: 12 }, 30,
    { strength: 1, random: () => 0 });
  assert(restored > 0, 'shared restore brush can recover deformed pixels');
  assert.deepEqual(pixels, before, 'restore can recover dark outlines and colored hat art together');
  console.log('Animal hat workspace and runtime attachment deformation: PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });

// Real hats-tab module bootstrap in a fake DOM: regression for hat-only storage
// never shadowing a valid head-rig preview record.
{
  const elements = new Map(); // Fake elements keep callbacks installed by the unmodified editor script.
  function createNode() {
    return { events: {}, addEventListener(type, callback) { this.events[type] = callback; },
      appendChild() {}, before() {}, after() {}, setAttribute() {}, classList: { toggle() {} },
      getContext: () => ({ clearRect() {}, drawImage() {} }),
      getBoundingClientRect: () => ({ width: 300, height: 200 }),
      options: [], selectedIndex: 0, innerHTML: '', textContent: '', value: '', style: {}, hidden: false };
  }
  const node = id => {
    if (!elements.has(id)) elements.set(id, createNode());
    return elements.get(id);
  };
  node('animalId').value = 'hat_only_test';
  node('hatEnabled').checked = true;
  for (const [id, value] of Object.entries({ hatAnchorX: '.5', hatAnchorY: '.2', hatWidth: '.34',
    hatHeightScale: '1', hatSkew: '0', hatRotation: '0', hatArtX: '.5', hatArtY: '.86' }))
    node(id).value = value;
  const originalNeck = { enabled: true, weightMap: { width: 1, height: 1, data: [255] }, pivot: { x: .2, y: .5 } };
  const saved = { hobunji_animal_head_rigs_v1: JSON.stringify({ 'hat-only-test': originalNeck }) };
  const localStorage = { getItem: key => saved[key] || null, setItem: (key, value) => { saved[key] = value; } };
  const testWindow = { ModularWeaponBridgeFill: { smudgeStep() {}, plowStep() {}, revertStep() {} },
    AnimalNpcHeadwear: hats, addEventListener() {}, devicePixelRatio: 1 };
  const testContext = {
    window: testWindow, document: { head: createNode(), querySelector: createNode,
      getElementById: node, createElement: createNode }, localStorage,
    state: { baseRecord: {}, pendingRig: null, image: null },
    normalizedRig: () => null, applyRigToPaint: () => {}, applyRecord: () => {}, buildRecord: () => ({ id: 'hat_only_test' }),
    populateAnimalSelect: () => {}, updateOutput: () => {}, resizeCanvases: () => {},
    requestAnimationFrame: callback => callback(), ResizeObserver: class { observe() {} },
    pretty: JSON.stringify, copyText() {}, downloadJson() {}, console
  };
  vm.createContext(testContext);
  vm.runInContext(workbench, testContext, { filename: 'hat-tab.js' });
  assert(testWindow.HobunjiAnimalHatWorkbench, 'actual Hats-tab script must boot with legacy neck bindings');
  node('hatHeightScale').value = '1.7';
  node('hatHeightScale').events.input();
  node('hatPreviewSave').onclick();
  const hatFits = JSON.parse(saved.hobunji_animal_hat_fits_v1);
  assert.equal(hatFits['hat-only-test'].heightScale, 1.7,
    'hat-only Save must persist authored deformation without head paint');
  assert.deepEqual(JSON.parse(saved.hobunji_animal_head_rigs_v1)['hat-only-test'], originalNeck,
    'hat-only Save must preserve a previously valid complete neck preview, byte-for-byte');
  node('hatPreviewClear').onclick();
  assert.equal(Object.hasOwn(JSON.parse(saved.hobunji_animal_hat_fits_v1), 'hat-only-test'), false,
    'Clear hat preview only deletes the separate hat override');
  assert.deepEqual(JSON.parse(saved.hobunji_animal_head_rigs_v1)['hat-only-test'], originalNeck,
    'clearing a hat preview must not clear neck pose/weights');
  node('hatHeightScale').value = '1.2';
  node('hatHeightScale').events.input();
  node('hatPreviewSave').onclick();
  node('clearAllPreviewRigs').onclick();
  assert.deepEqual(JSON.parse(saved.hobunji_animal_hat_fits_v1), {},
    'Clear all in-game previews must include independent hat previews');
}
