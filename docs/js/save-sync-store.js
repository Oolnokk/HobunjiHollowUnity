// Hobunji Save Sync Store — durable local authority and transport queue state.
// A gameplay envelope and its pending transport markers are committed together so network failure cannot erase a completed local save.
(() => {
  'use strict';

  if (window.HobunjiSaveSyncStore) return;

  const DB_NAME = 'hobunji-save-sync'; // IndexedDB database dedicated to transport-neutral save coordination state.
  const DB_VERSION = 1; // Schema version for the single key/value state store.
  const STORE_NAME = 'state'; // Key/value object store containing the current envelope, baselines, links, conflicts, and event trace.
  const CURRENT_KEY = 'current-envelope'; // Durable latest gameplay envelope used as the local source of truth.
  const EVENTS_KEY = 'events'; // Bounded mobile-readable event trace for persistence diagnostics.
  const EVENT_LIMIT = 80; // Prevents diagnostics from growing without bound across long sessions.
  const injectedMemory = window.__hobunjiSaveSyncMemoryStorage instanceof Map
    ? window.__hobunjiSaveSyncMemoryStorage
    : null; // Test/debug-only in-memory backend used when IndexedDB is intentionally unavailable.

  function envelopeApi() {
    return window.HobunjiSaveEnvelope || null;
  }

  function validateEnvelope(envelope) {
    const api = envelopeApi(); // Production envelope validator prevents malformed state from entering the durable queue.
    if (!api?.validateStructure) throw new Error('Save envelope API is unavailable.');
    return api.validateStructure(envelope);
  }

  function isSupported() {
    return Boolean(injectedMemory || typeof indexedDB !== 'undefined');
  }

  function openDb() {
    if (injectedMemory) return Promise.resolve(null);
    if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB is unavailable.'));
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION); // Database open request shared by each small transaction; browsers internally reuse the backing connection.
      request.onupgradeneeded = () => {
        const db = request.result; // Database being upgraded with the key/value state store.
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open save sync IndexedDB.'));
    });
  }

  function clone(value) {
    if (value == null) return value;
    return JSON.parse(JSON.stringify(value));
  }

  async function readKey(key) {
    if (injectedMemory) return clone(injectedMemory.has(key) ? injectedMemory.get(key) : null);
    const db = await openDb(); // IndexedDB connection used only for this readonly key lookup.
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly'); // Readonly transaction isolates this diagnostic/state lookup.
      const request = transaction.objectStore(STORE_NAME).get(key); // Key lookup request whose result is returned after cloning by IndexedDB.
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error || transaction.error || new Error(`Could not read sync state "${key}".`));
      transaction.oncomplete = () => db.close();
    });
  }

  async function writeBatch(entries = [], deleteKeys = []) {
    if (injectedMemory) {
      for (const [key, value] of entries) injectedMemory.set(key, clone(value));
      for (const key of deleteKeys) injectedMemory.delete(key);
      return;
    }
    const db = await openDb(); // IndexedDB connection hosting the atomic readwrite batch below.
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite'); // One transaction ensures current envelope and pending markers cannot diverge on crash.
      const store = transaction.objectStore(STORE_NAME); // Shared object store receiving every mutation in this atomic batch.
      for (const [key, value] of entries) store.put(value, key);
      for (const key of deleteKeys) store.delete(key);
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = () => {
        const error = transaction.error || new Error('Could not commit save sync state.'); // Transaction failure reported without partially acknowledging a local save.
        db.close();
        reject(error);
      };
      transaction.onabort = () => {
        const error = transaction.error || new Error('Save sync state transaction was aborted.'); // Aborted commit is treated as a failed local save boundary.
        db.close();
        reject(error);
      };
    });
  }

  async function deleteKeyIf(key, predicate) {
    if (injectedMemory) {
      const current = injectedMemory.has(key) ? clone(injectedMemory.get(key)) : null; // Test backend performs compare+delete synchronously, matching one IDB readwrite transaction.
      if (!predicate(current)) return false;
      injectedMemory.delete(key);
      return true;
    }

    const db = await openDb(); // One connection owns the read-and-conditional-delete transaction below.
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite'); // Same-store write transactions cannot interleave, so a newer queued save cannot appear between comparison and delete.
      const store = transaction.objectStore(STORE_NAME); // Pending marker is read and, when still expected, removed inside this one transaction.
      const request = store.get(key); // Current pending value observed under the transaction's serialization boundary.
      let deleted = false; // Returned only after the transaction commits successfully.

      request.onsuccess = () => {
        const current = request.result ?? null;
        if (!predicate(current)) return;
        store.delete(key);
        deleted = true;
      };
      request.onerror = () => transaction.abort();
      transaction.oncomplete = () => {
        db.close();
        resolve(deleted);
      };
      transaction.onerror = () => {
        const error = transaction.error || request.error || new Error(`Could not conditionally delete sync state "${key}".`);
        db.close();
        reject(error);
      };
      transaction.onabort = () => {
        const error = transaction.error || request.error || new Error(`Conditional sync-state delete for "${key}" was aborted.`);
        db.close();
        reject(error);
      };
    });
  }

  function pendingKey(target) {
    return `pending:${String(target || '')}`;
  }

  function baselineKey(target) {
    return `baseline:${String(target || '')}`;
  }

  function linkKey(target) {
    return `link:${String(target || '')}`;
  }

  function conflictKey(target) {
    return `conflict:${String(target || '')}`;
  }

  async function commitEnvelope(envelope, { pendingTargets = [] } = {}) {
    const validEnvelope = clone(validateEnvelope(envelope)); // Detached validated envelope written as the durable local authority.
    const queuedAt = Date.now(); // Queue timestamp used only for diagnostics/retry UX, never for conflict winner selection.
    const entries = [
      [CURRENT_KEY, validEnvelope],
      ['last-commit-at', queuedAt],
    ]; // Atomic batch always contains the latest completed local save.
    for (const target of [...new Set(pendingTargets.map(value => String(value)).filter(Boolean))]) {
      entries.push([pendingKey(target), { target, envelope: validEnvelope, queuedAt }]);
    }
    await writeBatch(entries);
    return validEnvelope;
  }

  async function getCurrentEnvelope() {
    return readKey(CURRENT_KEY);
  }

  async function getPending(target) {
    return readKey(pendingKey(target));
  }

  async function clearPending(target, { expectedContentHash = null } = {}) {
    const key = pendingKey(target); // Pending queue key removed only if it still describes the write the caller completed.
    if (!expectedContentHash) {
      await writeBatch([], [key]); // Explicit unconditional clears (unlink/pull) intentionally discard whichever pending marker currently exists.
      return true;
    }

    return deleteKeyIf(key, pending => {
      const currentHash = pending?.envelope?.contentHash || null; // Compare is evaluated inside the same readwrite transaction as deletion.
      return currentHash === expectedContentHash;
    }); // A newer autosave transaction cannot be deleted by completion of an older Drive upload.
  }

  async function setBaseline(target, envelope = null) {
    const validEnvelope = envelope ? clone(validateEnvelope(envelope)) : null; // Last-common envelope retained for three-way reconciliation and conflict recovery.
    if (!validEnvelope) {
      await writeBatch([], [baselineKey(target)]);
      return null;
    }
    const baseline = {
      contentHash: validEnvelope.contentHash,
      envelope: validEnvelope,
      recordedAt: Date.now(),
    }; // Baseline records exactly what both local and external sides were known to share.
    await writeBatch([[baselineKey(target), baseline]]);
    return baseline;
  }

  async function getBaseline(target) {
    return readKey(baselineKey(target));
  }

  async function setLink(target, link = null) {
    const key = linkKey(target); // Transport-specific link metadata such as Drive file/folder ids; OAuth tokens must never be placed here.
    if (link == null) {
      await writeBatch([], [key]);
      return null;
    }
    const safeLink = clone(link); // Detached link record prevents caller mutation from silently changing remembered transport identity.
    if ('accessToken' in safeLink || 'refreshToken' in safeLink || 'token' in safeLink) {
      throw new Error('OAuth tokens must not be persisted in the save sync store.');
    }
    await writeBatch([[key, safeLink]]);
    return safeLink;
  }

  async function getLink(target) {
    return readKey(linkKey(target));
  }

  async function setConflict(target, conflict = null) {
    const key = conflictKey(target); // Preserved conflict branch data keeps both sides recoverable until the player chooses a direction.
    if (conflict == null) {
      await writeBatch([], [key]);
      return null;
    }
    const safeConflict = clone(conflict); // Detached conflict record stored without mutating caller-owned diagnostic objects.
    await writeBatch([[key, safeConflict]]);
    return safeConflict;
  }

  async function getConflict(target) {
    return readKey(conflictKey(target));
  }

  async function appendEvent(type, details = {}) {
    const existing = await readKey(EVENTS_KEY); // Existing bounded trace extended with one new persistence lifecycle event.
    const events = Array.isArray(existing) ? existing : []; // Trace list normalized for older/corrupt diagnostic state.
    const event = { at: Date.now(), type: String(type || 'event'), details: clone(details) }; // Mobile-readable event record intentionally excludes implicit secrets/tokens.
    events.push(event);
    if (events.length > EVENT_LIMIT) events.splice(0, events.length - EVENT_LIMIT);
    await writeBatch([[EVENTS_KEY, events]]);
    return event;
  }

  async function getEvents() {
    const events = await readKey(EVENTS_KEY); // Bounded diagnostic trace returned newest-last for easy human reading.
    return Array.isArray(events) ? events : [];
  }

  async function diagnostics(target = 'drive') {
    const current = await getCurrentEnvelope(); // Latest local authority summarized for mobile diagnostics.
    const pending = await getPending(target); // Queued external write for the requested transport.
    const baseline = await getBaseline(target); // Last-common state used by three-way reconciliation.
    const link = await getLink(target); // Non-secret transport identity/link metadata.
    const conflict = await getConflict(target); // Preserved unresolved branch data, if any.
    const lastCommitAt = await readKey('last-commit-at'); // Most recent durable local commit time.
    return {
      supported: isSupported(),
      target,
      currentHash: current?.contentHash || null,
      currentRevision: current?.revision || null,
      pendingHash: pending?.envelope?.contentHash || null,
      pendingQueuedAt: pending?.queuedAt || null,
      baselineHash: baseline?.contentHash || null,
      linked: Boolean(link),
      link,
      conflict: Boolean(conflict),
      lastCommitAt: lastCommitAt || null,
    };
  }

  window.HobunjiSaveSyncStore = Object.freeze({
    isSupported,
    commitEnvelope,
    getCurrentEnvelope,
    getPending,
    clearPending,
    setBaseline,
    getBaseline,
    setLink,
    getLink,
    setConflict,
    getConflict,
    appendEvent,
    getEvents,
    diagnostics,
  });
})();
