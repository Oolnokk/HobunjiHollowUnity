'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const splinePath = path.join(root, 'docs/js/animal-shoulder-spline.js');
const profilesPath = path.join(root, 'docs/js/animal-shoulder-spline-profiles.js');
const parityPath = path.join(root, 'docs/js/animal-shoulder-spline-layering.js');
const legacyBootstrapPath = path.join(root, 'docs/js/animal-shoulder-rest.js');
const legacyV5BootstrapPath = path.join(root, 'docs/js/animal-shoulder-rest-v5.js');
const authorPath = path.join(root, 'docs/tools/animal-head-rig/author-part6.js');
const separatorAuthorPath = path.join(root, 'docs/tools/animal-head-rig/author-part7.js');
const broadAuthorPath = path.join(root, 'docs/tools/animal-head-rig/author-part8.js');
const twoPointAuthorPath = path.join(root, 'docs/tools/animal-head-rig/author-part9.js');
const shellPath = path.join(root, 'docs/tools/animal-head-rig/index.html');
const bridgePath = path.join(root, 'docs/js/player-body-attachment-bridge.js');
const combatLoaderPath = path.join(root, 'docs/js/combat/combat-config-loader.js');
const indexPath = path.join(root, 'docs/index.html');

const splineSource = fs.readFileSync(splinePath, 'utf8');
const profilesSource = fs.readFileSync(profilesPath, 'utf8');
const paritySource = fs.readFileSync(parityPath, 'utf8');
const legacyBootstrapSource = fs.readFileSync(legacyBootstrapPath, 'utf8');
const legacyV5BootstrapSource = fs.readFileSync(legacyV5BootstrapPath, 'utf8');
const authorSource = fs.readFileSync(authorPath, 'utf8');
const separatorAuthorSource = fs.readFileSync(separatorAuthorPath, 'utf8');
const broadAuthorSource = fs.readFileSync(broadAuthorPath, 'utf8');
const twoPointAuthorSource = fs.readFileSync(twoPointAuthorPath, 'utf8');
const shellSource = fs.readFileSync(shellPath, 'utf8');
const bridgeSource = fs.readFileSync(bridgePath, 'utf8');
const combatLoaderSource = fs.readFileSync(combatLoaderPath, 'utf8');
const indexSource = fs.readFileSync(indexPath, 'utf8');

global.window = global;
delete global.AnimalShoulderSpline;
delete global.AnimalShoulderRest;
require(splinePath);
const api = global.AnimalShoulderSpline;
assert(api, 'BEFORE/AFTER shoulder spline runtime should install');
assert.equal(api.version, 10);
assert.equal(api.POINT_COUNT, 7);
assert.equal(global.AnimalShoulderRest, api, 'legacy diagnostic alias points at v10 runtime');

delete global.HobunjiShoulderSplitLayerParity;
require(parityPath);
const parityApi = global.HobunjiShoulderSplitLayerParity; // Used below to reproduce the non-shoulder overlay leak caught by Pixel Probe.
assert.equal(parityApi?.version, 3, 'split-layer parity v3 installs for the runtime regression');
const parityGroup = { children: [], userData: { hobunjiShoulderRest: { splitOverlayVisible: false } } }; // Parent shoulder state owns whether the split overlay is allowed to exist visibly.
const paritySourceMesh = { isSkinnedMesh: true, visible: true, renderOrder: 2, frustumCulled: false, layers: { mask: 1 }, material: { depthWrite: true, depthTest: true }, userData: { hobunjiPlaneFace: 'back' } }; // Represents the correctly textured ordinary animal face.
const parityOverlayMesh = { visible: false, renderOrder: 2, frustumCulled: false, layers: { mask: 1 }, material: { depthWrite: true, depthTest: true }, userData: { hobunjiShoulderSplitOverlay: true, hobunjiPlaneFace: 'back' }, parent: parityGroup }; // Represents the raw cloned split-frame helper that must stay hidden off-shoulder.
parityGroup.children.push(paritySourceMesh, parityOverlayMesh);
parityApi.syncOverlay(paritySourceMesh, parityOverlayMesh);
assert.equal(parityOverlayMesh.visible, false, 'ordinary farm/wild/barn avatars keep shoulder-only split overlays hidden even while their source face is visible');
parityGroup.userData.hobunjiShoulderRest.splitOverlayVisible = true;
parityApi.syncOverlay(paritySourceMesh, parityOverlayMesh);
assert.equal(parityOverlayMesh.visible, true, 'shoulder presentation can explicitly enable the split foreground');
paritySourceMesh.visible = false;
parityApi.syncOverlay(paritySourceMesh, parityOverlayMesh);
assert.equal(parityOverlayMesh.visible, false, 'an enabled split foreground still follows its paired source face visibility');
paritySourceMesh.visible = true;
parityGroup.userData.hobunjiShoulderRest.splitOverlayVisible = false;
parityApi.syncOverlay(paritySourceMesh, parityOverlayMesh);
assert.equal(parityOverlayMesh.visible, false, 'disabling shoulder presentation hides the split foreground again');

const straightGuide = { a: { x: 0.2, y: 0.4 }, b: { x: 0.8, y: 0.4 } };
const straightBefore = api.linearPointsForGuide(straightGuide);
const identity = { enabled: true, useSpline: true, frameShiftX: .2, beforePoints: straightBefore, afterPoints: straightBefore.map(p => ({ ...p })) };
const source = { x: 0.5, y: 0.58 };
const identityResult = api.deformNormalizedPoint(source, identity);
assert(Math.abs(identityResult.x - source.x) < 1e-4, 'same BEFORE/AFTER preserves X');
assert(Math.abs(identityResult.y - source.y) < 1e-4, 'same BEFORE/AFTER preserves Y');
assert.equal(api.sampleShoulderInfluence(null, .19, .5, { frameShiftX: .2 }), 0, 'default shoulder Influence is zero left of separator');
assert.equal(api.sampleShoulderInfluence(null, .21, .5, { frameShiftX: .2 }), 1, 'default shoulder Influence is full right of separator');

const diagonal = { frameShiftX: .5, separatorRotationDeg: 45, separatorAspect: 1 };
assert(api.separatorSignedSide(.6, .5, diagonal) > 0, 'separator center-right remains on the right side');
assert(api.separatorSignedSide(.4, .5, diagonal) < 0, 'separator center-left remains on the left side');
assert(api.separatorSignedSide(.4, .3, diagonal) > 0, 'positive Z rotation makes upper-left cross onto the right side');
assert(api.separatorSignedSide(.6, .7, diagonal) < 0, 'positive Z rotation makes lower-right cross onto the left side');
const rightPolygon = api.separatorPolygon(400, 300, diagonal, true);
const leftPolygon = api.separatorPolygon(400, 300, diagonal, false);
assert(rightPolygon.length >= 3 && leftPolygon.length >= 3, 'diagonal separator clips both image halves into valid polygons');
const normalizedDiagonal = api.normalizeRest({ shoulderRest: { ...identity, separatorRotationDeg: 31, separatorAspect: 4 / 3 } });
assert.equal(normalizedDiagonal.separatorRotationDeg, 31, 'separator Z rotation survives runtime normalization');
assert.equal(normalizedDiagonal.separatorAspect, 4 / 3, 'source aspect survives runtime normalization');

const curvedBefore = straightBefore.map(p => ({ ...p }));
curvedBefore[2].y = 0.46;
curvedBefore[3].y = 0.51;
curvedBefore[4].y = 0.46;
const curvedIdentity = { enabled: true, useSpline: true, frameShiftX: .2, beforePoints: curvedBefore, afterPoints: curvedBefore.map(p => ({ ...p })) };
const curvedSource = { x: 0.5, y: 0.60 };
const curvedIdentityResult = api.deformNormalizedPoint(curvedSource, curvedIdentity);
assert(Math.abs(curvedIdentityResult.x - curvedSource.x) < 3e-3, 'curved BEFORE mapped to itself preserves source X');

assert(Math.abs(curvedIdentityResult.y - curvedSource.y) < 3e-3, 'curved BEFORE mapped to itself preserves source Y');

// The complete rectangular right-side strip must bind, including pixels whose
// nearest location lies beyond the spline's endpoint tangent planes.
const translatedAfter = straightBefore.map(point => ({ x: point.x, y: point.y + .2 }));
const pastEndSource = { x: .95, y: .4 };
const pastEndBind = api.bindFrameForPoint(straightBefore, pastEndSource);
assert(pastEndBind && pastEndBind.t > .999 && pastEndBind.alongOffset > 0,
  'pixels beyond the last bind vertex remain attached through endpoint-tangent extension');
const pastEndTarget = api.deformNormalizedPoint(pastEndSource, {
  enabled: true, useSpline: true, frameShiftX: .2,
  beforePoints: straightBefore, afterPoints: translatedAfter,
});
assert(Math.abs(pastEndTarget.x - .95) < 1e-4 && Math.abs(pastEndTarget.y - .6) < 1e-4,
  'endpoint-extension pixels follow AFTER instead of becoming an undeformed dead wedge');

const aspectRest = { frameShiftX: .5, separatorRotationDeg: 45, separatorAspect: 2 };
const allUnsetLarge = api.decodeWeightMap({ width: 101, height: 101, encoding: 'rle-u9', unsetValue: 256, data: [10201, 256] });
assert.equal(api.sampleShoulderInfluence(null, .6, .65, aspectRest), 1,
  'source-aspect separator classifies the test point on the right');
assert.equal(api.sampleShoulderInfluence(allUnsetLarge, .6, .65, aspectRest), 1,
  'adding an unset paint map must not replace source aspect with weight-map aspect');
const coarseUnset = api.decodeWeightMap({ width: 2, height: 2, encoding: 'rle-u9', unsetValue: 256, data: [4, 256] });
assert.equal(api.sampleShoulderInfluence(coarseUnset, .51, .5, { frameShiftX: .5, separatorRotationDeg: 0, separatorAspect: 1 }), 1,
  'an all-unset coarse shoulder map does not invent a bilinear fade just right of the separator');
const explicitFullLarge = api.decodeWeightMap({ width: 101, height: 101, encoding: 'rle-u9', unsetValue: 256, data: [10201, 255] });
assert.equal(api.sampleShoulderInfluence(explicitFullLarge, .4, .65, aspectRest), 0,
  'explicit old paint cannot leak shoulder deformation onto the separator-owned left side');
const aspectDiagonal = api.linearPointsForGuide({ a: { x: .2, y: .2 }, b: { x: .8, y: .8 } });
const aspectBind = api.bindFrameForPoint(aspectDiagonal, { x: .5, y: .5 }, 2);
assert(Math.abs(aspectBind.tangent.x - .8944271909999159) < 1e-6 && Math.abs(aspectBind.tangent.y - .4472135954999579) < 1e-6,
  'spline tangent uses image-plane aspect instead of normalized-square geometry');

const after = curvedBefore.map(p => ({ ...p }));
after[3].y += 0.20;
const posed = { enabled: true, useSpline: true, frameShiftX: .2, beforePoints: curvedBefore, afterPoints: after };
const posedCenter = api.deformNormalizedPoint({ x: curvedBefore[3].x, y: curvedBefore[3].y }, posed);
assert(posedCenter.y > curvedBefore[3].y + 0.15, 'moving AFTER midpoint moves the same BEFORE bind location');
const fullHead = api.deformWeightedPoint(curvedSource, 1, posed);
assert.deepEqual(fullHead, curvedSource, '100% Head Influence still completely fights shoulder deformation');

const zeroMap = { width: 2, height: 2, encoding: 'rle-u9', unsetValue: 256, data: [4, 0] };
const fullMap = { width: 2, height: 2, encoding: 'rle-u9', unsetValue: 256, data: [4, 255] };
const stretchAfter = api.linearPointsForGuide({ a: { x: .2, y: .4 }, b: { x: 1.0, y: .4 } });
const stretchRest = { enabled: true, useSpline: true, frameShiftX: .2, beforePoints: straightBefore, afterPoints: stretchAfter };
const stretchPoint = { x: .5, y: .4 };
const stretchFree = api.deformWeightedPoint(stretchPoint, 0, stretchRest);
assert(stretchFree.x > stretchPoint.x + .05, 'default right-side shoulder Influence follows a stretching pose');
const stretchLocked = api.deformWeightedPoint(stretchPoint, 0, { ...stretchRest, stretchabilityMap: zeroMap });
assert(Math.abs(stretchLocked.x - stretchPoint.x) < 1e-5, 'zero shoulder Stretchability blocks local spline stretch');
const compressUnaffected = api.deformWeightedPoint(stretchPoint, 0, { ...stretchRest, compressibilityMap: zeroMap });
assert(compressUnaffected.x > stretchPoint.x + .05, 'Compressibility does not block a locally stretching section');
const influenceLocked = api.deformWeightedPoint(stretchPoint, 0, { ...stretchRest, weightMap: zeroMap, stretchabilityMap: fullMap });
assert(Math.abs(influenceLocked.x - stretchPoint.x) < 1e-5, 'zero shoulder Influence blocks the shoulder deformation regardless of material allowance');

const compressAfter = api.linearPointsForGuide({ a: { x: .2, y: .4 }, b: { x: .6, y: .4 } });
const compressRest = { enabled: true, useSpline: true, frameShiftX: .2, beforePoints: straightBefore, afterPoints: compressAfter };
const compressFree = api.deformWeightedPoint(stretchPoint, 0, compressRest);
assert(compressFree.x < stretchPoint.x - .02, 'default right-side shoulder Influence follows a compressing pose');
const compressLocked = api.deformWeightedPoint(stretchPoint, 0, { ...compressRest, compressibilityMap: zeroMap });
assert(Math.abs(compressLocked.x - stretchPoint.x) < 1e-5, 'zero shoulder Compressibility blocks local spline compression');

const legacyV6 = {
  enabled: true, useSpline: true, splitFrame: true, splitRightUsesIdle: true,
  frameShiftX: 0.52, followFrameShiftX: true,
  restGuide: { a: { x: 0.542, y: 0.57 }, b: { x: 1, y: 0.57 } },
  splinePoints: [
    { x: .542, y: .57 }, { x: .58, y: .62 }, { x: .61, y: .68 }, { x: .63, y: .75 },
    { x: .64, y: .83 }, { x: .64, y: .92 }, { x: .63, y: 1.02 },
  ],
};
const migratedV6 = api.normalizeRest({ shoulderRest: legacyV6 });
assert.equal(migratedV6.migratedFromLegacy, true);
assert.equal(migratedV6.beforePoints.length, 7, 'v6 straight restGuide becomes seven BEFORE points');
assert.equal(migratedV6.afterPoints.length, 7, 'v6 splinePoints become seven AFTER points');
assert.deepEqual(migratedV6.afterPoints, legacyV6.splinePoints);
assert.equal(migratedV6.separatorRotationDeg, 0, 'older exports migrate to a vertical separator');

const oldCurl = api.normalizeRest({ shoulderRest: {
  enabled: true, useSpline: true, frameShiftX: .52,
  guide: straightGuide, fullRotationDeg: 40, interVertexRotationDeg: -20, weightFalloff: .4,
} });
assert.equal(oldCurl.beforePoints.length, 7, 'rotation/falloff export gets a BEFORE line');
assert.equal(oldCurl.afterPoints.length, 7, 'rotation/falloff export gets an AFTER line');
assert(!Object.hasOwn(oldCurl, 'weightFalloff'));

assert.match(profilesSource, /\['grehlr', 'voorg-ass', 'uumkaoii', 'gar-wolf', 'dabinggi-hound', 'puktuk'\]/,
  'only the approved six species receive shoulder-spline support');
assert.match(profilesSource, /version: 3, species: SPECIES/,
  'profile registry version bump prevents cached pre-Puktuk allowlist from being accepted');
assert.match(profilesSource, /beforePoints:\s*GREHLR_BEFORE/);
assert.match(profilesSource, /afterPoints:\s*GREHLR_AFTER/);
assert.match(profilesSource, /bodyOnlyRig\(\)/, 'Voorg-Ass/Uumkao’ii can carry a body spline before head paint exists');

for (const id of ['shoulderPaintSource','shoulderEditBefore','shoulderEditAfter','resetShoulderAfter','shoulderSeparatorRotation']) {
  assert(shellSource.includes(`id="${id}"`), `rigger exposes ${id}`);
}
assert(shellSource.includes('BEFORE / Bind') && shellSource.includes('AFTER / Pose'));
assert(shellSource.includes('animal-shoulder-spline.js?v=20260917spline10'));
assert(shellSource.includes('animal-head-rig-authored.js?v=20260918uploads2'),
  'rigger loads the same committed uploaded rig overrides as gameplay');
assert(shellSource.includes('author-part7.js'));
assert(shellSource.includes('author-part8.js'), 'rigger loads additive broad-pose authoring after precise/separator authoring');
assert(shellSource.includes('author-part9.js'), 'rigger loads the direct two-point endpoint tool after the broad-pose layer');
assert(!shellSource.includes('id="shoulderFullRotation"'));
assert(!shellSource.includes('id="shoulderInterRotation"'));
assert.match(shellSource, /minmax\(150px,1fr\).*minmax\(150px,1fr\).*20vh/s,
  'desktop right panel reserves more vertical room for both canvases than settings');

assert.match(authorSource, /let shoulderInfluenceMap=null/);
assert.match(authorSource, /let shoulderCompressibilityMap=null/);
assert.match(authorSource, /let shoulderStretchabilityMap=null/);
assert.match(authorSource, /weightMap=exportShoulderMap\(shoulderInfluenceMap\)/,
  'shoulder Influence serializes inside shoulderRest separately from head Influence');
assert.match(authorSource, /stretchabilityMap=exportShoulderMap\(shoulderStretchabilityMap\)/);
assert.match(authorSource, /JSON\.stringify\(stored\)!==JSON\.stringify\(rig\)/,
  'Save rig for game preview retains round-trip verification');
assert.match(authorSource, /shoulderFrameShift\?\.addEventListener\('pointerdown',\(\)=>checkpointHistory\(\)\)/,
  'Frame shift starts an undo checkpoint before moving both spline lines');

assert.match(separatorAuthorSource, /separatorPointIsRight/,
  'right-side paint gating uses the same rotated separator math as runtime');
assert.match(separatorAuthorSource, /separatorPolygon/,
  'rigger frame fusion clips art against the diagonal separator polygon');
assert.match(separatorAuthorSource, /separatorRotationDeg=shoulderSeparatorRotationValue\(\)/,
  'separator Z rotation serializes into shoulderRest');
assert.match(separatorAuthorSource, /shoulderAfterPoints=cloneShoulderPoints\(shoulderBeforePoints/,
  'Reset AFTER restores an identity copy of the current BEFORE line');
assert.match(separatorAuthorSource, /canvas\.style\.height=`\$\{cssHeight\}px`/,
  'canvas fills the taller viewport instead of being aspect-shrunk inside it');

for (const id of ['shoulderBroadFullRotation','shoulderBroadInterRotation','shoulderBroadFalloff','bakeShoulderBroadPose']) {
  assert(broadAuthorSource.includes(`id="${id}"`), `broad-pose macro exposes ${id}`);
}
assert.match(broadAuthorSource, /Same constant-curvature construction used by the retired fullRotationDeg/,
  'broad pose deliberately reuses the retired rotation/inter-vertex curve model');
assert.match(broadAuthorSource, /aspect=Math\.max\(\.000001,s\.width\/Math\.max\(1,s\.height\)\)/,
  'broad rotation/bend math uses the PNG image-plane aspect');
assert.match(broadAuthorSource, /return\{x:base\.x\+delta\.x,y:base\.y\+delta\.y\}/,
  'broad deformation is additive over each precise AFTER point');
assert.match(broadAuthorSource, /shoulderAfterPoints=effectiveShoulderAfterPoints\(\);resetShoulderBroadControls\(false\)/,
  'Bake commits the visible macro result into AFTER and neutralizes the macro');
assert.match(broadAuthorSource, /x:target\.x-delta\.x,y:target\.y-delta\.y/,
  'precise node dragging subtracts macro displacement so manual edits and broad controls coexist');
assert.match(broadAuthorSource, /rest\.afterPoints=effectiveShoulderAfterPoints\(\)/,
  'preview/export receives final explicit AFTER points rather than legacy macro fields');
assert.match(broadAuthorSource, /minX=Math\.min\(minX,p\.x\*s\.width\)/,
  'workbench framing expands to include off-image BEFORE/AFTER nodes');
assert.match(broadAuthorSource, /shoulderBroadPointerToSource/,
  'off-image precise nodes use an unclamped shoulder-edit pointer');

for (const id of ['editShoulderTwoPoint','snapShoulderStartToShift','snapShoulderEndToRightEdge']) {
  assert(twoPointAuthorSource.includes(`id="${id}"`), `two-point endpoint tool exposes ${id}`);
}
assert(!twoPointAuthorSource.includes('resetShoulderTwoPoint'),
  'two-point mode has no redundant editor-only pose layer to reset');
assert.match(twoPointAuthorSource, /shoulderAfterPoints\[index\]=\{x:numberOr\(target\?\.x,0\)-delta\.x,y:numberOr\(target\?\.y,0\)-delta\.y\}/,
  'two-point mode writes directly into the real AFTER endpoint while compensating any active broad macro');
assert.match(twoPointAuthorSource, /setVisibleShoulderAfterEndpoint\(0,\{x:shoulderFrameShiftValue\(\),y:\.5\}\)/,
  'Start snap places visible AFTER vertex 1 at frame-shift X and vertical center');
assert.match(twoPointAuthorSource, /setVisibleShoulderAfterEndpoint\(SHOULDER_POINT_COUNT-1,\{x:1,y:\.5\}\)/,
  'End snap places visible AFTER vertex 7 at the center of the right source PNG edge');
assert(!twoPointAuthorSource.includes('startDelta') && !twoPointAuthorSource.includes('endDelta'),
  'two-point mode must not interpolate a hidden displacement across vertices 2-6');
assert.match(twoPointAuthorSource, /if\(shoulderTwoPointEditMode\)return-1/,
  'ordinary seven-node hit testing is disabled while the two-point view owns the canvas');
assert.match(twoPointAuthorSource, /drawHandle\(points\[0\],'1'\);[\s\S]*drawHandle\(points\[SHOULDER_POINT_COUNT-1\],'2'\)/,
  'two-point mode draws only the numbered beginning/end handles');
assert.match(twoPointAuthorSource, /version:2/,
  'diagnostic API identifies the simplified direct-endpoint implementation');
assert.match(twoPointAuthorSource, /shoulderEditBefore\?\.addEventListener\('click'/,
  'switching to BEFORE exits the two-point AFTER editor instead of leaving contradictory modes active');
assert.match(twoPointAuthorSource, /if\(!shoulderRestUseSpline\.checked\)shoulderRestUseSpline\.checked=true/,
  'entering a valid two-point edit enables the shoulder spline so handles cannot appear active-but-dead');

assert.match(splineSource, /function separatorSignedSide\(/,
  'runtime has one signed-side classifier for diagonal frame ownership');
assert.match(splineSource, /function separatorPolygon\(/,
  'runtime exposes half-plane clipping polygons to editor and game compositor');
assert.match(splineSource, /function shoulderResponseKind\(rest, bind\)/,
  'runtime classifies local curved-strip strain as compression or stretch');
assert.match(splineSource, /alongOffset: startAlong/,
  'runtime retains longitudinal offset for pixels before the first bind point');
assert.match(splineSource, /alongOffset: endAlong/,
  'runtime retains longitudinal offset for pixels beyond the last bind point');
assert.match(splineSource, /const authoredAspect = finite\(restLike\?\.separatorAspect, 0\)/,
  'unset shoulder paint defaults prefer the authored source-sprite aspect');
assert.match(splineSource, /const owned = shoulderDefaultInfluence\(u, topV, restLike, aspect\);[\s\S]*if \(owned <= 0\) return 0;/,
  'separator ownership hard-clamps shoulder Influence to zero on the left even when stale explicit paint exists');
assert.match(splineSource, /return raw === UNSET_WEIGHT \? owned : clamp\(raw, 0, 255\) \/ 255;/,
  'UNSET shoulder Influence inherits the hard sample-point default while authored paint remains explicit');
assert.match(splineSource, /sampleShoulderMaterial\(maps\.stretchability/,
  'runtime samples shoulder Stretchability independently of head material paint');
assert.match(splineSource, /Number\(avatarRef\.shoulderRest\?\.version\) >= 10/,
  'v10 shoulder avatars are not decorated a second time');
assert.match(splineSource, /rest\.separatorAspect = runtimeDimensions\.width \/ runtimeDimensions\.height/,
  'avatar construction replaces legacy square aspect with the actual runtime sprite-plane aspect');

assert.match(paritySource, /INTRA_PET_RENDER_EPSILON = 0\.01/);
assert.match(paritySource, /Object\.defineProperty\(overlay, 'renderOrder'/,
  'split foreground stays a live follower of pet x-ray render order');
assert.match(paritySource, /overlay\.layers\.mask = source\.layers\.mask/);
assert.match(paritySource, /const requestedVisible = overlay\.parent\?\.userData\?\.hobunjiShoulderRest\?\.splitOverlayVisible === true/,
  'split-layer parity reads the shoulder-presenter activation state instead of making every authored overlay visible');
assert.match(paritySource, /overlay\.visible = requestedVisible && source\.visible !== false/,
  'a split overlay follows front\/back face visibility only after shoulder presentation explicitly enables it');
assert.doesNotMatch(paritySource, /overlay\.visible = source\.visible;/,
  'ordinary farm, wild, barn-sleep, and other non-shoulder avatars cannot inherit source visibility into a shoulder-only split overlay');
assert.match(paritySource, /HobunjiShoulderSplitLayerParity = \{ version: 3/,
  'fixed shoulder split visibility ships as parity runtime v3');

for (const bootstrapSource of [legacyBootstrapSource, legacyV5BootstrapSource]) {
  assert(bootstrapSource.includes('animal-shoulder-spline.js?v=20260917spline10'));
  assert(bootstrapSource.includes('AnimalShoulderRestV5 = { version: 10'));
}
assert.match(bridgeSource, /AnimalShoulderSpline\.version\) < 10/,
  'game attachment bridge explicitly requires the v10 shoulder runtime');
assert.match(bridgeSource, /separatorPolygon/,
  'game split compositor uses the same diagonal separator polygon as the rigger');
assert.match(bridgeSource, /separatorRotationDeg/,
  'game frame cache key changes when separator Z rotation changes');
assert.match(bridgeSource, /stableRole === 'shoulderPet'/, 'game shoulder role remains the activation gate');
assert(bridgeSource.includes('animal-shoulder-spline-layering.js?v=20260918parity3'),
  'attachment bridge requests the fixed parity runtime under a fresh cache key');
assert(combatLoaderSource.includes('player-body-attachment-bridge.js?v=20260918shoulderparity3'),
  'combat loader invalidates the attachment bridge cache so the parity3 URL is actually reached');
assert(indexSource.includes('js/combat/combat-config-loader.js?v=20260918weaponthrowspin2'),
  'deployed index invalidates the combat loader cache for the complete shoulder parity update chain');

console.log('animal-shoulder-spline v10: audited shoulder authoring/runtime tests passed');
