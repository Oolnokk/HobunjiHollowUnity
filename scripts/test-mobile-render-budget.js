'use strict';
const assert = require('node:assert/strict'); // Checks renderer policy without a physical GPU.
const fs = require('node:fs'); // Loads the actual runtime module.
const vm = require('node:vm'); // Supplies browser events and storage deterministically.
function boot(mobile) {
  const events = {}; // Captures context and lifecycle listeners.
  const storage = new Map([['hobunjiMobileRenderCheckpointV1', JSON.stringify({ reason: 'playing', fps: 12 })]]); // Simulates a previous tab terminating.
  const document = { hidden: false, addEventListener: (key, cb) => { events[key] = cb; }, createElement: () => ({ style: {}, setAttribute() {} }), body: { appendChild() {} } }; // Minimal context-loss notice host.
  const context = { document, navigator: {}, matchMedia: () => ({ matches: mobile }), devicePixelRatio: 3, performance: {}, localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) }, addEventListener: (key, cb) => { events[key] = cb; } }; // Real module environment.
  context.window = context;
  vm.runInNewContext(fs.readFileSync('docs/js/mobile-render-budget.js', 'utf8'), context);
  let resizes = 0; // Counts actual buffer resize requests.
  context.MobileRenderBudget.attach({ domElement: { width: 800, height: 400, addEventListener: (key, cb) => { events[key] = cb; } }, info: { memory: { textures: 30, geometries: 40 } } }, () => resizes++);
  return { api: context.MobileRenderBudget, events, document, storage, resizes: () => resizes };
}
const phone = boot(true); // Full-resolution mobile policy and recovery fixture.
assert.equal(phone.api.pixelRatio(800, 400), 2);
assert.equal(phone.api.pixelRatio(2000, 2000), 2, 'large buffers keep the selected resolution');
for (let t = 1; t <= 4101; t += 100) phone.api.sample(t);
assert.equal(phone.api.snapshot().scale, 1, 'sustained low FPS must never blur the game');
assert.equal(phone.resizes(), 0, 'sampling must not trigger buffer reallocations');
phone.api.setMode('1');
const manualResizes = phone.resizes(); // Manual selections must stay under user control.
for (let t = 5001; t <= 9201; t += 100) phone.api.sample(t);
assert.equal(phone.api.pixelRatio(800, 400, 0.75), 1.5);
assert.equal(phone.resizes(), manualResizes);
phone.api.setMode('auto');
let prevented = false; // Verifies WebGL recovery is allowed.
phone.events.webglcontextlost({ preventDefault() { prevented = true; } });
assert.ok(prevented);
assert.ok(phone.api.shouldSuspend());
assert.equal(JSON.parse(phone.storage.get('hobunjiMobileRenderCheckpointV1')).reason, 'webglcontextlost');
assert.equal(phone.api.snapshot().previousSession.fps, 12);
phone.events.webglcontextrestored();
assert.equal(phone.api.shouldSuspend(), false);
assert.equal(phone.api.snapshot().scale, 1, 'recovery preserves selected detail');
phone.document.hidden = true;
phone.events.visibilitychange();
assert.ok(phone.api.shouldSuspend());
assert.equal(boot(false).api.pixelRatio(800, 400), 2, 'desktop manual default remains unchanged');
console.log('Mobile render budget, manual overrides, and context recovery passed.');
