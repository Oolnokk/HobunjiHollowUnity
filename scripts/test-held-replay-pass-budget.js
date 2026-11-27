'use strict';

// Regression for Northern Cliffs outdoor-FPS fixes: internal render bypass,
// safe offscreen participant filtering, and per-elevation depth scissoring.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
const src = read('docs/js/held-object-render-order.js');
const pixel = read('docs/js/pixel-probe.js');

function block(start, end) {
  const a = src.indexOf(start);
  const b = src.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, 'shipped code contains ' + start);
  return src.slice(a, b);
}

// The real installed runtime wrapper is NaturalSurfacePostJigsaw -> TerrainRenderChunks
// -> OutlineRenderPerformance -> native render. Replays must skip all three.
const unwrap = new Function(block('  function unwrapRendererRender(', '  const originalRender = rendererProto.render;')
  + '\nreturn unwrapRendererRender;')();
const nativeRender = function nativeRender() {};
const outline = function outline() {};
outline.__hobunjiOutlineRenderPerfOriginal = nativeRender;
const terrain = function terrain() {};
terrain.__hobunjiTerrainSurfaceOriginal = outline;
const natural = function natural() {};
natural.__hobunjiNaturalSurfacePostJigsawOriginal = terrain;
natural.__hobunjiTerrainSurfaceOriginal = outline;
assert.equal(unwrap(natural), nativeRender, 'the natural/terrain chain is completely bypassed by replay');
assert.equal(unwrap(terrain), nativeRender, 'the terrain wrapper alone is also bypassed');
const legacy = function legacy() {};
legacy.__hobunjiTerrainChunkOriginal = outline;
assert.equal(unwrap(legacy), nativeRender, 'older terrain decorator metadata remains supported');
assert.equal(unwrap(nativeRender), nativeRender, 'an unwrapped renderer is unchanged');

// Exercise the actual shipped conservative offscreen filter.
const projection = { multiplyMatrices(a, b) { this.projection = a; this.view = b; return this; } };
const frustum = {
  setFromProjectionMatrix(matrix) { this.matrix = matrix; return this; },
  intersectsObject(mesh) { return mesh.inView; },
};
const filter = new Function('participantProjection', 'participantFrustum',
  block('  function hasAlternateReplayPose(', '  function collectReplayCulled(')
  + block('  function filterOffscreenReplayMeshes(', '  function applyElevationScissor(')
  + '\nreturn filterOffscreenReplayMeshes;')(projection, frustum); // Source-extracted predicate shares the shipped trusted-pose culling guard.
const camera = { projectionMatrix: {}, matrixWorldInverse: {} };
const rigid = (inView, extra = {}) => ({
  isMesh: true, geometry: {}, matrixWorld: {}, frustumCulled: true,
  children: [], userData: {}, inView, ...extra,
});
const near = rigid(true);
const far = rigid(false);
const childAssembly = rigid(false, { children: [{}] });
const skinned = rigid(false, { isSkinnedMesh: true });
const instanced = rigid(false, { isInstancedMesh: true });
const morph = rigid(false, { geometry: { morphAttributes: { position: [{}] } } });
const fire = rigid(false, { userData: { hobunjiDungeonFireVfxPadding: 2 } });
const aura = rigid(false, { userData: { hobunjiHeldOverlayVfxPadding: 1 } });
const optedOut = rigid(false, { userData: { hobunjiReplayNeverCull: true } });
assert.deepEqual(filter(camera, [near, far, childAssembly, skinned, instanced, morph, fire, aura, optedOut]),
  [near, childAssembly, skinned, instanced, morph, fire, aura, optedOut],
  'only reliably bounded rigid offscreen leaves can be omitted');
assert.equal(filter({}, [far])[0], far, 'unknown camera state fails safely open');

// Exercise the shipped per-group scissor helper and its union fallback.
const rect = { x: 0, y: 0, z: 400, w: 200 }; // Union bounds restored for final ground depth and water tint.
const scratch = {};
const rectCalls = [];
const gl = { scissor(r) { rectCalls.push({ ...r }); } };
const applyGroupScissor = new Function('replayScissorRect', 'elevationScissorRect', 'scissorRect',
  'let groupScissorCount = 0;\n'
  + block('  function applyElevationScissor(', '  function replayScissorRect(')
  + '\nreturn applyElevationScissor;')(
  (_, __, meshes, out) => {
    if (meshes[0].uncertain) return false;
    Object.assign(out, { x: 100, y: 20, z: 40, w: 60 });
    return true;
  }, scratch, rect);
applyGroupScissor({}, camera, [{ uncertain: false }], gl);
applyGroupScissor({}, camera, [{ uncertain: true }], gl);
assert.deepEqual(rectCalls, [{ x: 100, y: 20, z: 40, w: 60 }, rect],
  'each known group is tightly bounded, while uncertainty restores union bounds');

const held = block('  function replaySelectiveHeldOverlay(', '  function isShellOutlinePass(');
const hiddenAt = held.indexOf('suppressedOverlay = suppressDraws('); // Runtime must first hide hands/tools/feet before collecting the ordinary depth blockers.
const cutoutAt = held.indexOf('const cutoutDepthMeshes = groups.length && canLockColorMask ? collectVisible(pngDepthRegistry, scene');
const coverAt = held.indexOf('const protectedDepthMeshes = groups.length && canLockColorMask ? collectVisible(protectedCoverRegistry, scene');
const groupAt = held.indexOf('for (const group of groups)');
assert(hiddenAt >= 0 && hiddenAt < cutoutAt && cutoutAt < coverAt && coverAt < groupAt,
  'visible depth registries are resolved once, after hiding replay participants and before elevation-group iteration');
const depthIteration = held.slice(groupAt, held.indexOf('for (const mesh of group.meshes)', groupAt));
assert.match(depthIteration, /prepareCutoutDepthMaterials\(cutoutDepthMeshes, protectedDepthMeshes\)/,
  'all elevations share the stable per-replay depth candidates');
assert.doesNotMatch(depthIteration, /collectVisible\((pngDepthRegistry|protectedCoverRegistry)/,
  'no elevation group may re-walk the same expensive depth registries');

for (const [name, body, flag] of [['held', held, 'scissored']]) {
  const group = body.indexOf('for (const group of groups)');
  const bounded = body.indexOf('applyElevationScissor(renderer, camera, group.meshes, glState', group);
  const depth = body.indexOf('renderer.clearDepth();', group);
  const restore = body.lastIndexOf('glState.scissor(scissorRect)');
  assert(group >= 0 && bounded > group && bounded < depth, name + ': group scissor precedes depth clear');
  assert(restore > depth, name + ': union scissor is restored after grouped depth clear');
  assert.match(body, new RegExp('if \\(' + flag + '\\) \\{[\\s\\S]*?glState\\.scissor\\(scissorRect\\)'), name + ': restore is guarded by active scissor state');
}
// The previous implementation accidentally disabled scissoring for each held color
// pass while leaving only that actor's smaller depth rectangle reconstructed.
const heldGroup = held.slice(held.indexOf('for (const group of groups)'), held.indexOf('// The final ground and translucent-cover restores'));
const heldOverlayAt = heldGroup.indexOf("window.PerfProfiler?.begin('held-overlay: elevation overlay render')");
assert(heldOverlayAt >= 0, 'held group still draws its source color and stencil');
assert.equal(heldGroup.indexOf('glState.setScissorTest(false)'), -1,
  'held source colors and water stencil may not escape the depth-reconstructed group scissor');
const entry = src.slice(src.indexOf('  function wrappedRender('), src.indexOf('  function snapshot('));
const baseRefresh = entry.lastIndexOf('refreshHeldMatrices?.(held)');
const baseFilter = entry.indexOf('filterOffscreenReplayMeshes(camera, held)');
assert(entry.indexOf('const baseRenderEndedAt = performance.now()') < baseRefresh && baseRefresh < baseFilter,
  'active procedural hand matrices must refresh before camera rejection');
const shellRefresh = entry.indexOf('refreshHeldMatrices?.(shellCandidates)');
assert(shellRefresh >= 0, 'shell-source matrices still refresh before the ordinary shell pass draws');
assert(entry.indexOf('const baseRenderEndedAt = performance.now()') < entry.indexOf('filterOffscreenReplayMeshes(camera, held)'),
  'source meshes are frustum-checked only after the base render updates matrices');
assert(entry.indexOf('filterOffscreenReplayMeshes(camera, held)') < entry.indexOf('replaySelectiveHeldOverlay(this, scene, camera, visibleHeld'),
  'out-of-view equipment cannot create extra elevation groups');
// A frame with no visible replay participants must replace old debug values.
const diagnosticNames = ['lastBaseReplayCandidates', 'lastBaseOffscreenFiltered',
  'lastForcedGroundDepthMaterials', 'lastNearbyTintCovers',
  'lastDistantTintCovers', 'lastWaterClipScopes', 'lastWaterClipOverflow'];
const noReplay = new Function(block('  function resetBaseReplayDiagnostics(', '  wrappedRender.__hobunjiHeldRenderOrderWrapped')
  + `
    const internalReplay = false, enabled = true, hasDisabledActorXray = false, allActorXrayDisabled = false;
    const retiredScenes = new WeakSet(), window = {}, maskedHands = new Set();
    const heldRegistry = {}, groundRegistry = {}, topFaceGroundRegistry = {}, tintCoverRegistry = {};
    const waterOccludedRegistry = {}, waterPortraitRegistry = {};
    const isBaseWorldPass = () => true, isShellOutlinePass = () => false, xrayRule = () => 'off';
    const currentFramebufferStencilBits = () => 8, collectVisible = () => [];
    const syncShoulderPetLayering = () => {}, scanScene = () => {}, updateFrontPlaneHands = () => {};
    const nearbyPortraitOrder = () => null, withPortraitDrawOrder = (_r, _order, draw) => draw();
    const originalRender = () => 'base-world';
    let replayCameraPosition, lastBaseStencilBits, lastFrontPortraitMaskCount, lastFrontPortraitGearCandidates;
    let lastFrontPortraitMaskedGear, lastFrontPortraitMaskReason, lastRankedPortraitActors, lastWaterPortraits;
    let lastDryGearWaterSkips, lastHeldFullscreenReason = 'skinned-mesh';
    let ${diagnosticNames.map(name => name + ' = 4').join(', ')};
    return {
      draw: () => wrappedRender({isScene:true}, {isCamera:true, layers:{mask:1}}),
      read: () => [${diagnosticNames.join(', ')}, lastHeldFullscreenReason],
    };
  `)();
assert.equal(noReplay.draw(), 'base-world');
assert.deepEqual(noReplay.read(), [...diagnosticNames.map(() => 0), 'no-visible-participants'],
  'skipping the replay clears the last active replay counters and fallback reason');

assert.match(pixel, /Held replay budget: offscreen=/,
  'Pixel Probe exposes effective skips, group scissor count and fullscreen reasons without devtools');
console.log('outdoor x-ray pass-budget tests passed');


 // Real all-off world/shell entrypoints and scene registration, not a reimplementation.
 // No ground or actor-owner dependencies are supplied; an accidental replay scan fails immediately.
const disabled = new Function('assert', [
  block('  function scanScene(', '  // One upward walk'),
  block('  function setActorXrayEnabled(', '  // Non-player weapon x-ray budget'),
  block('  function resetBaseReplayDiagnostics(', '  wrappedRender.__hobunjiHeldRenderOrderWrapped'),
  `
    const counts = { renders:0, scans:0, flushes:0, water:0, sorted:0, shoulder:0, repaired:0 };
    const collections = []; // Only ordinary held/portrait/water registries may be read.
    const scene = {isScene:true}, camera = {isCamera:true,layers:{mask:1}};
    const held = {}, portrait = {}, cover = {};
    const heldRegistry = {}, waterPortraitRegistry = {all:new Set([portrait])};
    const tintCoverRegistry = {all:new Set()};
    let time=0, wet=false, classificationScheduled=false;
    let lastSceneScan = new WeakMap();
    const scanJobs = new WeakMap(), advanceScanJob = () => { throw Error('the all-off entry point must not run a spread walk'); }, classifyObject = () => {};
    const FALLBACK_SCAN_INTERVAL_MS=750, CLASSIFICATION_PILOT_INTERVAL_MS=3000, retiredScenes=new WeakSet(), internalReplay=false;
    let slowClassificationFallbackEnabled=false, classificationFullScans=0, classificationForcedScans=0;
    const actorXrayEnabled={animals:false,enemies:false,player:false}, actorXrayRoots=new Map();
    let actorXrayScene=null, allActorXrayDisabled=true, hasDisabledActorXray=true;
    let actorXrayBypassFrames=0,actorXrayWaterOnlyFrames=0;
    const performance={now:()=>time}, maskedHands=new Set();
    const window={
      PlayerBodyTransformComposer:{getPlayerMesh:()=>({})},
    };
    const isBaseWorldPass=s=>!s.overrideMaterial;
    const classifyTree=()=>{counts.scans++;};
    const flushClassification=()=>{classificationScheduled=false;counts.flushes++;};
    const syncShoulderPetLayering=()=>{counts.shoulder++;};
    const enforceHeldMesh=m=>{assert.equal(m,held);counts.repaired++;};
    const collectVisible=(registry)=>{
      collections.push(registry);
      if(registry===heldRegistry)return [held];
      if(registry===waterPortraitRegistry)return [portrait];
      if(registry===tintCoverRegistry)return [...registry.all];
      throw Error('all-off mode touched an actor x-ray registry');
    };
    const currentFramebufferStencilBits=()=>8, xrayRule=()=> 'wet-tile';
    const nearbyPortraitOrder=(_s,_c,p)=>{assert.deepEqual(p,[portrait]);return {count:1};};
    const withPortraitDrawOrder=(_r,o,draw,protect)=>{assert.equal(o.count,1);assert.equal(protect,true);counts.sorted++;return draw();};
    const originalRender=()=>{counts.renders++;return 42;};
    const submergedPortraits=()=>({portraits:wet?[portrait]:[],scopes:[],touchingCovers:new Set([cover])});
    const replaySelectiveHeldOverlay=(_r,_s,_c,gear,feet,ground,top,covers,mask,body)=>{
      assert.deepEqual([gear,feet,ground,top],[[],[],[],[]]);
      assert.deepEqual(covers,[cover]);assert.equal(mask,1);
      assert.deepEqual(body.portraits,[portrait]);counts.water++;
    };
    let lastBaseStencilBits;
    let lastReplayCulledCount,lastReplayKeptCount,lastReplayInstancedCulled,lastReplayInstancedKept,lastReplayInertCount,lastReplayScissorCoverage;
    let lastOtherWeaponXrayActors,lastWaterPortraits,lastDryGearWaterSkips,lastFrontPortraitMaskCount,lastFrontPortraitGearCandidates;
    let lastFrontPortraitMaskedGear,lastFrontPortraitMaskReason,lastRankedPortraitActors,lastHeldFullscreenReason;
    let ${diagnosticNames.map(name=>name+'=4').join(',')};
    return {counts,collections,scene,camera,heldRegistry,waterPortraitRegistry,tintCoverRegistry,
      draw:()=>wrappedRender(scene,camera), shell:()=>wrappedRender({isScene:true,overrideMaterial:{}},camera),
      advance:()=>{time+=1000;}, added:()=>{classificationScheduled=true;},
      water:(submerged)=>{tintCoverRegistry.all.add(cover);wet=submerged;},
      scan:(s=scene,force=false)=>scanScene(s,force), setActorXrayEnabled,
      read:()=>({actorXrayBypassFrames,actorXrayWaterOnlyFrames,lastHeldFullscreenReason})};
  `
].join('\n'))(assert);
assert.equal(disabled.draw(),42);
assert.equal(disabled.counts.scans,1,'disabled scene still receives one initial registration');
assert.equal(disabled.counts.repaired,1,'ordinary held material invariant remains enforced');
assert.deepEqual(disabled.collections,[disabled.heldRegistry,disabled.waterPortraitRegistry],'dry path collects no ground, foot, actor or occlusion registry');
assert.equal(disabled.counts.sorted,1,'ordinary portrait layering still executes');
disabled.advance();disabled.draw();
assert.equal(disabled.counts.scans,1,'disabled mode has no periodic whole-scene scan');
disabled.added();disabled.draw();
assert.equal(disabled.counts.flushes,1,'newly added objects still receive registration');
assert.equal(disabled.counts.scans,1,'new objects do not restart a scene-wide scan');
const beforeShell=disabled.collections.length;
assert.equal(disabled.shell(),42);
assert.equal(disabled.collections.length,beforeShell,'disabled shell uses the normal renderer directly');
disabled.water(false);disabled.draw();
assert.equal(disabled.counts.water,0,'distant water cannot create a replay in disabled mode');
disabled.water(true);disabled.draw();
assert.equal(disabled.counts.water,1,'wet portraits retain independent water tint, without actor geometry');
assert.equal(disabled.read().actorXrayWaterOnlyFrames,1);
assert.equal(disabled.read().actorXrayBypassFrames,5);
assert.equal(disabled.read().lastHeldFullscreenReason,'all-actor-xray-disabled');
disabled.scan({isScene:true});assert.equal(disabled.counts.scans,2,'a newly entered scene still registers once');
disabled.scan(disabled.scene,true);assert.equal(disabled.counts.scans,3,'explicit forced registration remains supported');
disabled.setActorXrayEnabled('player',true);disabled.scan();
assert.equal(disabled.counts.scans,4,'re-enabling a category invalidates the disabled-mode discovery cache');
disabled.advance();disabled.scan();
assert.equal(disabled.counts.scans,5,'enabled fallback discovery remains intact');
disabled.setActorXrayEnabled('player',false);disabled.advance();disabled.scan();
assert.equal(disabled.counts.scans,5,'disabling again stops periodic discovery');
console.log('all actor x-ray disabled: dry, wet, shell, registration and re-enable paths passed');


 // The actual ordinary supplement helper may reuse the union's survivor list,
 // but must retain required cutouts, missing ground, live descendants and hooks.
const sharing = new Function(block('  function hideOrdinaryDepthRedraws(', '  function replaySelectiveHeldOverlay(')
  + block('  function isStillVisibleInScene(', '  function wrappedRender(')
  + `
    const MASK_ALL=0xffffffff,objectProto={}, scene={isScene:true,visible:true};
    const leaf=(parent=scene)=>({isMesh:true,isObject3D:true,visible:true,parent,children:[],layers:{mask:1}});
    const cutout=leaf(), ground=leaf(), normal=leaf(), hiddenParent={isGroup:true,visible:false,parent:scene};
    const hiddenChild=leaf(hiddenParent), hooked=leaf();hooked.onBeforeRender=()=>{};
    let walks=0;scene.traverseVisible=fn=>{walks++;[scene,cutout,ground,normal,hooked].forEach(fn);};
    const hideObjects=objects=>new Map(objects.map(o=>[o,o.visible]));
    let ordinaryDepthLeavesSkipped=0,ordinaryDepthSceneWalksAvoided=0;
    const first=hideOrdinaryDepthRedraws(scene,[cutout],[],[ground],[scene,cutout,ground,normal,hiddenChild,hooked],1);
    const second=hideOrdinaryDepthRedraws(scene,[cutout],[],[ground],null,1);
    const empty=hideOrdinaryDepthRedraws(scene,[],[],[],[scene,normal,hiddenChild],1);
    return {first,second,empty,normal,walks,shared:ordinaryDepthSceneWalksAvoided};
  `)();
assert.deepEqual([...sharing.first.hidden.keys()],[sharing.normal],'same-frame snapshot preserves missing ground and cutouts');
assert.deepEqual([...sharing.second.hidden.keys()],[sharing.normal],'ordinary full walk is equivalent');
assert.equal(sharing.first.hasDrawables,true,'unknown custom draw hook retains the depth draw');
assert.equal(sharing.empty.hasDrawables,false,'fully redundant visible leaves need no depth submission');
assert.equal(sharing.walks,1);
assert.equal(sharing.shared,2);
console.log('conditional ordinary-depth visibility sharing passed');
