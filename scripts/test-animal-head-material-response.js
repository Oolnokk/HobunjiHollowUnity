'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

global.window = global;
require(path.resolve(__dirname, '../docs/js/animal-head-material-response.js'));

const api = global.AnimalHeadMaterialResponse;
assert(api, 'AnimalHeadMaterialResponse should install on window/global');

const influence = api.decodeWeightMap({ width: 2, height: 2, encoding: 'rle-u9', data: [1, 0, 1, 128, 1, 255, 1, 256] });
assert(influence, 'Influence RLE should decode');
assert.strictEqual(api.sampleInfluenceMap(influence, 0, 0), 0);
assert.strictEqual(api.sampleInfluenceMap(influence, 1, 0), 128 / 255);
assert.strictEqual(api.sampleInfluenceMap(influence, 1, 1), 0, 'unset Influence remains body weight 0');

const material = api.decodeWeightMap({ width: 2, height: 2, encoding: 'rle-u9', data: [1, 256, 1, 64, 1, 255, 1, 256] });
assert(material, 'Material RLE should decode');
assert.strictEqual(api.sampleMaterialMap(null, influence, 0.5, 0.5, 0.35), 0.35, 'missing material map inherits the exact mesh Influence weight');
assert.strictEqual(api.sampleMaterialMap(material, influence, 0, 0, 0), 0, 'unset material cell inherits Influence at that cell');
assert(api.sampleMaterialMap(material, influence, 1, 0, 128 / 255) <= 128 / 255, 'material override may never exceed Influence');
assert.strictEqual(api.sampleMaterialMap(material, influence, 0, 1, 1), 1, '255 override is capped by the local full Influence weight');

assert.strictEqual(api.responseKindForVertex(20, 0.7, 0.5), 'stretch', 'downward bend stretches the sprite side below the pivot');
assert.strictEqual(api.responseKindForVertex(20, 0.3, 0.5), 'compress', 'downward bend compresses the sprite side above the pivot');
assert.strictEqual(api.responseKindForVertex(-20, 0.3, 0.5), 'stretch', 'upward bend stretches the sprite side above the pivot');
assert.strictEqual(api.responseKindForVertex(-20, 0.7, 0.5), 'compress', 'upward bend compresses the sprite side below the pivot');
assert.strictEqual(api.responseKindForVertex(0, 0.7, 0.5), 'neutral');

assert.strictEqual(api.materialWeightForBend(0.5, 0.2, 0.4, 'compress'), 0.2);
assert.strictEqual(api.materialWeightForBend(0.5, 0.2, 0.4, 'stretch'), 0.4);
assert.strictEqual(api.materialWeightForBend(0.5, 0.2, 0.4, 'neutral'), 0.5);
assert.strictEqual(api.materialWeightForBend(0.5, 0.9, 0.9, 'compress'), 0.5, 'material channel is reduction-only and cannot exceed Influence');
assert.strictEqual(api.materialWeightForPose(0.5, 0.2, 0.35, 'neutral', 20), 0.35, 'positive yaw is capped by Stretchability');
assert.strictEqual(api.materialWeightForPose(0.5, 0.2, 0.35, 'neutral', -20), 0.35, 'negative yaw uses the same Stretchability cap');
assert.strictEqual(api.materialWeightForPose(0.5, 0.2, 0.35, 'compress', 20), 0.2, 'simultaneous pitch/yaw uses whichever material reduction is stricter');
assert.strictEqual(api.materialWeightForPose(0.5, 0.2, 0.35, 'neutral', 0), 0.5, 'zero yaw leaves neutral pitch at Influence');

const runtimeSource = fs.readFileSync(path.resolve(__dirname, '../docs/js/animal-head-material-response.js'), 'utf8');
assert(runtimeSource.includes("wrapAfter('updateHeadYaw')"), 'runtime refreshes Stretchability after yaw updates');
assert(runtimeSource.includes('const yawActive = Math.abs'), 'yaw material response is sign-independent so both turn directions use Stretchability');

const riggerDir = path.resolve(__dirname, '../docs/tools/animal-head-rig');
const shell = fs.readFileSync(path.join(riggerDir, 'index.html'), 'utf8');
const author = [1, 2, 3, 4, 5, 6, 7].map(n => fs.readFileSync(path.join(riggerDir, `author-part${n}.js`), 'utf8')).join('\n');
assert(shell.includes('id="paintCanvas"') && shell.includes('id="previewCanvas"'), 'rigger should expose persistent stacked paint + preview canvases');
assert(!shell.includes('previewDeform'), 'preview checkbox should be removed');
assert(shell.includes('id="brushStrength"'), 'Influence/material brush strength control should be visible');
for (let n = 1; n <= 7; n++) assert(shell.includes(`src="./author-part${n}.js"`), `rigger shell should directly load author-part${n}.js`);
assert(shell.includes('position:sticky') && shell.includes('height:calc(100dvh - 24px)') && shell.includes('.preview-settings{min-height:0;overflow:auto'), 'right-side draw/preview workbench should remain viewport-bounded while only its settings scroll');
assert(shell.includes('id="shoulderRestUseSpline"') && shell.includes('id="shoulderRestUseRun1"'), 'spline deformation and run1 stance should be independently controllable');
assert(shell.includes('id="shoulderRestSplitFrame"') && shell.includes('id="shoulderFrameShift"'), 'idle/run1 fusion should expose an X seam slider');
assert(shell.includes('id="shoulderFullRotation"') && shell.includes('id="shoulderInterRotation"'), 'shoulder spline should expose whole-strip and inter-vertex rotation sliders');
assert(author.includes("shoulderGuide={a:{x:.14,y:.46},b:{x:.86,y:.46}}"), 'shoulder spline should own independent A/B guide endpoints');
assert(author.includes('fullRotationDeg:shoulderFullRotationValue()') && author.includes('interVertexRotationDeg:shoulderInterRotationValue()'), 'shoulder curl values should serialize into the rig');
assert(author.includes('rig.shoulderRest.curveFalloff=shoulderCurveFalloffValue()'), 'curve falloff should serialize into the shoulder rig');
assert(author.includes('Curve falloff toward B'), 'curve falloff authoring control should be inserted under the curl controls');
assert(author.includes('Stretchability also limits yaw head turns in either direction.'), 'rigger help should document yaw using the Stretchability paint');
assert(author.includes('previewAngle is deliberately not serialized'), 'preview neck angle should remain a preview-only value');
assert(author.includes("state.compressibility.values[index]=UNSET") && author.includes("state.stretchability.values[index]=UNSET"), 'Influence edits should reset both material channels to inherit the new Influence');
assert(author.includes('lerp(current,0,amount)'), 'material brush should only reduce the selected material channel');
assert(author.includes('lerp(current,base,amount)'), 'material restore should move the selected material channel back toward Influence');
assert(author.includes("$('toolEraser').textContent=material?'Toward Influence':'Eraser'"), 'material eraser should become Toward Influence');
assert(author.includes("paintCanvas.addEventListener('pointermove'") && !author.includes("previewCanvas.addEventListener('pointer"), 'only the undeformed paint canvas should accept painting input');
assert(author.includes('requestAnimationFrame(draw)'), 'live preview redraw should be frame-coalesced during brush drags');

console.log('animal-head-material-response: all tests passed');
console.log('animal-head-rigger-workflow: all tests passed');

const vm = require('vm');
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
  const defaults = { brushStrength: '100', brushRadius: '40', bucketTolerance: '32', expandRadius: '60', previewAngle: '0', minDeg: '-30', restDeg: '0', maxDeg: '30', turnSpeedDeg: '120', meshResolution: '48', spriteAspect: '1', modelWidth: '1', tint: '#ffffff', extraVars: '{}', facing: 'left', shoulderFrameShift: '50', shoulderFullRotation: '0', shoulderInterRotation: '0', shoulderCurveFalloff: '0' };
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
authorContext.window.AnimalShoulderRest = { legacyBendRotations: bend => ({ fullRotationDeg: Math.atan(4 * Number(bend || 0)) * 180 / Math.PI, interVertexRotationDeg: -2 * Math.atan(4 * Number(bend || 0)) * 180 / Math.PI }) };
vm.createContext(authorContext);
for (let n = 1; n <= 7; n++) vm.runInContext(fs.readFileSync(path.join(riggerDir, `author-part${n}.js`), 'utf8'), authorContext, { filename: `author-part${n}.js` });
vm.runInContext(`
  state.weights={width:1,height:1,values:new Uint16Array([0])};
  state.compressibility=blankMap(1,1); state.stretchability=blankMap(1,1);
  document.getElementById('brushStrength').value='50'; state.paintLayer='influence'; state.target='head';
  applyPaintAtIndex(0,false);
`, authorContext);
assert.strictEqual(vm.runInContext('state.weights.values[0]', authorContext), 128, '50% Influence brush should move 0 halfway toward Head');
assert.strictEqual(vm.runInContext('state.compressibility.values[0]', authorContext), 256, 'Influence edit should reset compression to inherit');
assert.strictEqual(vm.runInContext('state.stretchability.values[0]', authorContext), 256, 'Influence edit should reset stretch to inherit');
vm.runInContext(`state.paintLayer='compressibility'; applyPaintAtIndex(0,false);`, authorContext);
assert.strictEqual(vm.runInContext('state.compressibility.values[0]', authorContext), 64, '50% compression reduction should halve inherited 128 weight');
assert.strictEqual(vm.runInContext('state.stretchability.values[0]', authorContext), 256, 'compression reduction must not touch stretch');
vm.runInContext(`applyPaintAtIndex(0,true);`, authorContext);
assert.strictEqual(vm.runInContext('state.compressibility.values[0]', authorContext), 96, '50% Toward Influence should move 64 halfway back to 128');
vm.runInContext(`document.getElementById('brushStrength').value='100'; applyPaintAtIndex(0,true);`, authorContext);
assert.strictEqual(vm.runInContext('state.compressibility.values[0]', authorContext), 256, '100% Toward Influence should restore inheritance');
vm.runInContext(`document.getElementById('previewAngle').value='37'; setPaintLayer('stretchability'); undoEdit();`, authorContext);
assert.strictEqual(fakeElement('previewAngle').value, '37', 'authoring operations must not reset preview angle');
console.log('animal-head-rigger-vm: all tests passed');
