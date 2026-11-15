// Folder Save diagnostics UI — keeps persistence state inspectable on mobile
// without requiring DevTools or a console.
(() => {
  'use strict';

  const BUTTON_ID = 'localSaveFolderDebugBtn'; // Settings button used to open the current save diagnostics snapshot.
  const SUMMARY_ID = 'localSaveFolderChangeSummary'; // Small Settings note describing the most recent folder-save UX change.
  const CHANGE_SUMMARY = 'Latest: Load Folder rebuilds an active farm even when the folder JSON already matches the browser cache. Save Diagnostics compares stored and spawned furniture/building counts, including missing objects. Existing protections: wilderness treasure meshes are excluded from save JSON; unreadable character/world files block folder import; missing-house guards also protect direct capture'; // Human-readable current-change summary requested for mobile testing.
  let scheduled = false; // Coalesces Settings DOM mutations so diagnostics controls are installed only once per frame.

  function safeSnapshot(fn) {
    try { return typeof fn === 'function' ? fn() : null; } catch (error) { return { error: String(error?.message || error) }; }
  }

  function diagnosticsSnapshot() {
    const creatorPatch = window.hobunjiOnboardingCharacterCreationReloadHandoff; // Existing creator handoff debug/status object, including folder flush counts.
    return {
      change: CHANGE_SUMMARY.replace(/^Latest:\s*/i, ''),
      folder: safeSnapshot(() => window.LocalSaveFolder?.getStatus?.()),
      recovery: safeSnapshot(() => window.__hobunjiSaveCheckpointDebug?.snapshot?.()),
      primaryUx: safeSnapshot(() => window.__hobunjiFolderSavePrimaryDebug?.snapshot?.()),
      onboarding: safeSnapshot(() => window.__hobunjiFolderSaveOnboardingDebug?.snapshot?.()),
      emptyFolderBootstrap: safeSnapshot(() => window.__hobunjiFolderSaveEmptyBootstrapDebug?.snapshot?.()),
      provenance: safeSnapshot(() => window.__hobunjiFolderSaveProvenanceDebug?.snapshot?.()),
      runtimeFlush: safeSnapshot(() => window.__hobunjiRuntimeSaveDebug?.snapshot?.()),
      farmRestore: safeSnapshot(() => window.FarmEditor?.inspectFarmRestore?.()), // Read-only per-world counts show JSON imported versus meshes actually spawned.
      browserQuota: safeSnapshot(() => window.HobunjiStorageQuota?.debugSnapshot?.()),
      quitGuard: safeSnapshot(() => window.__hobunjiFolderSaveQuitDebug?.snapshot?.()),
      creatorHandoff: creatorPatch?.status ? { ...creatorPatch.status } : null,
      page: {
        href: location.href,
        visibility: document.visibilityState,
        onboardingVisible: Boolean(document.getElementById('ob-overlay')),
      },
    };
  }

  async function inspectCanonicalFarmOnDisk(worldId) {
    const folder = window.LocalSaveFolder; // Existing read-only folder snapshot authority; no filesystem writes or import side effects.
    const status = folder?.getStatus?.() || {}; // Connected folder diagnostics can be viewed before selecting a player.
    if (!worldId || status.state !== 'ready' || typeof folder?.readPrimarySnapshot !== 'function') {
      return { available: false, reason: !worldId ? 'Select a world first.' : 'Primary Save Folder is not ready.' };
    }
    try {
      const disk = await folder.readPrimarySnapshot(); // Fresh read of canonical farm-layout filenames (ignores numbered backup copies).
      const layout = disk?.snapshot?.farmLayouts?.[worldId] || null; // The selected world's disk layout, not the possibly stale browser mirror.
      const counts = layout ? {
        tiles: Array.isArray(layout.tiles) ? layout.tiles.length : 0,
        processing: Array.isArray(layout.furniture) ? layout.furniture.length : 0,
        decor: Array.isArray(layout.decor) ? layout.decor.filter(entry => entry && !entry.derivedLinkedWindow).length : 0,
        barns: Array.isArray(layout.buildings) ? layout.buildings.length : 0,
        houses: Array.isArray(layout.housePieces) ? layout.housePieces.length : 0,
        production: Array.isArray(layout.productionBuildings) ? layout.productionBuildings.length : 0,
      } : null; // Read-only category counts let mobile users identify whether their restored squeezers exist on disk.
      const savedBrowser = (() => {
        try {
          const key = window.FarmEditor?.farmLayoutKey?.(); // Existing per-world browser key, matched to the loaded profile.
          return key ? JSON.parse(localStorage.getItem(key) || 'null') : null;
        } catch (_) { return null; }
      })(); // Browser mirror may be missing or quota-staged; never modify it during diagnosis.
      return {
        available: true,
        worldId,
        canonicalPresent: !!layout,
        version: layout?.version ?? null,
        counts,
        matchesBrowserMirror: !!layout && !!savedBrowser && JSON.stringify(layout) === JSON.stringify(savedBrowser),
        ignoredNumberedCopies: status.ignoredFarmLayoutBackupFiles || [], // Existing loader tracks numbered backups but refuses to treat them as canonical files.
        savedAt: disk?.savedAt || null,
      };
    } catch (error) {
      return { available: false, worldId, error: String(error?.message || error) };
    }
  }

  async function showDiagnostics() {
    const snapshot = diagnosticsSnapshot(); // Current runtime/browser comparison remains useful even if folder permission has expired.
    snapshot.diskFarm = await inspectCanonicalFarmOnDisk(snapshot.farmRestore?.worldId); // Independent canonical disk read resolves browser-cache-versus-folder disagreements.
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

  // Both the button and summary this installs live inside #localSaveFolderRow
  // (static Settings markup, present from load), so watching document.body's
  // entire subtree used to mean any unrelated DOM change anywhere queued a
  // reinstall check for no reason. Falls back to document.body only if that
  // row somehow doesn't exist yet when this script runs.
  const observer = new MutationObserver(scheduleInstall); // Settings may be reparented/rebuilt; reinstall diagnostics when its DOM changes.
  const begin = () => {
    if (!document.body) return;
    observer.observe(document.getElementById('localSaveFolderRow') || document.body, { childList: true, subtree: true });
    scheduleInstall();
  };
  if (document.body) begin();
  else document.addEventListener('DOMContentLoaded', begin, { once: true });

  window.__hobunjiFolderSaveDiagnostics = {
    snapshot: diagnosticsSnapshot,
    show: showDiagnostics,
    inspectCanonicalFarmOnDisk, // Read-only canonical disk scan for mobile debugging; never replaces the browser or runtime save.
    changeSummary: CHANGE_SUMMARY,
  };
})();
