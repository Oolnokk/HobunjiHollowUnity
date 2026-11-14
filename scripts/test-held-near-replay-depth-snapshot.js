#!/usr/bin/env node
'use strict';
// Held/shell x-ray replays must not resubmit geometry that sits wholly behind
// the held parts: with ScissorDepthSnapshot available the depth rebuild keeps
// only nearer occluders and the original depth is copied back instead of
// redrawn. Executes the shipping snapshot module against a recording GL fake
// and the shipping replay compositor against scene fakes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const snapshotSource = fs.readFileSync('docs/js/scissor-depth-snapshot.js', 'utf8');
const heldSource = fs.readFileSync('docs/js/held-object-render-order.js', 'utf8');
const index = require('./classic-script-group-index.js').expandClassicScriptGroups();

// ── ScissorDepthSnapshot ────────────────────────────────────────────────────
function fakeGl() {
  const calls = [];
  const gl = {
    calls, scissorOn: true, error: 0,
    FRAMEBUFFER: 'FB', READ_FRAMEBUFFER: 'READ', DRAW_FRAMEBUFFER: 'DRAW', RENDERBUFFER: 'RB', SCISSOR_TEST: 'SCISSOR',
    DEPTH_BUFFER_BIT: 256, NEAREST: 'NEAREST', NO_ERROR: 0, FRAMEBUFFER_COMPLETE: 'COMPLETE',
    DEPTH24_STENCIL8: 'D24S8', DEPTH_STENCIL_ATTACHMENT: 'DS', DEPTH_COMPONENT16: 'D16', DEPTH_COMPONENT24: 'D24', DEPTH_COMPONENT32F: 'D32F', DEPTH_ATTACHMENT: 'D',
    bound: { READ: null, DRAW: null }, complete: true, made: 0,
    createRenderbuffer: () => ({ rb: ++gl.made }), createFramebuffer: () => ({ fb: ++gl.made }),
    deleteFramebuffer: f => calls.push(['deleteFramebuffer', f]), deleteRenderbuffer: r => calls.push(['deleteRenderbuffer', r]),
    bindRenderbuffer() {}, renderbufferStorage: (_t, internal, w, h) => calls.push(['storage', internal, w, h]),
    bindFramebuffer(point, fbo) { if (point === 'FB') { gl.bound.READ = fbo; gl.bound.DRAW = fbo; } else gl.bound[point] = fbo; },
    framebufferRenderbuffer: (_t, attachment) => calls.push(['attach', attachment]),
    checkFramebufferStatus: () => gl.complete ? 'COMPLETE' : 'BROKEN',
    isEnabled: () => gl.scissorOn, enable: () => { gl.scissorOn = true; }, disable: () => { gl.scissorOn = false; },
    blitFramebuffer(...args) { calls.push(['blit', gl.bound.READ, gl.bound.DRAW, gl.scissorOn, ...args]); },
    getError: () => gl.error,
  };
  return gl;
}
const THREE = { DepthStencilFormat: 'DSF', DepthFormat: 'DF', UnsignedShortType: 'US', UnsignedIntType: 'UI', FloatType: 'F' };
function fakeRenderer(gl, target) {
  const source = { main: true }; let depthMask = null;
  return {
    target, source, capabilities: { isWebGL2: true },
    getContext: () => gl, getRenderTarget() { return this.target; },
    properties: { get: t => (t ? { __webglFramebuffer: t.fbo || source } : {}) },
    state: { buffers: { depth: { setMask(v) { depthMask = v; } } } },
    get depthMask() { return depthMask; },
  };
}
const win = { THREE };
new Function('window', snapshotSource)(win);
const snap = win.ScissorDepthSnapshot;
assert(snap?.save && snap.restore, 'snapshot module exposes save/restore');

const gl = fakeGl();
const mainTarget = { width: 400, height: 225, depthTexture: { format: 'DSF', type: 'UI248' } };
const renderer = fakeRenderer(gl, mainTarget);
const rect = { x: 10.4, y: 20, z: 50, w: 400 }; // Taller than the target: must clamp.
const token = snap.save(renderer, rect);
assert(token, 'an offscreen depth-texture target can be snapshotted');
assert.deepEqual(gl.calls.find(c => c[0] === 'storage'), ['storage', 'D24S8', 400, 225], 'scratch buffer matches the target depth format and size');
assert.deepEqual(gl.calls.find(c => c[0] === 'attach'), ['attach', 'DS']);
let blit = gl.calls.filter(c => c[0] === 'blit').pop();
assert.equal(blit[1], renderer.source, 'save reads from the render target');
assert.notEqual(blit[2], renderer.source, 'save writes to the scratch buffer');
assert.equal(blit[3], false, 'scissor is off during the copy, or the blit would be clipped to a smaller group rectangle');
assert.deepEqual(blit.slice(4), [10, 20, 61, 225, 10, 20, 61, 225, 256, 'NEAREST'], 'depth only, 1:1, clamped to the target');
assert.equal(gl.scissorOn, true, 'scissor test is re-enabled');
assert.deepEqual([gl.bound.READ, gl.bound.DRAW], [renderer.source, renderer.source], 'the target framebuffer is bound again, as three believes');
assert.equal(renderer.depthMask, true);
assert.equal(snap.restore(renderer, token, rect), true);
blit = gl.calls.filter(c => c[0] === 'blit').pop();
assert.equal(blit[2], renderer.source, 'restore writes back to the render target');
assert.deepEqual([gl.bound.READ, gl.bound.DRAW], [renderer.source, renderer.source]);
assert.equal(gl.calls.filter(c => c[0] === 'storage').length, 1, 'the scratch buffer is reused between frames');
assert(snap.save(renderer, null), 'null rectangle copies the whole target');
assert.deepEqual(gl.calls.filter(c => c[0] === 'blit').pop().slice(4, 8), [0, 0, 400, 225]);
const before = gl.calls.filter(c => c[0] === 'blit').length;
assert(snap.save(renderer, { x: 5, y: 5, z: 0, w: 9 }), 'an empty rectangle succeeds without copying');
assert.equal(gl.calls.filter(c => c[0] === 'blit').length, before);

const stale = snap.save(renderer, rect);
renderer.target = { width: 400, height: 225, depthTexture: { format: 'DSF' }, fbo: { other: true } };
assert.equal(snap.restore(renderer, stale, rect), false, 'a snapshot is never restored into a different target');
renderer.target = mainTarget;
mainTarget.width = 800; mainTarget.height = 450; // Window resize.
assert(snap.save(renderer, rect));
assert.equal(gl.calls.filter(c => c[0] === 'storage').length, 2, 'resizing reallocates the scratch buffer');
assert.equal(snap.restore(renderer, stale, rect), false, 'a snapshot from before a resize is rejected');

for (const [label, make] of [
  ['drawing to the canvas', r => { r.target = null; }],
  ['WebGL1', r => { r.capabilities.isWebGL2 = false; }],
  ['a multisampled target', r => { r.target = { ...mainTarget, isWebGLMultisampleRenderTarget: true }; }],
  ['a target without a depth texture', r => { r.target = { width: 4, height: 4 }; }],
  ['an unknown depth format', r => { r.target = { width: 4, height: 4, depthTexture: { format: 'RGBA' } }; }],
]) {
  const r = fakeRenderer(fakeGl(), { ...mainTarget });
  make(r);
  assert.equal(snap.save(r, rect), null, `${label} is unsupported, so the caller redraws`);
}
const brokenGl = fakeGl(); brokenGl.error = 1282;
const brokenRenderer = fakeRenderer(brokenGl, { ...mainTarget });
assert.equal(snap.save(brokenRenderer, rect), null, 'a GL error on first use disables snapshots');
brokenGl.error = 0;
assert.equal(snap.save(brokenRenderer, rect), null, 'and they stay disabled for that renderer');
assert.equal(snap.snapshot().disabledReason, 'blit-error');
const incompleteGl = fakeGl(); incompleteGl.complete = false;
assert.equal(snap.save(fakeRenderer(incompleteGl, { ...mainTarget }), rect), null, 'an incomplete scratch framebuffer is never used');

// ── Compositor: base held replay ────────────────────────────────────────────
// Depth-only math: a "matrix" is a view-space z offset, so depth = -z.
class Vec3 { constructor() { this.x = 0; this.y = 0; this.z = 0; } set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } copy(v) { this.z = v.z; return this; } applyMatrix4(m) { this.z += m.z || 0; return this; } }
class Sphere { constructor(z = 0, radius = 0) { this.center = { z }; this.radius = radius; } copy(s) { this.center = { z: s.center.z }; this.radius = s.radius; return this; } applyMatrix4(m) { this.center.z += m.z || 0; return this; } }
class Matrix4 { // Only view-space Z translations are needed by this compositing fixture.
  constructor() { this.elements = new Float64Array(16); }
  multiplyMatrices(view, world) {
    this.elements.fill(0);
    this.elements[10] = 1;
    this.elements[14] = (view.z || 0) + (world.z || 0);
    return this;
  }
}
const at = depth => ({ z: -depth, getMaxScaleOnAxis: () => 1 });
const mesh = (depth, radius = 0.5, extra = {}) => ({ isMesh: true, visible: true, children: [], userData: {}, matrixWorld: at(depth), geometry: { boundingSphere: new Sphere(0, radius) }, ...extra });
const begin = heldSource.indexOf('  let ordinaryDepthLeavesSkipped =');
const end = heldSource.indexOf('  function isShellOutlinePass(', begin);
assert(begin > 0 && end > begin);

function baseFixture({ snapshot = 'ok', handExtra = {}, scissored = false } = {}) {
  const nearRock = mesh(3), farMesa = mesh(60, 5), straddling = mesh(11, 2), unbounded = { isMesh: true, visible: true, children: [], userData: {}, matrixWorld: at(90) };
  const cover = mesh(4), hand = mesh(10, 0.5, handExtra);
  const boxed = (depth, zMin, zMax) => mesh(depth, 100, { geometry: { boundingSphere: new Sphere(0, 100), boundingBox: { min: { x: -90, y: 0, z: zMin }, max: { x: 90, y: 0, z: zMax } } } });
  const wideFarFloor = boxed(60, -1, 1); // Its sphere reaches the camera; its real surface is 59+ units away.
  const wideNearFloor = boxed(60, -1, 55); // Same sphere, but the box extends to 5 units from the camera.
  const world = [nearRock, farMesa, straddling, unbounded, cover, hand, wideFarFloor, wideNearFloor];
  const scene = { background: 'sky', autoUpdate: true, traverseVisible(fn) { for (const node of world) if (node.visible) fn(node); } };
  const draws = [], log = [];
  const camera = { layers: { mask: 1 }, matrixWorldInverse: { z: 0 } };
  const colorLog = [];
  const renderer = { autoClear: true, autoClearColor: true, autoClearDepth: true, autoClearStencil: true, shadowMap: { autoUpdate: true },
    state: { scissor() {}, setScissorTest() {}, buffers: { color: { setMask: v => colorLog.push(v), setLocked() {} } } },
    clearDepth() { log.push('clear'); }, clearStencil() {} };
  const fake = {
    save(_r, rect) { log.push(['save', rect]); return snapshot === 'unsupported' ? null : { token: 1 }; },
    restore(_r, token, rect) { log.push(['restore', rect]); return snapshot !== 'restore-fails'; },
  };
  const scope = {
    window: { ScissorDepthSnapshot: fake }, THREE: { Sphere, Vector3: Vec3, Matrix4 }, objectProto: { onBeforeRender: undefined }, internalReplay: false, Map, Set, Infinity, Number, Math,
    lastBaseStencilBits: 0, replayScissorEnabled: scissored, replayCullEnabled: false, scissorRect: { x: 1, y: 2, z: 3, w: 4 },
    replayScissorRect: () => scissored, setReplayCullFrustum: () => false, scissoredReplayCount: 0, applyElevationScissor: () => false, restoreRendererScissor() {},
    buildXrayGroups: () => ({ groups: [{ meshes: [hand], regions: [{ col: 0, row: 0 }] }], ordinary: [] }),
    collectGroundElevationMaterials: () => [], hasOverlappingHeldCover: () => false,
    hideObjects: objects => { const states = new Map(); for (const o of objects) { states.set(o, o.visible); o.visible = false; } return states; },
    restoreVisibility: states => { for (const [o, v] of states) o.visible = v; },
    collectVisible: () => [cover], pngDepthRegistry: 'png', protectedCoverRegistry: 'cover',
    setGroundElevationFilter() {}, prepareCutoutDepthMaterials: () => new Map(), prepareNonGroundDepthMaterials: () => { log.push('full-depth-materials'); return new Map(); },
    restoreMaterialStates() {}, prepareGroundDepthMaterials: () => new Map(),
    prepareSubmergedOverlayStencilMaterials: () => new Map(), prepareOverlayCoverTintMaterials: () => new Map(), prepareTintCoverDepthMaterials: () => new Map(),
    waterReplayCount: 0, WATER_REPLAY_MASK: 8, HELD_OVERLAY_MASK: 2, GROUND_REPLAY_MASK: 4,
    isReplayCullable: o => !!o.geometry?.boundingSphere, instancedReplaySphere: () => null, hasAuthoredInstanceBounds: () => false, hasAlternateReplayPose: () => false,
    rawRender(_scene, _camera) { const nodes = []; _scene.traverseVisible(n => nodes.push(n)); draws.push({ mask: _camera.layers.mask, nodes, colorOff: colorLog[colorLog.length - 1] === false }); log.push('draw:' + _camera.layers.mask); },
  };
  for (const name of ['lastBaseElevationGroups', 'lastHeldFullscreenReason', 'fullscreenReplayCount', 'lastReplayScissorCoverage', 'nonGroundDepthReplayCount', 'selectiveOverlayCount', 'groundDepthRestoreCount', 'groupScissorCount']) scope[name] = 0;
  scope.scissorTargetWidth = 400; scope.scissorTargetHeight = 225;
  vm.createContext(scope);
  vm.runInContext(heldSource.slice(begin, end), scope);
  scope.replaySelectiveHeldOverlay(renderer, scene, camera, [hand], [], [nearRock], [], [], 1);
  for (const node of world) assert.equal(node.visible, true, 'every object is visible again after the replay');
  assert.equal(camera.layers.mask, 1); assert.equal(scope.internalReplay, false);
  const counters = vm.runInContext('({ nearReplayFarCulled, nearReplaySnapshots, nearReplayFallbacks })', scope); // Module-level lets are not context properties.
  return { draws, log, nearRock, farMesa, straddling, unbounded, cover, hand, wideFarFloor, wideNearFloor, counters };
}

// Verify the production affine depth bound against the former eight-corner calculation.
const helperStart = heldSource.indexOf('  function nearestReplayBoxViewDepth(');
const helperEnd = heldSource.indexOf('  // Hides candidates whose whole bound', helperStart);
assert(helperStart >= 0 && helperEnd > helperStart, 'production affine-depth helper exists');
const nearestBoxDepth = new Function(heldSource.slice(helperStart, helperEnd) + String.fromCharCode(10) + 'return nearestReplayBoxViewDepth;')();
let seed = 0x5A17C0DE; // Reproducible affine transformations (including reflections and shears).
const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
for (let sample = 0; sample < 6000; sample++) {
  const min = { x: random() * 40 - 20, y: random() * 40 - 20, z: random() * 40 - 20 };
  const box = { min, max: { x: min.x + random() * 80, y: min.y + random() * 80, z: min.z + random() * 80 } };
  const elements = new Array(16).fill(0);
  for (const index of [2, 6, 10, 14]) elements[index] = random() * 30 - 15;
  let reference = Infinity;
  for (let corner = 0; corner < 8; corner++) {
    const x = corner & 1 ? box.max.x : box.min.x;
    const y = corner & 2 ? box.max.y : box.min.y;
    const z = corner & 4 ? box.max.z : box.min.z;
    reference = Math.min(reference, -(elements[2] * x + elements[6] * y + elements[10] * z + elements[14]));
  }
  const actual = nearestBoxDepth(box, elements);
  assert(Math.abs(actual - reference) < 1e-8, 'affine depth matches eight corners, sample ' + sample);
  assert.equal(actual > reference + 0.01, false, 'near object never overculled');
  assert.equal(actual > reference - 0.01, true, 'far object remains eligible for culling');
}
assert.match(heldSource, /replayFrustumIntersects\(object, instanceSphere\)/, 'instanced bounds reused for the intersection');

const near = baseFixture();
assert.deepEqual(near.draws.map(d => d.mask), [1, 2, 2], 'depth rebuild, held color draw, held depth-only redraw; no world or ground restore draw');
assert.deepEqual(near.log.filter(e => Array.isArray(e)).map(e => e[0]), ['save', 'restore'], 'original depth is saved before the clear and copied back after');
assert(near.log.indexOf('clear') > near.log.findIndex(e => Array.isArray(e) && e[0] === 'save'), 'save precedes the depth clear');
assert.equal(near.log.filter(e => e === 'clear').length, 1);
const rebuild = near.draws[0].nodes;
assert(rebuild.includes(near.nearRock), 'an occluder in front of the held part stays in the rebuild');
assert(rebuild.includes(near.cover), 'nearby cover stays');
assert(rebuild.includes(near.straddling), 'an object overlapping the held part in depth stays');
assert(rebuild.includes(near.unbounded), 'an object without trustworthy bounds stays');
assert(!rebuild.includes(near.farMesa), 'geometry wholly behind the held part is not resubmitted');
assert(!rebuild.includes(near.wideFarFloor), 'a wide flat chunk is judged by its box, not a sphere that spans the map');
assert(rebuild.includes(near.wideNearFloor), 'a box that reaches in front of the held part stays');
assert.equal(near.draws[2].colorOff, true, 'the final held redraw writes depth only');
assert(near.draws[2].nodes.includes(near.hand));
assert.equal(near.counters.nearReplayFarCulled, 2);
assert.equal(near.counters.nearReplaySnapshots, 1);

const rectUsed = baseFixture({ scissored: true });
assert.deepEqual(rectUsed.log.find(e => Array.isArray(e))[1], { x: 1, y: 2, z: 3, w: 4 }, 'a scissored replay snapshots only its rectangle');
assert.equal(near.log.find(e => Array.isArray(e))[1], null, 'an unscissored replay snapshots the whole target');

const skinnedHand = baseFixture({ handExtra: { isSkinnedMesh: true } });
assert(skinnedHand.draws[0].nodes.includes(skinnedHand.farMesa), 'an unboundable held part disables the far cull');
assert.deepEqual(skinnedHand.draws.map(d => d.mask), [1, 2, 2], '...but the depth copy still replaces the restore redraw');

const legacy = baseFixture({ snapshot: 'unsupported' });
assert.deepEqual(legacy.draws.map(d => d.mask), [1, 2, 4], 'without snapshot support the original rebuild + ground restore runs');
assert(legacy.draws[0].nodes.includes(legacy.farMesa), 'and nothing is far-culled, because nothing would bring it back');

const failed = baseFixture({ snapshot: 'restore-fails' });
assert.deepEqual(failed.draws.map(d => d.mask), [1, 2, 1, 2, 4], 'a failed restore rebuilds complete depth, then the original ground restore');
assert(failed.draws[2].nodes.includes(failed.farMesa), 'the fallback redraw contains the far geometry');
assert.equal(failed.counters.nearReplayFallbacks, 1);

// A/B switch.
assert.match(heldSource, /setNearReplayEnabled: value => \{ nearReplayEnabled = value !== false; return nearReplayEnabled; \}/);
assert.match(heldSource, /nearReplayEnabled && canLockColorMask && window\.ScissorDepthSnapshot\?\.save/, 'the switch and renderer support both gate the path');

// ── Compositor: shell outline replay uses the same save / far cull / restore ─
const sBegin = heldSource.indexOf('  function replayShellOutlineXray(');
const sEnd = heldSource.indexOf('  function wrappedRender(', sBegin);
const shellBody = heldSource.slice(sBegin, sEnd);
assert.match(shellBody, /nearToken = nearReplay\.save\(renderer, scissored \? scissorRect : null\);/);
assert.match(shellBody, /if \(nearToken\) farCulled = hideBeyondViewDepth\(camera, nearCandidates, replayFarViewDepth\(camera, group\.meshes\)\);/);
assert.match(shellBody, /nearReplay\.restore\(renderer, nearToken, scissorActive \? scissorRect : null\)[\s\S]{0,260}camera\.layers\.mask = HELD_OVERLAY_MASK;/, 'shell restore is a depth copy plus the x-ray parts');
assert.match(shellBody, /camera\.layers\.mask = MASK_ALL;\s*\n\s*renderer\.clearDepth\(\);\s*\n\s*rawRender\.call\(renderer, scene, camera\);/, 'the full redraw remains as the fallback');

assert.match(index, /js\/scissor-depth-snapshot\.js\?v=[A-Za-z0-9_-]+/, 'snapshot module is loaded by the game page');
console.log('held near replay + depth snapshot: ok');
