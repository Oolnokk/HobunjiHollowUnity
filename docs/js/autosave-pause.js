// Autosave Pause — one tab-scoped switch that stops every AUTOMATIC write to
// the persistent save while you experiment (quick load/replay, dialogue
// testing, recovery swapping from the Dev Companion window).
//
// What it gates (each owner checks HobunjiAutosavePause.isPaused() itself):
//   - LocalSaveFolder automatic syncs (interval, change poll, visibility,
//     pagehide/beforeunload) — the canonical Primary Save Folder is frozen.
//   - HobunjiSaveCheckpoints.saveAuto — rolling recovery autosaves stop
//     advancing, so "Latest/Earlier Autosave" keep the pre-pause history.
// Explicit saves (pause-menu Manual Save, campfire saves, Save Now, recovery
// restores) still work: pausing only removes the automatic ones.
//
// Live gameplay still writes the browser's working copy (localStorage) as
// it always has; with a Primary Save Folder connected, a reload pulls the
// frozen folder save back in, discarding the paused session's changes.
// The state is kept in sessionStorage so it survives quick-load reloads in
// this tab but never leaks into another tab or a later browser session.
(() => {
  'use strict';

  if (window.HobunjiAutosavePause) return;

  const STORAGE_KEY = 'hobunjiAutosavePause.v1';
  const BADGE_ID = 'hobunjiAutosavePausedBadge';
  const listeners = new Set();
  let blockedCount = 0; // Automatic writes skipped since this page loaded.
  let lastBlocked = null; // {source, at}

  function readState() {
    try {
      const value = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null');
      return value && value.paused ? value : null;
    } catch { return null; }
  }

  let state = readState();

  function writeState() {
    try {
      if (state) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      else sessionStorage.removeItem(STORAGE_KEY);
    } catch (_) {}
  }

  function isPaused() {
    return !!state?.paused;
  }

  function renderBadge() {
    if (typeof document === 'undefined' || !document.body) return;
    let badge = document.getElementById(BADGE_ID);
    if (!isPaused()) { badge?.remove(); return; }
    if (!badge) {
      badge = document.createElement('div');
      badge.id = BADGE_ID;
      badge.title = 'Automatic saving is paused for this tab (Dev Companion). Click to resume.';
      Object.assign(badge.style, {
        position: 'fixed', left: '50%', bottom: '6px', transform: 'translateX(-50%)', zIndex: '2147483000',
        padding: '3px 10px', borderRadius: '999px', font: '600 11px/1.4 system-ui, sans-serif',
        background: 'rgba(120,70,10,.88)', color: '#ffe3b0', border: '1px solid rgba(255,200,120,.6)',
        cursor: 'pointer', pointerEvents: 'auto', userSelect: 'none',
      });
      badge.addEventListener('click', () => {
        if (confirm('Resume automatic saving? The current game state will be written to your save on the next autosave.')) resume('badge');
      });
      document.body.appendChild(badge);
    }
    const text = '⏸ Autosave paused';
    if (badge.textContent !== text) badge.textContent = text;
  }

  function emit() {
    renderBadge();
    const snapshot = getState();
    for (const listener of listeners) { try { listener(snapshot); } catch (_) {} }
  }

  function pause(reason = 'manual') {
    if (isPaused()) return getState();
    state = { paused: true, reason: String(reason || 'manual'), since: Date.now() };
    writeState();
    try { window.__farmLog?.(`Autosave paused (${state.reason}).`, 'warn'); } catch (_) {}
    emit();
    return getState();
  }

  function resume(reason = 'manual') {
    if (!isPaused()) return getState();
    state = null;
    writeState();
    try { window.__farmLog?.(`Autosave resumed (${reason}).`, 'info'); } catch (_) {}
    emit();
    // Let the folder owner write the now-current state promptly instead of
    // waiting for its next interval tick.
    try {
      const folder = window.LocalSaveFolder;
      const status = folder?.getStatus?.();
      // A quick-load boot deliberately skips the startup folder pull, which is
      // what normally arms autosync — so an unarmed folder gets one explicit
      // (data-loss-guarded) sync here, which re-arms it.
      if (status?.state === 'ready') folder.syncNow({ automatic: !!status.autoSyncArmed }).catch?.(() => {});
    } catch (_) {}
    return getState();
  }

  // Called by each gated owner when it skips an automatic write.
  function noteBlocked(source) {
    blockedCount++;
    lastBlocked = { source: String(source || 'unknown'), at: Date.now() };
  }

  function getState() {
    return {
      paused: isPaused(),
      reason: state?.reason || null,
      since: state?.since || null,
      blockedCount,
      lastBlocked,
    };
  }

  function onChange(listener) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderBadge, { once: true });
    else renderBadge();
  }

  window.HobunjiAutosavePause = { isPaused, pause, resume, toggle: reason => (isPaused() ? resume(reason) : pause(reason)), noteBlocked, getState, onChange };
})();
