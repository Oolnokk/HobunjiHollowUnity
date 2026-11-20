'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

global.window = global;
require(path.resolve(__dirname, '../docs/js/animal-head-material-response.js'));
const api = global.AnimalHeadMaterialResponse;
assert(api, 'AnimalHeadMaterialResponse should install on window/global');

const influence = api.decodeWeightMap({ width: 2, height: 2, encoding: 'rle-u9', data: [1, 0, 1, 128, 1, 255, 1, 256] });
assert(influence, 'Influence RLE should decode');
assert.equal(api.sampleInfluenceMap(influence, 0, 0), 0);
assert.equal(api.sampleInfluenceMap(influence, 1, 0), 128 / 255);
assert.equal(api.sampleInfluenceMap(influence, 1, 1), 0, 'unset Influence remains body weight 0');

const material = api.decodeWeightMap({ width: 2, height: 2, encoding: 'rle-u9', data: [1, 256, 1, 64, 1, 255, 1, 256] });
assert(material, 'Material RLE should decode');
assert.equal(api.sampleMaterialMap(null, influence, 0.5, 0.5, 0.35), 0.35, 'missing material map inherits exact Influence');
assert.equal(api.sampleMaterialMap(material, influence, 0, 0, 0), 0, 'unset material cell inherits Influence');
assert(api.sampleMaterialMap(material, influence, 1, 0, 128 / 255) <= 128 / 255, 'material override never exceeds Influence');
assert.equal(api.sampleMaterialMap(material, influence, 0, 1, 1), 1, '255 override is capped by local full Influence');

assert.equal(api.responseKindForVertex(20, 0.7, 0.5), 'stretch', 'downward bend stretches below pivot');
assert.equal(api.responseKindForVertex(20, 0.3, 0.5), 'compress', 'downward bend compresses above pivot');
assert.equal(api.responseKindForVertex(-20, 0.3, 0.5), 'stretch', 'upward bend stretches above pivot');
assert.equal(api.responseKindForVertex(-20, 0.7, 0.5), 'compress', 'upward bend compresses below pivot');
assert.equal(api.responseKindForVertex(0, 0.7, 0.5), 'neutral');

assert.equal(api.materialWeightForBend(0.5, 0.2, 0.4, 'compress'), 0.2);
assert.equal(api.materialWeightForBend(0.5, 0.2, 0.4, 'stretch'), 0.4);
assert.equal(api.materialWeightForBend(0.5, 0.2, 0.4, 'neutral'), 0.5);
assert.equal(api.materialWeightForBend(0.5, 0.9, 0.9, 'compress'), 0.5, 'material channel is reduction-only');
assert.equal(api.materialWeightForPose(0.5, 0.2, 0.35, 'neutral', 20), 0.5, 'positive yaw leaves pitch Influence unchanged');
assert.equal(api.materialWeightForPose(0.5, 0.2, 0.35, 'neutral', -20), 0.5, 'negative yaw also ignores Stretchability');
assert.equal(api.materialWeightForPose(0.5, 0.2, 0.35, 'compress', 20), 0.2, 'painted pitch compression survives simultaneous yaw');
assert.equal(api.materialWeightForPose(0.5, 0.2, 0.35, 'stretch', -20), 0.35, 'painted pitch stretch survives simultaneous yaw');
assert.equal(api.materialWeightForPose(0.5, 0.2, 0.35, 'neutral', 0), 0.5, 'neutral yaw leaves pitch Influence unchanged');

const runtimeSource = fs.readFileSync(path.resolve(__dirname, '../docs/js/animal-head-material-response.js'), 'utf8');
assert(runtimeSource.includes("wrapAfter('updateHeadYaw')"), 'runtime keeps mobile yaw diagnostics synchronized');
assert(runtimeSource.includes('yawFoldWeights') && runtimeSource.includes('geometry.userData?.hobunjiAnimalYawFold'), 'material response preserves a separate hinge without using material paint for yaw');
assert(!runtimeSource.includes('const yawActive = Math.abs'), 'no legacy yaw Stretchability response remains');

// Four-bone yaw fold: painted pitch may be irregular, but every vertex keeps the same flat hinge factor.
const makeFoldMesh = () => {
  const weights = new Float32Array([
    0, 0, .7, .3, // Pixel above neck: pitch Influence .3 and rigid yaw fold 1
    .3, .2, .3, .2, // Middle of the narrow crease: Influence .4, yaw fold .5
    .6, .4, 0, 0, // Pixel below neck: Influence .4, yaw fold 0
  ]);
  const uv = { count: 3, getX: i => [0, .5, 1][i], getY: i => [.95, .5, .05][i] };
  const attr = { array: weights, count: 3, itemSize: 4, needsUpdate: false, getY(i) { return weights[i * 4 + 1]; } };
  return { isSkinnedMesh: true, geometry: { userData: { hobunjiAnimalYawFold: true }, getAttribute: name => name === 'uv' ? uv : name === 'skinWeight' ? attr : null }, skeleton: { bones: [] }, attr };
};
const foldFront = makeFoldMesh(), foldBack = makeFoldMesh();
const pitchBone = {}, backPitchBone = {};
foldFront.skeleton.bones.push(pitchBone);
foldBack.skeleton.bones.push(backPitchBone);
const foldState = { frontHeadBone: pitchBone, backHeadBone: backPitchBone, appliedDeg: 0, currentYawDeg: 0, spritePivot: { y: .5 } };
const foldAvatar = {
  headRig: foldState, group: { children: [foldFront, foldBack], userData: {} },
  updateHeadYaw(yaw) { foldState.currentYawDeg = yaw; return yaw; },
  setHeadRotation(pitch) { foldState.appliedDeg = pitch; return pitch; },
};
api.decorateAvatar(foldAvatar, { pivot: { y: .5 }, compressibilityMap: { width: 1, height: 1, data: [32] }, stretchabilityMap: { width: 1, height: 1, data: [64] } });
assert.equal(foldAvatar.headMaterialResponse.yawMode, 'paper-fold');
const beforeYaw = Array.from(foldFront.attr.array);
foldFront.attr.needsUpdate = false;
foldAvatar.updateHeadYaw(20);
assert.deepEqual(Array.from(foldFront.attr.array), beforeYaw, 'yaw-only turns never mutate painted pitch skin weights');
assert.equal(foldFront.attr.needsUpdate, false, 'yaw-only frames avoid GPU skin-weight uploads');
foldAvatar.updateHeadYaw(-20);
assert.deepEqual(Array.from(foldFront.attr.array), beforeYaw, 'yaw folding is symmetric');
foldAvatar.setHeadRotation(20);
for (let i = 0; i < 3; i++) {
  const row = Array.from(foldFront.attr.array.slice(i * 4, i * 4 + 4));
  const foldFactor = row[2] + row[3];
  const expectedFold = [1, .5, 0][i];
  assert(Math.abs(foldFactor - expectedFold) < 1e-6, 'pitch repaint never changes paper-fold participation');
  assert(Math.abs(row.reduce((a, b) => a + b, 0) - 1) < 1e-6, 'all four bone weights remain normalized');
}
assert.deepEqual(Array.from(foldFront.attr.array), Array.from(foldBack.attr.array), 'both sprite faces preserve the same hinge weights');

const riggerDir = path.resolve(__dirname, '../docs/tools/animal-head-rig');
const shell = fs.readFileSync(path.join(riggerDir, 'index.html'), 'utf8');
const coreAuthor = [1, 2, 3, 4, 5].map(n => fs.readFileSync(path.join(riggerDir, `author-part${n}.js`), 'utf8')).join('\n');
const shoulderAuthor = fs.readFileSync(path.join(riggerDir, 'author-part6.js'), 'utf8');
const separatorAuthor = fs.readFileSync(path.join(riggerDir, 'author-part7.js'), 'utf8');
const broadAuthor = fs.readFileSync(path.join(riggerDir, 'author-part8.js'), 'utf8');
const twoPointAuthor = fs.readFileSync(path.join(riggerDir, 'author-part9.js'), 'utf8');
assert(shell.includes('id="paintCanvas"') && shell.includes('id="previewCanvas"'), 'persistent paint + preview canvases should exist');
assert(!shell.includes('previewDeform'), 'preview checkbox remains removed');
assert(shell.includes('id="brushStrength"'), 'brush strength remains visible');
for (let n = 1; n <= 9; n++) assert(shell.includes(`src="./author-part${n}.js"`) || shell.includes(`src="./author-part${n}.js?v=`), `shell loads author-part${n}.js`); // Cache-busted author scripts still count as loaded.
assert(shell.includes('position:sticky') && shell.includes('.preview-settings{min-height:0;overflow:auto'), 'right workbench remains sticky and settings scroll internally');
assert(shell.includes('Enable body spline') && shell.includes('BEFORE / Bind') && shell.includes('AFTER / Pose'),
  'current explicit BEFORE/AFTER shoulder workflow is visible');
assert(shell.includes('id="resetShoulderAfter"') && shell.includes('id="resetShoulderSpline"'),
  'AFTER-only identity reset and whole-rig reset are both exposed');
assert(shell.includes('id="shoulderSeparatorRotation"'), 'diagonal separator rotation control is present');
assert(shoulderAuthor.includes('SHOULDER_POINT_COUNT=7'));
assert(shoulderAuthor.includes('beforePoints:cloneShoulderPoints(shoulderBeforePoints') &&
  shoulderAuthor.includes('afterPoints:cloneShoulderPoints(shoulderAfterPoints'),
  'seven BEFORE and seven AFTER points serialize into shoulderRest');
assert(shoulderAuthor.includes('shoulderSplineApi?.normalizeRest'), 'legacy shoulder imports use the shared runtime normalizer');
assert(!shoulderAuthor.includes('previewAngle:'), 'preview neck angle is not serialized');
assert(shoulderAuthor.includes("shoulderFrameShift?.addEventListener('pointerdown',()=>checkpointHistory())"),
  'Frame shift begins an undo checkpoint before translating both spline lines');
assert(separatorAuthor.includes('separatorPointIsRight') &&
  separatorAuthor.includes('separatorRotationDeg=shoulderSeparatorRotationValue()'),
  'editor paint ownership and saved separator rotation use the shared diagonal-separator model');
assert(broadAuthor.includes('function effectiveShoulderAfterPoints()') &&
  broadAuthor.includes('rest.afterPoints=effectiveShoulderAfterPoints()'),
  'broad AFTER controls are additive editor macros whose effective curve is what preview/export receives');
assert(twoPointAuthor.includes('function setVisibleShoulderAfterEndpoint') &&
  twoPointAuthor.includes('version:2'),
  'two-point mode directly edits the real beginning/end AFTER vertices');
assert(!twoPointAuthor.includes('startDelta') && !twoPointAuthor.includes('endDelta'),
  'two-point mode does not hide an interpolated deformation layer across vertices 2-6');
assert(coreAuthor.includes('state.compressibility.values[index]=UNSET') && coreAuthor.includes('state.stretchability.values[index]=UNSET'), 'Influence edits reset both material channels to inherit');
assert(coreAuthor.includes('lerp(current,0,amount)'), 'material brush only reduces channel');
assert(coreAuthor.includes('lerp(current,base,amount)'), 'material restore moves back toward Influence');
assert(coreAuthor.includes("$('toolEraser').textContent=material?'Toward Influence':'Eraser'"), 'material eraser is Toward Influence');
assert(coreAuthor.includes("paintCanvas.addEventListener('pointermove'") && !coreAuthor.includes("previewCanvas.addEventListener('pointer"), 'only upper canvas accepts paint input');
assert(coreAuthor.includes('requestAnimationFrame(draw)'), 'brush redraw remains frame-coalesced');
assert(shell.includes('Yaw turns use a separate straight paper-fold hinge'), 'editor explains that yaw is independent of material maps');

// Exercise the paint core without loading the shoulder module; shoulder behavior has
// its own runtime regression and should not make material painting tests DOM-heavy.
const elements = new Map();
function fake2dContext() { return new Proxy({}, { get: (target, key) => target[key] || (() => {}), set: (target, key, value) => (target[key] = value, true) }); }
function fakeElement(id) {
  if (elements.has(id)) return elements.get(id);
  const el = {
    id, value: '', checked: false, disabled: false, textContent: '', className: '', dataset: {}, style: {}, files: [], parentElement: null,
    classList: { toggle() {}, add() {}, remove() {} }, addEventListener() {}, click() {}, appendChild() {}, remove() {}, select() {},
    getBoundingClientRect() { return { width: 400, height: 280, left: 0, top: 0 }; }, setPointerCapture() {}, releasePointerCapture() {},
  };
  if (id === 'paintCanvas' || id === 'previewCanvas') {
    el.width = 400; el.height = 280; el.getContext = () => fake2dContext(); el.parentElement = { getBoundingClientRect: () => ({ width: 400, height: 280 }) };
  }
  const defaults = { brushStrength: '100', brushRadius: '40', bucketTolerance: '32', expandRadius: '60', previewAngle: '0', minDeg: '-30', restDeg: '0', maxDeg: '30', turnSpeedDeg: '120', meshResolution: '48', spriteAspect: '1', modelWidth: '1', tint: '#ffffff', extraVars: '{}', facing: 'left' };
  if (id in defaults) el.value = defaults[id];
  if (id === 'showWeights') el.checked = true;
  elements.set(id, el);
  return el;
}
const fakeDocument = {
  getElementById: fakeElement,
  createElement(tag) { const el = fakeElement(`_${tag}_${elements.size}`); if (tag === 'canvas') { el.width = 1; el.height = 1; el.getContext = () => fake2dContext(); } return el; },
  body: { appendChild() {} }, execCommand() { return true; },
};
const authorContext = {
  console, window: null, document: fakeDocument,
  localStorage: { getItem() { return null; }, setItem() {} }, navigator: { clipboard: { writeText: async () => {} } },
  location: { href: 'https://example.test/tools/animal-head-rig/' }, URL, Blob, Uint16Array, Math, JSON, Number, Array, Set, Object, String,
  ResizeObserver: class { observe() {} }, requestAnimationFrame() {}, setTimeout() {}, clearTimeout() {}, Image: class {},
};
authorContext.window = authorContext;
authorContext.window.devicePixelRatio = 1;
authorContext.window.addEventListener = () => {};
authorContext.window.AnimalHeadMaterialResponse = { responseKindForVertex: (angle, v, pivot) => Math.abs(angle) < 1e-5 ? 'neutral' : angle * (v - pivot) > 0 ? 'stretch' : 'compress' };
vm.createContext(authorContext);
for (let n = 1; n <= 5; n++) vm.runInContext(fs.readFileSync(path.join(riggerDir, `author-part${n}.js`), 'utf8'), authorContext, { filename: `author-part${n}.js` });
vm.runInContext(`
  state.weights={width:1,height:1,values:new Uint16Array([0])};
  state.compressibility=blankMap(1,1); state.stretchability=blankMap(1,1);
  document.getElementById('brushStrength').value='50'; state.paintLayer='influence'; state.target='head';
  applyPaintAtIndex(0,false);
`, authorContext);
assert.equal(vm.runInContext('state.weights.values[0]', authorContext), 128, '50% Influence brush moves halfway toward Head');
assert.equal(vm.runInContext('state.compressibility.values[0]', authorContext), 256, 'Influence edit resets compression to inherit');
assert.equal(vm.runInContext('state.stretchability.values[0]', authorContext), 256, 'Influence edit resets stretch to inherit');
vm.runInContext(`state.paintLayer='compressibility'; applyPaintAtIndex(0,false);`, authorContext);
assert.equal(vm.runInContext('state.compressibility.values[0]', authorContext), 64, '50% compression reduction halves inherited 128 weight');
assert.equal(vm.runInContext('state.stretchability.values[0]', authorContext), 256, 'compression reduction does not touch stretch');
vm.runInContext(`applyPaintAtIndex(0,true);`, authorContext);
assert.equal(vm.runInContext('state.compressibility.values[0]', authorContext), 96, '50% Toward Influence moves 64 halfway to 128');
vm.runInContext(`document.getElementById('brushStrength').value='100'; applyPaintAtIndex(0,true);`, authorContext);
assert.equal(vm.runInContext('state.compressibility.values[0]', authorContext), 256, '100% Toward Influence restores inheritance');
vm.runInContext(`document.getElementById('previewAngle').value='37'; setPaintLayer('stretchability'); undoEdit();`, authorContext);
assert.equal(fakeElement('previewAngle').value, '37', 'authoring operations do not reset preview angle');

console.log('animal-head-material-response: all tests passed');
console.log('animal-head-rigger-core: all tests passed');
