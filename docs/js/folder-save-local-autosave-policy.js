// Folder Save Local Autosave Policy — browser/local durable state is the only
// automatic save destination. Folder writes are explicit boundary actions.
(() => {
  'use strict';

  const save = window.LocalSaveFolder; // Existing V2 core loaded immediately before this policy.
  if (!save?.syncNow || window.FolderSaveLocalAutosavePolicy) return;

  const rawGetStatus = save.getStatus.bind(save); // Core status used to verify the legacy timer is actually disarmed.
  const rawOnChange = typeof save.onChange === 'function' ? save.onChange.bind(save) : null; // Core listener surface transformed so later UI never sees folder autosync as armed.
  const rawSyncNow = save.syncNow.bind(save); // Explicit V2 writer retained; automatic calls are intercepted below.
  const rawLoadFromFolder = save.loadFromFolder.bind(save); // Explicit V2 restore retained, then immediately disarmed.
  const rawReconnect = typeof save.reconnect === 'function' ? save.reconnect.bind(save) : null; // Non-destructive core reconnect calls stopAutoSync() before inspecting the folder.
  const rawReconcile = typeof save.reconcileConnectedFolder === 'function' ? save.reconcileConnectedFolder.bind(save) : null; // Legacy direct reconcile calls are also disarmed after completion.

  let blockedAutomaticWrites = 0; // Mobile-readable count of legacy/background folder writes refused by policy.
  let explicitWrites = 0; // Count of explicit folder writes allowed through.
  let explicitLoads = 0; // Count of explicit folder restores allowed through.
  let timerDisarms = 0; // Count of times the legacy core briefly armed its old timers and this policy immediately shut them back off.
  let lastError = ''; // Latest failure to prove the folder timer was disarmed.

  function policyStatus(status = rawGetStatus()) {
    return {
      ...status,
      autoSyncArmed: false,
      folderWritePolicy: 'explicit-only',
      browserAutosavePrimary: true,
    };
  }

  async function disarmLegacyFolderAutosync() {
    const before = rawGetStatus(); // Internal core status reveals whether startAutoSync() was invoked by the completed explicit operation.
    if (!before?.autoSyncArmed) return policyStatus(before);
    if (!rawReconnect) throw new Error('Could not disarm legacy folder autosync because reconnect() is unavailable.');

    const after = await rawReconnect(); // reconnect() is intentionally non-destructive and calls stopAutoSync() before its folder inspection.
    if (rawGetStatus()?.autoSyncArmed) {
      throw new Error('Legacy folder autosync remained armed after an explicit folder operation.');
    }
    timerDisarms++;
    return policyStatus(after);
  }

  async function explicitOnlySync(options = {}) {
    if (options?.automatic) {
      blockedAutomaticWrites++;
      return {
        ...policyStatus(),
        state: 'automatic-folder-write-blocked',
        automaticWriteBlocked: true,
      }; // Upstream V3 wrappers see a non-ready result and therefore cannot continue into a canonical filesystem write.
    }

    explicitWrites++;
    const result = await rawSyncNow(options);
    try {
      await disarmLegacyFolderAutosync(); // Runs before V3 canonical wrappers continue, so the core's 1s/30s timers never get a chance to fire.
      lastError = '';
    } catch (error) {
      lastError = String(error?.message || error);
      throw error;
    }
    return { ...result, ...policyStatus(result) };
  }

  async function explicitOnlyLoad(...args) {
    explicitLoads++;
    const result = await rawLoadFromFolder(...args);
    try {
      await disarmLegacyFolderAutosync(); // A folder restore never arms ongoing folder writes; subsequent gameplay autosaves remain browser-only.
      lastError = '';
    } catch (error) {
      lastError = String(error?.message || error);
      throw error;
    }
    return result;
  }

  async function explicitOnlyReconcile(...args) {
    if (!rawReconcile) return null;
    const result = await rawReconcile(...args);
    try {
      await disarmLegacyFolderAutosync();
      lastError = '';
    } catch (error) {
      lastError = String(error?.message || error);
      throw error;
    }
    return result;
  }

  save.getStatus = () => policyStatus();
  if (rawOnChange) {
    save.onChange = listener => rawOnChange(status => listener(policyStatus(status))); // Later folder UI/background handlers always observe explicit-only policy.
  }
  save.syncNow = explicitOnlySync;
  save.loadFromFolder = explicitOnlyLoad;
  if (rawReconcile) save.reconcileConnectedFolder = explicitOnlyReconcile;

  window.FolderSaveLocalAutosavePolicy = Object.freeze({
    getStatus: () => ({
      mode: 'browser-autosave-folder-explicit',
      blockedAutomaticWrites,
      explicitWrites,
      explicitLoads,
      timerDisarms,
      lastError: lastError || null,
    }),
  });

  window.__hobunjiFolderSaveLocalAutosavePolicyDebug = {
    snapshot: () => ({
      ...window.FolderSaveLocalAutosavePolicy.getStatus(),
      folderStatus: policyStatus(),
    }),
  };
})();
