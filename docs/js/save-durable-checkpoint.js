// Hobunji Durable Save Checkpoint — observes only canonical browser-save writes,
// debounces save bursts, commits them to IndexedDB, and queues linked Drive sync.
// No frame loop or blind polling is used.
(() => {
  'use strict';

  if (window.HobunjiSaveCheckpoint) return;

  const SAVE_META_KEY = 'hobunjiSaveMeta'; // Canonical character/world browser metadata whose successful writes indicate persisted gameplay changed.
  const FARM_LAYOUT_PREFIX = 'hobunji_farm_layout_v3:'; // Per-world physical farm snapshots included in the canonical portable save boundary.
  const DEBOUNCE_MS = 250; // Short coalescing window keeps related meta/layout writes in one durable envelope without delaying normal saves noticeably.

  let timer = null; // Pending debounce timer for a burst of localStorage save writes.
  let commitPromise = null; // Serializes checkpoint commits above the coordinator's own busy guard.
  let rerunRequested = false; // Records a save write that arrived while an async durable commit was already in progress.
  let detectedWrites = 0; // Mobile-visible count of relevant browser-save writes observed after gameplay hydration.
  let durableCommits = 0; // Mobile-visible successful IndexedDB checkpoint count.
  let queuedDriveCommits = 0; // Mobile-visible checkpoints that atomically queued the linked Drive target.
  let backgroundSyncAttempts = 0; // Count of opportunistic Drive sync attempts made only when a token already exists.
  let resolutionStops = 0; // Count of background Drive preflights that correctly stopped for remote/conflict resolution.
  let lastDetectedKey = null; // Most recent save key that scheduled a checkpoint.
  let lastCommitAt = null; // Informational time of latest completed durable checkpoint.
  let lastError = ''; // Latest checkpoint/background-sync error visible in mobile diagnostics.

  function relevantKey(key) {
    const value = String(key || '');
    return value === SAVE_META_KEY || value.startsWith(FARM_LAYOUT_PREFIX);
  }

  function gameplayHydrated() {
    if (window.__hobunjiGameStarted !== true) return false; // Creator/onboarding saves have their own explicit handoff; never snapshot transient pre-game state here.
    const guard = window.HobunjiSessionPersistenceStartupGuard; // Existing startup guard is the final authority when present.
    return typeof guard?.isHydrated === 'function' ? guard.isHydrated() : true;
  }

  function pendingTargets() {
    return window.HobunjiGoogleDriveSave?.getStatus?.().linked ? ['drive'] : []; // Queue identity only; no OAuth/network work occurs inside the local durable transaction.
  }

  async function maybeSyncDriveInBackground() {
    const drive = window.HobunjiGoogleDriveSave; // Existing transport performs mandatory remote preflight before any PATCH.
    const status = drive?.getStatus?.();
    if (!status?.linked || !status?.tokenPresent || status?.busyOperation) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

    backgroundSyncAttempts++;
    try {
      const result = await drive.syncPending({ interactive: false }); // Existing in-memory token only; this path must never summon Google UI or block local saving.
      if (result?.needsResolution || result?.conflict) resolutionStops++;
      lastError = '';
    } catch (error) {
      // Expired tokens/network errors leave the pending envelope intact. The
      // Settings/startup user gesture can authorize and retry later.
      lastError = String(error?.message || error);
    }
  }

  async function commitCheckpoint({ reason = 'browser-save-change' } = {}) {
    if (!gameplayHydrated()) return { ok: false, skipped: 'not-hydrated' };
    if (commitPromise) {
      rerunRequested = true;
      return commitPromise;
    }

    const coordinator = window.HobunjiSaveCoordinator; // Transport-neutral coordinator owns envelope hashing/revision creation and atomic pending-target updates.
    if (!coordinator?.commitCurrent) return { ok: false, error: 'Durable save coordinator is unavailable.' };

    commitPromise = (async () => {
      try {
        const targets = pendingTargets(); // Linked Drive marker committed in the same IDB transaction as the new local authority.
        const result = await coordinator.commitCurrent({ reason, pendingTargets: targets });
        if (!result?.ok) {
          if (result?.unavailable) return result; // localStorage remains the compatibility fallback on IndexedDB-unsupported browsers.
          throw new Error(result?.error || 'Durable gameplay checkpoint failed.');
        }
        durableCommits++;
        if (targets.includes('drive')) queuedDriveCommits++;
        lastCommitAt = Date.now();
        lastError = '';
        await maybeSyncDriveInBackground(); // Network is opportunistic and strictly after the durable local transaction succeeds.
        return result;
      } catch (error) {
        lastError = String(error?.message || error);
        try { await window.HobunjiSaveSyncStore?.appendEvent?.('DURABLE CHECKPOINT ERROR', { reason, error: lastError }); } catch {}
        return { ok: false, error: lastError };
      } finally {
        commitPromise = null;
        if (rerunRequested) {
          rerunRequested = false;
          scheduleCheckpoint('save-during-checkpoint', { immediate: true }); // A later localStorage write can never be lost merely because the prior IDB transaction was still running.
        }
      }
    })();
    return commitPromise;
  }

  function scheduleCheckpoint(reason = 'browser-save-change', { immediate = false } = {}) {
    if (!gameplayHydrated()) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      commitCheckpoint({ reason }).catch(() => {});
    }, immediate ? 0 : DEBOUNCE_MS);
  }

  function observeWrite(key) {
    if (!relevantKey(key) || !gameplayHydrated()) return;
    detectedWrites++;
    lastDetectedKey = String(key); // Diagnostic only; values/content are never copied into logs.
    scheduleCheckpoint(lastDetectedKey === SAVE_META_KEY ? 'save-meta-write' : 'farm-layout-write');
  }

  function installStorageHooks() {
    const StorageCtor = window.Storage; // Native Storage prototype is patched once so all direct localStorage save writers converge without touching dozens of gameplay modules.
    const proto = StorageCtor?.prototype;
    if (!proto?.setItem || proto.setItem.__hobunjiDurableCheckpoint) return Boolean(proto?.setItem?.__hobunjiDurableCheckpoint);

    const rawSetItem = proto.setItem; // Native setItem retained and called first; failed writes must never schedule a false durable checkpoint.
    const rawRemoveItem = proto.removeItem; // Relevant save deletion also changes the portable snapshot and therefore schedules a checkpoint.

    function checkpointAwareSetItem(key, value) {
      const result = rawSetItem.call(this, key, value);
      if (this === window.localStorage) observeWrite(key);
      return result;
    }
    checkpointAwareSetItem.__hobunjiDurableCheckpoint = true;
    checkpointAwareSetItem.__hobunjiRawStorageMethod = rawSetItem;
    proto.setItem = checkpointAwareSetItem;

    if (typeof rawRemoveItem === 'function' && !rawRemoveItem.__hobunjiDurableCheckpoint) {
      function checkpointAwareRemoveItem(key) {
        const result = rawRemoveItem.call(this, key);
        if (this === window.localStorage) observeWrite(key);
        return result;
      }
      checkpointAwareRemoveItem.__hobunjiDurableCheckpoint = true;
      checkpointAwareRemoveItem.__hobunjiRawStorageMethod = rawRemoveItem;
      proto.removeItem = checkpointAwareRemoveItem;
    }
    return true;
  }

  const storageHookInstalled = installStorageHooks(); // Installed during persistence bootstrap, before ordinary gameplay modules begin writing saves.

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden' || !gameplayHydrated()) return;
    if (timer) {
      clearTimeout(timer);
      timer = null;
      commitCheckpoint({ reason: 'visibility-hidden' }).catch(() => {}); // Best-effort immediate IDB commit before mobile tab suspension; localStorage already contains the save regardless.
    }
  });

  window.HobunjiSaveCheckpoint = Object.freeze({
    schedule: scheduleCheckpoint,
    commitNow: options => commitCheckpoint(options || {}),
    isRelevantKey: relevantKey,
  });

  window.__hobunjiSaveCheckpointDebug = {
    snapshot: () => ({
      storageHookInstalled,
      pending: Boolean(timer),
      committing: Boolean(commitPromise),
      rerunRequested,
      detectedWrites,
      durableCommits,
      queuedDriveCommits,
      backgroundSyncAttempts,
      resolutionStops,
      lastDetectedKey,
      lastCommitAt,
      lastError: lastError || null,
    }),
  };
})();
