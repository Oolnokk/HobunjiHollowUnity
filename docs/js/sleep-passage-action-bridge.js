(() => {
  'use strict';

  const VERSION = 3; // Used by the parser-time guard and mobile-visible diagnostics for this input-routing revision.
  if (Number(window.HobunjiSleepPassageActionBridge?.version) >= VERSION) return;

  const ACTION_BUTTON_IDS = Object.freeze(['btnAction1', 'btnAction2', 'btnAction3', 'btnItemAction1', 'btnItemAction2']); // Existing action-bar slots searched for the live Sleep interaction.
  const KEY_CODE_BY_LABEL = Object.freeze({ E: 'KeyE', Q: 'KeyQ', F3: 'F3', F4: 'F4' }); // Mirrors game.js DESK_KEYS without assuming Sleep always occupies Action 1.
  const OWNED_BED_SLEEP_PENDING_KEY = '__hobunjiOwnedBedSleepPending'; // One-shot token consumed by the blessing core only after Sleep was initiated from the player's bed interaction.
  const CHANGE_SUMMARY = 'Player-bed Sleep now owns pointer and keyboard press/release before legacy game input, preventing the starter farmhouse bed from jumping straight to 6 AM.'; // Mobile-visible diagnostics summary.
  const BRIDGE_SCRIPT_URL = document.currentScript?.src || document.baseURI || ''; // Used to resolve the companion devotion/rest runtime beside this bridge regardless of deployment base path.

  let armedKeyCode = null; // Sleep key held until release so the shared passage opens on release rather than allowing legacy sleep to run on press.
  let armedHoldArc = null; // 'tool'|'item' while E/Q must preserve their ordinary hold-to-selector behavior.
  let armedWasHeld = false; // Distinguishes a selector hold from a Sleep tap when the armed key is released.
  let armedHoldTimer = 0; // Delays E/Q selector opening by the same configured desktop tap window used by game.js/CalendarSystem.
  let interceptedKeyboardCount = 0; // Diagnostic count of legacy keyboard sleeps prevented by this bridge.
  let interceptedPointerCount = 0; // Diagnostic count of pointer releases routed to shared Sleep before legacy bed handlers can run.
  let interceptedClickCount = 0; // Diagnostic count of legacy/synthetic clicks prevented by this bridge.
  let ownedBedSleepArmCount = 0; // Diagnostic count proving real bed interactions, rather than generic Sleep events, armed Well Rested.

  function actionButtonFromTarget(target) {
    const button = target?.closest?.('button'); // Nested icon/label taps normalize to their action button.
    return button && ACTION_BUTTON_IDS.includes(button.id) ? button : null;
  }

  function buttonShowsSleep(button) {
    if (!button || button.classList?.contains?.('abt-hidden')) return false;
    if (button.dataset?.action !== 'obj_interact') return false;
    const label = button.querySelector?.('.abt-label')?.textContent || button.textContent || ''; // Prefer the authored action label over key/icon text.
    return /^\s*Sleep\s*$/i.test(String(label).trim()) || /\bSleep\b/i.test(String(label));
  }

  function sleepButton() {
    return ACTION_BUTTON_IDS.map(id => document.getElementById(id)).find(buttonShowsSleep) || null;
  }

  function displayedKeyCode(button = sleepButton()) {
    const badge = String(button?.querySelector?.('.abt-key')?.textContent || '').replace(/[\[\]\s]/g, '').toUpperCase(); // Existing [E]/[Q]/[F3]/[F4] badge normalized to KeyboardEvent.code.
    return KEY_CODE_BY_LABEL[badge] || null;
  }

  function passageIsOpen() {
    return !!document.querySelector?.('.time-passage-backdrop.open');
  }

  function textEntryOwnsInput(event) {
    const target = event?.target;
    if (target?.matches?.('input,textarea,select,[contenteditable="true"]')) return true;
    return !!window.PlayerChat?.isOpen;
  }

  function consumeEvent(event) {
    event?.preventDefault?.();
    event?.stopImmediatePropagation?.();
  }

  function armOwnedBedSleep() {
    window[OWNED_BED_SLEEP_PENDING_KEY] = { source: 'player-bed', armedAtMs: Date.now() }; // Consumed exactly once by the completed Sleep passage event.
    ownedBedSleepArmCount += 1;
    return true;
  }

  function openSharedSleepPassage() {
    if (passageIsOpen()) return true;
    const open = window.CalendarSystem?.openTimePassage; // CalendarSystem remains the single owner of selector, iris, hourly passage, and sleep restoration.
    if (typeof open !== 'function') return false;
    armOwnedBedSleep();
    open.call(window.CalendarSystem, 'sleep');
    return true;
  }

  function holdArcForKeyCode(code) {
    if (code === 'KeyE') return 'tool';
    if (code === 'KeyQ') return 'item';
    return null;
  }

  function desktopTapWindowMs() {
    return Number(window.SCRATCHBONES_CONFIG?.game?.desktopControls?.tapWindowMs) || 350;
  }

  function openHoldArc(arc) {
    if (arc === 'item') window._desktopSelectionArc?.openItem?.();
    else if (arc === 'tool') window._desktopSelectionArc?.openTool?.();
  }

  function closeHoldArc() {
    window._desktopSelectionArc?.close?.();
  }

  function clearArmedKey({ closeHeldArc = false } = {}) {
    if (armedHoldTimer) clearTimeout(armedHoldTimer);
    window.removeEventListener('wheel', onWheel, true); // The non-passive wheel listener exists only while a Sleep key is armed.
    if (closeHeldArc && armedWasHeld) closeHoldArc();
    armedKeyCode = null;
    armedHoldArc = null;
    armedWasHeld = false;
    armedHoldTimer = 0;
  }

  function onKeyDown(event) {
    if (event.repeat || textEntryOwnsInput(event) || passageIsOpen()) return;
    const button = sleepButton();
    const code = displayedKeyCode(button);
    if (!code || event.code !== code) return;

    // This bridge loads before game.js specifically so Sleep wins the input race.
    // Owning E here is intentional: delegating E to CalendarSystem allowed the
    // legacy sleepInBed() listener to run first on some startup/input paths.
    consumeEvent(event);
    clearArmedKey({ closeHeldArc: true });
    armedKeyCode = code;
    armedHoldArc = holdArcForKeyCode(code);
    armedWasHeld = false;
    if (armedHoldArc) {
      window.addEventListener('wheel', onWheel, { capture: true, passive: false }); // Held E/Q may scroll the selector; ordinary scrolling never waits on this handler.
      armedHoldTimer = setTimeout(() => {
        if (!armedKeyCode || !armedHoldArc) return;
        armedWasHeld = true;
        armedHoldTimer = 0;
        openHoldArc(armedHoldArc);
      }, desktopTapWindowMs());
    }
  }

  function onKeyUp(event) {
    if (!armedKeyCode || event.code !== armedKeyCode) return;
    consumeEvent(event);

    const releasedCode = armedKeyCode; // Used below to verify the visible Sleep binding did not change while the key was held.
    const wasHeld = armedWasHeld; // Used below to close a selector hold without opening the Sleep passage.
    if (armedHoldTimer) clearTimeout(armedHoldTimer);
    armedHoldTimer = 0;
    if (wasHeld) {
      closeHoldArc();
      clearArmedKey();
      return;
    }

    clearArmedKey();
    const button = sleepButton(); // Re-read the live action so a changed target cannot open Sleep accidentally.
    if (!buttonShowsSleep(button) || displayedKeyCode(button) !== releasedCode) return;
    if (openSharedSleepPassage()) interceptedKeyboardCount += 1;
  }

  function onWheel(event) {
    if (!armedKeyCode || !armedHoldArc) return;
    consumeEvent(event);
    if (!armedWasHeld) {
      if (armedHoldTimer) clearTimeout(armedHoldTimer);
      armedHoldTimer = 0;
      armedWasHeld = true;
      openHoldArc(armedHoldArc);
    }
    const direction = event.deltaY > 0 ? 1 : -1; // Matches game.js/CalendarSystem held-wheel selector sign convention.
    if (armedHoldArc === 'item') window._desktopSelectionArc?.scrollItem?.(-direction);
    else window._desktopSelectionArc?.scrollTool?.(-direction);
  }

  function onPointerCapture(event) {
    const button = actionButtonFromTarget(event.target);
    if (!buttonShowsSleep(button)) return;
    consumeEvent(event);
    if (event.type !== 'pointerup' || passageIsOpen()) return;
    if (openSharedSleepPassage()) interceptedPointerCount += 1;
  }

  function onClickCapture(event) {
    const button = actionButtonFromTarget(event.target);
    if (!buttonShowsSleep(button)) return;

    // Always consume the trailing click, even when pointerup already opened the
    // passage. Returning merely because the modal is open would let game.js's
    // older click handler continue into sleepInBed() and jump to next morning.
    consumeEvent(event);
    if (!passageIsOpen() && openSharedSleepPassage()) interceptedClickCount += 1;
  }

  function loadDevotionRestRuntime() {
    if (!document?.createElement || !document.head || document.querySelector?.('script[data-hobunji-devotion-rest="1"]')) return false;
    const script = document.createElement('script'); // Used to keep the prayer/rest feature modular while piggybacking on the existing guaranteed sleep bridge bootstrap.
    script.dataset.hobunjiDevotionRest = '1';
    script.src = new URL('devotion-rest-buffs.js?v=20261027hca4d5dd', BRIDGE_SCRIPT_URL || document.baseURI).href;
    document.head.appendChild(script);
    return true;
  }

  function debugSnapshot() {
    const button = sleepButton();
    return {
      installed: true,
      version: VERSION,
      changeSummary: CHANGE_SUMMARY,
      sleepButtonId: button?.id || null,
      sleepKeyCode: displayedKeyCode(button),
      armedKeyCode,
      armedHoldArc,
      armedWasHeld,
      passageOpen: passageIsOpen(),
      ownedBedSleepPending: !!window[OWNED_BED_SLEEP_PENDING_KEY],
      ownedBedSleepArmCount,
      interceptedKeyboardCount,
      interceptedPointerCount,
      interceptedClickCount,
      devotionRestLoaded: !!window.DevotionRestBuffs,
      devotionRest: window.__devotionRestDebug?.() || null,
    };
  }

  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('blur', () => clearArmedKey({ closeHeldArc: true }));
  document.addEventListener('pointerdown', onPointerCapture, true);
  document.addEventListener('pointerup', onPointerCapture, true);
  document.addEventListener('click', onClickCapture, true);
  loadDevotionRestRuntime();

  window.HobunjiSleepPassageActionBridge = Object.freeze({
    version: VERSION,
    openSharedSleepPassage,
    debugSnapshot,
    _test: Object.freeze({ buttonShowsSleep, displayedKeyCode, armOwnedBedSleep, holdArcForKeyCode }),
  });
  window.__sleepPassageActionDebug = debugSnapshot;
})();