// Shared experimental arm-rig feature switches used by game + Attack Editor.
(function (global) {
  'use strict';

  const STORAGE_KEY = 'hobunji.handExperimentalRig.v1';
  const defaults = Object.freeze({
    forearmAxisTracking: true,
    bicepElbowTracking: false,
  });
  const listeners = new Set();
  let state = { ...defaults };

  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (stored && typeof stored === 'object') {
      state.forearmAxisTracking = stored.forearmAxisTracking !== false;
      state.bicepElbowTracking = stored.bicepElbowTracking === true;
    }
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
  function set(key, value) {
    if (!Object.prototype.hasOwnProperty.call(defaults, key)) return snapshot();
    const next = !!value;
    if (state[key] === next) return snapshot();
    state[key] = next;
    persist();
    notify(key);
    return snapshot();
  }

  global.HobunjiHandExperimentalRigSettings = Object.freeze({
    defaults,
    get forearmAxisTracking() { return state.forearmAxisTracking; },
    get bicepElbowTracking() { return state.bicepElbowTracking; },
    get snapshot() { return snapshot(); },
    setForearmAxisTracking(value) { return set('forearmAxisTracking', value); },
    setBicepElbowTracking(value) { return set('bicepElbowTracking', value); },
    reset() { state = { ...defaults }; persist(); notify('reset'); return snapshot(); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  });
})(window);
