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
const shell = block('  function replayShellOutlineXray(', '  function wrappedRender(');
const hiddenAt = held.indexOf('overlayHidden = hideObjects('); // Runtime must first hide hands/tools/feet before collecting the ordinary depth blockers.
const cutoutAt = held.indexOf('const cutoutDepthMeshes = canLockColorMask ? collectVisible(pngDepthRegistry, scene)');
const coverAt = held.indexOf('const protectedDepthMeshes = canLockColorMask ? collectVisible(protectedCoverRegistry, scene)');
const groupAt = held.indexOf('for (const group of groups)');
assert(hiddenAt >= 0 && hiddenAt < cutoutAt && cutoutAt < coverAt && coverAt < groupAt,
  'visible depth registries are resolved once, after hiding replay participants and before elevation-group iteration');
const depthIteration = held.slice(groupAt, held.indexOf('for (const mesh of group.meshes)', groupAt));
assert.match(depthIteration, /prepareCutoutDepthMaterials\(cutoutDepthMeshes, protectedDepthMeshes\)/,
  'all elevations share the stable per-replay depth candidates');
assert.doesNotMatch(depthIteration, /collectVisible\((pngDepthRegistry|protectedCoverRegistry)/,
  'no elevation group may re-walk the same expensive depth registries');

for (const [name, body, flag] of [['held', held, 'scissored'], ['shell', shell, 'scissorActive']]) {
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
const shellFilter = entry.indexOf('filterOffscreenReplayMeshes(camera, shellCandidates)');
assert(shellRefresh >= 0 && shellRefresh < shellFilter,
  'shell-source hand matrices must refresh before conservative shell rejection');
assert(entry.indexOf('const baseRenderEndedAt = performance.now()') < entry.indexOf('filterOffscreenReplayMeshes(camera, held)'),
  'source meshes are frustum-checked only after the base render updates matrices');
assert(entry.indexOf('filterOffscreenReplayMeshes(camera, held)') < entry.indexOf('replaySelectiveHeldOverlay(this, scene, camera, visibleHeld'),
  'out-of-view equipment cannot create extra elevation groups');
assert.match(pixel, /Held replay budget: offscreen=/,
  'Pixel Probe exposes effective skips, group scissor count and fullscreen reasons without devtools');
console.log('outdoor x-ray pass-budget tests passed');
