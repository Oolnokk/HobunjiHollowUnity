#!/usr/bin/env node
'use strict';

// The full-screen outline composite material lives in its own module and is
// built by game.js through window.OutlineCompositeMaterial.create(THREE).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = rel => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
class Vector2 { constructor(x = 0, y = 0) { this.x = x; this.y = y; } set(x, y) { this.x = x; this.y = y; return this; } }
class ShaderMaterial { constructor(def) { Object.assign(this, def); } }
const window = {};
vm.runInContext(read('docs/js/outline-composite-material.js'), vm.createContext({ window }), { filename: 'outline-composite-material.js' });

const THREE = { Vector2, ShaderMaterial, Color: class Color {} };
const a = window.OutlineCompositeMaterial.create(THREE);
const b = window.OutlineCompositeMaterial.create(THREE);
assert.ok(a instanceof ShaderMaterial && a !== b, 'create() builds a fresh material each call');
assert.notEqual(a.uniforms.uTexel.value, b.uniforms.uTexel.value, 'uniform vectors are not shared between materials');
for (const name of ['tColor', 'tEdgeId', 'tEdgeIdDepth', 'tSceneDepth', 'uTexel', 'uCameraNear', 'uCameraFar', 'uSeamOutlinesOn', 'uSeamColorDistThresh', 'uSeamOcclusionTolerance']) {
  assert.ok(name in a.uniforms, `game.js writes uniform ${name}`);
}
assert.equal(a.uniforms.uDepthOutlinesOn.value, 0, 'screen depth strokes are opt-in');
assert.equal(a.uniforms.uSeamOutlinesOn.value, 0, 'seam outlines start off');
assert.equal(a.depthTest, false); assert.equal(a.depthWrite, false);
const frag = a.fragmentShader;
// Exercise the actual shader's front/back depth guard in JS. The old
// symmetric linear tolerance admitted a nearer PNG's background furniture.
const guard = frag.match(/if \(raw >= 1\.0 \|\| (raw - sceneRaw > [\d.]+ \/ [\d.]+)\) return 0\.0;/);
assert.ok(guard, 'screen mask rejects a curve behind the visible depth');
const behind = new Function('raw', 'sceneRaw', 'return ' + guard[1]);
assert.match(frag, /uniform highp sampler2D tEdgeIdDepth, tSceneDepth;/, 'scene depth is sampled at high precision on mobile');
assert.match(frag, /uniform highp sampler2D tShellMaskDepth;/, 'screen-mask depth has the same precision');
const quantum = 1 / 16777215;
const depth = 0.95;
assert.equal(behind(depth, depth), false, 'matching geometry keeps its outline');
assert.equal(behind(depth + 2 * quantum, depth), false, 'depth quantization is tolerated');
assert.equal(behind(depth + 8 * quantum, depth), true, 'foreground art cannot inherit a nearby background curve');
assert.equal(behind(depth - 8 * quantum, depth), false, 'existing forward-bias tolerance is preserved');
for (const z of [0.1, 0.5, 0.95, 0.999]) {
  assert.equal(behind(Math.fround(z + 2 * quantum), Math.fround(z)), false, 'float32 rounding does not erase a matching mask');
  assert.equal(behind(Math.fround(z + 8 * quantum), Math.fround(z)), true, 'float32 rounding does not admit a deeper mask');
}
assert.match(frag, /visibleCurve\(vUv, centerRaw, centerDepth\)/, 'center stroke is gated by visible scene depth');
assert.match(frag, /visibleCurve\(uv, otherRaw, otherDepth\)/, 'neighbor sampling uses the same guard');
const early = frag.indexOf('if (uSeamOutlinesOn < 0.5)');
assert.ok(early > 0 && early < frag.indexOf('texture2D(tEdgeId'), 'seams off returns before any edge/depth texture read');

const index = require('./classic-script-group-index.js').expandClassicScriptGroups(); // Parser order, with the render group manifest expanded.
const mod = index.search(/js\/outline-composite-material\.js\?v=[A-Za-z0-9_-]+/);
const game = index.search(/src="game\.js\?v=/);
assert.ok(mod > 0 && game > mod, 'module is loaded (via the render group) before game.js');
const pipelineAt = index.search(/js\/world-render-pipeline\.js\?v=[A-Za-z0-9_-]+/);
assert.ok(pipelineAt > mod && game > pipelineAt, 'the world render pipeline loads after this module and before game.js');
{ // js/world-render-pipeline.js builds its composite through the module.
  const { createWorldRenderPipelineHarness } = require('./lib/world-render-pipeline-harness.js');
  const h = createWorldRenderPipelineHarness();
  h.window.OutlineCompositeMaterial = { create: T => { const m = new T.ShaderMaterial({ uniforms: a.uniforms }); m.fromModule = true; return m; } };
  h.init();
  assert.equal(h.pipeline.materials.composite.fromModule, true, 'the pipeline builds its composite through the module');
}
console.log('ok - outline composite material module is wired and skips seam reads when seams are off');
