(() => {
  'use strict';

  if (Number(window.TirednessSystem?.version) >= 1) return;

  const AFFLICTION_ID = 'tiredFooting'; // ResourceSystem band synchronized to the player's accumulated waking time.
  const BUILDUP_START_HOURS = 18; // Waking hours before Tiredness begins reserving Footing.
  const PASS_OUT_HOURS = 24; // Waking hours at which all remaining Footing is reserved and forced sleep begins.
  const PERSIST_STEP_HOURS = 0.05; // Minimum waking-time change before another localStorage write; keeps the per-frame tracker inexpensive.
  const STORAGE_VERSION = 1; // Serialized state schema used by the save-local Tiredness record.
  const WAKE_MESSAGE = 'Someone must have found you unconscious and taken you home.'; // Shown after a Tiredness pass-out wakes at the farmhouse bed.
  const CHANGE_SUMMARY = 'Tiredness now builds from 18–24 waking hours, pauses in combat/cutscenes, reserves Footing, and passes the player out into home sleep.'; // Mobile-visible latest-change summary.

  let dialogueDeps = null; // Captures DialogueContent's private cutscene-active getter without reaching into game.js.
  let musicDeps = null; // Captures Music's authoritative combat-state getter as a fallback when Combat deps do not expose it.
  let loadedStorageKey = null; // Identifies which save/world the in-memory waking-hours state currently belongs to.
  let awakeHours = 0; // Persisted waking duration used to derive the Tiredness affliction amount.
  let lastCalendarHours = null; // Last sampled absolute represented world hour; deltas advance awakeHours while not paused.
  let lastPersistedAwakeHours = -Infinity; // Throttles localStorage writes while natural time advances every frame.
  let passoutActive = false; // Guards the one-shot forced-sleep trigger after the 24-hour threshold is reached.
  let pendingPassoutWake = false; // Survives the black passage midpoint so home placement/message happen as sleep completes.
  let lastPauseReason = null; // Exposed to mobile diagnostics to verify combat/cutscene/sleep buildup suspension.
  let passoutCount = 0; // Session diagnostic count proving the 24-hour threshold fired only once per waking cycle.
  let lastError = null; // Most recent recoverable runtime problem exposed through debugSnapshot().
  let devPanelRegistered = false; // Prevents duplicate Tiredness panels when parser-time init wrappers are re-entered.

  const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function log(message, level = 'info') {
    const sink = window.__farmLog || ((text) => console.log(text)); // Existing mobile-visible game log is preferred over console-only diagnostics.
    try { sink(`[tiredness] ${message}`, level); }
    catch (_) { console.log(`[tiredness] ${message}`); }
  }

  function playerEntity() {
    return window.Combat?.deps?.player
      || window.PlayerSocialPoses?.getPlayerEntity?.()
      || window.__hobunjiFurnitureDebug?.playerState
      || null;
  }

  function storageIdentity() {
    const profile = window.__hobunjiPlayerProfile || {}; // Active save profile supplies stable world/player ids without coupling to game.js save internals.
    return String(profile.worldId || profile.playerId || 'session');
  }

  function storageKey() {
    return `hobunji_tiredness.v${STORAGE_VERSION}:${storageIdentity()}`;
  }

  function ensureLoaded() {
    const key = storageKey(); // Current save-local record; changing worlds intentionally reloads independent waking time.
    if (loadedStorageKey === key) return;
    loadedStorageKey = key;
    awakeHours = 0;
    lastCalendarHours = null;
    lastPersistedAwakeHours = -Infinity;
    passoutActive = false;
    pendingPassoutWake = false;
    try {
      const saved = JSON.parse(localStorage.getItem(key) || 'null');
      awakeHours = clamp(finite(saved?.awakeHours, 0), 0, PASS_OUT_HOURS);
    } catch (error) {
      lastError = `load: ${error?.message || error}`;
      log(lastError, 'warn');
    }
  }

  function persist(force = false) {
    ensureLoaded();
    if (!force && Math.abs(awakeHours - lastPersistedAwakeHours) < PERSIST_STEP_HOURS) return;
    try {
      localStorage.setItem(loadedStorageKey, JSON.stringify({ version: STORAGE_VERSION, awakeHours }));
      lastPersistedAwakeHours = awakeHours;
    } catch (error) {
      lastError = `save: ${error?.message || error}`;
      log(lastError, 'warn');
    }
  }

  function representedDayHours() {
    return Math.max(1, finite(window.CalendarSystem?.activeClockHours?.(), 24)); // CalendarSystem is authoritative; 24 is only a parser-time fallback.
  }

  function calendarAbsoluteHours() {
    const snapshot = window.CalendarSystem?.timeDebugSnapshot?.();
    if (!snapshot || !Number.isFinite(Number(snapshot.rawDay)) || !Number.isFinite(Number(snapshot.time01))) return null;
    const span = representedDayHours(); // Converts the calendar's normalized 0..1 day position into represented in-game hours.
    return (Number(snapshot.rawDay) - 1) * span + Number(snapshot.time01) * span;
  }

  function tirednessFraction(hours = awakeHours) {
    return clamp((finite(hours, 0) - BUILDUP_START_HOURS) / (PASS_OUT_HOURS - BUILDUP_START_HOURS), 0, 1);
  }

  function availableFootingCapacity(player) {
    const rs = window.ResourceSystem;
    const full = Math.max(0, finite(rs?.getFullFootingCapacity?.(player), player?.maxFooting || 0)); // Includes Poise/trinket capacity before any Footing reservations.
    const shambling = Math.max(0, finite(rs?.getAffliction?.(player, 'shamblingFooting'), 0)); // Existing immutable reservation remains ahead of sleep debt.
    return Math.max(0, full - shambling);
  }

  function targetTirednessPoints(player, hours = awakeHours) {
    return availableFootingCapacity(player) * tirednessFraction(hours);
  }

  function setTirednessAffliction(player, targetPoints) {
    const rs = window.ResourceSystem;
    if (!player || !rs?.getAffliction) return 0;
    const current = Math.max(0, finite(rs.getAffliction(player, AFFLICTION_ID), 0)); // Current visible resource-ring segment reconciled to the waking-time target below.
    const target = Math.max(0, finite(targetPoints, 0));
    if (target > current + 0.049) rs.addAffliction?.(player, AFFLICTION_ID, target - current);
    else if (target < current - 0.049) rs.removeAffliction?.(player, AFFLICTION_ID, current - target);
    rs.enforceCaps?.(player);
    return Math.max(0, finite(rs.getAffliction(player, AFFLICTION_ID), 0));
  }

  function syncAffliction() {
    const player = playerEntity();
    if (!player) return 0;
    return setTirednessAffliction(player, targetTirednessPoints(player));
  }

  function combatActive() {
    const combat = window.Combat?.deps; // Combat's injected gameplay deps are the primary source when they expose the existing combat-state helper.
    if (typeof combat?.isPlayerInCombat === 'function') return !!combat.isPlayerInCombat();
    if (typeof musicDeps?.isPlayerInCombat === 'function') return !!musicDeps.isPlayerInCombat();
    return false;
  }

  function cutsceneActive() {
    if (typeof dialogueDeps?.getCutscenePreviewActive === 'function') return !!dialogueDeps.getCutscenePreviewActive();
    return false;
  }

  function sleepPassageActive() {
    return window.CalendarSystem?.timeDebugSnapshot?.()?.modalKind === 'sleep';
  }

  function pauseReason() {
    if (passoutActive) return 'passout';
    if (sleepPassageActive()) return 'sleep';
    if (combatActive()) return 'combat';
    if (cutsceneActive()) return 'cutscene';
    return null;
  }

  function queuePassout() {
    if (passoutActive || awakeHours < PASS_OUT_HOURS) return false;
    passoutActive = true;
    pendingPassoutWake = true;
    passoutCount += 1;
    persist(true);
    queueMicrotask(() => {
      const calendar = window.CalendarSystem;
      if (!calendar?.openTimePassage?.('sleep', { forced: true, autoConfirm: true })) {
        passoutActive = false;
        pendingPassoutWake = false;
        lastError = 'pass-out could not open forced sleep passage';
        log(lastError, 'error');
      }
    });
    return true;
  }

  function update() {
    ensureLoaded();
    const nowHours = calendarAbsoluteHours();
    if (nowHours == null) return;
    if (lastCalendarHours == null) {
      lastCalendarHours = nowHours;
      syncAffliction();
      if (awakeHours >= PASS_OUT_HOURS) queuePassout();
      return;
    }

    const delta = nowHours - lastCalendarHours; // Calendar movement, including seated Wait, is the only source of waking-time accumulation.
    lastCalendarHours = nowHours;
    lastPauseReason = pauseReason();
    if (delta > 0 && !lastPauseReason) {
      awakeHours = clamp(awakeHours + delta, 0, PASS_OUT_HOURS);
      syncAffliction();
      persist(false);
    } else if (delta < -0.001) {
      // Loads/debug rewinds establish a fresh sampling anchor but never refund sleep debt.
      log(`calendar moved backward by ${Math.abs(delta).toFixed(2)}h; preserving ${awakeHours.toFixed(2)} waking hours`, 'warn');
    }

    if (awakeHours >= PASS_OUT_HOURS) queuePassout();
  }

  function recoverFromSleep(player = playerEntity()) {
    ensureLoaded();
    awakeHours = 0;
    lastCalendarHours = calendarAbsoluteHours();
    const remaining = setTirednessAffliction(player, 0);
    const rs = window.ResourceSystem;
    if (player) player.footing = Math.max(0, finite(rs?.getEffectiveMax?.(player, 'footing'), player.maxFooting || 0)); // Sleep refills all Footing still usable after unrelated afflictions such as Drunken Footing.
    rs?.enforceCaps?.(player);
    persist(true);
    return remaining <= 0.05;
  }

  function onSleepPassageComplete() {
    recoverFromSleep();
    if (!pendingPassoutWake) return;
    const movedHome = window.FarmhouseLoginSpawn?.returnToFarmhouse?.({ atBed: true }); // Runs synchronously at the black midpoint, then its bed centering finishes once the interior has settled.
    if (!movedHome) {
      lastError = 'pass-out sleep completed but farmhouse return runtime was unavailable';
      log(lastError, 'warn');
    }
  }

  function afterWake() {
    if (!pendingPassoutWake) {
      passoutActive = false;
      return false;
    }
    pendingPassoutWake = false;
    passoutActive = false;
    const showToast = window.Combat?.deps?.showToast || musicDeps?.showToast; // Existing game toast path remains player-facing on mobile without introducing a new overlay.
    if (typeof showToast === 'function') showToast(WAKE_MESSAGE, false);
    else log(WAKE_MESSAGE);
    return true;
  }

  function setAwakeHoursForDebug(value) {
    ensureLoaded();
    awakeHours = clamp(finite(value, 0), 0, PASS_OUT_HOURS);
    lastCalendarHours = calendarAbsoluteHours();
    syncAffliction();
    persist(true);
    if (awakeHours >= PASS_OUT_HOURS) queuePassout();
    return debugSnapshot();
  }

  function debugSnapshot() {
    ensureLoaded();
    const player = playerEntity();
    return {
      version: 1,
      changeSummary: CHANGE_SUMMARY,
      awakeHours: Number(awakeHours.toFixed(3)),
      buildupStartsAtHours: BUILDUP_START_HOURS,
      passOutAtHours: PASS_OUT_HOURS,
      tirednessFraction: Number(tirednessFraction().toFixed(4)),
      tirednessPoints: finite(window.ResourceSystem?.getAffliction?.(player, AFFLICTION_ID), 0),
      availableFootingCapacity: availableFootingCapacity(player),
      effectiveFootingMax: player ? finite(window.ResourceSystem?.getEffectiveMax?.(player, 'footing'), player.maxFooting || 0) : null,
      pauseReason: lastPauseReason,
      combatActive: combatActive(),
      cutsceneActive: cutsceneActive(),
      sleepPassageActive: sleepPassageActive(),
      passoutActive,
      pendingPassoutWake,
      passoutCount,
      storageKey: loadedStorageKey,
      homeRecovery: window.FarmhouseLoginSpawn?.debugSnapshot?.() || null,
      lastError,
    };
  }

  function captureInitDeps(api, key, receive) {
    if (!api || api[key]) return;
    const original = api.init;
    if (typeof original !== 'function') return;
    api.init = function tirednessCapturedInit(injectedDeps, ...args) {
      receive(injectedDeps);
      return original.call(this, injectedDeps, ...args);
    };
    api[key] = true;
  }

  function installRuntimeHooks() {
    captureInitDeps(window.DialogueContent, '__tirednessInitCaptured', injected => { dialogueDeps = injected; });
    captureInitDeps(window.Music, '__tirednessInitCaptured', injected => { musicDeps = injected; });
    const vitals = window.PlayerVitals;
    if (vitals && !vitals.__tirednessUpdateWrapped && typeof vitals.updatePlayerVitals === 'function') {
      const originalUpdate = vitals.updatePlayerVitals; // Existing vitals/affliction tick remains authoritative and runs before the waking-time tracker.
      vitals.updatePlayerVitals = function tirednessAwareVitalsUpdate(dt, ...args) {
        const result = originalUpdate.call(this, dt, ...args);
        update();
        return result;
      };
      vitals.__tirednessUpdateWrapped = true;
    }
  }

  function registerDevPanel() {
    if (devPanelRegistered || !window.DevCompanion?.registerPanel) return false;
    devPanelRegistered = true;
    window.DevCompanion.registerPanel({
      id: 'tiredness',
      title: '😴 Tiredness',
      order: 21,
      when: () => window.__hobunjiGameStarted === true,
      render: () => {
        const debug = debugSnapshot();
        return {
          summary: `Awake ${debug.awakeHours.toFixed(2)}h · Tiredness ${debug.tirednessPoints.toFixed(1)}/${debug.availableFootingCapacity.toFixed(1)}`,
          note: debug.pauseReason ? `Buildup paused: ${debug.pauseReason}` : CHANGE_SUMMARY,
          actions: [
            { id: 'set', label: 'Set 17h', args: { hours: 17 }, group: 'Test' },
            { id: 'set', label: 'Set 18h', args: { hours: 18 }, group: 'Test' },
            { id: 'set', label: 'Set 23h', args: { hours: 23 }, group: 'Test' },
            { id: 'set', label: 'Force 24h', args: { hours: 24 }, group: 'Test', confirm: 'Force the player to the Tiredness pass-out threshold?' },
            { id: 'reset', label: 'Sleep reset', group: 'Test' },
          ],
        };
      },
      onAction: (action, args) => {
        if (action === 'set') return { ok: true, snapshot: setAwakeHoursForDebug(args.hours) };
        if (action === 'reset') { recoverFromSleep(); return { ok: true, snapshot: debugSnapshot() }; }
        return { ok: false, error: 'Unknown Tiredness debug action.' };
      },
    });
    return true;
  }

  window.addEventListener('hobunji-time-passage', event => {
    if (event?.detail?.kind === 'sleep') onSleepPassageComplete();
  });
  window.addEventListener('pagehide', () => persist(true));

  installRuntimeHooks();
  registerDevPanel();
  const panelPoll = setInterval(() => { // Short-lived bootstrap poll covers DevCompanion loading after this dynamically loaded module.
    installRuntimeHooks();
    if (registerDevPanel() && window.__hobunjiGameStarted === true) clearInterval(panelPoll);
  }, 500);
  setTimeout(() => clearInterval(panelPoll), 15000);

  window.TirednessSystem = Object.freeze({
    version: 1,
    update,
    recoverFromSleep,
    afterWake,
    debugSnapshot,
    setAwakeHoursForDebug,
    constants: Object.freeze({ AFFLICTION_ID, BUILDUP_START_HOURS, PASS_OUT_HOURS }),
    _test: Object.freeze({ tirednessFraction, targetTirednessPoints, calendarAbsoluteHours, pauseReason }),
  });
  window.__tirednessDebug = debugSnapshot;
})();
