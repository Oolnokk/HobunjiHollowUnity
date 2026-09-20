'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

// This module has no prior regression coverage. It's exercised here because
// its install-retry loop (previously a bespoke setInterval/attempt-counter
// pair) was migrated onto the shared SceneReadyPoller alongside
// clothing-weaving-system.js's identical pattern -- this proves the
// migration preserves the original "retry until FarmAnimals installs, or
// give up after ~10s" behavior.

let storage = {};
const localStorageStub = {
  getItem: key => (key in storage ? storage[key] : null),
  setItem: (key, value) => { storage[key] = String(value); },
};

let now = 1000;
const listeners = {};
const documentStub = {
  documentElement: {},
  getElementById() { return null; },
  querySelectorAll() { return []; },
  addEventListener(type, fn) { listeners[type] = fn; },
};

const timeoutQueue = []; // Captures window.setTimeout calls so the retry can be stepped deterministically.
const windowStub = {
  FarmAnimals: null, // Installed mid-retry below to simulate the real boot-order race.
  setTimeout: (fn, ms) => { timeoutQueue.push({ fn, ms }); return timeoutQueue.length; },
  setInterval() { return 1; },
};

const context = vm.createContext({
  window: windowStub,
  document: documentStub,
  localStorage: localStorageStub,
  performance: { now: () => now },
  MutationObserver: class { observe() {} },
  Node: { ELEMENT_NODE: 1 },
  URL,
  console,
});
vm.runInContext(fs.readFileSync('docs/js/scene-ready-poller.js', 'utf8'), context, { filename: 'scene-ready-poller.js' });
vm.runInContext(fs.readFileSync('docs/js/livestock-item-genotype-persistence.js', 'utf8'), context, { filename: 'livestock-item-genotype-persistence.js' });

const api = windowStub.LivestockItemGenotypePersistence;
assert(api, 'LivestockItemGenotypePersistence exported');
assert.equal(api.getDebug().installed, false, 'does not install while FarmAnimals is absent');

function flushOneTimeout() {
  const next = timeoutQueue.shift();
  if (next) next.fn();
  return !!next;
}

assert.equal(timeoutQueue.length, 1, 'a not-ready boot queues a retry instead of giving up silently');
assert(flushOneTimeout(), 'first retry fires');
assert.equal(timeoutQueue.length, 1, 'still not ready: queues another retry');
assert(flushOneTimeout(), 'second retry fires');
assert.equal(timeoutQueue.length, 1, 'still not ready after two retries: keeps retrying');

windowStub.FarmAnimals = { // Becomes available mid-retry, matching the real script-order race.
  queueItemGenotype() {},
  addFromItem() {},
  addToStable() {},
};
assert(flushOneTimeout(), 'third retry fires');
assert.equal(api.getDebug().installed, true, 'installs as soon as FarmAnimals is available');
assert.equal(timeoutQueue.length, 0, 'no further retry is queued once installed');

// The give-up timeout is honored too: a FarmAnimals that never shows up
// stops retrying once INSTALL_RETRY_TIMEOUT_MS has elapsed.
storage = {};
timeoutQueue.length = 0;
now = 1000;
const context2 = vm.createContext({
  window: { FarmAnimals: null, setTimeout: (fn, ms) => { timeoutQueue.push({ fn, ms }); return timeoutQueue.length; }, setInterval() { return 1; } },
  document: documentStub,
  localStorage: localStorageStub,
  performance: { now: () => now },
  MutationObserver: class { observe() {} },
  Node: { ELEMENT_NODE: 1 },
  URL,
  console,
});
vm.runInContext(fs.readFileSync('docs/js/scene-ready-poller.js', 'utf8'), context2, { filename: 'scene-ready-poller.js' });
vm.runInContext(fs.readFileSync('docs/js/livestock-item-genotype-persistence.js', 'utf8'), context2, { filename: 'livestock-item-genotype-persistence.js' });
assert.equal(timeoutQueue.length, 1, 'second fixture also queues an initial retry');
now = 20000; // Past the ~10s cap.
assert(flushOneTimeout(), 'a retry past the timeout still fires once to observe the deadline');
assert.equal(timeoutQueue.length, 0, 'no further retry is queued once the timeout has elapsed');

console.log('livestock item genotype persistence tests passed');
