// Always-available fullscreen control for desktop and touch devices.
// Uses the browser Fullscreen API (plus the WebKit aliases still needed by
// some mobile browsers), keeps an exit button visible while fullscreen, and
// supports Alt+Enter on keyboard. Escape remains the browser-native exit.
(() => {
  'use strict';

  const BUTTON_ID = 'hobunjiFullscreenToggle'; // Used to prevent duplicate controls if this module is initialized twice.
  const STYLE_ID = 'hobunjiFullscreenToggleStyle'; // Used to install the fullscreen control's self-contained styles once.
  const FEEDBACK_ID = 'hobunjiFullscreenFeedback'; // Used for visible mobile-safe API/error feedback without requiring devtools.
  const UNLOAD_BYPASS_MS = 5000; // Used to keep an intentional reload/leave bypass short-lived instead of weakening the guard for the whole session.
  const browserSafetyState = { // Used by the in-game debug surface to inspect blocked browser actions without needing browser devtools.
    blockedReloads: 0,
    blockedHistoryNavigations: 0,
    blockedContextMenus: 0,
    unloadWarnings: 0,
    lastBlocked: null,
    allowUnloadUntil: 0,
  };

  function fullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  function requestMethod(element) {
    return element?.requestFullscreen || element?.webkitRequestFullscreen || null;
  }

  function exitMethod() {
    return document.exitFullscreen || document.webkitExitFullscreen || null;
  }

  function supportsFullscreen() {
    const root = document.documentElement;
    return !!requestMethod(root) && (document.fullscreenEnabled !== false) && (document.webkitFullscreenEnabled !== false);
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style'); // Used to keep the fullscreen control independent of the large shared stylesheet.
    style.id = STYLE_ID;
    style.textContent = `
      #${BUTTON_ID} {
        position: fixed;
        top: calc(env(safe-area-inset-top, 0px) + 10px);
        left: calc(env(safe-area-inset-left, 0px) + 10px);
        z-index: 23000;
        width: 36px;
        height: 36px;
        display: grid;
        place-items: center;
        margin: 0;
        padding: 0;
        border: 2px solid rgba(255,255,255,.82);
        border-radius: 9px;
        background: rgba(13,16,22,.74);
        color: #fff;
        box-shadow: 0 3px 12px rgba(0,0,0,.48), inset 0 0 0 1px rgba(0,0,0,.42);
        -webkit-backdrop-filter: blur(4px);
        backdrop-filter: blur(4px);
        touch-action: manipulation;
        -webkit-tap-highlight-color: transparent;
        cursor: pointer;
        user-select: none;
      }
      #${BUTTON_ID}:hover { background: rgba(31,38,50,.9); }
      #${BUTTON_ID}:active { transform: scale(.92); }
      #${BUTTON_ID}:focus-visible { outline: 3px solid #fff2a1; outline-offset: 3px; }
      #${BUTTON_ID}[data-fullscreen="true"] {
        background: rgba(36,54,43,.88);
        border-color: #dfffdc;
      }
      #${BUTTON_ID}[data-supported="false"] { opacity: .58; }
      #${BUTTON_ID} svg { width: 20.25px; height: 20.25px; display: block; pointer-events: none; }
      #${FEEDBACK_ID} {
        position: fixed;
        top: calc(env(safe-area-inset-top, 0px) + 52px);
        left: calc(env(safe-area-inset-left, 0px) + 10px);
        z-index: 23001;
        max-width: min(82vw, 330px);
        padding: 7px 10px;
        border-radius: 8px;
        background: rgba(0,0,0,.84);
        color: #fff;
        font: 600 12px/1.25 system-ui, sans-serif;
        pointer-events: none;
        opacity: 0;
        transform: translateY(-3px);
        transition: opacity .14s ease, transform .14s ease;
      }
      #${FEEDBACK_ID}.show { opacity: 1; transform: translateY(0); }
      @media (pointer: coarse) {
        #${BUTTON_ID} { width: 40.5px; height: 40.5px; border-radius: 10.5px; }
        #${BUTTON_ID} svg { width: 23.25px; height: 23.25px; }
        #${FEEDBACK_ID} { top: calc(env(safe-area-inset-top, 0px) + 56.5px); }
      }
    `;
    document.head.appendChild(style);
  }

  function iconMarkup(active) {
    return active
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3H3v6M15 3h6v6M9 21H3v-6M15 21h6v-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  let feedbackTimer = 0; // Used to collapse repeated fullscreen/browser-safety status messages into one short-lived on-screen notice.
  function showFeedback(message) {
    let feedback = document.getElementById(FEEDBACK_ID);
    if (!feedback) {
      feedback = document.createElement('div');
      feedback.id = FEEDBACK_ID;
      feedback.setAttribute('role', 'status');
      feedback.setAttribute('aria-live', 'polite');
      document.body.appendChild(feedback);
    }
    feedback.textContent = message;
    feedback.classList.add('show');
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => feedback.classList.remove('show'), 2200);
  }

  function shortcutLabel(event) {
    const parts = []; // Used to build a readable diagnostic for whichever browser shortcut was intercepted.
    if (event.ctrlKey) parts.push('Ctrl');
    if (event.metaKey) parts.push('Cmd');
    if (event.altKey) parts.push('Alt');
    if (event.shiftKey) parts.push('Shift');
    parts.push(event.code === 'KeyR' ? 'R' : event.key || event.code || '?');
    return parts.join('+');
  }

  function logBrowserSafety(message, level = 'info') {
    if (typeof window.__farmLog === 'function') window.__farmLog(`[BrowserSafety] ${message}`, level, 'ui');
  }

  function blockBrowserAction(event, kind, message) {
    event.preventDefault();
    event.stopImmediatePropagation();
    browserSafetyState.lastBlocked = { // Used to make the latest intercepted shortcut/action visible through HobunjiBrowserSafety.getState().
      kind,
      shortcut: shortcutLabel(event),
      at: new Date().toISOString(),
    };
    if (kind === 'reload') browserSafetyState.blockedReloads += 1;
    else if (kind === 'history') browserSafetyState.blockedHistoryNavigations += 1;
    showFeedback(message);
    logBrowserSafety(`${message} (${browserSafetyState.lastBlocked.shortcut})`, 'warn');
  }

  function isReloadShortcut(event) {
    if (event.code === 'F5' || event.key === 'F5') return true;
    const reloadModifier = event.ctrlKey || event.metaKey; // Used to cover Ctrl+R/Command+R and their Shift hard-reload variants.
    return reloadModifier && (event.code === 'KeyR' || String(event.key).toLowerCase() === 'r');
  }

  function isHistoryShortcut(event) {
    if (!event.altKey || event.ctrlKey || event.metaKey) return false;
    return event.code === 'ArrowLeft' || event.code === 'ArrowRight';
  }

  function allowNextUnload() {
    browserSafetyState.allowUnloadUntil = Date.now() + UNLOAD_BYPASS_MS;
    logBrowserSafety('Intentional unload allowed for the next 5 seconds.');
  }

  function guardBeforeUnload(event) {
    if (Date.now() <= browserSafetyState.allowUnloadUntil) {
      browserSafetyState.allowUnloadUntil = 0;
      return;
    }
    browserSafetyState.unloadWarnings += 1;
    browserSafetyState.lastBlocked = { kind: 'unload-warning', shortcut: 'browser navigation', at: new Date().toISOString() };
    event.preventDefault();
    event.returnValue = '';
  }

  function reloadIntentionally() {
    allowNextUnload();
    window.location.reload();
  }

  async function enterFullscreen() {
    const root = document.documentElement;
    const request = requestMethod(root); // Used to support both standard and WebKit fullscreen entry from the same button.
    if (!request) {
      showFeedback('Fullscreen is not available in this browser.');
      return false;
    }
    try {
      // navigationUI:'hide' is supported by Chromium and harmlessly ignored
      // elsewhere; retry without options for stricter implementations.
      try {
        await request.call(root, { navigationUI: 'hide' });
      } catch (firstError) {
        if (fullscreenElement()) return true;
        await request.call(root);
      }
      return !!fullscreenElement();
    } catch (error) {
      console.warn('Fullscreen request failed:', error);
      showFeedback('Fullscreen could not start. Tap the button again.');
      return false;
    }
  }

  async function leaveFullscreen() {
    const exit = exitMethod(); // Used by the same control so mobile users never need a browser-specific escape gesture.
    if (!exit || !fullscreenElement()) return true;
    try {
      await exit.call(document);
      return !fullscreenElement();
    } catch (error) {
      console.warn('Fullscreen exit failed:', error);
      showFeedback('Fullscreen could not close.');
      return false;
    }
  }

  async function toggleFullscreen() {
    return fullscreenElement() ? leaveFullscreen() : enterFullscreen();
  }

  function updateButton() {
    const button = document.getElementById(BUTTON_ID);
    if (!button) return;
    const active = !!fullscreenElement(); // Used to swap both the icon geometry and accessibility label after browser/native exits.
    const supported = supportsFullscreen();
    button.dataset.fullscreen = String(active);
    button.dataset.supported = String(supported);
    button.innerHTML = iconMarkup(active);
    button.setAttribute('aria-label', active ? 'Exit fullscreen' : 'Enter fullscreen');
    button.title = active ? 'Exit fullscreen (Esc)' : 'Fullscreen (Alt+Enter)';
  }

  function ensureButton() {
    if (!document.body || document.getElementById(BUTTON_ID)) return;
    ensureStyles();
    const button = document.createElement('button'); // Used as the persistent one-tap/one-click fullscreen entry and exit control.
    button.id = BUTTON_ID;
    button.type = 'button';
    button.addEventListener('pointerdown', event => event.stopPropagation());
    button.addEventListener('click', async event => {
      event.preventDefault();
      event.stopPropagation();
      if (!supportsFullscreen() && !fullscreenElement()) {
        showFeedback('Fullscreen is not available in this browser.');
        return;
      }
      await toggleFullscreen();
      updateButton();
    });
    document.body.appendChild(button);
    updateButton();
  }

  function isTypingTarget(target) {
    const tag = target?.tagName?.toLowerCase?.();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || !!target?.isContentEditable;
  }

  document.addEventListener('fullscreenchange', updateButton);
  document.addEventListener('webkitfullscreenchange', updateButton);
  window.addEventListener('keydown', event => {
    if (isReloadShortcut(event)) {
      blockBrowserAction(event, 'reload', 'Reload shortcut blocked to protect your game session.');
      return;
    }
    if (isHistoryShortcut(event) && !isTypingTarget(event.target)) {
      blockBrowserAction(event, 'history', 'Browser back/forward shortcut blocked.');
      return;
    }
    if (event.altKey && event.code === 'Enter' && !event.ctrlKey && !event.metaKey && !isTypingTarget(event.target)) {
      event.preventDefault();
      event.stopPropagation();
      toggleFullscreen().then(updateButton);
    }
  }, true);

  // Right-click is a gameplay input, so suppress the browser menu without
  // consuming the earlier pointer/mouse events the control system listens to.
  document.addEventListener('contextmenu', event => {
    if (isTypingTarget(event.target)) return;
    event.preventDefault();
    browserSafetyState.blockedContextMenus += 1;
    browserSafetyState.lastBlocked = { kind: 'context-menu', shortcut: 'right-click', at: new Date().toISOString() };
  }, true);

  // This is the fallback for reload/close/navigation paths that do not come
  // through a cancelable keyboard event (toolbar reload, tab close, address
  // navigation, etc.). Browsers show their own generic confirmation text.
  window.addEventListener('beforeunload', guardBeforeUnload);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensureButton, { once: true });
  else ensureButton();

  // Small debug/test surface: also usable from mobile bookmarklets or an
  // in-game evaluator without needing browser devtools.
  window.HobunjiFullscreen = {
    enter: enterFullscreen,
    exit: leaveFullscreen,
    toggle: toggleFullscreen,
    isActive: () => !!fullscreenElement(),
    isSupported: supportsFullscreen,
    refresh: updateButton,
  };

  window.HobunjiBrowserSafety = {
    getState: () => ({ ...browserSafetyState, lastBlocked: browserSafetyState.lastBlocked ? { ...browserSafetyState.lastBlocked } : null }),
    allowNextUnload,
    reloadIntentionally,
  };
})();
