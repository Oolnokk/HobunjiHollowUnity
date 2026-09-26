#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict'); // Used for deterministic static regression checks without a browser harness.
const fs = require('node:fs'); // Used to read the shipped runtime/editor/config source files.
const path = require('node:path'); // Used to resolve repository-relative fixture paths consistently.
const vm = require('node:vm'); // Executes the pure interior-wall splitter in an isolated browser-like context for geometry regression coverage.

const root = path.resolve(__dirname, '..'); // Repository root for every source/config assertion below.
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8'); // Small helper keeps each assertion readable.
const json = relative => JSON.parse(read(relative)); // Validates JSON syntax while loading each window preset.

const presets = [
  ['simpleWindow', 'docs/config/furniture-authored/simpleWindow.json', 2.6],
  ['crossbarWindow', 'docs/config/furniture-authored/crossbarWindow.json', 3.0],
  ['wideWindow', 'docs/config/furniture-authored/wideWindow.json', 3.6],
]; // Canonical first three daylight-window furniture presets and their expected authored radii.

for (const [key, file, expectedRadius] of presets) {
  const data = json(file); // Complete authored furniture record exercises schema + surface metadata together.
  assert.equal(data.schema, 'hobunji_furniture_authored_runtime.v1', `${key}: runtime schema must remain authored-furniture v1`);
  assert.equal(data.key, key, `${key}: config key must match filename/catalog key`);
  assert(data.wallOrnament?.attachmentSurfaceId, `${key}: window must remain wall-placeable through the wall-ornament system`);
  const daylight = (data.recognizedSurfaces || []).filter(surface => surface.role === 'daylightWindow'); // Generic role rather than furniture-key special casing.
  assert.equal(daylight.length, 1, `${key}: starter preset should have one daylight aperture surface`);
  assert.equal(daylight[0].daylightRadiusTiles, expectedRadius, `${key}: authored daylight radius changed unexpectedly`);
  assert.equal(daylight[0].daylightStrength, 1, `${key}: starter preset should expose full outdoor light at its center`);
  assert.equal(daylight[0].materialTexture, 'wavy_surface.png', `${key}: pane should use the lightweight shared textured surface`);
  assert.equal(daylight[0].materialFillEnabled, true, `${key}: pane must use the editor's shade-preserving fill model`);
  assert.notEqual(data.wallOrnament.attachmentSurfaceId, daylight[0].id, `${key}: wall-contact and visible daylight faces must remain distinct`);
}

const crossbarPreset = json('docs/config/furniture-authored/crossbarWindow.json'); // Mullions are thick enough to sit visibly in front of the pane without translating their centers out of the frame plane.
const widePreset = json('docs/config/furniture-authored/wideWindow.json'); // Wide Window is the player-visible regression that exposed the protruding-bar offset.
for (const [label, data] of [['crossbarWindow', crossbarPreset], ['wideWindow', widePreset]]) {
  const pane = data.parts.find(part => /_pane$/.test(part.id)); // Pane depth is the reference plane for the full window assembly.
  const mullions = data.parts.filter(part => /_mullion_/.test(part.id)); // Every internal bar should share the frame center plane and rely on its own thickness for foreground separation.
  assert(mullions.length > 0, `${label}: expected authored mullion parts`);
  for (const mullion of mullions) {
    assert.equal(Number(mullion.transform?.z) || 0, 0, `${label}: ${mullion.id} must not carry a special forward translation`);
    assert(Number(mullion.transform?.sz) > Number(pane?.transform?.sz), `${label}: ${mullion.id} must remain thicker than the pane so it renders in front without z-fighting`);
  }
}

const runtime = read('docs/js/daylight-window-runtime.js'); // Static source guards the integration strategy requested for interiors.
assert.match(runtime, /const VERSION = 3/, 'daylight runtime version must include the coplanar mullion revision');
assert.match(runtime, /const ROLE = 'daylightWindow'/, 'runtime must consume the generic daylight-window surface role');
assert.doesNotMatch(runtime, /mullion[^\n]*z: 0\.045/, 'fallback window recipes must not reintroduce the old protruding mullion translation');
assert.match(runtime, /function ensureWindowVisualRoot\(group\)/, 'daylight windows must establish one construction-time visual assembly boundary');
assert.match(runtime, /daylightWindowVisualRootPartCount = group\.userData\.meshById\?\.size \|\| 0/, 'canonical window visual root must account for every authored pane/frame/mullion part');
assert.doesNotMatch(runtime, /globalCompositeOperation = 'destination-out'/, 'window runtime must not punch independent holes through room darkness now that ordinary interiors use one atmosphere');
assert.match(runtime, /AMBIENT_WINDOW_WEIGHT = 0\.32/, 'window runtime must document its restrained weight in the shared room atmosphere');
assert.doesNotMatch(runtime, /createRadialGradient\(center\.x, center\.y/, 'daylight runtime must not draw moving projected window halos');
assert.match(runtime, /Room lighting itself is now composed once by CloudForestFog/, 'window runtime must defer room-light composition to the single atmosphere authority');
assert.match(runtime, /drawAtmosphere,/, 'daylight runtime must expose a compositor hook instead of repainting after local lights');
assert.doesNotMatch(runtime, /drawLightingOverlay = wrappedDraw|__daylightWindowOriginal/, 'daylight runtime must not own an after-the-fact overlay wrapper');
assert.match(runtime, /pixels\.data\[i\] \+ pixels\.data\[i \+ 1\] \+ pixels\.data\[i \+ 2\]/, 'runtime pane texture must neutralize RGB with the existing shade-preserving fill algorithm');
assert.match(runtime, /area === 'interior' \|\| !!lightingDeps\?\._isBuildingArea/, 'daylight apertures must apply to ordinary interiors/buildings');
assert.doesNotMatch(runtime, /isMineArea|isDenArea/, 'daylight-window runtime should not opt mines/dens into window lighting');
assert.match(runtime, /window\.__daylightWindowDebug = debugSnapshot/, 'mobile/runtime diagnostics must be available without browser console inspection');
assert.match(runtime, /image\.crossOrigin = 'anonymous'[\s\S]*image\.src = docsBaseUrl/, 'pane texture must be CORS-clean and resolve from the shared docs root in nested tools');
assert.match(runtime, /simpleWindowFurniture/, 'player/runtime furniture registry must receive Simple Window');
assert.match(runtime, /crossbarWindow:[\s\S]{0,260}playerFurnitureDisabled: true/, 'Crossbar Window must remain restorable/dev-authored but disabled as player furniture');
assert.match(runtime, /wideWindowFurniture/, 'player/runtime furniture registry must receive Wide Window');

const farmPanelCore = read('docs/js/farm-panel-core.js'); // Guards one-time starter acquisition and normal item metadata for the three windows.
assert.match(farmPanelCore, /STARTER_WINDOW_STORAGE_SENTINEL = '__starterWindowsGrantedV1'/, 'farm storage must persist a per-world starter-window grant marker');
assert.match(farmPanelCore, /WINDOW_PERSISTENCE_REPAIR_SENTINEL = '__windowPersistenceRepairGrantV1'/, 'existing worlds must receive one replacement-window repair grant');
assert.match(farmPanelCore, /WINDOW_PERSISTENCE_REPAIR_COUNT = 6/, 'repair grant must restore six of each test window without making replenishment infinite');
assert.match(farmPanelCore, /hadStarterGrant && !store\[WINDOW_PERSISTENCE_REPAIR_SENTINEL\]/, 'replacement windows must be limited to worlds that already consumed the original starter grant');
assert.match(farmPanelCore, /simpleWindowFurniture:[\s\S]*count: 2/, 'starter storage must grant two Simple Windows');
assert.doesNotMatch(farmPanelCore, /crossbarWindowFurniture:\s*Object\.freeze\(\{ count:/, 'Crossbar Window must not be granted as player furniture');
assert.match(farmPanelCore, /delete store\.crossbarWindowFurniture/, 'stale Crossbar Window farm-storage stock must be removed once the item is disabled');
assert.match(farmPanelCore, /wideWindowFurniture:[\s\S]*count: 2/, 'starter storage must grant two Wide Windows');
assert.match(farmPanelCore, /cat: 'furniture'/, 'starter windows must register as ordinary inventory furniture items');
assert.match(farmPanelCore, /const store = ensureStarterWindowsInFarmStorage\(\)/, 'Farm Storage render path must run the one-time starter grant');
assert.match(farmPanelCore, /k !== STARTER_WINDOW_STORAGE_SENTINEL/, 'starter grant marker must never render as a storage item');

const farmPanelLoader = read('docs/js/farm-panel.js'); // Core cache-bust must move with the starter-storage behavior.
assert.match(farmPanelLoader, /farm-panel-core\.js\?v=20260923windowtrim1/, 'Farm Panel must load the player-window catalog revision');
const gameIndex = read('docs/index.html');
const gameSource = read('docs/game.js');
assert.match(gameIndex, /farm-panel\.js\?v=[^"'&\s<]+&window=20260926rebase1/, 'game index must cache-bust the updated Farm Panel loader');

const author = read('docs/tools/furniture-avatar-author/furniture-daylight-windows.js'); // Guards editor controls and export metadata.
assert.match(author, /Use Selected Surface as Window/, 'Furniture Author must expose a selected-surface daylight action');
assert.match(author, /daylightWindowRadius/, 'Furniture Author must expose per-window radius control');
assert.match(author, /daylightWindowStrength/, 'Furniture Author must expose per-window strength control');
assert.match(author, /materialFillEnabled = true/, 'marking a window must reuse the existing material-fill path');
assert.match(author, /attachmentSurfaceId === surface\.id/, 'editor must reject one surface serving as both wall-contact and visible daylight face');

const authorLoader = read('docs/tools/furniture-avatar-author/foliage-furniture-mode.js'); // Extension loader must actually make the UI feature reachable.
assert.match(authorLoader, /furniture-daylight-windows\.js\?v=20260916window1/, 'Furniture Author must load the daylight-window extension');

const mapTransport = read('docs/js/map-live-preview.js'); // Transport must stay independent of feature load order.
assert.doesNotMatch(mapTransport, /loadCompanion|daylight-window-runtime|wall-ornament-placement/, 'Map Live Preview must not dynamically inject init-sensitive wall/window systems');
const gameHtml = read('docs/index.html');
const gameWallLoader = gameHtml.indexOf('wall-ornament-placement.js?v=20260926rebase1');
const gameWindowLoader = gameHtml.indexOf('daylight-window-runtime.js?v=20260926rebase1');
const gameLinkLoader = gameHtml.indexOf('house-window-linkage.js?v=20260926rebase1');
const gameSchedulerLoader = gameHtml.indexOf('daylight-window-overlay-scheduler.js?v=20260926rebase1');
const gameWeatherLoader = gameHtml.indexOf('weather-fx.js?');
const gameLoader = gameHtml.indexOf('game.js?');
assert(gameWallLoader >= 0 && gameWeatherLoader > gameWallLoader && gameWindowLoader > gameWeatherLoader && gameLinkLoader > gameWindowLoader && gameSchedulerLoader > gameLinkLoader && gameLoader > gameSchedulerLoader, 'game must load wall placement before its consumers, then daylight runtime + farmhouse linkage after WeatherFX but before game.js init calls');
const interiorHtml = read('docs/tools/building-interior-author/index.html');
const interiorThreeLoader = interiorHtml.indexOf('three.min.js');
const interiorSceneLoader = interiorHtml.indexOf('interior-scene-builder.js?v=20260926rebase1');
const interiorWallLoader = interiorHtml.indexOf('wall-ornament-placement.js?v=20260926rebase1');
const interiorWindowLoader = interiorHtml.indexOf('daylight-window-runtime.js?v=20260926rebase1');
const interiorEditorLoader = interiorHtml.indexOf('building-interior-wall-ornament-editor.js?v=20260922wall3');
assert(interiorThreeLoader >= 0 && interiorSceneLoader > interiorThreeLoader && interiorWallLoader > interiorSceneLoader && interiorWindowLoader > interiorWallLoader && interiorEditorLoader > interiorWindowLoader, '3D Interior Editor must load the reticle-aware scene/wall sidecars after Three.js in deterministic order');
assert.doesNotMatch(mapTransport, /gizmo3dBar|wallOrnamentMapControls/, 'wall/window UI must not be docked into the outer Map Editor');

const interiorWallEditor = read('docs/js/building-interior-wall-ornament-editor.js');
assert.match(interiorWallEditor, /\/tools\/building-interior-author/, 'wall authoring sidecar must be scoped to the 3D Interior Editor');
assert.match(interiorWallEditor, /layoutEditSelect/, 'wall records must follow the Interior Editor base/alternate-layout selection');
assert.match(interiorWallEditor, /activeFurniture\(interior, layoutId\)/, 'placement must write into the currently edited room/layout furniture array');
assert.match(interiorHtml, /window\._bia3dWallContext=\{renderer:renderer,scene:scene3,camera:camera\}/, 'Interior Editor must explicitly expose its exact r128 renderer, scene, and camera to wall placement');
assert.match(interiorWallEditor, /const context = window\._bia3dWallContext/, 'wall sidecar must consume the explicit editor context bridge');
assert.doesNotMatch(interiorWallEditor, /WebGLRenderer\.prototype\.render/, 'wall sidecar must not use the ineffective Three r128 prototype render hook');
assert.match(interiorWallEditor, /threeCanvas/, 'scene capture must be limited to the Interior Editor preview renderer');
assert.match(interiorWallEditor, /WallOrnamentPlacement\.loadAttachment/, 'Interior Editor must reuse authored attachment-surface metadata');
assert.match(interiorWallEditor, /WallOrnamentPlacement\.deriveTransform/, 'Interior Editor must reuse the shared wall transform solver');
assert.match(interiorWallEditor, /wallAttachment/, 'logical wall-space placement must persist in exported interior JSON');
assert.match(interiorWallEditor, /wallOrnamentKey/, 'wall records must retain their canonical visual key');
assert.match(interiorWallEditor, /_biaBridge\.loadData/, 'wall edits must flow back through the Interior Editor authoritative load/undo/rebuild path');
assert.match(interiorWallEditor, /simpleWindowFurniture/, 'Interior Editor preset list must include Simple Window');
assert.match(interiorWallEditor, /crossbarWindowFurniture/, 'Interior Editor preset list must include Crossbar Window');
assert.match(interiorWallEditor, /wideWindowFurniture/, 'Interior Editor preset list must include Wide Window');
assert.match(interiorWallEditor, /InteriorSceneBuilder/, 'wall picking must use the same canonical interior wall source as the rendered room');
assert.match(interiorWallEditor, /buildWallPanels\(floorSet, exitTileSet/, 'wall picking must reconstruct canonical wall planes including authored exit gaps');
assert.match(interiorWallEditor, /intersectCanonicalPanel/, 'pointer hits must intersect canonical wall planes rather than scattered brick triangle normals');
assert.match(interiorHtml, /wallGroup\.userData\.biaInteriorWallGroup=true/, 'rendered interior walls must be tagged for direct pointer detection');
assert.match(interiorWallEditor, /renderedWallHitFromPointer/, 'wall picking must test the rendered wall geometry the author actually clicked');
assert.match(interiorWallEditor, /source: rendered \? 'rendered' : 'canonical'/, 'wall-pick diagnostics must identify rendered hits versus canonical fallback hits');
assert.match(interiorWallEditor, /normalOffset: round\(finite\(attachment\.defaultNormalOffset/, 'placement must keep wall-plane hit and normal offset as separate concepts');
assert.match(interiorWallEditor, /Normal offset/, 'Interior Editor must label the in\/out control according to its actual wall-normal behavior');
assert.match(interiorWallEditor, /canonicalWallPanelCount/, 'mobile-friendly diagnostics must report whether canonical wall geometry was available');
assert.match(interiorWallEditor, /lastWallPick/, 'mobile-friendly diagnostics must report the last canonical wall hit');

const sceneBuilder = read('docs/js/interior-scene-builder.js');
const canvasBuilderStart = sceneBuilder.indexOf('function buildCanvasWallsWithColor');
const canvasBuilderEnd = sceneBuilder.indexOf('// Flat box panels', canvasBuilderStart);
const canvasBuilder = sceneBuilder.slice(canvasBuilderStart, canvasBuilderEnd);
assert(canvasBuilderStart >= 0 && canvasBuilderEnd > canvasBuilderStart, 'canvas wall builder source must remain discoverable for regression checks');
assert.match(canvasBuilder, /new THREE\.PlaneGeometry\(width, height\)/, 'canvas interiors must render a real plane mesh for each canonical wall panel');
assert.match(canvasBuilder, /height \/ 2/, 'canvas wall planes must be vertically centered over the floor-referenced panel origin');
assert.match(canvasBuilder, /interiorWallPanelId/, 'canvas wall meshes must retain their canonical panel identity for debugging and picking');
assert.match(canvasBuilder, /interiorWallPlane/, 'canvas wall meshes must expose the exact canonical wall-plane metadata they render');
assert.doesNotMatch(canvasBuilder, /BufferGeometry|setIndex\(idx\)|const pos = \[\], idx = \[\]/, 'canvas walls must not use the old merged zero-thickness buffer path');

assert.match(sceneBuilder, /interiorWallSurfaceGroup = true/, 'all interior wall render styles must publish explicit player wall-target metadata');
assert.match(sceneBuilder, /function applyWallOpenings\(wallPanels, wallOpenings\)/, 'interior wall builder must expose deterministic rectangular aperture subtraction');
assert.match(sceneBuilder, /const renderPanels = applyWallOpenings\(wallPanels, buildOptions\.wallOpenings\)/, 'wall apertures must be applied before brick/canvas/fallback geometry is generated');
const sceneContext = { window: { THREE: {} }, console }; // Minimal browser-like root is enough because the pure panel splitter does not instantiate Three objects.
vm.runInNewContext(sceneBuilder, sceneContext, { filename: 'interior-scene-builder.js' });
const sourcePanel = { id: 'south', width: 4, height: 2, position: [2, 0, 4], rotationDeg: [0, 0, 0] }; // 4x2 south wall used to verify a centered 1x1 window subtraction.
const splitPanels = sceneContext.window.InteriorSceneBuilder.applyWallOpenings([sourcePanel], [{ center: [2, 1, 4], normal: [0, 0, 1], width: 1, height: 1 }]); // Pure result should be four surviving rectangles around the opening.
assert.equal(splitPanels.length, 4, 'centered interior window should split one panel into four surviving wall rectangles');
const splitArea = splitPanels.reduce((sum, panel) => sum + panel.width * panel.height, 0); // Surviving area must equal original wall area minus the 1x1 aperture.
assert(Math.abs(splitArea - 7) < 1e-9, 'interior window aperture must remove exactly its silhouette area from the wall');

const houseGenerator = read('docs/js/HousePieceGen.js'); // Exterior Highland walls also publish explicit wall-target metadata.
const faceMeshStart = houseGenerator.indexOf('function _buildFaceMeshes(group, faces, opts)'); // Isolates the real Highland face builder for a startup-path smoke check.
const faceMeshEnd = houseGenerator.indexOf('  // ──', faceMeshStart + 1); // Stops before the next renderer helper.
assert(faceMeshStart >= 0 && faceMeshEnd > faceMeshStart, 'Highland face builder must remain available for the startup smoke check');
const faceContext = {
  THREE: {
    FrontSide: 0,
    MeshLambertMaterial: class { constructor(options) { Object.assign(this, options); } },
    BufferGeometry: class { setAttribute() {} computeVertexNormals() {} },
    Float32BufferAttribute: class { constructor(values) { this.values = values; } },
    Mesh: class { constructor(geometry, material) { this.geometry = geometry; this.material = material; this.userData = {}; } },
  },
}; // Minimal Three surface needed to execute the startup face path without WebGL.
vm.runInNewContext(`${houseGenerator.slice(faceMeshStart, faceMeshEnd)}; this.buildFaces = _buildFaceMeshes;`, faceContext);
const faceMeshes = []; // Captures emitted meshes for metadata assertions after the real builder executes.
faceContext.buildFaces({ add(mesh) { faceMeshes.push(mesh); } }, [{ id: 'starter-floor', tag: 'floor', v: [[0, 0, 0], [0, 0, 1], [1, 0, 1], [1, 0, 0]] }], {});
assert.equal(faceMeshes[0].userData.housePieceFaceTag, 'floor', 'starter farmhouse faces must build without an undefined tag and retain semantic metadata');
assert.match(houseGenerator, /housePieceWallSurface = true/, 'Highland fallback wall faces must publish explicit player wall-target metadata');
const wallPlacement = read('docs/js/wall-ornament-placement.js'); // Generic wall bridge now exposes extension-safe explicit-save hooks for linked representations.
assert.match(wallPlacement, /onPlayerPlacementChanged/, 'wall bridge must expose placement-change listeners');
assert.match(wallPlacement, /onPlayerPlacementRemoved/, 'wall bridge must expose placement-removal listeners');
assert.match(wallPlacement, /async function setPlayerPlacement/, 'linked systems must be able to apply an exact logical wall placement without faking pointer input');
assert.match(wallPlacement, /finishPlayerAdjustment\(false\)/, 'Unmount must not immediately re-save the placement it just deleted');
assert.match(wallPlacement, /const VERSION = 5/, 'player wall placement runtime must use the normal-yaw-persisting v5 contract');
assert.match(wallPlacement, /rootYaw = normalizeDegrees\([\s\S]{0,120}yawOf\(wallNormal\)/, 'mounted yaw must be independently derived from each half\'s own wall normal');
assert.match(wallPlacement, /object\.rotYDeg = derived\.rotY/, 'normal-derived yaw must be copied back onto each ordinary furniture record');
assert.match(wallPlacement, /PLAYER_STORE_SCHEMA_VERSION = 1/, 'wall placement storage schema must be stable across runtime version bumps');
assert.match(wallPlacement, /if \(parsed\?\.placements && typeof parsed\.placements === 'object'\)/, 'legacy placement stores must be accepted based on shape rather than runtime version');
assert.doesNotMatch(wallPlacement, /parsed\?\.version === VERSION/, 'runtime VERSION must never invalidate persisted wall placements');
assert.match(wallPlacement, /function wallHitFromReticle/, 'player wall selection must raycast through the gameplay reticle');
assert.match(wallPlacement, /function isExplicitPlayerWallTarget/, 'player targeting must require explicit wall metadata instead of arbitrary vertical scene triangles');
assert.match(wallPlacement, /explicitWallsOnly && !isExplicitPlayerWallTarget\(node\)/, 'floors, companions, NPCs, furniture and props must not masquerade as walls');
assert.match(wallPlacement, /function armNewPlayerFurniture/, 'new wall furniture must enter wall-reticle mode directly without a floor-placement stage');
assert.match(wallPlacement, /function updatePlayerReticlePreview/, 'wall furniture must follow the current reticle wall before confirmation');
assert.match(wallPlacement, /id !== 'action1' && id !== 'action2'/, 'Action 1 must confirm and Action 2 must cancel the complete wall-placement session');
assert.match(wallPlacement, /function canConfirmPlayerReticlePlacement\(\)[\s\S]{0,220}playerPreviewValid/, 'mobile Place availability must follow the live validated wall preview');
assert.match(wallPlacement, /canConfirmPlayerReticlePlacement,/, 'wall placement must expose its confirm-availability state to the shared action arch');
assert.doesNotMatch(wallPlacement, /PLAYER_CONTROLLER_TRANSLATE_SPEED|PLAYER_CONTROLLER_NORMAL_SPEED|function updateControllerFrame|function handleControllerButton/, 'movement stick and D-pad must never directly translate player wall furniture');
assert.doesNotMatch(wallPlacement, /function ensurePlayerControl|function attachPlayerProxy|TransformControls\(runtimeDeps\.camera/, 'dead player gizmo code must not remain beside the reticle-only flow');
assert.doesNotMatch(wallPlacement, /frame\.move\s*=|Button12.*Button13/, 'wall placement must not consume or rewrite player movement controls');
assert.doesNotMatch(wallPlacement, /owner: 'wall-ornament-gizmo'/, 'player wall placement must not acquire the old gameplay action lock');
assert.match(wallPlacement, /rootYaw = normalizeDegrees\(yawOf\(wallNormal\) \+ 180 - yawOf\(attachment\.normal\)\)/, 'wall furniture yaw must remain derived from the picked wall normal');
assert.match(wallPlacement, /object\.rotYDeg = derived\.rotY/, 'normal-derived yaw must also become the ordinary saved furniture rotation for both primary and duplicate halves');
assert.match(wallPlacement, /Windows can only be placed from outside the farmhouse\./, 'player window placement must refuse to arm indoors');
assert.match(wallPlacement, /snapExteriorPlayerPlacement/, 'window reticle previews must use the fixed exterior slot snapper');
assert.match(wallPlacement, /Move the window from outside; the interior copy follows automatically\./, 'synthetic interior copies must refuse direct adjustment');

const furniturePlacerSource = read('docs/js/furniture-placer.js'); // The selector is the only click-required player step; world placement is reticle-native.
assert.match(furniturePlacerSource, /wallApi\.armNewPlayerFurniture\(def\.itemKey\)/, 'choosing owned wall furniture must immediately arm wall-reticle placement');
assert.match(furniturePlacerSource, /wallApi\.adjustPlayerObject\(obj\.id\)/, 'Move on mounted wall furniture must enter the same reticle-follow flow');
assert.doesNotMatch(furniturePlacerSource, /Wall Mount|Adjust Wall|Pick wall|>Done</, 'removed multi-stage wall-placement controls must not return');
assert.match(furniturePlacerSource, /pointerlockchange[\s\S]*document\.exitPointerLock/, 'click-required Furniture UI must reject accidental Pointer Lock reacquisition');
assert.match(furniturePlacerSource, /suspendMouseCameraForUi/, 'opening the click-required furniture selector must explicitly release mouse camera capture');
assert.match(furniturePlacerSource, /resumeMouseCameraAfterUi/, 'mouse camera capture may resume only when the selector closes');
assert.match(furniturePlacerSource, /area !== 'interior' \|\| !window\.HouseWindowLinkage\?\.isWindowKey\?\.\(key\)/, 'owned windows must disappear from the interior placement catalog');
assert.match(furniturePlacerSource, /filter\(obj => !obj\?\.derivedLinkedWindow\)/, 'synthetic inside copies must not receive Move\/Remove controls in Furniture Placer');

const linkage = read('docs/js/house-window-linkage.js'); // Farmhouse-specific pairing stays isolated from the generic daylight and wall runtimes.
assert.match(linkage, /const INTERIOR_SCALE = 2/, 'linked windows must honor the farmhouse 2x interior coordinate scale');
assert.match(linkage, /const BODY_TOP_SCALE = 0\.85/, 'outside counterpart mapping must honor the Highland wall taper');
assert.match(linkage, /const EXTERIOR_HEIGHT_SCALE = 1\b/, 'farm exterior window and brick opening must retain the authored height');
assert.match(linkage, /function exteriorWindowSilhouette/, 'exterior frame and brick opening must share one scaled silhouette calculation');
assert.match(linkage, /const EXTERIOR_SLOT_TILES = 2/, 'window placement density must be exactly one fixed slot per two exterior wall tiles');
assert.match(linkage, /const EXTERIOR_SLOT_V01 = 0\.5/, 'all player window slots must use one fixed mid-wall height');
assert.match(linkage, /const count = Math\.floor\(length \/ EXTERIOR_SLOT_TILES\)/, 'slot count must be floor(wall length / 2)');
assert.match(linkage, /const unused = length - count \* EXTERIOR_SLOT_TILES/, 'odd leftover wall length must be centered around the fixed slot grid');
assert.match(linkage, /slotIndex = Math\.max\(0, Math\.min\(layout\.count - 1, rawIndex\)\)/, 'reticle aiming must snap horizontally to the nearest fixed slot');
assert.match(linkage, /v01: EXTERIOR_SLOT_V01/, 'slot snapping must discard free vertical placement');
assert.match(linkage, /function exteriorSlotOccupied\(binding, excludePrimaryId = null\)/, 'slot authority must reject a second window in the same two-tile segment');
assert.match(linkage, /function snapExteriorPlayerPlacement\(key, rawPlacement, excludePrimaryId = null\)/, 'generic wall targeting must have one farmhouse-specific fixed-slot snap entry point');
assert.match(linkage, /farmDeps\?\.getCurrentArea\?\.\(\) !== 'farm'/, 'fixed window placement must reject non-exterior player areas');
assert.match(linkage, /object\.area !== 'farm'/, 'only an exterior primary may drive the derived window pair');
assert.match(linkage, /createSyntheticPeer\(object, peerId, 'interior', provisional\)/, 'the inside window must always be a synthetic copy generated from the exterior slot');
assert.match(linkage, /houseWindowExteriorTransformModel = farmSide \? 'fixed-exterior-slot' : 'derived-interior-copy'/, 'runtime diagnostics must expose the simplified exterior-authority model');
assert.match(linkage, /root\.userData\.houseWindowApertureRoot/, 'visible exterior window and opening guide must share a stable aperture root');
assert.match(linkage, /apertureRoot\.add\(visualRoot\)/, 'all authored window parts must be children of the aperture frame');
assert.match(linkage, /visualRoot\.position\.set\(-anchor\[0\], -anchor\[1\], -anchor\[2\]\)/, 'authored window coordinates must be relative to the attachment anchor');
assert.doesNotMatch(linkage, /calculatedWindowGroupCentroid|editorSelectAllScaleDelta|inverseRootWorld|pivotWorld/, 'cross-space Select All matrix machinery must stay removed from the simplified duplication path');
assert.match(linkage, /houseWindowExteriorVerticalShift = 0/, 'exterior window visual must have no hidden vertical translation');
assert.match(linkage, /houseWindowExteriorNormalShift = 0/, 'exterior window visual must have no hidden depth compensation');
assert.match(linkage, /const silhouette = exteriorWindowSilhouette\(record\.key\)/, 'exterior opening and visible farm window must still share one scaled silhouette');
assert.match(linkage, /vCenter: binding\.v01,[\s\S]{0,180}vHeight: silhouette\.height \/ EXTERIOR_WALL_HEIGHT/, 'the exterior hole must use the exact fixed slot center and height');
assert.match(linkage, /derivedLinkedWindow: true/, 'opposite-side peer must be explicitly marked synthetic for save/refund protection');
assert.match(linkage, /getInteriorWallOpenings/, 'linkage must expose interior brick apertures');
assert.match(linkage, /getExteriorWindowCuts/, 'linkage must expose exterior Highland-wall apertures');
assert.match(linkage, /onHouseGeometryRebuilt/, 'whole-room movement must realign linked window meshes from piece-local bindings');
assert.match(linkage, /if \(placement\?\.wallPoint && placement\?\.wallNormal\)[\s\S]{0,420}useExistingBinding: false[\s\S]{0,120}skipSave: false/, 'older one-sided/raw mounted-window saves must infer their missing link and persist a regenerated inside\/outside peer');
assert.match(linkage, /window\.__houseWindowLinkDebug = debugSnapshot/, 'mobile-friendly linked-window diagnostics must be available without devtools');

const farmEditor = read('docs/js/farm-editor.js'); // Farm save persists only the inventory-backed window; linkage deterministically regenerates the synthetic half.
assert.match(farmEditor, /if \(obj\.derivedLinkedWindow\) return/, 'synthetic opposite-side windows must never serialize as duplicate owned decor');
assert.match(farmEditor, /if \(derivedLinkedWindow\) return/, 'transitional saves that briefly serialized peers must ignore those duplicate records on restore');
assert.doesNotMatch(farmEditor, /derivedLinkedWindow: !!obj\.derivedLinkedWindow/, 'new authoritative saves must not contain a second synthetic decor record');
assert.match(farmEditor, /wallPlacement: window\.WallOrnamentPlacement\?\.getPlayerPlacement\?\.\(obj\.id\) \|\| null/, 'authoritative farm layout must embed mounted wall placement as a backup');
assert.match(farmEditor, /preserveUnknownDecorRecords\(layout, previousLayout\)/, 'farm saves must carry forward decor records whose definitions are unknown to the current build');
assert.match(farmEditor, /LINKED_WINDOW_BACKUP_KEY = 'hobunji_farm_linked_window_backup_v1'/, 'linked windows need a separate per-world recovery sidecar that older branches will not rewrite');
assert.match(farmEditor, /mergeLinkedWindowBackup\(layout\)/, 'farm loads must merge surviving linked-window primaries back after an older branch omits them from layout.decor');
assert.match(farmEditor, /localStorage\.removeItem\(linkedWindowBackupKey\(\)\)/, 'window-aware intentional deletion must clear the recovery sidecar rather than resurrect removed windows');
const extensionRepairIndex = farmEditor.indexOf('DaylightWindowRuntime?.registerDecorDefs?.(deps.DECORATIVE_FURNITURE_DEFS)');
const decorRestoreIndex = farmEditor.indexOf('(layout.decor || []).forEach');
assert(extensionRepairIndex >= 0 && extensionRepairIndex < decorRestoreIndex, 'window definitions must be repaired before saved decor is filtered/restored');
assert.match(farmEditor, /setPlayerPlacement\?\.\(restoredObject\.id, wallPlacement, \{ notify: false, apply: true \}\)/, 'farm layout restore must rehydrate embedded wall placement before pair restoration');
assert.match(linkage, /function isObjectMeshSceneAttached\(object\)/, 'peer restore must distinguish a live scene-attached peer from a stale registry record');
assert.match(linkage, /peerObject\?\.derivedLinkedWindow && !isObjectMeshSceneAttached\(peerObject\)/, 'a detached synthetic peer must be discarded and rebuilt instead of silently reused');
assert.match(linkage, /function patchInteriorGeometryRebuild\(injected\)/, 'interior geometry rebuilds must explicitly schedule peer validation afterward');
assert.match(linkage, /scheduleRestorePairs\(\{ rebuildAfter: false \}\)/, 'post-rebuild peer validation must not recursively rebuild geometry');

// Behavioral farm-layout + linkage regression: only the primary is serialized.
// It mirrors gameplay's two-stage startup: a first restore, the per-world
// clearInteriorFurniture-style wipe, then the authoritative world-layout restore.
// Geometry rebuilds leave furniture alone; a separate stale-record case proves
// linkage still repairs a detached synthetic mesh defensively.
async function runLinkedWindowReloadRegression() {
  const farmStorage = new Map();
  const roundTripPlacement = { version: 5, wallPoint: [5.85,0.7,3.5], wallNormal: [1,0,0], offsetU: 0, offsetV: 0, normalOffset: 0.01, space: 'wall-surface-uvn', houseWindowLink: { version: 10, primaryId: 'decor_window_roundtrip', peerId: 'decor_window_roundtrip:house-window-peer', role: 'primary', binding: { pieceId: 'house_starter', side: 'east', localStart: 0, localEnd: 3, u01: 0.5, v01: 0.5, slotIndex: 0 } } };
  const roundTripPlacements = new Map([['decor_window_roundtrip', JSON.parse(JSON.stringify(roundTripPlacement))]]);
  const roundTripDecorDefs = { simpleWindow: { itemKey: 'simpleWindowFurniture', name: 'Simple Window', area: 'any', wallOrnament: true } };
  const roundTripObjects = [];
  const roundTripHousePieces = [{ id:'house_starter', pieceKey:'starter', col:2, row:2, w:4, h:3, stage:'built', features:[] }];
  const placementChanged = new Set(), placementRemoved = new Set();
  let rebuildCount = 0, extensionRepairCalls = 0;

  function makeNode(name) {
    return {
      name, userData:{}, parent:null, children:[], position:{x:0,y:0,z:0,set(x,y,z){this.x=x;this.y=y;this.z=z;},clone(){return {x:this.x,y:this.y,z:this.z};}},
      rotation:{y:0}, add(child){ child.parent?.remove?.(child); child.parent=this; this.children.push(child); },
      remove(child){ const i=this.children.indexOf(child); if(i>=0)this.children.splice(i,1); if(child?.parent===this)child.parent=null; },
      traverse(fn){ fn(this); for(const child of [...this.children]) child.traverse?.(fn); },
    };
  }
  const farmScene = makeNode('farmScene'), interiorScene = makeNode('interiorScene');
  farmScene.isScene = interiorScene.isScene = true;
  const wallApi = {
    version:5,
    getPlayerPlacement(id){ const p=roundTripPlacements.get(id); return p ? JSON.parse(JSON.stringify(p)) : null; },
    getAllPlayerPlacements(){ return Object.fromEntries([...roundTripPlacements].map(([id,p])=>[id,JSON.parse(JSON.stringify(p))])); },
    async setPlayerPlacement(id,p,options={}){ const copy=JSON.parse(JSON.stringify(p)); roundTripPlacements.set(id,copy); if(options.notify!==false){ const obj=roundTripObjects.find(entry=>entry.id===id)||null; for(const listener of placementChanged) await listener(id,JSON.parse(JSON.stringify(copy)),obj); } return true; },
    removePlayerPlacement(id,options={}){ const p=roundTripPlacements.get(id); if(!p)return false; roundTripPlacements.delete(id); if(options.notify!==false) for(const listener of placementRemoved) listener(id,JSON.parse(JSON.stringify(p)),roundTripObjects.find(entry=>entry.id===id)||null); return true; },
    onPlayerPlacementChanged(listener){ placementChanged.add(listener); return ()=>placementChanged.delete(listener); },
    onPlayerPlacementRemoved(listener){ placementRemoved.add(listener); return ()=>placementRemoved.delete(listener); },
    wallBasis(normal){ const x=Number(normal?.[0])||0,z=Number(normal?.[2])||0; const len=Math.hypot(x,z)||1; const nx=x/len,nz=z/len; return { normal:[nx,0,nz], tangent:[nz,0,-nx], up:[0,1,0] }; },
  };
  const farmRoundTripContext = {
    console, setTimeout, clearTimeout,
    document:{getElementById:()=>null,querySelectorAll:()=>[],querySelector:()=>null},
    localStorage:{getItem:k=>farmStorage.has(k)?farmStorage.get(k):null,setItem:(k,v)=>farmStorage.set(k,String(v)),removeItem:k=>farmStorage.delete(k)},
    WallOrnamentPlacement:wallApi,
    DaylightWindowRuntime:{ version:2, registerDecorDefs(defs){ extensionRepairCalls++; defs.simpleWindow ||= { itemKey:'simpleWindowFurniture', name:'Simple Window', area:'any', wallOrnament:true }; }, __test:{} },
  };
  farmRoundTripContext.window = farmRoundTripContext;
  farmRoundTripContext.addEventListener = () => {};
  farmRoundTripContext.__hobunjiPlayerProfile = { worldId:'window-roundtrip-world' };
  farmRoundTripContext.HousePieces = {
    getFixtureInventory:()=>[], loadFixtureInventory(){}, clearAll(){ roundTripHousePieces.length=0; },
    seedStarter(col,row){ roundTripHousePieces.push({id:'house_starter',pieceKey:'starter',col,row,w:4,h:3,stage:'built',features:[]}); },
    spawnEntry(){}, rebuildStructureMeshes(){},
  };
  farmRoundTripContext.FarmBuildings = { FOOTPRINT_W:1, FOOTPRINT_D:1, spawnEntry(){} };
  farmRoundTripContext.DewVats = { rebuildMeshesFromGrid(){}, removeMesh(){} };
  farmRoundTripContext.WaterSystem = { recomputeWater(){} };
  farmRoundTripContext.Music = { unregisterFurnitureSfxSource(){} };
  vm.runInNewContext(farmEditor, farmRoundTripContext, { filename:'farm-editor.js' });
  vm.runInNewContext(linkage, farmRoundTripContext, { filename:'house-window-linkage.js' });

  const deps = {
    getGrid:()=>[[{type:'grass',depth:0,crop:'',dewPile:null}]], getCurrentArea:()=> 'farm', getFarmEditMode:()=>false, setFarmEditMode(){},
    getFarmEditBrushType:()=>null, setFarmEditBrushType(){}, getFarmEditBrush:()=>null, setFarmEditBrush(){}, getPlayerData:()=>({worldId:'window-roundtrip-world'}),
    getHousePieces:()=>roundTripHousePieces, getFarmBuildings:()=>[], getWorldRoutes:()=>[], getWorldNpcPaths:()=>[], getWorldTransitions:()=>[], getBarnTiers:()=>({}), getHousePieceCatalog:()=>({starter:{w:4,h:3}}),
    getShippingBoxObject:()=>null, setShippingBoxObject(){}, getSupplyBoxObject:()=>null, setSupplyBoxObject(){}, getArmedFurniturePlacementKey:()=>null, getArmedFurnitureMoveId:()=>null,
    COLS:1, ROWS:1, TileType:{GRASS:'grass',TRENCH:'trench'}, CropType:{NONE:''}, worldObjects:new Map(), processingFurnitureObjects:new Set(),
    interiorFurnitureObjects:roundTripObjects, PROCESSING_FURNITURE_DEFS:{}, DECORATIVE_FURNITURE_DEFS:roundTripDecorDefs, createDayOneTile:()=>({type:'grass',variation:0}),
    makeDecorativeFurnitureMesh(col,row,key,targetScene){ const mesh=makeNode(key); targetScene.add(mesh); return {mesh,light:null,sfxSource:null}; },
    getScene:()=>farmScene, getInteriorScene:()=>interiorScene, furnitureOwnerFields:()=>({}),
    decorativeFurnitureSize:()=>({fw:1,fd:1}), registerSitWorldObject(){}, registerChairNpcStation(){}, unregisterChairNpcStation(){}, normalizeNpcArea:a=>a,
    transformFurnitureWithHousePiece(){},
    rebuildInteriorGeometry(){ rebuildCount++; }, // Matches game.js: rebuilds floor/wall geometry without clearing ordinary furniture.
    markTileDirty(){}, isHouseFootprint:()=>false, getWorldObjectAt:()=>null,
    threeContainer:{addEventListener(){}}, showToast(){}, isFarmOwner:()=>true, debugLog(){},
  };
  farmRoundTripContext.FarmEditor.init(deps);

  const threeTileSlots = farmRoundTripContext.HouseWindowLinkage.__test.exteriorSlotLayout({ start:2, end:5 });
  assert.equal(threeTileSlots.count, 1, 'three tiles of exposed wall permit exactly one window');
  assert.equal(threeTileSlots.firstCenter, 3.5, 'the single slot on an odd-length wall must be centered');
  const fiveTileSlots = farmRoundTripContext.HouseWindowLinkage.__test.exteriorSlotLayout({ start:0, end:5 });
  assert.equal(fiveTileSlots.count, 2, 'five wall tiles permit only two windows');
  assert.equal(fiveTileSlots.firstCenter, 1.5, 'odd leftover wall tile must be split evenly before the first two-tile slot');

  const projectionRun = { pieceId:'house_starter', side:'east', fixed:6, start:2, end:5, piece:{ id:'house_starter', col:2, row:2, w:4, h:3 } };
  const projectionBinding = { u01:0.5, v01:0.5 };
  const slotSurface = farmRoundTripContext.HouseWindowLinkage.__test.exteriorSlotSurface(projectionRun, projectionBinding);
  const bottomSurface = farmRoundTripContext.HouseWindowLinkage.__test.farmWallPoint(projectionRun, projectionBinding.u01, 0);
  const topSurface = farmRoundTripContext.HouseWindowLinkage.__test.farmWallPoint(projectionRun, projectionBinding.u01, 1);
  assert(Math.abs(slotSurface.slopeX - (topSurface[0] - bottomSurface[0]) / 1.4) < 1e-9, 'exterior visual follows the same inward wall slope as the opening');
  assert(Math.abs(slotSurface.center[0] - (bottomSurface[0] + topSurface[0]) * 0.5) < 1e-9, 'wall attachment and cut share the sampled slot center');
  const expandedRender = { col:2, row:1, w:4, h:4 }; // Render extension shifts the Highland frustum center away from the owning room center.
  const cutProjection = farmRoundTripContext.HouseWindowLinkage.__test.exteriorCutCenterForRender(expandedRender, projectionRun, projectionBinding);
  const renderCenter = expandedRender.row + expandedRender.h * 0.5;
  const remappedPhysicalCenter = renderCenter + (cutProjection.untaperedAlongForRender - renderCenter) * cutProjection.taperScale;
  assert(Math.abs(remappedPhysicalCenter - cutProjection.actualAlong) < 1e-9, 'exterior cut must land on the exact physical slot center after render-centered Highland taper');
  assert(Math.abs(cutProjection.uCenter - ((3.5 - expandedRender.row) / expandedRender.h)) > 1e-4, 'regression fixture must prove naive untapered normalization would visibly drift from the mounted frame');
  farmRoundTripContext.HousePieces.getExteriorRenderRect = () => expandedRender;
  const extendedSurface = farmRoundTripContext.HouseWindowLinkage.__test.exteriorSlotSurface(projectionRun, projectionBinding);
  const extendedCut = farmRoundTripContext.HouseWindowLinkage.__test.exteriorCutCenterForRender(expandedRender, projectionRun, projectionBinding);
  assert(Math.abs(extendedCut.uCenter - ((3.5 - expandedRender.row) / expandedRender.h)) < 1e-9, 'extended Highland geometry places the cut at the same canonical slot as the furniture');
  assert(Math.abs(extendedSurface.center[2] - (renderCenter + (3.5 - renderCenter) * extendedCut.taperScale)) < 1e-9, 'furniture follows the expanded wall surface rather than the unextended room');
  delete farmRoundTripContext.HousePieces.getExteriorRenderRect;

  const primary={ id:'decor_window_roundtrip', key:'simpleWindow', col:5, row:3, area:'farm', rotYDeg:90, mesh:makeNode('primary') };
  roundTripObjects.push(primary); farmScene.add(primary.mesh);
  assert.equal(farmRoundTripContext.FarmEditor.saveFarmLayout(), true, 'mounted window farm layout must serialize successfully');
  const roundTripKey = 'hobunji_farm_layout_v3:window-roundtrip-world';
  const serializedWindowLayout = JSON.parse(farmStorage.get(roundTripKey));
  assert.equal(serializedWindowLayout.decor.length, 1, 'authoritative farm layout must serialize only the inventory-backed primary');
  assert.equal(serializedWindowLayout.decor[0].id, 'decor_window_roundtrip', 'serialized window must retain the stable primary id');
  assert.deepEqual(serializedWindowLayout.decor[0].wallPlacement, roundTripPlacement, 'primary save must contain the complete normalized wall/link record');
  const linkedWindowBackupKey = 'hobunji_farm_linked_window_backup_v1:window-roundtrip-world';
  const serializedWindowBackup = JSON.parse(farmStorage.get(linkedWindowBackupKey));
  assert.equal(serializedWindowBackup.decor.length, 1, 'window-aware save must maintain one separate primary-window recovery record');
  assert.deepEqual(serializedWindowBackup.decor[0], serializedWindowLayout.decor[0], 'window recovery sidecar must preserve the complete primary decor record');

  farmStorage.delete(linkedWindowBackupKey); // Existing worlds may predate the sidecar entirely.
  const seededOnLoad = farmRoundTripContext.FarmEditor.loadFarmLayout();
  assert.equal(seededOnLoad.decor[0].id, 'decor_window_roundtrip', 'pre-sidecar authoritative layout must still load its linked window');
  assert.equal(JSON.parse(farmStorage.get(linkedWindowBackupKey)).decor[0].id, 'decor_window_roundtrip', 'loading a window-aware build must seed protection before any later save');

  // A build with this compatibility fix must not erase decor it cannot
  // instantiate. Preserve the opaque record byte-for-byte through a normal
  // save while the known linked window remains live.
  const futureDecor = { id:'decor_future_unknown', key:'futureBranchFurniture', col:9, row:4, area:'farm', rotYDeg:17, futurePayload:{ schema:42, nested:['keep','all','fields'] } };
  const layoutWithFutureDecor = JSON.parse(farmStorage.get(roundTripKey));
  layoutWithFutureDecor.decor.push(futureDecor);
  farmStorage.set(roundTripKey, JSON.stringify(layoutWithFutureDecor));
  assert.equal(farmRoundTripContext.FarmEditor.saveFarmLayout(), true, 'saving with unknown future decor must still succeed');
  const afterUnknownCarry = JSON.parse(farmStorage.get(roundTripKey));
  assert.deepEqual(afterUnknownCarry.decor.find(record=>record.id===futureDecor.id), futureDecor, 'unknown future decor must survive a current-build save unchanged');

  // Simulate exactly what an older branch does today: it loads the world
  // without recognizing windows, then rewrites the authoritative layout with
  // no window record. The separate sidecar must remain untouched and the next
  // window-aware load must merge the primary back before object restoration.
  const oldBranchRewrite = JSON.parse(farmStorage.get(roundTripKey));
  oldBranchRewrite.decor = [];
  farmStorage.set(roundTripKey, JSON.stringify(oldBranchRewrite));
  roundTripObjects.length = 0; farmScene.children.length = 0; interiorScene.children.length = 0; // Mirror a transient empty live registry before this branch has restored the surviving sidecar.
  assert.equal(farmRoundTripContext.FarmEditor.saveFarmLayout(), true, 'an early window-aware save after an old-branch wipe must not erase the only surviving window backup');
  assert.equal(JSON.parse(farmStorage.get(linkedWindowBackupKey)).decor.length, 1, 'transient empty live registry must leave the linked-window recovery sidecar intact');
  const recoveredAfterOldBranch = farmRoundTripContext.FarmEditor.loadFarmLayout();
  assert.equal(recoveredAfterOldBranch.decor.length, 1, 'returning from an older branch must recover the linked-window primary from the sidecar');
  assert.equal(recoveredAfterOldBranch.decor[0].id, 'decor_window_roundtrip', 'old-branch recovery must restore the same stable window id');
  assert.deepEqual(JSON.parse(JSON.stringify(recoveredAfterOldBranch.decor[0].wallPlacement)), roundTripPlacement, 'old-branch recovery must retain the complete linked wall placement'); // Normalize the vm-created clone into this test realm before strict structural comparison.

  roundTripObjects.length = 0; farmScene.children.length = 0; interiorScene.children.length = 0; delete roundTripDecorDefs.simpleWindow; roundTripPlacements.clear();
  farmRoundTripContext.FarmEditor.applyFarmLayoutObjects(farmRoundTripContext.FarmEditor.loadFarmLayout());
  await new Promise(resolve => setTimeout(resolve, 30));

  assert(extensionRepairCalls > 0, 'reload must repair extension window definitions before decor restoration');
  const restoredPrimary = roundTripObjects.find(entry => entry.id === 'decor_window_roundtrip');
  const peerId = 'decor_window_roundtrip:house-window-peer';
  const restoredPeer = roundTripObjects.find(entry => entry.id === peerId);
  assert(restoredPrimary && !restoredPrimary.derivedLinkedWindow, 'reload must restore exactly one ordinary primary window');
  assert(restoredPeer?.derivedLinkedWindow, 'linkage restore must regenerate the opposite-side peer after the interior rebuild');
  assert.equal(restoredPeer.linkedWindowPrimaryId, 'decor_window_roundtrip', 'regenerated peer must retain one-way ownership linkage to the primary');
  assert.equal(restoredPeer.mesh.parent, interiorScene, 'regenerated peer mesh must actually be attached to the rebuilt interior scene');
  assert.deepEqual(roundTripPlacements.get('decor_window_roundtrip')?.wallNormal, [1,0,0], 'primary keeps the exterior wall normal');
  assert.deepEqual(roundTripPlacements.get(peerId)?.wallNormal, [-1,0,0], 'derived peer independently uses the inward normal of its own wall');
  assert.equal(roundTripPlacements.get(peerId)?.houseWindowLink?.role, 'derived', 'peer wall placement must be marked derived rather than another owner');

  const firstLivePeer = restoredPeer;

  // Mirror spawnPlayerAvatar(): clearInteriorFurniture() destroys every live
  // decor mesh/record, but wall-placement sidecar data survives; then the
  // same saved farm layout is applied again for the selected world.
  for (const obj of [...roundTripObjects]) (obj.area === 'interior' ? interiorScene : farmScene).remove(obj.mesh);
  roundTripObjects.length = 0;
  farmRoundTripContext.FarmEditor.applyFarmLayoutObjects(farmRoundTripContext.FarmEditor.loadFarmLayout());
  await new Promise(resolve => setTimeout(resolve, 30));
  const worldReloadPeer = roundTripObjects.find(entry => entry.id === peerId);
  assert(worldReloadPeer?.derivedLinkedWindow, 'per-world second-stage restore must regenerate the synthetic peer after clearInteriorFurniture');
  assert.notEqual(worldReloadPeer, firstLivePeer, 'world-scoped reload must create a new peer object rather than rely on the cleared module-init instance');
  assert.equal(worldReloadPeer.mesh.parent, interiorScene, 'world-scoped regenerated peer must be attached to the active interior scene');
  assert.equal(roundTripObjects.filter(entry=>entry.id===peerId).length, 1, 'world-scoped reload must still have one deterministic peer id');

  const peerBeforeGeometryRebuild = worldReloadPeer;
  deps.rebuildInteriorGeometry(); // Actual game.js floor/wall rebuild leaves furniture in place.
  await new Promise(resolve => setTimeout(resolve, 20));
  const peerAfterGeometryRebuild = roundTripObjects.find(entry => entry.id === peerId);
  assert.equal(peerAfterGeometryRebuild, peerBeforeGeometryRebuild, 'ordinary interior geometry rebuild must preserve the already-live synthetic furniture record');
  assert.equal(peerAfterGeometryRebuild.mesh.parent, interiorScene, 'ordinary interior geometry rebuild must leave the peer mesh scene-attached');

  // Defensive repair: if any future scene path detaches the peer mesh without
  // removing its registry record, restorePairs must replace that stale record.
  interiorScene.remove(peerAfterGeometryRebuild.mesh);
  await farmRoundTripContext.HouseWindowLinkage.restorePairs({ rebuildAfter:false });
  const repairedPeer = roundTripObjects.find(entry => entry.id === peerId);
  assert(repairedPeer?.derivedLinkedWindow, 'stale-peer validation must leave one synthetic peer in the registry');
  assert.notEqual(repairedPeer, peerAfterGeometryRebuild, 'a detached synthetic registry record must be replaced, not silently reused');
  assert.equal(repairedPeer.mesh.parent, interiorScene, 'stale-peer replacement must be attached to the current interior scene');
  assert.equal(roundTripObjects.filter(entry=>entry.id===peerId).length, 1, 'stale-peer repair must not duplicate the deterministic peer id');
  assert(rebuildCount >= 3, 'regression must exercise both startup restores and a later explicit interior geometry rebuild');

  const diagnostics = farmRoundTripContext.HouseWindowLinkage.debugSnapshot();
  assert.equal(diagnostics.pairCount, 1, 'linked-window diagnostics must report exactly one primary pair');
  assert.equal(diagnostics.derivedPeerCount, 1, 'linked-window diagnostics must report exactly one live derived peer');
  assert.equal(diagnostics.interiorOpenings.length, 1, 'linked-window diagnostics must expose the restored interior wall aperture');

  // A real removal has a different signal from a transient clear: the prior
  // authoritative layout still contains the window, but its durable wall
  // placement and live object are both gone. That must clear the sidecar.
  roundTripObjects.length = 0;
  roundTripPlacements.clear();
  assert.equal(farmRoundTripContext.FarmEditor.saveFarmLayout(), true, 'intentional linked-window removal must save successfully');
  assert.equal(farmStorage.has(linkedWindowBackupKey), false, 'intentional linked-window removal must clear the recovery sidecar');
}

// Behavioral hierarchy regression: every Wide Window authored part remains under
// one canonical visualRoot, and linkage uses that root itself as the Select All
// transform target without inserting per-piece or wrapper hierarchies.
function runWindowAssemblyHierarchyRegression() {
  class FakeTransform {
    set(){ return this; } copy(){ return this; } identity(){ return this; } multiplyScalar(){ return this; } clone(){ return new FakeTransform(); } invert(){ return this; } applyQuaternion(){ return this; }
  }
  class FakeGroup {
    constructor(){ this.children=[]; this.parent=null; this.userData={}; this.position=new FakeTransform(); this.quaternion=new FakeTransform(); this.scale=new FakeTransform(); this.name=''; }
    add(child){ child.parent?.remove?.(child); child.parent=this; this.children.push(child); }
    remove(child){ const i=this.children.indexOf(child); if(i>=0)this.children.splice(i,1); if(child?.parent===this)child.parent=null; }
    updateMatrix(){}
  }
  const context={ console, setTimeout:()=>0, clearTimeout(){}, THREE:{ Group:FakeGroup, Vector3:FakeTransform, Quaternion:FakeTransform } };
  context.window=context;
  vm.runInNewContext(runtime, context, {filename:'daylight-window-runtime.js'});
  const root=new FakeGroup(), meshById=new Map();
  const wide=json('docs/config/furniture-authored/wideWindow.json');
  for(const part of wide.parts){ const node=new FakeGroup(); node.name=part.id; root.add(node); meshById.set(part.id,node); }
  root.userData.meshById=meshById;
  const visualRoot=context.DaylightWindowRuntime.__test.ensureWindowVisualRoot(root);
  assert.equal(visualRoot.parent, root, 'canonical visual root must be the single direct owner of authored window visuals');
  assert.equal(visualRoot.children.length, wide.parts.length, 'canonical visual root must capture every authored Wide Window part');
  for(const part of wide.parts) assert.equal(meshById.get(part.id).parent, visualRoot, `${part.id} must share the canonical visual root`);
  const daylightOverlay=new FakeGroup(); meshById.get('wide_window_pane').add(daylightOverlay);
  assert.equal(daylightOverlay.parent, meshById.get('wide_window_pane'), 'daylight overlay stays nested under the pane and therefore inside the shared visual root');

  context.WallOrnamentPlacement={ onPlayerPlacementChanged(){}, onPlayerPlacementRemoved(){} };
  vm.runInNewContext(linkage, context, {filename:'house-window-linkage.js'});
  const selectionRoot=context.HouseWindowLinkage.__test.ensureWindowSelectionRoot(root);
  assert.equal(selectionRoot, visualRoot, 'linkage must reuse the canonical window visual root as the fixed-slot visual target');
  assert.equal(visualRoot.parent, root, 'fixed-slot scaling must not insert an extra scale/content wrapper');
  for(const id of ['wide_window_frame_l','wide_window_frame_r','wide_window_frame_t','wide_window_frame_b','wide_window_pane','wide_window_mullion_l','wide_window_mullion_r']) {
    assert.equal(meshById.get(id).parent, visualRoot, `${id} must not escape into its own scale hierarchy`);
  }
}

// houseGenerator loaded above so wall-target metadata and aperture tests share the same source.
assert.match(houseGenerator, /function _cutFacesForOpenings\(faces, openings\)/, 'Highland wall generator must support multiple rectangular openings on one side');
assert.match(houseGenerator, /Array\.isArray\(opts\.windowCuts\)/, 'Highland generator must accept linked-window cuts');
assert.match(houseGenerator, /var bodyPanels = wallCut/, 'WallBuilder panels must come from already-cut wall faces whenever any door/window opening exists');

const houseCore = read('docs/js/house-pieces-core.js'); // House-piece rebuild passes current linked apertures into generated walls.
assert.match(houseCore, /windowCuts: window\.HouseWindowLinkage\?\.getExteriorWindowCuts/, 'exterior house rebuild must request linked-window silhouettes');
assert.match(houseCore, /onHouseGeometryRebuilt/, 'house-piece movement must notify linked windows after exterior geometry changes');

const houseEntry = read('docs/js/house-pieces.js'); // Dynamic core loader needs a cache-busted URL for the new opening integration.
assert.match(houseEntry, /house-pieces-core\.js\?v=20260924wallsurface1/, 'house-pieces entrypoint must load the shared rendered-wall footprint');
assert.match(houseCore, /entry\._exteriorRenderRect = _renderRectFor\(entry, exts\)/, 'the exact generated Highland footprint must be available before any window cut builds');

assert.match(wallPlacement, /ControllerInput\.subscribe\('wall-ornament-placement'/, 'wall preview may reuse the shared controller frame cadence without private gamepad polling');
assert.match(wallPlacement, /sharedControllerFrame\(\)[\s\S]{0,180}updatePlayerReticlePreview\(\)/, 'shared controller cadence must update only the reticle preview and leave movement/look channels untouched');
assert.match(gameSource, /WallOrnamentPlacement\?\.handleGameplayAction\?\.\(actionId, phase\)/, 'keyboard/controller/touch must route wall Action 1\/2 through the central semantic gameplay dispatcher');
assert.match(gameSource, /isPlayerReticlePlacementActive\?\.\(\)[\s\S]{0,260}runInputAction\(mouseAction, 'press'\)/, 'mouse Action 1\/2 must use the same reticle action path instead of click-position placement');
assert.doesNotMatch(gameSource, /if \(furniturePlacementArmedKey \|\| furnitureMoveArmedId\) return;/, 'reticle furniture placement must never freeze mouse camera rotation');
assert.match(gameSource, /menuOpen \|\| window\._desktopSelectionArc\?\.entryMenuOpen\?\.\(\) \|\| window\.FurniturePlacer\?\.isOpen\?\.\(\)/, 'mouse camera motion must be disabled for the full lifetime of the click-required furniture selector');
assert.match(gameSource, /function requestShoulderSurfPointerLock\(\)[\s\S]{0,420}FurniturePlacer\?\.isOpen\?\.\(\)/, 'Pointer Lock must not be reacquired while a click-required furniture menu is open');
assert.doesNotMatch(linkage, /function patchInteriorSceneBuilder\(api\)/, 'farmhouse openings must not depend on a global buildWallGroup monkey-patch or current-area timing');
assert.match(gameSource, /const houseWindowOpenings = window\.HouseWindowLinkage\?\.getInteriorWallOpenings\?\.\(\) \|\| \[\]/, 'farmhouse interior rebuild must fetch window openings directly every time it rebuilds');
assert.match(gameSource, /wallOpenings: houseWindowOpenings/, 'farmhouse brick generation must receive those openings even when the rebuild was triggered from outside');
assert.match(linkage, /function exteriorTaperScale\(v01\)/, 'exterior visual conformance must know the Highland wall taper at window height');
assert.match(linkage, /const widthScale = farmSide \? exteriorTaperScale\(EXTERIOR_SLOT_V01\) : 1/, 'farm-side window width must use the taper at the one fixed slot height');
assert.match(linkage, /const pivotY = \(finite\(silhouette\.minY\) \+ finite\(silhouette\.maxY\)\) \* 0\.5/, 'simplified exterior visual must scale around the authored window center that corresponds to the hole center');
assert.match(linkage, /function exteriorCutCenterForRender\(render, run, binding\)/, 'exterior frame and cut need one explicit projection bridge when owning-piece and generated-render taper centers differ');
assert.match(linkage, /const slotPoint = exteriorSlotSurface\(run, binding\)\?\.center/, 'cut projection must begin from the same rendered wall surface used to mount the frame');
assert.match(linkage, /untaperedAlongForRender = renderCenter \+ \(actualAlong - renderCenter\) \/ Math\.max\(0\.01, taperScale\)/, 'cut projection must invert the generated render rectangle taper around its own center');
assert.match(linkage, /uWidth: silhouette\.width \/ cutCenter\.renderLength/, 'exterior aperture width must stay normalized to the generated render while its center is physically aligned');
assert.doesNotMatch(linkage, /uWidth: silhouette\.width \/ \(renderLength \* taperScale\)/, 'exterior aperture must not be widened to chase the visible frame');
assert.match(gameIndex, /wall-ornament-placement\.js\?v=20260926rebase1/, 'game index must cache-bust outside-only fixed-slot wall placement');
assert.match(gameIndex, /furniture-placer\.js\?v=[^"'&\s<]+&window=20260926rebase1/, 'game index must cache-bust the exterior-only window catalog');
assert.match(gameIndex, /game\.js\?v=[^"'&\s<]+&window=20260926rebase1/, 'game index must cache-bust direct farmhouse interior opening injection');
assert.match(gameIndex, /HousePieceGen\.js\?v=[^"'&\s<]+&window=20260926rebase1/, 'game index must cache-bust explicit Highland wall-target metadata');
assert.match(gameIndex, /interior-scene-builder\.js\?v=[^"'&\s<]+&window=20260926rebase1/, 'game index must cache-bust the merged interior wall-target metadata');
assert.match(gameIndex, /house-window-linkage\.js\?v=20260926rebase1/, 'game index must cache-bust the shared window and brick-cut aperture root');
assert.match(linkage, /const surface = exteriorSlotSurface\(resolveRun\(binding\), binding\)/, 'exterior window visual must use the same Highland wall surface as placement and cut');
assert.doesNotMatch(linkage, /makeRotationX\(Math\.PI\)/, 'the discarded Wide Window hinge rotation must not remain');
assert.match(gameIndex, /farm-editor\.js\?v=[^"'&\s<]+&window=20260926rebase1/, 'game index must cache-bust primary-only linked-window persistence');
assert.match(canvasBuilder, /map: texture/, 'merge resolution must preserve main\'s stretched canvas texture while keeping per-panel wall meshes');
assert.match(canvasBuilder, /canvasSurfaceStretch = 'one-png-per-wall-panel'/, 'canvas wall merge must preserve one texture copy per panel');

const overlayScheduler = read('docs/js/daylight-window-overlay-scheduler.js'); // Pane tint cadence must never alternate complete lighting compositions.
assert.match(overlayScheduler, /setInterval\(updatePaneTint, PANE_TINT_MS\)/, 'pane tint may update independently at low frequency');
assert.doesNotMatch(overlayScheduler, /baseDraw|daylightDraw|drawLightingOverlay\s*=|WINDOW_REDRAW_MS/, 'scheduler must not alternate base-only and window-composited overlay frames');
const cloudFog = read('docs/js/cloud-forest-fog.js'); // Unified compositor owns exact darkness -> windows -> lights ordering.
assert.match(cloudFog, /function sampleEnclosedAtmosphere\(\)/, 'ordinary interiors must sample one shared atmosphere from nearby light sources');
assert.match(cloudFog, /sourceProximityWeight\(px, pz,[\s\S]{0,900}windowRuntime\?\.getActiveSources/, 'window contribution must be distance-weighted around the player');
assert.match(cloudFog, /getObjectByName\?\.\('mine_player_torch'\)/, 'the carried lantern must feed the same atmosphere blend instead of disappearing indoors');
assert.match(cloudFog, /walker\.rec\?\.tags\?\.includes\('watch'\)/, 'nearby Watch lantern carriers must feed the same atmosphere blend');
assert.match(cloudFog, /lightingDeps\.getFurnitureLightSources\?\.\(\)/, 'furniture lights must feed the same atmosphere blend');
assert.match(cloudFog, /rSum \+=.*weight[\s\S]*gSum \+=.*weight[\s\S]*bSum \+=.*weight/, 'source colors must be weight-averaged into one room color');
assert.match(cloudFog, /enclosedAtmosphereSmoothed\.illumination \+=/, 'room atmosphere must ease over time rather than snap between nearby sources');
assert.match(cloudFog, /drawBlendedInteriorAtmosphere\(darknessAlpha, rect\)/, 'ordinary buildings must draw the single blended atmosphere');
assert.match(cloudFog, /Exactly one atmosphere layer for darkness \+ blended source color/, 'ordinary room lighting must be a single full-screen atmosphere layer');
const ordinaryBranchStart = cloudFog.indexOf('if (ordinaryBuildingInterior(currentArea))');
const ordinaryBranchEnd = cloudFog.indexOf('} else {', ordinaryBranchStart);
const ordinaryBranch = cloudFog.slice(ordinaryBranchStart, ordinaryBranchEnd);
assert.doesNotMatch(ordinaryBranch, /drawLanternMasksCompat|drawFurnitureLightMasksCompat|drawAtmosphere/, 'ordinary interiors must not stack separate halo/mask lighting passes');
assert.match(gameIndex, /cloud-forest-fog\.js\?v=[^"'&\s<]+&window=20260926rebase1/, 'game index must cache-bust the single-atmosphere compositor');
assert.match(gameIndex, /daylight-window-runtime\.js\?v=20260926rebase1/, 'game index must cache-bust the canonical daylight-window visual hierarchy');
assert.match(furniturePlacerSource, /DaylightWindowRuntime\?\.registerDecorDefs\?\.\(decorativeDefs\)/, 'Furniture Placer must repair extension-provided window definitions at render time before filtering owned furniture');
assert.match(furniturePlacerSource, /!def\.playerFurnitureDisabled/, 'Furniture Placer must hide disabled legacy/dev furniture while leaving its definition available for save restoration');
const gameStyle = read('docs/style.css');
assert.match(gameIndex, /style\.css\?v=[^"'&\s<]+&window=20260926rebase1/, 'game index must cache-bust the responsive Farm Operations layout');
assert.match(gameStyle, /\.farm-pane\s*\{[\s\S]{0,220}width:\s*100%;[\s\S]{0,220}min-width:\s*0;[\s\S]{0,220}box-sizing:\s*border-box;/, 'Farm Operations pane must size inside its actual menu allocation instead of overflowing by padding/content width');
assert.match(gameStyle, /\.farm-storage\s*\{[\s\S]{0,260}repeat\(auto-fit,\s*minmax\(min\(190px,\s*100%\),\s*1fr\)\)/, 'Farm Storage must rearrange its columns from the pane width instead of a viewport-only breakpoint');
assert.match(gameStyle, /\.farm-storage-row \.farm-row-value\s*\{[\s\S]{0,180}min-width:\s*0;[\s\S]{0,180}white-space:\s*normal;[\s\S]{0,180}overflow-wrap:\s*anywhere;/, 'Farm Storage item labels must yield/wrap before pushing their action button out of view');
assert.match(gameStyle, /\.farm-storage-row \.settings-small-btn\s*\{\s*flex:\s*0 0 auto;/, 'Farm Storage Store/Take buttons must remain visible instead of shrinking or being clipped');
assert.match(gameStyle, /#furniturePlacerPanel \{ color: var\(--text\) !important; \}/, 'Furniture selector must force readable light text in dark interiors');
assert.match(gameStyle, /#furniturePlacerPanel \.farm-note,[\s\S]{0,120}#furniturePlacerHint \{ color: var\(--muted\) !important; \}/, 'Furniture selector secondary text must use the readable muted theme color');

Promise.resolve()
  .then(runWindowAssemblyHierarchyRegression)
  .then(runLinkedWindowReloadRegression)
  .then(() => console.log('daylight window authoring/runtime/3D-interior/linked-farmhouse regression checks passed'))
  .catch(error => { console.error(error); process.exitCode = 1; });
