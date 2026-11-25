'use strict';

// Loads the shipped docs/js/render-layers.js, render-hooks.js and
// world-render-pipeline.js into a VM with a minimal fake THREE and a recording
// renderer, so tests can execute a real world frame and assert on the order of
// passes, scope suspends/restores and hook applications instead of matching
// source text. Every window.* collaborator the pipeline calls is a recording
// stub; pass `overrides` to replace any of them.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

function makeThree() {
  class Color {
    constructor(r = 0, g = 0, b = 0) { this.r = r; this.g = g; this.b = b; }
    set(value) { this.value = value; return this; }
    copy(c) { this.r = c.r; this.g = c.g; this.b = c.b; this.h = c.h; this.s = c.s; this.l = c.l; this.value = c.value; return this; }
    setHSL(h, s, l) { this.h = h; this.s = s; this.l = l; return this; }
  }
  class Vector2 { constructor(x = 0, y = 0) { this.x = x; this.y = y; } set(x, y) { this.x = x; this.y = y; return this; } }
  class ShaderMaterial { constructor(params = {}) { Object.assign(this, params); this.type = 'ShaderMaterial'; this.uniforms = params.uniforms || {}; } }
  class MeshBasicMaterial { constructor(params) { Object.assign(this, params); } }
  class DepthTexture { constructor(w, h) { this.width = w; this.height = h; } }
  class WebGLRenderTarget {
    constructor(w, h, options = {}) { this.width = w; this.height = h; this.stencilBuffer = !!options.stencilBuffer; this.texture = { rt: this }; }
    setSize(w, h) { this.width = w; this.height = h; }
    dispose() { this.disposed = true; }
  }
  class Object3D {
    constructor() { this.children = []; this.parent = null; this.userData = {}; this.layers = new Layers(); this.name = ''; }
    add(child) { this.children.push(child); child.parent = this; return this; }
    traverse(fn) { fn(this); for (const child of this.children) child.traverse(fn); }
  }
  class Layers {
    constructor() { this.mask = 1; }
    set(bit) { this.mask = (1 << bit) >>> 0; }
    enable(bit) { this.mask = (this.mask | (1 << bit)) >>> 0; }
    disable(bit) { this.mask = (this.mask & ~(1 << bit)) >>> 0; }
    enableAll() { this.mask = 0xFFFFFFFF; }
    test(other) { return (this.mask & other.mask) !== 0; }
  }
  class Scene extends Object3D { constructor() { super(); this.isScene = true; this.type = 'Scene'; this.overrideMaterial = null; } }
  class Mesh extends Object3D { constructor(geometry, material) { super(); this.isMesh = true; this.geometry = geometry; this.material = material; } }
  class Group extends Object3D { constructor() { super(); this.isGroup = true; } }
  class OrthographicCamera extends Object3D { constructor() { super(); this.isCamera = true; } }
  class PlaneGeometry {}
  function WebGLRenderer() {}
  return {
    Color, Vector2, ShaderMaterial, MeshBasicMaterial, DepthTexture, WebGLRenderTarget, Object3D, Layers, Scene, Mesh, Group,
    OrthographicCamera, PlaneGeometry, WebGLRenderer,
    FrontSide: 0, BackSide: 1, LessDepth: 2, NearestFilter: 1003, RGBAFormat: 1023, DepthStencilFormat: 1027, UnsignedInt248Type: 1020,
    UniformsLib: { fog: { fogDensity: { value: 0 }, fogNear: { value: 1 }, fogFar: { value: 2 }, fogColor: { value: new Color() } } },
    UniformsUtils: { merge(list) { const out = {}; for (const u of list) for (const k of Object.keys(u)) out[k] = { value: u[k].value }; return out; } },
  };
}

function createWorldRenderPipelineHarness(overrides = {}) {
  const THREE = makeThree();
  const log = [];
  const record = entry => log.push(entry);
  const context = { console, performance: { now: () => 0 }, Promise };
  const window = context;
  window.window = window;
  window.THREE = THREE;
  vm.createContext(context);
  vm.runInContext(read('docs/js/render-layers.js'), context, { filename: 'render-layers.js' });
  vm.runInContext(read('docs/js/render-hooks.js'), context, { filename: 'render-hooks.js' });

  const scopeStub = id => ({ suspendForRender: (...args) => { record({ kind: 'suspend', id, args }); return () => record({ kind: 'restore', id }); } });
  const stubs = {
    FarmTileRenderBatches: scopeStub('farm-tile-batches'),
    ZonePropRenderBatches: scopeStub('zone-prop-batches'),
    NpcViewFrustumCull: scopeStub('npc-view-cull'),
    GrassBillboardRenderChunks: scopeStub('grass-chunks'),
    InstancedMeshViewCull: scopeStub('instanced-view-cull'),
    WildernessDistanceCull: scopeStub('wilderness-distance-cull'),
    ActorRenderOcclusion: {
      beginFrame: args => record({ kind: 'aro', id: 'beginFrame', args }),
      probeAfterBase: () => record({ kind: 'aro', id: 'probeAfterBase' }),
      endFrame: () => record({ kind: 'aro', id: 'endFrame' }),
    },
    PngPlaneOutlineOccluder: {
      renderDepth: scene => { record({ kind: 'call', id: 'pngDepth' }); harness.camera.layers.set(4); harness.renderer.render(scene, harness.camera); harness.camera.layers.enableAll(); },
      prune: () => record({ kind: 'call', id: 'pngPrune' }),
    },
    CloudForestFog: { isActive: () => !!harness.fogActive, renderOutlineMist: () => record({ kind: 'call', id: 'mist' }) },
    PerceptionMode: { renderOverlay: () => record({ kind: 'call', id: 'perception' }) },
    OutlineCompositeMaterial: { create: T => { record({ kind: 'call', id: 'compositeCreate' }); return new T.ShaderMaterial({ uniforms: {
      tColor: { value: null }, tEdgeId: { value: null }, tEdgeIdDepth: { value: null }, tSceneDepth: { value: null }, uTexel: { value: new T.Vector2(1, 1) },
      uCameraNear: { value: 0 }, uCameraFar: { value: 0 }, uSeamOutlinesOn: { value: 0 }, tShellMaskDepth: {value:null}, uDepthOutlinesOn:{value:0}, uOrthographic:{value:0}, uDepthFogMode:{value:0}, uDepthFogColor:{value:new T.Color()}, uDepthFogNear:{value:0}, uDepthFogFar:{value:1}, uDepthFogDensity:{value:0}, uSeamColorDistThresh: { value: 0 }, uSeamOcclusionTolerance: { value: 0 } } }); } },
    MobileRenderBudget: { sample: (now, active) => record({ kind: 'call', id: 'budgetSample', active }) },
  };
  Object.assign(window, stubs, overrides.window || {});

  vm.runInContext(read('docs/js/world-render-pipeline.js'), context, { filename: 'world-render-pipeline.js' });

  // Recording renderer whose prototype render() is the RenderHooks base.
  const renderer = Object.create(THREE.WebGLRenderer.prototype);
  let renderTarget = null;
  Object.assign(renderer, {
    autoClearColor: true, autoClearDepth: true,
    info: { render: { calls: 0, triangles: 0 } },
    setRenderTarget(rt) { renderTarget = rt; },
    getRenderTarget() { return renderTarget; },
    setClearColor() {}, clear() {},
  });
  renderer.__hobunjiR128NativeRender = (scene, camera) => {
    if (harness.throwOn && harness.throwOn(scene, camera)) throw new Error('synthetic native render failure');
    record({
      kind: 'render',
      scene: scene === harness.activeScene ? 'active' : scene === harness.farmScene ? 'farm' : scene.name || 'other',
      layers: camera.layers.mask >>> 0,
      override: scene.overrideMaterial || null,
      target: renderTarget === null ? 'canvas' : renderTarget,
    });
  };
  const camera = new THREE.Object3D();
  camera.isCamera = true; camera.near = 0.1; camera.far = 200;
  camera.layers.enableAll();

  const harness = {
    THREE, window, log, renderer, camera,
    activeScene: new THREE.Scene(),
    farmScene: new THREE.Scene(),
    settings: { outlines: true, seamOutlines: false, cloudForestFog: true },
    area: 'map_western_slope', paused: false, fogActive: false, throwOn: null,
    npcWalkers: [], hostileObjects: new Set(),
    pipeline: window.WorldRenderPipeline,
    hooks: window.RenderHooks,
    init() {
      harness.pipeline.init({
        THREE, renderer, camera,
        farmScene: harness.farmScene,
        getActiveScene: () => harness.activeScene,
        getCurrentArea: () => harness.area,
        isZoneArea: area => /^map_/.test(String(area)),
        getPlayerTile: out => { out.x = 12.5; out.z = 7.5; return out; },
        npcWalkers: harness.npcWalkers,
        hostileObjects: harness.hostileObjects,
        isPaused: () => harness.paused,
        settings: {
          outlines: () => harness.settings.outlines,
          seamOutlines: () => harness.settings.seamOutlines,
          cloudForestFog: () => harness.settings.cloudForestFog,
        },
      });
      // Existing pass-order fixtures explicitly exercise the legacy shell path.
      if (overrides.outlineMode !== 'default') harness.pipeline.setGeneratedOutlineMode('shell');
      return harness;
    },
    frame(now = 1000) { log.length = 0; harness.pipeline.renderFrame(now); return log.slice(); },
    renders: entries => (entries || log).filter(entry => entry.kind === 'render'),
    indexOf: (entries, predicate) => entries.findIndex(predicate),
  };
  return harness;
}

module.exports = { createWorldRenderPipelineHarness, makeThree };
