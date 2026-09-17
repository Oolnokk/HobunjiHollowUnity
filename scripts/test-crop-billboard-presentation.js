#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

const presentation = source('docs/js/crop-billboard-presentation.js'); // Exercises the real dependency bridge and draw-time crop grounding.
const loader = source('docs/js/combat/combat-config-loader.js'); // Guards crop presentation load order.

assert.match(presentation, /patchCropRendering\(window\.VegetationCropRendering\)/,
  'crop presentation captures the renderer-owned farm dependencies directly');
assert.match(presentation, /get\(\) \{ return cropRenderDeps\?\.scene \|\| null; \}/,
  'FarmPanel receives a live scene getter instead of being assumed to own render state');
assert.match(presentation, /root\.position\.y -= waterLift \+ centerLift/,
  'converted billboard roots remove both water and former cube-center lift');
assert.doesNotMatch(presentation, /root\.scale\.set|mesh\.scale\.set/,
  'soil anchoring never changes crop growth scale');

const artIndex = loader.indexOf('crop-sprite-art.js?v=20260915cropscan1');
const heftrootIndex = loader.indexOf('heftroot-billboard-bridge.js');
const presentationIndex = loader.indexOf('crop-billboard-presentation.js?v=20260814a');
const readyIndex = loader.indexOf('crop-ready-presentation.js?v=20260818a');
assert.ok(artIndex >= 0 && heftrootIndex > artIndex && presentationIndex > heftrootIndex && readyIndex > presentationIndex,
  'crop sprite conversion, soil anchoring, then ripe sparkle presentation keep their required order');

function makeNode(props = {}) {
  const node = {
    position: { x: 0, y: 0, z: 0, ...(props.position || {}) },
    scale: { x: 1, y: 1, z: 1, ...(props.scale || {}) },
    userData: props.userData || {},
    children: [],
    parent: null,
    traverse(callback) {
      callback(this);
      for (const child of this.children) child.traverse(callback);
    },
  };
  node.add = child => {
    child.parent = node;
    node.children.push(child);
  };
  return node;
}

const scene = makeNode();
const cropRoot = makeNode({
  position: { x: 0.5, y: 0.62, z: 0.5 },
  scale: { x: 1, y: 1, z: 1 },
  userData: {
    hobunjiCropRootKey: 'ongyums',
    hobunjiCropSpriteKey: 'ongyums',
    hobunjiCropClusterCount: 3,
  },
}); // Mirrors a converted full-grown generic crop: soil 0 + water 0.10 + cube center 0.52.
scene.add(cropRoot);

let observedY = null;
function FakeWebGLRenderer() {}
FakeWebGLRenderer.prototype.render = function render() {
  observedY = cropRoot.position.y;
  return 'rendered';
};

let vegetationInitDeps = null;
let panelInitDeps = null;
const window = {
  THREE: { WebGLRenderer: FakeWebGLRenderer },
  VegetationCropRendering: {
    init(injectedDeps) { vegetationInitDeps = injectedDeps; return injectedDeps; },
  },
  FarmPanel: {
    init(injectedDeps) { panelInitDeps = injectedDeps; return injectedDeps; },
  },
};
vm.runInNewContext(presentation, { window, Object, Number, Math, Map });

const grid = [[{ crop: 'ongyums', water: 0.6 }]];
const panelDeps = { getGrid: () => grid }; // Intentionally has NO scene: this reproduces the real FarmPanel contract that exposed the bug.
window.FarmPanel.init(panelDeps);
assert.strictEqual(panelInitDeps, panelDeps, 'FarmPanel still receives its original dependency object');
assert.equal(panelDeps.scene, null, 'linked scene is safely null before the crop renderer initializes');

const renderDeps = { getGrid: () => grid, scene };
window.VegetationCropRendering.init(renderDeps);
assert.strictEqual(vegetationInitDeps, renderDeps, 'VegetationCropRendering still receives its original dependencies');
assert.strictEqual(panelDeps.scene, scene, 'FarmPanel-linked crop presentation sees the live renderer-owned farm scene after renderer init');

const renderer = new window.THREE.WebGLRenderer();
assert.equal(renderer.render(scene, {}), 'rendered', 'crop grounding preserves the renderer return value');
assert.ok(Math.abs(observedY) < 1e-12,
  'Ongyums draw at the soil surface after removing 0.10 water lift and 0.52 legacy cube-center lift');
assert.equal(cropRoot.position.y, 0.62,
  'draw-time grounding restores the crop renderer-owned position immediately afterward');

const debug = window.HobunjiCropBillboardPresentation.getDebug();
assert.equal(debug.dependencySource, 'vegetation-crop-rendering', 'diagnostics identify the authoritative dependency source');
assert.equal(debug.cropRendererReady, true, 'diagnostics confirm the farm renderer scene/grid are available');
assert.equal(debug.farmReady, true, 'crop presentation reports ready with FarmPanel itself owning no scene');
assert.equal(debug.lastAnchoredRoots, 1, 'diagnostics report the converted crop root corrected on the draw');

console.log('crop soil-anchor render-dependency tests passed');
