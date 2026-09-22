#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const read = path => fs.readFileSync(path, 'utf8');
const controller = read('docs/js/controller-ui-nav.js');
const heldRender = read('docs/js/held-object-render-order.js');
const gridSource = read('docs/js/grid-tile-accessors.js');
const idleYaw = read('docs/js/weapon-idle-body-yaw-runtime.js');
const stances = read('docs/js/weapon-tool-stances.js');
const portrait = read('docs/js/portrait-utils.js');
const vegetation = read('docs/js/vegetation-crop-rendering.js'); // Guards the town river-bank billboard clamp that prevents land grass from hanging over water.
const pixelProbe = read('docs/js/pixel-probe.js'); // Guards the mobile-readable bank-clamp diagnostic.

assert.match(controller, /function isActive\(\) \{\s*return stack\.length > 0;\s*\}/,
  'the gameplay panel gate is a cached read with no layout work');
assert.doesNotMatch(controller, /function visiblePanels\(\)[\s\S]{0,220}querySelectorAll/,
  'panel reconciliation iterates registered panel roots rather than scanning the DOM');
assert.match(controller, /transitionend[\s\S]{0,160}scheduleReconcile/,
  'opacity-transition completion refreshes cached panel state without frame polling');

assert.doesNotMatch(heldRender, /\.updateMatrixWorld = function heldGround/,
  'held/ground invariants no longer wrap every matrix update');
assert.match(heldRender, /colorBuffer\.setMask\(false\)[\s\S]{0,100}colorBuffer\.setLocked\(true\)/,
  'the selective depth replay suppresses color through the renderer buffer');
assert.match(heldRender, /prepareCutoutDepthMaterials\(collectVisible\(pngDepthRegistry, scene\)\)/,
  'only registered PNG cutouts receive temporary depth-material repair');
assert.doesNotMatch(heldRender, /forceWaterDepth|waterDepthRegistry/,
  'water must not become a hard depth occluder during the held overlay');
assert.match(heldRender, /prepareHeldStencilMaterials\(held\)[\s\S]{0,600}HELD_OVERLAY_MASK/,
  'held overlay stamps only its visible fragments into stencil');
assert.match(heldRender, /prepareWaterStencilMaterials\(water\)[\s\S]{0,500}WATER_REPLAY_MASK/,
  'water is replayed through its private layer after the held overlay');
assert.match(heldRender, /stencilFunc = THREE\.EqualStencilFunc/,
  'replayed water is limited to held-overlay stencil pixels');
assert.match(heldRender, /stencilWriteMask = 0x00/,
  'water replay tests stencil without overwriting the held mask');
assert.match(heldRender, /renderer\.clearStencil\?\.\(\)/,
  'held/water stencil markers are cleared around the private composite pass');

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

assert.match(vegetation, /const GRASS_BANK_SWAY_MARGIN = 0\.05/,
  'town bank grass reserves enough room for the authored billboard width plus shader wind sway');
assert.match(vegetation, /function _townGrassBankEdges\(townGrid, col, row\)[\s\S]{0,1200}?return west \|\| east \|\| north \|\| south \? \{ west, east, north, south \} : null;/,
  'town grass identifies permanent water along all four sides and river-bend corners');
assert.match(vegetation, /const safeHalfExtent = w \* 0\.5 \+ GRASS_BANK_SWAY_MARGIN;[\s\S]{0,500}?edgeInsets\.south/,
  'bank-aware billboard placement clamps the whole crossed-card footprint instead of only the random root point');
assert.match(vegetation, /_fillBillboardInstances\(townGrassBillMesh, dummy, idx, col, row, 1\.0, tierY, 1, 1, 0, bankEdges\)/,
  'town grass passes its detected bank edges into the shared billboard placement helper');
assert.match(vegetation, /debugGrassBankSnapshot/,
  'the vegetation runtime exposes a lightweight bank-clamp diagnostic');
assert.match(pixelProbe, /Grass bank inset: townTiles=/,
  'Pixel Probe surfaces river-bank grass clamp state on mobile');
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
