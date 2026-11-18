// Keyboard-driven fullscreen and browser-safety helpers.
// Alt+Enter toggles the browser Fullscreen API (with WebKit fallback), while
// Escape remains the browser-native exit. No permanent fullscreen HUD button.
(() => {
  'use strict';

  const STYLE_ID = 'hobunjiFullscreenFeedbackStyle'; // Used to install the transient browser-safety feedback styles once.
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
      #${FEEDBACK_ID} {
        position: fixed;
        top: calc(env(safe-area-inset-top, 0px) + 10px);
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
    `;
    document.head.appendChild(style);
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
    const request = requestMethod(root); // Used by Alt+Enter and the public fullscreen API across standard/WebKit browsers.
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
      showFeedback('Fullscreen could not start. Try Alt+Enter again.');
      return false;
    }
  }

  async function leaveFullscreen() {
    const exit = exitMethod(); // Used by Alt+Enter and the public API; Escape still exits natively.
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

  function isTypingTarget(target) {
    const tag = target?.tagName?.toLowerCase?.();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || !!target?.isContentEditable;
  }

  window.addEventListener('keydown', event => {
    if (isReloadShortcut(event)) {
      blockBrowserAction(event, 'reload', 'Reload shortcut blocked to protect your game session.');
      return;
    }
    if (isHistoryShortcut(event) && !isTypingTarget(event.target)) {
      blockBrowserAction(event, 'history', 'Browser back/forward shortcut blocked.');
      return;
    }
    if (event.altKey && (event.code === 'Enter' || event.code === 'NumpadEnter' || event.key === 'Enter')
        && !event.ctrlKey && !event.metaKey && !isTypingTarget(event.target)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) void toggleFullscreen(); // Ignore key-repeat so one hold cannot rapidly enter and exit fullscreen.
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

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensureStyles, { once: true });
  else ensureStyles();

  // Small debug/test surface: also usable from mobile bookmarklets or an
  // in-game evaluator without needing browser devtools.
  window.HobunjiFullscreen = {
    enter: enterFullscreen,
    exit: leaveFullscreen,
    toggle: toggleFullscreen,
    isActive: () => !!fullscreenElement(),
    isSupported: supportsFullscreen,
    refresh: ensureStyles,
  };

  window.HobunjiBrowserSafety = {
    getState: () => ({ ...browserSafetyState, lastBlocked: browserSafetyState.lastBlocked ? { ...browserSafetyState.lastBlocked } : null }),
    allowNextUnload,
    reloadIntentionally,
  };
})();
