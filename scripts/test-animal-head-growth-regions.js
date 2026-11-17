'use strict';
// Production module integration: per-species growth boxes and shoulder-pose copying on mobile.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const runtimeCode = fs.readFileSync('docs/js/baby-animal-head-warp.js', 'utf8');
const editorCode = fs.readFileSync('docs/tools/animal-head-rig/author-part11.js', 'utf8');
const html = fs.readFileSync('docs/tools/animal-head-rig/index.html', 'utf8');
const index = fs.readFileSync('docs/index.html', 'utf8');
const bridge = fs.readFileSync('docs/js/player-body-attachment-bridge.js', 'utf8');
const editorPreview = fs.readFileSync('docs/tools/animal-head-rig/author-part10.js', 'utf8');

const frame = (x, y, width, height) => ({ x, y, width, height,
  coordinateSpace: 'sprite-normalized-top-left' });
const custom = frame(.10, .12, .30, .28);
const abdomen = frame(.55, .45, .30, .30);
const portrait = frame(.25, .15, .20, .20);
const saved = new Map(); // Same localStorage key that the game and painter share.
const storage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) };
saved.set('hobunji_animal_head_rigs_v1', JSON.stringify({ grehlr: {
  babyHeadUseCustomFrame: true, babyHeadCustomFrame: custom,
  babyAbdomenEnabled: true, babyAbdomenFrame: abdomen, babyAbdomenScale: 1.45,
}}));
const width = 41, height = 41;
const pixels = new Uint8ClampedArray(width * height * 4);
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  const i = (y * width + x) * 4;
  pixels[i] = x * 5; pixels[i + 1] = y * 5; pixels[i + 3] = 255;
}
const at = (bytes, x, y, channel = 0) => bytes[(y * width + x) * 4 + channel];
const runtimeWindow = { localStorage: storage,
  HOBUNJI_ATTACHMENT_RIG_PROFILES: { creatures: { grehlr: { chatheadFrame: portrait } } } };
const runtimeDoc = { createElement(tag) {
  assert.equal(tag, 'canvas');
  const output = { width: 0, height: 0, bytes: null };
  output.getContext = () => ({
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: image => { output.bytes = image.data; },
  });
  return output;
} };
vm.runInNewContext(runtimeCode, { window: runtimeWindow, document: runtimeDoc, Uint8ClampedArray, Float32Array });
const warp = runtimeWindow.BabyAnimalHeadWarp;
assert.deepEqual({ ...warp.frameForKind('grehlr') }, custom, 'custom head-growth box replaces the dialogue portrait');
assert.equal(warp.abdomenForKind('grehlr').scale, 1.45, 'abdomen has its own growth strength');
assert.equal(warp.abdomenForKind('grehlr').enabled, true);
const canvas = { width, height, getContext: () => ({ getImageData: () => ({ data: pixels }) }) };
const abdomenOnly = warp.applyToCanvas(canvas, 'grehlr', 1, null, 0, false);
assert(abdomenOnly.bytes, 'abdomen-only growth works even without any head-mask preparation');
assert(at(abdomenOnly.bytes, 32, 25) < at(pixels, 32, 25), 'abdomen pixels are enlarged around their own center');
assert.equal(at(abdomenOnly.bytes, 6, 12), at(pixels, 6, 12), 'independent abdomen growth does not move the head');
assert.equal(at(abdomenOnly.bytes, 0, 0), at(pixels, 0, 0), 'distant body art stays unchanged');
assert.equal(warp.primeIdleMask('grehlr', { width, height, data: pixels }, custom)?.opaquePixels > 0, true,
  'an explicitly drawn head box still uses the established idle-alpha mask by default');
const both = warp.applyToCanvas(canvas, 'grehlr');
assert(both.bytes && both.bytes.some((value, index) => value !== pixels[index]),
  'head and abdomen deform the same fully composited texture without modifying the input');
assert.deepEqual([...pixels.slice(0, 4)], [0, 0, 0, 255], 'source pixels are never mutated');

saved.set('hobunji_animal_head_rigs_v1', JSON.stringify({ grehlr: {
  babyHeadUseCustomFrame: false, babyHeadCustomFrame: custom,
  babyAbdomenEnabled: false, babyAbdomenFrame: abdomen, babyAbdomenScale: 1.45,
}}));
assert.equal(warp.frameForKind('grehlr').x, portrait.x, 'disabling custom head restores portrait selection');
assert.equal(warp.applyToCanvas(canvas, 'grehlr', 1, null, 0), canvas,
  'disabling abdomen and setting neutral head transforms preserves source without new allocation');
saved.set('hobunji_animal_head_rigs_v1', JSON.stringify({ grehlr: {
  babyHeadUseCustomFrame: true, babyHeadCustomFrame: { ...custom, width: -1 },
  babyAbdomenEnabled: true, babyAbdomenFrame: { ...abdomen, x: .95 }, babyAbdomenScale: 999,
}}));
assert.equal(warp.frameForKind('grehlr').x, portrait.x, 'invalid custom frame cannot corrupt head selection');
assert.equal(warp.abdomenForKind('grehlr').enabled, false, 'invalid abdomen coordinates cannot deform the sprite');
assert.equal(warp.abdomenForKind('grehlr').scale, warp.MAX_ABDOMEN_SCALE, 'abdomen scale clamps to a safe maximum');

const callbacks = new Map(); // Real editor pointer event interception, no browser console required.
const controls = new Map(); // Test DOM fixtures for both optional selection boxes and shoulder copying.
function control(id) {
  if (controls.has(id)) return controls.get(id);
  const handlers = new Map();
  const elem = {
    id, value: '', checked: false, disabled: false, options: [], textContent: '', handlers,
    classList: { toggle() {} }, setAttribute() {},
    addEventListener: (type, fn) => handlers.set(type, fn),
    appendChild(option) { this.options.push(option); },
    set innerHTML(text) { this._html = text; this.options = text.includes('<option') ? [{ value: '' }] : []; },
    get innerHTML() { return this._html; },
  };
  controls.set(id, elem);
  return elem;
}
for (const id of ['animalId', 'babyHeadUseCustomFrame', 'babyHeadDrawCustom', 'babyHeadClearCustom',
  'babyHeadCustomFrameStatus', 'babyAbdomenEnabled', 'babyAbdomenScale', 'babyAbdomenScaleLabel',
  'babyHeadDrawAbdomen', 'babyHeadClearAbdomen', 'babyAbdomenFrameStatus', 'shoulderCopySource',
  'shoulderCopyFromSpecies', 'shoulderCopyStatus']) control(id);
let captured = 0, released = 0, checkpoints = 0, previews = 0;
let currentShoulder = { useSpline: false, splitFrame: false };
let hasBaseHeadRig = true; // Toggling this simulates a species with no painted neck rig or shoulder pose.
const targetHeadPaint = { retained: 'specific grehlr head pattern' };
const state = { image: { width: 100, height: 100 }, baseRecord: {}, selectRecords: [] };
const paintCanvas = { setPointerCapture: () => captured++, releasePointerCapture: () => released++ };
const sourceShoulder = { enabled: true, useSpline: true, useRun1: false, splitFrame: true,
  splitRightUsesIdle: false, followFrameShiftX: false, frameShiftX: .47,
  separatorRotationDeg: -35, beforePoints: [{ x: .2, y: .3 }], afterPoints: [{ x: .6, y: .8 }],
  weightMap: { width: 2, height: 2, encoding: 'rle-u9', data: [4, 255] },
  compressibilityMap: { width: 2, height: 2, encoding: 'rle-u9', data: [4, 120] },
  stretchabilityMap: { width: 2, height: 2, encoding: 'rle-u9', data: [4, 110] } };
const appWindow = { BabyAnimalHeadWarp: warp, devicePixelRatio: 1,
  addEventListener: (name, fn) => callbacks.set(name, fn),
  HobunjiAuthoredAnimalHeadRigs: { get: id => id === 'moot' ? { shoulderRest: sourceShoulder } : null },
};
const context = {
  window: appWindow, document: { getElementById: control, createElement: () => ({ value: '', textContent: '' }) },
  $: control, state, paintCanvas,
  clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
  numberOr: (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback,
  readPreviewRigs: () => ({}), requestDraw: () => previews++,
  applyShoulderRestConfig: raw => { currentShoulder = JSON.parse(JSON.stringify(raw)); },
  updateShoulderUi: () => {}, checkpointHistory: () => checkpoints++,
  setStatus: () => {}, sourceSize: () => ({ width: 100, height: 100 }),
  pointerToSource: event => event.point, deepClone: value => JSON.parse(JSON.stringify(value)),
  splineAllowedForCurrentSpecies: () => true, shoulderProfileApi: { species: ['moot', 'grehlr'] },
  drawGuides: () => {},
  applyRecord(record) { state.baseRecord = record; control('animalId').value = record.id; },
  normalizedRig: () => hasBaseHeadRig ? { headPaint: targetHeadPaint, shoulderRest: currentShoulder } : null,
  captureHistoryState: () => ({ original: true }),
  historySignature: () => 'original', restoreHistoryState: () => {},
  resolveBabyPreviewFrame: () => ({ frame: portrait, source: 'portrait' }),
  populateAnimalSelect: records => { state.selectRecords = records; },
  comparingBabyOriginal: false,
};
vm.createContext(context);
vm.runInContext(editorCode, context, { filename: 'author-part11.js' });
context.applyRecord({ id: 'grehlr' });
const source = control('shoulderCopySource');
assert(source.options.some(option => option.value === 'moot'), 'source dropdown includes authored source species');
assert(!source.options.some(option => option.value === 'grehlr'), 'source dropdown excludes current destination');
source.value = 'moot';
source.handlers.get('change')();
control('shoulderCopyFromSpecies').handlers.get('click')();
assert.deepEqual(currentShoulder, sourceShoulder, 'copy imports all shoulder booleans, spline points, maps and separator angle');
assert.strictEqual(context.normalizedRig().headPaint, targetHeadPaint, 'copy does not replace destination head paint');
assert.match(control('shoulderCopyStatus').textContent, /Copied complete shoulder pose/);
assert.equal(checkpoints, 1, 'copying is a single undoable edit');

function fire(type, x, y) {
  const event = { target: paintCanvas, pointerId: 7, button: 0, point: { x, y },
    prevented: false, stopped: false, preventDefault() { this.prevented = true; },
    stopImmediatePropagation() { this.stopped = true; } };
  callbacks.get(type)(event);
  return event;
}
control('babyHeadDrawCustom').handlers.get('click')();
assert.equal(fire('pointerdown', 10, 12).stopped, true, 'box drag intercepts head painting at capture time');
fire('pointermove', 40, 46);
fire('pointerup', 40, 46);
assert.equal(context.normalizedRig().babyHeadUseCustomFrame, true, 'custom head box exports as an opt-in selection');
assert.equal(context.normalizedRig().babyHeadCustomFrame.width.toFixed(2), '0.30');
assert.match(context.resolveBabyPreviewFrame().source, /custom drawn head box/);
control('babyHeadDrawAbdomen').handlers.get('click')();
fire('pointerdown', 48, 52);
fire('pointermove', 85, 80);
fire('pointerup', 85, 80);
assert.equal(context.normalizedRig().babyAbdomenEnabled, true);
assert.equal(context.normalizedRig().babyAbdomenScale, 1.2);
assert.equal(appWindow.__animalRigGrowthRegions.previewAbdomen().frame.height.toFixed(2), '0.28');
assert.equal(captured, 2, 'each touch region captures its pointer');
assert.equal(released, 2, 'each touch region releases the pointer');
assert.equal(checkpoints, 3, 'each drag is independently undoable');
const old = context.captureHistoryState();
control('babyAbdomenScale').value = '160';
control('babyAbdomenScale').handlers.get('input')();
assert.equal(context.normalizedRig().babyAbdomenScale, 1.6);
context.restoreHistoryState(old);
assert.equal(context.normalizedRig().babyAbdomenScale, 1.2, 'undo restores abdomen percentage');
hasBaseHeadRig = false;
const standaloneGrowth = context.normalizedRig(); // Growth regions do not require fake neck motion to be exported.
assert(standaloneGrowth && standaloneGrowth.weightMap && standaloneGrowth.babyAbdomenEnabled,
  'head and abdomen boxes remain exportable without painted Head Influence or shoulder presentation');
assert.equal(standaloneGrowth.shoulderRest, undefined, 'region-only neutral rig cannot invent a shoulder pose');
assert.deepEqual([...standaloneGrowth.weightMap.data], [4, 0], 'neutral weight map leaves adult neck motion unchanged');
hasBaseHeadRig = true;
control('babyHeadClearAbdomen').handlers.get('click')();
assert.equal(context.normalizedRig().babyAbdomenEnabled, false);
assert.equal(context.normalizedRig().babyHeadUseCustomFrame, true, 'clearing abdomen never clears custom head');
assert(previews > 0);
assert(html.includes('id="shoulderCopySource"') && html.includes('id="babyHeadDrawCustom"')
  && html.includes('id="babyHeadDrawAbdomen"'), 'the full interface is accessible without devtools');
assert(/author-part11\.js\?v=[A-Za-z0-9_-]+/.test(html)
  && /baby-animal-head-warp\.js\?v=[A-Za-z0-9_-]+/.test(html),
  'the painter loads the new editor module and a versioned runtime');
assert(/baby-animal-head-warp\.js\?v=[A-Za-z0-9_-]+/.test(index),
  'the live game uses a versioned growth implementation');
assert(bridge.includes('warp?.abdomenForKind?.(kind)'), 'small shoulder-pet frame key includes abdomen configuration');
assert(editorPreview.includes('previewAbdomen'), 'post-composition editor preview includes optional abdomen growth');
console.log('PASS: shared growth regions, shoulder pose copy, touch box drawing, export, undo and runtime cache keys');
