'use strict';

const assert = require('node:assert/strict'); // Verifies actual render-hook behavior without a GPU.
const fs = require('node:fs'); // Loads shipped browser modules.
const vm = require('node:vm'); // Isolates module globals for each fixture.
const read = path => fs.readFileSync(path, 'utf8'); // Shared module loader.

class Matrix4 {
  constructor() { this.elements = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
  copy(other) { this.elements = other.elements.slice(); return this; }
  clone() { return new Matrix4().copy(this); }
}
function mesh(name) {
  return { name, isMesh: true, userData: {}, matrixWorld: new Matrix4(), layers: { enable() {} }, traverse(fn) { fn(this); } };
}
function group(children) {
  return { children, getObjectByName(name) { return children.find(child => child.name === name) || null; }, traverse(fn) { children.forEach(child => child.traverse(fn)); } };
}
function loadParity(kind, rig) {
  let now = 0; // Simulated clock can exceed the former foot-model polling deadline.
  const registered = new Set(); // Tracks the exact meshes enrolled in water occlusion.
  const window = { THREE: { Matrix4, BackSide: 1 }, performance: { now: () => now },
    HeldObjectRenderOrder: { installed: true, markHeldPlane: () => true, markWaterOccludedMesh: child => registered.add(child) },
    setTimeout() {}, [kind === 'hand' ? 'ProceduralHandAttachments' : 'ProceduralLegAnimation']: { attach: () => rig } };
  const context = vm.createContext({ window, performance: window.performance }); // Matches browser global clock access.
  vm.runInContext(read(`docs/js/procedural-${kind === 'hand' ? 'hand' : 'feet'}-outline-parity.js`), context);
  window[kind === 'hand' ? 'ProceduralHandAttachments' : 'ProceduralLegAnimation'].attach();
  return { window, registered, setTime(value) { now = value; } };
}
function draw(child, scene, camera, material) {
  const args = [null, scene, camera, null, material]; // Three r128 callback argument order.
  child.onBeforeRender(...args);
  return () => child.onAfterRender(...args);
}

const hand = mesh('left_hand_visual'); // A real hand draw captured by the parity adapter.
const hands = loadParity('hand', { group: group([hand]), getDebug: () => ({}), dispose() {} }); // Exercises the production attach wrapper.
const camera = { isPerspectiveCamera: true, matrixWorldInverse: new Matrix4() }; // Looking down negative Z.
const shell = { isShaderMaterial: true, side: 1, uniforms: { uThickness: { value: 0.006 } } }; // Shared outline material also used by other world meshes.
function handThickness(depth) {
  hand.matrixWorld.elements[14] = -depth;
  draw(hand, {}, camera, { colorWrite: true })();
  const finish = draw(hand, { overrideMaterial: shell }, camera, shell); // Reuses the visible draw's matrix.
  const result = shell.uniforms.uThickness.value; // Observe the value uploaded for this draw.
  finish();
  assert.equal(shell.uniforms.uThickness.value, 0.006, 'shared outline thickness is restored');
  return result;
}
assert.equal(handThickness(5), 0.012, 'reference distance preserves existing hand thickness');
assert.equal(handThickness(10), 0.006, 'doubling distance halves hand outline width');
assert.equal(handThickness(20), 0.003, 'farther hands continue shrinking');
assert(Number.isFinite(handThickness(0)), 'near-camera draws stay finite');
camera.isPerspectiveCamera = false;
assert.equal(handThickness(20), 0.012, 'orthographic size is independent of distance');

assert.match(read('docs/js/procedural-leg-animation.js'), /placeIdleTarget\('right', state\.rightContactY\);\s*window\.HobunjiFeetOutlineParity\?\.refreshRig\?\.\(root\)/, 'the leg owner notifies parity after installing final GLB feet');

const fallback = mesh('left_foot'); // Initially attached procedural foot.
const root = group([fallback]); // Stable leg root survives async foot replacement.
const rig = { group: root, dispose() {} }; // The owner's returned handle.
const feet = loadParity('feet', rig); // Enrolls the fallback immediately.
assert(feet.registered.has(fallback));
feet.setTime(30000);
const finalFoot = mesh('left_foot'); // Simulates a model that finishes loading after 30 seconds.
root.children.splice(0, 1, finalFoot);
assert(feet.window.HobunjiFeetOutlineParity.refreshRig(root));
assert(feet.registered.has(finalFoot), 'late final GLB receives water registration');
finalFoot.matrixWorld.elements[12] = 7;
draw(finalFoot, {}, camera, { colorWrite: true })();
finalFoot.matrixWorld.elements[12] = 100;
const finishMask = draw(finalFoot, {}, { layers: { mask: 1 << 26 } }, { colorWrite: false }); // Water-mask replay must retain the visible pose.
assert.equal(finalFoot.matrixWorld.elements[12], 7);
finishMask();
assert.equal(finalFoot.matrixWorld.elements[12], 100, 'temporary water-mask matrix is restored');
assert.equal(rig.getOutlineParityDebug().lockedWaterMaskDraws, 1);
rig.dispose();
assert.equal(feet.window.HobunjiFeetOutlineParity.refreshRig(root), false, 'disposed rigs cannot register more meshes');

async function testPortraitLayers() {
  const draws = []; // Records the compositing order from the actual portrait renderer.
  const window = { SCRATCHBONES_CONFIG: { game: {} } }; // Minimal browser configuration.
  const context = vm.createContext({ window, console, Image: class Image {}, draws }); // Images are cached below to avoid network dependencies.
  vm.runInContext(read('docs/js/portrait-utils.js'), context);
  vm.runInContext(`
    for (const url of ['hair-back', 'hat-back', 'hat-front']) IMG_CACHE.set(url, new Image());
    drawPortraitLayer = (_ctx, _image, _xform, _tint, sourceKey) => draws.push(sourceKey);
    _cloneBehindLayer = layer => layer;
  `, context);
  const canvas = { width: 200, height: 200, getContext: () => ({ clearRect() {}, save() {}, restore() {} }) }; // No raster operations are needed to verify draw order.
  const profile = { fighter: { bodyLayers: [], urLayers: [] }, hairFront: { layers: [] },
    hairBack: { id: 'hair', layers: [{ url: 'hair-back', pos: 'back' }] },
    hat: { id: 'hat', layers: [{ url: 'hat-back', pos: 'back' }, { url: 'hat-front', pos: 'front' }] } }; // Both hat sprite positions must be ordered relative to back hair.
  await window.renderProfile(canvas, profile, { forceEyesOpen: true });
  assert(draws.indexOf('hair-back') < draws.indexOf('hat-back'), 'front-plane hair sits behind hat rear art');
  assert(draws.indexOf('hair-back') < draws.indexOf('hat-front'), 'front-plane hair sits behind hat front art');
  draws.length = 0;
  await window.renderProfile(canvas, profile, { portraitView: 'behind', forceEyesOpen: true });
  assert(draws.indexOf('hat-back') < draws.indexOf('hair-back'), 'rear-plane hair covers hat rear art');
  assert(draws.indexOf('hat-front') < draws.indexOf('hair-back'), 'rear-plane hair covers hat front art');
}
testPortraitLayers().then(() => console.log('avatar limb and hair rendering tests passed')).catch(error => { console.error(error); process.exitCode = 1; });
