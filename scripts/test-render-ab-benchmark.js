#!/usr/bin/env node
'use strict';

// Executes docs/js/render-ab-benchmark.js with a fake rAF clock: it alternates
// frame scope on/off, times the pipeline's renderFrame, restores everything,
// and adds its Settings row next to the Test Arena row.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

let clock = 0;
const frameCallbacks = [];
const scopeHistory = [];
const outlineHistory = [];
let renderCostMs = 2;
const pipeline = {
  renderFrame() { clock += renderCostMs; },
  snapshot: () => ({ lastFrame: { nativeRenders: 17 } }),
};
const hooks = { setFrameScopeEnabled(on) { scopeHistory.push(on); renderCostMs = on ? 2 : 5; } };
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
const window = {
  RenderHooks: hooks, WorldRenderPipeline: pipeline, devicePixelRatio: 2,
  __hobunjiGameRenderer: { getContext: () => ({ drawingBufferWidth: 800, drawingBufferHeight: 450 }) },
  __hobunjiFurnitureDebug: { currentArea: () => 'map_western_slope', outlinesSetting: true, setOutlines(v) { this.outlinesSetting = v; outlineHistory.push(v); } },
};
window.window = window;
const context = {
  window, document, navigator: { userAgent: 'test' }, console, Promise, setTimeout,
  performance: { now: () => clock },
  requestAnimationFrame: cb => { frameCallbacks.push(cb); },
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('docs/js/render-ab-benchmark.js', 'utf8'), context, { filename: 'render-ab-benchmark.js' });
assert.ok(anchorRow.inserted && anchorRow.inserted.where === 'afterend', 'Settings row is inserted after the Test Arena row');
assert.equal(anchorRow.inserted.element.attributes['data-dev-only'], '', 'the row is dev-only');

const originalRenderFrame = pipeline.renderFrame;
const done = window.RenderABBenchmark.run({ rounds: 2, framesPerWindow: 20 });
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
  assert.deepEqual(Object.keys(report.variants), ['default', 'frameScopeOff', 'outlinesOff']);
  assert.equal(report.variants.default.frames, 40);
  assert.ok(report.variants.frameScopeOff.renderJsMs > report.variants.default.renderJsMs, 'render JS time is measured per variant');
  assert.match(window.RenderABBenchmark.lastText(), /default\s+: [\d.]+ fps/);
  assert.equal(report.device.drawingBuffer.join('x'), '800x450');
  console.log('render A/B benchmark: alternating windows, timing, restore and Settings row ok');
})().catch(error => { console.error(error); process.exit(1); });
