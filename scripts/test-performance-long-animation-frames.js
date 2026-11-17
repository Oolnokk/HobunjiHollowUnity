#!/usr/bin/env node
'use strict';

// Browser-only Long Animation Frames attribution remains opt-in and gracefully
// falls back when the current Chromium/Firefox build does not support the API.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('docs/js/performance-debug.js', 'utf8');

function fixture({ supported = true } = {}) {
  const observers = []; // Simulated PerformanceObserver registrations, manually delivered below.
  const nodes = new Map(); // Reuses the existing diagnostics overlay instead of creating one per update.
  let menuOpen = false; // Sampled when a Long Animation Frame is reported.
  class TestObserver {
    constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
    observe(options) {
      this.type = options.type || options.entryTypes?.[0];
      if (this.type === 'long-animation-frame' && !supported) throw Error('unsupported entry type');
    }
    disconnect() { this.disconnected = true; }
    fire(entries) { this.callback({ getEntries: () => entries }); }
  }
  const scheduler = {
    register() {}, setEnabled() {}, setProfilingEnabled() {},
    getDebug() { return { entries: [], profilingEnabled: false }; },
  }; // Minimum compatible RuntimeFrameScheduler interface for the production profiler.
  const documentObject = {
    readyState: 'complete',
    body: { appendChild(node) { nodes.set(node.id, node); } },
    getElementById(id) {
      return id === 'menuPanel' ? { classList: { contains: token => token === 'open' && menuOpen } } : nodes.get(id) || null;
    },
    createElement() { return { style: {}, appendChild() {}, addEventListener() {}, classList: { add() {}, remove() {} } }; },
    addEventListener() {}, querySelectorAll() { return []; },
  };
  const windowObject = {
    RuntimeFrameScheduler: scheduler,
    PerformanceObserver: TestObserver,
    localStorage: { getItem: () => null, setItem() {} },
    performance: { now: () => 1000 },
  };
  const context = {
    window: windowObject, document: documentObject,
    performance: windowObject.performance, console, setTimeout: () => 1,
    Math, Number, Object, Array, Set, Map, WeakMap, String, JSON, Date,
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'performance-debug.js' });
  return {
    api: windowObject.PerfProfiler,
    observers,
    setMenuOpen(value) { menuOpen = !!value; },
    loafObserver() { return observers.find(observer => observer.type === 'long-animation-frame'); },
  };
}

{
  const f = fixture();
  assert.equal(f.loafObserver(), undefined, 'no long-frame observer while the profiler is off');
  f.api.setEnabled(true);
  const observer = f.loafObserver();
  assert(observer, 'profiler start activates the browser Long Animation Frames source');
  const makeScript = (url, forced) => ({
    sourceURL: url, forcedStyleAndLayoutDuration: forced,
  }); // The browser provides script attribution only for some long frames.
  observer.fire([{ duration: 95, startTime: 100, styleAndLayoutStart: 155, scripts: [
    makeScript('https://test.invalid/docs/js/inventory-ui.js?probe=old', 11),
    makeScript('https://test.invalid/docs/js/held-object-render-order.js?probe=old', 0),
  ] }]);
  f.setMenuOpen(true);
  observer.fire([{ duration: 126, startTime: 200, styleAndLayoutStart: 260, scripts: [
    makeScript('https://test.invalid/docs/js/inventory-ui.js?probe=new', 7),
    makeScript('https://test.invalid/docs/js/action-arch-icons.js', 4),
  ] }]);
  const snap = f.api.snapshot().longFrames;
  assert.equal(snap.recording, true);
  assert.equal(snap.frames, 2);
  assert.equal(snap.totalMs, 221);
  assert.equal(snap.maxMs, 126);
  assert.equal(snap.styleLayoutFrames, 2, 'browser phase boundaries are tracked independently from script attribution');
  assert.equal(snap.styleLayoutPhaseMs, 106, 'style/layout-to-frame-end totals include the later render tail');
  assert.equal(snap.menuClosed.styleLayoutPhaseMs, 40);
  assert.equal(snap.menuOpen.styleLayoutPhaseMs, 66);
  assert.equal(snap.forcedStyleMs, 22);
  assert.equal(snap.menuClosed.frames, 1);
  assert.equal(snap.menuClosed.forcedStyleMs, 11);
  assert.equal(snap.menuOpen.frames, 1);
  assert.equal(snap.menuOpen.forcedStyleMs, 11);
  assert.equal(snap.scripts[0].source, 'js/inventory-ui.js');
  assert.equal(snap.scripts[0].calls, 2);
  assert.equal(snap.scripts[0].forcedStyleMs, 18);
  assert(!snap.scripts.some(script => script.source.includes('?')), 'query tokens must not fragment script counts');
  f.api.setEnabled(false);
  assert.equal(observer.disconnected, true, 'profiler off disconnects browser observer immediately');
  assert.equal(f.api.snapshot().longFrames.recording, false);
  observer.fire([{ duration: 999, scripts: [makeScript('https://test.invalid/docs/js/inventory-ui.js', 900)] }]);
  assert.equal(f.api.snapshot().longFrames.frames, 2, 'queued callbacks after disable must not corrupt the stopped report');
  f.api.setEnabled(true);
  assert.equal(f.api.snapshot().longFrames.frames, 0, 'a new profiler session must start with clean counters');
}

{
  const f = fixture({ supported: false });
  f.api.setEnabled(true);
  const snap = f.api.snapshot().longFrames;
  assert.equal(snap.supported, false, 'unsupported browsers must report unavailability explicitly');
  assert.equal(snap.recording, false);
  assert.equal(snap.frames, 0);
}

console.log('performance long-animation-frame probe tests passed');
