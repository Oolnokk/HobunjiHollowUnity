// Folder Save Quit Guard — replaces the legacy Quit click path in capture phase.
// Live gameplay is persisted first, then the primary folder is written, then the
// page may reload. This prevents a perfectly-successful folder sync of stale RAM.
(() => {
  'use strict';

  if (window.FolderSaveQuitGuard) return;

  const QUIT_BUTTON_ID = 'menuQuitBtn'; // Existing menu Quit button intercepted before local-save-flow's bubble listener.
  const RESET_BUTTON_ID = 'menuResetBtn'; // Legacy one-click farm reset control kept inert and hidden so it cannot be triggered accidentally.
  const MANUAL_SAVE_BUTTON_ID = 'menuManualSaveBtn'; // Existing checkpoint button receives a temporary busy label without observing disabled mutations.
  const MENU_CONTROL_LABELS = Object.freeze([ // Full and compact labels let the menu header refit itself without hiding any action.
    { id: 'menuPauseBtn', text: '⏯ Pause', compactText: '⏯', minWidth: '70px', accessibleLabel: 'Pause or resume' },
    { id: MANUAL_SAVE_BUTTON_ID, text: '💾 Manual Save', compactText: '💾', minWidth: '96px', accessibleLabel: 'Manual save' },
    { id: 'menuRecoveryBtn', text: '🛟 Recovery', compactText: '🛟', minWidth: '82px', accessibleLabel: 'Recovery' },
    { id: 'mpClose', text: 'Close', compactText: '✕', minWidth: '66px', accessibleLabel: 'Close menu' },
  ]);
  const MENU_OVERLAY_CONTROL_IDS = Object.freeze(['menuBtn', 'farmEditBtn', 'mapEditBtn']); // Fixed HUD tabs hidden while the menu is open so they cannot cover menu actions.
  let busy = false; // Prevents double-clicks from starting overlapping runtime/folder saves.
  let quitAttempts = 0; // Mobile-visible count of guarded quit attempts.
  let successfulFolderFlushes = 0; // Mobile-visible count of folder writes completed before a quit reload.
  let lastError = ''; // Mobile-visible latest guarded-quit error.
  let menuControlsObserver = null; // Watches menu children and open/close state because controls are dynamic.
  let manualSaveBusyTimer = null; // Polls the existing Manual Save disabled state without feeding disabled mutations back into the menu observer.
  let menuControlsCompact = false; // Reported in mobile-visible diagnostics and used to keep the measured header mode stable.
  let menuControlRelayoutTimer = null; // Debounces resize/orientation bursts so mobile rotation triggers one menu-header measurement after layout settles.
  let menuControlRelayouts = 0; // Mobile-visible count of responsive menu-header recalculations.

  function localSave() {
    return window.LocalSaveFolder || null;
  }

  function setBusy(button, value, label = 'Saving…') {
    if (!button) return;
    if (!button.dataset.folderQuitLabel) button.dataset.folderQuitLabel = button.textContent || '🚪 Quit';
    button.disabled = value;
    button.textContent = value ? label : button.dataset.folderQuitLabel;
  }

  function disableFarmResetControl() {
    if (typeof document?.getElementById !== 'function') return false;
    const resetButton = document.getElementById(RESET_BUTTON_ID); // Existing reset node stays in the DOM for legacy code that expects the element to exist.
    if (!resetButton) return false;
    if (!resetButton.disabled) resetButton.disabled = true;
    if (!resetButton.hidden) resetButton.hidden = true;
    if (resetButton.tabIndex !== -1) resetButton.tabIndex = -1;
    if (resetButton.style.display !== 'none') resetButton.style.display = 'none';
    if (resetButton.getAttribute('aria-hidden') !== 'true') resetButton.setAttribute('aria-hidden', 'true');
    if (resetButton.getAttribute('data-farm-reset-disabled') !== 'true') resetButton.setAttribute('data-farm-reset-disabled', 'true');
    return true;
  }

  function syncMenuOverlayControls() {
    if (typeof document?.getElementById !== 'function') return false;
    const menuPanel = document.getElementById('menuPanel'); // Its existing .open class is the authoritative visible-menu state.
    const menuOpen = Boolean(menuPanel?.classList?.contains('open')); // Used below to hide fixed HUD tabs only while they would overlap the menu.
    for (const id of MENU_OVERLAY_CONTROL_IDS) { // Each fixed tab keeps its normal display rule and only receives a temporary visibility override.
      const button = document.getElementById(id); // Menu, Farm Edit, and Map Edit share the top-right HUD region above the menu z-index.
      if (!button) continue;
      button.style.visibility = menuOpen ? 'hidden' : '';
      button.style.pointerEvents = menuOpen ? 'none' : '';
    }
    return true;
  }

  function menuControlLabel(spec, button, compact = menuControlsCompact) {
    if (spec.id === MANUAL_SAVE_BUTTON_ID && button?.dataset?.manualSaveBusy === '1') return compact ? '…' : 'Saving…';
    return compact ? spec.compactText : spec.text;
  }

  function applyMenuControlLabels(compact) {
    menuControlsCompact = compact;
    for (const spec of MENU_CONTROL_LABELS) { // Each existing action keeps its handler while only its presentation changes.
      const button = document.getElementById(spec.id); // Static and late-installed controls use the same responsive treatment.
      if (!button) continue;
      const label = menuControlLabel(spec, button, compact); // The busy Manual Save label also compacts without changing save state.
      if (button.textContent !== label) button.textContent = label;
      button.setAttribute('aria-label', spec.accessibleLabel);
      button.title = spec.accessibleLabel;
      button.style.width = compact ? '' : 'auto';
      button.style.minWidth = compact ? '32px' : spec.minWidth;
      button.style.padding = compact ? '0 5px' : '0 7px';
      button.style.whiteSpace = 'nowrap';
    }
  }

  function menuTabsOverflow() {
    const tabs = document.querySelector('#menuPanel .mp-tabs'); // The tab strip is the measured sibling competing with menu controls for header width.
    return Boolean(tabs && tabs.scrollWidth > tabs.clientWidth + 1);
  }

  function labelMenuControls() {
    if (typeof document?.querySelector !== 'function' || typeof document?.getElementById !== 'function') return false;
    const controls = document.querySelector('#menuPanel .mp-ctrls'); // Existing control-row parent receives readable labels without replacing handlers.
    if (!controls) return false;

    applyMenuControlLabels(false); // Prefer readable full labels whenever the current viewport has room.
    if (menuTabsOverflow()) applyMenuControlLabels(true); // Compact the sibling controls only when the live tab strip would otherwise overlap.

    disableFarmResetControl();
    syncMenuOverlayControls();
    return true;
  }

  function scheduleMenuControlRelayout() {
    if (menuControlRelayoutTimer) clearTimeout(menuControlRelayoutTimer);
    menuControlRelayoutTimer = setTimeout(() => {
      menuControlRelayoutTimer = null;
      menuControlRelayouts++;
      labelMenuControls();
    }, 80); // Rotation can emit many resize events while CSS/layout is still changing; measure once after the burst.
  }

  function finishManualSaveBusyLabel(button) {
    if (manualSaveBusyTimer) {
      clearTimeout(manualSaveBusyTimer);
      manualSaveBusyTimer = null;
    }
    if (button?.dataset) delete button.dataset.manualSaveBusy;
    labelMenuControls();
  }

  function startManualSaveBusyLabel(button) {
    if (!button || button.disabled || button.dataset?.manualSaveBusy === '1') return false;
    button.dataset.manualSaveBusy = '1';
    button.textContent = 'Saving…';
    if (manualSaveBusyTimer) clearTimeout(manualSaveBusyTimer);
    const waitForCompletion = () => {
      if (!button.isConnected || !button.disabled) {
        finishManualSaveBusyLabel(button);
        return;
      }
      manualSaveBusyTimer = setTimeout(waitForCompletion, 100);
    };
    manualSaveBusyTimer = setTimeout(waitForCompletion, 0); // Runs after the checkpoint click handler has synchronously disabled the button.
    return true;
  }

  function installMenuSafetyUi() {
    if (typeof document?.querySelector !== 'function' || typeof document?.getElementById !== 'function') return false;
    labelMenuControls();
    if (menuControlsObserver || typeof MutationObserver !== 'function') return true;
    const menuPanel = document.getElementById('menuPanel'); // Narrow observation root catches late save controls plus the panel's open/close class changes.
    if (!menuPanel) return false;
    menuControlsObserver = new MutationObserver(records => {
      let structuralChange = false; // Element insertions/removals can introduce or remove menu controls and require a fresh measurement.
      let visibilityChange = false; // The menuPanel class is the authoritative open/closed signal for fixed HUD-tab visibility.
      for (const record of records) {
        if (record.type === 'attributes') {
          if (record.target === menuPanel && record.attributeName === 'class') visibilityChange = true;
          continue;
        }
        if (record.type !== 'childList') continue;
        const changedNodes = [...record.addedNodes, ...record.removedNodes];
        if (changedNodes.some(node => node?.nodeType === 1)) structuralChange = true;
      }
      // Ignore text-only childList mutations. labelMenuControls() changes button textContent itself,
      // and reacting to those mutations caused full/compact labels to toggle forever on narrow rotated screens.
      if (visibilityChange) syncMenuOverlayControls();
      if (visibilityChange || structuralChange) scheduleMenuControlRelayout();
    });
    menuControlsObserver.observe(menuPanel, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    return true;
  }

  async function ensurePrimaryFolderReady(button) {
    const save = localSave();
    if (!save?.isSupported?.()) return { ok: true, fallbackOnly: true };

    let status = save.getStatus();
    if (!status.folderName) {
      const choose = confirm('No Primary Save Folder is connected. Choose one before quitting?\n\nCancel keeps you in the game.');
      if (!choose) return { ok: false, cancelled: true };
      setBusy(button, true, 'Choosing Folder…');
      status = await save.chooseFolder();
    } else if (status.state !== 'ready') {
      // Do permission work before the runtime-save await so this remains directly
      // associated with the user's Quit gesture in browsers that gate requests.
      setBusy(button, true, 'Reconnecting…');
      status = await save.reconnect();
    }

    if (status.state !== 'ready') {
      return {
        ok: false,
        error: status.lastError || 'Primary save folder permission was not granted.',
      };
    }
    return { ok: true, fallbackOnly: false };
  }

  async function flushRuntimeOrStop() {
    const runtime = window.HobunjiRuntimeSave; // Canonical live-game flush bridge installed before gameplay modules initialize.
    if (!runtime?.flushNow) return { ok: false, error: 'The live save bridge is unavailable; quitting was stopped to avoid copying stale save data.' };
    const result = runtime.flushNow({ reason: 'quit-to-save-selection' });
    if (!result?.ok || !result.captured) {
      return {
        ok: false,
        error: result?.error || 'The current gameplay state could not be written to the browser save.',
      };
    }
    return { ok: true };
  }

  async function flushFolderOrStop() {
    const save = localSave();
    if (!save || !save.getStatus().folderName) return { ok: true, fallbackOnly: true };

    let status = await save.syncNow();
    if (status.dataLossRisk) {
      const overwrite = confirm(
        `Warning: this browser save ${status.dataLossRisk}.\n\n` +
        'Overwrite the Primary Save Folder anyway?'
      );
      if (!overwrite) return { ok: false, cancelled: true };
      status = await save.syncNow({ force: true });
    }
    if (status.lastError) return { ok: false, error: status.lastError };
    successfulFolderFlushes++;
    return { ok: true, fallbackOnly: false };
  }

  async function guardedQuit(button) {
    if (busy) return;
    busy = true;
    quitAttempts++;
    lastError = '';
    setBusy(button, true);

    try {
      const folderReady = await ensurePrimaryFolderReady(button);
      if (!folderReady.ok) {
        if (folderReady.error) alert('Could not prepare the Primary Save Folder, so the game was not quit:\n' + folderReady.error);
        return;
      }

      setBusy(button, true, 'Saving Game…');
      const runtimeSaved = await flushRuntimeOrStop();
      if (!runtimeSaved.ok) {
        lastError = runtimeSaved.error;
        alert('The current game was not safely saved, so the game was not quit:\n' + lastError);
        return;
      }

      if (!folderReady.fallbackOnly) {
        setBusy(button, true, 'Saving Folder…');
        const folderSaved = await flushFolderOrStop();
        if (!folderSaved.ok) {
          if (folderSaved.cancelled) {
            alert('The Primary Save Folder was not overwritten, so the game was not quit.');
          } else {
            lastError = folderSaved.error || 'Unknown folder-save error.';
            alert('Could not save the Primary Save Folder, so the game was not quit:\n' + lastError);
          }
          return;
        }
      }

      setBusy(button, true, 'Opening Saves…');
      location.reload();
    } catch (error) {
      lastError = String(error?.message || error);
      alert('Could not safely quit:\n' + lastError);
    } finally {
      busy = false;
      setBusy(button, false);
    }
  }

  document.addEventListener('click', event => {
    const resetButton = event.target?.closest?.(`#${RESET_BUTTON_ID}`); // Capture-phase guard blocks any legacy click path even if another script unhides the reset node.
    if (!resetButton) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  document.addEventListener('click', event => {
    const button = event.target?.closest?.(`#${MANUAL_SAVE_BUTTON_ID}`);
    if (!button) return;
    startManualSaveBusyLabel(button); // Does not stop propagation; the checkpoint manager still owns the actual save operation.
  }, true);

  document.addEventListener('click', event => {
    const button = event.target?.closest?.(`#${QUIT_BUTTON_ID}`);
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    guardedQuit(button);
  }, true);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installMenuSafetyUi, { once: true });
  } else {
    installMenuSafetyUi();
  }
  window.addEventListener('resize', scheduleMenuControlRelayout, { passive: true }); // Re-expands or recompacts after rotation and mobile browser chrome changes.

  // A browser refresh/close that bypasses the menu cannot await folder I/O,
  // but the live localStorage snapshot itself is synchronous. Capture phase on
  // window runs before the core module's normal beforeunload folder-sync handler,
  // giving that best-effort folder write the freshest possible browser state.
  window.addEventListener('beforeunload', () => {
    window.HobunjiRuntimeSave?.flushNow?.({ reason: 'beforeunload' });
  }, { capture: true });

  window.FolderSaveQuitGuard = { guardedQuit, labelMenuControls, disableFarmResetControl, syncMenuOverlayControls, startManualSaveBusyLabel, scheduleMenuControlRelayout };
  window.__hobunjiFolderSaveQuitDebug = {
    snapshot: () => ({
      busy,
      quitAttempts,
      successfulFolderFlushes,
      lastError: lastError || null,
      menuControlsCompact,
      menuTabsFit: !menuTabsOverflow(),
      menuControlRelayouts,
      relayoutPending: Boolean(menuControlRelayoutTimer),
      latestChange: 'Phone rotation relayout is debounced and menu label mutations no longer feed back into the menu observer.',
      farmResetDisabled: typeof document?.getElementById === 'function' && document.getElementById(RESET_BUTTON_ID)?.disabled === true,
      labeledMenuButtons: typeof document?.getElementById === 'function'
        ? MENU_CONTROL_LABELS.filter(spec => {
            const button = document.getElementById(spec.id);
            return button?.textContent === menuControlLabel(spec, button, menuControlsCompact);
          }).length
        : 0,
      menuOverlayControlsHidden: typeof document?.getElementById === 'function'
        ? MENU_OVERLAY_CONTROL_IDS.filter(id => document.getElementById(id)?.style?.visibility === 'hidden').length
        : 0,
    }),
  };
})();
