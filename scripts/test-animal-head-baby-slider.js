// Ensures the head-rigger slider edits individual animal rigs without moving paint coordinates.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const editor = fs.readFileSync('docs/tools/animal-head-rig/index.html', 'utf8');
const part1 = fs.readFileSync('docs/tools/animal-head-rig/author-part1.js', 'utf8');
const part3 = fs.readFileSync('docs/tools/animal-head-rig/author-part3.js', 'utf8');
const part6 = fs.readFileSync('docs/tools/animal-head-rig/author-part6.js', 'utf8');
const part10 = fs.readFileSync('docs/tools/animal-head-rig/author-part10.js', 'utf8');
assert(editor.includes('id="babyHeadScale" type="range" min="100" max="145"'), 'mobile slider supports 100–145%');
assert(editor.indexOf('attachment-rig-profiles.js') < editor.indexOf('baby-animal-head-warp.js'), 'authored chathead boxes load before baby warp');
assert(editor.indexOf('author-part10.js') > editor.indexOf('author-part9.js'), 'authoring extension loads after existing shoulder handlers');
assert(part1.includes('let previewImageForAnimal = image => image'), 'preview renderer stays safe before final part loads');
assert(part3.includes('drawImage(previewImageForAnimal(state.image)'), 'ordinary neck deformation uses baby preview texture');
assert(part6.includes('drawImage(previewImageForAnimal(image)'), 'shoulder-spline/split-frame preview uses baby texture too');
assert(!part3.includes('paintCtx.drawImage(previewImageForAnimal('), 'the paint surface never receives enlargement');
assert(!part6.includes('paintCtx.drawImage(previewImageForAnimal('), 'shoulder paint still uses unwarped source');

const listeners = new Map();
const elements = new Map();
for (const id of ['babyHeadScale', 'babyHeadScaleLabel', 'animalId', 'status']) {
  const control = { value: '', textContent: '', addEventListener(event, fn) {
    const key = id + ':' + event;
    listeners.set(key, [...(listeners.get(key) || []), fn]);
  }};
  elements.set(id, control);
}
let draws = 0, checkpoints = 0, applied = 0;
let lastPreviewScale = null;
const frame = { x: 0.2, y: 0.2, width: 0.3, height: 0.3 };
const warp = {
  getScale: () => 1.22,
  MAX_SCALE: 1.45,
  frameForKind: kind => kind === 'grehlr' ? frame : null,
  applyToCanvas: (_source, kind, scale) => {
    applied++;
    lastPreviewScale = scale;
    return { kind, scale, warped: true };
  },
};
const windowStub = { BabyAnimalHeadWarp: warp };
const ctx = {
  window: windowStub,
  $: id => elements.get(id),
  clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
  requestDraw: () => { draws++; },
  checkpointHistory: () => { checkpoints++; },
  readPreviewRigs: () => ({}),
  normalizedRig: () => ({ enabled: true, pivot: { x: 0.5, y: 0.5 } }),
  applyRecord: record => { elements.get('animalId').value = record?.id || ''; return record; },
  captureHistoryState: () => ({ basic: true }),
  historySignature: () => 'base',
  restoreHistoryState: snap => snap,
  updateStatus: () => { elements.get('status').textContent = 'Head rig ready.'; },
  previewImageForAnimal: image => image,
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
assert.equal(slider.value, '122', 'new/unknown species inherits global default');
assert.match(label.textContent, /inherited/);
ctx.applyRecord({ id: 'grehlr', headRig: { babyHeadScale: 1.35 } });
assert.equal(slider.value, '135', 'switching to a species restores its authored head size');
assert.equal(ctx.normalizedRig().babyHeadScale, 1.35, 'export contains the species-specific head scale');
assert.equal(ctx.captureHistoryState().babyHeadScale, 1.35);
listeners.get('babyHeadScale:pointerdown')[0]();
assert.equal(checkpoints, 1, 'one undo snapshot is taken at pointerdown');
slider.value = '140';
listeners.get('babyHeadScale:input')[0]();
assert.equal(ctx.normalizedRig().babyHeadScale, 1.4, 'slider updates exported head rig');
assert.equal(slider.value, '140');
assert.match(label.textContent, /species override/);
assert(draws > 0, 'slider queues a live preview redraw');
const source = { width: 32, height: 32 };
const first = ctx.previewImageForAnimal(source);
assert.equal(applied, 1, 'one native pixel warp is done for a new scale');
assert.equal(lastPreviewScale, 1.4, 'preview uses the slider, not a global preference');
assert.equal(ctx.previewImageForAnimal(source), first, 'mesh triangles reuse one cached warped texture');
assert.equal(applied, 1, 'no per-triangle recompositions');
ctx.restoreHistoryState({ basic: true, babyHeadScale: 1.35 });
assert.equal(slider.value, '135', 'undo restores the slider');
assert.equal(ctx.normalizedRig().babyHeadScale, 1.35);
ctx.applyRecord({ id: 'new-species', headRig: {} });
assert.equal(slider.value, '122', 'switching species does not carry an earlier override');
assert.equal(ctx.normalizedRig().babyHeadScale, undefined, 'untouched species does not gain an authored override');
assert.equal(ctx.previewImageForAnimal(source), source, 'without a head box preview remains the original image');
ctx.updateStatus();
assert.match(elements.get('status').textContent, /no authored chathead frame/, 'unavailable framing is reported on screen');
assert.equal(windowStub.__animalHeadRigBabyPreview.debugSnapshot().explicit, false, 'mobile diagnostics expose inheritance state');
console.log('Per-species rigger slider, pixel-preview cache, undo, export and species switching passed.');
