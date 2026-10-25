'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Execute the real session listeners with a controlled timer queue. A close
// from the previous grooming visit must not tear down the newly reopened one.
for (const file of ['onboarding-character-creation-redesign.js', 'onboarding-character-creation-life-preview.js', 'onboarding-character-creation-camera-composition.js']) {
  const source = fs.readFileSync('docs/js/' + file, 'utf8'); // Uses the production listener instead of mirroring its lifecycle condition.
  const start = source.indexOf("document.addEventListener('hobunji-creator-session', event => {");
  const indent = file.includes('camera-composition') ? '  ' : '    '; // Listener boundaries match their owning IIFE's indentation.
  const end = source.indexOf('\n' + indent + '});', start) + indent.length + 6;
  assert(start >= 0 && end > start, file);
  let session = null; // Canonical creator ownership changes before the corresponding open/close event is dispatched.
  let stopCount = 0; // Tracks stale teardown attempts without constructing an independent renderer.
  let listener = null; // Captures the real module's registered session handler.
  const timers = []; // Holds delayed teardown callbacks in dispatch order.
  const context = vm.createContext({
    active: false,
    window: { HobunjiOnboarding: { creatorSessionInfo: () => session } },
    document: { addEventListener(type, fn) { assert.equal(type, 'hobunji-creator-session'); listener = fn; } },
    setTimeout(fn) { timers.push(fn); }, requestAnimationFrame() {}, frame() {}, lifeFrame() {}, installObservers() {}, startObservers() {},
    stopObservers() { stopCount++; }, teardown() { stopCount++; context.active = false; },
  });
  vm.runInContext(source.slice(start, end), context);
  listener({ detail: { phase: 'close' } });
  assert.equal(timers.length, 1);
  session = { mode: 'grooming', cosmeticsOnly: true };
  listener({ detail: { phase: 'open' } });
  timers.shift()();
  assert.equal(stopCount, 0, file + ': old close timeout cannot stop a new session');
  if (!file.includes('redesign')) assert.equal(context.active, true, file + ': reopened preview remains active');
  session = null;
  listener({ detail: { phase: 'close' } });
  timers.shift()();
  if (file.includes('camera-composition')) assert.equal(context.active, false, 'final close still disables camera composition');
  else assert.equal(stopCount, 1, file + ': final close still tears down observers/preview');
}
console.log('reopening grooming preserves all three preview owners: ok');
