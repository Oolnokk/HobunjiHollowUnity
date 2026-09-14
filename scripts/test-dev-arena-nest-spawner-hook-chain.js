#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../docs/js/dev-arena-nest-spawner.js'), 'utf8');

let storedDevSpawner = null;
let previousSetterCalls = 0;
let handRuntimeDeps = null;
let baseInitCalls = 0;

const documentStub = {
  readyState: 'loading',
  getElementById() { return null; },
  createElement() { throw new Error('DOM controls should not be created during parser-time hook test'); },
  addEventListener() {},
};

const windowStub = {
  document: documentStub,
  SCRATCHBONES_CONFIG: { game: { livestock: { itemKinds: {} }, wildlife: { denMothers: {} } } },
  __farmLog() {},
};

// This models the pre-existing DevSpawner assignment chain that owns gameplay
// runtime dependencies before the nest test-spawner module loads. In the game,
// PlayerBodyAttachmentBridge participates in this chain and forwards the same
// injected deps to ProceduralHandAttachments.installGameRuntime().
Object.defineProperty(windowStub, 'DevSpawner', {
  configurable: true,
  enumerable: true,
  get() { return storedDevSpawner; },
  set(value) {
    previousSetterCalls++;
    storedDevSpawner = value;
    if (!value?.init || value.__testHandRuntimeHook) return;
    const originalInit = value.init;
    value.init = function existingHandRuntimeInit(injectedDeps) {
      handRuntimeDeps = injectedDeps;
      return originalInit.call(this, injectedDeps);
    };
    value.__testHandRuntimeHook = true;
  },
});

const context = {
  window: windowStub,
  document: documentStub,
  queueMicrotask,
  console,
  Object,
  Array,
  Math,
  Number,
  String,
  RegExp,
  Map,
  Set,
  WeakMap,
};
windowStub.window = windowStub;
vm.createContext(context);
vm.runInContext(source, context, { filename: 'dev-arena-nest-spawner.js' });

assert.equal(windowStub.DevArenaNestSpawner.version, 2,
  'reviewed test-spawner version should be installed');

const descriptorAfterNestModule = Object.getOwnPropertyDescriptor(windowStub, 'DevSpawner');
assert.equal(typeof descriptorAfterNestModule?.set, 'function',
  'nest spawner keeps DevSpawner as a late-assignment accessor');

windowStub.DevSpawner = {
  init(injectedDeps) {
    baseInitCalls++;
    return injectedDeps;
  },
  toggle() { return true; },
};

assert.equal(previousSetterCalls, 1,
  'nest spawner must invoke the pre-existing DevSpawner setter instead of replacing it');
assert.equal(windowStub.DevSpawner.__testHandRuntimeHook, true,
  'the prior hand-runtime init wrapper must survive DevArenaNestSpawner patching');
assert.equal(windowStub.DevSpawner.__devArenaNestSpawnerPatched, true,
  'the nest spawner must still add its own DevSpawner behavior');

const deps = { toolHolder: { name: 'player_tool_holder' }, playerMesh: { name: 'player_mesh' } };
const result = windowStub.DevSpawner.init(deps);
assert.equal(result, deps, 'wrapped DevSpawner.init preserves the original return value');
assert.equal(baseInitCalls, 1, 'base DevSpawner.init runs exactly once');
assert.equal(handRuntimeDeps, deps,
  'pre-existing hand runtime receives the live toolHolder deps after nest-spawner chaining');
assert.equal(handRuntimeDeps.toolHolder.name, 'player_tool_holder',
  'toolHolder remains available to primary-grip hand ownership');

console.log('Dev Arena nest spawner preserves existing DevSpawner/hand-runtime hook chain.');
