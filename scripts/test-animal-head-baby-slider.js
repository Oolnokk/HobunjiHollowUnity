// Baby head size must be discoverable, visibly previewed, and saved per species without changing source art.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const editor = fs.readFileSync('docs/tools/animal-head-rig/index.html', 'utf8');
const part1 = fs.readFileSync('docs/tools/animal-head-rig/author-part1.js', 'utf8');
const part3 = fs.readFileSync('docs/tools/animal-head-rig/author-part3.js', 'utf8');
const part4 = fs.readFileSync('docs/tools/animal-head-rig/author-part4.js', 'utf8');
const part6 = fs.readFileSync('docs/tools/animal-head-rig/author-part6.js', 'utf8');
const part10 = fs.readFileSync('docs/tools/animal-head-rig/author-part10.js', 'utf8');
assert(editor.includes('id="babyHeadScale" type="range" min="100" max="145"'), 'the slider supports 100–145% on mobile');
assert(editor.includes('id="babyHeadCompare"'), 'comparison button is available without devtools');
assert(editor.indexOf('id="babyHeadScalePanel"') < editor.indexOf('<h2>Animal variables'), 'baby size is at the top of the editor instead of hidden in preview settings');
assert(editor.indexOf('attachment-rig-profiles.js') < editor.indexOf('baby-animal-head-warp.js'), 'authored species frames load before baby warp');
assert(editor.indexOf('author-part10.js') > editor.indexOf('author-part9.js'), 'final authoring extension loads after existing shoulder handlers');
assert(part1.includes('let previewImageForAnimal = image => image'), 'core preview works before extension loads');
assert(part4.includes("image.crossOrigin='anonymous'") && part4.indexOf("image.crossOrigin='anonymous'") < part4.indexOf('image.src=url'),
  'idle image must be requested in CORS mode before assigning src, not after it has tainted a canvas');
assert(part6.includes("image.crossOrigin='anonymous'") && part6.indexOf("image.crossOrigin='anonymous'") < part6.indexOf('image.src=repoSpriteUrl(path)'),
  'run1 shoulder source must also be CORS-readable before the baby split');
assert(part4.includes("if(/^(?:https?:|blob:|data:)/i.test(raw))return raw"),
  'explicit remote sprite URLs must not be rewritten as relative repo paths');
assert(part10.includes('if (warped === source) throw new Error('),
  'a refused getImageData must not be cached as a successful enlargement');
assert(part10.includes('readableBabyError(error)') && part10.includes('Choose image'),
  'mobile error status must explain how to import inaccessible PNGs');
assert(part1.includes('let previewSplitLayerCanvases = () => splitLayerCanvases()'), 'shoulder preview has a separate hook from unwarped paint layers');
assert(part3.includes('drawImage(previewImageForAnimal(state.image)'), 'neck deformation uses baby preview pixels');
assert(part6.includes('drawImage(previewImageForAnimal(image)'), 'shoulder-spline preview uses baby texture');
assert(part6.includes('const layers=previewSplitLayerCanvases()'), 'shoulder preview enlarges source before doing its split');
assert(!part3.includes('paintCtx.drawImage(previewImageForAnimal('), 'painting remains unwarped');
assert(!part6.includes('paintCtx.drawImage(previewImageForAnimal('), 'shoulder painting remains unwarped');

const listeners = new Map(); // Event callbacks used to simulate mobile slider changes and compare taps.
const elements = new Map(); // Minimal DOM fixtures for the public editor controls.
for (const id of ['babyHeadScale', 'babyHeadScaleLabel', 'babyHeadCompare', 'babyHeadPreviewState', 'animalId', 'status', 'previewAngle', 'previewBadge']) {
  const attrs = new Map();
  elements.set(id, { value: '', textContent: '', addEventListener(event, fn) {
    const key = id + ':' + event;
    listeners.set(key, [...(listeners.get(key) || []), fn]);
  }, setAttribute(k, v) { attrs.set(k, v); }, getAttribute(k) { return attrs.get(k); } });
}
let draws = 0, checkpoints = 0, applied = 0, guides = 0, splitCalls = 0;
const splitInputs = []; // Captures the true order of warp and separator clipping.
let lastPreviewScale = null, lastPreviewFrame = null;
const canonical = { x: 0.2, y: 0.2, width: 0.3, height: 0.3, coordinateSpace: 'sprite-normalized-top-left' };
const validateFrame = frame => frame?.coordinateSpace === 'sprite-normalized-top-left' ? frame : null;
const warp = {
  getScale: () => 1.32, MAX_SCALE: 1.45, validateFrame,
  frameForKind: kind => kind === 'grehlr' ? canonical : null,
  applyToCanvas: (_source, kind, scale, frame) => {
    applied++; lastPreviewScale = scale; lastPreviewFrame = frame;
    return { kind, scale, frame, warped: true };
  },
};
const windowStub = {
  BabyAnimalHeadWarp: warp,
  HOBUNJI_ATTACHMENT_RIG_PROFILES: { creatures: { grehlr: { chatheadFrame: canonical } } },
  devicePixelRatio: 1,
};
const image = { width: 32, height: 32 };
const state = {
  image, baseRecord: {},
  weights: { width: 4, height: 4 },
};
const ctx = {
  window: windowStub, state,
  $: id => elements.get(id),
  clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
  numberOr: (v, fallback) => Number.isFinite(Number(v)) ? Number(v) : fallback,
  headBounds: () => ({ minX: 1, minY: 1, maxX: 2, maxY: 2 }),
  sourceSize: () => ({ width: image.width, height: image.height }),
  requestDraw: () => { draws++; },
  checkpointHistory: () => { checkpoints++; },
  readPreviewRigs: () => ({}),
  normalizedRig: () => ({ enabled: true, pivot: { x: 0.5, y: 0.5 } }),
  applyRecord: record => { state.baseRecord = record || {}; elements.get('animalId').value = record?.id || ''; return record; },
  captureHistoryState: () => ({ basic: true }),
  historySignature: () => 'base',
  restoreHistoryState: snap => snap,
  updateStatus: () => { elements.get('status').textContent = 'Head rig ready.'; },
  drawGuides: () => {},
  rightShoulderSource: () => image,
  shoulderFrameShiftValue: () => .52,
  shoulderSeparatorRotationValue: () => 12,
  drawSeparatorSide: (_ctx, source, _width, _height, keepRight) => splitInputs.push({ source, keepRight }),
  splitLayerCanvases: () => { splitCalls++; return { left: image, right: image }; },

  draw: () => { elements.get('previewBadge').textContent = '0°'; },
  previewImageForAnimal: source => source,
  paintCtx: {
    save() {}, restore() {}, setLineDash() {}, strokeRect() { guides++; },
    set strokeStyle(_v) {}, set lineWidth(_v) {},
  },
  document: { createElement: tag => {
    assert.equal(tag, 'canvas');
    const canvas = { width: 0, height: 0 };
    canvas.getContext = () => ({ drawImage() {} });
    return canvas;
  }},
  WeakMap, Number, String, Math,
};
vm.runInNewContext(part10, ctx, { filename: 'author-part10.js' });
const slider = elements.get('babyHeadScale');
const label = elements.get('babyHeadScaleLabel');
ctx.draw();
assert.equal(slider.value, '132', 'new species inherits universal default');
assert.match(label.textContent, /inherited/);
ctx.applyRecord({ id: 'grehlr', headRig: { babyHeadScale: 1.35 } });
ctx.draw();
assert.equal(slider.value, '135', 'switching species loads its authored baby size');
assert.equal(ctx.normalizedRig().babyHeadScale, 1.35, 'export includes the per-species size');
assert.equal(ctx.captureHistoryState().babyHeadScale, 1.35);
listeners.get('babyHeadScale:pointerdown')[0]();
assert.equal(checkpoints, 1, 'slider begins an undoable edit');
slider.value = '145';
listeners.get('babyHeadScale:input')[0]();
ctx.draw();
assert.equal(ctx.normalizedRig().babyHeadScale, 1.45, 'slider updates exported head rig');
assert.match(label.textContent, /species override/);
assert(draws > 0, 'slider requests a live preview redraw');
assert.match(elements.get('previewBadge').textContent, /Baby 145%/, 'preview visibly labels enlarged result');
const first = ctx.previewImageForAnimal(image);
assert.equal(applied, 1, 'new scale produces exactly one rasterized preview');
assert.equal(lastPreviewScale, 1.45);
assert.equal(lastPreviewFrame.width, canonical.width, 'chathead box beats painted Head influence as alpha-mask source');
assert.equal(ctx.previewImageForAnimal(image), first, 'thousands of mesh triangles reuse one cached image');
assert.equal(applied, 1, 'no per-triangle recomposition');
const split = ctx.previewSplitLayerCanvases();
assert.equal(splitInputs.length, 2, 'each shoulder side is clipped after pixel enlargement');
assert.equal(splitInputs[0].source, first, 'left sprite is enlarged before the separator cuts it');
assert.equal(splitInputs[1].source, first, 'right sprite is enlarged before the separator cuts it');
assert.equal(ctx.previewImageForAnimal(split.left), split.left, 'clipped left sprite is not warped a second time');
assert.equal(ctx.previewImageForAnimal(split.right), split.right, 'clipped right sprite is not warped a second time');
assert.equal(ctx.previewSplitLayerCanvases(), split, 'prewarped split layers are cached across mesh redraws');
assert.equal(windowStub.__animalHeadRigBabyPreview.debugSnapshot().splitsAfterWarp, 1);

listeners.get('babyHeadCompare:click')[0]();
ctx.draw();
assert.equal(ctx.previewImageForAnimal(image), image, 'original comparison never deforms source');
assert.equal(ctx.previewSplitLayerCanvases().left, image, 'original comparison uses original shoulder split');
assert.equal(splitCalls, 1, 'original compare takes the regular unwarped split path');
assert.match(elements.get('babyHeadPreviewState').textContent, /Showing original/);
assert.equal(ctx.normalizedRig().babyHeadScale, 1.45, 'comparison does not mutate authored scale');
listeners.get('babyHeadCompare:click')[0]();
ctx.draw();
assert.equal(ctx.previewImageForAnimal(image), first, 'switching back immediately restores cached enlarged preview');
ctx.drawGuides({ x: 0, y: 0, width: 100, height: 100 });
assert.equal(guides, 1, 'source canvas outlines the actual head frame as a guide only');
ctx.restoreHistoryState({ basic: true, babyHeadScale: 1.35 });
ctx.draw();
assert.equal(slider.value, '135', 'undo restores the slider');
ctx.applyRecord({ id: 'custom-pet', headRig: {} });
ctx.draw();
assert.equal(slider.value, '132', 'switching species does not leak another animal setting');
assert.equal(ctx.normalizedRig().babyHeadScale, undefined, 'untouched species remains unconfigured');
slider.value = '140';
listeners.get('babyHeadScale:input')[0]();
ctx.draw();
assert.equal(ctx.normalizedRig().babyHeadScale, 1.4);
assert.equal(ctx.normalizedRig().babyHeadFrame.coordinateSpace, 'sprite-normalized-top-left', 'custom animals export painted head frame for runtime');
assert.match(elements.get('babyHeadPreviewState').textContent, /painted Head influence/);
assert.notEqual(ctx.previewImageForAnimal(image), image, 'a custom animal with painted head weights is previewable');
state.weights = null;
ctx.draw();
assert.match(elements.get('babyHeadPreviewState').textContent, /No head frame/, 'missing frames are explicitly reported instead of silently failing');
ctx.updateStatus();
assert.match(elements.get('status').textContent, /missing frame/, 'status is readable on mobile');
assert.equal(windowStub.__animalHeadRigBabyPreview.debugSnapshot().explicit, true);
console.log('Rigger slider discoverability, live comparison, painted-head fallback, undo, export and cache passed.');
