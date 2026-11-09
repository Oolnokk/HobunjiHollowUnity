// Status toasts and location title cards (moved out of game.js), plus a
// short in-memory history of recent toasts so a message that vanished after
// 2.8s can still be read later (Message Log overlay, see js/qol-hotkeys.js).
(() => {
  'use strict';

  const HISTORY_LIMIT = 80;
  let deps = null;
  let toastTimer = null;
  let zoneBannerTimer = null;
  const history = []; // Newest last: { text, ok, kind, count, at (ms since epoch) }.
  const listeners = new Set();

  function init(nextDeps) {
    deps = nextDeps || {};
  }

  function record(text, ok, kind) {
    const message = String(text ?? '').trim();
    if (!message) return;
    const last = history[history.length - 1];
    // Repeated identical pings (combat hit/miss, a blocked action spammed)
    // collapse into one row with a counter instead of flooding the log.
    if (last && last.text === message && last.ok === ok && last.kind === kind) {
      last.count += 1;
      last.at = Date.now();
    } else {
      history.push({ text: message, ok, kind, count: 1, at: Date.now() });
      if (history.length > HISTORY_LIMIT) history.splice(0, history.length - HISTORY_LIMIT);
    }
    for (const listener of listeners) {
      try { listener(); } catch (_) {}
    }
  }

  // `silent` skips the "can't do that" error chime while still showing
  // the visual toast — used by per-swing combat hit/miss results (combo/
  // quick attacks/Charged Breaker/basic weapon tap), which fire on
  // *every* attack and already have their own dedicated combat sfx
  // (weaponSlash/creatureClawHit).
  //
  // Deliberately no sound on ok===true here: a ding on every successful
  // action (dig, till, plant, harvest, process...) was just noise that
  // meant "you pressed something and it worked" — no actual information
  // beyond what the player already knows from doing the thing. The
  // error chime survives because a *blocked* action is the one case
  // that's actually worth a distinct "that didn't work" cue.
  function showToast(msg, ok = true, silent = false) {
    const toastEl = deps?.toastEl || document.getElementById('toast');
    if (toastEl) {
      toastEl.textContent = msg;
      toastEl.className = 'show ' + (ok ? 'ok' : 'fail');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2800);
    }
    record(msg, ok !== false, 'toast');
    if (!silent && !ok) window.AudioSystem?.playObjectSfx(window.AudioSystem?.objectSfxConfig().error);
  }

  // A location title card -- fades in near the top of the screen and
  // holds, then fades out, same genre convention as an "Entering X"
  // banner. Separate from showToast (a small ok/fail status ping):
  // this holds noticeably longer (a title card is meant to be READ,
  // not just glanced at) and has no ok/fail styling since it's never
  // reporting an outcome.
  function showZoneBanner(text) {
    const zoneBannerEl = deps?.zoneBannerEl || document.getElementById('zoneBanner');
    if (zoneBannerEl) {
      zoneBannerEl.textContent = text;
      zoneBannerEl.classList.add('show');
      clearTimeout(zoneBannerTimer);
      zoneBannerTimer = setTimeout(() => zoneBannerEl.classList.remove('show'), 4200);
    }
    record(text, true, 'zone');
  }

  function getHistory() {
    return history.map(entry => ({ ...entry }));
  }

  function clearHistory() {
    history.length = 0;
    for (const listener of listeners) {
      try { listener(); } catch (_) {}
    }
  }

  function onHistoryChange(listener) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  window.ToastNotifications = { init, showToast, showZoneBanner, getHistory, clearHistory, onHistoryChange };
})();
