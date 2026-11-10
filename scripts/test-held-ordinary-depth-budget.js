'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('docs/js/held-object-render-order.js', 'utf8'); // Execute compositor code, not a mirrored pass planner.
const begin = source.indexOf('  let ordinaryDepthLeavesSkipped ='); // Includes the supplement helper and complete held replay.
const end = source.indexOf('  function isShellOutlinePass(', begin);

function fixture({ bounded = false, ordinary = true, fail = false, colorLock = true, tint = false } = {}) {
  const opaque = { isMesh: true, visible: true, children: [] }; // Base world depth has already drawn this terrain/cover.
  const cutout = { isMesh: true, visible: true, children: [] }; // Portrait PNG needs forced alpha-tested depth.
  const cover = { isMesh: true, visible: true, children: [] }; // Water/grass must preserve occlusion of held parts.
  const weapon = { isMesh: true, visible: true, children: [] }; // Ordinary held source.
  const hand = { isMesh: true, visible: true, children: [] }; // Bounded x-ray participant.
  const parent = { isMesh: true, visible: true, children: [cutout] }; // A mesh ancestor of a required cutout cannot be hidden.
  const hooked = { isMesh: true, visible: true, children: [], onBeforeRender() {} }; // Unknown draw-time behavior is retained.
  const scene = { background: 'sky', autoUpdate: true,
    traverseVisible(fn) { for (const node of [opaque, cover, weapon, hand, parent, hooked]) { if (node.visible) { fn(node); for (const child of node.children) if (child.visible) fn(child); } } },
  };
  const draws = []; // Captures submitted passes and visible world leaves.
  let clears = 0; // Counts destructive depth clears, not stencil clears.
  const camera = { layers: { mask: 1 } }; // Main camera restored after every replay.
  const renderer = { autoClear: true, autoClearColor: true, autoClearDepth: true, autoClearStencil: true, shadowMap: { autoUpdate: true },
    state: { buffers: { color: colorLock ? { setMask() {}, setLocked() {} } : {} } },
    clearDepth() { clears++; }, clearStencil() {},
  };
  const hideObjects = objects => { const states = new Map(); for (const object of objects) { states.set(object, object.visible); object.visible = false; } return states; }; // Visibility transaction used by the owner.
  const scope = {
    window: {}, objectProto: { onBeforeRender: undefined }, internalReplay: false,
    lastBaseStencilBits: tint ? 1 : 0, replayScissorEnabled: false, replayCullEnabled: false,
    buildXrayGroups: () => ({ groups: bounded ? [{ meshes: [hand], regions: [{ col: 0, row: 0 }] }] : [], ordinary: ordinary ? [weapon] : [] }),
    collectGroundElevationMaterials: () => [], hasOverlappingHeldCover: () => tint,
    hideObjects, restoreVisibility: states => { for (const [object, visible] of states) object.visible = visible; },
    collectVisible: registry => registry === 'png' ? [cutout] : [cover], pngDepthRegistry: 'png', protectedCoverRegistry: 'cover',
    setGroundElevationFilter() {}, prepareCutoutDepthMaterials: () => new Map(), prepareNonGroundDepthMaterials: () => new Map(),
    restoreMaterialStates() {}, prepareGroundDepthMaterials: () => new Map(),
    prepareSubmergedOverlayStencilMaterials: () => new Map(), prepareOverlayCoverTintMaterials: () => new Map(), prepareTintCoverDepthMaterials: () => new Map(),
    waterReplayCount: 0, WATER_REPLAY_MASK: 8, HELD_OVERLAY_MASK: 2, GROUND_REPLAY_MASK: 4,
    rawRender: function(_scene, _camera) {
      const nodes = []; _scene.traverseVisible(node => nodes.push(node));
      draws.push({ mask: _camera.layers.mask, nodes });
      if (fail) throw new Error('render failure');
    },
  };
  for (const name of ['lastBaseElevationGroups', 'lastHeldFullscreenReason', 'fullscreenReplayCount', 'lastReplayScissorCoverage', 'nonGroundDepthReplayCount', 'selectiveOverlayCount', 'groundDepthRestoreCount']) scope[name] = 0;
  vm.createContext(scope);
  vm.runInContext(source.slice(begin, end), scope);
  const before = { ...renderer }; // Verify all ordinary renderer flags restore after success or exceptions.
  const participants = [...(ordinary ? [weapon] : []), ...(bounded ? [hand] : [])]; // Only active sources are hidden by this render.
  const run = () => scope.replaySelectiveHeldOverlay(renderer, scene, camera, participants, [], [opaque], [], [cover], 1);
  if (fail) assert.throws(run, /render failure/); else run();
  assert.equal(opaque.visible, true); assert.equal(cutout.visible, true); assert.equal(cover.visible, true);
  assert.equal(weapon.visible, true); assert.equal(hand.visible, true);
  assert.equal(camera.layers.mask, 1); assert.equal(scene.background, 'sky'); assert.equal(scene.autoUpdate, true);
  assert.equal(renderer.autoClear, before.autoClear); assert.equal(renderer.shadowMap.autoUpdate, true);
  assert.equal(scope.internalReplay, false);
  return { draws, clears, opaque, cutout, cover, parent, hooked, scope };
}
const normal = fixture(); // Common above-floor case: supplement + source draw, without a terrain redraw/restore.
assert.equal(normal.clears, 0);
assert.equal(normal.draws.length, 2);
assert(!normal.draws[0].nodes.includes(normal.opaque), 'opaque terrain is absent from the depth supplement');
for (const required of [normal.cutout, normal.cover, normal.parent, normal.hooked]) assert(normal.draws[0].nodes.includes(required));
const mixed = fixture({ bounded: true }); // The later holder-local floor replay must still rebuild depth normally.
assert.equal(mixed.clears, 1);
assert.equal(mixed.draws.length, 5);
assert(mixed.draws[2].nodes.includes(mixed.opaque), 'bounded x-ray depth retains opaque cover');
assert.equal(fixture({ bounded: true, ordinary: false }).clears, 1);
assert.equal(fixture({ colorLock: false }).clears, 1, 'unsupported renderer uses the original full-depth fallback');
const submerged = fixture({ tint: true }); // Unchanged base ground depth must precede both water tint and cover depth restore.
assert.deepEqual(submerged.draws.map(draw => draw.mask), [1, 2, 8, 8]);
assert.equal(submerged.clears, 0);
const floodedXray = fixture({ bounded: true, tint: true }); // Actual floor exceptions still restore opaque ground before water tint.
assert.deepEqual(floodedXray.draws.map(draw => draw.mask), [1, 2, 1, 2, 4, 8, 8]);
fixture({ fail: true });
console.log('ordinary held replay: 2 passes instead of 3; no opaque terrain depth redraw; mixed/fallback/exception checks passed');
