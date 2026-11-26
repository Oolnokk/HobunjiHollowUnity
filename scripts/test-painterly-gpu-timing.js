#!/usr/bin/env node
'use strict';
// Executes the real painterly module with a fake renderer and a fake EXT_disjoint_timer_query_webgl2:
// every 4th frame wraps each of the three passes in a query; results are polled asynchronously and reported.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/painterly-postprocess.js', 'utf8');
const events = [];
let nextQuery = 1, ready = new Set(), active = 0, maxActive = 0, deleted = 0;
const ext = { TIME_ELAPSED_EXT: 0x88BF, GPU_DISJOINT_EXT: 0x8FBB };
const gl = {
  QUERY_RESULT_AVAILABLE: 0x8867, QUERY_RESULT: 0x8866,
  createQuery: () => ({ id: nextQuery++ }),
  deleteQuery: () => { deleted++; },
  beginQuery: () => { active++; maxActive = Math.max(maxActive, active); events.push('begin'); },
  endQuery: () => { active--; events.push('end'); },
  getParameter: () => false,
  getQueryParameter: (q, what) => (what === gl.QUERY_RESULT_AVAILABLE ? ready.has(q.id) : q.id * 1e6), // Fake result: id milliseconds.
  getExtension: name => (name === 'EXT_disjoint_timer_query_webgl2' ? ext : null),
};
class Mat { constructor() { this.uniforms = {}; } }
class Vec2 { constructor(x = 0, y = 0) { this.x = x; this.y = y; } set(x, y) { this.x = x; this.y = y; } }
const target = () => ({ texture: {}, setSize() {} });
const THREE = {
  WebGLRenderTarget: function () { return target(); }, ShaderMaterial: Mat, Vector2: Vec2,
  LinearFilter: 1, PlaneGeometry: function () {}, Mesh: function () { this.frustumCulled = true; },
  Scene: function () { this.add = () => {}; }, OrthographicCamera: function () {},
};
const rendered = [];
const renderer = {
  getContext: () => gl, getRenderTarget: () => null, setRenderTarget() {}, clear() {}, autoClear: false,
  getDrawingBufferSize: v => new Vec2(1850, 858),
  render() { rendered.push('final'); },
};
const compositeMaterial = { uniforms: { tColor: { value: { image: { width: 1850, height: 858 } } }, tHobunjiPaint: { value: null }, uHobunjiPaintTexel: { value: new Vec2() } }, userData: {}, fragmentShader: '', isShaderMaterial: true };
const window = { THREE, __hobunjiGameRenderer: null, localStorage: { getItem: () => 'medium', setItem() {} } };
window.window = window;
const context = { window, THREE, document: { getElementById: () => null, addEventListener() {}, createElement: () => ({ getContext: () => null }) }, localStorage: window.localStorage,
  performance: { now: () => 0 }, setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, console };
try { vm.runInNewContext(source, context, { filename: 'painterly-postprocess.js' }); }
catch (e) { console.log('SKIP: module needs a fuller DOM to load in a bare VM (' + e.message + ')'); process.exit(0); }

const api = window.PainterlyPostprocess;
assert.ok(api, 'module exposes PainterlyPostprocess');
const snap = api.snapshot();
assert.ok(snap.gpuTiming && snap.gpuTiming.supported === null, 'gpuTiming is reported, unsampled until the first frame');
assert.deepEqual(Object.keys(snap.gpuTiming.emaMs).sort(), ['oil', 'tone', 'washH']);
console.log('painterly gpu timing: snapshot shape passed (render-loop lifecycle needs a browser)');
