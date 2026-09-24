'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const weather = read('docs/js/weather-fx.js');
const cloudFog = read('docs/js/cloud-forest-fog.js');
const pixelProbe = read('docs/js/pixel-probe.js');
const index = read('docs/index.html');

new vm.Script(weather, { filename: 'weather-fx.js' });
new vm.Script(cloudFog, { filename: 'cloud-forest-fog.js' });
new vm.Script(pixelProbe, { filename: 'pixel-probe.js' });

assert.match(weather, /webglcontextlost/, 'WeatherFX must observe WebGL context loss');
assert.match(weather, /webglcontextrestored/, 'WeatherFX must observe WebGL context restoration');
assert.match(weather, /const canvas = renderer\.domElement/, 'surface repair must inspect the actual WebGL canvas backing store');
assert.match(weather, /actualWidth = Math\.round\(Number\(canvas\?\.width\) \|\| 0\)/, 'surface repair must compare the real canvas backing width, not only Three.js cached dimensions');
assert.match(weather, /getDrawingBufferSize\(_presentationBufferSize\)/, 'surface repair must also compare Three.js internal drawing-buffer dimensions');
assert.match(weather, /expectedHeight = Math\.max\(1, Math\.round\(rect\.height \* pixelRatio\)\)/, 'surface repair must validate framebuffer height independently');
assert.match(weather, /renderer\.setSize\(rect\.width, rect\.height\)/, 'surface repair must restore the renderer backing dimensions');
assert.match(weather, /expectedOverlayWidth = Math\.max\(1, Math\.round\(rect\.width \* overlayPixelRatio\)\)/, '2D overlay backing size must retain the game DPR instead of collapsing to CSS pixels');
assert.match(weather, /context\?\.setTransform\?\.\(pixelRatio, 0, 0, pixelRatio, 0, 0\)/, '2D overlay repair must restore the DPR drawing transform');
assert.match(weather, /document\.getElementById\('overlayCanvas'\)/, 'surface repair must keep the normal overlay canvas in sync');
assert.match(weather, /deps\?\.lctx\?\.canvas \|\| document\.getElementById\('lightingCanvas'\)/, 'surface repair must keep the lighting canvas in sync');
assert.match(weather, /window\.dispatchEvent\?\.\(new Event\('resize'\)\)/, 'surface mismatch/context restore must reuse the game resize path so private render targets are resized too');
assert.match(weather, /_refreshActiveSceneGpuResources/, 'context restore must refresh only active-scene GPU material resources');
assert.match(weather, /getRenderRecoveryState/, 'WeatherFX must expose recovery diagnostics');

assert.match(cloudFog, /WeatherFX\?\.ensurePresentationSurface/, 'the unified lighting override must also use the shared surface repair');
assert.match(pixelProbe, /Render surface recovery:/, 'Pixel Probe must expose context and framebuffer repair state');
assert.match(pixelProbe, /rendererBuffer=/, 'Pixel Probe must distinguish the WebGL canvas backing size from Three.js internal drawing-buffer size');
assert.match(pixelProbe, /overlayExpected=/, 'Pixel Probe must report the expected DPR-sized 2D backing dimensions');

for (const file of ['weather-fx', 'cloud-forest-fog', 'pixel-probe']) {
  assert.match(index, new RegExp(`js/${file}\\.js\\?v=${file === 'cloud-forest-fog' ? '20260924renderrecovery2' : '20260924texture-restore1'}`), `${file}.js cache-bust must ship the repair`);
}

console.log('Render surface/context recovery preflight checks passed.');
