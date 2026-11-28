#!/usr/bin/env node
'use strict';

// Executes the shipped world render pipeline (docs/js/world-render-pipeline.js)
// with a recording renderer: pass order with and without outlines, render
// scopes suspended before the first pass and restored (in reverse) even when a
// pass throws, 'frame' presentation hooks applied once per world frame, the
// reticle target pass, render targets, tagging helpers and frame capture.

const assert = require('node:assert/strict');
const { createWorldRenderPipelineHarness } = require('./lib/world-render-pipeline-harness.js');

const plain = value => JSON.parse(JSON.stringify(value)); // VM objects have another realm's prototypes.

const SCOPE_ORDER = ['farm-tile-batches', 'zone-prop-batches', 'npc-view-cull', 'grass-chunks', 'instanced-view-cull', 'wilderness-distance-cull'];

// ── Outlined frame (default) ───────────────────────────────────────────────
{
  const h = createWorldRenderPipelineHarness().init();
  const { pipeline, log } = h;
  const mats = pipeline.materials;
  const targets = pipeline.targets;
  assert.ok(mats.shell && mats.targetAllowed && mats.targetBlocked && mats.seamId && mats.composite, 'init builds every outline material');
  assert.equal(targets.main.stencilBuffer, true, 'the main target carries stencil for held-vs-foot water compositing');
  assert.equal(targets.main.depthTexture.format, h.THREE.DepthStencilFormat, 'main target depth is packed depth-stencil');
  assert.equal(targets.main.depthTexture.type, h.THREE.UnsignedInt248Type);
  assert.equal(targets.seamId.stencilBuffer, false, 'the seam-ID target has no stencil');
  assert.ok(log.some(e => e.id === 'compositeCreate'), 'the composite material comes from OutlineCompositeMaterial');

  pipeline.resize(640, 360);
  assert.deepEqual([targets.main.width, targets.main.height], [640, 360]);
  assert.deepEqual([targets.seamId.width, targets.seamId.height], [1, 1], 'seam-ID target stays 1x1 while seam outlines are off');
  assert.equal(mats.composite.uniforms.uTexel.value.x, 1 / 640);

  const events = h.frame();
  const suspends = events.filter(e => e.kind === 'suspend').map(e => e.id);
  assert.deepEqual(suspends, SCOPE_ORDER, 'render scopes suspend in their documented order');
  const restores = events.filter(e => e.kind === 'restore').map(e => e.id);
  assert.deepEqual(restores, SCOPE_ORDER.slice().reverse(), 'render scopes restore in exact reverse order');
  const npcSuspend = events.find(e => e.id === 'npc-view-cull');
  assert.equal(npcSuspend.args[0], h.npcWalkers, 'NPC cull receives the live walker list');
  assert.equal(npcSuspend.args[1], h.activeScene);
  assert.equal(npcSuspend.args[2], h.camera);
  const distance = events.find(e => e.kind === 'suspend' && e.id === 'wilderness-distance-cull');
  assert.deepEqual({ x: distance.args[2].x, z: distance.args[2].z }, { x: 12.5, z: 7.5 }, 'distance cull gets the player tile');
  assert.deepEqual(plain(distance.args[3]), { isZone: true });

  const at = predicate => events.findIndex(predicate);
  const lastSuspend = at(e => e.kind === 'suspend' && e.id === 'wilderness-distance-cull');
  const begin = at(e => e.id === 'beginFrame');
  const firstRender = at(e => e.kind === 'render');
  const pngDepth = at(e => e.id === 'pngDepth');
  const probe = at(e => e.id === 'probeAfterBase');
  const shell = at(e => e.kind === 'render' && e.override === mats.shell);
  const composite = at(e => e.kind === 'render' && e.scene === 'world_render_composite');
  const perception = at(e => e.id === 'perception');
  const end = at(e => e.id === 'endFrame');
  const firstRestore = at(e => e.kind === 'restore');
  assert.ok(lastSuspend < begin && begin < firstRender, 'every scope and actor occlusion are active before the first pass');
  assert.ok(firstRender < pngDepth && pngDepth < probe && probe < shell, 'avatar occlusion depth and actor probes precede the shell outlines');
  assert.ok(shell < composite && composite < perception && perception < end && end < firstRestore, 'composite, Perception Mode, then cleanup');

  const renders = h.renders(events);
  assert.equal(renders[0].scene, 'active');
  assert.equal(renders[0].layers, 0xFFFFFFFF);
  assert.equal(renders[0].target, targets.main, 'main pass draws into the offscreen main target');
  assert.equal(renders.find(r => r.override === mats.shell).layers, 1 << 1, 'shell pass draws only SHELL_OUTLINE');
  assert.equal(renders.at(-1).target, 'canvas', 'composite presents to the canvas');
  assert.ok(!renders.some(r => r.scene === 'farm'), 'no target pass without a reticle target');
  assert.ok(!events.some(e => e.id === 'mist'), 'no mist redraw while Cloud Forest fog is inactive');
  assert.equal(h.renderer.autoClearColor, true, 'auto-clear restored after the outline passes');
  assert.equal(h.camera.layers.mask >>> 0, 0xFFFFFFFF, 'camera sees every layer again');
  assert.equal(h.activeScene.overrideMaterial, null);
  assert.equal(events.at(-1).id, 'budgetSample');
  assert.equal(pipeline.snapshot().lastFrame.nativeRenders, renders.length, 'snapshot counts every native render of the frame');

  // Target highlight + mist + seam outlines.
  const target = new h.THREE.Mesh();
  pipeline.setTargetHighlights([target], false);
  assert.ok(target.layers.mask & (1 << 2), 'target mesh joins TARGET_HIGHLIGHT');
  h.fogActive = true;
  h.settings.seamOutlines = true;
  pipeline.resize(640, 360);
  assert.deepEqual([targets.seamId.width, targets.seamId.height], [640, 360], 'seam-ID target is full size with seams on');
  const withExtras = h.frame();
  const extraRenders = h.renders(withExtras);
  const targetPass = extraRenders.find(r => r.scene === 'farm');
  assert.ok(targetPass, 'target pass draws the farm scene');
  assert.equal(targetPass.layers, 1 << 2);
  assert.equal(targetPass.override, mats.targetBlocked, 'blocked actions use the red highlight');
  assert.ok(withExtras.some(e => e.id === 'mist'), 'mist redraw runs when fog is active');
  const seamPass = extraRenders.find(r => r.override === mats.seamId);
  assert.ok(seamPass && seamPass.layers === 1 << 3 && seamPass.target === targets.seamId, 'seam pass draws MATERIAL_SEAM_ID into the seam target');
  assert.equal(mats.composite.uniforms.uSeamOutlinesOn.value, 1);
  pipeline.clearTargetHighlights();
  assert.equal(target.layers.mask & (1 << 2), 0, 'clearing removes the target layer');
  assert.equal(pipeline.hasTargetHighlights(), false);
}

// The production outline wrapper already blocks the retired material-ID source.
// The pipeline should not allocate or clear its target just to submit a no-op.
{
  const h = createWorldRenderPipelineHarness({window:{OutlineRenderPerformance:{nonShellOutlinesSuppressed:true}}}).init();
  h.settings.seamOutlines=true;
  h.pipeline.resize(640,360);
  assert.deepEqual([h.pipeline.targets.seamId.width,h.pipeline.targets.seamId.height],[1,1]);
  const draws=h.renders(h.frame());
  assert.equal(draws.length,4,'retired seam pass adds no native render');
  assert.ok(!draws.some(draw=>draw.override===h.pipeline.materials.seamId));
  assert.equal(h.pipeline.materials.composite.uniforms.uSeamOutlinesOn.value,0);
  assert.equal(h.pipeline.snapshot().lastFrame.seamOutlines,false);
  h.window.OutlineRenderPerformance.nonShellOutlinesSuppressed=false;
  h.pipeline.resize(640,360);
  assert.equal(h.renders(h.frame()).length,5,'a runtime that supports seams keeps its pass');
}

// ── Outlines off ───────────────────────────────────────────────────────────
{
  const h = createWorldRenderPipelineHarness().init();
  h.settings.outlines = false;
  const events = h.frame();
  const renders = h.renders(events);
  assert.equal(renders.length, 1, 'outlines off draws the world once');
  assert.equal(renders[0].target, 'canvas');
  assert.ok(events.some(e => e.id === 'pngPrune'), 'the occluder registry is still compacted');
  assert.equal(events.filter(e => e.id === 'probeAfterBase').length, 1, 'actor probes run with outlines off too');
  assert.ok(events.some(e => e.id === 'endFrame') && events.some(e => e.kind === 'restore'), 'cleanup runs');
}

// ── 'frame' presentation hooks: once per world frame, undone before scopes restore ──
{
  const h = createWorldRenderPipelineHarness().init();
  let applied = 0, undone = 0, perCall = 0, liveDuringRenders = [];
  let offset = 0;
  h.hooks.register({
    id: 'test-frame-hook', scope: 'frame', order: 10,
    before: () => { applied++; offset = 1; return 'token'; },
    after: (_ctx, token) => { assert.equal(token, 'token'); undone++; offset = 0; h.log.push({ kind: 'hook-undo' }); },
  });
  h.hooks.register({ id: 'test-render-hook', order: 20, before: ctx => { perCall++; liveDuringRenders.push(ctx.scene === h.activeScene ? offset : 'other'); } });
  const events = h.frame();
  const renders = h.renders(events);
  assert.equal(applied, 1, 'a frame hook applies once for all passes');
  assert.equal(undone, 1, 'and is undone once');
  assert.equal(perCall, renders.length, "a 'render' hook still runs for every pass");
  assert.ok(liveDuringRenders.filter(v => v !== 'other').every(v => v === 1), 'every world-scene pass sees the applied presentation');
  const undoAt = events.findIndex(e => e.kind === 'hook-undo');
  assert.ok(undoAt > events.findIndex(e => e.id === 'endFrame') && undoAt < events.findIndex(e => e.kind === 'restore'),
    'frame hooks are undone after actor occlusion ends and before render scopes restore');
  assert.equal(offset, 0, 'nothing render-only survives the frame');
  // Outside a world frame the same hook falls back to per-render semantics.
  h.renderer.render(h.activeScene, h.camera);
  h.renderer.render(h.activeScene, h.camera);
  assert.equal(applied, 3, 'outside a world frame a frame hook runs per render');
  assert.equal(undone, 3);
  const debug = h.hooks.getDebug();
  assert.deepEqual(plain(debug.hooks.map(entry => entry.id).slice(0, 2)), ['test-frame-hook', 'test-render-hook'], 'hooks listed in order');
  assert.equal(debug.worldFrameOpen, false);
}

// ── A failing pass still restores everything ───────────────────────────────
{
  const h = createWorldRenderPipelineHarness().init();
  let undone = 0;
  h.hooks.register({ id: 'test-frame-hook', scope: 'frame', before: () => 1, after: () => { undone++; } });
  h.throwOn = (scene, camera) => scene.overrideMaterial === h.pipeline.materials.shell;
  assert.throws(() => h.frame(), /synthetic native render failure/);
  const restores = h.log.filter(e => e.kind === 'restore').map(e => e.id);
  assert.deepEqual(restores, SCOPE_ORDER.slice().reverse(), 'every scope is restored after a renderer failure');
  assert.ok(h.log.some(e => e.id === 'endFrame'), 'actor occlusion is released');
  assert.equal(undone, 1, 'frame hooks are undone');
  assert.equal(h.hooks.isWorldFrameOpen(), false, 'no world frame left open');
  assert.equal(h.activeScene.overrideMaterial, null, 'shell override is restored even when the draw throws');
  h.throwOn = null;
  h.frame();
  assert.equal(h.activeScene.overrideMaterial, null, 'a normal frame recovers');
}

// ── A failing scope does not stop the others ───────────────────────────────
{
  const h = createWorldRenderPipelineHarness({ window: { GrassBillboardRenderChunks: { suspendForRender: () => { throw new Error('grass broke'); } } } }).init();
  const originalWarn = console.warn;
  console.warn = () => {};
  try { h.frame(); } finally { console.warn = originalWarn; }
  const suspends = h.log.filter(e => e.kind === 'suspend').map(e => e.id);
  assert.deepEqual(suspends, SCOPE_ORDER.filter(id => id !== 'grass-chunks'), 'other scopes still suspend');
  const grass = h.pipeline.snapshot().scopes.find(scope => scope.id === 'grass-chunks');
  assert.equal(grass.errors, 1);
  assert.match(grass.lastError, /grass broke/);
  assert.ok(h.pipeline.setScopeEnabled('grass-chunks', false));
  h.frame();
  assert.equal(h.pipeline.snapshot().scopes.find(scope => scope.id === 'grass-chunks').errors, 1, 'a disabled scope is skipped');
}

// ── Frame capture ──────────────────────────────────────────────────────────
{
  const h = createWorldRenderPipelineHarness().init();
  const root = new h.THREE.Group();
  root.name = 'Tree_12_34';
  root.add(new h.THREE.Mesh());
  h.activeScene.add(root);
  h.activeScene.autoUpdate = true;
  let audits=0;
  h.window.DenseForestWallBatches = {
    auditStaticMatrixBranches(scene) {
      audits++;
      assert.equal(scene,h.activeScene);
      assert.equal(root.visible,false,'audit occurs inside main draw scopes');
      assert.equal(h.log.at(-1).kind,'render','audit occurs after native submission');
      assert.equal(h.log.at(-1).scene,'active');
      assert.equal(h.log.at(-1).layers,0xFFFFFFFF);
      return {ready:63,violations:0};
    },
    staticMatrixSnapshot:()=>({enabled:true}),
  };
  h.pipeline.registerRenderScope({id:'test-capture-hidden-root', order:10000, suspend:() => {
    root.visible = false;
    return () => {root.visible = true;};
  }});
  h.pipeline.registerRenderScope({id:'test-disabled-capture-scope', order:10001, suspend:() => {throw Error('disabled scope called');}});
  h.pipeline.setScopeEnabled('test-disabled-capture-scope',false);
  h.hooks.register({id:'test-capture-matrix-reuse',order:8000,
    appliesTo:ctx=>ctx.scene===h.activeScene && ctx.camera.layers.mask===1<<4,
    before:()=>{h.activeScene.autoUpdate=false;},
    after:()=>{h.activeScene.autoUpdate=true;}});
  h.pipeline.captureFrame();
  h.frame();
  const capture = h.pipeline.lastCapture();
  assert.ok(capture && capture.outlines === true);
  assert.equal(capture.completed,true);
  assert.equal(audits,1);
  assert.deepEqual(plain(capture.mainStaticWallAudit),{enabled:true,audit:{ready:63,violations:0}});
  assert.equal(capture.mainMatrixCensus.nodes,2);
  assert.equal(capture.mainMatrixCensus.hiddenNodes,2,'census sees temporary hidden root and child');
  assert.equal(capture.mainMatrixCensus.largestBranches[0].category,'Tree','numbered names aggregate');
  assert.equal(h.pipeline.sceneMatrixCensus(h.activeScene).hiddenNodes,0,'logical visibility restored');
  assert.equal(root.visible,true);
  assert.ok(capture.scopeTimings.some(s=>s.id==='test-capture-hidden-root' && s.failed===false && Number.isFinite(s.ms)));
  assert.ok(!capture.scopeTimings.some(s=>s.id==='test-disabled-capture-scope'));
  assert.equal(capture.passes.find(p=>p.pass==='main').worldScene,true);
  assert.equal(capture.passes.find(p=>p.pass==='main').sceneAutoUpdate,true);
  assert.equal(capture.passes.find(p=>p.pass==='pngDepth').sceneAutoUpdate,false,'actual pre-native flag');
  assert.equal(capture.passes.find(p=>p.pass==='composite').worldScene,false);
  const passes = plain(capture.passes.map(p => p.pass));
  assert.deepEqual(passes, ['main', 'pngDepth', 'shell', 'composite'], 'capture labels each native render with its pass');
  assert.deepEqual(plain(capture.passes.find(p => p.pass === 'shell').layers), ['SHELL_OUTLINE']);
  assert.deepEqual(plain(capture.passes.find(p => p.pass === 'pngDepth').layers), ['PNG_OCCLUDER']);
  assert.equal(capture.passes.find(p => p.pass === 'composite').target, 'canvas');
  assert.ok(!h.hooks.list().includes('world-render-pipeline-capture'), 'the capture hook removes itself');
  h.frame();
  assert.equal(h.pipeline.lastCapture(), capture, 'capture is one-shot');
  h.throwOn = (scene,camera)=>scene===h.activeScene && camera.layers.mask===1<<4;
  h.pipeline.captureFrame();
  assert.throws(()=>h.frame(),/synthetic native render failure/);
  assert.equal(h.pipeline.lastCapture().completed,false);
  assert.equal(h.activeScene.autoUpdate,true);
  assert.equal(root.visible,true);
  assert.ok(!h.hooks.list().includes('world-render-pipeline-capture'),'failed capture removes its hook');
}

// ── Tagging helpers ────────────────────────────────────────────────────────
{
  const h = createWorldRenderPipelineHarness();
  const { THREE, pipeline } = h;
  const group = new THREE.Group();
  const solid = new THREE.Mesh();
  const leaf = new THREE.Mesh(); leaf.userData.noOutline = true;
  const png = new THREE.Mesh(); png.userData.isPngPlane = true;
  group.add(solid); group.add(leaf); group.add(png);
  pipeline.markShellOutline(group); // Works before init().
  assert.ok(solid.layers.mask & 2, 'solid meshes get the shell layer');
  assert.equal(leaf.layers.mask & 2, 0, 'noOutline leaf cards are skipped');
  assert.equal(png.layers.mask & 2, 0, 'PNG planes are skipped (their art carries ink)');
  const pngGroup = new THREE.Group(); pngGroup.userData.isPngPlane = true; const inner = new THREE.Mesh(); pngGroup.add(inner);
  pipeline.markShellOutline(pngGroup);
  assert.equal(inner.layers.mask & 2, 0, 'a PNG-plane group is never enrolled');
  h.init();
  const a = new THREE.Mesh(), b = new THREE.Mesh();
  const pair = new THREE.Group(); pair.add(a); pair.add(b);
  pipeline.markMaterialSeamId(pair);
  assert.ok(a.layers.mask & 8 && b.layers.mask & 8, 'seam parts join MATERIAL_SEAM_ID');
  const seamMat = pipeline.materials.seamId;
  a.onBeforeRender(null, null, null, null, seamMat);
  const colorA = { ...seamMat.uniforms.uIdColor.value };
  b.onBeforeRender(null, null, null, null, seamMat);
  assert.notDeepEqual(seamMat.uniforms.uIdColor.value.h, colorA.h, 'each part gets its own ID colour');
  assert.equal(seamMat.uniformsNeedUpdate, true, 'the shared uniform is re-uploaded per draw');
  seamMat.uniformsNeedUpdate = false;
  a.onBeforeRender(null, null, null, null, {});
  assert.equal(seamMat.uniformsNeedUpdate, false, 'ordinary passes do not touch the seam uniform');
  assert.equal(h.window.HobunjiOutlines.markShellOutline, pipeline.markShellOutline, 'legacy HobunjiOutlines global still points here');
}

// ── Layer registry ─────────────────────────────────────────────────────────
{
  const h = createWorldRenderPipelineHarness();
  const layers = h.window.HobunjiRenderLayers;
  assert.equal(layers.SHELL_OUTLINE, 1);
  assert.equal(layers.PNG_OCCLUDER, 4);
  assert.equal(layers.HELD_OVERLAY, 29);
  assert.deepEqual(plain(layers.describe(1 << 28)), ['GROUND_REPLAY']);
  assert.deepEqual(plain(layers.describe(0xFFFFFFFF)), ['ALL']);
  assert.deepEqual(plain(layers.describe((1 << 24) | (1 << 9))), ['UNREGISTERED_9', 'FRONT_PORTRAIT_MASK|SCORE_ACTOR_DEPTH'], 'bits listed low to high, shared bits joined');
  const bits = new Map();
  for (const [name, entry] of Object.entries(layers.LAYERS)) {
    assert.ok(entry.owner && entry.purpose, `${name} documents its owner and purpose`);
    assert.ok(Number.isInteger(entry.bit) && entry.bit >= 0 && entry.bit < 32, `${name} is a valid bit`);
    if (!bits.has(entry.bit)) bits.set(entry.bit, []);
    bits.get(entry.bit).push({ name, transient: !!entry.transient });
  }
  for (const [bit, users] of bits) {
    if (users.length > 1) {
      assert.ok(users.filter(user => !user.transient).length <= 1,
        `bit ${bit} is shared (${users.map(u => u.name).join(', ')}): at most one permanent user`);
    }
  }
}

console.log('PASS world render pipeline: pass order, scopes, frame hooks, failure restore, capture, tagging, layers');


// Compare all three generated outline modes without changing the master composite.
{
  const h = createWorldRenderPipelineHarness().init();
  const p = h.pipeline, u = p.materials.composite.uniforms;
  p.resize(640,360);
  assert.equal(p.getGeneratedOutlineMode(),'shell');
  assert.equal(p.setGeneratedOutlineMode('invalid'),'shell');
  p.setGeneratedOutlineMode('screen');
  const screen = h.renders(h.frame());
  const mask = screen.find(r => r.layers === 1 << 1);
  assert.ok(mask && mask.override !== p.materials.shell);
  assert.equal(mask.override.side,h.THREE.FrontSide);
  assert.notEqual(mask.target,p.targets.main);
  assert.deepEqual([mask.target.width,mask.target.height],[640,360]);
  assert.equal(u.tShellMaskDepth.value,mask.target.depthTexture);
  assert.equal(u.uDepthOutlinesOn.value,1);
  assert.equal(screen.at(-1).target,'canvas');
  assert.equal(h.activeScene.overrideMaterial,null);
  assert.equal(h.camera.layers.mask >>> 0,0xffffffff);
  p.resize(320,180);
  assert.deepEqual([mask.target.width,mask.target.height],[320,180]);
  h.throwOn = (scene,camera) => scene === h.activeScene && camera.layers.mask === 1 << 1;
  assert.throws(()=>h.frame(),/synthetic native render failure/);
  assert.equal(h.renderer.getRenderTarget(),p.targets.main);
  assert.equal(h.activeScene.overrideMaterial,null);
  assert.equal(h.camera.layers.mask >>> 0,0xffffffff);
  h.throwOn=null;
  p.setGeneratedOutlineMode('none');
  assert.equal(mask.target.disposed,true);
  const none=h.renders(h.frame());
  assert.equal(none.length,screen.length-1);
  assert.equal(u.uDepthOutlinesOn.value,0);
  assert.equal(none.at(-1).target,'canvas');
  p.setGeneratedOutlineMode('shell');
  assert.ok(h.renders(h.frame()).some(r=>r.override===p.materials.shell));
}

{
  const h = createWorldRenderPipelineHarness({outlineMode:'default'}).init();
  assert.equal(h.pipeline.defaultGeneratedOutlineMode,'screen');
  assert.equal(h.pipeline.getGeneratedOutlineMode(),'screen');
  assert.equal(h.pipeline.setGeneratedOutlineMode('invalid'),'screen');
  assert.ok(!h.renders(h.frame()).some(r=>r.override===h.pipeline.materials.shell));
}


// Screen ink must receive the same atmosphere as authored PNG ink.
{
  const h = createWorldRenderPipelineHarness({outlineMode:'default'}).init();
  const p = h.pipeline, u = p.materials.composite.uniforms;
  p.resize(640,360);
  let kanthic = true, paintFirst = false;
  h.window.PainterlyPostprocess = {getOutlineFirst:()=>!paintFirst};
  h.window.CloudForestFog.hasKanthicLightingPass = ()=>kanthic;
  h.window.CloudForestFog.renderKanthicGlyphFrame = ()=>h.log.push({id:'kanthicDraw',target:h.renderer.getRenderTarget()});
  u.uHobunjiPaintMode = {value:2}; // Shader already patched on a prior frame.
  h.settings.cloudForestFog=false;
  const seen = [];
  const native = h.renderer.__hobunjiR128NativeRender;
  h.renderer.__hobunjiR128NativeRender = function(scene,camera) {
    if (scene.name === 'world_screen_ink_pre_atmosphere') {
      assert.equal(u.uHobunjiPaintMode.value,0);
      assert.equal(u.uSeamOutlinesOn.value,0);
      assert.equal(u.uDepthOutlinesOn.value,1);
      assert.equal(u.tColor.value,p.targets.main.texture);
      assert.equal(u.tSceneDepth.value,p.targets.main.depthTexture);
      assert.notEqual(h.renderer.getRenderTarget(),p.targets.main);
      assert.equal(h.renderer.autoClear,false);
      seen.push(h.renderer.getRenderTarget());
    }
    if (scene.name === 'world_screen_ink_copy') {
      assert.equal(h.renderer.getRenderTarget(),p.targets.main);
      assert.equal(scene.children[0].material.uniforms.tSource.value,seen.at(-1).texture);
      assert.equal(scene.children[0].material.depthWrite,false);
      assert.equal(scene.children[0].material.depthTest,false);
      assert.equal(h.renderer.autoClearDepth,false);
      assert.equal(h.renderer.autoClearStencil,false);
    }
    if (scene.name === 'world_render_composite') {
      assert.equal(u.uHobunjiPaintMode.value,2);
      const early = !paintFirst && (kanthic || (h.settings.cloudForestFog && h.fogActive));
      assert.equal(u.uDepthOutlinesOn.value,p.getGeneratedOutlineMode()==='screen'&&!early?1:0);
    }
    return native.call(this,scene,camera);
  };
  const events=h.frame();
  const at=id=>events.findIndex(e=>e.scene===id||e.id===id);
  assert(at('world_screen_ink_pre_atmosphere')>0);
  assert(at('world_screen_ink_pre_atmosphere')<at('world_screen_ink_copy'));
  assert(at('world_screen_ink_copy')<at('kanthicDraw'));
  assert(at('kanthicDraw')<at('world_render_composite'));
  assert.equal(events.find(e=>e.id==='kanthicDraw').target,p.targets.main);
  assert.equal(p.snapshot().lastFrame.screenInkBeforeAtmosphere,true);
  const scratch=seen[0];
  h.frame(); assert.equal(seen.at(-1),scratch,'scratch reused across frames');
  p.resize(320,180);h.frame();assert.deepEqual([scratch.width,scratch.height],[320,180]);
  kanthic=false;h.settings.cloudForestFog=true;h.fogActive=true;
  const mist=h.frame();assert(mist.findIndex(e=>e.scene==='world_screen_ink_copy')<mist.findIndex(e=>e.id==='mist'));
  paintFirst=true;assert(!h.frame().some(e=>e.scene==='world_screen_ink_copy'),'paint-first A/B override');
  paintFirst=false;h.fogActive=false;
  assert(!h.frame().some(e=>e.scene==='world_screen_ink_copy'),'clear area has no extra fullscreen draws');
  kanthic=true;
  h.throwOn=scene=>scene.name==='world_screen_ink_copy';
  assert.throws(()=>h.frame(),/synthetic native render failure/);
  assert.equal(h.renderer.getRenderTarget(),p.targets.main);
  assert.equal(u.uHobunjiPaintMode.value,2);
  h.throwOn=null;h.frame();
  p.setGeneratedOutlineMode('shell');
  assert.equal(scratch.disposed,true);
  assert(!h.frame().some(e=>e.scene==='world_screen_ink_copy'),'shell ink already in world color');
  p.setGeneratedOutlineMode('none');
  assert(!h.frame().some(e=>e.scene==='world_screen_ink_copy'));
  h.settings.outlines=false;
  assert(!h.frame().some(e=>e.scene==='world_screen_ink_copy'));
}

// The census includes hidden descendants, not just nodes the color pass draws.
// It is strictly diagnostic and never changes transforms or visibility.
{
  const h=createWorldRenderPipelineHarness().init(), p=h.pipeline;
  const scene={isScene:true,visible:true,children:[
    {name:'WildernessChunk_0_2',visible:false,children:[
      {isMesh:true,visible:true,matrixAutoUpdate:true,children:[]},
      {isMesh:true,visible:true,matrixAutoUpdate:false,children:[]}
    ]},
    {userData:{hobunjiZonePropBatchHolder:true},visible:false,matrixAutoUpdate:false,children:[
      {isMesh:true,visible:true,matrixAutoUpdate:false,children:[]}
    ]},
    {isMesh:true,name:'actor',visible:true,children:[]}
  ]};
  const census=p.sceneMatrixCensus(scene);
  assert.equal(census.nodes,6);
  assert.equal(census.meshes,4);
  assert.equal(census.hiddenNodes,5);
  assert.equal(census.hiddenMeshes,3);
  assert.equal(census.autoLocalMatrices,3);
  assert.equal(census.hiddenAutoLocalMatrices,2);
  assert.equal(census.renderProxyNodes,2);
  assert.equal(census.largestBranches[0].category,'wilderness chunk');
  assert.equal(scene.children[0].children[0].visible,true);
  assert.equal(p.sceneMatrixCensus({}),null);
}

// The gameplay pipeline, not the inner composite wrapper, owns the final text
// draw after perception. Both render modes release reservations on failure.
for (const outlines of [true,false]) {
  const stages=[],scoreMeshes=[{}];
  const h=createWorldRenderPipelineHarness({window:{PuzzleCaveEntrances:{activeScoreMeshes:()=>scoreMeshes},OutlineRenderPerformance:{
    prepareWorldTextOverlay(renderer,scene,camera,scores) {
      assert.equal(scores,scoreMeshes,'authoritative active score iterator reaches both render paths');
      stages.push('reserve');
      let finished=false;
      return present=>{
        if(finished)return false;
        finished=true; stages.push(present?'present':'abort');
        if(present) assert.equal(h.pipeline.currentPass(),'worldText');
        return present;
      };
    }
  },PerceptionMode:{renderOverlay(){stages.push('perception');}}}}).init();
  h.settings.outlines=outlines;
  h.frame();
  assert.deepEqual(stages,['reserve','perception','present']);
  stages.length=0;
  h.throwOn=()=>true;
  assert.throws(()=>h.frame(),/synthetic native render failure/);
  assert.deepEqual(stages,['reserve','abort']);
}
