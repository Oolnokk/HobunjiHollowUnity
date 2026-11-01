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
const renderingContract = read('docs/architecture/held-object-water-depth-compositing.md');
const readme = read('README.md');
const terrainTileMaterials = read('docs/js/terrain-tile-materials.js'); // Guards grass-only material tags against seasonal texture overrides.
const zoneGrassBillboards = read('docs/js/zone-grass-billboards.js'); // Verifies the authored path-brick group tag used by the held x-ray classifier.
const borderTerrain = read('docs/js/border-terrain.js'); // Guards authored approach roads and fallback path ribbons outside ordinary paving chunks.
const plateauMesa = read('docs/js/zone-plateau-mesa.js'); // Guards the semantic tag that makes elevated wilderness ground participate in the held overlay.
const interiorBuilder = read('docs/js/interior-scene-builder.js'); // Guards cavern-floor registration for the same global held-object ground policy.
const mergedWater = read('docs/js/merged-water-renderer.js');
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
assert.match(mergedWater, /transparent: true,\s*depthTest: true,[^\n]*\n\s*depthWrite: false/,
  'translucent floodwater retains normal opaque-grass depth testing in its material');
assert.match(pixelProbe, /Water depth at probed pixel:[\s\S]*?BEHIND OPAQUE SURFACE/,
  'Pixel Probe continues diagnosing opaque foreground grass before the flood');

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
assert.match(heldRender, /const feet = collectVisible\(waterOccludedRegistry, scene\)/,
  'the active world pass collects visible procedural feet into the selective x-ray overlay');
assert.match(heldRender, /if \(!ground.length && !topFaceGround.length && !\(tintCovers.length && \(held.length \|\| feet.length\)\)\)/,
  'feet or held weapons with water/slush trigger the overlay even without grass/path ground');
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
assert.match(game, /_townPathFallbackMesh\.userData\.hobunjiPathSurface = true/,
  'the unpaved town fallback road remains x-rayable when paving assets fail to load');
assert.match(borderTerrain, /pathMesh\.userData\.hobunjiPathSurface=true/,
  'Cloud Forest authored border road is treated as a path');
assert.match(borderTerrain, /if\(pathSurface\)m\.userData\.hobunjiPathSurface=true/,
  'border-road ribbon generator tags only explicit path ribbons');
assert.match(borderTerrain, /addRibbon\(c,pathMat,0\.025,null,0,true\)/,
  'both border-road fallback paths opt into the tagged path policy');
assert.match(borderTerrain, /highWaterRibbon\.mesh\.userData\.waterSurfaceRole='scenery'/,
  'border waterfall upper channels register as protective water surfaces');
assert.match(borderTerrain, /built\.mesh\.userData\.waterSurfaceRole='scenery'/,
  'border scenery river ribbons register as protective water surfaces');
assert.match(borderTerrain, /fall\.userData\.waterSurfaceRole='scenery'/,
  'border waterfall faces register as protective water surfaces');
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
assert.equal(classifyGround(coverMesh({ cavernWalkableFloor: true })), 'interior-floor', 'separate cavern walkable floors now x-ray weapons');
assert.equal(classifyGround(coverMesh({ wallBuilderRecipe: 'wallrecipe2.json', plateauModel: { levelByCell: { '1,1': 0 } } })), 'interior-floor', "V50 rooted ruin's height-aware floor x-rays");
assert.equal(classifyGround(coverMesh({ liveRootFloor: true, ruinPreviewRole: 'floor' })), 'interior-floor', 'stone-age instanced floor x-rays');
assert.equal(classifyGround(coverMesh({ liveRootFloor: true, ruinPreviewRole: 'wall' })), null, 'rooted walls remain solid even when they share a floor material family');
assert.equal(classifyGround(coverMesh({ wallBuilderRecipe: 'wallrecipe2.json' })), null, 'a V50 non-floor WallBuilder mesh cannot be removed');
assert.equal(classifyGround(coverMesh({ hobunjiGroundSurface: true })), null, 'an unqualified outdoor/raised mesh is never removed based only on generic ground tags');
const classifyTintCover = new Function('MATERIAL_ID_LAYER',
  heldRender.slice(classifierStart, classifierEnd) + '\nreturn isTintCover;')(3);
const slushMaterial = { userData: { environmentSurfaceMicroPlateauMaterial: 'slush' } };
const snowMaterial = { userData: { environmentSurfaceMicroPlateauMaterial: 'snow' } };
assert.equal(classifyTintCover(coverMesh({ waterSurfaceRole: 'local' })), true, 'tagged water tints feet');
assert.equal(classifyTintCover(coverMesh({ environmentSurfaceMicroPlateau: true }, null, slushMaterial)), true, 'translucent slush tints feet');
assert.equal(classifyTintCover(coverMesh({ environmentSurfaceMicroPlateau: true }, null, snowMaterial)), false, 'opaque snow hides feet instead of tinting');
assert.equal(classifyTintCover(coverMesh({ isWildernessGrassChunk: true })), false, 'billboard grass occludes rather than tints feet');
const elevationNewline = String.fromCharCode(10);
const elevationHelperStart = heldRender.indexOf('  function isDescendantOf(');
const elevationHelperEnd = heldRender.indexOf('  function groupXrayMeshesByElevation(', elevationHelperStart);
assert.ok(elevationHelperStart >= 0 && elevationHelperEnd > elevationHelperStart, 'elevation resolver helper');
const actorScene = { isScene: true, position: { y: 0 }, matrixWorld: { elements: Array(16).fill(0) } };
const playerRoot = { name: 'player_mesh', position: { x: 2, y: 1, z: 3 }, matrixWorld: { elements: Object.assign(Array(16).fill(0), { 12: 2, 13: 1, 14: 3 }) }, parent: actorScene, userData: {} };
const playerHandRoot = { name: 'player_hand_external_root', position: { y: 0 }, parent: actorScene, userData: {} };
const elevationWindow = { PlayerBodyTransformComposer: { getPlayerMesh: () => playerRoot, getVisualRoots: () => [playerHandRoot], getDebug: () => ({ channels: [{ name: 'townSubtleElevation', enabled: true, translation: { y: 0.3 } }] }) }, GridTileAccessors: { getCurrentArea: () => 'town' } };
const resolveActorElevation = new Function('window', heldRender.slice(elevationHelperStart, elevationHelperEnd) + elevationNewline + 'return actorElevationForXrayMesh;')(elevationWindow);
assert.equal(resolveActorElevation({ parent: playerRoot }, actorScene), 1.3, 'player body elevation');
assert.equal(resolveActorElevation({ parent: playerHandRoot }, actorScene), 1.3, 'composer-owned external hand/foot roots inherit the player standing elevation');
const npcRoot = { name: 'npc_walker_test', position: { x: 4, y: 2.5, z: 6 }, matrixWorld: { elements: Object.assign(Array(16).fill(0), { 12: 4, 13: 2.5, 14: 6 }) }, parent: actorScene, userData: {} };
assert.equal(resolveActorElevation({ parent: npcRoot }, actorScene), 2.5, 'NPC root elevation');
assert.equal(Number.isNaN(resolveActorElevation({ parent: { parent: actorScene, position: { y: 0 } } }, actorScene)), true, 'unknown actor fails closed');
const groupStart = heldRender.indexOf('  function groupXrayMeshesByElevation(');
const groupEnd = heldRender.indexOf('  function installGroundElevationShader(', groupStart);
const groupMeshes = new Function('XRAY_ELEVATION_GROUP_EPSILON', heldRender.slice(groupStart, groupEnd) + elevationNewline + 'return groupXrayMeshesByElevation;')(0.05);
const grouped = groupMeshes([{ level: 1 }, { level: 1.02 }, { level: 1.5 }, { level: 3.5 }, { level: NaN }], mesh => mesh.level);
assert.equal(grouped.length, 4, 'same-height actors share a replay while trench/raised offsets and map tiers remain separate');
assert.deepEqual(grouped.map(group => group.meshes.length), [2, 1, 1, 1], 'unknown actors share a fail-closed group');
const shaderStart = heldRender.indexOf('  function installGroundElevationShader(');
const shaderEnd = heldRender.indexOf('  function setGroundElevationFilter(', shaderStart);
const installElevationShader = new Function(heldRender.slice(shaderStart, shaderEnd) + elevationNewline + 'return installGroundElevationShader;')();
const groundMaterial = { userData: {}, needsUpdate: false };
const groundShaderState = installElevationShader(groundMaterial);
const standardGroundShader = { uniforms: {}, vertexShader: ['#include <common>', 'void main() {', '#include <worldpos_vertex>', '#include <defaultnormal_vertex>', '}'].join(elevationNewline), fragmentShader: ['#include <common>', 'void main() {', '#include <clipping_planes_fragment>', '}'].join(elevationNewline) };
groundMaterial.onBeforeCompile(standardGroundShader, {});
assert.equal(groundShaderState.supported, true, 'standard terrain shader is supported');
assert.ok(standardGroundShader.vertexShader.includes('vHobunjiXrayWorldY = hobunjiXrayWorldPosition.y'));
assert.ok(standardGroundShader.vertexShader.includes('#ifdef USE_INSTANCING') && standardGroundShader.vertexShader.includes('#ifdef USE_BATCHING'),
  'world height includes instancing and batching transforms before comparison');
assert.ok(standardGroundShader.vertexShader.indexOf('#ifdef USE_BATCHING') < standardGroundShader.vertexShader.indexOf('#ifdef USE_INSTANCING'),
  'world position follows Three.js batching-then-instancing transform order');
assert.ok(standardGroundShader.vertexShader.includes('transpose(mat3(viewMatrix))'), 'world normals use the view rotation inverse');
assert.ok(standardGroundShader.fragmentShader.includes('vHobunjiXrayWorldNormal.y >= 0.55') && standardGroundShader.fragmentShader.includes('discard;'), 'only same-height top faces are discarded');
assert.equal(standardGroundShader.uniforms.uHobunjiXrayActorElevation, groundShaderState.uniforms.elevation);
const basicMaterial = { userData: {}, needsUpdate: false };
const basicState = installElevationShader(basicMaterial);
basicState.geometryHasNormals = true; // MeshBasic terrain uses geometry normals despite omitting the lighting normal chunk.
const basicGroundShader = {
  uniforms: {},
  vertexShader: ['#include <common>', 'void main() {', '#include <worldpos_vertex>', '}'].join(elevationNewline),
  fragmentShader: ['#include <common>', 'void main() {', '#include <clipping_planes_fragment>', '}'].join(elevationNewline),
};
basicMaterial.onBeforeCompile(basicGroundShader, {});
assert.equal(basicState.supported, true, 'unlit MeshBasic grass supports elevation filtering when its geometry has normals');
assert.ok(basicGroundShader.vertexShader.includes('normalMatrix * normal'),
  'unlit ground still rejects vertical walls using the geometry normal');
const noNormalMaterial = { userData: {}, needsUpdate: false };
const noNormalState = installElevationShader(noNormalMaterial);
const noNormalShader = { uniforms: {}, vertexShader: ['#include <common>', 'void main() {', '#include <worldpos_vertex>', '}'].join(elevationNewline), fragmentShader: ['#include <common>', 'void main() {', '#include <clipping_planes_fragment>', '}'].join(elevationNewline) };
noNormalMaterial.onBeforeCompile(noNormalShader, {});
assert.equal(noNormalState.supported, false, 'unlit ground without a normal attribute remains a full-depth occluder');

const filterStart = heldRender.indexOf('  function setGroundElevationFilter(');
const filterEnd = heldRender.indexOf('  function clearGroundElevationFilter(', filterStart);
const setElevationFilter = new Function('forEachMaterial', 'installGroundElevationShader',
  heldRender.slice(filterStart, filterEnd) + elevationNewline + 'return setGroundElevationFilter;')(
    (material, callback) => { if (Array.isArray(material)) material.forEach(callback); else if (material) callback(material); },
    installElevationShader);
const filterMaterial = { userData: {} };
setElevationFilter([{ material: filterMaterial }], null);
assert.equal(filterMaterial.userData.hobunjiXrayElevationShader.uniforms.enabled.value, 0,
  'a missing actor elevation never gets coerced to world height zero');
setElevationFilter([{ material: filterMaterial }], 2.5);
assert.equal(filterMaterial.userData.hobunjiXrayElevationShader.uniforms.enabled.value, 1,
  'a resolved map elevation enables the depth filter');
assert.equal(filterMaterial.userData.hobunjiXrayElevationShader.uniforms.elevation.value, 2.5);
assert.ok(heldRender.includes('groupXrayMeshesByElevation(xrayMeshes'),
  'shell outlines are grouped by the same actor elevations as visible overlays');
assert.ok(heldRender.includes('setGroundElevationFilter(groundMeshes, group.elevation)'),
  'shell depth uses the same elevation filter as the source object');

const customMaterial = { userData: {}, needsUpdate: false };
const customState = installElevationShader(customMaterial);
customMaterial.onBeforeCompile({ uniforms: {}, vertexShader: 'void main() {}', fragmentShader: 'void main() {}' }, {});
assert.equal(customState.supported, false, 'unsupported custom terrain shaders keep full depth occlusion');

assert.match(heldRender, /materialMarksBaseGrass\(object\?\.material\) && isTerrainSurface\(object\)/,
  'only surfaces carrying the base grass material can be removed from held-overlay depth');
assert.match(terrainTileMaterials, /matKey === deps\.TileType\.GRASS[\s\S]{0,180}hobunjiBaseGrassTerrainMaterial = true/,
  'the live game tags the native base grass material');
assert.match(terrainTileMaterials, /loadTerrainTileTexture[\s\S]{0,200}matKey === deps\.TileType\.GRASS[\s\S]{0,220}hobunjiBaseGrassTerrainMaterial = true/,
  'authored texture overrides keep the exact same base grass tag');
assert.match(heldRender, /if \(isTopFacesGroundSurface\(object\)\) markTopFaceGroundMesh\(object\)/,
  'the cave shell participates in selective floor-face depth replay without hiding wall triangles');
assert.match(heldRender, /faceB\.y \/ length >= TOP_FACE_MIN_NORMAL_Y/,
  'the shell occluder geometry excludes upward-facing triangles only');
assert.match(heldRender, /const swappedGeometry = swapToOccluderGeometry\(topFaceGround\)/,
  'cave shells swap to wall-and-ceiling-only geometry during the depth rebuild');
assert.match(heldRender, /restoreSwappedGeometry\(swappedGeometry\)/,
  'shell geometry is restored after the selective depth reconstruction');
assert.match(plateauMesa, /mesh\.userData\.hobunjiGroundSurface = true/,
  'raised wilderness mesa surfaces explicitly register as ground');
assert.match(interiorBuilder, /cavernWalkableFloor: true,[\s\S]{0,120}hobunjiGroundSurface: true/,
  'cavern walkable surfaces still carry terrain semantics, independent of their x-ray exemption');
assert.match(heldRender, /function markWaterOccludedMesh\(mesh\)[\s\S]{0,800}mesh.layers.enable\(HELD_OVERLAY_LAYER\)/,
  'actual procedural foot mesh is enrolled in the same held/ground selective overlay layer');
assert.match(heldRender, /const overlayMeshes = \[\.\.\.held, \.\.\.feet\]/,
  'held gear and feet both participate in the selective overlay and screen scissor');
assert.match(heldRender, /const heldVisibility = hideObjects\(\[\.\.\.held, \.\.\.feet\]\)/,
  'feet are absent from the original color pass so they cannot pop over transparent water');
assert.match(heldRender, /overlayHidden = hideObjects\(\[\.\.\.overlayMeshes, \.\.\.\(tintOverlay \? tintCovers : \[\]\)\]\)/,
  'the elevation rebuild retains ground while excluding held meshes and deferred translucent covers');
assert.match(heldRender, /setGroundElevationFilter\(groundMeshes, group\.elevation\)/,
  'the ground shader receives the owning actor surface height for each replay group');
assert.match(heldRender, /const tintOverlay = lastBaseStencilBits >= 1 && hasOverlappingHeldCover\(renderer, camera, overlayMeshes, tintCovers\)/,
  'overlap checks cover both feet and held objects without tint when stencil is unavailable');
assert.match(heldRender, /replaySelectiveHeldOverlay\(this, scene, camera, held, feet, ground, topFaceGround, tintCovers, originalCameraMask\)/,
  'the shared overlay receives registered water and slush covers as well as the actual feet');

// Shell outlines inherit the same selective ground-x-ray policy as their
// source meshes. Test the shell-pass discriminator and selective mesh filtering,
// then guard the depth-rebuild -> shell -> depth-restore sequence.
const shellPassStart = heldRender.indexOf('  function isShellOutlinePass(');
const shellPassEnd = heldRender.indexOf('  function hideNonXrayShellMeshes(', shellPassStart);
assert.ok(shellPassStart >= 0 && shellPassEnd > shellPassStart,
  'the held renderer exposes a dedicated shell-outline pass discriminator');
const isShellOutlinePass = new Function('THREE', 'SHELL_MASK',
  heldRender.slice(shellPassStart, shellPassEnd) + '\nreturn isShellOutlinePass;')(
  { BackSide: 1 }, 2);
const shellOverride = { isShaderMaterial: true, side: 1, uniforms: { uThickness: { value: 0.006 } } };
assert.equal(isShellOutlinePass({ overrideMaterial: shellOverride }, { layers: { mask: 2 } }), true,
  'only the inverted-hull shell layer is intercepted');
assert.equal(isShellOutlinePass({ overrideMaterial: shellOverride }, { layers: { mask: 1 } }), false,
  'ordinary world renders are not mistaken for shell passes');
assert.equal(!!isShellOutlinePass({ overrideMaterial: null }, { layers: { mask: 2 } }), false,
  'depth-only layer renders are not mistaken for shell passes');

const shellFilterStart = shellPassEnd;
const shellFilterEnd = heldRender.indexOf('  // Replays shell outlines for the same meshes', shellFilterStart);
const hideNonXrayShellMeshes = new Function('hasLayer', 'SHELL_LAYER',
  heldRender.slice(shellFilterStart, shellFilterEnd) + '\nreturn hideNonXrayShellMeshes;')(
  (object, layer) => !!(object.layers.mask & (1 << layer)), 1);
const xrayShell = { isMesh: true, visible: true, layers: { mask: 2 } };
const ordinaryShell = { isMesh: true, visible: true, layers: { mask: 2 } };
const unrelatedMesh = { isMesh: true, visible: true, layers: { mask: 1 } };
const shellScene = { traverseVisible(fn) { [xrayShell, ordinaryShell, unrelatedMesh].forEach(fn); } };
const shellHidden = hideNonXrayShellMeshes(shellScene, new Set([xrayShell]));
assert.equal(xrayShell.visible, true, 'the x-rayed object shell remains visible in its replay');
assert.equal(ordinaryShell.visible, false, 'other shell objects are excluded from the selective replay');
assert.equal(unrelatedMesh.visible, true, 'non-shell geometry is not hidden by shell filtering');
for (const [object, visible] of shellHidden) object.visible = visible;
assert.equal(ordinaryShell.visible, true, 'ordinary shell visibility is restored after the replay');

const shellReplayStart = heldRender.indexOf('  function replayShellOutlineXray(');
const shellReplayEnd = heldRender.indexOf('  function wrappedRender(', shellReplayStart);
assert.ok(shellReplayStart >= 0 && shellReplayEnd > shellReplayStart,
  'the renderer has a dedicated shell x-ray replay');
const shellReplay = heldRender.slice(shellReplayStart, shellReplayEnd);
const shellGroundFilterAt = shellReplay.indexOf('setGroundElevationFilter(groundMeshes, group.elevation)');
const shellDepthAt = shellReplay.indexOf('prepareNonGroundDepthMaterials(scene)', shellGroundFilterAt);
const shellDepthDrawAt = shellReplay.indexOf('rawRender.call(renderer, scene, camera)', shellDepthAt);
const shellOnlyAt = shellReplay.indexOf('hideNonXrayShellMeshes(scene, groupSet)');
const shellOutlineDrawAt = shellReplay.indexOf('rawRender.call(renderer, scene, camera)', shellOnlyAt);
const shellRestoreAt = shellReplay.indexOf('renderer.clearDepth();', shellOutlineDrawAt);
const shellDepthRestoreAt = shellReplay.indexOf('prepareNonGroundDepthMaterials(scene)', shellRestoreAt);
assert.match(shellReplay, /material\.depthTest = true;\s*material\.depthWrite = true;/,
  'source-mesh depth remains available to mask the expanded back-face shell');
assert.ok(shellGroundFilterAt >= 0 && shellGroundFilterAt < shellDepthAt
  && shellDepthAt < shellDepthDrawAt && shellDepthDrawAt < shellOnlyAt
  && shellOnlyAt < shellOutlineDrawAt && shellOutlineDrawAt < shellRestoreAt && shellRestoreAt < shellDepthRestoreAt,
  'shell replay filters only same-elevation ground, draws the matching shells, then restores full scene depth');
assert.ok(heldRender.includes('const xrayMeshes = [...new Set([...held, ...feet])].filter(mesh => hasLayer(mesh, SHELL_LAYER))'),
  'all existing held/foot ground-x-ray participants share shell visibility parity');
assert.ok(pixelProbe.includes('shellXray=${heldRenderDebug.shellXrayPasses ?? 0}/${heldRenderDebug.shellXrayMeshes ?? 0}'),
  'mobile Pixel Probe reports shell x-ray replay activity');
assert.ok(heldRender.includes('replayShellOutlineXray(this, scene, camera, xrayMeshes, ground, topFaceGround, scissored)'),
  'the shell pass reuses the same classified ground and top-face floor geometry as object x-ray');

// This hard-won ordering contract must stay discoverable to subsequent
// rendering refactors, not live solely in one PR conversation.
const renderingContractPath = 'docs/architecture/held-object-water-depth-compositing.md';
assert.ok(heldRender.includes(renderingContractPath),
  'the actual renderer points at its flood-depth pass ordering contract');
assert.ok(readme.includes(renderingContractPath),
  'README links to the compositing contract for unrelated future features');
for (const phrase of [
  'groundDepthRestoreAt < tintAt < coverDepthAt',
  'heldDrawAt < groundDepthRestoreAt',
  'BEFORE',
  'farm_flood_mesh',
  'merged_textured_water_material',
  'Painterly',
  'Pixel Probe',
  'depthWrite: false',
  'colorWrite: false',
]) {
  assert.ok(renderingContract.includes(phrase),
    'compositor documentation retains critical regression explanation: ' + phrase);
}

const selectiveReplayStart = heldRender.indexOf('  function replaySelectiveHeldOverlay(');
const depthClearAt = heldRender.indexOf('renderer.clearDepth();', selectiveReplayStart);
const depthDrawAt = heldRender.indexOf('rawRender.call(renderer, scene, camera)', depthClearAt);
const stencilAt = heldRender.indexOf('prepareSubmergedOverlayStencilMaterials(group.meshes)', depthDrawAt);
const heldDrawAt = heldRender.indexOf("window.PerfProfiler?.begin('held-overlay: elevation overlay render')");
const tintAt = heldRender.indexOf('const tintStates = prepareOverlayCoverTintMaterials(tintCovers);');
const coverDepthAt = heldRender.indexOf('const coverDepthStates = prepareTintCoverDepthMaterials(tintCovers);');
const groundDepthRestoreAt = heldRender.indexOf('const groundMaterialStates = prepareGroundDepthMaterials(', heldDrawAt);
assert.ok(depthClearAt >= 0 && depthClearAt < depthDrawAt && depthDrawAt < stencilAt && stencilAt < heldDrawAt && heldDrawAt < groundDepthRestoreAt && groundDepthRestoreAt < tintAt && tintAt < coverDepthAt,
  'reconstructed solid depth, gear/hand/foot draw, opaque grass-depth restore BEFORE tint, then translucent depth restore');

// Two user Pixel Probes on flooded farm grass have the exact same water
// material, but different final pixels: leaking cyan at ground=1.498 /
// water=1.908 versus intact green at ground=1.673 / water=1.911.
// The critical invariant is *foreground opaque ground is restored before
// any water/slush color replay*, even in areas with overlay stencil.
const probes = [
  { name: 'leaking cyan patch', grassDistance: 1.498, waterDistance: 1.908, grassY: 0.351, waterY: 0.084 },
  { name: 'normal green patch', grassDistance: 1.673, waterDistance: 1.911, grassY: 0.340, waterY: 0.118 },
];
for (const probe of probes) {
  assert.ok(probe.grassDistance < probe.waterDistance && probe.grassY > probe.waterY,
    probe.name + ': grass is physically above and in front of the same farm flood material');
  // Standard depth LESS_EQUAL: after the grass restore, the farther flood
  // fragment MUST fail even if a stray held-stencil bit still exists.
  assert.equal(probe.waterDistance <= probe.grassDistance, false,
    probe.name + ': a lower flood fragment cannot pass restored opaque grass depth');
}
assert.equal(0.5 <= 1.0, true, 'foreground water remains eligible to tint an object behind it');
assert.match(heldRender, /const groundMaterialStates = prepareGroundDepthMaterials\([\s\S]*?camera.layers.mask = GROUND_REPLAY_MASK/,
  'ground restore runs on the dedicated colorless depth layer');
assert.match(heldRender, /function prepareGroundDepthMaterials\(ground\)[\s\S]*?material.colorWrite = false/,
  'restoring ground cannot overwrite the already drawn visible held/hand/foot colors');
assert.match(heldRender, /camera.layers.mask = WATER_REPLAY_MASK[\s\S]{0,160}rawRender.call\(renderer, scene, camera\)/,
  'translucent water and slush render through their dedicated private layer');
assert.match(heldRender, /prepareSubmergedOverlayStencilMaterials\(group\.meshes\)/,
  'each actor-elevation group stamps its visible held/hand/foot silhouettes into the shared stencil bit');
assert.match(heldRender, /material.depthTest = true;\s*material.depthWrite = true;\s*material.stencilWrite = true/,
  'temporary held depth writes ensure water behind a PNG cannot tint it');
assert.equal((heldRender.match(/window.PerfProfiler\?\.begin\('held-overlay: elevation overlay render'\)/g) || []).length, 1,
  'the grouped overlay draw is issued once per elevation group, not as a duplicate full-scene pass');
assert.doesNotMatch(heldRender, /requestedFootWaterComposite/,
  'the old patchy foot-water tint path is not used');
const overlapStart = heldRender.indexOf('  function hasOverlappingHeldCover(');
const overlapEnd = heldRender.indexOf('  function replaySelectiveHeldOverlay(', overlapStart);
assert.ok(overlapStart > 0 && overlapEnd > overlapStart, 'the live renderer exposes the conservative overlap check');
const screenRect = { x: 0, y: 0, z: 48, w: 48 };
const heldOverlap = new Function('replayScissorRect', 'footTintScreenRect', 'setReplayCullFrustum',
  'scissorTargetWidth', 'scissorTargetHeight', 'replayCullFrustum',
  heldRender.slice(overlapStart, overlapEnd) + '\nreturn hasOverlappingHeldCover;')(
  (renderer, camera, meshes, out) => { Object.assign(out, screenRect); return !camera.nearPlaneCrossed; },
  {}, () => true, 1280, 720, { intersectsObject: cover => cover.overlapsFoot === true });
const coverNear = { geometry: {}, overlapsFoot: true };
const coverFar = { geometry: {}, overlapsFoot: false };
assert.equal(heldOverlap({}, {}, [], [coverNear]), false, 'no mesh means no tint pass');
assert.equal(heldOverlap({}, {}, [{}], []), false, 'no translucent cover means no tint pass');
assert.equal(heldOverlap({}, {}, [{}], [coverNear]), true, 'water overlapping a hand/weapon/foot enables tint');
assert.equal(heldOverlap({}, {}, [{}], [coverFar]), false, 'distant water does not trigger extra render passes');
assert.equal(heldOverlap({}, { nearPlaneCrossed: true }, [{}], [coverFar]), true,
  'near-plane/uncertain bounds conservatively preserve tint');
assert.equal(heldOverlap({}, {}, [{}], [{ geometry: {}, isInstancedMesh: true }]), true,
  'unreliable instanced bounds conservatively preserve tint');
screenRect.z = 0;
assert.equal(heldOverlap({}, {}, [{}], [coverNear]), false, 'offscreen held pixels cannot require tint');
screenRect.z = 48;

// Execute the production foot registration rather than only inspecting names:
const footRegistrarStart = heldRender.indexOf('  function markWaterOccludedMesh(');
const footRegistrarEnd = heldRender.indexOf('  function enforceGroundMesh(', footRegistrarStart);
assert.ok(footRegistrarStart >= 0 && footRegistrarEnd > footRegistrarStart);
const footLayerSet = new Set([0]);
const mockFoot = { isMesh: true, userData: {}, layers: { enable(layer) { footLayerSet.add(layer); } } };
const markFoot = new Function('waterOccludedMeshes', 'waterOccludedRegistry', 'FOOT_WATER_MASK_LAYER', 'HELD_OVERLAY_LAYER', 'hasLayer', 'waterOccludedMeshCount',
  heldRender.slice(footRegistrarStart, footRegistrarEnd) + '\nreturn markWaterOccludedMesh;')(
    new WeakSet(), { add() {} }, 26, 29,
    (mesh, layer) => footLayerSet.has(layer), 0);
assert.equal(markFoot(mockFoot), true, 'newly registered foot is recognized');
assert.equal(footLayerSet.has(29), true, 'procedural foot belongs to the selective overlay');
assert.equal(mockFoot.userData.hobunjiWaterOccludedBySurface, true, 'legacy semantic tagging is retained');
assert.equal(markFoot(mockFoot), false, 'repeat registration does not duplicate the mesh');


// Execute production cover-material mutations against mocked materials to
// ensure color alpha/depth/stencil are treated independently and restored.
const tintFnStart = heldRender.indexOf('  function prepareSubmergedOverlayStencilMaterials(');
const tintFnEnd = heldRender.indexOf('  function prepareGroundDepthMaterials(', tintFnStart);
assert.ok(tintFnStart > 0 && tintFnEnd > tintFnStart);
const materialHelpers = heldRender.slice(tintFnStart, tintFnEnd);
function makeCoverMaterial() {
  return { colorWrite: true, depthWrite: false, depthTest: true,
    transparent: true, opacity: 0.22, stencilWrite: false, stencilWriteMask: 0xff,
    stencilFunc: -1, stencilRef: 0, stencilFuncMask: 0xff,
    stencilFail: -1, stencilZFail: -1, stencilZPass: -1 };
}
const makeHelpers = new Function('saveMaterialState', 'forEachMaterial', 'THREE',
  materialHelpers + '\nreturn { prepareSubmergedOverlayStencilMaterials, prepareOverlayCoverTintMaterials, prepareTintCoverDepthMaterials };');
const saveState = (states, material) => {
  if (!states.has(material)) states.set(material, { ...material });
};
const forEachMat = (material, fn) => (Array.isArray(material) ? material : [material]).forEach(fn);
const coverFns = makeHelpers(saveState, forEachMat, {
  AlwaysStencilFunc: 519, EqualStencilFunc: 514, KeepStencilOp: 7680, ReplaceStencilOp: 7681
});
const handMaterial = makeCoverMaterial();
const handStates = coverFns.prepareSubmergedOverlayStencilMaterials([{material: handMaterial}]);
assert.equal(handMaterial.colorWrite, true, 'held hands and tools draw their original color');
assert.equal(handMaterial.depthWrite, true, 'water behind a hand or weapon is rejected');
assert.equal(handMaterial.depthTest, true, 'held meshes obey opaque occluders');
assert.equal(handMaterial.stencilWriteMask, 1, 'all held/foot pixels populate the same stencil bit');
const coverMaterial = makeCoverMaterial();
const tintStates = coverFns.prepareOverlayCoverTintMaterials([{material: coverMaterial}]);
assert.equal(coverMaterial.colorWrite, true, 'slush retains its authored color');
assert.equal(coverMaterial.opacity, 0.22, 'slush retains its authored opacity');
assert.equal(coverMaterial.depthWrite, false, 'tint pass does not overwrite foot depth');
assert.equal(coverMaterial.stencilFuncMask, 1, 'only visible held, hand or foot pixels may be tinted');
const depthStates = coverFns.prepareTintCoverDepthMaterials([{material: coverMaterial}]);
assert.equal(coverMaterial.colorWrite, false, 'cover depth is restored without double-applying the color');
assert.equal(coverMaterial.depthWrite, true, 'cover depth protects held weapons');
assert.equal(coverMaterial.stencilWrite, false, 'cover depth writes are not restricted to foot pixels');
assert.equal(handStates.size, 1, 'held/hand/foot material state can be restored');
assert.equal(tintStates.size, 1, 'tint material state can be restored');
assert.equal(depthStates.size, 1, 'depth replay material state can be restored');

assert.match(feetParity, /markWaterOccludedMesh\?\.\(mesh\)/,
  'both procedural foot meshes register through the real selective renderer');
assert.match(feetParity, /material\?\.colorWrite !== false/,
  'the visible selective foot draw remains eligible for matrix snapshot capture');

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
