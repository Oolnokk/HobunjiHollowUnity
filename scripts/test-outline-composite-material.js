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
assert.equal(a.uniforms.uDepthOutlineDistanceTaper.value, 0, 'taper is opt-in');
assert.equal(a.uniforms.uDepthOutlineWobble.value, 0, 'wobble is opt-in');
assert.notEqual(a.uniforms.uOutlineClipToWorld.value, b.uniforms.uOutlineClipToWorld.value);
assert.deepEqual(Array.from(a.uniforms.uOutlineClipToWorld.value), [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
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
assert.match(frag, /visibleCurve\(centerMask, centerRaw, centerDepth\)/, 'center stroke is gated by visible scene depth');
assert.match(frag, /visibleCurve\(raw, otherRaw, otherDepth\)/, 'neighbor sampling uses the same guard');
// Run the scalar math from the shipped GLSL rather than a separate copy.
function scalarShaderFunction(name, globals = {}) {
  const fn = frag.match(new RegExp('float ' + name + '\\(([^)]*)\\) \\{([\\s\\S]*?)\\n        \\}'));
  assert.ok(fn, name + ' is defined in the composite shader');
  const args = fn[1].replace(/\bfloat\s+/g, '');
  const body = fn[2].replace(/\bfloat\s+/g, 'let ');
  const smoothstep = (low, high, x) => {
    const t = Math.max(0, Math.min(1, (x - low) / (high - low)));
    return t * t * (3 - 2 * t);
  };
  return new Function(...Object.keys(globals), 'min', 'max', 'smoothstep', args,
    body).bind(null, ...Object.values(globals), Math.min, Math.max, smoothstep);
}
const depthStep = scalarShaderFunction('depthStepStrength');
const thinInk = scalarShaderFunction('protectThinGeometry');
const distanceScale = scalarShaderFunction('outlineDistanceScale');
const wobbleAmplitude = scalarShaderFunction('outlineWobbleAmplitude');
assert.equal(distanceScale(0), 1);
assert.equal(distanceScale(5), 1);
assert.ok(Math.abs(distanceScale(30) - 0.35) < 1e-12);
assert.equal(distanceScale(100), distanceScale(30));
assert.equal(wobbleAmplitude(5), 0.32);
assert.ok(wobbleAmplitude(30) < wobbleAmplitude(8));
for (let depth = 0; depth < 100; depth += 0.25) {
  assert.ok(distanceScale(depth + 0.25) <= distanceScale(depth));
  assert.ok(wobbleAmplitude(depth + 0.25) <= wobbleAmplitude(depth));
  assert.ok(12 * distanceScale(depth) * (1 - wobbleAmplitude(depth)) >= 3);
}
for (const orthographic of [0, 1]) {
  const near = 0.1, far = 200;
  const rawGap = scalarShaderFunction('rawGapThreshold', {
    uCameraNear: near, uCameraFar: far, uOrthographic: orthographic,
  });
  const raw = z => orthographic ? (z - near) / (far - near)
    : far / (far - near) - near * far / ((far - near) * z);
  for (const z of [1, 10, 50, 150]) {
    const center = raw(z);
    const lowWorld = Math.max(0.105, z * 0.009);
    const highWorld = Math.max(0.225, z * 0.018);
    const low = rawGap(z, lowWorld), high = rawGap(z, highWorld);
    assert.ok(Math.abs(low - (raw(z + lowWorld) - center)) < 1e-12);
    assert.ok(Math.abs(high - (raw(z + highWorld) - center)) < 1e-12);
    for (const gradient of [0, high * 2, -high * 2]) {
      assert.equal(depthStep(center, center + gradient, center - gradient, low, high), 0,
        'flat and steep projected planar faces do not ink');
      assert.equal(depthStep(center, center + gradient + low * 0.2,
        center - gradient + low * 0.2, low, high), 0, 'gentle curvature stays colored');
    }
    assert.equal(depthStep(center, center + high * 2, center, low, high), 1, 'outward depth step inks');
    assert.equal(depthStep(center, center, center + high * 2, low, high), 0, 'opposite side stays colored');
    assert.equal(depthStep(center, center - high * 2, center, low, high), 0, 'far side of step stays colored');
    assert.equal(depthStep(Math.fround(center), Math.fround(center + high * 2),
      Math.fround(center - high * 2), low, high), 0, 'float32 slope rounding is tolerated');
  }
}
assert.equal(thinInk(0, 0, 0, 0), 0);
assert.equal(thinInk(1, 0, 0, 0), 1, 'ordinary silhouettes retain full ink');
assert.equal(thinInk(1, 0, 1, 0), 1, 'corner silhouettes retain full ink');
assert.ok(Math.abs(thinInk(1, 1, 0, 0) - 0.55) < 1e-12, 'thin vertical surface keeps color');
assert.ok(Math.abs(thinInk(0, 0, 1, 1) - 0.55) < 1e-12, 'thin horizontal surface keeps color');
assert.ok(Math.abs(thinInk(1, 1, 1, 1) - 0.55) < 1e-12, 'tiny geometry keeps color');
assert.match(frag, /vec2 edges = vec2\(1\.0 - minus\.y, 1\.0 - plus\.y\)/, 'mask silhouettes remain independent of depth gradients');
assert.match(frag, /if \(axisInterior && minus\.y > 0\.5 && plus\.y > 0\.5\)/, 'viewport clamping and mask boundaries are excluded from slope math');
assert.match(frag, /vec2 stroke = uTexel \* 12\.0/, 'retain existing silhouette width');
assert.equal((frag.match(/curveSample\(vUv/g) || []).length, 4, 'no additional neighbor taps');
assert.match(frag, /if \(uDepthOutlineDistanceTaper > 0\.5\) stroke \*= outlineDistanceScale\(centerDepth\)/);
assert.match(frag, /if \(uDepthOutlineWobble > 0\.5\)/);
assert.match(frag, /uOutlineClipToWorld \* vec4\(vUv \* 2\.0 - 1\.0, rawDepth \* 2\.0 - 1\.0, 1\.0\)/);
const variationBody = frag.slice(frag.indexOf('float worldInkVariation('), frag.indexOf('vec3 applyScreenOutline('));
assert.ok(!variationBody.includes('texture2D'), 'world-space wobble adds no texture lookup');
assert.match(frag, /protectThinGeometry\(horizontal\.x, horizontal\.y, vertical\.x, vertical\.y\)/, 'thin protection is used by the composite');

// Mask misses must skip scene-depth sampling, not merely skip the ink math.
const centerStart = frag.indexOf('vec3 applyScreenOutline(');
const neighborStart = frag.indexOf('vec2 curveSample(');
assert.ok(centerStart >= 0 && neighborStart >= 0);
const centerBody = frag.slice(centerStart, frag.indexOf('void main()', centerStart));
const neighborBody = frag.slice(neighborStart, frag.indexOf('vec2 curveAxisEdges(', neighborStart));
for (const [body, guard] of [[centerBody, 'if (centerMask >= 1.0) return color;'],
  [neighborBody, 'if (raw >= 1.0) return vec2(1.0, 0.0);']]) {
  assert.ok(body.indexOf(guard) >= 0 && body.indexOf(guard) < body.indexOf('texture2D(tSceneDepth'), 'empty mask exits before scene depth');
}
assert.ok(frag.indexOf('if (id0.a <= 0.5)') < frag.indexOf('vec4 idL ='), 'empty seam center skips neighbor IDs');
assert.ok(frag.indexOf('if (idEdge <= 0.0)') < frag.indexOf('texture2D(tEdgeIdDepth'), 'non-seam pixels skip occlusion depth');
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
