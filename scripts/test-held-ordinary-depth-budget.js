'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('docs/js/held-object-render-order.js', 'utf8'); // Execute compositor code, not a mirrored pass planner.
const begin = source.indexOf('  let ordinaryDepthLeavesSkipped ='); // Includes the supplement helper and complete held replay.
const end = source.indexOf('  function isShellOutlinePass(', begin);

function fixture({ bounded = false, ordinary = true, fail = false, colorLock = true, tint = false, nested = false, airborne = false, wildernessGround = false, groundShaderSupported = true, staleStencil = false, emptyDepth = false, emptyScissor = false, waterOnly = false, prune = true, customWaterHook = false, portraitParity = false, replacedAfterHook = false, lod = false, pendingShadow = false, mixedPrune = false, mixedWater = false, registryMemo = false, failWater = false } = {}) {
  const groundMaterial = wildernessGround ? { depthWrite: false,
    userData: { hobunjiXrayElevationShader: { supported: groundShaderSupported } } } : null; // Reproduces wilderness ground, including unsupported/cold elevation shaders.
  const opaque = { isMesh: true, visible: true, children: [], material: groundMaterial }; // Base world terrain whose held-only depth flag is tested below.
  const sky = { isMesh: true, visible: true, children: [], layers: { mask: 1 } }; // Far-plane cloud mask, not a physical gear occluder.
  const cutout = { isMesh: true, visible: true, children: [] }; // Portrait PNG needs forced alpha-tested depth.
  const cover = { isMesh: true, visible: true, children: [] }; // Water/grass must preserve occlusion of held parts.
  const weapon = { isMesh: true, visible: true, children: [], layers: { mask: 3 } }; // Ordinary held source.
  const hand = { isMesh: true, visible: true, children: [], layers: { mask: 3 } }; // Bounded x-ray participant.
  if (nested) weapon.children.push(hand); // Renderable offhand haft is also a parent of its flail head.
  const parent = { isMesh: true, visible: true, children: [cutout] }; // A mesh ancestor of a required cutout cannot be hidden.
  const hooked = { isMesh: true, visible: true, children: [], onBeforeRender() {} }; // Unknown draw-time behavior is retained.
  const scene = { background: 'sky', autoUpdate: true,
    traverseVisible(fn) { for (const node of [sky, opaque, ...(!emptyDepth ? [cover] : []), weapon, ...(!nested ? [hand] : []), ...(!emptyDepth ? [parent, hooked] : [])]) { if (node.visible) { fn(node); for (const child of node.children) if (child.visible) fn(child); } } },
  };
  if (waterOnly || mixedWater) {
    cover.layers = {mask:8};
    cutout.layers = {mask:1};
    scene.children = [sky, opaque, cover, weapon, hand, parent, hooked]; // Live tree used by the production pruning helper.
    if (customWaterHook) cover.onBeforeRender = () => {};
    if (portraitParity) {
      cutout.onBeforeRender=()=>{}; cutout.onAfterRender=()=>{};
      cutout.__hobunjiXrayBoundParity={hook:cutout.onBeforeRender,localRestoreHook:cutout.onAfterRender};
      if (replacedAfterHook) cutout.onAfterRender=()=>{};
    }
    if (lod) parent.isLOD=true;
  }
  const draws = []; // Captures submitted passes and visible world leaves.
  let clears = 0; // Counts destructive depth clears, not stencil clears.
  const camera = { layers: { mask: 1 } }; // Main camera restored after every replay.
  let stencilMask = staleStencil ? 0 : 0xff; // A previous read-only tint pass can leave all stencil writes disabled.
  let scissorTest = false; // The held replay rectangle covers only the first two simulated pixels.
  const stencil = staleStencil ? [1, 0xfc, 0xff] : [0, 0, 0]; // Dry portrait, current gear, and a pixel outside the replay rectangle.
  const renderer = { autoClear: true, autoClearColor: true, autoClearDepth: true, autoClearStencil: true, shadowMap: { autoUpdate: true, enabled:pendingShadow, needsUpdate:pendingShadow },
    state: {
      scissor() {}, setScissorTest(enabled) { scissorTest = enabled; },
      buffers: { color: colorLock ? { setMask() {}, setLocked() {} } : {},
        stencil: { setMask(mask) { stencilMask = mask; } },
      },
    },
    clearDepth() { clears++; },
    clearStencil() {
      for (let pixel = 0; pixel < (scissorTest ? 2 : stencil.length); pixel++) stencil[pixel] &= ~stencilMask;
    },
  };
  const hideObjects = objects => { const states = new Map(); for (const object of objects) { states.set(object, object.visible); object.visible = false; } return states; }; // Visibility transaction used by the owner.
  const scope = {
    window: airborne ? { PlayerJump: { debug: { active: true, phase: 'air', heightAboveGround: 1 } } } : {},
    xrayRule: key => key === 'background.gearDepth' ? 'ignore' : key === 'airborne.rebuildDepth' ? 'on' : 'off',
    isPortraitMaskedGear: () => false, // This test isolates depth transactions, not owner-specific stencil eligibility.
    withPortraitDrawOrder: (_renderer, _order, draw) => draw(), rankedHeldOverlayOrder: () => null, // Visual sorter and actor coupling are covered by test-xray-hierarchy.js.
    backgroundDepthRegistry: 'background',
    airborneDepthRebuilds: 0, backgroundDepthMeshesExcluded: 0,
    objectProto: { onBeforeRender: undefined }, internalReplay: false,
    lastBaseStencilBits: tint ? 8 : 0, replayScissorEnabled: staleStencil || emptyScissor, replayCullEnabled: false,
    replayScissorRect: () => true, scissorRect: { z: emptyScissor ? 0 : 2, w: 1 }, scissorTargetWidth: 3, scissorTargetHeight: 1,
    scissoredReplayCount: 0, applyElevationScissor: () => false,
    restoreRendererScissor() { scissorTest = false; },
    buildXrayGroups: () => ({ groups: bounded ? [{ meshes: [hand], regions: [{ col: 0, row: 0 }] }] : [], ordinary: ordinary ? [weapon] : [], scopes: [], hasUnknownOwner: false, tintScopeByMesh: new Map() }),
    collectGroundElevationMaterials: () => wildernessGround ? new Set([groundMaterial]) : [], hasOverlappingHeldCover: () => tint,
    forEachMaterial(material, visit) { for (const member of Array.isArray(material) ? material : [material]) if (member) visit(member); }, // Exercise the renderer's actual ground selection against ordinary and x-ray groups.
    splitXrayGroupsForTint: groups => groups.map(group => ({ ...group, tintStencilRef: 1 })),
    beginWaterReplayClip: () => new Map(), endWaterReplayClip() {}, // Other tests execute the production shader helper; this depth-budget fixture owns only its pass transactions.
    hideObjects, restoreVisibility: states => { for (const [object, visible] of states) object.visible = visible; },
    hideColorOnlyHeldVfx: () => null, // Colour-only VFX skip has its own test (test-held-color-only-depth-skip.js).
    showGroupGearParticles: () => null, // Drawn-once gear particles have their own test (test-held-gear-particles-once.js).
    collectVisible: registry => registry === 'background' ? [sky] : emptyDepth ? [] : registry === 'png' ? [cutout] : [cover],
    pngDepthRegistry: 'png', protectedCoverRegistry: 'cover',
    setGroundElevationFilter() {}, prepareCutoutDepthMaterials: () => new Map(), prepareNonGroundDepthMaterials: () => new Map(),
    saveMaterialState(states, material) { if (!states.has(material)) states.set(material, { depthWrite: material.depthWrite }); }, // The actual renderer transaction restores every property; only depth writes matter to this fixture.
    restoreMaterialStates(states) { for (const [material, state] of states) material.depthWrite = state.depthWrite; },
    prepareGroundDepthMaterials: () => new Map(),
    prepareSubmergedOverlayStencilMaterials: () => new Map(), prepareOverlayCoverTintMaterials: () => new Map(), prepareTintCoverDepthMaterials: () => new Map(),
    waterReplayCount: 0, WATER_REPLAY_MASK: 8, HELD_OVERLAY_MASK: 2, GROUND_REPLAY_MASK: 4, PORTRAIT_WATER_MASK: 16,
    waterOnlyBranchPruneEnabled: prune, waterOnlyPrunedFrames:0, waterOnlyPrunedBranches:0, waterOnlyPruneFallbacks:0,
    mixedWaterBranchPruneEnabled:mixedPrune,mixedWaterPrunedFrames:0,mixedWaterPrunedBranches:0,mixedWaterPruneFallbacks:0,mixedWaterVisited:0,
    replayRegistryMemoEnabled:registryMemo,
    stampSubmergedPortraits(renderer, scene, camera, portraits) {
      const mask = camera.layers.mask;
      const old = portraits.map(node => node.layers.mask);
      try {
        portraits.forEach(node => { node.layers.mask |= 16; });
        camera.layers.mask = 16;
        scope.rawRender.call(renderer,scene,camera);
      } finally {
        portraits.forEach((node,i) => {node.layers.mask = old[i];});
        camera.layers.mask = mask;
      }
    },
    rawRender: function(_scene, _camera) {
      const nodes = []; _scene.traverseVisible(node => { if ((node.layers?.mask ?? 1) & _camera.layers.mask) nodes.push(node); });
      draws.push({ mask: _camera.layers.mask, nodes, groundDepthWrite: groundMaterial?.depthWrite, opaqueVisible:opaque.visible, parentVisible:parent.visible }); // Confirm the true flag at submission, not merely after the helper runs.
      if (staleStencil && _camera.layers.mask === 2) {
        stencilMask = 1; // The current frame stamps only its submerged gear pixel.
        stencil[1] |= 1;
      }
      if (staleStencil && _camera.layers.mask === 8) {
        stencilMask = 0; // WebGL keeps the write mask from the tint material until another draw changes it.
        if (!draws.some(draw => draw.tintedPixels)) draws.at(-1).tintedPixels = stencil.slice(0, 2).map(bits => bits & 1);
      }
      if (fail || (failWater && _camera.layers.mask===8)) throw new Error('render failure');
    },
  };
  for (const name of ['lastBaseElevationGroups', 'lastHeldFullscreenReason', 'fullscreenReplayCount', 'lastReplayScissorCoverage', 'nonGroundDepthReplayCount', 'selectiveOverlayCount', 'groundDepthRestoreCount']) scope[name] = 0;
  const layerStart = source.indexOf('  function suppressDraws(');
  const layerEnd = source.indexOf('  function getSurfaceOcclusionDepthOnly(', layerStart);
  scope.MASK_ALL = 0xffffffff;
  vm.createContext(scope);
  vm.runInContext(source.slice(layerStart, layerEnd), scope);
  vm.runInContext(source.slice(source.indexOf('  function pruneWaterOnlyBranches('), source.indexOf('  function stampSubmergedPortraits(')), scope);
  vm.runInContext(source.slice(begin, end), scope);
  const before = { ...renderer }; // Verify all ordinary renderer flags restore after success or exceptions.
  const participants = [...(ordinary ? [weapon] : []), ...(bounded ? [hand] : [])]; // Only active sources are hidden by this render.
  const bodyTint = waterOnly ? {portraits:[cutout],touchingCovers:new Set([cover]),scopes:[]} : null;
  const run = () => scope.replaySelectiveHeldOverlay(renderer, scene, camera, participants, [], [opaque], [], [cover], 1, bodyTint);
  if (fail || failWater) assert.throws(run, /render failure/); else run();
  assert.equal(opaque.visible, true); assert.equal(cutout.visible, true); assert.equal(cover.visible, true); assert.equal(sky.visible, true);
  assert.equal(weapon.visible, true); assert.equal(hand.visible, true);
  assert.equal(parent.visible,true); assert.equal(hooked.visible,true);
  assert.equal(weapon.layers.mask, 3); assert.equal(hand.layers.mask, 3);
  assert.equal(camera.layers.mask, 1); assert.equal(scene.background, 'sky'); assert.equal(scene.autoUpdate, true);
  assert.equal(renderer.autoClear, before.autoClear); assert.equal(renderer.shadowMap.autoUpdate, true);
  assert.equal(scope.internalReplay, false);
  if (groundMaterial) assert.equal(groundMaterial.depthWrite, false, 'every render exit restores the wilderness ground material');
  const forcedGround = vm.runInContext('lastForcedGroundDepthMaterials', scope); // The shipping module uses a lexical counter rather than exposing it on the context.
  return { draws, clears, stencil, opaque, cutout, cover, sky, parent, hooked, scope, weapon, hand, forcedGround };
}
const normal = fixture(); // Common above-floor case: supplement + source draw, without a terrain redraw/restore.
assert.equal(normal.clears, 0);
assert.equal(normal.draws.length, 2);
assert(!normal.draws[0].nodes.includes(normal.opaque), 'opaque terrain is absent from the depth supplement');
for (const required of [normal.cutout, normal.cover, normal.parent, normal.hooked]) assert(normal.draws[0].nodes.includes(required));
const empty = fixture({ emptyDepth: true });
assert.equal(empty.draws.length, 1, 'no drawable depth source: omit native supplement, retain held color');
assert.equal(empty.draws[0].mask, 2);
assert.equal(empty.clears, 0);
assert.equal(fixture({ emptyScissor: true }).draws.length, 0, 'a proven zero-pixel union performs no native replay');
const airborneNormal = fixture({ airborne: true });
assert(airborneNormal.clears >= 2, 'airborne ordinary group and the fallback scene restore both rebuild depth');
assert(!airborneNormal.draws[0].nodes.includes(airborneNormal.sky), 'visual sky masks are omitted from weapon depth reconstruction');
assert(airborneNormal.draws.some(draw => draw.nodes.includes(airborneNormal.sky)), 'full original world depth, including sky, is restored afterwards');
assert(airborneNormal.draws.some(draw => draw.mask === 2 && draw.nodes.includes(airborneNormal.weapon)), 'held depth is rebuilt after restoring sky');
assert(airborneNormal.scope.airborneDepthRebuilds > 0 && airborneNormal.scope.backgroundDepthMeshesExcluded > 0,
  'mobile counters confirm the airborne mask exemption ran');
const mixed = fixture({ bounded: true }); // The later holder-local floor replay must still rebuild depth normally.
assert.equal(mixed.clears, 1);
assert.equal(mixed.draws.length, 5);
assert(mixed.draws[2].nodes.includes(mixed.opaque), 'bounded x-ray depth retains opaque cover');
assert.equal(fixture({ bounded: true, ordinary: false }).clears, 1);
assert.equal(fixture({ colorLock: false }).clears, 1, 'unsupported renderer uses the original full-depth fallback');
const submerged = fixture({ tint: true }); // Unchanged base ground depth must precede both water tint and cover depth restore.
assert.deepEqual(submerged.draws.map(draw => draw.mask), [1, 2, 8, 8]);
assert.equal(submerged.clears, 0);
// Only the actual portrait parity owner may advertise a local-only pair.
{
  const parity = fs.readFileSync('docs/js/portrait-plane-outline-parity.js','utf8');
  const start=parity.indexOf('  function installMeshHook(');
  const end=parity.indexOf('  const PNG_PLANE_OUTLINE_OCCLUDER_MASK',start);
  const objectProto={onBeforeRender(){},onAfterRender(){}};
  const THREE={Object3D:{prototype:objectProto},Matrix4:class{}};
  const install=new Function('THREE',parity.slice(start,end)+'\nreturn installMeshHook;')(THREE);
  const mesh=()=>({isMesh:true,userData:{},...objectProto});
  const clean=mesh(); assert(install(clean));
  assert.equal(clean.__hobunjiXrayBoundParity.localRestoreHook,clean.onAfterRender);
  const customBefore=mesh(); customBefore.onBeforeRender=()=>{}; install(customBefore);
  assert.equal(customBefore.__hobunjiXrayBoundParity,undefined);
  const customAfter=mesh(); customAfter.onAfterRender=()=>{}; install(customAfter);
  assert.equal(customAfter.__hobunjiXrayBoundParity.localRestoreHook,undefined);
}
// Mixed gear+water uses the existing live tree pruner only during the last two water passes.
const mixedPruned=fixture({tint:true,mixedWater:true,mixedPrune:true,registryMemo:true});
const mixedLegacy=fixture({tint:true,mixedWater:true});
const ids = f => f.draws.map(d=>({mask:d.mask,nodes:d.nodes.map(n=>n===f.cover?'cover':n===f.weapon?'weapon':n===f.hand?'hand':n===f.cutout?'cutout':n===f.opaque?'ground':n===f.parent?'parent':n===f.sky?'sky':'other')}));
assert.deepEqual(ids(mixedPruned),ids(mixedLegacy),'mixed prune retains native draw identity and order');
assert.equal(mixedPruned.scope.mixedWaterPrunedFrames,1);
assert(mixedPruned.scope.mixedWaterPrunedBranches>0);
assert(mixedPruned.draws.filter(d=>d.mask===8).every(d=>!d.opaqueVisible),'unrelated terrain hidden only for water draws');
assert.equal(fixture({tint:true,mixedWater:true,mixedPrune:true,customWaterHook:true}).scope.mixedWaterPruneFallbacks,1);
assert.equal(fixture({tint:true,mixedWater:true,mixedPrune:true,lod:true}).scope.mixedWaterPruneFallbacks,1);
assert.equal(fixture({tint:true,mixedWater:true,mixedPrune:true,pendingShadow:true}).scope.mixedWaterPruneFallbacks,1);
fixture({tint:true,mixedWater:true,mixedPrune:true,failWater:true}); // Restore even if the final water draw throws.
const privateWater = fixture({ordinary:false,tint:true,waterOnly:true});
const legacyWater = fixture({ordinary:false,tint:true,waterOnly:true,prune:false});
assert.deepEqual(privateWater.draws.map(d=>d.mask),[16,8,8],'portrait stamp, water tint and depth restoration are preserved');
assert.deepEqual(privateWater.draws.map(d=>d.nodes.map(n=>n===privateWater.cutout?'portrait':n===privateWater.cover?'water':'other')),legacyWater.draws.map(d=>d.nodes.map(n=>n===legacyWater.cutout?'portrait':n===legacyWater.cover?'water':'other')),'same private-layer draw identity and order');
assert(privateWater.draws.every(d=>!d.opaqueVisible && d.parentVisible),'irrelevant terrain is hidden, selected portrait ancestry remains visible');
assert(legacyWater.draws.every(d=>d.opaqueVisible));
assert.equal(privateWater.scope.waterOnlyPrunedFrames,1);
assert(privateWater.scope.waterOnlyPrunedBranches>0);
const customWater = fixture({ordinary:false,tint:true,waterOnly:true,customWaterHook:true});
assert.equal(customWater.scope.waterOnlyPruneFallbacks,1,'custom draw hook retains complete scene');
assert(customWater.draws.every(d=>d.opaqueVisible));
const localParity=fixture({ordinary:false,tint:true,waterOnly:true,portraitParity:true});
assert.equal(localParity.scope.waterOnlyPrunedFrames,1,'known local portrait matrix hook does not disable pruning');
assert.equal(fixture({ordinary:false,tint:true,waterOnly:true,portraitParity:true,replacedAfterHook:true}).scope.waterOnlyPruneFallbacks,1);
assert.equal(fixture({ordinary:false,tint:true,waterOnly:true,lod:true}).scope.waterOnlyPruneFallbacks,1);
const pendingShadowWater=fixture({ordinary:false,tint:true,waterOnly:true,pendingShadow:true});
assert.equal(pendingShadowWater.scope.waterOnlyPruneFallbacks,1,'manual shadow refresh sees all scene casters');
assert(pendingShadowWater.draws.every(d=>d.opaqueVisible));
fixture({ordinary:false,tint:true,waterOnly:true,fail:true}); // Every state restored even if the stamp throws.
const staleTint = fixture({ tint: true, staleStencil: true });
assert.deepEqual(staleTint.draws.find(draw => draw.tintedPixels).tintedPixels, [0, 1],
  'water tints current submerged gear only, even if a previous frame marked the dry portrait pixel');
assert.deepEqual(staleTint.stencil, [0, 0, 0],
  'replay clears all stencil bits inside and outside the scissor before handing the target back');
const floodedXray = fixture({ bounded: true, tint: true }); // Actual floor exceptions still restore opaque ground before water tint.
assert.deepEqual(floodedXray.draws.map(draw => draw.mask), [1, 2, 1, 2, 2, 4, 8, 8]);
const flail = fixture({ bounded: true, nested: true });
assert(!flail.draws[3].nodes.includes(flail.weapon), 'the haft is suppressed in the head’s replay group');
assert(flail.draws[3].nodes.includes(flail.hand), 'suppressing the haft must never prune its head from the scene graph');
fixture({ fail: true });
const ordinaryWilderness = fixture({ wildernessGround: true }); // Ordinary held parts must also obey physical ground depth outside the x-ray circle.
assert.equal(ordinaryWilderness.clears, 0, 'ordinary ground restoration reuses the original cheap supplement (no full depth clear)');
assert(ordinaryWilderness.draws[0].nodes.includes(ordinaryWilderness.opaque),
  'the selective supplement retains ground that failed to write depth in the normal world pass');
assert.equal(ordinaryWilderness.draws[0].groundDepthWrite, true,
  'ordinary held equipment cannot x-ray through non-depth-writing wilderness ground');
assert.equal(ordinaryWilderness.draws[1].groundDepthWrite, false,
  'the ordinary held weapon color pass restores the authored ground depth setting');
assert.equal(ordinaryWilderness.forcedGround, 1, 'the ordinary path contributes its repair to mobile diagnostics');
const ordinaryLegacy = fixture({ wildernessGround: true, colorLock: false });
assert.equal(ordinaryLegacy.draws[0].groundDepthWrite, true,
  'unsupported color-mask renderers still repair ground depth in their full replay');
const wilderness = fixture({ bounded: true, ordinary: false, wildernessGround: true });
assert.equal(wilderness.draws[0].groundDepthWrite, true,
  'the actual colorless ground-depth rebuild writes missing wilderness depth outside the actor circle');
assert.equal(wilderness.draws[1].groundDepthWrite, false,
  'the held weapon color pass cannot inherit the temporary ground material depth override');
assert.equal(wilderness.draws[2].groundDepthWrite, false,
  'the final ground restore preserves wilderness material settings');
assert.equal(wilderness.forcedGround, 1, 'the active replay exposes one repaired ground material in mobile diagnostics');
const fallbackGround = fixture({ bounded: true, ordinary: false, wildernessGround: true, groundShaderSupported: false });
assert.equal(fallbackGround.draws[0].groundDepthWrite, true,
  'unsupported/cold ground shaders still write physical depth outside the player circle');
assert.equal(fallbackGround.draws[1].groundDepthWrite, false,
  'fallback ground cannot leak the temporary depth override into the held color pass');
assert.equal(fallbackGround.forcedGround, 1, 'the phone counter also includes fallback material repairs');
fixture({ bounded: true, ordinary: false, wildernessGround: true, fail: true }); // Even an interrupted render must restore the material.
fixture({ wildernessGround: true, fail: true }); // Ordinary supplement exceptions restore ground too.
console.log('ordinary held replay: 2 passes instead of 3; no opaque terrain depth redraw; mixed/fallback/exception checks passed');
