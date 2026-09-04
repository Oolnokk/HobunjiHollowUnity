(() => {
  'use strict';

  // Input-binding load/save/labeling helpers extracted out of game.js
  // following the same window.<Namespace> + init(deps) pattern as
  // js/dye-system.js. `inputBindings` itself (the live, mutated-in-place
  // binding state) stays in game.js — it's read/written from many places
  // well beyond this cluster — so it's threaded through as a getter rather
  // than a captured reference, since it isn't known yet at the point
  // loadInputBindings() must first run to produce it. game.js calls
  // init() twice: once with just INPUT_DEFAULTS (enough for
  // loadInputBindings() to bootstrap `inputBindings`), then again right
  // after with the getInputBindings getter added once that const exists.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  function loadInputBindings() {
    const INPUT_DEFAULTS = deps.INPUT_DEFAULTS;
    try {
      const saved = JSON.parse(localStorage.getItem(INPUT_DEFAULTS.storageKey) || 'null');
      return {
        desktop: { ...INPUT_DEFAULTS.desktop, ...(saved?.desktop || {}) },
        controller: { ...INPUT_DEFAULTS.controller, ...(saved?.controller || {}) },
        modeShifts: Array.isArray(saved?.modeShifts) ? saved.modeShifts : INPUT_DEFAULTS.modeShifts
      };
    } catch (_err) {
      return { desktop: { ...INPUT_DEFAULTS.desktop }, controller: { ...INPUT_DEFAULTS.controller }, modeShifts: INPUT_DEFAULTS.modeShifts };
    }
  }

  function getCurrentBindings() {
    return deps?.getInputBindings?.() || null;
  }

  function saveInputBindings() {
    const bindings = getCurrentBindings();
    if (!bindings) return false;
    localStorage.setItem(deps.INPUT_DEFAULTS.storageKey, JSON.stringify(bindings));
    return true;
  }

  function bindingConflict(device, button, actionId, modeShift = null) {
    if (!button) return '';
    if (modeShift && button === modeShift.button) return 'Shifted input cannot use its held mode-shift button.';
    const inputBindings = getCurrentBindings();
    const bindings = inputBindings?.[device] || {};
    for (const [otherAction, otherButton] of Object.entries(bindings)) {
      if (otherAction !== actionId && otherButton === button) return `Already bound to ${actionLabel(otherAction)}.`;
    }
    if (!modeShift) return '';
    for (const [otherButton, otherAction] of Object.entries(modeShift.bindings || {})) {
      if (otherAction === actionId && otherButton === button) return `Already bound to ${actionLabel(actionId)} in this mode shift.`;
    }
    return '';
  }

  function actionLabel(id) {
    return deps.INPUT_DEFAULTS.actions.find(a => a.id === id)?.label || id;
  }

  function buttonLabel(code) {
    if (!code) return 'Unbound';
    const chordParts = String(code).split('+').map(part => part.trim()).filter(Boolean);
    if (chordParts.length > 1) {
      const key = chordParts.pop();
      return `${chordParts.join(' + ')} + ${buttonLabel(key)}`;
    }
    const labels = { LeftTrigger: 'LT', RightTrigger: 'RT', RightStickLeft: 'RS ←', RightStickRight: 'RS →', RightStickUp: 'RS ↑', RightStickDown: 'RS ↓', WheelUp: 'Wheel ↑', WheelDown: 'Wheel ↓' };
    return labels[code] || String(code).replace(/^Key/, '').replace(/^Digit/, '').replace(/^Button/, 'Pad ');
  }

  window.InputBindings = {
    init, loadInputBindings, getCurrentBindings, saveInputBindings, bindingConflict, actionLabel, buttonLabel,
  };
})();