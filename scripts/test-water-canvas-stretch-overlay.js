#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const overlay = fs.readFileSync(path.join(root, 'docs/js/water-canvas-stretch-overlay.js'), 'utf8');
const loader = fs.readFileSync(path.join(root, 'docs/js/house-pieces.js'), 'utf8');
const page = fs.readFileSync(path.join(root, 'docs/index.html'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'docs/js/merged-water-renderer.js'), 'utf8');

const postAt = loader.indexOf("['NaturalSurfaceStretchPostJigsaw', 'natural-surface-stretch-post-jigsaw.js");
const waterAt = loader.indexOf("['WaterCanvasStretchOverlay', 'water-canvas-stretch-overlay.js");
assert.ok(postAt >= 0 && waterAt > postAt, 'water bank mapper must compose after the established natural-surface mapper');
assert.ok(page.indexOf('js/house-pieces.js') < page.indexOf('js/merged-water-renderer.js'), 'fixture requires late renderer assignment');

assert.match(overlay, /BASE_WATER_TEXTURE_URL = 'assets\/textures\/wavy_surface\.png'/,
  'water body must use the ordinary continuous wavy_surface texture');
assert.match(overlay, /BANK_SOURCE_TEXTURE_URL = 'assets\/textures\/canvas\.png'/,
  'canvas.png is only the source used to derive the bank-outline mask');
assert.match(overlay, /function makeOutlineOnlyTexture\(/,
  'bank overlay must be converted to its own outline-only texture');
assert.match(overlay, /if \(isOutline\)[\s\S]*kept\+\+[\s\S]*else \{[\s\S]*pixels\.data\[i \+ 3\] = 0/,
  'non-outline source pixels must become fully transparent');
assert.doesNotMatch(overlay, /OVERLAY_OPACITY|overlayColor = baseColor|uSurfaceOverlayOpacity/,
  'old translucent full-canvas blend must be gone');
assert.match(overlay, /surfaceColor = mix\(surfaceColor, vec3\(0\.0\), clamp\(bankOutline\.a/,
  'only the black bank mask is composited over the completed water color');

assert.match(overlay, /for \(let index = 0; index < position\.count; index\+\+\) position\.setY\(index, 0\)/,
  'water height is flattened only for footprint recognition');
assert.match(overlay, /mapped\.setAttribute\('aStretchUv', fittedUv\.clone\(\)\)/,
  'protected bank mapping must live in its own UV attribute');
assert.match(overlay, /mapped\.setAttribute\('uv', tiledUv\)/,
  'base world-tiled water UVs must be restored unchanged');
assert.match(overlay, /baseUvMode: 'world-tiled-untouched'/,
  'runtime diagnostics must explicitly record the separated base UV path');
assert.match(overlay, /Object\.assign\(\{\}, options, \{ textureUrl: BASE_WATER_TEXTURE_URL \}\)/,
  'renderer wrapper must force wavy_surface without editing WaterSystem simulation code');

assert.match(renderer, /function buildInvertedSurfaceData\(/,
  'modern dense/inverted water geometry remains authoritative');
assert.match(renderer, /representation = 'baseline-geometry-exceptions'/,
  'baseline rectangle optimization remains intact');
assert.doesNotMatch(overlay, /GrassSurfaceCanvasOverlay|grass-surface|carved_smooth/,
  'water adapter must not carry grass or cliff treatment');

const sandboxWindow = {
  THREE: { BufferGeometry: function BufferGeometry() {} },
  HobunjiSurfaceStretchUV: { mapGeometry() {}, settings: { angleToleranceDeg: 24 } },
};
sandboxWindow.window = sandboxWindow;
const sandbox = { window: sandboxWindow, console: { debug() {}, warn() {} }, Uint8Array, Float32Array, Object, Number, Math };
vm.runInNewContext(overlay, sandbox, { filename: 'water-canvas-stretch-overlay.js' });
let snapshot = sandboxWindow.WaterCanvasStretchOverlay.snapshot();
assert.equal(snapshot.rendererInstalled, false, 'early parser load must wait for MergedWaterRenderer');
assert.equal(snapshot.lateHookInstalled, true, 'late renderer hook must be armed');

const baseCreateMaterial = function baseCreateMaterial() {};
const baseCreateMesh = function baseCreateMesh() {};
sandboxWindow.MergedWaterRenderer = { createMaterial: baseCreateMaterial, createMesh: baseCreateMesh, DEFAULT_TEXTURE_TILE_SIZE: 4, stats: {} };
snapshot = sandboxWindow.WaterCanvasStretchOverlay.snapshot();
assert.equal(snapshot.rendererInstalled, true, 'later renderer assignment must install immediately');
assert.equal(sandboxWindow.MergedWaterRenderer.createMaterial.__waterBankOutlineOriginal, baseCreateMaterial,
  'material wrapper must compose exactly once');
assert.equal(sandboxWindow.MergedWaterRenderer.createMesh.__waterBankOutlineOriginal, baseCreateMesh,
  'mesh wrapper must compose exactly once');

console.log('water bank outline tests passed');
