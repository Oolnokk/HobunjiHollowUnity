(() => {
  'use strict';

  // Startup-only prologue map-entry backstop.
  //
  // PrologueSystem normally owns stage transitions. Its first-map handoff used
  // the global __hobunjiGameStarted flag as a readiness gate, though, and that
  // flag is not the authoritative signal that ActionArcUI's real map-entry
  // dependencies are ready. A new world can therefore already be rendering the
  // farm while the prologue controller is still waiting and never calls
  // enterZone().
  //
  // This bridge captures the SAME ActionArcUI.init dependency object that
  // PrologueSystem uses. It waits briefly to let the normal controller win; if
  // the expected prologue map is still not active and no controller transition
  // is in flight, it invokes the ordinary enterZone/enterBuilding path itself.
  // Failed early rescue attempts are retried because the authored rescue map's
  // _zoneLayouts entry may still be arriving from the async workspace loader.
  // The existing PrologueRescueMapRuntime keeps the real loading screen visible
  // throughout rescue startup, so these retries can never expose a farm flash.

  const RESCUE_MAP_ID = 'map_prologue_rescue'; // Used as the required first prologue area.
  const HUNUNDI_MAP_ID = 'map_i_temple_basement_hunundi'; // Used as the required second prologue area.
  const RESCUE_ENTRY_COL = 4; // Used to place the player in the authored 6x6 center clearing.
  const RESCUE_ENTRY_ROW = 4; // Used with RESCUE_ENTRY_COL for the first normal enterZone call.
  const FIRST_ATTEMPT_DELAY_MS = 180; // Used to give PrologueSystem's ordinary transition timer first refusal.
  const RESCUE_RETRY_MS = 120; // Used to retry until async authored zone registration has completed.
  const ROOM_RETRY_MS = 1500; // Used to avoid stacking ordinary fade transitions into Hunundi's room.

  let _deps = null; // Captured from ActionArcUI.init and used for normal enterZone/enterBuilding calls.
  let _profile = null; // Captured from hobunjiPlayerReady and used to scope retries to the active owner/world.
  let _retryTimer = 0; // Used to keep only one delayed map-entry attempt queued at a time.
  let _attemptInFlight = false; // Used to prevent overlapping async rescue-entry attempts.
  let _attemptCount = 0; // Used by mobile diagnostics to show whether the backstop is making progress.
  let _lastStatus = 'waiting-player'; // Used by debugSnapshot and the existing mobile-visible game log.
  let _lastLoggedAttempt = 0; // Used to rate-limit repeated early-layout retry warnings.

  function debugLog(message, level = 'info') {
    const logger = window.__farmLog; // Used to route diagnostics to the game's existing mobile-visible debug log.
    if (typeof logger === 'function') {
      try { logger(`[prologue-entry] ${message}`, level); return; } catch (_) {}
    }
    console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](`[prologue-entry] ${message}`);
  }

  function currentArea() {
    try { return _deps?.getCurrentArea?.() || window.GridTileAccessors?.getCurrentArea?.() || null; }
    catch (_) { return null; }
  }

  function currentState() {
    const worldId = _profile?.worldId; // Used to read the persistent stage through PrologueSystem instead of duplicating save parsing.
    return worldId ? window.PrologueSystem?.getWorldPrologue?.(worldId) || null : null;
  }

  function expectedMap(stage) {
    if (stage === 'rescue') return RESCUE_MAP_ID;
    if (stage === 'hunundi_room') return HUNUNDI_MAP_ID;
    return null;
  }

  function scheduleAttempt(delayMs = FIRST_ATTEMPT_DELAY_MS) {
    if (_retryTimer) clearTimeout(_retryTimer);
    _retryTimer = setTimeout(() => {
      _retryTimer = 0;
      attemptCurrentStage();
    }, Math.max(0, Number(delayMs) || 0));
  }

  function controllerTransitionInFlight() {
    try { return !!window.PrologueSystem?.debugSnapshot?.()?.transitionInFlight; }
    catch (_) { return false; }
  }

  async function attemptRescueEntry() {
    const before = currentArea(); // Used in diagnostics so a silent early enterZone return is visible on mobile.
    _attemptCount += 1;
    _lastStatus = `rescue-attempt-${_attemptCount}-from-${before || 'none'}`;
    try {
      await Promise.resolve(_deps.enterZone(RESCUE_MAP_ID, RESCUE_ENTRY_COL, RESCUE_ENTRY_ROW));
    } catch (error) {
      _lastStatus = `rescue-error:${error?.message || error}`;
      debugLog(`rescue enterZone attempt ${_attemptCount} failed: ${error?.message || error}`, 'error');
    }
    const after = currentArea(); // Used to distinguish a completed entry from enterZone's intentional early return while layouts load.
    if (after === RESCUE_MAP_ID) {
      _lastStatus = `entered:${RESCUE_MAP_ID}`;
      debugLog(`entered ${RESCUE_MAP_ID} after ${_attemptCount} startup attempt${_attemptCount === 1 ? '' : 's'}`);
      return;
    }
    if (_attemptCount === 1 || _attemptCount - _lastLoggedAttempt >= 10) {
      _lastLoggedAttempt = _attemptCount;
      debugLog(`still on ${after || 'no active area'} after rescue attempt ${_attemptCount}; retrying normal enterZone`, 'warn');
    }
    scheduleAttempt(RESCUE_RETRY_MS);
  }

  function attemptHunundiEntry() {
    _attemptCount += 1;
    _lastStatus = `hunundi-attempt-${_attemptCount}-from-${currentArea() || 'none'}`;
    try {
      _deps.startSceneTransition(() => _deps.enterBuilding(HUNUNDI_MAP_ID));
    } catch (error) {
      _lastStatus = `hunundi-error:${error?.message || error}`;
      debugLog(`Hunundi room transition failed: ${error?.message || error}`, 'error');
    }
    scheduleAttempt(ROOM_RETRY_MS);
  }

  async function attemptCurrentStage() {
    if (_attemptInFlight) return;
    if (!_profile?.worldId || !_profile?.characterId) {
      _lastStatus = 'waiting-player';
      return;
    }
    const prologue = window.PrologueSystem; // Used as the canonical persistence/owner gate; this bridge only repairs transport.
    const state = currentState(); // Used to select the currently persisted stage after interrupted/reloaded prologues too.
    if (!state || !prologue?.isIncompleteState?.(state)) {
      _lastStatus = state?.completed ? 'complete' : 'waiting-prologue-state';
      if (!state) scheduleAttempt(RESCUE_RETRY_MS);
      return;
    }
    if (!prologue.canCharacterEnterWorld?.(_profile.worldId, _profile.characterId)) {
      _lastStatus = 'blocked-non-owner';
      return;
    }
    const target = expectedMap(state.stage); // Used as the exact map that must replace farm for this saved stage.
    if (!target) {
      _lastStatus = `unknown-stage:${state.stage}`;
      return;
    }
    if (currentArea() === target) {
      _lastStatus = `entered:${target}`;
      return;
    }
    if (!_deps?.enterZone || !_deps?.enterBuilding || !_deps?.startSceneTransition) {
      _lastStatus = 'waiting-action-arc-deps';
      scheduleAttempt(RESCUE_RETRY_MS);
      return;
    }
    // If PrologueSystem has already begun its ordinary transition, never race
    // it. The bridge is only a backstop for the silent startup stall.
    if (controllerTransitionInFlight()) {
      _lastStatus = `controller-transition:${target}`;
      scheduleAttempt(RESCUE_RETRY_MS);
      return;
    }

    _attemptInFlight = true;
    try {
      if (state.stage === 'rescue') await attemptRescueEntry();
      else attemptHunundiEntry();
    } finally {
      _attemptInFlight = false;
    }
  }

  function wrapActionArcUI(system) {
    if (!system?.init || system.__prologueStartupEntryWrapped) return system;
    const originalInit = system.init; // Used to preserve PrologueSystem's existing init wrapper and ordinary ActionArcUI setup.
    system.init = function prologueStartupEntryInit(injectedDeps) {
      _deps = injectedDeps || null; // Used as the authoritative normal map-entry function bundle once game.js initializes ActionArcUI.
      const result = originalInit.apply(this, arguments);
      _lastStatus = _deps ? 'action-arc-deps-ready' : 'action-arc-deps-missing';
      scheduleAttempt(FIRST_ATTEMPT_DELAY_MS);
      return result;
    };
    Object.defineProperty(system, '__prologueStartupEntryWrapped', { value: true, configurable: true });
    return system;
  }

  function installActionArcHook() {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'ActionArcUI'); // Used to chain onto PrologueSystem's earlier assignment interceptor without replacing it.
    if (descriptor?.get && descriptor?.set && descriptor.configurable) {
      Object.defineProperty(window, 'ActionArcUI', {
        configurable: true,
        enumerable: descriptor.enumerable !== false,
        get() { return descriptor.get.call(window); },
        set(value) {
          descriptor.set.call(window, value);
          wrapActionArcUI(descriptor.get.call(window));
        },
      });
      const existing = descriptor.get.call(window); // Used for defensive support if ActionArcUI was assigned between the two early bootstrap scripts.
      if (existing) wrapActionArcUI(existing);
      return;
    }
    if (window.ActionArcUI) wrapActionArcUI(window.ActionArcUI);
  }

  function onPlayerReady(event) {
    if (window.__hobunjiCutscenePreview) return;
    const playerData = event?.detail; // Used to scope the transport backstop to the selected real character/world.
    if (!playerData?.worldId || !playerData?.characterId) return;
    _profile = playerData;
    _attemptCount = 0;
    _lastLoggedAttempt = 0;
    _lastStatus = 'player-ready';
    scheduleAttempt(FIRST_ATTEMPT_DELAY_MS);
  }

  function debugSnapshot() {
    const state = currentState(); // Used to expose the exact persistent stage alongside transport readiness on mobile.
    return {
      currentArea: currentArea(),
      stage: state?.stage || null,
      expectedMap: expectedMap(state?.stage),
      actionArcDepsReady: !!_deps,
      controllerTransitionInFlight: controllerTransitionInFlight(),
      attemptInFlight: _attemptInFlight,
      attemptCount: _attemptCount,
      lastStatus: _lastStatus,
      gameStartedFlag: window.__hobunjiGameStarted === true,
    };
  }

  installActionArcHook();
  document.addEventListener('hobunjiPlayerReady', onPlayerReady, true);

  window.PrologueStartupEntryBridge = Object.freeze({
    retryNow: () => scheduleAttempt(0),
    debugSnapshot,
    debugText: () => JSON.stringify(debugSnapshot(), null, 2),
  });
})();
