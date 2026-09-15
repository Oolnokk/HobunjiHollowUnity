// Folder Save Reload Choice — every fresh page load with a remembered folder
// stops before onboarding and lets the player choose the browser autosave first.
// This protects progress after accidental tab/app closes from an older folder copy.
(() => {
  'use strict';

  const save = window.LocalSaveFolder; // Final conflict-safe folder surface loaded before this policy.
  const primary = window.FolderSavePrimary; // Existing desktop folder UX whose startup owner is replaced below.
  if (!save?.getStatus || !primary?.prepareBeforeOnboarding || window.FolderSaveReloadChoice) return;

  const SAVE_META_KEY = 'hobunjiSaveMeta'; // Browser autosave metadata used only to describe whether a recovery copy exists.
  const GATE_ID = 'folderSavePrimaryGate'; // Reuses the existing full-screen startup gate styling.
  const OLD_SKIP_KEY = 'hobunjiFolderPrimarySkipOnce'; // Old one-shot bypass is cleared/ignored because reload choice must always appear.

  let startupPromise = null; // One choice gate per page load even if onboarding init is requested repeatedly.
  let startupMode = 'pending'; // Latest resolved startup direction for diagnostics.
  let gatesShown = 0; // Count of reload-recovery choices displayed.
  let browserChoices = 0; // Count of times the browser autosave was deliberately kept.
  let folderChoices = 0; // Count of explicit folder restores selected from the reload gate.
  let lastError = ''; // Latest startup-choice failure visible in Save Diagnostics.

  try { sessionStorage.removeItem(OLD_SKIP_KEY); } catch {} // Never let an older intentional reload suppress the new recovery choice.

  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function readBrowserSummary() {
    try {
      const raw = localStorage.getItem(SAVE_META_KEY);
      if (!raw) return { available: false, farmers: 0, worlds: 0 };
      const meta = JSON.parse(raw);
      const farmers = Array.isArray(meta?.characters) ? meta.characters.length : 0;
      const worlds = Array.isArray(meta?.worlds) ? meta.worlds.length : 0;
      return { available: true, farmers, worlds };
    } catch {
      return { available: false, farmers: 0, worlds: 0 };
    }
  }

  function waitForFolderInit() {
    const current = save.getStatus(); // Core begins at an 'unsupported' sentinel until its async remembered-handle lookup finishes.
    if (current.state !== 'unsupported' || !save.isSupported?.()) return Promise.resolve(current);
    return new Promise(resolve => {
      let done = false;
      let unsubscribe = null;
      const finish = status => {
        if (done) return;
        done = true;
        try { unsubscribe?.(); } catch {}
        resolve(status || save.getStatus());
      };
      unsubscribe = save.onChange?.(status => {
        if (status.state !== 'unsupported') finish(status);
      });
      setTimeout(() => finish(save.getStatus()), 2500);
    });
  }

  function removeGate() {
    document.getElementById(GATE_ID)?.remove();
  }

  function showReloadChoice(status) {
    gatesShown++;
    return new Promise(resolve => {
      removeGate();
      const browser = readBrowserSummary(); // Existing localStorage autosave survives accidental page/app closes and is never modified by merely showing this gate.
      const gate = document.createElement('div');
      gate.id = GATE_ID;
      gate.setAttribute('role', 'dialog');
      gate.setAttribute('aria-modal', 'true');
      gate.setAttribute('aria-label', 'Choose browser autosave or save folder');
      gate.innerHTML = `
        <div class="folder-save-primary-gate-card">
          <div class="folder-save-primary-gate-title">Choose the save to continue</div>
          <div class="folder-save-primary-gate-copy">
            Normal autosaves stay in this browser. If the page or app closed unexpectedly, use the browser autosave first so newer local progress cannot be replaced by an older folder copy.
          </div>
          <div class="folder-save-primary-gate-status" data-folder-reload-summary>
            ${browser.available
              ? `Browser autosave: ${browser.farmers} farmer${browser.farmers === 1 ? '' : 's'} · ${browser.worlds} world${browser.worlds === 1 ? '' : 's'}.`
              : 'No readable browser autosave is available on this device.'}
            Remembered folder: “${esc(status.folderName || 'Save Folder')}”.
          </div>
          <div class="folder-save-primary-gate-status" data-folder-reload-status></div>
          <div class="folder-save-primary-gate-actions">
            <button type="button" class="folder-save-primary-gate-main" data-folder-use-browser ${browser.available ? '' : 'disabled'}>Use Browser Autosave</button>
            <button type="button" class="folder-save-primary-gate-fallback" data-folder-use-folder>${status.state === 'ready' ? 'Use Save Folder' : 'Reconnect & Use Save Folder'}</button>
          </div>
        </div>`;
      document.body.appendChild(gate);

      const browserButton = gate.querySelector('[data-folder-use-browser]'); // First/recommended recovery direction; performs no folder read or write.
      const folderButton = gate.querySelector('[data-folder-use-folder]'); // Explicit destructive direction: validated folder contents replace the browser working copy.
      const statusEl = gate.querySelector('[data-folder-reload-status]');

      browserButton?.addEventListener('click', () => {
        browserChoices++;
        startupMode = 'browser-autosave';
        lastError = '';
        removeGate();
        resolve(startupMode);
      }, { once: true });

      folderButton?.addEventListener('click', async () => {
        folderButton.disabled = true;
        if (browserButton) browserButton.disabled = true;
        try {
          let current = save.getStatus();
          if (current.state !== 'ready') {
            if (statusEl) statusEl.textContent = 'Reconnecting to the save folder…';
            current = await save.reconnect(); // Permission restoration is non-destructive; the browser autosave still exists if reconnect is cancelled/fails.
          }
          if (current.state !== 'ready') {
            if (statusEl) statusEl.textContent = current.lastError || 'Folder permission was not granted. Your browser autosave was not changed.';
            folderButton.disabled = false;
            if (browserButton && browser.available) browserButton.disabled = false;
            return;
          }

          if (statusEl) statusEl.textContent = 'Loading the save folder…';
          const result = await save.loadFromFolder(); // Explicit folder choice is the only startup path allowed to replace the browser autosave.
          if (!result?.ok) {
            if (statusEl) statusEl.textContent = result?.message || save.getStatus().lastError || 'Could not load the save folder. Your browser autosave is still available.';
            folderButton.disabled = false;
            if (browserButton && browser.available) browserButton.disabled = false;
            return;
          }

          folderChoices++;
          startupMode = 'folder-explicit';
          lastError = '';
          removeGate();
          resolve(startupMode);
        } catch (error) {
          lastError = String(error?.message || error);
          if (statusEl) statusEl.textContent = `${lastError} Your browser autosave was not replaced.`;
          folderButton.disabled = false;
          if (browserButton && browser.available) browserButton.disabled = false;
        }
      });
    });
  }

  async function prepareBeforeOnboarding() {
    if (startupPromise) return startupPromise;
    startupPromise = (async () => {
      const status = await waitForFolderInit();
      if (!save.isSupported?.() || !status.folderName) {
        startupMode = 'browser-no-folder';
        return startupMode;
      }
      // Deliberately do NOT auto-load even when permission is already ready.
      // A remembered folder must never outrank the crash-recovery browser autosave without a fresh user choice.
      return showReloadChoice(save.getStatus());
    })().catch(error => {
      lastError = String(error?.message || error);
      startupMode = 'browser-fallback-after-gate-error';
      removeGate();
      return startupMode;
    });
    return startupPromise;
  }

  primary.prepareBeforeOnboarding = prepareBeforeOnboarding;
  primary.markFolderAlreadyApplied = () => {}; // Every real page reload asks again, including deliberate reloads after a folder restore.

  window.FolderSaveReloadChoice = Object.freeze({ prepareBeforeOnboarding });
  window.__hobunjiFolderSaveReloadChoiceDebug = {
    snapshot: () => ({
      startupMode,
      gatesShown,
      browserChoices,
      folderChoices,
      gateVisible: Boolean(document.getElementById(GATE_ID)),
      lastError: lastError || null,
    }),
  };
})();
