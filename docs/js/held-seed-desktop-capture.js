// Desktop action-button input adapter.
//
// The visible action buttons are authoritative because their pointer path already works on touch.
// Route configured action1..action5 keys through those exact rendered buttons instead of rebuilding
// a parallel action list. Also replace game.js's stale hard-coded E/Q/F3/F4 badges with the real
// configured bindings. World Interact (normally E) remains owned by game.js.
(() => {
  'use strict';

  if (window.HobunjiHeldSeedDesktopCapture) return;
  if (typeof window.matchMedia === 'function' && !window.matchMedia('(pointer: fine)').matches) return;

  const ACTION_BUTTON_IDS = ['btnAction1', 'btnAction2', 'btnAction3', 'btnItemAction1', 'btnItemAction2']; // Used as the five rendered semantic action slots populated by refreshActionBar().
  const activePresses = new Map(); // Used to pair keydown/keyup with the exact button pressed even if the action bar refreshes mid-hold.
  const ownedCodes = new Set(); // Used to stop game.js's older array-index fallback from also firing a claimed action key.
  const qHoldState = { down: false, held: false, timer: null }; // Used to preserve Q-hold item selection while making a Q tap activate rendered action2.
  let syntheticPointerId = 9100; // Used to give keyboard-driven button presses stable pointer identities accepted by the existing pointer handlers.
  let lastRouteDebug = null; // Used by diagnostics to report the last desktop action route.
  let badgeSyncPending = false; // Used to coalesce repeated action-bar DOM mutations into one badge refresh.

  function inputConfig() {
    return window.SCRATCHBONES_CONFIG?.game?.input || {};
  }

  function savedBindings() {
    const config = inputConfig();
    try { return JSON.parse(localStorage.getItem(config.storageKey || 'scratchbones.inputBindings.v1') || 'null') || {}; }
    catch (_) { return {}; }
  }

  function desktopCodeForAction(actionId) {
    const config = inputConfig();
    const authored = Array.isArray(config.actions)
      ? config.actions.find(action => action?.id === actionId)?.desktop
      : null; // Used as the authored fallback when the player has not remapped this semantic action.
    return savedBindings()?.desktop?.[actionId] || authored || null;
  }

  function actionIdForDesktopCode(code) {
    const actions = inputConfig().actions;
    if (!Array.isArray(actions)) return null;
    const saved = savedBindings(); // Used once per event to honor the same persistent remaps as game.js.
    for (const action of actions) {
      const binding = saved?.desktop?.[action.id] || action.desktop || null; // Used to resolve a physical key back to one semantic action id.
      if (binding === code) return action.id;
    }
    return null;
  }

  function actionSlotFromId(actionId) {
    const match = /^action([1-5])$/.exec(String(actionId || '')); // Used to claim only slots represented by real visible action buttons.
    return match ? Number(match[1]) : null;
  }

  function visibleButtonAtSlot(slot) {
    const id = ACTION_BUTTON_IDS[slot - 1]; // Used to make rendered slot position authoritative rather than computeActionButtons array position.
    const button = id ? document.getElementById(id) : null;
    if (!button || button.classList?.contains?.('abt-hidden') || !button.dataset?.action) return null;
    return button;
  }

  function typingTarget(target) {
    return Boolean(target?.matches?.('input, textarea, select, [contenteditable="true"]'));
  }

  function gameplayBlocked(event) {
    if (typingTarget(event?.target)) return true;
    if (document.getElementById('menuPanel')?.classList?.contains?.('open')) return true;
    if (window.Fishing?.state?.active) return true; // Fishing owns its own primary/cancel keys instead of the normal action arch.
    return false;
  }

  function makePointerEvent(type, pointerId, sourceEvent, button) {
    const rect = button?.getBoundingClientRect?.() || { left: 0, top: 0, width: 0, height: 0 }; // Used to keep synthetic input stationary at the button center so drag-to-aim is never triggered accidentally.
    const init = {
      bubbles: true,
      cancelable: true,
      pointerId,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons: type === 'pointerdown' ? 1 : 0,
      clientX: Number(rect.left) + Number(rect.width) * 0.5,
      clientY: Number(rect.top) + Number(rect.height) * 0.5,
      ctrlKey: Boolean(sourceEvent?.ctrlKey),
      shiftKey: Boolean(sourceEvent?.shiftKey),
      altKey: Boolean(sourceEvent?.altKey),
      metaKey: Boolean(sourceEvent?.metaKey),
    }; // Used to feed keyboard input into the exact pointer-owned button path that already works on touch.
    if (typeof PointerEvent === 'function') return new PointerEvent(type, init);
    const fallback = new Event(type, { bubbles: true, cancelable: true }); // Used by older WebViews where PointerEvent is not constructible.
    for (const [key, value] of Object.entries(init)) {
      try { Object.defineProperty(fallback, key, { configurable: true, value }); } catch (_) { /* best-effort compatibility field */ }
    }
    return fallback;
  }

  function startRenderedPress(code, slot, sourceEvent) {
    if (activePresses.has(code)) return false;
    const button = visibleButtonAtSlot(slot); // Used to bind this key press to the contextual action visibly occupying the slot right now.
    if (!button?.dispatchEvent) return false;
    const pointerId = ++syntheticPointerId;
    activePresses.set(code, { button, pointerId, slot, action: button.dataset.action });
    button.dispatchEvent(makePointerEvent('pointerdown', pointerId, sourceEvent, button));
    lastRouteDebug = { phase: 'press', code, slot, action: button.dataset.action, buttonId: button.id || ACTION_BUTTON_IDS[slot - 1] };
    return true;
  }

  function finishRenderedPress(code, sourceEvent, cancel = false) {
    const press = activePresses.get(code);
    if (!press) return false;
    activePresses.delete(code);
    press.button.dispatchEvent(makePointerEvent(cancel ? 'pointercancel' : 'pointerup', press.pointerId, sourceEvent, press.button));
    lastRouteDebug = { phase: cancel ? 'cancel' : 'release', code, slot: press.slot, action: press.action, buttonId: press.button.id || ACTION_BUTTON_IDS[press.slot - 1] };
    return true;
  }

  function tapWindowMs() {
    return Number(window.SCRATCHBONES_CONFIG?.game?.desktopControls?.tapWindowMs) || 350;
  }

  function openQItemArc() {
    if (!qHoldState.down || qHoldState.held) return;
    qHoldState.held = true;
    window._desktopSelectionArc?.openItem?.();
  }

  function beginQHold(event) {
    if (qHoldState.down || event.repeat) return;
    qHoldState.down = true;
    qHoldState.held = false;
    qHoldState.timer = setTimeout(openQItemArc, tapWindowMs());
  }

  function finishQHold(event) {
    if (!qHoldState.down) return false;
    qHoldState.down = false;
    if (qHoldState.timer) { clearTimeout(qHoldState.timer); qHoldState.timer = null; }
    const wasHeld = qHoldState.held;
    qHoldState.held = false;
    if (wasHeld) {
      window._desktopSelectionArc?.close?.();
      lastRouteDebug = { phase: 'item-wheel-release', code: 'KeyQ', slot: null, action: null, buttonId: null };
      return true;
    }

    const actionId = actionIdForDesktopCode('KeyQ'); // Used so Q tap follows its configured semantic action instead of game.js's old "second allowed action" shortcut.
    const slot = actionSlotFromId(actionId);
    if (!slot) return true;
    const started = startRenderedPress('KeyQ', slot, event);
    if (started) finishRenderedPress('KeyQ', event);
    else lastRouteDebug = { phase: 'empty-slot', code: 'KeyQ', slot, action: null, buttonId: ACTION_BUTTON_IDS[slot - 1] };
    return true;
  }

  function claim(event) {
    event.preventDefault?.();
    event.stopImmediatePropagation?.();
  }

  function onKeyDown(event) {
    if (gameplayBlocked(event)) return;

    if (event.code === 'KeyQ') {
      beginQHold(event);
      claim(event);
      return;
    }

    const actionId = actionIdForDesktopCode(event.code); // Used to resolve non-Q configured desktop action-slot keys.
    const slot = actionSlotFromId(actionId);
    if (!slot || event.repeat) return;
    ownedCodes.add(event.code);
    if (!startRenderedPress(event.code, slot, event)) {
      lastRouteDebug = { phase: 'empty-slot', code: event.code, slot, action: null, buttonId: ACTION_BUTTON_IDS[slot - 1] }; // Used so an empty visible slot means no action rather than a hidden fallback action.
    }
    claim(event);
  }

  function onKeyUp(event) {
    if (event.code === 'KeyQ' && qHoldState.down) {
      finishQHold(event);
      claim(event);
      return;
    }
    const owned = ownedCodes.delete(event.code); // Used to consume release even when keydown intentionally targeted an empty rendered slot.
    const finished = finishRenderedPress(event.code, event);
    if (!owned && !finished) return;
    claim(event);
  }

  function onWheel(event) {
    if (!qHoldState.down) return;
    if (qHoldState.timer) { clearTimeout(qHoldState.timer); qHoldState.timer = null; }
    openQItemArc();
    const direction = Number(event.deltaY) > 0 ? 1 : -1; // Used to preserve game.js's existing Q+wheel item-selection direction.
    window._desktopSelectionArc?.scrollItem?.(-direction);
    claim(event);
  }

  function resetPressedState() {
    for (const code of [...activePresses.keys()]) finishRenderedPress(code, null, true);
    ownedCodes.clear();
    if (qHoldState.timer) clearTimeout(qHoldState.timer);
    qHoldState.timer = null;
    qHoldState.down = false;
    if (qHoldState.held) window._desktopSelectionArc?.close?.();
    qHoldState.held = false;
  }

  function keyBadgeLabel(code) {
    if (!code) return '';
    if (code === 'Space') return 'SPACE';
    if (code === 'Enter') return 'ENTER';
    if (code === 'Escape') return 'ESC';
    if (code.startsWith('Key')) return code.slice(3).toUpperCase();
    if (code.startsWith('Digit')) return code.slice(5);
    if (code.startsWith('Arrow')) return code.slice(5).toUpperCase();
    return code.toUpperCase();
  }

  function syncRenderedKeyBadges() {
    badgeSyncPending = false;
    for (let index = 0; index < ACTION_BUTTON_IDS.length; index++) {
      const button = document.getElementById(ACTION_BUTTON_IDS[index]); // Used to correct the stale E/Q/F3/F4 badges written by game.js after action-bar refreshes.
      if (!button || button.classList?.contains?.('abt-hidden') || !button.dataset?.action) continue;
      const label = keyBadgeLabel(desktopCodeForAction(`action${index + 1}`));
      let badge = button.querySelector?.('.abt-key') || null; // Used to reuse game.js's existing badge element when one exists.
      if (!label) {
        badge?.remove?.();
        continue;
      }
      if (!badge && document.createElement && button.prepend) {
        badge = document.createElement('span');
        badge.className = 'abt-key';
        button.prepend(badge);
      }
      if (badge && badge.textContent !== `[${label}]`) badge.textContent = `[${label}]`;
    }
  }

  function scheduleBadgeSync() {
    if (badgeSyncPending) return;
    badgeSyncPending = true;
    setTimeout(syncRenderedKeyBadges, 0);
  }

  function installBadgeSync() {
    syncRenderedKeyBadges();
    const stack = document.getElementById('actionStack'); // Used as the narrow observer root because refreshActionBar rewrites this action UI subtree.
    if (stack && typeof MutationObserver === 'function') {
      const observer = new MutationObserver(scheduleBadgeSync); // Used to correct badges immediately after game.js rewrites button innerHTML/class/action state.
      observer.observe(stack, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'data-action'] });
    }
  }

  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('wheel', onWheel, { capture: true, passive: false });
  window.addEventListener('blur', resetPressedState);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installBadgeSync, { once: true });
  else installBadgeSync();

  const api = {
    syncBadges: syncRenderedKeyBadges,
    getDebug: () => ({
      lastRoute: lastRouteDebug ? { ...lastRouteDebug } : null,
      qHeld: qHoldState.held,
      activeCodes: [...activePresses.keys()],
      ownedCodes: [...ownedCodes],
      slots: ACTION_BUTTON_IDS.map((id, index) => {
        const button = document.getElementById(id);
        return {
          slot: index + 1,
          id,
          action: button?.dataset?.action || null,
          hidden: Boolean(button?.classList?.contains?.('abt-hidden')),
          binding: desktopCodeForAction(`action${index + 1}`),
          shownBadge: button?.querySelector?.('.abt-key')?.textContent || null,
        };
      }),
    }),
  };

  window.HobunjiDesktopActionSlotRouter = api;
  window.HobunjiHeldSeedDesktopCapture = api; // Preserved so the existing loader's readiness check needs no changes.
})();
