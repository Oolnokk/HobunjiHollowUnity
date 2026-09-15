// Hobunji Save Coordinator — owns durable local commits before any external transport work.
// Gameplay still writes through the existing runtime/localStorage path; this layer snapshots that completed state into the sync envelope/store.
(() => {
  'use strict';

  if (window.HobunjiSaveCoordinator) return;

  const DEVICE_ID_KEY = 'hobunjiSaveDeviceId.v1'; // Reuses folder-save provenance identity so the migration does not make existing browsers appear to be new devices.
  const cachedStatus = {
    initialized: false,
    committing: false,
    lastCommitAt: null,
    lastContentHash: null,
    lastRevision: null,
    lastReason: null,
    lastError: null,
    storeSupported: false,
  }; // Synchronous mobile-readable status updated around async IndexedDB work.

  function snapshotApi() {
    return window.HobunjiSaveSnapshot || null;
  }

  function envelopeApi() {
    return window.HobunjiSaveEnvelope || null;
  }

  function storeApi() {
    return window.HobunjiSaveSyncStore || null;
  }

  function randomId() {
    const api = window.crypto; // Anonymous installation id source shared with the existing folder provenance layer.
    if (typeof api?.randomUUID === 'function') return api.randomUUID();
    const suffix = Math.random().toString(36).slice(2, 12); // Compatibility entropy used only when randomUUID is unavailable.
    return `device_${suffix}${Date.now().toString(36)}`;
  }

  function getWriterId() {
    try {
      let id = localStorage.getItem(DEVICE_ID_KEY); // Stable local-only writer identity used in save envelopes and same/different-device UI.
      if (!id) {
        id = randomId();
        localStorage.setItem(DEVICE_ID_KEY, id);
      }
      return id;
    } catch {
      return `ephemeral_${randomId()}`;
    }
  }

  function dependencies() {
    const snapshot = snapshotApi(); // Existing browser-save adapter that defines the canonical gameplay state boundary.
    const envelope = envelopeApi(); // Transport-neutral envelope/hash implementation loaded before this coordinator.
    const store = storeApi(); // IndexedDB durable authority/queue implementation loaded before this coordinator.
    if (!snapshot?.capture || !envelope?.create || !envelope?.contentHash || !store?.commitEnvelope) {
      throw new Error('Save coordinator dependencies are unavailable.');
    }
    return { snapshot, envelope, store };
  }

  async function appendEvent(type, details) {
    try { await storeApi()?.appendEvent?.(type, details); } catch {}
  }

  async function commitCurrent({ reason = 'save', pendingTargets = [] } = {}) {
    if (cachedStatus.committing) return { ok: false, busy: true, error: 'A durable save commit is already in progress.' };
    cachedStatus.committing = true;
    cachedStatus.lastError = null;
    cachedStatus.lastReason = String(reason || 'save');

    try {
      const { snapshot, envelope, store } = dependencies(); // Resolved once per commit so failures are reported before any durable state changes.
      cachedStatus.storeSupported = !!store.isSupported?.();
      if (!cachedStatus.storeSupported) {
        const error = 'IndexedDB save sync storage is unavailable.'; // Explicit unsupported result lets callers preserve legacy browser/folder behavior if necessary.
        cachedStatus.lastError = error;
        return { ok: false, unavailable: true, error };
      }

      const captured = snapshot.capture({ strict: true }); // Fully validated localStorage snapshot taken only after runtime gameplay state has been flushed there.
      const capturedHash = await envelope.contentHash(captured); // Content identity used to avoid manufacturing revisions when the gameplay state has not changed.
      const current = await store.getCurrentEnvelope(); // Prior durable authority supplies save-set identity and revision ancestry.
      let nextEnvelope = current; // Reused when this commit contains no gameplay change; pending transport markers can still be refreshed atomically.
      let changed = !current || current.contentHash !== capturedHash; // Controls whether a new app-level revision is created.

      if (changed) {
        nextEnvelope = await envelope.create(captured, {
          parentEnvelope: current || null,
          writerId: getWriterId(),
        });
      }

      if (!nextEnvelope) {
        nextEnvelope = await envelope.create(captured, { writerId: getWriterId() });
        changed = true;
      }

      await store.commitEnvelope(nextEnvelope, { pendingTargets }); // Atomic local authority + queue update is the point at which this save becomes durable for sync purposes.
      cachedStatus.lastCommitAt = Date.now();
      cachedStatus.lastContentHash = nextEnvelope.contentHash;
      cachedStatus.lastRevision = nextEnvelope.revision;
      cachedStatus.lastError = null;
      await appendEvent('LOCAL COMMIT', {
        reason: cachedStatus.lastReason,
        changed,
        revision: nextEnvelope.revision,
        contentHash: nextEnvelope.contentHash,
        pendingTargets: [...pendingTargets],
      });
      return { ok: true, changed, envelope: nextEnvelope };
    } catch (error) {
      const message = String(error?.message || error); // Mobile-visible failure returned to quit/creator guards without requiring console access.
      cachedStatus.lastError = message;
      await appendEvent('LOCAL COMMIT ERROR', { reason: cachedStatus.lastReason, error: message });
      return { ok: false, error: message };
    } finally {
      cachedStatus.committing = false;
    }
  }

  async function hydrateStatus() {
    const store = storeApi(); // Store queried once after load so diagnostics can show a prior-session durable commit before the next save occurs.
    cachedStatus.storeSupported = !!store?.isSupported?.();
    if (!cachedStatus.storeSupported) {
      cachedStatus.initialized = true;
      return;
    }
    try {
      const current = await store.getCurrentEnvelope(); // Existing durable authority restored into the synchronous status cache.
      const diagnostics = await store.diagnostics?.('drive'); // Prior durable commit time read from the same store for mobile diagnostics.
      cachedStatus.lastContentHash = current?.contentHash || null;
      cachedStatus.lastRevision = current?.revision || null;
      cachedStatus.lastCommitAt = diagnostics?.lastCommitAt || null;
    } catch (error) {
      cachedStatus.lastError = String(error?.message || error);
    }
    cachedStatus.initialized = true;
  }

  function getStatus() {
    return { ...cachedStatus };
  }

  window.HobunjiSaveCoordinator = Object.freeze({
    getWriterId,
    commitCurrent,
    getStatus,
  });

  hydrateStatus();
})();
