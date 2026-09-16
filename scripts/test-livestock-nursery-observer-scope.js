'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/livestock-nursery-observer-scope.js', 'utf8');
const bridgeSource = fs.readFileSync('docs/js/livestock-nursery-install-bridge.js', 'utf8');

const body = { id: 'body' };
const livestockList = { id: 'farmLivestockList' };
const buildingsList = { id: 'farmBuildingsList' };
const observed = [];

class FakeMutationObserver {
  constructor(callback) {
    this.callback = callback;
    this.disconnectCount = 0;
  }
  observe(target, options) {
    observed.push({ observer: this, target, options });
  }
  disconnect() {
    this.disconnectCount++;
  }
}

const context = {
  console,
  Error,
  document: {
    body,
    getElementById(id) {
      if (id === 'farmLivestockList') return livestockList;
      if (id === 'farmBuildingsList') return buildingsList;
      return null;
    },
  },
  MutationObserver: FakeMutationObserver,
};
context.window = context;
vm.createContext(context);
vm.runInContext(source, context, { filename: 'livestock-nursery-observer-scope.js' });

vm.runInContext(`
  globalThis.__nurseryObserver = new MutationObserver(() => {});
  globalThis.__nurseryObserver.observe(document.body, { childList: true, subtree: true });
`, context, { filename: 'livestock-nursery.js' });

const nurseryObserver = context.__nurseryObserver;
const nurseryCalls = observed.filter(call => call.observer === nurseryObserver);
assert.deepEqual(nurseryCalls.map(call => call.target.id), ['farmLivestockList', 'farmBuildingsList'], 'legacy Nursery observer is redirected from document.body to its two Farm lists');
assert(nurseryCalls.every(call => call.options.childList === true && call.options.subtree === true), 'scoped Nursery observer keeps the structural mutation contract it needs');
assert.equal(nurseryCalls.some(call => call.target === body), false, 'legacy Nursery observer never remains body-wide when Farm targets exist');

observed.length = 0;
nurseryObserver.disconnect();
vm.runInContext(`
  globalThis.__nurseryObserver.observe(document.body, { childList: true, subtree: true });
`, context, { filename: 'some-reconnect.js' });
assert.deepEqual(observed.filter(call => call.observer === nurseryObserver).map(call => call.target.id), ['farmLivestockList', 'farmBuildingsList'], 'remembered Nursery observer stays scoped after disconnect/reconnect without another stack match');

observed.length = 0;
vm.runInContext(`
  globalThis.__otherObserver = new MutationObserver(() => {});
  globalThis.__otherObserver.observe(document.body, { childList: true, subtree: true });
`, context, { filename: 'other-module.js' });
const otherCalls = observed.filter(call => call.observer === context.__otherObserver);
assert.equal(otherCalls.length, 1, 'unrelated MutationObserver observe call is not duplicated');
assert.strictEqual(otherCalls[0].target, body, 'unrelated body observer keeps its original target');

const debug = context.__livestockNurseryObserverScopeDebug.snapshot();
assert.equal(debug.installed, true, 'observer-scope guard reports installed');
assert.equal(debug.nurseryObserverIdentified, true, 'observer-scope guard identified the legacy Nursery observer');
assert.equal(debug.interceptedObserveCalls, 2, 'initial observe and reconnect were both redirected');
assert.equal(debug.fallbackBodyObserveCalls, 0, 'normal Farm DOM availability never falls back to document.body');

const scopeIndex = bridgeSource.indexOf("globalKey: 'LivestockNurseryObserverScope'");
const growthIndex = bridgeSource.indexOf("globalKey: 'ANIMAL_GROWTH_CONFIG'");
assert(scopeIndex >= 0 && growthIndex >= 0 && scopeIndex < growthIndex, 'observer scope parser-loads before later farm feature modules and therefore before legacy Nursery installation');

console.log('livestock nursery observer scope regression checks passed');
