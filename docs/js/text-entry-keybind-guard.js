// Shared keyboard-input guard for text-entry controls.
//
// Text inputs must receive their own key events normally (including Enter,
// Escape, Space, and remapped gameplay keys), but those same events must not
// continue bubbling into the game's document/window gameplay shortcuts.
(() => {
  'use strict';

  if (window.HobunjiTextInputGuard) return;

  const EDITABLE_SELECTOR = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])'; // Used to recognize every browser control that should own keyboard input instead of gameplay.
  const debugState = { // Used by the existing in-game/mobile debug surfaces without requiring browser devtools.
    blockedKeydowns: 0,
    blockedKeyups: 0,
    lastBlocked: null,
  };

  function editableOwner(target) {
    if (!target) return null;
    if (typeof target.closest === 'function') {
      const owner = target.closest(EDITABLE_SELECTOR); // Used to include descendants inside contenteditable controls as well as the controls themselves.
      if (owner) return owner;
    }
    const tag = String(target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable) return target;
    return null;
  }

  function isEditingTarget(target) {
    return !!editableOwner(target);
  }

  function isEditingEvent(event) {
    if (isEditingTarget(event?.target)) return true;
    return isEditingTarget(document.activeElement); // Used as a fallback for browser/WebView keyboard events retargeted to body/document while an editor still has focus.
  }

  function blockGlobalKeybind(event) {
    if (!isEditingEvent(event)) return false;

    if (event.type === 'keydown') debugState.blockedKeydowns += 1;
    else if (event.type === 'keyup') debugState.blockedKeyups += 1;
    const owner = editableOwner(event.target) || editableOwner(document.activeElement); // Used only for compact diagnostics about the most recently protected editor.
    debugState.lastBlocked = {
      type: event.type || null,
      code: event.code || null,
      key: event.key || null,
      targetTag: String(owner?.tagName || '').toLowerCase() || null,
      targetId: owner?.id || null,
    };

    // Deliberately do NOT preventDefault(): native text editing and any
    // listener attached directly to the input already ran at the target.
    // This listener is installed early on document in bubble phase, so it
    // stops later global gameplay/menu listeners without swallowing the UI's
    // own key handling.
    event.stopImmediatePropagation?.();
    return true;
  }

  document.addEventListener('keydown', blockGlobalKeybind, false);
  document.addEventListener('keyup', blockGlobalKeybind, false);

  window.HobunjiTextInputGuard = {
    isEditingTarget,
    isEditingEvent,
    blockGlobalKeybind,
    getDebug: () => ({
      blockedKeydowns: debugState.blockedKeydowns,
      blockedKeyups: debugState.blockedKeyups,
      lastBlocked: debugState.lastBlocked ? { ...debugState.lastBlocked } : null,
    }),
  };
})();
