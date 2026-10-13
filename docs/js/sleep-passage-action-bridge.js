(() => {
  'use strict';

  if (Number(window.HobunjiSleepPassageActionBridge?.version) >= 2) return;

  const ACTION_BUTTON_IDS = Object.freeze(['btnAction1', 'btnAction2', 'btnAction3', 'btnItemAction1', 'btnItemAction2']); // Existing action-bar slots searched for the live Sleep interaction.
  const KEY_CODE_BY_LABEL = Object.freeze({ E: 'KeyE', Q: 'KeyQ', F3: 'F3', F4: 'F4' }); // Mirrors game.js DESK_KEYS without assuming Sleep always occupies Action 1.
  const OWNED_BED_SLEEP_PENDING_KEY = '__hobunjiOwnedBedSleepPending'; // One-shot token consumed by the blessing core only after Sleep was initiated from the player's bed interaction.
  const CHANGE_SUMMARY = 'Farmhouse-bed Sleep now arms a one-shot Well Rested token, preventing debug/other sleep passages from granting the 16-hour rest buff.'; // Mobile-visible diagnostics summary.
  const BRIDGE_SCRIPT_URL = document.currentScript?.src || document.baseURI || ''; // Used to resolve the companion devotion/rest runtime beside this bridge regardless of deployment base path.

  let armedKeyCode = null; // Non-E Sleep key held until release so the shared passage still opens on release like CalendarSystem tap actions.
  let interceptedKeyboardCount = 0; // Diagnostic count of legacy keyboard sleeps prevented by this bridge.
  let interceptedClickCount = 0; // Diagnostic count of legacy pointer/click sleeps prevented by this bridge.
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

  function onKeyDown(event) {
    if (event.repeat || textEntryOwnsInput(event) || passageIsOpen()) return;
    const button = sleepButton();
    const code = displayedKeyCode(button);
    if (!code || event.code !== code) return;

    // CalendarSystem already owns E's tap/hold interception correctly. The
    // regression was Sleep moving to Q/F3/F4 while that code still assumed E.
    // Leave E untouched so its established hold-selector semantics remain exact,
    // but arm the same player-bed token before the legacy handler receives it.
    if (code === 'KeyE') { armOwnedBedSleep(); return; }

    event.preventDefault();
    event.stopImmediatePropagation();
    armedKeyCode = code;
  }

  function onKeyUp(event) {
    if (!armedKeyCode || event.code !== armedKeyCode) return;
    const armed = armedKeyCode;
    armedKeyCode = null;
    event.preventDefault();
    event.stopImmediatePropagation();

    const button = sleepButton(); // Re-read the live action so a changed target cannot open Sleep accidentally.
    if (!buttonShowsSleep(button) || displayedKeyCode(button) !== armed) return;
    if (openSharedSleepPassage()) interceptedKeyboardCount += 1;
  }

  function onClickCapture(event) {
    const button = actionButtonFromTarget(event.target);
    if (!buttonShowsSleep(button) || passageIsOpen()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (openSharedSleepPassage()) interceptedClickCount += 1;
  }

  function loadDevotionRestRuntime() {
    if (!document?.createElement || !document.head || document.querySelector?.('script[data-hobunji-devotion-rest="1"]')) return false;
    const script = document.createElement('script'); // Used to keep the prayer/rest feature modular while piggybacking on the existing guaranteed sleep bridge bootstrap.
    script.dataset.hobunjiDevotionRest = '1';
    script.src = new URL('devotion-rest-buffs.js?v=20261013b', BRIDGE_SCRIPT_URL || document.baseURI).href;
    document.head.appendChild(script);
    return true;
  }

  function debugSnapshot() {
    const button = sleepButton();
    return {
      installed: true,
      version: 2,
      changeSummary: CHANGE_SUMMARY,
      sleepButtonId: button?.id || null,
      sleepKeyCode: displayedKeyCode(button),
      armedKeyCode,
      passageOpen: passageIsOpen(),
      ownedBedSleepPending: !!window[OWNED_BED_SLEEP_PENDING_KEY],
      ownedBedSleepArmCount,
      interceptedKeyboardCount,
      interceptedClickCount,
      devotionRestLoaded: !!window.DevotionRestBuffs,
      devotionRest: window.__devotionRestDebug?.() || null,
    };
  }

  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  document.addEventListener('click', onClickCapture, true); // Redundant pointer safety net; CalendarSystem's existing pointer capture remains authoritative when it fires first.
  loadDevotionRestRuntime();

  window.HobunjiSleepPassageActionBridge = Object.freeze({
    version: 2,
    debugSnapshot,
    _test: Object.freeze({ buttonShowsSleep, displayedKeyCode, armOwnedBedSleep }),
  });
  window.__sleepPassageActionDebug = debugSnapshot;
})();