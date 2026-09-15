'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { TextEncoder } = require('util');
const { webcrypto } = require('crypto');

const root = path.resolve(__dirname, '..'); // Resolves production browser modules from this regression script.
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8'); // Loads unmodified production source into the VM.

function makeSnapshot(value = 1) {
  return {
    snapshotVersion: 1,
    meta: {
      version: 1,
      characters: [{ id: 'char-a', nickname: 'Tester', inventory: { berry: value } }],
      worlds: [{ id: 'world-a', label: 'Hollow' }],
    },
    farmLayouts: {},
  };
}

async function main() {
  const memory = new Map(); // Injected backend lets the regression exercise store semantics without a browser IndexedDB implementation.
  const window = { crypto: webcrypto, __hobunjiSaveSyncMemoryStorage: memory }; // Browser-global state consumed by production modules.
  const context = vm.createContext({ window, TextEncoder, console, Map }); // VM context exposes only APIs the tested modules require.
  window.window = window;

  vm.runInContext(read('docs/js/save-sync-envelope.js'), context, { filename: 'save-sync-envelope.js' });
  vm.runInContext(read('docs/js/save-sync-store.js'), context, { filename: 'save-sync-store.js' });

  const envelopeApi = window.HobunjiSaveEnvelope; // Creates real production envelopes for durable-store tests.
  const store = window.HobunjiSaveSyncStore; // Production store API exercised through the injected transactional memory backend.
  const envelopeA = await envelopeApi.create(makeSnapshot(1), {
    saveSetId: 'save-set-a', revision: 1, writerId: 'device-a', writtenAt: 1000,
  }); // First local authority queued for Drive below.

  await store.commitEnvelope(envelopeA, { pendingTargets: ['drive'] });
  assert.equal((await store.getCurrentEnvelope()).contentHash, envelopeA.contentHash, 'local commit stores the current envelope');
  assert.equal((await store.getPending('drive')).envelope.contentHash, envelopeA.contentHash, 'same local commit queues the exact envelope for Drive');

  const envelopeB = await envelopeApi.create(makeSnapshot(2), {
    parentEnvelope: envelopeA, writerId: 'device-a', writtenAt: 2000,
  }); // Newer save used to prove an older upload cannot clear its pending marker.
  await store.commitEnvelope(envelopeB, { pendingTargets: ['drive'] });
  assert.equal(await store.clearPending('drive', { expectedContentHash: envelopeA.contentHash }), false, 'older upload cannot clear a newer pending save');
  assert.equal((await store.getPending('drive')).envelope.contentHash, envelopeB.contentHash, 'newer pending envelope survives stale completion');
  assert.equal(await store.clearPending('drive', { expectedContentHash: envelopeB.contentHash }), true, 'matching upload completion clears its pending marker');
  assert.equal(await store.getPending('drive'), null, 'cleared pending marker is removed without deleting current local state');
  assert.equal((await store.getCurrentEnvelope()).contentHash, envelopeB.contentHash, 'clearing transport queue never deletes the current envelope');

  await store.setBaseline('drive', envelopeA);
  assert.equal((await store.getBaseline('drive')).contentHash, envelopeA.contentHash, 'last-common baseline retains the known shared hash');

  await store.setLink('drive', { fileId: 'file-123', folderId: 'folder-456', version: '9' });
  assert.deepEqual(await store.getLink('drive'), { fileId: 'file-123', folderId: 'folder-456', version: '9' }, 'Drive link persists only non-secret file identity');
  await assert.rejects(() => store.setLink('drive', { fileId: 'file-123', accessToken: 'secret' }), /must not be persisted/i, 'OAuth access tokens are rejected from durable link state');

  await store.setConflict('drive', { local: envelopeB, external: envelopeA, detectedAt: 3000 });
  assert.equal((await store.getConflict('drive')).local.contentHash, envelopeB.contentHash, 'conflict state preserves the local branch');
  assert.equal((await store.getConflict('drive')).external.contentHash, envelopeA.contentHash, 'conflict state preserves the external branch');

  for (let index = 0; index < 90; index++) await store.appendEvent('test', { index });
  const events = await store.getEvents(); // Bounded trace proves diagnostics cannot grow without limit.
  assert.equal(events.length, 80, 'event trace remains bounded');
  assert.equal(events[0].details.index, 10, 'event trace drops the oldest entries first');

  const diagnostics = await store.diagnostics('drive'); // Mobile-facing summary should expose hashes/status without storing OAuth secrets.
  assert.equal(diagnostics.currentHash, envelopeB.contentHash);
  assert.equal(diagnostics.baselineHash, envelopeA.contentHash);
  assert.equal(diagnostics.link.fileId, 'file-123');
  assert.equal(diagnostics.conflict, true);

  console.log('Save sync store regression checks passed.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
