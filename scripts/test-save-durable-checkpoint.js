'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'docs/js/save-durable-checkpoint.js'), 'utf8');

class StorageMock {
  constructor() { this.values = new Map(); }
  setItem(key, value) { this.values.set(String(key), String(value)); }
  getItem(key) { return this.values.has(String(key)) ? this.values.get(String(key)) : null; }
  removeItem(key) { this.values.delete(String(key)); }
}

async function drain() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise(resolve => setImmediate(resolve));
}

async function main() {
  const localStorage = new StorageMock();
  const timers = new Map();
  let nextTimerId = 1;
  const coordinatorCalls = [];
  const driveSyncCalls = [];
  let linked = true;
  let tokenPresent = false;
  let gameStarted = true;

  const document = {
    visibilityState: 'visible',
    addEventListener() {},
  };
  const window = {
    Storage: StorageMock,
    localStorage,
    __hobunjiGameStarted: gameStarted,
    HobunjiSessionPersistenceStartupGuard: { isHydrated: () => gameStarted },
    HobunjiGoogleDriveSave: {
      getStatus() { return { linked, tokenPresent, busyOperation: null }; },
      async syncPending(options) { driveSyncCalls.push(options); return { ok: true }; },
    },
    HobunjiSaveCoordinator: {
      async commitCurrent(options) { coordinatorCalls.push(options); return { ok: true, changed: true }; },
    },
    HobunjiSaveSyncStore: { async appendEvent() {} },
  };

  const context = vm.createContext({
    console,
    window,
    document,
    navigator: { onLine: true },
    setTimeout(fn) { const id = nextTimerId++; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  vm.runInContext(source, context, { filename: 'save-durable-checkpoint.js' });

  assert.equal(context.window.__hobunjiSaveCheckpointDebug.snapshot().storageHookInstalled, true, 'native Storage write hook installs once');
  localStorage.setItem('unrelatedSetting', '1');
  assert.equal(timers.size, 0, 'unrelated localStorage writes do not schedule durable save work');

  localStorage.setItem('hobunjiSaveMeta', '{"characters":[],"worlds":[]}');
  assert.equal(timers.size, 1, 'canonical save metadata write schedules one debounced durable checkpoint');
  const firstTimer = [...timers.values()][0];
  timers.clear();
  firstTimer();
  await drain();
  assert.equal(coordinatorCalls.length, 1, 'metadata save produces one durable coordinator commit');
  assert.deepEqual(coordinatorCalls[0].pendingTargets, ['drive'], 'linked Drive is queued atomically with routine durable gameplay saves');
  assert.equal(driveSyncCalls.length, 0, 'routine save never attempts Google network work without an already-held access token');

  tokenPresent = true;
  localStorage.setItem('hobunji_farm_layout_v3:world-a', '{"tiles":[]}');
  const secondTimer = [...timers.values()][0];
  timers.clear();
  secondTimer();
  await drain();
  assert.equal(coordinatorCalls.length, 2, 'farm-layout writes use the same durable save checkpoint path');
  assert.deepEqual(driveSyncCalls, [{ interactive: false }], 'already-authorized Drive may sync opportunistically only after the durable local commit');

  linked = false;
  tokenPresent = false;
  localStorage.setItem('hobunjiSaveMeta', '{"characters":[{"id":"c"}],"worlds":[]}');
  const thirdTimer = [...timers.values()][0];
  timers.clear();
  thirdTimer();
  await drain();
  assert.deepEqual(coordinatorCalls[2].pendingTargets, [], 'unlinked browsers commit durable gameplay saves without manufacturing a Drive queue');

  gameStarted = false;
  window.__hobunjiGameStarted = false;
  localStorage.setItem('hobunjiSaveMeta', '{"characters":[],"worlds":[]}');
  assert.equal(timers.size, 0, 'pre-game/onboarding storage writes are ignored by the routine checkpoint hook');

  const debug = context.window.__hobunjiSaveCheckpointDebug.snapshot();
  assert.equal(debug.detectedWrites, 3, 'debug counters expose only hydrated relevant save writes');
  assert.equal(debug.durableCommits, 3, 'mobile diagnostics expose successful routine durable commits');
  assert.equal(debug.queuedDriveCommits, 2, 'mobile diagnostics expose routine saves queued for Drive');
  console.log('OK  event-driven durable checkpoints cover routine meta/layout saves without polling or forced OAuth');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
