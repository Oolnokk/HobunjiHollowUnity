// Folder Save diagnostics UI — keeps persistence state inspectable on mobile
// without requiring DevTools or a console.
(() => {
  'use strict';

  const BUTTON_ID = 'localSaveFolderDebugBtn'; // Settings button used to open the current save diagnostics snapshot.
  const SUMMARY_ID = 'localSaveFolderChangeSummary'; // Small Settings note describing the most recent folder-save UX change.
  const CHANGE_SUMMARY = 'Latest: Quit now flushes live gameplay before the folder write, and Resume shows the folder source plus same/different-device last-writer status.'; // Human-readable current-change summary requested for mobile testing.
  let scheduled = false; // Coalesces Settings DOM mutations so diagnostics controls are installed only once per frame.

  function safeSnapshot(fn) {
    try { return typeof fn === 'function' ? fn() : null; } catch (error) { return { error: String(error?.message || error) }; }
  }

  function diagnosticsSnapshot() {
    const creatorPatch = window.hobunjiOnboardingCharacterCreationReloadHandoff; // Existing creator handoff debug/status object, including folder flush counts.
    return {
      change: CHANGE_SUMMARY.replace(/^Latest:\s*/i, ''),
      folder: safeSnapshot(() => window.LocalSaveFolder?.getStatus?.()),
      primaryUx: safeSnapshot(() => window.__hobunjiFolderSavePrimaryDebug?.snapshot?.()),
      onboarding: safeSnapshot(() => window.__hobunjiFolderSaveOnboardingDebug?.snapshot?.()),
      emptyFolderBootstrap: safeSnapshot(() => window.__hobunjiFolderSaveEmptyBootstrapDebug?.snapshot?.()),
      provenance: safeSnapshot(() => window.__hobunjiFolderSaveProvenanceDebug?.snapshot?.()),
      runtimeFlush: safeSnapshot(() => window.__hobunjiRuntimeSaveDebug?.snapshot?.()),
      quitGuard: safeSnapshot(() => window.__hobunjiFolderSaveQuitDebug?.snapshot?.()),
      creatorHandoff: creatorPatch?.status ? { ...creatorPatch.status } : null,
      page: {
        href: location.href,
        visibility: document.visibilityState,
        onboardingVisible: Boolean(document.getElementById('ob-overlay')),
      },
    };
  }

  function showDiagnostics() {
    const snapshot = diagnosticsSnapshot(); // Current mobile-readable snapshot rendered as selectable-ish alert text for easy screenshots/transcription.
    alert('SAVE DIAGNOSTICS\n\n' + JSON.stringify(snapshot, null, 2));
  }

  function install() {
    scheduled = false;
    const row = document.getElementById('localSaveFolderRow'); // Existing Primary Save Folder Settings row enhanced in place.
    if (!row) return;
    const controls = row.querySelector('div[style*="display:flex"]'); // Existing folder button/status container receives the debug affordance.
    if (!controls) return;

    if (!document.getElementById(BUTTON_ID)) {
      const button = document.createElement('button'); // Mobile-accessible diagnostic action; intentionally smaller than primary save controls.
      button.type = 'button';
      button.id = BUTTON_ID;
      button.className = 'settings-small-btn';
      button.textContent = 'Save Diagnostics';
      button.style.opacity = '0.72';
      button.addEventListener('click', showDiagnostics);
      controls.appendChild(button);
    }

    if (!document.getElementById(SUMMARY_ID)) {
      const summary = document.createElement('div'); // Persistent one-line recent-change summary shown below the folder controls.
      summary.id = SUMMARY_ID;
      summary.textContent = CHANGE_SUMMARY;
      Object.assign(summary.style, {
        flexBasis: '100%',
        fontSize: '10px',
        lineHeight: '1.4',
        opacity: '0.68',
      });
      controls.appendChild(summary);
    }
  }

  function scheduleInstall() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(install);
  }

  const observer = new MutationObserver(scheduleInstall); // Settings may be reparented/rebuilt; reinstall diagnostics when its DOM changes.
  const begin = () => {
    if (!document.body) return;
    observer.observe(document.body, { childList: true, subtree: true });
    scheduleInstall();
  };
  if (document.body) begin();
  else document.addEventListener('DOMContentLoaded', begin, { once: true });

  window.__hobunjiFolderSaveDiagnostics = {
    snapshot: diagnosticsSnapshot,
    show: showDiagnostics,
    changeSummary: CHANGE_SUMMARY,
  };
})();
