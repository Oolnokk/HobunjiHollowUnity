// Hobunji Hollow — save-folder correction for the linear character → farm handoff.
// The legacy creator briefly creates a throwaway world before onboarding-linear-flow removes it.
// If folder autosync observes that transient world, the normal data-loss guard correctly sees the
// later removal as suspicious. This module permits one forced retry only when the folder/browser
// snapshots prove that exact intercepted world is the sole difference.
(() => {
  'use strict';

  const MODULE_ID = 'hobunjiOnboardingFolderHandoffSync'; // Global install guard and mobile-readable diagnostics surface for this correction.
  const SAVE_META_KEY = 'hobunjiSaveMeta'; // Browser metadata compared against the connected folder before any forced correction is allowed.
  if (window[MODULE_ID]) return;

  const status = {
    installed: true,
    attemptedCorrections: 0,
    completedCorrections: 0,
    rejectedCorrections: 0,
    lastTempWorldId: null,
    lastError: null,
  }; // Exposes whether the intentional transient-world cleanup path was used without requiring DevTools.

  const localSave = window.LocalSaveFolder; // Existing folder persistence authority; this module only wraps its explicit sync call.
  if (!localSave?.syncNow || !localSave?.readPrimarySnapshot) {
    status.installed = false;
    status.lastError = 'LocalSaveFolder sync/read APIs were unavailable.';
    window[MODULE_ID] = Object.freeze({ status });
    return;
  }

  const rawSyncNow = localSave.syncNow.bind(localSave); // Preserved sync implementation used for the first guarded attempt and one narrowly validated forced retry.

  function readBrowserMeta() {
    try {
      const raw = localStorage.getItem(SAVE_META_KEY); // Current corrected character-only browser metadata authored by onboarding-linear-flow.
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      status.lastError = error?.message || String(error);
      return null;
    }
  }

  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!value || typeof value !== 'object') return value;
    const sorted = {}; // Canonical key order keeps equality checks independent of object-property insertion order.
    Object.keys(value).sort().forEach(key => { sorted[key] = stableValue(value[key]); });
    return sorted;
  }

  function normalizedMeta(meta, omittedWorldId = '') {
    const byId = items => [...(items || [])]
      .map(stableValue)
      .sort((a, b) => String(a?.id || '').localeCompare(String(b?.id || ''))); // Stable entity ordering lets folder/browser snapshots be compared structurally.
    return {
      version: meta?.version ?? 1,
      characters: byId(meta?.characters),
      worlds: byId((meta?.worlds || []).filter(world => String(world?.id || '') !== omittedWorldId)),
    };
  }

  function isExactTransientWorldDelta(folderMeta, browserMeta, tempWorldId) {
    if (!folderMeta || !browserMeta || !tempWorldId) return false;
    const folderWorlds = folderMeta.worlds || []; // Folder worlds are checked for exactly one extra intercepted legacy world.
    const browserWorlds = browserMeta.worlds || []; // Browser worlds already exclude that temporary world.
    if (!folderWorlds.some(world => String(world?.id || '') === tempWorldId)) return false;
    if (browserWorlds.some(world => String(world?.id || '') === tempWorldId)) return false;
    if (folderWorlds.length !== browserWorlds.length + 1) return false;

    const folderWithoutTemp = normalizedMeta(folderMeta, tempWorldId); // Expected folder state after deleting only the throwaway world.
    const browserNormalized = normalizedMeta(browserMeta); // Actual corrected browser state about to become canonical.
    return JSON.stringify(folderWithoutTemp) === JSON.stringify(browserNormalized);
  }

  function currentLinearHandoff() {
    const flow = window.hobunjiOnboardingLinearFlow; // Linear-flow status identifies the exact world intercepted during this creator completion.
    const tempWorldId = String(flow?.status?.interceptedLegacyWorldId || ''); // Only this world is ever eligible for the special correction.
    const active = !!tempWorldId
      && flow?.status?.creatorStep === 'complete'
      && flow?.status?.worldStep === 'name'; // Retry is legal only during the character-complete → Farm Name transition.
    return active ? { tempWorldId } : null;
  }

  async function maybeCorrectTransientWorld(options, firstResult) {
    if (options?.force) return firstResult;
    const handoff = currentLinearHandoff(); // No special handling outside the active linear onboarding handoff.
    if (!handoff) return firstResult;

    const risk = String(firstResult?.dataLossRisk || ''); // Core guard explains exactly why the first write was skipped.
    if (!/^would remove 1 world\(s\) that exist in the folder save$/.test(risk)) return firstResult;

    status.attemptedCorrections++;
    status.lastTempWorldId = handoff.tempWorldId;
    try {
      const primary = await localSave.readPrimarySnapshot(); // Read the actual canonical folder snapshot before bypassing any safety guard.
      const browserMeta = readBrowserMeta(); // Read the corrected browser snapshot after onboarding removed the legacy world.
      if (!isExactTransientWorldDelta(primary?.snapshot?.meta, browserMeta, handoff.tempWorldId)) {
        status.rejectedCorrections++;
        status.lastError = 'Folder/browser snapshots differed by more than the intercepted temporary onboarding world.';
        return firstResult;
      }

      const corrected = await rawSyncNow({
        ...(options || {}),
        force: true,
        recoveryKind: 'onboarding-temp-world-cleanup',
      }); // Exact-delta proof makes this one forced retry intentional rather than a general data-loss bypass.
      if (corrected?.lastError || corrected?.dataLossRisk) {
        status.lastError = corrected.lastError || corrected.dataLossRisk;
        return corrected;
      }
      status.completedCorrections++;
      status.lastError = null;
      return corrected;
    } catch (error) {
      status.lastError = error?.message || String(error);
      return firstResult;
    }
  }

  localSave.syncNow = async (options = {}) => {
    const firstResult = await rawSyncNow(options); // Preserve the normal folder guard as the first authority on every save.
    return maybeCorrectTransientWorld(options, firstResult); // Retry only the proven one-world onboarding cleanup case.
  };

  window[MODULE_ID] = Object.freeze({ status });
})();
