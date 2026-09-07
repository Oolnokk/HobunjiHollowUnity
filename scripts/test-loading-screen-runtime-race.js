#!/usr/bin/env node
'use strict';

// Regression guard for loading-screen-runtime.js: newer show() calls must win
// over stale predecessors, explicit hide() must still win, and the live progress
// API must reach 100 only when that active loading session is completed.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'docs/js/loading-screen-runtime.js'), 'utf8');

function makeEl() {
  const el = {
    style: { setProperty() {} },
    dataset: {},
    classList: {
      _set: new Set(),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      toggle(c, force) {
        const enabled = force === undefined ? !this._set.has(c) : !!force;
        if (enabled) this._set.add(c); else this._set.delete(c);
        return enabled;
      },
      contains(c) { return this._set.has(c); },
    },
    children: [],
    appendChild(child) {
      this.children.push(child);
      if (typeof child.onload === 'function') Promise.resolve().then(() => child.onload());
      return child;
    },
    addEventListener() {},
    querySelector(sel) {
      const id = sel.replace('#', '');
      const find = node => (node.id === id ? node : (node.children || []).reduce((found, c) => found || find(c), null));
      return this.children.reduce((found, c) => found || find(c), null);
    },
    querySelectorAll() { return []; },
    set innerHTML(html) {
      // Minimal stand-in: the runtime reads child nodes back by id, so just
      // materialize one stub per id instead of depending on a browser parser.
      this.children = Array.from(html.matchAll(/id="([^"]+)"/g)).map(m => { const child = makeEl(); child.id = m[1]; return child; });
    },
  };
  return el;
}

let rafQueue = [];
function flushRaf() {
  const batch = rafQueue;
  rafQueue = [];
  for (const cb of batch) cb(0);
}

const documentStub = {
  head: makeEl(),
  body: makeEl(),
  fonts: null,
  querySelector() { return null; },
  createTextNode(text) { const node = makeEl(); node.textContent = text; return node; },
  createElement() { return makeEl(); },
};

const windowStub = {
  document: documentStub,
  fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ settings: {}, entries: [{ id: 'a', lore: '', script: '' }] }) }),
  requestAnimationFrame(cb) { rafQueue.push(cb); return rafQueue.length; },
  cancelAnimationFrame() {},
  performance: { now: () => 0 },
  innerWidth: 800,
  innerHeight: 600,
};
windowStub.window = windowStub;
windowStub.document.defaultView = windowStub;

const context = vm.createContext(windowStub);
vm.runInContext(source, context, { filename: 'loading-screen-runtime.js' });
const runtime = context.window.LoadingScreenRuntime;
assert(runtime, 'LoadingScreenRuntime must install');

// Drives both microtasks and queued rAF callbacks until the given promise
// settles. Timers are intentionally absent from this VM so hide() uses its
// immediate non-browser fallback rather than making this unit test wait 3 s.
async function settle(promise) {
  let settled = false;
  promise.then(() => { settled = true; }, () => { settled = true; });
  for (let round = 0; round < 50 && !settled; round++) {
    for (let i = 0; i < 10; i++) await Promise.resolve();
    flushRaf();
  }
  assert.ok(settled, 'promise did not settle within the round budget');
}

(async () => {
  const first = runtime.show();
  for (let i = 0; i < 10; i++) await Promise.resolve();
  const second = runtime.show();
  await settle(Promise.all([first, second]));
  const rootEl = documentStub.body.children.find(c => c.id === 'hobunjiLoadScreen');
  assert(rootEl.classList.contains('visible'), 'a newer show() must remain visible even if an older stale show() resolves after it');
  assert(runtime.getProgress() > 0 && runtime.getProgress() < 100, 'a visible unfinished session reports live progress instead of the authored preview percent');

  const third = runtime.show();
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await runtime.hide();
  await settle(third);
  assert.ok(!rootEl.classList.contains('visible'), 'an explicit hide() must still win when it targets the current show()');
  assert.equal(runtime.getProgress(), 100, 'completion drives the displayed percentage to 100');

  console.log('Loading screen runtime race/progress guard passed.');
})().catch(err => { console.error(err); process.exit(1); });
