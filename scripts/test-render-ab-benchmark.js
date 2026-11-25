#!/usr/bin/env node
'use strict';

// Executes docs/js/render-ab-benchmark.js with a fake rAF clock: it alternates
// frame scope on/off, times the pipeline's renderFrame, restores everything,
// and adds its Settings row next to the Test Arena row. A fake GL queue makes
// readPixels wait for queued "GPU work" so the synced per-pass window can be
// checked, and painterly filter passes run inside the composite pass.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

let clock = 0;
const frameCallbacks = [];
const scopeHistory = [];
const outlineHistory = [];
const painterlyHistory = [];
let painterlyMode = 'medium';
let renderCostMs = 2;
const registered = [];
let pass = 'main';
let gpuPending = 0; // Fake GPU work queued since the last readPixels (0.01 ms per draw).
let nativeRender = function (passName, draws, sceneName = 'world') {
  // Mimics RenderHooks' dispatch of the innermost hook around one native render.
  pass = passName;
  // Render list: named trees for world passes so draw contributors can be grouped by ancestry.
  const forest = { name: 'forest_3', parent: null };
  const items = Array.from({ length: Math.min(draws, 3) }, (_, i) => ({ object: { name: 'tree_' + (10 + i), parent: forest } }));
  const ctx = { scene: { name: sceneName }, depth: 0, renderer: {
    info: { render: { calls: draws, triangles: draws * 100 } },
    renderLists: { get: () => ({ opaque: items, transparent: passName === 'main' ? [{ object: { name: '', type: 'Mesh', parent: null } }] : [] }) },
  } };
  for (const hook of registered) {
    const state = hook.before?.(ctx);
    clock += 1;
    gpuPending += draws * 0.01;
    if (hook.scope === 'frame') continue;
    hook.afterRender?.(ctx, state);
  }
};
function endFrame() {
  for (const hook of registered.filter(h => h.scope === 'frame' && h.__state)) { hook.after?.({}, hook.__state); hook.__state = null; }
}
let heldFullscreen = 0;
const pipeline = {
  renderFrame() {
    clock += renderCostMs;
    heldFullscreen++; // One unscissored held replay per frame in this fixture.
    nativeRender('main', 80); nativeRender('main', 14); nativeRender('shell', 4);
    if (painterlyMode !== 'off') { nativeRender('composite', 1, 'painterly_oil'); nativeRender('composite', 1, 'painterly_wash'); }
    nativeRender('composite', 1, 'world_render_composite');
    endFrame();
  },
  snapshot: () => ({ lastFrame: { nativeRenders: 17 } }),
  currentPass: () => pass,
};
const hooks = {
  setFrameScopeEnabled(on) { scopeHistory.push(on); renderCostMs = on ? 2 : 5; },
  register(spec) { registered.push(spec); return () => registered.splice(registered.indexOf(spec), 1); },
};
const anchorRow = { insertAdjacentElement(where, element) { this.inserted = { where, element }; } };
const elements = new Map();
const document = {
  readyState: 'complete',
  getElementById: id => id === 'devTeleportArenaBtn' ? { closest: () => anchorRow } : elements.get(id) || null,
  createElement: tag => ({ tag, className: '', textContent: '', attributes: {}, children: [], listeners: {},
    setAttribute(k, v) { this.attributes[k] = v; }, append(...c) { this.children.push(...c); },
    addEventListener(type, fn) { this.listeners[type] = fn; }, set id(v) { this._id = v; elements.set(v, this); }, get id() { return this._id; } }),
  addEventListener() {},
};
let skinnedScissor = true; const skinnedScissorHistory = [];
let hideFadedOut = true; const hideFadedOutHistory = [];
let treeInstancing = true; const treeInstancingHistory = [];
let staticWallMatrices = false; const staticWallHistory = []; // Separate from dense-wall draw batching.
const npcWeaponHistory = []; const gearParticleHistory = []; const propBatchHistory = []; const dualSyncHistory = []; const wheelListHistory = []; const denMemoHistory = [];
const window = {
  RenderHooks: hooks, WorldRenderPipeline: pipeline, devicePixelRatio: 2,
  __hobunjiGameRenderer: { getContext: () => ({
    drawingBufferWidth: 800, drawingBufferHeight: 450, RGBA: 1, UNSIGNED_BYTE: 2,
    readPixels() { clock += 0.5 + gpuPending; gpuPending = 0; }, // 0.5 ms round trip + whatever the GPU still has queued.
    finish() { clock += 0.5 + gpuPending; gpuPending = 0; },
  }) },
  HeldObjectRenderOrder: { setGearParticlesOnceEnabled(v) { gearParticleHistory.push(v); }, setHeldOwnerLinkEnabled(v) { npcWeaponHistory.push('link:' + v); }, setOtherWeaponXrayLimit(n) { npcWeaponHistory.push('limit:' + n); },
    snapshot: () => ({ heldOwnerLinkEnabled: true, otherWeaponXrayLimit: 0 /* Shipped default: NPC weapons in the base pass. */, scissoredReplays: 0, fullscreenReplays: heldFullscreen, lastHeldFullscreenReason: 'skinned-mesh', lastShellFullscreenReason: 'none', lastReplayScissorCoverage: 1, lastReplayCulled: 0, lastReplayKept: 42, heldMeshes: 3, skinnedScissorEnabled: skinnedScissor }),
    setSkinnedScissorEnabled(value) { skinnedScissor = value !== false; skinnedScissorHistory.push(skinnedScissor); return skinnedScissor; } },
  InventoryWheelList: { crossFrameEnabled: () => true, setCrossFrameEnabled(v) { wheelListHistory.push(v); return v; } },
  HobunjiDualWieldWeaponVisuals: { leanSyncEnabled: () => true, setLeanSyncEnabled(v) { dualSyncHistory.push(v); return v; } },
  DenseForestWallBatches: { staticMatrixSnapshot:()=>({enabled:staticWallMatrices,enrolled:63}), setStaticMatrixEnabled:v=>{staticWallMatrices=v===true;staticWallHistory.push(staticWallMatrices);return staticWallMatrices;} },
  ZonePropRenderBatches: { snapshot: () => ({ enabled: true, batches: 12 }), setEnabled(v) { propBatchHistory.push(v); return v; } },
  WildernessTreeInstancer: { enabled: () => treeInstancing, setEnabled(value) { treeInstancing = value !== false; treeInstancingHistory.push(treeInstancing); return treeInstancing; } },
  ZoneVegetationCull: { snapshot: () => ({ hideFadedOut, lastCullables: 600 }),
    setHideFadedOut(value) { hideFadedOut = value !== false; hideFadedOutHistory.push(hideFadedOut); return hideFadedOut; } },
  PainterlyPostprocess: {
    getMode: () => painterlyMode,
    setMode(mode) { painterlyMode = mode; painterlyHistory.push(mode); },
    snapshot: () => ({ mode: painterlyMode, internalSize: '800x450' }),
  },
  __hobunjiFurnitureDebug: { currentArea: () => 'map_western_slope', outlinesSetting: true, setOutlines(v) { this.outlinesSetting = v; outlineHistory.push(v); } },
};
window.window = window;
const context = {
  window, document, navigator: { userAgent: 'test' }, console, Promise, setTimeout,
  Event: class Event { constructor(type, init = {}) { this.type = type; this.bubbles = !!init.bubbles; } },
  performance: { now: () => clock },
  requestAnimationFrame: cb => { frameCallbacks.push(cb); },
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('docs/js/render-ab-benchmark.js', 'utf8'), context, { filename: 'render-ab-benchmark.js' });
assert.ok(anchorRow.inserted && anchorRow.inserted.where === 'afterend', 'Settings row is inserted after the Test Arena row');
assert.equal(anchorRow.inserted.element.attributes['data-dev-only'], '', 'the row is dev-only');

const originalRenderFrame = pipeline.renderFrame;
// A rain group that its own update keeps visible; the benchmark may hide it only while drawing.
const rainGroup = { visible: true };
const denseChunk = { visible: true };
window.GridTileAccessors = { getActiveScene: () => ({ getObjectByName: name => name === 'world_rain_planes' ? rainGroup : name === 'AuthoredCloudForestDenseChunk_0' ? denseChunk : null }),
  denStateMemoEnabled: () => true, setDenStateMemoEnabled(v) { denMemoHistory.push(v); return v; } };
// Cloud Forest cull-radius slider: 'input' only (never persisted), plus a forced corridor pass.
const forestRadiusHistory = [];
let corridorUpdates = 0;
elements.set('settingCloudForestCullRadius', { value: '30', dispatchEvent(event) { forestRadiusHistory.push([event.type, this.value]); } });
window.ZoneVegetationCull = { ...window.ZoneVegetationCull, update(force) { if (force) corridorUpdates++; } };
const rainSeenDuringRender = [];
const originalNative = nativeRender;
nativeRender = function (passName, draws, sceneName) {
  // Frame hooks registered by the benchmark run like RenderHooks would: once per frame.
  for (const hook of registered.filter(h => h.scope === 'frame')) if (!hook.__state) hook.__state = hook.before?.({}) ?? true;
  rainSeenDuringRender.push(rainGroup.visible);
  return originalNative(passName, draws, sceneName);
};
const done = window.RenderABBenchmark.run({ rounds: 2, framesPerWindow: 20, variants: ['frameScopeOff', 'outlinesOff', 'painterlyOff', 'nearForest', 'fadedTreesDrawn', 'treeInstancingOff', 'propBatchesOff', 'staticWallMatricesOn', 'denCollisionEveryTile', 'wheelListEveryFrame', 'dualWieldFullSync', 'gearParticlesEveryPass', 'npcWeaponsXray', 'skinnedScissorOff', 'rainOff'] });
(async function pump() {
  // Each animation frame: the game renders once, then the frame's callbacks run.
  await new Promise(resolve => setImmediate(resolve));
  for (let i = 0; i < 2000 && frameCallbacks.length; i++) {
    clock += 10;
    pipeline.renderFrame(clock);
    const callbacks = frameCallbacks.splice(0);
    for (const cb of callbacks) cb(clock);
    await new Promise(resolve => setImmediate(resolve)); // Let the awaiting benchmark schedule its next frame.
  }
  const report = await done;
  assert.equal(scopeHistory.filter(on => on === false).length, 2, 'frame scope is turned off once per round');
  assert.equal(scopeHistory.at(-1), true, 'and left on');
  assert.deepEqual(outlineHistory.filter(v => v === false).length, 2, 'outlines are turned off once per round');
  assert.equal(window.__hobunjiFurnitureDebug.outlinesSetting, true, 'outlines restored');
  assert.equal(pipeline.renderFrame, originalRenderFrame, 'the timing wrapper is removed');
  assert.deepEqual(Object.keys(report.variants), ['default', 'frameScopeOff', 'outlinesOff', 'painterlyOff', 'nearForest', 'fadedTreesDrawn', 'treeInstancingOff', 'propBatchesOff', 'staticWallMatricesOn', 'denCollisionEveryTile', 'wheelListEveryFrame', 'dualWieldFullSync', 'gearParticlesEveryPass', 'npcWeaponsXray', 'skinnedScissorOff', 'rainOff']);
  assert.equal(denMemoHistory.join(' '), 'false true false true', 'denCollisionEveryTile restores the per-task memo after each window');
  assert.equal(wheelListHistory.join(' '), 'false true false true', 'wheelListEveryFrame restores the cross-frame list after each window');
  assert.equal(dualSyncHistory.join(' '), 'false true false true', 'dualWieldFullSync restores lean sync after each window');
  assert.equal(propBatchHistory.join(' '), 'false true false true', 'propBatchesOff restores prop batching after each window');
  assert.equal(staticWallHistory.join(' '),'true false true false','static wall A/B restores independently each window');
  assert.equal(staticWallMatrices,false);
  assert.equal(gearParticleHistory.join(' '), 'false true false true', 'gearParticlesEveryPass restores drawn-once particles after each window');
  assert.equal(npcWeaponHistory.join(' '), 'link:false limit:Infinity link:true limit:0 link:false limit:Infinity link:true limit:0', 'npcWeaponsXray restores every weapon\'s x-ray per window and puts the base-pass default back');
  assert.equal(treeInstancingHistory.join(' '), 'false true false true', 'treeInstancingOff restores instancing after each window');
  assert.equal(hideFadedOutHistory.join(' '), 'false true false true', 'fadedTreesDrawn restores the faded-out tree skip after each window');
  assert.equal(hideFadedOut, true);
  assert.equal(skinnedScissorHistory.join(' '), 'false true false true', 'skinnedScissorOff restores the per-bone held scissor after each window');
  assert.equal(skinnedScissor, true);
  assert.deepEqual(forestRadiusHistory.map(([type, value]) => type + ':' + value).join(' '), 'input:15 input:30 input:15 input:30', 'nearForest halves the radius each round via input events and restores it');
  assert.equal(elements.get('settingCloudForestCullRadius').value, '30');
  assert.equal(corridorUpdates, 4, 'each change forces a corridor pass');
  assert.equal(painterlyHistory.filter(mode => mode === 'off').length, 2, 'painterly is turned off once per round');
  assert.equal(painterlyMode, 'medium', 'and its mode restored');
  assert.equal(report.painterly.mode, 'medium');
  assert.equal(report.painterly.internalSize, '800x450');
  assert.ok(rainSeenDuringRender.includes(false), 'rainOff hides the rain group while drawing');
  assert.equal(rainGroup.visible, true, 'and restores it');
  assert.equal(report.weather.raining, true);
  assert.equal(report.variants.default.frames, 40);
  assert.ok(report.variants.frameScopeOff.renderCpuMs > report.variants.default.renderCpuMs, 'render JS time is measured per variant');
  assert.match(window.RenderABBenchmark.lastText(), /default\s+: [\d.]+ fps/);
  assert.equal(registered.length, 0, 'the per-pass hook is removed');
  const byPass = Object.fromEntries(report.passes.map(p => [p.pass, p]));
  assert.equal(byPass.main.drawsPerFrame, 80, 'first render of a pass is its base draw');
  assert.equal(byPass.main.trianglesPerFrame, 8000, 'triangles per pass come from renderer.info');
  assert.equal(report.variants.default.trianglesPerFrame, (80 + 14 + 4 + 1 + 1 + 1) * 100, 'every variant reports triangles per frame');
  assert.equal(report.variants.painterlyOff.trianglesPerFrame, (80 + 14 + 4 + 1) * 100, 'painterlyOff drops the two filter passes');
  assert.match(window.RenderABBenchmark.lastText(), /main [\d.]+ms\/80d\/8\.0kt/);
  assert.equal(byPass['main (replays/extra)'].drawsPerFrame, 14, 'later renders of the same pass are replays');
  assert.equal(byPass.shell.rendersPerFrame, 1);
  assert.equal(byPass['painterly filter'].rendersPerFrame, 2, 'painterly passes inside the composite are labelled by scene');
  assert.equal(byPass.composite.rendersPerFrame, 1, 'the composite draw itself stays the composite base');
  assert.equal(byPass['composite (replays/extra)'], undefined);
  // Synced window: no timer queries in the fixture, so readPixels brackets each pass.
  const synced = Object.fromEntries(report.syncedPasses.map(p => [p.pass, p]));
  assert.equal(report.syncOverheadMs, 0.5, 'an idle readPixels round trip is measured as overhead');
  assert.ok(Math.abs(synced.main.msPerFrame - 1.8) < 0.01, `main = 1 ms CPU + 0.8 ms queued GPU work (got ${synced.main.msPerFrame})`);
  assert.ok(Math.abs(synced['painterly filter'].msPerFrame - 2.02) < 0.01, 'two painterly renders per frame');
  assert.ok(synced.main.msPerFrame > synced.shell.msPerFrame, 'rows are sorted by cost');
  assert.match(window.RenderABBenchmark.lastText(), /synced CPU\+GPU ms per frame/);
  assert.match(window.RenderABBenchmark.lastText(), /painterly medium @ 800x450/);
  // Draw contributors: one sampled default frame, grouped by named ancestry with digits collapsed.
  const mainRows = Object.fromEntries(report.drawContributors.main);
  assert.equal(mainRows['tree_#<forest_#'], 3, 'three tree draws grouped under one label');
  assert.equal(mainRows.Mesh, 1, 'unnamed objects fall back to their type');
  assert.equal(Object.fromEntries(report.drawContributors['main (replays/extra)'])['tree_#<forest_#'], 3);
  assert.match(window.RenderABBenchmark.lastText(), /top draws in main \(one frame\): tree_#<forest_# x3; Mesh x1/);
  // Held replay counters: deltas over the default windows only.
  assert.equal(report.heldReplays.fullscreenPerFrame, 1, 'one fullscreen replay per default frame');
  assert.equal(report.heldReplays.lastHeldFullscreenReason, 'skinned-mesh');
  assert.match(window.RenderABBenchmark.lastText(), /held\/x-ray replays per frame: scissored 0, fullscreen 1 \(last reasons held=skinned-mesh shell=none\)/);
  assert.ok(report.betweenDrawsMsPerFrame >= 0);
  assert.equal(report.gpuTiming, false, 'no WebGL2 timer in the fixture');
  assert.equal(report.device.drawingBuffer.join('x'), '800x450');
  console.log('render A/B benchmark: alternating windows, timing, restore and Settings row ok');
})().catch(error => { console.error(error); process.exit(1); });
