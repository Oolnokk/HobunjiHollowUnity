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
const terrainTileMaterials = read('docs/js/terrain-tile-materials.js'); // Guards grass-only material tags against seasonal texture overrides.
const zoneGrassBillboards = read('docs/js/zone-grass-billboards.js'); // Verifies the authored path-brick group tag used by the held x-ray classifier.
const plateauMesa = read('docs/js/zone-plateau-mesa.js'); // Guards the semantic tag that makes elevated wilderness ground participate in the held overlay.
const interiorBuilder = read('docs/js/interior-scene-builder.js'); // Guards cavern-floor registration for the same global held-object ground policy.
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
assert.doesNotMatch(controller, /new Set\(Object\.values\(UI_ACTIONS\)/,
  'active menu polling reuses edge state instead of allocating a semantic-action Set every controller frame');
assert.match(controller, /const currentBindings = window\.InputBindings\?\.getCurrentBindings\?\.\(\)\?\.controller \|\| null;/,
  'active menu polling snapshots the live controller binding map once per frame');

assert.doesNotMatch(heldRender, /\.updateMatrixWorld = function heldGround/,
  'held/ground invariants no longer wrap every matrix update');
assert.match(heldRender, /colorBuffer\.setMask\(false\)[\s\S]{0,100}colorBuffer\.setLocked\(true\)/,
  'the selective depth replay suppresses color through the renderer buffer');
assert.match(heldRender, /prepareCutoutDepthMaterials\(collectVisible\(pngDepthRegistry, scene\), collectVisible\(protectedCoverRegistry, scene\)\)/,
  'the colorless depth replay includes PNG silhouettes and registered protective surface layers');
assert.match(heldRender, /for \(const object of protectedCover\)[\s\S]{0,200}material\.depthWrite = true/,
  'otherwise-transparent snow/slush, water and billboard grass temporarily write real occlusion depth');
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
  'the protected-cover classifier recognizes billboard-grass ShaderMaterial, even on plain Mesh objects');
assert.match(heldRender, /function isProtectedCover\(object\)[\s\S]{0,200}isGrassGroundCover\(object\) \|\| isWaterSurface\(object\)/,
  'water and standing grass both retain depth while the held x-ray is drawn');
assert.match(heldRender, /object\?\.userData\?\.environmentSurfaceMicroPlateau === true/,
  'snow/slush caps are protected from ground x-ray');
assert.match(heldRender, /if \(object\.userData\?\.environmentSurfaceMicroPlateau === true\) return false/,
  'snow/slush cannot be misclassified as the exempt terrain layer');
assert.match(heldRender, /if \(isProtectedCover\(object\)\) return null;[\s\S]{0,140}if \(isRoadSurface\(object\)\) return 'road';/,
  'snow/slush, water and billboard grass must block held gear, while authored path bricks x-ray like grass');
assert.match(heldRender, /function isRoadSurface\(object\)[\s\S]{0,140}hasAncestorFlag\(object, 'hobunjiPathSurface'\)/,
  'path-brick descendants use their existing semantic path tag rather than a generic material guess');
assert.match(zoneGrassBillboards, /group\.userData\.hobunjiPathSurface = true/,
  'the authored road builder stamps path-brick groups for the held overlay');
// Classify actual mocked scene objects through the shipped helper functions
// rather than relying solely on string-level regex assertions.
const classifierStart = heldRender.indexOf('  function hasLayer('); // First helper used by groundKind's classification chain.
const classifierEnd = heldRender.indexOf('  function isLegacyHeldPlane('); // End marker immediately after the relevant classifiers.
assert.ok(classifierStart >= 0 && classifierEnd > classifierStart, 'extract the same classifier helpers used by the shipped renderer');
const classifyGround = new Function('MATERIAL_ID_LAYER',
  heldRender.slice(classifierStart, classifierEnd) + '\nreturn groundKind;')(3); // Checks semantics without allocating a WebGL renderer.
const pavingGroup = { userData: { hobunjiPathSurface: true }, parent: null }; // The exact ancestor tag applied to road-brick groups.
function coverMesh(data = {}, parent = null, material = { userData: {} }) {
  return { isMesh: true, isSkinnedMesh: false, isInstancedMesh: false, userData: data, parent, material, receiveShadow: false, castShadow: false, layers: { mask: 0 } };
}
assert.equal(classifyGround(coverMesh({}, pavingGroup)), 'road', 'authored paving becomes x-ray ground');
assert.equal(classifyGround(coverMesh({ environmentSurfaceMicroPlateau: true }, pavingGroup)), null, 'snow/slush blocks x-ray even on paving');
assert.equal(classifyGround(coverMesh({ waterSurfaceRole: 'flood' }, pavingGroup)), null, 'water blocks x-ray even on paving');
assert.equal(classifyGround(coverMesh({ isWildernessGrassChunk: true }, pavingGroup)), null, 'billboard grass blocks x-ray even on paving');
assert.equal(classifyGround(coverMesh({ hobunjiGroundSurface: true }, null, { userData: { hobunjiBaseGrassTerrainMaterial: true } })), 'terrain', 'underlying grass x-rays');
assert.equal(classifyGround(coverMesh({ cavernWalkableFloor: true })), null, 'cavern floors remain solid occluders');
assert.match(heldRender, /materialMarksBaseGrass\(object\?\.material\) && isTerrainSurface\(object\)/,
  'only surfaces carrying the base grass material can be removed from held-overlay depth');
assert.match(terrainTileMaterials, /matKey === deps\.TileType\.GRASS[\s\S]{0,180}hobunjiBaseGrassTerrainMaterial = true/,
  'the live game tags the native base grass material');
assert.match(terrainTileMaterials, /loadTerrainTileTexture[\s\S]{0,200}matKey === deps\.TileType\.GRASS[\s\S]{0,220}hobunjiBaseGrassTerrainMaterial = true/,
  'authored texture overrides keep the exact same base grass tag');
assert.doesNotMatch(heldRender, /if \(isTopFacesGroundSurface\(object\)\) markTopFaceGroundMesh\(object\)/,
  'cavern shells are not hidden just because they contain an upward-facing floor');
assert.match(plateauMesa, /mesh\.userData\.hobunjiGroundSurface = true/,
  'raised wilderness mesa surfaces explicitly register as ground');
assert.match(interiorBuilder, /cavernWalkableFloor: true,[\s\S]{0,120}hobunjiGroundSurface: true/,
  'cavern walkable surfaces still carry terrain semantics, independent of their x-ray exemption');
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
assert.match(heldRender, /stencilWriteMask = 0x01[\s\S]{0,180}stencilFuncMask = 0xFF/,
  'the pre-rebuild foot mask stamps bit 0 before held pixels populate bit 1');
assert.doesNotMatch(heldRender, /function prepareWaterOcclusionStencilMaterials\([\s\S]*?function prepareWaterStencilMaterials[\s\S]*?material\.depthTest = false/,
  'the foot mask must preserve depth testing against solid geometry');
assert.match(heldRender, /prepareWaterStencilMaterials\(water\)[\s\S]{0,500}WATER_REPLAY_MASK/,
  'water is replayed through its private layer only after the foot mask exists');
assert.match(heldRender, /stencilWriteMask = 0x00[\s\S]{0,180}stencilFuncMask = 0x03/,
  'water replay reads both stencil bits: visible foot present and no overlying weapon');
assert.match(heldRender, /renderer\.clearStencil\?\.\(\)/,
  'held/foot-water stencil markers are cleared around the private composite pass');

const heldOverlayAt = heldRender.indexOf('const heldStencilStates = prepareHeldStencilMaterials(held);'); // Used to guard the intended weapon-before-ground replay ordering.
const groundDepthRestoreAt = heldRender.indexOf('const groundMaterialStates = prepareGroundDepthMaterials('); // Used to keep raised soil in the depth buffer before water is recomposited.
const footMaskAt = heldRender.indexOf('const footStencilStates = prepareWaterOcclusionStencilMaterials(waterOccluded);'); // Used to prove water targets feet rather than held gear.
const waterCompositeAt = heldRender.indexOf('const waterStencilStates = prepareWaterStencilMaterials(water);'); // Used with footMaskAt to protect the foot-only water policy.
const depthClearAt = heldRender.indexOf('renderer.clearDepth();'); // The foot stencil must be recorded against base depth, before the x-ray reconstructs water depth.
assert.ok(footMaskAt >= 0 && footMaskAt < depthClearAt && heldOverlayAt > depthClearAt,
  'visible feet are stamped against the base depth before transparent water becomes a weapon occluder');
assert.ok(heldOverlayAt < groundDepthRestoreAt && groundDepthRestoreAt < waterCompositeAt,
  'weapons are drawn before restoring ground depth and compositing only visible foot-water pixels');

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
  let checked = 0;
  for (let imageAt = source.indexOf('new Image()'); imageAt >= 0; imageAt = source.indexOf('new Image()', imageAt + 1)) {
    const lineStart = source.lastIndexOf('\n', imageAt) + 1;
    if (/^\s*\/\//.test(source.slice(lineStart, imageAt))) continue; // Mentioned in a comment, not code.
    const srcAt = source.indexOf('.src =', imageAt);
    if (srcAt < 0) continue;
    const srcLine = source.slice(srcAt, source.indexOf('\n', srcAt));
    if (/toDataURL\(|['"`]data:/.test(srcLine)) continue; // Same-origin data URLs cannot taint a canvas.
    const corsAt = source.indexOf("crossOrigin = 'anonymous'", imageAt);
    assert.ok(corsAt > imageAt && corsAt < srcAt,
      `${path} selects anonymous CORS before assigning a canvas-bound image source (new Image() at offset ${imageAt})`);
    checked++;
  }
  assert.ok(checked > 0, `${path} still loads at least one canvas-bound image`);
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
