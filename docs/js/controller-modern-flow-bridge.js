// Controller compatibility for newer full-screen flows that predate data-ctrl-panel.
//
// The universal controller navigator already knows how to drive buttons, ranges,
// tabs and text/select controls. This bridge only decorates the three newer
// modal/onboarding surfaces so they can use that existing navigator, plus the
// two contextual controller actions that cannot be represented by ordinary DOM
// focus: fast-forwarding the staged midnight review and opening seated Wait.
(() => {
  'use strict';

  if (window.ControllerModernFlowBridge?.version >= 1) return;

  const VERSION = 1;
  const FLOW_ROOT_SELECTOR = '#ob-overlay, #hobunjiDayProgressReview, .time-passage-backdrop'; // Used to opt legacy/new full-screen flows into ControllerUI without changing their owning modules.
  const ONBOARDING_BACK_SELECTOR = '#slBackToCharacter, #slBackToSource, #ob-back-btn'; // Used to make B follow the save/onboarding flow's existing Back buttons after every rerender.
  const DAY_REVIEW_ROOT_ID = 'hobunjiDayProgressReview'; // Used by the confirm bridge to distinguish staged reveal from the final Continue press.
  const TIME_PASSAGE_ROOT_SELECTOR = '.time-passage-backdrop'; // Used to decorate the shared Sleep/Wait selector for normal controller navigation.
  const SEATED_WAIT_ACTION_ID = 'action2'; // Used to honor the player's remapped Action 2 binding when Wait occupies the seated action arch.
  const UI_CONFIRM_ACTION_ID = 'uiConfirm'; // Used to honor the player's remapped menu-confirm binding on the staged midnight review.
  const CONTEXT_PRIORITY = Math.max(1, Number(window.ControllerInput?.PRIORITY?.menuNav || 10) - 1); // Runs just before generic menu navigation so same-frame contextual ownership is established first.

  let observer = null; // Retained for diagnostics and to prove the DOM compatibility bridge is active.
  let unsubscribe = null; // Retained for diagnostics and future cleanup of this module's shared-frame subscription.
  let decoratedRoots = 0; // Counts roots first opted into ControllerUI so mobile diagnostics can confirm discovery.
  let lastAction = 'ready'; // Records the most recent contextual controller route for mobile-visible debugging.

  function log(message, level = 'input') {
    try { window.__farmLog?.(`[controller-flows] ${message}`, level); }
    catch (_) { /* The bridge must never make controller input depend on debug logging. */ }
  }

  function configuredControllerBinding(actionId) {
    const current = window.InputBindings?.getCurrentBindings?.()?.controller; // Used to honor live controller remaps, including explicitly unbound actions.
    if (current && Object.prototype.hasOwnProperty.call(current, actionId)) return current[actionId];
    const defaults = window.InputBindings?.getDefaultBindings?.('controller'); // Used once InputBindings is available but no saved override exists.
    if (defaults && Object.prototype.hasOwnProperty.call(defaults, actionId)) return defaults[actionId];
    const authored = window.SCRATCHBONES_CONFIG?.game?.input?.actions?.find?.(entry => entry?.id === actionId); // Boot fallback before InputBindings finishes initializing.
    return authored?.controller || null;
  }

  function controllerActionPressed(frame, actionId) {
    const binding = configuredControllerBinding(actionId); // Used to convert this semantic action into the binding code already edge-detected by ControllerInput.
    return Boolean(binding && frame?.pressed?.has?.(binding));
  }

  function markCancelButton(button) {
    if (!button || button.hasAttribute('data-ctrl-cancel')) return;
    button.setAttribute('data-ctrl-cancel', '');
  }

  function decorateOnboarding(root) {
    for (const button of root.querySelectorAll(ONBOARDING_BACK_SELECTOR)) markCancelButton(button);
  }

  function decorateTimePassage(root) {
    markCancelButton(root.querySelector('#timePassageCancel'));
    const slider = root.querySelector('#timePassageSlider'); // Used as the first controller target so left/right immediately changes the wait duration.
    if (slider && !slider.hasAttribute('data-ctrl-default')) slider.setAttribute('data-ctrl-default', '');
  }

  function decorateFlowRoot(root) {
    if (!root?.matches?.(FLOW_ROOT_SELECTOR)) return false;
    const wasPanel = root.hasAttribute('data-ctrl-panel'); // Used to count only the first successful opt-in for diagnostics.
    if (!wasPanel) {
      root.setAttribute('data-ctrl-panel', '');
      decoratedRoots += 1;
    }
    if (root.id === 'ob-overlay') decorateOnboarding(root);
    if (root.matches(TIME_PASSAGE_ROOT_SELECTOR)) decorateTimePassage(root);
    return !wasPanel;
  }

  function decorateWithin(node) {
    if (!node || node.nodeType !== 1) return;
    decorateFlowRoot(node);
    for (const root of node.querySelectorAll?.(FLOW_ROOT_SELECTOR) || []) decorateFlowRoot(root);

    const onboardingRoot = node.matches?.('#ob-overlay') ? node : node.closest?.('#ob-overlay'); // Used to refresh Back semantics when onboarding replaces its innerHTML between steps.
    if (onboardingRoot) decorateOnboarding(onboardingRoot);
    const passageRoot = node.matches?.(TIME_PASSAGE_ROOT_SELECTOR) ? node : node.closest?.(TIME_PASSAGE_ROOT_SELECTOR); // Used when the shared time-passage controls are constructed beneath an already-known root.
    if (passageRoot) decorateTimePassage(passageRoot);
  }

  function installDomDecoration() {
    if (typeof document === 'undefined' || typeof MutationObserver !== 'function') return;
    const root = document.documentElement; // Observed early, before ControllerUI boots, so newly-created modal roots carry data-ctrl-panel by the time ControllerUI sees their child-list mutation.
    if (!root) return;
    decorateWithin(root);
    observer = new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.addedNodes) decorateWithin(node);
      }
    });
    observer.observe(root, { childList: true, subtree: true });
  }

  function dayReviewRoot() {
    if (typeof document === 'undefined') return null;
    const root = document.getElementById(DAY_REVIEW_ROOT_ID); // Used as the authoritative staged-review visibility and event target.
    return root?.classList?.contains('open') ? root : null;
  }

  function tryFastForwardDayReview(frame) {
    const root = dayReviewRoot();
    if (!root || !controllerActionPressed(frame, UI_CONFIRM_ACTION_ID)) return false;
    const continueButton = root.querySelector('#dayReviewContinue'); // Used to leave the final ready-state press to ControllerUI's ordinary button activation path.
    if (!continueButton || continueButton.classList.contains('ready')) return false;
    root.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }));
    lastAction = 'day review reveal fast-forwarded';
    log(lastAction);
    return true;
  }

  function seatedWaitButton() {
    if (typeof document === 'undefined') return null;
    const button = document.getElementById('btnAction2'); // Action 2 is repurposed by CalendarSystem only while the player is seated in a usable chair.
    if (!button || button.classList.contains('abt-hidden') || button.classList.contains('blocked')) return null;
    return button.dataset?.action === 'calendar_wait' ? button : null;
  }

  function tryOpenSeatedWait(frame) {
    if (window.ControllerInput?.owner !== 'gameplay') return false;
    if (window.ControllerUI?.isActive?.()) return false;
    if (!controllerActionPressed(frame, SEATED_WAIT_ACTION_ID) || !seatedWaitButton()) return false;
    const open = window.CalendarSystem?.openTimePassage; // CalendarSystem remains the single owner of wait duration, time passage, iris animation and resource/calendar effects.
    if (typeof open !== 'function') {
      lastAction = 'seated wait unavailable: CalendarSystem not ready';
      log(lastAction, 'warn');
      return false;
    }

    window.ControllerInput.setOwner('menu'); // Claims the same frame before gameplay dispatch can consume the remapped Action 2 press as an ordinary tool/item action.
    const opened = open.call(window.CalendarSystem, 'wait');
    if (opened === false) {
      if (!window.ControllerUI?.isActive?.() && window.ControllerInput.owner === 'menu') window.ControllerInput.setOwner('gameplay');
      lastAction = 'seated wait failed to open';
      log(lastAction, 'warn');
      return false;
    }
    lastAction = 'seated wait opened from Action 2';
    log(lastAction);
    return true;
  }

  function onControllerFrame(frame) {
    if (!frame?.focused || !frame.pad) return;
    if (tryFastForwardDayReview(frame)) return;
    tryOpenSeatedWait(frame);
  }

  installDomDecoration();
  unsubscribe = window.ControllerInput?.subscribe?.('controller-modern-flow-bridge', onControllerFrame, CONTEXT_PRIORITY) || null;

  window.ControllerModernFlowBridge = {
    version: VERSION,
    refresh: () => { if (typeof document !== 'undefined') decorateWithin(document.documentElement); },
    getDebug: () => ({
      installed: true,
      version: VERSION,
      subscribed: typeof unsubscribe === 'function',
      observingDom: Boolean(observer),
      decoratedRoots,
      owner: window.ControllerInput?.owner || null,
      activePanel: window.ControllerUI?.activePanel?.()?.id || window.ControllerUI?.activePanel?.()?.className || null,
      onboardingRecognized: typeof document !== 'undefined' && Boolean(document.getElementById('ob-overlay')?.hasAttribute('data-ctrl-panel')),
      dayReviewRecognized: typeof document !== 'undefined' && Boolean(document.getElementById(DAY_REVIEW_ROOT_ID)?.hasAttribute('data-ctrl-panel')),
      timePassageRecognized: typeof document !== 'undefined' && Boolean(document.querySelector(TIME_PASSAGE_ROOT_SELECTOR)?.hasAttribute('data-ctrl-panel')),
      seatedWaitReady: Boolean(seatedWaitButton()),
      lastAction,
    }),
  };
})();
