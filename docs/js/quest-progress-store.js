// Per-world-member quest state, shared by story quests, the Quest Log, and procedural requests.
// The canonical game save still owns serialization; this module only owns the live quest record.
(() => {
  'use strict';
  let state = {}; // Current world member's quest records; replaced together after player/world restoration.
  let deps = null; // Injected member serializer and content-access rule from the game bootstrap.
  let restoreCount = 0; // Diagnostics for character/world swaps and startup restores.
  let statusChanges = 0; // Diagnostics for accepted status writes.

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
    if (!id) return false;
    const record = state[id] || (state[id] = { status: 'not_started', progress: {}, completedAt: null });
    record.status = status;
    if (progressPatch) Object.assign(record.progress, progressPatch);
    if (status === 'completed' && !record.completedAt) record.completedAt = Date.now();
    statusChanges++;
    return deps?.saveMemberWorldData?.() !== false;
  }
  function debugSnapshot() {
    return { restoreCount, statusChanges, questCount: Object.keys(state).length,
      activeQuests: Object.entries(state).filter(([, q]) => q?.status === 'active').map(([id]) => id) };
  }
  window.QuestProgressStore = Object.freeze({ init, snapshot, restore, getState, canAccess, setStatus, debugSnapshot });
  window.DevCompanion?.registerStateProvider?.('questProgressStore', debugSnapshot);
})();