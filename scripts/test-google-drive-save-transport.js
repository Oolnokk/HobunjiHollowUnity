'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { TextEncoder } = require('util');
const { webcrypto } = require('crypto');

const root = path.resolve(__dirname, '..'); // Resolves production persistence modules from this regression script.
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8'); // Loads browser modules verbatim for isolated transport tests.

function makeStorage(meta) {
  const values = new Map([['hobunjiSaveMeta', JSON.stringify(meta)]]); // Browser save state captured by the production snapshot/coordinator modules.
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    key(index) { return [...values.keys()][index] ?? null; },
    get length() { return values.size; },
  };
}

function metaWithBerry(value) {
  return {
    version: 1,
    characters: [{ id: 'char-a', nickname: 'Tester', inventory: { berry: value } }],
    worlds: [{ id: 'world-a', label: 'Hollow' }],
  };
}

function response({ status = 200, json = null, text = null } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    async json() { return typeof json === 'function' ? json() : json; },
    async text() {
      if (typeof text === 'function') return text();
      if (text != null) return String(text);
      return json == null ? '' : JSON.stringify(typeof json === 'function' ? json() : json);
    },
  }; // Minimal Fetch Response shape used by the production transport.
}

async function main() {
  const localStorage = makeStorage(metaWithBerry(1)); // Initial local save A used as the first common Drive baseline.
  const memory = new Map(); // Injected durable sync store avoids IndexedDB in Node while preserving production semantics.
  const requestedScopes = []; // Records OAuth scopes requested by the transport; only drive.file is acceptable.
  const requests = []; // Captures Drive REST methods/URLs to prove file-id reuse and no duplicate creates during sync.
  let tokenRequests = 0; // Counts explicit GIS-equivalent token requests from user actions.
  let remoteEnvelope = null; // Mutable fake Drive file contents returned by media downloads and replaced by PATCH uploads.
  let remoteVersion = 3; // Monotonic fake Drive version advanced on each in-place update.

  const hooks = {
    async requestAccessToken({ scope }) {
      requestedScopes.push(scope);
      tokenRequests++;
      return { access_token: `memory-token-${tokenRequests}`, expires_in: 3600 };
    },
    async pickFile() { return { id: 'drive-file-123', name: 'hobunji-primary-save.json' }; },
    async fetch(url, options = {}) {
      const method = String(options.method || 'GET').toUpperCase(); // Request method captured for assertions below.
      requests.push({ url: String(url), method, authorization: options.headers?.get?.('Authorization') || null });
      const isMediaDownload = String(url).includes('alt=media');
      const isUpload = String(url).includes('/upload/drive/v3/files/drive-file-123');

      if (method === 'PATCH' && isUpload) {
        remoteEnvelope = JSON.parse(String(options.body)); // Simple media update body is the complete canonical envelope JSON.
        remoteVersion++;
        return response({ json: {
          id: 'drive-file-123',
          name: 'hobunji-primary-save.json',
          mimeType: 'application/json',
          parents: ['drive-folder-1'],
          version: String(remoteVersion),
          modifiedTime: `2026-09-15T14:0${remoteVersion}:00.000Z`,
          size: String(options.body?.length || 0),
          trashed: false,
        } });
      }

      if (method === 'GET' && isMediaDownload) {
        return response({ text: () => JSON.stringify(remoteEnvelope) });
      }

      if (method === 'GET') {
        return response({ json: {
          id: 'drive-file-123',
          name: 'hobunji-primary-save.json',
          mimeType: 'application/json',
          parents: ['drive-folder-1'],
          version: String(remoteVersion),
          modifiedTime: `2026-09-15T14:0${remoteVersion}:00.000Z`,
          size: String(JSON.stringify(remoteEnvelope || {}).length),
          trashed: false,
        } });
      }

      throw new Error(`Unexpected mock Drive request: ${method} ${url}`);
    },
  }; // Test hooks replace only external Google/network surfaces; envelope/reconciliation/store/coordinator logic remains production code.

  const window = {
    crypto: webcrypto,
    Headers,
    Blob,
    fetch: hooks.fetch,
    __hobunjiSaveSyncMemoryStorage: memory,
    __hobunjiGoogleDriveSaveTestHooks: hooks,
    HOBUNJI_GOOGLE_DRIVE_SAVE_CONFIG: {
      clientId: 'public-client-id.apps.googleusercontent.com',
      apiKey: 'public-browser-key',
      appId: '123456789012',
    },
  }; // Browser globals plus non-secret public Google test configuration.
  window.window = window;
  const context = vm.createContext({ window, localStorage, TextEncoder, console, Map, Math, Date, URLSearchParams, Headers, Blob }); // Production transport execution context.

  for (const file of [
    'docs/js/save-snapshot-core.js',
    'docs/js/save-sync-envelope.js',
    'docs/js/save-reconciliation.js',
    'docs/js/save-sync-store.js',
    'docs/js/save-coordinator.js',
    'docs/js/google-drive-save-config.js',
    'docs/js/google-drive-save-transport.js',
  ]) vm.runInContext(read(file), context, { filename: path.basename(file) });

  const coordinator = window.HobunjiSaveCoordinator; // Production durable local commit orchestrator.
  const store = window.HobunjiSaveSyncStore; // Production pending/baseline/link/conflict store.
  const drive = window.HobunjiGoogleDriveSave; // Production Drive transport under test.
  const envelopeApi = window.HobunjiSaveEnvelope; // Production envelope helper used to seed fake remote Drive content.

  const baselineCommit = await coordinator.commitCurrent({ reason: 'test-baseline' });
  assert.equal(baselineCommit.ok, true);
  remoteEnvelope = baselineCommit.envelope; // Drive initially contains the exact same A state as local.

  const linked = await drive.linkExistingFile();
  assert.equal(linked.ok, true, 'existing canonical Drive file links through Picker');
  assert.deepEqual(requestedScopes, ['https://www.googleapis.com/auth/drive.file'], 'transport requests only the narrow drive.file OAuth scope');
  assert.equal(linked.link.fileId, 'drive-file-123', 'linked Drive file id becomes the stable remote identity');
  const persistedLink = await store.getLink('drive');
  assert.equal(persistedLink.fileId, 'drive-file-123', 'non-secret Drive file id persists across sessions');
  assert.equal(Object.prototype.hasOwnProperty.call(persistedLink, 'accessToken'), false, 'OAuth access token is never persisted with Drive link metadata');
  assert.ok(requests.every(entry => entry.authorization === 'Bearer memory-token-1'), 'Drive REST requests use the memory-only bearer token');

  // First explicit sync of identical content establishes a last-common baseline
  // without rewriting Drive or manufacturing a duplicate file.
  const currentResult = await drive.syncPending({ interactive: true });
  assert.equal(currentResult.ok, true);
  assert.equal(currentResult.decision.state, 'identical', 'identical first link establishes a safe common baseline');
  assert.equal((await store.getBaseline('drive')).contentHash, baselineCommit.envelope.contentHash, 'identical Drive/local state becomes the remembered common baseline');
  assert.equal(requests.filter(entry => entry.method === 'PATCH').length, 0, 'identical sync performs no Drive write');

  // Local changes B while Drive remains A: queued save preflights remote A, then
  // PATCHes the same file id and read-back verifies B before clearing pending.
  localStorage.setItem('hobunjiSaveMeta', JSON.stringify(metaWithBerry(2)));
  const localB = await coordinator.commitCurrent({ reason: 'test-local-b', pendingTargets: ['drive'] });
  const pushed = await drive.syncPending({ interactive: true });
  assert.equal(pushed.ok, true);
  assert.equal(pushed.pushed, true);
  assert.equal(pushed.decision.state, 'local-only-change', 'local-only branch movement is safe to upload');
  assert.equal(remoteEnvelope.contentHash, localB.envelope.contentHash, 'Drive media is replaced with the queued local envelope');
  assert.equal(requests.filter(entry => entry.method === 'PATCH').length, 1, 'local-only sync performs one in-place PATCH');
  assert.ok(requests.find(entry => entry.method === 'PATCH').url.includes('/files/drive-file-123'), 'Drive update targets the remembered file id instead of creating a duplicate');
  assert.equal(await store.getPending('drive'), null, 'verified Drive upload clears the matching pending marker');
  assert.equal((await store.getBaseline('drive')).contentHash, localB.envelope.contentHash, 'verified upload advances the last-common baseline');

  // Token expiry/background operation: pending local state must remain queued and
  // the transport must not summon an interactive auth flow by itself.
  localStorage.setItem('hobunjiSaveMeta', JSON.stringify(metaWithBerry(3)));
  const localC = await coordinator.commitCurrent({ reason: 'test-local-c', pendingTargets: ['drive'] });
  drive.forgetAccessToken();
  const tokenRequestsBeforeBackground = tokenRequests;
  await assert.rejects(() => drive.syncPending({ interactive: false }), error => error?.authRequired === true, 'background sync without a valid memory token reports auth-required');
  assert.equal(tokenRequests, tokenRequestsBeforeBackground, 'background sync never triggers the interactive Google token flow');
  assert.equal((await store.getPending('drive')).envelope.contentHash, localC.envelope.contentHash, 'auth-required background sync keeps the local save queued');

  // Divergent edit: remote D and local C both moved from baseline B. Reauthorize,
  // preflight Drive, preserve both branches, and never PATCH either one away.
  const remoteMetaD = metaWithBerry(44); // Independent Drive-side gameplay change simulating another device/Drive-for-Desktop writer.
  const remoteD = await envelopeApi.create({ snapshotVersion: 1, meta: remoteMetaD, farmLayouts: {} }, {
    parentEnvelope: localB.envelope,
    writerId: 'other-device',
    writtenAt: 9000,
  });
  remoteEnvelope = remoteD;
  remoteVersion++;
  const patchesBeforeConflict = requests.filter(entry => entry.method === 'PATCH').length;
  const conflict = await drive.syncPending({ interactive: true });
  assert.equal(conflict.conflict, true, 'divergent local and Drive changes become an explicit conflict');
  assert.equal(conflict.decision.state, 'conflict');
  assert.equal(requests.filter(entry => entry.method === 'PATCH').length, patchesBeforeConflict, 'conflict detection never overwrites Drive');
  const preserved = await store.getConflict('drive');
  assert.equal(preserved.local.contentHash, localC.envelope.contentHash, 'conflict record preserves local branch');
  assert.equal(preserved.external.contentHash, remoteD.contentHash, 'conflict record preserves Drive branch');

  console.log('Google Drive save transport regression checks passed.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
