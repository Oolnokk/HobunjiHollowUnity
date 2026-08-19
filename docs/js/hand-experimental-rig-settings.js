// Shared experimental forearm-axis feature switch used by game + Attack Editor.
(function (global) {
  'use strict';

  // New key intentionally does not inherit the retired PNG-bicep experiment state.
  const STORAGE_KEY = 'hobunji.forearmAxisTracking.v1';
  const defaults = Object.freeze({ forearmAxisTracking: true });
  const listeners = new Set();
  let state = { ...defaults };

  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (stored && typeof stored === 'object') state.forearmAxisTracking = stored.forearmAxisTracking !== false;
  } catch (_) {}

  function snapshot() { return { ...state }; }
  function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) {}
  }
  function notify(reason) {
    const next = snapshot();
    for (const listener of listeners) {
      try { listener(next, reason || 'changed'); } catch (_) {}
    }
    global.ProceduralHandTwoBoneSkin?.refreshAll?.();
    global.ProceduralHandFrameDriver?.syncNow?.();
  }
  function setForearmAxisTracking(value) {
    const next = !!value;
    if (state.forearmAxisTracking === next) return snapshot();
    state.forearmAxisTracking = next;
    persist();
    notify('forearmAxisTracking');
    return snapshot();
  }

  global.HobunjiHandExperimentalRigSettings = Object.freeze({
    defaults,
    get forearmAxisTracking() { return state.forearmAxisTracking; },
    get snapshot() { return snapshot(); },
    setForearmAxisTracking,
    reset() { state = { ...defaults }; persist(); notify('reset'); return snapshot(); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  });
})(window);
