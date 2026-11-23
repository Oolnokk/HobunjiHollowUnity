(() => {
  'use strict';

  // Floating menus own their actual close handlers. This policy only finds a
  // safe existing dismissal action after ControllerUI has left all nested scopes.
  const CLOSE_SELECTOR = 'button, [role="button"], [data-ctrl-cancel]'; // Scanned only on Back, never in the gamepad frame loop.
  const CLOSE_LABEL = /^(?:close|cancel|dismiss)(?: (?:menu|panel|window|dialog|shop|wardrobe|loom|screen))?$/i; // Narrow inference avoids purchases and confirmation choices.

  function isCloseControl(el) {
    if (!el) return false;
    if (el.hasAttribute?.('data-ctrl-cancel')) return true;
    if (!el.matches?.('button, [role="button"]')) return false;
    if (el.hasAttribute?.('data-close')) return true;
    const label = String(el.getAttribute?.('aria-label') || el.getAttribute?.('title') || el.textContent || '').trim(); // Used solely for legacy unmarked close buttons.
    return CLOSE_LABEL.test(label);
  }

  function findCloseControl(panel, { isEligible, onScreen }) {
    if (!panel?.querySelectorAll || typeof isEligible !== 'function' || typeof onScreen !== 'function') return null;
    let explicitVisible = null; // Highest priority: the active panel's marked, on-screen Cancel.
    let explicitClipped = null; // A marked Cancel outside a scroll clip still works through Back.
    let inferredVisible = null; // Legacy labels are considered only if no marked Cancel exists.
    let inferredClipped = null; // Last button fallback; hidden/disabled/nested owners are already excluded.
    for (const el of panel.querySelectorAll(CLOSE_SELECTOR)) {
      if (!isCloseControl(el) || !isEligible(el)) continue;
      const visible = onScreen(el); // Checks scroll clipping without making Back behave like Confirm.
      if (el.hasAttribute('data-ctrl-cancel')) {
        if (visible) { explicitVisible = el; break; }
        if (!explicitClipped) explicitClipped = el;
      } else if (visible) {
        if (!inferredVisible) inferredVisible = el;
      } else if (!inferredClipped) {
        inferredClipped = el;
      }
    }
    return explicitVisible || explicitClipped || inferredVisible || inferredClipped || null;
  }

  function dismiss(panel, { isEligible, onScreen, targetDocument, KeyboardEventType }) {
    const button = findCloseControl(panel, { isEligible, onScreen }); // The owning panel and its live visibility rules are injected by ControllerUI.
    if (button) {
      button.click(); // Invokes the menu's existing close handler; does not manipulate that menu's state.
      return 'close-button';
    }
    if (targetDocument?.dispatchEvent && typeof KeyboardEventType === 'function') {
      targetDocument.dispatchEvent(new KeyboardEventType('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true })); // Document listeners and bubbling window listeners receive one event.
      return 'escape-fallback';
    }
    return 'no-dismissal'; // Diagnostic rather than inventing a close action for unknown menu types.
  }

  window.ControllerMenuDismissal = Object.freeze({ isCloseControl, findCloseControl, dismiss });
})();
