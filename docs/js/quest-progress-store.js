// Per-world-member quest state, shared by story quests, the Quest Log, and procedural requests.
// The canonical game save still owns serialization; this module only owns the live quest record.
(() => {
  'use strict';
  let state = {}; // Current world member's quest records; replaced together after player/world restoration.
  let deps = null; // Injected member serializer and content-access rule from the game bootstrap.
  let restoreCount = 0; // Diagnostics for character/world swaps and startup restores.
  let statusChanges = 0; // Diagnostics for accepted status writes.
  let rejectedChanges = 0; // Diagnostics for status changes reverted after failed member saves.
  let lastSaveError = null; // Last failed save message available in the mobile Dev Companion.

  function init(injectedDeps) { deps = injectedDeps; }
  function snapshot() { return state; }
  function restore(saved) {
    state = saved && typeof saved === 'object' && !Array.isArray(saved) ? { ...saved } : {};
    restoreCount++;
    return state;
  }
  function getState(id) {
    return state[id] || { status: 'not_started', progress: {}, completedAt: null };
  }
  function canAccess(quest) { return deps?.canAccessContent?.(quest?.visibility) ?? true; }
  function setStatus(id, status, progressPatch) {
    if (typeof id !== 'string' || !id || typeof status !== 'string' || !status) return false;
    const hadRecord = Object.hasOwn(state, id); // Differentiates a new quest from an existing record during save rollback.
    const beforeRecord = state[id]; // Exact original entry and identity, including malformed legacy entries.
    const record = beforeRecord && typeof beforeRecord === 'object'
      ? beforeRecord : { status: 'not_started', progress: {}, completedAt: null };
    const previousStatus = record.status; // Restored if the canonical member save rejects the change.
    const previousCompletedAt = record.completedAt; // A failed completion must not leave a completion timestamp.
    const previousProgress = record.progress; // Existing progress object identity is retained for live consumers.
    const previousFields = previousProgress && typeof previousProgress === 'object' && !Array.isArray(previousProgress)
      ? { ...previousProgress } : null;
    if (!previousFields) record.progress = {};
    state[id] = record;
    record.status = status;
    if (progressPatch && typeof progressPatch === 'object' && !Array.isArray(progressPatch)) Object.assign(record.progress, progressPatch);
    if (status === 'completed' && !record.completedAt) record.completedAt = Date.now();
    let saved = false; // A rejected or throwing serializer must not advance the live quest log.
    lastSaveError = null; // Clear an older failure before reporting this attempt's result.
    try { saved = deps?.saveMemberWorldData?.() !== false; }
    catch (error) { lastSaveError = String(error?.message || error); }
    if (!saved) {
      if (hadRecord) {
        state[id] = beforeRecord;
        if (beforeRecord === record) {
          record.status = previousStatus;
          record.completedAt = previousCompletedAt;
          if (previousFields) {
            for (const key of Object.keys(previousProgress)) delete previousProgress[key];
            Object.assign(previousProgress, previousFields);
          }
          record.progress = previousProgress;
        }
      } else delete state[id];
      rejectedChanges++;
      if (!lastSaveError) lastSaveError = 'Member save rejected quest status';
      return false;
    }
    lastSaveError = null;
    statusChanges++;
    return true;
  }
  function debugSnapshot() {
    return { restoreCount, statusChanges, questCount: Object.keys(state).length,
      activeQuests: Object.entries(state).filter(([, q]) => q?.status === 'active').map(([id]) => id),
      rejectedChanges, lastSaveError };
  }
  window.QuestProgressStore = Object.freeze({ init, snapshot, restore, getState, canAccess, setStatus, debugSnapshot });
  window.DevCompanion?.registerStateProvider?.('questProgressStore', debugSnapshot);
})();