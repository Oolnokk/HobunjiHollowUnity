// Blocks exit-time persistence while the selected character is still hydrating.
// game.js seeds several live collections with starter/default data before
// spawnPlayerAvatar() replaces them with the selected save. Its pagehide /
// beforeunload flush must not serialize those transient defaults over a good save.
(() => {
  'use strict';

  const GUARDED_EVENTS = ['beforeunload', 'pagehide'];
  let blockedExitFlushCount = 0; // Debug-visible count of unsafe early-exit flushes suppressed by this guard.
  let lastBlockedEvent = null; // Debug-visible event name for mobile diagnosis without requiring devtools.

  function playerStateHydrated() {
    // game.js sets this false before spawnPlayerAvatar() and true only at the
    // end of that function, after world/member inventory restoration.
    return window.__hobunjiGameStarted === true;
  }

  function reportBlockedExit(eventType) {
    blockedExitFlushCount += 1;
    lastBlockedEvent = eventType;
    const message = `Session persistence: skipped ${eventType} flush while player state was still hydrating.`;
    try { window.__farmLog?.(message, 'warn'); } catch (_) {}
    try { console.warn(`[session-persistence] ${message}`); } catch (_) {}
  }

  function guardEarlyExit(event) {
    if (playerStateHydrated()) return;
    reportBlockedExit(event?.type || 'exit');

    // This module is loaded before the local-folder and game.js exit-save
    // listeners. Stopping later listeners prevents any of them from mirroring
    // or serializing transient starter/default state. Do not preventDefault():
    // the guard changes persistence only, not the browser's close/navigation UX.
    event?.stopImmediatePropagation?.();
  }

  for (const eventName of GUARDED_EVENTS) {
    window.addEventListener(eventName, guardEarlyExit, true);
  }

  window.HobunjiSessionPersistenceStartupGuard = {
    isHydrated: playerStateHydrated,
    debugState: () => ({
      installed: true,
      hydrated: playerStateHydrated(),
      blockedExitFlushCount,
      lastBlockedEvent,
    }),
  };
})();
