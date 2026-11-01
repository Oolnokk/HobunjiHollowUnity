'use strict';

const assert = require('node:assert/strict'); // Verifies actual render-hook behavior without a GPU.
const fs = require('node:fs'); // Loads shipped browser modules.
const vm = require('node:vm'); // Isolates module globals for each fixture.
const read = path => fs.readFileSync(path, 'utf8'); // Shared module loader.

class Matrix4 {
  constructor() { this.elements = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
  copy(other) { this.elements = other.elements.slice(); return this; }
  clone() { return new Matrix4().copy(this); }
  multiplyMatrices(parent, local) { // Full column-major composition covers body rotations, mirrored axes and nonuniform species scales.
    const p = parent.elements, l = local.elements; // Parent and child matrices stay unchanged while this receives their product.
    const out = Array(16).fill(0); // Final composed transform for each late-visible hand primitive.
    for (let column = 0; column < 4; column++) for (let row = 0; row < 4; row++)
      for (let axis = 0; axis < 4; axis++) out[column * 4 + row] += p[axis * 4 + row] * l[column * 4 + axis];
    this.elements = out;
    return this;
  }
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
// The player pose composer can bake a body transform after scene traversal,
// and the hand socket can move again before HeldObjectRenderOrder draws it.
const bakedBody = { matrixWorld: new Matrix4(), updateMatrix() { throw Error('do not rebuild composed body'); } }; // Baked render-time body pose is the authoritative parent.
bakedBody.matrixWorld.elements[13] = 0.2;
const stagedHandRoot = group([]); // Normal hand group inherits the existing parent-world matrix.
stagedHandRoot.parent = bakedBody;
stagedHandRoot.matrix = new Matrix4();
stagedHandRoot.matrixWorld = new Matrix4();
stagedHandRoot.updateMatrix = () => {};
stagedHandRoot.matrix.elements[13] = 0.01;
const stagedSocket = group([]); // Late hand driver writes the socket, not the GLB mesh matrix directly.
stagedSocket.name = 'left_hand_socket';
stagedSocket.parent = stagedHandRoot;
stagedSocket.matrix = new Matrix4();
stagedSocket.matrixWorld = new Matrix4();
stagedSocket.updateMatrix = () => {};
stagedSocket.matrix.elements[13] = 0.05;
stagedHandRoot.children.push(stagedSocket);
const detachedHand = mesh('mesh_0_1'); // Simulates a visible GLB primitive retaining an old, floating render transform.
detachedHand.parent = stagedSocket;
detachedHand.matrix = new Matrix4();
detachedHand.updateMatrix = () => {};
detachedHand.matrix.elements[13] = 0.03;
detachedHand.matrixWorld.elements[13] = 0.9;
stagedSocket.children.push(detachedHand);
stagedSocket.traverse = fn => { fn(stagedSocket); stagedSocket.children.forEach(child => child.traverse(fn)); };
const handRig = { group: stagedHandRoot, getDebug: () => ({}), dispose() {} }; // Same public hand-attachment surface as the game.
const staged = loadParity('hand', handRig);
assert.equal(staged.window.HobunjiHandOutlineParity.refreshHeldMatrices([detachedHand]), 1, 'the held renderer can refresh hand matrices before calculating scissor bounds');
assert(Math.abs(detachedHand.matrixWorld.elements[13] - 0.29) < 1e-9, 'pre-scissor refresh reanchors a floating hand before overlay clipping');
draw(detachedHand, {}, camera, { colorWrite: true })();
assert(Math.abs(detachedHand.matrixWorld.elements[13] - 0.29) < 1e-9, 'visible hand is reanchored to its live socket, not its stale mesh world matrix');
assert.equal(bakedBody.matrixWorld.elements[13], 0.2, 'the temporary player-body world transform is never recomputed');
assert.equal(handRig.getDebug().visualMatrixResyncs, 1, 'mobile hand diagnostics report an actual repaired matrix');
detachedHand.matrixWorld.elements[13] = 0.85; // Outline passes may rewrite the world matrix after the visible frame.
const restoreStaged = draw(detachedHand, { overrideMaterial: shell }, camera, shell);
assert(Math.abs(detachedHand.matrixWorld.elements[13] - 0.29) < 1e-9, 'outline draws reuse the last corrected hand world matrix');
restoreStaged();
assert.equal(detachedHand.matrixWorld.elements[13], 0.85, 'the pre-outline matrix is restored without compounding transforms');
assert.equal(staged.window.HobunjiHandOutlineParity.getDebug().visualMatrixResyncs, 1);

// Nonuniform Nuhongan-like body scale and mirrored handedness must be composed
// through the socket chain, not applied by rewriting authored hand coordinates.
bakedBody.matrixWorld.elements[0] = -0.68;
bakedBody.matrixWorld.elements[5] = 0.6375;
bakedBody.matrixWorld.elements[10] = 0.68;
bakedBody.matrixWorld.elements[12] = 10;
bakedBody.matrixWorld.elements[14] = 4;
stagedSocket.matrix.elements[12] = -0.38;
stagedSocket.matrix.elements[13] = 0.224;
detachedHand.matrix.elements[12] = 0.4;
detachedHand.matrix.elements[13] = 0.15;
draw(detachedHand, {}, camera, { colorWrite: true })();
const expectedX = 10 - 0.68 * (-0.38 + 0.4); // Mirrored/scaled X offset, with no assumptions about portrait facing.
const expectedY = 0.2 + 0.6375 * (0.01 + 0.224 + 0.15); // Nonuniform body Y scale keeps the hand relative to its shoulder.
assert(Math.abs(detachedHand.matrixWorld.elements[12] - expectedX) < 1e-9, 'mirrored hand position composes through the current rig');
assert(Math.abs(detachedHand.matrixWorld.elements[13] - expectedY) < 1e-9, 'species height scale is inherited once, not bypassed or doubled');
assert.equal(bakedBody.matrixWorld.elements[12], 10, 'render-time body position is retained unchanged');
assert.equal(bakedBody.matrixWorld.elements[5], 0.6375, 'render-time body scale is retained unchanged');
assert(handRig.getDebug().visualMatrixResyncs >= 2, 'a second stale color draw is detected');
assert.match(read('docs/js/hand-pixel-probe-diagnostics.js'), /maxOriginDrift=/, 'the on-device Pixel Probe exposes the measured hand drift');
const overlaySource = read('docs/js/held-object-render-order.js'); // Production overlay must refresh hands before projecting their screen-space bounds.
assert.match(overlaySource, /refreshHeldMatrices\?\.\(held\)[\s\S]*replayScissorRect\(renderer, camera, scissorMeshes, scissorRect\)/, 'held renderer refreshes hand matrices before scissor bounds');



assert.equal(handThickness(5), 0.012, 'reference distance preserves existing hand thickness');
assert.equal(handThickness(10), 0.006, 'doubling distance halves hand outline width');
assert.equal(handThickness(20), 0.003, 'farther hands continue shrinking');
for (const depth of [0, 0.1, 1, 2.5, 4]) {
  assert.equal(handThickness(depth), 0.012, 'near-camera hands never inflate beyond the foot baseline');
}
camera.isPerspectiveCamera = false;
assert.equal(handThickness(20), 0.012, 'orthographic size is independent of distance');

assert.match(read('docs/js/procedural-leg-animation.js'), /placeIdleTarget\('right', state\.rightContactY\);\s*window\.HobunjiFeetOutlineParity\?\.refreshRig\?\.\(root\)/, 'the leg owner notifies parity after installing final GLB feet');

const fallback = mesh('left_foot'); // Initially attached procedural foot.
const root = group([fallback]); // Stable leg root survives async foot replacement.
const rig = { group: root, dispose() {} }; // The owner's returned handle.
const feet = loadParity('feet', rig); // Enrolls the fallback immediately.
assert(feet.registered.has(fallback));
draw(fallback, {}, camera, { colorWrite: true })();
const finishFootShell = draw(fallback, { overrideMaterial: shell }, camera, shell); // Compare against the actual foot hook, including shared-uniform restoration.
const footThickness = shell.uniforms.uThickness.value; // Baseline produced by the shipped foot renderer.
finishFootShell();
assert.equal(shell.uniforms.uThickness.value, 0.006, 'foot draw restores the shared shell thickness');
camera.isPerspectiveCamera = true;
assert.equal(handThickness(2.5), footThickness, 'default/near hand shells match actual foot shell thickness');
assert(handThickness(10) < footThickness, 'distant hand shells retain perspective thinning');
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
