#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const read = path => fs.readFileSync(path, 'utf8');
const controller = read('docs/js/controller-ui-nav.js');
const game = read('docs/game.js');
const pixelProbe = read('docs/js/pixel-probe.js');
const heldRender = read('docs/js/held-object-render-order.js');
const feetParity = read('docs/js/procedural-feet-outline-parity.js'); // Guards the explicit foot-only water-occlusion registration and transform parity.
const gridSource = read('docs/js/grid-tile-accessors.js');
const idleYaw = read('docs/js/weapon-idle-body-yaw-runtime.js');
const stances = read('docs/js/weapon-tool-stances.js');
const portrait = read('docs/js/portrait-utils.js');

assert.match(controller, /function isActive\(\) \{\s*return stack\.length > 0;\s*\}/,
  'the gameplay panel gate is a cached read with no layout work');
assert.doesNotMatch(controller, /function visiblePanels\(\)[\s\S]{0,220}querySelectorAll/,
  'panel reconciliation iterates registered panel roots rather than scanning the DOM');
assert.match(controller, /transitionend[\s\S]{0,160}scheduleReconcile/,
  'opacity-transition completion refreshes cached panel state without frame polling');
assert.doesNotMatch(controller, /function navigationTargets\(panel\)[\s\S]{0,500}visiblePanels\(\)/,
  'directional navigation reuses the reconciled panel stack instead of forcing panel visibility/layout checks per move');
assert.match(controller, /const targets = navigationTargets\(panel\);[^\n]*\n[\s\S]{0,220}refreshFocusIfStale\(targets\)/,
  'one target discovery pass is shared with stale-focus validation for each spatial navigation step');
assert.match(controller, /const candidates = targets\.map\(el => \(\{ el, rect: el\.getBoundingClientRect\(\) \}\)\)/,
  'spatial navigation snapshots each candidate rectangle once before cone scoring');
assert.doesNotMatch(controller, /function bestVectorCandidate\([\s\S]{0,420}getBoundingClientRect\(/,
  'narrow, wide, and half-plane scoring reuse rectangle snapshots instead of rereading layout');

assert.doesNotMatch(heldRender, /\.updateMatrixWorld = function heldGround/,
  'held/ground invariants no longer wrap every matrix update');
assert.match(heldRender, /colorBuffer\.setMask\(false\)[\s\S]{0,100}colorBuffer\.setLocked\(true\)/,
  'the selective depth replay suppresses color through the renderer buffer');
assert.match(heldRender, /prepareCutoutDepthMaterials\(collectVisible\(pngDepthRegistry, scene\)\)/,
  'only registered PNG cutouts receive temporary depth-material repair');
assert.doesNotMatch(heldRender, /forceWaterDepth|waterDepthRegistry/,
  'water must not become a hard depth occluder during the held overlay');
assert.match(game, /stencilBuffer: needsStencil/,
  'outline render targets explicitly opt into stencil only when requested');
assert.match(game, /_mainRT\s*=\s*_makeSceneRT\(1, 1, true\)/,
  'the offscreen main gameplay target carries stencil for held-vs-foot water compositing');
assert.match(game, /THREE\.DepthStencilFormat[\s\S]{0,120}THREE\.UnsignedInt248Type/,
  'the main target uses a packed sampleable depth-stencil texture');
assert.match(game, /window\.PixelProbe\?\.armed \|\| menuOpen/,
  'desktop viewport gameplay rejects a pointer while Pixel Probe owns it');
assert.match(pixelProbe, /stopImmediatePropagation\?\.\(\)/,
  'Pixel Probe consumes its sampling pointer before gameplay handlers can attack');
assert.match(pixelProbe, /setTimeout\(\(\) => \{ _pixelProbeArmed = false; \}, 0\)/,
  'Pixel Probe keeps the armed input guard alive through the current event dispatch');
assert.match(heldRender, /currentFramebufferStencilBits\(renderer\)/,
  'held-water compositing verifies stencil support on the actually bound framebuffer');
assert.match(heldRender, /requestedFootWaterComposite && stencilBits >= 2/,
  'foot-only water replay is skipped rather than repainting weapons when a target lacks stencil');
assert.match(heldRender, /function materialLooksLikeGrassBillboard\(material\)/,
  'held x-ray recognizes the shared grass ShaderMaterial even when a runtime consumer uses a plain Mesh');
assert.match(heldRender, /entry\.uniforms\?\.uGrassTex[\s\S]{0,180}entry\.uniforms\?\.uDensity[\s\S]{0,180}entry\.uniforms\?\.uStrength/,
  'grass fallback classification keys off the dedicated wind/grass shader uniforms rather than generic billboard tags');
assert.match(heldRender, /return materialLooksLikeGrassBillboard\(object\.material\)/,
  'submerged grass material cannot survive in the non-ground depth replay and punch holes through held weapons');
assert.match(heldRender, /FOOT_WATER_MASK_LAYER = 26/,
  'procedural feet have a dedicated private stencil layer instead of sharing the weapon overlay');
assert.match(heldRender, /function markWaterOccludedMesh\(mesh\)/,
  'the render policy exposes an explicit registration path for meshes that should remain under water');
assert.match(heldRender, /prepareHeldStencilMaterials\(held\)[\s\S]{0,600}HELD_OVERLAY_MASK/,
  'held weapons and hands still use the selective non-ground x-ray overlay');
assert.match(heldRender, /stencilWriteMask = 0x02[\s\S]{0,140}stencilRef = 2/,
  'held weapon/hand pixels reserve stencil bit 1 so later foot-water compositing cannot paint over them');
assert.match(heldRender, /prepareWaterOcclusionStencilMaterials\(waterOccluded\)[\s\S]{0,500}FOOT_WATER_MASK/,
  'only explicitly water-occluded meshes stamp the foot-water mask');
assert.match(heldRender, /stencilWriteMask = 0x01[\s\S]{0,180}stencilFuncMask = 0x02/,
  'the foot mask writes bit 0 only where the held-object exclusion bit is clear');
assert.match(heldRender, /prepareWaterStencilMaterials\(water\)[\s\S]{0,500}WATER_REPLAY_MASK/,
  'water is replayed through its private layer only after the foot mask exists');
assert.match(heldRender, /stencilWriteMask = 0x00[\s\S]{0,180}stencilFuncMask = 0x01/,
  'water replay reads only the foot mask bit and cannot overwrite stencil');
assert.match(heldRender, /renderer\.clearStencil\?\.\(\)/,
  'held/foot-water stencil markers are cleared around the private composite pass');

const heldOverlayAt = heldRender.indexOf('const heldStencilStates = prepareHeldStencilMaterials(held);'); // Used to guard the intended weapon-before-ground replay ordering.
const groundDepthRestoreAt = heldRender.indexOf('const groundMaterialStates = prepareGroundDepthMaterials(ground);'); // Used to keep raised soil in the depth buffer before water is recomposited.
const footMaskAt = heldRender.indexOf('const footStencilStates = prepareWaterOcclusionStencilMaterials(waterOccluded);'); // Used to prove water targets feet rather than held gear.
const waterCompositeAt = heldRender.indexOf('const waterStencilStates = prepareWaterStencilMaterials(water);'); // Used with footMaskAt to protect the foot-only water policy.
assert.ok(heldOverlayAt >= 0 && groundDepthRestoreAt > heldOverlayAt,
  'weapons/hands are drawn with ground absent before authored ground depth is restored');
assert.ok(footMaskAt > groundDepthRestoreAt && waterCompositeAt > footMaskAt,
  'ground depth is restored before foot masking and water replay, preventing raised-soil tint leakage');

assert.match(feetParity, /markWaterOccludedMesh\?\.\(mesh\)/,
  'procedural feet explicitly register for water occlusion');
assert.match(feetParity, /material\?\.colorWrite !== false/,
  'the colorless foot-water stencil pass cannot replace the visible-foot transform snapshot');
assert.match(feetParity, /return 'water-mask'/,
  'procedural feet recognize the dedicated colorless water-mask pass for transform parity');

assert.match(stances, /function idleBodyYawSnapshot\(target = \{\}\)/,
  'weapon stances expose a lightweight idle-yaw snapshot');
assert.match(idleYaw, /stances\.idleBodyYawSnapshot\(idleState\)/,
  'idle yaw reuses its lightweight state object');
assert.doesNotMatch(idleYaw, /debugSnapshot\(\)/,
  'idle yaw does not allocate the full diagnostic pose tree every frame');
assert.match(idleYaw, /composerChanged \|\| lastYawDeg !== resolvedYawDeg/,
  'unchanged idle yaw does not rewrite the composer channel');

assert.match(portrait, /texture\.generateMipmaps = false;[\s\S]{0,100}texture\.minFilter = THREE\.LinearFilter/,
  'canonical canvas-backed PNG textures do not request mipmap generation');
for (const path of [
  'docs/js/animal-chathead-frame.js',
  'docs/js/generic-hud-icons.js',
  'docs/js/action-arch-icons.js',
  'docs/js/action-arch-icons-fixes.js',
  'docs/js/menu-tab-icon-only.js',
  'docs/js/clothing-weaving-system.js',
  'docs/js/relationships-panel.js',
]) {
  const source = read(path); // Inspected by index so intervening onload/onerror handlers do not make the ordering assertion brittle.
  const imageAt = source.indexOf('new Image()');
  const corsAt = source.indexOf("crossOrigin = 'anonymous'", imageAt);
  const srcAt = source.indexOf('.src =', imageAt);
  assert.ok(imageAt >= 0 && corsAt > imageAt && srcAt > corsAt,
    `${path} selects anonymous CORS before assigning a canvas-bound image source`);
}

const context = { window: {} }; // Receives GridTileAccessors for an allocation/cache behavior test without loading the game.
context.window.BuildingDoor = {
  rotateCell(x, y) { return { x, y }; },
};
vm.runInNewContext(gridSource, context);
const building = { gridX: 10, gridZ: 20, rotationDeg: 0 };
const piece = {
  footprint: {
    cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
    extensions: { porches: [{ x: 0, y: 1 }], railings: [] },
  },
};
context.window.GridTileAccessors.init({
  getCurrentArea: () => 'town',
  getWorldTownTransitions: () => [],
  getTownBuildingGroups: () => [{ bldg: building, piece }],
  getTownBuildingDefs: () => [building],
  _zoneBuildingGroups: new Map(),
  _zoneLayouts: new Map(),
});
assert.equal(context.window.GridTileAccessors.isTownBuildingCollisionTile(10, 20), true,
  'the initial authored collision cell blocks');
assert.equal(context.window.GridTileAccessors.isTownBuildingCollisionTile(11, 20), true,
  'a second query reuses the rotated-cell index');
assert.equal(context.window.GridTileAccessors.isTownBuildingCollisionTile(10, 21), false,
  'walkable footprint extensions remain excluded from collision');
let gridDebug = context.window.GridTileAccessors.debugSnapshot();
assert.deepEqual(JSON.parse(JSON.stringify(gridDebug)), { buildingFootprintCacheBuilds: 1, buildingFootprintCacheHits: 2 },
  'unchanged building collision queries build once and hit thereafter');
building.gridX = 12;
assert.equal(context.window.GridTileAccessors.isTownBuildingCollisionTile(12, 20), true,
  'moving a building invalidates and rebuilds its collision index');
gridDebug = context.window.GridTileAccessors.debugSnapshot();
assert.equal(gridDebug.buildingFootprintCacheBuilds, 2, 'building transform changes invalidate the cache');

console.log('Town render hot-path checks passed.');
