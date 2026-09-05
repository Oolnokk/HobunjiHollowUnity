#!/usr/bin/env node
'use strict';

// Regression guard for a race in loading-screen-runtime.js: a stale show()
// call's post-paint continuation used to call hide() on ANY generation
// mismatch, even when the mismatch was caused by a newer legitimate show()
// (e.g. two enterBuilding/enterZone transitions in quick succession) rather
// than an intervening hide(). That clobbered the newer overlay mid-build.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'docs/js/loading-screen-runtime.js'), 'utf8');

function makeEl() {
  const el = {
    style: { setProperty() {} },
    classList: {
      _set: new Set(),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      contains(c) { return this._set.has(c); },
    },
    children: [],
    appendChild(child) { this.children.push(child); return child; },
    querySelector(sel) {
      const id = sel.replace('#', '');
      const find = node => (node.id === id ? node : (node.children || []).reduce((found, c) => found || find(c), null));
      return this.children.reduce((found, c) => found || find(c), null);
    },
    set innerHTML(html) {
      // Minimal stand-in: the runtime only ever reads back child nodes by id
      // (querySelector('#foo')), so just materialize one stub element per id
      // found in the markup instead of a real HTML parse.
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

// Drives both microtasks (fetch/Promise.all chains) and queued rAF callbacks
// (including the self-rescheduling motion-pan loop, harmlessly re-queued each
// round) until the given promise settles, or gives up after a generous cap --
// avoids hardcoding exactly how many .then()/rAF hops the real module takes.
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
  // Scenario 1: two show() calls in quick succession, no hide() in between --
  // the second (newer) show() must end up visible, not clobbered by the first
  // show()'s stale post-paint continuation.
  const first = runtime.show(); // fire-and-forget, like enterBuilding/enterZone
  for (let i = 0; i < 10; i++) await Promise.resolve();
  const second = runtime.show(); // a second transition starts before the first settles
  await settle(Promise.all([first, second]));
  const rootEl = documentStub.body.children.find(c => c.id === 'hobunjiLoadScreen');
  assert(rootEl.classList.contains('visible'), 'a newer show() must remain visible even if an older stale show() resolves after it');

  // Scenario 2: show() followed by a real hide() while still waiting on the
  // paint -- the overlay must end up hidden once the stale show() settles.
  const third = runtime.show();
  for (let i = 0; i < 10; i++) await Promise.resolve();
  runtime.hide();
  await settle(third);
  assert.ok(!rootEl.classList.contains('visible'), 'an explicit hide() must still win when it targets the current show()');

  console.log('Loading screen runtime race guard passed (newer show() survives a stale predecessor; a real hide() still wins).');
})().catch(err => { console.error(err); process.exit(1); });
