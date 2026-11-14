const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('docs/js/character-scale-comparison-presentation.js', 'utf8');
const authorHtml = fs.readFileSync('docs/tools/animation-author/index.html', 'utf8'); // Framing needs the real editor's OrbitControls pivot, not a second camera owner.
const appended = [];
const document = {
  body: { dataset: {} },
  head: { appendChild(node) { appended.push(node); } },
  activeElement: null,
  getElementById() { return null; },
  createElement(tag) { return { tagName: tag.toUpperCase(), style: {}, set id(value) { this._id = value; }, get id() { return this._id; } }; },
};
const window = { addEventListener() {} };
const context = vm.createContext({
  window,
  document,
  location: { pathname: '/tools/animation-author/index.html' },
  setInterval() { return 1; },
  setTimeout(fn) { fn(); return 1; },
  queueMicrotask(fn) { fn(); },
  console,
  Set,
  Map,
  Promise,
  Number,
  Math,
  Object,
  String,
});
vm.runInContext(source, context, { filename: 'character-scale-comparison-presentation.js' });

const api = window.HobunjiFullScaleEditorPresentation;
assert(api, 'presentation adapter must expose its diagnostic/test API');
assert(Math.abs(api.rawHeadPercentFromRuntime(1.02, 1) - 102) < 1e-9, 'Mao-ao male 1.02 head over 1.00 portrait scale should display as 102% of raw PNG');
assert(Math.abs(api.rawHeadPercentFromRuntime(1.085, 0.75) - 81.375) < 1e-9, 'Kenkari male head should include its 75% portrait-plane scale');
assert(Math.abs(api.rawHeadPercentFromRuntime(1.01, 1.18) - 119.18) < 1e-9, 'Mashtzarr male head should include its 118% portrait-plane scale');
assert(Math.abs(api.runtimeHeadPercentFromRaw(81.375, 0.75) - 108.5) < 1e-9, 'raw-PNG percentage must round-trip to the existing runtime headScale percent');
const bounds = api.rawHeadBounds(0.75);
assert(Math.abs(bounds.min - 7.5) < 1e-9 && Math.abs(bounds.max - 300) < 1e-9, 'raw head bounds must map the runtime 10%-400% limits through portrait scale');
assert(Math.abs(api.pinchZoomFromDistances(1, 100, 150) - 1.5) < 1e-9, 'pinch spreading must zoom the orthographic camera in');
assert(Math.abs(api.pinchZoomFromDistances(2, 200, 100) - 1) < 1e-9, 'pinch closing must zoom the orthographic camera out');
assert.strictEqual(api.pinchZoomFromDistances(1, 100, 5000), 6, 'pinch zoom must respect the configured maximum');
assert.match(source, /position:fixed!important/);
assert.match(source, /max-height:calc\(100dvh/, 'dynamic mobile viewport height must keep the moved Longoran hunch controls scrollable');
assert.match(source, /right:max\(10px,env\(safe-area-inset-right\)\)!important/);
assert.match(source, /camera\.isPerspectiveCamera = false/);
assert.match(source, /camera\.isOrthographicCamera = true/);
assert.match(source, /projectionMatrix\.makeOrthographic/);
assert.match(source, /camera.zoom = pinchZoomFromDistances/);
assert.match(authorHtml, /getCameraControls\(\) \{ return state\.three\.controls; \}/, 'backdrop exposes its actual OrbitControls pivot to comparison framing');
assert.match(source, /state\.controls\?\.target\?\.set\?\./, 'explicit focus must update the OrbitControls target');
assert.match(source, /state\.controls\?\.target\?\.copy\?\./, 'exiting the comparison must restore the original orbit pivot');
assert.match(source, /HobunjiFullCharacterScaleComparison\?\.focusKey/, 'presentation must read only the explicitly focused portrait key');
assert.match(source, /setFromObject\(focused \|\| root\)/, 'focus any chosen character without losing the full lineup fallback');
assert.match(source, /view:\$\{focused \? focusKey : 'lineup'\}/, 'camera resets must only respond to explicit focus or viewport changes');
assert.doesNotMatch(source, /\$\{size\.[xyz]\.toFixed/, 'geometry bounds must never trigger automatic framing while editing');
assert.doesNotMatch(source, /panel\.querySelector\('#maaFullScaleFrame'\)\?\.addEventListener/, 'the presentation must not double-dispatch a frame reset');
assert.match(source, /cameraCenterX \+ distance \* 0\.7/, 'the orthographic view must show forward-Z curvature from a three-quarter angle');
assert.match(source, /stopImmediatePropagation\(\).*OrbitControls never receives the second finger/s);
assert.match(source, /document\.activeElement === number/);
assert.match(source, /Empty\/partial mobile numeric edits stay editable/);
assert.doesNotMatch(source, /translateDisplayedHeadForOriginalHandler/, 'the old same-event head-value rewrite must stay removed');

// Exercises the actual orthographic camera owner with a selected Longoran and an unrelated lineup.
// A 50ms polling pass must NOT overwrite a user's touch orbit after a walking frame changes the skinned bounds.
class MockVector3 {
  constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); }
  set(x, y, z) { Object.assign(this, { x, y, z }); return this; }
  clone() { return new MockVector3(this.x, this.y, this.z); }
  copy(other) { return this.set(other.x, other.y, other.z); }
}
let boxComputations = 0; // Verifies the 50ms camera poll does not traverse all animated skinned meshes after the user edits a setting.
class MockBox3 {
  setFromObject(target) { boxComputations++; this.target = target; return this; }
  isEmpty() { return false; }
  getCenter(out) { return out.set(...this.target.testBounds.center); }
  getSize(out) { return out.set(...this.target.testBounds.size); }
}
const longoranGroup = {
  userData: { fullScalePreviewKey: 'longoran::male' },
  position: new MockVector3(-2, 0, 0),
  testBounds: { center: [-2, 1, 0], size: [1.2, 3, 0.8] },
};
const otherGroup = {
  userData: { fullScalePreviewKey: 'mashtzarr::female' },
  position: new MockVector3(2, 0, 0),
  testBounds: { center: [2, 1, 0], size: [1, 2.5, 0.5] },
};
const previewRoot = {
  children: [longoranGroup, otherGroup],
  testBounds: { center: [0.5, 1.4, 0], size: [11, 3.8, 0.8] },
};
const controls = {
  target: new MockVector3(0, 0, 0), // The Animation Author's real OrbitControls starts at origin.
  updates: 0,
  update() { this.updates++; },
};
const camera = {
  position: new MockVector3(0, 0, 9),
  quaternion: { clone() { return {}; } },
  isPerspectiveCamera: true,
  isOrthographicCamera: false,
  near: 0.1, far: 100, zoom: 1,
  updateProjectionMatrix() {},
  lookAt(x, y, z) { this.testTarget = [x, y, z]; },
  updateMatrixWorld() {},
  projectionMatrix: { makeOrthographic() {} },
  projectionMatrixInverse: { copy() { return this; }, invert() { return this; } },
};
let focusedKey = 'longoran::male'; // Shared comparison API selection read by the orthographic adapter.
const presentationWindow = {
  addEventListener() {},
  HobunjiFullCharacterScaleComparison: { get focusKey() { return focusedKey; } },
  HobunjiGameplayBackdrop: {
    getCamera: () => camera,
    getCameraControls: () => controls,
    getScene: () => ({ getObjectByName: () => previewRoot }),
  },
  PNGPlaneAvatar: { loadThreeModules: async () => ({ THREE: { Box3: MockBox3, Vector3: MockVector3 } }) },
};
let panelWidth = 250; // Simulates the responsive editor panel width changing while a slider is dragged.
const presentationPanel = {
  getBoundingClientRect: () => ({ width: panelWidth }),
  addEventListener() {},
  querySelector: () => null,
};
let canvasHeight = 600; // Simulates the on-screen numeric keyboard reducing the visible canvas without changing the camera target.
const presentationDocument = {
  body: { dataset: { animationAuthorMode: 'scale-compare' } },
  head: { appendChild() {} },
  activeElement: null,
  getElementById: id => id === 'view3d' ? { clientWidth: 900, clientHeight: canvasHeight }
    : id === 'maaFullScalePanel' ? presentationPanel : null,
  createElement: tag => ({ tagName: tag.toUpperCase(), style: {} }),
};
vm.runInNewContext(source, {
  window: presentationWindow, document: presentationDocument,
  location: { pathname: '/tools/animation-author/index.html' },
  setInterval: () => 1, queueMicrotask: fn => fn(), console, Promise, Map, Set,
});
(async () => {
  const view = presentationWindow.HobunjiFullScaleEditorPresentation;
  await view.frameOrthographic(true, true);
  const focusWidth = camera.right - camera.left; // Explicit Longoran focus gets a close-up orthographic view.
  const initialBoundsTraversals = boxComputations; // Only focus/framing actions should scan the large lineup.
  assert(camera.isOrthographicCamera, 'focused view must retain orthographic projection and mobile pinch');
  assert(camera.position.x - camera.testTarget[0] > 2, 'Longoran forward curvature must be observed from a three-quarter angle');
  assert.deepEqual([controls.target.x, controls.target.y, controls.target.z], camera.testTarget, 'manual orbit pivot must move to the focused Longoran');
  assert.deepEqual(camera.testTarget, longoranGroup.testBounds.center, 'actual Longoran center, not the right-hand UI rail offset, must be the orbit pivot');
  assert((camera.left + camera.right) / 2 > 0, 'keep the focused character left of the right-hand rail by shifting only the projection frustum');
  const controlUpdatesAtFocus = controls.updates; // Slider edits must not invoke OrbitControls again or alter its target.

  // Simulate changing body width/height, skinned spine, panel width, and progressively repositioned lineup models.
  // None of these reactive updates is permission to move a camera that the user has orbited.
  camera.position.x = 42;
  camera.zoom = 1.65;
  const left = camera.left;
  const target = [...camera.testTarget];
  longoranGroup.testBounds.size[1] = 6;
  longoranGroup.position.x = 4.25;
  previewRoot.testBounds.size[0] = 22;
  panelWidth = 400;
  await view.frameOrthographic(false, false);
  assert.equal(camera.position.x, 42, 'posture/scale changes must preserve manual camera orbit');
  assert.equal(camera.zoom, 1.65, 'posture/scale changes must preserve camera zoom');
  assert.equal(camera.left, left, 'posture/scale changes must preserve orthographic bounds');
  assert.deepEqual(camera.testTarget, target, 'posture/scale changes must preserve the camera target');
  assert.equal(boxComputations, initialBoundsTraversals, 'the 50ms camera poll must not recalculate skinned bounds after sliders change');
  assert.equal(controls.updates, controlUpdatesAtFocus, 'slider edits must not reset the orbit controls');
  assert.deepEqual([controls.target.x, controls.target.y, controls.target.z], target, 'slider edits must preserve the focused orbit pivot');

  canvasHeight = 420; // Mobile keyboard opened over a numeric percentage field.
  await view.frameOrthographic(false, false);
  assert.equal(camera.position.x, 42, 'a mobile viewport resize must not change camera position or angle');
  assert.equal(camera.zoom, 1.65, 'a mobile viewport resize must preserve user zoom');
  assert.deepEqual(camera.testTarget, target, 'a mobile viewport resize must not recenter the camera');
  assert(Math.abs((camera.right - camera.left) / (camera.top - camera.bottom) - 900 / 420) < 1e-9, 'resizing must update only the orthographic projection aspect ratio');
  assert.equal(boxComputations, initialBoundsTraversals, 'mobile resize must not recompute model bounds');
  assert.equal(controls.updates, controlUpdatesAtFocus, 'mobile keyboard resize must not touch the orbit controls');

  focusedKey = 'longoran::male'; // Simulate a slow async focus request overtaken by another selection.
  const staleRequest = view.frameOrthographic(true, true); // In-flight module lookup must not apply a camera target that is no longer selected.
  focusedKey = null; // Pressing Frame lineup supersedes the stale request.
  await staleRequest;
  assert.equal(camera.position.x, 42, 'a superseded async focus request must not move the camera');
  await view.frameOrthographic(true, true);
  assert(camera.right - camera.left > focusWidth * 2, 'Frame lineup must fit the entire comparison frustum');
  assert.deepEqual(camera.testTarget, previewRoot.testBounds.center, 'Frame lineup must orbit around the true lineup center');
  camera.position.x = -77;
  previewRoot.testBounds.size[0] = 31;
  await view.frameOrthographic(false, false);
  assert.equal(camera.position.x, -77, 'changing a body scale must not reframe the unfocused lineup either');

  focusedKey = 'mashtzarr::female'; // Focus selected works for any species, not just Longoran.
  await view.frameOrthographic(true, true);
  assert(Math.abs(camera.position.x - camera.testTarget[0]) < 1e-9, 'non-Longoran focus keeps a frontal camera angle');
  assert(camera.right - camera.left < focusWidth * 2, 'non-Longoran focus zooms to its selected portrait');
  assert.deepEqual([controls.target.x, controls.target.y, controls.target.z], camera.testTarget, 'OrbitControls must orbit the newly focused non-Longoran');
  assert.deepEqual(camera.testTarget, otherGroup.testBounds.center, 'other species also orbit around their actual center');
  const beforeRestore = controls.updates;
  view.restoreCamera();
  assert.deepEqual([controls.target.x, controls.target.y, controls.target.z], [0, 0, 0], 'leaving Full Character Scale must restore the editor orbit pivot');
  assert(controls.updates > beforeRestore, 'restoring the pivot must update OrbitControls once');
  console.log('Full character scale focus, camera isolation and presentation tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
